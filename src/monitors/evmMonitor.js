import { getBlockNumber, getLogs, getTransactionReceipt, getNativeBalance, getTokenBalance, getProvider } from '../evm.js';
import { query } from '../db.js';
import { expireInvoices, recordEvmPayment, getInvoice } from '../invoices.js';
import { sendWebhook } from '../webhooks.js';
import { logger } from '../logger.js';
import { getAsset } from '../assets.js';
import { isAtLeast } from '../money.js';
import { ethers } from 'ethers';
import { sweepInvoice, sweepAllUnswept } from '../sweeper.js';

async function maybeAutoSweep(invoiceId) {
  try {
    const autoSweepRes = await query("SELECT value FROM settings WHERE key = 'auto_sweep_enabled'");
    if (autoSweepRes.rows[0]?.value === 'false') return;

    logger.info({ invoiceId }, 'Auto-sweep to Central Treasury triggered');
    const result = await sweepInvoice(invoiceId);
    logger.info({ invoiceId, result }, 'Auto-sweep completed');
  } catch (err) {
    logger.warn({ err: err.message, invoiceId }, 'Auto-sweep deferred (can be retried manually or on periodic sweep)');
  }
}

async function emitStatusWebhook(invoice, status, txid, confirmations) {
  if (invoice.status === status) return;
  await sendWebhook(invoice.webhook_url, {
    event: `invoice.${status}`,
    invoice_id: invoice.id,
    status,
    txid,
    amount: invoice.amount,
    currency: invoice.currency,
    confirmations,
  });
}

/**
 * Verify on-chain status of pending invoices
 */
async function checkPendingInvoices() {
  const res = await query(
    `SELECT * FROM invoices
     WHERE status = 'pending' AND expires_at > datetime('now')`
  );

  for (const invoice of res.rows) {
    try {
      const asset = getAsset(invoice.currency);
      const requiredUnits = BigInt(invoice.amount_units);
      let detectedBalance = 0n;

      if (asset.isNative) {
        detectedBalance = await getNativeBalance(invoice.address, asset.chain);
      } else if (invoice.token_contract) {
        detectedBalance = await getTokenBalance(invoice.address, invoice.token_contract, asset.chain);
      }

      if (isAtLeast(detectedBalance, requiredUnits)) {
        logger.info({ invoiceId: invoice.id, detectedBalance: detectedBalance.toString(), currency: invoice.currency }, 'On-chain payment detected for invoice');
        const head = await getBlockNumber(asset.chain);
        const status = await recordEvmPayment(invoice, {
          txid: invoice.txid || `onchain-${invoice.address.slice(0, 10)}-${Date.now()}`,
          amountUnits: detectedBalance,
          confirmations: 1,
          raw: { detectedAt: new Date().toISOString(), balance: detectedBalance.toString(), head },
        });
        await emitStatusWebhook(invoice, status, invoice.txid, 1);
        if (status === 'confirmed') {
          maybeAutoSweep(invoice.id);
        }
      }
    } catch (err) {
      // Don't crash monitor on individual invoice query error
      logger.warn({ err: err.message, invoiceId: invoice.id }, 'Error checking pending invoice');
    }
  }
}

/**
 * Check confirmations for paid invoices
 */
async function confirmObservedPayments() {
  const res = await query(
    `SELECT * FROM invoices WHERE status = 'paid' AND txid IS NOT NULL`
  );

  for (const invoice of res.rows) {
    try {
      const asset = getAsset(invoice.currency);
      const head = await getBlockNumber(asset.chain);

      let confirmations = 1;
      let rawReceipt = null;

      if (invoice.txid && invoice.txid.startsWith('0x')) {
        const receipt = await getTransactionReceipt(invoice.txid, asset.chain);
        if (receipt && receipt.blockNumber) {
          confirmations = head - Number(receipt.blockNumber) + 1;
          rawReceipt = receipt.toJSON();
        }
      } else {
        // Fallback confirmations increment
        confirmations = 2;
      }

      if (confirmations >= invoice.confirmations_required) {
        const status = await recordEvmPayment(invoice, {
          txid: invoice.txid,
          amountUnits: invoice.amount_units,
          confirmations,
          raw: rawReceipt || { confirmedAt: new Date().toISOString(), head },
        });
        await emitStatusWebhook(invoice, status, invoice.txid, confirmations);
        if (status === 'confirmed') {
          maybeAutoSweep(invoice.id);
        }
      }
    } catch (err) {
      logger.warn({ err: err.message, invoiceId: invoice.id }, 'Error confirming observed payment');
    }
  }
}

/**
 * Instant verification when user submits txid (e.g. from MetaMask)
 */
export async function verifyTxidForInvoice(invoiceId, txid) {
  const invoice = await getInvoice(invoiceId);
  if (!invoice) throw new Error('Invoice not found');
  if (invoice.status === 'confirmed') return invoice;

  const asset = getAsset(invoice.currency);
  const receipt = await getTransactionReceipt(txid, asset.chain);
  if (!receipt) {
    throw new Error('Transaction receipt not yet found on blockchain. Please wait a few seconds and retry.');
  }

  if (receipt.status !== 1) {
    throw new Error('Transaction failed on-chain');
  }

  const head = await getBlockNumber(asset.chain);
  const confirmations = head - Number(receipt.blockNumber) + 1;

  const status = await recordEvmPayment(invoice, {
    txid,
    amountUnits: invoice.amount_units,
    confirmations,
    raw: receipt.toJSON(),
  });

  await emitStatusWebhook(invoice, status, txid, confirmations);
  if (status === 'confirmed') {
    maybeAutoSweep(invoice.id);
  }
  return await getInvoice(invoiceId);
}

export async function startEVMMonitor() {
  logger.info('Starting multi-chain EVM Payment Monitor & Treasury Sweeper...');
  let running = false;
  let sweepCounter = 0;

  const poll = async () => {
    if (running) return;
    running = true;
    try {
      await expireInvoices();
      await checkPendingInvoices();
      await confirmObservedPayments();

      // Check unswept invoices every 10 cycles (~80s)
      sweepCounter++;
      if (sweepCounter >= 10) {
        sweepCounter = 0;
        const autoSweepRes = await query("SELECT value FROM settings WHERE key = 'auto_sweep_enabled'");
        if (autoSweepRes.rows[0]?.value !== 'false') {
          await sweepAllUnswept();
        }
      }
    } catch (err) {
      logger.error({ err: err.message }, 'EVM monitor loop error');
    } finally {
      running = false;
    }
  };

  // Run initial poll
  poll().catch(err => logger.error({ err: err.message }, 'Initial EVM monitor poll error'));

  // Poll every 8 seconds
  setInterval(poll, 8_000);
}

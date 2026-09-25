import { getBlockNumber, getLogs, getTransactionReceipt, getNativeBalance, getTokenBalance, getProvider } from '../evm.js';
import { query } from '../db.js';
import { expireInvoices, recordEvmPayment, getInvoice } from '../invoices.js';
import { sendWebhook } from '../webhooks.js';
import { logger } from '../logger.js';
import { getAsset } from '../assets.js';
import { isAtLeast } from '../money.js';
import { ethers } from 'ethers';
import { sweepInvoice, sweepAllUnswept } from '../sweeper.js';
import { creditWalletBalance } from '../wallet.js';

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

  // Look up merchant's own webhook_secret for per-merchant HMAC signing
  let webhookSecret;
  if (invoice.merchant_id) {
    try {
      const mchRes = await query('SELECT webhook_secret FROM merchants WHERE id = $1', [invoice.merchant_id]);
      webhookSecret = mchRes.rows[0]?.webhook_secret;
    } catch {
      // Fall through to platform default
    }
  }

  await sendWebhook(invoice.webhook_url, {
    event: `invoice.${status}`,
    invoice_id: invoice.id,
    status,
    txid,
    amount: invoice.amount,
    currency: invoice.currency,
    confirmations,
  }, webhookSecret);
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
        // Look up detected block head and timestamp from recorded transactions
        const txRes = await query(
          'SELECT raw, created_at FROM transactions WHERE invoice_id = $1 ORDER BY created_at DESC LIMIT 1',
          [invoice.id]
        );
        let detectedBlock = null;
        let detectedTime = null;
        if (txRes.rows.length) {
          try {
            const rawObj = typeof txRes.rows[0].raw === 'string' ? JSON.parse(txRes.rows[0].raw) : txRes.rows[0].raw;
            if (rawObj?.head) detectedBlock = Number(rawObj.head);
          } catch {}
          if (txRes.rows[0].created_at) detectedTime = new Date(txRes.rows[0].created_at).getTime();
        }

        if (detectedBlock && head >= detectedBlock) {
          confirmations = head - detectedBlock + 1;
        } else if (detectedTime) {
          const elapsedSec = Math.max(1, Math.floor((Date.now() - detectedTime) / 1000));
          // BSC averages ~3s per block
          confirmations = Math.min(100, Math.floor(elapsedSec / 3) + 1);
        } else {
          confirmations = invoice.confirmations_required || 12;
        }
      }

      if (confirmations >= invoice.confirmations_required) {
        const status = await recordEvmPayment(invoice, {
          txid: invoice.txid,
          amountUnits: invoice.amount_units,
          confirmations,
          raw: rawReceipt || { confirmedAt: new Date().toISOString(), head, finalConfirmations: confirmations },
        });
        await emitStatusWebhook(invoice, status, invoice.txid, confirmations);
        if (status === 'confirmed') {
          maybeAutoSweep(invoice.id);
        }
      } else {
        // Keep confirmations updated in transactions table for live UI tracking
        await query(
          'UPDATE transactions SET confirmations = $1, updated_at = datetime("now") WHERE invoice_id = $2 AND txid = $3',
          [confirmations, invoice.id, invoice.txid]
        );
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

/**
 * Monitor direct on-chain deposits to the Merchant Main Wallet address
 */
async function checkDirectWalletDeposits() {
  try {
    const settingRes = await query("SELECT value FROM settings WHERE key = 'wallet_address_default'");
    if (!settingRes.rows.length) return;
    const address = settingRes.rows[0].value;

    const bnbAsset = getAsset('BNB_BSC');
    const onChainBal = await getNativeBalance(address, bnbAsset.chain);

    const balRes = await query(
      "SELECT available_units FROM balances WHERE wallet_id = 'default' AND currency = 'BNB_BSC'"
    );
    const recordedUnits = balRes.rows.length ? BigInt(balRes.rows[0].available_units || '0') : 0n;

    if (onChainBal > recordedUnits) {
      const diffUnits = onChainBal - recordedUnits;
      logger.info(
        { address, diffUnits: diffUnits.toString(), onChainBal: onChainBal.toString() },
        'Detected new on-chain direct deposit to Merchant Wallet'
      );
      await creditWalletBalance(
        'default',
        'BNB_BSC',
        diffUnits.toString(),
        'DEPOSIT',
        `onchain-${address.slice(0, 8)}-${Date.now()}`,
        'Direct on-chain deposit from Trust Wallet'
      );
    }

    // Check USDT BEP-20
    const usdtAsset = getAsset('USDT_BSC');
    if (usdtAsset && usdtAsset.contract) {
      const onChainUsdt = await getTokenBalance(address, usdtAsset.contract, usdtAsset.chain);
      const usdtBalRes = await query(
        "SELECT available_units FROM balances WHERE wallet_id = 'default' AND currency = 'USDT_BSC'"
      );
      const recordedUsdtUnits = usdtBalRes.rows.length ? BigInt(usdtBalRes.rows[0].available_units || '0') : 0n;

      if (onChainUsdt > recordedUsdtUnits) {
        const diffUsdt = onChainUsdt - recordedUsdtUnits;
        logger.info(
          { address, diffUsdt: diffUsdt.toString() },
          'Detected new on-chain USDT deposit to Merchant Wallet'
        );
        await creditWalletBalance(
          'default',
          'USDT_BSC',
          diffUsdt.toString(),
          'DEPOSIT',
          `onchain-usdt-${address.slice(0, 8)}-${Date.now()}`,
          'Direct on-chain USDT deposit'
        );
      }
    }
  } catch (err) {
    logger.warn({ err: err.message }, 'Error in checkDirectWalletDeposits');
  }
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
      await checkDirectWalletDeposits();

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

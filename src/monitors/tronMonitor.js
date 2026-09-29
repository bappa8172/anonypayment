// src/monitors/tronMonitor.js — TRON Network & USDT TRC-20 Background Monitor
// Monitors pending invoices, confirmations, and merchant wallet direct deposits

import { query } from '../db.js';
import { getAsset } from '../assets.js';
import { recordEvmPayment } from '../invoices.js';
import { sendWebhook } from '../webhooks.js';
import { logger } from '../logger.js';
import { config } from '../config.js';
import { getTrc20Transactions, getTrc20Balance, getTronBlockNumber } from '../tron.js';
import { creditWalletBalance } from '../wallet.js';

let monitorInterval = null;

async function emitStatusWebhook(invoice, status, txid, confirmations) {
  if (invoice.status === status) return;

  let webhookSecret;
  if (invoice.merchant_id) {
    try {
      const mchRes = await query('SELECT webhook_secret FROM merchants WHERE id = $1', [invoice.merchant_id]);
      webhookSecret = mchRes.rows[0]?.webhook_secret;
    } catch {}
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
 * Check pending TRC20 invoices for incoming deposits
 */
async function checkPendingTronInvoices() {
  const res = await query(
    `SELECT * FROM invoices
     WHERE status = 'pending' AND currency = 'USDT_TRC20' AND expires_at > datetime('now')`
  );

  for (const invoice of res.rows) {
    try {
      const asset = getAsset(invoice.currency);
      const contract = invoice.token_contract || asset.contract;
      const requiredUnits = BigInt(invoice.amount_units);

      // 1. Check TRC20 transfer history for this address
      const txs = await getTrc20Transactions(invoice.address, contract);
      let matchedTx = null;

      for (const tx of txs) {
        if (
          tx.to?.toLowerCase() === invoice.address.toLowerCase() &&
          BigInt(tx.value || '0') >= requiredUnits
        ) {
          matchedTx = tx;
          break;
        }
      }

      if (matchedTx) {
        const txid = matchedTx.transaction_id;
        const txTime = matchedTx.block_timestamp ? Number(matchedTx.block_timestamp) : Date.now();
        const elapsedSec = Math.max(1, Math.floor((Date.now() - txTime) / 1000));
        // TRON produces 1 block every 3 seconds
        const confirmations = Math.min(100, Math.floor(elapsedSec / 3) + 1);

        logger.info(
          { invoiceId: invoice.id, txid, confirmations, amount: invoice.amount },
          'On-chain TRC-20 USDT deposit detected for invoice'
        );

        const status = await recordEvmPayment(invoice, {
          txid,
          amountUnits: matchedTx.value,
          confirmations,
          raw: matchedTx,
        });

        await emitStatusWebhook(invoice, status, txid, confirmations);
        continue;
      }

      // 2. Direct on-chain balance check fallback
      const currentBal = await getTrc20Balance(invoice.address, contract);
      if (currentBal >= requiredUnits) {
        const pseudoTxid = `tron-${invoice.address.slice(0, 10)}-${Date.now()}`;
        logger.info(
          { invoiceId: invoice.id, currentBal: currentBal.toString(), currency: invoice.currency },
          'TRC-20 USDT balance threshold satisfied for invoice'
        );

        const status = await recordEvmPayment(invoice, {
          txid: pseudoTxid,
          amountUnits: currentBal.toString(),
          confirmations: 1,
          raw: { detectedAt: new Date().toISOString(), balance: currentBal.toString() },
        });

        await emitStatusWebhook(invoice, status, pseudoTxid, 1);
      }
    } catch (err) {
      logger.warn({ err: err.message, invoiceId: invoice.id }, 'Error checking pending TRON invoice');
    }
  }
}

/**
 * Update confirmation counts on paid TRON invoices
 */
async function confirmPaidTronInvoices() {
  const res = await query(
    `SELECT * FROM invoices WHERE status = 'paid' AND currency = 'USDT_TRC20'`
  );

  for (const invoice of res.rows) {
    try {
      // Look up detected time from transactions table
      const txRes = await query(
        'SELECT raw, created_at, confirmations FROM transactions WHERE invoice_id = $1 ORDER BY created_at DESC LIMIT 1',
        [invoice.id]
      );

      let prevConfs = txRes.rows[0]?.confirmations || 1;
      let detectedTime = txRes.rows[0]?.created_at ? new Date(txRes.rows[0].created_at).getTime() : Date.now();

      const elapsedSec = Math.max(1, Math.floor((Date.now() - detectedTime) / 1000));
      const currentConfs = Math.max(prevConfs, Math.min(100, Math.floor(elapsedSec / 3) + 1));

      if (currentConfs >= invoice.confirmations_required) {
        const status = await recordEvmPayment(invoice, {
          txid: invoice.txid,
          amountUnits: invoice.amount_units,
          confirmations: currentConfs,
          raw: { confirmedAt: new Date().toISOString(), finalConfirmations: currentConfs },
        });
        await emitStatusWebhook(invoice, status, invoice.txid, currentConfs);
        logger.info({ invoiceId: invoice.id, confirmations: currentConfs }, 'TRC-20 invoice fully confirmed');
      } else if (currentConfs > prevConfs) {
        await query('UPDATE transactions SET confirmations = $1, updated_at = datetime("now") WHERE invoice_id = $2', [currentConfs, invoice.id]);
      }
    } catch (err) {
      logger.warn({ err: err.message, invoiceId: invoice.id }, 'Error updating paid TRON invoice confirmations');
    }
  }
}

/**
 * Check direct on-chain TRC20 deposits into merchant main wallet
 */
async function checkDirectTronWalletDeposits() {
  try {
    const settingRes = await query("SELECT value FROM settings WHERE key = 'wallet_address_default_tron'");
    if (!settingRes.rows.length) return;
    const address = settingRes.rows[0].value;

    const asset = getAsset('USDT_TRC20');
    const onChainBal = await getTrc20Balance(address, asset.contract);

    const balRes = await query(
      "SELECT available_units FROM balances WHERE wallet_id = 'default' AND currency = 'USDT_TRC20'"
    );
    const recordedUnits = balRes.rows.length ? BigInt(balRes.rows[0].available_units || '0') : 0n;

    if (onChainBal > recordedUnits) {
      const diffUnits = onChainBal - recordedUnits;
      logger.info(
        { address, diffUnits: diffUnits.toString(), onChainBal: onChainBal.toString() },
        'Detected new on-chain USDT TRC-20 direct deposit to Merchant Wallet'
      );
      await creditWalletBalance(
        'default',
        'USDT_TRC20',
        diffUnits.toString(),
        'DEPOSIT',
        `tron-direct-${address.slice(0, 8)}-${Date.now()}`,
        'Direct on-chain TRC-20 USDT deposit'
      );
    }
  } catch (err) {
    logger.warn({ err: err.message }, 'Error in checkDirectTronWalletDeposits');
  }
}

/**
 * Start the TRON Background Monitor
 */
export async function startTronMonitor() {
  logger.info('Starting TRON (TRC-20) Payment Monitor');

  // Initial pass
  await checkPendingTronInvoices();
  await confirmPaidTronInvoices();
  await checkDirectTronWalletDeposits();

  // Run periodic loop every 12 seconds
  monitorInterval = setInterval(async () => {
    try {
      await checkPendingTronInvoices();
      await confirmPaidTronInvoices();
      await checkDirectTronWalletDeposits();
    } catch (err) {
      logger.error({ err: err.message }, 'Unhandled error in TRON monitor cycle');
    }
  }, 12000);
}

export function stopTronMonitor() {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }
}

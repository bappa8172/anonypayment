// src/monitors/btcMonitor.js — Bitcoin (BTC) Background Monitor
// Monitors pending Native SegWit / Legacy BTC invoices, confirmations via Mempool API, and direct wallet deposits

import { query } from '../db.js';
import { getAsset } from '../assets.js';
import { recordEvmPayment } from '../invoices.js';
import { sendWebhook } from '../webhooks.js';
import { logger } from '../logger.js';
import { config } from '../config.js';
import { getBtcTipHeight, getBtcTransactions, getBtcBalance } from '../btcWallet.js';
import { creditWalletBalance } from '../wallet.js';

let btcMonitorInterval = null;

async function emitStatusWebhook(invoice, status, txid, confirmations) {
  if (invoice.status === status) return;

  let webhookSecret;
  if (invoice.merchant_id) {
    try {
      const mchRes = await query('SELECT webhook_secret FROM merchants WHERE id = $1', [invoice.merchant_id]);
      webhookSecret = mchRes.rows[0]?.webhook_secret;
    } catch {}
  }

  let parsedMetadata = {};
  if (invoice.metadata) {
    try {
      parsedMetadata = typeof invoice.metadata === 'string' ? JSON.parse(invoice.metadata) : invoice.metadata;
    } catch {}
  }

  const finalOrderId = invoice.order_id || parsedMetadata?.orderId || null;
  const finalTxid = txid || invoice.txid || null;

  await sendWebhook(invoice.webhook_url, {
    event: `invoice.${status}`,
    id: invoice.id,
    invoice_id: invoice.id,
    orderId: finalOrderId,
    order_id: finalOrderId,
    status,
    txid: finalTxid,
    amount: invoice.amount,
    currency: invoice.currency,
    confirmations,
    metadata: parsedMetadata,
  }, webhookSecret);
}

/**
 * Check pending BTC invoices for on-chain or mempool transactions
 */
async function checkPendingBtcInvoices() {
  const res = await query(
    `SELECT * FROM invoices
     WHERE status = 'pending' AND currency = 'BTC' AND expires_at > datetime('now')`
  );

  if (!res.rows.length) return;

  const tipHeight = await getBtcTipHeight();

  for (const invoice of res.rows) {
    try {
      const requiredUnits = BigInt(invoice.amount_units);
      const txs = await getBtcTransactions(invoice.address);

      let matchedTx = null;
      let matchedOutputValue = 0n;

      for (const tx of txs) {
        if (!tx.vout || !Array.isArray(tx.vout)) continue;
        for (const out of tx.vout) {
          if (
            out.scriptpubkey_address?.toLowerCase() === invoice.address.toLowerCase() &&
            BigInt(out.value || 0) >= requiredUnits
          ) {
            matchedTx = tx;
            matchedOutputValue = BigInt(out.value);
            break;
          }
        }
        if (matchedTx) break;
      }

      if (matchedTx) {
        const txid = matchedTx.txid;
        let confirmations = 0;

        if (matchedTx.status?.confirmed && matchedTx.status?.block_height && tipHeight > 0) {
          confirmations = Math.max(1, tipHeight - matchedTx.status.block_height + 1);
        }

        logger.info(
          { invoiceId: invoice.id, txid, confirmations, amount: invoice.amount },
          'On-chain BTC transaction detected for invoice'
        );

        const status = await recordEvmPayment(invoice, {
          txid,
          amountUnits: matchedOutputValue.toString(),
          confirmations,
          raw: matchedTx,
        });

        await emitStatusWebhook(invoice, status, txid, confirmations);
        continue;
      }

      // Balance check fallback
      const bal = await getBtcBalance(invoice.address);
      if (bal.totalSats >= requiredUnits) {
        const pseudoTxid = `btc-${invoice.address.slice(0, 10)}-${Date.now()}`;
        const confirmations = bal.confirmedSats >= requiredUnits ? 1 : 0;

        logger.info(
          { invoiceId: invoice.id, totalSats: bal.totalSats.toString(), currency: 'BTC' },
          'BTC balance threshold satisfied for invoice'
        );

        const status = await recordEvmPayment(invoice, {
          txid: pseudoTxid,
          amountUnits: bal.totalSats.toString(),
          confirmations,
          raw: { detectedAt: new Date().toISOString(), ...bal },
        });

        await emitStatusWebhook(invoice, status, pseudoTxid, confirmations);
      }
    } catch (err) {
      logger.warn({ err: err.message, invoiceId: invoice.id }, 'Error checking pending BTC invoice');
    }
  }
}

/**
 * Check confirmations for paid BTC invoices
 */
async function confirmPaidBtcInvoices() {
  const res = await query(
    `SELECT * FROM invoices WHERE status = 'paid' AND currency = 'BTC'`
  );

  if (!res.rows.length) return;

  const tipHeight = await getBtcTipHeight();
  if (tipHeight <= 0) return;

  for (const invoice of res.rows) {
    try {
      const txs = await getBtcTransactions(invoice.address);
      for (const tx of txs) {
        if (tx.txid === invoice.txid || !invoice.txid) {
          if (tx.status?.confirmed && tx.status?.block_height) {
            const confirmations = Math.max(1, tipHeight - tx.status.block_height + 1);
            if (confirmations >= invoice.confirmations_required) {
              const status = await recordEvmPayment(invoice, {
                txid: tx.txid,
                amountUnits: invoice.amount_units,
                confirmations,
                raw: tx,
              });
              await emitStatusWebhook(invoice, status, tx.txid, confirmations);
              logger.info({ invoiceId: invoice.id, confirmations }, 'Bitcoin invoice confirmed on-chain');
            }
          }
          break;
        }
      }
    } catch (err) {
      logger.warn({ err: err.message, invoiceId: invoice.id }, 'Error updating paid BTC invoice');
    }
  }
}

/**
 * Check direct on-chain BTC deposits into merchant main wallet
 */
async function checkDirectBtcWalletDeposits() {
  try {
    const settingRes = await query("SELECT value FROM settings WHERE key = 'wallet_address_default_btc'");
    if (!settingRes.rows.length) return;
    const address = settingRes.rows[0].value;

    const bal = await getBtcBalance(address);
    const onChainSats = bal.confirmedSats;

    const balRes = await query(
      "SELECT available_units FROM balances WHERE wallet_id = 'default' AND currency = 'BTC'"
    );
    const recordedSats = balRes.rows.length ? BigInt(balRes.rows[0].available_units || '0') : 0n;

    if (onChainSats > recordedSats) {
      const diffSats = onChainSats - recordedSats;
      logger.info(
        { address, diffSats: diffSats.toString(), onChainSats: onChainSats.toString() },
        'Detected new on-chain BTC deposit to Merchant Wallet'
      );
      await creditWalletBalance(
        'default',
        'BTC',
        diffSats.toString(),
        'DEPOSIT',
        `btc-direct-${address.slice(0, 8)}-${Date.now()}`,
        'Direct on-chain Bitcoin deposit'
      );
    }
  } catch (err) {
    logger.warn({ err: err.message }, 'Error in checkDirectBtcWalletDeposits');
  }
}

/**
 * Start the Bitcoin Background Monitor
 */
export async function startBTCMonitor() {
  logger.info('Starting Bitcoin (BTC) Payment Monitor');

  // Initial pass
  await checkPendingBtcInvoices();
  await confirmPaidBtcInvoices();
  await checkDirectBtcWalletDeposits();

  // Run periodic loop every 15 seconds
  btcMonitorInterval = setInterval(async () => {
    try {
      await checkPendingBtcInvoices();
      await confirmPaidBtcInvoices();
      await checkDirectBtcWalletDeposits();
    } catch (err) {
      logger.error({ err: err.message }, 'Unhandled error in BTC monitor cycle');
    }
  }, 15000);
}

export function stopBTCMonitor() {
  if (btcMonitorInterval) {
    clearInterval(btcMonitorInterval);
    btcMonitorInterval = null;
  }
}

import { listsinceblock, getBlockCount, getBlockHash } from '../btc.js';
import { query } from '../db.js';
import { updateInvoiceStatus } from '../invoices.js';
import { sendWebhook } from '../webhooks.js';
import { logger } from '../logger.js';
import { config } from '../config.js';

let lastBlockHash = null;

export async function startBTCMonitor() {
  logger.info('Starting BTC monitor');

  if (!lastBlockHash) {
    const count = await getBlockCount();
    lastBlockHash = await getBlockHash(count);
  }

  setInterval(async () => {
    try {
      const result = await listsinceblock(lastBlockHash, 1);
      lastBlockHash = result.lastblock;

      for (const tx of result.transactions) {
        if (tx.category !== 'receive') continue;
        const invoiceId = tx.label;
        if (!invoiceId) continue;

        const invoiceRes = await query('SELECT * FROM invoices WHERE id = $1 AND currency = $2', [invoiceId, 'BTC']);
        if (!invoiceRes.rows.length) continue;
        const invoice = invoiceRes.rows[0];
        if (invoice.status === 'confirmed') continue;

        const amount = tx.amount;
        const confirmations = tx.confirmations;
        const txid = tx.txid;

        if (confirmations >= config.btc.confirmations) {
          await updateInvoiceStatus(invoice.id, 'confirmed', txid, confirmations);
          await sendWebhook(invoice.webhook_url, { invoice_id: invoice.id, status: 'confirmed', txid, amount, confirmations });
        } else if (confirmations > 0 && invoice.status === 'pending') {
          await updateInvoiceStatus(invoice.id, 'paid', txid, confirmations);
          await sendWebhook(invoice.webhook_url, { invoice_id: invoice.id, status: 'paid', txid, amount, confirmations });
        }
      }
    } catch (err) {
      logger.error({ err }, 'BTC monitor error');
    }
  }, 10000);
}

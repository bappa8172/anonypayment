import { query } from './db.js';
import { deriveAddress, initEVM } from './evm.js';
import { config } from './config.js';
import { v4 as uuidv4 } from 'uuid';
import { getAsset } from './assets.js';
import { fromBaseUnits, normalizeAmount, toBaseUnits } from './money.js';
import { assertTrustedWebhookUrl } from './security.js';
import { creditWalletBalance } from './wallet.js';
import { logger } from './logger.js';
import { notifyInvoiceCreated, notifyPaymentReceived } from './mailer.js';

export async function createInvoice({
  currency = 'BNB_BSC',
  amount,
  expiresInMinutes = 30,
  webhookUrl,
  metadata,
  tokenContract,
  merchantId = null,
  walletId = 'default',
  customerEmail = null,
  customerName = null,
  orderId = null,
  description = null,
}) {
  const id = uuidv4();
  const expiresAt = new Date(Date.now() + expiresInMinutes * 60000).toISOString();
  const asset = getAsset(currency);
  if (tokenContract) throw new Error('tokenContract is server-managed and must not be supplied');
  assertTrustedWebhookUrl(webhookUrl);

  const finalCustomerEmail = customerEmail || (metadata && metadata.customerEmail) || null;
  const finalCustomerName = customerName || (metadata && metadata.customerName) || null;
  const finalOrderId = orderId || (metadata && metadata.orderId) || null;
  const finalDescription = description || (metadata && metadata.description) || null;

  const evmInitialized = await initEVM();
  if (!evmInitialized) throw new Error('EVM wallet could not be initialized');

  await query(`INSERT INTO settings (key, value) VALUES ('evm_next_index', '0') ON CONFLICT (key) DO NOTHING`);
  const res = await query(`UPDATE settings SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'evm_next_index' RETURNING value`);
  const derivationIndex = parseInt(res.rows[0].value, 10) - 1;
  const address = deriveAddress(derivationIndex);
  const normalizedAmount = normalizeAmount(amount, asset.decimals);
  const amountUnits = toBaseUnits(amount, asset.decimals).toString();

  const confirmationsRequired = asset.isNative ? (asset.chain === 'sepolia' ? 2 : 2) : config.evm.confirmations;

  await query(
    `INSERT INTO invoices (
       id, currency, address, amount, amount_units, status, confirmations_required,
       created_at, expires_at, webhook_url, metadata, token_contract, derivation_index,
       merchant_id, wallet_id, customer_email, customer_name, order_id, description
     )
     VALUES ($1, $2, $3, $4, $5, 'pending', $6, datetime('now'), $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
    [
      id,
      asset.currency,
      address,
      normalizedAmount,
      amountUnits,
      confirmationsRequired,
      expiresAt,
      webhookUrl || null,
      metadata ? JSON.stringify(metadata) : null,
      asset.contract || null,
      derivationIndex,
      merchantId || null,
      walletId || 'default',
      finalCustomerEmail,
      finalCustomerName,
      finalOrderId,
      finalDescription,
    ]
  );

  const invoiceResult = {
    id,
    address,
    amount: normalizedAmount,
    currency: asset.currency,
    symbol: asset.symbol,
    name: asset.name,
    chain: asset.chain,
    chainId: asset.chainId,
    isNative: asset.isNative,
    tokenContract: asset.contract,
    merchantId,
    walletId,
    customerEmail: finalCustomerEmail,
    customerName: finalCustomerName,
    orderId: finalOrderId,
    description: finalDescription,
    expiresAt,
    explorerTx: asset.explorerTx,
    explorerAddress: `${asset.explorerAddress}${address}`,
  };

  // If customer email is specified, send the customer their invoice immediately
  if (finalCustomerEmail) {
    (async () => {
      try {
        let merchant = null;
        if (merchantId) {
          const mRes = await query('SELECT * FROM merchants WHERE id = $1', [merchantId]);
          merchant = mRes.rows[0] || null;
        }
        await notifyInvoiceCreated({ invoice: invoiceResult, merchant });
      } catch (err) {
        logger.warn({ err: err.message, invoiceId: id }, 'Failed to dispatch invoice creation email');
      }
    })();
  }

  return invoiceResult;
}

export async function getInvoice(id) {
  const res = await query(`
    SELECT i.*, COALESCE(t.confirmations, 0) as confirmations
    FROM invoices i
    LEFT JOIN (
      SELECT invoice_id, MAX(confirmations) as confirmations
      FROM transactions GROUP BY invoice_id
    ) t ON t.invoice_id = i.id
    WHERE i.id = $1
  `, [id]);
  return res.rows[0];
}

export async function listInvoices({ limit = 50, status = null, merchantId = null } = {}) {
  let q = `
    SELECT i.*, COALESCE(t.confirmations, 0) as confirmations
    FROM invoices i
    LEFT JOIN (
      SELECT invoice_id, MAX(confirmations) as confirmations
      FROM transactions GROUP BY invoice_id
    ) t ON t.invoice_id = i.id
  `;
  const params = [];
  const whereClauses = [];

  if (status) {
    params.push(status);
    whereClauses.push(`i.status = $${params.length}`);
  }
  if (merchantId) {
    params.push(merchantId);
    whereClauses.push(`i.merchant_id = $${params.length}`);
  }

  if (whereClauses.length > 0) {
    q += ' WHERE ' + whereClauses.join(' AND ');
  }

  params.push(limit);
  q += ` ORDER BY i.created_at DESC LIMIT $${params.length}`;

  const res = await query(q, params);
  return res.rows;
}

export async function updateInvoiceStatus(id, status, txid = null, confirmations = 0) {
  const updates = ['status = $2'];
  const params = [id, status];
  if (txid) {
    updates.push(`txid = $${params.length + 1}`);
    params.push(txid);
  }
  if (status === 'paid') {
    updates.push("paid_at = datetime('now')");
  }
  if (status === 'confirmed') {
    updates.push("confirmed_at = datetime('now')");
  }
  await query(`UPDATE invoices SET ${updates.join(', ')} WHERE id = $1`, params);
}

export async function recordEvmPayment(invoice, { txid, amountUnits, confirmations, raw }) {
  const asset = getAsset(invoice.currency);
  const status = confirmations >= invoice.confirmations_required ? 'confirmed' : 'paid';

  await query(
    `INSERT INTO transactions (id, invoice_id, txid, amount, amount_units, confirmations, status, raw, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, datetime('now'), datetime('now'))
     ON CONFLICT (invoice_id, txid) DO UPDATE
     SET confirmations = EXCLUDED.confirmations, status = EXCLUDED.status, raw = EXCLUDED.raw, updated_at = datetime('now')`,
    [
      uuidv4(),
      invoice.id,
      txid,
      fromBaseUnits(amountUnits, asset.decimals),
      amountUnits.toString(),
      confirmations,
      status,
      JSON.stringify(raw),
    ]
  );

  const previousStatus = invoice.status;
  await updateInvoiceStatus(invoice.id, status, txid, confirmations);

      // If newly confirmed, settle into merchant's isolated wallet
  if (status === 'confirmed' && previousStatus !== 'confirmed') {
    try {
      const targetWalletId = invoice.wallet_id || 'default';
      await creditWalletBalance(
        targetWalletId,
        invoice.currency,
        amountUnits,
        'INVOICE_SETTLEMENT',
        txid,
        `Settlement for invoice #${invoice.id.slice(0, 8)}`
      );
      logger.info({ invoiceId: invoice.id, walletId: targetWalletId, amountUnits: amountUnits.toString() }, 'Settled invoice payment into merchant wallet');

        // Dispatch automated emails to business owner and customer receipt
        try {
          const freshInvoice = await getInvoice(invoice.id);
          await notifyPaymentReceived({
            invoice: freshInvoice,
            txid,
            confirmations,
          });
        } catch (mailErr) {
          logger.warn({ err: mailErr.message, invoiceId: invoice.id }, 'Failed to dispatch payment notification emails');
        }

        // Automated on-chain sweep / auto-forward directly to merchant personal address or treasury
        (async () => {
          try {
            const autoSweepRes = await query("SELECT value FROM settings WHERE key = 'auto_sweep_enabled'");
            const globalAutoSweep = autoSweepRes.rows.length === 0 || autoSweepRes.rows[0].value !== 'false';
            if (globalAutoSweep) {
              let shouldSweep = true;
              if (invoice.merchant_id) {
                const mRes = await query('SELECT auto_forward FROM merchants WHERE id = $1', [invoice.merchant_id]);
                if (mRes.rows.length && mRes.rows[0].auto_forward === 0) {
                  shouldSweep = false;
                }
              }
              if (shouldSweep) {
                const { sweepInvoice } = await import('./sweeper.js');
                await sweepInvoice(invoice.id);
                logger.info({ invoiceId: invoice.id }, 'Automated on-chain sweep completed on confirmation');
              }
            }
          } catch (sweepErr) {
            logger.warn({ err: sweepErr.message, invoiceId: invoice.id }, 'Automated background sweep notice');
          }
        })();
      } catch (settleErr) {
        logger.error({ err: settleErr.message, invoiceId: invoice.id }, 'Failed to settle invoice to wallet');
      }
    }

  return status;
}

export async function expireInvoices() {
  await query(`UPDATE invoices SET status = 'expired' WHERE status = 'pending' AND expires_at <= datetime('now')`);
}

export async function updateInvoiceCustomerEmail(id, customerEmail, customerName = null) {
  await query(
    `UPDATE invoices SET customer_email = $2, customer_name = COALESCE($3, customer_name) WHERE id = $1`,
    [id, customerEmail, customerName]
  );
  const updated = await getInvoice(id);
  if ((updated.status === 'confirmed' || updated.status === 'paid') && !updated.receipt_email_sent) {
    try {
      await notifyPaymentReceived({
        invoice: updated,
        txid: updated.txid,
        confirmations: updated.confirmations_required || 1,
      });
    } catch (mailErr) {
      logger.warn({ err: mailErr.message, invoiceId: id }, 'Failed to send receipt after customer email update');
    }
  }
  return updated;
}

export function publicInvoice(invoice) {
  if (!invoice) return undefined;
  const asset = getAsset(invoice.currency);

  let paymentUri = `ethereum:${invoice.address}?value=${invoice.amount_units}`;
  if (!asset.isNative && invoice.token_contract) {
    paymentUri = `ethereum:${invoice.token_contract}@${asset.chainId}/transfer?` +
      new URLSearchParams({ address: invoice.address, uint256: invoice.amount_units }).toString();
  }

  return {
    id: invoice.id,
    currency: invoice.currency,
    symbol: asset.symbol,
    name: asset.name,
    chain: asset.chain,
    chainId: asset.chainId,
    isNative: asset.isNative,
    address: invoice.address,
    amount: invoice.amount,
    status: invoice.status,
    customerEmail: invoice.customer_email || null,
    customerName: invoice.customer_name || null,
    orderId: invoice.order_id || null,
    description: invoice.description || null,
    expiresAt: invoice.expires_at,
    paidAt: invoice.paid_at,
    confirmedAt: invoice.confirmed_at,
    txid: invoice.txid,
    confirmations: invoice.confirmations !== undefined ? invoice.confirmations : (invoice.status === 'confirmed' ? invoice.confirmations_required : (invoice.status === 'paid' ? 1 : 0)),
    confirmationsRequired: invoice.confirmations_required,
    tokenContract: invoice.token_contract,
    paymentUri,
    explorerTx: invoice.txid ? `${asset.explorerTx}${invoice.txid}` : null,
    explorerAddress: `${asset.explorerAddress}${invoice.address}`,
  };
}

export async function createPaymentLink({
  title,
  description = '',
  currency = 'BNB_BSC',
  amount,
  redirectUrl = '',
  merchantId = null,
  walletId = 'default',
}) {
  const asset = getAsset(currency);
  const normalizedAmount = normalizeAmount(amount, asset.decimals);
  const id = uuidv4();
  const code = Math.random().toString(36).substring(2, 10).toUpperCase();

  await query(
    `INSERT INTO payment_links (id, code, title, description, currency, amount, redirect_url, merchant_id, wallet_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, datetime('now'))`,
    [id, code, title, description, asset.currency, normalizedAmount, redirectUrl, merchantId, walletId]
  );

  return {
    id,
    code,
    title,
    description,
    currency: asset.currency,
    symbol: asset.symbol,
    amount: normalizedAmount,
    redirectUrl,
    merchantId,
    walletId,
  };
}

export async function getPaymentLinkByCode(code) {
  const res = await query('SELECT * FROM payment_links WHERE code = $1', [code]);
  return res.rows[0];
}

export async function listPaymentLinks({ limit = 50, merchantId = null } = {}) {
  let q = 'SELECT * FROM payment_links';
  const params = [];
  if (merchantId) {
    params.push(merchantId);
    q += ` WHERE merchant_id = $${params.length}`;
  }
  params.push(limit);
  q += ` ORDER BY created_at DESC LIMIT $${params.length}`;

  const res = await query(q, params);
  return res.rows;
}

export async function getGatewayStats(merchantId = null) {
  let totalInvoicesRes;
  let confirmedInvoicesRes;
  let paidInvoicesRes;
  let pendingInvoicesRes;
  let transactionsRes;

  if (merchantId) {
    totalInvoicesRes = await query('SELECT COUNT(*) as count FROM invoices WHERE merchant_id = $1', [merchantId]);
    confirmedInvoicesRes = await query("SELECT COUNT(*) as count FROM invoices WHERE status = 'confirmed' AND merchant_id = $1", [merchantId]);
    paidInvoicesRes = await query("SELECT COUNT(*) as count FROM invoices WHERE status = 'paid' AND merchant_id = $1", [merchantId]);
    pendingInvoicesRes = await query("SELECT COUNT(*) as count FROM invoices WHERE status = 'pending' AND merchant_id = $1", [merchantId]);
    transactionsRes = await query('SELECT COUNT(*) as count FROM transactions t JOIN invoices i ON t.invoice_id = i.id WHERE i.merchant_id = $1', [merchantId]);
  } else {
    totalInvoicesRes = await query('SELECT COUNT(*) as count FROM invoices');
    confirmedInvoicesRes = await query("SELECT COUNT(*) as count FROM invoices WHERE status = 'confirmed'");
    paidInvoicesRes = await query("SELECT COUNT(*) as count FROM invoices WHERE status = 'paid'");
    pendingInvoicesRes = await query("SELECT COUNT(*) as count FROM invoices WHERE status = 'pending'");
    transactionsRes = await query('SELECT COUNT(*) as count FROM transactions');
  }

  return {
    totalInvoices: parseInt(totalInvoicesRes.rows[0]?.count || '0', 10),
    confirmedInvoices: parseInt(confirmedInvoicesRes.rows[0]?.count || '0', 10),
    paidInvoices: parseInt(paidInvoicesRes.rows[0]?.count || '0', 10),
    pendingInvoices: parseInt(pendingInvoicesRes.rows[0]?.count || '0', 10),
    totalTransactions: parseInt(transactionsRes.rows[0]?.count || '0', 10),
  };
}

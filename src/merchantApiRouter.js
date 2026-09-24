import express from 'express';
import { z } from 'zod';
import { authenticate } from './security.js';
import { createInvoice, getInvoice, listInvoices, createPaymentLink, listPaymentLinks } from './invoices.js';
import { getWalletBalances, getWalletDepositAddress, withdrawCrypto } from './wallet.js';
import { getAllAssets } from './assets.js';

const router = express.Router();

// Require authentic merchant API key or session token
router.use(authenticate);

const createInvoiceSchema = z.object({
  currency: z.string().default('BNB_BSC'),
  amount: z.string().regex(/^\d+(?:\.\d+)?$/, 'Amount must be positive numeric string'),
  expiresInMinutes: z.number().int().min(1).max(24 * 60).optional(),
  webhookUrl: z.string().url().optional().or(z.literal('')),
  metadata: z.record(z.unknown()).optional(),
});

const withdrawSchema = z.object({
  currency: z.string(),
  toAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Must be a valid EVM 0x address'),
  amount: z.string().regex(/^\d+(?:\.\d+)?$/, 'Amount must be a positive numeric string'),
  note: z.string().optional(),
});

const paymentLinkSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  currency: z.string().default('BNB_BSC'),
  amount: z.string().regex(/^\d+(?:\.\d+)?$/),
  redirectUrl: z.string().url().optional().or(z.literal('')),
});

// 1. Create Invoice for customer checkout
router.post('/invoices', async (req, res) => {
  try {
    const data = createInvoiceSchema.parse(req.body);
    const invoice = await createInvoice({
      ...data,
      merchantId: req.user.role === 'merchant' ? req.user.id : null,
      walletId: req.user.walletId,
    });
    res.status(201).json(invoice);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 2. List Merchant Invoices
router.get('/invoices', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '50', 10);
    const status = req.query.status || null;
    const merchantId = req.user.role === 'merchant' ? req.user.id : null;

    const invoices = await listInvoices({ limit, status, merchantId });
    res.json({ invoices });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Get single invoice status
router.get('/invoices/:id', async (req, res) => {
  try {
    const invoice = await getInvoice(req.params.id);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    // Anti-IDOR check
    if (req.user.role === 'merchant' && invoice.merchant_id && invoice.merchant_id !== req.user.id) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    res.json(invoice);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Get Merchant Wallet Balances
router.get('/wallet', async (req, res) => {
  try {
    const balances = await getWalletBalances(req.user.walletId);
    res.json({
      merchantId: req.user.id,
      walletId: req.user.walletId,
      balances,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Get Merchant Deposit Address
router.get('/wallet/deposit-address', async (req, res) => {
  try {
    const currency = req.query.currency || 'BNB_BSC';
    const deposit = await getWalletDepositAddress(req.user.walletId, currency);
    res.json(deposit);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 6. Request Crypto Withdrawal to external wallet
router.post('/wallet/withdraw', async (req, res) => {
  try {
    const data = withdrawSchema.parse(req.body);
    const result = await withdrawCrypto({
      walletId: req.user.walletId,
      currency: data.currency,
      toAddress: data.toAddress,
      amount: data.amount,
      note: data.note,
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 7. Create Payment Link
router.post('/payment-links', async (req, res) => {
  try {
    const data = paymentLinkSchema.parse(req.body);
    const link = await createPaymentLink({
      ...data,
      merchantId: req.user.role === 'merchant' ? req.user.id : null,
      walletId: req.user.walletId,
    });
    res.status(201).json(link);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 8. List Payment Links
router.get('/payment-links', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '50', 10);
    const links = await listPaymentLinks({
      limit,
      merchantId: req.user.role === 'merchant' ? req.user.id : null,
    });
    res.json({ links });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9. Supported Assets
router.get('/assets', (req, res) => {
  res.json({ assets: getAllAssets() });
});

export default router;

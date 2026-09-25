import express from 'express';
import { createInvoice, getInvoice, listInvoices } from './invoices.js';
import { z } from 'zod';
import { authenticate } from './security.js';
import { getAllAssets } from './assets.js';
import { getEmailLogs } from './mailer.js';
import walletRouter from './walletRouter.js';

const router = express.Router();
router.use(authenticate);

const createInvoiceSchema = z.object({
  currency: z.string().default('BNB_BSC'),
  amount: z.string().regex(/^\d+(?:\.\d+)?$/),
  expiresInMinutes: z.number().int().min(1).max(24 * 60).optional(),
  webhookUrl: z.string().url().optional().or(z.literal('')),
  customerEmail: z.string().email().optional().or(z.literal('')),
  customerName: z.string().optional(),
  orderId: z.string().optional(),
  description: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  merchantId: z.string().optional(),
  walletId: z.string().optional(),
});

// List invoices (strictly scoped to merchant unless Super Admin)
router.get('/invoices', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '50', 10);
    const status = req.query.status || null;
    const merchantId = (req.user && req.user.id !== 'admin') ? req.user.id : (req.query.merchantId || null);

    const invoices = await listInvoices({ limit, status, merchantId });
    res.json({ invoices });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create new invoice (automatically bound to merchant identity)
router.post('/invoices', async (req, res) => {
  try {
    const data = createInvoiceSchema.parse(req.body);
    const merchantId = (req.user && req.user.id !== 'admin') ? req.user.id : (data.merchantId || req.user?.id || null);
    const walletId = req.user?.walletId && req.user.walletId !== 'default' ? req.user.walletId : (data.walletId || req.user?.walletId || 'default');

    const invoice = await createInvoice({
      ...data,
      merchantId,
      walletId,
    });
    res.json(invoice);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Get single invoice (with anti-IDOR check)
router.get('/invoices/:id', async (req, res) => {
  try {
    const invoice = await getInvoice(req.params.id);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    // Anti-IDOR check: A merchant can only view their own invoices
    if (req.user.role === 'merchant' && invoice.merchant_id && invoice.merchant_id !== req.user.id) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    res.json(invoice);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Supported currencies
router.get('/assets', (req, res) => {
  res.json({ assets: getAllAssets() });
});

// Email Audit Logs for Super Admin / Merchant
router.get('/emails', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '50', 10);
    const merchantId = req.user.role === 'merchant' ? req.user.id : (req.query.merchantId || null);
    const invoiceId = req.query.invoiceId || null;
    const emails = await getEmailLogs({ limit, merchantId, invoiceId });
    res.json({ emails });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Mount wallet router under /admin
router.use('/', walletRouter);

export default router;

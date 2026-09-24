import express from 'express';
import { createInvoice, getInvoice, listInvoices } from './invoices.js';
import { z } from 'zod';
import { requireAdminApiKey } from './security.js';
import { getAllAssets } from './assets.js';
import walletRouter from './walletRouter.js';

const router = express.Router();
router.use(requireAdminApiKey);

const createInvoiceSchema = z.object({
  currency: z.string().default('BNB_BSC'),
  amount: z.string().regex(/^\d+(?:\.\d+)?$/),
  expiresInMinutes: z.number().int().min(1).max(24 * 60).optional(),
  webhookUrl: z.string().url().optional().or(z.literal('')),
  metadata: z.record(z.unknown()).optional(),
});

// List all invoices
router.get('/invoices', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '50', 10);
    const status = req.query.status || null;
    const invoices = await listInvoices({ limit, status });
    res.json({ invoices });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create new invoice
router.post('/invoices', async (req, res) => {
  try {
    const data = createInvoiceSchema.parse(req.body);
    const invoice = await createInvoice(data);
    res.json(invoice);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Get single invoice
router.get('/invoices/:id', async (req, res) => {
  const invoice = await getInvoice(req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Not found' });
  res.json(invoice);
});

// Supported currencies
router.get('/assets', (req, res) => {
  res.json({ assets: getAllAssets() });
});

// Mount wallet router under /admin
router.use('/', walletRouter);

export default router;

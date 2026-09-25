import express from 'express';
import QRCode from 'qrcode';
import { getInvoice, publicInvoice, createInvoice, getPaymentLinkByCode, updateInvoiceCustomerEmail } from './invoices.js';
import { verifyTxidForInvoice } from './monitors/evmMonitor.js';
import { basicRateLimit } from './security.js';
import { z } from 'zod';

const router = express.Router();
router.use(basicRateLimit({ max: 120 }));

// 1. Get public invoice data
router.get('/invoices/:id', async (req, res, next) => {
  try {
    const raw = await getInvoice(req.params.id);
    if (!raw) return res.status(404).json({ error: 'Invoice not found' });
    const invoice = publicInvoice(raw);
    return res.json(invoice);
  } catch (error) {
    return next(error);
  }
});

// 2. Get QR Code for invoice
router.get('/invoices/:id/qr', async (req, res, next) => {
  try {
    const raw = await getInvoice(req.params.id);
    if (!raw) return res.status(404).json({ error: 'Invoice not found' });
    const invoice = publicInvoice(raw);

    // Generate QR URI formatted for crypto wallets
    const qrDataUrl = await QRCode.toDataURL(invoice.paymentUri || invoice.address, {
      margin: 1,
      width: 280,
    });
    return res.json({ qrDataUrl });
  } catch (error) {
    return next(error);
  }
});

// 3. Fast verification when customer or MetaMask broadcasts a txid
const verifyTxSchema = z.object({
  txid: z.string().regex(/^0x[a-fA-F0-9]{64}$/, 'Invalid Ethereum/BSC transaction hash'),
});

router.post('/invoices/:id/verify-tx', async (req, res) => {
  try {
    const { txid } = verifyTxSchema.parse(req.body);
    const updated = await verifyTxidForInvoice(req.params.id, txid);
    return res.json(publicInvoice(updated));
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

// 4. Update customer email for invoice receipt (supports both /customer-email and /customer)
const customerEmailSchema = z.object({
  email: z.string().email('Please provide a valid email address'),
  name: z.string().optional(),
});

const handleCustomerEmailUpdate = async (req, res) => {
  try {
    const { email, name } = customerEmailSchema.parse(req.body);
    const updated = await updateInvoiceCustomerEmail(req.params.id, email, name);
    return res.json({ success: true, invoice: publicInvoice(updated) });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
};

router.post('/invoices/:id/customer-email', handleCustomerEmailUpdate);
router.post('/invoices/:id/customer', handleCustomerEmailUpdate);

// 5. Payment Link details
router.get('/payment-links/:code', async (req, res, next) => {
  try {
    const link = await getPaymentLinkByCode(req.params.code);
    if (!link) return res.status(404).json({ error: 'Payment link not found' });
    return res.json(link);
  } catch (error) {
    return next(error);
  }
});

// 5. Checkout from Payment Link (POST - API JSON response)
router.post('/payment-links/:code/checkout', async (req, res, next) => {
  try {
    const link = await getPaymentLinkByCode(req.params.code);
    if (!link) return res.status(404).json({ error: 'Payment link not found' });

    const invoice = await createInvoice({
      currency: link.currency,
      amount: link.amount,
      merchantId: link.merchant_id || null,
      walletId: link.wallet_id || 'default',
      description: link.title,
      orderId: `LINK-${link.code}`,
      metadata: { paymentLinkCode: link.code, title: link.title },
    });
    return res.json(invoice);
  } catch (error) {
    return next(error);
  }
});

// 6. Checkout from Payment Link (GET - browser direct redirect)
router.get('/payment-links/:code/checkout', async (req, res, next) => {
  try {
    const link = await getPaymentLinkByCode(req.params.code);
    if (!link) return res.status(404).redirect('/pay?error=link_not_found');

    const invoice = await createInvoice({
      currency: link.currency,
      amount: link.amount,
      merchantId: link.merchant_id || null,
      walletId: link.wallet_id || 'default',
      description: link.title,
      orderId: `LINK-${link.code}`,
      metadata: { paymentLinkCode: link.code, title: link.title },
    });
    return res.redirect(`/pay?invoice=${invoice.id}`);
  } catch (error) {
    return next(error);
  }
});


export default router;

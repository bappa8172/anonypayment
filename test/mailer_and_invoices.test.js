import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.env.SQLITE_DB_PATH = path.join(__dirname, '..', 'data', 'test_gateway.db');

import { initDb, query } from '../src/db.js';
import { initEVM } from '../src/evm.js';
import { registerMerchant } from '../src/auth.js';
import {
  createInvoice,
  getInvoice,
  recordEvmPayment,
  updateInvoiceCustomerEmail,
  publicInvoice,
} from '../src/invoices.js';
import {
  initMailer,
  sendEmail,
  getEmailLogs,
  notifyPaymentReceived,
  notifyInvoiceCreated,
} from '../src/mailer.js';
import { getWalletBalances } from '../src/wallet.js';

test('Email & Invoices: 1. Mailer initializes in simulation/preview mode and records audit logs', async () => {
  await initDb();
  await initEVM();
  initMailer();

  const testRecipient = `customer_${Date.now()}@example.com`;
  const result = await sendEmail({
    to: testRecipient,
    subject: 'Test Payment Gateway Notification',
    html: '<p>Testing email dispatch</p>',
    recipientType: 'customer',
    template: 'test_notification',
  });

  assert.equal(result.success, true);
  assert.equal(result.status, 'simulated');
  assert.ok(result.logId);

  // Check audit trail
  const logs = await getEmailLogs({ limit: 10 });
  const found = logs.find(l => l.recipient === testRecipient);
  assert.ok(found);
  assert.equal(found.subject, 'Test Payment Gateway Notification');
  assert.equal(found.template, 'test_notification');
});

test('Email & Invoices: 2. Invoice creation stores customer details and triggers customer notification', async () => {
  const merchantEmail = `owner_${Date.now()}@mystore.io`;
  const { user: merchant } = await registerMerchant({
    email: merchantEmail,
    businessName: 'Apex Electronics',
    password: 'PasswordApex#2026',
  });

  const customerEmail = `shopper_${Date.now()}@gmail.com`;
  const orderId = `ORD-${Date.now()}`;
  const description = '1x Smart Hardware Wallet';

  const invoice = await createInvoice({
    currency: 'BNB_BSC',
    amount: '0.05',
    customerEmail,
    customerName: 'Satoshi Nakamoto',
    orderId,
    description,
    merchantId: merchant.id,
    walletId: merchant.walletId,
  });

  assert.ok(invoice.id);
  assert.equal(invoice.customerEmail, customerEmail);
  assert.equal(invoice.customerName, 'Satoshi Nakamoto');
  assert.equal(invoice.orderId, orderId);
  assert.equal(invoice.description, description);
  assert.equal(invoice.merchantId, merchant.id);

  // Verify in DB
  const rawInvoice = await getInvoice(invoice.id);
  assert.equal(rawInvoice.customer_email, customerEmail);
  assert.equal(rawInvoice.order_id, orderId);
  assert.equal(rawInvoice.description, description);

  // Verify public representation exposes these fields for checkout
  const pub = publicInvoice(rawInvoice);
  assert.equal(pub.customerEmail, customerEmail);
  assert.equal(pub.orderId, orderId);
  assert.equal(pub.description, description);

  // Allow async email dispatch to record
  await new Promise(r => setTimeout(r, 200));

  const emailLogs = await getEmailLogs({ invoiceId: invoice.id });
  const invoiceCreatedMail = emailLogs.find(e => e.recipient === customerEmail && e.template === 'invoice_created');
  assert.ok(invoiceCreatedMail, 'Customer should receive invoice creation email');
});

test('Email & Invoices: 3. Payment settlement triggers automated emails to merchant and customer', async () => {
  const merchantEmail = `biz_${Date.now()}@crypto-shop.com`;
  const { user: merchant } = await registerMerchant({
    email: merchantEmail,
    businessName: 'Crypto Shop Ltd',
    password: 'PasswordShop#2026',
  });

  const customerEmail = `buyer_${Date.now()}@yahoo.com`;
  const orderId = `ORD-SETTLE-${Date.now()}`;

  const invoice = await createInvoice({
    currency: 'BNB_BSC',
    amount: '0.02',
    customerEmail,
    orderId,
    description: 'Cloud Server 1 Month',
    merchantId: merchant.id,
    walletId: merchant.walletId,
  });

  const rawInvoice = await getInvoice(invoice.id);
  const txid = `0x${'a1b2c3d4e5f6'.repeat(5)}1234`;

  // Simulate payment confirmation on blockchain
  const status = await recordEvmPayment(rawInvoice, {
    txid,
    amountUnits: rawInvoice.amount_units,
    confirmations: 12,
    raw: { blockNumber: 38000000, status: 1 },
  });

  assert.equal(status, 'confirmed');

  // Verify merchant isolated wallet balance credited
  const balances = await getWalletBalances(merchant.walletId);
  const bnbBal = balances.find(b => b.currency === 'BNB_BSC');
  assert.ok(bnbBal);
  assert.equal(bnbBal.available, '0.02');

  // Allow async mail dispatch
  await new Promise(r => setTimeout(r, 300));

  // Check email logs for this invoice
  const logs = await getEmailLogs({ invoiceId: invoice.id });

  // 1. Business Owner (Merchant) should receive payment received email
  const merchantMail = logs.find(l => l.recipient === merchantEmail && l.template === 'payment_received_merchant');
  assert.ok(merchantMail, 'Merchant must receive payment received notification');
  assert.ok(merchantMail.subject.includes(orderId) || merchantMail.subject.includes('0.02'));

  // 2. Customer should receive official payment receipt
  const customerMail = logs.find(l => l.recipient === customerEmail && l.template === 'payment_receipt_customer');
  assert.ok(customerMail, 'Customer must receive payment receipt email');
  assert.ok(customerMail.subject.includes('Receipt'));

  // Verify invoice flag receipt_email_sent is set to 1
  const updatedInvoice = await getInvoice(invoice.id);
  assert.equal(updatedInvoice.receipt_email_sent, 1);
});

test('Email & Invoices: 4. Customer entering email at checkout updates invoice and dispatches receipt', async () => {
  // Invoice created without customer email initially
  const invoice = await createInvoice({
    currency: 'BNB_BSC',
    amount: '0.01',
    orderId: 'POS-WALK-IN',
  });

  assert.equal(invoice.customerEmail, null);

  const newCustomerEmail = `payer_at_checkout_${Date.now()}@domain.com`;

  // Customer adds email via public checkout endpoint
  const updated = await updateInvoiceCustomerEmail(invoice.id, newCustomerEmail, 'Jane Doe');
  assert.equal(updated.customer_email, newCustomerEmail);
  assert.equal(updated.customer_name, 'Jane Doe');

  const pub = publicInvoice(updated);
  assert.equal(pub.customerEmail, newCustomerEmail);
});

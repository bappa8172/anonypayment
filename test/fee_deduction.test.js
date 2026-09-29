import test from 'node:test';
import assert from 'node:assert/strict';
import { initDb, query } from '../src/db.js';
import { createInvoice, getInvoice, recordEvmPayment } from '../src/invoices.js';
import { getWalletBalances } from '../src/wallet.js';

test('1% Anonymous Platform Fee Suite: Merchant invoice confirmation distributes 99% net to merchant and 1% fee to superadmin', async () => {
  await initDb();

  const merchantId = `mch_fee_test_${Date.now()}`;
  const merchantWalletId = `wallet_${merchantId}`;
  const superadminWalletId = 'default';

  // 1. Create a 1000 USDT invoice created by merchant
  const invoice = await createInvoice({
    merchantId,
    currency: 'USDT_BSC',
    amount: '1000.00',
    description: 'E-Commerce Order #8812',
    customerEmail: 'buyer@example.com',
  });

  assert.ok(invoice.id);
  assert.equal(invoice.merchant_id, merchantId);
  assert.equal(Number(invoice.amount), 1000);

  // Record initial balances
  const initialAdminBalances = await getWalletBalances(superadminWalletId);
  const initialAdminUsdt = Number(initialAdminBalances.find(b => b.currency === 'USDT_BSC')?.available || '0');

  // 2. Simulate blockchain confirmation
  const txid = `0xfee_test_${Date.now()}`;
  await recordEvmPayment(invoice, {
    txid,
    amountUnits: invoice.amount_units, // 1000 * 10^18
    confirmations: 12, // >= confirmations_required (12)
    raw: { status: 'success' },
  });

  // 3. Verify invoice record has fee breakdown persisted
  const updatedInvoice = await getInvoice(invoice.id);
  assert.equal(updatedInvoice.status, 'confirmed');
  assert.equal(Number(updatedInvoice.fee_amount), 10); // 1% of 1000 is 10
  assert.equal(Number(updatedInvoice.net_amount), 990); // 99% of 1000 is 990

  // 4. Verify Merchant isolated wallet received 99% net
  const merchantBalances = await getWalletBalances(merchantWalletId);
  const merchantUsdt = merchantBalances.find(b => b.currency === 'USDT_BSC');
  assert.ok(merchantUsdt, 'Merchant wallet should have USDT balance');
  assert.equal(Number(merchantUsdt.available), 990);

  // 5. Verify Super Admin wallet received 1% fee
  const adminBalances = await getWalletBalances(superadminWalletId);
  const adminUsdt = Number(adminBalances.find(b => b.currency === 'USDT_BSC')?.available || '0');
  assert.ok(Math.abs((adminUsdt - initialAdminUsdt) - 10) < 0.0001);

  // 6. Verify Anonymity in Ledger entries
  const adminLedger = await query(
    `SELECT * FROM ledger WHERE wallet_id = $1 AND txid = $2`,
    [superadminWalletId, txid]
  );
  assert.equal(adminLedger.rows.length, 1);
  const feeEntry = adminLedger.rows[0];
  assert.equal(feeEntry.type, 'PLATFORM_FEE');
  // Check that no merchant personal information is in the ledger note
  assert.ok(feeEntry.note.includes(`Platform fee (1%) for settlement #${invoice.id.slice(0, 8)}`));
  assert.ok(!feeEntry.note.includes(merchantId));
  assert.ok(!feeEntry.note.includes('buyer@example.com'));
});

test('1% Anonymous Platform Fee Suite: TRON (USDT TRC-20) 6-decimal fee calculation', async () => {
  await initDb();

  const merchantId = `mch_tron_test_${Date.now()}`;
  const merchantWalletId = `wallet_${merchantId}`;

  const invoice = await createInvoice({
    merchantId,
    currency: 'USDT_TRC20',
    amount: '500.00',
    description: 'TRC-20 Invoice',
  });

  const txid = `tron_fee_test_${Date.now()}`;
  await recordEvmPayment(invoice, {
    txid,
    amountUnits: invoice.amount_units, // 500 * 10^6 = 500000000
    confirmations: 19,
    raw: { status: 'success' },
  });

  const updatedInvoice = await getInvoice(invoice.id);
  assert.equal(updatedInvoice.status, 'confirmed');
  assert.equal(Number(updatedInvoice.fee_amount), 5); // 1% of 500 is 5
  assert.equal(Number(updatedInvoice.net_amount), 495); // 99% of 500 is 495

  const merchantBalances = await getWalletBalances(merchantWalletId);
  const merchantUsdt = merchantBalances.find(b => b.currency === 'USDT_TRC20');
  assert.equal(Number(merchantUsdt.available), 495);
});

test('1% Anonymous Platform Fee Suite: Bitcoin (BTC) 8-decimal Satoshi fee calculation', async () => {
  await initDb();

  const merchantId = `mch_btc_test_${Date.now()}`;
  const merchantWalletId = `wallet_${merchantId}`;

  const invoice = await createInvoice({
    merchantId,
    currency: 'BTC',
    amount: '1.00000000', // 1 BTC = 100,000,000 Satoshis
    description: 'BTC Invoice',
  });

  const txid = `btc_fee_test_${Date.now()}`;
  await recordEvmPayment(invoice, {
    txid,
    amountUnits: invoice.amount_units,
    confirmations: 1,
    raw: { status: 'success' },
  });

  const updatedInvoice = await getInvoice(invoice.id);
  assert.equal(updatedInvoice.status, 'confirmed');
  assert.equal(Number(updatedInvoice.fee_amount), 0.01); // 1% of 1 BTC is 0.01 BTC (1,000,000 sats)
  assert.equal(Number(updatedInvoice.net_amount), 0.99); // 99% of 1 BTC is 0.99 BTC (99,000,000 sats)

  const merchantBalances = await getWalletBalances(merchantWalletId);
  const merchantBtc = merchantBalances.find(b => b.currency === 'BTC');
  assert.equal(Number(merchantBtc.available), 0.99);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.env.SQLITE_DB_PATH = path.join(__dirname, '..', 'data', 'test_gateway.db');

import { getAsset, getAllAssets } from '../src/assets.js';
import { initDb, query, getDbType } from '../src/db.js';
import { initEVM, deriveAddress } from '../src/evm.js';
import { createInvoice, getInvoice, createPaymentLink, getPaymentLinkByCode } from '../src/invoices.js';
import {
  getWalletBalances,
  creditWalletBalance,
  debitWalletBalance,
  transferInternal,
  getLedgerHistory,
  getWalletDepositAddress,
} from '../src/wallet.js';

test('1. Multi-asset registry contains supported assets', () => {
  const assets = getAllAssets();
  assert.ok(assets.length >= 4);

  const bnb = getAsset('BNB_BSC');
  assert.equal(bnb.symbol, 'BNB');
  assert.equal(bnb.isNative, true);
  assert.equal(bnb.decimals, 18);

  const usdtBsc = getAsset('USDT_BSC');
  assert.equal(usdtBsc.symbol, 'USDT');
  assert.equal(usdtBsc.isNative, false);

  const sepoliaEth = getAsset('ETH_SEPOLIA');
  assert.equal(sepoliaEth.chain, 'sepolia');
  assert.equal(sepoliaEth.isNative, true);
});

test('2. Dual-mode Database initializes SQLite and executes queries', async () => {
  await initDb();
  assert.ok(['sqlite', 'postgres'].includes(getDbType()));

  const res = await query('SELECT * FROM wallets WHERE id = $1', ['default']);
  assert.equal(res.rows.length, 1);
  assert.equal(res.rows[0].id, 'default');
});

test('3. EVM HD Wallet initializes and derives authentic on-chain addresses', async () => {
  const ok = await initEVM();
  assert.equal(ok, true);

  const addr0 = deriveAddress(0);
  const addr1 = deriveAddress(1);

  assert.match(addr0, /^0x[a-fA-F0-9]{40}$/);
  assert.match(addr1, /^0x[a-fA-F0-9]{40}$/);
  assert.notEqual(addr0, addr1);
});

test('4. Invoices create properly with unique derived deposit addresses', async () => {
  const invBnb = await createInvoice({
    currency: 'BNB_BSC',
    amount: '0.1',
    expiresInMinutes: 30,
  });

  assert.ok(invBnb.id);
  assert.equal(invBnb.amount, '0.1');
  assert.equal(invBnb.currency, 'BNB_BSC');
  assert.match(invBnb.address, /^0x[a-fA-F0-9]{40}$/);

  const fetched = await getInvoice(invBnb.id);
  assert.equal(fetched.id, invBnb.id);
  assert.equal(fetched.status, 'pending');

  const invUsdt = await createInvoice({
    currency: 'USDT_BSC',
    amount: '25.50',
    expiresInMinutes: 45,
  });
  assert.equal(invUsdt.currency, 'USDT_BSC');
  assert.notEqual(invUsdt.address, invBnb.address);
});

test('5. Wallet accounting: credits, debits, balances, and ledger', async () => {
  const testWalletId = 'test_user_wallet_' + Date.now();

  // Initial balance is 0
  const initialBalances = await getWalletBalances(testWalletId);
  const bnbInitial = initialBalances.find(b => b.currency === 'BNB_BSC');
  assert.equal(bnbInitial.available, '0.0');

  // Credit 1.5 BNB (1500000000000000000 units)
  const creditUnits = '1500000000000000000';
  await creditWalletBalance(testWalletId, 'BNB_BSC', creditUnits, 'DEPOSIT', '0xabc123', 'Test on-chain deposit');

  const afterCredit = await getWalletBalances(testWalletId);
  const bnbAfter = afterCredit.find(b => b.currency === 'BNB_BSC');
  assert.equal(bnbAfter.available, '1.5');

  // Debit 0.5 BNB (500000000000000000 units)
  const debitUnits = '500000000000000000';
  await debitWalletBalance(testWalletId, 'BNB_BSC', debitUnits, 'WITHDRAWAL', '0xdef456', '0x999...', 'Payout test');

  const afterDebit = await getWalletBalances(testWalletId);
  const bnbFinal = afterDebit.find(b => b.currency === 'BNB_BSC');
  assert.equal(bnbFinal.available, '1.0');

  // Check ledger audit trail
  const ledger = await getLedgerHistory(testWalletId);
  assert.ok(ledger.length >= 2);
  assert.equal(ledger[0].type, 'WITHDRAWAL');
  assert.equal(ledger[1].type, 'DEPOSIT');
});

test('6. Internal wallet transfers (instant 0-gas settlement)', async () => {
  const walletA = 'wallet_alice_' + Date.now();
  const walletB = 'wallet_bob_' + Date.now();

  // Credit Alice with 50 USDT
  const fiftyUsdtUnits = '50000000000000000000';
  await creditWalletBalance(walletA, 'USDT_BSC', fiftyUsdtUnits, 'DEPOSIT', null, 'Initial funds');

  // Transfer 20 USDT from Alice to Bob
  const res = await transferInternal({
    fromWalletId: walletA,
    toWalletId: walletB,
    currency: 'USDT_BSC',
    amount: '20.0',
    note: 'Peer payment',
  });

  assert.equal(res.success, true);
  assert.equal(res.amount, '20.0');

  const aliceBalances = await getWalletBalances(walletA);
  const aliceUsdt = aliceBalances.find(b => b.currency === 'USDT_BSC');
  assert.equal(aliceUsdt.available, '30.0');

  const bobBalances = await getWalletBalances(walletB);
  const bobUsdt = bobBalances.find(b => b.currency === 'USDT_BSC');
  assert.equal(bobUsdt.available, '20.0');
});

test('7. Wallet deposit address & QR code generation', async () => {
  const deposit = await getWalletDepositAddress('default', 'BNB_BSC');
  assert.match(deposit.address, /^0x[a-fA-F0-9]{40}$/);
  assert.ok(deposit.qrDataUrl.startsWith('data:image/png;base64,'));
  assert.ok(deposit.explorerAddress.includes(deposit.address));
});

test('8. Payment links create and resolve', async () => {
  const link = await createPaymentLink({
    title: 'Lifetime Membership',
    description: 'Access to premium crypto terminal',
    currency: 'USDT_BSC',
    amount: '99.00',
    redirectUrl: 'https://myshop.com/complete',
  });

  assert.ok(link.code);
  assert.equal(link.title, 'Lifetime Membership');
  assert.equal(link.amount, '99');

  const fetched = await getPaymentLinkByCode(link.code);
  assert.equal(fetched.code, link.code);
  assert.equal(fetched.amount, '99');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { initDb, query } from '../src/db.js';
import { getAsset, getAllAssets } from '../src/assets.js';
import { initTron, deriveTronAddress, isTronAddress } from '../src/tron.js';
import { initBTC, deriveBtcAddress, isBtcAddress } from '../src/btcWallet.js';
import { createInvoice, getInvoice, publicInvoice } from '../src/invoices.js';
import { getWalletDepositAddress, getWalletBalances, creditWalletBalance, debitWalletBalance, transferInternal } from '../src/wallet.js';

test('TRON & BTC Suite: 1. Asset Registry includes USDT_TRC20 and BTC', async () => {
  const trc20 = getAsset('USDT_TRC20');
  assert.equal(trc20.currency, 'USDT_TRC20');
  assert.equal(trc20.symbol, 'USDT');
  assert.equal(trc20.chain, 'tron');
  assert.equal(trc20.decimals, 6);
  assert.equal(trc20.contract, 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t');
  assert.ok(trc20.explorerTx.includes('tronscan.org'));

  const btc = getAsset('BTC');
  assert.equal(btc.currency, 'BTC');
  assert.equal(btc.symbol, 'BTC');
  assert.equal(btc.chain, 'btc');
  assert.equal(btc.decimals, 8);
  assert.equal(btc.isNative, true);
  assert.ok(btc.explorerTx.includes('mempool.space'));

  const all = getAllAssets();
  assert.ok(all.some(a => a.currency === 'USDT_TRC20'));
  assert.ok(all.some(a => a.currency === 'BTC'));
});

test('TRON & BTC Suite: 2. TRON HD Derivation and Address Validation', async () => {
  await initDb();
  await initTron();

  const addr0 = deriveTronAddress(0);
  const addr1 = deriveTronAddress(1);

  assert.ok(addr0.startsWith('T'), 'TRON address must start with T');
  assert.equal(addr0.length, 34, 'TRON address must be 34 characters long');
  assert.ok(isTronAddress(addr0), 'TRON address 0 must be valid Base58Check');

  assert.ok(addr1.startsWith('T'));
  assert.notEqual(addr0, addr1, 'Child addresses must be unique');
  assert.ok(isTronAddress(addr1));

  // Invalid addresses
  assert.equal(isTronAddress('0x55d398326f99059fF775485246999027B3197955'), false);
  assert.equal(isTronAddress('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu'), false);
  assert.equal(isTronAddress('Tinvalidchecksum0000000000000000000'), false);
});

test('TRON & BTC Suite: 3. Bitcoin BIP-84 and BIP-44 Derivation and Validation', async () => {
  await initDb();
  await initBTC();

  const segwit0 = deriveBtcAddress(0, 'segwit');
  const segwit1 = deriveBtcAddress(1, 'segwit');
  const legacy0 = deriveBtcAddress(0, 'legacy');

  assert.ok(segwit0.startsWith('bc1q'), 'BIP-84 SegWit address must start with bc1q');
  assert.ok(isBtcAddress(segwit0), 'BIP-84 address must be valid Bech32');
  assert.notEqual(segwit0, segwit1, 'Child SegWit addresses must be unique');

  assert.ok(legacy0.startsWith('1'), 'BIP-44 Legacy address must start with 1');
  assert.ok(isBtcAddress(legacy0), 'BIP-44 address must be valid Base58Check');

  // Invalid addresses
  assert.equal(isBtcAddress('0x55d398326f99059fF775485246999027B3197955'), false);
  assert.equal(isBtcAddress('TEdHxA6geXSMwZ7tqhbA1w9hPWVJjUdnQC'), false);
  assert.equal(isBtcAddress('bc1qinvalidchecksum99999999999999999999'), false);
});

test('TRON & BTC Suite: 4. Create and retrieve TRC-20 USDT Invoice', async () => {
  await initDb();
  const invoice = await createInvoice({
    currency: 'USDT_TRC20',
    amount: '100.50',
    description: 'Unit test TRC-20 invoice',
    customerEmail: 'tester@tron.org',
  });

  assert.ok(invoice.id);
  assert.equal(invoice.currency, 'USDT_TRC20');
  assert.equal(invoice.symbol, 'USDT');
  assert.equal(invoice.chain, 'tron');
  assert.ok(invoice.address.startsWith('T'));
  assert.ok(isTronAddress(invoice.address));

  const fetched = await getInvoice(invoice.id);
  assert.equal(fetched.id, invoice.id);
  assert.equal(fetched.currency, 'USDT_TRC20');
  assert.equal(fetched.amount, '100.5');
  assert.equal(fetched.amount_units, '100500000'); // 6 decimals

  const pub = publicInvoice(fetched);
  assert.equal(pub.chain, 'tron');
  assert.equal(pub.network, 'TRON Network (TRC-20)');
  assert.equal(pub.paymentUri, `tron:${invoice.address}`);
  assert.equal(pub.confirmationsRequired, 19);
});

test('TRON & BTC Suite: 5. Create and retrieve Bitcoin Native SegWit Invoice', async () => {
  await initDb();
  const invoice = await createInvoice({
    currency: 'BTC',
    amount: '0.054321',
    description: 'Unit test BTC invoice',
    customerEmail: 'satoshi@nakamoto.me',
  });

  assert.ok(invoice.id);
  assert.equal(invoice.currency, 'BTC');
  assert.equal(invoice.symbol, 'BTC');
  assert.equal(invoice.chain, 'btc');
  assert.ok(invoice.address.startsWith('bc1q'));
  assert.ok(isBtcAddress(invoice.address));

  const fetched = await getInvoice(invoice.id);
  assert.equal(fetched.id, invoice.id);
  assert.equal(fetched.currency, 'BTC');
  assert.equal(fetched.amount, '0.054321');
  assert.equal(fetched.amount_units, '5432100'); // 8 decimals (Satoshis)

  const pub = publicInvoice(fetched);
  assert.equal(pub.chain, 'btc');
  assert.equal(pub.network, 'Bitcoin Network');
  assert.equal(pub.paymentUri, `bitcoin:${invoice.address}?amount=0.054321`);
  assert.equal(pub.confirmationsRequired, 1);
});

test('TRON & BTC Suite: 6. Multi-chain Wallet Deposit Addresses & Balances', async () => {
  await initDb();
  const walletId = `test_wallet_${Date.now()}`;

  const tronDep = await getWalletDepositAddress(walletId, 'USDT_TRC20');
  assert.equal(tronDep.currency, 'USDT_TRC20');
  assert.equal(tronDep.chain, 'tron');
  assert.ok(tronDep.address.startsWith('T'));
  assert.ok(tronDep.qrDataUrl.startsWith('data:image/png;base64,'));

  const btcDep = await getWalletDepositAddress(walletId, 'BTC');
  assert.equal(btcDep.currency, 'BTC');
  assert.equal(btcDep.chain, 'btc');
  assert.ok(btcDep.address.startsWith('bc1q'));
  assert.ok(btcDep.qrDataUrl.startsWith('data:image/png;base64,'));

  // Balances
  await creditWalletBalance(walletId, 'USDT_TRC20', '25000000', 'DEPOSIT', null, 'Test TRC20 Credit'); // 25 USDT
  await creditWalletBalance(walletId, 'BTC', '100000', 'DEPOSIT', null, 'Test BTC Credit'); // 0.001 BTC

  const balances = await getWalletBalances(walletId);
  const tronBal = balances.find(b => b.currency === 'USDT_TRC20');
  const btcBal = balances.find(b => b.currency === 'BTC');

  assert.equal(tronBal.available, '25.0');
  assert.equal(btcBal.available, '0.001');

  // Internal transfer test
  const peerWalletId = `peer_wallet_${Date.now()}`;
  await transferInternal({
    fromWalletId: walletId,
    toWalletId: peerWalletId,
    currency: 'USDT_TRC20',
    amount: '10.0',
  });

  const senderBalances = await getWalletBalances(walletId);
  const peerBalances = await getWalletBalances(peerWalletId);

  assert.equal(senderBalances.find(b => b.currency === 'USDT_TRC20').available, '15.0');
  assert.equal(peerBalances.find(b => b.currency === 'USDT_TRC20').available, '10.0');
});

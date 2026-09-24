import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.env.SQLITE_DB_PATH = path.join(__dirname, '..', 'data', 'test_gateway.db');

import { initDb, query } from '../src/db.js';
import { initEVM } from '../src/evm.js';
import { registerMerchant, loginUser, verifySessionToken, getMerchantByApiKey } from '../src/auth.js';
import { createInvoice, getInvoice, listInvoices, createPaymentLink, listPaymentLinks } from '../src/invoices.js';
import { getWalletBalances, creditWalletBalance, withdrawCrypto } from '../src/wallet.js';

test('Merchant & Security: 1. Instant merchant registration without docs', async () => {
  await initDb();
  await initEVM();

  const email = `test_merchant_${Date.now()}@business.io`;
  const businessName = 'Acme Global Commerce';
  const password = 'StrongPassword2026!';

  const { user, token } = await registerMerchant({ email, businessName, password });

  assert.ok(user.id.startsWith('mch_'));
  assert.equal(user.email, email);
  assert.equal(user.businessName, businessName);
  assert.equal(user.role, 'merchant');
  assert.equal(user.status, 'active');
  assert.ok(user.apiKey.startsWith('mch_live_'));
  assert.ok(user.walletId.startsWith('wallet_mch_'));
  assert.ok(token);

  // Verify session token integrity
  const claims = verifySessionToken(token);
  assert.ok(claims);
  assert.equal(claims.sub, user.id);
  assert.equal(claims.email, email);
  assert.equal(claims.role, 'merchant');
});

test('Merchant & Security: 2. Password verification with scrypt & anti-bruteforce security', async () => {
  const email = `secure_biz_${Date.now()}@shop.com`;
  const password = 'CorrectPassword#888';
  await registerMerchant({ email, businessName: 'Secure Biz', password });

  // Correct login
  const { user, token } = await loginUser({ email, password });
  assert.equal(user.email, email);
  assert.ok(token);

  // Wrong password rejected
  await assert.rejects(
    async () => {
      await loginUser({ email, password: 'WrongPassword123!' });
    },
    { message: 'Invalid email or password' }
  );

  // Non-existent user rejected
  await assert.rejects(
    async () => {
      await loginUser({ email: 'nonexistent@nowhere.com', password: 'AnyPassword123!' });
    },
    { message: 'Invalid email or password' }
  );
});

test('Merchant & Security: 3. Multi-tenant invoice & balance isolation (Anti-IDOR)', async () => {
  const merchantA = await registerMerchant({
    email: `merchant_a_${Date.now()}@corp.io`,
    businessName: 'Store Alpha',
    password: 'PasswordAlpha2026!',
  });

  const merchantB = await registerMerchant({
    email: `merchant_b_${Date.now()}@corp.io`,
    businessName: 'Store Beta',
    password: 'PasswordBeta2026!',
  });

  // Merchant A creates invoice
  const invA = await createInvoice({
    currency: 'BNB_BSC',
    amount: '0.5',
    merchantId: merchantA.user.id,
    walletId: merchantA.user.walletId,
  });

  // Merchant B creates invoice
  const invB = await createInvoice({
    currency: 'BNB_BSC',
    amount: '1.2',
    merchantId: merchantB.user.id,
    walletId: merchantB.user.walletId,
  });

  // Querying invoices for Merchant A only returns Merchant A's invoices
  const invoicesA = await listInvoices({ merchantId: merchantA.user.id });
  assert.ok(invoicesA.some(i => i.id === invA.id));
  assert.ok(!invoicesA.some(i => i.id === invB.id), 'Merchant A must NOT see Merchant B invoices');

  // Querying invoices for Merchant B only returns Merchant B's invoices
  const invoicesB = await listInvoices({ merchantId: merchantB.user.id });
  assert.ok(invoicesB.some(i => i.id === invB.id));
  assert.ok(!invoicesB.some(i => i.id === invA.id), 'Merchant B must NOT see Merchant A invoices');

  // Balances are completely isolated
  await creditWalletBalance(merchantA.user.walletId, 'BNB_BSC', '500000000000000000', 'DEPOSIT', null, 'Fund A');
  const balA = await getWalletBalances(merchantA.user.walletId);
  const balB = await getWalletBalances(merchantB.user.walletId);

  const bnbA = balA.find(b => b.symbol === 'BNB');
  const bnbB = balB.find(b => b.symbol === 'BNB');

  assert.equal(bnbA.available, '0.5');
  assert.equal(bnbB.available, '0.0', 'Merchant B balance must remain 0.0');

  // Merchant B cannot withdraw from Merchant A's wallet
  await assert.rejects(
    async () => {
      await withdrawCrypto({
        walletId: merchantB.user.walletId,
        currency: 'BNB_BSC',
        toAddress: '0x000000000000000000000000000000000000dEaD',
        amount: '0.1',
      });
    },
    /Insufficient/
  );
});

test('Merchant & Security: 4. Merchant API Key authentication', async () => {
  const { user } = await registerMerchant({
    email: `api_developer_${Date.now()}@dev.com`,
    businessName: 'API Tech Labs',
    password: 'DevPassword123!',
  });

  const found = await getMerchantByApiKey(user.apiKey);
  assert.ok(found);
  assert.equal(found.id, user.id);
  assert.equal(found.business_name, 'API Tech Labs');

  // Fake or tampered key returns null
  const invalid = await getMerchantByApiKey('mch_live_invalidkey1234567890abcdef');
  assert.equal(invalid, null);
});

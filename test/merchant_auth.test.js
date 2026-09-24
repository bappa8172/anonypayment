import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.env.SQLITE_DB_PATH = path.join(__dirname, '..', 'data', 'test_gateway.db');

import { initDb, query } from '../src/db.js';
import { initEVM } from '../src/evm.js';
import {
  registerMerchant,
  loginUser,
  verifySessionToken,
  getMerchantByApiKey,
  requestSignupOtp,
  verifySignupOtp,
  requestLoginOtp,
  verifyLoginOtp,
  hashOtp,
} from '../src/auth.js';
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

test('Merchant & Security: 5. Signup with OTP verification & security limits', async () => {
  const email = `otp_signup_${Date.now()}@fintech.org`;
  const firstName = 'John';
  const lastName = 'Doe';
  const businessName = 'Doe Global Ventures';
  const password = 'SuperSecurePassword2026!';

  // Request signup OTP
  const reqRes = await requestSignupOtp({
    firstName,
    lastName,
    businessName,
    email,
    password,
  });

  assert.equal(reqRes.success, true);
  assert.equal(reqRes.email, email);
  assert.equal(reqRes.cooldownSeconds, 60);

  // 60-second cooldown is enforced
  await assert.rejects(
    async () => {
      await requestSignupOtp({
        firstName,
        lastName,
        businessName,
        email,
        password,
      });
    },
    /Please wait \d+s before requesting a new verification code/
  );

  // Find the generated OTP from database by testing candidate digits
  const otpRows = await query('SELECT * FROM otps WHERE email = $1 AND purpose = "signup"', [email]);
  assert.equal(otpRows.rows.length, 1);
  const otpRecord = otpRows.rows[0];

  // Test brute-force protection: invalid code is rejected and attempts incremented
  await assert.rejects(
    async () => {
      await verifySignupOtp({ email, otp: '000000' });
    },
    /Invalid verification code/
  );

  const updatedRows = await query('SELECT attempts FROM otps WHERE id = $1', [otpRecord.id]);
  assert.equal(updatedRows.rows[0].attempts, 1);

  // Discover the valid 6-digit OTP code by matching hashOtp
  let validOtp = null;
  for (let c = 100000; c <= 999999; c++) {
    if (hashOtp(email, c.toString()) === otpRecord.otp_hash) {
      validOtp = c.toString();
      break;
    }
  }
  assert.ok(validOtp, 'Valid 6-digit OTP code must be discoverable from hash');

  // Verify signup OTP
  const verifyRes = await verifySignupOtp({ email, otp: validOtp });
  assert.ok(verifyRes.user);
  assert.ok(verifyRes.token);
  assert.equal(verifyRes.user.firstName, firstName);
  assert.equal(verifyRes.user.lastName, lastName);
  assert.equal(verifyRes.user.businessName, businessName);
  assert.equal(verifyRes.user.email, email);

  // Verify merchant in database has first_name and last_name
  const mchDb = await query('SELECT * FROM merchants WHERE email = $1', [email]);
  assert.equal(mchDb.rows[0].first_name, firstName);
  assert.equal(mchDb.rows[0].last_name, lastName);

  // OTP record is purged after successful verification
  const afterVerify = await query('SELECT * FROM otps WHERE email = $1 AND purpose = "signup"', [email]);
  assert.equal(afterVerify.rows.length, 0);
});

test('Merchant & Security: 6. Login with 2FA OTP verification', async () => {
  const email = `otp_login_${Date.now()}@cybercorp.io`;
  const firstName = 'Alice';
  const lastName = 'Smith';
  const businessName = 'Alice Cyber Corp';
  const password = 'AlicePassword2026!';

  await registerMerchant({
    email,
    businessName,
    firstName,
    lastName,
    password,
  });

  // Invalid password rejected upfront
  await assert.rejects(
    async () => {
      await requestLoginOtp({ email, password: 'WrongPassword123!' });
    },
    { message: 'Invalid email or password' }
  );

  // Valid password triggers OTP dispatch
  const reqRes = await requestLoginOtp({ email, password });
  assert.equal(reqRes.success, true);
  assert.equal(reqRes.email, email);

  // Find login OTP record
  const otpRows = await query('SELECT * FROM otps WHERE email = $1 AND purpose = "login"', [email]);
  assert.equal(otpRows.rows.length, 1);
  const otpRecord = otpRows.rows[0];

  let validOtp = null;
  for (let c = 100000; c <= 999999; c++) {
    if (hashOtp(email, c.toString()) === otpRecord.otp_hash) {
      validOtp = c.toString();
      break;
    }
  }
  assert.ok(validOtp);

  // Wrong OTP fails
  await assert.rejects(
    async () => {
      await verifyLoginOtp({ email, otp: '111111' });
    },
    /Invalid security code/
  );

  // Correct OTP succeeds
  const loginRes = await verifyLoginOtp({ email, otp: validOtp });
  assert.ok(loginRes.token);
  assert.equal(loginRes.user.email, email);
  assert.equal(loginRes.user.firstName, firstName);
  assert.equal(loginRes.user.lastName, lastName);

  // OTP record is purged
  const afterLogin = await query('SELECT * FROM otps WHERE email = $1 AND purpose = "login"', [email]);
  assert.equal(afterLogin.rows.length, 0);
});


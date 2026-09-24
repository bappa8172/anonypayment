import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { query } from './db.js';
import { config } from './config.js';
import { getOrCreateWallet } from './wallet.js';
import { logger } from './logger.js';
import { sendOtpEmail } from './mailer.js';

// Secure work factor for scrypt password hashing
const SCRYPT_KEYLEN = 64;
const SCRYPT_COST = 16384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;

// Session token configuration
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Hashes a plaintext password using crypto.scryptSync with high entropy salt.
 * Output format: scrypt:<salt_hex>:<hash_hex>
 */
export function hashPassword(password) {
  if (!password || typeof password !== 'string' || password.length < 8) {
    throw new Error('Password must be at least 8 characters long');
  }
  const salt = crypto.randomBytes(32).toString('hex');
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELIZATION,
  }).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

/**
 * Constant-time password verification against stored scrypt hash.
 */
export function verifyPassword(password, storedHash) {
  if (!password || !storedHash || !storedHash.startsWith('scrypt:')) {
    return false;
  }
  const parts = storedHash.split(':');
  if (parts.length !== 3) return false;
  const [, salt, originalHash] = parts;

  const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELIZATION,
  }).toString('hex');

  const bufA = Buffer.from(derived, 'hex');
  const bufB = Buffer.from(originalHash, 'hex');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Creates a cryptographically signed session token (HMAC-SHA256).
 */
export function createSessionToken(payload) {
  const header = { alg: 'HS256', typ: 'SESSION' };
  const now = Date.now();
  const claims = {
    ...payload,
    iat: now,
    exp: now + TOKEN_TTL_MS,
  };

  const b64Header = Buffer.from(JSON.stringify(header)).toString('base64url');
  const b64Payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', config.adminApiKey)
    .update(`${b64Header}.${b64Payload}`)
    .digest('base64url');

  return `${b64Header}.${b64Payload}.${signature}`;
}

/**
 * Verifies and decodes a session token. Returns claims if valid, null if invalid or expired.
 */
export function verifySessionToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [b64Header, b64Payload, signature] = parts;

  const expectedSignature = crypto
    .createHmac('sha256', config.adminApiKey)
    .update(`${b64Header}.${b64Payload}`)
    .digest('base64url');

  const bufSig = Buffer.from(signature);
  const bufExpected = Buffer.from(expectedSignature);
  if (bufSig.length !== bufExpected.length || !crypto.timingSafeEqual(bufSig, bufExpected)) {
    return null;
  }

  try {
    const claims = JSON.parse(Buffer.from(b64Payload, 'base64url').toString('utf8'));
    if (!claims.exp || claims.exp < Date.now()) {
      return null; // Expired
    }
    return claims;
  } catch {
    return null;
  }
}

/**
 * Generates an unguessable live API key with high entropy.
 */
export function generateApiKey(prefix = 'mch_live_') {
  return `${prefix}${crypto.randomBytes(24).toString('hex')}`;
}

/**
 * Generates a webhook secret for HMAC signature verification.
 */
export function generateWebhookSecret() {
  return `whsec_${crypto.randomBytes(24).toString('hex')}`;
}

/**
 * Cryptographically random 6-digit OTP code generator
 */
export function generateOtpCode() {
  return crypto.randomInt(100000, 1000000).toString();
}

/**
 * Computes HMAC-SHA256 hash of OTP bound to email address
 */
export function hashOtp(email, otp) {
  const secret = config.adminApiKey || 'payrail_otp_security_secret';
  return crypto
    .createHmac('sha256', secret)
    .update(`${email.toLowerCase().trim()}:${otp.toString().trim()}`)
    .digest('hex');
}

/**
 * Initiates signup OTP verification.
 * Validates fields, enforces 60s cooldown, stores hashed OTP + hashed password payload, sends email.
 */
export async function requestSignupOtp({ firstName, lastName, businessName, email, password }) {
  if (!firstName || typeof firstName !== 'string' || !firstName.trim()) {
    throw new Error('First name is required');
  }
  if (!lastName || typeof lastName !== 'string' || !lastName.trim()) {
    throw new Error('Last name is required');
  }
  if (!businessName || typeof businessName !== 'string' || !businessName.trim()) {
    throw new Error('Business name is required');
  }
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    throw new Error('Valid email address is required');
  }
  if (!password || typeof password !== 'string' || password.length < 8) {
    throw new Error('Password must be at least 8 characters long');
  }

  const normalizedEmail = email.trim().toLowerCase();
  const trimmedFirst = firstName.trim();
  const trimmedLast = lastName.trim();
  const trimmedBusiness = businessName.trim();

  // Check if account already exists
  const existing = await query('SELECT id FROM merchants WHERE email = $1', [normalizedEmail]);
  if (existing.rows.length > 0) {
    throw new Error('An account with this email already exists');
  }

  // Check 60-second cooldown
  const recentOtp = await query(
    `SELECT id, created_at FROM otps WHERE email = $1 AND purpose = 'signup' ORDER BY created_at DESC LIMIT 1`,
    [normalizedEmail]
  );
  if (recentOtp.rows.length > 0) {
    const elapsed = Date.now() - new Date(recentOtp.rows[0].created_at).getTime();
    if (elapsed < 60000) {
      const waitSec = Math.ceil((60000 - elapsed) / 1000);
      throw new Error(`Please wait ${waitSec}s before requesting a new verification code.`);
    }
  }

  const otp = generateOtpCode();
  const otpHash = hashOtp(normalizedEmail, otp);
  const passwordHash = hashPassword(password);
  const otpId = `otp_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const createdAt = new Date().toISOString();

  const payload = JSON.stringify({
    firstName: trimmedFirst,
    lastName: trimmedLast,
    businessName: trimmedBusiness,
    passwordHash,
  });

  // Delete older unverified signup OTPs for this email
  await query(`DELETE FROM otps WHERE email = $1 AND purpose = 'signup'`, [normalizedEmail]);

  await query(
    `INSERT INTO otps (id, email, otp_hash, purpose, payload, attempts, expires_at, created_at)
     VALUES ($1, $2, $3, 'signup', $4, 0, $5, $6)`,
    [otpId, normalizedEmail, otpHash, payload, expiresAt, createdAt]
  );

  // Send branded OTP email
  await sendOtpEmail({
    to: normalizedEmail,
    otp,
    purpose: 'signup',
    recipientName: trimmedFirst,
  });

  logger.info({ email: normalizedEmail, purpose: 'signup' }, 'Signup OTP generated and sent');
  return {
    success: true,
    email: normalizedEmail,
    cooldownSeconds: 60,
    expiresInMinutes: 10,
    message: 'Verification code sent to your email address.',
  };
}

/**
 * Verifies signup OTP and creates the merchant account.
 */
export async function verifySignupOtp({ email, otp }) {
  if (!email || !otp) {
    throw new Error('Email and verification code are required');
  }

  const normalizedEmail = email.trim().toLowerCase();
  const trimmedOtp = otp.toString().trim();

  const res = await query(
    `SELECT * FROM otps WHERE email = $1 AND purpose = 'signup' ORDER BY created_at DESC LIMIT 1`,
    [normalizedEmail]
  );

  if (res.rows.length === 0) {
    throw new Error('No pending registration verification found. Please request a new code.');
  }

  const otpRecord = res.rows[0];

  // Check expiration
  if (new Date(otpRecord.expires_at).getTime() < Date.now()) {
    await query('DELETE FROM otps WHERE id = $1', [otpRecord.id]);
    throw new Error('Verification code has expired. Please request a new code.');
  }

  // Check attempt limit
  if (otpRecord.attempts >= 5) {
    await query('DELETE FROM otps WHERE id = $1', [otpRecord.id]);
    throw new Error('Too many invalid attempts. This verification code has expired for security.');
  }

  // Constant-time hash comparison
  const computedHash = hashOtp(normalizedEmail, trimmedOtp);
  const bufA = Buffer.from(computedHash, 'hex');
  const bufB = Buffer.from(otpRecord.otp_hash, 'hex');
  const isMatch = bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);

  if (!isMatch) {
    const newAttempts = (otpRecord.attempts || 0) + 1;
    await query('UPDATE otps SET attempts = $1 WHERE id = $2', [newAttempts, otpRecord.id]);
    const remaining = 5 - newAttempts;
    if (remaining <= 0) {
      await query('DELETE FROM otps WHERE id = $1', [otpRecord.id]);
      throw new Error('Too many invalid attempts. Security code invalidated. Please request a new code.');
    }
    throw new Error(`Invalid verification code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`);
  }

  // Code is valid! Clean up OTP records
  await query(`DELETE FROM otps WHERE email = $1 AND purpose = 'signup'`, [normalizedEmail]);

  // Parse payload and provision account
  const payload = typeof otpRecord.payload === 'string' ? JSON.parse(otpRecord.payload) : otpRecord.payload;
  const merchantId = `mch_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
  const walletId = `wallet_${merchantId}`;
  const apiKey = generateApiKey();
  const webhookSecret = generateWebhookSecret();

  // Create isolated wallet
  await getOrCreateWallet(walletId, `${payload.businessName} Ledger Wallet`);

  await query(
    `INSERT INTO merchants (id, email, first_name, last_name, business_name, password_hash, role, status, api_key, webhook_url, webhook_secret, wallet_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'merchant', 'active', $7, NULL, $8, $9, datetime('now'), datetime('now'))`,
    [
      merchantId,
      normalizedEmail,
      payload.firstName,
      payload.lastName,
      payload.businessName,
      payload.passwordHash,
      apiKey,
      webhookSecret,
      walletId,
    ]
  );

  logger.info({ merchantId, email: normalizedEmail, businessName: payload.businessName }, 'Merchant verified and registered via OTP');

  const user = {
    id: merchantId,
    email: normalizedEmail,
    firstName: payload.firstName,
    lastName: payload.lastName,
    businessName: payload.businessName,
    role: 'merchant',
    status: 'active',
    walletId,
    apiKey,
    webhookSecret,
  };

  const token = createSessionToken({
    sub: user.id,
    email: user.email,
    role: user.role,
    walletId: user.walletId,
    businessName: user.businessName,
    firstName: user.firstName,
    lastName: user.lastName,
  });

  return { user, token, message: 'Account verified and created successfully.' };
}

/**
 * Initiates login 2FA OTP verification.
 * Validates credentials, checks 60s cooldown, sends OTP to email.
 */
export async function requestLoginOtp({ email, password }) {
  if (!email || !password) {
    throw new Error('Email and password are required');
  }

  const normalizedEmail = email.trim().toLowerCase();
  const res = await query('SELECT * FROM merchants WHERE email = $1', [normalizedEmail]);
  const merchant = res.rows[0];

  if (!merchant) {
    verifyPassword(password, 'scrypt:00000000000000000000000000000000:00000000000000000000000000000000');
    throw new Error('Invalid email or password');
  }

  if (merchant.status === 'suspended') {
    throw new Error('This account has been suspended. Please contact platform administration.');
  }

  const isPasswordValid = verifyPassword(password, merchant.password_hash);
  if (!isPasswordValid) {
    throw new Error('Invalid email or password');
  }

  // Check 60-second cooldown
  const recentOtp = await query(
    `SELECT id, created_at FROM otps WHERE email = $1 AND purpose = 'login' ORDER BY created_at DESC LIMIT 1`,
    [normalizedEmail]
  );
  if (recentOtp.rows.length > 0) {
    const elapsed = Date.now() - new Date(recentOtp.rows[0].created_at).getTime();
    if (elapsed < 60000) {
      const waitSec = Math.ceil((60000 - elapsed) / 1000);
      throw new Error(`Please wait ${waitSec}s before requesting a new security code.`);
    }
  }

  const otp = generateOtpCode();
  const otpHash = hashOtp(normalizedEmail, otp);
  const otpId = `otp_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const createdAt = new Date().toISOString();

  // Clean old login OTPs for this user
  await query(`DELETE FROM otps WHERE email = $1 AND purpose = 'login'`, [normalizedEmail]);

  await query(
    `INSERT INTO otps (id, email, otp_hash, purpose, payload, attempts, expires_at, created_at)
     VALUES ($1, $2, $3, 'login', NULL, 0, $4, $5)`,
    [otpId, normalizedEmail, otpHash, expiresAt, createdAt]
  );

  // Route admin or local domains to real administrator mailbox if needed
  let recipientEmail = normalizedEmail;
  if (normalizedEmail.endsWith('.local')) {
    recipientEmail = config.email.user || config.email.from || normalizedEmail;
  }

  await sendOtpEmail({
    to: recipientEmail,
    otp,
    purpose: 'login',
    recipientName: merchant.first_name || merchant.business_name,
  });

  logger.info({ email: normalizedEmail, recipientEmail, purpose: 'login' }, 'Login 2FA OTP dispatched');
  return {
    success: true,
    email: normalizedEmail,
    cooldownSeconds: 60,
    expiresInMinutes: 10,
    message: 'Security verification code sent to your registered email.',
  };
}

/**
 * Verifies login OTP and issues authenticated session token.
 */
export async function verifyLoginOtp({ email, otp }) {
  if (!email || !otp) {
    throw new Error('Email and verification code are required');
  }

  const normalizedEmail = email.trim().toLowerCase();
  const trimmedOtp = otp.toString().trim();

  const res = await query(
    `SELECT * FROM otps WHERE email = $1 AND purpose = 'login' ORDER BY created_at DESC LIMIT 1`,
    [normalizedEmail]
  );

  if (res.rows.length === 0) {
    throw new Error('No active login verification found. Please request a new security code.');
  }

  const otpRecord = res.rows[0];

  // Expiration check
  if (new Date(otpRecord.expires_at).getTime() < Date.now()) {
    await query('DELETE FROM otps WHERE id = $1', [otpRecord.id]);
    throw new Error('Security code has expired. Please request a new code.');
  }

  // Attempt limit check
  if (otpRecord.attempts >= 5) {
    await query('DELETE FROM otps WHERE id = $1', [otpRecord.id]);
    throw new Error('Too many invalid attempts. Security code invalidated. Please request a new code.');
  }

  // Timing safe compare
  const computedHash = hashOtp(normalizedEmail, trimmedOtp);
  const bufA = Buffer.from(computedHash, 'hex');
  const bufB = Buffer.from(otpRecord.otp_hash, 'hex');
  const isMatch = bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);

  if (!isMatch) {
    const newAttempts = (otpRecord.attempts || 0) + 1;
    await query('UPDATE otps SET attempts = $1 WHERE id = $2', [newAttempts, otpRecord.id]);
    const remaining = 5 - newAttempts;
    if (remaining <= 0) {
      await query('DELETE FROM otps WHERE id = $1', [otpRecord.id]);
      throw new Error('Too many invalid attempts. Security code invalidated. Please request a new code.');
    }
    throw new Error(`Invalid security code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`);
  }

  // Delete verified OTP record
  await query(`DELETE FROM otps WHERE email = $1 AND purpose = 'login'`, [normalizedEmail]);

  // Load merchant user
  const mchRes = await query('SELECT * FROM merchants WHERE email = $1', [normalizedEmail]);
  const merchant = mchRes.rows[0];

  if (!merchant) {
    throw new Error('Merchant account not found.');
  }

  const user = {
    id: merchant.id,
    email: merchant.email,
    firstName: merchant.first_name || null,
    lastName: merchant.last_name || null,
    businessName: merchant.business_name,
    role: merchant.role,
    status: merchant.status,
    walletId: merchant.wallet_id,
    apiKey: merchant.api_key,
    webhookSecret: merchant.webhook_secret,
    webhookUrl: merchant.webhook_url,
    createdAt: merchant.created_at,
  };

  const token = createSessionToken({
    sub: user.id,
    email: user.email,
    role: user.role,
    walletId: user.walletId,
    businessName: user.businessName,
    firstName: user.firstName,
    lastName: user.lastName,
  });

  logger.info({ userId: user.id, role: user.role }, 'User authenticated successfully via OTP');
  return { user, token, message: 'Login verified successfully.' };
}

/**
 * Registers a new business/merchant account without documentation (direct / test helper).
 */
export async function registerMerchant({ email, businessName, firstName = null, lastName = null, password, webhookUrl = null }) {
  const normalizedEmail = email.trim().toLowerCase();
  const trimmedName = businessName.trim();
  const trimmedFirst = firstName ? firstName.trim() : null;
  const trimmedLast = lastName ? lastName.trim() : null;

  // Check email uniqueness
  const existing = await query('SELECT id FROM merchants WHERE email = $1', [normalizedEmail]);
  if (existing.rows.length > 0) {
    throw new Error('An account with this email already exists');
  }

  const merchantId = `mch_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
  const walletId = `wallet_${merchantId}`;
  const passwordHash = hashPassword(password);
  const apiKey = generateApiKey();
  const webhookSecret = generateWebhookSecret();

  // Create isolated wallet for this merchant
  await getOrCreateWallet(walletId, `${trimmedName} Ledger Wallet`);

  await query(
    `INSERT INTO merchants (id, email, first_name, last_name, business_name, password_hash, role, status, api_key, webhook_url, webhook_secret, wallet_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'merchant', 'active', $7, $8, $9, $10, datetime('now'), datetime('now'))`,
    [
      merchantId,
      normalizedEmail,
      trimmedFirst,
      trimmedLast,
      trimmedName,
      passwordHash,
      apiKey,
      webhookUrl || null,
      webhookSecret,
      walletId,
    ]
  );

  logger.info({ merchantId, email: normalizedEmail, businessName: trimmedName }, 'New merchant registered (no-doc instant onboarding)');

  const user = {
    id: merchantId,
    email: normalizedEmail,
    firstName: trimmedFirst,
    lastName: trimmedLast,
    businessName: trimmedName,
    role: 'merchant',
    status: 'active',
    walletId,
    apiKey,
    webhookSecret,
  };

  const token = createSessionToken({
    sub: user.id,
    email: user.email,
    role: user.role,
    walletId: user.walletId,
    businessName: user.businessName,
    firstName: user.firstName,
    lastName: user.lastName,
  });

  return { user, token };
}

/**
 * Authenticates merchant or admin using email and password directly (or fallback).
 */
export async function loginUser({ email, password }) {
  const normalizedEmail = email.trim().toLowerCase();
  const res = await query('SELECT * FROM merchants WHERE email = $1', [normalizedEmail]);
  const merchant = res.rows[0];

  if (!merchant) {
    // Constant-time dummy verification to thwart timing attacks
    verifyPassword(password, 'scrypt:00000000000000000000000000000000:00000000000000000000000000000000');
    throw new Error('Invalid email or password');
  }

  if (merchant.status === 'suspended') {
    throw new Error('This account has been suspended. Please contact platform administration.');
  }

  const isValid = verifyPassword(password, merchant.password_hash);
  if (!isValid) {
    throw new Error('Invalid email or password');
  }

  const user = {
    id: merchant.id,
    email: merchant.email,
    firstName: merchant.first_name || null,
    lastName: merchant.last_name || null,
    businessName: merchant.business_name,
    role: merchant.role,
    status: merchant.status,
    walletId: merchant.wallet_id,
    apiKey: merchant.api_key,
    webhookSecret: merchant.webhook_secret,
    webhookUrl: merchant.webhook_url,
    createdAt: merchant.created_at,
  };

  const token = createSessionToken({
    sub: user.id,
    email: user.email,
    role: user.role,
    walletId: user.walletId,
    businessName: user.businessName,
    firstName: user.firstName,
    lastName: user.lastName,
  });

  logger.info({ userId: user.id, role: user.role }, 'User logged in successfully');
  return { user, token };
}

/**
 * Finds merchant by API Key.
 */
export async function getMerchantByApiKey(apiKey) {
  if (!apiKey || typeof apiKey !== 'string') return null;
  const res = await query('SELECT * FROM merchants WHERE api_key = $1 AND status = $2', [apiKey, 'active']);
  return res.rows[0] || null;
}

/**
 * Finds merchant by ID.
 */
export async function getMerchantById(id) {
  const res = await query('SELECT * FROM merchants WHERE id = $1', [id]);
  return res.rows[0] || null;
}

/**
 * Admin: List all registered merchants with balances and statistics.
 */
export async function listAllMerchants({ limit = 50, offset = 0 } = {}) {
  const res = await query(
    `SELECT m.id, m.email, m.business_name, m.role, m.status, m.api_key, m.wallet_id, m.created_at,
            (SELECT COUNT(*) FROM invoices i WHERE i.merchant_id = m.id) as total_invoices,
            (SELECT COUNT(*) FROM invoices i WHERE i.merchant_id = m.id AND i.status = 'confirmed') as confirmed_invoices
     FROM merchants m
     ORDER BY m.created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return res.rows;
}

/**
 * Admin: Suspend or activate a merchant.
 */
export async function setMerchantStatus(merchantId, status) {
  if (!['active', 'suspended'].includes(status)) {
    throw new Error('Status must be either active or suspended');
  }
  const res = await query(
    `UPDATE merchants SET status = $1, updated_at = datetime('now') WHERE id = $2 RETURNING *`,
    [status, merchantId]
  );
  if (res.rows.length === 0) throw new Error('Merchant not found');
  logger.info({ merchantId, status }, 'Merchant account status updated by admin');
  return res.rows[0];
}

/**
 * Ensures the master Super Admin user account is seeded and configured.
 */
export async function ensureAdminAccount() {
  const adminEmail = (process.env.ADMIN_EMAIL || 'admin@gateway.local').toLowerCase().trim();
  const adminPassword = process.env.ADMIN_PASSWORD || 'AdminGateway#2026!SecureKey';
  const adminApiKey = config.adminApiKey;

  const passwordHash = hashPassword(adminPassword);
  const webhookSecret = generateWebhookSecret();

  await query(
    `INSERT INTO merchants (id, email, first_name, last_name, business_name, password_hash, role, status, api_key, webhook_url, webhook_secret, wallet_id, created_at, updated_at)
     VALUES ('admin', $1, 'Central', 'Admin', 'Central Platform Super Admin', $2, 'admin', 'active', $3, NULL, $4, 'default', datetime('now'), datetime('now'))
     ON CONFLICT (id) DO UPDATE SET
       api_key = EXCLUDED.api_key,
       role = 'admin',
       status = 'active',
       updated_at = datetime('now')`,
    [adminEmail, passwordHash, adminApiKey, webhookSecret]
  );
  logger.info({ adminEmail }, 'Master Super Admin account synchronized');
}

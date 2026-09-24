import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { query } from './db.js';
import { config } from './config.js';
import { getOrCreateWallet } from './wallet.js';
import { logger } from './logger.js';

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
 * Registers a new business/merchant account without documentation.
 */
export async function registerMerchant({ email, businessName, password, webhookUrl = null }) {
  const normalizedEmail = email.trim().toLowerCase();
  const trimmedName = businessName.trim();

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
    `INSERT INTO merchants (id, email, business_name, password_hash, role, status, api_key, webhook_url, webhook_secret, wallet_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'merchant', 'active', $5, $6, $7, $8, datetime('now'), datetime('now'))`,
    [
      merchantId,
      normalizedEmail,
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
  });

  return { user, token };
}

/**
 * Authenticates merchant or admin using email and password.
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
    `INSERT INTO merchants (id, email, business_name, password_hash, role, status, api_key, webhook_url, webhook_secret, wallet_id, created_at, updated_at)
     VALUES ('admin', $1, 'Central Platform Super Admin', $2, 'admin', 'active', $3, NULL, $4, 'default', datetime('now'), datetime('now'))
     ON CONFLICT (id) DO UPDATE SET
       api_key = EXCLUDED.api_key,
       role = 'admin',
       status = 'active',
       updated_at = datetime('now')`,
    [adminEmail, passwordHash, adminApiKey, webhookSecret]
  );
  logger.info({ adminEmail }, 'Master Super Admin account synchronized');
}

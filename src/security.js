import crypto from 'crypto';
import { config } from './config.js';
import { verifySessionToken, getMerchantByApiKey, getMerchantById } from './auth.js';
import { logger } from './logger.js';
import { query } from './db.js';
import { BadRequestError } from './errors.js';

// ============================================================
// GLOBAL RATE LIMITER — Flood protection for entire app
// ============================================================
export function globalRateLimit({ windowMs = 60_000, max = 200 } = {}) {
  const hits = new Map();
  return (req, res, next) => {
    const key = req.ip || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || entry.resetAt < now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    entry.count += 1;
    if (entry.count > max) {
      logger.warn({ ip: key, count: entry.count }, 'Global rate limit exceeded');
      return res.status(429).json({
        error: 'Too many requests. Please slow down.',
      });
    }
    return next();
  };
}

// ============================================================
// AUTH RATE LIMITER — Strict limit for login/signup endpoints
// ============================================================
export function authRateLimit({ windowMs = 60_000, max = 10 } = {}) {
  const attempts = new Map();
  return (req, res, next) => {
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();
    const entry = attempts.get(ip);
    if (!entry || entry.resetAt < now) {
      attempts.set(ip, { count: 1, resetAt: now + windowMs });
      return next();
    }
    entry.count += 1;
    if (entry.count > max) {
      logger.warn({ ip, attempts: entry.count }, 'Auth rate limit exceeded');
      return res.status(429).json({
        error: 'Too many authentication attempts. Please wait a minute before trying again.',
      });
    }
    return next();
  };
}

// ============================================================
// BASIC RATE LIMITER — General API endpoints
// ============================================================
export function basicRateLimit({ windowMs = 60_000, max = 120 } = {}) {
  const hits = new Map();
  return (req, res, next) => {
    const key = req.ip || 'unknown';
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || entry.resetAt < now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    entry.count += 1;
    if (entry.count > max) return res.status(429).json({ error: 'Too many requests' });
    return next();
  };
}

// ============================================================
// AUTHENTICATION MIDDLEWARE
//
// Credential precedence (most to least secure):
//   1. Session token (Authorization: Bearer <token>) — from UI login
//   2. Merchant live API key (X-API-Key: mch_live_...) — from integrations
//   3. Admin API key (Authorization: Bearer <admin_key> or X-API-Key)
//
// NOTE: query-string api_key is NOT supported — it leaks into server logs
//       and browser history.
// ============================================================
export async function authenticate(req, res, next) {
  const authHeader = req.get('Authorization') || '';
  const bearerToken = authHeader.replace(/^Bearer\s+/i, '').trim();
  const apiKeyHeader = (req.get('X-API-Key') || '').trim();

  // Reject any attempt to pass credentials via query string
  if (req.query.api_key) {
    return res.status(400).json({
      error: 'API keys must be sent via X-API-Key header or Authorization: Bearer header, not query parameters.',
    });
  }

  const credential = bearerToken || apiKeyHeader;
  if (!credential) {
    return res.status(401).json({ error: 'Unauthorized: Authentication credentials required' });
  }

  // 1. Try session token first (contains dots — JWT format)
  if (credential.includes('.')) {
    const claims = verifySessionToken(credential);
    if (!claims) {
      return res.status(401).json({ error: 'Unauthorized: Session expired or invalid' });
    }

    // Admin session
    if (claims.role === 'admin' || claims.sub === 'admin') {
      req.user = {
        id: claims.sub || 'admin',
        role: 'admin',
        email: claims.email || process.env.ADMIN_EMAIL || 'admin@gateway.local',
        walletId: claims.walletId || 'default',
        businessName: claims.businessName || 'Platform Super Admin',
      };
      return next();
    }

    // Merchant session — re-validate against DB on each request
    try {
      const merchant = await getMerchantById(claims.sub);
      if (!merchant) {
        return res.status(401).json({ error: 'Unauthorized: Account not found' });
      }
      if (merchant.status === 'suspended') {
        return res.status(403).json({ error: 'Forbidden: Account is suspended' });
      }
      req.user = {
        id: merchant.id,
        role: merchant.role,
        email: merchant.email,
        walletId: merchant.wallet_id,
        businessName: merchant.business_name,
      };
      return next();
    } catch {
      return res.status(500).json({ error: 'Authentication database error' });
    }
  }

  // 2. Check Admin API Key — constant-time comparison
  const adminKey = config.adminApiKey || '';
  if (adminKey && credential.length === adminKey.length) {
    try {
      const bufCred = Buffer.from(credential);
      const bufAdmin = Buffer.from(adminKey);
      if (crypto.timingSafeEqual(bufCred, bufAdmin)) {
        req.user = {
          id: 'admin',
          role: 'admin',
          email: process.env.ADMIN_EMAIL || 'admin@gateway.local',
          walletId: 'default',
          businessName: 'Platform Super Admin',
        };
        return next();
      }
    } catch {
      // Buffer length mismatch — fall through
    }
  }

  // 3. Check Database API Key (pr_live_..., mch_live_..., or any stored merchant/admin key)
  try {
    const merchant = await getMerchantByApiKey(credential);
    if (merchant) {
      if (merchant.status === 'suspended') {
        return res.status(403).json({ error: 'Forbidden: Account is suspended' });
      }
      req.user = {
        id: merchant.id,
        role: merchant.role || 'merchant',
        email: merchant.email,
        walletId: merchant.wallet_id,
        businessName: merchant.business_name,
      };
      return next();
    }
  } catch (err) {
    logger.error({ err }, 'Authentication service error');
    return res.status(500).json({ error: 'Authentication service error' });
  }

  return res.status(401).json({ error: 'Unauthorized: Invalid API key or session token' });
}

// ============================================================
// ADMIN ONLY GUARD
// ============================================================
export async function requireAdmin(req, res, next) {
  await authenticate(req, res, () => {
    if (!req.user || req.user.role !== 'admin') {
      logger.warn({ ip: req.ip, path: req.path }, 'Unauthorized admin access attempt');
      return res.status(403).json({ error: 'Forbidden: Super Admin privileges required' });
    }
    next();
  });
}

// ============================================================
// MERCHANT OR ADMIN GUARD
// ============================================================
export async function requireMerchantOrAdmin(req, res, next) {
  await authenticate(req, res, () => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  });
}

// Backward compatibility alias
export const requireAdminApiKey = requireAdmin;

// ============================================================
// WEBHOOK URL SECURITY — Prevent SSRF attacks
// Merchants cannot point webhooks to internal/local addresses.
// ============================================================
export function assertTrustedWebhookUrl(value) {
  if (!value) return;
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new BadRequestError('webhookUrl must be a valid URL');
  }

  // Allow wildcard or development mode
  if (config.environment === 'development' || config.trustedWebhookHosts.includes('*')) {
    return;
  }

  const hostname = url.hostname.toLowerCase();

  // Allow localhost/private IPs if explicitly in trustedWebhookHosts
  const allowLocal = config.trustedWebhookHosts.includes('localhost') || config.trustedWebhookHosts.includes('127.0.0.1');
  if (!allowLocal) {
    const blockedPatterns = [
      /^localhost$/,
      /^127\./,
      /^10\./,
      /^172\.(1[6-9]|2\d|3[01])\./,
      /^192\.168\./,
      /^0\.0\.0\.0$/,
      /^::1$/,
      /^fc00:/,
      /^fd[0-9a-f]{2}:/,
      /\.local$/,
      /\.internal$/,
    ];
    for (const pattern of blockedPatterns) {
      if (pattern.test(hostname)) {
        throw new BadRequestError('webhookUrl must not point to a private or local network address');
      }
    }
  }

  if (url.username || url.password) {
    throw new BadRequestError('webhookUrl must not contain embedded credentials');
  }

  if (process.env.STRICT_SECURITY === 'true') {
    if (url.protocol !== 'https:') {
      throw new BadRequestError('webhookUrl must use HTTPS');
    }
    if (url.port && url.port !== '443') {
      throw new BadRequestError('webhookUrl must not use a non-standard port');
    }
  }

  if (!config.trustedWebhookHosts.some(allowed => allowed === '*' || hostname === allowed || hostname.endsWith(`.${allowed}`))) {
    throw new BadRequestError(`webhookUrl host "${hostname}" is not in WEBHOOK_ALLOWED_HOSTS allowlist`);
  }
}

// ============================================================
// SANITIZE TEXT INPUT — Strip control characters & excessive whitespace
// Prevents injection of null bytes, CRLF header injection, etc.
// ============================================================
export function sanitizeText(value, maxLength = 500) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // strip control chars (keep \t \n \r)
    .replace(/\r\n|\r/g, '\n')                            // normalize line endings
    .trim()
    .slice(0, maxLength);
}

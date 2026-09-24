import crypto from 'crypto';
import { config } from './config.js';
import { verifySessionToken, getMerchantByApiKey, getMerchantById } from './auth.js';

/**
 * Universal Authentication Middleware.
 * Accepts:
 * 1. Bearer session token (UI dashboard login)
 * 2. Super Admin API key (X-API-Key or Bearer token)
 * 3. Merchant API key (mch_live_...) (Merchant API integrations)
 */
export async function authenticate(req, res, next) {
  const authHeader = req.get('Authorization') || '';
  const bearerToken = authHeader.replace(/^Bearer\s+/i, '').trim();
  const apiKeyHeader = (req.get('X-API-Key') || '').trim();
  const queryApiKey = (req.query.api_key ? String(req.query.api_key) : '').trim();

  const credential = bearerToken || apiKeyHeader || queryApiKey;
  if (!credential) {
    return res.status(401).json({ error: 'Unauthorized: Authentication credentials required' });
  }

  // 1. Check Super Admin API Key
  const adminExpected = config.adminApiKey || '';
  if (adminExpected && credential.length === adminExpected.length) {
    const bufCred = Buffer.from(credential);
    const bufAdmin = Buffer.from(adminExpected);
    if (bufCred.length === bufAdmin.length && crypto.timingSafeEqual(bufCred, bufAdmin)) {
      req.user = {
        id: 'admin',
        role: 'admin',
        email: process.env.ADMIN_EMAIL || 'admin@gateway.local',
        walletId: 'default',
        businessName: 'Platform Super Admin',
      };
      return next();
    }
  }

  // 2. Check Merchant Live API Key
  if (credential.startsWith('mch_live_')) {
    try {
      const merchant = await getMerchantByApiKey(credential);
      if (!merchant) {
        return res.status(401).json({ error: 'Unauthorized: Invalid merchant API key' });
      }
      if (merchant.status === 'suspended') {
        return res.status(403).json({ error: 'Forbidden: Merchant account is suspended' });
      }
      req.user = {
        id: merchant.id,
        role: merchant.role || 'merchant',
        email: merchant.email,
        walletId: merchant.wallet_id,
        businessName: merchant.business_name,
      };
      return next();
    } catch (err) {
      return res.status(500).json({ error: 'Authentication service error' });
    }
  }

  // 3. Check Cryptographic Session Token (JWT format: header.payload.signature)
  if (credential.includes('.')) {
    const claims = verifySessionToken(credential);
    if (!claims) {
      return res.status(401).json({ error: 'Unauthorized: Session expired or invalid' });
    }

    if (claims.role === 'admin' || claims.sub === 'admin') {
      req.user = {
        id: 'admin',
        role: 'admin',
        email: claims.email || process.env.ADMIN_EMAIL || 'admin@gateway.local',
        walletId: 'default',
        businessName: claims.businessName || 'Platform Super Admin',
      };
      return next();
    }

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

  return res.status(401).json({ error: 'Unauthorized: Invalid API key or session token' });
}

/**
 * Super Admin authorization guard.
 * Only the platform administrator may proceed.
 */
export async function requireAdmin(req, res, next) {
  await authenticate(req, res, () => {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: Super Admin privileges required' });
    }
    next();
  });
}

/**
 * Allows both authenticated merchants and super admin.
 */
export async function requireMerchantOrAdmin(req, res, next) {
  await authenticate(req, res, () => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  });
}

/**
 * Backward compatibility middleware for existing admin router tests.
 */
export async function requireAdminApiKey(req, res, next) {
  return requireAdmin(req, res, next);
}

/**
 * Strict Rate Limiter for Authentication endpoints (prevents brute-force attacks).
 */
export function authRateLimit({ windowMs = 60_000, max = 10 } = {}) {
  const attempts = new Map();
  return (req, res, next) => {
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const entry = attempts.get(ip);
    if (!entry || entry.resetAt < now) {
      attempts.set(ip, { count: 1, resetAt: now + windowMs });
      return next();
    }
    entry.count += 1;
    if (entry.count > max) {
      return res.status(429).json({
        error: 'Too many authentication attempts. Please wait a minute before trying again.',
      });
    }
    return next();
  };
}

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

export function assertTrustedWebhookUrl(value) {
  if (!value) return;
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('webhookUrl must be a valid URL');
  }

  // In development, allow http and wildcard localhost
  if (config.environment === 'development' || config.trustedWebhookHosts.includes('*')) {
    return;
  }

  if (url.protocol !== 'https:' || url.username || url.password || url.port) {
    throw new Error('webhookUrl must be an HTTPS URL without credentials or a custom port');
  }
  const hostname = url.hostname.toLowerCase();
  if (!config.trustedWebhookHosts.some(allowed => hostname === allowed || hostname.endsWith(`.${allowed}`))) {
    throw new Error('webhookUrl host is not in WEBHOOK_ALLOWED_HOSTS');
  }
}

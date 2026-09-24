import crypto from 'crypto';
import { config } from './config.js';

export function requireAdminApiKey(req, res, next) {
  const supplied = req.get('X-API-Key') ||
    (req.get('Authorization') ? req.get('Authorization').replace(/^Bearer\s+/i, '') : '') ||
    req.query.api_key ||
    '';
  const expected = config.adminApiKey || '';

  if (!expected || expected.length < 32) {
    return res.status(500).json({ error: 'Server ADMIN_API_KEY is not configured with >= 32 characters' });
  }

  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);

  const valid = suppliedBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(suppliedBuffer, expectedBuffer);

  if (!valid) return res.status(401).json({ error: 'Unauthorized: Invalid or missing API Key' });
  return next();
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

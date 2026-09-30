import crypto from 'crypto';
import { config } from './config.js';
import { logger } from './logger.js';

const WEBHOOK_TIMEOUT_MS = 5000;   // 5 second max — prevent slow-drip DoS
const MAX_RETRIES = 3;              // 3 attempts with exponential backoff
const RETRY_BASE_DELAY_MS = 1000;  // 1s, 2s, 4s

/**
 * Delivers a signed webhook payload to the merchant's configured endpoint.
 *
 * Security:
 * - Uses per-merchant webhook_secret when provided, falls back to global webhookSecret
 * - Signs the payload with HMAC-SHA256 before delivery
 * - Hard 5-second timeout prevents slow-drip DoS
 * - Retries up to 3× with exponential backoff (1s, 2s, 4s) on failure
 *
 * @param {string} url         - Merchant-configured HTTPS endpoint
 * @param {object} payload     - Event payload to deliver
 * @param {string} [secret]    - Merchant-specific webhook secret (preferred over global)
 */
export async function sendWebhook(url, payload, secret) {
  if (!url) return;

  // Use per-merchant secret when available; fall back to global platform secret
  const signingSecret = (secret && secret.trim()) ? secret : config.webhookSecret;
  if (!signingSecret) {
    logger.warn({ url }, 'Webhook delivery skipped — no signing secret configured');
    return;
  }

  const body = JSON.stringify(payload);
  const timestamp = Date.now().toString();
  // Include timestamp in the signed string to prevent replay attacks
  const signaturePayload = `${timestamp}.${body}`;
  const timestampedSig = crypto
    .createHmac('sha256', signingSecret)
    .update(signaturePayload)
    .digest('hex');

  // Also compute raw body HMAC signature for consumers checking x-signature directly on body
  const rawBodySig = crypto
    .createHmac('sha256', signingSecret)
    .update(body)
    .digest('hex');

  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': `sha256=${timestampedSig}`,
          'X-Webhook-Timestamp': timestamp,
          'X-Signature': rawBodySig,
          'X-Signature-Sha256': `sha256=${rawBodySig}`,
          'X-Webhook-Event': payload.event || 'payment.event',
          'User-Agent': 'AnonyGateway-Webhook/1.0',
        },
        body,
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!res.ok) {
        logger.warn({ url, status: res.status, attempt }, 'Webhook delivery failed — server rejected');
        lastError = new Error(`HTTP ${res.status}`);
      } else {
        if (attempt > 1) {
          logger.info({ url, attempt }, 'Webhook delivered successfully after retry');
        }
        return; // Success — done
      }
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        logger.warn({ url, attempt }, `Webhook timed out after ${WEBHOOK_TIMEOUT_MS}ms`);
        lastError = new Error('Webhook delivery timed out');
      } else {
        logger.error({ err, url, attempt }, 'Webhook delivery error');
        lastError = err;
      }
    }

    // Exponential backoff before retry (skip delay on last attempt)
    if (attempt < MAX_RETRIES) {
      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  logger.error({ url, error: lastError?.message }, `Webhook delivery failed after ${MAX_RETRIES} attempts`);
}

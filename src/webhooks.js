import crypto from 'crypto';
import { config } from './config.js';
import { logger } from './logger.js';

export async function sendWebhook(url, payload) {
  if (!url) return;
  const body = JSON.stringify(payload);
  const signature = crypto.createHmac('sha256', config.webhookSecret).update(body).digest('hex');
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Signature': signature,
      },
      body,
    });
    if (!res.ok) {
      logger.warn({ url, status: res.status }, 'Webhook failed');
    }
  } catch (err) {
    logger.error({ err, url }, 'Webhook error');
  }
}

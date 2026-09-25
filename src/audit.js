/**
 * audit.js — Immutable security audit log
 *
 * Records all security-sensitive events to the `audit_logs` table.
 * Logs are write-only — never deleted (except by DBA intervention).
 *
 * Tracked events:
 *  - auth.login_success        — successful login via OTP
 *  - auth.login_failed         — wrong password
 *  - auth.account_locked       — account locked after N wrong passwords
 *  - auth.otp_invalid          — wrong OTP code entered
 *  - auth.signup               — new merchant registered
 *  - admin.merchant_suspended  — admin suspended a merchant
 *  - admin.merchant_activated  — admin reactivated a merchant
 *  - admin.payout              — admin triggered a treasury payout
 *  - api.unauthorized          — rejected API key or session token
 */
import { v4 as uuidv4 } from 'uuid';
import { query } from './db.js';
import { logger } from './logger.js';

/**
 * Writes a security-relevant event to the audit_logs table.
 *
 * @param {object} event
 * @param {string} event.action         - Event type (e.g. 'auth.login_success')
 * @param {string} [event.actorId]      - ID of the user performing the action
 * @param {string} [event.actorRole]    - Role of the actor ('admin' | 'merchant')
 * @param {string} [event.targetType]   - Entity type affected (e.g. 'merchant', 'invoice')
 * @param {string} [event.targetId]     - ID of the affected entity
 * @param {string} [event.ip]           - Requester's IP address
 * @param {string} [event.result]       - 'success' | 'failure' | 'blocked'
 * @param {object} [event.details]      - Additional metadata (sanitized — no passwords/secrets)
 */
export async function auditLog({
  action,
  actorId = null,
  actorRole = null,
  targetType = null,
  targetId = null,
  ip = null,
  result = 'success',
  details = null,
}) {
  const id = `al_${uuidv4().replace(/-/g, '').slice(0, 20)}`;
  const createdAt = new Date().toISOString();
  const detailsStr = details ? JSON.stringify(details) : null;

  try {
    await query(
      `INSERT INTO audit_logs (id, actor_id, actor_role, action, target_type, target_id, ip, result, details, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [id, actorId, actorRole, action, targetType, targetId, ip, result, detailsStr, createdAt]
    );
  } catch (err) {
    // Audit log failure must NOT block the main request — just log it
    logger.error({ err: err.message, action }, 'Failed to write audit log');
  }
}

/**
 * Convenience helper for extracting IP from Express request objects.
 */
export function getClientIp(req) {
  if (!req) return null;
  const forwarded = req.headers?.['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || null;
}

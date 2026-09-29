// src/errors.js — Centralized Error Handling & Critical Data Masking System

import { z } from 'zod';
import crypto from 'crypto';
import { logger } from './logger.js';

// ============================================================
// 1. SENSITIVE DATA REDACTION & MASKING
// ============================================================

const SENSITIVE_PATTERNS = [
  // EVM 64-hex private keys (with or without 0x prefix)
  { regex: /0x[a-fA-F0-9]{64}/g, replacement: '[REDACTED_PRIVATE_KEY]' },
  { regex: /\b[a-fA-F0-9]{64}\b/g, replacement: '[REDACTED_HEX_KEY]' },

  // Live Gateway API Keys
  { regex: /pr_live_[a-zA-Z0-9_\-]{16,}/g, replacement: '[REDACTED_API_KEY]' },
  { regex: /mch_live_[a-zA-Z0-9_\-]{16,}/g, replacement: '[REDACTED_API_KEY]' },
  { regex: /adm_live_[a-zA-Z0-9_\-]{16,}/g, replacement: '[REDACTED_API_KEY]' },

  // Webhook signing secrets
  { regex: /whsec_[a-zA-Z0-9_\-]{16,}/g, replacement: '[REDACTED_WEBHOOK_SECRET]' },

  // JWT Tokens
  { regex: /Bearer\s+[a-zA-Z0-9_\-\.]+/gi, replacement: 'Bearer [REDACTED_TOKEN]' },
  { regex: /\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]+\b/g, replacement: '[REDACTED_JWT]' },

  // Passwords / Hashes
  { regex: /\$2[aby]\$\d{2}\$[a-zA-Z0-9./]{53}/g, replacement: '[REDACTED_HASH]' },
  { regex: /(["']?(?:password|adminPassword|pass|token|secret|apiKey|mnemonic)["']?\s*[:=]\s*["'])([^"']+)(["'])/gi, replacement: '$1[REDACTED]$3' },

  // Database Connection Strings with Passwords
  { regex: /(postgres(?:ql)?:\/\/[^:]+:)[^@]+(@)/gi, replacement: '$1[REDACTED]$2' },

  // Internal File System Paths (Windows / Unix)
  { regex: /[a-zA-Z]:\\[^:\s"'<>|]+(?:\\|\b)/g, replacement: '[INTERNAL_PATH]' },
  { regex: /(?:\/home|\/Users|\/root|\/var\/www|\/app)\/[^\s"'<>|]+/g, replacement: '[INTERNAL_PATH]' },
];

/**
 * Redacts any sensitive data (keys, passwords, tokens, paths) from strings or objects
 */
export function redactSensitiveData(data) {
  if (data === null || data === undefined) return data;

  if (typeof data === 'string') {
    let sanitized = data;
    for (const { regex, replacement } of SENSITIVE_PATTERNS) {
      sanitized = sanitized.replace(regex, replacement);
    }
    return sanitized;
  }

  if (Array.isArray(data)) {
    return data.map(item => redactSensitiveData(item));
  }

  if (typeof data === 'object') {
    const sanitizedObj = {};
    for (const [key, value] of Object.entries(data)) {
      const lowerKey = key.toLowerCase();
      // Directly blank out known dangerous keys
      if (
        lowerKey.includes('password') ||
        lowerKey.includes('privatekey') ||
        lowerKey.includes('mnemonic') ||
        lowerKey.includes('seed') ||
        lowerKey.includes('secret') ||
        lowerKey.includes('apikey') ||
        (lowerKey.includes('token') && !lowerKey.includes('contract'))
      ) {
        sanitizedObj[key] = '[REDACTED]';
      } else {
        sanitizedObj[key] = redactSensitiveData(value);
      }
    }
    return sanitizedObj;
  }

  return data;
}

// ============================================================
// 2. CUSTOM APPLICATION ERROR CLASSES
// ============================================================

export class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR', isOperational = true) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Invalid request parameters', code = 'BAD_REQUEST') {
    super(message, 400, code, true);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed', details = null, code = 'VALIDATION_ERROR') {
    super(message, 400, code, true);
    this.details = details;
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required', code = 'UNAUTHORIZED') {
    super(message, 401, code, true);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Access forbidden', code = 'FORBIDDEN') {
    super(message, 403, code, true);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found', code = 'NOT_FOUND') {
    super(message, 404, code, true);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Resource conflict', code = 'CONFLICT') {
    super(message, 409, code, true);
  }
}

export class RateLimitError extends AppError {
  constructor(message = 'Too many requests, please slow down', code = 'RATE_LIMIT_EXCEEDED') {
    super(message, 429, code, true);
  }
}

export class InternalServerError extends AppError {
  constructor(message = 'Internal server error', code = 'INTERNAL_ERROR') {
    super(message, 500, code, false);
  }
}

// ============================================================
// 3. ZOD ERROR FORMATTER — USER FRIENDLY & LEAK-PROOF
// ============================================================

export function formatZodError(err) {
  if (err instanceof z.ZodError) {
    // Format into single user-readable sentence
    const issues = err.errors.map((e) => {
      const field = e.path.join('.') || 'field';
      return `${field}: ${e.message}`;
    });
    return issues.join(', ');
  }
  return typeof err?.message === 'string' ? err.message : 'Invalid request format';
}

// ============================================================
// 4. CLIENT-SAFE ERROR SANITIZER
// ============================================================

/**
 * Checks if a message is a raw database or system error that must never be shown
 */
function isTechnicalSystemError(msg) {
  if (!msg || typeof msg !== 'string') return false;
  const lower = msg.toLowerCase();
  return (
    lower.includes('sqlite_') ||
    lower.includes('unique constraint') ||
    lower.includes('syntax error') ||
    lower.includes('no such table') ||
    lower.includes('no such column') ||
    lower.includes('postgres') ||
    lower.includes('pg_') ||
    lower.includes('econnrefused') ||
    lower.includes('etimedout') ||
    lower.includes('enotfound') ||
    lower.includes('cannot read property') ||
    lower.includes('cannot read properties') ||
    lower.includes('is not a function') ||
    lower.includes('unexpected token') ||
    lower.includes('unhandledrejection') ||
    lower.includes('trace:') ||
    lower.includes('at ')
  );
}

/**
 * Produces a safe, sanitized error response object and status code.
 * Guarantees zero sensitive data leakage to the client.
 */
export function sanitizeErrorForResponse(err, isDev = false) {
  const requestId = crypto.randomBytes(6).toString('hex');

  // Case 1: Zod Validation Error -> Always 400 with clean fields
  if (err instanceof z.ZodError) {
    return {
      statusCode: 400,
      body: {
        error: redactSensitiveData(formatZodError(err)),
        code: 'VALIDATION_ERROR',
        requestId,
      },
    };
  }

  // Case 2: Handled Operational AppError (4xx)
  if (err instanceof AppError && err.isOperational && err.statusCode < 500) {
    return {
      statusCode: err.statusCode,
      body: {
        error: redactSensitiveData(err.message),
        code: err.code || 'OPERATIONAL_ERROR',
        ...(err.details ? { details: redactSensitiveData(err.details) } : {}),
        requestId,
      },
    };
  }

  // Case 3: Explicit HTTP Status Attached (e.g. 400, 401, 403, 404, 429)
  const explicitStatus = err?.status || err?.statusCode;
  if (explicitStatus && explicitStatus >= 400 && explicitStatus < 500) {
    const rawMsg = err.message || 'Invalid request';
    // Ensure the message does not contain database/system internals
    const safeMsg = isTechnicalSystemError(rawMsg)
      ? 'The requested operation could not be completed with the provided data.'
      : redactSensitiveData(rawMsg);

    return {
      statusCode: explicitStatus,
      body: {
        error: safeMsg,
        code: err.code || 'CLIENT_ERROR',
        requestId,
      },
    };
  }

  // Case 4: Known safe business error messages or operational exceptions
  const rawMsg = String(err?.message || '');
  const lowerMsg = rawMsg.toLowerCase();

  // CORS restriction
  if (lowerMsg.includes('not allowed by cors') || lowerMsg.includes('cross-origin request not permitted')) {
    return {
      statusCode: 403,
      body: {
        error: 'Cross-origin request not permitted',
        code: 'FORBIDDEN_CORS',
        requestId,
      },
    };
  }

  // Database unique constraint violation (safe message, no schema leakage)
  if (lowerMsg.includes('unique constraint') || lowerMsg.includes('sqlite_constraint')) {
    const isEmail = lowerMsg.includes('email');
    return {
      statusCode: 409,
      body: {
        error: isEmail
          ? 'An account with this email address already exists'
          : 'A record with this information already exists',
        code: 'DUPLICATE_RESOURCE',
        requestId,
      },
    };
  }

  // Blockchain / Balance operational errors
  if (lowerMsg.includes('insufficient') && (lowerMsg.includes('balance') || lowerMsg.includes('funds'))) {
    return {
      statusCode: 400,
      body: {
        error: 'Insufficient wallet or treasury balance to complete this transaction',
        code: 'INSUFFICIENT_FUNDS',
        requestId,
      },
    };
  }

  const isSafeBusinessError = (
    rawMsg.startsWith('Invoice not found') ||
    rawMsg.startsWith('Payment link not found') ||
    rawMsg.startsWith('User not found') ||
    rawMsg.startsWith('Invalid destination address') ||
    rawMsg.startsWith('Amount must be') ||
    rawMsg.startsWith('Transaction receipt not yet found') ||
    rawMsg.startsWith('Transaction failed on-chain') ||
    rawMsg.startsWith('Invalid or expired OTP') ||
    rawMsg.startsWith('Account locked') ||
    rawMsg.startsWith('Too many requests') ||
    rawMsg.startsWith('Invalid email or password') ||
    rawMsg.startsWith('Cross-origin request not permitted') ||
    rawMsg.startsWith('Cannot transfer to the same wallet') ||
    rawMsg.startsWith('Invalid verification code') ||
    rawMsg.startsWith('Verification code has expired') ||
    rawMsg.startsWith('Too many invalid attempts') ||
    rawMsg.startsWith('Email and verification code are required') ||
    rawMsg.startsWith('No active login verification found') ||
    rawMsg.startsWith('No pending registration verification found')
  );

  if (isSafeBusinessError) {
    return {
      statusCode: 400,
      body: {
        error: redactSensitiveData(rawMsg),
        code: 'BAD_REQUEST',
        requestId,
      },
    };
  }

  // Case 5: 500 Internal / Database / RPC / System Errors
  // CRITICAL: NEVER leak technical messages, queries, or stack traces
  return {
    statusCode: 500,
    body: {
      error: 'An unexpected internal error occurred. Please try again later or contact support.',
      code: 'INTERNAL_SERVER_ERROR',
      requestId,
      ...(isDev ? { devHint: redactSensitiveData(rawMsg) } : {}),
    },
  };
}

// ============================================================
// 5. ASYNC HANDLER WRAPPER
// ============================================================

/**
 * Wraps express route handlers to guarantee errors are cleanly forwarded to centralized error middleware
 */
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

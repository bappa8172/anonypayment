// test/test_errors.mjs — Comprehensive Verification for Error Handling & Critical Data Masking

import assert from 'assert';
import { z } from 'zod';
import {
  redactSensitiveData,
  sanitizeErrorForResponse,
  formatZodError,
  AppError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
} from '../src/errors.js';

console.log('--- Starting Error Handling & Data Leak Prevention Tests ---\n');

// 1. Verify Private Key Redaction
const dummyPrivateKey = '0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d';
const dummyApiKey = 'pr_live_9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d';
const dummyWebhookSec = 'whsec_998877665544332211aabbccddeeff00';
const dummyPath = 'C:\\Users\\Bappa\\OneDrive\\Desktop\\project\\PAYMENT\\src\\secret.js';

const sampleErrorWithKey = `Broadcast error: transaction failed with key ${dummyPrivateKey} on path ${dummyPath}`;
const redactedMsg = redactSensitiveData(sampleErrorWithKey);
assert(!redactedMsg.includes(dummyPrivateKey), 'Private key must NOT be present in redacted string');
assert(redactedMsg.includes('[REDACTED_PRIVATE_KEY]'), 'Must replace private key with [REDACTED_PRIVATE_KEY]');
assert(!redactedMsg.includes('C:\\Users\\Bappa'), 'File system path must NOT be present in redacted string');
console.log('✅ Test 1: Private key & filesystem path successfully redacted');

// 2. Verify API Key and Webhook Secret Redaction
const sampleLeakObj = {
  message: 'Failed to authenticate merchant',
  apiKey: dummyApiKey,
  secret: dummyWebhookSec,
  nested: {
    token: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.doNotLeakThisSignature',
    password: 'SuperSecretPassword123!',
  },
};
const redactedObj = redactSensitiveData(sampleLeakObj);
assert.strictEqual(redactedObj.apiKey, '[REDACTED]');
assert.strictEqual(redactedObj.secret, '[REDACTED]');
assert.strictEqual(redactedObj.nested.password, '[REDACTED]');
assert(!JSON.stringify(redactedObj).includes('SuperSecretPassword123!'), 'Plaintext password must never appear in redacted object');
console.log('✅ Test 2: API Keys, Webhook Secrets, and Passwords securely blanked in data objects');

// 3. Verify Zod Error Sanitization
const testSchema = z.object({
  email: z.string().email('Invalid email address'),
  amount: z.string().regex(/^\d+$/, 'Amount must be digits only'),
  toAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Must be valid EVM 0x address'),
});

let zodCaught = null;
try {
  testSchema.parse({ email: 'not-an-email', amount: 'abc' });
} catch (err) {
  zodCaught = err;
}
assert(zodCaught instanceof z.ZodError, 'Must catch ZodError');
const formattedZod = formatZodError(zodCaught);
assert(formattedZod.includes('email: Invalid email address'), 'Formatted Zod should have clear field message');
assert(formattedZod.includes('toAddress: Required'), 'Formatted Zod should identify missing required field');
assert(!formattedZod.includes('"expected"'), 'Formatted Zod should not dump raw AST tokens');

const sanitizedZodResponse = sanitizeErrorForResponse(zodCaught, false);
assert.strictEqual(sanitizedZodResponse.statusCode, 400);
assert.strictEqual(sanitizedZodResponse.body.code, 'VALIDATION_ERROR');
assert(typeof sanitizedZodResponse.body.error === 'string');
console.log('✅ Test 3: Zod validation errors safely formatted without raw AST/JSON schema dumps');

// 4. Verify Database & SQL Error Masking
const fakeDbSyntaxError = new Error('SQLITE_ERROR: near "FROM": syntax error in SELECT * FROM merchants WHERE secret = 123');
const sanitizedDbResponse = sanitizeErrorForResponse(fakeDbSyntaxError, false);
assert.strictEqual(sanitizedDbResponse.statusCode, 500);
assert(!sanitizedDbResponse.body.error.includes('SQLITE_ERROR'), 'Database error code must NOT leak to client');
assert(!sanitizedDbResponse.body.error.includes('merchants'), 'Table name must NOT leak to client');
assert.strictEqual(
  sanitizedDbResponse.body.error,
  'An unexpected internal error occurred. Please try again later or contact support.'
);
console.log('✅ Test 4: Database syntax and table schema errors completely masked (500)');

// 5. Verify Unique Constraint Error Handling (Safe 409)
const fakeUniqueEmailError = new Error('SQLITE_CONSTRAINT: UNIQUE constraint failed: merchants.email');
const sanitizedUniqueResponse = sanitizeErrorForResponse(fakeUniqueEmailError, false);
assert.strictEqual(sanitizedUniqueResponse.statusCode, 409);
assert.strictEqual(sanitizedUniqueResponse.body.code, 'DUPLICATE_RESOURCE');
assert.strictEqual(sanitizedUniqueResponse.body.error, 'An account with this email address already exists');
assert(!sanitizedUniqueResponse.body.error.includes('merchants.email'), 'Internal column path must not leak');
console.log('✅ Test 5: Unique constraint errors cleanly mapped to friendly 409 Conflict without schema leak');

// 6. Verify Blockchain Insufficient Balance Error
const fakeRpcBalanceError = new Error('execution reverted: Treasury address 0x9f8c... has insufficient native balance');
const sanitizedRpcResponse = sanitizeErrorForResponse(fakeRpcBalanceError, false);
assert.strictEqual(sanitizedRpcResponse.statusCode, 400);
assert.strictEqual(sanitizedRpcResponse.body.code, 'INSUFFICIENT_FUNDS');
assert.strictEqual(
  sanitizedRpcResponse.body.error,
  'Insufficient wallet or treasury balance to complete this transaction'
);
console.log('✅ Test 6: Blockchain RPC revert and balance errors cleanly mapped to safe 400 response');

// 7. Verify Operational AppErrors
const notFoundErr = new NotFoundError('Invoice not found');
const sanitizedNotFound = sanitizeErrorForResponse(notFoundErr, false);
assert.strictEqual(sanitizedNotFound.statusCode, 404);
assert.strictEqual(sanitizedNotFound.body.error, 'Invoice not found');
assert.strictEqual(sanitizedNotFound.body.code, 'NOT_FOUND');
console.log('✅ Test 7: Operational AppErrors correctly preserve status code and safe messages');

console.log('\n🎉 ALL ERROR HANDLING & DATA PROTECTION TESTS PASSED SUCCESSFULLY! 🎉');

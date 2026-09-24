import test from 'node:test';
import assert from 'node:assert/strict';
import { fromBaseUnits, isAtLeast, normalizeAmount, toBaseUnits } from '../src/money.js';

test('converts USDT decimal strings without a floating-point round trip', () => {
  assert.equal(toBaseUnits('125.125', 18), 125125000000000000000n);
  assert.equal(normalizeAmount('125.125000', 18), '125.125');
  assert.equal(fromBaseUnits(125125000000000000000n, 18), '125.125');
});

test('preserves precision beyond Number.MAX_SAFE_INTEGER', () => {
  const expected = toBaseUnits('9007199254740993.000000000000000001', 18);
  assert.equal(isAtLeast(expected, expected), true);
  assert.equal(isAtLeast(expected - 1n, expected), false);
});

test('rejects precision the asset cannot represent', () => {
  assert.throws(() => toBaseUnits('1.0000000000000000001', 18));
  assert.throws(() => toBaseUnits('0', 18));
});

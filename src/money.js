const DECIMAL_AMOUNT = /^(0|[1-9]\d*)(?:\.\d+)?$/;

/**
 * Convert a human decimal amount into integer token base units without using
 * JavaScript floating point numbers.
 */
export function toBaseUnits(amount, decimals) {
  const value = String(amount).trim();
  if (!DECIMAL_AMOUNT.test(value)) throw new Error('Amount must be a positive decimal string');
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > decimals) throw new Error(`Amount supports at most ${decimals} decimal places`);
  const units = BigInt(whole + fraction.padEnd(decimals, '0'));
  if (units <= 0n) throw new Error('Amount must be greater than zero');
  return units;
}

export function normalizeAmount(amount, decimals) {
  const units = toBaseUnits(amount, decimals);
  const raw = units.toString().padStart(decimals + 1, '0');
  const whole = raw.slice(0, -decimals) || '0';
  const fraction = raw.slice(-decimals).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

export function fromBaseUnits(amountUnits, decimals) {
  const raw = BigInt(amountUnits).toString().padStart(decimals + 1, '0');
  const whole = raw.slice(0, -decimals) || '0';
  const fraction = raw.slice(-decimals).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

export function isAtLeast(receivedUnits, expectedUnits) {
  return BigInt(receivedUnits) >= BigInt(expectedUnits);
}

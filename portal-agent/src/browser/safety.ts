const DANGEROUS_PATTERNS = [
  /delete/i,
  /remove/i,
  /reject/i,
  /approve/i,
  /withdraw/i,
  /transfer/i,
  /pay now/i,
  /submit payment/i,
  /deactivate/i,
  /disable/i,
  /refund/i,
  /write off/i,
  /drop database/i,
  /reset/i
];

export function isSafeLabel(label: string): boolean {
  const normalized = label.trim();
  if (!normalized) return false;
  return !DANGEROUS_PATTERNS.some((pattern) => pattern.test(normalized));
}

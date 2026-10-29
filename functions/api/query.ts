/**
 * Parses and clamps a numeric limit query parameter.
 * Returns defaultLimit if param is null, empty, non-numeric, or <= 0.
 * Clamps to maxLimit if parsed value exceeds maxLimit.
 */
export function parseLimit(param: string | null, defaultLimit: number, maxLimit: number): number {
  if (param === null) {
    return defaultLimit;
  }
  const trimmed = param.trim();
  if (!/^\d+$/.test(trimmed)) {
    return defaultLimit;
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (parsed <= 0) {
    return defaultLimit;
  }
  return Math.min(parsed, maxLimit);
}

/**
 * Parses a non-negative integer offset query parameter.
 * Returns 0 if param is null, empty, non-numeric, or negative.
 */
export function parseOffset(param: string | null): number {
  if (param === null) {
    return 0;
  }
  const trimmed = param.trim();
  if (!/^\d+$/.test(trimmed)) {
    return 0;
  }
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

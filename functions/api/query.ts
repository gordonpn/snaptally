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

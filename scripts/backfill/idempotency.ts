import { createHash } from "node:crypto";

/**
 * Computes a standard hex-encoded SHA-256 digest of string or buffer content.
 */
export function computeSha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Generates a deterministic RFC 4122 v4-formatted UUID from an input string
 * using SHA-256 hashing.
 */
export function generateDeterministicId(input: string): string {
  const hash = computeSha256(input);
  const clockSeq = ((Number.parseInt(hash.slice(16, 18), 16) & 0x3f) | 0x80).toString(16);

  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `4${hash.slice(13, 16)}`,
    clockSeq + hash.slice(18, 20),
    hash.slice(20, 32),
  ].join("-");
}

/**
 * Derives a content-based signature independent of mutable row positions.
 * Used to detect potential row-shift conflicts where the same transaction
 * appears under a different row-position hash key.
 */
export function computeContentSignature(
  date: string,
  merchant: string,
  grossAmount: number,
  currency: string,
): string {
  const normalizedMerchant = merchant.trim().toLowerCase().replace(/\s+/g, " ");
  return `${date.trim()}|${normalizedMerchant}|${grossAmount.toFixed(2)}|${currency.trim().toUpperCase()}`;
}

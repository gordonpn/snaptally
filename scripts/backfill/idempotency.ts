import { createHash } from "node:crypto";

/**
 * Generates a deterministic RFC 4122 v4-formatted UUID from an input string
 * using SHA-256 hashing.
 */
export function generateDeterministicId(input: string): string {
  const hash = createHash("sha256").update(input).digest("hex");
  const clockSeq = ((Number.parseInt(hash.slice(16, 18), 16) & 0x3f) | 0x80).toString(16);

  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `4${hash.slice(13, 16)}`,
    clockSeq + hash.slice(18, 20),
    hash.slice(20, 32),
  ].join("-");
}

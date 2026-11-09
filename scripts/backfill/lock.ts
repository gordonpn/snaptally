import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface LockMetadata {
  pid: number;
  userId: string;
  target: string;
  card: string;
  acquiredAt: string;
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    const error = err as NodeJS.ErrnoException;
    return error.code === "EPERM";
  }
}

/**
 * Acquires a non-blocking filesystem lock for the backfill operation.
 * Automatically cleans up stale locks left by terminated processes.
 */
export function acquireBackfillLock(
  artifactsDir: string,
  scope: { userId: string; target: string; card: string },
): () => void {
  mkdirSync(artifactsDir, { recursive: true });
  const lockFilePath = join(artifactsDir, "backfill.lock");

  if (existsSync(lockFilePath)) {
    try {
      const content = readFileSync(lockFilePath, "utf-8");
      const metadata = JSON.parse(content) as LockMetadata;

      if (isPidAlive(metadata.pid)) {
        throw new Error(
          `Concurrent backfill in progress: PID ${metadata.pid} is running for ${metadata.userId} (${metadata.card}) against ${metadata.target}. Acquired at ${metadata.acquiredAt}.`,
        );
      }

      // Process is dead; remove stale lock
      unlinkSync(lockFilePath);
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("Concurrent backfill in progress")) {
        throw err;
      }
      throw new Error(
        `Failed to acquire backfill lock: existing lock file at ${lockFilePath} is unreadable or currently being acquired.`,
      );
    }
  }

  const metadata: LockMetadata = {
    pid: process.pid,
    userId: scope.userId,
    target: scope.target,
    card: scope.card,
    acquiredAt: new Date().toISOString(),
  };

  try {
    writeFileSync(lockFilePath, JSON.stringify(metadata, null, 2), {
      encoding: "utf-8",
      flag: "wx",
      mode: 0o600,
    });
  } catch (err: unknown) {
    throw new Error(`Failed to acquire backfill lock: ${String(err)}`);
  }

  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    try {
      if (existsSync(lockFilePath)) {
        const content = readFileSync(lockFilePath, "utf-8");
        const existing = JSON.parse(content) as LockMetadata;
        if (existing.pid === process.pid) {
          unlinkSync(lockFilePath);
        }
      }
    } catch {
      // Ignored
    }
  };

  process.once("exit", release);

  return release;
}

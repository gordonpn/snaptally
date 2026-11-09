import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RunArtifact } from "./types.ts";

export function resolveArtifactPath(artifactsDir: string, runId: string, prefix = "run"): string {
  return join(artifactsDir, `${prefix}-${runId}.json`);
}

/**
 * Writes an auditable JSON artifact recording run configuration, manifest,
 * row counts, verification results, and representative IDs.
 * Strictly excludes raw source transaction rows, amounts, or personal financial details.
 */
export function writeRunArtifact(
  artifactsDir: string,
  artifact: RunArtifact,
  prefix = "run",
): string {
  mkdirSync(artifactsDir, { recursive: true });
  const artifactPath = resolveArtifactPath(artifactsDir, artifact.runId, prefix);

  const sanitizedConflicts = artifact.conflicts.map((c) => ({
    ...c,
    sourceValue: "[REDACTED]",
    dbValue: "[REDACTED]",
  }));

  const sanitizedArtifact: RunArtifact = {
    ...artifact,
    conflicts: sanitizedConflicts,
  };

  const content = JSON.stringify(sanitizedArtifact, null, 2);
  writeFileSync(artifactPath, content, { encoding: "utf-8", mode: 0o600 });
  return artifactPath;
}

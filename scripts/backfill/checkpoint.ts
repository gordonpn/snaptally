import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { CheckpointState } from "./types.ts";

export function resolveCheckpointPath(artifactsDir: string, runId: string): string {
  return join(artifactsDir, `${runId}.checkpoint.json`);
}

export function saveCheckpoint(checkpointPath: string, state: CheckpointState): void {
  mkdirSync(dirname(checkpointPath), { recursive: true });
  const content = JSON.stringify(state, null, 2);
  writeFileSync(checkpointPath, content, { encoding: "utf-8", mode: 0o600 });
}

export function loadCheckpoint(checkpointPath: string): CheckpointState | null {
  if (!existsSync(checkpointPath)) {
    return null;
  }
  const content = readFileSync(checkpointPath, "utf-8");
  return JSON.parse(content) as CheckpointState;
}

export function deleteCheckpoint(checkpointPath: string): void {
  if (existsSync(checkpointPath)) {
    unlinkSync(checkpointPath);
  }
}

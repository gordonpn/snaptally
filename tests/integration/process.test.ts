import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { stop } from "./process.ts";

test("cleanup finishes after a failed spawn", async () => {
  const child = spawn("/nonexistent-snaptally-executable", [], { detached: true });
  await once(child, "error");

  await stop(child);

  assert.equal(child.pid, undefined);
});

test("cleanup terminates a detached child and tolerates repeated cleanup", async () => {
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL("./fixtures/wait.mjs", import.meta.url))],
    {
      detached: true,
      stdio: "ignore",
    },
  );
  await once(child, "spawn");

  await stop(child);
  await stop(child);

  assert.equal(child.signalCode, "SIGTERM");
});

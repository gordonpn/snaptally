import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { localFixtures } from "../../scripts/local-fixtures.mjs";
import { stop } from "./process.ts";

if (process.platform === "win32") {
  throw new Error("The local integration harness supports macOS and Linux process groups.");
}

const repoRoot = resolve(import.meta.dirname, "../..");
const env = {
  ...process.env,
  ASTRO_TELEMETRY_DISABLED: "1",
  CI: "true",
  WRANGLER_SEND_METRICS: "false",
  BROWSER: "none",
};

async function ensureDistBuild(): Promise<void> {
  if (existsSync(resolve(repoRoot, "dist", "index.html"))) return;

  const build = spawn("pnpm", ["build"], {
    cwd: repoRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let buildOutput = "";
  for (const stream of [build.stdout, build.stderr]) {
    stream?.on("data", (chunk) => {
      buildOutput = (buildOutput + String(chunk)).slice(-20_000);
    });
  }
  const code = await new Promise<number | null>((done, reject) => {
    build.once("error", reject);
    build.once("exit", done);
  });
  assert.equal(code, 0, `pnpm build failed:\n${buildOutput}`);
}

async function waitForServerReady(
  server: ChildProcess,
  getOutput: () => string,
  getSpawnError: () => Error | undefined,
): Promise<string> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const spawnError = getSpawnError();
    if (spawnError) throw spawnError;
    assert.equal(server.exitCode, null, getOutput());

    const match = /Ready on (http:\/\/127\.0\.0\.1:\d+)/.exec(getOutput());
    if (match) {
      try {
        const response = await fetch(match[1], { signal: AbortSignal.timeout(5_000) });
        if (response.status === 200) return match[1];
      } catch {
        // The local listener may not be accepting connections yet.
      }
    }
    await delay(200);
  }
  throw new Error(`Wrangler Pages dev did not become ready:\n${getOutput()}`);
}

test("localFixtures reset refuses while a real wrangler pages dev server is active and succeeds after stop", {
  timeout: 150_000,
}, async () => {
  await ensureDistBuild();

  const tempRoot = await mkdtemp(join(tmpdir(), "snaptally-fixture-guard-"));
  let server: ChildProcess | undefined;
  try {
    for (const entry of ["node_modules", "migrations", "seeds", "wrangler.jsonc", "dist"]) {
      await symlink(resolve(repoRoot, entry), resolve(tempRoot, entry));
    }

    localFixtures(["seed"], tempRoot);

    const stateDir = resolve(tempRoot, ".wrangler/dev-fixtures");
    let output = "";
    let spawnError: Error | undefined;

    try {
      server = spawn(
        resolve(tempRoot, "node_modules/.bin/wrangler"),
        ["pages", "dev", "./dist", "--ip", "127.0.0.1", "--port", "0", "--persist-to", stateDir],
        {
          cwd: tempRoot,
          detached: true,
          env,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      server.once("error", (error) => {
        spawnError = error;
      });
      for (const stream of [server.stdout, server.stderr]) {
        stream?.on("data", (chunk) => {
          output = (output + String(chunk)).slice(-20_000);
        });
      }

      await waitForServerReady(
        server,
        () => output,
        () => spawnError,
      );

      assert.throws(
        () => localFixtures(["reset"], tempRoot),
        /active fixture-backed local Pages server detected/,
      );
    } finally {
      if (server) await stop(server);
    }

    localFixtures(["reset"], tempRoot);
    assert.equal(existsSync(resolve(stateDir, ".snaptally-fixtures")), true);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

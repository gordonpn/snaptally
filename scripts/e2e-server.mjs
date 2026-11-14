import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";

// This fixture always uses disposable local D1 state and a public test-only token.
const state = resolve(".wrangler/e2e");
const env = { ...process.env, ASTRO_TELEMETRY_DISABLED: "1", CI: "true" };

async function run(binary, args) {
  const child = spawn(resolve("node_modules/.bin", binary), args, {
    stdio: "inherit",
    env,
  });
  const code = await new Promise((done, reject) => {
    child.on("error", reject);
    child.on("exit", done);
  });
  if (code !== 0) throw new Error(`${binary} exited with ${code}`);
}

await rm(state, { recursive: true, force: true });
await run("astro", ["build"]);
await run("wrangler", ["d1", "migrations", "apply", "budget-db", "--local", "--persist-to", state]);
const server = spawn(
  resolve("node_modules/.bin/wrangler"),
  [
    "pages",
    "dev",
    "dist",
    "--ip",
    "127.0.0.1",
    "--port",
    "8793",
    "--persist-to",
    state,
    "--binding",
    "API_BEARER_TOKEN=snaptally-e2e-only",
  ],
  { stdio: "inherit", env },
);
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.kill(signal));
}
server.on("exit", (code) => process.exit(code ?? 1));

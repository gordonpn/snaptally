import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const marker = ".snaptally-fixtures";
const identity = "SnapTally disposable local fixtures v1\n";
const stagingPrefix = ".dev-fixtures-staging-";
const backupPrefix = ".dev-fixtures-backup-";

function defaultListProcesses() {
  const result = spawnSync("ps", ["-eo", "pid=,args="], { encoding: "utf8" });
  if (result.error || result.status !== 0 || typeof result.stdout !== "string") {
    console.warn(
      "Fixture process scan unavailable; stop all fixture-backed servers before continuing.",
    );
    return [];
  }
  return result.stdout
    .split(/\r?\n/)
    .map((line) => /^\s*(\d+)\s+(.+)$/.exec(line))
    .filter((match) => match !== null)
    .map((match) => ({ pid: Number.parseInt(match[1], 10), args: match[2] }));
}

function findActiveFixtureServers(parent, state, listProcesses) {
  const realParent = existsSync(parent) ? realpathSync(parent) : null;
  const realState = realParent ? resolve(realParent, "dev-fixtures") : null;
  const serverProcess = /\bwrangler\b[\s\S]*\bpages\s+dev\b|\bworkerd\b/;

  return listProcesses().filter((proc) => {
    if (!proc || proc.pid === process.pid || typeof proc.args !== "string") {
      return false;
    }
    if (/local-fixtures\.(?:mjs|test\.ts)/.test(proc.args)) {
      return false;
    }
    if (!serverProcess.test(proc.args)) {
      return false;
    }
    return proc.args.includes(state) || (realState !== null && proc.args.includes(realState));
  });
}

function hasValidOwnership(dir) {
  const ownership = resolve(dir, marker);
  const entry = lstatSync(ownership, { throwIfNoEntry: false });
  return Boolean(
    entry?.isFile() && !entry.isSymbolicLink() && readFileSync(ownership, "utf8") === identity,
  );
}

function assertSafeStateDirs(parent, state, lockPath) {
  for (const path of [parent, state]) {
    const entry = lstatSync(path, { throwIfNoEntry: false });
    if (entry && (!entry.isDirectory() || entry.isSymbolicLink())) {
      throw new Error(`Refusing non-directory or symlink: ${path}`);
    }
  }
  const lockEntry = lstatSync(lockPath, { throwIfNoEntry: false });
  if (lockEntry && (lockEntry.isSymbolicLink() || !lockEntry.isFile())) {
    throw new Error(`Refusing non-file or symlink lock path: ${lockPath}`);
  }
}

function assertOwnedState(state) {
  if (existsSync(state) && readdirSync(state).length > 0 && !hasValidOwnership(state)) {
    throw new Error("Refusing unowned fixture directory; preserve it and choose a clean checkout.");
  }
}

function acquireFixtureLock(lockPath, command, token) {
  const payload = JSON.stringify({
    pid: process.pid,
    token,
    command,
    acquiredAt: new Date().toISOString(),
  });

  try {
    writeFileSync(lockPath, payload, { encoding: "utf8", flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    // Automatic stale-lock deletion races with another process acquiring a replacement lock.
    throw new Error(
      `Fixture command already in progress or interrupted: ${lockPath}. Stop all fixture commands and servers before removing the lock manually.`,
    );
  }

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    process.off("exit", release);
    try {
      const current = JSON.parse(readFileSync(lockPath, "utf8"));
      if (current?.token === token) {
        unlinkSync(lockPath);
      }
    } catch {
      // Lock file already removed or unreadable during cleanup.
    }
  };
  process.once("exit", release);
  return release;
}

function cleanupTransientDirs(parent, state) {
  for (const name of readdirSync(parent)) {
    if (!name.startsWith(stagingPrefix) && !name.startsWith(backupPrefix)) continue;
    const candidate = resolve(parent, name);
    const stat = lstatSync(candidate, { throwIfNoEntry: false });
    if (!stat || stat.isSymbolicLink() || !stat.isDirectory() || !hasValidOwnership(candidate)) {
      continue;
    }
    if (name.startsWith(backupPrefix) && !existsSync(state)) {
      renameSync(candidate, state);
      continue;
    }
    rmSync(candidate, { recursive: true, force: true });
  }
}

function commitStagedState(parent, state, staging, token) {
  if (!existsSync(state)) {
    renameSync(staging, state);
    return;
  }
  const backup = resolve(parent, `${backupPrefix}${token}`);
  renameSync(state, backup);
  try {
    renameSync(staging, state);
  } catch (error) {
    renameSync(backup, state);
    throw error;
  }
  rmSync(backup, { recursive: true, force: true });
}

// No target, environment, database name or persistence path can be supplied by CLI.
export function localFixtures(
  args,
  root = process.cwd(),
  run = spawnSync,
  listProcesses = defaultListProcesses,
) {
  if (args.length !== 1 || !["seed", "reset"].includes(args[0])) {
    throw new Error("Usage: node scripts/local-fixtures.mjs seed|reset (local only)");
  }
  const command = args[0];
  const parent = resolve(root, ".wrangler");
  const state = resolve(parent, "dev-fixtures");
  const lockPath = resolve(parent, "dev-fixtures.lock");

  assertSafeStateDirs(parent, state, lockPath);
  mkdirSync(parent, { recursive: true });

  const token = randomUUID();
  const releaseLock = acquireFixtureLock(lockPath, command, token);
  try {
    const activeServers = findActiveFixtureServers(parent, state, listProcesses);
    if (activeServers.length > 0) {
      const pids = activeServers.map((proc) => proc.pid).join(", ");
      throw new Error(
        `Refusing fixture ${command}: active fixture-backed local Pages server detected (PID ${pids}). Stop the server before running ${command}.`,
      );
    }

    assertOwnedState(state);
    cleanupTransientDirs(parent, state);

    const staging = resolve(parent, `${stagingPrefix}${token}`);
    try {
      if (command === "seed" && existsSync(state)) {
        cpSync(state, staging, { recursive: true });
      } else {
        mkdirSync(staging, { recursive: true });
      }
      writeFileSync(resolve(staging, marker), identity);

      const invoke = (cmdArgs) => {
        const result = run(resolve(root, "node_modules/.bin/wrangler"), cmdArgs, {
          cwd: root,
          stdio: "inherit",
          env: { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false" },
        });
        if (result.error) throw result.error;
        if (result.status !== 0) throw new Error(`Local Wrangler failed (${result.status})`);
      };

      const target = ["budget-db", "--local", "--persist-to", staging];
      invoke(["d1", "migrations", "apply", ...target]);
      for (const file of ["dev_seed.sql", "monthly_budgets_demo.sql"]) {
        invoke(["d1", "execute", ...target, "--file", resolve(root, "seeds", file)]);
      }

      commitStagedState(parent, state, staging, token);
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  } finally {
    releaseLock();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  localFixtures(args);
  console.log(`Local fixtures ${args[0]} completed.`);
}

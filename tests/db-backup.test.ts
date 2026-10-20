import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, before, beforeEach, describe, it } from "node:test";

const SCRIPT_PATH = resolve(import.meta.dirname, "../scripts/db-backup.sh");

function runScript(args: readonly string[]): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(SCRIPT_PATH, args, {
      encoding: "utf-8",
      env: { ...process.env, NODE_V8_COVERAGE: "" },
    });
    return { status: 0, stdout, stderr: "" };
  } catch (error: unknown) {
    const err = error as { status?: number; stdout?: string; stderr?: string };
    return {
      status: err.status ?? 1,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
    };
  }
}

describe("Database Backup Script (scripts/db-backup.sh)", () => {
  let tempDir: string;

  before(() => {
    execFileSync("pnpm", ["wrangler", "d1", "migrations", "apply", "budget-db", "--local"], {
      input: "y\n",
      encoding: "utf-8",
      env: { ...process.env, NODE_V8_COVERAGE: "" },
    });
  });

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "snaptally-backup-test-"));
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("prints usage information with --help and exits with code 0", () => {
    const result = runScript(["--help"]);
    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /Usage: .*db-backup\.sh/);
  });

  it("fails when neither --remote nor --local is specified", () => {
    const result = runScript([]);
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /Target is required: specify either --remote or --local/);
  });

  it("fails when both --remote and --local are specified", () => {
    const result = runScript(["--remote", "--local"]);
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /Cannot specify both --remote and --local/);
  });

  it("fails when an unknown option is passed", () => {
    const result = runScript(["--local", "--unknown-flag"]);
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /Unknown argument: --unknown-flag/);
  });

  it("fails when --db is missing its argument", () => {
    const result = runScript(["--local", "--db"]);
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /--db requires a database name/);
  });

  it("fails when --database is missing its argument", () => {
    const result = runScript(["--local", "--database"]);
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /--database requires a database name/);
  });

  it("fails when --output-dir is missing its argument", () => {
    const result = runScript(["--local", "--output-dir"]);
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /--output-dir requires a directory path/);
  });

  it("fails with informative error when an invalid database name is provided", () => {
    const result = runScript(["--local", "--database", "nonexistent-db", "--output-dir", tempDir]);
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /nonexistent-db/);
  });

  it("exports local D1 database snapshot cleanly with restrictive permissions", () => {
    const result = runScript(["--local", "--database", "budget-db", "--output-dir", tempDir]);
    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /Backup created successfully:/);

    const files = readdirSync(tempDir).filter((f) => f.endsWith(".sql"));
    assert.strictEqual(files.length, 1);

    const backupFile = join(tempDir, files[0]);
    const content = readFileSync(backupFile, "utf-8");

    assert.ok(content.length > 0);
    assert.match(content, /CREATE TABLE.*transactions/);

    const fileStat = statSync(backupFile);
    assert.strictEqual(fileStat.mode & 0o777, 0o600);

    const dirStat = statSync(tempDir);
    assert.strictEqual(dirStat.mode & 0o777, 0o700);
  });

  it("preserves previous snapshots without overwriting when multiple backups run", () => {
    const result1 = runScript(["--local", "--db", "budget-db", "--output-dir", tempDir]);
    assert.strictEqual(result1.status, 0);

    const result2 = runScript(["--local", "--db", "budget-db", "--output-dir", tempDir]);
    assert.strictEqual(result2.status, 0);

    const files = readdirSync(tempDir).filter((f) => f.endsWith(".sql"));
    assert.strictEqual(files.length, 2);
  });
});

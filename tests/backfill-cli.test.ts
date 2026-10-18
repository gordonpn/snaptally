import assert from "node:assert/strict";
import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, it } from "node:test";

const CLI = resolve(import.meta.dirname, "../scripts/backfill.ts");
const FIXTURES_DIR = resolve(import.meta.dirname, "fixtures/backfill");

function runCli(args: readonly string[]): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: "utf-8" });
}

describe("Backfill CLI", () => {
  it("prints help without requiring input files", () => {
    const result = runCli(["--help"]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Usage: node scripts\/backfill.ts/);
    assert.equal(result.stderr, "");
  });

  it("defaults to dry-run and reports the synthetic sheets", () => {
    const result = runCli(["--dir", FIXTURES_DIR]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /DRY RUN \(no DB writes\)/);
    assert.match(result.stdout, /Total Valid Transactions : 19/);
    assert.match(result.stdout, /Zero database writes executed/);
    assert.equal(result.stderr, "");
  });

  for (const target of ["--local", "--remote"]) {
    it(`honors explicit dry-run with ${target}`, () => {
      const result = runCli([target, "--dry-run", "--dir", FIXTURES_DIR]);

      assert.equal(result.status, 0);
      assert.match(result.stdout, /Zero database writes executed/);
      assert.equal(result.stderr, "");
    });
  }

  it("rejects unknown flags", () => {
    const result = runCli(["--dry-run", "--user_id", "wrong-tenant", "--dir", FIXTURES_DIR]);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unknown option/);
  });

  it("rejects simultaneous local and remote targets", () => {
    const result = runCli(["--local", "--remote", "--dry-run", "--dir", FIXTURES_DIR]);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Choose either --local or --remote/);
  });

  it("rejects a missing string option value", () => {
    const result = runCli(["--dir"]);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /argument missing|requires an argument/);
  });

  it("reports a missing input directory as a failure", () => {
    const result = runCli(["--dir", resolve(FIXTURES_DIR, "missing")]);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Sheet directory not found/);
    assert.doesNotMatch(result.stdout, /completed successfully/);
  });
});

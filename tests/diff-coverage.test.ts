import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  evaluateDiffCoverage,
  parseLcov,
  parseUnifiedDiff,
  runCli,
} from "../scripts/check-diff-coverage.mjs";

describe("Diff Coverage Checker", () => {
  it("parses LCOV records relative to root directory", () => {
    const lcov = [
      "SF:/repo/src/utils/date.ts",
      "DA:10,2",
      "DA:11,0",
      "end_of_record",
      "SF:./functions/api/auth.ts",
      "DA:5,1",
      "end_of_record",
    ].join("\n");

    const map = parseLcov(lcov, "/repo");
    assert.strictEqual(map.get("src/utils/date.ts")?.get(10), 2);
    assert.strictEqual(map.get("src/utils/date.ts")?.get(11), 0);
    assert.strictEqual(map.get("functions/api/auth.ts")?.get(5), 1);
  });

  it("parses unified git diff for tracked source paths only", () => {
    const diff = [
      "diff --git a/README.md b/README.md",
      "+++ b/README.md",
      "@@ -1,0 +2,3 @@",
      "diff --git a/src/scripts/intake-form.ts b/src/scripts/intake-form.ts",
      "+++ b/src/scripts/intake-form.ts",
      "@@ -10,0 +12,2 @@",
      "@@ -30,1 +35 @@",
      "diff --git a/tests/auth.test.ts b/tests/auth.test.ts",
      "+++ b/tests/auth.test.ts",
      "@@ -1,0 +1,5 @@",
    ].join("\n");

    const changed = parseUnifiedDiff(diff);
    assert.strictEqual(changed.has("README.md"), false);
    assert.strictEqual(changed.has("tests/auth.test.ts"), false);
    assert.deepStrictEqual(
      Array.from(changed.get("src/scripts/intake-form.ts") ?? []).sort((a, b) => a - b),
      [12, 13, 35],
    );
  });

  it("fails when uncovered diff lines drop below threshold", () => {
    const lcovMap = parseLcov(
      ["SF:src/a.ts", "DA:10,1", "DA:11,0", "DA:12,0", "end_of_record"].join("\n"),
      "/repo",
    );
    const diffMap = parseUnifiedDiff(["+++ b/src/a.ts", "@@ -9,0 +10,3 @@"].join("\n"));

    const result = evaluateDiffCoverage({ lcovMap, diffMap, threshold: 85 });
    assert.strictEqual(result.passed, false);
    assert.strictEqual(result.totalLines, 3);
    assert.strictEqual(result.coveredLines, 1);
    assert.deepStrictEqual(result.uncoveredByFile, { "src/a.ts": [11, 12] });
  });

  it("fails when a newly added source file is completely absent from LCOV", () => {
    const lcovMap = new Map();
    const diffMap = parseUnifiedDiff(
      ["+++ b/functions/api/new-endpoint.ts", "@@ -0,0 +1,4 @@"].join("\n"),
    );

    const result = evaluateDiffCoverage({ lcovMap, diffMap, threshold: 85 });
    assert.strictEqual(result.passed, false);
    assert.strictEqual(result.totalLines, 4);
    assert.strictEqual(result.coveredLines, 0);
    assert.deepStrictEqual(result.uncoveredByFile, {
      "functions/api/new-endpoint.ts": [1, 2, 3, 4],
    });
  });

  it("passes when there are no tracked source changes or all changed lines are covered", () => {
    const emptyResult = evaluateDiffCoverage({
      lcovMap: new Map(),
      diffMap: new Map(),
      threshold: 85,
    });
    assert.strictEqual(emptyResult.passed, true);
    assert.strictEqual(emptyResult.percentage, 100);

    const lcovMap = parseLcov(
      ["SF:src/a.ts", "DA:10,3", "DA:11,1", "end_of_record"].join("\n"),
      "/repo",
    );
    const diffMap = parseUnifiedDiff(["+++ b/src/a.ts", "@@ -9,0 +10,3 @@"].join("\n"));
    const coveredResult = evaluateDiffCoverage({ lcovMap, diffMap, threshold: 85 });
    assert.strictEqual(coveredResult.passed, true);
    assert.strictEqual(coveredResult.totalLines, 2);
    assert.strictEqual(coveredResult.coveredLines, 2);
  });

  it("runCli exits 1 when LCOV file is missing", () => {
    const errors: string[] = [];
    let exitCode: number | undefined;

    runCli({
      lcovPath: "/nonexistent/lcov.info",
      exit: (code) => {
        exitCode = code;
      },
      error: (msg) => errors.push(msg),
    });

    assert.strictEqual(exitCode, 1);
    assert.ok(errors.some((line) => line.includes("missing LCOV file")));
  });

  it("runCli passes and fails based on diff coverage against LCOV file", () => {
    const dir = mkdtempSync(join(tmpdir(), "diff-cov-"));
    try {
      const lcovPath = join(dir, "lcov.info");
      writeFileSync(lcovPath, "SF:src/a.ts\nDA:10,1\nDA:11,0\nend_of_record\n", "utf8");

      const logs: string[] = [];
      const errors: string[] = [];
      let exitCode: number | undefined;

      runCli({
        lcovPath,
        threshold: 85,
        execDiff: () => "+++ b/src/a.ts\n@@ -9,0 +10,1 @@\n",
        exit: (code) => {
          exitCode = code;
        },
        log: (msg) => logs.push(msg),
        error: (msg) => errors.push(msg),
      });

      assert.strictEqual(exitCode, undefined);
      assert.ok(logs.some((line) => line.includes("1/1 lines (100.00%")));
      assert.strictEqual(errors.length, 0);

      runCli({
        lcovPath,
        threshold: 85,
        execDiff: () => "+++ b/src/a.ts\n@@ -9,0 +10,2 @@\n",
        exit: (code) => {
          exitCode = code;
        },
        log: (msg) => logs.push(msg),
        error: (msg) => errors.push(msg),
      });

      assert.strictEqual(exitCode, 1);
      assert.ok(errors.some((line) => line.includes("src/a.ts: 11")));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

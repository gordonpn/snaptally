import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const TRACKED_PREFIXES = ["src/", "functions/", "scripts/"];
const TRACKED_EXTENSIONS = [".ts", ".js", ".mjs"];

/**
 * Parse LCOV content into a map of relative file paths to line hit counts.
 * @param {string} lcovText
 * @param {string} [rootDir]
 * @returns {Map<string, Map<number, number>>}
 */
export function parseLcov(lcovText, rootDir = process.cwd()) {
  const files = new Map();
  let currentFile = null;
  const resolvedRoot = resolve(rootDir).replace(/\\/g, "/");

  for (const rawLine of lcovText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("SF:")) {
      let path = line.slice(3).replace(/\\/g, "/");
      if (path.startsWith(`${resolvedRoot}/`)) {
        path = path.slice(resolvedRoot.length + 1);
      } else if (path.startsWith("./")) {
        path = path.slice(2);
      }
      currentFile = path;
      if (!files.has(currentFile)) {
        files.set(currentFile, new Map());
      }
    } else if (line.startsWith("DA:") && currentFile) {
      const [lineNumStr, hitsStr] = line.slice(3).split(",");
      const lineNum = Number.parseInt(lineNumStr, 10);
      const hits = Number.parseInt(hitsStr, 10);
      if (Number.isFinite(lineNum) && Number.isFinite(hits)) {
        files.get(currentFile).set(lineNum, hits);
      }
    } else if (line === "end_of_record") {
      currentFile = null;
    }
  }
  return files;
}

/**
 * Parse unified git diff (-U0) into a map of tracked source files to added/modified line numbers.
 * @param {string} diffText
 * @returns {Map<string, Set<number>>}
 */
export function parseUnifiedDiff(diffText) {
  const changed = new Map();
  let currentFile = null;

  for (const line of diffText.split(/\r?\n/)) {
    if (line.startsWith("+++ b/")) {
      const path = line.slice(6).replace(/\\/g, "/");
      const isTracked =
        TRACKED_PREFIXES.some((p) => path.startsWith(p)) &&
        TRACKED_EXTENSIONS.some((ext) => path.endsWith(ext));
      currentFile = isTracked ? path : null;
      if (currentFile && !changed.has(currentFile)) {
        changed.set(currentFile, new Set());
      }
    } else if (line.startsWith("@@ ") && currentFile) {
      const match = /\+(\d+)(?:,(\d+))?/.exec(line);
      if (!match) continue;
      const start = Number.parseInt(match[1], 10);
      const count = match[2] === undefined ? 1 : Number.parseInt(match[2], 10);
      const lineSet = changed.get(currentFile);
      for (let i = 0; i < count; i += 1) {
        lineSet.add(start + i);
      }
    }
  }
  return changed;
}

/**
 * Evaluate diff line coverage against LCOV data.
 * @param {{ lcovMap: Map<string, Map<number, number>>, diffMap: Map<string, Set<number>>, threshold?: number }} input
 * @returns {{ totalLines: number, coveredLines: number, percentage: number, passed: boolean, uncoveredByFile: Record<string, number[]> }}
 */
export function evaluateDiffCoverage({ lcovMap, diffMap, threshold = 85 }) {
  let totalLines = 0;
  let coveredLines = 0;
  const uncoveredByFile = {};

  for (const [filePath, changedLines] of diffMap.entries()) {
    const fileCoverage = lcovMap.get(filePath);
    if (!fileCoverage) {
      if (changedLines.size > 0) {
        const sorted = Array.from(changedLines).sort((a, b) => a - b);
        totalLines += sorted.length;
        uncoveredByFile[filePath] = sorted;
      }
      continue;
    }

    const uncovered = [];
    for (const lineNum of changedLines) {
      if (!fileCoverage.has(lineNum)) {
        continue;
      }
      totalLines += 1;
      if (fileCoverage.get(lineNum) > 0) {
        coveredLines += 1;
      } else {
        uncovered.push(lineNum);
      }
    }
    if (uncovered.length > 0) {
      uncoveredByFile[filePath] = uncovered.sort((a, b) => a - b);
    }
  }

  const percentage = totalLines === 0 ? 100 : (coveredLines / totalLines) * 100;
  return {
    totalLines,
    coveredLines,
    percentage,
    passed: percentage >= threshold,
    uncoveredByFile,
  };
}

function runCli() {
  const lcovPath = process.env.LCOV_PATH ?? "coverage/lcov.info";
  const threshold = Number.parseFloat(process.env.DIFF_COVERAGE_MIN ?? "85");
  const baseRef = process.env.GITHUB_BASE_REF
    ? `origin/${process.env.GITHUB_BASE_REF}`
    : "origin/main";

  if (!existsSync(lcovPath)) {
    console.error(`Diff coverage check failed: missing LCOV file at ${lcovPath}`);
    process.exit(1);
  }

  const lcovText = readFileSync(lcovPath, "utf8");
  const diffText = execFileSync("git", ["diff", "-U0", "--diff-filter=AMR", `${baseRef}...HEAD`], {
    encoding: "utf8",
  });

  const lcovMap = parseLcov(lcovText);
  const diffMap = parseUnifiedDiff(diffText);
  const result = evaluateDiffCoverage({ lcovMap, diffMap, threshold });

  console.log(
    `Diff coverage: ${result.coveredLines}/${result.totalLines} lines (${result.percentage.toFixed(2)}%, threshold ${threshold}%)`,
  );

  if (!result.passed) {
    console.error("Uncovered diff lines:");
    for (const [file, lines] of Object.entries(result.uncoveredByFile)) {
      console.error(`  ${file}: ${lines.join(", ")}`);
    }
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}

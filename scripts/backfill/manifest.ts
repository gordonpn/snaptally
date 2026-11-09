import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { ALL_ADAPTERS } from "./adapters.ts";
import { parseCsv } from "./csv.ts";
import { computeSha256 } from "./idempotency.ts";
import type { BackfillManifest, BackfillOptions, SourceFileManifest } from "./types.ts";

export const BACKFILL_PARSER_VERSION = "1.0.0";
export const BACKFILL_MANIFEST_VERSION = "1.0";

/**
 * Builds a deterministic, versioned BackfillManifest from source CSV files.
 */
export function buildManifest(
  targetDir: string,
  options: Pick<BackfillOptions, "userId" | "defaultCard">,
  specificFile?: string,
): BackfillManifest {
  const resolvedDir = resolve(targetDir);
  let filePaths: string[] = [];

  if (specificFile) {
    const resolvedPath = resolve(specificFile);
    if (!existsSync(resolvedPath)) {
      throw new Error(`Specified file not found: ${specificFile}`);
    }
    filePaths = [resolvedPath];
  } else {
    if (!existsSync(resolvedDir)) {
      throw new Error(`Sheet directory not found: ${resolvedDir}`);
    }
    filePaths = readdirSync(resolvedDir)
      .filter((f) => f.endsWith(".csv") && !f.toLowerCase().includes("general"))
      .sort()
      .map((f) => join(resolvedDir, f));
  }

  const files: SourceFileManifest[] = [];
  let totalValidTransactions = 0;
  let totalSkippedRows = 0;

  for (const filePath of filePaths) {
    const filename = basename(filePath);
    const adapter = ALL_ADAPTERS.find((a) => a.match(filename));
    if (!adapter) {
      if (specificFile) {
        throw new Error(`No adapter found for file: ${filename}`);
      }
      continue;
    }

    const content = readFileSync(filePath, "utf-8");
    const sha256 = computeSha256(content);
    const rows = parseCsv(content);
    const transactions = adapter.parse(rows, filename, {
      userId: options.userId,
      defaultCard: options.defaultCard,
      dryRun: true,
      local: false,
      remote: false,
    });

    const totalRows = Math.max(0, rows.length - 1);
    const validCount = transactions.length;
    const skippedCount = totalRows - validCount;

    files.push({
      filename,
      sha256,
      totalRows,
      validTransactions: validCount,
      skippedRows: skippedCount,
    });

    totalValidTransactions += validCount;
    totalSkippedRows += skippedCount;
  }

  files.sort((a, b) => a.filename.localeCompare(b.filename));

  const manifestPayload = {
    manifestVersion: BACKFILL_MANIFEST_VERSION,
    sourceDir: resolvedDir,
    userId: options.userId,
    defaultCard: options.defaultCard,
    parserVersion: BACKFILL_PARSER_VERSION,
    files,
    totalValidTransactions,
    totalSkippedRows,
  };

  const manifestHash = computeSha256(JSON.stringify(manifestPayload));

  return {
    ...manifestPayload,
    manifestHash,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Validates that current source files strictly match a prior manifest.
 * Throws an explicit error describing missing, modified, or added files.
 */
export function validateManifestMatch(
  manifest: BackfillManifest,
  currentDir: string,
  options: Pick<BackfillOptions, "userId" | "defaultCard">,
): void {
  if (manifest.userId !== options.userId) {
    throw new Error(
      `Manifest tenant mismatch: planned for ${manifest.userId}, received ${options.userId}`,
    );
  }

  if (manifest.defaultCard !== options.defaultCard) {
    throw new Error(
      `Manifest card mismatch: planned for ${manifest.defaultCard}, received ${options.defaultCard}`,
    );
  }

  const currentManifest = buildManifest(currentDir, options);

  if (currentManifest.manifestHash !== manifest.manifestHash) {
    const expectedMap = new Map(manifest.files.map((f) => [f.filename, f.sha256]));
    const currentMap = new Map(currentManifest.files.map((f) => [f.filename, f.sha256]));

    const missingFiles: string[] = [];
    const modifiedFiles: string[] = [];
    const extraFiles: string[] = [];

    for (const [name, hash] of expectedMap) {
      if (!currentMap.has(name)) {
        missingFiles.push(name);
      } else if (currentMap.get(name) !== hash) {
        modifiedFiles.push(name);
      }
    }

    for (const name of currentMap.keys()) {
      if (!expectedMap.has(name)) {
        extraFiles.push(name);
      }
    }

    const details: string[] = [];
    if (missingFiles.length > 0) details.push(`missing: ${missingFiles.join(", ")}`);
    if (modifiedFiles.length > 0) details.push(`modified: ${modifiedFiles.join(", ")}`);
    if (extraFiles.length > 0) details.push(`extra: ${extraFiles.join(", ")}`);

    throw new Error(
      `Source files do not match reviewed plan manifest (${manifest.manifestHash.slice(0, 8)} != ${currentManifest.manifestHash.slice(0, 8)}). Details: ${details.join("; ")}. Run plan first to review changes.`,
    );
  }
}

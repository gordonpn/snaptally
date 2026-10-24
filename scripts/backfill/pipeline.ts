import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { ALL_ADAPTERS } from "./adapters.ts";
import { parseCsv } from "./csv.ts";
import type {
  BackfillOptions,
  BackfillSummary,
  BackfillTransaction,
  SheetSummary,
} from "./types.ts";

function escapeSql(val: string): string {
  return `'${val.replace(/'/g, "''")}'`;
}

export function generateInsertSql(tx: BackfillTransaction): string {
  return `INSERT INTO transactions (id, user_id, date, card, parent_bucket, subcategory, merchant, gross_amount, reimbursement, currency) VALUES (${escapeSql(tx.id)}, ${escapeSql(tx.userId)}, ${escapeSql(tx.date)}, ${escapeSql(tx.card)}, ${escapeSql(tx.parentBucket)}, ${escapeSql(tx.subcategory)}, ${escapeSql(tx.merchant)}, ${tx.grossAmount.toFixed(2)}, ${tx.reimbursement.toFixed(2)}, ${escapeSql(tx.currency)}) ON CONFLICT(id) DO NOTHING;`;
}

export function executeD1Batch(
  statements: string[],
  isLocal: boolean,
  isRemote: boolean,
): { success: boolean; stdout: string } {
  if (statements.length === 0) {
    return { success: true, stdout: "" };
  }

  const batchSql = statements.join("\n");
  const tempFile = join(
    tmpdir(),
    `snaptally-batch-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`,
  );
  writeFileSync(tempFile, batchSql, { encoding: "utf-8", mode: 0o600, flag: "wx" });

  try {
    const args = ["wrangler", "d1", "execute", "budget-db"];
    if (isLocal) {
      args.push("--local");
    } else if (isRemote) {
      args.push("--remote");
    }
    args.push("--file", tempFile);

    const stdout = execFileSync("pnpm", args, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });

    return { success: true, stdout };
  } finally {
    if (existsSync(tempFile)) {
      unlinkSync(tempFile);
    }
  }
}

export function resolveTargetDir(baseDir: string): string {
  const resolved = resolve(baseDir);
  if (!existsSync(resolved)) {
    return resolved;
  }

  const directCsvs = readdirSync(resolved).filter(
    (f) => f.endsWith(".csv") && !f.toLowerCase().includes("general"),
  );
  if (directCsvs.length > 0) {
    return resolved;
  }

  const entries = readdirSync(resolved, { withFileTypes: true });
  const dateDirs = entries
    .filter((e) => e.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(e.name))
    .map((e) => e.name)
    .sort()
    .reverse();

  for (const dateDir of dateDirs) {
    const candidatePath = join(resolved, dateDir, "01_CURRENT_BUDGETS");
    if (existsSync(candidatePath)) {
      const budgetCsvs = readdirSync(candidatePath).filter(
        (f) => f.endsWith(".csv") && !f.toLowerCase().includes("general"),
      );
      if (budgetCsvs.length > 0) {
        return candidatePath;
      }
    }

    const directDatePath = join(resolved, dateDir);
    const dateCsvs = readdirSync(directDatePath).filter(
      (f) => f.endsWith(".csv") && !f.toLowerCase().includes("general"),
    );
    if (dateCsvs.length > 0) {
      return directDatePath;
    }
  }

  const subCurrentBudgets = join(resolved, "01_CURRENT_BUDGETS");
  if (existsSync(subCurrentBudgets)) {
    const budgetCsvs = readdirSync(subCurrentBudgets).filter(
      (f) => f.endsWith(".csv") && !f.toLowerCase().includes("general"),
    );
    if (budgetCsvs.length > 0) {
      return subCurrentBudgets;
    }
  }

  return resolved;
}

export async function runBackfill(options: BackfillOptions): Promise<BackfillSummary> {
  const targetDir = resolveTargetDir(options.dir ?? "data/sheets");
  let filePaths: string[] = [];

  if (options.file) {
    const resolvedPath = resolve(options.file);
    if (!existsSync(resolvedPath)) {
      throw new Error(`Specified file not found: ${options.file}`);
    }
    filePaths = [resolvedPath];
  } else {
    if (!existsSync(targetDir)) {
      throw new Error(`Sheet directory not found: ${targetDir}`);
    }
    filePaths = readdirSync(targetDir)
      .filter((f) => f.endsWith(".csv") && !f.toLowerCase().includes("general"))
      .sort()
      .map((f) => join(targetDir, f));
  }

  const sheets: SheetSummary[] = [];
  const allTransactions: BackfillTransaction[] = [];
  const categoryBreakdown: Record<string, number> = {};

  for (const filePath of filePaths) {
    const filename = basename(filePath);
    const adapter = ALL_ADAPTERS.find((a) => a.match(filename));

    if (!adapter) {
      if (options.file) {
        throw new Error(`No adapter found for file: ${filename}`);
      }
      continue;
    }

    const content = readFileSync(filePath, "utf-8");
    const rows = parseCsv(content);
    const transactions = adapter.parse(rows, filename, options);

    const totalRows = Math.max(0, rows.length - 1);
    const validCount = transactions.length;
    const skippedCount = totalRows - validCount;
    const usdCount = transactions.filter((t) => t.currency === "USD").length;
    const cadCount = transactions.filter((t) => t.currency === "CAD").length;

    sheets.push({
      file: filename,
      totalRows,
      validTransactions: validCount,
      skippedRows: skippedCount,
      usdCount,
      cadCount,
    });

    allTransactions.push(...transactions);

    for (const tx of transactions) {
      const key = `${tx.parentBucket} -> ${tx.subcategory}`;
      categoryBreakdown[key] = (categoryBreakdown[key] || 0) + 1;
    }
  }

  const summary: BackfillSummary = {
    sheets,
    totalValid: allTransactions.length,
    totalSkipped: sheets.reduce((acc, s) => acc + s.skippedRows, 0),
    totalUsd: allTransactions.filter((t) => t.currency === "USD").length,
    totalCad: allTransactions.filter((t) => t.currency === "CAD").length,
    categoryBreakdown,
  };

  if ((options.local || options.remote) && !options.dryRun && allTransactions.length > 0) {
    const batchSize = 100;
    const statements = allTransactions.map(generateInsertSql);

    for (let i = 0; i < statements.length; i += batchSize) {
      const chunk = statements.slice(i, i + batchSize);
      executeD1Batch(chunk, options.local, options.remote);
    }
  }

  return summary;
}

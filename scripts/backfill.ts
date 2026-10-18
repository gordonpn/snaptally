import { parseArgs } from "node:util";
import { runBackfill } from "./backfill/pipeline.ts";
import type { BackfillOptions } from "./backfill/types.ts";

function printHelp(): void {
  console.log(`
Usage: node scripts/backfill.ts [options]

Options:
  --dir <path>           Directory containing CSV sheets (default: data/sheets)
  --file <path>          Specific CSV file to parse and backfill
  --dry-run              Dry run validation mode without database execution (default)
  --local                Execute batch inserts against local D1 database
  --remote               Execute batch inserts against production Cloudflare D1
  --user-id <id>         Tenant user ID (default: usr_default)
  --default-card <card>  Fallback card name (default: Historical)
  --help                 Show this help message
`);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      dir: { type: "string" },
      file: { type: "string" },
      "dry-run": { type: "boolean" },
      local: { type: "boolean" },
      remote: { type: "boolean" },
      "user-id": { type: "string" },
      "default-card": { type: "string" },
      help: { type: "boolean" },
    },
  });

  if (values.help) {
    printHelp();
    return;
  }

  const isLocal = Boolean(values.local);
  const isRemote = Boolean(values.remote);
  if (isLocal && isRemote) {
    throw new Error("Choose either --local or --remote, not both.");
  }
  // Default to dry-run if neither local nor remote is specified
  const isDryRun = Boolean(values["dry-run"]) || (!isLocal && !isRemote);

  const options: BackfillOptions = {
    userId: values["user-id"] ?? "usr_default",
    defaultCard: values["default-card"] ?? "Historical",
    dryRun: isDryRun,
    local: isLocal,
    remote: isRemote,
    dir: values.dir ?? "data/sheets",
    file: values.file,
  };

  const mode = isDryRun ? "DRY RUN (no DB writes)" : isLocal ? "LOCAL D1" : "REMOTE D1";
  console.log(`Starting historical Google Sheets backfill [Mode: ${mode}]...\n`);

  const summary = await runBackfill(options);

  console.log("=== Sheet Breakdown ===");
  console.table(summary.sheets);

  console.log("\n=== Categorization Distribution ===");
  console.table(summary.categoryBreakdown);

  console.log("\n=== Summary Totals ===");
  console.log(`Total Valid Transactions : ${summary.totalValid}`);
  console.log(`USD Transactions         : ${summary.totalUsd}`);
  console.log(`CAD Transactions         : ${summary.totalCad}`);
  console.log(`Skipped (0/empty/formula): ${summary.totalSkipped}`);

  if (isDryRun) {
    console.log("\nDry run completed successfully. Zero database writes executed.");
  } else {
    console.log(
      `\nBackfill execution completed successfully. Target: ${isLocal ? "Local D1" : "Production D1"}.`,
    );
  }
}

main().catch((err: unknown) => {
  console.error("Backfill pipeline failed:", err);
  process.exit(1);
});

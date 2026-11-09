import { execFileSync } from "node:child_process";
import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { BackfillTarget, ExistingDbTransaction } from "./types.ts";

export interface BackfillDatabaseClient {
  target: BackfillTarget;
  queryMigrations(): Promise<string[]>;
  queryExistingTransactions(userId: string, card: string): Promise<ExistingDbTransaction[]>;
  queryTransactionCount(userId: string, card: string): Promise<number>;
  executeBatch(statements: string[]): Promise<{ success: boolean; stdout: string }>;
}

function escapeSqlLiteral(val: string): string {
  return `'${val.replace(/'/g, "''")}'`;
}

function parseJsonOutput<T>(stdout: string): T {
  const start = stdout.indexOf("[");
  const end = stdout.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`Failed to find JSON array in wrangler output: ${stdout}`);
  }
  const jsonStr = stdout.slice(start, end + 1);
  return JSON.parse(jsonStr) as T;
}

/**
 * Wrangler D1 client executing queries and batches against local or remote Cloudflare D1.
 */
export class WranglerD1Client implements BackfillDatabaseClient {
  readonly target: "local" | "remote";

  constructor(target: "local" | "remote") {
    this.target = target;
  }

  private executeCommand(sql: string): string {
    const args = [
      "wrangler",
      "d1",
      "execute",
      "budget-db",
      `--${this.target}`,
      "--json",
      "--command",
      sql,
    ];
    return execFileSync("pnpm", args, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 50 * 1024 * 1024,
    });
  }

  private executeFile(tempFile: string): string {
    const args = ["wrangler", "d1", "execute", "budget-db", `--${this.target}`, "--file", tempFile];
    return execFileSync("pnpm", args, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 50 * 1024 * 1024,
    });
  }

  async queryMigrations(): Promise<string[]> {
    const sql = "SELECT name FROM d1_migrations ORDER BY name ASC;";
    const stdout = this.executeCommand(sql);
    const parsed = parseJsonOutput<Array<{ results: Array<{ name: string }> }>>(stdout);
    const rows = parsed[0]?.results ?? [];
    return rows.map((r) => r.name);
  }

  async queryExistingTransactions(userId: string, card: string): Promise<ExistingDbTransaction[]> {
    const sql = `SELECT id, user_id, date, card, parent_bucket, subcategory, merchant, gross_amount, reimbursement, currency FROM transactions WHERE user_id = ${escapeSqlLiteral(userId)} AND card = ${escapeSqlLiteral(card)} ORDER BY date ASC, id ASC;`;
    const stdout = this.executeCommand(sql);
    const parsed = parseJsonOutput<Array<{ results: ExistingDbTransaction[] }>>(stdout);
    return parsed[0]?.results ?? [];
  }

  async queryTransactionCount(userId: string, card: string): Promise<number> {
    const sql = `SELECT count(*) as count FROM transactions WHERE user_id = ${escapeSqlLiteral(userId)} AND card = ${escapeSqlLiteral(card)};`;
    const stdout = this.executeCommand(sql);
    const parsed = parseJsonOutput<Array<{ results: Array<{ count: number }> }>>(stdout);
    return parsed[0]?.results[0]?.count ?? 0;
  }

  async executeBatch(statements: string[]): Promise<{ success: boolean; stdout: string }> {
    if (statements.length === 0) {
      return { success: true, stdout: "" };
    }
    const tempFile = join(
      tmpdir(),
      `snaptally-batch-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`,
    );
    const sql = statements.join("\n");
    writeFileSync(tempFile, sql, { encoding: "utf-8", mode: 0o600, flag: "wx" });

    try {
      const stdout = this.executeFile(tempFile);
      return { success: true, stdout };
    } finally {
      if (existsSync(tempFile)) {
        unlinkSync(tempFile);
      }
    }
  }
}

/**
 * In-memory SQLite client implementing BackfillDatabaseClient for fast testing.
 */
export class MemoryDatabaseClient implements BackfillDatabaseClient {
  readonly target: BackfillTarget = "memory";
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  async queryMigrations(): Promise<string[]> {
    try {
      const rows = this.db
        .prepare("SELECT name FROM d1_migrations ORDER BY name ASC;")
        .all() as Array<{ name: string }>;
      if (rows.length > 0) {
        return rows.map((r) => r.name);
      }
    } catch {
      // d1_migrations table may not exist in pure SQLite test harness
    }

    try {
      const tables = this.db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='transactions';")
        .all();
      if (tables.length > 0) {
        return ["0000_init.sql"];
      }
    } catch {
      return [];
    }

    return [];
  }

  async queryExistingTransactions(userId: string, card: string): Promise<ExistingDbTransaction[]> {
    const stmt = this.db.prepare(
      "SELECT id, user_id, date, card, parent_bucket, subcategory, merchant, gross_amount, reimbursement, currency FROM transactions WHERE user_id = ? AND card = ? ORDER BY date ASC, id ASC;",
    );
    const rows = stmt.all(userId, card);
    return rows.map((r) => ({
      id: String(r.id),
      user_id: String(r.user_id),
      date: String(r.date),
      card: String(r.card),
      parent_bucket: String(r.parent_bucket),
      subcategory: String(r.subcategory),
      merchant: String(r.merchant),
      gross_amount: Number(r.gross_amount),
      reimbursement: Number(r.reimbursement ?? 0),
      currency: String(r.currency),
    }));
  }

  async queryTransactionCount(userId: string, card: string): Promise<number> {
    const stmt = this.db.prepare(
      "SELECT count(*) as count FROM transactions WHERE user_id = ? AND card = ?;",
    );
    const row = stmt.get(userId, card) as { count: number } | undefined;
    return row?.count ?? 0;
  }

  async executeBatch(statements: string[]): Promise<{ success: boolean; stdout: string }> {
    if (statements.length === 0) {
      return { success: true, stdout: "" };
    }
    for (const sql of statements) {
      this.db.exec(sql);
    }
    return { success: true, stdout: "batch executed" };
  }
}

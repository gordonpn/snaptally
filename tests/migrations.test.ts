import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";

describe("Multi-tenant Schema Migrations", () => {
  const initSql = readFileSync(resolve("migrations/0000_init.sql"), "utf-8");
  const expandedSchemaSql = readFileSync(resolve("migrations/0001_expanded_schema.sql"), "utf-8");
  const multiTenantSchemaSql = readFileSync(
    resolve("migrations/0002_multi_tenant_schema.sql"),
    "utf-8",
  );
  const insertTransactionQuery = readFileSync(resolve("queries/insert_transaction.sql"), "utf-8");

  /**
   * Creates an in-memory SQLite database instance with foreign keys enabled
   * and all schema migrations applied sequentially.
   *
   * @returns An initialized DatabaseSync instance with the latest schema.
   */
  function createMigratedDatabase(): DatabaseSync {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec(initSql);
    db.exec(expandedSchemaSql);
    db.exec(multiTenantSchemaSql);
    return db;
  }

  it("applies migration 0002 cleanly and seeds default user (Scenario 1)", () => {
    const db = createMigratedDatabase();

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%';")
      .all() as Array<{ name: string }>;
    const tableNames = tables.map((t) => t.name);

    assert.ok(tableNames.includes("users"));
    assert.ok(tableNames.includes("user_tokens"));
    assert.ok(tableNames.includes("transactions"));

    const defaultUser = db.prepare("SELECT * FROM users WHERE id = ?").get("usr_default") as Record<
      string,
      unknown
    >;

    assert.ok(defaultUser);
    assert.strictEqual(defaultUser.id, "usr_default");
    assert.strictEqual(defaultUser.name, "Default User");

    const transactionIndexes = db.prepare("PRAGMA index_list(transactions)").all() as Array<{
      name: string;
    }>;
    const transactionIndexNames = transactionIndexes.map((idx) => idx.name);

    assert.ok(transactionIndexNames.includes("idx_transactions_user_date"));
    assert.ok(transactionIndexNames.includes("idx_transactions_date_created_at"));
    assert.ok(transactionIndexNames.includes("idx_transactions_merchant"));

    const tokenIndexes = db.prepare("PRAGMA index_list(user_tokens)").all() as Array<{
      name: string;
    }>;
    const tokenIndexNames = tokenIndexes.map((idx) => idx.name);

    assert.ok(tokenIndexNames.includes("idx_user_tokens_user_id"));
    assert.ok(tokenIndexNames.includes("idx_user_tokens_lookup"));

    const fkViolations = db.prepare("PRAGMA foreign_key_check;").all();
    assert.strictEqual(fkViolations.length, 0);

    db.close();
  });

  it("migrates existing transactions to default user", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec(initSql);

    db.exec(`
      INSERT INTO transactions (id, amount, card, category, merchant, created_at)
      VALUES ('tx-legacy-1', 42.0, 'Amex Gold', 'Groceries', 'Trader Joe', '2026-09-20 10:00:00');
    `);

    db.exec(expandedSchemaSql);
    db.exec(multiTenantSchemaSql);

    const row = db.prepare("SELECT * FROM transactions WHERE id = ?").get("tx-legacy-1") as Record<
      string,
      unknown
    >;

    assert.ok(row);
    assert.strictEqual(row.id, "tx-legacy-1");
    assert.strictEqual(row.user_id, "usr_default");
    assert.strictEqual(row.merchant, "Trader Joe");
    assert.strictEqual(row.gross_amount, 42.0);

    db.close();
  });

  it("enforces foreign key constraints on transactions (Scenario 2)", () => {
    const db = createMigratedDatabase();

    assert.throws(
      () => {
        db.prepare(`
          INSERT INTO transactions (
            id, user_id, date, card, parent_bucket, subcategory, merchant, gross_amount, reimbursement
          ) VALUES (
            'tx-invalid-user', 'usr_nonexistent', '2026-09-30', 'Amex', 'Variable', 'Dining', 'Cafe', 15.0, 0.0
          );
        `).run();
      },
      (err: unknown) => {
        const error = err as Error & { code?: string; errcode?: number };
        return (
          error.code === "ERR_SQLITE_ERROR" &&
          (error.errcode === 787 || /FOREIGN KEY constraint failed/.test(error.message))
        );
      },
    );

    db.close();
  });

  it("enforces foreign key constraints on user_tokens", () => {
    const db = createMigratedDatabase();

    assert.throws(
      () => {
        db.prepare(`
          INSERT INTO user_tokens (id, user_id, token_hash, label)
          VALUES ('tok-1', 'usr_nonexistent', 'hash1234567890', 'Mobile Client');
        `).run();
      },
      (err: unknown) => {
        const error = err as Error & { code?: string; errcode?: number };
        return (
          error.code === "ERR_SQLITE_ERROR" &&
          (error.errcode === 787 || /FOREIGN KEY constraint failed/.test(error.message))
        );
      },
    );

    db.close();
  });

  it("prevents duplicate token hashes in user_tokens (Scenario 3)", () => {
    const db = createMigratedDatabase();

    db.prepare(`
      INSERT INTO user_tokens (id, user_id, token_hash, label)
      VALUES ('tok-1', 'usr_default', 'unique-token-hash-1', 'Default Token');
    `).run();

    assert.throws(
      () => {
        db.prepare(`
          INSERT INTO user_tokens (id, user_id, token_hash, label)
          VALUES ('tok-2', 'usr_default', 'unique-token-hash-1', 'Duplicate Token');
        `).run();
      },
      (err: unknown) => {
        const error = err as Error & { code?: string; errcode?: number };
        return (
          error.code === "ERR_SQLITE_ERROR" &&
          (error.errcode === 2067 || /UNIQUE constraint failed/.test(error.message))
        );
      },
    );

    db.close();
  });

  it("cascades deletion of user to transactions and tokens", () => {
    const db = createMigratedDatabase();

    db.prepare(`
      INSERT INTO users (id, name)
      VALUES ('usr_alice', 'Alice');
    `).run();

    db.prepare(`
      INSERT INTO user_tokens (id, user_id, token_hash, label)
      VALUES ('tok-alice-1', 'usr_alice', 'alice-token-hash-1', 'Alice Phone');
    `).run();

    db.prepare(`
      INSERT INTO transactions (
        id, user_id, date, card, parent_bucket, subcategory, merchant, gross_amount, reimbursement
      ) VALUES (
        'tx-alice-1', 'usr_alice', '2026-09-30', 'Visa', 'Fixed Costs', 'Groceries', 'Market', 50.0, 0.0
      );
    `).run();

    const aliceTokenBefore = db.prepare("SELECT * FROM user_tokens WHERE id = 'tok-alice-1'").get();
    const aliceTxBefore = db.prepare("SELECT * FROM transactions WHERE id = 'tx-alice-1'").get();
    assert.ok(aliceTokenBefore);
    assert.ok(aliceTxBefore);

    db.prepare("DELETE FROM users WHERE id = ?").run("usr_alice");

    const aliceTokenAfter = db.prepare("SELECT * FROM user_tokens WHERE id = 'tok-alice-1'").get();
    const aliceTxAfter = db.prepare("SELECT * FROM transactions WHERE id = 'tx-alice-1'").get();
    assert.strictEqual(aliceTokenAfter, undefined);
    assert.strictEqual(aliceTxAfter, undefined);

    db.close();
  });

  it("defaults user_id to usr_default when omitted on transaction insert", () => {
    const db = createMigratedDatabase();

    db.prepare(`
      INSERT INTO transactions (
        id, date, card, parent_bucket, subcategory, merchant, gross_amount, reimbursement
      ) VALUES (
        'tx-default-user', '2026-09-30', 'Amex', 'Guilt-Free', 'Coffee', 'George Howell', 4.5, 0.0
      );
    `).run();

    const row = db
      .prepare("SELECT * FROM transactions WHERE id = ?")
      .get("tx-default-user") as Record<string, unknown>;

    assert.ok(row);
    assert.strictEqual(row.user_id, "usr_default");
    assert.strictEqual(row.gross_amount, 4.5);
    assert.strictEqual(row.net_spend, 4.5);

    db.close();
  });

  it("supports existing insert_transaction query without user_id parameter", () => {
    const db = createMigratedDatabase();

    const insertStmt = db.prepare(insertTransactionQuery);
    insertStmt.run(
      "tx-query-test",
      "2026-09-30",
      "Amex Gold",
      "Variable",
      "Dining",
      "George Howell",
      25.5,
      0.0,
    );

    const row = db
      .prepare("SELECT * FROM transactions WHERE id = ?")
      .get("tx-query-test") as Record<string, unknown>;

    assert.ok(row);
    assert.strictEqual(row.user_id, "usr_default");
    assert.strictEqual(row.gross_amount, 25.5);
    assert.strictEqual(row.net_spend, 25.5);

    db.close();
  });
});

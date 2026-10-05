import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createTestDatabase } from "./helpers/db.ts";

describe("Test Database Helper", () => {
  it("discovers and executes all schema migrations in ascending order (Scenario 1)", () => {
    const db = createTestDatabase();

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

    const fkViolations = db.prepare("PRAGMA foreign_key_check;").all();
    assert.strictEqual(fkViolations.length, 0);

    db.close();
  });

  it("enforces foreign keys by default (Scenario 2)", () => {
    const db = createTestDatabase();

    const pragmaRow = db.prepare("PRAGMA foreign_keys;").get() as { foreign_keys: number };
    assert.strictEqual(pragmaRow.foreign_keys, 1);

    assert.throws(
      () => {
        db.prepare(`
          INSERT INTO transactions (
            id, user_id, date, card, parent_bucket, subcategory, merchant, gross_amount, reimbursement
          ) VALUES (
            'tx-fk-fail', 'usr_nonexistent', '2026-09-30', 'Amex', 'Variable', 'Dining', 'Cafe', 12.0, 0.0
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

  it("allows disabling foreign keys via options", () => {
    const db = createTestDatabase({ foreignKeys: false });

    const pragmaRow = db.prepare("PRAGMA foreign_keys;").get() as { foreign_keys: number };
    assert.strictEqual(pragmaRow.foreign_keys, 0);

    db.prepare(`
      INSERT INTO transactions (
        id, user_id, date, card, parent_bucket, subcategory, merchant, gross_amount, reimbursement
      ) VALUES (
        'tx-fk-disabled', 'usr_nonexistent', '2026-09-30', 'Amex', 'Variable', 'Dining', 'Cafe', 12.0, 0.0
      );
    `).run();

    const row = db
      .prepare("SELECT id, user_id FROM transactions WHERE id = ?")
      .get("tx-fk-disabled") as { id: string; user_id: string };

    assert.ok(row);
    assert.strictEqual(row.user_id, "usr_nonexistent");

    db.close();
  });

  it("loads migrations sequentially from a custom directory", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "migrations-test-"));
    try {
      writeFileSync(
        join(tempDir, "0000_first.sql"),
        "CREATE TABLE items (id TEXT PRIMARY KEY, title TEXT NOT NULL);",
      );
      writeFileSync(
        join(tempDir, "0001_second.sql"),
        "ALTER TABLE items ADD COLUMN priority INTEGER DEFAULT 1;",
      );

      const db = createTestDatabase({ migrationsDir: tempDir });

      db.prepare("INSERT INTO items (id, title) VALUES (?, ?);").run("item-1", "Test item");
      const row = db.prepare("SELECT * FROM items WHERE id = ?;").get("item-1") as {
        id: string;
        title: string;
        priority: number;
      };

      assert.ok(row);
      assert.strictEqual(row.id, "item-1");
      assert.strictEqual(row.title, "Test item");
      assert.strictEqual(row.priority, 1);

      db.close();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("throws descriptive error when migrations directory does not exist", () => {
    const nonExistentDir = join(tmpdir(), "non-existent-migrations-dir-12345");
    assert.throws(
      () => {
        createTestDatabase({ migrationsDir: nonExistentDir });
      },
      (err: unknown) => {
        const error = err as Error;
        return error.message.includes(`Migrations directory not found: ${nonExistentDir}`);
      },
    );
  });

  it("cleans up database handle and rethrows when migration execution fails", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "migrations-fail-test-"));
    try {
      writeFileSync(join(tempDir, "0000_broken.sql"), "INVALID SQL SYNTAX STATEMENT;");

      assert.throws(
        () => {
          createTestDatabase({ migrationsDir: tempDir });
        },
        (err: unknown) => {
          const error = err as Error;
          return error.message.includes("syntax error");
        },
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

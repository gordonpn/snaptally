import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { createTestDatabase } from "./helpers/db.ts";

describe("Multi-tenant Schema Migrations", () => {
  const initSql = readFileSync(resolve("migrations/0000_init.sql"), "utf-8");
  const expandedSchemaSql = readFileSync(resolve("migrations/0001_expanded_schema.sql"), "utf-8");
  const multiTenantSchemaSql = readFileSync(
    resolve("migrations/0002_multi_tenant_schema.sql"),
    "utf-8",
  );
  const insertTransactionQuery = readFileSync(resolve("queries/insert_transaction.sql"), "utf-8");

  it("applies migration 0002 cleanly and seeds default user (Scenario 1)", () => {
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
    const db = createTestDatabase();

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
    const db = createTestDatabase();

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
    const db = createTestDatabase();

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
    const db = createTestDatabase();

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
    const db = createTestDatabase();

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
    const db = createTestDatabase();

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
      "USD",
    );

    const row = db
      .prepare("SELECT * FROM transactions WHERE id = ?")
      .get("tx-query-test") as Record<string, unknown>;

    assert.ok(row);
    assert.strictEqual(row.user_id, "usr_default");
    assert.strictEqual(row.currency, "USD");
    assert.strictEqual(row.gross_amount, 25.5);
    assert.strictEqual(row.net_spend, 25.5);

    db.close();
  });
});

describe("Refund Reimbursement Invariant Migration (0003_enforce_refund_reimbursement_invariant.sql)", () => {
  const initSql = readFileSync(resolve("migrations/0000_init.sql"), "utf-8");
  const expandedSchemaSql = readFileSync(resolve("migrations/0001_expanded_schema.sql"), "utf-8");
  const multiTenantSchemaSql = readFileSync(
    resolve("migrations/0002_multi_tenant_schema.sql"),
    "utf-8",
  );
  const refundReimbursementSql = readFileSync(
    resolve("migrations/0003_enforce_refund_reimbursement_invariant.sql"),
    "utf-8",
  );

  it("remediates legacy rows with invalid reimbursements before creating triggers", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec(initSql);
    db.exec(expandedSchemaSql);
    db.exec(multiTenantSchemaSql);

    // Insert legacy rows that violate new invariants
    db.prepare(`
      INSERT INTO transactions (id, user_id, date, card, parent_bucket, subcategory, merchant, gross_amount, reimbursement)
      VALUES
        ('tx-legacy-exceed', 'usr_default', '2026-10-01', 'Amex', 'Variable', 'Dining', 'Posto', 50.0, 100.0),
        ('tx-legacy-neg-refund', 'usr_default', '2026-10-01', 'Amex', 'Variable', 'Dining', 'Posto', -60.0, 30.0),
        ('tx-legacy-neg-reimb', 'usr_default', '2026-10-01', 'Amex', 'Variable', 'Dining', 'Posto', 75.0, -15.0),
        ('tx-legacy-valid', 'usr_default', '2026-10-01', 'Amex', 'Variable', 'Dining', 'Posto', 120.0, 40.0);
    `).run();

    // Verify initial pre-migration state with violating values
    const preExceed = db
      .prepare("SELECT reimbursement, net_spend FROM transactions WHERE id = ?")
      .get("tx-legacy-exceed") as { reimbursement: number; net_spend: number };
    assert.strictEqual(preExceed.reimbursement, 100.0);
    assert.strictEqual(preExceed.net_spend, -50.0);

    // Execute migration 0003
    db.exec(refundReimbursementSql);

    // Verify remediated rows and automatically recomputed net_spend
    const postExceed = db
      .prepare("SELECT reimbursement, net_spend FROM transactions WHERE id = ?")
      .get("tx-legacy-exceed") as { reimbursement: number; net_spend: number };
    assert.strictEqual(postExceed.reimbursement, 50.0);
    assert.strictEqual(postExceed.net_spend, 0.0);

    const postNegRefund = db
      .prepare("SELECT reimbursement, net_spend FROM transactions WHERE id = ?")
      .get("tx-legacy-neg-refund") as { reimbursement: number; net_spend: number };
    assert.strictEqual(postNegRefund.reimbursement, 0.0);
    assert.strictEqual(postNegRefund.net_spend, -60.0);

    const postNegReimb = db
      .prepare("SELECT reimbursement, net_spend FROM transactions WHERE id = ?")
      .get("tx-legacy-neg-reimb") as { reimbursement: number; net_spend: number };
    assert.strictEqual(postNegReimb.reimbursement, 0.0);
    assert.strictEqual(postNegReimb.net_spend, 75.0);

    const postValid = db
      .prepare("SELECT reimbursement, net_spend FROM transactions WHERE id = ?")
      .get("tx-legacy-valid") as { reimbursement: number; net_spend: number };
    assert.strictEqual(postValid.reimbursement, 40.0);
    assert.strictEqual(postValid.net_spend, 80.0);

    db.close();
  });

  it("rejects insertion of negative gross_amount with non-zero reimbursement at database level", () => {
    const db = createTestDatabase();

    // Valid positive transaction with reimbursement
    assert.doesNotThrow(() => {
      db.prepare(`
        INSERT INTO transactions (id, user_id, date, card, parent_bucket, subcategory, merchant, gross_amount, reimbursement)
        VALUES ('tx-valid-pos', 'usr_default', '2026-10-01', 'Amex Gold', 'Guilt-Free', 'Dining', 'Posto', 120.0, 60.0);
      `).run();
    });

    // Valid negative transaction with zero reimbursement
    assert.doesNotThrow(() => {
      db.prepare(`
        INSERT INTO transactions (id, user_id, date, card, parent_bucket, subcategory, merchant, gross_amount, reimbursement)
        VALUES ('tx-valid-neg', 'usr_default', '2026-10-01', 'Amex Gold', 'Guilt-Free', 'Dining', 'Posto', -60.0, 0.0);
      `).run();
    });

    // Invalid negative transaction with non-zero reimbursement
    assert.throws(
      () => {
        db.prepare(`
          INSERT INTO transactions (id, user_id, date, card, parent_bucket, subcategory, merchant, gross_amount, reimbursement)
          VALUES ('tx-invalid-neg', 'usr_default', '2026-10-01', 'Amex Gold', 'Guilt-Free', 'Dining', 'Posto', -60.0, 30.0);
        `).run();
      },
      (err: unknown) => {
        const error = err as Error;
        return /Invalid transaction reimbursement amount/.test(error.message);
      },
    );

    // Invalid positive transaction with reimbursement exceeding gross_amount
    assert.throws(
      () => {
        db.prepare(`
          INSERT INTO transactions (id, user_id, date, card, parent_bucket, subcategory, merchant, gross_amount, reimbursement)
          VALUES ('tx-invalid-exceed', 'usr_default', '2026-10-01', 'Amex Gold', 'Guilt-Free', 'Dining', 'Posto', 50.0, 100.0);
        `).run();
      },
      (err: unknown) => {
        const error = err as Error;
        return /Invalid transaction reimbursement amount/.test(error.message);
      },
    );

    // Invalid positive transaction with negative reimbursement
    assert.throws(
      () => {
        db.prepare(`
          INSERT INTO transactions (id, user_id, date, card, parent_bucket, subcategory, merchant, gross_amount, reimbursement)
          VALUES ('tx-invalid-neg-reimb', 'usr_default', '2026-10-01', 'Amex Gold', 'Guilt-Free', 'Dining', 'Posto', 50.0, -10.0);
        `).run();
      },
      (err: unknown) => {
        const error = err as Error;
        return /Invalid transaction reimbursement amount/.test(error.message);
      },
    );

    db.close();
  });

  it("rejects updating gross_amount or reimbursement to violate invariants", () => {
    const db = createTestDatabase();

    db.prepare(`
      INSERT INTO transactions (id, user_id, date, card, parent_bucket, subcategory, merchant, gross_amount, reimbursement)
      VALUES ('tx-update-test', 'usr_default', '2026-10-01', 'Amex Gold', 'Guilt-Free', 'Dining', 'Posto', 100.0, 20.0);
    `).run();

    // Updating reimbursement > gross_amount must fail
    assert.throws(
      () => {
        db.prepare("UPDATE transactions SET reimbursement = ? WHERE id = ?").run(
          150.0,
          "tx-update-test",
        );
      },
      (err: unknown) => {
        const error = err as Error;
        return /Invalid transaction reimbursement amount/.test(error.message);
      },
    );

    // Updating reimbursement < 0 must fail
    assert.throws(
      () => {
        db.prepare("UPDATE transactions SET reimbursement = ? WHERE id = ?").run(
          -10.0,
          "tx-update-test",
        );
      },
      (err: unknown) => {
        const error = err as Error;
        return /Invalid transaction reimbursement amount/.test(error.message);
      },
    );

    // Updating gross_amount below reimbursement must fail
    assert.throws(
      () => {
        db.prepare("UPDATE transactions SET gross_amount = ? WHERE id = ?").run(
          10.0,
          "tx-update-test",
        );
      },
      (err: unknown) => {
        const error = err as Error;
        return /Invalid transaction reimbursement amount/.test(error.message);
      },
    );

    // Valid update succeeds and recomputes net_spend
    assert.doesNotThrow(() => {
      db.prepare("UPDATE transactions SET reimbursement = ? WHERE id = ?").run(
        50.0,
        "tx-update-test",
      );
    });

    const updated = db
      .prepare("SELECT reimbursement, net_spend FROM transactions WHERE id = ?")
      .get("tx-update-test") as { reimbursement: number; net_spend: number };
    assert.strictEqual(updated.reimbursement, 50.0);
    assert.strictEqual(updated.net_spend, 50.0);

    db.close();
  });
});

describe("Taxonomy Migrations (0004_taxonomy_coffee_and_snacks.sql)", () => {
  const initSql = readFileSync(resolve("migrations/0000_init.sql"), "utf-8");
  const expandedSchemaSql = readFileSync(resolve("migrations/0001_expanded_schema.sql"), "utf-8");
  const multiTenantSchemaSql = readFileSync(
    resolve("migrations/0002_multi_tenant_schema.sql"),
    "utf-8",
  );
  const taxonomyMigrationSql = readFileSync(
    resolve("migrations/0004_taxonomy_coffee_and_snacks.sql"),
    "utf-8",
  );

  it("migrates existing Guilt-Free / Coffee rows to Coffee & Snacks while leaving other categories intact", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(initSql);
    db.exec(expandedSchemaSql);
    db.exec(multiTenantSchemaSql);

    db.exec(`
      INSERT INTO transactions (id, user_id, date, card, parent_bucket, subcategory, merchant, gross_amount, reimbursement)
      VALUES
        ('tx-coffee-1', 'usr_default', '2026-09-15', 'Amex Gold', 'Guilt-Free', 'Coffee', 'Blue Bottle', 5.50, 0.0),
        ('tx-dining-1', 'usr_default', '2026-09-15', 'Amex Gold', 'Guilt-Free', 'Dining', 'Posto', 45.00, 0.0),
        ('tx-fixed-coffee', 'usr_default', '2026-09-15', 'Fidelity Visa', 'Fixed Costs', 'Coffee', 'Office Supplies', 25.00, 0.0);
    `);

    db.exec(taxonomyMigrationSql);

    const coffeeRow = db
      .prepare("SELECT * FROM transactions WHERE id = ?")
      .get("tx-coffee-1") as Record<string, unknown>;
    assert.strictEqual(coffeeRow.subcategory, "Coffee & Snacks");

    const diningRow = db
      .prepare("SELECT * FROM transactions WHERE id = ?")
      .get("tx-dining-1") as Record<string, unknown>;
    assert.strictEqual(diningRow.subcategory, "Dining");

    const fixedRow = db
      .prepare("SELECT * FROM transactions WHERE id = ?")
      .get("tx-fixed-coffee") as Record<string, unknown>;
    assert.strictEqual(fixedRow.subcategory, "Coffee");

    db.close();
  });
});

describe("Currency Column Migration (0005_add_currency_to_transactions.sql)", () => {
  const initSql = readFileSync(resolve("migrations/0000_init.sql"), "utf-8");
  const expandedSchemaSql = readFileSync(resolve("migrations/0001_expanded_schema.sql"), "utf-8");
  const multiTenantSchemaSql = readFileSync(
    resolve("migrations/0002_multi_tenant_schema.sql"),
    "utf-8",
  );
  const currencyMigrationSql = readFileSync(
    resolve("migrations/0005_add_currency_to_transactions.sql"),
    "utf-8",
  );

  it("adds currency column defaulting to USD and preserves existing records", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(initSql);
    db.exec(expandedSchemaSql);
    db.exec(multiTenantSchemaSql);

    db.exec(`
      INSERT INTO transactions (id, user_id, date, card, parent_bucket, subcategory, merchant, gross_amount, reimbursement)
      VALUES ('tx-existing-usd', 'usr_default', '2026-09-15', 'Amex Gold', 'Guilt-Free', 'Dining', 'Posto', 45.00, 0.0);
    `);

    db.exec(currencyMigrationSql);

    const existingRow = db
      .prepare("SELECT * FROM transactions WHERE id = ?")
      .get("tx-existing-usd") as Record<string, unknown>;
    assert.strictEqual(existingRow.currency, "USD");

    db.exec(`
      INSERT INTO transactions (id, user_id, date, card, parent_bucket, subcategory, merchant, gross_amount, reimbursement, currency)
      VALUES ('tx-new-cad', 'usr_default', '2026-09-16', 'Amex Gold', 'Guilt-Free', 'Dining', 'Montreal Cafe', 22.50, 0.0, 'CAD');
    `);

    const cadRow = db
      .prepare("SELECT * FROM transactions WHERE id = ?")
      .get("tx-new-cad") as Record<string, unknown>;
    assert.strictEqual(cadRow.currency, "CAD");

    db.close();
  });
});

describe("Monthly budget targets migration (0006)", () => {
  const migrationName = "0006_monthly_budgets_schema.sql";
  const monthlyBudgetsSql = readFileSync(resolve("migrations", migrationName), "utf-8");
  const insertSql = `
    INSERT INTO monthly_budgets (id, year_month, parent_bucket, subcategory, target_amount)
    VALUES (?, ?, ?, ?, ?)
  `;

  it("creates an empty target table independently on a fresh database", (t) => {
    const db = new DatabaseSync(":memory:");
    t.after(() => db.close());
    db.exec(monthlyBudgetsSql);

    db.prepare(insertSql).run("budget-rent", "2026-11", "Fixed Costs", "Rent", 0);
    const row = db.prepare("SELECT * FROM monthly_budgets").get();
    assert.ok(row);
    assert.equal(row.id, "budget-rent");
    assert.equal(row.target_amount, 0);
    assert.match(String(row.created_at), /^\d{4}-\d{2}-\d{2} /);
  });

  it("rejects explicit null creation timestamps on insert and update", (t) => {
    const db = createTestDatabase();
    t.after(() => db.close());
    assert.throws(
      () =>
        db
          .prepare(`INSERT INTO monthly_budgets
        (id, year_month, parent_bucket, subcategory, target_amount, created_at)
        VALUES ('missing-time', '2026-11', 'Fixed Costs', 'Rent', 100, NULL)`)
          .run(),
      /NOT NULL constraint failed/,
    );
    db.prepare(insertSql).run("valid-time", "2026-11", "Fixed Costs", "Rent", 100);
    assert.throws(
      () => db.prepare("UPDATE monthly_budgets SET created_at = NULL").run(),
      /NOT NULL constraint failed/,
    );
    assert.match(
      String(db.prepare("SELECT created_at FROM monthly_budgets").get()?.created_at),
      /^\d{4}-\d{2}-\d{2} /,
    );
  });

  it("preserves existing transaction rows and does not seed production targets", (t) => {
    const db = new DatabaseSync(":memory:");
    t.after(() => db.close());
    db.exec("PRAGMA foreign_keys = ON");
    for (const file of readdirSync(resolve("migrations")).sort()) {
      if (file.endsWith(".sql") && file < migrationName) {
        db.exec(readFileSync(resolve("migrations", file), "utf-8"));
      }
    }
    db.prepare(`
      INSERT INTO transactions (
        id, date, card, parent_bucket, subcategory, merchant, gross_amount, reimbursement, currency
      ) VALUES ('tx-before-budgets', '2026-11-01', 'Visa', 'Fixed Costs', 'Groceries', 'Market', 12.5, 0, 'CAD')
    `).run();
    const before = db.prepare("SELECT * FROM transactions").all();

    db.exec(monthlyBudgetsSql);

    assert.deepEqual(db.prepare("SELECT * FROM transactions").all(), before);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM monthly_budgets").get()?.count, 0);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  });

  it("enforces unique category targets per month without conflating buckets or months", (t) => {
    const db = createTestDatabase();
    t.after(() => db.close());
    const insert = db.prepare(insertSql);
    insert.run("b1", "2026-11", "Savings", "Investments", 100);
    assert.throws(
      () => insert.run("b2", "2026-11", "Savings", "Investments", 200),
      /UNIQUE constraint failed/,
    );
    assert.doesNotThrow(() => insert.run("b3", "2026-12", "Savings", "Investments", 200));
    assert.doesNotThrow(() => insert.run("b4", "2026-11", "Investments", "Investments", 300));
    assert.throws(
      () => insert.run("b1", "2027-01", "Fixed Costs", "Rent", 400),
      /UNIQUE constraint failed/,
    );
  });

  it("rejects negative, nonnumeric, infinite, or missing targets on insert and update", (t) => {
    const db = createTestDatabase();
    t.after(() => db.close());
    const insert = db.prepare(insertSql);
    for (const amount of [-0.01, "not-a-number", Number.POSITIVE_INFINITY, null]) {
      assert.throws(
        () => insert.run("invalid", "2026-11", "Guilt-Free", "Dining", amount),
        /(?:CHECK|NOT NULL) constraint failed/,
      );
    }
    insert.run("valid", "2026-11", "Guilt-Free", "Dining", 123.45);
    assert.throws(
      () => db.prepare("UPDATE monthly_budgets SET target_amount = -1 WHERE id = 'valid'").run(),
      /CHECK constraint failed/,
    );
    assert.equal(
      db.prepare("SELECT target_amount FROM monthly_budgets").get()?.target_amount,
      123.45,
    );
  });

  it("requires complete keys and valid calendar month strings", (t) => {
    const db = createTestDatabase();
    t.after(() => db.close());
    const insert = db.prepare(insertSql);
    for (const month of ["2026-00", "2026-13", "2026-1", "26-01", "2026-01-01", "abcd-01", null]) {
      assert.throws(
        () => insert.run("invalid", month, "Fixed Costs", "Rent", 1),
        /(?:CHECK|NOT NULL) constraint failed/,
      );
    }
    assert.throws(() => insert.run(null, "2026-01", "Fixed Costs", "Rent", 1), /NOT NULL/);
    assert.throws(() => insert.run("missing", "2026-01", null, "Rent", 1), /NOT NULL/);
    assert.throws(() => insert.run("missing", "2026-01", "Fixed Costs", null, 1), /NOT NULL/);
    assert.doesNotThrow(() => insert.run("january", "2026-01", "Fixed Costs", "Rent", 1));
    assert.doesNotThrow(() => insert.run("december", "2026-12", "Fixed Costs", "Rent", 1));
  });

  it("loads four deterministic local demo buckets without overwriting edited targets", (t) => {
    const db = createTestDatabase();
    t.after(() => db.close());
    const seedSql = readFileSync(resolve("seeds/monthly_budgets_demo.sql"), "utf-8");
    db.exec(seedSql);
    const rows = db.prepare("SELECT * FROM monthly_budgets ORDER BY parent_bucket").all();
    assert.deepEqual(
      rows.map((row) => row.parent_bucket),
      ["Fixed Costs", "Guilt-Free", "Investments", "Savings"],
    );
    assert.ok(rows.every((row) => row.year_month === "2000-01" && row.target_amount === 0));

    db.prepare(
      "UPDATE monthly_budgets SET target_amount = 25 WHERE parent_bucket = 'Guilt-Free'",
    ).run();
    db.exec(seedSql);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM monthly_budgets").get()?.count, 4);
    assert.equal(
      db
        .prepare("SELECT target_amount FROM monthly_budgets WHERE parent_bucket = 'Guilt-Free'")
        .get()?.target_amount,
      25,
    );
  });
});

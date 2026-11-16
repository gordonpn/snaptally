import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { localFixtures } from "../scripts/local-fixtures.mjs";
import { conventions, lintSql } from "../scripts/sql-lint.mjs";
import { BUCKET_SUBCATEGORIES, type ParentBucket } from "../src/config/intake.ts";

const root = resolve(import.meta.dirname, "..");

test("local fixtures persist, seed idempotently and reset only owned state", () => {
  const temp = mkdtempSync(resolve(tmpdir(), "snaptally-fixtures-"));
  const calls: string[][] = [];
  // Execute the helper's migration/seed commands against actual disposable SQLite.
  const run = (_binary: string, args: string[]) => {
    calls.push(args);
    assert.ok(args.includes("--local"));
    assert.ok(!args.includes("--remote"));
    const state = args[args.indexOf("--persist-to") + 1];
    const db = new DatabaseSync(resolve(state, "test.sqlite"));
    try {
      db.exec("PRAGMA foreign_keys = ON");
      if (args[1] === "migrations") {
        db.exec("CREATE TABLE IF NOT EXISTS applied (name TEXT PRIMARY KEY)");
        for (const file of readdirSync(resolve(root, "migrations")).sort()) {
          if (db.prepare("SELECT name FROM applied WHERE name = ?").get(file)) continue;
          db.exec(readFileSync(resolve(root, "migrations", file), "utf8"));
          db.prepare("INSERT INTO applied (name) VALUES (?)").run(file);
        }
      } else db.exec(readFileSync(args[args.indexOf("--file") + 1], "utf8"));
    } finally {
      db.close();
    }
    return { status: 0 };
  };
  try {
    symlinkSync(resolve(root, "seeds"), resolve(temp, "seeds"));
    mkdirSync(resolve(temp, ".wrangler/state"), { recursive: true });
    writeFileSync(resolve(temp, ".wrangler/state/keep"), "user data");
    localFixtures(["seed"], temp, run);
    localFixtures(["seed"], temp, run);
    let db = new DatabaseSync(resolve(temp, ".wrangler/dev-fixtures/test.sqlite"));
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM transactions").get()?.n, 8);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM monthly_budgets").get()?.n, 4);
    for (const row of db.prepare("SELECT parent_bucket, subcategory FROM transactions").all()) {
      const categories: readonly string[] = BUCKET_SUBCATEGORIES[row.parent_bucket as ParentBucket];
      assert.ok(
        categories?.includes(String(row.subcategory)),
        `Invalid fixture category: ${row.parent_bucket}/${row.subcategory}`,
      );
    }

    const merchants = db
      .prepare(readFileSync(resolve(root, "queries/select_frequent_merchants.sql"), "utf8"))
      .all(20)
      .map((row) => row.merchant);
    for (const merchant of ["Trader Joe's", "George Howell", "Whole Foods"])
      assert.ok(merchants.includes(merchant));
    db.exec("DELETE FROM transactions WHERE id = 'demo-txn-001'");
    db.close();
    localFixtures(["reset"], temp, run);
    db = new DatabaseSync(resolve(temp, ".wrangler/dev-fixtures/test.sqlite"));
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM transactions").get()?.n, 8);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    db.close();
    assert.equal(readFileSync(resolve(temp, ".wrangler/state/keep"), "utf8"), "user data");
    assert.equal(calls.length, 9);
    assert.throws(() => localFixtures(["seed", "--remote"], temp, run), /Usage/);
    assert.throws(() => localFixtures(["production"], temp, run), /Usage/);
    const owned = resolve(temp, ".wrangler/dev-fixtures/.snaptally-fixtures");
    writeFileSync(owned, "unrecognized");
    assert.throws(() => localFixtures(["reset"], temp, run), /unowned/);
    rmSync(owned);
    assert.throws(() => localFixtures(["reset"], temp, run), /unowned/);
    rmSync(resolve(temp, ".wrangler/dev-fixtures"), { recursive: true });
    symlinkSync(resolve(temp, ".wrangler/state"), resolve(temp, ".wrangler/dev-fixtures"));
    assert.throws(() => localFixtures(["reset"], temp, run), /symlink/);
    rmSync(resolve(temp, ".wrangler/dev-fixtures"));
    symlinkSync(resolve(temp, "missing"), resolve(temp, ".wrangler/dev-fixtures"));
    assert.throws(() => localFixtures(["reset"], temp, run), /symlink/);
    rmSync(resolve(temp, ".wrangler/dev-fixtures"));
    assert.throws(() => localFixtures(["seed"], temp, () => ({ status: 1 })), /Wrangler failed/);
    assert.throws(
      () => localFixtures(["seed"], temp, () => ({ error: new Error("spawn failed") })),
      /spawn failed/,
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("SQL checks compile actual schema and queries and catch convention violations", () => {
  lintSql(root);
  const keywords = ["SELECT", "INSERT", "INTO", "VALUES"];
  assert.deepEqual(conventions("-- select *\nSELECT 'select *', COUNT(*) FROM t", keywords), []);
  assert.match(conventions("select * FROM t", keywords).join("\n"), /uppercase.*explicit/s);
  for (const query of ["SELECT t.* FROM t", "SELECT ALL * FROM t", "SELECT t . * FROM t"]) {
    assert.match(conventions(query, keywords).join("\n"), /explicit/);
  }
  assert.match(conventions("INSERT INTO t VALUES (1)", keywords).join("\n"), /column list/);
  assert.deepEqual(conventions("INSERT INTO t (id) VALUES (1)", keywords), []);
  const temp = mkdtempSync(resolve(tmpdir(), "snaptally-sql-lint-"));
  try {
    mkdirSync(resolve(temp, "scripts"));
    mkdirSync(resolve(temp, "queries"));
    writeFileSync(
      resolve(temp, "scripts/sql-lint.json"),
      JSON.stringify({
        directories: ["queries"],
        uppercaseKeywords: keywords,
        indexProbes: [{ sql: "SELECT 1", index: "missing_index" }],
      }),
    );
    writeFileSync(resolve(temp, "queries/bad.sql"), "select missing FROM absent");
    assert.throws(() => lintSql(temp), /uppercase[\s\S]*no such table[\s\S]*missing_index/);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("fixture CLI rejects remote targets before writes and SQL lint CLI reports success", () => {
  const temp = mkdtempSync(resolve(tmpdir(), "snaptally-fixture-cli-"));
  try {
    const rejected = spawnSync(
      process.execPath,
      [resolve(root, "scripts/local-fixtures.mjs"), "seed", "--remote"],
      { cwd: temp, encoding: "utf8" },
    );
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /local only/);
    assert.deepEqual(readdirSync(temp), []);
    const checked = spawnSync(process.execPath, [resolve(root, "scripts/sql-lint.mjs")], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(checked.status, 0, checked.stderr);
    assert.match(
      checked.stdout,
      /SQLite schema, query compilation, conventions and index probes passed/,
    );
    mkdirSync(resolve(temp, "scripts"));
    mkdirSync(resolve(temp, "migrations"));
    writeFileSync(
      resolve(temp, "scripts/sql-lint.json"),
      JSON.stringify({ directories: ["migrations"], uppercaseKeywords: [], indexProbes: [] }),
    );
    writeFileSync(resolve(temp, "migrations/broken.sql"), "CREATE TABLE broken (");
    const invalid = spawnSync(process.execPath, [resolve(root, "scripts/sql-lint.mjs")], {
      cwd: temp,
      encoding: "utf8",
    });
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /migrations\/broken.sql/);
    assert.doesNotMatch(invalid.stdout, /passed/);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

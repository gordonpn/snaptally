import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { mock, test } from "node:test";
import { localFixtures } from "../scripts/local-fixtures.mjs";
import { conventions, lintSql } from "../scripts/sql-lint.mjs";
import { BUCKET_SUBCATEGORIES, type ParentBucket } from "../src/config/intake.ts";

const root = resolve(import.meta.dirname, "..");

function createSqliteRunner() {
  const calls: string[][] = [];
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
  return { calls, run };
}

function getUnusedPid() {
  for (let candidate = 999_999; candidate > 100_000; candidate -= 1) {
    try {
      process.kill(candidate, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return candidate;
    }
  }
  throw new Error("Unable to find unused PID for stale lock test");
}

test("local fixtures persist, seed idempotently and reset only owned state", () => {
  const temp = mkdtempSync(resolve(tmpdir(), "snaptally-fixtures-"));
  const { calls, run } = createSqliteRunner();
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
    assert.equal(existsSync(resolve(temp, ".wrangler/dev-fixtures.lock")), false);
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

test("overlapping fixture commands reject cleanly before mutating state", async () => {
  const temp = mkdtempSync(resolve(tmpdir(), "snaptally-fixture-lock-"));
  const { run } = createSqliteRunner();
  try {
    symlinkSync(resolve(root, "seeds"), resolve(temp, "seeds"));
    localFixtures(["seed"], temp, run);

    // Reproduce an overlapping reset while seed holds dev-fixtures.lock in-process.
    let innerError: Error | undefined;
    const overlappingRun = (binary: string, args: string[]) => {
      if (args[1] === "migrations") {
        try {
          localFixtures(["reset"], temp, run);
        } catch (error) {
          innerError = error as Error;
        }
      }
      return run(binary, args);
    };
    localFixtures(["seed"], temp, overlappingRun);
    assert.match(innerError?.message ?? "", /already in progress/);
    assert.equal(existsSync(resolve(temp, ".wrangler/dev-fixtures.lock")), false);

    // Reproduce concurrent OS processes racing on the exclusive lock file.
    const liveHolder = spawn("cat", [], {
      stdio: ["pipe", "ignore", "ignore"],
    });
    try {
      const lockPath = resolve(temp, ".wrangler/dev-fixtures.lock");
      writeFileSync(
        lockPath,
        JSON.stringify({
          pid: liveHolder.pid,
          token: "live-holder",
          command: "seed",
          acquiredAt: new Date().toISOString(),
        }),
      );
      const rejected = spawnSync(
        process.execPath,
        [resolve(root, "scripts/local-fixtures.mjs"), "reset"],
        { cwd: temp, encoding: "utf8" },
      );
      assert.notEqual(rejected.status, 0);
      assert.match(rejected.stderr, /already in progress/);
      assert.doesNotMatch(rejected.stdout, /completed/);

      const db = new DatabaseSync(resolve(temp, ".wrangler/dev-fixtures/test.sqlite"));
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM transactions").get()?.n, 8);
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM monthly_budgets").get()?.n, 4);
      db.close();
    } finally {
      liveHolder.kill("SIGTERM");
    }

    // Also test two concurrent CLI invocations racing against real Wrangler.
    const concurrentTemp = mkdtempSync(resolve(tmpdir(), "snaptally-fixture-race-"));
    try {
      symlinkSync(resolve(root, "node_modules"), resolve(concurrentTemp, "node_modules"));
      symlinkSync(resolve(root, "migrations"), resolve(concurrentTemp, "migrations"));
      symlinkSync(resolve(root, "seeds"), resolve(concurrentTemp, "seeds"));
      symlinkSync(resolve(root, "wrangler.jsonc"), resolve(concurrentTemp, "wrangler.jsonc"));

      const spawnFixtureCli = (cmd: string) =>
        new Promise<{ status: number | null; stdout: string; stderr: string }>((done) => {
          const child = spawn(
            process.execPath,
            [resolve(root, "scripts/local-fixtures.mjs"), cmd],
            { cwd: concurrentTemp },
          );
          let stdout = "";
          let stderr = "";
          child.stdout?.on("data", (chunk) => {
            stdout += String(chunk);
          });
          child.stderr?.on("data", (chunk) => {
            stderr += String(chunk);
          });
          child.on("close", (status) => done({ status, stdout, stderr }));
        });

      const [first, second] = await Promise.all([
        spawnFixtureCli("seed"),
        spawnFixtureCli("reset"),
      ]);
      const statuses = [first.status, second.status].sort((a, b) => Number(a) - Number(b));
      assert.deepEqual(statuses, [0, 1]);
      const failed = first.status === 0 ? second : first;
      assert.match(failed.stderr, /already in progress|unreadable or being acquired/);
      assert.doesNotMatch(failed.stdout, /completed/);
      assert.equal(existsSync(resolve(concurrentTemp, ".wrangler/dev-fixtures.lock")), false);
      assert.equal(
        existsSync(resolve(concurrentTemp, ".wrangler/dev-fixtures/.snaptally-fixtures")),
        true,
      );
    } finally {
      rmSync(concurrentTemp, { recursive: true, force: true });
    }

    // Validate lock-path safety and corrupt/invalid lock handling.
    const lockPath = resolve(temp, ".wrangler/dev-fixtures.lock");
    writeFileSync(lockPath, "{not-json");
    assert.throws(() => localFixtures(["seed"], temp, run), /already in progress/);
    writeFileSync(lockPath, JSON.stringify({ pid: -1, command: "seed" }));
    assert.throws(() => localFixtures(["seed"], temp, run), /already in progress/);
    rmSync(lockPath);
    symlinkSync(resolve(temp, ".wrangler/state/keep"), lockPath);
    assert.throws(() => localFixtures(["seed"], temp, run), /symlink/);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("fixture reset and seed refuse when an active fixture-backed Pages server is detected", async () => {
  const temp = mkdtempSync(resolve(tmpdir(), "snaptally-fixture-server-"));
  const { run } = createSqliteRunner();
  try {
    symlinkSync(resolve(root, "seeds"), resolve(temp, "seeds"));
    localFixtures(["seed"], temp, run);

    const statePath = resolve(temp, ".wrangler/dev-fixtures");
    const mockServerList = () => [
      { pid: 42424, args: `node wrangler pages dev ./dist --persist-to ${statePath}` },
    ];
    assert.throws(
      () => localFixtures(["reset"], temp, run, mockServerList),
      /active fixture-backed local Pages server detected \(PID 42424\)/,
    );
    assert.throws(
      () => localFixtures(["seed"], temp, run, mockServerList),
      /active fixture-backed local Pages server detected \(PID 42424\)/,
    );

    // Unrelated normal or sibling Pages servers (.wrangler/state, dev-fixtures-e2e) must not block fixture reset.
    localFixtures(["reset"], temp, run, () => [
      {
        pid: 51515,
        args: `node wrangler pages dev ./dist --persist-to ${resolve(temp, ".wrangler/state")}`,
      },
      {
        pid: 51517,
        args: `node wrangler pages dev ./dist --persist-to ${statePath}-e2e`,
      },
    ]);
    assert.throws(
      () =>
        localFixtures(["reset"], temp, run, () => [
          { pid: 51518, args: `node wrangler pages dev ./dist --persist-to=${statePath}` },
        ]),
      /active fixture-backed local Pages server detected \(PID 51518\)/,
    );
    assert.throws(
      () =>
        localFixtures(["reset"], temp, run, () => [
          { pid: 51519, args: `node wrangler pages dev ./dist --persist-to ${statePath}/v3/d1` },
        ]),
      /active fixture-backed local Pages server detected \(PID 51519\)/,
    );
    const previousDirectory = process.cwd();
    try {
      process.chdir(temp);
      localFixtures(["reset"], temp, run, () => [
        { pid: 51516, args: "node wrangler pages dev ./dist --persist-to .wrangler/dev-fixtures" },
      ]);
    } finally {
      process.chdir(previousDirectory);
    }

    // Verify real OS process detection via ps.
    const fakeServer = spawn(
      process.execPath,
      [
        resolve(root, "tests/fixtures/fixture-server.mjs"),
        "wrangler",
        "pages",
        "dev",
        "./dist",
        "--persist-to",
        statePath,
      ],
      { stdio: ["pipe", "ignore", "ignore"] },
    );
    try {
      assert.throws(
        () => localFixtures(["reset"], temp, run),
        new RegExp(`active fixture-backed local Pages server detected.*${fakeServer.pid}`),
      );
    } finally {
      fakeServer.kill("SIGTERM");
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("failed second seed reports no success and supports clean recovery", () => {
  const temp = mkdtempSync(resolve(tmpdir(), "snaptally-fixture-recovery-"));
  const { run } = createSqliteRunner();
  const failSecondSeed = (binary: string, args: string[]) => {
    const fileArg = args[args.indexOf("--file") + 1] ?? "";
    if (fileArg.endsWith("monthly_budgets_demo.sql")) {
      return { status: 1 };
    }
    return run(binary, args);
  };

  try {
    symlinkSync(resolve(root, "seeds"), resolve(temp, "seeds"));

    // 1. Initial seed fails on second seed: no partial fixture state is committed.
    assert.throws(() => localFixtures(["seed"], temp, failSecondSeed), /Wrangler failed/);
    assert.equal(existsSync(resolve(temp, ".wrangler/dev-fixtures")), false);
    assert.equal(existsSync(resolve(temp, ".wrangler/dev-fixtures.lock")), false);
    assert.deepEqual(
      readdirSync(resolve(temp, ".wrangler")).filter((name) => name.startsWith(".dev-fixtures-")),
      [],
    );

    // Subsequent seed recovers cleanly.
    localFixtures(["seed"], temp, run);
    let db = new DatabaseSync(resolve(temp, ".wrangler/dev-fixtures/test.sqlite"));
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM transactions").get()?.n, 8);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM monthly_budgets").get()?.n, 4);
    db.close();

    // Reset must restore a sole interrupted backup before attempting another replacement.
    const interruptedBackup = resolve(temp, ".wrangler/.dev-fixtures-backup-reset");
    renameSync(resolve(temp, ".wrangler/dev-fixtures"), interruptedBackup);
    assert.throws(() => localFixtures(["reset"], temp, failSecondSeed), /Wrangler failed/);
    assert.equal(existsSync(interruptedBackup), false);
    db = new DatabaseSync(resolve(temp, ".wrangler/dev-fixtures/test.sqlite"));
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM transactions").get()?.n, 8);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM monthly_budgets").get()?.n, 4);
    db.close();

    // 2. Reset fails on second seed: existing valid state remains intact.
    assert.throws(() => localFixtures(["reset"], temp, failSecondSeed), /Wrangler failed/);
    db = new DatabaseSync(resolve(temp, ".wrangler/dev-fixtures/test.sqlite"));
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM transactions").get()?.n, 8);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM monthly_budgets").get()?.n, 4);
    db.close();

    // 3. Interrupted run recovery: partial DB + stale dead-PID lock + orphaned staging dir.
    db = new DatabaseSync(resolve(temp, ".wrangler/dev-fixtures/test.sqlite"));
    db.exec("DELETE FROM monthly_budgets");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM monthly_budgets").get()?.n, 0);
    db.close();

    writeFileSync(
      resolve(temp, ".wrangler/dev-fixtures.lock"),
      JSON.stringify({
        pid: getUnusedPid(),
        token: "stale-token",
        command: "seed",
        acquiredAt: new Date().toISOString(),
      }),
    );
    const crashed = resolve(temp, ".wrangler/.dev-fixtures-staging-crashed");
    mkdirSync(crashed, { recursive: true });
    writeFileSync(
      resolve(crashed, ".snaptally-fixtures"),
      "SnapTally disposable local fixtures v1\n",
    );
    const unowned = resolve(temp, ".wrangler/.dev-fixtures-staging-unowned");
    mkdirSync(unowned);
    writeFileSync(resolve(unowned, "keep"), "unrelated data");

    assert.throws(() => localFixtures(["seed"], temp, run), /already in progress/);
    rmSync(resolve(temp, ".wrangler/dev-fixtures.lock"));
    localFixtures(["seed"], temp, run);
    db = new DatabaseSync(resolve(temp, ".wrangler/dev-fixtures/test.sqlite"));
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM transactions").get()?.n, 8);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM monthly_budgets").get()?.n, 4);
    db.close();
    assert.equal(existsSync(resolve(temp, ".wrangler/.dev-fixtures-staging-crashed")), false);
    assert.equal(existsSync(resolve(temp, ".wrangler/dev-fixtures.lock")), false);
    assert.equal(readFileSync(resolve(unowned, "keep"), "utf8"), "unrelated data");

    // 4. Interrupted swap recovery: backup dir exists when dev-fixtures is absent.
    const backupDir = resolve(temp, ".wrangler/.dev-fixtures-backup-interrupted");
    writeFileSync(
      resolve(temp, ".wrangler/dev-fixtures/.snaptally-fixtures"),
      "SnapTally disposable local fixtures v1\n",
    );
    rmSync(backupDir, { recursive: true, force: true });
    mkdirSync(backupDir, { recursive: true });
    writeFileSync(
      resolve(backupDir, ".snaptally-fixtures"),
      "SnapTally disposable local fixtures v1\n",
    );
    rmSync(resolve(temp, ".wrangler/dev-fixtures"), { recursive: true, force: true });
    localFixtures(["seed"], temp, run);
    assert.equal(existsSync(backupDir), false);
    db = new DatabaseSync(resolve(temp, ".wrangler/dev-fixtures/test.sqlite"));
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM transactions").get()?.n, 8);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM monthly_budgets").get()?.n, 4);
    db.close();
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("fixture replacement rolls back when staged state disappears before commit", () => {
  const temp = mkdtempSync(resolve(tmpdir(), "snaptally-fixture-rollback-"));
  const { run } = createSqliteRunner();
  try {
    symlinkSync(resolve(root, "seeds"), resolve(temp, "seeds"));
    localFixtures(["seed"], temp, run);
    const removeCompletedStaging = (binary: string, args: string[]) => {
      const result = run(binary, args);
      if ((args[args.indexOf("--file") + 1] ?? "").endsWith("monthly_budgets_demo.sql")) {
        rmSync(args[args.indexOf("--persist-to") + 1], { recursive: true });
      }
      return result;
    };

    assert.throws(() => localFixtures(["reset"], temp, removeCompletedStaging), /ENOENT/);

    const db = new DatabaseSync(resolve(temp, ".wrangler/dev-fixtures/test.sqlite"));
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM transactions").get()?.n, 8);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM monthly_budgets").get()?.n, 4);
    db.close();
    assert.deepEqual(readdirSync(resolve(temp, ".wrangler")), ["dev-fixtures"]);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("fixture lock cleanup preserves unreadable or replacement metadata", () => {
  const temp = mkdtempSync(resolve(tmpdir(), "snaptally-fixture-metadata-"));
  const { run } = createSqliteRunner();
  const lock = resolve(temp, ".wrangler/dev-fixtures.lock");
  try {
    symlinkSync(resolve(root, "seeds"), resolve(temp, "seeds"));
    for (const metadata of ["{interrupted", JSON.stringify({ token: "another-owner" })]) {
      const corruptLock = (binary: string, args: string[]) => {
        const result = run(binary, args);
        writeFileSync(lock, metadata);
        return result;
      };

      localFixtures(["seed"], temp, corruptLock);

      assert.equal(readFileSync(lock, "utf8"), metadata);
      assert.throws(() => localFixtures(["reset"], temp, run), /already in progress/);
      rmSync(lock);
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("fixture seeding warns when process listing is unavailable and releases its lock", () => {
  const temp = mkdtempSync(resolve(tmpdir(), "snaptally-fixture-no-ps-"));
  const { run } = createSqliteRunner();
  const previousPath = process.env.PATH;
  const warning = mock.method(console, "warn", () => {});
  try {
    symlinkSync(resolve(root, "seeds"), resolve(temp, "seeds"));
    process.env.PATH = "";

    localFixtures(["seed"], temp, run);

    assert.equal(existsSync(resolve(temp, ".wrangler/dev-fixtures/test.sqlite")), true);
    assert.equal(existsSync(resolve(temp, ".wrangler/dev-fixtures.lock")), false);
    assert.deepEqual(
      warning.mock.calls.map((call) => call.arguments),
      [["Fixture process scan unavailable; stop all fixture-backed servers before continuing."]],
    );
  } finally {
    warning.mock.restore();
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
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

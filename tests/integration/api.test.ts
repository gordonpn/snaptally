import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import type { PaginatedTransactionsResponse } from "../../functions/api/transactions.ts";
import { stop } from "./process.ts";

if (process.platform === "win32") {
  throw new Error("The local integration harness supports macOS and Linux process groups.");
}

const baseURL = "http://127.0.0.1:8798";
const token = randomUUID();
const wrangler = resolve("node_modules/.bin/wrangler");
const env = {
  ...process.env,
  CI: "true",
  WRANGLER_SEND_METRICS: "false",
  BROWSER: "none",
};
let directory: string;
let server: ChildProcess | undefined;
let state: string;
let output = "";
const children = new Set<ChildProcess>();

function launch(args: string[]): ChildProcess {
  const child = spawn(wrangler, args, { env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  children.add(child);
  child.once("exit", () => children.delete(child));
  // Wrangler prints bindings at startup. Keep credentials out of failure diagnostics.
  for (const stream of [child.stdout, child.stderr]) {
    stream?.on("data", (chunk) => {
      output = (output + String(chunk)).replaceAll(token, "[test token]").slice(-20_000);
    });
  }
  return child;
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${baseURL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
    signal: AbortSignal.timeout(10_000),
  });
}

async function listing(query = ""): Promise<PaginatedTransactionsResponse> {
  const response = await request(`/api/transactions${query}`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /application\/json/);
  return response.json();
}

async function merchants(query = ""): Promise<string[]> {
  const response = await request(`/api/merchants${query}`);
  assert.equal(response.status, 200);
  const body = (await response.json()) as { merchants: string[] };
  assert.deepEqual(Object.keys(body), ["merchants"]);
  return body.merchants;
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    date: "2026-11-01",
    card: " Test Card ",
    parent_bucket: "Guilt-Free",
    subcategory: "Coffee",
    merchant: " cafe example ",
    gross_amount: 12.5,
    reimbursement: 2.5,
    currency: "usd",
    ...overrides,
  };
}

async function insert(overrides: Record<string, unknown> = {}): Promise<string> {
  const response = await request("/api/transactions", {
    method: "POST",
    body: JSON.stringify(payload(overrides)),
  });
  assert.equal(response.status, 201, await response.clone().text());
  const body = (await response.json()) as { ok: boolean; id: string };
  assert.equal(body.ok, true);
  assert.equal(typeof body.id, "string");
  assert.ok(body.id.length > 0);
  return body.id;
}

before(
  async () => {
    directory = await mkdtemp(join(tmpdir(), "snaptally-integration-"));
    state = join(directory, "state");
    const assets = join(directory, "assets");
    await mkdir(assets);
    await writeFile(join(assets, "index.html"), "Integration fixture");
    const migration = launch([
      "d1",
      "migrations",
      "apply",
      "budget-db",
      "--local",
      "--persist-to",
      state,
    ]);
    try {
      const code = await new Promise<number | null>((done, reject) => {
        migration.once("error", reject);
        migration.once("exit", done);
      });
      assert.equal(code, 0, output);
    } finally {
      await stop(migration);
    }
    server = launch([
      "pages",
      "dev",
      assets,
      "--ip",
      "127.0.0.1",
      "--port",
      "8798",
      "--persist-to",
      state,
      "--binding",
      `API_BEARER_TOKEN=${token}`,
    ]);
    let spawnError: Error | undefined;
    server.once("error", (error) => {
      spawnError = error;
    });
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError;
      assert.equal(server.exitCode, null, output);
      try {
        // A migrated API response proves both route discovery and the D1 binding are ready.
        const response = await request("/api/transactions");
        if (response.status === 200) return;
      } catch {
        /* The local listener may not be ready yet. */
      }
      await delay(200);
    }
    throw new Error(`Pages did not become ready:\n${output}`);
  },
  { timeout: 150_000 },
);

async function cleanup(): Promise<void> {
  try {
    await Promise.all([...children].map(stop));
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}

after(cleanup);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void cleanup().finally(() => process.exit(signal === "SIGINT" ? 130 : 143));
  });
}

test("HTTP API through Pages Functions and migrated local D1", async (t) => {
  await t.test(
    "rejects missing, empty, malformed and invalid credentials on every endpoint",
    async () => {
      for (const [path, method] of [
        ["/api/transactions", "GET"],
        ["/api/transactions", "POST"],
        ["/api/merchants", "GET"],
      ]) {
        for (const authorization of [undefined, "Bearer ", "Basic invalid", "Bearer invalid"]) {
          const response = await fetch(`${baseURL}${path}`, {
            method,
            headers: authorization === undefined ? {} : { Authorization: authorization },
            // Authentication must run even before malformed JSON validation.
            ...(method === "POST" ? { body: "{" } : {}),
            signal: AbortSignal.timeout(10_000),
          });
          assert.equal(response.status, 401);
          assert.deepEqual(await response.json(), { error: "Unauthorized" });
        }
      }
      assert.equal((await listing()).total_count, 0);
    },
  );

  await t.test(
    "POST returns an ID and GET exposes persisted normalized and generated fields",
    async () => {
      const id = await insert();
      const body = await listing("?month=2026-11");
      assert.deepEqual(Object.keys(body).sort(), [
        "has_more",
        "month_summary",
        "next_offset",
        "total_count",
        "transactions",
      ]);
      assert.equal(body.total_count, 1);
      assert.equal(body.has_more, false);
      assert.equal(body.next_offset, null);
      assert.deepEqual(body.month_summary, { month: "2026-11", net_spend: 10, total_count: 1 });
      const { created_at, ...record } = body.transactions[0];
      assert.equal(typeof created_at, "string");
      assert.ok(Number.isFinite(Date.parse(created_at)));
      assert.deepEqual(record, {
        id,
        date: "2026-11-01",
        card: "Test Card",
        parent_bucket: "Guilt-Free",
        subcategory: "Coffee",
        merchant: "Cafe Example",
        gross_amount: 12.5,
        reimbursement: 2.5,
        net_spend: 10,
        currency: "USD",
      });
    },
  );

  await t.test(
    "rejects malformed JSON, invalid dates and invalid amounts without writes",
    async () => {
      for (const body of [
        "{",
        JSON.stringify(payload({ date: "2026-02-30" })),
        ...[0, "12.50", null, 1_000_001].map((gross_amount) =>
          JSON.stringify(payload({ gross_amount })),
        ),
      ]) {
        const response = await request("/api/transactions", { method: "POST", body });
        assert.equal(response.status, 400);
        assert.equal(typeof ((await response.json()) as { error: string }).error, "string");
      }
      assert.equal((await listing()).total_count, 1);
    },
  );

  await t.test("orders by date and insertion recency and paginates over HTTP", async () => {
    const old = await insert({ date: "2026-10-01", merchant: "Older" });
    const first = await insert({ date: "2026-12-01", merchant: "Repeated" });
    const last = await insert({ date: "2026-12-01", merchant: "Repeated" });
    const body = await listing("?limit=2");
    assert.deepEqual(
      body.transactions.map((row) => row.id),
      [last, first],
    );
    assert.equal(body.total_count, 4);
    assert.equal(body.has_more, true);
    assert.equal(body.next_offset, 2);
    const next = await listing("?limit=2&offset=2");
    assert.equal(next.transactions[1].id, old);
    assert.equal(next.has_more, false);
    assert.equal(next.next_offset, null);
    assert.deepEqual(await merchants("?limit=10"), ["Repeated", "Older", "Cafe Example"]);
  });

  await t.test(
    "enforces default, maximum and invalid limit boundaries on persisted rows",
    async () => {
      // Seed volume through local D1 so boundary tests do not consume the API's abuse quota.
      // All behavior and ordering assertions above exercise insertion over HTTP.
      const seed = join(directory, "boundaries.sql");
      const rows = Array.from(
        { length: 202 },
        (_, index) =>
          `('boundary-${index}', '2026-09-01', 'Test Card', 'Guilt-Free', 'Coffee', 'Boundary ${index}', 1)`,
      );
      await writeFile(
        seed,
        `INSERT INTO transactions (id, date, card, parent_bucket, subcategory, merchant, gross_amount) VALUES ${rows.join(",")};`,
      );
      const child = launch([
        "d1",
        "execute",
        "budget-db",
        "--local",
        "--persist-to",
        state,
        "--file",
        seed,
      ]);
      try {
        const code = await new Promise<number | null>((done, reject) => {
          child.once("error", reject);
          child.once("exit", done);
        });
        assert.equal(code, 0, output);
      } finally {
        await stop(child);
      }
      for (const value of ["", "0", "-1", "nope", "1.5"]) {
        const query = `?limit=${encodeURIComponent(value)}`;
        assert.equal((await listing(query)).transactions.length, 20);
        assert.equal((await merchants(query)).length, 50);
      }
      assert.equal((await listing()).total_count, 206);
      assert.equal((await listing()).transactions.length, 20);
      assert.equal((await merchants()).length, 50);
      assert.equal((await listing("?limit=999999")).transactions.length, 100);
      assert.equal((await merchants("?limit=999999")).length, 200);
      assert.equal((await listing("?limit=1")).transactions.length, 1);
      assert.deepEqual(await merchants("?limit=1"), ["Repeated"]);
      assert.equal((await listing("?offset=999999")).transactions.length, 0);
    },
  );
});

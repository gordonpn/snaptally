import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { onRequest } from "../functions/api/_middleware.ts";
import { validateBearerToken } from "../functions/api/auth.ts";
import { logger } from "../functions/api/logger.ts";
import {
  AUTH_FAILURES_PER_MINUTE,
  guardApiRequest,
  REQUESTS_PER_MINUTE,
} from "../functions/api/rate-limit.ts";
import {
  handleGet,
  handlePost,
  isValidPayload,
  MAX_AMOUNT,
  MAX_BODY_BYTES,
} from "../functions/api/transactions.ts";
import insertTransactionQuery from "../queries/insert_transaction.sql";
import { createTestDatabase } from "./helpers/db.ts";

const token = "test-api-token";
const payload = {
  id: "security-transaction",
  date: "2026-11-10",
  card: "Amex Gold",
  parent_bucket: "Guilt-Free",
  subcategory: "Dining",
  merchant: "Lunch",
  gross_amount: 10,
};

function database() {
  const sqlite = createTestDatabase();
  const db = {
    prepare(sql: string) {
      const stmt = sqlite.prepare(sql);
      let args: unknown[] = [];
      const prepared = {
        bind(...values: unknown[]) {
          args = values;
          return prepared;
        },
        async first() {
          return stmt.get(...(args as [])) ?? null;
        },
        async all() {
          return { results: stmt.all(...(args as [])) };
        },
        async run() {
          stmt.run(...(args as []));
          return { success: true };
        },
      };
      return prepared;
    },
  } as unknown as D1Database;
  return { db, sqlite };
}

function request(authorization = `Bearer ${token}`, ip = "192.0.2.1") {
  return new Request("https://preview.snaptally.pages.dev/api/transactions?token=not-logged", {
    headers: { Authorization: authorization, "CF-Connecting-IP": ip, "cf-ray": "ray-123" },
  });
}

describe("transaction input security", () => {
  it("accepts bounded expenses and credits, preserves explicit legacy queued categories", () => {
    for (const gross_amount of [MAX_AMOUNT, -MAX_AMOUNT, 0.01]) {
      assert.equal(isValidPayload({ ...payload, gross_amount }), true);
    }
    assert.equal(
      isValidPayload({ ...payload, parent_bucket: "Income", subcategory: "Reimbursement" }),
      true,
    );
    assert.equal(isValidPayload({ ...payload, subcategory: "Coffee" }), true);
    for (const currency of ["USD", "CAD", "cad"])
      assert.equal(isValidPayload({ ...payload, currency }), true);
  });

  it("rejects oversized fields, invalid taxonomy, currencies and overflow before normalization", () => {
    for (const [key, max] of [
      ["id", 128],
      ["merchant", 200],
      ["card", 100],
    ] as const) {
      assert.equal(isValidPayload({ ...payload, [key]: "a".repeat(max) }), true);
      assert.equal(isValidPayload({ ...payload, [key]: "a".repeat(max + 1) }), false);
    }
    for (const gross_amount of [0, 1e308, -1e308, MAX_AMOUNT + 1, -MAX_AMOUNT - 1, Number.NaN]) {
      assert.equal(isValidPayload({ ...payload, gross_amount }), false);
    }
    for (const value of [
      { parent_bucket: "__proto__" },
      { parent_bucket: "constructor" },
      { parent_bucket: "toString" },
      { parent_bucket: "Unknown" },
      { parent_bucket: "Income" },
      { subcategory: "Rent" },
      { currency: "EUR" },
      { currency: " USD " },
      { reimbursement: 1e308 },
    ])
      assert.equal(isValidPayload({ ...payload, ...value }), false);
    assert.equal(isValidPayload([]), false);
  });

  it("rejects bodies above the byte limit with or without an honest content length", async () => {
    const db = {} as D1Database;
    for (const length of [undefined, "1", String(MAX_BODY_BYTES + 1)]) {
      const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
      if (length) headers["Content-Length"] = length;
      const response = await handlePost(
        new Request("https://example.com/api/transactions", {
          method: "POST",
          headers,
          body: " ".repeat(MAX_BODY_BYTES + 1),
        }),
        db,
        insertTransactionQuery,
        token,
      );
      assert.equal(response.status, 413);
    }
    const bytes = new TextEncoder().encode(
      JSON.stringify({ ...payload, padding: "é".repeat(9000) }),
    );
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(bytes.slice(0, 8000));
        controller.enqueue(bytes.slice(8000));
        controller.close();
      },
    });
    const response = await handlePost(
      new Request("https://example.com/api/transactions", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: stream,
        duplex: "half",
      } as RequestInit),
      db,
      insertTransactionQuery,
      token,
    );
    assert.equal(response.status, 413);
  });

  it("accepts a JSON body exactly at the byte limit and rejects missing/invalid JSON", async () => {
    const { db, sqlite } = database();
    try {
      const base = JSON.stringify(payload);
      const response = await handlePost(
        new Request("https://example.com/api/transactions", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: base + " ".repeat(MAX_BODY_BYTES - base.length),
        }),
        db,
        insertTransactionQuery,
        token,
      );
      assert.equal(response.status, 201);
      for (const body of [undefined, "{", new Uint8Array([255])]) {
        const result = await handlePost(
          new Request("https://example.com/api/transactions", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            body,
          }),
          db,
          insertTransactionQuery,
          token,
        );
        assert.equal(result.status, 400);
      }
    } finally {
      sqlite.close();
    }
  });

  it("searches percent, underscore and backslash literally with consistent pagination counts", async () => {
    const { db, sqlite } = database();
    try {
      for (const [id, merchant] of [
        ["percent", "100% Market"],
        ["underscore", "A_B"],
        ["slash", "A\\B"],
        ["plain", "AB"],
      ]) {
        sqlite
          .prepare(insertTransactionQuery)
          .run(
            id,
            payload.date,
            payload.card,
            payload.parent_bucket,
            payload.subcategory,
            merchant,
            10,
            0,
            "USD",
          );
      }
      for (const [search, id] of [
        ["%", "percent"],
        ["_", "underscore"],
        ["\\", "slash"],
      ]) {
        const response = await handleGet(
          new Request(`https://example.com/api/transactions?search=${encodeURIComponent(search)}`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
          db,
          token,
        );
        const result = (await response.json()) as {
          transactions: { id: string }[];
          total_count: number;
        };
        assert.equal(response.status, 200);
        assert.equal(result.total_count, 1);
        assert.equal(result.transactions[0].id, id);
      }
      for (const query of [`search=${"x".repeat(101)}`, `bucket=${"x".repeat(65)}`]) {
        assert.equal(
          (
            await handleGet(
              new Request(`https://example.com/api/transactions?${query}`, {
                headers: { Authorization: `Bearer ${token}` },
              }),
              db,
              token,
            )
          ).status,
          400,
        );
      }
    } finally {
      sqlite.close();
    }
  });
});

describe("API rate limiting and audit context", () => {
  it("enforces atomic shared-IP limits across routes and resets at minute boundaries", async () => {
    const { db, sqlite } = database();
    const now = 1_800_000;
    try {
      for (let i = 0; i < REQUESTS_PER_MINUTE; i++) {
        const req =
          i % 2
            ? new Request("https://example.com/api/merchants", { headers: request().headers })
            : request();
        assert.equal(await guardApiRequest(req, db, token, now), null);
      }
      const limited = await guardApiRequest(request(), db, token, now + 12_000);
      assert.equal(limited?.status, 429);
      assert.equal(limited?.headers.get("Retry-After"), "48");
      assert.equal(
        await guardApiRequest(request(`Bearer ${token}`, "192.0.2.2"), db, token, now),
        null,
      );
      assert.equal(await guardApiRequest(request(), db, token, now + 60_000), null);
      assert.equal(await guardApiRequest(request(), db, token, now + 180_000), null);
      const rows = sqlite.prepare("SELECT key FROM api_rate_limits").all() as { key: string }[];
      assert.equal(rows.length, 1);
      assert.ok(rows.every((row) => !row.key.includes("192.0.2") && !row.key.includes(token)));
    } finally {
      sqlite.close();
    }
  });

  it("applies a stricter authentication-failure limit and ignores forwarded-for spoofing", async () => {
    const { db, sqlite } = database();
    try {
      for (let i = 0; i < AUTH_FAILURES_PER_MINUTE; i++) {
        const req = request("Bearer invalid");
        req.headers.set("X-Forwarded-For", `spoof-${i}`);
        assert.equal((await guardApiRequest(req, db, token, 1_800_000))?.status, 401);
      }
      assert.equal(
        (await guardApiRequest(request("Bearer invalid"), db, token, 1_800_000))?.status,
        429,
      );
      assert.equal(await guardApiRequest(request(), db, token, 1_800_000), null);
    } finally {
      sqlite.close();
    }
  });

  it("bounds table cardinality, fails closed on D1 errors, and reports missing configuration", async () => {
    const { db, sqlite } = database();
    try {
      sqlite.exec(
        "WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<10000) INSERT INTO api_rate_limits SELECT 'key-'||x, 30, 1 FROM n",
      );
      assert.equal((await guardApiRequest(request(), db, token, 1_800_000))?.status, 429);
      assert.equal(
        (sqlite.prepare("SELECT COUNT(*) AS count FROM api_rate_limits").get() as { count: number })
          .count,
        10000,
      );
      const broken = await guardApiRequest(request(), {} as D1Database, token);
      assert.equal(broken?.status, 503);
      assert.equal(broken?.headers.get("Retry-After"), "60");
      sqlite.exec("DELETE FROM api_rate_limits");
      assert.equal((await guardApiRequest(request(), db, undefined, 1_800_000))?.status, 500);
    } finally {
      sqlite.close();
    }
  });

  it("logs only method, pathname and ray metadata on 401 and configuration failures", async () => {
    const records: unknown[] = [];
    const warn = mock.method(logger, "warn", (_message: string, metadata: unknown) =>
      records.push(metadata),
    );
    const error = mock.method(logger, "error", (_message: string, metadata: unknown) =>
      records.push(metadata),
    );
    try {
      for (const auth of [undefined, "Basic abc", "Bearer invalid", "Bearer   "]) {
        const req = request();
        if (auth) req.headers.set("Authorization", auth);
        else req.headers.delete("Authorization");
        assert.equal((await validateBearerToken(req, token))?.status, 401);
      }
      assert.equal((await validateBearerToken(request(), undefined))?.status, 500);
      assert.ok(records.length >= 5);
      for (const metadata of records)
        assert.deepEqual(metadata, {
          method: "GET",
          pathname: "/api/transactions",
          cfRay: "ray-123",
        });
      assert.ok(!JSON.stringify(records).includes(token));
      assert.ok(!JSON.stringify(records).includes("not-logged"));
    } finally {
      warn.mock.restore();
      error.mock.restore();
    }
  });

  it("protects Pages API middleware while leaving unrelated routes alone", async () => {
    const { db, sqlite } = database();
    let nextCalled = 0;
    const context = (req: Request) =>
      ({
        request: req,
        env: { DB: db, API_BEARER_TOKEN: token },
        next: async () => {
          nextCalled++;
          return new Response("ok");
        },
      }) as unknown as Parameters<typeof onRequest>[0];
    try {
      assert.equal((await onRequest(context(request()))).status, 200);
      assert.equal((await onRequest(context(request("Basic bad")))).status, 401);
      assert.equal(
        (await onRequest(context(new Request("https://example.com/api/unknown")))).status,
        200,
      );
      assert.equal(nextCalled, 2);
    } finally {
      sqlite.close();
    }
  });
});

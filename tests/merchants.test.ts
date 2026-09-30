import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { handleGet, onRequestGet } from "../functions/api/merchants.ts";
import insertTransactionQuery from "../queries/insert_transaction.sql";
import selectFrequentMerchantsQuery from "../queries/select_frequent_merchants.sql";

describe("GET /api/merchants handleGet", () => {
  const validToken = "test-secret-token";

  it("rejects unauthenticated request with HTTP 401 (Scenario 3)", async () => {
    let dbAccessed = false;
    const mockDb = {
      prepare() {
        dbAccessed = true;
        throw new Error("DB should not be called");
      },
    } as unknown as D1Database;

    const request = new Request("http://localhost/api/merchants");
    const response = await handleGet(request, mockDb, validToken);

    assert.strictEqual(response.status, 401);
    const data = (await response.json()) as { error: string };
    assert.strictEqual(data.error, "Unauthorized");
    assert.strictEqual(dbAccessed, false);
  });

  it("rejects request with invalid Bearer token with HTTP 401", async () => {
    let dbAccessed = false;
    const mockDb = {
      prepare() {
        dbAccessed = true;
        throw new Error("DB should not be called");
      },
    } as unknown as D1Database;

    const request = new Request("http://localhost/api/merchants", {
      headers: { Authorization: "Bearer wrong-token" },
    });
    const response = await handleGet(request, mockDb, validToken);

    assert.strictEqual(response.status, 401);
    const data = (await response.json()) as { error: string };
    assert.strictEqual(data.error, "Unauthorized");
    assert.strictEqual(dbAccessed, false);
  });

  it("returns merchants list with default limit 50 when authenticated (Scenario 1)", async () => {
    let boundLimit: unknown = null;
    const mockDb = {
      prepare(query: string) {
        assert.strictEqual(query, selectFrequentMerchantsQuery);
        return {
          bind(limit: unknown) {
            boundLimit = limit;
            return {
              async all() {
                return {
                  results: [{ merchant: "Trader Joe's" }, { merchant: "George Howell" }],
                };
              },
            };
          },
        };
      },
    } as unknown as D1Database;

    const request = new Request("http://localhost/api/merchants", {
      headers: { Authorization: `Bearer ${validToken}` },
    });
    const response = await handleGet(request, mockDb, validToken);

    assert.strictEqual(response.status, 200);
    assert.strictEqual(boundLimit, 50);
    const data = (await response.json()) as { merchants: string[] };
    assert.deepStrictEqual(data.merchants, ["Trader Joe's", "George Howell"]);
  });

  it("passes custom clamped limit from query parameters", async () => {
    let boundLimit: unknown = null;
    const mockDb = {
      prepare(query: string) {
        assert.strictEqual(query, selectFrequentMerchantsQuery);
        return {
          bind(limit: unknown) {
            boundLimit = limit;
            return {
              async all() {
                return { results: [] };
              },
            };
          },
        };
      },
    } as unknown as D1Database;

    const request = new Request("http://localhost/api/merchants?limit=10", {
      headers: { Authorization: `Bearer ${validToken}` },
    });
    const response = await handleGet(request, mockDb, validToken);

    assert.strictEqual(response.status, 200);
    assert.strictEqual(boundLimit, 10);
    const data = (await response.json()) as { merchants: string[] };
    assert.deepStrictEqual(data.merchants, []);
  });

  it("clamps excessive limit to maxLimit 200", async () => {
    let boundLimit: unknown = null;
    const mockDb = {
      prepare(query: string) {
        assert.strictEqual(query, selectFrequentMerchantsQuery);
        return {
          bind(limit: unknown) {
            boundLimit = limit;
            return {
              async all() {
                return { results: [] };
              },
            };
          },
        };
      },
    } as unknown as D1Database;

    const request = new Request("http://localhost/api/merchants?limit=9999", {
      headers: { Authorization: `Bearer ${validToken}` },
    });
    const response = await handleGet(request, mockDb, validToken);

    assert.strictEqual(response.status, 200);
    assert.strictEqual(boundLimit, 200);
    const data = (await response.json()) as { merchants: string[] };
    assert.deepStrictEqual(data.merchants, []);
  });

  it("handles null results from D1 gracefully returning empty array", async () => {
    const mockDb = {
      prepare() {
        return {
          bind() {
            return {
              async all() {
                return { results: null };
              },
            };
          },
        };
      },
    } as unknown as D1Database;

    const request = new Request("http://localhost/api/merchants", {
      headers: { Authorization: `Bearer ${validToken}` },
    });
    const response = await handleGet(request, mockDb, validToken);

    assert.strictEqual(response.status, 200);
    const data = (await response.json()) as { merchants: string[] };
    assert.deepStrictEqual(data.merchants, []);
  });

  it("returns HTTP 500 when database query throws error", async () => {
    const mockDb = {
      prepare() {
        return {
          bind() {
            return {
              async all() {
                throw new Error("D1 query failure");
              },
            };
          },
        };
      },
    } as unknown as D1Database;

    const request = new Request("http://localhost/api/merchants", {
      headers: { Authorization: `Bearer ${validToken}` },
    });
    const response = await handleGet(request, mockDb, validToken);

    assert.strictEqual(response.status, 500);
    const data = (await response.json()) as { error: string };
    assert.strictEqual(data.error, "Database error during merchant retrieval");
  });
});

describe("GET /api/merchants onRequestGet", () => {
  it("delegates to handleGet with environment context", async () => {
    const validToken = "test-secret-token";
    let executed = false;

    const mockDb = {
      prepare: (query: string) => {
        assert.strictEqual(query, selectFrequentMerchantsQuery);
        return {
          bind: (limit: unknown) => {
            assert.strictEqual(limit, 50);
            return {
              run: async () => ({ success: true }),
              all: async () => {
                executed = true;
                return { results: [{ merchant: "Whole Foods" }] };
              },
            };
          },
        };
      },
    } as unknown as D1Database;

    const request = new Request("http://localhost/api/merchants", {
      headers: { Authorization: `Bearer ${validToken}` },
    });

    const context = {
      request,
      env: { DB: mockDb, API_BEARER_TOKEN: validToken },
    } as unknown as Parameters<typeof onRequestGet>[0];

    const response = await onRequestGet(context);
    assert.strictEqual(response.status, 200);
    assert.strictEqual(executed, true);

    const data = (await response.json()) as { merchants: string[] };
    assert.deepStrictEqual(data.merchants, ["Whole Foods"]);
  });
});

describe("Merchants SQLite Query Integration", () => {
  it("orders merchants by occurrence count descending and breaks ties by recency", () => {
    const initSql = readFileSync(resolve("migrations/0000_init.sql"), "utf-8");
    const migrationSql = readFileSync(resolve("migrations/0001_expanded_schema.sql"), "utf-8");

    const db = new DatabaseSync(":memory:");
    db.exec(initSql);
    db.exec(migrationSql);

    const insertStmt = db.prepare(insertTransactionQuery);
    insertStmt.run("t1", "2026-09-20", "Amex", "Food", "Groceries", "Trader Joe's", 20, 0);
    insertStmt.run("t2", "2026-09-21", "Amex", "Food", "Groceries", "Trader Joe's", 30, 0);
    insertStmt.run("t3", "2026-09-22", "Amex", "Food", "Groceries", "Trader Joe's", 40, 0);

    insertStmt.run("t4", "2026-09-21", "Chase", "Food", "Dining", "George Howell", 5, 0);
    insertStmt.run("t5", "2026-09-23", "Chase", "Food", "Dining", "George Howell", 6, 0);

    insertStmt.run("t6", "2026-09-23", "Cash", "Food", "Dining", "Blue Bottle", 7, 0);
    insertStmt.run("t7", "2026-09-24", "Cash", "Food", "Dining", "Blue Bottle", 8, 0);

    insertStmt.run("t8", "2026-09-19", "Visa", "Food", "Groceries", "Whole Foods", 50, 0);

    const queryStmt = db.prepare(selectFrequentMerchantsQuery);
    const rows = queryStmt.all(3) as Array<{ merchant: string }>;

    assert.strictEqual(rows.length, 3);
    assert.strictEqual(rows[0].merchant, "Trader Joe's");
    assert.strictEqual(rows[1].merchant, "Blue Bottle");
    assert.strictEqual(rows[2].merchant, "George Howell");

    db.close();
  });
});

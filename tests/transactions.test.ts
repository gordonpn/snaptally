import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import {
  handleGet as handleGetTransactions,
  handlePost,
  isValidDate,
  isValidPayload,
  normalizeText,
  onRequestGet as onRequestGetTransactions,
  onRequestPost,
  parseLimit as parseTransactionsLimit,
  resolveMerchant,
  toAlphanumericKey,
  toTitleCase,
} from "../functions/api/transactions.ts";
import insertTransactionQuery from "../queries/insert_transaction.sql";
import selectDistinctMerchantsQuery from "../queries/select_distinct_merchants.sql";
import selectRecentTransactionsQuery from "../queries/select_recent_transactions.sql";

describe("isValidDate", () => {
  it("accepts valid ISO calendar date strings", () => {
    assert.strictEqual(isValidDate("2026-09-28"), true);
    assert.strictEqual(isValidDate("2024-02-29"), true);
    assert.strictEqual(isValidDate("2000-01-01"), true);
    assert.strictEqual(isValidDate("0042-05-15"), true);
    assert.strictEqual(isValidDate("0001-01-01"), true);
  });

  it("rejects non-conforming date string formats", () => {
    assert.strictEqual(isValidDate("2026/09/28"), false);
    assert.strictEqual(isValidDate("2026-9-28"), false);
    assert.strictEqual(isValidDate("2026-09-8"), false);
    assert.strictEqual(isValidDate("09-28-2026"), false);
    assert.strictEqual(isValidDate(""), false);
    assert.strictEqual(isValidDate("not-a-date"), false);
  });

  it("rejects invalid calendar dates", () => {
    assert.strictEqual(isValidDate("2025-02-29"), false);
    assert.strictEqual(isValidDate("2026-02-30"), false);
    assert.strictEqual(isValidDate("2026-04-31"), false);
    assert.strictEqual(isValidDate("2026-13-01"), false);
    assert.strictEqual(isValidDate("2026-00-10"), false);
  });
});

describe("isValidPayload", () => {
  const validPayload = {
    date: "2026-09-25",
    card: "Amex Gold",
    parent_bucket: "Guilt-Free",
    subcategory: "Dining",
    merchant: "George Howell",
    gross_amount: 25.5,
    reimbursement: 5.0,
  };

  it("accepts a valid transaction payload with reimbursement", () => {
    assert.strictEqual(isValidPayload(validPayload), true);
  });

  it("accepts a valid transaction payload with omitted reimbursement", () => {
    const { reimbursement, ...omittedReimbursement } = validPayload;
    assert.strictEqual(isValidPayload(omittedReimbursement), true);
  });

  it("accepts a valid transaction payload with zero reimbursement", () => {
    assert.strictEqual(isValidPayload({ ...validPayload, reimbursement: 0 }), true);
  });

  it("rejects non-object or null payloads", () => {
    assert.strictEqual(isValidPayload(null), false);
    assert.strictEqual(isValidPayload(undefined), false);
    assert.strictEqual(isValidPayload(""), false);
    assert.strictEqual(isValidPayload(123), false);
  });

  it("rejects invalid or missing date values", () => {
    assert.strictEqual(isValidPayload({ ...validPayload, date: "invalid-date" }), false);
    assert.strictEqual(isValidPayload({ ...validPayload, date: "2026-02-30" }), false);
    assert.strictEqual(isValidPayload({ ...validPayload, date: "" }), false);
    assert.strictEqual(isValidPayload({ ...validPayload, date: 20260925 }), false);
  });

  it("rejects non-positive or non-finite gross_amount", () => {
    assert.strictEqual(isValidPayload({ ...validPayload, gross_amount: 0 }), false);
    assert.strictEqual(isValidPayload({ ...validPayload, gross_amount: -5 }), false);
    assert.strictEqual(isValidPayload({ ...validPayload, gross_amount: Number.NaN }), false);
    assert.strictEqual(
      isValidPayload({ ...validPayload, gross_amount: Number.POSITIVE_INFINITY }),
      false,
    );
    assert.strictEqual(isValidPayload({ ...validPayload, gross_amount: "18.50" }), false);
  });

  it("rejects negative or non-finite reimbursement", () => {
    assert.strictEqual(isValidPayload({ ...validPayload, reimbursement: -1 }), false);
    assert.strictEqual(isValidPayload({ ...validPayload, reimbursement: Number.NaN }), false);
    assert.strictEqual(
      isValidPayload({ ...validPayload, reimbursement: Number.POSITIVE_INFINITY }),
      false,
    );
    assert.strictEqual(isValidPayload({ ...validPayload, reimbursement: "5.0" }), false);
  });

  it("rejects empty or whitespace-only string fields", () => {
    assert.strictEqual(isValidPayload({ ...validPayload, card: "   " }), false);
    assert.strictEqual(isValidPayload({ ...validPayload, parent_bucket: "" }), false);
    assert.strictEqual(isValidPayload({ ...validPayload, subcategory: "  " }), false);
    assert.strictEqual(isValidPayload({ ...validPayload, merchant: "" }), false);
  });
});

describe("normalizeText", () => {
  it("trims leading and trailing whitespace", () => {
    assert.strictEqual(normalizeText("  Trader Joe's  "), "Trader Joe's");
  });

  it("collapses multiple consecutive internal spaces", () => {
    assert.strictEqual(normalizeText("Trader    Joe's"), "Trader Joe's");
    assert.strictEqual(normalizeText("  Amex   Gold  "), "Amex Gold");
  });

  it("normalizes Unicode combining diacritical marks to NFC", () => {
    const decomposed = "cafe\u0301";
    const composed = "caf\u00e9";
    assert.strictEqual(normalizeText(decomposed), composed);
  });

  it("normalizes smart/curly quotes to straight apostrophes", () => {
    assert.strictEqual(normalizeText("Trader Joe’s"), "Trader Joe's");
    assert.strictEqual(normalizeText("Trader Joe‘s"), "Trader Joe's");
  });
});

describe("toTitleCase", () => {
  it("capitalizes the first letter of each word", () => {
    assert.strictEqual(toTitleCase("george howell"), "George Howell");
    assert.strictEqual(toTitleCase("whole foods market"), "Whole Foods Market");
  });

  it("preserves apostrophes in title-cased words", () => {
    assert.strictEqual(toTitleCase("trader joe's"), "Trader Joe's");
    assert.strictEqual(toTitleCase("trader joe’s"), "Trader Joe's");
  });

  it("preserves already capitalized title case", () => {
    assert.strictEqual(toTitleCase("George Howell"), "George Howell");
  });

  it("returns empty string for empty input", () => {
    assert.strictEqual(toTitleCase("   "), "");
  });
});

describe("toAlphanumericKey", () => {
  it("strips whitespace, symbols, and punctuation into lowercase key", () => {
    assert.strictEqual(toAlphanumericKey("Trader Joe's"), "traderjoes");
    assert.strictEqual(toAlphanumericKey("trader joes"), "traderjoes");
    assert.strictEqual(toAlphanumericKey("trader joe’s"), "traderjoes");
    assert.strictEqual(toAlphanumericKey("  Trader-Joe's!  "), "traderjoes");
  });

  it("preserves Unicode letters and digits across scripts", () => {
    assert.strictEqual(toAlphanumericKey("Café"), "café");
    assert.strictEqual(toAlphanumericKey("Caf"), "caf");
    assert.strictEqual(toAlphanumericKey("  Café-Au-Lait!  "), "caféaulait");
    assert.strictEqual(toAlphanumericKey("東京 123!"), "東京123");
  });
});

describe("resolveMerchant", () => {
  it("resolves to existing canonical merchant when alphanumeric key matches", async () => {
    const mockDb = {
      prepare(query: string) {
        assert.strictEqual(query, selectDistinctMerchantsQuery);
        return {
          async all() {
            return {
              results: [{ merchant: "Trader Joe's" }, { merchant: "George Howell" }],
            };
          },
        };
      },
    } as unknown as D1Database;

    const result1 = await resolveMerchant(mockDb, selectDistinctMerchantsQuery, "trader joes");
    assert.strictEqual(result1, "Trader Joe's");

    const result2 = await resolveMerchant(mockDb, selectDistinctMerchantsQuery, "trader joe’s");
    assert.strictEqual(result2, "Trader Joe's");
  });

  it("prioritizes the most recent spelling when multiple variations exist in D1", async () => {
    const mockDb = {
      prepare(query: string) {
        assert.strictEqual(query, selectDistinctMerchantsQuery);
        return {
          async all() {
            return {
              results: [{ merchant: "Trader Joe's" }, { merchant: "Trader Joes" }],
            };
          },
        };
      },
    } as unknown as D1Database;

    const result = await resolveMerchant(mockDb, selectDistinctMerchantsQuery, "trader joes");
    assert.strictEqual(result, "Trader Joe's");
  });

  it("formats as Title Case when no existing match is found in D1", async () => {
    const mockDb = {
      prepare(query: string) {
        assert.strictEqual(query, selectDistinctMerchantsQuery);
        return {
          async all() {
            return {
              results: [{ merchant: "Trader Joe's" }],
            };
          },
        };
      },
    } as unknown as D1Database;

    const result = await resolveMerchant(mockDb, selectDistinctMerchantsQuery, "george howell");
    assert.strictEqual(result, "George Howell");
  });

  it("handles empty database results gracefully", async () => {
    const mockDb = {
      prepare(query: string) {
        assert.strictEqual(query, selectDistinctMerchantsQuery);
        return {
          async all() {
            return { results: [] };
          },
        };
      },
    } as unknown as D1Database;

    const result = await resolveMerchant(mockDb, selectDistinctMerchantsQuery, "whole foods");
    assert.strictEqual(result, "Whole Foods");
  });

  it("preserves accented characters and keeps Café and Caf distinct", async () => {
    const mockDb = {
      prepare(query: string) {
        assert.strictEqual(query, selectDistinctMerchantsQuery);
        return {
          async all() {
            return {
              results: [{ merchant: "Café" }, { merchant: "Caf" }],
            };
          },
        };
      },
    } as unknown as D1Database;

    const result1 = await resolveMerchant(mockDb, selectDistinctMerchantsQuery, "café");
    assert.strictEqual(result1, "Café");

    const result2 = await resolveMerchant(mockDb, selectDistinctMerchantsQuery, "caf");
    assert.strictEqual(result2, "Caf");
  });

  it("normalizes whitespace and quotes on existing canonical merchant before returning", async () => {
    const mockDb = {
      prepare(query: string) {
        assert.strictEqual(query, selectDistinctMerchantsQuery);
        return {
          async all() {
            return {
              results: [{ merchant: "  Trader  Joe’s  " }],
            };
          },
        };
      },
    } as unknown as D1Database;

    const result = await resolveMerchant(mockDb, selectDistinctMerchantsQuery, "trader joes");
    assert.strictEqual(result, "Trader Joe's");
  });

  it("returns title case directly when alphanumeric key is empty", async () => {
    const mockDb = {} as D1Database;
    const result = await resolveMerchant(mockDb, selectDistinctMerchantsQuery, "???");
    assert.strictEqual(result, "???");
  });

  it("propagates database query errors", async () => {
    const mockDb = {
      prepare(query: string) {
        assert.strictEqual(query, selectDistinctMerchantsQuery);
        return {
          async all() {
            throw new Error("D1 select failed");
          },
        };
      },
    } as unknown as D1Database;

    await assert.rejects(
      async () => resolveMerchant(mockDb, selectDistinctMerchantsQuery, "trader joes"),
      /D1 select failed/,
    );
  });
});

describe("handlePost", () => {
  const dummyQuery = insertTransactionQuery;
  const validToken = "test-secret-token";

  it("rejects request without Authorization header with HTTP 401 (Scenario 1)", async () => {
    let dbAccessed = false;
    const mockDb = {
      prepare() {
        dbAccessed = true;
        throw new Error("DB should not be called");
      },
    } as unknown as D1Database;

    const request = new Request("http://localhost/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: "2026-09-25",
        card: "Amex Gold",
        parent_bucket: "Guilt-Free",
        subcategory: "Dining",
        merchant: "George Howell",
        gross_amount: 18.5,
        reimbursement: 0.0,
      }),
    });

    const response = await handlePost(request, mockDb, dummyQuery, validToken);
    assert.strictEqual(response.status, 401);

    const data = (await response.json()) as { error: string };
    assert.strictEqual(data.error, "Unauthorized");
    assert.strictEqual(dbAccessed, false);
  });

  it("rejects request with invalid Bearer token with HTTP 401 (Scenario 2)", async () => {
    let dbAccessed = false;
    const mockDb = {
      prepare() {
        dbAccessed = true;
        throw new Error("DB should not be called");
      },
    } as unknown as D1Database;

    const request = new Request("http://localhost/api/transactions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer invalid-token",
      },
      body: JSON.stringify({
        date: "2026-09-25",
        card: "Amex Gold",
        parent_bucket: "Guilt-Free",
        subcategory: "Dining",
        merchant: "George Howell",
        gross_amount: 18.5,
        reimbursement: 0.0,
      }),
    });

    const response = await handlePost(request, mockDb, dummyQuery, validToken);
    assert.strictEqual(response.status, 401);

    const data = (await response.json()) as { error: string };
    assert.strictEqual(data.error, "Unauthorized");
    assert.strictEqual(dbAccessed, false);
  });

  it("inserts valid transaction and returns HTTP 201 when authenticated (Scenario 3)", async () => {
    let boundArgs: unknown[] = [];
    let executed = false;

    const mockDb = {
      prepare(query: string) {
        if (query === selectDistinctMerchantsQuery) {
          return {
            async all() {
              return { results: [] };
            },
          };
        }
        assert.strictEqual(query, dummyQuery);
        return {
          bind(...args: unknown[]) {
            boundArgs = args;
            return {
              async run() {
                executed = true;
                return { success: true };
              },
            };
          },
        };
      },
    } as unknown as D1Database;

    const request = new Request("http://localhost/api/transactions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${validToken}`,
      },
      body: JSON.stringify({
        date: "2026-09-25",
        card: "Amex Gold",
        parent_bucket: "Guilt-Free",
        subcategory: "Dining",
        merchant: "George Howell",
        gross_amount: 25.5,
        reimbursement: 5.0,
      }),
    });

    const response = await handlePost(request, mockDb, dummyQuery, validToken);
    assert.strictEqual(response.status, 201);

    const data = (await response.json()) as { ok: boolean; id: string };
    assert.strictEqual(data.ok, true);
    assert.strictEqual(typeof data.id, "string");
    assert.strictEqual(executed, true);
    assert.deepStrictEqual(boundArgs, [
      data.id,
      "2026-09-25",
      "Amex Gold",
      "Guilt-Free",
      "Dining",
      "George Howell",
      25.5,
      5.0,
    ]);
  });

  it("inserts valid transaction with omitted reimbursement defaulting to zero (Scenario 4)", async () => {
    let boundArgs: unknown[] = [];

    const mockDb = {
      prepare(query: string) {
        if (query === selectDistinctMerchantsQuery) {
          return {
            async all() {
              return { results: [] };
            },
          };
        }
        return {
          bind(...args: unknown[]) {
            boundArgs = args;
            return {
              async run() {
                return { success: true };
              },
            };
          },
        };
      },
    } as unknown as D1Database;

    const request = new Request("http://localhost/api/transactions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${validToken}`,
      },
      body: JSON.stringify({
        date: "2026-09-25",
        card: "Amex Gold",
        parent_bucket: "Guilt-Free",
        subcategory: "Dining",
        merchant: "George Howell",
        gross_amount: 18.0,
      }),
    });

    const response = await handlePost(request, mockDb, dummyQuery, validToken);
    assert.strictEqual(response.status, 201);

    const data = (await response.json()) as { ok: boolean; id: string };
    assert.strictEqual(data.ok, true);
    assert.deepStrictEqual(boundArgs, [
      data.id,
      "2026-09-25",
      "Amex Gold",
      "Guilt-Free",
      "Dining",
      "George Howell",
      18.0,
      0.0,
    ]);
  });

  it("rejects malformed JSON with HTTP 400 when authenticated", async () => {
    const mockDb = {} as D1Database;
    const request = new Request("http://localhost/api/transactions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${validToken}`,
      },
      body: "{ not valid json",
    });

    const response = await handlePost(request, mockDb, dummyQuery, validToken);
    assert.strictEqual(response.status, 400);

    const data = (await response.json()) as { error: string };
    assert.strictEqual(data.error, "Malformed JSON payload");
  });

  it("rejects invalid payload fields with HTTP 400 when authenticated", async () => {
    const mockDb = {} as D1Database;
    const request = new Request("http://localhost/api/transactions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${validToken}`,
      },
      body: JSON.stringify({
        date: "invalid-date",
        card: "",
        parent_bucket: "Food",
        subcategory: "Dining",
        merchant: "Store",
        gross_amount: -10,
      }),
    });

    const response = await handlePost(request, mockDb, dummyQuery, validToken);
    assert.strictEqual(response.status, 400);

    const data = (await response.json()) as { error: string };
    assert.match(data.error, /Invalid payload/);
  });

  it("returns HTTP 500 when database insertion fails when authenticated", async () => {
    const mockDb = {
      prepare(query: string) {
        if (query === selectDistinctMerchantsQuery) {
          return {
            async all() {
              return { results: [] };
            },
          };
        }
        return {
          bind() {
            return {
              async run() {
                throw new Error("D1 execution failed");
              },
            };
          },
        };
      },
    } as unknown as D1Database;

    const request = new Request("http://localhost/api/transactions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${validToken}`,
      },
      body: JSON.stringify({
        date: "2026-09-25",
        card: "Visa",
        parent_bucket: "Fixed Costs",
        subcategory: "Groceries",
        merchant: "Trader Joe",
        gross_amount: 25.0,
      }),
    });

    const response = await handlePost(request, mockDb, dummyQuery, validToken);
    assert.strictEqual(response.status, 500);

    const data = (await response.json()) as { error: string };
    assert.strictEqual(data.error, "Database insertion failed");
  });

  it("normalizes whitespace and resolves existing canonical merchant", async () => {
    let boundArgs: unknown[] = [];

    const mockDb = {
      prepare(query: string) {
        if (query === selectDistinctMerchantsQuery) {
          return {
            async all() {
              return {
                results: [{ merchant: "Trader Joe's" }],
              };
            },
          };
        }
        assert.strictEqual(query, dummyQuery);
        return {
          bind(...args: unknown[]) {
            boundArgs = args;
            return {
              async run() {
                return { success: true };
              },
            };
          },
        };
      },
    } as unknown as D1Database;

    const request = new Request("http://localhost/api/transactions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${validToken}`,
      },
      body: JSON.stringify({
        date: "  2026-09-25  ",
        card: "  Amex   Gold  ",
        parent_bucket: "  Guilt-Free  ",
        subcategory: "  Dining  ",
        merchant: "  trader   joes  ",
        gross_amount: 42.5,
        reimbursement: 2.5,
      }),
    });

    const response = await handlePost(
      request,
      mockDb,
      dummyQuery,
      validToken,
      selectDistinctMerchantsQuery,
    );
    assert.strictEqual(response.status, 201);
    const data = (await response.json()) as { ok: boolean; id: string };
    assert.strictEqual(data.ok, true);
    assert.deepStrictEqual(boundArgs, [
      data.id,
      "2026-09-25",
      "Amex Gold",
      "Guilt-Free",
      "Dining",
      "Trader Joe's",
      42.5,
      2.5,
    ]);
  });

  it("normalizes new merchant to Title Case when no existing match in D1", async () => {
    let boundArgs: unknown[] = [];

    const mockDb = {
      prepare(query: string) {
        if (query === selectDistinctMerchantsQuery) {
          return {
            async all() {
              return { results: [] };
            },
          };
        }
        assert.strictEqual(query, dummyQuery);
        return {
          bind(...args: unknown[]) {
            boundArgs = args;
            return {
              async run() {
                return { success: true };
              },
            };
          },
        };
      },
    } as unknown as D1Database;

    const request = new Request("http://localhost/api/transactions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${validToken}`,
      },
      body: JSON.stringify({
        date: "2026-09-25",
        card: "Amex Gold",
        parent_bucket: "Guilt-Free",
        subcategory: "Coffee",
        merchant: "george howell",
        gross_amount: 3.99,
      }),
    });

    const response = await handlePost(
      request,
      mockDb,
      dummyQuery,
      validToken,
      selectDistinctMerchantsQuery,
    );
    assert.strictEqual(response.status, 201);
    const data = (await response.json()) as { ok: boolean; id: string };
    assert.strictEqual(data.ok, true);
    assert.deepStrictEqual(boundArgs, [
      data.id,
      "2026-09-25",
      "Amex Gold",
      "Guilt-Free",
      "Coffee",
      "George Howell",
      3.99,
      0.0,
    ]);
  });

  it("returns HTTP 500 when merchant canonical resolution fails", async () => {
    const mockDb = {
      prepare(query: string) {
        if (query === selectDistinctMerchantsQuery) {
          return {
            async all() {
              throw new Error("D1 select failed");
            },
          };
        }
        return {
          bind() {
            return {
              async run() {
                return { success: true };
              },
            };
          },
        };
      },
    } as unknown as D1Database;

    const request = new Request("http://localhost/api/transactions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${validToken}`,
      },
      body: JSON.stringify({
        date: "2026-09-25",
        card: "Visa",
        parent_bucket: "Fixed Costs",
        subcategory: "Groceries",
        merchant: "Trader Joe",
        gross_amount: 25.0,
      }),
    });

    const response = await handlePost(request, mockDb, dummyQuery, validToken);
    assert.strictEqual(response.status, 500);

    const data = (await response.json()) as { error: string };
    assert.strictEqual(data.error, "Database error during merchant resolution");
  });
});

describe("onRequestPost", () => {
  it("delegates to handlePost and returns HTTP 201 on valid submission", async () => {
    let executedQuery = "";
    let boundParams: unknown[] = [];
    const validToken = "test-secret-token";

    const mockDb = {
      prepare: (query: string) => {
        if (query === selectDistinctMerchantsQuery) {
          return {
            all: async () => ({ results: [] }),
          };
        }
        executedQuery = query;
        return {
          bind: (...params: unknown[]) => {
            boundParams = params;
            return {
              run: async () => ({ success: true }),
            };
          },
        };
      },
    } as unknown as D1Database;

    const request = new Request("http://localhost/api/transactions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${validToken}`,
      },
      body: JSON.stringify({
        date: "2026-09-25",
        card: "Chase Sapphire",
        parent_bucket: "Fixed Costs",
        subcategory: "Groceries",
        merchant: "Whole Foods",
        gross_amount: 32.5,
        reimbursement: 0.0,
      }),
    });

    const context = {
      request,
      env: { DB: mockDb, API_BEARER_TOKEN: validToken },
    } as unknown as Parameters<typeof onRequestPost>[0];

    const response = await onRequestPost(context);
    assert.strictEqual(response.status, 201);

    const data = (await response.json()) as { ok: boolean; id: string };
    assert.strictEqual(data.ok, true);
    assert.strictEqual(typeof data.id, "string");
    assert.ok(executedQuery.includes("INSERT INTO transactions"));
    assert.strictEqual(boundParams[1], "2026-09-25");
    assert.strictEqual(boundParams[2], "Chase Sapphire");
    assert.strictEqual(boundParams[3], "Fixed Costs");
    assert.strictEqual(boundParams[4], "Groceries");
    assert.strictEqual(boundParams[5], "Whole Foods");
    assert.strictEqual(boundParams[6], 32.5);
    assert.strictEqual(boundParams[7], 0.0);
  });
});

describe("Database Schema and Migrations", () => {
  it("applies migrations cleanly and automatically stores generated net_spend in SQLite", () => {
    const initSql = readFileSync(resolve("migrations/0000_init.sql"), "utf-8");
    const migrationSql = readFileSync(resolve("migrations/0001_expanded_schema.sql"), "utf-8");

    const db = new DatabaseSync(":memory:");
    db.exec(initSql);

    db.exec(`
      INSERT INTO transactions (id, amount, card, category, merchant, created_at)
      VALUES ('legacy-1', 45.0, 'Amex Gold', 'Groceries', 'Trader Joe', '2026-09-20 10:30:00');
    `);

    db.exec(migrationSql);

    const migratedRow = db
      .prepare("SELECT * FROM transactions WHERE id = ?")
      .get("legacy-1") as Record<string, unknown>;

    assert.strictEqual(migratedRow.id, "legacy-1");
    assert.strictEqual(migratedRow.date, "2026-09-20");
    assert.strictEqual(migratedRow.card, "Amex Gold");
    assert.strictEqual(migratedRow.parent_bucket, "Variable");
    assert.strictEqual(migratedRow.subcategory, "Groceries");
    assert.strictEqual(migratedRow.merchant, "Trader Joe");
    assert.strictEqual(migratedRow.gross_amount, 45.0);
    assert.strictEqual(migratedRow.reimbursement, 0.0);
    assert.strictEqual(migratedRow.net_spend, 45.0);

    const insertStmt = db.prepare(insertTransactionQuery);
    insertStmt.run(
      "new-1",
      "2026-09-25",
      "Chase Sapphire",
      "Guilt-Free",
      "Dining",
      "George Howell",
      50.0,
      15.0,
    );

    const insertedRow = db
      .prepare("SELECT * FROM transactions WHERE id = ?")
      .get("new-1") as Record<string, unknown>;

    assert.strictEqual(insertedRow.gross_amount, 50.0);
    assert.strictEqual(insertedRow.reimbursement, 15.0);
    assert.strictEqual(insertedRow.net_spend, 35.0);

    insertStmt.run("new-2", "2026-09-26", "Apple Cash", "Fixed Costs", "Transit", "MBTA", 2.4, 0.0);

    const zeroReimbursementRow = db
      .prepare("SELECT * FROM transactions WHERE id = ?")
      .get("new-2") as Record<string, unknown>;

    assert.strictEqual(zeroReimbursementRow.gross_amount, 2.4);
    assert.strictEqual(zeroReimbursementRow.reimbursement, 0.0);
    assert.strictEqual(zeroReimbursementRow.net_spend, 2.4);

    const indexes = db.prepare("PRAGMA index_list(transactions)").all() as Array<{
      name: string;
    }>;
    const indexNames = indexes.map((idx) => idx.name);
    assert.ok(indexNames.includes("idx_transactions_date_created_at"));
    assert.ok(indexNames.includes("idx_transactions_merchant"));

    db.close();
  });
});

describe("parseTransactionsLimit", () => {
  it("returns defaultLimit when parameter is null, empty, or whitespace", () => {
    assert.strictEqual(parseTransactionsLimit(null, 5, 50), 5);
    assert.strictEqual(parseTransactionsLimit("", 5, 50), 5);
    assert.strictEqual(parseTransactionsLimit("   ", 5, 50), 5);
  });

  it("parses valid positive integer within bounds", () => {
    assert.strictEqual(parseTransactionsLimit("10", 5, 50), 10);
    assert.strictEqual(parseTransactionsLimit("50", 5, 50), 50);
  });

  it("clamps values exceeding maxLimit to maxLimit", () => {
    assert.strictEqual(parseTransactionsLimit("100", 5, 50), 50);
  });

  it("falls back to defaultLimit for non-numeric, zero, or negative values", () => {
    assert.strictEqual(parseTransactionsLimit("invalid", 5, 50), 5);
    assert.strictEqual(parseTransactionsLimit("0", 5, 50), 5);
    assert.strictEqual(parseTransactionsLimit("-1", 5, 50), 5);
  });
});

describe("GET /api/transactions handleGet", () => {
  const validToken = "test-secret-token";

  it("rejects unauthenticated request with HTTP 401 (Scenario 3)", async () => {
    let dbAccessed = false;
    const mockDb = {
      prepare() {
        dbAccessed = true;
        throw new Error("DB should not be called");
      },
    } as unknown as D1Database;

    const request = new Request("http://localhost/api/transactions");
    const response = await handleGetTransactions(
      request,
      mockDb,
      selectRecentTransactionsQuery,
      validToken,
    );

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

    const request = new Request("http://localhost/api/transactions", {
      headers: { Authorization: "Bearer wrong-token" },
    });
    const response = await handleGetTransactions(
      request,
      mockDb,
      selectRecentTransactionsQuery,
      validToken,
    );

    assert.strictEqual(response.status, 401);
    const data = (await response.json()) as { error: string };
    assert.strictEqual(data.error, "Unauthorized");
    assert.strictEqual(dbAccessed, false);
  });

  it("returns recent transactions with default limit 5 when authenticated (Scenario 2)", async () => {
    let boundLimit: unknown = null;
    const sampleRecord = {
      id: "tx-1",
      date: "2026-09-29",
      card: "Amex Gold",
      parent_bucket: "Guilt-Free",
      subcategory: "Dining",
      merchant: "George Howell",
      gross_amount: 18.5,
      reimbursement: 0.0,
      net_spend: 18.5,
      created_at: "2026-09-29 12:00:00",
    };

    const mockDb = {
      prepare(query: string) {
        assert.strictEqual(query, selectRecentTransactionsQuery);
        return {
          bind(limit: unknown) {
            boundLimit = limit;
            return {
              async all() {
                return { results: [sampleRecord] };
              },
            };
          },
        };
      },
    } as unknown as D1Database;

    const request = new Request("http://localhost/api/transactions", {
      headers: { Authorization: `Bearer ${validToken}` },
    });
    const response = await handleGetTransactions(
      request,
      mockDb,
      selectRecentTransactionsQuery,
      validToken,
    );

    assert.strictEqual(response.status, 200);
    assert.strictEqual(boundLimit, 5);
    const data = (await response.json()) as { transactions: (typeof sampleRecord)[] };
    assert.deepStrictEqual(data.transactions, [sampleRecord]);
  });

  it("passes custom clamped limit from query parameters", async () => {
    let boundLimit: unknown = null;
    const mockDb = {
      prepare(query: string) {
        assert.strictEqual(query, selectRecentTransactionsQuery);
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

    const request = new Request("http://localhost/api/transactions?limit=25", {
      headers: { Authorization: `Bearer ${validToken}` },
    });
    const response = await handleGetTransactions(
      request,
      mockDb,
      selectRecentTransactionsQuery,
      validToken,
    );

    assert.strictEqual(response.status, 200);
    assert.strictEqual(boundLimit, 25);
    const data = (await response.json()) as { transactions: unknown[] };
    assert.deepStrictEqual(data.transactions, []);
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

    const request = new Request("http://localhost/api/transactions", {
      headers: { Authorization: `Bearer ${validToken}` },
    });
    const response = await handleGetTransactions(
      request,
      mockDb,
      selectRecentTransactionsQuery,
      validToken,
    );

    assert.strictEqual(response.status, 200);
    const data = (await response.json()) as { transactions: unknown[] };
    assert.deepStrictEqual(data.transactions, []);
  });

  it("returns HTTP 500 when database query throws error", async () => {
    const mockDb = {
      prepare() {
        return {
          bind() {
            return {
              async all() {
                throw new Error("D1 select failure");
              },
            };
          },
        };
      },
    } as unknown as D1Database;

    const request = new Request("http://localhost/api/transactions", {
      headers: { Authorization: `Bearer ${validToken}` },
    });
    const response = await handleGetTransactions(
      request,
      mockDb,
      selectRecentTransactionsQuery,
      validToken,
    );

    assert.strictEqual(response.status, 500);
    const data = (await response.json()) as { error: string };
    assert.strictEqual(data.error, "Database error during transactions retrieval");
  });
});

describe("GET /api/transactions onRequestGet", () => {
  it("delegates to handleGet with environment context", async () => {
    const validToken = "test-secret-token";
    let executed = false;

    const mockDb = {
      prepare: (query: string) => {
        assert.strictEqual(query, selectRecentTransactionsQuery);
        return {
          bind: (limit: unknown) => {
            assert.strictEqual(limit, 5);
            return {
              run: async () => ({ success: true }),
              all: async () => {
                executed = true;
                return { results: [] };
              },
            };
          },
        };
      },
    } as unknown as D1Database;

    const request = new Request("http://localhost/api/transactions", {
      headers: { Authorization: `Bearer ${validToken}` },
    });

    const context = {
      request,
      env: { DB: mockDb, API_BEARER_TOKEN: validToken },
    } as unknown as Parameters<typeof onRequestGetTransactions>[0];

    const response = await onRequestGetTransactions(context);
    assert.strictEqual(response.status, 200);
    assert.strictEqual(executed, true);

    const data = (await response.json()) as { transactions: unknown[] };
    assert.deepStrictEqual(data.transactions, []);
  });
});

describe("Recent Transactions SQLite Query Integration", () => {
  it("orders transactions by date descending, then created_at descending", () => {
    const initSql = readFileSync(resolve("migrations/0000_init.sql"), "utf-8");
    const migrationSql = readFileSync(resolve("migrations/0001_expanded_schema.sql"), "utf-8");

    const db = new DatabaseSync(":memory:");
    db.exec(initSql);
    db.exec(migrationSql);

    const insertStmt = db.prepare(insertTransactionQuery);
    insertStmt.run("tx-past", "2026-09-20", "Amex", "Food", "Groceries", "Trader Joe", 20, 0);
    insertStmt.run("tx-recent-1", "2026-09-25", "Chase", "Food", "Dining", "George Howell", 15, 0);
    insertStmt.run("tx-recent-2", "2026-09-25", "Apple Cash", "Transit", "Subway", "MBTA", 2.4, 0);
    insertStmt.run("tx-latest", "2026-09-28", "Amex", "Food", "Coffee", "Blue Bottle", 6.5, 0);

    const queryStmt = db.prepare(selectRecentTransactionsQuery);
    const rows = queryStmt.all(3) as Array<{ id: string; date: string }>;

    assert.strictEqual(rows.length, 3);
    assert.strictEqual(rows[0].id, "tx-latest");
    assert.strictEqual(rows[0].date, "2026-09-28");
    assert.strictEqual(rows[1].date, "2026-09-25");
    assert.strictEqual(rows[2].date, "2026-09-25");

    db.close();
  });
});

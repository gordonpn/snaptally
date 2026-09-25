import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  handlePost,
  isValidPayload,
  normalizeText,
  onRequestPost,
  resolveMerchant,
  toAlphanumericKey,
  toTitleCase,
} from "../functions/api/transactions.ts";
import selectDistinctMerchantsQuery from "../queries/select_distinct_merchants.sql";

describe("isValidPayload", () => {
  it("accepts a valid transaction payload", () => {
    const payload = {
      amount: 18.5,
      card: "Amex Gold",
      category: "Dining",
      merchant: "George Howell",
    };
    assert.strictEqual(isValidPayload(payload), true);
  });

  it("rejects non-object or null payloads", () => {
    assert.strictEqual(isValidPayload(null), false);
    assert.strictEqual(isValidPayload(undefined), false);
    assert.strictEqual(isValidPayload(""), false);
    assert.strictEqual(isValidPayload(123), false);
  });

  it("rejects non-positive or non-finite amounts", () => {
    assert.strictEqual(
      isValidPayload({ amount: 0, card: "Amex", category: "Food", merchant: "Store" }),
      false,
    );
    assert.strictEqual(
      isValidPayload({ amount: -5, card: "Amex", category: "Food", merchant: "Store" }),
      false,
    );
    assert.strictEqual(
      isValidPayload({ amount: Number.NaN, card: "Amex", category: "Food", merchant: "Store" }),
      false,
    );
    assert.strictEqual(
      isValidPayload({
        amount: Number.POSITIVE_INFINITY,
        card: "Amex",
        category: "Food",
        merchant: "Store",
      }),
      false,
    );
    assert.strictEqual(
      isValidPayload({ amount: "18.50", card: "Amex", category: "Food", merchant: "Store" }),
      false,
    );
  });

  it("rejects empty or whitespace-only string fields", () => {
    assert.strictEqual(
      isValidPayload({ amount: 10, card: "   ", category: "Food", merchant: "Store" }),
      false,
    );
    assert.strictEqual(
      isValidPayload({ amount: 10, card: "Amex", category: "", merchant: "Store" }),
      false,
    );
    assert.strictEqual(
      isValidPayload({ amount: 10, card: "Amex", category: "Food", merchant: "   " }),
      false,
    );
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
  const dummyQuery =
    "INSERT INTO transactions (id, amount, card, category, merchant) VALUES (?, ?, ?, ?, ?);";
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
        amount: 18.5,
        card: "Amex Gold",
        category: "Dining",
        merchant: "George Howell",
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
        amount: 18.5,
        card: "Amex Gold",
        category: "Dining",
        merchant: "George Howell",
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
        amount: 18.5,
        card: "Amex Gold",
        category: "Dining",
        merchant: "George Howell",
      }),
    });

    const response = await handlePost(request, mockDb, dummyQuery, validToken);
    assert.strictEqual(response.status, 201);

    const data = (await response.json()) as { ok: boolean; id: string };
    assert.strictEqual(data.ok, true);
    assert.strictEqual(typeof data.id, "string");
    assert.strictEqual(executed, true);
    assert.deepStrictEqual(boundArgs, [data.id, 18.5, "Amex Gold", "Dining", "George Howell"]);
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
      body: JSON.stringify({ amount: -10, card: "", category: "Food", merchant: "Store" }),
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
        amount: 25.0,
        card: "Visa",
        category: "Groceries",
        merchant: "Trader Joe",
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
        amount: 42.5,
        card: "  Amex   Gold  ",
        category: "  Groceries  ",
        merchant: "  trader   joes  ",
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
    assert.deepStrictEqual(boundArgs, [data.id, 42.5, "Amex Gold", "Groceries", "Trader Joe's"]);
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
        amount: 3.99,
        card: "Amex Gold",
        category: "Coffee",
        merchant: "george howell",
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
    assert.deepStrictEqual(boundArgs, [data.id, 3.99, "Amex Gold", "Coffee", "George Howell"]);
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
        amount: 25.0,
        card: "Visa",
        category: "Groceries",
        merchant: "Trader Joe",
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
        amount: 32.5,
        card: "Chase Sapphire",
        category: "Groceries",
        merchant: "Whole Foods",
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
    assert.strictEqual(boundParams[1], 32.5);
    assert.strictEqual(boundParams[2], "Chase Sapphire");
    assert.strictEqual(boundParams[3], "Groceries");
    assert.strictEqual(boundParams[4], "Whole Foods");
  });
});

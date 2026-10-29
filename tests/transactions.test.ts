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
  resolveMerchant,
  toAlphanumericKey,
  toTitleCase,
} from "../functions/api/transactions.ts";
import countTransactionsQuery from "../queries/count_transactions.sql";
import insertTransactionQuery from "../queries/insert_transaction.sql";
import selectDistinctMerchantsQuery from "../queries/select_distinct_merchants.sql";
import selectMonthSummaryQuery from "../queries/select_month_summary.sql";
import selectPaginatedTransactionsQuery from "../queries/select_paginated_transactions.sql";
import selectRecentTransactionsQuery from "../queries/select_recent_transactions.sql";
import { createTestDatabase } from "./helpers/db.ts";

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

  it("accepts a valid refund payload with negative gross_amount and zero or omitted reimbursement", () => {
    assert.strictEqual(
      isValidPayload({ ...validPayload, gross_amount: -25.5, reimbursement: 0 }),
      true,
    );
    const { reimbursement, ...omittedReimbursement } = validPayload;
    assert.strictEqual(isValidPayload({ ...omittedReimbursement, gross_amount: -25.5 }), true);
  });

  it("accepts positive Income and rejects negative Income payloads", () => {
    assert.strictEqual(
      isValidPayload({
        ...validPayload,
        parent_bucket: "Income",
        subcategory: "Salary",
        reimbursement: 0,
      }),
      true,
    );
    for (const parent_bucket of ["Income", " Income\t "]) {
      assert.strictEqual(
        isValidPayload({
          ...validPayload,
          parent_bucket,
          subcategory: "Salary",
          gross_amount: -25.5,
          reimbursement: 0,
        }),
        false,
      );
    }
  });

  it("accepts queued transactions with a legacy Income subcategory", () => {
    assert.strictEqual(
      isValidPayload({
        ...validPayload,
        id: "legacy-outbox-id",
        parent_bucket: "Income",
        subcategory: "Reimbursement",
        reimbursement: 0,
      }),
      true,
    );
  });

  it("rejects non-finite or zero gross_amount", () => {
    assert.strictEqual(isValidPayload({ ...validPayload, gross_amount: 0 }), false);
    assert.strictEqual(isValidPayload({ ...validPayload, gross_amount: Number.NaN }), false);
    assert.strictEqual(
      isValidPayload({ ...validPayload, gross_amount: Number.POSITIVE_INFINITY }),
      false,
    );
    assert.strictEqual(
      isValidPayload({ ...validPayload, gross_amount: Number.NEGATIVE_INFINITY }),
      false,
    );
    assert.strictEqual(isValidPayload({ ...validPayload, gross_amount: "18.50" }), false);
  });

  it("rejects refunds with non-zero reimbursement", () => {
    assert.strictEqual(
      isValidPayload({ ...validPayload, gross_amount: -25.5, reimbursement: 5 }),
      false,
    );
  });

  it("rejects positive transactions with reimbursement exceeding gross_amount", () => {
    assert.strictEqual(
      isValidPayload({ ...validPayload, gross_amount: 50.0, reimbursement: 100.0 }),
      false,
    );
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

  it("accepts a payload with a valid custom id", () => {
    assert.strictEqual(isValidPayload({ ...validPayload, id: "tx-custom-123" }), true);
  });

  it("rejects invalid id fields when provided", () => {
    assert.strictEqual(isValidPayload({ ...validPayload, id: "" }), false);
    assert.strictEqual(isValidPayload({ ...validPayload, id: "   " }), false);
    assert.strictEqual(isValidPayload({ ...validPayload, id: 12345 }), false);
  });

  it("accepts a payload with a valid currency", () => {
    assert.strictEqual(isValidPayload({ ...validPayload, currency: "USD" }), true);
    assert.strictEqual(isValidPayload({ ...validPayload, currency: "CAD" }), true);
  });

  it("rejects invalid currency fields when provided", () => {
    assert.strictEqual(isValidPayload({ ...validPayload, currency: "" }), false);
    assert.strictEqual(isValidPayload({ ...validPayload, currency: "   " }), false);
    assert.strictEqual(isValidPayload({ ...validPayload, currency: 123 }), false);
    assert.strictEqual(isValidPayload({ ...validPayload, currency: null }), false);
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
      "USD",
    ]);
  });

  it("inserts valid refund transaction with negative gross_amount and zero reimbursement", async () => {
    let executed = false;
    let boundArgs: unknown[] = [];

    const mockDb = {
      prepare(query: string) {
        if (query === selectDistinctMerchantsQuery) {
          return {
            async all() {
              return { results: [{ merchant: "Uniqlo" }] };
            },
          };
        }
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
        subcategory: "Shopping",
        merchant: "Uniqlo",
        gross_amount: -35.0,
      }),
    });

    const response = await handlePost(request, mockDb, dummyQuery, validToken);
    assert.strictEqual(response.status, 201);

    const data = (await response.json()) as { ok: boolean; id: string };
    assert.strictEqual(data.ok, true);
    assert.strictEqual(executed, true);
    assert.deepStrictEqual(boundArgs, [
      data.id,
      "2026-09-25",
      "Amex Gold",
      "Guilt-Free",
      "Shopping",
      "Uniqlo",
      -35.0,
      0.0,
      "USD",
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
      "USD",
    ]);
  });

  it("uses custom id provided in payload for idempotent insertion", async () => {
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
        id: "tx-idempotent-42",
        date: "2026-09-25",
        card: "Amex Gold",
        parent_bucket: "Guilt-Free",
        subcategory: "Dining",
        merchant: "George Howell",
        gross_amount: 15.0,
      }),
    });

    const response = await handlePost(request, mockDb, dummyQuery, validToken);
    assert.strictEqual(response.status, 201);

    const data = (await response.json()) as { ok: boolean; id: string };
    assert.strictEqual(data.id, "tx-idempotent-42");
    assert.strictEqual(boundArgs[0], "tx-idempotent-42");
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
      "USD",
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
      "USD",
    ]);
  });

  it("inserts valid transaction with custom currency normalized to uppercase", async () => {
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
        card: "Scotiabank Visa",
        parent_bucket: "Fixed Costs",
        subcategory: "Fitness",
        merchant: "Bloc Shop",
        gross_amount: 32.5,
        currency: "cad",
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
      "Scotiabank Visa",
      "Fixed Costs",
      "Fitness",
      "Bloc Shop",
      32.5,
      0.0,
      "CAD",
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
    assert.strictEqual(boundParams[8], "USD");
  });
});

describe("Database Schema and Migrations", () => {
  it("applies migrations cleanly and automatically stores generated net_spend in SQLite", () => {
    const initSql = readFileSync(resolve("migrations/0000_init.sql"), "utf-8");
    const migrationSql = readFileSync(resolve("migrations/0001_expanded_schema.sql"), "utf-8");
    const migration2Sql = readFileSync(resolve("migrations/0002_multi_tenant_schema.sql"), "utf-8");
    const migration3Sql = readFileSync(
      resolve("migrations/0003_enforce_refund_reimbursement_invariant.sql"),
      "utf-8",
    );
    const migration4Sql = readFileSync(
      resolve("migrations/0004_taxonomy_coffee_and_snacks.sql"),
      "utf-8",
    );
    const migration5Sql = readFileSync(
      resolve("migrations/0005_add_currency_to_transactions.sql"),
      "utf-8",
    );

    const db = new DatabaseSync(":memory:");
    db.exec(initSql);

    db.exec(`
      INSERT INTO transactions (id, amount, card, category, merchant, created_at)
      VALUES ('legacy-1', 45.0, 'Amex Gold', 'Groceries', 'Trader Joe', '2026-09-20 10:30:00');
    `);

    db.exec(migrationSql);
    db.exec(migration2Sql);
    db.exec(migration3Sql);
    db.exec(migration4Sql);
    db.exec(migration5Sql);

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
    assert.strictEqual(migratedRow.currency, "USD");

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
      "USD",
    );

    const insertedRow = db
      .prepare("SELECT * FROM transactions WHERE id = ?")
      .get("new-1") as Record<string, unknown>;

    assert.strictEqual(insertedRow.gross_amount, 50.0);
    assert.strictEqual(insertedRow.reimbursement, 15.0);
    assert.strictEqual(insertedRow.net_spend, 35.0);
    assert.strictEqual(insertedRow.currency, "USD");

    insertStmt.run(
      "new-2",
      "2026-09-26",
      "Apple Cash",
      "Fixed Costs",
      "Transit",
      "MBTA",
      2.4,
      0.0,
      "CAD",
    );

    const zeroReimbursementRow = db
      .prepare("SELECT * FROM transactions WHERE id = ?")
      .get("new-2") as Record<string, unknown>;

    assert.strictEqual(zeroReimbursementRow.gross_amount, 2.4);
    assert.strictEqual(zeroReimbursementRow.reimbursement, 0.0);
    assert.strictEqual(zeroReimbursementRow.net_spend, 2.4);
    assert.strictEqual(zeroReimbursementRow.currency, "CAD");

    const indexes = db.prepare("PRAGMA index_list(transactions)").all() as Array<{
      name: string;
    }>;
    const indexNames = indexes.map((idx) => idx.name);
    assert.ok(indexNames.includes("idx_transactions_date_created_at"));
    assert.ok(indexNames.includes("idx_transactions_merchant"));

    db.close();
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
    const response = await handleGetTransactions(request, mockDb, validToken);

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
    const response = await handleGetTransactions(request, mockDb, validToken);

    assert.strictEqual(response.status, 401);
    const data = (await response.json()) as { error: string };
    assert.strictEqual(data.error, "Unauthorized");
    assert.strictEqual(dbAccessed, false);
  });

  it("returns recent transactions with default limit 20 when authenticated (Scenario 2)", async () => {
    let boundSelectArgs: unknown[] = [];
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
      currency: "USD",
      created_at: "2026-09-29 12:00:00",
    };

    const mockDb = {
      prepare(query: string) {
        if (query === countTransactionsQuery) {
          return {
            bind() {
              return {
                async first() {
                  return { total: 1 };
                },
              };
            },
          };
        }
        if (query === selectMonthSummaryQuery) {
          return {
            bind() {
              return {
                async first() {
                  return { month_net_spend: 18.5, month_count: 1 };
                },
              };
            },
          };
        }
        assert.strictEqual(query, selectPaginatedTransactionsQuery);
        return {
          bind(...args: unknown[]) {
            boundSelectArgs = args;
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
    const response = await handleGetTransactions(request, mockDb, validToken);

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(boundSelectArgs, [null, null, 20, 0]);
    const data = (await response.json()) as {
      transactions: (typeof sampleRecord)[];
      total_count: number;
      has_more: boolean;
      next_offset: number | null;
      month_summary: { net_spend: number; total_count: number };
    };
    assert.deepStrictEqual(data.transactions, [sampleRecord]);
    assert.strictEqual(data.total_count, 1);
    assert.strictEqual(data.has_more, false);
    assert.strictEqual(data.next_offset, null);
    assert.strictEqual(data.month_summary.net_spend, 18.5);
  });

  it("passes custom clamped limit, offset, search, and bucket from query parameters", async () => {
    let boundSelectArgs: unknown[] = [];
    let boundCountArgs: unknown[] = [];
    const mockDb = {
      prepare(query: string) {
        if (query === countTransactionsQuery) {
          return {
            bind(...args: unknown[]) {
              boundCountArgs = args;
              return {
                async first() {
                  return { total: 50 };
                },
              };
            },
          };
        }
        if (query === selectMonthSummaryQuery) {
          return {
            bind() {
              return {
                async first() {
                  return { month_net_spend: 120.0, month_count: 4 };
                },
              };
            },
          };
        }
        assert.strictEqual(query, selectPaginatedTransactionsQuery);
        return {
          bind(...args: unknown[]) {
            boundSelectArgs = args;
            return {
              async all() {
                return { results: [] };
              },
            };
          },
        };
      },
    } as unknown as D1Database;

    const request = new Request(
      "http://localhost/api/transactions?limit=25&offset=10&search=sweetgreen&bucket=Guilt-Free&month=2026-08",
      {
        headers: { Authorization: `Bearer ${validToken}` },
      },
    );
    const response = await handleGetTransactions(request, mockDb, validToken);

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(boundSelectArgs, ["sweetgreen", "Guilt-Free", 25, 10]);
    assert.deepStrictEqual(boundCountArgs, ["sweetgreen", "Guilt-Free"]);
    const data = (await response.json()) as {
      total_count: number;
      has_more: boolean;
      next_offset: number | null;
    };
    assert.strictEqual(data.total_count, 50);
    assert.strictEqual(data.has_more, true);
    assert.strictEqual(data.next_offset, 10);
  });

  it("clamps excessive limit to maxLimit 100", async () => {
    let boundSelectArgs: unknown[] = [];
    const mockDb = {
      prepare(query: string) {
        if (query === countTransactionsQuery) {
          return {
            bind() {
              return {
                async first() {
                  return { total: 0 };
                },
              };
            },
          };
        }
        if (query === selectMonthSummaryQuery) {
          return {
            bind() {
              return {
                async first() {
                  return { month_net_spend: 0, month_count: 0 };
                },
              };
            },
          };
        }
        assert.strictEqual(query, selectPaginatedTransactionsQuery);
        return {
          bind(...args: unknown[]) {
            boundSelectArgs = args;
            return {
              async all() {
                return { results: [] };
              },
            };
          },
        };
      },
    } as unknown as D1Database;

    const request = new Request("http://localhost/api/transactions?limit=9999", {
      headers: { Authorization: `Bearer ${validToken}` },
    });
    const response = await handleGetTransactions(request, mockDb, validToken);

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(boundSelectArgs, [null, null, 100, 0]);
  });

  it("handles null results from D1 gracefully returning empty array", async () => {
    const mockDb = {
      prepare() {
        return {
          bind() {
            return {
              async first() {
                return null;
              },
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
    const response = await handleGetTransactions(request, mockDb, validToken);

    assert.strictEqual(response.status, 200);
    const data = (await response.json()) as { transactions: unknown[]; total_count: number };
    assert.deepStrictEqual(data.transactions, []);
    assert.strictEqual(data.total_count, 0);
  });

  it("returns HTTP 500 when database query throws error", async () => {
    const mockDb = {
      prepare() {
        return {
          bind() {
            return {
              async first() {
                throw new Error("D1 select failure");
              },
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
    const response = await handleGetTransactions(request, mockDb, validToken);

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
        if (query === countTransactionsQuery) {
          return {
            bind: () => ({
              first: async () => ({ total: 0 }),
            }),
          };
        }
        if (query === selectMonthSummaryQuery) {
          return {
            bind: () => ({
              first: async () => ({ month_net_spend: 0, month_count: 0 }),
            }),
          };
        }
        assert.strictEqual(query, selectPaginatedTransactionsQuery);
        return {
          bind: (...args: unknown[]) => {
            assert.deepStrictEqual(args, [null, null, 20, 0]);
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
  it("keeps legacy Income reimbursement categories readable", () => {
    const db = createTestDatabase();
    db.prepare(insertTransactionQuery).run(
      "tx-legacy-income-reimbursement",
      "2026-09-25",
      "Amex",
      "Income",
      "Reimbursement",
      "Employer",
      50,
      0,
      "USD",
    );

    const [row] = db.prepare(selectRecentTransactionsQuery).all(5) as Array<{
      id: string;
      parent_bucket: string;
      subcategory: string;
    }>;

    assert.ok(row);
    assert.strictEqual(row.id, "tx-legacy-income-reimbursement");
    assert.strictEqual(row.parent_bucket, "Income");
    assert.strictEqual(row.subcategory, "Reimbursement");

    db.close();
  });

  it("orders transactions by date descending, then created_at descending", () => {
    const db = createTestDatabase();

    const insertStmt = db.prepare(insertTransactionQuery);
    insertStmt.run(
      "tx-past",
      "2026-09-20",
      "Amex",
      "Food",
      "Groceries",
      "Trader Joe",
      20,
      0,
      "USD",
    );
    insertStmt.run(
      "tx-recent-1",
      "2026-09-25",
      "Chase",
      "Food",
      "Dining",
      "George Howell",
      15,
      0,
      "USD",
    );
    insertStmt.run(
      "tx-recent-2",
      "2026-09-25",
      "Apple Cash",
      "Transit",
      "Subway",
      "MBTA",
      2.4,
      0,
      "CAD",
    );
    insertStmt.run(
      "tx-latest",
      "2026-09-28",
      "Amex",
      "Food",
      "Coffee",
      "Blue Bottle",
      6.5,
      0,
      "USD",
    );

    const queryStmt = db.prepare(selectRecentTransactionsQuery);
    const rows = queryStmt.all(3) as Array<{ id: string; date: string; currency: string }>;

    assert.strictEqual(rows.length, 3);
    assert.strictEqual(rows[0].id, "tx-latest");
    assert.strictEqual(rows[0].date, "2026-09-28");
    assert.strictEqual(rows[0].currency, "USD");
    assert.strictEqual(rows[1].id, "tx-recent-2");
    assert.strictEqual(rows[1].date, "2026-09-25");
    assert.strictEqual(rows[1].currency, "CAD");
    assert.strictEqual(rows[2].id, "tx-recent-1");
    assert.strictEqual(rows[2].date, "2026-09-25");
    assert.strictEqual(rows[2].currency, "USD");

    db.close();
  });

  it("ignores duplicate id insertions via ON CONFLICT DO NOTHING", () => {
    const db = createTestDatabase();

    const insertStmt = db.prepare(insertTransactionQuery);
    insertStmt.run(
      "tx-dup-1",
      "2026-09-20",
      "Amex",
      "Food",
      "Groceries",
      "Trader Joe",
      20,
      0,
      "USD",
    );
    // Duplicate run with the same id should not throw and should be ignored
    insertStmt.run(
      "tx-dup-1",
      "2026-09-20",
      "Amex",
      "Food",
      "Groceries",
      "Trader Joe",
      20,
      0,
      "USD",
    );

    const countStmt = db.prepare(
      "SELECT COUNT(*) AS total FROM transactions WHERE id = 'tx-dup-1'",
    );
    const row = countStmt.get() as { total: number };
    assert.strictEqual(row.total, 1);

    db.close();
  });
});

describe("Paginated Transactions SQLite Query Integration", () => {
  it("supports limit, offset, search, bucket filtering, and month summary", () => {
    const db = createTestDatabase();
    const insertStmt = db.prepare(insertTransactionQuery);

    insertStmt.run(
      "tx-1",
      "2026-10-01",
      "Amex Gold",
      "Guilt-Free",
      "Dining",
      "Sweetgreen",
      20.0,
      0,
      "USD",
    );
    insertStmt.run(
      "tx-2",
      "2026-10-02",
      "Chase",
      "Fixed Costs",
      "Groceries",
      "Whole Foods",
      45.0,
      0,
      "USD",
    );
    insertStmt.run(
      "tx-3",
      "2026-10-05",
      "Amex Gold",
      "Guilt-Free",
      "Coffee",
      "Blue Bottle",
      6.5,
      0,
      "USD",
    );
    insertStmt.run(
      "tx-4",
      "2026-09-15",
      "Apple Card",
      "Guilt-Free",
      "Shopping",
      "Uniqlo",
      50.0,
      0,
      "USD",
    );

    // 1. Unfiltered paginated query (page 1: limit 2, offset 0)
    const paginatedStmt = db.prepare(selectPaginatedTransactionsQuery);
    const countStmt = db.prepare(countTransactionsQuery);
    const monthStmt = db.prepare(selectMonthSummaryQuery);

    const page1 = paginatedStmt.all(null, null, 2, 0) as Array<{ id: string; merchant: string }>;
    assert.strictEqual(page1.length, 2);
    assert.strictEqual(page1[0].id, "tx-3");
    assert.strictEqual(page1[1].id, "tx-2");

    // Page 2: limit 2, offset 2
    const page2 = paginatedStmt.all(null, null, 2, 2) as Array<{ id: string; merchant: string }>;
    assert.strictEqual(page2.length, 2);
    assert.strictEqual(page2[0].id, "tx-1");
    assert.strictEqual(page2[1].id, "tx-4");

    // Total count unfiltered
    const totalRow = countStmt.get(null, null) as { total: number };
    assert.strictEqual(totalRow.total, 4);

    // 2. Search filter by merchant
    const searchSweetgreen = paginatedStmt.all("Sweetgreen", null, 10, 0) as Array<{ id: string }>;
    assert.strictEqual(searchSweetgreen.length, 1);
    assert.strictEqual(searchSweetgreen[0].id, "tx-1");

    // 3. Search filter by card
    const searchAmex = paginatedStmt.all("Amex", null, 10, 0) as Array<{ id: string }>;
    assert.strictEqual(searchAmex.length, 2);

    // 4. Bucket filter
    const guiltFreeRows = paginatedStmt.all(null, "Guilt-Free", 10, 0) as Array<{ id: string }>;
    assert.strictEqual(guiltFreeRows.length, 3);

    // 5. Month summary
    const octSummary = monthStmt.get("2026-10") as { month_net_spend: number; month_count: number };
    assert.strictEqual(octSummary.month_count, 3);
    assert.strictEqual(octSummary.month_net_spend, 71.5);

    const sepSummary = monthStmt.get("2026-09") as { month_net_spend: number; month_count: number };
    assert.strictEqual(sepSummary.month_count, 1);
    assert.strictEqual(sepSummary.month_net_spend, 50.0);

    db.close();
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { handlePost, isValidPayload } from "../functions/api/transactions.ts";

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

describe("handlePost", () => {
  const dummyQuery =
    "INSERT INTO transactions (id, amount, card, category, merchant) VALUES (?, ?, ?, ?, ?);";

  it("inserts valid transaction and returns HTTP 201", async () => {
    let boundArgs: unknown[] = [];
    let executed = false;

    const mockDb = {
      prepare(query: string) {
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: 18.5,
        card: "Amex Gold",
        category: "Dining",
        merchant: "George Howell",
      }),
    });

    const response = await handlePost(request, mockDb, dummyQuery);
    assert.strictEqual(response.status, 201);

    const data = (await response.json()) as { ok: boolean; id: string };
    assert.strictEqual(data.ok, true);
    assert.strictEqual(typeof data.id, "string");
    assert.strictEqual(executed, true);
    assert.deepStrictEqual(boundArgs, [data.id, 18.5, "Amex Gold", "Dining", "George Howell"]);
  });

  it("rejects malformed JSON with HTTP 400", async () => {
    const mockDb = {} as D1Database;
    const request = new Request("http://localhost/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ not valid json",
    });

    const response = await handlePost(request, mockDb, dummyQuery);
    assert.strictEqual(response.status, 400);

    const data = (await response.json()) as { error: string };
    assert.strictEqual(data.error, "Malformed JSON payload");
  });

  it("rejects invalid payload fields with HTTP 400", async () => {
    const mockDb = {} as D1Database;
    const request = new Request("http://localhost/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: -10, card: "", category: "Food", merchant: "Store" }),
    });

    const response = await handlePost(request, mockDb, dummyQuery);
    assert.strictEqual(response.status, 400);

    const data = (await response.json()) as { error: string };
    assert.match(data.error, /Invalid payload/);
  });

  it("returns HTTP 500 when database insertion fails", async () => {
    const mockDb = {
      prepare() {
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: 25.0,
        card: "Visa",
        category: "Groceries",
        merchant: "Trader Joe",
      }),
    });

    const response = await handlePost(request, mockDb, dummyQuery);
    assert.strictEqual(response.status, 500);

    const data = (await response.json()) as { error: string };
    assert.strictEqual(data.error, "D1 execution failed");
  });
});

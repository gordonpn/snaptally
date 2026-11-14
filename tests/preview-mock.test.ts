import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { intakeForm } from "../src/scripts/intake-form.ts";
import {
  createSeedTransactions,
  handlePreviewApiRequest,
  installPreviewFetchMock,
  isPreviewMockEnabled,
  loadPreviewTransactions,
  PREVIEW_DEMO_TOKEN,
  PREVIEW_TRANSACTIONS_KEY,
  resetPreviewData,
} from "../src/scripts/preview-mock.ts";

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
}

describe("Preview Mock Mode", () => {
  const originalLocalStorage = globalThis.localStorage;
  const originalWindow = globalThis.window;

  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      value: createMemoryStorage(),
      configurable: true,
      writable: true,
    });
    delete (globalThis as Record<string, unknown>).__SNAPTALLY_PREVIEW_MOCK__;
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      value: originalLocalStorage,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "window", {
      value: originalWindow,
      configurable: true,
      writable: true,
    });
    delete (globalThis as Record<string, unknown>).__SNAPTALLY_PREVIEW_MOCK__;
  });

  it("reports disabled by default and enabled when preview flag is set", () => {
    assert.strictEqual(isPreviewMockEnabled(), false);
    (globalThis as Record<string, unknown>).__SNAPTALLY_PREVIEW_MOCK__ = true;
    assert.strictEqual(isPreviewMockEnabled(), true);
  });

  it("seeds transactions and demo token on first load and recovers from corrupt storage", () => {
    const seeded = loadPreviewTransactions(new Date("2026-11-14T12:00:00Z"));
    assert.ok(seeded.length >= 10);
    assert.strictEqual(localStorage.getItem("snaptally_api_token"), PREVIEW_DEMO_TOKEN);

    localStorage.setItem(PREVIEW_TRANSACTIONS_KEY, "{not-valid-json");
    const recovered = loadPreviewTransactions(new Date("2026-11-14T12:00:00Z"));
    assert.strictEqual(recovered.length, seeded.length);
  });

  it("handles GET /api/merchants and GET /api/transactions with filtering, pagination, and month summary", async () => {
    const reference = new Date();
    const currentMonth = reference.toISOString().slice(0, 7);
    const seed = createSeedTransactions(reference);
    localStorage.setItem(PREVIEW_TRANSACTIONS_KEY, JSON.stringify(seed));

    const merchantsRes = await handlePreviewApiRequest(
      new URL("https://preview.pages.dev/api/merchants?limit=3"),
    );
    assert.strictEqual(merchantsRes.status, 200);
    const merchantsJson = (await merchantsRes.json()) as { merchants: string[] };
    assert.strictEqual(merchantsJson.merchants.length, 3);

    const pageRes = await handlePreviewApiRequest(
      new URL(`https://preview.pages.dev/api/transactions?limit=2&offset=0&month=${currentMonth}`),
    );
    assert.strictEqual(pageRes.status, 200);
    const pageJson = (await pageRes.json()) as {
      transactions: unknown[];
      total_count: number;
      has_more: boolean;
      next_offset: number | null;
      month_summary: { month: string; net_spend: number; total_count: number };
    };
    assert.strictEqual(pageJson.transactions.length, 2);
    assert.strictEqual(pageJson.has_more, true);
    assert.strictEqual(pageJson.next_offset, 2);
    assert.strictEqual(pageJson.month_summary.month, currentMonth);
    assert.ok(pageJson.month_summary.net_spend > 0);

    const searchRes = await handlePreviewApiRequest(
      new URL("https://preview.pages.dev/api/transactions?search=trader&bucket=Fixed%20Costs"),
    );
    const searchJson = (await searchRes.json()) as { transactions: Array<{ merchant: string }> };
    assert.strictEqual(searchJson.transactions.length, 1);
    assert.strictEqual(searchJson.transactions[0].merchant, "Trader Joe's");
  });

  it("persists POST /api/transactions, deduplicates by id, and rejects invalid payloads", async () => {
    const invalidJsonRes = await handlePreviewApiRequest(
      new URL("https://preview.pages.dev/api/transactions"),
      { method: "POST", body: "{bad" },
    );
    assert.strictEqual(invalidJsonRes.status, 400);

    const invalidPayloadRes = await handlePreviewApiRequest(
      new URL("https://preview.pages.dev/api/transactions"),
      { method: "POST", body: JSON.stringify({ merchant: "" }) },
    );
    assert.strictEqual(invalidPayloadRes.status, 400);

    const payload = {
      id: "custom-preview-id",
      date: new Date().toISOString().slice(0, 10),
      card: "Amex Gold",
      parent_bucket: "Guilt-Free",
      subcategory: "Dining",
      merchant: "Demo Sushi",
      gross_amount: 42.5,
      reimbursement: 0,
      currency: "USD",
    };

    const postRes = await handlePreviewApiRequest(
      new URL("https://preview.pages.dev/api/transactions"),
      { method: "POST", body: JSON.stringify(payload) },
    );
    assert.strictEqual(postRes.status, 201);

    const dupRes = await handlePreviewApiRequest(
      new URL("https://preview.pages.dev/api/transactions"),
      { method: "POST", body: JSON.stringify(payload) },
    );
    assert.strictEqual(dupRes.status, 201);

    const listRes = await handlePreviewApiRequest(
      new URL("https://preview.pages.dev/api/transactions?search=Demo%20Sushi"),
    );
    const listJson = (await listRes.json()) as { total_count: number };
    assert.strictEqual(listJson.total_count, 1);

    const unknownRes = await handlePreviewApiRequest(
      new URL("https://preview.pages.dev/api/unknown"),
    );
    assert.strictEqual(unknownRes.status, 404);
  });

  it("resets preview data back to seed state and restores demo token", async () => {
    await handlePreviewApiRequest(new URL("https://preview.pages.dev/api/transactions"), {
      method: "POST",
      body: JSON.stringify({
        id: "temp-item",
        date: "2026-11-14",
        card: "Savor",
        parent_bucket: "Guilt-Free",
        subcategory: "Dining",
        merchant: "Temp Cafe",
        gross_amount: 12,
      }),
    });
    assert.ok(loadPreviewTransactions().some((tx) => tx.id === "temp-item"));

    localStorage.setItem("snaptally_api_token", "custom-token");
    localStorage.setItem("snaptally_merchants", JSON.stringify(["Temp Cafe"]));
    resetPreviewData();

    assert.strictEqual(
      loadPreviewTransactions().some((tx) => tx.id === "temp-item"),
      false,
    );
    assert.strictEqual(localStorage.getItem("snaptally_api_token"), PREVIEW_DEMO_TOKEN);
    assert.strictEqual(localStorage.getItem("snaptally_merchants"), null);
  });

  it("installs fetch interceptor idempotently and delegates non-API requests", async () => {
    let nativeCalled = 0;
    const fakeWindow = {
      location: { origin: "https://preview.pages.dev" },
      fetch: async () => {
        nativeCalled += 1;
        return new Response("ok", { status: 200 });
      },
    } as unknown as Window & typeof globalThis;

    Object.defineProperty(globalThis, "window", {
      value: fakeWindow,
      configurable: true,
      writable: true,
    });

    installPreviewFetchMock();
    installPreviewFetchMock();

    const apiRes = await fakeWindow.fetch("/api/merchants");
    assert.strictEqual(apiRes.status, 200);
    assert.strictEqual(nativeCalled, 0);

    const assetRes = await fakeWindow.fetch("/manifest.json");
    assert.strictEqual(assetRes.status, 200);
    assert.strictEqual(nativeCalled, 1);
  });

  it("supports resetDemoData from intakeForm settings only when preview mock is enabled", () => {
    const form = intakeForm();
    form.isPreviewMock = false;
    form.resetDemoData();
    assert.strictEqual(form.demoResetMessage, "");

    form.isPreviewMock = true;
    form.loadFrequentMerchants = async () => {};
    form.loadRecentTransactions = async () => {};
    form.resetDemoData();

    assert.strictEqual(form.token, PREVIEW_DEMO_TOKEN);
    assert.strictEqual(form.demoResetMessage, "Demo data restored.");
  });
});

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  ACTIVITY_CACHE_KEY,
  type ActivityTransaction,
  activityView,
} from "../src/scripts/activity.ts";
import { TOKEN_STORAGE_KEY } from "../src/scripts/intake-form.ts";

class MockLocalStorage {
  private store = new Map<string, string>();

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

const mockStorage = new MockLocalStorage();

Object.defineProperty(globalThis, "localStorage", {
  value: mockStorage,
  writable: true,
  configurable: true,
});

function createSampleTx(overrides: Partial<ActivityTransaction> = {}): ActivityTransaction {
  return {
    id: "tx-1",
    date: "2026-10-29",
    card: "Amex Gold",
    parent_bucket: "Guilt-Free",
    subcategory: "Dining",
    merchant: "Sweetgreen",
    gross_amount: 25.5,
    reimbursement: 0,
    net_spend: 25.5,
    currency: "USD",
    created_at: "2026-10-29T12:00:00Z",
    ...overrides,
  };
}

describe("activityView", () => {
  beforeEach(() => {
    mockStorage.clear();
  });

  it("initializes with default state, loads stored token, and triggers loadInitial", async () => {
    mockStorage.setItem(TOKEN_STORAGE_KEY, "test-secret-token");
    let fetchedUrl = "";
    let authHeader = "";

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      fetchedUrl = String(url);
      authHeader = (init?.headers as Record<string, string>)?.Authorization ?? "";
      return new Response(
        JSON.stringify({
          transactions: [createSampleTx()],
          total_count: 1,
          has_more: false,
          next_offset: null,
          month_summary: {
            month: "2026-10",
            net_spend: 25.5,
            total_count: 1,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    try {
      const view = activityView();
      assert.strictEqual(view.token, "");
      assert.strictEqual(view.hasToken, false);

      view.init();
      // Wait for async fetchTransactions
      await new Promise((resolve) => setTimeout(resolve, 10));

      assert.strictEqual(view.token, "test-secret-token");
      assert.strictEqual(view.hasToken, true);
      assert.strictEqual(authHeader, "Bearer test-secret-token");
      assert.match(fetchedUrl, /\/api\/transactions\?limit=20&offset=0/);
      assert.match(fetchedUrl, /month=\d{4}-\d{2}/);
      assert.strictEqual(view.transactions.length, 1);
      assert.strictEqual(view.totalCount, 1);
      assert.strictEqual(view.hasMore, false);
      assert.strictEqual(view.monthSpendFormatted, "25.50");
      assert.strictEqual(view.monthCount, 1);
      assert.strictEqual(view.monthLabel, "October 2026");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("restores the matching first page and summary after a network failure", async () => {
    const originalFetch = globalThis.fetch;
    const summary = { month: "2026-11", net_spend: 25.5, total_count: 7 };
    try {
      globalThis.fetch = async () =>
        Response.json({
          transactions: [createSampleTx()],
          total_count: 7,
          has_more: true,
          next_offset: 20,
          month_summary: summary,
        });
      const online = activityView();
      online.token = "cache-secret";
      await online.fetchTransactions(true);
      const stored = mockStorage.getItem(ACTIVITY_CACHE_KEY) ?? "";
      assert.ok(stored);
      assert.ok(!stored.includes("cache-secret"));
      globalThis.fetch = async () => {
        throw new TypeError("Offline");
      };
      const offline = activityView();
      offline.token = "cache-secret";
      await offline.fetchTransactions(true);
      assert.equal(offline.transactions[0].id, "tx-1");
      assert.deepEqual(offline.monthSummary, summary);
      assert.equal(offline.totalCount, 7);
      assert.equal(offline.hasMore, false);
      assert.equal(offline.showingCached, true);
      assert.equal(offline.error, null);
      globalThis.fetch = async () => Response.json({ transactions: [], total_count: 0 });
      await offline.fetchTransactions(true);
      assert.equal(offline.showingCached, false);
      assert.deepEqual(offline.transactions, []);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("does not restore another token, filter, or month and rejects corrupt caches", async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () => Response.json({ transactions: [createSampleTx()] });
      const view = activityView();
      view.token = "owner";
      await view.fetchTransactions(true);
      const saved = mockStorage.getItem(ACTIVITY_CACHE_KEY) ?? "";
      globalThis.fetch = async () => {
        throw new TypeError("Offline");
      };
      for (const mismatch of ["token", "bucket", "search", "month", "corrupt"]) {
        mockStorage.setItem(ACTIVITY_CACHE_KEY, saved);
        const offline = activityView();
        offline.token = mismatch === "token" ? "someone-else" : "owner";
        if (mismatch === "bucket") offline.selectedBucket = "Income";
        if (mismatch === "search") offline.searchQuery = "Other merchant";
        if (mismatch === "month") {
          const cache = JSON.parse(saved);
          cache.query = cache.query.replace(/month=[^&]+/, "month=2000-01");
          mockStorage.setItem(ACTIVITY_CACHE_KEY, JSON.stringify(cache));
        }
        if (mismatch === "corrupt") mockStorage.setItem(ACTIVITY_CACHE_KEY, "{");
        await offline.fetchTransactions(true);
        assert.equal(offline.transactions.length, 0, mismatch);
        assert.equal(offline.showingCached, false, mismatch);
        assert.equal(offline.error, "Offline", mismatch);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("does not mask HTTP errors with cached data and clears unauthorized caches", async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () => Response.json({ transactions: [createSampleTx()] });
      const view = activityView();
      view.token = "owner";
      await view.fetchTransactions(true);
      const saved = mockStorage.getItem(ACTIVITY_CACHE_KEY);
      globalThis.fetch = async () => new Response("Server error", { status: 500 });
      await view.fetchTransactions(true);
      assert.equal(view.showingCached, false);
      assert.equal(view.transactions.length, 0);
      assert.equal(mockStorage.getItem(ACTIVITY_CACHE_KEY), saved);
      globalThis.fetch = async () => new Response("Unauthorized", { status: 401 });
      await view.fetchTransactions(true);
      assert.equal(mockStorage.getItem(ACTIVITY_CACHE_KEY), null);
      assert.equal(view.monthSummary, null);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("groups transactions by date preserving descending order and setting dateLabel", () => {
    const view = activityView();
    view.transactions = [
      createSampleTx({ id: "tx-1", date: "2026-10-29", merchant: "Sweetgreen" }),
      createSampleTx({ id: "tx-2", date: "2026-10-29", merchant: "Blue Bottle" }),
      createSampleTx({ id: "tx-3", date: "2026-10-28", merchant: "Whole Foods" }),
      createSampleTx({ id: "tx-4", date: "2026-10-25", merchant: "Trader Joe's" }),
    ];

    const groups = view.groupedTransactions;
    assert.strictEqual(groups.length, 3);
    assert.strictEqual(groups[0].date, "2026-10-29");
    assert.strictEqual(groups[0].transactions.length, 2);
    assert.strictEqual(groups[1].date, "2026-10-28");
    assert.strictEqual(groups[1].transactions.length, 1);
    assert.strictEqual(groups[2].date, "2026-10-25");
    assert.strictEqual(groups[2].transactions.length, 1);
  });

  it("handles bucket filtering by updating selectedBucket and resetting offset", async () => {
    let capturedUrl = "";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request) => {
      capturedUrl = String(url);
      return new Response(
        JSON.stringify({
          transactions: [createSampleTx({ parent_bucket: "Fixed Costs" })],
          total_count: 1,
          has_more: false,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    try {
      const view = activityView();
      view.setBucket("Fixed Costs");
      await new Promise((resolve) => setTimeout(resolve, 10));

      assert.strictEqual(view.selectedBucket, "Fixed Costs");
      assert.match(capturedUrl, /bucket=Fixed\+Costs/);

      // Calling setBucket with same bucket is a no-op
      capturedUrl = "";
      view.setBucket("Fixed Costs");
      assert.strictEqual(capturedUrl, "");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("handles search input debouncing and clearSearch", async () => {
    let capturedUrl = "";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request) => {
      capturedUrl = String(url);
      return new Response(JSON.stringify({ transactions: [], total_count: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    try {
      const view = activityView();
      view.handleSearch("Wh");
      view.handleSearch("Whole");

      // Before debounce fires
      assert.strictEqual(view.searchQuery, "Whole");
      assert.strictEqual(capturedUrl, "");

      // Wait for debounce (250ms)
      await new Promise((resolve) => setTimeout(resolve, 270));
      assert.match(capturedUrl, /search=Whole/);

      // Clear search immediately triggers reload
      capturedUrl = "";
      view.clearSearch();
      await new Promise((resolve) => setTimeout(resolve, 10));
      assert.strictEqual(view.searchQuery, "");
      assert.doesNotMatch(capturedUrl, /search=/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("loads more paginated records when loadMore is called", async () => {
    let capturedUrl = "";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request) => {
      capturedUrl = String(url);
      return new Response(
        JSON.stringify({
          transactions: [createSampleTx({ id: "tx-2" })],
          total_count: 5,
          has_more: true,
          next_offset: 2,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    try {
      const view = activityView();
      view.transactions = [createSampleTx({ id: "tx-1" })];
      view.offset = 1;
      view.hasMore = true;

      view.loadMore();
      await new Promise((resolve) => setTimeout(resolve, 10));

      assert.match(capturedUrl, /offset=1/);
      assert.strictEqual(view.transactions.length, 2);
      assert.strictEqual(view.transactions[0].id, "tx-1");
      assert.strictEqual(view.transactions[1].id, "tx-2");
      assert.strictEqual(view.offset, 2);
      assert.strictEqual(view.hasMore, true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("guards loadMore when already loading or hasMore is false", () => {
    let fetchCalled = false;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response(JSON.stringify({ transactions: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    try {
      const view = activityView();
      view.hasMore = false;
      view.loadMore();
      assert.strictEqual(fetchCalled, false);

      view.hasMore = true;
      view.loading = true;
      view.loadMore();
      assert.strictEqual(fetchCalled, false);

      view.loading = false;
      view.loadingMore = true;
      view.loadMore();
      assert.strictEqual(fetchCalled, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("handles 401 Unauthorized by displaying appropriate error message", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }) as unknown as typeof fetch;

    try {
      const view = activityView();
      await view.fetchTransactions(true);
      assert.match(view.error ?? "", /Unauthorized/);
      assert.strictEqual(view.transactions.length, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("handles network failure and server 500 error gracefully", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("Network connection dropped");
    }) as unknown as typeof fetch;

    try {
      const view = activityView();
      await view.fetchTransactions(true);
      assert.strictEqual(view.error, "Network connection dropped");
    } finally {
      globalThis.fetch = originalFetch;
    }

    globalThis.fetch = (async () => {
      return new Response("Internal Server Error", { status: 500 });
    }) as unknown as typeof fetch;

    try {
      const view = activityView();
      await view.fetchTransactions(true);
      assert.strictEqual(view.error, "Failed to load activity (500)");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("refresh triggers loadInitial", async () => {
    let capturedUrl = "";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request) => {
      capturedUrl = String(url);
      return new Response(JSON.stringify({ transactions: [], total_count: 0 }), { status: 200 });
    }) as unknown as typeof fetch;

    try {
      const view = activityView();
      view.refresh();
      await new Promise((resolve) => setTimeout(resolve, 10));
      assert.match(capturedUrl, /limit=20&offset=0/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("handles localStorage access error gracefully", () => {
    const errorStorage = {
      getItem() {
        throw new Error("SecurityError: Access is denied");
      },
    };
    Object.defineProperty(globalThis, "localStorage", {
      value: errorStorage,
      writable: true,
      configurable: true,
    });
    try {
      const view = activityView();
      view.loadToken();
      assert.strictEqual(view.token, "");
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        value: mockStorage,
        writable: true,
        configurable: true,
      });
    }
  });

  it("falls back to transactions length when total_count or next_offset are omitted", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          transactions: [createSampleTx()],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    try {
      const view = activityView();
      await view.fetchTransactions(true);
      assert.strictEqual(view.totalCount, 1);
      assert.strictEqual(view.offset, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("ignores responses from superseded out-of-order requests", async () => {
    let slowResolve: (res: Response) => void = () => {};
    let fastResolve: (res: Response) => void = () => {};

    const slowPromise = new Promise<Response>((resolve) => {
      slowResolve = resolve;
    });
    const fastPromise = new Promise<Response>((resolve) => {
      fastResolve = resolve;
    });

    let callCount = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      callCount++;
      if (callCount === 1) {
        return slowPromise;
      }
      return fastPromise;
    }) as unknown as typeof fetch;

    try {
      const view = activityView();

      // Trigger first request (slow)
      const req1 = view.fetchTransactions(true);

      // Trigger second request (fast)
      const req2 = view.fetchTransactions(true);

      // Resolve fast second request first
      fastResolve(
        new Response(
          JSON.stringify({
            transactions: [createSampleTx({ id: "tx-fast", merchant: "Fast Merchant" })],
            total_count: 1,
            has_more: false,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
      await req2;

      assert.strictEqual(view.transactions.length, 1);
      assert.strictEqual(view.transactions[0].id, "tx-fast");

      // Resolve slow first request later (should be ignored)
      slowResolve(
        new Response(
          JSON.stringify({
            transactions: [createSampleTx({ id: "tx-slow", merchant: "Slow Merchant" })],
            total_count: 10,
            has_more: true,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
      await req1;

      // Stale request must not overwrite state
      assert.strictEqual(view.transactions.length, 1);
      assert.strictEqual(view.transactions[0].id, "tx-fast");
      assert.strictEqual(view.totalCount, 1);
      assert.strictEqual(view.hasMore, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("deduplicates transactions when appending a page with overlapping IDs", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          transactions: [
            createSampleTx({ id: "tx-1", merchant: "Duplicate Row" }),
            createSampleTx({ id: "tx-2", merchant: "New Row" }),
          ],
          total_count: 2,
          has_more: false,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    try {
      const view = activityView();
      view.transactions = [createSampleTx({ id: "tx-1", merchant: "Existing Row" })];
      view.hasMore = true;

      view.loadMore();
      await new Promise((resolve) => setTimeout(resolve, 10));

      assert.strictEqual(view.transactions.length, 2);
      assert.strictEqual(view.transactions[0].id, "tx-1");
      assert.strictEqual(view.transactions[1].id, "tx-2");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("formats transaction time using formatTime method", () => {
    const view = activityView();
    assert.match(view.formatTime("2026-10-29T14:30:00Z"), /\d{1,2}:\d{2}\s*(?:AM|PM)/i);
    assert.strictEqual(view.formatTime(undefined), "");
  });
});

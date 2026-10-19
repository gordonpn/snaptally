import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  DEFAULT_FREQUENT_MERCHANTS,
  intakeForm,
  MERCHANTS_STORAGE_KEY,
} from "../src/scripts/intake-form.ts";
import {
  clearDeadLetterQueue,
  clearOutbox,
  clearRetryTimer,
  DB_VERSION,
  type DeadLetterItem,
  DLQ_FALLBACK_STORAGE_KEY,
  DLQ_STORE_NAME,
  deleteDeadLetterItem,
  deleteOutboxItem,
  getDeadLetterCount,
  getDeadLetterQueue,
  getOutbox,
  getOutboxCount,
  MAX_SYNC_RETRIES,
  type OutboxItem,
  requeueDeadLetterItem,
  saveDeadLetterItem,
  saveOutboxItem,
  setupSyncListeners,
  syncOutbox,
} from "../src/scripts/outbox.ts";

// Helper mock storage
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

describe("Optimistic Outbox Storage", () => {
  beforeEach(async () => {
    await clearOutbox();
  });

  it("saves, retrieves, and deletes items from outbox", async () => {
    const item1: OutboxItem = {
      id: "tx-1",
      date: "2026-10-02",
      card: "Amex Gold",
      parent_bucket: "Guilt-Free",
      subcategory: "Dining",
      merchant: "Sweetgreen",
      gross_amount: 18.5,
      reimbursement: 0,
      created_at: new Date().toISOString(),
    };

    const item2: OutboxItem = {
      id: "tx-2",
      date: "2026-10-02",
      card: "Chase Sapphire",
      parent_bucket: "Fixed Costs",
      subcategory: "Groceries",
      merchant: "Trader Joe's",
      gross_amount: 45.2,
      reimbursement: 0,
      created_at: new Date(Date.now() + 1000).toISOString(),
    };

    await saveOutboxItem(item1);
    await saveOutboxItem(item2);

    let items = await getOutbox();
    assert.strictEqual(items.length, 2);
    assert.strictEqual(items[0].id, "tx-1");
    assert.strictEqual(items[1].id, "tx-2");
    assert.strictEqual(await getOutboxCount(), 2);

    await deleteOutboxItem("tx-1");
    items = await getOutbox();
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].id, "tx-2");
    assert.strictEqual(await getOutboxCount(), 1);

    await clearOutbox();
    assert.strictEqual(await getOutboxCount(), 0);
  });
});

describe("Background Sync Manager", () => {
  beforeEach(async () => {
    await clearOutbox();
  });

  it("flushes queued items sequentially and deletes on HTTP 201", async () => {
    const item1: OutboxItem = {
      id: "tx-1",
      date: "2026-10-02",
      card: "Amex Gold",
      parent_bucket: "Guilt-Free",
      subcategory: "Dining",
      merchant: "Sweetgreen",
      gross_amount: 18.5,
      reimbursement: 0,
      created_at: new Date().toISOString(),
    };

    const item2: OutboxItem = {
      id: "tx-2",
      date: "2026-10-02",
      card: "Chase Sapphire",
      parent_bucket: "Fixed Costs",
      subcategory: "Groceries",
      merchant: "Trader Joe's",
      gross_amount: 45.2,
      reimbursement: 0,
      created_at: new Date(Date.now() + 1000).toISOString(),
    };

    await saveOutboxItem(item1);
    await saveOutboxItem(item2);

    const originalFetch = globalThis.fetch;
    const syncedIds: string[] = [];

    try {
      globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = String(url);
        if (urlStr.includes("/api/transactions") && init?.method === "POST") {
          const body = JSON.parse(String(init.body)) as { merchant: string; id: string };
          syncedIds.push(body.merchant);
          assert.strictEqual(body.id, `tx-${syncedIds.length}`);
          return new Response(JSON.stringify({ ok: true, id: `server-${syncedIds.length}` }), {
            status: 201,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response("Not found", { status: 404 });
      }) as typeof fetch;

      const syncedRecords: OutboxItem[] = [];
      const result = await syncOutbox({
        token: "test-token",
        onItemSynced: (item) => {
          syncedRecords.push(item);
        },
      });

      assert.strictEqual(result.syncedCount, 2);
      assert.strictEqual(result.failedCount, 0);
      assert.deepStrictEqual(syncedIds, ["Sweetgreen", "Trader Joe's"]);
      assert.strictEqual(syncedRecords.length, 2);

      const remaining = await getOutbox();
      assert.strictEqual(remaining.length, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("retains failed items in outbox when server is unreachable or offline", async () => {
    const item: OutboxItem = {
      id: "tx-fail",
      date: "2026-10-02",
      card: "Amex Gold",
      parent_bucket: "Guilt-Free",
      subcategory: "Dining",
      merchant: "Chipotle",
      gross_amount: 14.2,
      reimbursement: 0,
      created_at: new Date().toISOString(),
    };

    await saveOutboxItem(item);

    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async () => {
        throw new TypeError("Failed to fetch: NetworkError");
      }) as typeof fetch;

      const result = await syncOutbox({
        token: "test-token",
      });

      assert.strictEqual(result.syncedCount, 0);
      assert.strictEqual(result.failedCount, 1);

      const remaining = await getOutbox();
      assert.strictEqual(remaining.length, 1);
      assert.strictEqual(remaining[0].id, "tx-fail");
      assert.strictEqual((remaining[0].retry_count ?? 0) >= 1, true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("pauses sync without dropping records on HTTP 401 unauthorized", async () => {
    const item: OutboxItem = {
      id: "tx-unauth",
      date: "2026-10-02",
      card: "Amex Gold",
      parent_bucket: "Guilt-Free",
      subcategory: "Dining",
      merchant: "Chipotle",
      gross_amount: 14.2,
      reimbursement: 0,
      created_at: new Date().toISOString(),
    };

    await saveOutboxItem(item);

    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async () => {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }) as typeof fetch;

      const result = await syncOutbox({
        token: "invalid-token",
      });

      assert.strictEqual(result.syncedCount, 0);
      assert.strictEqual(result.unauthorized, true);

      const remaining = await getOutbox();
      assert.strictEqual(remaining.length, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("evicts permanently invalid items on HTTP 400 and captures error", async () => {
    const item: OutboxItem = {
      id: "tx-invalid",
      date: "2026-10-02",
      card: "Visa",
      parent_bucket: "Guilt-Free",
      subcategory: "Dining",
      merchant: "Bad Data",
      gross_amount: 10,
      reimbursement: 0,
      created_at: new Date().toISOString(),
    };

    await saveOutboxItem(item);

    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async () => {
        return new Response(JSON.stringify({ error: "Invalid payload format" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }) as typeof fetch;

      const result = await syncOutbox({ token: "test-token" });
      assert.strictEqual(result.syncedCount, 0);
      assert.strictEqual(result.failedCount, 1);
      assert.strictEqual(result.lastError, "Invalid payload format");

      const remaining = await getOutbox();
      assert.strictEqual(remaining.length, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("handles HTTP 500 server errors by incrementing retry count and stopping flush", async () => {
    const item: OutboxItem = {
      id: "tx-500",
      date: "2026-10-02",
      card: "Visa",
      parent_bucket: "Guilt-Free",
      subcategory: "Dining",
      merchant: "Server Fail",
      gross_amount: 25,
      reimbursement: 0,
      created_at: new Date().toISOString(),
    };

    await saveOutboxItem(item);

    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async () => {
        return new Response("Internal Server Error", { status: 500 });
      }) as typeof fetch;

      const result = await syncOutbox({ token: "test-token" });
      assert.strictEqual(result.syncedCount, 0);
      assert.strictEqual(result.failedCount, 1);

      const remaining = await getOutbox();
      assert.strictEqual(remaining.length, 1);
      assert.strictEqual(remaining[0].retry_count, 1);
      assert.ok(remaining[0].next_retry_at !== undefined);
      assert.ok((remaining[0].next_retry_at ?? 0) > Date.now() - 1000);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("applies exponential backoff schedule and skips queued items until backoff window expires unless forced", async () => {
    const item: OutboxItem = {
      id: "tx-backoff",
      date: "2026-10-02",
      card: "Visa",
      parent_bucket: "Guilt-Free",
      subcategory: "Dining",
      merchant: "Throttled",
      gross_amount: 12,
      reimbursement: 0,
      created_at: new Date().toISOString(),
      retry_count: 2,
      next_retry_at: Date.now() + 10000, // 10 seconds in the future
    };

    await saveOutboxItem(item);

    const originalFetch = globalThis.fetch;
    let fetchAttempts = 0;
    try {
      globalThis.fetch = (async () => {
        fetchAttempts++;
        return new Response(JSON.stringify({ ok: true, id: "srv-backoff" }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      }) as typeof fetch;

      // 1. Sync without force: should skip item because next_retry_at is in future
      const skippedResult = await syncOutbox({ token: "test-token" });
      assert.strictEqual(skippedResult.syncedCount, 0);
      assert.strictEqual(fetchAttempts, 0);

      // 2. Sync with force: should ignore backoff and attempt sync immediately
      const forcedResult = await syncOutbox({ token: "test-token", force: true });
      assert.strictEqual(forcedResult.syncedCount, 1);
      assert.strictEqual(fetchAttempts, 1);

      const remaining = await getOutbox();
      assert.strictEqual(remaining.length, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("schedules automatic retry callback on failure and clears it on cleanup", async () => {
    const item: OutboxItem = {
      id: "tx-timer-test",
      date: "2026-10-02",
      card: "Visa",
      parent_bucket: "Guilt-Free",
      subcategory: "Dining",
      merchant: "Failing Server",
      gross_amount: 15,
      reimbursement: 0,
      created_at: new Date().toISOString(),
    };

    await saveOutboxItem(item);

    const originalFetch = globalThis.fetch;
    let scheduledDelayMs = -1;
    try {
      globalThis.fetch = (async () => {
        return new Response("Internal Server Error", { status: 500 });
      }) as typeof fetch;

      await syncOutbox({
        token: "test-token",
        onScheduleRetry: (delayMs) => {
          scheduledDelayMs = delayMs;
        },
      });

      assert.strictEqual(scheduledDelayMs, 1000);
      assert.doesNotThrow(() => clearRetryTimer());
    } finally {
      globalThis.fetch = originalFetch;
      clearRetryTimer();
    }
  });

  it("reschedules earliest pending retry on finalization when items remain", async () => {
    const item1: OutboxItem = {
      id: "tx-pending-1",
      date: "2026-10-02",
      card: "Visa",
      parent_bucket: "Guilt-Free",
      subcategory: "Dining",
      merchant: "Pending Item",
      gross_amount: 15,
      reimbursement: 0,
      created_at: new Date().toISOString(),
      next_retry_at: Date.now() + 5000,
    };
    const item2: OutboxItem = {
      id: "tx-success-2",
      date: "2026-10-02",
      card: "Visa",
      parent_bucket: "Guilt-Free",
      subcategory: "Dining",
      merchant: "Success Item",
      gross_amount: 20,
      reimbursement: 0,
      created_at: new Date().toISOString(),
    };

    await saveOutboxItem(item1);
    await saveOutboxItem(item2);

    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async () => {
        return new Response(JSON.stringify({ ok: true, id: "tx-success-2" }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      }) as typeof fetch;

      let triggered = false;
      const cleanup = setupSyncListeners(() => {
        triggered = true;
      });

      await syncOutbox({ token: "test-token" });

      const remaining = await getOutbox();
      assert.strictEqual(remaining.length, 1);
      assert.strictEqual(remaining[0].id, "tx-pending-1");

      cleanup();
      assert.strictEqual(triggered, false);
    } finally {
      globalThis.fetch = originalFetch;
      clearRetryTimer();
    }
  });

  it("prevents concurrent sync executions", async () => {
    const item: OutboxItem = {
      id: "tx-lock",
      date: "2026-10-02",
      card: "Visa",
      parent_bucket: "Guilt-Free",
      subcategory: "Dining",
      merchant: "Test Lock",
      gross_amount: 15,
      reimbursement: 0,
      created_at: new Date().toISOString(),
    };

    await saveOutboxItem(item);

    const originalFetch = globalThis.fetch;
    try {
      let notifyFetchCalled: () => void = () => {};
      const fetchCalled = new Promise<void>((r) => {
        notifyFetchCalled = r;
      });

      let releaseFetch: () => void = () => {};
      const releasePromise = new Promise<void>((r) => {
        releaseFetch = r;
      });

      globalThis.fetch = (async () => {
        notifyFetchCalled();
        await releasePromise;
        return new Response(JSON.stringify({ ok: true, id: "done" }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      }) as typeof fetch;

      const firstSyncPromise = syncOutbox({ token: "test-token" });
      await fetchCalled;
      const secondSyncResult = await syncOutbox({ token: "test-token" });

      assert.strictEqual(secondSyncResult.syncedCount, 0);
      assert.strictEqual(secondSyncResult.failedCount, 0);

      releaseFetch();
      const firstSyncResult = await firstSyncPromise;
      assert.strictEqual(firstSyncResult.syncedCount, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("Optimistic Intake Form & Merchant Autocomplete (Scenario 1 & 2)", () => {
  let mockStorage: MockLocalStorage;
  const originalLocalStorage = globalThis.localStorage;

  beforeEach(async () => {
    await clearOutbox();
    mockStorage = new MockLocalStorage();
    Object.defineProperty(globalThis, "localStorage", {
      value: mockStorage,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      value: originalLocalStorage,
      writable: true,
      configurable: true,
    });
  });

  it("clears form fields immediately (0ms perceived latency) and enqueues to outbox", async () => {
    const form = intakeForm();
    form.init();

    // Populate valid transaction
    form.card = "Amex Gold";
    form.pressDigit(1);
    form.pressDigit(2);
    form.pressDigit(5);
    form.pressDigit(0); // $12.50
    form.selectBucket("Guilt-Free");
    form.selectSubcategory("Dining");
    form.selectMerchant("Chipotle");

    const originalFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response(JSON.stringify({ ok: true, id: "srv-1" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    try {
      const submitted = await form.submitTransaction();
      assert.strictEqual(submitted, true);

      // Form state reset immediately
      assert.strictEqual(form.amountCents, 0);
      assert.strictEqual(form.formattedAmount, "$0.00");
      assert.strictEqual(form.isToday, true);
      assert.match(form.statusMessage, /Saved \$12\.50 at Chipotle/);

      // Verify outbox was populated and background sync was invoked
      assert.strictEqual(fetchCalled, true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("handles offline submit by queueing in outbox and syncing on reconnection", async () => {
    const form = intakeForm();
    form.init();

    form.card = "Amex Gold";
    form.pressDigit(2);
    form.pressDigit(0);
    form.pressDigit(0);
    form.pressDigit(0); // $20.00
    form.selectMerchant("Target");

    const originalFetch = globalThis.fetch;
    // Simulate offline
    globalThis.fetch = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;

    try {
      const submitted = await form.submitTransaction();
      assert.strictEqual(submitted, true);

      // Form is still cleared optimistically!
      assert.strictEqual(form.amountCents, 0);
      assert.strictEqual(form.formattedAmount, "$0.00");
      assert.match(form.statusMessage, /Saved \$20\.00 at Target/);

      // Outbox has the queued item
      const outbox = await getOutbox();
      assert.strictEqual(outbox.length, 1);
      assert.strictEqual(outbox[0].merchant, "Target");
      assert.strictEqual(outbox[0].gross_amount, 20);

      // Now restore network connection and trigger sync
      globalThis.fetch = (async () => {
        return new Response(JSON.stringify({ ok: true, id: "srv-target" }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      }) as typeof fetch;

      const syncResult = await form.syncPendingOutbox(true);
      assert.strictEqual(syncResult.syncedCount, 1);

      // Outbox is now empty
      const afterSync = await getOutbox();
      assert.strictEqual(afterSync.length, 0);

      // Transaction is prepended to recent list
      assert.strictEqual(form.recentTransactions.length, 1);
      assert.strictEqual(form.recentTransactions[0].merchant, "Target");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("caches distinct merchants locally for offline datalist autocomplete", async () => {
    const form = intakeForm();
    form.init();

    // Verify initial merchants seed from defaults
    assert.deepStrictEqual(form.allMerchants, DEFAULT_FREQUENT_MERCHANTS);

    // Enter a new custom merchant
    form.toggleCustomMerchant();
    form.updateCustomMerchant("Local Bakery");
    form.card = "Visa";
    form.pressDigit(5);
    form.pressDigit(0);
    form.pressDigit(0); // $5.00

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ ok: true, id: "srv-bakery" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    try {
      await form.submitTransaction();

      // Local Bakery added to merchants cache
      assert.ok(form.allMerchants.includes("Local Bakery"));

      // Stored in localStorage
      const stored = mockStorage.getItem(MERCHANTS_STORAGE_KEY);
      assert.ok(stored !== null);
      const parsed = JSON.parse(stored as string) as string[];
      assert.ok(parsed.includes("Local Bakery"));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("IndexedDB Native Storage Branch", () => {
  it("uses native indexedDB when available", async () => {
    const store = new Map<string, OutboxItem>();
    const mockDb = {
      objectStoreNames: {
        contains: (name: string) => name === "outbox",
      },
      createObjectStore: (_name: string, _opts: unknown) => {},
      transaction: (_storeName: string, _mode: string) => {
        const txObj = {
          objectStore: (_name: string) => ({
            put: (item: OutboxItem) => {
              store.set(item.id, item);
              const req: { onsuccess?: () => void; onerror?: () => void } = {};
              setTimeout(() => req.onsuccess?.(), 0);
              return req;
            },
            getAll: () => {
              const req: { result?: OutboxItem[]; onsuccess?: () => void; onerror?: () => void } = {
                result: Array.from(store.values()),
              };
              setTimeout(() => req.onsuccess?.(), 0);
              return req;
            },
            delete: (id: string) => {
              store.delete(id);
              const req: { onsuccess?: () => void; onerror?: () => void } = {};
              setTimeout(() => req.onsuccess?.(), 0);
              return req;
            },
            clear: () => {
              store.clear();
              const req: { onsuccess?: () => void; onerror?: () => void } = {};
              setTimeout(() => req.onsuccess?.(), 0);
              return req;
            },
          }),
          oncomplete: () => {},
        };
        return txObj;
      },
      close: () => {},
    };

    const mockIndexedDB = {
      open: (_name: string, _version: number) => {
        const req: {
          result: typeof mockDb;
          onsuccess?: () => void;
          onupgradeneeded?: () => void;
          onerror?: () => void;
        } = {
          result: mockDb,
        };
        setTimeout(() => {
          req.onupgradeneeded?.();
          req.onsuccess?.();
        }, 0);
        return req;
      },
    };

    const originalIDB = globalThis.indexedDB;
    Object.defineProperty(globalThis, "indexedDB", {
      value: mockIndexedDB,
      writable: true,
      configurable: true,
    });

    try {
      const item: OutboxItem = {
        id: "idb-1",
        date: "2026-10-02",
        card: "Visa",
        parent_bucket: "Savings",
        subcategory: "Emergency Fund",
        merchant: "Bank",
        gross_amount: 100,
        reimbursement: 0,
        created_at: new Date().toISOString(),
      };

      await saveOutboxItem(item);
      const items = await getOutbox();
      assert.strictEqual(items.length, 1);
      assert.strictEqual(items[0].id, "idb-1");

      await deleteOutboxItem("idb-1");
      assert.strictEqual(await getOutboxCount(), 0);

      await saveOutboxItem(item);
      await clearOutbox();
      assert.strictEqual(await getOutboxCount(), 0);
    } finally {
      Object.defineProperty(globalThis, "indexedDB", {
        value: originalIDB,
        writable: true,
        configurable: true,
      });
    }
  });

  it("handles IndexedDB open and transaction failures gracefully by falling back", async () => {
    const failingIndexedDB = {
      open: () => {
        const req: { onerror?: (ev: unknown) => void; error?: Error } = {
          error: new Error("IDB open blocked"),
        };
        setTimeout(() => req.onerror?.({}), 0);
        return req;
      },
    };

    const originalIDB = globalThis.indexedDB;
    Object.defineProperty(globalThis, "indexedDB", {
      value: failingIndexedDB,
      writable: true,
      configurable: true,
    });

    try {
      const item: OutboxItem = {
        id: "fb-1",
        date: "2026-10-02",
        card: "Visa",
        parent_bucket: "Fixed Costs",
        subcategory: "Rent",
        merchant: "Landlord",
        gross_amount: 1500,
        reimbursement: 0,
        created_at: new Date().toISOString(),
      };

      await saveOutboxItem(item);
      const items = await getOutbox();
      assert.strictEqual(items.length, 1);
      assert.strictEqual(items[0].id, "fb-1");

      await deleteOutboxItem("fb-1");
      assert.strictEqual(await getOutboxCount(), 0);
    } finally {
      Object.defineProperty(globalThis, "indexedDB", {
        value: originalIDB,
        writable: true,
        configurable: true,
      });
    }
  });
});

describe("Sync Listeners (Scenario 2)", () => {
  it("registers online and visibilitychange listeners and triggers sync", () => {
    let syncTriggered = false;
    const listeners: Record<string, () => void> = {};

    const originalWindow = globalThis.window;
    const originalDocument = globalThis.document;

    Object.defineProperty(globalThis, "window", {
      value: {
        addEventListener: (event: string, cb: () => void) => {
          listeners[event] = cb;
        },
        removeEventListener: (event: string) => {
          delete listeners[event];
        },
      },
      writable: true,
      configurable: true,
    });

    Object.defineProperty(globalThis, "document", {
      value: {
        visibilityState: "visible",
        addEventListener: (event: string, cb: () => void) => {
          listeners[event] = cb;
        },
        removeEventListener: (event: string) => {
          delete listeners[event];
        },
      },
      writable: true,
      configurable: true,
    });

    try {
      const cleanup = setupSyncListeners(() => {
        syncTriggered = true;
      });

      assert.ok(listeners.online);
      assert.ok(listeners.visibilitychange);

      listeners.online();
      assert.strictEqual(syncTriggered, true);

      syncTriggered = false;
      listeners.visibilitychange();
      assert.strictEqual(syncTriggered, true);

      cleanup();
      assert.strictEqual(listeners.online, undefined);
      assert.strictEqual(listeners.visibilitychange, undefined);
    } finally {
      Object.defineProperty(globalThis, "window", {
        value: originalWindow,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(globalThis, "document", {
        value: originalDocument,
        writable: true,
        configurable: true,
      });
    }
  });

  it("does not trigger sync when visibilityState is hidden", () => {
    let syncTriggered = false;
    const listeners: Record<string, () => void> = {};

    const originalWindow = globalThis.window;
    const originalDocument = globalThis.document;

    Object.defineProperty(globalThis, "window", {
      value: {
        addEventListener: (event: string, cb: () => void) => {
          listeners[event] = cb;
        },
        removeEventListener: (event: string) => {
          delete listeners[event];
        },
      },
      writable: true,
      configurable: true,
    });

    Object.defineProperty(globalThis, "document", {
      value: {
        visibilityState: "hidden",
        addEventListener: (event: string, cb: () => void) => {
          listeners[event] = cb;
        },
        removeEventListener: (event: string) => {
          delete listeners[event];
        },
      },
      writable: true,
      configurable: true,
    });

    try {
      const cleanup = setupSyncListeners(() => {
        syncTriggered = true;
      });

      listeners.visibilitychange();
      assert.strictEqual(syncTriggered, false);
      cleanup();
    } finally {
      Object.defineProperty(globalThis, "window", {
        value: originalWindow,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(globalThis, "document", {
        value: originalDocument,
        writable: true,
        configurable: true,
      });
    }
  });

  it("handles undefined window in setupSyncListeners gracefully", () => {
    const originalWindow = globalThis.window;
    Object.defineProperty(globalThis, "window", {
      value: undefined,
      writable: true,
      configurable: true,
    });

    try {
      const cleanup = setupSyncListeners(() => {});
      assert.doesNotThrow(() => cleanup());
    } finally {
      Object.defineProperty(globalThis, "window", {
        value: originalWindow,
        writable: true,
        configurable: true,
      });
    }
  });

  it("creates object store when not present during IDB upgradeneeded", async () => {
    const createdStoreNames: string[] = [];
    const mockDb = {
      objectStoreNames: {
        contains: (_name: string) => false,
      },
      createObjectStore: (name: string, _opts: unknown) => {
        createdStoreNames.push(name);
      },
      transaction: () => ({
        objectStore: () => ({
          put: () => {
            const req: { onsuccess?: () => void } = {};
            setTimeout(() => req.onsuccess?.(), 0);
            return req;
          },
        }),
        oncomplete: () => {},
      }),
      close: () => {},
    };

    const mockIndexedDB = {
      open: () => {
        const req: {
          result: typeof mockDb;
          onsuccess?: () => void;
          onupgradeneeded?: () => void;
        } = {
          result: mockDb,
        };
        setTimeout(() => {
          req.onupgradeneeded?.();
          req.onsuccess?.();
        }, 0);
        return req;
      },
    };

    const originalIDB = globalThis.indexedDB;
    Object.defineProperty(globalThis, "indexedDB", {
      value: mockIndexedDB,
      writable: true,
      configurable: true,
    });

    try {
      await saveOutboxItem({
        id: "tx-upgrade",
        date: "2026-10-02",
        card: "Visa",
        parent_bucket: "Savings",
        subcategory: "Investments",
        merchant: "Vanguard",
        gross_amount: 500,
        reimbursement: 0,
        created_at: new Date().toISOString(),
      });
      assert.deepStrictEqual(createdStoreNames, ["outbox", "dead_letter_queue"]);
    } finally {
      Object.defineProperty(globalThis, "indexedDB", {
        value: originalIDB,
        writable: true,
        configurable: true,
      });
    }
  });

  it("retains queued credit items with backoff when receiving HTTP 400 from older API version", async () => {
    const creditItem: OutboxItem = {
      id: "tx-credit-retain",
      date: "2026-10-01",
      card: "Amex Gold",
      parent_bucket: "Guilt-Free",
      subcategory: "Dining",
      merchant: "Venmo Reimbursement",
      gross_amount: -60.0,
      reimbursement: 0,
      created_at: new Date().toISOString(),
    };

    await saveOutboxItem(creditItem);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({ error: "Validation failed: gross_amount must be positive" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }) as unknown as typeof fetch;

    try {
      const result = await syncOutbox({ token: "test-token" });
      assert.strictEqual(result.failedCount, 1);
      assert.strictEqual(result.syncedCount, 0);

      const items = await getOutbox();
      assert.strictEqual(items.length, 1);
      assert.strictEqual(items[0].id, "tx-credit-retain");
      assert.strictEqual(items[0].rollback_retry_count, 1);
      assert.strictEqual(items[0].retry_count, undefined);
      assert.ok(items[0].next_retry_at && items[0].next_retry_at > Date.now());
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("continues syncing subsequent valid transactions when an older API rejects a credit", async () => {
    await clearOutbox();
    const creditItem: OutboxItem = {
      id: "tx-credit-item",
      date: "2026-10-01",
      card: "Amex Gold",
      parent_bucket: "Guilt-Free",
      subcategory: "Dining",
      merchant: "Venmo Reimbursement",
      gross_amount: -60.0,
      reimbursement: 0,
      created_at: new Date(Date.now() - 2000).toISOString(),
    };
    const validExpense: OutboxItem = {
      id: "tx-expense-item",
      date: "2026-10-01",
      card: "Amex Gold",
      parent_bucket: "Guilt-Free",
      subcategory: "Dining",
      merchant: "Tacos",
      gross_amount: 25.0,
      reimbursement: 0,
      created_at: new Date(Date.now() - 1000).toISOString(),
    };

    await saveOutboxItem(creditItem);
    await saveOutboxItem(validExpense);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { gross_amount: number };
      if (body.gross_amount < 0) {
        return new Response(
          JSON.stringify({ error: "Validation failed: gross_amount must be positive" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
      return new Response(JSON.stringify({ id: "tx-expense-item", message: "Created" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    try {
      const result = await syncOutbox({ token: "test-token" });
      assert.strictEqual(result.failedCount, 1);
      assert.strictEqual(result.syncedCount, 1);
      assert.strictEqual(result.lastError, undefined);

      const items = await getOutbox();
      assert.strictEqual(items.length, 1);
      assert.strictEqual(items[0].id, "tx-credit-item");
      assert.strictEqual(items[0].rollback_retry_count, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("permanently fails and discards negative-gross items when HTTP 400 is not due to unsupported negative amount", async () => {
    await clearOutbox();
    const invalidCreditItem: OutboxItem = {
      id: "tx-credit-invalid-reimbursement",
      date: "2026-10-01",
      card: "Amex Gold",
      parent_bucket: "Guilt-Free",
      subcategory: "Dining",
      merchant: "Invalid Refund",
      gross_amount: -60.0,
      reimbursement: 20.0,
      created_at: new Date().toISOString(),
    };

    await saveOutboxItem(invalidCreditItem);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          error: "Validation failed: refunds (negative gross_amount) cannot have a reimbursement",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }) as unknown as typeof fetch;

    try {
      const result = await syncOutbox({ token: "test-token" });
      assert.strictEqual(result.failedCount, 1);
      assert.strictEqual(result.syncedCount, 0);
      assert.strictEqual(
        result.lastError,
        "Validation failed: refunds (negative gross_amount) cannot have a reimbursement",
      );

      const items = await getOutbox();
      assert.strictEqual(items.length, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("retains negative-gross item in outbox when rollback retry attempts exceed MAX_ROLLBACK_RETRIES without scheduling further retries", async () => {
    await clearOutbox();
    const exhaustedCreditItem: OutboxItem = {
      id: "tx-credit-exhausted",
      date: "2026-10-01",
      card: "Amex Gold",
      parent_bucket: "Guilt-Free",
      subcategory: "Dining",
      merchant: "Venmo Reimbursement",
      gross_amount: -60.0,
      reimbursement: 0,
      rollback_retry_count: 10,
      created_at: new Date().toISOString(),
    };

    await saveOutboxItem(exhaustedCreditItem);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({ error: "Validation failed: gross_amount must be positive" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }) as unknown as typeof fetch;

    try {
      const result = await syncOutbox({ token: "test-token", force: true });
      assert.strictEqual(result.failedCount, 1);
      assert.strictEqual(result.syncedCount, 0);
      assert.strictEqual(result.lastError, "Validation failed: gross_amount must be positive");

      const items = await getOutbox();
      assert.strictEqual(items.length, 1);
      assert.strictEqual(items[0].id, "tx-credit-exhausted");
      assert.strictEqual(items[0].rollback_retry_count, 11);
      assert.strictEqual(items[0].next_retry_at, undefined);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("preserves credit item in outbox when credit has existing network retry_count >= 10 and encounters rollback rejection", async () => {
    await clearOutbox();
    const creditWithNetworkRetries: OutboxItem = {
      id: "tx-credit-network-retried",
      date: "2026-10-01",
      card: "Amex Gold",
      parent_bucket: "Guilt-Free",
      subcategory: "Dining",
      merchant: "Venmo Reimbursement",
      gross_amount: -60.0,
      reimbursement: 0,
      retry_count: 10,
      created_at: new Date().toISOString(),
    };

    await saveOutboxItem(creditWithNetworkRetries);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({ error: "Validation failed: gross_amount must be positive" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }) as unknown as typeof fetch;

    try {
      const result = await syncOutbox({ token: "test-token", force: true });
      assert.strictEqual(result.failedCount, 1);
      assert.strictEqual(result.syncedCount, 0);

      const items = await getOutbox();
      assert.strictEqual(items.length, 1);
      assert.strictEqual(items[0].id, "tx-credit-network-retried");
      assert.strictEqual(items[0].retry_count, 10);
      assert.strictEqual(items[0].rollback_retry_count, 1);
      assert.strictEqual(typeof items[0].next_retry_at, "number");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("preserves earliest pending retry deadline when a retained credit receives a longer backoff", async () => {
    await clearOutbox();
    const retainedCredit: OutboxItem = {
      id: "tx-credit-long-backoff",
      date: "2026-10-01",
      card: "Amex Gold",
      parent_bucket: "Guilt-Free",
      subcategory: "Dining",
      merchant: "Venmo Reimbursement",
      gross_amount: -60.0,
      reimbursement: 0,
      rollback_retry_count: 5, // Next backoff: 32s (32000ms)
      created_at: new Date().toISOString(),
    };
    const pendingItem: OutboxItem = {
      id: "tx-pending-earlier",
      date: "2026-10-01",
      card: "Amex Gold",
      parent_bucket: "Guilt-Free",
      subcategory: "Dining",
      merchant: "Pending Chipotle",
      gross_amount: 15.0,
      reimbursement: 0,
      created_at: new Date().toISOString(),
      next_retry_at: Date.now() + 2000, // 2s away
    };

    await saveOutboxItem(retainedCredit);
    await saveOutboxItem(pendingItem);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({ error: "Validation failed: gross_amount must be positive" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }) as unknown as typeof fetch;

    let scheduledDelayMs = -1;
    try {
      await syncOutbox({
        token: "test-token",
        onScheduleRetry: (delayMs) => {
          scheduledDelayMs = delayMs;
        },
      });

      // Assert that the earliest scheduled deadline (approx 2000ms) is preserved rather than 32000ms
      assert.ok(scheduledDelayMs > 0 && scheduledDelayMs <= 2500);
      assert.ok(scheduledDelayMs < 10000);
    } finally {
      globalThis.fetch = originalFetch;
      clearRetryTimer();
    }
  });

  it("preserves exponential backoff and halts queue processing without immediately retrying untouched items when offline", async () => {
    await clearOutbox();
    const item1: OutboxItem = {
      id: "tx-offline-1",
      date: "2026-10-01",
      card: "Amex Gold",
      parent_bucket: "Guilt-Free",
      subcategory: "Dining",
      merchant: "First Item",
      gross_amount: 10.0,
      reimbursement: 0,
      created_at: new Date().toISOString(),
    };
    const item2: OutboxItem = {
      id: "tx-offline-2",
      date: "2026-10-01",
      card: "Amex Gold",
      parent_bucket: "Guilt-Free",
      subcategory: "Dining",
      merchant: "Untouched Second Item",
      gross_amount: 20.0,
      reimbursement: 0,
      created_at: new Date().toISOString(),
    };

    await saveOutboxItem(item1);
    await saveOutboxItem(item2);

    let fetchCalls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      fetchCalls++;
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;

    let scheduledDelayMs = -1;
    try {
      const result = await syncOutbox({
        token: "test-token",
        onScheduleRetry: (delayMs) => {
          scheduledDelayMs = delayMs;
        },
      });

      assert.strictEqual(result.failedCount, 1);
      assert.strictEqual(fetchCalls, 1);
      // Scheduled delay must be the 1000ms backoff, NOT 0ms from the untouched second item!
      assert.strictEqual(scheduledDelayMs, 1000);

      const items = await getOutbox();
      assert.strictEqual(items.length, 2);
      assert.strictEqual(items[0].id, "tx-offline-1");
      assert.strictEqual(items[0].retry_count, 1);
      assert.ok(items[0].next_retry_at && items[0].next_retry_at > Date.now());
      assert.strictEqual(items[1].id, "tx-offline-2");
      assert.strictEqual(items[1].retry_count, undefined);
      assert.strictEqual(items[1].next_retry_at, undefined);
    } finally {
      globalThis.fetch = originalFetch;
      clearRetryTimer();
    }
  });

  it("treats expired activeRetryDeadline as inactive when host timer fires", async () => {
    await clearOutbox();
    const item: OutboxItem = {
      id: "tx-expired-deadline",
      date: "2026-10-01",
      card: "Amex Gold",
      parent_bucket: "Guilt-Free",
      subcategory: "Dining",
      merchant: "Chipotle",
      gross_amount: 15.0,
      reimbursement: 0,
      created_at: new Date().toISOString(),
    };

    await saveOutboxItem(item);

    const originalFetch = globalThis.fetch;
    const originalDateNow = Date.now;
    globalThis.fetch = (async () => {
      return new Response("Internal Server Error", { status: 500 });
    }) as unknown as typeof fetch;

    const scheduledDelays: number[] = [];
    try {
      let currentTime = originalDateNow();
      Date.now = () => currentTime;

      // First sync fails and schedules retry with 1000ms backoff
      await syncOutbox({
        token: "test-token",
        onScheduleRetry: (delayMs) => {
          scheduledDelays.push(delayMs);
        },
      });
      assert.strictEqual(scheduledDelays.length, 1);
      assert.strictEqual(scheduledDelays[0], 1000);

      // Simulate host callback firing after the 1000ms delay has elapsed
      currentTime += 1500;

      await syncOutbox({
        token: "test-token",
        onScheduleRetry: (delayMs) => {
          scheduledDelays.push(delayMs);
        },
      });

      assert.strictEqual(scheduledDelays.length, 2);
      // Next exponential backoff step (2000ms)
      assert.strictEqual(scheduledDelays[1], 2000);
    } finally {
      Date.now = originalDateNow;
      globalThis.fetch = originalFetch;
      clearRetryTimer();
    }
  });

  it("preserves exponential backoff and excludes expired tail deadlines when transport halts", async () => {
    await clearOutbox();
    const item1: OutboxItem = {
      id: "tx-halt-1",
      date: "2026-10-01",
      card: "Amex Gold",
      parent_bucket: "Guilt-Free",
      subcategory: "Dining",
      merchant: "Failing Server",
      gross_amount: 10.0,
      reimbursement: 0,
      created_at: new Date().toISOString(),
    };
    const item2WithExpiredDeadline: OutboxItem = {
      id: "tx-halt-2-expired",
      date: "2026-10-01",
      card: "Amex Gold",
      parent_bucket: "Guilt-Free",
      subcategory: "Dining",
      merchant: "Untouched Tail Chipotle",
      gross_amount: 20.0,
      reimbursement: 0,
      retry_count: 2,
      next_retry_at: Date.now() - 5000,
      created_at: new Date().toISOString(),
    };

    await saveOutboxItem(item1);
    await saveOutboxItem(item2WithExpiredDeadline);

    let fetchCalls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      fetchCalls++;
      return new Response("Internal Server Error", { status: 500 });
    }) as unknown as typeof fetch;

    let scheduledDelayMs = -1;
    try {
      const result = await syncOutbox({
        token: "test-token",
        onScheduleRetry: (delayMs) => {
          scheduledDelayMs = delayMs;
        },
      });

      assert.strictEqual(result.failedCount, 1);
      assert.strictEqual(fetchCalls, 1);
      // Scheduled delay must preserve the 1000ms backoff and NOT collapse to 0ms from the expired item!
      assert.strictEqual(scheduledDelayMs, 1000);

      const items = await getOutbox();
      assert.strictEqual(items.length, 2);
      assert.strictEqual(items[0].id, "tx-halt-1");
      assert.strictEqual(items[0].retry_count, 1);
      assert.ok(items[0].next_retry_at && items[0].next_retry_at > Date.now());
      assert.strictEqual(items[1].id, "tx-halt-2-expired");
      assert.strictEqual(items[1].retry_count, 2);
      assert.strictEqual(items[1].next_retry_at, item2WithExpiredDeadline.next_retry_at);
    } finally {
      globalThis.fetch = originalFetch;
      clearRetryTimer();
    }
  });

  it("schedules immediate retry when an unscheduled item remains in queue alongside backed-off items", async () => {
    await clearOutbox();
    const inFlightItem: OutboxItem = {
      id: "tx-in-flight",
      date: "2026-10-01",
      card: "Amex Gold",
      parent_bucket: "Guilt-Free",
      subcategory: "Dining",
      merchant: "In Flight Item",
      gross_amount: 10.0,
      reimbursement: 0,
      created_at: new Date().toISOString(),
    };
    const retainedItem: OutboxItem = {
      id: "tx-retained-backoff",
      date: "2026-10-01",
      card: "Amex Gold",
      parent_bucket: "Guilt-Free",
      subcategory: "Dining",
      merchant: "Backed Off Merchant",
      gross_amount: -25.0,
      reimbursement: 0,
      rollback_retry_count: 1,
      next_retry_at: Date.now() + 30000,
      created_at: new Date().toISOString(),
    };
    const unscheduledItem: OutboxItem = {
      id: "tx-unscheduled-pending",
      date: "2026-10-01",
      card: "Amex Gold",
      parent_bucket: "Guilt-Free",
      subcategory: "Dining",
      merchant: "Fresh Item",
      gross_amount: 15.0,
      reimbursement: 0,
      created_at: new Date().toISOString(),
    };

    await saveOutboxItem(inFlightItem);
    await saveOutboxItem(retainedItem);

    let scheduledDelayMs = -1;
    const originalFetch = globalThis.fetch;
    // When sync runs for inFlightItem, simulate concurrent submission while background sync is in flight
    globalThis.fetch = (async () => {
      await saveOutboxItem(unscheduledItem);
      return new Response(JSON.stringify({ success: true }), { status: 201 });
    }) as unknown as typeof fetch;

    try {
      await syncOutbox({
        token: "test-token",
        onScheduleRetry: (delayMs) => {
          scheduledDelayMs = delayMs;
        },
      });

      // Because tx-unscheduled-pending was added and is due now (no next_retry_at),
      // the finalizer must schedule retry immediately (0ms) instead of waiting for the 30s deadline
      assert.strictEqual(scheduledDelayMs, 0);
    } finally {
      globalThis.fetch = originalFetch;
      clearRetryTimer();
    }
  });
});

describe("Outbox Legacy Taxonomy Normalization", () => {
  beforeEach(async () => {
    await clearOutbox();
  });

  it("normalizes legacy Guilt-Free Coffee subcategory to Coffee & Snacks on save and retrieval", async () => {
    const legacyItem: OutboxItem = {
      id: "tx-legacy-coffee",
      date: "2026-10-01",
      card: "Amex Gold",
      parent_bucket: "Guilt-Free",
      subcategory: "Coffee",
      merchant: "Blue Bottle",
      gross_amount: 6.5,
      reimbursement: 0,
      created_at: new Date().toISOString(),
    };

    await saveOutboxItem(legacyItem);

    const items = await getOutbox();
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].parent_bucket, "Guilt-Free");
    assert.strictEqual(items[0].subcategory, "Coffee & Snacks");
  });

  it("syncs legacy subcategory using normalized Coffee & Snacks payload", async () => {
    const legacyItem: OutboxItem = {
      id: "tx-legacy-sync",
      date: "2026-10-01",
      card: "Amex Gold",
      parent_bucket: "Guilt-Free",
      subcategory: "Coffee",
      merchant: "Tatte Bakery",
      gross_amount: 5.75,
      reimbursement: 0,
      created_at: new Date().toISOString(),
    };

    await saveOutboxItem(legacyItem);

    let postedPayload: Record<string, unknown> | null = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: unknown, options: { body?: string }) => {
      if (options?.body) {
        postedPayload = JSON.parse(options.body) as Record<string, unknown>;
      }
      return new Response(JSON.stringify({ ok: true, id: "tx-legacy-sync" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    try {
      const result = await syncOutbox({ token: "test-token" });
      assert.strictEqual(result.syncedCount, 1);
      assert.ok(postedPayload);
      assert.strictEqual(postedPayload.subcategory, "Coffee & Snacks");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("Dead-Letter Queue (DLQ) Storage and Quarantine", () => {
  beforeEach(async () => {
    await clearOutbox();
    await clearDeadLetterQueue();
  });

  afterEach(async () => {
    await clearOutbox();
    await clearDeadLetterQueue();
  });

  it("quarantines permanently invalid transactions on HTTP 400 validation error", async () => {
    const invalidItem: OutboxItem = {
      id: "tx-invalid-400",
      date: "invalid-date",
      card: "Amex Gold",
      parent_bucket: "Guilt-Free",
      subcategory: "Dining",
      merchant: "Sweetgreen",
      gross_amount: 18.5,
      reimbursement: 0,
      created_at: new Date().toISOString(),
    };

    await saveOutboxItem(invalidItem);
    assert.strictEqual(await getOutboxCount(), 1);
    assert.strictEqual(await getDeadLetterCount(), 0);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ error: "date must be a valid YYYY-MM-DD string" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    try {
      const result = await syncOutbox({ token: "test-token" });

      assert.strictEqual(result.syncedCount, 0);
      assert.strictEqual(result.failedCount, 1);
      assert.strictEqual(result.lastError, "date must be a valid YYYY-MM-DD string");

      // Item must be removed from outbox to prevent blocking
      assert.strictEqual(await getOutboxCount(), 0);

      // Item must be quarantined in dead_letter_queue
      assert.strictEqual(await getDeadLetterCount(), 1);
      const dlq = await getDeadLetterQueue();
      assert.strictEqual(dlq.length, 1);
      assert.strictEqual(dlq[0].id, "tx-invalid-400");
      assert.strictEqual(dlq[0].http_status, 400);
      assert.strictEqual(dlq[0].error_reason, "date must be a valid YYYY-MM-DD string");
      assert.strictEqual(dlq[0].payload.merchant, "Sweetgreen");
      assert.ok(dlq[0].failed_at);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("quarantines items that exceed the maximum retry threshold and allows subsequent valid items to sync", async () => {
    const poisonPill: OutboxItem = {
      id: "tx-poison-500",
      date: "2026-10-02",
      card: "Chase Sapphire",
      parent_bucket: "Fixed Costs",
      subcategory: "Groceries",
      merchant: "Trader Joe's",
      gross_amount: 50.0,
      reimbursement: 0,
      created_at: "2026-10-02T10:00:00.000Z",
      server_retry_count: 10, // Pre-exhausted at threshold
    };

    const healthyItem: OutboxItem = {
      id: "tx-healthy-tail",
      date: "2026-10-02",
      card: "Amex Gold",
      parent_bucket: "Guilt-Free",
      subcategory: "Dining",
      merchant: "Chipotle",
      gross_amount: 12.5,
      reimbursement: 0,
      created_at: "2026-10-02T10:05:00.000Z",
    };

    await saveOutboxItem(poisonPill);
    await saveOutboxItem(healthyItem);
    assert.strictEqual(await getOutboxCount(), 2);

    const originalFetch = globalThis.fetch;
    const syncedIds: string[] = [];

    globalThis.fetch = (async (_url: unknown, options: { body?: string }) => {
      if (options?.body) {
        const payload = JSON.parse(options.body) as { id: string };
        syncedIds.push(payload.id);
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    try {
      const result = await syncOutbox({ token: "test-token" });

      // Poison pill should have been quarantined, healthy tail item synced
      assert.strictEqual(result.syncedCount, 1);
      assert.strictEqual(result.failedCount, 1);
      assert.deepStrictEqual(syncedIds, ["tx-healthy-tail"]);

      // Outbox should now be empty
      assert.strictEqual(await getOutboxCount(), 0);

      // Dead-letter queue should hold the poisoned item
      const dlq = await getDeadLetterQueue();
      assert.strictEqual(dlq.length, 1);
      assert.strictEqual(dlq[0].id, "tx-poison-500");
      assert.strictEqual(dlq[0].error_reason, "Exceeded maximum retry threshold");
      assert.strictEqual(dlq[0].retry_count, 10);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("quarantines items reaching max retry threshold during 5xx errors", async () => {
    const item: OutboxItem = {
      id: "tx-500-exhausted",
      date: "2026-10-02",
      card: "Chase Sapphire",
      parent_bucket: "Fixed Costs",
      subcategory: "Groceries",
      merchant: "Whole Foods",
      gross_amount: 60.0,
      reimbursement: 0,
      created_at: new Date().toISOString(),
      server_retry_count: MAX_SYNC_RETRIES - 1, // Will reach 10 on this attempt
    };

    await saveOutboxItem(item);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ error: "Internal Database Error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    try {
      const result = await syncOutbox({ token: "test-token" });

      assert.strictEqual(result.syncedCount, 0);
      assert.strictEqual(result.failedCount, 1);
      assert.strictEqual(result.lastError, "Exceeded maximum retry threshold");

      // Quarantined to DLQ
      assert.strictEqual(await getOutboxCount(), 0);
      assert.strictEqual(await getDeadLetterCount(), 1);

      const dlq = await getDeadLetterQueue();
      assert.strictEqual(dlq[0].id, "tx-500-exhausted");
      assert.strictEqual(dlq[0].http_status, 500);
      assert.strictEqual(dlq[0].error_reason, "Exceeded maximum retry threshold");
      assert.strictEqual(dlq[0].retry_count, MAX_SYNC_RETRIES);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("does not quarantine item on network error even when at MAX_SYNC_RETRIES - 1", async () => {
    await clearOutbox();
    await clearDeadLetterQueue();

    const item: OutboxItem = {
      id: "tx-network-near-max",
      date: "2026-10-02",
      card: "Chase Sapphire",
      parent_bucket: "Fixed Costs",
      subcategory: "Groceries",
      merchant: "Trader Joe's",
      gross_amount: 45.0,
      reimbursement: 0,
      created_at: new Date().toISOString(),
      server_retry_count: MAX_SYNC_RETRIES - 1,
    };

    await saveOutboxItem(item);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new TypeError("Failed to fetch: NetworkError");
    }) as unknown as typeof fetch;

    try {
      const result = await syncOutbox({ token: "test-token" });
      assert.strictEqual(result.syncedCount, 0);
      assert.strictEqual(result.failedCount, 1);

      // Must remain in outbox, not quarantined to DLQ
      const outbox = await getOutbox();
      assert.strictEqual(outbox.length, 1);
      assert.strictEqual(outbox[0].id, "tx-network-near-max");
      assert.strictEqual(outbox[0].server_retry_count, MAX_SYNC_RETRIES - 1);
      assert.strictEqual(await getDeadLetterCount(), 0);
    } finally {
      globalThis.fetch = originalFetch;
      clearRetryTimer();
    }
  });

  it("retains outbox item if saving to dead_letter_queue fails", async () => {
    await clearOutbox();
    await clearDeadLetterQueue();

    const item: OutboxItem = {
      id: "tx-dlq-fail-save",
      date: "2026-10-02",
      card: "Visa",
      parent_bucket: "Fixed Costs",
      subcategory: "Rent",
      merchant: "Landlord",
      gross_amount: 1200,
      reimbursement: 0,
      created_at: new Date().toISOString(),
    };

    await saveOutboxItem(item);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ error: "Validation failed: invalid amount" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const mockDb = {
      objectStoreNames: {
        contains: (_name: string) => true,
      },
      transaction: () => ({
        objectStore: () => ({
          put: () => {
            const req: { onerror?: () => void; error?: Error } = {
              error: new Error("QuotaExceededError"),
            };
            setTimeout(() => req.onerror?.(), 0);
            return req;
          },
        }),
        onabort: () => {},
        onerror: (cb: () => void) => cb(),
        oncomplete: () => {},
      }),
      close: () => {},
    };

    const originalIDB = globalThis.indexedDB;
    Object.defineProperty(globalThis, "indexedDB", {
      value: {
        open: () => {
          const req: { result: typeof mockDb; onsuccess?: () => void } = { result: mockDb };
          setTimeout(() => req.onsuccess?.(), 0);
          return req;
        },
      },
      writable: true,
      configurable: true,
    });

    try {
      const result = await syncOutbox({ token: "test-token" });
      assert.strictEqual(result.failedCount, 1);

      // Because DLQ save failed, the outbox record must NOT be deleted
      const remaining = await getOutbox();
      assert.strictEqual(remaining.length, 1);
      assert.strictEqual(remaining[0].id, "tx-dlq-fail-save");
    } finally {
      Object.defineProperty(globalThis, "indexedDB", {
        value: originalIDB,
        writable: true,
        configurable: true,
      });
      globalThis.fetch = originalFetch;
      clearRetryTimer();
    }
  });

  it("requeues a dead-letter item back into the outbox with reset retry state", async () => {
    const dlqItem: DeadLetterItem = {
      id: "tx-requeue-test",
      payload: {
        id: "tx-requeue-test",
        date: "2026-10-02",
        card: "Amex Gold",
        parent_bucket: "Guilt-Free",
        subcategory: "Dining",
        merchant: "Shake Shack",
        gross_amount: 22.0,
        reimbursement: 0,
        created_at: new Date().toISOString(),
        retry_count: 10,
        next_retry_at: Date.now() + 60000,
      },
      error_reason: "Exceeded maximum retry threshold",
      http_status: 500,
      failed_at: new Date().toISOString(),
      retry_count: 10,
    };

    await saveDeadLetterItem(dlqItem);
    assert.strictEqual(await getDeadLetterCount(), 1);
    assert.strictEqual(await getOutboxCount(), 0);

    await requeueDeadLetterItem("tx-requeue-test");

    // DLQ should be empty
    assert.strictEqual(await getDeadLetterCount(), 0);

    // Outbox should contain the restored item with reset retry counters
    assert.strictEqual(await getOutboxCount(), 1);
    const outboxItems = await getOutbox();
    assert.strictEqual(outboxItems[0].id, "tx-requeue-test");
    assert.strictEqual(outboxItems[0].retry_count, 0);
    assert.strictEqual(outboxItems[0].rollback_retry_count, 0);
    assert.strictEqual(outboxItems[0].next_retry_at, undefined);
  });

  it("handles requeue gracefully when item id is not found in DLQ", async () => {
    await requeueDeadLetterItem("non-existent-id");
    assert.strictEqual(await getDeadLetterCount(), 0);
    assert.strictEqual(await getOutboxCount(), 0);
  });

  it("deletes a dead-letter item permanently", async () => {
    const item1: DeadLetterItem = {
      id: "dlq-del-1",
      payload: {
        id: "dlq-del-1",
        date: "2026-10-02",
        card: "Amex Gold",
        parent_bucket: "Guilt-Free",
        subcategory: "Dining",
        merchant: "Cafe",
        gross_amount: 5.0,
        reimbursement: 0,
        created_at: new Date().toISOString(),
      },
      error_reason: "Validation failed",
      failed_at: "2026-10-02T12:00:00.000Z",
      retry_count: 0,
    };

    const item2: DeadLetterItem = {
      id: "dlq-del-2",
      payload: {
        id: "dlq-del-2",
        date: "2026-10-02",
        card: "Amex Gold",
        parent_bucket: "Guilt-Free",
        subcategory: "Dining",
        merchant: "Bakery",
        gross_amount: 7.0,
        reimbursement: 0,
        created_at: new Date().toISOString(),
      },
      error_reason: "Validation failed",
      failed_at: "2026-10-02T12:05:00.000Z",
      retry_count: 0,
    };

    await saveDeadLetterItem(item1);
    await saveDeadLetterItem(item2);
    assert.strictEqual(await getDeadLetterCount(), 2);

    await deleteDeadLetterItem("dlq-del-1");
    assert.strictEqual(await getDeadLetterCount(), 1);

    const remaining = await getDeadLetterQueue();
    assert.strictEqual(remaining[0].id, "dlq-del-2");

    await clearDeadLetterQueue();
    assert.strictEqual(await getDeadLetterCount(), 0);
  });

  it("sorts dead-letter items chronologically by failed_at", async () => {
    const itemEarly: DeadLetterItem = {
      id: "dlq-early",
      payload: {
        id: "dlq-early",
        date: "2026-10-02",
        card: "Amex Gold",
        parent_bucket: "Guilt-Free",
        subcategory: "Dining",
        merchant: "Early Cafe",
        gross_amount: 5.0,
        reimbursement: 0,
        created_at: new Date().toISOString(),
      },
      error_reason: "Validation failed",
      failed_at: "2026-10-02T08:00:00.000Z",
      retry_count: 0,
    };

    const itemLate: DeadLetterItem = {
      id: "dlq-late",
      payload: {
        id: "dlq-late",
        date: "2026-10-02",
        card: "Amex Gold",
        parent_bucket: "Guilt-Free",
        subcategory: "Dining",
        merchant: "Late Diner",
        gross_amount: 25.0,
        reimbursement: 0,
        created_at: new Date().toISOString(),
      },
      error_reason: "Validation failed",
      failed_at: "2026-10-02T20:00:00.000Z",
      retry_count: 0,
    };

    // Save in reverse order
    await saveDeadLetterItem(itemLate);
    await saveDeadLetterItem(itemEarly);

    const queue = await getDeadLetterQueue();
    assert.strictEqual(queue.length, 2);
    assert.strictEqual(queue[0].id, "dlq-early");
    assert.strictEqual(queue[1].id, "dlq-late");
  });

  it("handles native IndexedDB schema upgrade to version 2 and DLQ operations", async () => {
    const outboxStore = new Map<string, OutboxItem>();
    const dlqStore = new Map<string, DeadLetterItem>();
    let schemaVersion = 0;
    const createdStores: string[] = [];

    const mockDb = {
      objectStoreNames: {
        contains: (name: string) => createdStores.includes(name),
      },
      createObjectStore: (name: string, _opts: unknown) => {
        createdStores.push(name);
      },
      transaction: (storeName: string, _mode: string) => {
        const storeMap = (storeName === DLQ_STORE_NAME ? dlqStore : outboxStore) as Map<
          string,
          OutboxItem | DeadLetterItem
        >;
        return {
          objectStore: (_name: string) => ({
            put: (item: OutboxItem | DeadLetterItem) => {
              storeMap.set(item.id, item);
              const req: { onsuccess?: () => void; onerror?: () => void } = {};
              setTimeout(() => req.onsuccess?.(), 0);
              return req;
            },
            getAll: () => {
              const req: {
                result?: (OutboxItem | DeadLetterItem)[];
                onsuccess?: () => void;
                onerror?: () => void;
              } = {
                result: Array.from(storeMap.values()),
              };
              setTimeout(() => req.onsuccess?.(), 0);
              return req;
            },
            delete: (id: string) => {
              storeMap.delete(id);
              const req: { onsuccess?: () => void; onerror?: () => void } = {};
              setTimeout(() => req.onsuccess?.(), 0);
              return req;
            },
            clear: () => {
              storeMap.clear();
              const req: { onsuccess?: () => void; onerror?: () => void } = {};
              setTimeout(() => req.onsuccess?.(), 0);
              return req;
            },
          }),
          oncomplete: () => {},
        };
      },
      close: () => {},
    };

    const mockIndexedDB = {
      open: (_name: string, version: number) => {
        schemaVersion = version;
        const req: {
          result: typeof mockDb;
          onsuccess?: () => void;
          onupgradeneeded?: () => void;
          onerror?: () => void;
        } = {
          result: mockDb,
        };
        setTimeout(() => {
          req.onupgradeneeded?.();
          req.onsuccess?.();
        }, 0);
        return req;
      },
    };

    const originalIDB = globalThis.indexedDB;
    Object.defineProperty(globalThis, "indexedDB", {
      value: mockIndexedDB,
      writable: true,
      configurable: true,
    });

    try {
      assert.strictEqual(DB_VERSION, 2);

      const dlqItem: DeadLetterItem = {
        id: "idb-dlq-1",
        payload: {
          id: "idb-dlq-1",
          date: "2026-10-02",
          card: "Visa",
          parent_bucket: "Fixed Costs",
          subcategory: "Rent",
          merchant: "Landlord",
          gross_amount: 1500,
          reimbursement: 0,
          created_at: new Date().toISOString(),
        },
        error_reason: "Invalid tenant account",
        http_status: 400,
        failed_at: new Date().toISOString(),
        retry_count: 0,
      };

      await saveDeadLetterItem(dlqItem);
      assert.strictEqual(schemaVersion, 2);
      assert.ok(createdStores.includes(DLQ_STORE_NAME));

      const queue = await getDeadLetterQueue();
      assert.strictEqual(queue.length, 1);
      assert.strictEqual(queue[0].id, "idb-dlq-1");
      assert.strictEqual(await getDeadLetterCount(), 1);

      await deleteDeadLetterItem("idb-dlq-1");
      assert.strictEqual(await getDeadLetterCount(), 0);

      await saveDeadLetterItem(dlqItem);
      await clearDeadLetterQueue();
      assert.strictEqual(await getDeadLetterCount(), 0);
    } finally {
      Object.defineProperty(globalThis, "indexedDB", {
        value: originalIDB,
        writable: true,
        configurable: true,
      });
    }
  });

  it("supports localStorage fallback for dead_letter_queue when indexedDB fails", async () => {
    const mockStorage = new MockLocalStorage();
    const originalLocalStorage = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      value: mockStorage,
      writable: true,
      configurable: true,
    });

    try {
      const dlqItem: DeadLetterItem = {
        id: "ls-dlq-1",
        payload: {
          id: "ls-dlq-1",
          date: "2026-10-02",
          card: "Mastercard",
          parent_bucket: "Guilt-Free",
          subcategory: "Shopping",
          merchant: "Target",
          gross_amount: 35.5,
          reimbursement: 0,
          created_at: new Date().toISOString(),
        },
        error_reason: "Malformed body",
        http_status: 400,
        failed_at: new Date().toISOString(),
        retry_count: 0,
      };

      await saveDeadLetterItem(dlqItem);
      const rawFallback = mockStorage.getItem(DLQ_FALLBACK_STORAGE_KEY);
      assert.ok(rawFallback);
      assert.ok(rawFallback.includes("ls-dlq-1"));

      const items = await getDeadLetterQueue();
      assert.strictEqual(items.length, 1);
      assert.strictEqual(items[0].id, "ls-dlq-1");

      await deleteDeadLetterItem("ls-dlq-1");
      assert.strictEqual(await getDeadLetterCount(), 0);

      await saveDeadLetterItem(dlqItem);
      await clearDeadLetterQueue();
      assert.strictEqual(await getDeadLetterCount(), 0);
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        value: originalLocalStorage,
        writable: true,
        configurable: true,
      });
    }
  });
});

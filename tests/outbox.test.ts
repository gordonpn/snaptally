import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  DEFAULT_FREQUENT_MERCHANTS,
  intakeForm,
  MERCHANTS_STORAGE_KEY,
} from "../src/scripts/intake-form.ts";
import {
  clearOutbox,
  deleteOutboxItem,
  getOutbox,
  getOutboxCount,
  type OutboxItem,
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
    let createdStoreName = "";
    const mockDb = {
      objectStoreNames: {
        contains: (_name: string) => false,
      },
      createObjectStore: (name: string, _opts: unknown) => {
        createdStoreName = name;
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
      assert.strictEqual(createdStoreName, "outbox");
    } finally {
      Object.defineProperty(globalThis, "indexedDB", {
        value: originalIDB,
        writable: true,
        configurable: true,
      });
    }
  });
});

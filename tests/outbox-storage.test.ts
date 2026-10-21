import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  type DeadLetterItem,
  DLQ_FALLBACK_STORAGE_KEY,
  DLQ_STORE_NAME,
  deleteDeadLetterItem,
  FALLBACK_STORAGE_KEY,
  getDeadLetterQueue,
  getOutbox,
  type OutboxItem,
  requeueDeadLetterItem,
  STORE_NAME,
} from "../src/scripts/outbox.ts";

type StoredItem = DeadLetterItem | OutboxItem;
interface StorageRequest<T> {
  result: T;
  onsuccess?: () => void;
  onerror?: () => void;
  error: Error;
}
interface StorageStore {
  getAll(): StorageRequest<StoredItem[]>;
  get(id: string): StorageRequest<StoredItem | undefined>;
  put(item: StoredItem): StorageRequest<string>;
  delete(id: string): StorageRequest<undefined>;
}
interface StorageTransaction {
  error: Error;
  onabort?: () => void;
  onerror?: () => void;
  oncomplete?: () => void;
  objectStore(name: string): StorageStore;
}
interface DatabaseFixture {
  stores: Map<string, Map<string, StoredItem>>;
  transactions: string[][];
  failed: DeadLetterItem;
}
function createFailure(): DeadLetterItem {
  return {
    id: "failed",
    payload: {
      id: "failed",
      date: "2026-10-20",
      card: "Visa",
      merchant: "Cafe",
      parent_bucket: "Guilt-Free",
      subcategory: "Dining",
      gross_amount: 12,
      reimbursement: 0,
      created_at: "2026-10-20T12:00:00Z",
      retry_count: 7,
      server_retry_count: 4,
      rollback_retry_count: 2,
      next_retry_at: 9999999999999,
    },
    error_reason: "Invalid payload",
    failed_at: "2026-10-20T12:00:00Z",
    retry_count: 9,
  };
}

function installDatabase(abortOperation?: "put" | "delete"): DatabaseFixture {
  const failed = createFailure();
  const stores = new Map<string, Map<string, StoredItem>>([
    [STORE_NAME, new Map()],
    [DLQ_STORE_NAME, new Map([[failed.id, failed]])],
  ]);
  const transactions: string[][] = [];
  const database = {
    close(): void {},
    transaction(names: string | string[]): StorageTransaction {
      const selected = typeof names === "string" ? [names] : names;
      transactions.push(selected);
      const staged = new Map(selected.map((name) => [name, new Map(stores.get(name))]));
      let pending = 0;
      let finished = false;
      const transaction = {
        error: new Error("Storage transaction aborted"),
        onabort: undefined as (() => void) | undefined,
        onerror: undefined as (() => void) | undefined,
        oncomplete: undefined as (() => void) | undefined,
        objectStore(name: string): StorageStore {
          const store = staged.get(name);
          if (!store) throw new Error(`Store outside transaction: ${name}`);
          function request<T>(
            result: T,
            operation?: "put" | "delete",
            apply?: () => void,
          ): StorageRequest<T> {
            const request = {
              result,
              onsuccess: undefined as (() => void) | undefined,
              onerror: undefined as (() => void) | undefined,
              error: transaction.error,
            };
            pending++;
            queueMicrotask(() => {
              if (finished) return;
              if (operation && operation === abortOperation) {
                finished = true;
                request.onerror?.();
                transaction.onabort?.();
                return;
              }
              apply?.();
              request.onsuccess?.();
              pending--;
              if (pending === 0)
                queueMicrotask(() => {
                  if (finished || pending !== 0) return;
                  finished = true;
                  for (const [name, records] of staged) stores.set(name, records);
                  transaction.oncomplete?.();
                });
            });
            return request;
          }
          return {
            getAll: () => request([...store.values()]),
            get: (id: string) => request(store.get(id)),
            put: (item: StoredItem) => request(item.id, "put", () => store.set(item.id, item)),
            delete: (id: string) => request(undefined, "delete", () => store.delete(id)),
          };
        },
      };
      return transaction;
    },
  };
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: {
      open: () => {
        const request = { result: database, onsuccess: undefined as (() => void) | undefined };
        queueMicrotask(() => request.onsuccess?.());
        return request;
      },
    },
  });
  return { stores, transactions, failed };
}
const indexedDBDescriptor = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
const localStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
function installUnavailableDatabase(): void {
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: {
      open: () => {
        const request = {
          error: new Error("Database unavailable"),
          onerror: undefined as (() => void) | undefined,
        };
        queueMicrotask(() => request.onerror?.());
        return request;
      },
    },
  });
}

function installFallback(failed: DeadLetterItem): Map<string, string> {
  const persisted = new Map([
    [FALLBACK_STORAGE_KEY, JSON.stringify([])],
    [DLQ_FALLBACK_STORAGE_KEY, JSON.stringify([failed])],
  ]);
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string): string | null => persisted.get(key) ?? null,
      setItem: (key: string, value: string): void => {
        persisted.set(key, value);
      },
    },
  });
  return persisted;
}

afterEach(() => {
  if (indexedDBDescriptor) Object.defineProperty(globalThis, "indexedDB", indexedDBDescriptor);
  else Reflect.deleteProperty(globalThis, "indexedDB");
  if (localStorageDescriptor)
    Object.defineProperty(globalThis, "localStorage", localStorageDescriptor);
  else Reflect.deleteProperty(globalThis, "localStorage");
});

describe("queue storage transactions", () => {
  it("commits requeue as one transaction across both stores", async () => {
    const { stores, transactions, failed } = installDatabase();

    await requeueDeadLetterItem(failed.id);

    assert.ok(
      transactions.some((names) => names.includes(STORE_NAME) && names.includes(DLQ_STORE_NAME)),
    );
    assert.deepEqual([...(stores.get(DLQ_STORE_NAME)?.keys() ?? [])], []);
    assert.deepEqual(
      [...(stores.get(STORE_NAME)?.values() ?? [])],
      [
        {
          ...failed.payload,
          retry_count: 0,
          server_retry_count: 0,
          rollback_retry_count: 0,
          next_retry_at: undefined,
        },
      ],
    );
  });
  for (const operation of ["put", "delete"] as const) {
    it(`retains the failed record and reports an aborted ${operation} during requeue`, async () => {
      const { stores, failed } = installDatabase(operation);

      await assert.rejects(requeueDeadLetterItem(failed.id), /aborted/);

      assert.deepEqual([...(stores.get(DLQ_STORE_NAME)?.values() ?? [])], [failed]);
      assert.deepEqual([...(stores.get(STORE_NAME)?.values() ?? [])], []);
    });
  }
  it("reports discard aborts rather than silently deleting a fallback copy", async () => {
    const { stores, failed } = installDatabase("delete");

    await assert.rejects(deleteDeadLetterItem(failed.id), /aborted/);

    assert.deepEqual([...(stores.get(DLQ_STORE_NAME)?.values() ?? [])], [failed]);
  });
  it("resolves discard only after its transaction commits", async () => {
    const { stores, failed } = installDatabase();

    await deleteDeadLetterItem(failed.id);

    assert.deepEqual([...(stores.get(DLQ_STORE_NAME)?.values() ?? [])], []);
  });
});

it("reports an IndexedDB open failure during discard without claiming removal", async () => {
  const { stores, failed } = installDatabase();
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: {
      open: () => {
        const request = {
          error: new Error("Database unavailable"),
          onerror: undefined as (() => void) | undefined,
        };
        queueMicrotask(() => request.onerror?.());
        return request;
      },
    },
  });

  await assert.rejects(deleteDeadLetterItem(failed.id), /Database unavailable/);

  assert.deepEqual([...(stores.get(DLQ_STORE_NAME)?.values() ?? [])], [failed]);
});

for (const failingKey of [FALLBACK_STORAGE_KEY, DLQ_FALLBACK_STORAGE_KEY]) {
  it(`retains durable fallback records when writing ${failingKey} fails`, async () => {
    const failed = createFailure();
    const original = new Map([
      [FALLBACK_STORAGE_KEY, JSON.stringify([{ ...failed.payload, id: "waiting" }])],
      [DLQ_FALLBACK_STORAGE_KEY, JSON.stringify([failed])],
    ]);
    const persisted = new Map(original);
    Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: undefined });
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => persisted.get(key) ?? null,
        setItem: (key: string, value: string) => {
          if (key === failingKey) throw new Error("Storage unavailable");
          persisted.set(key, value);
        },
      },
    });

    await assert.rejects(requeueDeadLetterItem(failed.id), /Storage unavailable/);

    assert.deepEqual(persisted, original);
  });
}

for (const action of [deleteDeadLetterItem, requeueDeadLetterItem]) {
  it(`${action.name} recovers a fallback-owned record when IndexedDB cannot open`, async () => {
    const failed = createFailure();
    const other = { ...failed, id: "other", payload: { ...failed.payload, id: "other" } };
    const persisted = installFallback(failed);
    persisted.set(DLQ_FALLBACK_STORAGE_KEY, JSON.stringify([failed, other]));
    installUnavailableDatabase();

    await action(failed.id);

    assert.deepEqual(await getDeadLetterQueue(), [other]);
    assert.deepEqual(
      (await getOutbox()).map((item) => ({ ...item, next_retry_at: item.next_retry_at })),
      action === requeueDeadLetterItem
        ? [
            {
              ...failed.payload,
              retry_count: 0,
              server_retry_count: 0,
              rollback_retry_count: 0,
              next_retry_at: undefined,
            },
          ]
        : [],
    );
  });

  it(`${action.name} propagates open failure without a matching fallback record`, async () => {
    const failed = createFailure();
    const persisted = installFallback(failed);
    const original = new Map(persisted);
    installUnavailableDatabase();

    await assert.rejects(action("missing"), /Database unavailable/);

    assert.deepEqual(persisted, original);
  });
}

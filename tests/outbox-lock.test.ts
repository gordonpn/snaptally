import assert from "node:assert/strict";
import { afterEach, it } from "node:test";
import {
  clearDeadLetterQueue,
  clearOutbox,
  clearRetryTimer,
  getDeadLetterQueue,
  getOutbox,
  type OutboxItem,
  saveOutboxItem,
  syncOutbox,
} from "../src/scripts/outbox.ts";

const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
afterEach(() => {
  if (navigatorDescriptor) Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
  else Reflect.deleteProperty(globalThis, "navigator");
});

function createPending(): OutboxItem {
  return {
    id: "stalled",
    date: "2026-10-20",
    card: "Visa",
    merchant: "Cafe",
    parent_bucket: "Guilt-Free",
    subcategory: "Dining",
    gross_amount: 12,
    reimbursement: 0,
    created_at: "2026-10-20T12:00:00Z",
  };
}

for (const status of [undefined, 201, 400]) {
  it(`releases the sync lock after a stalled ${status ?? "request"} and respects committed responses`, async (t) => {
    await clearOutbox();
    await clearDeadLetterQueue();
    const item = createPending();
    await saveOutboxItem(item);
    let held = false;
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        locks: {
          async request<T>(_name: string, callback: () => Promise<T>): Promise<T> {
            held = true;
            try {
              return await callback();
            } finally {
              held = false;
            }
          },
        },
      },
    });
    t.mock.method(AbortSignal, "timeout", (milliseconds: number): AbortSignal => {
      assert.equal(milliseconds, 30000);
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException("Request timed out", "TimeoutError")), 5);
      return controller.signal;
    });
    t.mock.method(
      globalThis,
      "fetch",
      async (_url: unknown, init: RequestInit): Promise<Response> => {
        const signal = init.signal;
        assert.ok(signal, "transaction fetch must carry an abort signal");
        if (status === undefined) {
          return new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          });
        }
        const body = new ReadableStream<Uint8Array>({
          start(controller): void {
            signal.addEventListener("abort", () => controller.error(signal.reason), { once: true });
          },
        });
        return new Response(body, { status });
      },
    );

    try {
      const result = await syncOutbox({ force: true });

      assert.equal(held, false);
      if (status === 201) {
        assert.equal(result.syncedCount, 1);
        assert.equal(result.failedCount, 0);
        assert.equal(result.retryError, undefined);
        assert.deepEqual(await getOutbox(), []);
        assert.deepEqual(await getDeadLetterQueue(), []);
        return;
      }
      assert.equal(result.syncedCount, 0);
      assert.equal(result.failedCount, 1);
      assert.match(result.retryError ?? "", /timed out/);
      assert.deepEqual(await getDeadLetterQueue(), []);
      const pending = await getOutbox();
      assert.deepEqual(
        pending.map(({ next_retry_at, ...payload }) => payload),
        [{ ...item, retry_count: 1 }],
      );
      assert.ok(pending[0]?.next_retry_at && pending[0].next_retry_at > Date.now());

      t.mock.method(
        globalThis,
        "fetch",
        async (): Promise<Response> => new Response("{}", { status: 201 }),
      );
      const recovered = await syncOutbox({ force: true });

      assert.equal(recovered.syncedCount, 1);
      assert.equal(held, false);
      assert.deepEqual(await getOutbox(), []);
    } finally {
      clearRetryTimer();
      await clearOutbox();
      await clearDeadLetterQueue();
    }
  });
}

it("holds the shared browser lock around the complete outbox sync", async () => {
  const locks: string[] = [];
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      locks: {
        async request<T>(name: string, callback: () => Promise<T>): Promise<T> {
          locks.push(name);
          return callback();
        },
      },
    },
  });

  const result = await syncOutbox();

  assert.deepEqual(locks, ["snaptally-outbox-sync"]);
  assert.equal(result.syncedCount, 0);
});

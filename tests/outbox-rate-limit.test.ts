import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import {
  clearDeadLetterQueue,
  clearOutbox,
  clearRetryTimer,
  getDeadLetterCount,
  getOutbox,
  type OutboxItem,
  saveOutboxItem,
  setupSyncListeners,
  syncOutbox,
} from "../src/scripts/outbox.ts";

const item: OutboxItem = {
  id: "rate-limit-transaction",
  date: "2026-11-10",
  card: "Checking",
  parent_bucket: "Guilt-Free",
  subcategory: "Dining",
  merchant: "Cafe",
  gross_amount: 10,
  reimbursement: 0,
  currency: "CAD",
  created_at: "2026-11-10T12:00:00Z",
};

describe("outbox server-directed backoff", () => {
  beforeEach(async () => {
    clearRetryTimer();
    await clearOutbox();
    await clearDeadLetterQueue();
  });
  afterEach(async () => {
    clearRetryTimer();
    mock.restoreAll();
    await clearOutbox();
    await clearDeadLetterQueue();
  });

  it("keeps repeatedly throttled transactions pending without exhausting the retry budget", async () => {
    await saveOutboxItem(item);
    await saveOutboxItem({ ...item, id: "tail" });
    let calls = 0;
    mock.method(globalThis, "fetch", async () => {
      calls++;
      return new Response("", { status: 429, headers: { "Retry-After": "48" } });
    });
    let delay = 0;
    for (let i = 0; i < 12; i++) {
      const start = Date.now();
      const result = await syncOutbox({
        token: "token",
        force: true,
        onScheduleRetry: (ms) => {
          delay = ms;
        },
      });
      assert.equal(result.syncedCount, 0);
      assert.equal(result.unauthorized, false);
      assert.ok(result.retryError);
      const remaining = await getOutbox();
      assert.equal(remaining.length, 2);
      assert.equal(remaining[0].retry_count, undefined);
      assert.equal(remaining[0].server_retry_count, undefined);
      assert.ok((remaining[0].next_retry_at ?? 0) >= start + 48_000);
    }
    assert.equal(
      calls,
      12,
      "stop after first throttled item instead of flooding the rest of the queue",
    );
    assert.ok(delay >= 47_900 && delay <= 48_000);
    assert.equal(await getDeadLetterCount(), 0);
    mock.restoreAll();
    mock.method(globalThis, "fetch", async () => new Response('{"ok":true}', { status: 201 }));
    assert.equal((await syncOutbox({ token: "token", force: true })).syncedCount, 2);
  });

  it("blocks the whole queue across automatic syncs, new entries and timer resets", async () => {
    let now = 1_800_000;
    mock.method(Date, "now", () => now);
    await saveOutboxItem(item);
    await saveOutboxItem({ ...item, id: "tail" });
    let calls = 0;
    mock.method(globalThis, "fetch", async () => {
      calls++;
      return calls === 1
        ? new Response("", { status: 429, headers: { "Retry-After": "60" } })
        : Response.json({ ok: true }, { status: 201 });
    });
    const options = { token: "token", onScheduleRetry: () => {} };
    await syncOutbox(options);
    clearRetryTimer();
    await saveOutboxItem({ ...item, id: "new-entry" });
    await syncOutbox(options);
    assert.equal(calls, 1);
    assert.equal((await getOutbox()).length, 3);
    now += 60_000;
    assert.equal((await syncOutbox(options)).syncedCount, 3);
    assert.equal(calls, 4);
  });

  it("does not bypass server backoff on an automatic online event", async () => {
    const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
    const events = new EventTarget();
    Object.defineProperty(globalThis, "window", { configurable: true, value: events });
    Object.defineProperty(globalThis, "document", { configurable: true, value: new EventTarget() });
    let pending = Promise.resolve();
    const cleanup = setupSyncListeners((force) => {
      pending = syncOutbox({ force, onScheduleRetry: () => {} }).then(() => {});
    });
    try {
      await saveOutboxItem(item);
      await saveOutboxItem({ ...item, id: "online-tail" });
      let calls = 0;
      mock.method(globalThis, "fetch", async () => {
        calls++;
        return new Response("", { status: 429, headers: { "Retry-After": "60" } });
      });
      await syncOutbox({ onScheduleRetry: () => {} });
      events.dispatchEvent(new Event("online"));
      await pending;
      assert.equal(calls, 1);
      assert.equal((await getOutbox()).length, 2);
    } finally {
      cleanup();
      if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);
      else Reflect.deleteProperty(globalThis, "window");
      if (documentDescriptor) Object.defineProperty(globalThis, "document", documentDescriptor);
      else Reflect.deleteProperty(globalThis, "document");
    }
  });

  it("honors a persisted server deadline when no item has an individual retry deadline", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    const stored = new Map([["snaptally_outbox_server_backoff", String(Date.now() + 60_000)]]);
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => stored.get(key) ?? null,
        setItem: (key: string, value: string) => stored.set(key, value),
      },
    });
    try {
      await saveOutboxItem(item);
      const fetchMock = mock.method(globalThis, "fetch", async () =>
        Response.json({ ok: true }, { status: 201 }),
      );
      assert.ok((await syncOutbox({ onScheduleRetry: () => {} })).retryError);
      assert.equal(fetchMock.mock.callCount(), 0);
      assert.equal((await getOutbox()).length, 1);
    } finally {
      await clearOutbox();
      if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
      else Reflect.deleteProperty(globalThis, "localStorage");
    }
  });

  it("accepts Retry-After HTTP dates and defaults safely on invalid or absent values", async () => {
    const now = Date.now();
    mock.method(Date, "now", () => now);
    for (const [header, expected] of [
      [new Date(now + 30_000).toUTCString(), 30_000],
      [new Date(now - 30_000).toUTCString(), 60_000],
      ["garbage", 60_000],
      ["", 60_000],
      ["0", 1000],
      ["999999999", 86_400_000],
    ] as const) {
      await clearOutbox();
      clearRetryTimer();
      await saveOutboxItem(item);
      const fetchMock = mock.method(
        globalThis,
        "fetch",
        async () =>
          new Response("", { status: 429, headers: header ? { "Retry-After": header } : {} }),
      );
      await syncOutbox({ force: true, onScheduleRetry: () => {} });
      const deadline = (await getOutbox())[0].next_retry_at;
      assert.ok(deadline !== undefined);
      const actual = deadline - now;
      assert.ok(Math.abs(actual - expected) < 1000, `${header}: ${actual}`);
      fetchMock.mock.restore();
    }
  });

  it("retains transactions during fail-closed guard outages without consuming server retries", async () => {
    await saveOutboxItem({ ...item, server_retry_count: 3, retry_count: 3 });
    mock.method(
      globalThis,
      "fetch",
      async () => new Response("", { status: 503, headers: { "Retry-After": "60" } }),
    );
    await syncOutbox({ force: true, onScheduleRetry: () => {} });
    const remaining = (await getOutbox())[0];
    assert.equal(remaining.server_retry_count, 3);
    assert.equal(remaining.retry_count, 3);
    assert.equal(await getDeadLetterCount(), 0);
  });
});

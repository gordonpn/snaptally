import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { intakeForm } from "../src/scripts/intake-form.ts";
import {
  clearDeadLetterQueue,
  clearOutbox,
  clearRetryTimer,
  type DeadLetterItem,
  getDeadLetterQueue,
  getOutbox,
  type OutboxItem,
  saveDeadLetterItem,
  saveOutboxItem,
} from "../src/scripts/outbox.ts";

function createItem(overrides: Partial<OutboxItem> = {}): OutboxItem {
  return {
    id: "pending-1",
    date: "2026-10-20",
    card: "Visa",
    parent_bucket: "Guilt-Free",
    subcategory: "Dining",
    merchant: "Cafe",
    gross_amount: 12.34,
    reimbursement: 0,
    created_at: "2026-10-20T12:00:00Z",
    retry_count: 2,
    ...overrides,
  };
}
function createFailure(overrides: Partial<DeadLetterItem> = {}): DeadLetterItem {
  return {
    id: "failed-1",
    payload: createItem({ id: "failed-1" }),
    error_reason: "Invalid payload",
    http_status: 400,
    failed_at: "2026-10-20T12:01:00Z",
    retry_count: 2,
    ...overrides,
  };
}

function sentTransactionId(body: string): string {
  const payload: unknown = JSON.parse(body);
  assert.ok(payload !== null && typeof payload === "object" && "id" in payload);
  assert.ok(typeof payload.id === "string");
  return payload.id;
}

const indexedDBDescriptor = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
beforeEach(() => {
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: undefined });
});

afterEach(async () => {
  mock.restoreAll();
  clearRetryTimer();
  await clearOutbox();
  await clearDeadLetterQueue();
  Reflect.deleteProperty(globalThis, "confirm");
  if (indexedDBDescriptor) Object.defineProperty(globalThis, "indexedDB", indexedDBDescriptor);
  else Reflect.deleteProperty(globalThis, "indexedDB");
});

describe("outbox sync drawer", () => {
  it("loads both counts while keeping closed drawer contents lazy", async () => {
    await saveOutboxItem(createItem());
    await saveDeadLetterItem(createFailure());
    const form = intakeForm();

    await form.recheckSyncStatus();

    assert.equal(form.outboxCount, 1);
    assert.equal(form.deadLetterCount, 1);
    assert.deepEqual(form.outboxItems, []);
    assert.deepEqual(form.deadLetterItems, []);
    assert.equal(form.isOutboxOpen, false);
  });

  it("opens either tab with exact stored records and closes without changing intake", async () => {
    const pending = createItem();
    const failed = createFailure();
    await saveOutboxItem(pending);
    await saveDeadLetterItem(failed);
    const form = intakeForm();
    form.pressDigit(7);

    await form.openOutboxDrawer("failed");

    assert.equal(form.isOutboxOpen, true);
    assert.equal(form.activeOutboxTab, "failed");
    assert.deepEqual(form.outboxItems, [pending]);
    assert.deepEqual(form.deadLetterItems, [failed]);
    form.closeOutboxDrawer();
    assert.equal(form.isOutboxOpen, false);
    assert.equal(form.amountCents, 7);
    await form.openOutboxDrawer();
    assert.equal(form.activeOutboxTab, "pending");
  });

  it("handles empty queues", async () => {
    const form = intakeForm();

    await form.openOutboxDrawer();

    assert.deepEqual(form.outboxItems, []);
    assert.deepEqual(form.deadLetterItems, []);
    assert.equal(form.persistentSyncMessage, "");
  });

  it("requeues the selected failure and triggers sync without touching other failures", async () => {
    const other = createFailure({ id: "failed-2", payload: createItem({ id: "failed-2" }) });
    await saveDeadLetterItem(createFailure());
    await saveDeadLetterItem(other);
    const form = intakeForm();
    form.token = "test-token";
    const requests: string[] = [];
    mock.method(globalThis, "fetch", async (_url: unknown, options?: RequestInit) => {
      requests.push(String(options?.body));
      return new Response("{}", { status: 201 });
    });

    await form.retryDLQItem("failed-1");

    assert.equal(requests.length, 1);
    assert.equal(sentTransactionId(requests[0]), "failed-1");
    assert.deepEqual(await getOutbox(), []);
    assert.deepEqual(await getDeadLetterQueue(), [other]);
    assert.equal(form.deadLetterCount, 1);
    assert.equal(form.isQueueActionPending, false);
  });

  for (const confirmed of [false, true]) {
    it(`discards only the selected failure when confirmation is ${confirmed}`, async () => {
      const failed = createFailure();
      const other = createFailure({ id: "failed-2", payload: createItem({ id: "failed-2" }) });
      await saveDeadLetterItem(failed);
      await saveDeadLetterItem(other);
      Object.defineProperty(globalThis, "confirm", { configurable: true, value: () => confirmed });
      const form = intakeForm();

      await form.discardDLQItem("failed-1");

      assert.deepEqual(await getDeadLetterQueue(), confirmed ? [other] : [failed, other]);
      assert.equal(form.isQueueActionPending, false);
    });
  }

  it("retains persistent failure warnings across keypad, selectors and saved entries", async () => {
    await saveDeadLetterItem(createFailure());
    const form = intakeForm();
    await form.recheckSyncStatus();
    const warning = form.persistentSyncMessage;

    form.pressDigit(1);
    form.pressClear();
    form.selectBucket("Fixed Costs");
    form.selectMerchant("Other cafe");
    form.statusMessage = "Saved transaction";

    assert.notEqual(warning, "");
    assert.equal(form.persistentSyncMessage, warning);
    assert.equal(form.deadLetterCount, 1);
  });

  it("keeps a 401 warning until authentication succeeds", async () => {
    await saveOutboxItem(createItem());
    const form = intakeForm();
    form.token = "test-token";
    const fetchMock = mock.method(
      globalThis,
      "fetch",
      async () => new Response(null, { status: 401 }),
    );

    await form.syncPendingOutbox(true);
    form.pressDigit(2);
    form.selectCard("Amex");

    assert.match(form.persistentSyncMessage, /authentication/i);
    assert.equal((await getOutbox()).length, 1);
    fetchMock.mock.mockImplementation(async () => new Response("{}", { status: 201 }));
    await form.syncPendingOutbox(true);
    assert.equal(form.persistentSyncMessage, "");
  });

  it("shows quarantined validation details and refreshes the open drawer after sync", async () => {
    await saveOutboxItem(createItem());
    const form = intakeForm();
    await form.openOutboxDrawer();
    mock.method(
      globalThis,
      "fetch",
      async () => new Response('{"error":"Invalid payload"}', { status: 400 }),
    );

    await form.syncPendingOutbox(true);

    assert.deepEqual(form.outboxItems, []);
    assert.equal(form.deadLetterItems[0].error_reason, "Invalid payload");
    assert.equal(form.deadLetterCount, 1);
    assert.match(form.persistentSyncMessage, /failed/i);
  });
});

describe("sync status recovery", () => {
  for (const status of [500, 503, "offline", "unknown error"] as const) {
    it(`distinguishes ${status} retry failures without quarantining a saved transaction`, async () => {
      await saveOutboxItem(createItem());
      const form = intakeForm();
      mock.method(globalThis, "fetch", async () => {
        if (status === "offline") throw new TypeError("Failed to fetch");
        if (status === "unknown error") throw "Request interrupted";
        return new Response(null, { status });
      });

      await form.syncPendingOutbox(true);

      const expected =
        typeof status === "number" ? new RegExp(`HTTP ${status}`) : /Sync interrupted:/;
      assert.match(form.syncError, expected);
      if (status === "unknown error")
        assert.match(form.syncError, /request or local storage failure/);
      assert.equal(form.outboxCount, 1);
      assert.equal(form.deadLetterCount, 0);
      assert.equal(form.persistentSyncMessage, "");
      assert.equal(form.isSyncing, false);
    });
  }

  it("serializes concurrent sync requests so a newly saved item is not skipped", async () => {
    const form = intakeForm();
    let release: (() => void) | undefined;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const requests: string[] = [];
    mock.method(globalThis, "fetch", async (_url: unknown, options?: RequestInit) => {
      requests.push(String(options?.body));
      await waiting;
      return new Response("{}", { status: 201 });
    });
    await saveOutboxItem(createItem());
    const first = form.syncPendingOutbox(true);
    await saveOutboxItem(createItem({ id: "pending-2" }));
    const second = form.syncPendingOutbox(true);
    if (!release) throw new Error("Missing sync gate");
    release();

    await Promise.all([first, second]);

    assert.deepEqual(requests.map(sentTransactionId), ["pending-1", "pending-2"]);
    assert.equal(form.outboxCount, 0);
    assert.equal(form.isSyncing, false);
    assert.equal(form.syncTask, undefined);
  });

  for (const busy of ["isSyncing", "isQueueActionPending"] as const) {
    it(`ignores mutation actions while ${busy}`, async () => {
      const failed = createFailure();
      await saveDeadLetterItem(failed);
      const form = intakeForm();
      form[busy] = true;

      await form.retryDLQItem(failed.id);
      await form.discardDLQItem(failed.id);

      assert.deepEqual(await getDeadLetterQueue(), [failed]);
      assert.deepEqual(await getOutbox(), []);
    });
  }

  it("retains a requeued item if the retry action encounters an error", async () => {
    await saveDeadLetterItem(createFailure());
    const form = intakeForm();
    mock.method(form, "syncPendingOutbox", async () => {
      throw new Error("Sync interrupted");
    });

    await form.retryDLQItem("failed-1");

    assert.equal(form.queueError, "Sync interrupted");
    assert.equal(form.isQueueActionPending, false);
    assert.equal((await getOutbox())[0].id, "failed-1");
    assert.equal(form.outboxCount, 1);
  });

  it("clears an authentication warning after a successful authenticated read with no pending queue", async () => {
    const form = intakeForm();
    form.token = "replacement-token";
    form.authenticationFailed = true;
    mock.method(
      globalThis,
      "fetch",
      async () => new Response('{"transactions":[]}', { status: 200 }),
    );

    await form.syncPendingOutbox();
    assert.equal(form.authenticationFailed, true);
    await form.loadRecentTransactions();

    assert.equal(form.authenticationFailed, false);
    assert.equal(form.persistentSyncMessage, "");
  });

  it("ignores a stale authentication response after a token change", async () => {
    const form = intakeForm();
    form.token = "old-token";
    mock.method(globalThis, "fetch", async () => {
      form.token = "replacement-token";
      return new Response(null, { status: 401 });
    });

    await form.loadRecentTransactions();

    assert.equal(form.authenticationFailed, false);
  });

  it("loads the failed badge and persistent warning during initialization after a reload", async () => {
    await saveDeadLetterItem(createFailure());
    const form = intakeForm();

    form.init();
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.equal(form.deadLetterCount, 1);
    assert.match(form.persistentSyncMessage, /failed transaction/);
    assert.deepEqual(form.deadLetterItems, []);
  });
});

describe("queue action failures", () => {
  for (const failure of [new Error("Storage unavailable"), "unavailable"]) {
    it(`reports retry failure ${String(failure)} and releases the action lock`, async () => {
      await saveDeadLetterItem(createFailure());
      const form = intakeForm();
      mock.method(form, "syncPendingOutbox", async () => {
        throw failure;
      });

      await form.retryDLQItem("failed-1");

      assert.equal(
        form.queueError,
        failure instanceof Error ? failure.message : "Unable to retry this transaction.",
      );
      assert.equal(form.isQueueActionPending, false);
      assert.equal(form.outboxCount, 1);
    });

    it(`reports discard failure ${String(failure)} and retains the persisted record`, async () => {
      const failed = createFailure();
      Object.defineProperty(globalThis, "confirm", { configurable: true, value: () => true });
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: {
          getItem: () => JSON.stringify([failed]),
          setItem: () => {
            throw failure;
          },
        },
      });
      const form = intakeForm();
      try {
        await form.discardDLQItem(failed.id);

        assert.equal(
          form.queueError,
          failure instanceof Error ? failure.message : "Unable to discard this transaction.",
        );
        assert.equal(form.isQueueActionPending, false);
        assert.equal(form.deadLetterCount, 1);
        assert.deepEqual(await getDeadLetterQueue(), [failed]);
      } finally {
        Reflect.deleteProperty(globalThis, "localStorage");
      }
    });
  }

  it("keeps a warning for every quarantined item until the queue is empty", async () => {
    await saveDeadLetterItem(createFailure());
    await saveDeadLetterItem(
      createFailure({ id: "failed-2", payload: createItem({ id: "failed-2" }) }),
    );
    const form = intakeForm();
    await form.recheckSyncStatus();
    assert.match(form.persistentSyncMessage, /^2 failed transactions/);
    Object.defineProperty(globalThis, "confirm", { configurable: true, value: () => true });

    await form.discardDLQItem("failed-1");
    assert.match(form.persistentSyncMessage, /^1 failed transaction /);
    await form.discardDLQItem("failed-2");

    assert.equal(form.persistentSyncMessage, "");
    assert.equal(form.deadLetterCount, 0);
  });

  for (const loader of ["loadRecentTransactions", "loadFrequentMerchants"] as const) {
    it(`tracks authentication failures from ${loader} and clears them on success`, async () => {
      const form = intakeForm();
      form.token = "test-token";
      const fetchMock = mock.method(
        globalThis,
        "fetch",
        async () => new Response(null, { status: 401 }),
      );
      await form[loader]();
      assert.equal(form.authenticationFailed, true);
      fetchMock.mock.mockImplementation(async () => new Response("{}", { status: 200 }));

      await form[loader]();

      assert.equal(form.authenticationFailed, false);
    });
  }
});

describe("sync and intake status isolation", () => {
  for (const status of [400, 401]) {
    it(`keeps HTTP ${status} failures separate from local save feedback`, async () => {
      await saveOutboxItem(createItem());
      const form = intakeForm();
      form.statusMessage = "Saved locally";
      mock.method(
        globalThis,
        "fetch",
        async () => new Response('{"error":"Invalid payload"}', { status }),
      );

      await form.syncPendingOutbox(true);

      assert.equal(form.statusMessage, "Saved locally");
      assert.notEqual(form.persistentSyncMessage, "");
      assert.equal(form.authenticationFailed, status === 401);
      assert.equal(form.deadLetterCount, status === 400 ? 1 : 0);
    });
  }
});

describe("review regressions", () => {
  it("retries the selected failed record without bypassing another record's backoff", async () => {
    const waiting = createItem({
      id: "waiting",
      next_retry_at: Date.now() + 60000,
      server_retry_count: 4,
    });
    await saveOutboxItem(waiting);
    await saveDeadLetterItem(createFailure());
    const form = intakeForm();
    const requests: string[] = [];
    mock.method(globalThis, "fetch", async (_url: unknown, options?: RequestInit) => {
      requests.push(sentTransactionId(String(options?.body)));
      return new Response("{}", { status: 201 });
    });

    await form.retryDLQItem("failed-1");

    assert.deepEqual(requests, ["failed-1"]);
    assert.deepEqual(await getOutbox(), [waiting]);
    assert.deepEqual(await getDeadLetterQueue(), []);
  });

  it("shows the current retry interruption after an earlier validation rejection", async () => {
    await saveOutboxItem(createItem({ id: "invalid" }));
    await saveOutboxItem(createItem({ id: "retrying", created_at: "2026-10-20T12:01:00Z" }));
    const form = intakeForm();
    mock.method(globalThis, "fetch", async (_url: unknown, options?: RequestInit) =>
      sentTransactionId(String(options?.body)) === "invalid"
        ? new Response('{"error":"Invalid category"}', { status: 400 })
        : new Response("{}", { status: 503 }),
    );

    await form.syncPendingOutbox();

    assert.match(form.syncError, /HTTP 503/);
    assert.equal(form.deadLetterCount, 1);
    assert.deepEqual(
      (await getDeadLetterQueue()).map((item) => item.error_reason),
      ["Invalid category"],
    );
    assert.deepEqual(
      (await getOutbox()).map((item) => item.id),
      ["retrying"],
    );
  });

  for (const [counters, expected] of [
    [{ retry_count: undefined }, 0],
    [{ retry_count: undefined, rollback_retry_count: 3 }, 3],
    [{ retry_count: 7, server_retry_count: 4, rollback_retry_count: 2 }, 9],
    [{ retry_count: undefined, server_retry_count: 4, rollback_retry_count: 2 }, 6],
  ] as const) {
    it(`reports the complete retry total ${expected} for ${JSON.stringify(counters)}`, () => {
      const form = intakeForm();

      assert.equal(form.retryCount(createItem(counters)), expected);
    });
  }

  it("stores transport, server and rollback attempts in quarantined retry totals", async () => {
    await saveOutboxItem(
      createItem({ retry_count: 15, server_retry_count: 9, rollback_retry_count: 2 }),
    );
    const form = intakeForm();
    mock.method(globalThis, "fetch", async () => new Response("{}", { status: 503 }));

    await form.syncPendingOutbox(true);

    const failed = await getDeadLetterQueue();
    assert.equal(failed[0].retry_count, 18);
    assert.equal(failed[0].http_status, 503);
  });
});

import { afterEach, beforeEach } from "node:test";
import type { intakeForm } from "../src/scripts/intake-form.ts";
import {
  clearDeadLetterQueue,
  clearOutbox,
  clearRetryTimer,
  setupSyncListeners,
} from "../src/scripts/outbox.ts";

// Restore descriptors, including absent globals, rather than leaking the last suite's mocks.
export function isolateBrowser(): void {
  const keys = ["localStorage", "indexedDB", "window", "document", "navigator", "fetch"] as const;
  const originals = keys.map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  );
  beforeEach(() => {
    for (const [key] of originals) {
      if (key !== "fetch") {
        Object.defineProperty(globalThis, key, {
          configurable: true,
          writable: true,
          value: undefined,
        });
      }
    }
  });
  afterEach(async () => {
    try {
      await settleForms();
    } finally {
      try {
        for (const key of ["localStorage", "indexedDB", "window", "document"] as const) {
          Object.defineProperty(globalThis, key, {
            configurable: true,
            writable: true,
            value: undefined,
          });
        }
        setupSyncListeners(() => {})();
        clearRetryTimer();
        await clearOutbox();
        await clearDeadLetterQueue();
      } finally {
        for (const [key, descriptor] of originals) {
          if (descriptor) Object.defineProperty(globalThis, key, descriptor);
          else Reflect.deleteProperty(globalThis, key);
        }
      }
    }
  });
}

const pending = new Set<Promise<unknown>>();
export function trackForm(form: ReturnType<typeof intakeForm>): ReturnType<typeof intakeForm> {
  for (const key of [
    "loadFrequentMerchants",
    "loadRecentTransactions",
    "recheckSyncStatus",
    "syncPendingOutbox",
  ] as const) {
    const original = form[key];
    Object.defineProperty(form, key, {
      value: function (this: typeof form, ...args: unknown[]) {
        const task = Reflect.apply(original, this, args) as Promise<unknown>;
        pending.add(task);
        return task;
      },
      configurable: true,
      writable: true,
    });
  }
  return form;
}

async function settleForms(): Promise<void> {
  while (pending.size) {
    const tasks = [...pending];
    pending.clear();
    const results = await Promise.allSettled(tasks);
    const failed = results.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  }
}

import assert from "node:assert/strict";
import { afterEach, it } from "node:test";
import { syncOutbox } from "../src/scripts/outbox.ts";

const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
afterEach(() => {
  if (navigatorDescriptor) Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
  else Reflect.deleteProperty(globalThis, "navigator");
});

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

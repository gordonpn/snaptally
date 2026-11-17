import assert from "node:assert/strict";
import { it } from "node:test";
import {
  intakeForm as createIntakeForm,
  MERCHANTS_STORAGE_KEY,
} from "../src/scripts/intake-form.ts";
import { isolateBrowser, trackForm } from "./browser-fixture.ts";

isolateBrowser();

function intakeForm(): ReturnType<typeof createIntakeForm> {
  return trackForm(createIntakeForm());
}

it("restores cached merchant suggestions on startup without losing built-in merchants", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const stored = new Map([
    [MERCHANTS_STORAGE_KEY, JSON.stringify(["Local Bakery", "Trader Joe's"])],
  ]);
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
      removeItem: (key: string) => stored.delete(key),
    },
  });
  try {
    const form = intakeForm();
    form.init();
    await form.recheckSyncStatus();
    form.updateMerchant("Local Bak");
    assert.deepEqual(form.merchantSuggestions, ["Local Bakery"]);
    assert.equal(form.allMerchants.filter((merchant) => merchant === "Trader Joe's").length, 1);
    assert.ok(form.allMerchants.includes("Star Market"));
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});

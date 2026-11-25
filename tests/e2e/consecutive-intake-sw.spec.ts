import { expect, type Page, test } from "@playwright/test";
import { type DelayedProxy, startDelayedProxy } from "./delayed-proxy";
import { enterExpense, readOutbox, TEST_TOKEN } from "./helpers";

async function openIntakeAt(page: Page, baseUrl: string): Promise<void> {
  await page.goto(`${baseUrl}/`);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("API Bearer Token").fill(TEST_TOKEN);
  const loaded = page.waitForResponse(
    (response) =>
      response.url().includes("/api/transactions?") && response.request().method() === "GET",
  );
  await page.getByRole("button", { name: "Save Token", exact: true }).click();
  expect((await loaded).ok()).toBe(true);
  await expect(page.getByLabel("API Bearer Token")).toBeHidden();
}

async function selectFixedGroceries(page: Page): Promise<void> {
  await page
    .getByRole("group", { name: "Parent bucket selection", exact: true })
    .getByRole("button", { name: "Fixed Costs", exact: true })
    .click();
  await page
    .getByRole("group", { name: "Subcategory selection", exact: true })
    .getByRole("button", { name: "Groceries", exact: true })
    .click();
}

async function expectResetAndEnterSecond(
  page: Page,
  secondMerchant: string,
  unlockDeadline: number,
): Promise<void> {
  await expect(page.getByText("USD $0.00", { exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Merchant name" })).toHaveValue("");
  await expect(
    page
      .getByRole("group", { name: "Parent bucket selection", exact: true })
      .getByRole("button", { name: "Guilt-Free", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page
      .getByRole("group", { name: "Subcategory selection", exact: true })
      .getByRole("button", { name: "Dining", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");

  const save = page.getByRole("button", { name: "Save Transaction", exact: true });
  await expect(save).toBeDisabled();
  const keypadKeys = ["1", "2", "3"].map((digit) =>
    page.getByRole("button", { name: digit, exact: true }),
  );
  for (const key of keypadKeys) {
    await expect(key).toBeEnabled();
  }
  expect(Date.now()).toBeLessThanOrEqual(unlockDeadline);

  for (const key of keypadKeys) {
    await key.click();
  }
  await expect(page.getByText("USD $1.23", { exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Merchant name" }).fill(secondMerchant);
  await save.click();
}

async function ensureServiceWorkerActive(page: Page): Promise<void> {
  const probe = await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) {
      return {
        supported: false,
        isSecureContext: window.isSecureContext,
        state: null,
        controlled: false,
        scriptUrl: null,
      };
    }

    const registration = await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) => {
        navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), {
          once: true,
        });
      });
    }

    return {
      supported: true,
      isSecureContext: window.isSecureContext,
      state: registration.active?.state ?? null,
      controlled: Boolean(navigator.serviceWorker.controller),
      scriptUrl: registration.active?.scriptURL ?? null,
    };
  });

  expect(probe.supported).toBe(true);
  expect(probe.isSecureContext).toBe(true);
  expect(probe.state).toBe("activated");
  expect(probe.controlled).toBe(true);
  expect(probe.scriptUrl).toMatch(/\/sw\.js$/);
}

async function fetchTransactionsByIds(
  page: Page,
  baseUrl: string,
  ids: readonly string[],
): Promise<Array<Record<string, unknown>>> {
  const response = await page.request.get(`${baseUrl}/api/transactions?limit=100`, {
    headers: { Authorization: `Bearer ${TEST_TOKEN}` },
  });
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as {
    transactions: Array<Record<string, unknown>>;
  };
  const idSet = new Set(ids);
  return body.transactions.filter((row) => typeof row.id === "string" && idSet.has(row.id));
}

function expectExactOnceWirePosts(proxy: DelayedProxy, expectedIds: readonly string[]): void {
  // Intake records carry client-generated UUIDs so every forwarded POST maps one-to-one with expectedIds.
  const forwarded = proxy.getPostRequests().filter((entry) => entry.forwarded);
  expect(forwarded).toHaveLength(expectedIds.length);
  const succeededIds = forwarded
    .filter((entry) => entry.status === 201)
    .map((entry) => {
      if (typeof entry.payload === "object" && entry.payload !== null && "id" in entry.payload) {
        return entry.payload.id;
      }
      return undefined;
    })
    .filter((id): id is string => typeof id === "string");
  expect(succeededIds).toHaveLength(expectedIds.length);
  expect(new Set(succeededIds)).toEqual(new Set(expectedIds));
}

test.describe("consecutive intake with active service worker", () => {
  let proxy: DelayedProxy;

  test.beforeEach(async ({ baseURL }) => {
    proxy = await startDelayedProxy(baseURL ?? "http://127.0.0.1:8793");
  });

  test.afterEach(async () => {
    await proxy.close();
  });

  test("delays first POST behind active service worker and accepts consecutive entry", async ({
    page,
  }) => {
    await openIntakeAt(page, proxy.baseUrl);
    await ensureServiceWorkerActive(page);

    const firstPostHeld = proxy.armPostHold();
    const firstMerchant = `First Entry 1-${crypto.randomUUID()}`;
    await enterExpense(page, firstMerchant);
    await selectFixedGroceries(page);

    await page.getByRole("button", { name: "Save Transaction", exact: true }).click();
    const unlockDeadline = Date.now() + 1_500;
    const held = await firstPostHeld;

    await expect.poll(async () => (await readOutbox(page)).length).toBe(1);

    const secondMerchant = `Second Entry 2-${crypto.randomUUID()}`;
    await expectResetAndEnterSecond(page, secondMerchant, unlockDeadline);

    await expect.poll(async () => (await readOutbox(page)).length).toBe(2);
    const outboxBeforeRelease = await readOutbox(page);
    const firstItem = outboxBeforeRelease.find((item) => item.merchant === firstMerchant);
    const secondItem = outboxBeforeRelease.find((item) => item.merchant === secondMerchant);
    expect(firstItem).toBeDefined();
    expect(secondItem).toBeDefined();
    if (!firstItem || !secondItem) throw new Error("Expected both queued items in outbox");
    expect(firstItem.id).not.toBe(secondItem.id);

    held.release();

    await expect.poll(async () => (await readOutbox(page)).length).toBe(0);
    expectExactOnceWirePosts(proxy, [firstItem.id, secondItem.id]);

    const persisted = await fetchTransactionsByIds(page, proxy.baseUrl, [
      firstItem.id,
      secondItem.id,
    ]);
    expect(persisted).toHaveLength(2);
    expect(persisted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: firstItem.id,
          merchant: firstMerchant,
          gross_amount: 4.5,
          parent_bucket: "Fixed Costs",
          subcategory: "Groceries",
          currency: "USD",
          card: "E2E Card",
        }),
        expect.objectContaining({
          id: secondItem.id,
          merchant: secondMerchant,
          gross_amount: 1.23,
          parent_bucket: "Guilt-Free",
          subcategory: "Dining",
          currency: "USD",
          card: "E2E Card",
        }),
      ]),
    );
  });

  test("offline transition during pending POST and consecutive entry sync exact-once on reconnect", async ({
    page,
    context,
  }) => {
    await openIntakeAt(page, proxy.baseUrl);
    await ensureServiceWorkerActive(page);

    const firstPostHeld = proxy.armPostHold();
    const firstMerchant = `Offline First 1-${crypto.randomUUID()}`;
    await enterExpense(page, firstMerchant);
    await selectFixedGroceries(page);

    await page.getByRole("button", { name: "Save Transaction", exact: true }).click();
    const unlockDeadline = Date.now() + 1_500;
    const held = await firstPostHeld;

    await context.setOffline(true);
    held.fail(503);

    const secondMerchant = `Offline Second 2-${crypto.randomUUID()}`;
    await expectResetAndEnterSecond(page, secondMerchant, unlockDeadline);

    await expect.poll(async () => (await readOutbox(page)).length).toBe(2);
    const queued = await readOutbox(page);
    const firstItem = queued.find((item) => item.merchant === firstMerchant);
    const secondItem = queued.find((item) => item.merchant === secondMerchant);
    expect(firstItem).toBeDefined();
    expect(secondItem).toBeDefined();
    if (!firstItem || !secondItem) throw new Error("Expected both queued items in outbox");
    expect(firstItem.id).not.toBe(secondItem.id);

    await page.reload();
    await expect.poll(async () => (await readOutbox(page)).length).toBe(2);
    expect(proxy.getPostRequests().filter((entry) => entry.forwarded)).toHaveLength(0);

    await context.setOffline(false);
    await expect.poll(async () => (await readOutbox(page)).length).toBe(0);
    expectExactOnceWirePosts(proxy, [firstItem.id, secondItem.id]);

    const persisted = await fetchTransactionsByIds(page, proxy.baseUrl, [
      firstItem.id,
      secondItem.id,
    ]);
    expect(persisted).toHaveLength(2);
    expect(persisted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: firstItem.id,
          merchant: firstMerchant,
          gross_amount: 4.5,
          parent_bucket: "Fixed Costs",
          subcategory: "Groceries",
        }),
        expect.objectContaining({
          id: secondItem.id,
          merchant: secondMerchant,
          gross_amount: 1.23,
          parent_bucket: "Guilt-Free",
          subcategory: "Dining",
        }),
      ]),
    );
  });
});

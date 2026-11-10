import { expect, test } from "@playwright/test";
import { enterExpense, openIntake, readOutbox, TEST_TOKEN } from "./helpers";

test("offline expense persists in IndexedDB and syncs once on reconnect", async ({
  page,
  context,
  request,
}) => {
  await openIntake(page);
  const merchant = `Browser Offline ${crypto.randomUUID()}`;
  await enterExpense(page, merchant);
  await context.setOffline(true);
  await page.getByRole("button", { name: "Save Transaction", exact: true }).click();
  await expect.poll(() => readOutbox(page)).toHaveLength(1);
  const [queued] = await readOutbox(page);
  expect(queued).toMatchObject({ merchant, gross_amount: 4.5, currency: "USD" });
  await expect(page.getByRole("button", { name: "Pending offline transactions" })).toBeVisible();
  const synced = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && response.url().endsWith("/api/transactions"),
  );
  await context.setOffline(false);
  expect((await synced).status()).toBe(201);
  await expect.poll(() => readOutbox(page)).toHaveLength(0);
  const response = await request.get("/api/transactions?limit=100", {
    headers: { Authorization: `Bearer ${TEST_TOKEN}` },
  });
  expect(response.ok()).toBe(true);
  const body = await response.json();
  const saved = body.transactions.filter((row: { id: string }) => row.id === queued.id);
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ gross_amount: 4.5, currency: "USD", card: "E2E Card" });
});

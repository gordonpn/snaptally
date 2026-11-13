import { expect, type Page } from "@playwright/test";

export const TEST_TOKEN = "snaptally-e2e-only";

export async function openIntake(page: Page): Promise<void> {
  await page.goto("/");
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

export async function enterExpense(page: Page, merchant: string): Promise<void> {
  await page.getByRole("combobox", { name: "Merchant name" }).fill(merchant);
  await page
    .getByRole("group", { name: "Parent bucket selection", exact: true })
    .getByRole("button", { name: "Guilt-Free", exact: true })
    .click();
  await page
    .getByRole("group", { name: "Subcategory selection", exact: true })
    .getByRole("button", { name: "Dining", exact: true })
    .click();
  const other = page
    .getByRole("group", { name: "Payment card selection", exact: true })
    .getByRole("button", { name: "Other...", exact: true });
  const customCard = page.getByPlaceholder("Type card name...");
  // On a fresh profile, the custom-card field is already open.
  if ((await other.getAttribute("aria-pressed")) !== "true") {
    await other.click();
  }
  await expect(customCard).toBeVisible();
  await customCard.fill("E2E Card");
  for (const digit of ["4", "5", "0"]) {
    await page.getByRole("button", { name: digit, exact: true }).click();
  }
  await expect(page.getByText("USD $4.50", { exact: true })).toBeVisible();
}

export async function readOutbox(
  page: Page,
): Promise<Array<{ id: string; merchant: string; gross_amount: number; currency: string }>> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("snaptally_db");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const request = db.transaction("outbox").objectStore("outbox").getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  });
}

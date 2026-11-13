import { expect, test } from "@playwright/test";
import { enterExpense, openIntake, TEST_TOKEN } from "./helpers";

test("ATM keypad, custom card and successful transaction POST", async ({ page }) => {
  await openIntake(page);
  const save = page.getByRole("button", { name: "Save Transaction", exact: true });
  await expect(save).toBeDisabled();
  for (const digit of ["1", "2", "3", "4", "5", "6", "7", "8", "9"]) {
    await page.getByRole("button", { name: digit, exact: true }).click();
    await expect(page.getByText(`USD $0.0${digit}`, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Clear Amount", exact: true }).click();
  }
  for (const digit of ["1", "2", "3"]) {
    await page.getByRole("button", { name: digit, exact: true }).click();
  }
  await page.getByRole("button", { name: "Backspace", exact: true }).click();
  await expect(page.getByText("USD $0.12", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Clear Amount", exact: true }).click();
  await expect(save).toBeDisabled();

  const merchant = `Browser Intake ${crypto.randomUUID()}`;
  await enterExpense(page, merchant);
  await expect(save).toBeEnabled();
  const posted = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/transactions") && response.request().method() === "POST",
  );
  await save.click();
  const response = await posted;
  expect(response.status()).toBe(201);
  expect(response.request().headers().authorization).toBe(`Bearer ${TEST_TOKEN}`);
  expect(response.request().postDataJSON()).toMatchObject({
    merchant,
    card: "E2E Card",
    gross_amount: 4.5,
    currency: "USD",
    parent_bucket: "Guilt-Free",
    subcategory: "Dining",
  });
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toContainText("4.50");
  await expect(page.getByText("USD $0.00", { exact: true })).toBeVisible();
});

test("Settings token and appearance survive reload", async ({ page }) => {
  await openIntake(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Modern Minimal", exact: true }).click();
  await page
    .getByRole("group", { name: "Color scheme selection", exact: true })
    .getByRole("button", { name: "Dark", exact: true })
    .click();
  await page.getByRole("button", { name: "Close Settings", exact: true }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme-style", "flat");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel("API Bearer Token")).toHaveValue(TEST_TOKEN);
});

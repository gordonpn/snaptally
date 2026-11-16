import { expect, type Page, test } from "@playwright/test";
import { enterExpense, openIntake, readOutbox } from "./helpers";

// Keep requests observable by Playwright; service workers can bypass network routes.
test.use({ serviceWorkers: "block" });

async function expectResetAndEnterSecond(
  page: Page,
  secondMerchant: string,
  unlockDeadline: number,
): Promise<void> {
  const remaining = () => Math.max(1, unlockDeadline - Date.now());
  await expect(page.getByText("USD $0.00", { exact: true })).toBeVisible({ timeout: remaining() });
  await expect(page.getByRole("combobox", { name: "Merchant name" })).toHaveValue("", {
    timeout: remaining(),
  });
  await expect(
    page
      .getByRole("group", { name: "Parent bucket selection", exact: true })
      .getByRole("button", { name: "Guilt-Free", exact: true }),
  ).toHaveAttribute("aria-pressed", "true", { timeout: remaining() });
  await expect(
    page
      .getByRole("group", { name: "Subcategory selection", exact: true })
      .getByRole("button", { name: "Dining", exact: true }),
  ).toHaveAttribute("aria-pressed", "true", { timeout: remaining() });
  const save = page.getByRole("button", { name: "Save Transaction", exact: true });
  await expect(save).toBeDisabled({ timeout: remaining() });
  for (const digit of ["1", "2", "3"]) {
    const key = page.getByRole("button", { name: digit, exact: true });
    await expect(key).toBeEnabled({ timeout: remaining() });
    await key.click();
  }
  await expect(page.getByText("USD $1.23", { exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Merchant name" }).fill(secondMerchant);
  await save.click();
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

async function expectOutboxPair(
  page: Page,
  firstMerchant: string,
  secondMerchant: string,
): Promise<void> {
  await expect.poll(async () => (await readOutbox(page)).length).toBe(2);
  const items = await readOutbox(page);
  expect(items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        merchant: firstMerchant,
        gross_amount: 4.5,
        parent_bucket: "Fixed Costs",
        subcategory: "Groceries",
      }),
      expect.objectContaining({
        merchant: secondMerchant,
        gross_amount: 1.23,
        parent_bucket: "Guilt-Free",
        subcategory: "Dining",
      }),
    ]),
  );
  expect(new Set(items.map((item) => item.id)).size).toBe(2);
}

test("consecutive entry resets inputs while sync POST is pending", async ({ page }) => {
  let heldPosts = 0;
  const releasers: Array<() => void> = [];
  // Keep POST pending deterministically until assertions complete, then abort in finally.
  await page.route("**/api/transactions", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    heldPosts++;
    await new Promise<void>((resolve) => {
      releasers.push(resolve);
    });
    await route.abort().catch(() => {});
  });
  try {
    await openIntake(page);
    const firstMerchant = `First entry ${crypto.randomUUID()}`;
    await enterExpense(page, firstMerchant);
    await selectFixedGroceries(page);
    const postStarted = page.waitForRequest(
      (request) => request.method() === "POST" && request.url().endsWith("/api/transactions"),
    );
    await page.getByRole("button", { name: "Save Transaction", exact: true }).click();
    const unlockDeadline = Date.now() + 1_000;
    await postStarted;
    await expect.poll(() => heldPosts).toBe(1);
    await expect.poll(async () => (await readOutbox(page)).length).toBe(1);

    const secondMerchant = `Second entry ${crypto.randomUUID()}`;
    await expectResetAndEnterSecond(page, secondMerchant, unlockDeadline);
    await expectOutboxPair(page, firstMerchant, secondMerchant);
  } finally {
    for (const release of releasers) release();
    await page.unroute("**/api/transactions");
  }
});

test("consecutive entry resets inputs while offline", async ({ page, context }) => {
  await openIntake(page);
  const firstMerchant = `Offline first ${crypto.randomUUID()}`;
  await enterExpense(page, firstMerchant);
  await selectFixedGroceries(page);
  await context.setOffline(true);
  await page.getByRole("button", { name: "Save Transaction", exact: true }).click();
  const unlockDeadline = Date.now() + 1_000;
  await expect.poll(async () => (await readOutbox(page)).length).toBe(1);

  const secondMerchant = `Offline second ${crypto.randomUUID()}`;
  await expectResetAndEnterSecond(page, secondMerchant, unlockDeadline);
  await expectOutboxPair(page, firstMerchant, secondMerchant);
});

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`submission feedback respects ${reducedMotion} motion`, async ({ page, context }) => {
    await page.emulateMedia({ reducedMotion });
    await openIntake(page);
    await enterExpense(page, `Feedback ${crypto.randomUUID()}`);
    await context.setOffline(true);
    const feedback = page.locator(".submission-feedback");
    await feedback.evaluate((element) => {
      const observations = { durations: [] as number[], elapsed: [] as number[] };
      Object.assign(window, { feedbackObservations: observations });
      new MutationObserver(() => {
        if (element.textContent?.startsWith("Saved")) {
          observations.durations.push(
            Number.parseFloat(getComputedStyle(element).transitionDuration),
          );
        }
      }).observe(element, { attributes: true, childList: true, subtree: true });
      element.addEventListener("transitionend", (event) => {
        if (event instanceof TransitionEvent && event.propertyName === "opacity") {
          observations.elapsed.push(event.elapsedTime);
        }
      });
    });
    await page.getByRole("button", { name: "Save Transaction", exact: true }).click();
    await expect(feedback).toContainText("Saved");
    await expect(feedback).toBeVisible();
    const observations = () =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              feedbackObservations: { durations: number[]; elapsed: number[] };
            }
          ).feedbackObservations,
      );
    if (reducedMotion === "reduce") {
      await expect.poll(async () => (await observations()).durations.length).toBeGreaterThan(0);
      const snapshot = await observations();
      expect(snapshot.durations.every((duration) => duration === 0)).toBe(true);
      expect(snapshot.elapsed).toHaveLength(0);
    } else {
      await expect.poll(async () => (await observations()).elapsed.length).toBeGreaterThan(0);
      const elapsed = (await observations()).elapsed[0];
      expect(elapsed).toBeGreaterThanOrEqual(0.3);
      expect(elapsed).toBeLessThanOrEqual(0.5);
    }
    await expect(feedback).toHaveCSS("opacity", "1");
  });
}

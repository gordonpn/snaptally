import { expect, test } from "@playwright/test";
import { enterExpense, openIntake, readOutbox } from "./helpers";

// Keep requests observable by Playwright; service workers can bypass network routes.
test.use({ serviceWorkers: "block" });

for (const network of ["delayed", "offline"] as const) {
  test(`consecutive entry resets inputs while sync is ${network}`, async ({ page, context }) => {
    let heldPosts = 0;
    // Routing disables the cache and keeps the POST pending until both entries are accepted.
    await context.route("**/api/transactions", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      heldPosts++;
      await new Promise<void>((resolve) => {
        page.once("close", resolve);
      });
      await route.abort().catch(() => {});
    });
    await openIntake(page);
    const firstMerchant = `First entry ${crypto.randomUUID()}`;
    await enterExpense(page, firstMerchant);
    await page
      .getByRole("group", { name: "Parent bucket selection", exact: true })
      .getByRole("button", { name: "Fixed Costs", exact: true })
      .click();
    await page
      .getByRole("group", { name: "Subcategory selection", exact: true })
      .getByRole("button", { name: "Groceries", exact: true })
      .click();
    if (network === "offline") await context.setOffline(true);
    const postStarted =
      network === "delayed"
        ? page.waitForRequest(
            (request) => request.method() === "POST" && request.url().endsWith("/api/transactions"),
          )
        : undefined;
    const save = page.getByRole("button", { name: "Save Transaction", exact: true });
    await save.click();
    if (postStarted) {
      await postStarted;
      await expect.poll(() => heldPosts).toBeGreaterThan(0);
    }

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
    await expect(save).toBeDisabled();
    for (const digit of ["1", "2", "3"]) {
      const key = page.getByRole("button", { name: digit, exact: true });
      await expect(key).toBeEnabled({ timeout: 1_000 });
      await key.click();
    }
    await expect(page.getByText("USD $1.23", { exact: true })).toBeVisible();
    const secondMerchant = `Second entry ${crypto.randomUUID()}`;
    await page.getByRole("combobox", { name: "Merchant name" }).fill(secondMerchant);
    await save.click();
    await expect.poll(async () => (await readOutbox(page)).length).toBe(2);
    const items = await readOutbox(page);
    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          merchant: firstMerchant,
          gross_amount: 4.5,
          subcategory: "Groceries",
        }),
        expect.objectContaining({
          merchant: secondMerchant,
          gross_amount: 1.23,
          subcategory: "Dining",
        }),
      ]),
    );
    expect(new Set(items.map((item) => item.id)).size).toBe(2);
  });
}

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
      expect((await observations()).durations.every((duration) => duration === 0)).toBe(true);
    } else {
      await expect.poll(async () => (await observations()).elapsed.length).toBeGreaterThan(0);
      const elapsed = (await observations()).elapsed[0];
      expect(elapsed).toBeGreaterThanOrEqual(0.3);
      expect(elapsed).toBeLessThanOrEqual(0.5);
    }
    await expect(feedback).toHaveCSS("opacity", "1");
  });
}

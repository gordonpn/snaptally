import { expect, test } from "@playwright/test";
import { openIntake } from "./helpers";

for (const width of [375, 390, 430]) {
  test(`keypad shadows have horizontal clearance at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 915 });
    await openIntake(page);
    const keys = page.locator(".neu-key");
    await expect(keys).toHaveCount(12);
    const clearances = await keys.evaluateAll((buttons) =>
      buttons.map((button) => {
        const bounds = button.getBoundingClientRect();
        let left = 0;
        let right = window.innerWidth;
        for (let parent = button.parentElement; parent; parent = parent.parentElement) {
          if (getComputedStyle(parent).overflowX !== "visible") {
            const clip = parent.getBoundingClientRect();
            left = Math.max(left, clip.left);
            right = Math.min(right, clip.right);
          }
        }
        return { left: bounds.left - left, right: right - bounds.right };
      }),
    );
    // Each shadow has a 3px offset and 6px blur. Reserve at least 9px
    // between every key and its nearest horizontal clipping ancestor.
    for (const clearance of clearances) {
      expect(clearance.left).toBeGreaterThanOrEqual(9);
      expect(clearance.right).toBeGreaterThanOrEqual(9);
    }
    await expect(page.locator("body")).toHaveJSProperty("scrollWidth", width);
    await page.screenshot({ path: testInfo.outputPath("keypad.png"), fullPage: true });
  });
}

test("chip rows retain their full-width horizontal scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 915 });
  await page.addInitScript(() => {
    localStorage.setItem(
      "snaptally_cards",
      JSON.stringify([
        "Personal credit card",
        "Business credit card",
        "Travel rewards card",
        "Debit card",
      ]),
    );
  });
  await openIntake(page);
  const rows = [
    page.getByRole("group", { name: "Subcategory selection", exact: true }),
    page.getByRole("group", { name: "Parent bucket selection", exact: true }),
    page
      .getByRole("group", { name: "Payment card selection", exact: true })
      .locator(".overflow-x-auto"),
  ];
  const mainBounds = await page.locator("main").boundingBox();
  if (!mainBounds) throw new Error("Intake main container is missing");
  for (const row of rows) {
    await expect(row).toBeVisible();
    const layout = await row.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      element.scrollLeft = element.scrollWidth;
      return {
        left: bounds.left,
        right: bounds.right,
        overflow: getComputedStyle(element).overflowX,
        scrollLeft: element.scrollLeft,
        maxScroll: element.scrollWidth - element.clientWidth,
      };
    });
    expect(layout.left).toBe(mainBounds.x);
    expect(layout.right).toBe(mainBounds.x + mainBounds.width);
    expect(layout.overflow).toBe("auto");
    // Short rows may fit without scrolling; overflowing rows must reach their end.
    expect(layout.scrollLeft).toBeCloseTo(layout.maxScroll, 0);
    await row.getByRole("button").last().click();
    await expect(row.getByRole("button").last()).toHaveAttribute("aria-pressed", "true");
  }
});

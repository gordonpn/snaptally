import { expect, test } from "@playwright/test";
import { openIntake } from "./helpers";

test("pointer merchant selection releases input focus without losing the selection", async ({
  page,
}) => {
  await openIntake(page);
  const input = page.getByRole("combobox", { name: "Merchant name" });
  await input.fill("Star");
  await expect(input).toBeFocused();

  await page.getByRole("option", { name: "Star Market", exact: true }).tap();

  await expect(input).toHaveValue("Star Market");
  await expect(input).not.toBeFocused();
  await expect(input).toHaveAttribute("aria-expanded", "false");
  await input.tap();
  await expect(input).toBeFocused();
});

test("keyboard merchant selection retains combobox focus", async ({ page }) => {
  await openIntake(page);
  const input = page.getByRole("combobox", { name: "Merchant name" });
  await input.fill("Star");

  await input.press("ArrowDown");
  await input.press("Enter");

  await expect(input).toHaveValue("Star Market");
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute("aria-expanded", "false");
});

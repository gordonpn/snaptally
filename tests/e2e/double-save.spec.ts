import { expect, test } from "@playwright/test";
import { enterExpense, openIntake, readOutbox } from "./helpers";

test("rapid repeated Save activation queues exactly one complete transaction", async ({
  page,
  context,
}) => {
  await openIntake(page);
  const merchant = `Browser Double Save ${crypto.randomUUID()}`;
  await enterExpense(page, merchant);
  await context.setOffline(true);
  const save = page.getByRole("button", { name: "Save Transaction", exact: true });
  await expect(save).toBeEnabled();

  // Dispatch both activations in one task, before Alpine updates the disabled attribute.
  await save.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });

  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toContainText("4.50");
  await expect.poll(() => readOutbox(page)).toHaveLength(1);
  const queued = await readOutbox(page);
  expect(queued).toEqual([
    expect.objectContaining({
      id: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      ),
      merchant,
      gross_amount: 4.5,
      currency: "USD",
      card: "E2E Card",
      parent_bucket: "Guilt-Free",
      subcategory: "Dining",
      reimbursement: 0,
    }),
  ]);
  await expect(page.getByText("USD $0.00", { exact: true })).toBeVisible();
  await expect(save).toBeDisabled();
});

import { expect, test } from "@playwright/test";
import { TEST_TOKEN } from "./helpers";

// Keep requests observable by Playwright; service workers can bypass network routes.
test.use({ serviceWorkers: "block" });

interface PresentationCase {
  id: string;
  merchant: string;
  parentBucket: string;
  subcategory: string;
  amount: number;
  currency: "USD" | "CAD";
  expectedText: string;
  expectedClass: "text-success" | "text-secondary" | "text-neu-text";
  kind: "income" | "expense" | "credit" | "negative-income";
}

const PRESENTATION_CASES: PresentationCase[] = [
  {
    id: "usd-income",
    merchant: "USD Income Payroll",
    parentBucket: "Income",
    subcategory: "Salary",
    amount: 1234.5,
    currency: "USD",
    expectedText: "+$1234.50",
    expectedClass: "text-success",
    kind: "income",
  },
  {
    id: "cad-income",
    merchant: "CAD Income Payroll",
    parentBucket: "Income",
    subcategory: "Salary",
    amount: 1234.5,
    currency: "CAD",
    expectedText: "CAD +$1234.50",
    expectedClass: "text-success",
    kind: "income",
  },
  {
    id: "usd-expense",
    merchant: "USD Guilt-Free Cafe",
    parentBucket: "Guilt-Free",
    subcategory: "Dining",
    amount: 12.5,
    currency: "USD",
    expectedText: "$12.50",
    expectedClass: "text-neu-text",
    kind: "expense",
  },
  {
    id: "cad-expense",
    merchant: "CAD Guilt-Free Cafe",
    parentBucket: "Guilt-Free",
    subcategory: "Dining",
    amount: 12.5,
    currency: "CAD",
    expectedText: "CAD $12.50",
    expectedClass: "text-neu-text",
    kind: "expense",
  },
  {
    id: "usd-credit",
    merchant: "USD Credit Refund",
    parentBucket: "Guilt-Free",
    subcategory: "Dining",
    amount: -12.5,
    currency: "USD",
    expectedText: "-$12.50",
    expectedClass: "text-secondary",
    kind: "credit",
  },
  {
    id: "cad-credit",
    merchant: "CAD Credit Refund",
    parentBucket: "Guilt-Free",
    subcategory: "Dining",
    amount: -12.5,
    currency: "CAD",
    expectedText: "CAD -$12.50",
    expectedClass: "text-secondary",
    kind: "credit",
  },
  {
    id: "usd-historical-negative-income",
    merchant: "USD Historical Negative Income",
    parentBucket: "Income",
    subcategory: "Salary",
    amount: -25,
    currency: "USD",
    expectedText: "-$25.00",
    expectedClass: "text-secondary",
    kind: "negative-income",
  },
  {
    id: "cad-historical-negative-income",
    merchant: "CAD Historical Negative Income",
    parentBucket: "Income",
    subcategory: "Salary",
    amount: -25,
    currency: "CAD",
    expectedText: "CAD -$25.00",
    expectedClass: "text-secondary",
    kind: "negative-income",
  },
];

test("renders USD and CAD income, expense, credit, and historical negative income amounts", async ({
  page,
}) => {
  const today = new Date().toISOString().slice(0, 10);
  const transactions = PRESENTATION_CASES.map((entry, index) => ({
    id: entry.id,
    date: today,
    card: "E2E Card",
    parent_bucket: entry.parentBucket,
    subcategory: entry.subcategory,
    merchant: entry.merchant,
    gross_amount: entry.amount,
    reimbursement: 0,
    net_spend: entry.amount,
    currency: entry.currency,
    created_at: `${today}T12:0${index}:00.000Z`,
  }));

  await page.addInitScript((token) => {
    localStorage.setItem("snaptally_api_token", token);
  }, TEST_TOKEN);

  await page.route("**/api/transactions*", async (route) => {
    if (route.request().method() !== "GET") {
      return route.continue();
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        transactions,
        total_count: transactions.length,
        has_more: false,
        next_offset: null,
        month_summary: {
          month: today.slice(0, 7),
          net_spend: 12.5,
          total_count: transactions.length,
        },
      }),
    });
  });

  await page.goto("/activity");

  const renderedColors = new Map<PresentationCase["kind"], string>();
  for (const entry of PRESENTATION_CASES) {
    const row = page
      .locator(".neu-flat")
      .filter({ has: page.getByText(entry.merchant, { exact: true }) });
    await expect(row).toBeVisible();

    const amount = row.getByText(entry.expectedText, { exact: true });
    await expect(amount).toBeVisible();

    if (entry.amount < 0) {
      await expect(row).not.toContainText("+$");
    }

    const styling = await amount.evaluate((element, expectedClass) => {
      const hasClass =
        element.classList.contains(expectedClass) ||
        Boolean(element.parentElement?.classList.contains(expectedClass));
      return {
        hasClass,
        color: getComputedStyle(element).color,
      };
    }, entry.expectedClass);

    expect(styling.hasClass).toBe(true);
    renderedColors.set(entry.kind, styling.color);
  }

  const incomeColor = renderedColors.get("income");
  const expenseColor = renderedColors.get("expense");
  const creditColor = renderedColors.get("credit");
  const negativeIncomeColor = renderedColors.get("negative-income");

  expect(incomeColor).toBeTruthy();
  expect(expenseColor).toBeTruthy();
  expect(creditColor).toBeTruthy();
  expect(incomeColor).not.toBe(expenseColor);
  expect(creditColor).not.toBe(expenseColor);
  expect(incomeColor).not.toBe(creditColor);
  expect(negativeIncomeColor).toBe(creditColor);
});

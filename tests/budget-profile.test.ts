import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ANALYSIS_BUCKET_SUBCATEGORIES,
  CATEGORY_CARD_PREFERENCES,
  CSP_BENCHMARKS,
  isAnalysisCategory,
  isMonthlyBudgetTarget,
  toAnalysisCategory,
} from "../src/config/budget-profile.ts";
import { BUCKET_SUBCATEGORIES } from "../src/config/intake.ts";

describe("budget profile", () => {
  it("maps investment transfers without mutating stored transaction fields", () => {
    const transaction = Object.freeze({ parent_bucket: "Savings", subcategory: "Investments" });
    assert.deepEqual(toAnalysisCategory(transaction), {
      parent_bucket: "Investments",
      subcategory: "Investments",
    });
    assert.equal(transaction.parent_bucket, "Savings");
    assert.deepEqual(
      toAnalysisCategory({ parent_bucket: "Investments", subcategory: "Investments" }),
      {
        parent_bucket: "Investments",
        subcategory: "Investments",
      },
    );
  });

  it("maps every current intake category while excluding Income from CSP spend", () => {
    for (const [parent_bucket, subcategories] of Object.entries(BUCKET_SUBCATEGORIES)) {
      for (const subcategory of subcategories) {
        const category = { parent_bucket, subcategory };
        if (parent_bucket === "Income") {
          assert.equal(toAnalysisCategory(category), null);
        } else {
          const mapped = toAnalysisCategory(category);
          assert.ok(isAnalysisCategory(mapped));
          if (subcategory !== "Investments") assert.deepEqual(mapped, category);
        }
      }
    }
  });

  it("rejects invalid pairs, aliases, unknown historical categories and unsafe property names", () => {
    for (const category of [
      null,
      undefined,
      [],
      "Fixed Costs",
      {},
      { parent_bucket: "Savings", subcategory: "Investments" },
      { parent_bucket: "Fixed Costs", subcategory: "Dining" },
      { parent_bucket: "Income", subcategory: "Salary" },
      { parent_bucket: "Guilt-Free", subcategory: "Travel" },
      { parent_bucket: "constructor", subcategory: "Rent" },
      { parent_bucket: "__proto__", subcategory: "Rent" },
      { parent_bucket: "Fixed Costs", subcategory: 1 },
      { parent_bucket: " Fixed Costs", subcategory: "Rent" },
    ])
      assert.equal(isAnalysisCategory(category), false);
    assert.equal(toAnalysisCategory({ parent_bucket: "Savings", subcategory: "Rent" }), null);
    assert.equal(
      toAnalysisCategory({ parent_bucket: "Income", subcategory: "Reimbursement" }),
      null,
    );
    assert.equal(toAnalysisCategory(null), null);
  });

  it("validates explicit monthly USD target inputs without coercing amounts or category aliases", () => {
    const target = {
      year_month: "2026-11",
      parent_bucket: "Fixed Costs",
      subcategory: "Rent",
      target_amount: 0,
    };
    assert.ok(isMonthlyBudgetTarget(target));
    assert.ok(isMonthlyBudgetTarget({ ...target, target_amount: 123.45 }));
    assert.ok(isMonthlyBudgetTarget({ ...target, year_month: "2000-02" }));
    assert.ok(
      isMonthlyBudgetTarget({
        ...target,
        parent_bucket: "Investments",
        subcategory: "Investments",
      }),
    );
    for (const target_amount of [-1, NaN, Infinity, -Infinity, "1", null, undefined]) {
      assert.equal(isMonthlyBudgetTarget({ ...target, target_amount }), false);
    }
    for (const year_month of [
      "2026-00",
      "2026-13",
      "2026-1",
      "26-11",
      "2026-11-01",
      "2026-11\n",
      null,
    ]) {
      assert.equal(isMonthlyBudgetTarget({ ...target, year_month }), false);
    }
    assert.equal(
      isMonthlyBudgetTarget({ ...target, parent_bucket: "Savings", subcategory: "Investments" }),
      false,
    );
    assert.equal(isMonthlyBudgetTarget({ ...target, subcategory: "Dining" }), false);
    assert.equal(isMonthlyBudgetTarget(null), false);
  });

  it("keeps benchmark percentage ranges distinct from owner monthly dollar targets", () => {
    assert.deepEqual(CSP_BENCHMARKS, {
      "Fixed Costs": { min_percent: 50, max_percent: 60 },
      Investments: { min_percent: 10, max_percent: null },
      Savings: { min_percent: 5, max_percent: 10 },
      "Guilt-Free": { min_percent: 20, max_percent: 35 },
    });
    for (const range of Object.values(CSP_BENCHMARKS)) {
      assert.equal(isMonthlyBudgetTarget(range), false);
    }
  });

  it("aligns one unset card preference per analysis category with no invented wallet", () => {
    const categories = Object.entries(ANALYSIS_BUCKET_SUBCATEGORIES).flatMap(
      ([parent_bucket, subcategories]) =>
        subcategories.map((subcategory) => ({ parent_bucket, subcategory })),
    );
    assert.deepEqual(
      CATEGORY_CARD_PREFERENCES.map(({ preferred_card: _, ...category }) => category),
      categories,
    );
    assert.equal(
      categories.length,
      Object.values(BUCKET_SUBCATEGORIES).flat().length - BUCKET_SUBCATEGORIES.Income.length,
    );
    for (const preference of CATEGORY_CARD_PREFERENCES) {
      assert.ok(isAnalysisCategory(preference));
      assert.equal(preference.preferred_card, null);
    }
    assert.deepEqual(ANALYSIS_BUCKET_SUBCATEGORIES.Savings, ["Emergency Fund", "Travel Fund"]);
  });
});

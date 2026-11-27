import {
  ANALYSIS_BUCKET_SUBCATEGORIES,
  type AnalysisBucket,
  toAnalysisCategory,
} from "../../src/config/budget-profile.ts";

export interface AggregatedCategoryRow {
  parent_bucket: string;
  subcategory: string;
  net_spend: number;
  transaction_count: number;
}

export interface MonthlyBudgetRow {
  id: string;
  year_month: string;
  parent_bucket: string;
  subcategory: string;
  target_amount: number;
}

export interface MonthlyBucketSummary {
  parent_bucket: AnalysisBucket;
  net_spend: number;
  target_amount: number;
  variance: number;
  utilization_percent: number | null;
  transaction_count: number;
}

export interface UnrecognizedCategorySpend {
  parent_bucket: string;
  subcategory: string;
  net_spend: number;
  transaction_count: number;
}

export interface GuiltFreePacing {
  target_amount: number;
  net_spend: number;
  remaining_allowance: number;
  days_in_month: number;
  days_remaining: number;
  daily_burn_rate: number | null;
}

export interface MonthlyAnalysisResponse {
  month: string;
  currency: "USD";
  total_net_spend: number;
  total_target_amount: number;
  buckets: MonthlyBucketSummary[];
  guilt_free_pacing: GuiltFreePacing;
  excluded_income: {
    net_spend: number;
    transaction_count: number;
  };
  unrecognized_categories: UnrecognizedCategorySpend[];
}

export interface CategoryBreakdownItem {
  parent_bucket: AnalysisBucket;
  subcategory: string;
  net_spend: number;
  target_amount: number;
  variance: number;
  utilization_percent: number | null;
  transaction_count: number;
}

export interface CategoryBreakdownResponse {
  month: string;
  currency: "USD";
  bucket: AnalysisBucket;
  net_spend: number;
  target_amount: number;
  variance: number;
  utilization_percent: number | null;
  transaction_count: number;
  categories: CategoryBreakdownItem[];
  unrecognized_categories: UnrecognizedCategorySpend[];
}

const ANALYSIS_BUCKET_ORDER: readonly AnalysisBucket[] = [
  "Fixed Costs",
  "Investments",
  "Savings",
  "Guilt-Free",
];

const YEAR_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Rounds a currency or percentage value to two decimal places symmetrically without -0. */
export function roundCents(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const rounded = (sign * Math.round((Math.abs(value) + Number.EPSILON) * 100)) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/** Validates an optional YYYY-MM month query param, defaulting to the current UTC month. */
export function parseAnalysisMonth(rawMonth: string | null, now: Date = new Date()): string | null {
  if (rawMonth === null) {
    return now.toISOString().slice(0, 7);
  }
  const trimmed = rawMonth.trim();
  return YEAR_MONTH_PATTERN.test(trimmed) ? trimmed : null;
}

/** Validates a required AnalysisBucket query param. */
export function parseAnalysisBucket(rawBucket: string | null): AnalysisBucket | null {
  if (rawBucket === null) {
    return null;
  }
  const trimmed = rawBucket.trim();
  if (!Object.hasOwn(ANALYSIS_BUCKET_SUBCATEGORIES, trimmed)) {
    return null;
  }
  return trimmed as AnalysisBucket;
}

/** Computes total days and inclusive remaining UTC days in a YYYY-MM calendar month. */
export function getDaysRemainingInMonth(
  yearMonth: string,
  now: Date = new Date(),
): { daysInMonth: number; daysRemaining: number } {
  const [year, month] = yearMonth.split("-").map(Number);
  const monthEnd = new Date(0);
  monthEnd.setUTCFullYear(year, month, 0);
  const daysInMonth = monthEnd.getUTCDate();
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth() + 1;
  const currentDay = now.getUTCDate();

  if (year < currentYear || (year === currentYear && month < currentMonth)) {
    return { daysInMonth, daysRemaining: 0 };
  }
  if (year > currentYear || (year === currentYear && month > currentMonth)) {
    return { daysInMonth, daysRemaining: daysInMonth };
  }
  return {
    daysInMonth,
    daysRemaining: daysInMonth - currentDay + 1,
  };
}

/** Computes utilization percentage or null when target_amount is zero or negative. */
export function computeUtilizationPercent(netSpend: number, targetAmount: number): number | null {
  if (targetAmount <= 0) {
    return null;
  }
  return roundCents((netSpend / targetAmount) * 100);
}

function recordUnrecognizedSpend(
  store: Map<string, UnrecognizedCategorySpend>,
  row: AggregatedCategoryRow,
): void {
  const key = `${row.parent_bucket}\0${row.subcategory}`;
  const existing = store.get(key);
  if (existing) {
    existing.net_spend = roundCents(existing.net_spend + row.net_spend);
    existing.transaction_count += row.transaction_count;
    return;
  }
  store.set(key, {
    parent_bucket: row.parent_bucket,
    subcategory: row.subcategory,
    net_spend: roundCents(row.net_spend),
    transaction_count: row.transaction_count,
  });
}

/** Computes monthly CSP bucket totals, target variances, pacing, and out-of-taxonomy exclusions. */
export function buildMonthlyAnalysis(input: {
  month: string;
  transactionRows: readonly AggregatedCategoryRow[];
  budgetRows: readonly MonthlyBudgetRow[];
  now?: Date;
}): MonthlyAnalysisResponse {
  const bucketTotals = new Map<
    AnalysisBucket,
    { netSpend: number; targetAmount: number; transactionCount: number }
  >(
    ANALYSIS_BUCKET_ORDER.map((bucket) => [
      bucket,
      { netSpend: 0, targetAmount: 0, transactionCount: 0 },
    ]),
  );
  const unrecognized = new Map<string, UnrecognizedCategorySpend>();
  let excludedIncomeSpend = 0;
  let excludedIncomeCount = 0;

  for (const row of input.transactionRows) {
    const mapped = toAnalysisCategory(row);
    if (mapped) {
      const entry = bucketTotals.get(mapped.parent_bucket);
      if (entry) {
        entry.netSpend += Number(row.net_spend);
        entry.transactionCount += Number(row.transaction_count);
      }
      continue;
    }
    if (row.parent_bucket === "Income") {
      excludedIncomeSpend += Number(row.net_spend);
      excludedIncomeCount += Number(row.transaction_count);
      continue;
    }
    recordUnrecognizedSpend(unrecognized, {
      ...row,
      net_spend: Number(row.net_spend),
      transaction_count: Number(row.transaction_count),
    });
  }

  for (const budgetRow of input.budgetRows) {
    const mapped = toAnalysisCategory(budgetRow);
    if (!mapped) {
      continue;
    }
    const entry = bucketTotals.get(mapped.parent_bucket);
    if (entry) {
      entry.targetAmount += Number(budgetRow.target_amount);
    }
  }

  const buckets: MonthlyBucketSummary[] = ANALYSIS_BUCKET_ORDER.map((bucket) => {
    const entry = bucketTotals.get(bucket) ?? { netSpend: 0, targetAmount: 0, transactionCount: 0 };
    const netSpend = roundCents(entry.netSpend);
    const targetAmount = roundCents(entry.targetAmount);
    return {
      parent_bucket: bucket,
      net_spend: netSpend,
      target_amount: targetAmount,
      variance: roundCents(targetAmount - netSpend),
      utilization_percent: computeUtilizationPercent(netSpend, targetAmount),
      transaction_count: entry.transactionCount,
    };
  });

  const totalNetSpend = roundCents(buckets.reduce((sum, bucket) => sum + bucket.net_spend, 0));
  const totalTargetAmount = roundCents(
    buckets.reduce((sum, bucket) => sum + bucket.target_amount, 0),
  );
  const guiltFree = buckets.find((bucket) => bucket.parent_bucket === "Guilt-Free") ?? {
    target_amount: 0,
    net_spend: 0,
  };
  const remainingAllowance = roundCents(guiltFree.target_amount - guiltFree.net_spend);
  const { daysInMonth, daysRemaining } = getDaysRemainingInMonth(input.month, input.now);

  return {
    month: input.month,
    currency: "USD",
    total_net_spend: totalNetSpend,
    total_target_amount: totalTargetAmount,
    buckets,
    guilt_free_pacing: {
      target_amount: guiltFree.target_amount,
      net_spend: guiltFree.net_spend,
      remaining_allowance: remainingAllowance,
      days_in_month: daysInMonth,
      days_remaining: daysRemaining,
      daily_burn_rate: daysRemaining > 0 ? roundCents(remainingAllowance / daysRemaining) : null,
    },
    excluded_income: {
      net_spend: roundCents(excludedIncomeSpend),
      transaction_count: excludedIncomeCount,
    },
    unrecognized_categories: Array.from(unrecognized.values()),
  };
}

/** Computes subcategory breakdown and targets for a single CSP analysis bucket. */
export function buildCategoryBreakdown(input: {
  month: string;
  bucket: AnalysisBucket;
  transactionRows: readonly AggregatedCategoryRow[];
  budgetRows: readonly MonthlyBudgetRow[];
}): CategoryBreakdownResponse {
  const bySubcategory = new Map<
    string,
    { netSpend: number; targetAmount: number; transactionCount: number }
  >();
  const unrecognized = new Map<string, UnrecognizedCategorySpend>();

  for (const row of input.transactionRows) {
    const mapped = toAnalysisCategory(row);
    if (mapped) {
      if (mapped.parent_bucket !== input.bucket) {
        continue;
      }
      const existing = bySubcategory.get(mapped.subcategory) ?? {
        netSpend: 0,
        targetAmount: 0,
        transactionCount: 0,
      };
      existing.netSpend += Number(row.net_spend);
      existing.transactionCount += Number(row.transaction_count);
      bySubcategory.set(mapped.subcategory, existing);
      continue;
    }
    if (row.parent_bucket === input.bucket) {
      recordUnrecognizedSpend(unrecognized, {
        ...row,
        net_spend: Number(row.net_spend),
        transaction_count: Number(row.transaction_count),
      });
    }
  }

  for (const budgetRow of input.budgetRows) {
    const mapped = toAnalysisCategory(budgetRow);
    if (!mapped || mapped.parent_bucket !== input.bucket) {
      continue;
    }
    const existing = bySubcategory.get(mapped.subcategory) ?? {
      netSpend: 0,
      targetAmount: 0,
      transactionCount: 0,
    };
    existing.targetAmount += Number(budgetRow.target_amount);
    bySubcategory.set(mapped.subcategory, existing);
  }

  const categories: CategoryBreakdownItem[] = Array.from(bySubcategory.entries())
    .map(([subcategory, entry]) => {
      const netSpend = roundCents(entry.netSpend);
      const targetAmount = roundCents(entry.targetAmount);
      return {
        parent_bucket: input.bucket,
        subcategory,
        net_spend: netSpend,
        target_amount: targetAmount,
        variance: roundCents(targetAmount - netSpend),
        utilization_percent: computeUtilizationPercent(netSpend, targetAmount),
        transaction_count: entry.transactionCount,
      };
    })
    .sort(
      (a, b) => b.net_spend - a.net_spend || a.subcategory.localeCompare(b.subcategory, "en-US"),
    );

  const totalNetSpend = roundCents(categories.reduce((sum, item) => sum + item.net_spend, 0));
  const totalTargetAmount = roundCents(
    categories.reduce((sum, item) => sum + item.target_amount, 0),
  );
  const totalCount = categories.reduce((sum, item) => sum + item.transaction_count, 0);

  return {
    month: input.month,
    currency: "USD",
    bucket: input.bucket,
    net_spend: totalNetSpend,
    target_amount: totalTargetAmount,
    variance: roundCents(totalTargetAmount - totalNetSpend),
    utilization_percent: computeUtilizationPercent(totalNetSpend, totalTargetAmount),
    transaction_count: totalCount,
    categories,
    unrecognized_categories: Array.from(unrecognized.values()),
  };
}

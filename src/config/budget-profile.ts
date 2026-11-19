import { BUCKET_SUBCATEGORIES } from "./intake.ts";

/** Analysis-only taxonomy. Intake and persisted transaction categories remain unchanged. */
export const ANALYSIS_BUCKET_SUBCATEGORIES = {
  "Fixed Costs": BUCKET_SUBCATEGORIES["Fixed Costs"],
  Savings: BUCKET_SUBCATEGORIES.Savings.filter((category) => category !== "Investments"),
  Investments: ["Investments"],
  "Guilt-Free": BUCKET_SUBCATEGORIES["Guilt-Free"],
} as const;

export type AnalysisBucket = keyof typeof ANALYSIS_BUCKET_SUBCATEGORIES;
export type AnalysisCategory = {
  [Bucket in AnalysisBucket]: {
    parent_bucket: Bucket;
    subcategory: (typeof ANALYSIS_BUCKET_SUBCATEGORIES)[Bucket][number];
  };
}[AnalysisBucket];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isAnalysisCategory(value: unknown): value is AnalysisCategory {
  if (!isRecord(value) || typeof value.parent_bucket !== "string") return false;
  if (!Object.hasOwn(ANALYSIS_BUCKET_SUBCATEGORIES, value.parent_bucket)) return false;
  const subcategories: readonly string[] =
    ANALYSIS_BUCKET_SUBCATEGORIES[value.parent_bucket as AnalysisBucket];
  return typeof value.subcategory === "string" && subcategories.includes(value.subcategory);
}

/** Returns a new analysis pair, or null for Income and unrecognized categories. */
export function toAnalysisCategory(value: unknown): AnalysisCategory | null {
  if (isAnalysisCategory(value)) {
    return {
      parent_bucket: value.parent_bucket,
      subcategory: value.subcategory,
    } as AnalysisCategory;
  }
  if (isRecord(value) && value.parent_bucket === "Savings" && value.subcategory === "Investments") {
    return { parent_bucket: "Investments", subcategory: "Investments" };
  }
  return null;
}

/** A caller-validated target input; IDs and persistence timestamps are separate. */
export type MonthlyBudgetTarget = AnalysisCategory & {
  year_month: string;
  target_amount: number;
};

export function isMonthlyBudgetTarget(value: unknown): value is MonthlyBudgetTarget {
  return (
    isRecord(value) &&
    typeof value.year_month === "string" &&
    /^\d{4}-(0[1-9]|1[0-2])$/.test(value.year_month) &&
    value.year_month.length === 7 &&
    typeof value.target_amount === "number" &&
    Number.isFinite(value.target_amount) &&
    value.target_amount >= 0 &&
    isAnalysisCategory(value)
  );
}

/** Percent of net take-home pay, not configured monthly dollar targets. */
export const CSP_BENCHMARKS = {
  "Fixed Costs": { min_percent: 50, max_percent: 60 },
  Investments: { min_percent: 10, max_percent: null },
  Savings: { min_percent: 5, max_percent: 10 },
  "Guilt-Free": { min_percent: 20, max_percent: 35 },
} as const satisfies Record<AnalysisBucket, { min_percent: number; max_percent: number | null }>;

/** Null means no routing hint. Real preferences must come from the owner. */
export const CATEGORY_CARD_PREFERENCES = Object.entries(ANALYSIS_BUCKET_SUBCATEGORIES).flatMap(
  ([parent_bucket, subcategories]) =>
    subcategories.map((subcategory) => ({ parent_bucket, subcategory, preferred_card: null })),
);

import aggregateCategoryBreakdownQuery from "../../../queries/aggregate_category_breakdown.sql";
import selectMonthlyBudgetsQuery from "../../../queries/select_monthly_budgets.sql";
import {
  type AggregatedCategoryRow,
  buildCategoryBreakdown,
  type MonthlyBudgetRow,
  parseAnalysisBucket,
  parseAnalysisMonth,
} from "../analysis-helpers.ts";
import { validateBearerToken } from "../auth.ts";
import { logger } from "../logger.ts";

interface Env {
  DB: D1Database;
  API_BEARER_TOKEN?: string;
}

/** Handles GET /api/analysis/categories requests for per-bucket subcategory breakdown. */
export async function handleGet(
  request: Request,
  db: D1Database,
  expectedToken?: string,
  now: Date = new Date(),
  breakdownQuery: string = aggregateCategoryBreakdownQuery,
  budgetsQuery: string = selectMonthlyBudgetsQuery,
): Promise<Response> {
  const authResponse = await validateBearerToken(request, expectedToken);
  if (authResponse) {
    return authResponse;
  }

  const url = new URL(request.url);
  const month = parseAnalysisMonth(url.searchParams.get("month"), now);
  if (!month) {
    return Response.json({ error: "Invalid month. Expected YYYY-MM format" }, { status: 400 });
  }

  const bucket = parseAnalysisBucket(url.searchParams.get("bucket"));
  if (!bucket) {
    return Response.json(
      {
        error:
          "Invalid or missing bucket. Expected one of: Fixed Costs, Investments, Savings, Guilt-Free",
      },
      { status: 400 },
    );
  }

  try {
    const [txResult, budgetResult] = await Promise.all([
      db.prepare(breakdownQuery).bind(month, bucket).all<AggregatedCategoryRow>(),
      db.prepare(budgetsQuery).bind(month).all<MonthlyBudgetRow>(),
    ]);

    const payload = buildCategoryBreakdown({
      month,
      bucket,
      transactionRows: txResult?.results ?? [],
      budgetRows: budgetResult?.results ?? [],
    });
    return Response.json(payload);
  } catch (error) {
    logger.error("Category breakdown retrieval failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return Response.json(
      { error: "Database error during category breakdown retrieval" },
      { status: 500 },
    );
  }
}

/** Cloudflare Pages Function entrypoint for GET /api/analysis/categories. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  return handleGet(request, env.DB, env.API_BEARER_TOKEN);
};

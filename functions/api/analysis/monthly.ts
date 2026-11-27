import aggregateMonthlyBucketsQuery from "../../../queries/aggregate_monthly_buckets.sql";
import selectMonthlyBudgetsQuery from "../../../queries/select_monthly_budgets.sql";
import {
  type AggregatedCategoryRow,
  buildMonthlyAnalysis,
  type MonthlyBudgetRow,
  parseAnalysisMonth,
} from "../analysis-helpers.ts";
import { validateBearerToken } from "../auth.ts";
import { logger } from "../logger.ts";

interface Env {
  DB: D1Database;
  API_BEARER_TOKEN?: string;
}

/** Handles GET /api/analysis/monthly requests for CSP bucket aggregation and pacing. */
export async function handleGet(
  request: Request,
  db: D1Database,
  expectedToken?: string,
  now: Date = new Date(),
  bucketsQuery: string = aggregateMonthlyBucketsQuery,
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

  try {
    const [txResult, budgetResult] = await Promise.all([
      db.prepare(bucketsQuery).bind(month).all<AggregatedCategoryRow>(),
      db.prepare(budgetsQuery).bind(month).all<MonthlyBudgetRow>(),
    ]);

    const payload = buildMonthlyAnalysis({
      month,
      transactionRows: txResult?.results ?? [],
      budgetRows: budgetResult?.results ?? [],
      now,
    });
    return Response.json(payload);
  } catch (error) {
    logger.error("Monthly analysis retrieval failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return Response.json(
      { error: "Database error during monthly analysis retrieval" },
      { status: 500 },
    );
  }
}

/** Cloudflare Pages Function entrypoint for GET /api/analysis/monthly. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  return handleGet(request, env.DB, env.API_BEARER_TOKEN);
};

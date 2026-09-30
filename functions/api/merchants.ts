import selectFrequentMerchantsQuery from "../../queries/select_frequent_merchants.sql";
import { validateBearerToken } from "./auth.ts";
import { logger } from "./logger.ts";
import { parseLimit } from "./query.ts";

interface Env {
  DB: D1Database;
  API_BEARER_TOKEN?: string;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Handles GET requests to retrieve distinct frequent merchants ordered by frequency and recency.
 */
export async function handleGet(
  request: Request,
  db: D1Database,
  expectedToken?: string,
): Promise<Response> {
  const authResponse = await validateBearerToken(request, expectedToken);
  if (authResponse) {
    return authResponse;
  }

  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get("limit"), DEFAULT_LIMIT, MAX_LIMIT);

  try {
    const { results } = await db
      .prepare(selectFrequentMerchantsQuery)
      .bind(limit)
      .all<{ merchant: string }>();
    const merchants = (results ?? []).map((row) => row.merchant);
    return Response.json({ merchants });
  } catch (error) {
    logger.error("Merchant retrieval failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return Response.json({ error: "Database error during merchant retrieval" }, { status: 500 });
  }
}

/**
 * Cloudflare Pages Function entrypoint for GET /api/merchants.
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  return handleGet(request, env.DB, env.API_BEARER_TOKEN);
};

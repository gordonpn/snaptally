import countTransactionsQuery from "../../queries/count_transactions.sql";
import insertTransactionQuery from "../../queries/insert_transaction.sql";
import selectDistinctMerchantsQuery from "../../queries/select_distinct_merchants.sql";
import selectMonthSummaryQuery from "../../queries/select_month_summary.sql";
import selectPaginatedTransactionsQuery from "../../queries/select_paginated_transactions.sql";
import { isValidDate } from "../../src/utils/date.ts";
import { validateBearerToken } from "./auth.ts";
import { logger } from "./logger.ts";
import { parseLimit, parseOffset } from "./query.ts";

export { isValidDate };

interface Env {
  DB: D1Database;
  API_BEARER_TOKEN?: string;
}

export interface TransactionPayload {
  id?: string;
  date: string;
  card: string;
  parent_bucket: string;
  subcategory: string;
  merchant: string;
  gross_amount: number;
  reimbursement?: number;
  currency?: string;
}

export interface TransactionRecord {
  id: string;
  date: string;
  card: string;
  parent_bucket: string;
  subcategory: string;
  merchant: string;
  gross_amount: number;
  reimbursement: number;
  net_spend: number;
  currency: string;
  created_at: string;
}

/**
 * Trims leading/trailing whitespace, collapses consecutive internal spaces,
 * standardizes smart/curly quotes, and applies Unicode NFC normalization.
 */
export function normalizeText(value: string): string {
  return value
    .normalize("NFC")
    .trim()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, " ");
}

/**
 * Converts a string to Title Case while preserving apostrophes.
 */
export function toTitleCase(value: string): string {
  const normalized = normalizeText(value);
  if (!normalized) return "";

  return normalized
    .toLowerCase()
    .split(" ")
    .map((word) => {
      if (word.length === 0) return "";
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

/**
 * Strips whitespace, symbols, and punctuation into a lowercase alphanumeric key,
 * preserving Unicode letters and numbers across scripts.
 */
export function toAlphanumericKey(value: string): string {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/**
 * Resolves merchant name against existing records in D1.
 * If an existing merchant matches the alphanumeric key (for example "trader joes" matches "Trader Joe's"),
 * returns the existing canonical string with standardized whitespace and apostrophes.
 * Otherwise, returns the Title Case normalized string.
 */
export async function resolveMerchant(
  db: D1Database,
  query: string,
  inputMerchant: string,
): Promise<string> {
  const normalizedInput = normalizeText(inputMerchant);
  const targetKey = toAlphanumericKey(normalizedInput);
  if (!targetKey) {
    return toTitleCase(normalizedInput);
  }

  const { results } = await db.prepare(query).all<{ merchant: string }>();
  if (results && results.length > 0) {
    for (const row of results) {
      if (toAlphanumericKey(row.merchant) === targetKey) {
        return normalizeText(row.merchant);
      }
    }
  }

  return toTitleCase(normalizedInput);
}

/**
 * Validates that an incoming payload conforms to the TransactionPayload interface.
 */
export function isValidPayload(body: unknown): body is TransactionPayload {
  if (typeof body !== "object" || body === null) {
    logger.warn("Validation failed: body must be a non-null object");
    return false;
  }

  const {
    id,
    date,
    card,
    parent_bucket,
    subcategory,
    merchant,
    gross_amount,
    reimbursement,
    currency,
  } = body as Record<string, unknown>;

  if (id !== undefined && (typeof id !== "string" || id.trim().length === 0)) {
    logger.warn("Validation failed: id must be a non-empty string if provided");
    return false;
  }

  if (typeof date !== "string" || !isValidDate(date)) {
    logger.warn("Validation failed: date must be a valid YYYY-MM-DD string");
    return false;
  }

  if (typeof gross_amount !== "number" || !Number.isFinite(gross_amount) || gross_amount === 0) {
    logger.warn("Validation failed: gross_amount must be a non-zero finite number");
    return false;
  }

  if (
    reimbursement !== undefined &&
    reimbursement !== null &&
    (typeof reimbursement !== "number" || !Number.isFinite(reimbursement) || reimbursement < 0)
  ) {
    logger.warn(
      "Validation failed: reimbursement must be a non-negative finite number if provided",
    );
    return false;
  }

  if (gross_amount < 0 && typeof reimbursement === "number" && reimbursement !== 0) {
    logger.warn("Validation failed: refunds (negative gross_amount) cannot have a reimbursement");
    return false;
  }

  if (gross_amount > 0 && typeof reimbursement === "number" && reimbursement > gross_amount) {
    logger.warn("Validation failed: reimbursement cannot exceed gross_amount");
    return false;
  }

  if (typeof card !== "string" || card.trim().length === 0) {
    logger.warn("Validation failed: card must be a non-empty string");
    return false;
  }

  if (typeof parent_bucket !== "string" || parent_bucket.trim().length === 0) {
    logger.warn("Validation failed: parent_bucket must be a non-empty string");
    return false;
  }

  if (normalizeText(parent_bucket) === "Income" && gross_amount < 0) {
    logger.warn("Validation failed: Income gross_amount must be positive");
    return false;
  }

  if (typeof subcategory !== "string" || subcategory.trim().length === 0) {
    logger.warn("Validation failed: subcategory must be a non-empty string");
    return false;
  }

  if (typeof merchant !== "string" || merchant.trim().length === 0) {
    logger.warn("Validation failed: merchant must be a non-empty string");
    return false;
  }

  if (currency !== undefined && (typeof currency !== "string" || currency.trim().length === 0)) {
    logger.warn("Validation failed: currency must be a non-empty string if provided");
    return false;
  }

  return true;
}

/**
 * Handles incoming POST requests to validate, normalize, canonicalize, and persist transactions in D1.
 */
export async function handlePost(
  request: Request,
  db: D1Database,
  insertQuery: string,
  expectedToken?: string,
  selectMerchantsQuery: string = selectDistinctMerchantsQuery,
): Promise<Response> {
  const authResponse = await validateBearerToken(request, expectedToken);
  if (authResponse) {
    return authResponse;
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Malformed JSON payload" }, { status: 400 });
  }

  if (!isValidPayload(body)) {
    return Response.json(
      {
        error:
          "Invalid payload. Required fields: date (YYYY-MM-DD), card (string), parent_bucket (string), subcategory (string), merchant (string), gross_amount (non-zero number); optional: reimbursement (non-negative number), currency (string)",
      },
      { status: 400 },
    );
  }

  const transactionId =
    typeof body.id === "string" && body.id.trim().length > 0 ? body.id.trim() : crypto.randomUUID();
  const normalizedDate = body.date.trim();
  const normalizedCard = normalizeText(body.card);
  const normalizedParentBucket = normalizeText(body.parent_bucket);
  const normalizedSubcategory = normalizeText(body.subcategory);
  const reimbursement = typeof body.reimbursement === "number" ? body.reimbursement : 0.0;
  const currency =
    typeof body.currency === "string" && body.currency.trim().length > 0
      ? body.currency.trim().toUpperCase()
      : "USD";

  let canonicalMerchant: string;
  try {
    canonicalMerchant = await resolveMerchant(db, selectMerchantsQuery, body.merchant);
  } catch (error) {
    logger.error("Merchant canonical resolution failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return Response.json({ error: "Database error during merchant resolution" }, { status: 500 });
  }

  try {
    await db
      .prepare(insertQuery)
      .bind(
        transactionId,
        normalizedDate,
        normalizedCard,
        normalizedParentBucket,
        normalizedSubcategory,
        canonicalMerchant,
        body.gross_amount,
        reimbursement,
        currency,
      )
      .run();

    return Response.json({ ok: true, id: transactionId }, { status: 201 });
  } catch (error) {
    logger.error("Transaction insertion failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return Response.json({ error: "Database insertion failed" }, { status: 500 });
  }
}

/**
 * Cloudflare Pages Function entrypoint for POST /api/transactions.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  return handlePost(
    request,
    env.DB,
    insertTransactionQuery,
    env.API_BEARER_TOKEN,
    selectDistinctMerchantsQuery,
  );
};

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export interface MonthSummary {
  month: string;
  net_spend: number;
  total_count: number;
}

export interface PaginatedTransactionsResponse {
  transactions: TransactionRecord[];
  total_count: number;
  has_more: boolean;
  next_offset: number | null;
  month_summary?: MonthSummary;
}

/**
 * Handles GET requests to retrieve paginated, filtered transactions and month summary.
 */
export async function handleGet(
  request: Request,
  db: D1Database,
  expectedToken?: string,
  selectQuery: string = selectPaginatedTransactionsQuery,
  countQuery: string = countTransactionsQuery,
  monthSummaryQuery: string = selectMonthSummaryQuery,
): Promise<Response> {
  const authResponse = await validateBearerToken(request, expectedToken);
  if (authResponse) {
    return authResponse;
  }

  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get("limit"), DEFAULT_LIMIT, MAX_LIMIT);
  const offset = parseOffset(url.searchParams.get("offset"));
  const rawSearch = url.searchParams.get("search");
  const search = rawSearch && rawSearch.trim().length > 0 ? rawSearch.trim() : null;
  const rawBucket = url.searchParams.get("bucket");
  const bucket = rawBucket && rawBucket.trim().length > 0 ? rawBucket.trim() : null;

  const rawMonth = url.searchParams.get("month");
  const targetMonth =
    rawMonth && /^\d{4}-\d{2}$/.test(rawMonth.trim())
      ? rawMonth.trim()
      : new Date().toISOString().slice(0, 7);

  try {
    const [countResult, transactionsResult, monthResult] = await Promise.all([
      db.prepare(countQuery).bind(search, bucket).first<{ total: number }>(),
      db.prepare(selectQuery).bind(search, bucket, limit, offset).all<TransactionRecord>(),
      db.prepare(monthSummaryQuery).bind(targetMonth).first<{
        month_net_spend: number;
        month_count: number;
      }>(),
    ]);

    const totalCount = countResult?.total ?? 0;
    const transactions = transactionsResult?.results ?? [];
    const hasMore = offset + transactions.length < totalCount;
    const nextOffset = hasMore ? offset + transactions.length : null;

    const responsePayload: PaginatedTransactionsResponse = {
      transactions,
      total_count: totalCount,
      has_more: hasMore,
      next_offset: nextOffset,
      month_summary: {
        month: targetMonth,
        net_spend: Number(monthResult?.month_net_spend ?? 0),
        total_count: Number(monthResult?.month_count ?? 0),
      },
    };

    return Response.json(responsePayload);
  } catch (error) {
    logger.error("Recent transactions retrieval failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return Response.json(
      { error: "Database error during transactions retrieval" },
      { status: 500 },
    );
  }
}

/**
 * Cloudflare Pages Function entrypoint for GET /api/transactions.
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  return handleGet(request, env.DB, env.API_BEARER_TOKEN);
};

import insertTransactionQuery from "../../queries/insert_transaction.sql";
import selectDistinctMerchantsQuery from "../../queries/select_distinct_merchants.sql";
import { validateBearerToken } from "./auth.ts";
import { logger } from "./logger.ts";

interface Env {
  DB: D1Database;
  API_BEARER_TOKEN?: string;
}

export interface TransactionPayload {
  date: string;
  card: string;
  parent_bucket: string;
  subcategory: string;
  merchant: string;
  gross_amount: number;
  reimbursement?: number;
}

/**
 * Validates that a string is a valid calendar date in YYYY-MM-DD format.
 */
export function isValidDate(dateStr: string): boolean {
  const trimmed = dateStr.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return false;
  }
  const [year, month, day] = trimmed.split("-").map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
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

  const { date, card, parent_bucket, subcategory, merchant, gross_amount, reimbursement } =
    body as Record<string, unknown>;

  if (typeof date !== "string" || !isValidDate(date)) {
    logger.warn("Validation failed: date must be a valid YYYY-MM-DD string");
    return false;
  }

  if (typeof gross_amount !== "number" || !Number.isFinite(gross_amount) || gross_amount <= 0) {
    logger.warn("Validation failed: gross_amount must be a positive finite number");
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

  if (typeof card !== "string" || card.trim().length === 0) {
    logger.warn("Validation failed: card must be a non-empty string");
    return false;
  }

  if (typeof parent_bucket !== "string" || parent_bucket.trim().length === 0) {
    logger.warn("Validation failed: parent_bucket must be a non-empty string");
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
          "Invalid payload. Required fields: date (YYYY-MM-DD), card (string), parent_bucket (string), subcategory (string), merchant (string), gross_amount (positive number); optional: reimbursement (non-negative number)",
      },
      { status: 400 },
    );
  }

  const id = crypto.randomUUID();
  const normalizedDate = body.date.trim();
  const normalizedCard = normalizeText(body.card);
  const normalizedParentBucket = normalizeText(body.parent_bucket);
  const normalizedSubcategory = normalizeText(body.subcategory);
  const reimbursement = typeof body.reimbursement === "number" ? body.reimbursement : 0.0;

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
        id,
        normalizedDate,
        normalizedCard,
        normalizedParentBucket,
        normalizedSubcategory,
        canonicalMerchant,
        body.gross_amount,
        reimbursement,
      )
      .run();

    return Response.json({ ok: true, id }, { status: 201 });
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

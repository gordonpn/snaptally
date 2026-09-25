import insertTransactionQuery from "../../queries/insert_transaction.sql";
import selectDistinctMerchantsQuery from "../../queries/select_distinct_merchants.sql";

interface Env {
  DB: D1Database;
}

export interface TransactionPayload {
  amount: number;
  card: string;
  category: string;
  merchant: string;
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
 * Strips whitespace, symbols, and punctuation into a lowercase alphanumeric key.
 */
export function toAlphanumericKey(value: string): string {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Resolves merchant name against existing records in D1.
 * If an existing merchant matches the alphanumeric key (e.g. "trader joes" matches "Trader Joe's"),
 * returns the existing canonical string. Otherwise, returns the Title Case normalized string.
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

  try {
    const { results } = await db.prepare(query).all<{ merchant: string }>();
    if (results && results.length > 0) {
      for (const row of results) {
        if (toAlphanumericKey(row.merchant) === targetKey) {
          return row.merchant;
        }
      }
    }
  } catch (error) {
    // If selecting distinct merchants fails, fallback to title casing without breaking insertion
    console.error("Merchant canonical resolution lookup failed", error);
  }

  return toTitleCase(normalizedInput);
}

export function isValidPayload(body: unknown): body is TransactionPayload {
  if (typeof body !== "object" || body === null) {
    console.warn("Validation failed: body must be a non-null object");
    return false;
  }

  const { amount, card, category, merchant } = body as Record<string, unknown>;

  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    console.warn("Validation failed: amount must be a positive finite number");
    return false;
  }

  if (typeof card !== "string" || card.trim().length === 0) {
    console.warn("Validation failed: card must be a non-empty string");
    return false;
  }

  if (typeof category !== "string" || category.trim().length === 0) {
    console.warn("Validation failed: category must be a non-empty string");
    return false;
  }

  if (typeof merchant !== "string" || merchant.trim().length === 0) {
    console.warn("Validation failed: merchant must be a non-empty string");
    return false;
  }

  return true;
}

export async function handlePost(
  request: Request,
  db: D1Database,
  insertQuery: string,
  selectMerchantsQuery: string = selectDistinctMerchantsQuery,
): Promise<Response> {
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
          "Invalid payload. Required fields: amount (positive number), card (string), category (string), merchant (string)",
      },
      { status: 400 },
    );
  }

  const id = crypto.randomUUID();
  const normalizedCard = normalizeText(body.card);
  const normalizedCategory = normalizeText(body.category);
  const canonicalMerchant = await resolveMerchant(db, selectMerchantsQuery, body.merchant);

  try {
    await db
      .prepare(insertQuery)
      .bind(id, body.amount, normalizedCard, normalizedCategory, canonicalMerchant)
      .run();

    return Response.json({ ok: true, id }, { status: 201 });
  } catch (error) {
    console.error("Transaction insertion failed", error);
    return Response.json({ error: "Database insertion failed" }, { status: 500 });
  }
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  return handlePost(request, env.DB, insertTransactionQuery, selectDistinctMerchantsQuery);
};

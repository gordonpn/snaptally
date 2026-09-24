import insertTransactionQuery from "../../queries/insert_transaction.sql";

interface Env {
  DB: D1Database;
}

export interface TransactionPayload {
  amount: number;
  card: string;
  category: string;
  merchant: string;
}

export function isValidPayload(body: unknown): body is TransactionPayload {
  if (typeof body !== "object" || body === null) {
    return false;
  }

  const { amount, card, category, merchant } = body as Record<string, unknown>;

  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    return false;
  }

  if (typeof card !== "string" || card.trim().length === 0) {
    return false;
  }

  if (typeof category !== "string" || category.trim().length === 0) {
    return false;
  }

  if (typeof merchant !== "string" || merchant.trim().length === 0) {
    return false;
  }

  return true;
}

export async function handlePost(
  request: Request,
  db: D1Database,
  query: string,
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

  try {
    await db
      .prepare(query)
      .bind(id, body.amount, body.card.trim(), body.category.trim(), body.merchant.trim())
      .run();

    return Response.json({ ok: true, id }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Database insertion failed";
    return Response.json({ error: message }, { status: 500 });
  }
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  return handlePost(request, env.DB, insertTransactionQuery);
};

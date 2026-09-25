import { logger } from "./logger.ts";

export async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  if (a.length === 0 || b.length === 0) {
    return false;
  }

  const encoder = new TextEncoder();
  const aHash = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(a)));
  const bHash = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(b)));

  const subtle = crypto.subtle as unknown as {
    timingSafeEqual?: (a: ArrayBufferView, b: ArrayBufferView) => boolean;
  };

  if (typeof subtle.timingSafeEqual === "function") {
    return subtle.timingSafeEqual(aHash, bHash);
  }

  if (aHash.length !== bHash.length) {
    return false;
  }

  let mismatch = 0;
  for (let i = 0; i < aHash.length; i++) {
    mismatch |= aHash[i] ^ bHash[i];
  }
  return mismatch === 0;
}

export async function validateBearerToken(
  request: Request,
  expectedToken?: string,
): Promise<Response | null> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader) {
    logger.warn("Authentication failed: missing Authorization header");
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    logger.warn("Authentication failed: malformed Authorization header, expected Bearer scheme");
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = match[1]?.trim() ?? "";
  if (token.length === 0) {
    logger.warn("Authentication failed: empty Bearer token");
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!expectedToken || expectedToken.trim().length === 0) {
    logger.error(
      "Authentication failed: API_BEARER_TOKEN is not configured in environment bindings",
    );
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const isValid = await timingSafeEqual(token, expectedToken.trim());
  if (!isValid) {
    logger.warn("Authentication failed: invalid Bearer token");
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}

import cleanupQuery from "../../queries/cleanup_api_rate_limits.sql";
import consumeQuery from "../../queries/consume_api_rate_limit.sql";
import { validateBearerToken } from "./auth.ts";
import { logger } from "./logger.ts";

export const REQUESTS_PER_MINUTE = 120;
export const AUTH_FAILURES_PER_MINUTE = 20;

/** Atomically increments the client counter and checks its fixed-window quota. */
async function consume(
  db: D1Database,
  key: string,
  windowStart: number,
  limit: number,
): Promise<boolean> {
  const result = await db.prepare(consumeQuery).bind(key, windowStart).first<{
    request_count: number;
  }>();
  return result !== null && result.request_count <= limit;
}

/** Returns a non-cacheable throttle response with the next retry interval. */
function throttled(retryAfter: number): Response {
  return Response.json(
    { error: "Too many requests" },
    { status: 429, headers: { "Retry-After": String(retryAfter), "Cache-Control": "no-store" } },
  );
}

/** Normalizes IPv6 clients to a /64 using the runtime URL parser; IPv4 stays intact. */
function clientNetwork(ip: string): string {
  if (!ip.includes(":")) return ip;
  try {
    const canonical = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
    const [left, right] = canonical.split("::");
    const leading = left ? left.split(":") : [];
    const trailing = right ? right.split(":") : [];
    const groups =
      right === undefined
        ? leading
        : [...leading, ...Array(8 - leading.length - trailing.length).fill("0"), ...trailing];
    return `${groups
      .slice(0, 4)
      .map((part) => part.padStart(4, "0"))
      .join(":")}::/64`;
  } catch {
    return "invalid-ipv6";
  }
}

/**
 * Runs before route handlers on all Pages hosts, including pages.dev previews.
 * CF-Connecting-IP is set by Cloudflare; forwarded client headers are not trusted.
 */
export async function guardApiRequest(
  request: Request,
  db: D1Database,
  expectedToken?: string,
  now = Date.now(),
): Promise<Response | null> {
  const metadata = {
    method: request.method,
    pathname: new URL(request.url).pathname,
    cfRay: request.headers.get("cf-ray")?.slice(0, 100) ?? null,
  };
  const minute = Math.floor(now / 60_000);
  const retryAfter = 60 - Math.floor((now % 60_000) / 1000);
  try {
    // All local requests share a bucket when Cloudflare's trusted IP is absent.
    const ip = request.headers.get("CF-Connecting-IP") ?? "local";
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`${minute}:${clientNetwork(ip)}`),
    );
    const client = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    await db
      .prepare(cleanupQuery)
      .bind(minute - 1)
      .run();
    if (!(await consume(db, `${minute}:requests:${client}`, minute, REQUESTS_PER_MINUTE))) {
      logger.warn("API request rate exceeded", { ...metadata, clientIpHash: client });
      return throttled(retryAfter);
    }
    const authResponse = await validateBearerToken(request, expectedToken);
    if (
      authResponse?.status === 401 &&
      !(await consume(db, `${minute}:auth:${client}`, minute, AUTH_FAILURES_PER_MINUTE))
    ) {
      logger.warn("API authentication rate exceeded", { ...metadata, clientIpHash: client });
      return throttled(retryAfter);
    }
    return authResponse;
  } catch (error) {
    logger.error("API rate limiting unavailable", {
      ...metadata,
      error: error instanceof Error ? error.message : String(error),
    });
    return Response.json(
      { error: "API temporarily unavailable" },
      { status: 503, headers: { "Retry-After": "60", "Cache-Control": "no-store" } },
    );
  }
}

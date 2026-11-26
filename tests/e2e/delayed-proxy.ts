import {
  createServer,
  request as httpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

export interface HeldTransactionPost {
  payload: unknown;
  isPending: () => boolean;
  release: () => void;
  fail: (status?: number) => void;
}

export interface RecordedPost {
  url: string;
  payload: unknown;
  forwarded: boolean;
  status?: number;
}

export interface DelayedProxy {
  baseUrl: string;
  armPostHold: () => Promise<HeldTransactionPost>;
  getPostRequests: () => RecordedPost[];
  close: () => Promise<void>;
}

function readRequestBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer | string) => {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parseJsonOrUndefined(body: Buffer): unknown {
  if (body.length === 0) return undefined;
  try {
    return JSON.parse(body.toString("utf8")) as unknown;
  } catch {
    return undefined;
  }
}

function buildUpstreamHeaders(
  headers: IncomingHttpHeaders,
  targetHost: string,
  bodyLength: number,
): IncomingHttpHeaders {
  const nextHeaders: IncomingHttpHeaders = { ...headers, host: targetHost };
  delete nextHeaders.connection;
  delete nextHeaders["transfer-encoding"];
  if (bodyLength > 0) {
    nextHeaders["content-length"] = String(bodyLength);
  } else {
    delete nextHeaders["content-length"];
  }
  return nextHeaders;
}

interface UpstreamTarget {
  hostname: "127.0.0.1" | "localhost";
  port: number;
  host: string;
}

const ALLOWED_STATIC_PATHS = new Set([
  "/",
  "/index.html",
  "/activity",
  "/activity/",
  "/activity/index.html",
  "/sw.js",
  "/manifest.json",
  "/favicon.svg",
  "/theme-init.js",
]);

function resolveSafeRequestTarget(
  rawUrl: string | undefined,
  targetUrl: URL,
): { pathname: string; path: string } | null {
  const candidate = rawUrl ?? "/";
  if (!candidate.startsWith("/") || candidate.startsWith("//")) {
    return null;
  }
  if (candidate.includes("..") || candidate.includes("\\")) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(candidate, targetUrl);
  } catch {
    return null;
  }
  if (parsed.origin !== targetUrl.origin) {
    return null;
  }
  const { pathname } = parsed;
  const isAllowedPath =
    ALLOWED_STATIC_PATHS.has(pathname) ||
    pathname.startsWith("/_astro/") ||
    pathname.startsWith("/icons/") ||
    pathname.startsWith("/api/");
  if (!isAllowedPath) {
    return null;
  }
  return {
    pathname,
    path: `${pathname}${parsed.search}`,
  };
}

function forwardToUpstream(
  req: IncomingMessage,
  res: ServerResponse,
  upstream: UpstreamTarget,
  requestPath: string,
  body: Buffer,
  onStatus?: (status: number) => void,
): void {
  const upstreamReq = httpRequest(
    {
      protocol: "http:",
      hostname: upstream.hostname,
      port: upstream.port,
      path: requestPath,
      method: req.method,
      headers: buildUpstreamHeaders(req.headers, upstream.host, body.length),
    },
    (upstreamRes) => {
      const status = upstreamRes.statusCode ?? 502;
      onStatus?.(status);
      if (res.writableEnded || res.destroyed) {
        upstreamRes.resume();
        return;
      }
      res.writeHead(status, upstreamRes.headers);
      upstreamRes.pipe(res);
    },
  );

  upstreamReq.on("error", (error) => {
    if (!res.headersSent && !res.writableEnded && !res.destroyed) {
      res.writeHead(502, { "content-type": "text/plain" });
      res.end(`Proxy upstream error: ${error.message}`);
    } else if (!res.destroyed) {
      res.destroy();
    }
  });

  res.on("close", () => {
    if (!res.writableEnded) {
      upstreamReq.destroy();
    }
  });

  if (body.length > 0) {
    upstreamReq.write(body);
  }
  upstreamReq.end();
}

/**
 * Starts a local HTTP reverse proxy in front of the disposable Pages/D1 server so
 * Playwright tests can hold POST /api/transactions at the backend boundary even when
 * an active service worker controls the page.
 */
export async function startDelayedProxy(targetBaseUrl: string): Promise<DelayedProxy> {
  const targetUrl = new URL(targetBaseUrl);
  if (
    targetUrl.protocol !== "http:" ||
    (targetUrl.hostname !== "127.0.0.1" && targetUrl.hostname !== "localhost")
  ) {
    throw new Error(`Delayed proxy only supports local HTTP targets, got: ${targetBaseUrl}`);
  }
  const upstreamPort = Number(targetUrl.port || "80");
  if (!Number.isInteger(upstreamPort) || upstreamPort < 1 || upstreamPort > 65535) {
    throw new Error(`Delayed proxy received invalid port in target URL: ${targetBaseUrl}`);
  }
  const upstream: UpstreamTarget = {
    hostname: targetUrl.hostname === "localhost" ? "localhost" : "127.0.0.1",
    port: upstreamPort,
    host: targetUrl.host,
  };
  const postRequests: RecordedPost[] = [];
  const armedHoldResolvers: Array<(held: HeldTransactionPost) => void> = [];
  const pendingReleases = new Set<() => void>();

  const server: Server = createServer(async (req, res) => {
    let body: Buffer;
    try {
      body = await readRequestBody(req);
    } catch {
      if (!res.destroyed) res.destroy();
      return;
    }

    const safeTarget = resolveSafeRequestTarget(req.url, targetUrl);
    if (!safeTarget) {
      res.writeHead(400, { "content-type": "text/plain" });
      res.end("Rejected disallowed proxy path");
      return;
    }

    const isTransactionPost = req.method === "POST" && safeTarget.pathname === "/api/transactions";

    if (!isTransactionPost) {
      forwardToUpstream(req, res, upstream, safeTarget.path, body);
      return;
    }

    const payload = parseJsonOrUndefined(body);
    const record: RecordedPost = {
      url: safeTarget.pathname,
      payload,
      forwarded: false,
    };
    postRequests.push(record);

    const resolver = armedHoldResolvers.shift();
    if (!resolver) {
      record.forwarded = true;
      forwardToUpstream(req, res, upstream, safeTarget.path, body, (status) => {
        record.status = status;
      });
      return;
    }

    let clientClosed = false;
    let settled = false;
    let failStatus: number | undefined;
    let settleWaiter: (() => void) | undefined;

    const release = () => {
      if (settled) return;
      settled = true;
      pendingReleases.delete(release);
      settleWaiter?.();
    };
    const fail = (status = 503) => {
      if (settled) return;
      failStatus = status;
      release();
    };
    pendingReleases.add(release);

    res.on("close", () => {
      if (!res.writableEnded) {
        clientClosed = true;
        release();
      }
    });

    const waitForRelease = new Promise<void>((resolve) => {
      if (settled) {
        resolve();
        return;
      }
      settleWaiter = resolve;
    });

    resolver({ payload, isPending: () => !settled && !res.destroyed, release, fail });
    await waitForRelease;

    if (clientClosed || res.destroyed) {
      return;
    }

    if (failStatus !== undefined) {
      record.status = failStatus;
      res.writeHead(failStatus, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Simulated upstream outage" }));
      return;
    }

    record.forwarded = true;
    forwardToUpstream(req, res, upstream, safeTarget.path, body, (status) => {
      record.status = status;
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Delayed proxy failed to bind an ephemeral TCP port");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    armPostHold: () =>
      new Promise<HeldTransactionPost>((resolve) => {
        armedHoldResolvers.push(resolve);
      }),
    getPostRequests: () => [...postRequests],
    close: async () => {
      for (const release of pendingReleases) {
        release();
      }
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

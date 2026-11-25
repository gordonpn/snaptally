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
): IncomingHttpHeaders {
  const nextHeaders: IncomingHttpHeaders = { ...headers, host: targetHost };
  delete nextHeaders.connection;
  return nextHeaders;
}

function forwardToUpstream(
  req: IncomingMessage,
  res: ServerResponse,
  targetUrl: URL,
  body: Buffer,
  onStatus?: (status: number) => void,
): void {
  const path = req.url ?? "/";
  const upstreamReq = httpRequest(
    new URL(path, targetUrl),
    {
      method: req.method,
      headers: buildUpstreamHeaders(req.headers, targetUrl.host),
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

    const requestUrl = new URL(req.url ?? "/", targetUrl);
    const isTransactionPost = req.method === "POST" && requestUrl.pathname === "/api/transactions";

    if (!isTransactionPost) {
      forwardToUpstream(req, res, targetUrl, body);
      return;
    }

    const payload = parseJsonOrUndefined(body);
    const record: RecordedPost = {
      url: requestUrl.pathname,
      payload,
      forwarded: false,
    };
    postRequests.push(record);

    const resolver = armedHoldResolvers.shift();
    if (!resolver) {
      record.forwarded = true;
      forwardToUpstream(req, res, targetUrl, body, (status) => {
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

    resolver({ payload, release, fail });
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
    forwardToUpstream(req, res, targetUrl, body, (status) => {
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

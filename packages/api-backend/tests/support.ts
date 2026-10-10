// SPDX-License-Identifier: BUSL-1.1 (pending GC final review)

/** Shared test helpers: a tiny localhost HTTP server for client/login tests. */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

export interface CapturedRequest {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

export type Handler = (req: CapturedRequest) => { status: number; body: unknown; headers?: Record<string, string> };

export interface TestServer {
  url: string;
  requests: CapturedRequest[];
  close: () => Promise<void>;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export async function startTestServer(handler: Handler): Promise<TestServer> {
  const requests: CapturedRequest[] = [];
  const server: Server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const rawBody = await readBody(req);
    let body: unknown = rawBody;
    try {
      body = rawBody ? JSON.parse(rawBody) : null;
    } catch {
      /* leave as string */
    }
    const captured: CapturedRequest = {
      method: req.method ?? "GET",
      url: req.url ?? "/",
      headers: req.headers,
      body,
    };
    requests.push(captured);
    const out = handler(captured);
    if (out.headers) {
      for (const [k, v] of Object.entries(out.headers)) res.setHeader(k, v);
    }
    res.setHeader("content-type", "application/json");
    res.writeHead(out.status);
    res.end(JSON.stringify(out.body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("test server failed to bind");
  return {
    url: `http://127.0.0.1:${addr.port}`,
    requests,
    close: () => new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}

// SPDX-License-Identifier: BUSL-1.1 (pending GC final review)

/**
 * Mock Hinge server: the test double for the hinge adapter.
 *
 * Implements the adapter's read endpoints plus the login flow, and can
 * deterministically simulate 403 / 429 faults via the `__fault` query
 * parameter. Binds 127.0.0.1 on an ephemeral port.
 *
 * REDLINE: tests must NEVER touch the real Hinge servers or any real
 * account. Every adapter test asserts it talks to this mock
 * (URL must start with http://127.0.0.1).
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

export interface LikeFixture {
  id: string;
  name: string;
  age: number;
  photoUrls: string[];
  likedAt: string;
}

export interface MatchFixture {
  id: string;
  name: string;
  age: number;
  photoUrl: string;
  matchedAt: string;
  chatId: string;
}

export interface MessageFixture {
  id: string;
  chatId: string;
  sender: "me" | "them";
  body: string;
  sentAt: string;
}

export interface MockHingeServer {
  url: string;
  port: number;
  /** Every request received, in order (for assertions). */
  requests: { method: string; url: string }[];
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

function buildFixtures(): { likes: LikeFixture[]; matches: MatchFixture[]; messages: Map<string, MessageFixture[]> } {
  const likes: LikeFixture[] = [];
  for (let i = 1; i <= 12; i++) {
    likes.push({
      id: `like-${i}`,
      name: `Like Person ${i}`,
      age: 24 + (i % 8),
      photoUrls: [`https://mock.invalid/photos/like-${i}-1.jpg`],
      likedAt: `2026-10-${String((i % 9) + 1).padStart(2, "0")}T12:00:00.000Z`,
    });
  }
  const matches: MatchFixture[] = [];
  const messages = new Map<string, MessageFixture[]>();
  for (let i = 1; i <= 20; i++) {
    const chatId = `chat-${i}`;
    matches.push({
      id: `match-${i}`,
      name: `Match Person ${i}`,
      age: 25 + (i % 10),
      photoUrl: `https://mock.invalid/photos/match-${i}-1.jpg`,
      matchedAt: `2026-09-${String((i % 28) + 1).padStart(2, "0")}T18:30:00.000Z`,
      chatId,
    });
    const chat: MessageFixture[] = [];
    for (let m = 1; m <= 6; m++) {
      chat.push({
        id: `${chatId}-msg-${m}`,
        chatId,
        sender: m % 2 === 0 ? "me" : "them",
        body: `Mock message ${m} in ${chatId}`,
        sentAt: `2026-10-08T0${m}:00:00.000Z`,
      });
    }
    messages.set(chatId, chat);
  }
  return { likes, matches, messages };
}

function paginate<T>(items: T[], limit: number, cursor: string | null): { items: T[]; nextCursor: string | null } {
  const start = cursor ? Number(cursor) : 0;
  const safeStart = Number.isFinite(start) && start >= 0 ? Math.floor(start) : 0;
  const page = items.slice(safeStart, safeStart + limit);
  const next = safeStart + limit < items.length ? String(safeStart + limit) : null;
  return { items: page, nextCursor: next };
}

export async function startMockHingeServer(): Promise<MockHingeServer> {
  const { likes, matches, messages } = buildFixtures();
  const issuedTokens = new Set<string>();
  let tokenCounter = 0;
  const requests: { method: string; url: string }[] = [];

  const server: Server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const rawBody = await readBody(req);
    let body: unknown = null;
    try {
      body = rawBody ? JSON.parse(rawBody) : null;
    } catch {
      body = rawBody;
    }
    const method = req.method ?? "GET";
    const fullUrl = new URL(req.url ?? "/", "http://127.0.0.1");
    requests.push({ method, url: fullUrl.pathname + fullUrl.search });

    const send = (status: number, payload: unknown, headers: Record<string, string> = {}) => {
      for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
      res.setHeader("content-type", "application/json");
      res.writeHead(status);
      res.end(JSON.stringify(payload));
    };

    // Deterministic fault injection for resilience tests.
    const fault = fullUrl.searchParams.get("__fault");
    if (fault === "403") return send(403, { error: "forbidden" });
    if (fault === "429") return send(429, { error: "rate limited" }, { "retry-after": "1" });
    if (fault === "empty") {
      res.writeHead(200);
      res.end();
      return;
    }

    const b = (body ?? {}) as Record<string, unknown>;

    // ---- login flow ----
    if (fullUrl.pathname === "/identity/install" && method === "POST") {
      return send(200, { ok: true });
    }
    if (fullUrl.pathname === "/auth/sms/v2/initiate" && method === "POST") {
      return send(200, { ok: true });
    }
    if (fullUrl.pathname === "/auth/sms/v2" && method === "POST") {
      if (b["otp"] === "000000") {
        tokenCounter += 1;
        const token = `mock-token-${tokenCounter}`;
        issuedTokens.add(token);
        return send(200, { authToken: token });
      }
      if (b["otp"] === "999999") {
        return send(412, { caseId: "mock-case-1", email: "user@example.com" });
      }
      return send(401, { error: "bad otp" });
    }
    if (fullUrl.pathname === "/auth/device/validate" && method === "POST") {
      if (b["code"] === "111111") {
        tokenCounter += 1;
        const token = `mock-token-${tokenCounter}`;
        issuedTokens.add(token);
        return send(200, { authToken: token });
      }
      return send(401, { error: "bad code" });
    }

    // ---- reads: require a mock-issued bearer token ----
    const auth = req.headers["authorization"] ?? "";
    const token = typeof auth === "string" && auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!issuedTokens.has(token)) {
      return send(401, { error: "unauthorized: login via the mock login flow first" });
    }

    const limit = Math.min(Number(fullUrl.searchParams.get("limit") ?? "10") || 10, 50);
    const cursor = fullUrl.searchParams.get("cursor");

    if (fullUrl.pathname === "/likes/received" && method === "GET") {
      const page = paginate(likes, limit, cursor);
      return send(200, { likes: page.items, nextCursor: page.nextCursor });
    }
    if (fullUrl.pathname === "/matches" && method === "GET") {
      const page = paginate(matches, limit, cursor);
      return send(200, { matches: page.items, nextCursor: page.nextCursor });
    }
    const chatMatch = fullUrl.pathname.match(/^\/chats\/([^/]+)\/messages$/);
    if (chatMatch && method === "GET") {
      const chat = messages.get(chatMatch[1] as string) ?? [];
      const page = paginate(chat, limit, cursor);
      return send(200, { messages: page.items, nextCursor: page.nextCursor });
    }

    return send(404, { error: "not found" });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("mock hinge server failed to bind");
  const port = addr.port;
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    requests,
    close: () => new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}

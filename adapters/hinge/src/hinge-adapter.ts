// SPDX-License-Identifier: BUSL-1.1 (pending GC final review)

/**
 * Hinge app adapter (MVP: read-only) for the phonehands API engine.
 *
 * Reads: likes_received / matches / chat_messages -> structured JSON,
 * wrapped in the core envelope { ok, backend: "api", latency_ms, degraded, evidence }.
 *
 * Writes: intentionally absent in Phase 1. Any write attempt is refused via
 * the HINGE_ALLOWED_WRITE_TOOLS allowlist (default deny).
 *
 * Fingerprint values below are observed facts about the Hinge iOS app's
 * network fingerprint as of 2026-10-09 (clean-room reimplementation of the
 * headers, not copied code). Re-verify against the current app before any
 * production use. Locale is REQUIRED and parameterized -- never hardcoded.
 */
import {
  LoginStateMachine,
  EmailChallengeRequired,
  SessionStore,
  ThrottledHttpClient,
  buildPhoneHeaders,
  newDeviceIds,
  assertApiCapable,
  getApiBackendCapabilities,
  sanitizeLogLine,
  type ApiEnvelope,
  type FingerprintConfig,
  type LocaleConfig,
  type Page,
  type PageParams,
  type ThrottleOptions,
} from "@phonehands/api-backend";
import { promptSecret } from "./secure-prompt.ts";
import { KNOWN_WRITE_TOOLS, parseWriteAllowlist, WriteNotEnabledError } from "./write-tools.ts";

/** Production API host (observed; the adapter never defaults to it -- see below). */
export const HINGE_PRODUCTION_BASE_URL = "https://prod-api.hingeaws.net";

/** Observed Hinge iOS app fingerprint facts (2026-10-09). Locale is NOT here. */
export const HINGE_FINGERPRINT_BASE = {
  appSlug: "Hinge",
  appVersion: "9.91.0",
  buildNumber: "11639",
  cfNetworkVersion: "3859.100.1",
  darwinVersion: "25.0.0",
  deviceModelCode: "iPhone15,2",
  devicePlatform: "iOS",
  osVersion: "26.0",
} as const;

export interface LikeSummary {
  id: string;
  name: string;
  age: number | null;
  photoUrls: string[];
  likedAt: string;
}

export interface MatchSummary {
  id: string;
  name: string;
  age: number | null;
  photoUrl: string | null;
  matchedAt: string;
  chatId: string;
}

export interface ChatMessage {
  id: string;
  chatId: string;
  sender: "me" | "them";
  body: string;
  sentAt: string;
}

export type HingeReadKind = "likes_received" | "matches" | "chat_messages";

/** Capability table for the core Router: what the API engine can do for Hinge. */
export const HINGE_CAPABILITIES = getApiBackendCapabilities();

export interface HingeAdapterOptions {
  /**
   * API base URL. REQUIRED -- there is deliberately no default, so a test
   * or a misconfiguration can never silently talk to the production host.
   * Tests pass the mock server URL (http://127.0.0.1:PORT).
   */
  baseUrl: string;
  /** REQUIRED: region/language parameterization (the IN/en-GB anti-pattern). */
  locale: LocaleConfig;
  sessionDir?: string;
  throttle?: ThrottleOptions;
  logger?: (line: string) => void;
}

const READ_PATHS = {
  likes_received: "/likes/received",
  matches: "/matches",
} as const;

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

function pickString(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    if (typeof obj[k] === "string") return obj[k] as string;
  }
  return "";
}

function pickNumberOrNull(obj: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    if (typeof obj[k] === "number") return obj[k] as number;
  }
  return null;
}

export class HingeApiAdapter {
  readonly auth: LoginStateMachine;
  private readonly client: ThrottledHttpClient;
  private readonly logger: (line: string) => void;
  private readonly opts: HingeAdapterOptions;

  constructor(opts: HingeAdapterOptions) {
    this.opts = opts;
    if (!opts.baseUrl) {
      throw new Error("phonehands: hinge adapter requires an explicit baseUrl (no production default by design)");
    }
    this.logger = opts.logger ?? (() => {});
    const fingerprint: FingerprintConfig = { ...HINGE_FINGERPRINT_BASE, locale: opts.locale };
    const deviceIds = newDeviceIds();
    this.client = new ThrottledHttpClient(opts.baseUrl, fingerprint, deviceIds, {
      ...opts.throttle,
      logger: (line) => this.logger(sanitizeLogLine(line)),
    });
    const store = new SessionStore("hinge", opts.sessionDir);
    this.auth = new LoginStateMachine(this.client, store, fingerprint, deviceIds);
    // Touch the fingerprint builder once so misconfiguration fails fast.
    buildPhoneHeaders(fingerprint, deviceIds);
  }

  /** Capability lookup for the core Router. */
  capabilities() {
    return HINGE_CAPABILITIES;
  }

  /**
   * Interactive login: install -> initiate -> TTY-prompted OTP -> token.
   * The OTP is read from a secure no-echo TTY prompt (T2 mode); it is never
   * a function argument, never a CLI flag, never logged, never persisted.
   * 412 email-challenge is handled as a first-class fallback channel.
   */
  async loginInteractive(phoneNumber: string): Promise<void> {
    await this.auth.install();
    await this.auth.initiate(phoneNumber);
    const otp = await promptSecret("Enter the SMS code: ");
    try {
      await this.auth.submitOtp(phoneNumber, otp);
    } catch (err) {
      if (err instanceof EmailChallengeRequired) {
        this.logger("phonehands: SMS challenge escalated to email challenge (first-class fallback)");
        const code = await promptSecret("Enter the email verification code: ");
        await this.auth.submitEmailChallenge(err.caseId, code);
        return;
      }
      throw err;
    }
  }

  async logout(): Promise<void> {
    await this.auth.logout();
  }

  /** Router-facing read(): dispatches likes_received / matches / chat_messages. */
  async read(kind: HingeReadKind, params: PageParams & { chatId?: string } = {}): Promise<ApiEnvelope<Page<LikeSummary> | Page<MatchSummary> | Page<ChatMessage>>> {
    assertApiCapable(kind);
    switch (kind) {
      case "likes_received":
        return this.likesReceived(params);
      case "matches":
        return this.matches(params);
      case "chat_messages": {
        if (!params.chatId) {
          throw new Error('phonehands: chat_messages requires params.chatId');
        }
        return this.chatMessages(params.chatId, params);
      }
    }
  }

  async likesReceived(params: PageParams = {}): Promise<ApiEnvelope<Page<LikeSummary>>> {
    return this.getPage<LikeSummary>(READ_PATHS.likes_received, params, (raw) => ({
      id: pickString(raw, ["id"]),
      name: pickString(raw, ["name", "displayName"]),
      age: pickNumberOrNull(raw, ["age"]),
      photoUrls: Array.isArray(raw["photoUrls"]) ? (raw["photoUrls"] as string[]) : [],
      likedAt: pickString(raw, ["likedAt", "createdAt"]),
    }));
  }

  async matches(params: PageParams = {}): Promise<ApiEnvelope<Page<MatchSummary>>> {
    return this.getPage<MatchSummary>(READ_PATHS.matches, params, (raw) => ({
      id: pickString(raw, ["id"]),
      name: pickString(raw, ["name", "displayName"]),
      age: pickNumberOrNull(raw, ["age"]),
      photoUrl: pickString(raw, ["photoUrl"]) || null,
      matchedAt: pickString(raw, ["matchedAt", "createdAt"]),
      chatId: pickString(raw, ["chatId", "chat_id"]),
    }));
  }

  async chatMessages(chatId: string, params: PageParams = {}): Promise<ApiEnvelope<Page<ChatMessage>>> {
    const safeChatId = encodeURIComponent(chatId);
    return this.getPage<ChatMessage>(`/chats/${safeChatId}/messages`, params, (raw) => ({
      id: pickString(raw, ["id"]),
      chatId,
      sender: raw["sender"] === "me" ? "me" : "them",
      body: pickString(raw, ["body", "text"]),
      sentAt: pickString(raw, ["sentAt", "createdAt"]),
    }));
  }

  /**
   * Phase 1: every write is refused. Refusal has two explicit reasons:
   *   1. the tool is unknown or not allowlisted -> WriteNotEnabledError
   *      (default deny; enable via HINGE_ALLOWED_WRITE_TOOLS);
   *   2. the tool is known AND allowlisted but not implemented yet ->
   *      explicit "not implemented" (reachable only in Phase 2+).
   */
  attemptWrite(toolName: string): never {
    const known = KNOWN_WRITE_TOOLS.some((t) => t.name === toolName);
    const allowlisted = parseWriteAllowlist().includes(toolName);
    if (!known || !allowlisted) {
      throw new WriteNotEnabledError(toolName);
    }
    throw new Error(
      `phonehands: write tool "${toolName}" is allowlisted but not implemented in Phase 1 (read-only MVP)`,
    );
  }

  private async getPage<T>(
    path: string,
    params: PageParams,
    map: (raw: Record<string, unknown>) => T,
  ): Promise<ApiEnvelope<Page<T>>> {
    const token = this.auth.getAuthToken();
    if (!token) {
      return {
        ok: false,
        backend: "api",
        latency_ms: 0,
        degraded: false,
        evidence: null,
        error: { code: "NOT_LOGGED_IN", message: "phonehands: not logged in; complete the login flow first" },
      };
    }
    const started = Date.now();
    try {
      const res = await this.client.request(path, {
        query: { limit: params.limit ?? 20, cursor: params.cursor ?? undefined, __fault: params.fault },
        authToken: token,
      });
      const data = (res.data ?? {}) as Record<string, unknown>;
      const rawItems = asArray(data["likes"] ?? data["matches"] ?? data["messages"] ?? data["items"]);
      const nextCursor =
        typeof data["nextCursor"] === "string" ? (data["nextCursor"] as string) : null;
      const degraded = this.client.health().degraded || res.retried;
      return {
        ok: true,
        backend: "api",
        latency_ms: Date.now() - started,
        degraded,
        evidence: { items: rawItems.map(map), nextCursor },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code = (err as { name?: string }).name === "HttpStatusError" ? `HTTP_${(err as { status?: number }).status ?? "?"}` : "REQUEST_FAILED";
      return {
        ok: false,
        backend: "api",
        latency_ms: Date.now() - started,
        degraded: true,
        evidence: null,
        error: { code, message },
      };
    }
  }
}

// SPDX-License-Identifier: BUSL-1.1

/**
 * Self-throttling HTTP client for the API engine.
 *
 * The anti-pattern we refuse to repeat: zero self-throttling (the
 * `rateLimitRetries: 0` school of thought). This client ships with
 * built-in restraint on day one:
 *
 *   - a single serial promise tail: one account, one request at a time
 *   - a minimum interval between requests (default 800ms)
 *   - exponential backoff with jitter on 429 / 5xx, honoring Retry-After
 *   - a bounded retry budget (default 3 retries); then fail loudly
 *   - a health probe: consecutive failures mark the backend DEGRADED so the
 *     core Router can fall back to the device engine
 *
 * Secrets are never logged: only sanitized method/path/status lines reach
 * the logger.
 */
import { sanitizeLogLine, sanitizeUrl } from "./redact.ts";
import type { FingerprintConfig, DeviceIds } from "./fingerprint.ts";
import { buildPhoneHeaders } from "./fingerprint.ts";

export interface ThrottleOptions {
  /** Minimum gap between request starts. Default 800ms. */
  minIntervalMs?: number;
  /** Retries after the first attempt. Default 3. */
  maxRetries?: number;
  /** Base backoff for 429/5xx. Default 2000ms. */
  baseBackoffMs?: number;
  /** Backoff cap. Default 30000ms. */
  maxBackoffMs?: number;
  /** Per-request timeout. Default 15000ms. */
  requestTimeoutMs?: number;
  /** Optional sink for sanitized diagnostics. Default: silent. */
  logger?: (line: string) => void;
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  /** Override the default impersonation headers entirely. */
  headers?: Record<string, string>;
  /** Auth token to attach as Bearer. If omitted, none is attached. */
  authToken?: string | null;
  /** If false, skip the impersonation headers (rare; tests). */
  impersonate?: boolean;
}

export interface HttpResult {
  status: number;
  data: unknown;
  /** Total attempts made (1 = no retry). */
  attempts: number;
  /** Total backoff time waited before success, ms. */
  backoffMs: number;
  /** True when the call needed retries/backoff. */
  retried: boolean;
}

export interface BackendHealth {
  degraded: boolean;
  consecutiveFailures: number;
  degradedSince: number | null;
}

export class RateLimitedError extends Error {
  readonly attempts: number;
  constructor(message: string, attempts: number) {
    super(message);
    this.name = "RateLimitedError";
    this.attempts = attempts;
  }
}

export class HttpStatusError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "HttpStatusError";
    this.status = status;
    this.body = body;
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class ThrottledHttpClient {
  private readonly baseUrl: string;
  private readonly fingerprint: FingerprintConfig;
  private readonly deviceIds: DeviceIds;
  private readonly minIntervalMs: number;
  private readonly maxRetries: number;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly requestTimeoutMs: number;
  private readonly logger: (line: string) => void;

  private tail: Promise<void> = Promise.resolve();
  private lastRequestAt = 0;
  private consecutiveFailures = 0;
  private degradedSince: number | null = null;

  constructor(baseUrl: string, fingerprint: FingerprintConfig, deviceIds: DeviceIds, opts: ThrottleOptions = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.fingerprint = fingerprint;
    this.deviceIds = deviceIds;
    this.minIntervalMs = opts.minIntervalMs ?? 800;
    this.maxRetries = opts.maxRetries ?? 3;
    this.baseBackoffMs = opts.baseBackoffMs ?? 2000;
    this.maxBackoffMs = opts.maxBackoffMs ?? 30000;
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 15000;
    this.logger = opts.logger ?? (() => {});
  }

  health(): BackendHealth {
    return {
      degraded: this.degradedSince !== null,
      consecutiveFailures: this.consecutiveFailures,
      degradedSince: this.degradedSince,
    };
  }

  resetHealth(): void {
    this.consecutiveFailures = 0;
    this.degradedSince = null;
  }

  private log(line: string): void {
    this.logger(sanitizeLogLine(line));
  }

  /** Serialize all requests for one account through a single promise tail. */
  request(path: string, opts: RequestOptions = {}): Promise<HttpResult> {
    const run: Promise<HttpResult> = this.tail.then(() => this.execute(path, opts));
    // Keep the tail alive even if this request fails.
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async execute(path: string, opts: RequestOptions): Promise<HttpResult> {
    const now = Date.now();
    const wait = this.minIntervalMs - (now - this.lastRequestAt);
    if (wait > 0) {
      await sleep(wait);
    }
    this.lastRequestAt = Date.now();

    const url = this.buildUrl(path, opts.query);
    const method = opts.method ?? "GET";
    const headers: Record<string, string> = opts.impersonate === false ? {} : buildPhoneHeaders(this.fingerprint, this.deviceIds, opts.authToken ?? undefined);
    if (opts.headers) {
      Object.assign(headers, opts.headers);
    }
    let bodyText: string | undefined;
    if (opts.body !== undefined) {
      bodyText = JSON.stringify(opts.body);
      headers["content-type"] = "application/json";
    }

    let attempts = 0;
    let backoffMs = 0;
    for (;;) {
      attempts += 1;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
      let res: Response;
      try {
        res = await fetch(url, { method, headers, body: bodyText, signal: controller.signal });
      } catch (err) {
        clearTimeout(timer);
        // Network-level failure: retryable.
        if (attempts <= this.maxRetries) {
          const delay = this.backoffDelay(attempts, null);
          backoffMs += delay;
          this.log(`phonehands http ${method} ${sanitizeUrl(path)} network-error attempt=${attempts} backoff=${delay}ms`);
          await sleep(delay);
          continue;
        }
        this.recordFailure();
        throw err instanceof Error ? err : new Error(String(err));
      } finally {
        clearTimeout(timer);
      }

      const data = await this.parseBody(res);

      if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
        if (attempts <= this.maxRetries) {
          const retryAfter = res.status === 429 ? res.headers.get("retry-after") : null;
          const delay = this.backoffDelay(attempts, retryAfter);
          backoffMs += delay;
          this.log(
            `phonehands http ${method} ${sanitizeUrl(path)} status=${res.status} attempt=${attempts} backoff=${delay}ms`,
          );
          await sleep(delay);
          continue;
        }
        this.recordFailure();
        throw new RateLimitedError(
          `phonehands: rate limited / server error (status ${res.status}) after ${attempts} attempts; backing off is mandatory, not optional`,
          attempts,
        );
      }

      if (res.status >= 400) {
        this.recordFailure();
        this.log(`phonehands http ${method} ${sanitizeUrl(path)} status=${res.status} attempt=${attempts}`);
        throw new HttpStatusError(`phonehands: request failed with status ${res.status}`, res.status, data);
      }

      this.recordSuccess();
      this.log(`phonehands http ${method} ${sanitizeUrl(path)} status=${res.status} attempts=${attempts}`);
      return { status: res.status, data, attempts, backoffMs, retried: attempts > 1 };
    }
  }

  private buildUrl(path: string, query?: Record<string, string | number | boolean | undefined>): string {
    const url = new URL(path.startsWith("/") ? path : `/${path}`, this.baseUrl);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  private async parseBody(res: Response): Promise<unknown> {
    const text = await res.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  private backoffDelay(attempt: number, retryAfter: string | null): number {
    if (retryAfter) {
      const seconds = Number(retryAfter);
      if (Number.isFinite(seconds) && seconds >= 0) {
        return Math.min(seconds * 1000, this.maxBackoffMs);
      }
    }
    const exponential = this.baseBackoffMs * 2 ** (attempt - 1);
    const jitter = Math.random() * this.baseBackoffMs;
    return Math.min(exponential + jitter, this.maxBackoffMs);
  }

  private recordSuccess(): void {
    this.consecutiveFailures = 0;
    // A clean success clears degradation only when explicitly probed back;
    // here we keep the flag so the Router makes the call to switch back.
  }

  private recordFailure(): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= 3 && this.degradedSince === null) {
      this.degradedSince = Date.now();
      this.log("phonehands http backend marked DEGRADED after 3 consecutive failures");
    }
  }
}

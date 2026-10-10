// SPDX-License-Identifier: BUSL-1.1 (pending GC final review)

/**
 * Login state machine (clean-room reimplementation of the pattern):
 *
 *   install -> initiate -> submit -> token persistence
 *
 * The fallback challenge (HTTP 412 -> secondary email channel) is a
 * first-class citizen, not a patch: it has its own state and its own
 * error type carrying the case context.
 *
 * Re-login is destructive: initiate() invalidates any previous local
 * session BEFORE sending a new challenge, so there is never an ambiguous
 * "which session is live" moment.
 */
import { HttpStatusError, ThrottledHttpClient } from "./http-client.ts";
import { SessionStore, type StoredSession } from "./session-store.ts";
import type { DeviceIds, FingerprintConfig } from "./fingerprint.ts";
import { newDeviceIds } from "./fingerprint.ts";

export type LoginState = "logged_out" | "installed" | "challenge_sent" | "email_challenge" | "authenticated";

/** Thrown when the server demands the secondary (email) challenge. First-class. */
export class EmailChallengeRequired extends Error {
  readonly caseId: string;
  readonly email: string;
  constructor(caseId: string, email: string) {
    super(`phonehands: server requires email challenge for ${maskEmail(email)} (case ${caseId})`);
    this.name = "EmailChallengeRequired";
    this.caseId = caseId;
    this.email = email;
  }
}

function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  return `${email[0]}***${email.slice(at)}`;
}

export interface AuthPaths {
  install: string;
  initiate: string;
  submit: string;
  emailValidate: string;
}

export const DEFAULT_AUTH_PATHS: AuthPaths = {
  install: "/identity/install",
  initiate: "/auth/sms/v2/initiate",
  submit: "/auth/sms/v2",
  emailValidate: "/auth/device/validate",
};

export interface LoginMachineOptions {
  paths?: AuthPaths;
  /** Extract the bearer token from a successful auth response. */
  extractAuthToken?: (data: unknown) => string | null;
}

function defaultExtractAuthToken(data: unknown): string | null {
  if (data !== null && typeof data === "object") {
    const d = data as Record<string, unknown>;
    for (const key of ["authToken", "hingeAuthToken", "accessToken", "token"]) {
      if (typeof d[key] === "string" && (d[key] as string).length > 0) {
        return d[key] as string;
      }
    }
  }
  return null;
}

export class LoginStateMachine {
  private state: LoginState = "logged_out";
  private deviceIds: DeviceIds;
  private authToken: string | null = null;
  private phoneNumber: string | null = null;
  private readonly client: ThrottledHttpClient;
  private readonly store: SessionStore;
  private readonly fingerprint: FingerprintConfig;
  private readonly paths: AuthPaths;
  private readonly extractAuthToken: (data: unknown) => string | null;

  constructor(
    client: ThrottledHttpClient,
    store: SessionStore,
    fingerprint: FingerprintConfig,
    initialDeviceIds: DeviceIds,
    opts: LoginMachineOptions = {},
  ) {
    this.client = client;
    this.store = store;
    this.fingerprint = fingerprint;
    this.deviceIds = initialDeviceIds;
    this.paths = opts.paths ?? DEFAULT_AUTH_PATHS;
    this.extractAuthToken = opts.extractAuthToken ?? defaultExtractAuthToken;
    this.restoreFromStore();
  }

  currentState(): LoginState {
    return this.state;
  }

  getDeviceIds(): DeviceIds {
    return { ...this.deviceIds };
  }

  /** Local-only status check. Never touches the network. */
  status(): { loggedIn: boolean; state: LoginState; phoneNumber: string | null } {
    return { loggedIn: this.state === "authenticated" && this.authToken !== null, state: this.state, phoneNumber: this.phoneNumber };
  }

  private restoreFromStore(): void {
    const stored = this.store.load();
    if (stored && stored.authToken) {
      this.authToken = stored.authToken;
      this.phoneNumber = stored.phoneNumber;
      this.deviceIds = stored.deviceIds;
      this.state = "authenticated";
    }
  }

  private persist(): void {
    const session: StoredSession = {
      version: 1,
      app: this.store.appSlug,
      deviceIds: this.deviceIds,
      authToken: this.authToken,
      phoneNumber: this.phoneNumber,
      savedAt: new Date().toISOString(),
    };
    this.store.save(session);
  }

  /** Step 1: register this device installation. Idempotent. */
  async install(): Promise<void> {
    await this.client.request(this.paths.install, {
      method: "POST",
      body: { installId: this.deviceIds.installId },
    });
    if (this.state === "logged_out") {
      this.state = "installed";
    }
  }

  /**
   * Step 2: send the SMS challenge.
   * Destructive: any previous local session is invalidated FIRST, so a
   * re-login can never leave two live sessions ambiguous.
   */
  async initiate(phoneNumber: string): Promise<void> {
    this.store.clear();
    this.authToken = null;
    this.phoneNumber = phoneNumber;
    await this.client.request(this.paths.initiate, {
      method: "POST",
      body: { deviceId: this.deviceIds.deviceId, phoneNumber },
    });
    this.state = "challenge_sent";
  }

  /** Step 3: submit the OTP. HTTP 412 => email challenge becomes first-class. */
  async submitOtp(phoneNumber: string, otp: string): Promise<void> {
    try {
      const res = await this.client.request(this.paths.submit, {
        method: "POST",
        body: {
          installId: this.deviceIds.installId,
          deviceId: this.deviceIds.deviceId,
          phoneNumber,
          otp,
        },
      });
      this.finishLogin(res.data, phoneNumber);
    } catch (err) {
      if (err instanceof HttpStatusError && err.status === 412) {
        const { caseId, email } = extractChallengeContext(err.body);
        this.state = "email_challenge";
        throw new EmailChallengeRequired(caseId, email);
      }
      throw err;
    }
  }

  /** Step 4 (fallback channel): verify the email challenge code. */
  async submitEmailChallenge(caseId: string, code: string): Promise<void> {
    const res = await this.client.request(this.paths.emailValidate, {
      method: "POST",
      body: {
        installId: this.deviceIds.installId,
        deviceId: this.deviceIds.deviceId,
        caseId,
        code,
      },
    });
    this.finishLogin(res.data, this.phoneNumber);
  }

  private finishLogin(data: unknown, phoneNumber: string | null): void {
    const token = this.extractAuthToken(data);
    if (!token) {
      throw new Error("phonehands: login response contained no auth token; refusing to guess");
    }
    this.authToken = token;
    this.phoneNumber = phoneNumber;
    this.state = "authenticated";
    this.persist();
  }

  /** Log out: drop tokens AND rotate device identity (fresh triple next login). */
  async logout(): Promise<void> {
    this.store.clear();
    this.authToken = null;
    this.phoneNumber = null;
    this.deviceIds = newDeviceIds();
    this.state = "logged_out";
  }

  getAuthToken(): string | null {
    return this.authToken;
  }
}

function extractChallengeContext(body: unknown): { caseId: string; email: string } {
  if (body !== null && typeof body === "object") {
    const b = body as Record<string, unknown>;
    const caseId = typeof b["caseId"] === "string" ? (b["caseId"] as string) : "";
    const email = typeof b["email"] === "string" ? (b["email"] as string) : "";
    if (caseId && email) return { caseId, email };
  }
  throw new Error("phonehands: 412 response carried no usable challenge context; refusing to guess");
}

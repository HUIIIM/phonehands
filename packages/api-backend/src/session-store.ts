// SPDX-License-Identifier: BUSL-1.1 (pending GC final review)

/**
 * Session persistence (session.json): the session security quartet.
 *
 *   1. File mode 0600, parent directory 0700.
 *   2. Atomic write: temp file (O_EXCL) + fsync + atomic rename.
 *   3. Path-traversal protection: the resolved path must stay inside baseDir.
 *   4. Schema validation on load (zod): a corrupt session fails loudly and
 *      forces re-login instead of being guessed at or silently repaired.
 */
import { z } from "zod";
import {
  existsSync,
  mkdirSync,
  openSync,
  writeSync,
  fsyncSync,
  closeSync,
  renameSync,
  readFileSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";

export const SessionSchema = z.object({
  version: z.literal(1),
  app: z.string().min(1),
  deviceIds: z.object({
    deviceId: z.string().uuid(),
    installId: z.string().uuid(),
    sessionId: z.string().uuid(),
  }),
  authToken: z.string().min(1).nullable(),
  phoneNumber: z.string().min(1).nullable(),
  savedAt: z.string().min(1),
});

export type StoredSession = z.infer<typeof SessionSchema>;

export class SessionCorruptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionCorruptError";
  }
}

/**
 * T2 hardening (mode-only): a session file readable by group/other is
 * refused outright -- one notch stricter than merely creating with 0600.
 * A permission regression must fail loudly, never load quietly.
 */
export class SessionInsecureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionInsecureError";
  }
}

export class SessionStore {
  readonly baseDir: string;
  readonly filePath: string;
  readonly appSlug: string;

  constructor(appSlug: string, baseDir: string = join(homedir(), ".phonehands")) {
    if (!/^[a-z0-9-]+$/i.test(appSlug)) {
      throw new Error(`phonehands: invalid app slug "${appSlug}"`);
    }
    this.appSlug = appSlug;
    const resolved = resolve(baseDir);
    const candidate = resolve(resolved, `${appSlug}.session.json`);
    if (candidate !== resolved + sep + `${appSlug}.session.json`) {
      throw new Error("phonehands: session path escaped baseDir (path traversal blocked)");
    }
    this.baseDir = resolved;
    this.filePath = candidate;
  }

  private ensureDir(): void {
    mkdirSync(this.baseDir, { recursive: true, mode: 0o700 });
  }

  /** Persist a session atomically: temp (O_EXCL, 0600) -> fsync -> rename. */
  save(session: StoredSession): void {
    const parsed = SessionSchema.parse(session);
    this.ensureDir();
    const tmpPath = `${this.filePath}.${process.pid}.tmp`;
    const fd = openSync(tmpPath, "wx", 0o600);
    try {
      writeSync(fd, JSON.stringify(parsed, null, 2));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmpPath, this.filePath);
  }

  /** Load and validate. Returns null when no session exists. Throws
   *  SessionCorruptError on malformed content -- never silently repaired. */
  load(): StoredSession | null {
    if (!existsSync(this.filePath)) return null;
    // Strict permission gate (T2 mode): refuse to load when group/other
    // have ANY access bits, even if the content would otherwise parse.
    const mode = statSync(this.filePath).mode & 0o777;
    if ((mode & 0o077) !== 0) {
      throw new SessionInsecureError(
        `phonehands: refusing to load session for "${this.appSlug}" with overly broad ` +
          `permissions (mode ${mode.toString(8)}); expected 0600. Fix permissions or re-login.`,
      );
    }
    const raw = readFileSync(this.filePath, "utf8");
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new SessionCorruptError(
        `phonehands: session file for "${this.appSlug}" is not valid JSON; please re-login`,
      );
    }
    const result = SessionSchema.safeParse(data);
    if (!result.success) {
      throw new SessionCorruptError(
        `phonehands: session file for "${this.appSlug}" failed schema validation; please re-login`,
      );
    }
    return result.data;
  }

  clear(): void {
    if (existsSync(this.filePath)) {
      unlinkSync(this.filePath);
    }
  }
}

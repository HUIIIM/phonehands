// SPDX-License-Identifier: BUSL-1.1

/**
 * PHONEHANDS_RELAY_URL convention (shared with the iOS side):
 *
 *   PHONEHANDS_RELAY_URL="ws(s)://host:port/path"
 *
 * The phone and the agent read the SAME value. The phone dials it; the agent
 * listens on its port. Path is informational (lets one relay host serve
 * several endpoints); the server accepts any path.
 *
 * RelayPath values for healthcheck:
 *   "direct"     phone -> agent over a direct socket (LAN, mock, or wss URL)
 *   "ssh-tunnel" agent sits behind an SSH reverse tunnel the phone reaches
 *   "tailscale"  both ends on a Tailscale tailnet
 *   "usb"        reserved for the iOS/USB device backend; Android never uses it
 *
 * PHONEHANDS_RELAY_PATH overrides the inferred path when set.
 */

import type { RelayPath } from "./types.ts";

export const DEFAULT_RELAY_URL = "ws://127.0.0.1:9011/phonehands-android";
export const DEFAULT_PORT = 9011;
export const DEFAULT_BIND_HOST = "127.0.0.1";

export interface ParsedRelayUrl {
  /** The URL as configured (what the phone dials). */
  url: string;
  /** ws or wss. */
  scheme: "ws" | "wss";
  host: string;
  port: number;
  path: string;
  /** Inferred or overridden path kind for healthcheck output. */
  pathKind: RelayPath;
}

/** Read PHONEHANDS_RELAY_URL from the environment (fallback: DEFAULT_RELAY_URL). */
export function relayUrlFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  return env.PHONEHANDS_RELAY_URL?.trim() || DEFAULT_RELAY_URL;
}

/**
 * Parse a relay URL. Throws RelayUrlError (fail closed) on anything that is
 * not ws(s)://host:port/path. Secrets must never be embedded in the URL —
 * the relay token travels in hello.token, not in the URL.
 */
export function parseRelayUrl(raw: string, env: NodeJS.ProcessEnv = process.env): ParsedRelayUrl {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new RelayUrlError(`not a URL: ${raw}`);
  }
  if (u.protocol !== "ws:" && u.protocol !== "wss:") {
    throw new RelayUrlError(`scheme must be ws:// or wss://, got ${u.protocol}`);
  }
  if (u.username || u.password) {
    throw new RelayUrlError("credentials must not be embedded in the relay URL");
  }
  const port = u.port ? Number(u.port) : u.protocol === "wss:" ? 443 : 80;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new RelayUrlError(`invalid port in ${raw}`);
  }
  const override = env.PHONEHANDS_RELAY_PATH?.trim() as RelayPath | undefined;
  const pathKind: RelayPath =
    override === "ssh-tunnel" || override === "tailscale" || override === "direct" || override === "usb"
      ? override
      : inferPathKind(u.hostname);
  return {
    url: raw,
    scheme: u.protocol === "wss:" ? "wss" : "ws",
    host: u.hostname,
    port,
    path: u.pathname || "/",
    pathKind,
  };
}

function inferPathKind(hostname: string): RelayPath {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h === "127.0.0.1" || h === "::1") return "direct";
  // Tailscale MagicDNS names and 100.64.0.0/10 CGNAT range.
  if (h.endsWith(".ts.net") || h.startsWith("100.")) return "tailscale";
  return "direct";
}

export class RelayUrlError extends Error {
  constructor(message: string) {
    super(`relay-url: ${message}`);
    this.name = "RelayUrlError";
  }
}

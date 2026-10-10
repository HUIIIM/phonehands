// SPDX-License-Identifier: BUSL-1.1 (pending GC final review)

/**
 * Loopback-only guard (MV428 posture, mirroring iPhone Use).
 *
 * The device link must never be reachable from the network: forwarded
 * addresses are restricted to the loopback interface. Anything else —
 * LAN IPs, public IPs, DNS names — is rejected at configuration time,
 * before any socket is opened.
 */

import { DeviceSecurityError } from "./security-errors.ts";

/** Exact allowlist. Deliberately strict: 127.0.0.2/8 siblings are rejected. */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

function normalizeHostname(hostname: string): string {
  // URL.hostname strips brackets from IPv6 literals; handle both forms.
  const h = hostname.toLowerCase();
  return h.startsWith("[") && h.endsWith("]") ? h.slice(1, -1) : h;
}

/**
 * Throws DeviceSecurityError unless `hostname` is a loopback host.
 */
export function assertLoopbackHost(hostname: string): void {
  const h = normalizeHostname(hostname);
  if (!LOOPBACK_HOSTS.has(h)) {
    throw new DeviceSecurityError(
      `refusing non-loopback device address "${hostname}": ` +
        `device link is loopback-only (127.0.0.1 / ::1 / localhost)`,
    );
  }
}

/**
 * Parses a base URL and enforces loopback-only. Also rejects embedded
 * credentials (user:pass@host) as a basic SSRF hygiene measure.
 */
export function assertLoopbackUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new DeviceSecurityError(`invalid device base URL: ${rawUrl}`);
  }
  if (url.username || url.password) {
    throw new DeviceSecurityError(
      `refusing device URL with embedded credentials: ${rawUrl}`,
    );
  }
  if (url.protocol !== "http:") {
    throw new DeviceSecurityError(
      `device URL must use http (loopback only), got: ${url.protocol}`,
    );
  }
  assertLoopbackHost(url.hostname);
  return url;
}

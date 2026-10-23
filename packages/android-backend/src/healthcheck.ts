// SPDX-License-Identifier: BUSL-1.1

/**
 * Relay healthcheck — the unified JSON schema shared with the iOS side:
 *
 *   { relay, reachable: bool, latency_ms, path: "ssh-tunnel"|"tailscale"|"direct"|"usb" }
 *
 * Procedure: open a WebSocket to PHONEHANDS_RELAY_URL, wait for the server to
 * accept the socket (agent side needs no hello for a bare reachability
 * check — we just measure TCP+WS handshake), then close.
 *
 * Android never reports path "usb"; wireless paths are direct / ssh-tunnel /
 * tailscale (PHONEHANDS_RELAY_PATH overrides inference).
 */

import { WebSocket } from "ws";
import { parseRelayUrl, relayUrlFromEnv } from "./relay-url.ts";
import type { RelayHealth } from "./types.ts";

export async function checkRelay(
  rawUrl?: string,
  timeoutMs = 5_000,
): Promise<RelayHealth> {
  const url = rawUrl ?? relayUrlFromEnv();
  let parsed;
  try {
    parsed = parseRelayUrl(url);
  } catch {
    return { relay: url, reachable: false, latency_ms: -1, path: "direct" };
  }
  const started = Date.now();
  return new Promise((resolve) => {
    let settled = false;
    const done = (h: RelayHealth) => {
      if (!settled) {
        settled = true;
        resolve(h);
      }
    };
    const timer = setTimeout(() => {
      done({ relay: url, reachable: false, latency_ms: -1, path: parsed.pathKind });
    }, timeoutMs);
    timer.unref?.();
    let ws: WebSocket;
    try {
      ws = new WebSocket(url, { handshakeTimeout: timeoutMs });
    } catch {
      clearTimeout(timer);
      done({ relay: url, reachable: false, latency_ms: -1, path: parsed.pathKind });
      return;
    }
    ws.once("open", () => {
      const latency = Date.now() - started;
      clearTimeout(timer);
      ws.close();
      done({ relay: url, reachable: true, latency_ms: latency, path: parsed.pathKind });
    });
    ws.once("error", () => {
      clearTimeout(timer);
      try { ws.close(); } catch { /* noop */ }
      done({ relay: url, reachable: false, latency_ms: -1, path: parsed.pathKind });
    });
  });
}

// SPDX-License-Identifier: BUSL-1.1 (pending GC final review)
// Shared mock backends for @phonehands/core tests. Mocks only — no real accounts.

import type { ActionName } from "../src/actions.ts";
import { capabilitiesFor } from "../src/backend.ts";
import type { Backend } from "../src/backend.ts";
import type { ActionResult, BackendKind, DevicePlatform } from "../src/types.ts";

export type InvokeHandler = (action: ActionName, args: Record<string, unknown>) => Promise<ActionResult>;

export function okResult(overrides: Partial<ActionResult> = {}): ActionResult {
  return {
    ok: true,
    backend: "api",
    latency_ms: 1,
    degraded: false,
    escalated: false,
    evidence: null,
    ...overrides,
  };
}

export function errResult(code: string, message: string, overrides: Partial<ActionResult> = {}): ActionResult {
  return {
    ...okResult(overrides),
    ok: false,
    error: { code, message },
  };
}

export class MockBackend implements Backend {
  readonly calls: Array<{ action: ActionName; args: Record<string, unknown> }> = [];
  healthy = true;
  readonly name: string;
  readonly kind: BackendKind;
  readonly capabilities: Record<ActionName, boolean>;
  readonly devicePlatform?: DevicePlatform;
  private readonly handler: InvokeHandler;

  constructor(
    name: string,
    kind: BackendKind,
    capabilities: Record<ActionName, boolean>,
    devicePlatform?: DevicePlatform,
    handler: InvokeHandler = async () => okResult()
  ) {
    this.name = name;
    this.kind = kind;
    this.capabilities = capabilities;
    this.devicePlatform = devicePlatform;
    this.handler = handler;
  }

  async invoke(action: ActionName, args: Record<string, unknown>): Promise<ActionResult> {
    this.calls.push({ action, args });
    return this.handler(action, args);
  }

  async checkHealth(): Promise<boolean> {
    return this.healthy;
  }
}

export function apiBackend(handler?: InvokeHandler, name = "mock-api"): MockBackend {
  return new MockBackend(
    name,
    "api",
    capabilitiesFor("observe", "read", "screenshot"),
    undefined,
    handler ?? (async () => okResult({ backend: "api", evidence: { via: "api" } }))
  );
}

export function deviceBackend(platform: DevicePlatform, handler?: InvokeHandler): MockBackend {
  return new MockBackend(
    `mock-device-${platform}`,
    "device",
    capabilitiesFor("observe", "tap", "tap_text", "swipe", "type_text", "read", "launch_app", "press_home", "screenshot"),
    platform,
    handler ??
      (async () => okResult({ backend: "device", devicePlatform: platform, evidence: { via: "device" } }))
  );
}

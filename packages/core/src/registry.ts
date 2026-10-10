// SPDX-License-Identifier: BUSL-1.1 (pending GC final review)
// Action registry: which actions exist in THIS build, and which backends
// are registered. Write actions are registered only in full builds.

import { PHONEHANDS_READ_ONLY } from "./__buildFlags.ts";
import { ALL_ACTION_NAMES, WRITE_ACTION_NAMES } from "./actions.ts";
import type { ActionName } from "./actions.ts";
import type { Backend } from "./backend.ts";
import { PlatformDeclarationError } from "./errors.ts";

export class ActionRegistry {
  private readonly actions = new Set<ActionName>();
  private readonly backends: Backend[] = [];

  constructor() {
    for (const name of ALL_ACTION_NAMES) {
      if (WRITE_ACTION_NAMES.includes(name) && PHONEHANDS_READ_ONLY) {
        continue; // compile-time gate: not registered, not blocked — absent
      }
      this.actions.add(name);
    }
  }

  /** True when built with PHONEHANDS_READ_ONLY=1. */
  get readOnly(): boolean {
    return PHONEHANDS_READ_ONLY;
  }

  registerBackend(backend: Backend): void {
    if (backend.kind === "device" && backend.devicePlatform !== "ios" && backend.devicePlatform !== "android") {
      throw new PlatformDeclarationError(backend.name);
    }
    this.backends.push(backend);
  }

  getBackends(): readonly Backend[] {
    return this.backends;
  }

  hasAction(action: string): action is ActionName {
    return this.actions.has(action as ActionName);
  }

  listActions(): ActionName[] {
    return [...this.actions];
  }
}

// SPDX-License-Identifier: BUSL-1.1
// Write-action capability list. In a read-only build (PHONEHANDS_READ_ONLY=1)
// importing this module throws immediately — write actions do not exist in
// that build, at any layer. (Compile-time switch, hinge-mcp P3.)

import { PHONEHANDS_READ_ONLY } from "./__buildFlags.ts";
import type { ActionName } from "./actions.ts";

if (PHONEHANDS_READ_ONLY) {
  throw new Error(
    "[phonehands] read-only build: write actions are not compiled in (built with PHONEHANDS_READ_ONLY=1)"
  );
}

/** Write actions available in a full (non-read-only) build. */
export const REGISTERED_WRITE_ACTIONS: readonly ActionName[] = [
  "tap",
  "tap_text",
  "swipe",
  "type_text",
  "launch_app",
  "press_home",
];

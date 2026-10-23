// SPDX-License-Identifier: BUSL-1.1

/**
 * Write-tool gating: default deny + precise allowlist.
 *
 * Pattern learned from T2 (vanxh/instagram-personal-mcp) -- MODE ONLY, no
 * code copied; license compatibility of T2 is pending GC ruling.
 *
 * This complements (not replaces) the compile-time read-only switch in
 * @phonehands/api-backend:
 *
 *   - api-backend: write actions do not exist in code at all (strongest).
 *   - this adapter: IF write tools are ever implemented (Phase 2), they are
 *     NOT registered by default. Only names explicitly listed in the
 *     HINGE_ALLOWED_WRITE_TOOLS environment variable (comma-separated) are
 *     enabled. Everything else -- including typos -- stays denied.
 *
 * Phase 1 status: zero write tools are implemented, so the allowlist
 * currently enables nothing. The mechanism is in place and tested so Phase 2
 * cannot accidentally ship an open write surface.
 */

export interface WriteToolDef {
  /** Stable tool name, e.g. "send_message". */
  name: string;
  description: string;
}

/**
 * Registry of write tools this adapter knows how to perform.
 * Phase 1: intentionally empty. Phase 2 additions go here AND must pass
 * the allowlist below before they become callable.
 */
export const KNOWN_WRITE_TOOLS: WriteToolDef[] = [];

export const WRITE_ALLOWLIST_ENV = "HINGE_ALLOWED_WRITE_TOOLS";

/** Parse the comma-separated allowlist env var into a clean name list. */
export function parseWriteAllowlist(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env[WRITE_ALLOWLIST_ENV] ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** The write tools actually enabled right now: known AND allowlisted. */
export function getEnabledWriteTools(env: NodeJS.ProcessEnv = process.env): WriteToolDef[] {
  const allowed = new Set(parseWriteAllowlist(env));
  return KNOWN_WRITE_TOOLS.filter((tool) => allowed.has(tool.name));
}

export class WriteNotEnabledError extends Error {
  constructor(toolName: string) {
    super(
      `phonehands: write tool "${toolName}" is not enabled. Writes are denied by default; ` +
        `enable explicitly via ${WRITE_ALLOWLIST_ENV}="${toolName}" (and only after the tool is implemented and reviewed).`,
    );
    this.name = "WriteNotEnabledError";
  }
}

/**
 * Gate every write attempt through the allowlist. Throws WriteNotEnabledError
 * unless the tool is both implemented and explicitly allowlisted.
 */
export function assertWriteEnabled(toolName: string, env: NodeJS.ProcessEnv = process.env): void {
  const enabled = getEnabledWriteTools(env);
  if (!enabled.some((t) => t.name === toolName)) {
    throw new WriteNotEnabledError(toolName);
  }
}

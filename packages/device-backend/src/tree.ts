// SPDX-License-Identifier: BUSL-1.1 (pending GC final review)

/**
 * Dependency-free parse of WDA GET /source XML into UiNodes.
 * Written from scratch for phonehands (no upstream code).
 */

import type { UiNode, UiTree } from "./types.ts";

const TAG_RE = /<(\/?)([A-Za-z0-9_]+)((?:\s+[A-Za-z0-9_]+="[^"]*")*)\s*(\/?)>/g;
const ATTR_RE = /([A-Za-z0-9_]+)="([^"]*)"/g;

function parseAttrs(attrString: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(attrString)) !== null) {
    attrs[m[1] as string] = m[2] as string;
  }
  return attrs;
}

function toNum(s: string | undefined): number {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function toBool(s: string | undefined): boolean {
  return s === "true";
}

/**
 * Parses WDA /source XML into a UiTree.
 * Returns null when the XML is empty, malformed, or contains no
 * application node (the known "empty tree" case, e.g. self-drawn UIs).
 */
export function parseAccessibilityTree(xml: string): UiTree | null {
  if (!xml || !xml.trim()) return null;
  const nodes: UiNode[] = [];
  let depth = 0;
  TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_RE.exec(xml)) !== null) {
    const closing = m[1] === "/";
    const tagName = m[2] as string;
    const attrString = m[3] as string;
    const selfClosing = m[4] === "/";
    if (closing) {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (tagName.startsWith("XCUIElementType")) {
      const a = parseAttrs(attrString);
      nodes.push({
        type: tagName,
        name: a["name"] ?? "",
        label: a["label"] ?? "",
        value: a["value"] ?? "",
        enabled: toBool(a["enabled"]),
        visible: toBool(a["visible"]),
        x: toNum(a["x"]),
        y: toNum(a["y"]),
        width: toNum(a["width"]),
        height: toNum(a["height"]),
        depth,
      });
    }
    if (!selfClosing) depth += 1;
  }
  if (!nodes.some((n) => n.type === "XCUIElementTypeApplication")) return null;
  return { nodes, rawXml: xml };
}

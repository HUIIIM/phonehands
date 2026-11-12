// SPDX-License-Identifier: BUSL-1.1

/**
 * Dependency-free parse of WDA GET /source XML into UiNodes.
 * Written from scratch for phonehands (no upstream code).
 */

import type { UiNode, UiTree } from "./types.ts";

// Hand-written single-pass scanner instead of regexes: XML comes from the
// device (WDA), and the earlier /([A-Za-z0-9_]+)="([^"]*)"/g was quadratic on
// long identifier runs without `="` (CodeQL js/polynomial-redos). Accepts
// exactly what the old patterns did: <name( ws+ attr="value")* ws* /?>.
function isNameChar(c: number): boolean {
  return (
    (c >= 48 && c <= 57) || // 0-9
    (c >= 65 && c <= 90) || // A-Z
    (c >= 97 && c <= 122) || // a-z
    c === 95 // _
  );
}

function isSpace(ch: string): boolean {
  return /\s/.test(ch);
}

interface ScannedTag {
  closing: boolean;
  name: string;
  attrs: Record<string, string>;
  selfClosing: boolean;
  end: number; // index just past '>'
}

/** Parse one tag starting at xml[i] === "<"; null if it is not a well-formed tag. */
function scanTag(xml: string, i: number): ScannedTag | null {
  let j = i + 1;
  const closing = xml[j] === "/";
  if (closing) j++;
  const nameStart = j;
  while (j < xml.length && isNameChar(xml.charCodeAt(j))) j++;
  if (j === nameStart) return null;
  const name = xml.slice(nameStart, j);
  const attrs: Record<string, string> = {};
  for (;;) {
    let k = j;
    while (k < xml.length && isSpace(xml[k] as string)) k++;
    if (k === j) break; // attributes must be preceded by whitespace
    const keyStart = k;
    while (k < xml.length && isNameChar(xml.charCodeAt(k))) k++;
    if (k === keyStart || xml[k] !== "=" || xml[k + 1] !== '"') break;
    const valueEnd = xml.indexOf('"', k + 2);
    if (valueEnd === -1) break;
    attrs[xml.slice(keyStart, k)] = xml.slice(k + 2, valueEnd);
    j = valueEnd + 1;
  }
  while (j < xml.length && isSpace(xml[j] as string)) j++;
  const selfClosing = xml[j] === "/";
  if (selfClosing) j++;
  if (xml[j] !== ">") return null;
  return { closing, name, attrs, selfClosing, end: j + 1 };
}

function* scanTags(xml: string): Generator<ScannedTag> {
  let i = xml.indexOf("<");
  while (i !== -1) {
    const tag = scanTag(xml, i);
    if (tag) {
      yield tag;
      i = xml.indexOf("<", tag.end);
    } else {
      i = xml.indexOf("<", i + 1);
    }
  }
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
  for (const tag of scanTags(xml)) {
    const { closing, selfClosing } = tag;
    const tagName = tag.name;
    if (closing) {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (tagName.startsWith("XCUIElementType")) {
      const a = tag.attrs;
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

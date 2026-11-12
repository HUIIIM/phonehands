// SPDX-License-Identifier: MIT

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseAccessibilityTree } from "../src/tree.ts";

describe("parseAccessibilityTree", () => {
  it("parses attributes, depth, self-closing and closing tags", () => {
    const xml =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<XCUIElementTypeApplication name="App" label="Hinge" enabled="true" visible="true" x="0" y="0" width="390" height="844">' +
      '<XCUIElementTypeButton name="like" label="Like" value="" enabled="true" visible="false" x="10" y="20" width="30" height="40"/>' +
      "<!-- not a tag --><broken <XCUIElementTypeOther name=\"o\">" +
      "</XCUIElementTypeOther>" +
      "</XCUIElementTypeApplication>";
    const tree = parseAccessibilityTree(xml);
    assert.ok(tree);
    assert.deepEqual(
      tree.nodes.map((n) => [n.type, n.name, n.label, n.enabled, n.visible, n.width, n.depth]),
      [
        ["XCUIElementTypeApplication", "App", "Hinge", true, true, 390, 0],
        ["XCUIElementTypeButton", "like", "Like", true, false, 30, 1],
        ["XCUIElementTypeOther", "o", "", false, false, 0, 1],
      ],
    );
  });

  it("returns null without an application node", () => {
    assert.equal(parseAccessibilityTree('<XCUIElementTypeButton name="x"/>'), null);
    assert.equal(parseAccessibilityTree("   "), null);
  });

  it("stays linear on hostile device XML (CodeQL js/polynomial-redos)", () => {
    // The old ATTR_RE took ~1.7 s on 40k '0's in isolation; these are 200k.
    const N = 200_000;
    const hostile = [
      `<XCUIElementTypeApplication ${"0".repeat(N)}>`,
      `<XCUIElementTypeApplication a="1" ${"0".repeat(N)}="x">`,
      "<" + "0".repeat(N),
      "<a" + ' b=""'.repeat(N / 5) + "x",
      "<0".repeat(N / 2),
      `<a x="${"<".repeat(N)}`,
    ];
    for (const xml of hostile) {
      const started = performance.now();
      parseAccessibilityTree(xml);
      const ms = performance.now() - started;
      assert.ok(ms < 250, `took ${ms.toFixed(0)} ms on a ${xml.length}-char input`);
    }
  });
});

// SPDX-License-Identifier: BUSL-1.1 (pending GC final review)

/**
 * Fixed accessibility-tree fixture returned by the mock WDA server
 * for GET /source. Small but structurally realistic (application ->
 * window -> button + static text with rects).
 */
export const FIXTURE_TREE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<XCUIElementTypeApplication type="XCUIElementTypeApplication" name="SpringBoard" label="SpringBoard" enabled="true" visible="true" x="0" y="0" width="390" height="844">
  <XCUIElementTypeWindow type="XCUIElementTypeWindow" enabled="true" visible="true" x="0" y="0" width="390" height="844">
    <XCUIElementTypeButton type="XCUIElementTypeButton" name="Messages" label="Messages" enabled="true" visible="true" x="20" y="700" width="60" height="60"/>
    <XCUIElementTypeStaticText type="XCUIElementTypeStaticText" name="clock" label="9:41" value="9:41" enabled="true" visible="true" x="175" y="20" width="40" height="20"/>
  </XCUIElementTypeWindow>
</XCUIElementTypeApplication>`;

/**
 * A real 1x1 black PNG (base64). PNG magic decodes to
 * 89 50 4e 47 0d 0a 1a 0a — asserted in tests.
 */
export const FIXTURE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYGBgAAAABQABXvMqOgAAAABJRU5ErkJggg==";

/** Logical screen size the mock reports for GET /window/size. */
export const FIXTURE_WINDOW_SIZE = { width: 390, height: 844 };

/**
 * Builds a minimal but well-formed PNG header with arbitrary
 * dimensions (magic + IHDR). Sufficient for pngDimensions(); the
 * mock /screenshot still returns the real 1x1 PNG above.
 */
export function makePngBytes(width: number, height: number): Buffer {
  const buf = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8); // IHDR length
  buf.write("IHDR", 12, 4, "ascii");
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  buf[24] = 8; // bit depth
  buf[25] = 2; // color type: truecolor
  // (CRC omitted on purpose — dimension parsing does not validate it)
  return buf;
}

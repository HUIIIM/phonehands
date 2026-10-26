// SPDX-License-Identifier: BUSL-1.1

/**
 * Screenshot-fallback pixel mapping (no-auto-replay rule closed loop).
 *
 * When the accessibility tree is unavailable, observe() returns a
 * screenshot with tree_unavailable=true. Pixel locating is the caller's
 * job (model vision / human operator). This module converts the caller's
 * normalized box (0..1, relative to screenshot pixels) into WDA tap
 * coordinates.
 *
 * ---- Coordinate systems (the part everyone gets wrong) ----
 *
 *   1. Screenshot space: physical pixels. Dimensions come from the PNG
 *      itself (IHDR), e.g. 1170x2532 on a 3x iPhone.
 *   2. WDA tap space: logical points, e.g. 390x844. This is what
 *      POST /session/:id/wda/tap expects.
 *   3. Scale (per axis; on iOS both axes equal the device pixel ratio):
 *        scaleX = screenshotWidth  / logicalWidth
 *        scaleY = screenshotHeight / logicalHeight
 *      tap = screenshotPixel / scale.
 *
 *      The two axes MUST agree (within 2%): when they don't, the
 *      screenshot and the logical frame disagree about orientation, and
 *      no single factor places the point — this is the fixed upstream
 *      approach (ios-agent _scale_for / _SCALE_TOLERANCE): fail loudly
 *      with OrientationMismatchError instead of tapping the wrong place.
 *      Pattern learned from emazaheri/ios-agent (MIT); implemented here
 *      from scratch.
 *
 *   4. Orientation: WDA screenshots rotate WITH the device, while tap
 *      coordinates stay in the portrait logical frame. A landscape
 *      screenshot must therefore be un-rotated back to the portrait
 *      pixel frame BEFORE scaling. With (lx,ly) the screenshot pixel,
 *      Wl/Hl the screenshot dims, and (px,py) the portrait-frame pixel:
 *
 *        portrait (identity):          (px,py) = (lx, ly)
 *        landscape-left  (CW  90 deg):  (px,py) = (ly, Wl - lx)
 *        landscape-right (CCW 90 deg):  (px,py) = (Hl - ly, lx)
 *        portrait-upside-down (180):   (px,py) = (Wl - lx, Hl - ly)
 *
 *      Derivation (CW 90 deg): a portrait pixel (x,y) in a Wp x Hp
 *      frame maps to landscape (Hp - y, x) in a Hp x Wp frame
 *      (top-left -> top-right, correct for clockwise). Inverting with
 *      Wl = Hp gives (px,py) = (ly, Wl - lx). Sanity check: the
 *      center of the screenshot always maps to the center of the
 *      logical frame, in every orientation.
 *
 *      Logical size source: GET /session/:id/window/size (points),
 *      exposed as WdaClient.windowSize(). Orientation source: the
 *      caller knows it (last good tree root, /orientation, or the
 *      screenshot-vs-logical aspect ratio).
 *
 * No retries, no guessing: out-of-range boxes and non-PNG input throw.
 */

export interface NormalizedBox {
  /** Top-left corner + size, each in 0..1 relative to screenshot pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Screenshot orientation relative to the portrait logical frame. */
export type ScreenshotOrientation =
  | "portrait"
  | "landscape-left"
  | "landscape-right"
  | "portrait-upside-down";

export interface FallbackGeometry {
  /** WDA logical size in points (from GET /session/:id/window/size). */
  logicalWidth: number;
  logicalHeight: number;
  screenshotOrientation: ScreenshotOrientation;
}

export interface TapPoint {
  x: number;
  y: number;
}

/**
 * Width and height must agree on the scale to within this much. They
 * disagree when the screenshot is not in the logical frame's
 * orientation, and then no single factor places the point.
 */
export const SCALE_TOLERANCE = 0.02;

/** Thrown when screenshot and logical frame disagree on orientation. */
export class OrientationMismatchError extends Error {
  constructor(screenshotW: number, screenshotH: number, logicalW: number, logicalH: number) {
    super(
      `screenshot is ${screenshotW}x${screenshotH} px but the logical frame is ` +
        `${logicalW}x${logicalH} pt, which is not one scale — the image and the ` +
        `accessibility frame disagree about the orientation. Re-observe and ` +
        `take the screenshot again.`,
    );
    this.name = "OrientationMismatchError";
  }
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Reads (width, height) from a PNG's IHDR chunk. Throws on non-PNG
 * input or insane dimensions. No CRC validation — dimensions only.
 */
export function pngDimensions(png: Buffer): { width: number; height: number } {
  if (png.length < 24 || !png.subarray(0, 8).equals(PNG_MAGIC)) {
    throw new TypeError("screenshotToTapPoint: input is not a PNG image");
  }
  // 8 magic + 4 length + 4 "IHDR" + 4 width + 4 height
  if (png.toString("ascii", 12, 16) !== "IHDR") {
    throw new TypeError("screenshotToTapPoint: PNG missing IHDR chunk");
  }
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (width === 0 || height === 0 || width > 100_000 || height > 100_000) {
    throw new RangeError(
      `screenshotToTapPoint: implausible PNG dimensions ${width}x${height}`,
    );
  }
  return { width, height };
}

function validateBox(box: NormalizedBox): void {
  const fields: Array<[string, number]> = [
    ["x", box.x],
    ["y", box.y],
    ["width", box.width],
    ["height", box.height],
  ];
  for (const [name, v] of fields) {
    if (!Number.isFinite(v)) {
      throw new RangeError(`normalized box: ${name} is not a finite number`);
    }
  }
  if (box.x < 0 || box.y < 0 || box.x > 1 || box.y > 1) {
    throw new RangeError(
      `normalized box: x/y must be in [0,1], got (${box.x}, ${box.y})`,
    );
  }
  if (box.width <= 0 || box.height <= 0 || box.width > 1 || box.height > 1) {
    throw new RangeError(
      `normalized box: width/height must be in (0,1], got (${box.width}, ${box.height})`,
    );
  }
  if (box.x + box.width > 1 || box.y + box.height > 1) {
    throw new RangeError(
      `normalized box: box exceeds the [0,1] frame: ${JSON.stringify(box)}`,
    );
  }
}

/**
 * Maps a normalized screenshot box to WDA tap coordinates.
 *
 * @param screenshot raw PNG bytes (e.g. from observe()'s screenshot fallback)
 * @param box        normalized box {x,y,width,height} in 0..1, top-left origin
 * @param geometry   logical size + screenshot orientation
 * @returns          tap point in WDA logical coordinates (points)
 */
export function screenshotToTapPoint(
  screenshot: Buffer,
  box: NormalizedBox,
  geometry: FallbackGeometry,
): TapPoint {
  validateBox(box);
  if (
    !Number.isFinite(geometry.logicalWidth) ||
    geometry.logicalWidth <= 0 ||
    !Number.isFinite(geometry.logicalHeight) ||
    geometry.logicalHeight <= 0
  ) {
    throw new RangeError(
      `fallback geometry: logical size must be positive, got ${geometry.logicalWidth}x${geometry.logicalHeight}`,
    );
  }

  const { width: sw, height: sh } = pngDimensions(screenshot);

  // Box center -> screenshot pixels.
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const lx = cx * sw;
  const ly = cy * sh;

  // Un-rotate into the portrait pixel frame.
  let px: number;
  let py: number;
  let portraitPixelWidth: number;
  let portraitPixelHeight: number;
  switch (geometry.screenshotOrientation) {
    case "portrait":
      px = lx;
      py = ly;
      portraitPixelWidth = sw;
      portraitPixelHeight = sh;
      break;
    case "landscape-left":
      px = ly;
      py = sw - lx;
      portraitPixelWidth = sh;
      portraitPixelHeight = sw;
      break;
    case "landscape-right":
      px = sh - ly;
      py = lx;
      portraitPixelWidth = sh;
      portraitPixelHeight = sw;
      break;
    case "portrait-upside-down":
      px = sw - lx;
      py = sh - ly;
      portraitPixelWidth = sw;
      portraitPixelHeight = sh;
      break;
    default: {
      const exhaustive: never = geometry.screenshotOrientation;
      throw new RangeError(`unknown screenshot orientation: ${String(exhaustive)}`);
    }
  }

  const scaleX = portraitPixelWidth / geometry.logicalWidth;
  const scaleY = portraitPixelHeight / geometry.logicalHeight;
  if (Math.abs(scaleX - scaleY) > SCALE_TOLERANCE * Math.max(scaleX, scaleY)) {
    // The screenshot and the logical frame disagree about orientation.
    // There is no single factor that places the point; tapping anyway
    // would be confidently wrong.
    throw new OrientationMismatchError(sw, sh, geometry.logicalWidth, geometry.logicalHeight);
  }
  return { x: px / scaleX, y: py / scaleY };
}

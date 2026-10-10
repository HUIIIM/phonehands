// SPDX-License-Identifier: BUSL-1.1 (pending GC final review)

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

import {
  DeviceBackend,
  OrientationMismatchError,
  pngDimensions,
  screenshotToTapPoint,
} from "../src/index.ts";
import { MockWdaServer } from "./mock-server.ts";
import { makePngBytes } from "./fixtures.ts";

describe("screenshotToTapPoint", () => {
  it("portrait: 3x screenshot maps box center to logical points", () => {
    // logical 390x844, screenshot 1170x2532 (3x)
    const png = makePngBytes(1170, 2532);
    const pt = screenshotToTapPoint(
      png,
      { x: 0.4, y: 0.4, width: 0.2, height: 0.2 }, // center (0.5, 0.5)
      { logicalWidth: 390, logicalHeight: 844, screenshotOrientation: "portrait" },
    );
    assert.deepEqual(pt, { x: 195, y: 422 });
  });

  it("portrait: off-center box", () => {
    const png = makePngBytes(1170, 2532);
    const pt = screenshotToTapPoint(
      png,
      { x: 0.1, y: 0.2, width: 0.2, height: 0.1 }, // center (0.2, 0.25)
      { logicalWidth: 390, logicalHeight: 844, screenshotOrientation: "portrait" },
    );
    // pixel (234, 633) / 3
    assert.deepEqual(pt, { x: 78, y: 211 });
  });

  it("landscape-left: center maps to logical center", () => {
    // logical 390x844 portrait frame, screenshot 2532x1170 (CW 90 deg)
    const png = makePngBytes(2532, 1170);
    const pt = screenshotToTapPoint(
      png,
      { x: 0.4, y: 0.4, width: 0.2, height: 0.2 },
      { logicalWidth: 390, logicalHeight: 844, screenshotOrientation: "landscape-left" },
    );
    assert.deepEqual(pt, { x: 195, y: 422 });
  });

  it("landscape-left: off-center box", () => {
    const png = makePngBytes(2532, 1170);
    const pt = screenshotToTapPoint(
      png,
      { x: 0.1, y: 0.2, width: 0.2, height: 0.1 }, // center (0.2, 0.25)
      { logicalWidth: 390, logicalHeight: 844, screenshotOrientation: "landscape-left" },
    );
    // landscape px (506.4, 292.5) -> portrait px (292.5, 2025.6) / 3
    assert.ok(Math.abs(pt.x - 97.5) < 1e-9, `x=${pt.x}`);
    assert.ok(Math.abs(pt.y - 675.2) < 1e-9, `y=${pt.y}`);
  });

  it("landscape-right: off-center box", () => {
    const png = makePngBytes(2532, 1170);
    const pt = screenshotToTapPoint(
      png,
      { x: 0.1, y: 0.2, width: 0.2, height: 0.1 }, // center (0.2, 0.25)
      { logicalWidth: 390, logicalHeight: 844, screenshotOrientation: "landscape-right" },
    );
    // landscape px (506.4, 292.5) -> portrait px (877.5, 506.4) / 3
    assert.ok(Math.abs(pt.x - 292.5) < 1e-9, `x=${pt.x}`);
    assert.ok(Math.abs(pt.y - 168.8) < 1e-9, `y=${pt.y}`);
  });

  it("portrait-upside-down: center maps to logical center", () => {
    const png = makePngBytes(1170, 2532);
    const pt = screenshotToTapPoint(
      png,
      { x: 0.4, y: 0.4, width: 0.2, height: 0.2 },
      {
        logicalWidth: 390,
        logicalHeight: 844,
        screenshotOrientation: "portrait-upside-down",
      },
    );
    assert.deepEqual(pt, { x: 195, y: 422 });
  });

  it("scale disagreement (orientation mismatch) fails loudly, not wrongly", () => {
    // Screenshot 2532x1170 claimed portrait against a 390x844 frame:
    // no single scale factor — must throw, not tap the wrong place.
    const png = makePngBytes(2532, 1170);
    assert.throws(
      () =>
        screenshotToTapPoint(
          png,
          { x: 0.4, y: 0.4, width: 0.2, height: 0.2 },
          { logicalWidth: 390, logicalHeight: 844, screenshotOrientation: "portrait" },
        ),
      OrientationMismatchError,
    );
  });

  it("rejects out-of-range boxes", () => {
    const png = makePngBytes(1170, 2532);
    const geo = {
      logicalWidth: 390,
      logicalHeight: 844,
      screenshotOrientation: "portrait" as const,
    };
    assert.throws(() =>
      screenshotToTapPoint(png, { x: 1.5, y: 0, width: 0.1, height: 0.1 }, geo),
      RangeError,
    );
    assert.throws(() =>
      screenshotToTapPoint(png, { x: 0.9, y: 0, width: 0.2, height: 0.1 }, geo),
      RangeError,
    );
    assert.throws(() =>
      screenshotToTapPoint(png, { x: 0, y: 0, width: 0, height: 0.1 }, geo),
      RangeError,
    );
  });

  it("rejects non-PNG input", () => {
    const geo = {
      logicalWidth: 390,
      logicalHeight: 844,
      screenshotOrientation: "portrait" as const,
    };
    assert.throws(
      () =>
        screenshotToTapPoint(
          Buffer.from("not a png"),
          { x: 0, y: 0, width: 0.5, height: 0.5 },
          geo,
        ),
      TypeError,
    );
  });

  it("pngDimensions reads IHDR width/height", () => {
    assert.deepEqual(pngDimensions(makePngBytes(1170, 2532)), {
      width: 1170,
      height: 2532,
    });
  });
});

describe("closed loop: tree fail -> screenshot -> per-frame mapping -> tap", () => {
  let server: MockWdaServer;
  let backend: DeviceBackend;

  before(async () => {
    server = new MockWdaServer();
    await server.start();
    backend = new DeviceBackend({ baseUrl: server.baseUrl, requestTimeoutMs: 2000 });
    const env = await backend.connect();
    assert.equal(env.ok, true);
  });

  after(async () => {
    server.resetBehavior();
    await server.stop();
  });

  it("full caller flow runs end to end with a single tap", async () => {
    // 1. tree unavailable
    server.setBehavior("source", "drop");
    server.resetCalls();
    const obs = await backend.observe();
    assert.equal(obs.ok, true);
    assert.equal(obs.degraded, true);
    assert.equal(obs.evidence["tree_unavailable"], true);
    const shot = obs.evidence["screenshot"] as Buffer;

    // 2+3. caller maps the box with a FRESH /window/size read per frame
    // (mock: 390x844 logical, 1x1 screenshot).
    const pt = await backend.mapScreenshotBox(
      shot,
      { x: 0.4, y: 0.4, width: 0.2, height: 0.2 },
      "portrait",
    );
    assert.deepEqual(pt, { x: 195, y: 422 });

    // 4. single tap, no blind retry anywhere in the chain
    const tapEnv = await backend.tap(pt.x, pt.y);
    assert.equal(tapEnv.ok, true);
    const taps = server.calls.filter((c) => c.path.endsWith("/wda/tap"));
    assert.equal(taps.length, 1);
    assert.deepEqual(taps[0]?.body, { x: 195, y: 422 });
    server.setBehavior("source", "ok");
  });
});

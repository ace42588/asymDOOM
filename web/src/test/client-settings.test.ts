import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  STORAGE_KEY,
  DEFAULT_SETTINGS,
  clampSettings,
  resolveRenderScale,
  worldSizeForRenderScale,
  resolveCanvasCssSize,
  hudDestRect,
  loadClientSettings,
  getClientSettings,
  setClientSettings,
  NATIVE_W,
  NATIVE_H,
  WASM_W,
  WASM_H,
  WASM_SCALE,
} from "../thin/clientSettings.ts";
import { LOOK_SENS, effectiveLookSens } from "../thin/input.ts";

/** In-memory localStorage stub for Node tests. */
function installMemoryStorage() {
  const map = new Map<string, string>();
  const store = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      map.set(k, String(v));
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => map.clear(),
  };
  (globalThis as { localStorage?: typeof store }).localStorage = store;
  return store;
}

describe("client settings", () => {
  beforeEach(() => {
    installMemoryStorage();
    localStorage.removeItem(STORAGE_KEY);
    loadClientSettings();
  });

  it("clampSettings fills defaults for empty / garbage input", () => {
    assert.deepEqual(clampSettings(null), DEFAULT_SETTINGS);
    assert.equal(DEFAULT_SETTINGS.canvasScale, "fit");
  });

  it("clampSettings clamps lookSens and hudScale ranges", () => {
    const s = clampSettings({ lookSens: 99, hudScale: 0.1, showCrosshair: false });
    assert.equal(s.lookSens, 4);
    assert.equal(s.hudScale, 0.5);
    assert.equal(s.showCrosshair, false);
  });

  it("clampSettings rejects unsupported render scales (3× / 5×)", () => {
    assert.equal(clampSettings({ renderScale: 3 }).renderScale, "auto");
    assert.equal(clampSettings({ renderScale: 5 }).renderScale, "auto");
    assert.equal(clampSettings({ renderScale: 2 }).renderScale, 2);
  });

  it("migrates legacy viewScale key to renderScale", () => {
    assert.equal(clampSettings({ viewScale: 2 }).renderScale, 2);
  });

  it("persists canvasScale round-trip", () => {
    setClientSettings({
      lookSens: 1.5,
      renderScale: 2,
      canvasScale: 2,
      hudPlacement: "below",
      hudScale: 0.75,
      showCrosshair: false,
    });
    const again = loadClientSettings();
    assert.equal(again.renderScale, 2);
    assert.equal(again.canvasScale, 2);
    assert.equal(again.hudPlacement, "below");
  });

  it("resolveRenderScale Auto is full WASM 4×", () => {
    assert.equal(resolveRenderScale("auto"), 4);
    assert.equal(resolveRenderScale(1), 1);
    assert.deepEqual(worldSizeForRenderScale(2), { width: 640, height: 400 });
    assert.equal(NATIVE_W * WASM_SCALE, WASM_W);
    assert.equal(NATIVE_H * WASM_SCALE, WASM_H);
  });

  it("canvas 1× locks to backing store size", () => {
    const s = resolveCanvasCssSize(1, 640, 400, 1920, 1080);
    assert.equal(s.cssScale, 1);
    assert.equal(s.width, 640);
    assert.equal(s.height, 400);
  });

  it("canvas 2× is exactly 2× backing store (not clamped to the window)", () => {
    assert.deepEqual(resolveCanvasCssSize(2, 640, 400, 1920, 1080), {
      width: 1280,
      height: 800,
      cssScale: 2,
    });
    assert.equal(resolveCanvasCssSize(2, 1280, 800, 1400, 900).cssScale, 2);
    assert.equal(resolveCanvasCssSize(2, 1280, 800, 1400, 900).width, 2560);
  });

  it("canvas fit contains world + below-HUD in the window (fractional OK)", () => {
    const below = hudDestRect(640, 400, "below", 1);
    assert.equal(below.canvasH, 400 + 64);
    const fit = resolveCanvasCssSize("fit", 640, below.canvasH, 1920, 1080);
    assert.ok(fit.width <= 1920 + 1e-6);
    assert.ok(fit.height <= 1080 + 1e-6);
    assert.ok(Math.abs(fit.width / fit.height - 640 / below.canvasH) < 1e-6);

    const tiny = hudDestRect(320, 200, "below", 1);
    const fitTiny = resolveCanvasCssSize("fit", 320, tiny.canvasH, 1920, 1080);
    assert.ok(fitTiny.height <= 1080 + 1e-6);
    assert.ok(fitTiny.cssScale > 2);
  });

  it("hudDestRect overlay vs below", () => {
    const overlay = hudDestRect(1280, 800, "overlay", 1);
    assert.equal(overlay.canvasH, 800);
    assert.equal(overlay.y, 800 - 128);

    const below = hudDestRect(1280, 800, "below", 1);
    assert.equal(below.y, 800);
    assert.equal(below.canvasH, 800 + 128);
  });

  it("effectiveLookSens multiplies LOOK_SENS by user setting", () => {
    setClientSettings({ lookSens: 2 });
    assert.equal(effectiveLookSens(), LOOK_SENS * 2);
  });

  it("getClientSettings returns a copy", () => {
    const a = getClientSettings();
    a.lookSens = 3.33;
    assert.notEqual(getClientSettings().lookSens, 3.33);
  });
});

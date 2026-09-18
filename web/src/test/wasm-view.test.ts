/**
 * WASM viewer smoke — boots R_RenderPlayerView and checks non-empty framebuffer.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClientState, type Actor } from "../thin/state.ts";
import { WasmWorldRenderer } from "../thin/wad/wasmView.ts";
import { setupWasmViewForNode } from "../thin/wad/wasmViewNode.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SCALES = [1, 2, 4] as const;

function marineAt(over: Partial<Actor> = {}): Actor {
  return {
    id: 1,
    kind: "marine",
    type: 0,
    typeName: "marine",
    x: 1056,
    y: -3616,
    z: 0,
    angle: 90,
    health: 100,
    maxHealth: 100,
    sprite: 28,
    frame: 0,
    controllerSessionId: "m",
    ...over,
  };
}

describe("wasm view smoke", () => {
  it("artifacts exist (run npm run build:wasm)", () => {
    for (const s of SCALES) {
      const js = path.join(ROOT, `web/public/asym_view_${s}x.js`);
      const bin = path.join(ROOT, `web/public/asym_view_${s}x.wasm`);
      assert.ok(existsSync(js), `missing ${js}`);
      assert.ok(existsSync(bin), `missing ${bin}`);
    }
  });

  it("renders many frames without exhausting the zone heap", async () => {
    setupWasmViewForNode();
    const wasm = new WasmWorldRenderer();
    await wasm.ensureReady();

    const state = createClientState();
    state.mapName = "E1M1";
    state.role = "demon";
    state.controlledId = 1;
    state.tick = 35;
    // Several actors to exercise sync reuse every frame
    for (let id = 1; id <= 12; id++) {
      state.entities.actors.set(id, marineAt({
        id,
        x: 1056 + id * 16,
        y: -3616,
        type: id === 1 ? 0 : 5, // mix marine / possessed
        typeName: id === 1 ? "marine" : "imp",
      }));
    }

    for (let f = 0; f < 120; f++) {
      state.tick = 35 + f;
      const cam = state.entities.actors.get(1)!;
      cam.angle = 90 + (f % 60);
      const frame = wasm.render(
        state,
        { x: cam.x, y: cam.y, z: cam.z, angle: cam.angle },
        { hideActorId: 1 },
      );
      assert.ok(frame, `frame ${f} returned null (possible Z_Malloc failure)`);
      assert.equal(frame!.width, 1280);
      if (f === 0) {
        let lit = 0;
        for (let i = 0; i < frame!.data.length; i += 4) {
          if (frame!.data[i]! + frame!.data[i + 1]! + frame!.data[i + 2]! > 30) lit++;
        }
        assert.ok(lit > 1000, `expected lit world pixels, got ${lit}`);
      }
    }

    // True-resolution switching: each scale is its own binary and must
    // produce a genuinely different world render, not a pixel-doubled one.
    const meanBrightness: Record<number, number> = {};
    for (const s of SCALES) {
      await wasm.setScale(s);
      const cam = state.entities.actors.get(1)!;
      const frame = wasm.render(
        state,
        { x: cam.x, y: cam.y, z: cam.z, angle: cam.angle },
        { hideActorId: 1 },
      );
      assert.ok(frame, `no frame at scale ${s}`);
      assert.equal(frame!.width, 320 * s);
      assert.equal(frame!.height, 200 * s);
      let lit = 0;
      let sum = 0;
      for (let i = 0; i < frame!.data.length; i += 4) {
        const l = frame!.data[i]! + frame!.data[i + 1]! + frame!.data[i + 2]!;
        sum += l;
        if (l > 30) lit++;
      }
      assert.ok(
        lit > (320 * s * 200 * s) / 20,
        `expected lit world pixels at scale ${s}, got ${lit}`,
      );
      meanBrightness[s] = sum / (frame!.data.length / 4) / 3;
    }

    // Light diminishing must not depend on resolution (LIGHTSCALEDIV /
    // vanilla zlight table): same viewpoint, same average brightness.
    for (const s of [2, 4] as const) {
      const d = Math.abs(meanBrightness[s]! - meanBrightness[1]!);
      assert.ok(
        d < 4,
        `scale ${s} brightness ${meanBrightness[s]!.toFixed(1)} deviates from 1x ` +
          `${meanBrightness[1]!.toFixed(1)} by ${d.toFixed(1)}`,
      );
    }
  });
});

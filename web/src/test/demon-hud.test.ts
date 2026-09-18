import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WadFile } from "../thin/wad/wadFile.ts";
import { SpriteStore } from "../thin/wad/sprites.ts";
import { HudGfx } from "../thin/wad/hudGfx.ts";
import { demonFace, demonStatusBar, FACE_H, FACE_W, healthPercent } from "../thin/wad/demonHud.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const IWAD = path.join(ROOT, "assets", "doom1.wad");

describe("demon HUD", () => {
  it("health percent is current / spawnhealth (can exceed 100)", () => {
    assert.equal(healthPercent(20, 20), 100);
    assert.equal(healthPercent(25, 20), 125);
    assert.equal(healthPercent(10, 20), 50);
    assert.equal(healthPercent(0, 20), 0);
  });

  it("builds PTS bar, mugshot, and pain flash", () => {
    const wad = WadFile.fromArrayBuffer(readFileSync(IWAD).buffer);
    const sprites = new SpriteStore(wad);
    const bar = demonStatusBar(sprites);
    assert.ok(bar);
    assert.equal(bar!.width, 320);
    assert.equal(bar!.height, 32);
    // Upgrade labels are HEALTH-font words, not single letters.
    const ink = (x0: number, x1: number, y0: number, y1: number) => {
      let n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * bar!.width + x) * 4;
          const L = (bar!.rgba[i]! + bar!.rgba[i + 1]! + bar!.rgba[i + 2]!) / 3;
          if (L > 120) n++;
        }
      }
      return n;
    };
    assert.ok(ink(236, 274, 10, 16) > 40, "SPEED label should be a full word");
    assert.ok(ink(16, 46, 23, 29) > 20, "PTS label uses HEALTH-style glyphs");

    const face = demonFace(sprites, "zombieman");
    assert.ok(face);
    assert.equal(face!.width, FACE_W);
    assert.equal(face!.height, FACE_H);

    const hud = new HudGfx(sprites);
    const vitals = {
      species: "imp",
      health: 60,
      maxHealth: 60,
      points: 25,
      mods: { health: 1, speed: 0, damage: 2, rate: 0 },
    };
    hud.tickDemon(16, vitals);
    assert.equal(hud.demonPainAlpha(), 0);
    hud.tickDemon(16, { ...vitals, health: 35 });
    assert.ok(hud.demonPainAlpha() > 0.1, `pain=${hud.demonPainAlpha()}`);
  });
});

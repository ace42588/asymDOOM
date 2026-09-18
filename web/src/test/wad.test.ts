/**
 * IWAD / map helpers still used by HUD + minimap (world draw is WASM).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WadFile } from "../thin/wad/wadFile.ts";
import { loadMap, pointSector, eyeHeightFor } from "../thin/wad/mapData.ts";
import { SpriteStore } from "../thin/wad/sprites.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const IWAD = path.join(ROOT, "assets", "doom1.wad");

describe("iwad helpers", () => {
  it("loads doom1.wad map lumps and sprites for HUD", () => {
    const wad = WadFile.fromArrayBuffer(readFileSync(IWAD).buffer);
    assert.ok(wad.lump("PLAYPAL"));
    const map = loadMap(wad, "E1M1");
    assert.ok(map.linedefs.length > 100);
    assert.ok(map.sectors.length > 10);
    const sprites = new SpriteStore(wad);
    assert.ok(sprites.count > 100);
    assert.ok(sprites.forLump("STBAR"));
  });

  it("pointSector + eyeHeightFor at E1M1 spawn", () => {
    const wad = WadFile.fromArrayBuffer(readFileSync(IWAD).buffer);
    const map = loadMap(wad, "E1M1");
    const si = pointSector(map, 1056, -3616);
    assert.ok(si >= 0 && si < map.sectors.length);
    const eye = eyeHeightFor(0, map.sectors[si]!);
    assert.ok(eye > map.sectors[si]!.floorHeight);
    assert.ok(eye < map.sectors[si]!.ceilingHeight);
  });
});

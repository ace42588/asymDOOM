/**
 * Node-only bootstrap for WasmWorldRenderer (scene / smoke tests).
 * Wires the per-scale asym_view binaries (1x/2x/4x true resolutions).
 */
/// <reference types="node" />
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { configureWasmViewNode, type AsymViewModule, type RenderScale } from "./wasmView";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..", "..");

export function setupWasmViewForNode() {
  const require = createRequire(import.meta.url);
  const iwadPath = path.join(ROOT, "assets/doom1.wad");
  configureWasmViewNode({
    factoryForScale: (scale: RenderScale) =>
      require(path.join(ROOT, `web/public/asym_view_${scale}x.js`)) as (
        opts?: object,
      ) => Promise<AsymViewModule>,
    wasmPathForScale: (scale: RenderScale) =>
      path.join(ROOT, `web/public/asym_view_${scale}x.wasm`),
    iwadBytes: new Uint8Array(readFileSync(iwadPath)),
  });
}

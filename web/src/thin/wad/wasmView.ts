/**
 * WASM world renderer — wraps native R_RenderPlayerView via asym_view.
 *
 * Render scale is a real resolution: each of 1x (320×200), 2x (640×400),
 * and 4x (1280×800) is its own WASM binary (SCREENWIDTH/SCREENHEIGHT are
 * compile-time in the vanilla renderer). Changing scale hot-swaps the
 * module in the background; frames keep coming from the old one until the
 * new one is booted and on the right map.
 *
 * Browser loads /asym_view_{s}x.js; Node tests use configureWasmViewNode().
 */
import type { ClientState, Actor, Door, Mover, Projectile } from "../state";

export type RenderScale = 1 | 2 | 4;

export interface WasmFrameResult {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export type AsymViewModule = {
  ccall: (name: string, ret: string | null, args: string[], values: unknown[]) => unknown;
  HEAPU8: Uint8Array;
  _malloc: (n: number) => number;
  _free: (p: number) => void;
  FS: {
    writeFile: (path: string, data: Uint8Array) => void;
    analyzePath: (path: string) => { exists: boolean };
  };
  setValue: (ptr: number, value: number, type: string) => void;
};

type ModuleFactory = (opts?: { locateFile?: (path: string) => string }) => Promise<AsymViewModule>;

declare global {
  interface Window {
    createAsymView?: ModuleFactory;
  }
}

/** Virtual path inside the WASM FS (not an HTTP URL). */
const IWAD_FS_PATH = "/doom1.wad";
/** HTTP URL for fetching the IWAD from the sim host. Set via setIwadHttpUrl / join.wadUrl. */
let iwadHttpUrl: string | null = null;
/** Bump when native viewer ABI changes so browsers drop stale artifacts. */
const WASM_REV = "res1";

/** Configure where the browser fetches doom1.wad (absolute sim URL). */
export function setIwadHttpUrl(url: string) {
  iwadHttpUrl = url;
  iwadCache = null;
}

interface Bin {
  scale: RenderScale;
  mod: AsymViewModule;
  loadedEp: number;
  loadedMap: number;
}

let activeBin: Bin | null = null;
/** Scale the active bin should converge to. */
let desiredScale: RenderScale = 4;
/** In-flight boot/switch; serialized so script loads never race. */
let switchPromise: Promise<void> | null = null;
let iwadCache: Uint8Array | null = null;
let lastLoggedSize = "";

/** Injected by Node test helper before ensureReady(). */
let nodeFactoryForScale: ((scale: RenderScale) => ModuleFactory) | null = null;
let nodeWasmPathForScale: ((scale: RenderScale) => string) | null = null;

export function configureWasmViewNode(opts: {
  factoryForScale: (scale: RenderScale) => ModuleFactory;
  wasmPathForScale: (scale: RenderScale) => string;
  iwadBytes: Uint8Array;
}) {
  nodeFactoryForScale = opts.factoryForScale;
  nodeWasmPathForScale = opts.wasmPathForScale;
  iwadCache = opts.iwadBytes;
}

function parseMapName(name: string): { ep: number; map: number } {
  const m = /^E(\d)M(\d)$/i.exec(name.trim());
  if (m) return { ep: Number(m[1]), map: Number(m[2]) };
  return { ep: 1, map: 1 };
}

/** Pages-safe asset URL (respects Vite base for project sites). */
function assetUrl(file: string): string {
  const base = import.meta.env.BASE_URL ?? "./";
  const prefix = base.endsWith("/") ? base : `${base}/`;
  return `${prefix}${file}?v=${WASM_REV}`;
}

function scriptUrl(scale: RenderScale): string {
  return assetUrl(`asym_view_${scale}x.js`);
}

function wasmUrl(scale: RenderScale): string {
  return assetUrl(`asym_view_${scale}x.wasm`);
}

async function loadBrowserFactory(scale: RenderScale): Promise<ModuleFactory> {
  // Every variant script assigns the same createAsymView global; loads are
  // serialized through switchPromise, so capture it right after onload.
  window.createAsymView = undefined;
  await new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = scriptUrl(scale);
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${s.src}`));
    document.head.appendChild(s);
  });
  const factory = window.createAsymView;
  if (!factory) throw new Error("createAsymView not available");
  return factory;
}

async function fetchIwad(): Promise<Uint8Array> {
  if (iwadCache) return iwadCache;
  const url = iwadHttpUrl;
  if (!url) throw new Error("IWAD HTTP URL not set (call setIwadHttpUrl / pass join.wadUrl)");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`IWAD fetch failed: ${res.status}`);
  iwadCache = new Uint8Array(await res.arrayBuffer());
  return iwadCache;
}

async function bootBin(scale: RenderScale): Promise<Bin> {
  const factory = nodeFactoryForScale
    ? nodeFactoryForScale(scale)
    : await loadBrowserFactory(scale);
  const m = await factory({
    locateFile: (p: string) => {
      if (p.endsWith(".wasm")) {
        return nodeWasmPathForScale ? nodeWasmPathForScale(scale) : wasmUrl(scale);
      }
      return p;
    },
  });
  const buf = await fetchIwad();
  try {
    if (!m.FS.analyzePath(IWAD_FS_PATH).exists) {
      m.FS.writeFile(IWAD_FS_PATH, buf);
    }
  } catch {
    m.FS.writeFile(IWAD_FS_PATH, buf);
  }
  const rc = m.ccall("asym_view_create", "number", ["string"], [IWAD_FS_PATH]) as number;
  if (rc !== 0) throw new Error(`asym_view_create failed (${rc})`);
  m.ccall("asym_view_set_hide_psprites", null, ["number"], [1]);
  return { scale, mod: m, loadedEp: 1, loadedMap: 1 };
}

/** Boot/swap until the active bin matches desiredScale (single in-flight). */
function requestSwitch(): Promise<void> {
  if (switchPromise) return switchPromise;
  if (activeBin && activeBin.scale === desiredScale) return Promise.resolve();
  switchPromise = (async () => {
    try {
      while (!activeBin || activeBin.scale !== desiredScale) {
        const target = desiredScale;
        const bin = await bootBin(target);
        activeBin = bin; // old module reference dropped; GC reclaims its heap
        console.info(
          `[asym_view] render scale ${target}x active (${320 * target}x${200 * target})`,
        );
      }
    } finally {
      switchPromise = null;
    }
  })();
  return switchPromise;
}

function writeStructArray<T>(
  m: AsymViewModule,
  items: T[],
  stride: number,
  write: (ptr: number, item: T) => void,
): number {
  if (items.length === 0) return 0;
  const ptr = m._malloc(items.length * stride);
  for (let i = 0; i < items.length; i++) write(ptr + i * stride, items[i]!);
  return ptr;
}

function applyDoorsMovers(m: AsymViewModule, state: ClientState) {
  const doors = [...state.entities.doors.values()];
  const movers = [...state.entities.movers.values()];

  const doorStride = 16;
  const doorPtr = writeStructArray(m, doors, doorStride, (p, d: Door) => {
    m.setValue(p + 0, d.id ?? 0, "i32");
    m.setValue(p + 4, d.position, "float");
    m.setValue(p + 8, d.x ?? 0, "float");
    m.setValue(p + 12, d.y ?? 0, "float");
  });
  if (doorPtr) {
    m.ccall("asym_view_apply_doors", null, ["number", "number"], [doorPtr, doors.length]);
    m._free(doorPtr);
  }

  const moverStride = 20;
  const moverPtr = writeStructArray(m, movers, moverStride, (p, mv: Mover) => {
    m.setValue(p + 0, mv.id ?? 0, "i32");
    m.setValue(p + 4, mv.floor, "float");
    m.setValue(p + 8, mv.ceiling, "float");
    m.setValue(p + 12, mv.x ?? 0, "float");
    m.setValue(p + 16, mv.y ?? 0, "float");
  });
  if (moverPtr) {
    m.ccall("asym_view_apply_movers", null, ["number", "number"], [moverPtr, movers.length]);
    m._free(moverPtr);
  }
}

function syncActors(m: AsymViewModule, state: ClientState, hideId: number) {
  const actors = [...state.entities.actors.values()];
  const stride = 40;
  const ptr = writeStructArray(m, actors, stride, (p, a: Actor) => {
    m.setValue(p + 0, a.id >>> 0, "i32");
    m.setValue(p + 4, a.type ?? 0, "i32");
    m.setValue(p + 8, a.x, "float");
    m.setValue(p + 12, a.y, "float");
    m.setValue(p + 16, a.z, "float");
    m.setValue(p + 20, a.angle, "float");
    m.setValue(p + 24, a.sprite ?? 0, "i32");
    m.setValue(p + 28, a.frame ?? 0, "i32");
    m.setValue(p + 32, a.flags ?? 0, "i32");
    m.setValue(p + 36, a.health ?? 0, "i32");
  });
  m.ccall("asym_view_sync_actors", null, ["number", "number", "number"], [
    ptr,
    actors.length,
    hideId >>> 0,
  ]);
  if (ptr) m._free(ptr);

  const projs = [...state.entities.projectiles.values()];
  const pstride = 32;
  const pptr = writeStructArray(m, projs, pstride, (p, pr: Projectile) => {
    m.setValue(p + 0, pr.id >>> 0, "i32");
    m.setValue(p + 4, pr.type ?? 0, "i32");
    m.setValue(p + 8, pr.x, "float");
    m.setValue(p + 12, pr.y, "float");
    m.setValue(p + 16, pr.z, "float");
    m.setValue(p + 20, pr.angle ?? 0, "float");
    m.setValue(p + 24, pr.sprite ?? 0, "i32");
    m.setValue(p + 28, pr.frame ?? 0, "i32");
  });
  m.ccall("asym_view_sync_projectiles", null, ["number", "number"], [pptr, projs.length]);
  if (pptr) m._free(pptr);
}

function copyFramebuffer(bin: Bin): WasmFrameResult {
  const m = bin.mod;
  const w = m.ccall("asym_view_width", "number", [], []) as number;
  const h = m.ccall("asym_view_height", "number", [], []) as number;
  const fbW = m.ccall("asym_view_fb_width", "number", [], []) as number;
  const ptr = m.ccall("asym_view_framebuffer", "number", [], []) as number;
  const x0 = Math.max(0, Math.floor((fbW - w) / 2));
  const data = new Uint8ClampedArray(w * h * 4);
  const src = m.HEAPU8;
  for (let y = 0; y < h; y++) {
    const srcRow = ptr + (y * fbW + x0) * 4;
    const dstRow = y * w * 4;
    for (let x = 0; x < w; x++) {
      const si = srcRow + x * 4;
      const di = dstRow + x * 4;
      data[di] = src[si + 2]!;
      data[di + 1] = src[si + 1]!;
      data[di + 2] = src[si]!;
      data[di + 3] = 255;
    }
  }
  const tag = `${w}x${h}`;
  if (tag !== lastLoggedSize) {
    lastLoggedSize = tag;
    console.info(`[asym_view] framebuffer ${w}x${h} (render scale ${bin.scale}x)`);
  }
  return { data, width: w, height: h };
}

export class WasmWorldRenderer {
  private ready = false;
  private error: string | null = null;
  private initPromise: Promise<void> | null = null;

  get loadError() {
    return this.error;
  }

  get isReady() {
    return this.ready;
  }

  async ensureReady(scale?: RenderScale): Promise<void> {
    if (scale) desiredScale = scale;
    if (this.ready) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      try {
        await requestSwitch();
        this.ready = true;
      } catch (err) {
        this.error = err instanceof Error ? err.message : String(err);
        console.error("[wasm-view] init failed", err);
        throw err;
      }
    })();
    return this.initPromise;
  }

  /** Switch to a different true render resolution. Resolves once active. */
  async setScale(scale: RenderScale): Promise<void> {
    desiredScale = scale;
    if (!this.ready) return;
    await requestSwitch();
  }

  render(
    state: ClientState,
    cam: { x: number; y: number; z: number; angle: number },
    opts?: { hidePsprites?: boolean; hideActorId?: number; scale?: RenderScale },
  ): WasmFrameResult | null {
    const bin = activeBin;
    if (!bin) return null;

    // Kick off a background swap when the desired scale changed; keep
    // rendering the current bin so there is no black frame meanwhile.
    if (opts?.scale && opts.scale !== bin.scale) {
      desiredScale = opts.scale;
      void requestSwitch().catch((err) => {
        console.error("[wasm-view] scale switch failed", err);
      });
    }

    const m = bin.mod;
    const mapName = state.mapName ?? "E1M1";
    const { ep, map } = parseMapName(mapName);
    if (ep !== bin.loadedEp || map !== bin.loadedMap) {
      const rc = m.ccall("asym_view_load_map", "number", ["number", "number"], [ep, map]) as number;
      if (rc !== 0) {
        console.warn("[wasm-view] load_map failed", ep, map, rc);
        return null;
      }
      bin.loadedEp = ep;
      bin.loadedMap = map;
    }

    m.ccall("asym_view_set_tick", null, ["number"], [state.tick | 0]);
    m.ccall("asym_view_set_hide_psprites", null, ["number"], [
      opts?.hidePsprites === false ? 0 : 1,
    ]);

    // Movers first so set_view eye height uses live sector floors (doorways/steps).
    applyDoorsMovers(m, state);
    m.ccall(
      "asym_view_set_view",
      null,
      ["number", "number", "number", "number"],
      [cam.x, cam.y, cam.z, cam.angle],
    );

    const hideId = opts?.hideActorId ?? state.controlledId ?? 0;
    syncActors(m, state, hideId);

    const rc = m.ccall("asym_view_render", "number", ["number"], [0]) as number;
    if (rc !== 0) {
      console.warn("[wasm-view] render failed", rc);
      return null;
    }
    return copyFramebuffer(bin);
  }
}

/**
 * Client-only display / look prefs (localStorage). Not host match settings.
 *
 * Render scale = native fb_scaling of 320×200 (WASM I_FinishUpdate pixel-double).
 * Canvas scale = CSS size of that backing store: 1×, 2×, or fit-to-window
 * (fractional contain; includes a below-HUD strip).
 */

export type RenderScaleMode = "auto" | 1 | 2 | 4;
/** @deprecated Use RenderScaleMode — kept for localStorage migration. */
export type ViewScaleMode = RenderScaleMode;
/** CSS display scale of the canvas backing store. */
export type CanvasScaleMode = 1 | 2 | "fit";
export type HudPlacement = "overlay" | "below";

export interface ClientSettings {
  /** Multiplier on LOOK_SENS for pointer-lock mouse (0.25–4, default 1). */
  lookSens: number;
  /** Multiplier on touch swipe look (0.25–4, default 1). */
  touchLookSens: number;
  /** Show right analog look stick (velocity turn). Default off. */
  lookStick: boolean;
  /** Multiplier on look-stick turn rate (0.25–4, default 1). */
  lookStickSens: number;
  /** Opt-in device gyro yaw. Default off. */
  gyroEnabled: boolean;
  /** Multiplier on gyro yaw (0.25–4, default 1). */
  gyroSens: number;
  /** Native pixel scale of 320×200 (WASM fb_scaling). */
  renderScale: RenderScaleMode;
  /** How large to draw the canvas: 1× / 2× / fit-to-window. */
  canvasScale: CanvasScaleMode;
  hudPlacement: HudPlacement;
  /** Uniform STBAR scale 0.5–1.5 (default 1). */
  hudScale: number;
  showCrosshair: boolean;
  /** Loop IWAD map music (client-side MUS → MIDI). Default on, like vanilla. */
  musicEnabled: boolean;
}

export const STORAGE_KEY = "asymdoom.clientSettings";

/** Vanilla Doom logical screen. */
export const NATIVE_W = 320;
export const NATIVE_H = 200;
/** WASM DG_ScreenBuffer allocation (max fb_scaling 4×). */
export const WASM_W = 1280;
export const WASM_H = 800;
export const WASM_SCALE = 4;

export const DEFAULT_SETTINGS: ClientSettings = {
  lookSens: 1,
  touchLookSens: 1,
  lookStick: false,
  lookStickSens: 1,
  gyroEnabled: false,
  gyroSens: 1,
  renderScale: "auto",
  canvasScale: "fit",
  hudPlacement: "overlay",
  hudScale: 1,
  showCrosshair: true,
  musicEnabled: true,
};

type Listener = (s: ClientSettings) => void;

let current: ClientSettings = { ...DEFAULT_SETTINGS };
const listeners = new Set<Listener>();
let loaded = false;

function clampLookSens(v: unknown, fallback = DEFAULT_SETTINGS.lookSens): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(4, Math.max(0.25, Math.round(n * 100) / 100));
}

function clampHudScale(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.hudScale;
  return Math.min(1.5, Math.max(0.5, Math.round(n * 100) / 100));
}

function clampRenderScale(v: unknown): RenderScaleMode {
  if (v === "auto" || v === 1 || v === 2 || v === 4) return v;
  if (v === "1" || v === "2" || v === "4") return Number(v) as 1 | 2 | 4;
  return DEFAULT_SETTINGS.renderScale;
}

function clampCanvasScale(v: unknown): CanvasScaleMode {
  if (v === "fit" || v === 1 || v === 2) return v;
  if (v === "1" || v === "2") return Number(v) as 1 | 2;
  return DEFAULT_SETTINGS.canvasScale;
}

function clampHudPlacement(v: unknown): HudPlacement {
  return v === "below" ? "below" : "overlay";
}

/** Normalize partial / legacy JSON into a full settings object. */
export function clampSettings(raw: unknown): ClientSettings {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const scaleRaw = o.renderScale ?? o.viewScale;
  return {
    lookSens: clampLookSens(o.lookSens, DEFAULT_SETTINGS.lookSens),
    touchLookSens: clampLookSens(o.touchLookSens, DEFAULT_SETTINGS.touchLookSens),
    lookStick: o.lookStick === true,
    lookStickSens: clampLookSens(o.lookStickSens, DEFAULT_SETTINGS.lookStickSens),
    gyroEnabled: o.gyroEnabled === true,
    gyroSens: clampLookSens(o.gyroSens, DEFAULT_SETTINGS.gyroSens),
    renderScale: clampRenderScale(scaleRaw),
    canvasScale: clampCanvasScale(o.canvasScale),
    hudPlacement: clampHudPlacement(o.hudPlacement),
    hudScale: clampHudScale(o.hudScale),
    showCrosshair: o.showCrosshair === false ? false : true,
    musicEnabled: o.musicEnabled === false ? false : true,
  };
}

/** Auto = max WASM fb_scaling (4×). */
export function resolveRenderScale(mode: RenderScaleMode): 1 | 2 | 4 {
  if (mode === "auto") return WASM_SCALE;
  if (mode === 1 || mode === 2 || mode === 4) return mode;
  return WASM_SCALE;
}

/** World blit size at a concrete render scale (of 320×200). */
export function worldSizeForRenderScale(scale: 1 | 2 | 4): { width: number; height: number } {
  return { width: NATIVE_W * scale, height: NATIVE_H * scale };
}

/**
 * CSS pixel size for the view canvas.
 * - 1×: locked to backing-store pixels
 * - 2×: twice the backing store (may exceed the window)
 * - fit: contain the full canvas (world + optional below-HUD) in the window
 */
export function resolveCanvasCssSize(
  mode: CanvasScaleMode,
  canvasW: number,
  canvasH: number,
  windowW: number,
  windowH: number,
): { width: number; height: number; cssScale: number } {
  const w = Math.max(1, canvasW);
  const h = Math.max(1, canvasH);
  if (mode === 1) return { width: w, height: h, cssScale: 1 };
  if (mode === 2) return { width: w * 2, height: h * 2, cssScale: 2 };
  const sx = windowW / w;
  const sy = windowH / h;
  const cssScale = Math.min(sx, sy);
  const safe = Number.isFinite(cssScale) && cssScale > 0 ? cssScale : 1;
  return { width: w * safe, height: h * safe, cssScale: safe };
}

/** Status-bar dest geometry for overlay vs below. */
export function hudDestRect(
  worldW: number,
  worldH: number,
  placement: HudPlacement,
  hudScale: number,
): { x: number; y: number; w: number; h: number; canvasH: number; worldH: number } {
  const scale = clampHudScale(hudScale);
  const h = Math.max(1, Math.round(((32 * worldW) / NATIVE_W) * scale));
  const w = Math.max(1, Math.round(worldW * scale));
  const x = Math.max(0, Math.floor((worldW - w) / 2));
  if (placement === "below") {
    return { x, y: worldH, w, h, canvasH: worldH + h, worldH };
  }
  return { x, y: worldH - h, w, h, canvasH: worldH, worldH };
}

function readStorage(): ClientSettings {
  try {
    if (typeof localStorage === "undefined") return { ...DEFAULT_SETTINGS };
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return clampSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function writeStorage(s: ClientSettings) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* private mode / quota */
  }
}

export function loadClientSettings(): ClientSettings {
  current = readStorage();
  loaded = true;
  return { ...current };
}

export function getClientSettings(): ClientSettings {
  if (!loaded) loadClientSettings();
  return { ...current };
}

export function setClientSettings(partial: Partial<ClientSettings>): ClientSettings {
  if (!loaded) loadClientSettings();
  current = clampSettings({ ...current, ...partial });
  writeStorage(current);
  for (const fn of listeners) fn({ ...current });
  return { ...current };
}

export function subscribeClientSettings(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

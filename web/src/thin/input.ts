/** Keyboard/mouse/touch → intent for thin protocol (contracts/intent.schema.json). */

import { armsWeaponAtClientPoint } from "./armsHit";
import { getClientSettings } from "./clientSettings";

export interface Intent {
  forward: number;
  strafe: number;
  turnDelta: number;
  run: boolean;
  fire: boolean;
  use: boolean;
  lookFly: 0 | 1 | 2;
  arti: number;
}

export type SpectatorFollow = "next" | "prev";

export interface InputSample {
  intent: Intent;
  bodySwap: boolean;
  spectatorPossess: boolean;
  spectatorFollow: SpectatorFollow | null;
}

/** Pointer-lock / touch look → turnDelta before host angleturn scaling. */
export const LOOK_SENS = 0.02;

/**
 * Fraction of viewport width that maps to a 180° turn at touchLookSens = 1.
 * Comfortable right-thumb swipe, not full-screen edge-to-edge.
 */
export const TOUCH_LOOK_REF_FRAC = 0.35;

/**
 * Wire turnDelta for a 180° turn (host ×800 → 32768 angleturn = half circle).
 * Must stay in sync with server/src/thin/intentScale.ts toTiccmdTurn.
 */
export const TURN_DELTA_180 = 32768 / 800;

/** Effective mouse look scale (LOOK_SENS × user multiplier). */
export function effectiveLookSens(): number {
  return LOOK_SENS * getClientSettings().lookSens;
}

/**
 * Map touch swipe CSS-pixel dx → wire turnDelta.
 * At touchLookSens = 1, a swipe of TOUCH_LOOK_REF_FRAC × viewportWidth = 180°.
 */
export function touchDxToTurnDelta(
  dx: number,
  viewportWidth: number,
  touchLookSens: number,
): number {
  const w = Math.max(1, viewportWidth);
  const sens = Number.isFinite(touchLookSens) ? touchLookSens : 1;
  return -dx * (TURN_DELTA_180 / (TOUCH_LOOK_REF_FRAC * w)) * sens;
}

/** Held arrow-key / look-stick turn per sample (~vanilla angleturn after host scale). */
export const KEY_TURN_RATE = 1.6;

/** Full look-stick deflection turn rate per sample (matches KEY_TURN_RATE at sens 1). */
export const LOOK_STICK_RATE = KEY_TURN_RATE;

/**
 * Map gyro rotation rate (deg/s) × dt into wire turnDelta.
 * At gyroSens = 1, 90 deg/s for 1s ≈ 90° in-game (half of TURN_DELTA_180).
 */
export function gyroRateToTurnDelta(
  degPerSec: number,
  dtSec: number,
  gyroSens: number,
): number {
  if (!Number.isFinite(degPerSec) || !Number.isFinite(dtSec) || dtSec <= 0) return 0;
  if (degPerSec === 0) return 0;
  const sens = Number.isFinite(gyroSens) ? gyroSens : 1;
  // 180 physical deg → TURN_DELTA_180 wire. Positive yawRateFromRotation
  // (device yaw toward screen-right) must look the same way as a right swipe.
  return ((degPerSec * dtSec) / 180) * TURN_DELTA_180 * sens;
}

/** arti: 1–8 weapon/mod, 5 hop, 9 next weapon, 10 prev weapon. */
export const ARTI_WEAPON_NEXT = 9;
export const ARTI_WEAPON_PREV = 10;

const keys = new Set<string>();
let turnAccum = 0;
let artiPulse = 0;
let bodySwap = false;
let spectatorPossess = false;
let spectatorFollow: SpectatorFollow | null = null;
let touchForward = 0;
let touchStrafe = 0;
/** Only true after touch UI enables run — must default false so keyboard stays walk-unless-Shift. */
let touchRun = false;
/** Look-stick horizontal axis [-1, 1]; held velocity turn. */
let lookStickX = 0;

function digitFromKey(key: string, code: string): number | null {
  if (/^[1-8]$/.test(key)) return Number(key);
  const m = /^Digit([1-8])$/.exec(code) ?? /^Numpad([1-8])$/.exec(code);
  return m ? Number(m[1]) : null;
}

export function initInput(canvas: HTMLCanvasElement) {
  window.addEventListener("keydown", (e) => {
    keys.add(e.key.toLowerCase());
    if (e.key === "Control") keys.add("control");
    const digit = digitFromKey(e.key, e.code);
    if (digit != null) {
      artiPulse = digit;
      if (digit === 5) bodySwap = true;
    }
    if (e.key === "p" || e.key === "P") spectatorPossess = true;
    if (e.key === "]" || e.key === ".") spectatorFollow = "next";
    if (e.key === "[" || e.key === ",") spectatorFollow = "prev";
    const block = [
      " ",
      "w",
      "a",
      "s",
      "d",
      "h",
      "shift",
      "control",
      "e",
      "f",
      "q",
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "arrowup",
      "arrowdown",
      "arrowleft",
      "arrowright",
    ];
    if (block.includes(e.key.toLowerCase()) || e.key === "Control") e.preventDefault();
  });
  window.addEventListener("keyup", (e) => {
    keys.delete(e.key.toLowerCase());
    if (e.key === "Control") keys.delete("control");
  });
  canvas.addEventListener("click", () => {
    // Don't steal lock while the settings disclosure is open.
    const settings = document.getElementById("client-settings") as HTMLDetailsElement | null;
    if (settings?.open) return;
    canvas.requestPointerLock?.();
  });
  canvas.addEventListener("pointerdown", (e) => {
    // ARMS grid on the status bar selects weapons 2–7 (marine only).
    const digit = armsWeaponAtClientPoint(e.clientX, e.clientY);
    if (digit != null) {
      artiPulse = digit;
      e.preventDefault();
      e.stopPropagation();
    }
  });
  document.addEventListener("mousemove", (e) => {
    if (document.pointerLockElement === canvas) {
      // Negate: world axes flipped; +movementX must look left on wire.
      turnAccum -= e.movementX * effectiveLookSens();
    }
  });
  canvas.addEventListener("mousedown", (e) => {
    if (armsWeaponAtClientPoint(e.clientX, e.clientY) != null) {
      e.preventDefault();
      return;
    }
    if (e.button === 0) keys.add("mouse0");
  });
  canvas.addEventListener("mouseup", (e) => {
    if (e.button === 0) keys.delete("mouse0");
  });
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      artiPulse = e.deltaY > 0 ? ARTI_WEAPON_PREV : ARTI_WEAPON_NEXT;
    },
    { passive: false },
  );
}

/** Touch bridge — used by touch.ts. forward/strafe already in [-1,1]. */
export function touchSetStick(forward: number, strafe: number) {
  touchForward = forward;
  touchStrafe = strafe;
}

export function touchSetKey(name: string, down: boolean) {
  const k = name.toLowerCase();
  if (down) keys.add(k);
  else keys.delete(k);
  if (down && k === "5") {
    artiPulse = 5;
    bodySwap = true;
  }
  if (down && ["1", "2", "3", "4", "6", "7", "8"].includes(k)) artiPulse = Number(k);
  if (down && (k === "weapnext" || k === "weaponnext")) artiPulse = ARTI_WEAPON_NEXT;
  if (down && (k === "weapprev" || k === "weaponprev")) artiPulse = ARTI_WEAPON_PREV;
  if (down && k === "p") spectatorPossess = true;
  if (down && (k === "follownext" || k === "]")) spectatorFollow = "next";
  if (down && (k === "followprev" || k === "[")) spectatorFollow = "prev";
}

export function touchAddLook(dx: number) {
  const s = getClientSettings();
  const vw =
    typeof window !== "undefined" && window.innerWidth > 0 ? window.innerWidth : 390;
  turnAccum += touchDxToTurnDelta(dx, vw, s.touchLookSens);
}

export function touchSetLookStick(x: number) {
  lookStickX = clampAxis(x);
}

export function touchAddTurnDelta(delta: number) {
  if (!Number.isFinite(delta) || delta === 0) return;
  turnAccum += delta;
}

export function touchSetRun(on: boolean) {
  touchRun = on;
}

/** Clamp to protocol axes [-1, 1] (intent.schema.json). */
export function clampAxis(v: number): number {
  if (Number.isNaN(v)) return 0;
  if (v > 1) return 1;
  if (v < -1) return -1;
  return v;
}

/**
 * Build a wire-protocol intent. forward/strafe are normalized [-1, 1];
 * `run` selects walk vs run on the host — never bake ticcmd magnitudes here.
 * Client signs are inverted vs screen so they match host world axes after Y flip.
 */
export function composeIntent(partial: {
  forward?: number;
  strafe?: number;
  turnDelta?: number;
  run?: boolean;
  fire?: boolean;
  use?: boolean;
  lookFly?: 0 | 1 | 2;
  arti?: number;
}): Intent {
  return {
    forward: clampAxis(partial.forward ?? 0),
    strafe: clampAxis(partial.strafe ?? 0),
    turnDelta: partial.turnDelta ?? 0,
    run: partial.run ?? false,
    fire: partial.fire ?? false,
    use: partial.use ?? false,
    lookFly: partial.lookFly ?? 0,
    arti: partial.arti ?? 0,
  };
}

export function sampleIntent(): InputSample {
  // WASD: move/strafe. Arrows: turn (+ up/down walk) — not a WASD duplicate.
  const kbFwd =
    (keys.has("w") || keys.has("arrowup") ? 1 : 0) -
    (keys.has("s") || keys.has("arrowdown") ? 1 : 0);
  // A left / D right after world-axis flip (wire +strafe ≠ screen-right).
  const kbStrafe = (keys.has("d") ? 1 : 0) - (keys.has("a") ? 1 : 0);
  const keyTurn =
    (keys.has("arrowleft") ? KEY_TURN_RATE : 0) - (keys.has("arrowright") ? KEY_TURN_RATE : 0);
  const stickTurn = lookStickX * LOOK_STICK_RATE * getClientSettings().lookStickSens;
  const run = keys.has("shift") || touchRun;
  const forward = touchForward !== 0 ? touchForward : kbFwd;
  const strafe = touchStrafe !== 0 ? touchStrafe : kbStrafe;
  const fly: 0 | 1 | 2 = keys.has("flyup") ? 1 : keys.has("flydown") ? 2 : 0;
  const intent = composeIntent({
    forward,
    strafe,
    turnDelta: turnAccum + keyTurn + stickTurn,
    run,
    fire:
      keys.has(" ") ||
      keys.has("mouse0") ||
      keys.has("control") ||
      keys.has("fire"),
    use: keys.has("f") || keys.has("e") || keys.has("use"),
    lookFly: fly,
    arti: artiPulse,
  });
  turnAccum = 0;
  const out: InputSample = {
    intent,
    bodySwap,
    spectatorPossess,
    spectatorFollow,
  };
  artiPulse = 0;
  bodySwap = false;
  spectatorPossess = false;
  spectatorFollow = null;
  return out;
}

/** Build ClientInputMessage per contracts/schemas/protocol/input.schema.json. */
export function buildInputMessage(seq: number, sample: InputSample): Record<string, unknown> {
  const input: Record<string, unknown> = { intent: sample.intent };
  if (sample.bodySwap) input.bodySwap = { targetId: null };
  if (sample.spectatorPossess) input.spectatorPossess = { targetId: null };
  if (sample.spectatorFollow) input.spectatorFollow = sample.spectatorFollow;
  return {
    type: "input",
    protocolVersion: 1,
    seq,
    input,
  };
}

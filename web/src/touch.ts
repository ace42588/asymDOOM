// On-screen controls for thin client. Feeds web/src/thin/input.ts.

import { setArmsPickEnabled, armsWeaponAtClientPoint } from "./thin/armsHit";
import {
  getClientSettings,
  subscribeClientSettings,
} from "./thin/clientSettings";
import { initGyro, setGyroPlaying } from "./thin/gyro";
import {
  touchAddLook,
  touchSetKey,
  touchSetLookStick,
  touchSetRun,
  touchSetStick,
} from "./thin/input";

const FLYERS = new Set(["lostsoul", "cacodemon"]);

/** Outer stick stage (≥ this fraction of radius) holds run while the stick is active. */
export const MOVE_RUN_FRAC = 0.65;

const KEY = {
  fire: "fire",
  use: "use",
  hop: "5",
  weapNext: "weapnext",
  buyH: "1",
  buyS: "2",
  buyD: "3",
  buyR: "4",
  flyUp: "flyup",
  flyDown: "flydown",
} as const;

const held = new Set<string>();
let runOn = true;
let fireHeld = false;
let movePtr: number | null = null;
let lookPtr: number | null = null;
let lookStickPtr: number | null = null;
let stickOriginX = 0;
let stickOriginY = 0;
let lookStickOriginX = 0;
let lookStickOriginY = 0;
let stickRadius = 56;
let lastLookX = 0;
let lastFireLookX = 0;
let lastUseLookX = 0;
let lastRole = "";
let lastBody = "";
let started = false;

function el(id: string) {
  return document.getElementById(id)!;
}

function setKey(name: string, down: boolean) {
  if (down) {
    if (held.has(name)) return;
    held.add(name);
  } else {
    if (!held.has(name)) return;
    held.delete(name);
  }
  touchSetKey(name, down);
}

function setFire(down: boolean) {
  if (fireHeld === down) return;
  fireHeld = down;
  setKey(KEY.fire, down);
}

function applyRunToggle() {
  touchSetRun(runOn);
  const runBtn = document.getElementById("touch-run");
  runBtn?.classList.toggle("on", runOn);
}

function releaseAll() {
  for (const k of [...held]) setKey(k, false);
  setFire(false);
  touchSetStick(0, 0);
  touchSetLookStick(0);
  applyRunToggle();
  movePtr = null;
  lookPtr = null;
  lookStickPtr = null;
  const moveStick = document.getElementById("touch-stick");
  moveStick?.classList.remove("run");
  resetStick("touch-stick", "touch-stick-knob");
  resetStick("touch-look-stick", "touch-look-stick-knob");
}

function tryPickArmsWeapon(clientX: number, clientY: number): boolean {
  const digit = armsWeaponAtClientPoint(clientX, clientY);
  if (digit == null) return false;
  const k = String(digit);
  touchSetKey(k, true);
  touchSetKey(k, false);
  return true;
}

function bindHold(btn: HTMLElement, name: string) {
  const down = (e: PointerEvent) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.preventDefault();
    e.stopPropagation();
    try {
      btn.setPointerCapture(e.pointerId);
    } catch {
      /* older iOS */
    }
    btn.classList.add("pressed");
    setKey(name, true);
  };
  const up = (e: PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    btn.classList.remove("pressed");
    setKey(name, false);
  };
  btn.addEventListener("pointerdown", down);
  btn.addEventListener("pointerup", up);
  btn.addEventListener("pointercancel", up);
}

/** Hold button that also forwards horizontal drag into look (FIRE / USE). */
function bindHoldWithLook(
  btn: HTMLElement,
  name: string,
  getLastX: () => number,
  setLastX: (x: number) => void,
  isFire: boolean,
) {
  const down = (e: PointerEvent) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.preventDefault();
    e.stopPropagation();
    try {
      btn.setPointerCapture(e.pointerId);
    } catch {
      /* older iOS */
    }
    btn.classList.add("pressed");
    setLastX(e.clientX);
    if (isFire) setFire(true);
    else setKey(name, true);
  };
  const move = (e: PointerEvent) => {
    e.preventDefault();
    const dx = e.clientX - getLastX();
    setLastX(e.clientX);
    if (dx !== 0) touchAddLook(dx);
  };
  const up = (e: PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    btn.classList.remove("pressed");
    if (isFire) setFire(false);
    else setKey(name, false);
  };
  btn.addEventListener("pointerdown", down);
  btn.addEventListener("pointermove", move);
  btn.addEventListener("pointerup", up);
  btn.addEventListener("pointercancel", up);
}

function bindTap(btn: HTMLElement, name: string) {
  btn.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.preventDefault();
    e.stopPropagation();
    btn.classList.add("pressed");
    setKey(name, true);
  });
  const up = (e: PointerEvent) => {
    e.preventDefault();
    btn.classList.remove("pressed");
    setKey(name, false);
  };
  btn.addEventListener("pointerup", up);
  btn.addEventListener("pointercancel", up);
}

function placeStick(
  x: number,
  y: number,
  zone: HTMLElement,
  stickId: string,
  origin: { x: number; y: number },
) {
  const stick = el(stickId);
  const rect = zone.getBoundingClientRect();
  const r = stickRadius;
  const cx = Math.min(Math.max(x - rect.left, r + 8), rect.width - r - 8);
  const cy = Math.min(Math.max(y - rect.top, r + 8), rect.height - r - 8);
  stick.style.left = `${cx - r}px`;
  stick.style.top = `${cy - r}px`;
  stick.style.bottom = "auto";
  stick.style.right = "auto";
  origin.x = rect.left + cx;
  origin.y = rect.top + cy;
}

function resetStick(stickId: string, knobId: string) {
  const stick = document.getElementById(stickId);
  const knob = document.getElementById(knobId);
  if (!stick || !knob) return;
  stick.style.left = "";
  stick.style.top = "";
  stick.style.bottom = "";
  stick.style.right = "";
  knob.style.transform = "translate(-50%, -50%)";
}

function onMoveStick(x: number, y: number) {
  const dx = x - stickOriginX;
  const dy = y - stickOriginY;
  const mag = Math.hypot(dx, dy);
  const scale = mag > stickRadius ? stickRadius / mag : 1;
  const kx = dx * scale;
  const ky = dy * scale;
  el("touch-stick-knob").style.transform = `translate(calc(-50% + ${kx}px), calc(-50% + ${ky}px))`;
  const ax = mag < 1 ? 0 : dx / Math.max(mag, stickRadius);
  const ay = mag < 1 ? 0 : dy / Math.max(mag, stickRadius);
  // stick: up = forward; right = strafe right (sign matches keyboard after world flip)
  touchSetStick(-ay, ax);
  // Two-stage: outer ring holds run; inner walks. Toggle restored on release.
  const runStick = mag >= stickRadius * MOVE_RUN_FRAC;
  touchSetRun(runStick);
  el("touch-stick").classList.toggle("run", runStick);
}

function onLookStickMove(x: number, y: number) {
  const dx = x - lookStickOriginX;
  const dy = y - lookStickOriginY;
  const mag = Math.hypot(dx, dy);
  const scale = mag > stickRadius ? stickRadius / mag : 1;
  const kx = dx * scale;
  const ky = dy * scale;
  el("touch-look-stick-knob").style.transform =
    `translate(calc(-50% + ${kx}px), calc(-50% + ${ky}px))`;
  // Horizontal only — yaw. Vertical ignored (no free-look pitch).
  const ax = mag < 1 ? 0 : dx / Math.max(mag, stickRadius);
  // Right deflection → look right on screen → negate for world flip (same as swipe).
  touchSetLookStick(-ax);
}

function applyLookStickChrome() {
  const zone = document.getElementById("touch-look-zone");
  if (!zone) return;
  const on = getClientSettings().lookStick;
  const playing = lastRole === "marine" || lastRole === "demon";
  zone.classList.toggle("hidden", !on || !playing);
  if (!on) {
    lookStickPtr = null;
    touchSetLookStick(0);
    resetStick("touch-look-stick", "touch-look-stick-knob");
  }
}

function applyTouchChrome() {
  const root = document.getElementById("touch-controls");
  if (!root || !document.body.classList.contains("touch-on")) return;
  const playing = lastRole === "marine" || lastRole === "demon";
  el("touch-look").classList.toggle("hidden", !playing);
  el("touch-move").classList.toggle("hidden", !playing);
  el("touch-actions").classList.toggle("hidden", !playing);
  el("touch-demon").classList.toggle("hidden", lastRole !== "demon");
  el("touch-weap").classList.toggle("hidden", lastRole !== "marine");
  el("touch-fly").classList.toggle("hidden", lastRole !== "demon" || !FLYERS.has(lastBody));
  applyLookStickChrome();
  setGyroPlaying(playing);
  if (!playing) releaseAll();
}

export function setTouchRole(role: string) {
  lastRole = role;
  setArmsPickEnabled(role === "marine");
  applyTouchChrome();
}

export function setTouchBody(species: string) {
  lastBody = species;
  applyTouchChrome();
}

function wantTouch(): boolean {
  const q = new URLSearchParams(location.search);
  if (q.get("touch") === "0") return false;
  if (q.get("touch") === "1") return true;
  return window.matchMedia("(pointer: coarse)").matches;
}

function bindLookStick() {
  const zone = document.getElementById("touch-look-zone");
  if (!zone) return;

  const origin = { x: 0, y: 0 };
  zone.addEventListener("pointerdown", (e) => {
    if (!getClientSettings().lookStick) return;
    if (lookStickPtr !== null) return;
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.preventDefault();
    e.stopPropagation();
    lookStickPtr = e.pointerId;
    try {
      zone.setPointerCapture(e.pointerId);
    } catch {
      /* older iOS */
    }
    placeStick(e.clientX, e.clientY, zone, "touch-look-stick", origin);
    lookStickOriginX = origin.x;
    lookStickOriginY = origin.y;
    onLookStickMove(e.clientX, e.clientY);
  });
  zone.addEventListener("pointermove", (e) => {
    if (e.pointerId !== lookStickPtr) return;
    e.preventDefault();
    onLookStickMove(e.clientX, e.clientY);
  });
  const endLookStick = (e: PointerEvent) => {
    if (e.pointerId !== lookStickPtr) return;
    lookStickPtr = null;
    touchSetLookStick(0);
    resetStick("touch-look-stick", "touch-look-stick-knob");
  };
  zone.addEventListener("pointerup", endLookStick);
  zone.addEventListener("pointercancel", endLookStick);
}

function bindControls() {
  const move = el("touch-move");
  const look = el("touch-look");

  el("touch-controls").addEventListener("contextmenu", (e) => e.preventDefault());

  const moveOrigin = { x: 0, y: 0 };
  move.addEventListener("pointerdown", (e) => {
    if (movePtr !== null) return;
    if (e.button !== 0 && e.pointerType === "mouse") return;
    if (tryPickArmsWeapon(e.clientX, e.clientY)) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    e.preventDefault();
    movePtr = e.pointerId;
    try {
      move.setPointerCapture(e.pointerId);
    } catch {
      /* older iOS */
    }
    placeStick(e.clientX, e.clientY, move, "touch-stick", moveOrigin);
    stickOriginX = moveOrigin.x;
    stickOriginY = moveOrigin.y;
    onMoveStick(e.clientX, e.clientY);
  });
  move.addEventListener("pointermove", (e) => {
    if (e.pointerId !== movePtr) return;
    e.preventDefault();
    onMoveStick(e.clientX, e.clientY);
  });
  const endMove = (e: PointerEvent) => {
    if (e.pointerId !== movePtr) return;
    movePtr = null;
    touchSetStick(0, 0);
    applyRunToggle();
    el("touch-stick").classList.remove("run");
    resetStick("touch-stick", "touch-stick-knob");
  };
  move.addEventListener("pointerup", endMove);
  move.addEventListener("pointercancel", endMove);

  look.addEventListener("pointerdown", (e) => {
    if (lookPtr !== null) return;
    if (e.button !== 0 && e.pointerType === "mouse") return;
    if (tryPickArmsWeapon(e.clientX, e.clientY)) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    e.preventDefault();
    lookPtr = e.pointerId;
    try {
      look.setPointerCapture(e.pointerId);
    } catch {
      /* older iOS */
    }
    lastLookX = e.clientX;
  });
  look.addEventListener("pointermove", (e) => {
    if (e.pointerId !== lookPtr) return;
    e.preventDefault();
    const dx = e.clientX - lastLookX;
    lastLookX = e.clientX;
    if (dx !== 0) touchAddLook(dx);
  });
  const endLook = (e: PointerEvent) => {
    if (e.pointerId !== lookPtr) return;
    lookPtr = null;
  };
  look.addEventListener("pointerup", endLook);
  look.addEventListener("pointercancel", endLook);

  bindLookStick();

  bindHoldWithLook(
    el("touch-fire"),
    KEY.fire,
    () => lastFireLookX,
    (x) => {
      lastFireLookX = x;
    },
    true,
  );
  bindHoldWithLook(
    el("touch-use"),
    KEY.use,
    () => lastUseLookX,
    (x) => {
      lastUseLookX = x;
    },
    false,
  );
  bindTap(el("touch-weap"), KEY.weapNext);
  bindHold(el("touch-hop"), KEY.hop);
  bindHold(el("touch-fly-up"), KEY.flyUp);
  bindHold(el("touch-fly-down"), KEY.flyDown);
  bindTap(el("touch-mod-h"), KEY.buyH);
  bindTap(el("touch-mod-s"), KEY.buyS);
  bindTap(el("touch-mod-d"), KEY.buyD);
  bindTap(el("touch-mod-r"), KEY.buyR);

  const runBtn = el("touch-run");
  runBtn.classList.toggle("on", runOn);
  touchSetRun(runOn);
  runBtn.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.preventDefault();
    e.stopPropagation();
    runOn = !runOn;
    if (movePtr === null) applyRunToggle();
    else runBtn.classList.toggle("on", runOn);
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) releaseAll();
  });
  window.addEventListener("blur", releaseAll);
  window.addEventListener("pagehide", releaseAll);

  subscribeClientSettings(() => applyLookStickChrome());
}

function startTouchControls() {
  if (started) return;
  started = true;
  document.body.classList.add("touch-on");
  el("touch-controls").classList.remove("hidden");
  initGyro();
  bindControls();
  applyTouchChrome();
}

export function initTouchControls() {
  initGyro();
  if (wantTouch()) {
    startTouchControls();
    return;
  }
  window.addEventListener(
    "touchstart",
    () => {
      if (window.matchMedia("(pointer: coarse)").matches) startTouchControls();
    },
    { once: true, passive: true },
  );
}

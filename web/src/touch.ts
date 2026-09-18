// On-screen controls for thin client. Feeds web/src/thin/input.ts.

import {
  touchAddLook,
  touchSetKey,
  touchSetRun,
  touchSetStick,
} from "./thin/input";

const FLYERS = new Set(["lostsoul", "cacodemon"]);

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
let stickOriginX = 0;
let stickOriginY = 0;
let stickRadius = 56;
let lastLookX = 0;
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

function releaseAll() {
  for (const k of [...held]) setKey(k, false);
  setFire(false);
  touchSetStick(0, 0);
  movePtr = null;
  lookPtr = null;
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

function bindFire(btn: HTMLElement) {
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
    setFire(true);
  };
  const up = (e: PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    btn.classList.remove("pressed");
    setFire(false);
  };
  btn.addEventListener("pointerdown", down);
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

function placeStick(x: number, y: number, zone: HTMLElement) {
  const stick = el("touch-stick");
  const rect = zone.getBoundingClientRect();
  const r = stickRadius;
  const cx = Math.min(Math.max(x - rect.left, r + 8), rect.width - r - 8);
  const cy = Math.min(Math.max(y - rect.top, r + 8), rect.height - r - 8);
  stick.style.left = `${cx - r}px`;
  stick.style.top = `${cy - r}px`;
  stick.style.bottom = "auto";
  stickOriginX = rect.left + cx;
  stickOriginY = rect.top + cy;
}

function resetStick() {
  const stick = el("touch-stick");
  const knob = el("touch-stick-knob");
  stick.style.left = "";
  stick.style.top = "";
  stick.style.bottom = "";
  knob.style.transform = "translate(-50%, -50%)";
}

function onStickMove(x: number, y: number) {
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
}

function applyTouchChrome() {
  const root = document.getElementById("touch-controls");
  if (!root || !document.body.classList.contains("touch-on")) return;
  const playing = lastRole === "marine" || lastRole === "demon";
  el("touch-move").classList.toggle("hidden", !playing);
  el("touch-look").classList.toggle("hidden", !playing);
  el("touch-actions").classList.toggle("hidden", !playing);
  el("touch-demon").classList.toggle("hidden", lastRole !== "demon");
  el("touch-weap").classList.toggle("hidden", lastRole !== "marine");
  el("touch-fly").classList.toggle("hidden", lastRole !== "demon" || !FLYERS.has(lastBody));
  if (!playing) releaseAll();
}

export function setTouchRole(role: string) {
  lastRole = role;
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

function bindControls() {
  const move = el("touch-move");
  const look = el("touch-look");

  el("touch-controls").addEventListener("contextmenu", (e) => e.preventDefault());

  move.addEventListener("pointerdown", (e) => {
    if (movePtr !== null) return;
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.preventDefault();
    movePtr = e.pointerId;
    try {
      move.setPointerCapture(e.pointerId);
    } catch {
      /* older iOS */
    }
    placeStick(e.clientX, e.clientY, move);
    onStickMove(e.clientX, e.clientY);
  });
  move.addEventListener("pointermove", (e) => {
    if (e.pointerId !== movePtr) return;
    e.preventDefault();
    onStickMove(e.clientX, e.clientY);
  });
  const endMove = (e: PointerEvent) => {
    if (e.pointerId !== movePtr) return;
    movePtr = null;
    touchSetStick(0, 0);
    resetStick();
  };
  move.addEventListener("pointerup", endMove);
  move.addEventListener("pointercancel", endMove);

  look.addEventListener("pointerdown", (e) => {
    if (lookPtr !== null) return;
    if (e.button !== 0 && e.pointerType === "mouse") return;
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

  bindFire(el("touch-fire"));
  bindHold(el("touch-use"), KEY.use);
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
    touchSetRun(runOn);
    runBtn.classList.toggle("on", runOn);
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) releaseAll();
  });
  window.addEventListener("blur", releaseAll);
  window.addEventListener("pagehide", releaseAll);
}

function startTouchControls() {
  if (started) return;
  started = true;
  document.body.classList.add("touch-on");
  el("touch-controls").classList.remove("hidden");
  bindControls();
  applyTouchChrome();
}

export function initTouchControls() {
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

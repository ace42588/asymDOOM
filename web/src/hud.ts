// Thin-client HUD helpers (DOM only — no stdout scrape).

import { setTouchBody, setTouchRole } from "./touch";

const el = (id: string) => document.getElementById(id)!;

let bannerTimer: number | undefined;
let currentRole = "";
let hintHeld = false;

export function banner(text: string, sticky = false) {
  const b = el("hud-banner");
  b.textContent = text;
  b.classList.remove("hidden");
  if (bannerTimer) window.clearTimeout(bannerTimer);
  if (!sticky) {
    bannerTimer = window.setTimeout(() => b.classList.add("hidden"), 4000);
  }
}

export function setCatchup(visible: boolean, text?: string) {
  const catchup = el("hud-catchup");
  if (text != null) catchup.textContent = text;
  catchup.classList.toggle("hidden", !visible);
}

function hintHtml(role: string): string {
  if (role === "demon") {
    return "<b>5</b> hop to another demon &middot; <b>E/F</b> doors or consume (+25 pts / HoT) or scavenge gore (+10) &middot; Buy: <b>1</b> health &middot; <b>2</b> speed &middot; <b>3</b> damage &middot; <b>4</b> attack rate &mdash; 25 pts each";
  }
  if (role === "spectator") {
    return "<b>P</b> possess &middot; <b>[</b>/<b>]</b> follow &middot; <b>5</b> hop when possessed";
  }
  return "<b>LMB/Space/Ctrl</b> fire &middot; <b>E</b> use &middot; <b>1–8</b> weapons &middot; wheel cycle";
}

function syncHint() {
  const hint = el("hud-hint");
  const roleKnown = currentRole === "marine" || currentRole === "demon" || currentRole === "spectator";
  hint.innerHTML = hintHtml(currentRole);
  hint.classList.toggle("hidden", !hintHeld || !roleKnown);
}

export function initHud() {
  window.addEventListener("keydown", (e) => {
    if (e.key.toLowerCase() !== "h" || e.repeat) return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    hintHeld = true;
    syncHint();
  });
  window.addEventListener("keyup", (e) => {
    if (e.key.toLowerCase() !== "h") return;
    hintHeld = false;
    syncHint();
  });
  window.addEventListener("blur", () => {
    hintHeld = false;
    syncHint();
  });
}

export function setRole(role: string) {
  el("hud-role").classList.add("hidden");
  currentRole = role;
  syncHint();
  setTouchRole(role);
}

/** Possessed body for touch chrome (flyers). Canvas STBAR is the on-screen HUD. */
export function setDemonBody(species: string | null) {
  setTouchBody(species ?? "");
}

export function setMarineVitals(v: { health: number; armor: number; ammo: number; weapon: number } | null) {
  const node = document.getElementById("hud-marine-vitals");
  if (!node) return;
  // Canvas STBAR is the marine HUD; keep the DOM readout hidden.
  node.classList.add("hidden");
  void v;
}

/**
 * Twist-down client settings panel (DOM). Applies live; persists via clientSettings.
 */

import {
  getClientSettings,
  setClientSettings,
  subscribeClientSettings,
  type CanvasScaleMode,
  type ClientSettings,
  type HudPlacement,
  type RenderScaleMode,
} from "./thin/clientSettings";

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function exitPointerLock() {
  if (document.pointerLockElement) document.exitPointerLock?.();
}

function syncForm(s: ClientSettings) {
  const look = el<HTMLInputElement>("set-look-sens");
  const lookVal = el<HTMLSpanElement>("set-look-sens-val");
  const render = el<HTMLSelectElement>("set-render-scale");
  const canvas = el<HTMLSelectElement>("set-canvas-scale");
  const place = el<HTMLSelectElement>("set-hud-placement");
  const hud = el<HTMLInputElement>("set-hud-scale");
  const hudVal = el<HTMLSpanElement>("set-hud-scale-val");
  const cross = el<HTMLInputElement>("set-crosshair");
  if (!look || !render || !canvas || !place || !hud || !cross) return;

  look.value = String(s.lookSens);
  if (lookVal) lookVal.textContent = `${s.lookSens.toFixed(2)}×`;
  render.value = String(s.renderScale);
  canvas.value = String(s.canvasScale);
  place.value = s.hudPlacement;
  hud.value = String(Math.round(s.hudScale * 100));
  if (hudVal) hudVal.textContent = `${Math.round(s.hudScale * 100)}%`;
  cross.checked = s.showCrosshair;
}

export function initClientSettingsUi() {
  getClientSettings();
  const root = el<HTMLDetailsElement>("client-settings");
  if (!root) return;

  root.addEventListener("toggle", () => {
    if (root.open) exitPointerLock();
  });

  // Opening via pointer should release lock before interacting with controls.
  root.addEventListener("pointerdown", () => exitPointerLock());

  const look = el<HTMLInputElement>("set-look-sens");
  const render = el<HTMLSelectElement>("set-render-scale");
  const canvas = el<HTMLSelectElement>("set-canvas-scale");
  const place = el<HTMLSelectElement>("set-hud-placement");
  const hud = el<HTMLInputElement>("set-hud-scale");
  const cross = el<HTMLInputElement>("set-crosshair");

  look?.addEventListener("input", () => {
    setClientSettings({ lookSens: Number(look.value) });
  });
  render?.addEventListener("change", () => {
    const raw = render.value;
    const mode: RenderScaleMode =
      raw === "auto" ? "auto" : (Number(raw) as 1 | 2 | 4);
    setClientSettings({ renderScale: mode });
    console.info("[settings] renderScale", mode);
  });
  canvas?.addEventListener("change", () => {
    const raw = canvas.value;
    const mode: CanvasScaleMode =
      raw === "fit" ? "fit" : (Number(raw) as 1 | 2);
    setClientSettings({ canvasScale: mode });
  });
  place?.addEventListener("change", () => {
    setClientSettings({ hudPlacement: place.value as HudPlacement });
  });
  hud?.addEventListener("input", () => {
    setClientSettings({ hudScale: Number(hud.value) / 100 });
  });
  cross?.addEventListener("change", () => {
    setClientSettings({ showCrosshair: cross.checked });
  });

  syncForm(getClientSettings());
  subscribeClientSettings(syncForm);
}

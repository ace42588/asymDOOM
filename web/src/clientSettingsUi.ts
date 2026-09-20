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
import {
  disableGyro,
  enableGyroFromUserGesture,
  getGyroStatus,
  subscribeGyroStatus,
  type GyroStatus,
} from "./thin/gyro";

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function exitPointerLock() {
  if (document.pointerLockElement) document.exitPointerLock?.();
}

function setSensVal(inputId: string, valId: string, v: number) {
  const input = el<HTMLInputElement>(inputId);
  const val = el<HTMLSpanElement>(valId);
  if (input) input.value = String(v);
  if (val) val.textContent = `${v.toFixed(2)}×`;
}

function setRowEnabled(rowId: string, on: boolean) {
  const row = document.getElementById(rowId);
  if (!row) return;
  row.classList.toggle("is-disabled", !on);
  const input = row.querySelector("input");
  if (input) input.toggleAttribute("disabled", !on);
}

function gyroStatusText(s: GyroStatus): string {
  if (s === "denied") return "Motion permission denied";
  if (s === "unavailable") return "Gyro unavailable on this device";
  return "";
}

function syncGyroStatusUi(status: GyroStatus) {
  const line = el<HTMLParagraphElement>("set-gyro-status");
  const text = gyroStatusText(status);
  if (!line) return;
  if (text) {
    line.hidden = false;
    line.textContent = text;
  } else {
    line.hidden = true;
    line.textContent = "";
  }
  const box = el<HTMLInputElement>("set-gyro");
  if (box && (status === "denied" || status === "unavailable")) {
    box.checked = false;
  }
}

function syncForm(s: ClientSettings) {
  const look = el<HTMLInputElement>("set-look-sens");
  const render = el<HTMLSelectElement>("set-render-scale");
  const canvas = el<HTMLSelectElement>("set-canvas-scale");
  const place = el<HTMLSelectElement>("set-hud-placement");
  const hud = el<HTMLInputElement>("set-hud-scale");
  const hudVal = el<HTMLSpanElement>("set-hud-scale-val");
  const cross = el<HTMLInputElement>("set-crosshair");
  const music = el<HTMLInputElement>("set-music");
  const lookStick = el<HTMLInputElement>("set-look-stick");
  const gyro = el<HTMLInputElement>("set-gyro");
  if (!look || !render || !canvas || !place || !hud || !cross) return;

  setSensVal("set-look-sens", "set-look-sens-val", s.lookSens);
  setSensVal("set-touch-look-sens", "set-touch-look-sens-val", s.touchLookSens);
  setSensVal("set-look-stick-sens", "set-look-stick-sens-val", s.lookStickSens);
  setSensVal("set-gyro-sens", "set-gyro-sens-val", s.gyroSens);

  if (lookStick) lookStick.checked = s.lookStick;
  if (gyro) gyro.checked = s.gyroEnabled;
  setRowEnabled("set-look-stick-sens-row", s.lookStick);
  setRowEnabled("set-gyro-sens-row", s.gyroEnabled);

  render.value = String(s.renderScale);
  canvas.value = String(s.canvasScale);
  place.value = s.hudPlacement;
  hud.value = String(Math.round(s.hudScale * 100));
  if (hudVal) hudVal.textContent = `${Math.round(s.hudScale * 100)}%`;
  cross.checked = s.showCrosshair;
  if (music) music.checked = s.musicEnabled;

  syncGyroStatusUi(getGyroStatus());
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
  const touchLook = el<HTMLInputElement>("set-touch-look-sens");
  const lookStick = el<HTMLInputElement>("set-look-stick");
  const lookStickSens = el<HTMLInputElement>("set-look-stick-sens");
  const gyro = el<HTMLInputElement>("set-gyro");
  const gyroSens = el<HTMLInputElement>("set-gyro-sens");
  const render = el<HTMLSelectElement>("set-render-scale");
  const canvas = el<HTMLSelectElement>("set-canvas-scale");
  const place = el<HTMLSelectElement>("set-hud-placement");
  const hud = el<HTMLInputElement>("set-hud-scale");
  const cross = el<HTMLInputElement>("set-crosshair");
  const music = el<HTMLInputElement>("set-music");

  look?.addEventListener("input", () => {
    setClientSettings({ lookSens: Number(look.value) });
  });
  touchLook?.addEventListener("input", () => {
    setClientSettings({ touchLookSens: Number(touchLook.value) });
  });
  lookStick?.addEventListener("change", () => {
    setClientSettings({ lookStick: lookStick.checked });
  });
  lookStickSens?.addEventListener("input", () => {
    setClientSettings({ lookStickSens: Number(lookStickSens.value) });
  });
  gyro?.addEventListener("change", () => {
    if (gyro.checked) {
      void enableGyroFromUserGesture().then((status) => {
        if (status === "denied" || status === "unavailable") {
          gyro.checked = false;
        }
        syncGyroStatusUi(status);
        syncForm(getClientSettings());
      });
    } else {
      disableGyro();
      syncGyroStatusUi("off");
      syncForm(getClientSettings());
    }
  });
  gyroSens?.addEventListener("input", () => {
    setClientSettings({ gyroSens: Number(gyroSens.value) });
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
  music?.addEventListener("change", () => {
    setClientSettings({ musicEnabled: music.checked });
  });

  syncForm(getClientSettings());
  subscribeClientSettings(syncForm);
  subscribeGyroStatus(syncGyroStatusUi);
}

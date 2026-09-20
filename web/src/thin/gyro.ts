/**
 * Opt-in yaw look from DeviceMotion rotationRate (relative deg/s).
 * Additive with swipe / look stick; no absolute orientation snap.
 */

import {
  getClientSettings,
  setClientSettings,
  subscribeClientSettings,
} from "./clientSettings";
import { gyroRateToTurnDelta, touchAddTurnDelta } from "./input";

export type GyroStatus = "off" | "active" | "denied" | "unavailable";

type StatusListener = (status: GyroStatus) => void;

let status: GyroStatus = "off";
let listening = false;
let playing = false;
let lastTs = 0;
let unsubSettings: (() => void) | null = null;
const statusListeners = new Set<StatusListener>();

function setStatus(next: GyroStatus) {
  if (status === next) return;
  status = next;
  for (const fn of statusListeners) fn(status);
}

export function getGyroStatus(): GyroStatus {
  return status;
}

export function subscribeGyroStatus(fn: StatusListener): () => void {
  statusListeners.add(fn);
  fn(status);
  return () => statusListeners.delete(fn);
}

export function setGyroPlaying(on: boolean) {
  playing = on;
  syncListener();
}

/** Screen-yaw component of rotationRate in deg/s (device-frame → screen yaw). */
export function yawRateFromRotation(
  alpha: number | null | undefined,
  beta: number | null | undefined,
  gamma: number | null | undefined,
  orientationAngle: number,
): number {
  const a = typeof alpha === "number" && Number.isFinite(alpha) ? alpha : 0;
  const b = typeof beta === "number" && Number.isFinite(beta) ? beta : 0;
  const g = typeof gamma === "number" && Number.isFinite(gamma) ? gamma : 0;
  // DeviceMotion axes: alpha=z, beta=x, gamma=y (deg/s).
  // Map to screen yaw based on screen.orientation.angle.
  const angle = ((orientationAngle % 360) + 360) % 360;
  if (angle === 90) return -a; // landscape-primary (home button right-ish)
  if (angle === 270) return a; // landscape-secondary
  if (angle === 180) return -g; // upside-down portrait
  return g; // portrait (0)
}

function orientationAngle(): number {
  try {
    const o = screen.orientation?.angle;
    if (typeof o === "number" && Number.isFinite(o)) return o;
  } catch {
    /* ignore */
  }
  const w = window as Window & { orientation?: number };
  return typeof w.orientation === "number" ? w.orientation : 0;
}

function onMotion(e: DeviceMotionEvent) {
  if (!playing || document.visibilityState !== "visible") return;
  const rr = e.rotationRate;
  if (!rr) {
    setStatus("unavailable");
    stopListener();
    return;
  }
  const now = typeof e.timeStamp === "number" && e.timeStamp > 0 ? e.timeStamp : performance.now();
  const dt = lastTs > 0 ? Math.min(0.1, (now - lastTs) / 1000) : 0;
  lastTs = now;
  if (dt <= 0) return;
  const yawDegPerSec = yawRateFromRotation(rr.alpha, rr.beta, rr.gamma, orientationAngle());
  const sens = getClientSettings().gyroSens;
  const delta = gyroRateToTurnDelta(yawDegPerSec, dt, sens);
  if (delta !== 0) touchAddTurnDelta(delta);
}

function stopListener() {
  if (!listening) return;
  window.removeEventListener("devicemotion", onMotion);
  listening = false;
  lastTs = 0;
}

function startListener() {
  if (listening) return;
  window.addEventListener("devicemotion", onMotion);
  listening = true;
  lastTs = 0;
  setStatus("active");
}

function syncListener() {
  const enabled = getClientSettings().gyroEnabled;
  const want = enabled && playing && document.visibilityState === "visible";
  if (!want) {
    stopListener();
    if (!enabled) setStatus("off");
    return;
  }
  startListener();
}

function onVisibility() {
  syncListener();
}

/**
 * Request iOS motion permission (must be from a user gesture), then enable.
 * Returns final status after the attempt.
 */
export async function enableGyroFromUserGesture(): Promise<GyroStatus> {
  const DOE = DeviceOrientationEvent as unknown as {
    requestPermission?: () => Promise<"granted" | "denied">;
  };
  if (typeof DOE.requestPermission === "function") {
    try {
      const result = await DOE.requestPermission();
      if (result !== "granted") {
        setClientSettings({ gyroEnabled: false });
        setStatus("denied");
        stopListener();
        return "denied";
      }
    } catch {
      setClientSettings({ gyroEnabled: false });
      setStatus("denied");
      stopListener();
      return "denied";
    }
  }

  // Probe that DeviceMotion exists at all.
  if (typeof DeviceMotionEvent === "undefined") {
    setClientSettings({ gyroEnabled: false });
    setStatus("unavailable");
    return "unavailable";
  }

  setClientSettings({ gyroEnabled: true });
  syncListener();
  return status === "off" ? "active" : status;
}

export function disableGyro() {
  setClientSettings({ gyroEnabled: false });
  stopListener();
  setStatus("off");
}

export function initGyro() {
  if (unsubSettings) return;
  unsubSettings = subscribeClientSettings(() => syncListener());
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("blur", () => {
    stopListener();
  });
  window.addEventListener("focus", () => syncListener());
  if (getClientSettings().gyroEnabled) {
    // Cannot auto-prompt on iOS; leave enabled in storage but wait for gesture / sync.
    syncListener();
  } else {
    setStatus("off");
  }
}

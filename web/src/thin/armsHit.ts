/**
 * Marine STBAR ARMS tap → weapon digit (2–7).
 * Pure hit math lives in hudGfx; this wraps canvas CSS coords + role gate.
 */

import {
  getClientSettings,
  resolveRenderScale,
  worldSizeForRenderScale,
} from "./clientSettings";
import { hitTestArmsWeapon } from "./wad/hudGfx";

let marineActive = false;

export function setArmsPickEnabled(on: boolean) {
  marineActive = on;
}

/** Map a client (CSS) point on #canvas to an ARMS weapon digit, or null. */
export function armsWeaponAtClientPoint(clientX: number, clientY: number): number | null {
  if (!marineActive) return null;
  const canvas = document.getElementById("canvas") as HTMLCanvasElement | null;
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  if (
    clientX < rect.left ||
    clientX > rect.right ||
    clientY < rect.top ||
    clientY > rect.bottom
  ) {
    return null;
  }
  const settings = getClientSettings();
  const world = worldSizeForRenderScale(resolveRenderScale(settings.renderScale));
  const cx = ((clientX - rect.left) / rect.width) * canvas.width;
  const cy = ((clientY - rect.top) / rect.height) * canvas.height;
  return hitTestArmsWeapon(
    cx,
    cy,
    world.width,
    world.height,
    settings.hudPlacement,
    settings.hudScale,
  );
}

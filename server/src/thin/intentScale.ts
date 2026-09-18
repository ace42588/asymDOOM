/** Map wire-protocol intent axes [-1,1] + run → doomgeneric ticcmd magnitudes. */

export function clampAxis(v: number): number {
  if (Number.isNaN(v)) return 0;
  if (v > 1) return 1;
  if (v < -1) return -1;
  return v;
}

/** Vanilla-ish walk/run forwardmove / sidemove magnitudes. */
export function toTiccmdMoves(
  forward: number,
  strafe: number,
  run: boolean,
): { forward: number; strafe: number } {
  const f = clampAxis(forward);
  const s = clampAxis(strafe);
  const fMag = run ? 50 : 25;
  const sMag = run ? 40 : 24;
  return {
    forward: Math.round(f * fMag),
    strafe: Math.round(s * sMag),
  };
}

/** turnDelta is radians-ish look delta from the client; map to angleturn units. */
export function toTiccmdTurn(turnDelta: number): number {
  if (!Number.isFinite(turnDelta)) return 0;
  // ~800 angleturn units per radian of look feels close to pointer-lock sampling
  return Math.max(-32767, Math.min(32767, Math.round(turnDelta * 800)));
}

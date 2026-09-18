/**
 * Map embed/native views onto the contracts wire format (PROTOCOL.md + schemas).
 */
import type { DoorView, MoverView, ProjectileView } from "./embedTypes.js";

export type DoorWireState = "open" | "closed" | "opening" | "closing" | "waiting";
export type MoverWireKind = "plat" | "floor" | "ceiling";
export type MoverWireState = "waiting" | "up" | "down";

/** Native asym_door.state: 0 closed, 1 open, 2 opening, 3 closing (+ waiting). */
const DOOR_STATE_BY_CODE: DoorWireState[] = ["closed", "open", "opening", "closing", "waiting"];
const MOVER_KIND_BY_CODE: MoverWireKind[] = ["plat", "floor", "ceiling"];
const MOVER_STATE_BY_CODE: MoverWireState[] = ["waiting", "up", "down"];

export function encodeDoorState(code: number): DoorWireState {
  return DOOR_STATE_BY_CODE[code] ?? "closed";
}

export function encodeMoverKind(code: number): MoverWireKind {
  return MOVER_KIND_BY_CODE[code] ?? "plat";
}

export function encodeMoverState(code: number): MoverWireState {
  return MOVER_STATE_BY_CODE[code] ?? "waiting";
}

export interface WireDoor {
  id: number;
  state: DoorWireState;
  position: number;
  x?: number;
  y?: number;
  z?: number;
}

export interface WireMover {
  id: number;
  kind: MoverWireKind;
  state: MoverWireState;
  floor: number;
  ceiling: number;
  x?: number;
  y?: number;
  z?: number;
}

export interface WireProjectile {
  id: number;
  type: number;
  x: number;
  y: number;
  z: number;
  angle: number;
  momx?: number;
  momy?: number;
  momz?: number;
  sprite?: number;
  frame?: number;
}

/** Encode embed door → wire door (string state; optional x/y/z). */
export function encodeDoor(d: DoorView): WireDoor {
  const out: WireDoor = {
    id: d.id,
    state: encodeDoorState(d.state),
    position: d.position,
  };
  if (d.x != null) out.x = d.x;
  if (d.y != null) out.y = d.y;
  if (d.z != null) out.z = d.z;
  return out;
}

export function encodeMover(m: MoverView): WireMover {
  const out: WireMover = {
    id: m.id,
    kind: encodeMoverKind(m.kind),
    state: encodeMoverState(m.state),
    floor: m.floor,
    ceiling: m.ceiling,
  };
  if (m.x != null) out.x = m.x;
  if (m.y != null) out.y = m.y;
  if (m.z != null) out.z = m.z;
  return out;
}

/** Encode embed projectile → wire projectile (angle required). */
export function encodeProjectile(p: ProjectileView): WireProjectile {
  const out: WireProjectile = {
    id: p.id,
    type: p.type,
    x: p.x,
    y: p.y,
    z: p.z,
    angle: p.angle ?? 0,
  };
  if (p.momx != null) out.momx = p.momx;
  if (p.momy != null) out.momy = p.momy;
  if (p.momz != null) out.momz = p.momz;
  if (p.sprite != null) out.sprite = p.sprite;
  if (p.frame != null) out.frame = p.frame;
  return out;
}

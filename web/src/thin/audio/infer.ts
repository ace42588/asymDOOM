import type { ClientState, Projectile, SimEvent } from "../state";
import { SPRNAMES } from "../wad/sprites";
import type { SfxCue } from "./mixer";

/** Pickup typeNames that play item/weapon/powerup sounds (not gore props). */
const PICKUP_SFX: Record<string, string> = {
  armor: "itemup",
  megaarmor: "itemup",
  healthbonus: "itemup",
  armorbonus: "itemup",
  bluecard: "itemup",
  yellowcard: "itemup",
  redcard: "itemup",
  blueskull: "itemup",
  yellowskull: "itemup",
  redskull: "itemup",
  stimpack: "itemup",
  medikit: "itemup",
  clip: "itemup",
  clipbox: "itemup",
  rocket: "itemup",
  rocketbox: "itemup",
  cell: "itemup",
  cellpack: "itemup",
  shell: "itemup",
  shellbox: "itemup",
  backpack: "itemup",
  shotgun: "wpnup",
  supershotgun: "wpnup",
  chaingun: "wpnup",
  rocketlauncher: "wpnup",
  plasmarifle: "wpnup",
  chainsaw: "wpnup",
  bfg: "wpnup",
  soulsphere: "getpow",
  invulnerability: "getpow",
  berserk: "getpow",
  invisibility: "getpow",
  radsuit: "getpow",
  automap: "getpow",
  visor: "getpow",
  megasphere: "getpow",
};

/** Species / typeName → death SFX. */
const DEATH_SFX: Record<string, string> = {
  marine: "pldeth",
  zombieman: "podth1",
  shotgunner: "podth2",
  imp: "bgdth1",
  demon: "sgtdth",
  spectre: "sgtdth",
  cacodemon: "cacdth",
  lostsoul: "firxpl",
  baron: "brsdth",
  barrel: "barexp",
};

/** Projectile sprite → { spawn, death } SFX. */
const PROJ_SFX: Record<string, { spawn?: string; death?: string }> = {
  BAL1: { spawn: "firsht", death: "firxpl" },
  BAL2: { spawn: "firsht", death: "firxpl" },
  BAL7: { spawn: "firsht", death: "firxpl" },
  MANF: { spawn: "firsht", death: "firxpl" },
  PLSS: { spawn: "plasma", death: "firxpl" },
  APLS: { spawn: "plasma", death: "firxpl" },
  MISL: { spawn: "rlaunc", death: "barexp" },
  BFS1: { spawn: undefined, death: "rxplod" }, // BFG seesound is 0; fire via weapon
};

const SEE_SFX: Record<string, string> = {
  zombieman: "posit1",
  shotgunner: "posit2",
  imp: "bgsit1",
  demon: "sgtsit",
  spectre: "sgtsit",
  cacodemon: "cacsit",
  lostsoul: "cacsit",
  baron: "brssit",
};

export interface InferResult {
  cues: SfxCue[];
  /** Active stnmov loops: mover id → origin */
  moverLoops: Map<number, { x: number; y: number }>;
}

/**
 * Infer SFX from snapshot deltas. Skip when prev was mid-mapLoad / empty world
 * transitioning to a full spawn dump.
 */
export function inferSfx(prev: ClientState, next: ClientState, events: SimEvent[] = []): InferResult {
  const cues: SfxCue[] = [];
  const moverLoops = new Map<number, { x: number; y: number }>();

  // First snapshot after mapLoad: empty → full world — no spawn cascade.
  if (prev.mapLoading || (prev.entities.actors.size === 0 && next.entities.actors.size > 8)) {
    collectMoverLoops(next, moverLoops);
    return { cues, moverLoops };
  }

  inferDoors(prev, next, cues);
  inferPlats(prev, next, cues);
  collectMoverLoops(next, moverLoops);
  inferProjectiles(prev, next, cues);
  inferActors(prev, next, cues);
  inferEvents(next, events, cues);
  inferMarine(prev, next, cues);

  return { cues, moverLoops };
}

function pos(e: { x?: number; y?: number; z?: number }): Pick<SfxCue, "x" | "y" | "z"> {
  const out: Pick<SfxCue, "x" | "y" | "z"> = {};
  if (e.x != null) out.x = e.x;
  if (e.y != null) out.y = e.y;
  if (e.z != null) out.z = e.z;
  return out;
}

function inferDoors(prev: ClientState, next: ClientState, cues: SfxCue[]) {
  for (const [id, door] of next.entities.doors) {
    const before = prev.entities.doors.get(id);
    // Door thinkers appear on open/close; fire on spawn-into-motion or state change.
    if (!before && door.state === "opening") {
      cues.push({ name: "doropn", ...pos(door) });
    } else if (!before && door.state === "closing") {
      cues.push({ name: "dorcls", ...pos(door) });
    } else if (before && before.state !== door.state) {
      if (before.state === "closed" && door.state === "opening") {
        cues.push({ name: "doropn", ...pos(door) });
      } else if (
        (before.state === "open" || before.state === "waiting") &&
        door.state === "closing"
      ) {
        cues.push({ name: "dorcls", ...pos(door) });
      }
    }
  }
}

function inferPlats(prev: ClientState, next: ClientState, cues: SfxCue[]) {
  for (const [id, m] of next.entities.movers) {
    if (m.kind !== "plat") continue;
    const before = prev.entities.movers.get(id);
    if (!before) {
      if (m.state === "up" || m.state === "down") {
        cues.push({ name: "pstart", ...pos(m) });
      }
      continue;
    }
    if (before.state === "waiting" && (m.state === "up" || m.state === "down")) {
      cues.push({ name: "pstart", ...pos(m) });
    } else if ((before.state === "up" || before.state === "down") && m.state === "waiting") {
      cues.push({ name: "pstop", ...pos(m) });
    }
  }
}

function collectMoverLoops(state: ClientState, out: Map<number, { x: number; y: number }>) {
  for (const [id, m] of state.entities.movers) {
    if (m.kind === "plat") continue; // plats use pstart/pstop
    if (m.state === "up" || m.state === "down") {
      out.set(id, { x: m.x ?? 0, y: m.y ?? 0 });
    }
  }
}

function spriteName(p: Projectile): string | undefined {
  if (p.sprite != null && p.sprite >= 0 && p.sprite < SPRNAMES.length) {
    return SPRNAMES[p.sprite];
  }
  return undefined;
}

function inferProjectiles(prev: ClientState, next: ClientState, cues: SfxCue[]) {
  for (const [id, p] of next.entities.projectiles) {
    if (prev.entities.projectiles.has(id)) continue;
    const spr = spriteName(p);
    const entry = spr ? PROJ_SFX[spr] : undefined;
    if (entry?.spawn) cues.push({ name: entry.spawn, ...pos(p) });
  }
  for (const [id, p] of prev.entities.projectiles) {
    if (next.entities.projectiles.has(id)) continue;
    const spr = spriteName(p);
    const entry = spr ? PROJ_SFX[spr] : undefined;
    if (entry?.death) cues.push({ name: entry.death, x: p.x, y: p.y, z: p.z });
  }
}

function inferActors(prev: ClientState, next: ClientState, cues: SfxCue[]) {
  for (const [id, a] of next.entities.actors) {
    const before = prev.entities.actors.get(id);
    if (!before) continue;
    if (before.health > 0 && a.health <= 0) {
      const key = a.typeName ?? (a.kind === "marine" ? "marine" : "");
      const sfx = DEATH_SFX[key];
      if (sfx) cues.push({ name: sfx, ...pos(a) });
    }
  }
  // Item pickups: despawn of known pickup typeNames
  for (const [id, a] of prev.entities.actors) {
    if (a.kind !== "item") continue;
    if (next.entities.actors.has(id)) continue;
    const name = a.typeName ? PICKUP_SFX[a.typeName] : undefined;
    if (name) cues.push({ name, x: a.x, y: a.y, z: a.z });
  }
}

function inferEvents(state: ClientState, events: SimEvent[], cues: SfxCue[]) {
  for (const e of events) {
    if (e.kind === "possess" || e.kind === "hop") {
      const species = e.species ?? "";
      const sfx = SEE_SFX[species];
      const body = e.bodyId != null ? state.entities.actors.get(e.bodyId) : undefined;
      if (sfx) {
        cues.push(body ? { name: sfx, ...pos(body) } : { name: sfx, local: true });
      }
    }
    // consume slop is session-filtered — other clients get it via wire sound event
  }
}

function inferMarine(prev: ClientState, next: ClientState, cues: SfxCue[]) {
  const pm = prev.marine;
  const nm = next.marine;
  if (!nm || next.role !== "marine") return;
  if (pm && pm.weapon !== nm.weapon) {
    cues.push({ name: "sgcock", local: true });
  }
}

/** Weapon index → muzzle SFX for HudGfx prediction. */
export function weaponFireSfx(weapon: number): string | null {
  switch (weapon) {
    case 1:
    case 3:
      return "pistol";
    case 2:
      return "shotgn";
    case 4:
      return "rlaunc";
    case 5:
      return "plasma";
    case 6:
      return "bfg";
    case 7:
      return "sawful";
    case 8:
      return "dshtgn";
    default:
      return null;
  }
}

/** Same-tick dedup: drop wire cue if infer already has nearby same name. */
export function dedupeCues(inferred: SfxCue[], wire: SfxCue[], radius = 64): SfxCue[] {
  const out: SfxCue[] = [];
  for (const w of wire) {
    const hit = inferred.some((i) => {
      if (i.name.toLowerCase() !== w.name.toLowerCase()) return false;
      if (i.local || w.local) return true;
      if (i.x == null || w.x == null || i.y == null || w.y == null) return i.local === w.local;
      const dx = i.x - w.x;
      const dy = i.y - w.y;
      return dx * dx + dy * dy < radius * radius;
    });
    if (!hit) out.push(w);
  }
  return out;
}

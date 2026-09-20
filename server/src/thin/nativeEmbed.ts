/**
 * NativeEmbed — koffi FFI binding to libasymdoom.
 * Fail-fast if the shared library is missing (no toy fallback).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import koffi, { type LibraryHandle } from "koffi";
import type {
  AsymInput,
  Embed,
  EmbedConfig,
  MarineVitals,
  Role,
  SimEvent,
  WorldSnapshot,
} from "./embedTypes.js";
import { toTiccmdMoves, toTiccmdTurn } from "./intentScale.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..", "..");

function resolveLib(): string {
  const dir = path.join(ROOT, "native", "build");
  const candidates =
    process.platform === "darwin"
      ? ["libasymdoom.dylib"]
      : process.platform === "win32"
        ? ["asymdoom.dll", "libasymdoom.dll"]
        : ["libasymdoom.so"];
  for (const name of candidates) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return p;
  }
  throw new Error(
    `libasymdoom not found in ${dir}. Run: npm run build:native`,
  );
}

const EV_KIND: Record<number, string> = {
  1: "possess",
  2: "release",
  3: "hop",
  4: "hopfail",
  5: "spectate",
  6: "points",
  7: "mods",
  8: "pain",
  9: "marineKill",
  10: "roundReload",
  11: "mapLoaded",
  12: "secret",
  13: "sound",
};

const ROLE_MAP: Record<number, Role | null> = {
  0: null,
  1: "marine",
  2: "demon",
  3: "spectator",
};

let lib: LibraryHandle | null = null;
let structsBound = false;

function loadLib() {
  if (lib) return lib;
  const libPath = resolveLib();
  lib = koffi.load(libPath);

  if (!structsBound) {
    koffi.opaque("asym_embed");
    koffi.pointer("asym_embed_ptr", "asym_embed");
    koffi.struct("asym_config", {
      iwad_path: "str",
      skill: "int",
      episode: "int",
      map: "int",
      marine_death: "int",
      possess_mask: "int",
    });
    koffi.struct("asym_input", {
      forward: "int",
      strafe: "int",
      turn_delta: "int",
      run: "int",
      fire: "int",
      use: "int",
      look_fly: "int",
      arti: "int",
    });
    koffi.struct("asym_mods", {
      health: "int",
      speed: "int",
      damage: "int",
      rate: "int",
    });
    koffi.struct("asym_actor", {
      id: "uint32",
      kind: "int",
      type: "int",
      type_name: koffi.array("char", 32),
      x: "float",
      y: "float",
      z: "float",
      angle: "float",
      momx: "float",
      momy: "float",
      momz: "float",
      health: "int",
      max_health: "int",
      sprite: "int",
      frame: "int",
      flags: "int",
      controller: "int",
      controller_session_id: koffi.array("char", 64),
    });
    koffi.struct("asym_door", {
      id: "int",
      state: "int",
      position: "float",
      x: "float",
      y: "float",
      z: "float",
    });
    koffi.struct("asym_mover", {
      id: "int",
      kind: "int",
      state: "int",
      floor: "float",
      ceiling: "float",
      x: "float",
      y: "float",
      z: "float",
    });
    koffi.struct("asym_projectile", {
      id: "uint32",
      type: "int",
      x: "float",
      y: "float",
      z: "float",
      angle: "float",
      momx: "float",
      momy: "float",
      momz: "float",
      sprite: "int",
      frame: "int",
    });
    koffi.struct("asym_marine_vitals", {
      health: "int",
      armor: "int",
      ammo: "int",
      weapon: "int",
      ammo_counts: koffi.array("int", 4),
      max_ammo: koffi.array("int", 4),
      weapons: "int",
      cards: "int",
      damagecount: "int",
    });
    koffi.struct("asym_snapshot", {
      tick: "int",
      map_name: koffi.array("char", 16),
      actor_count: "int",
      actors: koffi.array("asym_actor", 512),
      door_count: "int",
      doors: koffi.array("asym_door", 128),
      mover_count: "int",
      movers: koffi.array("asym_mover", 128),
      projectile_count: "int",
      projectiles: koffi.array("asym_projectile", 256),
      marine: "asym_marine_vitals",
      map_ready: "int",
      pending_reload: "int",
    });
    koffi.struct("asym_event", {
      kind: "int",
      session_id: koffi.array("char", 64),
      body_id: "uint32",
      species: koffi.array("char", 32),
      reason: koffi.array("char", 32),
      points: "int",
      mods: "asym_mods",
      sound: koffi.array("char", 16),
      x: "float",
      y: "float",
      z: "float",
      has_origin: "int",
    });
    koffi.struct("asym_debug_sample", {
      id: "uint32",
      type: "int",
      health: "int",
      controller: "int",
      tics: "int",
    });
    koffi.struct("asym_debug_sim", {
      gametic: "int",
      leveltime: "int",
      gamestate: "int",
      paused: "int",
      menuactive: "int",
      created: "int",
      rules_live: "int",
      playeringame0: "int",
      player_health: "int",
      player_mo_health: "int",
      thinker_total: "int",
      thinker_mobj: "int",
      thinker_door: "int",
      thinker_pending_free: "int",
      living_countkill: "int",
      possessable: "int",
      controller_neg1: "int",
      controller_ge0: "int",
      controller_orphan: "int",
      sample_count: "int",
      samples: koffi.array("asym_debug_sample", 8),
    });
    structsBound = true;
  }

  const sizeofActor = lib.func("size_t asym_sizeof_actor()");
  const sizeofSnapshot = lib.func("size_t asym_sizeof_snapshot()");
  const sizeofEvent = lib.func("size_t asym_sizeof_event()");
  const cActor = Number(sizeofActor());
  const cSnap = Number(sizeofSnapshot());
  const cEvent = Number(sizeofEvent());
  const jsActor = koffi.sizeof("asym_actor");
  const jsSnap = koffi.sizeof("asym_snapshot");
  const jsEvent = koffi.sizeof("asym_event");
  if (cActor !== jsActor || cSnap !== jsSnap || cEvent !== jsEvent) {
    throw new Error(
      `libasymdoom ABI mismatch actor C=${cActor} JS=${jsActor} snapshot C=${cSnap} JS=${jsSnap} event C=${cEvent} JS=${jsEvent}`,
    );
  }
  return lib;
}

function cstr(buf: Buffer | string | number[] | null | undefined): string {
  if (buf == null) return "";
  if (typeof buf === "string") return buf;
  if (Buffer.isBuffer(buf)) {
    const z = buf.indexOf(0);
    return buf.toString("utf8", 0, z < 0 ? buf.length : z);
  }
  // koffi may return number[] for char arrays
  const arr = buf as number[];
  let end = arr.length;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] === 0) {
      end = i;
      break;
    }
  }
  return Buffer.from(arr.slice(0, end)).toString("utf8");
}

/** Coerce koffi Int32Array / array-like / plain object into a length-4 number[]. */
function int4(value: unknown, fallback: readonly number[]): number[] {
  const out = [fallback[0] ?? 0, fallback[1] ?? 0, fallback[2] ?? 0, fallback[3] ?? 0];
  if (value == null) return out;
  for (let i = 0; i < 4; i++) {
    const n = Number((value as Record<number, unknown>)[i]);
    if (Number.isFinite(n)) out[i] = n | 0;
  }
  return out;
}

export class NativeEmbed implements Embed {
  private handle: unknown;
  private api: Record<string, ReturnType<LibraryHandle["func"]>>;
  private cfg: EmbedConfig;
  private registered = new Set<string>();

  constructor(cfg: EmbedConfig = {}) {
    this.cfg = cfg;
    const L = loadLib();
    this.api = {
      create: L.func("asym_embed_ptr asym_create(asym_config *cfg)"),
      destroy: L.func("void asym_destroy(asym_embed_ptr e)"),
      tick: L.func("void asym_tick(asym_embed_ptr e)"),
      register: L.func("int asym_register_session(asym_embed_ptr e, str session_id)"),
      unregister: L.func("void asym_unregister_session(asym_embed_ptr e, str session_id)"),
      submit: L.func("void asym_submit_input(asym_embed_ptr e, str session_id, asym_input *in)"),
      possess: L.func("int asym_possess(asym_embed_ptr e, str session_id, uint32 body_id)"),
      release: L.func("void asym_release(asym_embed_ptr e, str session_id)"),
      snapshot: L.func("void asym_get_snapshot(asym_embed_ptr e, _Out_ asym_snapshot *out)"),
      events: L.func("int asym_events_pull(asym_embed_ptr e, void *out, int max_out)"),
      role: L.func("int asym_role(asym_embed_ptr e, str session_id)"),
      body: L.func("uint32 asym_body(asym_embed_ptr e, str session_id)"),
      points: L.func("int asym_points(asym_embed_ptr e, str session_id)"),
      mods: L.func("void asym_mods_get(asym_embed_ptr e, str session_id, _Out_ asym_mods *out)"),
      getTick: L.func("int asym_get_tick(asym_embed_ptr e)"),
      debugSim: L.func("void asym_debug_sim_get(asym_embed_ptr e, _Out_ asym_debug_sim *out)"),
    };

    const iwad =
      cfg.iwadPath ??
      path.join(ROOT, "assets", "doom1.wad");
    if (!fs.existsSync(iwad)) {
      throw new Error(`IWAD not found: ${iwad}`);
    }

    const conf = {
      iwad_path: iwad,
      skill: cfg.skill ?? 3,
      episode: cfg.episode ?? 1,
      map: cfg.map ?? 1,
      marine_death: cfg.marineDeath ?? 0,
      possess_mask: cfg.possessMask ?? 0xff,
    };
    this.handle = this.api.create(conf);
    if (!this.handle) throw new Error("asym_create failed");
    console.log(`[native] libasymdoom loaded, E${conf.episode}M${conf.map}`);
  }

  destroy(): void {
    if (this.handle) {
      this.api.destroy(this.handle);
      this.handle = null;
      this.registered.clear();
    }
  }

  tick(): void {
    this.api.tick(this.handle);
  }

  joinSession(sessionId: string): void {
    if (this.registered.has(sessionId)) return;
    const slot = this.api.register(this.handle, sessionId) as number;
    if (slot < 0) throw new Error(`register_session failed for ${sessionId}`);
    this.registered.add(sessionId);
  }

  leaveSession(sessionId: string): void {
    if (!this.registered.has(sessionId)) return;
    this.api.unregister(this.handle, sessionId);
    this.registered.delete(sessionId);
  }

  submitInput(sessionId: string, input: AsymInput): void {
    this.joinSession(sessionId);
    const moves = toTiccmdMoves(input.forward, input.strafe, input.run);
    this.api.submit(this.handle, sessionId, {
      forward: moves.forward,
      strafe: moves.strafe,
      turn_delta: toTiccmdTurn(input.turnDelta),
      run: input.run ? 1 : 0,
      fire: input.fire ? 1 : 0,
      use: input.use ? 1 : 0,
      look_fly: input.lookFly ?? 0,
      arti: input.arti ?? 0,
    });
  }

  possess(sessionId: string, bodyId: number | "auto"): boolean {
    this.joinSession(sessionId);
    const id = bodyId === "auto" ? 0 : bodyId;
    return (this.api.possess(this.handle, sessionId, id) as number) !== 0;
  }

  release(sessionId: string): void {
    this.api.release(this.handle, sessionId);
  }

  snapshot(): WorldSnapshot {
    const out: Record<string, unknown> = {};
    this.api.snapshot(this.handle, out);
    const actorsRaw = (out.actors as Record<string, unknown>[]) ?? [];
    const count = (out.actor_count as number) ?? 0;
    const actors = [];
    for (let i = 0; i < count; i++) {
      const a = actorsRaw[i];
      const sid = cstr(a.controller_session_id as never);
      actors.push({
        id: a.id as number,
        kind:
          (a.kind as number) === 0
            ? ("marine" as const)
            : (a.kind as number) === 2
              ? ("item" as const)
              : ("monster" as const),
        type: a.type as number,
        typeName: cstr(a.type_name as never) || undefined,
        x: a.x as number,
        y: a.y as number,
        z: a.z as number,
        angle: a.angle as number,
        momx: a.momx as number,
        momy: a.momy as number,
        momz: a.momz as number,
        health: a.health as number,
        maxHealth: a.max_health as number,
        sprite: a.sprite as number,
        frame: a.frame as number,
        flags: a.flags as number,
        controllerSessionId: sid || null,
      });
    }
    const doors = [];
    const dcount = (out.door_count as number) ?? 0;
    const doorsRaw = (out.doors as Record<string, unknown>[]) ?? [];
    for (let i = 0; i < dcount; i++) {
      const d = doorsRaw[i];
      doors.push({
        id: d.id as number,
        state: d.state as number,
        position: d.position as number,
        x: d.x as number,
        y: d.y as number,
        z: d.z as number,
      });
    }
    const movers = [];
    const mcount = (out.mover_count as number) ?? 0;
    const moversRaw = (out.movers as Record<string, unknown>[]) ?? [];
    for (let i = 0; i < mcount; i++) {
      const m = moversRaw[i];
      movers.push({
        id: m.id as number,
        kind: m.kind as number,
        state: m.state as number,
        floor: m.floor as number,
        ceiling: m.ceiling as number,
        x: m.x as number,
        y: m.y as number,
        z: m.z as number,
      });
    }
    const projectiles = [];
    const pcount = (out.projectile_count as number) ?? 0;
    const projRaw = (out.projectiles as Record<string, unknown>[]) ?? [];
    for (let i = 0; i < pcount; i++) {
      const p = projRaw[i];
      projectiles.push({
        id: p.id as number,
        type: p.type as number,
        x: p.x as number,
        y: p.y as number,
        z: p.z as number,
        angle: p.angle as number,
        momx: p.momx as number,
        momy: p.momy as number,
        momz: p.momz as number,
        sprite: p.sprite as number,
        frame: p.frame as number,
      });
    }
    const marine = out.marine as Record<string, number>;
    return {
      tick: out.tick as number,
      mapName: cstr(out.map_name as never),
      actors,
      doors,
      movers,
      projectiles,
      events: [],
      pendingReload: !!(out.pending_reload as number),
      marine: marine
        ? {
            health: marine.health,
            armor: marine.armor,
            ammo: marine.ammo,
            weapon: marine.weapon,
            ammoCounts: int4(marine.ammo_counts, [0, 0, 0, 0]),
            maxAmmo: int4(marine.max_ammo, [200, 50, 300, 50]),
            weapons: marine.weapons ?? 0,
            cards: marine.cards ?? 0,
            damagecount: marine.damagecount ?? 0,
          }
        : undefined,
    };
  }

  pullEvents(): SimEvent[] {
    const buf: Record<string, unknown>[] = new Array(128).fill(null).map(() => ({}));
    // koffi out-array: allocate typed buffer
    const EventType = koffi.type("asym_event");
    const arr = Buffer.alloc(koffi.sizeof(EventType) * 128);
    const n = this.api.events(this.handle, arr, 128) as number;
    const events: SimEvent[] = [];
    for (let i = 0; i < n; i++) {
      const ev = koffi.decode(arr, i * koffi.sizeof(EventType), "asym_event") as Record<
        string,
        unknown
      >;
      const kind = EV_KIND[ev.kind as number] ?? `ev${ev.kind}`;
      const mods = ev.mods as Record<string, number>;
      const row: SimEvent = {
        kind,
        sessionId: cstr(ev.session_id as never) || undefined,
        bodyId: (ev.body_id as number) || undefined,
        species: cstr(ev.species as never) || undefined,
        reason: cstr(ev.reason as never) || undefined,
        points: ev.points as number,
        mods: mods
          ? {
              health: mods.health,
              speed: mods.speed,
              damage: mods.damage,
              rate: mods.rate,
            }
          : undefined,
      };
      if (kind === "sound") {
        const sound = cstr(ev.sound as never);
        if (sound) row.sound = sound;
        if (ev.has_origin) {
          row.x = ev.x as number;
          row.y = ev.y as number;
          row.z = ev.z as number;
        }
      }
      events.push(row);
    }
    void buf;
    return events;
  }

  role(sessionId: string): Role | null {
    return ROLE_MAP[this.api.role(this.handle, sessionId) as number] ?? null;
  }

  body(sessionId: string): number | null {
    const b = this.api.body(this.handle, sessionId) as number;
    return b || null;
  }

  points(sessionId: string): number {
    return this.api.points(this.handle, sessionId) as number;
  }

  mods(sessionId: string): { health: number; speed: number; damage: number; rate: number } {
    const out: Record<string, number> = {};
    this.api.mods(this.handle, sessionId, out);
    return {
      health: out.health ?? 0,
      speed: out.speed ?? 0,
      damage: out.damage ?? 0,
      rate: out.rate ?? 0,
    };
  }

  marineVitals(sessionId: string): MarineVitals | null {
    if (this.role(sessionId) !== "marine") return null;
    const snap = this.snapshot();
    return snap.marine ?? null;
  }

  getTick(): number {
    return this.api.getTick(this.handle) as number;
  }

  debugSim(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    this.api.debugSim(this.handle, out);
    const sampleCount = (out.sample_count as number) ?? 0;
    const raw = (out.samples as Record<string, unknown>[]) ?? [];
    const samples = [];
    for (let i = 0; i < sampleCount; i++) {
      const s = raw[i];
      samples.push({
        id: s.id as number,
        type: s.type as number,
        health: s.health as number,
        controller: s.controller as number,
        tics: s.tics as number,
      });
    }
    return {
      gametic: out.gametic,
      leveltime: out.leveltime,
      gamestate: out.gamestate,
      paused: !!(out.paused as number),
      menuactive: !!(out.menuactive as number),
      created: !!(out.created as number),
      rulesLive: !!(out.rules_live as number),
      playeringame0: !!(out.playeringame0 as number),
      playerHealth: out.player_health,
      playerMoHealth: out.player_mo_health,
      thinkerTotal: out.thinker_total,
      thinkerMobj: out.thinker_mobj,
      thinkerDoor: out.thinker_door,
      thinkerPendingFree: out.thinker_pending_free,
      livingCountkill: out.living_countkill,
      possessable: out.possessable,
      controllerNeg1: out.controller_neg1,
      controllerGe0: out.controller_ge0,
      controllerOrphan: out.controller_orphan,
      samples,
    };
  }
}

export function createNativeEmbed(cfg: EmbedConfig = {}): NativeEmbed {
  return new NativeEmbed(cfg);
}

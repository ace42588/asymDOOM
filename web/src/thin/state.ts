/** Types matching contracts/schemas (PROTOCOL.md). */

export { PROTOCOL_VERSION } from "asymdoom-contracts";
import { PROTOCOL_VERSION } from "asymdoom-contracts";

export type Role = "marine" | "demon" | "spectator";

export type DoorState = "open" | "closed" | "opening" | "closing" | "waiting";

export interface Actor {
  id: number;
  kind: "marine" | "monster" | "item";
  type: number;
  typeName?: string;
  x: number;
  y: number;
  z: number;
  angle: number;
  momx?: number;
  momy?: number;
  momz?: number;
  health: number;
  maxHealth?: number;
  sprite?: number;
  frame?: number;
  flags?: number;
  controllerSessionId: string | null;
}

export interface Door {
  id: number;
  state: DoorState;
  position: number;
  x?: number;
  y?: number;
  z?: number;
}

export type MoverKind = "plat" | "floor" | "ceiling";
export type MoverState = "waiting" | "up" | "down";

export interface Mover {
  id: number;
  kind: MoverKind;
  state: MoverState;
  floor: number;
  ceiling: number;
  x?: number;
  y?: number;
  z?: number;
}

export interface Projectile {
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

export interface Mods {
  health: number;
  speed: number;
  damage: number;
  rate: number;
}

export interface MarineVitals {
  health: number;
  armor: number;
  ammo: number;
  weapon: number;
  /** clip, shell, cell, misl (doom am_* order — not STBAR label order) */
  ammoCounts?: number[];
  maxAmmo?: number[];
  /** bit i => weaponowned[i] */
  weapons?: number;
  /** bit i => cards[i] */
  cards?: number;
  damagecount?: number;
}

/** Possessed-monster vitals for the canvas demon status bar (from actor + points/mods). */
export interface DemonVitals {
  species: string;
  health: number;
  maxHealth: number;
  points: number;
  mods: Mods;
  sprite?: number;
}

export interface SimEvent {
  kind: string;
  sessionId?: string;
  bodyId?: number;
  species?: string;
  reason?: string;
  points?: number;
  mods?: Mods;
  sound?: string;
  x?: number;
  y?: number;
  z?: number;
}

export interface EntityDelta<T extends { id: number }> {
  spawn?: T[];
  update?: Array<Partial<T> & { id: number }>;
  despawn?: number[];
}

export interface EntityMap {
  actors: Map<number, Actor>;
  doors: Map<number, Door>;
  movers: Map<number, Mover>;
  projectiles: Map<number, Projectile>;
}

export function createEntityMap(): EntityMap {
  return { actors: new Map(), doors: new Map(), movers: new Map(), projectiles: new Map() };
}

function applyDelta<T extends { id: number }>(
  map: Map<number, T>,
  delta: EntityDelta<T> | undefined,
) {
  if (!delta) return;
  for (const a of delta.spawn ?? []) map.set(a.id, { ...a } as T);
  for (const a of delta.update ?? []) {
    const prev = map.get(a.id);
    map.set(a.id, (prev ? { ...prev, ...a } : { ...a }) as T);
  }
  for (const id of delta.despawn ?? []) map.delete(id);
}

export interface ClientState {
  sessionId: string | null;
  role: Role;
  controlledId: number | null;
  followTargetId: number | null;
  points: number;
  mods: Mods;
  marine: MarineVitals | null;
  mapName: string | null;
  mapLoading: boolean;
  tickRateHz: number;
  entities: EntityMap;
  tick: number;
  lastNotice: string | null;
  disconnected: boolean;
  byeReason: string | null;
}

export function createClientState(): ClientState {
  return {
    sessionId: null,
    role: "spectator",
    controlledId: null,
    followTargetId: null,
    points: 0,
    mods: { health: 0, speed: 0, damage: 0, rate: 0 },
    marine: null,
    mapName: null,
    mapLoading: false,
    tickRateHz: 35,
    entities: createEntityMap(),
    tick: 0,
    lastNotice: null,
    disconnected: false,
    byeReason: null,
  };
}

function applyEvents(state: ClientState, events: SimEvent[] | undefined) {
  if (!events?.length) return;
  for (const e of events) {
    if (e.kind === "points" && typeof e.points === "number") state.points = e.points;
    if (e.kind === "mods" && e.mods) state.mods = { ...e.mods };
  }
}

export function reduceServerMessage(state: ClientState, msg: Record<string, unknown>): ClientState {
  if (msg.protocolVersion != null && msg.protocolVersion !== PROTOCOL_VERSION) {
    return {
      ...state,
      lastNotice: `Unsupported protocolVersion ${String(msg.protocolVersion)}`,
    };
  }

  switch (msg.type) {
    case "welcome":
      return {
        ...state,
        sessionId: String(msg.sessionId),
        role: msg.role as Role,
        controlledId: (msg.controlledId as number | null) ?? null,
        followTargetId: (msg.followTargetId as number | null) ?? null,
        mapName: (msg.mapName as string) ?? null,
        tickRateHz: typeof msg.tickRateHz === "number" && msg.tickRateHz > 0 ? msg.tickRateHz : 35,
      };
    case "roleChange":
      return {
        ...state,
        role: msg.role as Role,
        controlledId: (msg.controlledId as number | null) ?? null,
        followTargetId: (msg.followTargetId as number | null) ?? null,
      };
    case "snapshot": {
      const next: ClientState = {
        ...state,
        entities: {
          actors: new Map(state.entities.actors),
          doors: new Map(state.entities.doors),
          movers: new Map(state.entities.movers),
          projectiles: new Map(state.entities.projectiles),
        },
        tick: Number(msg.tick),
        mapLoading: false,
      };
      if (msg.mapName) next.mapName = String(msg.mapName);
      if (msg.role) next.role = msg.role as Role;
      if ("controlledId" in msg) next.controlledId = (msg.controlledId as number | null) ?? null;
      if ("followTargetId" in msg) next.followTargetId = (msg.followTargetId as number | null) ?? null;
      if (typeof msg.points === "number") next.points = msg.points;
      if (msg.mods && typeof msg.mods === "object") next.mods = msg.mods as Mods;
      if (msg.marine && typeof msg.marine === "object") {
        next.marine = msg.marine as MarineVitals;
      } else if (next.role !== "marine") {
        next.marine = null;
      }
      applyDelta(next.entities.actors, msg.actors as EntityDelta<Actor>);
      applyDelta(next.entities.doors, msg.doors as EntityDelta<Door>);
      applyDelta(next.entities.movers, msg.movers as EntityDelta<Mover>);
      applyDelta(next.entities.projectiles, msg.projectiles as EntityDelta<Projectile>);
      applyEvents(next, msg.events as SimEvent[] | undefined);
      return next;
    }
    case "notice":
      return { ...state, lastNotice: String(msg.message ?? msg.code ?? "") };
    case "mapLoad":
      return {
        ...state,
        entities: createEntityMap(),
        mapLoading: true,
        mapName: (msg.mapName as string) ?? state.mapName,
        lastNotice: `Loading ${msg.mapName ?? "map"}…`,
      };
    case "bye":
      return {
        ...state,
        disconnected: true,
        byeReason: String(msg.reason ?? "bye"),
        lastNotice: String(msg.reason ?? "Disconnected"),
      };
    default:
      return state;
  }
}

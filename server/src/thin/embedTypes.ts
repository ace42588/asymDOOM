/** Embed interface — production uses libasymdoom via koffi. */

export type Role = "marine" | "demon" | "spectator";

export interface AsymInput {
  forward: number;
  strafe: number;
  turnDelta: number;
  run: boolean;
  fire: boolean;
  use: boolean;
  lookFly?: number;
  arti?: number;
}

export interface ActorView {
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

export interface DoorView {
  id: number;
  state: number;
  position: number;
  x?: number;
  y?: number;
  z?: number;
}

export interface MoverView {
  id: number;
  kind: number; // 0 plat, 1 floor, 2 ceiling
  state: number; // 0 waiting, 1 up, 2 down
  floor: number;
  ceiling: number;
  x?: number;
  y?: number;
  z?: number;
}

export interface ProjectileView {
  id: number;
  type: number;
  x: number;
  y: number;
  z: number;
  angle?: number;
  momx?: number;
  momy?: number;
  momz?: number;
  sprite?: number;
  frame?: number;
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

export interface SimEvent {
  kind: string;
  sessionId?: string;
  bodyId?: number;
  species?: string;
  reason?: string;
  points?: number;
  mods?: { health: number; speed: number; damage: number; rate: number };
  sound?: string;
  x?: number;
  y?: number;
  z?: number;
}

export interface WorldSnapshot {
  tick: number;
  mapName?: string;
  actors: ActorView[];
  doors?: DoorView[];
  movers?: MoverView[];
  projectiles?: ProjectileView[];
  events: SimEvent[];
  pendingReload: boolean;
  marine?: MarineVitals;
}

export interface Embed {
  destroy(): void;
  tick(): void;
  /** Register session and assign marine/demon (join). */
  joinSession(sessionId: string): void;
  /** Unregister session (leave). */
  leaveSession(sessionId: string): void;
  submitInput(sessionId: string, input: AsymInput): void;
  possess(sessionId: string, bodyId: number | "auto"): boolean;
  release(sessionId: string): void;
  snapshot(): WorldSnapshot;
  pullEvents(): SimEvent[];
  role(sessionId: string): Role | null;
  body(sessionId: string): number | null;
  points(sessionId: string): number;
  mods(sessionId: string): { health: number; speed: number; damage: number; rate: number };
  marineVitals?(sessionId: string): MarineVitals | null;
  getTick(): number;
  /** Read-only thinker / possess-pool dump (no tick side effects). */
  debugSim?(): Record<string, unknown>;
}

export interface EmbedConfig {
  iwadPath?: string;
  episode?: number;
  map?: number;
  skill?: number;
  marineDeath?: number;
  possessMask?: number;
  seed?: number;
}

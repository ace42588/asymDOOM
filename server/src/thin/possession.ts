import type { Embed, Role } from "./embedTypes.js";

export const IDLE_RELEASE_MS = 45_000;

export interface SessionState {
  sessionId: string;
  role: Role;
  controlledId: number | null;
  followTargetId: number | null;
  lastInputAt: number;
  mapReady: boolean;
  /** Per-entity-class baselines for spawn/update/despawn diffs. */
  actorBaseline: Map<number, string>;
  doorBaseline: Map<number, string>;
  moverBaseline: Map<number, string>;
  projectileBaseline: Map<number, string>;
  switchBaseline: Map<number, string>;
  /** Last sent marine vitals / points / mods — skip empty snapshots only when these match. */
  lastHudKey: string;
}

export function assignOnJoin(
  embed: Embed,
  sessionId: string,
  now: number,
): SessionState {
  embed.joinSession(sessionId);
  const role = embed.role(sessionId) ?? "spectator";
  const controlledId = embed.body(sessionId);
  return {
    sessionId,
    role,
    controlledId,
    followTargetId: role === "spectator" ? 1 : null,
    lastInputAt: now,
    mapReady: true,
    actorBaseline: new Map(),
    doorBaseline: new Map(),
    moverBaseline: new Map(),
    projectileBaseline: new Map(),
    switchBaseline: new Map(),
    lastHudKey: "",
  };
}

export function syncSessionFromEmbed(embed: Embed, session: SessionState): void {
  session.role = embed.role(session.sessionId) ?? "spectator";
  session.controlledId = embed.body(session.sessionId);
  if (session.role === "spectator") {
    session.followTargetId = session.followTargetId ?? 1;
  } else {
    session.followTargetId = null;
  }
}

export function maybeIdleRelease(
  embed: Embed,
  session: SessionState,
  now: number,
  idleMs = IDLE_RELEASE_MS,
): boolean {
  if (session.role !== "demon") return false;
  if (now - session.lastInputAt < idleMs) return false;
  embed.release(session.sessionId);
  syncSessionFromEmbed(embed, session);
  return true;
}

export function handleSpectatorPossess(
  embed: Embed,
  session: SessionState,
  targetId: number | null | undefined,
): boolean {
  if (session.role !== "spectator") return false;
  const ok = embed.possess(session.sessionId, targetId == null ? "auto" : targetId);
  syncSessionFromEmbed(embed, session);
  return ok;
}

export function handleBodySwap(
  embed: Embed,
  session: SessionState,
  targetId: number | null | undefined,
): void {
  // Hop is applied via arti=5 in input; optional explicit target uses possess cycle.
  if (targetId != null) {
    embed.possess(session.sessionId, targetId);
  }
  syncSessionFromEmbed(embed, session);
}

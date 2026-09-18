import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import type { Embed } from "./embedTypes.js";
import { diffActors, diffEntities, isEmptyDelta } from "./deltas.js";
import { parseClientMessage, PROTOCOL_VERSION } from "./protocol.js";
import {
  assignOnJoin,
  handleSpectatorPossess,
  maybeIdleRelease,
  syncSessionFromEmbed,
  type SessionState,
} from "./possession.js";
import { encodeDoor, encodeMover, encodeProjectile } from "./wire.js";

const TICK_HZ = 35;
const TICK_MS = 1000 / TICK_HZ;
/** How long a disconnected client can resume before the controller is freed. */
export const DEFAULT_RESUME_GRACE_MS = 30_000;

function parseExMx(name: string | undefined): { episode: number; map: number } | null {
  const m = /^E(\d+)M(\d+)$/i.exec(name ?? "");
  if (!m) return null;
  return { episode: Number(m[1]), map: Number(m[2]) };
}

export interface ThinSettings {
  skill: number;
  episode: number;
  map: number;
  onMarineDeath: "demons_win" | "respawn_as_killer" | "marine_respawn";
  demonView: "first_person" | "chase";
}

interface SessionRow {
  /** Null while parked (disconnect grace). */
  ws: WebSocket | null;
  state: SessionState;
  graceTimer: ReturnType<typeof setTimeout> | null;
}

export class ThinMatch {
  embed: Embed;
  readonly sessions = new Map<string, SessionRow>();
  private timer: NodeJS.Timeout | null = null;
  private settings: ThinSettings;
  private awaitingMapAck = false;
  private embedFactory: () => Embed;
  private resumeGraceMs: number;

  constructor(
    settings: ThinSettings,
    embed: Embed,
    embedFactory?: () => Embed,
    opts?: { resumeGraceMs?: number },
  ) {
    this.settings = settings;
    this.embed = embed;
    this.embedFactory = embedFactory ?? (() => {
      throw new Error("ThinMatch: embedFactory required to recreate after last leave");
    });
    this.resumeGraceMs = opts?.resumeGraceMs ?? DEFAULT_RESUME_GRACE_MS;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.step(), TICK_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const row of this.sessions.values()) {
      if (row.graceTimer) clearTimeout(row.graceTimer);
    }
    this.embed.destroy();
  }

  /** Recreate the native engine instance (used by /api/reset and last-leave). */
  recreate() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    try {
      this.embed.destroy();
    } catch {
      /* already destroyed */
    }
    this.embed = this.embedFactory();
  }

  /**
   * Join or resume. Pass `resumeId` from `/ws?sessionId=` to reattach a parked
   * (or steal a live) controller without reallocating the native slot.
   */
  join(ws: WebSocket, resumeId?: string | null): string {
    if (resumeId) {
      const existing = this.sessions.get(resumeId);
      if (existing) {
        if (existing.graceTimer) {
          clearTimeout(existing.graceTimer);
          existing.graceTimer = null;
        }
        const oldWs = existing.ws;
        if (oldWs && oldWs !== ws) {
          try {
            oldWs.close();
          } catch {
            /* ignore */
          }
        }
        existing.ws = ws;
        syncSessionFromEmbed(this.embed, existing.state);
        existing.state.lastInputAt = Date.now();
        this.sendWelcome(ws, resumeId, existing.state);
        clearBaselines(existing.state);
        this.pushSnapshot(resumeId, true);
        this.start();
        return resumeId;
      }
    }

    const sessionId = randomUUID();
    const state = assignOnJoin(this.embed, sessionId, Date.now());
    this.sessions.set(sessionId, { ws, state, graceTimer: null });
    this.sendWelcome(ws, sessionId, state);
    clearBaselines(state);
    this.pushSnapshot(sessionId, true);
    this.start();
    return sessionId;
  }

  /**
   * Park the session on WS close so a reload can resume. Ignores closes from
   * sockets that no longer own the row (steal / race).
   */
  disconnect(sessionId: string, ws: WebSocket) {
    const row = this.sessions.get(sessionId);
    if (!row) return;
    if (row.ws !== ws) return;
    row.ws = null;
    if (row.graceTimer) clearTimeout(row.graceTimer);
    row.graceTimer = setTimeout(() => {
      row.graceTimer = null;
      this.leave(sessionId);
    }, this.resumeGraceMs);
  }

  /** Hard leave: unregister native controller and maybe recreate the embed. */
  leave(sessionId: string) {
    const row = this.sessions.get(sessionId);
    if (!row) return;
    if (row.graceTimer) {
      clearTimeout(row.graceTimer);
      row.graceTimer = null;
    }
    this.embed.leaveSession(sessionId);
    this.sessions.delete(sessionId);
    if (this.sessions.size === 0) {
      this.recreate();
    }
  }

  onMessage(sessionId: string, raw: unknown) {
    const row = this.sessions.get(sessionId);
    if (!row || !row.ws) return;
    const msg = parseClientMessage(raw);
    if ("error" in msg) {
      this.send(row.ws, {
        type: "notice",
        protocolVersion: PROTOCOL_VERSION,
        code: "bad_message",
        message: msg.error,
      });
      return;
    }
    if (msg.type === "mapLoadComplete") {
      row.state.mapReady = true;
      this.awaitingMapAck = false;
      clearBaselines(row.state);
      return;
    }
    row.state.lastInputAt = Date.now();
    const { intent, bodySwap, spectatorPossess, spectatorFollow } = msg.input;
    if (spectatorPossess) {
      handleSpectatorPossess(this.embed, row.state, spectatorPossess.targetId ?? null);
      this.sendRole(sessionId);
    }
    if (spectatorFollow) {
      const actors = this.embed.snapshot().actors;
      const ids = actors.map((a) => a.id).sort((a, b) => a - b);
      if (ids.length > 0) {
        const cur = row.state.followTargetId ?? ids[0]!;
        const idx = Math.max(0, ids.indexOf(cur));
        const next =
          spectatorFollow === "next"
            ? ids[(idx + 1) % ids.length]!
            : ids[(idx - 1 + ids.length) % ids.length]!;
        row.state.followTargetId = next;
        this.sendRole(sessionId);
      }
    }
    let arti = intent.arti ?? 0;
    if (bodySwap) arti = 5;
    this.embed.submitInput(sessionId, {
      forward: intent.forward,
      strafe: intent.strafe,
      turnDelta: intent.turnDelta,
      run: intent.run,
      fire: intent.fire,
      use: intent.use,
      lookFly: intent.lookFly ?? 0,
      arti,
    });
  }

  private sendWelcome(ws: WebSocket, sessionId: string, state: SessionState) {
    this.send(ws, {
      type: "welcome",
      protocolVersion: PROTOCOL_VERSION,
      sessionId,
      role: state.role,
      controlledId: state.controlledId,
      followTargetId: state.followTargetId,
      mapName: `E${this.settings.episode}M${this.settings.map}`,
      tickRateHz: TICK_HZ,
      serverTime: Date.now(),
      settings: this.settings,
    });
  }

  private sendRole(sessionId: string) {
    const row = this.sessions.get(sessionId);
    if (!row || !row.ws) return;
    syncSessionFromEmbed(this.embed, row.state);
    this.send(row.ws, {
      type: "roleChange",
      protocolVersion: PROTOCOL_VERSION,
      role: row.state.role,
      controlledId: row.state.controlledId,
      followTargetId: row.state.followTargetId,
    });
  }

  private step() {
    const now = Date.now();
    for (const [id, row] of this.sessions) {
      if (!row.ws) continue; // parked — keep body/points through grace
      if (maybeIdleRelease(this.embed, row.state, now)) {
        this.send(row.ws, {
          type: "notice",
          protocolVersion: PROTOCOL_VERSION,
          code: "idle_release",
          message: "Released body due to idle",
        });
        this.sendRole(id);
      }
    }
    this.embed.tick();
    const events = this.embed.pullEvents();
    if (events.some((e) => e.kind === "roundReload" && e.reason === "countdown")) {
      for (const [, row] of this.sessions) {
        if (!row.ws) continue;
        this.send(row.ws, {
          type: "notice",
          protocolVersion: PROTOCOL_VERSION,
          code: "round_restart",
          message: "Round restart",
          secondsUntilAction: 2,
        });
      }
    }
    if (events.some((e) => e.kind === "mapLoaded" || (e.kind === "roundReload" && e.reason === "now"))) {
      this.awaitingMapAck = true;
      const snap = this.embed.snapshot();
      const parsed = parseExMx(snap.mapName);
      if (parsed) {
        this.settings.episode = parsed.episode;
        this.settings.map = parsed.map;
      }
      const mapName = snap.mapName ?? `E${this.settings.episode}M${this.settings.map}`;
      for (const [, row] of this.sessions) {
        row.state.mapReady = false;
        clearBaselines(row.state);
        if (!row.ws) continue;
        this.send(row.ws, {
          type: "mapLoad",
          protocolVersion: PROTOCOL_VERSION,
          mapName,
          episode: this.settings.episode,
          map: this.settings.map,
        });
        this.sendRole(row.state.sessionId);
      }
    }
    for (const [id] of this.sessions) {
      syncSessionFromEmbed(this.embed, this.sessions.get(id)!.state);
      this.pushSnapshot(id, false, events);
    }
  }

  private pushSnapshot(sessionId: string, forceFull: boolean, events: ReturnType<Embed["pullEvents"]> = []) {
    const row = this.sessions.get(sessionId);
    if (!row || !row.ws || (!row.state.mapReady && this.awaitingMapAck)) return;
    const snap = this.embed.snapshot();
    if (forceFull) clearBaselines(row.state);
    const actors = diffActors(snap.actors, row.state.actorBaseline);
    const doors = diffEntities(
      (snap.doors ?? []).map(encodeDoor),
      row.state.doorBaseline,
    );
    const movers = diffEntities(
      (snap.movers ?? []).map(encodeMover),
      row.state.moverBaseline,
    );
    const projectiles = diffEntities(
      (snap.projectiles ?? []).map(encodeProjectile),
      row.state.projectileBaseline,
    );
    const marine = this.embed.marineVitals?.(sessionId) ?? undefined;
    const points = this.embed.points(sessionId);
    const mods = this.embed.mods(sessionId);
    const hudKey = JSON.stringify({ marine: marine ?? null, points, mods, role: row.state.role });
    if (
      !forceFull &&
      isEmptyDelta(actors) &&
      isEmptyDelta(doors) &&
      isEmptyDelta(movers) &&
      isEmptyDelta(projectiles) &&
      events.length === 0 &&
      row.state.role === this.embed.role(sessionId) &&
      hudKey === row.state.lastHudKey
    ) {
      return;
    }
    row.state.lastHudKey = hudKey;
    this.send(row.ws, {
      type: "snapshot",
      protocolVersion: PROTOCOL_VERSION,
      tick: snap.tick,
      serverTime: Date.now(),
      mapName: snap.mapName ?? `E${this.settings.episode}M${this.settings.map}`,
      role: row.state.role,
      controlledId: row.state.controlledId,
      followTargetId: row.state.followTargetId,
      points,
      mods,
      marine,
      actors,
      projectiles,
      doors,
      movers,
      events: events.filter(
        (e) =>
          !e.sessionId ||
          e.sessionId === sessionId ||
          e.kind === "roundReload" ||
          e.kind === "marineKill" ||
          e.kind === "mapLoaded" ||
          e.kind === "secret" ||
          e.kind === "sound",
      ),
    });
  }

  private send(ws: WebSocket, obj: unknown) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
  }
}

function clearBaselines(state: SessionState) {
  state.actorBaseline.clear();
  state.doorBaseline.clear();
  state.moverBaseline.clear();
  state.projectileBaseline.clear();
  state.lastHudKey = "";
}

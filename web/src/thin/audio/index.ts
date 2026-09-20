import type { ClientState, SimEvent } from "../state";
import type { WadFile } from "../wad/wadFile";
import {
  getClientSettings,
  subscribeClientSettings,
} from "../clientSettings";
import { SfxBank } from "./bank";
import { dedupeCues, inferSfx, weaponFireSfx, type InferResult } from "./infer";
import { SfxMixer, type ListenerPose, type SfxCue } from "./mixer";
import { MusPlayer } from "./music";

/** Thin-client audio: IWAD bank + mixer + snapshot inference + optional music. */
export class ThinAudio {
  private bank: SfxBank | null = null;
  private mixer: SfxMixer | null = null;
  private music = new MusPlayer();
  private musicEnabled = getClientSettings().musicEnabled;
  private mapName: string | null = null;
  private prevMoverLoops = new Set<number>();

  constructor() {
    subscribeClientSettings((s) => {
      this.musicEnabled = s.musicEnabled;
      this.syncMusic();
    });
  }

  setWad(wad: WadFile) {
    this.bank = new SfxBank(wad);
    this.mixer = new SfxMixer(this.bank);
    this.music.setWad(wad);
    this.syncMusic();
  }

  async unlock() {
    await this.mixer?.unlock();
    if (this.musicEnabled) {
      await this.music.unlock();
      this.syncMusic();
    }
  }

  stopAll() {
    this.mixer?.stopAll();
    this.music.stop();
    this.prevMoverLoops.clear();
  }

  onMuzzleFlash(weapon: number) {
    const name = weaponFireSfx(weapon);
    if (!name || !this.mixer) return;
    // Unlock on the fire gesture; only suppress wire after a real local play
    // so a suspended AudioContext can't mute both prediction and the sim cue.
    void this.mixer.unlock();
    if (this.mixer.play({ name, local: true }, null)) {
      this.mixer.suppressLocal(name, 150);
    }
  }

  /**
   * Process a snapshot transition: infer cues, merge wire sound events, update loops.
   */
  ingest(prev: ClientState, next: ClientState, events: SimEvent[] | undefined) {
    if (next.mapName) this.mapName = next.mapName;
    this.syncMusic();
    if (!this.mixer) return;
    const result = inferSfx(prev, next, events ?? []);
    const wire = wireSoundCues(events ?? []);
    const extra = dedupeCues(result.cues, wire);
    const listener = cameraPose(next);
    for (const c of result.cues) this.mixer.play(c, listener);
    for (const c of extra) this.mixer.play(c, listener);
    this.syncMoverLoops(result, listener);
  }

  private syncMusic() {
    if (!this.musicEnabled) {
      this.music.stop();
      return;
    }
    this.music.playMap(this.mapName);
  }

  private syncMoverLoops(result: InferResult, listener: ListenerPose | null) {
    if (!this.mixer) return;
    const live = new Set<number>();
    for (const [id, origin] of result.moverLoops) {
      live.add(id);
      this.mixer.setLoop(`mover:${id}`, "stnmov", origin, listener, true);
    }
    for (const id of this.prevMoverLoops) {
      if (!live.has(id)) this.mixer.setLoop(`mover:${id}`, "stnmov", { x: 0, y: 0 }, listener, false);
    }
    this.prevMoverLoops = live;
  }
}

function cameraPose(state: ClientState): ListenerPose | null {
  const camId = state.controlledId ?? state.followTargetId;
  if (camId == null) return null;
  const cam = state.entities.actors.get(camId);
  if (!cam) return null;
  return { x: cam.x, y: cam.y, angle: cam.angle };
}

function wireSoundCues(events: SimEvent[]): SfxCue[] {
  const out: SfxCue[] = [];
  for (const e of events) {
    if (e.kind !== "sound" || !e.sound) continue;
    const cue: SfxCue = { name: e.sound };
    if (e.x != null && e.y != null) {
      cue.x = e.x;
      cue.y = e.y;
      if (e.z != null) cue.z = e.z;
    } else {
      cue.local = true;
    }
    out.push(cue);
  }
  return out;
}

import type { WadFile } from "../wad/wadFile";
import { musToMidi } from "./mus2mid";
import { musicLumpName } from "./musicMap";

interface TinySynth {
  setLoop(n: number): void;
  setMasterVol(v: number): void;
  setAudioContext(ctx: AudioContext, dest?: AudioNode): void;
  getAudioContext(): AudioContext;
  loadMIDI(data: ArrayBuffer): void;
  playMIDI(): void;
  stopMIDI(): void;
  getPlayStatus(): { play: number; curTick: number; maxTick: number };
}

type TinySynthCtor = new (opts?: { quality?: number; useReverb?: number; voices?: number }) => TinySynth;

/** Vanilla-ish music volume vs SFX master 0.7. */
const MUSIC_VOL = 0.4;

/**
 * Play looping map music from IWAD D_* MUS lumps (client-side; sim is -nomusic).
 */
export class MusPlayer {
  private wad: WadFile | null = null;
  private synth: TinySynth | null = null;
  private midiCache = new Map<string, ArrayBuffer | null>();
  private currentLump: string | null = null;
  private wantedMap: string | null = null;
  private load: Promise<TinySynthCtor | null> | null = null;

  setWad(wad: WadFile) {
    this.wad = wad;
    this.midiCache.clear();
    this.currentLump = null;
  }

  /** Resume / create synth after a user gesture. */
  async unlock(ctx?: AudioContext | null): Promise<void> {
    const synth = await this.ensureSynth(ctx ?? undefined);
    if (!synth) return;
    const ac = synth.getAudioContext();
    if (ac.state === "suspended") {
      try {
        await ac.resume();
      } catch {
        /* autoplay policy */
      }
    }
    this.tryStart();
  }

  stop() {
    if (this.wantedMap == null && this.currentLump == null) return;
    this.wantedMap = null;
    this.synth?.stopMIDI();
    this.currentLump = null;
  }

  /** Loop the track for `mapName`, or stop if null. No-op if already on that lump. */
  playMap(mapName: string | null) {
    this.wantedMap = mapName;
    if (!mapName) {
      this.synth?.stopMIDI();
      this.currentLump = null;
      return;
    }
    if (this.synth && musicLumpName(mapName) === this.currentLump) {
      const st = this.synth.getPlayStatus();
      if (st.play) return;
    }
    void this.ensureSynth().then(() => this.tryStart());
  }

  private tryStart() {
    const mapName = this.wantedMap;
    if (!mapName || !this.synth) return;
    const ac = this.synth.getAudioContext();
    if (ac.state !== "running") return;

    const lump = musicLumpName(mapName);
    if (lump === this.currentLump) {
      const st = this.synth.getPlayStatus();
      if (st.play) return;
    }

    const midi = this.midiFor(lump);
    if (!midi) return;
    this.synth.stopMIDI();
    this.synth.setLoop(1);
    this.synth.setMasterVol(MUSIC_VOL);
    this.synth.loadMIDI(midi);
    this.synth.playMIDI();
    this.currentLump = lump;
  }

  private midiFor(lump: string): ArrayBuffer | null {
    if (this.midiCache.has(lump)) return this.midiCache.get(lump) ?? null;
    if (!this.wad) return null;
    try {
      const mus = this.wad.lumpBytes(lump);
      const midi = musToMidi(mus);
      const buf = new ArrayBuffer(midi.byteLength);
      new Uint8Array(buf).set(midi);
      this.midiCache.set(lump, buf);
      return buf;
    } catch (err) {
      console.warn(`[thin] music lump ${lump}`, err);
      this.midiCache.set(lump, null);
      return null;
    }
  }

  private async ensureSynth(ctx?: AudioContext): Promise<TinySynth | null> {
    if (this.synth) {
      if (ctx && this.synth.getAudioContext() !== ctx) {
        this.synth.setAudioContext(ctx);
      }
      return this.synth;
    }
    if (typeof window === "undefined") return null;
    const Ctor = await this.loadCtor();
    if (!Ctor) return null;
    const synth = new Ctor({ quality: 1, useReverb: 0, voices: 48 });
    if (ctx) synth.setAudioContext(ctx);
    synth.setLoop(1);
    synth.setMasterVol(MUSIC_VOL);
    this.synth = synth;
    return synth;
  }

  private loadCtor(): Promise<TinySynthCtor | null> {
    if (this.load) return this.load;
    this.load = import("webaudio-tinysynth")
      .then((mod) => {
        const raw = (mod as { default?: TinySynthCtor }).default ?? (mod as unknown as TinySynthCtor);
        return typeof raw === "function" ? raw : null;
      })
      .catch((err) => {
        console.warn("[thin] webaudio-tinysynth failed to load", err);
        return null;
      });
    return this.load;
  }
}

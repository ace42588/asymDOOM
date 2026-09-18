import type { SfxBank } from "./bank";

export interface SfxCue {
  name: string;
  x?: number;
  y?: number;
  z?: number;
  /** Full volume / center pan (NULL origin on wire). */
  local?: boolean;
}

export interface ListenerPose {
  x: number;
  y: number;
  angle: number; // degrees
}

const CLOSE_DIST = 200;
const CLIPPING_DIST = 1200;
const ATTENUATOR = CLIPPING_DIST - CLOSE_DIST;
const CHANNELS = 8;

type Channel = {
  source: AudioBufferSourceNode | null;
  gain: GainNode;
  pan: StereoPannerNode;
  name: string | null;
  loopKey: string | null;
};

/**
 * 8-channel Web Audio mixer with vanilla-ish distance attenuation + stereo pan.
 */
export class SfxMixer {
  private bank: SfxBank;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private channels: Channel[] = [];
  private unlocked = false;
  private bufferCache = new Map<string, AudioBuffer>();
  /** Local weapon SFX names to ignore from wire/infer for a few ms. */
  private suppressUntil = new Map<string, number>();
  /** Local cues waiting for AudioContext to leave suspended. */
  private pendingLocal: string[] = [];

  constructor(bank: SfxBank) {
    this.bank = bank;
  }

  /** Resume AudioContext after a user gesture. Safe to call repeatedly. */
  async unlock(): Promise<void> {
    const ctx = this.ensureCtx();
    if (ctx.state === "suspended") {
      try {
        await ctx.resume();
      } catch {
        /* autoplay policy — retry on next gesture */
      }
    }
    this.unlocked = ctx.state === "running";
    if (this.unlocked) this.flushPendingLocal();
  }

  stopAll() {
    for (const ch of this.channels) {
      this.stopChannel(ch);
    }
    this.suppressUntil.clear();
    this.pendingLocal = [];
  }

  /** Ignore matching cues briefly (local muzzle-flash prediction). */
  suppressLocal(name: string, ms = 120) {
    this.suppressUntil.set(name.toLowerCase(), performance.now() + ms);
  }

  /**
   * Play a cue. Returns true if a channel actually started (so callers can
   * suppress the wire duplicate only after a real local play).
   */
  play(cue: SfxCue, listener: ListenerPose | null): boolean {
    const name = cue.name.toLowerCase();
    const until = this.suppressUntil.get(name);
    if (until != null && performance.now() < until) return false;

    const ctx = this.ensureCtx();
    if (ctx.state === "suspended") {
      // Keep local prediction so the first fire after a gesture isn't lost.
      if (cue.local) {
        if (!this.pendingLocal.includes(name)) this.pendingLocal.push(name);
        void this.unlock();
      }
      return false;
    }
    this.unlocked = true;

    const buf = this.audioBuffer(name);
    if (!buf) return false;

    let vol = 1;
    let pan = 0;
    if (!cue.local && cue.x != null && cue.y != null && listener) {
      const adj = adjustParams(listener, cue.x, cue.y);
      if (!adj) return false;
      vol = adj.vol;
      pan = adj.pan;
    }

    const ch = this.allocChannel(name, null);
    if (!ch) return false;
    this.startOn(ch, buf, vol, pan, false, null);
    return true;
  }

  private flushPendingLocal() {
    const q = this.pendingLocal;
    this.pendingLocal = [];
    for (const name of q) {
      if (this.play({ name, local: true }, null)) {
        this.suppressLocal(name, 150);
      }
    }
  }

  /**
   * Keep a looping SFX at an origin while `active` (e.g. stnmov for movers).
   * `loopKey` identifies the source (e.g. `mover:3`).
   */
  setLoop(loopKey: string, name: string, origin: { x: number; y: number }, listener: ListenerPose | null, active: boolean) {
    const existing = this.channels.find((c) => c.loopKey === loopKey);
    if (!active) {
      if (existing) this.stopChannel(existing);
      return;
    }
    const adj = listener ? adjustParams(listener, origin.x, origin.y) : { vol: 1, pan: 0 };
    if (!adj) {
      if (existing) this.stopChannel(existing);
      return;
    }
    if (existing?.source) {
      existing.gain.gain.value = adj.vol;
      existing.pan.pan.value = adj.pan;
      return;
    }
    const buf = this.audioBuffer(name.toLowerCase());
    if (!buf) return;
    const ch = this.allocChannel(name, loopKey);
    if (!ch) return;
    this.startOn(ch, buf, adj.vol, adj.pan, true, loopKey);
  }

  private ensureCtx(): AudioContext {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.7;
      this.master.connect(this.ctx.destination);
      for (let i = 0; i < CHANNELS; i++) {
        const gain = this.ctx.createGain();
        const pan = this.ctx.createStereoPanner();
        gain.connect(pan);
        pan.connect(this.master);
        this.channels.push({ source: null, gain, pan, name: null, loopKey: null });
      }
    }
    return this.ctx;
  }

  private audioBuffer(name: string): AudioBuffer | null {
    const hit = this.bufferCache.get(name);
    if (hit) return hit;
    const decoded = this.bank.get(name);
    if (!decoded || !this.ctx) return null;
    const buf = this.ctx.createBuffer(1, decoded.pcm.length, decoded.sampleRate);
    const channel = buf.getChannelData(0);
    channel.set(decoded.pcm);
    this.bufferCache.set(name, buf);
    return buf;
  }

  private allocChannel(name: string, loopKey: string | null): Channel | null {
    // Prefer free channel
    let free = this.channels.find((c) => !c.source);
    if (free) return free;
    // Kick non-looping
    free = this.channels.find((c) => c.source && !c.loopKey);
    if (free) {
      this.stopChannel(free);
      return free;
    }
    // Last resort: kick any
    const any = this.channels[0];
    if (!any) return null;
    this.stopChannel(any);
    return any;
  }

  private startOn(
    ch: Channel,
    buf: AudioBuffer,
    vol: number,
    pan: number,
    loop: boolean,
    loopKey: string | null,
  ) {
    if (!this.ctx) return;
    this.stopChannel(ch);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = loop;
    src.connect(ch.gain);
    ch.gain.gain.value = vol;
    ch.pan.pan.value = pan;
    ch.source = src;
    ch.name = buf.length ? "sfx" : null;
    ch.loopKey = loopKey;
    src.onended = () => {
      if (ch.source === src) {
        ch.source = null;
        ch.loopKey = null;
        ch.name = null;
      }
    };
    try {
      src.start();
    } catch {
      ch.source = null;
    }
  }

  private stopChannel(ch: Channel) {
    if (ch.source) {
      try {
        ch.source.onended = null;
        ch.source.stop();
      } catch {
        /* already stopped */
      }
      try {
        ch.source.disconnect();
      } catch {
        /* */
      }
      ch.source = null;
    }
    ch.loopKey = null;
    ch.name = null;
  }
}

/** Vanilla approx distance + stereo separation → gain [0,1] and pan [-1,1]. */
export function adjustParams(
  listener: ListenerPose,
  sx: number,
  sy: number,
): { vol: number; pan: number } | null {
  const adx = Math.abs(listener.x - sx);
  const ady = Math.abs(listener.y - sy);
  const approx = adx + ady - Math.min(adx, ady) / 2;
  if (approx > CLIPPING_DIST) return null;

  let vol: number;
  if (approx < CLOSE_DIST) {
    vol = 1;
  } else {
    vol = (CLIPPING_DIST - approx) / ATTENUATOR;
  }
  if (vol <= 0) return null;

  // Angle from listener to source, relative to facing (Doom y is north).
  const ang = Math.atan2(sy - listener.y, sx - listener.x);
  const facing = (listener.angle * Math.PI) / 180;
  let rel = ang - facing;
  while (rel > Math.PI) rel -= Math.PI * 2;
  while (rel < -Math.PI) rel += Math.PI * 2;
  // Vanilla sep = 128 - sin(rel)*96; map to StereoPanner [-1,1]
  const pan = Math.max(-1, Math.min(1, -Math.sin(rel) * (96 / 128)));
  return { vol, pan };
}

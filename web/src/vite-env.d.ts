/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ASYM_API?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "webaudio-tinysynth" {
  export default class WebAudioTinySynth {
    constructor(opts?: { quality?: number; useReverb?: number; voices?: number });
    setLoop(n: number): void;
    setMasterVol(v: number): void;
    setAudioContext(ctx: AudioContext, dest?: AudioNode): void;
    getAudioContext(): AudioContext;
    loadMIDI(data: ArrayBuffer): void;
    playMIDI(): void;
    stopMIDI(): void;
    getPlayStatus(): { play: number; curTick: number; maxTick: number };
  }
}

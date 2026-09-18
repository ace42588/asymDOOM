/** Vanilla DMX sound lump decoder (Doom IWAD DS* format). */

export interface DecodedSfx {
  sampleRate: number;
  /** Mono PCM in [-1, 1]. */
  pcm: Float32Array;
}

/**
 * Decode a DMX sound lump.
 * Layout: uint16 format(=3), uint16 rate, uint32 length, then unsigned 8-bit PCM.
 * Chocolate Doom skips the first 16 and last 16 bytes of the lump body (padding).
 */
export function decodeDmx(bytes: Uint8Array): DecodedSfx {
  if (bytes.length < 8) throw new Error("DMX lump too short");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const format = view.getUint16(0, true);
  if (format !== 3) throw new Error(`Unsupported DMX format ${format}`);
  const sampleRate = view.getUint16(2, true);
  const length = view.getUint32(4, true);
  if (length > bytes.length - 8 || length <= 48) {
    throw new Error(`Invalid DMX length ${length} (lump ${bytes.length})`);
  }
  // Skip header (8) + first 8 of sample region via offset 16, then +8 more → start 24;
  // usable length = length - 32 (matches Chocolate Doom CacheSFX).
  const start = 24;
  const usable = length - 32;
  if (start + usable > bytes.length) {
    throw new Error("DMX sample range exceeds lump");
  }
  const pcm = new Float32Array(usable);
  for (let i = 0; i < usable; i++) {
    pcm[i] = (bytes[start + i]! - 128) / 128;
  }
  return { sampleRate, pcm };
}

/** Map SFX logical name (e.g. "pistol") → IWAD lump "DSPISTOL". */
export function sfxLumpName(sound: string): string {
  const base = sound.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  return `DS${base}`;
}

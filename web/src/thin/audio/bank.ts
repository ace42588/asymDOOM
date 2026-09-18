import type { WadFile } from "../wad/wadFile";
import { decodeDmx, sfxLumpName, type DecodedSfx } from "./dmx";

/** Cached decoded IWAD sound effects. */
export class SfxBank {
  private wad: WadFile;
  private cache = new Map<string, DecodedSfx | null>();

  constructor(wad: WadFile) {
    this.wad = wad;
  }

  /** Resolve by logical name ("pistol", "doropn"). Missing lumps return null. */
  get(sound: string): DecodedSfx | null {
    const key = sound.toLowerCase();
    if (this.cache.has(key)) return this.cache.get(key)!;
    const lump = sfxLumpName(key);
    try {
      const bytes = this.wad.lumpBytes(lump);
      const decoded = decodeDmx(bytes);
      this.cache.set(key, decoded);
      return decoded;
    } catch {
      this.cache.set(key, null);
      return null;
    }
  }
}

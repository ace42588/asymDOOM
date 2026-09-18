/** Minimal IWAD/PWAD lump reader. */

export interface Lump {
  name: string;
  offset: number;
  size: number;
}

export class WadFile {
  readonly data: DataView;
  readonly bytes: Uint8Array;
  readonly lumps: Lump[];
  private byName: Map<string, Lump>;

  private constructor(buf: ArrayBuffer) {
    this.bytes = new Uint8Array(buf);
    this.data = new DataView(buf);
    const ident = String.fromCharCode(this.bytes[0]!, this.bytes[1]!, this.bytes[2]!, this.bytes[3]!);
    if (ident !== "IWAD" && ident !== "PWAD") {
      throw new Error(`Not a WAD file (got ${ident})`);
    }
    const num = this.data.getInt32(4, true);
    const info = this.data.getInt32(8, true);
    this.lumps = [];
    this.byName = new Map();
    for (let i = 0; i < num; i++) {
      const o = info + i * 16;
      const offset = this.data.getInt32(o, true);
      const size = this.data.getInt32(o + 4, true);
      let name = "";
      for (let c = 0; c < 8; c++) {
        const ch = this.bytes[o + 8 + c]!;
        if (ch === 0) break;
        name += String.fromCharCode(ch);
      }
      const lump: Lump = { name, offset, size };
      this.lumps.push(lump);
      // First occurrence wins for global lumps; map lumps are found by marker.
      if (!this.byName.has(name)) this.byName.set(name, lump);
    }
  }

  static fromArrayBuffer(buf: ArrayBuffer): WadFile {
    return new WadFile(buf);
  }

  static async fetch(url: string): Promise<WadFile> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
    return WadFile.fromArrayBuffer(await res.arrayBuffer());
  }

  lump(name: string): Lump | undefined {
    return this.byName.get(name);
  }

  /** Bytes for a named lump (first match). */
  lumpBytes(name: string): Uint8Array {
    const L = this.lump(name);
    if (!L) throw new Error(`Missing lump ${name}`);
    return this.bytes.subarray(L.offset, L.offset + L.size);
  }

  /** Find map marker (E1M1 / MAP01) and return following lumps by name. */
  mapLumps(mapName: string): Map<string, Lump> {
    const start = this.lumps.findIndex((l) => l.name === mapName);
    if (start < 0) throw new Error(`Map ${mapName} not found`);
    const out = new Map<string, Lump>();
    const wanted = new Set([
      "THINGS",
      "LINEDEFS",
      "SIDEDEFS",
      "VERTEXES",
      "SEGS",
      "SSECTORS",
      "NODES",
      "SECTORS",
      "REJECT",
      "BLOCKMAP",
    ]);
    for (let i = start + 1; i < this.lumps.length; i++) {
      const L = this.lumps[i]!;
      if (wanted.has(L.name)) out.set(L.name, L);
      else if (L.size === 0 && /^E\dM\d$|^MAP\d\d$/.test(L.name)) break;
      else if (!wanted.has(L.name) && L.size === 0) break;
    }
    return out;
  }

  readI16(offset: number): number {
    return this.data.getInt16(offset, true);
  }

  readU16(offset: number): number {
    return this.data.getUint16(offset, true);
  }

  readI32(offset: number): number {
    return this.data.getInt32(offset, true);
  }

  readName8(offset: number): string {
    let s = "";
    for (let i = 0; i < 8; i++) {
      const ch = this.bytes[offset + i]!;
      if (ch === 0) break;
      s += String.fromCharCode(ch);
    }
    return s;
  }
}

import type { WadFile } from "./wadFile";

/** sprnames[] order from native/engine/info.c — index matches actor.sprite. */
export const SPRNAMES: string[] = [
  "TROO", "SHTG", "PUNG", "PISG", "PISF", "SHTF", "SHT2", "CHGG", "CHGF", "MISG",
  "MISF", "SAWG", "PLSG", "PLSF", "BFGG", "BFGF", "BLUD", "PUFF", "BAL1", "BAL2",
  "PLSS", "PLSE", "MISL", "BFS1", "BFE1", "BFE2", "TFOG", "IFOG", "PLAY", "POSS",
  "SPOS", "VILE", "FIRE", "FATB", "FBXP", "SKEL", "MANF", "FATT", "CPOS", "SARG",
  "HEAD", "BAL7", "BOSS", "BOS2", "SKUL", "SPID", "BSPI", "APLS", "APBX", "CYBR",
  "PAIN", "SSWV", "KEEN", "BBRN", "BOSF", "ARM1", "ARM2", "BAR1", "BEXP", "FCAN",
  "BON1", "BON2", "BKEY", "RKEY", "YKEY", "BSKU", "RSKU", "YSKU", "STIM", "MEDI",
  "SOUL", "PINV", "PSTR", "PINS", "MEGA", "SUIT", "PMAP", "PVIS", "CLIP", "AMMO",
  "ROCK", "BROK", "CELL", "CELP", "SHEL", "SBOX", "BPAK", "BFUG", "MGUN", "CSAW",
  "LAUN", "PLAS", "SHOT", "SGN2", "COLU", "SMT2", "GOR1", "POL2", "POL5", "POL4",
  "POL3", "POL1", "POL6", "GOR2", "GOR3", "GOR4", "GOR5", "SMIT", "COL1", "COL2",
  "COL3", "COL4", "CAND", "CBRA", "COL6", "TRE1", "TRE2", "ELEC", "CEYE", "FSKU",
  "COL5", "TBLU", "TGRN", "TRED", "SMBT", "SMGT", "SMRT", "HDB1", "HDB2", "HDB3",
  "HDB4", "HDB5", "HDB6", "POB1", "POB2", "BRS1", "TLMP", "TLP2",
];

/** Fallback when sprite index is missing — typeName / kind → 4-char name. */
const TYPE_TO_SPRITE: Record<string, string> = {
  marine: "PLAY",
  imp: "TROO",
  demon: "SARG",
  spectre: "SARG",
  zombieman: "POSS",
  shotgunner: "SPOS",
  cacodemon: "HEAD",
  lostsoul: "SKUL",
  baron: "BOSS",
  cyberdemon: "CYBR",
  spiderdemon: "SPID",
  revenant: "SKEL",
  mancubus: "FATT",
  arachnotron: "BSPI",
  pain: "PAIN",
  archvile: "VILE",
  chaingunner: "CPOS",
  ss: "SSWV",
  // Pickups (shareware + common)
  armor: "ARM1",
  megaarmor: "ARM2",
  healthbonus: "BON1",
  armorbonus: "BON2",
  bluecard: "BKEY",
  yellowcard: "YKEY",
  redcard: "RKEY",
  blueskull: "BSKU",
  yellowskull: "YSKU",
  redskull: "RSKU",
  stimpack: "STIM",
  medikit: "MEDI",
  soulsphere: "SOUL",
  invulnerability: "PINV",
  berserk: "PSTR",
  invisibility: "PINS",
  radsuit: "SUIT",
  automap: "PMAP",
  visor: "PVIS",
  megasphere: "MEGA",
  clip: "CLIP",
  clipbox: "AMMO",
  rocket: "ROCK",
  rocketbox: "BROK",
  cell: "CELL",
  cellpack: "CELP",
  shell: "SHEL",
  shellbox: "SBOX",
  backpack: "BPAK",
  bfg: "BFUG",
  chaingun: "MGUN",
  chainsaw: "CSAW",
  rocketlauncher: "LAUN",
  plasmarifle: "PLAS",
  shotgun: "SHOT",
  supershotgun: "SGN2",
  barrel: "BAR1",
};

export interface SpritePic {
  width: number;
  height: number;
  leftOffset: number;
  topOffset: number;
  /** Draw mirrored (from dual-name lumps like TROOA2A8). */
  flip: boolean;
  /** RGBA image for drawImage. */
  image: CanvasImageSource;
  /** Source pixels (tests / non-DOM). */
  rgba: Uint8ClampedArray;
}

type RotEntry = { pic: SpritePic } | null;

/** frame letter A-Z → 8 rotations (1-8) plus optional rot0. */
type FrameTable = { rot0: SpritePic | null; rots: RotEntry[] };

/**
 * IWAD sprite patches (S_START…S_END) keyed for billboard lookup.
 */
export class SpriteStore {
  private byName = new Map<string, FrameTable[]>(); // sprite → frames[0=A…]
  private palette: Uint8Array;
  private wad: WadFile;
  private lumpCache = new Map<string, SpritePic | null>();
  readonly count: number;

  constructor(wad: WadFile) {
    this.wad = wad;
    this.palette = wad.lumpBytes("PLAYPAL").subarray(0, 768);
    this.count = this.loadSprites(wad);
  }

  /** UI / weapon overlay patch by lump name (STBAR, PISGA0, STTNUM0, …). */
  forLump(name: string): SpritePic | null {
    const key = name.toUpperCase();
    if (this.lumpCache.has(key)) return this.lumpCache.get(key)!;
    const lump = this.wad.lump(key);
    if (!lump || lump.size < 8) {
      this.lumpCache.set(key, null);
      return null;
    }
    const patch = parsePatch(this.wad.bytes.subarray(lump.offset, lump.offset + lump.size));
    const pic = this.patchToPic(patch, false);
    this.lumpCache.set(key, pic);
    return pic;
  }

  /**
   * Resolve a billboard for an actor.
   * `viewAng` / `thingAng` in radians (atan2 / doom CCW).
   */
  forActor(
    actor: {
      sprite?: number;
      frame?: number;
      kind?: string;
      typeName?: string;
      angle: number;
    },
    camX: number,
    camY: number,
    thingX: number,
    thingY: number,
  ): SpritePic | null {
    const name = this.spriteNameFor(actor);
    if (!name) return null;
    const frameIdx = (actor.frame ?? 0) & 0x7fff;
    const viewAng = Math.atan2(thingY - camY, thingX - camX);
    const thingAng = ((actor.angle % 360) * Math.PI) / 180;
    return this.lookup(name, frameIdx, viewAng, thingAng);
  }

  /** Projectile / FX by 4-char name + frame (e.g. BAL1, frame 0). */
  forName(name: string, frameIdx = 0, rot = 0): SpritePic | null {
    return this.lookup(name.toUpperCase(), frameIdx, 0, 0, rot);
  }

  spriteNameFor(actor: {
    sprite?: number;
    kind?: string;
    typeName?: string;
  }): string | null {
    if (actor.sprite != null && actor.sprite >= 0 && actor.sprite < SPRNAMES.length) {
      return SPRNAMES[actor.sprite]!;
    }
    if (actor.typeName && TYPE_TO_SPRITE[actor.typeName.toLowerCase()]) {
      return TYPE_TO_SPRITE[actor.typeName.toLowerCase()]!;
    }
    if (actor.kind === "marine") return "PLAY";
    return null;
  }

  private lookup(
    name: string,
    frameIdx: number,
    viewAng: number,
    thingAng: number,
    forceRot?: number,
  ): SpritePic | null {
    const frames = this.byName.get(name);
    if (!frames || frames.length === 0) return null;
    const ft = frames[Math.min(frameIdx, frames.length - 1)] ?? frames[0];
    if (!ft) return null;

    if (ft.rot0) return ft.rot0;

    let rot: number;
    if (forceRot != null) {
      rot = ((forceRot % 8) + 8) % 8;
    } else {
      // Vanilla: rot from (view→thing angle − thing.angle). When the mob faces
      // the camera, that delta is ~180° and must map to lump rotation 1 (front).
      // Without the +π bias we were landing on rotation 5 (back).
      let diff = viewAng - thingAng;
      while (diff < 0) diff += Math.PI * 2;
      while (diff >= Math.PI * 2) diff -= Math.PI * 2;
      rot = Math.floor((diff + Math.PI + Math.PI / 8) / (Math.PI / 4)) & 7;
    }

    const entry = ft.rots[rot];
    if (entry) return entry.pic;
    // Prefer front (rot 0 → lump 1), then any
    for (const r of ft.rots) {
      if (r) return r.pic;
    }
    return null;
  }

  private loadSprites(wad: WadFile): number {
    let inSprites = false;
    let n = 0;
    for (const lump of wad.lumps) {
      const nm = lump.name.toUpperCase();
      if (nm === "S_START" || nm === "SS_START") {
        inSprites = true;
        continue;
      }
      if (nm === "S_END" || nm === "SS_END") {
        inSprites = false;
        continue;
      }
      if (!inSprites || lump.size < 8) continue;
      if (nm.length < 6) continue;

      const base = nm.slice(0, 4);
      const rest = nm.slice(4);
      const patch = parsePatch(wad.bytes.subarray(lump.offset, lump.offset + lump.size));
      const pic = this.patchToPic(patch, false);

      // NAME + frame + rot  OR  NAME + f1 + r1 + f2 + r2
      if (rest.length === 2) {
        this.install(base, rest[0]!, rest[1]!, pic, false);
        n++;
      } else if (rest.length === 4) {
        this.install(base, rest[0]!, rest[1]!, pic, false);
        this.install(base, rest[2]!, rest[3]!, pic, true);
        n++;
      }
    }
    return n;
  }

  private install(sprite: string, frameCh: string, rotCh: string, pic: SpritePic, flip: boolean) {
    const frameIdx = frameCh.toUpperCase().charCodeAt(0) - 65;
    if (frameIdx < 0 || frameIdx > 25) return;
    const rotDigit = rotCh.charCodeAt(0) - 48; // '0'..'8'
    if (rotDigit < 0 || rotDigit > 8) return;

    let frames = this.byName.get(sprite);
    if (!frames) {
      frames = [];
      this.byName.set(sprite, frames);
    }
    while (frames.length <= frameIdx) {
      frames.push({ rot0: null, rots: Array.from({ length: 8 }, () => null) });
    }
    const ft = frames[frameIdx]!;
    const entry: SpritePic = flip ? { ...pic, flip: true } : pic;

    if (rotDigit === 0) {
      ft.rot0 = entry;
    } else {
      ft.rots[rotDigit - 1] = { pic: entry };
    }
  }

  private patchToPic(
    patch: ReturnType<typeof parsePatch>,
    flip: boolean,
  ): SpritePic {
    const { width, height } = patch;
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let x = 0; x < width; x++) {
      for (const post of patch.columns[x]!) {
        for (let i = 0; i < post.pixels.length; i++) {
          const y = post.y + i;
          if (y < 0 || y >= height) continue;
          const palIdx = post.pixels[i]!;
          const dst = (y * width + x) * 4;
          rgba[dst] = this.palette[palIdx * 3]!;
          rgba[dst + 1] = this.palette[palIdx * 3 + 1]!;
          rgba[dst + 2] = this.palette[palIdx * 3 + 2]!;
          rgba[dst + 3] = 255;
        }
      }
    }

    let image: CanvasImageSource = { width, height, data: rgba } as unknown as CanvasImageSource;
    if (typeof document !== "undefined") {
      const c = document.createElement("canvas");
      c.width = width;
      c.height = height;
      c.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
      image = c;
    }

    return {
      width,
      height,
      leftOffset: patch.leftOffset,
      topOffset: patch.topOffset,
      flip,
      image,
      rgba,
    };
  }
}

interface Patch {
  width: number;
  height: number;
  leftOffset: number;
  topOffset: number;
  columns: { y: number; pixels: Uint8Array }[][];
}

function parsePatch(data: Uint8Array): Patch {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const width = dv.getInt16(0, true);
  const height = dv.getInt16(2, true);
  const leftOffset = dv.getInt16(4, true);
  const topOffset = dv.getInt16(6, true);
  const columns: Patch["columns"] = [];
  for (let x = 0; x < width; x++) {
    let off = dv.getInt32(8 + x * 4, true);
    const posts: { y: number; pixels: Uint8Array }[] = [];
    while (off < data.length) {
      const topdelta = data[off]!;
      if (topdelta === 0xff) break;
      const length = data[off + 1]!;
      const pixels = data.subarray(off + 3, off + 3 + length);
      posts.push({ y: topdelta, pixels: pixels.slice() });
      off += 4 + length;
    }
    columns.push(posts);
  }
  return { width, height, leftOffset, topOffset, columns };
}

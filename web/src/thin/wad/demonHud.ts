import type { SpritePic, SpriteStore } from "./sprites";

/** Vanilla mugshot size (STFST00). */
export const FACE_W = 24;
export const FACE_H = 29;
const FACE_LEFT = -5;
const FACE_TOP = -2;

const FACE_WELL = [27, 27, 27, 255] as const;
const MOD_MAX = 4;
/** STBAR panel labels live on this row (HEALTH, AMMO, …). */
const LABEL_Y = 23;
const LABEL_H = 6; // gradient body + drop shadow

type Glyph = { w: number; h: number; rgba: Uint8ClampedArray };

let barCache: SpritePic | null = null;
const faceCache = new Map<string, SpritePic | null>();

/** current / spawnhealth × 100 — health mods can push this above 100. */
export function healthPercent(health: number, baseHp: number): number {
  const base = Math.max(1, baseHp | 0);
  return Math.max(0, Math.round((Math.max(0, health) / base) * 100));
}

export function modMax(): number {
  return MOD_MAX;
}

/**
 * STBAR with marine-only chrome replaced:
 * AMMO → PTS, FRAGS/ARMS blanked, ARMOR blanked,
 * BULL/SHEL/RCKT/CELL → HLTH/SPEED/DAMG/RATE in the HEALTH label font.
 */
export function demonStatusBar(sprites: SpriteStore): SpritePic | null {
  if (barCache) return barCache;
  const src = sprites.forLump("STBAR");
  if (!src) return null;
  const font = stbarFont(src, sprites.forLump("STARMS"));
  const rgba = new Uint8ClampedArray(src.rgba);

  smear(rgba, src.width, 6, 46, 22, 32, 8); // AMMO
  smear(rgba, src.width, 104, 144, 22, 32, 8); // FRAGS / ARMS
  smear(rgba, src.width, 174, 226, 22, 32, 8); // ARMOR
  tile(rgba, src.width, 236, 274, 1, 31, 276, 6, 8, 12);

  stampWord(rgba, src.width, font, "PTS", 16, LABEL_Y);
  stampWord(rgba, src.width, font, "HLTH", 236, 4);
  stampWord(rgba, src.width, font, "SPEED", 236, 10);
  stampWord(rgba, src.width, font, "DAMG", 236, 16);
  stampWord(rgba, src.width, font, "RATE", 236, 22);

  barCache = pic(src.width, src.height, rgba, src.leftOffset, src.topOffset);
  return barCache;
}

/** Static 24×29 mugshot cropped from the possessed sprite's front view. */
export function demonFace(sprites: SpriteStore, species: string, sprite?: number): SpritePic | null {
  const name = sprites.spriteNameFor({ typeName: species, sprite, kind: "monster" }) ?? "TROO";
  const cached = faceCache.get(name);
  if (cached !== undefined) return cached;

  const src =
    sprites.forName(name, 0, 0) ??
    sprites.forName(name, 0) ??
    sprites.forName("TROO", 0, 0) ??
    sprites.forName("POSS", 0, 0);
  if (!src) {
    faceCache.set(name, null);
    return null;
  }
  const template = sprites.forLump("STFST00");
  const left = template?.leftOffset ?? FACE_LEFT;
  const top = template?.topOffset ?? FACE_TOP;
  const shot = mugshot(src, FACE_W, FACE_H, left, top);
  faceCache.set(name, shot);
  return shot;
}

/**
 * Cut HEALTH-style glyphs out of STBAR (same gradient + 1px drop shadow).
 * Sources: AMMO (M, O), HEALTH (H, E, A, L, T), FRAG (F, R, G), STARMS "ARMS" (S).
 */
function stbarFont(bar: SpritePic, arms: SpritePic | null): Record<string, Glyph> {
  const cut = (x: number, w: number) => cutGlyph(bar, x, LABEL_Y, w, LABEL_H);
  const font: Record<string, Glyph> = {
    A: cut(70, 6),
    E: cut(63, 6),
    F: cut(110, 6),
    G: cut(131, 7),
    H: cut(55, 7),
    L: cut(77, 5),
    M: cut(15, 7),
    O: cut(31, 7),
    R: cut(117, 6),
    T: cut(81, 6),
  };
  // Shareware STBAR has no S ("FRAG"); take it from the STARMS arms panel.
  if (arms) font.S = cutGlyph(arms, 28, 23, 6, LABEL_H);
  // Vanilla R's lower-left stem pixel is dim (99) — restore the row-1 gradient.
  fixInk(font.R, 0, 1, 147);
  // L's cut window clips the neighbouring T's top-left pixel.
  clearInk(font.L, 4, 0);
  font.P = makeP(font.R);
  font.D = makeD(font.O, font.H);
  return font;
}

function cutGlyph(bar: SpritePic, x: number, y: number, w: number, h: number): Glyph {
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const si = ((y + row) * bar.width + (x + col)) * 4;
      const di = (row * w + col) * 4;
      rgba[di] = bar.rgba[si]!;
      rgba[di + 1] = bar.rgba[si + 1]!;
      rgba[di + 2] = bar.rgba[si + 2]!;
      rgba[di + 3] = 255;
    }
  }
  return { w, h, rgba };
}

function cloneGlyph(g: Glyph): Glyph {
  return { w: g.w, h: g.h, rgba: new Uint8ClampedArray(g.rgba) };
}

function setPx(g: Glyph, col: number, row: number, src: Glyph, sc: number, sr: number) {
  if (col < 0 || row < 0 || col >= g.w || row >= g.h) return;
  const di = (row * g.w + col) * 4;
  const si = (sr * src.w + sc) * 4;
  g.rgba[di] = src.rgba[si]!;
  g.rgba[di + 1] = src.rgba[si + 1]!;
  g.rgba[di + 2] = src.rgba[si + 2]!;
  g.rgba[di + 3] = 255;
}

function clearInk(g: Glyph, col: number, row: number) {
  if (col < 0 || row < 0 || col >= g.w || row >= g.h) return;
  const i = (row * g.w + col) * 4;
  g.rgba[i] = 79;
  g.rgba[i + 1] = 79;
  g.rgba[i + 2] = 79;
  g.rgba[i + 3] = 255;
}

/** Force a glyph pixel to a gradient gray so isInk picks it up. */
function fixInk(g: Glyph, col: number, row: number, gray: number) {
  if (col < 0 || row < 0 || col >= g.w || row >= g.h) return;
  const i = (row * g.w + col) * 4;
  g.rgba[i] = gray;
  g.rgba[i + 1] = gray;
  g.rgba[i + 2] = gray;
  g.rgba[i + 3] = 255;
}

/** P is R without the lower-right leg. */
function makeP(r: Glyph): Glyph {
  const p = cloneGlyph(r);
  for (let row = 3; row < p.h; row++) {
    for (let col = 2; col < p.w; col++) clearInk(p, col, row);
  }
  return p;
}

/** D is O with a square left stem copied from H. */
function makeD(o: Glyph, h: Glyph): Glyph {
  const d = cloneGlyph(o);
  for (let row = 0; row < d.h; row++) {
    setPx(d, 0, row, h, 0, row);
    if (h.w > 1) setPx(d, 1, row, h, 1, row);
  }
  return d;
}

function isInk(r: number, g: number, b: number): boolean {
  const L = (r + g + b) / 3;
  // Gradient body is 131–183; drop shadow 19–35. Metal background is 47–119,
  // so anything between must stay transparent or letter gaps fill in.
  return L >= 125 || L <= 40;
}

function stampWord(
  dest: Uint8ClampedArray,
  dw: number,
  font: Record<string, Glyph>,
  word: string,
  x: number,
  y: number,
) {
  let cx = x;
  for (const ch of word) {
    const g = font[ch];
    if (!g) {
      cx += 7;
      continue;
    }
    for (let row = 0; row < g.h; row++) {
      for (let col = 0; col < g.w; col++) {
        const i = (row * g.w + col) * 4;
        const r = g.rgba[i]!;
        const gv = g.rgba[i + 1]!;
        const b = g.rgba[i + 2]!;
        if (!isInk(r, gv, b)) continue;
        const dx = cx + col;
        const dy = y + row;
        const di = (dy * dw + dx) * 4;
        dest[di] = r;
        dest[di + 1] = gv;
        dest[di + 2] = b;
        dest[di + 3] = 255;
      }
    }
    cx += g.w + 1;
  }
}

function smear(
  rgba: Uint8ClampedArray,
  w: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  srcY: number,
) {
  for (let x = x0; x < x1; x++) {
    const src = (srcY * w + x) * 4;
    for (let y = y0; y < y1; y++) {
      const dst = (y * w + x) * 4;
      rgba[dst] = rgba[src]!;
      rgba[dst + 1] = rgba[src + 1]!;
      rgba[dst + 2] = rgba[src + 2]!;
      rgba[dst + 3] = 255;
    }
  }
}

function tile(
  rgba: Uint8ClampedArray,
  w: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  sx: number,
  sy: number,
  tw: number,
  th: number,
) {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const src = ((sy + ((y - y0) % th)) * w + (sx + ((x - x0) % tw))) * 4;
      const dst = (y * w + x) * 4;
      rgba[dst] = rgba[src]!;
      rgba[dst + 1] = rgba[src + 1]!;
      rgba[dst + 2] = rgba[src + 2]!;
      rgba[dst + 3] = 255;
    }
  }
}

function mugshot(src: SpritePic, dw: number, dh: number, left: number, top: number): SpritePic {
  const box = opaqueBox(src) ?? { x: 0, y: 0, w: src.width, h: src.height };
  const headH = Math.max(8, Math.floor(box.h * 0.5));
  const head = { x: box.x, y: box.y, w: box.w, h: headH };
  let cx = head.x + head.w / 2;
  let cy = head.y + head.h / 2;
  let n = 0;
  let sxSum = 0;
  let sySum = 0;
  for (let y = head.y; y < head.y + head.h; y++) {
    for (let x = head.x; x < head.x + head.w; x++) {
      if (src.rgba[(y * src.width + x) * 4 + 3]! < 128) continue;
      sxSum += x;
      sySum += y;
      n++;
    }
  }
  if (n > 0) {
    cx = sxSum / n;
    cy = sySum / n;
  }
  const aspect = dw / dh;
  let ch = head.h;
  let cw = Math.max(1, Math.round(ch * aspect));
  if (cw > box.w) {
    cw = box.w;
    ch = Math.max(1, Math.round(cw / aspect));
  }
  let sx = Math.round(cx - cw / 2);
  let sy = Math.round(cy - ch / 2);
  sx = Math.max(0, Math.min(src.width - cw, sx));
  sy = Math.max(0, Math.min(src.height - ch, sy));
  const rgba = new Uint8ClampedArray(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const dst = (y * dw + x) * 4;
      const u = sx + Math.min(cw - 1, Math.floor((x * cw) / dw));
      const v = sy + Math.min(ch - 1, Math.floor((y * ch) / dh));
      const srcI = (v * src.width + u) * 4;
      if (src.rgba[srcI + 3]! < 128) {
        rgba[dst] = FACE_WELL[0];
        rgba[dst + 1] = FACE_WELL[1];
        rgba[dst + 2] = FACE_WELL[2];
        rgba[dst + 3] = 255;
        continue;
      }
      rgba[dst] = src.rgba[srcI]!;
      rgba[dst + 1] = src.rgba[srcI + 1]!;
      rgba[dst + 2] = src.rgba[srcI + 2]!;
      rgba[dst + 3] = 255;
    }
  }
  return pic(dw, dh, rgba, left, top);
}

function opaqueBox(src: SpritePic): { x: number; y: number; w: number; h: number } | null {
  let x0 = src.width;
  let y0 = src.height;
  let x1 = 0;
  let y1 = 0;
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      if (src.rgba[(y * src.width + x) * 4 + 3]! < 128) continue;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < x0 || y1 < y0) return null;
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

function pic(
  width: number,
  height: number,
  rgba: Uint8ClampedArray,
  leftOffset: number,
  topOffset: number,
): SpritePic {
  let image: CanvasImageSource = { width, height, data: rgba } as unknown as CanvasImageSource;
  if (typeof document !== "undefined") {
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    c.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
    image = c;
  }
  return { width, height, leftOffset, topOffset, flip: false, image, rgba };
}

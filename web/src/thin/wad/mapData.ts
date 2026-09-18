import type { WadFile, Lump } from "./wadFile";

export interface Vertex {
  x: number;
  y: number;
}

export interface Sector {
  floorHeight: number;
  ceilingHeight: number;
  floorFlat: string;
  ceilingFlat: string;
  light: number;
}

export interface Sidedef {
  xOffset: number;
  yOffset: number;
  upper: string;
  lower: string;
  mid: string;
  sector: number;
}

export interface Linedef {
  v1: number;
  v2: number;
  flags: number;
  special: number;
  tag: number;
  side0: number; // -1 none
  side1: number;
}

export interface Seg {
  v1: number;
  v2: number;
  linedef: number;
  side: number; // 0 or 1
}

export interface Subsector {
  segCount: number;
  firstSeg: number;
}

export interface Node {
  x: number;
  y: number;
  dx: number;
  dy: number;
  child0: number;
  child1: number;
}

/** Map geometry for minimap + camera eye-height (world draw is WASM). */
export interface DoomMap {
  name: string;
  vertices: Vertex[];
  linedefs: Linedef[];
  sidedefs: Sidedef[];
  sectors: Sector[];
  /** Original sector heights from WAD. */
  baseCeiling: number[];
  baseFloor: number[];
  segs: Seg[];
  subsectors: Subsector[];
  nodes: Node[];
}

const EYE_HEIGHT = 41;

function lumpView(wad: WadFile, lump: Lump): DataView {
  return new DataView(wad.bytes.buffer, wad.bytes.byteOffset + lump.offset, lump.size);
}

export function loadMap(wad: WadFile, mapName: string): DoomMap {
  const lumps = wad.mapLumps(mapName);
  const need = ["VERTEXES", "LINEDEFS", "SIDEDEFS", "SECTORS", "SEGS", "SSECTORS", "NODES"];
  for (const n of need) {
    if (!lumps.has(n)) throw new Error(`${mapName} missing ${n}`);
  }

  const vxL = lumps.get("VERTEXES")!;
  const vertices: Vertex[] = [];
  for (let o = 0; o < vxL.size; o += 4) {
    vertices.push({
      x: wad.readI16(vxL.offset + o),
      y: wad.readI16(vxL.offset + o + 2),
    });
  }

  const ldL = lumps.get("LINEDEFS")!;
  const linedefs: Linedef[] = [];
  for (let o = 0; o < ldL.size; o += 14) {
    const base = ldL.offset + o;
    linedefs.push({
      v1: wad.readU16(base),
      v2: wad.readU16(base + 2),
      flags: wad.readU16(base + 4),
      special: wad.readU16(base + 6),
      tag: wad.readU16(base + 8),
      side0: wad.readU16(base + 10),
      side1: wad.readU16(base + 12),
    });
    const L = linedefs[linedefs.length - 1]!;
    if (L.side0 === 0xffff) L.side0 = -1;
    if (L.side1 === 0xffff) L.side1 = -1;
  }

  const sdL = lumps.get("SIDEDEFS")!;
  const sidedefs: Sidedef[] = [];
  for (let o = 0; o < sdL.size; o += 30) {
    const base = sdL.offset + o;
    sidedefs.push({
      xOffset: wad.readI16(base),
      yOffset: wad.readI16(base + 2),
      upper: wad.readName8(base + 4),
      lower: wad.readName8(base + 12),
      mid: wad.readName8(base + 20),
      sector: wad.readU16(base + 28),
    });
  }

  const secL = lumps.get("SECTORS")!;
  const sectors: Sector[] = [];
  for (let o = 0; o < secL.size; o += 26) {
    const base = secL.offset + o;
    sectors.push({
      floorHeight: wad.readI16(base),
      ceilingHeight: wad.readI16(base + 2),
      floorFlat: wad.readName8(base + 4),
      ceilingFlat: wad.readName8(base + 12),
      light: wad.readU16(base + 20),
    });
  }

  const segL = lumps.get("SEGS")!;
  const segs: Seg[] = [];
  for (let o = 0; o < segL.size; o += 12) {
    const base = segL.offset + o;
    segs.push({
      v1: wad.readU16(base),
      v2: wad.readU16(base + 2),
      linedef: wad.readU16(base + 6),
      side: wad.readU16(base + 8) & 1,
    });
  }

  const ssL = lumps.get("SSECTORS")!;
  const subsectors: Subsector[] = [];
  for (let o = 0; o < ssL.size; o += 4) {
    const base = ssL.offset + o;
    subsectors.push({
      segCount: wad.readU16(base),
      firstSeg: wad.readU16(base + 2),
    });
  }

  const ndL = lumps.get("NODES")!;
  const nodes: Node[] = [];
  const dv = lumpView(wad, ndL);
  for (let o = 0; o < ndL.size; o += 28) {
    nodes.push({
      x: dv.getInt16(o, true),
      y: dv.getInt16(o + 2, true),
      dx: dv.getInt16(o + 4, true),
      dy: dv.getInt16(o + 6, true),
      child0: dv.getUint16(o + 24, true),
      child1: dv.getUint16(o + 26, true),
    });
  }

  return {
    name: mapName,
    vertices,
    linedefs,
    sidedefs,
    sectors,
    baseCeiling: sectors.map((s) => s.ceilingHeight),
    baseFloor: sectors.map((s) => s.floorHeight),
    segs,
    subsectors,
    nodes,
  };
}

/** BSP point-in-subsector → sector index. */
export function pointSector(map: DoomMap, x: number, y: number): number {
  if (map.nodes.length === 0) return 0;
  let nodeNum = map.nodes.length - 1;
  for (;;) {
    if (nodeNum & 0x8000) {
      const ss = map.subsectors[nodeNum & 0x7fff]!;
      const seg = map.segs[ss.firstSeg]!;
      const line = map.linedefs[seg.linedef]!;
      const side = seg.side === 0 ? line.side0 : line.side1;
      return side >= 0 ? map.sidedefs[side]!.sector : 0;
    }
    const n = map.nodes[nodeNum]!;
    const side = (x - n.x) * n.dy - (y - n.y) * n.dx >= 0 ? 0 : 1;
    nodeNum = side === 0 ? n.child0 : n.child1;
  }
}

/** Eye Z for WASM camera; clamp into sector slab. */
export function eyeHeightFor(actorZ: number, sec: Sector): number {
  const floor = sec.floorHeight;
  const ceil = sec.ceilingHeight;
  const feet = actorZ >= floor - 1 && actorZ <= floor + 24 ? actorZ : floor;
  let eye = feet + EYE_HEIGHT;
  const lo = floor + 1;
  const hi = Math.max(lo + 1, ceil - 1);
  if (eye < lo) eye = lo;
  if (eye > hi) eye = hi;
  return eye;
}

export function strokeMapLines(
  ctx: CanvasRenderingContext2D,
  map: DoomMap,
  cam: { x: number; y: number },
  ox: number,
  oy: number,
  size: number,
  scale: number,
) {
  ctx.strokeStyle = "rgba(180,180,200,0.7)";
  ctx.lineWidth = 1;
  for (const line of map.linedefs) {
    if (line.side0 < 0) continue;
    const a = map.vertices[line.v1]!;
    const b = map.vertices[line.v2]!;
    const ax = ox + size / 2 + (a.x - cam.x) * scale;
    const ay = oy + size / 2 - (a.y - cam.y) * scale;
    const bx = ox + size / 2 + (b.x - cam.x) * scale;
    const by = oy + size / 2 - (b.y - cam.y) * scale;
    if (
      (ax < ox - 20 && bx < ox - 20) ||
      (ay < oy - 20 && by < oy - 20) ||
      (ax > ox + size + 20 && bx > ox + size + 20) ||
      (ay > oy + size + 20 && by > oy + size + 20)
    ) {
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  }
}

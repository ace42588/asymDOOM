import type { SpriteStore, SpritePic } from "./sprites";
import type { DemonVitals, MarineVitals } from "../state";
import { demonFace, demonStatusBar, healthPercent, modMax } from "./demonHud";
import { hudDestRect, type HudPlacement } from "../clientSettings";

const WEAPON_SPRITE = ["PUNG", "PISG", "SHTG", "CHGG", "MISG", "PLSG", "BFGG", "SAWG", "SHT2"];
const WEAPON_FLASH = [null, "PISF", "SHTF", "CHGF", "MISF", "PLSF", "BFGF", null, null] as const;

/** Vanilla STBAR is 320×32 in a 320×200 framebuffer. */
const BASE_W = 320;
const BASE_H = 200;
const BAR_H = 32;
const VIEW_H = BASE_H - BAR_H; // 168
const TIC_MS = 1000 / 35;
const WEAPONTOP = 32;
const WEAPONBOTTOM = 128;
const LOWERSPEED = 6;

/** Dest rect for STBAR (overlay bottom or strip below the world blit). */
export type HudBarDest = { x: number; y: number; w: number; h: number };

export type HudDrawOpts = {
  placement?: HudPlacement;
  hudScale?: number;
};

// Absolute screen coords from st_stuff.c (320×200).
const ST = {
  ammoX: 44,
  ammoY: 171,
  healthX: 90,
  healthY: 171,
  armorX: 221,
  armorY: 171,
  armsBgX: 104,
  armsBgY: 168,
  armsX: 111,
  armsY: 172,
  armsXSpace: 12,
  armsYSpace: 10,
  facesX: 143,
  facesY: 168,
  key0X: 239,
  key0Y: 171,
  key1Y: 181,
  key2Y: 191,
  ammo0X: 288,
  ammo0Y: 173,
  ammo1Y: 179,
  ammo2Y: 191,
  ammo3Y: 185,
  maxAmmo0X: 314,
  maxAmmo0Y: 173,
  maxAmmo1Y: 179,
  maxAmmo2Y: 191,
  maxAmmo3Y: 185,
} as const;

type FireStep = { frame: number; tics: number; flash?: number; refire?: boolean };

/** Fire sequences mirrored from info.c (including A_ReFire). */
const FIRE_SEQ: FireStep[][] = [
  // fist
  [
    { frame: 1, tics: 4 },
    { frame: 2, tics: 4 },
    { frame: 3, tics: 5 },
    { frame: 2, tics: 4 },
    { frame: 1, tics: 5, refire: true },
  ],
  // pistol
  [
    { frame: 0, tics: 4 },
    { frame: 1, tics: 6, flash: 0 },
    { frame: 2, tics: 4 },
    { frame: 1, tics: 5, refire: true },
  ],
  // shotgun
  [
    { frame: 0, tics: 3 },
    { frame: 0, tics: 7, flash: 0 },
    { frame: 1, tics: 5 },
    { frame: 2, tics: 5 },
    { frame: 3, tics: 4 },
    { frame: 2, tics: 5 },
    { frame: 1, tics: 5 },
    { frame: 0, tics: 3 },
    { frame: 0, tics: 7, refire: true },
  ],
  // chaingun
  [
    { frame: 0, tics: 4, flash: 0 },
    { frame: 1, tics: 4, flash: 1 },
    { frame: 1, tics: 0, refire: true },
  ],
  // missile
  [
    { frame: 1, tics: 8, flash: 0 },
    { frame: 1, tics: 12 },
    { frame: 1, tics: 0, refire: true },
  ],
  // plasma
  [
    { frame: 0, tics: 3, flash: 0 },
    { frame: 1, tics: 20, refire: true },
  ],
  // bfg
  [
    { frame: 0, tics: 20 },
    { frame: 1, tics: 10, flash: 0 },
    { frame: 1, tics: 10 },
    { frame: 1, tics: 20, refire: true },
  ],
  // chainsaw
  [
    { frame: 0, tics: 4 },
    { frame: 1, tics: 4 },
    { frame: 1, tics: 0, refire: true },
  ],
  // SSG
  [
    { frame: 0, tics: 3 },
    { frame: 0, tics: 7, flash: 0 },
    { frame: 1, tics: 7 },
    { frame: 2, tics: 7 },
    { frame: 3, tics: 7 },
    { frame: 4, tics: 7 },
    { frame: 5, tics: 7 },
    { frame: 6, tics: 6 },
    { frame: 7, tics: 6 },
    { frame: 0, tics: 5, refire: true },
  ],
];

/** Muzzle-flash durations (info.c) for the flash sprite layer. */
const FLASH_TICS = [0, 7, 4, 5, 15, 4, 8, 0, 5];

const FACE_STRIDE = 8; // 3 straight + 2 turn + ouch + evil + kill
const STRAIGHT_FACE_COUNT = 17; // TICRATE/2
const TURN_COUNT = 35;
const OUCH_THRESH = 20;
const RAMPAGE_DELAY = 70;

export class HudGfx {
  private fireWeapon = 1;
  private fireStep = -1;
  private stepTicsLeft = 0;
  private fireCarryMs = 0;
  private flashFrame = -1;
  private flashTicsLeft = 0;
  /** True when this attack's step 0 has a muzzle flash (SFX tied to flash frames). */
  private muzzleSfxOnFlash = false;

  private faceIndex = 0;
  private faceCount = STRAIGHT_FACE_COUNT;
  private lastHealth = 100;
  private oldWeapons = 3; // fist|pistol
  private attackDownTics = -1;
  private faceCarryMs = 0;
  private priority = 0;
  private weaponSy = WEAPONTOP;
  private lowering = false;

  /** Client-side pain pulse for demons (no marine.damagecount on the wire). */
  private demonLastHealth = -1;
  private demonPain = 0;
  private demonPainCarryMs = 0;

  /** Optional: fire SFX on muzzle-flash frame (local prediction). */
  onMuzzleFlash: ((weapon: number) => void) | null = null;

  constructor(private sprites: SpriteStore) {}

  barHeight(viewW: number, hudScale = 1): number {
    const scale = Number.isFinite(hudScale) ? Math.min(1.5, Math.max(0.5, hudScale)) : 1;
    return Math.max(1, Math.round(((BAR_H * viewW) / BASE_W) * scale));
  }

  /** Resolve dest rect for the status bar given world size + prefs. */
  barDest(worldW: number, worldH: number, opts?: HudDrawOpts): HudBarDest {
    const placement = opts?.placement ?? "overlay";
    const hudScale = opts?.hudScale ?? 1;
    const r = hudDestRect(worldW, worldH, placement, hudScale);
    return { x: r.x, y: r.y, w: r.w, h: r.h };
  }

  /** Red flash strength 0..~0.55 for possessed-demon damage. */
  demonPainAlpha(): number {
    if (this.demonPain <= 0) return 0;
    return Math.min(0.55, this.demonPain / 100);
  }

  /** Advance weapon + face timers; call once per rendered frame. */
  tick(dtMs: number, firing: boolean, weapon: number, vitals: MarineVitals | null) {
    const capped = Math.min(100, Math.max(0, dtMs));
    const dead = (vitals?.health ?? 1) <= 0;
    if (dead) {
      this.lowering = true;
      this.fireStep = -1;
      this.flashFrame = -1;
      this.flashTicsLeft = 0;
    } else if (this.lowering) {
      this.lowering = false;
      this.weaponSy = WEAPONTOP;
    }
    this.advanceFire(capped, dead ? false : firing, weapon);
    if (vitals) this.advanceFace(capped, firing, vitals);
  }

  drawWeapon(
    ctx: CanvasRenderingContext2D,
    viewW: number,
    viewH: number,
    hudH: number,
    weapon: number,
  ) {
    const idx = this.fireStep >= 0 ? this.fireWeapon : clampWeapon(weapon);
    const scale = viewW / BASE_W;
    if (this.weaponSy >= WEAPONBOTTOM) return;
    const frame = this.fireStep >= 0 ? (FIRE_SEQ[idx]?.[this.fireStep]?.frame ?? 0) : 0;
    const ready = this.sprites.forName(WEAPON_SPRITE[idx]!, frame);
    const pic = ready ?? this.sprites.forName(WEAPON_SPRITE[idx]!, 0);
    if (!pic) return;
    blitWeapon(ctx, pic, viewW, viewH, hudH, scale, this.weaponSy);
    if (this.flashFrame >= 0 && !this.lowering) {
      const flashName = WEAPON_FLASH[idx];
      if (flashName) {
        const flash =
          this.sprites.forName(flashName, this.flashFrame) ?? this.sprites.forName(flashName, 0);
        if (flash) blitWeapon(ctx, flash, viewW, viewH, hudH, scale, this.weaponSy);
      }
    }
  }

  drawStatusBar(
    ctx: CanvasRenderingContext2D,
    worldW: number,
    worldH: number,
    vitals: MarineVitals,
    opts?: HudDrawOpts,
  ): number {
    const dest = this.barDest(worldW, worldH, opts);
    const scale = dest.w / BASE_W;
    // Patches use vanilla 320×200 coords; virtual bottom = dest.y + dest.h.
    const patchViewH = dest.y + dest.h;
    const ox = dest.x;
    const prevSmooth = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    const bar = this.sprites.forLump("STBAR");
    if (bar) {
      ctx.drawImage(bar.image, dest.x, dest.y, dest.w, dest.h);
    } else {
      ctx.fillStyle = "#2a2a2a";
      ctx.fillRect(dest.x, dest.y, dest.w, dest.h);
    }

    const armsbg = this.sprites.forLump("STARMS");
    if (armsbg) {
      this.drawPatch(ctx, armsbg, ST.armsBgX, ST.armsBgY, worldW, patchViewH, scale, ox);
    }

    // Arms ownership: slots show numbers 2–7 for weapons pistol…BFG
    const owned = vitals.weapons ?? defaultOwned(vitals.weapon);
    for (let i = 0; i < 6; i++) {
      const wpn = i + 1;
      const has = (owned & (1 << wpn)) !== 0;
      const num = i + 2;
      const pic = this.sprites.forLump(has ? `STYSNUM${num}` : `STGNUM${num}`);
      if (!pic) continue;
      const ax = ST.armsX + (i % 3) * ST.armsXSpace;
      const ay = ST.armsY + Math.floor(i / 3) * ST.armsYSpace;
      this.drawPatch(ctx, pic, ax, ay, worldW, patchViewH, scale, ox);
    }

    const face = this.facePatch();
    if (face) this.drawPatch(ctx, face, ST.facesX, ST.facesY, worldW, patchViewH, scale, ox);

    this.drawBigNumber(ctx, vitals.ammo, ST.ammoX, ST.ammoY, worldW, patchViewH, scale, false, ox);
    this.drawBigNumber(ctx, vitals.health, ST.healthX, ST.healthY, worldW, patchViewH, scale, true, ox);
    this.drawBigNumber(ctx, vitals.armor, ST.armorX, ST.armorY, worldW, patchViewH, scale, true, ox);

    // Engine ammo[] order is am_clip, am_shell, am_cell, am_misl — NOT visual label order.
    // STBAR labels top→bottom are BULL / SHEL / RCKT / CELL; vanilla binds widgets accordingly.
    const counts = int4Client(vitals.ammoCounts, [0, 0, 0, 0]);
    const maxes = int4Client(vitals.maxAmmo, [200, 50, 300, 50]);
    const readyIdx = ammoIndexForWeapon(vitals.weapon);
    if (readyIdx >= 0) counts[readyIdx] = vitals.ammo;

    // Rows match STBAR labels (BULL, SHEL, RCKT, CELL).
    const rows: Array<{ idx: number; y: number }> = [
      { idx: 0, y: ST.ammo0Y }, // BULL ← clip
      { idx: 1, y: ST.ammo1Y }, // SHEL ← shell
      { idx: 3, y: ST.ammo3Y }, // RCKT ← misl
      { idx: 2, y: ST.ammo2Y }, // CELL ← cell
    ];
    for (const row of rows) {
      this.drawSmallNumber(ctx, counts[row.idx] ?? 0, ST.ammo0X, row.y, worldW, patchViewH, scale, ox);
      this.drawSmallNumber(ctx, maxes[row.idx] ?? 0, ST.maxAmmo0X, row.y, worldW, patchViewH, scale, ox);
    }

    const cards = vitals.cards ?? 0;
    const keyYs = [ST.key0Y, ST.key1Y, ST.key2Y];
    for (let i = 0; i < 3; i++) {
      let icon = -1;
      if (cards & (1 << i)) icon = i;
      if (cards & (1 << (i + 3))) icon = i + 3;
      if (icon < 0) continue;
      const pic = this.sprites.forLump(`STKEYS${icon}`);
      if (pic) this.drawPatch(ctx, pic, ST.key0X, keyYs[i]!, worldW, patchViewH, scale, ox);
    }

    ctx.imageSmoothingEnabled = prevSmooth;
    return dest.h;
  }

  /** Advance demon pain flash from health drops; call once per frame when possessing. */
  tickDemon(dtMs: number, vitals: DemonVitals | null) {
    if (!vitals) {
      this.demonLastHealth = -1;
      this.demonPain = 0;
      this.demonPainCarryMs = 0;
      return;
    }
    const health = Math.max(0, vitals.health);
    if (this.demonLastHealth < 0) {
      this.demonLastHealth = health;
    } else if (health < this.demonLastHealth) {
      const drop = this.demonLastHealth - health;
      this.demonPain = Math.min(100, this.demonPain + Math.max(12, drop * 4));
      this.demonLastHealth = health;
    } else {
      this.demonLastHealth = health;
    }

    this.demonPainCarryMs += Math.min(100, Math.max(0, dtMs));
    while (this.demonPainCarryMs >= TIC_MS) {
      this.demonPainCarryMs -= TIC_MS;
      if (this.demonPain > 0) this.demonPain = Math.max(0, this.demonPain - 2);
    }
  }

  /**
   * Demon status bar — STBAR chrome with marine-only slots remapped:
   * ammo → points, health → % of base HP, ammo stacks → HLTH/SPEED/DAMG/RATE, face → mugshot.
   */
  drawDemonStatusBar(
    ctx: CanvasRenderingContext2D,
    worldW: number,
    worldH: number,
    vitals: DemonVitals,
    opts?: HudDrawOpts,
  ): number {
    const dest = this.barDest(worldW, worldH, opts);
    const scale = dest.w / BASE_W;
    const patchViewH = dest.y + dest.h;
    const ox = dest.x;
    const prevSmooth = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;

    const bar = demonStatusBar(this.sprites) ?? this.sprites.forLump("STBAR");
    if (bar) {
      ctx.drawImage(bar.image, dest.x, dest.y, dest.w, dest.h);
    } else {
      ctx.fillStyle = "#2a1210";
      ctx.fillRect(dest.x, dest.y, dest.w, dest.h);
    }

    const face = demonFace(this.sprites, vitals.species, vitals.sprite);
    if (face) this.drawPatch(ctx, face, ST.facesX, ST.facesY, worldW, patchViewH, scale, ox);

    this.drawBigNumber(ctx, vitals.points, ST.ammoX, ST.ammoY, worldW, patchViewH, scale, false, ox);
    this.drawBigNumber(
      ctx,
      healthPercent(vitals.health, vitals.maxHealth),
      ST.healthX,
      ST.healthY,
      worldW,
      patchViewH,
      scale,
      true,
      ox,
    );

    const levels = [vitals.mods.health, vitals.mods.speed, vitals.mods.damage, vitals.mods.rate];
    const rows: Array<{ y: number }> = [
      { y: ST.ammo0Y },
      { y: ST.ammo1Y },
      { y: ST.ammo3Y },
      { y: ST.ammo2Y },
    ];
    const cap = modMax();
    for (let i = 0; i < 4; i++) {
      const lvl = Math.max(0, Math.min(9, levels[i] | 0));
      this.drawSmallNumber(ctx, lvl, ST.ammo0X, rows[i]!.y, worldW, patchViewH, scale, ox);
      this.drawSmallNumber(ctx, cap, ST.maxAmmo0X, rows[i]!.y, worldW, patchViewH, scale, ox);
    }

    ctx.imageSmoothingEnabled = prevSmooth;
    return dest.h;
  }

  private advanceFire(dtMs: number, firing: boolean, weapon: number) {
    const idx = clampWeapon(weapon);
    if (idx !== this.fireWeapon) {
      this.fireWeapon = idx;
      this.fireStep = -1;
      this.stepTicsLeft = 0;
      this.flashFrame = -1;
      this.flashTicsLeft = 0;
    }

    if (this.fireStep < 0 && firing && !this.lowering) this.beginFire(idx);

    this.fireCarryMs += dtMs;
    while (this.fireCarryMs >= TIC_MS) {
      this.fireCarryMs -= TIC_MS;
      if (this.lowering && this.weaponSy < WEAPONBOTTOM) {
        this.weaponSy = Math.min(WEAPONBOTTOM, this.weaponSy + LOWERSPEED);
      }
      if (this.fireStep >= 0) this.stepOneFireTic(firing);
      if (this.flashFrame >= 0) {
        this.flashTicsLeft--;
        if (this.flashTicsLeft <= 0) {
          this.flashFrame = -1;
          this.flashTicsLeft = 0;
        }
      }
    }
  }

  private stepOneFireTic(firing: boolean) {
    if (this.fireStep < 0) return;
    const seq = FIRE_SEQ[this.fireWeapon];
    if (!seq) {
      this.fireStep = -1;
      return;
    }

    // Vanilla: decrement tics; when it hits 0, advance in the same tic.
    if (this.stepTicsLeft > 0) {
      this.stepTicsLeft--;
      if (this.stepTicsLeft > 0) return;
    }

    const cur = seq[this.fireStep]!;
    if (cur.refire) {
      if (firing) this.beginFire(this.fireWeapon);
      else {
        this.fireStep = -1;
        this.stepTicsLeft = 0;
      }
      return;
    }

    this.fireStep++;
    if (this.fireStep >= seq.length) {
      this.fireStep = -1;
      this.stepTicsLeft = 0;
      return;
    }
    this.enterStep(seq[this.fireStep]!);
    if (this.stepTicsLeft === 0 && seq[this.fireStep]?.refire) {
      this.stepOneFireTic(firing);
    }
  }

  private beginFire(idx: number) {
    const seq = FIRE_SEQ[idx];
    if (!seq?.length) {
      this.fireStep = -1;
      return;
    }
    this.fireWeapon = idx;
    this.fireStep = 0;
    this.muzzleSfxOnFlash = seq[0]?.flash != null;
    this.enterStep(seq[0]!);
    // Guns with a delayed flash (pistol/shotgun/BFG/saw): predict SFX on trigger
    // so the first press isn't silent. Chaingun/plasma keep per-flash SFX below.
    if (idx !== 0 && !this.muzzleSfxOnFlash) {
      this.onMuzzleFlash?.(idx);
    }
  }

  private enterStep(step: FireStep) {
    this.stepTicsLeft = Math.max(0, step.tics);
    if (step.flash != null) {
      this.flashFrame = step.flash;
      this.flashTicsLeft = FLASH_TICS[this.fireWeapon] ?? 4;
      if (this.muzzleSfxOnFlash) this.onMuzzleFlash?.(this.fireWeapon);
    }
  }

  private advanceFace(dtMs: number, firing: boolean, vitals: MarineVitals) {
    this.faceCarryMs += dtMs;
    while (this.faceCarryMs >= TIC_MS) {
      this.faceCarryMs -= TIC_MS;
      this.stepOneFaceTic(firing, vitals);
    }
  }

  private stepOneFaceTic(firing: boolean, vitals: MarineVitals) {
    const health = Math.max(0, vitals.health);
    const owned = vitals.weapons ?? defaultOwned(vitals.weapon);

    if (health <= 0) {
      this.faceIndex = FACE_STRIDE * 5 + 1;
      this.faceCount = 1;
      this.priority = 9;
      this.lastHealth = health;
      return;
    }

    // Evil grin when picking up a new weapon
    if (owned !== this.oldWeapons) {
      let gained = false;
      for (let i = 0; i < 9; i++) {
        if ((owned & (1 << i)) !== 0 && (this.oldWeapons & (1 << i)) === 0) gained = true;
      }
      this.oldWeapons = owned;
      if (gained && this.priority <= 5) {
        this.faceIndex = painOffset(health) + 6;
        this.faceCount = 70;
        this.priority = 5;
      }
    }

    const drop = this.lastHealth - health;
    if (drop > 0 && this.priority < 7) {
      if (drop > OUCH_THRESH) {
        this.faceIndex = painOffset(health) + 5;
        this.faceCount = TURN_COUNT;
        this.priority = 7;
      } else if (this.priority < 4) {
        this.faceIndex = painOffset(health);
        // Prefer turn toward attacker; without attacker angle, use kill face
        this.faceIndex = painOffset(health) + 7;
        this.faceCount = TURN_COUNT;
        this.priority = 4;
      }
    }

    if (firing) {
      if (this.attackDownTics < 0) this.attackDownTics = RAMPAGE_DELAY;
      else if (--this.attackDownTics === 0) {
        this.attackDownTics = 1;
        if (this.priority <= 4) {
          this.faceIndex = painOffset(health) + 7;
          this.faceCount = 1;
          this.priority = 4;
        }
      }
    } else {
      this.attackDownTics = -1;
    }

    if (this.faceCount > 0) {
      this.faceCount--;
      if (this.faceCount === 0) this.priority = 0;
    } else {
      this.faceIndex = painOffset(health) + (Math.floor(Math.random() * 3) | 0);
      this.faceCount = STRAIGHT_FACE_COUNT;
      this.priority = 0;
    }

    this.lastHealth = health;
  }

  private facePatch(): SpritePic | null {
    const idx = this.faceIndex;
    if (idx >= FACE_STRIDE * 5) {
      return this.sprites.forLump(idx === FACE_STRIDE * 5 ? "STFGOD0" : "STFDEAD0");
    }
    const pain = Math.min(4, Math.floor(idx / FACE_STRIDE));
    const off = idx % FACE_STRIDE;
    if (off < 3) return this.sprites.forLump(`STFST${pain}${off}`);
    if (off === 3) return this.sprites.forLump(`STFTR${pain}0`);
    if (off === 4) return this.sprites.forLump(`STFTL${pain}0`);
    if (off === 5) return this.sprites.forLump(`STFOUCH${pain}`);
    if (off === 6) return this.sprites.forLump(`STFEVL${pain}`);
    return this.sprites.forLump(`STFKILL${pain}`);
  }

  private drawPatch(
    ctx: CanvasRenderingContext2D,
    pic: SpritePic,
    sx: number,
    sy: number,
    _viewW: number,
    viewH: number,
    scale: number,
    ox = 0,
  ) {
    const x = Math.round(ox + (sx - pic.leftOffset) * scale);
    const y = Math.round(viewH - (BASE_H - (sy - pic.topOffset)) * scale);
    const prev = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      pic.image,
      x,
      y,
      Math.max(1, Math.round(pic.width * scale)),
      Math.max(1, Math.round(pic.height * scale)),
    );
    ctx.imageSmoothingEnabled = prev;
  }

  private drawBigNumber(
    ctx: CanvasRenderingContext2D,
    value: number,
    rightX: number,
    sy: number,
    viewW: number,
    viewH: number,
    scale: number,
    percent: boolean,
    ox = 0,
  ) {
    const n = Math.max(0, Math.min(999, Math.floor(value)));
    let x = rightX;
    if (n === 0) {
      const pic = this.sprites.forLump("STTNUM0");
      if (pic) {
        x -= pic.width;
        this.drawPatch(ctx, pic, x, sy, viewW, viewH, scale, ox);
      }
    } else {
      let rem = n;
      while (rem > 0) {
        const d = rem % 10;
        const pic = this.sprites.forLump(`STTNUM${d}`);
        if (!pic) break;
        x -= pic.width;
        this.drawPatch(ctx, pic, x, sy, viewW, viewH, scale, ox);
        rem = (rem / 10) | 0;
      }
    }
    if (percent) {
      const pct = this.sprites.forLump("STTPRCNT");
      if (pct) this.drawPatch(ctx, pct, rightX, sy, viewW, viewH, scale, ox);
    }
  }

  private drawSmallNumber(
    ctx: CanvasRenderingContext2D,
    value: number,
    rightX: number,
    sy: number,
    viewW: number,
    viewH: number,
    scale: number,
    ox = 0,
  ) {
    let num = Math.max(0, Math.min(999, Math.floor(value)));
    let x = rightX;
    const w0 = this.sprites.forLump("STYSNUM0");
    const digitW = w0?.width ?? 4;
    if (num === 0) {
      const pic = this.sprites.forLump("STYSNUM0");
      if (pic) this.drawPatch(ctx, pic, x - digitW, sy, viewW, viewH, scale, ox);
      return;
    }
    while (num) {
      const d = num % 10;
      const pic = this.sprites.forLump(`STYSNUM${d}`);
      if (!pic) break;
      x -= digitW;
      this.drawPatch(ctx, pic, x, sy, viewW, viewH, scale, ox);
      num = (num / 10) | 0;
    }
  }
}

export function weaponSpriteName(weapon: number): string {
  return WEAPON_SPRITE[clampWeapon(weapon)]!;
}

/** Map readyweapon → ammo[] index, or -1 for fist/saw. Exported for tests. */
export function ammoIndexForWeapon(weapon: number): number {
  switch (clampWeapon(weapon)) {
    case 1: // pistol
    case 3: // chaingun
      return 0; // clip
    case 2: // shotgun
    case 8: // ssg
      return 1; // shell
    case 5: // plasma
    case 6: // bfg
      return 2; // cell
    case 4: // missile
      return 3; // misl
    default:
      return -1;
  }
}

/**
 * Hit-test the STBAR ARMS grid (numbers 2–7) in canvas backing-store pixels.
 * Returns the keyboard weapon digit (2–7), or null if outside the grid.
 */
export function hitTestArmsWeapon(
  canvasX: number,
  canvasY: number,
  worldW: number,
  worldH: number,
  placement: HudPlacement = "overlay",
  hudScale = 1,
): number | null {
  if (!Number.isFinite(canvasX) || !Number.isFinite(canvasY)) return null;
  if (worldW <= 0 || worldH <= 0) return null;
  const dest = hudDestRect(worldW, worldH, placement, hudScale);
  const scale = dest.w / BASE_W;
  if (!(scale > 0)) return null;
  const ox = dest.x;
  const viewH = dest.y + dest.h;
  // Inverse of drawPatch with zero offsets: canvas ← vanilla screen (sx, sy).
  const sx = (canvasX - ox) / scale;
  const sy = BASE_H - (viewH - canvasY) / scale;
  for (let i = 0; i < 6; i++) {
    const ax = ST.armsX + (i % 3) * ST.armsXSpace;
    const ay = ST.armsY + Math.floor(i / 3) * ST.armsYSpace;
    if (sx >= ax && sx < ax + ST.armsXSpace && sy >= ay && sy < ay + ST.armsYSpace) {
      return i + 2; // ARMS digits 2–7
    }
  }
  return null;
}

function clampWeapon(w: number): number {
  if (!Number.isFinite(w) || w < 0) return 1;
  if (w >= WEAPON_SPRITE.length) return WEAPON_SPRITE.length - 1;
  return w | 0;
}

function defaultOwned(weapon: number): number {
  return (1 << 0) | (1 << 1) | (1 << clampWeapon(weapon));
}

/** Coerce array-like ammo vectors (JSON object, Int32Array, sparse). */
function int4Client(value: number[] | undefined, fallback: readonly number[]): number[] {
  const out = [fallback[0] ?? 0, fallback[1] ?? 0, fallback[2] ?? 0, fallback[3] ?? 0];
  if (value == null) return out;
  for (let i = 0; i < 4; i++) {
    const n = Number((value as Record<number, unknown>)[i]);
    if (Number.isFinite(n)) out[i] = n | 0;
  }
  return out;
}

/** Vanilla ST_calcPainOffset. */
function painOffset(health: number): number {
  const h = health > 100 ? 100 : Math.max(0, health);
  return FACE_STRIDE * Math.floor(((100 - h) * 5) / 101);
}

/**
 * Vanilla psprite placement: virtual 168-tall view ending at the status bar.
 * Keeps the weapon planted on the HUD regardless of canvas aspect ratio.
 */
function blitWeapon(
  ctx: CanvasRenderingContext2D,
  pic: SpritePic,
  viewW: number,
  viewH: number,
  hudH: number,
  scale: number,
  sy = WEAPONTOP,
) {
  const sx = 1;
  const virtH = VIEW_H * scale;
  const virtTop = viewH - hudH - virtH;
  const x = viewW / 2 + (sx - 160 - pic.leftOffset) * scale;
  const texturemid = 100 - (sy - pic.topOffset);
  const y = virtTop + virtH / 2 - texturemid * scale;
  ctx.drawImage(pic.image, x, y, pic.width * scale, pic.height * scale);
}

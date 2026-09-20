import type { ClientState, Actor } from "./state";
import { WadFile } from "./wad/wadFile";
import { loadMap, strokeMapLines, type DoomMap } from "./wad/mapData";
import { SpriteStore } from "./wad/sprites";
import { HudGfx } from "./wad/hudGfx";
import { WasmWorldRenderer } from "./wad/wasmView";
import { ThinAudio } from "./audio";
import { getClientSettings, hudDestRect, resolveRenderScale, WASM_W } from "./clientSettings";
import { getWadUrl } from "./sim";
import { setIwadHttpUrl } from "./wad/wasmView";

/** Minimap overlay constants — 4x-reference (1280-wide world) values. */
const MINIMAP_SIZE = 120;
const MINIMAP_SCALE = 0.04;

export interface ThinViewerOpts {
  /** Absolute IWAD URL from join.wadUrl (or getWadUrl()). */
  wadUrl?: string;
}

/** First-person view: WASM BSP world + TypeScript HUD overlays. */
export class ThinViewer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private minimapCtx: CanvasRenderingContext2D | null;
  private w: number;
  private h: number;
  private wadUrl: string;
  private wad: WadFile | null = null;
  private sprites: SpriteStore | null = null;
  private hud: HudGfx | null = null;
  private map: DoomMap | null = null;
  private mapName: string | null = null;
  private wasm: WasmWorldRenderer;
  private loadError: string | null = null;
  private loading: Promise<void> | null = null;
  private localFire = false;
  private localWeapon = 1;
  private lastFrameMs = 0;
  readonly audio = new ThinAudio();

  constructor(canvas: HTMLCanvasElement, opts: ThinViewerOpts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    const mini = document.getElementById("minimap") as HTMLCanvasElement | null;
    this.minimapCtx = mini?.getContext("2d") ?? null;
    if (mini) {
      mini.width = MINIMAP_SIZE;
      mini.height = MINIMAP_SIZE;
    }
    this.w = canvas.width;
    this.h = canvas.height;
    this.wadUrl = opts.wadUrl ?? getWadUrl();
    setIwadHttpUrl(this.wadUrl);
    this.wasm = new WasmWorldRenderer();
    void this.ensureWad();
    void this.wasm.ensureReady(resolveRenderScale(getClientSettings().renderScale)).catch((err) => {
      this.loadError = err instanceof Error ? err.message : String(err);
      console.error("[thin] WASM view failed", err);
    });
  }

  /** Client-side fire/weapon for overlay animation (not simulated). */
  setLocalAction(fire: boolean, weapon?: number) {
    this.localFire = fire;
    if (weapon != null) this.localWeapon = weapon;
  }

  private async ensureWad() {
    if (this.wad || this.loading) return this.loading;
    this.loading = (async () => {
      try {
        this.wad = await WadFile.fetch(this.wadUrl);
        this.sprites = new SpriteStore(this.wad);
        this.hud = new HudGfx(this.sprites);
        this.hud.onMuzzleFlash = (w) => this.audio.onMuzzleFlash(w);
        this.audio.setWad(this.wad);
        console.info(`[thin] IWAD loaded (${this.sprites.count} sprites)`);
      } catch (err) {
        this.loadError = err instanceof Error ? err.message : String(err);
        console.error("[thin] IWAD load failed", err);
      }
    })();
    return this.loading;
  }

  private ensureMap(mapName: string) {
    if (!this.wad) return;
    if (this.mapName === mapName && this.map) return;
    try {
      this.map = loadMap(this.wad, mapName);
      this.mapName = mapName;
      console.info(
        `[thin] map ${mapName}: ${this.map.linedefs.length} lines, ${this.map.sectors.length} sectors (wasm view)`,
      );
    } catch (err) {
      this.loadError = err instanceof Error ? err.message : String(err);
      console.error("[thin] map load failed", err);
    }
  }

  /**
   * Size the canvas for the WASM world blit (+ optional below-HUD strip).
   * Dispatches resize so boot.ts can recompute CSS display size.
   */
  private ensureCanvasSize(worldW: number, worldH: number, canvasH: number) {
    if (this.canvas.width === worldW && this.canvas.height === canvasH) {
      this.w = worldW;
      this.h = canvasH;
      return;
    }
    this.canvas.width = worldW;
    this.canvas.height = canvasH;
    this.w = worldW;
    this.h = canvasH;
    window.dispatchEvent(new Event("resize"));
  }

  frame(state: ClientState) {
    const ctx = this.ctx;
    this.w = this.canvas.width;
    this.h = this.canvas.height;

    if (state.mapName) this.ensureMap(state.mapName);

    const now = performance.now();
    const dt = this.lastFrameMs ? now - this.lastFrameMs : 16;
    this.lastFrameMs = now;

    const camId = state.controlledId ?? state.followTargetId ?? 1;
    const cam = state.entities.actors.get(camId);
    const settings = getClientSettings();

    // Every path below either draws the minimap or must blank the overlay.
    if (this.loadError || !this.wad || !this.sprites || state.mapLoading
        || !this.map || !this.wasm.isReady || !cam) {
      this.clearMinimap();
    }

    if (this.loadError) {
      ctx.fillStyle = "#1a1020";
      ctx.fillRect(0, 0, this.w, this.h);
      ctx.fillStyle = "#f84";
      ctx.font = "14px monospace";
      ctx.fillText(`Render error: ${this.loadError}`, 16, 32);
      return;
    }

    if (!this.wad || !this.sprites) {
      ctx.fillStyle = "#1a1020";
      ctx.fillRect(0, 0, this.w, this.h);
      ctx.fillStyle = "#fc6";
      ctx.font = "16px monospace";
      ctx.fillText("Loading IWAD…", 24, this.h / 2);
      void this.ensureWad();
      return;
    }

    if (state.mapLoading || !this.map) {
      ctx.fillStyle = "#1a1020";
      ctx.fillRect(0, 0, this.w, this.h);
      ctx.fillStyle = "#fc6";
      ctx.font = "18px monospace";
      ctx.fillText(`Loading ${state.mapName ?? "map"}…`, 24, this.h / 2);
      return;
    }

    if (!this.wasm.isReady) {
      ctx.fillStyle = "#1a1020";
      ctx.fillRect(0, 0, this.w, this.h);
      ctx.fillStyle = "#fc6";
      ctx.font = "18px monospace";
      ctx.fillText("Loading WASM renderer…", 24, this.h / 2);
      if (this.wasm.loadError) this.loadError = this.wasm.loadError;
      return;
    }

    if (!cam) {
      ctx.fillStyle = "#1a1020";
      ctx.fillRect(0, 0, this.w, this.h);
      ctx.fillStyle = "#f44";
      ctx.font = "20px monospace";
      ctx.fillText("Waiting for world…", 24, this.h / 2);
      return;
    }

    const renderScale = resolveRenderScale(settings.renderScale);

    const frame = this.wasm.render(
      state,
      { x: cam.x, y: cam.y, z: cam.z, angle: cam.angle },
      { hidePsprites: true, hideActorId: camId, scale: renderScale },
    );
    if (!frame) {
      this.loadError = "WASM render failed";
      return;
    }

    const worldW = frame.width;
    const worldH = frame.height;
    const layout = hudDestRect(worldW, worldH, settings.hudPlacement, settings.hudScale);
    this.ensureCanvasSize(worldW, worldH, layout.canvasH);

    // Clear strip area when taller than the world blit (below-HUD mode).
    if (layout.canvasH > worldH) {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, worldH, worldW, layout.canvasH - worldH);
    }

    const pixels = new Uint8ClampedArray(frame.data.length);
    pixels.set(frame.data);
    ctx.putImageData(new ImageData(pixels, worldW, worldH), 0, 0);

    const marine = state.role === "marine" ? state.marine : null;
    const weapon = marine?.weapon ?? this.localWeapon;
    if (marine?.weapon != null) this.localWeapon = marine.weapon;

    const demonBody =
      state.role === "demon" && state.controlledId != null
        ? state.entities.actors.get(state.controlledId)
        : undefined;
    const demon =
      demonBody && demonBody.kind === "monster"
        ? {
            species: demonBody.typeName ?? "demon",
            health: demonBody.health,
            maxHealth: demonBody.maxHealth ?? Math.max(1, demonBody.health),
            points: state.points,
            mods: state.mods,
          }
        : null;

    const hudOpts = {
      placement: settings.hudPlacement,
      hudScale: settings.hudScale,
    };
    // Weapons sit on the bar in overlay mode; full world height when HUD is below.
    const weaponHudH =
      settings.hudPlacement === "below"
        ? 0
        : this.hud
          ? this.hud.barHeight(worldW, settings.hudScale)
          : 0;

    if (marine && this.hud) {
      this.hud.tick(dt, this.localFire, weapon, marine);
      this.hud.drawWeapon(this.ctx, worldW, worldH, weaponHudH, weapon);
    } else if (demon && this.hud) {
      this.hud.tickDemon(dt, demon);
    }

    if (settings.showCrosshair) {
      // Center of the 3D view (not including a below strip).
      const cy =
        settings.hudPlacement === "below"
          ? worldH / 2
          : worldH / 2 - Math.floor(weaponHudH / 4);
      const arm = Math.max(4, Math.round(8 * (worldW / WASM_W)));
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.beginPath();
      ctx.moveTo(worldW / 2 - arm, cy);
      ctx.lineTo(worldW / 2 + arm, cy);
      ctx.moveTo(worldW / 2, cy - arm);
      ctx.lineTo(worldW / 2, cy + arm);
      ctx.stroke();
    }

    this.drawMinimap(state, cam);

    if (marine && this.hud) {
      this.hud.drawStatusBar(this.ctx, worldW, worldH, marine, hudOpts);
    } else if (demon && this.hud) {
      this.hud.drawDemonStatusBar(this.ctx, worldW, worldH, demon, hudOpts);
    }

    const dmg = marine?.damagecount ?? 0;
    const demonFlash = !marine && demon && this.hud ? this.hud.demonPainAlpha() : 0;
    const flashA = dmg > 0 ? Math.min(0.55, dmg / 100) : demonFlash;
    if (flashA > 0) {
      const flashH =
        settings.hudPlacement === "below" ? worldH : worldH - weaponHudH;
      ctx.fillStyle = `rgba(180,0,0,${flashA})`;
      ctx.fillRect(0, 0, worldW, flashH);
    }
  }

  private clearMinimap() {
    this.minimapCtx?.clearRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);
  }

  /**
   * Overlay canvas at fixed 4x-reference resolution (not the WASM world
   * canvas) — the map keeps its size and fidelity at every render scale.
   */
  private drawMinimap(state: ClientState, cam: Actor) {
    const ctx = this.minimapCtx;
    if (!ctx) return;
    const s = MINIMAP_SIZE;
    const scale = MINIMAP_SCALE;
    const camAng = ((cam.angle % 360) * Math.PI) / 180;
    ctx.clearRect(0, 0, s, s);
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, s, s);
    if (this.map) strokeMapLines(ctx, this.map, cam, 0, 0, s, scale);
    for (const a of state.entities.actors.values()) {
      const px = s / 2 + (a.x - cam.x) * scale;
      const py = s / 2 - (a.y - cam.y) * scale;
      ctx.fillStyle =
        a.id === cam.id
          ? "#0f0"
          : a.kind === "marine"
            ? "#4af"
            : a.kind === "item"
              ? "#fc6"
              : a.controllerSessionId
                ? "#f80"
                : "#a44";
      ctx.fillRect(px - 2, py - 2, 4, 4);
    }
    for (const p of state.entities.projectiles.values()) {
      const px = s / 2 + (p.x - cam.x) * scale;
      const py = s / 2 - (p.y - cam.y) * scale;
      ctx.fillStyle = "#fd4";
      ctx.fillRect(px - 1, py - 1, 2, 2);
    }
    ctx.strokeStyle = "#0f0";
    ctx.beginPath();
    ctx.moveTo(s / 2, s / 2);
    ctx.lineTo(s / 2 + Math.cos(camAng) * 14, s / 2 - Math.sin(camAng) * 14);
    ctx.stroke();
  }
}

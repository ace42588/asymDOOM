import { initHud, setRole, setMarineVitals, setDemonBody, setCatchup } from "../hud";
import { initTouchControls } from "../touch";
import { initClientSettingsUi } from "../clientSettingsUi";
import {
  createClientState,
  reduceServerMessage,
  PROTOCOL_VERSION,
  type ClientState,
} from "./state";
import { buildInputMessage, initInput, sampleIntent } from "./input";
import { ThinViewer } from "./viewer";
import {
  getClientSettings,
  hudDestRect,
  loadClientSettings,
  resolveCanvasCssSize,
  resolveRenderScale,
  subscribeClientSettings,
  worldSizeForRenderScale,
  WASM_H,
  WASM_W,
} from "./clientSettings";
import { loadSessionId, saveSessionId } from "./sessionId";

function el(id: string) {
  return document.getElementById(id)!;
}

function banner(text: string) {
  const b = el("hud-banner");
  b.textContent = text;
  b.classList.remove("hidden");
  window.setTimeout(() => b.classList.add("hidden"), 4000);
}

/** Prefer structured Zod/JSON payloads in the console; fall back to the raw string. */
function parseNoticeDetail(message: unknown): unknown {
  if (typeof message !== "string") return message;
  const trimmed = message.trim();
  if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) return message;
  try {
    return JSON.parse(trimmed);
  } catch {
    return message;
  }
}

function logServerNotice(msg: Record<string, unknown>) {
  const code = String(msg.code ?? "notice");
  const detail = parseNoticeDetail(msg.message);
  console.error(`[thin] notice:${code}`, detail, msg);
}

function syncHud(state: ClientState) {
  setRole(state.role);
  if (state.controlledId != null) {
    const body = state.entities.actors.get(state.controlledId);
    if (body && body.kind === "monster") {
      setDemonBody(body.typeName ?? "demon");
    } else if (state.role === "marine") {
      setDemonBody(null);
    }
  } else if (state.role === "spectator") {
    setDemonBody(null);
  }
  setMarineVitals(state.role === "marine" ? state.marine : null);
  setCatchup(state.mapLoading, state.mapLoading ? `Loading ${state.mapName ?? "map"}…` : undefined);
  if (state.lastNotice) {
    banner(state.lastNotice);
    state.lastNotice = null;
  }
}

export async function bootThin() {
  loadClientSettings();
  initHud();
  initTouchControls();
  initClientSettingsUi();
  const roleEl = el("hud-role");
  try {
    const res = await fetch("/api/join", { method: "POST" });
    if (!res.ok) throw new Error("join failed");
    await res.json();
  } catch {
    roleEl.textContent = "Cannot reach gateway";
    return;
  }
  const canvas = document.getElementById("canvas") as HTMLCanvasElement;
  // WASM framebuffer is 4× of vanilla 320×200. Canvas CSS scale is separate
  // (1× / 2× / fit); fit uses world + optional below-HUD height from settings.
  canvas.width = WASM_W;
  canvas.height = WASM_H;
  const fitCanvas = () => {
    // Derive backing size from settings so CSS updates immediately when HUD
    // placement / render scale changes (don't wait for the next viewer frame).
    const settings = getClientSettings();
    const render = resolveRenderScale(settings.renderScale);
    const world = worldSizeForRenderScale(render);
    const layout = hudDestRect(
      world.width,
      world.height,
      settings.hudPlacement,
      settings.hudScale,
    );
    const { width, height } = resolveCanvasCssSize(
      settings.canvasScale,
      world.width,
      layout.canvasH,
      window.innerWidth,
      window.innerHeight,
    );
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  };
  fitCanvas();
  window.addEventListener("resize", fitCanvas);
  subscribeClientSettings(() => fitCanvas());
  initInput(canvas);
  const viewer = new ThinViewer(canvas);
  let state = createClientState();
  let seq = 0;
  let inputTimer: number | null = null;

  const unlockAudio = () => {
    void viewer.audio.unlock();
  };
  // Keep trying until the mixer exists and the context is running — a once:true
  // gesture before IWAD load would otherwise leave audio suspended forever.
  window.addEventListener("keydown", unlockAudio);
  canvas.addEventListener("pointerdown", unlockAudio);

  const wsProto = location.protocol === "https:" ? "wss" : "ws";
  const resumeId = loadSessionId();
  const wsUrl = resumeId
    ? `${wsProto}://${location.host}/ws?sessionId=${encodeURIComponent(resumeId)}`
    : `${wsProto}://${location.host}/ws`;
  const ws = new WebSocket(wsUrl);

  const stopInput = () => {
    if (inputTimer != null) {
      window.clearInterval(inputTimer);
      inputTimer = null;
    }
  };

  const startInput = (hz: number) => {
    stopInput();
    const rate = hz > 0 ? hz : 35;
    inputTimer = window.setInterval(sendInput, 1000 / rate);
  };

  const sendInput = () => {
    if (ws.readyState !== WebSocket.OPEN || !state.sessionId || state.disconnected) return;
    const sample = sampleIntent();
    viewer.setLocalAction(sample.intent.fire, state.marine?.weapon ?? 1);
    ws.send(JSON.stringify(buildInputMessage(seq++, sample)));
  };

  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(String(ev.data)) as Record<string, unknown>;
    if (msg.protocolVersion != null && msg.protocolVersion !== PROTOCOL_VERSION) {
      console.error("[thin] unsupported protocolVersion", msg.protocolVersion, msg);
    }
    const prev = state;
    state = reduceServerMessage(state, msg);
    if (msg.type === "mapLoad") {
      viewer.audio.stopAll();
      ws.send(JSON.stringify({ type: "mapLoadComplete", protocolVersion: PROTOCOL_VERSION }));
    }
    if (msg.type === "welcome") {
      if (state.sessionId) saveSessionId(state.sessionId);
      startInput(state.tickRateHz);
      syncHud(state);
    }
    if (msg.type === "roleChange") {
      syncHud(state);
    }
    if (msg.type === "bye") {
      stopInput();
      console.error("[thin] bye", msg.reason ?? "bye", msg);
      syncHud(state);
    }
    if (msg.type === "snapshot") {
      const events = (msg.events as Array<{
        kind: string;
        species?: string;
        reason?: string;
        points?: number;
        sound?: string;
        x?: number;
        y?: number;
        z?: number;
        bodyId?: number;
      }>) ?? [];
      viewer.audio.ingest(prev, state, events);
      for (const e of events) {
        if (e.kind === "hop") banner(`Possessed ${e.species ?? "demon"}`);
        if (e.kind === "hopfail") banner(e.reason === "cool" ? "Hop on cooldown" : "No other demons available");
        if (e.kind === "spectate") banner("Spectating — press P to possess");
        if (e.kind === "points" && e.reason === "consume") banner("Consumed a corpse (+25)");
        if (e.kind === "points" && e.reason === "scavenge") banner("Scavenged remains (+10)");
        if (e.kind === "secret") {
          const sector = e.reason ? ` sector ${e.reason}` : "";
          const count = typeof e.points === "number" ? ` (${e.points})` : "";
          const text = `Secret!${sector}${count}`;
          console.info(`[thin] ${text}`);
          banner(text);
        }
      }
      syncHud(state);
    }
    if (msg.type === "notice") {
      logServerNotice(msg);
      syncHud(state);
    }
  });

  ws.addEventListener("error", (ev) => {
    console.error("[thin] websocket error", ev);
  });

  ws.addEventListener("close", () => {
    stopInput();
    if (!state.disconnected) {
      console.error("[thin] connection closed");
      state = { ...state, disconnected: true, lastNotice: "Connection closed" };
      syncHud(state);
    }
  });

  const loop = () => {
    viewer.frame(state);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  el("hud-catchup").classList.add("hidden");
}

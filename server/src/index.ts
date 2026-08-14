// asymDOOM gateway: static hosting + session/role API + WebSocket packet relay.
//
// The relay is intentionally dumb (no game logic). Packets are binary frames:
//   sender -> relay:   [to: u32 LE][from: u32 LE][payload]
//   relay -> receiver: [from: u32 LE][payload]
// A socket is registered under its `from` uid on the first frame it sends.
// The headless dedicated engine always registers as uid 1.

import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const ENGINE_DIR = path.join(ROOT, "engine", "src");
const WEB_DIST = path.join(ROOT, "web", "dist");
const ASSETS = path.join(ROOT, "assets");

const PORT = Number(process.env.PORT ?? 8666);
const SETTINGS_PATH = path.join(ROOT, "server", "settings.json");

interface Settings {
  skill: number;
  episode: number;
  map: number;
  maxPlayers: number;
  onMarineDeath: "demons_win" | "respawn_as_killer" | "marine_respawn";
  onDemonDeath: "possess_next" | "spectate" | "spawn_new";
  demonView: "first_person" | "chase";
  possessableTypes: string[];
}

const settings: Settings = JSON.parse(readFileSync(SETTINGS_PATH, "utf8"));

// Enum encodings shared with engine/src/doom/asym.h
const MARINE_DEATH_CODE = { demons_win: 0, respawn_as_killer: 1, marine_respawn: 2 };
const DEMON_DEATH_CODE = { possess_next: 0, spectate: 1, spawn_new: 2 };
const DEMON_VIEW_CODE = { first_person: 0, chase: 1 };
const POSSESSABLE_BIT: Record<string, number> = {
  zombieman: 1 << 0,
  shotgunner: 1 << 1,
  imp: 1 << 2,
  demon: 1 << 3,
  spectre: 1 << 4,
  lostsoul: 1 << 5,
  cacodemon: 1 << 6,
  baron: 1 << 7,
};

function possessableMask(): number {
  return settings.possessableTypes.reduce((m, t) => m | (POSSESSABLE_BIT[t] ?? 0), 0);
}

// ---------------------------------------------------------------------------
// Session state
// ---------------------------------------------------------------------------

const SERVER_UID = 1;

interface SessionState {
  engine: ChildProcess | null;
  engineReady: boolean;
  marineJoined: boolean;
  joinCount: number;
  gameStarted: boolean;
}

const session: SessionState = {
  engine: null,
  engineReady: false,
  marineJoined: false,
  joinCount: 0,
  gameStarted: false,
};

function log(tag: string, msg: string) {
  console.log(`[${new Date().toISOString()}] [${tag}] ${msg}`);
}

function startEngine() {
  if (session.engine) return;
  const enginePath = path.join(ENGINE_DIR, "websockets-doom.js");
  if (!existsSync(enginePath)) {
    log("engine", `MISSING ${enginePath} - run \`npm run build:engine\` first`);
    return;
  }
  const args = [
    path.join(ROOT, "server", "engine-host.mjs"),
    enginePath,
    "-dedicated",
    "-wss",
    `ws://127.0.0.1:${PORT}/ws`,
  ];
  log("engine", `spawning headless dedicated engine (uid ${SERVER_UID})`);
  const child = spawn(process.execPath, args, { cwd: ENGINE_DIR, stdio: ["ignore", "pipe", "pipe"] });
  session.engine = child;
  child.stdout!.on("data", (d: Buffer) =>
    d.toString().trimEnd().split("\n").forEach((l) => {
      if (l.includes("asym: match start") || l.includes("doom: 10")) session.gameStarted = true;
      log("engine", l);
    }),
  );
  child.stderr!.on("data", (d: Buffer) =>
    d.toString().trimEnd().split("\n").forEach((l) => log("engine!", l)),
  );
  child.on("exit", (code) => {
    log("engine", `dedicated engine exited (code ${code})`);
    session.engine = null;
    session.engineReady = false;
    session.marineJoined = false;
    session.joinCount = 0;
    session.gameStarted = false;
    // A fresh engine is spawned on the next join.
  });
}

// Args the browser passes to callMain(). The client appends "-wss <url>".
function engineArgsFor(role: "marine" | "demon"): string[] {
  const common = [
    "-iwad", "doom1.wad",
    "-window",
    "-width", "800",
    "-height", "600",
    "-nogui",
    "-nomusic",
    "-config", "default.cfg",
    "-connect", String(SERVER_UID),
    // asym rule settings ride the controller's net_gamesettings_t, but every
    // client passes them so late joiners agree before GAMESTART arrives too.
    "-asymmarinedeath", String(MARINE_DEATH_CODE[settings.onMarineDeath]),
    "-asymdemondeath", String(DEMON_DEATH_CODE[settings.onDemonDeath]),
    "-asymmask", String(possessableMask()),
    "-asymdemonview", String(DEMON_VIEW_CODE[settings.demonView] ?? 0),
  ];
  if (role === "marine") {
    // The first client is the netgame controller: it supplies the game
    // settings and -nodes 1 auto-launches as soon as it is connected.
    return [
      ...common,
      "-nodes", "1",
      "-skill", String(settings.skill),
      "-episode", String(settings.episode),
    ];
  }
  return common;
}

// ---------------------------------------------------------------------------
// HTTP: static files + JSON API
// ---------------------------------------------------------------------------

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".map": "application/json",
  ".wad": "application/octet-stream",
  ".cfg": "text/plain",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
};

// Search order lets the web bundle, engine artifacts and the IWAD live in
// their own directories while sharing one origin.
const STATIC_ROOTS = [WEB_DIST, ENGINE_DIR, ASSETS];

function serveStatic(res: http.ServerResponse, urlPath: string) {
  const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  if (rel.includes("..")) {
    res.writeHead(400).end("bad path");
    return;
  }
  for (const root of STATIC_ROOTS) {
    const file = path.join(root, rel);
    if (existsSync(file) && statSync(file).isFile()) {
      res.writeHead(200, {
        "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream",
        "Cache-Control": "no-cache",
      });
      res.end(readFileSync(file));
      return;
    }
  }
  if (rel === "index.html") {
    res.writeHead(503, { "Content-Type": "text/plain" });
    res.end("web client not built - run `npm run build:web`");
    return;
  }
  res.writeHead(404).end("not found");
}

function handleApi(req: http.IncomingMessage, res: http.ServerResponse, urlPath: string) {
  res.setHeader("Content-Type", "application/json");
  if (urlPath === "/api/join" && req.method === "POST") {
    startEngine();
    const role: "marine" | "demon" = session.marineJoined ? "demon" : "marine";
    if (role === "marine") session.marineJoined = true;
    session.joinCount++;
    log("session", `join #${session.joinCount} -> ${role}`);
    res.end(
      JSON.stringify({
        role,
        engineArgs: engineArgsFor(role),
        settings,
        gameStarted: session.gameStarted,
      }),
    );
    return;
  }
  if (urlPath === "/api/session") {
    res.end(
      JSON.stringify({
        engineRunning: session.engine !== null,
        engineReady: session.engineReady,
        marineJoined: session.marineJoined,
        joinCount: session.joinCount,
        gameStarted: session.gameStarted,
        relayPeers: [...peers.keys()],
        settings,
      }),
    );
    return;
  }
  res.writeHead(404).end(JSON.stringify({ error: "not found" }));
}

const httpServer = http.createServer((req, res) => {
  const urlPath = new URL(req.url ?? "/", "http://x").pathname;
  if (urlPath.startsWith("/api/")) {
    handleApi(req, res, urlPath);
    return;
  }
  serveStatic(res, urlPath);
});

// ---------------------------------------------------------------------------
// WebSocket relay
// ---------------------------------------------------------------------------

const peers = new Map<number, WebSocket>();

const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

wss.on("connection", (ws) => {
  let uid: number | null = null;

  ws.on("message", (data: Buffer, isBinary) => {
    if (!isBinary || data.length < 8) return;
    const to = data.readUInt32LE(0);
    const from = data.readUInt32LE(4);

    if (uid === null || uid !== from) {
      if (uid !== null) peers.delete(uid);
      uid = from;
      const prev = peers.get(uid);
      if (prev && prev !== ws) {
        log("relay", `uid ${uid} re-registered, dropping old socket`);
        prev.close();
      }
      peers.set(uid, ws);
      if (uid === SERVER_UID) session.engineReady = true;
      log("relay", `registered uid ${uid} (${peers.size} peers)`);
    }

    if (to === 0) return; // pure registration packet
    const dest = peers.get(to);
    if (dest && dest.readyState === WebSocket.OPEN) {
      // Deliver as [from][payload].
      dest.send(data.subarray(4));
    }
  });

  ws.on("close", () => {
    if (uid !== null && peers.get(uid) === ws) {
      peers.delete(uid);
      log("relay", `uid ${uid} disconnected (${peers.size} peers)`);
      if (uid === SERVER_UID) session.engineReady = false;
    }
  });
});

httpServer.listen(PORT, () => {
  log("gateway", `asymDOOM gateway listening on http://localhost:${PORT}`);
  startEngine();
});

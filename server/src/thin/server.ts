/** Thin-mode gateway: JSON WS protocol + NativeEmbed (libasymdoom). Sim-only — no SPA. */
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { ThinMatch } from "./match.js";
import { NativeEmbed } from "./nativeEmbed.js";
import { applyCorsHeaders, buildJoinResponse } from "./httpApi.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..", "..");
const ASSETS = path.join(ROOT, "assets");
const PORT = Number(process.env.PORT ?? 8666);
const HOST = process.env.HOST ?? "0.0.0.0";
const SETTINGS_PATH = path.join(ROOT, "server", "settings.json");

const settings = JSON.parse(readFileSync(SETTINGS_PATH, "utf8"));

const ASSET_MIME: Record<string, string> = {
  ".wad": "application/octet-stream",
  ".cfg": "text/plain",
};

function log(tag: string, msg: string) {
  console.log(`[${new Date().toISOString()}] [${tag}] ${msg}`);
}

/** Serve IWAD / cfg from assets/ only (no SPA). */
function serveAsset(res: http.ServerResponse, urlPath: string) {
  const rel = urlPath.replace(/^\/+/, "");
  if (!rel || rel.includes("..") || rel.includes("/")) {
    res.writeHead(404).end("not found");
    return;
  }
  const file = path.join(ASSETS, rel);
  if (!existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404).end("not found");
    return;
  }
  const ext = path.extname(file);
  const immutable = ext === ".wad";
  res.writeHead(200, {
    "Content-Type": ASSET_MIME[ext] ?? "application/octet-stream",
    "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
  });
  res.end(readFileSync(file));
}

const MARINE_DEATH_CODE: Record<string, number> = {
  demons_win: 0,
  respawn_as_killer: 1,
  marine_respawn: 2,
};

const thinSettings = {
  skill: settings.skill,
  episode: settings.episode,
  map: settings.map,
  onMarineDeath: settings.onMarineDeath,
  demonView: settings.demonView ?? "first_person",
};

function makeEmbed() {
  return new NativeEmbed({
    skill: thinSettings.skill,
    episode: thinSettings.episode,
    map: thinSettings.map,
    marineDeath: MARINE_DEATH_CODE[thinSettings.onMarineDeath] ?? 0,
  });
}

const match = new ThinMatch(thinSettings, makeEmbed(), makeEmbed);

const httpServer = http.createServer((req, res) => {
  const urlPath = new URL(req.url ?? "/", "http://x").pathname;

  if (req.method === "OPTIONS") {
    if (applyCorsHeaders(req, res)) {
      res.writeHead(204).end();
    } else {
      res.writeHead(403).end();
    }
    return;
  }

  applyCorsHeaders(req, res);

  if (urlPath === "/health" && req.method === "GET") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (urlPath === "/api/join" && req.method === "POST") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(buildJoinResponse(req, settings)));
    return;
  }
  if (urlPath === "/api/reset" && req.method === "POST") {
    for (const [id] of [...match.sessions.keys()]) match.leave(id);
    match.recreate();
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (urlPath === "/api/session") {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        mode: "thin",
        players: match.sessions.size,
        settings,
      }),
    );
    return;
  }
  if (urlPath === "/api/debug/sim" && req.method === "GET") {
    res.setHeader("Content-Type", "application/json");
    try {
      const dump = match.embed.debugSim?.() ?? { error: "debugSim unavailable" };
      res.end(
        JSON.stringify({
          ok: true,
          players: match.sessions.size,
          settings: thinSettings,
          sim: dump,
        }),
      );
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ ok: false, error: String(err) }));
    }
    return;
  }
  if (urlPath === "/doom1.wad" || urlPath === "/default.cfg") {
    serveAsset(res, urlPath);
    return;
  }
  res.writeHead(404).end("not found");
});

const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

wss.on("connection", (ws, req) => {
  const resumeId = new URL(req.url ?? "/", "http://x").searchParams.get("sessionId");
  const sessionId = match.join(ws, resumeId);
  log(
    "thin",
    `session ${sessionId} ${resumeId && resumeId === sessionId ? "resumed" : "joined"} (${match.sessions.size} players)`,
  );

  ws.on("message", (data) => {
    try {
      const text = typeof data === "string" ? data : data.toString("utf8");
      match.onMessage(sessionId, JSON.parse(text));
    } catch (err) {
      log("thin", `bad message from ${sessionId}: ${err}`);
    }
  });

  ws.on("close", () => {
    match.disconnect(sessionId, ws);
    log("thin", `session ${sessionId} disconnected (${match.sessions.size} players)`);
  });
});

httpServer.listen(PORT, HOST, () => {
  log("gateway", `asymDOOM thin host on http://${HOST}:${PORT}`);
});

export { match };

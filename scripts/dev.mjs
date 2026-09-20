#!/usr/bin/env node
/**
 * Dev: native-backed thin host + Vite HMR client.
 * Open the Vite URL printed below — it proxies /api and /ws to the host.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const kids = [];

function canListen(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.once("listening", () => s.close(() => resolve(true)));
    // Bind all interfaces so we detect IPv6-only listeners too.
    s.listen(port);
  });
}

async function pickPort(preferred) {
  if (await canListen(preferred)) return preferred;
  for (let p = preferred + 1; p < preferred + 20; p++) {
    if (await canListen(p)) return p;
  }
  throw new Error(`no free port near ${preferred}`);
}

function run(name, args, env = {}) {
  const child = spawn("npm", args, {
    stdio: "inherit",
    env: { ...process.env, ...env },
    shell: false,
  });
  kids.push(child);
  child.on("exit", (code, signal) => {
    if (signal) return;
    console.error(`[dev] ${name} exited (${code})`);
    shutdown(code ?? 1);
  });
  return child;
}

function shutdown(code = 0) {
  for (const c of kids) {
    try {
      c.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

const hostPort = await pickPort(Number(process.env.PORT ?? 8666));
const webPort = await pickPort(5173);
const api = `http://127.0.0.1:${hostPort}`;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

console.log(`[dev] host  ${api}  (all interfaces)`);
console.log(`[dev] client http://0.0.0.0:${webPort}  (open this for HMR; LAN clients use this host's IP)`);
if (hostPort !== 8666) {
  console.log(`[dev] note: :8666 busy — thin host using :${hostPort}`);
}

// Ensure contracts package is built for server/web imports.
{
  const r = spawnSync("npm", ["run", "build:contracts"], { cwd: repoRoot, stdio: "inherit" });
  if (r.status !== 0) {
    console.error("[dev] build:contracts failed");
    process.exit(r.status ?? 1);
  }
}

// Ensure WASM viewer artifacts exist for the default renderer.
const wasmJs = path.join(repoRoot, "web/public/asym_view_4x.js");
if (!existsSync(wasmJs)) {
  console.log("[dev] building WASM viewer (web/public/asym_view_4x.js missing)…");
  const r = spawnSync("npm", ["run", "build:wasm"], { cwd: repoRoot, stdio: "inherit" });
  if (r.status !== 0) {
    console.warn("[dev] build:wasm failed — install emcc / Emscripten SDK");
  }
}

run("server", ["run", "dev", "-w", "server"], {
  PORT: String(hostPort),
  NODE_ENV: "development",
});
run("web", ["run", "dev", "-w", "web", "--", "--host", "0.0.0.0", "--port", String(webPort)], {
  ASYM_API: api,
  // App uses VITE_ASYM_API (cross-origin to host); Vite proxy is optional fallback.
  VITE_ASYM_API: api,
});

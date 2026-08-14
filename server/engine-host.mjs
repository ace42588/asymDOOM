// Headless host for the WASM engine under Node.
// Usage: node engine-host.mjs <path/to/websockets-doom.js> [engine args...]
//
// Emscripten reads program arguments from process.argv.slice(2) at import
// time, so rewrite argv to look like `node websockets-doom.js <args>` before
// importing the engine module.

const [, , enginePath, ...engineArgs] = process.argv;

if (!enginePath) {
  console.error("usage: node engine-host.mjs <websockets-doom.js> [args...]");
  process.exit(2);
}

if (typeof globalThis.WebSocket === "undefined") {
  const { WebSocket } = await import("ws");
  globalThis.WebSocket = WebSocket;
}

process.argv = [process.argv[0], enginePath, ...engineArgs];

await import(enginePath);

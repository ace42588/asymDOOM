import { defineConfig } from "vite";

// Production: the gateway serves web/dist plus the engine artifacts and IWAD
// from one origin. Dev: `vite dev` proxies API/relay/engine files to the
// gateway on :8666.
export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/api": "http://localhost:8666",
      "/ws": { target: "ws://localhost:8666", ws: true },
      "/websockets-doom.js": "http://localhost:8666",
      "/websockets-doom.wasm": "http://localhost:8666",
      "/websockets-doom.wasm.map": "http://localhost:8666",
      "/doom1.wad": "http://localhost:8666",
      "/default.cfg": "http://localhost:8666",
    },
  },
});

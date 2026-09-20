import { defineConfig } from "vite";

const apiTarget = process.env.ASYM_API ?? process.env.VITE_ASYM_API ?? "http://localhost:8666";
const wsTarget = apiTarget.replace(/^http/, "ws");

// Production: client is GitHub Pages; sim is a separate origin (VITE_ASYM_API).
// Dev: `vite dev` proxies API/WS/IWAD for convenience; the app still uses VITE_ASYM_API.
export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    headers: {
      "Cache-Control": "no-store",
    },
    proxy: {
      "/api": apiTarget,
      "/ws": { target: wsTarget, ws: true },
      "/doom1.wad": apiTarget,
      "/default.cfg": apiTarget,
    },
  },
});

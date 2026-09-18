import { defineConfig } from "vite";

const apiTarget = process.env.ASYM_API ?? "http://localhost:8666";
const wsTarget = apiTarget.replace(/^http/, "ws");

// Production: the gateway serves web/dist plus assets from one origin.
// Dev: `vite dev` proxies API/WS/IWAD to the thin host (ASYM_API, default :8666).
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

# asymDOOM

Asymmetrical DOOM: one marine vs player-possessed demons. Authoritative **native** sim (`libasymdoom`) + thin clients over a JSON WebSocket protocol.

## Architecture

- **Host** (`server/`): Node gateway loads `native/build/libasymdoom` via koffi, runs the match tick, possession policy, and delta snapshots. Serves `/api`, `/ws`, `/health`, and `/doom1.wad` only (no SPA).
- **Native** (`native/`): Vendored doomgeneric (headless) + actor/controller layer + asym possession rules. Builds `libasymdoom` (host) and optionally `asym_view` WASM (web viewer).
- **Web client** (`web/`): Thin browser client — intent in, WASM BSP view + TS HUD. Shipped on **GitHub Pages**; talks to the sim via `VITE_ASYM_API`.
- **Contracts** (`contracts/`): JSON Schema, fixtures, `PROTOCOL_VERSION`, and URL helpers shared by all thin clients.

Authoritative sim stays on the host. The browser WASM module is a **viewer only** (no client-side game ticks). See [docs/clients.md](docs/clients.md) for writing additional clients (Android, native).

## Requirements

- Node 22+
- clang (macOS/Linux) to build the native library
- **Emscripten (`emcc`)** to build the client WASM viewer (`npm run build:wasm`) — web client only
- `assets/doom1.wad` (shareware IWAD ships in-repo; served by the host, not Pages)

## Quick start (local)

```bash
npm install
npm run build:native   # libasymdoom
npm run build:wasm     # once (or after native render changes)
npm run dev            # host :8666 + Vite HMR client
```

Open **http://127.0.0.1:5173** (Vite). The client uses `VITE_ASYM_API` pointing at the host; CORS allows the Vite origin in development.

Open two browser tabs: first join is the marine, later joins possess demons.

**Host only** (no web UI — for Coolify / API smoke):

```bash
npm run build:native && npm run build:server
npm start              # http://localhost:8666  (/health, /api, /ws, /doom1.wad)
```

## Production

| Artifact | Where | Contents |
| --- | --- | --- |
| Host image | Coolify ← GHCR (`docker.yml`) | Node + `libasymdoom` + IWAD |
| Web client | GitHub Pages (`pages.yml`) | Vite `web/dist` + `asym_view_*` (no WAD) |

Configure:

1. Repository **variable** `VITE_ASYM_API` = public sim origin (e.g. `https://sim.example.com`).
2. Coolify / compose: `SIM_PUBLIC_URL` (same origin), `CORS_ORIGINS` = Pages Origin (e.g. `https://<user>.github.io`).
3. GitHub → Settings → Pages → Source = **GitHub Actions**.

External proxy should route only sim traffic (`/api`, `/ws`, `/health`, `/doom1.wad`) to Coolify `:8666`. The website is Pages.

## Controls

| Key | Action |
| --- | --- |
| WASD | Move / strafe |
| Arrow left/right | Turn |
| Arrow up/down | Walk forward/back |
| Mouse | Look |
| Shift | Run |
| Space / Ctrl / LMB | Fire / attack |
| E / F | Use (doors, switches) |
| 1–8 | Select weapon (marine) / buy mods 1–4 (demon) |
| Mouse wheel | Next / previous weapon (marine) |
| 5 | Hop (demon) |
| P | Possess (spectator) |
| [ / ] | Follow prev/next (spectator) |

## Tests

```bash
npm run build:native
npm run build:wasm     # required for web WASM viewer tests
npm test               # contracts → native → server → web
```

CI uses path filters so web-only PRs skip clang and (when WASM is cached) Emscripten — see `.github/workflows/thin-client.yml`.

## Playtest checklist

See [docs/thin-playtest.md](docs/thin-playtest.md).

## Render validation

- Contract + scene catalog: [docs/render-contract.md](docs/render-contract.md)
- Defect inventory: [docs/render-defects.md](docs/render-defects.md)
- WASM viewer smoke: `npm run test -w web` (`web/src/test/wasm-view.test.ts`)

## Protocol

See [contracts/PROTOCOL.md](contracts/PROTOCOL.md) and [docs/clients.md](docs/clients.md).

## License

GPLv2 — see [LICENSE](LICENSE) and [AUTHORS.md](AUTHORS.md). `native/engine/` is doomgeneric (Chocolate Doom lineage). `assets/doom1.wad` is the DOOM shareware IWAD (redistributable under id Software’s shareware terms).

# asymDOOM

Asymmetrical DOOM: one marine vs player-possessed demons. Authoritative **native** sim (`libasymdoom`) + thin browser clients over a JSON WebSocket protocol.

## Architecture

- **Host** (`server/`): Node gateway loads `native/build/libasymdoom` via koffi, runs the match tick, possession policy, and delta snapshots.
- **Native** (`native/`): Vendored doomgeneric (headless) + actor/controller layer + asym possession rules. Builds `libasymdoom`.
- **Client** (`web/`): Thin client — intent in, **WASM BSP view** (`asym_view`, native `R_RenderPlayerView`) + TS HUD overlays.
- **Contracts** (`contracts/`): JSON Schema + fixtures for the wire protocol.

Authoritative sim stays on the host. The browser WASM module is a **viewer only** (no client-side game ticks).

## Requirements

- Node 22+
- clang (macOS/Linux) to build the native library
- **Emscripten (`emcc`)** to build the client WASM viewer (`npm run build:wasm`)
- `assets/doom1.wad` (shareware IWAD ships in-repo)

## Quick start

```bash
npm install
npm run build:native   # libasymdoom
npm run build:web      # WASM viewer + production client bundle
npm start              # http://localhost:8666
```

**Dev (API watch + Vite HMR):**

```bash
npm run build:native
npm run build:wasm     # once (or after native render changes)
npm run dev
```

Open **http://127.0.0.1:5173** (Vite). It proxies `/api` and `/ws` to the host on `:8666`, so client edits hot-reload while the native sim keeps running.

Open two browser tabs: first join is the marine, later joins possess demons.

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

CI runs the same sequence (see `.github/workflows/thin-client.yml`).

## Playtest checklist

See [docs/thin-playtest.md](docs/thin-playtest.md).

## Render validation

- Contract + scene catalog: [docs/render-contract.md](docs/render-contract.md)
- Defect inventory: [docs/render-defects.md](docs/render-defects.md)
- WASM viewer smoke: `npm run test -w web` (`web/src/test/wasm-view.test.ts`)

## Protocol

See [contracts/PROTOCOL.md](contracts/PROTOCOL.md).

## License

GPLv2 — see [LICENSE](LICENSE) and [AUTHORS.md](AUTHORS.md). `native/engine/` is doomgeneric (Chocolate Doom lineage). `assets/doom1.wad` is the DOOM shareware IWAD (redistributable under id Software’s shareware terms).

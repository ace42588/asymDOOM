# asymDOOM

Asymmetrical multiplayer DOOM. A headless dedicated server runs the lockstep
netgame; all UI and input live in players' browsers.

- The **first player** to connect plays the DOOM marine.
- Every later player **possesses a living demon** already on the map. Demons
  keep their vanilla base attributes; players earn points and buy modifiers
  (health, speed, damage, attack rate) that improve their current body.
- When a possessed demon dies, the player hops to the next valid demon; if
  none remain, they spectate through the marine's eyes.
- The marine is always first person. Possessed demons use first person or a
  chase camera, chosen by `server/settings.json` (`demonView`).
- When the marine dies, the demons win. When the marine exits the level, the
  marine wins.
- Players can join a session already in progress; unpossessed demons run
  normal AI.

## Layout

| Path | What it is |
| --- | --- |
| `engine/` | Chocolate Doom fork (lineage: cloudflare/doom-wasm). Compiled once to WASM; runs in every browser and, headless with `-dedicated`, under Node as the lockstep coordinator. |
| `server/` | TypeScript gateway: HTTP static hosting, session/role API, WebSocket packet relay (uid routing), spawns the dedicated engine. No game logic. |
| `web/` | Vite browser client: canvas, pointer lock input, HTML HUD overlay. |
| `assets/doom1.wad` | Shareware DOOM episode 1 IWAD (redistributable). |

## Prerequisites

```sh
brew install emscripten autoconf automake pkg-config
```

Node 21+ (global `WebSocket` is required for the headless engine).

## Build and run

```sh
npm install
npm run build          # engine (emscripten) + web client
npm start              # gateway on http://localhost:8666
```

Open `http://localhost:8666` in a browser: the match starts immediately and
you are the marine. Open more tabs/browsers: each joins as a demon.

## Engine fork notes

Networking is vanilla Chocolate Doom lockstep over WebSockets. The gateway
relays packets addressed by uint32 uid (`[to:4][from:4][payload]`, delivered
as `[from:4][payload]`); the dedicated engine is always uid `1`. Asymmetric
game rules live in `engine/src/doom/asym.[ch]` plus focused hooks in the
vanilla files, all guarded by net-transmitted game settings so every peer
stays deterministic.

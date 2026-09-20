# Thin clients

The sim host is a standalone multiplayer origin. Every client (GitHub Pages web, future Android / native) uses the same three URLs.

## 1. Configure the sim base URL

Set an absolute HTTP(S) origin for the host, e.g. `https://sim.example.com` (no trailing slash).

| Client | How |
| --- | --- |
| Web (dev) | `scripts/dev.mjs` sets `VITE_ASYM_API` |
| Web (Pages) | GitHub Actions repository **variable** `VITE_ASYM_API` |
| Android / native | Build-time or runtime config pointing at the same origin |

Helpers live in `asymdoom-contracts`: `joinUrl`, `wsUrl`, `wadUrl`, `withSessionId`.

## 2. Join

```http
POST {sim}/api/join
```

Response (`contracts/schemas/protocol/join.schema.json`):

```json
{
  "protocolVersion": 1,
  "mode": "thin",
  "wsUrl": "wss://sim.example.com/ws",
  "wadUrl": "https://sim.example.com/doom1.wad",
  "settings": { }
}
```

`wsUrl` and `wadUrl` are **absolute**. Do not invent paths from the page origin.

## 3. Connect and load assets

1. Open `wsUrl` (append `?sessionId=` to resume a sticky session; persist the id in client-local storage).
2. Fetch `wadUrl` for the shareware IWAD, **or** bundle `doom1.wad` in the app. The IWAD is never published to GitHub Pages.
3. Speak JSON over the WebSocket per [contracts/PROTOCOL.md](../contracts/PROTOCOL.md).

## 4. Protocol versioning

Bump `protocolVersion` in `contracts/` together with host and every client. Additive fields can roll host-first; breaking changes need a coordinated bump.

JSON Schemas and fixtures under `contracts/` are the source of truth. TypeScript clients import `asymdoom-contracts`. Kotlin/C++ clients should generate types from the schemas or hand-mirror them.

## 5. Rendering is client-specific

The web client uses a WASM BSP viewer (`asym_view_*`) plus TS HUD. Other clients implement their own view from the same snapshot fields (see [render-contract.md](./render-contract.md)). Do not require Emscripten for Android/native.

## Host CORS

Browsers on a different origin (Pages) need the host to allow their Origin via `CORS_ORIGINS` (comma-separated). Native apps ignore CORS. Dev defaults allow Vite on `:5173` when `NODE_ENV !== "production"`.

Set `SIM_PUBLIC_URL` on the host so join returns the public `wss://` / `https://` URLs behind a reverse proxy.

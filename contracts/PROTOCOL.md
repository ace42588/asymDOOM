# asymDOOM thin-client protocol

`protocolVersion: 1` (pre-release). JSON over WebSocket. The sim host is a **standalone origin**; clients (web / Android / native) configure an absolute sim base URL and never infer it from the page host.

## Join sequence

1. Client `POST {sim}/api/join` → absolute join response (see `schemas/protocol/join.schema.json`):

   ```json
   {
     "protocolVersion": 1,
     "mode": "thin",
     "wsUrl": "wss://sim.example.com/ws",
     "wadUrl": "https://sim.example.com/doom1.wad",
     "settings": { }
   }
   ```

2. Client opens WebSocket to `wsUrl`, or `wsUrl` with `?sessionId=<id>` to resume a sticky session after reload (`withSessionId` in `asymdoom-contracts`).
3. Server sends `welcome`, then a full `snapshot` (actors in `spawn`).
4. Client fetches `wadUrl` for the shareware IWAD (or bundles it). The IWAD is **not** shipped with the GitHub Pages client.

TypeScript helpers: `joinUrl`, `wsUrl`, `wadUrl`, `withSessionId` from `asymdoom-contracts`.

### Migration note

Earlier builds returned relative `wsPath: "/ws"` and assumed same-origin HTML. That field is removed; use absolute `wsUrl` / `wadUrl` only.

### Sticky sessions

- `welcome.sessionId` is the controller identity. Clients should persist it in **client-local storage** (web: `sessionStorage`, tab-scoped) and pass it back on the next WebSocket URL.
- On disconnect the host **parks** the native controller (~30s grace) instead of freeing it immediately, so role, body, points, and mods survive a page reload.
- Resume succeeds only while that session still exists (live or parked). Unknown / expired / post-`/api/reset` ids mint a new session; the client overwrites storage from the new `welcome`.
- A second browser tab without the same `sessionStorage` is a new player.

## Round reload sequence

1. Server emits `notice` (`round_restart`) then later `mapLoad`.
2. Client loads assets / resets local world and replies `mapLoadComplete`.
3. Server sends a full `snapshot` (baselines cleared).

## Client → server

| type | purpose |
| --- | --- |
| `input` | Intent + hop/possess flags each tick |
| `mapLoadComplete` | Ack after `mapLoad` |

Intent fields: `forward` / `strafe` in **[-1, 1]** (normalized axes), `turnDelta` (look delta), `run`, `fire`, `use`, optional `lookFly`, `arti`. The host scales axes to ticcmd magnitudes using `run`.

`use` is role-dependent:

| role | effect |
| --- | --- |
| marine | doors / switches (`P_UseLines`) |
| demon | if a special line is ahead within use range → doors / switches; else consume nearest edible within use range (see below). |

Demon consume targets (nearest in use range):

| target | points | health | event `reason` |
| --- | --- | --- | --- |
| Kill corpse (`MF_CORPSE`) | **+25** | **+10 HP over 5s** (stackable HoT) | `consume` |
| Map gore prop (dead bodies / gibs) | **+10** | none | `scavenge` |

Both remove the target and emit a `points` event.

`arti` is role-dependent:

| value | marine | demon |
| --- | --- | --- |
| 1–4 | select weapon 1–4 | buy health / speed / damage / rate |
| 5 | weapon 5 (rocket) | hop |
| 6–8 | select weapon 6–8 | ignored |
| 9 | next owned weapon | ignored |
| 10 | previous owned weapon | ignored |

## Server → client

| type | purpose |
| --- | --- |
| `welcome` | Role, sessionId, mapName, tickRateHz, settings |
| `snapshot` | Delta world state + events |
| `roleChange` | Role / body change |
| `mapLoad` | Engine map readiness — reload client world |
| `notice` | Idle release, round restart, errors |
| `bye` | Disconnect |

### Snapshot fields

- `mapName` (required) — e.g. `E1M1`
- `actors` / `projectiles` / `doors` / `movers` — entity deltas (`spawn` / `update` / `despawn`)
- `marine` — optional vitals `{ health, armor, ammo, weapon }` when role is marine
- `events` — `possess`, `release`, `hop`, `hopfail`, `spectate`, `points`, `mods`, `pain`, `marineKill`, `roundReload`, `mapLoaded`, `secret`, `sound`

Door entries: `{ id, state, position }` where `state` is
`open` | `closed` | `opening` | `closing` | `waiting` (plus optional x/y/z).
Mover entries (plats / floors / ceilings): `{ id, kind, state, floor, ceiling }` where
`kind` is `plat` | `floor` | `ceiling` and `state` is `waiting` | `up` | `down`.
Projectile entries: `{ id, type, x, y, z, angle, … }` plus optional `sprite` / `frame`
(also carries short-lived combat FX: puff / blood).

`sound` events: `{ kind: "sound", sound: "<sfx name>", x?, y?, z? }`. The sim emits
leftover cues that clients cannot reconstruct from entity deltas (switches, pain,
see/idle, hitscan, etc.). Doors, plats, projectile spawn/explode, deaths, and
pickups are inferred client-side and are **not** sent.

Schemas live under `contracts/schemas/`; fixtures under `contracts/fixtures/{valid,invalid}/`.

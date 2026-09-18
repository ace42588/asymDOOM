# Thin-client render contract

Validation layers (in order):

1. **L1 — Protocol fidelity** — if a snapshot field exists (`actors`, `projectiles`, `doors`/`movers`, `marine`, `events`), the canvas must show it. Camera pose, species, sprite/frame, openings, vitals, and projectiles come from the wire.
2. **L2 — Recognizable Doom** — where the protocol is silent, match shareware look-and-feel (SKY1, COLORMAP, DONTPEGTOP, animated nukage, spectre fuzz, pain flash). Not pixel-identical to Chocolate Doom.

## World renderer

World blit is the **WASM BSP viewer** (`asym_view`): native `R_RenderPlayerView` driven by protocol pose / movers / actors. HUD (STBAR, weapon overlay, demon bar, minimap) stays in TypeScript.

## Hybrid world data

| Source | Responsibility |
| --- | --- |
| **Protocol** | Moving sectors (doors, plats, floors, ceilings), living/dead actors, pickups, consumable gore props (dead bodies/gibs), missiles, combat FX (puff/blood), marine vitals |
| **Client IWAD (WASM)** | Static map geometry + textures/flats + non-consumable map `THINGS` decorations via `P_SetupLevel`; HUD sprite patches for STBAR/weapons |

Native snapshot actors cover `MT_PLAYER` / `MF_COUNTKILL` / `MF_SHOOTABLE` / `MF_CORPSE` / `MF_SPECIAL` / consumable gore (`MT_MISC61`–`69`, `71`, `84`–`86`). Other decorations stay in the viewer from the map load path.

## Scene catalog (E1M1)

Playtest viewpoints. Expected *facts*, not golden RGB.

| id | Pose (approx) | Expected facts |
| --- | --- | --- |
| `spawn-north` | 1056, −3616, z≈0, 90° | Indoor ceiling (not sky punch); STARTAN walls; floor lit; marine/camera present |
| `spawn-south` | 1056, −3616, 270° | Walls stay filled when walking “back” (y increases while facing south) |
| `hangar` | ~1056, −3300, 90° | Open hangar; armor/clip pickups as sprites when in snapshot |
| `tech-cage` | 2700, −4256, 0° | BRNBIGC mid textures occlude sprites behind bars |
| `courtyard-sky` | spawn looking through first door north | Sky below lintel only; indoor ceiling intact above |
| `raised-ledge` | low side looking at step-up | Portal silhouette open; sprite portal floor ≈ near opening |
| `door-mid` | near a moving door | Sector ceiling matches mover `position`; opening visible |
| `imp-ball` | actor + BAL1 in frustum | Imp TROO billboard; fireball above floor (z≈source+32) |
| `marine-stbar` | marine role, shotgun + keys | STBAR patches; ammo/HP/AR match `marine`; weapon overlay = ready weapon |
| `demon-stbar` | demon role, possessed monster | STBAR chrome; HP% = current/base spawnhealth (can exceed 100); points in AMMO slot; HLTH/SPEED/DAMG/RATE in HEALTH-font; mugshot of possessed sprite |

## Check kinds

- **Occupancy** — wall/floor fill; no void needles at corners
- **Identity** — actors/projectiles/decorations visible when in frustum
- **Geometry** — movers/doors match protocol heights
- **HUD** — STBAR numbers match `marine` vitals; demon bar matches controlled actor HP + points/mods

## Defect inventory

Living list: [render-defects.md](./render-defects.md). File by root cause (protocol / iwad-static / vanilla-look / client-bug), not by screenshot.

# Thin-client playtest checklist

Prereq: `npm run build:native && npm run build:web && npm start`  
(`build:web` runs `build:wasm` — needs [Emscripten](https://emscripten.org/) `emcc` on PATH.)

See also [render-contract.md](./render-contract.md) and [render-defects.md](./render-defects.md).

## Renderer

- **WASM BSP viewer** (`web/public/asym_view_{1,2,4}x.{js,wasm}`) — native `R_RenderPlayerView` at a true 320×200 / 640×400 / 1280×800, protocol-driven pose/movers/actors, TS HUD overlays. Render-scale changes hot-swap the binary.
- Hold **H** for control hints.

## Roles / protocol

- [ ] First client joins as **marine**
- [ ] Reload mid-match reattaches the same role/body; demon **points** are unchanged (sticky session)
- [ ] Snapshot actors match **real E1M1** species (imp, zombieman, … — not a toy 8-body roster)
- [ ] Canvas shows textured walls from IWAD (`E1M1`)
- [ ] Corners / height steps stay closed (vanilla BSP)
- [ ] Second client joins as **demon** and controls a **different** body
- [ ] Both clients can move their bodies independently in the same match
- [ ] Demon hop (`5`) cycles to another free body; cooldown prevents spam
- [ ] Idle (~45s) releases a demon to spectator; `P` re-possesses
- [ ] Marine HUD vitals (HP/AR/AM) update from snapshots; status bar + weapon overlay visible
- [ ] Demon HUD (possessed): PTS / HP% of base (can exceed 100 after health mods) / mugshot / HLTH·SPEED·DAMG·RATE; pain flash on damage
- [ ] Fire (LMB / Space / Ctrl) spends ammo / attacks; puff/blood FX appear on hits
- [ ] E/F opens doors and hits switches; lifts/plats move floors when triggered. Possessed demon: if a special is ahead Use prefers the door/switch; otherwise nearest edible is consumed — kill corpse (+25 pts, +10 HP over 5s stackable) or map dead body/gibs (+10 pts, no heal)
- [ ] 1–8 and mouse wheel change marine weapons (overlay snaps to ready weapon)
- [ ] On marine death (respawn mode): `notice` → `mapLoad` → ack → full snapshot
- [ ] `/api/reset` recreates the native engine instance

## Audio

- [ ] Doors play open/close SFX when used
- [ ] Marine weapons play fire SFX (local prediction + remote via wire)
- [ ] Monster alert / pain / death audible
- [ ] Pickups play item/weapon sounds
- [ ] Switches click (`swtchn` / `swtchx`)
- [ ] Possess / hop plays species see sound
- [ ] Map reload stops lingering loops (plats / floors)

## Scene catalog (visual)

Walk these E1M1 poses (marine, then demon tab, then spectator):

- [ ] **spawn-north** — indoor ceiling intact; STARTAN walls; floor lamps/columns visible
- [ ] **spawn-south** — walk back while facing south; walls stay filled (no void)
- [ ] **hangar** — open area north of spawn; pickups as sprites
- [ ] **tech-cage** — bars occlude sprites behind them
- [ ] **courtyard-sky** — SKY1 through door; indoor ceiling not punched by sky
- [ ] **raised-ledge** — step-up portal; actors not cut in half
- [ ] **door-mid** — opening door changes ceiling; opening visible
- [ ] **imp-ball** — imp + fireball above floor; hitscan shows puff
- [ ] **marine-stbar** — shotgun selected; pain flash when damaged; keys when held
- [ ] **demon-stbar** — possess a body; bar shows species/HP/points/mods; hop updates species

## Recognizable Doom (L2)

- [ ] Dark sectors look darker than bright (COLORMAP)
- [ ] Spectre appears fuzzy / translucent
- [ ] Nukage flats animate when in view

# Render defect inventory

Status: `open` | `in_progress` | `fixed` | `wontfix`

| id | scene | layer | severity | evidence | wave | status |
| --- | --- | --- | --- | --- | --- | --- |
| RD-01 | all | iwad-static | wrong sim read | THINGS decorations loaded + drawn | B | fixed |
| RD-02 | door-mid / raised | protocol | blocks navigation | Native movers (plat/floor/ceiling) + client apply | A | fixed |
| RD-03 | imp-ball / fire | protocol | wrong sim read | Puff/blood as projectiles + sprite/frame on wire | A | fixed |
| RD-04 | courtyard-sky | vanilla-look | cosmetic | SKY1 sampling | C | fixed |
| RD-05 | all | vanilla-look | cosmetic | COLORMAP on walls/flats/sprites; FF_FULLBRIGHT | C | fixed |
| RD-06 | hangar / walls | vanilla-look | cosmetic | ML_DONTPEGTOP on upper textures | C | fixed |
| RD-07 | nukage areas | vanilla-look | cosmetic | ANIMATED flat cycles (NUKAGE etc.) | C | fixed |
| RD-08 | spectre | vanilla-look | cosmetic | MF_SHADOW fuzz blit | C | fixed |
| RD-09 | marine-stbar | mixed | wrong sim read | damagecount → red overlay | D | fixed |
| RD-10 | marine-stbar | mixed | cosmetic | Overlay weapon snaps to marine.weapon | D | fixed |
| RD-12 | tech overhang | client-bug | cosmetic | Upper/lower drew STARTAN2 when texture was `-` → edge streaks | C | fixed |
| RD-13 | fire / puff | client-bug | wrong sim read | Puff despawn played BAL1; type-0 sprite trusted as TROO | A | fixed |
| RD-14 | tech overhang | client-bug | cosmetic | Vertex-graze portal walk entered hang sector the ray never stepped into → 1px TLITE/void needles | C | fixed |
| RD-15 | movers / lifts | client-bug | cosmetic | Wall V pegging ignored vanilla DONTPEGBOTTOM/ceiling anchors → texture flip as floors move or distance changes | C | fixed |
| RD-16 | tech overhang | client-bug | wrong sim read | POV on hang linedef/vertex rejected near hits → infinite floor/ceiling void; corner rays missed both segs | C | fixed |
| RD-17 | fences / grates | client-bug | wrong sim read | 2S mid drew before portal continuation; floor/ceil overwrote masked fence texels | B | fixed |
| RD-18 | movers / plats | client-bug | wrong sim read | applyDoorHeights reset every sector to WAD base each frame → finished lifts snapped back; mover ids were ephemeral | A | fixed |
| RD-19 | slime walkway / steps | client-bug | cosmetic | Corner+height-change rays: short past-eps rejected real portals; vertex ties preferred 2S over 1S solid → 1px void needles | C | fixed |
| RD-20 | corners / windows / CSS | client-bug | cosmetic | Silhouette hairlines: pixel-edge rays + endpoint U texels + fractional CSS pixelated scale; sealed spikes + integer canvas scale | C | fixed |
| RD-21 | convex corners / steps | client-bug | cosmetic | Open corners: rays slipped between segs at shared vertices → far wall/void needles; solid seg extend + vertex skim closer | C | fixed |
| RD-22 | switches | protocol | wrong sim read | Pressed wall-switch textures never left the host; clients kept IWAD SW1* | A | fixed |

Harness: `web/src/test/wasm-view.test.ts` plus the playtest catalog in [thin-playtest.md](./thin-playtest.md). Contract: [render-contract.md](./render-contract.md).

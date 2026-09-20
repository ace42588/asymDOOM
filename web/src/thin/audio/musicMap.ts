/**
 * Map name → IWAD music lump (D_*), matching vanilla S_Start / S_music[].
 */

/** Ultimate Doom E4 reuses earlier tracks (s_sound.c spmus[]). */
const E4_MUSIC = ["e3m4", "e3m2", "e3m3", "e1m5", "e2m7", "e2m4", "e2m6", "e2m5", "e1m9"];

/** Doom II MAP01–MAP32 (mus_runnin … mus_ultima). */
const DOOM2_MUSIC = [
  "runnin",
  "stalks",
  "countd",
  "betwee",
  "doom",
  "the_da",
  "shawn",
  "ddtblu",
  "in_cit",
  "dead",
  "stlks2",
  "theda2",
  "doom2",
  "ddtbl2",
  "runni2",
  "dead2",
  "stlks3",
  "romero",
  "shawn2",
  "messag",
  "count2",
  "ddtbl3",
  "ampie",
  "theda3",
  "adrian",
  "messg2",
  "romer2",
  "tense",
  "shawn3",
  "openin",
  "evil",
  "ultima",
];

/** Vanilla music info name for a map marker (E1M1 / MAP01). */
export function musicNameForMap(mapName: string): string {
  const m = mapName.toUpperCase();
  const em = /^E(\d)M(\d+)$/.exec(m);
  if (em) {
    const ep = Number(em[1]);
    const map = Number(em[2]);
    if (ep >= 4) return E4_MUSIC[map - 1] ?? "e1m1";
    return `e${ep}m${map}`;
  }
  const dm = /^MAP(\d{2})$/.exec(m);
  if (dm) {
    const map = Number(dm[1]);
    return DOOM2_MUSIC[map - 1] ?? "runnin";
  }
  return mapName.toLowerCase();
}

/** IWAD lump for a map, e.g. E1M1 → D_E1M1. */
export function musicLumpName(mapName: string): string {
  const name = musicNameForMap(mapName).toUpperCase().replace(/[^A-Z0-9_]/g, "").slice(0, 6);
  return `D_${name}`;
}

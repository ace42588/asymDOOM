/**
 * DMX decode + snapshot SFX inference.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WadFile } from "../thin/wad/wadFile.ts";
import { decodeDmx, sfxLumpName } from "../thin/audio/dmx.ts";
import { inferSfx, dedupeCues } from "../thin/audio/infer.ts";
import { adjustParams } from "../thin/audio/mixer.ts";
import { createClientState, type Actor, type ClientState } from "../thin/state.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const IWAD = path.join(ROOT, "assets", "doom1.wad");

describe("dmx decode", () => {
  it("maps pistol → DSPISTOL", () => {
    assert.equal(sfxLumpName("pistol"), "DSPISTOL");
    assert.equal(sfxLumpName("doropn"), "DSDOROPN");
  });

  it("decodes DSPISTOL from doom1.wad", () => {
    const wad = WadFile.fromArrayBuffer(readFileSync(IWAD).buffer);
    const bytes = wad.lumpBytes("DSPISTOL");
    const sfx = decodeDmx(bytes);
    assert.equal(sfx.sampleRate, 11025);
    assert.ok(sfx.pcm.length > 1000);
    assert.ok(sfx.pcm.some((s) => Math.abs(s) > 0.01));
  });
});

describe("adjustParams", () => {
  it("full volume when close", () => {
    const adj = adjustParams({ x: 0, y: 0, angle: 0 }, 10, 0);
    assert.ok(adj);
    assert.equal(adj!.vol, 1);
  });

  it("clips when far", () => {
    assert.equal(adjustParams({ x: 0, y: 0, angle: 0 }, 2000, 0), null);
  });
});

function actor(partial: Partial<Actor> & { id: number }): Actor {
  return {
    kind: "monster",
    type: 0,
    x: 0,
    y: 0,
    z: 0,
    angle: 0,
    health: 60,
    controllerSessionId: null,
    ...partial,
  };
}

function withActors(state: ClientState, actors: Actor[]): ClientState {
  const next = {
    ...state,
    entities: {
      actors: new Map(state.entities.actors),
      doors: new Map(state.entities.doors),
      movers: new Map(state.entities.movers),
      projectiles: new Map(state.entities.projectiles),
    },
  };
  for (const a of actors) next.entities.actors.set(a.id, a);
  return next;
}

describe("inferSfx", () => {
  it("plays doropn when door spawns opening", () => {
    const prev = createClientState();
    prev.mapLoading = false;
    // Seed a few actors so empty→full skip does not trigger
    const seeded = withActors(prev, [actor({ id: 1, kind: "marine", typeName: "marine", health: 100 })]);
    const next = {
      ...seeded,
      entities: {
        ...seeded.entities,
        doors: new Map(seeded.entities.doors),
      },
    };
    next.entities.doors = new Map(seeded.entities.doors);
    next.entities.doors.set(3, { id: 3, state: "opening", position: 64, x: 100, y: 200, z: 0 });
    const { cues } = inferSfx(seeded, next);
    assert.ok(cues.some((c) => c.name === "doropn" && c.x === 100));
  });

  it("plays firsht / firxpl for BAL1 spawn and despawn", () => {
    const prev = createClientState();
    const base = withActors(prev, [actor({ id: 1 })]);
    const withBall = {
      ...base,
      entities: {
        ...base.entities,
        projectiles: new Map(base.entities.projectiles),
      },
    };
    // BAL1 is SPRNAMES index 18
    withBall.entities.projectiles.set(9, {
      id: 9,
      type: 1,
      x: 50,
      y: 60,
      z: 32,
      angle: 0,
      sprite: 18,
    });
    const spawnCues = inferSfx(base, withBall).cues;
    assert.ok(spawnCues.some((c) => c.name === "firsht"));

    const after = {
      ...withBall,
      entities: {
        ...withBall.entities,
        projectiles: new Map(),
      },
    };
    const deathCues = inferSfx(withBall, after).cues;
    assert.ok(deathCues.some((c) => c.name === "firxpl"));
  });

  it("plays death sound when health crosses 0", () => {
    const prev = withActors(createClientState(), [
      actor({ id: 2, typeName: "imp", health: 20, x: 1, y: 2 }),
    ]);
    const next = withActors(createClientState(), [
      actor({ id: 2, typeName: "imp", health: 0, x: 1, y: 2 }),
    ]);
    // Keep actor counts similar
    const { cues } = inferSfx(prev, next);
    assert.ok(cues.some((c) => c.name === "bgdth1"));
  });

  it("plays itemup on pickup despawn", () => {
    const prev = withActors(createClientState(), [
      actor({ id: 1 }),
      actor({ id: 5, kind: "item", typeName: "clip", health: 1000, x: 10, y: 20 }),
    ]);
    const next = withActors(createClientState(), [actor({ id: 1 })]);
    const { cues } = inferSfx(prev, next);
    assert.ok(cues.some((c) => c.name === "itemup"));
  });

  it("skips cues on empty → full snapshot", () => {
    const prev = createClientState();
    const actors: Actor[] = [];
    for (let i = 1; i <= 20; i++) actors.push(actor({ id: i }));
    const next = withActors(createClientState(), actors);
    next.entities.doors.set(1, { id: 1, state: "opening", position: 0, x: 0, y: 0 });
    const { cues } = inferSfx(prev, next);
    assert.equal(cues.length, 0);
  });

  it("does not infer pain from HP drop", () => {
    const prev = withActors(createClientState(), [
      actor({ id: 2, typeName: "imp", health: 60 }),
    ]);
    const next = withActors(createClientState(), [
      actor({ id: 2, typeName: "imp", health: 40 }),
    ]);
    const { cues } = inferSfx(prev, next);
    assert.ok(!cues.some((c) => c.name.includes("pain")));
  });

  it("plays see sound on hop event", () => {
    const prev = withActors(createClientState(), [
      actor({ id: 7, typeName: "imp", health: 60, x: 3, y: 4 }),
    ]);
    const next = withActors(createClientState(), [
      actor({ id: 7, typeName: "imp", health: 60, x: 3, y: 4 }),
    ]);
    const { cues } = inferSfx(prev, next, [{ kind: "hop", species: "imp", bodyId: 7 }]);
    assert.ok(cues.some((c) => c.name === "bgsit1"));
  });
});

describe("dedupeCues", () => {
  it("drops wire cue matching inferred name+origin", () => {
    const inferred = [{ name: "pistol", x: 0, y: 0 }];
    const wire = [
      { name: "pistol", x: 10, y: 10 },
      { name: "swtchn", x: 100, y: 100 },
    ];
    const out = dedupeCues(inferred, wire, 64);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.name, "swtchn");
  });
});

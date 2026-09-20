import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { diffActors, diffEntities, isEmptyDelta } from "../thin/deltas.js";
import { parseClientMessage } from "../thin/protocol.js";
import { encodeDoor, encodeDoorState, encodeMover, encodeMoverKind, encodeProjectile, encodeSwitch } from "../thin/wire.js";
import { NativeEmbed } from "../thin/nativeEmbed.js";
import {
  assignOnJoin,
  maybeIdleRelease,
  handleSpectatorPossess,
  IDLE_RELEASE_MS,
} from "../thin/possession.js";

describe("protocol", () => {
  it("rejects bad input", () => {
    const r = parseClientMessage({ type: "input", protocolVersion: 1, seq: 0, input: {} });
    assert.ok("error" in r);
  });
  it("accepts valid input", () => {
    const r = parseClientMessage({
      type: "input",
      protocolVersion: 1,
      seq: 1,
      input: {
        intent: { forward: 1, strafe: 0, turnDelta: 0, run: true, fire: false, use: false },
      },
    });
    assert.ok(!("error" in r));
  });
  it("accepts spectatorFollow", () => {
    const r = parseClientMessage({
      type: "input",
      protocolVersion: 1,
      seq: 5,
      input: {
        intent: { forward: 0, strafe: 0, turnDelta: 0, run: false, fire: false, use: false },
        spectatorFollow: "next",
      },
    });
    assert.ok(!("error" in r));
  });
  it("rejects ticcmd-scale forward (regression: client MUST send [-1,1])", () => {
    const r = parseClientMessage({
      type: "input",
      protocolVersion: 1,
      seq: 1,
      input: {
        intent: { forward: 50, strafe: 0, turnDelta: 0, run: true, fire: false, use: false },
      },
    });
    assert.ok("error" in r);
    assert.match((r as { error: string }).error, /forward|TOO_BIG|less than or equal to 1/i);
  });
  it("rejects strafe out of range", () => {
    const r = parseClientMessage({
      type: "input",
      protocolVersion: 1,
      seq: 1,
      input: {
        intent: { forward: 0, strafe: 40, turnDelta: 0, run: false, fire: false, use: false },
      },
    });
    assert.ok("error" in r);
  });
});

describe("wire encoding", () => {
  it("maps door state codes to schema strings", () => {
    assert.equal(encodeDoorState(0), "closed");
    assert.equal(encodeDoorState(1), "open");
    assert.equal(encodeDoorState(2), "opening");
    assert.equal(encodeDoorState(3), "closing");
    assert.equal(encodeDoorState(4), "waiting");
    assert.equal(encodeDoor({ id: 0, state: 2, position: 32, x: 1, y: 2, z: 3 }).state, "opening");
  });
  it("maps mover kind/state codes to schema strings", () => {
    assert.equal(encodeMoverKind(0), "plat");
    assert.equal(encodeMoverKind(1), "floor");
    assert.equal(encodeMoverKind(2), "ceiling");
    const m = encodeMover({ id: 1, kind: 0, state: 1, floor: 64, ceiling: 128, x: 1, y: 2 });
    assert.equal(m.kind, "plat");
    assert.equal(m.state, "up");
    assert.equal(m.floor, 64);
  });
  it("requires projectile angle on the wire", () => {
    const p = encodeProjectile({ id: 1, type: 33, x: 0, y: 0, z: 0 });
    assert.equal(p.angle, 0);
    assert.equal(encodeProjectile({ id: 2, type: 37, x: 0, y: 0, z: 0, sprite: 17, frame: 0 }).sprite, 17);
  });
  it("passes switch textures through", () => {
    assert.deepEqual(encodeSwitch({ id: 42, top: 0, mid: 87, bot: 12 }), {
      id: 42,
      top: 0,
      mid: 87,
      bot: 12,
    });
  });
});

describe("deltas", () => {
  it("second snapshot empty if unchanged", () => {
    const baseline = new Map<number, string>();
    const actors = [
      {
        id: 1,
        kind: "marine" as const,
        type: 0,
        x: 0,
        y: 0,
        z: 0,
        angle: 0,
        health: 100,
        controllerSessionId: "a",
      },
    ];
    const d1 = diffActors(actors, baseline);
    assert.equal(d1.spawn.length, 1);
    const d2 = diffActors(actors, baseline);
    assert.ok(isEmptyDelta(d2));
  });

  it("death frame changes emit updates", () => {
    const baseline = new Map<number, string>();
    const a = {
      id: 4,
      kind: "monster" as const,
      type: 3001,
      typeName: "imp",
      x: 1,
      y: 2,
      z: 0,
      angle: 0,
      health: 0,
      sprite: 0,
      frame: 8,
      controllerSessionId: null as string | null,
    };
    assert.equal(diffActors([a], baseline).spawn.length, 1);
    const d = diffActors([{ ...a, frame: 9 }], baseline);
    assert.equal(d.update.length, 1);
    assert.equal(d.update[0]!.frame, 9);
  });

  it("door/projectile despawn when gone", () => {
    const baseline = new Map<number, string>();
    const doors = [{ id: 0, state: "open" as const, position: 1 }];
    assert.equal(diffEntities(doors, baseline).spawn.length, 1);
    const gone = diffEntities([], baseline);
    assert.deepEqual(gone.despawn, [0]);
  });
});

describe("possession (native)", () => {
  it("first session marine, second demon", () => {
    const embed = new NativeEmbed({ skill: 3, episode: 1, map: 1 });
    const a = assignOnJoin(embed, "s1", Date.now());
    const b = assignOnJoin(embed, "s2", Date.now());
    assert.equal(a.role, "marine");
    assert.ok(a.controlledId != null && a.controlledId > 0);
    assert.equal(b.role, "demon");
    assert.ok(b.controlledId != null && b.controlledId > 0);
    assert.notEqual(a.controlledId, b.controlledId);
    const snap = embed.snapshot();
    assert.ok(snap.actors.length > 5, "real E1M1 roster");
    assert.equal(snap.mapName, "E1M1");
    assert.deepEqual(snap.switches, []);
    embed.leaveSession("s1");
    embed.leaveSession("s2");
    embed.destroy();
  });

  it("idle release demotes demon", () => {
    const embed = new NativeEmbed({ skill: 3, episode: 1, map: 1 });
    assignOnJoin(embed, "m", Date.now());
    const d = assignOnJoin(embed, "d", Date.now());
    assert.equal(d.role, "demon");
    const released = maybeIdleRelease(embed, d, d.lastInputAt + IDLE_RELEASE_MS + 1);
    assert.equal(released, true);
    assert.equal(d.role, "spectator");
    embed.leaveSession("m");
    embed.leaveSession("d");
    embed.destroy();
  });

  it("spectator possess claims body", () => {
    const embed = new NativeEmbed({ skill: 3, episode: 1, map: 1 });
    assignOnJoin(embed, "m", Date.now());
    const d = assignOnJoin(embed, "d", Date.now());
    embed.release("d");
    d.role = "spectator";
    d.controlledId = null;
    const ok = handleSpectatorPossess(embed, d, null);
    assert.equal(ok, true);
    assert.equal(d.role, "demon");
    embed.leaveSession("m");
    embed.leaveSession("d");
    embed.destroy();
  });

  it("hop via arti changes body", () => {
    const embed = new NativeEmbed({ skill: 3, episode: 1, map: 1 });
    assignOnJoin(embed, "m", Date.now());
    assignOnJoin(embed, "d", Date.now());
    const before = embed.body("d")!;
    embed.submitInput("d", {
      forward: 0,
      strafe: 0,
      turnDelta: 0,
      run: false,
      fire: false,
      use: false,
      arti: 5,
    });
    embed.tick();
    const after = embed.body("d")!;
    assert.notEqual(before, after);
    embed.leaveSession("m");
    embed.leaveSession("d");
    embed.destroy();
  });

  it("marine fire spends ammo and arti 1 selects fist", () => {
    const embed = new NativeEmbed({ skill: 3, episode: 1, map: 1 });
    assignOnJoin(embed, "m", Date.now());
    const ammo0 = embed.marineVitals?.("m")?.ammo ?? 0;
    assert.ok(ammo0 > 0, "marine vitals available");
    for (let i = 0; i < 70; i++) {
      embed.submitInput("m", {
        forward: 0,
        strafe: 0,
        turnDelta: 0,
        run: false,
        fire: true,
        use: false,
      });
      embed.tick();
    }
    const ammo1 = embed.marineVitals?.("m")?.ammo ?? 0;
    assert.ok(ammo1 < ammo0, `ammo ${ammo0} -> ${ammo1}`);
    embed.submitInput("m", {
      forward: 0,
      strafe: 0,
      turnDelta: 0,
      run: false,
      fire: false,
      use: false,
      arti: 1,
    });
    for (let i = 0; i < 40; i++) {
      if (i === 1) {
        embed.submitInput("m", {
          forward: 0,
          strafe: 0,
          turnDelta: 0,
          run: false,
          fire: false,
          use: false,
        });
      }
      embed.tick();
    }
    assert.equal(embed.marineVitals?.("m")?.weapon, 0);
    embed.leaveSession("m");
    embed.destroy();
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createClientState, createEntityMap, reduceServerMessage, PROTOCOL_VERSION } from "../thin/state.js";
import {
  clampAxis,
  composeIntent,
  touchSetStick,
  touchSetRun,
  touchSetLookStick,
  touchAddLook,
  touchDxToTurnDelta,
  gyroRateToTurnDelta,
  sampleIntent,
  buildInputMessage,
  LOOK_SENS,
  KEY_TURN_RATE,
  LOOK_STICK_RATE,
  TOUCH_LOOK_REF_FRAC,
  TURN_DELTA_180,
  effectiveLookSens,
} from "../thin/input.js";
import {
  STORAGE_KEY,
  loadClientSettings,
  setClientSettings,
} from "../thin/clientSettings.js";
import { yawRateFromRotation } from "../thin/gyro.js";

function installMemoryStorage() {
  const map = new Map<string, string>();
  (globalThis as { localStorage?: object }).localStorage = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      map.set(k, String(v));
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => map.clear(),
  };
}

describe("touch / gyro look math", () => {
  it("touchDxToTurnDelta: ref swipe at sens 1 ≈ 180°", () => {
    const vw = 400;
    const dx = TOUCH_LOOK_REF_FRAC * vw;
    const delta = touchDxToTurnDelta(dx, vw, 1);
    assert.ok(Math.abs(delta + TURN_DELTA_180) < 1e-9);
    // Host ×800 → 32768 angleturn = half circle
    assert.equal(Math.round(Math.abs(delta) * 800), 32768);
  });

  it("touchDxToTurnDelta scales with touchLookSens", () => {
    const a = touchDxToTurnDelta(10, 400, 1);
    const b = touchDxToTurnDelta(10, 400, 2);
    assert.equal(b, a * 2);
  });

  it("gyroRateToTurnDelta: 180 deg over 1s at sens 1 = 180° wire", () => {
    const d = gyroRateToTurnDelta(180, 1, 1);
    assert.ok(Math.abs(d + TURN_DELTA_180) < 1e-9);
    assert.equal(gyroRateToTurnDelta(0, 1, 1), 0);
    assert.equal(gyroRateToTurnDelta(90, 0, 1), 0);
  });

  it("yawRateFromRotation picks axis by orientation angle", () => {
    assert.equal(yawRateFromRotation(1, 2, 3, 0), 3);
    assert.equal(yawRateFromRotation(1, 2, 3, 90), -1);
    assert.equal(yawRateFromRotation(1, 2, 3, 270), 1);
    assert.equal(yawRateFromRotation(1, 2, 3, 180), -3);
  });
});

describe("intent axes (protocol [-1,1])", () => {
  it("composeIntent clamps oversized forward/strafe", () => {
    const intent = composeIntent({ forward: 50, strafe: -40, run: true });
    assert.equal(intent.forward, 1);
    assert.equal(intent.strafe, -1);
    assert.equal(intent.run, true);
  });

  it("clampAxis matches schema bounds", () => {
    assert.equal(clampAxis(2), 1);
    assert.equal(clampAxis(-2), -1);
    assert.equal(clampAxis(0), 0);
  });

  it("touch stick samples stay within [-1,1]", () => {
    touchSetStick(1, -1);
    const { intent } = sampleIntent();
    assert.ok(intent.forward >= -1 && intent.forward <= 1);
    assert.ok(intent.strafe >= -1 && intent.strafe <= 1);
    touchSetStick(0, 0);
  });

  it("look stick full deflection ≈ KEY_TURN_RATE × lookStickSens", () => {
    installMemoryStorage();
    localStorage.removeItem(STORAGE_KEY);
    loadClientSettings();
    setClientSettings({ lookStickSens: 1 });
    touchSetLookStick(0);
    sampleIntent(); // clear any leftover turnAccum
    touchSetLookStick(1);
    const { intent } = sampleIntent();
    assert.ok(Math.abs(intent.turnDelta - LOOK_STICK_RATE) < 1e-9);
    assert.equal(LOOK_STICK_RATE, KEY_TURN_RATE);
    touchSetLookStick(0);
    assert.equal(sampleIntent().intent.turnDelta, 0);
    setClientSettings({ lookStickSens: 2 });
    touchSetLookStick(1);
    assert.ok(Math.abs(sampleIntent().intent.turnDelta - LOOK_STICK_RATE * 2) < 1e-9);
    touchSetLookStick(0);
    sampleIntent();
  });

  it("touchAddLook uses touchLookSens not mouse LOOK_SENS", () => {
    installMemoryStorage();
    localStorage.removeItem(STORAGE_KEY);
    loadClientSettings();
    setClientSettings({ lookSens: 1, touchLookSens: 1 });
    sampleIntent();
    const vw = typeof window !== "undefined" && window.innerWidth > 0 ? window.innerWidth : 390;
    const dx = TOUCH_LOOK_REF_FRAC * vw;
    touchAddLook(dx);
    const { intent } = sampleIntent();
    assert.ok(Math.abs(intent.turnDelta + TURN_DELTA_180) < 1e-6);
    // Mouse path still uses LOOK_SENS
    assert.equal(effectiveLookSens(), LOOK_SENS);
  });

  it("run multiplies on host side only — client keeps axis at 1", () => {
    const walk = composeIntent({ forward: 1, run: false });
    const run = composeIntent({ forward: 1, run: true });
    assert.equal(walk.forward, run.forward);
    assert.equal(walk.forward, 1);
    assert.notEqual(walk.run, run.run);
  });

  it("defaults to walk — touchRun must not force always-run on keyboard", () => {
    touchSetRun(false);
    touchSetStick(0, 0);
    assert.equal(sampleIntent().intent.run, false);
    touchSetRun(true);
    assert.equal(sampleIntent().intent.run, true);
    touchSetRun(false);
  });

  it("buildInputMessage omits idle hop/possess flags", () => {
    const msg = buildInputMessage(0, {
      intent: composeIntent({}),
      bodySwap: false,
      spectatorPossess: false,
      spectatorFollow: null,
    });
    assert.equal(msg.type, "input");
    assert.equal(msg.protocolVersion, PROTOCOL_VERSION);
    const input = msg.input as Record<string, unknown>;
    assert.ok(input.intent);
    assert.equal("bodySwap" in input, false);
    assert.equal("spectatorPossess" in input, false);
    assert.equal("spectatorFollow" in input, false);
  });

  it("buildInputMessage includes hop and follow when set", () => {
    const msg = buildInputMessage(3, {
      intent: composeIntent({ arti: 5 }),
      bodySwap: true,
      spectatorPossess: false,
      spectatorFollow: "next",
    });
    const input = msg.input as Record<string, unknown>;
    assert.deepEqual(input.bodySwap, { targetId: null });
    assert.equal(input.spectatorFollow, "next");
  });

  it("composeIntent carries fire, use, and weapon arti", () => {
    const fire = composeIntent({ fire: true, use: true, arti: 3 });
    assert.equal(fire.fire, true);
    assert.equal(fire.use, true);
    assert.equal(fire.arti, 3);
    const next = composeIntent({ arti: 9 });
    assert.equal(next.arti, 9);
  });
});

describe("snapshot apply", () => {
  it("spawn update despawn via reduceServerMessage", () => {
    let s = createClientState();
    s = reduceServerMessage(s, {
      type: "snapshot",
      protocolVersion: 1,
      tick: 1,
      serverTime: 0,
      mapName: "E1M1",
      actors: {
        spawn: [
          {
            id: 2,
            kind: "monster",
            type: 3001,
            x: 1,
            y: 2,
            z: 0,
            angle: 0,
            health: 60,
            controllerSessionId: null,
          },
        ],
        update: [],
        despawn: [],
      },
      doors: { spawn: [{ id: 0, state: "opening", position: 64, x: 10, y: 20 }], update: [], despawn: [] },
      projectiles: {
        spawn: [{ id: 9, type: 33, x: 1, y: 2, z: 3, angle: 45 }],
        update: [],
        despawn: [],
      },
      switches: { spawn: [{ id: 42, top: 0, mid: 87, bot: 12 }], update: [], despawn: [] },
    });
    assert.equal(s.entities.actors.size, 1);
    assert.equal(s.entities.doors.size, 1);
    assert.equal(s.entities.doors.get(0)!.state, "opening");
    assert.equal(s.entities.projectiles.get(9)!.angle, 45);
    assert.equal(s.entities.switches.get(42)!.mid, 87);
    s = reduceServerMessage(s, {
      type: "snapshot",
      protocolVersion: 1,
      tick: 2,
      serverTime: 30,
      mapName: "E1M1",
      actors: {
        spawn: [],
        update: [
          {
            id: 2,
            kind: "monster",
            type: 3001,
            x: 10,
            y: 2,
            z: 0,
            angle: 1,
            health: 50,
            controllerSessionId: "s",
          },
        ],
        despawn: [],
      },
      doors: { spawn: [], update: [], despawn: [] },
      projectiles: { spawn: [], update: [], despawn: [] },
    });
    assert.equal(s.entities.actors.get(2)!.x, 10);
    s = reduceServerMessage(s, {
      type: "snapshot",
      protocolVersion: 1,
      tick: 3,
      serverTime: 60,
      mapName: "E1M1",
      actors: { spawn: [], update: [], despawn: [2] },
      doors: { spawn: [], update: [], despawn: [0] },
      projectiles: { spawn: [], update: [], despawn: [9] },
      switches: { spawn: [], update: [], despawn: [42] },
    });
    assert.equal(s.entities.actors.size, 0);
    assert.equal(s.entities.doors.size, 0);
    assert.equal(s.entities.projectiles.size, 0);
    assert.equal(s.entities.switches.size, 0);
  });

  it("mapLoad sets loading until snapshot", () => {
    let s = createClientState();
    s = reduceServerMessage(s, {
      type: "mapLoad",
      protocolVersion: 1,
      mapName: "E1M1",
      episode: 1,
      map: 1,
    });
    assert.equal(s.mapLoading, true);
    s = reduceServerMessage(s, {
      type: "snapshot",
      protocolVersion: 1,
      tick: 1,
      serverTime: 0,
      mapName: "E1M1",
      actors: { spawn: [], update: [], despawn: [] },
      doors: { spawn: [], update: [], despawn: [] },
      projectiles: { spawn: [], update: [], despawn: [] },
    });
    assert.equal(s.mapLoading, false);
  });

  it("bye marks disconnected", () => {
    let s = createClientState();
    s = reduceServerMessage(s, { type: "bye", protocolVersion: 1, reason: "shutdown" });
    assert.equal(s.disconnected, true);
    assert.equal(s.byeReason, "shutdown");
  });
});

describe("protocol client state", () => {
  it("welcome then snapshot sets role and body", () => {
    let s = createClientState();
    s = reduceServerMessage(s, {
      type: "welcome",
      protocolVersion: 1,
      sessionId: "abc",
      role: "demon",
      controlledId: 3,
      followTargetId: null,
      mapName: "E1M1",
      tickRateHz: 35,
      serverTime: 0,
    });
    assert.equal(s.sessionId, "abc");
    assert.equal(s.role, "demon");
    assert.equal(s.tickRateHz, 35);
    s = reduceServerMessage(s, {
      type: "snapshot",
      protocolVersion: 1,
      tick: 5,
      serverTime: 100,
      mapName: "E1M1",
      points: 10,
      mods: { health: 1, speed: 0, damage: 0, rate: 0 },
      actors: {
        spawn: [
          {
            id: 3,
            kind: "monster",
            type: 3001,
            typeName: "imp",
            x: 0,
            y: 0,
            z: 0,
            angle: 0,
            health: 60,
            maxHealth: 60,
            controllerSessionId: "abc",
          },
        ],
        update: [],
        despawn: [],
      },
      doors: { spawn: [], update: [], despawn: [] },
      projectiles: { spawn: [], update: [], despawn: [] },
    });
    assert.equal(s.tick, 5);
    assert.equal(s.points, 10);
    assert.equal(s.mods.health, 1);
    assert.equal(s.entities.actors.get(3)?.typeName, "imp");
  });
});

describe("entity map", () => {
  it("starts empty", () => {
    const m = createEntityMap();
    assert.equal(m.actors.size, 0);
    assert.equal(m.doors.size, 0);
    assert.equal(m.movers.size, 0);
    assert.equal(m.projectiles.size, 0);
    assert.equal(m.switches.size, 0);
  });
});

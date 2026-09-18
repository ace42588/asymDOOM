import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { clampAxis, toTiccmdMoves, toTiccmdTurn } from "../thin/intentScale.js";

describe("intentScale", () => {
  it("clamps axes to [-1,1]", () => {
    assert.equal(clampAxis(50), 1);
    assert.equal(clampAxis(-40), -1);
    assert.equal(clampAxis(0.5), 0.5);
  });

  it("maps normalized run forward to ticcmd 50", () => {
    assert.deepEqual(toTiccmdMoves(1, 0, true), { forward: 50, strafe: 0 });
    assert.deepEqual(toTiccmdMoves(1, 0, false), { forward: 25, strafe: 0 });
    assert.deepEqual(toTiccmdMoves(0, -1, true), { forward: 0, strafe: -40 });
  });

  it("never emits |forward|>50 from protocol axes", () => {
    const m = toTiccmdMoves(1, 1, true);
    assert.ok(Math.abs(m.forward) <= 50);
    assert.ok(Math.abs(m.strafe) <= 40);
  });

  it("scales turnDelta to angleturn units", () => {
    assert.equal(toTiccmdTurn(0), 0);
    assert.ok(toTiccmdTurn(0.1) > 0);
    assert.ok(toTiccmdTurn(-0.2) < 0);
  });
});

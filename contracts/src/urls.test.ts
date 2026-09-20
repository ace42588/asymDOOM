import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PROTOCOL_VERSION,
  joinUrl,
  normalizeSimBase,
  wadUrl,
  withSessionId,
  wsUrl,
} from "./index.js";

describe("contracts URL helpers", () => {
  it("exports PROTOCOL_VERSION", () => {
    assert.equal(PROTOCOL_VERSION, 1);
  });

  it("normalizeSimBase strips trailing slashes", () => {
    assert.equal(normalizeSimBase("http://127.0.0.1:8666/"), "http://127.0.0.1:8666");
    assert.equal(normalizeSimBase("https://sim.example.com"), "https://sim.example.com");
  });

  it("joinUrl", () => {
    assert.equal(joinUrl("http://127.0.0.1:8666"), "http://127.0.0.1:8666/api/join");
  });

  it("wsUrl http → ws", () => {
    assert.equal(wsUrl("http://127.0.0.1:8666"), "ws://127.0.0.1:8666/ws");
    assert.equal(
      wsUrl("http://127.0.0.1:8666", "abc"),
      "ws://127.0.0.1:8666/ws?sessionId=abc",
    );
  });

  it("wsUrl https → wss", () => {
    assert.equal(wsUrl("https://sim.example.com"), "wss://sim.example.com/ws");
  });

  it("wadUrl", () => {
    assert.equal(wadUrl("https://sim.example.com/"), "https://sim.example.com/doom1.wad");
  });

  it("withSessionId", () => {
    assert.equal(
      withSessionId("wss://sim.example.com/ws", "s1"),
      "wss://sim.example.com/ws?sessionId=s1",
    );
    assert.equal(withSessionId("wss://sim.example.com/ws", null), "wss://sim.example.com/ws");
  });
});

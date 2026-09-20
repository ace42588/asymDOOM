import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  allowedOrigins,
  applyCorsHeaders,
  buildJoinResponse,
  corsAllowOrigin,
  publicSimBase,
} from "../thin/httpApi.js";

describe("publicSimBase", () => {
  it("prefers SIM_PUBLIC_URL", () => {
    const base = publicSimBase(
      { headers: { host: "ignored:9" } },
      { simPublicUrl: "https://sim.example.com/" },
    );
    assert.equal(base, "https://sim.example.com");
  });

  it("uses X-Forwarded-Proto and Host", () => {
    const base = publicSimBase({
      headers: {
        host: "internal:8666",
        "x-forwarded-proto": "https",
        "x-forwarded-host": "play.example.com",
      },
    });
    assert.equal(base, "https://play.example.com");
  });

  it("falls back to Host", () => {
    const base = publicSimBase({ headers: { host: "127.0.0.1:8666" } });
    assert.equal(base, "http://127.0.0.1:8666");
  });
});

describe("buildJoinResponse", () => {
  it("returns absolute wsUrl and wadUrl", () => {
    const join = buildJoinResponse(
      { headers: { host: "127.0.0.1:8666" } },
      { skill: 3 },
    );
    assert.equal(join.protocolVersion, 1);
    assert.equal(join.mode, "thin");
    assert.equal(join.wsUrl, "ws://127.0.0.1:8666/ws");
    assert.equal(join.wadUrl, "http://127.0.0.1:8666/doom1.wad");
    assert.deepEqual(join.settings, { skill: 3 });
  });

  it("https public URL → wss", () => {
    const join = buildJoinResponse(
      { headers: {} },
      {},
      { simPublicUrl: "https://sim.example.com" },
    );
    assert.equal(join.wsUrl, "wss://sim.example.com/ws");
    assert.equal(join.wadUrl, "https://sim.example.com/doom1.wad");
  });
});

describe("CORS", () => {
  it("allows listed Origin", () => {
    const origins = new Set(["https://pages.example.com"]);
    assert.equal(
      corsAllowOrigin({ headers: { origin: "https://pages.example.com" } }, origins),
      "https://pages.example.com",
    );
    assert.equal(
      corsAllowOrigin({ headers: { origin: "https://evil.example" } }, origins),
      null,
    );
  });

  it("dev defaults include Vite ports", () => {
    const origins = allowedOrigins("", "development");
    assert.ok(origins.has("http://127.0.0.1:5173"));
    assert.ok(origins.has("http://localhost:5173"));
  });

  it("production has no default origins", () => {
    const origins = allowedOrigins("", "production");
    assert.equal(origins.size, 0);
  });

  it("applyCorsHeaders sets ACAO when allowed", () => {
    const headers: Record<string, string> = {};
    const ok = applyCorsHeaders(
      { headers: { origin: "http://localhost:5173" } },
      { setHeader: (k, v) => { headers[k] = String(v); } },
      new Set(["http://localhost:5173"]),
    );
    assert.equal(ok, true);
    assert.equal(headers["Access-Control-Allow-Origin"], "http://localhost:5173");
  });
});

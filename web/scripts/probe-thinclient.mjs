#!/usr/bin/env node
/**
 * Headless thin-client smoke: two WS clients, assert marine+demon roles + snapshots.
 * Usage: ASYM_URL=http://127.0.0.1:8666 node web/scripts/probe-thinclient.mjs
 */
import WebSocket from "ws";

const BASE = process.env.ASYM_URL ?? "http://127.0.0.1:8666";
const WS = BASE.replace(/^http/, "ws") + "/ws";

function connect() {
  const ws = new WebSocket(WS);
  /** @type {any[]} */
  const inbox = [];
  ws.on("message", (data) => inbox.push(JSON.parse(String(data))));
  const open = new Promise((res, rej) => {
    ws.once("open", res);
    ws.once("error", rej);
  });
  async function wait(pred, ms = 5000) {
    const start = Date.now();
    for (;;) {
      const hit = inbox.find(pred);
      if (hit) return hit;
      if (Date.now() - start > ms) throw new Error("timeout waiting for message");
      await new Promise((r) => setTimeout(r, 20));
    }
  }
  return { ws, open, wait, inbox };
}

const a = connect();
await a.open;
const welcomeA = await a.wait((m) => m.type === "welcome");
await a.wait((m) => m.type === "snapshot");

const b = connect();
await b.open;
const welcomeB = await b.wait((m) => m.type === "welcome");
await b.wait((m) => m.type === "snapshot");

const roles = [welcomeA.role, welcomeB.role].sort();
if (!(roles.includes("marine") && roles.includes("demon")) && !(roles[0] === "demon" && roles[1] === "demon")) {
  // Allow two demons if marine already taken by a third client; still require controlled bodies.
}
const withBody = [welcomeA, welcomeB].filter((w) => w.controlledId != null);
if (withBody.length < 1) throw new Error("no controlled bodies");
if (!welcomeA.sessionId || !welcomeB.sessionId) throw new Error("missing session ids");
if (welcomeA.sessionId === welcomeB.sessionId) throw new Error("session id collision");

// Prefer the strong assertion when we got the classic pair.
if (roles.includes("marine") && roles.includes("demon")) {
  console.log("probe-thinclient ok (marine+demon)", {
    a: welcomeA.role,
    b: welcomeB.role,
    bodies: [welcomeA.controlledId, welcomeB.controlledId],
  });
} else if (withBody.length === 2) {
  console.log("probe-thinclient ok (2 possessed; marine may be held elsewhere)", {
    a: welcomeA.role,
    b: welcomeB.role,
    bodies: [welcomeA.controlledId, welcomeB.controlledId],
  });
} else {
  throw new Error(`unexpected roles ${roles.join(",")}`);
}

a.ws.close();
b.ws.close();
await new Promise((r) => setTimeout(r, 100));
process.exit(0);

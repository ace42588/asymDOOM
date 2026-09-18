import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { ThinMatch } from "../thin/match.js";
import { NativeEmbed } from "../thin/nativeEmbed.js";

class FakeSocket extends EventEmitter {
  readyState = 1;
  OPEN = 1;
  closed = false;
  sent: unknown[] = [];
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.closed = true;
    this.readyState = 3;
  }
}

const SETTINGS = {
  skill: 3,
  episode: 1,
  map: 1,
  onMarineDeath: "demons_win" as const,
  demonView: "first_person" as const,
};

function makeMatch(opts?: { resumeGraceMs?: number }) {
  const factory = () => new NativeEmbed({ skill: 3, episode: 1, map: 1 });
  return new ThinMatch(SETTINGS, factory(), factory, opts);
}

describe("ThinMatch", () => {
  it("assigns marine then demon and emits welcome+snapshot", () => {
    const factory = () => new NativeEmbed({ skill: 3, episode: 1, map: 1 });
    const embed = factory();
    const match = new ThinMatch(
      {
        skill: 3,
        episode: 1,
        map: 1,
        onMarineDeath: "respawn_as_killer",
        demonView: "first_person",
      },
      embed,
      factory,
    );
    const a = new FakeSocket();
    const b = new FakeSocket();
    match.join(a as never);
    match.join(b as never);
    const welcomeA = a.sent.find((m: any) => m.type === "welcome") as any;
    const welcomeB = b.sent.find((m: any) => m.type === "welcome") as any;
    assert.equal(welcomeA.role, "marine");
    assert.ok(welcomeA.controlledId > 0);
    assert.equal(welcomeB.role, "demon");
    assert.ok(welcomeB.controlledId > 0);
    assert.notEqual(welcomeA.controlledId, welcomeB.controlledId);
    assert.ok(a.sent.some((m: any) => m.type === "snapshot"));
    const snap = a.sent.find((m: any) => m.type === "snapshot") as any;
    assert.ok((snap.actors?.spawn?.length ?? 0) > 5, "E1M1 actors in snapshot");
    // Wire doors use string states when present
    for (const d of snap.doors?.spawn ?? []) {
      assert.equal(typeof d.state, "string");
    }
    for (const p of snap.projectiles?.spawn ?? []) {
      assert.equal(typeof p.angle, "number");
    }
    match.leave(welcomeA.sessionId);
    match.leave(welcomeB.sessionId);
    match.stop();
  });

  it("accepts protocol-normalized move input without bad_message", () => {
    const match = makeMatch();
    const sock = new FakeSocket();
    const sessionId = match.join(sock as never);
    const before = sock.sent.length;
    match.onMessage(sessionId, {
      type: "input",
      protocolVersion: 1,
      seq: 1,
      input: {
        intent: { forward: 1, strafe: 0, turnDelta: -0.2, run: true, fire: false, use: false },
      },
    });
    const notices = sock.sent.slice(before).filter((m: any) => m.type === "notice");
    assert.equal(notices.length, 0, `unexpected notices: ${JSON.stringify(notices)}`);
    // Engine accepts the latched intent and advances
    for (let i = 0; i < 10; i++) match["embed"].tick();
    match.leave(sessionId);
    match.stop();
  });

  it("rejects oversize forward with bad_message notice", () => {
    const match = makeMatch();
    const sock = new FakeSocket();
    const sessionId = match.join(sock as never);
    const before = sock.sent.length;
    match.onMessage(sessionId, {
      type: "input",
      protocolVersion: 1,
      seq: 2,
      input: {
        intent: { forward: 50, strafe: 0, turnDelta: 0, run: true, fire: false, use: false },
      },
    });
    const notice = sock.sent.slice(before).find((m: any) => m.type === "notice" && m.code === "bad_message") as any;
    assert.ok(notice, "expected bad_message notice for forward=50");
    match.leave(sessionId);
    match.stop();
  });

  it("resumes parked session with same role, body, and points", () => {
    const match = makeMatch({ resumeGraceMs: 5_000 });
    const marineSock = new FakeSocket();
    const demonSock = new FakeSocket();
    match.join(marineSock as never);
    const demonId = match.join(demonSock as never);
    const welcome = demonSock.sent.find((m: any) => m.type === "welcome") as any;
    assert.equal(welcome.role, "demon");
    const bodyId = welcome.controlledId;
    const pointsBefore = match.embed.points(demonId);
    assert.equal(typeof pointsBefore, "number");

    match.disconnect(demonId, demonSock as never);
    assert.ok(match.sessions.has(demonId), "parked session stays in map");
    assert.equal(match.sessions.get(demonId)!.ws, null);
    assert.equal(match.embed.points(demonId), pointsBefore, "controller not freed while parked");
    assert.equal(match.embed.role(demonId), "demon");
    assert.equal(match.embed.body(demonId), bodyId);

    const resumeSock = new FakeSocket();
    const resumedId = match.join(resumeSock as never, demonId);
    assert.equal(resumedId, demonId);
    const welcome2 = resumeSock.sent.find((m: any) => m.type === "welcome") as any;
    assert.equal(welcome2.sessionId, demonId);
    assert.equal(welcome2.role, "demon");
    assert.equal(welcome2.controlledId, bodyId);
    assert.ok(resumeSock.sent.some((m: any) => m.type === "snapshot"));
    assert.equal(match.embed.points(demonId), pointsBefore);

    const marineWelcome = marineSock.sent.find((m: any) => m.type === "welcome") as any;
    match.leave(marineWelcome.sessionId);
    match.leave(demonId);
    match.stop();
  });

  it("unknown resume id mints a new session", () => {
    const match = makeMatch();
    const sock = new FakeSocket();
    const id = match.join(sock as never, "not-a-real-session");
    assert.notEqual(id, "not-a-real-session");
    const welcome = sock.sent.find((m: any) => m.type === "welcome") as any;
    assert.equal(welcome.sessionId, id);
    match.leave(id);
    match.stop();
  });

  it("stale socket close after steal does not park the new owner", () => {
    const match = makeMatch({ resumeGraceMs: 5_000 });
    const a = new FakeSocket();
    const sessionId = match.join(a as never);
    const b = new FakeSocket();
    match.join(b as never, sessionId);
    assert.equal(match.sessions.get(sessionId)!.ws, b);
    assert.ok(a.closed, "old socket closed on steal");

    match.disconnect(sessionId, a as never);
    assert.equal(match.sessions.get(sessionId)!.ws, b, "stale close ignored");
    assert.equal(match.sessions.get(sessionId)!.graceTimer, null);

    match.leave(sessionId);
    match.stop();
  });

  it("grace expiry unregisters; solo park does not recreate embed", async () => {
    const match = makeMatch({ resumeGraceMs: 40 });
    const sock = new FakeSocket();
    const sessionId = match.join(sock as never);
    const embedBefore = match.embed;

    match.disconnect(sessionId, sock as never);
    assert.ok(match.sessions.has(sessionId));
    assert.equal(match.embed, embedBefore, "parked solo does not recreate");

    await new Promise((r) => setTimeout(r, 80));
    assert.ok(!match.sessions.has(sessionId), "grace expiry leaves");
    // After last leave, embed is recreated
    assert.notEqual(match.embed, embedBefore);

    const sock2 = new FakeSocket();
    const newId = match.join(sock2 as never, sessionId);
    assert.notEqual(newId, sessionId, "expired id is not resumable");
    match.leave(newId);
    match.stop();
  });
});

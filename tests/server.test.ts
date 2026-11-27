import { afterEach, describe, expect, it } from "vitest";
import { io as connect, type Socket } from "socket.io-client";
import { createHeartsServer, type ServerTiming } from "../server/server";
import type { AckResult, ClientToServerEvents, PlayerSession, RoomConnection, RoomSnapshot, ServerToClientEvents } from "../src/net/protocol";

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

const FAST: Partial<ServerTiming> = {
  botDelayMs: 1,
  trickPauseMs: 1,
  handOverMs: 5,
  disconnectGraceMs: 150,
  turnTimeoutMs: 60_000,
  emptyRoomMs: 60_000
};

let cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

async function startServer(timing: Partial<ServerTiming> = FAST) {
  const server = createHeartsServer(undefined, timing);
  const port = await server.listen(0, "127.0.0.1");
  cleanup.push(() => server.close());
  return { server, url: `http://127.0.0.1:${port}` };
}

interface TestClient {
  socket: Client;
  latest: RoomSnapshot | null;
  states: RoomSnapshot[];
  emit<T>(event: keyof ClientToServerEvents, ...args: unknown[]): Promise<AckResult<T>>;
  waitFor(predicate: (s: RoomSnapshot) => boolean, timeoutMs?: number): Promise<RoomSnapshot>;
}

async function client(url: string): Promise<TestClient> {
  const socket: Client = connect(url, { transports: ["websocket"], forceNew: true, reconnection: false });
  const c: TestClient = {
    socket,
    latest: null,
    states: [],
    emit<T>(event: keyof ClientToServerEvents, ...args: unknown[]) {
      return new Promise<AckResult<T>>((resolve) => (socket.emit as (...a: unknown[]) => void)(event, ...args, resolve));
    },
    waitFor(predicate, timeoutMs = 8000) {
      return new Promise((resolve, reject) => {
        if (c.latest && predicate(c.latest)) return resolve(c.latest);
        const timer = setTimeout(() => {
          socket.off("room:state", handler);
          reject(new Error(`timed out; last state ${JSON.stringify(c.latest?.view?.phase)}`));
        }, timeoutMs);
        const handler = (s: RoomSnapshot) => {
          if (predicate(s)) {
            clearTimeout(timer);
            socket.off("room:state", handler);
            resolve(s);
          }
        };
        socket.on("room:state", handler);
      });
    }
  };
  socket.on("room:state", (s) => {
    c.latest = s;
    c.states.push(s);
  });
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("connect_error", reject);
  });
  cleanup.push(async () => {
    socket.disconnect();
  });
  return c;
}

function ok<T>(result: AckResult<T>): T {
  if (!result.ok) throw new Error(result.message);
  return result.data;
}

/** Act for this client whenever it owes an action; stops when the game ends. */
function autoplay(c: TestClient) {
  let busy = false;
  const act = async (s: RoomSnapshot) => {
    const v = s.view;
    if (!v || busy) return;
    busy = true;
    try {
      if (v.phase === "passing" && !v.myPass) await c.emit("room:pass", v.hand.slice(0, 3));
      else if (v.phase === "playing" && v.turn === s.you && v.legal.length) await c.emit("room:play", v.legal[0]);
      else if (v.phase === "moon" && v.moonShooter === s.you) await c.emit("room:moon", "add");
      else if (v.phase === "handOver" && !s.seats[s.you].ready) await c.emit("room:ready");
    } finally {
      busy = false;
    }
    if (c.latest && c.latest !== s) void act(c.latest);
  };
  c.socket.on("room:state", (s) => void act(s));
  if (c.latest) void act(c.latest);
}

describe("multiplayer server", () => {
  it("health endpoint answers", async () => {
    const { url } = await startServer();
    const res = await fetch(`${url}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });

  it("creates a room, joins by code and fills empty seats with bots", async () => {
    const { url } = await startServer();
    const a = await client(url);
    const b = await client(url);
    const created = ok(await a.emit<RoomConnection>("room:create", { name: "Ann", rules: { jackOfDiamonds: true }, difficulty: "easy" }));
    expect(created.snapshot.code).toMatch(/^[A-Z0-9]{5}$/);
    expect(created.snapshot.seats[0]).toMatchObject({ kind: "human", isHost: true, name: "Ann" });

    // A lone host cannot start a multiplayer game.
    expect((await a.emit("room:start")).ok).toBe(false);

    const bad = await b.emit("room:join", { code: "ZZZZZ", name: "Bo" });
    expect(bad.ok).toBe(false);
    const joined = ok(await b.emit<RoomConnection>("room:join", { code: created.snapshot.code.toLowerCase(), name: "Bo<script>" }));
    expect(joined.session.seat).toBe(1);
    expect(joined.snapshot.seats[1].name).toBe("Boscript");

    // Only the host may change settings or start.
    expect((await b.emit("room:start")).ok).toBe(false);
    expect((await b.emit("room:settings", { rules: {}, difficulty: "hard" })).ok).toBe(false);
    ok(await a.emit("room:settings", { rules: { jackOfDiamonds: true, targetScore: 50 }, difficulty: "normal" }));
    ok(await a.emit("room:start"));
    const s = await b.waitFor((x) => x.stage === "playing");
    expect(s.seats.map((x) => x.kind)).toEqual(["human", "human", "bot", "bot"]);
    expect(s.rules.targetScore).toBe(50);
    expect(s.difficulty).toBe("normal");
  });

  it("sends each player only their own hand and rejects illegal moves", async () => {
    // Slow bots keep the turn still while the test probes it.
    const { url, server } = await startServer({ ...FAST, botDelayMs: 1500, trickPauseMs: 0 });
    const a = await client(url);
    const b = await client(url);
    const created = ok(await a.emit<RoomConnection>("room:create", { name: "Ann", rules: {}, difficulty: "easy" }));
    ok(await b.emit("room:join", { code: created.snapshot.code, name: "Bo" }));
    ok(await a.emit("room:start"));
    const sa = await a.waitFor((x) => x.view?.phase === "passing");
    const sb = await b.waitFor((x) => x.view?.phase === "passing");
    const room = server.rooms.get(created.snapshot.code)!;
    expect(sa.view!.hand).toEqual(room.game!.hands[0]);
    expect(sb.view!.hand).toEqual(room.game!.hands[1]);
    // No snapshot ever contains another seat's hand.
    for (const snap of [...a.states, ...b.states]) {
      const raw = JSON.stringify(snap);
      expect(raw).not.toContain('"hands"');
    }

    // Passing someone else's cards, the wrong count, or junk is refused.
    expect((await a.emit("room:pass", sb.view!.hand.slice(0, 3))).ok).toBe(false);
    expect((await a.emit("room:pass", sa.view!.hand.slice(0, 2))).ok).toBe(false);
    expect((await a.emit("room:pass", "nope")).ok).toBe(false);
    expect((await a.emit("room:play", sa.view!.hand[0])).ok).toBe(false);
    ok(await a.emit("room:pass", sa.view!.hand.slice(0, 3)));
    expect((await a.emit("room:pass", sa.view!.hand.slice(3, 6))).ok).toBe(false);
    ok(await b.emit("room:pass", sb.view!.hand.slice(0, 3)));

    await a.waitFor((x) => x.view?.phase === "playing");
    await b.waitFor((x) => x.view?.phase === "playing");
    const game = room.game!;
    // Whoever is not on turn is refused; an illegal card is refused for whoever is.
    const turnClient = game.turn === 0 ? a : game.turn === 1 ? b : null;
    const other = game.turn === 0 ? b : a;
    const otherSeat = other === a ? 0 : 1;
    expect((await other.emit("room:play", game.hands[otherSeat][0])).ok).toBe(false);
    if (turnClient) {
      const hand = game.hands[game.turn];
      // The opener must lead the 2♣, so any other card is illegal.
      const illegal = hand.find((c) => c !== 0)!;
      const r = await turnClient.emit("room:play", illegal);
      expect(r).toMatchObject({ ok: false, message: expect.stringMatching(/2♣/) });
    }
  });

  it("plays a whole game to the end with two humans and two bots", async () => {
    const { url } = await startServer();
    const a = await client(url);
    const b = await client(url);
    const created = ok(await a.emit<RoomConnection>("room:create", { name: "Ann", rules: { targetScore: 50 }, difficulty: "hard" }));
    ok(await b.emit("room:join", { code: created.snapshot.code, name: "Bo" }));
    autoplay(a);
    autoplay(b);
    ok(await a.emit("room:start"));
    const end = await a.waitFor((x) => x.view?.phase === "gameOver", 60_000);
    expect(Math.max(...end.view!.scores)).toBeGreaterThanOrEqual(50);
    expect(end.view!.winners.length).toBeGreaterThan(0);
    // Rematch keeps the seats.
    ok(await a.emit("room:rematch"));
    await a.waitFor((x) => x.view?.phase === "passing" && x.view.history.length === 0);
  }, 70_000);

  it("reconnects after a dropped connection and keeps the seat", async () => {
    const { url } = await startServer({ ...FAST, disconnectGraceMs: 5_000 });
    const a = await client(url);
    const b = await client(url);
    const created = ok(await a.emit<RoomConnection>("room:create", { name: "Ann", rules: {}, difficulty: "easy" }));
    const joined = ok(await b.emit<RoomConnection>("room:join", { code: created.snapshot.code, name: "Bo" }));
    ok(await a.emit("room:start"));
    const before = await b.waitFor((x) => x.view?.phase === "passing");
    b.socket.disconnect();
    const dropped = await a.waitFor((x) => !x.seats[1].connected);
    expect(dropped.seats[1].takeoverAt).toBeGreaterThan(Date.now());

    const b2 = await client(url);
    const bad = await b2.emit("room:resume", { ...joined.session, token: "forged" } satisfies PlayerSession);
    expect(bad.ok).toBe(false);
    const resumed = ok(await b2.emit<RoomConnection>("room:resume", joined.session));
    expect(resumed.snapshot.you).toBe(1);
    expect(resumed.snapshot.view!.hand).toEqual(before.view!.hand);
    await a.waitFor((x) => x.seats[1].connected && x.seats[1].kind === "human");
  });

  it("hands a dropped player's seat to a bot after the grace period, and lets them reclaim it", async () => {
    const { url } = await startServer();
    const a = await client(url);
    const b = await client(url);
    const created = ok(await a.emit<RoomConnection>("room:create", { name: "Ann", rules: {}, difficulty: "easy" }));
    const joined = ok(await b.emit<RoomConnection>("room:join", { code: created.snapshot.code, name: "Bo" }));
    autoplay(a);
    ok(await a.emit("room:start"));
    await b.waitFor((x) => x.view?.phase === "passing");
    b.socket.disconnect();
    const taken = await a.waitFor((x) => x.seats[1].kind === "bot");
    expect(taken.seats[1]).toMatchObject({ botForHuman: true, name: "Bo (bot)" });
    // The bot keeps the game moving: seat 1 passes and plays without a human.
    await a.waitFor((x) => (x.view?.tricks.length ?? 0) >= 2, 10_000);

    const b2 = await client(url);
    const resumed = ok(await b2.emit<RoomConnection>("room:resume", joined.session));
    expect(resumed.snapshot.seats[1]).toMatchObject({ kind: "human", name: "Bo" });
  });

  it("a player who leaves mid-game is replaced by a bot for good; a newcomer can take a bot seat", async () => {
    const { url } = await startServer();
    const a = await client(url);
    const b = await client(url);
    const created = ok(await a.emit<RoomConnection>("room:create", { name: "Ann", rules: {}, difficulty: "easy" }));
    const joined = ok(await b.emit<RoomConnection>("room:join", { code: created.snapshot.code, name: "Bo" }));
    ok(await a.emit("room:start"));
    await b.waitFor((x) => x.stage === "playing");
    ok(await b.emit("room:leave"));
    const s = await a.waitFor((x) => x.seats[1].kind === "bot");
    expect(s.seats[1].botForHuman).toBe(false);
    const b2 = await client(url);
    expect((await b2.emit("room:resume", joined.session)).ok).toBe(false);
    const c = await client(url);
    const late = ok(await c.emit<RoomConnection>("room:join", { code: created.snapshot.code, name: "Cy" }));
    expect(late.snapshot.seats[late.session.seat]).toMatchObject({ kind: "human", name: "Cy" });
  });

  it("passes host to another human when the host leaves the lobby", async () => {
    const { url } = await startServer();
    const a = await client(url);
    const b = await client(url);
    const created = ok(await a.emit<RoomConnection>("room:create", { name: "Ann", rules: {}, difficulty: "easy" }));
    ok(await b.emit("room:join", { code: created.snapshot.code, name: "Bo" }));
    ok(await a.emit("room:leave"));
    const s = await b.waitFor((x) => x.seats[0].kind === "empty");
    expect(s.seats[1].isHost).toBe(true);
  });

  it("fills a room to four humans and refuses a fifth", async () => {
    const { url } = await startServer();
    const host = await client(url);
    const created = ok(await host.emit<RoomConnection>("room:create", { name: "H", rules: {}, difficulty: "easy" }));
    for (const name of ["B", "C", "D"]) {
      const c = await client(url);
      ok(await c.emit("room:join", { code: created.snapshot.code, name }));
    }
    const e = await client(url);
    const r = await e.emit("room:join", { code: created.snapshot.code, name: "E" });
    expect(r).toMatchObject({ ok: false, message: expect.stringMatching(/full/) });
  });
});

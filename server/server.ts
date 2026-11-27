import { randomUUID } from "node:crypto";
import { createServer, type Server as HttpServer } from "node:http";
import { pathToFileURL } from "node:url";
import { Server, type Socket } from "socket.io";
import { botAct, DIFFICULTIES, type Difficulty } from "../src/bots/bots";
import { isCard } from "../src/engine/cards";
import {
  RuleError,
  SEATS,
  chooseMoon,
  createGame,
  nextHand,
  normalizeRules,
  playCard,
  seatsToAct,
  submitPass,
  type GameState,
  type HouseRules,
  type Seat
} from "../src/engine/game";
import { randomSeed } from "../src/engine/rng";
import { viewFor } from "../src/engine/view";
import {
  cleanName,
  normalizeCode,
  type Ack,
  type ClientToServerEvents,
  type PlayerSession,
  type PublicSeat,
  type RoomConnection,
  type RoomSnapshot,
  type ServerToClientEvents,
  type SocketData
} from "../src/net/protocol";

type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

interface SeatState {
  kind: "human" | "bot" | "empty";
  name: string;
  /** Name of the human this seat belongs to, kept while a bot fills in. */
  humanName: string | null;
  token: string | null;
  socketId: string | null;
  connected: boolean;
  isHost: boolean;
  ready: boolean;
  takeoverAt: number | null;
  takeoverTimer: ReturnType<typeof setTimeout> | null;
}

interface Room {
  code: string;
  stage: "lobby" | "playing";
  rules: HouseRules;
  difficulty: Difficulty;
  seats: SeatState[];
  game: GameState | null;
  revision: number;
  actionTimer: ReturnType<typeof setTimeout> | null;
  nextHandAt: number | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

export interface ServerTiming {
  /** Pause before a bot acts. */
  botDelayMs: number;
  /** Extra pause after a trick completes, so every client can see it. */
  trickPauseMs: number;
  /** How long the hand summary stays up before the next deal. */
  handOverMs: number;
  /** How long a dropped player keeps their seat before a bot takes it. */
  disconnectGraceMs: number;
  /** A connected human who does not act in this time has a bot move for them once. */
  turnTimeoutMs: number;
  /** A room with no connected humans is deleted after this long. */
  emptyRoomMs: number;
}

const DEFAULT_TIMING: ServerTiming = {
  botDelayMs: 700,
  trickPauseMs: 1300,
  handOverMs: 12_000,
  disconnectGraceMs: 30_000,
  turnTimeoutMs: 75_000,
  emptyRoomMs: 10 * 60_000
};

const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const BOT_NAMES = ["Juniper", "Marlow", "Odessa", "Pim", "Quill", "Rosalind", "Tobias", "Wren"];
const DEFAULT_PORT = 4291;

export function createHeartsServer(httpServer: HttpServer = createHealthServer(), timing: Partial<ServerTiming> = {}) {
  const t: ServerTiming = { ...DEFAULT_TIMING, ...timing };
  const rooms = new Map<string, Room>();
  const origins = (process.env.CLIENT_ORIGINS ?? "http://127.0.0.1:4290,http://localhost:4290")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(httpServer, {
    cors: { origin: origins, methods: ["GET", "POST"] }
  });

  io.on("connection", (socket) => {
    socket.on("room:create", (payload, ack) =>
      guard(ack, () => {
        leaveRoom(socket);
        const room = createRoom(payload?.rules, payload?.difficulty);
        rooms.set(room.code, room);
        const connection = seatHuman(room, socket, 0, cleanName(payload?.name), true);
        ackOk(ack, connection);
        broadcast(room);
      })
    );

    socket.on("room:join", (payload, ack) =>
      guard(ack, () => {
        const room = rooms.get(normalizeCode(payload?.code));
        if (!room) return ackFail(ack, "No room has that code. Check it and try again.");
        // In the lobby take an empty seat; mid-game take over a bot seat.
        const seat = SEATS.find((s) => room.seats[s].kind === "empty") ?? (room.stage === "playing" ? SEATS.find((s) => room.seats[s].kind === "bot") : undefined);
        if (seat === undefined) return ackFail(ack, "That room is full.");
        leaveRoom(socket);
        const connection = seatHuman(room, socket, seat, cleanName(payload?.name), false);
        ackOk(ack, connection);
        broadcast(room);
        pump(room);
      })
    );

    socket.on("room:resume", (session, ack) =>
      guard(ack, () => {
        const room = rooms.get(normalizeCode(session?.roomCode));
        const seatIndex = session?.seat;
        const seat = room && SEATS.includes(seatIndex) ? room.seats[seatIndex] : null;
        if (!room || !seat || !seat.token || seat.token !== session.token) {
          return ackFail(ack, "That game has ended or your seat was given away.");
        }
        if (seat.socketId && seat.socketId !== socket.id) {
          // An older tab holds this seat: move it here.
          io.sockets.sockets.get(seat.socketId)?.emit("room:closed", "This seat was opened in another tab.");
          const old = io.sockets.sockets.get(seat.socketId) as GameSocket | undefined;
          if (old) {
            old.data.session = undefined;
            old.leave(room.code);
          }
        }
        const current = socket.data.session;
        if (!current || current.roomCode !== room.code || current.seat !== seatIndex) leaveRoom(socket);
        clearTakeover(seat);
        seat.kind = "human";
        seat.name = seat.humanName ?? seat.name;
        seat.socketId = socket.id;
        seat.connected = true;
        socket.data.session = { roomCode: room.code, seat: seatIndex, token: seat.token };
        socket.join(room.code);
        cancelIdle(room);
        bump(room);
        ackOk(ack, { session: socket.data.session, snapshot: snapshot(room, seatIndex) });
        broadcast(room);
        pump(room);
      })
    );

    socket.on("room:settings", (payload, ack) =>
      withSeat(socket, ack, (room, seat) => {
        if (!room.seats[seat].isHost) return ackFail(ack, "Only the host can change settings.");
        if (room.stage !== "lobby") return ackFail(ack, "Settings are locked once the game starts.");
        room.rules = normalizeRules(payload?.rules);
        room.difficulty = DIFFICULTIES.includes(payload?.difficulty) ? payload.difficulty : room.difficulty;
        bump(room);
        ackOk(ack, null);
        broadcast(room);
      })
    );

    socket.on("room:start", (ack) =>
      withSeat(socket, ack, (room, seat) => {
        if (!room.seats[seat].isHost) return ackFail(ack, "Only the host can start the game.");
        if (room.stage !== "lobby") return ackFail(ack, "The game has already started.");
        const humans = room.seats.filter((s) => s.kind === "human").length;
        if (humans < 2) return ackFail(ack, "Wait for at least one more player (or play solo from the main menu).");
        startGame(room);
        ackOk(ack, null);
      })
    );

    socket.on("room:pass", (cards, ack) =>
      withGame(socket, ack, (room, seat, game) => {
        if (!Array.isArray(cards) || cards.length !== 3 || !cards.every(isCard)) throw new RuleError("Pass exactly three cards.");
        room.game = submitPass(game, seat, cards);
        afterChange(room);
        ackOk(ack, null);
      })
    );

    socket.on("room:play", (card, ack) =>
      withGame(socket, ack, (room, seat, game) => {
        room.game = playCard(game, seat, card);
        afterChange(room);
        ackOk(ack, null);
      })
    );

    socket.on("room:moon", (choice, ack) =>
      withGame(socket, ack, (room, seat, game) => {
        room.game = chooseMoon(game, seat, choice);
        afterChange(room);
        ackOk(ack, null);
      })
    );

    socket.on("room:ready", (ack) =>
      withGame(socket, ack, (room, seat, game) => {
        if (game.phase !== "handOver") return ackFail(ack, "The hand is still going.");
        room.seats[seat].ready = true;
        bump(room);
        ackOk(ack, null);
        if (!maybeDealOnReady(room)) broadcast(room);
      })
    );

    socket.on("room:rematch", (ack) =>
      withSeat(socket, ack, (room, seat) => {
        if (!room.game || room.game.phase !== "gameOver") return ackFail(ack, "The game is not over.");
        if (!room.seats[seat].isHost) return ackFail(ack, "Only the host can start a new game.");
        startGame(room);
        ackOk(ack, null);
      })
    );

    socket.on("room:leave", (ack) => {
      leaveRoom(socket);
      if (typeof ack === "function") ackOk(ack, null);
    });

    socket.on("disconnect", () => {
      const m = membership(socket);
      if (!m) return;
      const seat = m.room.seats[m.seat];
      seat.connected = false;
      seat.socketId = null;
      // The seat is held for the grace period; then a bot takes it (or, in the lobby, it is freed).
      scheduleTakeover(m.room, m.seat);
      bump(m.room);
      broadcast(m.room);
      maybeIdle(m.room);
      maybeDealOnReady(m.room);
    });
  });

  // ------------------------------------------------------------------ helpers

  function createRoom(rules: unknown, difficulty: unknown): Room {
    let code = makeCode();
    while (rooms.has(code)) code = makeCode();
    const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
    return {
      code,
      stage: "lobby",
      rules: normalizeRules(rules),
      difficulty: DIFFICULTIES.includes(difficulty as Difficulty) ? (difficulty as Difficulty) : "hard",
      seats: SEATS.map((s) => ({
        kind: "empty",
        name: names[s],
        humanName: null,
        token: null,
        socketId: null,
        connected: false,
        isHost: false,
        ready: false,
        takeoverAt: null,
        takeoverTimer: null
      })),
      game: null,
      revision: 1,
      actionTimer: null,
      nextHandAt: null,
      idleTimer: null
    };
  }

  function seatHuman(room: Room, socket: GameSocket, seatIndex: Seat, name: string, isHost: boolean): RoomConnection {
    const seat = room.seats[seatIndex];
    clearTakeover(seat);
    seat.kind = "human";
    seat.name = name;
    seat.humanName = name;
    seat.token = randomUUID();
    seat.socketId = socket.id;
    seat.connected = true;
    seat.isHost = isHost || !room.seats.some((s) => s.isHost);
    seat.ready = false;
    const session: PlayerSession = { roomCode: room.code, seat: seatIndex, token: seat.token };
    socket.data.session = session;
    socket.join(room.code);
    cancelIdle(room);
    bump(room);
    return { session, snapshot: snapshot(room, seatIndex) };
  }

  function membership(socket: GameSocket): { room: Room; seat: Seat } | null {
    const session = socket.data.session;
    if (!session) return null;
    const room = rooms.get(session.roomCode);
    const seat = room?.seats[session.seat];
    if (!room || !seat || seat.token !== session.token || seat.socketId !== socket.id) {
      socket.data.session = undefined;
      return null;
    }
    return { room, seat: session.seat };
  }

  function withSeat(socket: GameSocket, ack: Ack<null>, fn: (room: Room, seat: Seat) => void) {
    guard(ack, () => {
      const m = membership(socket);
      if (!m) return ackFail(ack, "You are not in a room.");
      fn(m.room, m.seat);
    });
  }

  function withGame(socket: GameSocket, ack: Ack<null>, fn: (room: Room, seat: Seat, game: GameState) => void) {
    withSeat(socket, ack, (room, seat) => {
      if (!room.game || room.stage !== "playing") return ackFail(ack, "The game has not started.");
      fn(room, seat, room.game);
    });
  }

  function guard<T>(ack: Ack<T>, fn: () => void) {
    try {
      fn();
    } catch (error) {
      const message = error instanceof RuleError ? error.message : "Something went wrong with that action.";
      if (!(error instanceof RuleError)) process.stderr.write(`${String(error)}\n`);
      if (typeof ack === "function") ackFail(ack, message);
    }
  }

  function leaveRoom(socket: GameSocket) {
    const m = membership(socket);
    if (!m) return;
    const { room, seat: seatIndex } = m;
    const seat = room.seats[seatIndex];
    socket.leave(room.code);
    socket.data.session = undefined;
    clearTakeover(seat);
    if (room.stage === "lobby") {
      freeSeat(room, seatIndex);
    } else {
      // Mid-game a bot takes over the seat for good.
      seat.kind = "bot";
      seat.token = null;
      seat.socketId = null;
      seat.connected = false;
      seat.name = botNameFor(room, seatIndex);
      seat.humanName = null;
      if (seat.isHost) passHost(room, seatIndex);
    }
    bump(room);
    if (!room.seats.some((s) => s.kind === "human")) {
      deleteRoom(room);
      return;
    }
    broadcast(room);
    pump(room);
  }

  function freeSeat(room: Room, seatIndex: Seat) {
    const seat = room.seats[seatIndex];
    const wasHost = seat.isHost;
    Object.assign(seat, { kind: "empty", token: null, socketId: null, connected: false, isHost: false, ready: false, humanName: null });
    seat.name = botNameFor(room, seatIndex);
    if (wasHost) passHost(room, seatIndex);
  }

  function passHost(room: Room, from: Seat) {
    room.seats[from].isHost = false;
    const next = SEATS.map((k) => ((from + k) % 4) as Seat).find((s) => room.seats[s].kind === "human" && room.seats[s].connected) ??
      SEATS.find((s) => room.seats[s].kind === "human");
    if (next !== undefined) room.seats[next].isHost = true;
  }

  function botNameFor(room: Room, seatIndex: Seat) {
    const used = new Set(room.seats.map((s) => s.name));
    return BOT_NAMES.find((n) => !used.has(n)) ?? `Bot ${seatIndex + 1}`;
  }

  function scheduleTakeover(room: Room, seatIndex: Seat) {
    const seat = room.seats[seatIndex];
    clearTakeover(seat);
    seat.takeoverAt = Date.now() + t.disconnectGraceMs;
    seat.takeoverTimer = setTimeout(() => {
      seat.takeoverTimer = null;
      seat.takeoverAt = null;
      if (seat.connected || seat.kind !== "human") return;
      if (room.stage === "lobby") {
        freeSeat(room, seatIndex);
      } else {
        // Keep the token: the player can still come back and reclaim the seat.
        seat.kind = "bot";
        seat.humanName = seat.humanName ?? seat.name;
        seat.name = `${seat.humanName} (bot)`;
        if (seat.isHost) passHost(room, seatIndex);
      }
      bump(room);
      if (!room.seats.some((s) => s.kind === "human" && s.connected)) maybeIdle(room);
      broadcast(room);
      pump(room);
    }, t.disconnectGraceMs);
  }

  function clearTakeover(seat: SeatState) {
    if (seat.takeoverTimer) clearTimeout(seat.takeoverTimer);
    seat.takeoverTimer = null;
    seat.takeoverAt = null;
  }

  function startGame(room: Room) {
    for (const [i, seat] of room.seats.entries()) {
      if (seat.kind === "empty") {
        seat.kind = "bot";
        seat.name = botNameFor(room, i as Seat);
      }
      seat.ready = false;
    }
    room.stage = "playing";
    room.game = createGame(room.rules, randomSeed());
    room.nextHandAt = null;
    afterChange(room);
  }

  function afterChange(room: Room) {
    bump(room);
    if (room.game?.phase === "handOver") {
      for (const s of room.seats) s.ready = false;
      room.nextHandAt = Date.now() + t.handOverMs;
    } else {
      room.nextHandAt = null;
    }
    broadcast(room);
    pump(room);
  }

  /** At the hand summary, deal as soon as every connected human has clicked continue. */
  function maybeDealOnReady(room: Room) {
    if (room.game?.phase !== "handOver") return false;
    const connected = room.seats.filter((s) => s.kind === "human" && s.connected);
    if (!connected.length || !connected.every((s) => s.ready)) return false;
    dealNext(room);
    return true;
  }

  function dealNext(room: Room) {
    if (!room.game || room.game.phase !== "handOver") return;
    room.game = nextHand(room.game);
    afterChange(room);
  }

  /** Schedule whatever automatic action is due: bot moves, the next deal, or an AFK nudge. */
  function pump(room: Room) {
    clearAction(room);
    const game = room.game;
    if (!game || room.stage !== "playing") return;
    if (game.phase === "gameOver") return;
    if (game.phase === "handOver") {
      scheduleAction(room, Math.max(0, (room.nextHandAt ?? Date.now()) - Date.now()));
      return;
    }
    const actors = seatsToAct(game);
    const botActor = actors.find((s) => room.seats[s].kind !== "human");
    if (botActor !== undefined) {
      const justFinishedTrick = game.phase === "playing" && game.trick.length === 0 && game.tricks.length > 0;
      const delay = game.phase === "passing" ? t.botDelayMs : t.botDelayMs + (justFinishedTrick ? t.trickPauseMs : 0);
      scheduleAction(room, delay);
      return;
    }
    // Only humans owe an action: nudge with a bot move if they stall.
    scheduleAction(room, t.turnTimeoutMs);
  }

  function scheduleAction(room: Room, delay: number) {
    clearAction(room);
    room.actionTimer = setTimeout(() => {
      room.actionTimer = null;
      try {
        runAutomatic(room);
      } catch (error) {
        process.stderr.write(`automatic action failed: ${String(error)}\n`);
      }
    }, delay);
  }

  function clearAction(room: Room) {
    if (room.actionTimer) clearTimeout(room.actionTimer);
    room.actionTimer = null;
  }

  function runAutomatic(room: Room) {
    const game = room.game;
    if (!game || room.stage !== "playing") return;
    if (game.phase === "handOver") {
      dealNext(room);
      return;
    }
    const actors = seatsToAct(game);
    const bot = actors.find((s) => room.seats[s].kind !== "human");
    const actor = bot ?? actors[0];
    if (actor === undefined) return;
    room.game = botAct(game, actor, bot !== undefined ? room.difficulty : "normal");
    afterChange(room);
  }

  function maybeIdle(room: Room) {
    if (room.seats.some((s) => s.kind === "human" && s.connected)) return;
    cancelIdle(room);
    room.idleTimer = setTimeout(() => deleteRoom(room), t.emptyRoomMs);
  }

  function cancelIdle(room: Room) {
    if (room.idleTimer) clearTimeout(room.idleTimer);
    room.idleTimer = null;
  }

  function deleteRoom(room: Room) {
    clearAction(room);
    cancelIdle(room);
    for (const s of room.seats) clearTakeover(s);
    io.to(room.code).emit("room:closed", "The room was closed.");
    rooms.delete(room.code);
  }

  function bump(room: Room) {
    room.revision++;
  }

  function snapshot(room: Room, seat: Seat): RoomSnapshot {
    return {
      code: room.code,
      stage: room.stage,
      you: seat,
      seats: room.seats.map(
        (s): PublicSeat => ({
          name: s.name,
          kind: s.kind,
          connected: s.connected,
          botForHuman: s.kind === "bot" && s.token !== null,
          takeoverAt: s.takeoverAt,
          isHost: s.isHost,
          ready: s.ready
        })
      ),
      rules: room.rules,
      difficulty: room.difficulty,
      view: room.game ? viewFor(room.game, seat) : null,
      nextHandAt: room.nextHandAt,
      revision: room.revision
    };
  }

  /** Each human gets their own view: nobody is ever sent another seat's hand. */
  function broadcast(room: Room) {
    for (const [i, seat] of room.seats.entries()) {
      if (!seat.socketId) continue;
      io.sockets.sockets.get(seat.socketId)?.emit("room:state", snapshot(room, i as Seat));
    }
  }

  return {
    io,
    httpServer,
    rooms,
    listen(port = Number(process.env.PORT) || DEFAULT_PORT, host = process.env.HOST || "127.0.0.1") {
      return new Promise<number>((resolve, reject) => {
        httpServer.once("error", reject);
        httpServer.listen(port, host, () => {
          httpServer.off("error", reject);
          const address = httpServer.address();
          resolve(typeof address === "object" && address ? address.port : port);
        });
      });
    },
    close() {
      for (const room of rooms.values()) {
        clearAction(room);
        cancelIdle(room);
        for (const s of room.seats) clearTakeover(s);
      }
      return new Promise<void>((resolve) => io.close(() => resolve()));
    }
  };
}

function createHealthServer() {
  return createServer((request, response) => {
    const headers = { "content-type": "application/json", "access-control-allow-origin": "*" };
    if (request.url === "/health" || request.url === "/") {
      response.writeHead(200, headers);
      response.end(JSON.stringify({ ok: true, service: "hearts" }));
      return;
    }
    response.writeHead(404, headers);
    response.end(JSON.stringify({ ok: false }));
  });
}

function makeCode() {
  return Array.from({ length: 5 }, () => ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)]).join("");
}

function ackOk<T>(ack: Ack<T>, data: T) {
  if (typeof ack === "function") ack({ ok: true, data });
}

function ackFail<T>(ack: Ack<T>, message: string) {
  if (typeof ack === "function") ack({ ok: false, message });
}

const isDirectRun = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isDirectRun) {
  const server = createHeartsServer();
  const shutDown = () => server.close().finally(() => process.exit(0));
  process.once("SIGTERM", shutDown);
  process.once("SIGINT", shutDown);
  server
    .listen()
    .then((port) => process.stdout.write(`Hearts server listening on ${process.env.HOST || "127.0.0.1"}:${port}\n`))
    .catch((error: unknown) => {
      process.stderr.write(`${String(error)}\n`);
      process.exitCode = 1;
    });
}

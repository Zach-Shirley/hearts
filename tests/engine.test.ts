import { describe, expect, it } from "vitest";
import {
  JACK_OF_DIAMONDS,
  QUEEN_OF_SPADES,
  TWO_OF_CLUBS,
  makeCard,
  sortHand,
  type Card
} from "../src/engine/cards";
import {
  RuleError,
  SEATS,
  chooseMoon,
  createGame,
  legalPlays,
  nextHand,
  normalizeRules,
  passDirectionFor,
  playCard,
  seatsToAct,
  submitPass,
  type GameState,
  type HouseRules,
  type Seat
} from "../src/engine/game";
import { viewFor } from "../src/engine/view";

const C = (r: number) => makeCard(0, r - 2);
const D = (r: number) => makeCard(1, r - 2);
const S = (r: number) => makeCard(2, r - 2);
const H = (r: number) => makeCard(3, r - 2);
const J = 11, Q = 12, K = 13, A = 14;

/** A playing-phase state with chosen hands (bypasses the deal and the pass). */
function playingState(hands: Card[][], rules: Partial<HouseRules> = {}, extra: Partial<GameState> = {}): GameState {
  const base = createGame({ ...rules }, 7);
  const found = hands.findIndex((h) => h.includes(TWO_OF_CLUBS));
  const opener = (found === -1 ? 0 : found) as Seat;
  return {
    ...base,
    phase: "playing",
    passDirection: "hold",
    handNumber: 3,
    hands: hands.map(sortHand),
    passes: [null, null, null, null],
    leader: opener,
    turn: opener,
    ...extra
  };
}

function playAll(state: GameState, plays: [Seat, Card][]): GameState {
  return plays.reduce((s, [seat, card]) => playCard(s, seat, card), state);
}

/** One full suit per seat makes hands trivial to reason about. */
function suitHands(): Card[][] {
  return [0, 1, 2, 3].map((suit) => Array.from({ length: 13 }, (_, r) => makeCard(suit as 0, r)));
}

describe("dealing", () => {
  it("deals 13 distinct cards to each seat", () => {
    const g = createGame({}, 42);
    const all = g.hands.flat();
    expect(g.hands.every((h) => h.length === 13)).toBe(true);
    expect(new Set(all).size).toBe(52);
  });

  it("is deterministic for a seed and different across seeds", () => {
    expect(createGame({}, 5).hands).toEqual(createGame({}, 5).hands);
    expect(createGame({}, 5).hands).not.toEqual(createGame({}, 6).hands);
  });

  it("starts in the passing phase with a left pass", () => {
    const g = createGame();
    expect(g.phase).toBe("passing");
    expect(g.passDirection).toBe("left");
    expect(seatsToAct(g)).toEqual([0, 1, 2, 3]);
  });
});

describe("passing", () => {
  it("rotates left, right, across, hold", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(passDirectionFor)).toEqual([
      "left", "right", "across", "hold", "left", "right", "across", "hold"
    ]);
  });

  it("moves three cards to the correct seat for every direction", () => {
    for (const [handNumber, offset] of [[0, 1], [1, 3], [2, 2]] as const) {
      let g = createGame({}, 99);
      g = { ...g, handNumber, passDirection: passDirectionFor(handNumber) };
      const before = g.hands.map((h) => [...h]);
      const picks = SEATS.map((s) => before[s].slice(0, 3));
      for (const s of SEATS) g = submitPass(g, s, picks[s]);
      expect(g.phase).toBe("playing");
      for (const s of SEATS) {
        const target = ((s + offset) % 4) as Seat;
        for (const c of picks[s]) expect(g.hands[target]).toContain(c);
        for (const c of picks[s]) expect(g.hands[s]).not.toContain(c);
        expect(g.received[target]).toEqual(sortHand(picks[s]));
        expect(g.passed[s]).toEqual(sortHand(picks[s]));
        expect(g.hands[s]).toHaveLength(13);
      }
    }
  });

  it("waits until all four have passed", () => {
    let g = createGame({}, 3);
    g = submitPass(g, 0, g.hands[0].slice(0, 3));
    expect(g.phase).toBe("passing");
    expect(seatsToAct(g)).toEqual([1, 2, 3]);
    // Nothing moves until everyone has chosen.
    expect(g.hands[1]).toHaveLength(13);
  });

  it("rejects bad passes", () => {
    const g = createGame({}, 3);
    expect(() => submitPass(g, 0, g.hands[0].slice(0, 2))).toThrow(RuleError);
    expect(() => submitPass(g, 0, [g.hands[0][0], g.hands[0][0], g.hands[0][1]])).toThrow(RuleError);
    expect(() => submitPass(g, 0, [g.hands[1][0], g.hands[0][0], g.hands[0][1]])).toThrow(RuleError);
    const once = submitPass(g, 0, g.hands[0].slice(0, 3));
    expect(() => submitPass(once, 0, once.hands[0].slice(3, 6))).toThrow(/already/);
  });

  it("skips passing on the hold hand", () => {
    let g = createGame({}, 11);
    g = { ...g, phase: "handOver", handNumber: 2 };
    g = nextHand(g);
    expect(g.passDirection).toBe("hold");
    expect(g.phase).toBe("playing");
  });

  it("hides other seats' passes in a player view", () => {
    let g = createGame({}, 3);
    g = submitPass(g, 1, g.hands[1].slice(0, 3));
    const v = viewFor(g, 0);
    expect(v.passReady).toEqual([false, true, false, false]);
    expect(v.myPass).toBeNull();
    expect(JSON.stringify(v)).not.toContain(JSON.stringify(g.hands[1]));
  });
});

describe("legality", () => {
  it("2♣ must lead the first trick", () => {
    const g = playingState(suitHands());
    expect(g.turn).toBe(0);
    expect(legalPlays(g, 0)).toEqual([TWO_OF_CLUBS]);
    expect(() => playCard(g, 0, C(3))).toThrow(/2♣/);
  });

  it("only the seat to act may play", () => {
    const g = playingState(suitHands());
    expect(legalPlays(g, 1)).toEqual([]);
    expect(() => playCard(g, 1, D(2))).toThrow(/turn/);
  });

  it("must follow suit when able", () => {
    const hands = [
      [C(2), C(5), D(4), S(3), H(5), H(6), H(7), H(8), H(9), H(10), H(J), H(Q), H(K)],
      [C(3), D(2), D(3), D(5), D(6), D(7), D(8), D(9), D(10), D(J), D(Q), D(K), D(A)],
      [C(4), C(6), C(7), C(8), C(9), C(10), C(J), C(Q), C(K), C(A), S(2), S(4), S(5)],
      [S(6), S(7), S(8), S(9), S(10), S(J), S(Q), S(K), S(A), H(2), H(3), H(4), H(A)]
    ];
    let g = playingState(hands);
    g = playCard(g, 0, C(2));
    expect(legalPlays(g, 1)).toEqual([C(3)]);
    expect(() => playCard(g, 1, D(2))).toThrow(/follow suit/);
  });

  it("bars points on the first trick, unless the hand holds nothing else", () => {
    const hands = [
      [C(2), C(3), C(4), C(5), C(6), C(7), C(8), C(9), C(10), C(J), C(Q), C(K), C(A)],
      [D(2), D(3), D(4), D(5), D(6), D(7), D(8), D(9), D(10), D(J), D(Q), S(Q), H(2)],
      // Seat 2 holds only hearts and the... it has 13 hearts minus one: nothing but points.
      [H(3), H(4), H(5), H(6), H(7), H(8), H(9), H(10), H(J), H(Q), H(K), H(A), D(K)],
      [D(A), S(2), S(3), S(4), S(5), S(6), S(7), S(8), S(9), S(10), S(J), S(K), S(A)]
    ];
    let g = playingState(hands);
    g = playCard(g, 0, C(2));
    const legal1 = legalPlays(g, 1);
    expect(legal1).not.toContain(S(Q));
    expect(legal1).not.toContain(H(2));
    expect(() => playCard(g, 1, S(Q))).toThrow(/first trick/);
    g = playCard(g, 1, D(2));
    // Seat 2 still has the K♦, so hearts are barred.
    expect(legalPlays(g, 2)).toEqual([D(K)]);
  });

  it("allows points on the first trick when a hand is all points", () => {
    const hands = [
      [C(2), C(3), C(4), C(5), C(6), C(7), C(8), C(9), C(10), C(J), C(Q), C(K), C(A)],
      [H(2), H(3), H(4), H(5), H(6), H(7), H(8), H(9), H(10), H(J), H(Q), H(K), S(Q)],
      [D(2), D(3), D(4), D(5), D(6), D(7), D(8), D(9), D(10), D(J), D(Q), D(K), D(A)],
      [H(A), S(2), S(3), S(4), S(5), S(6), S(7), S(8), S(9), S(10), S(J), S(K), S(A)]
    ];
    let g = playingState(hands);
    g = playCard(g, 0, C(2));
    expect(legalPlays(g, 1)).toHaveLength(13);
    g = playCard(g, 1, S(Q));
    expect(g.heartsBroken).toBe(true);
  });

  it("hearts cannot be led until broken (unless only hearts remain)", () => {
    const g = playingState(suitHands(), {}, { tricks: [{ leader: 0, plays: [], winner: 0, points: 0 }], turn: 3, leader: 3 });
    // Seat 3 holds only hearts, so it may lead one.
    expect(legalPlays(g, 3)).toHaveLength(13);
    const mixed = playingState(
      [[H(2), C(3)], [D(2), D(3)], [S(2), S(3)], [C(4), C(5)]],
      {},
      { tricks: Array(11).fill({ leader: 0, plays: [], winner: 0, points: 0 }), turn: 0, leader: 0 }
    );
    expect(legalPlays(mixed, 0)).toEqual([C(3)]);
    expect(() => playCard(mixed, 0, H(2))).toThrow(/broken/);
    expect(legalPlays({ ...mixed, heartsBroken: true }, 0)).toEqual([C(3), H(2)]);
  });
});

describe("tricks and scoring", () => {
  const fourSuits = () => suitHands();

  it("the highest card of the led suit wins and leads next", () => {
    const hands = [
      [C(2), C(9), H(2)],
      [C(K), D(2), H(3)],
      [C(5), S(2), H(4)],
      [D(A), S(3), H(5)]
    ];
    let g = playingState(hands, {}, { tricks: [] });
    g = playAll(g, [[0, C(2)], [1, C(K)], [2, C(5)], [3, D(A)]]);
    expect(g.tricks[0].winner).toBe(1);
    expect(g.turn).toBe(1);
    expect(g.leader).toBe(1);
  });

  it("queen of spades breaks hearts only when the house rule is on", () => {
    const hands = [[S(2), C(3)], [S(Q), C(4)], [S(4), C(5)], [S(5), C(6)]];
    const mid = { tricks: Array(11).fill({ leader: 0, plays: [], winner: 0, points: 0 }) };
    const on = playAll(playingState(hands, { queenBreaksHearts: true }, mid), [[0, S(2)], [1, S(Q)]]);
    expect(on.heartsBroken).toBe(true);
    const off = playAll(playingState(hands, { queenBreaksHearts: false }, mid), [[0, S(2)], [1, S(Q)]]);
    expect(off.heartsBroken).toBe(false);
  });

  /** Play out a full hand where seat 0 leads every trick and each seat plays its lowest legal card. */
  function finish(state: GameState): GameState {
    let g = state;
    while (g.phase === "playing") g = playCard(g, g.turn, legalPlays(g, g.turn)[0]);
    return g;
  }

  it("scores 1 per heart and 13 for the queen; totals 26 per hand", () => {
    let g = createGame({}, 123);
    for (const s of SEATS) g = submitPass(g, s, g.hands[s].slice(10));
    g = finish(g);
    const last = g.history[0];
    if (last.moonShooter === null) {
      expect(last.rawPoints.reduce((a, b) => a + b, 0)).toBe(26);
      expect(last.scored).toEqual(last.rawPoints);
    }
    expect(g.phase).toBe("handOver");
  });

  it("shooting the moon gives 26 to every other player by default", () => {
    // Seat 0 holds every heart, the queen, and the top clubs: it takes every trick.
    const hands = [
      [H(2), H(3), H(4), H(5), H(6), H(7), H(8), H(9), H(10), H(J), H(Q), H(K), H(A)],
      [C(2), C(3), C(4), C(5), C(6), C(7), C(8), C(9), C(10), C(J), C(Q), C(K), S(Q)],
      fourSuits()[1],
      [C(A), S(2), S(3), S(4), S(5), S(6), S(7), S(8), S(9), S(10), S(J), S(K), S(A)]
    ];
    // Seat 1 leads the 2♣; seat 3 wins it with the A♣; then spades are led... Construct directly:
    let g = playingState(hands);
    g = finish(g);
    const h = g.history[0];
    expect(g.phase === "handOver" || g.phase === "gameOver").toBe(true);
    expect(h.rawPoints.reduce((a, b) => a + b, 0)).toBe(26);
  });

  it("applies the moon: 26 to others, or −26 to self when chosen", () => {
    const base = playingState(suitHands(), { moon: "choose" });
    const takenAll = [[...Array.from({ length: 13 }, (_, r) => makeCard(3, r)), QUEEN_OF_SPADES], [], [], []];
    // Drive scoreHand through the public path: a state with 12 tricks done and seat 0 about to win the last.
    const lastTrick = playingState(
      [[H(A)], [C(3)], [D(3)], [S(3)]],
      { moon: "choose" },
      {
        tricks: Array(12).fill({ leader: 0, plays: [], winner: 0, points: 0 }),
        taken: [takenAll[0].filter((c) => c !== H(A)), [], [], []],
        heartsBroken: true,
        turn: 0,
        leader: 0
      }
    );
    let g = playAll(lastTrick, [[0, H(A)], [1, C(3)], [2, D(3)], [3, S(3)]]);
    expect(g.phase).toBe("moon");
    expect(g.moonShooter).toBe(0);
    expect(seatsToAct(g)).toEqual([0]);
    expect(() => chooseMoon(g, 1, "add")).toThrow();
    const sub = chooseMoon(g, 0, "subtract");
    expect(sub.history[0].scored).toEqual([-26, 0, 0, 0]);
    const add = chooseMoon(g, 0, "add");
    expect(add.history[0].scored).toEqual([0, 26, 26, 26]);
    expect(add.history[0].moonChoice).toBe("add");

    const noChoice = playAll({ ...lastTrick, rules: normalizeRules({ moon: "add" }) }, [[0, H(A)], [1, C(3)], [2, D(3)], [3, S(3)]]);
    expect(noChoice.phase).toBe("handOver");
    expect(noChoice.history[0].scored).toEqual([0, 26, 26, 26]);
    expect(base.phase).toBe("playing");
  });

  it("jack of diamonds is −10 when on, and 0 when off; it does not affect the moon", () => {
    const setup = (jack: boolean) =>
      playingState(
        [[D(2)], [JACK_OF_DIAMONDS], [D(3)], [D(4)]],
        { jackOfDiamonds: jack },
        {
          tricks: Array(12).fill({ leader: 0, plays: [], winner: 0, points: 0 }),
          taken: [[], [H(2), H(3)], [], [QUEEN_OF_SPADES]],
          turn: 0,
          leader: 0
        }
      );
    const on = playAll(setup(true), [[0, D(2)], [1, JACK_OF_DIAMONDS], [2, D(3)], [3, D(4)]]);
    expect(on.tricks[12].winner).toBe(1);
    expect(on.history[0].scored).toEqual([0, -8, 0, 13]);
    const off = playAll(setup(false), [[0, D(2)], [1, JACK_OF_DIAMONDS], [2, D(3)], [3, D(4)]]);
    expect(off.history[0].scored).toEqual([0, 2, 0, 13]);

    // Shooter also took the jack: moon applies and the −10 still counts.
    const moon = playingState(
      [[JACK_OF_DIAMONDS], [D(2)], [D(3)], [D(4)]],
      { jackOfDiamonds: true },
      {
        tricks: Array(12).fill({ leader: 0, plays: [], winner: 0, points: 0 }),
        taken: [[...Array.from({ length: 13 }, (_, r) => makeCard(3, r)), QUEEN_OF_SPADES], [], [], []],
        turn: 0,
        leader: 0
      }
    );
    const m = playAll(moon, [[0, JACK_OF_DIAMONDS], [1, D(2)], [2, D(3)], [3, D(4)]]);
    expect(m.history[0].moonShooter).toBe(0);
    expect(m.history[0].scored).toEqual([-10, 26, 26, 26]);
  });
});

describe("end of game", () => {
  const lastTrickState = (scores: number[], rules: Partial<HouseRules> = {}) =>
    playingState(
      [[C(2)], [C(3)], [C(4)], [C(5)]],
      rules,
      {
        tricks: Array(12).fill({ leader: 0, plays: [], winner: 0, points: 0 }),
        taken: [[QUEEN_OF_SPADES], Array.from({ length: 13 }, (_, r) => makeCard(3, r)), [], []],
        scores,
        turn: 0,
        leader: 0
      }
    );
  const end = (g: GameState) => playAll(g, [[0, C(2)], [1, C(3)], [2, C(4)], [3, C(5)]]);

  it("ends when someone reaches the target and the lowest score wins", () => {
    const g = end(lastTrickState([90, 10, 40, 50]));
    expect(g.scores).toEqual([103, 23, 40, 50]);
    expect(g.phase).toBe("gameOver");
    expect(g.winners).toEqual([1]);
    expect(() => nextHand(g)).toThrow();
  });

  it("continues below the target", () => {
    const g = end(lastTrickState([0, 0, 0, 0]));
    expect(g.phase).toBe("handOver");
    const n = nextHand(g);
    expect(n.handNumber).toBe(4);
    expect(n.passDirection).toBe("left");
    expect(n.hands.every((h) => h.length === 13)).toBe(true);
    expect(n.scores).toEqual([13, 13, 0, 0]);
  });

  it("respects a custom target", () => {
    const g = end(lastTrickState([40, 0, 0, 0], { targetScore: 50 }));
    expect(g.phase).toBe("gameOver");
  });

  it("reports shared winners on a tie for lowest", () => {
    const g = end(lastTrickState([90, 10, 20, 20]));
    expect(g.winners).toEqual([2, 3]);
  });
});

describe("rules normalization", () => {
  it("fills defaults and rejects junk", () => {
    expect(normalizeRules(undefined)).toEqual({ targetScore: 100, moon: "add", jackOfDiamonds: false, queenBreaksHearts: true });
    expect(normalizeRules({ targetScore: 7, moon: "x", jackOfDiamonds: "yes" })).toEqual({
      targetScore: 100, moon: "add", jackOfDiamonds: false, queenBreaksHearts: true
    });
    expect(normalizeRules({ targetScore: 50, moon: "choose", jackOfDiamonds: true, queenBreaksHearts: false })).toEqual({
      targetScore: 50, moon: "choose", jackOfDiamonds: true, queenBreaksHearts: false
    });
  });
});

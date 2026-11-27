import { describe, expect, it } from "vitest";
import { QUEEN_OF_SPADES, makeCard, suitOf } from "../src/engine/cards";
import { SEATS, createGame, nextHand, playCard, submitPass, type GameState, type Seat } from "../src/engine/game";
import { makeRng } from "../src/engine/rng";
import { viewFor } from "../src/engine/view";
import { botAct, botMoon, botPass, botPlay, inferKnowledge, sampleDeal, strategicPass, DIFFICULTIES } from "../src/bots/bots";
import { simulate } from "../src/bots/simulate";

const S = (r: number) => makeCard(2, r - 2);
const H = (r: number) => makeCard(3, r - 2);
const C = (r: number) => makeCard(0, r - 2);
const D = (r: number) => makeCard(1, r - 2);

/** Eleven plausible finished tricks using every card not in `inHands`, won in turn by each seat. */
function pastTricks(inHands: number[]) {
  const rest = Array.from({ length: 52 }, (_, i) => i).filter((c) => !inHands.includes(c));
  return Array.from({ length: 11 }, (_, t) => ({
    leader: 0 as Seat,
    plays: [0, 1, 2, 3].map((s) => ({ seat: s as Seat, card: rest[t * 4 + s] })),
    winner: (t % 4) as Seat,
    points: 0
  }));
}

describe("bots", () => {
  it("every difficulty only makes legal moves through full games", () => {
    for (const d of DIFFICULTIES) {
      const rng = makeRng(5);
      let g: GameState = createGame({ jackOfDiamonds: true, moon: "choose", targetScore: 50 }, 17);
      let guard = 0;
      while (g.phase !== "gameOver" && guard++ < 2000) {
        if (g.phase === "handOver") {
          g = nextHand(g);
          continue;
        }
        const actors: Seat[] = g.phase === "passing" ? SEATS.filter((s) => !g.passes[s]) : [g.turn];
        // botAct goes through submitPass / playCard, which throw on anything illegal.
        for (const s of actors) g = botAct(g, s, d, { rng, samples: 12 });
      }
      expect(g.phase).toBe("gameOver");
    }
  });

  it("passes three distinct cards from its own hand", () => {
    const g = createGame({}, 8);
    for (const d of DIFFICULTIES) {
      for (const s of SEATS) {
        const pass = botPass(viewFor(g, s), d, { rng: makeRng(1) });
        expect(new Set(pass).size).toBe(3);
        for (const c of pass) expect(g.hands[s]).toContain(c);
      }
    }
  });

  it("strategic pass dumps an unguarded queen and high spades, keeps a guarded queen", () => {
    const rules = createGame().rules;
    const naked = [S(12), S(14), S(13), C(3), C(4), C(5), D(2), D(3), D(4), H(2), H(3), H(4), H(5)];
    expect(strategicPass(naked, rules, "left")).toEqual(expect.arrayContaining([S(12), S(13), S(14)]));
    const guarded = [S(12), S(2), S(3), S(4), S(5), C(14), C(13), D(14), D(4), H(2), H(3), H(4), H(5)];
    expect(strategicPass(guarded, rules, "left")).not.toContain(QUEEN_OF_SPADES);
  });

  it("Normal and Hard drop the queen under a high spade", () => {
    // Seat 0 leads A♠, seat 1 holds Q♠ and 3♠. Keeping the queen would force it to win the 2♠ next trick.
    let g = createGame({}, 1);
    g = {
      ...g,
      phase: "playing",
      passDirection: "hold",
      hands: [[S(2), S(14)], [S(3), S(12)], [D(3), D(4)], [D(5), D(6)]],
      tricks: pastTricks([S(14), S(2), S(12), S(3), D(3), D(4), D(5), D(6)]),
      heartsBroken: true,
      leader: 0,
      turn: 0
    };
    g = playCard(g, 0, S(14));
    for (const d of ["normal", "hard"] as const) expect(botPlay(viewFor(g, 1), d, { rng: makeRng(2), samples: 30 })).toBe(QUEEN_OF_SPADES);
  });

  it("samples deals that respect counts, voids and passed cards", () => {
    let g = createGame({}, 21);
    const passes = SEATS.map((s) => g.hands[s].slice(0, 3));
    for (const s of SEATS) g = submitPass(g, s, passes[s]);
    // Play a few tricks with legal-first moves.
    for (let i = 0; i < 14; i++) g = playCard(g, g.turn, viewFor(g, g.turn).legal[0]);
    const v = viewFor(g, g.turn);
    const k = inferKnowledge(v);
    const rng = makeRng(3);
    for (let i = 0; i < 50; i++) {
      const deal = sampleDeal(v, rng, k);
      expect(deal[v.seat]).toEqual(v.hand);
      for (const s of SEATS) {
        expect(deal[s]).toHaveLength(v.handCounts[s]);
        for (const c of k.known[s]) expect(deal[s]).toContain(c);
        if (s !== v.seat) for (const c of deal[s]) expect(k.voids[s][suitOf(c)]).toBe(false);
      }
      const all = [...deal.flat(), ...k.played];
      expect(new Set(all).size).toBe(52);
    }
  });

  it("moon choice: add when it wins, subtract when adding would lose", () => {
    const g = createGame({ moon: "choose" }, 1);
    const view = (scores: number[]) => ({ ...viewFor({ ...g, scores }, 0) });
    expect(botMoon(view([60, 80, 85, 90]))).toBe("add");
    expect(botMoon(view([90, 50, 60, 70]))).toBe("subtract");
    expect(botMoon(view([10, 20, 30, 40]))).toBe("add");
    expect(botMoon(view([40, 10, 20, 30]))).toBe("subtract");
  });

  it("Hard beats Easy in a short seeded match", () => {
    const r = simulate(["hard", "easy", "easy", "easy"], 8, { seed: 9, samples: 16 });
    const hard = r.byDifficulty.hard;
    const easy = r.byDifficulty.easy;
    expect(hard.points / hard.hands).toBeLessThan(easy.points / easy.hands);
  }, 60_000);
});

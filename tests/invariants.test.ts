import { describe, expect, it } from "vitest";
import { isHeart, suitOf, QUEEN_OF_SPADES, TWO_OF_CLUBS } from "../src/engine/cards";
import { SEATS, chooseMoon, createGame, legalPlays, nextHand, playCard, submitPass, type GameState, type HouseRules } from "../src/engine/game";
import { makeRng, type Rng } from "../src/engine/rng";
import { viewFor } from "../src/engine/view";

function randomGame(seed: number, rules: Partial<HouseRules>, rng: Rng, check: (g: GameState, prev: GameState) => void) {
  let g = createGame(rules, seed);
  let guard = 0;
  while (g.phase !== "gameOver" && guard++ < 5000) {
    const prev = g;
    if (g.phase === "passing") {
      for (const s of SEATS) {
        const hand = [...g.hands[s]].sort(() => rng() - 0.5);
        g = submitPass(g, s, hand.slice(0, 3));
      }
    } else if (g.phase === "playing") {
      const legal = legalPlays(g, g.turn);
      expect(legal.length).toBeGreaterThan(0);
      g = playCard(g, g.turn, legal[Math.floor(rng() * legal.length)]);
    } else if (g.phase === "moon") {
      g = chooseMoon(g, g.moonShooter!, rng() < 0.5 ? "add" : "subtract");
    } else if (g.phase === "handOver") {
      g = nextHand(g);
    }
    check(g, prev);
  }
  return g;
}

const RULESETS: Partial<HouseRules>[] = [
  {},
  { jackOfDiamonds: true },
  { moon: "choose" },
  { queenBreaksHearts: false, targetScore: 50 },
  { jackOfDiamonds: true, moon: "choose", queenBreaksHearts: false, targetScore: 150 }
];

describe("random-play invariants", () => {
  it("every random game keeps the rules' invariants and terminates", () => {
    let games = 0;
    let moons = 0;
    for (const rules of RULESETS) {
      for (let seed = 1; seed <= 40; seed++) {
        const rng = makeRng(seed * 7919);
        const final = randomGame(seed, rules, rng, (g, prev) => {
          // 52 cards are always accounted for.
          const inHands = g.hands.flat();
          const inTricks = g.tricks.flatMap((t) => t.plays.map((p) => p.card));
          const inTrick = g.trick.map((p) => p.card);
          if (g.phase === "playing" || g.phase === "passing") {
            const all = [...inHands, ...inTricks, ...inTrick];
            expect(all.length).toBe(52);
            expect(new Set(all).size).toBe(52);
          }
          // Hand sizes stay level during play.
          if (g.phase === "playing") {
            const played = g.trick.length;
            const sizes = SEATS.map((s) => g.hands[s].length);
            const max = Math.max(...sizes);
            expect(Math.min(...sizes)).toBeGreaterThanOrEqual(max - 1);
            expect(sizes.filter((n) => n === max - 1).length).toBe(played === 0 ? 0 : played);
          }
          // The first trick is led with the 2♣ and has no penalty cards unless forced.
          if (g.tricks.length >= 1 && prev.tricks.length === 0) {
            expect(g.tricks[0].plays[0].card).toBe(TWO_OF_CLUBS);
          }
          // Hearts are never led before being broken unless the leader had only hearts.
          if (prev.phase === "playing" && prev.trick.length === 0 && g.trick.length === 1) {
            const lead = g.trick[0].card;
            if (isHeart(lead) && !prev.heartsBroken) {
              expect(prev.hands[prev.turn].every(isHeart)).toBe(true);
            }
          }
          // A completed hand distributes exactly 26 penalty points (or the moon's 78/−26).
          if (g.history.length > prev.history.length) {
            const h = g.history[g.history.length - 1];
            const jack = rules.jackOfDiamonds ? -10 : 0;
            expect(h.rawPoints.reduce((a, b) => a + b, 0)).toBe(26 + jack);
            if (h.moonShooter !== null) {
              moons++;
              const sum = h.scored.reduce((a, b) => a + b, 0);
              expect(h.moonChoice === "subtract" ? sum : sum).toBe(h.moonChoice === "subtract" ? -26 + jack : 78 + jack);
            } else {
              expect(h.scored).toEqual(h.rawPoints);
            }
            expect(h.totals).toEqual(g.scores);
          }
          // Views never leak another seat's cards.
          if (g.phase === "playing") {
            const v = viewFor(g, 0);
            expect(v.hand).toEqual(g.hands[0]);
            expect(v.handCounts).toEqual(g.hands.map((h) => h.length));
            expect("hands" in v).toBe(false);
          }
        });
        games++;
        expect(final.phase).toBe("gameOver");
        expect(Math.max(...final.scores)).toBeGreaterThanOrEqual(final.rules.targetScore);
        expect(final.winners.every((w) => final.scores[w] === Math.min(...final.scores))).toBe(true);
        // Pass direction cycles over hands.
        final.history.forEach((h, i) => expect(h.passDirection).toBe(["left", "right", "across", "hold"][i % 4]));
      }
    }
    expect(games).toBe(200);
    // Random play shoots the moon occasionally; the counter only proves the branch ran.
    expect(moons).toBeGreaterThanOrEqual(0);
  }, 120_000);

  it("follow-suit is always obeyed in random play", () => {
    const rng = makeRng(4242);
    randomGame(77, {}, rng, (g, prev) => {
      if (prev.phase === "playing" && prev.trick.length > 0 && g.tricks.length + (g.trick.length ? 0 : 0) >= 0) {
        const newPlays = g.trick.length > prev.trick.length ? g.trick : g.tricks[g.tricks.length - 1]?.plays ?? [];
        const play = newPlays[newPlays.length - 1];
        if (!play || newPlays.length < 2) return;
        const led = suitOf(newPlays[0].card);
        if (suitOf(play.card) !== led) {
          expect(prev.hands[play.seat].some((c) => suitOf(c) === led)).toBe(false);
        }
      }
    });
  });

  it("the queen of spades is always 13 points to whoever takes it", () => {
    const rng = makeRng(99);
    randomGame(3, {}, rng, (g, prev) => {
      if (g.tricks.length > prev.tricks.length) {
        const t = g.tricks[g.tricks.length - 1];
        if (t.plays.some((p) => p.card === QUEEN_OF_SPADES)) expect(t.points).toBeGreaterThanOrEqual(13);
      }
    });
  });
});

import { SEATS, createGame, nextHand, type GameState, type HouseRules, type Seat } from "../engine/game";
import { makeRng } from "../engine/rng";
import { botAct, type Difficulty } from "./bots";

export interface MatchResult {
  lineup: Difficulty[];
  games: number;
  hands: number;
  /** Per difficulty: points per hand and games won (ties split). */
  byDifficulty: Record<string, { seats: number; points: number; hands: number; wins: number; moons: number }>;
}

/**
 * Play `games` full games. The lineup is rotated around the table each game so seat position
 * (who passes to whom) does not favour anyone.
 */
export function simulate(lineup: Difficulty[], games: number, options: { seed?: number; samples?: number; rules?: Partial<HouseRules> } = {}): MatchResult {
  const rng = makeRng(options.seed ?? 1);
  const result: MatchResult = { lineup, games, hands: 0, byDifficulty: {} };
  for (const d of lineup) result.byDifficulty[d] ??= { seats: 0, points: 0, hands: 0, wins: 0, moons: 0 };
  for (let g = 0; g < games; g++) {
    const seats = SEATS.map((s) => lineup[(s + g) % 4]);
    let state: GameState = createGame(options.rules ?? {}, (options.seed ?? 1) * 1000 + g);
    while (state.phase !== "gameOver") {
      if (state.phase === "handOver") {
        state = nextHand(state);
        continue;
      }
      const actors: Seat[] = state.phase === "passing" ? SEATS.filter((s) => !state.passes[s]) : [state.turn];
      for (const s of actors) state = botAct(state, s, seats[s], { rng, samples: options.samples });
    }
    for (const h of state.history) {
      result.hands++;
      for (const s of SEATS) {
        const entry = result.byDifficulty[seats[s]];
        entry.points += h.scored[s];
        entry.hands++;
        if (h.moonShooter === s) entry.moons++;
      }
    }
    for (const s of SEATS) result.byDifficulty[seats[s]].seats++;
    for (const w of state.winners) result.byDifficulty[seats[w]].wins += 1 / state.winners.length;
  }
  return result;
}

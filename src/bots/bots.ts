import {
  ACE_OF_SPADES,
  HEARTS,
  JACK_OF_DIAMONDS,
  KING_OF_SPADES,
  QUEEN_OF_SPADES,
  SPADES,
  isHeart,
  rankOf,
  suitOf,
  type Card
} from "../engine/cards";
import {
  chooseMoon,
  isPenaltyCard,
  legalFromHand,
  passTarget,
  playCard,
  submitPass,
  type GameState,
  type HouseRules,
  type Play,
  type Seat
} from "../engine/game";
import type { Rng } from "../engine/rng";
import { viewFor, type PlayerView } from "../engine/view";
import { heuristicPlay, shootPlay, type PlayContext } from "./heuristic";

export type Difficulty = "easy" | "normal" | "hard";
export const DIFFICULTIES: readonly Difficulty[] = ["easy", "normal", "hard"];

export interface BotOptions {
  rng?: Rng;
  /** Hard only: number of sampled deals per decision. */
  samples?: number;
}

// ---------------------------------------------------------------- shared context

export function contextFromView(view: PlayerView): PlayContext {
  const played = new Array<boolean>(52).fill(false);
  const suitLeads = [0, 0, 0, 0];
  const penaltyTaken = [0, 0, 0, 0];
  for (const t of view.tricks) {
    suitLeads[suitOf(t.plays[0].card)]++;
    for (const p of t.plays) {
      played[p.card] = true;
      if (isPenaltyCard(p.card)) penaltyTaken[t.winner] += isHeart(p.card) ? 1 : 13;
    }
  }
  for (const p of view.trick) played[p.card] = true;
  return {
    seat: view.seat,
    hand: view.hand,
    legal: view.legal,
    trick: view.trick,
    played,
    penaltyTaken,
    suitLeads,
    rules: view.rules
  };
}

// ---------------------------------------------------------------- passing

/** Easy passes its three highest-ranked cards, without thinking about suits. */
function easyPass(hand: readonly Card[], rng: Rng): Card[] {
  return [...hand]
    .sort((a, b) => rankOf(b) - rankOf(a) || (rng() < 0.5 ? -1 : 1))
    .slice(0, 3);
}

/** Whether a hand is strong enough to keep its high cards and try for the moon. */
export function moonHand(hand: readonly Card[]): boolean {
  const hearts = hand.filter(isHeart);
  const highHearts = hearts.filter((c) => rankOf(c) >= 9).length;
  const highCards = hand.filter((c) => rankOf(c) >= 10).length;
  const lowCards = hand.filter((c) => rankOf(c) <= 4).length;
  return hearts.length >= 6 && highHearts >= 3 && highCards >= 7 && lowCards <= 2;
}

/** Normal and Hard: void short suits, unload dangerous spades and high hearts. */
export function strategicPass(hand: readonly Card[], rules: HouseRules, direction: string): Card[] {
  if (moonHand(hand)) {
    // Keep the power; give away the lowest cards (which could otherwise lose control).
    return [...hand].sort((a, b) => rankOf(a) - rankOf(b)).slice(0, 3);
  }
  const chosen: Card[] = [];
  for (let k = 0; k < 3; k++) {
    const remaining = hand.filter((c) => !chosen.includes(c));
    const count = [0, 0, 0, 0];
    for (const c of remaining) count[suitOf(c)]++;
    const holdsQueen = remaining.includes(QUEEN_OF_SPADES);
    const lowSpades = remaining.filter((c) => suitOf(c) === SPADES && rankOf(c) < 10).length;
    let best = remaining[0];
    let bestScore = -Infinity;
    for (const card of remaining) {
      const suit = suitOf(card);
      const rank = rankOf(card);
      let score: number;
      if (card === QUEEN_OF_SPADES) {
        // Keep a well-guarded queen; otherwise get rid of it.
        score = lowSpades >= 4 ? -40 : 100;
        if (direction === "right" && lowSpades >= 3) score = -10; // the passer on your left can't be fed
      } else if (card === ACE_OF_SPADES || card === KING_OF_SPADES) {
        score = holdsQueen || chosen.includes(QUEEN_OF_SPADES) ? 40 : lowSpades >= 3 ? 25 : 85 + rank;
      } else if (suit === SPADES) {
        score = -20 + rank; // low spades protect against the queen
      } else if (suit === HEARTS) {
        score = rank >= 8 ? rank * 4 : rank - 10;
      } else {
        score = rank * 4;
        if (count[suit] <= 3) score += (4 - count[suit]) * 10; // help make a void
      }
      if (rules.jackOfDiamonds && card === JACK_OF_DIAMONDS) score -= 60;
      if (score > bestScore) {
        bestScore = score;
        best = card;
      }
    }
    chosen.push(best);
  }
  return chosen;
}

export function botPass(view: PlayerView, difficulty: Difficulty, options: BotOptions = {}): Card[] {
  const rng = options.rng ?? Math.random;
  if (difficulty === "easy") return easyPass(view.hand, rng);
  return strategicPass(view.hand, view.rules, view.passDirection);
}

// ---------------------------------------------------------------- moon choice

export function botMoon(view: PlayerView): "add" | "subtract" {
  const me = view.seat;
  const add = view.scores.map((s, i) => s + (i === me ? 0 : 26));
  const sub = view.scores.map((s, i) => s + (i === me ? -26 : 0));
  const target = view.rules.targetScore;
  const outcome = (scores: number[]) => {
    const over = scores.some((s) => s >= target);
    const low = Math.min(...scores);
    return { over, win: scores[me] === low };
  };
  const a = outcome(add);
  const s = outcome(sub);
  if (a.over && a.win) return "add";
  if (a.over && !a.win) return "subtract";
  if (s.over && s.win) return "subtract";
  // Neither ends the game: adding is the same margin and moves the leader closer to the finish.
  return add[me] === Math.min(...add) ? "add" : "subtract";
}

// ---------------------------------------------------------------- playing

function easyPlay(view: PlayerView, rng: Rng): Card {
  const legal = view.legal;
  if (legal.length === 1) return legal[0];
  if (rng() < 0.2) return legal[Math.floor(rng() * legal.length)];
  if (view.trick.length === 0) return legal[0];
  const led = suitOf(view.trick[0].card);
  if (suitOf(legal[0]) === led) return legal[0];
  // Void: throw the highest-ranked card, whatever it is.
  return [...legal].sort((a, b) => rankOf(b) - rankOf(a))[0];
}

export function botPlay(view: PlayerView, difficulty: Difficulty, options: BotOptions = {}): Card {
  const rng = options.rng ?? Math.random;
  if (view.legal.length === 0) throw new Error("No legal play.");
  if (difficulty === "easy") return easyPlay(view, rng);
  if (difficulty === "normal" || view.legal.length === 1) return heuristicPlay(contextFromView(view));
  return monteCarloPlay(view, rng, options.samples ?? 48);
}

// ---------------------------------------------------------------- Hard: Monte Carlo

/** What a seat can infer about where the unseen cards are. */
export function inferKnowledge(view: PlayerView) {
  const voids = [0, 1, 2, 3].map(() => [false, false, false, false]);
  const allTricks: Play[][] = [...view.tricks.map((t) => t.plays), view.trick];
  for (const plays of allTricks) {
    if (!plays.length) continue;
    const led = suitOf(plays[0].card);
    for (const p of plays) if (suitOf(p.card) !== led) voids[p.seat][led] = true;
  }
  const played = new Set<Card>(allTricks.flat().map((p) => p.card));
  // Cards we passed are in the receiver's hand until they show up.
  const known: Card[][] = [[], [], [], []];
  if (view.passDirection !== "hold" && view.phase === "playing") {
    const target = passTarget(view.seat, view.passDirection);
    for (const c of view.passed) if (!played.has(c)) known[target].push(c);
  }
  return { voids, played, known };
}

/** Deal the unseen cards to the other seats consistently with what is known. */
export function sampleDeal(view: PlayerView, rng: Rng, knowledge = inferKnowledge(view)): Card[][] {
  const { voids, played, known } = knowledge;
  const mine = new Set(view.hand);
  const knownSet = new Set(known.flat());
  const unknown: Card[] = [];
  for (let c = 0; c < 52; c++) if (!played.has(c) && !mine.has(c) && !knownSet.has(c)) unknown.push(c);

  for (let attempt = 0; attempt < 30; attempt++) {
    const hands: Card[][] = [[], [], [], []];
    const capacity = view.handCounts.map((n, s) => (s === view.seat ? 0 : n - known[s].length));
    for (let s = 0; s < 4; s++) hands[s].push(...known[s]);
    hands[view.seat] = [...view.hand];
    const ignoreVoids = attempt >= 25;
    // Most-constrained cards first, randomised within equal constraint.
    const order = unknown
      .map((card) => ({ card, key: rng(), eligible: [0, 1, 2, 3].filter((s) => s !== view.seat && (ignoreVoids || !voids[s][suitOf(card)])).length }))
      .sort((a, b) => a.eligible - b.eligible || a.key - b.key);
    let ok = true;
    for (const { card } of order) {
      const options: number[] = [];
      for (let s = 0; s < 4; s++) {
        if (s !== view.seat && capacity[s] > 0 && (ignoreVoids || !voids[s][suitOf(card)])) {
          for (let k = 0; k < capacity[s]; k++) options.push(s);
        }
      }
      if (!options.length) {
        ok = false;
        break;
      }
      const s = options[Math.floor(rng() * options.length)];
      hands[s].push(card);
      capacity[s]--;
    }
    if (ok) return hands.map((h) => h.sort((a, b) => a - b));
  }
  throw new Error("Could not sample a deal.");
}

interface SimState {
  hands: Card[][];
  trick: Play[];
  tricksDone: number;
  heartsBroken: boolean;
  played: boolean[];
  penaltyTaken: number[];
  penaltyCards: number[];
  rawPoints: number[];
  suitLeads: number[];
  turn: Seat;
}

function simFromView(view: PlayerView, hands: Card[][]): SimState {
  const ctx = contextFromView(view);
  const penaltyCards = [0, 0, 0, 0];
  const rawPoints = [0, 0, 0, 0];
  for (let s = 0; s < 4; s++) {
    for (const c of view.taken[s]) {
      if (isPenaltyCard(c)) penaltyCards[s]++;
      rawPoints[s] += isHeart(c) ? 1 : c === QUEEN_OF_SPADES ? 13 : c === JACK_OF_DIAMONDS && view.rules.jackOfDiamonds ? -10 : 0;
    }
  }
  return {
    hands,
    trick: [...view.trick],
    tricksDone: view.tricks.length,
    heartsBroken: view.heartsBroken,
    played: [...(ctx.played as boolean[])],
    penaltyTaken: [...ctx.penaltyTaken],
    penaltyCards,
    rawPoints,
    suitLeads: [...ctx.suitLeads],
    turn: view.turn
  };
}

function simPlay(sim: SimState, card: Card, rules: HouseRules) {
  const seat = sim.turn;
  const hand = sim.hands[seat];
  hand.splice(hand.indexOf(card), 1);
  if (sim.trick.length === 0) sim.suitLeads[suitOf(card)]++;
  sim.trick.push({ seat, card });
  sim.played[card] = true;
  if (isHeart(card) || (card === QUEEN_OF_SPADES && rules.queenBreaksHearts)) sim.heartsBroken = true;
  if (sim.trick.length < 4) {
    sim.turn = ((seat + 1) % 4) as Seat;
    return;
  }
  const led = suitOf(sim.trick[0].card);
  let best = sim.trick[0];
  for (const p of sim.trick) if (suitOf(p.card) === led && p.card > best.card) best = p;
  for (const p of sim.trick) {
    const c = p.card;
    if (isHeart(c)) {
      sim.rawPoints[best.seat] += 1;
      sim.penaltyTaken[best.seat] += 1;
      sim.penaltyCards[best.seat]++;
    } else if (c === QUEEN_OF_SPADES) {
      sim.rawPoints[best.seat] += 13;
      sim.penaltyTaken[best.seat] += 13;
      sim.penaltyCards[best.seat]++;
    } else if (rules.jackOfDiamonds && c === JACK_OF_DIAMONDS) {
      sim.rawPoints[best.seat] -= 10;
    }
  }
  sim.trick = [];
  sim.tricksDone++;
  sim.turn = best.seat;
}

function simContext(sim: SimState, rules: HouseRules): PlayContext {
  const seat = sim.turn;
  const hand = sim.hands[seat];
  return {
    seat,
    hand,
    legal: legalFromHand(hand, sim.trick.length ? suitOf(sim.trick[0].card) : null, {
      firstTrick: sim.tricksDone === 0,
      heartsBroken: sim.heartsBroken
    }),
    trick: sim.trick,
    played: sim.played,
    penaltyTaken: sim.penaltyTaken,
    suitLeads: sim.suitLeads,
    rules
  };
}

/** Final hand scores of a finished simulation, from `me`'s point of view (higher is better). */
function simUtility(sim: SimState, me: Seat, scores: readonly number[], rules: HouseRules): number {
  const scored = [...sim.rawPoints];
  const shooter = sim.penaltyCards.findIndex((n) => n === 14);
  if (shooter >= 0) {
    for (let s = 0; s < 4; s++) scored[s] += s === shooter ? -26 : 26;
  }
  let others = 0;
  for (let s = 0; s < 4; s++) if (s !== me) others += scored[s];
  let utility = others / 3 - scored[me];
  // Late in a game, also care about not crossing the target while someone else leads.
  const myTotal = scores[me] + scored[me];
  if (myTotal >= rules.targetScore) {
    const lowestOther = Math.min(...[0, 1, 2, 3].filter((s) => s !== me).map((s) => scores[s] + scored[s]));
    if (lowestOther < myTotal) utility -= 15;
  }
  return utility;
}

function rollout(sim: SimState, me: Seat, shooting: boolean, rules: HouseRules) {
  while (sim.tricksDone < 13) {
    const ctx = simContext(sim, rules);
    const card = sim.turn === me && shooting ? shootPlay(ctx) : heuristicPlay(ctx);
    simPlay(sim, card, rules);
  }
}

function cloneSim(sim: SimState): SimState {
  return {
    hands: sim.hands.map((h) => [...h]),
    trick: [...sim.trick],
    tricksDone: sim.tricksDone,
    heartsBroken: sim.heartsBroken,
    played: [...sim.played],
    penaltyTaken: [...sim.penaltyTaken],
    penaltyCards: [...sim.penaltyCards],
    rawPoints: [...sim.rawPoints],
    suitLeads: [...sim.suitLeads],
    turn: sim.turn
  };
}

export function monteCarloPlay(view: PlayerView, rng: Rng, samples: number): Card {
  const legal = view.legal;
  if (legal.length === 1) return legal[0];
  const me = view.seat;
  const knowledge = inferKnowledge(view);
  const ctx = contextFromView(view);
  // Shooting is only worth simulating while nobody else has taken a point.
  const moonAlive = ctx.penaltyTaken.every((p, s) => s === me || p === 0);
  const totals = new Map<Card, { normal: number; shoot: number }>();
  for (const c of legal) totals.set(c, { normal: 0, shoot: 0 });

  for (let i = 0; i < samples; i++) {
    const hands = sampleDeal(view, rng, knowledge);
    const base = simFromView(view, hands);
    for (const card of legal) {
      const entry = totals.get(card)!;
      const a = cloneSim(base);
      simPlay(a, card, view.rules);
      rollout(a, me, false, view.rules);
      entry.normal += simUtility(a, me, view.scores, view.rules);
      if (moonAlive) {
        const b = cloneSim(base);
        simPlay(b, card, view.rules);
        rollout(b, me, true, view.rules);
        entry.shoot += simUtility(b, me, view.scores, view.rules);
      }
    }
  }

  // Ties go to the heuristic's choice, so equal-valued lines are played the natural way.
  const preferred = heuristicPlay(ctx);
  const ordered = [preferred, ...legal.filter((c) => c !== preferred)];
  let best = preferred;
  let bestValue = -Infinity;
  for (const card of ordered) {
    const entry = totals.get(card)!;
    const value = moonAlive ? Math.max(entry.normal, entry.shoot) : entry.normal;
    if (value > bestValue + 1e-9) {
      bestValue = value;
      best = card;
    }
  }
  return best;
}

// ---------------------------------------------------------------- driver

/** Perform whatever action `seat` owes in `state` (pass, play or moon choice). */
export function botAct(state: GameState, seat: Seat, difficulty: Difficulty, options: BotOptions = {}): GameState {
  const view = viewFor(state, seat);
  if (state.phase === "passing" && !state.passes[seat]) return submitPass(state, seat, botPass(view, difficulty, options));
  if (state.phase === "playing" && state.turn === seat) return playCard(state, seat, botPlay(view, difficulty, options));
  if (state.phase === "moon" && state.moonShooter === seat) return chooseMoon(state, seat, botMoon(view));
  return state;
}

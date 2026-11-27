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
  type Card,
  type Suit
} from "../engine/cards";
import type { HouseRules, Play, Seat } from "../engine/game";

/**
 * The minimum a policy needs to choose a card. Both live games (through PlayerView) and the
 * Hard bot's fast simulations build one of these.
 */
export interface PlayContext {
  seat: Seat;
  hand: readonly Card[];
  legal: readonly Card[];
  trick: readonly Play[];
  /** played[c] is true once card c has been played (including the current trick). */
  played: ArrayLike<boolean>;
  /** Hearts + Q♠ points taken so far by each seat this hand. */
  penaltyTaken: readonly number[];
  /** How many times each suit has been led this hand. */
  suitLeads: readonly number[];
  rules: HouseRules;
}

const pointsOf = (card: Card, rules: HouseRules) =>
  isHeart(card) ? 1 : card === QUEEN_OF_SPADES ? 13 : rules.jackOfDiamonds && card === JACK_OF_DIAMONDS ? -10 : 0;

export function trickPoints(trick: readonly Play[], rules: HouseRules) {
  let total = 0;
  for (const p of trick) total += pointsOf(p.card, rules);
  return total;
}

export function currentWinner(trick: readonly Play[]): Play {
  const led = suitOf(trick[0].card);
  let best = trick[0];
  for (const p of trick) if (suitOf(p.card) === led && p.card > best.card) best = p;
  return best;
}

/** A single opponent who has taken every penalty point so far (and enough to be a real threat). */
export function moonThreat(ctx: Pick<PlayContext, "penaltyTaken" | "seat">, minimum = 8): Seat | null {
  let threat: Seat | null = null;
  for (let s = 0; s < 4; s++) {
    if (ctx.penaltyTaken[s] > 0) {
      if (threat !== null) return null;
      threat = s as Seat;
    }
  }
  if (threat === null || threat === ctx.seat || ctx.penaltyTaken[threat] < minimum) return null;
  return threat;
}

function unplayedOthers(ctx: PlayContext, suit: Suit, predicate: (rank: number) => boolean) {
  let count = 0;
  for (let r = 0; r < 13; r++) {
    const c = suit * 13 + r;
    if (!ctx.played[c] && !ctx.hand.includes(c) && predicate(r)) count++;
  }
  return count;
}

const queenOut = (ctx: PlayContext) => !ctx.played[QUEEN_OF_SPADES] && !ctx.hand.includes(QUEEN_OF_SPADES);

/** A solid rule-of-thumb player: the "Normal" bot and the rollout policy inside Hard. */
export function heuristicPlay(ctx: PlayContext): Card {
  const { legal } = ctx;
  if (legal.length === 1) return legal[0];
  if (ctx.trick.length === 0) return chooseLead(ctx);
  const led = suitOf(ctx.trick[0].card);
  if (suitOf(legal[0]) === led) return chooseFollow(ctx, led);
  return chooseDiscard(ctx);
}

function chooseLead(ctx: PlayContext): Card {
  let best = ctx.legal[0];
  let bestScore = Infinity;
  const suitCount = [0, 0, 0, 0];
  for (const c of ctx.hand) suitCount[suitOf(c)]++;
  for (const card of ctx.legal) {
    const suit = suitOf(card);
    const rank = rankOf(card);
    // How many outstanding lower cards could duck under this one.
    const lowerOut = unplayedOthers(ctx, suit, (r) => r < rank);
    const othersInSuit = unplayedOthers(ctx, suit, () => true);
    let score = lowerOut * 3 + rank * 0.3 + suitCount[suit] * 0.4;
    if (othersInSuit === 0) score += 40; // nobody can follow: we win our own lead
    if (card === QUEEN_OF_SPADES) score += 60;
    if (suit === SPADES && rank > 10 && queenOut(ctx)) score += 45;
    if (suit === SPADES && rank < 10 && queenOut(ctx)) score -= 4; // smoke the queen out
    if (suit === HEARTS) score += 1;
    if (ctx.rules.jackOfDiamonds && card === JACK_OF_DIAMONDS) score += 8;
    if (score < bestScore) {
      bestScore = score;
      best = card;
    }
  }
  return best;
}

function chooseFollow(ctx: PlayContext, led: Suit): Card {
  const { legal, trick, rules } = ctx;
  const winner = currentWinner(trick);
  const last = trick.length === 3;
  const points = trickPoints(trick, rules);
  const below = legal.filter((c) => c < winner.card);
  const above = legal.filter((c) => c > winner.card);
  const threat = moonThreat(ctx);

  // Stop a moon: take a pointed trick away from the shooter as cheaply as possible.
  if (threat !== null && winner.seat === threat && points > 0 && above.length) {
    const safeAbove = above.filter((c) => c !== QUEEN_OF_SPADES);
    return (safeAbove.length ? safeAbove : above)[0];
  }

  // Jack of diamonds: grab it when we can win the trick.
  if (rules.jackOfDiamonds && points < 0 && above.length && (last || led !== SPADES)) {
    return above[above.length - 1] === QUEEN_OF_SPADES && above.length > 1 ? above[above.length - 2] : above[above.length - 1];
  }

  if (below.length) {
    // Duck with the highest card that still loses (this drops the queen under the A/K♠).
    return below[below.length - 1];
  }

  const nonQueen = legal.filter((c) => c !== QUEEN_OF_SPADES);
  const pool = nonQueen.length ? nonQueen : legal;
  if (last) {
    // We win regardless: unload the highest card (never the queen, unless forced).
    return pool[pool.length - 1];
  }
  const earlyRound = ctx.suitLeads[led] <= 1 && led !== HEARTS && led !== SPADES && points <= 0;
  if (earlyRound) return pool[pool.length - 1];
  return pool[0];
}

function chooseDiscard(ctx: PlayContext): Card {
  const { legal, rules, trick } = ctx;
  const winner = currentWinner(trick);
  const threat = moonThreat(ctx, 6);
  const suitCount = [0, 0, 0, 0];
  for (const c of ctx.hand) suitCount[suitOf(c)]++;
  let best = legal[0];
  let bestScore = -Infinity;
  for (const card of legal) {
    const suit = suitOf(card);
    const rank = rankOf(card);
    let score = rank;
    if (card === QUEEN_OF_SPADES) score += 100;
    else if ((card === ACE_OF_SPADES || card === KING_OF_SPADES) && queenOut(ctx)) score += 30;
    if (isHeart(card)) score += 6;
    if (suitCount[suit] <= 2) score += 3;
    if (rules.jackOfDiamonds && card === JACK_OF_DIAMONDS) score -= 60;
    // Never feed points to a would-be moon shooter.
    if (threat !== null && winner.seat === threat && pointsOf(card, rules) > 0) score -= 200;
    if (score > bestScore) {
      bestScore = score;
      best = card;
    }
  }
  return best;
}

/** Policy used when trying to take every point: win tricks, keep hearts, shed nothing to others. */
export function shootPlay(ctx: PlayContext): Card {
  const { legal, trick } = ctx;
  if (legal.length === 1) return legal[0];
  if (trick.length === 0) {
    // Lead the card most likely to win: the highest card of a suit with few higher cards out.
    let best = legal[legal.length - 1];
    let bestScore = Infinity;
    for (const card of legal) {
      const higherOut = unplayedOthers(ctx, suitOf(card), (r) => r > rankOf(card));
      const score = higherOut * 10 - rankOf(card);
      if (score < bestScore) {
        bestScore = score;
        best = card;
      }
    }
    return best;
  }
  const led = suitOf(trick[0].card);
  if (suitOf(legal[0]) === led) {
    const winner = currentWinner(trick);
    const above = legal.filter((c) => c > winner.card);
    return above.length ? above[above.length - 1] : legal[0];
  }
  // Void: discard the lowest non-point card so nobody else collects points.
  const safe = legal.filter((c) => !isHeart(c) && c !== QUEEN_OF_SPADES);
  const pool = safe.length ? safe : legal;
  let low = pool[0];
  for (const c of pool) if (rankOf(c) < rankOf(low)) low = c;
  return low;
}

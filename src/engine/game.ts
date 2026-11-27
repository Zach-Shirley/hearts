import {
  HEARTS,
  JACK_OF_DIAMONDS,
  QUEEN_OF_SPADES,
  TWO_OF_CLUBS,
  fullDeck,
  isCard,
  isHeart,
  rankOf,
  sortHand,
  suitOf,
  type Card,
  type Suit
} from "./cards";
import { nextRandom } from "./rng";

export type Seat = 0 | 1 | 2 | 3;
export const SEATS: readonly Seat[] = [0, 1, 2, 3];

/** Play moves clockwise: the player to a seat's left is seat + 1. */
export const leftOf = (seat: Seat): Seat => ((seat + 1) % 4) as Seat;
export const rightOf = (seat: Seat): Seat => ((seat + 3) % 4) as Seat;
export const acrossFrom = (seat: Seat): Seat => ((seat + 2) % 4) as Seat;

export type PassDirection = "left" | "right" | "across" | "hold";
const PASS_CYCLE: readonly PassDirection[] = ["left", "right", "across", "hold"];

export type MoonRule = "add" | "choose";

export interface HouseRules {
  /** Score that ends the game. */
  targetScore: number;
  /** "add": the shooter's opponents each take 26. "choose": the shooter may instead take −26. */
  moon: MoonRule;
  /** The jack of diamonds is worth −10 to whoever takes it. */
  jackOfDiamonds: boolean;
  /** Playing the queen of spades breaks hearts. */
  queenBreaksHearts: boolean;
}

export const DEFAULT_RULES: HouseRules = {
  targetScore: 100,
  moon: "add",
  jackOfDiamonds: false,
  queenBreaksHearts: true
};

export const TARGET_OPTIONS = [50, 75, 100, 150] as const;

export function normalizeRules(input: unknown): HouseRules {
  const raw = (typeof input === "object" && input ? input : {}) as Partial<HouseRules>;
  return {
    targetScore: TARGET_OPTIONS.includes(raw.targetScore as (typeof TARGET_OPTIONS)[number])
      ? (raw.targetScore as number)
      : DEFAULT_RULES.targetScore,
    moon: raw.moon === "choose" ? "choose" : "add",
    jackOfDiamonds: raw.jackOfDiamonds === true,
    queenBreaksHearts: raw.queenBreaksHearts !== false
  };
}

export interface Play {
  seat: Seat;
  card: Card;
}

export interface CompletedTrick {
  leader: Seat;
  plays: Play[];
  winner: Seat;
  points: number;
}

export interface HandResult {
  handNumber: number;
  passDirection: PassDirection;
  /** Points taken in tricks this hand (hearts, Q♠, J♦ if on). */
  rawPoints: number[];
  /** Points actually added to each score after the moon is applied. */
  scored: number[];
  moonShooter: Seat | null;
  moonChoice: "add" | "subtract" | null;
  totals: number[];
}

export type Phase = "passing" | "playing" | "moon" | "handOver" | "gameOver";

export interface GameState {
  rules: HouseRules;
  seed: number;
  phase: Phase;
  handNumber: number;
  passDirection: PassDirection;
  scores: number[];
  hands: Card[][];
  /** Each seat's chosen pass while passing (null = not chosen yet). */
  passes: (Card[] | null)[];
  /** What each seat received in this hand's pass (empty on a hold hand). */
  received: Card[][];
  /** What each seat passed this hand (kept so bots can remember where cards went). */
  passed: Card[][];
  leader: Seat;
  turn: Seat;
  trick: Play[];
  tricks: CompletedTrick[];
  /** Penalty (and bonus) cards each seat has taken this hand. */
  taken: Card[][];
  heartsBroken: boolean;
  moonShooter: Seat | null;
  history: HandResult[];
  winners: Seat[];
}

export class RuleError extends Error {}

export function passDirectionFor(handNumber: number): PassDirection {
  return PASS_CYCLE[handNumber % 4];
}

export function passTarget(seat: Seat, direction: PassDirection): Seat {
  if (direction === "left") return leftOf(seat);
  if (direction === "right") return rightOf(seat);
  if (direction === "across") return acrossFrom(seat);
  return seat;
}

export function cardPoints(card: Card, rules: HouseRules): number {
  if (isHeart(card)) return 1;
  if (card === QUEEN_OF_SPADES) return 13;
  if (rules.jackOfDiamonds && card === JACK_OF_DIAMONDS) return -10;
  return 0;
}

/** Hearts and the Q♠: the cards that count toward shooting the moon and are barred from trick one. */
export function isPenaltyCard(card: Card) {
  return isHeart(card) || card === QUEEN_OF_SPADES;
}

export function createGame(rules: Partial<HouseRules> = {}, seed = 1): GameState {
  const state: GameState = {
    rules: normalizeRules({ ...DEFAULT_RULES, ...rules }),
    seed: seed >>> 0,
    phase: "passing",
    handNumber: 0,
    passDirection: "left",
    scores: [0, 0, 0, 0],
    hands: [[], [], [], []],
    passes: [null, null, null, null],
    received: [[], [], [], []],
    passed: [[], [], [], []],
    leader: 0,
    turn: 0,
    trick: [],
    tricks: [],
    taken: [[], [], [], []],
    heartsBroken: false,
    moonShooter: null,
    history: [],
    winners: []
  };
  return dealHand(state, 0);
}

function cloneState(state: GameState): GameState {
  return {
    ...state,
    scores: [...state.scores],
    hands: state.hands.map((h) => [...h]),
    passes: state.passes.map((p) => (p ? [...p] : null)),
    received: state.received.map((r) => [...r]),
    passed: state.passed.map((r) => [...r]),
    trick: [...state.trick],
    tricks: [...state.tricks],
    taken: state.taken.map((t) => [...t]),
    history: [...state.history],
    winners: [...state.winners]
  };
}

function dealHand(base: GameState, handNumber: number): GameState {
  const state = cloneState(base);
  const deck = fullDeck();
  let seed = state.seed;
  for (let i = deck.length - 1; i > 0; i--) {
    const [r, next] = nextRandom(seed);
    seed = next;
    const j = Math.floor(r * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  state.seed = seed;
  state.handNumber = handNumber;
  state.passDirection = passDirectionFor(handNumber);
  state.hands = SEATS.map((s) => sortHand(deck.slice(s * 13, s * 13 + 13)));
  state.passes = [null, null, null, null];
  state.received = [[], [], [], []];
  state.passed = [[], [], [], []];
  state.trick = [];
  state.tricks = [];
  state.taken = [[], [], [], []];
  state.heartsBroken = false;
  state.moonShooter = null;
  if (state.passDirection === "hold") {
    startPlay(state);
  } else {
    state.phase = "passing";
  }
  return state;
}

function startPlay(state: GameState) {
  state.phase = "playing";
  const opener = SEATS.find((s) => state.hands[s].includes(TWO_OF_CLUBS))!;
  state.leader = opener;
  state.turn = opener;
}

export function submitPass(base: GameState, seat: Seat, cards: readonly Card[]): GameState {
  if (base.phase !== "passing") throw new RuleError("It is not time to pass.");
  if (base.passes[seat]) throw new RuleError("You have already passed.");
  if (!Array.isArray(cards) || cards.length !== 3) throw new RuleError("Pass exactly three cards.");
  const unique = new Set(cards);
  if (unique.size !== 3 || ![...unique].every((c) => isCard(c) && base.hands[seat].includes(c))) {
    throw new RuleError("Pass three different cards from your own hand.");
  }
  const state = cloneState(base);
  state.passes[seat] = sortHand(cards);
  if (state.passes.every(Boolean)) {
    const direction = state.passDirection;
    for (const s of SEATS) {
      const pass = state.passes[s]!;
      state.passed[s] = pass;
      state.hands[s] = state.hands[s].filter((c) => !pass.includes(c));
    }
    for (const s of SEATS) {
      const target = passTarget(s, direction);
      state.received[target] = state.passes[s]!;
      state.hands[target] = sortHand([...state.hands[target], ...state.passes[s]!]);
    }
    startPlay(state);
  }
  return state;
}

export function isFirstTrick(state: Pick<GameState, "tricks">) {
  return state.tricks.length === 0;
}

/** Cards `seat` may legally play right now (empty if it is not their turn). */
export function legalPlays(state: GameState, seat: Seat): Card[] {
  if (state.phase !== "playing" || state.turn !== seat) return [];
  return legalFromHand(state.hands[seat], state.trick.length ? suitOf(state.trick[0].card) : null, {
    firstTrick: isFirstTrick(state),
    heartsBroken: state.heartsBroken
  });
}

/** Pure legality used by the engine and by the bots' simulations. */
export function legalFromHand(
  hand: readonly Card[],
  ledSuit: Suit | null,
  ctx: { firstTrick: boolean; heartsBroken: boolean }
): Card[] {
  if (hand.length === 0) return [];
  if (ledSuit === null) {
    if (ctx.firstTrick) return hand.includes(TWO_OF_CLUBS) ? [TWO_OF_CLUBS] : [];
    if (ctx.heartsBroken) return [...hand];
    const nonHearts = hand.filter((c) => !isHeart(c));
    return nonHearts.length ? nonHearts : [...hand];
  }
  const following = hand.filter((c) => suitOf(c) === ledSuit);
  if (following.length) return following;
  if (ctx.firstTrick) {
    const safe = hand.filter((c) => !isPenaltyCard(c));
    // Holding nothing but points, any of them may be played.
    return safe.length ? safe : [...hand];
  }
  return [...hand];
}

export function trickWinner(plays: readonly Play[]): Seat {
  const led = suitOf(plays[0].card);
  let best = plays[0];
  for (const play of plays) {
    if (suitOf(play.card) === led && rankOf(play.card) > rankOf(best.card)) best = play;
  }
  return best.seat;
}

export function playCard(base: GameState, seat: Seat, card: Card): GameState {
  if (base.phase !== "playing") throw new RuleError("Cards are not being played right now.");
  if (base.turn !== seat) throw new RuleError("It is not your turn.");
  if (!isCard(card) || !base.hands[seat].includes(card)) throw new RuleError("That card is not in your hand.");
  if (!legalPlays(base, seat).includes(card)) throw new RuleError(illegalReason(base, seat, card));

  const state = cloneState(base);
  state.hands[seat] = state.hands[seat].filter((c) => c !== card);
  state.trick.push({ seat, card });
  if (isHeart(card) || (card === QUEEN_OF_SPADES && state.rules.queenBreaksHearts)) {
    state.heartsBroken = true;
  }

  if (state.trick.length < 4) {
    state.turn = leftOf(seat);
    return state;
  }

  const winner = trickWinner(state.trick);
  const points = state.trick.reduce((sum, p) => sum + cardPoints(p.card, state.rules), 0);
  state.tricks.push({ leader: state.leader, plays: state.trick, winner, points });
  for (const p of state.trick) {
    if (cardPoints(p.card, state.rules) !== 0) state.taken[winner].push(p.card);
  }
  state.trick = [];
  state.leader = winner;
  state.turn = winner;

  if (state.tricks.length === 13) finishHand(state);
  return state;
}

function illegalReason(state: GameState, seat: Seat, card: Card): string {
  if (state.trick.length === 0) {
    if (isFirstTrick(state)) return "The 2♣ leads the first trick.";
    if (isHeart(card) && !state.heartsBroken) return "Hearts have not been broken yet.";
  } else if (suitOf(card) !== suitOf(state.trick[0].card) && state.hands[seat].some((c) => suitOf(c) === suitOf(state.trick[0].card))) {
    return "You must follow suit.";
  } else if (isFirstTrick(state) && isPenaltyCard(card)) {
    return "No points on the first trick.";
  }
  return "That card cannot be played now.";
}

/** Points each seat took this hand, before the moon is considered. */
export function rawHandPoints(state: Pick<GameState, "taken" | "rules">): number[] {
  return state.taken.map((cards) => cards.reduce((sum, c) => sum + cardPoints(c, state.rules), 0));
}

export function moonShooterOf(taken: readonly Card[][]): Seat | null {
  for (const s of SEATS) {
    const penalty = taken[s].filter(isPenaltyCard).length;
    if (penalty === 14) return s;
  }
  return null;
}

function finishHand(state: GameState) {
  const shooter = moonShooterOf(state.taken);
  state.moonShooter = shooter;
  if (shooter !== null && state.rules.moon === "choose") {
    state.phase = "moon";
    state.turn = shooter;
    return;
  }
  scoreHand(state, shooter === null ? null : "add");
}

function scoreHand(state: GameState, moonChoice: "add" | "subtract" | null) {
  const raw = rawHandPoints(state);
  const shooter = state.moonShooter;
  const jd = (s: Seat) => (state.rules.jackOfDiamonds && state.taken[s].includes(JACK_OF_DIAMONDS) ? -10 : 0);
  const scored = SEATS.map((s) => {
    if (shooter === null) return raw[s];
    if (moonChoice === "subtract") return s === shooter ? -26 + jd(s) : jd(s);
    return s === shooter ? jd(s) : 26 + jd(s);
  });
  state.scores = state.scores.map((score, s) => score + scored[s]);
  state.history.push({
    handNumber: state.handNumber,
    passDirection: state.passDirection,
    rawPoints: raw,
    scored,
    moonShooter: shooter,
    moonChoice,
    totals: [...state.scores]
  });
  if (state.scores.some((score) => score >= state.rules.targetScore)) {
    const low = Math.min(...state.scores);
    state.winners = SEATS.filter((s) => state.scores[s] === low);
    state.phase = "gameOver";
  } else {
    state.phase = "handOver";
  }
}

export function chooseMoon(base: GameState, seat: Seat, choice: "add" | "subtract"): GameState {
  if (base.phase !== "moon") throw new RuleError("Nobody is choosing a moon score.");
  if (base.moonShooter !== seat) throw new RuleError("Only the shooter chooses.");
  if (choice !== "add" && choice !== "subtract") throw new RuleError("Choose add or subtract.");
  const state = cloneState(base);
  scoreHand(state, choice);
  return state;
}

export function nextHand(base: GameState): GameState {
  if (base.phase !== "handOver") throw new RuleError("The hand is not over.");
  return dealHand(base, base.handNumber + 1);
}

/** Seats that still owe an action, for "who is to act" displays and server timers. */
export function seatsToAct(state: GameState): Seat[] {
  if (state.phase === "passing") return SEATS.filter((s) => !state.passes[s]);
  if (state.phase === "playing" || state.phase === "moon") return [state.turn];
  return [];
}

export function cardsPlayed(state: Pick<GameState, "tricks" | "trick">): Card[] {
  return [...state.tricks.flatMap((t) => t.plays.map((p) => p.card)), ...state.trick.map((p) => p.card)];
}

export function cardsOfSuit(hand: readonly Card[], suit: Suit) {
  return hand.filter((c) => suitOf(c) === suit);
}

export { HEARTS };

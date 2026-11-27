import type { Card } from "./cards";
import { legalPlays, type CompletedTrick, type GameState, type HandResult, type HouseRules, type Phase, type PassDirection, type Play, type Seat } from "./game";

/** What one seat is allowed to know. Other hands are reduced to counts. */
export interface PlayerView {
  seat: Seat;
  rules: HouseRules;
  phase: Phase;
  handNumber: number;
  passDirection: PassDirection;
  scores: number[];
  hand: Card[];
  handCounts: number[];
  /** Whether each seat has locked in its pass (not which cards). */
  passReady: boolean[];
  myPass: Card[] | null;
  /** Cards this seat passed and received this hand. */
  passed: Card[];
  received: Card[];
  leader: Seat;
  turn: Seat;
  trick: Play[];
  tricks: CompletedTrick[];
  taken: Card[][];
  heartsBroken: boolean;
  moonShooter: Seat | null;
  history: HandResult[];
  winners: Seat[];
  legal: Card[];
}

export function viewFor(state: GameState, seat: Seat): PlayerView {
  return {
    seat,
    rules: state.rules,
    phase: state.phase,
    handNumber: state.handNumber,
    passDirection: state.passDirection,
    scores: [...state.scores],
    hand: [...state.hands[seat]],
    handCounts: state.hands.map((h) => h.length),
    passReady: state.passes.map(Boolean),
    myPass: state.passes[seat] ? [...state.passes[seat]!] : null,
    passed: state.phase === "passing" ? [] : [...state.passed[seat]],
    received: state.phase === "passing" ? [] : [...state.received[seat]],
    leader: state.leader,
    turn: state.turn,
    trick: [...state.trick],
    tricks: [...state.tricks],
    taken: state.taken.map((t) => [...t]),
    heartsBroken: state.heartsBroken,
    moonShooter: state.phase === "moon" || state.phase === "handOver" || state.phase === "gameOver" ? state.moonShooter : null,
    history: [...state.history],
    winners: [...state.winners],
    legal: legalPlays(state, seat)
  };
}

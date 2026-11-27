import type { Difficulty } from "../bots/bots";
import type { Card } from "../engine/cards";
import type { PlayerView } from "../engine/view";

export interface SeatDisplay {
  name: string;
  kind: "you" | "human" | "bot";
  connected: boolean;
  /** Short status under the name, e.g. "reconnecting… 21s". */
  note?: string;
  ready?: boolean;
}

/** Everything the table needs, whether the game runs locally or on the server. */
export interface TableModel {
  mode: "solo" | "online";
  view: PlayerView;
  seats: SeatDisplay[];
  difficulty: Difficulty;
  nextHandAt: number | null;
  /** Online: the room code, for the header. */
  roomCode?: string;
  isHost: boolean;
  connection?: "online" | "reconnecting";
  pass(cards: Card[]): void;
  play(card: Card): void;
  moon(choice: "add" | "subtract"): void;
  ready(): void;
  newGame(): void;
  leave(): void;
}

/** Table positions relative to the viewer: 0 bottom (you), 1 left, 2 top, 3 right. */
export function relativePosition(seat: number, you: number) {
  return (seat - you + 4) % 4;
}

export const POSITION_NAMES = ["bottom", "left", "top", "right"] as const;

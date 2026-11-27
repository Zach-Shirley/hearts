import type { Difficulty } from "../bots/bots";
import type { Card } from "../engine/cards";
import type { HouseRules, Seat } from "../engine/game";
import type { PlayerView } from "../engine/view";

export interface PlayerSession {
  roomCode: string;
  seat: Seat;
  token: string;
}

export type SeatKind = "human" | "bot" | "empty";

export interface PublicSeat {
  name: string;
  kind: SeatKind;
  connected: boolean;
  /** A bot is holding this seat for a human who left or dropped. */
  botForHuman: boolean;
  /** When a dropped player's seat passes to a bot (ms since epoch), if pending. */
  takeoverAt: number | null;
  isHost: boolean;
  ready: boolean;
}

export interface RoomSnapshot {
  code: string;
  stage: "lobby" | "playing";
  you: Seat;
  seats: PublicSeat[];
  rules: HouseRules;
  difficulty: Difficulty;
  /** The game as this seat may see it; null in the lobby. */
  view: PlayerView | null;
  /** When the hand-over pause ends and the next hand is dealt. */
  nextHandAt: number | null;
  revision: number;
}

export interface RoomConnection {
  session: PlayerSession;
  snapshot: RoomSnapshot;
}

export type AckResult<T> = { ok: true; data: T } | { ok: false; message: string };
export type Ack<T> = (result: AckResult<T>) => void;

export interface ClientToServerEvents {
  "room:create": (payload: { name: string; rules: Partial<HouseRules>; difficulty: Difficulty }, ack: Ack<RoomConnection>) => void;
  "room:join": (payload: { code: string; name: string }, ack: Ack<RoomConnection>) => void;
  "room:resume": (session: PlayerSession, ack: Ack<RoomConnection>) => void;
  "room:settings": (payload: { rules: Partial<HouseRules>; difficulty: Difficulty }, ack: Ack<null>) => void;
  "room:start": (ack: Ack<null>) => void;
  "room:pass": (cards: Card[], ack: Ack<null>) => void;
  "room:play": (card: Card, ack: Ack<null>) => void;
  "room:moon": (choice: "add" | "subtract", ack: Ack<null>) => void;
  "room:ready": (ack: Ack<null>) => void;
  "room:rematch": (ack: Ack<null>) => void;
  "room:leave": (ack: Ack<null>) => void;
}

export interface ServerToClientEvents {
  "room:state": (snapshot: RoomSnapshot) => void;
  "room:closed": (reason: string) => void;
}

export interface SocketData {
  session?: PlayerSession;
}

export const MAX_NAME_LENGTH = 16;

export function cleanName(name: unknown): string {
  if (typeof name !== "string") return "Player";
  const cleaned = name.replace(/[^\p{L}\p{N} _.'-]/gu, "").replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LENGTH);
  return cleaned || "Player";
}

export function normalizeCode(code: unknown): string {
  return typeof code === "string" ? code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5) : "";
}

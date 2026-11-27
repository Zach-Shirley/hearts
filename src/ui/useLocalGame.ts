import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { botAct, type Difficulty } from "../bots/bots";
import type { Card } from "../engine/cards";
import {
  SEATS,
  chooseMoon,
  createGame,
  nextHand,
  playCard,
  submitPass,
  type GameState,
  type HouseRules
} from "../engine/game";
import { randomSeed } from "../engine/rng";
import { viewFor } from "../engine/view";
import type { TableModel } from "./model";
import { load, save } from "./storage";

export const BOT_NAMES_SOLO = ["You", "Juniper", "Marlow", "Odessa"];

export interface SoloSettings {
  difficulty: Difficulty;
  rules: HouseRules;
  playerName: string;
  /** Bot pace: 1 = normal, 0.5 = fast. */
  pace: number;
}

interface SavedGame {
  version: 1;
  state: GameState;
  difficulty: Difficulty;
}

const SAVE_KEY = "hearts.solo.game";
export const TRICK_PAUSE_MS = 1250;
const BOT_DELAY_MS = 620;
const HARD_SAMPLES = 120;

export function savedSoloGame(): SavedGame | null {
  const saved = load<SavedGame | null>(SAVE_KEY, null);
  if (!saved || saved.version !== 1 || !saved.state?.hands || saved.state.phase === "gameOver") return null;
  return saved;
}

export function clearSoloGame() {
  save(SAVE_KEY, null);
}

export function useLocalGame(settings: SoloSettings, resume: boolean, onExit: () => void): TableModel {
  const [game, setGame] = useState<{ state: GameState; difficulty: Difficulty }>(() => {
    const saved = resume ? savedSoloGame() : null;
    if (saved) return { state: saved.state, difficulty: saved.difficulty };
    return { state: createGame(settings.rules, randomSeed()), difficulty: settings.difficulty };
  });
  const { state, difficulty } = game;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    save(SAVE_KEY, { version: 1, state, difficulty } satisfies SavedGame);
  }, [state, difficulty]);

  const update = useCallback((fn: (s: GameState) => GameState) => {
    setGame((g) => {
      try {
        return { ...g, state: fn(g.state) };
      } catch (error) {
        // A stale click (e.g. a double tap) is simply ignored; the engine refused it.
        console.warn(error);
        return g;
      }
    });
  }, []);

  // Bots: pass at once, play after a short pause (longer after a trick so it can be seen).
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (state.phase === "passing") {
      const pending = SEATS.filter((s) => s !== 0 && !state.passes[s]);
      if (pending.length) {
        timer.current = setTimeout(() => update((s) => pending.reduce((acc, seat) => botAct(acc, seat, difficulty, { samples: HARD_SAMPLES }), s)), 350);
      }
    } else if ((state.phase === "playing" || state.phase === "moon") && (state.phase === "playing" ? state.turn !== 0 : state.moonShooter !== 0)) {
      const justFinished = state.phase === "playing" && state.trick.length === 0 && state.tricks.length > 0;
      const delay = (BOT_DELAY_MS + (justFinished ? TRICK_PAUSE_MS : 0)) * settings.pace;
      timer.current = setTimeout(() => update((s) => botAct(s, s.phase === "moon" ? s.moonShooter! : s.turn, difficulty, { samples: HARD_SAMPLES })), delay);
    }
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [state, difficulty, settings.pace, update]);

  const view = useMemo(() => viewFor(state, 0), [state]);

  return {
    mode: "solo",
    view,
    seats: SEATS.map((s) => ({
      name: s === 0 ? settings.playerName || "You" : BOT_NAMES_SOLO[s],
      kind: s === 0 ? "you" : "bot",
      connected: true
    })),
    difficulty,
    nextHandAt: null,
    isHost: true,
    pass: (cards: Card[]) => update((s) => submitPass(s, 0, cards)),
    play: (card: Card) => update((s) => playCard(s, 0, card)),
    moon: (choice) => update((s) => chooseMoon(s, 0, choice)),
    ready: () => update((s) => (s.phase === "handOver" ? nextHand(s) : s)),
    // A new game keeps this game's rules and difficulty.
    newGame: () => setGame((g) => ({ state: createGame(g.state.rules, randomSeed()), difficulty: g.difficulty })),
    leave: onExit
  };
}

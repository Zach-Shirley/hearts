import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { Difficulty } from "../bots/bots";
import type { Card } from "../engine/cards";
import type { HouseRules } from "../engine/game";
import type { AckResult, ClientToServerEvents, PlayerSession, RoomConnection, RoomSnapshot, ServerToClientEvents } from "./protocol";

export const PRODUCTION_SERVER_URL = "https://hearts-server-e6vz.onrender.com";

const isLocal = typeof window !== "undefined" && ["localhost", "127.0.0.1"].includes(window.location.hostname);
export const SERVER_URL: string = import.meta.env.VITE_SERVER_URL ?? (isLocal ? "http://127.0.0.1:4291" : PRODUCTION_SERVER_URL);

const SESSION_KEY = "hearts.online.session";

type HeartsSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export type ServerStatus = "checking" | "waking" | "ready" | "unreachable";

// Per tab, so two tabs in one browser are two different players; a refresh keeps the seat.
export function storedSession(): PlayerSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as PlayerSession) : null;
  } catch {
    return null;
  }
}

function save(_key: string, session: PlayerSession | null) {
  try {
    if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* storage unavailable: reconnecting after a refresh will not work */
  }
}

/**
 * Free hosting sleeps when idle; the first request wakes it, which can take up to a minute.
 * We poll /health so the UI can say so instead of looking broken.
 */
async function wakeServer(onSlow: () => void, signal: AbortSignal): Promise<boolean> {
  const started = Date.now();
  const slowTimer = setTimeout(onSlow, 1500);
  try {
    while (!signal.aborted && Date.now() - started < 120_000) {
      try {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 10_000);
        const res = await fetch(`${SERVER_URL}/health`, { signal: controller.signal, cache: "no-store" });
        clearTimeout(t);
        if (res.ok) return true;
      } catch {
        /* still asleep */
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    return false;
  } finally {
    clearTimeout(slowTimer);
  }
}

export function useOnline() {
  const [status, setStatus] = useState<ServerStatus>("checking");
  const [connected, setConnected] = useState(false);
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resuming, setResuming] = useState(() => storedSession() !== null);
  const socketRef = useRef<HeartsSocket | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const abort = new AbortController();
    setStatus("checking");
    void wakeServer(() => setStatus((s) => (s === "checking" ? "waking" : s)), abort.signal).then((ok) => {
      if (abort.signal.aborted) return;
      if (!ok) {
        setStatus("unreachable");
        setResuming(false);
        return;
      }
      setStatus("ready");
      const socket: HeartsSocket = io(SERVER_URL, {
        transports: ["websocket", "polling"],
        reconnection: true,
        reconnectionDelay: 600,
        reconnectionDelayMax: 4000,
        timeout: 10_000
      });
      socketRef.current = socket;
      socket.on("connect", () => {
        setConnected(true);
        const session = storedSession();
        if (session) {
          socket.emit("room:resume", session, (r) => {
            setResuming(false);
            if (r.ok) {
              setSnapshot(r.data.snapshot);
              save(SESSION_KEY, r.data.session);
            } else {
              save(SESSION_KEY, null);
              setSnapshot(null);
              setError(r.message);
            }
          });
        } else {
          setResuming(false);
        }
      });
      socket.on("disconnect", () => setConnected(false));
      socket.on("room:state", (s) => setSnapshot((prev) => (prev && prev.code === s.code && prev.revision > s.revision ? prev : s)));
      socket.on("room:closed", (reason) => {
        save(SESSION_KEY, null);
        setSnapshot(null);
        setError(reason);
      });
    });
    return () => {
      abort.abort();
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, [attempt]);

  const call = useCallback(<T,>(event: keyof ClientToServerEvents, ...args: unknown[]) => {
    return new Promise<AckResult<T>>((resolve) => {
      const socket = socketRef.current;
      if (!socket || !socket.connected) {
        resolve({ ok: false, message: "Not connected to the server yet." });
        return;
      }
      (socket.emit as (...a: unknown[]) => void)(event, ...args, (r: AckResult<T>) => {
        if (!r.ok) setError(r.message);
        resolve(r);
      });
    });
  }, []);

  const enter = (r: AckResult<RoomConnection>) => {
    if (r.ok) {
      save(SESSION_KEY, r.data.session);
      setSnapshot(r.data.snapshot);
      setError(null);
    }
    return r;
  };

  return {
    status,
    connected,
    snapshot,
    error,
    resuming,
    clearError: () => setError(null),
    retry: () => setAttempt((n) => n + 1),
    create: async (name: string, rules: HouseRules, difficulty: Difficulty) => enter(await call<RoomConnection>("room:create", { name, rules, difficulty })),
    join: async (code: string, name: string) => enter(await call<RoomConnection>("room:join", { code, name })),
    settings: (rules: HouseRules, difficulty: Difficulty) => call("room:settings", { rules, difficulty }),
    start: () => call("room:start"),
    pass: (cards: Card[]) => call("room:pass", cards),
    play: (card: Card) => call("room:play", card),
    moon: (choice: "add" | "subtract") => call("room:moon", choice),
    ready: () => call("room:ready"),
    rematch: () => call("room:rematch"),
    leave: async () => {
      await call("room:leave");
      save(SESSION_KEY, null);
      setSnapshot(null);
    }
  };
}

export type OnlineApi = ReturnType<typeof useOnline>;

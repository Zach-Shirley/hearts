import { useEffect, useMemo, useState } from "react";
import type { Difficulty } from "./bots/bots";
import { DEFAULT_RULES, TARGET_OPTIONS, normalizeRules, type HouseRules, type Seat } from "./engine/game";
import { normalizeCode, type RoomSnapshot } from "./net/protocol";
import { storedSession, useOnline, type OnlineApi } from "./net/useOnline";
import { CardDefs, PlayingCard, SuitIcon } from "./ui/Card";
import type { TableModel } from "./ui/model";
import { Dialog } from "./ui/panels";
import { load, save } from "./ui/storage";
import { Table } from "./ui/Table";
import { clearSoloGame, savedSoloGame, useLocalGame, type SoloSettings } from "./ui/useLocalGame";

type Screen = { name: "home" } | { name: "solo"; resume: boolean } | { name: "online"; code?: string };

const SETTINGS_KEY = "hearts.settings";
const DEFAULT_SETTINGS: SoloSettings = { difficulty: "normal", rules: DEFAULT_RULES, playerName: "", pace: 1 };

function loadSettings(): SoloSettings {
  const s = load<Partial<SoloSettings>>(SETTINGS_KEY, {});
  return {
    difficulty: s.difficulty === "easy" || s.difficulty === "hard" ? s.difficulty : "normal",
    rules: normalizeRules(s.rules),
    playerName: typeof s.playerName === "string" ? s.playerName.slice(0, 16) : "",
    pace: s.pace === 0.5 ? 0.5 : 1
  };
}

function initialScreen(): Screen {
  const code = normalizeCode(new URLSearchParams(window.location.search).get("room"));
  if (code) return { name: "online", code };
  if (storedSession()) return { name: "online" };
  return { name: "home" };
}

export default function App() {
  const [screen, setScreen] = useState<Screen>(initialScreen);
  const [settings, setSettings] = useState<SoloSettings>(loadSettings);
  const [showRules, setShowRules] = useState(false);
  useEffect(() => save(SETTINGS_KEY, settings), [settings]);

  const goHome = () => {
    window.history.replaceState(null, "", window.location.pathname);
    setScreen({ name: "home" });
  };

  return (
    <>
      <CardDefs />
      {screen.name === "home" && (
        <Home
          settings={settings}
          setSettings={setSettings}
          onSolo={(resume) => setScreen({ name: "solo", resume })}
          onOnline={() => setScreen({ name: "online" })}
          onRules={() => setShowRules(true)}
        />
      )}
      {screen.name === "solo" && <SoloGame settings={settings} resume={screen.resume} onExit={goHome} />}
      {screen.name === "online" && <OnlineScreen settings={settings} setSettings={setSettings} initialCode={screen.code} onExit={goHome} />}
      {showRules && <RulesDialog onClose={() => setShowRules(false)} />}
    </>
  );
}

// ------------------------------------------------------------------ home

function Home(props: { settings: SoloSettings; setSettings: (s: SoloSettings) => void; onSolo: (resume: boolean) => void; onOnline: () => void; onRules: () => void }) {
  const { settings, setSettings } = props;
  const saved = useMemo(() => savedSoloGame(), []);
  return (
    <div className="home">
      <div className="home-hero">
        <div className="hero-fan" aria-hidden="true">
          {[47, 36, 51, 22].map((c, i) => (
            <PlayingCard key={c} card={c} className="hero-card" style={{ "--i": i } as React.CSSProperties} />
          ))}
        </div>
        <h1>
          Hearts<span className="title-mark"><SuitIcon suit={3} size={30} /></span>
        </h1>
        <p className="tagline">The classic trick-dodging card game. Four players, one queen to avoid.</p>
      </div>

      <div className="home-panels">
        <section className="panel">
          <h2>Play the bots</h2>
          {saved && (
            <button className="primary-btn wide" onClick={() => props.onSolo(true)}>
              Resume game <small>hand {saved.state.handNumber + 1} · {saved.difficulty}</small>
            </button>
          )}
          <DifficultyPicker value={settings.difficulty} onChange={(difficulty) => setSettings({ ...settings, difficulty })} />
          <label className="field">
            <span>Your name</span>
            <input value={settings.playerName} maxLength={16} placeholder="You" onChange={(e) => setSettings({ ...settings, playerName: e.target.value })} />
          </label>
          <label className="toggle">
            <input type="checkbox" checked={settings.pace === 0.5} onChange={(e) => setSettings({ ...settings, pace: e.target.checked ? 0.5 : 1 })} />
            <span>Fast bots</span>
          </label>
          <button
            className={saved ? "secondary-btn wide" : "primary-btn wide"}
            onClick={() => {
              clearSoloGame();
              props.onSolo(false);
            }}
          >
            New game
          </button>
        </section>

        <section className="panel">
          <h2>Play online</h2>
          <p className="muted">Make a room, share the code or link, and play with 2 to 4 people. Bots fill the empty seats.</p>
          <button className="primary-btn wide" onClick={props.onOnline}>Create or join a room</button>
        </section>

        <section className="panel">
          <h2>House rules</h2>
          <RulesEditor rules={settings.rules} onChange={(rules) => setSettings({ ...settings, rules })} />
          <button className="link-btn" onClick={props.onRules}>How to play</button>
        </section>
      </div>
      <footer className="home-foot">
        <span>All rights reserved; source is public to read.</span>
        <a href="https://github.com/Zach-Shirley/hearts" target="_blank" rel="noreferrer">GitHub</a>
      </footer>
    </div>
  );
}

const DIFFICULTY_INFO: Record<Difficulty, string> = {
  easy: "Plays low, dumps high cards, no memory.",
  normal: "Solid rules of thumb: ducks, voids suits, guards the queen.",
  hard: "Counts cards, tracks voids and simulates hundreds of deals per move."
};

function DifficultyPicker({ value, onChange }: { value: Difficulty; onChange: (d: Difficulty) => void }) {
  return (
    <div className="field">
      <span>Bot difficulty</span>
      <div className="segmented" role="radiogroup" aria-label="Bot difficulty">
        {(["easy", "normal", "hard"] as const).map((d) => (
          <button key={d} role="radio" aria-checked={value === d} className={value === d ? "is-on" : ""} onClick={() => onChange(d)}>
            {d[0].toUpperCase() + d.slice(1)}
          </button>
        ))}
      </div>
      <small className="muted">{DIFFICULTY_INFO[value]}</small>
    </div>
  );
}

function RulesEditor({ rules, onChange, disabled }: { rules: HouseRules; onChange: (r: HouseRules) => void; disabled?: boolean }) {
  return (
    <div className="rules-editor">
      <div className="field">
        <span>Game ends at</span>
        <div className="segmented" role="radiogroup" aria-label="Target score">
          {TARGET_OPTIONS.map((t) => (
            <button key={t} role="radio" aria-checked={rules.targetScore === t} className={rules.targetScore === t ? "is-on" : ""} disabled={disabled} onClick={() => onChange({ ...rules, targetScore: t })}>
              {t}
            </button>
          ))}
        </div>
      </div>
      <label className="toggle">
        <input type="checkbox" checked={rules.moon === "choose"} disabled={disabled} onChange={(e) => onChange({ ...rules, moon: e.target.checked ? "choose" : "add" })} />
        <span>Moon shooter may take −26 instead</span>
      </label>
      <label className="toggle">
        <input type="checkbox" checked={rules.jackOfDiamonds} disabled={disabled} onChange={(e) => onChange({ ...rules, jackOfDiamonds: e.target.checked })} />
        <span>J♦ is worth −10</span>
      </label>
      <label className="toggle">
        <input type="checkbox" checked={rules.queenBreaksHearts} disabled={disabled} onChange={(e) => onChange({ ...rules, queenBreaksHearts: e.target.checked })} />
        <span>Q♠ breaks hearts</span>
      </label>
    </div>
  );
}

function RulesDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="How to play" onClose={onClose} wide>
      <div className="rules-text">
        <p><strong>Goal:</strong> take as few points as possible. Each heart is 1 point and the queen of spades is 13. When someone reaches the target (100 by default) the game ends and the lowest score wins.</p>
        <p><strong>Passing:</strong> before each hand, pass three cards: left, then right, then across, then no pass, and repeat.</p>
        <p><strong>Tricks:</strong> the 2♣ leads the first trick. Follow the led suit if you can; otherwise play anything. The highest card of the led suit wins the trick and leads next.</p>
        <p><strong>First trick:</strong> no hearts and no Q♠, unless your hand holds nothing else.</p>
        <p><strong>Breaking hearts:</strong> you can't lead a heart until one has been played (or the Q♠, by default), unless you have only hearts left.</p>
        <p><strong>Shooting the moon:</strong> take all 13 hearts and the Q♠ and everyone else takes 26 instead. With the house rule on, the shooter may take −26 instead.</p>
        <p><strong>J♦ house rule:</strong> whoever takes the jack of diamonds scores −10.</p>
        <p><strong>Tips:</strong> tap a dimmed card to see why it can't be played. "Last trick" and "Tricks" let you review play; "Scores" shows every hand.</p>
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ solo

function SoloGame({ settings, resume, onExit }: { settings: SoloSettings; resume: boolean; onExit: () => void }) {
  const model = useLocalGame(settings, resume, onExit);
  const [menu, setMenu] = useState(false);
  return (
    <>
      <Table model={model} onMenu={() => setMenu(true)} />
      {menu && (
        <Dialog title="Menu" onClose={() => setMenu(false)}>
          <p className="muted">Bots: {model.difficulty}. Your game is saved in this browser.</p>
          <div className="dialog-actions column">
            <button className="secondary-btn" onClick={() => setMenu(false)}>Keep playing</button>
            <button
              className="secondary-btn"
              onClick={() => {
                model.newGame();
                setMenu(false);
              }}
            >
              Restart with current settings
            </button>
            <button className="primary-btn" onClick={onExit}>Main menu</button>
          </div>
        </Dialog>
      )}
    </>
  );
}

// ------------------------------------------------------------------ online

function OnlineScreen(props: { settings: SoloSettings; setSettings: (s: SoloSettings) => void; initialCode?: string; onExit: () => void }) {
  const online = useOnline();
  const snap = online.snapshot;
  if (snap && snap.stage === "playing" && snap.view) return <OnlineGame online={online} snapshot={snap} onExit={props.onExit} />;
  if (snap) return <Lobby online={online} snapshot={snap} onExit={props.onExit} />;
  return <OnlineEntry {...props} online={online} />;
}

function ServerBadge({ online }: { online: OnlineApi }) {
  if (online.status === "ready") {
    return <div className={`server-badge ${online.connected ? "is-ok" : "is-wait"}`}>{online.connected ? "Server connected" : "Connecting…"}</div>;
  }
  if (online.status === "unreachable") {
    return (
      <div className="server-badge is-bad">
        Can't reach the game server. <button className="link-btn" onClick={online.retry}>Try again</button>
      </div>
    );
  }
  return (
    <div className="server-badge is-wait waking" role="status">
      <span className="spinner" aria-hidden="true" />
      {online.status === "waking" ? (
        <span>Waking server… The free host sleeps when idle; this can take up to a minute.</span>
      ) : (
        <span>Checking the server…</span>
      )}
    </div>
  );
}

function OnlineEntry(props: { settings: SoloSettings; setSettings: (s: SoloSettings) => void; initialCode?: string; onExit: () => void; online: OnlineApi }) {
  const { online, settings, setSettings } = props;
  const [code, setCode] = useState(props.initialCode ?? "");
  const [busy, setBusy] = useState(false);
  const ready = online.status === "ready" && online.connected && !online.resuming;
  const name = settings.playerName.trim() || "Player";

  const create = async () => {
    setBusy(true);
    await online.create(name, settings.rules, settings.difficulty === "easy" ? "easy" : settings.difficulty);
    setBusy(false);
  };
  const join = async () => {
    setBusy(true);
    await online.join(code, name);
    setBusy(false);
  };

  return (
    <div className="online-entry">
      <header className="screen-head">
        <button className="link-btn" onClick={props.onExit}>← Menu</button>
        <h1>Play online</h1>
      </header>
      <ServerBadge online={online} />
      {online.resuming && online.status === "ready" && <p className="muted center">Rejoining your table…</p>}
      {online.error && (
        <div className="error-banner" role="alert">
          {online.error} <button className="link-btn" onClick={online.clearError}>Dismiss</button>
        </div>
      )}
      <label className="field narrow">
        <span>Your name</span>
        <input value={settings.playerName} maxLength={16} placeholder="Player" onChange={(e) => setSettings({ ...settings, playerName: e.target.value })} />
      </label>
      <div className="home-panels two">
        <section className="panel">
          <h2>Join a room</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (normalizeCode(code).length === 5) void join();
            }}
          >
            <label className="field">
              <span>Room code</span>
              <input className="code-input" value={code} maxLength={5} placeholder="ABCDE" autoCapitalize="characters" onChange={(e) => setCode(normalizeCode(e.target.value))} />
            </label>
            <button className="primary-btn wide" disabled={!ready || busy || code.length !== 5}>Join</button>
          </form>
        </section>
        <section className="panel">
          <h2>Create a room</h2>
          <DifficultyPicker value={settings.difficulty} onChange={(difficulty) => setSettings({ ...settings, difficulty })} />
          <RulesEditor rules={settings.rules} onChange={(rules) => setSettings({ ...settings, rules })} />
          <button className="primary-btn wide" disabled={!ready || busy} onClick={create}>Create room</button>
        </section>
      </div>
    </div>
  );
}

function Lobby({ online, snapshot, onExit }: { online: OnlineApi; snapshot: RoomSnapshot; onExit: () => void }) {
  const you = snapshot.you;
  const isHost = snapshot.seats[you].isHost;
  const humans = snapshot.seats.filter((s) => s.kind === "human").length;
  const link = `${window.location.origin}${window.location.pathname}?room=${snapshot.code}`;
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt("Copy this link", link);
    }
  };
  const leave = async () => {
    await online.leave();
    onExit();
  };
  return (
    <div className="online-entry">
      <header className="screen-head">
        <button className="link-btn" onClick={leave}>← Leave room</button>
        <h1>Room</h1>
      </header>
      <ServerBadge online={online} />
      <div className="room-code" aria-label={`Room code ${snapshot.code}`}>
        {snapshot.code.split("").map((ch, i) => (
          <span key={i}>{ch}</span>
        ))}
      </div>
      <div className="room-share">
        <button className="secondary-btn" onClick={copy}>{copied ? "Link copied" : "Copy invite link"}</button>
      </div>
      {online.error && (
        <div className="error-banner" role="alert">
          {online.error} <button className="link-btn" onClick={online.clearError}>Dismiss</button>
        </div>
      )}
      <ol className="seat-list">
        {snapshot.seats.map((s, i) => (
          <li key={i} className={`${s.kind} ${i === you ? "is-you" : ""}`}>
            <span className="seat-dot" />
            <span className="seat-name">
              {s.kind === "empty" ? <span className="muted">Open seat — a bot ({snapshot.difficulty}) if nobody joins</span> : s.name}
              {i === you && " (you)"}
            </span>
            <span className="seat-tags">
              {s.isHost && <span className="plate-tag">host</span>}
              {s.kind === "human" && !s.connected && <span className="plate-tag warn">reconnecting</span>}
            </span>
          </li>
        ))}
      </ol>
      <section className="panel lobby-rules">
        <h2>Table settings</h2>
        <DifficultyPicker value={snapshot.difficulty} onChange={(d) => isHost && void online.settings(snapshot.rules, d)} />
        <RulesEditor rules={snapshot.rules} disabled={!isHost} onChange={(r) => void online.settings(r, snapshot.difficulty)} />
        {!isHost && <p className="muted">Only the host can change these.</p>}
      </section>
      {isHost ? (
        <button className="primary-btn wide" disabled={humans < 2} onClick={() => void online.start()}>
          {humans < 2 ? "Waiting for another player…" : `Start with ${humans} players + ${4 - humans} bot${4 - humans === 1 ? "" : "s"}`}
        </button>
      ) : (
        <p className="center muted">Waiting for the host to start…</p>
      )}
    </div>
  );
}

function OnlineGame({ online, snapshot, onExit }: { online: OnlineApi; snapshot: RoomSnapshot; onExit: () => void }) {
  const [menu, setMenu] = useState(false);
  const view = snapshot.view!;
  const you = snapshot.you;
  const leave = async () => {
    await online.leave();
    onExit();
  };
  const model: TableModel = {
    mode: "online",
    view,
    seats: snapshot.seats.map((s, i) => ({
      name: i === you ? `${s.name}` : s.name,
      kind: i === you ? "you" : s.kind === "bot" ? "bot" : "human",
      connected: s.kind === "bot" || s.connected,
      ready: s.ready,
      note:
        s.kind === "human" && !s.connected
          ? s.takeoverAt
            ? `Reconnecting… bot in {until:${s.takeoverAt}}`
            : "Reconnecting…"
          : s.botForHuman
            ? "Bot sitting in"
            : undefined
    })),
    difficulty: snapshot.difficulty,
    nextHandAt: snapshot.nextHandAt,
    roomCode: snapshot.code,
    isHost: snapshot.seats[you].isHost,
    connection: online.connected ? "online" : "reconnecting",
    pass: (cards) => void online.pass(cards),
    play: (card) => void online.play(card),
    moon: (choice) => void online.moon(choice),
    ready: () => void online.ready(),
    newGame: () => void online.rematch(),
    leave: () => void leave()
  };
  return (
    <>
      <Table model={model} onMenu={() => setMenu(true)} />
      {online.error && (
        <div className="toast" role="alert" onClick={online.clearError}>
          {online.error}
        </div>
      )}
      {menu && (
        <Dialog title={`Room ${snapshot.code}`} onClose={() => setMenu(false)}>
          <p className="muted">Bots: {snapshot.difficulty}. If you leave, a bot takes your seat for the rest of the game. A refresh keeps your seat.</p>
          <ul className="menu-seats">
            {snapshot.seats.map((s, i) => (
              <li key={i}>{s.name}{i === you ? " (you)" : ""} — {s.kind === "bot" ? (s.botForHuman ? "bot sitting in" : "bot") : s.connected ? "online" : "reconnecting"}</li>
            ))}
          </ul>
          <div className="dialog-actions column">
            <button className="secondary-btn" onClick={() => setMenu(false)}>Keep playing</button>
            <button className="primary-btn" onClick={leave}>Leave the game</button>
          </div>
        </Dialog>
      )}
    </>
  );
}

export type { Seat };

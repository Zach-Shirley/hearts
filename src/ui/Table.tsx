import { useEffect, useMemo, useRef, useState } from "react";
import { QUEEN_OF_SPADES, SUIT_SYMBOLS, TWO_OF_CLUBS, cardLabel, isHeart, suitOf, type Card } from "../engine/cards";
import { isPenaltyCard, passTarget, type CompletedTrick, type Play, type Seat } from "../engine/game";
import type { PlayerView } from "../engine/view";
import { PlayingCard, SuitIcon } from "./Card";
import { POSITION_NAMES, relativePosition, type TableModel } from "./model";
import { GameOverDialog, HandSummaryDialog, LastTrickDialog, MoonChoiceDialog, ScoreSheet, TrickLog } from "./panels";
import { isMuted, setMuted, sfx } from "./sound";
import { TRICK_PAUSE_MS } from "./useLocalGame";

const COLLECT_AFTER_MS = 820;

function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

/** Why a card the player tapped cannot be played. */
function illegalHint(view: PlayerView, card: Card): string {
  if (view.phase !== "playing") return "";
  if (view.turn !== view.seat) return "Wait for your turn.";
  if (view.trick.length === 0) {
    if (view.tricks.length === 0) return "The 2♣ leads the first trick.";
    if (isHeart(card) && !view.heartsBroken) return "Hearts haven't been broken yet.";
  } else {
    const led = suitOf(view.trick[0].card);
    if (suitOf(card) !== led && view.hand.some((c) => suitOf(c) === led)) return `You must follow suit: play a ${SUIT_SYMBOLS[led]}.`;
    if (view.tricks.length === 0 && isPenaltyCard(card)) return "No points on the first trick.";
  }
  return "That card can't be played now.";
}

const PASS_WORD = { left: "left", right: "right", across: "across", hold: "" } as const;

export function Table({ model, onMenu }: { model: TableModel; onMenu: () => void }) {
  const { view, seats } = model;
  const you = view.seat;
  const [selected, setSelected] = useState<Card[]>([]);
  const [hold, setHold] = useState<{ trick: CompletedTrick; index: number; collecting: boolean } | null>(null);
  const [panel, setPanel] = useState<null | "scores" | "tricks" | "last">(null);
  const [hint, setHint] = useState<string | null>(null);
  const [muted, setMutedState] = useState(isMuted());
  const [dealing, setDealing] = useState(true);
  const [freshCards, setFreshCards] = useState<Card[]>([]);
  const prev = useRef<PlayerView | null>(null);
  const holdTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const now = useNow(model.nextHandAt !== null || seats.some((s) => s.note));

  const handKey = `${view.handNumber}-${view.history.length}`;

  // ---- reactions to state changes: animation holds and sounds
  useEffect(() => {
    const before = prev.current;
    prev.current = view;
    if (!before) {
      sfx.deal();
      return;
    }
    const newHand = before.handNumber !== view.handNumber || before.history.length > view.history.length;
    if (newHand) {
      clearHold();
      setSelected([]);
      setDealing(true);
      sfx.deal();
      return;
    }
    const playedBefore = before.tricks.length * 4 + before.trick.length;
    const playedNow = view.tricks.length * 4 + view.trick.length;
    if (playedNow > playedBefore) {
      const last = view.trick.length ? view.trick[view.trick.length - 1].card : view.tricks[view.tricks.length - 1].plays[3].card;
      sfx.card();
      if (last === QUEEN_OF_SPADES) sfx.queen();
      else if (!before.heartsBroken && view.heartsBroken) sfx.heartsBroken();
    }
    if (view.tricks.length > before.tricks.length) {
      const index = view.tricks.length - 1;
      startHold(view.tricks[index], index);
    } else if (view.trick.length > 0 && hold) {
      clearHold();
    }
    if (before.phase === "passing" && view.phase !== "passing" && view.received.length) {
      setFreshCards(view.received);
      setTimeout(() => setFreshCards([]), 4200);
      setSelected([]);
    }
    if (view.phase === "playing" && view.turn === you && (before.turn !== you || before.phase !== "playing")) {
      setTimeout(() => sfx.turn(), view.trick.length === 0 && view.tricks.length ? TRICK_PAUSE_MS : 150);
    }
    if (before.phase !== "gameOver" && view.phase === "gameOver") {
      setTimeout(() => (view.winners.includes(you) ? sfx.win() : sfx.lose()), 900);
    }
    if (view.moonShooter !== null && before.moonShooter === null) setTimeout(() => sfx.moon(), 700);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  useEffect(() => {
    if (!dealing) return;
    const id = setTimeout(() => setDealing(false), 1100);
    return () => clearTimeout(id);
  }, [dealing, handKey]);

  useEffect(() => () => holdTimers.current.forEach(clearTimeout), []);

  function clearHold() {
    holdTimers.current.forEach(clearTimeout);
    holdTimers.current = [];
    setHold(null);
  }

  function startHold(trick: CompletedTrick, index: number) {
    clearHold();
    setHold({ trick, index, collecting: false });
    holdTimers.current.push(
      setTimeout(() => {
        setHold((h) => (h && h.index === index ? { ...h, collecting: true } : h));
        sfx.collect();
      }, COLLECT_AFTER_MS),
      setTimeout(() => setHold((h) => (h && h.index === index ? null : h)), TRICK_PAUSE_MS)
    );
  }

  useEffect(() => {
    if (!hint) return;
    const id = setTimeout(() => setHint(null), 2200);
    return () => clearTimeout(id);
  }, [hint]);

  // ---- derived display state
  const centerPlays: Play[] = hold ? hold.trick.plays : view.trick;
  const collectingTo = hold?.collecting ? POSITION_NAMES[relativePosition(hold.trick.winner, you)] : null;
  const busy = hold !== null;
  const canPlay = view.phase === "playing" && view.turn === you && !busy;
  const passing = view.phase === "passing" && !view.myPass;
  const handPoints = useMemo(
    () => view.taken.map((cards) => cards.reduce((sum, c) => sum + (isHeart(c) ? 1 : c === QUEEN_OF_SPADES ? 13 : view.rules.jackOfDiamonds ? -10 : 0), 0)),
    [view.taken, view.rules.jackOfDiamonds]
  );

  function onCardClick(card: Card) {
    if (passing) {
      setSelected((sel) => (sel.includes(card) ? sel.filter((c) => c !== card) : sel.length < 3 ? [...sel, card] : [...sel.slice(1), card]));
      sfx.select();
      return;
    }
    if (canPlay && view.legal.includes(card)) {
      model.play(card);
      return;
    }
    if (view.phase === "playing") {
      setHint(busy ? "Collecting the trick…" : illegalHint(view, card));
      if (!busy) sfx.error();
    }
  }

  function status(): string {
    if (view.phase === "passing") {
      if (!view.myPass) return `Pass 3 cards ${PASS_WORD[view.passDirection]} to ${seats[passTarget(you, view.passDirection)].name}.`;
      const waiting = seats.filter((_, s) => !view.passReady[s]).map((s) => s.name);
      const mine = `You passed ${view.myPass.map(cardLabel).join(" ")}.`;
      return waiting.length ? `${mine} Waiting for ${waiting.join(", ")}…` : mine;
    }
    if (view.phase === "playing") {
      if (busy) return `${seats[hold!.trick.winner].kind === "you" ? "You take" : `${seats[hold!.trick.winner].name} takes`} the trick${hold!.trick.points ? ` (${hold!.trick.points > 0 ? "+" : ""}${hold!.trick.points})` : ""}.`;
      if (view.turn === you) {
        if (view.trick.length === 0) return view.tricks.length === 0 ? "You lead the 2♣." : "Your lead.";
        return "Your turn.";
      }
      const s = seats[view.turn];
      return s.kind === "bot" ? `${s.name} is thinking…` : `Waiting for ${s.name}…`;
    }
    if (view.phase === "moon") {
      return view.moonShooter === you ? "You shot the moon!" : `${seats[view.moonShooter ?? 0].name} shot the moon and is choosing…`;
    }
    return "";
  }

  const toggleMute = () => {
    setMuted(!muted);
    setMutedState(!muted);
  };

  const n = view.hand.length;
  const showSummary = view.phase === "handOver" && !busy;
  const showGameOver = view.phase === "gameOver" && !busy;
  const lastTrick = view.tricks.length ? view.tricks[view.tricks.length - 1] : null;

  return (
    <div className="table-screen">
      <header className="topbar">
        <button className="icon-btn" onClick={onMenu} aria-label="Menu">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        </button>
        <div className="topbar-info">
          <span className="chip">Hand {view.handNumber + 1}</span>
          <span className="chip">{view.passDirection === "hold" ? "No pass" : `Pass ${view.passDirection}`}</span>
          <span className={`chip hearts-chip ${view.heartsBroken ? "is-broken" : ""}`} title={view.heartsBroken ? "Hearts are broken" : "Hearts not broken"}>
            <SuitIcon suit={3} size={13} /> {view.heartsBroken ? "Broken" : "Unbroken"}
          </span>
          {model.roomCode && <span className="chip chip-code">Room {model.roomCode}</span>}
          {model.connection === "reconnecting" && <span className="chip chip-warn">Reconnecting…</span>}
        </div>
        <div className="topbar-actions">
          <button className="pill-btn" onClick={() => setPanel("last")} disabled={!lastTrick}>Last trick</button>
          <button className="pill-btn hide-narrow" onClick={() => setPanel("tricks")}>Tricks</button>
          <button className="pill-btn" onClick={() => setPanel("scores")}>Scores</button>
          <button className="icon-btn" onClick={toggleMute} aria-label={muted ? "Unmute sound" : "Mute sound"} aria-pressed={muted}>
            {muted ? (
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4zM17 9l4 6M21 9l-4 6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
            )}
          </button>
        </div>
      </header>

      <main className="felt">
        {[1, 2, 3].map((rel) => {
          const seat = ((you + rel) % 4) as Seat;
          const pos = POSITION_NAMES[rel];
          const count = view.handCounts[seat];
          const toAct = (view.phase === "playing" && view.turn === seat && !busy) || (view.phase === "passing" && !view.passReady[seat]) || (view.phase === "moon" && view.moonShooter === seat);
          return (
            <section key={seat} className={`opponent opponent-${pos}`} aria-label={`${seats[seat].name}'s seat`}>
              <div className={`opp-hand ${dealing ? "is-dealing" : ""}`} style={{ "--n": count } as React.CSSProperties} key={handKey}>
                {Array.from({ length: count }, (_, i) => (
                  <PlayingCard key={i} faceDown className="opp-card" style={{ "--i": i } as React.CSSProperties} />
                ))}
              </div>
              <SeatPlate
                name={seats[seat].name}
                kind={seats[seat].kind}
                note={seats[seat].note ? noteWithCountdown(seats[seat].note!, now) : undefined}
                connected={seats[seat].connected}
                score={view.scores[seat]}
                handPoints={handPoints[seat]}
                toAct={toAct}
                passed={view.phase === "passing" && view.passReady[seat]}
              />
            </section>
          );
        })}

        <div className={`trick ${collectingTo ? `collect-${collectingTo}` : ""}`} aria-label="Cards on the table" aria-live="polite">
          {centerPlays.map((p) => {
            const pos = POSITION_NAMES[relativePosition(p.seat, you)];
            const winning = hold && p.seat === hold.trick.winner;
            return <PlayingCard key={`${hold?.index ?? view.tricks.length}-${p.card}`} card={p.card} className={`trick-card from-${pos} ${winning ? "is-winning" : ""}`} />;
          })}
          {centerPlays.length === 0 && view.phase === "playing" && view.tricks.length === 0 && view.turn !== you && (
            <div className="trick-hint">{seats[view.turn].name} leads the 2♣</div>
          )}
        </div>

        <div className="self-plate">
          <SeatPlate
            name={seats[you].name}
            kind="you"
            connected
            score={view.scores[you]}
            handPoints={handPoints[you]}
            toAct={canPlay || passing || (view.phase === "moon" && view.moonShooter === you)}
            passed={false}
          />
        </div>

        <div className="status-line" role="status">
          {passing && (
            <button className="primary-btn pass-btn" disabled={selected.length !== 3} onClick={() => model.pass(selected)}>
              {selected.length === 3 ? `Pass ${PASS_WORD[view.passDirection]} →` : `Select ${3 - selected.length} more`}
            </button>
          )}
          <span>{hint ?? status()}</span>
        </div>
      </main>

      <footer className={`me ${canPlay ? "is-turn" : ""}`}>
        <div className={`hand ${dealing ? "is-dealing" : ""}`} style={{ "--n": n } as React.CSSProperties} key={handKey}>
          {view.hand.map((card, i) => {
            const playable = canPlay && view.legal.includes(card);
            const dim = view.phase === "playing" && view.turn === you && !busy && !view.legal.includes(card);
            return (
              <PlayingCard
                key={card}
                card={card}
                onClick={() => onCardClick(card)}
                selected={selected.includes(card)}
                className={`hand-card ${playable ? "is-playable" : ""} ${dim ? "is-dim" : ""} ${freshCards.includes(card) ? "is-fresh" : ""}`}
                style={{ "--i": i } as React.CSSProperties}
                title={card === TWO_OF_CLUBS && canPlay ? "Lead the 2♣" : undefined}
              />
            );
          })}
        </div>
      </footer>

      {panel === "scores" && <ScoreSheet view={view} seats={seats} onClose={() => setPanel(null)} />}
      {panel === "tricks" && <TrickLog view={view} seats={seats} onClose={() => setPanel(null)} />}
      {panel === "last" && lastTrick && <LastTrickDialog trick={lastTrick} seats={seats} you={you} onClose={() => setPanel(null)} />}
      {view.phase === "moon" && view.moonShooter === you && <MoonChoiceDialog view={view} onChoose={model.moon} />}
      {showSummary && <HandSummaryDialog model={model} now={now} />}
      {showGameOver && <GameOverDialog model={model} />}
    </div>
  );
}

function noteWithCountdown(note: string, now: number) {
  return note.replace(/\{until:(\d+)\}/, (_, t) => `${Math.max(0, Math.ceil((Number(t) - now) / 1000))}s`);
}

function SeatPlate(props: {
  name: string;
  kind: "you" | "human" | "bot";
  note?: string;
  connected: boolean;
  score: number;
  handPoints: number;
  toAct: boolean;
  passed: boolean;
  compact?: boolean;
}) {
  return (
    <div className={`plate ${props.toAct ? "is-acting" : ""} ${props.connected ? "" : "is-away"} ${props.compact ? "is-compact" : ""}`}>
      <div className="plate-avatar" aria-hidden="true">
        {props.kind === "bot" ? (
          <svg viewBox="0 0 24 24" width="16" height="16"><rect x="5" y="8" width="14" height="10" rx="3" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M12 4v4M9 13h.01M15 13h.01" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg>
        ) : (
          <span>{props.name.slice(0, 1).toUpperCase()}</span>
        )}
      </div>
      <div className="plate-text">
        <div className="plate-name">{props.name}{props.passed && <span className="plate-tag">passed</span>}</div>
        <div className="plate-score">
          <strong>{props.score}</strong>
          {props.handPoints !== 0 && <span className="plate-hand">{props.handPoints > 0 ? "+" : ""}{props.handPoints} this hand</span>}
        </div>
        {props.note && <div className="plate-note">{props.note}</div>}
      </div>
    </div>
  );
}

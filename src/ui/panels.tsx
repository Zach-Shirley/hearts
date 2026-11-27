import { useEffect, type ReactNode } from "react";
import type { CompletedTrick, Seat } from "../engine/game";
import type { PlayerView } from "../engine/view";
import { PlayingCard, SuitIcon } from "./Card";
import { POSITION_NAMES, relativePosition, type SeatDisplay, type TableModel } from "./model";

export function Dialog({ title, onClose, children, wide, className = "" }: { title: string; onClose?: () => void; children: ReactNode; wide?: boolean; className?: string }) {
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className={`dialog ${wide ? "is-wide" : ""} ${className}`} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <h2>{title}</h2>
          {onClose && (
            <button className="icon-btn" onClick={onClose} aria-label="Close">
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

const fmt = (n: number) => (n > 0 ? `+${n}` : `${n}`);

export function ScoreSheet({ view, seats, onClose }: { view: PlayerView; seats: SeatDisplay[]; onClose: () => void }) {
  return (
    <Dialog title="Scoreboard" onClose={onClose} wide>
      <p className="dialog-sub">First to {view.rules.targetScore} ends the game. Lowest score wins.</p>
      <div className="score-scroll">
        <table className="score-table">
          <thead>
            <tr>
              <th>Hand</th>
              {seats.map((s, i) => (
                <th key={i} className={i === view.seat ? "is-you" : ""}>{s.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.history.map((h) => (
              <tr key={h.handNumber}>
                <td className="hand-cell">
                  {h.handNumber + 1}
                  <span className="muted"> · {h.passDirection === "hold" ? "hold" : h.passDirection}</span>
                  {h.moonShooter !== null && <span className="moon-tag">moon</span>}
                </td>
                {h.scored.map((pts, s) => (
                  <td key={s} className={h.moonShooter === s ? "is-moon" : ""}>
                    <span className="score-delta">{fmt(pts)}</span>
                    <span className="score-total">{h.totals[s]}</span>
                  </td>
                ))}
              </tr>
            ))}
            {view.history.length === 0 && (
              <tr>
                <td colSpan={5} className="muted center">No hands finished yet.</td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              {view.scores.map((s, i) => (
                <td key={i}><strong>{s}</strong></td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </Dialog>
  );
}

function MiniTrick({ trick, seats, you }: { trick: CompletedTrick; seats: SeatDisplay[]; you: Seat }) {
  return (
    <div className="mini-trick">
      {trick.plays.map((p) => (
        <div key={p.card} className={`mini-play ${p.seat === trick.winner ? "is-winner" : ""}`}>
          <PlayingCard card={p.card} className="mini-card" />
          <span>{p.seat === you ? "You" : seats[p.seat].name}</span>
        </div>
      ))}
    </div>
  );
}

export function TrickLog({ view, seats, onClose }: { view: PlayerView; seats: SeatDisplay[]; onClose: () => void }) {
  return (
    <Dialog title={`Tricks this hand (${view.tricks.length}/13)`} onClose={onClose} wide>
      {view.tricks.length === 0 && <p className="muted">No tricks yet.</p>}
      <ol className="trick-log">
        {[...view.tricks].reverse().map((t, i) => (
          <li key={view.tricks.length - i}>
            <div className="trick-log-head">
              <span>Trick {view.tricks.length - i}</span>
              <span>
                {seats[t.winner].name} took it{t.points ? <strong className={t.points > 0 ? "pts-bad" : "pts-good"}> {fmt(t.points)}</strong> : ""}
              </span>
            </div>
            <MiniTrick trick={t} seats={seats} you={view.seat} />
          </li>
        ))}
      </ol>
    </Dialog>
  );
}

export function LastTrickDialog({ trick, seats, you, onClose }: { trick: CompletedTrick; seats: SeatDisplay[]; you: Seat; onClose: () => void }) {
  return (
    <Dialog title="Last trick" onClose={onClose}>
      <div className="last-trick-grid">
        {trick.plays.map((p) => (
          <div key={p.card} className={`last-slot slot-${POSITION_NAMES[relativePosition(p.seat, you)]} ${p.seat === trick.winner ? "is-winner" : ""}`}>
            <PlayingCard card={p.card} className="last-card" />
            <span>{p.seat === you ? "You" : seats[p.seat].name}{p.seat === trick.leader ? " · led" : ""}</span>
          </div>
        ))}
      </div>
      <p className="center">
        {seats[trick.winner].kind === "you" ? "You" : seats[trick.winner].name} took it{trick.points ? ` for ${fmt(trick.points)}` : ""}.
      </p>
    </Dialog>
  );
}

export function MoonChoiceDialog({ view, onChoose }: { view: PlayerView; onChoose: (c: "add" | "subtract") => void }) {
  const me = view.seat;
  return (
    <Dialog title="You shot the moon!" className="moon-dialog">
      <div className="moon-art" aria-hidden="true">
        <svg viewBox="0 0 120 120" width="96" height="96"><circle cx="60" cy="60" r="44" fill="var(--gold)" /><circle cx="78" cy="48" r="40" fill="var(--dialog-bg)" /></svg>
      </div>
      <p className="center">You took every heart and the Q♠. Choose your reward:</p>
      <div className="moon-options">
        <button className="primary-btn" onClick={() => onChoose("add")}>
          +26 to everyone else
          <small>{view.scores.map((s, i) => (i === me ? s : s + 26)).join(" · ")}</small>
        </button>
        <button className="secondary-btn" onClick={() => onChoose("subtract")}>
          −26 to yourself
          <small>{view.scores.map((s, i) => (i === me ? s - 26 : s)).join(" · ")}</small>
        </button>
      </div>
    </Dialog>
  );
}

export function HandSummaryDialog({ model, now }: { model: TableModel; now: number }) {
  const { view, seats } = model;
  const h = view.history[view.history.length - 1];
  if (!h) return null;
  const you = view.seat;
  const youReady = seats[you].ready;
  const countdown = model.nextHandAt ? Math.max(0, Math.ceil((model.nextHandAt - now) / 1000)) : null;
  const order = [0, 1, 2, 3].sort((a, b) => view.scores[a] - view.scores[b]);
  return (
    <Dialog title={`Hand ${h.handNumber + 1} done`}>
      {h.moonShooter !== null && (
        <div className="moon-banner">
          <SuitIcon suit={3} size={16} /> {h.moonShooter === you ? "You" : seats[h.moonShooter].name} shot the moon
          {h.moonChoice === "subtract" ? " and took −26." : ": +26 to everyone else."}
        </div>
      )}
      <table className="summary-table">
        <thead>
          <tr><th>Player</th><th>This hand</th><th>Total</th></tr>
        </thead>
        <tbody>
          {order.map((s) => (
            <tr key={s} className={s === you ? "is-you" : ""}>
              <td>{seats[s].name}{seats[s].ready ? " ✓" : ""}</td>
              <td className={h.scored[s] > 0 ? "pts-bad" : h.scored[s] < 0 ? "pts-good" : ""}>{fmt(h.scored[s])}</td>
              <td><strong>{view.scores[s]}</strong></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="dialog-sub center">Game ends at {view.rules.targetScore}. Next pass: {["left", "right", "across", "no pass"][(h.handNumber + 1) % 4]}.</p>
      <button className="primary-btn wide" onClick={model.ready} disabled={model.mode === "online" && youReady} autoFocus>
        {model.mode === "online" && youReady ? "Waiting for the others…" : "Deal next hand"}
        {model.mode === "online" && countdown !== null && <small>auto in {countdown}s</small>}
      </button>
    </Dialog>
  );
}

export function GameOverDialog({ model }: { model: TableModel }) {
  const { view, seats } = model;
  const you = view.seat;
  const won = view.winners.includes(you);
  const order = [0, 1, 2, 3].sort((a, b) => view.scores[a] - view.scores[b]);
  const names = view.winners.map((w) => (w === you ? "You" : seats[w].name));
  return (
    <Dialog title={won ? (view.winners.length > 1 ? "A shared win!" : "You win!") : "Game over"} className="gameover-dialog">
      <p className="center big">{won ? "Lowest score at the table." : `${names.join(" & ")} ${names.length > 1 ? "share the win" : "wins"}.`}</p>
      <ol className="podium">
        {order.map((s, i) => (
          <li key={s} className={`${view.winners.includes(s as Seat) ? "is-winner" : ""} ${s === you ? "is-you" : ""}`}>
            <span className="podium-rank">{i + 1}</span>
            <span className="podium-name">{seats[s].name}</span>
            <strong>{view.scores[s]}</strong>
          </li>
        ))}
      </ol>
      <p className="dialog-sub center">{view.history.length} hands · {view.history.filter((h) => h.moonShooter !== null).length} moon shots</p>
      <div className="dialog-actions">
        {(model.mode === "solo" || model.isHost) && <button className="primary-btn" onClick={model.newGame}>Play again</button>}
        {model.mode === "online" && !model.isHost && <p className="muted">Waiting for the host to start a rematch…</p>}
        <button className="secondary-btn" onClick={model.leave}>Main menu</button>
      </div>
    </Dialog>
  );
}

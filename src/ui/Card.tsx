import { memo } from "react";
import { RANK_LABELS, cardName, rankOf, suitOf, type Card as CardId, type Suit } from "../engine/cards";

// Suit shapes drawn for this game on a 100×100 grid.
export const SUIT_PATHS: Record<Suit, string> = {
  0: "M50 6a19 19 0 0 1 17.6 26.2A19 19 0 1 1 57 63c1.2 13 5.6 23 13 31H30c7.4-8 11.8-18 13-31a19 19 0 1 1-10.6-30.8A19 19 0 0 1 50 6Z",
  1: "M50 3C61 21 75 37 92 50 75 63 61 79 50 97 39 79 25 63 8 50 25 37 39 21 50 3Z",
  2: "M50 4c14 17 44 32 44 56 0 13-10 22-22 22-8 0-14-4-18-10 1 10 5 17 13 24H33c8-7 12-14 13-24-4 6-10 10-18 10-12 0-22-9-22-22C6 36 36 21 50 4Z",
  3: "M50 92C30 76 5 58 5 33 5 18 16 7 29 7c9 0 17 5 21 13 4-8 12-13 21-13 13 0 24 11 24 26 0 25-25 43-45 59Z"
};

export function SuitIcon({ suit, size = 16, className }: { suit: Suit; size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className={className} aria-hidden="true">
      <path d={SUIT_PATHS[suit]} fill="currentColor" />
    </svg>
  );
}

const COURT_LETTER: Record<number, string> = { 9: "J", 10: "Q", 11: "K" };

function Face({ card }: { card: CardId }) {
  const suit = suitOf(card);
  const rank = rankOf(card);
  const label = RANK_LABELS[rank];
  const red = suit === 1 || suit === 3;
  const isCourt = rank >= 9 && rank <= 11;
  const isQueenOfSpades = card === 36;
  const ink = red ? "var(--suit-red)" : "var(--suit-black)";
  const pip = SUIT_PATHS[suit];
  return (
    <svg viewBox="0 0 250 350" className="card-svg" aria-hidden="true">
      <rect x="2" y="2" width="246" height="346" rx="22" fill="var(--card-face)" stroke="var(--card-edge)" strokeWidth="3" />
      <g fill={ink}>
        <text x="34" y="66" className="card-index" textAnchor="middle">{label}</text>
        <path d={pip} transform="translate(16 76) scale(0.36)" />
        <g transform="rotate(180 125 175)">
          <text x="34" y="66" className="card-index" textAnchor="middle">{label}</text>
          <path d={pip} transform="translate(16 76) scale(0.36)" />
        </g>
      </g>
      {isCourt ? (
        <g>
          <rect x="66" y="74" width="118" height="202" rx="14" fill={red ? "var(--court-red)" : "var(--court-black)"} />
          <rect x="66" y="74" width="118" height="202" rx="14" fill="none" stroke={ink} strokeOpacity="0.4" strokeWidth="3" />
          {/* An original court emblem: crown band, monogram and suit seal. */}
          <path d="M90 128l11 12 12-20 12 20 12-20 12 20 11-12v24H90Z" fill="var(--gold)" />
          <text x="125" y="222" textAnchor="middle" className="card-court" fill={ink}>{COURT_LETTER[rank]}</text>
          <path d={pip} transform="translate(107 234) scale(0.36)" fill={ink} />
        </g>
      ) : rank === 12 ? (
        <g fill={ink}>
          <circle cx="125" cy="175" r="80" fill="none" stroke={ink} strokeOpacity="0.2" strokeWidth="3" />
          <circle cx="125" cy="175" r="66" fill="none" stroke={ink} strokeOpacity="0.12" strokeWidth="2" />
          <path d={pip} transform="translate(77 127) scale(0.96)" />
        </g>
      ) : (
        <g fill={ink}>
          <path d={pip} transform="translate(83 92) scale(0.84)" />
          <text x="125" y="266" textAnchor="middle" className="card-rank-big">{label}</text>
        </g>
      )}
      {isQueenOfSpades && (
        <rect x="11" y="11" width="228" height="328" rx="16" fill="none" stroke="var(--gold)" strokeWidth="5" strokeDasharray="1 10" strokeLinecap="round" />
      )}
    </svg>
  );
}

export function CardBack() {
  return (
    <svg viewBox="0 0 250 350" className="card-svg" aria-hidden="true">
      <rect x="2" y="2" width="246" height="346" rx="22" fill="var(--back-b)" stroke="var(--card-edge-dark)" strokeWidth="3" />
      <rect x="16" y="16" width="218" height="318" rx="14" fill="url(#hearts-lattice)" />
      <rect x="16" y="16" width="218" height="318" rx="14" fill="none" stroke="var(--gold)" strokeOpacity="0.55" strokeWidth="3" />
      <circle cx="125" cy="175" r="34" fill="var(--back-b)" stroke="var(--gold)" strokeOpacity="0.7" strokeWidth="3" />
      <path d={SUIT_PATHS[3]} transform="translate(103 154) scale(0.44)" fill="var(--gold)" />
    </svg>
  );
}

/** Shared SVG pattern for card backs, rendered once at the app root. */
export function CardDefs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <defs>
        <pattern id="hearts-lattice" width="26" height="26" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="26" height="26" fill="var(--back-a)" />
          <path d="M0 13h26M13 0v26" stroke="var(--back-line)" strokeWidth="1.4" />
          <circle cx="13" cy="13" r="2.6" fill="var(--gold)" opacity="0.5" />
        </pattern>
      </defs>
    </svg>
  );
}

export interface CardProps {
  card?: CardId;
  faceDown?: boolean;
  className?: string;
  style?: React.CSSProperties;
  onClick?: () => void;
  disabled?: boolean;
  selected?: boolean;
  title?: string;
}

export const PlayingCard = memo(function PlayingCard({ card, faceDown, className = "", style, onClick, disabled, selected, title }: CardProps) {
  const hidden = card === undefined || faceDown;
  const label = hidden ? "Face-down card" : cardName(card);
  const content = hidden ? <CardBack /> : <Face card={card} />;
  const classes = `card${selected ? " is-selected" : ""}${disabled ? " is-disabled" : ""} ${className}`;
  if (onClick) {
    return (
      <button type="button" className={classes} style={style} onClick={onClick} disabled={disabled} aria-label={label} aria-pressed={selected} title={title} data-card={card}>
        {content}
      </button>
    );
  }
  return (
    <div className={classes} style={style} role="img" aria-label={label} title={title} data-card={card}>
      {content}
    </div>
  );
});

// Cards are integers 0..51: suit * 13 + rank, with rank 0 = 2 and rank 12 = Ace.
// Suit order (also the hand sort order): clubs, diamonds, spades, hearts.
export type Card = number;
export type Suit = 0 | 1 | 2 | 3;

export const CLUBS: Suit = 0;
export const DIAMONDS: Suit = 1;
export const SPADES: Suit = 2;
export const HEARTS: Suit = 3;

export const RANK_LABELS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"] as const;
export const SUIT_SYMBOLS = ["♣", "♦", "♠", "♥"] as const;
export const SUIT_NAMES = ["clubs", "diamonds", "spades", "hearts"] as const;

export const suitOf = (card: Card): Suit => Math.floor(card / 13) as Suit;
export const rankOf = (card: Card): number => card % 13;
export const makeCard = (suit: Suit, rank: number): Card => suit * 13 + rank;

export const TWO_OF_CLUBS = makeCard(CLUBS, 0);
export const QUEEN_OF_SPADES = makeCard(SPADES, 10);
export const KING_OF_SPADES = makeCard(SPADES, 11);
export const ACE_OF_SPADES = makeCard(SPADES, 12);
export const JACK_OF_DIAMONDS = makeCard(DIAMONDS, 9);

export const isHeart = (card: Card) => suitOf(card) === HEARTS;

export function cardLabel(card: Card): string {
  return `${RANK_LABELS[rankOf(card)]}${SUIT_SYMBOLS[suitOf(card)]}`;
}

export function cardName(card: Card): string {
  const rankNames = ["two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "jack", "queen", "king", "ace"];
  return `${rankNames[rankOf(card)]} of ${SUIT_NAMES[suitOf(card)]}`;
}

export function fullDeck(): Card[] {
  return Array.from({ length: 52 }, (_, i) => i);
}

export function sortHand(cards: readonly Card[]): Card[] {
  return [...cards].sort((a, b) => a - b);
}

export function isCard(value: unknown): value is Card {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < 52;
}

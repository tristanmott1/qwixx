import scoreCardsData from "./data/scoreCards.json";

export const ROW_COLORS = ["red", "yellow", "green", "blue"] as const;
export const SCORE_CARD_TYPES = ["standard", "numbers", "colors", "numbersAndColors"] as const;
export const DEFAULT_SCORE_CARD_ID = 1;
export const DEFAULT_SCORE_CARD_FILTERS: ScoreCardFilters = {
  standard: true,
  numbers: false,
  colors: false,
  numbersAndColors: false,
};

export type ScoreCardColor = (typeof ROW_COLORS)[number];
export type ScoreCardType = (typeof SCORE_CARD_TYPES)[number];

export type ScoreCardTile = {
  number: number;
  color: ScoreCardColor;
};

export type ScoreCardRow = {
  id: ScoreCardColor;
  tiles: ScoreCardTile[];
};

export type ScoreCardPreset = {
  id: number;
  type: ScoreCardType;
  rows: ScoreCardRow[];
};

export type ScoreCardFilters = Record<ScoreCardType, boolean>;

export const SCORE_CARDS = scoreCardsData as ScoreCardPreset[];

const scoreCardsById = new Map(SCORE_CARDS.map((card) => [card.id, card]));

export function getScoreCard(id: number) {
  return scoreCardsById.get(id) ?? scoreCardsById.get(DEFAULT_SCORE_CARD_ID) ?? SCORE_CARDS[0];
}

export function isScoreCardId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && scoreCardsById.has(value);
}

export function normalizeScoreCardId(value: unknown, fallback = DEFAULT_SCORE_CARD_ID) {
  const id = Number(value);
  return isScoreCardId(id) ? id : fallback;
}

export function isScoreCardColor(value: unknown): value is ScoreCardColor {
  return typeof value === "string" && (ROW_COLORS as readonly string[]).includes(value);
}

export function getScoreCardRow(card: ScoreCardPreset, row: ScoreCardColor) {
  return card.rows.find((candidate) => candidate.id === row) ?? card.rows[0];
}

export function getScoreCardTile(card: ScoreCardPreset, row: ScoreCardColor, number: number) {
  return getScoreCardRow(card, row).tiles.find((tile) => tile.number === number) ?? null;
}

export function getScoreCardNumbers(card: ScoreCardPreset, row: ScoreCardColor) {
  return getScoreCardRow(card, row).tiles.map((tile) => tile.number);
}

export function getScoreCardFinalTile(card: ScoreCardPreset, row: ScoreCardColor) {
  const tiles = getScoreCardRow(card, row).tiles;
  return tiles[tiles.length - 1];
}

export function getScoreCardLockColor(card: ScoreCardPreset, row: ScoreCardColor) {
  return getScoreCardFinalTile(card, row).color;
}

export function getScoreCardRowLabel(row: ScoreCardColor) {
  return {
    red: "Red",
    yellow: "Yellow",
    green: "Green",
    blue: "Blue",
  }[row];
}

export function getScoreCardTypeLabel(type: ScoreCardType) {
  return {
    standard: "Standard",
    numbers: "Numbers",
    colors: "Colors",
    numbersAndColors: "Numbers + Colors",
  }[type];
}

export function cloneScoreCardFilters(filters: ScoreCardFilters): ScoreCardFilters {
  return { ...filters };
}

export function hasAnyScoreCardFilter(filters: ScoreCardFilters) {
  return SCORE_CARD_TYPES.some((type) => filters[type]);
}

export function normalizeScoreCardFilters(value: unknown): ScoreCardFilters {
  if (!value || typeof value !== "object") {
    return cloneScoreCardFilters(DEFAULT_SCORE_CARD_FILTERS);
  }

  const candidate = value as Partial<ScoreCardFilters>;
  const filters = {
    standard: candidate.standard === true,
    numbers: candidate.numbers === true,
    colors: candidate.colors === true,
    numbersAndColors: candidate.numbersAndColors === true,
  };

  return hasAnyScoreCardFilter(filters) ? filters : cloneScoreCardFilters(DEFAULT_SCORE_CARD_FILTERS);
}

export function getFilteredScoreCards(filters: ScoreCardFilters) {
  return SCORE_CARDS.filter((card) => filters[card.type]);
}

export function firstFilteredScoreCardId(filters: ScoreCardFilters) {
  return getFilteredScoreCards(filters)[0]?.id ?? DEFAULT_SCORE_CARD_ID;
}

export function filtersIncludeScoreCard(filters: ScoreCardFilters, id: number) {
  return Boolean(filters[getScoreCard(id).type]);
}

export function ensureFilteredScoreCardId(id: number, filters: ScoreCardFilters) {
  return filtersIncludeScoreCard(filters, id) ? id : firstFilteredScoreCardId(filters);
}

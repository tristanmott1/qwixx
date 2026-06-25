import {
  AlertTriangle,
  ArrowRight,
  Check,
  CircleDashed,
  Crown,
  Eye,
  EyeOff,
  GripVertical,
  Lock,
  Pencil,
  Plus,
  RotateCcw,
  ScanLine,
  Shuffle,
  Star,
  Trash2,
  Undo2,
  Unlock,
  Wifi,
  X,
} from "lucide-react";
import QRCode from "qrcode";
import {
  type CSSProperties,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import jsQR from "jsqr";
import {
  DEFAULT_SCORE_CARD_ID,
  DEFAULT_SCORE_CARD_FILTERS,
  ROW_COLORS,
  SCORE_CARD_TYPES,
  cloneScoreCardFilters,
  ensureFilteredScoreCardId,
  filtersIncludeScoreCard,
  firstFilteredScoreCardId,
  getFilteredScoreCards,
  getScoreCard,
  getScoreCardFinalTile,
  getScoreCardLockColor,
  getScoreCardNumbers,
  getScoreCardRow,
  getScoreCardRowLabel,
  getScoreCardTile,
  getScoreCardTypeLabel,
  hasAnyScoreCardFilter,
  isScoreCardColor,
  normalizeScoreCardFilters,
  normalizeScoreCardId,
  type ScoreCardColor,
  type ScoreCardFilters,
  type ScoreCardPreset,
  type ScoreCardType,
} from "./scoreCards";
import { SyncHostTransport, SyncJoinTransport, type SyncWireMessage } from "./syncTransport";

type Page = "home" | "picker" | "play";
type HomeTab = "local" | "sync";
type PlayMode = "local" | "sync";
type SyncRole = "host" | "joiner" | null;
type SyncPhase = "idle" | "hostLobby" | "showAnswer" | "lobby" | "turn" | "gameOver";

type Player = {
  id: string;
  name: string;
};

type RowColor = ScoreCardColor;

type RowState = {
  selected: number[];
  lock: "none" | "own" | "opponent";
};

type RowsState = Record<RowColor, RowState>;

type ScoreMark = {
  row: RowColor;
  number: number;
};

type DiceRoll = {
  whiteA: number;
  whiteB: number;
  red?: number;
  yellow?: number;
  green?: number;
  blue?: number;
};

type TurnCore = {
  roll: DiceRoll | null;
  opponentWhiteSum: number | null;
  selectedMarks: ScoreMark[];
  penalty: boolean;
  opponentLocks: RowColor[];
};

type UndoKind = "roll" | "whiteSum" | "mark" | "penalty" | "opponentLock";
type MarkRole = "white" | "mixed";

type UndoEntry = {
  before: TurnCore;
  kind: UndoKind;
};

type TurnDraft = TurnCore & {
  history: UndoEntry[];
};

type GameOverReason = "rows" | "ownPenalties" | "opponentPenalties" | null;

type SyncReadyPayload = {
  turnId: string;
  playerId: string;
  closedRows: RowColor[];
  reachedFourPenalties: boolean;
};

type SyncClosedBy = {
  playerId: string;
  row: RowColor;
};

type BarcodeDetectorResult = {
  rawValue: string;
};

type BarcodeDetectorInstance = {
  detect: (source: CanvasImageSource) => Promise<BarcodeDetectorResult[]>;
};

type BarcodeDetectorConstructor = new (options: { formats: string[] }) => BarcodeDetectorInstance;

type ExtendedMediaTrackCapabilities = MediaTrackCapabilities & {
  focusMode?: string[];
  torch?: boolean;
};

type ExtendedMediaTrackConstraintSet = MediaTrackConstraintSet & {
  focusMode?: string;
  torch?: boolean;
};

type GameSnapshot = {
  currentPlayerIndex: number;
  rows: RowsState;
  penalties: number;
  turn: TurnDraft;
  gameOver: boolean;
  gameOverReason: GameOverReason;
};

type LatestSyncState = {
  rows: RowsState;
  penalties: number;
  turn: TurnDraft;
  gamePlayers: Player[];
  currentPlayerIndex: number;
  syncTurnId: string;
  syncPhase: SyncPhase;
  syncRole: SyncRole;
  syncReadyPayloads: SyncReadyPayload[];
  syncHostPlayerId: string | null;
  selectedPlayerId: string | null;
  showHints: boolean;
  syncHintsLockedOff: boolean;
  gameScoreCardId: number;
  syncScoreCardId: number | null;
};

type PlayStatePatch = {
  rows?: RowsState;
  penalties?: number;
  turn?: TurnDraft;
  gamePlayers?: Player[];
  currentPlayerIndex?: number;
  gameOver?: boolean;
  gameOverReason?: GameOverReason;
  undoStack?: GameSnapshot[];
  syncTurnId?: string;
  syncReadyPayloads?: SyncReadyPayload[];
  syncPhase?: SyncPhase;
  selectedPlayerId?: string | null;
  showHints?: boolean;
  syncHintsLockedOff?: boolean;
  gameScoreCardId?: number;
  syncScoreCardId?: number | null;
  rollAnimationKey?: number;
};

type ActiveGame = {
  mode?: "local";
  page: "play";
  players: Player[];
  selectedPlayerId: string;
  currentPlayerIndex: number;
  rows: RowsState;
  penalties: number;
  turn: TurnDraft;
  gameOver: boolean;
  gameOverReason: GameOverReason;
  undoStack: GameSnapshot[];
  scoreCardId?: number;
};

const PLAYERS_KEY = "qwixx.players.v1";
const SELECTED_PLAYER_KEY = "qwixx.selectedPlayer.v1";
const SHOW_HINTS_KEY = "qwixx.showHints.v1";
const ACTIVE_GAME_KEY = "qwixx.activeGame.v1";
const SYNC_NAME_KEY = "qwixx.syncName.v1";
const SELECTED_SCORE_CARD_KEY = "qwixx.selectedScoreCard.v1";
const SCORE_CARD_FILTERS_KEY = "qwixx.scoreCardFilters.v1";

const SUM_NUMBERS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
const SCORE_VALUES = [0, 1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 66, 78] as const;
const MAX_PENALTIES = 4;
const PENALTY_POINTS = 5;

const DICE_LAYOUT = [
  { key: "whiteA", color: "white", row: 1, column: 1 },
  { key: "red", color: "red", row: 1, column: 2 },
  { key: "green", color: "green", row: 1, column: 3 },
  { key: "whiteB", color: "white", row: 2, column: 1 },
  { key: "yellow", color: "yellow", row: 2, column: 2 },
  { key: "blue", color: "blue", row: 2, column: 3 },
] as const;

const SCORE_COLOR_BACKGROUNDS: Record<RowColor, string> = {
  red: "var(--red)",
  yellow: "var(--yellow)",
  green: "var(--green)",
  blue: "var(--blue)",
};

const SCORE_COLOR_TILE_FILLS: Record<RowColor, string> = {
  red: "#fca5a5",
  yellow: "#fde68a",
  green: "#86efac",
  blue: "#93c5fd",
};

function createId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createEmptyRows(): RowsState {
  return {
    red: { selected: [], lock: "none" },
    yellow: { selected: [], lock: "none" },
    green: { selected: [], lock: "none" },
    blue: { selected: [], lock: "none" },
  };
}

function createEmptyTurn(): TurnDraft {
  return {
    roll: null,
    opponentWhiteSum: null,
    selectedMarks: [],
    penalty: false,
    opponentLocks: [],
    history: [],
  };
}

function createFreshGame(players: Player[], selectedPlayerId: string, scoreCardId: number): ActiveGame {
  return {
    mode: "local",
    page: "play",
    players,
    selectedPlayerId,
    scoreCardId,
    currentPlayerIndex: 0,
    rows: createEmptyRows(),
    penalties: 0,
    turn: createEmptyTurn(),
    gameOver: false,
    gameOverReason: null,
    undoStack: [],
  };
}

function isRowColor(value: unknown): value is RowColor {
  return isScoreCardColor(value);
}

function isValidSum(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 2 && value <= 12;
}

function uniqueRows(rows: RowColor[]) {
  return rows.filter((row, index) => rows.indexOf(row) === index);
}

function nextTurnId() {
  return createId();
}

function withUndoHistory(currentTurn: TurnDraft, nextTurn: TurnCore, kind: UndoKind): TurnDraft {
  return {
    ...nextTurn,
    history: [...currentTurn.history, { before: cloneTurnCore(currentTurn), kind }],
  };
}

function restoreUndoEntry(turn: TurnDraft, entry: UndoEntry): TurnDraft {
  return {
    ...entry.before,
    history: turn.history.slice(0, -1),
  };
}

function cloneRows(rows: RowsState): RowsState {
  return {
    red: { selected: [...rows.red.selected], lock: rows.red.lock },
    yellow: { selected: [...rows.yellow.selected], lock: rows.yellow.lock },
    green: { selected: [...rows.green.selected], lock: rows.green.lock },
    blue: { selected: [...rows.blue.selected], lock: rows.blue.lock },
  };
}

function cloneTurnCore(turn: TurnCore): TurnCore {
  return {
    roll: turn.roll ? { ...turn.roll } : null,
    opponentWhiteSum: turn.opponentWhiteSum,
    selectedMarks: turn.selectedMarks.map((mark) => ({ ...mark })),
    penalty: turn.penalty,
    opponentLocks: [...turn.opponentLocks],
  };
}

function cloneTurn(turn: TurnDraft): TurnDraft {
  return {
    ...cloneTurnCore(turn),
    history: turn.history.map((entry) => ({
      before: cloneTurnCore(entry.before),
      kind: entry.kind,
    })),
  };
}

function createGameSnapshot(
  currentPlayerIndex: number,
  rows: RowsState,
  penalties: number,
  turn: TurnDraft,
  gameOver: boolean,
  gameOverReason: GameOverReason,
): GameSnapshot {
  return {
    currentPlayerIndex,
    rows: cloneRows(rows),
    penalties,
    turn: cloneTurn(turn),
    gameOver,
    gameOverReason,
  };
}

function normalizePlayers(value: unknown): Player[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((player) => {
      if (!player || typeof player !== "object") {
        return null;
      }

      const candidate = player as Partial<Player>;
      const name = typeof candidate.name === "string" ? candidate.name.trim() : "";

      if (!name) {
        return null;
      }

      return {
        id: typeof candidate.id === "string" ? candidate.id : createId(),
        name,
      };
    })
    .filter((player): player is Player => Boolean(player));
}

function normalizeRows(value: unknown, scoreCard: ScoreCardPreset = getScoreCard(DEFAULT_SCORE_CARD_ID)): RowsState {
  const rows = createEmptyRows();

  if (!value || typeof value !== "object") {
    return rows;
  }

  const rawRows = value as Partial<Record<RowColor, Partial<RowState>>>;

  ROW_COLORS.forEach((row) => {
    const rawRow = rawRows[row];
    const selected = Array.isArray(rawRow?.selected)
      ? rawRow.selected
          .filter((number): number is number => getScoreCardNumbers(scoreCard, row).includes(Number(number)))
          .map(Number)
          .filter((number, index, values) => values.indexOf(number) === index)
          .sort((left, right) => visualIndex(scoreCard, row, left) - visualIndex(scoreCard, row, right))
      : [];
    const lock = rawRow?.lock === "own" || rawRow?.lock === "opponent" ? rawRow.lock : "none";

    rows[row] = { selected, lock };
  });

  return rows;
}

function normalizeRoll(value: unknown): DiceRoll | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const rawRoll = value as Partial<Record<keyof DiceRoll, unknown>>;
  const whiteA = Number(rawRoll.whiteA);
  const whiteB = Number(rawRoll.whiteB);

  if (!isDieValue(whiteA) || !isDieValue(whiteB)) {
    return null;
  }

  const roll: DiceRoll = { whiteA, whiteB };

  ROW_COLORS.forEach((row) => {
    const valueForRow = Number(rawRoll[row]);
    if (isDieValue(valueForRow)) {
      roll[row] = valueForRow;
    }
  });

  return roll;
}

function normalizeTurnCore(value: unknown, scoreCard: ScoreCardPreset = getScoreCard(DEFAULT_SCORE_CARD_ID)): TurnCore {
  const turn: TurnCore = {
    roll: null,
    opponentWhiteSum: null,
    selectedMarks: [],
    penalty: false,
    opponentLocks: [],
  };
  if (!value || typeof value !== "object") {
    return turn;
  }

  const rawTurn = value as Partial<TurnCore>;
  const opponentWhiteSum = Number(rawTurn.opponentWhiteSum);

  turn.roll = normalizeRoll(rawTurn.roll);
  turn.opponentWhiteSum = isValidSum(opponentWhiteSum) ? opponentWhiteSum : null;
  turn.penalty = rawTurn.penalty === true;
  turn.opponentLocks = Array.isArray(rawTurn.opponentLocks)
    ? uniqueRows(rawTurn.opponentLocks.filter(isRowColor))
    : [];
  turn.selectedMarks = Array.isArray(rawTurn.selectedMarks)
    ? rawTurn.selectedMarks
        .map((mark) => {
          if (!mark || typeof mark !== "object") {
            return null;
          }

          const candidate = mark as Partial<ScoreMark>;
          const row = candidate.row;
          const number = Number(candidate.number);

          if (!isRowColor(row) || !getScoreCardNumbers(scoreCard, row).includes(number)) {
            return null;
          }

          return { row, number };
        })
        .filter((mark): mark is ScoreMark => Boolean(mark))
        .filter((mark, index, marks) => marks.findIndex((other) => markKey(other) === markKey(mark)) === index)
        .slice(0, 2)
    : [];

  return turn;
}

function normalizeUndoEntry(
  value: unknown,
  scoreCard: ScoreCardPreset = getScoreCard(DEFAULT_SCORE_CARD_ID),
): UndoEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const rawEntry = value as Partial<UndoEntry>;
  const kind = rawEntry.kind;

  if (
    kind !== "roll" &&
    kind !== "whiteSum" &&
    kind !== "mark" &&
    kind !== "penalty" &&
    kind !== "opponentLock"
  ) {
    return null;
  }

  return {
    before: normalizeTurnCore(rawEntry.before, scoreCard),
    kind,
  };
}

function normalizeTurn(value: unknown, scoreCard: ScoreCardPreset = getScoreCard(DEFAULT_SCORE_CARD_ID)): TurnDraft {
  const core = normalizeTurnCore(value, scoreCard);
  const rawTurn = value && typeof value === "object" ? (value as Partial<TurnDraft>) : null;
  const history = Array.isArray(rawTurn?.history)
    ? rawTurn.history.map((entry) => normalizeUndoEntry(entry, scoreCard)).filter((entry): entry is UndoEntry => Boolean(entry))
    : [];

  return {
    ...core,
    history,
  };
}

function normalizeGameOverReason(value: unknown): GameOverReason {
  return value === "rows" || value === "ownPenalties" || value === "opponentPenalties" ? value : null;
}

function normalizeGameSnapshot(value: unknown, playerCount: number, scoreCard: ScoreCardPreset): GameSnapshot | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const snapshot = value as Partial<GameSnapshot>;
  const currentPlayerIndex = Number(snapshot.currentPlayerIndex);
  const penalties = Number(snapshot.penalties);

  if (!Number.isInteger(currentPlayerIndex) || currentPlayerIndex < 0 || currentPlayerIndex >= playerCount) {
    return null;
  }

  return {
    currentPlayerIndex,
    rows: normalizeRows(snapshot.rows, scoreCard),
    penalties: Number.isInteger(penalties) ? Math.max(0, Math.min(MAX_PENALTIES, penalties)) : 0,
    turn: normalizeTurn(snapshot.turn, scoreCard),
    gameOver: snapshot.gameOver === true,
    gameOverReason: normalizeGameOverReason(snapshot.gameOverReason),
  };
}

function readStoredPlayers(): Player[] {
  try {
    return normalizePlayers(JSON.parse(localStorage.getItem(PLAYERS_KEY) ?? "[]"));
  } catch {
    return [];
  }
}

function readSelectedPlayerId() {
  try {
    const value = localStorage.getItem(SELECTED_PLAYER_KEY);
    return value || null;
  } catch {
    return null;
  }
}

function readStoredShowHints() {
  try {
    return localStorage.getItem(SHOW_HINTS_KEY) === "true";
  } catch {
    return false;
  }
}

function readStoredSyncName() {
  try {
    return localStorage.getItem(SYNC_NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

function readStoredScoreCardSelection() {
  try {
    const filters = normalizeScoreCardFilters(JSON.parse(localStorage.getItem(SCORE_CARD_FILTERS_KEY) ?? "null"));
    const storedId = normalizeScoreCardId(localStorage.getItem(SELECTED_SCORE_CARD_KEY), DEFAULT_SCORE_CARD_ID);
    const id = ensureFilteredScoreCardId(storedId, filters);

    return { id, filters };
  } catch {
    return {
      id: DEFAULT_SCORE_CARD_ID,
      filters: cloneScoreCardFilters(DEFAULT_SCORE_CARD_FILTERS),
    };
  }
}

function readActiveGame(): ActiveGame | null {
  try {
    const raw = localStorage.getItem(ACTIVE_GAME_KEY);
    const parsed = raw ? JSON.parse(raw) : null;

    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const game = parsed as Partial<ActiveGame>;
    const players = normalizePlayers(game.players);
    const selectedPlayerId = typeof game.selectedPlayerId === "string" ? game.selectedPlayerId : "";
    const currentPlayerIndex = Number(game.currentPlayerIndex);
    const penalties = Number(game.penalties);
    const gameOverReason = normalizeGameOverReason(game.gameOverReason);
    const scoreCardId = normalizeScoreCardId(game.scoreCardId, DEFAULT_SCORE_CARD_ID);
    const scoreCard = getScoreCard(scoreCardId);

    if (
      game.page !== "play" ||
      players.length === 0 ||
      !players.some((player) => player.id === selectedPlayerId) ||
      !Number.isInteger(currentPlayerIndex) ||
      currentPlayerIndex < 0 ||
      currentPlayerIndex >= players.length
    ) {
      return null;
    }

    return {
      page: "play",
      players,
      selectedPlayerId,
      scoreCardId,
      currentPlayerIndex,
      rows: normalizeRows(game.rows, scoreCard),
      penalties: Number.isInteger(penalties) ? Math.max(0, Math.min(MAX_PENALTIES, penalties)) : 0,
      turn: normalizeTurn(game.turn, scoreCard),
      gameOver: game.gameOver === true,
      gameOverReason,
      undoStack: Array.isArray(game.undoStack)
        ? game.undoStack
            .map((snapshot) => normalizeGameSnapshot(snapshot, players.length, scoreCard))
            .filter((snapshot): snapshot is GameSnapshot => Boolean(snapshot))
        : [],
    };
  } catch {
    return null;
  }
}

function shufflePlayers(players: Player[]) {
  const shuffled = [...players];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return shuffled;
}

function moveItem<T>(items: T[], fromIndex: number, toIndex: number) {
  const nextItems = [...items];
  const [item] = nextItems.splice(fromIndex, 1);
  nextItems.splice(toIndex, 0, item);
  return nextItems;
}

function isDieValue(value: number): value is 1 | 2 | 3 | 4 | 5 | 6 {
  return Number.isInteger(value) && value >= 1 && value <= 6;
}

function rollDie() {
  return (Math.floor(Math.random() * 6) + 1) as 1 | 2 | 3 | 4 | 5 | 6;
}

function isDieAvailable(color: RowColor, rows: RowsState, scoreCard: ScoreCardPreset) {
  return ROW_COLORS.every((row) => rows[row].lock === "none" || getScoreCardLockColor(scoreCard, row) !== color);
}

function rollDice(rows: RowsState, scoreCard: ScoreCardPreset): DiceRoll {
  const roll: DiceRoll = {
    whiteA: rollDie(),
    whiteB: rollDie(),
  };

  ROW_COLORS.forEach((color) => {
    if (isDieAvailable(color, rows, scoreCard)) {
      roll[color] = rollDie();
    }
  });

  return roll;
}

function markKey(mark: ScoreMark) {
  return `${mark.row}-${mark.number}`;
}

function visualIndex(scoreCard: ScoreCardPreset, row: RowColor, number: number) {
  return getScoreCardNumbers(scoreCard, row).indexOf(number);
}

function getCommittedClosedCount(rows: RowsState) {
  return ROW_COLORS.filter((row) => rows[row].lock !== "none").length;
}

function getSelectedCountForRow(row: RowColor, rows: RowsState, turn: TurnDraft) {
  const stagedCount = turn.selectedMarks.filter((mark) => mark.row === row).length;
  return rows[row].selected.length + stagedCount;
}

function getRightmostSelectedIndex(scoreCard: ScoreCardPreset, row: RowColor, rows: RowsState, turn: TurnDraft) {
  const indexes = [
    ...rows[row].selected.map((number) => visualIndex(scoreCard, row, number)),
    ...turn.selectedMarks.filter((mark) => mark.row === row).map((mark) => visualIndex(scoreCard, row, mark.number)),
  ];

  return indexes.length > 0 ? Math.max(...indexes) : -1;
}

function hasStagedOwnLock(scoreCard: ScoreCardPreset, row: RowColor, turn: TurnDraft) {
  return turn.selectedMarks.some((mark) => mark.row === row && mark.number === getScoreCardFinalTile(scoreCard, row).number);
}

function isRowUnavailableThisTurn(scoreCard: ScoreCardPreset, row: RowColor, rows: RowsState, turn: TurnDraft) {
  return rows[row].lock !== "none" || turn.opponentLocks.includes(row) || hasStagedOwnLock(scoreCard, row, turn);
}

function canPhysicallySelectMark(scoreCard: ScoreCardPreset, row: RowColor, number: number, rows: RowsState, turn: TurnDraft) {
  if (isRowUnavailableThisTurn(scoreCard, row, rows, turn)) {
    return false;
  }

  if (turn.selectedMarks.some((mark) => mark.row === row && mark.number === number)) {
    return false;
  }

  if (!getScoreCardNumbers(scoreCard, row).includes(number)) {
    return false;
  }

  const index = visualIndex(scoreCard, row, number);

  if (index <= getRightmostSelectedIndex(scoreCard, row, rows, turn)) {
    return false;
  }

  if (number === getScoreCardFinalTile(scoreCard, row).number && getSelectedCountForRow(row, rows, turn) < 5) {
    return false;
  }

  return true;
}

function getWhiteSum(turn: TurnDraft, isUserTurn: boolean, mode: PlayMode = "local") {
  if (isUserTurn || mode === "sync") {
    return turn.roll ? turn.roll.whiteA + turn.roll.whiteB : null;
  }

  return turn.opponentWhiteSum;
}

function getMixedSums(turn: TurnDraft) {
  const sums: Partial<Record<RowColor, number[]>> = {};

  const roll = turn.roll;

  if (!roll) {
    return sums;
  }

  ROW_COLORS.forEach((row) => {
    const dieValue = roll[row];

    if (dieValue) {
      sums[row] = [roll.whiteA + dieValue, roll.whiteB + dieValue];
    }
  });

  return sums;
}

function getRolesForMark(
  scoreCard: ScoreCardPreset,
  mark: ScoreMark,
  whiteSum: number | null,
  mixedSums: Partial<Record<RowColor, number[]>>,
) {
  const roles: MarkRole[] = [];
  const tile = getScoreCardTile(scoreCard, mark.row, mark.number);

  if (whiteSum === mark.number) {
    roles.push("white");
  }

  if (tile && mixedSums[tile.color]?.includes(mark.number)) {
    roles.push("mixed");
  }

  return roles;
}

function isValidRoleOrder(scoreCard: ScoreCardPreset, whiteMark: ScoreMark, mixedMark: ScoreMark) {
  // White must be visually first only when both marks live in the same row.
  return (
    whiteMark.row !== mixedMark.row ||
    visualIndex(scoreCard, whiteMark.row, whiteMark.number) < visualIndex(scoreCard, mixedMark.row, mixedMark.number)
  );
}

function getValidUserRoleAssignments(scoreCard: ScoreCardPreset, marks: ScoreMark[], turn: TurnDraft) {
  const whiteSum = getWhiteSum(turn, true);
  const mixedSums = getMixedSums(turn);

  if (!whiteSum || marks.length === 0 || marks.length > 2) {
    return [];
  }

  if (marks.length === 1) {
    return getRolesForMark(scoreCard, marks[0], whiteSum, mixedSums).map((role) => [role]);
  }

  const firstRoles = getRolesForMark(scoreCard, marks[0], whiteSum, mixedSums);
  const secondRoles = getRolesForMark(scoreCard, marks[1], whiteSum, mixedSums);
  const assignments: MarkRole[][] = [];

  if (firstRoles.includes("white") && secondRoles.includes("mixed") && isValidRoleOrder(scoreCard, marks[0], marks[1])) {
    assignments.push(["white", "mixed"]);
  }

  if (firstRoles.includes("mixed") && secondRoles.includes("white") && isValidRoleOrder(scoreCard, marks[1], marks[0])) {
    assignments.push(["mixed", "white"]);
  }

  return assignments;
}

function hasValidUserInterpretation(scoreCard: ScoreCardPreset, marks: ScoreMark[], turn: TurnDraft) {
  return getValidUserRoleAssignments(scoreCard, marks, turn).length > 0;
}

function getCandidateMarks(scoreCard: ScoreCardPreset, rows: RowsState, turn: TurnDraft) {
  return ROW_COLORS.flatMap((row) =>
    getScoreCardNumbers(scoreCard, row)
      .filter((number) => canPhysicallySelectMark(scoreCard, row, number, rows, turn))
      .map((number) => ({ row, number })),
  );
}

function getLegalMarkRoleMap({
  rows,
  turn,
  isUserTurn,
  mode = "local",
  gameOver,
  scoreCard,
}: {
  rows: RowsState;
  turn: TurnDraft;
  isUserTurn: boolean;
  mode?: PlayMode;
  gameOver: boolean;
  scoreCard: ScoreCardPreset;
}) {
  const roleMap = new Map<string, Set<MarkRole>>();

  if (gameOver) {
    return roleMap;
  }

  const whiteSum = getWhiteSum(turn, isUserTurn, mode);

  if (!whiteSum) {
    return roleMap;
  }

  if (!isUserTurn) {
    if (turn.selectedMarks.length > 0 || turn.penalty) {
      return roleMap;
    }

    getCandidateMarks(scoreCard, rows, turn)
      .filter((mark) => mark.number === whiteSum)
      .forEach((mark) => roleMap.set(markKey(mark), new Set(["white"])));
    return roleMap;
  }

  if (turn.penalty || turn.selectedMarks.length >= 2) {
    return roleMap;
  }

  getCandidateMarks(scoreCard, rows, turn).forEach((mark) => {
    const assignments = getValidUserRoleAssignments(scoreCard, [...turn.selectedMarks, mark], turn);
    const legalRoles = new Set<MarkRole>();
    const roleIndex = turn.selectedMarks.length;

    assignments.forEach((assignment) => {
      const role = assignment[roleIndex];

      if (role) {
        legalRoles.add(role);
      }
    });

    if (legalRoles.size > 0) {
      roleMap.set(markKey(mark), legalRoles);
    }
  });

  return roleMap;
}

function canSelectPenalty(turn: TurnDraft, isUserTurn: boolean, penalties: number, gameOver: boolean) {
  return (
    isUserTurn &&
    !gameOver &&
    Boolean(turn.roll) &&
    !turn.penalty &&
    turn.selectedMarks.length === 0 &&
    penalties < MAX_PENALTIES
  );
}

function canStageOpponentLock(
  scoreCard: ScoreCardPreset,
  row: RowColor,
  rows: RowsState,
  turn: TurnDraft,
  diceStageDone: boolean,
  gameOver: boolean,
) {
  return (
    !gameOver &&
    diceStageDone &&
    rows[row].lock === "none" &&
    !turn.opponentLocks.includes(row) &&
    !hasStagedOwnLock(scoreCard, row, turn)
  );
}

function canAdvanceTurn(scoreCard: ScoreCardPreset, turn: TurnDraft, isUserTurn: boolean, gameOver: boolean) {
  if (gameOver) {
    return false;
  }

  if (isUserTurn) {
    if (!turn.roll) {
      return false;
    }

    if (turn.penalty) {
      return turn.selectedMarks.length === 0;
    }

    return hasValidUserInterpretation(scoreCard, turn.selectedMarks, turn);
  }

  return turn.opponentWhiteSum !== null;
}

function getPreviewColorCount(color: RowColor, scoreCard: ScoreCardPreset, rows: RowsState, turn: TurnDraft) {
  let count = 0;

  ROW_COLORS.forEach((row) => {
    rows[row].selected.forEach((number) => {
      if (getScoreCardTile(scoreCard, row, number)?.color === color) {
        count += 1;
      }
    });

    turn.selectedMarks.forEach((mark) => {
      if (mark.row === row && getScoreCardTile(scoreCard, mark.row, mark.number)?.color === color) {
        count += 1;
      }
    });

    if ((rows[row].lock === "own" || hasStagedOwnLock(scoreCard, row, turn)) && getScoreCardLockColor(scoreCard, row) === color) {
      count += 1;
    }
  });

  return count;
}

function getColorScore(color: RowColor, scoreCard: ScoreCardPreset, rows: RowsState, turn: TurnDraft) {
  return SCORE_VALUES[Math.min(12, getPreviewColorCount(color, scoreCard, rows, turn))];
}

function getPenaltyCount(penalties: number, turn: TurnDraft) {
  return penalties + (turn.penalty ? 1 : 0);
}

function getTotalScore(scoreCard: ScoreCardPreset, rows: RowsState, penalties: number, turn: TurnDraft) {
  const colorTotal = ROW_COLORS.reduce((total, row) => total + getColorScore(row, scoreCard, rows, turn), 0);
  return colorTotal - getPenaltyCount(penalties, turn) * PENALTY_POINTS;
}

function getOwnClosedRows(scoreCard: ScoreCardPreset, turn: TurnDraft) {
  return ROW_COLORS.filter((row) => hasStagedOwnLock(scoreCard, row, turn));
}

function createReadyPayload(
  scoreCard: ScoreCardPreset,
  turnId: string,
  playerId: string,
  penalties: number,
  turn: TurnDraft,
): SyncReadyPayload {
  return {
    turnId,
    playerId,
    closedRows: getOwnClosedRows(scoreCard, turn),
    reachedFourPenalties: penalties + (turn.penalty ? 1 : 0) >= MAX_PENALTIES,
  };
}

function createClosedBy(payloads: SyncReadyPayload[]) {
  return payloads.flatMap((payload) =>
    payload.closedRows.map((row) => ({
      playerId: payload.playerId,
      row,
    })),
  );
}

function getPenaltyPlayerIds(payloads: SyncReadyPayload[]) {
  return payloads
    .filter((payload) => payload.reachedFourPenalties)
    .map((payload) => payload.playerId);
}

function commitLocalTurnState(scoreCard: ScoreCardPreset, rows: RowsState, penalties: number, turn: TurnDraft) {
  const nextRows = cloneRows(rows);

  turn.selectedMarks.forEach((mark) => {
    if (!nextRows[mark.row].selected.includes(mark.number)) {
      nextRows[mark.row].selected.push(mark.number);
      nextRows[mark.row].selected.sort((left, right) => visualIndex(scoreCard, mark.row, left) - visualIndex(scoreCard, mark.row, right));
    }
  });

  ROW_COLORS.forEach((row) => {
    if (hasStagedOwnLock(scoreCard, row, turn)) {
      nextRows[row].lock = "own";
    }
  });

  turn.opponentLocks.forEach((row) => {
    if (nextRows[row].lock === "none") {
      nextRows[row].lock = "opponent";
    }
  });

  return {
    rows: nextRows,
    penalties: penalties + (turn.penalty ? 1 : 0),
  };
}

function applyGlobalClosedRows(rows: RowsState, closedRows: RowColor[]) {
  const nextRows = cloneRows(rows);

  closedRows.forEach((row) => {
    if (nextRows[row].lock === "none") {
      nextRows[row].lock = "opponent";
    }
  });

  return nextRows;
}

function getGameOverFromRowsAndPenalties(rows: RowsState, penalties: number, fallbackReason: GameOverReason) {
  const closedCount = getCommittedClosedCount(rows);
  const isGameOver = closedCount >= 2 || penalties >= MAX_PENALTIES || fallbackReason === "opponentPenalties";

  return {
    gameOver: isGameOver,
    gameOverReason: closedCount >= 2 ? "rows" : penalties >= MAX_PENALTIES ? "ownPenalties" : fallbackReason,
  };
}

function normalizeReadyPayload(value: unknown): SyncReadyPayload | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const payload = value as Partial<SyncReadyPayload>;

  if (typeof payload.turnId !== "string" || typeof payload.playerId !== "string") {
    return null;
  }

  return {
    turnId: payload.turnId,
    playerId: payload.playerId,
    closedRows: Array.isArray(payload.closedRows) ? uniqueRows(payload.closedRows.filter(isRowColor)) : [],
    reachedFourPenalties: payload.reachedFourPenalties === true,
  };
}

function normalizeClosedBy(value: unknown): SyncClosedBy[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    const entry = item as Partial<SyncClosedBy>;

    if (typeof entry.playerId !== "string" || !isRowColor(entry.row)) {
      return [];
    }

    return [{ playerId: entry.playerId, row: entry.row }];
  });
}

function normalizePlayerIds(value: unknown) {
  return Array.isArray(value) ? value.filter((playerId): playerId is string => typeof playerId === "string") : [];
}

function playerName(players: Player[], playerId: string) {
  return players.find((player) => player.id === playerId)?.name ?? "A player";
}

function formatNameList(names: string[]) {
  if (names.length <= 1) {
    return names[0] ?? "A player";
  }

  if (names.length === 2) {
    return `${names[0]} and ${names[1]}`;
  }

  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

function orderedNamesForPlayerIds(players: Player[], playerIds: string[]) {
  const uniqueIds = Array.from(new Set(playerIds));
  const orderedIds = [
    ...players.filter((player) => uniqueIds.includes(player.id)).map((player) => player.id),
    ...uniqueIds.filter((playerId) => !players.some((player) => player.id === playerId)),
  ];

  return orderedIds.map((playerId) => playerName(players, playerId));
}

function formatSyncAdvanceToast(scoreCard: ScoreCardPreset, closedBy: SyncClosedBy[], penaltyPlayerIds: string[], players: Player[]) {
  const closureMessages = ROW_COLORS.flatMap((color) => {
    const rowPlayerIds = closedBy
      .filter((entry) => getScoreCardLockColor(scoreCard, entry.row) === color)
      .map((entry) => entry.playerId);

    if (rowPlayerIds.length === 0) {
      return [];
    }

    return [`${formatNameList(orderedNamesForPlayerIds(players, rowPlayerIds))} closed ${color}`];
  });
  const penaltyMessage =
    penaltyPlayerIds.length > 0
      ? `${formatNameList(orderedNamesForPlayerIds(players, penaltyPlayerIds))} reached 4 penalties`
      : "";

  return [...closureMessages, penaltyMessage].filter(Boolean).join(". ");
}

function App() {
  const savedGameRef = useRef<ActiveGame | null>(readActiveGame());
  const savedGame = savedGameRef.current;
  const storedScoreCardSelectionRef = useRef(readStoredScoreCardSelection());
  const storedScoreCardSelection = storedScoreCardSelectionRef.current;
  const [page, setPage] = useState<Page>(savedGame?.page ?? "home");
  const [mode, setMode] = useState<PlayMode>("local");
  const [homeTab, setHomeTab] = useState<HomeTab>("local");
  const [scoreCardId, setScoreCardId] = useState(storedScoreCardSelection.id);
  const [scoreCardFilters, setScoreCardFilters] = useState<ScoreCardFilters>(storedScoreCardSelection.filters);
  const [gameScoreCardId, setGameScoreCardId] = useState(savedGame?.scoreCardId ?? storedScoreCardSelection.id);
  const [syncScoreCardId, setSyncScoreCardId] = useState<number | null>(null);
  const [pickerContext, setPickerContext] = useState<"local" | "syncHost" | null>(null);
  const [draftScoreCardId, setDraftScoreCardId] = useState(storedScoreCardSelection.id);
  const [draftScoreCardFilters, setDraftScoreCardFilters] = useState<ScoreCardFilters>(storedScoreCardSelection.filters);
  const [players, setPlayers] = useState<Player[]>(savedGame?.players ?? readStoredPlayers);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(
    savedGame?.selectedPlayerId ?? readSelectedPlayerId(),
  );
  const [draftName, setDraftName] = useState("");
  const [syncName, setSyncName] = useState(readStoredSyncName);
  const [syncRole, setSyncRole] = useState<SyncRole>(null);
  const [syncPhase, setSyncPhase] = useState<SyncPhase>("idle");
  const [syncHostPlayerId, setSyncHostPlayerId] = useState<string | null>(null);
  const [syncTurnId, setSyncTurnId] = useState(nextTurnId);
  const [syncReadyPayloads, setSyncReadyPayloads] = useState<SyncReadyPayload[]>([]);
  const [syncQrText, setSyncQrText] = useState("");
  const [syncAnswerText, setSyncAnswerText] = useState("");
  const [syncCameraMode, setSyncCameraMode] = useState<"answer" | "offer" | null>(null);
  const [syncMessage, setSyncMessage] = useState("");
  const [isAcceptingAnswer, setIsAcceptingAnswer] = useState(false);
  const [syncPenaltyPlayerIds, setSyncPenaltyPlayerIds] = useState<string[]>([]);
  const [syncToastMessage, setSyncToastMessage] = useState("");
  const [gamePlayers, setGamePlayers] = useState<Player[]>(savedGame?.players ?? []);
  const [currentPlayerIndex, setCurrentPlayerIndex] = useState(savedGame?.currentPlayerIndex ?? 0);
  const [rows, setRows] = useState<RowsState>(savedGame?.rows ?? createEmptyRows);
  const [penalties, setPenalties] = useState(savedGame?.penalties ?? 0);
  const [turn, setTurn] = useState<TurnDraft>(savedGame?.turn ?? createEmptyTurn);
  const [gameOver, setGameOver] = useState(savedGame?.gameOver ?? false);
  const [gameOverReason, setGameOverReason] = useState<ActiveGame["gameOverReason"]>(
    savedGame?.gameOverReason ?? null,
  );
  const [undoStack, setUndoStack] = useState<GameSnapshot[]>(savedGame?.undoStack ?? []);
  const [showHints, setShowHints] = useState(readStoredShowHints);
  const [syncHintsLockedOff, setSyncHintsLockedOff] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"rollUndo" | "exit" | "startOver" | null>(null);
  const [draggingPlayerId, setDraggingPlayerId] = useState<string | null>(null);
  const [rollAnimationKey, setRollAnimationKey] = useState(0);
  const draftNameInputRef = useRef<HTMLInputElement>(null);
  const hostTransportRef = useRef<SyncHostTransport | null>(null);
  const joinTransportRef = useRef<SyncJoinTransport | null>(null);
  const syncToastTimeoutRef = useRef(0);
  const pickerTopRef = useRef<HTMLDivElement>(null);
  const latestRef = useRef<LatestSyncState>({
    rows,
    penalties,
    turn,
    gamePlayers,
    currentPlayerIndex,
    syncTurnId,
    syncPhase,
    syncRole,
    syncReadyPayloads,
    syncHostPlayerId,
    selectedPlayerId,
    showHints,
    syncHintsLockedOff,
    gameScoreCardId,
    syncScoreCardId,
  });

  const scoreCard = getScoreCard(gameScoreCardId);
  const personalScoreCard = getScoreCard(scoreCardId);
  const syncHomeScoreCard = syncRole === "host" ? personalScoreCard : syncScoreCardId ? getScoreCard(syncScoreCardId) : null;
  const draftScoreCard = getScoreCard(draftScoreCardId);
  const draftVisibleScoreCards = getFilteredScoreCards(draftScoreCardFilters);
  const selectedPlayerExists = selectedPlayerId ? players.some((player) => player.id === selectedPlayerId) : false;
  const currentPlayer = gamePlayers[currentPlayerIndex] ?? null;
  const isUserTurn = Boolean(currentPlayer && currentPlayer.id === selectedPlayerId);
  const isSyncMode = mode === "sync";
  const isHost = isSyncMode && syncRole === "host";
  const localReadyPayload = selectedPlayerId
    ? syncReadyPayloads.find((payload) => payload.playerId === selectedPlayerId && payload.turnId === syncTurnId)
    : null;
  const isLocalReady = Boolean(localReadyPayload);
  const readyPlayerIds = syncReadyPayloads
    .filter((payload) => payload.turnId === syncTurnId)
    .map((payload) => payload.playerId);
  const whiteSum = getWhiteSum(turn, isUserTurn, mode);
  const diceStageDone = Boolean(whiteSum);
  const legalMarkRoles = useMemo(
    () => getLegalMarkRoleMap({ rows, turn, isUserTurn, mode, gameOver: gameOver || isLocalReady, scoreCard }),
    [rows, turn, isUserTurn, mode, gameOver, isLocalReady, scoreCard],
  );
  const legalMarkKeys = useMemo(() => new Set(legalMarkRoles.keys()), [legalMarkRoles]);
  const nextEnabled = canAdvanceTurn(scoreCard, turn, isUserTurn, gameOver);
  const readyEnabled = isSyncMode
    ? !gameOver &&
      syncPhase === "turn" &&
      !isLocalReady &&
      (isUserTurn ? canAdvanceTurn(scoreCard, turn, true, false) : Boolean(turn.roll))
    : false;
  const penaltyEnabled = canSelectPenalty(turn, isUserTurn, penalties, gameOver || isLocalReady);
  const totalScore = getTotalScore(scoreCard, rows, penalties, turn);
  const penaltyCount = getPenaltyCount(penalties, turn);
  const syncPenaltyLabel = `${formatNameList(orderedNamesForPlayerIds(gamePlayers, syncPenaltyPlayerIds))} reached 4 penalties`;
  const canStart =
    players.length > 0 &&
    players.every((player) => player.name.trim().length > 0) &&
    Boolean(selectedPlayerId && selectedPlayerExists);
  const canUndo =
    mode === "local"
      ? gameOverReason !== "opponentPenalties" && (turn.history.length > 0 || undoStack.length > 0)
      : syncPhase === "turn" && !isLocalReady && turn.history.length > 0;

  function syncLatestState(updates: Partial<LatestSyncState>) {
    latestRef.current = { ...latestRef.current, ...updates };
  }

  function applyPlayState(patch: PlayStatePatch) {
    const latestUpdates: Partial<LatestSyncState> = {};

    if ("rows" in patch && patch.rows) {
      latestUpdates.rows = patch.rows;
    }

    if ("penalties" in patch && typeof patch.penalties === "number") {
      latestUpdates.penalties = patch.penalties;
    }

    if ("turn" in patch && patch.turn) {
      latestUpdates.turn = patch.turn;
    }

    if ("gamePlayers" in patch && patch.gamePlayers) {
      latestUpdates.gamePlayers = patch.gamePlayers;
    }

    if ("currentPlayerIndex" in patch && typeof patch.currentPlayerIndex === "number") {
      latestUpdates.currentPlayerIndex = patch.currentPlayerIndex;
    }

    if ("syncTurnId" in patch && typeof patch.syncTurnId === "string") {
      latestUpdates.syncTurnId = patch.syncTurnId;
    }

    if ("syncReadyPayloads" in patch && patch.syncReadyPayloads) {
      latestUpdates.syncReadyPayloads = patch.syncReadyPayloads;
    }

    if ("syncPhase" in patch && patch.syncPhase) {
      latestUpdates.syncPhase = patch.syncPhase;
    }

    if ("selectedPlayerId" in patch) {
      latestUpdates.selectedPlayerId = patch.selectedPlayerId ?? null;
    }

    if ("showHints" in patch && typeof patch.showHints === "boolean") {
      latestUpdates.showHints = patch.showHints;
    }

    if ("syncHintsLockedOff" in patch && typeof patch.syncHintsLockedOff === "boolean") {
      latestUpdates.syncHintsLockedOff = patch.syncHintsLockedOff;
    }

    if ("gameScoreCardId" in patch && typeof patch.gameScoreCardId === "number") {
      latestUpdates.gameScoreCardId = patch.gameScoreCardId;
    }

    if ("syncScoreCardId" in patch) {
      latestUpdates.syncScoreCardId = patch.syncScoreCardId ?? null;
    }

    if (Object.keys(latestUpdates).length > 0) {
      syncLatestState(latestUpdates);
    }

    if ("rows" in patch && patch.rows) {
      setRows(patch.rows);
    }

    if ("penalties" in patch && typeof patch.penalties === "number") {
      setPenalties(patch.penalties);
    }

    if ("turn" in patch && patch.turn) {
      setTurn(patch.turn);
    }

    if ("gamePlayers" in patch && patch.gamePlayers) {
      setGamePlayers(patch.gamePlayers);
    }

    if ("currentPlayerIndex" in patch && typeof patch.currentPlayerIndex === "number") {
      setCurrentPlayerIndex(patch.currentPlayerIndex);
    }

    if ("gameOver" in patch && typeof patch.gameOver === "boolean") {
      setGameOver(patch.gameOver);
    }

    if ("gameOverReason" in patch) {
      setGameOverReason(patch.gameOverReason ?? null);
    }

    if ("undoStack" in patch && patch.undoStack) {
      setUndoStack(patch.undoStack);
    }

    if ("syncTurnId" in patch && typeof patch.syncTurnId === "string") {
      setSyncTurnId(patch.syncTurnId);
    }

    if ("syncReadyPayloads" in patch && patch.syncReadyPayloads) {
      setSyncReadyPayloads(patch.syncReadyPayloads);
    }

    if ("syncPhase" in patch && patch.syncPhase) {
      setSyncPhase(patch.syncPhase);
    }

    if ("selectedPlayerId" in patch) {
      setSelectedPlayerId(patch.selectedPlayerId ?? null);
    }

    if ("showHints" in patch && typeof patch.showHints === "boolean") {
      setShowHints(patch.showHints);
    }

    if ("syncHintsLockedOff" in patch && typeof patch.syncHintsLockedOff === "boolean") {
      setSyncHintsLockedOff(patch.syncHintsLockedOff);
    }

    if ("gameScoreCardId" in patch && typeof patch.gameScoreCardId === "number") {
      setGameScoreCardId(patch.gameScoreCardId);
    }

    if ("syncScoreCardId" in patch) {
      setSyncScoreCardId(patch.syncScoreCardId ?? null);
    }

    if ("rollAnimationKey" in patch && typeof patch.rollAnimationKey === "number") {
      setRollAnimationKey(patch.rollAnimationKey);
    }
  }

  function clearSyncToast() {
    window.clearTimeout(syncToastTimeoutRef.current);
    syncToastTimeoutRef.current = 0;
    setSyncToastMessage("");
  }

  function clearSyncAdvanceFeedback() {
    setSyncPenaltyPlayerIds([]);
    clearSyncToast();
  }

  function showSyncToast(message: string) {
    clearSyncToast();

    if (!message) {
      return;
    }

    setSyncToastMessage(message);
    syncToastTimeoutRef.current = window.setTimeout(() => {
      setSyncToastMessage("");
      syncToastTimeoutRef.current = 0;
    }, 4200);
  }

  function applySyncAdvanceFeedback(
    scoreCard: ScoreCardPreset,
    closedBy: SyncClosedBy[],
    penaltyPlayerIds: string[],
    playersForNames: Player[],
  ) {
    setSyncPenaltyPlayerIds(penaltyPlayerIds);
    showSyncToast(formatSyncAdvanceToast(scoreCard, closedBy, penaltyPlayerIds, playersForNames));
  }

  useEffect(() => {
    localStorage.setItem(PLAYERS_KEY, JSON.stringify(players));
  }, [players]);

  useEffect(() => {
    if (selectedPlayerId) {
      localStorage.setItem(SELECTED_PLAYER_KEY, selectedPlayerId);
    } else {
      localStorage.removeItem(SELECTED_PLAYER_KEY);
    }
  }, [selectedPlayerId]);

  useEffect(() => {
    localStorage.setItem(SHOW_HINTS_KEY, showHints ? "true" : "false");
  }, [showHints]);

  useEffect(() => {
    localStorage.setItem(SELECTED_SCORE_CARD_KEY, String(scoreCardId));
  }, [scoreCardId]);

  useEffect(() => {
    localStorage.setItem(SCORE_CARD_FILTERS_KEY, JSON.stringify(scoreCardFilters));
  }, [scoreCardFilters]);

  useEffect(() => {
    localStorage.setItem(SYNC_NAME_KEY, syncName);
  }, [syncName]);

  useEffect(() => {
    if (mode === "local" && selectedPlayerId && !players.some((player) => player.id === selectedPlayerId)) {
      setSelectedPlayerId(null);
    }
  }, [mode, players, selectedPlayerId]);

  useEffect(() => {
    if (mode !== "local" || page !== "play" || gamePlayers.length === 0 || !selectedPlayerId) {
      return;
    }

    const activeGame: ActiveGame = {
      mode: "local",
      page: "play",
      players: gamePlayers,
      selectedPlayerId,
      scoreCardId: gameScoreCardId,
      currentPlayerIndex,
      rows,
      penalties,
      turn,
      gameOver,
      gameOverReason,
      undoStack,
    };

    localStorage.setItem(ACTIVE_GAME_KEY, JSON.stringify(activeGame));
  }, [
    mode,
    page,
    gamePlayers,
    selectedPlayerId,
    gameScoreCardId,
    currentPlayerIndex,
    rows,
    penalties,
    turn,
    gameOver,
    gameOverReason,
    undoStack,
  ]);

  useLayoutEffect(() => {
    // WebRTC callbacks outlive React renders, so they read mutable game state here.
    latestRef.current = {
      rows,
      penalties,
      turn,
      gamePlayers,
      currentPlayerIndex,
      syncTurnId,
      syncPhase,
      syncRole,
      syncReadyPayloads,
      syncHostPlayerId,
      selectedPlayerId,
      showHints,
      syncHintsLockedOff,
      gameScoreCardId,
      syncScoreCardId,
    };
  }, [
    rows,
    penalties,
    turn,
    gamePlayers,
    currentPlayerIndex,
    syncTurnId,
    syncPhase,
    syncRole,
    syncReadyPayloads,
    syncHostPlayerId,
    selectedPlayerId,
    showHints,
    syncHintsLockedOff,
    gameScoreCardId,
    syncScoreCardId,
  ]);

  useEffect(() => () => {
    window.clearTimeout(syncToastTimeoutRef.current);
    hostTransportRef.current?.close();
    joinTransportRef.current?.close();
  }, []);

  useEffect(() => {
    if (!draggingPlayerId) {
      return undefined;
    }

    const activeDraggingPlayerId = draggingPlayerId;

    function handlePointerMove(event: PointerEvent) {
      const row = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-player-id]");
      const overPlayerId = row?.dataset.playerId;

      if (overPlayerId && overPlayerId !== activeDraggingPlayerId) {
        reorderPlayer(activeDraggingPlayerId, overPlayerId);
      }
    }

    function handlePointerUp() {
      setDraggingPlayerId(null);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [draggingPlayerId, players]);

  function addPlayer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const name = draftName.trim();
    if (!name) {
      return;
    }

    const player = { id: createId(), name };

    setPlayers((currentPlayers) => [...currentPlayers, player]);
    setSelectedPlayerId((currentSelectedId) => currentSelectedId ?? player.id);
    setDraftName("");
    draftNameInputRef.current?.focus();
  }

  function updatePlayer(playerId: string, updates: Partial<Player>) {
    setPlayers((currentPlayers) =>
      currentPlayers.map((player) => (player.id === playerId ? { ...player, ...updates } : player)),
    );
  }

  function removePlayer(playerId: string) {
    setPlayers((currentPlayers) => currentPlayers.filter((player) => player.id !== playerId));
    setSelectedPlayerId((currentSelectedId) => (currentSelectedId === playerId ? null : currentSelectedId));
  }

  function reorderPlayer(playerId: string, overPlayerId: string) {
    setPlayers((currentPlayers) => {
      const fromIndex = currentPlayers.findIndex((player) => player.id === playerId);
      const toIndex = currentPlayers.findIndex((player) => player.id === overPlayerId);

      if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
        return currentPlayers;
      }

      return moveItem(currentPlayers, fromIndex, toIndex);
    });
  }

  function beginDrag(event: ReactPointerEvent<HTMLButtonElement>, playerId: string) {
    event.preventDefault();
    setDraggingPlayerId(playerId);
  }

  function startGame(nextPlayers: Player[], nextSelectedPlayerId: string, nextScoreCardId = scoreCardId) {
    const orderedPlayers = nextPlayers
      .map((player) => ({ ...player, name: player.name.trim() }))
      .filter((player) => player.name.length > 0);

    if (orderedPlayers.length === 0 || !orderedPlayers.some((player) => player.id === nextSelectedPlayerId)) {
      return;
    }

    const game = createFreshGame(orderedPlayers, nextSelectedPlayerId, nextScoreCardId);

    hostTransportRef.current?.close();
    joinTransportRef.current?.close();
    localStorage.removeItem(ACTIVE_GAME_KEY);
    clearSyncAdvanceFeedback();
    syncLatestState({
      syncRole: null,
      syncHostPlayerId: null,
      syncHintsLockedOff: false,
      syncScoreCardId: null,
    });
    setMode("local");
    setSyncRole(null);
    setSyncHintsLockedOff(false);
    setSyncScoreCardId(null);
    setSyncQrText("");
    setSyncAnswerText("");
    setSyncCameraMode(null);
    setSyncMessage("");
    setPlayers(orderedPlayers);
    setPage("play");
    applyPlayState({
      rows: game.rows,
      penalties: game.penalties,
      turn: game.turn,
      gamePlayers: game.players,
      currentPlayerIndex: game.currentPlayerIndex,
      gameOver: game.gameOver,
      gameOverReason: game.gameOverReason,
      undoStack: game.undoStack,
      syncReadyPayloads: [],
      syncPhase: "idle",
      syncHintsLockedOff: false,
      syncScoreCardId: null,
      gameScoreCardId: game.scoreCardId,
      selectedPlayerId: nextSelectedPlayerId,
      rollAnimationKey: 0,
    });
  }

  function resetPlayState(nextPlayers: Player[], nextSelectedPlayerId: string, nextScoreCardId = scoreCardId) {
    const nextRows = createEmptyRows();
    const nextTurn = createEmptyTurn();

    applyPlayState({
      rows: nextRows,
      penalties: 0,
      turn: nextTurn,
      gamePlayers: nextPlayers,
      currentPlayerIndex: 0,
      selectedPlayerId: nextSelectedPlayerId,
      gameScoreCardId: nextScoreCardId,
      gameOver: false,
      gameOverReason: null,
      undoStack: [],
      rollAnimationKey: 0,
    });
    clearSyncAdvanceFeedback();
  }

  function resetSyncRuntime() {
    hostTransportRef.current?.close();
    joinTransportRef.current?.close();
    hostTransportRef.current = null;
    joinTransportRef.current = null;
    syncLatestState({
      syncRole: null,
      syncPhase: "idle",
      syncHostPlayerId: null,
      syncReadyPayloads: [],
      syncHintsLockedOff: false,
      syncScoreCardId: null,
    });
    setSyncRole(null);
    setSyncPhase("idle");
    setSyncHostPlayerId(null);
    setSyncReadyPayloads([]);
    setSyncHintsLockedOff(false);
    setSyncScoreCardId(null);
    setSyncQrText("");
    setSyncAnswerText("");
    setSyncCameraMode(null);
    setSyncMessage("");
    setIsAcceptingAnswer(false);
    clearSyncAdvanceFeedback();
  }

  function beginHostSync() {
    const name = syncName.trim();

    if (!name) {
      return;
    }

    const hostPlayer = { id: createId(), name };
    const roomId = createId();
    const turnId = nextTurnId();
    const hostTransport = new SyncHostTransport({
      callbacks: {
        onMessage: handleHostMessage,
        onPeerClosed: handleHostPeerClosed,
      },
      hostName: hostPlayer.name,
      hostPlayerId: hostPlayer.id,
      roomId,
    });

    hostTransportRef.current = hostTransport;
    joinTransportRef.current?.close();
    joinTransportRef.current = null;
    localStorage.removeItem(ACTIVE_GAME_KEY);
    setMode("sync");
    setSyncRole("host");
    setSyncPhase("hostLobby");
    setSyncHostPlayerId(hostPlayer.id);
    setSyncTurnId(turnId);
    setSyncReadyPayloads([]);
    syncLatestState({
      syncRole: "host",
      syncPhase: "hostLobby",
      syncHostPlayerId: hostPlayer.id,
      syncTurnId: turnId,
      syncReadyPayloads: [],
      syncHintsLockedOff: false,
      syncScoreCardId: scoreCardId,
      gameScoreCardId: scoreCardId,
    });
    setSyncScoreCardId(scoreCardId);
    resetPlayState([hostPlayer], hostPlayer.id, scoreCardId);
    void createHostOffer();
  }

  async function createHostOffer(finalMessage = "") {
    const hostTransport = hostTransportRef.current;

    if (!hostTransport) {
      return;
    }

    setSyncMessage("Creating QR");
    try {
      setSyncQrText(await hostTransport.createOffer());
      setSyncMessage(finalMessage);
    } catch (error) {
      setSyncMessage(error instanceof Error ? error.message : "Could not create QR");
    }
  }

  function formatQrHandshakeError(error: unknown) {
    const message = error instanceof Error ? error.message : "the handshake failed.";

    if (message.startsWith("this ")) {
      return `QR found, but ${message}`;
    }

    return `QR found, but the handshake failed. ${message}`;
  }

  async function acceptJoinAnswer(value: string) {
    const hostTransport = hostTransportRef.current;

    if (!hostTransport || syncRole !== "host" || isAcceptingAnswer) {
      return;
    }

    setSyncCameraMode(null);
    setIsAcceptingAnswer(true);
    setSyncMessage("QR found. Accepting answer");
    try {
      const joinedPlayer = await hostTransport.acceptAnswer(value);
      const currentPlayers = latestRef.current.gamePlayers;

      if (!currentPlayers.some((player) => player.id === joinedPlayer.id)) {
        const nextPlayers = [...currentPlayers, joinedPlayer];

        syncLatestState({ gamePlayers: nextPlayers });
        setGamePlayers(nextPlayers);
        broadcastLobbyState(nextPlayers);
      }

      await createHostOffer(`${joinedPlayer.name} joined`);
    } catch (error) {
      const message = formatQrHandshakeError(error);

      setSyncMessage(message);
      await createHostOffer(message);
    } finally {
      setIsAcceptingAnswer(false);
    }
  }

  async function scanHostOffer(value: string) {
    const name = syncName.trim();

    if (!name) {
      setSyncMessage("Enter your name first");
      return;
    }

    const localPlayer = { id: createId(), name };
    const joinTransport = new SyncJoinTransport({
      onClosed: () => endSyncSession("Host disconnected"),
      onMessage: handleJoinerMessage,
      onOpen: () => setSyncMessage("Connected"),
    });

    setSyncCameraMode(null);
    setSyncMessage("QR found. Creating answer");
    try {
      const answer = await joinTransport.createAnswer(value, localPlayer);
      hostTransportRef.current?.close();
      hostTransportRef.current = null;
      joinTransportRef.current = joinTransport;
      localStorage.removeItem(ACTIVE_GAME_KEY);
      const turnId = nextTurnId();

      setMode("sync");
      setSyncRole("joiner");
      setSyncPhase("showAnswer");
      setSyncHostPlayerId(answer.hostPlayerId);
      setSyncAnswerText(answer.answerText);
      setSyncTurnId(turnId);
      setSyncReadyPayloads([]);
      syncLatestState({
        syncRole: "joiner",
        syncPhase: "showAnswer",
        syncHostPlayerId: answer.hostPlayerId,
        syncTurnId: turnId,
        syncReadyPayloads: [],
        syncHintsLockedOff: false,
      });
      resetPlayState(
        [
          { id: answer.hostPlayerId, name: answer.hostName },
          localPlayer,
        ],
        localPlayer.id,
      );
      setSyncMessage("Answer ready");
    } catch (error) {
      joinTransport.close();
      setSyncMessage(formatQrHandshakeError(error));
    }
  }

  function broadcastLobbyState(nextPlayers = latestRef.current.gamePlayers) {
    hostTransportRef.current?.broadcast({
      type: "lobbyState",
      players: nextPlayers,
      hostPlayerId: latestRef.current.syncHostPlayerId,
      scoreCardId: latestRef.current.syncScoreCardId ?? scoreCardId,
    });
  }

  function handleHostMessage(playerId: string, message: SyncWireMessage) {
    if (message.type === "join") {
      broadcastLobbyState();
      return;
    }

    if (message.type === "rollRequest") {
      handleSyncRollRequest(playerId, message);
      return;
    }

    if (message.type === "ready") {
      handleSyncReadyMessage(message.payload);
      return;
    }

    if (message.type === "exit") {
      removeSyncPlayer(playerId);
    }
  }

  function handleJoinerMessage(_playerId: string, message: SyncWireMessage) {
    if (message.type === "lobbyState") {
      const nextPlayers = normalizePlayers(message.players);
      const hostId = typeof message.hostPlayerId === "string" ? message.hostPlayerId : latestRef.current.syncHostPlayerId;
      const nextScoreCardId = normalizeScoreCardId(
        message.scoreCardId,
        latestRef.current.syncScoreCardId ?? DEFAULT_SCORE_CARD_ID,
      );

      if (nextPlayers.length > 0) {
        syncLatestState({ gamePlayers: nextPlayers });
        setGamePlayers(nextPlayers);
      }

      syncLatestState({ syncHostPlayerId: hostId, syncPhase: "lobby", syncScoreCardId: nextScoreCardId });
      setSyncHostPlayerId(hostId);
      setSyncPhase("lobby");
      setSyncScoreCardId(nextScoreCardId);
      setMode("sync");
      setPage("home");
      setHomeTab("sync");
      setSyncAnswerText("");
      return;
    }

    if (message.type === "gameStart") {
      const nextPlayers = normalizePlayers(message.players);
      const turnId = typeof message.turnId === "string" ? message.turnId : nextTurnId();
      const nextHintsLockedOff = message.hintsLockedOff === true;
      const nextScoreCardId = normalizeScoreCardId(
        message.scoreCardId,
        latestRef.current.syncScoreCardId ?? DEFAULT_SCORE_CARD_ID,
      );

      if (nextPlayers.length === 0) {
        return;
      }

      startSyncedPlay(nextPlayers, turnId, nextHintsLockedOff, nextScoreCardId);
      return;
    }

    if (message.type === "rollResult") {
      const roll = normalizeRoll(message.roll);

      if (!roll || message.turnId !== latestRef.current.syncTurnId) {
        return;
      }

      const nextTurn = { ...createEmptyTurn(), roll, history: latestRef.current.turn.history };

      syncLatestState({ turn: nextTurn });
      setTurn(nextTurn);
      setRollAnimationKey((key) => key + 1);
      return;
    }

    if (message.type === "readyStatus") {
      const payloads = Array.isArray(message.payloads)
        ? message.payloads.map(normalizeReadyPayload).filter((payload): payload is SyncReadyPayload => Boolean(payload))
        : [];

      syncLatestState({ syncReadyPayloads: payloads, syncPhase: "turn" });
      setSyncReadyPayloads(payloads);
      setSyncPhase("turn");
      return;
    }

    if (message.type === "hintsLockChanged") {
      if (typeof message.locked === "boolean") {
        applySyncHintsLock(message.locked);
      }
      return;
    }

    if (message.type === "advanceResult") {
      applySyncAdvanceResult(message);
      return;
    }

    if (message.type === "playerRemoved") {
      const playerId = typeof message.playerId === "string" ? message.playerId : "";

      if (playerId === latestRef.current.selectedPlayerId) {
        endSyncSession("Removed");
        return;
      }

      const nextPlayers = normalizePlayers(message.players);
      if (nextPlayers.length > 0) {
        syncLatestState({ gamePlayers: nextPlayers });
        setGamePlayers(nextPlayers);
      }

      if (message.discardTurn === true) {
        discardSyncTurn(typeof message.turnId === "string" ? message.turnId : nextTurnId(), Number(message.currentPlayerIndex) || 0);
      }
      return;
    }

    if (message.type === "hostStartOver") {
      const nextPlayers = normalizePlayers(message.players);
      const nextHintsLockedOff = message.hintsLockedOff === true;
      const nextScoreCardId = normalizeScoreCardId(
        message.scoreCardId,
        latestRef.current.syncScoreCardId ?? DEFAULT_SCORE_CARD_ID,
      );

      returnSyncToLobby(
        nextPlayers.length > 0 ? nextPlayers : latestRef.current.gamePlayers,
        "lobby",
        nextHintsLockedOff,
        nextScoreCardId,
      );
      return;
    }

    if (message.type === "sessionEnded") {
      endSyncSession("Ended");
    }
  }

  function handleHostPeerClosed(playerId: string) {
    if (latestRef.current.syncRole !== "host") {
      return;
    }

    removeSyncPlayer(playerId);
  }

  function startSyncedPlay(
    nextPlayers: Player[],
    turnId: string,
    nextHintsLockedOff = syncHintsLockedOff,
    nextScoreCardId = latestRef.current.syncScoreCardId ?? scoreCardId,
  ) {
    const nextRows = createEmptyRows();
    const nextTurn = createEmptyTurn();
    const nextShowHints = nextHintsLockedOff ? false : latestRef.current.showHints;

    clearSyncAdvanceFeedback();
    applyPlayState({
      rows: nextRows,
      penalties: 0,
      turn: nextTurn,
      gamePlayers: nextPlayers,
      currentPlayerIndex: 0,
      gameOver: false,
      gameOverReason: null,
      undoStack: [],
      syncTurnId: turnId,
      syncPhase: "turn",
      syncReadyPayloads: [],
      showHints: nextShowHints,
      syncHintsLockedOff: nextHintsLockedOff,
      syncScoreCardId: nextScoreCardId,
      gameScoreCardId: nextScoreCardId,
      rollAnimationKey: 0,
    });
    setMode("sync");
    setPage("play");
  }

  function returnSyncToLobby(
    nextPlayers: Player[],
    nextPhase: "hostLobby" | "lobby",
    nextHintsLockedOff = syncHintsLockedOff,
    nextScoreCardId = latestRef.current.syncScoreCardId ?? scoreCardId,
  ) {
    const nextRows = createEmptyRows();
    const nextTurn = createEmptyTurn();

    clearSyncAdvanceFeedback();
    applyPlayState({
      rows: nextRows,
      penalties: 0,
      turn: nextTurn,
      gamePlayers: nextPlayers,
      currentPlayerIndex: 0,
      gameOver: false,
      gameOverReason: null,
      undoStack: [],
      syncTurnId: nextTurnId(),
      syncPhase: nextPhase,
      syncReadyPayloads: [],
      syncHintsLockedOff: nextHintsLockedOff,
      syncScoreCardId: nextScoreCardId,
      gameScoreCardId: nextScoreCardId,
      rollAnimationKey: 0,
    });
    setMode("sync");
    setPage("home");
    setHomeTab("sync");
    setSyncCameraMode(null);
    setSyncMessage("");

    if (nextPhase === "lobby") {
      setSyncAnswerText("");
    }
  }

  function startSyncGame() {
    if (!isHost || gamePlayers.length === 0 || isAcceptingAnswer) {
      return;
    }

    const turnId = nextTurnId();
    const nextScoreCardId = syncScoreCardId ?? scoreCardId;

    startSyncedPlay(gamePlayers, turnId, syncHintsLockedOff, nextScoreCardId);
    hostTransportRef.current?.broadcast({
      type: "gameStart",
      players: gamePlayers,
      hintsLockedOff: syncHintsLockedOff,
      scoreCardId: nextScoreCardId,
      turnId,
    });
  }

  function handleSyncRollRequest(playerId: string, message: SyncWireMessage) {
    const latest = latestRef.current;
    const currentPlayer = latest.gamePlayers[latest.currentPlayerIndex];

    if (
      latest.syncPhase !== "turn" ||
      !currentPlayer ||
      currentPlayer.id !== playerId ||
      message.turnId !== latest.syncTurnId ||
      latest.turn.roll
    ) {
      return;
    }

    const roll = rollDice(latest.rows, getScoreCard(latest.gameScoreCardId));
    const nextTurn = { ...latest.turn, roll };

    syncLatestState({ turn: nextTurn });
    setTurn(nextTurn);
    setRollAnimationKey((key) => key + 1);
    hostTransportRef.current?.broadcast({
      type: "rollResult",
      turnId: latest.syncTurnId,
      roll,
    });
  }

  function rollSyncDice() {
    if (!isSyncMode || !isUserTurn || gameOver || turn.roll || syncPhase !== "turn") {
      return;
    }

    if (isHost) {
      handleSyncRollRequest(selectedPlayerId ?? "", { type: "rollRequest", turnId: syncTurnId });
      return;
    }

    joinTransportRef.current?.send({
      type: "rollRequest",
      playerId: selectedPlayerId,
      turnId: syncTurnId,
    });
  }

  function setHostReadyPayloads(nextPayloads: SyncReadyPayload[]) {
    const latest = latestRef.current;
    const currentPlayers = latest.gamePlayers;
    const activePayloads = nextPayloads.filter((payload) =>
      payload.turnId === latest.syncTurnId && currentPlayers.some((player) => player.id === payload.playerId),
    );
    const allReady =
      currentPlayers.length > 0 &&
      currentPlayers.every((player) =>
        activePayloads.some((payload) => payload.playerId === player.id && payload.turnId === latest.syncTurnId),
      );

    // The last Ready payload finalizes the turn immediately; there is no between-turn phase.
    if (allReady) {
      commitSyncReadyPayloads(activePayloads);
      return;
    }

    syncLatestState({ syncReadyPayloads: activePayloads, syncPhase: "turn" });
    setSyncReadyPayloads(activePayloads);
    setSyncPhase("turn");
    hostTransportRef.current?.broadcast({
      type: "readyStatus",
      phase: "turn",
      payloads: activePayloads,
    });
  }

  function handleSyncReadyMessage(value: unknown) {
    const payload = normalizeReadyPayload(value);

    if (!payload || payload.turnId !== latestRef.current.syncTurnId) {
      return;
    }

    setHostReadyPayloads([
      ...latestRef.current.syncReadyPayloads.filter((currentPayload) => currentPayload.playerId !== payload.playerId),
      payload,
    ]);
  }

  function readySyncTurn() {
    if (!readyEnabled || !selectedPlayerId) {
      return;
    }

    const payload = createReadyPayload(scoreCard, syncTurnId, selectedPlayerId, penalties, turn);

    if (isHost) {
      setHostReadyPayloads([
        ...latestRef.current.syncReadyPayloads.filter((currentPayload) => currentPayload.playerId !== selectedPlayerId),
        payload,
      ]);
      return;
    }

    const nextPayloads = [
      ...latestRef.current.syncReadyPayloads.filter((currentPayload) => currentPayload.playerId !== selectedPlayerId),
      payload,
    ];

    syncLatestState({ syncReadyPayloads: nextPayloads });
    setSyncReadyPayloads(nextPayloads);
    joinTransportRef.current?.send({
      type: "ready",
      payload,
    });
  }

  function applySyncAdvanceResult(message: SyncWireMessage) {
    const latest = latestRef.current;

    if (message.turnId !== latest.syncTurnId) {
      return;
    }

    const closedBy = normalizeClosedBy(message.closedBy);
    const legacyClosedRows = Array.isArray(message.closedRows) ? uniqueRows(message.closedRows.filter(isRowColor)) : [];
    const closedRows = closedBy.length > 0 ? uniqueRows(closedBy.map((entry) => entry.row)) : legacyClosedRows;
    const penaltyPlayerIds = normalizePlayerIds(message.penaltyPlayerIds);
    const nextPlayers = normalizePlayers(message.players);
    const nextIndex = Number(message.currentPlayerIndex);
    const nextTurn = typeof message.nextTurnId === "string" ? message.nextTurnId : nextTurnId();
    const nextGameOver = message.gameOver === true;
    const nextReason = normalizeGameOverReason(message.gameOverReason);
    const latestScoreCard = getScoreCard(latest.gameScoreCardId);
    const committed = commitLocalTurnState(latestScoreCard, latest.rows, latest.penalties, latest.turn);
    const withGlobalClosures = applyGlobalClosedRows(committed.rows, closedRows);
    const localReason = committed.penalties >= MAX_PENALTIES ? "ownPenalties" : nextReason;
    const nextGamePlayers = nextPlayers.length > 0 ? nextPlayers : latest.gamePlayers;
    const nextCurrentPlayerIndex = Number.isInteger(nextIndex) ? nextIndex : 0;
    const nextEmptyTurn = createEmptyTurn();

    applyPlayState({
      rows: withGlobalClosures,
      penalties: committed.penalties,
      turn: nextEmptyTurn,
      gamePlayers: nextGamePlayers,
      currentPlayerIndex: nextCurrentPlayerIndex,
      gameOver: nextGameOver,
      gameOverReason: localReason,
      syncTurnId: nextTurn,
      syncReadyPayloads: [],
      syncPhase: nextGameOver ? "gameOver" : "turn",
      rollAnimationKey: 0,
    });
    applySyncAdvanceFeedback(latestScoreCard, closedBy, penaltyPlayerIds, nextGamePlayers);
  }

  function commitSyncReadyPayloads(activePayloads: SyncReadyPayload[]) {
    const latest = latestRef.current;
    const closedBy = createClosedBy(activePayloads);
    const closedRows = uniqueRows(closedBy.map((entry) => entry.row));
    const penaltyPlayerIds = getPenaltyPlayerIds(activePayloads);
    const latestScoreCard = getScoreCard(latest.gameScoreCardId);
    const committed = commitLocalTurnState(latestScoreCard, latest.rows, latest.penalties, latest.turn);
    const withGlobalClosures = applyGlobalClosedRows(committed.rows, closedRows);
    const anyPenaltyGameOver = penaltyPlayerIds.length > 0;
    const rowPenaltyState = getGameOverFromRowsAndPenalties(
      withGlobalClosures,
      committed.penalties,
      anyPenaltyGameOver ? "opponentPenalties" : null,
    );
    const nextGameOver = rowPenaltyState.gameOver;
    const nextReason = rowPenaltyState.gameOverReason;
    const nextIndex = nextGameOver ? latest.currentPlayerIndex : (latest.currentPlayerIndex + 1) % latest.gamePlayers.length;
    const nextTurn = nextTurnId();
    const nextEmptyTurn = createEmptyTurn();

    applyPlayState({
      rows: withGlobalClosures,
      penalties: committed.penalties,
      turn: nextEmptyTurn,
      currentPlayerIndex: nextIndex,
      gameOver: nextGameOver,
      gameOverReason: nextReason,
      syncTurnId: nextTurn,
      syncReadyPayloads: [],
      syncPhase: nextGameOver ? "gameOver" : "turn",
      rollAnimationKey: 0,
    });
    applySyncAdvanceFeedback(latestScoreCard, closedBy, penaltyPlayerIds, latest.gamePlayers);
    hostTransportRef.current?.broadcast({
      type: "advanceResult",
      closedBy,
      closedRows,
      currentPlayerIndex: nextIndex,
      gameOver: nextGameOver,
      gameOverReason: nextReason,
      nextTurnId: nextTurn,
      penaltyPlayerIds,
      players: latest.gamePlayers,
      turnId: latest.syncTurnId,
    });
  }

  function discardSyncTurn(turnId: string, nextIndex: number) {
    const nextTurn = createEmptyTurn();

    applyPlayState({
      currentPlayerIndex: nextIndex,
      turn: nextTurn,
      syncTurnId: turnId,
      syncReadyPayloads: [],
      syncPhase: "turn",
      rollAnimationKey: 0,
    });
    clearSyncAdvanceFeedback();
  }

  function removeSyncPlayer(playerId: string) {
    const latest = latestRef.current;

    if (latest.syncRole !== "host" || !playerId) {
      return;
    }

    const currentPlayers = latest.gamePlayers;
    const removedIndex = currentPlayers.findIndex((player) => player.id === playerId);

    if (removedIndex < 0) {
      return;
    }

    const currentPlayer = currentPlayers[latest.currentPlayerIndex];
    const nextPlayers = currentPlayers.filter((player) => player.id !== playerId);

    if (nextPlayers.length === 0) {
      hostTransportRef.current?.removePeer(playerId);
      endSyncSession("Ended");
      hostTransportRef.current?.broadcast({ type: "sessionEnded" });
      return;
    }

    const currentPlayerRemoved = currentPlayer?.id === playerId;
    const nextIndex = currentPlayerRemoved
      ? latest.currentPlayerIndex % nextPlayers.length
      : Math.max(0, latest.currentPlayerIndex - (removedIndex < latest.currentPlayerIndex ? 1 : 0));
    const nextTurn = currentPlayerRemoved ? nextTurnId() : latest.syncTurnId;

    hostTransportRef.current?.removePeer(playerId);
    applyPlayState({
      gamePlayers: nextPlayers,
      currentPlayerIndex: nextIndex,
    });

    if (currentPlayerRemoved) {
      discardSyncTurn(nextTurn, nextIndex);
    } else {
      setHostReadyPayloads(latestRef.current.syncReadyPayloads.filter((payload) => payload.playerId !== playerId));
    }

    hostTransportRef.current?.broadcast({
      type: "playerRemoved",
      currentPlayerIndex: nextIndex,
      discardTurn: currentPlayerRemoved,
      playerId,
      players: nextPlayers,
      turnId: nextTurn,
    });
  }

  function endSyncSession(message: string) {
    const nextRows = createEmptyRows();
    const nextTurn = createEmptyTurn();

    resetSyncRuntime();
    localStorage.removeItem(ACTIVE_GAME_KEY);
    applyPlayState({
      rows: nextRows,
      penalties: 0,
      turn: nextTurn,
      gamePlayers: [],
      currentPlayerIndex: 0,
      syncReadyPayloads: [],
      syncPhase: "idle",
      gameOver: false,
      gameOverReason: null,
      undoStack: [],
      syncScoreCardId: null,
      gameScoreCardId: scoreCardId,
    });
    setMode("sync");
    setPage("home");
    setHomeTab("sync");
    setSyncMessage(message);
  }

  function startOver() {
    if (!selectedPlayerId || gamePlayers.length === 0 || (mode === "sync" && !isHost)) {
      return;
    }

    setConfirmAction("startOver");
  }

  function toggleShowHints() {
    if (mode === "sync" && syncHintsLockedOff) {
      return;
    }

    applyPlayState({ showHints: !showHints });
  }

  function applySyncHintsLock(locked: boolean) {
    applyPlayState({
      showHints: false,
      syncHintsLockedOff: locked,
    });
  }

  function toggleSyncHintsLock() {
    if (!isHost) {
      return;
    }

    const nextLocked = !syncHintsLockedOff;

    applySyncHintsLock(nextLocked);
    hostTransportRef.current?.broadcast({
      type: "hintsLockChanged",
      locked: nextLocked,
    });
  }

  function openScoreCardPicker(context: "local" | "syncHost") {
    const committedId = context === "syncHost" ? syncScoreCardId ?? scoreCardId : scoreCardId;
    const nextFilters = cloneScoreCardFilters(scoreCardFilters);

    setPickerContext(context);
    setDraftScoreCardFilters(nextFilters);
    setDraftScoreCardId(ensureFilteredScoreCardId(committedId, nextFilters));
    setPage("picker");
  }

  function closeScoreCardPicker() {
    setPage("home");
    setHomeTab(pickerContext === "syncHost" ? "sync" : "local");
    setPickerContext(null);
  }

  function confirmScoreCardPicker() {
    const nextFilters = cloneScoreCardFilters(draftScoreCardFilters);
    const nextScoreCardId = ensureFilteredScoreCardId(draftScoreCardId, nextFilters);

    setScoreCardId(nextScoreCardId);
    setScoreCardFilters(nextFilters);

    if (pickerContext === "syncHost") {
      setSyncScoreCardId(nextScoreCardId);
      syncLatestState({ syncScoreCardId: nextScoreCardId, gameScoreCardId: nextScoreCardId });
      broadcastLobbyState();
    }

    setPage("home");
    setHomeTab(pickerContext === "syncHost" ? "sync" : "local");
    setPickerContext(null);
  }

  function scrollPickerTop() {
    window.requestAnimationFrame(() => {
      pickerTopRef.current?.scrollIntoView({ block: "start" });
    });
  }

  function selectDraftScoreCard(nextScoreCardId: number) {
    setDraftScoreCardId(nextScoreCardId);
    scrollPickerTop();
  }

  function randomizeDraftScoreCard() {
    const cards = getFilteredScoreCards(draftScoreCardFilters);
    const card = cards[Math.floor(Math.random() * cards.length)];

    if (card) {
      selectDraftScoreCard(card.id);
    }
  }

  function toggleDraftScoreCardFilter(type: ScoreCardType) {
    const checkedCount = SCORE_CARD_TYPES.filter((candidate) => draftScoreCardFilters[candidate]).length;

    if (draftScoreCardFilters[type] && checkedCount === 1) {
      return;
    }

    const nextFilters = {
      ...draftScoreCardFilters,
      [type]: !draftScoreCardFilters[type],
    };
    const safeFilters = hasAnyScoreCardFilter(nextFilters) ? nextFilters : cloneScoreCardFilters(DEFAULT_SCORE_CARD_FILTERS);
    const nextScoreCardId = filtersIncludeScoreCard(safeFilters, draftScoreCardId)
      ? draftScoreCardId
      : firstFilteredScoreCardId(safeFilters);

    setDraftScoreCardFilters(safeFilters);
    setDraftScoreCardId(nextScoreCardId);
  }

  function confirmStartOver() {
    if (!selectedPlayerId || gamePlayers.length === 0) {
      return;
    }

    setConfirmAction(null);

    if (mode === "sync" && isHost) {
      const nextScoreCardId = syncScoreCardId ?? scoreCardId;

      returnSyncToLobby(gamePlayers, "hostLobby", syncHintsLockedOff, nextScoreCardId);
      hostTransportRef.current?.broadcast({
        type: "hostStartOver",
        hintsLockedOff: syncHintsLockedOff,
        players: gamePlayers,
        scoreCardId: nextScoreCardId,
      });
      return;
    }

    startGame(gamePlayers, selectedPlayerId, gameScoreCardId);
  }

  function exitToHome() {
    setConfirmAction("exit");
  }

  function confirmExitToHome() {
    if (mode === "sync") {
      if (isHost) {
        hostTransportRef.current?.broadcast({ type: "sessionEnded" });
      } else {
        joinTransportRef.current?.send({ type: "exit", playerId: selectedPlayerId });
      }

      resetSyncRuntime();
    }

    localStorage.removeItem(ACTIVE_GAME_KEY);
    setConfirmAction(null);
    setPage("home");
    setMode("local");
    const nextRows = createEmptyRows();
    const nextTurn = createEmptyTurn();

    applyPlayState({
      rows: nextRows,
      penalties: 0,
      turn: nextTurn,
      gamePlayers: [],
      currentPlayerIndex: 0,
      gameOver: false,
      gameOverReason: null,
      undoStack: [],
      syncHintsLockedOff: false,
      syncScoreCardId: null,
      gameScoreCardId: scoreCardId,
      rollAnimationKey: 0,
    });
  }

  function handleRollDice() {
    if (mode === "sync") {
      rollSyncDice();
      return;
    }

    if (!isUserTurn || gameOver || turn.roll) {
      return;
    }

    setTurn((currentTurn) => {
      if (currentTurn.roll) {
        return currentTurn;
      }

      return withUndoHistory(currentTurn, {
        roll: rollDice(rows, scoreCard),
        opponentWhiteSum: null,
        selectedMarks: [],
        penalty: false,
        opponentLocks: [],
      }, "roll");
    });
    setRollAnimationKey((key) => key + 1);
  }

  function selectOpponentWhiteSum(sum: number) {
    if (mode === "sync") {
      return;
    }

    if (isUserTurn || gameOver || turn.opponentWhiteSum !== null || !SUM_NUMBERS.includes(sum as 2)) {
      return;
    }

    setTurn((currentTurn) => {
      if (currentTurn.opponentWhiteSum !== null) {
        return currentTurn;
      }

      return withUndoHistory(currentTurn, {
        roll: null,
        opponentWhiteSum: sum,
        selectedMarks: [],
        penalty: false,
        opponentLocks: [],
      }, "whiteSum");
    });
  }

  function selectMark(mark: ScoreMark) {
    if (isLocalReady) {
      return;
    }

    if (!legalMarkKeys.has(markKey(mark))) {
      return;
    }

    setTurn((currentTurn) => {
      const currentLegalMarks = getLegalMarkRoleMap({
        rows,
        turn: currentTurn,
        isUserTurn,
        mode,
        gameOver: gameOver || isLocalReady,
        scoreCard,
      });

      if (!currentLegalMarks.has(markKey(mark))) {
        return currentTurn;
      }

      return withUndoHistory(currentTurn, {
        roll: currentTurn.roll,
        opponentWhiteSum: currentTurn.opponentWhiteSum,
        selectedMarks: [...currentTurn.selectedMarks, mark],
        penalty: currentTurn.penalty,
        opponentLocks: currentTurn.opponentLocks,
      }, "mark");
    });
  }

  function selectPenalty() {
    if (!penaltyEnabled) {
      return;
    }

    setTurn((currentTurn) => {
      if (!canSelectPenalty(currentTurn, isUserTurn, penalties, gameOver)) {
        return currentTurn;
      }

      return withUndoHistory(currentTurn, {
        roll: currentTurn.roll,
        opponentWhiteSum: currentTurn.opponentWhiteSum,
        penalty: true,
        selectedMarks: [],
        opponentLocks: currentTurn.opponentLocks,
      }, "penalty");
    });
  }

  function stageOpponentLock(row: RowColor) {
    if (mode === "sync") {
      return;
    }

    if (!canStageOpponentLock(scoreCard, row, rows, turn, diceStageDone, gameOver)) {
      return;
    }

    setTurn((currentTurn) => {
      if (!canStageOpponentLock(scoreCard, row, rows, currentTurn, Boolean(getWhiteSum(currentTurn, isUserTurn, mode)), gameOver)) {
        return currentTurn;
      }

      return withUndoHistory(currentTurn, {
        roll: currentTurn.roll,
        opponentWhiteSum: currentTurn.opponentWhiteSum,
        selectedMarks: currentTurn.selectedMarks,
        penalty: currentTurn.penalty,
        opponentLocks: uniqueRows([...currentTurn.opponentLocks, row]),
      }, "opponentLock");
    });
  }

  function undoTurn() {
    if (!canUndo) {
      return;
    }

    const latestEntry = turn.history.at(-1);

    if (!latestEntry) {
      if (mode === "local") {
        undoCommittedTurn();
      }
      return;
    }

    if (latestEntry?.kind === "roll" && mode === "local") {
      setConfirmAction("rollUndo");
      return;
    }

    performUndo();
  }

  function performUndo() {
    setTurn((currentTurn) => {
      const latestEntry = currentTurn.history.at(-1);
      return latestEntry ? restoreUndoEntry(currentTurn, latestEntry) : currentTurn;
    });
    setConfirmAction(null);
  }

  function undoCommittedTurn() {
    const snapshot = undoStack.at(-1);

    if (!snapshot) {
      return;
    }

    // Restore the exact state from before Next so the turn can be edited.
    setCurrentPlayerIndex(snapshot.currentPlayerIndex);
    setRows(cloneRows(snapshot.rows));
    setPenalties(snapshot.penalties);
    setTurn(cloneTurn(snapshot.turn));
    setGameOver(snapshot.gameOver);
    setGameOverReason(snapshot.gameOverReason);
    setUndoStack((currentStack) => currentStack.slice(0, -1));
    setConfirmAction(null);
  }

  function cancelConfirmAction() {
    setConfirmAction(null);
  }

  function confirmPendingAction() {
    if (confirmAction === "rollUndo") {
      performUndo();
      return;
    }

    if (confirmAction === "exit") {
      confirmExitToHome();
      return;
    }

    if (confirmAction === "startOver") {
      confirmStartOver();
    }
  }

  function endByOpponentPenalties() {
    if (gameOver) {
      return;
    }

    setGameOver(true);
    setGameOverReason("opponentPenalties");
  }

  function commitTurn() {
    if (mode !== "local" || !nextEnabled) {
      return;
    }

    // Save the editable turn before Next commits it.
    setUndoStack((currentStack) => [
      ...currentStack,
      createGameSnapshot(currentPlayerIndex, rows, penalties, turn, gameOver, gameOverReason),
    ]);

    const committed = commitLocalTurnState(scoreCard, rows, penalties, turn);
    const nextState = getGameOverFromRowsAndPenalties(committed.rows, committed.penalties, gameOverReason);

    setRows(committed.rows);
    setPenalties(committed.penalties);

    if (nextState.gameOver) {
      setGameOver(true);
      setGameOverReason(nextState.gameOverReason);
      setTurn({
        ...createEmptyTurn(),
        roll: turn.roll,
        opponentWhiteSum: turn.opponentWhiteSum,
      });
      return;
    }

    setCurrentPlayerIndex((index) => (index + 1) % gamePlayers.length);
    setTurn(createEmptyTurn());
    setGameOver(false);
    setGameOverReason(null);
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="brand">
          <img src="./icon.svg" alt="" className="brand-mark" />
          <strong>Qwixx</strong>
        </div>
      </header>

      {page === "home" ? (
        <div className="page-stack">
          <div className="tab-row" role="tablist" aria-label="Mode">
            <button
              className={homeTab === "local" ? "tab-button selected" : "tab-button"}
              type="button"
              onClick={() => setHomeTab("local")}
            >
              Local
            </button>
            <button
              className={homeTab === "sync" ? "tab-button selected" : "tab-button"}
              type="button"
              onClick={() => setHomeTab("sync")}
            >
              Sync
            </button>
          </div>

          {homeTab === "local" ? (
            <>
              <section className="section-panel">
                <div className="section-heading">
                  <h1>Players</h1>
                  <div className="heading-actions">
                    <button className="secondary" type="button" onClick={() => setPlayers(shufflePlayers(players))}>
                      <Shuffle size={18} />
                      Randomize
                    </button>
                    <button
                      className="secondary danger-button"
                      type="button"
                      onClick={() => {
                        setPlayers([]);
                        setSelectedPlayerId(null);
                      }}
                      disabled={players.length === 0}
                    >
                      <Trash2 size={18} />
                      Clear
                    </button>
                  </div>
                </div>

                <form className="add-player" onSubmit={addPlayer}>
                  <input
                    ref={draftNameInputRef}
                    value={draftName}
                    onChange={(event) => setDraftName(event.target.value)}
                    placeholder="Name"
                    autoComplete="off"
                  />
                  <button className="primary" type="submit" disabled={!draftName.trim()}>
                    <Plus size={18} />
                    Add
                  </button>
                </form>

                <div className="player-list">
                  {players.map((player) => (
                    <article
                      className={draggingPlayerId === player.id ? "player-row dragging" : "player-row"}
                      data-player-id={player.id}
                      key={player.id}
                    >
                      <button
                        className="drag-handle"
                        type="button"
                        onPointerDown={(event) => beginDrag(event, player.id)}
                        aria-label={`Move ${player.name}`}
                      >
                        <GripVertical size={18} />
                      </button>
                      <input
                        value={player.name}
                        onChange={(event) => updatePlayer(player.id, { name: event.target.value })}
                        autoComplete="off"
                        aria-label={`${player.name || "Player"} name`}
                      />
                      <button
                        className={selectedPlayerId === player.id ? "icon-button star selected" : "icon-button star"}
                        type="button"
                        onClick={() => setSelectedPlayerId(player.id)}
                        aria-label={`${player.name || "Player"} is me`}
                      >
                        <Star size={17} fill={selectedPlayerId === player.id ? "currentColor" : "none"} />
                      </button>
                      <button
                        className="icon-button danger"
                        type="button"
                        onClick={() => removePlayer(player.id)}
                        aria-label={`Remove ${player.name || "player"}`}
                      >
                        <Trash2 size={16} />
                      </button>
                    </article>
                  ))}
                </div>
              </section>

              <section className="section-panel compact-panel">
                <div className="section-heading">
                  <h1>Game</h1>
                </div>

                <ScoreCardChoice scoreCard={personalScoreCard} onEdit={() => openScoreCardPicker("local")} />

                <button
                  className="primary wide-button start-button"
                  type="button"
                  onClick={() => selectedPlayerId && startGame(players, selectedPlayerId, scoreCardId)}
                  disabled={!canStart}
                >
                  Start
                </button>
              </section>
            </>
          ) : (
            <section className="section-panel compact-panel">
              <div className="section-heading">
                <h1>Sync</h1>
                {syncPhase !== "idle" ? (
                  <button className="icon-button" type="button" onClick={resetSyncRuntime} aria-label="Clear sync">
                    <X size={17} />
                  </button>
                ) : null}
              </div>

              <input
                value={syncName}
                onChange={(event) => setSyncName(event.target.value)}
                placeholder="Your name"
                autoComplete="off"
                disabled={syncPhase !== "idle"}
                aria-label="Your name"
              />

              {syncPhase === "idle" ? (
                <div className="sync-start-row">
                  <button className="primary wide-button" type="button" onClick={beginHostSync} disabled={!syncName.trim()}>
                    <Wifi size={18} />
                    Host
                  </button>
                  <button
                    className="secondary wide-button"
                    type="button"
                    onClick={() => setSyncCameraMode("offer")}
                    disabled={!syncName.trim()}
                  >
                    <ScanLine size={18} />
                    Join
                  </button>
                </div>
              ) : null}

              {syncRole === "host" && syncPhase === "hostLobby" ? (
                <>
                  <SyncLobby
                    isHost
                    players={gamePlayers}
                    localPlayerId={selectedPlayerId}
                    hostPlayerId={syncHostPlayerId}
                    readyPlayerIds={[]}
                    syncMessage={syncMessage}
                    onRandomize={() => {
                      const nextPlayers = shufflePlayers(latestRef.current.gamePlayers);

                      syncLatestState({ gamePlayers: nextPlayers });
                      setGamePlayers(nextPlayers);
                      broadcastLobbyState(nextPlayers);
                    }}
                    onMove={(fromIndex, toIndex) => {
                      const currentPlayers = latestRef.current.gamePlayers;

                      if (toIndex < 0 || toIndex >= currentPlayers.length) {
                        return;
                      }

                      const nextPlayers = moveItem(currentPlayers, fromIndex, toIndex);

                      syncLatestState({ gamePlayers: nextPlayers });
                      setGamePlayers(nextPlayers);
                      broadcastLobbyState(nextPlayers);
                    }}
                    onRemove={removeSyncPlayer}
                    onScanAnswer={() => setSyncCameraMode("answer")}
                    scanDisabled={isAcceptingAnswer}
                  />
                </>
              ) : null}

              {syncRole === "host" && syncPhase === "hostLobby" ? (
                <>
                  {syncQrText ? <QrPanel label="Host QR" text={syncQrText} /> : null}
                  <ScoreCardChoice scoreCard={personalScoreCard} onEdit={() => openScoreCardPicker("syncHost")} />
                  <button
                    className="primary wide-button start-button"
                    type="button"
                    onClick={startSyncGame}
                    disabled={gamePlayers.length === 0 || isAcceptingAnswer}
                  >
                    Start
                  </button>
                </>
              ) : null}

              {syncRole === "joiner" && (syncPhase === "showAnswer" || syncPhase === "lobby") ? (
                <>
                  {syncAnswerText ? <QrPanel label="Answer QR" text={syncAnswerText} /> : null}
                  {syncHomeScoreCard ? <ScoreCardChoice scoreCard={syncHomeScoreCard} /> : null}
                  <SyncLobby
                    isHost={false}
                    players={gamePlayers}
                    localPlayerId={selectedPlayerId}
                    hostPlayerId={syncHostPlayerId}
                    readyPlayerIds={[]}
                    syncMessage={syncMessage}
                  />
                </>
              ) : null}

              {syncMessage && syncPhase === "idle" ? <p className="sync-status">{syncMessage}</p> : null}
            </section>
          )}
        </div>
      ) : null}

      {page === "picker" ? (
        <div className="page-stack card-picker-page">
          <section className="section-panel compact-panel" ref={pickerTopRef}>
            <div className="top-actions">
              <button className="icon-action" type="button" onClick={closeScoreCardPicker} aria-label="Back">
                <X size={19} />
              </button>
              <button className="icon-action selected" type="button" onClick={confirmScoreCardPicker} aria-label="Confirm">
                <Check size={19} />
              </button>
            </div>

            <div className="section-heading">
              <h1>Card #{draftScoreCard.id}</h1>
              <button className="secondary" type="button" onClick={randomizeDraftScoreCard}>
                <Shuffle size={17} />
                Random
              </button>
            </div>

            <div className="filter-grid" aria-label="Score card filters">
              {SCORE_CARD_TYPES.map((type) => {
                const checked = draftScoreCardFilters[type];
                const checkedCount = SCORE_CARD_TYPES.filter((candidate) => draftScoreCardFilters[candidate]).length;
                return (
                  <label className="filter-option" key={type}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleDraftScoreCardFilter(type)}
                      disabled={checked && checkedCount === 1}
                    />
                    <span>{getScoreCardTypeLabel(type)}</span>
                  </label>
                );
              })}
            </div>

            <ScoreCardPreview scoreCard={draftScoreCard} label={`Selected card ${draftScoreCard.id}`} />
          </section>

          <section className="section-panel card-option-list" aria-label="Score cards">
            {draftVisibleScoreCards.map((card) => (
              <button
                className={card.id === draftScoreCardId ? "score-card-option selected" : "score-card-option"}
                type="button"
                key={card.id}
                onClick={() => selectDraftScoreCard(card.id)}
                aria-label={`Select card ${card.id}`}
              >
                <span className="score-card-option-title">Card #{card.id}</span>
                <ScoreCardPreview scoreCard={card} label={`Card ${card.id}`} />
              </button>
            ))}
          </section>
        </div>
      ) : null}

      {page === "play" && currentPlayer ? (
        <div className="page-stack">
          <section className="section-panel play-panel">
            <div className="top-actions">
              <button className="icon-action" type="button" onClick={exitToHome} aria-label="Exit">
                <X size={19} />
              </button>
              <div className="play-actions">
                {mode === "local" || isHost ? (
                  <button className="icon-action" type="button" onClick={startOver} aria-label="Start over">
                    <RotateCcw size={19} />
                  </button>
                ) : null}
                <button
                  className={showHints ? "icon-action selected" : "icon-action"}
                  type="button"
                  onClick={toggleShowHints}
                  disabled={mode === "sync" && syncHintsLockedOff}
                  aria-label={
                    syncHintsLockedOff
                      ? "Legal options locked off"
                      : showHints
                        ? "Hide legal options"
                        : "Show legal options"
                  }
                >
                  {showHints ? <Eye size={19} /> : <EyeOff size={19} />}
                </button>
                {isHost ? (
                  <button
                    className={syncHintsLockedOff ? "icon-action selected" : "icon-action"}
                    type="button"
                    onClick={toggleSyncHintsLock}
                    aria-label={syncHintsLockedOff ? "Unlock legal options" : "Lock legal options off"}
                  >
                    {syncHintsLockedOff ? <Lock size={19} /> : <Unlock size={19} />}
                  </button>
                ) : null}
              </div>
            </div>

            <div className="turn-title">
              <h1>{currentPlayer.name}</h1>
              {isUserTurn ? <Star size={18} fill="currentColor" aria-label="Your turn" /> : null}
            </div>

            <DiceGrid
              rows={rows}
              scoreCard={scoreCard}
              roll={turn.roll}
              rollAnimationKey={rollAnimationKey}
              enabled={
                mode === "sync"
                  ? isUserTurn && !gameOver && !turn.roll && syncPhase === "turn"
                  : isUserTurn && !gameOver && !turn.roll
              }
              pale={!isUserTurn || isLocalReady}
              onRoll={handleRollDice}
            />

            {mode === "local" ? (
              <div
                className={!isUserTurn && !gameOver && turn.opponentWhiteSum === null ? "sum-strip needs-input" : "sum-strip"}
                aria-label="White dice sum"
              >
                {SUM_NUMBERS.map((sum) => {
                  const selectable = !isUserTurn && !gameOver && turn.opponentWhiteSum === null;
                  return (
                    <button
                      className={whiteSum === sum ? "sum-box selected" : "sum-box"}
                      type="button"
                      key={sum}
                      onClick={() => selectOpponentWhiteSum(sum)}
                      disabled={!selectable}
                      aria-label={`White sum ${sum}`}
                    >
                      {sum}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </section>

          <div className="turn-action-row">
            <button
              className="secondary turn-action-button"
              type="button"
              onClick={undoTurn}
              disabled={!canUndo}
              aria-label="Undo"
            >
              <Undo2 size={21} />
            </button>
            <button
              className="primary turn-action-button"
              type="button"
              onClick={mode === "sync" ? readySyncTurn : commitTurn}
              disabled={mode === "sync" ? !readyEnabled : !nextEnabled}
              aria-label={mode === "sync" ? "Ready" : "Next"}
            >
              {mode === "sync" ? <Check size={23} /> : <ArrowRight size={23} />}
            </button>
          </div>

          {mode === "sync" ? (
            <SyncLobby
              compact
              isHost={isHost}
              players={gamePlayers}
              localPlayerId={selectedPlayerId}
              hostPlayerId={syncHostPlayerId}
              readyPlayerIds={readyPlayerIds}
              syncMessage={syncMessage}
              onRemove={isHost ? removeSyncPlayer : undefined}
            />
          ) : null}

          <section className="score-card" aria-label="Score card">
            <div className="score-rows">
              <span className="score-final-divider" aria-hidden="true" />
              {ROW_COLORS.map((row) => (
                <ScoreRow
                  key={row}
                  row={row}
                  scoreCard={scoreCard}
                  rows={rows}
                  turn={turn}
                  legalMarkKeys={legalMarkKeys}
                  legalMarkRoles={legalMarkRoles}
                  showHints={showHints && !(mode === "sync" && syncHintsLockedOff)}
                  canLock={mode === "local" && canStageOpponentLock(scoreCard, row, rows, turn, diceStageDone, gameOver)}
                  gameOver={gameOver}
                  onSelectMark={selectMark}
                  onStageOpponentLock={stageOpponentLock}
                />
              ))}
            </div>

            <div className="penalty-row">
              <div className="penalty-left">
                <button
                  className={turn.penalty ? "penalty-button selected" : "penalty-button"}
                  type="button"
                  onClick={selectPenalty}
                  disabled={!penaltyEnabled}
                  aria-label="Penalty"
                >
                  -5
                </button>
                <div className="penalty-boxes" aria-label="Penalties">
                  {Array.from({ length: MAX_PENALTIES }, (_, index) => {
                    const selected = index < penalties || (turn.penalty && index === penalties);
                    return <span className={selected ? "penalty-box selected" : "penalty-box"} key={index} />;
                  })}
                </div>
              </div>
              {mode === "local" ? (
                <button
                  className="opponent-penalty-button"
                  type="button"
                  onClick={endByOpponentPenalties}
                  disabled={gameOver}
                  aria-label="Opponent reached four penalties"
                >
                  <AlertTriangle size={18} />
                  <span>4x</span>
                </button>
              ) : syncPenaltyPlayerIds.length > 0 ? (
                <span className="opponent-penalty-button readonly" role="status" aria-label={syncPenaltyLabel}>
                  <AlertTriangle size={18} />
                  <span>4x</span>
                </span>
              ) : null}
            </div>

            <div className="score-guide" aria-label="Scoring guide">
              {SCORE_VALUES.slice(1).map((score, index) => (
                <span key={score}>
                  {index + 1}x {score}
                </span>
              ))}
            </div>

            <ScoreTotals scoreCard={scoreCard} rows={rows} penalties={penalties} turn={turn} totalScore={totalScore} />
          </section>

          {mode === "sync" && syncToastMessage ? (
            <div className="sync-toast" role="status" aria-live="polite">
              {syncToastMessage}
            </div>
          ) : null}
        </div>
      ) : null}

      {confirmAction ? (
        <ConfirmModal action={confirmAction} onCancel={cancelConfirmAction} onConfirm={confirmPendingAction} />
      ) : null}

      {syncCameraMode ? (
        <QrScanner
          title={syncCameraMode === "answer" ? "Scan answer" : "Scan host"}
          onCancel={() => setSyncCameraMode(null)}
          onScan={syncCameraMode === "answer" ? acceptJoinAnswer : scanHostOffer}
        />
      ) : null}
    </main>
  );
}

function SyncLobby({
  compact = false,
  hostPlayerId,
  isHost,
  localPlayerId,
  onMove,
  onRandomize,
  onRemove,
  onScanAnswer,
  players,
  readyPlayerIds,
  scanDisabled = false,
  syncMessage,
}: {
  compact?: boolean;
  hostPlayerId: string | null;
  isHost: boolean;
  localPlayerId: string | null;
  onMove?: (fromIndex: number, toIndex: number) => void;
  onRandomize?: () => void;
  onRemove?: (playerId: string) => void;
  onScanAnswer?: () => void;
  players: Player[];
  readyPlayerIds: string[];
  scanDisabled?: boolean;
  syncMessage: string;
}) {
  const [draggingSyncPlayerId, setDraggingSyncPlayerId] = useState<string | null>(null);
  const canDrag = isHost && !compact && Boolean(onMove);

  useEffect(() => {
    if (!draggingSyncPlayerId || !canDrag || !onMove) {
      return undefined;
    }

    const activeDraggingPlayerId = draggingSyncPlayerId;
    const movePlayer = onMove;

    function handlePointerMove(event: PointerEvent) {
      const row = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-sync-player-id]");
      const overPlayerId = row?.dataset.syncPlayerId;

      if (!overPlayerId || overPlayerId === activeDraggingPlayerId) {
        return;
      }

      const fromIndex = players.findIndex((player) => player.id === activeDraggingPlayerId);
      const toIndex = players.findIndex((player) => player.id === overPlayerId);

      if (fromIndex >= 0 && toIndex >= 0 && fromIndex !== toIndex) {
        movePlayer(fromIndex, toIndex);
      }
    }

    function handlePointerUp() {
      setDraggingSyncPlayerId(null);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [canDrag, draggingSyncPlayerId, onMove, players]);

  function beginSyncDrag(event: ReactPointerEvent<HTMLButtonElement>, playerId: string) {
    if (!canDrag) {
      return;
    }

    event.preventDefault();
    setDraggingSyncPlayerId(playerId);
  }

  return (
    <div className={compact ? "sync-lobby compact" : "sync-lobby"}>
      <div className="sync-lobby-list">
        {players.map((player) => {
          const isReady = readyPlayerIds.includes(player.id);
          const isLocalPlayer = player.id === localPlayerId;

          return (
            <div
              className={[
                "sync-player-row",
                compact ? "compact-row" : "",
                canDrag ? "host-tools" : "",
                draggingSyncPlayerId === player.id ? "dragging" : "",
              ].filter(Boolean).join(" ")}
              data-sync-player-id={player.id}
              key={player.id}
            >
              {compact ? (
                <span className={isReady ? "sync-player-status ready" : "sync-player-status waiting"} aria-label={isReady ? "Ready" : "Waiting"}>
                  {isReady ? <Check size={17} /> : <CircleDashed size={17} />}
                </span>
              ) : null}
              {canDrag ? (
                <button
                  className="drag-handle"
                  type="button"
                  onPointerDown={(event) => beginSyncDrag(event, player.id)}
                  aria-label={`Move ${player.name}`}
                >
                  <GripVertical size={18} />
                </button>
              ) : null}
              <span className="sync-player-name">
                <span>{player.name}</span>
                {player.id === hostPlayerId ? <Crown className="sync-player-crown" size={16} aria-label="Host" /> : null}
              </span>
              {isLocalPlayer ? (
                <span className="icon-button star selected sync-static-icon" aria-label="You">
                  <Star size={17} fill="currentColor" />
                </span>
              ) : null}
              {isHost && onRemove && !isLocalPlayer ? (
                <button className="icon-button danger" type="button" onClick={() => onRemove(player.id)} aria-label={`Remove ${player.name}`}>
                  <Trash2 size={16} />
                </button>
              ) : null}
            </div>
          );
        })}
      </div>

      {isHost && !compact ? (
        <div className="sync-control-row">
          <button className="secondary" type="button" onClick={onRandomize} disabled={players.length < 2}>
            <Shuffle size={18} />
            Randomize
          </button>
          <button className="secondary" type="button" onClick={onScanAnswer} disabled={scanDisabled || !onScanAnswer}>
            <ScanLine size={18} />
            Scan
          </button>
        </div>
      ) : null}

      {syncMessage ? <p className="sync-status">{syncMessage}</p> : null}
    </div>
  );
}

function QrPanel({ label, text }: { label: string; text: string }) {
  const [svg, setSvg] = useState("");

  useEffect(() => {
    let alive = true;

    QRCode.toString(text, { errorCorrectionLevel: "L", margin: 4, type: "svg" })
      .then((nextSvg) => {
        if (alive) {
          setSvg(nextSvg.replace("<svg ", '<svg shape-rendering="crispEdges" '));
        }
      })
      .catch(() => {
        if (alive) {
          setSvg("");
        }
      });

    return () => {
      alive = false;
    };
  }, [text]);

  return (
    <div className="qr-panel">
      <span>{label}</span>
      {svg ? <div className="qr-code" role="img" aria-label={label} dangerouslySetInnerHTML={{ __html: svg }} /> : <div className="qr-placeholder" />}
    </div>
  );
}

function QrScanner({
  onCancel,
  onScan,
  title,
}: {
  onCancel: () => void;
  onScan: (value: string) => void;
  title: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scannedRef = useRef(false);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("Looking for QR");
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  useEffect(() => {
    let frame = 0;
    let scanTimeout = 0;
    let stream: MediaStream | null = null;
    const scanSize = 1024;
    const detectorConstructor = (window as unknown as { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
    let detector: BarcodeDetectorInstance | null = null;

    try {
      detector = detectorConstructor ? new detectorConstructor({ formats: ["qr_code"] }) : null;
    } catch {
      detector = null;
    }

    async function startCamera() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            aspectRatio: { ideal: 1 },
            facingMode: { ideal: "environment" },
            height: { ideal: 1440 },
            width: { ideal: 1440 },
          },
        });
        const [track] = stream.getVideoTracks();
        trackRef.current = track ?? null;

        if (track) {
          const capabilities = track.getCapabilities?.() as ExtendedMediaTrackCapabilities | undefined;
          const advanced: ExtendedMediaTrackConstraintSet[] = [];

          if (capabilities?.focusMode?.includes("continuous")) {
            advanced.push({ focusMode: "continuous" });
          }

          if (capabilities?.torch) {
            setTorchSupported(true);
          }

          if (advanced.length > 0) {
            await track.applyConstraints({ advanced }).catch(() => undefined);
          }
        }

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          scan();
        }
      } catch {
        setError("Camera unavailable");
        setStatus("");
      }
    }

    async function readQrCode(canvas: HTMLCanvasElement, image: ImageData) {
      if (detector) {
        const results = await detector.detect(canvas).catch(() => []);
        const value = results[0]?.rawValue;

        if (value) {
          return value;
        }
      }

      return jsQR(image.data, image.width, image.height, {
        inversionAttempts: "attemptBoth",
      })?.data ?? null;
    }

    async function scanFrame() {
      const video = videoRef.current;
      const canvas = canvasRef.current;

      if (!video || !canvas || scannedRef.current) {
        return;
      }

      if (video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth > 0 && video.videoHeight > 0) {
        const sourceSize = Math.min(video.videoWidth, video.videoHeight);
        const sourceX = Math.floor((video.videoWidth - sourceSize) / 2);
        const sourceY = Math.floor((video.videoHeight - sourceSize) / 2);
        canvas.width = scanSize;
        canvas.height = scanSize;
        const context = canvas.getContext("2d", { willReadFrequently: true });

        if (context) {
          // Match the visible square scanner frame so decoding ignores the cropped camera edges.
          context.drawImage(video, sourceX, sourceY, sourceSize, sourceSize, 0, 0, scanSize, scanSize);
          const image = context.getImageData(0, 0, canvas.width, canvas.height);
          const code = await readQrCode(canvas, image);

          if (code) {
            scannedRef.current = true;
            setStatus("QR found");
            scanTimeout = window.setTimeout(() => onScan(code), 120);
            return;
          }
        }
      }

      frame = window.requestAnimationFrame(scan);
    }

    function scan() {
      void scanFrame();
    }

    void startCamera();

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(scanTimeout);
      stream?.getTracks().forEach((track) => track.stop());
      trackRef.current = null;
    };
  }, [onScan]);

  async function toggleTorch() {
    const track = trackRef.current;

    if (!track) {
      return;
    }

    const nextTorch = !torchOn;
    await track.applyConstraints({ advanced: [{ torch: nextTorch } as ExtendedMediaTrackConstraintSet] }).catch(() => undefined);
    setTorchOn(nextTorch);
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="scanner-modal" role="dialog" aria-modal="true" aria-labelledby="scanner-title">
        <div className="section-heading">
          <h1 id="scanner-title">{title}</h1>
          <button className="icon-button" type="button" onClick={onCancel} aria-label="Cancel">
            <X size={17} />
          </button>
        </div>
        <div className="scanner-frame">
          <video ref={videoRef} muted playsInline />
          <span className="scanner-target" aria-hidden="true" />
        </div>
        {torchSupported ? (
          <button className="secondary wide-button" type="button" onClick={toggleTorch}>
            {torchOn ? "Torch off" : "Torch on"}
          </button>
        ) : null}
        <canvas ref={canvasRef} hidden />
        <p className="sync-status">{error || status}</p>
      </section>
    </div>
  );
}

function DiceGrid({
  enabled,
  onRoll,
  pale,
  roll,
  rollAnimationKey,
  rows,
  scoreCard,
}: {
  enabled: boolean;
  onRoll: () => void;
  pale: boolean;
  roll: DiceRoll | null;
  rollAnimationKey: number;
  rows: RowsState;
  scoreCard: ScoreCardPreset;
}) {
  return (
    <button className={pale ? "dice-grid pale" : "dice-grid"} type="button" onClick={onRoll} disabled={!enabled} aria-label="Roll dice">
      {DICE_LAYOUT.map((die) => {
        if (isRowColor(die.key) && !isDieAvailable(die.key, rows, scoreCard)) {
          return null;
        }

        const value = roll ? roll[die.key as keyof DiceRoll] ?? null : null;

        return (
          <Die
            color={die.color}
            column={die.column}
            key={die.key}
            row={die.row}
            value={typeof value === "number" ? value : null}
            rollAnimationKey={rollAnimationKey}
          />
        );
      })}
    </button>
  );
}

function Die({
  color,
  column,
  row,
  rollAnimationKey,
  value,
}: {
  color: string;
  column: number;
  row: number;
  rollAnimationKey: number;
  value: number | null;
}) {
  const pipPositions: Record<number, number[]> = {
    1: [4],
    2: [0, 8],
    3: [0, 4, 8],
    4: [0, 2, 6, 8],
    5: [0, 2, 4, 6, 8],
    6: [0, 2, 3, 5, 6, 8],
  };
  const positions = value ? pipPositions[value] : [];

  return (
    <span
      className={value ? `die ${color} rolled` : `die ${color} idle`}
      style={{ gridColumn: column, gridRow: row }}
      key={`${color}-${rollAnimationKey}-${value ?? "idle"}`}
    >
      {Array.from({ length: 9 }, (_, index) => (
        <span className={positions.includes(index) ? `pip p${index} visible` : `pip p${index}`} key={index} />
      ))}
    </span>
  );
}

function scoreTileStyle(color: RowColor): CSSProperties {
  return {
    "--row-tile-fill": SCORE_COLOR_TILE_FILLS[color],
    "--row-tile-border": SCORE_COLOR_TILE_FILLS[color],
  } as CSSProperties;
}

function scoreSegmentStyle(color: RowColor): CSSProperties {
  return {
    "--score-row-segment-bg": SCORE_COLOR_BACKGROUNDS[color],
  } as CSSProperties;
}

function ScoreRow({
  canLock,
  gameOver,
  legalMarkKeys,
  legalMarkRoles,
  onSelectMark,
  onStageOpponentLock,
  preview = false,
  row,
  rows,
  scoreCard,
  showHints,
  turn,
}: {
  canLock: boolean;
  gameOver: boolean;
  legalMarkKeys: Set<string>;
  legalMarkRoles: Map<string, Set<MarkRole>>;
  onSelectMark: (mark: ScoreMark) => void;
  onStageOpponentLock: (row: RowColor) => void;
  preview?: boolean;
  row: RowColor;
  rows: RowsState;
  scoreCard: ScoreCardPreset;
  showHints: boolean;
  turn: TurnDraft;
}) {
  const cardRow = getScoreCardRow(scoreCard, row);
  const rowLabel = getScoreCardRowLabel(row);
  const lockColor = getScoreCardLockColor(scoreCard, row);
  const rowSegments = [...cardRow.tiles.map((tile) => tile.color), lockColor];
  const ownLock = rows[row].lock === "own" || hasStagedOwnLock(scoreCard, row, turn);
  const opponentLock = rows[row].lock === "opponent" || turn.opponentLocks.includes(row);
  const closed = rows[row].lock !== "none";

  return (
    <div className={`score-row ${row} ${closed ? "closed" : ""}`}>
      <div className="score-row-backdrop" aria-hidden="true">
        {rowSegments.map((color, index) => (
          <span
            className={rowSegments[index + 1] && rowSegments[index + 1] !== color ? "score-row-segment divider-after" : "score-row-segment"}
            key={`${color}-${index}`}
            style={scoreSegmentStyle(color)}
          />
        ))}
      </div>

      {cardRow.tiles.map((tile) => {
        const number = tile.number;
        const mark: ScoreMark = { row, number };
        const key = markKey(mark);
        const selected =
          rows[row].selected.includes(number) ||
          turn.selectedMarks.some((selectedMark) => markKey(selectedMark) === key);
        const legal = legalMarkKeys.has(key);
        const roles = legalMarkRoles.get(key);
        const whiteHint = showHints && Boolean(roles?.has("white"));
        const mixedHint = showHints && Boolean(roles?.has("mixed"));
        const className = [
          "score-tile",
          selected ? "selected" : "",
          legal ? "legal" : "",
          whiteHint ? "hint-white" : "",
          mixedHint ? "hint-mixed" : "",
        ]
          .filter(Boolean)
          .join(" ");
        const content = <span>{number}</span>;

        return preview ? (
          <span className={className} key={number} style={scoreTileStyle(tile.color)} aria-hidden="true">
            {content}
          </span>
        ) : (
          <button
            className={className}
            key={number}
            type="button"
            onClick={() => onSelectMark(mark)}
            disabled={!legal || gameOver}
            aria-label={`${rowLabel} ${number}`}
            style={scoreTileStyle(tile.color)}
          >
            {content}
          </button>
        );
      })}

      {preview ? (
        <span
          className={[
            "lock-tile",
            ownLock ? "own" : "",
            opponentLock ? "opponent" : "",
            canLock ? "legal" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          style={scoreTileStyle(lockColor)}
          aria-hidden="true"
        >
          <Lock size={17} />
        </span>
      ) : (
        <button
          className={[
            "lock-tile",
            ownLock ? "own" : "",
            opponentLock ? "opponent" : "",
            canLock ? "legal" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          type="button"
          onClick={() => onStageOpponentLock(row)}
          disabled={!canLock || gameOver}
          aria-label={`${rowLabel} locked`}
          style={scoreTileStyle(lockColor)}
        >
          <Lock size={17} />
        </button>
      )}
    </div>
  );
}

function ScoreTotals({
  penalties,
  rows,
  scoreCard,
  totalScore,
  turn,
}: {
  penalties: number;
  rows: RowsState;
  scoreCard: ScoreCardPreset;
  totalScore: number;
  turn: TurnDraft;
}) {
  return (
    <div className="totals-row" aria-label="Totals">
      {ROW_COLORS.map((row, index) => (
        <span className="total-piece" key={row}>
          {index > 0 ? <span className="operator">+</span> : null}
          <span className={`total-box ${row}`}>{getColorScore(row, scoreCard, rows, turn)}</span>
        </span>
      ))}
      <span className="operator">-</span>
      <span className="total-box penalty">{getPenaltyCount(penalties, turn) * PENALTY_POINTS}</span>
      <span className="operator">=</span>
      <strong className="grand-total">{totalScore}</strong>
    </div>
  );
}

function ScoreCardChoice({
  onEdit,
  scoreCard,
}: {
  onEdit?: () => void;
  scoreCard: ScoreCardPreset;
}) {
  return (
    <div className="score-card-choice">
      <div className="score-card-choice-heading">
        <span>Card #{scoreCard.id}</span>
        {onEdit ? (
          <button className="secondary" type="button" onClick={onEdit}>
            <Pencil size={16} />
            Edit
          </button>
        ) : null}
      </div>
      <ScoreCardPreview scoreCard={scoreCard} label={`Card ${scoreCard.id}`} />
    </div>
  );
}

function ScoreCardPreview({
  label,
  scoreCard,
}: {
  label: string;
  scoreCard: ScoreCardPreset;
}) {
  const emptyRows = createEmptyRows();
  const emptyTurn = createEmptyTurn();
  const emptyLegalKeys = new Set<string>();
  const emptyLegalRoles = new Map<string, Set<MarkRole>>();

  return (
    <div className="score-card-preview" aria-label={label}>
      <div className="score-rows">
        <span className="score-final-divider" aria-hidden="true" />
        {ROW_COLORS.map((row) => (
          <ScoreRow
            key={row}
            row={row}
            scoreCard={scoreCard}
            rows={emptyRows}
            turn={emptyTurn}
            legalMarkKeys={emptyLegalKeys}
            legalMarkRoles={emptyLegalRoles}
            showHints={false}
            canLock={false}
            gameOver
            preview
            onSelectMark={() => undefined}
            onStageOpponentLock={() => undefined}
          />
        ))}
      </div>
    </div>
  );
}

function ConfirmModal({
  action,
  onCancel,
  onConfirm,
}: {
  action: "rollUndo" | "exit" | "startOver";
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const copy = {
    exit: {
      title: "Exit?",
      confirmLabel: "Exit",
    },
    rollUndo: {
      title: "Undo roll?",
      confirmLabel: "Undo",
    },
    startOver: {
      title: "Start over?",
      confirmLabel: "Reset",
    },
  }[action];

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <h2 id="confirm-title">{copy.title}</h2>
        <div className="confirm-actions">
          <button className="secondary" type="button" onClick={onCancel} aria-label="Cancel">
            <X size={18} />
          </button>
          <button className="primary" type="button" onClick={onConfirm}>
            {copy.confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

export default App;

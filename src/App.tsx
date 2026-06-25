import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  Crown,
  Eye,
  EyeOff,
  GripVertical,
  Lock,
  Plus,
  RotateCcw,
  ScanLine,
  Shuffle,
  Star,
  Trash2,
  Undo2,
  UserMinus,
  UserPlus,
  Users,
  Wifi,
  X,
} from "lucide-react";
import QRCode from "qrcode";
import {
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import jsQR from "jsqr";
import { SyncHostTransport, SyncJoinTransport, type SyncWireMessage } from "./syncTransport";

type Page = "home" | "play";
type HomeTab = "local" | "sync";
type PlayMode = "local" | "sync";
type SyncRole = "host" | "joiner" | null;
type SyncPhase = "idle" | "hostLobby" | "scanOffer" | "showAnswer" | "lobby" | "turn" | "readyToAdvance" | "gameOver" | "ended";

type Player = {
  id: string;
  name: string;
};

type RowColor = "red" | "yellow" | "green" | "blue";

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
type SyncGameOverReason = GameOverReason | "hostEnded";

type SyncReadyPayload = {
  turnId: string;
  playerId: string;
  closedRows: RowColor[];
  reachedFourPenalties: boolean;
};

type PendingHostTransfer = {
  transferId: string;
  transport: SyncHostTransport;
  expectedPlayerIds: string[];
  acceptedPlayerIds: string[];
};

type PendingJoinTransfer = {
  transferId: string;
  transport: SyncJoinTransport;
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
};

type RowConfig = {
  color: RowColor;
  label: string;
  numbers: number[];
  finalNumber: number;
};

const PLAYERS_KEY = "qwixx.players.v1";
const SELECTED_PLAYER_KEY = "qwixx.selectedPlayer.v1";
const SHOW_HINTS_KEY = "qwixx.showHints.v1";
const ACTIVE_GAME_KEY = "qwixx.activeGame.v1";
const SYNC_NAME_KEY = "qwixx.syncName.v1";

const ROW_COLORS = ["red", "yellow", "green", "blue"] as const;
const SUM_NUMBERS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
const SCORE_VALUES = [0, 1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 66, 78] as const;
const MAX_PENALTIES = 4;
const PENALTY_POINTS = 5;

const ROW_CONFIGS: Record<RowColor, RowConfig> = {
  red: {
    color: "red",
    label: "Red",
    numbers: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    finalNumber: 12,
  },
  yellow: {
    color: "yellow",
    label: "Yellow",
    numbers: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    finalNumber: 12,
  },
  green: {
    color: "green",
    label: "Green",
    numbers: [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2],
    finalNumber: 2,
  },
  blue: {
    color: "blue",
    label: "Blue",
    numbers: [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2],
    finalNumber: 2,
  },
};

const DICE_LAYOUT = [
  { key: "whiteA", color: "white", row: 1, column: 1 },
  { key: "red", color: "red", row: 1, column: 2 },
  { key: "green", color: "green", row: 1, column: 3 },
  { key: "whiteB", color: "white", row: 2, column: 1 },
  { key: "yellow", color: "yellow", row: 2, column: 2 },
  { key: "blue", color: "blue", row: 2, column: 3 },
] as const;

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

function createFreshGame(players: Player[], selectedPlayerId: string): ActiveGame {
  return {
    mode: "local",
    page: "play",
    players,
    selectedPlayerId,
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
  return typeof value === "string" && (ROW_COLORS as readonly string[]).includes(value);
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

function normalizeRows(value: unknown): RowsState {
  const rows = createEmptyRows();

  if (!value || typeof value !== "object") {
    return rows;
  }

  const rawRows = value as Partial<Record<RowColor, Partial<RowState>>>;

  ROW_COLORS.forEach((row) => {
    const rawRow = rawRows[row];
    const selected = Array.isArray(rawRow?.selected)
      ? rawRow.selected
          .filter((number): number is number => ROW_CONFIGS[row].numbers.includes(Number(number)))
          .map(Number)
          .filter((number, index, values) => values.indexOf(number) === index)
          .sort((left, right) => visualIndex(row, left) - visualIndex(row, right))
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

function normalizeTurnCore(value: unknown): TurnCore {
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

          if (!isRowColor(row) || !ROW_CONFIGS[row].numbers.includes(number)) {
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

function normalizeUndoEntry(value: unknown): UndoEntry | null {
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
    before: normalizeTurnCore(rawEntry.before),
    kind,
  };
}

function normalizeTurn(value: unknown): TurnDraft {
  const core = normalizeTurnCore(value);
  const rawTurn = value && typeof value === "object" ? (value as Partial<TurnDraft>) : null;
  const history = Array.isArray(rawTurn?.history)
    ? rawTurn.history.map(normalizeUndoEntry).filter((entry): entry is UndoEntry => Boolean(entry))
    : [];

  return {
    ...core,
    history,
  };
}

function normalizeGameOverReason(value: unknown): GameOverReason {
  return value === "rows" || value === "ownPenalties" || value === "opponentPenalties" ? value : null;
}

function normalizeGameSnapshot(value: unknown, playerCount: number): GameSnapshot | null {
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
    rows: normalizeRows(snapshot.rows),
    penalties: Number.isInteger(penalties) ? Math.max(0, Math.min(MAX_PENALTIES, penalties)) : 0,
    turn: normalizeTurn(snapshot.turn),
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
      currentPlayerIndex,
      rows: normalizeRows(game.rows),
      penalties: Number.isInteger(penalties) ? Math.max(0, Math.min(MAX_PENALTIES, penalties)) : 0,
      turn: normalizeTurn(game.turn),
      gameOver: game.gameOver === true,
      gameOverReason,
      undoStack: Array.isArray(game.undoStack)
        ? game.undoStack
            .map((snapshot) => normalizeGameSnapshot(snapshot, players.length))
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

function rollDice(rows: RowsState): DiceRoll {
  const roll: DiceRoll = {
    whiteA: rollDie(),
    whiteB: rollDie(),
  };

  ROW_COLORS.forEach((row) => {
    if (rows[row].lock === "none") {
      roll[row] = rollDie();
    }
  });

  return roll;
}

function markKey(mark: ScoreMark) {
  return `${mark.row}-${mark.number}`;
}

function visualIndex(row: RowColor, number: number) {
  return ROW_CONFIGS[row].numbers.indexOf(number);
}

function getCommittedClosedCount(rows: RowsState) {
  return ROW_COLORS.filter((row) => rows[row].lock !== "none").length;
}

function getSelectedCountForRow(row: RowColor, rows: RowsState, turn: TurnDraft) {
  const stagedCount = turn.selectedMarks.filter((mark) => mark.row === row).length;
  return rows[row].selected.length + stagedCount;
}

function getRightmostSelectedIndex(row: RowColor, rows: RowsState, turn: TurnDraft) {
  const indexes = [
    ...rows[row].selected.map((number) => visualIndex(row, number)),
    ...turn.selectedMarks.filter((mark) => mark.row === row).map((mark) => visualIndex(row, mark.number)),
  ];

  return indexes.length > 0 ? Math.max(...indexes) : -1;
}

function hasStagedOwnLock(row: RowColor, turn: TurnDraft) {
  return turn.selectedMarks.some((mark) => mark.row === row && mark.number === ROW_CONFIGS[row].finalNumber);
}

function isRowUnavailableThisTurn(row: RowColor, rows: RowsState, turn: TurnDraft) {
  return rows[row].lock !== "none" || turn.opponentLocks.includes(row) || hasStagedOwnLock(row, turn);
}

function canPhysicallySelectMark(row: RowColor, number: number, rows: RowsState, turn: TurnDraft) {
  if (isRowUnavailableThisTurn(row, rows, turn)) {
    return false;
  }

  if (turn.selectedMarks.some((mark) => mark.row === row && mark.number === number)) {
    return false;
  }

  if (!ROW_CONFIGS[row].numbers.includes(number)) {
    return false;
  }

  const index = visualIndex(row, number);

  if (index <= getRightmostSelectedIndex(row, rows, turn)) {
    return false;
  }

  if (number === ROW_CONFIGS[row].finalNumber && getSelectedCountForRow(row, rows, turn) < 5) {
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

function getRolesForMark(mark: ScoreMark, whiteSum: number | null, mixedSums: Partial<Record<RowColor, number[]>>) {
  const roles: MarkRole[] = [];

  if (whiteSum === mark.number) {
    roles.push("white");
  }

  if (mixedSums[mark.row]?.includes(mark.number)) {
    roles.push("mixed");
  }

  return roles;
}

function isValidRoleOrder(whiteMark: ScoreMark, mixedMark: ScoreMark) {
  // White must be visually first only when both marks live in the same row.
  return whiteMark.row !== mixedMark.row || visualIndex(whiteMark.row, whiteMark.number) < visualIndex(mixedMark.row, mixedMark.number);
}

function getValidUserRoleAssignments(marks: ScoreMark[], turn: TurnDraft) {
  const whiteSum = getWhiteSum(turn, true);
  const mixedSums = getMixedSums(turn);

  if (!whiteSum || marks.length === 0 || marks.length > 2) {
    return [];
  }

  if (marks.length === 1) {
    return getRolesForMark(marks[0], whiteSum, mixedSums).map((role) => [role]);
  }

  const firstRoles = getRolesForMark(marks[0], whiteSum, mixedSums);
  const secondRoles = getRolesForMark(marks[1], whiteSum, mixedSums);
  const assignments: MarkRole[][] = [];

  if (firstRoles.includes("white") && secondRoles.includes("mixed") && isValidRoleOrder(marks[0], marks[1])) {
    assignments.push(["white", "mixed"]);
  }

  if (firstRoles.includes("mixed") && secondRoles.includes("white") && isValidRoleOrder(marks[1], marks[0])) {
    assignments.push(["mixed", "white"]);
  }

  return assignments;
}

function hasValidUserInterpretation(marks: ScoreMark[], turn: TurnDraft) {
  return getValidUserRoleAssignments(marks, turn).length > 0;
}

function getCandidateMarks(rows: RowsState, turn: TurnDraft) {
  return ROW_COLORS.flatMap((row) =>
    ROW_CONFIGS[row].numbers
      .filter((number) => canPhysicallySelectMark(row, number, rows, turn))
      .map((number) => ({ row, number })),
  );
}

function getLegalMarkKeys({
  rows,
  turn,
  isUserTurn,
  mode = "local",
  gameOver,
}: {
  rows: RowsState;
  turn: TurnDraft;
  isUserTurn: boolean;
  mode?: PlayMode;
  gameOver: boolean;
}) {
  if (gameOver) {
    return new Set<string>();
  }

  const whiteSum = getWhiteSum(turn, isUserTurn, mode);

  if (!whiteSum) {
    return new Set<string>();
  }

  if (!isUserTurn) {
    if (turn.selectedMarks.length > 0 || turn.penalty) {
      return new Set<string>();
    }

    return new Set(
      getCandidateMarks(rows, turn)
        .filter((mark) => mark.number === whiteSum)
        .map(markKey),
    );
  }

  if (turn.penalty || turn.selectedMarks.length >= 2) {
    return new Set<string>();
  }

  return new Set(
    getCandidateMarks(rows, turn)
      .filter((mark) => hasValidUserInterpretation([...turn.selectedMarks, mark], turn))
      .map(markKey),
  );
}

function getLegalMarkRoles({
  rows,
  turn,
  isUserTurn,
  mode = "local",
  gameOver,
}: {
  rows: RowsState;
  turn: TurnDraft;
  isUserTurn: boolean;
  mode?: PlayMode;
  gameOver: boolean;
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

    getCandidateMarks(rows, turn)
      .filter((mark) => mark.number === whiteSum)
      .forEach((mark) => roleMap.set(markKey(mark), new Set(["white"])));
    return roleMap;
  }

  if (turn.penalty || turn.selectedMarks.length >= 2) {
    return roleMap;
  }

  getCandidateMarks(rows, turn).forEach((mark) => {
    const assignments = getValidUserRoleAssignments([...turn.selectedMarks, mark], turn);
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

function canStageOpponentLock(row: RowColor, rows: RowsState, turn: TurnDraft, diceStageDone: boolean, gameOver: boolean) {
  return (
    !gameOver &&
    diceStageDone &&
    rows[row].lock === "none" &&
    !turn.opponentLocks.includes(row) &&
    !hasStagedOwnLock(row, turn)
  );
}

function canAdvanceTurn(turn: TurnDraft, isUserTurn: boolean, gameOver: boolean) {
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

    return hasValidUserInterpretation(turn.selectedMarks, turn);
  }

  return turn.opponentWhiteSum !== null;
}

function getPreviewColorCount(row: RowColor, rows: RowsState, turn: TurnDraft) {
  const committed = rows[row].selected.length + (rows[row].lock === "own" ? 1 : 0);
  const stagedMarks = turn.selectedMarks.filter((mark) => mark.row === row).length;
  const stagedLock = hasStagedOwnLock(row, turn) ? 1 : 0;
  return committed + stagedMarks + stagedLock;
}

function getColorScore(row: RowColor, rows: RowsState, turn: TurnDraft) {
  return SCORE_VALUES[Math.min(12, getPreviewColorCount(row, rows, turn))];
}

function getPenaltyCount(penalties: number, turn: TurnDraft) {
  return penalties + (turn.penalty ? 1 : 0);
}

function getTotalScore(rows: RowsState, penalties: number, turn: TurnDraft) {
  const colorTotal = ROW_COLORS.reduce((total, row) => total + getColorScore(row, rows, turn), 0);
  return colorTotal - getPenaltyCount(penalties, turn) * PENALTY_POINTS;
}

function getOwnClosedRows(turn: TurnDraft) {
  return ROW_COLORS.filter((row) => hasStagedOwnLock(row, turn));
}

function createReadyPayload(turnId: string, playerId: string, penalties: number, turn: TurnDraft): SyncReadyPayload {
  return {
    turnId,
    playerId,
    closedRows: getOwnClosedRows(turn),
    reachedFourPenalties: penalties + (turn.penalty ? 1 : 0) >= MAX_PENALTIES,
  };
}

function commitLocalTurnState(rows: RowsState, penalties: number, turn: TurnDraft) {
  const nextRows = cloneRows(rows);

  turn.selectedMarks.forEach((mark) => {
    if (!nextRows[mark.row].selected.includes(mark.number)) {
      nextRows[mark.row].selected.push(mark.number);
      nextRows[mark.row].selected.sort((left, right) => visualIndex(mark.row, left) - visualIndex(mark.row, right));
    }
  });

  ROW_COLORS.forEach((row) => {
    if (hasStagedOwnLock(row, turn)) {
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

function App() {
  const savedGameRef = useRef<ActiveGame | null>(readActiveGame());
  const savedGame = savedGameRef.current;
  const [page, setPage] = useState<Page>(savedGame?.page ?? "home");
  const [mode, setMode] = useState<PlayMode>("local");
  const [homeTab, setHomeTab] = useState<HomeTab>("local");
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
  const [confirmAction, setConfirmAction] = useState<"rollUndo" | "exit" | "startOver" | null>(null);
  const [draggingPlayerId, setDraggingPlayerId] = useState<string | null>(null);
  const [rollAnimationKey, setRollAnimationKey] = useState(0);
  const draftNameInputRef = useRef<HTMLInputElement>(null);
  const hostTransportRef = useRef<SyncHostTransport | null>(null);
  const joinTransportRef = useRef<SyncJoinTransport | null>(null);
  const pendingHostTransferRef = useRef<PendingHostTransfer | null>(null);
  const pendingJoinTransferRef = useRef<PendingJoinTransfer | null>(null);
  const rowsRef = useRef(rows);
  const turnRef = useRef(turn);
  const gamePlayersRef = useRef(gamePlayers);
  const currentPlayerIndexRef = useRef(currentPlayerIndex);
  const syncTurnIdRef = useRef(syncTurnId);
  const syncPhaseRef = useRef(syncPhase);
  const syncRoleRef = useRef(syncRole);
  const syncReadyPayloadsRef = useRef(syncReadyPayloads);
  const syncHostPlayerIdRef = useRef(syncHostPlayerId);
  const selectedPlayerIdRef = useRef(selectedPlayerId);

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
  const legalMarkKeys = useMemo(
    () => getLegalMarkKeys({ rows, turn, isUserTurn, mode, gameOver: gameOver || isLocalReady }),
    [rows, turn, isUserTurn, mode, gameOver, isLocalReady],
  );
  const legalMarkRoles = useMemo(
    () => getLegalMarkRoles({ rows, turn, isUserTurn, mode, gameOver: gameOver || isLocalReady }),
    [rows, turn, isUserTurn, mode, gameOver, isLocalReady],
  );
  const nextEnabled = canAdvanceTurn(turn, isUserTurn, gameOver);
  const readyEnabled = isSyncMode
    ? !gameOver &&
      syncPhase === "turn" &&
      !isLocalReady &&
      (isUserTurn ? canAdvanceTurn(turn, true, false) : Boolean(turn.roll))
    : false;
  const advanceEnabled = isSyncMode && isHost && syncPhase === "readyToAdvance" && !gameOver;
  const penaltyEnabled = canSelectPenalty(turn, isUserTurn, penalties, gameOver || isLocalReady);
  const totalScore = getTotalScore(rows, penalties, turn);
  const penaltyCount = getPenaltyCount(penalties, turn);
  const canStart =
    players.length > 0 &&
    players.every((player) => player.name.trim().length > 0) &&
    Boolean(selectedPlayerId && selectedPlayerExists);
  const canUndo =
    mode === "local"
      ? gameOverReason !== "opponentPenalties" && (turn.history.length > 0 || undoStack.length > 0)
      : syncPhase === "turn" && !isLocalReady && turn.history.length > 0;

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
    currentPlayerIndex,
    rows,
    penalties,
    turn,
    gameOver,
    gameOverReason,
    undoStack,
  ]);

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  useEffect(() => {
    turnRef.current = turn;
  }, [turn]);

  useEffect(() => {
    gamePlayersRef.current = gamePlayers;
  }, [gamePlayers]);

  useEffect(() => {
    currentPlayerIndexRef.current = currentPlayerIndex;
  }, [currentPlayerIndex]);

  useEffect(() => {
    syncTurnIdRef.current = syncTurnId;
  }, [syncTurnId]);

  useEffect(() => {
    syncPhaseRef.current = syncPhase;
  }, [syncPhase]);

  useEffect(() => {
    syncRoleRef.current = syncRole;
  }, [syncRole]);

  useEffect(() => {
    syncReadyPayloadsRef.current = syncReadyPayloads;
  }, [syncReadyPayloads]);

  useEffect(() => {
    syncHostPlayerIdRef.current = syncHostPlayerId;
  }, [syncHostPlayerId]);

  useEffect(() => {
    selectedPlayerIdRef.current = selectedPlayerId;
  }, [selectedPlayerId]);

  useEffect(() => () => {
    hostTransportRef.current?.close();
    joinTransportRef.current?.close();
    pendingHostTransferRef.current?.transport.close();
    pendingJoinTransferRef.current?.transport.close();
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

  function startGame(nextPlayers: Player[], nextSelectedPlayerId: string) {
    const orderedPlayers = nextPlayers
      .map((player) => ({ ...player, name: player.name.trim() }))
      .filter((player) => player.name.length > 0);

    if (orderedPlayers.length === 0 || !orderedPlayers.some((player) => player.id === nextSelectedPlayerId)) {
      return;
    }

    const game = createFreshGame(orderedPlayers, nextSelectedPlayerId);

    hostTransportRef.current?.close();
    joinTransportRef.current?.close();
    localStorage.removeItem(ACTIVE_GAME_KEY);
    setMode("local");
    setSyncRole(null);
    setSyncPhase("idle");
    setSyncQrText("");
    setSyncAnswerText("");
    setSyncCameraMode(null);
    setSyncMessage("");
    setPlayers(orderedPlayers);
    setSelectedPlayerId(nextSelectedPlayerId);
    setGamePlayers(game.players);
    setCurrentPlayerIndex(game.currentPlayerIndex);
    setRows(game.rows);
    setPenalties(game.penalties);
    setTurn(game.turn);
    setGameOver(game.gameOver);
    setGameOverReason(game.gameOverReason);
    setUndoStack(game.undoStack);
    setPage("play");
    setRollAnimationKey(0);
  }

  function resetPlayState(nextPlayers: Player[], nextSelectedPlayerId: string) {
    setSelectedPlayerId(nextSelectedPlayerId);
    setGamePlayers(nextPlayers);
    setCurrentPlayerIndex(0);
    setRows(createEmptyRows());
    setPenalties(0);
    setTurn(createEmptyTurn());
    setGameOver(false);
    setGameOverReason(null);
    setUndoStack([]);
    setRollAnimationKey(0);
  }

  function resetSyncRuntime() {
    hostTransportRef.current?.close();
    joinTransportRef.current?.close();
    pendingHostTransferRef.current?.transport.close();
    pendingJoinTransferRef.current?.transport.close();
    hostTransportRef.current = null;
    joinTransportRef.current = null;
    pendingHostTransferRef.current = null;
    pendingJoinTransferRef.current = null;
    setSyncRole(null);
    setSyncPhase("idle");
    setSyncHostPlayerId(null);
    setSyncReadyPayloads([]);
    setSyncQrText("");
    setSyncAnswerText("");
    setSyncCameraMode(null);
    setSyncMessage("");
  }

  function beginHostSync() {
    const name = syncName.trim();

    if (!name) {
      return;
    }

    const hostPlayer = { id: createId(), name };
    const roomId = createId();
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
    setSyncTurnId(nextTurnId());
    setSyncReadyPayloads([]);
    resetPlayState([hostPlayer], hostPlayer.id);
    void createHostOffer();
  }

  async function createHostOffer() {
    const hostTransport = hostTransportRef.current;

    if (!hostTransport) {
      return;
    }

    setSyncMessage("Creating QR");
    try {
      setSyncQrText(await hostTransport.createOffer());
      setSyncMessage("");
    } catch (error) {
      setSyncMessage(error instanceof Error ? error.message : "Could not create QR");
    }
  }

  async function acceptJoinAnswer(value: string) {
    const hostTransport = hostTransportRef.current;

    if (!hostTransport || syncRole !== "host") {
      return;
    }

    setSyncCameraMode(null);
    try {
      const joinedPlayer = await hostTransport.acceptAnswer(value);
      setGamePlayers((currentPlayers) => {
        if (currentPlayers.some((player) => player.id === joinedPlayer.id)) {
          return currentPlayers;
        }

        const nextPlayers = [...currentPlayers, joinedPlayer];
        hostTransport.broadcast({ type: "lobbyState", players: nextPlayers, hostPlayerId: syncHostPlayerIdRef.current });
        return nextPlayers;
      });
      setSyncMessage(`${joinedPlayer.name} joined`);
      await createHostOffer();
    } catch (error) {
      setSyncMessage(error instanceof Error ? error.message : "Could not accept answer");
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
    setSyncMessage("Creating answer");
    try {
      const answer = await joinTransport.createAnswer(value, localPlayer);
      hostTransportRef.current?.close();
      hostTransportRef.current = null;
      joinTransportRef.current = joinTransport;
      localStorage.removeItem(ACTIVE_GAME_KEY);
      setMode("sync");
      setSyncRole("joiner");
      setSyncPhase("showAnswer");
      setSyncHostPlayerId(answer.hostPlayerId);
      setSyncAnswerText(answer.answerText);
      setSyncTurnId(nextTurnId());
      setSyncReadyPayloads([]);
      resetPlayState(
        [
          { id: answer.hostPlayerId, name: answer.hostName },
          localPlayer,
        ],
        localPlayer.id,
      );
      setSyncMessage("Show this QR to the host");
    } catch (error) {
      joinTransport.close();
      setSyncMessage(error instanceof Error ? error.message : "Could not join");
    }
  }

  function broadcastLobbyState(nextPlayers = gamePlayersRef.current) {
    hostTransportRef.current?.broadcast({
      type: "lobbyState",
      players: nextPlayers,
      hostPlayerId: syncHostPlayerIdRef.current,
    });
  }

  function handleHostMessage(playerId: string, message: SyncWireMessage) {
    if (message.type === "join") {
      broadcastLobbyState();
      return;
    }

    if (message.type === "hostTransferOffer") {
      void handleTransferOffer(message);
      return;
    }

    if (message.type === "hostTransferAnswer") {
      const targetNewHostId = typeof message.targetNewHostId === "string" ? message.targetNewHostId : "";
      hostTransportRef.current?.sendTo(targetNewHostId, message);
      return;
    }

    if (message.type === "hostTransferReady") {
      completeHostTransferFromOldHost(playerId, message);
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
      const hostId = typeof message.hostPlayerId === "string" ? message.hostPlayerId : syncHostPlayerId;

      if (nextPlayers.length > 0) {
        setGamePlayers(nextPlayers);
      }

      setSyncHostPlayerId(hostId);
      setSyncPhase("lobby");
      return;
    }

    if (message.type === "hostTransferStart") {
      void beginTakingHostTransfer(message);
      return;
    }

    if (message.type === "hostTransferOffer") {
      void handleTransferOffer(message);
      return;
    }

    if (message.type === "hostTransferAnswer") {
      void handleTransferAnswer(message);
      return;
    }

    if (message.type === "hostTransferComplete") {
      completeHostTransferLocally(message);
      return;
    }

    if (message.type === "gameStart") {
      const nextPlayers = normalizePlayers(message.players);
      const turnId = typeof message.turnId === "string" ? message.turnId : nextTurnId();

      if (nextPlayers.length === 0) {
        return;
      }

      setMode("sync");
      setPage("play");
      setGamePlayers(nextPlayers);
      setCurrentPlayerIndex(0);
      setRows(createEmptyRows());
      setPenalties(0);
      setTurn(createEmptyTurn());
      setGameOver(false);
      setGameOverReason(null);
      setSyncTurnId(turnId);
      setSyncReadyPayloads([]);
      setSyncPhase("turn");
      setRollAnimationKey(0);
      return;
    }

    if (message.type === "rollResult") {
      const roll = normalizeRoll(message.roll);

      if (!roll || message.turnId !== syncTurnIdRef.current) {
        return;
      }

      setTurn((currentTurn) => ({ ...createEmptyTurn(), roll, history: currentTurn.history }));
      setRollAnimationKey((key) => key + 1);
      return;
    }

    if (message.type === "readyStatus") {
      const payloads = Array.isArray(message.payloads)
        ? message.payloads.map(normalizeReadyPayload).filter((payload): payload is SyncReadyPayload => Boolean(payload))
        : [];

      setSyncReadyPayloads(payloads);
      setSyncPhase(message.phase === "readyToAdvance" ? "readyToAdvance" : "turn");
      return;
    }

    if (message.type === "advanceResult") {
      applySyncAdvanceResult(message);
      return;
    }

    if (message.type === "playerRemoved") {
      const playerId = typeof message.playerId === "string" ? message.playerId : "";

      if (playerId === selectedPlayerIdRef.current) {
        endSyncSession("Removed");
        return;
      }

      const nextPlayers = normalizePlayers(message.players);
      if (nextPlayers.length > 0) {
        setGamePlayers(nextPlayers);
      }

      if (message.discardTurn === true) {
        discardSyncTurn(typeof message.turnId === "string" ? message.turnId : nextTurnId(), Number(message.currentPlayerIndex) || 0);
      }
      return;
    }

    if (message.type === "hostStartOver") {
      const nextPlayers = normalizePlayers(message.players);
      const turnId = typeof message.turnId === "string" ? message.turnId : nextTurnId();
      startSyncedPlay(nextPlayers.length > 0 ? nextPlayers : gamePlayersRef.current, turnId);
      return;
    }

    if (message.type === "sessionEnded") {
      endSyncSession("Ended");
    }
  }

  function handleHostPeerClosed(playerId: string) {
    if (syncRoleRef.current !== "host") {
      return;
    }

    removeSyncPlayer(playerId);
  }

  function canTransferHost() {
    return syncRoleRef.current === "host" && (syncPhaseRef.current === "hostLobby" || syncPhaseRef.current === "readyToAdvance");
  }

  function transferHost(nextHostPlayerId: string) {
    if (!canTransferHost() || nextHostPlayerId === selectedPlayerIdRef.current) {
      return;
    }

    const nextHost = gamePlayersRef.current.find((player) => player.id === nextHostPlayerId);

    if (!nextHost) {
      return;
    }

    const transferId = createId();

    setSyncMessage(`Transferring to ${nextHost.name}`);
    hostTransportRef.current?.sendTo(nextHostPlayerId, {
      type: "hostTransferStart",
      currentPlayerIndex: currentPlayerIndexRef.current,
      hostPlayerId: nextHostPlayerId,
      phase: syncPhaseRef.current,
      players: gamePlayersRef.current,
      readyPayloads: syncReadyPayloadsRef.current,
      transferId,
      turnId: syncTurnIdRef.current,
    });
  }

  async function beginTakingHostTransfer(message: SyncWireMessage) {
    const transferId = typeof message.transferId === "string" ? message.transferId : "";
    const nextHostPlayerId = typeof message.hostPlayerId === "string" ? message.hostPlayerId : "";
    const nextPlayers = normalizePlayers(message.players);

    if (!transferId || nextHostPlayerId !== selectedPlayerIdRef.current || nextPlayers.length === 0) {
      return;
    }

    const localPlayer = nextPlayers.find((player) => player.id === nextHostPlayerId);

    if (!localPlayer) {
      return;
    }

    const hostTransport = new SyncHostTransport({
      callbacks: {
        onMessage: handleHostMessage,
        onPeerClosed: handleHostPeerClosed,
      },
      hostName: localPlayer.name,
      hostPlayerId: localPlayer.id,
      roomId: transferId,
    });
    const expectedPlayerIds = nextPlayers.filter((player) => player.id !== localPlayer.id).map((player) => player.id);

    pendingHostTransferRef.current?.transport.close();
    pendingHostTransferRef.current = {
      transferId,
      transport: hostTransport,
      expectedPlayerIds,
      acceptedPlayerIds: [],
    };
    setSyncMessage("Taking host");

    for (const targetPlayerId of expectedPlayerIds) {
      const offerText = await hostTransport.createOffer();
      joinTransportRef.current?.send({
        type: "hostTransferOffer",
        hostPlayerId: localPlayer.id,
        offerText,
        targetPlayerId,
        transferId,
      });
    }
  }

  async function handleTransferOffer(message: SyncWireMessage) {
    const transferId = typeof message.transferId === "string" ? message.transferId : "";
    const targetPlayerId = typeof message.targetPlayerId === "string" ? message.targetPlayerId : "";
    const nextHostPlayerId = typeof message.hostPlayerId === "string" ? message.hostPlayerId : "";
    const offerText = typeof message.offerText === "string" ? message.offerText : "";
    const localPlayerId = selectedPlayerIdRef.current;
    const localPlayer = gamePlayersRef.current.find((player) => player.id === localPlayerId);

    if (!transferId || !targetPlayerId || !nextHostPlayerId || !offerText) {
      return;
    }

    if (targetPlayerId !== localPlayerId) {
      hostTransportRef.current?.sendTo(targetPlayerId, message);
      return;
    }

    if (!localPlayer) {
      return;
    }

    const joinTransport = new SyncJoinTransport({
      onClosed: () => endSyncSession("Host disconnected"),
      onMessage: handleJoinerMessage,
      onOpen: () => setSyncMessage("Transfer connected"),
    });

    try {
      const answer = await joinTransport.createAnswer(offerText, localPlayer);
      pendingJoinTransferRef.current?.transport.close();
      pendingJoinTransferRef.current = { transferId, transport: joinTransport };

      if (syncRoleRef.current === "host") {
        hostTransportRef.current?.sendTo(nextHostPlayerId, {
          type: "hostTransferAnswer",
          answerText: answer.answerText,
          fromPlayerId: localPlayer.id,
          targetNewHostId: nextHostPlayerId,
          transferId,
        });
      } else {
        joinTransportRef.current?.send({
          type: "hostTransferAnswer",
          answerText: answer.answerText,
          fromPlayerId: localPlayer.id,
          targetNewHostId: nextHostPlayerId,
          transferId,
        });
      }
    } catch (error) {
      joinTransport.close();
      setSyncMessage(error instanceof Error ? error.message : "Transfer failed");
    }
  }

  async function handleTransferAnswer(message: SyncWireMessage) {
    const transfer = pendingHostTransferRef.current;
    const transferId = typeof message.transferId === "string" ? message.transferId : "";
    const fromPlayerId = typeof message.fromPlayerId === "string" ? message.fromPlayerId : "";
    const answerText = typeof message.answerText === "string" ? message.answerText : "";

    if (!transfer || transfer.transferId !== transferId || !fromPlayerId || !answerText) {
      return;
    }

    try {
      await transfer.transport.acceptAnswer(answerText);

      if (!transfer.acceptedPlayerIds.includes(fromPlayerId)) {
        transfer.acceptedPlayerIds.push(fromPlayerId);
      }

      if (transfer.expectedPlayerIds.every((playerId) => transfer.acceptedPlayerIds.includes(playerId))) {
        joinTransportRef.current?.send({
          type: "hostTransferReady",
          newHostPlayerId: selectedPlayerIdRef.current,
          transferId,
        });
      }
    } catch (error) {
      setSyncMessage(error instanceof Error ? error.message : "Transfer failed");
    }
  }

  function completeHostTransferFromOldHost(newHostPlayerId: string, message: SyncWireMessage) {
    const transferId = typeof message.transferId === "string" ? message.transferId : "";

    if (!canTransferHost() || !transferId || newHostPlayerId !== message.newHostPlayerId) {
      return;
    }

    const completeMessage: SyncWireMessage = {
      type: "hostTransferComplete",
      currentPlayerIndex: currentPlayerIndexRef.current,
      hostPlayerId: newHostPlayerId,
      phase: syncPhaseRef.current,
      players: gamePlayersRef.current,
      readyPayloads: syncReadyPayloadsRef.current,
      transferId,
      turnId: syncTurnIdRef.current,
    };

    hostTransportRef.current?.broadcast(completeMessage);
    window.setTimeout(() => completeHostTransferLocally(completeMessage), 150);
  }

  function completeHostTransferLocally(message: SyncWireMessage) {
    const transferId = typeof message.transferId === "string" ? message.transferId : "";
    const nextHostPlayerId = typeof message.hostPlayerId === "string" ? message.hostPlayerId : "";
    const nextPlayers = normalizePlayers(message.players);
    const nextReadyPayloads = Array.isArray(message.readyPayloads)
      ? message.readyPayloads.map(normalizeReadyPayload).filter((payload): payload is SyncReadyPayload => Boolean(payload))
      : [];
    const nextPhase =
      message.phase === "hostLobby" || message.phase === "readyToAdvance" || message.phase === "turn"
        ? message.phase
        : syncPhaseRef.current;
    const nextTurn = typeof message.turnId === "string" ? message.turnId : syncTurnIdRef.current;
    const nextIndex = Number(message.currentPlayerIndex);
    const localPlayerId = selectedPlayerIdRef.current;

    if (!transferId || !nextHostPlayerId || nextPlayers.length === 0) {
      return;
    }

    const localIsNewHost = localPlayerId === nextHostPlayerId;
    const displayedPhase = !localIsNewHost && nextPhase === "hostLobby" ? "lobby" : nextPhase;

    setSyncHostPlayerId(nextHostPlayerId);
    setGamePlayers(nextPlayers);
    setCurrentPlayerIndex(Number.isInteger(nextIndex) ? nextIndex : currentPlayerIndexRef.current);
    setSyncTurnId(nextTurn);
    setSyncReadyPayloads(nextReadyPayloads);
    setSyncPhase(displayedPhase);

    if (localIsNewHost) {
      const transfer = pendingHostTransferRef.current;

      if (transfer?.transferId === transferId) {
        hostTransportRef.current = transfer.transport;
        pendingHostTransferRef.current = null;
      }

      joinTransportRef.current?.close();
      joinTransportRef.current = null;
      setSyncRole("host");
      setSyncMessage("You are host");
      return;
    }

    const joinTransfer = pendingJoinTransferRef.current;

    if (joinTransfer?.transferId === transferId) {
      joinTransportRef.current?.close();
      joinTransportRef.current = joinTransfer.transport;
      pendingJoinTransferRef.current = null;
    }

    if (syncRoleRef.current === "host") {
      window.setTimeout(() => {
        hostTransportRef.current?.close();
        hostTransportRef.current = null;
      }, 300);
    }

    setSyncRole("joiner");
    setSyncMessage(`${nextPlayers.find((player) => player.id === nextHostPlayerId)?.name ?? "New host"} is host`);
  }

  function startSyncedPlay(nextPlayers: Player[], turnId: string) {
    setMode("sync");
    setPage("play");
    setGamePlayers(nextPlayers);
    setCurrentPlayerIndex(0);
    setRows(createEmptyRows());
    setPenalties(0);
    setTurn(createEmptyTurn());
    setGameOver(false);
    setGameOverReason(null);
    setUndoStack([]);
    setSyncTurnId(turnId);
    setSyncReadyPayloads([]);
    setSyncPhase("turn");
    setRollAnimationKey(0);
  }

  function startSyncGame() {
    if (!isHost || gamePlayers.length === 0) {
      return;
    }

    const turnId = nextTurnId();

    startSyncedPlay(gamePlayers, turnId);
    hostTransportRef.current?.broadcast({
      type: "gameStart",
      players: gamePlayers,
      turnId,
    });
  }

  function handleSyncRollRequest(playerId: string, message: SyncWireMessage) {
    const currentPlayers = gamePlayersRef.current;
    const currentPlayer = currentPlayers[currentPlayerIndexRef.current];

    if (
      syncPhaseRef.current !== "turn" ||
      !currentPlayer ||
      currentPlayer.id !== playerId ||
      message.turnId !== syncTurnIdRef.current ||
      turnRef.current.roll
    ) {
      return;
    }

    const roll = rollDice(rowsRef.current);

    setTurn((currentTurn) => ({ ...currentTurn, roll }));
    setRollAnimationKey((key) => key + 1);
    hostTransportRef.current?.broadcast({
      type: "rollResult",
      turnId: syncTurnIdRef.current,
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
    const currentPlayers = gamePlayersRef.current;
    const activePayloads = nextPayloads.filter((payload) =>
      currentPlayers.some((player) => player.id === payload.playerId),
    );
    const allReady =
      currentPlayers.length > 0 &&
      currentPlayers.every((player) =>
        activePayloads.some((payload) => payload.playerId === player.id && payload.turnId === syncTurnIdRef.current),
      );
    const nextPhase: SyncPhase = allReady ? "readyToAdvance" : "turn";

    syncReadyPayloadsRef.current = activePayloads;
    setSyncReadyPayloads(activePayloads);
    setSyncPhase(nextPhase);
    hostTransportRef.current?.broadcast({
      type: "readyStatus",
      phase: nextPhase,
      payloads: activePayloads,
    });
  }

  function handleSyncReadyMessage(value: unknown) {
    const payload = normalizeReadyPayload(value);

    if (!payload || payload.turnId !== syncTurnIdRef.current) {
      return;
    }

    setHostReadyPayloads([
      ...syncReadyPayloadsRef.current.filter((currentPayload) => currentPayload.playerId !== payload.playerId),
      payload,
    ]);
  }

  function readySyncTurn() {
    if (!readyEnabled || !selectedPlayerId) {
      return;
    }

    const payload = createReadyPayload(syncTurnId, selectedPlayerId, penalties, turn);

    if (isHost) {
      setHostReadyPayloads([
        ...syncReadyPayloadsRef.current.filter((currentPayload) => currentPayload.playerId !== selectedPlayerId),
        payload,
      ]);
      return;
    }

    setSyncReadyPayloads((currentPayloads) => [
      ...currentPayloads.filter((currentPayload) => currentPayload.playerId !== selectedPlayerId),
      payload,
    ]);
    joinTransportRef.current?.send({
      type: "ready",
      payload,
    });
  }

  function applySyncAdvanceResult(message: SyncWireMessage) {
    const closedRows = Array.isArray(message.closedRows) ? uniqueRows(message.closedRows.filter(isRowColor)) : [];
    const nextPlayers = normalizePlayers(message.players);
    const nextIndex = Number(message.currentPlayerIndex);
    const nextTurn = typeof message.nextTurnId === "string" ? message.nextTurnId : nextTurnId();
    const nextGameOver = message.gameOver === true;
    const nextReason = normalizeGameOverReason(message.gameOverReason);
    const committed = commitLocalTurnState(rowsRef.current, penalties, turnRef.current);
    const withGlobalClosures = applyGlobalClosedRows(committed.rows, closedRows);
    const localReason = committed.penalties >= MAX_PENALTIES ? "ownPenalties" : nextReason;

    setRows(withGlobalClosures);
    setPenalties(committed.penalties);
    setGameOver(nextGameOver);
    setGameOverReason(localReason);
    setGamePlayers(nextPlayers.length > 0 ? nextPlayers : gamePlayersRef.current);
    setCurrentPlayerIndex(Number.isInteger(nextIndex) ? nextIndex : 0);
    setTurn(createEmptyTurn());
    setSyncTurnId(nextTurn);
    setSyncReadyPayloads([]);
    setSyncPhase(nextGameOver ? "gameOver" : "turn");
    setRollAnimationKey(0);
  }

  function advanceSyncTurn() {
    if (!advanceEnabled) {
      return;
    }

    const closedRows = uniqueRows(syncReadyPayloads.flatMap((payload) => payload.closedRows));
    const committed = commitLocalTurnState(rows, penalties, turn);
    const withGlobalClosures = applyGlobalClosedRows(committed.rows, closedRows);
    const anyPenaltyGameOver = syncReadyPayloads.some((payload) => payload.reachedFourPenalties);
    const rowPenaltyState = getGameOverFromRowsAndPenalties(
      withGlobalClosures,
      committed.penalties,
      anyPenaltyGameOver ? "opponentPenalties" : null,
    );
    const nextGameOver = rowPenaltyState.gameOver;
    const nextReason = rowPenaltyState.gameOverReason;
    const nextIndex = nextGameOver ? currentPlayerIndex : (currentPlayerIndex + 1) % gamePlayers.length;
    const nextTurn = nextTurnId();

    setRows(withGlobalClosures);
    setPenalties(committed.penalties);
    setGameOver(nextGameOver);
    setGameOverReason(nextReason);
    setCurrentPlayerIndex(nextIndex);
    setTurn(createEmptyTurn());
    setSyncTurnId(nextTurn);
    setSyncReadyPayloads([]);
    setSyncPhase(nextGameOver ? "gameOver" : "turn");
    setRollAnimationKey(0);
    hostTransportRef.current?.broadcast({
      type: "advanceResult",
      closedRows,
      currentPlayerIndex: nextIndex,
      gameOver: nextGameOver,
      gameOverReason: nextReason,
      nextTurnId: nextTurn,
      players: gamePlayers,
    });
  }

  function discardSyncTurn(turnId: string, nextIndex: number) {
    setCurrentPlayerIndex(nextIndex);
    setTurn(createEmptyTurn());
    setSyncTurnId(turnId);
    setSyncReadyPayloads([]);
    setSyncPhase("turn");
    setRollAnimationKey(0);
  }

  function removeSyncPlayer(playerId: string) {
    if (syncRoleRef.current !== "host" || !playerId) {
      return;
    }

    const currentPlayers = gamePlayersRef.current;
    const removedIndex = currentPlayers.findIndex((player) => player.id === playerId);

    if (removedIndex < 0) {
      return;
    }

    const currentPlayer = currentPlayers[currentPlayerIndexRef.current];
    const nextPlayers = currentPlayers.filter((player) => player.id !== playerId);

    if (nextPlayers.length === 0) {
      hostTransportRef.current?.removePeer(playerId);
      endSyncSession("Ended");
      hostTransportRef.current?.broadcast({ type: "sessionEnded" });
      return;
    }

    const currentPlayerRemoved = currentPlayer?.id === playerId;
    const nextIndex = currentPlayerRemoved
      ? currentPlayerIndexRef.current % nextPlayers.length
      : Math.max(0, currentPlayerIndexRef.current - (removedIndex < currentPlayerIndexRef.current ? 1 : 0));
    const nextTurn = currentPlayerRemoved ? nextTurnId() : syncTurnIdRef.current;

    gamePlayersRef.current = nextPlayers;
    currentPlayerIndexRef.current = nextIndex;
    hostTransportRef.current?.removePeer(playerId);
    setGamePlayers(nextPlayers);
    setCurrentPlayerIndex(nextIndex);
    setSyncReadyPayloads((payloads) => payloads.filter((payload) => payload.playerId !== playerId));

    if (currentPlayerRemoved) {
      discardSyncTurn(nextTurn, nextIndex);
    } else {
      setHostReadyPayloads(syncReadyPayloadsRef.current.filter((payload) => payload.playerId !== playerId));
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
    resetSyncRuntime();
    localStorage.removeItem(ACTIVE_GAME_KEY);
    setMode("sync");
    setPage("home");
    setHomeTab("sync");
    setGamePlayers([]);
    setCurrentPlayerIndex(0);
    setRows(createEmptyRows());
    setPenalties(0);
    setTurn(createEmptyTurn());
    setGameOver(false);
    setGameOverReason(null);
    setUndoStack([]);
    setSyncMessage(message);
  }

  function startOver() {
    if (!selectedPlayerId || gamePlayers.length === 0 || (mode === "sync" && !isHost)) {
      return;
    }

    setConfirmAction("startOver");
  }

  function confirmStartOver() {
    if (!selectedPlayerId || gamePlayers.length === 0) {
      return;
    }

    setConfirmAction(null);

    if (mode === "sync" && isHost) {
      const nextTurn = nextTurnId();

      startSyncedPlay(gamePlayers, nextTurn);
      hostTransportRef.current?.broadcast({
        type: "hostStartOver",
        players: gamePlayers,
        turnId: nextTurn,
      });
      return;
    }

    startGame(gamePlayers, selectedPlayerId);
  }

  function exitToHome() {
    if (mode === "sync" && isHost && gamePlayers.length > 1) {
      setSyncMessage("Transfer host before exiting");
      return;
    }

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
    setGamePlayers([]);
    setCurrentPlayerIndex(0);
    setRows(createEmptyRows());
    setPenalties(0);
    setTurn(createEmptyTurn());
    setGameOver(false);
    setGameOverReason(null);
    setUndoStack([]);
    setRollAnimationKey(0);
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
        roll: rollDice(rows),
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
      const currentLegalMarks = getLegalMarkKeys({
        rows,
        turn: currentTurn,
        isUserTurn,
        mode,
        gameOver: gameOver || isLocalReady,
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

    if (!canStageOpponentLock(row, rows, turn, diceStageDone, gameOver)) {
      return;
    }

    setTurn((currentTurn) => {
      if (!canStageOpponentLock(row, rows, currentTurn, Boolean(getWhiteSum(currentTurn, isUserTurn, mode)), gameOver)) {
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

    const committed = commitLocalTurnState(rows, penalties, turn);
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

                <button
                  className="primary wide-button start-button"
                  type="button"
                  onClick={() => selectedPlayerId && startGame(players, selectedPlayerId)}
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
                <SyncLobby
                  isHost
                  players={gamePlayers}
                  localPlayerId={selectedPlayerId}
                  readyPlayerIds={[]}
                  syncMessage={syncMessage}
                  onCreateOffer={createHostOffer}
                  onRandomize={() => {
                    setGamePlayers((currentPlayers) => {
                      const nextPlayers = shufflePlayers(currentPlayers);
                      broadcastLobbyState(nextPlayers);
                      return nextPlayers;
                    });
                  }}
                  onMove={(fromIndex, toIndex) => {
                    setGamePlayers((currentPlayers) => {
                      if (toIndex < 0 || toIndex >= currentPlayers.length) {
                        return currentPlayers;
                      }

                      const nextPlayers = moveItem(currentPlayers, fromIndex, toIndex);
                      broadcastLobbyState(nextPlayers);
                      return nextPlayers;
                    });
                  }}
                  onRemove={removeSyncPlayer}
                  onScanAnswer={() => setSyncCameraMode("answer")}
                  onStart={startSyncGame}
                  onTransfer={transferHost}
                />
              ) : null}

              {syncRole === "host" && syncPhase === "hostLobby" && syncQrText ? (
                <QrPanel label="Host QR" text={syncQrText} />
              ) : null}

              {syncRole === "joiner" && (syncPhase === "showAnswer" || syncPhase === "lobby") ? (
                <>
                  {syncAnswerText ? <QrPanel label="Answer QR" text={syncAnswerText} /> : null}
                  <SyncLobby
                    isHost={false}
                    players={gamePlayers}
                    localPlayerId={selectedPlayerId}
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
                  onClick={() => setShowHints((currentShowHints) => !currentShowHints)}
                  aria-label={showHints ? "Hide legal options" : "Show legal options"}
                >
                  {showHints ? <Eye size={19} /> : <EyeOff size={19} />}
                </button>
              </div>
            </div>

            <div className="turn-title">
              <h1>{currentPlayer.name}</h1>
              {isUserTurn ? <Star size={18} fill="currentColor" aria-label="Your turn" /> : null}
            </div>

            {mode === "sync" ? (
              <div className="sync-play-strip">
                <span>{syncPhase === "readyToAdvance" ? "Ready" : isLocalReady ? "Done" : "Sync"}</span>
                <span>
                  {readyPlayerIds.length}/{gamePlayers.length}
                </span>
              </div>
            ) : null}

            <DiceGrid
              rows={rows}
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
              onClick={mode === "sync" ? (syncPhase === "readyToAdvance" ? advanceSyncTurn : readySyncTurn) : commitTurn}
              disabled={mode === "sync" ? (syncPhase === "readyToAdvance" ? !advanceEnabled : !readyEnabled) : !nextEnabled}
              aria-label={mode === "sync" ? (syncPhase === "readyToAdvance" ? "Advance" : "Ready") : "Next"}
            >
              {mode === "sync" && syncPhase !== "readyToAdvance" ? <Check size={23} /> : <ArrowRight size={23} />}
            </button>
          </div>

          {mode === "sync" ? (
            <SyncLobby
              compact
              isHost={isHost}
              players={gamePlayers}
              localPlayerId={selectedPlayerId}
              readyPlayerIds={readyPlayerIds}
              syncMessage={syncMessage}
              onRemove={isHost ? removeSyncPlayer : undefined}
              onTransfer={isHost && syncPhase === "readyToAdvance" ? transferHost : undefined}
            />
          ) : null}

          <section className="score-card" aria-label="Score card">
            <div className="score-rows">
              {ROW_COLORS.map((row) => (
                <ScoreRow
                  key={row}
                  row={row}
                  rows={rows}
                  turn={turn}
                  legalMarkKeys={legalMarkKeys}
                  legalMarkRoles={legalMarkRoles}
                  showHints={showHints}
                  canLock={mode === "local" && canStageOpponentLock(row, rows, turn, diceStageDone, gameOver)}
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
              ) : null}
            </div>

            <div className="score-guide" aria-label="Scoring guide">
              {SCORE_VALUES.slice(1).map((score, index) => (
                <span key={score}>
                  {index + 1}x {score}
                </span>
              ))}
            </div>

            <ScoreTotals rows={rows} penalties={penalties} turn={turn} totalScore={totalScore} />
          </section>
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
  isHost,
  localPlayerId,
  onCreateOffer,
  onMove,
  onRandomize,
  onRemove,
  onScanAnswer,
  onStart,
  onTransfer,
  players,
  readyPlayerIds,
  syncMessage,
}: {
  compact?: boolean;
  isHost: boolean;
  localPlayerId: string | null;
  onCreateOffer?: () => void;
  onMove?: (fromIndex: number, toIndex: number) => void;
  onRandomize?: () => void;
  onRemove?: (playerId: string) => void;
  onScanAnswer?: () => void;
  onStart?: () => void;
  onTransfer?: (playerId: string) => void;
  players: Player[];
  readyPlayerIds: string[];
  syncMessage: string;
}) {
  return (
    <div className={compact ? "sync-lobby compact" : "sync-lobby"}>
      <div className="sync-lobby-list">
        {players.map((player, index) => (
          <div className="sync-player-row" key={player.id}>
            <span className="sync-player-icon">
              {index === 0 ? <Crown size={16} /> : readyPlayerIds.includes(player.id) ? <Check size={16} /> : <Users size={16} />}
            </span>
            <span>{player.name}</span>
            {player.id === localPlayerId ? <Star size={15} fill="currentColor" /> : null}
            {isHost && !compact && onMove ? (
              <span className="sync-move-buttons">
                <button
                  className="icon-button"
                  type="button"
                  onClick={() => onMove(index, index - 1)}
                  disabled={index === 0}
                  aria-label={`Move ${player.name} up`}
                >
                  <ChevronUp size={14} />
                </button>
                <button
                  className="icon-button"
                  type="button"
                  onClick={() => onMove(index, index + 1)}
                  disabled={index === players.length - 1}
                  aria-label={`Move ${player.name} down`}
                >
                  <ChevronDown size={14} />
                </button>
              </span>
            ) : null}
            {isHost && onTransfer && player.id !== localPlayerId ? (
              <button
                className="icon-button"
                type="button"
                onClick={() => onTransfer(player.id)}
                aria-label={`Transfer host to ${player.name}`}
              >
                <Crown size={15} />
              </button>
            ) : null}
            {isHost && onRemove && player.id !== localPlayerId ? (
              <button className="icon-button danger" type="button" onClick={() => onRemove(player.id)} aria-label={`Remove ${player.name}`}>
                <UserMinus size={15} />
              </button>
            ) : null}
          </div>
        ))}
      </div>

      {isHost && !compact ? (
        <div className="sync-control-row">
          <button className="secondary" type="button" onClick={onCreateOffer}>
            <UserPlus size={18} />
            Add
          </button>
          <button className="secondary" type="button" onClick={onScanAnswer}>
            <ScanLine size={18} />
            Scan
          </button>
          <button className="secondary" type="button" onClick={onRandomize} disabled={players.length < 2}>
            <Shuffle size={18} />
            Randomize
          </button>
          <button className="primary" type="button" onClick={onStart} disabled={players.length === 0}>
            Start
          </button>
        </div>
      ) : null}

      {syncMessage ? <p className="sync-status">{syncMessage}</p> : null}
    </div>
  );
}

function QrPanel({ label, text }: { label: string; text: string }) {
  const [image, setImage] = useState("");

  useEffect(() => {
    let alive = true;

    QRCode.toDataURL(text, { errorCorrectionLevel: "L", margin: 3, width: 380 })
      .then((nextImage) => {
        if (alive) {
          setImage(nextImage);
        }
      })
      .catch(() => {
        if (alive) {
          setImage("");
        }
      });

    return () => {
      alive = false;
    };
  }, [text]);

  return (
    <div className="qr-panel">
      <span>{label}</span>
      {image ? <img src={image} alt={label} /> : <div className="qr-placeholder" />}
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
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  useEffect(() => {
    let frame = 0;
    let stream: MediaStream | null = null;
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
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const context = canvas.getContext("2d", { willReadFrequently: true });

        if (context) {
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          const image = context.getImageData(0, 0, canvas.width, canvas.height);
          const code = await readQrCode(canvas, image);

          if (code) {
            scannedRef.current = true;
            onScan(code);
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
        {error ? <p className="sync-status">{error}</p> : null}
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
}: {
  enabled: boolean;
  onRoll: () => void;
  pale: boolean;
  roll: DiceRoll | null;
  rollAnimationKey: number;
  rows: RowsState;
}) {
  return (
    <button className={pale ? "dice-grid pale" : "dice-grid"} type="button" onClick={onRoll} disabled={!enabled} aria-label="Roll dice">
      {DICE_LAYOUT.map((die) => {
        if (isRowColor(die.key) && rows[die.key].lock !== "none") {
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

function ScoreRow({
  canLock,
  gameOver,
  legalMarkKeys,
  legalMarkRoles,
  onSelectMark,
  onStageOpponentLock,
  row,
  rows,
  showHints,
  turn,
}: {
  canLock: boolean;
  gameOver: boolean;
  legalMarkKeys: Set<string>;
  legalMarkRoles: Map<string, Set<MarkRole>>;
  onSelectMark: (mark: ScoreMark) => void;
  onStageOpponentLock: (row: RowColor) => void;
  row: RowColor;
  rows: RowsState;
  showHints: boolean;
  turn: TurnDraft;
}) {
  const config = ROW_CONFIGS[row];
  const ownLock = rows[row].lock === "own" || hasStagedOwnLock(row, turn);
  const opponentLock = rows[row].lock === "opponent" || turn.opponentLocks.includes(row);
  const closed = rows[row].lock !== "none";

  return (
    <div className={`score-row ${row} ${closed ? "closed" : ""}`}>
      {config.numbers.map((number) => {
        const mark: ScoreMark = { row, number };
        const key = markKey(mark);
        const selected =
          rows[row].selected.includes(number) ||
          turn.selectedMarks.some((selectedMark) => markKey(selectedMark) === key);
        const legal = legalMarkKeys.has(key);
        const roles = legalMarkRoles.get(key);
        const whiteHint = showHints && Boolean(roles?.has("white"));
        const mixedHint = showHints && Boolean(roles?.has("mixed"));
        return (
          <button
            className={[
              "score-tile",
              selected ? "selected" : "",
              legal ? "legal" : "",
              whiteHint ? "hint-white" : "",
              mixedHint ? "hint-mixed" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            key={number}
            type="button"
            onClick={() => onSelectMark(mark)}
            disabled={!legal || gameOver}
            aria-label={`${config.label} ${number}`}
          >
            <span>{number}</span>
          </button>
        );
      })}

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
        aria-label={`${config.label} locked`}
      >
        <Lock size={17} />
      </button>
    </div>
  );
}

function ScoreTotals({
  penalties,
  rows,
  totalScore,
  turn,
}: {
  penalties: number;
  rows: RowsState;
  totalScore: number;
  turn: TurnDraft;
}) {
  return (
    <div className="totals-row" aria-label="Totals">
      {ROW_COLORS.map((row, index) => (
        <span className="total-piece" key={row}>
          {index > 0 ? <span className="operator">+</span> : null}
          <span className={`total-box ${row}`}>{getColorScore(row, rows, turn)}</span>
        </span>
      ))}
      <span className="operator">-</span>
      <span className="total-box penalty">{getPenaltyCount(penalties, turn) * PENALTY_POINTS}</span>
      <span className="operator">=</span>
      <strong className="grand-total">{totalScore}</strong>
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

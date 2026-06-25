import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CARD_COLORS,
  CARD_NUMBERS,
  createStandardRows,
  signatureForCard,
  standardNumbersForRow,
  validateScoreCards,
} from "./score-card-validation.mjs";

const outputPath = fileURLToPath(new URL("../../src/data/scoreCards.json", import.meta.url));
const rng = createRng("qwixx-score-cards-v1");

function createRng(seed) {
  let hash = 2166136261;

  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return function next() {
    hash += 0x6d2b79f5;
    let value = hash;

    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(items) {
  const nextItems = [...items];

  for (let index = nextItems.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [nextItems[index], nextItems[swapIndex]] = [nextItems[swapIndex], nextItems[index]];
  }

  return nextItems;
}

function shuffledNumbers() {
  return shuffle(CARD_NUMBERS);
}

function createRows(numbersByRow, colorsByRow) {
  return CARD_COLORS.map((rowId, rowIndex) => ({
    id: rowId,
    tiles: numbersByRow[rowIndex].map((number, tileIndex) => ({
      number,
      color: colorsByRow[rowIndex][tileIndex],
    })),
  }));
}

function createStandardCard() {
  return {
    id: 1,
    type: "standard",
    rows: createStandardRows(),
  };
}

function createNumbersCard(id) {
  return {
    id,
    type: "numbers",
    rows: CARD_COLORS.map((rowId) => ({
      id: rowId,
      tiles: shuffledNumbers().map((number) => ({
        number,
        color: rowId,
      })),
    })),
  };
}

function createColorsCard(id, colorGrid) {
  return {
    id,
    type: "colors",
    rows: createRows(
      CARD_COLORS.map(standardNumbersForRow),
      colorGrid,
    ),
  };
}

function createNumbersAndColorsCard(id, colorGrid) {
  return {
    id,
    type: "numbersAndColors",
    rows: createRows(
      CARD_COLORS.map(() => shuffledNumbers()),
      colorGrid,
    ),
  };
}

function createUniqueCards(startId, count, createCard) {
  const cards = [];
  const signatures = new Set();

  while (cards.length < count) {
    const card = createCard(startId + cards.length);
    const signature = signatureForCard(card);

    if (signatures.has(signature)) {
      continue;
    }

    signatures.add(signature);
    cards.push(card);
  }

  return cards;
}

function permutations(items) {
  if (items.length === 0) {
    return [[]];
  }

  return items.flatMap((item, index) =>
    permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((tail) => [item, ...tail]),
  );
}

function segmentLengthOrders() {
  const orders = [];

  function walk(parts, total) {
    if (parts.length === 4) {
      if (total === 11) {
        orders.push(parts);
      }
      return;
    }

    for (let length = 2; length <= 4; length += 1) {
      walk([...parts, length], total + length);
    }
  }

  walk([], 0);
  return orders;
}

function createRowCandidates() {
  return permutations(CARD_COLORS).flatMap((colorOrder) =>
    segmentLengthOrders().map((lengthOrder) => {
      const row = [];

      colorOrder.forEach((color, index) => {
        for (let count = 0; count < lengthOrder[index]; count += 1) {
          row.push(color);
        }
      });

      return row;
    }),
  );
}

function enumerateLegalColorGrids() {
  const candidates = createRowCandidates();
  const bitByColor = { red: 1, yellow: 2, green: 4, blue: 8 };
  const colorByBit = new Map(CARD_COLORS.map((color) => [bitByColor[color], color]));
  const candidateMasks = candidates.map((candidate) => candidate.map((color) => bitByColor[color]));
  const candidateKeys = new Set(candidates.map((candidate) => candidate.join("|")));
  const grids = [];

  for (const [firstIndex, first] of candidates.entries()) {
    for (const [secondIndex, second] of candidates.entries()) {
      const used = [];
      let ok = true;

      for (let column = 0; column < 11; column += 1) {
        if (candidateMasks[firstIndex][column] & candidateMasks[secondIndex][column]) {
          ok = false;
          break;
        }

        used[column] = candidateMasks[firstIndex][column] | candidateMasks[secondIndex][column];
      }

      if (!ok) {
        continue;
      }

      for (const [thirdIndex, third] of candidates.entries()) {
        const fourth = [];
        let thirdOk = true;

        for (let column = 0; column < 11; column += 1) {
          if (used[column] & candidateMasks[thirdIndex][column]) {
            thirdOk = false;
            break;
          }

          fourth.push(colorByBit.get(15 ^ (used[column] | candidateMasks[thirdIndex][column])));
        }

        if (thirdOk && candidateKeys.has(fourth.join("|"))) {
          grids.push([first, second, third, fourth]);
        }
      }
    }
  }

  return grids;
}

function takeColorGrids(count) {
  return shuffle(enumerateLegalColorGrids()).slice(0, count);
}

async function main() {
  const colorGrids = takeColorGrids(66);
  const cards = [
    createStandardCard(),
    ...createUniqueCards(2, 33, createNumbersCard),
    ...colorGrids.slice(0, 33).map((grid, index) => createColorsCard(35 + index, grid)),
    ...colorGrids.slice(33).map((grid, index) => createNumbersAndColorsCard(68 + index, grid)),
  ];
  const errors = validateScoreCards(cards);

  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(cards, null, 2)}\n`);
  console.log(`Wrote ${cards.length} score cards to ${outputPath}`);
}

void main();

export const CARD_COLORS = ["red", "yellow", "green", "blue"];
export const CARD_NUMBERS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
export const CARD_TYPES = ["standard", "numbers", "colors", "numbersAndColors"];

const TYPE_RANGES = {
  standard: [1, 1],
  numbers: [2, 34],
  colors: [35, 67],
  numbersAndColors: [68, 100],
};

export function cardTypeForId(id) {
  if (id === 1) {
    return "standard";
  }

  if (id >= 2 && id <= 34) {
    return "numbers";
  }

  if (id >= 35 && id <= 67) {
    return "colors";
  }

  if (id >= 68 && id <= 100) {
    return "numbersAndColors";
  }

  return null;
}

export function standardNumbersForRow(rowId) {
  return rowId === "red" || rowId === "yellow" ? CARD_NUMBERS : [...CARD_NUMBERS].reverse();
}

export function createStandardRows() {
  return CARD_COLORS.map((rowId) => ({
    id: rowId,
    tiles: standardNumbersForRow(rowId).map((number) => ({
      number,
      color: rowId,
    })),
  }));
}

export function signatureForCard(card) {
  return card.rows
    .map((row) => row.tiles.map((tile) => `${tile.number}:${tile.color}`).join("|"))
    .join("/");
}

export function validateScoreCards(cards) {
  const errors = [];

  if (!Array.isArray(cards)) {
    return ["Score cards must be an array."];
  }

  if (cards.length !== 100) {
    errors.push(`Expected 100 cards, found ${cards.length}.`);
  }

  const ids = new Set();
  const signatures = new Map();
  const signaturesByType = new Map(CARD_TYPES.map((type) => [type, new Set()]));

  cards.forEach((card, index) => {
    validateCard(card, index, ids, signatures, signaturesByType, errors);
  });

  for (let id = 1; id <= 100; id += 1) {
    if (!ids.has(id)) {
      errors.push(`Missing card #${id}.`);
    }
  }

  return errors;
}

function validateCard(card, index, ids, signatures, signaturesByType, errors) {
  if (!card || typeof card !== "object") {
    errors.push(`Card at index ${index} must be an object.`);
    return;
  }

  const { id, rows, type } = card;
  const expectedType = cardTypeForId(id);

  if (!Number.isInteger(id) || id < 1 || id > 100) {
    errors.push(`Card at index ${index} has invalid id ${id}.`);
    return;
  }

  if (ids.has(id)) {
    errors.push(`Duplicate card id #${id}.`);
  }
  ids.add(id);

  if (type !== expectedType) {
    errors.push(`Card #${id} type must be ${expectedType}, found ${type}.`);
  }

  if (!CARD_TYPES.includes(type)) {
    errors.push(`Card #${id} has unknown type ${type}.`);
  }

  if (!Array.isArray(rows) || rows.length !== 4) {
    errors.push(`Card #${id} must have four rows.`);
    return;
  }

  const expectedRange = TYPE_RANGES[type];
  if (expectedRange && (id < expectedRange[0] || id > expectedRange[1])) {
    errors.push(`Card #${id} is outside the ${type} range.`);
  }

  rows.forEach((row, rowIndex) => validateRow(card, row, rowIndex, errors));

  if (type === "standard") {
    validateStandardCard(card, errors);
  }

  if (type === "numbers") {
    validateStandardColors(card, errors);
  }

  if (type === "colors") {
    validateStandardNumbers(card, errors);
    validateColorConstraints(card, errors);
  }

  if (type === "numbersAndColors") {
    validateColorConstraints(card, errors);
  }

  const typeSignatures = signaturesByType.get(type);
  const signature = signatureForCard(card);
  const existingId = signatures.get(signature);

  if (existingId) {
    errors.push(`Card #${id} duplicates card #${existingId}.`);
  }
  signatures.set(signature, id);

  if (typeSignatures?.has(signature)) {
    errors.push(`Duplicate ${type} layout at card #${id}.`);
  }
  typeSignatures?.add(signature);
}

function validateRow(card, row, rowIndex, errors) {
  const expectedRowId = CARD_COLORS[rowIndex];

  if (!row || typeof row !== "object") {
    errors.push(`Card #${card.id} row ${rowIndex + 1} must be an object.`);
    return;
  }

  if (row.id !== expectedRowId) {
    errors.push(`Card #${card.id} row ${rowIndex + 1} id must be ${expectedRowId}.`);
  }

  if (!Array.isArray(row.tiles) || row.tiles.length !== 11) {
    errors.push(`Card #${card.id} row ${row.id} must have 11 tiles.`);
    return;
  }

  const numbers = row.tiles.map((tile) => tile?.number);
  const sortedNumbers = [...numbers].sort((left, right) => left - right);

  if (JSON.stringify(sortedNumbers) !== JSON.stringify(CARD_NUMBERS)) {
    errors.push(`Card #${card.id} row ${row.id} must contain numbers 2-12 once.`);
  }

  row.tiles.forEach((tile, tileIndex) => {
    if (!tile || typeof tile !== "object") {
      errors.push(`Card #${card.id} row ${row.id} tile ${tileIndex + 1} must be an object.`);
      return;
    }

    if (!Number.isInteger(tile.number) || tile.number < 2 || tile.number > 12) {
      errors.push(`Card #${card.id} row ${row.id} tile ${tileIndex + 1} has invalid number.`);
    }

    if (!CARD_COLORS.includes(tile.color)) {
      errors.push(`Card #${card.id} row ${row.id} tile ${tileIndex + 1} has invalid color.`);
    }
  });
}

function validateStandardCard(card, errors) {
  validateStandardNumbers(card, errors);
  validateStandardColors(card, errors);
}

function validateStandardNumbers(card, errors) {
  card.rows.forEach((row) => {
    const numbers = row.tiles.map((tile) => tile.number);
    const expected = standardNumbersForRow(row.id);

    if (JSON.stringify(numbers) !== JSON.stringify(expected)) {
      errors.push(`Card #${card.id} row ${row.id} must use standard number order.`);
    }
  });
}

function validateStandardColors(card, errors) {
  card.rows.forEach((row) => {
    if (row.tiles.some((tile) => tile.color !== row.id)) {
      errors.push(`Card #${card.id} row ${row.id} must use standard row color.`);
    }
  });
}

function validateColorConstraints(card, errors) {
  card.rows.forEach((row) => validateRowColorSegments(card, row, errors));

  for (let column = 0; column < 11; column += 1) {
    const colors = card.rows.map((row) => row.tiles[column]?.color).sort();

    if (JSON.stringify(colors) !== JSON.stringify([...CARD_COLORS].sort())) {
      errors.push(`Card #${card.id} column ${column + 1} must contain one of each color.`);
    }
  }
}

function validateRowColorSegments(card, row, errors) {
  const segments = [];

  row.tiles.forEach((tile) => {
    const previous = segments[segments.length - 1];

    if (previous?.color === tile.color) {
      previous.length += 1;
      return;
    }

    segments.push({ color: tile.color, length: 1 });
  });

  if (segments.length !== 4) {
    errors.push(`Card #${card.id} row ${row.id} must have four color segments.`);
  }

  const segmentColors = segments.map((segment) => segment.color).sort();
  if (JSON.stringify(segmentColors) !== JSON.stringify([...CARD_COLORS].sort())) {
    errors.push(`Card #${card.id} row ${row.id} must have one segment per color.`);
  }

  segments.forEach((segment) => {
    if (segment.length < 2 || segment.length > 4) {
      errors.push(`Card #${card.id} row ${row.id} ${segment.color} segment length must be 2-4.`);
    }
  });
}

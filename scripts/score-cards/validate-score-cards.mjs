import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { validateScoreCards } from "./score-card-validation.mjs";

const scoreCardsPath = fileURLToPath(new URL("../../src/data/scoreCards.json", import.meta.url));
const cards = JSON.parse(await readFile(scoreCardsPath, "utf8"));
const errors = validateScoreCards(cards);

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(`Validated ${cards.length} score cards.`);

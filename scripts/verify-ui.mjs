import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import lzString from "lz-string";
import { validateScoreCards } from "./score-cards/score-card-validation.mjs";

const baseUrl = "http://127.0.0.1:5174/";
const outputDir = new URL("../verification-output/", import.meta.url);
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const chromePaths = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];
const { compressToEncodedURIComponent } = lzString;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function outputPath(name) {
  return fileURLToPath(new URL(name, outputDir));
}

async function waitForServer(processHandle) {
  let output = "";

  processHandle.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  processHandle.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });

  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (output.includes("Local:") || output.includes("ready")) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Vite did not start.\n${output}`);
}

async function stopServer(processHandle) {
  if (!processHandle.pid || processHandle.exitCode !== null) {
    return;
  }

  if (process.platform === "win32") {
    await new Promise((resolve) => {
      const killer = spawn("taskkill", ["/pid", String(processHandle.pid), "/T", "/F"], {
        shell: false,
        stdio: "ignore",
      });
      killer.on("exit", resolve);
      killer.on("error", resolve);
    });
    return;
  }

  processHandle.kill("SIGTERM");
}

async function launchBrowser() {
  for (const executablePath of chromePaths) {
    try {
      return await chromium.launch({ executablePath, headless: true });
    } catch {
      // Try the next locally installed browser path.
    }
  }

  return chromium.launch({ headless: true });
}

async function runSourceChecks() {
  const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const styleSource = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  const transportSource = await readFile(new URL("../src/syncTransport.ts", import.meta.url), "utf8");
  const generatorSource = await readFile(new URL("./score-cards/generate-score-cards.mjs", import.meta.url), "utf8");
  const validatorSource = await readFile(new URL("./score-cards/score-card-validation.mjs", import.meta.url), "utf8");
  const scoreCards = JSON.parse(await readFile(new URL("../src/data/scoreCards.json", import.meta.url), "utf8"));
  const scoreCardErrors = validateScoreCards(scoreCards);
  const removedRefs = [
    "rowsRef",
    "turnRef",
    "gamePlayersRef",
    "currentPlayerIndexRef",
    "syncTurnIdRef",
    "syncPhaseRef",
    "syncRoleRef",
    "syncReadyPayloadsRef",
    "syncHostPlayerIdRef",
    "selectedPlayerIdRef",
  ];

  for (const refName of removedRefs) {
    assert(!appSource.includes(refName), `${refName} should be folded into latestRef.`);
  }

  assert(scoreCardErrors.length === 0, `Score-card presets are invalid:\n${scoreCardErrors.join("\n")}`);
  assert(scoreCards.length === 100, "Exactly 100 score-card presets are available.");
  assert(validatorSource.includes("validateColorNumberCompleteness"), "Score-card validation enforces color-number completeness.");
  assert(generatorSource.includes("solveNumbersForColorGrid"), "Combined score-card generation solves numbers against color grids.");
  assert(!generatorSource.includes("createNumbersAndColorsCard(id, colorGrid)"), "Combined score-card generation no longer shuffles numbers independently.");
  assert(appSource.includes("page === \"picker\""), "Score-card picker is a real app page.");
  assert(appSource.includes("openScoreCardPicker"), "Home score-card previews can open the picker.");
  assert(appSource.includes("score-row-backdrop"), "Score-card rows render a grid-aligned segmented backdrop.");
  assert(appSource.includes("returnSyncToLobby"), "Sync Start over returns connected players to the lobby.");
  assert(appSource.includes("scoreCardId:"), "Local and sync game setup carries a selected score-card id.");
  assert(appSource.includes("syncScoreCardId"), "Sync mode tracks the host-selected runtime score card.");
  assert(appSource.includes("broadcastLobbyState") && appSource.includes("scoreCardId"), "Sync lobby broadcasts score-card changes.");
  assert(/type LatestSyncState = \{[\s\S]*penalties: number;/.test(appSource), "LatestSyncState includes penalties.");
  assert(
    appSource.includes("commitLocalTurnState(latestScoreCard, latest.rows, latest.penalties, latest.turn)"),
    "Automatic sync advance commits from latest rows, penalties, and turn.",
  );
  assert(!appSource.includes("readyToAdvance"), "Sync has no between-turn readyToAdvance phase.");
  assert(!appSource.includes("advanceEnabled"), "Sync has no user-facing Advance button state.");
  assert(!appSource.includes('"scanOffer"'), "Sync has no stored scanOffer phase.");
  assert(!appSource.includes('"ended"'), "Sync ended state is represented by idle plus a message.");
  assert(transportSource.includes("parseQrPayload"), "QR payload parsing has its own parser.");
  assert(transportSource.includes("parseWireMessage"), "Data-channel message parsing has its own parser.");
  assert(!appSource.includes("sync-play-strip"), "Sync play has no duplicate Ready-count strip.");
  assert(!styleSource.includes(".sync-play-strip"), "Duplicate Ready-count strip styles are removed.");
  assert(!appSource.includes("hintsChanged"), "Personal sync hint changes are not broadcast.");
  assert(appSource.includes("hintsLockChanged"), "Host hint lock changes are broadcast to connected players.");
  assert(appSource.includes("syncHintsLockedOff"), "Sync hint lock state is separate from personal hint state.");
  assert(
    appSource.includes('disabled={mode === "sync" && syncHintsLockedOff}'),
    "Personal hint toggle stays visible and is only disabled by the sync hint lock.",
  );
  assert(
    appSource.includes('aria-label={syncHintsLockedOff ? "Unlock legal options" : "Lock legal options off"}'),
    "Host hint lock has its own control separate from the personal eye.",
  );
  assert(appSource.includes("closedBy"), "Sync advance carries row-closure player metadata.");
  assert(appSource.includes("penaltyPlayerIds"), "Sync advance carries 4-penalty player metadata.");
  assert(styleSource.includes("top: 50%;"), "Sync toast is centered vertically.");
  assert(styleSource.includes("transform: translate(-50%, -50%);"), "Sync toast is centered in the viewport.");
  assert(styleSource.includes("background: var(--surface);"), "Sync toast uses a white app surface.");
  assert(styleSource.includes("color: var(--ink);"), "Sync toast uses dark text.");
  assert(styleSource.includes("pointer-events: none;"), "Sync toast does not block taps.");
  assert(appSource.includes('className="sync-toast" role="status" aria-live="polite"'), "Sync toast is announced politely.");
  assert(appSource.includes("isAcceptingAnswer"), "Host answer acceptance is explicitly gated.");
  assert(appSource.includes("disabled={gamePlayers.length === 0 || isAcceptingAnswer}"), "Host Start is disabled while accepting an answer.");
  assert(appSource.includes("scanDisabled={isAcceptingAnswer}"), "Host Scan is disabled while accepting an answer.");
  assert(appSource.includes("if (message.turnId !== latest.syncTurnId)"), "Sync advance results are scoped to the completed turn id.");
  assert(appSource.includes("getLegalMarkRoleMap"), "Legal score-card enablement and hints share one role map.");
  assert(!appSource.includes("function getLegalMarkKeys"), "Duplicate legal-key helper is removed.");
  assert(!appSource.includes("function getLegalMarkRoles"), "Duplicate legal-role helper is removed.");
  assert(appSource.includes("function applyPlayState"), "Repeated play-state commits use a small helper.");
}

function rowsState() {
  return {
    red: { selected: [], lock: "none" },
    yellow: { selected: [], lock: "none" },
    green: { selected: [], lock: "none" },
    blue: { selected: [], lock: "none" },
  };
}

function activeGameForRoll(roll, overrides = {}) {
  const players = [
    { id: "alice", name: "Alice" },
    { id: "bob", name: "Bob" },
  ];
  const emptyTurn = {
    roll: null,
    opponentWhiteSum: null,
    selectedMarks: [],
    penalty: false,
    opponentLocks: [],
  };
  const history = roll ? [{ before: emptyTurn, kind: "roll" }] : [];
  const turn = {
    roll,
    opponentWhiteSum: null,
    selectedMarks: [],
    penalty: false,
    opponentLocks: [],
    history,
    ...overrides.turn,
  };

  return {
    page: "play",
    players,
    selectedPlayerId: "alice",
    currentPlayerIndex: overrides.currentPlayerIndex ?? 0,
    rows: overrides.rows ?? rowsState(),
    penalties: overrides.penalties ?? 0,
    turn,
    gameOver: overrides.gameOver ?? false,
    gameOverReason: overrides.gameOverReason ?? null,
    undoStack: overrides.undoStack ?? [],
    scoreCardId: overrides.scoreCardId ?? 1,
  };
}

async function setGame(page, game) {
  await page.goto(baseUrl);
  await page.evaluate((nextGame) => {
    localStorage.clear();
    localStorage.setItem("qwixx.players.v1", JSON.stringify(nextGame.players));
    localStorage.setItem("qwixx.selectedPlayer.v1", nextGame.selectedPlayerId);
    localStorage.setItem("qwixx.activeGame.v1", JSON.stringify(nextGame));
  }, game);
  await page.reload();
}

async function runFlowChecks(page) {
  await page.goto(baseUrl);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.screenshot({ path: outputPath("home-empty-mobile.png"), fullPage: true });

  assert((await page.locator(".score-card-choice-heading", { hasText: "Card #1" }).count()) === 1, "Local home shows the default score card.");
  await page.getByRole("button", { name: "Edit" }).click();
  assert((await page.getByRole("heading", { name: "Card #1" }).count()) === 1, "Picker opens on the selected score card.");
  assert(await page.getByRole("checkbox", { name: "Standard", exact: true }).isDisabled(), "Picker does not allow all filters to be unchecked.");
  await page.getByRole("checkbox", { name: "Numbers", exact: true }).check();
  await page.getByRole("button", { name: "Select card 34", exact: true }).scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: "Select card 34", exact: true }).click();
  await page.waitForFunction(() => {
    const heading = document.querySelector(".card-picker-page h1");
    const top = heading?.getBoundingClientRect().top ?? 999;

    return top >= 0 && top < 120;
  });
  assert((await page.getByRole("heading", { name: "Card #34" }).count()) === 1, "Picker can select a mixed-number score card.");
  await page.screenshot({ path: outputPath("score-card-picker-mobile.png"), fullPage: true });
  await page.getByRole("checkbox", { name: "Colors", exact: true }).check();
  await page.getByRole("button", { name: "Select card 35", exact: true }).scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: "Select card 35", exact: true }).click();
  await page.waitForFunction(() => {
    const heading = document.querySelector(".card-picker-page h1");
    const top = heading?.getBoundingClientRect().top ?? 999;

    return top >= 0 && top < 120;
  });
  assert((await page.getByRole("heading", { name: "Card #35" }).count()) === 1, "Picker can show a mixed-color score card.");
  await page.screenshot({ path: outputPath("score-card-picker-mixed-colors-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "Back" }).click();
  assert((await page.locator(".score-card-choice-heading", { hasText: "Card #1" }).count()) === 1, "Back keeps the original score-card selection.");

  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByRole("checkbox", { name: "Numbers", exact: true }).check();
  await page.getByRole("button", { name: "Select card 2", exact: true }).click();
  await page.getByRole("button", { name: "Confirm" }).click();
  assert((await page.locator(".score-card-choice-heading", { hasText: "Card #2" }).count()) === 1, "Confirm saves the selected score card.");

  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByRole("button", { name: "Select card 1", exact: true }).click();
  await page.getByRole("button", { name: "Confirm" }).click();
  assert((await page.locator(".score-card-choice-heading", { hasText: "Card #1" }).count()) === 1, "Picker can return the local game to the standard score card.");

  for (const name of ["Alice", "Bob", "Cora"]) {
    await page.getByPlaceholder("Name").fill(name);
    await page.getByRole("button", { name: "Add" }).click();
  }

  await page.screenshot({ path: outputPath("home-filled-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "Start" }).click();
  await page.screenshot({ path: outputPath("play-idle-mobile.png"), fullPage: true });

  assert(await page.getByRole("button", { name: "Next" }).isDisabled(), "Next starts disabled on the user's turn.");
  await page.getByRole("button", { name: "Roll dice" }).click();
  assert(await page.getByRole("button", { name: "Next" }).isDisabled(), "Next stays disabled after rolling with no mark.");
  assert((await page.locator("button.score-tile.hint-white, button.score-tile.hint-mixed").count()) === 0, "Hints default off.");

  await page.getByRole("button", { name: "Show legal options" }).click();
  assert((await page.locator("button.score-tile.hint-white, button.score-tile.hint-mixed").count()) > 0, "Hint toggle shows legal options.");
  assert((await page.locator("button.lock-tile[class*='hint-']").count()) === 0, "Hint toggle does not style lock buttons.");
  await page.getByRole("button", { name: "Hide legal options" }).click();

  const firstLegalTile = page.locator("button.score-tile.legal").first();
  assert((await firstLegalTile.count()) === 1, "At least one legal score tile appears after rolling.");
  await page.getByRole("button", { name: "Undo" }).click();
  assert((await page.getByRole("dialog", { name: "Undo roll?" }).count()) === 1, "Undoing a roll asks for confirmation.");
  await page.getByRole("button", { name: "Cancel" }).click();
  assert((await page.locator(".die .pip.visible").count()) > 0, "Canceling roll undo keeps the roll.");

  await firstLegalTile.click();
  assert(!(await page.getByRole("button", { name: "Next" }).isDisabled()), "Next enables after one valid user mark.");
  await page.getByRole("button", { name: "Undo" }).click();
  assert((await page.getByRole("dialog", { name: "Undo roll?" }).count()) === 0, "Undoing a mark does not ask for roll confirmation.");
  assert(await page.getByRole("button", { name: "Next" }).isDisabled(), "Undoing one mark keeps the roll but disables Next.");
  assert((await page.locator(".die .pip.visible").count()) > 0, "Undoing one mark does not clear the dice roll.");

  await page.locator("button.score-tile.legal").first().click();
  await page.screenshot({ path: outputPath("play-user-mark-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "Next" }).click();
  await page.reload();
  assert((await page.getByRole("heading", { name: "Bob" }).count()) === 1, "Committed turn state persists after reload.");
  assert((await page.locator(".sum-strip.needs-input").count()) === 1, "Opponent turn prompts the white-sum row.");
  assert((await page.locator(".dice-grid.pale").count()) === 1, "Opponent turn dice appear pale.");

  await page.getByRole("button", { name: "White sum 6" }).click();
  assert((await page.locator(".sum-strip.needs-input").count()) === 0, "White-sum prompt disappears after selection.");
  assert(!(await page.getByRole("button", { name: "Next" }).isDisabled()), "Opponent turn enables Next after white sum.");
  await page.getByRole("button", { name: "Red locked" }).click();
  const redOpponentLockStyle = await page.locator(".score-row.red .lock-tile.opponent").evaluate((element) => {
    const style = window.getComputedStyle(element);
    return { background: style.backgroundColor, color: style.color };
  });
  assert(redOpponentLockStyle.background === "rgb(24, 24, 27)", "Opponent lock uses the selected lock background.");
  assert(redOpponentLockStyle.color === "rgb(255, 255, 255)", "Opponent lock uses the selected lock icon color.");
  assert((await page.locator(".total-box.red").textContent()) === "1", "Opponent lock does not add to the user's score.");
  await page.getByRole("button", { name: "Next" }).click();
  assert((await page.locator(".die.red").count()) === 0, "Closed red row removes the red die after Next.");
  await page.screenshot({ path: outputPath("play-red-locked-mobile.png"), fullPage: true });

  await page.getByRole("button", { name: "Start over" }).click();
  assert((await page.getByRole("dialog", { name: "Start over?" }).count()) === 1, "Start over asks for confirmation.");
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Exit" }).click();
  assert((await page.getByRole("dialog", { name: "Exit?" }).count()) === 1, "Exit asks for confirmation.");
  await page.getByRole("button", { name: "Cancel" }).click();
}

async function runAmbiguityChecks(page) {
  await setGame(page, activeGameForRoll({ whiteA: 3, whiteB: 4, red: 4, yellow: 1, green: 1, blue: 1 }));
  await page.getByRole("button", { name: "Red 7" }).click();
  assert(
    (await page.locator('button.score-tile.legal[aria-label="Red 8"]').count()) === 1,
    "Ambiguous Red 7 keeps Red 8 legal as a mixed follow-up.",
  );
  await page.getByRole("button", { name: "Red 8" }).click();
  assert(!(await page.getByRole("button", { name: "Next" }).isDisabled()), "Ambiguous two-mark turn can complete.");

  await setGame(page, activeGameForRoll({ whiteA: 4, whiteB: 4, red: 3, yellow: 1, green: 1, blue: 1 }));
  await page.getByRole("button", { name: "Red 7" }).click();
  assert(
    (await page.locator('button.score-tile.legal[aria-label="Red 8"]').count()) === 0,
    "Unambiguous mixed Red 7 does not allow a later white Red 8.",
  );

  await setGame(page, activeGameForRoll({ whiteA: 4, whiteB: 4, red: 3, yellow: 1, green: 1, blue: 1 }));
  await page.getByRole("button", { name: "Red 7" }).click();
  assert(
    (await page.locator('button.score-tile.legal[aria-label="Yellow 8"]').count()) === 1,
    "Mixed-first in one row allows a later white mark in a different row.",
  );
  await page.getByRole("button", { name: "Yellow 8" }).click();
  assert(!(await page.getByRole("button", { name: "Next" }).isDisabled()), "Mixed-first cross-row turn can complete.");
}

async function runCommittedUndoChecks(page) {
  await setGame(page, activeGameForRoll({ whiteA: 3, whiteB: 4, red: 4, yellow: 1, green: 1, blue: 1 }));
  await page.getByRole("button", { name: "Red 7" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "White sum 6" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.reload();

  await page.getByRole("button", { name: "Undo" }).click();
  assert((await page.getByRole("heading", { name: "Bob" }).count()) === 1, "Undoing Next restores the previous player.");
  assert((await page.locator('button.sum-box.selected[aria-label="White sum 6"]').count()) === 1, "Undoing Next restores the opponent white sum.");
  assert(!(await page.getByRole("button", { name: "Next" }).isDisabled()), "Undoing Next restores a turn ready for editing.");

  await page.getByRole("button", { name: "Undo" }).click();
  assert((await page.locator(".sum-strip.needs-input").count()) === 1, "Undo priority clears the restored white sum before older turns.");
  assert(await page.getByRole("button", { name: "Next" }).isDisabled(), "Clearing the restored white sum disables Next.");

  await page.getByRole("button", { name: "Undo" }).click();
  assert((await page.getByRole("heading", { name: "Alice" }).count()) === 1, "Undo can continue to the earlier committed turn.");
  assert((await page.locator('button.score-tile.selected[aria-label="Red 7"]').count()) === 1, "Earlier committed undo restores staged marks.");
  assert(!(await page.getByRole("button", { name: "Next" }).isDisabled()), "Earlier committed undo restores another editable turn.");

  await page.getByRole("button", { name: "Undo" }).click();
  assert((await page.locator('button.score-tile.selected[aria-label="Red 7"]').count()) === 0, "Turn undo removes the restored mark first.");
  assert(await page.getByRole("button", { name: "Next" }).isDisabled(), "Removing the restored mark disables Next.");

  await page.getByRole("button", { name: "Undo" }).click();
  await page.getByRole("dialog", { name: "Undo roll?" }).getByRole("button", { name: "Undo" }).click();
  assert(await page.getByRole("button", { name: "Roll dice" }).isEnabled(), "Undo can reach the start of the game.");
  assert(await page.getByRole("button", { name: "Undo" }).isDisabled(), "Undo is disabled at the start of the game.");
}

async function runGameOverUndoChecks(page) {
  await setGame(page, activeGameForRoll({ whiteA: 3, whiteB: 4, red: 4, yellow: 1, green: 1, blue: 1 }, { penalties: 3 }));
  await page.getByRole("button", { name: "Penalty" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  assert(await page.getByRole("button", { name: "Next" }).isDisabled(), "Game-ending Next disables Next.");

  await page.getByRole("button", { name: "Undo" }).click();
  assert(!(await page.getByRole("button", { name: "Next" }).isDisabled()), "Undo restores a game-ending turn for editing.");
  assert((await page.locator(".penalty-box.selected").count()) === 4, "Undo restores the staged fourth penalty.");
}

async function runSyncHostChecks(page) {
  await page.goto(baseUrl);
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.getByRole("button", { name: "Sync" }).click();
  assert((await page.locator(".score-card-choice").count()) === 0, "Sync setup hides score-card previews before hosting or joining.");
  await page.getByLabel("Your name").fill("Alice");
  await page.getByRole("button", { name: "Host" }).click();
  await page.waitForSelector(".qr-panel .qr-code", { timeout: 5000 });
  await page.screenshot({ path: outputPath("sync-host-lobby-mobile.png"), fullPage: true });

  assert((await page.getByText("Alice").count()) > 0, "Host appears in sync lobby.");
  assert((await page.locator(".score-card-choice-heading", { hasText: "Card #1" }).count()) === 1, "Sync host lobby shows the host score card.");
  assert((await page.locator(".qr-panel .qr-code").count()) === 1, "Host QR is generated.");
  assert(
    JSON.stringify(await page.locator(".sync-control-row button").allTextContents()) === JSON.stringify(["Randomize", "Scan"]),
    "Host lobby controls show Randomize before Scan.",
  );
  assert(
    await page.evaluate(() => {
      const qrPanel = document.querySelector(".qr-panel");
      const startButton = [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Start");

      return Boolean(qrPanel && startButton && (qrPanel.compareDocumentPosition(startButton) & Node.DOCUMENT_POSITION_FOLLOWING));
    }),
    "Host Start button appears below the host QR.",
  );
  await page.getByRole("button", { name: "Start" }).click();
  assert((await page.locator(".sum-strip").count()) === 0, "Sync play does not show manual white-sum boxes.");
  assert((await page.locator(".sync-play-strip").count()) === 0, "Sync play does not show a duplicate Ready-count strip.");
  assert((await page.locator(".sync-player-status.waiting").count()) === 1, "Sync compact player row shows waiting status.");
  assert((await page.locator(".sync-player-status.ready").count()) === 0, "Sync compact player row starts unready.");
  assert((await page.getByRole("button", { name: "Show legal options" }).count()) === 1, "Sync host shows the personal hint toggle.");
  assert((await page.getByRole("button", { name: "Lock legal options off" }).count()) === 1, "Sync host shows the hint lock control.");
  await page.getByRole("button", { name: "Show legal options" }).click();
  assert((await page.getByRole("button", { name: "Hide legal options" }).count()) === 1, "Sync personal hints can be enabled locally.");
  await page.getByRole("button", { name: "Lock legal options off" }).click();
  assert(await page.getByRole("button", { name: "Legal options locked off" }).isDisabled(), "Sync hint lock disables the personal hint toggle.");
  assert((await page.getByRole("button", { name: "Unlock legal options" }).count()) === 1, "Sync host can release the hint lock.");
  await page.getByRole("button", { name: "Unlock legal options" }).click();
  assert((await page.getByRole("button", { name: "Show legal options" }).count()) === 1, "Unlock leaves personal hints off and usable.");
  assert((await page.getByRole("button", { name: "Opponent reached four penalties" }).count()) === 0, "Sync play hides opponent 4x control.");
  assert(await page.getByRole("button", { name: "Ready" }).isDisabled(), "Sync Ready starts disabled before rolling.");

  await page.getByRole("button", { name: "Roll dice" }).click();
  assert(await page.getByRole("button", { name: "Ready" }).isDisabled(), "Sync Ready stays disabled until a mark or penalty.");
  await page.locator("button.score-tile.legal").first().click();
  assert(!(await page.getByRole("button", { name: "Ready" }).isDisabled()), "Sync Ready enables after a valid mark.");
  await page.getByRole("button", { name: "Ready" }).click();
  assert((await page.getByRole("button", { name: "Advance" }).count()) === 0, "Sync play has no Advance button.");
  assert(await page.getByRole("button", { name: "Ready" }).isDisabled(), "Single-player sync host auto-advances after Ready.");
  assert(await page.getByRole("button", { name: "Undo" }).isDisabled(), "Sync Ready keeps Undo disabled after automatic advance.");
  assert((await page.getByRole("button", { name: /Transfer host/ }).count()) === 0, "Permanent-host replacement controls are not shown.");
  await page.screenshot({ path: outputPath("sync-play-after-advance-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "Start over" }).click();
  await page.getByRole("dialog", { name: "Start over?" }).getByRole("button", { name: "Reset" }).click();
  assert((await page.locator(".sync-control-row").count()) === 1, "Sync host Start over returns to the editable lobby.");
  assert(
    JSON.stringify(await page.locator(".sync-control-row button").allTextContents()) === JSON.stringify(["Randomize", "Scan"]),
    "Returned sync lobby keeps order and scan controls.",
  );
  assert((await page.locator(".qr-panel .qr-code").count()) === 1, "Returned sync lobby keeps a host QR for adding players.");
  assert((await page.locator(".sum-strip").count()) === 0, "Returned sync lobby leaves the play page.");
  await page.screenshot({ path: outputPath("sync-returned-lobby-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "Start" }).click();
  assert((await page.locator(".dice-grid").count()) === 1, "Sync host can start again from the returned lobby.");
  await page.getByRole("button", { name: "Exit" }).click();
  assert((await page.getByRole("dialog", { name: "Exit?" }).count()) === 1, "Sync host Exit asks for confirmation.");
  await page.getByRole("button", { name: "Cancel" }).click();
}

async function runSyncTransportChecks(browser) {
  const hostPage = await browser.newPage();
  const joinPage = await browser.newPage();
  const otherPage = await browser.newPage();
  const compactQrPattern = /^[0-9A-Z $%*+\-.\/:]+$/;

  await hostPage.goto(baseUrl);
  await joinPage.goto(baseUrl);
  await otherPage.goto(baseUrl);

  await hostPage.evaluate(async () => {
    const { SyncHostTransport } = await import("/src/syncTransport.ts");
    window.__messages = [];
    window.__host = new SyncHostTransport({
      callbacks: {
        onMessage: (_playerId, message) => window.__messages.push(message),
      },
      hostName: "Alice",
      hostPlayerId: "alice",
      roomId: "room",
    });
  });

  async function connectJoiner(page, player) {
    const offer = await hostPage.evaluate(() => window.__host.createOffer());
    assert(offer.startsWith("QWO:"), "Host offer uses compact QR prefix.");
    assert(compactQrPattern.test(offer), "Host offer uses QR alphanumeric characters.");
    const answer = await page.evaluate(async ({ offerText, nextPlayer }) => {
      const { SyncJoinTransport } = await import("/src/syncTransport.ts");
      window.__joinMessages = [];
      window.__join = new SyncJoinTransport({
        onMessage: (_playerId, message) => window.__joinMessages.push(message),
      });
      const result = await window.__join.createAnswer(offerText, nextPlayer);
      return result.answerText;
    }, { offerText: offer, nextPlayer: player });
    assert(answer.startsWith("QWA:"), "Join answer uses compact QR prefix.");
    assert(compactQrPattern.test(answer), "Join answer uses QR alphanumeric characters.");

    await hostPage.evaluate((answerText) => window.__host.acceptAnswer(answerText), answer);
    await hostPage.waitForFunction(
      (playerId) => window.__messages?.some((message) => message.type === "join" && message.playerId === playerId),
      player.id,
      { timeout: 5000 },
    );
  }

  const failedOffer = await hostPage.evaluate(() => window.__host.createOffer());
  const failedOfferPayload = await hostPage.evaluate(async (offerText) => {
    const { parseSyncOffer } = await import("/src/syncTransport.ts");
    const offer = parseSyncOffer(offerText);

    return offer ? { offerId: offer.offerId, roomId: offer.roomId } : null;
  }, failedOffer);

  assert(failedOfferPayload, "Failed-handshake test can parse the host offer.");
  const failedAnswer = `qwixx:${compressToEncodedURIComponent(JSON.stringify({
    kind: "qwixx-sync-answer",
    version: 1,
    roomId: failedOfferPayload.roomId,
    offerId: failedOfferPayload.offerId,
    playerId: "failed",
    playerName: "Failed",
    sdp: { type: "answer", sdp: "not a valid answer" },
  }))}`;
  const failedResult = await hostPage.evaluate(async (answerText) => {
    try {
      await window.__host.acceptAnswer(answerText);
      return "resolved";
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }, failedAnswer);

  assert(failedResult !== "resolved", "Decoded answer QR with a bad handshake is rejected.");
  assert(
    !(await hostPage.evaluate(() => window.__messages?.some((message) => message.playerId === "failed"))),
    "Failed answer handshake does not add or message a connected player.",
  );
  const reusedFailedResult = await hostPage.evaluate(async (answerText) => {
    try {
      await window.__host.acceptAnswer(answerText);
      return "resolved";
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }, failedAnswer);

  assert(reusedFailedResult.includes("current host QR"), "Failed answer consumes the stale host QR and requires a fresh QR.");

  await connectJoiner(joinPage, { id: "bob", name: "Bob" });
  await connectJoiner(otherPage, { id: "cora", name: "Cora" });

  await joinPage.evaluate(() => window.__join.send({ type: "ready", payload: { turnId: "t1", playerId: "bob" } }));
  await hostPage.waitForFunction(() => window.__messages?.some((message) => message.type === "ready"), null, { timeout: 5000 });

  await hostPage.evaluate(() => window.__host.broadcast({ type: "sessionEnded" }));
  await joinPage.waitForFunction(
    () => window.__joinMessages?.some((message) => message.type === "sessionEnded"),
    null,
    { timeout: 5000 },
  );
  await otherPage.waitForFunction(
    () => window.__joinMessages?.some((message) => message.type === "sessionEnded"),
    null,
    { timeout: 5000 },
  );

  await hostPage.close();
  await joinPage.close();
  await otherPage.close();
}

async function main() {
  await mkdir(outputDir, { recursive: true });
  await runSourceChecks();

  const server = spawn(npmCommand(), ["exec", "vite", "--", "--host", "127.0.0.1", "--port", "5174", "--strictPort"], {
    cwd: projectRoot,
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    await Promise.race([
      waitForServer(server),
      once(server, "exit").then(([code]) => {
        throw new Error(`Vite exited before verification started with code ${code}.`);
      }),
    ]);

    const browser = await launchBrowser();
    const mobile = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 390, height: 844 } });
    await runFlowChecks(mobile);
    await runAmbiguityChecks(mobile);
    await runCommittedUndoChecks(mobile);
    await runGameOverUndoChecks(mobile);
    await runSyncHostChecks(mobile);
    await runSyncTransportChecks(browser);

    const desktop = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: 900, height: 900 } });
    await setGame(desktop, activeGameForRoll({ whiteA: 3, whiteB: 4, red: 4, yellow: 2, green: 6, blue: 1 }));
    await desktop.screenshot({ path: outputPath("play-desktop.png"), fullPage: true });
    await setGame(desktop, activeGameForRoll({ whiteA: 3, whiteB: 4, red: 4, yellow: 2, green: 6, blue: 1 }, { scoreCardId: 35 }));
    await desktop.screenshot({ path: outputPath("play-mixed-colors-desktop.png"), fullPage: true });

    await browser.close();
  } finally {
    await stopServer(server);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

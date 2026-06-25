import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const baseUrl = "http://127.0.0.1:5174/";
const outputDir = new URL("../verification-output/", import.meta.url);
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const chromePaths = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];

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
  await page.getByLabel("Your name").fill("Alice");
  await page.getByRole("button", { name: "Host" }).click();
  await page.waitForSelector(".qr-panel .qr-code", { timeout: 5000 });
  await page.screenshot({ path: outputPath("sync-host-lobby-mobile.png"), fullPage: true });

  assert((await page.getByText("Alice").count()) > 0, "Host appears in sync lobby.");
  assert((await page.locator(".qr-panel .qr-code").count()) === 1, "Host QR is generated.");
  await page.getByRole("button", { name: "Start" }).click();
  assert((await page.locator(".sum-strip").count()) === 0, "Sync play does not show manual white-sum boxes.");
  assert((await page.getByRole("button", { name: "Opponent reached four penalties" }).count()) === 0, "Sync play hides opponent 4x control.");
  assert(await page.getByRole("button", { name: "Ready" }).isDisabled(), "Sync Ready starts disabled before rolling.");

  await page.getByRole("button", { name: "Roll dice" }).click();
  assert(await page.getByRole("button", { name: "Ready" }).isDisabled(), "Sync Ready stays disabled until a mark or penalty.");
  await page.locator("button.score-tile.legal").first().click();
  assert(!(await page.getByRole("button", { name: "Ready" }).isDisabled()), "Sync Ready enables after a valid mark.");
  await page.getByRole("button", { name: "Ready" }).click();
  assert(await page.getByRole("button", { name: "Undo" }).isDisabled(), "Sync Ready disables Undo.");
  assert(!(await page.getByRole("button", { name: "Advance" }).isDisabled()), "Single-player sync host can advance after Ready.");
  assert((await page.getByRole("button", { name: /Transfer host/ }).count()) === 0, "Permanent-host replacement controls are not shown.");
  await page.getByRole("button", { name: "Advance" }).click();
  assert((await page.getByRole("button", { name: "Ready" }).count()) === 1, "Sync returns to the next turn after Advance.");
  await page.screenshot({ path: outputPath("sync-play-after-advance-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "Exit" }).click();
  assert((await page.getByRole("dialog", { name: "Exit?" }).count()) === 1, "Sync host Exit asks for confirmation.");
  await page.getByRole("button", { name: "Cancel" }).click();
}

async function runSyncTransportChecks(browser) {
  const hostPage = await browser.newPage();
  const joinPage = await browser.newPage();
  const otherPage = await browser.newPage();

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
    const answer = await page.evaluate(async ({ offerText, nextPlayer }) => {
      const { SyncJoinTransport } = await import("/src/syncTransport.ts");
      window.__joinMessages = [];
      window.__join = new SyncJoinTransport({
        onMessage: (_playerId, message) => window.__joinMessages.push(message),
      });
      const result = await window.__join.createAnswer(offerText, nextPlayer);
      return result.answerText;
    }, { offerText: offer, nextPlayer: player });

    await hostPage.evaluate((answerText) => window.__host.acceptAnswer(answerText), answer);
    await hostPage.waitForFunction(
      (playerId) => window.__messages?.some((message) => message.type === "join" && message.playerId === playerId),
      player.id,
      { timeout: 5000 },
    );
  }

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

    await browser.close();
  } finally {
    await stopServer(server);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

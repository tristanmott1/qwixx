# Qwixx App Specification

This document is the source of truth for the Qwixx scorekeeper app. Any future rule, layout, state, or style decision should be reflected here before or alongside implementation changes.

## Product Goal

Build a static, installable PWA for tracking a Qwixx game from one player's perspective.

The app supports two play modes:

- Local mode: one device tracks one player's score card. Opponent rolls, opponent row closures, and opponent penalty game-over events are entered manually by the user.
- Sync mode: nearby devices sync shared game flow over an offline local network using WebRTC data channels and QR-code signaling. Each device tracks only that player's own score card, while shared turn order, dice rolls, row closures, player exits, and game-over state are synchronized.

Sync mode is designed for no-internet situations, such as a hike or cabin game:

- It does not require internet once the PWA has loaded.
- Devices still need a local network path, usually the same Wi-Fi network or one phone hotspot.
- The hotspot does not need cellular service as long as it creates a local Wi-Fi network.
- The app should not depend on Bluetooth for sync.

The app should work in an extremely similar way to the sibling `../olvidalo-app/` project:

- Vite, React, and TypeScript.
- Static GitHub Pages deployment.
- PWA manifest and service worker.
- Local-first state using `localStorage`.
- Compact mobile-first layout.
- No routing library unless the project later grows enough to require one.
- Page state managed inside the app, initially only `home` and `play`.

## Pages

The app has exactly two main pages:

1. Home
2. Play

There is no landing page, tutorial page, or marketing content. The first screen is the usable app.

## Home Page

The Home page has two tabs:

1. Local
2. Sync

The Local tab preserves the current one-device behavior.

The Sync tab is a separate setup flow for offline nearby-device play. Sync mode is not a game parameter inside the Local tab.

### Local Tab Player Section

The player section should behave like the Olvidalo app's player editor, except there is no per-player out-limit selector.

Required behavior:

- Add players by entering a name and pressing Add.
- Edit player names inline.
- Remove individual players.
- Clear all players.
- Randomize player order.
- Rearrange player order using a drag handle.
- Persist the roster locally.
- Preserve the selected user player when randomizing or rearranging.
- Clear the selected user player if that player is removed.

Each player row includes:

- Drag handle.
- Editable player name.
- Star button to identify which player is the app user.
- Remove button.

The star control is single-select. Exactly one player can be marked as the user. The local Start button should be disabled until there is at least one named player and a selected user player.

### Local Tab Game Section

For now, the Game section contains only a large Start button.

There are no customizable rules on the Local tab.

When Start is pressed:

- Trim player names.
- Save the roster and selected user player.
- Clear any previous active game.
- Start on the Play page with the current player set to the first player in the ordered roster.

### Sync Tab

The Sync tab contains a simple setup flow:

- Enter your own player name.
- Choose Host or Join.

The Sync tab does not show the local player editor with stars, drag handles, or manual roster setup.

#### Sync Host Lobby

When the user chooses Host:

- The host becomes the first player in the synced game.
- The host creates a sync room.
- The host shows a QR code containing the host WebRTC offer.
- The host can scan joiner answer QR codes to complete each connection.
- Joined players are added automatically using the name they entered on their own device.
- The default order is host first, followed by join order.
- Before starting, the host can rearrange player order and randomize player order.
- Only the host can start the synced game.

#### Sync Join Flow

When the user chooses Join:

- The user enters their own name before joining.
- The app opens the camera to scan the host QR code.
- Because there is no internet signaling server, the joiner must show an answer QR code after scanning the host QR.
- The host scans the joiner's answer QR code to complete the WebRTC connection.
- After connection, the joiner appears in the host lobby automatically.
- The joiner waits in the lobby until the host starts the game.

This two-way QR handshake is required for the offline PWA approach. The app should make it feel as lightweight as possible, but it should not pretend that a one-scan offline handshake is reliable.

QR scan usability requirements:

- QR codes should render large enough to scan reliably on a phone screen.
- QR codes should include a clear quiet margin.
- QR payloads should stay compressed to reduce visual density.
- The scanner should request the rear camera at high resolution when available.
- The scanner should prefer native browser QR detection when available.
- The scanner should fall back to app-level QR decoding when native detection is unavailable.
- The scanner should request continuous focus when the browser exposes it.
- The scanner should offer a torch toggle when the camera exposes torch support.

## Sync Mode Network Model

Sync mode uses local WebRTC data channels between the host and each joined player.

The host is authoritative for shared game state:

- Player list.
- Player order.
- Current host identity.
- Current turn player.
- Current turn id.
- Dice roll.
- Shared row closures.
- Shared game-over state.
- Player ready status.
- Player exits and host removals.
- Host-only start over.

Each player device is authoritative only for that player's private score card actions:

- Local number selections.
- Local penalty selection.
- Local score total.
- The player's own Ready payload for the current turn.

Sync mode should send small events instead of syncing entire private score cards.

Shared event messages should include a `turnId` whenever they apply to a turn. Devices must ignore stale turn-scoped messages from earlier turns.

### Sync Event Categories

Host-to-player events include:

- Lobby state.
- Host transfer.
- Relayed host-transfer offer and answer messages.
- Game start.
- Turn start.
- Dice roll result.
- Ready status summary.
- Advance result.
- Player removal.
- Host start over.
- Session ended.

Player-to-host events include:

- Join metadata after the QR handshake completes.
- Host-transfer readiness.
- Current-player roll request.
- Ready payload.
- Voluntary exit.

The host should be the source of truth for dice results. When the current player taps the dice in sync mode, that device sends a roll request to the host. The host validates that the request came from the current active player for the current `turnId`, generates the roll for the currently visible dice, and broadcasts the roll result to everyone.

### Sync Phases

Sync mode has explicit shared phases:

- `lobby`: players are joining, host can reorder/randomize, host can start.
- `turn`: one player is current, dice are rolled, players make private selections, players press Ready.
- `readyToAdvance`: every active player is Ready, no one can edit, host can confirm Advance.
- `gameOver`: final shared game state is visible.
- `ended`: sync session has ended because the host disconnected, the host ended the session, or the local player exited.

The app should not infer these phases from scattered state flags.

### Host Transfer

The host can transfer host authority only:

- In the lobby.
- During `readyToAdvance`.

The host cannot transfer while a turn is in progress.

Host transfer should not require new QR scans after the game is already synced.

Transfer flow:

- The current host chooses another connected player as the new host.
- The current host temporarily relays WebRTC offer and answer messages between the chosen new host and every other active player.
- The chosen new host creates fresh direct WebRTC data channels to every other active player.
- Once every fresh channel is open, the current host sends a host-transfer-complete event to everyone.
- The chosen player becomes the host.
- Every other player, including the old host if they remain in the game, switches to the new host channel.
- The old host's previous star network is closed after the handoff.

The host must transfer host authority before exiting. If the host phone dies, loses connection, closes the app unexpectedly, or otherwise disconnects without transferring host authority, the sync session ends for every player.

There is no host recovery in v1.

### Player Exit, Removal, and Disconnect

Non-host players can exit at any time.

The host can remove a connected player if needed, including when that player is slow or disconnected.

Exit and host removal use the same game behavior:

- The player is removed from the active player list.
- The player is removed from the ready-required set.
- Future turns skip that player.
- The removed player is gone for the rest of the synced game.
- There is no late reconnect in v1.

If a non-current player exits or is removed during `turn` or during `readyToAdvance` before host Advance:

- Any unfinalized Ready payload from that player is discarded.
- If all remaining active players are already Ready, the game enters `readyToAdvance`.

If the current player exits or is removed during a turn, including during `readyToAdvance` before host Advance:

- The entire current turn is discarded for everyone.
- All current-turn local selections and Ready states are cleared.
- No row closures or penalty counts from that abandoned turn are applied.
- The game skips to the next active player.

If removing a player leaves fewer than one active player, the sync session ends.

## Play Page

The Play page contains:

- Top actions.
- Dice section.
- Turn action row.
- Score card section.
- Live score totals.

### Top Actions

The Play page should include top controls for:

- Exit.
- Start over.
- Legal options hint toggle.

In local mode:

- Exit returns to Home and clears the active game, while keeping the saved roster and selected user player.
- Start over restarts the game with the same player order and same selected user player, clearing the score card, locks, penalties, dice state, undo stack, and game-over state.
- Exit and Start over are always available.

In sync mode:

- Exit removes the local player from the synced game.
- Start over is visible and enabled only for the host.
- Host Start over restarts a fresh synced game immediately after host confirmation, using the same connected players and order without QR resync.
- Non-host players do not see or use Start over.
- The host must transfer host authority before exiting.
- If the host disconnects unexpectedly without transferring host authority, the synced session ends for everyone.
- Host transfer controls are available only in the lobby and during `readyToAdvance`.

The legal options hint toggle:

- Shows or hides score-card legal-move hints.
- Defaults to off.
- Persists locally.
- Is a per-device preference in both local and sync mode.

Controls should use icons whenever possible:

- Exit can use an X or back-style icon.
- Start over can use a rotate/reset icon.
- Legal options hint toggle should use an eye / eye-off icon and may omit visible text.

Use aria labels for icon-only controls.

Top action layout:

- Exit is in the left corner.
- Start over is in the right corner.
- The legal options hint toggle is immediately to the right of Start over in the top-right action group.
- Undo and Next do not live in the top action bar.

Because Exit and Start over cannot be undone:

- Pressing Exit opens a confirmation pop-up before leaving the active game.
- Pressing Start over opens a confirmation pop-up before clearing and restarting the active game.
- These confirmation pop-ups should be minimal and icon-friendly, matching the roll-undo confirmation style.

### Dice Section

The top section of the Play page is the dice section.

It shows the current player's name at the top.

It contains six dice in a 2x3 grid when no rows are closed:

- Column 1: white, white.
- Column 2: red, yellow.
- Column 3: green, blue.

Dice use pips, not numerals.

Dice styling:

- White dice have dark pips.
- Colored dice have colored faces with white pips.
- The dice should feel tactile and large enough to tap comfortably.

If a colored row has been closed, its corresponding colored die disappears completely after the closing turn is committed:

- In local mode, this happens when Next is pressed.
- In sync mode, this happens when the host confirms Advance.

White dice are never removed.

In local mode, below the dice are 11 white number boxes labeled 2 through 12.

In sync mode, the 2-12 white sum boxes are not shown. Everyone sees only the dice grid and the score card.

### Dice Stage

No score card control is enabled until the dice stage is complete.

In local mode, on the user's turn:

- The dice grid is enabled.
- The 2-12 white sum boxes are disabled for clicking.
- Pressing anywhere on the dice grid rolls all visible dice.
- After rolling, the sum of the two white dice is highlighted in the 2-12 boxes.
- Mixed sums are computed from each white die plus each visible colored die.
- The score card selection stage begins.

In local mode, on an opponent's turn:

- The dice grid is disabled and should appear in a lighter, paler color so it reads as non-interactive.
- The 2-12 white sum boxes are enabled.
- Before a white sum is selected, the full row of 2-12 white sum boxes should have a glowing blue outline, showing that this is the required interaction.
- The user selects the sum of the two white dice based on the opponent's physical roll.
- After the white sum is selected, it is highlighted.
- After the white sum is selected, the glowing blue outline disappears.
- The score card selection stage begins.

In sync mode:

- Only the current player can roll the dice.
- Non-current players see disabled dice until the current player rolls.
- There is no manual white-sum selection strip.
- The current player's dice tap sends a roll request to the host.
- The host validates the request, generates the roll, and sends the roll result to every connected player.
- After the synced roll arrives, every player enters the score card selection stage.
- Non-current players use the synced white sum automatically.
- The current player cannot undo the dice roll in sync mode.

### Turn Action Row

The turn action row sits between the dice section and the score card section.

- Undo is on the left.
- The primary turn action is on the right.
- The primary turn action should remain visually stronger than Undo.
- Both controls may be icon-only if the icons are clear.
- Undo should use a curved back arrow icon.
- The primary turn action should use a forward/down/right movement icon.

In local mode, the primary turn action is Next.

In sync mode:

- During `turn`, the primary turn action is Ready.
- After Ready is pressed, the player's score-card controls and Undo are disabled until the next turn.
- During `readyToAdvance`, the host sees Advance as the primary action.
- During `readyToAdvance`, non-host players see that the game is waiting for the host to advance.
- The host can see which players are Ready.

## Score Card Layout

The score card should be an app-native, cleaner, more elegant version of the attached physical score card image. It should preserve the same information without feeling crowded.

Rows:

- Red row: numbers 2 through 12.
- Yellow row: numbers 2 through 12.
- Green row: numbers 12 through 2.
- Blue row: numbers 12 through 2.

Visual order matters. "To the right" means to the right on screen:

- Red and yellow progress from 2 to 12.
- Green and blue progress from 12 to 2.

Each row includes:

- Colored row band.
- Lightly row-tinted number tiles.
- A lock circle after the final number.

Number labels should be centered in their tiles, including double-digit labels.

Selected number tiles should use a clean black X mark.

## Row Progression Rules

On each row, only numbers visually to the right of the rightmost selected number can be selected.

Examples:

- If red has 2, 4, and 7 selected, only red 8, 9, 10, 11, and 12 can be selected.
- If green has 12, 10, and 8 selected, only green 7, 6, 5, 4, 3, and 2 can be selected.

Closed rows are disabled for the rest of the game.

## Final Number and Lock Rules

The final number in a row is:

- 12 for red and yellow.
- 2 for green and blue.

The final number cannot be selected unless the user already has at least 5 selected numbers in that same row before selecting the final number. Staged selections earlier in the same turn count for this rule.

If the user selects the final number:

- The final number is marked.
- The row's lock icon is automatically marked.
- The lock icon counts as an additional point for that color.
- The row is staged to close.
- The row remains visually present until the turn is committed.
- The corresponding colored die remains visible until the turn is committed.

In local mode, if an opponent closes a row:

- The user can tap that row's lock icon after the dice stage is complete.
- This stages an opponent lock.
- The row's score controls are immediately disabled for the rest of the current turn.
- The row and corresponding die are not removed until Next is pressed.
- The lock icon does not count as a point for the user.
- Multiple opponent locks may be staged in one turn.

In sync mode:

- There is no opponent row-closure control.
- Each player can only close rows on that player's own score card.
- A player who closes a row includes that closed row in their Ready payload.
- Row closures are not revealed or applied globally until the host confirms Advance.
- If any active player's Ready payload closes a row, that row becomes globally closed for everyone when Advance is confirmed.
- A lock icon counts as a point only for the player who personally selected that row's final number.
- If another player closes a row, the local row still becomes disabled and visibly locked, but the lock icon does not count for the local score.
- If multiple players close the same row on the same synced turn, each of those players gets their own lock point, and everyone else gets only the global row closure.

After a turn commits any own, opponent, or synced row closure:

- The row is disabled for the rest of the game.
- The corresponding colored die disappears for the rest of the game.

If multiple rows close on one turn, all of them are committed together:

- In local mode, when Next is pressed.
- In sync mode, when the host confirms Advance.

## Selection Rules

The app should prevent illegal moves by disabling controls, not by allowing a move and rejecting it afterward.

At every point in the selection stage:

- Enable exactly the legal next presses.
- Disable all illegal presses.
- Recompute legal moves after every roll, white-sum selection, score-card selection, penalty selection, and staged lock.
- Keep defensive validation in handlers for stale events or double taps, but the normal UI must not offer illegal moves.

Legal-move visual hints are controlled by the legal options hint toggle:

- The default is off.
- The preference persists locally.
- Hints affect only visual treatment, not whether a control is enabled.
- When hints are off, legal score-card tiles look completely normal but remain clickable.
- When hints are on, legal white-sum score-card options use a bright white tile treatment.
- When hints are on, legal colored/mixed-sum score-card number options use a clean thick black border with no pale edge behind it.
- If a tile is legal as both a white-sum option and a colored/mixed-sum option, it gets both indicators at the same time.
- Hints apply only to number tiles. Lock buttons do not receive hint styling.
- In local mode, the opponent-turn white sum strip affordance is not controlled by this toggle. The glowing blue outline remains visible until the white sum is selected.

### Non-Current Player Selection

In local mode, on an opponent turn:

- The user first selects the white dice sum from the 2-12 boxes.
- After that, the user may select zero or one score-card number.
- Any selected score-card number must equal the white sum.
- The selected number must also obey row progression and final-number rules.
- After one score-card number is selected, no further score-card numbers can be selected on that turn.
- The user may also stage one or more opponent row locks after the dice stage is complete.
- Next is enabled as soon as the white sum is selected, even if the user marks no score-card number.

In sync mode, when the local player is not the current player:

- The user waits for the current player's synced roll.
- The user does not manually choose the white sum.
- After the synced roll arrives, the user may select zero or one score-card number.
- Any selected score-card number must equal the synced white sum.
- The selected number must also obey row progression and final-number rules.
- After one score-card number is selected, no further score-card numbers can be selected on that turn.
- The user cannot stage opponent row locks.
- Ready is enabled after the synced roll arrives, even if the user marks no score-card number.

### User Turn Selection

On the user's turn, or when the local player is the current player in sync mode:

- The user first rolls the dice by pressing the dice grid.
- After the roll, the white sum is highlighted.
- The user may select one number, two numbers, or one penalty.

Valid completion states for the user's turn:

- One legal score-card number.
- Two legal score-card numbers, consisting of one white-sum selection and one mixed-sum selection.
- One penalty.

The user cannot combine a penalty with score-card number selections.

The white-sum selection:

- May be in any open row.
- Must equal the sum of the two white dice.
- Must obey row progression and final-number rules.

The mixed-sum selection:

- Uses one white die plus one colored die.
- Must be selected in the row corresponding to that colored die.
- Must obey row progression and final-number rules.
- Only one mixed-sum selection is allowed per user turn.

If two numbers are selected:

- One must be interpretable as the white-sum selection.
- One must be interpretable as the mixed-sum selection.
- If the two selected numbers are in different rows, they may be selected in either order.
- If both selected numbers are in the same row, the white-sum mark must be visually before the mixed-sum mark in that row.

Examples:

- If the white sum is 6 and the red mixed sum is 7, the user can select red 6 and red 7.
- If the white sum is 7 and the red mixed sum is 6, the user cannot select red 6 and red 7, because the white mark would have to come after the mixed mark in that row.
- If the white sum is 7 and a red mixed sum is 6, the user may select red 6 first and then select white-sum 7 in a different row.

### Ambiguous Selection Logic

Some selected boxes can be both a valid white-sum selection and a valid mixed-sum selection.

The app must not prematurely decide which role an ambiguous box used.

Instead, selection legality should be handled with a legal-interpretations engine:

- At the beginning of the selection stage, enable the union of every legal first press.
- After each press, keep every valid interpretation of the selections so far.
- The next enabled boxes are the union of moves that remain legal under at least one interpretation.
- If a selected box could be white or mixed, preserve both interpretations until later selections force one interpretation or the turn is committed.
- Committing a turn only commits physical marks, penalties, and locks. It does not need to save whether a mark was "white" or "mixed."

If a first selection is ambiguous, the app may still allow an additional selection when at least one valid interpretation allows that second selection.

## Penalty Rules

The user can select penalties only on the user's own turn.

Penalty behavior:

- Max of 4 penalties.
- Each penalty is worth -5 points.
- Selecting a penalty satisfies the user's turn requirement.
- A penalty cannot be combined with score-card number selections.
- If the user reaches 4 penalties, the game is over in local mode when Next commits the penalty.
- If the user reaches 4 penalties in sync mode, the player's Ready payload reports it, and the shared game ends when the host confirms Advance.

In local mode, the Play page should also include a small control to indicate that an opponent has reached 4 penalties. Pressing it ends the game.

In sync mode:

- There is no opponent 4x penalty control.
- Players only enter their own penalties.
- Opponent 4-penalty game-over state is learned from synced Ready payloads.

Penalty row layout:

- The user's four penalty markers are on the left side of the penalty row.
- In local mode, the opponent 4x penalty button is on the right side of the penalty row.
- In local mode, the opponent 4x penalty button should not live in the top action bar.

## Local Next Button

In local mode, Next commits the current turn.

Before the dice stage is complete, Next is disabled.

On an opponent turn:

- Next is enabled once the white sum has been selected.
- The user may press Next with zero score-card selections.

On the user's turn:

- Next is enabled only when the staged turn has a valid completion state:
  - One legal number.
  - Two legal numbers with a valid white-plus-mixed interpretation.
  - One penalty.

When Next is pressed:

- Save a committed-turn undo snapshot.
- Commit all staged marks.
- Commit staged penalties.
- Commit staged own row locks.
- Commit staged opponent row locks.
- Remove dice for newly closed rows.
- Check game-over conditions.
- If the game is not over, advance to the next player in order.

If the current player is the last player, wrap to the first player. There are no rounds to configure.

## Sync Ready And Advance

In sync mode, players do not press Next to advance the turn. They press Ready after completing their own private turn actions.

Before the dice stage is complete, Ready is disabled.

For a non-current player:

- Ready is enabled after the synced roll arrives.
- The player may press Ready with zero score-card selections.
- The player may press Ready with one legal white-sum score-card selection.

For the current player:

- Ready is enabled only when the staged turn has a valid completion state:
  - One legal number.
  - Two legal numbers with a valid white-plus-mixed interpretation.
  - One penalty.

When a player presses Ready:

- The player's local marks and penalties for that turn become a locked pending result.
- The pending result becomes final only when the host confirms Advance.
- If the current turn is discarded before Advance, the pending result is cleared.
- The player's controls lock until the next turn.
- Undo is disabled until the next turn.
- The player sends a Ready payload to the host.

The Ready payload contains only shared consequences:

- `turnId`.
- `playerId`.
- Rows closed by that player on this turn.
- Whether that player reached 4 penalties on this turn.

The Ready payload does not include the player's full private score card.

When all active players are Ready:

- The game enters `readyToAdvance`.
- No player can edit the completed turn.
- The host can see who is Ready.
- The host can confirm Advance.
- The host can transfer host authority.
- The host can remove players if needed.

When the host confirms Advance:

- All Ready payloads for the current `turnId` are applied together.
- Each device finalizes its own locked pending result for the current turn.
- Newly closed rows are revealed and globally closed for everyone.
- Dice for newly closed rows are removed.
- Game-over conditions are checked.
- If the game is not over, the game advances to the next active player in order.

If the current player is the last active player, wrap to the first active player. There are no rounds to configure.

## Undo Button

Undo reverses exactly the most recent undoable user action in the current mode.

Every user click that changes turn state creates one undoable action. Anything selected by a single user click is exactly one action.

### Local Undo

In local mode, Undo covers both uncommitted turn actions and committed Next actions.

Within the current uncommitted turn, undoable actions include:

- Dice roll on the user's turn.
- Opponent white-sum selection.
- Score-card number selection.
- Penalty selection.
- Opponent row lock selection.
- Next, which commits the current turn.

Local undo priority:

- If the current turn has uncommitted undo history, Undo reverses the most recent uncommitted action first.
- If the current turn has no uncommitted undo history and at least one committed turn exists, Undo reverses the most recent Next action.
- Undo can repeatedly reverse committed Next actions all the way back to the start of the game.
- Undo is disabled only when there is no uncommitted action and no committed Next action to reverse, or when the active game has been exited.

Local special undo cases:

- Selecting a final number is one action. Undo removes both the final number and its automatic own-lock mark together.
- Undoing an opponent lock removes only that staged opponent lock.
- Undoing a penalty clears only that staged penalty.
- Undoing a score-card number removes only that selected number and any automatic lock that came from that same click.
- Undoing an opponent white-sum selection returns to the "choose white sum" state. Any later score-card or lock actions would already have been undone first.
- Undoing a user's dice roll requires a confirmation modal because a random roll cannot be reliably repeated.
- Undoing Next restores the game to the exact state immediately before Next was pressed, including current player, rows, locks, penalties, staged turn state, dice/sum state, game-over state, and game-over reason.
- Undoing Next restores the previous turn as still ready to press Next, so the user can edit the restored turn from there.
- Undoing Next does not require the random-roll confirmation, because it restores a saved snapshot rather than rerolling dice.

Local undo history for committed Next actions should be stored as game-level snapshots, not as hand-written inverse operations.

### Sync Undo

In sync mode, Undo is intentionally narrower:

- Undo applies only to the local player's own actions.
- Undo applies only before the local player presses Ready.
- Undo never crosses back to a previous turn.
- Undo cannot undo a synced dice roll.
- Undo cannot undo Ready.
- Once Ready is pressed, Undo is disabled until the next turn begins.
- During `readyToAdvance`, Undo is disabled for every player.

Sync uncommitted undoable actions include:

- Score-card number selection.
- Penalty selection.
- Final-number selection with its automatic own-lock mark.

Sync mode has no opponent white-sum selection, opponent row lock selection, opponent 4x control, committed Next action, or roll undo.

Pressing Exit or Start over is not undoable through the turn Undo button.

Exit and Start over have their own confirmation pop-ups because those actions cannot be undone.

## Game Over

In local mode, the game ends when any of these conditions becomes true:

- Two rows have been closed globally.
- The user reaches all 4 penalties.
- The user presses the control indicating that an opponent reached 4 penalties.

In sync mode, the game ends when any of these conditions becomes true:

- Host Advance applies Ready payloads that bring the shared closed-row count to two.
- Host Advance applies a Ready payload from any player who reached 4 penalties.
- The host disconnects unexpectedly and the synced session ends.
- The host intentionally ends the synced session.
- Player exits or removals leave fewer than one active player.

When the game is over:

- Nothing about the page layout changes.
- Scores remain visible and final.
- The local Next, Ready, or Advance button is disabled as appropriate.
- Exit remains available.
- Local Start over remains available.
- Sync Start over remains available only to the host.

## Scoring

Scoring updates live.

Each color's score is based on the count of selected numbers plus any lock icon earned by the user.

Opponent lock icons do not count for the user.

In sync mode:

- The local display may include the player's pending current-turn selections after Ready.
- Pending current-turn selections become final only when the host confirms Advance.
- If the current turn is discarded before Advance, pending selections are removed and scores return to the previous final state.

Scoring guide:

| Mark count | Points |
| ---------- | ------ |
| 1x | 1 |
| 2x | 3 |
| 3x | 6 |
| 4x | 10 |
| 5x | 15 |
| 6x | 21 |
| 7x | 28 |
| 8x | 36 |
| 9x | 45 |
| 10x | 55 |
| 11x | 66 |
| 12x | 78 |

Penalty score:

- Each penalty is -5.
- Four penalties is -20.

Totals display:

- Red total.
- Plus yellow total.
- Plus green total.
- Plus blue total.
- Minus penalty total.
- Equals final total.

The scoring guide and totals should appear below the rows in a cleaner app-native version of the physical score card.

## Persistence

Persist locally for all modes:

- Legal options hint preference.

Persist locally for local mode:

- Player roster.
- Selected user player.
- Active game state.
- Current page.
- Current player index.
- Score-card marks.
- Own locks.
- Opponent locks.
- Closed rows.
- Penalties.
- Current uncommitted turn state.
- Current uncommitted turn undo history.
- Game-level undo stack for committed Next snapshots.
- Game-over state.

Persist locally for sync mode:

- The player's own display name.
- The current sync screen state where practical.
- The local player's private score-card marks.
- The local player's private penalties.
- The local player's score totals.
- The local player's unready current-turn undo history.

Do not rely on local persistence to recover a live sync session:

- WebRTC connections do not survive a full app reload or app close in v1.
- If a non-host player reloads, closes the app, or disconnects, that player is treated as gone.
- If the host reloads, closes the app, loses connection, or disconnects unexpectedly, the synced session ends for everyone.
- There is no late reconnect in v1.
- The host room is runtime shared state, not a recoverable backend session.

Suggested storage keys:

- `qwixx.players.v1`
- `qwixx.selectedPlayer.v1`
- `qwixx.showHints.v1`
- `qwixx.activeGame.v1`
- `qwixx.syncName.v1`
- `qwixx.syncLocalState.v1`

Restoring the app in local mode should resume the active game as it appeared before refresh or app close.

Local Exit clears the active game state but keeps roster and selected user player.

Local Start over replaces the active game state with a fresh game using the current game players and selected user player.

Sync Exit clears the local sync session state. Host Start over replaces the synced game state with a fresh game using the current connected players and order.

## PWA and Deployment

The app should follow the Olvidalo app's static deployment pattern:

- Vite config uses `base: "./"` for GitHub Pages compatibility.
- Production build runs TypeScript and Vite build.
- Service worker caches the app shell and built assets.
- Manifest uses the app name `Qwixx`.
- GitHub Actions deploys `dist` to GitHub Pages on push to `main`.

Sync mode should remain compatible with static GitHub Pages hosting:

- There is no backend server.
- There is no internet signaling service.
- QR codes carry the WebRTC offer and answer needed for the offline handshake.
- WebRTC data channels carry synced game events after the handshake.
- Camera scanning and WebRTC require HTTPS in normal browsers, which GitHub Pages provides.
- Once the PWA has loaded, sync mode can work without internet as long as the devices share a local network path.

## Visual Style

The style should be colorful, simple, minimal, and clean.

Theme target:

- "Kindergarten / living-room dice game" in spirit.
- Friendly and tactile.
- More elegant than childish.
- Not crowded.
- Not rustic, outdoorsy, or niche like Olvidalo.

Overall look:

- White or near-white background.
- Very light gray panel boundaries.
- Minimal shadows.
- 8px border radius or less unless a round control is semantically circular.
- No gradients, decorative blobs, or illustrative backgrounds.
- The Qwixx row colors and dice colors provide the personality.

Color approach:

- Red, yellow, green, and blue should be clear and saturated enough to identify rows and dice.
- Supporting UI should use white, light gray, charcoal, and restrained accent colors.
- Avoid a one-note palette dominated by one hue.

Typography:

- Clean system or Inter-style sans-serif.
- Strong readable numerals.
- No playful display font unless explicitly chosen later.
- Do not scale fonts with viewport width.
- Letter spacing should remain 0.

Controls:

- Prefer icons over visible text when the icon is familiar.
- Use lucide icons where available.
- Use visible text only where it materially improves clarity.
- Provide aria labels for icon-only controls.
- Disabled controls should be visibly disabled.
- Place global actions in the top bar and turn-stage actions between dice and score card.

Dice:

- Large, tappable, rounded square dice.
- Pips instead of numerals.
- Pips should use standard Western dice placement: centers at roughly 25%, 50%, and 75% of the die face, with 6 using left/right columns and 3 using a top-left to bottom-right diagonal.
- Colored dice use white pips.
- White dice use dark pips.
- A small restrained roll animation is acceptable.

Score card:

- App-native and elegant, not a literal copy of the photo.
- Colored row bands with lightly row-tinted number tiles.
- Normal number tiles should be clearly lighter than the row band but tinted enough that pure white legal hints stand out.
- Normal number tiles should have crisp edges without a separate pale or white border between the tile and row background.
- Color total boxes should use the same row-tinted fills as the score row number tiles.
- Bold black X for selected marks.
- Lock circles should be visually clear but compact.
- The score card should remain readable on mobile without feeling cramped.

Layout:

- Mobile-first, similar width and density to Olvidalo.
- Avoid nested cards.
- Use full-width sections with constrained inner content.
- The dice section should feel like the primary interaction area.
- The score card should be compact but airy.
- Text should never overflow, overlap, or crowd controls.

## Verification Expectations

Before considering an implementation complete:

- Run the production build.
- Verify the Home tabs work and Local mode preserves the agreed player controls.
- Verify the Sync tab can enter a name, choose Host, choose Join, and move through the QR handshake UI.
- Verify the host lobby adds joined players, defaults to host first then join order, and lets the host rearrange and randomize before starting.
- Verify the Play page at mobile and desktop widths in both local and sync mode.
- Verify local dice rolling and local manual white-sum selection.
- Verify sync dice rolling is available only to the current player and the roll appears for every connected player.
- Verify legal move enabling, disabled illegal moves, and hint-toggle visuals in both modes.
- Verify ambiguous selections remain valid until forced.
- Verify local one-action-at-a-time uncommitted undo and roll-undo confirmation.
- Verify local committed-turn undo can reverse Next actions repeatedly back to the start of the game.
- Verify local undoing Next restores the previous turn as editable and ready to press Next.
- Verify sync undo applies only to the local player's unready current-turn actions.
- Verify sync roll, Ready, and previous turns cannot be undone.
- Verify sync Ready locks the local controls and sends only the Ready payload.
- Verify all active players Ready moves the game to `readyToAdvance`, not directly to the next turn.
- Verify only the host can confirm Advance.
- Verify sync Advance applies all Ready payloads, row closures, penalty game-over state, and next-player selection together.
- Verify local Exit and Start over confirmation pop-ups.
- Verify sync host-only Start over confirmation and fresh-game restart without QR resync.
- Verify sync non-host Exit removes that player and future turns skip them.
- Verify sync current-player exit or host removal discards the current turn and skips to the next active player.
- Verify sync host transfer is allowed only in lobby and `readyToAdvance`.
- Verify sync host transfer creates fresh direct channels to the new host without new QR scans.
- Verify the old host can exit after a completed host transfer.
- Verify unexpected host disconnect ends the synced session for everyone.
- Verify local row closing, staged locks, die removal after Next, and multiple row closures.
- Verify sync row closing, shared row closure reveal after Advance, die removal after Advance, and multiple row closures.
- Verify scoring, penalties, and game-over conditions in both modes.
- Verify local reload persistence.
- Verify sync reload or disconnect behavior matches the no-late-reconnect v1 rule.
- Verify PWA build output and service worker generation.

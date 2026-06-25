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
- Page state managed inside the app.

## Pages

The app has three app pages:

1. Home
2. Score Card Picker
3. Play

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

The Game section contains:

- A compact selected score-card preview.
- Minimal selected-card text such as `Card #1`.
- An Edit score card control.
- A large Start button.

The selected score card is the user's personal persisted score-card choice.

The compact selected score-card preview:

- Shows only the four score-card rows.
- Does not show penalties, scoring guide, or totals.
- Reuses the same score-row component and visual styling as the Play page.

The Edit score card control opens the Score Card Picker page.

There are no other customizable rules on the Local tab.

When Start is pressed:

- Trim player names.
- Save the roster and selected user player.
- Save the selected score-card id into the active local game.
- Clear any previous active game.
- Start on the Play page with the current player set to the first player in the ordered roster.

### Sync Tab

The Sync tab contains a simple setup flow:

- Enter your own player name.
- Choose Host or Join.

The Sync tab does not show the local player editor with stars, drag handles, or manual roster setup.

Before the user chooses Host or completes joining a host, the Sync tab does not show a score-card preview.

After a sync score card is known:

- The selected score card is visible on the Sync tab.
- The preview shows only the four score-card rows.
- The preview uses the same row component and styling as the Play page.
- The preview text should be minimal, such as `Card #37`.
- A sync joiner sees the host-selected score card as read-only.
- The joiner's personal persisted score-card choice is not overwritten by the host-selected sync card.

#### Sync Host Lobby

When the user chooses Host:

- The host becomes the first player in the synced game.
- The host creates a sync room.
- The host shows a QR code containing the host WebRTC offer.
- The host can scan joiner answer QR codes to complete each connection.
- While the host is accepting an answer QR, the host is in a pending handshake state.
- While an answer handshake is pending, the host Start button must be disabled.
- While an answer handshake is pending, the host Scan button must be disabled so only one answer is processed at a time.
- Joined players are added automatically using the name they entered on their own device.
- A joining player is added only after the WebRTC data channel has opened successfully.
- A decoded answer QR that fails to open a WebRTC data channel must not add a player.
- A decoded answer QR that fails to open a WebRTC data channel must not leave a half-connected peer in the host transport.
- A decoded answer QR that fails to open a WebRTC data channel must show a visible host-side failure message before the host can start.
- After a failed answer handshake, the host should receive or create a fresh host QR so the joiner can retry cleanly.
- The default order is host first, followed by join order.
- Before starting, the host can rearrange player order and randomize player order.
- Host lobby controls should show Randomize on the left and Scan on the right.
- The host Start button should be full width below the host QR code.
- The host lobby shows the host's personal persisted selected score card.
- The host can edit the selected score card before starting.
- If the host confirms a new score-card selection while players are already joined, joined players update immediately.
- Only the host can start the synced game.

#### Sync Join Flow

When the user chooses Join:

- The user enters their own name before joining.
- The app opens the camera to scan the host QR code.
- Because there is no internet signaling server, the joiner must show an answer QR code after scanning the host QR.
- The host scans the joiner's answer QR code to complete the WebRTC connection.
- After connection, the joiner appears in the host lobby automatically.
- After connection, the joiner sees the host's selected score card.
- The host's selected score card is read-only for the joiner.
- The host's selected score card is runtime sync-session state for the joiner, not a replacement for the joiner's personal persisted selected card.
- The joiner waits in the lobby until the host starts the game.

This two-way QR handshake is required for the offline PWA approach. The app should make it feel as lightweight as possible, but it should not pretend that a one-scan offline handshake is reliable.

QR scan usability requirements:

- QR codes should render large enough to scan reliably on a phone screen.
- QR codes should render as crisp vector output, not as raster images that can blur when scaled.
- QR codes should include a clear quiet margin.
- QR payloads should stay compressed and use a QR-alphanumeric-safe compact format to reduce visual density.
- Generated host offer QR codes should use the compact `QWO:` prefix.
- Generated join answer QR codes should use the compact `QWA:` prefix.
- Legacy `qwixx:` QR payloads may still parse for development compatibility, but new QR codes should use the compact format.
- The scanner should request the rear camera at high resolution when available.
- The scanner should prefer native browser QR detection when available.
- The scanner should fall back to app-level QR decoding when native detection is unavailable.
- The scanner should decode the visible square scanner frame rather than the full camera frame.
- The scanner should request continuous focus when the browser exposes it.
- The scanner should offer a torch toggle when the camera exposes torch support.
- The scanner should visibly show `Looking for QR` before a code is detected.
- The scanner should visibly show `QR found` immediately after a code is detected.
- Handshake status should distinguish decoded QR failures from WebRTC connection failures.
- Host answer scanning should show `QR found. Accepting answer` before trying to complete the host side of the handshake.
- Joiner host scanning should show `QR found. Creating answer` before trying to create the answer QR.
- Successful answer creation should show `Answer ready`.
- Successful data-channel connection should show `Connected`.
- Camera access failure should remain separate as `Camera unavailable`.
- Third-party scanner libraries are a future fallback if compact QR payloads and explicit status messages are still unreliable.

QR handshake gating requirements:

- "QR found" means only that the camera decoded a QR code.
- "Creating answer" means the joiner parsed a host offer and is building a local WebRTC answer.
- "Answer ready" means the joiner created an answer QR, but it does not yet mean the joiner is connected.
- "Accepting answer" means the host parsed an answer QR and is trying to open the data channel.
- A player is connected only when the data channel opens.
- The host must not treat a decoded answer QR as a joined player before the data channel opens.
- The host must not allow the game to start while an answer QR is being accepted.
- If the data channel does not open, the host should show a connection failure message immediately in the lobby.
- If the data channel does not open, the joiner should remain on the answer QR screen unless the host ends the session or the user cancels.
- Failed answer attempts should be recoverable by scanning a fresh host QR and generating a fresh answer QR.

## Preset Score Cards

The app uses pregenerated score-card presets.

Runtime app code does not randomly generate score-card layouts during play. Randomness for score cards happens in a repository script that creates and validates a fixed data file before release.

There are exactly 100 score-card presets:

- Card `#1`: standard score card.
- Cards `#2-34`: mixed numbers only.
- Cards `#35-67`: mixed colors only.
- Cards `#68-100`: mixed numbers and mixed colors.

The fixed ranges are part of the public app behavior. Users can identify a card by number and tell other local players which card to select.

All players in one game use the same score card:

- In local mode, this is social coordination. The app shows the selected card number, but each device is responsible for choosing the same card.
- In sync mode, the host-selected card is authoritative and sent to every joined player.

### Score Card Preset Data

Score-card preset data should live in one generated JSON file, such as `scoreCards.json`.

The repository should also include a deterministic generator/validator script.

Generation requirements:

- Use a fixed seed.
- Regenerating with the same seed should produce the same `scoreCards.json`.
- Validate all 100 cards after generation.
- Confirm every full score-card layout is unique across the full 100-card set.
- Keep the generated data checked into the repository.
- Do not generate cards dynamically in the app.

Each preset should include:

- Numeric id from `1` to `100`.
- Type: `standard`, `numbers`, `colors`, or `numbersAndColors`.
- Four rows.
- Eleven tiles in each row.
- Each tile's number.
- Each tile's color.

Row identity and tile color are separate concepts:

- A row is a visual/progression track.
- A tile color controls scoring and mixed-die eligibility.
- A tile number controls whether a white sum or mixed sum matches that tile.

### Standard Preset

Card `#1` is the current standard score card:

- Row 1: red, numbers `2-12`.
- Row 2: yellow, numbers `2-12`.
- Row 3: green, numbers `12-2`.
- Row 4: blue, numbers `12-2`.

Each standard row has one color across all tiles and the lock color matches that row color.

### Mixed Number Presets

Cards `#2-34` keep standard row colors but rearrange numbers.

Rules:

- Each row contains each number `2-12` exactly once.
- Numbers are uniformly sampled without replacement within each row.
- Generated mixed-number cards must be unique across the 33 mixed-number presets.
- Generated mixed-number cards must not duplicate any other preset.
- Because duplicate complete mixed-number cards are unlikely but possible, the generator must still check uniqueness.
- Row progression uses visual order, not numeric order.
- The final tile is the last visual tile, whatever number it contains.

### Mixed Color Presets

Cards `#35-67` keep standard number order but rearrange tile colors.

Rules:

- Each row has exactly one contiguous segment of each color.
- Each row therefore has exactly four color segments.
- Each color segment length is between 2 and 4 tiles, inclusive.
- Each row's 11 segment lengths must sum to 11.
- Each column contains exactly one red tile, one yellow tile, one green tile, and one blue tile.
- Each generated mixed-color card must satisfy all row-segment and column-balance constraints.
- Generated mixed-color cards must be unique across the 33 mixed-color presets.
- Generated mixed-color cards must not duplicate any other preset.
- The generator should sample uniformly from the legal color arrangements defined by these constraints.
- The generator should prefer enumerating or backtracking over the legal arrangement space and then sampling with the fixed seed, rather than using an app-runtime rejection shuffle.

The visual effect should look like standard rows were cut into colored segments and stitched together:

- Row bands still use the same shape, thickness, and color treatment as standard rows.
- Number tiles still use the same shape and tile treatment as standard tiles.
- Segment boundaries may use simple vertical divider lines between color segments.
- The row should not become neutral or white just because it contains multiple colors.

### Mixed Number And Mixed Color Presets

Cards `#68-100` combine both variations:

- Each row has numbers `2-12` exactly once in a mixed visual order.
- Tile colors follow the mixed-color constraints.
- Generated cards must be unique across the 33 combined presets.
- Generated combined cards must not duplicate any other preset.
- Row progression uses visual order.
- Tile color controls scoring and mixed-die eligibility.

### Score Card Picker Page

The Score Card Picker page is opened from:

- The Local tab's score-card Edit control.
- The sync host lobby's score-card Edit control.

Sync joiners cannot open the picker for a host-selected card.

The picker uses draft state:

- Opening the picker copies the currently committed selected card id and filter state into draft state.
- Clicking a card changes only the draft selected card.
- Pressing Random changes only the draft selected card.
- Changing filters changes only the draft filter state.
- Back discards the draft selected card and draft filters.
- Confirm applies the draft selected card and draft filters.
- Confirm is enabled even if nothing changed.

Picker filter controls:

- Four checkboxes: Standard, Numbers, Colors, Numbers + Colors.
- The persisted default is Standard checked and the other three unchecked.
- At least one checkbox must remain checked.
- The app must not allow all four filters to be unchecked.
- Filter state persists only after Confirm.
- If a draft filter change excludes the draft selected card, the picker automatically selects the first visible card.
- Because at least one filter remains checked, there is always at least one visible card.

Picker list behavior:

- Show the draft selected card at the top.
- Show minimal selected-card text such as `Card #37`.
- Show a Random button near the top.
- Random selects uniformly from the currently visible draft-filtered cards.
- After a card is clicked or Random selects a card, scroll to the top so the user can see the draft selected card.
- Below the top selected-card area, show a vertical scroll list of every card that passes the current draft filters.
- Each list item shows its card number and a row-only score-card preview.
- Do not show card type labels on individual card previews; users can infer type from the rows.

Picker previews:

- Show only the four score-card rows.
- Do not show penalties.
- Do not show scoring guide.
- Do not show score totals.
- Reuse the same score-row component and styling as the Play page.

When Confirm is pressed:

- In Local context, update the personal persisted selected card id and persisted filter state, then return to the Local tab.
- In Sync host context, update the host's personal persisted selected card id and persisted filter state, broadcast the new card id to joined players, then return to the Sync host lobby.
- In both contexts, the Home page preview updates to the confirmed card.

When Back is pressed:

- Discard the draft selected card.
- Discard the draft filter state.
- Return to the home tab that opened the picker.
- Leave the committed selected card and committed filter state unchanged.

## Sync Mode Network Model

Sync mode uses local WebRTC data channels between the host and each joined player.

The host is authoritative for shared game state:

- Player list.
- Player order.
- Current host identity.
- Selected score-card id.
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

Turn-finalizing sync messages should include both:

- The completed `turnId` being finalized.
- The next `turnId` that should be used after the advance.

Devices must ignore an automatic advance result when the completed `turnId` does not match the device's current turn.

### Sync Event Categories

Host-to-player events include:

- Lobby state.
- Game start.
- Dice roll result.
- Ready status summary.
- Automatic advance result.
- Player removal.
- Host start over.
- Session ended.

Player-to-host events include:

- Join metadata after the QR handshake completes.
- Current-player roll request.
- Ready payload.
- Voluntary exit.

Sync score-card requirements:

- Lobby state should include the host-selected score-card id.
- Game start should include the host-selected score-card id.
- Host start over should include the host-selected score-card id.
- When the host confirms a score-card change in the lobby, the host broadcasts the updated lobby state.
- Joined players should update their read-only sync card preview immediately when the lobby state changes.
- A joiner should not persist the host-selected score-card id as that joiner's personal score-card choice.

The host should be the source of truth for dice results. When the current player taps the dice in sync mode, that device sends a roll request to the host. The host validates that the request came from the current active player for the current `turnId`, generates the roll for the currently visible dice, and broadcasts the roll result to everyone.

### Sync Callback State

WebRTC callbacks are long-lived and must not read mutable play state from stale React closures.

Any sync callback that needs current play state should read from the latest-state snapshot. This snapshot must include rows, penalties, staged turn state, players, current player index, turn id, phase, role, ready payloads, host id, and selected player id.

### Sync Phases

Sync mode should keep setup state and active game state simple.

The app should not keep unused sync phases.

The target sync phase set is:

- `idle`: no active sync setup or session.
- `hostLobby`: host is creating/scanning QR codes and managing the pre-game player list.
- `showAnswer`: joiner has scanned a host QR and is showing an answer QR.
- `lobby`: joiner is connected and waiting for the host to start.
- `turn`: synced game is active and a turn is in progress.
- `gameOver`: final shared Qwixx game state is visible.

The app should delete stale or unused phases:

- `scanOffer` should not exist as a stored phase if scanning is already represented by camera modal state.
- `ended` should not exist as a stored phase if ended sessions return to `idle` with a visible message.

Session-ended state should be represented by:

- `syncPhase: "idle"`.
- Sync tab selected.
- A visible ended-session message such as `Ended`, `Removed`, or `Host disconnected`.

The app should not infer active game phases from scattered state flags.

### Permanent Host

The original host remains the host for the entire synced session.

Host authority cannot be transferred in v1.

If the host exits intentionally, disconnects unexpectedly, closes the app, loses power, or loses connection, the synced session ends for every player.

Host exit or host disconnect is not a Qwixx rules-based game over. It ends the sync session and returns players to the Sync tab with a session-ended message.

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

If a non-current player exits or is removed during `turn`:

- Any unfinalized Ready payload from that player is discarded.
- If all remaining active players are already Ready, the turn advances automatically.

If the current player exits or is removed during a turn:

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
- If the host exits or disconnects, the synced session ends for everyone.
- Host exit or disconnect returns players to the Sync tab with a session-ended message.

The legal options hint toggle:

- Shows or hides score-card legal-move hints.
- Defaults to off.
- Is visible to every player in both local and sync mode.
- Affects only the current device.
- Persists locally in local mode.
- Persists locally as the player's personal preference in sync mode when no host lock is active.
- Does not broadcast normal personal hint changes to other players.
- In sync mode, can be disabled by the host's shared hint lock-off control.

The sync host also has a separate hint lock-off control:

- Visible only to the host during synced play.
- Separate from the normal eye / eye-off personal hint toggle.
- When enabled, forces hints off on every connected device.
- When enabled, disables every player's normal personal hint toggle.
- When disabled, leaves every player's hints off.
- When disabled, re-enables every player's normal personal hint toggle.
- Does not remember or restore previous personal hint states.
- Broadcasts only the shared lock state, not personal hint preferences.

Controls should use icons whenever possible:

- Exit can use an X or back-style icon.
- Start over can use a rotate/reset icon.
- Legal options hint toggle should use an eye / eye-off icon and may omit visible text.
- Sync host hint lock-off should use a distinct lock-style icon and may omit visible text.

Use aria labels for icon-only controls.

Top action layout:

- Exit is in the left corner.
- Start over is in the right corner.
- The personal legal options hint toggle is in the top-right action group.
- In sync mode, the host-only hint lock-off control is also in the top-right action group.
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

If a row has been closed, the die matching that row's lock color disappears completely after the closing turn is committed:

- In local mode, this happens when Next is pressed.
- In sync mode, this happens when all active players are Ready and the turn advances automatically.

White dice are never removed.

Because row closure and tile color are separate in mixed-color presets:

- A closed row is disabled for the rest of the game.
- The removed die color may still appear as tiles on other open rows.
- Those tiles can still be selected by white sums.
- Those tiles cannot be selected by mixed sums after the matching colored die has been removed.

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
- The synced play player list shows each player's Ready state.
- There is no separate Ready-count strip.

Synced play player rows should show, from left to right:

- Waiting icon if the player is not Ready, or Ready icon if the player is Ready.
- Player name.
- Host crown immediately after the host player's name.
- Star if this is the local user's own row.
- Remove icon if the host is viewing another player.
- Nothing at the end if a non-host is viewing another player.

## Score Card Layout

The score card should be an app-native, cleaner, more elegant version of the attached physical score card image. It should preserve the same information without feeling crowded.

The Play page uses the selected score-card preset for its rows.

Card `#1` preserves the current standard rows:

- Red row: numbers 2 through 12.
- Yellow row: numbers 2 through 12.
- Green row: numbers 12 through 2.
- Blue row: numbers 12 through 2.

For every preset, visual order matters. "To the right" means to the right on screen.

In the standard preset:

- Red and yellow progress from 2 to 12.
- Green and blue progress from 12 to 2.

In mixed-number presets, progression follows the visual tile order, not numeric order.

In mixed-color presets, row identity and tile color are separate:

- A row is still one horizontal progression track.
- The row may contain multiple color segments.
- A tile's color determines scoring and mixed-die eligibility.
- The final tile's color determines the lock color and the die removed if that row closes.

Each row includes:

- Colored row band or colored row segments.
- Lightly color-tinted number tiles.
- A lock circle after the final number.

Number labels should be centered in their tiles, including double-digit labels.

Selected number tiles should use a clean black X mark.

Compact score-card previews on the Home page and Score Card Picker page:

- Show only the four score-card rows.
- Use the same row and tile styling as the Play page.
- Do not show penalties, scoring guide, or totals.

## Row Progression Rules

On each row, only numbers visually to the right of the rightmost selected number can be selected.

Examples:

- If red has 2, 4, and 7 selected, only red 8, 9, 10, 11, and 12 can be selected.
- If green has 12, 10, and 8 selected, only green 7, 6, 5, 4, 3, and 2 can be selected.

These examples describe the standard score card. In mixed-number layouts, the same rule applies to the visual positions instead of the numeric sequence.

Closed rows are disabled for the rest of the game.

## Final Number and Lock Rules

The final number in a row is the last visual number tile in that row.

In the standard score card, the final number is:

- 12 for red and yellow.
- 2 for green and blue.

In mixed-number score cards, the final number may be any number `2-12` depending on the row's visual order.

The lock icon has the same color as the final number tile.

The final number cannot be selected unless the user already has at least 5 selected numbers in that same row before selecting the final number. Staged selections earlier in the same turn count for this rule.

If the user selects the final number:

- The final number is marked.
- The row's lock icon is automatically marked.
- The lock icon counts as an additional point for the lock color.
- The row is staged to close.
- The row remains visually present until the turn is committed.
- The die matching the lock color remains visible until the turn is committed.

In local mode, if an opponent closes a row:

- The user can tap that row's lock icon after the dice stage is complete.
- This stages an opponent lock.
- The row's score controls are immediately disabled for the rest of the current turn.
- The row and corresponding die are not removed until Next is pressed.
- The lock icon uses the same selected visual style as an own row lock.
- The lock icon does not count as a point for the user.
- Multiple opponent locks may be staged in one turn.

In sync mode:

- There is no opponent row-closure control.
- Each player can only close rows on that player's own score card.
- A player who closes a row includes that closed row in their Ready payload.
- Row closures are not revealed or applied globally until all active players are Ready.
- If any active player's Ready payload closes a row, that row becomes globally closed for everyone when the turn advances automatically.
- A lock icon counts as a point only for the player who personally selected that row's final number.
- If another player closes a row, the local row still becomes disabled and visibly locked, but the lock icon does not count for the local score.
- If multiple players close the same row on the same synced turn, each of those players gets their own lock point, and everyone else gets only the global row closure.

After a turn commits any own, opponent, or synced row closure:

- The row is disabled for the rest of the game.
- The die matching that row's lock color disappears for the rest of the game.
- Closing a row does not close that color on other rows.
- Tiles of the removed die color can still be selected later by white sums on still-open rows.
- Tiles of the removed die color cannot be selected later by mixed sums because the matching colored die is gone.

If multiple rows close on one turn, all of them are committed together:

- In local mode, when Next is pressed.
- In sync mode, when all active players are Ready and the turn advances automatically.

## Selection Rules

The app should prevent illegal moves by disabling controls, not by allowing a move and rejecting it afterward.

At every point in the selection stage:

- Enable exactly the legal next presses.
- Disable all illegal presses.
- Recompute legal moves after every roll, white-sum selection, score-card selection, penalty selection, and staged lock.
- Keep defensive validation in handlers for stale events or double taps, but the normal UI must not offer illegal moves.

Legal-move visual hints are controlled by the legal options hint toggle:

- The default is off.
- The personal preference persists locally.
- In sync mode, each player's personal hint setting is private to that device.
- In sync mode, normal personal hint changes are not sent to the host or other players.
- In sync mode, the host can broadcast a shared lock-off override.
- When the shared lock-off override is active, all devices immediately set hints off.
- When the shared lock-off override is active, personal hint toggles are disabled for every player.
- When the shared lock-off override is released, hints remain off for every player.
- When the shared lock-off override is released, personal hint toggles become usable again.
- The app should not store previous personal hint states for restoration after the lock is released.
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
- Must be selected on a tile whose color matches the colored die.
- Must obey row progression and final-number rules.
- Only one mixed-sum selection is allowed per user turn.
- If a colored die has been removed by a row closure, that die cannot create mixed-sum legal moves.
- Removed die colors may still appear on open rows, but those tiles are legal only through white sums unless the matching die is still available.

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
- If the user reaches 4 penalties in sync mode, the player's Ready payload reports it, and the shared game ends when all active players are Ready.

In local mode, the Play page should also include a small control to indicate that an opponent has reached 4 penalties. Pressing it ends the game.

In sync mode:

- There is no opponent 4x penalty control.
- Players only enter their own penalties.
- Opponent 4-penalty game-over state is learned from synced Ready payloads.
- If a synced Ready payload ends the game by reaching 4 penalties, the penalty row shows a read-only 4x indicator after advance.

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

## Sync Ready And Automatic Advance

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
- The pending result becomes final only when all active players are Ready.
- If the current turn is discarded before all active players are Ready, the pending result is cleared.
- The player's controls lock until the next turn.
- Undo is disabled until the next turn.
- The player sends a Ready payload to the host.

The Ready payload contains only shared consequences:

- `turnId`.
- `playerId`.
- Rows closed by that player on this turn.
- Whether that player reached 4 penalties on this turn.

The Ready payload does not include the player's full private score card.

When synced advance applies shared consequences:

- The advance result includes `closedBy: { playerId, row }[]`.
- The advance result includes `penaltyPlayerIds: string[]`.
- `closedBy` identifies which players closed which rows.
- `penaltyPlayerIds` identifies which players reached 4 penalties.
- Everyone sees a toast after advance for row closures and 4-penalty events.
- Toasts use player names consistently.
- Toasts appear in the middle of the screen so the event is hard to miss.
- Toasts use a white background, black text, a subtle border, and a light shadow.
- Toasts do not block taps while they are visible.
- Row-closure toast examples:
  - `Bob closed yellow`.
  - `Bob and Alice closed yellow`.
  - `Bob closed yellow, Alice closed blue`.
- Penalty toast examples:
  - `Alice reached 4 penalties`.
  - `Alice and Bob reached 4 penalties`.
- If row-closure and penalty events both occur, the toast joins the messages with `. `.
- The sync 4x penalty-row indicator is read-only and reflects the latest automatic advance metadata.

When all active players are Ready:

- No player can edit the completed turn.
- All Ready payloads for the current `turnId` are applied together.
- Each device finalizes its own locked pending result for the current turn.
- Newly closed rows are revealed and globally closed for everyone.
- The host broadcasts the finalized turn result and the next turn starts automatically.
- Dice for newly closed rows are removed.
- Game-over conditions are checked.
- If the game is not over, the game advances to the next active player in order.

If the current player is the last active player, wrap to the first active player. There are no rounds to configure.

Automatic advance result requirements:

- The host must broadcast the completed `turnId`.
- The host must broadcast the next `turnId`.
- Joiners must ignore an advance result whose completed `turnId` does not match their current turn.
- The host must build row-closure metadata from the active Ready payloads for the completed turn.
- The host must build 4-penalty metadata from the active Ready payloads for the completed turn.
- The host must apply and broadcast the same row-closure and 4-penalty metadata.
- Joiners must apply the metadata from the host rather than recomputing shared results from private assumptions.

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

- Automatic advance applies Ready payloads that bring the shared closed-row count to two.
- Automatic advance applies a Ready payload from any player who reached 4 penalties.
- The host disconnects unexpectedly and the synced session ends.
- The host intentionally ends the synced session.
- Player exits or removals leave fewer than one active player.

When the game is over:

- Nothing about the page layout changes.
- Scores remain visible and final.
- The local Next or Ready button is disabled as appropriate.
- Exit remains available.
- Local Start over remains available.
- Sync Start over remains available only to the host.

## Scoring

Scoring updates live.

Each color's score is based on the count of selected tiles of that color plus any lock icon of that color earned by the user.

Scoring is color-based, not row-based:

- A selected red tile counts toward the red total regardless of which row it is in.
- A selected yellow tile counts toward the yellow total regardless of which row it is in.
- A selected green tile counts toward the green total regardless of which row it is in.
- A selected blue tile counts toward the blue total regardless of which row it is in.
- An owned lock counts toward the color of that row's lock icon.
- In standard card `#1`, this produces the same totals as the current row-based visual layout because each row has one color.

Opponent lock icons do not count for the user.

In sync mode:

- The local display may include the player's pending current-turn selections after Ready.
- Pending current-turn selections become final only when all active players are Ready.
- If the current turn is discarded before all active players are Ready, pending selections are removed and scores return to the previous final state.

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
- Personal selected score-card id.
- Score Card Picker filter state.

Persist locally for local mode:

- Player roster.
- Selected user player.
- Active game state.
- Active game selected score-card id.
- Active game score-card layout.
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
- The host player's personal selected score-card id when that device is hosting.
- The current sync screen state where practical.
- The local player's private score-card marks.
- The local player's private penalties.
- The local player's score totals.
- The local player's unready current-turn undo history.

Do not persist a joined host's selected score-card id as the joiner's personal selected score-card id.

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
- `qwixx.selectedScoreCard.v1`
- `qwixx.scoreCardFilters.v1`
- `qwixx.activeGame.v1`
- `qwixx.syncName.v1`

Restoring the app in local mode should resume the active game as it appeared before refresh or app close.

Local Exit clears the active game state but keeps roster and selected user player.

Local Start over replaces the active game state with a fresh game using the current game players and selected user player.

Sync Exit clears the local sync session state. Host Start over replaces the synced game state with a fresh game using the current connected players and order.

## Preset Score Card Implementation Plan

The preset score-card feature should be implemented in stages. The goal is to replace row-color assumptions with a small layout model, not to layer preset exceptions on top of the current standard-card code.

### Step 1: Data Model And Generated Presets

Create the score-card data model first.

Recommended types:

- `ScoreCardPreset`.
- `ScoreCardType`.
- `ScoreCardRow`.
- `ScoreCardTile`.
- `ScoreCardFilters`.

The model should represent:

- Preset id.
- Preset type.
- Four rows.
- Eleven tiles per row.
- Tile number.
- Tile color.

Use this model for the standard card too. Standard Qwixx should be data, not a special rendering path.

Create a deterministic generation script:

- Use a fixed seed.
- Generate card `#1` directly as the standard card.
- Generate 33 mixed-number cards.
- Generate 33 mixed-color cards.
- Generate 33 mixed-number-and-color cards.
- Reject duplicate full card layouts within each generated category and across the full 100-card set.
- For mixed-color layouts, sample from legal arrangements only after row-segment and column-balance constraints are satisfied.
- Prefer an offline enumeration/backtracking generator that can prove every generated card is legal before writing JSON.
- Write one checked-in JSON file containing all 100 presets.

Create a validator script or validator module:

- Confirm there are exactly 100 cards.
- Confirm ids are exactly `1-100`.
- Confirm ids and type ranges match the required fixed ranges.
- Confirm each row has exactly 11 tiles.
- Confirm each row has numbers `2-12` exactly once.
- Confirm every tile color is one of red, yellow, green, blue.
- For mixed-color and combined cards, confirm each row has exactly one contiguous segment per color.
- For mixed-color and combined cards, confirm every segment length is 2-4.
- For mixed-color and combined cards, confirm every column contains exactly one tile of each color.
- Confirm generated category uniqueness.
- Confirm global full-layout uniqueness across all 100 cards.

### Step 2: Render Through The Layout Model

Refactor score-card rendering to read from `ScoreCardPreset`.

Keep the visible standard card unchanged when preset `#1` is selected.

Do not change gameplay rules in this step except where necessary to render from layout data.

Rendering requirements:

- Rows and tiles come from the selected preset.
- Tile labels come from `tile.number`.
- Tile colors come from `tile.color`.
- Lock color comes from the final tile's color.
- Row backgrounds support color segments.
- Segment boundaries use simple vertical divider lines when a row color changes.
- Compact previews and full Play page rows reuse the same row component.
- Compact previews render rows only.
- Full Play page renders rows plus penalties, scoring guide, and totals.

### Step 3: Persist And Select The Personal Card

Add personal selected-card state:

- Read from `qwixx.selectedScoreCard.v1`.
- Default to card `#1`.
- Validate saved ids against the preset data.
- Fall back to card `#1` if saved data is missing or invalid.

Add persisted picker filter state:

- Read from `qwixx.scoreCardFilters.v1`.
- Default to Standard checked and all other filters unchecked.
- Validate saved filter state.
- Fall back to the default if saved data is missing, invalid, or has no checked filters.
- The committed selected card should always match the committed filters.
- If loaded persisted filters exclude the loaded selected card, choose the first card visible under the loaded filters.

Show the selected-card preview on:

- Local tab.
- Sync host lobby.
- Sync joiner lobby only after joining and receiving the host card.

Do not show a card preview on the initial Sync tab before hosting or joining.

### Step 4: Build The Score Card Picker Page

Add the Score Card Picker page with draft state.

Implementation requirements:

- Opening the picker records the return tab/context.
- Opening the picker copies committed selected card id and committed filters into draft state.
- Back discards draft state.
- Confirm commits draft state.
- Random selects from currently visible draft-filtered cards.
- Card click selects that draft card.
- Card click and Random scroll to the top selected-card area.
- Filter changes update draft filters only.
- Unchecking the final checked filter is not allowed.
- If a filter change excludes the draft selected card, choose the first visible card.

Keep the picker UI simple:

- Top action row with Back and Confirm.
- Four checkboxes.
- Draft selected card preview.
- Random button.
- Vertical scroll list of visible cards.
- Card number text only, such as `Card #37`.
- No card type text labels on list items.

### Step 5: Update Rule Helpers For Layout-Aware Play

Replace row-color assumptions with layout lookups.

Rules helpers should answer these questions from the selected layout:

- What number is at row/index?
- What color is at row/index?
- What visual index contains a row/number selection?
- What is the final tile for this row?
- What is the lock color for this row?
- Which die color is removed when this row closes?

Selection changes:

- White-sum legal moves match tile number on any open row.
- Mixed-sum legal moves match tile number and tile color.
- A removed colored die creates no mixed-sum legal moves for that color.
- Row progression continues to use visual row index.
- Same-row white-before-mixed logic continues to use visual row index.
- The final tile rule uses the last visual tile, not a hard-coded number.

Closure changes:

- Store closed rows as row ids or row indexes.
- Derive removed dice from the lock colors of closed rows.
- Closing a row disables only that row.
- Closing a row does not disable that color elsewhere.

Scoring changes:

- Count selected tiles by tile color.
- Count owned locks by lock color.
- Do not count opponent/shared locks for the local score.
- Preserve the existing scoring guide.

### Step 6: Wire Local Mode

Local game start should save the selected score-card id into the active game.

Local active-game persistence should restore:

- Score-card id.
- Score-card layout.
- Row marks using row/index or another layout-stable representation.
- Row closures.
- Removed dice derived from closed rows and lock colors.

Local Start over should keep:

- Same players.
- Same selected user player.
- Same selected score-card id.

Local Exit should keep:

- Personal selected-card id.
- Persisted picker filters.

### Step 7: Wire Sync Mode

Sync host behavior:

- Host lobby uses the host's personal selected-card id.
- Host can open picker before game start.
- Confirming picker changes broadcasts updated lobby state.
- Host game start includes selected score-card id.
- Host Start over includes selected score-card id.

Sync joiner behavior:

- Initial Sync tab shows no card before joining.
- After joining, lobby state sets runtime sync score-card id.
- Joiner displays that card read-only.
- Joiner does not persist that id as personal selected-card id.
- Game start uses the host-selected id.

Sync play behavior:

- Everyone uses the same host-selected score-card layout.
- Ready payloads continue to send shared consequences, not full private score cards.
- Row closure payloads identify closed rows, not closed colors.
- Advance result applies closed rows and derives removed dice from those rows' lock colors.

### Step 8: Verification

Add validation tests for preset data:

- Run the preset validator in `npm run verify:ui` or a separate script called by the verifier.
- Fail if any card violates the fixed ranges, number uniqueness, color segment constraints, column color constraints, category uniqueness, or global uniqueness requirements.

Add UI checks:

- Home Local tab shows card `#1` by default.
- Initial Sync tab before hosting/joining shows no card preview.
- Sync host lobby shows the host selected card and Edit control.
- Sync joiner lobby shows host selected card read-only after joining.
- Picker cannot uncheck all filters.
- Picker Back discards draft card and filters.
- Picker Confirm persists draft card and filters.
- Picker Random selects only from visible filtered cards.
- Filter changes that exclude the selected draft card auto-select the first visible card.

Add play-rule checks:

- Standard card behavior remains unchanged.
- Mixed-number progression uses visual order.
- Mixed-color white sums can select any matching number regardless of tile color.
- Mixed-color mixed sums can select only matching tile colors.
- Closing a row removes the die matching the final tile color.
- Closed-row die removal does not disable same-color tiles on other open rows for white sums.
- Scoring counts by tile color, not row.

## Hardening And Simplification Pass

The next implementation pass should make the app simpler and stronger by deleting stale state paths and replacing duplicated logic with smaller single-purpose helpers.

The goal is less code and tighter gates, not a larger architecture.

### Handshake Gate Cleanup

Problem to fix:

- The host can currently recognize an answer QR and continue toward Start before the WebRTC data channel has actually opened.
- A valid answer QR can fail because devices are not on the same local network.
- That failure must be visible before the host starts the game.

Required changes:

- Add one explicit pending-answer state for the host, such as `isAcceptingAnswer`.
- Set the pending-answer state to true immediately after the host scans an answer QR.
- Clear the pending-answer state in both success and failure paths.
- Disable host Start while the pending-answer state is true.
- Disable host Scan while the pending-answer state is true.
- Keep the host in the lobby while the pending answer is being accepted.
- Show the host-side failure message in the lobby when answer acceptance fails.
- Do not add a player to the host lobby until the data channel opens.
- Do not broadcast lobby state for a player until that player is fully connected.
- After a failed answer acceptance, create or require a fresh host QR before retrying.

Transport requirements:

- `SyncHostTransport.acceptAnswer` should keep the answer in the pending-offer collection until the channel opens.
- `SyncHostTransport.acceptAnswer` should move a peer from pending to connected only after `setRemoteDescription` succeeds and `waitForChannelOpen` resolves.
- If `setRemoteDescription` or `waitForChannelOpen` fails, the pending offer should be closed and removed.
- Failed answer acceptance should not leave a peer in the connected peer map.
- Failed answer acceptance should not leave a stale pending offer that appears usable.
- Broadcasting should only send to opened channels.

### Sync Phase Cleanup

Problem to fix:

- Sync phase currently includes stale or unused values.
- Some values describe setup UI state while others describe active shared game state.

Required changes:

- Delete `scanOffer` from the stored sync phase type.
- Delete `ended` from the stored sync phase type.
- Keep ended-session display as `idle` plus a message.
- Keep scanner state in `syncCameraMode`, not in `syncPhase`.
- Keep the target sync phase values limited to `idle`, `hostLobby`, `showAnswer`, `lobby`, `turn`, and `gameOver`.
- Update tests so they verify the remaining phase behavior rather than guarding stale deleted names.

### Legal Mark Helper Cleanup

Problem to fix:

- Legal score-card enablement and legal hint roles are calculated by two helpers that walk the same candidate marks.
- This creates a risk that a tile is enabled by one rule path but hinted by another.

Required changes:

- Replace separate legal-key and legal-role scans with one helper that returns `Map<string, Set<MarkRole>>`.
- Use the map keys for enabled score-card tiles.
- Use the map values for hint roles.
- Keep all rule behavior unchanged:
  - Non-current sync/local opponent turns may choose at most one white-sum number.
  - Current-player turns may choose valid white and/or mixed interpretations.
  - Same-row two-mark moves still require the white interpretation to be visually first.
  - Different-row two-mark moves do not require click order.
  - Penalty selection still disables number selection.
- Delete the old duplicate helper after the combined helper is in place.

### Play-State Commit Cleanup

Problem to fix:

- Several code paths manually set the same play-state fields and latest sync snapshot fields.
- Manual repeated state commits make it easy to forget one field when adding future sync behavior.

Required changes:

- Add one small helper for applying a complete play-state patch.
- The helper should update React state and the latest sync snapshot together when relevant.
- The helper should stay simple and local to `App.tsx`; do not add a reducer or state library.
- Use the helper in:
  - Local game start.
  - Sync play start.
  - Sync advance result application.
  - Host automatic sync advance.
  - Sync turn discard.
  - Sync session end.
  - Local/sync exit reset when practical.
- Keep user-visible behavior unchanged.
- Delete repeated manual setter blocks only after the helper covers the same fields clearly.

### Sync Wire Parser Cleanup

Problem to fix:

- QR payload parsing and WebRTC data-channel message parsing share the same broad parser path.
- Those are different pipelines and should not need to understand each other's formats.

Required changes:

- Keep compact QR parsing for `QWO:` host offers and `QWA:` join answers.
- Keep legacy `qwixx:` QR parsing only for QR payload compatibility.
- Parse data-channel messages as plain JSON wire messages.
- Do not attempt to parse QR compact payloads from data-channel messages.
- Keep outgoing data-channel messages as JSON.
- Keep outgoing QR payloads compact and QR-alphanumeric-safe.

### Automatic Advance TurnId Cleanup

Problem to fix:

- The advance result should explicitly identify the turn being finalized as well as the next turn.

Required changes:

- Add completed `turnId` to `advanceResult`.
- Keep `nextTurnId` for the next turn.
- Host should send both fields.
- Host and joiners should apply the advance only if completed `turnId` matches the current sync turn.
- Stale `advanceResult` messages should be ignored.
- Existing row-closure and 4-penalty metadata should stay unchanged.

### Persistence Documentation Cleanup

Problem to fix:

- The spec listed a sync local-state storage key that is not currently implemented.

Required changes:

- Do not list storage keys that are not used by the app.
- If sync private persistence is added later, document the exact data shape and behavior before adding a new key.

### Verification Cleanup

Problem to fix:

- The UI verifier includes useful runtime checks, but also relies on many source-string assertions.
- Source-string assertions are brittle when the code is intentionally reorganized.

Required changes:

- Keep source checks only for high-level deletion guards that are hard to test otherwise.
- Prefer runtime checks for behavior.
- Add a transport-level test where a host decodes an answer QR but the channel fails to open.
- Verify the failed answer attempt does not add a player.
- Verify Start is disabled while the host is accepting an answer.
- Verify a failed answer attempt leaves the host in lobby with a visible failure message.
- Verify a successful answer attempt adds the player only after the channel opens.
- Verify stale `advanceResult` messages are ignored when their completed `turnId` does not match.
- Keep existing QR compact-prefix checks.
- Keep existing local play, undo, sync ready, and auto-advance smoke checks.

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
- Colored row bands or colored row segments with lightly color-tinted number tiles.
- Normal number tiles should be clearly lighter than their surrounding row band or segment but tinted enough that pure white legal hints stand out.
- Normal number tiles should have crisp edges without a separate pale or white border between the tile and row background.
- Color total boxes should use the same color-tinted fills as matching score-card number tiles.
- Mixed-color rows should look like standard colored rows cut into valid color segments, not like neutral rows with colored labels.
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
- Run the preset score-card validator.
- Verify preset data contains exactly 100 cards with fixed category ranges.
- Verify mixed-number, mixed-color, and combined presets satisfy all generation constraints.
- Verify the Home tabs work and Local mode preserves the agreed player controls.
- Verify Local home shows the personal selected score card and allows editing it.
- Verify initial Sync setup shows no score card before hosting or joining.
- Verify Sync host lobby shows and can edit the host selected score card before start.
- Verify Sync joiner lobby shows the host selected score card read-only after joining.
- Verify the Score Card Picker draft Back/Confirm behavior.
- Verify picker filters persist only after Confirm and cannot all be unchecked.
- Verify picker Random selects from the current visible filtered cards.
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
- Verify all active players Ready automatically advances to the next turn.
- Verify no sync Advance button or between-turn phase appears.
- Verify automatic sync advance applies all Ready payloads, row closures, penalty game-over state, and next-player selection together.
- Verify local Exit and Start over confirmation pop-ups.
- Verify sync host-only Start over confirmation and fresh-game restart without QR resync.
- Verify sync non-host Exit removes that player and future turns skip them.
- Verify sync current-player exit or host removal discards the current turn and skips to the next active player.
- Verify sync host Exit is allowed even when other players remain and sends `sessionEnded`.
- Verify unexpected host disconnect ends the synced session for everyone.
- Verify local row closing, staged locks, die removal after Next, and multiple row closures.
- Verify sync row closing, shared row closure reveal on automatic advance, die removal after automatic advance, and multiple row closures.
- Verify mixed-number card progression uses visual order.
- Verify mixed-color card selection uses tile color for mixed sums.
- Verify mixed-color card scoring counts tile colors rather than row identity.
- Verify closing a mixed-color row removes the final tile/lock color die but leaves same-color tiles on other open rows selectable by white sums.
- Verify scoring, penalties, and game-over conditions in both modes.
- Verify local reload persistence.
- Verify sync reload or disconnect behavior matches the no-late-reconnect v1 rule.
- Verify PWA build output and service worker generation.

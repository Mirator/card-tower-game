Original prompt: Implement the game based on card_tower_game.md using the full Card Tower Game v1 release-level plan.

- Initialized planning and gathered requirements from card_tower_game.md.
- Next: scaffold Phaser + TypeScript project foundation and begin core engine implementation.

## Implementation Progress
- Set up Vite + TypeScript + Phaser project structure.
- Implemented full 60-card dataset and core game types/constants.
- Added deterministic RNG, reducer-driven engine, card effect resolver, status lifecycle, and victory logic.
- Added heuristic AI decision system with lethal/prevent-lethal priorities.
- Implemented localStorage meta persistence (wins/losses/matches + settings).
- Built Phaser scenes: Boot, Menu, Game, including UI layout, hand interactions, discard mode, AI turn flow, rematch/menu overlay, fullscreen toggle.
- Exposed automation hooks: window.render_game_to_text and window.advanceTime.
- Next: write tests, run validation, fix defects, and execute Playwright verification loop.

## Validation and Fixes
- Added Vitest suites for engine, AI, and full-match simulation; all tests pass.
- Fixed RNG bug that could produce negative random values and corrupt deck shuffles.
- Added global testing hooks in main app and scene-level testing API to support deterministic automation.
- Added favicon data URL to eliminate 404 console noise during automated runs.
- Added keyboard start shortcuts (Enter/Space) for automation reliability.
- Added automation interaction bridge via `window.__game.interact` for scripted end-to-end gameplay checks.

## Automated Playtest Artifacts
- Primary validated run: `output/web-game-final2/`
  - screenshots: `shot-0.png`, `shot-1.png`, `shot-2.png`
  - text state: `state-0.json`, `state-1.json`, `state-2.json`
  - no `errors-*.json` generated (no console/page errors captured).
- Gameplay progressed across turns and AI actions in both screenshots and state dumps.

## Remaining Notes
- Production bundle is large (~1.25MB JS) because Phaser is included in a single client chunk; this is expected for the current setup.

## Chunk Warning Fix
- Refactored app bootstrap to lazy-load Phaser and scenes via dynamic imports.
- Added Vite manual chunking so Phaser is emitted as a dedicated `phaser` chunk.
- Tuned `build.chunkSizeWarningLimit` to 1400KB to match expected Phaser footprint and suppress false-positive warning.
- Verified with `npm run build`: warning no longer appears.

## Audit Follow-up Fixes
- Fixed AI prevent-lethal logic so it simulates whether the player has a lethal next action, including bypass-wall tower damage and defensive counters such as Shield.
- Added a regression test where AI at low tower/high wall chooses Shield against Arcane Blast instead of ignoring the bypass threat.
- Gated browser automation globals (`render_game_to_text`, `advanceTime`, `__phaserGame`, `__game`) behind development mode or `VITE_EXPOSE_TEST_HOOKS=true`.
- Added compact narrow-screen layouts for MenuScene and GameScene so phone-width screens no longer clip the title, panels, or hand row horizontally.
- Verified with `npm run lint`, `npm test`, `npm run build`, the develop-web-game Playwright client, a 375x667 dev smoke interaction, and a production preview check confirming automation globals are undefined.

## Timer Removal
- Removed the turn countdown UI from `GameScene` and deleted the turn timer state/reset/update logic.
- Kept `advanceTime(ms)` for automation because it drives deterministic testing and no longer advances any player-facing turn timer.
- Removed `timerDisplaySeconds` from `render_game_to_text`.
- Updated the product/UI specs to describe v1 as fast but untimed.
- Verified with `npm run lint`, `npm test`, `npm run build`, desktop Playwright smoke, and 375x667 mobile smoke; screenshots show no timer UI and text state has no timer field.

## Animation Pacing
- Added shared animation pacing helpers in `GameScene` and slowed visible tweens by 50%.
- Increased the AI response delay from 750ms to 1125ms to match the calmer turn rhythm.
- Added smoother easing to deck draw, card play, tower damage/heal, floating number, and hand reveal tweens.
- Verified with `npm run lint`, `npm test`, `npm run build`, the develop-web-game smoke client, and a mid-action Playwright capture confirming longer-lived floating numbers/card motion without console errors.
- Extended resource/generator floating notifications to stay visible 2x longer than other floating text so resource changes are easier to read.
- Added an enemy card reveal step: AI-selected cards are shown in the center for a short hold before their effects/resources resolve and the turn passes back.

## UI Redesign Pass
- Replaced the large opponent info header with a slimmer turn bar showing current turn, compact enemy tower/wall, goal, and deck count.
- Rebuilt the center battlefield as the primary stage with larger towers, wall shields, tower progress meters, danger glow, attack lanes, and impact bursts.
- Enlarged player hand cards, added hover/selection lift, clearer affordability states, a darker card-table cockpit, and shorter persistent controls.
- Reworked resource panels so generator income is shown as +X, both sides use the same internal reading order, and floating resource notifications spawn outside the panels.
- Added a compact battle feed and routed played-card travel toward affected towers/resource panels before impact.
- Updated render_game_to_text coordinate notes to match the new battlefield/hand/feed UI model.

## UI/UX Command Pass
- Added an explicit selected-card command panel with Play and Discard buttons, ready/missing-resource status, and disabled Play state when unaffordable or outside the player action window.
- Added default card selection, richer effect impact previews, and keyboard actions: Enter plays the selected card, Backspace/Delete discards it.
- Updated `render_game_to_text` UI payload with selected card name, playability, and impact preview so automation/state inspection matches the visible command surface.
- Verified the Play button path in-browser: selected playable card resolves, turn advances, and enemy reveal appears without console errors.

## 30-Card Basic Deck Pass
- Reworked the active deck model from the full 60-card library to a 30-card physical starter deck with duplicate basic cards.
- Added duplicate-safe player hand targeting via optional `handIndex` on play/discard actions and slot-based UI selection.
- Updated specs, root GDD, and README to document the 30-card deck, discard reshuffle loop, and simpler active card list.
- Added tests for deck composition, discard reshuffle, and duplicate hand-slot targeting.
- Verified with `npm run lint`, `npm test`, `npm run build`, a starter-deck doc consistency script, and Playwright smoke artifacts in `output/basic-deck-smoke/`.

## Card Screen UI Refresh
- Reworked the live hand cards into rounded physical-card components with domain-tinted fills, top-left resource icons, top-right cost badges, center illustrations, and compact bottom effect text.
- Added a top-center face-up draw preview card beside the deck and renamed the duel presentation to `Black` vs `Red` with `Castle` / `Wall` labels in the main HUD.
- Changed unaffordable card clicks to stay quiet instead of writing failure logs, while keeping selection, keyboard, touch, and explicit Play/Discard actions intact.
- Updated `specs/09-ui.md`, `README.md`, and `card_tower_game.md` to match the new layout and interaction wording.
- Verified with `npm run lint`, `npm test`, `npm run build`, a direct Playwright page check on `http://127.0.0.1:4173`, and smoke screenshots/state dumps in `output/ui-card-smoke/`.

## Palette Refresh
- Changed the resource/card language so weapons use crimson red, bricks use sandstone/ochre, and crystals remain blue.
- Reserved green for positive feedback such as readiness, healing, and gains instead of attack card identity.
- Brightened disabled card fills, borders, badge colors, and muted icon/text colors so the rightmost unplayable card remains readable against the dark hand surface.
- Updated the UI spec, root GDD, and README to describe the revised color semantics.
- Verified with `npm run lint`, `npm test`, `npm run build`, and a fresh Playwright smoke pass on `http://127.0.0.1:4173` with artifacts in `output/palette-smoke/`.

## Card Flow + Enemy Hand Refresh
- Replaced the old top draw-preview HUD with a card-flow strip showing the `Black` draw pile, both discard piles, center turn/goal summary, and a persistent hidden `Red` hand.
- Added enemy turn staging so the AI visibly selects one hidden card before revealing it to the center stage or cycling it into discard.
- Routed played cards and discards into the top discard piles visually, and added reshuffle feedback when discard loops back into draw.
- Extended `render_game_to_text()` so automation can inspect deck/discard counts, discard top cards, hidden enemy hand state, and pending/revealed AI card state.

## Card Face Style Pass
- Reworked the player hand cards from wide UI tiles into taller portrait cards with thick domain borders, paper-style inner panels, corner resource icons, large top-right costs, centered illustrations, and lower anchored effect text.
- Updated the enemy reveal card to use the same portrait card language so the AI turn presentation matches the player hand.
- Verified the new card-face treatment with `npm run lint`, `npm test`, `npm run build`, and a fresh Playwright smoke capture on `http://127.0.0.1:4173`.

## Card Lane Polish
- Raised the hand row so the portrait cards sit higher and feel more centered in the bottom cockpit.
- Removed the visible battle/event feed from the lower HUD; floating feedback and the top turn strip now carry the moment-to-moment state changes.
- Restyled disabled cards with darker neutral paper faces, gray borders, dimmer icons, and slightly reduced opacity so they read as unavailable without blending into the tray.

## Card-First Refinement
- Rebuilt the bottom cockpit around a centered hand lane with compact side rails so the cards remain the dominant element on desktop and collapse into a tighter stacked layout on narrow screens.
- Added a reveal-focused top stage that stays hidden during idle play and expands enemy card moments into a clearer top-center presentation.
- Strengthened the physical-card treatment with a deeper frame seam, stronger shadowing, and explicit illustration keys for the active 30-card deck so more cards use specific icon motifs instead of generic fallbacks.
- Updated automation state output so `render_game_to_text().ui` now exposes `bottomHudLayout`, `topStageMode`, and `topStageCardId` alongside the existing deck/discard and enemy-hand fields.
- Synced `specs/09-ui.md`, `specs/03-technical-architecture.md`, `card_tower_game.md`, and `README.md` to the refined card-first layout and reveal-stage language.
- Validation: `npm run lint`, `npm test`, `npm run build`, plus desktop and narrow Playwright smoke captures under `output/card-first-final-desktop/` and `output/card-first-final-mobile/`.

## Bottom Tray Drag Pass
- Removed the fixed bottom left/right command boxes and widened the hand tray so the cards own the whole lower interaction area.
- Added hover/drag detail popups for card name, current resource ownership versus cost, and effect summary instead of a persistent selected-card panel.
- Added drag-to-center play and drag-down discard while keeping click-to-play, right-click discard, and keyboard shortcuts as secondary inputs.
- Added dev-state fields `hoverPreviewCardId` and `draggingCardId` to `render_game_to_text().ui` for smoke-test visibility into the transient tray interactions.
- Updated the UI docs and README to describe the drag-first bottom tray.

## Hand Visibility Audit Fix
- Audited the “missing cards” report and confirmed it was a HUD rendering bug, not a deck/refill bug: player state still held 6 cards while repeated `updateHud()` calls kept restarting full-hand fade-ins from alpha 0.
- Split player-hand syncing away from the general HUD refresh so routine AI/tower/top-strip updates no longer destroy and recreate the tray.
- Added stable hand sync keys for hand contents, affordability state, layout, and selected slot; same-hand updates now refresh existing card visuals in place instead of rebuilding them.
- Reworked hand entry animation so card arrivals use a subtle position/scale settle without dropping card alpha below the intended visible value, preventing partial-hand flashes on turn return.
- Added `renderedHandCardCount` and `fullyVisibleHandCardCount` to `render_game_to_text().ui` for deterministic visibility checks.
- Verified with `npm run lint`, `npm test`, `npm run build`, the develop-web-game Playwright client (`output/hand-visibility-client/`), and custom desktop/mobile turn-transition captures in `output/hand-visibility-regression/`; desktop/mobile return-to-player frames now report and show 6 visible cards.

# Existing UI Specification (As Implemented)

## Purpose
This document specifies the **current UI implementation** of Card Tower Game (menu + in-game screens) based on the existing Phaser scenes.

## Runtime and Rendering
- Renderer: Phaser Canvas renderer (`Phaser.CANVAS`)
- Scale mode: `Phaser.Scale.RESIZE`
- Auto-center: `Phaser.Scale.NO_CENTER`
- Initial game size: `window.innerWidth` x `window.innerHeight`
- Scene stack: `BootScene` -> `MenuScene` -> `GameScene`
- Theme direction: navy/steel background with cream panels and orange action CTAs

## Global Visual Style
- Typography:
  - Primary UI font in scenes: `Georgia`
  - Page CSS font fallback: `'Trebuchet MS', 'Segoe UI', sans-serif`
- CSS background (document-level): radial blue gradient
- Canvas display:
  - `display: block`
  - `margin: 0 auto`
- Color motifs:
  - Dark navy backgrounds (`0x111b2c`, `0x132034`, `0x1f3348`, `0x243b56`)
  - Cream panel surfaces (`0xf0eee7`, `0xf2efe4`, `0xf3efe4`)
  - Orange buttons (`0xd86f3d`, hover `0xe7844f` / `0xe78854`)
  - Domain card colors:
    - Bricks: `0xc18f62`
    - Weapons: `0xb6504b`
    - Crystals: `0x4a6fb8`

## Menu Screen (`MenuScene`)

### Layout
- Full-screen gradient background.
- Header block:
  - Title: `CARD TOWER DUEL`
  - Subtitle: `Build your tower or collapse theirs in one-card turns.`
- Center stats panel (`520x190`) labeled `Career Stats`.
- Stats line: matches, wins, losses from persisted meta.
- `UI Motion` toggle:
  - Green `Enabled` (`0x2f8f5c`)
  - Red `Disabled` (`0xa14f4f`)
- Primary CTA button:
  - Label: `Start Duel`
  - Starts `GameScene`
- Footer hint:
  - `Tap cards to play. Toggle Discard mode to cycle your hand.`

### Inputs
- Pointer:
  - Hover feedback on start button and toggle button.
  - Click `Start Duel` -> enter match.
  - Click motion toggle -> persist setting in localStorage.
- Keyboard:
  - `Enter` or `Space` once -> enter match.

## Game Screen (`GameScene`)

### Structural Regions
- Top status panel (`y ~ 84`):
  - AI tower/wall/resources/generators.
  - Turn label at top-right (`Turn N • Your Turn / AI Turn / Match Over`).
- Middle panel (`y ~ 348`):
  - Left: rolling log (last ~8 entries).
  - Right: card detail panel (name, cost, text, tags, affordability).
- Bottom panel (`y ~ 696`):
  - Player tower/wall/resources/generators.
  - Horizontal hand of 6 card slots.
  - Discard mode toggle (`Discard: Off/On`) near right side.
  - Hint text near lower-right.

### Card UI Behavior
- Hand cards are rendered as containers with:
  - Domain-colored background
  - Title text
  - Compact cost/effect text
- Affordability:
  - Affordable cards: higher opacity
  - Unaffordable cards: reduced opacity
- Selection:
  - Hover updates detail panel
  - Click sets selected card and highlights border
- If `animationsEnabled` is true:
  - Cards fade in with short staggered tween.

### Turn Interaction
- Normal mode (`Discard: Off`):
  - Clicking affordable card attempts play.
  - Unaffordable click logs warning message.
- Discard mode (`Discard: On`):
  - Clicking card discards it, then proceeds turn.
- AI turn:
  - Hint text switches to `AI is evaluating best move...`
  - AI action executes after `AI_DELAY_MS`.

### Match End Overlay
- Full-screen dark translucent backdrop.
- Result title:
  - `Victory` if player wins
  - `Defeat` if AI wins
- Two action buttons:
  - `Rematch` -> starts new match in place
  - `Back to Menu` -> returns to `MenuScene`

## Controls
- Menu:
  - `Enter` / `Space` = start duel
- In-game:
  - Pointer click on cards and buttons
  - `F` = toggle fullscreen
  - `Esc` = exit fullscreen

## Persistence-Coupled UI Data
- From localStorage meta:
  - Career stats: wins, losses, matches played
  - UI setting: `animations` (on/off)
- On match end:
  - UI-triggered stats update:
    - `matchesPlayed += 1`
    - increment winner-side metric (wins or losses)

## Automation/Debug UI Hooks Exposed on `window`
- `render_game_to_text(): string`
  - Returns JSON summary of current visible game state.
- `advanceTime(ms: number): void`
  - Advances deterministic update flow for automation.
- `__game.interact(): void`
  - Helper to play first affordable player card (or first hand card fallback).
- `__game.clearInput(): void`
  - Clears selected card state.

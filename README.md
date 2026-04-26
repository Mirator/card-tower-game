# Card Tower Game

A Phaser + TypeScript implementation of the browser tower-card duel from `card_tower_game.md`.

## Features
- 30-card basic v1 deck with duplicate physical copies
- Discard pile reshuffles into the draw pile when the deck runs out
- Played cards refill back to hand only at the start of that side's next turn
- Deterministic reducer-based turn engine
- AI opponent with lethal/prevent-lethal/heuristic priorities
- Boot/Menu/Game scene flow with rematch loop
- Black vs Red duel screen with a compact top card-flow strip, visible discard piles, persistent hidden enemy hand, and a reveal-focused top stage for enemy card moments
- Centered card-first bottom cockpit with a vertically centered 6-card hand tray, hover/drag card detail, drag-to-center play, and drag-down discard
- Unified resource icon language (bricks/weapons/crystals) across player panel, enemy panel, and card corners with no text abbreviations
- Portrait card UI with thick domain borders, paper-style interiors, explicit illustration motifs for the active 30-card deck, sandstone brick cards, crimson weapon cards, blue crystal cards, and softer gray-framed disabled cards that stay readable
- Local persistence for stats/settings (`localStorage`)
- Dev-gated automation hooks for scripted validation

## Run
```bash
npm install
npm run dev
```

Open: `http://127.0.0.1:5173`

## Build and Validate
```bash
npm run lint
npm test
npm run build
npm run smoke:browser
```

## Controls
- `Enter` or `Space` on menu: start match
- Left click a full-color card: play it immediately
- Left click a grey card: no action
- Right click a card: discard/cycle it
- Hover a card: inspect it
- Drag a card to the center: play it
- Drag a card down: discard it
- `Enter` during a match: play selected card
- `Backspace` or `Delete`: discard selected card
- Tap a card: select it
- Mobile drag toward center: play it
- Mobile drag down: discard it
- `F`: fullscreen toggle
- `Esc`: exit fullscreen

## Testing Hooks
Automation hooks are exposed only in development mode or when `VITE_EXPOSE_TEST_HOOKS=true`.

When exposed on `window`:
- `render_game_to_text(): string`
- `advanceTime(ms: number): void`
- `__game.interact(): void` (automation helper: plays first affordable player card)

The `render_game_to_text()` payload includes a `ui` block with visible deck/discard counts plus presentation fields such as `bottomHudLayout`, `topStageMode`, `topStageCardId`, `hoverPreviewCardId`, `draggingCardId`, `renderedHandCardCount`, and `fullyVisibleHandCardCount`.

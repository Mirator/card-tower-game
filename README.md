# Card Tower Game

A Phaser + TypeScript implementation of the browser tower-card duel from `card_tower_game.md`.

## Features
- 30-card basic v1 deck with duplicate physical copies
- Discard pile reshuffles into the draw pile when the deck runs out
- Deterministic reducer-based turn engine
- AI opponent with lethal/prevent-lethal/heuristic priorities
- Boot/Menu/Game scene flow with rematch loop
- Black vs Red duel screen with a compact top card-flow strip, visible discard piles, persistent hidden enemy hand, and a reveal-focused top stage for enemy card moments
- Centered card-first bottom cockpit with a 6-card hand lane, compact selected-card rail, and compact Play/Discard action rail
- Portrait card UI with thick domain borders, paper-style interiors, explicit illustration motifs for the active 30-card deck, sandstone brick cards, crimson weapon cards, blue crystal cards, and darker gray-framed disabled cards
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
```

## Controls
- `Enter` or `Space` on menu: start match
- Left click a full-color card: play it immediately
- Left click a grey card: no action
- Right click a card: discard/cycle it
- Hover or tap a card: select and preview it
- `Enter` during a match: play selected card
- `Backspace` or `Delete`: discard selected card
- Mobile swipe up on a card: play it
- Mobile swipe down on a card: discard it
- Play/Discard buttons: act on the selected card
- `F`: fullscreen toggle
- `Esc`: exit fullscreen

## Testing Hooks
Automation hooks are exposed only in development mode or when `VITE_EXPOSE_TEST_HOOKS=true`.

When exposed on `window`:
- `render_game_to_text(): string`
- `advanceTime(ms: number): void`
- `__game.interact(): void` (automation helper: plays first affordable player card)

The `render_game_to_text()` payload includes a `ui` block with visible deck/discard counts plus presentation fields such as `bottomHudLayout`, `topStageMode`, and `topStageCardId`.

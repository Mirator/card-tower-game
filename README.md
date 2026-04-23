# Card Tower Game

A Phaser + TypeScript implementation of the browser tower-card duel from `card_tower_game.md`.

## Features
- Full 60-card v1 set (20 brick, 20 weapon, 20 crystal)
- Deterministic reducer-based turn engine
- AI opponent with lethal/prevent-lethal/heuristic priorities
- Boot/Menu/Game scene flow with rematch loop
- Local persistence for stats/settings (`localStorage`)
- Automation hooks for scripted validation

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
- Click a card: play card (if affordable)
- Toggle `Discard` and click a card: discard/cycle
- `F`: fullscreen toggle
- `Esc`: exit fullscreen

## Testing Hooks
Exposed on `window` for automation:
- `render_game_to_text(): string`
- `advanceTime(ms: number): void`
- `__game.interact(): void` (automation helper: plays first affordable player card)

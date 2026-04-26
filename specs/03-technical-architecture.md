# Technical Architecture

## Phaser architecture
### Scenes
- BootScene: starts the app and hands off to MenuScene
- MenuScene: start flow, career stats, and UI motion setting
- GameScene: main gameplay, layout, input, animation, AI turn pacing, rematch flow, and automation bridge

### GameScene structure
- Slim top card-flow bar: player draw pile, player discard pile, active turn headline, goal + enemy tower/wall summary, enemy discard pile, hidden enemy hand, turn chips, and a reveal-stage dock used during staged enemy card moments
- Side panels: Player A and Player B resources, generators, tower, and wall
- Center battlefield: simple value-scaled tower silhouettes, side wall lines with linear height scaling, attack lane, impact feedback, and an otherwise open middle playfield
- Bottom cockpit: centered player hand tray, transient hover-preview overlay, drag guide overlay, and a narrow/mobile stacked variant
- Overlay layer: floating damage/resource text, played-card travel, and match-end overlay
- Resource icons are rendered through one shared glyph renderer so side panels and card corners stay visually consistent

### Implemented systems
- Reducer-driven engine in `src/game/engine.ts` handles turn flow, resource gain, next-turn hand refill, card play/discard, effect resolution, statuses, and victory.
- Card definitions in `src/game/cards.ts` remain the authoritative lookup table; `STARTER_DECK_CARD_IDS` is the active 30-card physical deck composition.
- Card definitions may include a visual-only `illustrationKey` so the scene can render simple, explicit card art without changing gameplay behavior.
- Duplicate card copies are represented by repeated ids in each player's draw pile, discard pile, and hand.
- Player play/discard actions may include `handIndex` so duplicate copies in hand can be targeted safely.
- AI controller in `src/game/ai.ts` prioritizes lethal, prevent-lethal, early economy, and heuristic best moves.
- Persistence in `src/game/storage.ts` stores wins, losses, matches played, and the UI motion setting in localStorage.
- Phaser scenes in `src/scenes/` render and orchestrate the reducer state.
- Automation hooks are exposed only in dev mode or when `VITE_EXPOSE_TEST_HOOKS=true`.

## Data model (implemented shape)
```ts
export type PlayerId = 'player' | 'ai';
export type Resource = 'bricks' | 'weapons' | 'crystals';
export type Generator = 'quarry' | 'barracks' | 'magic';

export interface PlayerState {
  id: PlayerId;
  tower: number;
  wall: number;
  bricks: number;
  weapons: number;
  crystals: number;
  quarry: number;
  barracks: number;
  magic: number;
  hand: string[];
  deck: string[];
  discard: string[];
  statuses: StatusState;
}

export interface GameState {
  players: Record<PlayerId, PlayerState>;
  turn: TurnState;
  phase: 'playing' | 'ended';
  winner: PlayerId | null;
  winTower: number;
  seed: number;
  log: string[];
  maxLogEntries: number;
  lastResolved: LastResolvedSnapshot | null;
}
```

## Public browser automation hooks
When exposed for validation, the app provides:
- `window.render_game_to_text(): string`
- `window.advanceTime(ms: number): void`
- `window.__game.interact(): void`, which plays the first affordable player card for smoke tests

`render_game_to_text()` includes a `ui` block describing top-strip card flow state such as visible draw deck count, player/enemy discard piles, hidden enemy hand count, pending/revealed enemy card ids, and presentation fields such as `bottomHudLayout`, `topStageMode`, `topStageCardId`, `hoverPreviewCardId`, `draggingCardId`, `renderedHandCardCount`, and `fullyVisibleHandCardCount` for automation checks.

These hooks must stay unavailable in production unless `VITE_EXPOSE_TEST_HOOKS=true`.

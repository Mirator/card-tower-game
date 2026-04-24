# Technical Architecture

## Phaser architecture
### Scenes
- BootScene: starts the app and hands off to MenuScene
- MenuScene: start flow, career stats, and UI motion setting
- GameScene: main gameplay, layout, input, animation, AI turn pacing, rematch flow, and automation bridge

### GameScene structure
- Slim top turn bar: deck card, active turn headline, enemy tower/wall summary, goal, deck count, and turn chips
- Side panels: Player A and Player B resources, generators, tower, and wall
- Center battlefield: tower visuals, wall shields, progress meters, attack lane, impact feedback, and enemy card reveal
- Bottom cockpit: player hand, selected-card preview, Play/Discard command panel, compact battle feed, and control hint
- Overlay layer: floating damage/resource text, played-card travel, and match-end overlay

### Implemented systems
- Reducer-driven engine in `src/game/engine.ts` handles turn flow, resource gain, card play/discard, refill, effect resolution, statuses, and victory.
- Card definitions in `src/game/cards.ts` remain the authoritative lookup table; `STARTER_DECK_CARD_IDS` is the active 30-card physical deck composition.
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

These hooks must stay unavailable in production unless `VITE_EXPOSE_TEST_HOOKS=true`.

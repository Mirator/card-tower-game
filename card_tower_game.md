# Tower Card Game - Game Design Document

## Overview
Tower Card Game is a fast, untimed, turn-based, two-player card strategy game for the browser. It follows the classic castle-vs-castle resource duel structure: three resources, one card or discard per turn, a simple 30-card physical starter deck, and a race to build or destroy towers.

The player and AI opponent manage three resource economies, draw cards, and play one card per turn to attack, defend, grow production, or disrupt the opponent. The match ends when one side reaches the castle goal or destroys the opponent's castle.

## Product goals
- Compact, replayable single-player web game with short matches
- Clear, readable state and fast decision loop
- Deterministic, data-driven core and small deck for easy balancing
- Clean Phaser-based implementation with no React dependency

## Design pillars
- Fast, untimed turns with low-friction decisions
- High readability
- Meaningful single-action decisions
- Low input friction for mouse, keyboard, and touch
- Simple rules, non-trivial outcomes

## Platform and tech target
- Web (desktop + mobile browsers)
- TypeScript
- Rendering: Phaser (Scene-based)
- UI built in Phaser with containers, text, and shape objects
- State: reducer-driven plain TypeScript game engine
- Persistence: localStorage for stats and settings

## Core game summary
Each side has:
- Tower
- Wall
- Resources: Bricks, Weapons, Crystals
- Generators: Quarry, Barracks, Magic
- A 30-card physical deck with duplicate basic cards
- Hand of cards, refilled to size 6 at the start of that side's next turn

Turn:
1. Start turn: refill hand up to 6 cards, then gain resources from generators unless a skip-gain status is active
2. Play 1 card **or** discard 1 card
3. Resolve card or discard effects
4. End turn
5. Check victory
6. Pass turn

Victory:
- Reach 100 Tower
- Or reduce opponent Tower to 0
- If both players satisfy victory during the same active resolution, the active player wins

## Starting values
- Tower: 30
- Wall: 10
- Bricks/Weapons/Crystals: 5
- Quarry/Barracks/Magic: 2
- Hand size: 6
- Win at Tower: 100

## Turn structure
### Start
- Refill hand up to 6 cards
- If the draw pile is empty during refill, shuffle that player's discard pile into a new draw pile and continue drawing
- +Bricks = Quarry, +Weapons = Barracks, +Crystals = Magic.

### Action
- Play 1 card, if affordable
- Or discard 1 card -> draw 1 immediately
- If the draw pile is empty, shuffle that player's discard pile into a new draw pile and continue drawing

### End
- Check win
- Switch player

## Deck model
- The active v1 deck is a 30-card physical starter deck.
- Both player and AI use the same deck composition, shuffled independently.
- The deck has 10 Brick cards, 10 Weapon cards, and 10 Crystal cards.
- Duplicate card copies are real physical copies, so a hand may contain more than one copy of the same card.
- The active v1 deck avoids complex control cards; older resolver support can remain in code for future expansions.

## Game mode (v1)
### Classic AI duel
- Player vs AI
- Single mode only
- Instant rematch loop from the end overlay

(No other modes in v1)

## Phaser architecture
### Scenes
- BootScene: starts the app and hands off to MenuScene
- MenuScene: start flow, career stats, and UI motion setting
- GameScene: main gameplay, layout, input, animation, AI turn pacing, rematch flow, and automation bridge

### Implemented systems
- Reducer-driven engine in `src/game/engine.ts` handles turn flow, resource gain, next-turn hand refill, card play/discard, effect resolution, statuses, and victory.
- Card definitions in `src/game/cards.ts` remain the authoritative lookup table; `STARTER_DECK_CARD_IDS` is the active 30-card physical deck composition.
- Duplicate card copies are represented by repeated ids in each player's draw pile, discard pile, and hand.
- Player play/discard actions may include `handIndex` so duplicate copies in hand can be targeted safely.
- AI controller in `src/game/ai.ts` prioritizes lethal, prevent-lethal, early economy, and heuristic best moves.
- Persistence in `src/game/storage.ts` stores wins, losses, matches played, and the UI motion setting in localStorage.
- Phaser scenes in `src/scenes/` render and orchestrate the reducer state.
- Automation hooks are exposed only in dev mode or when `VITE_EXPOSE_TEST_HOOKS=true`.

## Public browser automation hooks
When exposed for validation, the app provides:
- `window.render_game_to_text(): string`
- `window.advanceTime(ms: number): void`
- `window.__game.interact(): void`, which plays the first affordable player card for smoke tests

`render_game_to_text()` includes a `ui` block for the visible card-flow strip and refined HUD presentation: draw deck count, player/enemy discard piles, hidden enemy hand count, pending/revealed enemy card state, `bottomHudLayout`, `topStageMode`, `topStageCardId`, `hoverPreviewCardId`, `draggingCardId`, `renderedHandCardCount`, and `fullyVisibleHandCardCount`.

These hooks must stay unavailable in production unless `VITE_EXPOSE_TEST_HOOKS=true`.

## Game screen
The implemented UI uses:
- Slim top card-flow bar with `Black` draw pile, `Black` discard pile, current turn, goal + enemy castle/wall summary, `Red` discard pile, hidden `Red` hand, turn chips, and a reveal-focused top stage that appears during enemy card moments
- Left `Black` panel and right `Red` panel with generators, resources, castle, and wall
- Resource badges use shared icon glyphs (brick / sword / crystal) instead of text abbreviations
- Center battlefield with castle progress meters, wall shields, danger glow, played-card travel, enemy reveal, and impact feedback
- Bottom cockpit with a vertically centered 6-card portrait hand tray, transient hover/drag card detail, drag-to-center play, drag-down discard, and a minimal controls hint
- No turn timer in v1

Card flow behavior:
- Played cards and manual discards go into that side's discard pile at the top
- The player draw pile shows the remaining visible deck count
- The enemy hand is shown as hidden card backs throughout the match
- On AI turns, one hidden enemy card is highlighted before it is revealed or discarded
- Revealed enemy cards appear on a larger top-center stage instead of living as a permanent idle preview card
- When a discard pile reshuffles back into draw, the top-strip pile visuals update to match

Card/resource color language:
- Bricks use sandstone / ochre
- Weapons use crimson red
- Crystals use blue
- Neutral grey is reserved for disabled cards
- Green remains a positive-state accent rather than the identity color for attack cards

Hand-card visual language:
- Thick rounded domain border around each card face
- Light paper-style inner panel instead of a flat tile fill
- Small resource icon in the upper-left corner
- Oversized cost number in the upper-right corner
- Centered title and simple-but-specific icon illustration chosen from explicit visual keys on the active deck cards
- Short bottom effect text with a clear selected-card gold highlight
- Disabled cards use a softer neutral paper face with a gray border instead of a bright tinted one
- Disabled cards stay readable for inspection, but they do not lift or glow like playable cards
- The hand row sits slightly higher in the bottom band so the cards feel centered in the cockpit area

Bottom HUD behavior:
- No visible scrolling or persistent event log
- Turn guidance stays in the top strip, while short card details appear only while hovering or dragging a card
- Combat/resource changes are communicated through animation, floating text, and discard/reveal motion instead of a text feed

Controls:
- Left click a playable card: play it immediately
- Left click an unplayable card: no action
- Drag a card into the center battlefield: play it on release
- Drag a card downward: discard/cycle it on release
- Right click a card: discard/cycle it
- Hover or tap a card: select it, with detail shown on hover or during drag
- Enter: play selected card
- Backspace/Delete: discard selected card
- Mobile drag up toward center / drag down: play/discard
- F: toggle fullscreen
- Esc: exit fullscreen

## Active 30-card deck
Both players use this same physical deck composition.

### Brick cards - 10 physical cards

| Copies | Card | Cost | Effect |
|---:|---|---:|---|
| 2 | Brick Patch | 3 | +6 Wall |
| 2 | Repair | 4 | +5 Tower |
| 1 | Reinforce | 5 | +4 Wall, +2 Tower |
| 1 | Brick Flow | 5 | +8 Bricks |
| 1 | Construction | 6 | +2 Tower per Quarry |
| 1 | Stone Wall | 7 | +10 Wall |
| 1 | Quarry Team | 8 | +1 Quarry |
| 1 | Tower Boost | 9 | +10 Tower |

### Weapon cards - 10 physical cards

| Copies | Card | Cost | Effect |
|---:|---|---:|---|
| 2 | Strike | 3 | 4 dmg |
| 2 | Slash | 4 | 5 dmg |
| 1 | Smash | 5 | 6 dmg |
| 1 | Raid | 6 | 7 dmg |
| 1 | Breach | 6 | 8 Wall dmg |
| 1 | Pressure | 6 | Enemy -4 Wall, -2 Tower |
| 1 | Siege Crew | 8 | +1 Barracks |
| 1 | Overrun | 11 | 14 dmg |

### Crystal cards - 10 physical cards

| Copies | Card | Cost | Effect |
|---:|---|---:|---|
| 2 | Spark | 3 | 3 Tower dmg |
| 2 | Zap | 4 | 4 dmg bypass Wall |
| 2 | Crystal Boost | 6 | +8 Crystals |
| 1 | Shield | 5 | Prevent next attack |
| 1 | Arcane Study | 8 | +1 Magic |
| 1 | Mana Surge | 9 | +2 Magic |
| 1 | Arcane Blast | 11 | 9 dmg bypass Wall |

## Balancing notes
- Brick = defense + tower scaling
- Weapon = direct pressure
- Crystal = direct tower pressure + basic defense/economy
- Duplicate low-cost staples make opening hands more readable
- No active v1 card should require an extra choice prompt or hidden random control effect

## AI (v1)
- Play lethal if possible
- Prevent lethal, including bypass-wall tower threats
- Prefer generator growth early
- Prefer pressure and heuristic advantage mid/late
- Discard as fallback or cycle option

## One-sentence pitch
A fast, browser-based Phaser card duel where players build or destroy castles through tight, resource-driven decisions.

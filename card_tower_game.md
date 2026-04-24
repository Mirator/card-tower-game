# Tower Card Game - Game Design Document

## Overview
Tower Card Game is a fast, untimed, turn-based, two-player card strategy game for the browser. It follows the classic castle-vs-castle resource duel structure: three resources, one card or discard per turn, and a race to build or destroy towers.

The player and AI opponent manage three resource economies, draw cards, and play one card per turn to attack, defend, grow production, or disrupt the opponent. The match ends when one side reaches the tower goal or destroys the opponent's tower.

## Product goals
- Compact, replayable single-player web game with short matches
- Clear, readable state and fast decision loop
- Deterministic, data-driven core for easy balancing
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
- Hand of cards, refilled to size 6 at the end of that side's turn

Turn:
1. Gain resources from generators, unless a skip-gain status is active
2. Play 1 card **or** discard 1 card
3. Resolve card or discard effects
4. Refill hand up to 6 cards
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
+Bricks = Quarry, +Weapons = Barracks, +Crystals = Magic.

Start-of-turn statuses resolve before resource gain:
- Curse removes tower and decrements its remaining turns
- Freeze/skip-gain consumes the gain step for that turn

### Action
- Play 1 card, if affordable
- Or discard 1 card -> draw 1 immediately

### End
- Refill that side's hand up to 6 cards
- Check win
- Switch player

## Card system
Domains:
- Bricks (build/defense)
- Weapons (damage/sabotage)
- Crystals (utility/control)

Tags:
attack, defense, economy, sabotage, control, finisher, cycle

## Implemented card assumptions
These resolve intentionally ambiguous v1 card text in deterministic, testable ways:
- Mirror: repeats the most recent successfully resolved card effect list exactly once. If no prior card exists, it does nothing.
- Chaos: randomly chooses between 6-12 attack damage to the opponent, with wall applying, or +10 tower for self.
- Transmute: converts up to 6 resources from the actor's highest resource into the actor's lowest resource.
- Convert: gains +5 to the resource with the largest deficit versus expensive cards in hand; if no deficit exists, gains the actor's lowest resource.
- Pillage/Theft: steal up to the listed amount one point at a time from random positive enemy resources.
- Drain: removes up to 4 resources one point at a time from random positive enemy resources.
- Insight: draws 2 cards, then discards 1 random card from the current hand.
- Control: makes the enemy discard up to 2 random cards; replacements happen only through normal end-turn refill.
- Sabotage: reduces enemy Quarry or Barracks by 1, preferring the higher value and breaking ties randomly.

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

### GameScene structure
- Slim top turn bar: deck card, active turn headline, enemy tower/wall summary, goal, deck count, and turn chips
- Side panels: Player A and Player B resources, generators, tower, and wall
- Center battlefield: tower visuals, wall shields, progress meters, attack lane, impact feedback, and enemy card reveal
- Bottom cockpit: player hand, selected-card preview, Play/Discard command panel, compact battle feed, and control hint
- Overlay layer: floating damage/resource text, played-card travel, and match-end overlay

### Implemented systems
- Reducer-driven engine in `src/game/engine.ts` handles turn flow, resource gain, card play/discard, refill, effect resolution, statuses, and victory.
- Card definitions in `src/game/cards.ts` are the authoritative v1 60-card library.
- Card-effect assumptions in `src/game/assumptions.ts` document deterministic resolutions for ambiguous effects.
- AI controller in `src/game/ai.ts` prioritizes lethal, prevent-lethal, early economy, and heuristic best moves.
- Persistence in `src/game/storage.ts` stores wins, losses, matches played, and the UI motion setting in localStorage.
- Phaser scenes in `src/scenes/` render and orchestrate the reducer state.
- Automation hooks are exposed only in dev mode or when `VITE_EXPOSE_TEST_HOOKS=true`.

## Public browser automation hooks
When exposed for validation, the app provides:
- `window.render_game_to_text(): string`
- `window.advanceTime(ms: number): void`
- `window.__game.interact(): void`, which plays the first affordable player card for smoke tests

These hooks must stay unavailable in production unless `VITE_EXPOSE_TEST_HOOKS=true`.

## Game screen
The implemented UI uses:
- Slim top turn bar with current turn, enemy tower/wall, goal, deck count, and turn chips
- Left Player A panel and right Player B panel with generators, resources, tower, and wall
- Center battlefield with tower progress meters, wall shields, danger glow, played-card travel, and impact feedback
- Bottom cockpit with hand cards, selected-card preview, explicit Play/Discard buttons, compact battle feed, and minimal controls hint
- No turn timer in v1

Controls:
- Left click a card: play it if affordable
- Right click a card: discard/cycle it
- Hover or tap a card: select and preview it
- Enter: play selected card
- Backspace/Delete: discard selected card
- Mobile swipe up/down: play/discard
- Play/Discard buttons: act on the selected card
- F: toggle fullscreen
- Esc: exit fullscreen

## ALL CARDS (v1 full set)
Total: **60 cards (20 per resource)**

---

## BRICK CARDS

1. Brick Patch - 3: +6 Wall
2. Reinforce - 5: +4 Wall, +2 Tower
3. Quarry Team - 8: +1 Quarry
4. Bastion - 12: +12 Wall
5. Foundation - 10: +8 Tower
6. Stone Wall - 7: +10 Wall
7. Fortify - 6: +6 Wall, next dmg -2
8. Rampart - 9: +14 Wall
9. Mason - 4: +1 Quarry, +2 Wall
10. Repair - 4: +5 Tower
11. Double Wall - 8: Wall x2 (cap 30)
12. Tower Boost - 9: +10 Tower
13. Brick Flow - 5: +8 Bricks
14. Construction - 6: +2 Tower per Quarry
15. Barrier - 5: Prevent next 5 dmg
16. Wall Shift - 4: Convert 6 Wall -> 6 Tower
17. Solidify - 7: +8 Wall, enemy -2 dmg next turn
18. Heavy Stones - 11: +16 Wall
19. Fortress - 15: +20 Wall
20. Architect - 12: +1 Quarry, +6 Tower

---

## WEAPON CARDS

21. Strike - 3: 4 dmg
22. Slash - 4: 5 dmg
23. Raid - 6: 7 dmg
24. Catapult - 13: 10 dmg
25. Breach - 6: 8 Wall dmg
26. Smash - 5: 6 dmg
27. Heavy Blow - 9: 12 dmg
28. Berserk - 7: 9 dmg, self -3 Tower
29. Sabotage - 9: Enemy -1 Quarry/Barracks
30. Siege Crew - 8: +1 Barracks
31. Double Strike - 8: 2x5 dmg
32. Pierce - 7: 6 dmg bypass Wall
33. Destroy Wall - 10: -12 Wall
34. Pressure - 6: Enemy -4 Wall, -2 Tower
35. War Cry - 5: Next attack +4
36. Overrun - 11: 14 dmg
37. Harass - 4: Enemy -2 random resource
38. Pillage - 8: Steal 5 resources
39. Bombard - 12: 8 dmg + destroy 6 Wall
40. Army - 15: +2 Barracks, 6 dmg

---

## CRYSTAL CARDS

41. Spark - 3: 3 Tower dmg
42. Zap - 4: 4 dmg bypass Wall
43. Arcane Study - 8: +1 Magic
44. Transmute - 4: Convert 6 resources
45. Theft - 7: Steal 3 random
46. Drain - 6: Enemy -4 resources
47. Convert - 5: Gain 5 of chosen type
48. Crystal Boost - 6: +8 Crystals
49. Chaos - 10: Random effect (6-12 dmg or +10)
50. Mirror - 9: Repeat last card effect
51. Freeze - 7: Enemy skips gain next turn
52. Insight - 5: Draw 2, discard 1
53. Mana Surge - 9: +2 Magic
54. Hex - 8: Enemy -1 all generators
55. Curse - 6: Enemy loses 2 Tower/turn (2 turns)
56. Shield - 5: Prevent next attack
57. Flux - 7: Swap resources with enemy
58. Arcane Blast - 11: 9 dmg bypass Wall
59. Control - 10: Enemy discards 2
60. Cataclysm - 15: 15 dmg, self -5 Tower

---

## Balancing notes
- Brick = defense + tower scaling
- Weapon = direct pressure
- Crystal = control + flexibility
- No card should be strictly dominant

## AI (v1)
- Play lethal if possible
- Prevent lethal, including bypass-wall tower threats
- Prefer generator growth early
- Prefer pressure and heuristic advantage mid/late
- Discard as fallback or cycle option

## Milestones
### Prototype
- Phaser scene
- Core reducer loop
- Basic AI

### Vertical slice
- Full 60 cards
- UI polish
- Balance pass

### Release
- Tuning
- Bug fixes
- Responsive layout and automation validation

## One-sentence pitch
A fast, browser-based Phaser card duel where players build or destroy towers through tight, resource-driven decisions.

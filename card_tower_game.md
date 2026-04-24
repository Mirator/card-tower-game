# Tower Card Game — Game Design Document

## Overview
Tower Card Game is a fast, turn-based, two-player card strategy game for the browser. It follows the classic castle-vs-castle resource duel structure (three resources, one card per turn), implemented as a clean-room TypeScript project.

The player and AI opponent manage three resource economies, draw cards, and play one card per turn to attack, defend, grow production, or disrupt the opponent. The match ends when one side reaches the tower goal or destroys the opponent’s tower.

## Product goals
- Compact, replayable single-player web game with short matches
- Clear, readable state and fast decision loop
- Deterministic, data-driven core for easy balancing
- Clean Phaser-based implementation (no React)

## Design pillars
- Fast, untimed turns with low-friction decisions
- High readability
- Meaningful single-action decisions
- Low input friction (mouse + touch)
- Simple rules, non-trivial outcomes

## Platform and tech target
- Web (desktop + mobile browsers)
- TypeScript
- **Rendering: Phaser (Scene-based)**
- No React; UI built in Phaser (containers, sprites, bitmap text)
- State: lightweight in-engine store (plain TS + reducers)
- Persistence: localStorage

## Core game summary
Each side has:
- Tower
- Wall
- Resources: Bricks, Weapons, Crystals
- Generators: Quarry, Barracks, Magic
- Hand of cards (size 6)

Turn:
1. Gain resources from generators
2. Play 1 card **or** discard 1 card (cycle)
3. Resolve effects
4. Check victory
5. Pass turn

Victory:
- Reach 100 Tower
- Or reduce opponent Tower to 0

## Suggested starting values
- Tower: 30
- Wall: 10
- Bricks/Weapons/Crystals: 5
- Quarry/Barracks/Magic: 2
- Hand size: 6
- Win at Tower: 100

## Turn structure
### Start
+Bricks = Quarry, +Weapons = Barracks, +Crystals = Magic

### Action
- Play 1 card (if affordable)
- Or discard 1 card → draw 1

### End
- Resolve effects
- Check win
- Switch player

## Card system
Domains:
- Bricks (build/defense)
- Weapons (damage/sabotage)
- Crystals (utility/control)

Tags:
attack, defense, economy, sabotage, control, finisher, cycle

## Game mode (v1)
### Classic AI duel
- Player vs AI
- Single mode only
- Instant rematch loop

(No other modes in v1)

## Phaser architecture
### Scenes
- BootScene (assets)
- MenuScene (start game)
- GameScene (main gameplay)

### GameScene structure
- Top UI: opponent stats
- Middle: effects/log
- Bottom: player stats + hand

### Key systems
- TurnManager
- CardResolver
- AIController
- UIController (Phaser containers)

## Data model (simplified)
```ts
export type Resource = 'bricks' | 'weapons' | 'crystals'

export interface Player {
  tower: number
  wall: number
  bricks: number
  weapons: number
  crystals: number
  quarry: number
  barracks: number
  magic: number
  hand: Card[]
}
```

## ALL CARDS (v1 full set)
Total: **60 cards (20 per resource)**

---

## BRICK CARDS

1. Brick Patch — 3: +6 Wall
2. Reinforce — 5: +4 Wall, +2 Tower
3. Quarry Team — 8: +1 Quarry
4. Bastion — 12: +12 Wall
5. Foundation — 10: +8 Tower
6. Stone Wall — 7: +10 Wall
7. Fortify — 6: +6 Wall, next dmg -2
8. Rampart — 9: +14 Wall
9. Mason — 4: +1 Quarry, +2 Wall
10. Repair — 4: +5 Tower
11. Double Wall — 8: Wall ×2 (cap 30)
12. Tower Boost — 9: +10 Tower
13. Brick Flow — 5: +8 Bricks
14. Construction — 6: +2 Tower per Quarry
15. Barrier — 5: prevent next 5 dmg
16. Wall Shift — 4: convert 6 Wall → 6 Tower
17. Solidify — 7: +8 Wall, enemy -2 dmg next turn
18. Heavy Stones — 11: +16 Wall
19. Fortress — 15: +20 Wall
20. Architect — 12: +1 Quarry, +6 Tower

---

## WEAPON CARDS

21. Strike — 3: 4 dmg
22. Slash — 4: 5 dmg
23. Raid — 6: 7 dmg
24. Catapult — 13: 10 dmg
25. Breach — 6: 8 Wall dmg
26. Smash — 5: 6 dmg
27. Heavy Blow — 9: 12 dmg
28. Berserk — 7: 9 dmg, self -3 Tower
29. Sabotage — 9: enemy -1 Quarry/Barracks
10. Siege Crew — 8: +1 Barracks
31. Double Strike — 8: 2×5 dmg
32. Pierce — 7: 6 dmg bypass Wall
33. Destroy Wall — 10: -12 Wall
34. Pressure — 6: enemy -4 Wall, -2 Tower
35. War Cry — 5: next attack +4
36. Overrun — 11: 14 dmg
37. Harass — 4: enemy -2 random resource
38. Pillage — 8: steal 5 resources
39. Bombard — 12: 8 dmg + destroy 6 Wall
40. Army — 15: +2 Barracks, 6 dmg

---

## CRYSTAL CARDS

41. Spark — 3: 3 Tower dmg
42. Zap — 4: 4 dmg bypass Wall
43. Arcane Study — 8: +1 Magic
44. Transmute — 4: convert 6 resources
45. Theft — 7: steal 3 random
46. Drain — 6: enemy -4 resources
47. Convert — 5: gain 5 of chosen type
48. Crystal Boost — 6: +8 Crystals
49. Chaos — 10: random effect (6–12 dmg or +10)
50. Mirror — 9: repeat last card effect
51. Freeze — 7: enemy skips gain next turn
52. Insight — 5: draw 2, discard 1
53. Mana Surge — 9: +2 Magic
54. Hex — 8: enemy -1 all generators
55. Curse — 6: enemy loses 2 Tower/turn (2 turns)
56. Shield — 5: prevent next attack
57. Flux — 7: swap resources with enemy
58. Arcane Blast — 11: 9 dmg bypass Wall
59. Control — 10: enemy discards 2
60. Cataclysm — 15: 15 dmg, self -5 Tower

---

## Balancing notes
- Brick = defense + tower scaling
- Weapon = direct pressure
- Crystal = control + flexibility
- No card should be strictly dominant

## AI (v1)
- Play lethal if possible
- Prevent lethal
- Prefer generator growth early
- Prefer damage mid/late
- Simple heuristic scoring

## Milestones
### Prototype
- Phaser scene
- 15 cards
- basic AI

### Vertical slice
- full 60 cards
- UI polish
- balance pass

### Release
- tuning
- bug fixes

## One-sentence pitch
A fast, browser-based Phaser card duel where players build or destroy towers through tight, resource-driven decisions.


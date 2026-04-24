# Gameplay Rules

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

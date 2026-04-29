# Gameplay Rules

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
- Tower: 27
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

Start-of-turn statuses resolve before resource gain:
- Curse removes tower and decrements its remaining turns
- Freeze/skip-gain consumes the gain step for that turn

### Action
- Play 1 card, if affordable
- Or discard 1 card -> draw 1 immediately
- If the draw pile is empty, shuffle that player's discard pile into a new draw pile and continue drawing

### End
- Check win
- Switch player

## Card system
Domains:
- Bricks (build/defense)
- Weapons (damage/sabotage)
- Crystals (utility/control)

Tags:
attack, defense, economy, sabotage, control, finisher, cycle

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

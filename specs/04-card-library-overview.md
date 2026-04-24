# Card Library Overview

## Active v1 deck
The active v1 deck is a **30-card physical starter deck** with duplicate copies:

- 10 Brick cards
- 10 Weapon cards
- 10 Crystal cards

Both player and AI use this same composition, shuffled independently. When a draw pile is empty, that player's discard pile is shuffled back into a new draw pile.

Card detail files:
- `05-brick-cards.md`
- `06-weapon-cards.md`
- `07-crystal-cards.md`

The code may keep additional card definitions and resolver support for future expansions, but only the 30 cards listed in these spec files are active in v1.

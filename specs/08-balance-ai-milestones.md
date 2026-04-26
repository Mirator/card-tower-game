# Balance, AI, and Milestones

## Balancing Notes
- The active v1 deck is the 30-card physical starter deck described in the card spec files.
- Brick cards emphasize wall, tower growth, and quarry scaling.
- Weapon cards emphasize direct pressure, wall damage, and barracks scaling.
- Crystal cards emphasize bypass damage, shield defense, and magic scaling.
- Duplicate low-cost staples should keep opening hands readable without making any one resource path strictly dominant.

## AI (v1)
- Play a lethal card when one is available.
- Prevent known next-action lethal threats, including bypass-wall tower damage.
- Prefer generator growth during early neutral turns.
- Prefer pressure, damage, and material advantage after the opening.
- Discard only as fallback or when cycling is better than an available play.

## Current Release Targets
- Keep the starter deck compact and easy to balance.
- Preserve deterministic reducer behavior for all gameplay decisions.
- Maintain mobile and desktop readability for the card-first Phaser UI.
- Keep automation hooks gated to development or explicit test builds.

## Post-v1 Expansion Notes
- The code may retain extra card definitions and resolver support for future larger decks.
- Additional cards should be promoted into the active deck only with matching specs, tests, and balance passes.
- Future modes or deck variants should not change the v1 starter deck by accident.

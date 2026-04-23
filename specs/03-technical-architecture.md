# Technical Architecture

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

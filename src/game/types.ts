export type PlayerId = 'player' | 'ai';

export type Resource = 'bricks' | 'weapons' | 'crystals';

export type Generator = 'quarry' | 'barracks' | 'magic';

export type CardDomain = Resource;

export type CardIllustrationKey =
  | 'wall'
  | 'masonry'
  | 'tower'
  | 'quarry'
  | 'sword'
  | 'crossed_swords'
  | 'bow'
  | 'ram'
  | 'cracked_shield'
  | 'drum'
  | 'book'
  | 'crystal'
  | 'shield'
  | 'crate'
  | 'orb'
  | 'blast';

export type CardTag =
  | 'attack'
  | 'defense'
  | 'economy'
  | 'sabotage'
  | 'control'
  | 'finisher'
  | 'cycle';

export type EffectTarget = 'self' | 'opponent';

export type EffectSpec =
  | { type: 'adjustWall'; target: EffectTarget; amount: number }
  | { type: 'adjustTower'; target: EffectTarget; amount: number }
  | { type: 'adjustResource'; target: EffectTarget; resource: Resource; amount: number }
  | { type: 'adjustRandomResource'; target: EffectTarget; amount: number }
  | { type: 'adjustAllResources'; target: EffectTarget; amount: number }
  | { type: 'adjustGenerator'; target: EffectTarget; generator: Generator; amount: number }
  | { type: 'adjustAllGenerators'; target: EffectTarget; amount: number }
  | {
      type: 'attack';
      amount: number;
      bypassWall?: boolean;
      wallOnly?: boolean;
      hits?: number;
      source?: 'attack' | 'spell';
    }
  | { type: 'setNextAttackBonus'; amount: number }
  | { type: 'setOutgoingDamagePenalty'; target: EffectTarget; amount: number; turns: number }
  | { type: 'setIncomingDamageReduction'; amount: number }
  | { type: 'setBarrier'; amount: number }
  | { type: 'setShield' }
  | { type: 'setSkipGain'; target: EffectTarget; turns: number }
  | { type: 'setCurse'; target: EffectTarget; turns: number; towerLoss: number }
  | { type: 'drawCards'; target: EffectTarget; amount: number }
  | { type: 'discardCards'; target: EffectTarget; amount: number }
  | { type: 'doubleWall'; cap: number }
  | { type: 'towerPerGenerator'; generator: Generator; amountPer: number }
  | { type: 'wallToTower'; amount: number }
  | { type: 'stealResources'; amount: number }
  | { type: 'convertResources'; amount: number }
  | { type: 'gainChosenResource'; amount: number }
  | { type: 'swapResources' }
  | { type: 'chaos' }
  | { type: 'repeatLastResolved' }
  | { type: 'drainEnemyResources'; amount: number }
  | { type: 'sabotageGenerators' }
  | { type: 'enemyDiscard'; amount: number };

export interface CardDefinition {
  id: string;
  name: string;
  domain: CardDomain;
  cost: number;
  tags: CardTag[];
  text: string;
  effects: EffectSpec[];
  illustrationKey?: CardIllustrationKey;
}

export interface StatusState {
  nextAttackBonus: number;
  outgoingDamagePenalty: number;
  outgoingDamagePenaltyTurns: number;
  nextIncomingDamageReduction: number;
  barrier: number;
  shield: boolean;
  skipGainTurns: number;
  curseTurns: number;
  curseTowerLoss: number;
}

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

export interface TurnState {
  number: number;
  current: PlayerId;
  started: boolean;
  actionTaken: boolean;
}

export interface LastResolvedSnapshot {
  actor: PlayerId;
  cardId: string;
  effects: EffectSpec[];
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

export type Action =
  | { type: 'start_turn' }
  | { type: 'play_card'; playerId: PlayerId; cardId: string; handIndex?: number }
  | { type: 'discard_card'; playerId: PlayerId; cardId: string; handIndex?: number }
  | { type: 'end_turn' }
  | { type: 'rematch'; seed?: number };

export interface ResolveResult {
  state: GameState;
  logs: string[];
  errors: string[];
}

export interface RandomSource {
  next(): number;
  int(maxExclusive: number): number;
  pick<T>(values: readonly T[]): T;
}

export interface AIMove {
  type: 'play_card' | 'discard_card';
  cardId: string;
  score: number;
  reason: string;
}

export interface GameMetaV1 {
  version: 1;
  stats: {
    wins: number;
    losses: number;
    matchesPlayed: number;
  };
  settings: {
    animations: boolean;
  };
}

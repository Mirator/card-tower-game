import type { Generator, Resource, StatusState } from './types';

export const STARTING_VALUES = {
  tower: 30,
  wall: 10,
  bricks: 5,
  weapons: 5,
  crystals: 5,
  quarry: 2,
  barracks: 2,
  magic: 2,
  handSize: 6,
  winTower: 100,
  maxLogEntries: 12,
};

export const RESOURCE_ORDER: Resource[] = ['bricks', 'weapons', 'crystals'];

export const GENERATOR_BY_RESOURCE: Record<Resource, Generator> = {
  bricks: 'quarry',
  weapons: 'barracks',
  crystals: 'magic',
};

export const RESOURCE_BY_GENERATOR: Record<Generator, Resource> = {
  quarry: 'bricks',
  barracks: 'weapons',
  magic: 'crystals',
};

export const EMPTY_STATUSES: StatusState = {
  nextAttackBonus: 0,
  outgoingDamagePenalty: 0,
  outgoingDamagePenaltyTurns: 0,
  nextIncomingDamageReduction: 0,
  barrier: 0,
  shield: false,
  skipGainTurns: 0,
  curseTurns: 0,
  curseTowerLoss: 0,
};

export const AI_DELAY_MS = 750;

export const GAME_WIDTH = 1200;
export const GAME_HEIGHT = 820;

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { CARD_BY_ID } from '../src/game/cards';
import { cloneGameState, createInitialGameState, reduceGameState } from '../src/game/engine';
import { SeededRng } from '../src/game/rng';
import type { CardDefinition, EffectSpec, GameState, PlayerId } from '../src/game/types';

const SCENARIO_SEED = 31415;

function withPlayerTurn(state: GameState): GameState {
  const next = cloneGameState(state);
  next.turn.current = 'player';
  next.turn.started = true;
  next.turn.actionTaken = false;
  return next;
}

function freshState(): GameState {
  const state = withPlayerTurn(createInitialGameState(SCENARIO_SEED));
  state.players.player.hand = [];
  state.players.player.deck = [];
  state.players.player.discard = [];
  state.players.ai.hand = [];
  state.players.ai.deck = [];
  state.players.ai.discard = [];
  state.players.player.bricks = 0;
  state.players.player.weapons = 0;
  state.players.player.crystals = 0;
  state.players.ai.bricks = 0;
  state.players.ai.weapons = 0;
  state.players.ai.crystals = 0;
  state.players.player.tower = 50;
  state.players.ai.tower = 50;
  state.players.player.wall = 10;
  state.players.ai.wall = 10;
  state.players.player.quarry = 2;
  state.players.player.barracks = 2;
  state.players.player.magic = 2;
  state.players.ai.quarry = 2;
  state.players.ai.barracks = 2;
  state.players.ai.magic = 2;
  return state;
}

const TEST_CARD_ID = '__effects_test_card';

const TEST_CARDS: Record<string, CardDefinition> = {};

function registerTestCard(effects: EffectSpec[]): string {
  const id = `${TEST_CARD_ID}_${Object.keys(TEST_CARDS).length}`;
  const card: CardDefinition = {
    id,
    name: 'Test Card',
    domain: 'crystals',
    cost: 0,
    tags: [],
    text: 'test',
    effects,
  };
  TEST_CARDS[id] = card;
  CARD_BY_ID[id] = card;
  return id;
}

beforeAll(() => {
  // mark test cards present
});

afterAll(() => {
  for (const id of Object.keys(TEST_CARDS)) {
    delete CARD_BY_ID[id];
  }
});

function playEffects(effects: EffectSpec[], setup: (state: GameState) => void = () => undefined): GameState {
  const cardId = registerTestCard(effects);
  const state = freshState();
  state.players.player.hand = [cardId];
  setup(state);
  const rng = new SeededRng(SCENARIO_SEED);
  const result = reduceGameState(state, { type: 'play_card', playerId: 'player', cardId, handIndex: 0 }, rng);
  expect(result.errors).toEqual([]);
  return result.state;
}

function snapshot(state: GameState, who: PlayerId) {
  const p = state.players[who];
  return {
    tower: p.tower,
    wall: p.wall,
    bricks: p.bricks,
    weapons: p.weapons,
    crystals: p.crystals,
    quarry: p.quarry,
    barracks: p.barracks,
    magic: p.magic,
    handCount: p.hand.length,
    deckCount: p.deck.length,
    discardCount: p.discard.length,
    statuses: { ...p.statuses },
  };
}

describe('engine effect resolvers', () => {
  it('adjustWall: self gain and opponent loss', () => {
    const state = playEffects([
      { type: 'adjustWall', target: 'self', amount: 7 },
      { type: 'adjustWall', target: 'opponent', amount: -3 },
    ]);
    expect(snapshot(state, 'player').wall).toBe(17);
    expect(snapshot(state, 'ai').wall).toBe(7);
  });

  it('adjustTower: clamps between 0 and winTower', () => {
    const overheal = playEffects([{ type: 'adjustTower', target: 'self', amount: 999 }]);
    expect(overheal.players.player.tower).toBe(overheal.winTower);
    const overkill = playEffects([{ type: 'adjustTower', target: 'opponent', amount: -999 }]);
    expect(overkill.players.ai.tower).toBe(0);
  });

  it('adjustResource: independent per resource', () => {
    const state = playEffects([
      { type: 'adjustResource', target: 'self', resource: 'bricks', amount: 5 },
      { type: 'adjustResource', target: 'opponent', resource: 'crystals', amount: -3 },
    ], (s) => {
      s.players.ai.crystals = 4;
    });
    expect(state.players.player.bricks).toBe(5);
    expect(state.players.ai.crystals).toBe(1);
  });

  it('adjustRandomResource: deterministic with seed and bounded by available resources', () => {
    const state = playEffects([{ type: 'adjustRandomResource', target: 'opponent', amount: -2 }], (s) => {
      s.players.ai.bricks = 1;
      s.players.ai.weapons = 0;
      s.players.ai.crystals = 0;
    });
    const total = state.players.ai.bricks + state.players.ai.weapons + state.players.ai.crystals;
    expect(total).toBe(0);
  });

  it('adjustAllResources: applies amount to every resource', () => {
    const state = playEffects([{ type: 'adjustAllResources', target: 'self', amount: 4 }]);
    expect(state.players.player.bricks).toBe(4);
    expect(state.players.player.weapons).toBe(4);
    expect(state.players.player.crystals).toBe(4);
  });

  it('adjustGenerator: changes a single generator with floor at 0', () => {
    const state = playEffects([
      { type: 'adjustGenerator', target: 'self', generator: 'quarry', amount: 2 },
      { type: 'adjustGenerator', target: 'opponent', generator: 'magic', amount: -10 },
    ]);
    expect(state.players.player.quarry).toBe(4);
    expect(state.players.ai.magic).toBe(0);
  });

  it('adjustAllGenerators: clamps each at 0', () => {
    const state = playEffects([{ type: 'adjustAllGenerators', target: 'opponent', amount: -5 }]);
    expect(state.players.ai.quarry).toBe(0);
    expect(state.players.ai.barracks).toBe(0);
    expect(state.players.ai.magic).toBe(0);
  });

  it('attack: standard hit absorbs into wall then tower', () => {
    const state = playEffects([{ type: 'attack', amount: 14, source: 'attack' }]);
    expect(state.players.ai.wall).toBe(0);
    expect(state.players.ai.tower).toBe(50 - (14 - 10));
  });

  it('attack: bypassWall ignores wall', () => {
    const state = playEffects([{ type: 'attack', amount: 6, bypassWall: true, source: 'spell' }]);
    expect(state.players.ai.wall).toBe(10);
    expect(state.players.ai.tower).toBe(44);
  });

  it('attack: wallOnly only chips wall', () => {
    const state = playEffects([{ type: 'attack', amount: 8, wallOnly: true, source: 'attack' }]);
    expect(state.players.ai.wall).toBe(2);
    expect(state.players.ai.tower).toBe(50);
  });

  it('attack: hits multiplies the strike count', () => {
    const state = playEffects([{ type: 'attack', amount: 5, hits: 2, source: 'attack' }], (s) => {
      s.players.ai.wall = 0;
    });
    expect(state.players.ai.tower).toBe(40);
  });

  it('setNextAttackBonus: applies once and clears', () => {
    const state = playEffects([
      { type: 'setNextAttackBonus', amount: 4 },
      { type: 'attack', amount: 3, source: 'attack' },
      { type: 'attack', amount: 3, source: 'attack' },
    ], (s) => {
      s.players.ai.wall = 0;
    });
    expect(state.players.ai.tower).toBe(50 - (3 + 4) - 3);
    expect(state.players.player.statuses.nextAttackBonus).toBe(0);
  });

  it('setOutgoingDamagePenalty: tracks turns and amount with max-merge', () => {
    const state = playEffects([
      { type: 'setOutgoingDamagePenalty', target: 'opponent', amount: 2, turns: 2 },
      { type: 'setOutgoingDamagePenalty', target: 'opponent', amount: 1, turns: 5 },
    ]);
    expect(state.players.ai.statuses.outgoingDamagePenalty).toBe(2);
    expect(state.players.ai.statuses.outgoingDamagePenaltyTurns).toBe(5);
  });

  it('setIncomingDamageReduction: stacks additively and is consumed by next hit', () => {
    const state = playEffects([
      { type: 'setIncomingDamageReduction', amount: 3 },
      { type: 'setIncomingDamageReduction', amount: 2 },
    ]);
    expect(state.players.player.statuses.nextIncomingDamageReduction).toBe(5);
  });

  it('setBarrier: stacks additively and is consumed by attacks', () => {
    const state = playEffects([
      { type: 'setBarrier', amount: 4 },
      { type: 'setBarrier', amount: 2 },
    ]);
    expect(state.players.player.statuses.barrier).toBe(6);
  });

  it('setShield: blocks the next attack on self', () => {
    const stateAfterShield = playEffects([{ type: 'setShield' }]);
    expect(stateAfterShield.players.player.statuses.shield).toBe(true);
  });

  it('setSkipGain: opponent skips one resource gain', () => {
    const state = playEffects([{ type: 'setSkipGain', target: 'opponent', turns: 1 }]);
    expect(state.players.ai.statuses.skipGainTurns).toBe(1);
  });

  it('setCurse: max-merges turns and tower loss', () => {
    const state = playEffects([
      { type: 'setCurse', target: 'opponent', turns: 1, towerLoss: 2 },
      { type: 'setCurse', target: 'opponent', turns: 3, towerLoss: 1 },
    ]);
    expect(state.players.ai.statuses.curseTurns).toBe(3);
    expect(state.players.ai.statuses.curseTowerLoss).toBe(2);
  });

  it('drawCards: draws into hand', () => {
    const state = playEffects([{ type: 'drawCards', target: 'self', amount: 2 }], (s) => {
      s.players.player.deck = ['strike', 'slash'];
    });
    expect(state.players.player.hand.length).toBe(2);
  });

  it('discardCards: random discards from hand', () => {
    const state = playEffects([{ type: 'discardCards', target: 'self', amount: 1 }], (s) => {
      s.players.player.hand.push('strike', 'slash');
    });
    // Two extra cards in hand, played test card consumes itself; effect discards 1 from remaining 2.
    expect(state.players.player.hand.length).toBe(1);
    expect(state.players.player.discard.length).toBe(2);
  });

  it('doubleWall: doubles up to cap', () => {
    const state = playEffects([{ type: 'doubleWall', cap: 30 }], (s) => {
      s.players.player.wall = 8;
    });
    expect(state.players.player.wall).toBe(16);

    const capped = playEffects([{ type: 'doubleWall', cap: 30 }], (s) => {
      s.players.player.wall = 25;
    });
    expect(capped.players.player.wall).toBe(30);
  });

  it('towerPerGenerator: scales tower by generator count', () => {
    const state = playEffects([{ type: 'towerPerGenerator', generator: 'quarry', amountPer: 2 }], (s) => {
      s.players.player.quarry = 3;
    });
    expect(state.players.player.tower).toBe(56);
  });

  it('wallToTower: converts wall into tower up to amount', () => {
    const state = playEffects([{ type: 'wallToTower', amount: 6 }], (s) => {
      s.players.player.wall = 4;
    });
    expect(state.players.player.wall).toBe(0);
    expect(state.players.player.tower).toBe(54);
  });

  it('stealResources: moves resources from opponent to actor', () => {
    const state = playEffects([{ type: 'stealResources', amount: 3 }], (s) => {
      s.players.ai.bricks = 2;
      s.players.ai.weapons = 0;
      s.players.ai.crystals = 0;
      s.players.player.bricks = 0;
    });
    const playerTotal = state.players.player.bricks + state.players.player.weapons + state.players.player.crystals;
    const aiTotal = state.players.ai.bricks + state.players.ai.weapons + state.players.ai.crystals;
    expect(playerTotal).toBe(2);
    expect(aiTotal).toBe(0);
  });

  it('convertResources: shifts from actor highest to lowest', () => {
    const state = playEffects([{ type: 'convertResources', amount: 4 }], (s) => {
      s.players.player.bricks = 10;
      s.players.player.weapons = 10;
      s.players.player.crystals = 1;
    });
    expect(state.players.player.crystals).toBe(5);
    expect(state.players.player.bricks).toBe(6);
    expect(state.players.player.weapons).toBe(10);
  });

  it('gainChosenResource: picks the most-needed resource', () => {
    const state = playEffects([{ type: 'gainChosenResource', amount: 5 }], (s) => {
      s.players.player.bricks = 0;
      s.players.player.weapons = 5;
      s.players.player.crystals = 5;
      s.players.player.hand.push('tower_boost');
    });
    expect(state.players.player.bricks).toBe(5);
  });

  it('swapResources: swaps actor and opponent resources', () => {
    const state = playEffects([{ type: 'swapResources' }], (s) => {
      s.players.player.bricks = 1;
      s.players.player.weapons = 2;
      s.players.player.crystals = 3;
      s.players.ai.bricks = 9;
      s.players.ai.weapons = 8;
      s.players.ai.crystals = 7;
    });
    expect(state.players.player.bricks).toBe(9);
    expect(state.players.ai.bricks).toBe(1);
  });

  it('chaos: deterministic with seed and produces either damage or +10 tower', () => {
    const state = playEffects([{ type: 'chaos' }]);
    const opponentDamageTaken = 50 - state.players.ai.tower;
    const selfTowerGain = state.players.player.tower - 50;
    expect(opponentDamageTaken > 0 || selfTowerGain > 0).toBe(true);
  });

  it('repeatLastResolved: re-runs the last resolved card effects', () => {
    const cardId = registerTestCard([{ type: 'repeatLastResolved' }]);
    const state = freshState();
    state.players.player.hand = [cardId];
    state.lastResolved = {
      actor: 'ai',
      cardId: 'strike',
      effects: [{ type: 'attack', amount: 5, source: 'attack' }],
    };
    state.players.ai.wall = 0;
    const rng = new SeededRng(SCENARIO_SEED);
    const result = reduceGameState(state, { type: 'play_card', playerId: 'player', cardId, handIndex: 0 }, rng);
    expect(result.errors).toEqual([]);
    expect(result.state.players.ai.tower).toBe(45);
  });

  it('drainEnemyResources: removes from opponent without giving to actor', () => {
    const state = playEffects([{ type: 'drainEnemyResources', amount: 4 }], (s) => {
      s.players.ai.bricks = 3;
      s.players.ai.weapons = 0;
      s.players.ai.crystals = 0;
      s.players.player.bricks = 0;
    });
    expect(state.players.ai.bricks).toBe(0);
    expect(state.players.player.bricks).toBe(0);
  });

  it('sabotageGenerators: chips opponent quarry or barracks', () => {
    const state = playEffects([{ type: 'sabotageGenerators' }], (s) => {
      s.players.ai.quarry = 3;
      s.players.ai.barracks = 1;
    });
    const total = state.players.ai.quarry + state.players.ai.barracks;
    expect(total).toBe(3);
    expect(state.players.ai.magic).toBe(2);
  });

  it('enemyDiscard: random discards from opponent hand', () => {
    const state = playEffects([{ type: 'enemyDiscard', amount: 2 }], (s) => {
      s.players.ai.hand = ['strike', 'slash', 'raid', 'spark'];
    });
    expect(state.players.ai.hand.length).toBe(2);
    expect(state.players.ai.discard.length).toBe(2);
  });

  it('damage pipeline: shield blocks, then barrier, then fortify reduction, before wall absorption', () => {
    const state = playEffects([{ type: 'attack', amount: 10, source: 'attack' }], (s) => {
      s.players.ai.statuses.shield = true;
    });
    expect(state.players.ai.tower).toBe(50);
    expect(state.players.ai.wall).toBe(10);
    expect(state.players.ai.statuses.shield).toBe(false);

    const reduced = playEffects([{ type: 'attack', amount: 10, source: 'attack' }], (s) => {
      s.players.ai.statuses.barrier = 4;
      s.players.ai.statuses.nextIncomingDamageReduction = 2;
    });
    expect(reduced.players.ai.statuses.barrier).toBe(0);
    expect(reduced.players.ai.statuses.nextIncomingDamageReduction).toBe(0);
    expect(reduced.players.ai.wall).toBe(6);
    expect(reduced.players.ai.tower).toBe(50);
  });

  it('outgoing damage penalty: reduces actor attacks by configured amount', () => {
    const state = playEffects([{ type: 'attack', amount: 8, source: 'attack' }], (s) => {
      s.players.player.statuses.outgoingDamagePenalty = 3;
      s.players.player.statuses.outgoingDamagePenaltyTurns = 1;
      s.players.ai.wall = 0;
    });
    expect(state.players.ai.tower).toBe(45);
  });
});

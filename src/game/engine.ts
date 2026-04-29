import { CARD_BY_ID, STARTER_DECK_CARD_IDS } from './cards';
import { EMPTY_STATUSES, RESOURCE_ORDER, STARTING_VALUES } from './constants';
import { SeededRng } from './rng';
import type {
  Action,
  AIMove,
  CardDefinition,
  EffectSpec,
  GameState,
  PlayerId,
  PlayerState,
  RandomSource,
  ResolveResult,
  Resource,
} from './types';

const HAND_SIZE = STARTING_VALUES.handSize;

export function getOpponentId(playerId: PlayerId): PlayerId {
  return playerId === 'player' ? 'ai' : 'player';
}

function clonePlayer(player: PlayerState): PlayerState {
  return {
    ...player,
    hand: [...player.hand],
    deck: [...player.deck],
    discard: [...player.discard],
    statuses: { ...player.statuses },
  };
}

export function cloneGameState(state: GameState): GameState {
  return {
    ...state,
    players: {
      player: clonePlayer(state.players.player),
      ai: clonePlayer(state.players.ai),
    },
    turn: { ...state.turn },
    log: [...state.log],
    lastResolved: state.lastResolved
      ? {
          actor: state.lastResolved.actor,
          cardId: state.lastResolved.cardId,
          effects: state.lastResolved.effects.map((effect) => ({ ...effect })),
        }
      : null,
  };
}

function createPlayer(id: PlayerId, deck: string[]): PlayerState {
  return {
    id,
    tower: STARTING_VALUES.tower,
    wall: STARTING_VALUES.wall,
    bricks: STARTING_VALUES.bricks,
    weapons: STARTING_VALUES.weapons,
    crystals: STARTING_VALUES.crystals,
    quarry: STARTING_VALUES.quarry,
    barracks: STARTING_VALUES.barracks,
    magic: STARTING_VALUES.magic,
    hand: [],
    deck,
    discard: [],
    statuses: { ...EMPTY_STATUSES },
  };
}

function shuffle<T>(values: readonly T[], rng: RandomSource): T[] {
  const copy = [...values];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = rng.int(i + 1);
    const temp = copy[i];
    copy[i] = copy[j];
    copy[j] = temp;
  }
  return copy;
}

function ensureDeckHasCards(player: PlayerState, rng: RandomSource): void {
  if (player.deck.length > 0) {
    return;
  }
  if (player.discard.length === 0) {
    return;
  }
  player.deck = shuffle(player.discard, rng);
  player.discard = [];
}

function drawOne(player: PlayerState, rng: RandomSource): string | null {
  ensureDeckHasCards(player, rng);
  if (player.deck.length === 0) {
    return null;
  }
  const cardId = player.deck.pop()!;
  player.hand.push(cardId);
  return cardId;
}

function drawMany(player: PlayerState, count: number, rng: RandomSource): string[] {
  const drawn: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const cardId = drawOne(player, rng);
    if (!cardId) {
      break;
    }
    drawn.push(cardId);
  }
  return drawn;
}

function drawUpToHand(player: PlayerState, handSize: number, rng: RandomSource): string[] {
  const drawn: string[] = [];
  while (player.hand.length < handSize) {
    const cardId = drawOne(player, rng);
    if (!cardId) {
      break;
    }
    drawn.push(cardId);
  }
  return drawn;
}

function withLog(state: GameState, logs: string[]): void {
  if (logs.length === 0) {
    return;
  }
  state.log.push(...logs);
  if (state.log.length > state.maxLogEntries) {
    state.log = state.log.slice(state.log.length - state.maxLogEntries);
  }
}

function normalizeTower(player: PlayerState, winTower: number): void {
  if (player.tower < 0) {
    player.tower = 0;
  }
  if (player.tower > winTower) {
    player.tower = winTower;
  }
}

function normalizeWall(player: PlayerState): void {
  if (player.wall < 0) {
    player.wall = 0;
  }
}

function normalizeResource(player: PlayerState, resource: Resource): void {
  if (player[resource] < 0) {
    player[resource] = 0;
  }
}

function canAfford(player: PlayerState, card: CardDefinition): boolean {
  if (player[card.domain] < card.cost) {
    return false;
  }
  // Discard-cost cards need extra cards in hand beyond the one being played.
  const requiredHandSize = (card.discardCost ?? 0) + 1;
  if (player.hand.length < requiredHandSize) {
    return false;
  }
  return true;
}

export function canAffordCard(state: GameState, playerId: PlayerId, cardId: string): boolean {
  const card = CARD_BY_ID[cardId];
  if (!card) {
    return false;
  }
  return canAfford(state.players[playerId], card);
}

export function listPlayableCards(state: GameState, playerId: PlayerId): string[] {
  return state.players[playerId].hand.filter((cardId) => canAffordCard(state, playerId, cardId));
}

function applyStartOfTurn(state: GameState, playerId: PlayerId, logs: string[], rng: RandomSource): void {
  const player = state.players[playerId];

  if (player.statuses.curseTurns > 0) {
    player.tower -= player.statuses.curseTowerLoss;
    player.statuses.curseTurns -= 1;
    logs.push(`${playerId === 'player' ? 'You' : 'AI'} suffers ${player.statuses.curseTowerLoss} curse damage.`);
    if (player.statuses.curseTurns === 0) {
      player.statuses.curseTowerLoss = 0;
    }
  }

  if (player.statuses.skipGainTurns > 0) {
    player.statuses.skipGainTurns -= 1;
    logs.push(`${playerId === 'player' ? 'You skip' : 'AI skips'} resource gain this turn.`);
  } else {
    player.bricks += player.quarry;
    player.weapons += player.barracks;
    player.crystals += player.magic;
    logs.push(
      `${playerId === 'player' ? 'You gain' : 'AI gains'} +${player.quarry} bricks, +${player.barracks} weapons, +${player.magic} crystals.`,
    );
  }
  const drawn = drawUpToHand(player, HAND_SIZE, rng);
  if (drawn.length > 0) {
    logs.push(`${playerId === 'player' ? 'You' : 'AI'} draw ${drawn.length} card${drawn.length === 1 ? '' : 's'} to refill.`);
  }

  normalizeTower(player, state.winTower);
}

function settleVictory(state: GameState, activePlayerId: PlayerId, logs: string[]): void {
  if (state.phase === 'ended') {
    return;
  }

  const active = state.players[activePlayerId];
  const opponentId = getOpponentId(activePlayerId);
  const opponent = state.players[opponentId];

  const activeWin = active.tower >= state.winTower || opponent.tower <= 0;
  const opponentWin = opponent.tower >= state.winTower || active.tower <= 0;

  if (!activeWin && !opponentWin) {
    return;
  }

  const winner: PlayerId = activeWin && opponentWin ? activePlayerId : activeWin ? activePlayerId : opponentId;
  state.winner = winner;
  state.phase = 'ended';
  logs.push(winner === 'player' ? 'You win the duel!' : 'AI wins the duel.');
}

function chooseResourceByNeed(player: PlayerState): Resource {
  const resourceNeeds = RESOURCE_ORDER.map((resource) => {
    const highestCostInDomain = player.hand
      .map((cardId) => CARD_BY_ID[cardId])
      .filter((card) => card && card.domain === resource)
      .reduce((max, card) => Math.max(max, card.cost), 0);

    const deficit = highestCostInDomain - player[resource];
    return { resource, deficit };
  });

  resourceNeeds.sort((a, b) => b.deficit - a.deficit);
  if (resourceNeeds[0].deficit <= 0) {
    const sortedByAmount = [...RESOURCE_ORDER].sort((a, b) => player[a] - player[b]);
    return sortedByAmount[0];
  }
  return resourceNeeds[0].resource;
}

function chooseRandomPositiveResource(player: PlayerState, rng: RandomSource): Resource | null {
  const positive = RESOURCE_ORDER.filter((resource) => player[resource] > 0);
  if (positive.length === 0) {
    return null;
  }
  return rng.pick(positive);
}

function stealResources(
  actor: PlayerState,
  opponent: PlayerState,
  amount: number,
  rng: RandomSource,
  logs: string[],
  actorName: string,
  opponentName: string,
): void {
  let stolen = 0;
  for (let i = 0; i < amount; i += 1) {
    const resource = chooseRandomPositiveResource(opponent, rng);
    if (!resource) {
      break;
    }
    opponent[resource] -= 1;
    actor[resource] += 1;
    stolen += 1;
  }

  if (stolen > 0) {
    logs.push(`${actorName} steal ${stolen} resources from ${opponentName}.`);
  } else {
    logs.push(`${actorName} attempt to steal resources, but none are available.`);
  }
}

function drainResources(
  target: PlayerState,
  amount: number,
  rng: RandomSource,
  logs: string[],
  targetName: string,
): void {
  let drained = 0;
  for (let i = 0; i < amount; i += 1) {
    const resource = chooseRandomPositiveResource(target, rng);
    if (!resource) {
      break;
    }
    target[resource] -= 1;
    drained += 1;
  }

  if (drained > 0) {
    logs.push(`${targetName} loses ${drained} resources.`);
  }
}

function discardRandomCards(
  target: PlayerState,
  amount: number,
  rng: RandomSource,
  logs: string[],
  targetName: string,
): number {
  let discarded = 0;
  for (let i = 0; i < amount; i += 1) {
    if (target.hand.length === 0) {
      break;
    }
    const idx = rng.int(target.hand.length);
    const [cardId] = target.hand.splice(idx, 1);
    if (!cardId) {
      break;
    }
    target.discard.push(cardId);
    discarded += 1;
  }
  if (discarded > 0) {
    logs.push(`${targetName} discards ${discarded} card${discarded === 1 ? '' : 's'}.`);
  }
  return discarded;
}

function resolveAttack(
  attacker: PlayerState,
  defender: PlayerState,
  baseAmount: number,
  opts: { bypassWall?: boolean; wallOnly?: boolean; source?: 'attack' | 'spell' },
  logs: string[],
  attackerName: string,
  defenderName: string,
): void {
  let amount = baseAmount;

  if (opts.source === 'attack' && attacker.statuses.nextAttackBonus > 0) {
    amount += attacker.statuses.nextAttackBonus;
    logs.push(`${attackerName} gains +${attacker.statuses.nextAttackBonus} attack bonus.`);
    attacker.statuses.nextAttackBonus = 0;
  }

  if (attacker.statuses.outgoingDamagePenaltyTurns > 0 && attacker.statuses.outgoingDamagePenalty > 0) {
    amount = Math.max(0, amount - attacker.statuses.outgoingDamagePenalty);
    logs.push(`${attackerName} attack is reduced by ${attacker.statuses.outgoingDamagePenalty}.`);
  }

  if (amount <= 0) {
    logs.push(`${attackerName} attack is fully negated.`);
    return;
  }

  if (defender.statuses.shield) {
    defender.statuses.shield = false;
    logs.push(`${defenderName} shield blocks the attack.`);
    return;
  }

  if (defender.statuses.barrier > 0) {
    const blocked = Math.min(defender.statuses.barrier, amount);
    defender.statuses.barrier -= blocked;
    amount -= blocked;
    if (blocked > 0) {
      logs.push(`${defenderName} barrier blocks ${blocked} damage.`);
    }
  }

  if (amount > 0 && defender.statuses.nextIncomingDamageReduction > 0) {
    const reduced = Math.min(defender.statuses.nextIncomingDamageReduction, amount);
    amount -= reduced;
    defender.statuses.nextIncomingDamageReduction = 0;
    logs.push(`${defenderName} fortify reduces ${reduced} damage.`);
  }

  if (amount <= 0) {
    logs.push(`${defenderName} takes no damage.`);
    return;
  }

  if (opts.wallOnly) {
    const wallDamage = Math.min(defender.wall, amount);
    defender.wall -= wallDamage;
    logs.push(`${defenderName} loses ${wallDamage} wall.`);
    return;
  }

  if (opts.bypassWall) {
    defender.tower -= amount;
    logs.push(`${defenderName} takes ${amount} tower damage (bypass).`);
    return;
  }

  const wallAbsorb = Math.min(defender.wall, amount);
  defender.wall -= wallAbsorb;
  amount -= wallAbsorb;

  if (wallAbsorb > 0) {
    logs.push(`${defenderName} wall absorbs ${wallAbsorb} damage.`);
  }

  if (amount > 0) {
    defender.tower -= amount;
    logs.push(`${defenderName} tower takes ${amount} damage.`);
  }
}

function resolveEffectList(
  state: GameState,
  actorId: PlayerId,
  effectList: EffectSpec[],
  rng: RandomSource,
  logs: string[],
  cardName: string,
): EffectSpec[] {
  const actor = state.players[actorId];
  const opponentId = getOpponentId(actorId);
  const opponent = state.players[opponentId];
  const actorName = actorId === 'player' ? 'You' : 'AI';
  const opponentName = actorId === 'player' ? 'AI' : 'You';

  const executed: EffectSpec[] = [];

  for (const effect of effectList) {
    switch (effect.type) {
      case 'adjustWall': {
        const target = effect.target === 'self' ? actor : opponent;
        target.wall += effect.amount;
        normalizeWall(target);
        logs.push(
          `${effect.target === 'self' ? actorName : opponentName} ${effect.amount >= 0 ? 'gain' : 'lose'} ${Math.abs(effect.amount)} wall.`,
        );
        executed.push(effect);
        break;
      }
      case 'adjustTower': {
        const target = effect.target === 'self' ? actor : opponent;
        target.tower += effect.amount;
        normalizeTower(target, state.winTower);
        logs.push(
          `${effect.target === 'self' ? actorName : opponentName} ${effect.amount >= 0 ? 'gain' : 'lose'} ${Math.abs(effect.amount)} tower.`,
        );
        executed.push(effect);
        break;
      }
      case 'adjustResource': {
        const target = effect.target === 'self' ? actor : opponent;
        target[effect.resource] += effect.amount;
        normalizeResource(target, effect.resource);
        logs.push(
          `${effect.target === 'self' ? actorName : opponentName} ${effect.amount >= 0 ? 'gain' : 'lose'} ${Math.abs(effect.amount)} ${effect.resource}.`,
        );
        executed.push(effect);
        break;
      }
      case 'adjustRandomResource': {
        const target = effect.target === 'self' ? actor : opponent;
        const resource = chooseRandomPositiveResource(target, rng);
        if (!resource) {
          logs.push('Random resource effect has no valid target.');
          executed.push(effect);
          break;
        }
        target[resource] += effect.amount;
        normalizeResource(target, resource);
        logs.push(
          `${effect.target === 'self' ? actorName : opponentName} ${effect.amount >= 0 ? 'gain' : 'lose'} ${Math.abs(effect.amount)} ${resource}.`,
        );
        executed.push(effect);
        break;
      }
      case 'adjustAllResources': {
        const target = effect.target === 'self' ? actor : opponent;
        for (const resource of RESOURCE_ORDER) {
          target[resource] += effect.amount;
          normalizeResource(target, resource);
        }
        logs.push(
          `${effect.target === 'self' ? actorName : opponentName} ${effect.amount >= 0 ? 'gain' : 'lose'} ${Math.abs(effect.amount)} all resources.`,
        );
        executed.push(effect);
        break;
      }
      case 'adjustGenerator': {
        const target = effect.target === 'self' ? actor : opponent;
        target[effect.generator] += effect.amount;
        if (target[effect.generator] < 0) {
          target[effect.generator] = 0;
        }
        logs.push(
          `${effect.target === 'self' ? actorName : opponentName} ${effect.amount >= 0 ? 'gain' : 'lose'} ${Math.abs(effect.amount)} ${effect.generator}.`,
        );
        executed.push(effect);
        break;
      }
      case 'adjustAllGenerators': {
        const target = effect.target === 'self' ? actor : opponent;
        target.quarry = Math.max(0, target.quarry + effect.amount);
        target.barracks = Math.max(0, target.barracks + effect.amount);
        target.magic = Math.max(0, target.magic + effect.amount);
        logs.push(
          `${effect.target === 'self' ? actorName : opponentName} ${effect.amount >= 0 ? 'gain' : 'lose'} ${Math.abs(effect.amount)} all generators.`,
        );
        executed.push(effect);
        break;
      }
      case 'attack': {
        const hits = effect.hits ?? 1;
        for (let i = 0; i < hits; i += 1) {
          resolveAttack(actor, opponent, effect.amount, effect, logs, actorName, opponentName);
        }
        executed.push(effect);
        break;
      }
      case 'setNextAttackBonus': {
        actor.statuses.nextAttackBonus += effect.amount;
        logs.push(`${actorName} gain +${effect.amount} to the next attack.`);
        executed.push(effect);
        break;
      }
      case 'setOutgoingDamagePenalty': {
        const target = effect.target === 'self' ? actor : opponent;
        target.statuses.outgoingDamagePenalty = Math.max(target.statuses.outgoingDamagePenalty, effect.amount);
        target.statuses.outgoingDamagePenaltyTurns = Math.max(target.statuses.outgoingDamagePenaltyTurns, effect.turns);
        logs.push(`${effect.target === 'self' ? actorName : opponentName} suffer -${effect.amount} damage next turn.`);
        executed.push(effect);
        break;
      }
      case 'setIncomingDamageReduction': {
        actor.statuses.nextIncomingDamageReduction += effect.amount;
        logs.push(`${actorName} gain next damage reduction ${effect.amount}.`);
        executed.push(effect);
        break;
      }
      case 'setBarrier': {
        actor.statuses.barrier += effect.amount;
        logs.push(`${actorName} gain a ${effect.amount} damage barrier.`);
        executed.push(effect);
        break;
      }
      case 'setShield': {
        actor.statuses.shield = true;
        logs.push(`${actorName} gain a shield against the next attack.`);
        executed.push(effect);
        break;
      }
      case 'setSkipGain': {
        const target = effect.target === 'self' ? actor : opponent;
        target.statuses.skipGainTurns += effect.turns;
        logs.push(`${effect.target === 'self' ? actorName : opponentName} will skip next gain step.`);
        executed.push(effect);
        break;
      }
      case 'setCurse': {
        const target = effect.target === 'self' ? actor : opponent;
        target.statuses.curseTurns = Math.max(target.statuses.curseTurns, effect.turns);
        target.statuses.curseTowerLoss = Math.max(target.statuses.curseTowerLoss, effect.towerLoss);
        logs.push(`${effect.target === 'self' ? actorName : opponentName} are cursed.`);
        executed.push(effect);
        break;
      }
      case 'drawCards': {
        const target = effect.target === 'self' ? actor : opponent;
        const drawn = drawMany(target, effect.amount, rng);
        logs.push(`${effect.target === 'self' ? actorName : opponentName} draw ${drawn.length} card${drawn.length === 1 ? '' : 's'}.`);
        executed.push(effect);
        break;
      }
      case 'discardCards': {
        const target = effect.target === 'self' ? actor : opponent;
        discardRandomCards(target, effect.amount, rng, logs, effect.target === 'self' ? actorName : opponentName);
        executed.push(effect);
        break;
      }
      case 'doubleWall': {
        actor.wall = Math.min(effect.cap, actor.wall * 2);
        logs.push(`${actorName} double wall up to ${effect.cap}.`);
        executed.push(effect);
        break;
      }
      case 'towerPerGenerator': {
        const value = actor[effect.generator] * effect.amountPer;
        actor.tower += value;
        normalizeTower(actor, state.winTower);
        logs.push(`${actorName} gain ${value} tower from ${effect.generator}.`);
        executed.push(effect);
        break;
      }
      case 'wallToTower': {
        const converted = Math.min(effect.amount, actor.wall);
        actor.wall -= converted;
        actor.tower += converted;
        normalizeTower(actor, state.winTower);
        logs.push(`${actorName} convert ${converted} wall into tower.`);
        executed.push(effect);
        break;
      }
      case 'stealResources': {
        stealResources(actor, opponent, effect.amount, rng, logs, actorName, opponentName);
        executed.push(effect);
        break;
      }
      case 'convertResources': {
        const sortedHighToLow = [...RESOURCE_ORDER].sort((a, b) => actor[b] - actor[a]);
        const sortedLowToHigh = [...RESOURCE_ORDER].sort((a, b) => actor[a] - actor[b]);
        const from = sortedHighToLow[0];
        const to = sortedLowToHigh[0];
        const converted = Math.min(effect.amount, actor[from]);
        actor[from] -= converted;
        actor[to] += converted;
        logs.push(`${actorName} convert ${converted} ${from} into ${to}.`);
        executed.push(effect);
        break;
      }
      case 'gainChosenResource': {
        const resource = chooseResourceByNeed(actor);
        actor[resource] += effect.amount;
        logs.push(`${actorName} gain ${effect.amount} ${resource}.`);
        executed.push(effect);
        break;
      }
      case 'swapResources': {
        for (const resource of RESOURCE_ORDER) {
          const temp = actor[resource];
          actor[resource] = opponent[resource];
          opponent[resource] = temp;
        }
        logs.push(`${actorName} swap resources with ${opponentName}.`);
        executed.push(effect);
        break;
      }
      case 'chaos': {
        const chaosRoll = rng.int(2);
        if (chaosRoll === 0) {
          const damage = 6 + rng.int(7);
          const generated: EffectSpec = { type: 'attack', amount: damage, source: 'spell' };
          logs.push(`${cardName} rolls chaos damage: ${damage}.`);
          resolveEffectList(state, actorId, [generated], rng, logs, cardName);
          executed.push(generated);
        } else {
          const generated: EffectSpec = { type: 'adjustTower', target: 'self', amount: 10 };
          logs.push(`${cardName} rolls chaos boon: +10 tower.`);
          resolveEffectList(state, actorId, [generated], rng, logs, cardName);
          executed.push(generated);
        }
        break;
      }
      case 'repeatLastResolved': {
        if (!state.lastResolved) {
          logs.push('Mirror has no prior card effect to repeat.');
          break;
        }
        logs.push(`${cardName} repeats ${CARD_BY_ID[state.lastResolved.cardId]?.name ?? 'the last card'} effects.`);
        const repeatedEffects = state.lastResolved.effects.map((entry) => ({ ...entry }));
        const resolvedRepeat = resolveEffectList(state, actorId, repeatedEffects, rng, logs, cardName);
        executed.push(...resolvedRepeat);
        break;
      }
      case 'drainEnemyResources': {
        drainResources(opponent, effect.amount, rng, logs, opponentName);
        executed.push(effect);
        break;
      }
      case 'sabotageGenerators': {
        const candidates: Array<'quarry' | 'barracks'> = ['quarry', 'barracks'];
        const ranked = candidates.sort((a, b) => opponent[b] - opponent[a]);
        const chosen =
          opponent[ranked[0]] === opponent[ranked[1]] && opponent[ranked[0]] > 0
            ? rng.pick(ranked)
            : ranked[0];
        if (opponent[chosen] > 0) {
          opponent[chosen] -= 1;
          logs.push(`${opponentName} lose 1 ${chosen}.`);
        } else {
          logs.push(`${cardName} has no valid generator target.`);
        }
        executed.push(effect);
        break;
      }
      case 'enemyDiscard': {
        discardRandomCards(opponent, effect.amount, rng, logs, opponentName);
        executed.push(effect);
        break;
      }
      default: {
        const exhaustiveCheck: never = effect;
        throw new Error(`Unhandled effect: ${JSON.stringify(exhaustiveCheck)}`);
      }
    }

    normalizeTower(actor, state.winTower);
    normalizeTower(opponent, state.winTower);
    normalizeWall(actor);
    normalizeWall(opponent);
    for (const resource of RESOURCE_ORDER) {
      normalizeResource(actor, resource);
      normalizeResource(opponent, resource);
    }
  }

  return executed;
}

export function createInitialGameState(seed: number): GameState {
  const rng = new SeededRng(seed);

  const playerDeck = shuffle(STARTER_DECK_CARD_IDS, rng.fork(0xa11ce));
  const aiDeck = shuffle(STARTER_DECK_CARD_IDS, rng.fork(0xb00b5));

  const state: GameState = {
    players: {
      player: createPlayer('player', playerDeck),
      ai: createPlayer('ai', aiDeck),
    },
    turn: {
      number: 1,
      current: 'player',
      started: false,
      actionTaken: false,
    },
    phase: 'playing',
    winner: null,
    winTower: STARTING_VALUES.winTower,
    seed,
    log: ['New match started.'],
    maxLogEntries: STARTING_VALUES.maxLogEntries,
    lastResolved: null,
  };

  drawMany(state.players.player, HAND_SIZE, rng.fork(0xabc));
  drawMany(state.players.ai, HAND_SIZE, rng.fork(0xdef));

  return state;
}

function isValidHandIndex(player: PlayerState, cardId: string, handIndex: number | undefined): boolean {
  if (handIndex === undefined) {
    return player.hand.includes(cardId);
  }
  return Number.isInteger(handIndex) && handIndex >= 0 && player.hand[handIndex] === cardId;
}

function getCardInHand(player: PlayerState, cardId: string, handIndex?: number): CardDefinition | null {
  if (!isValidHandIndex(player, cardId, handIndex)) {
    return null;
  }
  return CARD_BY_ID[cardId] ?? null;
}

function spendCardCost(player: PlayerState, card: CardDefinition): void {
  player[card.domain] -= card.cost;
  normalizeResource(player, card.domain);
}

function removeCardFromHand(player: PlayerState, cardId: string, handIndex?: number): boolean {
  const index = handIndex === undefined ? player.hand.indexOf(cardId) : handIndex;
  if (index === -1) {
    return false;
  }
  if (player.hand[index] !== cardId) {
    return false;
  }
  player.hand.splice(index, 1);
  return true;
}

function finishActorTurn(state: GameState, logs: string[]): void {
  const actorId = state.turn.current;
  const actor = state.players[actorId];

  settleVictory(state, actorId, logs);
  if (state.phase === 'ended') {
    return;
  }

  if (actor.statuses.outgoingDamagePenaltyTurns > 0) {
    actor.statuses.outgoingDamagePenaltyTurns -= 1;
    if (actor.statuses.outgoingDamagePenaltyTurns === 0) {
      actor.statuses.outgoingDamagePenalty = 0;
    }
  }

  state.turn.current = getOpponentId(actorId);
  state.turn.started = false;
  state.turn.actionTaken = false;
  state.turn.number += 1;

  logs.push(`Turn passes to ${state.turn.current === 'player' ? 'you' : 'AI'}.`);
}

function playCardAction(
  state: GameState,
  action: Extract<Action, { type: 'play_card' }>,
  logs: string[],
  errors: string[],
  rng: RandomSource,
): void {
  if (state.phase === 'ended') {
    errors.push('Game has ended.');
    return;
  }
  if (!state.turn.started) {
    errors.push('Turn has not started.');
    return;
  }
  if (state.turn.actionTaken) {
    errors.push('Action already taken this turn.');
    return;
  }
  if (state.turn.current !== action.playerId) {
    errors.push('It is not this player\'s turn.');
    return;
  }

  const actor = state.players[action.playerId];
  const card = getCardInHand(actor, action.cardId, action.handIndex);
  if (!card) {
    errors.push('Card is not in hand.');
    return;
  }

  if (!canAfford(actor, card)) {
    errors.push('Card is not affordable.');
    return;
  }

  if (!removeCardFromHand(actor, card.id, action.handIndex)) {
    errors.push('Card is not in hand.');
    return;
  }
  spendCardCost(actor, card);
  logs.push(`${action.playerId === 'player' ? 'You' : 'AI'} play ${card.name}.`);

  if (card.discardCost && card.discardCost > 0) {
    const actorName = action.playerId === 'player' ? 'You' : 'AI';
    discardRandomCards(actor, card.discardCost, rng, logs, actorName);
  }

  const executedEffects = resolveEffectList(state, action.playerId, card.effects, rng, logs, card.name);

  actor.discard.push(card.id);
  if (executedEffects.length > 0) {
    state.lastResolved = {
      actor: action.playerId,
      cardId: card.id,
      effects: executedEffects,
    };
  }

  // keepsTurn cards (e.g., Quick Strike) let the actor play another card,
  // unless their hand is now empty in which case the action ends naturally.
  if (card.keepsTurn && actor.hand.length > 0) {
    return;
  }
  state.turn.actionTaken = true;
}

function discardCardAction(
  state: GameState,
  action: Extract<Action, { type: 'discard_card' }>,
  logs: string[],
  errors: string[],
  rng: RandomSource,
): void {
  if (state.phase === 'ended') {
    errors.push('Game has ended.');
    return;
  }
  if (!state.turn.started) {
    errors.push('Turn has not started.');
    return;
  }
  if (state.turn.actionTaken) {
    errors.push('Action already taken this turn.');
    return;
  }
  if (state.turn.current !== action.playerId) {
    errors.push('It is not this player\'s turn.');
    return;
  }

  const actor = state.players[action.playerId];
  const removed = removeCardFromHand(actor, action.cardId, action.handIndex);
  if (!removed) {
    errors.push('Card is not in hand.');
    return;
  }

  actor.discard.push(action.cardId);
  const drawn = drawOne(actor, rng);
  logs.push(`${action.playerId === 'player' ? 'You' : 'AI'} discard a card${drawn ? ' and draw 1' : ''}.`);

  state.turn.actionTaken = true;
}

export function reduceGameState(currentState: GameState, action: Action, rng: RandomSource): ResolveResult {
  const state = cloneGameState(currentState);
  const logs: string[] = [];
  const errors: string[] = [];

  switch (action.type) {
    case 'start_turn': {
      if (state.phase === 'ended') {
        errors.push('Game has ended.');
        break;
      }
      if (state.turn.started) {
        errors.push('Turn already started.');
        break;
      }
      applyStartOfTurn(state, state.turn.current, logs, rng);
      settleVictory(state, state.turn.current, logs);
      state.turn.started = state.phase === 'playing';
      state.turn.actionTaken = false;
      break;
    }

    case 'play_card': {
      playCardAction(state, action, logs, errors, rng);
      break;
    }

    case 'discard_card': {
      discardCardAction(state, action, logs, errors, rng);
      break;
    }

    case 'end_turn': {
      if (state.phase === 'ended') {
        errors.push('Game has ended.');
        break;
      }
      if (!state.turn.started) {
        errors.push('Turn has not started.');
        break;
      }
      if (!state.turn.actionTaken) {
        errors.push('Cannot end turn before taking action.');
        break;
      }
      finishActorTurn(state, logs);
      break;
    }

    case 'rematch': {
      return {
        state: createInitialGameState(action.seed ?? Math.floor(rng.next() * 0xffffffff)),
        logs: ['Rematch created.'],
        errors: [],
      };
    }

    default: {
      const exhaustive: never = action;
      throw new Error(`Unhandled action ${(exhaustive as { type: string }).type}`);
    }
  }

  withLog(state, logs);
  return { state, logs, errors };
}

export function runActionSequence(initialState: GameState, actions: Action[], rng: RandomSource): ResolveResult {
  let state = cloneGameState(initialState);
  const logs: string[] = [];
  const errors: string[] = [];

  for (const action of actions) {
    const result = reduceGameState(state, action, rng);
    state = result.state;
    logs.push(...result.logs);
    errors.push(...result.errors);
    if (errors.length > 0) {
      break;
    }
  }

  return { state, logs, errors };
}

export function estimateThreatDamage(state: GameState, attackerId: PlayerId): number {
  const attacker = state.players[attackerId];
  const cards = attacker.hand.map((cardId) => CARD_BY_ID[cardId]).filter(Boolean);

  let best = 0;
  for (const card of cards) {
    if (!canAfford(attacker, card)) {
      continue;
    }
    let potential = 0;
    for (const effect of card.effects) {
      if (effect.type === 'attack') {
        const hits = effect.hits ?? 1;
        const amount = effect.amount + (effect.source === 'attack' ? attacker.statuses.nextAttackBonus : 0);
        potential += amount * hits;
      }
      if (effect.type === 'adjustTower' && effect.target === 'opponent' && effect.amount < 0) {
        potential += Math.abs(effect.amount);
      }
    }
    best = Math.max(best, potential);
  }
  return best;
}

export function isLethalAvailable(state: GameState, attackerId: PlayerId): boolean {
  const attacker = state.players[attackerId];
  const defenderId = getOpponentId(attackerId);
  const defender = state.players[defenderId];

  for (const cardId of attacker.hand) {
    const card = CARD_BY_ID[cardId];
    if (!card || !canAfford(attacker, card)) {
      continue;
    }
    const simRng = new SeededRng(state.seed ^ cardId.length ^ state.turn.number);
    const simState = cloneGameState(state);
    const startResult = simState.turn.started
      ? { state: simState, errors: [] as string[] }
      : reduceGameState(simState, { type: 'start_turn' }, simRng);
    if (startResult.errors.length > 0) {
      continue;
    }
    const playResult = reduceGameState(startResult.state, { type: 'play_card', playerId: attackerId, cardId }, simRng);
    if (playResult.errors.length > 0) {
      continue;
    }
    if (playResult.state.players[defenderId].tower <= 0 || playResult.state.players[attackerId].tower >= playResult.state.winTower) {
      return true;
    }
  }

  return defender.tower <= 0;
}

export function pickDiscardCard(state: GameState, playerId: PlayerId): string {
  const hand = state.players[playerId].hand;
  return [...hand]
    .sort((a, b) => {
      const cardA = CARD_BY_ID[a];
      const cardB = CARD_BY_ID[b];
      if (!cardA || !cardB) {
        return 0;
      }
      if (cardA.cost !== cardB.cost) {
        return cardB.cost - cardA.cost;
      }
      return a.localeCompare(b);
    })
    .at(0)!;
}

export function describeCard(cardId: string): string {
  const card = CARD_BY_ID[cardId];
  if (!card) {
    return cardId;
  }
  return `${card.name} (${card.domain} ${card.cost})`;
}

export function summarizeForText(state: GameState): string {
  return JSON.stringify(
    {
      mode: state.phase,
      turn: {
        number: state.turn.number,
        current: state.turn.current,
        started: state.turn.started,
      },
      player: {
        tower: state.players.player.tower,
        wall: state.players.player.wall,
        resources: {
          bricks: state.players.player.bricks,
          weapons: state.players.player.weapons,
          crystals: state.players.player.crystals,
        },
        generators: {
          quarry: state.players.player.quarry,
          barracks: state.players.player.barracks,
          magic: state.players.player.magic,
        },
        hand: state.players.player.hand.map((cardId) => CARD_BY_ID[cardId]?.name ?? cardId),
      },
      ai: {
        tower: state.players.ai.tower,
        wall: state.players.ai.wall,
        resources: {
          bricks: state.players.ai.bricks,
          weapons: state.players.ai.weapons,
          crystals: state.players.ai.crystals,
        },
        generators: {
          quarry: state.players.ai.quarry,
          barracks: state.players.ai.barracks,
          magic: state.players.ai.magic,
        },
        handCount: state.players.ai.hand.length,
      },
      winner: state.winner,
      note: {
      coords: 'No grid movement. Center = tower battlefield, side panels = resources, bottom = centered player hand tray with hover details and drag actions.',
      },
    },
    null,
    2,
  );
}

export function getPlayableActions(state: GameState, playerId: PlayerId): AIMove[] {
  const actor = state.players[playerId];
  const playableCards = actor.hand.filter((cardId) => {
    const card = CARD_BY_ID[cardId];
    return Boolean(card) && canAfford(actor, card);
  });

  const actions: AIMove[] = playableCards.map((cardId) => ({
    type: 'play_card',
    cardId,
    score: 0,
    reason: 'playable',
  }));

  for (const cardId of actor.hand) {
    actions.push({
      type: 'discard_card',
      cardId,
      score: 0,
      reason: 'cycle',
    });
  }

  return actions;
}

export function hasValidTurnAction(state: GameState, playerId: PlayerId): boolean {
  return state.players[playerId].hand.length > 0;
}

export function startTurnIfNeeded(state: GameState, rng: RandomSource): GameState {
  if (state.phase !== 'playing' || state.turn.started) {
    return state;
  }
  return reduceGameState(state, { type: 'start_turn' }, rng).state;
}

export function resourceSnapshot(player: PlayerState): number {
  return player.bricks + player.weapons + player.crystals;
}

export function generatorSnapshot(player: PlayerState): number {
  return player.quarry + player.barracks + player.magic;
}

export function projectedPlayState(state: GameState, action: AIMove, rngSeed: number): GameState | null {
  const rng = new SeededRng(rngSeed);
  const startResult = state.turn.started ? { state, errors: [] as string[] } : reduceGameState(state, { type: 'start_turn' }, rng);
  if (startResult.errors.length > 0) {
    return null;
  }

  const primaryAction: Action =
    action.type === 'play_card'
      ? { type: 'play_card', playerId: state.turn.current, cardId: action.cardId }
      : { type: 'discard_card', playerId: state.turn.current, cardId: action.cardId };

  const playResult = reduceGameState(startResult.state, primaryAction, rng);
  if (playResult.errors.length > 0) {
    return null;
  }

  // keepsTurn cards leave actionTaken=false; for the 1-ply projection treat them as
  // having ended the action so end_turn succeeds. The keepsTurn bonus is modeled by
  // the AI heuristic separately rather than by simulating a second action here.
  const projection = playResult.state;
  if (!projection.turn.actionTaken) {
    projection.turn.actionTaken = true;
  }

  const endResult = reduceGameState(projection, { type: 'end_turn' }, rng);
  if (endResult.errors.length > 0) {
    return null;
  }

  return endResult.state;
}

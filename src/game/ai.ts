import { CARD_BY_ID } from './cards';
import {
  cloneGameState,
  estimateThreatDamage,
  generatorSnapshot,
  getPlayableActions,
  isLethalAvailable,
  projectedPlayState,
  resourceSnapshot,
} from './engine';
import type { AIMove, GameState } from './types';

function hasLethalOnNextAction(state: GameState, attackerId: 'player' | 'ai'): boolean {
  if (state.phase !== 'playing') {
    return state.winner === attackerId;
  }

  const projected = cloneGameState(state);
  projected.turn.current = attackerId;
  projected.turn.started = false;
  projected.turn.actionTaken = false;

  return isLethalAvailable(projected, attackerId);
}

function evaluateHeuristic(before: GameState, after: GameState): number {
  const meBefore = before.players.ai;
  const meAfter = after.players.ai;
  const oppBefore = before.players.player;
  const oppAfter = after.players.player;

  if (after.winner === 'ai') {
    return 1_000_000;
  }
  if (after.winner === 'player') {
    return -1_000_000;
  }

  const turn = before.turn.number;
  const earlyWeight = turn <= 8 ? 1 : 0;
  const midLateWeight = turn > 8 ? 1 : 0;

  const towerSwing = (meAfter.tower - meBefore.tower) * 16 + (oppBefore.tower - oppAfter.tower) * 18;
  const wallSwing = (meAfter.wall - meBefore.wall) * 2 + (oppBefore.wall - oppAfter.wall) * 2;
  const generatorSwing =
    (generatorSnapshot(meAfter) - generatorSnapshot(meBefore)) * (8 + earlyWeight * 8) +
    (generatorSnapshot(oppBefore) - generatorSnapshot(oppAfter)) * (6 + earlyWeight * 4);
  const resourceSwing =
    (resourceSnapshot(meAfter) - resourceSnapshot(meBefore)) * (2 + earlyWeight * 1) +
    (resourceSnapshot(oppBefore) - resourceSnapshot(oppAfter)) * (2 + midLateWeight * 1);

  const threatPenalty = estimateThreatDamage(after, 'player') * 5;
  const futurePressure = estimateThreatDamage(after, 'ai') * 3;

  return towerSwing + wallSwing + generatorSwing + resourceSwing + futurePressure - threatPenalty;
}

function isDefensiveMove(before: GameState, after: GameState): boolean {
  const meBefore = before.players.ai;
  const meAfter = after.players.ai;
  const incomingBefore = estimateThreatDamage(before, 'player');
  const incomingAfter = estimateThreatDamage(after, 'player');

  const durabilityBefore = meBefore.tower + meBefore.wall;
  const durabilityAfter = meAfter.tower + meAfter.wall;

  return durabilityAfter > durabilityBefore || incomingAfter < incomingBefore;
}

export function evaluateAIMove(state: GameState): AIMove {
  const candidates = getPlayableActions(state, 'ai');
  if (candidates.length === 0) {
    throw new Error('AI has no available actions.');
  }

  const simulated = candidates
    .map((candidate, index) => {
      const simState = projectedPlayState(state, candidate, state.seed + state.turn.number * 4099 + index * 97);
      if (!simState) {
        return null;
      }
      let score = evaluateHeuristic(state, simState);
      if (candidate.type === 'discard_card') {
        // Keep discard as a fallback, but force preference toward meaningful plays.
        score -= state.turn.number <= 8 ? 120 : 50;
      }
      return { candidate, simState, score };
    })
    .filter((item): item is { candidate: AIMove; simState: GameState; score: number } => item !== null);

  if (simulated.length === 0) {
    // Fallback to first discard if simulation fails unexpectedly.
    const fallback = candidates.find((entry) => entry.type === 'discard_card') ?? candidates[0];
    return { ...fallback, score: -999, reason: 'fallback' };
  }

  const lethal = simulated
    .filter((entry) => entry.simState.winner === 'ai')
    .sort((a, b) => b.score - a.score)[0];
  if (lethal) {
    return {
      ...lethal.candidate,
      score: lethal.score,
      reason: 'lethal',
    };
  }

  const playerHasLethal = hasLethalOnNextAction(state, 'player');
  if (playerHasLethal) {
    const defensive = simulated
      .filter((entry) => !hasLethalOnNextAction(entry.simState, 'player'))
      .sort((a, b) => b.score - a.score)[0];

    if (defensive) {
      return {
        ...defensive.candidate,
        score: defensive.score,
        reason: 'prevent_lethal',
      };
    }
  }

  const currentThreat = estimateThreatDamage(state, 'player');
  const currentDurability = state.players.ai.tower + state.players.ai.wall;
  if (currentThreat >= currentDurability) {
    const defensive = simulated
      .filter((entry) => isDefensiveMove(state, entry.simState))
      .sort((a, b) => b.score - a.score)[0];

    if (defensive) {
      return {
        ...defensive.candidate,
        score: defensive.score,
        reason: 'prevent_lethal',
      };
    }
  }

  if (state.turn.number <= 8) {
    const currentGenerators = generatorSnapshot(state.players.ai);
    const economyChoice = simulated
      .filter(
        (entry) =>
          entry.candidate.type === 'play_card' &&
          generatorSnapshot(entry.simState.players.ai) > currentGenerators,
      )
      .sort((a, b) => b.score - a.score)[0];

    if (economyChoice) {
      return {
        ...economyChoice.candidate,
        score: economyChoice.score,
        reason: 'early_economy',
      };
    }
  }

  simulated.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }

    const cardA = CARD_BY_ID[a.candidate.cardId];
    const cardB = CARD_BY_ID[b.candidate.cardId];
    const costA = cardA?.cost ?? 0;
    const costB = cardB?.cost ?? 0;

    if (costA !== costB) {
      return costB - costA;
    }
    const idA = a.candidate.cardId ?? '';
    const idB = b.candidate.cardId ?? '';
    return idA.localeCompare(idB);
  });

  const best = simulated[0];
  return {
    ...best.candidate,
    score: best.score,
    reason: best.candidate.type === 'discard_card' ? 'cycle' : 'heuristic_best',
  };
}

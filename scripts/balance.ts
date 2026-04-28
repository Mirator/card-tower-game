import { evaluateAIMove } from '../src/game/ai';
import { CARD_BY_ID, STARTER_DECK_CARD_IDS } from '../src/game/cards';
import {
  canAffordCard,
  createInitialGameState,
  reduceGameState,
} from '../src/game/engine';
import { SeededRng } from '../src/game/rng';
import type { Action, GameState, PlayerId } from '../src/game/types';

interface CardStats {
  played: number;
  playedByWinner: number;
  discarded: number;
}

interface SimResult {
  winner: PlayerId;
  turns: number;
  decidedByLethal: boolean;
  reachedTowerCap: boolean;
  endResources: { player: ResourceTotals; ai: ResourceTotals };
  unaffordablePlayerTurns: number;
  totalPlayerTurns: number;
}

interface ResourceTotals {
  bricks: number;
  weapons: number;
  crystals: number;
}

function buildAIView(state: GameState, actor: PlayerId): GameState {
  if (actor === 'ai') {
    return state;
  }
  return {
    ...state,
    players: {
      player: state.players.ai,
      ai: state.players.player,
    },
    turn: { ...state.turn, current: 'ai' },
  };
}

function chooseAction(state: GameState, actor: PlayerId): Action {
  const view = buildAIView(state, actor);
  const move = evaluateAIMove(view);
  return move.type === 'play_card'
    ? { type: 'play_card', playerId: actor, cardId: move.cardId }
    : { type: 'discard_card', playerId: actor, cardId: move.cardId };
}

function simulate(seed: number, cardStats: Map<string, CardStats>): SimResult {
  const rng = new SeededRng(seed);
  let state = createInitialGameState(seed);

  let guard = 0;
  let lastPlay: { actor: PlayerId; cardId: string } | null = null;
  let unaffordablePlayerTurns = 0;
  let totalPlayerTurns = 0;

  while (state.phase === 'playing' && guard < 1500) {
    if (!state.turn.started) {
      const started = reduceGameState(state, { type: 'start_turn' }, rng);
      if (started.errors.length > 0) {
        throw new Error(`start_turn failed: ${started.errors.join(', ')}`);
      }
      state = started.state;
      if (state.phase !== 'playing') {
        break;
      }
    }

    const actor = state.turn.current;
    if (state.players[actor].hand.length === 0) {
      throw new Error(`Empty hand on turn ${state.turn.number} for ${actor}`);
    }

    if (actor === 'player') {
      totalPlayerTurns += 1;
      const anyAffordable = state.players.player.hand.some((cardId) =>
        canAffordCard(state, 'player', cardId),
      );
      if (!anyAffordable) {
        unaffordablePlayerTurns += 1;
      }
    }

    const action = chooseAction(state, actor);

    if (action.type === 'play_card') {
      ensureStats(cardStats, action.cardId).played += 1;
      lastPlay = { actor, cardId: action.cardId };
    } else {
      ensureStats(cardStats, action.cardId).discarded += 1;
    }

    const acted = reduceGameState(state, action, rng);
    if (acted.errors.length > 0) {
      throw new Error(`action failed: ${acted.errors.join(', ')}`);
    }
    state = acted.state;
    if (state.phase === 'ended') {
      break;
    }

    const ended = reduceGameState(state, { type: 'end_turn' }, rng);
    if (ended.errors.length > 0) {
      throw new Error(`end_turn failed: ${ended.errors.join(', ')}`);
    }
    state = ended.state;
    guard += 1;
  }

  if (!state.winner) {
    throw new Error(`Match did not terminate at seed ${seed} after ${guard} turns`);
  }

  if (lastPlay && lastPlay.actor === state.winner) {
    ensureStats(cardStats, lastPlay.cardId).playedByWinner += 1;
  }

  const decidedByLethal =
    state.players.player.tower <= 0 || state.players.ai.tower <= 0;
  const reachedTowerCap =
    state.players.player.tower >= state.winTower || state.players.ai.tower >= state.winTower;

  return {
    winner: state.winner,
    turns: state.turn.number,
    decidedByLethal,
    reachedTowerCap,
    endResources: {
      player: {
        bricks: state.players.player.bricks,
        weapons: state.players.player.weapons,
        crystals: state.players.player.crystals,
      },
      ai: {
        bricks: state.players.ai.bricks,
        weapons: state.players.ai.weapons,
        crystals: state.players.ai.crystals,
      },
    },
    unaffordablePlayerTurns,
    totalPlayerTurns,
  };
}

function ensureStats(map: Map<string, CardStats>, cardId: string): CardStats {
  let stats = map.get(cardId);
  if (!stats) {
    stats = { played: 0, playedByWinner: 0, discarded: 0 };
    map.set(cardId, stats);
  }
  return stats;
}

function pad(value: string | number, width: number): string {
  return String(value).padStart(width);
}

function leftPad(value: string, width: number): string {
  return value.padEnd(width);
}

function runBalance(matchCount: number, seedOffset: number): void {
  const cardStats = new Map<string, CardStats>();
  for (const cardId of new Set(STARTER_DECK_CARD_IDS)) {
    cardStats.set(cardId, { played: 0, playedByWinner: 0, discarded: 0 });
  }

  let playerWins = 0;
  let aiWins = 0;
  let lethalDecisions = 0;
  let towerCapDecisions = 0;
  let totalTurns = 0;
  let totalUnaffordablePlayerTurns = 0;
  let totalPlayerTurns = 0;
  let totalEndBricks = 0;
  let totalEndWeapons = 0;
  let totalEndCrystals = 0;
  const turnBuckets = [
    { label: '<= 20', count: 0 },
    { label: '21-40', count: 0 },
    { label: '41-60', count: 0 },
    { label: '61-100', count: 0 },
    { label: '>100', count: 0 },
  ];

  const start = Date.now();
  for (let i = 0; i < matchCount; i += 1) {
    const result = simulate(seedOffset + i, cardStats);
    if (result.winner === 'player') playerWins += 1;
    else aiWins += 1;
    if (result.decidedByLethal) lethalDecisions += 1;
    if (result.reachedTowerCap) towerCapDecisions += 1;
    totalTurns += result.turns;
    totalUnaffordablePlayerTurns += result.unaffordablePlayerTurns;
    totalPlayerTurns += result.totalPlayerTurns;
    totalEndBricks += result.endResources.player.bricks + result.endResources.ai.bricks;
    totalEndWeapons += result.endResources.player.weapons + result.endResources.ai.weapons;
    totalEndCrystals += result.endResources.player.crystals + result.endResources.ai.crystals;
    if (result.turns <= 20) turnBuckets[0].count += 1;
    else if (result.turns <= 40) turnBuckets[1].count += 1;
    else if (result.turns <= 60) turnBuckets[2].count += 1;
    else if (result.turns <= 100) turnBuckets[3].count += 1;
    else turnBuckets[4].count += 1;
  }
  const elapsedMs = Date.now() - start;

  const avgTurns = totalTurns / matchCount;
  const playerWinRate = playerWins / matchCount;

  console.log('=== Card Tower balance harness ===');
  console.log(`matches:           ${matchCount}`);
  console.log(`seed offset:       ${seedOffset}`);
  console.log(`elapsed:           ${elapsedMs} ms (${(elapsedMs / matchCount).toFixed(2)} ms/match)`);
  console.log('');
  console.log('--- Outcome ---');
  console.log(`player wins:       ${playerWins} (${(playerWinRate * 100).toFixed(1)}%)`);
  console.log(`ai wins:           ${aiWins} (${((aiWins / matchCount) * 100).toFixed(1)}%)`);
  console.log(`first-player edge: ${((playerWinRate - 0.5) * 100).toFixed(2)} pp`);
  console.log(`avg turn count:    ${avgTurns.toFixed(2)}`);
  console.log(`decided by lethal: ${lethalDecisions} (${((lethalDecisions / matchCount) * 100).toFixed(1)}%)`);
  console.log(`decided by 100T:   ${towerCapDecisions} (${((towerCapDecisions / matchCount) * 100).toFixed(1)}%)`);
  console.log('');

  const avgEndBricks = totalEndBricks / (matchCount * 2);
  const avgEndWeapons = totalEndWeapons / (matchCount * 2);
  const avgEndCrystals = totalEndCrystals / (matchCount * 2);
  const unaffordableRate = totalPlayerTurns > 0 ? totalUnaffordablePlayerTurns / totalPlayerTurns : 0;
  console.log('--- Economy ---');
  console.log(`avg end-of-match resources per side: bricks ${avgEndBricks.toFixed(1)}  weapons ${avgEndWeapons.toFixed(1)}  crystals ${avgEndCrystals.toFixed(1)}`);
  console.log(`bricked turns (no affordable card): ${totalUnaffordablePlayerTurns}/${totalPlayerTurns} player turns (${(unaffordableRate * 100).toFixed(2)}%)`);
  console.log('');

  console.log('--- Turn distribution ---');
  for (const b of turnBuckets) {
    console.log(`${leftPad(b.label, 8)} ${pad(b.count, 5)} (${((b.count / matchCount) * 100).toFixed(1)}%)`);
  }
  console.log('');

  console.log('--- Per-card stats (active deck) ---');
  console.log(
    `${leftPad('card', 18)} ${leftPad('domain', 9)} ${leftPad('cost', 5)} ${leftPad('played', 9)} ${leftPad('discarded', 11)} ${leftPad('finisher', 9)}`,
  );
  const sortedStats = [...cardStats.entries()].sort((a, b) => {
    const cardA = CARD_BY_ID[a[0]];
    const cardB = CARD_BY_ID[b[0]];
    if (!cardA || !cardB) return 0;
    if (cardA.domain !== cardB.domain) return cardA.domain.localeCompare(cardB.domain);
    return cardA.cost - cardB.cost;
  });
  for (const [cardId, stats] of sortedStats) {
    const card = CARD_BY_ID[cardId];
    if (!card) continue;
    console.log(
      `${leftPad(card.name, 18)} ${leftPad(card.domain, 9)} ${pad(card.cost, 5)} ${pad(stats.played, 9)} ${pad(stats.discarded, 11)} ${pad(stats.playedByWinner, 9)}`,
    );
  }
  console.log('');
  console.log('finisher = times card was the last play before the actor won');
}

const matchCount = Number(process.env.BALANCE_MATCHES ?? 1000);
const seedOffset = Number(process.env.BALANCE_SEED ?? 1);
runBalance(matchCount, seedOffset);

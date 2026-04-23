import { describe, expect, it } from 'vitest';
import { cloneGameState, createInitialGameState } from '../src/game/engine';
import { evaluateAIMove } from '../src/game/ai';
import type { GameState } from '../src/game/types';

function withAiTurn(state: GameState): GameState {
  const copy = cloneGameState(state);
  copy.turn.current = 'ai';
  copy.turn.started = true;
  copy.turn.actionTaken = false;
  return copy;
}

describe('ai controller', () => {
  it('plays lethal when available', () => {
    let state = withAiTurn(createInitialGameState(1200));
    state.players.ai.hand = ['overrun'];
    state.players.ai.weapons = 20;
    state.players.player.wall = 0;
    state.players.player.tower = 10;

    const move = evaluateAIMove(state);
    expect(move.type).toBe('play_card');
    expect(move.cardId).toBe('overrun');
    expect(move.reason).toBe('lethal');
  });

  it('prefers defensive line when under lethal threat', () => {
    let state = withAiTurn(createInitialGameState(1300));
    state.players.ai.tower = 5;
    state.players.ai.wall = 0;
    state.players.ai.bricks = 20;
    state.players.ai.weapons = 20;
    state.players.ai.hand = ['fortress', 'strike'];

    state.players.player.hand = ['cataclysm'];
    state.players.player.crystals = 20;
    state.players.player.wall = 0;

    const move = evaluateAIMove(state);
    expect(move.type).toBe('play_card');
    expect(move.cardId).toBe('fortress');
    expect(move.reason).toBe('prevent_lethal');
  });

  it('favors economy growth early in neutral position', () => {
    let state = withAiTurn(createInitialGameState(1400));
    state.turn.number = 2;
    state.players.ai.hand = ['siege_crew', 'strike'];
    state.players.ai.weapons = 8;
    state.players.ai.tower = 30;
    state.players.player.tower = 30;
    state.players.ai.wall = 10;
    state.players.player.wall = 10;

    const move = evaluateAIMove(state);
    expect(move.type).toBe('play_card');
    expect(move.cardId).toBe('siege_crew');
  });
});

import { describe, expect, it } from 'vitest';
import { evaluateAIMove } from '../src/game/ai';
import { canAffordCard, createInitialGameState, reduceGameState, summarizeForText } from '../src/game/engine';
import { SeededRng } from '../src/game/rng';
import type { Action, GameState } from '../src/game/types';

function choosePlayerAction(state: GameState): Action {
  for (const cardId of state.players.player.hand) {
    if (canAffordCard(state, 'player', cardId)) {
      return { type: 'play_card', playerId: 'player', cardId };
    }
  }

  const fallback = state.players.player.hand[0];
  return { type: 'discard_card', playerId: 'player', cardId: fallback };
}

describe('match simulation', () => {
  it('resolves full match from initial state', () => {
    const rng = new SeededRng(31337);
    let state = createInitialGameState(31337);
    state.winTower = 60;
    state.players.player.tower = 20;
    state.players.ai.tower = 20;
    state.players.player.wall = 0;
    state.players.ai.wall = 0;

    let guard = 0;
    while (state.phase === 'playing' && guard < 500) {
      if (!state.turn.started) {
        const started = reduceGameState(state, { type: 'start_turn' }, rng);
        expect(started.errors).toEqual([]);
        state = started.state;
      }

      const action: Action = state.turn.current === 'ai' ? (() => {
        const move = evaluateAIMove(state);
        return move.type === 'play_card'
          ? { type: 'play_card', playerId: 'ai', cardId: move.cardId }
          : { type: 'discard_card', playerId: 'ai', cardId: move.cardId };
      })() : choosePlayerAction(state);

      const acted = reduceGameState(state, action, rng);
      expect(acted.errors).toEqual([]);
      state = acted.state;

      const ended = reduceGameState(state, { type: 'end_turn' }, rng);
      expect(ended.errors).toEqual([]);
      state = ended.state;

      guard += 1;
    }

    expect(state.winner).not.toBeNull();
    expect(guard).toBeLessThan(500);

    const rendered = summarizeForText(state);
    const parsed = JSON.parse(rendered) as { winner: string | null; mode: string };
    expect(parsed.mode).toBe('ended');
    expect(parsed.winner).not.toBeNull();
  });
});

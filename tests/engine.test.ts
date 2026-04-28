import { describe, expect, it } from 'vitest';
import { CARD_BY_ID, STARTER_DECK_CARD_IDS } from '../src/game/cards';
import { cloneGameState, createInitialGameState, reduceGameState } from '../src/game/engine';
import { SeededRng } from '../src/game/rng';
import type { GameState } from '../src/game/types';

function withPlayerTurn(state: GameState): GameState {
  const copy = cloneGameState(state);
  copy.turn.current = 'player';
  copy.turn.started = true;
  copy.turn.actionTaken = false;
  return copy;
}

describe('game engine', () => {
  it('spends resources and refills hand at the start of the next turn', () => {
    const rng = new SeededRng(1001);
    let state = createInitialGameState(1001);

    state = withPlayerTurn(state);
    state.players.player.hand = ['strike'];
    state.players.player.weapons = 10;
    state.players.player.deck = ['slash', 'raid', 'smash', 'strike', 'pierce', 'overrun'];

    const play = reduceGameState(state, { type: 'play_card', playerId: 'player', cardId: 'strike' }, rng);
    expect(play.errors).toEqual([]);
    expect(play.state.players.player.weapons).toBe(6);
    expect(play.state.turn.actionTaken).toBe(true);

    const end = reduceGameState(play.state, { type: 'end_turn' }, rng);
    expect(end.errors).toEqual([]);
    expect(end.state.players.player.hand.length).toBe(0);
    expect(end.state.turn.current).toBe('ai');
    expect(end.state.turn.started).toBe(false);

    const nextPlayerTurn = cloneGameState(end.state);
    nextPlayerTurn.turn.current = 'player';
    nextPlayerTurn.turn.started = false;
    nextPlayerTurn.turn.actionTaken = false;

    const started = reduceGameState(nextPlayerTurn, { type: 'start_turn' }, rng);
    expect(started.errors).toEqual([]);
    expect(started.state.players.player.hand.length).toBe(6);
  });

  it('applies barrier and fortify reductions in damage pipeline', () => {
    const rng = new SeededRng(2222);
    let state = createInitialGameState(2222);
    state = withPlayerTurn(state);

    state.players.player.hand = ['raid'];
    state.players.player.weapons = 10;

    state.players.ai.wall = 5;
    state.players.ai.tower = 30;
    state.players.ai.statuses.barrier = 3;
    state.players.ai.statuses.nextIncomingDamageReduction = 2;

    const play = reduceGameState(state, { type: 'play_card', playerId: 'player', cardId: 'raid' }, rng);

    // Raid deals 11; barrier blocks 3 (-> 8), fortify blocks 2 (-> 6), wall absorbs 5 (-> 1), tower takes 1.
    expect(play.errors).toEqual([]);
    expect(play.state.players.ai.statuses.barrier).toBe(0);
    expect(play.state.players.ai.statuses.nextIncomingDamageReduction).toBe(0);
    expect(play.state.players.ai.wall).toBe(0);
    expect(play.state.players.ai.tower).toBe(29);
  });

  it('is deterministic for random effects with same seed', () => {
    const base = withPlayerTurn(createInitialGameState(3333));
    base.players.player.hand = ['chaos'];
    base.players.player.crystals = 20;

    const rngA = new SeededRng(555);
    const rngB = new SeededRng(555);

    const one = reduceGameState(base, { type: 'play_card', playerId: 'player', cardId: 'chaos' }, rngA);
    const two = reduceGameState(base, { type: 'play_card', playerId: 'player', cardId: 'chaos' }, rngB);

    expect(one.errors).toEqual([]);
    expect(two.errors).toEqual([]);
    expect(one.state.players.ai.tower).toBe(two.state.players.ai.tower);
    expect(one.state.players.player.tower).toBe(two.state.players.player.tower);
    expect(one.logs).toEqual(two.logs);
  });

  it('applies freeze and curse status over start of turn', () => {
    const rng = new SeededRng(4444);

    let freezeState = withPlayerTurn(createInitialGameState(4444));
    freezeState.players.player.hand = ['freeze'];
    freezeState.players.player.crystals = 20;
    freezeState.players.ai.bricks = 5;
    freezeState.players.ai.weapons = 5;
    freezeState.players.ai.crystals = 5;

    freezeState = reduceGameState(freezeState, { type: 'play_card', playerId: 'player', cardId: 'freeze' }, rng).state;
    freezeState = reduceGameState(freezeState, { type: 'end_turn' }, rng).state;
    freezeState = reduceGameState(freezeState, { type: 'start_turn' }, rng).state;

    expect(freezeState.players.ai.bricks).toBe(5);
    expect(freezeState.players.ai.weapons).toBe(5);
    expect(freezeState.players.ai.crystals).toBe(5);

    let curseState = withPlayerTurn(createInitialGameState(9898));
    curseState.players.player.hand = ['curse'];
    curseState.players.player.crystals = 20;
    curseState.players.ai.tower = 25;

    curseState = reduceGameState(curseState, { type: 'play_card', playerId: 'player', cardId: 'curse' }, rng).state;
    curseState = reduceGameState(curseState, { type: 'end_turn' }, rng).state;
    curseState = reduceGameState(curseState, { type: 'start_turn' }, rng).state;

    expect(curseState.players.ai.tower).toBe(23);
    expect(curseState.players.ai.statuses.curseTurns).toBe(1);
  });

  it('supports mirror/transmute/pillage/control card behaviors', () => {
    const rng = new SeededRng(7777);

    let mirror = withPlayerTurn(createInitialGameState(7777));
    mirror.players.player.hand = ['mirror'];
    mirror.players.player.crystals = 20;
    mirror.players.ai.tower = 30;
    mirror.players.ai.wall = 0;
    mirror.lastResolved = {
      actor: 'ai',
      cardId: 'strike',
      effects: [{ type: 'attack', amount: 4, source: 'attack' }],
    };
    mirror = reduceGameState(mirror, { type: 'play_card', playerId: 'player', cardId: 'mirror' }, rng).state;
    expect(mirror.players.ai.tower).toBeLessThan(30);

    let transmute = withPlayerTurn(createInitialGameState(8877));
    transmute.players.player.hand = ['transmute'];
    transmute.players.player.crystals = 6;
    transmute.players.player.bricks = 10;
    transmute.players.player.weapons = 1;
    transmute = reduceGameState(transmute, { type: 'play_card', playerId: 'player', cardId: 'transmute' }, rng).state;
    expect(transmute.players.player.bricks).toBe(4);
    expect(transmute.players.player.weapons).toBe(7);

    let pillage = withPlayerTurn(createInitialGameState(2288));
    pillage.players.player.hand = ['pillage'];
    pillage.players.player.weapons = 20;
    pillage.players.ai.bricks = 5;
    pillage.players.ai.weapons = 5;
    pillage.players.ai.crystals = 5;
    const playerTotalBefore = pillage.players.player.bricks + pillage.players.player.weapons + pillage.players.player.crystals;
    const aiTotalBefore = pillage.players.ai.bricks + pillage.players.ai.weapons + pillage.players.ai.crystals;
    pillage = reduceGameState(pillage, { type: 'play_card', playerId: 'player', cardId: 'pillage' }, rng).state;
    const playerTotalAfter = pillage.players.player.bricks + pillage.players.player.weapons + pillage.players.player.crystals;
    const aiTotalAfter = pillage.players.ai.bricks + pillage.players.ai.weapons + pillage.players.ai.crystals;
    const stolen = aiTotalBefore - aiTotalAfter;
    expect(stolen).toBeGreaterThan(0);
    expect(stolen).toBeLessThanOrEqual(5);
    expect(playerTotalAfter).toBe(playerTotalBefore - CARD_BY_ID.pillage.cost + stolen);

    let control = withPlayerTurn(createInitialGameState(9997));
    control.players.player.hand = ['control'];
    control.players.player.crystals = 20;
    control.players.ai.hand = ['strike', 'slash', 'raid', 'smash', 'war_cry', 'pierce'];
    control = reduceGameState(control, { type: 'play_card', playerId: 'player', cardId: 'control' }, rng).state;
    expect(control.players.ai.hand.length).toBe(4);
  });

  it('contains all 60 cards and known ids', () => {
    expect(Object.keys(CARD_BY_ID).length).toBe(60);
    expect(CARD_BY_ID.cataclysm.cost).toBe(15);
  });

  it('uses a 30-card physical starter deck with duplicate staples', () => {
    const counts = STARTER_DECK_CARD_IDS.reduce<Record<string, number>>((acc, cardId) => {
      acc[cardId] = (acc[cardId] ?? 0) + 1;
      return acc;
    }, {});

    expect(STARTER_DECK_CARD_IDS.length).toBe(30);
    expect(STARTER_DECK_CARD_IDS.every((cardId) => Boolean(CARD_BY_ID[cardId]))).toBe(true);
    expect(counts).toMatchObject({
      brick_patch: 2,
      repair: 2,
      strike: 2,
      slash: 2,
      spark: 2,
      zap: 2,
      crystal_boost: 2,
    });

    const domainCounts = STARTER_DECK_CARD_IDS.reduce<Record<string, number>>((acc, cardId) => {
      const domain = CARD_BY_ID[cardId].domain;
      acc[domain] = (acc[domain] ?? 0) + 1;
      return acc;
    }, {});
    expect(domainCounts).toEqual({ bricks: 10, weapons: 10, crystals: 10 });

    const state = createInitialGameState(6060);
    expect(state.players.player.hand.length + state.players.player.deck.length).toBe(30);
    expect(state.players.ai.hand.length + state.players.ai.deck.length).toBe(30);
  });

  it('reshuffles discard into the deck when the draw pile is empty during next-turn refill', () => {
    const rng = new SeededRng(8181);
    let state = withPlayerTurn(createInitialGameState(8181));

    state.players.player.hand = ['strike', 'slash', 'raid', 'smash', 'spark'];
    state.players.player.deck = [];
    state.players.player.discard = ['zap'];
    state.players.player.weapons = 20;

    const play = reduceGameState(state, { type: 'play_card', playerId: 'player', cardId: 'strike', handIndex: 0 }, rng);
    expect(play.errors).toEqual([]);

    const end = reduceGameState(play.state, { type: 'end_turn' }, rng);
    expect(end.errors).toEqual([]);
    expect(end.state.players.player.hand.length).toBe(4);
    expect(end.state.players.player.deck.length).toBe(0);
    expect(end.state.players.player.discard.length).toBe(2);

    const nextPlayerTurn = cloneGameState(end.state);
    nextPlayerTurn.turn.current = 'player';
    nextPlayerTurn.turn.started = false;
    nextPlayerTurn.turn.actionTaken = false;

    const started = reduceGameState(nextPlayerTurn, { type: 'start_turn' }, rng);
    expect(started.errors).toEqual([]);
    expect(started.state.players.player.hand.length).toBe(6);
    expect(started.state.players.player.deck.length).toBe(0);
    expect(started.state.players.player.discard.length).toBe(0);
    expect(started.state.players.player.hand).toEqual(expect.arrayContaining(['strike', 'zap']));
  });

  it('targets duplicate hand slots by index for play and discard', () => {
    const rng = new SeededRng(9292);
    let playState = withPlayerTurn(createInitialGameState(9292));
    playState.players.player.hand = ['strike', 'slash', 'strike'];
    playState.players.player.deck = [];
    playState.players.player.discard = [];
    playState.players.player.weapons = 20;

    const played = reduceGameState(playState, { type: 'play_card', playerId: 'player', cardId: 'strike', handIndex: 2 }, rng);
    expect(played.errors).toEqual([]);
    expect(played.state.players.player.hand).toEqual(['strike', 'slash']);
    expect(played.state.players.player.discard).toEqual(['strike']);

    let discardState = withPlayerTurn(createInitialGameState(9393));
    discardState.players.player.hand = ['strike', 'slash', 'strike'];
    discardState.players.player.deck = ['zap'];
    discardState.players.player.discard = [];

    const discarded = reduceGameState(discardState, { type: 'discard_card', playerId: 'player', cardId: 'strike', handIndex: 2 }, rng);
    expect(discarded.errors).toEqual([]);
    expect(discarded.state.players.player.hand).toEqual(['strike', 'slash', 'zap']);
    expect(discarded.state.players.player.discard).toEqual(['strike']);

    const invalid = reduceGameState(discardState, { type: 'discard_card', playerId: 'player', cardId: 'strike', handIndex: 1 }, rng);
    expect(invalid.errors).toEqual(['Card is not in hand.']);
  });
});

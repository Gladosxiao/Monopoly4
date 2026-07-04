import { describe, it, expect } from 'vitest';
import { castMagicSpell } from '../engine.js';
import { makeTestState, giveCard, firstSpecialSlot } from './setup.js';

describe('魔法屋', () => {
  it('交换现金', () => {
    const state = makeTestState();
    const magicTile = firstSpecialSlot(state);
    state.status = 'acting';
    state.players[0].position = magicTile;
    state.map.tiles[magicTile].type = 'magic';
    state.players[0].cash = 5000;
    state.players[1].cash = 20000;
    const result = castMagicSpell(state, 'p1', 'p2', 'swapCash');
    expect(result.success).toBe(true);
    expect(state.players[0].cash).toBe(20000);
    expect(state.players[1].cash).toBe(5000);
  });

  it('送走目标可遣散的神明', () => {
    const state = makeTestState();
    const magicTile = firstSpecialSlot(state);
    state.status = 'acting';
    state.players[0].position = magicTile;
    state.map.tiles[magicTile].type = 'magic';
    state.players[1].spirit = { spiritId: 'smallPovertyGod', remainingDays: 3 };
    const result = castMagicSpell(state, 'p1', 'p2', 'dismissSpirit');
    expect(result.success).toBe(true);
    expect(state.players[1].spirit).toBeUndefined();
  });

  it('抢夺目标卡片', () => {
    const state = makeTestState();
    const magicTile = firstSpecialSlot(state);
    state.status = 'acting';
    state.players[0].position = magicTile;
    state.map.tiles[magicTile].type = 'magic';
    giveCard(state.players[1], 'stay');
    const result = castMagicSpell(state, 'p1', 'p2', 'stealCard');
    expect(result.success).toBe(true);
    expect(state.players[0].cards).toHaveLength(1);
    expect(state.players[1].cards).toHaveLength(0);
  });

  it('将目标关进监狱', () => {
    const state = makeTestState();
    const magicTile = firstSpecialSlot(state);
    state.status = 'acting';
    state.players[0].position = magicTile;
    state.map.tiles[magicTile].type = 'magic';
    const result = castMagicSpell(state, 'p1', 'p2', 'jail');
    expect(result.success).toBe(true);
    expect(state.players[1].statusEffects.some((e) => e.type === 'jail')).toBe(true);
  });
});

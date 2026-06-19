/**
 * 道具效果单元测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { GameState } from '@monopoly4/shared';
import { makeTestState, giveItem, setOwner } from './setup.js';
import { useItem } from '../engine.js';

function prepareActingState(state: GameState, playerIndex = 0): void {
  state.currentPlayerIndex = playerIndex;
  state.status = 'acting';
  state.pendingTileIndex = state.players[playerIndex].position;
}

describe('交通工具道具', () => {
  it('机车道具进入背包并保持唯一', () => {
    const state = makeTestState();
    prepareActingState(state);
    giveItem(state.players[0], 'bike');
    const result = useItem(state, 'p1', 'bike');
    expect(result.success).toBe(true);
    expect(state.players[0].items.some((i) => i.itemId === 'bike')).toBe(true);
  });

  it('汽车道具进入背包并保持唯一', () => {
    const state = makeTestState();
    prepareActingState(state);
    giveItem(state.players[0], 'car');
    const result = useItem(state, 'p1', 'car');
    expect(result.success).toBe(true);
    expect(state.players[0].items.some((i) => i.itemId === 'car')).toBe(true);
  });

  it('使用新交通工具会替换背包中旧交通工具', () => {
    const state = makeTestState();
    prepareActingState(state);
    giveItem(state.players[0], 'bike');
    useItem(state, 'p1', 'bike');
    giveItem(state.players[0], 'car');
    useItem(state, 'p1', 'car');
    expect(state.players[0].items.some((i) => i.itemId === 'car')).toBe(true);
    expect(state.players[0].items.some((i) => i.itemId === 'bike')).toBe(false);
  });
});

describe('陷阱道具', () => {
  it('路障可放置在道路上', () => {
    const state = makeTestState();
    prepareActingState(state);
    giveItem(state.players[0], 'barrier');
    const result = useItem(state, 'p1', 'barrier', { targetTileIndex: 5 });
    expect(result.success).toBe(true);
    expect(state.map.tiles[5].traps?.some((t) => t.type === 'barrier')).toBe(true);
  });

  it('地雷可放置在道路上', () => {
    const state = makeTestState();
    prepareActingState(state);
    giveItem(state.players[0], 'mine');
    const result = useItem(state, 'p1', 'mine', { targetTileIndex: 5 });
    expect(result.success).toBe(true);
    expect(state.map.tiles[5].traps?.some((t) => t.type === 'mine')).toBe(true);
  });

  it('定时炸弹放置后带有剩余步数', () => {
    const state = makeTestState();
    prepareActingState(state);
    giveItem(state.players[0], 'timeBomb');
    const result = useItem(state, 'p1', 'timeBomb', { targetTileIndex: 5 });
    expect(result.success).toBe(true);
    const trap = state.map.tiles[5].traps?.find((t) => t.type === 'timeBomb');
    expect(trap?.remainingSteps).toBe(38);
  });

  it('不能在起点/监狱/医院放置陷阱', () => {
    const state = makeTestState();
    prepareActingState(state);
    giveItem(state.players[0], 'barrier');
    const result = useItem(state, 'p1', 'barrier', { targetTileIndex: 0 });
    expect(result.success).toBe(false);
  });

  it('同一块地最多放置 3 个陷阱', () => {
    const state = makeTestState();
    prepareActingState(state);
    for (let i = 0; i < 3; i++) {
      giveItem(state.players[0], 'barrier');
      useItem(state, 'p1', 'barrier', { targetTileIndex: 5 });
    }
    giveItem(state.players[0], 'barrier');
    const result = useItem(state, 'p1', 'barrier', { targetTileIndex: 5 });
    expect(result.success).toBe(false);
  });
});

describe('工具道具', () => {
  it('遥控骰子设置下次掷骰点数', () => {
    const state = makeTestState();
    prepareActingState(state);
    giveItem(state.players[0], 'remoteDice');
    const result = useItem(state, 'p1', 'remoteDice', { diceValue: 3 });
    expect(result.success).toBe(true);
    expect(state.players[0].nextDiceOverride).toBe(3);
  });

  it('遥控骰子点数越界失败', () => {
    const state = makeTestState();
    prepareActingState(state);
    giveItem(state.players[0], 'remoteDice');
    expect(useItem(state, 'p1', 'remoteDice', { diceValue: 0 }).success).toBe(false);
    expect(useItem(state, 'p1', 'remoteDice', { diceValue: 7 }).success).toBe(false);
  });

  it('机器娃娃清除前方陷阱', () => {
    const state = makeTestState();
    state.players[0].position = 1;
    prepareActingState(state);
    // 在前方第 5 格放置地雷
    giveItem(state.players[0], 'mine');
    useItem(state, 'p1', 'mine', { targetTileIndex: 6 });
    expect(state.map.tiles[6].traps?.length).toBeGreaterThan(0);

    giveItem(state.players[0], 'robotDoll');
    const result = useItem(state, 'p1', 'robotDoll');
    expect(result.success).toBe(true);
    expect(state.map.tiles[6].traps?.length ?? 0).toBe(0);
  });

  it('飞弹降低目标建筑等级并使站立玩家住院', () => {
    const state = makeTestState();
    setOwner(state, 21, 'p2', 'mall', 2);
    state.players[1].position = 21;
    prepareActingState(state);
    giveItem(state.players[0], 'missile');
    const result = useItem(state, 'p1', 'missile', { targetTileIndex: 21 });
    expect(result.success).toBe(true);
    expect(state.map.tiles[21].level).toBe(1);
    expect(state.players[1].statusEffects.some((e) => e.type === 'hospital')).toBe(true);
  });
});

describe('未实现道具', () => {
  it('研发产物返回未实现', () => {
    const state = makeTestState();
    prepareActingState(state);
    for (const itemId of ['robot', 'timeMachine', 'teleporter', 'engineerTruck', 'nuke']) {
      giveItem(state.players[0], itemId);
      const result = useItem(state, 'p1', itemId);
      expect(result.success).toBe(false);
      expect(result.message).toContain('尚未实现');
    }
  });
});

describe('道具堆叠', () => {
  it('同种道具数量可叠加', () => {
    const state = makeTestState();
    giveItem(state.players[0], 'mine', 3);
    const item = state.players[0].items.find((i) => i.itemId === 'mine');
    expect(item?.quantity).toBe(3);
  });
});

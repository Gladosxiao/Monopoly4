/**
 * 道具效果单元测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { GameState } from '@monopoly4/shared';
import { makeTestState, giveItem, setOwner, setPlayerPosition, smallPropertyAt, largePropertyAt } from './setup.js';
import { useItem } from '../engine.js';
import { freeBuyItem } from '../testMode/index.js';

function prepareActingState(state: GameState, playerIndex = 0): void {
  state.currentPlayerIndex = playerIndex;
  state.status = 'acting';
  state.pendingTileIndex = state.players[playerIndex].position;
}

describe('交通工具道具', () => {
  it('装备机车道具后保留在背包中且 vehicle 变为 bike', () => {
    const state = makeTestState();
    prepareActingState(state);
    giveItem(state.players[0], 'bike');
    const result = useItem(state, 'p1', 'bike');
    expect(result.success).toBe(true);
    expect(state.players[0].items.some((i) => i.itemId === 'bike')).toBe(true);
    expect(state.players[0].vehicle).toBe('bike');
  });

  it('装备汽车道具后保留在背包中且 vehicle 变为 car', () => {
    const state = makeTestState();
    prepareActingState(state);
    giveItem(state.players[0], 'car');
    const result = useItem(state, 'p1', 'car');
    expect(result.success).toBe(true);
    expect(state.players[0].items.some((i) => i.itemId === 'car')).toBe(true);
    expect(state.players[0].vehicle).toBe('car');
  });

  it('装备新交通工具会卸下旧交通工具，两者都保留在背包中', () => {
    const state = makeTestState();
    prepareActingState(state);
    giveItem(state.players[0], 'bike');
    useItem(state, 'p1', 'bike');
    giveItem(state.players[0], 'car');
    useItem(state, 'p1', 'car');
    expect(state.players[0].items.some((i) => i.itemId === 'car')).toBe(true);
    expect(state.players[0].items.some((i) => i.itemId === 'bike')).toBe(true);
    expect(state.players[0].vehicle).toBe('car');
  });

  it('再次点击已装备的交通工具会卸下并恢复步行', () => {
    const state = makeTestState();
    prepareActingState(state);
    giveItem(state.players[0], 'bike');
    useItem(state, 'p1', 'bike');
    const result = useItem(state, 'p1', 'bike');
    expect(result.success).toBe(true);
    expect(state.players[0].vehicle).toBe('walk');
    expect(state.players[0].items.some((i) => i.itemId === 'bike')).toBe(true);
  });
});

describe('陷阱道具', () => {
  it('路障可放置在道路上', () => {
    const state = makeTestState();
    prepareActingState(state);
    giveItem(state.players[0], 'barrier');
    const targetTile = smallPropertyAt(state, 1, 0);
    const result = useItem(state, 'p1', 'barrier', { targetTileIndex: targetTile });
    expect(result.success).toBe(true);
    expect(state.map.tiles[targetTile].traps?.some((t) => t.type === 'barrier')).toBe(true);
  });

  it('地雷可放置在道路上', () => {
    const state = makeTestState();
    prepareActingState(state);
    giveItem(state.players[0], 'mine');
    const targetTile = smallPropertyAt(state, 1, 0);
    const result = useItem(state, 'p1', 'mine', { targetTileIndex: targetTile });
    expect(result.success).toBe(true);
    expect(state.map.tiles[targetTile].traps?.some((t) => t.type === 'mine')).toBe(true);
  });

  it('定时炸弹放置后带有剩余步数', () => {
    const state = makeTestState();
    prepareActingState(state);
    giveItem(state.players[0], 'timeBomb');
    const targetTile = smallPropertyAt(state, 1, 0);
    const result = useItem(state, 'p1', 'timeBomb', { targetTileIndex: targetTile });
    expect(result.success).toBe(true);
    const trap = state.map.tiles[targetTile].traps?.find((t) => t.type === 'timeBomb');
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
    const targetTile = smallPropertyAt(state, 1, 0);
    for (let i = 0; i < 3; i++) {
      giveItem(state.players[0], 'barrier');
      useItem(state, 'p1', 'barrier', { targetTileIndex: targetTile });
    }
    giveItem(state.players[0], 'barrier');
    const result = useItem(state, 'p1', 'barrier', { targetTileIndex: targetTile });
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
    const playerTile = smallPropertyAt(state, 0, 0);
    const trapTile = smallPropertyAt(state, 0, 1);
    setPlayerPosition(state, 'p1', playerTile);
    prepareActingState(state);
    // 在前方相邻格放置地雷
    giveItem(state.players[0], 'mine');
    useItem(state, 'p1', 'mine', { targetTileIndex: trapTile });
    expect(state.map.tiles[trapTile].traps?.length).toBeGreaterThan(0);

    giveItem(state.players[0], 'robotDoll');
    const result = useItem(state, 'p1', 'robotDoll');
    expect(result.success).toBe(true);
    expect(state.map.tiles[trapTile].traps?.length ?? 0).toBe(0);
  });

  it('飞弹降低目标建筑等级并使站立玩家住院', () => {
    const state = makeTestState();
    const targetTile = largePropertyAt(state, 0);
    setOwner(state, targetTile, 'p2', 'mall', 2);
    setPlayerPosition(state, 'p2', targetTile);
    prepareActingState(state);
    giveItem(state.players[0], 'missile');
    const result = useItem(state, 'p1', 'missile', { targetTileIndex: targetTile });
    expect(result.success).toBe(true);
    expect(state.map.tiles[targetTile].level).toBe(1);
    expect(state.players[1].statusEffects.some((e) => e.type === 'hospital')).toBe(true);
  });
});

describe('研发产物', () => {
  it('机器人可免费升级自己的土地', () => {
    const state = makeTestState();
    const targetTile = smallPropertyAt(state, 0, 0);
    setOwner(state, targetTile, 'p1', 'house', 1);
    prepareActingState(state);
    giveItem(state.players[0], 'robot');
    const result = useItem(state, 'p1', 'robot', { targetTileIndex: targetTile });
    expect(result.success).toBe(true);
    expect(state.map.tiles[targetTile].level).toBe(2);
  });

  it('传送机移动到目标地块', () => {
    const state = makeTestState();
    prepareActingState(state);
    const targetTile = smallPropertyAt(state, 2, 1);
    giveItem(state.players[0], 'teleporter');
    const result = useItem(state, 'p1', 'teleporter', { targetTileIndex: targetTile });
    expect(result.success).toBe(true);
    expect(state.players[0].position).toBe(targetTile);
  });

  it('核子飞弹使范围内玩家住院并降建筑等级', () => {
    const state = makeTestState();
    const targetTile = smallPropertyAt(state, 1, 0);
    setOwner(state, targetTile, 'p2', 'house', 2);
    setPlayerPosition(state, 'p2', targetTile);
    prepareActingState(state);
    giveItem(state.players[0], 'nuke');
    const result = useItem(state, 'p1', 'nuke', { targetTileIndex: targetTile });
    expect(result.success).toBe(true);
    expect(state.map.tiles[targetTile].level).toBe(1);
    expect(state.players[1].statusEffects.some((e) => e.type === 'hospital')).toBe(true);
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

describe('测试模式免费商店', () => {
  it('免费商店可获取研究所产物（cost=0）', () => {
    const state = makeTestState();
    freeBuyItem(state, 'p1', 'robot', 2);
    const item = state.players[0].items.find((i) => i.itemId === 'robot');
    expect(item?.quantity).toBe(2);
  });

  it('免费商店堆叠数量受 maxStack 限制', () => {
    const state = makeTestState();
    expect(() => freeBuyItem(state, 'p1', 'bike', 2)).toThrow();
  });
});

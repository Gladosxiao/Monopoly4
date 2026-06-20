/**
 * 卡片效果单元测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { GameState } from '@monopoly4/shared';
import { makeTestState, makeThreePlayerState, setOwner, giveCard } from './setup.js';
import { useCard, endTurn, buyProperty, payMoney } from '../engine.js';
import { buyCard } from '../cardSystem/index.js';

function prepareActingState(state: GameState, playerIndex = 0): void {
  state.currentPlayerIndex = playerIndex;
  state.status = 'acting';
  state.pendingTileIndex = state.players[playerIndex].position;
}

describe('控制类卡片', () => {
  it('转向卡改变下次移动方向', () => {
    const state = makeTestState();
    const p1 = state.players[0];
    prepareActingState(state);
    const id = giveCard(p1, 'turnAround');
    const result = useCard(state, 'p1', id);
    expect(result.success).toBe(true);
    expect(p1.pendingDirection).toBe('backward');
  });

  it('转向卡可指定目标玩家', () => {
    const state = makeTestState();
    prepareActingState(state);
    const id = giveCard(state.players[0], 'turnAround');
    const result = useCard(state, 'p1', id, { targetPlayerId: 'p2' });
    expect(result.success).toBe(true);
    expect(state.players[1].pendingDirection).toBe('backward');
    expect(state.players[0].pendingDirection).toBeUndefined();
  });

  it('停留卡给目标附加 stay 状态', () => {
    const state = makeTestState();
    prepareActingState(state);
    const id = giveCard(state.players[0], 'stay');
    const result = useCard(state, 'p1', id, { targetPlayerId: 'p2' });
    expect(result.success).toBe(true);
    expect(state.players[1].statusEffects.some((e) => e.type === 'stay')).toBe(true);
  });

  it('乌龟卡令目标每次只走一步', () => {
    const state = makeTestState();
    prepareActingState(state);
    const id = giveCard(state.players[0], 'turtle');
    const result = useCard(state, 'p1', id, { targetPlayerId: 'p2' });
    expect(result.success).toBe(true);
    expect(state.players[1].statusEffects.some((e) => e.type === 'turtle' && e.remainingDays === 3)).toBe(true);
  });

  it('冬眠卡令所有对手冬眠', () => {
    const state = makeThreePlayerState();
    prepareActingState(state);
    const id = giveCard(state.players[0], 'hibernation');
    const result = useCard(state, 'p1', id);
    expect(result.success).toBe(true);
    expect(state.players[1].statusEffects.some((e) => e.type === 'hibernation')).toBe(true);
    expect(state.players[2].statusEffects.some((e) => e.type === 'hibernation')).toBe(true);
    expect(state.players[0].statusEffects.some((e) => e.type === 'hibernation')).toBe(false);
  });

  it('陷害卡令目标入狱 5 天', () => {
    const state = makeTestState();
    prepareActingState(state);
    const id = giveCard(state.players[0], 'frame');
    const result = useCard(state, 'p1', id, { targetPlayerId: 'p2' });
    expect(result.success).toBe(true);
    expect(state.players[1].statusEffects.some((e) => e.type === 'jail' && e.remainingDays === 5)).toBe(true);
  });

  it('梦游卡令目标梦游 5 天', () => {
    const state = makeTestState();
    prepareActingState(state);
    const id = giveCard(state.players[0], 'sleepwalk');
    const result = useCard(state, 'p1', id, { targetPlayerId: 'p2' });
    expect(result.success).toBe(true);
    expect(state.players[1].statusEffects.some((e) => e.type === 'sleepwalk' && e.remainingDays === 5)).toBe(true);
  });
});

describe('攻击/土地类卡片', () => {
  it('购地卡强制购买当前土地', () => {
    const state = makeTestState();
    state.players[0].position = 1;
    prepareActingState(state, 0);
    const id = giveCard(state.players[0], 'buyLand');
    const result = useCard(state, 'p1', id);
    expect(result.success).toBe(true);
    expect(state.map.tiles[1].ownerId).toBe('p1');
  });

  it('换地卡交换两块同等大小土地', () => {
    const state = makeTestState();
    setOwner(state, 1, 'p1', 'house', 0);
    setOwner(state, 3, 'p2', 'house', 0);
    prepareActingState(state);
    const id = giveCard(state.players[0], 'swapLand');
    const result = useCard(state, 'p1', id, { targetTileIndex: 1, targetPlayerId: 'p2' });
    expect(result.success).toBe(true);
    expect(state.map.tiles[1].ownerId).toBe('p2');
    expect(state.map.tiles[3].ownerId).toBe('p1');
  });

  it('换地卡对不同大小土地失败', () => {
    const state = makeTestState();
    setOwner(state, 1, 'p1', 'house', 0); // small
    setOwner(state, 21, 'p2', 'house', 0); // large
    prepareActingState(state);
    const id = giveCard(state.players[0], 'swapLand');
    const result = useCard(state, 'p1', id, { targetTileIndex: 21, targetPlayerId: 'p2' });
    expect(result.success).toBe(false);
  });

  it('拍卖卡强制购买对手土地并转移所有权', () => {
    const state = makeTestState();
    setOwner(state, 1, 'p2', 'house', 2);
    const before = state.players[0].cash;
    prepareActingState(state);
    const id = giveCard(state.players[0], 'auction');
    const result = useCard(state, 'p1', id, { targetTileIndex: 1 });
    expect(result.success).toBe(true);
    expect(state.map.tiles[1].ownerId).toBe('p1');
    expect(state.players[0].cash).toBeLessThan(before);
  });

  it('天使卡为路段所有建筑加盖一层', () => {
    const state = makeTestState();
    setOwner(state, 1, 'p1', 'house', 1);
    setOwner(state, 3, 'p2', 'house', 2);
    prepareActingState(state);
    const id = giveCard(state.players[0], 'angel');
    const result = useCard(state, 'p1', id, { targetGroup: 0 });
    expect(result.success).toBe(true);
    expect(state.map.tiles[1].level).toBe(2);
    expect(state.map.tiles[3].level).toBe(3);
  });

  it('恶魔卡为路段所有建筑降一级', () => {
    const state = makeTestState();
    setOwner(state, 1, 'p1', 'house', 2);
    setOwner(state, 3, 'p2', 'house', 3);
    prepareActingState(state);
    const id = giveCard(state.players[0], 'devil');
    const result = useCard(state, 'p1', id, { targetGroup: 0 });
    expect(result.success).toBe(true);
    expect(state.map.tiles[1].level).toBe(1);
    expect(state.map.tiles[3].level).toBe(2);
  });

  it('怪兽卡摧毁一栋建筑彻底归零', () => {
    const state = makeTestState();
    setOwner(state, 21, 'p2', 'mall', 3);
    prepareActingState(state);
    const id = giveCard(state.players[0], 'monster');
    const result = useCard(state, 'p1', id, { targetTileIndex: 21 });
    expect(result.success).toBe(true);
    expect(state.map.tiles[21].level).toBe(0);
    expect(state.map.tiles[21].buildingType).toBe('house');
  });

  it('拆除卡降低目标建筑一级', () => {
    const state = makeTestState();
    setOwner(state, 21, 'p2', 'mall', 2);
    prepareActingState(state);
    const id = giveCard(state.players[0], 'demolish');
    const result = useCard(state, 'p1', id, { targetTileIndex: 21 });
    expect(result.success).toBe(true);
    expect(state.map.tiles[21].level).toBe(1);
  });

  it('改建卡改变建筑类型', () => {
    const state = makeTestState();
    setOwner(state, 21, 'p1', 'house', 0);
    prepareActingState(state);
    const id = giveCard(state.players[0], 'rebuild');
    const result = useCard(state, 'p1', id, { targetTileIndex: 21, buildingType: 'hotel' });
    expect(result.success).toBe(true);
    expect(state.map.tiles[21].buildingType).toBe('hotel');
  });
});

describe('防御/特殊类卡片', () => {
  it('免费卡获得一次免租状态', () => {
    const state = makeTestState();
    prepareActingState(state);
    const id = giveCard(state.players[0], 'freePass');
    const result = useCard(state, 'p1', id);
    expect(result.success).toBe(true);
    expect(state.players[0].statusEffects.some((e) => e.type === 'freePass')).toBe(true);
  });

  it('同盟卡建立双向同盟', () => {
    const state = makeTestState();
    prepareActingState(state);
    const id = giveCard(state.players[0], 'alliance');
    const result = useCard(state, 'p1', id, { targetPlayerId: 'p2' });
    expect(result.success).toBe(true);
    expect(state.players[0].statusEffects.some((e) => e.type === 'alliance' && e.sourcePlayerId === 'p2')).toBe(true);
    expect(state.players[1].statusEffects.some((e) => e.type === 'alliance' && e.sourcePlayerId === 'p1')).toBe(true);
  });

  it('送神符可送走穷神', () => {
    const state = makeTestState();
    state.players[0].spirit = { spiritId: 'smallPovertyGod', remainingDays: 7 };
    prepareActingState(state);
    const id = giveCard(state.players[0], 'dismissSpirit');
    const result = useCard(state, 'p1', id);
    expect(result.success).toBe(true);
    expect(state.players[0].spirit).toBeUndefined();
  });

  it('请神符可召唤神明', () => {
    const state = makeTestState();
    prepareActingState(state);
    const id = giveCard(state.players[0], 'summonSpirit');
    const result = useCard(state, 'p1', id, { spiritId: 'bigWealthGod' });
    expect(result.success).toBe(true);
    expect(state.players[0].spirit?.spiritId).toBe('bigWealthGod');
  });

  it('复仇卡附加反击状态', () => {
    const state = makeTestState();
    prepareActingState(state);
    const id = giveCard(state.players[0], 'revenge');
    const result = useCard(state, 'p1', id);
    expect(result.success).toBe(true);
    expect(state.players[0].statusEffects.some((e) => e.type === 'revenge')).toBe(true);
  });

  it('免罪卡附加抵御状态', () => {
    const state = makeTestState();
    prepareActingState(state);
    const id = giveCard(state.players[0], 'innocence');
    const result = useCard(state, 'p1', id);
    expect(result.success).toBe(true);
    expect(state.players[0].statusEffects.some((e) => e.type === 'innocence')).toBe(true);
  });
});

describe('商店与剩余卡片', () => {
  it('商店购买卡片', () => {
    const state = makeTestState();
    state.players[0].position = 26; // 商店
    prepareActingState(state);
    const result = buyCard(state, 'p1', 'stay');
    expect(result.success).toBe(true);
    expect(state.players[0].cards.some((c) => c.cardId === 'stay')).toBe(true);
  });

  it('未持有卡片时使用失败', () => {
    const state = makeTestState();
    prepareActingState(state);
    const result = useCard(state, 'p1', 'not-exist');
    expect(result.success).toBe(false);
  });

  it('查税卡收取目标 20% 现金', () => {
    const state = makeTestState();
    state.players[1].cash = 10000;
    prepareActingState(state);
    const id = giveCard(state.players[0], 'taxAudit');
    const result = useCard(state, 'p1', id, { targetPlayerId: 'p2' });
    expect(result.success).toBe(true);
    expect(state.players[1].cash).toBe(8000);
    expect(state.players[0].cash).toBeGreaterThan(100000);
  });

  it('均富卡平均所有玩家现金', () => {
    const state = makeTestState();
    state.players[0].cash = 10000;
    state.players[1].cash = 30000;
    prepareActingState(state);
    const id = giveCard(state.players[0], 'equalWealth');
    const result = useCard(state, 'p1', id);
    expect(result.success).toBe(true);
    expect(state.players[0].cash).toBe(20000);
    expect(state.players[1].cash).toBe(20000);
  });

  it('红卡/黑卡设置股票涨跌天数', () => {
    const state = makeTestState();
    const stock = state.stocks[0];
    prepareActingState(state);
    const red = giveCard(state.players[0], 'redCard');
    expect(useCard(state, 'p1', red, { targetStockId: stock.id }).success).toBe(true);
    expect(stock.bullDays).toBe(3);

    const black = giveCard(state.players[0], 'blackCard');
    expect(useCard(state, 'p1', black, { targetStockId: stock.id }).success).toBe(true);
    expect(stock.bearDays).toBe(3);
  });

  it('嫁祸卡触发后由目标承担费用', () => {
    const state = makeTestState();
    state.players[0].cash = 5000;
    state.players[1].cash = 10000;
    prepareActingState(state);
    const id = giveCard(state.players[0], 'blame');
    useCard(state, 'p1', id, { targetPlayerId: 'p2' });

    // 触发一次税金支付
    state.status = 'acting';
    state.pendingTileIndex = state.players[0].position;
    payMoney(state, state.players[0], 3000, '测试税金');

    expect(state.players[0].cash).toBe(5000);
    expect(state.players[1].cash).toBe(7000);
  });
});


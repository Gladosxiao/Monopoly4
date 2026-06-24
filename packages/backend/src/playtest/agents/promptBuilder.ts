/**
 * LLM Prompt 构建器
 *
 * 将 04-game-rules.md 的规则摘要、全量卡片/道具说明、当前游戏场面信息
 * 以及玩家可点击的每一个操作封装成结构化 prompt，供 LLM 做出最优决策。
 */

import type { GameState, Player, Tile } from '@monopoly4/shared';
import { CARD_DEFINITIONS, ITEM_DEFINITIONS } from '@monopoly4/shared';
import type { AvailableAction } from '../types.js';

/** 从 04-game-rules.md 提炼的核心规则摘要（紧凑版） */
const RULES_SUMMARY = `
## 大富翁4 核心规则
- 目标：让对手破产或资产最高。破产：现金+存款<0，法拍3次后仍不足则退出。
- 回合：rolling掷骰 → moving移动 → acting操作。
- 骰子：步行1颗，机车1-2颗，汽车1-3颗。
- 买地：价格=basePrice*priceIndex。升级费用=basePrice*(level+1)*0.5*priceIndex，最高5级。
- 过路费：rent=baseRent*(1+level*0.5)*(1+groupBonus)*priceIndex。同组2块+20%，3块+50%。
- 连锁店：全图连锁店联合收费。特殊建筑：公园(不收费)、商场/旅馆/加油站/研究所。
- 卡片上限15张，道具每种上限9个(交通工具1个)。卡片/道具目标类型：self/opponent/tile/road/global。
- 好神(财神/福神/天使/土地公)增益，坏神(穷神/衰神/恶魔/死神)负面。土地公可强制占地，天使/恶魔影响经过土地。
- 股票：总股本10000股，持股>10%成董事长，每月15日分红。
`;

/** 全量卡片说明（紧凑表格） */
function buildCardReference(): string {
  const lines = ['## 全量卡片（id|名称|目标|价格|效果）'];
  for (const card of Object.values(CARD_DEFINITIONS)) {
    lines.push(`${card.id}|${card.name}|${card.target}|${card.cost}|${card.description}`);
  }
  return lines.join('\n');
}

/** 全量道具说明（紧凑表格） */
function buildItemReference(): string {
  const lines = ['## 全量道具（id|名称|类型|价格|效果）'];
  for (const item of Object.values(ITEM_DEFINITIONS)) {
    lines.push(`${item.id}|${item.name}|${item.type}|${item.cost}|${item.description}`);
  }
  return lines.join('\n');
}

/** 格式化地块信息 */
function formatTile(state: GameState, tile: Tile): string {
  const parts = [`#${tile.index}${tile.name}(${tile.type})`];
  if (tile.type === 'property') {
    const price = Math.round(tile.basePrice * state.priceIndex);
    parts.push(`价${price}`);
    if (tile.ownerId) {
      const owner = state.players.find((p) => p.id === tile.ownerId);
      parts.push(`主${owner?.username ?? tile.ownerId}`);
      parts.push(`Lv${tile.level ?? 0}`);
      parts.push(`建${tile.buildingType ?? '住宅'}`);
    }
    if (tile.group !== undefined) parts.push(`组${tile.group}`);
  }
  if (tile.traps && tile.traps.length > 0) {
    parts.push(`陷阱${tile.traps.map((t) => t.type).join(',')}`);
  }
  return parts.join(' ');
}

/** 构建场面当前信息 */
function buildBoardSummary(state: GameState, me: Player): string {
  const lines = [
    `地图:${state.map.name}(${state.map.tiles.length}格) 物价指数:${state.priceIndex.toFixed(2)} 日期:第${state.day}天第${state.month}月 当前玩家:${state.players[state.currentPlayerIndex]?.username}`,
    '',
    '### 玩家状态',
  ];

  for (const p of state.players) {
    const statusEffects = p.statusEffects?.map((s) => s.type).join(',') ?? '无';
    lines.push(
      `${p.username}: 现金${p.cash} 存款${p.deposit} 贷款${p.loan} 点券${p.coupons} 地产${p.properties.length} 卡${p.cards.length} 道具${p.items.length} 神${p.spirit?.spiritId ?? '无'} 效${statusEffects} 破产${p.isBankrupt}`
    );
  }

  lines.push('', '### 关键地产');
  const importantTiles = state.map.tiles
    .filter((t) => t.type === 'property' && (t.ownerId || (t.level ?? 0) > 0))
    .slice(0, 12);
  for (const tile of importantTiles) {
    lines.push(formatTile(state, tile));
  }

  if (state.stocks && state.stocks.length > 0) {
    lines.push('', '### 股票');
    for (const stock of state.stocks) {
      lines.push(`${stock.name}:价${stock.price} 股本${stock.totalShares}`);
    }
  }

  return lines.join('\n');
}

/** 构建玩家自身详细状态 */
function buildPlayerSummary(me: Player, state: GameState): string {
  const tile = state.map.tiles[me.position];
  const lines = [
    `用户名:${me.username} 角色:${me.characterId} 载具:${me.vehicle} 位置:${me.position}(${tile.name}/${tile.type})`,
    `现金${me.cash} 存款${me.deposit} 贷款${me.loan} 点券${me.coupons} 地产${me.properties.length} 神${me.spirit?.spiritId ?? '无'}(${me.spirit?.remainingDays ?? 0}天) 状态${me.statusEffects?.map((s) => s.type).join(',') ?? '无'}`,
  ];

  if (me.properties.length > 0) {
    lines.push('我的地产:' + me.properties.slice(0, 10).map((idx) => {
      const t = state.map.tiles[idx];
      return `#${idx}${t.name}Lv${t.level ?? 0}建${t.buildingType ?? '住宅'}组${t.group ?? '无'}`;
    }).join('; '));
  }

  if (me.cards.length > 0) {
    const cardCounts = new Map<string, number>();
    for (const c of me.cards) cardCounts.set(c.cardId, (cardCounts.get(c.cardId) ?? 0) + 1);
    lines.push('我的卡片:' + Array.from(cardCounts).map(([id, count]) => `${id}x${count}`).join('; '));
  }

  if (me.items.length > 0) {
    lines.push('我的道具:' + me.items.map((i) => `${i.itemId}x${i.quantity}`).join('; '));
  }

  if (me.stockHoldings && Object.keys(me.stockHoldings).length > 0) {
    lines.push('我的持股:' + Object.entries(me.stockHoldings).map(([id, h]) => `${id}:${h}`).join('; '));
  }

  return lines.join('\n');
}

/** 构建可用操作说明，每个操作附带所需 target 参数 */
function buildActionsGuide(actions: AvailableAction[]): string {
  const lines = ['## 本回合可用操作'];
  for (const action of actions) {
    const params = action.params ? ` 参数=${JSON.stringify(action.params)}` : '';
    let targetHint = '';
    switch (action.type) {
      case 'roll':
        targetHint = ' target.diceCount 可选 1/2/3（取决于载具）';
        break;
      case 'useCard':
        targetHint = ' target.cardId 必填，target.cardTarget 根据卡片类型填写（targetPlayerId/targetTileIndex/roadGroup 等）';
        break;
      case 'useItem':
        targetHint = ' target.itemId 必填，target.itemTarget 根据道具类型填写（diceValue/targetTileIndex 等）';
        break;
      case 'buyItem':
        targetHint = ' target.itemId + target.itemQuantity';
        break;
      case 'buyCard':
        targetHint = ' target.cardId';
        break;
      case 'tradeStock':
        targetHint = ' target.stockId + target.stockQuantity（正数买入，负数卖出）';
        break;
      case 'takeLoan':
        targetHint = ' target.amount';
        break;
      case 'repayLoan':
        targetHint = ' target.amount';
        break;
      case 'castMagicSpell':
        targetHint = ' target.targetPlayerId + target.spell';
        break;
      case 'placeLotteryBet':
        targetHint = ' target.number (0-9)';
        break;
      case 'rescueNpc':
        targetHint = ' target.npcId';
        break;
      case 'rebuildTile':
        targetHint = ' target.tileIndex + target.buildingType';
        break;
    }
    lines.push(`- ${action.type}: ${action.label}${params}${targetHint}`);
  }
  return lines.join('\n');
}

/** 策略提示 */
const STRATEGY_HINTS = `
## 策略提示（为赢游戏请充分使用）
1. 优先买同组空地产形成垄断；优先升级高价值/同组地产。
2. 对对手高级地产用涨价卡/查封卡；对领先玩家用均贫/陷害/冬眠/梦游/乌龟卡。
3. 用遥控骰子精准走位；在己方高级地产前放路障/地雷/定时炸弹。
4. 用机器娃娃清陷阱，飞弹/核弹摧毁对手高级建筑。
5. 资金充裕买股票当董事长；资金紧张在起点贷款。
6. 坏神附身用送神符；前方强敌地产且资金紧张用免费卡。
7. 到商店补关键卡片（涨价、查封、免费、送神）和道具（遥控骰子、路障、地雷、飞弹）。
`;

/** 输出格式说明 */
const OUTPUT_FORMAT = `
## 输出格式
只输出一个 JSON 对象，不要其他内容：
{"action":"动作类型","target":{...},"reason":"简短决策理由"}

常见 target：
- roll: {diceCount:1|2|3}
- useCard: {cardId, cardTarget:{targetPlayerId|targetTileIndex|roadGroup}}
- useItem: {itemId, itemTarget:{diceValue|targetTileIndex}}
- tradeStock: {stockId, stockQuantity}
- takeLoan/repayLoan: {amount}
- castMagicSpell: {targetPlayerId, spell}
- placeLotteryBet: {number:0-9}
- rescueNpc: {npcId}
- rebuildTile: {tileIndex, buildingType}

务必使用可用操作列表中的 action，并给 useCard/useItem 提供完整 target。
`;

/**
 * 构建完整 LLM prompt。
 */
export function buildPrompt(
  state: GameState,
  me: Player,
  availableActions: AvailableAction[],
  recentLogs: string[]
): string {
  const playerSummary = buildPlayerSummary(me, state);
  const boardSummary = buildBoardSummary(state, me);
  const actionsGuide = buildActionsGuide(availableActions);
  const cardRef = buildCardReference();
  const itemRef = buildItemReference();
  const logsStr = recentLogs.length > 0 ? recentLogs.join('\n') : '（无）';

  return `你是大富翁4玩家 ${me.username}，请根据以下信息做出最优决策以赢得游戏。

${RULES_SUMMARY}

${cardRef}

${itemRef}

## 你的状态
${playerSummary}

## 当前场面
${boardSummary}

${actionsGuide}

## 最近事件
${logsStr}

${STRATEGY_HINTS}

${OUTPUT_FORMAT}`;
}

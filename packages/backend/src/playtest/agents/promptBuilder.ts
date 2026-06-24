/**
 * LLM Prompt 构建器
 *
 * 将 04-game-rules.md 的规则摘要、全量卡片/道具说明、当前游戏场面信息
 * 以及玩家可点击的每一个操作封装成结构化 prompt，供 LLM 做出最优决策。
 */

import type { GameState, Player, Tile } from '@monopoly4/shared';
import { CARD_DEFINITIONS, ITEM_DEFINITIONS } from '@monopoly4/shared';
import type { AvailableAction } from '../types.js';

/** 从 04-game-rules.md 提炼的核心规则摘要（极简版） */
const RULES_SUMMARY = `
## 规则
目标：让对手破产或资产最高。回合：rolling→moving→acting。骰子：步行1，机车1-2，汽车1-3。
买地=basePrice*priceIndex，升级=basePrice*(level+1)*0.5*priceIndex。过路费=baseRent*(1+level*0.5)*(1+groupBonus)*priceIndex，同组2块+20% 3块+50%。
卡片上限15，道具上限9(交通工具1)。卡片/道具目标：self/opponent/tile/road/global。持股>10%成董事长。
`;

/** 全量卡片说明（极简） */
function buildCardReference(): string {
  const lines = ['## 卡片（id|名称|目标）'];
  for (const card of Object.values(CARD_DEFINITIONS)) {
    lines.push(`${card.id}|${card.name}|${card.target}`);
  }
  return lines.join(' ');
}

/** 全量道具说明（极简） */
function buildItemReference(): string {
  const lines = ['## 道具（id|名称|类型）'];
  for (const item of Object.values(ITEM_DEFINITIONS)) {
    lines.push(`${item.id}|${item.name}|${item.type}`);
  }
  return lines.join(' ');
}

/** 格式化地块信息 */
function formatTile(state: GameState, tile: Tile): string {
  if (tile.type !== 'property') return `#${tile.index}${tile.name}`;
  const price = Math.round(tile.basePrice * state.priceIndex);
  const owner = tile.ownerId ? (state.players.find((p) => p.id === tile.ownerId)?.username ?? tile.ownerId) : '无';
  return `#${tile.index}${tile.name}价${price}主${owner}Lv${tile.level ?? 0}组${tile.group ?? '-'}`;
}

/** 构建场面当前信息 */
function buildBoardSummary(state: GameState, me: Player): string {
  const lines = [
    `地图:${state.map.name}(${state.map.tiles.length}格) 物价:${state.priceIndex.toFixed(2)} 第${state.day}天 当前:${state.players[state.currentPlayerIndex]?.username}`,
  ];

  lines.push('玩家:' + state.players.map((p) => {
    const spirit = p.spirit?.spiritId ?? '-';
    return `${p.username}=现金${p.cash}/存${p.deposit}/贷${p.loan}/券${p.coupons}/地${p.properties.length}/卡${p.cards.length}/道${p.items.length}/神${spirit}/破${p.isBankrupt ? 1 : 0}`;
  }).join('; '));

  const importantTiles = state.map.tiles
    .filter((t) => t.type === 'property' && (t.ownerId || (t.level ?? 0) > 0))
    .slice(0, 10);
  if (importantTiles.length > 0) {
    lines.push('地产:' + importantTiles.map((t) => formatTile(state, t)).join('; '));
  }

  if (state.stocks && state.stocks.length > 0) {
    lines.push('股票:' + state.stocks.map((s) => `${s.name}=${s.price}`).join('; '));
  }

  return lines.join('\n');
}

/** 构建玩家自身详细状态 */
function buildPlayerSummary(me: Player, state: GameState): string {
  const tile = state.map.tiles[me.position];
  const lines = [
    `我:${me.username} 载具:${me.vehicle} 位置:${me.position}(${tile.name}) 现金${me.cash} 存${me.deposit} 贷${me.loan} 券${me.coupons} 神${me.spirit?.spiritId ?? '-'}`,
  ];

  if (me.properties.length > 0) {
    lines.push('我的地产:' + me.properties.slice(0, 8).map((idx) => {
      const t = state.map.tiles[idx];
      return `#${idx}${t.name}Lv${t.level ?? 0}组${t.group ?? '-'}`;
    }).join('; '));
  }

  if (me.cards.length > 0) {
    const cardCounts = new Map<string, number>();
    for (const c of me.cards) cardCounts.set(c.cardId, (cardCounts.get(c.cardId) ?? 0) + 1);
    lines.push('卡片:' + Array.from(cardCounts).map(([id, count]) => `${id}x${count}`).join('; '));
  }

  if (me.items.length > 0) {
    lines.push('道具:' + me.items.map((i) => `${i.itemId}x${i.quantity}`).join('; '));
  }

  if (me.stockHoldings && Object.keys(me.stockHoldings).length > 0) {
    lines.push('持股:' + Object.entries(me.stockHoldings).map(([id, h]) => `${id}:${h}`).join('; '));
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
## 策略提示
优先买同组空地产并升级；对强敌地产用涨价/查封卡，对领先玩家用均贫/陷害/冬眠/梦游/乌龟卡；用遥控骰子走位；在己方高级地产前放路障/地雷/炸弹；用机器娃娃清陷阱，飞弹/核弹拆对手建筑；资金充裕买股票，紧张时贷款；坏神附身用送神符。
`;

/** 输出格式说明 */
const OUTPUT_FORMAT = `
## 输出格式
只输出JSON：{"action":"...","target":{...},"reason":"..."}
常见target: roll{diceCount}, useCard{cardId,cardTarget}, useItem{itemId,itemTarget}, tradeStock{stockId,stockQuantity}, takeLoan/repayLoan{amount}, placeLotteryBet{number}, rescueNpc{npcId}, rebuildTile{tileIndex,buildingType}
务必使用可用操作列表中的action，useCard/useItem必须提供完整target。
`;

/**
 * 构建一次性 system prompt：包含规则、卡片/道具表、策略提示、输出格式。
 * 在多轮对话中只在第一次发送，后续不再重复。
 */
export function buildSystemPrompt(): string {
  return `你是大富翁4玩家，目标是利用策略赢得游戏。

${RULES_SUMMARY}

${buildCardReference()}

${buildItemReference()}

${STRATEGY_HINTS}

${OUTPUT_FORMAT}`;
}

/**
 * 构建每次决策的 user prompt：只包含当前场面、自身状态、可用操作、最近事件。
 */
export function buildUserPrompt(
  state: GameState,
  me: Player,
  availableActions: AvailableAction[],
  recentLogs: string[]
): string {
  const playerSummary = buildPlayerSummary(me, state);
  const boardSummary = buildBoardSummary(state, me);
  const actionsGuide = buildActionsGuide(availableActions);
  const logsStr = recentLogs.length > 0 ? recentLogs.join('\n') : '（无）';

  return `你是玩家 ${me.username}，请根据当前信息做出最优决策。

## 你的状态
${playerSummary}

## 当前场面
${boardSummary}

${actionsGuide}

## 最近事件
${logsStr}

只输出一个 JSON 对象。`;
}

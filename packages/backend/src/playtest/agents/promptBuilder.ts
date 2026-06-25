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

/** 构建周边环境（前方 6 格） */
function buildSurroundings(state: GameState, me: Player): string {
  const tileCount = state.map.tiles.length;
  const tiles: string[] = [];
  for (let d = 1; d <= 6; d++) {
    const idx = (me.position + d) % tileCount;
    const t = state.map.tiles[idx];
    const owner = t.ownerId ? (state.players.find((p) => p.id === t.ownerId)?.username ?? '?') : '';
    if (t.type === 'property') {
      const price = Math.round((t.basePrice ?? 0) * state.priceIndex);
      tiles.push(`+${d}#${idx}${t.name} 价${price} 主${owner || '无'} Lv${t.level ?? 0}`);
    } else if (t.type === 'shop') {
      tiles.push(`+${d}#${idx}商店(可买卡片道具)`);
    } else if (t.type === 'fate') {
      tiles.push(`+${d}#${idx}命运`);
    } else {
      tiles.push(`+${d}#${idx}${t.name}`);
    }
  }
  return `前方6格: ${tiles.join(' | ')}`;
}

/** 构建其他玩家位置与资产 */
function buildOpponents(state: GameState, me: Player): string {
  const others = state.players.filter((p) => p.id !== me.id && !p.isBankrupt);
  if (others.length === 0) return '';
  const lines = others.map((p) => {
    const tile = state.map.tiles[p.position];
    const posDesc = tile ? `#${p.position}${tile.name}` : `#${p.position}`;
    const owner = tile?.ownerId ? (state.players.find((pp) => pp.id === tile.ownerId)?.username ?? '?') : '';
    const spirit = p.spirit?.spiritId ?? '-';
    return `${p.username}(id=${p.id})@${posDesc} 现金${p.cash} 存${p.deposit} 贷${p.loan} 地${p.properties.length} 卡${p.cards.length} 道${p.items.length} 神${spirit}`;
  });
  return `对手: ${lines.join('; ')}`;
}

/** 构建场面当前信息 */
function buildBoardSummary(state: GameState, me: Player): string {
  const lines = [
    `地图:${state.map.name}(${state.map.tiles.length}格) 物价:${state.priceIndex.toFixed(2)} 第${state.day}天`,
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
export function buildActionsGuide(actions: AvailableAction[]): string {
  const lines = ['## 本回合可用操作'];
  for (const action of actions) {
    const params = action.params ? ` 参数=${JSON.stringify(action.params)}` : '';
    let targetHint = '';
    switch (action.type) {
      case 'roll':
        targetHint = ' target.diceCount 可选 1/2/3（取决于载具）';
        break;
      case 'useCard': {
        const ct = action.params?.targetType ?? 'self';
        targetHint = ` target.cardId=${action.params?.cardId} 必填，target.cardTarget 类型=${ct}`;
        if (ct === 'opponent') targetHint += '（填 {targetPlayerId: 玩家 id，如 "playtest-user-2"}，不是 username）';
        else if (ct === 'tile') targetHint += '（填 {targetTileIndex: 整数格编号}）';
        else if (ct === 'road') targetHint += '（填 {roadGroup: 路段分组编号}）';
        else if (ct === 'global') targetHint += '（可省略）';
        break;
      }
      case 'useItem': {
        const nt = action.params?.needsTarget ?? 'none';
        targetHint = ` target.itemId=${action.params?.itemId} 必填`;
        if (nt === 'diceValue') targetHint += '，target.itemTarget={diceValue:1~6}';
        else if (nt === 'targetTileIndex') targetHint += '，target.itemTarget={targetTileIndex:整数}';
        break;
      }
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

### 资产增长
- 优先买同组空地产并升级（每升1级租金+50%，同组2块+20% 3块+50%）
- 现金管理：永远保留至少 20% 现金应对过路费，不要把全部现金买股票或升级
- 股票交易：tradeStock 的 stockQuantity 是**股数**，买入成本 = 股价 × 股数。只有现金 ≥ 股价×100 时才能买入 100 股。
- 股票策略：股价≤120时买入100股，股价≥180时卖出持股。持股>10%自动成董事长获分红。
- 利用物价指数：物价<1.2买入地产/股票，物价>1.8靠收租获利

### 卡片/道具（必须使用！）
- **本局你已被发放全部卡片和全部道具，必须积极使用，不要只 roll。**
- **只要手中有卡片/道具，且存在 useCard / useItem 可用动作，每回合必须优先考虑使用，而不是 skipTurn。**
- **若持有卡片必须考虑useCard**：免租卡防高额过路费，涨价卡攻对手地产，均贫卡拉平差距
- 坏神明附身立即用送神符驱除；前方有陷阱用机器娃娃清除
- 在自己Lv2+地产前1-3格放路障/地雷/炸弹，增加对手踩中概率
- 用飞弹/核弹拆对手Lv3+建筑；遥控骰子精确走位到目标格
- 有遥控骰子时，优先用它精确走到空地产/自己地产/商店/小游戏格
- **不要跳过回合**：只要存在 useCard / useItem / buyCard / buyItem / tradeStock / upgradeProperty / buyProperty 等可用动作，优先选择其中一个，而不是 skipTurn。

### 干扰对手
- 对资金最多者使用均贫卡/陷害卡/冬眠卡/梦游卡/乌龟卡
- 对强敌Lv3+地产用涨价卡或查封卡；用摧毁卡/怪兽卡拆对手高级建筑
- 用抢夺卡获取对手现金；换地卡/换房卡夺对手地产；转转卡改变对手方向
- 落后时（资产排名≥3）必须积极使用干扰卡和道具，不能 passive

### 点券与商店
- **若有点券(≥300)且站在商店，必须buyItem购买道具**（优先遥控骰子/飞弹/路障/地雷）
- 点券充足(≥500)时buyCard购买攻击卡（涨价卡/摧毁卡/均贫卡）
- 若现金充裕(≥3000)也可用现金buyItem/buyCard
- 商店购买的道具/卡片会立即进入背包，下一回合即可使用
`;

/** 输出格式说明 */
const OUTPUT_FORMAT = `
## 输出格式
只输出一个 JSON 对象，不要解释、不要 markdown 代码块：
{"action":"...","target":{...},"reason":"..."}

合法 action 必须从"本回合可用操作"列表中选取，target 字段必须与该列表中对应项的参数一致。

示例（假设可用）：
- 普通掷骰：{"action":"roll","target":{},"reason":"步行前进"}
- 指定骰子数：{"action":"roll","target":{"diceCount":2},"reason":"骑车前进"}
- 买地：{"action":"buyProperty","target":{},"reason":"占领空地"}
- 升级：{"action":"upgradeProperty","target":{},"reason":"提升租金"}
- 使用遥控骰子：{"action":"useItem","target":{"itemId":"remoteDice","itemTarget":{"diceValue":4}},"reason":"精确到商店"}
- 放置地雷：{"action":"useItem","target":{"itemId":"mine","itemTarget":{"targetTileIndex":12}},"reason":"封锁对手"}
- 使用涨价卡：{"action":"useCard","target":{"cardId":"priceRise","cardTarget":{"targetTileIndex":12}},"reason":"打击对手高租金地产"}
- 商店买遥控骰子：{"action":"buyItem","target":{"itemId":"remoteDice","itemQuantity":1},"reason":"补充道具"}
- 买股票：{"action":"tradeStock","target":{"stockId":"S1","stockQuantity":100},"reason":"低价建仓"}

规则：
1. action 必须是可用操作列表里的 type。
2. useCard 必须提供 target.cardId，且 cardId 要与列表中的某一项完全一致。
3. useItem 必须提供 target.itemId，且 itemId 要与列表中的某一项完全一致。
4. buyCard/buyItem/tradeStock 同样必须从列表中精确选择 id/数量。
5. 如果前方没有明确目标，优先 roll；如果持有卡片/道具且列表中有 useCard/useItem，优先使用它们。
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
  const surroundings = buildSurroundings(state, me);
  const opponents = buildOpponents(state, me);
  const logsStr = recentLogs.length > 0 ? recentLogs.join('\n') : '（无）';

  return `你是玩家 ${me.username}，请根据当前信息做出最优决策。

## 你的状态
${playerSummary}

## 周遭环境
${surroundings}

## 对手情报
${opponents}

## 当前场面
${boardSummary}

${actionsGuide}

## 最近事件
${logsStr}

只输出一个 JSON 对象。`;
}

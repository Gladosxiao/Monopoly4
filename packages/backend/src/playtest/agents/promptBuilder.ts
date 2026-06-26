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
        const cardId = action.params?.cardId as string;
        const ct = action.params?.targetType ?? 'self';
        targetHint = ` target.cardId=${cardId} 必填，target.cardTarget 类型=${ct}`;
        // 部分卡片实现与声明 target 不一致，需要特殊说明
        if (cardId === 'swapLand') {
          targetHint += '（特殊：换地卡需要填 {targetPlayerId: 玩家 id}，与对方随机交换一块同等大小土地）';
        } else if (ct === 'opponent') {
          targetHint += '（填 {targetPlayerId: 玩家 id，如 "playtest-user-2"}，不是 username）';
        } else if (ct === 'tile') {
          targetHint += '（填 {targetTileIndex: 整数格编号}）';
        } else if (ct === 'road') {
          targetHint += '（填 {targetGroup: 路段分组编号}）';
        } else if (ct === 'global') {
          targetHint += '（可省略）';
        }
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
        targetHint = ' target.stockId + target.stockQuantity（正数买入，负数卖出；每次至少100股）';
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

### 终极胜利目标
你的核心目标是**让自己的净资产尽可能高于其他所有玩家**，制造并拉大总资产差距，最终让对手破产。不要追求平均、不要搞平衡，要垄断、要压制、要击垮对手。

### 决策优先级（从高到低，不可违反）
1. **如果 availableActions 中有 roll：必须选择 roll**（或使用遥控骰子），不能用股票/卡片/道具代替掷骰子。
2. **地产专注型**：看到 buyProperty 就买（保留10%现金即可）。
3. **风险偏好型**：优先买地和升级，现金保留10%，敢于借贷攻击。
4. **股市专注型**：有2-3块地后，把余钱投入股市；空地产极便宜时才买。
5. **风险规避型**：只买 affordable 的地，保留30%现金，不借贷。
6. **升级**：地产专注型/风险偏好型积极升级；其他性格保守升级。
3. **如果 availableActions 中有 roll：必须选择 roll**（或使用遥控骰子走到空地产/自己地产/商店），不能为了炒股/用卡而不掷骰子。
4. 在上述两条不满足时，才考虑 useCard / useItem / buyCard / buyItem / tradeStock。

### 核心目标：买地并拉开差距
- 大富翁4的胜负取决于地产。没有地产就没有租金，游戏会陷入僵局。
- **目标是 50 回合内让地图上 80% 以上的空地被购买**，并且你持有的地产价值显著高于对手。
- 优先购买同组空地产以形成垄断（同组 2 块租金+20%，3 块+50%），并尽快升级（每级+50%租金）。垄断同组后对手经过时必须支付高额租金，这是扩大差距的核心手段。
- 买地时保留至少总资产 10% 的现金即可，不要把现金囤积在手里不买地。

### 资产配置纪律
- 你的性格决定了你的核心策略。地产专注型重仓地产，股市专注型重仓股票，风险规避型重仓现金，风险偏好型均衡激进。
- 不要违背性格去做平均化配置：地产专注型不要大量炒股，股市专注型不要疯狂买地。
- 买地是为了收租收益，炒股是为了资本利得，两者都是扩大差距的手段，但你要按性格选择主战场。

### 股票策略
- tradeStock 的 stockQuantity 是**股数**（正数买入，负数卖出），买入成本 = 股价 × 股数。
- 股价≤24时买入100股；股价≥28或比买入成本高20%时卖出止盈；现金<总资产10%时必须卖出救急。
- 禁止同一只股票反复买入卖出，买入后至少持有 5 回合。
- 持股>10%自动成董事长获分红。

### 卡片/道具（积极使用，但买地第一）
- **怪兽卡/拆除卡只能对有建筑（等级≥1）的地产使用**，不要对空地使用。
- 坏神明附身立即用送神符驱除；前方有陷阱用机器娃娃清除。
- 陷阱：在自己 Lv2+ 地产前方 1-3 格或对手必经之路放置地雷/路障/定时炸弹。
- 攻击卡：对对手高级地产使用涨价卡/查封卡/恶魔卡/怪兽卡/拆除卡；**对资金最多/资产领先的玩家优先使用均贫卡/陷害卡/冬眠卡/梦游卡/乌龟卡/转向卡/停留卡**。
- 用抢夺卡获取对手现金；换地卡/换房卡夺对手地产。
- **不要平均打击所有对手**：集中火力打击当前资产最高的玩家，防止其反超；对落后玩家可适当保留实力。

### 遥控骰子
- 只有以下情况使用：前方 1-6 格内有空地产且资金够；前方有自己的地产可升级；前方有商店/小游戏且点券/现金充足。
- 没有明确目标时直接 roll 普通骰子。

### 点券与商店
- 站在商店且点券充足时，补充攻击卡/陷阱，但不要因此放弃买地。
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
- 使用遥控骰子：{"action":"useItem","target":{"itemId":"remoteDice","itemTarget":{"diceValue":4}},"reason":"精确到前方空地产"}
- 放置地雷（高优先级）：{"action":"useItem","target":{"itemId":"mine","itemTarget":{"targetTileIndex":12}},"reason":"在对手必经之路放地雷"}
- 放置路障（高优先级）：{"action":"useItem","target":{"itemId":"barrier","itemTarget":{"targetTileIndex":12}},"reason":"封锁对手"}
- 使用涨价卡（高优先级）：{"action":"useCard","target":{"cardId":"priceRise","cardTarget":{"targetGroup":0}},"reason":"打击对手高租金路段"}
- 使用恶魔卡（高优先级）：{"action":"useCard","target":{"cardId":"devil","cardTarget":{"targetGroup":1}},"reason":"夷平对手路段"}
- 使用陷害卡（高优先级）：{"action":"useCard","target":{"cardId":"frame","cardTarget":{"targetPlayerId":"playtest-user-2"}},"reason":"让领先玩家入狱"}
- 使用换地卡：{"action":"useCard","target":{"cardId":"swapLand","cardTarget":{"targetPlayerId":"playtest-user-2"}},"reason":"与对手交换土地"}
- 商店买地雷（高优先级）：{"action":"buyItem","target":{"itemId":"mine","itemQuantity":1},"reason":"补充陷阱"}
- 商店买攻击卡（高优先级）：{"action":"buyCard","target":{"cardId":"priceRise"},"reason":"购买攻击卡"}
- 买股票：{"action":"tradeStock","target":{"stockId":"S1","stockQuantity":100},"reason":"低价建仓"}
- 卖股票：{"action":"tradeStock","target":{"stockId":"S1","stockQuantity":-100},"reason":"高价止盈"}

规则：
1. action 必须是可用操作列表里的 type。
2. **如果列表中有 roll，必须选择 roll**（或使用遥控骰子），不能用 tradeStock/useCard/useItem 代替掷骰子。
3. 买地/升级/股票/用卡的选择必须服从你的性格资产配置目标。
4. useCard 必须提供 target.cardId，且 cardId 要与列表中的某一项完全一致。
5. useItem 必须提供 target.itemId，且 itemId 要与列表中的某一项完全一致。
6. buyCard/buyItem/tradeStock 同样必须从列表中精确选择 id/数量。
`;

export type PlayerPersonality = 'risk-loving' | 'risk-averse' | 'property-focus' | 'stock-focus';

const PERSONALITY_HINTS: Record<PlayerPersonality, string> = {
  'risk-loving': '你是风险偏好型玩家。策略：积极买地升级，目标是6-8块地产；现金保留10%即可；看到低价股也敢于买入；频繁使用攻击卡/陷阱打压领先对手。',
  'risk-averse': '你是风险规避型玩家。策略：买4-5块价格适中的空地产作为稳定收租来源；保留至少30%现金；不借贷、不激进炒股；用防御卡/道具保护自己。',
  'property-focus': '你是地产专注型玩家，买地是你最主要的收入来源。策略：看到空地产就买，目标是8块以上地产并尽快形成同组垄断；股票最多占10%；用卡片保护/扩张自己的地产。',
  'stock-focus': '你是股市专注型玩家。策略：先买2-3块便宜/同组空地产作为现金流基础，然后主要资金用于低买高卖股票、争夺董事长；不要完全不买地，但也不要把大量资金砸在地产上。',
};

/**
 * 构建一次性 system prompt：包含规则、卡片/道具表、策略提示、输出格式。
 * 在多轮对话中只在第一次发送，后续不再重复。
 */
export function buildSystemPrompt(personality: PlayerPersonality = 'risk-loving'): string {
  return `你是大富翁4玩家，目标是利用策略赢得游戏。${PERSONALITY_HINTS[personality]}

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

## 行动优先级提醒
- 如果可用操作中有 roll：必须选择 roll 或使用遥控骰子，不能用股票/卡片/道具代替掷骰子。
- 买地/升级/股票/用卡的选择必须服从你的性格资产配置目标：地产专注型优先买地，股市专注型优先股票，风险规避型保留现金。
- 在掷骰之后，再考虑攻击卡/陷阱/股票/商店。

${actionsGuide}

## 最近事件
${logsStr}

只输出一个 JSON 对象。`;
}

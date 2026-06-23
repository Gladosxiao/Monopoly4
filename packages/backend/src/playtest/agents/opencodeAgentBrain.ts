/**
 * LLM 驱动的玩家大脑
 *
 * 通过 OpenAI-compatible API 调用 LLM 进行决策。
 * 支持配置：
 * - PLAYTEST_LLM_API_KEY
 * - PLAYTEST_LLM_BASE_URL
 * - PLAYTEST_LLM_MODEL（默认 xiaomi/mimo-v2.5）
 */

import type { GameState, Player } from '@monopoly4/shared';
import type { PlayerBrain, ActionDecision, AvailableAction, ActionType } from '../types.js';

const MAX_RETRIES = 3;
const LLM_TIMEOUT = 30000;

/** LLM 调用配置 */
interface LLMConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

/** 从环境变量读取 LLM 配置 */
function getLLMConfig(): LLMConfig {
  return {
    apiKey: process.env.PLAYTEST_LLM_API_KEY ?? '',
    baseUrl: process.env.PLAYTEST_LLM_BASE_URL ?? 'https://api.openai.com/v1',
    model: process.env.PLAYTEST_LLM_MODEL ?? 'xiaomi/mimo-v2.5',
  };
}

/**
 * 调用 OpenAI-compatible LLM API。
 * 返回 LLM 的文本输出。
 */
async function callLLM(prompt: string, config: LLMConfig): Promise<string> {
  const url = `${config.baseUrl.replace(/\/$/, '')}/chat/completions`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        {
          role: 'system',
          content: '你是一名大富翁4自动化测试玩家。你需要根据当前游戏状态做出最优决策。只输出 JSON，不要输出其他内容。',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 500,
    }),
    signal: AbortSignal.timeout(LLM_TIMEOUT),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`LLM API 错误 ${response.status}: ${body}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('LLM 返回空内容');
  }

  return content;
}

/** 校验 LLM 输出的 JSON schema */
function validateDecision(raw: unknown): ActionDecision | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  if (typeof obj.action !== 'string') return null;

  const validActions: ActionType[] = [
    'roll', 'buyProperty', 'upgradeProperty', 'rebuildTile',
    'useCard', 'buyCard', 'useItem', 'buyItem',
    'tradeStock', 'takeLoan', 'repayLoan',
    'placeLotteryBet', 'castMagicSpell', 'skipTurn', 'rescueNpc',
  ];

  if (!validActions.includes(obj.action as ActionType)) return null;

  const decision: ActionDecision = {
    action: obj.action as ActionType,
    reason: typeof obj.reason === 'string' ? obj.reason : undefined,
  };

  if (obj.target && typeof obj.target === 'object') {
    decision.target = obj.target as ActionDecision['target'];
  }

  return decision;
}

/** 构造 LLM prompt */
function buildPrompt(state: GameState, me: Player, availableActions: AvailableAction[], recentLogs: string[]): string {
  const tile = state.map.tiles[me.position];

  const playerSummary = [
    `用户名: ${me.username}`,
    `资金: ${me.cash}`,
    `存款: ${me.deposit}`,
    `贷款: ${me.loan}`,
    `点券: ${me.coupons}`,
    `载具: ${me.vehicle}`,
    `位置: ${me.position} (${tile.name}, 类型: ${tile.type})`,
    `地产数: ${me.properties.length}`,
    `卡片数: ${me.cards.length}`,
    `道具: ${me.items.map((i) => `${i.itemId}x${i.quantity}`).join(', ') || '无'}`,
    `神明: ${me.spirit?.spiritId ?? '无'}`,
  ].join('\n');

  const actionsList = availableActions.map((a) => {
    const params = a.params ? ` (${JSON.stringify(a.params)})` : '';
    return `- ${a.type}: ${a.label}${params}`;
  }).join('\n');

  const logsStr = recentLogs.length > 0 ? recentLogs.join('\n') : '（无）';

  return `你是大富翁4玩家 ${me.username}，当前是第 ${state.day} 天，第 ${state.month} 月。

## 你的状态
${playerSummary}

## 游戏状态
- 当前回合玩家: ${state.players[state.currentPlayerIndex]?.username}
- 阶段: ${state.status}
- 物价指数: ${state.priceIndex}
- 地图: ${state.map.name} (${state.map.tiles.length} 格)

## 其他玩家
${state.players
  .filter((p) => p.id !== me.id)
  .map((p) => `- ${p.username}: 资金=${p.cash}, 地产=${p.properties.length}, 破产=${p.isBankrupt}`)
  .join('\n')}

## 本回合可用操作
${actionsList}

## 最近事件
${logsStr}

请输出 JSON:
{
  "action": "动作类型",
  "target": { /* 动作参数，如果需要的话 */ },
  "reason": "简短决策理由"
}`;
}

/** 从 LLM 文本输出中提取 JSON */
function extractJSON(text: string): unknown {
  // 尝试直接解析
  try {
    return JSON.parse(text);
  } catch {
    // 忽略
  }

  // 尝试从 markdown code block 中提取
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch {
      // 忽略
    }
  }

  // 尝试从 { 开始到 } 结束提取
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch {
      // 忽略
    }
  }

  return null;
}

export class OpencodeAgentBrain implements PlayerBrain {
  readonly name: string;
  private config: LLMConfig;
  private fallback: PlayerBrain;

  constructor(name: string, fallback: PlayerBrain, config?: Partial<LLMConfig>) {
    this.name = name;
    this.config = { ...getLLMConfig(), ...config };
    this.fallback = fallback;
  }

  async decide(state: GameState, me: Player, availableActions: AvailableAction[]): Promise<ActionDecision> {
    // 如果没有配置 API key，使用 fallback
    if (!this.config.apiKey) {
      return this.fallback.decide(state, me, availableActions);
    }

    const recentLogs = state.logs.slice(-10).map((l) => l.message);

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const prompt = buildPrompt(state, me, availableActions, recentLogs);
        const rawOutput = await callLLM(prompt, this.config);
        const parsed = extractJSON(rawOutput);
        const decision = validateDecision(parsed);

        if (decision) {
          return decision;
        }

        console.warn(`[OpencodeAgentBrain] LLM 输出校验失败 (attempt ${attempt + 1}): ${rawOutput.slice(0, 200)}`);
      } catch (err: any) {
        console.warn(`[OpencodeAgentBrain] LLM 调用失败 (attempt ${attempt + 1}): ${err.message}`);
      }
    }

    // 所有重试都失败，使用 fallback
    console.warn(`[OpencodeAgentBrain] LLM 重试 ${MAX_RETRIES} 次后回退到启发式大脑`);
    return this.fallback.decide(state, me, availableActions);
  }
}

/** 创建 LLM 大脑工厂 */
export function createOpencodeAgentBrainFactory(
  fallbackFactory: (name: string) => PlayerBrain,
  config?: Partial<LLMConfig>
): (name: string) => OpencodeAgentBrain {
  return (name: string) => new OpencodeAgentBrain(name, fallbackFactory(name), config);
}

/**
 * LLM 驱动的玩家大脑
 *
 * 通过 OpenAI-compatible API 调用 LLM 进行决策。
 * 支持配置：
 * - PLAYTEST_LLM_API_KEY
 * - PLAYTEST_LLM_BASE_URL
 * - PLAYTEST_LLM_MODEL（默认 mimo-v2.5）
 */

import type { GameState, Player } from '@monopoly4/shared';
import type { PlayerBrain, ActionDecision, AvailableAction, ActionType } from '../types.js';
import { buildPrompt } from './promptBuilder.js';

const MAX_RETRIES = 3;
const LLM_TIMEOUT = 120000;

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
    model: process.env.PLAYTEST_LLM_MODEL ?? 'mimo-v2.5',
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
            content: '你是一名大富翁4自动化测试玩家。你的目标是利用策略赢得游戏：优先购买和升级地产、合理使用卡片和道具干扰对手、必要时进行股票投资和贷款。\n\n必须严格遵循以下输出格式，只输出一个 JSON 对象，不要输出任何推理过程、解释或 markdown：\n{"action": "动作类型", "target": { /* 动作参数 */ }, "reason": "简短决策理由"}\n\n示例：\n{"action": "roll", "target": {"diceCount": 1}, "reason": "步行掷1颗骰子移动"}\n{"action": "buyProperty", "target": {}, "reason": "购买空地产"}\n{"action": "useCard", "target": {"cardId": "priceRise", "cardTarget": {"targetTileIndex": 5}}, "reason": "对对手高级地产涨价"}',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.5,
        max_completion_tokens: 4096,
    }),
    signal: AbortSignal.timeout(LLM_TIMEOUT),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`LLM API 错误 ${response.status}: ${body}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { total_tokens?: number; completion_tokens?: number; prompt_tokens?: number };
  };

  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('LLM 返回空内容');
  }

  // 打印 token 消耗用于诊断
  if (data.usage) {
    console.log(
      `[OpencodeAgentBrain] token 消耗: prompt=${data.usage.prompt_tokens ?? '?'}, completion=${data.usage.completion_tokens ?? '?'}, total=${data.usage.total_tokens ?? '?'}`
    );
  }

  return content;
}

/** 校验 LLM 输出的 JSON schema */
function validateDecision(raw: unknown): ActionDecision | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  // 兼容 LLM 可能输出的 decision/action 字段
  let actionValue = obj.action;
  if (typeof actionValue !== 'string' && typeof obj.decision === 'string') {
    actionValue = obj.decision;
  }
  if (typeof actionValue !== 'string') return null;

  const validActions: ActionType[] = [
    'roll', 'buyProperty', 'upgradeProperty', 'rebuildTile',
    'useCard', 'buyCard', 'useItem', 'buyItem',
    'tradeStock', 'takeLoan', 'repayLoan',
    'placeLotteryBet', 'castMagicSpell', 'skipTurn', 'rescueNpc',
  ];

  if (!validActions.includes(actionValue as ActionType)) return null;

  const decision: ActionDecision = {
    action: actionValue as ActionType,
    reason: typeof obj.reason === 'string' ? obj.reason : undefined,
  };

  if (obj.target && typeof obj.target === 'object') {
    decision.target = obj.target as ActionDecision['target'];
  }

  return decision;
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
          console.log(`[OpencodeAgentBrain] LLM 调用成功: ${decision.action} - ${decision.reason ?? ''}`);
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

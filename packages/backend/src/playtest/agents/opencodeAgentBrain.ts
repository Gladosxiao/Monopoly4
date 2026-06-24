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
import { buildSystemPrompt, buildUserPrompt } from './promptBuilder.js';

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
type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

async function callLLM(messages: ChatMessage[], config: LLMConfig): Promise<string> {
  const url = `${config.baseUrl.replace(/\/$/, '')}/chat/completions`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
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

export interface OpencodeAgentBrainState {
  messages: ChatMessage[];
}

export class OpencodeAgentBrain implements PlayerBrain {
  readonly name: string;
  private config: LLMConfig;
  private fallback: PlayerBrain;
  /** 多轮对话上下文：system prompt 只发一次，后续追加 user/assistant 消息 */
  private messages: ChatMessage[] = [];

  constructor(name: string, fallback: PlayerBrain, config?: Partial<LLMConfig>) {
    this.name = name;
    this.config = { ...getLLMConfig(), ...config };
    this.fallback = fallback;
  }

  /** 导出对话状态，用于断点续跑 */
  exportState(): OpencodeAgentBrainState {
    return { messages: this.messages.slice() };
  }

  /** 导入对话状态，用于断点续跑 */
  importState(state: OpencodeAgentBrainState): void {
    this.messages = state.messages.slice();
  }

  /** 保持对话上下文长度可控，避免无限增长 */
  private trimHistory(maxPairs = 8): void {
    if (this.messages.length <= 1 + maxPairs * 2) return;
    const system = this.messages[0];
    const tail = this.messages.slice(-(maxPairs * 2));
    this.messages = [system, ...tail];
  }

  async decide(state: GameState, me: Player, availableActions: AvailableAction[]): Promise<ActionDecision> {
    // 如果没有配置 API key，使用 fallback
    if (!this.config.apiKey) {
      return this.fallback.decide(state, me, availableActions);
    }

    // 仅在关键策略决策时调用 LLM，简单操作使用启发式以提升速度
    const criticalActions = new Set<ActionType>([
      'buyProperty',
      'upgradeProperty',
      'rebuildTile',
      'useCard',
      'buyCard',
      'useItem',
      'buyItem',
      'tradeStock',
      'castMagicSpell',
    ]);
    const hasCriticalAction = availableActions.some((a) => criticalActions.has(a.type));
    if (!hasCriticalAction) {
      return this.fallback.decide(state, me, availableActions);
    }

    const recentLogs = state.logs.slice(-10).map((l) => l.message);

    // 初始化 system prompt（仅一次）
    if (this.messages.length === 0) {
      this.messages.push({ role: 'system', content: buildSystemPrompt() });
    }

    // 追加当前决策请求
    this.messages.push({ role: 'user', content: buildUserPrompt(state, me, availableActions, recentLogs) });

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const rawOutput = await callLLM(this.messages, this.config);
        const parsed = extractJSON(rawOutput);
        const decision = validateDecision(parsed);

        if (decision) {
          this.messages.push({ role: 'assistant', content: rawOutput });
          this.trimHistory();
          console.log(`[OpencodeAgentBrain] LLM 调用成功: ${decision.action} - ${decision.reason ?? ''}`);
          return decision;
        }

        console.warn(`[OpencodeAgentBrain] LLM 输出校验失败 (attempt ${attempt + 1}): ${rawOutput.slice(0, 200)}`);
      } catch (err: any) {
        console.warn(`[OpencodeAgentBrain] LLM 调用失败 (attempt ${attempt + 1}): ${err.message}`);
      }
    }

    // 所有重试都失败：移除失败的 user prompt，使用 fallback，避免污染对话
    this.messages.pop();
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

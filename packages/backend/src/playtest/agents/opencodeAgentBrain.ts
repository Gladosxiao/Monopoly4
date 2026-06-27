/**
 * LLM 驱动的玩家大脑
 *
 * 通过 OpenAI-compatible API 调用 LLM 进行决策。
 * 支持配置（优先级从高到低）：
 * 1. 构造函数传入的 config 参数
 * 2. packages/backend/.playtest.env 文件
 * 3. 环境变量 PLAYTEST_LLM_API_KEY / PLAYTEST_LLM_BASE_URL / PLAYTEST_LLM_MODEL
 * 默认使用 Kimi K2.5 模型（OpenAI-compatible API）。
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GameState, Player } from '@monopoly4/shared';
import type { PlayerBrain, ActionDecision, AvailableAction, ActionType, TurnPlan } from '../types.js';
import { buildSystemPrompt, buildUserPrompt, buildActionsGuide, type PlayerPersonality } from './promptBuilder.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLAYTEST_ENV_PATH = resolve(__dirname, '../../../.playtest.env');

const MAX_RETRIES = 1;
const LLM_TIMEOUT = 180000;

/** LLM 调用配置 */
interface LLMConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

/** 解析简单的 KEY=VALUE 环境变量文件（忽略空行与注释） */
function parseEnvFile(path: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!existsSync(path)) return result;
  const text = readFileSync(path, 'utf-8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (key) result[key] = value;
  }
  return result;
}

/** 读取 LLM 配置：.playtest.env > 环境变量 > KIMI 默认值 */
function getLLMConfig(): LLMConfig {
  const fileEnv = parseEnvFile(PLAYTEST_ENV_PATH);
  return {
    apiKey: fileEnv.PLAYTEST_LLM_API_KEY ?? process.env.PLAYTEST_LLM_API_KEY ?? '',
    baseUrl:
      fileEnv.PLAYTEST_LLM_BASE_URL ?? process.env.PLAYTEST_LLM_BASE_URL ?? 'https://api.moonshot.cn/v1',
    model: fileEnv.PLAYTEST_LLM_MODEL ?? process.env.PLAYTEST_LLM_MODEL ?? 'kimi-k2-5',
  };
}

/**
 * 调用 LLM API。
 * 同时支持 OpenAI-compatible 和 Anthropic-compatible（Kimi Code）协议。
 */
type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

/** 根据 baseUrl 判断使用哪种协议 */
function detectApiProtocol(baseUrl: string): 'openai' | 'anthropic' {
  const lower = baseUrl.toLowerCase();
  if (lower.includes('kimi.com') || lower.includes('anthropic')) return 'anthropic';
  return 'openai';
}

async function callLLM(messages: ChatMessage[], config: LLMConfig): Promise<string> {
  const protocol = detectApiProtocol(config.baseUrl);

  if (protocol === 'anthropic') {
    return callAnthropicLLM(messages, config);
  }
  return callOpenaiLLM(messages, config);
}

/** OpenAI-compatible 调用 */
async function callOpenaiLLM(messages: ChatMessage[], config: LLMConfig): Promise<string> {
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

  if (data.usage) {
    console.log(
      `[OpencodeAgentBrain] token 消耗: prompt=${data.usage.prompt_tokens ?? '?'}, completion=${data.usage.completion_tokens ?? '?'}, total=${data.usage.total_tokens ?? '?'}`
    );
  }

  return content;
}

/** Anthropic-compatible 调用（Kimi Code 等） */
async function callAnthropicLLM(messages: ChatMessage[], config: LLMConfig): Promise<string> {
  const url = `${config.baseUrl.replace(/\/$/, '')}/v1/messages`;

  // Anthropic 协议：system 是顶层字段，messages 只含 user/assistant
  const systemMessage = messages.find((m) => m.role === 'system');
  const chatMessages = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role, content: m.content }));

  const requestBody: Record<string, unknown> = {
    model: config.model,
    max_tokens: 4096,
    messages: chatMessages,
  };
  if (systemMessage) {
    requestBody.system = systemMessage.content;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(LLM_TIMEOUT),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`LLM API 错误 ${response.status}: ${body}`);
  }

  const data = (await response.json()) as {
    content?: Array<{ type?: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };

  const textBlock = data.content?.find((c) => c.type === 'text' || typeof c.text === 'string');
  const content = textBlock?.text;
  if (!content) {
    throw new Error('LLM 返回空内容');
  }

  if (data.usage) {
    console.log(
      `[OpencodeAgentBrain] token 消耗: input=${data.usage.input_tokens ?? '?'}, output=${data.usage.output_tokens ?? '?'}`
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

/**
 * 校验 decision 是否匹配当前可用动作列表中的某一项。
 * 防止 LLM  hallucinate 出不可用的 action 或错误的 target。
 */
function matchesAvailableAction(
  decision: ActionDecision,
  availableActions: AvailableAction[]
): boolean {
  const candidates = availableActions.filter((a) => a.type === decision.action);
  if (candidates.length === 0) return false;

  const target = decision.target ?? {};

  switch (decision.action) {
    case 'roll':
      // 只要存在 roll 动作即可；如指定了 diceCount，必须存在于可用选项中
      if (target.diceCount !== undefined) {
        return candidates.some(
          (a) =>
            a.params?.diceCount === target.diceCount ||
            (a.params?.diceRange as number[] | undefined)?.includes(target.diceCount as number)
        );
      }
      return true;

    case 'buyProperty':
    case 'upgradeProperty':
    case 'skipTurn':
    case 'placeLotteryBet':
    case 'castMagicSpell':
      return true;

    case 'useCard':
    case 'buyCard':
      return candidates.some((a) => a.params?.cardId === target.cardId);

    case 'useItem':
    case 'buyItem':
      return candidates.some((a) => a.params?.itemId === target.itemId);

    case 'tradeStock':
      return candidates.some(
        (a) =>
          a.params?.stockId === target.stockId &&
          (target.stockQuantity === undefined || a.params?.stockQuantity === target.stockQuantity)
      );

    case 'takeLoan':
    case 'repayLoan':
      return candidates.some(
        (a) => target.amount === undefined || a.params?.amount === target.amount
      );

    case 'rebuildTile':
      return candidates.some(
        (a) =>
          a.params?.tileIndex === target.tileIndex &&
          (target.buildingType === undefined || a.params?.buildingType === target.buildingType)
      );

    case 'rescueNpc':
      return candidates.some((a) => a.params?.npcId === target.npcId);

    default:
      return false;
  }
}

/**
 * 构建一次性整回合计划 prompt。
 * 与 decide 不同，这里要求 LLM 输出一个动作数组，而不是单个动作。
 */
function buildPlanPrompt(
  state: GameState,
  me: Player,
  availableActions: AvailableAction[],
  recentLogs: string[]
): string {
  const playerSummary = [
    `我:${me.username} 载具:${me.vehicle} 位置:${me.position}(${state.map.tiles[me.position]?.name}) 现金${me.cash} 存${me.deposit} 贷${me.loan} 券${me.coupons} 神${me.spirit?.spiritId ?? '-'}`,
    `我的地产:${me.properties.map((idx) => `#${idx}${state.map.tiles[idx]?.name}Lv${state.map.tiles[idx]?.level ?? 0}`).join('; ') || '无'}`,
    `卡片:${me.cards.map((c) => c.cardId).join(', ') || '无'}`,
    `道具:${me.items.map((i) => `${i.itemId}x${i.quantity}`).join(', ') || '无'}`,
    `持股:${me.stockHoldings ? Object.entries(me.stockHoldings).map(([k, v]) => `${k}:${v}`).join(', ') : '无'}`,
  ].join('\n');

  const surroundings: string[] = [];
  const tileCount = state.map.tiles.length;
  for (let d = 1; d <= 6; d++) {
    const idx = (me.position + d) % tileCount;
    const t = state.map.tiles[idx];
    if (t.type === 'property') {
      const owner = t.ownerId ? (state.players.find((p) => p.id === t.ownerId)?.username ?? '?') : '无';
      surroundings.push(`+${d}#${idx}${t.name} 价${Math.round((t.basePrice ?? 0) * state.priceIndex)} 主${owner} Lv${t.level ?? 0}`);
    } else {
      surroundings.push(`+${d}#${idx}${t.name}`);
    }
  }

  const actionsGuide = buildActionsGuide(availableActions);
  const logsStr = recentLogs.length > 0 ? recentLogs.join('\n') : '（无）';

  return `你是玩家 ${me.username}，当前处于行动阶段（已掷骰子并落地）。请输出本回合要执行的所有操作，按顺序执行。\n\n注意：\n1. 你必须输出一个 JSON 数组，数组中每个对象包含 action、target、reason。\n2. 数组中**不要**包含 roll；掷骰子已由系统自动完成。\n3. 优先执行买地/升级（如果 affordable），然后根据性格使用卡片/道具/股票/商店购买。\n4. 如果没什么可做，输出 [{"action":"skipTurn","target":{},"reason":"跳过"}]。\n5. 不要输出任何解释，只输出 JSON 数组。\n\n## 你的状态\n${playerSummary}\n\n## 前方6格\n${surroundings.join(' | ')}\n\n## 可用操作\n${actionsGuide}\n\n## 最近事件\n${logsStr}\n\n输出示例（假设可用）：\n[{"action":"buyProperty","target":{},"reason":"买下空地产"},{"action":"useCard","target":{"cardId":"priceRise","cardTarget":{"targetGroup":0}},"reason":"提升对手路段租金压力"}]`;
}

/** 校验 LLM 输出的整回合计划 */
function validatePlan(raw: unknown, availableActions: AvailableAction[]): TurnPlan | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;

  const actions: ActionDecision[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') return null;
    const obj = item as Record<string, unknown>;
    if (typeof obj.action !== 'string') return null;
    const decision: ActionDecision = {
      action: obj.action as ActionType,
      reason: typeof obj.reason === 'string' ? obj.reason : undefined,
    };
    if (obj.target && typeof obj.target === 'object') {
      decision.target = obj.target as ActionDecision['target'];
    }
    if (!matchesAvailableAction(decision, availableActions)) return null;
    actions.push(decision);
  }

  return { actions, reason: 'LLM 整回合计划' };
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
  private personality: PlayerPersonality;
  /** 多轮对话上下文：system prompt 只发一次，后续追加 user/assistant 消息 */
  private messages: ChatMessage[] = [];

  constructor(name: string, fallback: PlayerBrain, personality: PlayerPersonality, config?: Partial<LLMConfig>) {
    this.name = name;
    this.config = { ...getLLMConfig(), ...config };
    this.fallback = fallback;
    this.personality = personality;
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

    // 当存在任何可用动作时，都交由 LLM 统一决策（包括买地、股票、卡片/道具、商店购买）。
    // 启发式大脑仅作为 LLM 输出解析失败或 API 异常时的后备。
    if (availableActions.length === 0) {
      return this.fallback.decide(state, me, availableActions);
    }

    const recentLogs = state.logs.slice(-10).map((l) => l.message);

    // 每回合独立决策：避免上一轮 LLM 的回复在下一轮被简单重复。
    // 只保留 system prompt + 当前请求（以及本回合内的重试反馈）。
    this.messages = [{ role: 'system', content: buildSystemPrompt(this.personality) }];
    this.messages.push({ role: 'user', content: buildUserPrompt(state, me, availableActions, recentLogs) });

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const rawOutput = await callLLM(this.messages, this.config);
        const parsed = extractJSON(rawOutput);
        const decision = validateDecision(parsed);

        if (decision && matchesAvailableAction(decision, availableActions)) {
          console.log(
            `[OpencodeAgentBrain] LLM 调用成功: ${decision.action} target=${JSON.stringify(decision.target)} - ${decision.reason ?? ''}`
          );
          return decision;
        }

        const reason = decision
          ? `action=${decision.action} target=${JSON.stringify(decision.target)} 不在可用动作列表中`
          : '无法解析为合法 JSON 决策';
        console.warn(`[OpencodeAgentBrain] LLM 输出校验失败 (attempt ${attempt + 1}): ${reason}`);

        // 给 LLM 反馈，要求它从可用动作列表中选择
        this.messages.push({ role: 'assistant', content: rawOutput });
        this.messages.push({
          role: 'user',
          content: `上一条决策无效：${reason}。请严格从本回合可用动作列表中选择，并输出合法 JSON。\n\n${buildActionsGuide(availableActions)}`,
        });
      } catch (err: any) {
        console.warn(`[OpencodeAgentBrain] LLM 调用失败 (attempt ${attempt + 1}): ${err.message}`);
      }
    }

    console.warn(`[OpencodeAgentBrain] LLM 重试 ${MAX_RETRIES} 次后回退到启发式大脑`);
    return this.fallback.decide(state, me, availableActions);
  }

  /**
   * 一次性输出整回合行动计划。
   * 掷骰子由执行器自动处理，本方法只在 acting 阶段调用。
   * LLM 输出一个 JSON 数组，每个元素是一个 action/target/reason 对象，按顺序执行。
   */
  async planTurn(state: GameState, me: Player, availableActions: AvailableAction[]): Promise<TurnPlan> {
    if (!this.config.apiKey) {
      if (this.fallback.planTurn) {
        return this.fallback.planTurn(state, me, availableActions);
      }
      const decision = await this.fallback.decide(state, me, availableActions);
      return { actions: [decision], reason: 'fallback 单动作' };
    }

    if (availableActions.length === 0) {
      return { actions: [{ action: 'skipTurn', reason: '无可用动作' }], reason: '无可用动作' };
    }

    // 过滤掉 roll：掷骰子由执行器自动完成
    const filteredActions = availableActions.filter((a) => a.type !== 'roll');
    const recentLogs = state.logs.slice(-5).map((l) => l.message);

    this.messages = [{ role: 'system', content: buildSystemPrompt(this.personality) }];
    this.messages.push({
      role: 'user',
      content: buildPlanPrompt(state, me, filteredActions, recentLogs),
    });

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const rawOutput = await callLLM(this.messages, this.config);
        const parsed = extractJSON(rawOutput);
        const plan = validatePlan(parsed, filteredActions);

        if (plan) {
          console.log(
            `[OpencodeAgentBrain] LLM 计划成功: ${plan.actions.map((d) => d.action).join(', ')} - ${plan.reason ?? ''}`
          );
          return plan;
        }

        console.warn(`[OpencodeAgentBrain] LLM 计划校验失败 (attempt ${attempt + 1})`);
        this.messages.push({ role: 'assistant', content: rawOutput });
        this.messages.push({
          role: 'user',
          content: `上一条计划无效。请严格从本回合可用动作列表中选择，并输出合法 JSON 数组。\n\n${buildActionsGuide(filteredActions)}`,
        });
      } catch (err: any) {
        console.warn(`[OpencodeAgentBrain] LLM 调用失败 (attempt ${attempt + 1}): ${err.message}`);
      }
    }

    console.warn(`[OpencodeAgentBrain] LLM 计划重试 ${MAX_RETRIES} 次后回退到启发式大脑`);
    if (this.fallback.planTurn) {
      return this.fallback.planTurn(state, me, availableActions);
    }
    const decision = await this.fallback.decide(state, me, availableActions);
    return { actions: [decision], reason: 'fallback 单动作' };
  }
}

const PERSONALITY_ORDER: PlayerPersonality[] = [
  'risk-loving',
  'risk-averse',
  'property-focus',
  'stock-focus',
];

/** 创建 LLM 大脑工厂 */
export function createOpencodeAgentBrainFactory(
  fallbackFactory: (name: string) => PlayerBrain,
  config?: Partial<LLMConfig>
): (name: string) => OpencodeAgentBrain {
  let index = 0;
  return (name: string) => {
    const personality = PERSONALITY_ORDER[index % PERSONALITY_ORDER.length];
    index++;
    return new OpencodeAgentBrain(name, fallbackFactory(name), personality, config);
  };
}

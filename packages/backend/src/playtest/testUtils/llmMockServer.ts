/**
 * LLM Mock Server
 *
 * 用于自动化测试本地模拟 OpenAI-compatible LLM API。
 * 接收 prompt 后根据简单规则返回决策 JSON，避免外部 API 依赖。
 */

import { createServer, type Server as HttpServer } from 'http';
import type { ActionDecision, ActionType } from '../types.js';

export interface MockLLMServer {
  baseUrl: string;
  close: () => Promise<void>;
}

/**
 * 从 prompt 中解析当前游戏阶段。
 */
function parseStatus(prompt: string): string {
  const match = prompt.match(/- 阶段: (\w+)/);
  return match?.[1] ?? 'rolling';
}

/**
 * 从 prompt 中解析可用动作列表。
 */
function parseAvailableActions(prompt: string): Array<{ type: string; label: string }> {
  const actions: Array<{ type: string; label: string }> = [];
  const sectionMatch = prompt.match(/## 本回合可用操作\n([\s\S]*?)(?:\n## |$)/);
  if (!sectionMatch) return actions;

  const lines = sectionMatch[1].trim().split('\n');
  for (const line of lines) {
    const match = line.match(/^- ([\w:]+):\s*(.+)$/);
    if (match) {
      actions.push({ type: match[1], label: match[2] });
    }
  }
  return actions;
}

/**
 * 基于规则生成决策。
 */
function generateDecision(prompt: string): ActionDecision {
  const status = parseStatus(prompt);
  const actions = parseAvailableActions(prompt);
  const actionTypes = new Set(actions.map((a) => a.type));

  if (status === 'rolling') {
    if (actionTypes.has('roll')) {
      return { action: 'roll', target: { diceCount: 1 }, reason: 'mock LLM: 掷 1 颗' };
    }
    return { action: 'skipTurn', reason: 'mock LLM: 无掷骰动作' };
  }

  // acting 阶段优先级（先补充资源再使用）
  const priority: ActionType[] = [
    'buyProperty',
    'upgradeProperty',
    'buyCard',
    'buyItem',
    'useCard',
    'useItem',
    'rescueNpc',
    'repayLoan',
    'skipTurn',
  ];

  for (const action of priority) {
    if (actionTypes.has(action)) {
      if (action === 'useCard') {
        return { action, target: { cardId: 'freePass' }, reason: 'mock LLM: 使用卡片' };
      }
      if (action === 'useItem') {
        return { action, target: { itemId: 'remoteDice' }, reason: 'mock LLM: 使用道具' };
      }
      return { action, reason: `mock LLM: 选择 ${action}` };
    }
  }

  return { action: 'skipTurn', reason: 'mock LLM: 默认跳过' };
}

/**
 * 启动本地 Mock LLM 服务器。
 * 返回 baseUrl 和 close 函数。
 */
export function startMockLLMServer(port = 0): Promise<MockLLMServer> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      if (req.url !== '/chat/completions' || req.method !== 'POST') {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }

      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          const prompt = data.messages?.find((m: any) => m.role === 'user')?.content ?? '';
          const decision = generateDecision(prompt);

          const response = {
            id: 'mock-' + Date.now(),
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: data.model ?? 'mock-llm',
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: JSON.stringify(decision),
                },
                finish_reason: 'stop',
              },
            ],
          };

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(response));
        } catch (err: any) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    });

    server.listen(port, () => {
      const addr = server.address();
      const actualPort = typeof addr === 'string' ? 0 : addr!.port;
      resolve({
        baseUrl: `http://localhost:${actualPort}`,
        close: () =>
          new Promise<void>((res) => {
            server.close(() => res());
          }),
      });
    });

    server.on('error', reject);
  });
}

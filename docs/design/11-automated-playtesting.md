# 11. 自动化对局测试方案

## 目标

通过 4 个由 LLM 驱动的 AI 玩家在真实对局中执行不同操作，自动发现游戏规则、状态一致性、前端交互等方面的异常，并输出可修复的测试报告。

## 测试范围

- 核心流程：掷骰、移动、买地、升级、改建、过路费、回合结束
- 系统交互：卡片/道具使用、股票交易、银行贷款/还款、乐透、魔法屋
- 状态一致性：玩家资金、位置、地产、背包、神明、状态效果
- 边界情况：破产法拍、胜利条件、小游戏、NPC/陷阱触发

## 架构

```
packages/backend/src/playtest/
├── index.ts              # 测试入口与主循环
├── types.ts              # 共享类型
├── engine/
│   ├── gameSession.ts    # 房间创建、Socket 连接、状态监听
│   ├── actionExecutor.ts # 将 LLM 决策转换为 socket 事件
│   └── validator.ts      # 游戏规则不变量校验
├── agents/
│   ├── llmPlayer.ts      # LLM 玩家抽象接口
│   └── opencodeAgentPlayer.ts  # 基于 OMO slim playtester agent 的实现
├── scenarios/
│   └── freePlay.ts       # 4 人自由对局场景
└── reports/
    └── reporter.ts       # 问题记录与 Markdown 报告生成

packages/backend/src/playtest/__tests__/
└── playtest.e2e.test.ts  # Vitest 集成测试入口
```

## LLM 玩家设计

每个 AI 玩家独立维护上下文：
- `role`: 扮演的玩家角色与目标（激进买地 / 保守理财 / 卡片道具流 / 股票投资流）
- `memory`: 最近 10 条关键事件摘要
- `personality`: 风险偏好（0-1），影响买地/升级/贷款决策

### 输入给 LLM 的 prompt 结构

```markdown
你是大富翁4玩家 {username}，当前是第 {turn} 回合。

## 你的角色
{personalityDescription}

## 游戏规则摘要
- 目标：成为最后幸存者或资金达到目标
- 载具：walk/bike/car 影响可掷骰子数
- 土地：可购买、升级、改建；他人经过需付过路费
- 卡片/道具：点击使用，有目标时需要选择玩家/地块
- 股市：持有 >10% 总股本成为董事长
- 贷款：在起点格可贷，有贷款时停发存款利息

## 当前状态
{playerSelfSummary}

## 本回合可用操作
{availableActions}

## 最近事件
{recentLogs}

请输出 JSON:
{
  "action": "roll|buyProperty|upgradeProperty|rebuildTile|useCard|useItem|...|skipTurn",
  "target": { /* action 所需参数 */ },
  "reason": "简短决策理由"
}
```

### LLM 配置

使用 `xiaomi/mimo-v2.5` 作为 playtester agent 的模型，通过 OMO slim 自定义 agent 配置：

```jsonc
// ~/.config/opencode/oh-my-opencode-slim.json
{
  "agents": {
    "playtester": {
      "model": "xiaomi/mimo-v2.5",
      "prompt": "你是一名大富翁4自动化测试玩家...",
      "orchestratorPrompt": "仅在自动化对局测试任务中调用 @playtester，用于为指定玩家决策下一步操作。",
      "skills": [],
      "mcps": []
    }
  }
}
```

## 测试主循环

```typescript
while (turn < MAX_TURNS && !gameEnded) {
  await session.waitForStateUpdate();
  const current = session.getCurrentPlayer();
  const player = players[current.id];

  if (player.isAI) {
    const decision = await player.decide(session.state);
    await executor.execute(decision, session.state);
  }

  const issues = validator.validate(session.state, decision);
  reporter.record(issues);
}
```

## 不变量校验规则

| 类别 | 规则 | 严重程度 |
|---|---|---|
| 资金 | `cash + deposit - loan >= 0` 对非破产玩家成立 | critical |
| 位置 | 玩家 position 在 `[0, map.tiles.length)` 范围内 | critical |
| 移动 | `rolling→moving→acting` 阶段转换合法 | critical |
| 地产 | property 地块 ownerId 指向存在的非破产玩家 | high |
| 等级 | `level` 在 `[1,5]` 范围内 | high |
| 背包 | 卡片数量 `<= 15`，道具堆叠 `<= 9` | medium |
| 股票 | 持股数量 `>= 0` 且 `<= totalShares` | high |
| 神明 | `spirit.remainingDays > 0` | medium |
| 状态 | `statusEffects.remainingDays > 0` | medium |
| 胜利 | 游戏结束后只有一名胜者或按资金目标判定 | high |

## 报告格式

输出到 `packages/backend/playtest-reports/YYYY-MM-DD-HH-mm-ss-report.md`：

```markdown
# 自动化对局测试报告

- 时间：2026-06-24 12:00:00
- 场景：4 人自由对局
- 回合数：42
- 结果：正常结束 / 发现异常

## 玩家配置

| 玩家 | 角色 | 策略 |
|---|---|---|
| test1 | 阿土伯 | 激进买地 |
| test2 | 孙小美 | 保守理财 |
| test3 | 钱夫人 | 卡片道具流 |
| test4 | 大老千 | 股票投资流 |

## 发现的问题

### [critical] 资金异常
- 回合：15
- 玩家：test3
- 操作：buyProperty
- 期望：购买后现金 >= 0
- 实际：cash = -1500
- 相关日志：...
- 修复建议：检查 buyProperty 是否校验足够资金
```

## 执行方式

```bash
# 开发环境运行单次测试
npm run playtest

# 作为 Vitest 用例运行
npm run test -w packages/backend -- src/playtest/__tests__/playtest.e2e.test.ts

# 指定回合数
MAX_TURNS=100 npm run playtest
```

## 集成到 CI

GitHub Actions 中每晚运行：

```yaml
- name: Run LLM playtest
  env:
    OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS: true
    MAX_TURNS: 50
  run: npm run playtest
```

## 与现有测试的关系

- 单元测试：覆盖单个函数边界（已有 400+ 用例）
- 集成测试：覆盖 socket 事件（已有 socket.test.ts / e2e.test.ts）
- LLM playtest：覆盖多玩家真实对局中的涌现行为与长期状态一致性

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| LLM 输出不稳定 | 用 JSON schema 校验，解析失败时重试 3 次 |
| 测试耗时长 | 限制 MAX_TURNS，AI 玩家并行决策 |
| 测试非确定性 | 固定种子地图与角色，记录完整状态便于复现 |
| LLM 费用高 | 仅 nightly 运行，本地调试时可选关闭 |

## 近期实现优先级

1. P0: 游戏会话管理 + 4 人 AI 接入 + 基本动作执行
2. P1: 不变量校验 + Markdown 报告
3. P2: 多策略玩家角色 + 复杂动作（卡片/道具/股票）
3. P3: CI 集成 + 历史趋势统计

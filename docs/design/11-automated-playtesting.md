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
│   ├── actionExecutor.ts # 将大脑决策转换为 socket 事件
│   ├── validator.ts      # 游戏规则不变量校验
│   ├── statsCollector.ts # 数值快照与 HTML 报告
│   └── watchdog.ts       # 对局卡死监控与自动恢复
├── agents/
│   ├── llmPlayer.ts      # PlayerBrain 抽象接口
│   ├── heuristicBrain.ts # 启发式默认大脑（策略化卡片/道具）
│   ├── opencodeAgentBrain.ts  # LLM 大脑（解析失败回退启发式）
│   └── promptBuilder.ts  # LLM prompt 构建
├── scenarios/
│   ├── freePlay.ts       # 4 人自由对局场景
│   ├── pressureTest.ts   # 数值压力测试（10 圈淘汰）
│   ├── interactionTest.ts# 交互场景
│   └── stockTest.ts      # 股票场景
├── reports/
│   └── reporter.ts       # 问题记录与 Markdown 报告生成
└── minigames/
    ├── minigameTester.ts # 小游戏专项测试引擎
    └── runMiniGameTest.ts# 小游戏独立入口

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

Playtest 默认使用 **KIMI (Moonshot)** 的 OpenAI-compatible API：

- Base URL：`https://api.moonshot.cn/v1`
- 推荐模型：`moonshot-v1-8k`（长对局可选 `moonshot-v1-32k`）
- 密钥配置文件：`packages/backend/.playtest.env`（**已被 git 忽略，切勿提交**）

配置步骤：

```bash
cd packages/backend
cp .playtest.env.example .playtest.env
# 编辑 .playtest.env，填入你的 KIMI API Key
```

`.playtest.env` 示例（Moonshot 开放平台）：

```
PLAYTEST_LLM_API_KEY=sk-your-moonshot-key-here
PLAYTEST_LLM_BASE_URL=https://api.moonshot.cn/v1
PLAYTEST_LLM_MODEL=moonshot-v1-8k
```

### 也支持 Kimi Code 会员 key

如果你的 key 来自 **Kimi Code**（`sk-kimi-...` 前缀），需要改用 Anthropic-compatible 端点：

```
PLAYTEST_LLM_API_KEY=sk-kimi-your-kimi-code-key-here
PLAYTEST_LLM_BASE_URL=https://api.kimi.com/coding
PLAYTEST_LLM_MODEL=claude-opus-4-20250514
```

代码会根据 `baseUrl` 自动选择协议：
- `moonshot.cn` / `openai.com` / `api.openai.com` → OpenAI 协议
- `kimi.com` / `anthropic` → Anthropic 协议

配置优先级：`.playtest.env` > 环境变量 > KIMI 默认值。旧环境变量方式仍兼容：

```bash
export PLAYTEST_LLM_API_KEY="sk-..."
export PLAYTEST_LLM_BASE_URL="https://api.moonshot.cn/v1"
export PLAYTEST_LLM_MODEL="moonshot-v1-8k"
npm run playtest:llm
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
# 开发环境运行单次测试（启发式大脑）
npm run playtest

# 使用 KIMI LLM 运行测试（读取 .playtest.env）
npm run playtest:llm:kimi

# 小游戏专项测试
npm run test:minigames

# 作为 Vitest 用例运行
npm run test -w packages/backend -- src/playtest/__tests__/playtest.e2e.test.ts

# 指定回合数
MAX_TURNS=100 npm run playtest

# 全卡片/全道具对局（用于验证卡片/道具使用逻辑）
PLAYTEST_GIVE_ALL_CARDS=true PLAYTEST_GIVE_ALL_ITEMS=true PLAYTEST_STARTING_COUPONS=5000 npm run playtest

# 调整经济压力参数（详见 docs/design/13-numerical-design.md）
PLAYTEST_TOTAL_FUNDS=15000 PLAYTEST_SALARY=5000 PLAYTEST_RENT_MULTIPLIER=0.5 PLAYTEST_PROPERTY_PRICE_MULTIPLIER=0.5 npm run playtest
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

## 与真实房间 AI 的关系

Playtest 框架中的启发式大脑和 LLM 大脑已被复用到真实多人房间：

- `packages/backend/src/ai/aiClient.ts` 以 socket.io-client 形式连接到本服，加入房间并自动决策。
- 房主在房间页点击「+ 启发式 AI」或「+ LLM AI」即可添加 AI 玩家。
- LLM AI 思考时通过 `ai:thinking`/`ai:decided` 向房间内其他玩家广播状态与预计等待时间。
- 真实房间复用 `agents/heuristicBrain.ts` 与 `agents/opencodeAgentBrain.ts`，避免 Playtest 与生产代码重复。

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

## 压力测试

`pressureTest` 场景专门验证数值平衡：
- 初始资金：1000（4 玩家）
- 地图：`economy`（高房价、地产为王）
- 策略：buy/upgradeAggressiveness = 1.0，允许贷款，启用卡片/道具
- 目标：3 轮测试中至少 2 轮在 10 圈（40 回合）内出现玩家破产

该测试不修改全局默认配置，而是通过 `PlaytestConfig.gameConfig` 注入高压参数。

## Watchdog 守护

`engine/watchdog.ts` 在对局期间持续监控状态变化：
- 超过阈值（默认 10s）无状态更新则判定为卡死
- 尝试通过 `game:skip` 推进当前玩家回合
- 连续 3 次恢复失败后导出当前状态快照并记录 critical issue

## LLM Prompt 与策略优化

`agents/promptBuilder.ts` 负责为 LLM 构建完整 prompt：
- 从 `docs/design/04-game-rules.md` 提炼核心规则摘要
- 注入全量 30 张卡片与 13 种道具的说明（id / 名称 / 目标类型 / 效果 / 价格）
- 提供当前场面信息：玩家资金/地产/卡片/道具/神明、关键地块、股票行情
- 为每个可用操作附带完整 target 参数说明
- 输出格式强制要求 `{ action, target, reason }` 的 JSON

`agents/opencodeAgentBrain.ts` 通过 OpenAI-compatible API 调用 LLM：
- 默认使用 KIMI (Moonshot)：base URL `https://api.moonshot.cn/v1`，模型 `moonshot-v1-8k`
- 优先读取 `packages/backend/.playtest.env`，其次环境变量 `PLAYTEST_LLM_API_KEY` / `PLAYTEST_LLM_BASE_URL` / `PLAYTEST_LLM_MODEL`
- JSON 输出校验失败或 API 异常时自动重试 3 次，最终回退到启发式大脑
- 打印每次调用的 token 消耗，便于诊断额度
- **设计原则**：LLM 专注战略决策（买地/升级/改建/股票/魔法屋），卡片/道具等战术操作交由启发式大脑处理（启发式大脑有更完善的卡片使用策略）

## 游戏技巧与对抗行为指南

以下策略指导 LLM 和启发式大脑在自动化对局中做出更富攻击性和技巧性的决策。

### 让对手受损的行为（高优先级）

| 行为 | 方式 | 效果 |
|------|------|------|
| 过路费打击 | 升级同组地产到 Lv3+ | 对手停留时支付高额过路费，可能直接导致破产 |
| 卡片攻击 | 涨价卡 / 查封卡 / 摧毁卡 | 增加对手地产维护成本 / 冻结对手收入 / 拆除建筑 |
| 状态干扰 | 陷害卡 / 冬眠卡 / 梦游卡 / 乌龟卡 | 让对手入狱 / 跳过回合 / 反向移动 / 移动受限 |
| 资产掠夺 | 抢夺卡 / 均贫卡 / 换地卡 / 换房卡 | 直接获取对手现金或地产，缩小差距 |
| 陷阱放置 | 在自己高级地产前放路障/地雷/炸弹 | 迫使对手绕路或受伤住院，增加走到你地产的概率 |
| 飞弹打击 | 飞弹 / 核弹 | 拆除对手 Lv3+ 建筑，大幅降低其过路费收入 |
| 股票打压 | 大量卖出对手公司股票 | 压低股价，减少对手资产价值和分红收入 |

### 股票获利技巧

- **低价买入**：股价 ≤ 100 时大量买入（如航空公司 150 以下、电脑公司 130 以下）
- **高价卖出**：股价 ≥ 200 时分批卖出获利，保留部分等待更高价
- **董事长策略**：持股 > 10% 自动成为董事长，获得公司控制权和定期分红
- **分散投资**：同时持有 2-3 只股票，降低单只波动风险
- **对手打压**：卖出对手持有公司的股票，压低股价减少对手资产
- **时机把握**：物价指数低时买入股票（股价也低），物价指数高时卖出
- **流动性管理**：买入股票后至少保留 30% 现金应对过路费

### 卡片使用策略（启发式大脑已实现）

1. **防御优先**：持有免租卡时在手，坏神明附身时立即用送神符
2. **攻击领先者**：对资金最多的对手使用均贫卡/陷害卡/冬眠卡
3. **保护资产**：用查封卡保护自己 Lv2+ 的关键地产（防涨价/拆除）
4. **定点打击**：对对手 Lv3+ 建筑用摧毁卡/怪兽卡拆除
5. **移动控制**：遥控骰子精确到达目标格（空地产/自己地产/商店）
6. **陷阱战术**：在己方高级地产前方 1-3 格放置路障/地雷/炸弹

### 道具使用策略（启发式大脑已实现）

1. **交通工具**：优先装备汽车（掷 3 骰子）> 机车（掷 2 骰子）
2. **陷阱清除**：前方有陷阱时使用机器娃娃清除
3. **精确走位**：遥控骰子精确到达关键目标格
4. **建筑拆除**：飞弹/核弹瞄准对手最高等级地产
5. **陷阱布置**：在自己高级地产前方必经之路放置路障/炸弹

### 对局中行为统计基准（240 操作的期望分布）

| 动作类型 | 理想占比 | 说明 |
|----------|---------|------|
| roll | 40-50% | 移动是必要的，但不应超过一半 |
| buyProperty | 10-15% | 早期多买，后期地买完自然减少 |
| upgradeProperty | 10-15% | 持续升级是核心收入来源 |
| tradeStock | 8-12% | 股票是最佳资产增值手段 |
| useCard | 5-10% | 卡片是扭转局势的关键 |
| useItem | 3-5% | 道具提升移动和攻击能力 |
| buyCard/buyItem | 3-5% | 经过商店应补充装备 |
| repayLoan/takeLoan | 2-5% | 合理借贷管理现金流 |

> 注：当前 240 操作测试中 roll 占 74%，useCard/useItem/buyCard/buyItem 均为 0%。修复后期望改善到上述基准。

## 真实 LLM 长对局测试

配置环境变量后运行：

```bash
export PLAYTEST_LLM_API_KEY="sk-..."
export PLAYTEST_LLM_BASE_URL="https://api.xiaomimimo.com/v1"
export PLAYTEST_LLM_MODEL="mimo-v2.5"
npm run test -w packages/backend -- src/playtest/__tests__/playtest.e2e.test.ts -t "real MIMO API"
```

测试用例：
- 3 轮自由对局
- 每轮 120 次操作（4 玩家 × 30 回合）
- 初始资金 10000，`economy` 地图
- 要求无 critical 问题，验证 LLM 能在长对局中持续做出有效决策

> 注意：真实 LLM 调用较慢（mimo-v2.5 约 10-15 秒/次），完整 3 轮测试可能需要 60-90 分钟。未配置 key 时该用例自动跳过。

## 多模态与前端显示迭代（未来）

LLM 支持多模态后，可进一步将前端棋盘截图输入 LLM，验证其对当前场面的识别是否与游戏状态一致。若识别结果与实际状态不符，则迭代 `packages/frontend/src/board.ts` 的渲染逻辑：
- 地块文字/图标清晰度
- 玩家棋子与神明/陷阱的层级关系
- 建筑等级与特殊建筑的可辨识度
- 当前回合高亮与玩家资产提示

## 近期实现优先级

1. P0: 游戏会话管理 + 4 人 AI 接入 + 基本动作执行 ✓
2. P1: 不变量校验 + Markdown 报告 ✓
3. P2: 多策略玩家角色 + 复杂动作（卡片/道具/股票） ✓（启发式版本）
4. P3: 数值压力测试 + Watchdog 守护 ✓
5. P4: LLM Prompt 优化与真实 LLM 长对局测试 ✓
6. P5: CI 集成 + 历史趋势统计
7. P6: 多模态前端显示验证

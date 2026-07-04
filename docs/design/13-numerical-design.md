# 13. 数值设计思路与平衡框架

> 本文档说明大富翁4 Web 版核心经济数值的设计目标、当前取值、推导过程与验证方法。
> 对应源码：`packages/shared/src/index.ts`、`packages/backend/src/game/engine.ts`、
> `packages/backend/src/playtest/index.ts` / `runChunked.ts`、
> `packages/shared/src/data/cards.ts`、`packages/shared/src/data/items.ts`。

## 1. 设计目标

1. **单局时长可控**：标准 4 人对局应在 30～90 分钟结束（现实多人房间）或 30～60 分钟结束（自动化测试）。
2. **破产有压力但不过快**：前期买地有现金流压力，中期租金开始收割，后期通过卡片/道具/股票逆转。
3. **地产、股票、卡片三条线都有价值**：不能只靠囤地或炒股必胜。
4. **LLM/启发式 AI 能正常推进**：AI 不能因租金过高而迅速破产，也不能因资金太多而无限拖延。
5. **可配置**：关键经济参数通过 `GameConfig` 暴露，房间创建时可覆盖。

## 2. 数值总览

| 数值项 | 生产默认 | Playtest 默认 | 说明 |
|---|---|---|---|
| 初始资金 `totalFunds` | 10000 | 10000 | 玩家开局现金+存款总额（现金通常占大部分） |
| 起点工资 `salary` | 10000 | 3000 | 经过起点/每月发放 |
| 物价上限 `priceIndex` | 上限 6 | 上限 6 | 所有人总资产平均值 ÷ 初始总资产 |
| 过路费倍率 `rentMultiplier` | 1.0 | **1.5** | 全局租金缩放；Playtest 提高到 1.5 保证对局能在 200 回合内结束 |
| 地产价格倍率 `propertyPriceMultiplier` | 1.0 | **0.6** | 买地/升级价格缩放；Playtest 从 0.5 提到 0.6 避免买地过于廉价 |
| 股价波动 `stockVolatility` | 0.2 | **0.6** | Playtest 更高波动，放大股票盈亏 |
| 地价/租金比例 | baseRent ≈ basePrice × 10% | 同上 | 游戏内地图配置已降至原价的 10% |
| 同组加成 | 2 块 +20%，3 块及以上 +50% | 同上 | 强化路段垄断收益 |
| 住宅租金公式 | `baseRent × (1 + level × 0.5) × (1 + groupBonus) × priceIndex` | 同上 | 5 级地租金为 3.5 倍基础 |
| 连锁店公式 | `baseRent × chainStoreCount × priceIndex` | 同上 | 全图连锁店联合收费 |
| 股票总股本 | 10000 股/公司 | 同上 | 持股 >10% 当选董事长 |
| 股价日波动 | ±10% | ±10%（波动参数 0.2） | 每日收盘后随机波动 |
| 月度分红 | 公司盈余 × 10% | 同上 | 每月 15 日发放 |
| 存款利息 | 每月 10% | 同上 | 仅无贷款者发放 |
| 贷款额度 | 总资产 | 同上 | 3 个月免息，之后计息 |
| 破产法拍 | 最多 3 次 | 同上 | 先卖股票，再按估值 70% 卖地 |

> **注意**：生产默认与 Playtest 默认的差异是刻意保留的。生产房间面向真实玩家，保留经典 10000/10000 配置；Playtest 场景用于快速暴露问题，可通过环境变量注入更激进参数。

## 3. 核心数值设计思路

### 3.1 地价与租金：为什么降到原价的 10%？

原版大富翁4的地价/租金在 40 格地图上会让玩家在前期 10 回合内就因一次过路费而破产。Web 版初期测试也验证了这一点：

- 当 `basePrice=300`、`baseRent=30`、初始资金 10000 时，玩家踩到 3 级同组地可能一次支付 1500+，相当于总资金 15%。
- 连续 2～3 次踩地就会触发法拍，游戏体验变成「谁先到谁倒霉」。

因此将地图生成器中的 `basePriceRange` 统一降到原价的 **10%**（如原 3000 的地块现 300），并保持 `baseRent ≈ basePrice × 10%`。这样：

- 买地成本降低，前期买地决策更频繁。
- 单次过路费占资金比例从 15% 降到 1.5% 左右，玩家有更多回合周转。
- 地产 still 是主要收入来源，但需要「数量 + 等级 + 同组」共同积累。

### 3.2 初始资金与起点工资

生产默认保持 **初始资金 10000、起点工资 10000**，这是大富翁4经典体感：

- 开局现金足够购买 2～3 块中小地块。
- 绕圈一圈回到起点可补充约 1 倍初始资金，防止早期破产。
- 工资与物价指数脱钩，作为「安全网」而非主要收入来源。

Playtest 默认将工资降到 **3000**，原因：

- 自动化测试需要更快出现破产、股票交易、卡片使用等交互。
- 低工资放大「买地 vs 存款」的决策差异，更容易发现资金边界 bug。
- 可通过 `PLAYTEST_SALARY` 覆盖。

### 3.3 物价指数上限 6

物价指数 `priceIndex = 所有人总资产平均值 ÷ 初始总资产`，上限 6：

- 无上限时，后期地租会指数爆炸，一次过路费即可清空现金，玩家体验变差。
- 上限 6 意味着后期租金最多是早期的 6 倍，配合地产等级仍能让领先者扩大优势，但不会一锤定音。
- 上限也限制了股票市值对物价的过度放大（股票高涨 → 总资产虚高 → 地租暴涨的循环）。

### 3.4 过路费倍率 `rentMultiplier` 与地产价格倍率 `propertyPriceMultiplier`

这两个参数是房间平衡性的「总开关」：

| 组合 | 效果 | 适用场景 |
|---|---|---|
| rentMultiplier=1, propertyPriceMultiplier=1 | 标准平衡 | 默认房间 |
| rentMultiplier=0.5, propertyPriceMultiplier=1 | 租金压力小，买地仍贵 | 新手房 |
| rentMultiplier=1, propertyPriceMultiplier=0.5 | 买地便宜，租金标准 | 快速买地、测试地产垄断 |
| rentMultiplier=0.5, propertyPriceMultiplier=0.5 | 整体经济宽松 | 休闲/教学局 |
| rentMultiplier=1.5, propertyPriceMultiplier=1 | 租金压力大 | 高手/快节奏局 |

当前建议默认保持 `rentMultiplier=1, propertyPriceMultiplier=1`。Playtest 常用 `propertyPriceMultiplier=0.5` 让 AI 更快建立地产，便于测试后期交互。

### 3.5 升级费用曲线

升级费用 = `basePrice × (currentLevel + 1) × 0.5 × priceIndex`：

- 升到 1 级：0.5 倍 basePrice
- 升到 2 级：1.0 倍 basePrice
- 升到 3 级：1.5 倍 basePrice
- 升到 4 级：2.0 倍 basePrice
- 升到 5 级：2.5 倍 basePrice

**设计理由**：

- 升级总成本 ≈ 7.5 倍 basePrice，相当于买 7～8 块空地。让玩家在「广撒网买地」和「集中升级」之间做选择。
- 每级租金提升 50%，5 级地租金为 3.5 倍基础。升级回报线性，成本递增，避免无脑升满。

### 3.6 股票参数

- **总股本 10000 股**：董事长门槛 >10% 即 1001 股，需要约 10～20 万资金（股价 100～200 时）。
- **日波动 ±10%**：单日盈亏可观但不会瞬间暴富/暴亏。
- **分红 10% 盈余**：让长期持股有收益，但不会超过地产租金。
- **股价与物价不直接挂钩**：避免股票和地产形成双向放大。

### 3.7 卡片/道具定价

卡片与道具价格来自原版商店截图（见 `doc/pricing_screenshots/` 与 `doc/card_item_pricing.md`），并按点券经济做了归一化：

- 强力卡片（冬眠、陷害、同盟）定价 160～200 点券。
- 中等卡片（涨价、查封、换地）定价 30～70 点券。
- 道具中交通工具最贵（汽车约 80 点券），陷阱和工具 10～50 点券。
- 小游戏平均产出 30～50 点券，让玩家 2～3 局小游戏可购买一张中档卡片。

### 3.8 事件金额

命运/新闻事件的现金影响设计在 **300～10000** 区间：

- 小额罚款 300～1000：制造现金流波动，不致命。
- 中额罚款 3000～5000：相当于 1～2 块低级地租，需要预留现金。
- 大额正负向 10000：相当于 1 倍初始资金，能显著改变局势。
- 强制卖股票、住院/入狱：非金钱惩罚，增加多样性。

## 4. 数值平衡验证方法

### 4.1 Playtest 自动化对局

通过 `npm run playtest` 运行大量对局，收集关键指标。

**2026-06-29 两轮调参结果（启发式 AI，4 人，MAX_TURNS=200）：**

| 轮次 | 配置 | 平均回合数 | 破产率 | 地产购买率 | 商店访问率 | 垄断组数 |
|---|---|---|---|---|---|---|
| 第 1 轮 | rentMultiplier=1, propertyPriceMultiplier=0.5, shop=4 | 150（其中 1 局达 200 回合上限） | 2.25/4 | 88% | 4.5%～7.6% | 0 |
| 第 2 轮 | rentMultiplier=1.5, propertyPriceMultiplier=0.6, shop=6 | **128** | **3/4** | 45%～87% | 12%～17.5% | 1/5 局 |

**第 1 轮问题**：租金压力不足，地产购买虽高但难以形成垄断；商店访问率低（<8%）；股票整体亏损；部分对局拖到 200 回合上限仅 1 人破产。

**第 2 轮修复**：
- `rentMultiplier` 1.0 → 1.5：提升过路费压力，加速破产。
- `propertyPriceMultiplier` 0.5 → 0.6：避免买地过于廉价。
- 扩展版图 `shop` 4 → 6， fate/chance 各减 1：提升商店访问率。
- 启发式大脑：优先完成路段垄断（降低关键地块现金保留）、积极升级垄断路段、使用换地卡/换房卡、股票改为成本价止盈止损策略、商店购买更积极。

**结论**：5 局全部在 200 回合内结束，每局至少 3 人破产，达到当前测试目标。

| 指标 | 健康范围 | 当前观测（第 2 轮） |
|---|---|---|
| 平均回合数 | 40～200 | 128 |
| 破产率 | 每局至少 1～2 人破产 | 3/4 |
| 地产购买率 | 60% 以上空地被购买 | 45%～87% |
| 商店访问率 | >8% | 12%～17.5% |
| 垄断组数 | 偶尔出现 | 1/5 局 |
| 股票盈亏 | 有赢有亏 | 多数局亏损，1 局大幅盈利 |

### 4.2 压力测试

`pressureTest` 场景使用：

- 初始资金 1000
- economy 地图（高房价）
- AI 买地/升级激进度 1.0
- 目标：10 圈（40 回合）内至少 2/3 轮次出现破产

该测试验证「极端高压下游戏是否能正常结束」，而非日常平衡。

### 4.3 边界检查

- 最高租金场景：5 级地 + 同组 3 块 + 涨价卡 + 大穷神 + priceIndex=6，应能让满资金玩家进入法拍但不直接破产。
- 最高股票收益：连续涨停 10 天，股价从 100 涨到约 259，持股 1001 股获利约 16 万，应与 5 级高级地租相当。

## 5. 可调参数与配置入口

所有核心参数都通过 `GameConfig` 暴露：

```typescript
interface GameConfig {
  totalFunds: number;
  salary?: number;
  rentMultiplier?: number;
  propertyPriceMultiplier?: number;
  stockVolatility?: number;
  // ...
}
```

Playtest 可通过环境变量覆盖：

```bash
PLAYTEST_TOTAL_FUNDS=15000
PLAYTEST_SALARY=5000
PLAYTEST_RENT_MULTIPLIER=0.5
PLAYTEST_PROPERTY_PRICE_MULTIPLIER=0.5
npm run playtest
```

## 6. 已发现的问题与后续调整方向

1. **生产默认 vs Playtest 默认差距较大**：真实玩家房间未经过大规模人机测试，建议后续上线 A/B 测试不同 `rentMultiplier` 组合。
2. **大地产（mall/hotel/gasStation）强度**：商场/旅馆转盘倍数 1-6/1-8 随机性过大，可能导致极端一击必杀；考虑加入上限或期望值修正。
3. **股票与地产的相对收益**：当前股票长期收益可能偏低，需更多对局数据验证。
4. **卡片经济**：部分强力卡片（冬眠、同盟）使用率低，可能因点券获取速度不足；可通过小游戏/点券格产出调整。
5. **LLM AI 经济行为**：LLM 玩家倾向于过度保守储蓄，需通过 prompt 和 personality 引导其在适当时机买地/升级。

## 7. 参考

- `docs/design/04-game-rules.md`：完整规则映射。
- `docs/design/09-rent-system.md`：过路费公式详解。
- `docs/design/10-events-finance.md`：事件、股票、保险系统。
- `packages/backend/src/playtest/scenarios/pressureTest.ts`：压力测试参数。

## 8. 实现一致性核查与 Gap 分析

> 本节将设计文档中的数值约定与当前代码实现逐条核对，标出仍存在的 gap，作为后续迭代依据。

### 8.1 已一致的核心数值

| 设计约定 | 代码实现位置 | 状态 |
|---|---|---|
| 生产默认 `totalFunds=10000`、`salary=10000` | `packages/shared/src/index.ts` `DEFAULT_GAME_CONFIG` | ✅ 一致 |
| Playtest 默认 `rentMultiplier=1.5`、`propertyPriceMultiplier=0.6`、`salary=3000` | `packages/backend/src/playtest/index.ts` | ✅ 一致 |
| 地价/租金降至原价 10%，`baseRent ≈ basePrice × 10%` | `packages/map-generator/src/generator.ts` `assignPrices` | ✅ 一致 |
| 物价指数 `priceIndex = 总资产平均值 / 初始总资产`，上限 6 | `packages/backend/src/game/engine.ts` `calculatePriceIndex` + `endTurn` 中 `Math.min(6, ...)` | ✅ 一致 |
| 住宅租金 `baseRent × (1 + level × 0.5) × (1 + groupBonus) × priceIndex` | `packages/backend/src/game/engine.ts` `calculateRent` | ✅ 一致 |
| 同组加成：2 块 +20%、3 块及以上 +50% | `packages/backend/src/game/engine.ts` `getGroupBonus` | ✅ 一致 |
| 连锁店 `baseRent × chainStoreCount × priceIndex` | `packages/backend/src/game/engine.ts` `calculateRent` | ✅ 一致 |
| 升级费用 `basePrice × (currentLevel + 1) × 0.5 × priceIndex` | `packages/backend/src/game/engine.ts` `upgradeProperty` | ✅ 一致 |
| 存款利息 10%/月，有贷款时停发 | `packages/backend/src/game/engine.ts` `monthlySettlement` | ✅ 一致 |
| 股票总股本 10000 股，董事长 >10% | `packages/backend/src/game/financialSystem/stocks.ts` | ✅ 一致 |
| 分红 = 公司盈余 × 10%，每月 15 日 | `packages/backend/src/game/financialSystem/stocks.ts` | ✅ 一致 |
| 卡片/道具定价来自原版并归一化 | `packages/shared/src/data/cards.ts`、`items.ts` | ✅ 一致 |

### 8.2 发现的 Gap 与待完善项

| Gap | 设计文档要求 | 当前实现 | 影响与建议 |
|---|---|---|---|
| **贷款利息** | 3 个月免息，之后计息 | `takeLoan` 仅实现免息，注释明确“后续未实现额外利息” | 低：当前 Playtest 中贷款使用率本身不高；建议补上月度利息计算，避免贷款成为无成本融资。 |
| **贷款额度定义** | 额度 = 总资产 | 额度 = 存款 + 地产估值 + 股票市值 - 已贷金额（现金不计入） | 中：文档与代码不一致；已在代码注释中说明“避免重复借贷循环”。建议同步更新设计文档或开放现金抵押（折扣计入）。 |
| **大地产建筑选择** | 购买大地产后选择建筑类型（公园/商场/旅馆/加油站/研究所） | 购买后默认 `buildingType='house'`，前端有改建按钮但改建免费 | 高：大地产缺少建造费用决策，影响经济深度；建议补全建造费用与购买时选择弹窗。 |
| **建造/改建费用** | 建造费用 = `basePrice × 建筑系数` | 当前 `rebuildTile` 改建免费 | 高：免费改建让卡片经济失衡，建议按建筑类型收取建造费。 |
| **研究院产物研发** | 研究所按等级制造道具 | 代码中 `lab` 建筑租金为 0，未实现研发逻辑 | 中：缺少一条重要的道具获取途径，影响后期策略多样性。 |
| **系统格临时实现** | 税务格固定金额、得点券格固定产出、监狱格完整交互 | 税务格 `-5000`、得点券格固定 30、监狱格仅跳过回合 | 中：这些临时值没有经过平衡验证，需要按地图规模调整。 |
| **地图限定事件** | 不同地图触发限定命运/新闻 | 当前仅 `single` 地图字段，条件未启用 | 低：主要影响主题代入感，对核心数值影响小。 |
| **12 角色属性差异** | 角色在初始现金/投资偏好/移动能力上有差异 | 当前 12 角色仅颜色/头像不同 | 中：原版角色对称，但设计文档提到希望补充差异；需先明确是否偏离原版。 |
| **LLM/启发式 AI 经济行为** | AI 应在适当时机买地、升级、炒股、逛商店 | 启发式大脑已覆盖主要策略；LLM 仍偏保守 | 中：需要更多对局数据校准 prompt 与 personality。 |

### 8.3 对数值设计思路的进一步讨论

1. **地价降到原价 10% 的副作用**：虽然避免了早期破产，但也导致后期 5 级地租对总资金 10000 的玩家压力不足。当前通过 `rentMultiplier=1.5` 在 Playtest 中补偿，但生产默认 `rentMultiplier=1` 下，高端地产可能缺乏“一击必杀”的威慑力。
2. **`rentMultiplier` 与 `propertyPriceMultiplier` 的耦合**：降低买地价格（`propertyPriceMultiplier < 1`）会加快地产积累，从而更快形成垄断；提高租金（`rentMultiplier > 1`）会加速破产。两者组合是调节对局时长的最有效杠杆。
3. **工资 `salary` 的安全网作用**：生产 `salary=10000` 让玩家每圈回到起点可补充大量现金，降低早期破产概率；Playtest `salary=3000` 则放大现金流压力，更快暴露资金边界 bug。
4. **股票收益的放大器角色**：当前股价日波动 ±10% 配合 `stockVolatility=0.6`，让股价在 200 回合内有显著涨跌，但董事长分红（盈余 10%）相对地产租金偏弱。股票更适合作为“翻盘”工具而非主要收入来源。
5. **点券经济与小游戏的平衡**：小游戏平均产出 20-80 点券，商店卡片价格 20-160 点券，玩家需要多次小游戏/逛商店才能购买强力卡片。当前每个地图只有 1 个小游戏格，点券产出可能偏低，导致强力卡片（冬眠、同盟）使用率低。

## 9. 本轮启发式对局调参记录

> 运行命令：`MAX_TURNS=200 npx tsx src/playtest/run5heuristic.ts`
> 配置：`rentMultiplier=1.5`、`propertyPriceMultiplier=0.6`、`totalFunds=10000`、`salary=3000`、`mapId=expanded`、4 玩家启发式大脑。

### 9.1 汇总结果

（待 5 局运行完成后填入）

| 指标 | 第 1 局 | 第 2 局 | 第 3 局 | 第 4 局 | 第 5 局 | 平均 |
|---|---|---|---|---|---|---|
| 结果 | - | - | - | - | - | - |
| 回合数 | - | - | - | - | - | - |
| 破产数 | - | - | - | - | - | - |
| 土地购买率 | - | - | - | - | - | - |
| 商店访问率 | - | - | - | - | - | - |
| 股票总盈亏 | - | - | - | - | - | - |
| 攻击行为数 | - | - | - | - | - | - |

### 9.2 发现的问题与修复

（待运行完成后补充）

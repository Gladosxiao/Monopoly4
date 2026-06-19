# 04. 游戏规则映射 — 当前实现情况评估

> 评估时间：2026-06-19
> 评估对象：`docs/design/04-game-rules.md` 与当前代码实现
> 当前版本已实现最基础的可玩闭环（掷骰、移动、买地、升级、住宅过路费、破产判定），并在本次迭代中补全了过路费扩展（连锁店、特殊建筑、神明、卡片）与首期卡片/道具系统，同时整合了事件/新闻注册表、股票、公司与保险系统。大量扩展系统尚未实现。

## 总体完成度

| 章节 | 主题 | 完成度 | 说明 |
|---|---|---|---|
| 1 | 开局设置 | 70% | 土地权限/游戏时间/胜利条件已补齐，多地图未实现 |
| 2 | 角色属性 | 60% | 字段存在，利息/破产法拍已落地，贷款/总资产计算待完善 |
| 3 | 地图与路径 | 90% | `@monopoly4/map-generator` 已提供多模板、加载器、坐标工具、SVG/HTML 渲染与棋子占位；前端 `board.ts` 已接入坐标工具 |
| 4 | 土地类型 | 60% | 大小块/建筑类型已落地，但研究院产物等未实现 |
| 5 | 土地购买与升级 | 70% | 购买/升级/改建可用，但大块土地建筑选择、建造费用未完全对齐 |
| 6 | 过路费 | 85% | 住宅/连锁店/特殊建筑/神明/卡片影响已基本实现 |
| 7 | 破产与获胜 | 70% | 破产法拍/资金目标/时间限制胜利已实现 |
| 8 | 行走与回合 | 65% | 掷骰可选骰子数、月度结算（物价指数+利息）已实现，移动阶段待完善 |
| 9 | 卡片系统 | 75% | 30 张已全数定义并接入 `cardSystem`；23 张效果已落地（部分简化），7 张占位；卡片格随机发卡已接入 |
| 10 | 道具系统 | 60% | 13 种已定义并接入 `itemSystem`；交通工具/陷阱/工具类 8 种效果已落地（部分简化），5 种研究所产物占位 |
| 11 | 神明附身系统 | 50% | 定义、租金效果、地图 NPC 与请神符寻路已实现，变身/消失待完善 |
| 12 | 股票、公司与保险 | 70% | 股票交易/董事长/公司地块特效/保险购买理赔已实现，完整 9 家公司与复杂轮盘待细化 |
| 13 | 其他系统（特殊地点/小游戏/NPC） | 5% | 仅部分系统格有简化效果 |
| 14 | 命运与新闻事件 | 60% | 事件注册表与效果描述符已实现，覆盖主要命运/新闻事件，地图限定/神明挡灾待细化 |

---

## 1. 开局设置

| 规则项 | 设计文档要求 | 当前实现 | 状态 |
|---|---|---|---|
| 游戏人数 | 2～4 人 | `Room.maxPlayers` 可配置，创建房间时默认 4 | ✅ 已实现 |
| 角色选择 | 12 名可选角色 | 当前仅 4 名角色（孙小美、阿土伯、钱夫人、宫本宝藏） | ⚠️ 部分实现 |
| 总资金 | 10000～300000 | `GameConfig.totalFunds` 可用 | ✅ 已实现 |
| 行进方式 | 步行/机车/汽车 | `GameConfig.moveMode` 为 walk/bike/car，载具可通过道具变更 | ✅ 已实现 |
| 土地权限 | 1m/3m/6m/1y/2y/perpetual | `GameConfig.landLease` 已添加，到期逻辑待实现 | ⚠️ 部分实现 |
| 游戏时间 | 1m/3m/6m/1y/2y/perpetual | `GameConfig.gameTime` 已添加并生效 | ✅ 已实现 |
| 胜利条件 | 原资金 3/5/10/50/100 倍 / 无限 | `GameConfig.winCondition` 已包含 50/100 倍并生效 | ✅ 已实现 |
| 地图 | 台湾/大陆/日本/美国 | 仅 `SIMPLE_MAP`（新手村），无多地图加载 | ❌ 未实现 |

**代码位置**：`packages/shared/src/index.ts`（GameConfig、SIMPLE_MAP）

---

## 2. 角色属性

| 功能 | 设计文档要求 | 当前实现 | 状态 |
|---|---|---|---|
| 现金/储蓄/贷款/点券字段 | 需要 | `Player.cash/deposit/loan/coupons` 已存在 | ✅ 已实现 |
| 现金变动自动扣存款 | 需要 | `payMoney`、`transferMoney` 已实现现金优先、存款兜底 | ✅ 已实现 |
| 存款利息（每月 10%） | 需要 | 月度结算中已发放 | ✅ 已实现 |
| 贷款（额度=总资产，3 个月免息） | 需要 | 无 `takeLoan`/`repayLoan` | ❌ 未实现 |
| 总资产计算 | 需要 | `calculateNetAssets` 已实现 | ✅ 已实现 |
| 破产判定 | `cash + deposit < 0` | 在 `payMoney`/`transferMoney`/`applyRentPayment` 中已实现 | ✅ 已实现 |
| 破产法拍（3 次） | 需要 | 无 `liquidate`/`forceSellProperty` | ❌ 未实现 |
| 保险天数 | 需要 | `Player.insuranceDays` 已存在 | ✅ 已实现 |

**代码位置**：`packages/backend/src/game/engine.ts`（payMoney、transferMoney、applyRentPayment、calculateNetAssets）

---

## 3. 地图与路径

| 功能 | 设计文档要求 | 当前实现 | 状态 |
|---|---|---|---|
| 40 格可配置路径 | 需要 | `SIMPLE_MAP.path` 为 0-39；`@monopoly4/map-generator` 提供 `DEFAULT_TEMPLATE`、`PLAYER4_TEMPLATE` 等 5 套预设 | ✅ 已实现 |
| 80 格大地图 | 需要 | `MAP80_TEMPLATE` 已落地，人均 1 大地产 + 9 小地产，80 回合点券翻倍 | ✅ 已实现 |
| 大地产占 2 格 | 需要 | `largePropertySpan: 2`，生成器保证连续空位 | ✅ 已实现 |
| 小地产连续分组 | 3-4 个连续 | `smallPropertyGroups` 支持连续分组，默认 3-4 个一组 | ✅ 已实现 |
| 多地图加载 | `MapLoader.load(mapId)` | `loader.ts` 提供 `loadMap`/`saveMap`/`loadMapFromTemplate`/`validateMap` | ✅ 已实现 |
| 2.5D/环形坐标 | `MapUtils.positionOf` | `coords.ts` 提供 `ringLayout`、`gridLayout`、`getTileCenter`、`getTileRect`、`interpolatePosition`、`getTileAtPosition` | ✅ 已实现 |
| 绕圈处理 | `MapUtils.wrapPosition` | `movePlayer` 中用取模实现；`interpolatePosition` 支持跨边界最短路径 | ✅ 已实现 |
| SVG/HTML 渲染 | 需要 | `visualizer.ts` 提供彩色环形/网格棋盘、地块名称、价格、图例 | ✅ 已实现 |
| 角色棋子占位 | 需要 | `renderHtmlMap`/`renderSvgWithTokens` 支持彩色圆形棋子，同格自动错位 | ✅ 已实现 |
| 前端接入 | 需要 | 前端 `board.ts` 已接入 `@monopoly4/map-generator` 的 `ringLayout`/`gridLayout`/`getTileCenter`/`interpolatePosition` 计算坐标与棋子位置 | ✅ 已实现 |

**代码位置**：
- `packages/map-generator/src/generator.ts`（模板与生成）
- `packages/map-generator/src/loader.ts`（加载器）
- `packages/map-generator/src/coords.ts`（坐标工具）
- `packages/map-generator/src/visualizer.ts`（渲染与棋子）
- `packages/map-generator/src/scripts/simulate.ts`（离线模拟与可视化输出）
- `packages/shared/src/index.ts`（SIMPLE_MAP，待迁移）
- `packages/frontend/src/board.ts`（前端棋盘，待接入）

---

## 4. 土地类型

| 类型 | 设计文档要求 | 当前实现 | 状态 |
|---|---|---|---|
| 小块/大块区分 | `Tile.size` | 已添加并标注到 SIMPLE_MAP | ✅ 已实现 |
| 建筑类型字段 | `Tile.buildingType` | 已添加 7 种类型 | ✅ 已实现 |
| 公园 | 不收费、不可升级 | 租金为 0，升级被禁止 | ✅ 已实现 |
| 商场 | 转盘 1-8 倍 | 已修正为 1-8 | ✅ 已实现 |
| 旅馆 | 转盘 1-6 天，访客休息 | 已实现，附加 `hotelRest` | ✅ 已实现 |
| 加油站 | 按步数及交通工具收费 | 已按玩家 `vehicle` 与步数收费 | ✅ 已实现 |
| 研究所 | 按等级制造道具 | 不收租，但无研发逻辑 | ⚠️ 部分实现 |
| 连锁店 | 全地图联合收费 | 已实现 | ✅ 已实现 |
| 系统格类型 | 起点/命运/机会/监狱/医院/商店/税务/卡片格/点券格/新闻/公司等 | 已包含主要类型子集 | ⚠️ 部分实现 |

**代码位置**：`packages/backend/src/game/engine.ts`（calculateRent、rebuildTile）

---

## 5. 土地购买与升级

| 功能 | 设计文档要求 | 当前实现 | 状态 |
|---|---|---|---|
| 空地购买 | `price = basePrice * priceIndex` | `buyProperty` 已实现 | ✅ 已实现 |
| 升级费用 | `basePrice * (level+1) * 0.5 * priceIndex` | `upgradeProperty` 已实现 | ✅ 已实现 |
| 最高 5 级 | 需要 | 已限制 | ✅ 已实现 |
| 连锁店改建 | 改建卡，固定 1 级 | `rebuildTile` + `useCard(rebuild)` 已实现 | ✅ 已实现 |
| 大块土地建筑选择 | 购买后选择建造类型 | 当前默认建住宅，前端有改建按钮 | ⚠️ 临时方案 |
| 建造费用 | basePrice × 建筑系数 | 当前改建免费 | ❌ 未实现 |

**代码位置**：`packages/backend/src/game/engine.ts`（buyProperty、upgradeProperty、rebuildTile）

---

## 6. 过路费

| 功能 | 设计文档要求 | 当前实现 | 状态 |
|---|---|---|---|
| 住宅公式 | 完整公式含 groupBonus | `calculateRent` 已按 size 和 group 计算 | ✅ 已实现 |
| 连锁店公式 | `baseRent * chainStoreCount * priceIndex` | 已实现 | ✅ 已实现 |
| 商场/旅馆/加油站/公园 | 特殊公式 | 已实现 | ✅ 已实现 |
| 神明影响 | 小穷神+50%、大穷神×2、小财神×0.5、大财神免租 | 已实现 | ✅ 已实现 |
| 卡片影响 | 涨价卡/查封卡/同盟卡/免费卡 | 已实现 | ✅ 已实现 |
| 综合计算入口 | `calculateRent(tile, owner, state, visitor)` | 已实现 | ✅ 已实现 |
| 免租判定 | 大财神/同盟/查封/免费卡 | `isRentExempt` 已实现 | ✅ 已实现 |

**代码位置**：`packages/backend/src/game/engine.ts`、`packages/shared/src/data/spirits.ts`
**详细文档**：`docs/design/09-rent-system.md`

---

## 7. 破产与获胜

| 功能 | 设计文档要求 | 当前实现 | 状态 |
|---|---|---|---|
| 破产判定 | `cash + deposit < 0` | 已实现 | ✅ 已实现 |
| 破产法拍（3 次） | 变卖股票/土地 | 已实现（限 3 次，土地回归银行） | ✅ 已实现 |
| 唯一幸存者获胜 | 需要 | `endTurn` 中检查 activePlayers <= 1 | ✅ 已实现 |
| 资金目标胜利 | 首先达到目标资金 | 已实现 | ✅ 已实现 |
| 游戏时间限制 | 时间结束时总资产最高 | 已实现 | ✅ 已实现 |
| 月度结算 | 物价指数、利息、分红、乐透 | 物价指数与存款利息已实现，分红/乐透待扩展 | ⚠️ 部分实现 |

**代码位置**：`packages/backend/src/game/engine.ts`（endTurn、calculatePriceIndex）

---

## 8. 行走与回合

| 功能 | 设计文档要求 | 当前实现 | 状态 |
|---|---|---|---|
| 掷骰 | 选择骰子数后掷骰 | `game:roll` 已支持可选 `diceCount` | ✅ 已实现 |
| 移动阶段 | `moving` 状态 | 当前从 `rolling` 直接进入 `acting` | ❌ 未实现 |
| 经过地块效果 | `onPassTile` | 仅实现起点工资 | ⚠️ 部分实现 |
| 抵达地块效果 | `onArriveTile` | `handleTileEffect` 已实现大部分 | ✅ 已实现 |
| 状态效果递减 | 每天递减 | `decrementEffects` 在跨天时调用 | ✅ 已实现 |
| 月度结算 | 每 30 天 | 物价指数与存款利息已实现 | ⚠️ 部分实现 |
| 检查胜利条件 | 需要 | 资金目标/时间限制/唯一幸存者均已实现 | ✅ 已实现 |

**代码位置**：`packages/backend/src/game/engine.ts`（movePlayer、handleTileEffect、endTurn）

---

## 9. 卡片系统

| 功能 | 设计文档要求 | 当前实现 | 状态 |
|---|---|---|---|
| 卡片定义 | 30 张 | `packages/shared/src/data/cards.ts` 完整定义 | ✅ 已实现 |
| 商店购买 | 点券购买，15 张上限，需在商店格 | `cardSystem.buyCard` 已实现，受 `tile.type === 'shop'` 限制 | ✅ 已实现 |
| 卡片格获得 | 经过获得随机卡片 | `handleTileEffect` 在 `tile.type === 'card'` 时随机发卡 | ✅ 已实现 |
| 使用卡片 | 30 张效果 | `cardSystem/effects.ts` 中 23 张已落地（部分简化），7 张占位 | ⚠️ 部分实现 |
| 出售卡片 | 出售为点券 | `cardSystem.sellCard` 已实现 | ✅ 已实现 |
| 卡片效果注册表 | `CardEffectRegistry` | `CARD_EFFECT_REGISTRY` 已实现于 `cardSystem/effects.ts` | ✅ 已实现 |

**代码位置**：`packages/shared/src/data/cards.ts`、`packages/backend/src/game/cardSystem/`（index.ts、effects.ts）

---

## 10. 道具系统

| 功能 | 设计文档要求 | 当前实现 | 状态 |
|---|---|---|---|
| 道具定义 | 13 种 | `packages/shared/src/data/items.ts` 完整定义 | ✅ 已实现 |
| 商店购买 | 点券购买，堆叠上限 9，需在商店格 | `itemSystem.buyItem` 已实现 | ✅ 已实现 |
| 出售道具 | 出售为点券 | `itemSystem.sellItem` 已实现 | ✅ 已实现 |
| 交通工具 | 机车/汽车改变可选骰子数 | 已落地，装备后替换当前载具 | ✅ 已实现 |
| 陷阱 | 路障/地雷/定时炸弹放置与触发 | 可放置；定时炸弹爆炸/陷阱触发逻辑待完善 | ⚠️ 部分实现 |
| 工具 | 遥控骰子/机器娃娃/飞弹 | 8 种效果已落地（飞弹简化为单格、机器娃娃清前方 10 格） | ⚠️ 部分实现 |
| 研发产物 | 机器人/时光机/传送机/工程车/核子飞弹 | 5 种均未实现 | ❌ 未实现 |
| 道具使用入口 | `useItem` | 已接入 `itemSystem` | ✅ 已实现 |

**代码位置**：`packages/shared/src/data/items.ts`、`packages/backend/src/game/itemSystem/`（index.ts、effects.ts）

---

## 11. 神明附身系统

| 功能 | 设计文档要求 | 当前实现 | 状态 |
|---|---|---|---|
| 神明定义 | 12 主神 | `packages/shared/src/data/spirits.ts` 已定义 | ✅ 已实现 |
| 租金效果 | 小财神/大财神/小穷神/大穷神 | 已实现 | ✅ 已实现 |
| 地图 NPC 生成 | `spawnSpirits` | 已实现 | ✅ 已实现 |
| 请神符寻路 | `summonNearest` | 已实现最近神明查找 | ✅ 已实现 |
| 送神符 | 送走可 dismiss 神明 | 已实现 | ✅ 已实现 |
| 神明变身/消失 | 7 天后变身或消失 | 仅简单 decrement 到 0 消失 | ⚠️ 部分实现 |

**代码位置**：`packages/shared/src/data/spirits.ts`、`packages/backend/src/game/engine.ts`（getSpiritRentMultiplier、useCard summonSpirit/dismissSpirit）

---

## 12. 股票、公司与保险投资

| 功能 | 当前实现 | 状态 |
|---|---|---|
| 股票交易（买/卖/停牌/涨跌幅） | `tradeStock`、`updateStockPrices`、`suspendStock` | ✅ 已实现 |
| 董事长机制 | `updateChairmen` | ✅ 已实现 |
| 公司地块特效（9 家） | `handleCompanyArrival` | ✅ 已实现 |
| 保险强制购买与理赔 | `buyInsurance`、`claimInsurance` | ✅ 已实现 |
| 月度分红 | `dividendPayout` | ✅ 已实现 |
| 复杂轮盘（出国天数/投保天数） | 简单随机转盘 | ⚠️ 部分实现 |
| 骗保策略道具联动 | 道具系统未实现 | ❌ 未实现 |

**代码位置**：`packages/backend/src/game/financialSystem/`、`packages/shared/src/data/companies.ts`
**详细文档**：`docs/design/10-events-finance.md`

---

## 13. 其他系统

| 功能 | 当前实现 | 状态 |
|---|---|---|
| 起点工资 | 已实现（经过起点 +10000） | ✅ 已实现 |
| 命运/机会格 | 使用事件注册表触发命运事件 | ✅ 已实现 |
| 新闻格 | 使用事件注册表触发全局新闻事件 | ✅ 已实现 |
| 公司格 | 9 家公司地块特效 | ✅ 已实现 |
| 税务格 | 固定 -5000 | ⚠️ 临时实现 |
| 卡片格 | 经过随机获得一张卡片 | ✅ 已实现 |
| 得点券格 | 30 点券 | ⚠️ 临时实现 |
| 商店格 | 可购买卡片/道具 | ✅ 已实现 |
| 医院/监狱 | 仅作为普通格，无住院/坐牢逻辑 | ❌ 未实现 |
| 乐透/魔法屋/小游戏 | 未实现 | ❌ 未实现 |
| 特殊 NPC（四大恶人/恶犬/乞丐） | 未实现 | ❌ 未实现 |

**代码位置**：`packages/backend/src/game/engine.ts`（handleTileEffect）

---

## 14. 命运与新闻事件

| 功能 | 当前实现 | 状态 |
|---|---|---|
| 命运/新闻事件注册表 | `FATE_EVENTS`、`NEWS_EVENTS`、`registry.ts` | ✅ 已实现 |
| 事件条件检查 | `conditions.ts` 支持载具/状态/神明 | ✅ 已实现 |
| 事件效果执行 | 效果描述符 + `applyEventOutcome` | ✅ 已实现 |
| 命运/机会格 | `handleTileEffect` 调用 `triggerFateEvent` | ✅ 已实现 |
| 新闻格 | `handleTileEffect` 调用 `triggerNewsEvent` | ✅ 已实现 |
| 神明挡灾/加倍 | 条件框架已具备，具体倍率待细化 | ⚠️ 部分实现 |
| 地图限定事件 | 当前仅 single 地图，条件未启用 | ❌ 未实现 |

**代码位置**：`packages/backend/src/game/eventSystem/`、`packages/backend/src/game/engine.ts`
**详细文档**：`docs/design/10-events-finance.md`

---

## 关键建议

1. **近期优先**：
   - 将 `@monopoly4/map-generator` 接入前端 `board.ts`，替换硬编码 `SIMPLE_MAP`。
   - 使用 `ringLayout` + `interpolatePosition` 实现棋子移动动画。
   - 完善行走阶段（`moving` 状态、经过效果）、卡片与道具剩余占位效果（均富/查税/红黑卡/研发产物等）。
2. **中期目标**：实现土地权限到期（`landLease`、`purchasedAt`、`expiresAt`）、胜利条件完整检查、月度结算（利息、分红）。
3. **长期扩展**：小游戏、神明 NPC 与寻路、特殊 NPC。

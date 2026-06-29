# 04. 游戏规则映射 — 当前实现情况评估

> 评估时间：2026-06-20
> 评估对象：`docs/design/04-game-rules.md` 与当前代码实现
> 当前版本已实现完整的可玩闭环：掷骰、移动、买地、升级、改建、过路费扩展、同组土地加成、30 张卡片/13 种道具、事件/新闻/股票/公司/保险系统、移动阶段、陷阱触发、NPC 解救与移动、医院格特效、土地权限到期、贷款/还款、多地图加载、乐透/魔法屋、神明完整效果（财神/穷神租金、福神买地打折/送卡、衰神买地/商店破坏、天使/恶魔住院入狱天数、土地公守护建筑）、地图神明生成/移动/拾取、土地公/天使 100% 挡灾、破产前 3 次法拍、3 个小游戏接入、胜利条件完整检查、保险骗保联动。近期新增 UI/UX 优化：事件 Banner 弹窗、车辆道具装备/卸下双状态、机器人道具升级/改建分支询问、12 个 emoji 棋子 PNG、地块独立色彩体系与形状区分（property 矩形/大地产跨格、functional 圆形、card/coupon 小矩形）、深色顶部标题栏/所有者标识/等级数字显示、股票持股比例与 10/100 股快捷按钮、股票/道具面板最小高度、NPC/神明地图可视化、传送机目标地块选择。后端测试 398 用例，金融/事件/商店/神明/小游戏/破产法拍/道具/NPC/地图神明等模块覆盖率高。剩余可细化项主要包括 12 名角色的属性差异、地图限定事件、更复杂的前端移动动画与建筑升级特效。

## 总体完成度

| 章节 | 主题 | 完成度 | 说明 |
|---|---|---|---|
| 1 | 开局设置 | 95% | 土地权限/游戏时间/胜利条件/多地图加载/角色颜色均已实现 |
| 2 | 角色属性 | 90% | 现金/储蓄/贷款/点券/股票/保险/总资产计算/破产前 3 次法拍均已实现；12 角色属性差异待补充 |
| 3 | 地图与路径 | 95% | `@monopoly4/map-generator` 已提供多模板、加载器、坐标工具、SVG/HTML 渲染与棋子占位；前端 `board.ts` 已接入坐标工具 |
| 4 | 土地类型 | 88% | 大小块/建筑类型/特殊建筑租金均已落地，新增 `miniGame` 格；前端渲染：property 纯色、functional 浅底加粗描边、顶部标题栏、棋子/指示物避开标题栏 |
| 5 | 土地购买与升级 | 95% | 购买/升级/改建可用；大块地产（占 2 格）支持任意子格购买/升级/改建并同步状态；福神/衰神已影响买地/升级费用；机器人道具支持先选土地再选择升级/改建分支；地块所有者标识与等级数字已在前端渲染 |
| 6 | 过路费 | 95% | 住宅/连锁店/特殊建筑/神明/卡片影响均已实现；同组加成扩展到除连锁店外的所有可收费建筑；前端 tooltip 显示同组数量与加成 |
| 7 | 破产与获胜 | 98% | 破产判定/3 次法拍（股票→土地）/资金目标/时间限制/唯一幸存者/月度结算均已实现 |
| 8 | 行走与回合 | 90% | `moving` 阶段、逐格移动、`onPassTile`/`onArriveTile`/状态递减均已实现 |
| 9 | 卡片系统 | 98% | 30 张效果已全部落地，衰神会破坏商店购买；商店/卡片格/出售均已接入 |
| 10 | 道具系统 | 97% | 13 种效果已全部落地；交通工具道具改为装备/卸下双状态并保留在背包；机器人道具支持选择土地后升级/改建分支；陷阱触发/商店/出售均已接入 |
| 11 | 神明附身系统 | 95% | 12 主神定义、租金效果、福神/衰神/天使/恶魔/土地公完整非租金效果、请神符寻路、到期变身/消失均已实现 |
| 12 | 股票、公司与保险 | 92% | 股票交易/董事长/持股比例显示/公司地块特效/保险购买与理赔/住院自动理赔联动/商场旅馆转盘均已实现 |
| 13 | 其他系统（特殊地点/小游戏/NPC） | 95% | NPC、陷阱触发、医院格特效、乐透/魔法屋、点券格、3 个小游戏（七彩气球/喜从天降/企鹅挖宝）均已实现 |
| 14 | 命运与新闻事件 | 95% | 事件注册表与效果描述符已实现，覆盖主要命运/新闻事件；土地公/天使 100% 挡灾已实现；地图限定待细化 |

---

## 1. 开局设置

| 规则项 | 设计文档要求 | 当前实现 | 状态 |
|---|---|---|---|
| 游戏人数 | 2～4 人 | `Room.maxPlayers` 可配置，创建房间时默认 4 | ✅ 已实现 |
| 角色选择 | 12 名可选角色 | 已扩展为 12 名角色，每名角色拥有唯一颜色，前端角色选择界面以颜色区分并禁用已被选择的角色 | ✅ 已实现 |
| 总资金 | 10000～300000 | `GameConfig.totalFunds` 可用 | ✅ 已实现 |
| 行进方式 | 步行/机车/汽车 | `GameConfig.moveMode` 为 walk/bike/car，载具可通过道具变更 | ✅ 已实现 |
| 土地权限 | 1m/3m/6m/1y/2y/perpetual | 购买时写入 `Tile.purchasedAt/expiresAt`，每日检查并回收到期土地 | ✅ 已实现 |
| 游戏时间 | 1m/3m/6m/1y/2y/perpetual | `GameConfig.gameTime` 已添加并生效 | ✅ 已实现 |
| 胜利条件 | 原资金 3/5/10/50/100 倍 / 无限 / 时间限制 | `endTurn` 中完整检查唯一幸存者、资金目标、时间限制 | ✅ 已实现 |
| 地图 | 台湾/大陆/日本/美国 | `createGame` 已接入 `@monopoly4/map-generator`，支持 simple/default/fast/economy/player4/map80；前端房间创建可选择地图，board.ts 已使用 map-generator 坐标渲染 | ✅ 已实现 |

**代码位置**：`packages/shared/src/index.ts`（GameConfig、SIMPLE_MAP）

---

## 2. 角色属性

| 功能 | 设计文档要求 | 当前实现 | 状态 |
|---|---|---|---|
| 现金/储蓄/贷款/点券字段 | 需要 | `Player.cash/deposit/loan/coupons` 已存在 | ✅ 已实现 |
| 现金变动自动扣存款 | 需要 | `payMoney`、`transferMoney` 已实现现金优先、存款兜底 | ✅ 已实现 |
| 存款利息（每月 10%） | 需要 | 月度结算中已发放 | ✅ 已实现 |
| 贷款（额度=总资产，3 个月免息） | 需要 | 已实现 `takeLoan`/`repayLoan`，额度 = 存款+地产估值+股票市值 - 已贷金额；有贷款期间停发存款利息；3 个月后利息规则简化 | ✅ 已实现 |
| 总资产计算 | 需要 | `calculateNetAssets` 已实现 | ✅ 已实现 |
| 破产判定 | `cash + deposit < 0` | 在 `payMoney`/`transferMoney`/`applyRentPayment` 中已实现 | ✅ 已实现 |
| 破产法拍（3 次） | 需要 | `tryLiquidate` 已实现：资金不足时强制变卖股票，随后最多法拍 3 块土地（按估值从高到低，70% 现价），若仍不足则破产；过路费破产将剩余地产转移给债主，其他情况回归银行 | ✅ 已实现 |
| 保险天数/理赔 | 需要 | 投保、理赔已实现；住院（地雷/定时炸弹/恶犬）自动触发理赔，每次理赔消耗 7 天保险 | ✅ 已实现 |

**代码位置**：`packages/backend/src/game/engine.ts`（payMoney、transferMoney、applyRentPayment、calculateNetAssets）

---

## 3. 地图与路径

| 功能 | 设计文档要求 | 当前实现 | 状态 |
|---|---|---|---|
| 40 格可配置路径 | 需要 | `SIMPLE_MAP.path` 为 0-39；`@monopoly4/map-generator` 提供 `DEFAULT_TEMPLATE`、`PLAYER4_TEMPLATE` 等 5 套预设 | ✅ 已实现 |
| 80 格大地图 | 需要 | `MAP80_TEMPLATE` 已落地，人均 1 大地产 + 9 小地产，80 回合点券翻倍；所有生成模板 `basePriceRange` 已降至原价的 10% | ✅ 已实现 |
| 大地产占 2 格 | 需要 | `largePropertySpan: 2`，生成器保证连续空位 | ✅ 已实现 |
| 地价 | 需要 | `basePrice` 与 `baseRent` 已统一降至原价的 10%，并保持 `baseRent ≈ basePrice × 10%` | ✅ 已实现 |
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
| 空地购买 | `price = basePrice * priceIndex` | `buyProperty` 已实现；小福神 30% 免费、大福神 50% 半价、小衰神 30% 多付 50%、大衰神 50% 失败并扣 10% 手续费 | ✅ 已实现 |
| 升级费用 | `basePrice * (level+1) * 0.5 * priceIndex` | `upgradeProperty` 已实现，同样受福神/衰神影响 | ✅ 已实现 |
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
| 神明影响 | 小穷神+50%、大穷神×2、小财神×0.5、大财神免租；福神经过对手土地随机获卡 | 已实现 | ✅ 已实现 |
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
| 月度结算 | 物价指数、利息、分红、乐透 | 物价指数/存款利息/分红/乐透开奖/胜利条件检查均已实现 | ✅ 已实现 |

**代码位置**：`packages/backend/src/game/engine.ts`（endTurn、calculatePriceIndex）

---

## 8. 行走与回合

| 功能 | 设计文档要求 | 当前实现 | 状态 |
|---|---|---|---|
| 掷骰 | 选择骰子数后掷骰 | `game:roll` 已支持可选 `diceCount` | ✅ 已实现 |
| 移动阶段 | `moving` 状态 | `movePlayer` 改为逐格移动，状态 `rolling→moving→acting` | ✅ 已实现 |
| 经过地块效果 | `onPassTile` | 起点工资、陷阱触发、NPC 同格效果已在逐格移动中触发 | ✅ 已实现 |
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
| 使用卡片 | 30 张效果 | `cardSystem/effects.ts` 中 30 张均已落地（部分简化） | ✅ 已实现 |
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
| 交通工具 | 机车/汽车改变可选骰子数，可装备/卸下 | 已落地；装备后保留在背包并显示“装备中”，卸下恢复步行；被事件摧毁后从背包移除 | ✅ 已实现 |
| 陷阱 | 路障/地雷/定时炸弹放置与触发 | `itemSystem/trapSystem.ts` 已接入 `movePlayer` 逐格触发 | ✅ 已实现 |
| 工具 | 遥控骰子/机器娃娃/飞弹 | 8 种效果已落地（飞弹简化为单格、机器娃娃清前方 10 格） | ⚠️ 部分实现 |
| 研发产物 | 机器人/时光机/传送机/工程车/核子飞弹 | 5 种均已落地；机器人先选土地，满级或改建分支时弹窗询问（AI 自动选择默认分支） | ✅ 已实现 |
| 道具使用入口 | `useItem` | 已接入 `itemSystem` | ✅ 已实现 |

**代码位置**：`packages/shared/src/data/items.ts`、`packages/backend/src/game/itemSystem/`（index.ts、effects.ts）

---

## 11. 神明附身系统

| 功能 | 设计文档要求 | 当前实现 | 状态 |
|---|---|---|---|
| 神明定义 | 12 主神 | `packages/shared/src/data/spirits.ts` 已定义 | ✅ 已实现 |
| 租金效果 | 小财神/大财神/小穷神/大穷神 | 已实现 | ✅ 已实现 |
| 福神效果 | 买地/升级打折或免费；经过对手土地随机获卡 | `applyFortuneCost`、`tryFortuneGodCardOnPass` 已接入 | ✅ 已实现 |
| 衰神效果 | 买地/升级多付费或失败；商店购买被破坏 | `applyFortuneCost`、`tryBlockShopByMisfortune` 已接入 | ✅ 已实现 |
| 天使/恶魔效果 | 住院/入狱天数 -1 / +1 | `adjustStatusDaysBySpirit` 已接入事件、道具、卡片、NPC、魔法屋 | ✅ 已实现 |
| 土地公效果 | 100% 抵挡建筑被破坏/降级 | `tryBlockBuildingDestruction` 已接入拆除卡/怪兽卡/恶魔卡/飞弹/核子飞弹/工程车/定时炸弹/流氓 NPC/外星人事件 | ✅ 已实现 |
| 挡灾 | 拥有土地公/天使时 100% 挡下负面命运/新闻事件 | `triggerFateEvent`/`triggerNewsEvent` 已检查 `isNegative` | ✅ 已实现 |
| 地图神明生成 | `spawnSpirits` | 开局/每月初在地图上随机生成，不会出生在起点/医院/监狱/商店 | ✅ 已实现 |
| 地图神明移动 | `moveSpirits` | 每天沿路径移动 1 格，到期消失 | ✅ 已实现 |
| 地图神明拾取 | `pickUpSpirit` | 玩家经过/抵达有神明的格子时附身 | ✅ 已实现 |
| 请神符寻路 | `summonNearest` | 招来最近地图神明并附身 | ✅ 已实现 |
| 送神符 | 送走可 dismiss 神明 | 已实现 | ✅ 已实现 |
| 神明变身/消失 | 7 天后变身或消失 | 小神/大神互换、天使/恶魔互换已实现；土地公公到期消失 | ✅ 已实现 |

**代码位置**：`packages/shared/src/data/spirits.ts`、`packages/backend/src/game/spiritEffects.ts`、`packages/backend/src/game/engine.ts`、`packages/backend/src/game/eventSystem/index.ts`

---

## 12. 股票、公司与保险投资

| 功能 | 当前实现 | 状态 |
|---|---|---|
| 股票交易（买/卖/停牌/涨跌幅） | `tradeStock`、`updateStockPrices`、`suspendStock`；买入记录加权平均成本价（`stockCostBasis`），前端显示成本价与浮动盈亏 | ✅ 已实现 |
| 仓位 | 每只股票的加权平均买入成本；多次买入按 `(旧成本×旧股数 + 成交价×买入股数) / 总股数` 更新；卖出减仓保留成本，清仓删除 | ✅ 已实现 |
| 持股比例 | 前端股票表新增“持股比例”列，显示 `持有 / 总股本 × 100%`，董事长高亮 | ✅ 已实现 |
| 董事长机制 | 需持有该公司总股本的 **>10%** 才能成为董事长（平局时保留原董事长），`updateChairmen` | ✅ 已实现 |
| 公司地块特效（默认 3 家） | `handleCompanyArrival`；默认保留航空公司/电脑公司/保险公司，占 40 格地图 7.5%，80 格地图 3.75%，<10% | ✅ 已实现 |
| 保险强制购买与理赔 | `buyInsurance`、`claimInsurance` | ✅ 已实现 |
| 月度分红 | `dividendPayout` | ✅ 已实现 |
| 复杂轮盘（出国天数/投保天数） | 航空公司/保险公司转盘已接入；商场 1-8 倍、旅馆 1-6 天已记录 | ✅ 已实现 |
| 骗保策略道具联动 | 住院自动理赔已接入陷阱/NPC；每次理赔消耗 7 天保险防止无限骗保 | ✅ 已实现 |

**代码位置**：`packages/backend/src/game/financialSystem/`、`packages/shared/src/data/companies.ts`
**详细文档**：`docs/design/10-events-finance.md`

---

## 13. 其他系统

| 功能 | 当前实现 | 状态 |
|---|---|---|
| 起点工资 | 已实现（经过起点 +10000） | ✅ 已实现 |
| 命运/机会格 | 使用事件注册表触发命运事件 | ✅ 已实现 |
| 新闻格 | 使用事件注册表触发全局新闻事件 | ✅ 已实现 |
| 公司格 | 默认 3 家公司地块特效（占地图 <10%） | ✅ 已实现 |
| 税务格 | 固定 -5000 | ⚠️ 临时实现 |
| 卡片格 | 经过随机获得一张卡片 | ✅ 已实现 |
| 得点券格 | 30 点券 | ⚠️ 临时实现 |
| 商店格 | 可购买卡片/道具 | ✅ 已实现 |
| 医院格 | 抵达医院时若处于 hospital 状态可提前出院 | ✅ 已实现 |
| 监狱格 | 地图无 prison 格，`jail` 状态仅跳过回合 | ⚠️ 部分实现 |
| 乐透/魔法屋 | 乐透投注/每月 15 日开奖/奖金累积；魔法屋可交换现金、送神、抢卡、禁锢 | ✅ 已实现 |
| 小游戏 | 七彩气球、喜从天降、企鹅挖宝 3 个小游戏已接入；走到 `miniGame` 格进入 `minigame` 阶段，前端自动启动，结束后发送结果并发放点券 | ✅ 已实现 |
| 特殊 NPC（小偷/强盗/流氓/恶犬/乞丐） | `npcSystem/`：开局关押在医院/监狱，玩家可解救；已解救 NPC 每回合移动并触发效果；前端绘制 NPC 图标 | ✅ 已实现 |
| 地图神明可视化 | `board.ts` 绘制神明图标与剩余天数；tooltip 显示神明信息 | ✅ 已实现 |
| 前端事件 Banner | 罚款/获钱/住院/失去载具等事件顶部居中 Banner，4.5 秒自动消失，新消息顶掉旧消息 | ✅ 已实现 |
| 前端棋子渲染 | 12 个 emoji PNG 棋子 + 白色描边，下移避开标题栏，当前回合脉冲环，当前用户加粗白圈 | ✅ 已实现 |
| 前端地块渲染 | property 为圆角矩形、大地产跨格合并绘制；functional 为圆形；card/coupon 为更小矩形；顶部约 28% 深色标题栏显示白色名称；路径线带发光与方向箭头；格子间距按 tileSize 8% 计算 | ✅ 已实现 |
| 前端掷骰 UI | 步行显示单按钮，机车/汽车显示 `掷 1/2/3 颗` 选择按钮 | ✅ 已实现 |
| 股票交易 UI | 显示股价/涨跌/持有/成本/盈亏/持股比例；提供 `10 股 / 100 股` 快捷按钮 | ✅ 已实现 |
| 卡片/道具面板 | Tab 切换网格显示；股票面板最小高度保证可见 2 只股票，道具背包最小高度保证可见 1 行道具；折叠后仍保留预览高度 | ✅ 已实现 |
| 卡片/道具说明 | 每个卡片/道具格子右上角显示 `?` 图标，鼠标悬停显示效果说明 | ✅ 已实现 |
| 传送机目标选择 | 使用传送机时弹出地图目标选择面板，确认后传送到指定地块 | ✅ 已实现 |
| 移动动画 | 逐格移动+停顿；修复停顿阶段棋子弹回上一格的问题，现在在新位置继续下一格移动 | ✅ 已实现 |

**代码位置**：`packages/backend/src/game/engine.ts`（movePlayer、handleTileEffect）、`packages/backend/src/game/itemSystem/trapSystem.ts`、`packages/backend/src/game/npcSystem/index.ts`、`packages/frontend/src/board.ts`、`packages/frontend/src/pages/game.ts`、`packages/frontend/src/ui/common.ts`

---

## 14. 命运与新闻事件

| 功能 | 当前实现 | 状态 |
|---|---|---|
| 命运/新闻事件注册表 | `FATE_EVENTS`、`NEWS_EVENTS`、`registry.ts` | ✅ 已实现 |
| 事件条件检查 | `conditions.ts` 支持载具/状态/神明 | ✅ 已实现 |
| 事件效果执行 | 效果描述符 + `applyEventOutcome` | ✅ 已实现 |
| 命运/机会格 | `handleTileEffect` 调用 `triggerFateEvent` | ✅ 已实现 |
| 新闻格 | `handleTileEffect` 调用 `triggerNewsEvent` | ✅ 已实现 |
| 神明挡灾 | 拥有土地公/天使的玩家 100% 挡下标记为 `isNegative` 的负面命运/新闻事件 | ✅ 已实现 |
| 地图限定事件 | 当前仅 single 地图，条件未启用 | ❌ 未实现 |

**代码位置**：`packages/backend/src/game/eventSystem/`、`packages/backend/src/game/engine.ts`
**详细文档**：`docs/design/10-events-finance.md`

---

## 15. AI 玩家

| 功能 | 当前实现 | 状态 |
|---|---|---|
| 测试模式 AI 机器人 | `game/testMode/aiPlayer.ts`：自动掷骰/买地/升级/解救 NPC | ✅ 已实现 |
| 真实房间添加启发式 AI | `packages/backend/src/ai/aiClient.ts` + `socket/game.ts` 的 `room:addAI` | ✅ 已实现 |
| 真实房间添加 LLM AI | 同上，通过 `createOpencodeAgentBrainFactory` 整回合计划 | ✅ 已实现 |
| AI 自动准备 | AI 客户端加入房间后自动 emit `room:ready` | ✅ 已实现 |
| AI 思考状态广播 | LLM AI 通过 `ai:thinking`/`ai:decided` 向房间内其他玩家广播 | ✅ 已实现 |
| 前端 AI 按钮 | 房间页房主可见「+ 启发式 AI」「+ LLM AI」按钮 | ✅ 已实现 |
| 前端思考提示 | 收到 `ai:thinking` 时顶部 Banner 显示预计等待时间 | ✅ 已实现 |
| AI 与测试模式调度隔离 | `aiClients` Map 跟踪独立 AI 客户端，避免重复执行 | ✅ 已实现 |
| AI 重连/断开清理 | AI 客户端断开时移除跟踪，防内存泄漏 | ⚠️ 基础实现 |
| 12 角色 AI 个性差异 | 当前仅 LLM 使用固定 personality 数组 | ❌ 未实现 |

**代码位置**：`packages/backend/src/ai/aiClient.ts`、`packages/backend/src/socket/game.ts`、`packages/frontend/src/pages/room.ts`、`packages/frontend/src/socket.ts`
**详细文档**：`docs/design/11-automated-playtesting.md`

---

## 关键建议

1. **近期优先**：
   - 补充 12 名角色的属性差异（初始现金、投资偏好、移动能力等）。
   - 更复杂的路段效果、研究院产物研发逻辑。
   - 基于真实玩家房间反馈进一步调校 `rentMultiplier` / `propertyPriceMultiplier` 默认值（参考 `docs/design/13-numerical-design.md`）。
2. **中期目标**：
   - 地图限定事件与神明挡灾/加倍倍率细化。
   - 前端完整动画与特效（移动、建筑升级、破产清算等）。
   - LLM AI 个性策略与长期记忆优化。
3. **长期扩展**：
   - AI 托管与单机对战机器人。
   - 更多地图模板（台湾/大陆/日本/美国主题）。
   - 前端 `board.ts` 完整动画与特效。

## 参考文档

- `docs/design/04-game-rules.md`：完整游戏规则映射。
- `docs/design/09-rent-system.md`：过路费公式与神明/卡片影响。
- `docs/design/10-events-finance.md`：事件、股票、公司、保险系统。
- `docs/design/11-automated-playtesting.md`：自动化对测与 LLM AI 架构。
- `docs/design/13-numerical-design.md`：数值设计思路与平衡框架。

# 命运/新闻事件与股票、公司、保险系统

> 本文档描述大富翁4 Web 版中「命运/新闻事件」与「股票、公司、保险」两大扩展系统的实现。

## 1. 命运与新闻事件

### 1.1 设计目标

- 将原本简化的「命运/机会格随机金钱事件」替换为可注册、可扩展的事件系统。
- 支持条件筛选（载具、神明、状态）。
- 事件效果通过描述符返回，由引擎统一执行，避免事件系统反向依赖引擎。

### 1.2 代码位置

- `packages/backend/src/game/eventSystem/types.ts`：事件类型、效果描述符。
- `packages/backend/src/game/eventSystem/fateEvents.ts`：命运事件定义。
- `packages/backend/src/game/eventSystem/newsEvents.ts`：新闻事件定义。
- `packages/backend/src/game/eventSystem/conditions.ts`：通用条件检查。
- `packages/backend/src/game/eventSystem/registry.ts`：事件注册表与加权随机抽取。
- `packages/backend/src/game/eventSystem/index.ts`：对外入口 `triggerFateEvent` / `triggerNewsEvent`。
- `packages/backend/src/game/engine.ts`：`handleTileEffect` 中调用事件触发，并通过 `applyEventOutcome` 统一执行效果。

### 1.3 已实现事件

**命运事件（走到 fate/chance 格触发）**

| 事件 | 效果 |
|---|---|
| 乱丢垃圾罚款 | 现金 -600 |
| 遗失钱包 | 现金 -1000 |
| 行人闯越马路 | 现金 -3000 |
| 骑机车未戴安全帽 | 现金 -3000（仅机车） |
| 汽车超速 | 现金 -3000（仅汽车） |
| 付保险费 | 现金 -5000 |
| 人头被盗用冒贷 | 贷款 +10000 |
| 股票违约交割 | 强制卖光所有股票 |
| 在路边捡到钱 | 现金 +1000 |
| 发票中奖 | 现金 +4000 |
| 意外获得遗产 | 现金 +10000 |
| 今天是你生日 | 向其他玩家各抽一张卡片 |
| 被外星人绑架 | 住院 3 天 |
| 强迫出国观光 | 出国 3 天 |
| 掉进水沟 | 住院 3 天 |
| 酒醉大闹警局 | 坐牢 3 天 |
| 殴打警员 | 坐牢 5 天 |
| 走私毒品 | 坐牢 7 天 |
| 变卖所有股票求现 | 强制卖光所有股票 |
| 机车被偷遗失 / 汽车撞毁 | 交通工具恢复步行 |

**新闻事件（走到 news 格触发，影响全局）**

| 类别 | 事件示例 | 效果 |
|---|---|---|
| 无责任新闻 | 狱中囚犯延长/释放刑期 | 所有在狱玩家刑期 ±3 / 释放 |
| 路况报导 | 豪雨特报 / 交通阻塞 | 步行/汽车玩家停止一回合 |
| 财经新闻 | 股市全面上涨/崩盘 | 所有股票价格 ±10% |
| 财经新闻 | 银行挤兑 / 加发红利 | 冻结贷款 / 存款红利 |
| 财经新闻 | 公司罚款/海外获利 | 影响指定公司盈亏 |
| 政府公告 | 所得税/地价税/证交税 | 所有玩家按比例缴税 |
| 政府公告 | 公开拍卖/补助/表扬 | 调整地价或发放奖励 |
| 社会/气象 | 外星人攻打地球 | 随机摧毁一处建筑 |

### 1.4 扩展方式

在 `fateEvents.ts` 或 `newsEvents.ts` 中新增事件对象：

```typescript
{
  id: 'new_event',
  name: '新事件',
  description: '说明',
  weight: 5,
  condition: (ctx) => ctx.player.vehicle === 'car',
  apply: (ctx) => ({
    result: { success: true, message: '触发新事件' },
    effects: [{ type: 'cash', amount: -1000, reason: '新事件' }],
  }),
}
```

## 2. 股票、公司与保险

### 2.1 设计目标

- 实现 9 家公司的股票交易、董事长机制、公司地块特效。
- 实现强制保险购买与理赔。
- 与月度结算（利息、分红）联动。

### 2.2 代码位置

- `packages/shared/src/data/companies.ts`：默认 9 家公司与股票配置。
- `packages/backend/src/game/financialSystem/stocks.ts`：股票交易、价格变动、分红、董事长。
- `packages/backend/src/game/financialSystem/companies.ts`：公司地块特效（航空/电脑/保险/汽车/石油/饭店/餐饮/百货/建设）。
- `packages/backend/src/game/financialSystem/insurance.ts`：保险购买与理赔。
- `packages/backend/src/game/financialSystem/index.ts`：统一导出。
- `packages/backend/src/game/engine.ts`：集成到 `createGame`、`handleTileEffect`、`endTurn`。
- `packages/backend/src/socket/game.ts`：`game:stockTrade`、`game:claimInsurance` 事件。

### 2.3 股票系统

- 每家公司对应一只股票，流通股 10000 张。
- 玩家可随时买入/卖出，现金优先、存款兜底。
- 每日收盘后股价随机波动 ±10%。
- 停牌期间不可交易。
- 每月 15 日按公司累计盈余的 10% 分红。
- 持股最多者成为董事长；同股数时保留原董事长。

### 2.4 公司地块特效

| 公司 | 走到地块效果 |
|---|---|
| 航空公司 | 转盘 0-5 天出国，按天数付费；董事长免费 |
| 电脑公司 | 付电脑使用费 500；董事长免费 |
| 保险公司 | 强制投保 5/10/15/20 天，支付保费 |
| 汽车公司 | 有汽车时付保养费 1000；董事长免费 |
| 石油公司 | 有交通工具时付加油费；董事长免费 |
| 饭店 | 付住宿费 2000；董事长获 10 点券 |
| 餐饮公司 | 付餐费 800；董事长获餐补 500 |
| 百货公司 | 付购物费 1000；董事长免费 |
| 建设公司 | 付工程费 1500；董事长免费 |

### 2.5 保险系统

- 踩到保险公司地块强制购买保险，天数由转盘决定。
- 保险有效期内，玩家可申请理赔（住院、踩雷、被狗咬等）。
- 理赔金额与剩余保险天数相关，最高 2 倍基础赔付。
- 理赔后保险天数清零。

### 2.6 月度结算

每月第一天额外执行：

1. 发放存款利息 10%。
2. 发放公司分红。
3. 重新选举董事长。
4. 更新物价指数。

## 3. 前端适配

- `packages/frontend/src/socket.ts`：新增 `tradeStock`、`claimInsurance`、`rebuildTile`、`useCard` 等发送函数。
- `packages/frontend/src/main.ts`：
  - 右侧新增「股市与公司」面板，展示股价、涨跌、持有量、董事长。
  - 玩家信息增加保险天数。
  - 操作区增加改建、使用卡片、申请理赔按钮。
- `packages/frontend/src/board.ts`：新增 `news`（粉色）与 `company`（蓝色）地块颜色。

## 4. 测试

- `packages/backend/src/game/eventsAndFinance.test.ts`：14 个用例覆盖命运/新闻事件、股票交易、公司特效、保险理赔、月度利息。
- `packages/backend/src/game/engine.test.ts`：29 个用例覆盖原有系统，全部通过。

# 大富翁4 测试模式使用说明

## 1. 概述

### 什么是测试模式
测试模式是大富翁4游戏的一个独立调试模块，为开发者和测试人员提供便捷的游戏功能验证环境。通过测试模式，可以快速修改游戏状态、模拟各种游戏场景，而无需完整进行一局游戏。

### 主要用途
- **游戏性功能测试**：验证卡片效果、道具作用、神明影响等游戏机制
- **规则验证**：检查过路费计算、破产判定、胜利条件等核心规则
- **边界条件测试**：测试极端数值、异常状态等边界情况
- **多人游戏模拟**：通过AI玩家模拟多人对局场景

### 设计特点
- **独立模块**：测试模式代码与正常游戏逻辑完全隔离
- **不影响正常流程**：测试模式的修改仅在内存中生效，不持久化到数据库
- **开发环境专用**：仅在开发环境可用，生产环境自动禁用

## 2. 启用方式

测试模式需要**前后端同时启用**才能生效：

### 后端启用
设置环境变量：
```bash
ENABLE_TEST_MODE=true
```

### 前端启用
前端测试面板仅在开发环境（`import.meta.env.DEV`）自动启用，无需手动添加 URL 参数。

### 权限控制
- 只有目标房间的房主才能发送 `test:*` 事件；
- 非房主或测试模式未开启时，服务端会返回 `error` 事件。

### 启用效果
- 游戏页面右侧出现测试控制面板
- 控制面板默认折叠，点击展开
- 面板包含多个功能区域，可独立操作

## 3. 测试面板功能

### A. 玩家数据修改

| 功能 | 说明 | 参数范围 |
|------|------|----------|
| 修改现金 | 设置任意玩家的现金数量 | 0 - 999999999 |
| 修改存款 | 设置任意玩家的存款数量 | 0 - 999999999 |
| 修改贷款 | 设置任意玩家的贷款金额 | 0 - 999999999 |
| 修改点券 | 设置任意玩家的点券数量 | 0 - 999999 |
| 修改位置 | 设置玩家在棋盘上的位置 | 0 - 39 |
| 切换载具 | 改变玩家的移动方式 | 步行/机车/汽车 |
| 设置神明 | 为玩家附加神明效果 | 小财神/大财神/小穷神/大穷神/天使/恶魔 |
| 清除状态 | 移除玩家的所有状态效果 | - |

### B. 全局数据修改

| 功能 | 说明 | 参数范围 |
|------|------|----------|
| 物价指数 | 影响所有过路费和租金的倍数 | 1 - 6 |
| 当前天数 | 修改游戏内的天数 | 1 - 999 |
| 当前月份 | 修改游戏内的月份 | 1 - 999 |

### C. 地块修改

| 功能 | 说明 | 参数范围 |
|------|------|----------|
| 修改地块等级 | 设置任意地块的建筑等级 | 0 - 5 |
| 修改地块所有者 | 改变地块的归属玩家 | 无主/玩家1-4 |

### D. 免费商店

- **功能**：在任意地点打开游戏商店
- **特点**：所有卡片和道具免费获取
- **操作**：点击"打开商店"按钮，选择需要的卡片或道具

### E. AI 玩家模拟

| 功能 | 说明 |
|------|------|
| 启动AI | 开始AI玩家自动行动 |
| 停止AI | 暂停AI玩家行动 |
| 单步执行 | 让AI玩家执行一次行动 |
| 调整间隔 | 设置AI行动的时间间隔（毫秒） |

### F. 快捷操作

| 功能 | 说明 |
|------|------|
| 强制结束回合 | 跳过当前玩家的剩余行动 |
| 一键满金钱 | 将当前玩家现金和存款设为最大值 |
| 一键满点券 | 将当前玩家点券设为最大值 |
| 一键获取所有卡片 | 为当前玩家添加所有类型的卡片 |
| 一键获取所有道具 | 为当前玩家添加所有类型的道具 |
| 重置所有玩家 | 将所有玩家数据恢复到初始状态 |

## 4. Socket 事件列表

测试模式使用 `test:*` 命名空间的所有事件：

| 事件名 | 参数 | 说明 |
|--------|------|------|
| `test:player:cash` | `{ playerId: string, amount: number }` | 修改玩家现金 |
| `test:player:deposit` | `{ playerId: string, amount: number }` | 修改玩家存款 |
| `test:player:loan` | `{ playerId: string, amount: number }` | 修改玩家贷款 |
| `test:player:coupon` | `{ playerId: string, amount: number }` | 修改玩家点券 |
| `test:player:position` | `{ playerId: string, position: number }` | 修改玩家位置 |
| `test:player:vehicle` | `{ playerId: string, vehicle: 'walk' \| 'motor' \| 'car' }` | 切换玩家载具 |
| `test:player:god` | `{ playerId: string, godType: string }` | 设置神明附身 |
| `test:player:clearStatus` | `{ playerId: string }` | 清除玩家状态效果 |
| `test:global:priceIndex` | `{ value: number }` | 修改物价指数 |
| `test:global:day` | `{ value: number }` | 修改当前天数 |
| `test:global:month` | `{ value: number }` | 修改当前月份 |
| `test:land:level` | `{ landId: number, level: number }` | 修改地块等级 |
| `test:land:owner` | `{ landId: number, ownerId: string \| null }` | 修改地块所有者 |
| `test:shop:open` | `{ position?: number }` | 打开免费商店 |
| `test:ai:start` | `{ interval?: number }` | 启动AI玩家 |
| `test:ai:stop` | `{}` | 停止AI玩家 |
| `test:ai:step` | `{}` | AI单步执行 |
| `test:action:endTurn` | `{}` | 强制结束回合 |
| `test:action:maxMoney` | `{ playerId?: string }` | 一键满金钱 |
| `test:action:maxCoupon` | `{ playerId?: string }` | 一键满点券 |
| `test:action:allCards` | `{ playerId?: string }` | 一键获取所有卡片 |
| `test:action:allItems` | `{ playerId?: string }` | 一键获取所有道具 |
| `test:action:resetAll` | `{}` | 重置所有玩家 |

## 5. 后端 API

`packages/backend/src/game/testMode/index.ts` 导出的函数：

| 函数名 | 参数 | 说明 |
|--------|------|------|
| `setPlayerCash(playerId, amount)` | `string, number` | 设置玩家现金 |
| `setPlayerDeposit(playerId, amount)` | `string, number` | 设置玩家存款 |
| `setPlayerLoan(playerId, amount)` | `string, number` | 设置玩家贷款 |
| `setPlayerCoupon(playerId, amount)` | `string, number` | 设置玩家点券 |
| `setPlayerPosition(playerId, position)` | `string, number` | 设置玩家位置 |
| `setPlayerVehicle(playerId, vehicle)` | `string, VehicleType` | 设置玩家载具 |
| `setPlayerGod(playerId, godType)` | `string, GodType` | 设置神明附身 |
| `clearPlayerStatus(playerId)` | `string` | 清除玩家状态效果 |
| `setPriceIndex(value)` | `number` | 设置物价指数 |
| `setGameDay(day)` | `number` | 设置当前天数 |
| `setGameMonth(month)` | `number` | 设置当前月份 |
| `setLandLevel(landId, level)` | `number, number` | 设置地块等级 |
| `setLandOwner(landId, ownerId)` | `number, string \| null` | 设置地块所有者 |
| `openFreeShop(position?)` | `number?` | 打开免费商店 |
| `startAI(interval?)` | `number?` | 启动AI玩家 |
| `stopAI()` | - | 停止AI玩家 |
| `stepAI()` | - | AI单步执行 |
| `forceEndTurn()` | - | 强制结束回合 |
| `maxPlayerMoney(playerId?)` | `string?` | 一键满金钱 |
| `maxPlayerCoupon(playerId?)` | `string?` | 一键满点券 |
| `giveAllCards(playerId?)` | `string?` | 一键获取所有卡片 |
| `giveAllItems(playerId?)` | `string?` | 一键获取所有道具 |
| `resetAllPlayers()` | - | 重置所有玩家 |

## 6. AI 玩家行为说明

### AI 决策逻辑
AI玩家采用简单的无脑策略：
1. **掷骰子**：自动掷骰，根据点数移动
2. **移动**：按点数移动到目标位置
3. **买地**：如果到达无主土地，自动购买
4. **升级**：如果到达自己的土地，自动升级（如果资金足够）
5. **结束回合**：完成上述操作后自动结束回合

### 启动与停止
- **启动**：点击"启动AI"按钮，或发送 `test:ai:start` 事件
- **停止**：点击"停止AI"按钮，或发送 `test:ai:stop` 事件
- **单步**：点击"单步执行"按钮，或发送 `test:ai:step` 事件

### 配置选项
- **行动间隔**：AI两次行动之间的等待时间（毫秒），默认1000ms
- **最大回合数**：AI自动行动的最大回合数，防止无限循环，默认100回合

### 注意事项
- AI玩家不会使用卡片或道具
- AI玩家不会进行交易
- AI玩家不会主动结束游戏（除非破产）
- AI行为简单，仅用于测试，不代表真实游戏体验

## 7. 文件结构

```
packages/backend/src/game/testMode/
├── index.ts      # 测试模式核心 API
├── aiPlayer.ts   # AI 玩家模拟
└── types.ts      # 类型定义

packages/frontend/src/testMode/
├── index.ts      # 测试模式入口
├── panel.ts      # 测试控制面板 UI
└── socket.ts     # Socket 封装
```

### 后端文件说明

**index.ts**
- 导出所有测试模式API函数
- 处理Socket事件监听
- 调用游戏引擎修改游戏状态

**aiPlayer.ts**
- 实现AI玩家决策逻辑
- 管理AI玩家的行动队列
- 控制AI行动的启停和间隔

**types.ts**
- 定义测试模式相关的TypeScript类型
- 包括事件参数类型、配置选项类型等

### 前端文件说明

**index.ts**
- 测试模式的初始化入口
- 检测URL参数或界面按钮点击
- 控制测试面板的显示/隐藏

**panel.ts**
- 测试控制面板的UI组件
- 处理用户交互和表单输入
- 发送Socket事件到后端

**socket.ts**
- 封装测试模式的Socket通信
- 处理事件发送和响应监听
- 提供类型安全的API

## 8. 使用示例

### 示例1：测试过路费计算
**目标**：验证不同物价指数和地块等级下的过路费计算

**步骤**：
1. 启用测试模式，进入游戏
2. 在测试面板中，设置物价指数为3
3. 选择一块土地，设置等级为5
4. 设置地块所有者为玩家2
5. 将玩家1移动到该地块位置
6. 观察过路费是否正确计算（应为：基础租金 × 3（物价指数）× 等级系数）

### 示例2：测试卡片效果
**目标**：验证"涨价卡"对整条路段的影响

**步骤**：
1. 启用测试模式，进入游戏
2. 点击"打开商店"，获取"涨价卡"
3. 使用涨价卡，选择目标路段
4. 检查该路段所有地块的租金是否翻倍
5. 等待卡片效果持续时间结束，验证租金是否恢复

### 示例3：测试破产流程
**目标**：验证玩家破产的判定和处理

**步骤**：
1. 启用测试模式，进入游戏
2. 选择玩家1，将现金设为0，存款设为0
3. 将玩家1移动到其他玩家的高级地块
4. 观察系统是否判定玩家1破产
5. 验证破产玩家的资产是否被正确处理

### 示例4：测试载具系统
**目标**：验证不同载具的骰子数量

**步骤**：
1. 启用测试模式，进入游戏
2. 将玩家1的载具设为"步行"（1颗骰子）
3. 掷骰子，观察是否只掷1颗
4. 切换载具为"机车"（2颗骰子）
5. 掷骰子，观察是否掷2颗
6. 切换载具为"汽车"（3颗骰子）
7. 掷骰子，观察是否掷3颗

### 示例5：多人模拟
**目标**：模拟4人对局，观察游戏平衡性

**步骤**：
1. 启用测试模式，进入游戏
2. 启动3个AI玩家（间隔设为500ms）
3. 观察AI玩家的自动对局
4. 记录每个玩家的资产变化
5. 观察游戏何时结束（破产或达到胜利条件）
6. 分析游戏平衡性（是否存在过强或过弱的策略）

## 9. 注意事项

### 环境限制
- **仅限开发环境**：测试模式仅在开发环境可用，生产环境自动禁用
- **本地测试**：建议在本地环境进行测试，避免影响线上用户

### 数据持久化
- **内存中修改**：测试模式的所有修改仅在内存中生效
- **不保存到数据库**：游戏刷新或重新连接后，修改将丢失
- **不影响存档**：测试模式不会影响游戏的正常存档功能

### AI玩家限制
- **简单策略**：AI玩家采用无脑买地策略，不代表真实游戏体验
- **无高级行为**：AI不会使用卡片、道具或进行交易
- **仅供测试**：AI玩家仅用于快速模拟，不用于平衡性验证

### 隔离性
- **代码隔离**：测试模式代码与正常游戏逻辑完全隔离
- **不影响生产**：测试模式的修改不会影响生产环境的正常运行
- **独立模块**：可以随时禁用或移除测试模式，而不影响游戏核心功能

### 安全建议
- **不要在线上环境启用**：生产环境务必将 `ENABLE_TEST_MODE` 保持为 `false`；
- **后端校验**：所有 `test:*` 事件已增加房主权限校验，无法被普通玩家利用；
- **CORS 限制**：生产环境应设置 `ALLOWED_ORIGINS` 为前端域名，禁止跨域连接；
- **JWT 密钥**：生产环境必须设置强随机的 `JWT_SECRET`，不要使用默认密钥；
- **定期清理**：测试完成后，及时关闭测试模式

---

**文档版本**：v1.0  
**最后更新**：2026年6月19日  
**维护者**：大富翁4开发团队
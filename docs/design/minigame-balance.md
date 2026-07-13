# 小游戏平衡设计文档

> 本文档记录《大富翁4》Web 复刻版中三个小游戏（七彩气球、喜从天降、企鹅挖宝）的平衡设计思路、标定方法与当前参数。
>
> 最近更新：2026-07-13（基于实际模拟器标定结果更新）

## 1. 设计背景与上下文

小游戏是玩家在对局中获得点券（coupons）的重要途径。点券可用于商店购买道具（路障、遥控骰子、机车、飞弹等），因此小游戏的收益直接影响游戏经济平衡。

在本次迭代前，三个小游戏的点券收益差异较大：

- 七彩气球：依赖点击速度与精准度，高分玩家收益极高。
- 喜从天降：接物玩法，随机性较大，休闲玩家收益偏低。
- 企鹅挖宝：已改为记忆挖宝，但随机点击收益过高，需要点击冷却限制。

为了让不同操作水平的玩家都能获得稳定、可预期的点券收益，并保证三个小游戏之间的收益相对一致，我们引入了一套基于「随机玩家模拟」的平衡标定机制。

## 2. 设计目标

1. **收益一致**：三个小游戏在「随机玩家」操作下的期望点券收益应接近同一目标值。
2. **购买能力**：该目标值应至少能在商店购买 1.5 件普通道具。
3. **操作友好**：企鹅挖宝增加点击冷却，避免高点击频率玩家获得过高收益。
4. **动态标定**：支持根据用户在前两个游戏中的实际表现，自动标定第三个游戏。

## 3. 商店道具价格参考

```ts
// packages/shared/src/data/items.ts
机器娃娃  15
地雷      25
定时炸弹  25
路障      30
遥控骰子  30
机车      80
飞弹      100
汽车      150
```

普通道具（路障/遥控骰子级别）价格约 30 点券。因此 1.5 件普通道具约 45 点券。本设计将随机玩家目标期望点券定为 **60**，约等于 2 个遥控骰子，满足「至少购买 1.5 件普通道具」的要求。

> 注：60 点券是「随机点击 / 随机接取」基准玩家的期望收益。熟练玩家通过精准操作可以获得更高收益，但三个小游戏之间的相对收益应保持接近。

## 4. 三个小游戏机制概要

### 4.1 七彩气球

- 30 秒内点击气球得分。
- 普通气球：**半径越小分值越高、速度越快**（+2 ~ +3），增加挑战性。
- 双倍气球：×2，按基础分加分。
- 问号气球：预显示具体效果（+10 / -5 / 加速 / 减速 / -5s），**已移除清零效果**。
- 气球从屏幕中间区域生成，向上飘动。
- 生成间隔 750ms，普通气球基础速度 1.8 像素/帧。

### 4.2 喜从天降

- 30 秒内控制底部平台接住掉落物。
- 宝箱/金/银/玉币：加分（宝箱 80、金 40、银 20、玉币 4），**得分道具均不使用红色/黑色**。
- 时钟：白底蓝色时钟，触发 5 秒慢动作，掉落物减速、倒计时减半，平台移动不受影响。
- 红色刺球 / 黑色炸弹：**红黑配色扣分道具**（刺球 -20、炸弹 -40）。

### 4.3 企鹅挖宝

- 8×12 = 96 格雪地网格（较早期版本扩展四倍）。
- 开局显示宝藏与炸弹位置 3 秒，随后隐藏。
- 玩家凭记忆点击格子挖掘。
- 每次挖掘有 500ms 冷却，限制总点击次数。
- 钻石/金块/宝石加分（钻石 7、金块 3、蓝宝石 2、黄玉 2、冰块 1），**红宝石已改为橙色黄玉以避免与黑红炸弹混淆**；炸弹扣分（-5），空挖不加分。

## 5. 平衡标定方法

### 5.1 随机玩家模拟器

文件：`packages/frontend/src/minigames/balance/simulator.ts`

用蒙特卡洛方法模拟一个「随机但合理」的玩家在三个游戏中的表现：

- 七彩气球：每 400ms 尝试点击一次，80% 概率瞄准随机气球（带小偏移），命中概率 70%。
- 喜从天降：平台 70% 注意力追踪最近掉落物，30% 随机移动，最大速度为上限的 85%。
- 企鹅挖宝：在 96 格中随机挖掘，受 500ms 冷却限制。

运行命令：

```bash
npx tsx packages/frontend/src/minigames/balance/run-simulator.ts
```

### 5.2 玩家过程指标

为让标定更贴近真实玩家操作，三个小游戏在结算时都会返回 `MiniGameMetrics`：

| 指标 | 来源 | 用途 |
|------|------|------|
| `clickCount` / `hitCount` / `accuracy` | 三游戏通用 | 统计操作次数与命中率 |
| `avgMouseSpeed` | 七彩气球 | 鼠标移动速度（px/ms），反映操作活跃程度 |
| `avgTimeBetweenClicks` | 七彩气球 / 企鹅挖宝 | 平均点击间隔，推断玩家连点频率 |
| `avgBalloonSwitchTime` | 七彩气球 | 连续命中两个气球的切换时间 |
| `avgReactionTime` | 七彩气球 | 气球生成到被命中的反应时间 |
| `avgPlatformSpeed` | 喜从天降 | 接物平台平均移动速度 |
| `directionChangesPerSec` | 喜从天降 | 每秒改变移动方向次数 |
| `screenCoverageRatio` | 喜从天降 | 平台覆盖屏幕宽度比例 |
| `catchRate` | 喜从天降 | 接住数 / 总生成数 |

标定器 `calibratePenguinDig` 会读取气球的 `avgTimeBetweenClicks` 与 `accuracy`、喜从天降的 `catchRate`，推算企鹅挖宝的推荐点击冷却。命中率低或接取率低的玩家会得到更宽松的冷却，避免误触过多；高频精准玩家则冷却更短、挑战性更高。

### 5.4 当前模拟结果

```
balloon:    平均点券=58.2, 标准差=13.4, 范围=[14, 110], 平均操作=74.0, 平均命中=26.4
luckyDrop:  平均点券=62.5, 标准差=65.6, 范围=[0, 328], 平均操作=24.7, 平均命中=22.2
penguinDig: 平均点券=59.5, 标准差=25.2, 范围=[0, 129], 平均操作=54.0, 平均命中=54.0
```

三个游戏的随机玩家期望点券均在 **60 左右**（三游戏平均 60.1），达到设计目标。

### 5.5 标定参数文件

所有游戏的得分/概率参数集中在：

```
packages/frontend/src/minigames/balance/config.ts
```

关键参数：

```ts
TARGET_RANDOM_COUPONS = 60;

// 气球：越小分越高、越快；已移除清零效果
BALLOON_CONFIG.radiusScoreOffset = 44;         // score = round((offset - radius) / step)
BALLOON_CONFIG.radiusScoreStep = 8;            // 普通气球 +2~+3
BALLOON_CONFIG.normalBaseSpeed = 1.8;          // 基础速度，高分气球更快
BALLOON_CONFIG.spawnIntervalMs = 750;          // 生成间隔

// 喜从天降：得分道具非红黑，扣分道具红黑
LUCKY_DROP_CONFIG.items = [
  { kind: 'chest',  probability: 0.008, value: 80 },
  { kind: 'gold',   probability: 0.10,  value: 40 },
  { kind: 'silver', probability: 0.28,  value: 20 },
  { kind: 'coin',   probability: 0.48,  value: 4 },   // 青色玉币
  { kind: 'clock',  probability: 0.58,  value: 0, slowMotionMs: 5000 },
  { kind: 'spike',  probability: 0.76,  value: -20 }, // 红色刺球
  { kind: 'bomb',   probability: 1.0,   value: -40 }, // 黑色炸弹
];

// 企鹅挖宝：红宝石改为橙色黄玉，避免与黑红炸弹混淆
PENGUIN_DIG_CONFIG.digCooldownMs = 500;
PENGUIN_DIG_CONFIG.items = [
  { type: 'diamond', score: 7, weight: 5 },
  { type: 'gold',    score: 3, weight: 10 },
  { type: 'sapphire',score: 2, weight: 15 },
  { type: 'ruby',    score: 2, weight: 15 }, // 实际绘制为橙色黄玉
  { type: 'ice',     score: 1, weight: 30 },
  { type: 'bomb',    score: -5, weight: 12 },
];
```

## 6. 用户标定流程

文件：`packages/frontend/src/test-minigames.ts`

测试页增加了「🧪 开始标定测试」按钮，流程如下：

1. 用户先玩 **七彩气球**，结算时返回鼠标速度、点击间隔、命中率等指标。
2. 用户再玩 **喜从天降**，结算时返回平台速度、接取率、方向变化频率等指标。
3. 系统根据前两局的点券收益与过程指标计算用户基准期望。
4. 调用 `calibratePenguinDig()` 反推企鹅挖宝的推荐冷却与宝藏分值倍率。
5. 用户玩 **企鹅挖宝**，游戏自动应用标定参数。
6. 页面显示完整标定报告与过程指标，验证三局点券是否接近。

标定公式：

```ts
baselineCoupons = (balloonCoupons + luckyDropCoupons) / 2;

// 根据气球点击间隔与命中率推断玩家真实点击频率
estimatedClickInterval = balloonAvgTimeBetweenClicks * (1 + (1 - balloonAccuracy) * 0.5) * (1 - (catchRate - 0.5) * 0.2);
recommendedCooldownMs = clamp(estimatedClickInterval, 200, 1200);

// 反推宝藏分值倍率，使期望点券 ≈ baselineCoupons
recommendedScoreMultiplier = baselineCoupons / ((durationMs - memorizeMs) / recommendedCooldownMs * expectedScorePerDig);
```

示例输出（目标基准 60 点券）：

```
用户基准期望点券: 60
参考指标：气球点击间隔 380ms，命中率 65%，喜从天降接取率 55%
推荐企鹅挖宝点击冷却: 500ms（预计可点击 54 次）
推荐企鹅挖宝宝藏分值倍率: ×1.02
标定后随机玩家期望点券: 60
```

## 7. 当前上下文与设计讨论

本次迭代源于对小游戏测试的反馈，核心诉求包括：

1. **点券收益一致性**：三个小游戏在相同操作水平下的期望点券应接近，避免某个游戏明显更优。
2. **购买能力下限**：随机玩家完成一次小游戏后，应至少能在商店购买 1.5 件普通道具。
3. **企鹅挖宝限制**：增加点击冷却，防止高点击频率玩家获得过高收益，同时保留记忆玩法。
4. **动态标定**：通过玩家在前两个游戏中的实际表现，自动标定第三个游戏，使不同操作风格的玩家都能获得一致收益。

实现时先建立「随机玩家模拟器」作为基准，再调整游戏参数使三游戏期望点券收敛到 60 左右。模拟器假设玩家：

- 七彩气球：能看到气球并大致瞄准点击，但仍有明显失误。
- 喜从天降：主要追踪最近掉落物，但会分心或反应不及时。
- 企鹅挖宝：随机挖掘，受冷却限制。

该基准不代表高手表现，但能保证休闲玩家收益稳定。

## 8. 后续可优化点

- 精确统计用户真实点击次数与操作速度，替代当前的经验默认值。
- 增加更多难度档位（新手/普通/高手），让不同水平玩家都有合适的挑战与收益。
- 根据对局阶段动态调整小游戏收益，避免前期点券过多影响平衡。

## 9. 相关文件

- `packages/frontend/src/minigames/balloon.ts`
- `packages/frontend/src/minigames/luckyDrop.ts`
- `packages/frontend/src/minigames/penguinDig.ts`
- `packages/frontend/src/minigames/manager.ts`
- `packages/frontend/src/minigames/balance/config.ts`
- `packages/frontend/src/minigames/balance/simulator.ts`
- `packages/frontend/src/minigames/balance/calibrator.ts`
- `packages/frontend/src/test-minigames.ts`
- `packages/frontend/test-minigames.html`

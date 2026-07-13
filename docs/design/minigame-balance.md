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

普通道具（路障/遥控骰子级别）价格约 30 点券。本次标定后随机玩家均值达到 **100+**，可购买 3 件以上普通道具，收益更有感。

> 注：100+ 点券是「随机点击 / 随机接取」基准玩家的期望收益。熟练玩家通过精准操作可以获得更高收益，但三个小游戏之间的相对收益应保持接近。

## 4. 三个小游戏机制概要

### 4.1 七彩气球

- 30 秒内点击气球得分。
- 普通气球：**半径越小分值越高、速度越快**（+3 ~ +5）；颜色也按分值区分（红=+5 最小最快、橙=+4、绿=+3 最大最慢），尺寸与收益一目了然。
- 双倍气球：显示实际总得分 `+score×2`，按基础分翻倍加分。
- 问号气球：预显示具体效果（+10 / -5 / 加速 / 减速 / -5s），**已移除清零效果**；其中**沙漏时间效果使用琥珀色**，与紫色问号、红橙加速、蓝青减速区分。
- **点击判定范围扩大到 1.5 倍气球半径**，提升操作容错率，减少点不中。
- **开场 2.5 秒从屏幕中部生成，之后从底部刷新**，给玩家适应时间。
- **加速气球为红橙色，减速气球为蓝青色**。
- 生成间隔 650ms，普通气球基础速度 1.8 像素/帧。

### 4.2 喜从天降

- **20 秒内**控制底部平台接住掉落物（因存在时钟减速，总时长缩短）。
- 宝箱/金/银/玉币：加分（宝箱 165、金 83、银 39、玉币 9），**得分道具均不使用红色/黑色**。
- 时钟：白底蓝色时钟，触发 5 秒慢动作，掉落物减速、倒计时减半，平台移动不受影响。
- 红色刺球 / 黑色炸弹：**红黑配色扣分道具**（刺球 -35、炸弹 -70）。
- 难度曲线倍率进一步下调至 **0.6**，末端速度约为初始的 1.6 倍，避免后期仍然过快。

### 4.3 企鹅挖宝

- **7×10 = 70 格雪地网格**，较之前 8×12 减少约 27%，单格更大、操作更从容。
- **游戏时长 25 秒**（含 3 秒记忆阶段），节奏更紧凑。
- 玩家凭记忆点击格子挖掘。
- 每次挖掘有 500ms 冷却，限制总点击次数。
- 钻石/金块/宝石加分（钻石 15、金块 7、蓝宝石 5、翡翠 5、冰块 2），**原红宝石已改为绿色翡翠以与黑红炸弹彻底区分**；炸弹扣分（-11），空挖不加分。

## 5. 平衡标定方法

### 5.1 随机玩家模拟器

文件：`packages/frontend/src/minigames/balance/simulator.ts`

用蒙特卡洛方法模拟一个「随机但合理」的玩家在三个游戏中的表现：

- 七彩气球：每 400ms 尝试点击一次，80% 概率瞄准随机气球（带小偏移），命中概率 70%。
- 喜从天降：平台 70% 注意力追踪最近掉落物，30% 随机移动，最大速度为上限的 85%。
- 企鹅挖宝：在 70 格中随机挖掘，受 500ms 冷却限制。

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

标定器 `calibratePenguinDig` 会读取气球的 `avgTimeBetweenClicks` 与 `accuracy`、喜从天降的 `catchRate`，推算企鹅挖宝的推荐点击冷却。命中率低或接取率低的玩家会得到更宽松的冷却，避免误触过多；高频精准玩家则冷却更短、挑战性更高。用户完成标定流程后，这些指标会随 `baseline` 一起存入 `localStorage`，供后续读取、导出与命令行复现。

### 5.4 当前模拟结果

```
balloon:    平均点券=104.7, 标准差=18.3, 范围=[41, 179], 平均操作=74.0, 平均命中=27.5
luckyDrop:  平均点券=111.9, 标准差=110.0, 范围=[0, 500], 平均操作=14.2, 平均命中=12.8
penguinDig: 平均点券=110.6, 标准差=52.0, 范围=[0, 288], 平均操作=44.0, 平均命中=44.0
```

三个游戏的随机玩家期望点券均在 **100+**（三游戏平均 109.1），达到设计目标。若使用 `run-calibrator.ts` 基于默认模拟结果做一次示例标定，再用标定参数仿真验证，三游戏平均点券可收敛到约 **110**。

### 5.5 标定参数文件

所有游戏的得分/概率参数集中在：

```
packages/frontend/src/minigames/balance/config.ts
```

关键参数：

```ts
TARGET_RANDOM_COUPONS = 110;

// 气球：越小分越高、越快；普通气球颜色按分值区分（红 +5 / 橙 +4 / 绿 +3）
BALLOON_CONFIG.radiusScoreOffset = 52;         // score = round((offset - radius) / step)
BALLOON_CONFIG.radiusScoreStep = 6;            // 普通气球 +3~+5
BALLOON_CONFIG.normalBaseSpeed = 1.8;          // 基础速度，高分气球更快
BALLOON_CONFIG.spawnIntervalMs = 650;          // 生成间隔
BALLOON_CONFIG.introDurationMs = 2500;         // 开场 2.5s 从屏幕中部生成
BALLOON_CONFIG.introSpawnHeightRatio = { min: 0.4, max: 0.7 };
BALLOON_CONFIG.mainSpawnHeightRatio = { min: 0.85, max: 0.95 };
BALLOON_CONFIG.speedUpColor = '#ff5722';       // 红橙：加速
BALLOON_CONFIG.slowDownColor = '#00bcd4';      // 蓝青：减速
BALLOON_CONFIG.mysteryEffects = [
  { label: '+10', color: '#2ecc71', ... },
  { label: '-5',  color: '#e74c3c', ... },
  { label: '▲',   color: '#ff5722', ... }, // 加速
  { label: '▼',   color: '#00bcd4', ... }, // 减速
  { label: '⏳',  color: '#ff9800', ... }, // 时间：琥珀色，与紫色问号区分
];

// 喜从天降：得分道具非红黑，扣分道具红黑；总时长缩短、速度曲线进一步下调
LUCKY_DROP_CONFIG.duration = 20000;
LUCKY_DROP_CONFIG.speedCurveMultiplier = 0.6; // 末端速度约 1.6 倍
LUCKY_DROP_CONFIG.items = [
  { kind: 'chest',  probability: 0.008, value: 165 },
  { kind: 'gold',   probability: 0.10,  value: 83 },
  { kind: 'silver', probability: 0.28,  value: 39 },
  { kind: 'coin',   probability: 0.48,  value: 9 },    // 青色玉币
  { kind: 'clock',  probability: 0.58,  value: 0, slowMotionMs: 5000 },
  { kind: 'spike',  probability: 0.76,  value: -35 },  // 红色刺球
  { kind: 'bomb',   probability: 1.0,   value: -70 },  // 黑色炸弹
];

// 企鹅挖宝：7×10 = 70 格，时长 25s；原红宝石改为绿色翡翠
PENGUIN_DIG_CONFIG.duration = 25000;
PENGUIN_DIG_CONFIG.cols = 7;
PENGUIN_DIG_CONFIG.rows = 10;
PENGUIN_DIG_CONFIG.digCooldownMs = 500;
PENGUIN_DIG_CONFIG.items = [
  { type: 'diamond',  score: 15, weight: 5 },
  { type: 'gold',     score: 7,  weight: 10 },
  { type: 'sapphire', score: 5,  weight: 15 },
  { type: 'ruby',     score: 5,  weight: 15 }, // 实际绘制为绿色翡翠
  { type: 'ice',      score: 2,  weight: 30 },
  { type: 'bomb',     score: -11, weight: 12 },
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
6. 标定结果通过 `saveCalibration()` 写入 `localStorage`，刷新页面后仍可通过 `loadCalibration()` 读取并自动应用到手动启动的企鹅挖宝。
7. 页面显示完整标定报告与过程指标，并可点击「导出标定 JSON」将完整记录（含用户点券、命中率、鼠标速度、接取率等）下载为文件。
8. 导出的 JSON 可通过命令行模拟器读取，复现该用户的标定结果并影响仿真结果。确保在项目根目录执行：

   ```bash
   # 默认随机玩家模拟
   npm run sim:minigame

   # 使用用户真实标定记录复现
   npm run sim:minigame -- --calibration ./calibration-xxx.json

   # 基于默认模拟结果做一次示例标定
   npm run calibrate:minigame
   ```

标定公式（与 `calibrator.ts` 一致）：

```ts
baselineCoupons = (balloonCoupons + luckyDropCoupons) / 2;

// 根据气球点击间隔与命中率推断玩家真实点击频率
estimatedClickInterval = balloonAvgTimeBetweenClicks
  * (1 + (1 - balloonAccuracy) * 0.5)    // 命中率低则增加冷却，避免误触
  * (1 - (catchRate - 0.5) * 0.2);       // 接取率高则降低冷却
recommendedCooldownMs = clamp(estimatedClickInterval, 200, 1200);

// 反推宝藏分值倍率，使期望点券 ≈ baselineCoupons
recommendedScoreMultiplier = baselineCoupons / ((durationMs - memorizeMs) / recommendedCooldownMs * expectedScorePerDig);
```

示例输出（目标基准 110 点券）：

```
用户基准期望点券: 110
推荐企鹅挖宝点击冷却: 500ms
推荐企鹅挖宝宝藏分值倍率: ×0.96
标定后随机玩家期望点券: 110
```

持久化文件：`packages/frontend/src/minigames/balance/storage.ts`

## 7. 当前上下文与设计讨论

本次迭代源于对小游戏测试的反馈，核心诉求包括：

1. **点券收益一致性**：三个小游戏在相同操作水平下的期望点券应接近，避免某个游戏明显更优。
2. **购买能力下限**：随机玩家完成一次小游戏后，应至少能在商店购买 1.5 件普通道具。
3. **企鹅挖宝限制**：增加点击冷却，防止高点击频率玩家获得过高收益，同时保留记忆玩法。
4. **动态标定**：通过玩家在前两个游戏中的实际表现，自动标定第三个游戏，使不同操作风格的玩家都能获得一致收益。

实现时先建立「随机玩家模拟器」作为基准，再调整游戏参数使三游戏期望点券收敛到 110 左右。模拟器假设玩家：

- 七彩气球：能看到气球并大致瞄准点击，但仍有明显失误。
- 喜从天降：主要追踪最近掉落物，但会分心或反应不及时。
- 企鹅挖宝：随机挖掘，受冷却限制。

该基准不代表高手表现，但能保证休闲玩家收益稳定。

## 8. 后续可优化点

- 根据用户真实标定数据进一步微调分值倍率与冷却档位。
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
- `packages/frontend/src/minigames/balance/storage.ts`
- `packages/frontend/src/minigames/index.ts`
- `packages/frontend/src/test-minigames.ts`
- `packages/frontend/test-minigames.html`

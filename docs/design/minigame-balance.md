# 小游戏平衡设计文档

> 本文档记录《大富翁4》Web 复刻版中三个小游戏（七彩气球、喜从天降、企鹅挖宝）的平衡设计思路、标定方法与当前参数。
>
> 最近更新：2026-07-14（新增三游戏个性化得分倍率与旧标定文件兼容）

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
- 生成间隔 **433ms**（约为原来的 1.5 倍密度），普通气球基础速度 1.8 像素/帧。

### 4.2 喜从天降

- **20 秒内**控制底部平台接住掉落物（因存在时钟减速，总时长缩短）。
- 宝箱/金/银/玉币：加分（宝箱 35、金 17、银 8、玉币 2），**得分道具均不使用红色/黑色**。分值已根据最新用户标定结果（luckyDropScoreMultiplier ≈ 0.21）等比例下调，使该用户最终点券接近目标 100。
- 时钟：白底蓝色时钟，触发 5 秒慢动作，掉落物减速、倒计时减半，平台移动不受影响。
- 红色刺球 / 黑色炸弹：**红黑配色扣分道具**（刺球 -7、炸弹 -15）。
- 难度曲线倍率进一步下调至 **0.6**，末端速度约为初始的 1.6 倍，避免后期仍然过快。

### 4.3 企鹅挖宝

- **7×10 = 70 格雪地网格**，较之前 8×12 减少约 27%，单格更大、操作更从容。
- **游戏时长 20 秒**（含 3 秒记忆阶段），节奏更紧凑。
- 玩家凭记忆点击格子挖掘。
- 每次挖掘有 **300ms 冷却**（0.3s），限制总点击次数。
- 钻石/金块/宝石加分（钻石 15、金块 7、蓝宝石 5、翡翠 5、冰块 2），**原红宝石已改为绿色翡翠以与黑红炸弹彻底区分**；炸弹扣分（-11），空挖不加分。

## 5. 平衡标定方法

### 5.1 随机玩家模拟器

文件：`packages/frontend/src/minigames/balance/simulator.ts`

用蒙特卡洛方法模拟一个「随机但合理」的玩家在三个游戏中的表现：

- 七彩气球：每 400ms 尝试点击一次，80% 概率瞄准随机气球（带小偏移），命中概率 70%。
- 喜从天降：平台 70% 注意力追踪最近掉落物，30% 随机移动，最大速度为上限的 85%。
- 企鹅挖宝：在 70 格中随机挖掘，受 500ms 冷却限制。

如果通过 `--calibration` 传入用户标定 JSON，模拟器会**使用用户的真实过程指标**来驱动气球和喜从天降：

- 气球：用 `avgTimeBetweenClicks` 作为点击间隔，`accuracy` 作为命中概率。
- 喜从天降：用 `catchRate` 作为追踪注意力比例，`avgPlatformSpeed` 作为平台移动速度上限，`directionChangesPerSec` 作为随机抖动幅度。
- 企鹅挖宝：用标定结果中的 `recommendedCooldownMs` 与 `penguinScoreMultiplier` 直接仿真。

最终报告会展示「应用个性化倍率后」的预期收益：气球/喜从天降用用户实际点券 × 倍率，企鹅用仿真均值，三局结果应收敛到同一目标。

运行命令：

```bash
# 默认随机玩家模拟
npx tsx packages/frontend/src/minigames/balance/run-simulator.ts

# 使用用户真实标定数据复现
npx tsx packages/frontend/src/minigames/balance/run-simulator.ts --calibration ./calibration-xxx.json
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

标定器 `calibratePenguinDig` 会读取气球的 `avgTimeBetweenClicks` 与 `accuracy`、喜从天降的 `catchRate`，推算企鹅挖宝的推荐点击冷却；同时根据用户前两局的实际点券收益，分别计算三个游戏的**个性化得分倍率**，使该用户三局最终点券都接近同一目标（默认 100）。命中率低或接取率低的玩家会得到更宽松的冷却，避免误触过多；高频精准玩家则冷却更短、挑战性更高。用户完成标定流程后，这些指标与倍率会随 `baseline` / `result` 一起存入 `localStorage`，供后续读取、导出与命令行复现。

### 5.3 三游戏个性化得分倍率

为了把「不同操作水平的玩家」都拉到同一收益水平，标定器不再只调整企鹅挖宝，而是为三个游戏分别生成得分倍率：

```ts
interface CalibrationResult {
  targetCoupons: number;            // 默认 100
  balloonScoreMultiplier: number;   // 100 / 用户气球实际平均点券
  luckyDropScoreMultiplier: number; // 100 / 用户喜从天降实际平均点券
  penguinScoreMultiplier: number;   // 100 / (预计点击次数 × 单格期望分值)
  recommendedCooldownMs: number;    // 企鹅挖宝点击冷却
  // ...
}
```

- **七彩气球**：结算得分在 `stop()` 中乘以 `balloonScoreMultiplier`。
- **喜从天降**：结算得分在 `stop()` 中乘以 `luckyDropScoreMultiplier`。
- **企鹅挖宝**：通过 `applyCalibration(cooldownMs, penguinScoreMultiplier)` 同时调整冷却与分值倍率。

`MiniGameManager.createGame()` 会在创建实例时根据 `scoreMultipliers` 自动应用倍率；`test-minigames.ts` 手动启动任意小游戏时也会读取已保存的标定数据并传入。旧版标定 JSON（缺少倍率字段）会通过 `storage.ts` 的 `normalizeCalibration()` 自动反算补齐，保证用户已导出的历史文件仍然可用。

### 5.4 当前模拟结果

**默认随机玩家模拟（未应用用户标定，当前配置）：**

```
balloon:    平均点券=119.1, 标准差=20.7, 范围=[48, 191], 平均操作=74.0, 平均命中=31.5
luckyDrop:  平均点券=22.8,  标准差=22.9, 范围=[0, 151], 平均操作=14.2, 平均命中=12.7
penguinDig: 平均点券=144.7, 标准差=61.4, 范围=[0, 380], 平均操作=56.0, 平均命中=56.0
```

> 注：喜从天降分值已根据用户标定结果大幅下调，因此「随机玩家」基准暂时偏低；实际对局中会通过用户个性化倍率或后续二次标定重新收敛到目标 100。气球与企鹅挖宝随机基准仍在 100+。

**用户标定实例（`/Users/sam/Downloads/minigame-calibration-1783961905414.json`）：**

```
========== 用户标定验证（应用倍率后） ==========
七彩气球：134 × 0.75 ≈ 101
喜从天降：500 × 0.20 ≈ 100
企鹅挖宝（标定后仿真）：102.3
三游戏平均点券: 101.1
================================================
```

该用户前两局实际收益差异较大（气球 134、喜从天降 500），通过个性化倍率压缩后，三局收益都收敛到约 **100 点券**，实现了「同一玩家不同小游戏收益一致」的目标。

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
BALLOON_CONFIG.spawnIntervalMs = 433;          // 生成间隔（约为原来的 1.5 倍密度）
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

// 喜从天降：得分道具非红黑，扣分道具红黑；总时长 20s、速度曲线进一步下调
LUCKY_DROP_CONFIG.duration = 20000;
LUCKY_DROP_CONFIG.speedCurveMultiplier = 0.6; // 末端速度约 1.6 倍
LUCKY_DROP_CONFIG.items = [
  { kind: 'chest',  probability: 0.008, value: 35 },
  { kind: 'gold',   probability: 0.10,  value: 17 },
  { kind: 'silver', probability: 0.28,  value: 8 },
  { kind: 'coin',   probability: 0.48,  value: 2 },    // 青色玉币
  { kind: 'clock',  probability: 0.58,  value: 0, slowMotionMs: 5000 },
  { kind: 'spike',  probability: 0.76,  value: -7 },   // 红色刺球
  { kind: 'bomb',   probability: 1.0,   value: -15 },  // 黑色炸弹
];

// 企鹅挖宝：7×10 = 70 格，时长 20s，点击冷却 300ms；原红宝石改为绿色翡翠
PENGUIN_DIG_CONFIG.duration = 20000;
PENGUIN_DIG_CONFIG.cols = 7;
PENGUIN_DIG_CONFIG.rows = 10;
PENGUIN_DIG_CONFIG.digCooldownMs = 300;
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
3. 系统根据前两局的点券收益与过程指标，调用 `calibratePenguinDig()` 计算三个游戏的个性化得分倍率与企鹅挖宝推荐冷却。
4. 用户玩 **企鹅挖宝**，游戏自动应用推荐冷却与企鹅分值倍率。
5. 标定结果通过 `saveCalibration()` 写入 `localStorage`，刷新页面后仍可通过 `loadCalibration()` 读取并自动应用到手动启动的任意小游戏（气球/喜从天降/企鹅挖宝）。
6. 若用户导入旧版标定 JSON（缺少倍率字段），`storage.ts` 会自动根据 `baseline` 反算补齐。
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
// 1. 三个游戏的目标点券（默认 100）
const TARGET_USER_COUPONS = 100;

// 2. 气球 / 喜从天降：直接按比例压缩到目标
balloonScoreMultiplier   = clamp(TARGET_USER_COUPONS / balloonAvgCoupons,   0.1, 2.0);
luckyDropScoreMultiplier = clamp(TARGET_USER_COUPONS / luckyDropAvgCoupons, 0.1, 2.0);

// 3. 企鹅挖宝：根据用户点击节奏推断冷却，再反推分值倍率
estimatedClickInterval = balloonAvgTimeBetweenClicks
  * (1 + (1 - balloonAccuracy) * 0.5)    // 命中率低则增加冷却，避免误触
  * (1 - (catchRate - 0.5) * 0.2);       // 接取率高则降低冷却
recommendedCooldownMs = clamp(estimatedClickInterval, 200, 1200);

projectedClicks = (PENGUIN_DIG_CONFIG.duration - PENGUIN_DIG_CONFIG.memorizeDuration) / recommendedCooldownMs;
penguinScoreMultiplier = clamp(
  TARGET_USER_COUPONS / (projectedClicks * expectedScorePerDig()),
  0.25,
  4.0
);
```

示例输出（目标 100 点券，基于上述用户标定文件）：

```
用户基准期望点券: 317（气球 134 + 喜从天降 500）
目标点券: 100
七彩气球得分倍率: ×0.75
喜从天降得分倍率: ×0.20
企鹅挖宝点击冷却: 545ms
企鹅挖宝得分倍率: ×0.97
标定后随机玩家期望点券: 102
```

持久化文件：`packages/frontend/src/minigames/balance/storage.ts`

## 7. 当前上下文与设计讨论

本次迭代源于对小游戏测试的反馈，核心诉求包括：

1. **点券收益一致性**：同一玩家在玩三个小游戏时，最终获得的点券应接近，避免某个游戏明显更优。
2. **购买能力下限**：随机玩家完成一次小游戏后，应至少能在商店购买 1.5 件普通道具。
3. **企鹅挖宝限制**：增加点击冷却，防止高点击频率玩家获得过高收益，同时保留记忆玩法。
4. **动态标定**：通过玩家在前两个游戏中的实际表现，自动标定三个游戏的得分倍率，使不同操作风格的玩家都能获得一致收益。
5. **向后兼容**：用户已导出的旧版标定 JSON 应继续可用，缺少倍率字段时自动反算补齐。

实现时先建立「随机玩家模拟器」作为基准，再调整游戏参数使三游戏期望点券收敛到 100～110 左右；随后通过「用户标定倍率」把个体差异也压缩到同一区间。模拟器假设玩家：

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

# @monopoly4/map-generator

大富翁4 Web 复刻版的**独立地图生成器**。可离线运行，也可被前端 / 后端 / 其他工具调用。

## 特性

- **前后端通用**：纯 TypeScript，无运行时依赖，浏览器与 Node.js 均可直接 import。
- **参数化生成**：通过 `MapTemplate` 配置地块数量、比例、分组、价格曲线等。
- **可复现**：支持 `seed`，相同参数和种子总是生成相同地图。
- **自动平衡**：`generateBalancedMap()` 会尝试多个种子，选择系统格最分散的一张。
- **蒙特卡洛模拟**：内置 `simulateMap()` 评估各类地块到访频率、地产分组热度、均衡性评分。

## 安装

```bash
npm install
```

## 用法

### 1. 生成单张地图

```typescript
import { generateMap, DEFAULT_TEMPLATE, PLAYER4_TEMPLATE } from '@monopoly4/map-generator';

// 标准均衡图
const map = generateMap(DEFAULT_TEMPLATE);

// 4 人局：人均 1 大块 + 3 小块，绕 1 圈约 10 张卡片/道具
const p4Map = generateMap(PLAYER4_TEMPLATE);
```

### 2. 生成更均衡的地图

```typescript
import { generateBalancedMap, DEFAULT_TEMPLATE } from '@monopoly4/map-generator';

// 尝试 20 个种子，返回评分最高的一张
const map = generateBalancedMap(DEFAULT_TEMPLATE, 20);
```

### 3. 自定义模板

```typescript
import type { MapTemplate } from '@monopoly4/map-generator';

const myTemplate: MapTemplate = {
  id: 'my_map',
  name: '我的地图',
  totalTiles: 40,
  largePropertyCount: 6,
  smallPropertyGroups: [2, 2, 3, 2, 3, 2, 2],
  specialTiles: {
    fate: 3,
    chance: 4,
    prison: 1,
    hospital: 1,
    shop: 1,
    card: 4,
    tax: 2,
    coupon30: 1,
    park: 0,
    lottery: 0,
    magic: 0,
    news: 0,
    company: 0,
    coupon10: 0,
    coupon50: 0,
    miniGame: 0,
  },
  basePriceRange: [8000, 60000],
  priceCurve: 'sigmoid',
  seed: 42,
};

const map = generateMap(myTemplate);
```

### 4. 模拟与评估

```typescript
import { simulateMap, evaluateBalance, formatReport } from '@monopoly4/map-generator';

const result = simulateMap(map, {
  playerCount: 4,
  roundsPerPlayer: 30,
  diceCount: 1,
  variableDice: false,
  iterations: 2000,
});

const balance = evaluateBalance(result);
console.log(formatReport(result, balance));
```

## 预设模板

| 模板 | 地产占比 | 事件密度 | 人均地产(4人) | 人均卡+道 | 特点 |
|---|---|---|---|---|---|
| `DEFAULT_TEMPLATE` | 55% | 28% | 1.5大/4.0小 | ~4.7 | 最均衡，推荐默认使用 |
| `FAST_TEMPLATE` | 50% | 25% | 1.0大/4.0小 | ~5.0 | 系统格更多，节奏更快 |
| `ECONOMY_TEMPLATE` | 65% | 23% | 2.0大/4.5小 | ~3.0 | 地产为王，占地策略更重 |
| `PLAYER4_TEMPLATE` | 40% | 23% | 1.0大/3.0小 | ~10.9 | 4人标准局，卡片道具充足 |

## 运行离线模拟

```bash
npm run simulate
```

输出包括：
- 单张地图的详细到访统计与热力图
- 多模板批量对比（含人均地产、人均卡片+道具）
- 不同骰子配置（步行/机车/汽车）的影响
- 土地数量参数扫描与均衡评分
- 卡片/点券/商店购买估算

## 目录结构

```
packages/map-generator/
├── src/
│   ├── types.ts        # 核心类型定义
│   ├── generator.ts    # 地图生成逻辑与预设模板
│   ├── simulator.ts    # 蒙特卡洛模拟与平衡性评估
│   ├── index.ts        # 公共 API 入口
│   └── scripts/
│       └── simulate.ts # 离线模拟脚本
├── package.json
├── tsconfig.json
└── README.md
```

## 设计要点

- **地产占比**：40 格地图中，22 块可购买土地（55%）经模拟验证评分最高。
- **分组策略**：小块土地分组连续放置，形成“路段”，同组拥有越多连锁加成越高。
- **特殊格分散**：采用贪婪算法最大化同类型特殊格之间的环形距离，避免相邻同类系统格。
- **价格曲线**：默认使用 sigmoid 曲线，前期低价区、后期高价区，但过渡更平滑。
- **4 人局资源节奏**：`PLAYER4_TEMPLATE` 用 16 块土地（4 大 12 小）换取 23 个系统格，确保 40 回合（约绕 1 圈）人均卡片+道具约 10 个。

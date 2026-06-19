# @monopoly4/map-generator

大富翁4 Web 复刻版的**独立地图生成器**。可离线运行，也可被前端 / 后端 / 其他工具调用。

## 特性

- **前后端通用**：纯 TypeScript，无运行时依赖，浏览器与 Node.js 均可直接 import。
- **参数化生成**：通过 `MapTemplate` 配置地块数量、比例、分组、价格曲线等。
- **可复现**：支持 `seed`，相同参数和种子总是生成相同地图。
- **自动平衡**：`generateBalancedMap()` 会尝试多个种子，选择系统格最分散的一张。
- **蒙特卡洛模拟**：内置 `simulateMap()` 评估各类地块到访频率、地产分组热度、均衡性评分。
- **地图加载器**：支持 JSON 序列化/反序列化、模板加载、结构校验。
- **坐标工具**：提供环形/网格布局、tile 中心/矩形计算、角色移动插值、点击位置反查。
- **现实渲染**：SVG/HTML 可视化，带颜色区分、地块名称、价格，支持多角色棋子占位。

## 安装

```bash
npm install
```

## 用法

### 1. 生成单张地图

```typescript
import { generateMap, DEFAULT_TEMPLATE, PLAYER4_TEMPLATE, MAP80_TEMPLATE } from '@monopoly4/map-generator';

// 标准均衡图
const map = generateMap(DEFAULT_TEMPLATE);

// 4 人局：人均 1 大块 + 3 小块，绕 1 圈约 10 张卡片/道具
const p4Map = generateMap(PLAYER4_TEMPLATE);

// 大地图：人均 1 大块 + 9 小块，80 回合点券翻倍
const bigMap = generateMap(MAP80_TEMPLATE);
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

| 模板 | 格数 | 推荐回合 | 地产占比 | 人均地产(4人) | 人均点券 | 人均卡+道 | 特点 |
|---|---|---|---|---|---|---|---|
| `DEFAULT_TEMPLATE` | 40 | 40 | 55% | 1.5大/4.0小 | ~295 | ~4.7 | 最均衡，推荐默认使用 |
| `FAST_TEMPLATE` | 40 | 40 | 50% | 1.0大/4.0小 | ~295 | ~5.0 | 系统格更多，节奏更快 |
| `ECONOMY_TEMPLATE` | 40 | 40 | 65% | 2.0大/4.5小 | ~180 | ~3.0 | 地产为王，占地策略更重 |
| `PLAYER4_TEMPLATE` | 40 | 40 | 40% | 1.0大/3.0小 | ~295 | ~10.9 | 4人标准局，卡片道具充足 |
| `MAP80_TEMPLATE` | 80 | 80 | 50% | 1.0大/9.0小 | ~581 | ~15.6 | 大地图，小地块翻三倍+点券翻倍 |

### 5. 地图加载与序列化

```typescript
import { loadMap, saveMap, loadMapFromTemplate, validateMap, PLAYER4_TEMPLATE } from '@monopoly4/map-generator';

const map = loadMapFromTemplate(PLAYER4_TEMPLATE);
const json = saveMap(map);
const loaded = loadMap(json);

// 校验外部地图数据
const result = validateMap(someUnknownData);
if (!result.valid) console.error(result.errors);
```

### 6. 坐标与角色移动

```typescript
import { ringLayout, getTileCenter, interpolatePosition, getTileAtPosition } from '@monopoly4/map-generator/coords';

const layout = ringLayout(map, 800);
const center = getTileCenter(layout, 0); // 起点中心坐标
const pos = interpolatePosition(layout, 0, 10, 0.5); // 从 0 移动到 10，中途位置
const index = getTileAtPosition(layout, mouseX, mouseY); // 点击反查地块
```

### 7. 可视化与棋子

```typescript
import { generateMap, PLAYER4_TEMPLATE, renderTextMap, renderRingTextMap, renderHtmlMap, renderSvgWithTokens } from '@monopoly4/map-generator';

const map = generateMap(PLAYER4_TEMPLATE);

// 控制台文本可视化
console.log(renderTextMap(map));

// 40 格环形 ASCII 布局
console.log(renderRingTextMap(map));

// 生成可在浏览器打开的 HTML（含棋子）
const tokens = [
  { id: 'p1', positionIndex: 0, color: '#e74c3c', name: '阿土伯' },
  { id: 'p2', positionIndex: 5, color: '#3498db', name: '孙小美' },
];
const html = renderHtmlMap(map, { size: 800, showNames: true }, tokens);

// 纯 SVG（含棋子）
const svg = renderSvgWithTokens(map, tokens, { size: 800 });
```

## 运行离线模拟与可视化

```bash
npm run simulate
```

输出包括：
- 单张地图的详细到访统计与热力图
- 多模板批量对比（含人均地产、人均卡片+道具）
- 不同骰子配置（步行/机车/汽车）的影响
- 土地数量参数扫描与均衡评分
- 卡片/点券/商店购买估算
- 文本可视化（网格 + 40 格环形布局）
- SVG/HTML 可视化文件：`output/map_4player.html`、`output/map_4player.svg`、`output/map_4player_tokens.svg`、`output/map_80.html`、`output/map_80.svg`、`output/map_80_tokens.svg`

用浏览器打开 `output/*.html` 即可查看环形 SVG 棋盘与示例棋子。

## 测试

```bash
npm test
```

测试覆盖：
- 所有预设模板格数匹配
- 相同种子生成确定性结果
- 人均地产数量约束
- 卡片/道具/点券产出目标
- 绕圈数计算正确性
- 地图加载/保存/校验
- 坐标计算与反向查找
- SVG/HTML/棋子渲染

## 目录结构

```
packages/map-generator/
├── src/
│   ├── types.ts        # 核心类型定义
│   ├── generator.ts    # 地图生成逻辑与预设模板
│   ├── simulator.ts    # 蒙特卡洛模拟与平衡性评估
│   ├── loader.ts       # 地图加载器与序列化校验
│   ├── coords.ts       # 布局与坐标计算
│   ├── visualizer.ts   # 文本/SVG/HTML 渲染与棋子
│   ├── index.ts        # 公共 API 入口
│   ├── tests/          # 单元测试
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
- **80 格大地图**：`MAP80_TEMPLATE` 用 80 格容纳 36 个小块（人均 9 个）和 15 个点券格，80 回合（绕 3.5 圈）人均点券约 581，接近翻倍。

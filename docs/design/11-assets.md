# 美术资源设计文档

> 本文档定义 Monopoly4 Web 复刻版的美术资源需求、目录结构、加载接口与尺寸限制。
> 当前版本以 Canvas 绘制为主，美术资源为**可选增强**：目录为空时保持现状，不加载图片。

## 1. 现状

- 前端渲染基于 `Canvas 2D`，原生 DOM 面板辅助。
- 地块图标、玩家棋子、卡片/道具/神明等使用**文字符号 + 矢量绘制**。
- 无现成图片资源目录，构建产物中无静态图片。

## 2. 资源分类

| 类别 | 资源 ID 示例 | 用途 | 建议尺寸 | 最大尺寸 |
|------|-------------|------|----------|----------|
| `tile` | `tile-property`, `tile-fate`, `tile-card`, `tile-tax`, `tile-shop`, `tile-hospital`, `tile-news`, `tile-coupon` | 地块类型图标 | 64×64 | 128×128 |
| `building` | `house`, `shop`, `park`, `mall`, `hotel`, `gasStation`, `lab`, `chain` | 建筑类型图标 | 64×64 | 128×128 |
| `spirit` | `smallWealthGod`, `bigWealthGod`, `smallPovertyGod`, `bigPovertyGod`, `earthGod`, `angel`, `devil` | 神明/穷富神形象 | 64×64 | 128×128 |
| `card` | `roadRoller`, `robbery`, `taxCard`, `stayCard`, `redirection`, `avertDisaster`, `revenge`, `redeploy`, `upgradeCard`, `diceControl`, `timeBomb`, `barrier`, `remoteDice`, `swapLocation`, `buyOneGetOne`, `landSwap`, `merge`, `reduceTax`, `rebirth` | 卡片插画 | 96×128 | 192×256 |
| `item` | `dice`, `remoteDice`, `redDice`, `missile`, `machineDice`, `turtleCard`, `roadblock`, `timeBomb` 等 | 道具图标 | 48×48 | 96×96 |
| `character` | `sunWukong`, `monopolyKid`, `ayumi`, `miku`, `sanzang` | 角色头像/立绘 | 头像 64×64，立绘 256×320 | 头像 128×128，立绘 512×640 |
| `token` | `token-red`, `token-blue`, `token-green`, `token-yellow` | 玩家棋子 | 32×32 | 64×64 |
| `ui` | `logo`, `bg-lobby`, `bg-board`, `button-primary`, `panel-frame` | UI 背景与装饰 | 按需 | 2048×2048 |

## 3. 目录结构

```
packages/frontend/public/assets/
├── tiles/          # 地块类型图标
├── buildings/      # 建筑类型图标
├── spirits/        # 神明形象
├── cards/          # 卡片插画
├── items/          # 道具图标
├── characters/     # 角色头像/立绘
├── tokens/         # 玩家棋子
└── ui/             # UI 背景与装饰
```

> 约定：`public/assets/` 目录下**任一子目录为空**时，对应类别使用默认 Canvas 绘制，不加载图片。

## 4. 接口预留

### 4.1 资源管理器

文件位置：`packages/frontend/src/assets/manager.ts`

```ts
export type AssetCategory =
  | 'tile'
  | 'building'
  | 'spirit'
  | 'card'
  | 'item'
  | 'character'
  | 'token'
  | 'ui';

export interface AssetMeta {
  id: string;
  category: AssetCategory;
  src: string;
  width: number;
  height: number;
}

export interface AssetManager {
  /** 预加载指定类别的全部资源 */
  preload(categories: AssetCategory[]): Promise<void>;
  /** 获取已加载的图片；未找到或加载失败返回 null */
  get(id: string): HTMLImageElement | null;
  /** 检查某类别是否有资源可用 */
  hasCategory(category: AssetCategory): boolean;
  /** 列出某类别所有可用资源 ID */
  list(category: AssetCategory): string[];
}
```

### 4.2 资源清单

文件位置：`packages/frontend/public/assets/manifest.json`

```json
{
  "version": "1",
  "categories": {
    "tile": ["tile-property", "tile-fate", "tile-card"],
    "card": ["roadRoller", "robbery"],
    "character": ["sunWukong"]
  }
}
```

> 清单不存在或某类别为空数组时，按“无资源”处理。

### 4.3 渲染层使用入口

文件位置：`packages/frontend/src/board.ts`

```ts
import { assetManager } from './assets/manager.js';

function drawTileIcon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  tileType: string
): void {
  const img = assetManager.get(`tile-${tileType}`);
  if (img) {
    ctx.drawImage(img, cx - size / 2, cy - size / 2, size, size);
    return;
  }
  // fallback：现有文字符号绘制
}
```

## 5. 尺寸与格式限制

- **格式**：WebP（首选）、PNG、JPEG（仅 UI 背景）。
- **透明通道**：图标类（tile/building/spirit/item/token）必须保留透明背景。
- **最大文件**：单张不超过 **512 KB**。
- **最大像素**：
  - UI 装饰/背景：≤ 2048×2048
  - 角色立绘：≤ 512×640
  - 卡片插画：≤ 192×256
  - 图标类：≤ 128×128
- **运行时校验**：加载时读取图片 `naturalWidth/naturalHeight`，超过最大尺寸时记录警告并回退到默认绘制。

## 6. 加载与回退策略

1. 启动时读取 `/assets/manifest.json`。
2. 按类别并行加载图片，失败条目记录到 `failedAssets`。
3. 渲染时优先取图片；取不到或失败时使用现有 Canvas 矢量绘制。
4. 提供 `window.__ASSET_DEBUG__` 开关，强制禁用图片资源以便调试。

## 7. 与现有数据模型的关系

- `packages/shared/src/data/spirits.ts` 中的 `spiritId` 直接映射 `public/assets/spirits/${id}.webp`。
- `packages/shared/src/data/cards.ts` 中的 `cardId` 直接映射 `public/assets/cards/${id}.webp`。
- `packages/shared/src/data/items.ts` 中的 `itemId` 直接映射 `public/assets/items/${id}.webp`。
- 角色选择界面使用 `Character` 类型中的 `avatar` 字段（预留，当前未实现）。

## 8. 后续接入步骤

1. 在 `packages/frontend/public/assets/` 下按类别放置图片。
2. 维护 `manifest.json` 清单。
3. 实现 `packages/frontend/src/assets/manager.ts`。
4. 在 `board.ts`、卡片弹窗、道具面板、角色选择处逐步替换为 `drawImage` 并保留 fallback。

## 9. 实现状态

| 项 | 状态 |
|---|---|
| 目录结构预留 | ✅ 文档已定义 |
| 清单格式 | ✅ 文档已定义 |
| 资源管理器接口 | ✅ 文档已定义 |
| 尺寸限制 | ✅ 文档已定义 |
| 实际资源文件 | ⬜ 暂无 |
| 渲染层接入 | ⬜ 暂无 |

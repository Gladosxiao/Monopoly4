/**
 * 大富翁4 地图生成器
 *
 * 提供参数化、可复现的地图生成逻辑，可在浏览器与 Node.js 中离线运行。
 */

import type { GameMap, MapTemplate, Tile, TileType, PropertySize } from './types.js';

export type { GameMap, MapTemplate, Tile, TileType, PropertySize };

// ============ 预设模板 ============

/**
 * 标准模板：土地占比约 65%，5 个占两步的大地产 + 5 组连续小地产。
 */
export const DEFAULT_TEMPLATE: MapTemplate = {
  id: 'map_default',
  name: '随机乐园',
  totalTiles: 40,
  largePropertyCount: 5,
  largePropertySpan: 2,
  smallPropertyGroups: [3, 3, 3, 3, 3], // 15 个小块，分 5 组连续 3 个
  specialTiles: {
    fate: 2,
    chance: 2,
    prison: 1,
    hospital: 1,
    shop: 2,
    card: 1,
    tax: 2,
    coupon30: 0,
    park: 0,
    lottery: 0,
    magic: 0,
    news: 0,
    company: 3,
    coupon10: 0,
    coupon50: 0,
    miniGame: 0,
  },
  basePriceRange: [80, 600],
  priceCurve: 'sigmoid',
};

/**
 * 快速模板：地产更紧凑，单局时长更短；5 个大地产 + 4 组连续小地产。
 */
export const FAST_TEMPLATE: MapTemplate = {
  ...DEFAULT_TEMPLATE,
  id: 'map_fast',
  name: '速战速决',
  largePropertyCount: 5,
  largePropertySpan: 2,
  smallPropertyGroups: [3, 3, 3, 3], // 12 个小块
  specialTiles: {
    ...DEFAULT_TEMPLATE.specialTiles,
    fate: 2,
    chance: 2,
    card: 2,
    tax: 2,
    shop: 2,
    coupon30: 0,
    coupon50: 1,
    coupon10: 1,
    company: 3,
  },
  basePriceRange: [100, 500],
};

/**
 * 地产模板：土地比例最高，5 个占两步大地产 + 5 组连续 4 个小地产。
 */
export const ECONOMY_TEMPLATE: MapTemplate = {
  ...DEFAULT_TEMPLATE,
  id: 'map_economy',
  name: '地产为王',
  largePropertyCount: 5,
  largePropertySpan: 2,
  smallPropertyGroups: [4, 4, 4, 4, 4], // 20 个小块，分 5 组连续 4 个
  specialTiles: {
    fate: 1,
    chance: 1,
    prison: 1,
    hospital: 1,
    shop: 1,
    card: 0,
    tax: 1,
    coupon30: 0,
    coupon50: 0,
    coupon10: 0,
    park: 0,
    lottery: 0,
    magic: 0,
    news: 0,
    company: 3,
    miniGame: 0,
  },
  basePriceRange: [120, 700],
};

/**
 * 4 人桌游模板：5 个占两步大地产 + 4 组连续 4 个小地产。
 */
export const PLAYER4_TEMPLATE: MapTemplate = {
  id: 'map_4player',
  name: '四人桌游',
  totalTiles: 40,
  largePropertyCount: 5,
  largePropertySpan: 2, // 每个大地产占 2 格，共 10 格
  smallPropertyGroups: [4, 4, 4, 4], // 16 个小块，分 4 组连续 4 个
  specialTiles: {
    fate: 1,
    chance: 1,
    prison: 1,
    hospital: 1,
    shop: 1,
    card: 2,
    tax: 1,
    coupon10: 1,
    coupon30: 0,
    coupon50: 1,
    park: 0,
    lottery: 0,
    magic: 0,
    news: 0,
    company: 3,
    miniGame: 0,
  },
  basePriceRange: [100, 550],
  priceCurve: 'sigmoid',
};

/**
 * 扩展模板：60 格，土地数量约为 SIMPLE_MAP 的 1.5 倍（38 块）。
 * 8 组连续小地产 + 3 个占两步大地产，系统格保留关键功能。
 */
export const EXPANDED_TEMPLATE: MapTemplate = {
  id: 'map_expanded',
  name: '扩展版图',
  totalTiles: 60,
  largePropertyCount: 3,
  largePropertySpan: 2, // 3 个大地产各占 2 格，共 6 格
  smallPropertyGroups: [4, 4, 4, 4, 4, 4, 4, 4], // 32 个小块，分 8 组连续 4 个
  specialTiles: {
    fate: 3,
    chance: 3,
    prison: 1,
    hospital: 1,
    shop: 4,
    card: 1,
    tax: 2,
    coupon10: 1,
    coupon30: 1,
    coupon50: 1,
    park: 0,
    lottery: 0,
    magic: 0,
    news: 0,
    company: 3,
    miniGame: 0,
  },
  basePriceRange: [60, 500],
  priceCurve: 'sigmoid',
};

/**
 * 80 格大地图模板：6 个占两步大地产 + 12 组连续 4 个小地产，土地占比约 75%。
 */
export const MAP80_TEMPLATE: MapTemplate = {
  id: 'map_80',
  name: '大地图80格',
  totalTiles: 80,
  largePropertyCount: 6,
  largePropertySpan: 2, // 6 个大地产各占 2 格，共 12 格
  smallPropertyGroups: [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4], // 48 个小块，分 12 组连续 4 个
  specialTiles: {
    fate: 2,
    chance: 2,
    prison: 1,
    hospital: 1,
    shop: 2,
    card: 1,
    tax: 1,
    coupon10: 2,
    coupon30: 2,
    coupon50: 1,
    miniGame: 1,
    park: 0,
    lottery: 0,
    magic: 0,
    news: 0,
    company: 3,
  },
  basePriceRange: [100, 800],
  priceCurve: 'sigmoid',
};

// ============ 内部工具 ============

interface SeededRandom {
  next(): number;
  nextInt(min: number, max: number): number;
  shuffle<T>(arr: readonly T[]): T[];
}

function createSeededRandom(seed?: number): SeededRandom {
  let s = seed ?? Math.floor(Math.random() * 2147483647);
  const next = (): number => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    nextInt: (min: number, max: number) => Math.floor(next() * (max - min)) + min,
    shuffle: <T>(arr: readonly T[]): T[] => {
      const copy = [...arr];
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy;
    },
  };
}

function normalizeTemplate(template: MapTemplate): MapTemplate {
  const span = template.largePropertySpan ?? 1;
  const totalSpecial = Object.values(template.specialTiles).reduce((a, b) => a + b, 0);
  const totalPropertyTiles =
    template.largePropertyCount * span + template.smallPropertyGroups.reduce((a, b) => a + b, 0);
  const expected = 1 + totalSpecial + totalPropertyTiles;
  if (expected !== template.totalTiles) {
    throw new Error(
      `[map-generator] 模板格数不匹配: 起点1 + 系统格${totalSpecial} + 土地格${totalPropertyTiles} = ${expected}, 期望 ${template.totalTiles}`
    );
  }
  return template;
}

const TILE_NAMES: Record<TileType, string> = {
  start: '起点/银行',
  property: '土地',
  fate: '命运',
  chance: '机会',
  prison: '监狱',
  hospital: '医院',
  park: '公园',
  tax: '税务',
  shop: '商店',
  lottery: '乐透',
  magic: '魔法屋',
  news: '新闻点',
  company: '公司',
  card: '卡片格',
  coupon10: '得10点券',
  coupon30: '得30点券',
  coupon50: '得50点券',
  miniGame: '小游戏',
};

function createTile(index: number, type: TileType, name?: string): Tile {
  return {
    index,
    name: name ?? TILE_NAMES[type],
    type,
    basePrice: 0,
    baseRent: 0,
    level: 0,
  };
}

function distributeAnchors(total: number, count: number, rng: SeededRandom): number[] {
  if (count === 0) return [];
  const segment = total / (count + 1);
  const positions: number[] = [];
  for (let i = 1; i <= count; i++) {
    const center = Math.round(i * segment);
    const jitterRange = Math.max(1, Math.floor(segment / 4));
    const jitter = rng.nextInt(-jitterRange, jitterRange + 1);
    let pos = (center + jitter) % total;
    if (pos < 0) pos += total;
    positions.push(pos);
  }
  return positions.sort((a, b) => a - b);
}

function cyclicDistance(a: number, b: number, total: number): number {
  const d = Math.abs(a - b);
  return Math.min(d, total - d);
}

function placeSpecialTiles(
  slots: (Tile | null)[],
  specialTypes: Exclude<TileType, 'start' | 'property'>[],
  rng: SeededRandom
): void {
  const emptyIndices = slots.map((_, i) => i).filter((i) => slots[i] === null);
  const placed: { index: number; type: TileType }[] = [];
  const shuffled = rng.shuffle(specialTypes);

  for (const type of shuffled) {
    let bestIndex = -1;
    let bestScore = -Infinity;

    for (const idx of emptyIndices) {
      if (slots[idx] !== null) continue;

      const prevType = slots[(idx - 1 + slots.length) % slots.length]?.type;
      const nextType = slots[(idx + 1) % slots.length]?.type;
      const adjacentSameType = (prevType === type ? 1 : 0) + (nextType === type ? 1 : 0);

      // 与最近同类型格子的距离
      const sameType = placed.filter((p) => p.type === type);
      let minSameTypeDist = slots.length;
      for (const p of sameType) {
        minSameTypeDist = Math.min(minSameTypeDist, cyclicDistance(idx, p.index, slots.length));
      }

      // 避免与其他特殊格过于扎堆，同类型相邻大幅惩罚
      let clusterPenalty = 0;
      for (const p of placed) {
        const d = cyclicDistance(idx, p.index, slots.length);
        if (d <= 1) clusterPenalty += 1000;
        else if (d === 2) clusterPenalty += 100;
      }

      const score = minSameTypeDist - clusterPenalty - adjacentSameType * 2000 + rng.next() * 0.5;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = idx;
      }
    }

    if (bestIndex === -1) {
      bestIndex = emptyIndices.find((i) => slots[i] === null) ?? -1;
    }
    if (bestIndex === -1) {
      throw new Error('[map-generator] 系统格放置失败：没有空位');
    }

    slots[bestIndex] = createTile(bestIndex, type);
    placed.push({ index: bestIndex, type });
    const pos = emptyIndices.indexOf(bestIndex);
    if (pos !== -1) emptyIndices.splice(pos, 1);
  }
}

interface PropertyPlan {
  size: PropertySize;
  span: number;
  group?: number;
}

function createPropertyPlans(template: MapTemplate): PropertyPlan[] {
  const span = template.largePropertySpan ?? 1;
  const plans: PropertyPlan[] = [];
  for (let i = 0; i < template.largePropertyCount; i++) plans.push({ size: 'large', span });
  template.smallPropertyGroups.forEach((count, groupIdx) => {
    for (let i = 0; i < count; i++) plans.push({ size: 'small', span: 1, group: groupIdx });
  });
  return plans;
}

function groupBy<T, K>(arr: T[], keyFn: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of arr) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }
  return map;
}

function findEmptySegment(
  sortedEmpty: number[],
  assigned: Set<number>,
  length: number,
  rng: SeededRandom
): number[] {
  const segments: number[][] = [];
  let current: number[] = [];

  for (const idx of sortedEmpty) {
    if (assigned.has(idx)) continue;
    if (current.length === 0 || idx === current[current.length - 1] + 1) {
      current.push(idx);
    } else {
      if (current.length > 0) segments.push(current);
      current = [idx];
    }
  }
  if (current.length > 0) segments.push(current);

  const valid = segments.filter((s) => s.length >= length);
  if (valid.length === 0) {
    throw new Error(
      `[map-generator] 无法为长度 ${length} 的路段找到连续空位，请检查模板配置`
    );
  }
  const chosen = valid[rng.nextInt(0, valid.length)];
  const start = rng.nextInt(0, chosen.length - length + 1);
  return chosen.slice(start, start + length);
}

interface PropertyBlock {
  size: PropertySize;
  tiles: Tile[];
  group?: number;
}

function createPropertyBlocks(template: MapTemplate): PropertyBlock[] {
  const largeSpan = template.largePropertySpan ?? 1;
  const blocks: PropertyBlock[] = [];

  for (let i = 0; i < template.largePropertyCount; i++) {
    blocks.push({
      size: 'large',
      tiles: Array.from({ length: largeSpan }, () => ({
        index: -1,
        name: `商业用地${i + 1}`,
        type: 'property',
        size: 'large',
        span: largeSpan,
        basePrice: 0,
        baseRent: 0,
        level: 0,
      })),
    });
  }

  template.smallPropertyGroups.forEach((count, groupIdx) => {
    blocks.push({
      size: 'small',
      group: groupIdx,
      tiles: Array.from({ length: count }, (_, i) => ({
        index: -1,
        name: `路段${groupIdx + 1}-${i + 1}`,
        type: 'property',
        size: 'small',
        span: 1,
        group: groupIdx,
        basePrice: 0,
        baseRent: 0,
        level: 0,
      })),
    });
  });

  return blocks;
}

function fillPropertySlots(
  slots: (Tile | null)[],
  blocks: PropertyBlock[],
  rng: SeededRandom
): void {
  const sortedEmpty = slots
    .map((_, i) => i)
    .filter((i) => slots[i] === null)
    .sort((a, b) => a - b);

  const totalTiles = blocks.reduce((sum, b) => sum + b.tiles.length, 0);
  if (sortedEmpty.length < totalTiles) {
    throw new Error(
      `[map-generator] 空位不足: 空位 ${sortedEmpty.length}, 土地 ${totalTiles}`
    );
  }

  const assigned = new Set<number>();

  // 先放小组：小组需要更长连续段，优先放置可避免后续被大块分割后无空位
  const smallBlocks = blocks.filter((b) => b.size === 'small');
  for (const block of smallBlocks) {
    const segment = findEmptySegment(sortedEmpty, assigned, block.tiles.length, rng);
    for (let i = 0; i < block.tiles.length; i++) {
      const idx = segment[i];
      block.tiles[i].index = idx;
      slots[idx] = block.tiles[i];
      assigned.add(idx);
    }
  }

  // 再放大块：每个大块占 span 个连续空位
  const largeBlocks = blocks.filter((b) => b.size === 'large');
  for (const block of largeBlocks) {
    const span = block.tiles.length;
    const unassigned = sortedEmpty.filter((i) => !assigned.has(i));
    if (unassigned.length < span) throw new Error('[map-generator] 无空位放置大块土地');

    // 收集所有长度 >= span 的连续空位段
    interface Segment {
      indices: number[];
      isWrapped: boolean;
    }
    const segments: Segment[] = [];
    let current: number[] = [];
    for (const idx of unassigned) {
      if (current.length === 0 || idx === current[current.length - 1] + 1) {
        current.push(idx);
      } else {
        if (current.length >= span) segments.push({ indices: current, isWrapped: false });
        current = [idx];
      }
    }
    if (current.length >= span) segments.push({ indices: current, isWrapped: false });

    // 处理环形首尾相连的情况：大块土地跨越终点/起点时视觉上会分离，
    // 因此仅在找不到其他连续段时才允许使用合并段，并放到候选末尾且大幅惩罚。
    if (unassigned.length > 0 && segments.length > 0) {
      const first = unassigned[0];
      const last = unassigned[unassigned.length - 1];
      if (last === slots.length - 1 && first === 0) {
        const tail = segments[segments.length - 1].indices;
        const head = segments[0].indices;
        const merged = [...tail, ...head];
        if (merged.length >= span) {
          segments.push({ indices: merged, isWrapped: true });
        }
      }
    }

    if (segments.length === 0) {
      throw new Error('[map-generator] 无法为大块土地找到连续空位');
    }

    let bestSegment: number[] = segments[0].indices.slice(0, span);
    let bestScore = -Infinity;

    for (const seg of segments) {
      for (let start = 0; start <= seg.indices.length - span; start++) {
        const segment = seg.indices.slice(start, start + span);
        let score = rng.next() * 0.5;
        // 跨终点/起点的段大幅惩罚，仅在无其他选择时才用
        if (seg.isWrapped) score -= 1000;

        for (const pos of segment) {
          const prev = slots[(pos - 1 + slots.length) % slots.length];
          const next = slots[(pos + 1) % slots.length];
          if (prev?.type === 'property') score -= 2;
          if (next?.type === 'property') score -= 2;
        }

        // 离其他 large 块远一些
        for (let i = 0; i < slots.length; i++) {
          if (slots[i]?.size === 'large') {
            score += cyclicDistance(segment[0], i, slots.length) * 0.05;
          }
        }

        if (score > bestScore) {
          bestScore = score;
          bestSegment = segment;
        }
      }
    }

    for (let offset = 0; offset < span; offset++) {
      const idx = bestSegment[offset];
      block.tiles[offset].index = idx;
      slots[idx] = block.tiles[offset];
      assigned.add(idx);
    }
  }

  // 兜底：理论上不应有剩余
  for (const block of blocks) {
    for (const tile of block.tiles) {
      if (tile.index !== -1) continue;
      const idx = sortedEmpty.find((i) => !assigned.has(i));
      if (idx === undefined) throw new Error('[map-generator] 仍有未分配土地');
      tile.index = idx;
      slots[idx] = tile;
      assigned.add(idx);
    }
  }
}

function assignPrices(slots: (Tile | null)[], template: MapTemplate): void {
  const properties = slots.filter((t): t is Tile => t !== null && t.type === 'property');
  const total = properties.length;
  const [minPrice, maxPrice] = template.basePriceRange;

  properties.sort((a, b) => a.index - b.index);

  // 按 name 分组：大地产多个格子共享一个价格
  const nameToPrice = new Map<string, number>();

  properties.forEach((tile, i) => {
    if (nameToPrice.has(tile.name)) {
      tile.basePrice = nameToPrice.get(tile.name)!;
      tile.baseRent = Math.round(tile.basePrice * 0.1);
      return;
    }

    const progress = total <= 1 ? 0 : i / (total - 1);
    let normalized: number;
    if (template.priceCurve === 'sigmoid') {
      normalized = 1 / (1 + Math.exp(-8 * (progress - 0.5)));
    } else {
      normalized = progress;
    }
    const price = minPrice + normalized * (maxPrice - minPrice);
    const sizeMultiplier = tile.size === 'large' ? 1.3 : 1;
    const basePrice = Math.max(1, Math.round(price * sizeMultiplier));
    nameToPrice.set(tile.name, basePrice);
    tile.basePrice = basePrice;
    tile.baseRent = Math.round(tile.basePrice * 0.1);
  });
}

// ============ 公开 API ============

/**
 * 根据模板生成一张地图。
 *
 * @param template 地图模板；不传则使用 DEFAULT_TEMPLATE
 * @returns 生成的 GameMap
 */
export function generateMap(template: MapTemplate = DEFAULT_TEMPLATE): GameMap {
  const t = normalizeTemplate(template);
  const rng = createSeededRandom(t.seed);

  const slots: (Tile | null)[] = Array(t.totalTiles).fill(null);
  slots[0] = createTile(0, 'start');

  // 创建土地块（先不放置）
  const blocks = createPropertyBlocks(t);

  // 先放置土地，保证同组小地产连续、大地产连续 2 格
  fillPropertySlots(slots, blocks, rng);

  // 关键系统格（监狱/医院/商店）需要尽量均匀分布，但不能打断已放置的土地组。
  // 这里先计算理想位置，再对每个理想位置找最近的空位放置。
  const anchors: { type: TileType; name: string }[] = [];
  if (t.specialTiles.prison > 0) anchors.push({ type: 'prison', name: '监狱' });
  if (t.specialTiles.hospital > 0) anchors.push({ type: 'hospital', name: '医院' });
  if (t.specialTiles.shop > 0) anchors.push({ type: 'shop', name: '商店' });

  const anchorTargets = distributeAnchors(t.totalTiles, anchors.length, rng);
  for (let i = 0; i < anchors.length; i++) {
    const target = anchorTargets[i];
    let pos = target;
    // 优先寻找最近的空位
    let bestPos = -1;
    let bestDist = Infinity;
    for (let idx = 0; idx < t.totalTiles; idx++) {
      if (slots[idx] !== null) continue;
      const dist = cyclicDistance(idx, target, t.totalTiles);
      if (dist < bestDist) {
        bestDist = dist;
        bestPos = idx;
      }
    }
    if (bestPos >= 0) pos = bestPos;
    slots[pos] = createTile(pos, anchors[i].type, anchors[i].name);
  }

  // 放置其他系统格，填充剩余空位
  const anchorTypes = new Set<TileType>(anchors.map((a) => a.type));
  const specialTypes = Object.entries(t.specialTiles)
    .filter(([type, count]) => type !== 'start' && type !== 'property' && count > 0)
    .flatMap(([type, count]) => {
      const actualCount = anchorTypes.has(type as TileType) ? Math.max(0, count - 1) : count;
      return Array(actualCount).fill(type as Exclude<TileType, 'start' | 'property'>);
    });
  placeSpecialTiles(slots, specialTypes, rng);

  // 定价
  assignPrices(slots, t);

  // 组装
  const tiles = slots.filter((tile): tile is Tile => tile !== null);
  tiles.sort((a, b) => a.index - b.index);

  if (tiles.length !== t.totalTiles) {
    throw new Error(`[map-generator] 生成失败: 实际格数 ${tiles.length}`);
  }

  const map: GameMap = {
    id: t.id,
    name: t.name,
    path: Array.from({ length: t.totalTiles }, (_, i) => i),
    tiles,
  };

  validateMap(map);
  return map;
}

/**
 * 校验地图生成结果：
 * 1. 同一路段（group）的小地产在路径上必须连续；
 * 2. 大块土地（span > 1）的子格必须连续且不能跨越终点/起点边界。
 */
function validateMap(map: GameMap): void {
  const total = map.tiles.length;

  // 校验 group 连续性
  const groupTiles = new Map<number, number[]>();
  for (const tile of map.tiles) {
    if (tile.type === 'property' && tile.size === 'small' && tile.group !== undefined) {
      const arr = groupTiles.get(tile.group) ?? [];
      arr.push(tile.index);
      groupTiles.set(tile.group, arr);
    }
  }
  for (const [group, indices] of groupTiles) {
    const sorted = indices.slice().sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      const isAdjacent = curr === prev + 1 || (prev === total - 1 && curr === 0);
      if (!isAdjacent) {
        throw new Error(
          `[map-generator] 路段 ${group} 不连续: [${sorted.join(',')}]`
        );
      }
    }
  }

  // 校验大地产连续性（不跨边界）
  const nameToLarge = new Map<string, number[]>();
  for (const tile of map.tiles) {
    if (tile.type === 'property' && tile.size === 'large' && tile.span && tile.span > 1) {
      const arr = nameToLarge.get(tile.name) ?? [];
      arr.push(tile.index);
      nameToLarge.set(tile.name, arr);
    }
  }
  for (const [name, indices] of nameToLarge) {
    const sorted = indices.slice().sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      if (curr !== prev + 1) {
        throw new Error(
          `[map-generator] 大块土地 "${name}" 子格不连续: [${sorted.join(',')}]`
        );
      }
    }
  }
}

/**
 * 统计地图中各类地块数量。
 */
export function countTileTypes(map: GameMap): Record<TileType, number> {
  const counts: Partial<Record<TileType, number>> = {};
  for (const tile of map.tiles) {
    counts[tile.type] = (counts[tile.type] ?? 0) + 1;
  }
  return counts as Record<TileType, number>;
}

/**
 * 统计小块土地分组。
 */
export function getPropertyGroups(map: GameMap): { group: number; count: number; indices: number[]; totalPrice: number }[] {
  const groups = new Map<number, { count: number; indices: number[]; totalPrice: number }>();
  for (const tile of map.tiles) {
    if (tile.type === 'property' && tile.size === 'small' && tile.group !== undefined) {
      const g = groups.get(tile.group) ?? { count: 0, indices: [], totalPrice: 0 };
      g.count++;
      g.indices.push(tile.index);
      g.totalPrice += tile.basePrice;
      groups.set(tile.group, g);
    }
  }
  return Array.from(groups.entries())
    .map(([group, data]) => ({ group, ...data }))
    .sort((a, b) => a.group - b.group);
}

/**
 * 生成一张“均衡”的地图：在默认模板基础上尝试多次，选择系统格最分散的一张。
 */
export function generateBalancedMap(
  template: MapTemplate = DEFAULT_TEMPLATE,
  attempts: number = 10
): GameMap {
  let bestMap = generateMap(template);
  let bestScore = evaluateDistribution(bestMap);

  for (let i = 1; i < attempts; i++) {
    const candidate = generateMap({ ...template, seed: (template.seed ?? 0) + i });
    const score = evaluateDistribution(candidate);
    if (score > bestScore) {
      bestMap = candidate;
      bestScore = score;
    }
  }
  return bestMap;
}

function evaluateDistribution(map: GameMap): number {
  // 分数：同类型系统格之间的最小距离之和，越大越分散
  const specialTypes: TileType[] = ['fate', 'chance', 'card', 'tax', 'shop'];
  let score = 0;
  for (const type of specialTypes) {
    const indices = map.tiles.filter((t) => t.type === type).map((t) => t.index);
    if (indices.length <= 1) continue;
    let minDistSum = 0;
    for (let i = 0; i < indices.length; i++) {
      let min = map.path.length;
      for (let j = 0; j < indices.length; j++) {
        if (i === j) continue;
        min = Math.min(min, cyclicDistance(indices[i], indices[j], map.path.length));
      }
      minDistSum += min;
    }
    score += minDistSum;
  }
  // 额外奖励：没有相邻的同类型系统格
  for (let i = 0; i < map.tiles.length; i++) {
    const t = map.tiles[i];
    const next = map.tiles[(i + 1) % map.tiles.length];
    if (t.type === next.type && specialTypes.includes(t.type)) {
      score -= 10;
    }
  }
  return score;
}

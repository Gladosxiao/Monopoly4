/**
 * 大富翁4 地图生成器
 *
 * 提供参数化、可复现的地图生成逻辑，可在浏览器与 Node.js 中离线运行。
 */

import type { GameMap, MapTemplate, Tile, TileType, PropertySize } from './types.js';

export type { GameMap, MapTemplate, Tile, TileType, PropertySize };

// ============ 预设模板 ============

/**
 * 标准模板：参考原版节奏，土地占 55%，系统格分布均匀。
 */
export const DEFAULT_TEMPLATE: MapTemplate = {
  id: 'map_default',
  name: '随机乐园',
  totalTiles: 40,
  largePropertyCount: 6,
  smallPropertyGroups: [2, 2, 3, 2, 3, 2, 2], // 16 个小块，共 22 块可购买土地
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
};

/**
 * 快速模板：系统格更多，地产更紧凑，单局时长更短。
 */
export const FAST_TEMPLATE: MapTemplate = {
  ...DEFAULT_TEMPLATE,
  id: 'map_fast',
  name: '速战速决',
  largePropertyCount: 4,
  smallPropertyGroups: [2, 2, 2, 2, 2, 2, 2, 2], // 16 个小块，共 20 块土地
  specialTiles: {
    ...DEFAULT_TEMPLATE.specialTiles,
    fate: 3,
    chance: 3,
    card: 4,
    tax: 3,
    shop: 2,
    coupon30: 2,
  },
  basePriceRange: [10000, 50000],
};

/**
 * 地产模板：土地比例更高，强调占地策略。
 */
export const ECONOMY_TEMPLATE: MapTemplate = {
  ...DEFAULT_TEMPLATE,
  id: 'map_economy',
  name: '地产为王',
  largePropertyCount: 8,
  smallPropertyGroups: [2, 2, 3, 2, 3, 2, 2, 2], // 18 个小块，分组更细避免连续垄断
  specialTiles: {
    ...DEFAULT_TEMPLATE.specialTiles,
    fate: 3,
    chance: 3,
    card: 3,
    tax: 1,
    shop: 1,
    coupon30: 0,
  },
  basePriceRange: [12000, 70000],
};

/**
 * 4 人桌游模板：人均 1 个大块、3 个小块，卡片/道具获取更充裕。
 *
 * 目标：4 人每局绕 1 圈左右，人均获得卡片+道具约 10 个。
 */
export const PLAYER4_TEMPLATE: MapTemplate = {
  id: 'map_4player',
  name: '四人桌游',
  totalTiles: 40,
  largePropertyCount: 4,
  smallPropertyGroups: [2, 2, 2, 2, 2, 2], // 12 个小块，人均 3 个
  specialTiles: {
    fate: 2,
    chance: 2,
    prison: 1,
    hospital: 1,
    shop: 2,
    card: 5,
    tax: 1,
    coupon10: 2,
    coupon30: 4,
    coupon50: 3,
    park: 0,
    lottery: 0,
    magic: 0,
    news: 0,
    company: 0,
    miniGame: 0,
  },
  basePriceRange: [10000, 55000],
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
  const totalSpecial = Object.values(template.specialTiles).reduce((a, b) => a + b, 0);
  const totalProperty =
    template.largePropertyCount + template.smallPropertyGroups.reduce((a, b) => a + b, 0);
  const expected = 1 + totalSpecial + totalProperty;
  if (expected !== template.totalTiles) {
    throw new Error(
      `[map-generator] 模板格数不匹配: 起点1 + 系统格${totalSpecial} + 土地${totalProperty} = ${expected}, 期望 ${template.totalTiles}`
    );
  }
  return template;
}

const TILE_NAMES: Record<TileType, string> = {
  start: '起点',
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
      if (prevType === type || nextType === type) continue;

      // 与最近同类型格子的距离
      const sameType = placed.filter((p) => p.type === type);
      let minSameTypeDist = slots.length;
      for (const p of sameType) {
        minSameTypeDist = Math.min(minSameTypeDist, cyclicDistance(idx, p.index, slots.length));
      }

      // 避免与其他特殊格过于扎堆
      let clusterPenalty = 0;
      for (const p of placed) {
        const d = cyclicDistance(idx, p.index, slots.length);
        if (d <= 1) clusterPenalty += 1000;
        else if (d === 2) clusterPenalty += 100;
      }

      const score = minSameTypeDist - clusterPenalty + rng.next() * 0.5;
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
  group?: number;
}

function createPropertyPlans(template: MapTemplate): PropertyPlan[] {
  const plans: PropertyPlan[] = [];
  for (let i = 0; i < template.largePropertyCount; i++) plans.push({ size: 'large' });
  template.smallPropertyGroups.forEach((count, groupIdx) => {
    for (let i = 0; i < count; i++) plans.push({ size: 'small', group: groupIdx });
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
    const unassigned = sortedEmpty.filter((i) => !assigned.has(i));
    const start = rng.nextInt(0, Math.max(1, unassigned.length - length + 1));
    return unassigned.slice(start, start + length);
  }
  const chosen = valid[rng.nextInt(0, valid.length)];
  const start = rng.nextInt(0, chosen.length - length + 1);
  return chosen.slice(start, start + length);
}

function fillPropertySlots(
  slots: (Tile | null)[],
  propertyTiles: Tile[],
  rng: SeededRandom
): void {
  const sortedEmpty = slots
    .map((_, i) => i)
    .filter((i) => slots[i] === null)
    .sort((a, b) => a - b);

  if (sortedEmpty.length !== propertyTiles.length) {
    throw new Error(
      `[map-generator] 土地数量不匹配: 空位 ${sortedEmpty.length}, 土地 ${propertyTiles.length}`
    );
  }

  const assigned = new Set<number>();

  // 先放 small 组，尽量连续
  const smallTiles = propertyTiles.filter((t) => t.size === 'small');
  const smallGroups = groupBy(smallTiles, (t) => t.group ?? -1);

  for (const [groupId, tiles] of smallGroups) {
    if (groupId === -1) continue;
    const segment = findEmptySegment(sortedEmpty, assigned, tiles.length, rng);
    for (let i = 0; i < tiles.length; i++) {
      const idx = segment[i];
      tiles[i].index = idx;
      tiles[i].name = `路段${groupId + 1}-${i + 1}`;
      slots[idx] = tiles[i];
      assigned.add(idx);
    }
  }

  // 再放 large，分散布置
  const largeTiles = propertyTiles.filter((t) => t.size === 'large');
  for (const tile of largeTiles) {
    const candidates = sortedEmpty.filter((i) => !assigned.has(i));
    if (candidates.length === 0) throw new Error('[map-generator] 无空位放置大块土地');

    let best = candidates[0];
    let bestScore = -Infinity;
    for (const idx of candidates) {
      const prev = slots[(idx - 1 + slots.length) % slots.length];
      const next = slots[(idx + 1) % slots.length];
      let score = rng.next() * 0.5;
      if (prev?.type === 'property') score -= 3;
      if (next?.type === 'property') score -= 3;

      for (let i = 0; i < slots.length; i++) {
        if (slots[i]?.size === 'large') {
          score += cyclicDistance(idx, i, slots.length) * 0.05;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        best = idx;
      }
    }

    tile.index = best;
    tile.name = `商业用地${largeTiles.indexOf(tile) + 1}`;
    slots[best] = tile;
    assigned.add(best);
  }

  // 兜底
  for (const tile of propertyTiles) {
    if (tile.index !== -1) continue;
    const idx = sortedEmpty.find((i) => !assigned.has(i));
    if (idx === undefined) throw new Error('[map-generator] 仍有未分配土地');
    tile.index = idx;
    slots[idx] = tile;
    assigned.add(idx);
  }
}

function assignPrices(slots: (Tile | null)[], template: MapTemplate): void {
  const properties = slots.filter((t): t is Tile => t !== null && t.type === 'property');
  const total = properties.length;
  const [minPrice, maxPrice] = template.basePriceRange;

  properties.sort((a, b) => a.index - b.index);

  properties.forEach((tile, i) => {
    const progress = total <= 1 ? 0 : i / (total - 1);
    let normalized: number;
    if (template.priceCurve === 'sigmoid') {
      normalized = 1 / (1 + Math.exp(-8 * (progress - 0.5)));
    } else {
      normalized = progress;
    }
    const price = minPrice + normalized * (maxPrice - minPrice);
    const sizeMultiplier = tile.size === 'large' ? 1.3 : 1;
    tile.basePrice = Math.round((price * sizeMultiplier) / 1000) * 1000;
    tile.baseRent = Math.round(tile.basePrice * 0.05 / 100) * 100;
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
  slots[0] = createTile(0, 'start', '起点');

  // 固定关键系统格
  const anchors: { type: TileType; name: string }[] = [];
  if (t.specialTiles.prison > 0) anchors.push({ type: 'prison', name: '监狱' });
  if (t.specialTiles.hospital > 0) anchors.push({ type: 'hospital', name: '医院' });
  if (t.specialTiles.shop > 0) anchors.push({ type: 'shop', name: '商店' });

  const anchorPositions = distributeAnchors(t.totalTiles, anchors.length, rng);
  anchors.forEach((anchor, i) => {
    const pos = anchorPositions[i];
    slots[pos] = createTile(pos, anchor.type, anchor.name);
  });

  // 放置其他系统格（扣除已作为 anchor 固定的关键设施）
  const anchorTypes = new Set<TileType>(anchors.map((a) => a.type));
  const specialTypes = Object.entries(t.specialTiles)
    .filter(([type, count]) => type !== 'start' && type !== 'property' && count > 0)
    .flatMap(([type, count]) => {
      const actualCount = anchorTypes.has(type as TileType) ? Math.max(0, count - 1) : count;
      return Array(actualCount).fill(type as Exclude<TileType, 'start' | 'property'>);
    });
  placeSpecialTiles(slots, specialTypes, rng);

  // 创建并放置土地
  const plans = createPropertyPlans(t);
  const propertyTiles: Tile[] = plans.map((plan) => ({
    index: -1,
    name: plan.size === 'large' ? '商业用地' : '住宅用地',
    type: 'property',
    size: plan.size,
    group: plan.group,
    basePrice: 0,
    baseRent: 0,
    level: 0,
  }));
  fillPropertySlots(slots, propertyTiles, rng);

  // 定价
  assignPrices(slots, t);

  // 组装
  const tiles = slots.filter((tile): tile is Tile => tile !== null);
  tiles.sort((a, b) => a.index - b.index);

  if (tiles.length !== t.totalTiles) {
    throw new Error(`[map-generator] 生成失败: 实际格数 ${tiles.length}`);
  }

  return {
    id: t.id,
    name: t.name,
    path: Array.from({ length: t.totalTiles }, (_, i) => i),
    tiles,
  };
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

/**
 * 神明（神仙）定义配置表
 *
 * 前后端共享，统一维护神明名称、效果、持续天数等元数据。
 * 当前已实现影响过路费的神明：小财神、大财神、小穷神、大穷神。
 * 扩展神明：小福神、大福神、小衰神、大衰神、天使、恶魔、土地公公。
 *
 * 详见 docs/design/09-rent-system.md
 */

export type SpiritType = 'good' | 'bad' | 'neutral';

export interface SpiritDefinition {
  id: string;
  name: string;
  type: SpiritType;
  duration: number; // 持续天数
  canDismiss: boolean; // 是否可被送神符送走
  rentMultiplier?: number; // 过路费倍率（undefined 表示不影响）
  rentExempt?: boolean; // 是否免过路费
  assetKey: string; // 美术资源 key
}

export const SPIRIT_DEFINITIONS: Record<string, SpiritDefinition> = {
  smallWealthGod: {
    id: 'smallWealthGod',
    name: '小财神',
    type: 'good',
    duration: 7,
    canDismiss: false,
    rentMultiplier: 0.5,
    assetKey: 'small_wealth_god',
  },
  bigWealthGod: {
    id: 'bigWealthGod',
    name: '大财神',
    type: 'good',
    duration: 7,
    canDismiss: false,
    rentExempt: true,
    assetKey: 'big_wealth_god',
  },
  smallPovertyGod: {
    id: 'smallPovertyGod',
    name: '小穷神',
    type: 'bad',
    duration: 7,
    canDismiss: true,
    rentMultiplier: 1.5,
    assetKey: 'small_poverty_god',
  },
  bigPovertyGod: {
    id: 'bigPovertyGod',
    name: '大穷神',
    type: 'bad',
    duration: 7,
    canDismiss: true,
    rentMultiplier: 2,
    assetKey: 'big_poverty_god',
  },
  smallFortuneGod: {
    id: 'smallFortuneGod',
    name: '小福神',
    type: 'good',
    duration: 7,
    canDismiss: false,
    assetKey: 'small_fortune_god',
  },
  bigFortuneGod: {
    id: 'bigFortuneGod',
    name: '大福神',
    type: 'good',
    duration: 7,
    canDismiss: false,
    assetKey: 'big_fortune_god',
  },
  smallMisfortuneGod: {
    id: 'smallMisfortuneGod',
    name: '小衰神',
    type: 'bad',
    duration: 7,
    canDismiss: true,
    assetKey: 'small_misfortune_god',
  },
  bigMisfortuneGod: {
    id: 'bigMisfortuneGod',
    name: '大衰神',
    type: 'bad',
    duration: 7,
    canDismiss: true,
    assetKey: 'big_misfortune_god',
  },
  angel: {
    id: 'angel',
    name: '天使',
    type: 'good',
    duration: 7,
    canDismiss: false,
    assetKey: 'angel_spirit',
  },
  devil: {
    id: 'devil',
    name: '恶魔',
    type: 'bad',
    duration: 7,
    canDismiss: true,
    assetKey: 'devil_spirit',
  },
  landGod: {
    id: 'landGod',
    name: '土地公公',
    type: 'good',
    duration: 7,
    canDismiss: false,
    assetKey: 'land_god',
  },
};

export const SPIRIT_IDS = Object.keys(SPIRIT_DEFINITIONS);

export function getSpiritDefinition(id: string): SpiritDefinition | undefined {
  return SPIRIT_DEFINITIONS[id];
}

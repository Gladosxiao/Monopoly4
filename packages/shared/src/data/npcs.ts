// NPC 定义配置表
// 四大恶人、恶犬、乞丐等地图 NPC 的元数据

export type NpcType = 'robber' | 'thief' | 'swindler' | 'hoodlum' | 'dog' | 'beggar';

export interface NpcDefinition {
  id: NpcType;
  name: string;
  description: string;
  duration: number; // 在地图上存活天数
  assetKey: string;
}

export const NPC_DEFINITIONS: Record<NpcType, NpcDefinition> = {
  robber: {
    id: 'robber',
    name: '强盗',
    description: '抢走玩家身上现金的 10%',
    duration: 5,
    assetKey: 'robber',
  },
  thief: {
    id: 'thief',
    name: '小偷',
    description: '随机偷走玩家 1 张卡片或 1 个道具',
    duration: 5,
    assetKey: 'thief',
  },
  swindler: {
    id: 'swindler',
    name: '骗子',
    description: '骗走玩家 5000 现金',
    duration: 5,
    assetKey: 'swindler',
  },
  hoodlum: {
    id: 'hoodlum',
    name: '流氓',
    description: '破坏玩家一处建筑一级',
    duration: 5,
    assetKey: 'hoodlum',
  },
  dog: {
    id: 'dog',
    name: '恶犬',
    description: '咬伤玩家，住院 1 天',
    duration: 3,
    assetKey: 'dog',
  },
  beggar: {
    id: 'beggar',
    name: '乞丐',
    description: '向玩家乞讨 1000 现金',
    duration: 4,
    assetKey: 'beggar',
  },
};

export const NPC_TYPES = Object.keys(NPC_DEFINITIONS) as NpcType[];

export function getNpcDefinition(type: NpcType): NpcDefinition {
  return NPC_DEFINITIONS[type];
}

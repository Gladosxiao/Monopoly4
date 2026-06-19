// 道具定义与定价配置表
// 前后端共享，统一维护道具名称、描述、价格、类型、最大堆叠等元数据

export type ItemType = 'vehicle' | 'trap' | 'tool' | 'research';

export interface ItemDefinition {
  id: string;
  name: string;
  description: string;
  type: ItemType;
  cost: number; // 点券价格（研究所产物无价，cost = 0）
  maxStack: number; // 原版每种道具最多 9 个
  assetKey: string; // 美术资源 key，映射到 /assets/items/{assetKey}.png
  // 载具专属：可选择的骰子数量范围
  diceRange?: [number, number];
}

export const ITEM_DEFINITIONS: Record<string, ItemDefinition> = {
  // ===== 交通工具 =====
  bike: {
    id: 'bike',
    name: '机车',
    description: '骰子数最多增至 2 颗，每回合可选投 1-2 颗',
    type: 'vehicle',
    cost: 80,
    maxStack: 1, // 交通工具唯一
    assetKey: 'bike',
    diceRange: [1, 2],
  },
  car: {
    id: 'car',
    name: '汽车',
    description: '骰子数最多增至 3 颗，每回合可选投 1-3 颗',
    type: 'vehicle',
    cost: 150,
    maxStack: 1,
    assetKey: 'car',
    diceRange: [1, 3],
  },

  // ===== 陷阱 =====
  barrier: {
    id: 'barrier',
    name: '路障',
    description: '放置在道路上，经过者强制停留该格',
    type: 'trap',
    cost: 30,
    maxStack: 9,
    assetKey: 'barrier',
  },
  mine: {
    id: 'mine',
    name: '地雷',
    description: '放置在道路上，踩中者住院 3 天并摧毁坐骑',
    type: 'trap',
    cost: 25,
    maxStack: 9,
    assetKey: 'mine',
  },
  timeBomb: {
    id: 'timeBomb',
    name: '定时炸弹',
    description: '附身后走满 38 步爆炸，范围 3×3，住院 5 天、房屋塌一级',
    type: 'trap',
    cost: 25,
    maxStack: 9,
    assetKey: 'time_bomb',
  },

  // ===== 工具 =====
  remoteDice: {
    id: 'remoteDice',
    name: '遥控骰子',
    description: '控制下一次掷骰的点数（1-6）',
    type: 'tool',
    cost: 30,
    maxStack: 9,
    assetKey: 'remote_dice',
  },
  robotDoll: {
    id: 'robotDoll',
    name: '机器娃娃',
    description: '清除前方 9-10 格内的路障、地雷、定时炸弹等障碍物',
    type: 'tool',
    cost: 15,
    maxStack: 9,
    assetKey: 'robot_doll',
  },
  missile: {
    id: 'missile',
    name: '飞弹',
    description: '发射到地图任意地点，3×3 范围内房屋降一级、人员住院 3 天',
    type: 'tool',
    cost: 100,
    maxStack: 9,
    assetKey: 'missile',
  },

  // ===== 研究所研发产物 =====
  robot: {
    id: 'robot',
    name: '机器人',
    description: '研究所 1 级产物，在指定土地上免费加盖一级',
    type: 'research',
    cost: 0,
    maxStack: 9,
    assetKey: 'robot',
  },
  timeMachine: {
    id: 'timeMachine',
    name: '时光机',
    description: '研究所 2 级产物，令所有人恢复到上一回合的状态',
    type: 'research',
    cost: 0,
    maxStack: 9,
    assetKey: 'time_machine',
  },
  teleporter: {
    id: 'teleporter',
    name: '传送机',
    description: '研究所 3 级产物，将人物/神明/房屋/物品传送到指定地点',
    type: 'research',
    cost: 0,
    maxStack: 9,
    assetKey: 'teleporter',
  },
  engineerTruck: {
    id: 'engineerTruck',
    name: '工程车',
    description: '研究所 4 级产物，走到哪里拆到哪里，持续 7 回合后报废',
    type: 'research',
    cost: 0,
    maxStack: 9,
    assetKey: 'engineer_truck',
  },
  nuke: {
    id: 'nuke',
    name: '核子飞弹',
    description: '研究所 5 级产物，威力范围极大，被炸到住院 5 天',
    type: 'research',
    cost: 0,
    maxStack: 9,
    assetKey: 'nuke',
  },
};

export const ITEM_IDS = Object.keys(ITEM_DEFINITIONS);

export function getItemDefinition(id: string): ItemDefinition | undefined {
  return ITEM_DEFINITIONS[id];
}

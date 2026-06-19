// 卡片定义与定价配置表
// 前后端共享，统一维护卡片名称、描述、价格、类型、目标等元数据

export type CardType = 'attack' | 'defense' | 'control' | 'special';
export type CardTarget = 'self' | 'opponent' | 'tile' | 'global' | 'road';

export interface CardDefinition {
  id: string;
  name: string;
  description: string;
  type: CardType;
  cost: number; // 点券价格
  target: CardTarget;
  maxStack?: number; // 最大持有数量，默认受全局 15 张上限约束
  assetKey: string; // 美术资源 key，映射到 /assets/cards/{assetKey}.png
}

export const CARD_DEFINITIONS: Record<string, CardDefinition> = {
  // ===== 首期建议子集 =====
  turnAround: {
    id: 'turnAround',
    name: '转向卡',
    description: '改变目标玩家下一次行走方向',
    type: 'control',
    cost: 20,
    target: 'opponent',
    assetKey: 'turn_around',
  },
  stay: {
    id: 'stay',
    name: '停留卡',
    description: '令目标玩家下次移动时原地停留一回合',
    type: 'control',
    cost: 20,
    target: 'opponent',
    assetKey: 'stay',
  },
  turtle: {
    id: 'turtle',
    name: '乌龟卡',
    description: '令目标玩家每次只走一步，持续 3 天',
    type: 'control',
    cost: 30,
    target: 'opponent',
    assetKey: 'turtle',
  },
  buyLand: {
    id: 'buyLand',
    name: '购地卡',
    description: '以市价强制购买当前所在土地',
    type: 'attack',
    cost: 50,
    target: 'self',
    assetKey: 'buy_land',
  },
  swapLand: {
    id: 'swapLand',
    name: '换地卡',
    description: '交换两块同等大小土地的所有权',
    type: 'attack',
    cost: 50,
    target: 'tile',
    assetKey: 'swap_land',
  },
  auction: {
    id: 'auction',
    name: '拍卖卡',
    description: '强制拍卖指定土地，所得归使用者',
    type: 'attack',
    cost: 40,
    target: 'tile',
    assetKey: 'auction',
  },
  angel: {
    id: 'angel',
    name: '天使卡',
    description: '指定路段所有建筑加盖一层',
    type: 'special',
    cost: 50,
    target: 'road',
    assetKey: 'angel',
  },
  devil: {
    id: 'devil',
    name: '恶魔卡',
    description: '指定路段所有建筑夷为平地',
    type: 'attack',
    cost: 60,
    target: 'road',
    assetKey: 'devil',
  },
  monster: {
    id: 'monster',
    name: '怪兽卡',
    description: '彻底摧毁一栋建筑',
    type: 'attack',
    cost: 60,
    target: 'tile',
    assetKey: 'monster',
  },
  demolish: {
    id: 'demolish',
    name: '拆除卡',
    description: '拆除建筑一级或路面道具',
    type: 'attack',
    cost: 30,
    target: 'tile',
    assetKey: 'demolish',
  },

  // ===== 扩展卡片 =====
  equalWealth: {
    id: 'equalWealth',
    name: '均富卡',
    description: '将所有玩家的现金重新均分',
    type: 'special',
    cost: 80,
    target: 'global',
    assetKey: 'equal_wealth',
  },
  equalPoverty: {
    id: 'equalPoverty',
    name: '均贫卡',
    description: '指定一名对手，将其与自己的现金相加后平分',
    type: 'attack',
    cost: 70,
    target: 'opponent',
    assetKey: 'equal_poverty',
  },
  swapHouse: {
    id: 'swapHouse',
    name: '换屋卡',
    description: '交换两块同等大小土地上建筑物的等级',
    type: 'attack',
    cost: 50,
    target: 'tile',
    assetKey: 'swap_house',
  },
  rebuild: {
    id: 'rebuild',
    name: '改建卡',
    description: '将小块土地改建成连锁店；或将大块土地改建成指定特殊建筑',
    type: 'special',
    cost: 40,
    target: 'tile',
    assetKey: 'rebuild',
  },
  taxAudit: {
    id: 'taxAudit',
    name: '查税卡',
    description: '令目标玩家立即缴纳现金 20% 的税款',
    type: 'attack',
    cost: 60,
    target: 'opponent',
    assetKey: 'tax_audit',
  },
  priceRise: {
    id: 'priceRise',
    name: '涨价卡',
    description: '令指定路段所有土地过路费翻倍，持续 5 天',
    type: 'special',
    cost: 50,
    target: 'road',
    assetKey: 'price_rise',
  },
  seal: {
    id: 'seal',
    name: '查封卡',
    description: '令指定路段所有土地 5 天内无法收取过路费',
    type: 'special',
    cost: 50,
    target: 'road',
    assetKey: 'seal',
  },
  alliance: {
    id: 'alliance',
    name: '同盟卡',
    description: '与目标玩家结盟 7 天，期间彼此不收过路费',
    type: 'special',
    cost: 80,
    target: 'opponent',
    assetKey: 'alliance',
  },
  snatch: {
    id: 'snatch',
    name: '抢夺卡',
    description: '随机抢夺目标玩家持有的 1 张卡片或 1 个道具',
    type: 'attack',
    cost: 40,
    target: 'opponent',
    assetKey: 'snatch',
  },
  hibernation: {
    id: 'hibernation',
    name: '冬眠卡',
    description: '令所有对手冬眠 5 天，期间无法行动、不能收取过路费',
    type: 'control',
    cost: 80,
    target: 'global',
    assetKey: 'hibernation',
  },
  frame: {
    id: 'frame',
    name: '陷害卡',
    description: '令目标玩家入狱 5 天',
    type: 'control',
    cost: 60,
    target: 'opponent',
    assetKey: 'frame',
  },
  blame: {
    id: 'blame',
    name: '嫁祸卡',
    description: '将本应自己承担的罚金/损失嫁祸给指定对手',
    type: 'defense',
    cost: 60,
    target: 'opponent',
    assetKey: 'blame',
  },
  sleepwalk: {
    id: 'sleepwalk',
    name: '梦游卡',
    description: '令目标玩家梦游 5 天，期间随机行走、不能买地/收租/使用卡片',
    type: 'control',
    cost: 70,
    target: 'opponent',
    assetKey: 'sleepwalk',
  },
  innocence: {
    id: 'innocence',
    name: '免罪卡',
    description: '抵消一次入狱；也可抵御陷害卡、梦游卡、乌龟卡',
    type: 'defense',
    cost: 50,
    target: 'self',
    assetKey: 'innocence',
  },
  dismissSpirit: {
    id: 'dismissSpirit',
    name: '送神符',
    description: '送走当前附身的神明；也可将身上的定时炸弹送走',
    type: 'defense',
    cost: 40,
    target: 'self',
    assetKey: 'dismiss_spirit',
  },
  summonSpirit: {
    id: 'summonSpirit',
    name: '请神符',
    description: '将距离最近的神明立即招来附身',
    type: 'special',
    cost: 50,
    target: 'self',
    assetKey: 'summon_spirit',
  },
  redCard: {
    id: 'redCard',
    name: '红卡',
    description: '令指定公司股票连涨 3 天（涨停）',
    type: 'special',
    cost: 100,
    target: 'global',
    assetKey: 'red_card',
  },
  blackCard: {
    id: 'blackCard',
    name: '黑卡',
    description: '令指定公司股票连跌 3 天（跌停）',
    type: 'special',
    cost: 100,
    target: 'global',
    assetKey: 'black_card',
  },
};

export const CARD_IDS = Object.keys(CARD_DEFINITIONS);

export function getCardDefinition(id: string): CardDefinition | undefined {
  return CARD_DEFINITIONS[id];
}

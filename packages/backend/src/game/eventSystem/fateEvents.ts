import type { FateEvent } from './types.js';
import { hasVehicle, canApplyStatus } from './conditions.js';

export const FATE_EVENTS: FateEvent[] = [
  {
    id: 'fine_littering',
    name: '乱丢垃圾罚款',
    description: '罚款 600 元。',
    weight: 8,
    apply: () => ({
      result: { success: true, message: '乱丢垃圾罚款 600 元' },
      effects: [{ type: 'cash', amount: -600, reason: '乱丢垃圾罚款' }],
    }),
  },
  {
    id: 'lose_wallet',
    name: '遗失钱包',
    description: '损失 1000 元。',
    weight: 6,
    apply: () => ({
      result: { success: true, message: '遗失钱包，损失 1000 元' },
      effects: [{ type: 'cash', amount: -1000, reason: '遗失钱包' }],
    }),
  },
  {
    id: 'fine_jaywalking',
    name: '行人闯越马路',
    description: '罚款 3000 元。',
    weight: 5,
    apply: () => ({
      result: { success: true, message: '行人闯越马路罚款 3000 元' },
      effects: [{ type: 'cash', amount: -3000, reason: '行人闯越马路罚款' }],
    }),
  },
  {
    id: 'fine_helmet',
    name: '骑机车未戴安全帽',
    description: '罚款 3000 元（需骑机车）。',
    weight: 3,
    condition: (ctx) => hasVehicle(ctx, 'bike'),
    apply: () => ({
      result: { success: true, message: '骑机车未戴安全帽罚款 3000 元' },
      effects: [{ type: 'cash', amount: -3000, reason: '骑机车未戴安全帽罚款' }],
    }),
  },
  {
    id: 'fine_speeding',
    name: '汽车超速',
    description: '罚款 3000 元（需开车）。',
    weight: 3,
    condition: (ctx) => hasVehicle(ctx, 'car'),
    apply: () => ({
      result: { success: true, message: '汽车超速罚款 3000 元' },
      effects: [{ type: 'cash', amount: -3000, reason: '汽车超速罚款' }],
    }),
  },
  {
    id: 'pay_insurance',
    name: '付保险费',
    description: '支付 5000 元保险费。',
    weight: 4,
    apply: () => ({
      result: { success: true, message: '支付保险费 5000 元' },
      effects: [{ type: 'cash', amount: -5000, reason: '保险费' }],
    }),
  },
  {
    id: 'loan_fraud',
    name: '人头被盗用冒贷',
    description: '被冒名贷款 10000 元，计入贷款。',
    weight: 3,
    apply: () => ({
      result: { success: true, message: '人头被盗用冒贷，贷款增加 10000 元' },
      effects: [{ type: 'loan', amount: 10000, reason: '人头被盗用冒贷' }],
    }),
  },
  {
    id: 'stock_default',
    name: '股票违约交割',
    description: '损失持有股票的 10%。',
    weight: 3,
    apply: () => ({
      result: { success: true, message: '股票违约交割，损失持股市值 10%' },
      effects: [{ type: 'sellAllStocks', reason: '股票违约交割' }],
    }),
  },
  {
    id: 'pick_money',
    name: '在路边捡到钱',
    description: '获得 1000 元。',
    weight: 7,
    apply: () => ({
      result: { success: true, message: '在路边捡到 1000 元' },
      effects: [{ type: 'cash', amount: 1000, reason: '捡到钱' }],
    }),
  },
  {
    id: 'win_lottery',
    name: '发票中奖',
    description: '获得 4000 元。',
    weight: 5,
    apply: () => ({
      result: { success: true, message: '发票中奖，获得 4000 元' },
      effects: [{ type: 'cash', amount: 4000, reason: '发票中奖' }],
    }),
  },
  {
    id: 'inheritance',
    name: '意外获得遗产',
    description: '获得 10000 元。',
    weight: 2,
    apply: () => ({
      result: { success: true, message: '意外获得遗产 10000 元' },
      effects: [{ type: 'cash', amount: 10000, reason: '意外遗产' }],
    }),
  },
  {
    id: 'birthday',
    name: '今天是你生日',
    description: '向其他每位玩家收取一张卡片。',
    weight: 2,
    apply: () => ({
      result: { success: true, message: '今天是你生日，向其他玩家收取卡片' },
      effects: [{ type: 'takeRandomCardFromEach', reason: '生日收取卡片' }],
    }),
  },
  {
    id: 'alien_abduction',
    name: '被外星人绑架',
    description: '住院/失踪 3 天，无法行动。',
    weight: 2,
    condition: (ctx) => canApplyStatus(ctx, 'hospital'),
    apply: () => ({
      result: { success: true, message: '被外星人绑架，住院 3 天' },
      effects: [{ type: 'status', status: 'hospital', days: 3, reason: '被外星人绑架' }],
    }),
  },
  {
    id: 'forced_travel',
    name: '强迫出国观光',
    description: '出国 3 天，无法行动与收租。',
    weight: 2,
    condition: (ctx) => canApplyStatus(ctx, 'abroad'),
    apply: () => ({
      result: { success: true, message: '强迫出国观光 3 天' },
      effects: [{ type: 'status', status: 'abroad', days: 3, reason: '强迫出国观光' }],
    }),
  },
  {
    id: 'fall_ditch',
    name: '掉进水沟',
    description: '就医 3 天。',
    weight: 3,
    condition: (ctx) => canApplyStatus(ctx, 'hospital'),
    apply: () => ({
      result: { success: true, message: '掉进水沟，就医 3 天' },
      effects: [{ type: 'status', status: 'hospital', days: 3, reason: '掉进水沟' }],
    }),
  },
  {
    id: 'jail_drunk',
    name: '酒醉大闹警局',
    description: '坐牢 3 天。',
    weight: 3,
    condition: (ctx) => canApplyStatus(ctx, 'jail'),
    apply: () => ({
      result: { success: true, message: '酒醉大闹警局，坐牢 3 天' },
      effects: [{ type: 'status', status: 'jail', days: 3, reason: '酒醉大闹警局' }],
    }),
  },
  {
    id: 'jail_assault',
    name: '殴打警员',
    description: '坐牢 5 天。',
    weight: 2,
    condition: (ctx) => canApplyStatus(ctx, 'jail'),
    apply: () => ({
      result: { success: true, message: '殴打警员，坐牢 5 天' },
      effects: [{ type: 'status', status: 'jail', days: 5, reason: '殴打警员' }],
    }),
  },
  {
    id: 'jail_smuggling',
    name: '走私毒品',
    description: '坐牢 7 天。',
    weight: 1,
    condition: (ctx) => canApplyStatus(ctx, 'jail'),
    apply: () => ({
      result: { success: true, message: '走私毒品，坐牢 7 天' },
      effects: [{ type: 'status', status: 'jail', days: 7, reason: '走私毒品' }],
    }),
  },
  {
    id: 'sell_all_stocks',
    name: '变卖所有股票求现',
    description: '强制卖出玩家持有的全部股票，获得现金。',
    weight: 2,
    apply: () => ({
      result: { success: true, message: '变卖所有股票求现' },
      effects: [{ type: 'sellAllStocks', reason: '变卖所有股票求现' }],
    }),
  },
  {
    id: 'lose_bike',
    name: '机车被偷遗失',
    description: '失去机车，恢复步行。',
    weight: 2,
    condition: (ctx) => hasVehicle(ctx, 'bike'),
    apply: () => ({
      result: { success: true, message: '机车被偷遗失，恢复步行' },
      effects: [{ type: 'loseVehicle', reason: '机车被偷遗失' }],
    }),
  },
  {
    id: 'lose_car',
    name: '汽车撞电线杆全毁',
    description: '失去汽车，恢复步行。',
    weight: 2,
    condition: (ctx) => hasVehicle(ctx, 'car'),
    apply: () => ({
      result: { success: true, message: '汽车撞电线杆全毁，恢复步行' },
      effects: [{ type: 'loseVehicle', reason: '汽车撞电线杆全毁' }],
    }),
  },
];

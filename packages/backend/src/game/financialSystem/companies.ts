import type { Company, CompanyType, GameState, Player } from '@monopoly4/shared';

export interface CompanyArrivalResult {
  success: boolean;
  message?: string;
  effects?: { type: 'cash' | 'status'; amount?: number; status?: string; days?: number; reason: string }[];
}

function spinWheel(sides: number): number {
  return Math.floor(Math.random() * sides) + 1;
}

function isChairman(player: Player, company: Company): boolean {
  return company.chairmanPlayerId === player.id;
}

function transferToBank(
  state: GameState,
  player: Player,
  company: Company,
  amount: number,
  reason: string
): void {
  if (amount <= 0) return;
  if (player.cash >= amount) {
    player.cash -= amount;
  } else {
    const total = player.cash + player.deposit;
    if (total >= amount) {
      const fromDeposit = amount - player.cash;
      player.cash = 0;
      player.deposit -= fromDeposit;
    } else {
      player.cash = 0;
      player.deposit = 0;
      player.isBankrupt = true;
      state.logs.push({
        timestamp: Date.now(),
        type: 'player:bankrupt',
        actorId: player.id,
        message: `${player.username} 资金不足，破产了！`,
      });
    }
  }
  state.logs.push({
    timestamp: Date.now(),
    type: 'company:fee',
    actorId: player.id,
    targetId: company.chairmanPlayerId,
    message: `${player.username} 支付 ${company.name} ${reason} $${amount}`,
  });
}

/**
 * 玩家走到公司企业地块时触发特效。
 */
export function handleCompanyArrival(
  state: GameState,
  player: Player,
  company: Company
): CompanyArrivalResult {
  switch (company.type) {
    case 'airline': {
      const days = spinWheel(6) - 1; // 0-5
      if (days <= 0) {
        return { success: true, message: `${player.username} 搭乘航班但选择不出国` };
      }
      const fee = days * 1000;
      transferToBank(state, player, company, fee, '出国费用');
      player.statusEffects.push({ type: 'abroad', remainingDays: days });
      return {
        success: true,
        message: `${player.username} 出国 ${days} 天，花费 $${fee}`,
      };
    }
    case 'computer': {
      const fee = 500;
      if (isChairman(player, company)) {
        return { success: true, message: `${player.username} 是 ${company.name} 董事长，免电脑使用费` };
      }
      transferToBank(state, player, company, fee, '电脑使用费');
      return { success: true, message: `${player.username} 支付电脑使用费 $${fee}` };
    }
    case 'insurance': {
      const days = spinWheel(4) * 5; // 5,10,15,20
      const premium = days * 200;
      transferToBank(state, player, company, premium, '保险费');
      player.insuranceDays = days;
      player.statusEffects.push({ type: 'insurance', remainingDays: days, data: { premium } });
      return { success: true, message: `${player.username} 投保 ${days} 天，支付保费 $${premium}` };
    }
    case 'automobile': {
      if (player.vehicle !== 'car') {
        return { success: true, message: `${player.username} 没有汽车，免保养费` };
      }
      const fee = 1000;
      if (isChairman(player, company)) {
        return { success: true, message: `${player.username} 是 ${company.name} 董事长，免保养费` };
      }
      transferToBank(state, player, company, fee, '汽车保养费');
      return { success: true, message: `${player.username} 支付汽车保养费 $${fee}` };
    }
    case 'petroleum': {
      if (player.vehicle === 'walk') {
        return { success: true, message: `${player.username} 步行，免加油费` };
      }
      const fee = player.vehicle === 'car' ? 1500 : 800;
      if (isChairman(player, company)) {
        return { success: true, message: `${player.username} 是 ${company.name} 董事长，免加油费` };
      }
      transferToBank(state, player, company, fee, '加油费');
      return { success: true, message: `${player.username} 支付加油费 $${fee}` };
    }
    case 'hotel': {
      if (isChairman(player, company)) {
        player.coupons += 10;
        return { success: true, message: `${player.username} 是 ${company.name} 董事长，获得 10 点券` };
      }
      const fee = 2000;
      transferToBank(state, player, company, fee, '住宿费');
      return { success: true, message: `${player.username} 支付住宿费 $${fee}` };
    }
    case 'restaurant': {
      if (isChairman(player, company)) {
        player.cash += 500;
        return { success: true, message: `${player.username} 是 ${company.name} 董事长，获得餐补 $500` };
      }
      const fee = 800;
      transferToBank(state, player, company, fee, '餐费');
      return { success: true, message: `${player.username} 支付餐费 $${fee}` };
    }
    case 'departmentStore': {
      if (isChairman(player, company)) {
        return { success: true, message: `${player.username} 是 ${company.name} 董事长，可免费领取商品` };
      }
      const fee = 1000;
      transferToBank(state, player, company, fee, '购物费');
      return { success: true, message: `${player.username} 支付购物费 $${fee}` };
    }
    case 'construction': {
      if (isChairman(player, company)) {
        return { success: true, message: `${player.username} 是 ${company.name} 董事长，可免费施工` };
      }
      const fee = 1500;
      transferToBank(state, player, company, fee, '工程费');
      return { success: true, message: `${player.username} 支付工程费 $${fee}` };
    }
    default:
      return { success: false, message: '未知公司类型' };
  }
}

/**
 * 对公司处以罚款，从公司累计盈余中扣除。
 */
export function applyCompanyFine(state: GameState, companyId: string, amount: number): void {
  const company = state.companies.find((c) => c.id === companyId);
  if (!company) return;
  company.totalProfit -= amount;
  company.profit -= amount;
  state.logs.push({
    timestamp: Date.now(),
    type: 'company:fine',
    targetId: companyId,
    message: `${company.name} 被罚款 $${amount}，累计盈余 $${company.totalProfit}`,
  });
}

/**
 * 给公司增加盈利，并计入累计盈余。
 */
export function applyCompanyProfit(state: GameState, companyId: string, amount: number): void {
  const company = state.companies.find((c) => c.id === companyId);
  if (!company) return;
  company.profit += amount;
  company.totalProfit += amount;
  state.logs.push({
    timestamp: Date.now(),
    type: 'company:profit',
    targetId: companyId,
    message: `${company.name} 获利 $${amount}，累计盈余 $${company.totalProfit}`,
  });
}

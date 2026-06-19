import type { GameState, Player, Tile, StatusEffectType, VehicleType } from '@monopoly4/shared';

export type EventResult = {
  success: boolean;
  message?: string;
};

export type EventTrigger = 'fate' | 'chance' | 'news';

export interface EventContext {
  state: GameState;
  player: Player;
  tile: Tile;
  triggeredBy: EventTrigger;
}

export type EventEffect =
  | { type: 'cash'; amount: number; reason: string }
  | { type: 'loan'; amount: number; reason: string }
  | { type: 'status'; status: StatusEffectType; days: number; reason: string }
  | { type: 'sellAllStocks'; reason: string }
  | { type: 'takeRandomCardFromEach'; reason: string }
  | { type: 'loseVehicle'; reason: string }
  | { type: 'companyFine'; companyId: string; amount: number; reason: string }
  | { type: 'companyProfit'; companyId: string; amount: number; reason: string }
  | { type: 'stockMarketMove'; direction: 'up' | 'down'; percent: number; reason: string }
  | { type: 'suspendStock'; stockId: string; days: number; reason: string }
  | { type: 'releaseAll'; status: 'jail' | 'hospital'; reason: string }
  | { type: 'extendAll'; status: 'jail' | 'hospital'; days: number; reason: string }
  | { type: 'taxAll'; taxType: 'income' | 'land' | 'stock'; rate: number; reason: string }
  | { type: 'auctionRandomLand'; reason: string }
  | { type: 'award'; target: 'richest' | 'poorest' | 'stockRichest'; amount: number; reason: string }
  | { type: 'bankRun'; days: number; reason: string }
  | { type: 'bankBonus'; rate: number; reason: string }
  | { type: 'freezeVehicle'; vehicle: VehicleType; days: number; reason: string }
  | { type: 'destroyRandomBuilding'; reason: string };

export type FateEventId =
  | 'fine_littering'
  | 'fine_jaywalking'
  | 'fine_helmet'
  | 'fine_speeding'
  | 'lose_wallet'
  | 'pay_insurance'
  | 'loan_fraud'
  | 'stock_default'
  | 'pick_money'
  | 'win_lottery'
  | 'inheritance'
  | 'birthday'
  | 'alien_abduction'
  | 'forced_travel'
  | 'fall_ditch'
  | 'jail_drunk'
  | 'jail_assault'
  | 'jail_smuggling'
  | 'sell_all_stocks'
  | 'lose_bike'
  | 'lose_car';

export interface FateEvent {
  id: FateEventId;
  name: string;
  description: string;
  weight: number;
  /** 是否为负面事件，拥有土地公/天使的玩家可 100% 挡下 */
  isNegative?: boolean;
  condition?: (ctx: EventContext) => boolean;
  apply: (ctx: EventContext) => { result: EventResult; effects: EventEffect[] };
}

export type NewsCategory =
  | 'irresponsible'
  | 'traffic'
  | 'finance'
  | 'government'
  | 'social'
  | 'weather';

export type NewsEventId =
  | 'prison_extend'
  | 'prison_release'
  | 'hospital_extend'
  | 'hospital_release'
  | 'rain_walkers'
  | 'traffic_jam'
  | 'market_crash'
  | 'market_boom'
  | 'bank_run'
  | 'bank_bonus'
  | 'company_noise'
  | 'company_sewage'
  | 'company_overseas_profit'
  | 'public_auction'
  | 'subsidy_poorest'
  | 'pricest_rise'
  | 'income_tax'
  | 'land_tax'
  | 'stock_tax'
  | 'alien_attack'
  | 'suspend_trading';

export interface NewsEvent {
  id: NewsEventId;
  name: string;
  description: string;
  category: NewsCategory;
  weight: number;
  /** 是否为负面事件，拥有土地公/天使的玩家可 100% 挡下 */
  isNegative?: boolean;
  condition?: (ctx: EventContext) => boolean;
  apply: (ctx: EventContext) => { result: EventResult; effects: EventEffect[] };
}

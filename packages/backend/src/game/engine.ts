import {
  type GameState,
  type GameConfig,
  type Player,
  type Tile,
  type GameLog,
  type RoomPlayer,
  SIMPLE_MAP,
  CHARACTERS,
} from '@monopoly4/shared';

export function createGame(roomId: string, config: GameConfig, roomPlayers: RoomPlayer[]): GameState {
  const players: Player[] = roomPlayers.map((rp, i) => {
    const char = CHARACTERS.find((c) => c.id === rp.characterId) || CHARACTERS[i % CHARACTERS.length];
    return {
      id: rp.userId,
      username: rp.username,
      characterId: char.id,
      seatIndex: rp.seatIndex,
      color: char.color,
      cash: config.totalFunds,
      deposit: 0,
      loan: 0,
      coupons: 300,
      position: 0,
      properties: [],
      cards: [],
      items: [],
      isBankrupt: false,
      isAI: false,
    };
  });

  return {
    roomId,
    status: 'rolling',
    config,
    map: JSON.parse(JSON.stringify(SIMPLE_MAP)),
    players,
    currentPlayerIndex: 0,
    day: 1,
    month: 1,
    priceIndex: 1,
    logs: [
      {
        timestamp: Date.now(),
        type: 'game:start',
        message: '游戏开始！',
      },
    ],
  };
}

export function getDiceCount(moveMode: GameConfig['moveMode']): number {
  switch (moveMode) {
    case 'bike':
      return 2;
    case 'car':
      return 3;
    default:
      return 1;
  }
}

export function rollDice(count: number): number {
  let sum = 0;
  for (let i = 0; i < count; i++) {
    sum += Math.floor(Math.random() * 6) + 1;
  }
  return sum;
}

export function getCurrentPlayer(state: GameState): Player {
  return state.players[state.currentPlayerIndex];
}

export function calculateRent(tile: Tile, owner: Player, allTiles: Tile[], priceIndex: number): number {
  if (tile.type !== 'property' || !tile.ownerId || tile.ownerId !== owner.id) return 0;
  let groupBonus = 0;
  if (tile.group !== undefined) {
    const groupTiles = allTiles.filter((t) => t.group === tile.group && t.ownerId === owner.id);
    if (groupTiles.length >= 2) groupBonus = 0.2;
    if (groupTiles.length >= 3) groupBonus = 0.5;
  }
  return Math.floor(tile.baseRent * (1 + tile.level * 0.5) * (1 + groupBonus) * priceIndex);
}

export function movePlayer(state: GameState, steps: number): GameState {
  const player = getCurrentPlayer(state);
  const oldPos = player.position;
  const pathLength = state.map.path.length;
  const newPos = (oldPos + steps) % pathLength;
  player.position = newPos;

  // 经过起点奖励
  if (newPos < oldPos) {
    const salary = 10000;
    player.cash += salary;
    state.logs.push({
      timestamp: Date.now(),
      type: 'player:salary',
      actorId: player.id,
      message: `${player.username} 经过起点领取工资 $${salary}`,
    });
  }

  state.lastRoll = steps;
  state.pendingTileIndex = newPos;
  state.status = 'acting';

  const tile = state.map.tiles[newPos];
  state.logs.push({
    timestamp: Date.now(),
    type: 'player:move',
    actorId: player.id,
    message: `${player.username} 掷出 ${steps} 点，移动到 ${tile.name}`,
  });

  return state;
}

export function handleTileEffect(state: GameState): GameState {
  const player = getCurrentPlayer(state);
  const tileIndex = state.pendingTileIndex ?? player.position;
  const tile = state.map.tiles[tileIndex];

  if (tile.type === 'property') {
    if (!tile.ownerId) {
      // 空地，等待玩家决策
      return state;
    } else if (tile.ownerId === player.id) {
      // 自己的地，可升级
      return state;
    } else {
      // 付过路费
      const owner = state.players.find((p) => p.id === tile.ownerId);
      if (owner && !owner.isBankrupt) {
        const rent = calculateRent(tile, owner, state.map.tiles, state.priceIndex);
        if (player.cash >= rent) {
          player.cash -= rent;
          owner.cash += rent;
          state.logs.push({
            timestamp: Date.now(),
            type: 'player:rent',
            actorId: player.id,
            targetId: owner.id,
            message: `${player.username} 支付过路费 $${rent} 给 ${owner.username}`,
          });
        } else {
          // 现金不足，从存款扣
          const total = player.cash + player.deposit;
          if (total >= rent) {
            const fromDeposit = rent - player.cash;
            player.cash = 0;
            player.deposit -= fromDeposit;
            owner.cash += rent;
            state.logs.push({
              timestamp: Date.now(),
              type: 'player:rent',
              actorId: player.id,
              targetId: owner.id,
              message: `${player.username} 支付过路费 $${rent} 给 ${owner.username}`,
            });
          } else {
            player.cash = 0;
            player.deposit = 0;
            owner.cash += total;
            state.logs.push({
              timestamp: Date.now(),
              type: 'player:bankrupt',
              actorId: player.id,
              message: `${player.username} 资金不足，破产了！`,
            });
            player.isBankrupt = true;
          }
        }
      }
    }
  } else if (tile.type === 'tax') {
    const tax = 5000;
    player.cash -= tax;
    state.logs.push({
      timestamp: Date.now(),
      type: 'player:tax',
      actorId: player.id,
      message: `${player.username} 缴纳税款 $${tax}`,
    });
  } else if (tile.type === 'card') {
    player.coupons += 30;
    state.logs.push({
      timestamp: Date.now(),
      type: 'player:coupon',
      actorId: player.id,
      message: `${player.username} 获得 30 点券`,
    });
  } else if (tile.type === 'coupon30') {
    player.coupons += 30;
    state.logs.push({
      timestamp: Date.now(),
      type: 'player:coupon',
      actorId: player.id,
      message: `${player.username} 获得 30 点券`,
    });
  } else if (tile.type === 'fate' || tile.type === 'chance') {
    // MVP 简化为随机小额金钱事件
    const amount = Math.floor(Math.random() * 5000) - 2000;
    player.cash += amount;
    state.logs.push({
      timestamp: Date.now(),
      type: 'player:fate',
      actorId: player.id,
      message: `${player.username} 触发${tile.type === 'fate' ? '命运' : '机会'}事件，${amount >= 0 ? '获得' : '损失'} $${Math.abs(amount)}`,
    });
  }

  return state;
}

export function buyProperty(state: GameState): { success: boolean; message?: string } {
  const player = getCurrentPlayer(state);
  const tileIndex = state.pendingTileIndex ?? player.position;
  const tile = state.map.tiles[tileIndex];

  if (tile.type !== 'property') {
    return { success: false, message: '当前地块不可购买' };
  }
  if (tile.ownerId) {
    return { success: false, message: '该地块已有主人' };
  }
  const price = Math.floor(tile.basePrice * state.priceIndex);
  if (player.cash < price) {
    return { success: false, message: '现金不足' };
  }

  player.cash -= price;
  tile.ownerId = player.id;
  tile.level = 0;
  player.properties.push(tileIndex);
  state.logs.push({
    timestamp: Date.now(),
    type: 'player:buy',
    actorId: player.id,
    message: `${player.username} 购买 ${tile.name}，花费 $${price}`,
  });
  return { success: true };
}

export function upgradeProperty(state: GameState): { success: boolean; message?: string } {
  const player = getCurrentPlayer(state);
  const tileIndex = state.pendingTileIndex ?? player.position;
  const tile = state.map.tiles[tileIndex];

  if (tile.type !== 'property' || tile.ownerId !== player.id) {
    return { success: false, message: '只能升级自己的土地' };
  }
  if (tile.level >= 5) {
    return { success: false, message: '已达到最高等级' };
  }
  const cost = Math.floor(tile.basePrice * (tile.level + 1) * 0.5 * state.priceIndex);
  if (player.cash < cost) {
    return { success: false, message: '现金不足' };
  }

  player.cash -= cost;
  tile.level += 1;
  state.logs.push({
    timestamp: Date.now(),
    type: 'player:upgrade',
    actorId: player.id,
    message: `${player.username} 升级 ${tile.name} 到 ${tile.level} 级，花费 $${cost}`,
  });
  return { success: true };
}

export function endTurn(state: GameState): GameState {
  // 先处理地块效果
  state = handleTileEffect(state);

  // 找到下一个未破产玩家
  let nextIndex = (state.currentPlayerIndex + 1) % state.players.length;
  let loops = 0;
  while (state.players[nextIndex].isBankrupt && loops < state.players.length) {
    nextIndex = (nextIndex + 1) % state.players.length;
    loops++;
  }

  const activePlayers = state.players.filter((p) => !p.isBankrupt);
  if (activePlayers.length <= 1) {
    state.status = 'ended';
    state.winnerId = activePlayers[0]?.id;
    state.logs.push({
      timestamp: Date.now(),
      type: 'game:end',
      message: `游戏结束，${activePlayers[0]?.username} 获胜！`,
    });
    return state;
  }

  if (nextIndex <= state.currentPlayerIndex) {
    state.day += 1;
    if (state.day > 30) {
      state.month += 1;
      state.day = 1;
      state.priceIndex = Math.min(6, calculatePriceIndex(state));
    }
  }

  state.currentPlayerIndex = nextIndex;
  state.status = 'rolling';
  state.lastRoll = undefined;
  state.pendingTileIndex = undefined;

  return state;
}

export function calculatePriceIndex(state: GameState): number {
  const totalFunds = state.config.totalFunds * state.players.length;
  const totalAssets = state.players.reduce((sum, p) => {
    if (p.isBankrupt) return sum;
    const propertyValue = p.properties.reduce((v, idx) => {
      const tile = state.map.tiles[idx];
      return v + tile.basePrice * (1 + tile.level * 0.5);
    }, 0);
    return sum + p.cash + p.deposit + propertyValue;
  }, 0);
  return Math.max(1, totalAssets / totalFunds);
}

export function canRoll(state: GameState, playerId: string): boolean {
  return state.status === 'rolling' && getCurrentPlayer(state).id === playerId;
}

export function canBuy(state: GameState, playerId: string): boolean {
  if (state.status !== 'acting' || getCurrentPlayer(state).id !== playerId) return false;
  const tile = state.map.tiles[state.pendingTileIndex ?? getCurrentPlayer(state).position];
  return tile.type === 'property' && !tile.ownerId;
}

export function canUpgrade(state: GameState, playerId: string): boolean {
  if (state.status !== 'acting' || getCurrentPlayer(state).id !== playerId) return false;
  const tile = state.map.tiles[state.pendingTileIndex ?? getCurrentPlayer(state).position];
  return tile.type === 'property' && tile.ownerId === playerId && tile.level < 5;
}

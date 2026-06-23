/**
 * 游戏不变量校验器
 *
 * 在每次状态更新后检查游戏规则的一致性，
 * 发现违规时返回 Issue 列表。
 */

import type { GameState, Player } from '@monopoly4/shared';
import type { Issue, IssueSeverity } from '../types.js';

/**
 * 校验游戏状态的所有不变量。
 * 返回发现的问题列表。
 */
export function validateGameState(state: GameState, turn: number): Issue[] {
  const issues: Issue[] = [];

  // 1. 非破产玩家资金非负
  for (const player of state.players) {
    if (!player.isBankrupt && player.cash < 0) {
      issues.push({
        severity: 'critical',
        category: '资金异常',
        turn,
        playerId: player.id,
        expected: '非破产玩家 cash >= 0',
        actual: `cash = ${player.cash}`,
        details: `玩家 ${player.username} (${player.id}) 现金为负`,
      });
    }
    if (!player.isBankrupt && (player.cash + player.deposit - player.loan) < -10000) {
      // 允许小范围负数（因为贷款等操作可能导致短暂负值）
      issues.push({
        severity: 'high',
        category: '资金异常',
        turn,
        playerId: player.id,
        expected: '净资产不低于 -10000',
        actual: `cash + deposit - loan = ${player.cash + player.deposit - player.loan}`,
      });
    }
  }

  // 2. 玩家位置合法
  const tileCount = state.map.tiles.length;
  for (const player of state.players) {
    if (player.position < 0 || player.position >= tileCount) {
      issues.push({
        severity: 'critical',
        category: '位置异常',
        turn,
        playerId: player.id,
        expected: `position 在 [0, ${tileCount}) 范围内`,
        actual: `position = ${player.position}`,
      });
    }
  }

  // 3. 游戏阶段合法
  const validPhases = ['waiting', 'rolling', 'moving', 'acting', 'minigame', 'ended'];
  if (!validPhases.includes(state.status)) {
    issues.push({
      severity: 'critical',
      category: '阶段异常',
      turn,
      expected: `status 在 [${validPhases.join(', ')}] 中`,
      actual: `status = ${state.status}`,
    });
  }

  // 4. 地产 owner 存在
  for (const tile of state.map.tiles) {
    if (tile.ownerId) {
      const owner = state.players.find((p) => p.id === tile.ownerId);
      if (!owner) {
        issues.push({
          severity: 'high',
          category: '地产归属异常',
          turn,
          expected: `tile[${tile.index}].ownerId 指向存在的玩家`,
          actual: `ownerId = ${tile.ownerId}，但找不到该玩家`,
        });
      }
    }
  }

  // 5. 卡片/道具数量限制
  for (const player of state.players) {
    if (player.cards.length > 15) {
      issues.push({
        severity: 'medium',
        category: '背包溢出',
        turn,
        playerId: player.id,
        expected: '卡片数量 <= 15',
        actual: `cards = ${player.cards.length}`,
      });
    }
    for (const item of player.items) {
      if (item.quantity > 9) {
        issues.push({
          severity: 'medium',
          category: '背包溢出',
          turn,
          playerId: player.id,
          expected: '道具堆叠 <= 9',
          actual: `${item.itemId} quantity = ${item.quantity}`,
        });
      }
    }
  }

  // 6. 股票持股合法
  if (state.stocks) {
    for (const player of state.players) {
      for (const [stockId, holding] of Object.entries(player.stockHoldings)) {
        const stock = state.stocks.find((s) => s.id === stockId);
        if (stock && holding > stock.totalShares) {
          issues.push({
            severity: 'high',
            category: '股票异常',
            turn,
            playerId: player.id,
            expected: `持股 <= totalShares (${stock.totalShares})`,
            actual: `${stockId} holding = ${holding}`,
          });
        }
        if (holding < 0) {
          issues.push({
            severity: 'critical',
            category: '股票异常',
            turn,
            playerId: player.id,
            expected: '持股 >= 0',
            actual: `${stockId} holding = ${holding}`,
          });
        }
      }
    }
  }

  // 7. 地产等级合法
  for (const tile of state.map.tiles) {
    if (tile.type === 'property' && tile.ownerId) {
      if (tile.level < 0 || tile.level > 5) {
        issues.push({
          severity: 'high',
          category: '等级异常',
          turn,
          expected: 'tile.level 在 [0, 5] 范围内',
          actual: `tile[${tile.index}].level = ${tile.level}`,
        });
      }
    }
  }

  // 8. 日志中无 error 类型消息（游戏逻辑错误）
  const recentLogs = state.logs.slice(-20);
  for (const log of recentLogs) {
    if (log.type === 'error' || log.type === 'game:error') {
      issues.push({
        severity: 'high',
        category: '游戏错误日志',
        turn,
        expected: '日志中无 error 类型',
        actual: `发现 error 日志: ${log.message}`,
        details: log.message,
      });
    }
  }

  // 9. currentPlayerIndex 合法
  if (state.status !== 'ended' && state.status !== 'waiting') {
    const cp = state.players[state.currentPlayerIndex];
    if (!cp) {
      issues.push({
        severity: 'critical',
        category: '回合异常',
        turn,
        expected: 'currentPlayerIndex 指向有效玩家',
        actual: `currentPlayerIndex = ${state.currentPlayerIndex}，但玩家列表长度 = ${state.players.length}`,
      });
    } else if (cp.isBankrupt && state.status === 'rolling') {
      // 跳过破产玩家是正常的，但记录一下
      // 这不算 bug，因为 endTurn 会自动跳过破产玩家
    }
  }

  return issues;
}

/**
 * 校验单个动作执行后的状态变化。
 * 检查特定动作的预期结果。
 */
export function validateAction(
  state: GameState,
  action: string,
  playerId: string,
  turn: number
): Issue[] {
  const issues: Issue[] = [];
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return issues;

  // 买地后，玩家应拥有该地产
  if (action === 'buyProperty' && state.pendingTileIndex !== undefined) {
    const tile = state.map.tiles[state.pendingTileIndex];
    if (tile && tile.ownerId === playerId && !player.properties.includes(state.pendingTileIndex)) {
      issues.push({
        severity: 'high',
        category: '地产一致性',
        turn,
        playerId,
        action,
        expected: `玩家 properties 包含 tile ${state.pendingTileIndex}`,
        actual: `properties = [${player.properties.join(', ')}]`,
      });
    }
  }

  return issues;
}

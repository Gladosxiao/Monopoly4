import {
  type GameState,
  type GameLog,
  type Player,
  type Tile,
  type CardUseTarget,
  type ItemUseTarget,
  type BuildingType,
  CARD_DEFINITIONS,
  ITEM_DEFINITIONS,
  NPC_DEFINITIONS,
  SPIRIT_DEFINITIONS,
  DEFAULT_GAME_CONFIG,
  CHARACTERS,
} from '@monopoly4/shared';
import { getCurrentUser } from '../state/user.js';
import { getCurrentGame, setCurrentGame } from '../state/game.js';
import {
  createBoardCanvas,
  renderBoard,
  getTileIndexAt,
  preloadTokenImages,
  getCurrentBoardLayout,
  isMoveAnimating,
  isPlayerMoveAnimating,
  getPlayerAnimatedTileIndex,
  stopMoveAnimationNow,
} from '../board.js';
import { startMoveAnimation } from '../moveAnimation.js';
import { createTestPanel, isTestMode } from '../testMode/index.js';
import { registerCleanup, navigateToLogin, navigateToLobby } from '../router.js';
import { showToast, showPrompt, escapeHtml, showBanner } from '../ui/common.js';
import { launchMiniGame } from '../minigames/index.js';
import { StockChart } from '../stockChart.js';
import {
  rollDice,
  buyProperty,
  upgradeProperty,
  rebuildTile,
  useCard,
  buyCard,
  useItem,
  buyItem,
  tradeStock,
  claimInsurance,
  takeLoan,
  repayLoan,
  placeLotteryBet,
  castMagicSpell,
  skipTurn,
  rescueNpc,
  submitMiniGameResult,
  onGameState,
  onError,
} from '../socket.js';

const app = document.getElementById('app')!;

let isStockCollapsed = false;
let isStockChartCollapsed = false;
let isBackpackCollapsed = false;
let boardZoom = Math.max(0.5, Math.min(2.5, Number(localStorage.getItem('monopoly4-board-zoom') || '1')));
let gameCanvas: HTMLCanvasElement | null = null;
let currentHoverIndex = -1;
let currentHoverPixel: { x: number; y: number } | undefined;
let lastBannerLogTimestamp = 0;

/** 当前 K 线图选中的股票 ID（点击股票行时设置） */
let selectedStockId: string | null = null;
/** K 线图组件实例 */
let stockChartInstance: StockChart | null = null;

/** 需要 Banner 强提醒的日志类型 */
const BANNER_LOG_TYPES = new Set([
  'event:triggered',
  'player:tax',
  'player:rent',
  'rent:detail',
  'player:hospital',
  'player:jail',
  'player:coupon',
  'player:card',
  'player:lotteryWin',
  'game:lotteryDraw',
  'item:vehicle',
  'event:loseVehicle',
]);

function maybeShowEventBanners(logs: GameLog[]): void {
  for (const log of logs) {
    if (log.timestamp <= lastBannerLogTimestamp) continue;
    if (!BANNER_LOG_TYPES.has(log.type)) continue;

    let type: 'info' | 'error' | 'success' | 'warning' = 'info';
    if (log.type === 'player:tax' || log.type === 'player:rent' || log.type === 'event:loseVehicle') {
      type = 'warning';
    } else if (log.type === 'player:coupon' || log.type === 'player:lotteryWin' || log.type === 'game:lotteryDraw') {
      type = 'success';
    }
    showBanner(log.message, type, 4500);
    lastBannerLogTimestamp = Math.max(lastBannerLogTimestamp, log.timestamp);
  }
}

/** 小游戏状态 */
let activeMiniGameType: string | undefined;
let isMiniGameActive = false;

/** 地图选块模式：等待用户点击地图选择目标地块 */
let tileSelectionResolver: ((index: number) => void) | null = null;
let tileSelectionCancel: (() => void) | null = null;
let tileSelectionFilter: ((tile: Tile) => boolean) | null = null;

/** 颜色映射：卡片类型 → 背景色 */
const CARD_TYPE_COLORS: Record<string, string> = {
  attack: '#e74c3c',
  defense: '#3498db',
  control: '#9b59b6',
  special: '#f39c12',
};

/** 颜色映射：道具类型 → 背景色 */
const ITEM_TYPE_COLORS: Record<string, string> = {
  vehicle: '#1abc9c',
  trap: '#e67e22',
  tool: '#2ecc71',
  research: '#9b59b6',
};

/** 需要高亮的日志类型：金钱损失、使用道具/卡片等关键行为 */
const HIGHLIGHT_LOG_TYPES = new Set([
  'buyProperty',
  'upgradeProperty',
  'rebuildProperty',
  'payRent',
  'player:rent',
  'payTax',
  'player:tax',
  'companyFine',
  'hospital',
  'buyCard',
  'buyItem',
  'useItem',
  'useCard',
  'payLoanInterest',
  'player:repay',
  'loan',
  'takeLoan',
  'stock:trade',
  'companyProfit',
  'companyFine',
]);

export function renderBoardWithSelection(state: GameState) {
  const currentUser = getCurrentUser();
  if (!gameCanvas || !currentUser) return;
  const opts: Parameters<typeof renderBoard>[3] = { zoom: boardZoom };
  if (currentHoverIndex >= 0) {
    opts.hoverIndex = currentHoverIndex;
    opts.hoverPixel = currentHoverPixel;
  }
  if (tileSelectionResolver) {
    opts.isSelectingTile = true;
    const filter = tileSelectionFilter;
    opts.selectableTileIndexes = new Set(
      state.map.tiles.filter((t) => (filter ? filter(t) : true)).map((t) => t.index)
    );
  }
  renderBoard(gameCanvas, state, currentUser.id, opts);
}

export function attachBoardEvents(c: HTMLCanvasElement) {
  c.addEventListener('mousemove', (e) => {
    const rect = c.getBoundingClientRect();
    const dpr = Number(c.dataset.dpr || '1');
    const x = (e.clientX - rect.left) * (c.width / rect.width) / dpr;
    const y = (e.clientY - rect.top) * (c.height / rect.height) / dpr;
    const idx = getTileIndexAt(x, y);
    if (idx !== currentHoverIndex) {
      currentHoverIndex = idx;
      currentHoverPixel = { x, y };
      const state = getCurrentGame();
      if (state) renderBoardWithSelection(state);
    } else if (idx >= 0) {
      currentHoverPixel = { x, y };
    }
  });
  c.addEventListener('mouseleave', () => {
    currentHoverIndex = -1;
    currentHoverPixel = undefined;
    const state = getCurrentGame();
    if (state) renderBoardWithSelection(state);
  });
  c.addEventListener('click', (e) => {
    if (!tileSelectionResolver) return;
    const state = getCurrentGame();
    if (!state) return;
    const rect = c.getBoundingClientRect();
    const dpr = Number(c.dataset.dpr || '1');
    const x = (e.clientX - rect.left) * (c.width / rect.width) / dpr;
    const y = (e.clientY - rect.top) * (c.height / rect.height) / dpr;
    const idx = getTileIndexAt(x, y);
    if (idx < 0) return;
    const tile = state.map.tiles[idx];
    if (tileSelectionFilter && !tileSelectionFilter(tile)) return;
    const resolver = tileSelectionResolver;
    tileSelectionResolver = null;
    tileSelectionCancel = null;
    tileSelectionFilter = null;
    resolver(idx);
  });
}

export async function renderGamePage(roomId: string): Promise<void> {
  const currentUser = getCurrentUser();
  if (!currentUser) {
    await navigateToLogin();
    return;
  }

  const container = document.createElement('div');
  container.className = 'page game-page';
  container.innerHTML = `
    <header>
      <h1>🎲 游戏中 <span class="room-tag">${escapeHtml(roomId)}</span></h1>
      <div class="game-status-bar" id="game-status-bar"></div>
      <button id="btn-exit" class="ghost btn-sm">退出房间</button>
    </header>
    <div class="game-body">
      <div class="game-content">
        <div class="game-layout">
          <div class="board-wrap">
            <div class="board-zoom-controls">
              <button id="btn-zoom-out" class="btn-icon" title="缩小">−</button>
              <button id="btn-zoom-reset" class="btn-icon" title="重置">1x</button>
              <button id="btn-zoom-in" class="btn-icon" title="放大">+</button>
            </div>
          </div>
          <div class="side-panel">
            <div class="info-card stock-chart-card" id="stock-chart-card">
              <div class="stock-chart-card-header">
                <h2>📈 股市行情</h2>
                <button id="btn-toggle-stock-chart" class="btn-icon" title="展开/折叠">−</button>
              </div>
              <div id="stock-chart-mount"></div>
            </div>
            <div class="info-card player-info-card">
              <h2>玩家信息</h2>
              <div id="players-info"></div>
            </div>
            <div class="info-card actions-card">
              <h2>操作</h2>
              <div id="game-actions"></div>
            </div>
          </div>
        </div>
        <div class="stock-top-panel">
          <div class="stock-top-header">
            <h2>股市与公司</h2>
            <button id="btn-toggle-stock" class="btn-icon" title="展开/折叠">−</button>
          </div>
          <div id="stock-market"></div>
        </div>
        <div class="backpack-wide-panel">
          <div class="backpack-wide-header">
            <h2>卡片 / 道具</h2>
            <button id="btn-toggle-backpack" class="btn-icon" title="展开/折叠">−</button>
          </div>
          <div id="backpack-wide-content">
            <div class="backpack-tabs">
              <button class="backpack-tab active" data-tab="cards">卡片</button>
              <button class="backpack-tab" data-tab="items">道具</button>
            </div>
            <div id="backpack-cards" class="backpack-panel active"></div>
            <div id="backpack-items" class="backpack-panel"></div>
          </div>
        </div>
        <div class="game-logs-panel">
          <h2>日志</h2>
          <div id="game-logs"></div>
        </div>
      </div>
      <div class="test-mode-dock" id="test-mode-dock"></div>
    </div>
  `;
  app.appendChild(container);

  const boardWrap = container.querySelector<HTMLDivElement>('.board-wrap')!;
  const canvas = createBoardCanvas();
  gameCanvas = canvas;
  currentHoverIndex = -1;
  currentHoverPixel = undefined;
  boardWrap.appendChild(canvas);

  preloadTokenImages(CHARACTERS.map((c) => c.id));

  attachBoardEvents(canvas);

  // 棋盘缩放按钮
  function updateZoomDisplay(): void {
    const resetBtn = container.querySelector<HTMLButtonElement>('#btn-zoom-reset');
    if (resetBtn) resetBtn.textContent = `${boardZoom.toFixed(1)}x`;
  }
  function applyZoom(): void {
    localStorage.setItem('monopoly4-board-zoom', String(boardZoom));
    updateZoomDisplay();
    const state = getCurrentGame();
    if (state) renderBoardWithSelection(state);
  }
  container.querySelector('#btn-zoom-out')!.addEventListener('click', () => {
    boardZoom = Math.max(0.5, Math.round((boardZoom - 0.1) * 10) / 10);
    applyZoom();
  });
  container.querySelector('#btn-zoom-in')!.addEventListener('click', () => {
    boardZoom = Math.min(2.5, Math.round((boardZoom + 0.1) * 10) / 10);
    applyZoom();
  });
  container.querySelector('#btn-zoom-reset')!.addEventListener('click', () => {
    boardZoom = 1;
    applyZoom();
  });
  updateZoomDisplay();

  container.querySelector('#btn-exit')!.addEventListener('click', () => {
    navigateToLobby();
  });

  // 背包 Tab 切换
  const backpackWideContent = container.querySelector<HTMLDivElement>('#backpack-wide-content')!;
  backpackWideContent.querySelectorAll<HTMLButtonElement>('.backpack-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      backpackWideContent.querySelectorAll('.backpack-tab').forEach((t) => t.classList.remove('active'));
      backpackWideContent.querySelectorAll('.backpack-panel').forEach((p) => p.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.dataset.tab;
      const panel = backpackWideContent.querySelector(`#backpack-${target}`);
      if (panel) panel.classList.add('active');
    });
  });

  // 股市面板折叠切换
  const stockPanel = container.querySelector('.stock-top-panel')!;
  const toggleStockBtn = container.querySelector<HTMLButtonElement>('#btn-toggle-stock')!;
  stockPanel.classList.toggle('collapsed', isStockCollapsed);
  toggleStockBtn.textContent = isStockCollapsed ? '+' : '−';
  toggleStockBtn.addEventListener('click', () => {
    isStockCollapsed = !isStockCollapsed;
    stockPanel.classList.toggle('collapsed', isStockCollapsed);
    toggleStockBtn.textContent = isStockCollapsed ? '+' : '−';
    const state = getCurrentGame();
    if (state) renderStockMarket(container, state);
  });

  // K 线图面板折叠切换 + 初始化组件
  const stockChartCard = container.querySelector<HTMLDivElement>('#stock-chart-card')!;
  const toggleStockChartBtn = container.querySelector<HTMLButtonElement>('#btn-toggle-stock-chart')!;
  stockChartCard.classList.toggle('collapsed', isStockChartCollapsed);
  toggleStockChartBtn.textContent = isStockChartCollapsed ? '+' : '−';
  toggleStockChartBtn.addEventListener('click', () => {
    isStockChartCollapsed = !isStockChartCollapsed;
    stockChartCard.classList.toggle('collapsed', isStockChartCollapsed);
    toggleStockChartBtn.textContent = isStockChartCollapsed ? '+' : '−';
    // 折叠/展开后让图表根据新尺寸重绘
    if (!isStockChartCollapsed && stockChartInstance) {
      // 延迟一帧让 CSS 过渡完成再重绘
      requestAnimationFrame(() => stockChartInstance?.redraw());
    }
  });
  const stockChartMount = container.querySelector<HTMLDivElement>('#stock-chart-mount')!;
  stockChartInstance = new StockChart({ minHeight: 240 });
  stockChartInstance.mount(stockChartMount);

  // 卡片/道具面板折叠切换
  const backpackPanel = container.querySelector('.backpack-wide-panel')!;
  const toggleBackpackBtn = container.querySelector<HTMLButtonElement>('#btn-toggle-backpack')!;
  backpackPanel.classList.toggle('collapsed', isBackpackCollapsed);
  toggleBackpackBtn.textContent = isBackpackCollapsed ? '+' : '−';
  toggleBackpackBtn.addEventListener('click', () => {
    isBackpackCollapsed = !isBackpackCollapsed;
    backpackPanel.classList.toggle('collapsed', isBackpackCollapsed);
    toggleBackpackBtn.textContent = isBackpackCollapsed ? '+' : '−';
  });

  let previousState: GameState | null = null;

  function renderGame(state: GameState): void {
    const oldState = previousState;
    setCurrentGame(state);
    // 当地图格数变化时重建 canvas
    if (String(state.map.tiles.length) !== canvas.dataset.tileCount) {
      const oldCanvas = canvas;
      const newCanvas = createBoardCanvas(state.map.tiles.length);
      // 防止旧 canvas 因页面切换/清理已不在 boardWrap 中导致 replaceChild 报错
      if (oldCanvas.parentNode === boardWrap) {
        boardWrap.replaceChild(newCanvas, oldCanvas);
      } else {
        boardWrap.querySelectorAll('canvas').forEach((c) => c.remove());
        boardWrap.appendChild(newCanvas);
      }
      gameCanvas = newCanvas;
      attachBoardEvents(newCanvas);
      currentHoverIndex = -1;
      currentHoverPixel = undefined;
    }

    // 检测所有未破产玩家是否发生位置变化，为每位移动玩家启动逐格动画。
    // 若该玩家已在动画中，则从当前动画所在格继续移动，避免闪回/回拉。
    if (oldState) {
      let anyMoved = false;
      const layout = getCurrentBoardLayout();
      const now = Date.now();
      for (const player of state.players) {
        if (player.isBankrupt) continue;
        const oldPlayer = oldState.players.find((p) => p.id === player.id);
        if (!oldPlayer || player.position === oldPlayer.position) continue;

        let fromIndex = oldPlayer.position;
        if (layout && isPlayerMoveAnimating(player.id)) {
          const animatedIndex = getPlayerAnimatedTileIndex(layout, oldPlayer, now);
          if (animatedIndex !== null) {
            fromIndex = animatedIndex;
          }
        }
        startMoveAnimation(player.id, fromIndex, player.position);
        anyMoved = true;
      }
      if (anyMoved) scheduleAnimationFrames();
    }

    renderBoardWithSelection(state);
    renderStatusBar(container, state);
    renderPlayersInfo(container, state);
    renderBackpack(container, state);
    renderActions(container, state);
    renderStockMarket(container, state);
    renderLogs(container, state);
    // 把当前股票数据喂给 K 线图组件
    if (stockChartInstance) {
      // 若选中的股票已被移除，重置选择
      if (selectedStockId && !state.stocks.some((s) => s.id === selectedStockId)) {
        selectedStockId = null;
      }
      stockChartInstance.setData(state.stocks, state.stockTrends, selectedStockId);
    }
    maybeShowEventBanners(state.logs);

    previousState = cloneForAnimation(state);

    // 自动进入小游戏（仅当前玩家且尚未进入时触发）
    const currentPlayer = state.players[state.currentPlayerIndex];
    const currentUser = getCurrentUser();
    if (
      state.status === 'minigame' &&
      state.pendingMiniGame &&
      !isMiniGameActive &&
      currentPlayer?.id === currentUser?.id
    ) {
      activeMiniGameType = state.pendingMiniGame;
      isMiniGameActive = true;
      launchMiniGame(state.pendingMiniGame, {
        onEnd: (result) => {
          isMiniGameActive = false;
          activeMiniGameType = undefined;
          submitMiniGameResult(state.roomId, { coupons: result.coupons });
        },
      });
    }
  }

  let animationFrameId: number | null = null;

  /** 驱动逐格移动动画帧，动画结束时触发一次最终渲染。 */
  function scheduleAnimationFrames(): void {
    if (animationFrameId !== null) return;
    const frame = () => {
      const state = getCurrentGame();
      const layout = getCurrentBoardLayout();
      if (!state || !layout || !isMoveAnimating()) {
        animationFrameId = null;
        return;
      }
      renderBoardWithSelection(state);
      // 动画过程中把 previousState 同步为当前状态，避免后续新状态到达时
      // 又从最初起点重新触发一次动画（导致闪回/生硬）
      previousState = cloneForAnimation(state);
      animationFrameId = requestAnimationFrame(frame);
    };
    animationFrameId = requestAnimationFrame(frame);
  }

  /** 提取动画对比所需的最小状态快照。 */
  function cloneForAnimation(state: GameState): GameState {
    return {
      ...state,
      players: state.players.map((p) => ({ ...p })),
    } as GameState;
  }

  registerCleanup(onGameState(renderGame));
  registerCleanup(
    onError((msg) => {
      showToast(msg, 'error');
    })
  );

  // 页面卸载时清理 K 线图组件
  registerCleanup(() => {
    if (stockChartInstance) {
      stockChartInstance.unmount();
      stockChartInstance = null;
    }
    selectedStockId = null;
  });

  // 棋子图片加载完成后重绘棋盘
  const onTokenLoaded = () => {
    const state = getCurrentGame();
    if (state) renderBoardWithSelection(state);
  };
  window.addEventListener('monopoly:tokenLoaded', onTokenLoaded);
  registerCleanup(() => window.removeEventListener('monopoly:tokenLoaded', onTokenLoaded));

  // 测试模式：在游戏界面右侧嵌入测试面板，不覆盖现有 UI
  if (isTestMode()) {
    const dock = container.querySelector<HTMLDivElement>('#test-mode-dock')!;
    const testPanel = createTestPanel(() => getCurrentGame(), true);
    dock.appendChild(testPanel);
  }
}

/** 渲染单个玩家的信息卡片（label-value grid 布局，去除管道符） */
export function renderPlayerInfoCard(player: Player, state: GameState, isSelf = false): HTMLDivElement {
  const div = document.createElement('div');
  div.className = `player-info ${isSelf ? 'player-info-self' : ''}`;
  const isCurrent = state.players[state.currentPlayerIndex].id === player.id;
  const totalCash = player.cash + player.deposit;
  const itemCount = player.items.reduce((s, i) => s + i.quantity, 0);
  const initial = (player.username || '?').charAt(0).toUpperCase();

  // 资产状态用颜色编码：净现金（>0 绿色，=0 灰色，<0 红色）
  const netClass = player.loan > 0 && player.cash < player.loan ? 'is-negative' : 'is-positive';
  const loanClass = player.loan > 0 ? 'is-negative' : '';

  div.innerHTML = `
    <div class="player-info-header">
      <span class="player-avatar" style="background:${player.color}">${escapeHtml(initial)}</span>
      <strong style="color:${player.color}">${escapeHtml(player.username)}</strong>
      ${player.isAI ? '<span class="badge bot">AI</span>' : ''}
      ${isCurrent ? '<span class="current-turn-indicator">当前回合</span>' : ''}
    </div>
    <div class="player-stats">
      <div class="player-stat">
        <span class="stat-label">💵 现金</span>
        <span class="stat-value is-money">$${player.cash.toLocaleString()}</span>
      </div>
      <div class="player-stat">
        <span class="stat-label">🏦 存款</span>
        <span class="stat-value">$${player.deposit.toLocaleString()}</span>
      </div>
      <div class="player-stat">
        <span class="stat-label">💰 总资产</span>
        <span class="stat-value ${netClass}">$${totalCash.toLocaleString()}</span>
      </div>
      <div class="player-stat">
        <span class="stat-label">📝 贷款</span>
        <span class="stat-value ${loanClass}">$${player.loan.toLocaleString()}</span>
      </div>
      <div class="player-stat">
        <span class="stat-label">🎟️ 点券</span>
        <span class="stat-value">${player.coupons}</span>
      </div>
      <div class="player-stat">
        <span class="stat-label">🏘️ 地产</span>
        <span class="stat-value">${player.properties.length}</span>
      </div>
      <div class="player-stat">
        <span class="stat-label">🛡️ 保险</span>
        <span class="stat-value">${player.insuranceDays} 天</span>
      </div>
      <div class="player-stat">
        <span class="stat-label">🃏 卡片</span>
        <span class="stat-value">${player.cards.length}/15</span>
      </div>
      <div class="player-stat">
        <span class="stat-label">🎒 道具</span>
        <span class="stat-value">${itemCount}</span>
      </div>
    </div>
    ${player.spirit ? `<div class="player-stat"><span class="stat-label">✨ 神明</span><span class="stat-value">${escapeHtml(player.spirit.spiritId)}</span></div>` : ''}
    ${player.isBankrupt ? '<div class="bankrupt">已破产</div>' : ''}
  `;
  return div;
}

/** 渲染头部状态条：日期 / 物价指数 / 当前回合玩家等关键信息一目了然 */
export function renderStatusBar(container: HTMLElement, state: GameState): void {
  const el = container.querySelector<HTMLDivElement>('#game-status-bar');
  if (!el) return;
  const currentPlayer = state.players[state.currentPlayerIndex];
  const turnChip = currentPlayer
    ? `<span class="status-chip status-chip-turn" title="当前回合">
        <span class="turn-dot" style="background:${escapeHtml(currentPlayer.color)}"></span>
        <strong style="color:${escapeHtml(currentPlayer.color)}">${escapeHtml(currentPlayer.username)}</strong> 行动中
      </span>`
    : '';
  el.innerHTML = `
    <span class="status-chip" title="游戏日期">📅 第 <strong>${state.month}</strong> 月 第 <strong>${state.day}</strong> 天</span>
    <span class="status-chip" title="物价指数">💹 物价指数 <strong>${state.priceIndex.toFixed(2)}</strong></span>
    <span class="status-chip" title="乐透奖池">🎰 奖池 <strong>$${state.lotteryJackpot.toLocaleString()}</strong></span>
    ${turnChip}
  `;
}

export function renderPlayersInfo(container: HTMLElement, state: GameState): void {
  const el = container.querySelector<HTMLDivElement>('#players-info')!;
  el.innerHTML = '';

  const currentUser = getCurrentUser();
  const self = state.players.find((p) => p.id === currentUser?.id);
  const others = state.players.filter((p) => p.id !== currentUser?.id);

  if (self) {
    el.appendChild(renderPlayerInfoCard(self, state, true));
  }

  if (others.length > 0) {
    const selectWrap = document.createElement('div');
    selectWrap.className = 'player-info-select-wrap';
    const select = document.createElement('select');
    select.className = 'player-info-select';
    select.innerHTML = `<option value="">其他玩家 (${others.length})</option>` +
      others.map((p) => `<option value="${p.id}">${p.username}</option>`).join('');
    selectWrap.appendChild(select);

    const otherPanel = document.createElement('div');
    otherPanel.className = 'player-info-other';
    otherPanel.style.display = 'none';

    select.addEventListener('change', () => {
      otherPanel.innerHTML = '';
      if (select.value) {
        const player = others.find((p) => p.id === select.value);
        if (player) {
          otherPanel.appendChild(renderPlayerInfoCard(player, state));
          otherPanel.style.display = 'block';
        }
      } else {
        otherPanel.style.display = 'none';
      }
    });

    el.appendChild(selectWrap);
    el.appendChild(otherPanel);
  }

  const monthInfo = document.createElement('div');
  monthInfo.className = 'month-info';
  monthInfo.textContent = `第 ${state.month} 月 第 ${state.day} 天 | 物价指数: ${state.priceIndex.toFixed(2)} | 乐透奖池: $${state.lotteryJackpot}`;
  el.appendChild(monthInfo);
}

/** 渲染背包面板（卡片网格 + 道具网格） */
export function renderBackpack(container: HTMLElement, state: GameState): void {
  const currentUser = getCurrentUser();
  const myPlayer = state.players.find((p) => p.id === currentUser?.id);
  if (!myPlayer) return;

  // --- 卡片网格 ---
  const cardsEl = container.querySelector<HTMLDivElement>('#backpack-cards')!;
  cardsEl.innerHTML = '';
  if (state.config.enableCards === false) {
    cardsEl.innerHTML = '<div class="backpack-empty">卡片系统已禁用</div>';
  } else if (myPlayer.cards.length === 0) {
    cardsEl.innerHTML = '<div class="backpack-empty">暂无卡片</div>';
  } else {
    const grid = document.createElement('div');
    grid.className = 'card-grid';
    myPlayer.cards.forEach((c) => {
      const def = CARD_DEFINITIONS[c.cardId];
      const cell = document.createElement('div');
      cell.className = 'card-cell';
      const typeColor = CARD_TYPE_COLORS[def?.type ?? ''] || '#555';
      cell.style.borderColor = typeColor;
      cell.innerHTML = `
        <div class="card-cell-name" style="background:${typeColor}">${def?.name ?? c.cardId}</div>
        <div class="card-cell-type">${def?.type ?? ''}</div>
        <span class="card-cell-help" title="${escapeHtml(def?.description ?? c.cardId)}">?</span>
      `;
      // 悬停 tooltip
      cell.title = def?.description ?? c.cardId;
      // 点击使用
      cell.addEventListener('click', async () => {
        const target = await promptCardTarget(state, c.cardId);
        useCard(state.roomId, c.instanceId, target);
      });
      grid.appendChild(cell);
    });
    cardsEl.appendChild(grid);
  }

  // --- 道具网格 ---
  const itemsEl = container.querySelector<HTMLDivElement>('#backpack-items')!;
  itemsEl.innerHTML = '';
  if (state.config.enableItems === false) {
    itemsEl.innerHTML = '<div class="backpack-empty">道具系统已禁用</div>';
  } else if (myPlayer.items.length === 0) {
    itemsEl.innerHTML = '<div class="backpack-empty">暂无道具</div>';
  } else {
    const grid = document.createElement('div');
    grid.className = 'item-grid';
    myPlayer.items.forEach((it) => {
      const def = ITEM_DEFINITIONS[it.itemId];
      const cell = document.createElement('div');
      cell.className = 'item-cell';
      const typeColor = ITEM_TYPE_COLORS[def?.type ?? ''] || '#555';
      const isVehicle = def?.type === 'vehicle';
      const isEquipped = isVehicle && myPlayer.vehicle === it.itemId;
      if (isEquipped) cell.classList.add('item-cell-equipped');
      cell.style.borderColor = typeColor;
      cell.innerHTML = `
        <div class="item-cell-name" style="background:${typeColor}">${def?.name ?? it.itemId}</div>
        <div class="item-cell-qty">×${it.quantity}${isEquipped ? ' · 装备中' : ''}</div>
        <span class="item-cell-help" title="${escapeHtml(def?.description ?? it.itemId)}">?</span>
      `;
      // 悬停 tooltip
      cell.title = def?.description ?? it.itemId;
      // 点击使用
      cell.addEventListener('click', async () => {
        const target = await promptItemTarget(state, it.itemId);
        useItem(state.roomId, it.itemId, target);
      });
      grid.appendChild(cell);
    });
    itemsEl.appendChild(grid);
  }
}

export function renderActions(container: HTMLElement, state: GameState): void {
  const currentUser = getCurrentUser();
  const el = container.querySelector<HTMLDivElement>('#game-actions')!;
  el.innerHTML = '';
  const currentPlayer = state.players[state.currentPlayerIndex];
  const isMyTurn = currentPlayer.id === currentUser?.id;

  if (state.status === 'ended') {
    const winner = state.players.find((p) => p.id === state.winnerId);
    el.innerHTML = `
      <div class="winner-card">
        <div class="trophy">🏆</div>
        <div class="winner-label">本局冠军</div>
        <div class="winner-name">${escapeHtml(winner?.username || '未知')}</div>
      </div>
    `;
    return;
  }

  if (!isMyTurn) {
    el.innerHTML = `
      <div class="waiting-state">
        <div class="waiting-icon">⏳</div>
        <div class="waiting-text">等待 <span class="waiting-player">${escapeHtml(currentPlayer.username)}</span> 操作…</div>
      </div>
    `;
    return;
  }

  if (state.status === 'rolling') {
    const group = createGroup('🎲 骰子', 'primary');
    const maxDice = currentPlayer.vehicle === 'walk' ? 1 : currentPlayer.vehicle === 'bike' ? 2 : 3;
    if (maxDice === 1) {
      const btn = createButton('🎲 掷骰子', () => rollDice(state.roomId, 1));
      group.buttons.appendChild(btn);
    } else {
      const title = group.title;
      const hint = document.createElement('div');
      hint.style.fontSize = 'var(--font-size-xs)';
      hint.style.color = 'var(--color-text-muted)';
      hint.textContent = `选择骰子数（最多 ${maxDice} 颗）`;
      group.body.appendChild(hint);
      for (let i = 1; i <= maxDice; i++) {
        const btn = createButton(`🎲 掷 ${i} 颗`, () => rollDice(state.roomId, i));
        group.buttons.appendChild(btn);
      }
    }
    el.appendChild(group.el);
    return;
  }

  if (state.status === 'acting') {
    const tileIndex = state.pendingTileIndex ?? currentPlayer.position;
    const tile = state.map.tiles[tileIndex];

    // ====== 资产操作组（购买/升级/改建）======
    if (tile.type === 'property' && !tile.ownerId) {
      const group = createGroup('💰 购买地产', 'primary');
      const cost = Math.floor(tile.basePrice * state.priceIndex);
      const btn = createButton(`购买 ${tile.name} ($${cost.toLocaleString()})`, () => buyProperty(state.roomId));
      group.buttons.appendChild(btn);
      el.appendChild(group.el);
    } else if (tile.type === 'property' && tile.ownerId === currentPlayer.id) {
      const bt = tile.buildingType ?? 'house';
      const canUp = bt !== 'chainStore' && bt !== 'park' && bt !== 'gasStation' && tile.level < 5;
      if (canUp) {
        const cost = Math.floor(tile.basePrice * (tile.level + 1) * 0.5 * state.priceIndex);
        const group = createGroup('🏗️ 建筑管理', 'primary');
        const upBtn = createButton(`升级 ${tile.name} ($${cost.toLocaleString()})`, async () => {
          // 大块土地首次升级时允许选择特殊建筑类型
          if (tile.size === 'large' && bt === 'house') {
            const options = [
              { value: 'mall', label: '商场（转盘租金）' },
              { value: 'hotel', label: '旅馆（转盘租金+住宿）' },
              { value: 'gasStation', label: '加油站（按步数收费）' },
              { value: 'park', label: '公园（免收过路费）' },
              { value: 'lab', label: '研究所（免收过路费）' },
            ];
            const choice = await showPrompt('选择要建造的特殊建筑：', {
              choices: options.map((o, i) => ({ value: String(i + 1), label: `${i + 1}. ${o.label}` })),
            });
            const idx = parseInt(choice || '', 10) - 1;
            if (idx >= 0 && idx < options.length) {
              upgradeProperty(state.roomId, options[idx].value as BuildingType);
            }
          } else {
            upgradeProperty(state.roomId);
          }
        });
        group.buttons.appendChild(upBtn);
        el.appendChild(group.el);
      }

      // 改建按钮（独立分组）
      const rebuildGroup = createGroup('🔨 改建');
      const rebuildBtn = createButton('改建建筑类型', async () => {
        const options = tile.size === 'small'
          ? [
              { value: 'house', label: '住宅' },
              { value: 'chainStore', label: '连锁店' },
            ]
          : [
              { value: 'park', label: '公园' },
              { value: 'mall', label: '商场' },
              { value: 'hotel', label: '旅馆' },
              { value: 'gasStation', label: '加油站' },
              { value: 'lab', label: '研究所' },
            ];
        const choice = await showPrompt('选择建筑类型：', {
          choices: options.map((o, i) => ({ value: String(i + 1), label: `${i + 1}. ${o.label}` })),
        });
        const idx = parseInt(choice || '', 10) - 1;
        if (idx >= 0 && idx < options.length) {
          rebuildTile(state.roomId, tileIndex, options[idx].value as BuildingType);
        }
      });
      rebuildGroup.buttons.appendChild(rebuildBtn);
      el.appendChild(rebuildGroup.el);
    } else if (tile.type === 'shop') {
      const group = createGroup('🛒 商店');
      if (state.config.enableCards !== false) {
        const btn = createButton('购买卡片', async () => {
          const cardChoices = Object.values(CARD_DEFINITIONS)
            .filter((c) => c.cost > 0)
            .map((c, i) => ({ value: String(i + 1), label: `${i + 1}. ${c.name} (${c.cost}点)` }));
          const choice = await showPrompt('选择要购买的卡片：', { choices: cardChoices });
          const idx = parseInt(choice || '', 10) - 1;
          const card = Object.values(CARD_DEFINITIONS).filter((c) => c.cost > 0)[idx];
          if (card) buyCard(state.roomId, card.id);
        });
        group.buttons.appendChild(btn);
      }
      if (state.config.enableItems !== false) {
        const btn = createButton('购买道具', async () => {
          const itemChoices = Object.values(ITEM_DEFINITIONS)
            .filter((i) => i.cost > 0)
            .map((it, i) => ({ value: String(i + 1), label: `${i + 1}. ${it.name} (${it.cost}点)` }));
          const choice = await showPrompt('选择要购买的道具：', { choices: itemChoices });
          const idx = parseInt(choice || '', 10) - 1;
          const item = Object.values(ITEM_DEFINITIONS).filter((i) => i.cost > 0)[idx];
          if (item) buyItem(state.roomId, item.id);
        });
        group.buttons.appendChild(btn);
      }
      el.appendChild(group.el);
    } else if (tile.type === 'lottery') {
      const group = createGroup('🎰 乐透');
      const btn = createButton('投注乐透 ($1000)', async () => {
        const input = await showPrompt('选择 0-9 的号码：');
        const number = parseInt(input || '', 10);
        if (!Number.isNaN(number)) placeLotteryBet(state.roomId, number);
      });
      group.buttons.appendChild(btn);
      el.appendChild(group.el);
    } else if (tile.type === 'magic') {
      const group = createGroup('✨ 魔法屋');
      const btn = createButton('魔法屋施法', async () => {
        const targets = state.players.filter((p) => !p.isBankrupt);
        const targetChoice = await showPrompt('选择目标：', {
          choices: targets.map((p, i) => ({ value: String(i + 1), label: `${i + 1}. ${p.username}` })),
        });
        const targetIdx = parseInt(targetChoice || '', 10) - 1;
        const target = targets[targetIdx];
        if (!target) return;
        const spellChoice = await showPrompt('选择法术：', {
          choices: [
            { value: '1', label: '1. 交换现金' },
            { value: '2', label: '2. 送走神明' },
            { value: '3', label: '3. 抢夺卡片' },
            { value: '4', label: '4. 关进监狱3天' },
          ],
        });
        const spellIdx = parseInt(spellChoice || '', 10);
        const spells: ('swapCash' | 'dismissSpirit' | 'stealCard' | 'jail')[] = [
          'swapCash', 'dismissSpirit', 'stealCard', 'jail',
        ];
        const spell = spells[spellIdx - 1];
        if (spell) castMagicSpell(state.roomId, target.id, spell);
      });
      group.buttons.appendChild(btn);
      el.appendChild(group.el);
    }

    // ====== 救援组 ======
    if (tile.type === 'hospital' || tile.type === 'prison') {
      const captiveNpcs = state.npcs.filter((n) => !n.rescued && state.map.path[n.pathIndex] === tileIndex);
      if (captiveNpcs.length > 0) {
        const group = createGroup('🆘 救援');
        for (const npc of captiveNpcs) {
          const def = NPC_DEFINITIONS[npc.type];
          const btn = createButton(`解救 ${def.name}`, () => rescueNpc(state.roomId, npc.id));
          group.buttons.appendChild(btn);
        }
        el.appendChild(group.el);
      }
    }

    // ====== 金融组 ======
    const financeBtns: HTMLButtonElement[] = [];
    if (tile.type === 'start') {
      financeBtns.push(createButton('🏦 银行贷款', async () => {
        const input = await showPrompt('输入贷款金额：');
        const amount = parseInt(input || '', 10);
        if (amount > 0) takeLoan(state.roomId, amount);
      }));
    }
    if (currentPlayer.loan > 0) {
      financeBtns.push(createButton('💳 偿还贷款', async () => {
        const input = await showPrompt(`输入还款金额（最大 $${Math.min(currentPlayer.cash, currentPlayer.loan).toLocaleString()}）：`);
        const amount = parseInt(input || '', 10);
        if (amount > 0) repayLoan(state.roomId, amount);
      }));
    }
    if (currentPlayer.insuranceDays > 0) {
      financeBtns.push(createButton('🛡️ 申请理赔', () => claimInsurance(state.roomId)));
    }
    if (financeBtns.length > 0) {
      const group = createGroup('💼 金融');
      financeBtns.forEach((b) => group.buttons.appendChild(b));
      el.appendChild(group.el);
    }

    // ====== 回合控制组（始终在最底部）======
    const controlGroup = createGroup('回合控制');
    const skipBtn = createButton('结束回合 →', () => skipTurn(state.roomId));
    skipBtn.classList.add('ghost');
    controlGroup.buttons.classList.add('single');
    controlGroup.buttons.appendChild(skipBtn);
    el.appendChild(controlGroup.el);
  }
}

/** 创建带标题的操作分组容器 */
function createGroup(titleText: string, modifier: '' | 'primary' | 'danger' = ''): {
  el: HTMLDivElement;
  body: HTMLDivElement;
  title: HTMLHeadingElement;
  buttons: HTMLDivElement;
} {
  const el = document.createElement('div');
  el.className = `action-group${modifier ? ' ' + modifier : ''}`;
  const title = document.createElement('h4');
  title.className = 'action-group-title';
  title.textContent = titleText;
  const body = document.createElement('div');
  const buttons = document.createElement('div');
  buttons.className = 'action-group-buttons';
  body.appendChild(title);
  body.appendChild(buttons);
  el.appendChild(body);
  return { el, body, title, buttons };
}

/** 创建统一风格的操作按钮 */
function createButton(text: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.textContent = text;
  btn.addEventListener('click', onClick);
  return btn;
}

export function renderStockMarket(container: HTMLElement, state: GameState): void {
  const currentUser = getCurrentUser();
  const el = container.querySelector<HTMLDivElement>('#stock-market')!;
  el.innerHTML = '';

  if (state.config.enableStock === false) {
    el.style.display = 'none';
    return;
  }
  el.style.display = '';

  const currentPlayer = state.players.find((p) => p.id === currentUser?.id);
  const table = document.createElement('table');
  table.className = 'stock-table';
  table.innerHTML = `
    <thead>
      <tr>
        <th>公司</th>
        <th>股价</th>
        <th>涨跌</th>
        <th>持有</th>
        <th>持股比例</th>
        <th>成本价（仓位）</th>
        <th>操作</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  const tbody = table.querySelector('tbody')!;

  // 持仓股票置顶，折叠时优先显示持仓并至少保留 2 条
  const holdingIds = new Set(
    state.stocks
      .filter((stock) => (currentPlayer?.stockHoldings[stock.id] ?? 0) > 0)
      .map((stock) => stock.id)
  );
  const sortedStocks = [...state.stocks].sort((a, b) => {
    const ha = holdingIds.has(a.id) ? 1 : 0;
    const hb = holdingIds.has(b.id) ? 1 : 0;
    return hb - ha;
  });
  const filteredStocks = isStockCollapsed
    ? (() => {
        const owned = sortedStocks.filter((s) => holdingIds.has(s.id));
        if (owned.length >= 2) return owned;
        const others = sortedStocks.filter((s) => !holdingIds.has(s.id));
        return [...owned, ...others].slice(0, Math.max(2, owned.length));
      })()
    : sortedStocks;

  if (filteredStocks.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'stock-empty';
    empty.textContent = '暂无股票数据';
    el.appendChild(empty);
    if (state.stocks.length === 0) {
      console.warn('[renderStockMarket] state.stocks 为空，请检查后端 createGame 是否初始化股票');
    }
    return;
  }

  filteredStocks.forEach((stock) => {
    const company = state.companies.find((c) => c.id === stock.companyId);
    const holding = currentPlayer?.stockHoldings[stock.id] ?? 0;
    const costBasis = currentPlayer?.stockCostBasis[stock.id] ?? 0;
    const chairman = company?.chairmanPlayerId
      ? state.players.find((p) => p.id === company.chairmanPlayerId)?.username || '无'
      : '无';
    const trend = state.stockTrends.find((t) => t.stockId === stock.id);
    const tr = document.createElement('tr');
    // 选中态:点击行即可在 K 线图查看该股票
    if (stock.id === selectedStockId) {
      tr.classList.add('stock-row-selected');
    }
    tr.classList.add('stock-row-clickable');
    tr.title = '点击查看 K 线图';
    tr.addEventListener('click', (e) => {
      // 避免点击买入/卖出按钮时同时触发行选中
      const target = e.target as HTMLElement;
      if (target.closest('button')) return;
      if (selectedStockId === stock.id) {
        selectedStockId = null;
      } else {
        selectedStockId = stock.id;
      }
      if (stockChartInstance) {
        stockChartInstance.setSelectedStock(selectedStockId);
      }
      renderStockMarket(container, state);
    });
    const fluctuationClass = stock.fluctuation >= 0 ? 'stock-up' : 'stock-down';
    const fluctuationSign = stock.fluctuation >= 0 ? '+' : '';
    const unrealized = holding > 0 ? (stock.price - costBasis) * holding : 0;
    const plClass = unrealized >= 0 ? 'stock-up' : 'stock-down';
    const plSign = unrealized >= 0 ? '+' : '';
    const shareRatio = (holding / stock.totalShares) * 100;
    const ratioText = `${shareRatio.toFixed(2)}%`;
    const isChairman = company?.chairmanPlayerId === currentPlayer?.id;
    const ratioClass = isChairman ? 'stock-chairman' : '';
    const trendBadge = trend
      ? `<span class="stock-trend-badge" style="--trend-color:${escapeHtml(trend.templateColor)}" title="${escapeHtml(trend.templateName)} · 进度 ${trend.currentIndex}/20">🔥 ${escapeHtml(trend.templateName)}</span>`
      : '';
    tr.innerHTML = `
      <td>
        <div class="stock-name-line">
          <span class="stock-name">${escapeHtml(stock.name)}</span>
          ${trendBadge}
        </div>
        <span class="stock-meta">董事长：${escapeHtml(chairman)}</span>
      </td>
      <td><span class="stock-price">$${stock.price.toLocaleString()}</span></td>
      <td class="${fluctuationClass}">${fluctuationSign}${stock.fluctuation}%</td>
      <td>${holding}</td>
      <td class="${ratioClass}">${ratioText}<br><small>阈值>10%</small></td>
      <td>$${costBasis}<br><small class="${plClass}">${plSign}$${unrealized.toLocaleString()}</small></td>
      <td></td>
    `;
    const actions = tr.querySelector('td:last-child')!;
    actions.className = 'stock-actions';

    const isMyTurn = currentPlayer?.id === state.players[state.currentPlayerIndex].id;
    const canTrade = stock.suspendedDays <= 0;

    // 买入组
    const buyLabel = document.createElement('div');
    buyLabel.className = 'stock-actions-label buy';
    buyLabel.textContent = '买入';
    actions.appendChild(buyLabel);
    const buyGroup = document.createElement('div');
    buyGroup.className = 'stock-actions-group buy';
    const addBuyBtn = (label: string, qty: number) => {
      const btn = document.createElement('button');
      btn.textContent = label;
      btn.disabled = !canTrade || !isMyTurn;
      btn.title = `买入 ${qty} 股`;
      btn.addEventListener('click', () => tradeStock(state.roomId, stock.id, qty));
      buyGroup.appendChild(btn);
    };
    addBuyBtn('1', 1);
    addBuyBtn('10', 10);
    addBuyBtn('100', 100);
    actions.appendChild(buyGroup);

    // 卖出组
    const sellLabel = document.createElement('div');
    sellLabel.className = 'stock-actions-label sell';
    sellLabel.textContent = '卖出';
    actions.appendChild(sellLabel);
    const sellGroup = document.createElement('div');
    sellGroup.className = 'stock-actions-group sell';
    const addSellBtn = (label: string, qty: number) => {
      const btn = document.createElement('button');
      btn.textContent = label;
      btn.disabled = !canTrade || holding < Math.abs(qty);
      btn.title = `卖出 ${Math.abs(qty)} 股`;
      btn.addEventListener('click', () => tradeStock(state.roomId, stock.id, qty));
      sellGroup.appendChild(btn);
    };
    addSellBtn('1', -1);
    addSellBtn('10', -10);
    addSellBtn('100', -100);
    actions.appendChild(sellGroup);

    tbody.appendChild(tr);
  });

  el.appendChild(table);
}

/** 判断日志是否需要高亮 */
function isLogHighlighted(log: GameLog): boolean {
  if (HIGHLIGHT_LOG_TYPES.has(log.type)) return true;
  // 兜底：消息里明确出现损失/花费/使用道具等关键词也高亮
  const text = log.message;
  if (/使用道具|使用.*卡|支付|花费|缴纳|交租|购买土地|升级|降級|被罚款|住院|缴税/.test(text)) {
    return true;
  }
  return false;
}

/** 转义正则特殊字符 */
function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

type NameToken =
  | { kind: 'player'; id: string; name: string; color: string }
  | { kind: 'card'; id: string; name: string; type: string }
  | { kind: 'item'; id: string; name: string; type: string };

/**
 * 将日志纯文本渲染为富文本 HTML：
 * - 玩家名称 → 对应角色颜色
 * - 金额（$ 数字）→ 金色高亮
 * - 卡片/道具名称 → 按类型着色
 */
function renderLogMessage(state: GameState, message: string): string {
  const tokens: NameToken[] = [];

  state.players.forEach((p) =>
    tokens.push({ kind: 'player', id: p.id, name: p.username, color: p.color })
  );
  Object.values(CARD_DEFINITIONS).forEach((c) =>
    tokens.push({ kind: 'card', id: c.id, name: c.name, type: c.type })
  );
  Object.values(ITEM_DEFINITIONS).forEach((i) =>
    tokens.push({ kind: 'item', id: i.id, name: i.name, type: i.type })
  );

  // 先匹配长的名称，避免短名称被截断
  tokens.sort((a, b) => b.name.length - a.name.length);

  let text = escapeHtml(message);

  // 步骤 1：用唯一占位符替换所有需要着色的名称
  tokens.forEach((t, idx) => {
    const regex = new RegExp(escapeRegex(t.name), 'g');
    text = text.replace(regex, `__NAME_${idx}_#__`);
  });

  // 步骤 2：用占位符替换金额
  const moneyValues: string[] = [];
  text = text.replace(/\$[\d,]+/g, (match) => {
    moneyValues.push(match);
    return `__MONEY_${moneyValues.length - 1}_#__`;
  });

  // 步骤 3：将名称占位符恢复为带样式的 HTML
  tokens.forEach((t, idx) => {
    let html: string;
    if (t.kind === 'player') {
      html = `<span class="log-player" style="color:${t.color}">${escapeHtml(t.name)}</span>`;
    } else if (t.kind === 'card') {
      const bg = CARD_TYPE_COLORS[t.type] || '#555';
      html = `<span class="log-card" style="background:${bg}">${escapeHtml(t.name)}</span>`;
    } else {
      const bg = ITEM_TYPE_COLORS[t.type] || '#555';
      html = `<span class="log-prop" style="background:${bg}">${escapeHtml(t.name)}</span>`;
    }
    text = text.replaceAll(`__NAME_${idx}_#__`, html);
  });

  // 步骤 4：将金额占位符恢复为金色高亮
  moneyValues.forEach((value, idx) => {
    text = text.replaceAll(
      `__MONEY_${idx}_#__`,
      `<span class="log-money">${value}</span>`
    );
  });

  return text;
}

export function renderLogs(container: HTMLElement, state: GameState): void {
  const el = container.querySelector<HTMLDivElement>('#game-logs')!;
  el.innerHTML = '';
  [...state.logs].reverse().slice(0, 50).forEach((log) => {
    const div = document.createElement('div');
    div.className = 'log-item';
    if (isLogHighlighted(log)) {
      div.classList.add('log-highlight');
    }
    div.innerHTML = renderLogMessage(state, log.message);
    el.appendChild(div);
  });
}

/** 进入地图选块模式，等待用户点击棋盘选择地块 */
export function selectTileOnBoard(state: GameState, message: string, filter?: (tile: Tile) => boolean): Promise<number> {
  return new Promise((resolve, reject) => {
    if (tileSelectionResolver) {
      tileSelectionCancel?.();
      tileSelectionResolver = null;
      tileSelectionCancel = null;
      tileSelectionFilter = null;
    }
    tileSelectionResolver = resolve;
    tileSelectionCancel = () => reject(new Error('取消选择'));
    tileSelectionFilter = filter ?? null;
    showToast(message, 'info');
    renderBoardWithSelection(state);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        document.removeEventListener('keydown', onKey);
        tileSelectionCancel?.();
        tileSelectionResolver = null;
        tileSelectionCancel = null;
        tileSelectionFilter = null;
        const currentGame = getCurrentGame();
        if (currentGame) renderBoardWithSelection(currentGame);
      }
    };
    document.addEventListener('keydown', onKey);

    const originalResolve = resolve;
    tileSelectionResolver = (idx: number) => {
      document.removeEventListener('keydown', onKey);
      originalResolve(idx);
    };
  });
}

export async function promptCardTarget(state: GameState, cardId: string): Promise<CardUseTarget> {
  const target: CardUseTarget = {};
  if (cardId === 'rebuild') {
    target.targetTileIndex = await selectTileOnBoard(state, '请点击要改建的地块');
    const typeInput = await showPrompt('输入建筑类型（house/chainStore/park/mall/hotel/gasStation/lab）：');
    target.buildingType = typeInput as BuildingType | undefined;
  } else if (cardId === 'priceRise' || cardId === 'seal' || cardId === 'angel' || cardId === 'devil') {
    const tileIdx = await selectTileOnBoard(
      state,
      '请点击目标路段中的任意一个土地块',
      (t) => t.type === 'property' && t.group !== undefined
    );
    target.targetGroup = state.map.tiles[tileIdx].group;
  } else if (cardId === 'alliance' || cardId === 'turnAround' || cardId === 'stay' || cardId === 'turtle' || cardId === 'sleepwalk' || cardId === 'frame' || cardId === 'snatch' || cardId === 'equalPoverty') {
    const choice = await showPrompt('选择目标玩家：', {
      choices: state.players.map((p, i) => ({ value: String(i + 1), label: `${i + 1}. ${p.username}` })),
    });
    const idx = parseInt(choice || '', 10) - 1;
    target.targetPlayerId = state.players[idx]?.id;
  } else if (cardId === 'swapLand' || cardId === 'auction' || cardId === 'monster' || cardId === 'demolish' || cardId === 'swapHouse') {
    target.targetTileIndex = await selectTileOnBoard(state, '请点击目标地块');
  } else if (cardId === 'summonSpirit') {
    const spiritInput = await showPrompt('输入神明 ID（如 smallWealthGod）：');
    target.targetPlayerId = spiritInput || undefined;
  }
  return target;
}

export async function promptItemTarget(state: GameState, itemId: string): Promise<ItemUseTarget> {
  const target: ItemUseTarget = {};
  if (itemId === 'remoteDice') {
    const diceInput = await showPrompt('输入要控制的骰子点数 1-6：');
    target.diceValue = parseInt(diceInput || '', 10);
  } else if (itemId === 'barrier' || itemId === 'mine' || itemId === 'timeBomb' || itemId === 'missile' || itemId === 'teleporter') {
    target.targetTileIndex = await selectTileOnBoard(state, '请点击要放置道具的目标地块');
  } else if (itemId === 'robot') {
    const currentUser = getCurrentUser();
    const myPlayer = state.players.find((p) => p.id === currentUser?.id);
    target.targetTileIndex = await selectTileOnBoard(state, '请点击要使用机器人的目标土地', (t) =>
      t.type === 'property' && t.ownerId === myPlayer?.id
    );
    const tile = state.map.tiles[target.targetTileIndex];
    if (!tile || tile.type !== 'property' || tile.ownerId !== myPlayer?.id) return target;

    // 达到升级分支时才询问
    const canLevelUp = (tile.buildingType ?? 'house') === 'house' && tile.level < 5;
    if (!canLevelUp) {
      const options: { value: string; label: string }[] =
        tile.size === 'small'
          ? [
              { value: 'house', label: '住宅（继续升级）' },
              { value: 'chainStore', label: '连锁店' },
            ]
          : [
              { value: 'park', label: '公园' },
              { value: 'mall', label: '商场' },
              { value: 'hotel', label: '旅馆' },
              { value: 'gasStation', label: '加油站' },
              { value: 'lab', label: '研究所' },
            ];
      const choice = await showPrompt('选择机器人的升级/改建分支：', {
        choices: options.map((o, i) => ({ value: String(i + 1), label: `${i + 1}. ${o.label}` })),
      });
      const idx = parseInt(choice || '', 10) - 1;
      if (idx >= 0 && idx < options.length) {
        target.buildingType = options[idx].value as BuildingType;
      }
    }
  }
  return target;
}

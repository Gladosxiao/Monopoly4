import {
  type Room,
  type GameState,
  type GameLog,
  type Player,
  type Tile,
  type PublicUser,
  type CardUseTarget,
  type ItemUseTarget,
  type BuildingType,
  CARD_DEFINITIONS,
  ITEM_DEFINITIONS,
  CHARACTERS,
  DEFAULT_GAME_CONFIG,
} from '@monopoly4/shared';
import './style.css';
import {
  register,
  login,
  getMe,
  getAuthConfig,
  createRoom,
  listRooms,
  listMaps,
  getRoom,
  saveAuth,
  loadUser,
  logout,
} from './api.js';
import {
  getSocket,
  joinRoom,
  leaveRoom,
  toggleReady as toggleReadySocket,
  selectCharacter as selectCharacterSocket,
  startGame,
  rollDice,
  buyProperty,
  upgradeProperty,
  rebuildTile,
  useCard,
  buyCard,
  sellCard,
  useItem,
  buyItem,
  sellItem,
  tradeStock,
  claimInsurance,
  takeLoan,
  repayLoan,
  placeLotteryBet,
  castMagicSpell,
  skipTurn,
  onRoomUpdated,
  onGameState,
  onError,
  disconnectSocket,
} from './socket.js';
import { createBoardCanvas, renderBoard, getTileIndexAt } from './board.js';
import { createTestPanel, destroyTestPanel, isTestMode, enableTestMode } from './testMode/index.js';

const app = document.getElementById('app')!;

let currentRoom: Room | null = null;
let currentGame: GameState | null = null;
let currentUser: PublicUser | null = loadUser();
let cleanupFns: Array<() => void> = [];
let isStockCollapsed = false;
let isBackpackCollapsed = false;
let gameCanvas: HTMLCanvasElement | null = null;
let currentHoverIndex = -1;
let currentHoverPixel: { x: number; y: number } | undefined;

/** 地图选块模式：等待用户点击地图选择目标地块 */
let tileSelectionResolver: ((index: number) => void) | null = null;
let tileSelectionCancel: (() => void) | null = null;
let tileSelectionFilter: ((tile: Tile) => boolean) | null = null;

function renderBoardWithSelection(state: GameState) {
  if (!gameCanvas || !currentUser) return;
  const opts: Parameters<typeof renderBoard>[3] = {};
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

/** 显示 Toast 通知 */
function showToast(message: string, type: 'info' | 'error' | 'success' = 'info') {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'toastOut 0.25s forwards';
    toast.addEventListener('animationend', () => toast.remove());
  }, 3000);
}

/** 显示一个自定义输入弹窗，替代 window.prompt */
function showPrompt(
  message: string,
  options?: { choices?: { label: string; value: string }[]; defaultValue?: string }
): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const box = document.createElement('div');
    box.className = 'modal-box';

    const title = document.createElement('h3');
    title.textContent = '请输入';

    const body = document.createElement('p');
    body.textContent = message;

    let input: HTMLInputElement | HTMLSelectElement;
    if (options?.choices && options.choices.length > 0) {
      input = document.createElement('select');
      options.choices.forEach((c) => {
        const opt = document.createElement('option');
        opt.value = c.value;
        opt.textContent = c.label;
        input.appendChild(opt);
      });
    } else {
      input = document.createElement('input');
      input.type = 'text';
      input.value = options?.defaultValue ?? '';
      input.placeholder = '输入内容...';
    }

    const buttons = document.createElement('div');
    buttons.className = 'modal-buttons';

    const okBtn = document.createElement('button');
    okBtn.textContent = '确定';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = '取消';
    cancelBtn.className = 'secondary';

    buttons.appendChild(cancelBtn);
    buttons.appendChild(okBtn);

    box.appendChild(title);
    box.appendChild(body);
    box.appendChild(input);
    box.appendChild(buttons);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    input.focus();

    const close = (value: string | null) => {
      overlay.remove();
      resolve(value);
    };

    okBtn.addEventListener('click', () => close(input.value));
    cancelBtn.addEventListener('click', () => close(null));
    input.addEventListener('keydown', (e) => {
      const evt = e as KeyboardEvent;
      if (evt.key === 'Enter') close(input.value);
      if (evt.key === 'Escape') close(null);
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(null);
    });
  });
}

function clean() {
  cleanupFns.forEach((fn) => fn());
  cleanupFns = [];
  destroyTestPanel();
  app.innerHTML = '';
}

async function navigateToLogin(error?: string): Promise<void> {
  clean();
  let allowRegistration = false;
  try {
    const config = await getAuthConfig();
    allowRegistration = config.allowRegistration;
  } catch {
    allowRegistration = false;
  }

  const container = document.createElement('div');
  container.className = 'page login-page';
  container.innerHTML = `
    <h1>大富翁4 Web</h1>
    <div class="auth-box">
      <h2>登录</h2>
      ${error ? `<div class="error">${error}</div>` : ''}
      <div class="auth-hint">测试账号：test / test123</div>
      <input type="text" id="username" placeholder="用户名" />
      <input type="password" id="password" placeholder="密码" />
      <div class="buttons">
        <button id="btn-login">登录</button>
        ${allowRegistration ? '<button id="btn-register">注册</button>' : ''}
      </div>
    </div>
  `;
  app.appendChild(container);

  const username = container.querySelector<HTMLInputElement>('#username')!;
  const password = container.querySelector<HTMLInputElement>('#password')!;

  function translateAuthError(message: string): string {
    const map: Record<string, string> = {
      'Invalid credentials': '用户名或密码错误',
      'Username already exists': '用户名已被注册，请更换或直接登录',
      'Invalid username or password': '用户名至少 3 位，密码至少 6 位',
      'Missing refresh token': '登录状态已失效，请重新登录',
      'Invalid refresh token': '登录状态已过期，请重新登录',
      'User not found': '用户不存在，请重新登录',
      'Unauthorized': '未登录或登录已过期',
      'Registration is disabled': '当前不开放注册',
      '登录已过期，请重新登录': '登录已过期，请重新登录',
    };
    return map[message] || message;
  }

  function clearErrorOnInput(): void {
    const errorEl = container.querySelector('.error');
    if (errorEl) errorEl.textContent = '';
  }
  username.addEventListener('input', clearErrorOnInput);
  password.addEventListener('input', clearErrorOnInput);

  container.querySelector('#btn-login')!.addEventListener('click', async () => {
    if (!username.value || !password.value) {
      const errorEl = container.querySelector('.error');
      if (errorEl) errorEl.textContent = '请输入用户名和密码';
      return;
    }
    try {
      const res = await login(username.value, password.value);
      saveAuth(res);
      currentUser = res.user;
      navigateToLobby();
    } catch (e: any) {
      navigateToLogin(translateAuthError(e.message));
    }
  });

  if (allowRegistration) {
    container.querySelector('#btn-register')!.addEventListener('click', async () => {
      if (username.value.length < 3 || password.value.length < 6) {
        const errorEl = container.querySelector('.error');
        if (errorEl) errorEl.textContent = '用户名至少 3 位，密码至少 6 位';
        return;
      }
      try {
        const res = await register(username.value, password.value);
        saveAuth(res);
        currentUser = res.user;
        navigateToLobby();
      } catch (e: any) {
        navigateToLogin(translateAuthError(e.message));
      }
    });
  }
}

async function navigateToLobby(error?: string): Promise<void> {
  clean();
  if (!currentUser) {
    try {
      const { user } = await getMe();
      currentUser = user;
    } catch {
      await navigateToLogin();
      return;
    }
  }

  const container = document.createElement('div');
  container.className = 'page lobby-page';
  container.innerHTML = `
    <header>
      <h1>大富翁4 Web</h1>
      <div class="user-info">
        <span>${currentUser.username}</span>
        <button id="btn-logout">退出</button>
      </div>
    </header>
    ${error ? `<div class="error">${error}</div>` : ''}
    <div class="lobby-actions">
      <input type="text" id="room-name" placeholder="房间名" />
      <select id="map-select"></select>
      <button id="btn-create">创建房间</button>
      <input type="text" id="join-id" placeholder="输入房间号加入" />
      <button id="btn-join">加入</button>
    </div>
    <h2>房间列表</h2>
    <ul id="room-list"></ul>
  `;
  app.appendChild(container);

  container.querySelector('#btn-logout')!.addEventListener('click', async () => {
    logout();
    disconnectSocket();
    currentUser = null;
    await navigateToLogin();
  });

  const mapSelect = container.querySelector<HTMLSelectElement>('#map-select')!;
  try {
    const maps = await listMaps();
    maps.forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.name;
      mapSelect.appendChild(opt);
    });
  } catch {
    // 即使地图列表加载失败也允许创建默认房间
  }

  container.querySelector('#btn-create')!.addEventListener('click', async () => {
    const name = container.querySelector<HTMLInputElement>('#room-name')!.value || '新房間';
    try {
      const room = await createRoom({
        name,
        maxPlayers: 4,
        config: { mapId: mapSelect.value },
      });
      navigateToRoom(room.id);
    } catch (e: any) {
      navigateToLobby(e.message);
    }
  });

  container.querySelector('#btn-join')!.addEventListener('click', async () => {
    const roomId = container.querySelector<HTMLInputElement>('#join-id')!.value.trim();
    if (!roomId) return;
    navigateToRoom(roomId);
  });

  try {
    const rooms = await listRooms();
    const list = container.querySelector<HTMLUListElement>('#room-list')!;
    rooms.forEach((room) => {
      const li = document.createElement('li');
      li.innerHTML = `
        <div class="room-meta">
          <span class="room-name">${room.name}</span>
          <span class="room-count">${room.players.length}/${room.maxPlayers} 人</span>
        </div>
        <button>加入</button>
      `;
      li.querySelector('button')!.addEventListener('click', () => navigateToRoom(room.id));
      list.appendChild(li);
    });
  } catch (e: any) {
    // 房间列表失败通常不是认证问题，直接在大厅显示错误，避免误跳登录页
    const errorEl = container.querySelector('.error');
    if (errorEl) {
      errorEl.textContent = e.message;
    } else {
      const div = document.createElement('div');
      div.className = 'error';
      div.textContent = e.message;
      container.insertBefore(div, container.firstChild);
    }
  }
}

async function navigateToRoom(roomId: string, error?: string): Promise<void> {
  clean();
  if (!currentUser) {
    await navigateToLogin();
    return;
  }

  try {
    currentRoom = await getRoom(roomId);
  } catch {
    navigateToLobby('房间不存在');
    return;
  }

  const container = document.createElement('div');
  container.className = 'page room-page';
  container.innerHTML = `
    <header>
      <h1>房间 ${currentRoom.name}</h1>
      <button id="btn-back">返回大厅</button>
    </header>
    ${error ? `<div class="error">${error}</div>` : ''}
    <div class="room-id">房间号：<strong>${currentRoom.id}</strong></div>
    <div class="room-content">
      <div class="players-panel">
        <h2>玩家</h2>
        <ul id="player-list"></ul>
      </div>
      <div class="actions-panel">
        <h2>选择角色</h2>
        <div id="character-select"></div>
        <div class="action-buttons">
          <button id="btn-ready">准备</button>
          <button id="btn-start" style="display:none">开始游戏</button>
          ${isTestMode() ? '<button id="btn-add-bot" class="btn-bot">添加AI机器人</button>' : ''}
        </div>
      </div>
    </div>
  `;
  app.appendChild(container);

  container.querySelector('#btn-back')!.addEventListener('click', () => {
    leaveRoom(roomId);
    navigateToLobby();
  });

  container.querySelector('#btn-ready')!.addEventListener('click', () => {
    const me = currentRoom!.players.find((p) => p.userId === currentUser!.id);
    toggleReadySocket(roomId, !me?.isReady);
  });

  container.querySelector('#btn-start')!.addEventListener('click', () => {
    startGame(roomId);
  });

  // 测试模式：添加AI机器人
  const addBotBtn = container.querySelector<HTMLButtonElement>('#btn-add-bot');
  if (addBotBtn) {
    addBotBtn.addEventListener('click', () => {
      getSocket().emit('test:addBot', roomId);
    });
  }

  // 角色选择
  const charContainer = container.querySelector<HTMLDivElement>('#character-select')!;
  CHARACTERS.forEach((char) => {
    const btn = document.createElement('button');
    btn.className = 'char-btn';
    btn.dataset.charId = char.id;
    btn.textContent = char.name;
    btn.style.background = char.color;
    btn.addEventListener('click', () => {
      selectCharacterSocket(roomId, char.id);
    });
    charContainer.appendChild(btn);
  });

  renderRoomPlayers(container, currentRoom);
  joinRoom(roomId);

  cleanupFns.push(
    onRoomUpdated((room) => {
      currentRoom = room;
      if (room.status === 'playing') {
        navigateToGame(roomId);
        return;
      }
      renderRoomPlayers(container, room);
    })
  );

  cleanupFns.push(
    onError((msg) => {
      showToast(msg, 'error');
    })
  );
}

function renderRoomPlayers(container: HTMLElement, room: Room): void {
  const list = container.querySelector<HTMLUListElement>('#player-list')!;
  list.innerHTML = '';
  room.players.forEach((p) => {
    const char = CHARACTERS.find((c) => c.id === p.characterId);
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="player-main">
        <span class="player-name" style="color:${char?.color || 'var(--color-white)'}\">${p.username}</span>
        <span class="player-char">${char?.name || p.characterId}</span>
      </div>
      <span class="player-badges">
        ${p.isAI ? '<span class="badge bot">🤖 AI</span>' : ''}
        ${p.isHost ? '<span class="badge host">房主</span>' : ''}
        <span class="player-ready ${p.isReady ? 'ready' : ''}">${p.isReady ? '✅ 已准备' : '⏳ 未准备'}</span>
      </span>
    `;
    list.appendChild(li);
  });

  const myPlayer = room.players.find((p) => p.userId === currentUser?.id);
  const takenChars = new Set(room.players.map((p) => p.characterId));
  container.querySelectorAll<HTMLButtonElement>('.char-btn').forEach((btn) => {
    const charId = btn.dataset.charId!;
    const isMine = myPlayer?.characterId === charId;
    const isTaken = takenChars.has(charId) && !isMine;
    btn.disabled = isTaken;
    btn.classList.toggle('selected', isMine);
    btn.title = isTaken ? '已被其他玩家选择' : charId;
  });

  const isHost = room.hostId === currentUser?.id;
  const startBtn = container.querySelector<HTMLButtonElement>('#btn-start')!;
  if (isHost) {
    startBtn.style.display = 'inline-block';
    const allReady = room.players.every((p) => p.isReady || p.isHost);
    startBtn.disabled = !allReady || room.players.length < 2;
  } else {
    startBtn.style.display = 'none';
  }
}

async function navigateToGame(roomId: string): Promise<void> {
  clean();
  if (!currentUser) {
    await navigateToLogin();
    return;
  }

  const container = document.createElement('div');
  container.className = 'page game-page';
  container.innerHTML = `
    <header>
      <h1>游戏中 - 房间 ${roomId}</h1>
      <button id="btn-exit">退出</button>
    </header>
    <div class="stock-top-panel">
      <div class="stock-top-header">
        <h2>股市与公司</h2>
        <button id="btn-toggle-stock" class="btn-icon" title="展开/折叠">−</button>
      </div>
      <div id="stock-market"></div>
    </div>
    <div class="game-layout">
      <div class="board-wrap"></div>
      <div class="side-panel">
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
  `;
  app.appendChild(container);

  const boardWrap = container.querySelector<HTMLDivElement>('.board-wrap')!;
  const canvas = createBoardCanvas();
  gameCanvas = canvas;
  currentHoverIndex = -1;
  currentHoverPixel = undefined;
  boardWrap.appendChild(canvas);

  // 棋盘鼠标悬停与点击：实时更新 hoverIndex 并触发重绘，支持地图选块
  function attachBoardEvents(c: HTMLCanvasElement) {
    c.addEventListener('mousemove', (e) => {
      const rect = c.getBoundingClientRect();
      const dpr = Number(c.dataset.dpr || '1');
      const x = (e.clientX - rect.left) * (c.width / rect.width) / dpr;
      const y = (e.clientY - rect.top) * (c.height / rect.height) / dpr;
      const idx = getTileIndexAt(x, y);
      if (idx !== currentHoverIndex) {
        currentHoverIndex = idx;
        currentHoverPixel = { x, y };
        if (currentGame) renderBoardWithSelection(currentGame);
      } else if (idx >= 0) {
        currentHoverPixel = { x, y };
      }
    });
    c.addEventListener('mouseleave', () => {
      currentHoverIndex = -1;
      currentHoverPixel = undefined;
      if (currentGame) renderBoardWithSelection(currentGame);
    });
    c.addEventListener('click', (e) => {
      if (!tileSelectionResolver || !currentGame) return;
      const rect = c.getBoundingClientRect();
      const dpr = Number(c.dataset.dpr || '1');
      const x = (e.clientX - rect.left) * (c.width / rect.width) / dpr;
      const y = (e.clientY - rect.top) * (c.height / rect.height) / dpr;
      const idx = getTileIndexAt(x, y);
      if (idx < 0) return;
      const tile = currentGame.map.tiles[idx];
      if (tileSelectionFilter && !tileSelectionFilter(tile)) return;
      const resolver = tileSelectionResolver;
      tileSelectionResolver = null;
      tileSelectionCancel = null;
      tileSelectionFilter = null;
      resolver(idx);
    });
  }
  attachBoardEvents(canvas);

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
    if (currentGame) renderStockMarket(container, currentGame);
  });

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

  function renderGame(state: GameState): void {
    currentGame = state;
    // 当地图格数变化时重建 canvas
    if (String(state.map.tiles.length) !== canvas.dataset.tileCount) {
      const oldCanvas = canvas;
      const newCanvas = createBoardCanvas(state.map.tiles.length);
      boardWrap.replaceChild(newCanvas, oldCanvas);
      gameCanvas = newCanvas;
      attachBoardEvents(newCanvas);
      currentHoverIndex = -1;
      currentHoverPixel = undefined;
    }
    renderBoardWithSelection(state);
    renderPlayersInfo(container, state);
    renderBackpack(container, state);
    renderActions(container, state);
    renderStockMarket(container, state);
    renderLogs(container, state);
  }

  cleanupFns.push(onGameState(renderGame));
  cleanupFns.push(
    onError((msg) => {
      showToast(msg, 'error');
    })
  );

  // 测试模式：在游戏界面添加测试面板
  if (isTestMode()) {
    const testPanel = createTestPanel(() => currentGame);
    document.body.appendChild(testPanel);
  }
}

function renderPlayerInfoCard(player: Player, state: GameState, isSelf = false): HTMLDivElement {
  const div = document.createElement('div');
  div.className = `player-info ${isSelf ? 'player-info-self' : ''}`;
  const isCurrent = state.players[state.currentPlayerIndex].id === player.id;
  div.innerHTML = `
    <div class="player-info-header">
      <strong style="color:${player.color}">${player.username}</strong>
      ${isCurrent ? '<span class="current-turn">← 当前回合</span>' : ''}
      ${player.isAI ? '<span class="badge bot">AI</span>' : ''}
    </div>
    <div class="info-section">现金: $${player.cash} | 存款: $${player.deposit} | 贷款: $${player.loan} | 点券: ${player.coupons}</div>
    <div class="info-section">地产: ${player.properties.length} 处 | 保险: ${player.insuranceDays} 天</div>
    <div class="info-section">卡片: ${player.cards.length}/15 | 道具: ${player.items.reduce((s, i) => s + i.quantity, 0)}</div>
    ${player.spirit ? `<div class="info-section">神明: ${player.spirit.spiritId}</div>` : ''}
    ${player.isBankrupt ? '<div class="bankrupt">已破产</div>' : ''}
  `;
  return div;
}

function renderPlayersInfo(container: HTMLElement, state: GameState): void {
  const el = container.querySelector<HTMLDivElement>('#players-info')!;
  el.innerHTML = '';

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

/** 渲染背包面板（卡片网格 + 道具网格） */
function renderBackpack(container: HTMLElement, state: GameState): void {
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
      cell.style.borderColor = typeColor;
      cell.innerHTML = `
        <div class="item-cell-name" style="background:${typeColor}">${def?.name ?? it.itemId}</div>
        <div class="item-cell-qty">×${it.quantity}</div>
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

function renderActions(container: HTMLElement, state: GameState): void {
  const el = container.querySelector<HTMLDivElement>('#game-actions')!;
  el.innerHTML = '';
  const currentPlayer = state.players[state.currentPlayerIndex];
  const isMyTurn = currentPlayer.id === currentUser?.id;

  if (state.status === 'ended') {
    const winner = state.players.find((p) => p.id === state.winnerId);
    el.innerHTML = `<div class="winner">🎉 ${winner?.username || '未知'} 获胜！</div>`;
    return;
  }

  if (isMyTurn) {
    if (state.status === 'rolling') {
      const btn = document.createElement('button');
      btn.textContent = `掷骰子 (${state.lastRoll ?? '?'})`;
      btn.addEventListener('click', () => rollDice(state.roomId));
      el.appendChild(btn);
    } else if (state.status === 'acting') {
      const tileIndex = state.pendingTileIndex ?? currentPlayer.position;
      const tile = state.map.tiles[tileIndex];

      if (tile.type === 'property' && !tile.ownerId) {
        const btn = document.createElement('button');
        btn.textContent = `购买 ${tile.name} ($${Math.floor(tile.basePrice * state.priceIndex)})`;
        btn.addEventListener('click', () => buyProperty(state.roomId));
        el.appendChild(btn);
      } else if (tile.type === 'shop') {
        if (state.config.enableCards !== false) {
          const shopCardBtn = document.createElement('button');
          shopCardBtn.textContent = '购买卡片';
          shopCardBtn.addEventListener('click', async () => {
            const cardChoices = Object.values(CARD_DEFINITIONS)
              .filter((c) => c.cost > 0)
              .map((c, i) => ({ value: String(i + 1), label: `${i + 1}. ${c.name} (${c.cost}点)` }));
            const choice = await showPrompt('选择要购买的卡片：', { choices: cardChoices });
            const idx = parseInt(choice || '', 10) - 1;
            const card = Object.values(CARD_DEFINITIONS).filter((c) => c.cost > 0)[idx];
            if (card) buyCard(state.roomId, card.id);
          });
          el.appendChild(shopCardBtn);
        }

        if (state.config.enableItems !== false) {
          const shopItemBtn = document.createElement('button');
          shopItemBtn.textContent = '购买道具';
          shopItemBtn.addEventListener('click', async () => {
            const itemChoices = Object.values(ITEM_DEFINITIONS)
              .filter((i) => i.cost > 0)
              .map((it, i) => ({ value: String(i + 1), label: `${i + 1}. ${it.name} (${it.cost}点)` }));
            const choice = await showPrompt('选择要购买的道具：', { choices: itemChoices });
            const idx = parseInt(choice || '', 10) - 1;
            const item = Object.values(ITEM_DEFINITIONS).filter((i) => i.cost > 0)[idx];
            if (item) buyItem(state.roomId, item.id);
          });
          el.appendChild(shopItemBtn);
        }
      } else if (tile.type === 'property' && tile.ownerId === currentPlayer.id) {
        const bt = tile.buildingType ?? 'house';
        const canUp = bt !== 'chainStore' && bt !== 'park' && bt !== 'gasStation' && tile.level < 5;
        if (canUp) {
          const btn = document.createElement('button');
          const cost = Math.floor(tile.basePrice * (tile.level + 1) * 0.5 * state.priceIndex);
          btn.textContent = `升级 ${tile.name} ($${cost})`;
          btn.addEventListener('click', () => upgradeProperty(state.roomId));
          el.appendChild(btn);
        }

        // 改建按钮
        const rebuildBtn = document.createElement('button');
        rebuildBtn.textContent = '改建';
        rebuildBtn.addEventListener('click', async () => {
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
            rebuildTile(state.roomId, tileIndex, options[idx].value as any);
          }
        });
        el.appendChild(rebuildBtn);
      }

      // 银行贷款与还款（起点/银行格可贷款，有贷款时随时可还款）
      if (tile.type === 'start') {
        const loanBtn = document.createElement('button');
        loanBtn.textContent = '银行贷款';
        loanBtn.addEventListener('click', async () => {
          const input = await showPrompt('输入贷款金额：');
          const amount = parseInt(input || '', 10);
          if (amount > 0) takeLoan(state.roomId, amount);
        });
        el.appendChild(loanBtn);
      }
      if (currentPlayer.loan > 0) {
        const repayBtn = document.createElement('button');
        repayBtn.textContent = '偿还贷款';
        repayBtn.addEventListener('click', async () => {
          const input = await showPrompt(`输入还款金额（最大 $${Math.min(currentPlayer.cash, currentPlayer.loan)}）：`);
          const amount = parseInt(input || '', 10);
          if (amount > 0) repayLoan(state.roomId, amount);
        });
        el.appendChild(repayBtn);
      }

      // 乐透格投注
      if (tile.type === 'lottery') {
        const lotteryBtn = document.createElement('button');
        lotteryBtn.textContent = '投注乐透 ($1000)';
        lotteryBtn.addEventListener('click', async () => {
          const input = await showPrompt('选择 0-9 的号码：');
          const number = parseInt(input || '', 10);
          if (!Number.isNaN(number)) placeLotteryBet(state.roomId, number);
        });
        el.appendChild(lotteryBtn);
      }

      // 魔法屋施法
      if (tile.type === 'magic') {
        const magicBtn = document.createElement('button');
        magicBtn.textContent = '魔法屋施法';
        magicBtn.addEventListener('click', async () => {
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
            'swapCash',
            'dismissSpirit',
            'stealCard',
            'jail',
          ];
          const spell = spells[spellIdx - 1];
          if (spell) castMagicSpell(state.roomId, target.id, spell);
        });
        el.appendChild(magicBtn);
      }

      // 理赔按钮
      if (currentPlayer.insuranceDays > 0) {
        const claimBtn = document.createElement('button');
        claimBtn.textContent = '申请理赔';
        claimBtn.addEventListener('click', () => claimInsurance(state.roomId));
        el.appendChild(claimBtn);
      }

      const skipBtn = document.createElement('button');
      skipBtn.textContent = '结束回合';
      skipBtn.addEventListener('click', () => skipTurn(state.roomId));
      el.appendChild(skipBtn);
    }
  } else {
    el.innerHTML = `<div>等待 ${currentPlayer.username} 操作...</div>`;
  }
}

function renderStockMarket(container: HTMLElement, state: GameState): void {
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
        <th>成本价（仓位）</th>
        <th>操作</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  const tbody = table.querySelector('tbody')!;

  const filteredStocks = isStockCollapsed
    ? state.stocks.filter((stock) => (currentPlayer?.stockHoldings[stock.id] ?? 0) > 0)
    : state.stocks;

  if (filteredStocks.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'stock-empty';
    empty.textContent = isStockCollapsed ? '当前未持有任何股票' : '暂无股票数据';
    el.appendChild(empty);
    return;
  }

  filteredStocks.forEach((stock) => {
    const company = state.companies.find((c) => c.id === stock.companyId);
    const holding = currentPlayer?.stockHoldings[stock.id] ?? 0;
    const costBasis = currentPlayer?.stockCostBasis[stock.id] ?? 0;
    const chairman = company?.chairmanPlayerId
      ? state.players.find((p) => p.id === company.chairmanPlayerId)?.username
      : '无';
    const tr = document.createElement('tr');
    const fluctuationClass = stock.fluctuation >= 0 ? 'stock-up' : 'stock-down';
    const fluctuationSign = stock.fluctuation >= 0 ? '+' : '';
    const unrealized = holding > 0 ? (stock.price - costBasis) * holding : 0;
    const plClass = unrealized >= 0 ? 'stock-up' : 'stock-down';
    const plSign = unrealized >= 0 ? '+' : '';
    tr.innerHTML = `
      <td>${stock.name}<br><small>董事长：${chairman}（需>10%）</small></td>
      <td>$${stock.price}</td>
      <td class="${fluctuationClass}">${fluctuationSign}${stock.fluctuation}%</td>
      <td>${holding}</td>
      <td>$${costBasis}<br><small class="${plClass}">${plSign}$${unrealized}</small></td>
      <td></td>
    `;
    const actions = tr.querySelector('td:last-child')!;

    const buyBtn = document.createElement('button');
    buyBtn.textContent = '买1';
    buyBtn.disabled = stock.suspendedDays > 0 || currentPlayer?.id !== state.players[state.currentPlayerIndex].id;
    buyBtn.addEventListener('click', () => tradeStock(state.roomId, stock.id, 1));
    actions.appendChild(buyBtn);

    const sellBtn = document.createElement('button');
    sellBtn.textContent = '卖1';
    sellBtn.disabled = holding <= 0 || stock.suspendedDays > 0;
    sellBtn.addEventListener('click', () => tradeStock(state.roomId, stock.id, -1));
    actions.appendChild(sellBtn);

    tbody.appendChild(tr);
  });

  el.appendChild(table);
}

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

function renderLogs(container: HTMLElement, state: GameState): void {
  const el = container.querySelector<HTMLDivElement>('#game-logs')!;
  el.innerHTML = '';
  [...state.logs].reverse().slice(0, 50).forEach((log) => {
    const div = document.createElement('div');
    div.className = 'log-item';
    if (isLogHighlighted(log)) {
      div.classList.add('log-highlight');
    }
    div.textContent = log.message;
    el.appendChild(div);
  });
}

/** 进入地图选块模式，等待用户点击棋盘选择地块 */
function selectTileOnBoard(state: GameState, message: string, filter?: (tile: Tile) => boolean): Promise<number> {
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

async function promptCardTarget(state: GameState, cardId: string): Promise<CardUseTarget> {
  const target: CardUseTarget = {};
  if (cardId === 'rebuild') {
    target.targetTileIndex = await selectTileOnBoard(state, '请点击要改建的地块');
    const typeInput = await showPrompt('输入建筑类型（house/chainStore/park/mall/hotel/gasStation/lab）：');
    target.buildingType = typeInput as BuildingType | undefined;
  } else if (cardId === 'priceRise' || cardId === 'seal' || cardId === 'angel' || cardId === 'devil') {
    const groupInput = await showPrompt('输入目标路段 group 编号：');
    target.targetGroup = parseInt(groupInput || '', 10);
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

async function promptItemTarget(state: GameState, itemId: string): Promise<ItemUseTarget> {
  const target: ItemUseTarget = {};
  if (itemId === 'remoteDice') {
    const diceInput = await showPrompt('输入要控制的骰子点数 1-6：');
    target.diceValue = parseInt(diceInput || '', 10);
  } else if (itemId === 'barrier' || itemId === 'mine' || itemId === 'timeBomb' || itemId === 'missile') {
    target.targetTileIndex = await selectTileOnBoard(state, '请点击要放置道具的目标地块');
  }
  return target;
}

// 检测 URL 参数 ?test=1 启用测试模式
if (new URLSearchParams(window.location.search).get('test') === '1') {
  enableTestMode();
}

// 启动
(async () => {
  if (currentUser) {
    navigateToLobby();
  } else {
    await navigateToLogin();
  }
})();

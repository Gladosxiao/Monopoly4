import {
  type Room,
  type GameState,
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
  createRoom,
  listRooms,
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
  skipTurn,
  onRoomUpdated,
  onGameState,
  onError,
  disconnectSocket,
} from './socket.js';
import { createBoardCanvas, renderBoard } from './board.js';

const app = document.getElementById('app')!;

let currentRoom: Room | null = null;
let currentGame: GameState | null = null;
let currentUser: PublicUser | null = loadUser();
let cleanupFns: Array<() => void> = [];

function clean() {
  cleanupFns.forEach((fn) => fn());
  cleanupFns = [];
  app.innerHTML = '';
}

function navigateToLogin(error?: string): void {
  clean();
  const container = document.createElement('div');
  container.className = 'page login-page';
  container.innerHTML = `
    <h1>大富翁4 Web</h1>
    <div class="auth-box">
      <h2>登录 / 注册</h2>
      ${error ? `<div class="error">${error}</div>` : ''}
      <input type="text" id="username" placeholder="用户名" />
      <input type="password" id="password" placeholder="密码（至少6位）" />
      <div class="buttons">
        <button id="btn-login">登录</button>
        <button id="btn-register">注册</button>
      </div>
    </div>
  `;
  app.appendChild(container);

  const username = container.querySelector<HTMLInputElement>('#username')!;
  const password = container.querySelector<HTMLInputElement>('#password')!;

  container.querySelector('#btn-login')!.addEventListener('click', async () => {
    try {
      const res = await login(username.value, password.value);
      saveAuth(res);
      currentUser = res.user;
      navigateToLobby();
    } catch (e: any) {
      navigateToLogin(e.message);
    }
  });

  container.querySelector('#btn-register')!.addEventListener('click', async () => {
    try {
      const res = await register(username.value, password.value);
      saveAuth(res);
      currentUser = res.user;
      navigateToLobby();
    } catch (e: any) {
      navigateToLogin(e.message);
    }
  });
}

async function navigateToLobby(error?: string): Promise<void> {
  clean();
  if (!currentUser) {
    try {
      const { user } = await getMe();
      currentUser = user;
    } catch {
      navigateToLogin();
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
      <button id="btn-create">创建房间</button>
      <input type="text" id="join-id" placeholder="输入房间号加入" />
      <button id="btn-join">加入</button>
    </div>
    <h2>房间列表</h2>
    <ul id="room-list"></ul>
  `;
  app.appendChild(container);

  container.querySelector('#btn-logout')!.addEventListener('click', () => {
    logout();
    disconnectSocket();
    currentUser = null;
    navigateToLogin();
  });

  container.querySelector('#btn-create')!.addEventListener('click', async () => {
    const name = container.querySelector<HTMLInputElement>('#room-name')!.value || '新房間';
    try {
      const room = await createRoom({ name, maxPlayers: 4 });
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
        <span>${room.name} (${room.players.length}/${room.maxPlayers})</span>
        <button>加入</button>
      `;
      li.querySelector('button')!.addEventListener('click', () => navigateToRoom(room.id));
      list.appendChild(li);
    });
  } catch (e: any) {
    navigateToLogin(e.message);
  }
}

async function navigateToRoom(roomId: string, error?: string): Promise<void> {
  clean();
  if (!currentUser) {
    navigateToLogin();
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

  // 角色选择
  const charContainer = container.querySelector<HTMLDivElement>('#character-select')!;
  CHARACTERS.forEach((char) => {
    const btn = document.createElement('button');
    btn.className = 'char-btn';
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
      alert(msg);
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
      <span style="color:${char?.color || '#fff'}">${p.username}</span>
      <span>${char?.name || p.characterId}</span>
      <span>${p.isHost ? '房主' : ''} ${p.isReady ? '已准备' : '未准备'}</span>
    `;
    list.appendChild(li);
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
    navigateToLogin();
    return;
  }

  const container = document.createElement('div');
  container.className = 'page game-page';
  container.innerHTML = `
    <header>
      <h1>游戏中 - 房间 ${roomId}</h1>
      <button id="btn-exit">退出</button>
    </header>
    <div class="game-layout">
      <div class="board-wrap"></div>
      <div class="side-panel">
        <div class="info-card">
          <h2>玩家信息</h2>
          <div id="players-info"></div>
        </div>
        <div class="info-card">
          <h2>操作</h2>
          <div id="game-actions"></div>
        </div>
        <div class="info-card">
          <h2>股市与公司</h2>
          <div id="stock-market"></div>
        </div>
        <div class="info-card logs">
          <h2>日志</h2>
          <div id="game-logs"></div>
        </div>
      </div>
    </div>
  `;
  app.appendChild(container);

  const boardWrap = container.querySelector<HTMLDivElement>('.board-wrap')!;
  let canvas = createBoardCanvas();
  boardWrap.appendChild(canvas);

  container.querySelector('#btn-exit')!.addEventListener('click', () => {
    navigateToLobby();
  });

  function renderGame(state: GameState): void {
    currentGame = state;
    // 当地图格数变化时重建 canvas
    if (String(state.map.tiles.length) !== canvas.dataset.tileCount) {
      const newCanvas = createBoardCanvas(state.map.tiles.length);
      boardWrap.replaceChild(newCanvas, canvas);
      canvas = newCanvas;
    }
    renderBoard(canvas, state, currentUser!.id);
    renderPlayersInfo(container, state);
    renderActions(container, state);
    renderStockMarket(container, state);
    renderLogs(container, state);
  }

  cleanupFns.push(onGameState(renderGame));
  cleanupFns.push(
    onError((msg) => {
      alert(msg);
    })
  );
}

function renderPlayersInfo(container: HTMLElement, state: GameState): void {
  const el = container.querySelector<HTMLDivElement>('#players-info')!;
  el.innerHTML = '';
  state.players.forEach((p) => {
    const div = document.createElement('div');
    div.className = 'player-info';
    const isCurrent = state.players[state.currentPlayerIndex].id === p.id;
    const cardNames = p.cards.map((c) => CARD_DEFINITIONS[c.cardId]?.name ?? c.cardId).join(', ');
    const itemNames = p.items.map((i) => `${ITEM_DEFINITIONS[i.itemId]?.name ?? i.itemId}×${i.quantity}`).join(', ');
    div.innerHTML = `
      <strong style="color:${p.color}">${p.username}</strong>
      ${isCurrent ? ' ← 当前回合' : ''}
      <div>现金: $${p.cash} | 存款: $${p.deposit} | 点券: ${p.coupons}</div>
      <div>地产: ${p.properties.length} 处 | 保险: ${p.insuranceDays} 天</div>
      <div>卡片: ${cardNames || '无'} (${p.cards.length}/15)</div>
      <div>道具: ${itemNames || '无'}</div>
      ${p.spirit ? `<div>神明: ${p.spirit.spiritId}</div>` : ''}
      ${p.isBankrupt ? '<div class="bankrupt">已破产</div>' : ''}
    `;
    el.appendChild(div);
  });
  const monthInfo = document.createElement('div');
  monthInfo.className = 'month-info';
  monthInfo.textContent = `第 ${state.month} 月 第 ${state.day} 天 | 物价指数: ${state.priceIndex.toFixed(2)}`;
  el.appendChild(monthInfo);
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
        const shopCardBtn = document.createElement('button');
        shopCardBtn.textContent = '购买卡片';
        shopCardBtn.addEventListener('click', () => {
          const lines = Object.values(CARD_DEFINITIONS)
            .filter((c) => c.cost > 0)
            .map((c, i) => `${i + 1}. ${c.name} (${c.cost}点)`);
          const choice = window.prompt(`选择要购买的卡片：\n${lines.join('\n')}`);
          const idx = parseInt(choice || '', 10) - 1;
          const card = Object.values(CARD_DEFINITIONS).filter((c) => c.cost > 0)[idx];
          if (card) buyCard(state.roomId, card.id);
        });
        el.appendChild(shopCardBtn);

        const shopItemBtn = document.createElement('button');
        shopItemBtn.textContent = '购买道具';
        shopItemBtn.addEventListener('click', () => {
          const lines = Object.values(ITEM_DEFINITIONS)
            .filter((i) => i.cost > 0)
            .map((it, i) => `${i + 1}. ${it.name} (${it.cost}点)`);
          const choice = window.prompt(`选择要购买的道具：\n${lines.join('\n')}`);
          const idx = parseInt(choice || '', 10) - 1;
          const item = Object.values(ITEM_DEFINITIONS).filter((i) => i.cost > 0)[idx];
          if (item) buyItem(state.roomId, item.id);
        });
        el.appendChild(shopItemBtn);
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
        rebuildBtn.addEventListener('click', () => {
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
          const choice = window.prompt(
            `选择建筑类型：\n${options.map((o, i) => `${i + 1}. ${o.label}`).join('\n')}`
          );
          const idx = parseInt(choice || '', 10) - 1;
          if (idx >= 0 && idx < options.length) {
            rebuildTile(state.roomId, tileIndex, options[idx].value as any);
          }
        });
        el.appendChild(rebuildBtn);
      }

      // 使用卡片按钮
      if (currentPlayer.cards.length > 0) {
        const cardBtn = document.createElement('button');
        cardBtn.textContent = `使用卡片 (${currentPlayer.cards.length})`;
        cardBtn.addEventListener('click', () => {
          const lines = currentPlayer.cards.map((c, i) => {
            const def = CARD_DEFINITIONS[c.cardId];
            return `${i + 1}. ${def?.name ?? c.cardId}`;
          });
          const choice = window.prompt(`选择卡片：\n${lines.join('\n')}`);
          const idx = parseInt(choice || '', 10) - 1;
          const card = currentPlayer.cards[idx];
          if (!card) return;
          const target = promptCardTarget(state, card.cardId);
          useCard(state.roomId, card.instanceId, target);
        });
        el.appendChild(cardBtn);
      }

      // 使用道具按钮
      if (currentPlayer.items.length > 0) {
        const itemBtn = document.createElement('button');
        itemBtn.textContent = `使用道具 (${currentPlayer.items.reduce((s, i) => s + i.quantity, 0)})`;
        itemBtn.addEventListener('click', () => {
          const lines = currentPlayer.items.map((it, i) => {
            const def = ITEM_DEFINITIONS[it.itemId];
            return `${i + 1}. ${def?.name ?? it.itemId} ×${it.quantity}`;
          });
          const choice = window.prompt(`选择道具：\n${lines.join('\n')}`);
          const idx = parseInt(choice || '', 10) - 1;
          const item = currentPlayer.items[idx];
          if (!item) return;
          const target = promptItemTarget(state, item.itemId);
          useItem(state.roomId, item.itemId, target);
        });
        el.appendChild(itemBtn);
      }

      // 改建按钮（自己的地）
      if (tile.type === 'property' && tile.ownerId === currentPlayer.id) {
        const rebuildBtn = document.createElement('button');
        rebuildBtn.textContent = '改建';
        rebuildBtn.addEventListener('click', () => {
          const choices = tile.size === 'small'
            ? [{ id: 'house', name: '住宅' }, { id: 'chainStore', name: '连锁店' }]
            : [
                { id: 'park', name: '公园' },
                { id: 'mall', name: '商场' },
                { id: 'hotel', name: '旅馆' },
                { id: 'gasStation', name: '加油站' },
                { id: 'lab', name: '研究所' },
              ];
          const choice = window.prompt(
            '选择建筑类型：' + choices.map((c) => `${c.id}=${c.name}`).join('，')
          );
          if (choice) rebuildTile(state.roomId, tileIndex, choice as any);
        });
        el.appendChild(rebuildBtn);
      }

      // 使用卡片按钮
      if (currentPlayer.cards.length > 0) {
        const cardBtn = document.createElement('button');
        cardBtn.textContent = '使用卡片';
        cardBtn.addEventListener('click', () => {
          const card = currentPlayer.cards[0];
          const def = currentPlayer.cards.find((c) => c.cardId === card.cardId);
          useCard(state.roomId, card.instanceId);
        });
        el.appendChild(cardBtn);
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
        <th>操作</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  const tbody = table.querySelector('tbody')!;

  state.stocks.forEach((stock) => {
    const company = state.companies.find((c) => c.id === stock.companyId);
    const holding = currentPlayer?.stockHoldings[stock.id] ?? 0;
    const chairman = company?.chairmanPlayerId
      ? state.players.find((p) => p.id === company.chairmanPlayerId)?.username
      : '无';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${stock.name}<br><small>董事长：${chairman}</small></td>
      <td>$${stock.price}</td>
      <td>${stock.fluctuation >= 0 ? '+' : ''}${stock.fluctuation}%</td>
      <td>${holding}</td>
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

function renderLogs(container: HTMLElement, state: GameState): void {
  const el = container.querySelector<HTMLDivElement>('#game-logs')!;
  el.innerHTML = '';
  [...state.logs].reverse().slice(0, 30).forEach((log) => {
    const div = document.createElement('div');
    div.className = 'log-item';
    div.textContent = log.message;
    el.appendChild(div);
  });
}

function promptCardTarget(state: GameState, cardId: string): CardUseTarget {
  const target: CardUseTarget = {};
  if (cardId === 'rebuild') {
    target.targetTileIndex = parseInt(window.prompt('输入改建地块索引：') || '', 10);
    target.buildingType = window.prompt(
      '输入建筑类型（house/chainStore/park/mall/hotel/gasStation/lab）：'
    ) as BuildingType | undefined;
  } else if (cardId === 'priceRise' || cardId === 'seal' || cardId === 'angel' || cardId === 'devil') {
    target.targetGroup = parseInt(window.prompt('输入目标路段 group 编号：') || '', 10);
  } else if (cardId === 'alliance' || cardId === 'turnAround' || cardId === 'stay' || cardId === 'turtle' || cardId === 'sleepwalk' || cardId === 'frame') {
    const lines = state.players.map((p, i) => `${i + 1}. ${p.username}`);
    const choice = window.prompt(`选择目标玩家：\n${lines.join('\n')}`);
    const idx = parseInt(choice || '', 10) - 1;
    target.targetPlayerId = state.players[idx]?.id;
  } else if (cardId === 'swapLand' || cardId === 'auction' || cardId === 'monster' || cardId === 'demolish') {
    target.targetTileIndex = parseInt(window.prompt('输入目标地块索引：') || '', 10);
  } else if (cardId === 'summonSpirit') {
    target.targetPlayerId = window.prompt('输入神明 ID（如 smallWealthGod）：') || undefined;
  }
  return target;
}

function promptItemTarget(state: GameState, itemId: string): ItemUseTarget {
  const target: ItemUseTarget = {};
  if (itemId === 'remoteDice') {
    target.diceValue = parseInt(window.prompt('输入要控制的骰子点数 1-6：') || '', 10);
  } else if (itemId === 'barrier' || itemId === 'mine' || itemId === 'timeBomb' || itemId === 'missile') {
    target.targetTileIndex = parseInt(window.prompt('输入目标地块索引：') || '', 10);
  }
  return target;
}

// 启动
if (currentUser) {
  navigateToLobby();
} else {
  navigateToLogin();
}

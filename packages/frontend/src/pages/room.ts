import type { Room } from '@monopoly4/shared';
import { CHARACTERS } from '@monopoly4/shared';
import { getCurrentUser } from '../state/user.js';
import { setCurrentRoom } from '../state/game.js';

import { getRoom } from '../api.js';
import {
  leaveRoom,
  joinRoom,
  toggleReady as toggleReadySocket,
  selectCharacter as selectCharacterSocket,
  startGame,
  addAI,
  getSocket,
  onRoomUpdated,
  onError,
  onAiThinking,
  onAiDecided,
} from '../socket.js';
import { navigateToLogin, navigateToLobby, navigateToGame, registerCleanup } from '../router.js';
import { showToast, showBanner, hideBanner, escapeHtml } from '../ui/common.js';
import { isTestMode } from '../testMode/index.js';

const app = document.getElementById('app')!;

export async function renderRoomPage(roomId: string, error?: string): Promise<void> {
  const currentUser = getCurrentUser();
  if (!currentUser) {
    await navigateToLogin();
    return;
  }

  let currentRoom: Room;
  try {
    currentRoom = await getRoom(roomId);
    setCurrentRoom(currentRoom);
  } catch {
    navigateToLobby('房间不存在');
    return;
  }

  const container = document.createElement('div');
  container.className = 'page room-page';
  container.innerHTML = `
    <header>
      <h1>房间 <span class="room-name-text">${escapeHtml(currentRoom.name)}</span></h1>
      <button id="btn-back" class="ghost">← 返回大厅</button>
    </header>
    ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
    <div class="room-id">房间号 <strong>${currentRoom.id}</strong></div>
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
          <button id="btn-start" class="lobby-primary" style="display:none">开始游戏</button>
          <button id="btn-add-heuristic" class="btn-bot" style="display:none">+ 启发式 AI</button>
          <button id="btn-add-llm" class="btn-bot" style="display:none">+ LLM AI</button>
          ${isTestMode() ? '<button id="btn-add-bot" class="btn-bot">+ 测试机器人</button>' : ''}
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
    const me = currentRoom.players.find((p) => p.userId === currentUser.id);
    toggleReadySocket(roomId, !me?.isReady);
  });

  container.querySelector('#btn-start')!.addEventListener('click', () => {
    startGame(roomId);
  });

  // 添加启发式 AI
  const addHeuristicBtn = container.querySelector<HTMLButtonElement>('#btn-add-heuristic');
  if (addHeuristicBtn) {
    addHeuristicBtn.addEventListener('click', () => addAI(roomId, 'heuristic'));
  }

  // 添加 LLM AI
  const addLLMBtn = container.querySelector<HTMLButtonElement>('#btn-add-llm');
  if (addLLMBtn) {
    addLLMBtn.addEventListener('click', () => addAI(roomId, 'llm'));
  }

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

  registerCleanup(
    onRoomUpdated((room) => {
      setCurrentRoom(room);
      if (room.status === 'playing') {
        navigateToGame(roomId);
        return;
      }
      renderRoomPlayers(container, room);
    })
  );

  registerCleanup(
    onError((msg) => {
      showToast(msg, 'error');
    })
  );

  registerCleanup(
    onAiThinking((payload) => {
      showBanner(`🤖 ${payload.username} ${payload.message}（约 ${payload.estimatedWaitSeconds} 秒）`);
    })
  );

  registerCleanup(
    onAiDecided((payload) => {
      hideBanner();
    })
  );
}

export function renderRoomPlayers(container: HTMLElement, room: Room): void {
  const currentUser = getCurrentUser();
  const list = container.querySelector<HTMLUListElement>('#player-list')!;
  list.innerHTML = '';
  room.players.forEach((p) => {
    const char = CHARACTERS.find((c) => c.id === p.characterId);
    const color = char?.color || 'var(--color-primary)';
    const initial = (p.username || '?').charAt(0).toUpperCase();
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="player-main">
        <span class="player-avatar" style="background:${color}">${escapeHtml(initial)}</span>
        <div class="player-info-text">
          <span class="player-name" style="color:${color}">${escapeHtml(p.username)}</span>
          <span class="player-char">${escapeHtml(char?.name || p.characterId)}</span>
        </div>
      </div>
      <span class="player-badges">
        ${p.isAI ? '<span class="badge bot">AI</span>' : ''}
        ${p.isHost ? '<span class="badge host">房主</span>' : ''}
        <span class="player-ready ${p.isReady ? 'ready' : ''}">${p.isReady ? '✓ 已准备' : '未准备'}</span>
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
  const addHeuristicBtn = container.querySelector<HTMLButtonElement>('#btn-add-heuristic');
  const addLLMBtn = container.querySelector<HTMLButtonElement>('#btn-add-llm');
  if (isHost) {
    startBtn.style.display = 'inline-block';
    const allReady = room.players.every((p) => p.isReady || p.isHost);
    startBtn.disabled = !allReady || room.players.length < 2;
    if (addHeuristicBtn) addHeuristicBtn.style.display = 'inline-block';
    if (addLLMBtn) addLLMBtn.style.display = 'inline-block';
  } else {
    startBtn.style.display = 'none';
    if (addHeuristicBtn) addHeuristicBtn.style.display = 'none';
    if (addLLMBtn) addLLMBtn.style.display = 'none';
  }
}

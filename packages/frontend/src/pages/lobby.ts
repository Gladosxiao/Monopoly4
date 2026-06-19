import { getCurrentUser, clearCurrentUser } from '../state/user.js';
import { logout, listRooms, listMaps, createRoom } from '../api.js';
import { disconnectSocket } from '../socket.js';
import { navigateToRoom, navigateToLogin, navigateToLobby } from '../router.js';
import { escapeHtml } from '../ui/common.js';

const app = document.getElementById('app')!;

export async function renderLobbyPage(error?: string): Promise<void> {
  const user = getCurrentUser();
  if (!user) {
    await navigateToLogin();
    return;
  }

  const container = document.createElement('div');
  container.className = 'page lobby-page';
  container.innerHTML = `
    <header>
      <h1>大富翁4 Web</h1>
      <div class="user-info">
        <span>${user.username}</span>
        <button id="btn-logout">退出</button>
      </div>
    </header>
    ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
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
    clearCurrentUser();
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

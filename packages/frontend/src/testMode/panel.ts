/**
 * 测试控制面板 UI
 *
 * 作为侧边浮动面板注入游戏页面，包含：
 * A. 玩家数据修改区
 * B. 游戏全局数据修改区
 * C. 地块修改区
 * D. 免费商店区
 * E. AI 玩家控制区
 * F. 快捷操作区
 */

import type { GameState } from '@monopoly4/shared';
import {
  CARD_DEFINITIONS,
  ITEM_DEFINITIONS,
  SPIRIT_DEFINITIONS,
} from '@monopoly4/shared';

// ==================== 样式常量 ====================

const PANEL_BG = '#16213e';
const PANEL_WIDTH = 320;
const SECTION_BG = '#0f3460';
const INPUT_BG = '#1a1a3e';
const BORDER_COLOR = '#333';
const ACCENT_COLOR = '#e94560';
const TEXT_COLOR = '#eee';
const LABEL_COLOR = '#aaa';
const HEADER_BG = '#0a0e27';

/** 当前面板 DOM 元素引用（用于 destroy） */
let activePanel: HTMLDivElement | null = null;

// ==================== 辅助函数 ====================

/** 创建一行 label + input 的表单组 */
function createFormGroup(
  label: string,
  inputBuilder: () => HTMLElement
): HTMLDivElement {
  const row = document.createElement('div');
  row.style.cssText = `
    display: flex; align-items: center; gap: 6px;
    margin-bottom: 6px; font-size: 12px;
  `;
  const lbl = document.createElement('label');
  lbl.textContent = label;
  lbl.style.cssText = `min-width: 60px; color: ${LABEL_COLOR}; white-space: nowrap;`;
  row.appendChild(lbl);
  row.appendChild(inputBuilder());
  return row;
}

/** 创建数值输入框 */
function createNumberInput(
  placeholder: string,
  min?: number,
  max?: number
): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'number';
  input.placeholder = placeholder;
  if (min !== undefined) input.min = String(min);
  if (max !== undefined) input.max = String(max);
  input.style.cssText = `
    flex: 1; padding: 4px 6px; font-size: 12px;
    background: ${INPUT_BG}; color: ${TEXT_COLOR};
    border: 1px solid ${BORDER_COLOR}; border-radius: 4px;
    width: 100%; min-width: 0;
  `;
  return input;
}

/** 创建下拉选择框 */
function createSelect(
  options: Array<{ value: string; label: string }>
): HTMLSelectElement {
  const sel = document.createElement('select');
  sel.style.cssText = `
    flex: 1; padding: 4px 6px; font-size: 12px;
    background: ${INPUT_BG}; color: ${TEXT_COLOR};
    border: 1px solid ${BORDER_COLOR}; border-radius: 4px;
    width: 100%; min-width: 0;
  `;
  options.forEach((opt) => {
    const o = document.createElement('option');
    o.value = opt.value;
    o.textContent = opt.label;
    sel.appendChild(o);
  });
  return sel;
}

/** 创建紧凑按钮 */
function createButton(
  text: string,
  onClick: () => void,
  small = true
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.textContent = text;
  btn.addEventListener('click', onClick);
  btn.style.cssText = small
    ? `
      padding: 4px 10px; font-size: 12px; border-radius: 4px;
      background: ${ACCENT_COLOR}; color: #fff; border: none;
      cursor: pointer; white-space: nowrap;
    `
    : `
      padding: 6px 14px; font-size: 13px; border-radius: 4px;
      background: ${ACCENT_COLOR}; color: #fff; border: none;
      cursor: pointer; white-space: nowrap;
    `;
  btn.addEventListener('mouseenter', () => (btn.style.opacity = '0.85'));
  btn.addEventListener('mouseleave', () => (btn.style.opacity = '1'));
  return btn;
}

/** 创建分隔标题 */
function createSectionTitle(text: string): HTMLDivElement {
  const h = document.createElement('div');
  h.textContent = text;
  h.style.cssText = `
    font-size: 13px; font-weight: bold; color: ${ACCENT_COLOR};
    padding: 8px 0 4px 0; margin-top: 8px;
    border-top: 1px solid ${BORDER_COLOR};
  `;
  return h;
}

// ==================== 面板主函数 ====================

/**
 * 创建测试控制面板 DOM 元素
 *
 * @param emitFn 发送 Socket 事件的函数（(event: string, ...args: any[]) => void）
 * @param getCurrentState 获取当前游戏状态快照的函数
 * @returns 测试面板 DOM 元素
 */
export function createTestPanel(
  emitFn: (event: string, ...args: unknown[]) => void,
  getCurrentState: () => GameState | null
): HTMLDivElement {
  // 先销毁已有面板
  destroyTestPanel();

  // --- 面板根容器 ---
  const panel = document.createElement('div');
  panel.id = 'test-mode-panel';
  panel.style.cssText = `
    position: fixed; top: 0; right: 0; height: 100vh;
    width: ${PANEL_WIDTH}px; z-index: 10000;
    background: ${PANEL_BG}; color: ${TEXT_COLOR};
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif;
    font-size: 13px;
    display: flex; flex-direction: column;
    box-shadow: -4px 0 16px rgba(0, 0, 0, 0.5);
    transition: transform 0.3s ease;
  `;
  activePanel = panel;

  // --- 标题栏（可折叠） ---
  let collapsed = false;
  const header = document.createElement('div');
  header.style.cssText = `
    display: flex; justify-content: space-between; align-items: center;
    padding: 8px 12px; background: ${HEADER_BG}; cursor: pointer;
    user-select: none; flex-shrink: 0;
  `;
  const titleText = document.createElement('span');
  titleText.textContent = '🧪 测试模式';
  titleText.style.cssText = `font-weight: bold; font-size: 14px;`;
  header.appendChild(titleText);

  const collapseBtn = document.createElement('span');
  collapseBtn.textContent = '◀';
  collapseBtn.style.cssText = `font-size: 16px; transition: transform 0.3s;`;
  header.appendChild(collapseBtn);

  header.addEventListener('click', () => {
    collapsed = !collapsed;
    content.style.display = collapsed ? 'none' : '';
    collapseBtn.textContent = collapsed ? '▶' : '◀';
    panel.style.width = collapsed ? '40px' : `${PANEL_WIDTH}px`;
  });

  panel.appendChild(header);

  // --- 可滚动内容区 ---
  const content = document.createElement('div');
  content.style.cssText = `
    flex: 1; overflow-y: auto; padding: 8px 12px;
    scrollbar-width: thin; scrollbar-color: #444 transparent;
  `;
  panel.appendChild(content);

  // ==================== A. 玩家数据修改区 ====================
  content.appendChild(createSectionTitle('A. 玩家数据修改'));

  // 玩家选择下拉
  const playerSelectRow = document.createElement('div');
  playerSelectRow.style.cssText = `margin-bottom: 6px;`;
  const playerSelectLabel = document.createElement('label');
  playerSelectLabel.textContent = '选择玩家：';
  playerSelectLabel.style.cssText = `color: ${LABEL_COLOR}; font-size: 12px;`;
  playerSelectRow.appendChild(playerSelectLabel);
  const playerSelect = createSelect([]);
  playerSelectRow.appendChild(playerSelect);
  content.appendChild(playerSelectRow);

  // 财务输入
  const cashInput = createNumberInput('现金');
  const depositInput = createNumberInput('存款');
  const loanInput = createNumberInput('贷款');
  const couponInput = createNumberInput('点券', 0);

  content.appendChild(createFormGroup('现金', () => cashInput));
  content.appendChild(createFormGroup('存款', () => depositInput));
  content.appendChild(createFormGroup('贷款', () => loanInput));
  content.appendChild(createFormGroup('点券', () => couponInput));

  // 位置
  const posInput = createNumberInput('0-39', 0, 39);
  content.appendChild(createFormGroup('位置', () => posInput));

  // 载具
  const vehicleSelect = createSelect([
    { value: 'walk', label: '步行' },
    { value: 'bike', label: '机车' },
    { value: 'car', label: '汽车' },
  ]);
  content.appendChild(createFormGroup('载具', () => vehicleSelect));

  // 神明
  const spiritOptions = [
    { value: '', label: '无' },
    ...Object.values(SPIRIT_DEFINITIONS).map((s) => ({
      value: s.id,
      label: s.name,
    })),
  ];
  const spiritSelect = createSelect(spiritOptions);
  content.appendChild(createFormGroup('神明', () => spiritSelect));

  // 状态效果清除按钮
  const clearEffectsBtn = createButton('清除所有状态效果', () => {
    const pid = playerSelect.value;
    if (!pid) return;
    emitFn('test:clearEffects', pid);
  });
  content.appendChild(clearEffectsBtn);

  // 应用玩家修改
  const applyPlayerBtn = createButton('应用玩家修改', () => {
    const pid = playerSelect.value;
    if (!pid) return;
    const state = getCurrentState();
    const roomId = state?.roomId;
    if (!roomId) return;
    if (cashInput.value) emitFn('test:setCash', roomId, pid, Number(cashInput.value));
    if (depositInput.value) emitFn('test:setDeposit', roomId, pid, Number(depositInput.value));
    if (loanInput.value) emitFn('test:setLoan', roomId, pid, Number(loanInput.value));
    if (couponInput.value) emitFn('test:setCoupons', roomId, pid, Number(couponInput.value));
    if (posInput.value) emitFn('test:setPosition', roomId, pid, Number(posInput.value));
    if (vehicleSelect.value) emitFn('test:setVehicle', roomId, pid, vehicleSelect.value);
    if (spiritSelect.value !== '') emitFn('test:setSpirit', roomId, pid, spiritSelect.value);
  }, false);
  applyPlayerBtn.style.cssText += `margin-top: 6px; width: 100%;`;
  content.appendChild(applyPlayerBtn);

  // ==================== B. 游戏全局数据修改区 ====================
  content.appendChild(createSectionTitle('B. 全局数据修改'));

  const priceIndexInput = createNumberInput('1-6', 1, 6);
  const dayInput = createNumberInput('天数', 1);
  const monthInput = createNumberInput('月份', 1);

  content.appendChild(createFormGroup('物价指数', () => priceIndexInput));
  content.appendChild(createFormGroup('当前天数', () => dayInput));
  content.appendChild(createFormGroup('当前月份', () => monthInput));

  const applyGlobalBtn = createButton('应用全局修改', () => {
    const roomId = getCurrentState()?.roomId;
    if (!roomId) return;
    if (priceIndexInput.value)
      emitFn('test:setPriceIndex', roomId, Number(priceIndexInput.value));
    if (dayInput.value)
      emitFn('test:setDay', roomId, Number(dayInput.value));
    if (monthInput.value)
      emitFn('test:setMonth', roomId, Number(monthInput.value));
  }, false);
  applyGlobalBtn.style.cssText += `margin-top: 6px; width: 100%;`;
  content.appendChild(applyGlobalBtn);

  // ==================== C. 地块修改区 ====================
  content.appendChild(createSectionTitle('C. 地块修改'));

  const tileSelect = createSelect(
    Array.from({ length: 40 }, (_, i) => ({
      value: String(i),
      label: `#${i}`,
    }))
  );
  content.appendChild(createFormGroup('地块', () => tileSelect));

  const tileLevelInput = createNumberInput('0-5', 0, 5);
  content.appendChild(createFormGroup('等级', () => tileLevelInput));

  // 地块所有者下拉
  const tileOwnerSelect = createSelect([{ value: '', label: '无' }]);
  content.appendChild(createFormGroup('所有者', () => tileOwnerSelect));

  const applyTileBtn = createButton('应用地块修改', () => {
    const roomId = getCurrentState()?.roomId;
    if (!roomId) return;
    const tileIdx = Number(tileSelect.value);
    if (tileLevelInput.value)
      emitFn('test:setTileLevel', roomId, tileIdx, Number(tileLevelInput.value));
    // 所有者为 '' 时传 null 表示清除
    emitFn('test:setTileOwner', roomId, tileIdx, tileOwnerSelect.value || null);
  }, false);
  applyTileBtn.style.cssText += `margin-top: 6px; width: 100%;`;
  content.appendChild(applyTileBtn);

  // ==================== D. 免费商店区 ====================
  content.appendChild(createSectionTitle('D. 免费商店'));

  const freeShopBtn = createButton('打开免费商店', () => {
    openFreeShopModal(emitFn, getCurrentState);
  });
  freeShopBtn.style.cssText += `width: 100%;`;
  content.appendChild(freeShopBtn);

  // ==================== E. AI 玩家控制区 ====================
  content.appendChild(createSectionTitle('E. AI 玩家控制'));

  const aiIntervalInput = createNumberInput('ms', 500, 30000);
  aiIntervalInput.value = '2000';
  content.appendChild(createFormGroup('间隔(ms)', () => aiIntervalInput));

  const aiStatusEl = document.createElement('div');
  aiStatusEl.style.cssText = `font-size: 11px; color: ${LABEL_COLOR}; margin: 4px 0;`;
  aiStatusEl.textContent = 'AI 状态：已停止';
  content.appendChild(aiStatusEl);

  let aiTimer: ReturnType<typeof setInterval> | null = null;

  /** 停止 AI 自动行动 */
  function stopAI(): void {
    if (aiTimer !== null) {
      clearInterval(aiTimer);
      aiTimer = null;
    }
    const roomId = getCurrentState()?.roomId;
    if (roomId) emitFn('test:aiStop', roomId);
    aiStatusEl.textContent = 'AI 状态：已停止';
    aiStatusEl.style.color = LABEL_COLOR;
    aiStartBtn.disabled = false;
    aiStopBtn.disabled = true;
  }

  const aiStartBtn = createButton('启动 AI', () => {
    if (aiTimer !== null) return;
    const interval = Number(aiIntervalInput.value) || 2000;
    aiTimer = setInterval(() => {
      const roomId = getCurrentState()?.roomId;
      if (!roomId || getCurrentState()?.status === 'ended') {
        stopAI();
        return;
      }
      emitFn('test:aiStep', roomId);
    }, interval);
    aiStatusEl.textContent = `AI 状态：运行中 (${interval}ms)`;
    aiStatusEl.style.color = '#2ecc71';
    aiStartBtn.disabled = true;
    aiStopBtn.disabled = false;
  });
  content.appendChild(aiStartBtn);

  const aiStopBtn = createButton('停止 AI', () => {
    stopAI();
  });
  aiStopBtn.disabled = true;
  content.appendChild(aiStopBtn);

  const aiStepBtn = createButton('AI 单步', () => {
    const roomId = getCurrentState()?.roomId;
    if (!roomId) return;
    emitFn('test:aiStep', roomId);
  });
  content.appendChild(aiStepBtn);

  // ==================== F. 快捷操作区 ====================
  content.appendChild(createSectionTitle('F. 快捷操作'));

  const quickBtns: Array<[string, () => void]> = [
    ['强制结束回合', () => {
      const roomId = getCurrentState()?.roomId;
      if (roomId) emitFn('test:forceEndTurn', roomId);
    }],
    ['+999999 现金', () => {
      const state = getCurrentState();
      if (!state) return;
      const pid = state.players[state.currentPlayerIndex]?.id;
      if (pid) emitFn('test:setCash', state.roomId, pid, 999999);
    }],
    ['+9999 点券', () => {
      const state = getCurrentState();
      if (!state) return;
      const pid = state.players[state.currentPlayerIndex]?.id;
      if (pid) emitFn('test:setCoupons', state.roomId, pid, 9999);
    }],
    ['给所有卡片', () => {
      const state = getCurrentState();
      if (!state) return;
      const pid = state.players[state.currentPlayerIndex]?.id;
      if (pid) {
        Object.keys(CARD_DEFINITIONS).forEach((cardId) => {
          emitFn('test:freeBuyCard', state.roomId, pid, cardId);
        });
      }
    }],
    ['给所有道具', () => {
      const state = getCurrentState();
      if (!state) return;
      const pid = state.players[state.currentPlayerIndex]?.id;
      if (pid) {
        Object.keys(ITEM_DEFINITIONS).forEach((itemId) => {
          emitFn('test:freeBuyItem', state.roomId, pid, itemId, 9);
        });
      }
    }],
    ['重置所有玩家', () => {
      const roomId = getCurrentState()?.roomId;
      if (roomId) emitFn('test:resetAll', roomId);
    }],
  ];

  const quickBtnContainer = document.createElement('div');
  quickBtnContainer.style.cssText = `display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px;`;
  quickBtns.forEach(([label, handler]) => {
    const btn = createButton(label, handler);
    btn.style.cssText += `flex: 1 1 calc(50% - 3px); box-sizing: border-box;`;
    quickBtnContainer.appendChild(btn);
  });
  content.appendChild(quickBtnContainer);

  // ==================== 数据刷新逻辑 ====================

  /**
   * 刷新面板中的玩家列表和地块所有者下拉框
   * 在每次游戏状态更新时调用
   */
  function refreshWithState(state: GameState | null): void {
    if (!state) return;

    // 刷新玩家下拉
    const prevPlayer = playerSelect.value;
    playerSelect.innerHTML = '';
    state.players.forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p.id;
      const aiPrefix = p.isAI ? '[AI] ' : '';
      opt.textContent = `${aiPrefix}${p.username} (${p.id.slice(0, 6)})`;
      playerSelect.appendChild(opt);
    });
    if (prevPlayer && state.players.some((p) => p.id === prevPlayer)) {
      playerSelect.value = prevPlayer;
    }

    // 刷新地块所有者下拉
    const prevOwner = tileOwnerSelect.value;
    tileOwnerSelect.innerHTML = '';
    const noneOpt = document.createElement('option');
    noneOpt.value = '';
    noneOpt.textContent = '无';
    tileOwnerSelect.appendChild(noneOpt);
    state.players.forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p.id;
      const aiPrefix = p.isAI ? '[AI] ' : '';
      opt.textContent = `${aiPrefix}${p.username}`;
      tileOwnerSelect.appendChild(opt);
    });
    if (prevOwner && (prevOwner === '' || state.players.some((p) => p.id === prevOwner))) {
      tileOwnerSelect.value = prevOwner;
    }

    // 刷新地块选择范围（与地图一致）
    const tileCount = state.map.tiles.length;
    if (tileSelect.options.length !== tileCount) {
      tileSelect.innerHTML = '';
      for (let i = 0; i < tileCount; i++) {
        const opt = document.createElement('option');
        opt.value = String(i);
        const tile = state.map.tiles[i];
        opt.textContent = `#${i} ${tile?.name ?? ''}`;
        tileSelect.appendChild(opt);
      }
    }
  }

  // 暴露刷新方法到 DOM 元素上，供外部（index.ts）调用
  (panel as HTMLDivElement & { _refreshState: (s: GameState) => void })._refreshState = refreshWithState;

  // 初始填充：如果已有游戏状态，立即填充玩家和地块下拉框
  refreshWithState(getCurrentState());

  return panel;
}

/**
 * 销毁当前活动的测试面板，移除 DOM 并清理引用
 */
export function destroyTestPanel(): void {
  if (activePanel) {
    activePanel.remove();
    activePanel = null;
  }
}

// ==================== 免费商店弹窗 ====================

/** 打开免费商店弹窗 */
function openFreeShopModal(
  emitFn: (event: string, ...args: unknown[]) => void,
  getCurrentState: () => GameState | null
): void {
  // 如果已存在则忽略
  if (document.getElementById('test-free-shop-modal')) return;

  const state = getCurrentState();
  const roomId = state?.roomId;
  const playerId = state ? state.players[state.currentPlayerIndex]?.id : undefined;

  // 遮罩层
  const overlay = document.createElement('div');
  overlay.id = 'test-free-shop-modal';
  overlay.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
    background: rgba(0,0,0,0.6); z-index: 20000;
    display: flex; align-items: center; justify-content: center;
  `;

  // 弹窗容器
  const modal = document.createElement('div');
  modal.style.cssText = `
    background: ${PANEL_BG}; color: ${TEXT_COLOR};
    border-radius: 12px; padding: 16px; width: 560px; max-height: 80vh;
    overflow-y: auto; box-shadow: 0 8px 32px rgba(0,0,0,0.5);
  `;

  // 标题
  const modalHeader = document.createElement('div');
  modalHeader.style.cssText = `
    display: flex; justify-content: space-between; align-items: center;
    margin-bottom: 12px;
  `;
  const h2 = document.createElement('h3');
  h2.textContent = '🎁 免费商店';
  h2.style.cssText = `margin: 0; font-size: 16px;`;
  modalHeader.appendChild(h2);

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.style.cssText = `
    background: none; border: none; color: ${TEXT_COLOR};
    font-size: 20px; cursor: pointer; padding: 4px 8px;
  `;
  closeBtn.addEventListener('click', () => overlay.remove());
  modalHeader.appendChild(closeBtn);
  modal.appendChild(modalHeader);

  // Tab 切换
  const tabContainer = document.createElement('div');
  tabContainer.style.cssText = `display: flex; gap: 8px; margin-bottom: 12px;`;
  const tabCards = document.createElement('button');
  tabCards.textContent = '卡片';
  tabCards.style.cssText = `
    padding: 6px 16px; border-radius: 6px; border: none;
    background: ${ACCENT_COLOR}; color: #fff; cursor: pointer; font-size: 13px;
  `;
  const tabItems = document.createElement('button');
  tabItems.textContent = '道具';
  tabItems.style.cssText = `
    padding: 6px 16px; border-radius: 6px; border: none;
    background: #333; color: #aaa; cursor: pointer; font-size: 13px;
  `;
  tabContainer.appendChild(tabCards);
  tabContainer.appendChild(tabItems);
  modal.appendChild(tabContainer);

  // 内容区
  const cardsPanel = document.createElement('div');
  const itemsPanel = document.createElement('div');
  itemsPanel.style.display = 'none';
  modal.appendChild(cardsPanel);
  modal.appendChild(itemsPanel);

  function switchTab(showCards: boolean): void {
    cardsPanel.style.display = showCards ? '' : 'none';
    itemsPanel.style.display = showCards ? 'none' : '';
    tabCards.style.background = showCards ? ACCENT_COLOR : '#333';
    tabCards.style.color = showCards ? '#fff' : '#aaa';
    tabItems.style.background = showCards ? '#333' : ACCENT_COLOR;
    tabItems.style.color = showCards ? '#aaa' : '#fff';
  }

  tabCards.addEventListener('click', () => switchTab(true));
  tabItems.addEventListener('click', () => switchTab(false));

  // --- 卡片列表 ---
  Object.values(CARD_DEFINITIONS).forEach((card) => {
    const row = document.createElement('div');
    row.style.cssText = `
      display: flex; align-items: center; justify-content: space-between;
      padding: 8px; margin-bottom: 4px;
      background: ${SECTION_BG}; border-radius: 6px;
    `;
    const info = document.createElement('div');
    info.style.cssText = `flex: 1; margin-right: 8px;`;
    info.innerHTML = `
      <div style="font-size: 13px; font-weight: bold;">${card.name}</div>
      <div style="font-size: 11px; color: ${LABEL_COLOR};">${card.description}</div>
    `;
    row.appendChild(info);

    const getBtn = createButton('获取', () => {
      if (!roomId || !playerId) return;
      emitFn('test:freeBuyCard', roomId, playerId, card.id);
      getBtn.textContent = '✓';
      getBtn.style.background = '#2ecc71';
      setTimeout(() => {
        getBtn.textContent = '获取';
        getBtn.style.background = ACCENT_COLOR;
      }, 800);
    });
    row.appendChild(getBtn);
    cardsPanel.appendChild(row);
  });

  // --- 道具列表 ---
  Object.values(ITEM_DEFINITIONS).forEach((item) => {
    const row = document.createElement('div');
    row.style.cssText = `
      display: flex; align-items: center; justify-content: space-between;
      padding: 8px; margin-bottom: 4px;
      background: ${SECTION_BG}; border-radius: 6px;
    `;
    const info = document.createElement('div');
    info.style.cssText = `flex: 1; margin-right: 8px;`;
    info.innerHTML = `
      <div style="font-size: 13px; font-weight: bold;">${item.name}</div>
      <div style="font-size: 11px; color: ${LABEL_COLOR};">${item.description}</div>
    `;
    row.appendChild(info);

    const qtyInput = createNumberInput('数量', 1, item.maxStack);
    qtyInput.value = '1';
    qtyInput.style.cssText += 'width: 50px; margin-right: 6px;';
    row.appendChild(qtyInput);

    const getBtn = createButton('获取', () => {
      if (!roomId || !playerId) return;
      const qty = Number(qtyInput.value) || 1;
      emitFn('test:freeBuyItem', roomId, playerId, item.id, qty);
      getBtn.textContent = '✓';
      getBtn.style.background = '#2ecc71';
      setTimeout(() => {
        getBtn.textContent = '获取';
        getBtn.style.background = ACCENT_COLOR;
      }, 800);
    });
    row.appendChild(getBtn);
    itemsPanel.appendChild(row);
  });

  // 点击遮罩关闭
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

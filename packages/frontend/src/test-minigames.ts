/**
 * 小游戏独立测试页入口脚本
 * --------------------------------
 * - 绑定 3 个"开始游戏"按钮
 * - 调用 launchMiniGame(type, { onEnd }) 启动对应小游戏
 * - 游戏结束后更新"最近一次成绩"与历史记录列表
 * - 历史记录使用 localStorage 持久化（最近 5 条）
 */

import { launchMiniGame } from './minigames/index.js';
import type { MiniGameType, MiniGameResult } from '@monopoly4/shared';

/** 单条历史记录 */
interface HistoryEntry {
  type: MiniGameType;
  result: MiniGameResult;
  endedAt: number;
}

/** 小游戏显示元数据 */
const GAME_META: Record<MiniGameType, { name: string; emoji: string }> = {
  balloon: { name: '七彩气球', emoji: '🎈' },
  luckyDrop: { name: '喜从天降', emoji: '🎁' },
  penguinDig: { name: '企鹅挖宝', emoji: '🐧' },
};

const HISTORY_KEY = 'monopoly4-minigame-test-history';
const MAX_HISTORY = 5;

let history: HistoryEntry[] = loadHistory();
let activeGame: MiniGameType | null = null;

/* ---------- 工具函数 ---------- */

function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (e): e is HistoryEntry =>
          !!e &&
          typeof e === 'object' &&
          typeof (e as HistoryEntry).type === 'string' &&
          typeof (e as HistoryEntry).endedAt === 'number' &&
          !!(e as HistoryEntry).result
      )
      .slice(0, MAX_HISTORY);
  } catch {
    return [];
  }
}

function saveHistory(): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {
    /* 忽略存储失败（隐私模式 / 容量不足） */
  }
}

function formatClock(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/* ---------- 渲染 ---------- */

function renderLatest(entry: HistoryEntry | null): void {
  const wrap = document.getElementById('latest-result');
  const iconEl = document.getElementById('latest-icon');
  const nameEl = document.getElementById('latest-name');
  const timeEl = document.getElementById('latest-time');
  const scoreEl = document.getElementById('latest-score');
  const couponEl = document.getElementById('latest-coupons');
  if (!wrap || !iconEl || !nameEl || !timeEl || !scoreEl || !couponEl) return;

  if (!entry) {
    wrap.hidden = true;
    return;
  }

  const meta = GAME_META[entry.type];
  wrap.hidden = false;
  wrap.dataset.game = entry.type;
  iconEl.textContent = meta.emoji;
  nameEl.textContent = meta.name;
  timeEl.textContent = `${formatClock(entry.endedAt)} · 用时 ${formatDuration(entry.result.duration)}`;
  scoreEl.textContent = String(entry.result.score);
  couponEl.textContent = String(entry.result.coupons);
}

function renderHistoryTable(): void {
  const tbody = document.getElementById('history-body');
  if (!tbody) return;

  if (history.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="5" class="empty-state">还没有记录，开始一局看看吧！</td></tr>';
    return;
  }

  tbody.innerHTML = history
    .map((entry) => {
      const meta = GAME_META[entry.type];
      return `
        <tr>
          <td><span class="game-tag" data-game="${entry.type}">${meta.emoji} ${meta.name}</span></td>
          <td class="score-cell">${entry.result.score}</td>
          <td class="coupon-cell">${entry.result.coupons}</td>
          <td>${formatDuration(entry.result.duration)}</td>
          <td>${formatClock(entry.endedAt)}</td>
        </tr>
      `;
    })
    .join('');
}

function renderStats(): void {
  const countEl = document.getElementById('stat-count');
  const couponsEl = document.getElementById('stat-coupons');
  const bestEl = document.getElementById('stat-best');
  if (!countEl || !couponsEl || !bestEl) return;

  countEl.textContent = String(history.length);
  const totalCoupons = history.reduce((sum, e) => sum + e.result.coupons, 0);
  couponsEl.textContent = String(totalCoupons);
  const best = history.reduce((max, e) => Math.max(max, e.result.score), 0);
  bestEl.textContent = best > 0 ? String(best) : '—';
}

function renderAll(): void {
  renderLatest(history[0] ?? null);
  renderHistoryTable();
  renderStats();
}

/* ---------- 交互 ---------- */

function setButtonsDisabled(disabled: boolean): void {
  document.querySelectorAll<HTMLButtonElement>('.start-btn').forEach((btn) => {
    if (disabled) {
      if (!btn.dataset.originalLabel) {
        btn.dataset.originalLabel = btn.textContent || '';
      }
      btn.disabled = true;
      btn.textContent = '游戏中…';
    } else {
      btn.disabled = false;
      if (btn.dataset.originalLabel) {
        btn.textContent = btn.dataset.originalLabel;
        delete btn.dataset.originalLabel;
      }
    }
  });
}

function handleEnd(type: MiniGameType, result: MiniGameResult): void {
  const entry: HistoryEntry = { type, result, endedAt: Date.now() };
  history.unshift(entry);
  if (history.length > MAX_HISTORY) {
    history = history.slice(0, MAX_HISTORY);
  }
  saveHistory();
  renderAll();
  activeGame = null;
  setButtonsDisabled(false);
}

function startGame(type: MiniGameType): void {
  if (activeGame) return;
  activeGame = type;
  setButtonsDisabled(true);

  const stopFn = launchMiniGame(type, {
    onEnd: (result) => handleEnd(type, result),
  });

  // 暴露停止函数到 window，便于 Playwright/Puppeteer 自动化测试时提前结束
  // （小游戏本身无外部 API，只能通过返回的 stopFn 主动结束）
  (window as unknown as { __stopMiniGame?: () => unknown }).__stopMiniGame = stopFn;
}

function bindButtons(): void {
  document.querySelectorAll<HTMLButtonElement>('.start-btn').forEach((btn) => {
    const type = btn.dataset.start as MiniGameType | undefined;
    if (!type || !(type in GAME_META)) return;
    btn.addEventListener('click', () => startGame(type));
  });
}

/* ---------- 启动 ---------- */

bindButtons();
renderAll();

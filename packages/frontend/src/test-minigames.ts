/**
 * 小游戏独立测试页入口脚本
 * --------------------------------
 * - 绑定 3 个"开始游戏"按钮
 * - 调用 launchMiniGame(type, { onEnd }) 启动对应小游戏
 * - 游戏结束后更新"最近一次成绩"与历史记录列表
 * - 历史记录使用 localStorage 持久化（最近 5 条）
 */

import { launchMiniGame, calibratePenguinDig } from './minigames/index.js';
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

function formatPct(value: number | undefined): string {
  if (value === undefined) return '—';
  return `${(value * 100).toFixed(0)}%`;
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

  const calibBtn = document.getElementById('calibration-btn');
  calibBtn?.addEventListener('click', () => startCalibrationFlow());
}

/* ---------- 标定测试流程 ---------- */

interface CalibrationStep {
  type: MiniGameType;
  result: MiniGameResult;
  clicks: number;
}

let calibrationState: {
  steps: CalibrationStep[];
  inProgress: boolean;
} = { steps: [], inProgress: false };

function startCalibrationFlow(): void {
  if (calibrationState.inProgress || activeGame) return;
  calibrationState = { steps: [], inProgress: true };
  setButtonsDisabled(true);

  const reportEl = document.getElementById('calibration-report');
  if (reportEl) {
    reportEl.style.display = 'block';
    reportEl.innerHTML = '<p>🧪 标定流程开始，请先玩 <strong>七彩气球</strong>…</p>';
  }

  runCalibrationStep('balloon', 0);
}

function runCalibrationStep(
  type: MiniGameType,
  stepIndex: number,
  calibration?: { cooldownMs: number; scoreMultiplier: number }
): void {
  activeGame = type;

  const estimatedClicks: Record<MiniGameType, number> = {
    balloon: 60,
    luckyDrop: 40,
    penguinDig: 60,
  };

  const stopFn = launchMiniGame(type, {
    onEnd: (result) => {
      calibrationState.steps.push({ type, result, clicks: result.metrics?.clickCount ?? estimatedClicks[type] });
      handleEnd(type, result);

      if (stepIndex === 0) {
        updateCalibrationReport('step1', undefined, result);
        setTimeout(() => runCalibrationStep('luckyDrop', 1), 800);
      } else if (stepIndex === 1) {
        updateCalibrationReport('step2', undefined, result);
        const baseline = {
          balloonAvgCoupons: calibrationState.steps[0].result.coupons,
          luckyDropAvgCoupons: calibrationState.steps[1].result.coupons,
          balloonAvgClicks: calibrationState.steps[0].result.metrics?.clickCount ?? estimatedClicks.balloon,
          luckyDropAvgClicks: calibrationState.steps[1].result.metrics?.clickCount ?? estimatedClicks.luckyDrop,
          durationMs: 30000,
          balloonMetrics: calibrationState.steps[0].result.metrics,
          luckyDropMetrics: calibrationState.steps[1].result.metrics,
        };
        const cal = calibratePenguinDig(baseline);
        updateCalibrationReport('calibrated', cal, result);
        setTimeout(
          () =>
            runCalibrationStep('penguinDig', 2, {
              cooldownMs: cal.recommendedCooldownMs,
              scoreMultiplier: cal.recommendedScoreMultiplier,
            }),
          1200
        );
      } else {
        updateCalibrationReport('done', undefined, result);
        calibrationState.inProgress = false;
        setButtonsDisabled(false);
      }
    },
    calibration,
  });

  (window as unknown as { __stopMiniGame?: () => unknown }).__stopMiniGame = stopFn;
}

function updateCalibrationReport(
  phase: 'step1' | 'step2' | 'calibrated' | 'done',
  calibration?: {
    baselineCoupons: number;
    recommendedCooldownMs: number;
    recommendedScoreMultiplier: number;
    projectedRandomCoupons: number;
    projectedClicks: number;
    usedMetrics: { avgTimeBetweenClicks: number; balloonAccuracy: number; luckyDropCatchRate: number };
  },
  latestResult?: MiniGameResult
): void {
  const reportEl = document.getElementById('calibration-report');
  if (!reportEl) return;

  switch (phase) {
    case 'step1': {
      const m = latestResult?.metrics;
      reportEl.innerHTML = `
        <p>✅ 七彩气球完成，接下来玩 <strong>喜从天降</strong>…</p>
        ${m ? `
          <div style="margin-top:10px;font-size:13px;color:#94a3b8;">
            点击 ${m.clickCount} 次 / 命中 ${m.hitCount} 次 / 命中率 ${formatPct(m.accuracy)} /
            平均鼠标速度 ${m.avgMouseSpeed?.toFixed(2)} px/ms / 平均点击间隔 ${m.avgTimeBetweenClicks?.toFixed(0)}ms
          </div>
        ` : ''}
      `;
      break;
    }
    case 'step2': {
      const m = latestResult?.metrics;
      reportEl.innerHTML = `
        <p>✅ 喜从天降完成，正在计算企鹅挖宝标定参数…</p>
        ${m ? `
          <div style="margin-top:10px;font-size:13px;color:#94a3b8;">
            接住 ${m.hitCount} 个 / 生成 ${m.clickCount} 个 / 接取率 ${formatPct(m.catchRate)} /
            平台速度 ${m.avgPlatformSpeed?.toFixed(2)} px/ms / 方向改变 ${m.directionChangesPerSec?.toFixed(1)} 次/秒
          </div>
        ` : ''}
      `;
      break;
    }
    case 'calibrated':
      if (calibration) {
        reportEl.innerHTML = `
          <p>📊 用户基准点券：<strong>${calibration.baselineCoupons}</strong></p>
          <p>🐭 参考指标：气球点击间隔 ${calibration.usedMetrics.avgTimeBetweenClicks}ms，命中率 ${formatPct(calibration.usedMetrics.balloonAccuracy)}，喜从天降接取率 ${formatPct(calibration.usedMetrics.luckyDropCatchRate)}</p>
          <p>🐧 推荐企鹅挖宝冷却：<strong>${calibration.recommendedCooldownMs}ms</strong>（预计可点击 ${calibration.projectedClicks} 次）</p>
          <p>🐧 推荐宝藏分值倍率：<strong>×${calibration.recommendedScoreMultiplier}</strong></p>
          <p>🎯 标定后随机玩家期望：<strong>${calibration.projectedRandomCoupons}</strong> 点券</p>
          <p>请继续玩 <strong>企鹅挖宝</strong> 验证效果…</p>
        `;
      }
      break;
    case 'done': {
      const penguinResult = calibrationState.steps.find((s) => s.type === 'penguinDig')?.result;
      const m = penguinResult?.metrics;
      reportEl.innerHTML = `
        <p>✅ 标定测试完成！</p>
        ${penguinResult ? `<p>🐧 企鹅挖宝获得点券：<strong>${penguinResult.coupons}</strong></p>` : ''}
        ${m ? `<p style="font-size:13px;color:#94a3b8;">挖掘 ${m.clickCount} 次 / 命中 ${m.hitCount} 次 / 命中率 ${formatPct(m.accuracy)}</p>` : ''}
        <p>如果三个游戏的点券收益接近，说明标定成功。</p>
      `;
      break;
    }
  }
}

/* ---------- 启动 ---------- */

bindButtons();
renderAll();

// 支持 URL 参数自动启动小游戏，便于无头浏览器/自动化截图验证
// 示例：http://localhost:5173/test-minigames.html?autostart=balloon
const autoStart = new URLSearchParams(window.location.search).get('autostart') as MiniGameType | null;
if (autoStart && autoStart in GAME_META) {
  // 等待字体与样式稳定后再启动，避免渲染抖动
  window.addEventListener('load', () => startGame(autoStart));
}

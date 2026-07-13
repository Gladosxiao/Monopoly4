import type { IMiniGame, MiniGameConfig, MiniGameResult, MiniGameType } from '@monopoly4/shared';
import { BalloonMiniGame } from './balloon.js';
import { LuckyDropGame } from './luckyDrop.js';
import { PenguinDigGame } from './penguinDig.js';

/** 小游戏管理器，负责创建实例、控制生命周期与结果回调 */
export class MiniGameManager {
  private currentGame: IMiniGame | null = null;
  private container: HTMLDivElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private timerEl: HTMLDivElement | null = null;
  private scoreEl: HTMLDivElement | null = null;
  private startTime = 0;
  private cleanupFns: Array<() => void> = [];

  /** 根据类型创建小游戏实例 */
  createGame(type: MiniGameType, calibration?: { cooldownMs?: number; scoreMultiplier?: number }): IMiniGame {
    const config = this.getDefaultConfig(type);
    switch (type) {
      case 'balloon':
        return new BalloonMiniGame();
      case 'luckyDrop':
        return new LuckyDropGame(config);
      case 'penguinDig': {
        const game = new PenguinDigGame();
        if (calibration) {
          game.applyCalibration(calibration.cooldownMs ?? 500, calibration.scoreMultiplier ?? 1);
        }
        return game;
      }
      default:
        throw new Error(`未实现的小游戏类型: ${type}`);
    }
  }

  /** 获取小游戏默认配置 */
  getDefaultConfig(type: MiniGameType): MiniGameConfig {
    switch (type) {
      case 'balloon':
        return {
          type: 'balloon',
          duration: 30000,
          canvasWidth: 800,
          canvasHeight: 600,
        };
      case 'luckyDrop':
        return {
          type: 'luckyDrop',
          duration: 30000,
          canvasWidth: 800,
          canvasHeight: 600,
        };
      case 'penguinDig':
        return {
          type: 'penguinDig',
          duration: 30000,
          canvasWidth: 800,
          canvasHeight: 600,
        };
      default:
        throw new Error(`未实现的小游戏类型: ${type}`);
    }
  }

  /** 启动小游戏，返回清理函数 */
  start(
    type: MiniGameType,
    callbacks?: {
      onUpdate?: (score: number) => void;
      onEnd?: (result: MiniGameResult) => void;
    },
    calibration?: { cooldownMs?: number; scoreMultiplier?: number }
  ): () => MiniGameResult | null {
    this.reset();

    const game = this.createGame(type, calibration);
    this.currentGame = game;

    this.container = this.createOverlay();
    this.canvas = this.createCanvas(game.config);
    this.timerEl = this.createHudElement('timer', `时间: ${(game.config.duration / 1000).toFixed(0)}s`);
    this.scoreEl = this.createHudElement('score', '得分: 0');

    this.container.appendChild(this.canvas);
    this.container.appendChild(this.timerEl);
    this.container.appendChild(this.scoreEl);
    document.body.appendChild(this.container);

    game.onUpdate = (score: number) => {
      if (this.scoreEl) this.scoreEl.textContent = `得分: ${score}`;
      callbacks?.onUpdate?.(score);
    };

    game.onEnd = (result: MiniGameResult) => {
      this.showResult(result, callbacks?.onEnd);
    };

    game.start(this.canvas);
    this.startTime = performance.now();

    // 定期更新倒计时显示
    const timerId = setInterval(() => {
      if (!this.currentGame || !this.timerEl) {
        clearInterval(timerId);
        return;
      }
      const elapsed = performance.now() - this.startTime;
      const remaining = Math.max(0, game.config.duration - elapsed);
      this.timerEl.textContent = `时间: ${(remaining / 1000).toFixed(1)}s`;
      if (remaining <= 0) clearInterval(timerId);
    }, 100);
    this.cleanupFns.push(() => clearInterval(timerId));

    return () => this.stop();
  }

  /** 停止当前小游戏并返回结果（不销毁界面，等待结果弹窗关闭） */
  stop(): MiniGameResult | null {
    if (!this.currentGame) return null;
    const result = this.currentGame.stop();
    return result;
  }

  /** 强制重置：停止当前游戏并清理界面 */
  private reset(): void {
    if (this.currentGame) {
      this.currentGame.onEnd = undefined;
      this.currentGame.stop();
    }
    this.dispose();
  }

  private dispose(): void {
    this.cleanupFns.forEach((fn) => fn());
    this.cleanupFns = [];
    if (this.container?.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
    this.container = null;
    this.canvas = null;
    this.timerEl = null;
    this.scoreEl = null;
    this.currentGame = null;
  }

  private createOverlay(): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'minigame-overlay';
    el.style.position = 'fixed';
    el.style.inset = '0';
    el.style.display = 'flex';
    el.style.alignItems = 'center';
    el.style.justifyContent = 'center';
    el.style.background = 'rgba(0, 0, 0, 0.85)';
    el.style.zIndex = '9999';
    return el;
  }

  private createCanvas(config: MiniGameConfig): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = config.canvasWidth;
    canvas.height = config.canvasHeight;
    canvas.style.maxWidth = '100%';
    canvas.style.maxHeight = '100%';
    canvas.style.borderRadius = '12px';
    canvas.style.boxShadow = '0 8px 32px rgba(0,0,0,0.5)';
    canvas.style.background = '#000';
    return canvas;
  }

  private createHudElement(className: string, text: string): HTMLDivElement {
    const el = document.createElement('div');
    el.className = `minigame-hud ${className}`;
    el.textContent = text;
    el.style.position = 'absolute';
    el.style.padding = '8px 16px';
    el.style.background = 'rgba(26, 26, 46, 0.8)';
    el.style.color = '#fff';
    el.style.borderRadius = '8px';
    el.style.fontSize = '18px';
    el.style.fontWeight = 'bold';
    el.style.pointerEvents = 'none';
    if (className === 'timer') {
      el.style.top = '16px';
      el.style.right = '16px';
    } else {
      el.style.top = '16px';
      el.style.left = '16px';
    }
    return el;
  }

  private showResult(result: MiniGameResult, onEnd?: (result: MiniGameResult) => void): void {
    if (!this.container) return;

    const modal = document.createElement('div');
    modal.className = 'minigame-result';
    modal.style.position = 'absolute';
    modal.style.inset = '0';
    modal.style.display = 'flex';
    modal.style.flexDirection = 'column';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';
    modal.style.background = 'rgba(0, 0, 0, 0.75)';
    modal.style.color = '#fff';
    modal.innerHTML = `
      <h2>游戏结束</h2>
      <div style="font-size: 48px; margin: 16px 0;">${result.score} 分</div>
      <div style="font-size: 24px; margin-bottom: 24px;">获得点券: ${result.coupons}</div>
      <button id="minigame-close" style="
        padding: 14px 48px;
        font-size: 20px;
        border-radius: 10px;
        background: #4ecdc4;
        color: #0f172a;
        border: none;
        cursor: pointer;
        font-weight: 700;
        box-shadow: 0 8px 20px rgba(0,0,0,0.3);
        transition: transform 0.15s ease, filter 0.15s ease;
      " onmouseover="this.style.transform='translateY(-2px)';this.style.filter='brightness(1.1)'" onmouseout="this.style.transform='translateY(0)';this.style.filter='none'">确定</button>
    `;

    modal.querySelector('#minigame-close')!.addEventListener('click', () => {
      this.dispose();
      onEnd?.(result);
    });

    this.container.appendChild(modal);
  }
}

/** 全局默认管理器实例 */
export const miniGameManager = new MiniGameManager();

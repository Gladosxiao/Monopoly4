import type {
  MiniGameResult,
  MiniGameConfig,
  IMiniGame,
  MiniGameType,
} from '@monopoly4/shared';
import { PENGUIN_DIG_CONFIG } from './balance/config.js';

/**
 * 企鹅挖宝小游戏
 *
 * 玩法：开局显示 6×4 雪地网格中的所有埋藏物 3 秒，随后隐藏。
 * 玩家凭记忆点击格子挖掘：挖到宝藏加分，挖到炸弹扣分，空挖不加分。
 * 限时结束后按得分换算点券。
 */

// 埋藏物类型
type BuriedType = 'diamond' | 'gold' | 'sapphire' | 'ruby' | 'ice' | 'bomb' | 'empty';

// 单个埋藏格
interface Cell {
  type: BuriedType;
  x: number;
  y: number;
  width: number;
  height: number;
  revealed: boolean; // 是否已被挖开
  row: number;
  col: number;
}

// 物品定义
interface ItemDef {
  type: BuriedType;
  score: number;
  weight: number; // 生成权重
}

// 分值已按随机玩家基准标定，使三游戏期望点券收益一致
const ITEM_DEFS: ItemDef[] = [...PENGUIN_DIG_CONFIG.items];

const GAME_DURATION = PENGUIN_DIG_CONFIG.duration; // 游戏时长（毫秒）
const MEMORIZE_DURATION = PENGUIN_DIG_CONFIG.memorizeDuration; // 记忆阶段时长（毫秒）
const GRID_COLS = PENGUIN_DIG_CONFIG.cols;
const GRID_ROWS = PENGUIN_DIG_CONFIG.rows;
const MAX_COUPONS = PENGUIN_DIG_CONFIG.maxCoupons; // 最高可获得点券

// 浮动文字提示
interface FloatingText {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  maxLife: number;
}

export class PenguinDigGame implements IMiniGame {
  public config: MiniGameConfig;
  public onUpdate?: (score: number) => void;
  public onEnd?: (result: MiniGameResult) => void;

  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private animationId: number | null = null;
  private lastTime = 0;
  private startTime = 0;
  private score = 0;
  private cells: Cell[] = [];
  private floatingTexts: FloatingText[] = [];
  private gameEnded = false;
  private phase: 'memorize' | 'digging' = 'memorize';
  private memorizeEndTime = 0;
  private lastDigTime = 0;
  private digCooldownMs: number = PENGUIN_DIG_CONFIG.digCooldownMs; // 每次挖掘冷却
  private digCount = 0;
  private scoreMultiplier = 1; // 标定后的宝藏分值倍率

  // 过程指标采集
  private clickTimes: number[] = [];
  private hitCount = 0;

  constructor() {
    this.config = {
      type: 'penguinDig' as MiniGameType,
      duration: GAME_DURATION,
      canvasWidth: 800,
      canvasHeight: 600,
    };
  }

  /**
   * 应用标定参数（由测试流程根据用户前两个游戏表现计算）。
   */
  public applyCalibration(cooldownMs: number, scoreMultiplier: number): void {
    this.digCooldownMs = Math.max(200, Math.min(1200, cooldownMs));
    this.scoreMultiplier = Math.max(0.5, Math.min(4.0, scoreMultiplier));
  }

  /**
   * 启动游戏，绑定画布与输入事件。
   */
  public start(canvas: HTMLCanvasElement): void {
    if (this.canvas) {
      this.detachEvents();
    }

    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    if (!this.ctx) {
      throw new Error('无法获取 Canvas 2D 上下文');
    }

    // 设置画布逻辑尺寸
    canvas.width = this.config.canvasWidth;
    canvas.height = this.config.canvasHeight;

    // 重置游戏状态
    this.score = 0;
    this.cells = this.generateGrid();
    this.floatingTexts = [];
    this.gameEnded = false;
    this.phase = 'memorize';
    this.lastDigTime = 0;
    this.digCount = 0;
    this.clickTimes = [];
    this.hitCount = 0;
    this.startTime = performance.now();
    this.memorizeEndTime = this.startTime + MEMORIZE_DURATION;
    this.lastTime = this.startTime;

    this.attachEvents();

    this.onUpdate?.(this.score);
    this.animationId = requestAnimationFrame((t) => this.loop(t));
  }

  /**
   * 停止游戏并返回结果。
   */
  public stop(): MiniGameResult {
    this.endGame();
    return this.buildResult();
  }

  private loop(time: number): void {
    if (!this.canvas || !this.ctx || this.gameEnded) {
      return;
    }

    // 限制最大时间步长，防止切换标签页后 dt 过大
    const dt = Math.min((time - this.lastTime) / 1000, 0.05);
    this.lastTime = time;

    const elapsed = time - this.startTime;
    const remaining = this.config.duration - elapsed;

    if (remaining <= 0) {
      this.endGame();
      return;
    }

    // 记忆阶段结束自动进入挖掘阶段
    if (this.phase === 'memorize' && time >= this.memorizeEndTime) {
      this.phase = 'digging';
    }

    this.update(dt);
    this.draw(time, remaining);

    this.animationId = requestAnimationFrame((t) => this.loop(t));
  }

  private update(dt: number): void {
    // 更新浮动文字
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const t = this.floatingTexts[i]!;
      t.y -= 30 * dt;
      t.life -= dt * 60;
      if (t.life <= 0) this.floatingTexts.splice(i, 1);
    }

    // 检查是否挖完所有非空/非炸弹宝藏
    const treasuresLeft = this.cells.some(
      (c) => !c.revealed && c.type !== 'empty' && c.type !== 'bomb'
    );
    if (this.phase === 'digging' && !treasuresLeft) {
      this.endGame();
    }
  }

  private generateGrid(): Cell[] {
    const cells: Cell[] = [];
    const paddingX = PENGUIN_DIG_CONFIG.paddingX;
    const paddingY = PENGUIN_DIG_CONFIG.paddingY;
    const gap = PENGUIN_DIG_CONFIG.gap;
    const cellW = (this.config.canvasWidth - paddingX * 2 - gap * (GRID_COLS - 1)) / GRID_COLS;
    const cellH = (this.config.canvasHeight - paddingY * 2 - gap * (GRID_ROWS - 1)) / GRID_ROWS;

    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const type = this.pickItemType();
        cells.push({
          type,
          x: paddingX + col * (cellW + gap),
          y: paddingY + row * (cellH + gap),
          width: cellW,
          height: cellH,
          revealed: false,
          row,
          col,
        });
      }
    }
    return cells;
  }

  private pickItemType(): BuriedType {
    const totalWeight = ITEM_DEFS.reduce((sum, def) => sum + def.weight, 0);
    let r = Math.random() * totalWeight;
    for (const def of ITEM_DEFS) {
      r -= def.weight;
      if (r <= 0) {
        return def.type;
      }
    }
    return 'empty';
  }

  private handlePointerDown = (e: PointerEvent): void => {
    if (!this.canvas || this.phase !== 'digging' || this.gameEnded) return;

    const now = performance.now();
    if (now - this.lastDigTime < this.digCooldownMs) return;

    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    const cell = this.cells.find(
      (c) => !c.revealed && x >= c.x && x <= c.x + c.width && y >= c.y && y <= c.y + c.height
    );

    if (cell) {
      this.lastDigTime = now;
      this.digCount++;
      this.clickTimes.push(now);
      this.digCell(cell);
    }
  };

  private digCell(cell: Cell): void {
    cell.revealed = true;

    const def = ITEM_DEFS.find((d) => d.type === cell.type);
    const rawScore = def ? def.score : 0;
    const scoreChange = Math.round(rawScore * this.scoreMultiplier);
    this.score += scoreChange;

    const cx = cell.x + cell.width / 2;
    const cy = cell.y + cell.height / 2;

    if (scoreChange > 0) {
      this.hitCount++;
      this.addFloatingText(cx, cy, `+${scoreChange}`, '#2ecc71');
    } else if (scoreChange < 0) {
      this.hitCount++;
      this.addFloatingText(cx, cy, `${scoreChange}`, '#e74c3c');
    } else {
      this.addFloatingText(cx, cy, '0', '#95a5a6');
    }

    this.onUpdate?.(this.score);
  }

  private addFloatingText(x: number, y: number, text: string, color: string): void {
    this.floatingTexts.push({
      x,
      y: y - 10,
      text,
      color,
      life: 45,
      maxLife: 45,
    });
  }

  private draw(time: number, remaining: number): void {
    if (!this.canvas || !this.ctx) return;

    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    // 清空画布
    ctx.clearRect(0, 0, w, h);

    // 绘制冰雪背景渐变
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, '#e0f7fa');
    gradient.addColorStop(1, '#b2ebf2');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);

    // 绘制雪地纹理
    this.drawSnowTexture(ctx, w, h);

    // 绘制网格与埋藏物
    for (const cell of this.cells) {
      this.drawCell(ctx, cell, time);
    }

    // 绘制浮动文字
    for (const t of this.floatingTexts) {
      ctx.globalAlpha = Math.max(0, t.life / t.maxLife);
      ctx.fillStyle = t.color;
      ctx.font = 'bold 26px sans-serif';
      ctx.textAlign = 'center';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 4;
      ctx.strokeText(t.text, t.x, t.y);
      ctx.fillText(t.text, t.x, t.y);
      ctx.globalAlpha = 1;
    }

    // 绘制 UI
    this.drawUI(ctx, remaining);
  }

  private drawSnowTexture(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    for (let i = 0; i < 40; i++) {
      const x = ((i * 137.5) % w);
      const y = ((i * 73.3) % h);
      const r = 2 + (i % 3);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawCell(ctx: CanvasRenderingContext2D, cell: Cell, time: number): void {
    const x = cell.x;
    const y = cell.y;
    const w = cell.width;
    const h = cell.height;
    const cx = x + w / 2;
    const cy = y + h / 2;

    // 雪地坑/格子背景
    ctx.fillStyle = cell.revealed ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 8);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 记忆阶段或已挖开：显示图标
    if (this.phase === 'memorize' || cell.revealed) {
      this.drawBuriedItem(ctx, cell.type, cx, cy, Math.min(w, h) * 0.32);
    } else {
      // 挖掘阶段未挖开：显示问号铲子提示
      ctx.fillStyle = 'rgba(144, 202, 249, 0.4)';
      ctx.beginPath();
      ctx.arc(cx, cy, Math.min(w, h) * 0.18, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#64b5f6';
      ctx.font = `bold ${Math.max(12, Math.min(w, h) * 0.35)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('?', cx, cy);
    }
  }

  private drawBuriedItem(
    ctx: CanvasRenderingContext2D,
    type: BuriedType,
    cx: number,
    cy: number,
    half: number
  ): void {
    ctx.save();
    ctx.translate(cx, cy);

    switch (type) {
      case 'diamond': {
        // 蓝色菱形钻石
        ctx.fillStyle = '#00bcd4';
        ctx.beginPath();
        ctx.moveTo(0, -half);
        ctx.lineTo(half, 0);
        ctx.lineTo(0, half);
        ctx.lineTo(-half, 0);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#006064';
        ctx.lineWidth = 2;
        ctx.stroke();
        // 高光
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.beginPath();
        ctx.moveTo(0, -half * 0.5);
        ctx.lineTo(half * 0.5, 0);
        ctx.lineTo(0, half * 0.5);
        ctx.lineTo(-half * 0.5, 0);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case 'gold': {
        // 金色方块
        ctx.fillStyle = '#ffd700';
        ctx.fillRect(-half, -half, half * 2, half * 2);
        ctx.strokeStyle = '#f57f17';
        ctx.lineWidth = 2;
        ctx.strokeRect(-half, -half, half * 2, half * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.fillRect(-half * 0.5, -half * 0.5, half, half * 0.3);
        break;
      }
      case 'sapphire': {
        // 蓝色圆形宝石
        ctx.fillStyle = '#1976d2';
        ctx.beginPath();
        ctx.arc(0, 0, half, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#0d47a1';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.beginPath();
        ctx.arc(-half * 0.3, -half * 0.3, half * 0.25, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'ruby': {
        // 绿色翡翠（与黑色红芯炸弹、红色刺球彻底区分）
        ctx.fillStyle = '#2ecc71';
        ctx.beginPath();
        ctx.arc(0, 0, half, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#1b5e20';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.beginPath();
        ctx.arc(-half * 0.3, -half * 0.3, half * 0.25, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'ice': {
        // 白色冰块
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.roundRect(-half, -half, half * 2, half * 2, 4);
        ctx.fill();
        ctx.strokeStyle = '#b0bec5';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = 'rgba(176, 190, 197, 0.3)';
        ctx.beginPath();
        ctx.moveTo(-half * 0.5, 0);
        ctx.lineTo(0, half * 0.5);
        ctx.lineTo(half * 0.5, -half * 0.2);
        ctx.stroke();
        break;
      }
      case 'bomb': {
        // 黑色地雷 + 红色警示灯
        const grad = ctx.createRadialGradient(-half * 0.3, -half * 0.3, half * 0.2, 0, 0, half);
        grad.addColorStop(0, '#636e72');
        grad.addColorStop(1, '#212121');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(0, 0, half, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#f44336';
        ctx.beginPath();
        ctx.arc(0, 0, half * 0.35, 0, Math.PI * 2);
        ctx.fill();
        // 引线火花闪烁
        ctx.strokeStyle = '#b2bec3';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, -half);
        ctx.quadraticCurveTo(half * 0.3, -half - half * 0.4, half * 0.6, -half - half * 0.25);
        ctx.stroke();
        ctx.fillStyle = Math.random() > 0.5 ? '#ff5722' : '#ffeb3b';
        ctx.beginPath();
        ctx.arc(half * 0.6, -half - half * 0.25, half * 0.15, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'empty':
      default: {
        // 空坑：显示小雪花符号
        ctx.fillStyle = '#b0bec5';
        ctx.font = `bold ${Math.max(10, half * 0.8)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('✕', 0, 0);
        break;
      }
    }

    ctx.restore();
  }

  private drawUI(ctx: CanvasRenderingContext2D, remaining: number): void {
    const seconds = Math.ceil(remaining / 1000);

    ctx.font = 'bold 24px sans-serif';
    ctx.fillStyle = '#263238';
    ctx.textAlign = 'left';
    ctx.fillText(`得分: ${this.score}`, 20, 40);
    ctx.textAlign = 'right';
    ctx.fillText(`时间: ${seconds}s`, this.canvas!.width - 20, 40);

    // 记忆阶段提示
    if (this.phase === 'memorize') {
      const memorizeRemaining = Math.max(0, this.memorizeEndTime - performance.now());
      const memorizeSec = Math.ceil(memorizeRemaining / 1000);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#1976d2';
      ctx.font = 'bold 22px sans-serif';
      ctx.fillText(`记住宝藏位置！${memorizeSec} 秒后开始挖掘`, this.canvas!.width / 2, 80);
    } else {
      ctx.textAlign = 'center';
      ctx.fillStyle = '#546e7a';
      ctx.font = 'bold 18px sans-serif';
      ctx.fillText('点击格子挖掘宝藏', this.canvas!.width / 2, 80);

      // 挖掘冷却提示
      const cdRemaining = Math.max(0, this.digCooldownMs - (performance.now() - this.lastDigTime));
      if (cdRemaining > 0) {
        ctx.fillStyle = '#e67e22';
        ctx.font = 'bold 14px sans-serif';
        ctx.fillText(`冷却中 ${(cdRemaining / 1000).toFixed(1)}s`, this.canvas!.width / 2, 105);
      }
    }
  }

  private attachEvents(): void {
    this.canvas?.addEventListener('pointerdown', this.handlePointerDown);
  }

  private detachEvents(): void {
    this.canvas?.removeEventListener('pointerdown', this.handlePointerDown);
  }

  private endGame(): void {
    if (this.gameEnded) return;
    this.gameEnded = true;

    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }

    this.detachEvents();

    const result = this.buildResult();
    this.onEnd?.(result);
  }

  private buildResult(): MiniGameResult {
    const now = performance.now();
    const duration = Math.min(now - this.startTime, this.config.duration);
    const coupons = Math.max(0, Math.min(this.score, MAX_COUPONS));

    // 计算平均点击间隔
    let avgTimeBetweenClicks = 0;
    if (this.clickTimes.length >= 2) {
      let total = 0;
      for (let i = 1; i < this.clickTimes.length; i++) {
        total += this.clickTimes[i]! - this.clickTimes[i - 1]!;
      }
      avgTimeBetweenClicks = total / (this.clickTimes.length - 1);
    }

    return {
      type: this.config.type,
      score: this.score,
      coupons,
      duration: Math.round(duration),
      metrics: {
        clickCount: this.digCount,
        hitCount: this.hitCount,
        accuracy: this.digCount > 0 ? this.hitCount / this.digCount : 0,
        avgTimeBetweenClicks,
      },
    };
  }
}

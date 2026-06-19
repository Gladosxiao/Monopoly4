import {
  type IMiniGame,
  type MiniGameConfig,
  type MiniGameResult,
} from '@monopoly4/shared';

/**
 * 掉落物种类
 */
type DropItemKind =
  | 'gold' // 金元宝
  | 'silver' // 银元宝
  | 'coin' // 铜钱
  | 'chest' // 宝箱
  | 'rock' // 石头
  | 'bomb'; // 炸弹

/**
 * 单个掉落物状态
 */
interface DropItem {
  kind: DropItemKind;
  x: number;
  y: number;
  radius: number;
  speed: number; // 像素 / 秒
  value: number; // 得分变化，障碍物为负
  rotation: number;
  rotSpeed: number;
}

/**
 * 喜从天降小游戏
 *
 * 玩家控制底部角色左右移动，接住从天而降的元宝、铜钱与宝箱，
 * 避开石头与炸弹，在限定时间内尽可能获得高分。
 */
export class LuckyDropGame implements IMiniGame {
  readonly config: MiniGameConfig;

  onUpdate?: (score: number) => void;
  onEnd?: (result: MiniGameResult) => void;

  private canvas?: HTMLCanvasElement;
  private ctx?: CanvasRenderingContext2D | null;
  private rafId?: number;

  private isRunning = false;
  private hasEnded = false;

  private score = 0;
  private startTime = 0;
  private lastFrameTime = 0;
  private remainingMs = 0;

  // 玩家（接物角色）状态
  private playerX = 0;
  private playerVelX = 0;
  private readonly playerWidth = 70;
  private readonly playerHeight = 24;
  private readonly playerBottomMargin = 24;
  private readonly playerMaxSpeed = 420; // 像素 / 秒
  private readonly playerAccel = 1600; // 像素 / 秒²
  private readonly playerFriction = 0.86;

  // 输入状态
  private keysPressed = new Set<string>();
  private pointerActive = false;
  private pointerTargetX = 0;

  // 掉落物
  private items: DropItem[] = [];
  private nextSpawnTime = 0;
  private spawnInterval = 800; // 毫秒

  // 眩晕效果（炸弹命中）
  private stunnedUntil = 0;

  constructor(config: MiniGameConfig) {
    this.config = { ...config };
    this.remainingMs = config.duration;
  }

  /**
   * 启动游戏，绑定画布与输入事件。
   */
  start(canvas: HTMLCanvasElement): void {
    if (this.isRunning) {
      this.stop();
    }

    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    if (!this.ctx) {
      throw new Error('无法获取 Canvas 2D 渲染上下文');
    }

    // 使用配置尺寸初始化画布
    canvas.width = this.config.canvasWidth;
    canvas.height = this.config.canvasHeight;
    canvas.style.touchAction = 'none';
    canvas.setAttribute('tabindex', '0');

    this.score = 0;
    this.items = [];
    this.playerVelX = 0;
    this.stunnedUntil = 0;
    this.hasEnded = false;

    this.playerX = (this.config.canvasWidth - this.playerWidth) / 2;
    this.pointerTargetX = this.playerX;

    const now = performance.now();
    this.startTime = now;
    this.lastFrameTime = now;
    this.remainingMs = this.config.duration;
    this.nextSpawnTime = now + this.spawnInterval;

    this.bindInput();
    this.isRunning = true;
    this.rafId = requestAnimationFrame(this.loop);
  }

  /**
   * 停止游戏并返回结算结果。
   */
  stop(): MiniGameResult {
    const duration = this.startTime
      ? Math.max(0, Math.round(performance.now() - this.startTime))
      : 0;

    this.unbindInput();
    if (this.rafId !== undefined) {
      cancelAnimationFrame(this.rafId);
      this.rafId = undefined;
    }
    this.isRunning = false;

    const result: MiniGameResult = {
      type: this.config.type,
      score: this.score,
      coupons: Math.min(this.score, 500),
      duration,
    };

    return result;
  }

  /**
   * 主循环
   */
  private loop = (): void => {
    if (!this.isRunning || !this.ctx || !this.canvas) {
      return;
    }

    const now = performance.now();
    const rawDt = (now - this.lastFrameTime) / 1000;
    const dt = Math.min(rawDt, 0.05); // 防止切页后 dt 过大
    this.lastFrameTime = now;

    this.remainingMs = Math.max(0, this.config.duration - (now - this.startTime));

    if (this.remainingMs <= 0) {
      this.endGame();
      return;
    }

    this.update(dt, now);
    this.draw();

    this.rafId = requestAnimationFrame(this.loop);
  };

  /**
   * 更新逻辑：输入、移动、生成掉落物、碰撞判定。
   */
  private update(dt: number, now: number): void {
    const width = this.config.canvasWidth;
    const height = this.config.canvasHeight;
    const elapsedSec = (now - this.startTime) / 1000;

    // 难度曲线：掉落速度、生成频率随时间提升
    const speedMultiplier = 1 + (elapsedSec / (this.config.duration / 1000)) * 1.2;
    this.spawnInterval = Math.max(260, 900 - elapsedSec * 22);

    // 玩家移动
    const stunned = now < this.stunnedUntil;
    if (stunned) {
      this.playerVelX = 0;
    } else if (this.pointerActive) {
      // 鼠标/触摸：直接定位
      this.playerX = this.clampPlayerX(this.pointerTargetX);
      this.playerVelX = 0;
    } else {
      // 键盘：带惯性的加速度移动
      let targetVel = 0;
      if (this.keysPressed.has('ArrowLeft') || this.keysPressed.has('KeyA')) {
        targetVel -= this.playerMaxSpeed;
      }
      if (this.keysPressed.has('ArrowRight') || this.keysPressed.has('KeyD')) {
        targetVel += this.playerMaxSpeed;
      }

      if (targetVel !== 0) {
        this.playerVelX += Math.sign(targetVel) * this.playerAccel * dt;
        this.playerVelX = Math.max(-this.playerMaxSpeed, Math.min(this.playerMaxSpeed, this.playerVelX));
      } else {
        this.playerVelX *= this.playerFriction;
        if (Math.abs(this.playerVelX) < 1) {
          this.playerVelX = 0;
        }
      }
      this.playerX = this.clampPlayerX(this.playerX + this.playerVelX * dt);
    }

    // 生成掉落物
    if (now >= this.nextSpawnTime) {
      this.spawnItem(width, speedMultiplier);
      this.nextSpawnTime = now + this.spawnInterval;
    }

    // 更新掉落物位置与碰撞
    const playerY = height - this.playerHeight - this.playerBottomMargin;
    const playerRect = {
      x: this.playerX,
      y: playerY,
      w: this.playerWidth,
      h: this.playerHeight,
    };

    for (let i = this.items.length - 1; i >= 0; i--) {
      const item = this.items[i]!;
      item.y += item.speed * speedMultiplier * dt;
      item.rotation += item.rotSpeed * dt;

      // 碰撞检测（AABB）
      if (this.intersects(item, playerRect)) {
        this.applyItemEffect(item, now);
        this.items.splice(i, 1);
        continue;
      }

      // 超出屏幕底部则移除
      if (item.y - item.radius > height) {
        this.items.splice(i, 1);
      }
    }
  }

  /**
   * 渲染场景。
   */
  private draw(): void {
    const ctx = this.ctx!;
    const width = this.config.canvasWidth;
    const height = this.config.canvasHeight;

    // 背景
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, '#e0f7fa');
    gradient.addColorStop(1, '#ffffff');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    // 掉落物
    for (const item of this.items) {
      this.drawItem(ctx, item);
    }

    // 玩家
    this.drawPlayer(ctx);

    // HUD
    this.drawHud(ctx);
  }

  // ==================== 输入事件 ====================

  private bindInput(): void {
    window.addEventListener('keydown', this.handleKeyDown, { passive: false });
    window.addEventListener('keyup', this.handleKeyUp, { passive: false });

    const canvas = this.canvas!;
    canvas.addEventListener('pointerdown', this.handlePointerDown);
    canvas.addEventListener('pointermove', this.handlePointerMove);
    canvas.addEventListener('pointerup', this.handlePointerUp);
    canvas.addEventListener('pointercancel', this.handlePointerUp);
    canvas.addEventListener('pointerleave', this.handlePointerUp);
  }

  private unbindInput(): void {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);

    const canvas = this.canvas;
    if (canvas) {
      canvas.removeEventListener('pointerdown', this.handlePointerDown);
      canvas.removeEventListener('pointermove', this.handlePointerMove);
      canvas.removeEventListener('pointerup', this.handlePointerUp);
      canvas.removeEventListener('pointercancel', this.handlePointerUp);
      canvas.removeEventListener('pointerleave', this.handlePointerUp);
    }
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (
      e.code === 'ArrowLeft' ||
      e.code === 'ArrowRight' ||
      e.code === 'KeyA' ||
      e.code === 'KeyD'
    ) {
      e.preventDefault();
      this.keysPressed.add(e.code);
      this.pointerActive = false;
    }
  };

  private handleKeyUp = (e: KeyboardEvent): void => {
    if (
      e.code === 'ArrowLeft' ||
      e.code === 'ArrowRight' ||
      e.code === 'KeyA' ||
      e.code === 'KeyD'
    ) {
      e.preventDefault();
      this.keysPressed.delete(e.code);
    }
  };

  private handlePointerDown = (e: PointerEvent): void => {
    this.pointerActive = true;
    this.keysPressed.clear();
    this.pointerTargetX = e.offsetX - this.playerWidth / 2;
    this.canvas?.setPointerCapture(e.pointerId);
  };

  private handlePointerMove = (e: PointerEvent): void => {
    if (this.pointerActive) {
      this.pointerTargetX = e.offsetX - this.playerWidth / 2;
    }
  };

  private handlePointerUp = (e: PointerEvent): void => {
    this.pointerActive = false;
    try {
      this.canvas?.releasePointerCapture(e.pointerId);
    } catch {
      // 忽略未捕获指针时的异常
    }
  };

  // ==================== 掉落物逻辑 ====================

  private spawnItem(width: number, speedMultiplier: number): void {
    const rand = Math.random();
    let kind: DropItemKind;
    let radius: number;
    let value: number;
    let baseSpeed: number;

    if (rand < 0.01) {
      kind = 'chest';
      radius = 18;
      value = 20;
      baseSpeed = 140;
    } else if (rand < 0.12) {
      kind = 'gold';
      radius = 17;
      value = 10;
      baseSpeed = 150;
    } else if (rand < 0.32) {
      kind = 'silver';
      radius = 14;
      value = 5;
      baseSpeed = 160;
    } else if (rand < 0.55) {
      kind = 'coin';
      radius = 10;
      value = 1;
      baseSpeed = 170;
    } else if (rand < 0.85) {
      kind = 'rock';
      radius = 13;
      value = -5;
      baseSpeed = 180;
    } else {
      kind = 'bomb';
      radius = 13;
      value = -10;
      baseSpeed = 175;
    }

    const item: DropItem = {
      kind,
      x: radius + Math.random() * (width - radius * 2),
      y: -radius,
      radius,
      speed: baseSpeed * (0.85 + Math.random() * 0.3) * speedMultiplier,
      value,
      rotation: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 2,
    };
    this.items.push(item);
  }

  private applyItemEffect(item: DropItem, now: number): void {
    this.score = Math.max(0, this.score + item.value);

    if (item.kind === 'bomb') {
      this.stunnedUntil = now + 1200;
      this.playerVelX = 0;
    }

    this.onUpdate?.(this.score);
  }

  // ==================== 碰撞与边界工具 ====================

  private clampPlayerX(x: number): number {
    return Math.max(0, Math.min(this.config.canvasWidth - this.playerWidth, x));
  }

  private intersects(item: DropItem, rect: { x: number; y: number; w: number; h: number }): boolean {
    const half = item.radius;
    return !(
      item.x + half < rect.x ||
      item.x - half > rect.x + rect.w ||
      item.y + half < rect.y ||
      item.y - half > rect.y + rect.h
    );
  }

  // ==================== 绘制：玩家 ====================

  private drawPlayer(ctx: CanvasRenderingContext2D): void {
    const x = this.playerX;
    const y = this.config.canvasHeight - this.playerHeight - this.playerBottomMargin;
    const w = this.playerWidth;
    const h = this.playerHeight;

    const stunned = performance.now() < this.stunnedUntil;

    ctx.save();

    // 身体
    ctx.fillStyle = stunned ? '#ff9f43' : '#4ecdc4';
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 8);
    ctx.fill();

    // 边框
    ctx.strokeStyle = stunned ? '#e67e22' : '#1a535c';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 简单眼睛
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x + w * 0.3, y + h * 0.35, 4, 0, Math.PI * 2);
    ctx.arc(x + w * 0.7, y + h * 0.35, 4, 0, Math.PI * 2);
    ctx.fill();

    // 眩晕标识
    if (stunned) {
      ctx.fillStyle = '#e74c3c';
      ctx.font = 'bold 16px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('★', x + w / 2, y - 8);
    }

    ctx.restore();
  }

  // ==================== 绘制：掉落物 ====================

  private drawItem(ctx: CanvasRenderingContext2D, item: DropItem): void {
    ctx.save();
    ctx.translate(item.x, item.y);
    ctx.rotate(item.rotation);

    switch (item.kind) {
      case 'gold':
        this.drawIngot(ctx, item.radius, '#ffd700', '#b8860b');
        break;
      case 'silver':
        this.drawIngot(ctx, item.radius, '#e0e0e0', '#9e9e9e');
        break;
      case 'coin':
        this.drawCoin(ctx, item.radius);
        break;
      case 'chest':
        this.drawChest(ctx, item.radius);
        break;
      case 'rock':
        this.drawRock(ctx, item.radius);
        break;
      case 'bomb':
        this.drawBomb(ctx, item.radius);
        break;
    }

    ctx.restore();
  }

  /**
   * 元宝：金色/银色椭圆
   */
  private drawIngot(
    ctx: CanvasRenderingContext2D,
    radius: number,
    fill: string,
    shadow: string
  ): void {
    const w = radius * 2;
    const h = radius * 1.4;

    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = shadow;
    ctx.lineWidth = 2;
    ctx.stroke();

    // 高光
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.beginPath();
    ctx.ellipse(0, -h * 0.15, w * 0.35, h * 0.25, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  /**
   * 铜钱：圆形铜币
   */
  private drawCoin(ctx: CanvasRenderingContext2D, radius: number): void {
    ctx.fillStyle = '#d35400';
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#a04000';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = '#5d2e0c';
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.35, 0, Math.PI * 2);
    ctx.fill();

    // 高光
    ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.beginPath();
    ctx.arc(-radius * 0.25, -radius * 0.25, radius * 0.25, 0, Math.PI * 2);
    ctx.fill();
  }

  /**
   * 宝箱：棕色矩形
   */
  private drawChest(ctx: CanvasRenderingContext2D, radius: number): void {
    const size = radius * 1.8;
    const half = size / 2;

    ctx.fillStyle = '#8d6e63';
    ctx.fillRect(-half, -half, size, size);

    ctx.strokeStyle = '#5d4037';
    ctx.lineWidth = 2;
    ctx.strokeRect(-half, -half, size, size);

    // 金色镶边与锁
    ctx.fillStyle = '#ffd700';
    ctx.fillRect(-3, -half, 6, size);
    ctx.beginPath();
    ctx.arc(0, 0, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  /**
   * 石头：灰色圆
   */
  private drawRock(ctx: CanvasRenderingContext2D, radius: number): void {
    ctx.fillStyle = '#7f8c8d';
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#566573';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 裂纹
    ctx.strokeStyle = '#566573';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-radius * 0.3, -radius * 0.3);
    ctx.lineTo(radius * 0.2, radius * 0.1);
    ctx.lineTo(radius * 0.1, radius * 0.4);
    ctx.stroke();
  }

  /**
   * 炸弹：黑色圆 + 引线
   */
  private drawBomb(ctx: CanvasRenderingContext2D, radius: number): void {
    ctx.fillStyle = '#2d3436';
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#636e72';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 引线
    ctx.strokeStyle = '#b2bec3';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -radius);
    ctx.quadraticCurveTo(4, -radius - 6, 8, -radius - 4);
    ctx.stroke();

    // 火花
    ctx.fillStyle = '#e74c3c';
    ctx.beginPath();
    ctx.arc(8, -radius - 4, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // ==================== HUD ====================

  private drawHud(ctx: CanvasRenderingContext2D): void {
    const remainingSec = Math.ceil(this.remainingMs / 1000);
    const scoreText = `得分: ${this.score}`;
    const timeText = `剩余时间: ${remainingSec}s`;

    ctx.save();
    ctx.font = 'bold 18px sans-serif';
    ctx.textBaseline = 'top';

    // 阴影文字
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.fillText(scoreText, 13, 13);
    ctx.fillText(timeText, 13, 38);

    ctx.fillStyle = '#2d3436';
    ctx.fillText(scoreText, 12, 12);
    ctx.fillText(timeText, 12, 37);

    ctx.restore();
  }

  // ==================== 结束处理 ====================

  private endGame(): void {
    if (this.hasEnded) {
      return;
    }
    this.hasEnded = true;

    const result = this.stop();
    this.onEnd?.(result);
  }
}

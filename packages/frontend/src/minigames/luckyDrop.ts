import {
  type IMiniGame,
  type MiniGameConfig,
  type MiniGameResult,
} from '@monopoly4/shared';
import { LUCKY_DROP_CONFIG } from './balance/config.js';

/**
 * 掉落物种类
 */
type DropItemKind =
  | 'gold' // 金元宝
  | 'silver' // 银元宝
  | 'coin' // 铜钱
  | 'chest' // 宝箱
  | 'spike' // 红色刺球（扣分）
  | 'bomb' // 炸弹（扣分）
  | 'clock'; // 时钟：触发时间减缓

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

/** 浮动文字提示 */
interface FloatingText {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  maxLife: number;
}

/**
 * 喜从天降小游戏
 *
 * 玩家控制底部角色左右移动，接住从天而降的元宝、铜钱与宝箱，
 * 避开石头与炸弹，在限定时间内尽可能获得高分。
 * 新增时钟道具：白底时钟，接住后进入时间减缓，掉落物速度与倒计时流逝减半，
 * 但平台移动速度不受影响。
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
  private scoreMultiplier = 1;
  private startTime = 0;
  private lastFrameTime = 0;
  private remainingMs = 0;
  private totalElapsedMs = 0; // 受 timeScale 影响的累计流逝时间

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

  // 时间减缓 buff
  private slowMotionUntil = 0;
  private timeScale = 1;

  // 视觉反馈
  private floatingTexts: FloatingText[] = [];

  // 过程指标采集
  private playerXHistory: { x: number; time: number }[] = [];
  private directionChanges = 0;
  private lastDirection = 0;
  private itemsSpawned = 0;
  private itemsCaught = 0;
  private minPlayerX = 0;
  private maxPlayerX = 0;

  constructor(config: MiniGameConfig) {
    this.config = { ...config };
    this.remainingMs = config.duration;
  }

  /**
   * 应用个性化得分倍率（由标定结果计算）。
   */
  applyScoreMultiplier(multiplier: number): void {
    this.scoreMultiplier = Math.max(0.1, Math.min(5.0, multiplier));
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
    this.floatingTexts = [];
    this.playerVelX = 0;
    this.stunnedUntil = 0;
    this.slowMotionUntil = 0;
    this.timeScale = 1;
    this.totalElapsedMs = 0;
    this.hasEnded = false;

    this.playerX = (this.config.canvasWidth - this.playerWidth) / 2;
    this.pointerTargetX = this.playerX;
    this.playerXHistory = [];
    this.directionChanges = 0;
    this.lastDirection = 0;
    this.itemsSpawned = 0;
    this.itemsCaught = 0;
    this.minPlayerX = this.playerX;
    this.maxPlayerX = this.playerX;

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

    const finalScore = Math.max(0, Math.round(this.score * this.scoreMultiplier));
    const result: MiniGameResult = {
      type: this.config.type,
      score: finalScore,
      coupons: Math.min(finalScore, 500),
      duration,
      metrics: this.computeMetrics(duration),
    };

    return result;
  }

  /** 计算并返回过程指标 */
  private computeMetrics(duration: number) {
    // 平均平台移动速度
    let totalDist = 0;
    let totalTime = 0;
    for (let i = 1; i < this.playerXHistory.length; i++) {
      const prev = this.playerXHistory[i - 1]!;
      const curr = this.playerXHistory[i]!;
      const dt = curr.time - prev.time;
      if (dt > 0 && dt < 100) {
        totalDist += Math.abs(curr.x - prev.x);
        totalTime += dt;
      }
    }
    const avgPlatformSpeed = totalTime > 0 ? totalDist / totalTime : 0;

    // 屏幕覆盖率
    const screenCoverageRatio = this.config.canvasWidth > 0
      ? (this.maxPlayerX - this.minPlayerX + this.playerWidth) / this.config.canvasWidth
      : 0;

    // 每秒方向改变次数
    const directionChangesPerSec = duration > 0 ? (this.directionChanges / duration) * 1000 : 0;

    // 接取率
    const catchRate = this.itemsSpawned > 0 ? this.itemsCaught / this.itemsSpawned : 0;

    return {
      clickCount: this.itemsCaught,
      hitCount: this.itemsCaught,
      accuracy: catchRate,
      avgPlatformSpeed,
      directionChangesPerSec,
      screenCoverageRatio,
      catchRate,
    };
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

    // 更新时间减缓状态
    this.timeScale = now < this.slowMotionUntil ? 0.5 : 1;

    // 累计受 timeScale 影响的流逝时间，倒计时随之减缓
    this.totalElapsedMs += dt * 1000 * this.timeScale;
    this.remainingMs = Math.max(0, this.config.duration - this.totalElapsedMs);

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
    const realElapsedSec = (now - this.startTime) / 1000;

    // 难度曲线：掉落速度、生成频率随时间提升（基于真实时间，避免慢动作让难度也下降）
    const speedMultiplier = 1 + (realElapsedSec / (this.config.duration / 1000)) * 1.2;
    this.spawnInterval = Math.max(260, 900 - realElapsedSec * 22);

    // 玩家移动：不受 timeScale 影响，保持操作手感
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

    // 记录平台位置与方向变化
    this.playerXHistory.push({ x: this.playerX, time: now });
    this.minPlayerX = Math.min(this.minPlayerX, this.playerX);
    this.maxPlayerX = Math.max(this.maxPlayerX, this.playerX);
    const dir = this.playerVelX !== 0 ? Math.sign(this.playerVelX) : this.lastDirection;
    if (dir !== 0 && this.lastDirection !== 0 && dir !== this.lastDirection) {
      this.directionChanges++;
    }
    if (dir !== 0) this.lastDirection = dir;

    // 生成掉落物（生成间隔也受 timeScale 影响，避免慢动作时物品过于密集）
    const effectiveSpawnInterval = this.spawnInterval / this.timeScale;
    if (now >= this.nextSpawnTime) {
      this.spawnItem(width, speedMultiplier);
      this.itemsSpawned++;
      this.nextSpawnTime = now + effectiveSpawnInterval;
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
      // 掉落物下落受 timeScale 影响
      item.y += item.speed * speedMultiplier * this.timeScale * dt;
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

    // 更新浮动文字
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const t = this.floatingTexts[i]!;
      t.y -= 30 * dt;
      t.life -= dt * 60;
      if (t.life <= 0) this.floatingTexts.splice(i, 1);
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

    // 慢动作时绘制轻微蓝色遮罩提示
    if (this.timeScale < 1) {
      ctx.fillStyle = 'rgba(33, 150, 243, 0.08)';
      ctx.fillRect(0, 0, width, height);
    }

    // 掉落物
    for (const item of this.items) {
      this.drawItem(ctx, item);
    }

    // 玩家
    this.drawPlayer(ctx);

    // 浮动文字
    for (const t of this.floatingTexts) {
      ctx.globalAlpha = Math.max(0, t.life / t.maxLife);
      ctx.fillStyle = t.color;
      ctx.font = 'bold 22px sans-serif';
      ctx.textAlign = 'center';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 4;
      ctx.strokeText(t.text, t.x, t.y);
      ctx.fillText(t.text, t.x, t.y);
      ctx.globalAlpha = 1;
    }

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

    // 分值已按随机玩家基准标定，使三游戏期望点券收益一致
    const itemDef = LUCKY_DROP_CONFIG.items.find((d) => rand < d.probability);
    if (!itemDef) {
      // 兜底：最后一个 item 的概率为 1.0，正常情况下不会走到这里
      const last = LUCKY_DROP_CONFIG.items[LUCKY_DROP_CONFIG.items.length - 1];
      kind = last.kind;
      radius = last.radius;
      value = last.value;
      baseSpeed = last.baseSpeed;
    } else {
      kind = itemDef.kind;
      radius = itemDef.radius;
      value = itemDef.value;
      baseSpeed = itemDef.baseSpeed;
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
    this.itemsCaught++;

    if (item.kind === 'clock') {
      const clockDef = LUCKY_DROP_CONFIG.items.find((d) => d.kind === 'clock');
      this.slowMotionUntil = now + (clockDef?.slowMotionMs ?? 5000);
      this.addFloatingText(item.x, item.y, '⏳ 慢动作', '#2196f3');
      this.onUpdate?.(this.score);
      return;
    }

    this.score = Math.max(0, this.score + item.value);

    if (item.kind === 'bomb') {
      this.stunnedUntil = now + 1200;
      this.playerVelX = 0;
      this.addFloatingText(item.x, item.y, `${item.value}`, '#e74c3c');
    } else if (item.value > 0) {
      this.addFloatingText(item.x, item.y, `+${item.value}`, '#2ecc71');
    } else if (item.value < 0) {
      this.addFloatingText(item.x, item.y, `${item.value}`, '#e67e22');
    }

    this.onUpdate?.(this.score);
  }

  private addFloatingText(x: number, y: number, text: string, color: string): void {
    this.floatingTexts.push({
      x,
      y: y - 10,
      text,
      color,
      life: 40,
      maxLife: 40,
    });
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
    const slow = performance.now() < this.slowMotionUntil;

    ctx.save();

    // 身体：慢动作时带蓝色光晕
    ctx.fillStyle = stunned ? '#ff9f43' : slow ? '#64b5f6' : '#4ecdc4';
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 8);
    ctx.fill();

    // 边框
    ctx.strokeStyle = stunned ? '#e67e22' : slow ? '#1976d2' : '#1a535c';
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
        this.drawIngot(ctx, item.radius, '#ffd700', '#b8860b', true);
        break;
      case 'silver':
        this.drawIngot(ctx, item.radius, '#e0e0e0', '#9e9e9e', true);
        break;
      case 'coin':
        this.drawCoin(ctx, item.radius);
        break;
      case 'chest':
        this.drawChest(ctx, item.radius);
        break;
      case 'spike':
        this.drawSpike(ctx, item.radius);
        break;
      case 'bomb':
        this.drawBomb(ctx, item.radius);
        break;
      case 'clock':
        this.drawClock(ctx, item.radius);
        break;
    }

    ctx.restore();
  }

  /**
   * 元宝：金色/银色椭圆，带高光与阴影更有立体感
   */
  private drawIngot(
    ctx: CanvasRenderingContext2D,
    radius: number,
    fill: string,
    shadow: string,
    glossy: boolean
  ): void {
    const w = radius * 2;
    const h = radius * 1.4;

    // 底部阴影
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.beginPath();
    ctx.ellipse(0, 4, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = shadow;
    ctx.lineWidth = 2;
    ctx.stroke();

    if (glossy) {
      // 主高光
      ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
      ctx.beginPath();
      ctx.ellipse(-w * 0.15, -h * 0.25, w * 0.25, h * 0.2, -0.3, 0, Math.PI * 2);
      ctx.fill();
      // 边缘反光
      ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.beginPath();
      ctx.ellipse(w * 0.1, h * 0.15, w * 0.18, h * 0.12, 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /**
   * 铜钱：青色玉币，避免与红黑扣分道具混淆
   */
  private drawCoin(ctx: CanvasRenderingContext2D, radius: number): void {
    // 外圈青玉边
    ctx.fillStyle = '#26a69a';
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#00695c';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 内玉币
    ctx.fillStyle = '#4db6ac';
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.78, 0, Math.PI * 2);
    ctx.fill();

    // 方孔
    ctx.fillStyle = '#004d40';
    ctx.beginPath();
    ctx.roundRect(-radius * 0.22, -radius * 0.22, radius * 0.44, radius * 0.44, 2);
    ctx.fill();

    // 高光
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.beginPath();
    ctx.arc(-radius * 0.25, -radius * 0.25, radius * 0.22, 0, Math.PI * 2);
    ctx.fill();
  }

  /**
   * 宝箱：多彩宝箱，带金色镶边
   */
  private drawChest(ctx: CanvasRenderingContext2D, radius: number): void {
    const size = radius * 1.8;
    const half = size / 2;

    // 箱体渐变
    const grad = ctx.createLinearGradient(-half, -half, half, half);
    grad.addColorStop(0, '#a1887f');
    grad.addColorStop(0.5, '#8d6e63');
    grad.addColorStop(1, '#6d4c41');
    ctx.fillStyle = grad;
    ctx.fillRect(-half, -half, size, size);

    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth = 3;
    ctx.strokeRect(-half, -half, size, size);

    // 金色镶边与锁
    ctx.fillStyle = '#ffd700';
    ctx.fillRect(-3, -half, 6, size);
    ctx.beginPath();
    ctx.arc(0, 0, 5, 0, Math.PI * 2);
    ctx.fill();

    // 顶部装饰
    ctx.fillStyle = '#ffecb3';
    ctx.beginPath();
    ctx.moveTo(-half + 4, -half + 4);
    ctx.lineTo(0, -half - 6);
    ctx.lineTo(half - 4, -half + 4);
    ctx.closePath();
    ctx.fill();
  }

  /**
   * 红色刺球：红黑配色扣分道具
   */
  private drawSpike(ctx: CanvasRenderingContext2D, radius: number): void {
    // 黑色内核
    ctx.fillStyle = '#2d3436';
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.7, 0, Math.PI * 2);
    ctx.fill();

    // 红色尖刺
    ctx.fillStyle = '#e74c3c';
    const spikeCount = 10;
    for (let i = 0; i < spikeCount; i++) {
      const angle = (i * Math.PI * 2) / spikeCount;
      ctx.save();
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.moveTo(0, -radius * 0.5);
      ctx.lineTo(radius * 0.25, -radius);
      ctx.lineTo(0, radius * 0.5);
      ctx.lineTo(-radius * 0.25, -radius);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // 中心高光
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath();
    ctx.arc(-radius * 0.15, -radius * 0.15, radius * 0.2, 0, Math.PI * 2);
    ctx.fill();
  }

  /**
   * 炸弹：黑色圆 + 红色引线火花
   */
  private drawBomb(ctx: CanvasRenderingContext2D, radius: number): void {
    // 炸弹体
    const grad = ctx.createRadialGradient(-radius * 0.3, -radius * 0.3, radius * 0.2, 0, 0, radius);
    grad.addColorStop(0, '#636e72');
    grad.addColorStop(1, '#2d3436');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#b2bec3';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 引线
    ctx.strokeStyle = '#b2bec3';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -radius);
    ctx.quadraticCurveTo(4, -radius - 6, 8, -radius - 4);
    ctx.stroke();

    // 火花闪烁
    ctx.fillStyle = Math.random() > 0.5 ? '#ff5722' : '#ffeb3b';
    ctx.beginPath();
    ctx.arc(8, -radius - 4, 3, 0, Math.PI * 2);
    ctx.fill();

    // 骷髅标识
    ctx.fillStyle = '#b2bec3';
    ctx.beginPath();
    ctx.arc(0, -radius * 0.1, radius * 0.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(-radius * 0.12, radius * 0.15, radius * 0.08, radius * 0.2);
    ctx.fillRect(radius * 0.04, radius * 0.15, radius * 0.08, radius * 0.2);
  }

  /**
   * 时钟：白底圆形时钟，带蓝色指针与刻度
   */
  private drawClock(ctx: CanvasRenderingContext2D, radius: number): void {
    // 白底表盘
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();

    // 蓝色外圈
    ctx.strokeStyle = '#2196f3';
    ctx.lineWidth = 3;
    ctx.stroke();

    // 刻度
    ctx.strokeStyle = '#90caf9';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 12; i++) {
      const angle = (i * Math.PI) / 6;
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * radius * 0.75, Math.sin(angle) * radius * 0.75);
      ctx.lineTo(Math.cos(angle) * radius * 0.9, Math.sin(angle) * radius * 0.9);
      ctx.stroke();
    }

    // 指针
    ctx.strokeStyle = '#1976d2';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -radius * 0.55);
    ctx.stroke();

    ctx.strokeStyle = '#2196f3';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(radius * 0.4, 0);
    ctx.stroke();

    // 中心点
    ctx.fillStyle = '#1976d2';
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.12, 0, Math.PI * 2);
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

    // 慢动作时时间数字变蓝
    ctx.fillStyle = this.timeScale < 1 ? '#1976d2' : '#2d3436';
    ctx.fillText(scoreText, 12, 12);
    ctx.fillText(timeText, 12, 37);

    // 慢动作状态提示
    if (this.timeScale < 1) {
      ctx.font = 'bold 14px sans-serif';
      ctx.fillStyle = '#2196f3';
      ctx.fillText('⏳ 慢动作中', 12, 62);
    }

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

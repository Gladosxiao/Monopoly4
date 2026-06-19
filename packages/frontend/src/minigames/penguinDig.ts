import type {
  MiniGameResult,
  MiniGameConfig,
  IMiniGame,
  MiniGameType,
} from '@monopoly4/shared';

/**
 * 企鹅挖宝小游戏
 *
 * 玩法：控制企鹅在冰面上左右移动，接住从天而降的宝物获得分数，
 * 躲避雪球与地雷。限时结束后按得分换算点券。
 */

// 掉落物类型
type ItemType =
  | 'diamond'
  | 'gold'
  | 'sapphire'
  | 'ruby'
  | 'ice'
  | 'snowball'
  | 'mine';

// 掉落物实例
interface FallingItem {
  x: number;
  y: number;
  width: number;
  height: number;
  speed: number;
  type: ItemType;
  rotation: number;
  rotSpeed: number;
}

// 雪花背景元素
interface Snowflake {
  x: number;
  y: number;
  radius: number;
  speed: number;
}

// 企鹅状态
interface Penguin {
  x: number;
  y: number;
  width: number;
  height: number;
  speed: number;
  targetX: number | null;
  stunnedUntil: number;
}

// 物品定义
interface ItemDef {
  type: ItemType;
  score: number;
  width: number;
  height: number;
  weight: number;
  stun?: number;
}

// 各物品分值、尺寸与生成权重
const ITEM_DEFS: ItemDef[] = [
  { type: 'diamond', score: 25, width: 28, height: 28, weight: 5 },
  { type: 'gold', score: 15, width: 26, height: 26, weight: 10 },
  { type: 'sapphire', score: 10, width: 22, height: 22, weight: 15 },
  { type: 'ruby', score: 10, width: 22, height: 22, weight: 15 },
  { type: 'ice', score: 1, width: 20, height: 20, weight: 25 },
  { type: 'snowball', score: -5, width: 22, height: 22, weight: 15 },
  { type: 'mine', score: -15, width: 24, height: 24, weight: 8, stun: 1000 },
];

const GAME_DURATION = 30000; // 游戏时长（毫秒）
const PENGUIN_WIDTH = 80;
const PENGUIN_HEIGHT = 60;
const PENGUIN_SPEED = 520; // 企鹅移动速度（像素/秒）
const BASE_ITEM_SPEED = 180; // 基础掉落速度（像素/秒）
const MAX_ITEM_SPEED = 600; // 最大掉落速度（像素/秒）
const BASE_SPAWN_INTERVAL = 900; // 基础生成间隔（毫秒）
const MIN_SPAWN_INTERVAL = 220; // 最小生成间隔（毫秒）
const MAX_COUPONS = 500; // 最高可获得点券
const SNOWFLAKE_COUNT = 50; // 背景雪花数量

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
  private items: FallingItem[] = [];
  private snowflakes: Snowflake[] = [];
  private penguin: Penguin;
  private keys = new Set<string>();
  private pointerActive = false;
  private spawnTimer = 0;
  private currentSpawnInterval = BASE_SPAWN_INTERVAL;
  private gameEnded = false;

  constructor() {
    this.config = {
      type: 'penguinDig' as MiniGameType,
      duration: GAME_DURATION,
      canvasWidth: 800,
      canvasHeight: 600,
    };

    this.penguin = {
      x: 0,
      y: 0,
      width: PENGUIN_WIDTH,
      height: PENGUIN_HEIGHT,
      speed: PENGUIN_SPEED,
      targetX: null,
      stunnedUntil: 0,
    };
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

    // 初始化企鹅位置（底部居中）
    this.penguin.x = canvas.width / 2 - PENGUIN_WIDTH / 2;
    this.penguin.y = canvas.height - PENGUIN_HEIGHT - 24;
    this.penguin.targetX = null;
    this.penguin.stunnedUntil = 0;

    // 初始化背景雪花
    this.initSnowflakes();

    // 重置游戏状态
    this.score = 0;
    this.items = [];
    this.spawnTimer = 0;
    this.currentSpawnInterval = BASE_SPAWN_INTERVAL;
    this.gameEnded = false;
    this.startTime = performance.now();
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

    // 限制最大时间步长，防止切换标签页后物品穿墙
    const dt = Math.min((time - this.lastTime) / 1000, 0.05);
    this.lastTime = time;

    const elapsed = time - this.startTime;
    const remaining = this.config.duration - elapsed;
    if (remaining <= 0) {
      this.endGame();
      return;
    }

    this.update(dt, time);
    this.draw();

    this.animationId = requestAnimationFrame((t) => this.loop(t));
  }

  private update(dt: number, now: number): void {
    if (!this.canvas) return;

    // 游戏进度 0 ~ 1，用于动态调整难度
    const progress = Math.min((now - this.startTime) / this.config.duration, 1);
    const speedMultiplier = 1 + progress * 1.6;
    this.currentSpawnInterval = Math.max(
      MIN_SPAWN_INTERVAL,
      BASE_SPAWN_INTERVAL - progress * (BASE_SPAWN_INTERVAL - MIN_SPAWN_INTERVAL)
    );

    // 更新企鹅位置
    this.updatePenguin(dt, now);

    // 生成新物品
    this.spawnTimer += dt * 1000;
    while (this.spawnTimer >= this.currentSpawnInterval) {
      this.spawnTimer -= this.currentSpawnInterval;
      this.spawnItem(speedMultiplier);
    }

    // 更新物品位置并检测碰撞
    for (let i = this.items.length - 1; i >= 0; i--) {
      const item = this.items[i];
      item.y += item.speed * dt;
      item.rotation += item.rotSpeed * dt;

      if (this.checkCollision(item)) {
        this.collectItem(item, now);
        this.items.splice(i, 1);
        continue;
      }

      // 移除已落出屏幕的物品
      if (item.y > this.canvas.height + item.height) {
        this.items.splice(i, 1);
      }
    }

    // 更新雪花位置
    for (const flake of this.snowflakes) {
      flake.y += flake.speed * dt;
      if (flake.y > this.canvas.height + flake.radius) {
        flake.y = -flake.radius;
        flake.x = Math.random() * this.canvas.width;
      }
    }
  }

  private updatePenguin(dt: number, now: number): void {
    if (!this.canvas) return;

    const isStunned = now < this.penguin.stunnedUntil;
    if (!isStunned) {
      let direction = 0;
      if (this.keys.has('ArrowLeft') || this.keys.has('KeyA')) {
        direction -= 1;
      }
      if (this.keys.has('ArrowRight') || this.keys.has('KeyD')) {
        direction += 1;
      }

      // 键盘控制
      this.penguin.x += direction * this.penguin.speed * dt;

      // 鼠标/触摸控制：企鹅中心跟随指针位置
      if (this.pointerActive && this.penguin.targetX !== null) {
        const centerX = this.penguin.x + this.penguin.width / 2;
        const diff = this.penguin.targetX - centerX;
        const maxMove = this.penguin.speed * dt;
        if (Math.abs(diff) <= maxMove) {
          this.penguin.x = this.penguin.targetX - this.penguin.width / 2;
        } else {
          this.penguin.x += Math.sign(diff) * maxMove;
        }
      }
    }

    // 限制企鹅不超出画布左右边界
    this.penguin.x = Math.max(
      0,
      Math.min(this.canvas.width - this.penguin.width, this.penguin.x)
    );
  }

  private spawnItem(speedMultiplier: number): void {
    if (!this.canvas) return;

    const def = this.pickItemDef();
    const item: FallingItem = {
      x: Math.random() * (this.canvas.width - def.width),
      y: -def.height,
      width: def.width,
      height: def.height,
      speed: Math.min(
        BASE_ITEM_SPEED * (0.8 + Math.random() * 0.4) * speedMultiplier,
        MAX_ITEM_SPEED
      ),
      type: def.type,
      rotation: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 2.5,
    };
    this.items.push(item);
  }

  /**
   * 按权重随机选择一个物品类型。
   */
  private pickItemDef(): ItemDef {
    const totalWeight = ITEM_DEFS.reduce((sum, def) => sum + def.weight, 0);
    let r = Math.random() * totalWeight;
    for (const def of ITEM_DEFS) {
      r -= def.weight;
      if (r <= 0) {
        return def;
      }
    }
    return ITEM_DEFS[ITEM_DEFS.length - 1];
  }

  /**
   * AABB 碰撞检测：判断物品是否进入企鹅接宝范围。
   */
  private checkCollision(item: FallingItem): boolean {
    return (
      item.x < this.penguin.x + this.penguin.width &&
      item.x + item.width > this.penguin.x &&
      item.y < this.penguin.y + this.penguin.height &&
      item.y + item.height > this.penguin.y
    );
  }

  private collectItem(item: FallingItem, now: number): void {
    const def = ITEM_DEFS.find((d) => d.type === item.type);
    if (!def) return;

    this.score += def.score;
    if (def.stun) {
      this.penguin.stunnedUntil = now + def.stun;
    }

    this.onUpdate?.(this.score);
  }

  private initSnowflakes(): void {
    if (!this.canvas) return;

    this.snowflakes = [];
    for (let i = 0; i < SNOWFLAKE_COUNT; i++) {
      this.snowflakes.push({
        x: Math.random() * this.canvas.width,
        y: Math.random() * this.canvas.height,
        radius: Math.random() * 3 + 1,
        speed: Math.random() * 30 + 10,
      });
    }
  }

  private draw(): void {
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

    // 绘制雪花
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    for (const flake of this.snowflakes) {
      ctx.beginPath();
      ctx.arc(flake.x, flake.y, flake.radius, 0, Math.PI * 2);
      ctx.fill();
    }

    // 绘制掉落物品
    for (const item of this.items) {
      this.drawItem(ctx, item);
    }

    // 绘制企鹅
    this.drawPenguin(ctx);

    // 绘制 UI
    this.drawUI(ctx);
  }

  private drawPenguin(ctx: CanvasRenderingContext2D): void {
    const p = this.penguin;
    const cx = p.x + p.width / 2;
    const cy = p.y + p.height / 2;
    const now = performance.now();
    const isStunned = now < p.stunnedUntil;

    ctx.save();
    ctx.translate(cx, cy);

    // 眩晕时左右轻微抖动
    if (isStunned) {
      const shake = Math.sin(now / 40) * 3;
      ctx.translate(shake, 0);
    }

    // 白色椭圆身体
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(0, 0, p.width / 2, p.height / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#263238';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 黑色背部与翅膀
    ctx.fillStyle = '#263238';
    ctx.beginPath();
    ctx.ellipse(-4, -4, p.width / 2 - 10, p.height / 2 - 10, 0, Math.PI, Math.PI * 2);
    ctx.fill();

    // 眼睛
    ctx.fillStyle = '#263238';
    ctx.beginPath();
    ctx.arc(10, -10, 5, 0, Math.PI * 2);
    ctx.arc(-10, -10, 5, 0, Math.PI * 2);
    ctx.fill();

    // 橙色三角形嘴
    ctx.fillStyle = '#ff9800';
    ctx.beginPath();
    ctx.moveTo(0, 2);
    ctx.lineTo(-8, 14);
    ctx.lineTo(8, 14);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  private drawItem(ctx: CanvasRenderingContext2D, item: FallingItem): void {
    const cx = item.x + item.width / 2;
    const cy = item.y + item.height / 2;
    const half = Math.min(item.width, item.height) / 2;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(item.rotation);

    switch (item.type) {
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
        break;
      }
      case 'gold': {
        // 金色方块
        ctx.fillStyle = '#ffd700';
        ctx.fillRect(-half, -half, item.width, item.height);
        ctx.strokeStyle = '#f57f17';
        ctx.lineWidth = 2;
        ctx.strokeRect(-half, -half, item.width, item.height);
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
        break;
      }
      case 'ruby': {
        // 红色圆形宝石
        ctx.fillStyle = '#d32f2f';
        ctx.beginPath();
        ctx.arc(0, 0, half, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#b71c1c';
        ctx.lineWidth = 2;
        ctx.stroke();
        break;
      }
      case 'ice': {
        // 白色冰块
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(-half, -half, item.width, item.height);
        ctx.strokeStyle = '#b0bec5';
        ctx.lineWidth = 1;
        ctx.strokeRect(-half, -half, item.width, item.height);
        break;
      }
      case 'snowball': {
        // 白色雪球
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(0, 0, half, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#90a4ae';
        ctx.lineWidth = 1;
        ctx.stroke();
        break;
      }
      case 'mine': {
        // 黑色地雷 + 红色警示灯
        ctx.fillStyle = '#212121';
        ctx.beginPath();
        ctx.arc(0, 0, half, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#f44336';
        ctx.beginPath();
        ctx.arc(0, 0, half * 0.35, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
    }

    ctx.restore();
  }

  private drawUI(ctx: CanvasRenderingContext2D): void {
    const now = performance.now();
    const remaining = Math.max(0, this.config.duration - (now - this.startTime));
    const seconds = Math.ceil(remaining / 1000);

    ctx.font = 'bold 24px sans-serif';
    ctx.fillStyle = '#263238';
    ctx.textAlign = 'left';
    ctx.fillText(`得分: ${this.score}`, 20, 40);
    ctx.textAlign = 'right';
    ctx.fillText(`时间: ${seconds}s`, this.canvas!.width - 20, 40);

    // 眩晕提示
    if (now < this.penguin.stunnedUntil) {
      ctx.font = 'bold 20px sans-serif';
      ctx.fillStyle = '#d32f2f';
      ctx.textAlign = 'center';
      ctx.fillText('眩晕！', this.canvas!.width / 2, 80);
    }
  }

  private attachEvents(): void {
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    this.canvas?.addEventListener('pointerdown', this.handlePointerDown);
    this.canvas?.addEventListener('pointermove', this.handlePointerMove);
    this.canvas?.addEventListener('pointerup', this.handlePointerUp);
    this.canvas?.addEventListener('pointerleave', this.handlePointerUp);
    this.canvas?.addEventListener('pointercancel', this.handlePointerUp);
  }

  private detachEvents(): void {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    this.canvas?.removeEventListener('pointerdown', this.handlePointerDown);
    this.canvas?.removeEventListener('pointermove', this.handlePointerMove);
    this.canvas?.removeEventListener('pointerup', this.handlePointerUp);
    this.canvas?.removeEventListener('pointerleave', this.handlePointerUp);
    this.canvas?.removeEventListener('pointercancel', this.handlePointerUp);
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (
      e.code === 'ArrowLeft' ||
      e.code === 'ArrowRight' ||
      e.code === 'KeyA' ||
      e.code === 'KeyD'
    ) {
      this.keys.add(e.code);
    }
  };

  private handleKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private handlePointerDown = (e: PointerEvent): void => {
    if (!this.canvas) return;
    this.pointerActive = true;
    const rect = this.canvas.getBoundingClientRect();
    this.penguin.targetX = e.clientX - rect.left;
  };

  private handlePointerMove = (e: PointerEvent): void => {
    if (!this.canvas || !this.pointerActive) return;
    const rect = this.canvas.getBoundingClientRect();
    this.penguin.targetX = e.clientX - rect.left;
  };

  private handlePointerUp = (): void => {
    this.pointerActive = false;
    this.penguin.targetX = null;
  };

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
    return {
      type: this.config.type,
      score: this.score,
      coupons,
      duration: Math.round(duration),
    };
  }
}

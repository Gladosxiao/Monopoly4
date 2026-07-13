import type {
  IMiniGame,
  MiniGameConfig,
  MiniGameResult,
  MiniGameType,
} from '@monopoly4/shared';
import { BALLOON_CONFIG } from './balance/config.js';

/** 气球类型 */
type BalloonKind = 'normal' | 'double' | 'mystery';

/** 问号气球预定义效果 */
interface MysteryEffect {
  label: string;
  color: string;
}

/** 单个气球对象 */
interface Balloon {
  x: number;
  y: number;
  radius: number;
  speed: number;
  kind: BalloonKind;
  color: string;
  wobbleOffset: number;
  wobbleSpeed: number;
  popped: boolean;
  /** 普通/双倍气球上显示的分值（尺寸越小分值越高） */
  score: number;
  /** 问号气球预显示的具体效果 */
  effect?: MysteryEffect;
  /** 生成时间，用于计算反应时间 */
  spawnTime: number;
}

/** 粒子对象，用于气球爆炸效果 */
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

/** 浮动文字提示，用于显示随机效果 */
interface FloatingText {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  maxLife: number;
}

const GAME_TYPE: MiniGameType = 'balloon';

/** 普通气球颜色池 */
const NORMAL_COLORS = BALLOON_CONFIG.normalColors;
/** ×2 气球颜色 */
const DOUBLE_COLOR = BALLOON_CONFIG.doubleColor;
/** 问号气球颜色 */
const MYSTERY_COLOR = BALLOON_CONFIG.mysteryColor;

/** 问号气球效果池（生成时即确定，并在气球上预显示） */
const MYSTERY_EFFECTS: MysteryEffect[] = BALLOON_CONFIG.mysteryEffects.map((e) => ({
  label: e.label,
  color: e.color,
}));

/** 七彩气球小游戏 */
export class BalloonMiniGame implements IMiniGame {
  config: MiniGameConfig;

  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private balloons: Balloon[] = [];
  private particles: Particle[] = [];
  private floatingTexts: FloatingText[] = [];
  private score = 0;
  private startTime = 0;
  private endTime = 0;
  private lastSpawnTime = 0;
  private spawnInterval = 800;
  private timeScale = 1;
  private isRunning = false;
  private ended = false;
  private rafId = 0;
  private lastFrameTime = 0;

  // 过程指标采集
  private clickTimes: number[] = [];
  private hitTimes: number[] = [];
  private mouseMoves: { x: number; y: number; time: number }[] = [];
  private lastPointerPos: { x: number; y: number; time: number } | null = null;
  private hitBalloonSpawnTimes: number[] = [];

  onUpdate?: (score: number) => void;
  onEnd?: (result: MiniGameResult) => void;

  constructor(duration = 30000) {
    this.config = {
      type: GAME_TYPE,
      duration,
      canvasWidth: 800,
      canvasHeight: 600,
    };
  }

  /** 启动游戏，绑定 Canvas 与事件 */
  start(canvas: HTMLCanvasElement): void {
    if (this.isRunning) return;

    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    if (!this.ctx) return;

    canvas.width = this.config.canvasWidth;
    canvas.height = this.config.canvasHeight;

    this.score = 0;
    this.timeScale = 1;
    this.balloons = [];
    this.particles = [];
    this.floatingTexts = [];
    this.clickTimes = [];
    this.hitTimes = [];
    this.mouseMoves = [];
    this.lastPointerPos = null;
    this.hitBalloonSpawnTimes = [];
    this.startTime = performance.now();
    this.endTime = this.startTime + this.config.duration;
    this.lastSpawnTime = this.startTime;
    this.isRunning = true;

    canvas.addEventListener('pointerdown', this.handlePointerDown);
    canvas.addEventListener('pointermove', this.handlePointerMove);
    this.rafId = requestAnimationFrame(this.loop);
  }

  /** 停止游戏并返回结果 */
  stop(): MiniGameResult {
    if (this.ended) {
      return {
        type: GAME_TYPE,
        score: this.score,
        coupons: Math.min(this.score, 500),
        duration: Math.round(performance.now() - this.startTime),
        metrics: this.computeMetrics(),
      };
    }
    this.ended = true;
    this.cleanup();
    const duration = Math.round(performance.now() - this.startTime);
    const coupons = Math.min(this.score, 500);
    const result: MiniGameResult = {
      type: GAME_TYPE,
      score: this.score,
      coupons,
      duration,
      metrics: this.computeMetrics(),
    };
    this.onEnd?.(result);
    return result;
  }

  /** 计算并返回过程指标 */
  private computeMetrics() {
    const clickCount = this.clickTimes.length;
    const hitCount = this.hitTimes.length;

    // 平均鼠标移动速度（像素/毫秒）
    let totalMoveDist = 0;
    let totalMoveTime = 0;
    for (let i = 1; i < this.mouseMoves.length; i++) {
      const prev = this.mouseMoves[i - 1]!;
      const curr = this.mouseMoves[i]!;
      const dt = curr.time - prev.time;
      if (dt > 0 && dt < 100) {
        totalMoveDist += Math.hypot(curr.x - prev.x, curr.y - prev.y);
        totalMoveTime += dt;
      }
    }
    const avgMouseSpeed = totalMoveTime > 0 ? totalMoveDist / totalMoveTime : 0;

    // 平均点击间隔
    let avgTimeBetweenClicks = 0;
    if (this.clickTimes.length >= 2) {
      let total = 0;
      for (let i = 1; i < this.clickTimes.length; i++) {
        total += this.clickTimes[i]! - this.clickTimes[i - 1]!;
      }
      avgTimeBetweenClicks = total / (this.clickTimes.length - 1);
    }

    // 连续命中切换时间
    let avgBalloonSwitchTime = 0;
    if (this.hitTimes.length >= 2) {
      let total = 0;
      for (let i = 1; i < this.hitTimes.length; i++) {
        total += this.hitTimes[i]! - this.hitTimes[i - 1]!;
      }
      avgBalloonSwitchTime = total / (this.hitTimes.length - 1);
    }

    // 反应时间：从生成到被命中
    const avgReactionTime =
      this.hitBalloonSpawnTimes.length > 0
        ? this.hitBalloonSpawnTimes.reduce((a, b) => a + b, 0) / this.hitBalloonSpawnTimes.length
        : 0;

    return {
      clickCount,
      hitCount,
      accuracy: clickCount > 0 ? hitCount / clickCount : 0,
      avgMouseSpeed,
      avgTimeBetweenClicks,
      avgBalloonSwitchTime,
      avgReactionTime,
    };
  }

  private cleanup(): void {
    this.isRunning = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.canvas?.removeEventListener('pointerdown', this.handlePointerDown);
    this.canvas?.removeEventListener('pointermove', this.handlePointerMove);
  }

  private handlePointerDown = (e: PointerEvent): void => {
    if (!this.canvas || !this.isRunning) return;
    const now = performance.now();
    this.clickTimes.push(now);

    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    // 从后往前检测，优先命中上层气球
    for (let i = this.balloons.length - 1; i >= 0; i--) {
      const b = this.balloons[i];
      if (b.popped) continue;
      const dx = x - b.x;
      const dy = y - b.y;
      if (dx * dx + dy * dy <= b.radius * b.radius) {
        this.popBalloon(b, i, now);
        break;
      }
    }
  };

  private handlePointerMove = (e: PointerEvent): void => {
    if (!this.canvas || !this.isRunning) return;
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    this.mouseMoves.push({ x, y, time: performance.now() });
  };

  private popBalloon(balloon: Balloon, index: number, clickTime: number): void {
    balloon.popped = true;
    this.balloons.splice(index, 1);
    this.hitTimes.push(clickTime);
    this.hitBalloonSpawnTimes.push(clickTime - balloon.spawnTime);
    this.spawnParticles(balloon.x, balloon.y, balloon.color);

    switch (balloon.kind) {
      case 'normal': {
        this.score += balloon.score;
        this.addFloatingText(balloon.x, balloon.y, `+${balloon.score}`, '#fff');
        break;
      }
      case 'double': {
        this.score += balloon.score * 2;
        this.addFloatingText(balloon.x, balloon.y, `×2 +${balloon.score * 2}`, '#ffd700');
        break;
      }
      case 'mystery': {
        this.applyMysteryEffect(balloon);
        break;
      }
    }

    this.onUpdate?.(this.score);
  }

  /** 问号气球的随机效果（生成时已预显示在气球上） */
  private applyMysteryEffect(balloon: Balloon): void {
    const effect = balloon.effect ?? this.randomMysteryEffect();
    const cfg = BALLOON_CONFIG.mysteryEffects.find((e) => e.label === effect.label);
    let text = effect.label;

    if (cfg) {
      this.score += cfg.scoreDelta;
      this.timeScale = Math.max(0.5, Math.min(2.5, this.timeScale + cfg.timeScaleDelta));
      this.endTime -= cfg.timeDelta;

      switch (cfg.label) {
        case '+10': text = '+10'; break;
        case '-5': text = '-5'; break;
        case '▲': text = '加速'; break;
        case '▼': text = '减速'; break;
        case '⏳': text = '-5s'; break;
      }
    }

    if (this.score < 0) this.score = 0;
    this.addFloatingText(balloon.x, balloon.y, `? ${text}`, effect.color);
  }

  private randomMysteryEffect(): MysteryEffect {
    const total = BALLOON_CONFIG.mysteryEffects.reduce((a, e) => a + e.weight, 0);
    let r = Math.random() * total;
    for (const effect of BALLOON_CONFIG.mysteryEffects) {
      r -= effect.weight;
      if (r <= 0) return { label: effect.label, color: effect.color };
    }
    return { label: BALLOON_CONFIG.mysteryEffects[0].label, color: BALLOON_CONFIG.mysteryEffects[0].color };
  }

  private spawnParticles(x: number, y: number, color: string): void {
    const count = 8 + Math.floor(Math.random() * 6);
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
      const speed = 2 + Math.random() * 3;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 30,
        maxLife: 30,
        color,
        size: 2 + Math.random() * 3,
      });
    }
  }

  private addFloatingText(x: number, y: number, text: string, color: string): void {
    this.floatingTexts.push({
      x,
      y: y - 20,
      text,
      color,
      life: 40,
      maxLife: 40,
    });
  }

  private spawnBalloon(now: number): void {
    if (now - this.lastSpawnTime < this.spawnInterval / this.timeScale) return;
    this.lastSpawnTime = now;

    const radius = 24 + Math.random() * 12;
    const x = radius + Math.random() * (this.config.canvasWidth - radius * 2);
    const kindRoll = Math.random();
    let kind: BalloonKind;
    let color: string;
    let effect: MysteryEffect | undefined;
    let score = 0;
    let speed: number;

    if (kindRoll < BALLOON_CONFIG.kindWeights.double) {
      kind = 'double';
      color = DOUBLE_COLOR;
      // 双倍气球也遵循越小分越高
      score = Math.max(BALLOON_CONFIG.minBalloonScore, Math.round((BALLOON_CONFIG.radiusScoreOffset - radius) / BALLOON_CONFIG.radiusScoreStep));
      speed = BALLOON_CONFIG.doubleSpeed.min + Math.random() * (BALLOON_CONFIG.doubleSpeed.max - BALLOON_CONFIG.doubleSpeed.min);
    } else if (kindRoll < BALLOON_CONFIG.kindWeights.double + BALLOON_CONFIG.kindWeights.mystery) {
      kind = 'mystery';
      color = MYSTERY_COLOR;
      effect = this.randomMysteryEffect();
      speed = BALLOON_CONFIG.mysterySpeed.min + Math.random() * (BALLOON_CONFIG.mysterySpeed.max - BALLOON_CONFIG.mysterySpeed.min);
    } else {
      kind = 'normal';
      color = NORMAL_COLORS[Math.floor(Math.random() * NORMAL_COLORS.length)];
      // 越小分值越高、速度越快
      score = Math.max(BALLOON_CONFIG.minBalloonScore, Math.round((BALLOON_CONFIG.radiusScoreOffset - radius) / BALLOON_CONFIG.radiusScoreStep));
      speed = BALLOON_CONFIG.normalBaseSpeed + score * BALLOON_CONFIG.normalScoreSpeedFactor + Math.random() * BALLOON_CONFIG.normalRandomSpeedRange;
    }

    // 初始生成位置在屏幕中间区域，而非全部从底部冒出
    const y = this.config.canvasHeight * (BALLOON_CONFIG.spawnHeightRatio.min + Math.random() * (BALLOON_CONFIG.spawnHeightRatio.max - BALLOON_CONFIG.spawnHeightRatio.min));

    this.balloons.push({
      x,
      y,
      radius,
      speed,
      kind,
      color,
      wobbleOffset: Math.random() * Math.PI * 2,
      wobbleSpeed: 0.02 + Math.random() * 0.02,
      popped: false,
      score,
      effect,
      spawnTime: now,
    });
  }

  private loop = (now: number): void => {
    if (!this.ctx || !this.canvas || !this.isRunning) return;

    const dt = Math.min((now - (this.lastFrameTime ?? now)) / 16.67, 2);
    this.lastFrameTime = now;
    const remaining = Math.max(0, this.endTime - now);
    if (remaining <= 0) {
      this.stop();
      return;
    }

    this.spawnBalloon(now);

    // 更新气球位置
    for (let i = this.balloons.length - 1; i >= 0; i--) {
      const b = this.balloons[i];
      b.y -= b.speed * this.timeScale * dt;
      b.x += Math.sin(now * b.wobbleSpeed + b.wobbleOffset) * 0.5;
      if (b.y + b.radius < 0) {
        this.balloons.splice(i, 1);
      }
    }

    // 更新粒子
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.15;
      p.life -= 1;
      if (p.life <= 0) this.particles.splice(i, 1);
    }

    // 更新浮动文字
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const t = this.floatingTexts[i];
      t.y -= 30 * dt;
      t.life -= dt * 60;
      if (t.life <= 0) this.floatingTexts.splice(i, 1);
    }

    this.render(now, remaining);
    this.rafId = requestAnimationFrame(this.loop);
  };

  private render(now: number, remaining: number): void {
    if (!this.ctx || !this.canvas) return;
    const ctx = this.ctx;
    const width = this.config.canvasWidth;
    const height = this.config.canvasHeight;

    // 背景
    ctx.clearRect(0, 0, width, height);
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, '#87CEEB');
    gradient.addColorStop(1, '#E0F7FA');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    // 绘制气球
    this.balloons.forEach((b) => this.drawBalloon(ctx, b, now));

    // 绘制粒子
    this.particles.forEach((p) => {
      ctx.globalAlpha = p.life / p.maxLife;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    });

    // 绘制浮动文字
    this.floatingTexts.forEach((t) => {
      ctx.globalAlpha = Math.max(0, t.life / t.maxLife);
      ctx.fillStyle = t.color;
      ctx.font = 'bold 22px sans-serif';
      ctx.textAlign = 'center';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 4;
      ctx.strokeText(t.text, t.x, t.y);
      ctx.fillText(t.text, t.x, t.y);
      ctx.globalAlpha = 1;
    });

    // HUD
    ctx.fillStyle = '#1a1a2e';
    ctx.font = 'bold 24px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`得分: ${this.score}`, 16, 36);
    ctx.fillText(`时间: ${(remaining / 1000).toFixed(1)}s`, 16, 68);
  }

  private drawBalloon(ctx: CanvasRenderingContext2D, b: Balloon, now: number): void {
    const wobbleX = Math.sin(now * b.wobbleSpeed + b.wobbleOffset) * 4;
    const x = b.x + wobbleX;

    // 绳子
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, b.y + b.radius);
    ctx.quadraticCurveTo(x + Math.sin(now * 0.01) * 6, b.y + b.radius + 20, x, b.y + b.radius + 36);
    ctx.stroke();

    // 气球本体（带高光）
    ctx.fillStyle = b.color;
    ctx.beginPath();
    ctx.ellipse(x, b.y, b.radius, b.radius * 1.15, 0, 0, Math.PI * 2);
    ctx.fill();

    // 气球底部小三角
    ctx.beginPath();
    ctx.moveTo(x - 6, b.y + b.radius * 1.1);
    ctx.lineTo(x + 6, b.y + b.radius * 1.1);
    ctx.lineTo(x, b.y + b.radius * 1.1 + 8);
    ctx.closePath();
    ctx.fill();

    // 高光
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.beginPath();
    ctx.ellipse(x - b.radius * 0.25, b.y - b.radius * 0.25, b.radius * 0.22, b.radius * 0.32, -0.4, 0, Math.PI * 2);
    ctx.fill();

    // 特殊标识 / 分值 / 问号效果
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.max(14, b.radius * 0.55)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (b.kind === 'double') {
      ctx.fillText('×2', x, b.y);
    } else if (b.kind === 'mystery') {
      // 问号气球直接显示其预定义效果标签
      ctx.fillText(b.effect?.label ?? '?', x, b.y);
    } else {
      ctx.fillText(`+${b.score}`, x, b.y);
    }
  }
}

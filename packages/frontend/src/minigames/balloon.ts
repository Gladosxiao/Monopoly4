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
  /** 基础位置：用于碰撞判定 / 浮出屏外检测，游戏规则完全依赖此值 */
  x: number;
  y: number;
  radius: number;
  speed: number;
  kind: BalloonKind;
  color: string;
  popped: boolean;
  /** 普通/双倍气球上显示的分值（尺寸越小分值越高） */
  score: number;
  /** 问号气球预显示的具体效果 */
  effect?: MysteryEffect;
  /** 生成时间，用于计算反应时间 */
  spawnTime: number;

  /* ---------- 飘动动画参数（纯视觉） ---------- */
  /** 横向主漂移：双层正弦中的"慢大"分量 */
  driftAmpX: number;
  driftFreqX: number;
  driftPhaseX: number;
  /** 横向次漂移："快小"分量，叠加产生非周期感 */
  driftAmpX2: number;
  driftFreqX2: number;
  driftPhaseX2: number;
  /** 上下起伏 */
  bobAmp: number;
  bobFreq: number;
  bobPhase: number;
  /** 倾斜（弧度） */
  tiltAmp: number;
  tiltFreq: number;
  tiltPhase: number;
  /** 缩放呼吸感 */
  scaleAmp: number;
  scaleFreq: number;
  scalePhase: number;
  /** 绳子滞后控制点频率（比气球漂移更慢，模拟物理惯性） */
  stringControlFreq: number;
  stringControlPhase: number;
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
  private scoreMultiplier = 1;

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

  /** 应用个性化得分倍率（由标定结果计算） */
  applyScoreMultiplier(multiplier: number): void {
    this.scoreMultiplier = Math.max(0.1, Math.min(5.0, multiplier));
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
    const rawScore = Math.round(this.score * this.scoreMultiplier);
    const finalScore = Math.max(0, rawScore);
    if (this.ended) {
      return {
        type: GAME_TYPE,
        score: finalScore,
        coupons: Math.min(finalScore, 500),
        duration: Math.round(performance.now() - this.startTime),
        metrics: this.computeMetrics(),
      };
    }
    this.ended = true;
    this.cleanup();
    const duration = Math.round(performance.now() - this.startTime);
    const coupons = Math.min(finalScore, 500);
    const result: MiniGameResult = {
      type: GAME_TYPE,
      score: finalScore,
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
      // 点击判定范围扩大到 1.5 倍半径，提升操作容错率
      const hitRadius = b.radius * 1.5;
      if (dx * dx + dy * dy <= hitRadius * hitRadius) {
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
      effect = this.randomMysteryEffect();
      // 加速/减速气球使用醒目颜色，其余保持紫色
      if (effect.label === '▲') {
        color = BALLOON_CONFIG.speedUpColor;
      } else if (effect.label === '▼') {
        color = BALLOON_CONFIG.slowDownColor;
      } else {
        color = MYSTERY_COLOR;
      }
      speed = BALLOON_CONFIG.mysterySpeed.min + Math.random() * (BALLOON_CONFIG.mysterySpeed.max - BALLOON_CONFIG.mysterySpeed.min);
    } else {
      kind = 'normal';
      color = NORMAL_COLORS[Math.floor(Math.random() * NORMAL_COLORS.length)];
      // 越小分值越高、速度越快
      score = Math.max(BALLOON_CONFIG.minBalloonScore, Math.round((BALLOON_CONFIG.radiusScoreOffset - radius) / BALLOON_CONFIG.radiusScoreStep));
      speed = BALLOON_CONFIG.normalBaseSpeed + score * BALLOON_CONFIG.normalScoreSpeedFactor + Math.random() * BALLOON_CONFIG.normalRandomSpeedRange;
    }

    // 开场阶段从屏幕中部生成，之后从底部刷新
    const elapsed = now - this.startTime;
    const spawnRatio =
      elapsed < BALLOON_CONFIG.introDurationMs
        ? BALLOON_CONFIG.introSpawnHeightRatio
        : BALLOON_CONFIG.mainSpawnHeightRatio;
    const y = this.config.canvasHeight * (spawnRatio.min + Math.random() * (spawnRatio.max - spawnRatio.min));

    const anim = BALLOON_CONFIG.animation;
    const randIn = (range: { min: number; max: number }) =>
      range.min + Math.random() * (range.max - range.min);

    this.balloons.push({
      x,
      y,
      radius,
      speed,
      kind,
      color,
      popped: false,
      score,
      effect,
      spawnTime: now,
      // 飘动动画：每个气球随机一组相位 / 频率 / 振幅，整体节奏错开
      driftAmpX: randIn(anim.driftAmpX),
      driftFreqX: randIn(anim.driftFreqX),
      driftPhaseX: Math.random() * Math.PI * 2,
      driftAmpX2: randIn(anim.driftAmpX2),
      driftFreqX2: randIn(anim.driftFreqX2),
      driftPhaseX2: Math.random() * Math.PI * 2,
      bobAmp: randIn(anim.bobAmp),
      bobFreq: randIn(anim.bobFreq),
      bobPhase: Math.random() * Math.PI * 2,
      tiltAmp: randIn(anim.tiltAmp),
      tiltFreq: randIn(anim.tiltFreq),
      tiltPhase: Math.random() * Math.PI * 2,
      scaleAmp: anim.scaleAmp,
      scaleFreq: randIn(anim.scaleFreq),
      scalePhase: Math.random() * Math.PI * 2,
      stringControlFreq: randIn(anim.stringControlFreq),
      stringControlPhase: Math.random() * Math.PI * 2,
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

    // 更新气球位置：仅推进基础 y，x 永远保持在 spawn 时的水平基线。
    // 视觉上的左右飘动、上下起伏、倾斜、缩放全部交给 drawBalloon 在渲染时
    // 基于 now 实时计算，避免对 b.x / b.y 的累加污染碰撞 / 越界判定。
    for (let i = this.balloons.length - 1; i >= 0; i--) {
      const b = this.balloons[i];
      b.y -= b.speed * this.timeScale * dt;
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
    // ----- 计算视觉偏移 / 姿态（纯视觉，不修改 b.x / b.y）-----
    // 1. 横向漂移：双层正弦叠加（慢大幅 + 快小幅），破坏周期性
    const driftX =
      Math.sin(now * b.driftFreqX + b.driftPhaseX) * b.driftAmpX +
      Math.sin(now * b.driftFreqX2 + b.driftPhaseX2) * b.driftAmpX2;
    // 2. 上下起伏：模拟空气浮力 / 阻力的微小上下浮动
    const bobY = Math.sin(now * b.bobFreq + b.bobPhase) * b.bobAmp;
    // 3. 倾斜：气球随气流摆动，视觉上像被风吹歪
    const tilt = Math.sin(now * b.tiltFreq + b.tiltPhase) * b.tiltAmp;
    // 4. 缩放：轻微呼吸感（远近 / 形变）
    const scale = 1 + Math.sin(now * b.scaleFreq + b.scalePhase) * b.scaleAmp;

    // 视觉中心 = 基础位置 + 视觉偏移
    const vx = b.x + driftX;
    const vy = b.y + bobY;
    // 气球底部三角下端（绳子锚点）
    const tipY = b.y + b.radius * 1.1 + 8;

    // 绳子摆动信号：使用比气球主漂移更慢的频率，模拟物理滞后；
    // 越接近绳子底端，振幅衰减越大。
    const stringT = now * b.stringControlFreq + b.stringControlPhase;
    const stringSignal =
      Math.sin(stringT) * b.driftAmpX * 0.5 +
      Math.sin(stringT * 1.35 + 1.2) * b.driftAmpX2 * 0.4;

    // ----- 绳子（在变换外绘制，气球倾斜时绳子不会硬跟着转）-----
    const stringLen = BALLOON_CONFIG.animation.stringBaseLen;
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(vx, tipY);
    ctx.bezierCurveTo(
      vx + stringSignal * 0.55, tipY + stringLen * 0.30,
      vx + stringSignal * 0.30, tipY + stringLen * 0.70,
      vx + stringSignal * 0.10, tipY + stringLen
    );
    ctx.stroke();

    // ----- 气球本体（应用倾斜 + 缩放）-----
    ctx.save();
    ctx.translate(vx, vy);
    ctx.rotate(tilt);
    ctx.scale(scale, scale);

    // 气球本体
    ctx.fillStyle = b.color;
    ctx.beginPath();
    ctx.ellipse(0, 0, b.radius, b.radius * 1.15, 0, 0, Math.PI * 2);
    ctx.fill();

    // 气球底部小三角
    ctx.beginPath();
    ctx.moveTo(-6, b.radius * 1.1);
    ctx.lineTo(6, b.radius * 1.1);
    ctx.lineTo(0, b.radius * 1.1 + 8);
    ctx.closePath();
    ctx.fill();

    // 高光
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.beginPath();
    ctx.ellipse(
      -b.radius * 0.25,
      -b.radius * 0.25,
      b.radius * 0.22,
      b.radius * 0.32,
      -0.4,
      0,
      Math.PI * 2
    );
    ctx.fill();

    // 特殊标识 / 分值 / 问号效果
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.max(14, b.radius * 0.55)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (b.kind === 'double') {
      ctx.fillText('×2', 0, 0);
    } else if (b.kind === 'mystery') {
      // 问号气球直接显示其预定义效果标签
      ctx.fillText(b.effect?.label ?? '?', 0, 0);
    } else {
      ctx.fillText(`+${b.score}`, 0, 0);
    }

    ctx.restore();
  }
}

/* PVOGame.ru — многослойный рендерер: terrain / world / effects / interaction.
   Станция — визуальный центр; HUD остаётся читаемым; эффекты не мешают геймплею. */

import { FIELD, RENDER } from './config.js';
import { clamp, lerp, rgba, TAU, makeRng, hash1D } from './utils.js';

export class Renderer {
  constructor(layers) {
    // layers: { terrain, world, effects, interaction } — HTMLCanvasElement
    this.layers = layers;
    this.ctxs = {};
    for (const [k, c] of Object.entries(layers)) this.ctxs[k] = c.getContext('2d');
    this.dpr = 1;
    this.view = { w: 800, h: 600 };
    this.scale = 0.4;              // мировых единиц -> экран пиксель (fit)
    this.quality = 'high';
    this.ambientRng = makeRng(4242);
    this.ambient = Array.from({ length: 26 }, () => ({
      x: this.ambientRng() * 2 - 1, y: this.ambientRng() * 2 - 1,
      s: 0.05 + this.ambientRng() * 0.15, p: this.ambientRng() * TAU
    }));
  }

  resize(cssW, cssH, dprCap) {
    this.dpr = Math.min(window.devicePixelRatio || 1, dprCap);
    this.view.w = cssW; this.view.h = cssH;
    for (const c of Object.values(this.layers)) {
      c.width = Math.round(cssW * this.dpr);
      c.height = Math.round(cssH * this.dpr);
      c.style.width = cssW + 'px';
      c.style.height = cssH + 'px';
    }
    // Масштаб: весь сектор помещается по минимальной стороне
    this.scale = Math.min(cssW, cssH) / (FIELD.rings[0].radius * 2.3);
  }

  /* мировые координаты -> экранные */
  toScreen(x, y) {
    return [this.view.w / 2 + x * this.scale, this.view.h / 2 + y * this.scale];
  }
  toWorld(sx, sy) {
    return [(sx - this.view.w / 2) / this.scale, (sy - this.view.h / 2) / this.scale];
  }

  /* ── Слой 1: местность (кэш-изображение, перерисовка редкая) ──── */
  drawTerrain(terrainCacheCanvas) {
    const ctx = this.ctxs.terrain;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.view.w, this.view.h);
    ctx.fillStyle = '#070f1c';
    ctx.fillRect(0, 0, this.view.w, this.view.h);
    if (!terrainCacheCanvas) return;
    // Кэш растеризован под «мировой» размер; рисуем с тем же scale что и мир
    const worldPx = FIELD.worldSize * this.scale;
    ctx.globalAlpha = 0.9;
    ctx.imageSmoothingEnabled = this.quality !== 'low';
    ctx.drawImage(terrainCacheCanvas,
      this.view.w / 2 - worldPx / 2, this.view.h / 2 - worldPx / 2, worldPx, worldPx);
    ctx.globalAlpha = 1;
  }

  /* ── Слой 2: мир (станция, кольца, модули, цели, декор) ───────── */
  drawWorld(state) {
    const ctx = this.ctxs.world;
    const { gameTime, station, targets, modules, obstacles, focusEffect, stress, a11y, showRings, placement } = state;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.view.w, this.view.h);

    const cx = this.view.w / 2, cy = this.view.h / 2;
    const glow = RENDER.glowEnabled[this.quality] && !a11y.reduceVisualStress;

    /* Кольца зон */
    if (showRings) {
      for (let i = 0; i < FIELD.rings.length; i++) {
        const ring = FIELD.rings[i];
        const r = ring.radius * this.scale;
        ctx.strokeStyle = rgba(ring.color, 0.22 + i * 0.04);
        ctx.lineWidth = 1;
        ctx.setLineDash(i === 0 ? [4, 8] : []);
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke();
        ctx.setLineDash([]);
        // подпись кольца
        ctx.fillStyle = rgba(ring.color, 0.5);
        ctx.font = `${Math.max(10, 11 * (a11y.uiScale || 1))}px system-ui`;
        ctx.fillText(ring.name, cx + r * 0.71, cy - r * 0.71);
      }
    }

    /* Декоративные препятствия (world layer, ниже станции по z) */
    if (obstacles) {
      for (const o of obstacles.items) {
        const [sx, sy] = this.toScreen(o.x, o.y);
        if (sx < -40 || sy < -40 || sx > this.view.w + 40 || sy > this.view.h + 40) continue;
        this._drawObstacle(ctx, o, sx, sy, gameTime, a11y);
      }
    }

    /* Модули */
    for (const m of modules) this._drawModule(ctx, m, gameTime, glow);

    /* Цели */
    const priorityMode = focusEffect?.highlightPriority;
    for (const t of targets) {
      if (!t.alive) continue;
      let alpha = 1;
      if (priorityMode) {
        alpha = t.priorityScore > 45 ? 1 : (1 - focusEffect.dimOthers);
      }
      this._drawTarget(ctx, t, gameTime, glow, alpha, a11y);
    }

    /* Станция — композиционный центр */
    this._drawStation(ctx, station, gameTime, glow, a11y, !!focusEffect?.clearVisuals, stress);

    /* Призрачный курсор размещения */
    if (placement?.active) {
      const [sx, sy] = this.toScreen(placement.x, placement.y);
      const def = placement.def;
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = placement.valid ? def.color : '#ff5577';
      ctx.fillStyle = rgba(placement.valid ? def.color : '#ff5577', 0.12);
      ctx.beginPath(); ctx.arc(sx, sy, 16, 0, TAU); ctx.fill(); ctx.stroke();
      if (def.range) {
        ctx.setLineDash([5, 7]);
        ctx.beginPath(); ctx.arc(sx, sy, def.range * this.scale, 0, TAU); ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.globalAlpha = 1;
    }
  }

  _drawObstacle(ctx, o, sx, sy, gameTime, a11y) {
    const s = o.size * this.scale * 1.6;
    const bob = a11y.reducedMotion ? 0 : Math.sin(gameTime * 0.5 + o.phase) * 2;
    ctx.save();
    ctx.translate(sx, sy + bob);
    ctx.rotate(o.rot);
    ctx.globalAlpha = 0.55;
    const col = o.def.color;
    switch (o.typeId) {
      case 'prismCluster': {
        for (let i = 0; i < 3; i++) {
          ctx.fillStyle = rgba(col, 0.25);
          ctx.strokeStyle = rgba(col, 0.6);
          ctx.beginPath();
          const h = s * (0.7 + i * 0.25), w = s * 0.35;
          ctx.moveTo(-w + i * w * 0.7, 0); ctx.lineTo(i * w * 0.7, -h); ctx.lineTo(w + i * w * 0.7, 0);
          ctx.closePath(); ctx.fill(); ctx.stroke();
        }
        break;
      }
      case 'echoPillar':
        ctx.fillStyle = rgba(col, 0.3); ctx.strokeStyle = rgba(col, 0.55);
        ctx.fillRect(-s * 0.18, -s * 1.4, s * 0.36, s * 1.4);
        ctx.strokeRect(-s * 0.18, -s * 1.4, s * 0.36, s * 1.4);
        break;
      case 'fracturedShard':
        ctx.fillStyle = rgba(col, 0.3); ctx.strokeStyle = rgba(col, 0.6);
        ctx.beginPath();
        ctx.moveTo(0, -s); ctx.lineTo(s * 0.5, -s * 0.2); ctx.lineTo(s * 0.1, s * 0.4); ctx.lineTo(-s * 0.45, 0);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        break;
      case 'lumenArch':
        ctx.strokeStyle = rgba(col, 0.5); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, s, Math.PI, TAU); ctx.stroke();
        break;
      case 'driftStone':
        ctx.fillStyle = rgba(col, 0.28);
        ctx.beginPath(); ctx.ellipse(0, 0, s * 0.6, s * 0.4, 0, 0, TAU); ctx.fill();
        break;
      case 'signalReef': {
        ctx.strokeStyle = rgba(col, 0.45); ctx.lineWidth = 1.5;
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI + o.phase;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * s * 0.2, Math.sin(a) * s * 0.2);
          ctx.lineTo(Math.cos(a) * s * 0.9, Math.sin(a) * s * 0.35 - s * 0.4);
          ctx.stroke();
        }
        break;
      }
      default: break;
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  _drawStation(ctx, station, gameTime, glow, a11y, clarity, stress) {
    const [cx, cy] = this.toScreen(0, 0);
    const ratio = station.integrityRatio;
    const baseR = FIELD.stationSafeRadius * this.scale * 0.62;
    const calmPulse = a11y.reducedMotion ? 0.5 : 0.5 + Math.sin(station.pulsePhase * (a11y.reduceVisualStress ? 0.5 : 1)) * 0.5;

    // Концентрические орбитальные формы
    ctx.save();
    ctx.translate(cx, cy);
    const ringsN = 4;
    for (let i = ringsN; i >= 1; i--) {
      const r = baseR * (0.35 + i * 0.2);
      ctx.strokeStyle = clarity
        ? `rgba(201,184,255,${0.5})`
        : rgba(mixColorByIntegrity(ratio), 0.28 + calmPulse * 0.12);
      ctx.lineWidth = clarity ? 1.6 : 1.2;
      ctx.beginPath();
      ctx.arc(0, 0, r, gameTime * 0.1 * (i % 2 ? 1 : -1), gameTime * 0.1 * (i % 2 ? 1 : -1) + TAU * 0.72);
      ctx.stroke();
    }

    // Корпус: шестиугольник-платформа
    ctx.fillStyle = '#0e1e33';
    ctx.strokeStyle = rgba(mixColorByIntegrity(ratio), 0.8);
    ctx.lineWidth = 2;
    hexPath(ctx, 0, 0, baseR * 0.62);
    ctx.fill(); ctx.stroke();

    // Энергоядро: цвет/яркость зависят от Energy и Integrity
    const coreColor = mixColorByIntegrity(ratio);
    const energyT = clamp(station.energyRatio ?? 1, 0, 1);
    const coreR = baseR * (0.2 + 0.08 * calmPulse + 0.05 * energyT);
    if (glow) {
      const g = ctx.createRadialGradient(0, 0, 1, 0, 0, coreR * 4);
      g.addColorStop(0, rgba(coreColor, 0.5 + calmPulse * 0.25));
      g.addColorStop(1, rgba(coreColor, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, coreR * 4, 0, TAU); ctx.fill();
    }
    ctx.fillStyle = clarity ? '#e8f6ff' : coreColor;
    ctx.beginPath(); ctx.arc(0, 0, coreR, 0, TAU); ctx.fill();

    // Трещины при низкой целостности (мягкие, без мерцания)
    if (ratio < 0.5 && !clarity) {
      ctx.strokeStyle = `rgba(255,90,120,${(0.5 - ratio) * 0.9})`;
      ctx.lineWidth = 1;
      for (let i = 0; i < 4; i++) {
        const a = hash1D(i * 7 + 3, 99) * TAU;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * coreR, Math.sin(a) * coreR);
        ctx.lineTo(Math.cos(a + 0.3) * baseR * 0.6, Math.sin(a + 0.3) * baseR * 0.6);
        ctx.stroke();
      }
    }

    // Щит Guardian Node
    if (station.shieldPool > 0.5) {
      ctx.strokeStyle = `rgba(122,240,200,${clamp(station.shieldPool / 40, 0.1, 0.5)})`;
      ctx.setLineDash([3, 6]);
      ctx.beginPath(); ctx.arc(0, 0, baseR * 1.15, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
    }

    // Вспышка попадания — мягкое свечение, не белая вспышка
    const sinceHit = gameTime - station.lastHitAt;
    if (sinceHit < 0.5 && !a11y.reduceVisualStress && !clarity) {
      ctx.fillStyle = `rgba(255,107,138,${0.22 * (1 - sinceHit / 0.5)})`;
      ctx.beginPath(); ctx.arc(0, 0, baseR * 1.3, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  _drawModule(ctx, m, gameTime, glow) {
    const [sx, sy] = this.toScreen(m.x, m.y);
    const col = m.def.color;
    ctx.save();
    ctx.translate(sx, sy);
    // База
    ctx.fillStyle = '#10233c';
    ctx.strokeStyle = rgba(col, 0.85);
    ctx.lineWidth = 1.6;
    hexPath(ctx, 0, 0, 13);
    ctx.fill(); ctx.stroke();
    // Иконка-символ роли
    ctx.fillStyle = rgba(col, 0.95);
    ctx.font = '12px system-ui';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(m.def.icon, 0, 1);
    // Уровень — точки
    for (let i = 0; i < m.level - 1; i++) {
      ctx.beginPath(); ctx.arc(-8 + i * 8, 17, 2, 0, TAU);
      ctx.fillStyle = col; ctx.fill();
    }
    // Кулдаун-дуга
    if (m.cooldownMax > 0 && m.cooldownLeft > 0) {
      const t = 1 - m.cooldownLeft / m.cooldownMax;
      ctx.strokeStyle = rgba(col, 0.6);
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, 17, -Math.PI / 2, -Math.PI / 2 + TAU * t); ctx.stroke();
    }
    // Выстрел-вспышка
    if (m.fireFlash > 0 && glow) {
      ctx.fillStyle = rgba(col, m.fireFlash * 0.35);
      ctx.beginPath(); ctx.arc(0, 0, 20, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  _drawTarget(ctx, t, gameTime, glow, alpha, a11y) {
    const [sx, sy] = this.toScreen(t.x, t.y);
    const size = t.size * clamp(this.scale * 2.2, 0.55, 1.4);
    const col = t.def.color;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(t.angle);
    ctx.globalAlpha = alpha * (t.revealed ? 1 : 0.4);

    if (!t.revealed && t.phantom) {
      // нераскрытый фантом — размытое пятно с вопросительным знаком
      ctx.fillStyle = rgba(col, 0.35);
      ctx.beginPath(); ctx.arc(0, 0, size, 0, TAU); ctx.fill();
      ctx.fillStyle = '#dbe9ff';
      ctx.font = `${Math.round(size)}px system-ui`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('?', 0, 1);
      ctx.restore();
      return;
    }

    if (glow && !a11y.reduceVisualStress) {
      ctx.shadowColor = rgba(col, 0.6);
      ctx.shadowBlur = size * 0.9;
    }
    ctx.fillStyle = rgba(col, 0.85);
    ctx.strokeStyle = '#0a1626';
    ctx.lineWidth = 1;

    switch (t.def.shape) {
      case 'dart':
        triPath(ctx, size); ctx.fill(); ctx.stroke(); break;
      case 'triad': {
        for (let i = 0; i < 3; i++) {
          ctx.save(); ctx.rotate(i * TAU / 3); ctx.translate(size * 0.7, 0);
          smallTri(ctx, size * 0.5); ctx.fill(); ctx.restore();
        }
        break;
      }
      case 'hex':
        hexPath(ctx, 0, 0, size); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = '#0a1626';
        hexPath(ctx, 0, 0, size * 0.55); ctx.stroke(); break;
      case 'ghost':
        ctx.globalAlpha *= 0.8;
        ghostPath(ctx, size); ctx.fill(); break;
      case 'spark': {
        sparkPath(ctx, size, gameTime + t.phase); ctx.fill(); break;
      }
      default:
        ctx.beginPath(); ctx.arc(0, 0, size, 0, TAU); ctx.fill();
    }
    ctx.shadowBlur = 0;

    // Полоска HP
    if (t.hp < t.maxHp) {
      ctx.rotate(-t.angle);
      ctx.fillStyle = 'rgba(8,16,28,0.8)';
      ctx.fillRect(-size, -size - 8, size * 2, 3.5);
      ctx.fillStyle = col;
      ctx.fillRect(-size, -size - 8, size * 2 * (t.hp / t.maxHp), 3.5);
    }
    // Маркер замедления
    if (t.slowFactor < 1) {
      ctx.rotate(-t.angle);
      ctx.strokeStyle = 'rgba(184,146,255,0.8)';
      ctx.beginPath(); ctx.arc(0, 0, size + 4, 0, TAU); ctx.stroke();
    }
    ctx.restore();
  }

  /* ── Слой 3: эффекты (выстрелы, частицы, импульсы) ────────────── */
  drawEffects(effects, particles) {
    const ctx = this.ctxs.effects;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.view.w, this.view.h);

    for (const e of effects) {
      if (e.kind === 'arc-shot') {
        const [x1, y1] = this.toScreen(e.x1, e.y1);
        const [x2, y2] = this.toScreen(e.x2, e.y2);
        ctx.strokeStyle = rgba(e.color, 0.9);
        ctx.lineWidth = 2;
        ctx.beginPath();
        // ломаная «молния» из 3 сегментов
        const mx = (x1 + x2) / 2 + (Math.random() - 0.5) * 14;
        const my = (y1 + y2) / 2 + (Math.random() - 0.5) * 14;
        ctx.moveTo(x1, y1); ctx.lineTo(mx, my); ctx.lineTo(x2, y2);
        ctx.stroke();
      } else if (e.kind === 'pulse-wave' || e.kind === 'veil-pulse') {
        const [x, y] = this.toScreen(e.x, e.y);
        ctx.strokeStyle = rgba(e.color || '#b892ff', 0.5 * e.life);
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, e.r * this.scale * (1 - e.life), 0, TAU); ctx.stroke();
      } else if (e.kind === 'reveal') {
        const [x, y] = this.toScreen(e.x, e.y);
        ctx.fillStyle = 'rgba(58,217,255,0.8)';
        ctx.font = '11px system-ui'; ctx.textAlign = 'center';
        ctx.fillText('РАСКРЫТ', x, y - 14);
      }
    }

    for (const p of particles.items) {
      const [x, y] = this.toScreen(p.x, p.y);
      const a = p.life / p.maxLife;
      if (p.ring) {
        ctx.strokeStyle = rgba(p.color, a * 0.7);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, lerp(p.r0, p.r1, 1 - a) * this.scale, 0, TAU);
        ctx.stroke();
      } else {
        ctx.fillStyle = rgba(p.color, a);
        ctx.beginPath(); ctx.arc(x, y, p.size * a + 0.5, 0, TAU); ctx.fill();
      }
    }
  }

  /* ── Слой 4: interaction (фокус-оверлеи, шум, выделение, debug) ─ */
  drawInteraction(state) {
    const ctx = this.ctxs.interaction;
    const { focusOverlay, uiNoise, selected, hoverTarget, debug, a11y, gameTime, panicState } = state;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.view.w, this.view.h);
    const W = this.view.w, H = this.view.h;

    /* Выбранный модуль: радиус */
    if (selected) {
      const [sx, sy] = this.toScreen(selected.x, selected.y);
      ctx.strokeStyle = rgba(selected.def.color, 0.5);
      ctx.setLineDash([6, 6]);
      ctx.lineDashOffset = a11y.reducedMotion ? 0 : -gameTime * 12;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(sx, sy, selected.effectiveRange(state.auraProviders || []) * this.scale, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]); ctx.lineDashOffset = 0;
    }

    /* Hover-инфо о цели */
    if (hoverTarget && hoverTarget.alive) {
      const [sx, sy] = this.toScreen(hoverTarget.x, hoverTarget.y);
      ctx.strokeStyle = 'rgba(219,233,255,0.7)';
      ctx.lineWidth = 1;
      crosshair(ctx, sx, sy, 18);
      ctx.fillStyle = 'rgba(219,233,255,0.9)';
      ctx.font = '11px system-ui'; ctx.textAlign = 'left';
      const name = hoverTarget.revealed ? hoverTarget.def.name : 'Неопознанный сигнал';
      ctx.fillText(`${name} · ${Math.ceil(hoverTarget.hp)}/${Math.ceil(hoverTarget.maxHp)}`, sx + 22, sy - 6);
    }

    /* Фокус-режимы: художественные оверлеи */
    if (focusOverlay) {
      const o = focusOverlay;
      if (o.type === 'veil') {
        ctx.fillStyle = rgba(o.color, o.alpha);
        ctx.fillRect(0, 0, W, H);
        if (o.scanlines) drawScanlines(ctx, W, H, 0.05);
        if (o.vignette) drawVignette(ctx, W, H, rgba(o.color, 0.25));
      } else if (o.type === 'frame') {
        ctx.strokeStyle = rgba(o.color, o.alpha);
        ctx.lineWidth = 2;
        cornerMarks(ctx, W, H, 26);
        if (o.pulse > 0) {
          const pulse = a11y.reducedMotion ? 0.5 : 0.5 + Math.sin(gameTime * 2.4) * 0.5;
          ctx.strokeStyle = rgba(o.color, 0.15 + pulse * 0.15 * o.pulse);
          ctx.strokeRect(8, 8, W - 16, H - 16);
        }
      } else if (o.type === 'breath') {
        drawVignette(ctx, W, H, rgba(o.color, o.alpha));
        const [cx, cy] = this.toScreen(0, 0);
        ctx.strokeStyle = rgba(o.color, 0.2);
        ctx.beginPath(); ctx.arc(cx, cy, Math.min(W, H) * 0.42 * o.ringScale, 0, TAU); ctx.stroke();
      } else if (o.type === 'clarity') {
        ctx.fillStyle = rgba(o.color, o.alpha * 0.5);
        ctx.fillRect(0, 0, W, H);
        if (o.cleanSweep) {
          const sweepX = (o.progress || 0) * W;
          const g = ctx.createLinearGradient(sweepX - 60, 0, sweepX + 60, 0);
          g.addColorStop(0, 'rgba(201,184,255,0)');
          g.addColorStop(0.5, 'rgba(201,184,255,0.10)');
          g.addColorStop(1, 'rgba(201,184,255,0)');
          ctx.fillStyle = g; ctx.fillRect(sweepX - 60, 0, 120, H);
        }
      }
    }

    /* Шум интерфейса от стресса — очень мягкий, без мерцания */
    if (uiNoise > 0.02 && !a11y.reduceVisualStress && panicState !== 'recovery') {
      drawSoftNoise(ctx, W, H, uiNoise, gameTime, a11y.reducedMotion);
    }

    /* Debug-оверлеи */
    if (debug) {
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.font = '11px monospace'; ctx.textAlign = 'left';
      ctx.fillText(`FPS ${state.fps || '--'} | scale ${this.scale.toFixed(3)} | dpr ${this.dpr.toFixed(2)}`, 10, H - 30);
      ctx.fillText(`цели ${state.targetCount} | модули ${state.moduleCount} | декор ${state.obstacleCount}`, 10, H - 14);
      if (state.obstacles) {
        ctx.strokeStyle = 'rgba(255,100,100,0.25)';
        for (const ob of state.obstacles.items) {
          const [sx, sy] = this.toScreen(ob.x, ob.y);
          ctx.beginPath(); ctx.arc(sx, sy, OBSTACLE_R(this.scale, ob), 0, TAU); ctx.stroke();
        }
      }
    }
  }

  /* Фоновая «живая пыль» — рисуется на effects слое вместе с частицами */
  drawAmbient(time, a11y) {
    if (a11y.reducedMotion) return;
    const ctx = this.ctxs.effects;
    const W = this.view.w, H = this.view.h;
    ctx.fillStyle = 'rgba(120,200,255,0.16)';
    for (const p of this.ambient) {
      const x = ((p.x + time * p.s * 0.02) % 2 + 2) % 2;   // 0..2
      const y = ((p.y + Math.sin(time * 0.2 + p.p) * 0.01) % 2 + 2) % 2;
      ctx.beginPath();
      ctx.arc((x - 1) * W / 2 + W / 2, (y - 1) * H / 2 + H / 2, 1.2, 0, TAU);
      ctx.fill();
    }
  }
}

function OBSTACLE_R(scale, ob) { return (ob.size * scale * 1.6 + 8); }

function mixColorByIntegrity(ratio) {
  // cyan->teal в норме, amber->red при повреждениях
  if (ratio > 0.66) return '#3ad9ff';
  if (ratio > 0.33) return '#ffb347';
  return '#ff6b8a';
}

function hexPath(ctx, x, y, r) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 6;
    const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
    i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  }
  ctx.closePath();
}

function triPath(ctx, s) {
  ctx.beginPath();
  ctx.moveTo(s * 1.3, 0); ctx.lineTo(-s * 0.8, -s * 0.7); ctx.lineTo(-s * 0.4, 0); ctx.lineTo(-s * 0.8, s * 0.7);
  ctx.closePath();
}

function smallTri(ctx, s) {
  ctx.beginPath();
  ctx.moveTo(s, 0); ctx.lineTo(-s * 0.6, -s * 0.6); ctx.lineTo(-s * 0.6, s * 0.6);
  ctx.closePath();
}

function ghostPath(ctx, s) {
  ctx.beginPath();
  ctx.arc(0, -s * 0.2, s * 0.8, Math.PI, 0);
  ctx.lineTo(s * 0.8, s * 0.6);
  ctx.lineTo(s * 0.3, s * 0.3); ctx.lineTo(0, s * 0.6); ctx.lineTo(-s * 0.3, s * 0.3); ctx.lineTo(-s * 0.8, s * 0.6);
  ctx.closePath();
}

function sparkPath(ctx, s, phase) {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    const rr = (i % 2 === 0 ? s : s * 0.45) * (1 + Math.sin(phase * 3 + i) * 0.12);
    const px = Math.cos(a) * rr, py = Math.sin(a) * rr;
    i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  }
  ctx.closePath();
}

function crosshair(ctx, x, y, r) {
  ctx.beginPath();
  ctx.moveTo(x - r, y); ctx.lineTo(x - r * 0.4, y);
  ctx.moveTo(x + r * 0.4, y); ctx.lineTo(x + r, y);
  ctx.moveTo(x, y - r); ctx.lineTo(x, y - r * 0.4);
  ctx.moveTo(x, y + r * 0.4); ctx.lineTo(x, y + r);
  ctx.stroke();
}

function cornerMarks(ctx, W, H, len) {
  const m = 12;
  ctx.beginPath();
  ctx.moveTo(m, m + len); ctx.lineTo(m, m); ctx.lineTo(m + len, m);
  ctx.moveTo(W - m - len, m); ctx.lineTo(W - m, m); ctx.lineTo(W - m, m + len);
  ctx.moveTo(W - m, H - m - len); ctx.lineTo(W - m, H - m); ctx.lineTo(W - m - len, H - m);
  ctx.moveTo(m + len, H - m); ctx.lineTo(m, H - m); ctx.lineTo(m, H - m - len);
  ctx.stroke();
}

function drawScanlines(ctx, W, H, alpha) {
  ctx.fillStyle = `rgba(58,217,255,${alpha})`;
  for (let y = 0; y < H; y += 6) ctx.fillRect(0, y, W, 1);
}

function drawVignette(ctx, W, H, color) {
  const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.72);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

/* Мягкий «шум сети»: редкие тусклые горизонтальные засветки.
   Без стробинга: позиции меняются медленно, прозрачность низкая. */
function drawSoftNoise(ctx, W, H, level, time, reducedMotion) {
  const rows = Math.round(level * 6);
  ctx.fillStyle = `rgba(120,200,255,${0.028 + level * 0.03})`;
  for (let i = 0; i < rows; i++) {
    const seedY = Math.floor(time * (reducedMotion ? 0.15 : 0.5) + i * 37);
    const y = (hash1D(seedY, i * 13) * H);
    const h = 1 + hash1D(seedY + 7, i) * 2;
    ctx.fillRect(0, y, W, h);
  }
}

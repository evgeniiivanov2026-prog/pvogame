/* PVOGame.ru — процедурная местность Helios Sector.
   Полностью синтетическая: seeded RNG + шумовые функции. Никаких реальных карт/координат/геоданных. */

import { TERRAIN, FIELD, RENDER } from './config.js';
import {
  makeRng, rngRange, fbm2D, ridgedNoise2D, valueNoise2D, smoothNoise2D,
  domainWarp, VoronoiField, clamp, lerp, mixHex
} from './utils.js';

export class TerrainGenerator {
  constructor(seed, archetypeId = 'auroraRidges', quality = 'high') {
    this.setConfig(seed, archetypeId, quality);
  }

  setConfig(seed, archetypeId, quality) {
    this.seed = (seed >>> 0) || 1;
    this.archetypeId = TERRAIN.archetypes[archetypeId] ? archetypeId : 'auroraRidges';
    this.arch = TERRAIN.archetypes[this.archetypeId];
    this.quality = TERRAIN.quality[quality] != null ? quality : 'high';
    this.q = TERRAIN.quality[this.quality];
    this.n = TERRAIN.gridN;
    this.rng = makeRng(this.seed);
    this._cache = null;          // offscreen canvas с растеризованной картой
    this._cacheKey = null;
    this._generateGrid();
  }

  /* ── Шаг 1: сетка высот и классификация ──────────────────────── */
  _generateGrid() {
    const n = this.n, a = this.arch;
    this.heights = new Float32Array(n * n);
    this.slopes = new Float32Array(n * n);
    this.types = new Array(n * n);      // ridge|basin|plateau|crystalField|signalFog|neutral
    this.signals = new Float32Array(n * n);   // visualSignal 0..1
    this.interference = new Float32Array(n * n); // visualInterference 0..1
    this.tints = new Array(n * n);
    this.regionIds = new Int16Array(n * n);
    this.macroFeatures = [];

    const voro = new VoronoiField(this.seed, 240, -FIELD.worldSize / 2, FIELD.worldSize / 2);
    const freq = a.baseFreq;

    for (let gy = 0; gy < n; gy++) {
      for (let gx = 0; gx < n; gx++) {
        // мировые координаты центра тайла
        const wx = (gx / n - 0.5) * FIELD.worldSize;
        const wy = (gy / n - 0.5) * FIELD.worldSize;
        const nx = wx / FIELD.worldSize, ny = wy / FIELD.worldSize; // -0.5..0.5

        let [sx, sy] = domainWarp(nx * freq * 4, ny * freq * 4, this.seed, a.warp * 0.8);

        let h = fbm2D(sx, sy, this.seed, a.fbmOctaves) * (1 - a.ridged)
              + ridgedNoise2D(sx, sy, this.seed + 31, a.fbmOctaves) * a.ridged;

        // крупный наклон (tilt) — «макро-рельеф»
        h += (nx * a.tilt * 0.4 + ny * a.tilt * 0.25);

        // мягкая чаша к центру, чтобы станция стояла на ровной площадке
        const r = Math.hypot(nx, ny) * 2; // 0 центр .. ~1 край
        const bowl = clamp((r - 0.12) * 1.4, 0, 1);
        h = lerp(0.42, h, bowl);

        // voronoi influence — «регионы»
        const [vd, vcell] = voro.distance(wx, wy);
        const vInfluence = clamp(1 - vd / 190, 0, 1) * a.voronoiW;
        h = clamp(h * 0.85 + vInfluence * 0.35 + 0.1, 0, 1.2);

        const idx = gy * n + gx;
        this.heights[idx] = h;
        this.regionIds[idx] = vcell;

        // визуальные сигналы: редкие «прожилки» из высокочастотного шума
        const vein = Math.abs(valueNoise2D(sx * 3.7 + 11, sy * 3.7 - 7, this.seed + 505) - 0.5);
        this.signals[idx] = clamp(1 - vein * 6, 0, 1);
        this.interference[idx] = smoothNoise2D(sx * 1.8, sy * 1.8, this.seed + 909, 1, 1) > 0.68 ? 0.7 : 0.15;
      }
    }

    /* Slope по соседям */
    for (let gy = 0; gy < n; gy++) {
      for (let gx = 0; gx < n; gx++) {
        const idx = gy * n + gx;
        const hl = this.heights[gy * n + Math.max(0, gx - 1)];
        const hr = this.heights[gy * n + Math.min(n - 1, gx + 1)];
        const hu = this.heights[Math.max(0, gy - 1) * n + gx];
        const hd = this.heights[Math.min(n - 1, gy + 1) * n + gx];
        this.slopes[idx] = clamp(Math.hypot(hr - hl, hd - hu) * n * 0.5, 0, 1);
      }
    }

    /* Классификация зон */
    for (let i = 0; i < n * n; i++) {
      const h = this.heights[i], s = this.slopes[i];
      let type = 'neutral';
      if (h > 0.62 && s > 0.35) type = 'ridge';
      else if (h > 0.55 && s <= 0.35) type = 'plateau';
      else if (h < 0.34) type = 'basin';
      if (this.signals[i] > 0.75) type = 'crystalField';
      else if (this.interference[i] > 0.5 && h < 0.5) type = 'signalFog';
      this.types[i] = type;
      const base = TERRAIN.zones[type].color;
      this.tints[i] = mixHex(base, '#0a1626', clamp(0.55 - h * 0.55, 0, 0.5));
    }

    /* Макро-особенности: несколько «аномалий» для декора карты */
    const frng = makeRng(this.seed ^ 0xBEEF);
    const macroCount = 3 + Math.floor(frng() * 3);
    for (let i = 0; i < macroCount; i++) {
      this.macroFeatures.push({
        x: rngRange(frng, -0.42, 0.42), y: rngRange(frng, -0.42, 0.42),
        r: rngRange(frng, 0.06, 0.16),
        kind: ['halo', 'rift', 'bloom'][Math.floor(frng() * 3)]
      });
    }
  }

  /* Запрос данных тайла в мировых координатах */
  sample(wx, wy) {
    const gx = clamp(Math.floor((wx / FIELD.worldSize + 0.5) * this.n), 0, this.n - 1);
    const gy = clamp(Math.floor((wy / FIELD.worldSize + 0.5) * this.n), 0, this.n - 1);
    const i = gy * this.n + gx;
    return {
      height: this.heights[i], slope: this.slopes[i], terrainType: this.types[i],
      visualSignal: this.signals[i], visualInterference: this.interference[i],
      tint: this.tints[i], regionId: this.regionIds[i],
      blocking: false // местность не блокирует геймплей — только визуал
    };
  }

  /* ── Шаг 2: растеризация в кэш (не перерисовывается каждый кадр) */
  buildCache(viewPx) {
    const key = `${this.seed}|${this.archetypeId}|${this.quality}|${Math.round(viewPx)}`;
    if (this._cache && this._cacheKey === key) return this._cache;

    const size = Math.max(256, Math.round(viewPx));
    const cv = document.createElement('canvas');
    cv.width = size; cv.height = size;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#0a1626';
    ctx.fillRect(0, 0, size, size);

    const step = Math.max(2, Math.round(size / this.n)); // пикселей на гекс

    for (let gy = 0; gy < this.n; gy++) {
      for (let gx = 0; gx < this.n; gx++) {
        const i = gy * this.n + gx;
        const h = this.heights[i];
        // псевдо-3D: вертикальное смещение по высоте + лёгкая изометрическая косина
        const px = gx * step;
        const py = gy * step - (h - 0.5) * TERRAIN.heightScale * (step / 8);
        ctx.fillStyle = this.tints[i];
        ctx.globalAlpha = 0.55 + h * 0.45;
        ctx.fillRect(px, py, step + 1, step + 1);
      }
    }
    ctx.globalAlpha = 1;

    /* Изолинии (контуры уровней) */
    const contourLevels = [0.3, 0.45, 0.6, 0.75];
    ctx.lineWidth = 1;
    for (const lvl of contourLevels) {
      ctx.strokeStyle = `rgba(90,200,255,${0.10 + lvl * 0.08})`;
      ctx.beginPath();
      for (let gy = 1; gy < this.n; gy++) {
        for (let gx = 1; gx < this.n; gx++) {
          const i = gy * this.n + gx;
          const a1 = this.heights[i], b1 = this.heights[i - 1];
          const a2 = this.heights[i], b2 = this.heights[i - this.n];
          if ((a1 - lvl) * (b1 - lvl) < 0) {
            const px = gx * step, py = (gy + lerp(0, 1, (lvl - a1) / (a1 - b1 || 1))) * step;
            ctx.moveTo(px, py); ctx.lineTo(px - step, py);
          }
          if ((a2 - lvl) * (b2 - lvl) < 0) {
            const px = (gx + lerp(0, 1, (lvl - a2) / (a2 - b2 || 1))) * step, py = gy * step;
            ctx.moveTo(px, py); ctx.lineTo(px, py - step);
          }
        }
      }
      ctx.stroke();
    }

    /* Кристальные прожилки — яркие линии там, где visualSignal высок */
    ctx.strokeStyle = 'rgba(170,140,255,0.35)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    let drawing = false;
    for (let gy = 0; gy < this.n; gy += 2) {
      for (let gx = 0; gx < this.n; gx++) {
        const i = gy * this.n + gx;
        if (this.signals[i] > 0.7) {
          const px = gx * step, py = gy * step;
          if (!drawing) { ctx.moveTo(px, py); drawing = true; } else ctx.lineTo(px, py);
        } else drawing = false;
      }
    }
    ctx.stroke();

    /* Границы регионов (voronoi): тёмные штрихи при смене regionId */
    ctx.strokeStyle = 'rgba(120,180,220,0.12)';
    ctx.setLineDash([3, 5]);
    ctx.beginPath();
    for (let gy = 1; gy < this.n; gy++) {
      for (let gx = 1; gx < this.n; gx++) {
        const i = gy * this.n + gx;
        if (this.regionIds[i] !== this.regionIds[i - 1]) {
          ctx.moveTo(gx * step, gy * step); ctx.lineTo(gx * step, gy * step + step);
        }
      }
    }
    ctx.stroke();
    ctx.setLineDash([]);

    /* Сигнальный туман — мягкие пятна */
    for (let gy = 0; gy < this.n; gy += 3) {
      for (let gx = 0; gx < this.n; gx += 3) {
        const i = gy * this.n + gx;
        if (this.types[i] === 'signalFog') {
          const px = gx * step, py = gy * step;
          const g = ctx.createRadialGradient(px, py, 2, px, py, step * 3);
          g.addColorStop(0, 'rgba(60,140,140,0.10)');
          g.addColorStop(1, 'rgba(60,140,140,0)');
          ctx.fillStyle = g;
          ctx.fillRect(px - step * 3, py - step * 3, step * 6, step * 6);
        }
      }
    }

    /* Safe zone вокруг станции — ровное кольцо без рельефа */
    const cx = size / 2, cy = size / 2;
    const safePx = (FIELD.stationSafeRadius / FIELD.worldSize) * size;
    const sg = ctx.createRadialGradient(cx, cy, safePx * 0.4, cx, cy, safePx);
    sg.addColorStop(0, 'rgba(10,22,38,0.95)');
    sg.addColorStop(1, 'rgba(10,22,38,0)');
    ctx.fillStyle = sg;
    ctx.beginPath(); ctx.arc(cx, cy, safePx, 0, Math.PI * 2); ctx.fill();

    /* Макро-аномалии */
    for (const f of this.macroFeatures) {
      const px = (f.x + 0.5) * size, py = (f.y + 0.5) * size, pr = f.r * size;
      ctx.strokeStyle = f.kind === 'halo' ? 'rgba(80,220,255,0.18)'
        : f.kind === 'rift' ? 'rgba(255,140,170,0.16)' : 'rgba(150,120,255,0.16)';
      ctx.lineWidth = 1.5;
      for (let k = 0; k < 3; k++) {
        ctx.beginPath();
        ctx.arc(px, py, pr * (0.4 + k * 0.3), 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    this._cache = cv;
    this._cacheKey = key;
    return cv;
  }

  invalidateCache() { this._cache = null; this._cacheKey = null; }

  /* Случайный seed для кнопки «перемешать» */
  static randomSeed() { return Math.floor(Math.random() * 0x7fffffff); }
}

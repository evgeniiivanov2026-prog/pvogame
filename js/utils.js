/* PVOGame.ru — общие утилиты: математика, seeded RNG, шум, spatial hash. */

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : clamp((v - a) / (b - a), 0, 1));
export const dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);
export const dist2 = (x1, y1, x2, y2) => { const dx = x2 - x1, dy = y2 - y1; return dx * dx + dy * dy; };
export const TAU = Math.PI * 2;

export function fmt(n, digits = 0) {
  return Number(n).toFixed(digits);
}

/* ── Seeded RNG (mulberry32) ────────────────────────────────────── */
export function makeRng(seed) {
  let a = (seed >>> 0) || 1;
  return function rng() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rngRange(rng, min, max) { return min + rng() * (max - min); }
export function rngInt(rng, min, max) { return Math.floor(rngRange(rng, min, max + 1)); }
export function rngPick(rng, arr) { return arr[Math.floor(rng() * arr.length) % arr.length]; }

/* ── Хеш-функции для процедурной генерации ──────────────────────── */
export function hash2D(x, y, seed = 0) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function hash1D(n, seed = 0) {
  let h = Math.imul(n | 0, 2654435761) ^ Math.imul(seed | 0, 1597334677);
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

const fade = (t) => t * t * (3 - 2 * t);

/* Value noise 2D, детерминированный по seed */
export function valueNoise2D(x, y, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const v00 = hash2D(xi, yi, seed), v10 = hash2D(xi + 1, yi, seed);
  const v01 = hash2D(xi, yi + 1, seed), v11 = hash2D(xi + 1, yi + 1, seed);
  const u = fade(xf), v = fade(yf);
  return lerp(lerp(v00, v10, u), lerp(v01, v11, u), v);
}

/* Smoothed noise: усреднение значения шума в окрестности */
export function smoothNoise2D(x, y, seed = 0, radius = 1, passes = 1) {
  let sum = 0, count = 0;
  for (let p = 0; p < passes; p++) {
    for (let ox = -radius; ox <= radius; ox++) {
      for (let oy = -radius; oy <= radius; oy++) {
        sum += valueNoise2D(x + ox * 0.5, y + oy * 0.5, seed + p * 977);
        count++;
      }
    }
  }
  return sum / count;
}

/* FBM — фрактальное броуновое движение */
export function fbm2D(x, y, seed = 0, octaves = 4, lacunarity = 2.0, gain = 0.5) {
  let amp = 0.5, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise2D(x * freq, y * freq, seed + i * 131);
    norm += amp;
    amp *= gain; freq *= lacunarity;
  }
  return sum / norm;
}

/* Ridged multifractal noise */
export function ridgedNoise2D(x, y, seed = 0, octaves = 4) {
  let amp = 0.5, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    let n = valueNoise2D(x * freq, y * freq, seed + i * 131);
    n = 1 - Math.abs(n * 2 - 1);
    n = n * n;
    sum += amp * n; norm += amp;
    amp *= 0.5; freq *= 2.1;
  }
  return sum / norm;
}

/* Domain warp: смещение координат шумом */
export function domainWarp(x, y, seed, amount = 1) {
  const wx = valueNoise2D(x + 5.2, y + 1.3, seed + 77) - 0.5;
  const wy = valueNoise2D(x - 3.7, y + 9.1, seed + 991) - 0.5;
  return [x + wx * amount, y + wy * amount];
}

/* Приблизительное расстояние до ближайшей точки Вороного (сетка-ускоритель) */
export class VoronoiField {
  constructor(seed, cellSize, extentMin, extentMax) {
    this.cell = cellSize;
    this.min = extentMin;
    this.max = extentMax;
    this.seed = seed;
  }
  _cellPoint(cx, cy) {
    const s = this.seed + cx * 73856093 ^ cy * 19349663;
    const h1 = hash1D(s & 0x7fffffff, this.seed);
    const h2 = hash1D((s >> 13) & 0x7fffffff, this.seed + 17);
    return [
      (cx + h1) * this.cell,
      (cy + h2) * this.cell
    ];
  }
  distance(x, y) {
    const cx = Math.floor(x / this.cell), cy = Math.floor(y / this.cell);
    let best = Infinity, bestId = 0;
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        const [px, py] = this._cellPoint(cx + ox, cy + oy);
        const d = dist2(x, y, px, py);
        if (d < best) { best = d; bestId = (cx + ox) * 31 + (cy + oy); }
      }
    }
    return [Math.sqrt(best), Math.abs(bestId) % 997];
  }
}

/* ── Spatial hash ───────────────────────────────────────────────── */
export class SpatialHash {
  constructor(cellSize) {
    this.cellSize = cellSize;
    this.map = new Map();
  }
  _key(cx, cy) { return cx * 100000 + cy; }
  insert(item) {
    const cx = Math.floor(item.x / this.cellSize), cy = Math.floor(item.y / this.cellSize);
    const k = this._key(cx, cy);
    if (!this.map.has(k)) this.map.set(k, []);
    this.map.get(k).push(item);
  }
  query(x, y, radius) {
    const out = [];
    const minX = Math.floor((x - radius) / this.cellSize), maxX = Math.floor((x + radius) / this.cellSize);
    const minY = Math.floor((y - radius) / this.cellSize), maxY = Math.floor((y + radius) / this.cellSize);
    for (let cx = minX; cx <= maxX; cx++) {
      for (let cy = minY; cy <= maxY; cy++) {
        const arr = this.map.get(this._key(cx, cy));
        if (arr) out.push(...arr);
      }
    }
    return out;
  }
  clear() { this.map.clear(); }
}

/* ── Цвета ──────────────────────────────────────────────────────── */
export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgba(hex, alpha) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function mixHex(a, b, t) {
  const ca = hexToRgb(a), cb = hexToRgb(b);
  const m = (i) => Math.round(lerp(ca[i], cb[i], t));
  return `rgb(${m(0)},${m(1)},${m(2)})`;
}

/* ── Прочее ─────────────────────────────────────────────────────── */
export function deepMerge(target, source) {
  const out = Array.isArray(target) ? [...target] : { ...target };
  for (const key of Object.keys(source || {})) {
    const sv = source[key], tv = out[key];
    if (sv && typeof sv === 'object' && !Array.isArray(sv) && tv && typeof tv === 'object' && !Array.isArray(tv)) {
      out[key] = deepMerge(tv, sv);
    } else {
      out[key] = Array.isArray(sv) ? [...sv] : sv;
    }
  }
  return out;
}

export function uid() {
  return 'id_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  for (const c of (Array.isArray(children) ? children : [children])) {
    if (c == null) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

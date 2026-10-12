/* PVOGame.ru — сущности мира: цели, станция Helios, частицы эффектов. */

import { TARGET_TYPES, FIELD, RESOURCES, STRESS } from './config.js';
import { clamp, dist, uid, TAU, makeRng, rngRange } from './utils.js';

let nextId = 1;

/* ── Цель (абстрактный sci-fi объект) ───────────────────────────── */
export class Target {
  constructor(typeId, x, y, diffMul = {}) {
    const def = TARGET_TYPES[typeId];
    this.id = nextId++;
    this.typeId = typeId;
    this.def = def;
    this.uid = uid();
    this.x = x; this.y = y;
    this.angle = Math.atan2(-y, -x); // ориентация к центру
    this.maxHp = def.hp * (diffMul.hpMul || 1);
    this.hp = this.maxHp;
    this.baseSpeed = def.speed * (diffMul.speedMul || 1);
    this.speed = this.baseSpeed;
    this.size = def.size;
    this.threat = def.threat;
    this.reward = Math.round(def.reward * (diffMul.creditMul || 1));
    this.damage = Math.round(def.damage * (diffMul.dmgMul || 1));
    this.armor = def.armor || 0;
    this.phantom = !!def.phantom;
    this.revealed = !this.phantom;
    this.alive = true;
    this.slowUntil = 0;      // timestamp (игровое время) до которого замедлен
    this.slowFactor = 1;
    this.phase = rngRange(makeRng(this.id * 977 + 13), 0, TAU);
    this.wobble = 0;
    this.priorityScore = 0;  // для channel-priority / targeting=priority
    this.enteredFieldAt = 0;
  }

  get radiusFromCenter() { return dist(this.x, this.y, 0, 0); }

  ringIndex() {
    const r = this.radiusFromCenter;
    for (let i = 0; i < FIELD.rings.length; i++) {
      if (r > FIELD.rings[i].radius) return i; // 0 = за пределами/зона обнаружения
    }
    return FIELD.rings.length - 1;
  }

  applySlow(factor, untilTime) {
    this.slowFactor = Math.min(this.slowFactor, factor);
    this.slowUntil = Math.max(this.slowUntil, untilTime);
  }

  update(dt, gameTime, onReachStation) {
    if (!this.alive) return;
    // восстановление медленной регенерации (wisp)
    if (this.def.regenPerSec && this.hp < this.maxHp) {
      this.hp = Math.min(this.maxHp, this.hp + this.def.regenPerSec * dt);
    }
    // сброс замедления
    if (gameTime > this.slowUntil) this.slowFactor = 1;

    const behavior = this.def.behavior;
    let vx = -this.x, vy = -this.y;
    const len = Math.hypot(vx, vy) || 1;
    vx /= len; vy /= len;

    if (behavior === 'zigzag' || behavior === 'weave') {
      const amp = behavior === 'zigzag' ? 0.85 : 0.5;
      const w = Math.sin(gameTime * 2.4 + this.phase) * amp;
      this.wobble = w;
      const px = -vy, py = vx; // перпендикуляр
      vx += px * w; vy += py * w;
      const nl = Math.hypot(vx, vy) || 1; vx /= nl; vy /= nl;
    } else if (behavior === 'drift') {
      const w = Math.sin(gameTime * 1.3 + this.phase) * 0.35;
      this.wobble = w;
      const px = -vy, py = vx;
      vx += px * w; vy += py * w;
      const nl = Math.hypot(vx, vy) || 1; vx /= nl; vy /= nl;
    }

    const sp = this.baseSpeed * this.slowFactor;
    this.x += vx * sp * dt;
    this.y += vy * sp * dt;
    this.angle = Math.atan2(vy, vx);

    if (this.radiusFromCenter <= FIELD.stationSafeRadius * 0.62) {
      this.alive = false;
      this.impacted = true;
      if (onReachStation) onReachStation(this);
    }
  }

  takeDamage(amount, sourceModule) {
    if (!this.alive) return 0;
    let dmg = amount;
    if (this.armor > 0) dmg = Math.max(1, dmg - this.armor);
    this.hp -= dmg;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.killedBy = sourceModule ? sourceModule.id : null;
    }
    return dmg;
  }
}

/* ── Станция Helios ─────────────────────────────────────────────── */
export class Station {
  constructor() {
    this.x = 0; this.y = 0;
    this.integrity = RESOURCES.startIntegrity;
    this.maxIntegrity = RESOURCES.integrityMax;
    this.pulsePhase = 0;
    this.lastHitAt = -999;
    this.shieldPool = 0;   // временный щит от Guardian Node
  }

  get integrityRatio() { return clamp(this.integrity / this.maxIntegrity, 0, 1); }

  hit(amount, gameTime) {
    let dmg = amount;
    if (this.shieldPool > 0) {
      const absorbed = Math.min(this.shieldPool, dmg);
      this.shieldPool -= absorbed;
      dmg -= absorbed;
    }
    this.integrity = clamp(this.integrity - dmg, 0, this.maxIntegrity);
    this.lastHitAt = gameTime;
    return dmg;
  }

  repair(amount) {
    this.integrity = clamp(this.integrity + amount, 0, this.maxIntegrity);
  }

  update(dt, gameTime) {
    this.pulsePhase += dt * (0.6 + (1 - this.integrityRatio) * 1.4);
    // Щит медленно восстанавливается, если есть узлы охраны (значение задаёт game.js)
  }

  get destroyed() { return this.integrity <= 0; }
}

/* ── Менеджер частиц (эффекты попаданий/разрушений) ─────────────── */
export class ParticleSystem {
  constructor(maxParticles = 200) {
    this.max = maxParticles;
    this.items = [];
  }
  setMax(n) { this.max = n; }

  _recycle() {
    // Быстрая очистка мёртвых частиц без O(n^2) splice в горячем цикле
    if (this.items.length === 0) return;
    let w = 0;
    for (let i = 0; i < this.items.length; i++) {
      const p = this.items[i];
      if (p.life > 0) this.items[w++] = p;
    }
    this.items.length = w;
  }

  spawnBurst(x, y, color, count = 8, speed = 90, life = 0.6) {
    if (this.items.length >= this.max) this._recycle();
    const rng = makeRng((Date.now() ^ (x * 131 + y * 977)) >>> 0);
    for (let i = 0; i < count && this.items.length < this.max; i++) {
      const a = rng() * TAU;
      const s = speed * (0.4 + rng() * 0.8);
      this.items.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life, maxLife: life, color, size: 1.5 + rng() * 2.2
      });
    }
  }
  spawnRing(x, y, color, radius) {
    if (this.items.length >= this.max) this._recycle();
    if (this.items.length >= this.max) return;
    this.items.push({ ring: true, x, y, r0: 6, r1: radius, life: 0.5, maxLife: 0.5, color });
  }
  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const p = this.items[i];
      p.life -= dt;
      if (p.life <= 0) { this.items.splice(i, 1); continue; }
      if (!p.ring) {
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.vx *= 0.92; p.vy *= 0.92;
      }
    }
  }
}

/* ── Утилиты целей ──────────────────────────────────────────────── */
export function computePriority(target) {
  // Абстрактный «рейтинг угрозы» для режима приоритета и подсветки
  const proximity = 1 - clamp(target.radiusFromCenter / FIELD.spawnRadius, 0, 1);
  const stressWeight = target.phantom ? STRESS.unknownSignalPerSec * 8 : target.threat;
  return stressWeight * 0.6 + proximity * 60 + (target.def.speed / 4);
}

export function spawnPointFor(rng) {
  const a = rng() * TAU;
  const r = FIELD.spawnRadius + rngRange(rng, -40, 80);
  return [Math.cos(a) * r, Math.sin(a) * r];
}

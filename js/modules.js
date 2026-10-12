/* PVOGame.ru — защитные модули: постройка, апгрейды, стрельба, приоритеты. */

import { MODULE_TYPES, FIELD, TARGETING, SELL_REFUND, MAX_MODULE_LEVEL, SHOT_ENERGY_COST, RESOURCES } from './config.js';
import { dist, clamp } from './utils.js';
import { computePriority } from './entities.js';

let moduleSeq = 1;

export class DefenseModule {
  constructor(typeId, x, y) {
    const def = MODULE_TYPES[typeId];
    this.id = moduleSeq++;
    this.typeId = typeId;
    this.def = def;
    this.x = x; this.y = y;
    this.level = 1;                 // 1..MAX_MODULE_LEVEL
    this.upgradeIndex = 0;          // сколько апгрейдов куплено
    this.targeting = TARGETING.default;
    this.cooldownLeft = 0;
    this.spentCredits = def.cost;   // для расчёта возврата при продаже
    this.energyUse = def.energy;
    this.angle = 0;                 // визуальный поворот к цели
    this.fireFlash = 0;
    this.enabled = true;
    this._applyMods();
  }

  _applyMods() {
    // Пересобираем производные параметры из базовых + купленных апгрейдов
    const d = this.def;
    this.range = d.range;
    this.damage = d.damage || 0;
    this.cooldownMax = d.cooldown || 0;
    this.splash = d.splash || 0;
    this.slowFactor = d.slowFactor || 1;
    this.stressCalm = d.stressCalm || 0;
    this.repairPerSec = d.repairPerSec || 0;
    this.shield = d.shield || 0;
    this.multiTarget = 1;
    this.revealPower = d.role === 'vision' ? 1 : 0;
    this.auraBonus = 0;

    for (let i = 0; i < this.upgradeIndex; i++) {
      const mods = d.upgrades[i].mods;
      if (mods.rangeMul) this.range *= mods.rangeMul;
      if (mods.damageAdd) this.damage += mods.damageAdd;
      if (mods.cooldownMul) this.cooldownMax *= mods.cooldownMul;
      if (mods.splashMul) this.splash *= mods.splashMul;
      if (mods.slowFactor) this.slowFactor = mods.slowFactor;
      if (mods.stressCalm) this.stressCalm = mods.stressCalm;
      if (mods.repairMul) this.repairPerSec *= mods.repairMul;
      if (mods.shieldAdd) this.shield += mods.shieldAdd;
      if (mods.multiTarget) this.multiTarget = 1 + mods.multiTarget;
      if (mods.revealPower) this.revealPower = Math.max(this.revealPower, mods.revealPower);
      if (mods.auraBonus) this.auraBonus += mods.auraBonus;
    }
    this.energyUse = d.energy * (1 + this.upgradeIndex * 0.25);
  }

  get upgradeCost() {
    if (this.upgradeIndex >= this.def.upgrades.length) return null;
    return this.def.upgrades[this.upgradeIndex].cost;
  }

  canUpgrade() { return this.level < MAX_MODULE_LEVEL && this.upgradeCost != null; }

  upgrade() {
    if (!this.canUpgrade()) return false;
    const cost = this.upgradeCost;
    this.spentCredits += cost;
    this.upgradeIndex++;
    this.level++;
    this._applyMods();
    return cost;
  }

  sellValue() { return Math.round(this.spentCredits * SELL_REFUND); }

  /* Эффективный радиус с учётом ауры соседних сенсоров (считает game.js через auraProvider) */
  effectiveRange(auraProviders = []) {
    let bonus = 0;
    for (const m of auraProviders) {
      if (m === this || !m.auraBonus) continue;
      if (dist(m.x, m.y, this.x, this.y) <= m.range) bonus = Math.max(bonus, m.auraBonus);
    }
    return this.range * (1 + bonus);
  }

  pickTargets(targets, gameTime, opts = {}) {
    const range = this.effectiveRange(opts.auraProviders || []);
    const inRange = targets.filter(t =>
      t.alive &&
      (t.revealed || this.revealPower > 0 || !t.phantom) &&
      dist(t.x, t.y, this.x, this.y) <= range
    );
    if (!inRange.length) return [];

    switch (this.targeting) {
      case 'strongest': inRange.sort((a, b) => b.maxHp - a.maxHp); break;
      case 'weakest':   inRange.sort((a, b) => a.hp - b.hp); break;
      case 'priority':  inRange.sort((a, b) => computePriority(b) - computePriority(a)); break;
      default:          inRange.sort((a, b) => dist(a.x, a.y, this.x, this.y) - dist(b.x, b.y, this.x, this.y));
    }
    return inRange.slice(0, this.multiTarget);
  }

  /* Возвращает список событий выстрела для рендера/звука */
  update(dt, gameTime, targets, ctx) {
    this.fireFlash = Math.max(0, this.fireFlash - dt * 4);
    const events = [];

    if (this.typeId === 'sentinel') {
      // Пассивно: раскрывает фантомы в радиусе
      const range = this.effectiveRange(ctx.auraProviders);
      for (const t of targets) {
        if (t.phantom && !t.revealed && dist(t.x, t.y, this.x, this.y) <= range) {
          t.revealed = true;
          events.push({ kind: 'reveal', x: t.x, y: t.y });
        }
      }
      return events;
    }

    if (this.typeId === 'veil') {
      this.cooldownLeft -= dt;
      if (this.cooldownLeft <= 0) {
        const range = this.effectiveRange(ctx.auraProviders);
        let applied = false;
        for (const t of targets) {
          if (t.alive && dist(t.x, t.y, this.x, this.y) <= range) {
            t.applySlow(this.slowFactor, gameTime + 1.4);
            applied = true;
          }
        }
        this.cooldownLeft = this.cooldownMax || 6;
        if (applied) events.push({ kind: 'veil-pulse', x: this.x, y: this.y, r: range });
      }
      return events;
    }

    if (this.typeId === 'guardian') {
      // Пассивный ремонт станции, если станция в радиусе
      const stDist = dist(this.x, this.y, 0, 0);
      if (stDist <= this.range + FIELD.stationSafeRadius) {
        ctx.station.repair(this.repairPerSec * dt);
        if (ctx.station.shieldPool < this.shield) {
          ctx.station.shieldPool = Math.min(this.shield, ctx.station.shieldPool + this.shield * 0.1 * dt);
        }
      }
      return events;
    }

    // Боевые модули: arc / pulse
    this.cooldownLeft -= dt;
    if (this.cooldownLeft > 0) return events;

    const targets_ = this.pickTargets(targets, gameTime, ctx);
    if (!targets_.length) return events;

    /* Заряд сети — реальное ограничение огня. Если энергии на залп не хватает,
       модуль ждёт подзарядки (как боекомплект/питание в реальных системах). */
    const shotCost = (SHOT_ENERGY_COST[this.typeId] || 1) * this.energyUse * 0.35 * (RESOURCES.shotEnergyCostMul || 1);
    if ((ctx.energy ?? Infinity) < shotCost) {
      this.starved = true;
      this.cooldownLeft = Math.min(this.cooldownMax || 0.5, 0.35); // короткая повторная попытка
      return events;
    }
    if (ctx.spendEnergy) ctx.spendEnergy(shotCost);
    this.starved = false;

    const primary = targets_[0];
    this.angle = Math.atan2(primary.y - this.y, primary.x - this.x);
    this.cooldownLeft = this.cooldownMax;
    this.fireFlash = 1;

    if (this.typeId === 'arc') {
      for (const t of targets_) {
        t.takeDamage(this.damage, this);
        events.push({ kind: 'arc-shot', x1: this.x, y1: this.y, x2: t.x, y2: t.y, color: this.def.color });
      }
    } else if (this.typeId === 'pulse') {
      const range = this.effectiveRange(ctx.auraProviders);
      events.push({ kind: 'pulse-wave', x: this.x, y: this.y, r: this.splash || range, color: this.def.color });
      for (const t of targets) {
        if (t.alive && dist(t.x, t.y, this.x, this.y) <= (this.splash || range)) {
          t.takeDamage(this.damage, this);
        }
      }
    }
    return events;
  }
}

/* ── Валидация размещения ───────────────────────────────────────── */
export function canPlaceModuleAt(x, y, modules, terrainInfo, obstaclesQuery) {
  const r = Math.hypot(x, y);
  if (r < FIELD.moduleMinStationDist) return { ok: false, reason: 'Слишком близко к ядру станции' };
  if (r > FIELD.rings[0].radius + 80) return { ok: false, reason: 'За пределами зоны обнаружения' };
  for (const m of modules) {
    if (dist(m.x, m.y, x, y) < 46) return { ok: false, reason: 'Слишком близко к другому модулю' };
  }
  if (obstaclesQuery) {
    const near = obstaclesQuery(x, y, 30);
    if (near.length) return { ok: false, reason: 'Мешает декоративный объект среды' };
  }
  if (terrainInfo && terrainInfo.blocking) return { ok: false, reason: 'Неподходящий рельеф' };
  return { ok: true };
}

export function moduleStatsLines(m) {
  const lines = [];
  lines.push({ k: 'Радиус', v: `${Math.round(m.effectiveRange([]))} ед.` });
  if (m.damage) lines.push({ k: 'Урон', v: `${Math.round(m.damage)}` });
  if (m.cooldownMax) lines.push({ k: 'Перезарядка', v: `${clamp(m.cooldownMax, 0, 99).toFixed(1)} с` });
  if (m.slowFactor && m.slowFactor < 1) lines.push({ k: 'Замедление', v: `${Math.round((1 - m.slowFactor) * 100)}%` });
  if (m.repairPerSec) lines.push({ k: 'Ремонт', v: `${m.repairPerSec.toFixed(1)} ед/с` });
  if (m.shield) lines.push({ k: 'Барьер', v: `${Math.round(m.shield)}` });
  lines.push({ k: 'Энергия', v: `${m.energyUse.toFixed(1)} ед.` });
  return lines;
}

/* PVOGame.ru — система Focus и восстановления управления (control-recovery).
   Активен только один режим одновременно. Режимы меняют абстрактные игровые
   коэффициенты интерфейса/темпа, а не реалистические боевые параметры. */

import { FOCUS_MODES, RESOURCES, FOCUS_BANDS } from './config.js';
import { clamp } from './utils.js';

export class ControlRecoverySystem {
  constructor(settings) {
    this.settings = settings || { enabled: true, focusAutoPause: true, noiseFloor: 0.5 };
    this.focus = RESOURCES.focusStart;          // 0..100
    this.activeMode = null;                     // id режима
    this.modeTimeLeft = 0;
    this.cooldowns = {};                        // modeId -> сек
    for (const id of Object.keys(FOCUS_MODES)) this.cooldowns[id] = 0;
  }

  reset() {
    this.focus = RESOURCES.focusStart;
    this.activeMode = null;
    this.modeTimeLeft = 0;
    for (const id of Object.keys(FOCUS_MODES)) this.cooldowns[id] = 0;
  }

  get band() {
    const f = this.focus;
    if (f <= FOCUS_BANDS.low.max) return 'low';
    if (f <= FOCUS_BANDS.steady.max) return 'steady';
    return 'high';
  }

  canActivate(modeId) {
    if (!this.settings.enabled) return { ok: false, reason: 'Система восстановления отключена' };
    const m = FOCUS_MODES[modeId];
    if (!m) return { ok: false, reason: 'Неизвестный режим' };
    if (this.cooldowns[modeId] > 0) return { ok: false, reason: `Перезарядка ${Math.ceil(this.cooldowns[modeId])} с` };
    if (this.focus < m.cost) return { ok: false, reason: `Нужно ${m.cost} фокуса` };
    if (this.activeMode === modeId) return { ok: false, reason: 'Режим уже активен' };
    return { ok: true };
  }

  activate(modeId) {
    const check = this.canActivate(modeId);
    if (!check.ok) return check;
    const m = FOCUS_MODES[modeId];
    this.focus -= m.cost;
    // Смена режима: старый снимается мгновенно
    this.activeMode = modeId;
    this.modeTimeLeft = m.duration;
    this.cooldowns[modeId] = m.cooldown;
    return { ok: true, mode: m };
  }

  deactivate() {
    this.activeMode = null;
    this.modeTimeLeft = 0;
  }

  update(dt) {
    for (const id of Object.keys(this.cooldowns)) {
      this.cooldowns[id] = Math.max(0, this.cooldowns[id] - dt);
    }
    if (this.activeMode) {
      this.modeTimeLeft -= dt;
      if (this.modeTimeLeft <= 0) this.deactivate();
    }
    // Фокус медленно восстанавливается сам
    this.focus = clamp(this.focus + RESOURCES.focusRegenPerSec * dt, 0, RESOURCES.focusMax);
  }

  /* Эффект активного режима для game/renderer/stress */
  get effect() {
    if (!this.activeMode) return null;
    const m = FOCUS_MODES[this.activeMode];
    return { ...m.effect, modeId: this.activeMode, remaining: this.modeTimeLeft, duration: m.duration };
  }

  /* Итоговый «шум UI» 0..1: базовый noiseFloor минус модификаторы режимов.
     Только визуальный параметр. */
  uiNoise(stressVisualNoise) {
    const base = this.settings.enabled ? this.settings.noiseFloor : 0.5;
    let noise = stressVisualNoise * base * 2;
    const eff = this.effect;
    if (eff && eff.uiNoise) noise = clamp(noise + eff.uiNoise, 0, 1);
    if (eff && eff.clearVisuals) noise = 0;
    if (this.band === 'low') noise = clamp(noise + 0.15, 0, 1);
    return clamp(noise, 0, 1);
  }

  modeStatusList() {
    return Object.entries(FOCUS_MODES).map(([id, m]) => ({
      id, name: m.name, key: m.key, cost: m.cost,
      cooldownLeft: this.cooldowns[id],
      active: this.activeMode === id,
      available: this.canActivate(id).ok
    }));
  }
}

/* PVOGame.ru — художественная система напряжения интерфейса.
   networkStress / operatorComposure влияют только на визуал и читаемость HUD,
   не на физику мира. Никакого стробинга, тряски экрана или резких вспышек. */

import { STRESS, STRESS_EVENTS } from './config.js';
import { clamp, lerp, makeRng, rngRange } from './utils.js';

const STRESS_EVENTS_LIST = STRESS_EVENTS.pool;

export class StressSystem {
  constructor(accessibility) {
    this.networkStress = STRESS.startStress;
    this.operatorComposure = STRESS.startComposure;
    this.panicState = 'calm';
    this.prevPanicState = 'calm';
    this.recoveryTimer = 0;
    this.accessibility = accessibility || { reduceVisualStress: false };
    this.activeEvent = null;      // текущее художественное событие
    this.eventTimer = 0;
    this.nextEventIn = 30;
    this.rng = makeRng(Date.now() & 0x7fffffff);
    this.onEvent = null;          // callback(event) для UI/звука
  }

  reset() {
    this.networkStress = STRESS.startStress;
    this.operatorComposure = STRESS.startComposure;
    this.panicState = 'calm';
    this.recoveryTimer = 0;
    this.activeEvent = null;
    this.nextEventIn = rngRange(this.rng, ...STRESS.intervalSec);
  }

  /* inputs: { nearThreats, unknownSignals, energyDeficit, sceneTargets, stressMul } */
  update(dt, inputs, focusEffect) {
    const mul = (inputs.stressMul || 1) * (focusEffect?.stressMul != null ? focusEffect.stressMul : 1);
    let add = 0;
    add += (inputs.nearThreats || 0) * STRESS.perNearThreatPerSec;
    add += (inputs.unknownSignals || 0) * STRESS.unknownSignalPerSec;
    if (inputs.energyDeficit) add += STRESS.energyDeficitPerSec;
    add += (inputs.sceneTargets || 0) * STRESS.sceneLoadPerTarget;
    add *= mul;

    // Calm-вклад вуалей снижает прирост
    const calm = inputs.calmPower || 0;
    add *= Math.max(0.25, 1 - calm * 0.12);

    this.networkStress = clamp(this.networkStress + add * dt - STRESS.stressDecayPerSec * dt, 0, 100);

    // Composure восстанавливается тем быстрее, чем ниже стресс
    const recoveryRate = STRESS.composureRecoverPerSec * (1 - this.networkStress / 130)
      + (focusEffect?.composureBoost || 0);
    this.operatorComposure = clamp(
      this.operatorComposure + recoveryRate * dt - (this.networkStress > 70 ? dt * 1.4 : 0),
      0, 100
    );

    // Состояние паники
    const s = this.networkStress;
    let state = 'overload';
    for (const t of STRESS.panicThresholds) {
      if (s < t.max) { state = t.state; break; }
    }
    if (state === 'calm' && this.recoveryTimer > 0) state = 'recovery';
    if (s >= 25) this.recoveryTimer = STRESS.recoveryGraceSec;
    else this.recoveryTimer = Math.max(0, this.recoveryTimer - dt);

    this.prevPanicState = this.panicState;
    this.panicState = state;

    // Художественные события
    if (inputs.eventsEnabled !== false) {
      this.eventTimer -= dt;
      if (this.activeEvent && this.eventTimer <= 0) this.activeEvent = null;
      this.nextEventIn -= dt;
      if (this.nextEventIn <= 0 && s > 25) {
        this.triggerEvent();
        this.nextEventIn = rngRange(this.rng, ...STRESS.intervalSec);
      }
    }
  }

  triggerEvent() {
    const ev = STRESS_EVENTS_LIST[Math.floor(this.rng() * STRESS_EVENTS_LIST.length)];
    this.activeEvent = { ...ev, ttl: 6 };
    this.eventTimer = 6;
    this.networkStress = clamp(this.networkStress + STRESS.eventBurst, 0, 100);
    if (this.onEvent) this.onEvent(this.activeEvent);
  }

  damageBurst(stressMul = 1) {
    this.networkStress = clamp(this.networkStress + STRESS.damageBurst * stressMul, 0, 100);
  }

  /* ── Выходные коэффициенты для renderer/UI (визуальные!) ──────── */
  get visualNoise() {
    if (this.accessibility.reduceVisualStress) return 0;
    const base = (this.networkStress / 100) * (1 - this.operatorComposure / 220);
    return clamp(base, 0, 1);
  }

  get hudDim() {
    // мягкое затемнение второстепенных элементов HUD при перегрузке
    if (this.accessibility.reduceVisualStress) return 0;
    return this.panicState === 'overload' ? 0.25 : this.panicState === 'critical' ? 0.12 : 0;
  }

  get pulseSpeed() {
    return lerp(0.5, 1.8, this.networkStress / 100);
  }

  get stateLabelRu() {
    return PANIC_LABELS[this.panicState] || 'Спокойно';
  }

  threatLevel(targets) {
    // Совокупная «угроза» сцены 0..100 — для HUD
    let sum = 0;
    for (const t of targets) {
      if (!t.alive) continue;
      sum += t.threat * (1.4 - clamp(t.radiusFromCenter / 1200, 0, 1));
    }
    return clamp(sum, 0, 100);
  }
}

const PANIC_LABELS = {
  calm: 'Спокойно', alert: 'Внимание', tense: 'Напряжение',
  critical: 'Критично', overload: 'Перегрузка', recovery: 'Восстановление'
};

// Список художественных событий берётся из config.js (STRESS_EVENTS.pool)

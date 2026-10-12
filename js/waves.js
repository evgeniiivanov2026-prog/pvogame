/* PVOGame.ru — генератор волн: кампания 12 волн + endless, предпросмотр состава. */

import { CAMPAIGN_WAVES, TARGET_TYPES, ENDLESS_HP_STEP, ENDLESS_COUNT_STEP } from './config.js';
import { makeRng, rngRange, rngInt, clamp } from './utils.js';

export class WaveManager {
  constructor(mode = 'campaign', difficultyMul = {}) {
    this.mode = mode;                 // campaign | endless
    this.waveIndex = 0;               // 0-based индекс текущей/следующей волны
    this.state = 'prep';              // prep | active | cleared | ended
    this.prepTimer = 8;               // секунды до старта
    this.spawnQueue = [];             // [{typeId, delay}]
    this.spawnTimer = 0;
    this.difficultyMul = difficultyMul;
    this.hpScale = 1;                 // множитель HP (напр. для боссов/endless)
    this.rng = makeRng(1000 + Math.floor(Math.random() * 9000));
    this.targetsSpawned = 0;
    this.targetsResolved = 0;         // убито или долетело
    this.totalThisWave = 0;
  }

  get waveNumber() { return this.waveIndex + 1; }
  get isCampaignOver() { return this.mode === 'campaign' && this.waveIndex >= CAMPAIGN_WAVES.length; }

  setDifficulty(mul) { this.difficultyMul = mul; }

  /* Состав волны n (0-based). Для endless — процедурная генерация поверх последней кампании. */
  compositionFor(index) {
    if (index < CAMPAIGN_WAVES.length) {
      const w = CAMPAIGN_WAVES[index];
      const countMul = this.difficultyMul.countMul || 1;
      const groups = w.groups.map(([typeId, count]) => {
        let c = Math.max(1, Math.round(count * countMul));
        if (TARGET_TYPES[typeId].behavior === 'drift') c = Math.max(2, c); // рой не по одному
        return [typeId, c];
      });
      return { groups, gap: w.gap, pause: w.pause, boss: !!w.boss, intro: !!w.intro, tutorial: w.tutorial || null };
    }
    // Endless: зацикливаем составы с ростом
    const loopPos = index % CAMPAIGN_WAVES.length;
    const cycle = Math.floor(index / CAMPAIGN_WAVES.length);
    const base = CAMPAIGN_WAVES[loopPos];
    const countMul = (this.difficultyMul.countMul || 1) * (1 + cycle * ENDLESS_COUNT_STEP + (index - CAMPAIGN_WAVES.length) * ENDLESS_COUNT_STEP * 0.5);
    const groups = base.groups.map(([typeId, count]) => {
      const c = Math.max(1, Math.round(count * countMul));
      return [typeId, c];
    });
    return { groups, gap: Math.max(0.35, base.gap * (1 - cycle * 0.08)), pause: base.pause, boss: loopPos === CAMPAIGN_WAVES.length - 1, tutorial: null };
  }

  hpMultiplierFor(index) {
    const base = this.difficultyMul.hpMul || 1;
    if (index < CAMPAIGN_WAVES.length) {
      return base * (1 + index * 0.06); // плавный рост в кампании
    }
    return base * (1 + CAMPAIGN_WAVES.length * 0.06) * (1 + (index - CAMPAIGN_WAVES.length + 1) * ENDLESS_HP_STEP);
  }

  /* Краткое текстовое описание следующего состава для панели предпросмотра */
  previewText(index) {
    const comp = this.compositionFor(index);
    return comp.groups.map(([typeId, count]) => ({
      typeId, count, name: TARGET_TYPES[typeId].name, color: TARGET_TYPES[typeId].color
    }));
  }

  startWave() {
    const comp = this.compositionFor(this.waveIndex);
    this.currentComp = comp;
    this.hpScale = this.hpMultiplierFor(this.waveIndex) * (comp.boss ? 1.25 : 1);
    this.spawnQueue = [];
    let t = 0;
    for (const [typeId, count] of comp.groups) {
      const def = TARGET_TYPES[typeId];
      if (def.behavior === 'drift' && def.groupMin) {
        // Рой выпускается плотными стаями: несколько целей почти одновременно
        let remaining = count;
        while (remaining > 0) {
          const salvo = Math.min(remaining, rngInt(this.rng, def.groupMin, def.groupMax || def.groupMin));
          for (let i = 0; i < salvo; i++) {
            this.spawnQueue.push({ typeId, time: t + rngRange(this.rng, 0, 0.35) });
          }
          remaining -= salvo;
          t += comp.gap * 2.2;
        }
      } else {
        for (let i = 0; i < count; i++) {
          this.spawnQueue.push({ typeId, time: t });
          t += comp.gap * rngRange(this.rng, 0.7, 1.3);
        }
      }
      t += rngRange(this.rng, 0.8, 2.2); // пауза между группами
    }
    this.spawnQueue.sort((a, b) => a.time - b.time);
    this.totalThisWave = this.spawnQueue.length;
    this.targetsSpawned = 0;
    this.targetsResolved = 0;
    this.killsThisWave = 0;
    this.leaksThisWave = 0;
    this.waveClock = 0;
    this.state = 'active';
    return comp;
  }

  /* dt — игровые секунды. Возвращает массив typeId, которых нужно заспавнить сейчас. */
  update(dt) {
    if (this.state === 'prep') {
      this.prepTimer -= dt;
      if (this.prepTimer <= 0) this.startWave();
      else return [];
    }
    if (this.state !== 'active') return [];
    this.waveClock += dt;
    const out = [];
    while (this.spawnQueue.length && this.spawnQueue[0].time <= this.waveClock) {
      out.push(this.spawnQueue.shift().typeId);
      this.targetsSpawned++;
    }
    return out;
  }

  skipPrep() {
    if (this.state === 'prep') { this.prepTimer = 0; return true; }
    return false;
  }

  onTargetResolved(killed) {
    this.targetsResolved++;
    if (killed) this.killsThisWave = (this.killsThisWave || 0) + 1;
    else this.leaksThisWave = (this.leaksThisWave || 0) + 1;
  }

  /* Вызывается из game.js когда очередь пуста и живых целей нет */
  tryCompleteWave(aliveTargetsCount) {
    if (this.state !== 'active') return false;
    if (this.spawnQueue.length > 0 || aliveTargetsCount > 0) return false;
    this.state = 'cleared';
    this.waveIndex++;
    // Волна зачищена раньше, чем успели появиться все цели — «досрочная» статистика корректна
    if (this.mode === 'campaign' && this.waveIndex >= CAMPAIGN_WAVES.length) {
      this.state = 'ended';
      return true;
    }
    const nextComp = this.compositionFor(this.waveIndex);
    this.prepTimer = clamp(nextComp.pause, 8, 24);
    this.state = 'prep';
    return true;
  }

  remainingToSpawn() { return this.spawnQueue.length; }
}

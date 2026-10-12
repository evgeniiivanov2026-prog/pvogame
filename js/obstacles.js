/* PVOGame.ru — декоративные препятствия среды.
   Только вымышленные визуальные объекты: не влияют на физику, урон или маршруты.
   Допустим лёгкий абстрактный эффект «локальной помехи читаемости» (visual only). */

import { OBSTACLES, FIELD } from './config.js';
import { makeRng, rngRange, rngInt, rngPick, SpatialHash, dist, clamp } from './utils.js';

export class ObstacleField {
  constructor(seed, profileId = 'balanced') {
    this.setConfig(seed, profileId);
  }

  setConfig(seed, profileId) {
    this.seed = (seed >>> 0) || 1;
    this.profileId = OBSTACLES.profiles[profileId] ? profileId : 'balanced';
    this.profile = OBSTACLES.profiles[this.profileId];
    this.items = [];
    this.hash = new SpatialHash(OBSTACLES.cellSize);
    this._generate();
  }

  _generate() {
    const rng = makeRng(this.seed ^ 0x5A17);
    const typeIds = Object.keys(OBSTACLES.types);
    const targetCount = clamp(
      Math.round((OBSTACLES.minCount + OBSTACLES.maxCount) / 2 * this.profile.density),
      OBSTACLES.minCount * this.profile.density,
      OBSTACLES.maxCount
    );

    const maxAttempts = targetCount * 12;
    let placed = 0, attempts = 0;
    while (placed < targetCount && attempts < maxAttempts) {
      attempts++;
      const x = rngRange(rng, -FIELD.worldSize / 2 + 60, FIELD.worldSize / 2 - 60);
      const y = rngRange(rng, -FIELD.worldSize / 2 + 60, FIELD.worldSize / 2 - 60);
      const r = Math.hypot(x, y);
      // Не вторгаемся в safe zone станции и не заслоняем плотное кольцо застройки
      if (r < OBSTACLES.keepOutStation) continue;
      // Реже ставим вплотную к кольцам, где обычно стоят модули
      if (r > FIELD.moduleMinStationDist && r < FIELD.rings[3].radius && rng() > 0.45) continue;

      // Не накладываем друг на друга
      let overlap = false;
      for (const it of this.items) {
        if (dist(it.x, it.y, x, y) < 70) { overlap = true; break; }
      }
      if (overlap) continue;

      const typeId = rngPick(rng, typeIds);
      const def = OBSTACLES.types[typeId];
      const [sMin, sMax] = def.size;
      this.items.push({
        id: placed++,
        typeId, def,
        x, y,
        size: rngRange(rng, sMin, sMax),
        height: rngRange(rng, 0.6, 1.4),
        rot: rngRange(rng, 0, Math.PI * 2),
        phase: rngRange(rng, 0, Math.PI * 2),
        seedLocal: rngInt(rng, 0, 99999)
      });
    }

    this.hash.clear();
    for (const it of this.items) this.hash.insert(it);
  }

  /* Запрос объектов рядом (для валидации постройки и локальных эффектов) */
  query(x, y, radius) {
    return this.hash.query(x, y, radius)
      .filter(o => dist(o.x, o.y, x, y) <= radius + o.size);
  }

  /* Лёгкая «помеха читаемости» 0..1 — чисто визуальный коэффициент для renderer.
     Не влияет на цели, урон, скорость или ИИ. */
  interferenceAt(x, y) {
    const near = this.query(x, y, OBSTACLES.interferenceRadius + 40);
    let v = 0;
    for (const o of near) {
      const d = dist(o.x, o.y, x, y);
      if (d < OBSTACLES.interferenceRadius + o.size) {
        v += (1 - d / (OBSTACLES.interferenceRadius + o.size + 1)) * 0.35;
      }
    }
    return clamp(v * this.profile.readabilityNoise * 2, 0, 0.6);
  }

  get count() { return this.items.length; }
}

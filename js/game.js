/* PVOGame.ru — ядро игры: состояние, цикл, ввод, интеграция всех систем. */

import {
  PROJECT_NAME, RESOURCES, SCORING, MODULE_TYPES, TARGETING, KEYS,
  DEFAULT_SETTINGS, DEFAULT_ACCESSIBILITY, DEFAULT_CONTROL_RECOVERY, DEFAULT_ADMIN,
  DIFFICULTY_PRESETS, RENDER, STRESS
} from './config.js';
import { KEYS as SK, loadJSON, saveJSON, loadNumber, saveNumber } from './storage.js';
import { clamp, dist, makeRng } from './utils.js';
import { Station, Target, ParticleSystem, spawnPointFor, computePriority } from './entities.js';
import { DefenseModule, canPlaceModuleAt, moduleStatsLines } from './modules.js';
import { WaveManager } from './waves.js';
import { StressSystem } from './stress.js';
import { ControlRecoverySystem } from './control-recovery.js';
import { FocusVisuals } from './focus-visuals.js';
import { TerrainGenerator } from './terrain.js';
import { ObstacleField } from './obstacles.js';
import { AudioManager } from './audio.js';
import { Renderer } from './renderer.js';
import { UI } from './ui.js';
import { AdminPanel } from './admin-panel.js';

export class Game {
  constructor() {
    /* ── Загрузка настроек ──────────────────────────────────────── */
    this.settings = loadJSON(SK.settings, DEFAULT_SETTINGS);
    this.accessibility = loadJSON(SK.accessibility, DEFAULT_ACCESSIBILITY);
    this.crSettings = loadJSON(SK.controlRecovery, DEFAULT_CONTROL_RECOVERY);
    this.adminSettings = loadJSON(SK.admin, DEFAULT_ADMIN);
    this.audioSettings = loadJSON(SK.audio, {});
    this.bestScore = loadNumber(SK.bestScore, 0);

    /* ── Системы ────────────────────────────────────────────────── */
    this.audio = new AudioManager(this.audioSettings);
    this.stress = new StressSystem(this.accessibility);
    this.cr = new ControlRecoverySystem(this.crSettings);
    this.focusVisuals = new FocusVisuals(this.accessibility);
    this.particles = new ParticleSystem(RENDER.maxParticles[this.settings.quality]);
    this.rng = makeRng(Date.now() & 0x7fffffff);

    const canvasLayers = {
      terrain: document.getElementById('layer-terrain'),
      world: document.getElementById('layer-world'),
      effects: document.getElementById('layer-effects'),
      interaction: document.getElementById('layer-interaction')
    };
    this.renderer = new Renderer(canvasLayers);
    this.stage = document.getElementById('stage');

    this.ui = new UI(this);
    this.adminPanel = new AdminPanel(this);

    this.state = freshState();
    this.waves = new WaveManager('campaign', this.difficultyMul());
    this.placement = null;
    this.selected = null;
    this.hoverTarget = null;
    this.paused = false;
    this.running = false;         // в бою (после «Начать оборону»)
    this.over = false;
    this.energyDeficit = false;
    this.effects = [];            // визуальные события текущих кадров
    this.effectAging = [];        // {event, life}
    this.lastTime = 0;
    this.fpsCounter = { frames: 0, t: 0, value: 60 };
    this.gameTime = 0;
    this.lowFocusWarned = false;

    this.applyAccessibilityToDom();
    this.bindEvents();
    this.resize();
    this.regenerateTerrain(this.adminSettings.terrainSeed, this.adminSettings.terrainArchetype, this.adminSettings.obstacleProfile, true);
    this.ui.show('start');
    requestAnimationFrame((t) => { this.lastTime = t; this.loop(t); });
  }

  /* ── Настройки/сложность ──────────────────────────────────────── */
  difficultyMul() {
    const id = this.settings.difficulty || 'standard';
    if (id === 'custom') return { ...DIFFICULTY_PRESETS.custom, ...this.adminSettings.customDifficulty };
    return { ...DIFFICULTY_PRESETS[id] || DIFFICULTY_PRESETS.standard };
  }

  queueDifficulty(id) {
    this.settings.pendingDifficulty = id;
    saveJSON(SK.settings, this.settings);
    this.ui.toast(`Сложность «${DIFFICULTY_PRESETS[id]?.name || id}» применится со следующей волны`, 'info');
  }

  applyPendingDifficulty(id) {
    if (!id || id === this.settings.difficulty) return;
    this.settings.pendingDifficulty = id;
    this.saveSettings();
    this.ui.toast(`Сложность «${DIFFICULTY_PRESETS[id]?.name}» применится со следующей волны`, 'info');
  }

  commitPendingDifficulty() {
    if (this.settings.pendingDifficulty) {
      this.settings.difficulty = this.settings.pendingDifficulty;
      this.settings.pendingDifficulty = null;
      this.saveSettings();
      this.waves.setDifficulty(this.difficultyMul());
      this.ui.toast('Новая сложность активна с этой волны', 'ok');
    }
  }

  saveSettings() { saveJSON(SK.settings, this.settings); }
  saveAccessibility() { saveJSON(SK.accessibility, this.accessibility); }
  saveCrSettings() { saveJSON(SK.controlRecovery, this.crSettings); }
  saveAdminSettings() { saveJSON(SK.admin, this.adminSettings); }
  saveAudioSettings() { saveJSON(SK.audio, this.audio.settings); }
  saveBest() { saveNumber(SK.bestScore, this.bestScore); }

  reloadAllSettings() {
    this.settings = loadJSON(SK.settings, DEFAULT_SETTINGS);
    this.accessibility = loadJSON(SK.accessibility, DEFAULT_ACCESSIBILITY);
    this.crSettings = loadJSON(SK.controlRecovery, DEFAULT_CONTROL_RECOVERY);
    this.adminSettings = loadJSON(SK.admin, DEFAULT_ADMIN);
    this.audioSettings = loadJSON(SK.audio, {});
    this.cr.settings = this.crSettings;
    this.applyAccessibilityToDom();
    this.setQuality(this.settings.quality);
    this.regenerateTerrain(this.adminSettings.terrainSeed, this.adminSettings.terrainArchetype, this.adminSettings.obstacleProfile);
  }

  setAccessibility(a) {
    this.accessibility = { ...a };
    this.stress.accessibility = this.accessibility;
    this.focusVisuals.setAccessibility(this.accessibility);
    this.applyAccessibilityToDom();
    this.saveAccessibility();
  }

  applyAccessibilityToDom() {
    const r = document.documentElement;
    r.classList.toggle('reduced-motion', !!this.accessibility.reducedMotion);
    r.classList.toggle('reduce-stress', !!this.accessibility.reduceVisualStress);
    r.classList.toggle('high-contrast', !!this.accessibility.highContrast);
    r.style.setProperty('--ui-scale', String(this.accessibility.uiScale || 1));
    this.renderer.quality = this.settings.quality;
  }

  setQuality(q) {
    this.settings.quality = q;
    this.renderer.quality = q;
    this.particles.setMax(RENDER.maxParticles[q] || 120);
    this.saveSettings();
    if (this.terrain) {
      this.terrain.invalidateCache();
      this.terrainCache = this.terrain.buildCache(this.terrainCanvasSize());
    }
  }

  terrainCanvasSize() {
    const base = { low: 512, medium: 896, high: 1280 }[this.settings.quality] || 896;
    return base;
  }

  regenerateTerrain(seed, archetypeId, obstacleProfile, silent = false) {
    this.terrain = new TerrainGenerator(seed, archetypeId, this.settings.quality);
    this.obstacles = new ObstacleField(seed ^ 0xBADF00D, obstacleProfile);
    this.terrainCache = this.terrain.buildCache(this.terrainCanvasSize());
    this.saveAdminSettings();
    if (!silent && this.running) this.ui.toast('Местность перегенерирована', 'ok');
  }

  /* ── Управление игрой ─────────────────────────────────────────── */
  newGame(difficultyId, mode) {
    this.settings.difficulty = difficultyId || this.settings.difficulty;
    this.settings.mode = mode || 'campaign';
    this.settings.pendingDifficulty = null;
    this.saveSettings();

    this.state = freshState();
    this.state.station.energyRatio = 1;
    this.waves = new WaveManager(this.settings.mode, this.difficultyMul());
    this.cr.reset();
    this.stress.reset();
    this.particles.items = [];
    this.effects = []; this.effectAging = [];
    this.selected = null;
    this.placement = null;
    this.over = false;
    this.paused = false;
    this.running = true;
    this.gameTime = 0;
    this.lowFocusWarned = false;
    this.energyCapacity = RESOURCES.energyCapacityBase;
    this.updateEnergyCapacity();

    this.ui.show('game');
    this.ui.closeAllModals();
    this.ui.showSelectedModule(null);
    this.ui.renderWavePreview(0, true);
    this.ui.toast(this.settings.mode === 'campaign' ? 'Кампания: 12 волн. Удачи, оператор.' : 'Бесконечный режим: держитесь как можно дольше.', 'ok');

    // Аудио стартует только по явному действию пользователя (клик «Начать оборону»)
    if (this.audio.ensureContext()) {
      this.audio.playMusic();
    }
  }

  toStartScreen() {
    this.running = false;
    this.paused = false;
    this.over = false;
    this.audio.stopMusic();
    this.ui.show('start');
    this.ui.updateBestScore(this.bestScore);
  }

  togglePause(force) {
    if (!this.running || this.over) return;
    this.paused = force !== undefined ? force : !this.paused;
    if (this.paused) this.ui.showPause(this);
    else this.ui.closeModal();
  }

  closeAllModalsSoft() { this.ui.closeAllModals(); }

  gameOver(victory) {
    if (this.over) return;
    this.over = true;
    this.running = false;
    this.audio.sfx(victory ? 'victory' : 'gameover');
    this.audio.stopMusic();
    let score = Math.round(this.state.score);
    if (victory) {
      score += Math.round((this.state.station.integrity / RESOURCES.integrityMax) * SCORING.integrityBonusPer10 * 10);
    }
    const best = score > this.bestScore;
    if (best) { this.bestScore = score; this.saveBest(); }
    this.ui.updateBestScore(this.bestScore);
    this.ui.showGameOver(score, this.bestScore, victory, this.waves.waveIndex);
  }

  /* ── Ресурсы ──────────────────────────────────────────────────── */
  updateEnergyCapacity() {
    this.energyCapacity = RESOURCES.energyCapacityBase
      + this.state.modules.length * RESOURCES.energyCapacityPerModule;
  }

  /* Выработка сети: реактор + бонус за волны; растёт с номером волны (реалистичная модернизация) */
  get reactorOutput() {
    const diff = this.difficultyMul();
    return (RESOURCES.reactorBasePerSec + this.waves.waveNumber * RESOURCES.energyRegenBonusPerWave)
      * (diff.energyMul || 1);
  }

  spendEnergy(amount) {
    this.state.energy = Math.max(0, this.state.energy - amount);
  }

  get totalEnergyUse() {
    return this.state.modules.reduce((s, m) => s + m.energyUse, 0);
  }

  /* ── Размещение модулей ───────────────────────────────────────── */
  beginPlacement(typeId) {
    if (!this.running || this.over) return;
    const def = MODULE_TYPES[typeId];
    if (this.state.credits < def.cost) {
      this.audio.sfx('error');
      this.ui.toast(`Не хватает кредитов: нужно ${def.cost}◈`, 'error');
      return;
    }
    this.placement = { typeId, def, x: 0, y: 0, valid: false };
    this.ui.toast(`Размещение: ${def.ru}. Кликните по карте. Esc — отмена.`);
  }

  tryPlace(x, y) {
    const p = this.placement;
    if (!p) return;
    const check = canPlaceModuleAt(x, y, this.state.modules, this.terrain.sample(x, y),
      (qx, qy, qr) => this.obstacles.query(qx, qy, qr));
    if (!check.ok) {
      this.audio.sfx('error');
      this.ui.toast(check.reason, 'error');
      return;
    }
    if (this.state.credits < p.def.cost) {
      this.audio.sfx('error');
      this.ui.toast('Не хватает кредитов', 'error');
      return;
    }
    const m = new DefenseModule(p.typeId, x, y);
    this.state.modules.push(m);
    this.state.credits -= p.def.cost;
    this.placement = null;
    this.selected = m;
    this.updateEnergyCapacity();
    this.audio.sfx('build');
    this.particles.spawnRing(x, y, m.def.color, 40);
    this.ui.showSelectedModule(m);
    this.ui.toast(`${m.def.ru} построен (−${p.def.cost}◈)`, 'ok');
  }

  selectModuleAt(x, y) {
    let best = null, bestD = 30;
    for (const m of this.state.modules) {
      const d = dist(m.x, m.y, x, y);
      if (d < bestD) { bestD = d; best = m; }
    }
    this.selected = best;
    this.ui.showSelectedModule(best);
  }

  upgradeSelected() {
    const m = this.selected;
    if (!m) return;
    if (!m.canUpgrade()) { this.ui.toast('Достигнут максимальный уровень', 'warn'); return; }
    const cost = m.upgradeCost;
    if (this.state.credits < cost) { this.audio.sfx('error'); this.ui.toast(`Нужно ${cost}◈`, 'error'); return; }
    m.upgrade();
    this.state.credits -= cost;
    this.updateEnergyCapacity();
    this.audio.sfx('upgrade');
    this.particles.spawnRing(m.x, m.y, m.def.color, 30);
    this.ui.showSelectedModule(m);
    this.ui.toast(`Улучшение: ${MODULE_TYPES[m.typeId].upgrades[m.upgradeIndex - 1].name}`, 'ok');
  }

  sellSelected() {
    const m = this.selected;
    if (!m) return;
    const refund = m.sellValue();
    this.state.modules = this.state.modules.filter(x => x !== m);
    this.state.credits += refund;
    this.selected = null;
    this.updateEnergyCapacity();
    this.audio.sfx('sell');
    this.ui.showSelectedModule(null);
    this.ui.toast(`Модуль продан (+${refund}◈)`, 'ok');
  }

  cycleTargeting() {
    const m = this.selected;
    if (!m) return;
    const idx = TARGETING.options.indexOf(m.targeting);
    m.targeting = TARGETING.options[(idx + 1) % TARGETING.options.length];
    this.ui.showSelectedModule(m);
  }

  moduleStatLines(m) { return moduleStatsLines(m); }

  /* ── Focus ────────────────────────────────────────────────────── */
  activateFocusMode(modeId) {
    if (!this.running || this.over) return;
    const res = this.cr.activate(modeId);
    if (!res.ok) {
      this.audio.sfx('error');
      this.ui.toast(res.reason, 'warn');
      return;
    }
    this.audio.sfx('focus');
    this.audio.duck(0.6);
    this.ui.toast(`Focus: ${res.mode.name}`, 'ok');
  }

  /* ── Ввод ─────────────────────────────────────────────────────── */
  bindEvents() {
    const stage = this.stage;
    stage.addEventListener('mousemove', (e) => {
      const rect = stage.getBoundingClientRect();
      const [wx, wy] = this.renderer.toWorld(e.clientX - rect.left, e.clientY - rect.top);
      if (this.placement) {
        this.placement.x = wx; this.placement.y = wy;
        this.placement.valid = canPlaceModuleAt(wx, wy, this.state.modules, this.terrain.sample(wx, wy),
          (qx, qy, qr) => this.obstacles.query(qx, qy, qr)).ok;
      }
      // hover цель
      this.hoverTarget = null;
      let bd = 26 / Math.max(0.2, this.renderer.scale);
      for (const t of this.state.targets) {
        if (!t.alive) continue;
        const d = dist(t.x, t.y, wx, wy);
        if (d < bd) { bd = d; this.hoverTarget = t; }
      }
    });

    stage.addEventListener('click', (e) => {
      if (!this.audio.ctx) this.audio.ensureContext(); // первый клик разблокирует звук
      if (!this.running || this.over || this.paused) return;
      const rect = stage.getBoundingClientRect();
      const [wx, wy] = this.renderer.toWorld(e.clientX - rect.left, e.clientY - rect.top);
      if (this.placement) { this.tryPlace(wx, wy); return; }
      this.selectModuleAt(wx, wy);
    });

    stage.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (this.placement) { this.placement = null; this.ui.toast('Размещение отменено'); }
    });

    window.addEventListener('resize', () => this.resize());

    document.addEventListener('keydown', (e) => {
      // Ctrl+Shift+P — панель управления
      if (e.ctrlKey && e.shiftKey && (e.key === 'P' || e.key === 'p' || e.code === 'KeyP')) {
        e.preventDefault();
        this.adminPanel.toggle();
        return;
      }
      const tag = (document.activeElement?.tagName || '').toLowerCase();
      if (['input', 'select', 'textarea'].includes(tag)) return;

      if (e.key === 'Escape') {
        if (this.ui.modalsOpen) { this.ui.closeModal(); if (this.paused) this.togglePause(false); return; }
        if (this.adminPanel.open) { this.adminPanel.toggle(false); return; }
        if (this.placement) { this.placement = null; return; }
        if (this.selected) { this.selected = null; this.ui.showSelectedModule(null); }
        return;
      }
      if (!this.running || this.ui.modalsOpen || this.adminPanel.open) return;

      if (e.key === ' ') { e.preventDefault(); this.togglePause(); return; }
      if (e.key === 'f' || e.key === 'F' || e.key === 'а' || e.key === 'А') {
        this.settings.gameSpeed = this.settings.gameSpeed === 1 ? 2 : 1;
        this.saveSettings(); return;
      }
      if (this.placement && (e.key === 'f' || e.key === 'F')) { this.placement = null; return; }
      if ((e.key === 'u' || e.key === 'U' || e.key === 'г' || e.key === 'Г') && this.selected) { this.upgradeSelected(); return; }
      if ((e.key === 'x' || e.key === 'X' || e.key === 'ч' || e.key === 'Ч') && this.selected) { this.sellSelected(); return; }
      if ((e.key === 't' || e.key === 'T' || e.key === 'е' || e.key === 'Е') && this.selected) { this.cycleTargeting(); return; }

      const focusId = KEYS.focusKeys[e.key.toLowerCase()];
      if (focusId) { this.activateFocusMode(focusId); return; }

      // Быстрая постройка: 1..5
      const num = parseInt(e.key, 10);
      const ids = Object.keys(MODULE_TYPES);
      if (num >= 1 && num <= ids.length) this.beginPlacement(ids[num - 1]);
    });
  }

  resize() {
    const w = this.stage.clientWidth || window.innerWidth;
    const h = this.stage.clientHeight || window.innerHeight;
    const cap = RENDER.dprCap[this.settings.quality] || 1.5;
    this.renderer.resize(w, h, cap);
    this.terrainCache = this.terrain?.buildCache(this.terrainCanvasSize());
    this.renderer.drawTerrain(this.terrainCache);
  }

  /* ── Игровой цикл ─────────────────────────────────────────────── */
  loop(now) {
    requestAnimationFrame((t) => this.loop(t));
    const rawDt = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;

    this.fpsCounter.frames++;
    this.fpsCounter.t += rawDt;
    if (this.fpsCounter.t >= 0.5) {
      this.fpsCounter.value = Math.round(this.fpsCounter.frames / this.fpsCounter.t);
      this.fpsCounter.frames = 0; this.fpsCounter.t = 0;
    }

    if (this.running && !this.paused && !this.over) {
      const timeScale = (this.settings.gameSpeed || 1) * (this.cr.effect?.timeScale ?? 1);
      const dt = rawDt * timeScale;
      this.gameTime += dt;
      this.update(dt);
    }
    this.render(rawDt);
    this.ui.updateHud(this);
  }

  update(dt) {
    const s = this.state;
    const diff = this.difficultyMul();

    /* Экономика: кредиты капают пассивно; энергия — «заряд сети» с расходом на залпы */
    s.credits += RESOURCES.passiveIncomePerSec * (diff.creditMul || 1) * dt;
    this.updateEnergyCapacity();
    const use = this.totalEnergyUse;
    s.energy = clamp(s.energy + this.reactorOutput * dt, 0, this.energyCapacity);
    this.energyDeficit = use > this.energyCapacity || s.energy < this.energyCapacity * 0.15;
    // При дефиците энергии боевые модули недобирают темп (мягкий игровой эффект)
    const powerRatio = this.energyDeficit ? clamp(this.energyCapacity / (use || 1), 0.4, 1) : 1;

    /* Волны */
    const spawnIds = this.waves.update(dt);
    for (const typeId of spawnIds) {
      const [sx, sy] = spawnPointFor(this.rng);
      const mul = { ...diff, hpMul: diff.hpMul * this.waves.hpScale };
      const t = new Target(typeId, sx, sy, mul);
      t.enteredFieldAt = this.gameTime;
      s.targets.push(t);
    }

    /* Цели */
    for (const t of s.targets) {
      if (!t.alive) continue;
      t.priorityScore = computePriority(t);
      t.update(dt, this.gameTime, (target) => this.onStationHit(target));
    }

    /* Модули */
    const auraProviders = s.modules.filter(m => m.typeId === 'sentinel');
    const ctx = { station: s.station, auraProviders, gameTime: this.gameTime };
    const aliveTargets = s.targets.filter(t => t.alive);
    for (const m of s.modules) {
      // При дефиците энергии активные модули стреляют/замедляют медленнее (мягкий эффект)
      const modDt = (m.cooldownMax > 0 || m.typeId === 'veil') ? dt * powerRatio : dt;
      const events = m.update(modDt, this.gameTime, aliveTargets, ctx);
      for (const ev of events) this.pushEffect(ev);
      if (events.some(e => e.kind === 'arc-shot')) this.audio.sfx('shot');
      if (events.some(e => e.kind === 'pulse-wave')) this.audio.sfx('pulse');
      if (events.some(e => e.kind === 'veil-pulse')) { /* тихий пассивный эффект */ }
    }

    /* Убитые цели */
    for (const t of s.targets) {
      if (!t.alive && !t.counted) {
        t.counted = true;
        this.waves.onTargetResolved(!t.impacted);
        if (!t.impacted) {
          s.credits += t.reward;
          s.score += Math.round(t.threat * SCORING.perKillThreat / 6 + t.reward);
          this.particles.spawnBurst(t.x, t.y, t.def.color, this.settings.quality === 'low' ? 4 : 8);
          this.audio.sfx('kill');
        }
      }
    }
    s.targets = s.targets.filter(t => t.alive);

    /* Окончание волны */
    if (this.waves.tryCompleteWave(s.targets.length)) {
      const bonus = Math.round(RESOURCES.waveClearBonusBase * (diff.creditMul || 1));
      s.credits += bonus;
      s.score += SCORING.perWaveClear * (this.waves.mode === 'endless' ? this.waves.waveNumber : 1);
      this.commitPendingDifficulty();
      this.audio.sfx('waveClear');
      if (this.waves.state === 'ended') {
        this.gameOver(true);
        return;
      }
      this.ui.toast(`Волна зачищена · +${bonus}◈`, 'ok');
    }
    // Старт волны: подтверждение сложности и подсказка
    if (this.waves.state === 'active' && !this._waveAnnouncedThisWave) {
      this._waveAnnouncedThisWave = true;
      this.audio.sfx('waveStart');
      this.audio.duck(1);
      this.ui.toast(`Волна ${this.waves.waveNumber} началась`, 'warn');
    }
    if (this.waves.state === 'prep') this._waveAnnouncedThisWave = false;

    /* Стресс/Focus */
    this.stress.update(dt, {
      nearThreats: s.targets.filter(t => t.alive && t.radiusFromCenter < STRESS.nearThreatRadius).length,
      unknownSignals: s.targets.filter(t => t.alive && t.phantom && !t.revealed).length,
      energyDeficit: this.energyDeficit,
      sceneTargets: s.targets.length,
      stressMul: diff.stressMul || 1,
      calmPower: s.modules.filter(m => m.typeId === 'veil').reduce((a, m) => a + m.stressCalm, 0),
      eventsEnabled: this.adminSettings.stressEventsEnabled
    }, this.cr.effect);
    this.stress.onEvent = (ev) => {
      if (this.accessibility.soundCuesText) this.ui.toast(`⚠ ${ev.text}`, 'warn');
      this.audio.sfx('alert');
    };
    this.cr.update(dt);

    if (this.cr.band === 'low' && this.crSettings.focusAutoPause && !this.lowFocusWarned) {
      this.lowFocusWarned = true;
      this.ui.toast('Фокус низкий — доступен один режим восстановления (Q/W/E/R)', 'warn');
    }
    if (this.cr.band !== 'low') this.lowFocusWarned = false;

    /* Станция/частицы/эффекты */
    s.station.energyRatio = clamp(s.energy / (this.energyCapacity || 1), 0, 1);
    s.station.update(dt, this.gameTime);
    this.particles.update(dt);
    for (let i = this.effectAging.length - 1; i >= 0; i--) {
      this.effectAging[i].life -= dt;
      if (this.effectAging[i].life <= 0) this.effectAging.splice(i, 1);
    }

    if (s.station.destroyed) this.gameOver(false);
  }

  onStationHit(target) {
    const dmg = target.damage * (this.difficultyMul().stressMul || 1) ** 0.5;
    this.state.station.hit(dmg, this.gameTime);
    this.stress.damageBurst(this.difficultyMul().stressMul || 1);
    this.audio.sfx('hit');
    this.audio.duck(1);
    this.particles.spawnBurst(target.x, target.y, '#ff6b8a', 10, 120);
    this.ui.toast(`Попадание по станции: −${Math.round(dmg)}% целостности`, 'error');
    this.waves.onTargetResolved(false);
    target.counted = true;
  }

  pushEffect(ev) {
    const life = ev.kind === 'reveal' ? 1.2 : ev.kind === 'arc-shot' ? 0.14 : 0.5;
    this.effectAging.push({ event: ev, life, maxLife: life });
  }

  render(rawDt) {
    const r = this.renderer;
    const s = this.state;
    // Terrain перерисовывается только при сбросе кэша — здесь просто blit
    r.drawTerrain(this.terrainCache);

    const focusEffect = this.cr.effect;
    const overlay = this.focusVisuals.overlayParams(focusEffect, this.gameTime);
    const uiNoise = this.cr.uiNoise(this.stress.visualNoise);

    r.drawWorld({
      gameTime: this.gameTime, station: s.station, targets: s.targets, modules: s.modules,
      obstacles: this.obstacles, focusEffect, stress: this.stress, a11y: this.accessibility,
      showRings: this.settings.showRings, placement: this.placement
    });

    // Эффектный слой
    const liveEffects = this.effectAging.map(a => ({
      ...a.event,
      life: a.life / a.maxLife
    }));
    r.ctxs.effects.setTransform(r.dpr, 0, 0, r.dpr, 0, 0);
    r.ctxs.effects.clearRect(0, 0, r.view.w, r.view.h);
    if (this.adminSettings.particles !== false) r.drawAmbient(this.gameTime, this.accessibility);
    r.drawEffects(liveEffects, this.adminSettings.particles === false ? { items: [] } : this.particles);

    r.drawInteraction({
      focusOverlay: overlay, uiNoise: this.accessibility.reduceVisualStress ? 0 : uiNoise,
      selected: this.selected, hoverTarget: this.hoverTarget,
      debug: this.settings.debugOverlays, a11y: this.accessibility,
      gameTime: this.gameTime, panicState: this.stress.panicState,
      fps: this.fpsCounter.value, targetCount: s.targets.length,
      moduleCount: s.modules.length, obstacleCount: this.obstacles.count,
      obstacles: this.obstacles, auraProviders: s.modules.filter(m => m.typeId === 'sentinel')
    });

    // Мягкая подсветка корпуса HUD под состоянием паники
    const hud = document.getElementById('hud');
    if (hud) hud.dataset.panic = this.stress.panicState;
    document.body.className = document.body.className.replace(/focus-band-\S+/g, '').trim();
    document.body.classList.add(`focus-band-${this.cr.band}`);
    const fc = this.focusVisuals.hudClasses(this.cr.band, this.cr.activeMode);
    document.getElementById('ui-root')?.setAttribute('data-focus', fc);
  }
}

function freshState() {
  return {
    station: new Station(),
    targets: [],
    modules: [],
    credits: RESOURCES.startCredits,
    energy: RESOURCES.energyCapacityBase,
    score: 0
  };
}

/* ── Bootstrap ──────────────────────────────────────────────────── */
export function boot() {
  document.title = `${PROJECT_NAME} — оборона Helios Station`;
  try {
    window.__game = new Game();
  } catch (err) {
    // Мягкий fallback: показываем человекочитаемую ошибку вместо пустого экрана
    const root = document.getElementById('ui-root');
    if (root) {
      const box = document.createElement('div');
      box.className = 'fatal-fallback glass';
      box.innerHTML = `<h2>PVOGame.ru не удалось запуститься</h2><p>${String(err.message || err)}</p>
        <p class="muted">Проверьте, что открываете index.html через локальный статический сервер (см. README).</p>`;
      root.appendChild(box);
    }
    throw err;
  }
}

/* PVOGame.ru — локальная панель «Управление».
   Это внутриигровая панель настроек (не защищённая админка): всё живёт в localStorage. */

import {
  PROJECT_NAME, PROJECT_VERSION, DIFFICULTY_PRESETS, AUDIO, TERRAIN, OBSTACLES,
  DEFAULT_SETTINGS, DEFAULT_ACCESSIBILITY, DEFAULT_CONTROL_RECOVERY, DEFAULT_ADMIN, STRESS
} from './config.js';
import { KEYS as STORAGE_KEYS, clearAll, exportConfig, importConfig } from './storage.js';
import { el, fmt } from './utils.js';

const TABS = [
  ['overview', 'Обзор'], ['game', 'Игра'], ['balance', 'Баланс'], ['atmosphere', 'Атмосфера'],
  ['audio', 'Аудио и музыка'], ['accessibility', 'Доступность'], ['data', 'Данные'],
  ['about', 'О проекте'], ['terrain', 'Местность'], ['visual', 'Визуал']
];

export class AdminPanel {
  constructor(game) {
    this.game = game;
    // Локальный черновик: правки копятся здесь, «Применить» переносит в игру
    this.draft = {
      settings: { ...game.settings },
      accessibility: { ...game.accessibility },
      controlRecovery: { ...game.crSettings },
      admin: { ...game.adminSettings },
      audio: { ...game.audio.settings },
      terrain: { seed: game.adminSettings.terrainSeed, archetype: game.adminSettings.terrainArchetype, quality: game.settings.quality, obstacleProfile: game.adminSettings.obstacleProfile }
    };
    this.open = false;
    this.activeTab = 'overview';
    this._build();
  }

  _build() {
    this.root = el('div', {
      class: 'admin-panel glass hidden', id: 'admin-panel', role: 'dialog',
      'aria-label': 'Локальная панель управления PVOGame.ru'
    });
    const tabButtons = TABS.map(([id, label]) =>
      el('button', {
        class: 'tab-btn', 'data-tab': id, text: label,
        onclick: () => this.selectTab(id)
      }));
    this.header = el('div', { class: 'admin-header' }, [
      el('h2', { text: `Управление · ${PROJECT_NAME}` }),
      el('button', { class: 'btn small', text: '✕ Закрыть', onclick: () => this.toggle(false), 'aria-label': 'Закрыть панель управления' })
    ]);
    this.tabBar = el('div', { class: 'admin-tabs', role: 'tablist' }, tabButtons);
    this.body = el('div', { class: 'admin-body' });
    this.footer = el('div', { class: 'admin-footer' }, [
      el('span', { class: 'draft-note muted', text: 'Черновик: изменения применяются кнопкой «Применить».' }),
      el('button', { class: 'btn btn-primary', text: 'Применить', onclick: () => this.apply() }),
      el('button', { class: 'btn', text: 'Сбросить черновик', onclick: () => this.reloadDraft() }),
      el('button', { class: 'btn danger', text: 'Сброс настроек к заводским', onclick: () => this.factoryReset() })
    ]);
    this.root.append(this.header, this.tabBar, this.body, this.footer);
    document.getElementById('ui-root').appendChild(this.root);
    this.selectTab('overview');
  }

  toggle(force) {
    this.open = force !== undefined ? !!force : !this.open;
    this.root.classList.toggle('hidden', !this.open);
    if (this.open) {
      this.reloadDraft();
      this.header.querySelector('button')?.focus();
    }
  }

  reloadDraft() {
    const g = this.game;
    this.draft = {
      settings: { ...g.settings },
      accessibility: { ...g.accessibility },
      controlRecovery: { ...g.crSettings },
      admin: { ...g.adminSettings },
      audio: { ...g.audio.settings },
      terrain: { seed: g.adminSettings.terrainSeed, archetype: g.adminSettings.terrainArchetype, quality: g.settings.quality, obstacleProfile: g.adminSettings.obstacleProfile }
    };
    this.renderBody();
  }

  selectTab(id) {
    this.activeTab = id;
    for (const b of this.tabBar.children) {
      b.classList.toggle('active', b.dataset.tab === id);
      b.setAttribute('aria-selected', String(b.dataset.tab === id));
    }
    this.renderBody();
  }

  /* ── Виджеты форм ─────────────────────────────────────────────── */
  _slider(label, keyPath, min, max, step, onChange) {
    const get = () => getPath(this.draft, keyPath);
    const val = el('span', { class: 'slider-val', text: fmt(get(), step < 1 ? 2 : 0) });
    const input = el('input', {
      type: 'range', min, max, step, value: get(), 'aria-label': label,
      oninput: () => { setPath(this.draft, keyPath, Number(input.value)); val.textContent = fmt(Number(input.value), step < 1 ? 2 : 0); onChange && onChange(); }
    });
    return row(label, el('div', { class: 'slider-line' }, [input, val]));
  }

  _select(label, keyPath, options, onChange) {
    const get = () => getPath(this.draft, keyPath);
    const sel = el('select', {
      class: 'input', 'aria-label': label,
      onchange: () => { setPath(this.draft, keyPath, sel.value); onChange && onChange(); }
    }, options.map(([v, t]) => el('option', { value: v, text: t, selected: get() === v })));
    return row(label, sel);
  }

  _check(label, keyPath, onChange) {
    const get = () => !!getPath(this.draft, keyPath);
    const cb = el('input', {
      type: 'checkbox', checked: get(), 'aria-label': label,
      onchange: () => { setPath(this.draft, keyPath, cb.checked); onChange && onChange(); }
    });
    return row(label, cb);
  }

  _number(label, keyPath, onChange) {
    const get = () => getPath(this.draft, keyPath);
    const inp = el('input', {
      class: 'input num', type: 'number', value: get(), 'aria-label': label, min: 1, step: 1,
      oninput: () => { setPath(this.draft, keyPath, Math.abs(Math.floor(Number(inp.value) || 1))); onChange && onChange(); }
    });
    return row(label, inp);
  }

  /* ── Вкладки ──────────────────────────────────────────────────── */
  renderBody() {
    this.body.innerHTML = '';
    const r = this.body;
    switch (this.activeTab) {
      case 'overview': r.append(...this._tabOverview()); break;
      case 'game': r.append(...this._tabGame()); break;
      case 'balance': r.append(...this._tabBalance()); break;
      case 'atmosphere': r.append(...this._tabAtmosphere()); break;
      case 'audio': r.append(...this._tabAudio()); break;
      case 'accessibility': r.append(...this._tabA11y()); break;
      case 'data': r.append(...this._tabData()); break;
      case 'about': r.append(...this._tabAbout()); break;
      case 'terrain': r.append(...this._tabTerrain()); break;
      case 'visual': r.append(...this._tabVisual()); break;
      default: break;
    }
  }

  _tabOverview() {
    const g = this.game;
    const info = el('div', { class: 'admin-grid' }, [
      kv('Режим', g.waves.mode === 'campaign' ? 'Кампания' : 'Бесконечный'),
      kv('Волна', String(g.waves.waveNumber)),
      kv('Сложность', DIFFICULTY_PRESETS[g.settings.difficulty]?.name || ''),
      kv('Целостность', `${Math.ceil(g.state.station.integrity)}%`),
      kv('Кредиты', fmt(g.state.credits)),
      kv('Энергия', `${fmt(g.state.energy)}/${fmt(g.energyCapacity)}`),
      kv('Фокус', fmt(g.cr.focus)),
      kv('Стресс сети', fmt(g.stress.networkStress)),
      kv('Самообладание', fmt(g.stress.operatorComposure)),
      kv('Состояние HUD', g.stress.stateLabelRu),
      kv('Очки', fmt(g.state.score)),
      kv('Рекорд', fmt(g.bestScore)),
      kv('Модулей', String(g.state.modules.length)),
      kv('Целей на поле', String(g.state.targets.filter(t => t.alive).length))
    ]);
    return [el('p', { class: 'muted', text: 'Текущее состояние игры. Панель локальная: ничего не отправляется в сеть.' }), info];
  }

  _tabGame() {
    return [
      this._select('Сложность (со следующей волны)', 'settings.pendingDifficulty',
        [['', '— без изменений'], ...Object.entries(DIFFICULTY_PRESETS).map(([k, d]) => [k, d.name])]),
      this._select('Скорость игры', 'settings.gameSpeed', [[1, '×1'], [2, '×2 (быстрая)']]),
      this._check('Художественные стресс-события', 'admin.stressEventsEnabled'),
      this._slider('Базовый шум интерфейса', 'controlRecovery.noiseFloor', 0, 1, 0.05),
      this._check('Система Focus включена', 'controlRecovery.enabled'),
      this._check('Подсказка при низком фокусе', 'controlRecovery.focusAutoPause'),
      el('p', { class: 'muted', text: `Стресс: +${STRESS.perNearThreatPerSec}/с за цель в ближней зоне, спад ${STRESS.stressDecayPerSec}/с.` })
    ];
  }

  _tabBalance() {
    const rows = [];
    rows.push(el('p', { class: 'muted', text: 'Коэффициенты пользовательской сложности. Чтобы они действовали, выберите сложность «Пользовательский».' }));
    const coef = [
      ['hpMul', 'Прочность целей', 0.3, 3, 0.05],
      ['speedMul', 'Скорость целей', 0.3, 2.5, 0.05],
      ['countMul', 'Численность волн', 0.3, 3, 0.05],
      ['stressMul', 'Наращивание стресса', 0.2, 3, 0.05],
      ['creditMul', 'Доход кредитов', 0.3, 3, 0.05],
      ['energyMul', 'Генерация энергии', 0.3, 2.5, 0.05]
    ];
    for (const [k, name, min, max, step] of coef) {
      rows.push(this._slider(name, 'admin.customDifficulty.' + k, min, max, step));
    }
    return rows;
  }

  _tabAtmosphere() {
    return [
      this._check('Показывать кольца зон', 'settings.showRings'),
      this._check('Debug-оверлеи', 'settings.debugOverlays'),
      this._slider('Темп пульсации ядра', 'admin.corePulse', 0, 2, 0.05),
      el('p', { class: 'muted', text: 'Атмосферные эффекты намеренно мягкие: без тряски, стробинга и резких вспышек.' })
    ];
  }

  _tabAudio() {
    const g = this.game;
    const a = [];
    a.push(row('Профиль музыки', (() => {
      const sel = el('select', { class: 'input', 'aria-label': 'Профиль процедурной музыки' },
        Object.entries(AUDIO.profiles).map(([k, p]) => el('option', { value: k, text: p.name, selected: g.audio.musicProfileId === k })));
      sel.onchange = () => { this.draft.audio.profile = sel.value; };
      return sel;
    })()));
    a.push(this._slider('Master', 'audio.master', 0, 1, 0.05));
    a.push(this._slider('Музыка', 'audio.music', 0, 1, 0.05));
    a.push(this._slider('Ambient', 'audio.ambient', 0, 1, 0.05));
    a.push(this._slider('Эффекты', 'audio.effects', 0, 1, 0.05));
    a.push(this._slider('Оповещения', 'audio.alerts', 0, 1, 0.05));
    a.push(this._check('Полная тишина (mute)', 'audio.muted'));
    a.push(el('h3', { class: 'sub-title', text: 'Пользовательская музыка (локально)' }));
    a.push(el('p', { class: 'muted', text: 'Файл не покидает браузер: воспроизведение через локальный object URL. Форматы: mp3/ogg/wav/m4a/aac — если поддерживает браузер.' }));
    const fileInput = el('input', {
      type: 'file', accept: '.mp3,.ogg,.wav,.m4a,.aac,audio/*', 'aria-label': 'Загрузить локальный аудиофайл',
      onchange: async () => {
        const f = fileInput.files[0];
        if (!f) return;
        await g.audio.loadUserFile(f);
        fileInput.value = '';
        this.renderTrackList();
      }
    });
    a.push(fileInput);
    this.trackListBox = el('div', { class: 'track-list' });
    a.push(this.trackListBox);
    this.renderTrackList();
    return a;
  }

  renderTrackList() {
    if (!this.trackListBox) return;
    const g = this.game;
    this.trackListBox.innerHTML = '';
    g.audio.userPlaylist.forEach((t, i) => {
      this.trackListBox.appendChild(el('div', { class: 'track-row' }, [
        el('button', {
          class: 'btn tiny ' + (g.audio.userTrack === t ? 'btn-primary' : ''),
          text: '▶', title: 'Воспроизвести',
          onclick: () => { g.audio.selectUserTrack(i); g.audio.playUserTrack(); this.renderTrackList(); }
        }),
        el('span', { class: 'track-name', text: t.name }),
        el('span', { class: 'muted', text: `${(t.size / 1024).toFixed(0)} КБ · ${t.duration ? t.duration.toFixed(0) + ' с' : '…'}` })
      ]));
    });
    if (!g.audio.userPlaylist.length) {
      this.trackListBox.appendChild(el('p', { class: 'muted', text: 'Треки не загружены.' }));
    }
  }

  _tabA11y() {
    return [
      this._check('Reduced motion (убрать лишнее движение)', 'accessibility.reducedMotion'),
      this._check('Reduce visual stress (убрать шум/глитч-избыток)', 'accessibility.reduceVisualStress'),
      this._check('Высокий контраст', 'accessibility.highContrast'),
      this._slider('Масштаб интерфейса', 'accessibility.uiScale', 0.85, 1.6, 0.05),
      this._check('Дублировать звук текстом', 'accessibility.soundCuesText'),
      el('p', { class: 'muted', text: 'Все настройки доступности сохраняются локально и применяются сразу после «Применить».' })
    ];
  }

  _tabData() {
    const g = this.game;
    const doExport = () => {
      const obj = exportConfig();
      const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = el('a', { href: url, download: 'pvogame-config.json' });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      g.ui.toast('Конфиг экспортирован локально', 'ok');
    };
    const importInput = el('input', {
      type: 'file', accept: '.json,application/json', 'aria-label': 'Импортировать конфиг JSON',
      onchange: async () => {
        const f = importInput.files[0];
        if (!f) return;
        try {
          const text = await f.text();
          importConfig(JSON.parse(text));
          g.reloadAllSettings();
          this.reloadDraft();
          g.ui.toast('Конфиг импортирован', 'ok');
        } catch (e) {
          g.ui.toast('Ошибка импорта: ' + e.message, 'error');
        }
        importInput.value = '';
      }
    });
    return [
      el('p', { class: 'muted', text: 'Локальные данные хранятся в localStorage под префиксом pvogame-. Экспорт/импорт работают без сети.' }),
      kv('Рекорд', fmt(g.bestScore)),
      el('div', { class: 'btn-row' }, [
        el('button', { class: 'btn', text: 'Экспорт конфига (JSON)', onclick: doExport }),
        importInput
      ]),
      el('div', { class: 'btn-row' }, [
        el('button', {
          class: 'btn danger', text: 'Очистить localStorage игры', onclick: () => {
            clearAll();
            g.ui.toast('Локальные данные очищены', 'warn');
          }
        }),
        el('button', {
          class: 'btn', text: 'Сбросить рекорд', onclick: () => { g.bestScore = 0; g.saveBest(); this.reloadDraft(); }
        })
      ])
    ];
  }

  _tabAbout() {
    return [
      el('p', {}, [el('b', { text: PROJECT_NAME }), el('span', { text: ` v${PROJECT_VERSION}` })]),
      el('p', { text: 'Локальная браузерная игра: абстрактная оборона вымышленной станции Helios Station от волн синтетических sci-fi сигналов.' }),
      el('p', { class: 'fiction-note', text: 'Полностью вымышленный сеттинг. Не содержит реальных стран, армий, карт, геоданных и прикладных систем. Работает офлайн: HTML5 + Canvas 2D + Web Audio API + localStorage.' }),
      el('ul', {}, [
        el('li', { text: 'Никакого backend и npm-зависимостей' }),
        el('li', { text: 'Запуск: открыть index.html или любой статический сервер' }),
        el('li', { text: 'Пользовательские аудиофайлы не покидают браузер' })
      ])
    ];
  }

  _tabTerrain() {
    const randBtn = el('button', {
      class: 'btn', text: '🎲 Случайный seed',
      onclick: () => {
        this.draft.terrain.seed = Math.floor(Math.random() * 0x7fffffff);
        this.numberInputs.seed.value = this.draft.terrain.seed;
      }
    });
    this.numberInputs = this.numberInputs || {};
    const seedRow = this._number('Seed местности', 'terrain.seed');
    this.numberInputs.seed = seedRow.querySelector('input');
    return [
      el('p', { class: 'muted', text: 'Местность полностью процедурная и детерминированная по seed. Никаких реальных карт/координат/спутниковых данных.' }),
      seedRow,
      randBtn,
      this._select('Архетип карты', 'terrain.archetype',
        Object.entries(TERRAIN.archetypes).map(([k, v]) => [k, v.name])),
      this._select('Профиль декораций', 'terrain.obstacleProfile',
        Object.entries(OBSTACLES.profiles).map(([k, v]) => [k, v.name])),
      this._select('Качество', 'terrain.quality', [['low', 'Низкое'], ['medium', 'Среднее'], ['high', 'Высокое']]),
      el('p', { class: 'muted', text: 'После применения местность будет перегенерирована заново (кэш сбрасывается).' })
    ];
  }

  _tabVisual() {
    return [
      this._select('Пресет качества рендера', 'settings.quality', [['low', 'Производительность'], ['medium', 'Сбалансированное'], ['high', 'Максимальное']]),
      this._check('Свечение (glow)', 'admin.glow'),
      this._check('Частицы эффектов', 'admin.particles'),
      this._check('Фоновая пыль', 'admin.ambientDust'),
      el('p', { class: 'muted', text: 'Layered canvas: terrain кэшируется в offscreen; world/effects/interaction перерисовываются покадрово с лимитом частиц.' })
    ];
  }

  /* ── Применение черновика ─────────────────────────────────────── */
  apply() {
    const g = this.game, d = this.draft;
    // Настройки игры
    g.settings.gameSpeed = d.settings.gameSpeed;
    g.settings.showRings = d.settings.showRings;
    g.settings.debugOverlays = d.settings.debugOverlays;
    if (d.settings.quality !== g.settings.quality) g.setQuality(d.settings.quality);
    g.settings.quality = d.settings.quality;
    if (d.settings.pendingDifficulty) {
      g.queueDifficulty(d.settings.pendingDifficulty);
      d.settings.pendingDifficulty = '';
    }
    // Доступность
    g.setAccessibility(d.accessibility);
    // Control recovery
    g.crSettings = { ...d.controlRecovery };
    g.cr.settings = g.crSettings;
    g.saveCrSettings();
    // Admin
    g.adminSettings = { ...d.admin };
    g.adminSettings.corePulse = d.admin.corePulse ?? 1;
    g.saveAdminSettings();
    // Terrain/obstacles
    let regen = false;
    if (d.terrain.seed !== g.adminSettings.terrainSeed ||
        d.terrain.archetype !== g.adminSettings.terrainArchetype ||
        d.terrain.obstacleProfile !== g.adminSettings.obstacleProfile ||
        d.terrain.quality !== g.settings.quality) regen = true;
    g.adminSettings.terrainSeed = d.terrain.seed;
    g.adminSettings.terrainArchetype = d.terrain.archetype;
    g.adminSettings.obstacleProfile = d.terrain.obstacleProfile;
    if (regen) g.regenerateTerrain(d.terrain.seed, d.terrain.archetype, d.terrain.obstacleProfile);
    // Аудио
    g.audio.setVolume('master', d.audio.master);
    g.audio.setVolume('music', d.audio.music);
    g.audio.setVolume('ambient', d.audio.ambient);
    g.audio.setVolume('effects', d.audio.effects);
    g.audio.setVolume('alerts', d.audio.alerts);
    g.audio.setMuted(d.audio.muted);
    if (d.audio.profile && d.audio.profile !== g.audio.musicProfileId) {
      g.audio.ensureContext();
      g.audio.setMusicProfile(d.audio.profile);
      if (g.audio.musicMode !== 'play') g.audio.playMusic();
    }
    g.saveAudioSettings();
    g.ui.toast('Настройки применены', 'ok');
    this.reloadDraft();
  }

  factoryReset() {
    const g = this.game;
    g.settings = { ...DEFAULT_SETTINGS };
    g.accessibility = { ...DEFAULT_ACCESSIBILITY };
    g.crSettings = { ...DEFAULT_CONTROL_RECOVERY };
    g.adminSettings = JSON.parse(JSON.stringify({ ...DEFAULT_ADMIN }));
    g.saveSettings(); g.saveAccessibility(); g.saveCrSettings(); g.saveAdminSettings();
    g.applyAccessibilityToDom();
    g.cr.settings = g.crSettings;
    g.setQuality(g.settings.quality);
    g.regenerateTerrain(g.adminSettings.terrainSeed, g.adminSettings.terrainArchetype, g.adminSettings.obstacleProfile);
    g.ui.toast('Настройки сброшены к заводским', 'warn');
    this.reloadDraft();
  }
}

/* ── Хелперы ────────────────────────────────────────────────────── */
function row(label, node) {
  return el('label', { class: 'form-row admin-row' }, [el('span', { class: 'row-label', text: label }), node]);
}
function kv(k, v) {
  return el('div', { class: 'kv' }, [el('span', { class: 'k', text: k }), el('span', { class: 'v', text: v })]);
}
function getPath(obj, path) {
  return path.split('.').reduce((o, k) => o?.[k], obj);
}
function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => (o[k] = o[k] || {}), obj);
  target[last] = value;
}

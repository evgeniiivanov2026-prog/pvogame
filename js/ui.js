/* PVOGame.ru — HTML HUD и экраны: старт, панели, модалки, подсказки.
   Все тексты на русском. Доступность: ARIA, клавиатурная навигация, focus-trap. */

import {
  PROJECT_NAME, MODULE_TYPES, TARGET_TYPES, FOCUS_MODES, DIFFICULTY_PRESETS,
  TARGETING, AUDIO, CAMPAIGN_WAVES
} from './config.js';
import { el, fmt, clamp } from './utils.js';

export class UI {
  constructor(game) {
    this.game = game;
    this.root = document.getElementById('ui-root');
    this.toastTimer = null;
    this.modalStack = [];
    this._build();
  }

  /* ── Построение DOM ───────────────────────────────────────────── */
  _build() {
    this.root.innerHTML = '';
    this.root.append(
      this._startScreen(),
      this._hud(),
      this._leftPanel(),
      this._rightPanel(),
      this._bottomBar(),
      this._toastArea(),
      this._modalLayer()
    );
  }

  _startScreen() {
    const diffOptions = Object.entries(DIFFICULTY_PRESETS).map(([id, d]) =>
      el('option', { value: id, text: d.name }));
    const modeCampaign = el('input', { type: 'radio', name: 'start-mode', value: 'campaign' });
    modeCampaign.checked = true;
    const modeEndless = el('input', { type: 'radio', name: 'start-mode', value: 'endless' });

    this.startEl = el('div', {
      class: 'screen start-screen', id: 'start-screen', role: 'dialog',
      'aria-label': 'Начальный экран PVOGame.ru'
    }, [
      el('div', { class: 'start-card glass' }, [
        el('h1', { class: 'game-title', text: PROJECT_NAME }),
        el('p', { class: 'subtitle', text: 'Оборона станции Helios · вымышленный sci-fi сектор' }),
        el('p', { class: 'fiction-note', text: 'Полностью вымышленная игра: абстрактные объекты, синтетическая карта, никаких реальных данных.' }),
        el('div', { class: 'form-row' }, [
          el('label', { for: 'start-difficulty', text: 'Сложность' }),
          el('select', { id: 'start-difficulty', class: 'input' }, diffOptions)
        ]),
        el('div', { class: 'form-row radio-row' }, [
          el('span', { text: 'Режим:' }),
          el('label', { class: 'radio-label' }, [modeCampaign, document.createTextNode(' Кампания (12 волн)')]),
          el('label', { class: 'radio-label' }, [modeEndless, document.createTextNode(' Бесконечный')])
        ]),
        el('div', { class: 'best-score-line' }, [
          el('span', { text: 'Лучший результат: ' }),
          el('strong', { id: 'best-score-value', text: String(this.game.bestScore) })
        ]),
        el('button', {
          class: 'btn btn-primary big', id: 'btn-start',
          onclick: () => {
            const diffSel = document.getElementById('start-difficulty');
            const mode = modeEndless.checked ? 'endless' : 'campaign';
            this.game.newGame(diffSel.value, mode);
          }
        }, ['Начать оборону']),
        el('div', { class: 'keys-hint' }, [
          el('h3', { text: 'Управление' }),
          el('ul', {}, [
            li('ЛКМ по карточке модуля — выбрать постройку, ЛКМ по карте — разместить'),
            li('ЛКМ по модулю — выбор; U — улучшить, X — продать, T — приоритет целей'),
            li('Q / W / E / R — режимы Focus (активен только один)'),
            li('Пробел — пауза · F — скорость ×1/×2 · Esc — отмена'),
            li('Ctrl+Shift+P — панель «Управление»')
          ])
        ])
      ])
    ]);
    return this.startEl;
  }

  _hud() {
    const bar = (id, label, color) => el('div', { class: 'meter' }, [
      el('div', { class: 'meter-label' }, [label]),
      el('div', { class: 'meter-track', role: 'progressbar', 'aria-label': label, id: id + '-track' }, [
        el('div', { class: 'meter-fill', id, style: `background:${color}` })
      ]),
      el('span', { class: 'meter-num', id: id + '-num', text: '--' })
    ]);

    this.hudEl = el('div', { class: 'hud top-hud glass', id: 'hud', 'aria-label': 'Верхняя панель ресурсов' }, [
      el('div', { class: 'hud-brand' }, [
        el('span', { class: 'brand-name', text: PROJECT_NAME }),
        el('span', { class: 'brand-sub', text: 'Helios Station' })
      ]),
      el('div', { class: 'hud-stats' }, [
        statChip('res-integrity', 'Целостность', '❤'),
        statChip('res-credits', 'Кредиты', '◈'),
        statChip('res-energy', 'Энергия', '⚡'),
        statChip('res-wave', 'Волна', '≋'),
        statChip('res-threat', 'Уровень угрозы', '△'),
        statChip('res-score', 'Очки', '★'),
        statChip('res-speed', 'Скорость', '»')
      ]),
      el('div', { class: 'hud-meters' }, [
        bar('meter-focus', 'Фокус', '#3ad9ff'),
        bar('meter-stress', 'Стресс сети', '#ffb347'),
        bar('meter-composure', 'Самообладание', '#7af0c8')
      ]),
      el('div', { class: 'hud-right' }, [
        el('div', { class: 'panic-badge', id: 'panic-badge', text: 'Спокойно', title: 'Состояние интерфейса' }),
        el('button', { class: 'btn small', id: 'btn-pause', onclick: () => this.game.togglePause() }, ['⏸ Пауза']),
        el('button', { class: 'btn small', id: 'btn-admin', onclick: () => this.game.adminPanel?.toggle() }, ['Управление'])
      ])
    ]);
    return this.hudEl;
  }

  _leftPanel() {
    const cards = Object.values(MODULE_TYPES).map(def =>
      el('button', {
        class: 'module-card glass-lite', 'data-module': def.id,
        'aria-label': `Построить ${def.ru}, стоимость ${def.cost} кредитов`,
        title: def.desc,
        onclick: () => this.game.beginPlacement(def.id)
      }, [
        el('div', { class: 'mc-head' }, [
          el('span', { class: 'mc-icon', text: def.icon, style: `color:${def.color}` }),
          el('span', { class: 'mc-name', text: def.ru }),
        ]),
        el('div', { class: 'mc-en', text: def.name }),
        el('div', { class: 'mc-cost' }, [
          spanK('◈ ' + def.cost, 'кредиты'),
          spanK('⚡ ' + def.energy, 'энергия'),
          spanK('◎ ' + def.range, 'радиус')
        ]),
        el('div', { class: 'mc-desc', text: def.desc })
      ])
    );

    this.leftEl = el('aside', { class: 'panel left-panel glass', id: 'left-panel', 'aria-label': 'Панель строительства' }, [
      el('h2', { class: 'panel-title', text: 'Модули защиты' }),
      ...cards,
      el('div', { class: 'hint-block', text: 'Деньги капают пассивно. Следите за балансом энергии: дефицит повышает стресс сети.' })
    ]);
    return this.leftEl;
  }

  _rightPanel() {
    this.wavePreview = el('div', { class: 'wave-preview', id: 'wave-preview' }, []);
    this.selectedInfo = el('div', { class: 'selected-info', id: 'selected-info' }, [
      el('p', { class: 'muted', text: 'Модуль не выбран. Кликните по построенному модулю.' })
    ]);

    const focusButtons = Object.entries(FOCUS_MODES).map(([id, m]) =>
      el('button', {
        class: 'focus-btn', 'data-focus': id,
        'aria-label': `${m.name}: ${m.desc}`,
        title: `${m.desc}\nСтоимость: ${m.cost} фокуса · длительность ${m.duration} с · перезарядка ${m.cooldown} с`,
        onclick: () => this.game.activateFocusMode(id)
      }, [
        el('span', { class: 'fb-key', text: m.key }),
        el('span', { class: 'fb-name', text: m.name }),
        el('span', { class: 'fb-cost', text: `${m.cost}◈F` }),
        el('span', { class: 'fb-cd', text: '' })
      ])
    ));

    this.rightEl = el('aside', { class: 'panel right-panel glass', id: 'right-panel', 'aria-label': 'Панель волны и статуса' }, [
      el('h2', { class: 'panel-title', text: 'Обстановка' }),
      el('div', { class: 'wave-panel', id: 'wave-panel' }, [
        el('div', { class: 'wave-status', id: 'wave-status', text: 'Ожидание' }),
        this.wavePreview
      ]),
      el('h3', { class: 'sub-title', text: 'Focus-режимы' }),
      el('div', { class: 'focus-grid' }, focusButtons),
      el('div', { class: 'focus-hint muted', id: 'focus-hint', text: '' }),
      el('h3', { class: 'sub-title', text: 'Выбранный модуль' }),
      this.selectedInfo,
      el('details', { class: 'target-codex' }, [
        el('summary', { text: 'Кодекс сигналов' }),
        ...Object.values(TARGET_TYPES).map(t =>
          el('div', { class: 'codex-row' }, [
            el('span', { class: 'dot', style: `background:${t.color}` }),
            el('b', { text: t.name }),
            el('span', { class: 'muted', text: ` — ${t.desc}` })
          ]))
      ])
    ]);
    return this.rightEl;
  }

  _bottomBar() {
    this.musicMini = el('div', { class: 'music-mini', id: 'music-mini' }, [
      el('span', { text: '♪ ' }),
      el('span', { id: 'music-mini-status', text: 'музыка выключена' })
    ]);
    return el('footer', { class: 'bottom-bar glass-lite', 'aria-label': 'Нижняя панель' }, [
      el('div', { class: 'tips', id: 'tips', text: hintFor(null) }),
      this.musicMini,
      el('button', { class: 'btn small', onclick: () => this.game.showHelp() }, ['? Справка'])
    ]);
  }

  _toastArea() {
    this.toastEl = el('div', { class: 'toast-area', id: 'toast-area', role: 'status', 'aria-live': 'polite' }, []);
    return this.toastEl;
  }

  _modalLayer() {
    this.modalLayer = el('div', { class: 'modal-layer', id: 'modal-layer', 'aria-hidden': 'true' }, []);
    return this.modalLayer;
  }

  /* ── Публичные методы ─────────────────────────────────────────── */
  show(screenId) {
    this.hideAllScreens();
    const map = {
      start: this.startEl,
      game: null // игра — это canvas + панели, они всегда в DOM
    };
    if (screenId === 'start') this.startEl.classList.remove('hidden');
    else this.startEl.classList.add('hidden');
    void map;
    document.body.classList.toggle('in-game', screenId !== 'start');
  }

  hideAllScreens() {
    this.startEl.classList.add('hidden');
    this.pauseModal && this.pauseModal.classList.add('hidden');
  }

  toast(text, kind = 'info') {
    const t = el('div', { class: `toast toast-${kind}`, text, role: 'status' });
    this.toastEl.appendChild(t);
    setTimeout(() => { t.classList.add('fade'); setTimeout(() => t.remove(), 600); }, 2600);
    while (this.toastEl.children.length > 4) this.toastEl.removeChild(this.toastEl.firstChild);
  }

  setTip(text) { document.getElementById('tips').textContent = text || hintFor(null); }

  updateHud(g) {
    const s = g.state;
    setText('res-integrity', `${Math.ceil(s.station.integrity)}%`);
    setText('res-credits', fmt(s.credits));
    setText('res-energy', `${fmt(s.energy)}/${fmt(g.energyCapacity)}`);
    setText('res-wave', g.waves.mode === 'endless' ? `${g.waves.waveNumber} (∞)` : `${Math.min(g.waves.waveNumber, CAMPAIGN_WAVES.length)}/${CAMPAIGN_WAVES.length}`);
    setText('res-threat', fmt(g.stress.threatLevel(s.targets)));
    setText('res-score', fmt(s.score));
    setText('res-speed', `×${g.settings.gameSpeed}`);

    setMeter('meter-focus', g.cr.focus);
    setMeter('meter-stress', g.stress.networkStress);
    setMeter('meter-composure', g.stress.operatorComposure);

    const badge = document.getElementById('panic-badge');
    badge.textContent = g.stress.stateLabelRu;
    badge.className = `panic-badge panic-${g.stress.panicState}`;

    // Волна: статус + предпросмотр
    const ws = document.getElementById('wave-status');
    if (g.waves.state === 'prep') {
      ws.textContent = `Подготовка · следующая волна через ${Math.ceil(g.waves.prepTimer)} с`;
      this.renderWavePreview(g.waves.waveIndex, true);
    } else if (g.waves.state === 'active') {
      const remain = g.waves.remainingToSpawn() + s.targets.filter(t => t.alive).length;
      ws.textContent = `Волна ${g.waves.waveNumber} · целей осталось: ${remain}`;
      this.renderWavePreview(g.waves.waveIndex, false);
    } else if (g.waves.state === 'cleared') {
      ws.textContent = 'Волна зачищена';
    } else {
      ws.textContent = 'Ожидание';
    }

    // Focus-кнопки: кулдаун/активность
    for (const st of g.cr.modeStatusList()) {
      const btn = document.querySelector(`.focus-btn[data-focus="${st.id}"]`);
      if (!btn) continue;
      btn.classList.toggle('active', st.active);
      btn.classList.toggle('disabled', !st.available && !st.active);
      btn.disabled = false; // кликабельность сохраняем для сообщения о причине
      const cd = btn.querySelector('.fb-cd');
      cd.textContent = st.active ? `${Math.ceil(st.remaining || g.cr.modeTimeLeft)}с`
        : st.cooldownLeft > 0 ? `${Math.ceil(st.cooldownLeft)}с` : '';
    }
    const bandHint = this.game.focusVisuals.bandInfo(g.cr.band);
    setText('focus-hint', `${bandHint.label}: ${bandHint.hint}`);

    // Карточки модулей — доступность по кредитам
    for (const card of document.querySelectorAll('.module-card')) {
      const def = MODULE_TYPES[card.dataset.module];
      card.classList.toggle('unaffordable', s.credits < def.cost);
      card.classList.toggle('placing', g.placement?.typeId === def.id);
    }

    this.setTip(hintFor(g));
    setText('music-mini-status', musicStatusText(g.audio));
  }

  renderWavePreview(waveIndex, isNext) {
    const items = this.game.waves.previewText(waveIndex);
    this.wavePreview.innerHTML = '';
    this.wavePreview.appendChild(el('div', {
      class: 'wp-title', text: isNext ? 'Предпросмотр следующей волны' : 'Состав текущей волны'
    }));
    for (const it of items) {
      this.wavePreview.appendChild(el('div', { class: 'wp-row' }, [
        el('span', { class: 'dot', style: `background:${it.color}` }),
        el('span', { text: it.name }),
        el('span', { class: 'wp-count', text: '×' + it.count })
      ]));
    }
  }

  showSelectedModule(m) {
    const info = this.selectedInfo;
    info.innerHTML = '';
    if (!m) {
      info.appendChild(el('p', { class: 'muted', text: 'Модуль не выбран. Кликните по построенному модулю.' }));
      return;
    }
    const g = this.game;
    info.appendChild(el('div', { class: 'sel-head' }, [
      el('span', { class: 'mc-icon', text: m.def.icon, style: `color:${m.def.color}` }),
      el('b', { text: m.def.ru }),
      el('span', { class: 'lvl', text: `ур. ${m.level}` })
    ]));
    const lines = g.moduleStatLines(m);
    info.appendChild(el('ul', { class: 'sel-stats' }, lines.map(l =>
      el('li', {}, [el('span', { class: 'k', text: l.k }), el('span', { class: 'v', text: l.v })]))));
    info.appendChild(el('div', { class: 'sel-cooldown' }, [
      el('div', { class: 'meter-track' }, [
        el('div', { class: 'meter-fill', style: `background:${m.def.color};width:${m.cooldownMax ? (1 - m.cooldownLeft / m.cooldownMax) * 100 : 100}%` })
      ]),
      el('span', { class: 'muted', text: m.cooldownMax ? 'перезарядка' : 'пассивный' })
    ]));
    info.appendChild(el('div', { class: 'sel-actions' }, [
      m.canUpgrade()
        ? el('button', { class: 'btn small', onclick: () => g.upgradeSelected() }, [`Улучшить (${m.upgradeCost}◈) [U]`])
        : el('span', { class: 'muted', text: 'Макс. уровень' }),
      el('button', { class: 'btn small danger', onclick: () => g.sellSelected() }, [`Продать (+${m.sellValue()}◈) [X]`]),
      el('button', { class: 'btn small', onclick: () => g.cycleTargeting() }, [`Приоритет: ${TARGETING.names[m.targeting]} [T]`)
    ]));
  }

  /* Модалки с ловушкой фокуса */
  openModal(node) {
    this.modalLayer.classList.remove('hidden');
    this.modalLayer.setAttribute('aria-hidden', 'false');
    this.modalLayer.appendChild(node);
    this.modalStack.push(node);
    node.addEventListener('keydown', this._trapKeyHandler);
    const first = node.querySelector('button, input, select, [tabindex]');
    first?.focus();
  }

  _trapKeyHandler(e) {
    if (e.key !== 'Tab') return;
    const modal = e.currentTarget;
    const focusables = [...modal.querySelectorAll('button, input, select, textarea, [tabindex]:not([tabindex="-1"])')]
      .filter(n => !n.disabled && n.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0], last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
    else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
  }

  closeModal(top = true) {
    const node = top ? this.modalStack.pop() : this.modalStack.shift();
    if (!node) return;
    node.remove();
    if (!this.modalStack.length) {
      this.modalLayer.classList.add('hidden');
      this.modalLayer.setAttribute('aria-hidden', 'true');
    }
  }

  closeAllModals() {
    while (this.modalStack.length) this.closeModal();
  }

  get modalsOpen() { return this.modalStack.length > 0; }

  genericModal(title, bodyNodes, actions = []) {
    return el('div', { class: 'modal glass', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, [
      el('h2', { text: title }),
      ...bodyNodes,
      el('div', { class: 'modal-actions' }, actions.map(a =>
        el('button', { class: `btn ${a.class || ''}`, onclick: a.onclick }, [a.text])))
    ]);
  }

  showPause(g) {
    this.pauseModal = this.genericModal('Пауза', [
      el('p', { text: `Волна: ${g.waves.waveNumber}. Очки: ${fmt(g.state.score)}.` }),
      el('p', { class: 'muted', text: 'Смена сложности применяется со следующей волны.' }),
      el('div', { class: 'form-row' }, [
        el('label', { for: 'pause-diff', text: 'Сложность' }),
        el('select', { id: 'pause-diff', class: 'input' },
          Object.entries(DIFFICULTY_PRESETS).map(([id, d]) =>
            el('option', { value: id, text: d.name, selected: g.settings.difficulty === id })))
      ])
    ], [
      { text: 'Продолжить', class: 'btn-primary', onclick: () => { g.applyPendingDifficulty(document.getElementById('pause-diff').value); g.togglePause(); } },
      { text: 'Пропустить подготовку', onclick: () => { g.waves.skipPrep(); g.togglePause(); } },
      { text: 'Сдаться', class: 'danger', onclick: () => { g.closeAllModalsSoft(); g.gameOver(false); } }
    ]);
    this.openModal(this.pauseModal);
  }

  showGameOver(score, best, victory, endlessWaves) {
    const node = this.genericModal(victory ? 'Сектор удержан' : 'Станция потеряна', [
      el('p', { class: 'big-line', text: `Итоговые очки: ${fmt(score)}` }),
      el('p', { text: best ? '🏆 Новый рекорд!' : `Лучший результат: ${fmt(best)}` }),
      victory
        ? el('p', { class: 'muted', text: 'Кампания из 12 волн пройдена. Можно продолжить в бесконечном режиме.' })
        : el('p', { class: 'muted', text: endlessWaves ? `Пройдено волн: ${endlessWaves}.` : 'Helios Station будет восстановлена. Попробуйте снова.' })
    ], [
      { text: victory ? 'Бесконечный режим' : 'Новая игра', class: 'btn-primary', onclick: () => { this.closeModal(); this.game.newGame(this.game.settings.difficulty, victory ? 'endless' : this.game.settings.mode); } },
      { text: 'На стартовый экран', onclick: () => { this.closeModal(); this.game.toStartScreen(); } }
    ]);
    this.openModal(node);
  }

  showHelp() {
    const rows = [
      ['ЛКМ — карта', 'разместить выбранный модуль / выбрать модуль'],
      ['U', 'улучшить выбранный модуль'],
      ['X', 'продать выбранный модуль (возврат 60%)'],
      ['T', 'сменить приоритет целей выбранного модуля'],
      ['Q/W/E/R', 'режимы Focus (один активен одновременно)'],
      ['Пробел', 'пауза'],
      ['F', 'скорость ×1 / ×2'],
      ['Esc', 'отмена размещения / закрытие окон'],
      ['Ctrl+Shift+P', 'панель «Управление»']
    ];
    const node = this.genericModal('Справка', [
      el('table', { class: 'help-table' }, [
        el('tbody', {}, rows.map(([k, v]) =>
          el('tr', {}, [el('td', {}, [el('kbd', { text: k })]), el('td', { text: v })])))
      ]),
      el('p', { class: 'muted', text: 'Звуковые события всегда дублируются текстом в уведомлениях. Цвет — не единственный носитель смысла.' })
    ], [{ text: 'Закрыть', class: 'btn-primary', onclick: () => this.closeModal() }]);
    this.openModal(node);
  }

  updateBestScore(v) { setText('best-score-value', String(v)); }
}

/* ── Вспомогательные элементы ───────────────────────────────────── */
function statChip(id, label, icon) {
  return el('div', { class: 'stat-chip', title: label, 'aria-label': label }, [
    el('span', { class: 'chip-icon', text: icon, 'aria-hidden': 'true' }),
    el('span', { class: 'chip-label', text: label }),
    el('span', { class: 'chip-value', id })
  ]);
}
function spanK(text, title) { return el('span', { class: 'mc-k', text, title }); }
function li(text) { return el('li', { text }); }

function setText(id, v) {
  const n = document.getElementById(id);
  if (n && n.textContent !== String(v)) n.textContent = v;
}

function setMeter(id, value0to100) {
  const fill = document.getElementById(id);
  const num = document.getElementById(id + '-num');
  if (fill) fill.style.width = clamp(value0to100, 0, 100) + '%';
  if (num) num.textContent = Math.round(value0to100) + '%';
  const track = document.getElementById(id + '-track');
  if (track) track.setAttribute('aria-valuenow', String(Math.round(value0to100)));
}

function hintFor(g) {
  if (!g) return 'Совет: начните с Sentinel Sensor рядом со станцией — он раскрывает ложные сигналы.';
  const s = g.state;
  if (s.station.integrity < 40) return '⚠ Критическая целостность! Стройте Guardian Node или активируйте «Дыхание сети».';
  if (g.energyDeficit) return '⚠ Дефицит энергии: часть модулей работает вхолостую — продайте лишнее или подождите заряда.';
  if (g.waves.state === 'prep') return 'Между волнами: разместите новые модули и улучшите старые. Нажмите «Начать волну» для раннего старта.';
  const decoys = s.targets.filter(t => t.phantom && !t.revealed && t.alive).length;
  if (decoys > 1) return 'Неопознанные сигналы шумят в сети — Sentinel Sensor их раскроет.';
  if (s.credits > 200) return 'Есть свободные кредиты — усильте ближнюю зону перехватчиками.';
  return 'Держите кольца заполненными: Arc — точечно, Pulse — против роя.';
}

function musicStatusText(audio) {
  if (!audio.available) return 'звук не инициализирован';
  if (audio.settings.muted) return 'звук выключен';
  const parts = [];
  if (audio.musicMode === 'play') parts.push(AUDIO.profiles[audio.musicProfileId]?.name || '');
  if (audio.userTrack) {
    const t = audio.userTrack.el;
    parts.push(`файл: ${audio.userTrack.name.slice(0, 18)}${t && !t.paused ? ' ▶' : ''}`);
  }
  return parts.length ? parts.join(' · ') : 'тишина';
}

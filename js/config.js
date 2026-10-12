/* PVOGame.ru — единый источник игровых констант, коэффициентов и пресетов. */

export const PROJECT_NAME = 'PVOGame.ru';
export const PROJECT_VERSION = '1.0.0';
export const STORAGE_VERSION = 1;

/* ── Геометрия поля ─────────────────────────────────────────────── */
export const FIELD = {
  worldSize: 2400,            // мир в «мировых» единицах (квадрат)
  rings: [
    { id: 0, name: 'Зона обнаружения', radius: 1050, color: '#3ad9ff' },
    { id: 1, name: 'Дальняя зона',     radius: 780,  color: '#2fb6d9' },
    { id: 2, name: 'Средняя зона',     radius: 520,  color: '#ffb347' },
    { id: 3, name: 'Ближняя зона',     radius: 300,  color: '#ff6b8a' }
  ],
  spawnRadius: 1240,          // радиус появления целей
  stationSafeRadius: 150,     // безопасная зона станции (для местности/декора)
  moduleMinStationDist: 95,   // минимальная дистанция модуля до ядра
  cameraClampMargin: 120
};

/* ── Рендер / производительность ────────────────────────────────── */
export const RENDER = {
  dprCap: { low: 1, medium: 1.5, high: 2 },
  contourEvery: { low: 4, medium: 3, high: 2 },   // каждые N гексов — изолиния
  maxParticles: { low: 40, medium: 120, high: 260 },
  terrainTilePx: { low: 14, medium: 10, high: 7 }, // размер тайла при растеризации кэша
  glowEnabled: { low: false, medium: true, high: true }
};

/* ── Базовые ресурсы и их параметры ─────────────────────────────── */
export const RESOURCES = {
  integrityMax: 100,
  startIntegrity: 100,
  startCredits: 260,
  /* Энергия — «заряд сети»: реактор даёт приток в секунду, ёмкость — буфер
     на залпы модулей (Arc/Pulse тратят заряд при выстреле). */
  energyCapacityBase: 100,
  energyCapacityPerModule: 8,
  reactorBasePerSec: 7.5,          // базовая выработка сети, ед/с
  energyRegenBonusPerWave: 0.35,   // реактор слегка растёт с волнами
  shotEnergyCostMul: 1.0,          // множитель стоимости выстрела
  creditsPerKillBase: 6,
  waveClearBonusBase: 45,
  passiveIncomePerSec: 1.1,
  focusStart: 65,
  focusMax: 100,
  focusRegenPerSec: 0.55
};

/* ── Система стресса ────────────────────────────────────────────── */
export const STRESS = {
  startStress: 8,
  startComposure: 82,
  stressDecayPerSec: 4.2,
  composureRecoverPerSec: 2.6,
  // источники стресса (в единицах в секунду / разово)
  perNearThreatPerSec: 3.0,      // за каждую цель в ближней зоне
  nearThreatRadius: FIELD.rings[3].radius + 60,
  unknownSignalPerSec: 1.6,      // за каждый активный Decoy
  energyDeficitPerSec: 2.2,      // если потребление > генерации
  damageBurst: 6.5,              // разово за попадание по станции
  sceneLoadPerTarget: 0.045,     // перегруженная сцена
  eventBurst: 9.0,               // художественные стресс-события
  panicThresholds: [             // networkStress → паник-состояние
    { max: 20, state: 'calm' },
    { max: 42, state: 'alert' },
    { max: 62, state: 'tense' },
    { max: 82, state: 'critical' },
    { max: 101, state: 'overload' }
  ],
  recoveryGraceSec: 6            // сколько держится 'recovery' после спада ниже 25
};

/* ── Focus-режимы (управление ясностью интерфейса) ──────────────── */
export const FOCUS_MODES = {
  'analysis-pause': {
    name: 'Пауза анализа', key: 'Q', cost: 25, cooldown: 32, duration: 8,
    desc: 'Краткая остановка времени для оценки обстановки. Визуально приглушает сцену.',
    effect: { timeScale: 0.08, uiNoise: -0.6, tint: '#3ad9ff' }
  },
  'channel-priority': {
    name: 'Приоритет канала', key: 'W', cost: 18, cooldown: 25, duration: 12,
    desc: 'Подсветка приоритетных целей и фильтрация второстепенных сигналов.',
    effect: { highlightPriority: true, dimOthers: 0.45, uiNoise: -0.3, tint: '#ffb347' }
  },
  'network-breath': {
    name: 'Дыхание сети', key: 'E', cost: 20, cooldown: 28, duration: 14,
    desc: 'Медленная пульсация интерфейса, ускоряющая восстановление Composure.',
    effect: { composureBoost: 2.2, breathPulse: true, tint: '#7af0c8' }
  },
  'clarity-protocol': {
    name: 'Протокол ясности', key: 'R', cost: 34, cooldown: 45, duration: 10,
    desc: 'Полная визуальная очистка станции и HUD: шум и помехи исчезают.',
    effect: { clearVisuals: true, stressMul: 0.35, uiNoise: -1, tint: '#c9b8ff' }
  }
};

export const FOCUS_BANDS = {
  low:  { min: 0,  max: 34, name: 'Низкий фокус' },
  steady: { min: 35, max: 69, name: 'Ровный фокус' },
  high: { min: 70, max: 100, name: 'Высокий фокус' }
};

/* ── Цели (абстрактные sci-fi сущности) ─────────────────────────── */
export const TARGET_TYPES = {
  scout: {
    id: 'scout', name: 'Разведчик', en: 'Scout', color: '#7de3ff', shape: 'dart',
    hp: 26, speed: 66, threat: 6, reward: 8, damage: 5, size: 12,
    behavior: 'straight', desc: 'Быстрый одиночный сигнал. Идёт прямо на станцию.'
  },
  swarm: {
    id: 'swarm', name: 'Рой', en: 'Swarm Unit', color: '#ffd166', shape: 'triad',
    hp: 12, speed: 52, threat: 3, reward: 4, damage: 3, size: 8,
    behavior: 'drift', desc: 'Слабые элементы, прибывают плотными группами.',
    groupMin: 4, groupMax: 8
  },
  carrier: {
    id: 'carrier', name: 'Бронированный носитель', en: 'Armored Carrier', color: '#ff8fa3', shape: 'hex',
    hp: 150, speed: 24, threat: 18, reward: 26, damage: 16, size: 24,
    behavior: 'straight', armor: 3, splitOnDeath: { typeId: 'wisp', count: 2 },
    desc: 'Медленный прочный объект. Поглощает урон бронёй, при разрушении выпускает искры.'
  },
  decoy: {
    id: 'decoy', name: 'Ложный сигнал', en: 'Decoy', color: '#b892ff', shape: 'ghost',
    hp: 14, speed: 42, threat: 2, reward: 2, damage: 0, size: 14,
    behavior: 'weave', phantom: true, desc: 'Неопознанный сигнал: путает наведение и повышает стресс.'
  },
  wisp: {
    id: 'wisp', name: 'Сигнальная искра', en: 'Signal Wisp', color: '#7af0c8', shape: 'spark',
    hp: 34, speed: 88, threat: 8, reward: 10, damage: 6, size: 10,
    behavior: 'zigzag', regenPerSec: 1.2, desc: 'Извивающийся импульс, медленно восстанавливается.'
  }
};

/* Стоимость выстрела модуля в единицах заряда сети (по базовому энергопотреблению) */
export const SHOT_ENERGY_COST = { arc: 1.1, pulse: 1.5 };

/* ── Защитные модули ────────────────────────────────────────────── */
export const MODULE_TYPES = {
  sentinel: {
    id: 'sentinel', name: 'Sentinel Sensor', ru: 'Сенсор «Часовой»', color: '#3ad9ff', icon: '◎',
    cost: 45, energy: 4, range: 430, cooldown: 0, dps: 0,
    role: 'vision',
    desc: 'Раскрывает ложные сигналы и увеличивает дальность захвата соседних модулей.',
    upgrades: [
      { name: 'Узкий луч', cost: 40, mods: { rangeMul: 1.25, revealPower: 2 } },
      { name: 'Сетка фаз', cost: 80, mods: { rangeMul: 1.5, auraBonus: 0.12 } }
    ]
  },
  veil: {
    id: 'veil', name: 'Signal Veil', ru: 'Сигнальная вуаль', color: '#b892ff', icon: '◌',
    cost: 60, energy: 7, range: 260, cooldown: 6, dps: 0,
    role: 'control',
    desc: 'Замедляет все цели в зоне действия и снижает порождаемый ими стресс.',
    slowFactor: 0.55, stressCalm: 0.5,
    upgrades: [
      { name: 'Глубокая вуаль', cost: 55, mods: { slowFactor: 0.4, rangeMul: 1.15 } },
      { name: 'Резонанс', cost: 95, mods: { slowFactor: 0.3, stressCalm: 1.0 } }
    ]
  },
  arc: {
    id: 'arc', name: 'Arc Interceptor', ru: 'Дуговой перехватчик', color: '#ffb347', icon: '⚡',
    cost: 85, energy: 10, range: 340, cooldown: 1.1, damage: 18,
    role: 'kinetic', splash: 0,
    desc: 'Быстрые точечные разряды по приоритетной цели. Расходует заряд сети.',
    upgrades: [
      { name: 'Форсирование', cost: 70, mods: { cooldownMul: 0.72, damageAdd: 5 } },
      { name: 'Три излучателя', cost: 130, mods: { multiTarget: 2, damageAdd: 7 } }
    ]
  },
  pulse: {
    id: 'pulse', name: 'Pulse Array', ru: 'Импульсная решётка', color: '#ff6b8a', icon: '✷',
    cost: 120, energy: 16, range: 230, cooldown: 2.6, damage: 15,
    role: 'area', splash: 110,
    desc: 'Периодический импульс по всем целям в радиусе. Эффективен против роя.',
    upgrades: [
      { name: 'Широкий фронт', cost: 90, mods: { splashMul: 1.35, rangeMul: 1.15 } },
      { name: 'Пиковая мощность', cost: 150, mods: { damageAdd: 12, cooldownMul: 0.85 } }
    ]
  },
  guardian: {
    id: 'guardian', name: 'Guardian Node', ru: 'Узел охраны', color: '#7af0c8', icon: '❖',
    cost: 70, energy: 5, range: 180, cooldown: 0, repairPerSec: 1.1, shield: 22,
    role: 'support',
    desc: 'Ремонтирует целостность станции и частично поглощает урон в своей зоне.',
    upgrades: [
      { name: 'Активная починка', cost: 65, mods: { repairMul: 1.6 } },
      { name: 'Барьер', cost: 110, mods: { shieldAdd: 26, rangeMul: 1.2 } }
    ]
  }
};

export const SELL_REFUND = 0.6;
export const MAX_MODULE_LEVEL = 3; // базовый уровень + 2 апгрейда

/* ── Приоритеты целей для модулей ───────────────────────────────── */
export const TARGETING = {
  options: ['nearest', 'strongest', 'weakest', 'priority'],
  names: { nearest: 'Ближайшая', strongest: 'Крупнейшая', weakest: 'Слабейшая', priority: 'Приоритет угрозы' },
  default: 'nearest'
};

/* ── Сложность ──────────────────────────────────────────────────── */
export const DIFFICULTY_PRESETS = {
  calm:     { name: 'Спокойный',        hpMul: 0.75, speedMul: 0.85, countMul: 0.75, stressMul: 0.6,  creditMul: 1.25, energyMul: 1.2, dmgMul: 0.7 },
  standard: { name: 'Стандартный',      hpMul: 1.0,  speedMul: 1.0,  countMul: 1.0,  stressMul: 1.0,  creditMul: 1.0,  energyMul: 1.0, dmgMul: 1.0 },
  heavy:    { name: 'Высокая нагрузка', hpMul: 1.3,  speedMul: 1.12, countMul: 1.25, stressMul: 1.35, creditMul: 0.95, energyMul: 0.9, dmgMul: 1.2 },
  expert:   { name: 'Экспертный',       hpMul: 1.65, speedMul: 1.25, countMul: 1.5,  stressMul: 1.7,  creditMul: 0.85, energyMul: 0.8, dmgMul: 1.4 },
  custom:   { name: 'Пользовательский', hpMul: 1.0,  speedMul: 1.0,  countMul: 1.0,  stressMul: 1.0,  creditMul: 1.0,  energyMul: 1.0, dmgMul: 1.0 }
};

/* ── Волны кампании ─────────────────────────────────────────────── */
// Каждая волна: состав (тип: количество), интервал спавна, пауза до следующей волны.
// Вводные волны построены как учебный полигон: сначала один тип, затем комбинации.
export const CAMPAIGN_WAVES = [
  { intro: true,  tutorial: 'Разведчики идут прямо на станцию. Поставьте Arc Interceptor ближе к средней зоне.', groups: [['scout', 4]], gap: 1.6, pause: 18 },
  { tutorial: 'Рой слаб поодиночке, но плотный. Pulse Array выкашивает группы целиком.', groups: [['scout', 6], ['swarm', 6]], gap: 1.4, pause: 16 },
  { tutorial: 'Ложные сигналы шумят в сети. Sentinel Sensor раскроет их и усилит соседей.', groups: [['decoy', 3], ['scout', 6]], gap: 1.3, pause: 16 },
  { tutorial: 'Носитель бронирован и выпускает искры при разрушении. Держите заряд сети.', groups: [['carrier', 1], ['scout', 6]], gap: 1.4, pause: 18 },
  { groups: [['swarm', 10], ['scout', 6], ['wisp', 4]], gap: 1.1, pause: 16 },
  { groups: [['wisp', 6], ['carrier', 2], ['decoy', 3]], gap: 1.2, pause: 16 },
  { groups: [['swarm', 14], ['decoy', 4], ['scout', 6]], gap: 0.95, pause: 16 },
  { groups: [['carrier', 3], ['wisp', 6], ['scout', 8]], gap: 1.0, pause: 17 },
  { groups: [['decoy', 6], ['wisp', 8], ['swarm', 10]], gap: 0.85, pause: 16 },
  { groups: [['carrier', 4], ['scout', 10], ['wisp', 6]], gap: 0.9, pause: 18 },
  { groups: [['swarm', 18], ['decoy', 6], ['carrier', 3], ['wisp', 6]], gap: 0.7, pause: 18 },
  { boss: true, tutorial: 'Финальный накат: смешанные группы со всех направлений. Держите Focus.', groups: [['carrier', 6], ['wisp', 10], ['scout', 10], ['decoy', 6], ['swarm', 16]], gap: 0.6, pause: 20 }
];
export const ENDLESS_HP_STEP = 0.14;   // рост HP за волну после 12-й
export const ENDLESS_COUNT_STEP = 0.1; // рост числа целей за волну после 12-й

export const SCORING = {
  perKillThreat: 10,       // очки = threat * коэффициент
  perWaveClear: 120,
  integrityBonusPer10: 40, // бонус за оставшуюся целостность в конце кампании
  endlessWaveMultiplier: true
};

/* ── Художественные стресс-события ──────────────────────────────── */
export const STRESS_EVENTS = {
  intervalSec: [26, 48],
  pool: [
    { id: 'flare',    text: 'Всплеск фона: локальная засветка сенсоров' },
    { id: 'echo',     text: 'Эхо-контур: двойная разметка колец' },
    { id: 'drift',    text: 'Дрейф калибровки: сетка сместилась' },
    { id: 'whisper',  text: 'Шёпот сети: посторонний ритм в интерфейсе' }
  ]
};

/* ── Местность ──────────────────────────────────────────────────── */
export const TERRAIN = {
  gridN: 64,                    // сетка высот NxN
  heightScale: 26,              // вертикальное смещение в псевдо-3D
  contours: true,
  archetypes: {
    auroraRidges:     { name: 'Гребни Авроры',    fbmOctaves: 5, ridged: 1.0, warp: 0.9,  voronoiW: 0.2, baseFreq: 2.1, tilt: 0.35 },
    quietBasins:      { name: 'Тихие Впадины',    fbmOctaves: 4, ridged: 0.25, warp: 0.5, voronoiW: 0.35, baseFreq: 1.6, tilt: 0.12 },
    fracturedPlateau: { name: 'Расколотое Плато', fbmOctaves: 4, ridged: 0.6, warp: 0.35, voronoiW: 0.8, baseFreq: 2.6, tilt: 0.5 },
    crystalVeins:     { name: 'Кристальные Прожилки', fbmOctaves: 5, ridged: 0.85, warp: 1.2, voronoiW: 0.5, baseFreq: 3.1, tilt: 0.3 },
    signalTide:       { name: 'Сигнальный Прилив', fbmOctaves: 3, ridged: 0.3, warp: 1.6, voronoiW: 0.25, baseFreq: 1.9, tilt: 0.2 },
    shatteredArc:     { name: 'Осколочная Дуга',  fbmOctaves: 4, ridged: 0.7, warp: 0.8, voronoiW: 1.0, baseFreq: 2.4, tilt: 0.45 },
    softOrbit:        { name: 'Мягкая Орбита',    fbmOctaves: 3, ridged: 0.15, warp: 0.4, voronoiW: 0.15, baseFreq: 1.4, tilt: 0.1 }
  },
  zones: {
    ridge:        { name: 'Гребень',       color: '#1e3a5c' },
    basin:        { name: 'Впадина',       color: '#122238' },
    plateau:      { name: 'Плато',         color: '#1a2f4d' },
    crystalField: { name: 'Кристаллы',     color: '#2a2450' },
    signalFog:    { name: 'Сигнальный туман', color: '#14262e' },
    neutral:      { name: 'Нейтральная',   color: '#16273f' }
  },
  quality: { low: 0.5, medium: 0.75, high: 1.0 }
};

/* ── Декоративные препятствия ───────────────────────────────────── */
export const OBSTACLES = {
  types: {
    prismCluster:  { name: 'Призматический кластер', color: '#4fd8ff', size: [18, 34] },
    echoPillar:    { name: 'Эхо-столб',              color: '#8f7bff', size: [14, 46] },
    fracturedShard:{ name: 'Расколотый осколок',     color: '#ff9db1', size: [16, 30] },
    lumenArch:     { name: 'Световой свод',          color: '#ffd27a', size: [26, 40] },
    driftStone:    { name: 'Дрейф-камень',           color: '#6f8bb0', size: [12, 24] },
    signalReef:    { name: 'Сигнальный риф',         color: '#63e6b8', size: [22, 38] }
  },
  profiles: {
    sparse:   { name: 'Редкий',    density: 0.5,  readabilityNoise: 0.15 },
    balanced: { name: 'Сбалансированный', density: 1.0, readabilityNoise: 0.3 },
    dense:    { name: 'Плотный',   density: 1.8,  readabilityNoise: 0.5 },
    minimal:  { name: 'Минимальный', density: 0.2, readabilityNoise: 0.05 }
  },
  cellSize: 160,                // spatial hash
  minCount: 14,
  maxCount: 60,
  keepOutStation: FIELD.stationSafeRadius + 30,
  interferenceRadius: 46        // лёгкая локальная «помеха читаемости»
};

/* ── Аудио ──────────────────────────────────────────────────────── */
export const AUDIO = {
  defaults: { master: 0.7, music: 0.5, ambient: 0.4, effects: 0.6, alerts: 0.7, userMusic: 0.6, muted: false },
  ducking: { amount: 0.45, releaseSec: 0.8 },
  profiles: {
    'station-silence': { name: 'Тишина станции', bpm: 46, scale: [0, 3, 5, 7, 10], root: 55,  padLevel: 0.5,  melodic: false },
    'night-protocol':  { name: 'Ночной протокол', bpm: 58, scale: [0, 2, 3, 7, 8],  root: 62,  padLevel: 0.42, melodic: true },
    'signal-network':  { name: 'Сигнальная сеть', bpm: 72, scale: [0, 2, 4, 7, 9],  root: 69,  padLevel: 0.3,  melodic: true },
    'quiet':           { name: 'Тихий режим',     bpm: 40, scale: [0, 5, 7, 12],    root: 57,  padLevel: 0.55, melodic: false }
  }
};

/* ── Настройки по умолчанию ─────────────────────────────────────── */
export const DEFAULT_SETTINGS = {
  difficulty: 'standard',
  pendingDifficulty: null,      // применяется со следующей волны
  gameSpeed: 1,
  mode: 'campaign',             // campaign | endless
  quality: 'high',
  showRings: true,
  showGrid: true,
  debugOverlays: false
};

export const DEFAULT_ACCESSIBILITY = {
  reducedMotion: false,
  reduceVisualStress: false,
  highContrast: false,
  uiScale: 1.0,
  soundCuesText: true
};

export const DEFAULT_CONTROL_RECOVERY = {
  enabled: true,
  focusAutoPause: true,         // авто-подсказка при низком фокусе
  noiseFloor: 0.5               // общий уровень «шума UI» 0..1
};

export const DEFAULT_ADMIN = {
  terrainSeed: 20260412,
  terrainArchetype: 'auroraRidges',
  obstacleProfile: 'balanced',
  customDifficulty: { ...DIFFICULTY_PRESETS.custom },
  stressEventsEnabled: true,
  previewMode: true             // изменения применяются по кнопке «Применить»
};

/* ── Клавиши ────────────────────────────────────────────────────── */
export const KEYS = {
  pause: ' ',
  speed: 'f',
  admin: { ctrl: true, shift: true, key: 'P' },
  cancel: 'Escape',
  sell: 'x',
  upgrade: 'u',
  targeting: 't',
  focusKeys: { q: 'analysis-pause', w: 'channel-priority', e: 'network-breath', r: 'clarity-protocol' }
};

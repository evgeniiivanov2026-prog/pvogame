# PVOGame.ru

**PVOGame.ru** — полностью локальная браузерная 2D sci-fi игра: абстрактная оборона вымышленной станции **Helios Station** от волн синтетических сигналов-целей. Это художественный командный центр, а не реалистичная система: никаких реальных стран, армий, карт, геоданных, координат или прикладных тактик.

## Запуск

### Вариант 1 — просто открыть файл
Откройте `index.html` двойным кликом в современном браузере (Chrome / Firefox / Edge / Safari).

### Вариант 2 — статический сервер (рекомендуется)
ES-модули в некоторых браузерах требуют HTTP. Любой простейший статический сервер подойдёт:

```bash
# Python
python3 -m http.server 8000
# затем откройте http://localhost:8000

# Node (без npm-зависимостей)
npx --yes serve .
```

Никаких npm-зависимостей, сборщиков и backend нет. Проект работает офлайн.

## Управление

| Клавиша | Действие |
|---|---|
| ЛКМ по карточке модуля / 1–5 | Выбрать постройку |
| ЛКМ по карте | Разместить модуль |
| ЛКМ по модулю | Выбрать (статус, кулдаун, энергия) |
| `U` | Улучшить выбранный модуль |
| `X` | Продать (возврат 60%) |
| `T` | Сменить приоритет целей |
| `Q / W / E / R` | Focus-режимы (активен только один) |
| `Пробел` | Пауза |
| `F` | Скорость ×1 / ×2 |
| `Esc` / ПКМ | Отмена размещения / закрытие окон |
| `Ctrl+Shift+P` | Локальная панель «Управление» |

## Игровые системы

- **Ресурсы:** Целостность, Кредиты, Энергия, Фокус, Волна, Уровень угрозы, Стресс сети, Самообладание оператора, Очки.
- **Цели (абстрактные):** Scout, Swarm Unit, Armored Carrier, Decoy, Signal Wisp — разные скорость, прочность, поведение и визуальные образы.
- **Модули защиты:** Sentinel Sensor (раскрытие ложных сигналов), Signal Veil (замедление/спокойствие), Arc Interceptor (точечные разряды), Pulse Array (импульс по площади), Guardian Node (ремонт/барьер). Постройка / улучшение / продажа / приоритеты целей.
- **Волны:** кампания из 12 волн + endless; предпросмотр состава, паузы между волнами, рост сложности.
- **Сложность:** Спокойный / Стандартный / Высокая нагрузка / Экспертный / Пользовательский. Смена применяется **только со следующей волны**.
- **Стресс/Composure:** calm → alert → tense → critical → overload → recovery. Влияют только на HUD и атмосферу (мягко, без тряски, стробинга и вспышек).
- **Focus (0–100, старт 65):** analysis-pause, channel-priority, network-breath, clarity-protocol — игровые/интерфейсные режимы ясности.
- **Музыка и звук:** Web Audio API, шины master/music/ambient/effects/alerts, ducking, профили station-silence / night-protocol / signal-network / quiet. Пользовательский аудиофайл загружается через `<input type="file">` и **не покидает браузер** (object URL); поддержка mp3/ogg/wav/m4a/aac при поддержке браузером; sequence/repeat/shuffle.
- **Процедурная местность** (`js/terrain.js`): seeded RNG, value/smooth noise, fbm, ridged, voronoi, domain warp, архетипы auroraRidges / quietBasins / fracturedPlateau / crystalVeins / signalTide / shatteredArc / softOrbit, изолинии, safe zone станции, кэш растеризации, детерминированность по seed.
- **Декоративные препятствия** (`js/obstacles.js`): prismCluster, echoPillar, fracturedShard, lumenArch, driftStone, signalReef; spatial hash; только визуальные «помехи читаемости», не влияют на физику.
- **Admin-panel** (`js/admin-panel.js`): вкладки Обзор / Игра / Баланс / Атмосфера / Аудио и музыка / Доступность / Данные / О проекте / Местность / Визуал; черновик + «Применить», экспорт/импорт JSON, очистка localStorage.

## Структура проекта

```
/index.html            — точка входа, 4 canvas-слоя + ui-root
/styles.css            — HUD, панели, модалки, admin-panel, a11y-классы
/js/config.js          — все константы, коэффициенты, пресеты
/js/utils.js           — математика, seeded RNG, шум, spatial hash
/js/storage.js         — localStorage: версионирование, безопасная загрузка
/js/entities.js        — Station, Target, частицы
/js/modules.js         — DefenseModule: апгрейды, приоритеты, стрельба
/js/waves.js           — WaveManager: кампания/endless, предпросмотр
/js/stress.js          — networkStress / operatorComposure / panic states
/js/control-recovery.js— Focus-система и 4 режима
/js/focus-visuals.js   — визуальные состояния фокуса для HUD/canvas
/js/audio.js           — AudioManager: Web Audio, профили, пользовательские треки
/js/terrain.js         — процедурная местность (кэш, архетипы, seed)
/js/obstacles.js       — декоративные объекты среды
/js/renderer.js        — layered canvas render (terrain/world/effects/interaction)
/js/ui.js              — стартовый экран, HUD, панели, модалки, тосты
/js/admin-panel.js     — локальная панель управления
/js/game.js            — состояние, игровой цикл, ввод, интеграция систем
```

## Хранение

localStorage-ключи с префиксом `pvogame-`: settings, audio-settings, accessibility-settings, control-recovery-settings, admin-settings, best-score, difficulty-settings, terrain-settings. Значения сериализуются с версией и корректно переживают битый JSON (fallback на defaults).

## Производительность и доступность

- Слоистый canvas; местность кэшируется в offscreen и не перерисовывается покадрово.
- Пресеты качества low/medium/high, ограничение частиц, cap devicePixelRatio.
- Reduced motion, reduce visual stress, high contrast, масштаб UI, focus-trap в модалках, ARIA, клавиатурная навигация, touch-target ≥ 44px, дублирование смысла текстом/иконками.

## Ограничения и безопасность тематики

Проект полностью вымышленный: абстрактные геометрические цели, синтетическая карта, псевдо-3D голографическая местность. Не используются внешние ассеты, CDN, картографические API, геоданные и сетевые запросы. Имя «PVOGame.ru» — название игры, а не реально существующий сервис.

## Что проверить вручную после запуска

1. Открыть `index.html` → стартовый экран, выбор сложности/режима, кнопка «Начать оборону».
2. Построить все 5 типов модулей (1–5 / клик по карточке), улучшить (U), продать (X), сменить приоритет (T).
3. Пережить 2–3 волны: предпросмотр состава, бонус за зачистку, очки и рекорд.
4. Q/W/E/R — каждый Focus-режим меняет HUD и оверлей; Esc/пробел/F работают.
5. Ctrl+Shift+P — все вкладки панели, «Применить», экспорт/импорт JSON, сброс.
6. Музыка: профиль играет после старта; загрузка локального mp3/ogg — имя/длительность/размер, play/pause/stop, режимы повтора.
7. Доступность: reduced motion / reduce stress / high contrast / ui-scale.
8. Перезагрузить страницу — настройки и best score сохранены; местность детерминирована по seed.

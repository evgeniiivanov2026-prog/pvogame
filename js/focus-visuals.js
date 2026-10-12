/* PVOGame.ru — визуальные состояния Focus.
   Модуль возвращает CSS-классы и параметры canvas-подсветки для трёх полос фокуса
   и четырёх режимов. Учитывает reduced motion / reduce visual stress / high contrast. */

import { FOCUS_MODES } from './config.js';

export class FocusVisuals {
  constructor(accessibility) {
    this.accessibility = accessibility || {};
  }

  setAccessibility(a11y) { this.accessibility = a11y || {}; }

  /* Классы для HTML HUD: band + активный режим */
  hudClasses(band, activeModeId) {
    const cls = [`focus-${band}`];
    if (activeModeId) cls.push(`mode-${activeModeId}`);
    if (this.accessibility.reducedMotion) cls.push('motion-off');
    if (this.accessibility.reduceVisualStress) cls.push('stress-reduced');
    if (this.accessibility.highContrast) cls.push('contrast-boost');
    return cls.join(' ');
  }

  /* Параметры canvas-оверлея режима (renderer interaction layer) */
  overlayParams(effect, gameTime) {
    if (!effect) return null;
    const rm = !!this.accessibility.reducedMotion;
    const rvs = !!this.accessibility.reduceVisualStress;
    const progress = effect.duration > 0 ? 1 - effect.remaining / effect.duration : 1;

    switch (effect.modeId) {
      case 'analysis-pause':
        return {
          type: 'veil', color: FOCUS_MODES['analysis-pause'].effect.tint,
          alpha: rm ? 0.10 : 0.14, vignette: true,
          scanlines: !rm && !rvs
        };
      case 'channel-priority':
        return {
          type: 'frame', color: FOCUS_MODES['channel-priority'].effect.tint,
          alpha: 0.35, cornerMarks: true, pulse: rm ? 0 : (rvs ? 0.2 : 1),
          highlightPriority: true, dimOthers: FOCUS_MODES['channel-priority'].effect.dimOthers
        };
      case 'network-breath': {
        const breath = rm ? 0.5 : 0.5 + Math.sin(gameTime * (rvs ? 0.4 : 0.8)) * 0.5;
        return {
          type: 'breath', color: FOCUS_MODES['network-breath'].effect.tint,
          alpha: 0.06 + breath * 0.08, ringScale: 0.9 + breath * 0.25
        };
      }
      case 'clarity-protocol':
        return {
          type: 'clarity', color: FOCUS_MODES['clarity-protocol'].effect.tint,
          alpha: 0.10, cleanSweep: !rm, clearVisuals: true, progress
        };
      default:
        return null;
    }
  }

  /* Стили полосы фокуса в HUD (ширина/цвет задаются классами в styles.css) */
  bandInfo(band) {
    const info = {
      low:    { label: 'Низкий фокус', hint: 'Интерфейс шумит. Используйте режимы восстановления.' },
      steady: { label: 'Ровный фокус', hint: 'Стабильное состояние интерфейса.' },
      high:   { label: 'Высокий фокус', hint: 'Максимальная ясность данных.' }
    };
    return info[band] || info.steady;
  }
}

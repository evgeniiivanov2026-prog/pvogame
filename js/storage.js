/* PVOGame.ru — локальное хранилище: безопасная сериализация, версионирование, fallback. */

import { STORAGE_VERSION } from './config.js';
import { deepMerge } from './utils.js';

export const KEYS = {
  settings: 'pvogame-settings',
  audio: 'pvogame-audio-settings',
  accessibility: 'pvogame-accessibility-settings',
  controlRecovery: 'pvogame-control-recovery-settings',
  admin: 'pvogame-admin-settings',
  bestScore: 'pvogame-best-score',
  difficulty: 'pvogame-difficulty-settings',
  terrain: 'pvogame-terrain-settings'
};

function wrap(data) {
  return JSON.stringify({ v: STORAGE_VERSION, data });
}

function parseSafe(raw, defaults) {
  if (!raw) return { ...defaults };
  try {
    const obj = JSON.parse(raw);
    // Поддержка как versioned {v,data}, так и «сырых» объектов (graceful fallback)
    const data = (obj && typeof obj === 'object' && 'v' in obj && 'data' in obj) ? obj.data : obj;
    if (!data || typeof data !== 'object') return { ...defaults };
    return deepMerge(defaults, data);
  } catch {
    return { ...defaults };
  }
}

export function loadJSON(key, defaults) {
  try {
    return parseSafe(localStorage.getItem(key), defaults);
  } catch {
    // localStorage может быть недоступен (приватный режим file:// в некоторых браузерах)
    return { ...defaults };
  }
}

export function saveJSON(key, data) {
  try {
    localStorage.setItem(key, wrap(data));
    return true;
  } catch {
    return false;
  }
}

export function loadNumber(key, def) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return def;
    const obj = JSON.parse(raw);
    const val = (obj && typeof obj === 'object' && 'data' in obj) ? obj.data : Number(obj);
    return Number.isFinite(val) ? val : def;
  } catch {
    return def;
  }
}

export function saveNumber(key, value) {
  try { localStorage.setItem(key, wrap(value)); return true; } catch { return false; }
}

export function removeKey(key) {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

export function clearAll() {
  Object.values(KEYS).forEach(removeKey);
}

/* Экспорт/импорт всего конфига настроек (для admin-panel) */
export function exportConfig() {
  const out = { project: 'PVOGame.ru', version: STORAGE_VERSION, exportedAt: new Date().toISOString(), keys: {} };
  for (const [name, key] of Object.entries(KEYS)) {
    if (key === KEYS.bestScore) continue;
    try { out.keys[name] = JSON.parse(localStorage.getItem(key) || 'null'); } catch { out.keys[name] = null; }
  }
  return out;
}

export function importConfig(obj) {
  if (!obj || typeof obj !== 'object' || !obj.keys) throw new Error('Некорректный файл конфигурации');
  for (const [name, key] of Object.entries(KEYS)) {
    if (name === 'bestScore') continue;
    const val = obj.keys[name];
    if (val !== undefined) {
      try { localStorage.setItem(key, typeof val === 'string' ? val : JSON.stringify(val)); } catch { /* ignore */ }
    }
  }
}

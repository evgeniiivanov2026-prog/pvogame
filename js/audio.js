/* PVOGame.ru — локальная аудиосистема на Web Audio API.
   Процедурные звуки, микшер master/music/ambient/effects/alerts, ducking,
   музыкальные профили и пользовательские треки (только локально, file:// безопасен). */

import { AUDIO } from './config.js';
import { clamp, makeRng } from './utils.js';

export class AudioManager {
  constructor(settings) {
    this.settings = { ...AUDIO.defaults, ...(settings || {}) };
    this.ctx = null;                 // создаётся лениво по жесту пользователя
    this.buses = {};
    this.running = false;
    this.musicProfileId = 'quiet';
    this.musicMode = 'play';         // play | pause | stop
    this._musicTimer = null;
    this._padNodes = [];
    this.userTrack = null;           // { name, size, url(objectURL), el, duration }
    this.userPlaylist = [];          // [{name,size,url,el,duration}]
    this.userIndex = 0;
    this.userPlayMode = 'sequence';  // sequence | repeat-track | shuffle
    this.userStatus = 'нет трека';
    this.onUserTrackChange = null;   // callback для UI
  }

  /* ИнициализацияAudioContext должна происходить из user gesture */
  ensureContext() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return true;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.settings.muted ? 0 : this.settings.master;
      this.master.connect(this.ctx.destination);
      for (const bus of ['music', 'ambient', 'effects', 'alerts']) {
        const g = this.ctx.createGain();
        g.gain.value = this.settings[bus];
        g.connect(this.master);
        this.buses[bus] = g;
      }
      // Ducking-компрессор на music-шине
      this.ducker = this.ctx.createDynamicsCompressor();
      this.ducker.threshold.value = -24;
      this.ducker.ratio.value = 6;
      this.ducker.connect(this.buses.music);
      return true;
    } catch {
      this.ctx = null;
      return false;
    }
  }

  get available() { return !!this.ctx; }

  setVolume(bus, value) {
    this.settings[bus] = clamp(value, 0, 1);
    if (bus === 'master' && this.master) {
      this.master.gain.value = this.settings.muted ? 0 : this.settings.master;
    } else if (this.buses[bus]) {
      this.buses[bus].gain.value = this.settings[bus];
    }
  }

  setMuted(muted) {
    this.settings.muted = !!muted;
    if (this.master) this.master.gain.value = muted ? 0 : this.settings.master;
    if (this.userTrack?.el) this.userTrack.el.volume = muted ? 0 : this.settings.userMusic;
  }

  /* ── Процедурные эффекты ──────────────────────────────────────── */
  _blip(bus, freq, dur, type = 'sine', vol = 0.5, slideTo = null) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(this.buses[bus] || this.master);
    osc.start(t); osc.stop(t + dur + 0.05);
  }

  _noiseHit(bus, dur = 0.2, filterFreq = 900, vol = 0.35) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass'; filt.frequency.value = filterFreq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filt); filt.connect(g); g.connect(this.buses[bus] || this.master);
    src.start(t);
  }

  sfx(name) {
    if (!this.ctx || this.settings.muted) return;
    switch (name) {
      case 'build':     this._blip('effects', 320, 0.18, 'triangle', 0.4, 520); break;
      case 'sell':      this._blip('effects', 480, 0.16, 'triangle', 0.35, 240); break;
      case 'upgrade':   this._blip('effects', 420, 0.12, 'square', 0.22, 640);
                        setTimeout(() => this._blip('effects', 640, 0.16, 'square', 0.2, 880), 90); break;
      case 'shot':      this._blip('effects', 780, 0.07, 'sawtooth', 0.12, 300); break;
      case 'pulse':     this._noiseHit('effects', 0.25, 500, 0.2); break;
      case 'kill':      this._noiseHit('effects', 0.18, 1400, 0.25); break;
      case 'hit':       this._noiseHit('alerts', 0.35, 240, 0.5);
                        this._blip('alerts', 110, 0.3, 'sine', 0.4, 60); break;
      case 'alert':     this._blip('alerts', 660, 0.14, 'sine', 0.3, 660); break;
      case 'waveStart': this._blip('alerts', 300, 0.3, 'sine', 0.3, 450);
                        setTimeout(() => this._blip('alerts', 450, 0.35, 'sine', 0.28, 600), 200); break;
      case 'waveClear': [523, 659, 784].forEach((f, i) =>
                        setTimeout(() => this._blip('alerts', f, 0.25, 'sine', 0.25), i * 130)); break;
      case 'focus':     this._blip('effects', 880, 0.25, 'sine', 0.2, 1320); break;
      case 'error':     this._blip('alerts', 180, 0.15, 'square', 0.2, 140); break;
      case 'gameover':  [400, 320, 250, 180].forEach((f, i) =>
                        setTimeout(() => this._blip('alerts', f, 0.4, 'sine', 0.3), i * 220)); break;
      case 'victory':   [523, 659, 784, 1046].forEach((f, i) =>
                        setTimeout(() => this._blip('alerts', f, 0.35, 'triangle', 0.3), i * 160)); break;
      default: break;
    }
  }

  duck(intensity = 1) {
    if (!this.ctx || !this.ducker) return;
    this.ducker.threshold.value = -24 - 10 * intensity * AUDIO.ducking.amount;
    clearTimeout(this._duckTimer);
    this._duckTimer = setTimeout(() => {
      if (this.ducker) this.ducker.threshold.value = -24;
    }, AUDIO.ducking.releaseSec * 1000);
  }

  /* ── Процедурная музыка: профиль ──────────────────────────────── */
  _musicTarget() { return this.ducker || this.buses.music || this.master; }

  setMusicProfile(id) {
    if (!AUDIO.profiles[id]) return;
    const wasPlaying = this.musicMode === 'play';
    this.stopMusicInternal();
    this.musicProfileId = id;
    if (wasPlaying) this.playMusic();
  }

  playMusic() {
    if (!this.ensureContext()) return;
    this.stopMusicInternal();
    this.musicMode = 'play';
    const p = AUDIO.profiles[this.musicProfileId];
    const beat = 60 / p.bpm;

    // Дрон-подложка: два осциллятора + медленная амплитудная модуляция
    const padGain = this.ctx.createGain();
    padGain.gain.value = p.padLevel * 0.14;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 420;
    lp.connect(padGain);
    padGain.connect(this._musicTarget());
    for (const [mul, detune] of [[1, 0], [1.5, 7], [2, -5]]) {
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = midiToHz(p.root * mul);
      o.detune.value = detune;
      o.connect(lp);
      o.start();
      this._padNodes.push(o);
    }
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    lfo.frequency.value = 0.07; lfoGain.gain.value = p.padLevel * 0.05;
    lfo.connect(lfoGain); lfoGain.connect(padGain.gain);
    lfo.start();
    this._padNodes.push(lfo);
    this._padGains = [padGain];

    // Событийный секвенсор
    const rng = makeRng(Date.now() & 0x7fff);
    let step = 0;
    this._musicTimer = setInterval(() => {
      if (this.musicMode !== 'play' || !this.ctx) return;
      step++;
      if (p.melodic && step % 2 === 0) {
        const note = p.scale[Math.floor(rng() * p.scale.length)] + 12 * (rng() > 0.7 ? 1 : 0);
        this._blipSafe('music', midiToHz(p.root + note + 12), beat * 1.4, 'triangle', 0.06 + rng() * 0.05);
      }
      if (step % 8 === 4) this._blipSafe('music', midiToHz(p.root - 12), beat * 2, 'sine', 0.09);
    }, beat * 1000 / 2);
  }

  _blipSafe(bus, freq, dur, type, vol) {
    // Укороченная версия blip для фоновой сетки (без слайда)
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.buses[bus] || this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  pauseMusic() {
    this.musicMode = 'pause';
    (this._padGains || []).forEach(g => { try { g.gain.value = 0; } catch { /* ignore */ } });
  }

  resumeMusic() {
    if (this.musicMode === 'pause') this.playMusic();
  }

  stopMusicInternal() {
    clearInterval(this._musicTimer);
    this._musicTimer = null;
    for (const n of this._padNodes) { try { n.stop ? n.stop() : n.disconnect(); } catch { /* ignore */ } }
    for (const g of (this._padGains || [])) { try { g.disconnect(); } catch { /* ignore */ } }
    this._padNodes = [];
    this._padGains = [];
  }

  stopMusic() {
    this.stopMusicInternal();
    this.musicMode = 'stop';
  }

  /* ── Пользовательская музыка (локально, через object URL) ─────── */
  async loadUserFile(file) {
    // Файл НЕ отправляется в сеть — только локальный object URL
    const url = URL.createObjectURL(file);
    const el = new Audio(url);
    el.preload = 'metadata';
    el.volume = this.settings.muted ? 0 : this.settings.userMusic;
    await new Promise((res) => {
      el.addEventListener('loadedmetadata', res, { once: true });
      el.addEventListener('error', res, { once: true });
      setTimeout(res, 3000); // fallback если метаданные не читаются
    });
    const track = {
      name: file.name, size: file.size, url, el,
      duration: Number.isFinite(el.duration) ? el.duration : 0
    };
    this.userPlaylist.push(track);
    this.userTrack = track;
    this.userIndex = this.userPlaylist.length - 1;
    this.userStatus = `Загружено: ${track.name}`;
    if (this.onUserTrackChange) this.onUserTrackChange(this.trackInfo());
    return track;
  }

  trackInfo() {
    const t = this.userTrack;
    if (!t) return { present: false, status: this.userStatus };
    return {
      present: true, name: t.name, size: t.size, duration: t.duration,
      status: this.userStatus, mode: this.userPlayMode,
      index: this.userIndex + 1, total: this.userPlaylist.length
    };
  }

  playUserTrack() {
    if (!this.userTrack) return;
    this.ensureContext();
    this.userTrack.el.volume = this.settings.muted ? 0 : this.settings.userMusic;
    this.userTrack.el.play().then(() => {
      this.userStatus = 'Воспроизведение';
      if (this.onUserTrackChange) this.onUserTrackChange(this.trackInfo());
    }).catch(() => {
      this.userStatus = 'Нажмите ещё раз (браузер требует жеста)';
      if (this.onUserTrackChange) this.onUserTrackChange(this.trackInfo());
    });
    this.userTrack.el.onended = () => this._advance(true);
  }

  pauseUserTrack() { this.userTrack?.el.pause(); this.userStatus = 'Пауза';
    if (this.onUserTrackChange) this.onUserTrackChange(this.trackInfo()); }

  stopUserTrack() {
    const t = this.userTrack;
    if (!t) return;
    t.el.pause(); t.el.currentTime = 0;
    this.userStatus = 'Остановлено';
    if (this.onUserTrackChange) this.onUserTrackChange(this.trackInfo());
  }

  setUserPlayMode(mode) {
    this.userPlayMode = mode;
    this.userStatus = `Режим: ${{ sequence: 'Последовательно', 'repeat-track': 'Повтор трека', shuffle: 'Случайно' }[mode] || mode}`;
    if (this.onUserTrackChange) this.onUserTrackChange(this.trackInfo());
  }

  selectUserTrack(index) {
    const t = this.userPlaylist[index];
    if (!t) return;
    this.userTrack?.el.pause();
    this.userTrack = t;
    this.userIndex = index;
    this.userStatus = `Выбран: ${t.name}`;
    if (this.onUserTrackChange) this.onUserTrackChange(this.trackInfo());
  }

  _advance(auto = false) {
    if (this.userPlayMode === 'repeat-track') {
      if (this.userTrack) { this.userTrack.el.currentTime = 0; this.playUserTrack(); }
      return;
    }
    if (this.userPlaylist.length <= 1) {
      if (auto && this.userPlayMode === 'sequence' && this.userTrack) {
        this.userStatus = 'Завершено';
        if (this.onUserTrackChange) this.onUserTrackChange(this.trackInfo());
      }
      return;
    }
    let next;
    if (this.userPlayMode === 'shuffle') next = Math.floor(Math.random() * this.userPlaylist.length);
    else next = (this.userIndex + 1) % this.userPlaylist.length;
    this.selectUserTrack(next);
    this.playUserTrack();
  }

  setUserVolume(v) {
    this.settings.userMusic = clamp(v, 0, 1);
    if (this.userTrack) this.userTrack.el.volume = this.settings.muted ? 0 : this.settings.userMusic;
  }

  disposeUserTracks() {
    for (const t of this.userPlaylist) {
      try { t.el.pause(); URL.revokeObjectURL(t.url); } catch { /* ignore */ }
    }
    this.userPlaylist = [];
    this.userTrack = null;
    this.userStatus = 'нет трека';
  }
}

function midiToHz(m) { return 440 * Math.pow(2, (m - 69) / 12); }

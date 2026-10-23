// audio.js — all SFX + a looping trap beat, synthesized with the Web Audio API.
// Nothing plays until resume() is called from a user gesture (browser autoplay rules).

export class AudioSynth {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.beatTimer = null;
    this.beatStep = 0;
    this.enabled = true;
  }

  resume() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { this.enabled = false; return; }
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.35;
      this.musicGain.connect(this.master);
      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = 0.8;
      this.sfxGain.connect(this.master);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  _noiseBuffer(dur) {
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _env(gainNode, peak, dur, t0) {
    const g = gainNode.gain;
    g.setValueAtTime(0.0001, t0);
    g.exponentialRampToValueAtTime(peak, t0 + 0.004);
    g.exponentialRampToValueAtTime(0.0001, t0 + dur);
  }

  gun(type = 'blaster') {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.now ? this.ctx.now() : this.ctx.currentTime;
    const dur = type === 'sniper' ? 0.5 : type === 'shotgun' ? 0.4 : 0.16;
    // noise crack
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer(dur);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = type === 'sniper' ? 2200 : type === 'shotgun' ? 1400 : 3200;
    const g = this.ctx.createGain();
    this._env(g, type === 'sniper' ? 0.9 : 0.6, dur, t);
    src.connect(lp); lp.connect(g); g.connect(this.sfxGain);
    src.start(t); src.stop(t + dur);
    // low thump
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(type === 'sniper' ? 160 : 110, t);
    o.frequency.exponentialRampToValueAtTime(40, t + dur * 0.8);
    const og = this.ctx.createGain();
    this._env(og, 0.5, dur * 0.9, t);
    o.connect(og); og.connect(this.sfxGain);
    o.start(t); o.stop(t + dur);
  }

  hit(crit = false) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(crit ? 1400 : 820, t);
    o.frequency.exponentialRampToValueAtTime(crit ? 680 : 420, t + 0.09);
    const g = this.ctx.createGain();
    this._env(g, 0.28, 0.1, t);
    o.connect(g); g.connect(this.sfxGain);
    o.start(t); o.stop(t + 0.12);
  }

  shieldSip() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(300, t);
    o.frequency.exponentialRampToValueAtTime(900, t + 0.35);
    const g = this.ctx.createGain();
    this._env(g, 0.3, 0.4, t);
    o.connect(g); g.connect(this.sfxGain);
    o.start(t); o.stop(t + 0.42);
  }

  openChest() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [523, 659, 784, 1047].forEach((f, i) => {
      const o = this.ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const g = this.ctx.createGain();
      this._env(g, 0.22, 0.25, t + i * 0.06);
      o.connect(g); g.connect(this.sfxGain);
      o.start(t + i * 0.06); o.stop(t + i * 0.06 + 0.26);
    });
  }

  build() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(660, t + 0.12);
    const g = this.ctx.createGain();
    this._env(g, 0.25, 0.14, t);
    o.connect(g); g.connect(this.sfxGain);
    o.start(t); o.stop(t + 0.16);
  }

  jump() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(400, t);
    o.frequency.exponentialRampToValueAtTime(760, t + 0.12);
    const g = this.ctx.createGain();
    this._env(g, 0.18, 0.14, t);
    o.connect(g); g.connect(this.sfxGain);
    o.start(t); o.stop(t + 0.16);
  }

  stormAlarm() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 2; i++) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(520, t + i * 0.3);
      o.frequency.linearRampToValueAtTime(300, t + i * 0.3 + 0.25);
      const g = this.ctx.createGain();
      this._env(g, 0.22, 0.28, t + i * 0.3);
      o.connect(g); g.connect(this.sfxGain);
      o.start(t + i * 0.3); o.stop(t + i * 0.3 + 0.3);
    }
  }

  elim() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [220, 277, 330].forEach((f) => {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      const g = this.ctx.createGain();
      this._env(g, 0.3, 0.5, t);
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 1200;
      o.connect(lp); lp.connect(g); g.connect(this.sfxGain);
      o.start(t); o.stop(t + 0.55);
    });
  }

  startBeat() {
    if (!this.ctx || this.beatTimer) return;
    const bpm = 140;
    const stepDur = 60 / bpm / 2; // 8th notes
    const kick = (t) => {
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
      const g = this.ctx.createGain();
      this._env(g, 0.9, 0.18, t);
      o.connect(g); g.connect(this.musicGain);
      o.start(t); o.stop(t + 0.2);
    };
    const hat = (t) => {
      const s = this.ctx.createBufferSource();
      s.buffer = this._noiseBuffer(0.05);
      const hp = this.ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 7000;
      const g = this.ctx.createGain();
      this._env(g, 0.18, 0.05, t);
      s.connect(hp); hp.connect(g); g.connect(this.musicGain);
      s.start(t); s.stop(t + 0.06);
    };
    const bass = (t, f) => {
      const o = this.ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const g = this.ctx.createGain();
      this._env(g, 0.5, stepDur * 1.5, t);
      o.connect(g); g.connect(this.musicGain);
      o.start(t); o.stop(t + stepDur * 1.6);
    };
    const bassline = [55, 0, 55, 0, 82, 0, 49, 55];
    this.beatTimer = setInterval(() => {
      if (!this.ctx) return;
      const t = this.ctx.currentTime + 0.05;
      const s = this.beatStep % 8;
      if (s === 0 || s === 3 || s === 6) kick(t);
      hat(t + stepDur * 0.5);
      const bf = bassline[s];
      if (bf) bass(t, bf);
      this.beatStep++;
    }, stepDur * 1000);
  }

  stopBeat() {
    if (this.beatTimer) { clearInterval(this.beatTimer); this.beatTimer = null; }
  }
}

// Procedural audio: every sound is synthesised with WebAudio (no files). Gunshots are layered noise +
// thump shaped per weapon class, delayed by the speed of sound and low-passed with distance, then
// spatialised with HRTF panners. Also footsteps, UI, ambience per city, rain, engines and lobby music.
const SOS = 343;

class AudioEngine {
  constructor() { this.ctx = null; this.vol = 0.8; this.musicVol = 0.5; this.loops = new Map(); }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain(); this.master.gain.value = this.vol;
    const comp = this.ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp); comp.connect(this.ctx.destination);
    this.sfx = this.ctx.createGain(); this.sfx.connect(this.master);
    this.music = this.ctx.createGain(); this.music.gain.value = this.musicVol; this.music.connect(this.master);
    this.amb = this.ctx.createGain(); this.amb.gain.value = 0.7; this.amb.connect(this.master);
    const n = this.ctx.sampleRate * 2;
    this.noise = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    this.brown = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const b = this.brown.getChannelData(0); let last = 0;
    for (let i = 0; i < n; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; b[i] = last * 3.5; }
    // reverb impulse for urban slapback
    const rl = this.ctx.sampleRate * 1.4;
    this.ir = this.ctx.createBuffer(2, rl, this.ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const x = this.ir.getChannelData(ch); for (let i = 0; i < rl; i++) x[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / rl, 3.2); }
    this.verb = this.ctx.createConvolver(); this.verb.buffer = this.ir;
    this.verbGain = this.ctx.createGain(); this.verbGain.gain.value = 0.22;
    this.verb.connect(this.verbGain); this.verbGain.connect(this.sfx);
  }
  setVolume(v) { this.vol = v; if (this.master) this.master.gain.value = v; }
  setMusic(v) { this.musicVol = v; if (this.music) this.music.gain.value = v; }

  listener(pos, fwd, up) {
    if (!this.ctx) return;
    const L = this.ctx.listener, t = this.ctx.currentTime;
    if (L.positionX) {
      L.positionX.setTargetAtTime(pos.x, t, 0.02); L.positionY.setTargetAtTime(pos.y, t, 0.02); L.positionZ.setTargetAtTime(pos.z, t, 0.02);
      L.forwardX.setTargetAtTime(fwd.x, t, 0.02); L.forwardY.setTargetAtTime(fwd.y, t, 0.02); L.forwardZ.setTargetAtTime(fwd.z, t, 0.02);
      L.upX.value = up.x; L.upY.value = up.y; L.upZ.value = up.z;
    } else { L.setPosition(pos.x, pos.y, pos.z); L.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z); }
    this.lp = pos;
  }

  _out(pos, gain = 1) {
    const g = this.ctx.createGain(); g.gain.value = gain;
    if (!pos) { g.connect(this.sfx); return g; }
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 6; p.maxDistance = 2000; p.rolloffFactor = 1.1;
    p.positionX ? (p.positionX.value = pos.x, p.positionY.value = pos.y, p.positionZ.value = pos.z) : p.setPosition(pos.x, pos.y, pos.z);
    g.connect(p); p.connect(this.sfx);
    return g;
  }
  _dist(pos) { return pos && this.lp ? Math.hypot(pos.x - this.lp.x, pos.y - this.lp.y, pos.z - this.lp.z) : 0; }

  _noiseBurst(dest, t, dur, f0, f1, q = 0.8, type = 'bandpass', gain = 1, buf) {
    const s = this.ctx.createBufferSource(); s.buffer = buf || this.noise;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    s.connect(f); f.connect(g); g.connect(dest);
    s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
  }
  _tone(dest, t, dur, f0, f1, type = 'sine', gain = 1) {
    const o = this.ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.05);
  }

  // cls: ar ak smg dmr sr awm sg pistol pan ; local = our own gun (no panner, fuller)
  gun(pos, cls, suppressed = false, local = false) {
    if (!this.ctx) return;
    const d = local ? 0 : this._dist(pos);
    if (d > 1100) return;
    const t = this.ctx.currentTime + d / SOS;
    const far = Math.min(1, d / 600);
    const out = this._out(local ? null : pos, local ? 0.9 : 2.2);
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.value = suppressed ? 1800 - far * 1200 : 12000 - far * 10500;
    lp.connect(out);
    if (!suppressed && d < 500) { const sv = this.ctx.createGain(); sv.gain.value = 0.25 + far * 0.4; lp.connect(sv); sv.connect(this.verb); }
    const P = {
      ar: [0.16, 2600, 1.0, 90], ak: [0.2, 1900, 1.1, 75], smg: [0.12, 3200, 0.8, 110], dmr: [0.22, 2200, 1.2, 70],
      sr: [0.34, 1600, 1.5, 55], awm: [0.45, 1300, 1.8, 45], sg: [0.3, 1100, 1.6, 50], pistol: [0.12, 2800, 0.7, 120], pan: [0.35, 900, 0.8, 300],
    }[cls] || [0.16, 2600, 1, 90];
    const [dur, fc, g, thump] = P;
    if (cls === 'pan') { this._tone(lp, t, 0.6, 900, 820, 'triangle', 0.6); this._tone(lp, t, 0.5, 1470, 1400, 'sine', 0.3); this._noiseBurst(lp, t, 0.08, 3000, 1000, 1, 'bandpass', 0.7); return; }
    const sup = suppressed ? 0.35 : 1;
    this._noiseBurst(lp, t, dur * (suppressed ? 0.5 : 1), fc * 2.4, fc * 0.4, 0.6, 'bandpass', g * sup);
    this._noiseBurst(lp, t, 0.04, 7000, 3000, 0.5, 'highpass', 0.6 * sup);
    this._tone(lp, t, dur * 0.8, thump * 2.2, thump * 0.6, 'sine', 1.3 * sup * (1 - far * 0.5));
    if (!suppressed && d > 250) this._noiseBurst(lp, t + 0.05, 0.6, 400, 120, 0.7, 'lowpass', 0.4, this.brown);
  }

  crack(pos) { // supersonic bullet passing close
    if (!this.ctx) return;
    const out = this._out(pos, 0.7);
    this._noiseBurst(out, this.ctx.currentTime, 0.05, 6000, 2500, 0.7, 'bandpass', 1);
  }
  impact(pos, surf) {
    if (!this.ctx || this._dist(pos) > 120) return;
    const out = this._out(pos, 0.6), t = this.ctx.currentTime;
    if (surf === 1) { this._tone(out, t, 0.25, 2600 + Math.random() * 800, 2200, 'triangle', 0.25); this._noiseBurst(out, t, 0.06, 5000, 2000, 1, 'bandpass', 0.5); }
    else if (surf === 5) this._noiseBurst(out, t, 0.09, 700, 300, 1, 'lowpass', 0.8);
    else if (surf === 6) this._noiseBurst(out, t, 0.2, 1500, 400, 0.6, 'bandpass', 0.6);
    else this._noiseBurst(out, t, 0.08, 1800, 600, 0.9, 'bandpass', 0.6);
  }
  step(pos, surf, loud = 1, local = false) {
    if (!this.ctx) return;
    if (!local && this._dist(pos) > 45) return;
    const out = this._out(local ? null : pos, (local ? 0.18 : 0.8) * loud), t = this.ctx.currentTime;
    const f = surf === 'wood' ? 500 : surf === 'metal' ? 1400 : surf === 'water' ? 900 : surf === 'grass' ? 2200 : surf === 'snow' ? 1600 : 1100;
    this._noiseBurst(out, t, surf === 'water' ? 0.18 : 0.07, f * 1.6, f * 0.6, 1.2, 'bandpass', 0.9);
    if (surf === 'metal') this._tone(out, t, 0.08, 380, 300, 'triangle', 0.2);
  }
  click(kind = 'ui') {
    if (!this.ctx) return;
    const out = this._out(null, 0.35), t = this.ctx.currentTime;
    if (kind === 'ui') this._tone(out, t, 0.06, 1500, 1100, 'triangle', 0.4);
    else if (kind === 'hover') this._tone(out, t, 0.03, 2400, 2200, 'sine', 0.15);
    else if (kind === 'hit') this._tone(out, t, 0.05, 2800, 2600, 'square', 0.12);
    else if (kind === 'head') { this._tone(out, t, 0.12, 3400, 3300, 'triangle', 0.3); this._tone(out, t, 0.12, 5100, 5000, 'sine', 0.15); }
    else if (kind === 'kill') { this._tone(out, t, 0.18, 880, 1320, 'triangle', 0.35); this._tone(out, t + 0.08, 0.2, 1320, 1760, 'triangle', 0.25); }
    else if (kind === 'empty') this._tone(out, t, 0.04, 1800, 1700, 'square', 0.15);
    else if (kind === 'magout') { this._noiseBurst(out, t, 0.05, 3000, 1500, 2, 'bandpass', 0.8); this._tone(out, t, 0.05, 700, 500, 'square', 0.1); }
    else if (kind === 'magin') { this._noiseBurst(out, t, 0.06, 2400, 1200, 2, 'bandpass', 1); this._tone(out, t + 0.02, 0.05, 1100, 900, 'square', 0.15); }
    else if (kind === 'bolt') { this._noiseBurst(out, t, 0.08, 2000, 800, 2, 'bandpass', 0.9); this._noiseBurst(out, t + 0.22, 0.07, 2600, 1200, 2, 'bandpass', 0.9); }
    else if (kind === 'pickup') { this._noiseBurst(out, t, 0.08, 1800, 900, 1, 'bandpass', 0.5); }
    else if (kind === 'heal') { this._noiseBurst(out, t, 0.4, 3000, 2000, 0.5, 'bandpass', 0.15); }
    else if (kind === 'egg') { [0, 0.09, 0.18, 0.27].forEach((d, i) => this._tone(out, t + d, 0.3, [523, 659, 784, 1046][i], [523, 659, 784, 1046][i], 'triangle', 0.35)); }
    else if (kind === 'zone') { this._tone(out, t, 0.9, 440, 220, 'sawtooth', 0.12); this._tone(out, t + 0.45, 0.9, 440, 220, 'sawtooth', 0.1); }
    else if (kind === 'win') { [0, 0.15, 0.3, 0.45, 0.7].forEach((d, i) => this._tone(out, t + d, 0.5, [392, 523, 659, 784, 1046][i], [392, 523, 659, 784, 1046][i], 'triangle', 0.4)); }
    else if (kind === 'hurt') this._noiseBurst(out, t, 0.12, 600, 250, 1, 'lowpass', 0.5);
    else if (kind === 'drum') { this._tone(out, t, 0.5, 90, 45, 'sine', 1.2); this._noiseBurst(out, t, 0.2, 400, 100, 1, 'lowpass', 0.6); }
  }
  explosion(pos) {
    if (!this.ctx) return;
    const d = this._dist(pos), t = this.ctx.currentTime + d / SOS;
    const out = this._out(pos, 3.5);
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5000 - Math.min(4500, d * 8); lp.connect(out);
    this._noiseBurst(lp, t, 1.4, 1200, 60, 0.5, 'lowpass', 1.6, this.brown);
    this._tone(lp, t, 0.7, 80, 30, 'sine', 1.8);
    this._noiseBurst(lp, t, 0.3, 4000, 800, 0.4, 'bandpass', 0.8);
  }
  firework(pos) {
    if (!this.ctx) return;
    const d = this._dist(pos), t = this.ctx.currentTime + d / SOS;
    const out = this._out(pos, 2.2);
    this._noiseBurst(out, t, 0.9, 800, 60, 0.5, 'lowpass', 1.2, this.brown);
    for (let i = 0; i < 6; i++) this._noiseBurst(out, t + 0.3 + i * 0.07 * Math.random(), 0.05, 5000, 2000, 1, 'bandpass', 0.25);
  }
  horn(pos) {
    if (!this.ctx) return;
    const out = this._out(pos, 0.5), t = this.ctx.currentTime;
    this._tone(out, t, 0.45, 420, 410, 'square', 0.25); this._tone(out, t, 0.45, 525, 520, 'square', 0.18);
  }

  // looping sounds keyed by id; returns controller {set(params), stop()}
  loop(id, kind) {
    if (!this.ctx) return null;
    if (this.loops.has(id)) return this.loops.get(id);
    const t = this.ctx.currentTime;
    let ctl;
    if (kind === 'engine') {
      const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 50;
      const o2 = this.ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = 25;
      const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500;
      const g = this.ctx.createGain(); g.gain.value = 0.0;
      const p = this.ctx.createPanner(); p.panningModel = 'HRTF'; p.refDistance = 5; p.rolloffFactor = 1.2;
      o.connect(f); o2.connect(f); f.connect(g); g.connect(p); p.connect(this.sfx); o.start(); o2.start();
      ctl = {
        set: ({ rpm = 0.2, pos, vol = 0.35, local }) => {
          const n = this.ctx.currentTime;
          o.frequency.setTargetAtTime(38 + rpm * 110, n, 0.08); o2.frequency.setTargetAtTime(19 + rpm * 55, n, 0.08);
          f.frequency.setTargetAtTime(300 + rpm * 1400, n, 0.08); g.gain.setTargetAtTime(vol, n, 0.1);
          if (pos) { if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; } }
        },
        stop: () => { g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1); setTimeout(() => { o.stop(); o2.stop(); }, 500); this.loops.delete(id); },
      };
    } else {
      // noise beds: wind, rain, plane, ambience
      const s = this.ctx.createBufferSource(); s.buffer = kind === 'plane' ? this.brown : this.noise; s.loop = true;
      const f = this.ctx.createBiquadFilter();
      f.type = kind === 'rain' ? 'highpass' : kind === 'wind' ? 'bandpass' : 'lowpass';
      f.frequency.value = kind === 'rain' ? 1400 : kind === 'wind' ? 700 : kind === 'water' ? 900 : 300;
      f.Q.value = kind === 'wind' ? 0.6 : 0.7;
      const g = this.ctx.createGain(); g.gain.value = 0;
      s.connect(f); f.connect(g); g.connect(kind === 'plane' || kind === 'wind' ? this.sfx : this.amb); s.start(t, Math.random());
      let hum;
      if (kind === 'plane') { hum = this.ctx.createOscillator(); hum.type = 'sawtooth'; hum.frequency.value = 62; const hf = this.ctx.createBiquadFilter(); hf.type = 'lowpass'; hf.frequency.value = 240; const hg = this.ctx.createGain(); hg.gain.value = 0.18; hum.connect(hf); hf.connect(hg); hg.connect(g); hum.start(); }
      ctl = {
        set: ({ vol = 0.3, freq }) => { g.gain.setTargetAtTime(vol, this.ctx.currentTime, 0.3); if (freq) f.frequency.setTargetAtTime(freq, this.ctx.currentTime, 0.2); },
        stop: () => { g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3); setTimeout(() => { s.stop(); if (hum) hum.stop(); }, 800); this.loops.delete(id); },
      };
    }
    this.loops.set(id, ctl);
    return ctl;
  }
  stopAll() { for (const l of [...this.loops.values()]) l.stop(); this.stopMusic(); }

  // city ambience one-shots: honks for Indian cities, birds for hills, temple bells
  ambience(map, dt) {
    if (!this.ctx) return;
    this._ambT = (this._ambT || 0) - dt;
    if (this._ambT > 0) return;
    this._ambT = 1.5 + Math.random() * 4;
    const t = this.ctx.currentTime;
    const out = this.ctx.createGain(); out.gain.value = 0.06 + Math.random() * 0.05;
    const pan = this.ctx.createStereoPanner(); pan.pan.value = Math.random() * 2 - 1; out.connect(pan); pan.connect(this.amb);
    const urban = !['meghalaya', 'nagaland', 'spiti'].includes(map.id);
    if (urban && !map.mechanics.noHonk && Math.random() < 0.7) {
      const f = 380 + Math.random() * 180; const n = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) { this._tone(out, t + i * 0.22, 0.18, f, f * 0.98, 'square', 0.5); this._tone(out, t + i * 0.22, 0.18, f * 1.25, f * 1.24, 'square', 0.35); }
    } else if (Math.random() < 0.6) {
      const f = 2200 + Math.random() * 1800;
      for (let i = 0; i < 3 + Math.random() * 4; i++) this._tone(out, t + i * 0.11, 0.08, f, f * (1.2 + Math.random() * 0.3), 'sine', 0.6);
    } else {
      this._tone(out, t, 2.2, 880, 875, 'sine', 0.4); this._tone(out, t, 2.2, 1760 * 1.01, 1750, 'sine', 0.15);
    }
  }

  // --------------------------------------------------------------- lobby music: tanpura drone + synthwave arp
  startMusic() {
    if (!this.ctx || this._mus) return;
    const ctx = this.ctx;
    const bus = ctx.createGain(); bus.gain.value = 0; bus.connect(this.music);
    bus.gain.setTargetAtTime(0.5, ctx.currentTime, 1.5);
    const delay = ctx.createDelay(); delay.delayTime.value = 0.375; const fb = ctx.createGain(); fb.gain.value = 0.35;
    delay.connect(fb); fb.connect(delay); delay.connect(bus);
    const root = 110; // A
    // raga-ish scale: Sa Re Ga Ma Pa Dha Ni (kafi-flavoured minor)
    const scale = [0, 2, 3, 5, 7, 9, 10, 12, 14, 15];
    const drone = [root / 2, root * 0.75, root, root * 1.5].map((f) => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; const lf = ctx.createBiquadFilter(); lf.type = 'lowpass'; lf.frequency.value = 600; const g = ctx.createGain(); g.gain.value = 0.035; o.connect(lf); lf.connect(g); g.connect(bus); o.start(); return o; });
    let step = 0;
    const bpm = 96, sixteenth = 60 / bpm / 4;
    let next = ctx.currentTime + 0.1;
    const pattern = [0, 4, 7, 4, 9, 7, 4, 2, 0, 4, 7, 9, 8, 7, 4, 3];
    const tick = () => {
      while (next < ctx.currentTime + 0.3) {
        const n = scale[pattern[step % 16] % scale.length] + (Math.floor(step / 64) % 2 ? 5 : 0);
        const f = root * 2 * Math.pow(2, n / 12);
        const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = f;
        const flt = ctx.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.setValueAtTime(3200, next); flt.frequency.exponentialRampToValueAtTime(500, next + 0.18);
        const g = ctx.createGain(); g.gain.setValueAtTime(0.05, next); g.gain.exponentialRampToValueAtTime(0.001, next + 0.2);
        o.connect(flt); flt.connect(g); g.connect(bus); g.connect(delay); o.start(next); o.stop(next + 0.25);
        if (step % 4 === 0) { // kick
          const k = ctx.createOscillator(); k.frequency.setValueAtTime(140, next); k.frequency.exponentialRampToValueAtTime(40, next + 0.18);
          const kg = ctx.createGain(); kg.gain.setValueAtTime(0.35, next); kg.gain.exponentialRampToValueAtTime(0.001, next + 0.25);
          k.connect(kg); kg.connect(bus); k.start(next); k.stop(next + 0.3);
        }
        if (step % 8 === 4) this._noiseBurst(bus, next, 0.15, 3000, 1500, 0.7, 'bandpass', 0.12);
        if (step % 16 === 10 || step % 16 === 14) { // tabla-ish "na"
          const tb = ctx.createOscillator(); tb.type = 'sine'; tb.frequency.setValueAtTime(420, next); tb.frequency.exponentialRampToValueAtTime(300, next + 0.12);
          const tg = ctx.createGain(); tg.gain.setValueAtTime(0.12, next); tg.gain.exponentialRampToValueAtTime(0.001, next + 0.15);
          tb.connect(tg); tg.connect(bus); tb.start(next); tb.stop(next + 0.2);
        }
        step++; next += sixteenth;
      }
    };
    const iv = setInterval(tick, 60);
    this._mus = { bus, drone, iv };
  }
  stopMusic() {
    if (!this._mus) return;
    const m = this._mus; this._mus = null;
    m.bus.gain.setTargetAtTime(0, this.ctx.currentTime, 0.6);
    setTimeout(() => { clearInterval(m.iv); m.drone.forEach((o) => o.stop()); }, 2500);
  }
}

export const audio = new AudioEngine();

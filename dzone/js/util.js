// Shared helpers: seeded RNG, 2D simplex noise, fbm, small math.

export function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  const f = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.range = (a0, b0) => a0 + (b0 - a0) * f();
  f.int = (a0, b0) => Math.floor(a0 + (b0 - a0 + 1) * f());
  f.pick = (arr) => arr[Math.floor(f() * arr.length)];
  f.chance = (p) => f() < p;
  return f;
}

// --- simplex noise (2D), seeded permutation
export function makeNoise(seed = 1) {
  const rnd = mulberry32(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
  const perm = new Uint8Array(512), pm12 = new Uint8Array(512);
  for (let i = 0; i < 512; i++) { perm[i] = p[i & 255]; pm12[i] = perm[i] % 12; }
  const g = [1, 1, -1, 1, 1, -1, -1, -1, 1, 0, -1, 0, 1, 0, -1, 0, 0, 1, 0, -1, 0, 1, 0, -1];
  const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
  function n2(xin, yin) {
    let n0 = 0, n1 = 0, n2v = 0;
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s), j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t), y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) { const gi = pm12[ii + perm[jj]] * 2; t0 *= t0; n0 = t0 * t0 * (g[gi] * x0 + g[gi + 1] * y0); }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) { const gi = pm12[ii + i1 + perm[jj + j1]] * 2; t1 *= t1; n1 = t1 * t1 * (g[gi] * x1 + g[gi + 1] * y1); }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) { const gi = pm12[ii + 1 + perm[jj + 1]] * 2; t2 *= t2; n2v = t2 * t2 * (g[gi] * x2 + g[gi + 1] * y2); }
    return 70 * (n0 + n1 + n2v);
  }
  n2.fbm = (x, y, oct = 5, lac = 2, gain = 0.5) => {
    let a = 1, f = 1, s = 0, n = 0;
    for (let o = 0; o < oct; o++) { s += a * n2(x * f, y * f); n += a; a *= gain; f *= lac; }
    return s / n;
  };
  n2.ridged = (x, y, oct = 5) => {
    let a = 1, f = 1, s = 0, n = 0;
    for (let o = 0; o < oct; o++) { const v = 1 - Math.abs(n2(x * f, y * f)); s += a * v * v; n += a; a *= 0.5; f *= 2; }
    return s / n;
  };
  return n2;
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const damp = (a, b, k, dt) => b + (a - b) * Math.exp(-k * dt);
export const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };
export const dist2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

// distance from point to segment in XZ, plus param t
export function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz || 1e-9;
  let t = ((px - ax) * dx + (pz - az) * dz) / l2;
  t = clamp(t, 0, 1);
  const cx = ax + dx * t, cz = az + dz * t;
  return { d: Math.hypot(px - cx, pz - cz), t, cx, cz };
}

export function fmtTime(s) {
  s = Math.max(0, Math.ceil(s));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

// canvas text texture helper (signboards, billboards, neon)
export function textCanvas(lines, opts = {}) {
  const w = opts.w || 512, h = opts.h || 256;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const bg = opts.bg ?? '#10141c';
  if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); }
  if (opts.border) { g.strokeStyle = opts.border; g.lineWidth = Math.max(4, h * 0.03); g.strokeRect(g.lineWidth, g.lineWidth, w - g.lineWidth * 2, h - g.lineWidth * 2); }
  if (opts.stripes) {
    for (let i = 0; i < opts.stripes.length; i++) { g.fillStyle = opts.stripes[i]; g.fillRect(0, (h / opts.stripes.length) * i, w, h / opts.stripes.length); }
  }
  const arr = Array.isArray(lines) ? lines : [lines];
  const sizes = opts.sizes || arr.map((_, i) => (i === 0 ? 0.34 : 0.2));
  const colors = opts.colors || arr.map((_, i) => (i === 0 ? (opts.color || '#fff') : (opts.color2 || '#cfd6e4')));
  const fonts = opts.fonts || arr.map(() => opts.font || '700 {s}px "Rajdhani", "Nirmala UI", "Noto Sans", sans-serif');
  let total = 0;
  for (let i = 0; i < arr.length; i++) total += sizes[i] * h * 1.12;
  let y = (h - total) / 2;
  g.textAlign = 'center';
  g.textBaseline = 'top';
  for (let i = 0; i < arr.length; i++) {
    let s = sizes[i] * h;
    g.font = fonts[i].replace('{s}', Math.round(s));
    // shrink to fit
    while (g.measureText(arr[i]).width > w * 0.92 && s > 8) { s *= 0.92; g.font = fonts[i].replace('{s}', Math.round(s)); }
    if (opts.glow) { g.shadowColor = colors[i]; g.shadowBlur = h * 0.06; }
    g.fillStyle = colors[i];
    g.fillText(arr[i], w / 2, y + (sizes[i] * h - s) / 2);
    g.shadowBlur = 0;
    y += sizes[i] * h * 1.12;
  }
  return c;
}

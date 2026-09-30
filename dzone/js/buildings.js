// Procedural Indian buildings. Everything enterable is built from real wall segments around door/window
// openings, with switchback stairs, stairwell holes, a rooftop "mumty" stair room, chajja sunshades,
// window grills, balconies and black rooftop water tanks. Colliders go into Physics as AABBs.
import * as THREE from 'three';
import { SURF } from './physics.js';
import { col, WHITE } from './geo.js';
import { textCanvas } from './util.js';

// ------------------------------------------------------------------ local frame (90° rotations)
export class Frame {
  constructor(ctx, cx, cz, rot, base = 0) { this.ctx = ctx; this.cx = cx; this.cz = cz; this.rot = ((rot % 4) + 4) % 4; this.base = base; }
  w(lx, lz) {
    const { cx, cz } = this;
    switch (this.rot) {
      case 0: return [cx + lx, cz + lz];
      case 1: return [cx + lz, cz - lx];
      case 2: return [cx - lx, cz - lz];
      default: return [cx - lz, cz + lx];
    }
  }
  aabb(lx0, lz0, lx1, lz1) {
    const a = this.w(lx0, lz0), b = this.w(lx1, lz1);
    return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
  }
  box(lx0, y0, lz0, lx1, y1, lz1, mat, color = WHITE, surf = SURF.concrete, collide = true, skip = '') {
    if (lx1 - lx0 < 0.005 || lz1 - lz0 < 0.005 || y1 - y0 < 0.005) return;
    const [x0, z0, x1, z1] = this.aabb(lx0, lz0, lx1, lz1);
    this.ctx.geo.box(x0, y0, z0, x1, y1, z1, mat, color, skip);
    if (collide) this.ctx.phys.addBox(x0, y0, z0, x1, y1, z1, surf);
  }
  // world-space rotation angle for three geometries placed in this frame
  get ang() { return [0, Math.PI / 2, Math.PI, -Math.PI / 2][this.rot]; }
  place(g, lx, y, lz, rotY, mat, color = WHITE, scale = null) {
    const [x, z] = this.w(lx, lz);
    const m = new THREE.Matrix4().makeRotationY(this.ang + (rotY || 0));
    if (scale) m.scale(new THREE.Vector3(...scale));
    m.setPosition(x, y, z);
    this.ctx.geo.geom(g, m, mat, color);
  }
  quad(pts, mat, color = WHITE, uvs = null) {
    this.ctx.geo.quad(pts.map(([lx, y, lz]) => { const [x, z] = this.w(lx, lz); return [x, y, z]; }), mat, color, uvs);
  }
  tri(pts, mat, color = WHITE) {
    this.ctx.geo.tri(pts.map(([lx, y, lz]) => { const [x, z] = this.w(lx, lz); return [x, y, z]; }), mat, color);
  }
  loot(lx, y, lz, tier = 0) { const [x, z] = this.w(lx, lz); this.ctx.loot.push({ x, y: y + 0.05, z, tier }); }
}

// ------------------------------------------------------------------ sign atlas
export class SignAtlas {
  constructor() {
    this.cw = 512; this.ch = 128; this.cols = 4; this.rows = 16;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.cw * this.cols; this.canvas.height = this.ch * this.rows;
    this.g = this.canvas.getContext('2d');
    this.map = new Map();
    this.n = 0;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 8;
  }
  add(lines, opts) {
    const key = JSON.stringify([lines, opts]);
    if (this.map.has(key)) return this.map.get(key);
    const i = this.n % (this.cols * this.rows); this.n++;
    const cx = (i % this.cols) * this.cw, cy = Math.floor(i / this.cols) * this.ch;
    const c = textCanvas(lines, { w: this.cw, h: this.ch, ...opts });
    this.g.drawImage(c, cx, cy);
    const W = this.canvas.width, H = this.canvas.height;
    // canvas y down -> uv v up (flipY texture)
    const uv = [cx / W, 1 - (cy + this.ch) / H, (cx + this.cw) / W, 1 - cy / H];
    this.map.set(key, uv);
    this.tex.needsUpdate = true;
    return uv;
  }
}

// ------------------------------------------------------------------ helpers
function splitOpenings(u0, u1, H, ops) {
  ops = ops.filter((o) => o.b > u0 + 0.05 && o.a < u1 - 0.05).sort((a, b) => a.a - b.a);
  const out = [];
  let cur = u0;
  for (const o of ops) {
    const a = Math.max(o.a, cur), b = Math.min(o.b, u1);
    if (b <= a) continue;
    if (a > cur + 0.01) out.push([cur, a, 0, H]);
    if (o.v0 > 0.01) out.push([a, b, 0, o.v0]);
    if (o.v1 < H - 0.01) out.push([a, b, o.v1, H]);
    cur = b;
  }
  if (cur < u1 - 0.01) out.push([cur, u1, 0, H]);
  return out;
}

// walls: side 0 front(+z) 1 back(-z) 2 left(-x) 3 right(+x). u runs along +x (front/back) or +z (left/right)
function wallSide(F, S, side, y0, H, ops, mat, color, surf) {
  const { w, d, t } = S;
  const rects = side < 2 ? splitOpenings(-w / 2, w / 2, H, ops) : splitOpenings(-d / 2 + t, d / 2 - t, H, ops);
  for (const [a, b, v0, v1] of rects) {
    if (side === 0) F.box(a, y0 + v0, d / 2 - t, b, y0 + v1, d / 2, mat, color, surf);
    else if (side === 1) F.box(a, y0 + v0, -d / 2, b, y0 + v1, -d / 2 + t, mat, color, surf);
    else if (side === 2) F.box(-w / 2, y0 + v0, a, -w / 2 + t, y0 + v1, b, mat, color, surf);
    else F.box(w / 2 - t, y0 + v0, a, w / 2, y0 + v1, b, mat, color, surf);
  }
}

// decorate one window opening: sill, chajja (sunshade), optional grill
function windowDeco(F, S, side, y0, o, grill) {
  const { w, d } = S;
  const trim = S.trimCol || col('#d8d2c6');
  const out = 0.45;
  const place = (a, b, v0, v1, depth, mat, colr, collide = false) => {
    if (side === 0) F.box(a, y0 + v0, d / 2, b, y0 + v1, d / 2 + depth, mat, colr, SURF.concrete, collide);
    else if (side === 1) F.box(a, y0 + v0, -d / 2 - depth, b, y0 + v1, -d / 2, mat, colr, SURF.concrete, collide);
    else if (side === 2) F.box(-w / 2 - depth, y0 + v0, a, -w / 2, y0 + v1, b, mat, colr, SURF.concrete, collide);
    else F.box(w / 2, y0 + v0, a, w / 2 + depth, y0 + v1, b, mat, colr, SURF.concrete, collide);
  };
  if (o.v0 > 0.1) place(o.a - 0.08, o.b + 0.08, o.v0 - 0.08, o.v0, 0.08, 'concrete', trim);
  if (S.chajja !== false) place(o.a - 0.25, o.b + 0.25, o.v1 + 0.05, o.v1 + 0.14, out, 'concrete', trim);
  if (grill) {
    const n = Math.max(2, Math.round((o.b - o.a) / 0.22));
    const gc = S.grillCol || col('#2b2f33');
    for (let k = 1; k < n; k++) {
      const u = o.a + ((o.b - o.a) * k) / n;
      place(u - 0.015, u + 0.015, o.v0, o.v1, 0.05, 'metal', gc);
    }
    place(o.a, o.b, (o.v0 + o.v1) / 2 - 0.015, (o.v0 + o.v1) / 2 + 0.015, 0.05, 'metal', gc);
  }
}

function windowsAlong(len, H, winW, v0, v1, spacing = 3.1, avoid = []) {
  const n = Math.max(0, Math.floor((len - 1.2) / spacing));
  const ops = [];
  for (let k = 0; k < n; k++) {
    const u = -len / 2 + (len * (k + 0.5)) / n;
    const a = u - winW / 2, b = u + winW / 2;
    if (avoid.some(([p, q]) => b > p - 0.3 && a < q + 0.3)) continue;
    ops.push({ a, b, v0, v1, win: true });
  }
  return ops;
}

// terrain analysis for a footprint
function footprint(ctx, F, w, d) {
  let mx = -Infinity, mn = Infinity;
  const hs = {};
  for (const [lx, lz, tag] of [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2], [0, 0], [0, d / 2, 'front'], [0, -d / 2, 'back'], [-w / 2, 0], [w / 2, 0]]) {
    const [x, z] = F.w(lx, lz);
    const h = ctx.phys.height(x, z);
    if (tag) hs[tag] = h;
    if (h > mx) mx = h; if (h < mn) mn = h;
  }
  return { max: mx, min: mn, ...hs };
}

function rooftopTank(F, lx, y, lz) {
  const g = new THREE.CylinderGeometry(0.55, 0.55, 1.1, 14);
  F.place(g, lx, y + 0.55, lz, 0, 'tank', col('#16181a'));
  F.box(lx - 0.6, y, lz - 0.6, lx + 0.6, y + 0.05, lz + 0.6, 'concrete', col('#9a958c'), SURF.concrete, false);
}
function dish(F, lx, y, lz) {
  const g = new THREE.SphereGeometry(0.35, 10, 6, 0, Math.PI * 2, 0, 0.9);
  F.place(g, lx, y + 0.9, lz, 0.6, 'metal', col('#d9d9d9'), [1, 0.35, 1]);
  F.box(lx - 0.03, y, lz - 0.03, lx + 0.03, y + 0.9, lz + 0.03, 'metal', col('#555'), SURF.metal, false);
}

// ------------------------------------------------------------------ the core enterable shell
// S: {cx,cz,w,d,rot,floors,H,t,wallMat,wallCol,trimCol,floorMat,roof,roofMat,roofCol,shop,shopClosed,balcony,grills,
//     tank,dish,compound,veranda,lootTier,signs,winW,shutterCol}
export function shell(ctx, S) {
  const rng = ctx.rng;
  S.H = S.H || 3.2; S.t = S.t || 0.22;
  const { w, d, H, t } = S;
  const floors = S.floors;
  // on slopes, face the door uphill so it stays reachable
  let F = new Frame(ctx, S.cx, S.cz, S.rot);
  let fp = footprint(ctx, F, w, d);
  if (S.faceUphill && fp.max - fp.min > 0.8) {
    let best = -Infinity, bestRot = S.rot;
    for (let r = 0; r < 4; r++) {
      if ((r % 2) !== (S.rot % 2) && Math.abs(w - d) > 1.5) continue;
      const F2 = new Frame(ctx, S.cx, S.cz, r);
      const [x, z] = F2.w(0, d / 2 + 0.5);
      const hh = ctx.phys.height(x, z);
      if (hh > best) { best = hh; bestRot = r; }
    }
    F = new Frame(ctx, S.cx, S.cz, bestRot);
    fp = footprint(ctx, F, w, d);
  }
  const base = fp.max + (S.plinth ?? 0.3);
  F.base = base;
  const stilts = base - fp.min > 1.6;
  const wallMat = S.wallMat || 'plaster', floorMat = S.floorMat || 'terrazzo';
  const wc = S.wallCol, trim = S.trimCol || col('#e9e4da');
  const surf = S.surf ?? SURF.concrete;

  // --- base: plinth or stilts
  if (stilts) {
    F.box(-w / 2, base - 0.3, -d / 2, w / 2, base - 0.02, d / 2, 'concrete', col('#a8a39a'), SURF.concrete, true, '');
    const nx = Math.max(2, Math.round(w / 3.2) + 1), nz = Math.max(2, Math.round(d / 3.2) + 1);
    for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) {
      if (i > 0 && i < nx - 1 && k > 0 && k < nz - 1) continue;
      const lx = -w / 2 + 0.2 + ((w - 0.4) * i) / (nx - 1), lz = -d / 2 + 0.2 + ((d - 0.4) * k) / (nz - 1);
      const [x, z] = F.w(lx, lz);
      const th = ctx.phys.height(x, z) - 0.4;
      F.box(lx - 0.17, th, lz - 0.17, lx + 0.17, base - 0.3, lz + 0.17, 'concrete', col('#9d988f'), SURF.concrete);
    }
  } else {
    F.box(-w / 2 - 0.05, fp.min - 0.8, -d / 2 - 0.05, w / 2 + 0.05, base - 0.02, d / 2 + 0.05, S.plinthMat || 'concrete', S.plinthCol || col('#8f8a80'), SURF.concrete, true);
  }
  F.box(-w / 2 + t, base - 0.02, -d / 2 + t, w / 2 - t, base, d / 2 - t, floorMat, WHITE, SURF.concrete, true, 'b');

  // --- stairs geometry (two lanes, switchback)
  const hasStairs = floors > 1 || S.roof === 'flat';
  const lane = 1.15;
  const sx0 = -w / 2 + t;
  const sz0 = -d / 2 + t + 1.2, run = 4.2, sz1 = sz0 + run;
  const laneX = (L) => [sx0 + L * lane, sx0 + (L + 1) * lane];
  const stairsFit = hasStairs && d >= 7.2 && w >= 6;
  const flights = stairsFit ? (S.roof === 'flat' ? floors : floors - 1) : 0;

  // door + front openings
  const doorU = Math.min(w / 4, w / 2 - 1.2);
  const doorOp = { a: doorU - 0.65, b: doorU + 0.65, v0: 0, v1: 2.3 };

  for (let f = 0; f < floors; f++) {
    const y0 = base + f * H;
    const wh = f === floors - 1 && S.roof !== 'flat' ? H : H;
    const winW = S.winW || 1.1;
    const wv0 = S.winV0 ?? 0.95, wv1 = S.winV1 ?? 2.2;
    // front
    let front;
    if (f === 0 && S.shop) {
      const units = Math.max(1, Math.round(w / 5));
      const uw = w / units;
      front = [];
      for (let u = 0; u < units; u++) {
        const a = -w / 2 + u * uw + 0.3, b = -w / 2 + (u + 1) * uw - 0.3;
        front.push({ a, b, v0: 0, v1: 2.75, shop: true, unit: u });
      }
    } else {
      front = windowsAlong(w, wh, winW, wv0, wv1, 3.1, f === 0 ? [[doorOp.a, doorOp.b]] : []);
      if (f === 0) front.push(doorOp);
      if (f > 0 && S.balcony) {
        // a balcony door replaces the middle window
        front = front.filter((o) => !(o.a < 0.7 && o.b > -0.7));
        front.push({ a: -0.6, b: 0.6, v0: 0, v1: 2.3 });
      }
    }
    const back = windowsAlong(w, wh, winW, wv0, wv1, 3.4, f === 0 && S.shop ? [[-0.6, 0.6]] : []);
    if (f === 0 && S.shop) back.push({ a: -0.6, b: 0.6, v0: 0, v1: 2.3 });
    const left = windowsAlong(d - 2 * t, wh, winW, wv0, wv1, 3.4);
    const right = windowsAlong(d - 2 * t, wh, winW, wv0, wv1, 3.4);
    const sides = [front, back, left, right];
    for (let s = 0; s < 4; s++) {
      wallSide(F, S, s, y0, wh, sides[s], wallMat, wc, surf);
      for (const o of sides[s]) if (o.win) windowDeco(F, S, s, y0, o, S.grills && (f === 0 || rng() < 0.4));
    }
    // shopfront: shutters, counters, signs, partitions
    if (f === 0 && S.shop) {
      for (const o of front) {
        const closed = S.shopClosed || rng() < 0.15;
        const sc = S.shutterCol || col(ctx.rng.pick(['#4a6fa5', '#2e7d32', '#8d6e63', '#607d8b', '#c62828', '#9e9e9e']));
        if (closed) F.box(o.a, y0, d / 2 - 0.16, o.b, y0 + 2.75, d / 2 - 0.1, 'shutterPaint', sc, SURF.metal, true);
        else F.box(o.a, y0 + 2.45, d / 2 - 0.34, o.b, y0 + 2.75, d / 2 - 0.1, 'shutterPaint', sc, SURF.metal, false);
        // counter + shelf
        if (!closed) {
          F.box(o.a + 0.2, y0, d / 2 - 1.6, (o.a + o.b) / 2, y0 + 0.95, d / 2 - 1.05, 'wood', col('#c9a37a'), SURF.wood);
          F.box(o.a + 0.2, y0, -d / 2 + t + 0.02, o.b - 0.2, y0 + 2.0, -d / 2 + t + 0.5, 'wood', col('#b28c62'), SURF.wood);
          F.loot((o.a + o.b) / 2, y0, d / 2 - 2.3, S.lootTier || 0);
        }
        // sign board above the unit
        if (ctx.signs) {
          const txt = ctx.rng.pick(ctx.map.signs);
          const neon = ctx.night || ctx.rng() < 0.25;
          const bgc = neon ? '#0b0f16' : ctx.rng.pick(['#fdd835', '#e53935', '#1e88e5', '#ffffff', '#43a047', '#fb8c00']);
          const fgc = neon ? ctx.rng.pick(ctx.map.neon) : (bgc === '#ffffff' || bgc === '#fdd835' ? '#b71c1c' : '#ffffff');
          const uv = ctx.signs.add([txt], { bg: bgc, color: fgc, glow: neon, sizes: [0.62] });
          const y1 = y0 + 2.8, y2 = y0 + 3.6;
          F.box(o.a, y1, d / 2, o.b, y2, d / 2 + 0.1, 'concrete', col('#333'), SURF.concrete, false);
          const u = [[uv[0], uv[1]], [uv[2], uv[1]], [uv[2], uv[3]], [uv[0], uv[3]]];
          F.quad([[o.a + 0.05, y1 + 0.05, d / 2 + 0.11], [o.b - 0.05, y1 + 0.05, d / 2 + 0.11], [o.b - 0.05, y2 - 0.05, d / 2 + 0.11], [o.a + 0.05, y2 - 0.05, d / 2 + 0.11]], 'signs', WHITE, u);
        }
      }
      // partitions between units, open near the back
      const units = front.length;
      for (let u = 1; u < units; u++) {
        const x = -w / 2 + (u * w) / units;
        if (x < sx0 + 2 * lane + 0.4) continue;
        F.box(x - 0.1, y0, -d / 2 + t + 1.6, x + 0.1, y0 + H, d / 2 - t, wallMat, wc, surf);
      }
    }
    // floor slab above (ceiling) with stairwell hole
    const top = base + (f + 1) * H;
    const isRoof = f === floors - 1;
    if (!isRoof || S.roof === 'flat' || S.roof === 'hip' || S.roof === 'gable' || S.roof === 'mono') {
      const holeLane = stairsFit && (f < flights) ? f % 2 : -1;
      slab(F, S, top - 0.22, top, holeLane, laneX, sz0, sz1, isRoof ? (S.roofTopMat || 'concrete') : floorMat, isRoof);
      if (holeLane >= 0 && !isRoof) rails(F, S, top, holeLane, laneX, sz0, sz1);
    }
    // stairs flight from this floor
    if (stairsFit && f < flights) flight(F, y0, f % 2, laneX, sz0, run, H);
    // interior furniture + loot
    if (!(f === 0 && S.shop)) furnish(ctx, F, S, y0, stairsFit, sx0 + 2 * lane);
  }

  const roofY = base + floors * H;
  // --- roof
  if (S.roof === 'flat') {
    // parapet
    const ph = 0.95;
    F.box(-w / 2, roofY, d / 2 - 0.18, w / 2, roofY + ph, d / 2, wallMat, wc, surf);
    F.box(-w / 2, roofY, -d / 2, w / 2, roofY + ph, -d / 2 + 0.18, wallMat, wc, surf);
    F.box(-w / 2, roofY, -d / 2 + 0.18, -w / 2 + 0.18, roofY + ph, d / 2 - 0.18, wallMat, wc, surf);
    F.box(w / 2 - 0.18, roofY, -d / 2 + 0.18, w / 2, roofY + ph, d / 2 - 0.18, wallMat, wc, surf);
    F.box(-w / 2 - 0.04, roofY + ph, -d / 2 - 0.04, w / 2 + 0.04, roofY + ph + 0.08, d / 2 + 0.04, 'concrete', trim, SURF.concrete, false);
    if (stairsFit) mumty(ctx, F, S, roofY, (floors - 1) % 2, laneX, sz0, sz1);
    if (S.tank !== false && rng() < 0.85) rooftopTank(F, stairsFit ? sx0 + lane : 0, roofY + (stairsFit ? 2.75 : 0), stairsFit ? (sz0 + sz1) / 2 : 0);
    if (S.dish !== false && rng() < 0.6) dish(F, w / 2 - 1, roofY, d / 2 - 1.2);
    if (rng() < 0.5) F.loot(w / 4, roofY, 0, S.lootTier || 0);
    ctx.roofs.push({ F, roofY, w, d });
  } else if (S.roof === 'hip') hipRoof(F, w, d, roofY, S);
  else if (S.roof === 'gable') gableRoof(F, w, d, roofY, S);
  else if (S.roof === 'mono') monoRoof(F, w, d, roofY, S);

  // front entry steps
  const [ex, ez] = F.w(doorU, d / 2 + 0.6);
  const eh = ctx.phys.height(ex, ez);
  if (base - eh > 0.45) {
    const n = Math.min(14, Math.ceil((base - eh) / 0.2));
    const rise = (base - eh) / n;
    for (let i = 0; i < n; i++) {
      const z0 = d / 2 + i * 0.3;
      F.box(doorU - 0.75, eh - 0.3, z0, doorU + 0.75, base - i * rise, z0 + 0.3, 'concrete', col('#9a958c'), SURF.concrete);
    }
  }
  if (S.balcony) {
    for (let f = 1; f < floors; f++) {
      const y0 = base + f * H;
      F.box(-2.2, y0 - 0.2, d / 2, 2.2, y0, d / 2 + 1.2, 'concrete', trim, SURF.concrete);
      F.box(-2.2, y0, d / 2 + 1.1, 2.2, y0 + 1.0, d / 2 + 1.2, wallMat, wc, surf);
      F.box(-2.2, y0, d / 2, -2.1, y0 + 1.0, d / 2 + 1.1, wallMat, wc, surf);
      F.box(2.1, y0, d / 2, 2.2, y0 + 1.0, d / 2 + 1.1, wallMat, wc, surf);
    }
  }
  if (S.veranda) veranda(F, S, base);
  if (S.compound) compoundWall(ctx, F, S, base);
  ctx.buildings.push({ F, w, d, base, floors, H, top: roofY });
  return F;
}

export function slab(F, S, y0, y1, holeLane, laneX, sz0, sz1, mat, isRoof) {
  const { w, d } = S;
  const c = isRoof ? col('#b5b0a6') : WHITE;
  if (holeLane < 0) { F.box(-w / 2, y0, -d / 2, w / 2, y1, d / 2, mat, c, SURF.concrete); return; }
  const [hx0, hx1] = laneX(holeLane);
  F.box(-w / 2, y0, -d / 2, w / 2, y1, sz0, mat, c, SURF.concrete);
  F.box(-w / 2, y0, sz1, w / 2, y1, d / 2, mat, c, SURF.concrete);
  if (hx0 > -w / 2) F.box(-w / 2, y0, sz0, hx0, y1, sz1, mat, c, SURF.concrete);
  F.box(hx1, y0, sz0, w / 2, y1, sz1, mat, c, SURF.concrete);
}

export function rails(F, S, y, holeLane, laneX, sz0, sz1) {
  const [hx0, hx1] = laneX(holeLane);
  const rc = col('#3a3f45');
  // rail on the inner (right) side of the hole, leave both ends open for the flights
  F.box(hx1 - 0.05, y, sz0 + 0.1, hx1 + 0.05, y + 1.0, sz1 - 0.1, 'metal', rc, SURF.metal);
  if (holeLane === 1) F.box(hx0 - 0.05, y, sz0 + 0.1, hx0 + 0.05, y + 1.0, sz1 - 0.1, 'metal', rc, SURF.metal);
}

export function flight(F, y0, L, laneX, sz0, run, H) {
  const [x0, x1] = laneX(L);
  const n = 16, rise = H / n, dz = run / n;
  const sc = col('#bdb7ad');
  for (let i = 0; i < n; i++) {
    const top = y0 + (i + 1) * rise;
    // lane 0 rises toward +z, lane 1 toward -z
    const z0 = L === 0 ? sz0 + i * dz : sz0 + run - (i + 1) * dz;
    F.box(x0 + 0.02, y0, z0, x1 - 0.02, top, z0 + dz, 'concrete', sc, SURF.concrete);
  }
}

function mumty(ctx, F, S, roofY, L, laneX, sz0, sz1) {
  const { t } = S;
  const x0 = -S.w / 2, x1 = laneX(1)[1] + 0.2;
  const z0 = sz0 - 1.2, z1 = sz1 + 1.2;
  const h = 2.6;
  const wc = S.wallCol, wm = S.wallMat || 'plaster';
  // door on the inner wall at the arrival end
  const dz0 = L === 0 ? sz1 - 0.1 : z0 + 0.1, dz1 = dz0 + 1.1;
  F.box(x1 - t, roofY, z0, x1, roofY + h, dz0, wm, wc);
  F.box(x1 - t, roofY, dz1, x1, roofY + h, z1, wm, wc);
  F.box(x1 - t, roofY + 2.2, dz0, x1, roofY + h, dz1, wm, wc);
  F.box(x0 + 0.18, roofY, z1 - t, x1 - t, roofY + h, z1, wm, wc);
  F.box(x0 + 0.18, roofY, z0, x1 - t, roofY + h, z0 + t, wm, wc);
  F.box(x0 + 0.18, roofY, z0 + t, x0 + 0.18 + t, roofY + h, z1 - t, wm, wc);
  F.box(x0, roofY + h, z0, x1 + 0.1, roofY + h + 0.15, z1, 'concrete', col('#a9a39a'));
}

function furnish(ctx, F, S, y0, stairs, freeX) {
  const rng = ctx.rng;
  const { w, d, t } = S;
  const xa = stairs ? freeX + 0.4 : -w / 2 + t + 0.6, xb = w / 2 - t - 0.6;
  const za = -d / 2 + t + 0.5, zb = d / 2 - t - 0.8;
  if (xb - xa < 1.2) return;
  // steel almirah against the back wall
  if (rng() < 0.7) {
    const ax = xb - 0.5;
    F.box(ax - 0.5, y0, za - 0.3, ax + 0.5, y0 + 1.95, za + 0.35, 'metal', col(rng.pick(['#7b8a8b', '#6d7f8c', '#8a7f72'])), SURF.metal);
  }
  // table / bed
  if (rng() < 0.6) {
    const tx = (xa + xb) / 2, tz = (za + zb) / 2 + 0.4;
    if (rng() < 0.5) F.box(tx - 0.6, y0, tz - 0.4, tx + 0.6, y0 + 0.76, tz + 0.4, 'wood', col('#8b5e3c'), SURF.wood);
    else F.box(tx - 0.95, y0, tz - 1.0, tx + 0.95, y0 + 0.5, tz + 1.0, 'wood', col('#b0896a'), SURF.wood);
  }
  const n = 1 + (rng() < 0.6 ? 1 : 0) + (S.lootTier ? 1 : 0);
  for (let i = 0; i < n; i++) F.loot(xa + rng() * (xb - xa), y0, za + 0.5 + rng() * (zb - za - 0.5), S.lootTier || 0);
}

// ------------------------------------------------------------------ roofs
function hipRoof(F, w, d, y, S) {
  const o = 0.7, rh = Math.min(w, d) * 0.38;
  const W = w / 2 + o, D = d / 2 + o;
  const mat = S.roofMat || 'rooftile', c = S.roofCol || WHITE;
  const ridge = Math.max(0, W - D);
  const yb = y - 0.25;
  if (w >= d) {
    F.quad([[-W, yb, D], [W, yb, D], [ridge, y + rh, 0], [-ridge, y + rh, 0]], mat, c);
    F.quad([[W, yb, -D], [-W, yb, -D], [-ridge, y + rh, 0], [ridge, y + rh, 0]], mat, c);
    F.tri([[W, yb, D], [W, yb, -D], [ridge, y + rh, 0]], mat, c);
    F.tri([[-W, yb, -D], [-W, yb, D], [-ridge, y + rh, 0]], mat, c);
  } else {
    const r2 = D - W;
    F.quad([[W, yb, D], [W, yb, -D], [0, y + rh, -r2], [0, y + rh, r2]], mat, c);
    F.quad([[-W, yb, -D], [-W, yb, D], [0, y + rh, r2], [0, y + rh, -r2]], mat, c);
    F.tri([[-W, yb, D], [W, yb, D], [0, y + rh, r2]], mat, c);
    F.tri([[W, yb, -D], [-W, yb, -D], [0, y + rh, -r2]], mat, c);
  }
  // underside + collider
  F.box(-W, yb - 0.05, -D, W, yb, D, 'wood', col('#6b4a32'), SURF.wood, false, 't');
  F.box(-w / 2, y, -d / 2, w / 2, y + rh * 0.55, d / 2, 'wood', WHITE, SURF.wood, true, 'tbxXzZ');
}

function gableRoof(F, w, d, y, S) {
  const o = 0.5, rh = Math.min(w, d) * 0.32;
  const W = w / 2 + o, D = d / 2 + o;
  const mat = S.roofMat || 'tin', c = S.roofCol || WHITE;
  F.quad([[-W, y, D], [W, y, D], [W, y + rh, 0], [-W, y + rh, 0]], mat, c);
  F.quad([[W, y, -D], [-W, y, -D], [-W, y + rh, 0], [W, y + rh, 0]], mat, c);
  // gable ends
  const wm = S.wallMat || 'plaster';
  F.tri([[w / 2, y, d / 2], [w / 2, y, -d / 2], [w / 2, y + rh * 0.95, 0]], wm, S.wallCol);
  F.tri([[-w / 2, y, -d / 2], [-w / 2, y, d / 2], [-w / 2, y + rh * 0.95, 0]], wm, S.wallCol);
  F.box(-W, y - 0.05, -D, W, y, D, 'wood', col('#5d4431'), SURF.wood, false, 't');
  F.box(-w / 2, y, -d / 2, w / 2, y + rh * 0.5, d / 2, 'wood', WHITE, SURF.metal, true, 'tbxXzZ');
}

function monoRoof(F, w, d, y, S) {
  const o = 0.5, rh = 1.1;
  const W = w / 2 + o, D = d / 2 + o;
  const mat = S.roofMat || 'tin', c = S.roofCol || WHITE;
  F.quad([[-W, y, D], [W, y, D], [W, y + rh, -D], [-W, y + rh, -D]], mat, c);
  F.quad([[W, y, D], [-W, y, D], [-W, y + rh, -D], [W, y + rh, -D]].map((p) => [p[0], p[1] - 0.04, p[2]]).reverse(), 'wood', col('#5d4431'));
  const wm = S.wallMat || 'plaster';
  F.tri([[w / 2, y, d / 2], [w / 2, y, -d / 2], [w / 2, y + rh * 0.95, -d / 2]], wm, S.wallCol);
  F.tri([[-w / 2, y, -d / 2], [-w / 2, y, d / 2], [-w / 2, y + rh * 0.95, -d / 2]], wm, S.wallCol);
  F.box(-w / 2, y, -d / 2, w / 2, y + rh * 0.95, -d / 2 + 0.2, wm, S.wallCol);
  F.box(-w / 2, y, -d / 2, w / 2, y + 0.4, d / 2, 'wood', WHITE, SURF.metal, true, 'tbxXzZ');
}

function veranda(F, S, base) {
  const { w, d } = S;
  const vd = 2.2, H = S.H;
  F.box(-w / 2, base - 0.5, d / 2, w / 2, base - 0.02, d / 2 + vd, 'concrete', col('#9a948a'), SURF.concrete);
  F.box(-w / 2, base - 0.02, d / 2, w / 2, base, d / 2 + vd, S.floorMat || 'terrazzo', WHITE, SURF.concrete, false, 'b');
  const n = Math.max(2, Math.round(w / 3));
  const g = new THREE.CylinderGeometry(0.14, 0.16, H - 0.1, 10);
  for (let i = 0; i <= n; i++) {
    const x = -w / 2 + 0.3 + ((w - 0.6) * i) / n;
    F.place(g, x, base + (H - 0.1) / 2, d / 2 + vd - 0.3, 0, 'plaster', col('#f2eee6'));
    const [wx, wz] = F.w(x, d / 2 + vd - 0.3);
    F.ctx.phys.addBox(wx - 0.16, base, wz - 0.16, wx + 0.16, base + H, wz + 0.16, SURF.concrete);
  }
  if (S.roof === 'hip') {
    const y = base + H;
    F.quad([[-w / 2 - 0.3, y - 0.6, d / 2 + vd + 0.5], [w / 2 + 0.3, y - 0.6, d / 2 + vd + 0.5], [w / 2 + 0.3, y + 0.1, d / 2], [-w / 2 - 0.3, y + 0.1, d / 2]], S.roofMat || 'rooftile', S.roofCol || WHITE);
    F.box(-w / 2, y - 0.62, d / 2, w / 2, y - 0.55, d / 2 + vd + 0.4, 'wood', col('#5d4431'), SURF.wood, false, 't');
  } else {
    F.box(-w / 2, base + H - 0.2, d / 2, w / 2, base + H, d / 2 + vd, 'concrete', col('#d6d0c4'), SURF.concrete);
  }
}

function compoundWall(ctx, F, S, base) {
  const { w, d } = S;
  const m = 2.2, h = 1.5;
  const X = w / 2 + m, Z0 = -d / 2 - 1.2, Z1 = d / 2 + (S.veranda ? 2.2 : 0) + m + 0.6;
  const mat = S.compound.mat || 'laterite', c = S.compound.col || WHITE;
  const gy = (lx, lz) => { const [x, z] = F.w(lx, lz); return ctx.phys.height(x, z) - 0.3; };
  const y0 = Math.min(gy(-X, Z0), gy(X, Z0), gy(-X, Z1), gy(X, Z1));
  const gateU = Math.min(w / 4, w / 2 - 1.2);
  F.box(-X, y0, Z1 - 0.25, gateU - 1.3, y0 + h + 0.3, Z1, mat, c, SURF.concrete);
  F.box(gateU + 1.3, y0, Z1 - 0.25, X, y0 + h + 0.3, Z1, mat, c, SURF.concrete);
  F.box(-X, y0, Z0, X, y0 + h + 0.3, Z0 + 0.25, mat, c, SURF.concrete);
  F.box(-X, y0, Z0 + 0.25, -X + 0.25, y0 + h + 0.3, Z1 - 0.25, mat, c, SURF.concrete);
  F.box(X - 0.25, y0, Z0 + 0.25, X, y0 + h + 0.3, Z1 - 0.25, mat, c, SURF.concrete);
  // gate posts
  F.box(gateU - 1.5, y0, Z1 - 0.35, gateU - 1.2, y0 + h + 0.7, Z1 + 0.05, 'concrete', col('#e0dbd0'));
  F.box(gateU + 1.2, y0, Z1 - 0.35, gateU + 1.5, y0 + h + 0.7, Z1 + 0.05, 'concrete', col('#e0dbd0'));
}

// ------------------------------------------------------------------ archetypes
const pick = (ctx, arr) => ctx.rng.pick(arr);

export function buildArchetype(ctx, kind, P) {
  const rng = ctx.rng, M = ctx.map;
  const wall = () => col(pick(ctx, M.walls), 0.05, rng);
  const roofC = () => col(pick(ctx, M.roofs || ['#8f3a28']), 0.08, rng);
  const base = { cx: P.cx, cz: P.cz, w: P.w, d: P.d, rot: P.rot };
  switch (kind) {
    case 'house':
      return shell(ctx, { ...base, floors: rng.int(1, 3), wallCol: wall(), roof: 'flat', grills: true, balcony: rng() < 0.5, faceUphill: true });
    case 'apartment':
      return shell(ctx, { ...base, floors: rng.int(3, 4), wallCol: wall(), roof: 'flat', grills: true, balcony: true, faceUphill: true });
    case 'shop':
      return shell(ctx, { ...base, floors: rng.int(1, 3), wallCol: wall(), roof: 'flat', shop: true, shopClosed: ctx.harthal, balcony: rng() < 0.4, grills: true });
    case 'oldhouse':
      return shell(ctx, { ...base, floors: rng.int(1, 2), wallCol: wall(), roof: 'hip', roofMat: 'rooftile', roofCol: roofC(), grills: true, veranda: rng() < 0.5 });
    case 'kerala':
      return shell(ctx, { ...base, floors: rng.int(1, 2), wallCol: wall(), roof: 'hip', roofMat: 'rooftile', roofCol: roofC(), plinthMat: 'laterite', plinthCol: WHITE, grills: true, veranda: rng() < 0.7, compound: rng() < 0.6 ? { mat: 'laterite' } : null, faceUphill: true });
    case 'colonial':
      return shell(ctx, { ...base, floors: 2, H: 3.8, wallCol: col(pick(ctx, ['#f3e2a9', '#f6f1e7', '#e8d7b5', '#f2c9a0']), 0.04, rng), roof: rng() < 0.6 ? 'hip' : 'flat', roofMat: 'rooftile', roofCol: roofC(), winV0: 0.6, winV1: 2.9, winW: 1.2, trimCol: col('#ffffff'), veranda: rng() < 0.4 });
    case 'bungalow':
      return shell(ctx, { ...base, floors: rng.int(1, 2), H: 3.6, wallCol: col(pick(ctx, ['#f6f3ea', '#efe6d2', '#f3e9da']), 0.03, rng), roof: 'flat', veranda: true, compound: { mat: 'plaster', col: col('#e9e2d2') }, winV0: 0.7, winV1: 2.7, lootTier: 1 });
    case 'oldcity':
      return shell(ctx, { ...base, floors: rng.int(3, 4), wallMat: rng() < 0.4 ? 'brick' : 'plaster', wallCol: rng() < 0.4 ? WHITE : wall(), roof: 'flat', shop: true, balcony: rng() < 0.7, grills: true });
    case 'office':
      return shell(ctx, { ...base, floors: rng.int(2, 4), H: 3.6, wallMat: 'concrete', wallCol: col(pick(ctx, ['#d9dcdf', '#c8ccd0', '#e3e0da']), 0.03, rng), floorMat: 'concreteFloor', roof: 'flat', winW: 2.6, winV0: 0.8, winV1: 3.0, chajja: false, lootTier: 1, dish: false });
    case 'hill':
      return shell(ctx, { ...base, floors: rng.int(2, 4), wallCol: wall(), roof: rng() < 0.55 ? 'mono' : 'flat', roofMat: 'tin', roofCol: roofC(), grills: true, balcony: rng() < 0.4, faceUphill: true, plinth: 0.2 });
    case 'hut':
      return shell(ctx, { ...base, floors: 1, H: 2.9, wallMat: rng() < 0.5 ? 'wood' : 'plaster', wallCol: rng() < 0.5 ? col('#b89a78', 0.08, rng) : wall(), floorMat: 'wood', roof: 'gable', roofMat: 'tin', roofCol: roofC(), faceUphill: true, plinth: 0.5, chajja: false, winW: 0.9 });
    case 'spiti':
      return spitiHouse(ctx, base);
    case 'tower':
      return tower(ctx, { ...base, h: P.h || rng.range(28, 70), style: P.style || 'glass' });
    case 'warehouse':
      return warehouse(ctx, base);
    default:
      return shell(ctx, { ...base, floors: 2, wallCol: wall(), roof: 'flat' });
  }
}

function spitiHouse(ctx, base) {
  const rng = ctx.rng;
  const F = shell(ctx, { ...base, floors: rng.int(1, 2), wallMat: 'mudwhite', wallCol: col('#f3efe6', 0.03, rng), roof: 'flat', trimCol: col('#6d1b1b'), winW: 0.9, grills: false, tank: false, dish: false, faceUphill: true, plinth: 0.2, chajja: true });
  const b = ctx.buildings[ctx.buildings.length - 1];
  // firewood stacked on the parapet and a prayer-flag pole
  const y = b.top;
  const { w, d } = base;
  for (let i = 0; i < 6; i++) {
    const x = -w / 2 + 0.6 + ((w - 1.2) * i) / 5;
    F.box(x - 0.45, y + 0.95, d / 2 - 0.35, x + 0.45, y + 1.35, d / 2 + 0.05, 'wood', col('#6b4d34', 0.1, rng), SURF.wood, false);
  }
  const g = new THREE.CylinderGeometry(0.04, 0.04, 3.2, 6);
  F.place(g, w / 2 - 0.4, y + 1.6, -d / 2 + 0.4, 0, 'wood', col('#5d4431'));
  ctx.flagPoles.push({ F, lx: w / 2 - 0.4, lz: -d / 2 + 0.4, y: y + 3.1 });
  return F;
}

function tower(ctx, P) {
  const rng = ctx.rng;
  const F = new Frame(ctx, P.cx, P.cz, P.rot);
  const fp = footprint(ctx, F, P.w, P.d);
  const y0 = fp.min - 0.5;
  const h = P.h;
  const fm = P.style === 'glass' ? ctx.pickFacade('glass') : ctx.pickFacade('conc');
  F.box(-P.w / 2, y0, -P.d / 2, P.w / 2, fp.max + h, P.d / 2, fm, WHITE, SURF.concrete, true, 'b');
  // lobby podium
  F.box(-P.w / 2 - 1.5, y0, -P.d / 2 - 1.5, P.w / 2 + 1.5, fp.max + 5, P.d / 2 + 1.5, 'concrete', col('#8d9196'), SURF.concrete);
  const top = fp.max + h;
  // crown: neon strip + rooftop plant
  const neon = col(pick(ctx, ctx.map.neon));
  const k = 3.2;
  const nc = [neon[0] * k, neon[1] * k, neon[2] * k];
  const e = 0.08;
  F.box(-P.w / 2 - e, top - 0.6, P.d / 2, P.w / 2 + e, top - 0.35, P.d / 2 + e, 'neon', nc, 0, false);
  F.box(-P.w / 2 - e, top - 0.6, -P.d / 2 - e, P.w / 2 + e, top - 0.35, -P.d / 2, 'neon', nc, 0, false);
  F.box(P.w / 2, top - 0.6, -P.d / 2, P.w / 2 + e, top - 0.35, P.d / 2, 'neon', nc, 0, false);
  F.box(-P.w / 2 - e, top - 0.6, -P.d / 2, -P.w / 2, top - 0.35, P.d / 2, 'neon', nc, 0, false);
  if (rng() < 0.5) {
    // vertical neon fin
    F.box(P.w / 2 - 1.2, fp.max + 8, P.d / 2, P.w / 2 - 0.9, top - 2, P.d / 2 + 0.25, 'neon', nc, 0, false);
  }
  F.box(-P.w / 4, top, -P.d / 4, P.w / 4, top + 3, P.d / 4, 'concrete', col('#777b80'), SURF.concrete);
  if (ctx.towerTops) ctx.towerTops.push({ x: P.cx, z: P.cz, y: top, w: P.w, d: P.d });
  ctx.buildings.push({ F, w: P.w, d: P.d, base: fp.max, floors: 0, top, tower: true });
  return F;
}

function warehouse(ctx, base) {
  const rng = ctx.rng;
  const { w, d } = base;
  const F = new Frame(ctx, base.cx, base.cz, base.rot);
  const fp = footprint(ctx, F, w, d);
  const y = fp.max + 0.2, H = 6.5, t = 0.2;
  F.box(-w / 2, fp.min - 0.6, -d / 2, w / 2, y, d / 2, 'concreteFloor', WHITE, SURF.concrete);
  const S = { w, d, t };
  const big = { a: -2.2, b: 2.2, v0: 0, v1: 4.6 };
  const side = { a: d / 4 - 0.6, b: d / 4 + 0.6, v0: 0, v1: 2.3 };
  const wc = col(pick(ctx, ['#9fa8a3', '#a7a08f', '#8a9aa6', '#b3ab9a']), 0.05, rng);
  wallSide(F, S, 0, y, H, [big], 'tin', wc, SURF.metal);
  wallSide(F, S, 1, y, H, [big], 'tin', wc, SURF.metal);
  wallSide(F, S, 2, y, H, [side], 'tin', wc, SURF.metal);
  wallSide(F, S, 3, y, H, [{ a: -d / 4 - 0.6, b: -d / 4 + 0.6, v0: 0, v1: 2.3 }], 'tin', wc, SURF.metal);
  gableRoof(F, w, d, y + H, { roofMat: 'tin', roofCol: col('#8c9296'), wallMat: 'tin', wallCol: wc });
  // cover inside: crates, pallets, a container
  const n = 3 + rng.int(0, 3);
  for (let i = 0; i < n; i++) {
    const cx = -w / 2 + 2 + rng() * (w - 4), cz = -d / 2 + 3 + rng() * (d - 6);
    if (Math.abs(cx) < 2.6) continue;
    const s = rng.range(1.0, 1.6);
    F.box(cx - s / 2, y, cz - s / 2, cx + s / 2, y + s, cz + s / 2, 'wood', col('#a88457', 0.1, rng), SURF.wood);
    if (rng() < 0.5) F.box(cx - s / 2 + 0.1, y + s, cz - s / 2 + 0.1, cx + s / 2 - 0.1, y + s * 1.8, cz + s / 2 - 0.1, 'wood', col('#9c7a50', 0.1, rng), SURF.wood);
    F.loot(cx + s * 0.9, y, cz, 1);
  }
  for (let i = 0; i < 3; i++) F.loot(-w / 4 + rng() * w / 2, y, -d / 3 + rng() * d / 1.5, 1);
  ctx.buildings.push({ F, w, d, base: y, floors: 1, H, top: y + H });
  return F;
}

// shipping container (props / yards)
export function container(ctx, x, y, z, alongX, color) {
  const L = 6.1, W = 2.44, H = 2.6;
  const [sx, sz] = alongX ? [L, W] : [W, L];
  ctx.geo.box(x - sx / 2, y, z - sz / 2, x + sx / 2, y + H, z + sz / 2, 'metal', color);
  ctx.phys.addBox(x - sx / 2, y, z - sz / 2, x + sx / 2, y + H, z + sz / 2, SURF.metal);
}

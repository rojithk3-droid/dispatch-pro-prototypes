// Landmarks and easter-egg props for every city. Each builder writes merged geometry + colliders into ctx,
// registers loot spots, climb points (tall landmarks you can scale by holding F) and easter-egg triggers.
import * as THREE from 'three';
import { Frame, shell, buildArchetype, slab, flight, rails, container } from './buildings.js';
import { SURF } from './physics.js';
import { col, WHITE } from './geo.js';
import { MM, mergeGroup, autoRickshaw, car, jeep, bike, bus, tanker, boatModel, houseboat, figure, quadruped, part } from './models.js';
import { signTexture, foliageTexture } from './assets.js';
import { segDist } from './util.js';

const PI = Math.PI;
const M4 = (x, y, z, ry = 0, s = null, rx = 0, rz = 0) => {
  const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ'));
  if (s) m.scale(new THREE.Vector3(...s));
  m.setPosition(x, y, z);
  return m;
};
const G = (ctx, geom, mat, color, x, y, z, ry = 0, s = null, rx = 0, rz = 0) => ctx.geo.geom(geom, M4(x, y, z, ry, s, rx, rz), mat, color);
function BX(ctx, x0, y0, z0, x1, y1, z1, mat, c = WHITE, surf = SURF.concrete, collide = true) {
  ctx.geo.box(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1), Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1), mat, c);
  if (collide) ctx.phys.addBox(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1), Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1), surf);
}
const H = (ctx, x, z) => ctx.phys.height(x, z);
function cyl(ctx, x, y, z, rt, rb, h, mat, c, seg = 16, collide = true) {
  G(ctx, new THREE.CylinderGeometry(rt, rb, h, seg), mat, c, x, y + h / 2, z);
  if (collide) { const r = Math.min(rt, rb) * 0.75 + 0.05; ctx.phys.addBox(x - r, y, z - r, x + r, y + h, z + r, SURF.concrete); }
}
function dome(ctx, x, y, z, r, mat, c, sy = 1) {
  G(ctx, new THREE.SphereGeometry(r, 20, 10, 0, PI * 2, 0, PI / 2), mat, c, x, y, z, 0, [1, sy, 1]);
  ctx.phys.addBox(x - r * 0.7, y, z - r * 0.7, x + r * 0.7, y + r * sy * 0.8, z + r * 0.7, SURF.concrete);
}
function modelAt(ctx, group, x, y, z, ry = 0, collide = true, shrink = 0.9) {
  const m = M4(x, y, z, ry);
  mergeGroup(ctx.geo, group, m);
  if (collide) {
    const b = new THREE.Box3().setFromObject(group).applyMatrix4(m);
    const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
    const hx = ((b.max.x - b.min.x) / 2) * shrink, hz = ((b.max.z - b.min.z) / 2) * shrink;
    ctx.phys.addBox(cx - hx, b.min.y, cz - hz, cx + hx, b.max.y * 0.98 + b.min.y * 0.02, cz + hz, SURF.metal);
  }
}
export function board(ctx, x, y, z, ry, w, h, lines, opts = {}) {
  const pw = 1024, ph = Math.max(128, Math.round((1024 * h) / w));
  const tex = signTexture(lines, { w: pw, h: ph, ...opts });
  const mat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: opts.glowI ?? (ctx.night ? 1.0 : 0.25), roughness: 0.55 });
  mat.userData.baseGlow = mat.emissiveIntensity;
  ctx.signMats.push(mat);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.position.set(x, y, z); m.rotation.y = ry;
  m.receiveShadow = true;
  ctx.group.add(m);
  const s = Math.sin(ry), c = Math.cos(ry);
  if (!opts.noBack) G(ctx, new THREE.BoxGeometry(w + 0.25, h + 0.25, 0.14), 'metal', col(opts.frame || '#1c1f24'), x - s * 0.08, y, z - c * 0.08, ry);
  return m;
}
function neon(ctx, x0, y0, z0, x1, y1, z1, hex, k = 3) {
  const c = col(hex); ctx.geo.box(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1), Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1), 'neon', [c[0] * k, c[1] * k, c[2] * k]);
}
function addEgg(ctx, e, x, z, y) { if (e) ctx.eggs.push({ ...e, x, z, y: y ?? H(ctx, x, z) }); }
const rotY = (rot) => (rot || 0) * PI / 2;
const fwd = (ry) => [Math.sin(ry), Math.cos(ry)];

const VCOL = ['#c62828', '#eeeeee', '#1565c0', '#212121', '#9e9e9e', '#f9a825', '#2e7d32', '#6d4c41', '#b0bec5', '#ffffff', '#455a64'];
function randomVehicle(rng, kinds = ['car', 'car', 'car', 'auto', 'auto', 'suv', 'bike', 'bus']) {
  const k = rng.pick(kinds);
  if (k === 'auto') return { g: autoRickshaw(rng.pick(['#1b5e20', '#1b5e20', '#f9d71c', '#212121']), rng.pick(['#f9d71c', '#1b5e20', '#111'])), len: 2.8, w: 1.4 };
  if (k === 'bus') return { g: bus(rng.pick(['#c62828', '#1565c0', '#2e7d32', '#ef6c00'])), len: 10.6, w: 2.5 };
  if (k === 'bike') return { g: bike(rng.pick(['#212121', '#b71c1c', '#1565c0'])), len: 2.0, w: 0.8 };
  if (k === 'suv') return { g: car(rng.pick(VCOL), 'suv'), len: 4.6, w: 1.9 };
  if (k === 'jeep') return { g: jeep(rng.pick(['#33691e', '#f5f5f5', '#212121'])), len: 3.9, w: 1.8 };
  return { g: car(rng.pick(VCOL), rng.pick(['hatch', 'sedan'])), len: 4.2, w: 1.75 };
}

// a line of static vehicles along x or z starting at (x,z)
function vehicleRow(ctx, x, z, len, dir, kinds, gap = 1.2, lanes = 1, laneW = 3.4, faceNeg = false) {
  const rng = ctx.rng;
  for (let l = 0; l < lanes; l++) {
    let s = -len / 2;
    while (s < len / 2) {
      const v = randomVehicle(rng, kinds);
      const c = s + v.len / 2;
      const off = (l - (lanes - 1) / 2) * laneW + (rng() - 0.5) * 0.5;
      const px = dir === 'x' ? x + c : x + off, pz = dir === 'x' ? z + off : z + c;
      const ry = dir === 'x' ? (faceNeg ? -PI / 2 : PI / 2) : (faceNeg ? PI : 0);
      modelAt(ctx, v.g, px, H(ctx, px, pz), pz, ry + (rng() - 0.5) * 0.12, true, 0.8);
      s += v.len + gap * (0.6 + rng() * 0.8);
    }
  }
}

// ================================================================== LANDMARKS
export const LANDMARK_PAD = {
  vidhana_soudha: 70, metro: 0, flyover_jam: 0, fishing_nets: 0, mall: 55, houseboat: 0, church: 30, rainbow_bridge: 0,
  lighthouse: 14, central_station: 60, gopuram: 30, tower: 20, stadium: 75, secretariat: 65, napier: 30, port_cranes: 60,
  kerala_temple: 55, elephants: 30, waterfall: 0, rock_stage: 22, root_bridge: 0, india_gate: 40, qutub: 40, cp_circle: 110,
  red_fort: 0, cyber_hub: 55, toll: 0, cranes: 35, morungs: 55, cemetery: 40, hornbill_statue: 8, monastery: 50, buddha: 18,
  high_bridge: 0, post_office: 14,
};

export function buildLandmark(ctx, L) {
  const fn = LB[L.kind];
  if (!fn) { console.warn('no landmark', L.kind); return; }
  fn(ctx, L);
}

const LB = {
  vidhana_soudha(ctx, L) {
    const w = 64, d = 22;
    const F = shell(ctx, { cx: L.x, cz: L.z, w, d, rot: 0, floors: 3, H: 4.2, wallMat: 'whitestone', wallCol: col('#ece6da'), trimCol: col('#ffffff'), roof: 'flat', winV0: 1.0, winV1: 3.2, winW: 1.3, lootTier: 2, grills: false, tank: false, dish: false, plinth: 1.2 });
    const b = F.base, top = b + 3 * 4.2;
    // portico
    for (let i = 0; i < 8; i++) {
      const x = L.x - 12 + i * (24 / 7);
      cyl(ctx, x, b, L.z + d / 2 + 7, 0.6, 0.7, 12.6, 'whitestone', col('#f2ede3'), 16);
    }
    BX(ctx, L.x - 14, top, L.z + d / 2, L.x + 14, top + 1.8, L.z + d / 2 + 8, 'whitestone', col('#e9e3d6'));
    const ped = new THREE.Shape(); ped.moveTo(-14, 0); ped.lineTo(14, 0); ped.lineTo(0, 4.5); ped.lineTo(-14, 0);
    G(ctx, new THREE.ExtrudeGeometry(ped, { depth: 1.2, bevelEnabled: false }), 'whitestone', col('#efe9dc'), L.x, top + 1.8, L.z + d / 2 + 6.8);
    BX(ctx, L.x - 15, b - 1.2, L.z + d / 2, L.x + 15, b, L.z + d / 2 + 9, 'whitestone', col('#d9d2c4'));
    for (let i = 0; i < 6; i++) BX(ctx, L.x - 15, b - 1.2, L.z + d / 2 + 9 + i * 0.5, L.x + 15, b - 0.2 * (i + 1), L.z + d / 2 + 9.5 + i * 0.5, 'whitestone', col('#d0c9bb'));
    // central dome + corner domes
    cyl(ctx, L.x, top, L.z, 6, 6, 4.2, 'whitestone', col('#eee8dc'), 24);
    dome(ctx, L.x, top + 4.2, L.z, 6.4, 'whitestone', col('#f4efe6'), 1.1);
    G(ctx, new THREE.ConeGeometry(0.5, 3, 10), 'gold', col('#d4af37'), L.x, top + 12, L.z);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const x = L.x + sx * (w / 2 - 3), z = L.z + sz * (d / 2 - 3);
      cyl(ctx, x, top, z, 2, 2, 2.5, 'whitestone', col('#eee8dc'), 16);
      dome(ctx, x, top + 2.5, z, 2.3, 'whitestone', col('#f4efe6'), 1.1);
    }
    board(ctx, L.x, top + 0.9, L.z + d / 2 + 8.05, 0, 12, 1.2, ['GOVERNMENT WORK IS GOD\'S WORK'], { bg: '#e9e3d6', color: '#5d4a2a', sizes: [0.62], glowI: 0.05, noBack: true });
    addEgg(ctx, L.egg, L.x, L.z + d / 2 + 10);
  },

  metro(ctx, L) {
    const pts = L.pts, rng = ctx.rng;
    const hDeck = 10.5;
    let maxH = -Infinity;
    for (let i = 0; i < pts.length - 1; i++) for (let t = 0; t <= 1; t += 0.05) maxH = Math.max(maxH, H(ctx, pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t));
    const y = maxH + hDeck;
    const livery = L.color || '#8e44ad';
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const alongX = Math.abs(bx - ax) > Math.abs(bz - az);
      const len = Math.hypot(bx - ax, bz - az);
      const hw = 4.5;
      if (alongX) {
        BX(ctx, Math.min(ax, bx), y - 1.2, az - hw, Math.max(ax, bx), y, az + hw, 'concrete', col('#b7b3aa'));
        BX(ctx, Math.min(ax, bx), y, az - hw, Math.max(ax, bx), y + 1.1, az - hw + 0.25, 'concrete', col('#c9c4ba'));
        BX(ctx, Math.min(ax, bx), y, az + hw - 0.25, Math.max(ax, bx), y + 1.1, az + hw, 'concrete', col('#c9c4ba'));
        for (const o of [-2.2, -0.8, 0.8, 2.2]) BX(ctx, Math.min(ax, bx), y, az + o - 0.05, Math.max(ax, bx), y + 0.15, az + o + 0.05, 'metal', col('#777'), SURF.metal, false);
      } else {
        BX(ctx, ax - hw, y - 1.2, Math.min(az, bz), ax + hw, y, Math.max(az, bz), 'concrete', col('#b7b3aa'));
        BX(ctx, ax - hw, y, Math.min(az, bz), ax - hw + 0.25, y + 1.1, Math.max(az, bz), 'concrete', col('#c9c4ba'));
        BX(ctx, ax + hw - 0.25, y, Math.min(az, bz), ax + hw, y + 1.1, Math.max(az, bz), 'concrete', col('#c9c4ba'));
        for (const o of [-2.2, -0.8, 0.8, 2.2]) BX(ctx, ax + o - 0.05, y, Math.min(az, bz), ax + o + 0.05, y + 0.15, Math.max(az, bz), 'metal', col('#777'), SURF.metal, false);
      }
      const n = Math.floor(len / 32);
      for (let k = 0; k <= n; k++) {
        const t = k / Math.max(1, n);
        const px = ax + (bx - ax) * t, pz = az + (bz - az) * t;
        const g = H(ctx, px, pz);
        BX(ctx, px - 0.9, g - 0.5, pz - 0.9, px + 0.9, y - 1.2, pz + 0.9, 'concrete', col('#aca79d'));
        if (alongX) BX(ctx, px - 1.2, y - 2.4, pz - 3.6, px + 1.2, y - 1.2, pz + 3.6, 'concrete', col('#aca79d'));
        else BX(ctx, px - 3.6, y - 2.4, pz - 1.2, px + 3.6, y - 1.2, pz + 1.2, 'concrete', col('#aca79d'));
      }
      // a parked train on this segment
      if (i === 0) {
        const t0 = 0.3 + rng() * 0.3;
        for (let c = 0; c < 3; c++) {
          const cx = ax + (bx - ax) * t0 + (alongX ? c * 21 : 0), cz = az + (bz - az) * t0 + (alongX ? 0 : c * 21);
          const off = 1.5;
          const [x0, z0, x1, z1] = alongX ? [cx - 10, cz - off - 1.45, cx + 10, cz - off + 1.45] : [cx - off - 1.45, cz - 10, cx - off + 1.45, cz + 10];
          BX(ctx, x0, y + 0.3, z0, x1, y + 3.9, z1, 'paint', col('#e8e8e8'), SURF.metal);
          const e = 0.02;
          ctx.geo.box(x0 - e, y + 1.7, z0 - e, x1 + e, y + 2.6, z1 + e, 'lamp', col(ctx.night ? '#cfe8ff' : '#26323a'));
          ctx.geo.box(x0 - e * 2, y + 0.9, z0 - e * 2, x1 + e * 2, y + 1.25, z1 + e * 2, 'paint', col(livery));
        }
      }
    }
    // station with stairs at eggAt
    if (L.eggAt) {
      const [sx, sz] = L.eggAt;
      const along = Math.abs(pts[1][0] - pts[0][0]) > Math.abs(pts[1][1] - pts[0][1]);
      const g = H(ctx, sx, sz);
      if (along) {
        BX(ctx, sx - 30, y - 1.2, sz - 9, sx + 30, y, sz + 9, 'pavers', WHITE);
        for (const zz of [sz - 9, sz + 9]) BX(ctx, sx - 30, y + 5.2, zz - 0.2, sx + 30, y + 5.5, zz + 0.2, 'metal', col('#555'), SURF.metal);
        BX(ctx, sx - 30, y + 5.5, sz - 9.5, sx + 30, y + 5.8, sz + 9.5, 'tin', col('#9aa3aa'), SURF.metal);
        for (let k = -2; k <= 2; k++) for (const zz of [-8.5, 8.5]) cyl(ctx, sx + k * 13, y, sz + zz, 0.2, 0.2, 5.5, 'metal', col('#666'), 8);
        // stairs down on the +z side
        const n = Math.ceil((y - g) / 0.22);
        for (let s = 0; s < n; s++) BX(ctx, sx - 1.6, g - 0.3, sz + 9 + s * 0.32, sx + 1.6, y - s * ((y - g) / n), sz + 9 + (s + 1) * 0.32, 'concrete', col('#bdb7ad'));
      } else {
        BX(ctx, sx - 9, y - 1.2, sz - 30, sx + 9, y, sz + 30, 'pavers', WHITE);
        BX(ctx, sx - 9.5, y + 5.5, sz - 30, sx + 9.5, y + 5.8, sz + 30, 'tin', col('#9aa3aa'), SURF.metal);
        for (let k = -2; k <= 2; k++) for (const xx of [-8.5, 8.5]) cyl(ctx, sx + xx, y, sz + k * 13, 0.2, 0.2, 5.5, 'metal', col('#666'), 8);
        const n = Math.ceil((y - g) / 0.22);
        for (let s = 0; s < n; s++) BX(ctx, sx + 9 + s * 0.32, g - 0.3, sz - 1.6, sx + 9 + (s + 1) * 0.32, y - s * ((y - g) / n), sz + 1.6, 'concrete', col('#bdb7ad'));
      }
      board(ctx, sx + (along ? 0 : 9.6), y + 4.2, sz + (along ? 9.6 : 0), along ? 0 : PI / 2, 10, 1.4, [L.name || 'METRO'], { bg: livery, color: '#ffffff', sizes: [0.7], glowI: 0.9 });
      for (let k = 0; k < 4; k++) ctx.loot.push({ x: sx + (along ? -20 + k * 12 : 0), y: y + 0.05, z: sz + (along ? 0 : -20 + k * 12), tier: 1 });
      addEgg(ctx, L.egg || { id: 'metro_' + ctx.map.id, title: L.name || 'Metro', text: 'Elevated, air-conditioned, always on time. A sniper\'s dream.', r: 14 }, sx, sz, y);
    }
  },

  flyover_jam(ctx, L) {
    const len = L.len || 150, y = H(ctx, L.x, L.z) + 7.5, hw = 5.5;
    const x0 = L.x - len / 2, x1 = L.x + len / 2;
    BX(ctx, x0, y - 1, L.z - hw, x1, y, L.z + hw, 'asphalt', WHITE);
    BX(ctx, x0, y, L.z - hw, x1, y + 1, L.z - hw + 0.3, 'concrete', col('#c9c4ba'));
    BX(ctx, x0, y, L.z + hw - 0.3, x1, y + 1, L.z + hw, 'concrete', col('#c9c4ba'));
    for (let x = x0 + 10; x < x1; x += 22) BX(ctx, x - 1, H(ctx, x, L.z) - 0.5, L.z - 1.4, x + 1, y - 1, L.z + 1.4, 'concrete', col('#aca79d'));
    // ramps
    for (const side of [-1, 1]) {
      const n = 36;
      for (let i = 0; i < n; i++) {
        const xs = side < 0 ? x0 - (i + 1) * 1.1 : x1 + i * 1.1;
        const yy = y - (i + 1) * (7.5 / n);
        BX(ctx, xs, H(ctx, xs, L.z) - 0.6, L.z - hw, xs + 1.1, yy, L.z + hw, 'asphalt', WHITE);
      }
    }
    // the jam: ground lanes both sides + on the flyover
    vehicleRow(ctx, L.x, L.z - 12, len * 1.3, 'x', undefined, 0.8, 2, 3.3);
    vehicleRow(ctx, L.x, L.z + 12, len * 1.3, 'x', undefined, 0.8, 2, 3.3, true);
    const saved = ctx.phys.height.bind(ctx.phys);
    // vehicles up on the deck
    const rng = ctx.rng;
    let s = x0 + 6;
    while (s < x1 - 6) { const v = randomVehicle(rng, ['car', 'car', 'bus', 'auto']); modelAt(ctx, v.g, s + v.len / 2, y, L.z + (rng() < 0.5 ? -2 : 2), PI / 2, true, 0.8); s += v.len + 1.5; }
    // signal + traffic cop
    cyl(ctx, L.x + 20, H(ctx, L.x + 20, L.z - 20), L.z - 20, 0.1, 0.1, 5.5, 'metal', col('#333'), 8);
    BX(ctx, L.x + 19.7, H(ctx, L.x + 20, L.z - 20) + 5, L.z - 20.3, L.x + 20.3, H(ctx, L.x + 20, L.z - 20) + 6.2, L.z - 19.7, 'metal', col('#111'), SURF.metal, false);
    ctx.geo.box(L.x + 19.8, H(ctx, L.x + 20, L.z - 20) + 5.9, L.z - 19.68, L.x + 20.2, H(ctx, L.x + 20, L.z - 20) + 6.1, L.z - 19.6, 'lamp', col('#ff1744'));
    modelAt(ctx, figure({ shirt: '#f5f5f5', pants: '#f5f5f5', cap: '#f5f5f5', pose: 'dance' }), L.x + 5, H(ctx, L.x + 5, L.z), L.z, 0, true, 0.5);
    board(ctx, L.x, y + 3.5, L.z - hw - 0.2, PI, 16, 2.4, ['SILK BOARD JUNCTION', 'Welcome · Est. wait 2 business days'], { bg: '#0d4d2b', color: '#ffffff', color2: '#d6f5e0', sizes: [0.42, 0.26] });
    cyl(ctx, L.x - 8, y, L.z - hw - 0.2, 0.15, 0.15, 3, 'metal', col('#555'), 8, false);
    cyl(ctx, L.x + 8, y, L.z - hw - 0.2, 0.15, 0.15, 3, 'metal', col('#555'), 8, false);
    addEgg(ctx, L.egg, L.x, L.z);
    ctx.slowZones.push({ x: L.x, z: L.z, r: 90, k: 0.25 });
  },

  fishing_nets(ctx, L) {
    const n = L.n || 4;
    const netTex = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 256;
      const g = c.getContext('2d'); g.strokeStyle = 'rgba(40,30,20,0.9)'; g.lineWidth = 2;
      for (let i = 0; i <= 256; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(256, i); g.stroke(); }
      const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(4, 4); return t;
    })();
    const netMat = new THREE.MeshStandardMaterial({ map: netTex, transparent: true, alphaTest: 0.2, side: THREE.DoubleSide, roughness: 1 });
    for (let i = 0; i < n; i++) {
      const px = L.x, pz = L.z + (i - (n - 1) / 2) * 24;
      const g = Math.max(H(ctx, px, pz), 0.3);
      BX(ctx, px - 2, g - 1.5, pz - 2.5, px + 3, g + 0.5, pz + 2.5, 'wood', col('#6d5037'), SURF.wood);
      // cantilever frame leaning out over the sea (-x)
      const pivot = new THREE.Vector3(px - 1.5, g + 0.6, pz);
      const tip = new THREE.Vector3(px - 15, g + 9, pz);
      for (const o of [-2.2, 2.2]) {
        const a = pivot.clone().add(new THREE.Vector3(0, 0, o * 0.3)), b = tip.clone().add(new THREE.Vector3(0, 0, o));
        const len = a.distanceTo(b), mid = a.clone().add(b).multiplyScalar(0.5);
        const m = new THREE.Matrix4().lookAt(a, b, new THREE.Vector3(0, 1, 0));
        m.multiply(new THREE.Matrix4().makeRotationX(PI / 2));
        m.setPosition(mid);
        ctx.geo.geom(new THREE.CylinderGeometry(0.1, 0.16, len, 8), m, 'wood', col('#5d4431'));
      }
      // counter-beam behind with stones
      const back = new THREE.Vector3(px + 6, g + 4, pz);
      {
        const a = pivot, b = back, len = a.distanceTo(b), mid = a.clone().add(b).multiplyScalar(0.5);
        const m = new THREE.Matrix4().lookAt(a, b, new THREE.Vector3(0, 1, 0)); m.multiply(new THREE.Matrix4().makeRotationX(PI / 2)); m.setPosition(mid);
        ctx.geo.geom(new THREE.CylinderGeometry(0.08, 0.12, len, 8), m, 'wood', col('#5d4431'));
      }
      for (let k = 0; k < 5; k++) BX(ctx, px + 5.6 - k * 0.35, g + 1.5 - k * 0.2, pz - 0.25, px + 6.1 - k * 0.35, g + 2.0 - k * 0.2, pz + 0.25, 'whitestone', col('#8d8575'), SURF.concrete, false);
      // net
      const ng = new THREE.PlaneGeometry(10, 10, 8, 8);
      const p = ng.attributes.position;
      for (let k = 0; k < p.count; k++) { const x = p.getX(k), y = p.getY(k); p.setZ(k, -Math.cos((x / 10) * PI) * Math.cos((y / 10) * PI) * 2.5); }
      ng.computeVertexNormals();
      const net = new THREE.Mesh(ng, netMat);
      net.rotation.x = -PI / 2;
      net.position.set(tip.x - 1, g + 2.6, pz);
      // ropes from the frame tips down to the net corners
      const rp = [];
      for (const [cx, cz] of [[-5, -5], [5, -5], [-5, 5], [5, 5]]) rp.push(tip.x, tip.y, pz + cz * 0.4, tip.x - 1 + cx, g + 2.6, pz + cz);
      const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
      ctx.group.add(new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0x2a2018 })));
      ctx.group.add(net);
    }
    addEgg(ctx, L.egg, L.x, L.z);
  },

  mall(ctx, L) {
    const w = 56, d = 36;
    const F = shell(ctx, { cx: L.x, cz: L.z, w, d, rot: L.rot || 0, floors: 2, H: 5.5, wallMat: 'concrete', wallCol: col('#e4e7ea'), floorMat: 'terrazzo', roof: 'flat', winW: 4.2, winV0: 0.3, winV1: 4.8, chajja: false, lootTier: 1, dish: false });
    const b = F.base;
    const [fx, fz] = F.w(0, d / 2 + 0.3);
    board(ctx, fx, b + 12.4, fz, rotY(L.rot), 26, 3, [L.name || 'MEGA MALL'], { bg: '#0b0f16', color: '#2de2e6', glow: true, sizes: [0.72], glowI: 1.6, frame: '#111' });
    // neon edges
    const [x0, z0, x1, z1] = F.aabb(-w / 2, -d / 2, w / 2, d / 2);
    neon(ctx, x0 - 0.1, b + 11.1, z1, x1 + 0.1, b + 11.35, z1 + 0.1, '#ff3f8e');
    neon(ctx, x0 - 0.1, b + 11.1, z0 - 0.1, x1 + 0.1, b + 11.35, z0, '#ff3f8e');
    // parking with cars
    const [px, pz] = F.w(0, d / 2 + 16);
    ctx.geo.box(px - 28, H(ctx, px, pz) + 0.02, pz - 9, px + 28, H(ctx, px, pz) + 0.06, pz + 9, 'asphalt', WHITE);
    for (let i = 0; i < 10; i++) if (ctx.rng() < 0.7) { const v = randomVehicle(ctx.rng, ['car', 'suv']); const cx = px - 25 + i * 5.5; modelAt(ctx, v.g, cx, H(ctx, cx, pz - 4), pz - 4, 0, true, 0.8); }
    addEgg(ctx, L.egg, fx, fz + 6);
  },

  houseboat(ctx, L) {
    const lvl = ctx.phys.waterLevel(L.x, L.z);
    const y = (lvl > -1e9 ? lvl : H(ctx, L.x, L.z)) - 0.5;
    const ry = rotY(L.rot);
    const hb = houseboat();
    mergeGroup(ctx.geo, hb, M4(L.x, y, L.z, ry));
    const along = (L.rot || 0) % 2 === 1;
    const hx = along ? 11 : 2, hz = along ? 2 : 11;
    ctx.phys.addBox(L.x - hx, y, L.z - hz, L.x + hx, y + 1.1, L.z + hz, SURF.wood);
    const rx = along ? 7.5 : 2.1, rz = along ? 2.1 : 7.5;
    ctx.phys.addBox(L.x - rx, y + 3.2, L.z - rz, L.x + rx, y + 3.5, L.z + rz, SURF.wood);
    ctx.loot.push({ x: L.x, y: y + 1.15, z: L.z, tier: 1 }, { x: L.x + (along ? 4 : 0), y: y + 1.15, z: L.z + (along ? 0 : 4), tier: 1 });
    addEgg(ctx, L.egg, L.x, L.z, y + 1.2);
  },

  church(ctx, L) {
    const w = 14, d = 28, Hh = L.tall ? 11 : 9;
    const F = shell(ctx, { cx: L.x, cz: L.z, w, d, rot: L.rot || 0, floors: 1, H: Hh, wallMat: 'plaster', wallCol: col(L.color || '#f4f1ea'), trimCol: col('#ffffff'), roof: 'none', winW: 1.2, winV0: 2.6, winV1: Hh - 1.5, chajja: false, grills: false, lootTier: 1, tank: false, dish: false });
    const b = F.base, top = b + Hh;
    // gable roof along the nave
    const rh = 4.5, o = 0.6;
    F.quad([[w / 2 + o, top - 0.2, d / 2 + o], [w / 2 + o, top - 0.2, -d / 2 - o], [0, top + rh, -d / 2 - o], [0, top + rh, d / 2 + o]], 'rooftile', col('#8f3a28'));
    F.quad([[-w / 2 - o, top - 0.2, -d / 2 - o], [-w / 2 - o, top - 0.2, d / 2 + o], [0, top + rh, d / 2 + o], [0, top + rh, -d / 2 - o]], 'rooftile', col('#8f3a28'));
    F.tri([[-w / 2, top, d / 2], [w / 2, top, d / 2], [0, top + rh, d / 2]], 'plaster', col(L.color || '#f4f1ea'));
    F.tri([[w / 2, top, -d / 2], [-w / 2, top, -d / 2], [0, top + rh, -d / 2]], 'plaster', col(L.color || '#f4f1ea'));
    F.box(-w / 2, top, -d / 2, w / 2, top + 0.3, d / 2, 'wood', col('#5d4431'), SURF.wood, true, 'tzZxX');
    // towers
    const spires = L.spires || 1;
    const th = L.tall ? 30 : 18;
    const towers = spires === 1 ? [0] : spires === 2 ? [-w / 2 + 2, w / 2 - 2] : [0, -w / 2 - 1, w / 2 + 1];
    towers.forEach((tx, i) => {
      const main = spires !== 2 && i === 0;
      const s = main ? 5 : 3.6, hh = main ? th : th * 0.72;
      F.box(tx - s / 2, b, d / 2 - 1, tx + s / 2, b + hh, d / 2 - 1 + s, 'plaster', col(L.color || '#f4f1ea'));
      F.box(tx - s / 2 - 0.2, b + hh, d / 2 - 1.2, tx + s / 2 + 0.2, b + hh + 0.5, d / 2 - 0.8 + s, 'plaster', col('#ffffff'));
      F.place(new THREE.ConeGeometry(s * 0.72, hh * 0.45, 4), tx, b + hh + 0.5 + hh * 0.225, d / 2 - 1 + s / 2, PI / 4, 'plaster', col(L.spireColor || '#e8e4dc'));
      const cy = b + hh + 0.5 + hh * 0.45;
      F.box(tx - 0.08, cy, d / 2 - 1 + s / 2 - 0.08, tx + 0.08, cy + 2.2, d / 2 - 1 + s / 2 + 0.08, 'gold', col('#d4af37'), SURF.metal, false);
      F.box(tx - 0.6, cy + 1.3, d / 2 - 1 + s / 2 - 0.08, tx + 0.6, cy + 1.46, d / 2 - 1 + s / 2 + 0.08, 'gold', col('#d4af37'), SURF.metal, false);
      if (main || i === 0) {
        const [cx, cz] = F.w(tx, d / 2 - 1 + s + 0.8);
        const [tx2, tz2] = F.w(tx, d / 2 - 1 + s / 2);
        ctx.climbs.push({ x: cx, z: cz, y: b, r: 3, top: [tx2, b + hh + 0.55, tz2], name: 'bell tower' });
        F.box(tx - s / 2, b + hh - 0.1, d / 2 - 1, tx + s / 2, b + hh + 0.5, d / 2 - 1 + s, 'plaster', col('#fff'), SURF.concrete, true);
      }
    });
    const [ex, ez] = F.w(0, d / 2 + 4);
    addEgg(ctx, L.egg, ex, ez);
  },

  rainbow_bridge(ctx, L) {
    const cols = ['#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5', '#3949ab', '#8e24aa'];
    const g0 = H(ctx, L.x, L.z);
    for (let i = 0; i < cols.length; i++) {
      const t = new THREE.TorusGeometry(10 - i * 0.35, 0.18, 8, 40, PI);
      const c = col(cols[i]);
      G(ctx, t, ctx.night ? 'neon' : 'paint', ctx.night ? [c[0] * 2.2, c[1] * 2.2, c[2] * 2.2] : c, L.x, g0, L.z, PI / 2);
    }
    // promenade along the water (north-south)
    ctx.geo.box(L.x - 4, g0 + 0.02, L.z - 60, L.x + 4, g0 + 0.25, L.z + 60, 'pavers', WHITE);
    ctx.phys.addBox(L.x - 4, g0 - 1, L.z - 60, L.x + 4, g0 + 0.25, L.z + 60, SURF.concrete);
    for (let k = -50; k <= 50; k += 16) {
      cyl(ctx, L.x - 3.6, g0 + 0.25, L.z + k, 0.08, 0.08, 4.5, 'metal', col('#333'), 6);
      ctx.geo.box(L.x - 3.9, g0 + 4.6, L.z + k - 0.2, L.x - 3.3, g0 + 4.8, L.z + k + 0.2, 'lamp', col('#fff3c4'));
      BX(ctx, L.x + 2.2, g0 + 0.25, L.z + k + 5, L.x + 3.2, g0 + 0.7, L.z + k + 7, 'wood', col('#6d4c41'), SURF.wood);
    }
    addEgg(ctx, L.egg, L.x, L.z);
  },

  lighthouse(ctx, L) {
    const g0 = H(ctx, L.x, L.z), h = L.h || 40;
    const bands = 6;
    for (let i = 0; i < bands; i++) {
      const r0 = 3.2 - (1.0 * i) / bands, r1 = 3.2 - (1.0 * (i + 1)) / bands;
      G(ctx, new THREE.CylinderGeometry(r1, r0, h / bands, 24), 'plaster', col(L.stripes[i % 2]), L.x, g0 + (i + 0.5) * (h / bands), L.z);
    }
    ctx.phys.addBox(L.x - 2.1, g0, L.z - 2.1, L.x + 2.1, g0 + h, L.z + 2.1, SURF.concrete);
    const gy = g0 + h;
    G(ctx, new THREE.CylinderGeometry(3.6, 3.6, 0.35, 24), 'concrete', col('#666'), L.x, gy + 0.17, L.z);
    for (const [a, b2, c, d2] of [[-3.6, -3.6, 3.6, -1.2], [-3.6, 1.2, 3.6, 3.6], [-3.6, -1.2, -1.2, 1.2], [1.2, -1.2, 3.6, 1.2]]) ctx.phys.addBox(L.x + a, gy, L.z + b2, L.x + c, gy + 0.35, L.z + d2, SURF.concrete);
    for (let k = 0; k < 24; k++) { const a = (k / 24) * PI * 2; G(ctx, new THREE.CylinderGeometry(0.03, 0.03, 1.1, 5), 'metal', col('#222'), L.x + Math.cos(a) * 3.5, gy + 0.9, L.z + Math.sin(a) * 3.5); }
    G(ctx, new THREE.TorusGeometry(3.5, 0.04, 5, 32), 'metal', col('#222'), L.x, gy + 1.45, L.z, 0, null, PI / 2);
    G(ctx, new THREE.CylinderGeometry(1.6, 1.6, 2.6, 16), 'glassDark', col('#aac'), L.x, gy + 1.65, L.z);
    ctx.phys.addBox(L.x - 1.3, gy, L.z - 1.3, L.x + 1.3, gy + 3, L.z + 1.3, SURF.glass);
    G(ctx, new THREE.SphereGeometry(0.7, 12, 8), 'lamp', col('#fff4c2'), L.x, gy + 1.7, L.z);
    G(ctx, new THREE.SphereGeometry(1.7, 16, 8, 0, PI * 2, 0, PI / 2), 'paint', col(L.stripes[1]), L.x, gy + 2.95, L.z);
    // rotating beam
    const beamMat = new THREE.MeshBasicMaterial({ color: 0xfff1c0, transparent: true, opacity: ctx.night ? 0.16 : 0.05, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const beam = new THREE.Mesh(new THREE.ConeGeometry(6, 80, 16, 1, true), beamMat);
    beam.geometry.translate(0, -40, 0); beam.geometry.rotateZ(PI / 2);
    const pivot = new THREE.Object3D(); pivot.position.set(L.x, gy + 1.7, L.z); pivot.add(beam); ctx.group.add(pivot);
    ctx.animated.push((t) => { pivot.rotation.y = t * 0.6; });
    BX(ctx, L.x + 2.6, g0, L.z - 0.7, L.x + 3.4, g0 + 2.2, L.z + 0.7, 'wood', col('#5d4431'), SURF.wood, false);
    ctx.climbs.push({ x: L.x + 3.8, z: L.z, y: g0, r: 3, top: [L.x + 2.8, gy + 0.4, L.z], name: 'lighthouse' });
    ctx.loot.push({ x: L.x - 2.8, y: gy + 0.4, z: L.z, tier: 2 });
    addEgg(ctx, L.egg, L.x, L.z);
  },

  central_station(ctx, L) {
    const w = 80, d = 18, Hh = 5;
    const F = shell(ctx, { cx: L.x, cz: L.z, w, d, rot: L.rot || 0, floors: 2, H: Hh, wallMat: 'plaster', wallCol: col('#b04a32'), trimCol: col('#f4efe6'), roof: 'flat', winW: 1.3, winV0: 1.0, winV1: 3.8, lootTier: 2, grills: false, tank: false, dish: false });
    const b = F.base, top = b + 2 * Hh;
    // clock tower at the centre-front
    const s = 8, th = 42;
    F.box(-s / 2, b, d / 2 - 2, s / 2, b + th, d / 2 - 2 + s, 'plaster', col('#b04a32'));
    for (const [cx, cz] of [[-s / 2, d / 2 - 2], [s / 2, d / 2 - 2], [-s / 2, d / 2 - 2 + s], [s / 2, d / 2 - 2 + s]]) F.box(cx - 0.35, b, cz - 0.35, cx + 0.35, b + th + 0.5, cz + 0.35, 'plaster', col('#f4efe6'), SURF.concrete, false);
    F.place(new THREE.ConeGeometry(s * 0.72, 9, 4), 0, b + th + 4.5, d / 2 - 2 + s / 2, PI / 4, 'rooftile', col('#6d3a2a'));
    F.place(new THREE.ConeGeometry(0.4, 3, 8), 0, b + th + 10, d / 2 - 2 + s / 2, 0, 'gold', col('#d4af37'));
    const clk = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
      g.fillStyle = '#f5f0e0'; g.beginPath(); g.arc(128, 128, 120, 0, 7); g.fill(); g.strokeStyle = '#222'; g.lineWidth = 8; g.stroke();
      for (let i = 0; i < 12; i++) { const a = (i / 12) * PI * 2; g.fillStyle = '#222'; g.fillRect(128 + Math.cos(a) * 100 - 4, 128 + Math.sin(a) * 100 - 4, 8, 8); }
      g.lineWidth = 7; g.beginPath(); g.moveTo(128, 128); g.lineTo(128, 50); g.stroke(); g.lineWidth = 9; g.beginPath(); g.moveTo(128, 128); g.lineTo(185, 128); g.stroke();
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
    })();
    const cm = new THREE.MeshStandardMaterial({ map: clk, emissiveMap: clk, emissive: 0xffffff, emissiveIntensity: ctx.night ? 0.8 : 0.1, transparent: true, alphaTest: 0.5 });
    const cz0 = d / 2 - 2 + s / 2;
    for (let k = 0; k < 4; k++) {
      const a = k * PI / 2;
      const [wx, wz] = F.w(Math.sin(a) * (s / 2 + 0.05), cz0 + Math.cos(a) * (s / 2 + 0.05));
      const m = new THREE.Mesh(new THREE.CircleGeometry(2.6, 32), cm); m.position.set(wx, b + th - 5, wz); m.rotation.y = a + F.ang; ctx.group.add(m);
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const tx = sx * (w / 2 - 2), tz = sz * (d / 2 - 2);
      F.box(tx - 2, top, tz - 2, tx + 2, top + 6, tz + 2, 'plaster', col('#b04a32'));
      const [wx, wz] = F.w(tx, tz);
      dome(ctx, wx, top + 6, wz, 2.2, 'plaster', col('#f4efe6'), 1.2);
    }
    const [cx, cz] = F.w(0, d / 2 - 2 + s + 1);
    const [tx2, tz2] = F.w(0, cz0);
    ctx.climbs.push({ x: cx, z: cz, y: b, r: 3, top: [tx2, b + th + 0.05, tz2], name: 'clock tower' });
    F.box(-s / 2 + 0.3, b + th - 0.3, d / 2 - 1.7, s / 2 - 0.3, b + th, d / 2 - 2.3 + s, 'concrete', col('#999'));
    board(ctx, ...(() => { const [x, z] = F.w(0, d / 2 + 0.05); return [x, b + Hh + 1.1, z]; })(), F.ang, 18, 1.6, ['CHENNAI CENTRAL'], { bg: '#f4efe6', color: '#8b1e1e', sizes: [0.7], glowI: 0.15, noBack: true });
    addEgg(ctx, L.egg, cx, cz + 4);
  },

  gopuram(ctx, L) {
    const g0 = H(ctx, L.x, L.z) + 0.3;
    const pal = L.kerala ? ['#b9b1a1', '#a79f8f', '#c4bcab', '#9e9686'] : ['#e53935', '#fdd835', '#43a047', '#1e88e5', '#8e24aa', '#fb8c00', '#00897b', '#f06292'];
    const mat = L.kerala ? 'whitestone' : 'plaster';
    const rng = ctx.rng;
    const W = 22, D = 14, bh = 9;
    // gateway block with a passage through (along z)
    BX(ctx, L.x - W / 2, g0 - 1, L.z - D / 2, L.x - 2.2, g0 + bh, L.z + D / 2, 'whitestone', col('#cfc6b3'));
    BX(ctx, L.x + 2.2, g0 - 1, L.z - D / 2, L.x + W / 2, g0 + bh, L.z + D / 2, 'whitestone', col('#cfc6b3'));
    BX(ctx, L.x - 2.2, g0 + 6.5, L.z - D / 2, L.x + 2.2, g0 + bh, L.z + D / 2, 'whitestone', col('#cfc6b3'));
    ctx.geo.box(L.x - 2.2, g0 - 0.02, L.z - D / 2, L.x + 2.2, g0, L.z + D / 2, 'whitestone', col('#bfb6a3'));
    ctx.phys.addBox(L.x - 2.2, g0 - 1, L.z - D / 2, L.x + 2.2, g0, L.z + D / 2, SURF.concrete);
    let y = g0 + bh, w = W - 1, d = D - 1.5;
    const tiers = L.tiers || 7, th = ((L.h || 36) - bh - 5) / tiers;
    for (let i = 0; i < tiers; i++) {
      const c = col(pal[i % pal.length], 0.05, rng);
      BX(ctx, L.x - w / 2 - 0.4, y, L.z - d / 2 - 0.4, L.x + w / 2 + 0.4, y + 0.45, L.z + d / 2 + 0.4, mat, col(L.kerala ? '#8f8778' : '#f5f0e6'));
      BX(ctx, L.x - w / 2, y + 0.45, L.z - d / 2, L.x + w / 2, y + th, L.z + d / 2, mat, c);
      // sculpted figures in niches along front/back
      const n = Math.max(3, Math.floor(w / 1.6));
      for (let k = 0; k < n; k++) {
        const x = L.x - w / 2 + 0.8 + (k * (w - 1.6)) / (n - 1);
        const fc = col(pal[(i + k) % pal.length], 0.1, rng);
        for (const sz of [-1, 1]) ctx.geo.box(x - 0.35, y + 0.8, L.z + sz * (d / 2) - 0.25, x + 0.35, y + th - 0.4, L.z + sz * (d / 2) + 0.25, mat, fc);
      }
      y += th; w *= 0.86; d *= 0.84;
    }
    // barrel vault crown with kalasam finials
    const vault = new THREE.CylinderGeometry(d / 2, d / 2, w, 16, 1, false, 0, PI);
    vault.rotateZ(PI / 2); vault.rotateX(PI / 2);
    G(ctx, vault, mat, col(L.kerala ? '#a8a090' : '#f9a825'), L.x, y, L.z, 0, null, 0, 0);
    ctx.phys.addBox(L.x - w / 2, y, L.z - d / 2, L.x + w / 2, y + d / 2, L.z + d / 2, SURF.concrete);
    for (let k = 0; k < 5; k++) G(ctx, new THREE.ConeGeometry(0.3, 1.6, 8), 'gold', col('#d4af37'), L.x - w / 2 + 0.6 + (k * (w - 1.2)) / 4, y + d / 2 + 0.6, L.z);
    ctx.loot.push({ x: L.x, y: g0, z: L.z, tier: 2 });
    addEgg(ctx, L.egg, L.x, L.z + D / 2 + 6);
  },

  tower(ctx, L) {
    const F = buildArchetype(ctx, 'tower', { cx: L.x, cz: L.z, w: L.w || 20, d: L.w || 20, rot: 0, h: L.h || 60, style: 'conc' });
    const b = ctx.buildings[ctx.buildings.length - 1];
    if (L.name) board(ctx, L.x, b.top + 2.5, L.z + (L.w || 20) / 2 + 0.2, 0, 10, 3, [L.name], { bg: '#0b0f16', color: '#ffb000', glow: true, sizes: [0.8], glowI: 1.4 });
    addEgg(ctx, L.egg, L.x, L.z + (L.w || 20) / 2 + 5);
  },

  stadium(ctx, L) {
    const small = L.small;
    const FW = small ? 70 : 120, FD = small ? 46 : 110;
    const g0 = H(ctx, L.x, L.z);
    const seat = col(small ? '#1565c0' : '#fdd835');
    const tiers = small ? 4 : 7;
    const sides = [[0, -1], [0, 1], [-1, 0], [1, 0]];
    for (const [sx, sz] of sides) {
      for (let t = 0; t < tiers; t++) {
        const off = t * 1.3, yy = g0 + t * 0.9 + 0.9;
        if (sz) { const z = L.z + sz * (FD / 2 + 3 + off); BX(ctx, L.x - FW / 2 + 6, g0 - 0.5, z - 0.65, L.x + FW / 2 - 6, yy, z + 0.65, 'concrete', t % 2 ? seat : col('#b8b2a8')); }
        else { const x = L.x + sx * (FW / 2 + 3 + off); BX(ctx, x - 0.65, g0 - 0.5, L.z - FD / 2 + 6, x + 0.65, yy, L.z + FD / 2 - 6, 'concrete', t % 2 ? seat : col('#b8b2a8')); }
      }
    }
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const x = L.x + sx * (FW / 2 + 10), z = L.z + sz * (FD / 2 + 10);
      cyl(ctx, x, g0, z, 0.5, 0.7, small ? 25 : 42, 'metal', col('#888'), 8);
      ctx.geo.box(x - 2.5, g0 + (small ? 25 : 42), z - 0.4, x + 2.5, g0 + (small ? 27 : 45), z + 0.4, 'lamp', col('#f5fbff'));
    }
    if (!small) {
      ctx.geo.box(L.x - 1.5, g0 + 0.03, L.z - 11, L.x + 1.5, g0 + 0.06, L.z + 11, 'redDirt', col('#c9a27a'));
      board(ctx, L.x, g0 + 14, L.z - FD / 2 - 14, 0, 22, 7, ['WHISTLE PODU!', 'Yellow jersey mandatory'], { bg: '#fdd835', color: '#0d47a1', color2: '#1a237e', sizes: [0.42, 0.2], glowI: 0.5 });
      cyl(ctx, L.x - 9, g0, L.z - FD / 2 - 14.2, 0.3, 0.3, 10.5, 'metal', col('#555'), 8);
      cyl(ctx, L.x + 9, g0, L.z - FD / 2 - 14.2, 0.3, 0.3, 10.5, 'metal', col('#555'), 8);
    } else {
      for (const sz of [-1, 1]) {
        const z = L.z + sz * (FD / 2 - 1);
        BX(ctx, L.x - 3.7, g0, z - 0.06, L.x - 3.5, g0 + 2.44, z + 0.06, 'paint', col('#fff'), SURF.metal);
        BX(ctx, L.x + 3.5, g0, z - 0.06, L.x + 3.7, g0 + 2.44, z + 0.06, 'paint', col('#fff'), SURF.metal);
        BX(ctx, L.x - 3.7, g0 + 2.34, z - 0.06, L.x + 3.7, g0 + 2.46, z + 0.06, 'paint', col('#fff'), SURF.metal);
      }
    }
    for (let k = 0; k < 6; k++) ctx.loot.push({ x: L.x + (ctx.rng() - 0.5) * FW * 0.8, y: g0 + 0.05, z: L.z + (ctx.rng() - 0.5) * FD * 0.8, tier: 1 });
    addEgg(ctx, L.egg, L.x, L.z);
  },

  secretariat(ctx, L) {
    const w = 88, d = 20, Hh = 5;
    const F = shell(ctx, { cx: L.x, cz: L.z, w, d, rot: L.rot || 0, floors: 2, H: Hh, wallMat: 'plaster', wallCol: col('#f4f1e8'), trimCol: col('#d8cfbd'), roof: 'flat', winV0: 0.8, winV1: 3.8, winW: 1.3, lootTier: 2, grills: false, tank: false, dish: false });
    const b = F.base, top = b + 2 * Hh;
    for (let i = 0; i < 8; i++) { const x = -10.5 + i * 3; const [wx, wz] = F.w(x, d / 2 + 5); cyl(ctx, wx, b, wz, 0.55, 0.6, 2 * Hh, 'plaster', col('#faf8f2'), 14); }
    F.box(-12, top, d / 2, 12, top + 1.6, d / 2 + 6, 'plaster', col('#f1ede3'));
    const [dx, dz] = F.w(0, 0);
    cyl(ctx, dx, top, dz, 5, 5, 3.5, 'plaster', col('#f1ede3'), 24);
    dome(ctx, dx, top + 3.5, dz, 5.3, 'plaster', col('#faf8f2'), 1.1);
    // protest tents (shamiana) in front
    const tentCols = ['#e53935', '#1e88e5', '#43a047', '#fdd835'];
    for (let i = 0; i < 3; i++) {
      const [tx, tz] = F.w(-24 + i * 24, d / 2 + 24);
      const g = H(ctx, tx, tz);
      for (const [a, c2] of [[-4, -3], [4, -3], [-4, 3], [4, 3]]) cyl(ctx, tx + a, g, tz + c2, 0.06, 0.06, 3.2, 'metal', col('#777'), 6, false);
      for (let s = 0; s < 6; s++) ctx.geo.box(tx - 4.3 + s * 1.43, g + 3.2, tz - 3.3, tx - 4.3 + (s + 1) * 1.43, g + 3.35, tz + 3.3, 'cloth' in MM ? 'cloth' : 'plaster', col(s % 2 ? '#ffffff' : tentCols[i]));
      for (let r = 0; r < 3; r++) for (let c2 = 0; c2 < 5; c2++) ctx.geo.box(tx - 3 + c2 * 1.4, g, tz - 1.5 + r * 1.3, tx - 2.5 + c2 * 1.4, g + 0.45, tz - 1.0 + r * 1.3, 'plastic', col('#e53935'));
      board(ctx, tx, g + 2.7, tz - 3.35, PI, 7.5, 1, ['OUR DEMANDS: YES'], { bg: '#ffffff', color: '#b71c1c', sizes: [0.7], glowI: 0.1, noBack: true });
    }
    const [ex, ez] = F.w(0, d / 2 + 12);
    addEgg(ctx, L.egg, ex, ez);
  },

  napier(ctx, L) {
    const w = 36, d = 18;
    const F = shell(ctx, { cx: L.x, cz: L.z, w, d, rot: L.rot || 0, floors: 1, H: 6, wallMat: 'brick', wallCol: WHITE, trimCol: col('#f2e6c9'), roof: 'hip', roofMat: 'rooftile', roofCol: col('#7d2f22'), winV0: 1.0, winV1: 4.5, winW: 1.4, lootTier: 2, grills: false, veranda: true });
    const b = F.base;
    for (let k = 0; k < 3; k++) {
      F.box(-w / 2 - 0.02, b + 1.5 + k * 1.6, d / 2 - 0.1, w / 2 + 0.02, b + 1.75 + k * 1.6, d / 2 + 0.03, 'plaster', col(k % 2 ? '#1a1a1a' : '#f2e6c9'), SURF.concrete, false);
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const [wx, wz] = F.w(sx * (w / 2 + 0.5), sz * (d / 2 + 0.5));
      cyl(ctx, wx, b - 0.3, wz, 1.4, 1.6, 9, 'brick', WHITE, 8);
      G(ctx, new THREE.ConeGeometry(2.2, 4.5, 8), 'rooftile', col('#7d2f22'), wx, b + 8.7 + 2.25, wz);
    }
    const [ex, ez] = F.w(0, d / 2 + 6);
    addEgg(ctx, L.egg, ex, ez);
  },

  port_cranes(ctx, L) {
    const g0 = Math.max(H(ctx, L.x, L.z), 0.5);
    BX(ctx, L.x - 70, g0 - 3, L.z - 25, L.x + 70, g0 + 0.6, L.z + 8, 'concrete', col('#a6a196'));
    const rng = ctx.rng;
    for (let i = 0; i < 3; i++) {
      const cx = L.x - 40 + i * 40, c = col(i % 2 ? '#c62828' : '#eceff1');
      for (const [a, bz] of [[-8, -6], [8, -6], [-8, 6], [8, 6]]) BX(ctx, cx + a - 0.6, g0 + 0.6, L.z + bz - 0.6, cx + a + 0.6, g0 + 38, L.z + bz + 0.6, 'paint', c, SURF.metal);
      BX(ctx, cx - 8.6, g0 + 36, L.z - 6.6, cx + 8.6, g0 + 38, L.z + 6.6, 'paint', c, SURF.metal);
      BX(ctx, cx - 1.2, g0 + 38, L.z - 30, cx + 1.2, g0 + 40, L.z + 45, 'paint', col('#c62828'), SURF.metal);
      BX(ctx, cx - 3, g0 + 40, L.z - 14, cx + 3, g0 + 44, L.z - 6, 'paint', col('#eceff1'), SURF.metal);
    }
    for (let k = 0; k < 18; k++) {
      const x = L.x - 60 + (k % 6) * 7, z = L.z - 18 + Math.floor(k / 6) * 3;
      const stack = 1 + rng.int(0, 2);
      for (let s = 0; s < stack; s++) container(ctx, x, g0 + 0.6 + s * 2.6, z, false, col(rng.pick(['#1565c0', '#c62828', '#2e7d32', '#ef6c00', '#6d4c41', '#00838f'])));
    }
    for (let k = 0; k < 5; k++) ctx.loot.push({ x: L.x - 58 + k * 12, y: g0 + 0.65, z: L.z - 22, tier: 1 });
    addEgg(ctx, L.egg, L.x, L.z - 10);
  },

  kerala_temple(ctx, L) {
    const g0 = H(ctx, L.x, L.z);
    const S = 78, wh = 4.2, t = 1.1;
    const lat = WHITE;
    for (const side of ['n', 's', 'e', 'w']) {
      const gate = 6;
      if (side === 'n' || side === 's') {
        const z = L.z + (side === 'n' ? -S / 2 : S / 2);
        BX(ctx, L.x - S / 2, g0 - 0.5, z - t / 2, L.x - gate / 2, g0 + wh, z + t / 2, 'laterite', lat);
        BX(ctx, L.x + gate / 2, g0 - 0.5, z - t / 2, L.x + S / 2, g0 + wh, z + t / 2, 'laterite', lat);
        gatehouse(ctx, L.x, z, g0, false);
      } else {
        const x = L.x + (side === 'w' ? -S / 2 : S / 2);
        BX(ctx, x - t / 2, g0 - 0.5, L.z - S / 2, x + t / 2, g0 + wh, L.z - gate / 2, 'laterite', lat);
        BX(ctx, x - t / 2, g0 - 0.5, L.z + gate / 2, x + t / 2, g0 + wh, L.z + S / 2, 'laterite', lat);
        gatehouse(ctx, x, L.z, g0, true);
      }
    }
    // round sreekovil with conical copper roof
    cyl(ctx, L.x, g0, L.z, 6, 6.3, 4.2, 'whitestone', col('#d8cfbf'), 24);
    G(ctx, new THREE.ConeGeometry(8.2, 6, 24), 'chrome', col('#b87333'), L.x, g0 + 4.2 + 3, L.z);
    G(ctx, new THREE.ConeGeometry(0.35, 2, 8), 'gold', col('#d4af37'), L.x, g0 + 11, L.z);
    // mandapam + two shrines with double-tier roofs
    shell(ctx, { cx: L.x, cz: L.z + 17, w: 10, d: 8, rot: 0, floors: 1, H: 3.6, wallMat: 'wood', wallCol: col('#8d6e63'), floorMat: 'whitestone', roof: 'hip', roofMat: 'rooftile', roofCol: col('#7d2f22'), winW: 1.8, winV0: 0.4, winV1: 2.8, lootTier: 2, grills: false, chajja: false });
    for (const sx of [-1, 1]) shell(ctx, { cx: L.x + sx * 22, cz: L.z - 8, w: 9, d: 12, rot: sx > 0 ? 3 : 1, floors: 2, H: 3.4, wallMat: 'plaster', wallCol: col('#f5efe0'), roof: 'hip', roofMat: 'rooftile', roofCol: col('#8f3a28'), plinthMat: 'laterite', lootTier: 1, grills: true });
    addEgg(ctx, L.egg, L.x, L.z + S / 2 + 4);
  },

  elephants(ctx, L) {
    const n = L.n || 9, rng = ctx.rng;
    const g = H(ctx, L.x, L.z);
    const ucol = ['#e53935', '#fdd835', '#43a047', '#1e88e5', '#8e24aa', '#fb8c00', '#ec407a', '#26c6da'];
    for (let i = 0; i < n; i++) {
      const side = i % 2 ? -1 : 1;
      const k = Math.floor(i / 2);
      const x = L.x + (k - (n / 4)) * 6.5, z = L.z + side * 16;
      const gy = H(ctx, x, z);
      const e = quadruped('elephant');
      // golden nettipattam on the forehead
      part(e, new THREE.ConeGeometry(0.75, 2.1, 3), 'gold', '#d4af37', 0, 3.1, 2.85, PI / 2 - 0.3, 0, PI, 1, 1, 0.3);
      for (let q = 0; q < 7; q++) part(e, new THREE.SphereGeometry(0.1, 6, 5), 'gold', '#ffd54f', -0.45 + q * 0.15, 2.4, 3.05);
      // mahouts + the silk umbrella (muthukuda)
      for (let q = 0; q < 3; q++) { const f = figure({ shirt: '#f5f5f5', lungi: '#f5f0e0', skin: '#7b4a2e' }); f.position.set(0, 2.85, 1.0 - q * 1.1); f.scale.setScalar(0.9); e.add(f); }
      const uc = rng.pick(ucol);
      part(e, new THREE.CylinderGeometry(0.03, 0.03, 2.4, 6), 'gunwood', '#5d4037', 0, 5.2, -0.2);
      part(e, new THREE.ConeGeometry(1.1, 0.7, 20), 'cloth', uc, 0, 6.6, -0.2);
      part(e, new THREE.CylinderGeometry(1.12, 1.12, 0.35, 20, 1, true), 'cloth', uc, 0, 6.1, -0.2);
      for (let q = 0; q < 16; q++) { const a = (q / 16) * PI * 2; part(e, new THREE.SphereGeometry(0.06, 5, 4), 'gold', '#ffd54f', Math.cos(a) * 1.12, 5.9, -0.2 + Math.sin(a) * 1.12); }
      modelAt(ctx, e, x, gy, z, side > 0 ? PI : 0, true, 0.7);
    }
    ctx.loot.push({ x: L.x, y: g + 0.05, z: L.z, tier: 1 });
    addEgg(ctx, L.egg, L.x, L.z);
  },

  waterfall(ctx, L) {
    const g0 = H(ctx, L.x, L.z), h = L.h || 30;
    BX(ctx, L.x - 18, g0 - 4, L.z - 16, L.x + 18, g0 + h, L.z - 2, 'rock', col('#8a8a86'), SURF.concrete);
    for (let k = 0; k < 6; k++) BX(ctx, L.x - 20 + k * 7, g0 - 4, L.z - 18, L.x - 14 + k * 7, g0 + h - 3 - (k % 3) * 2, L.z - 14 + (k % 2), 'rock', col('#7e7e7a'), SURF.concrete);
    const tex = (() => {
      const c = document.createElement('canvas'); c.width = 64; c.height = 256; const g = c.getContext('2d');
      for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(255,255,255,${0.2 + Math.random() * 0.6})`; g.fillRect(Math.random() * 64, Math.random() * 256, 1 + Math.random() * 3, 10 + Math.random() * 40); }
      const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 2); return t;
    })();
    const wm = new THREE.MeshStandardMaterial({ map: tex, color: 0xdff4ff, transparent: true, opacity: 0.85, emissive: 0x335566, emissiveIntensity: 0.4, roughness: 0.2, depthWrite: false });
    const sheet = new THREE.Mesh(new THREE.PlaneGeometry(9, h + 2), wm);
    sheet.position.set(L.x, g0 + h / 2, L.z - 1.9);
    ctx.group.add(sheet);
    ctx.animated.push((t) => { tex.offset.y = t * 1.6; });
    const pool = new THREE.Mesh(new THREE.CircleGeometry(12, 32), ctx.waterMat);
    pool.rotation.x = -PI / 2; pool.position.set(L.x, g0 + 0.25, L.z + 6);
    ctx.group.add(pool);
    ctx.mist.push({ x: L.x, y: g0 + 1, z: L.z + 1 });
    addEgg(ctx, L.egg, L.x, L.z + 8);
  },

  rock_stage(ctx, L) {
    const g0 = H(ctx, L.x, L.z);
    BX(ctx, L.x - 9, g0 - 0.5, L.z - 6, L.x + 9, g0 + 1.5, L.z + 5, 'wood', col('#3e3e3e'), SURF.wood);
    for (const sx of [-1, 1]) {
      BX(ctx, L.x + sx * 9 - 0.3, g0 + 1.5, L.z - 6, L.x + sx * 9 + 0.3, g0 + 10, L.z - 5.4, 'metal', col('#9aa0a6'), SURF.metal);
      BX(ctx, L.x + sx * 11 - 1.2, g0, L.z + 2, L.x + sx * 11 + 1.2, g0 + 4.5, L.z + 4, 'plastic', col('#151515'));
    }
    BX(ctx, L.x - 9.3, g0 + 10, L.z - 6, L.x + 9.3, g0 + 10.6, L.z - 5.4, 'metal', col('#9aa0a6'), SURF.metal);
    const lc = ['#ff3f8e', '#2de2e6', '#ffb000', '#b4ff39'];
    for (let k = 0; k < 8; k++) ctx.geo.box(L.x - 7.5 + k * 2.1, g0 + 9.4, L.z - 5.3, L.x - 7.1 + k * 2.1, g0 + 9.9, L.z - 4.9, 'neon', col(lc[k % 4]).map((v) => v * 3));
    board(ctx, L.x, g0 + 6.2, L.z - 5.5, 0, 14, 5, ['ROCK CAPITAL', 'OF INDIA'], { bg: '#07090d', color: '#ff3f8e', color2: '#2de2e6', glow: true, sizes: [0.34, 0.3], glowI: 1.4 });
    cyl(ctx, L.x - 3, g0 + 1.5, L.z - 1, 0.5, 0.5, 0.6, 'chrome', col('#ddd'), 16, false);
    cyl(ctx, L.x - 2, g0 + 1.5, L.z - 1.5, 0.35, 0.35, 0.5, 'paint', col('#b71c1c'), 16, false);
    ctx.loot.push({ x: L.x + 3, y: g0 + 1.55, z: L.z, tier: 1 }, { x: L.x - 5, y: g0 + 1.55, z: L.z + 2, tier: 1 });
    addEgg(ctx, L.egg, L.x, L.z + 8);
  },

  root_bridge(ctx, L) { spanBridge(ctx, L, 'root'); },
  high_bridge(ctx, L) { spanBridge(ctx, L, 'steel'); },

  india_gate(ctx, L) {
    const g0 = H(ctx, L.x, L.z);
    const stone = col('#e2c9a4');
    BX(ctx, L.x - 20, g0 - 1, L.z - 8, L.x + 20, g0 + 1.2, L.z + 8, 'sandstone', WHITE);
    for (const sx of [-1, 1]) BX(ctx, L.x + sx * 11 - 5, g0 + 1.2, L.z - 5, L.x + sx * 11 + 5, g0 + 30, L.z + 5, 'whitestone', stone);
    const sh = new THREE.Shape(); sh.moveTo(-6, 0); sh.lineTo(6, 0); sh.lineTo(6, 7); sh.lineTo(-6, 7); sh.lineTo(-6, 0);
    const hole = new THREE.Path(); hole.moveTo(-6, 0); hole.absarc(0, 0, 6, PI, 0, true); hole.lineTo(-6, 0); sh.holes.push(hole);
    const arch = new THREE.ExtrudeGeometry(sh, { depth: 10, bevelEnabled: false });
    G(ctx, arch, 'whitestone', stone, L.x, g0 + 23, L.z - 5);
    ctx.phys.addBox(L.x - 6, g0 + 27, L.z - 5, L.x + 6, g0 + 30, L.z + 5, SURF.concrete);
    BX(ctx, L.x - 16.5, g0 + 30, L.z - 5.5, L.x + 16.5, g0 + 36, L.z + 5.5, 'whitestone', stone);
    BX(ctx, L.x - 17, g0 + 36, L.z - 6, L.x + 17, g0 + 37, L.z + 6, 'whitestone', col('#d8bf99'));
    BX(ctx, L.x - 12, g0 + 37, L.z - 4, L.x + 12, g0 + 40, L.z + 4, 'whitestone', stone);
    G(ctx, new THREE.CylinderGeometry(4, 5, 2.2, 24), 'whitestone', stone, L.x, g0 + 41.1, L.z);
    board(ctx, L.x, g0 + 33, L.z + 5.52, 0, 12, 2.4, ['INDIA'], { bg: '#e2c9a4', color: '#5d4a2a', sizes: [0.8], glowI: 0.05, noBack: true, font: '700 {s}px "Times New Roman", serif' });
    board(ctx, L.x, g0 + 33, L.z - 5.52, PI, 12, 2.4, ['INDIA'], { bg: '#e2c9a4', color: '#5d4a2a', sizes: [0.8], glowI: 0.05, noBack: true, font: '700 {s}px "Times New Roman", serif' });
    // canopy (chhatri) further east
    const cx = L.x + 70, cg = H(ctx, cx, L.z);
    for (const [a, b2] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) cyl(ctx, cx + a, cg, L.z + b2, 0.5, 0.5, 9, 'whitestone', stone, 12);
    BX(ctx, cx - 4, cg + 9, L.z - 4, cx + 4, cg + 11, L.z + 4, 'whitestone', stone);
    dome(ctx, cx, cg + 11, L.z, 3.6, 'whitestone', stone, 1.0);
    ctx.loot.push({ x: L.x, y: g0 + 1.25, z: L.z, tier: 1 });
    addEgg(ctx, L.egg, L.x, L.z + 12);
  },

  qutub(ctx, L) {
    const g0 = H(ctx, L.x, L.z);
    const st = [[7.2, 5.6, 24, 'sandstone'], [5.5, 4.4, 16, 'sandstone'], [4.3, 3.5, 12, 'sandstone'], [3.4, 2.8, 10, 'marble'], [2.7, 2.1, 9, 'marble']];
    let y = g0;
    st.forEach(([r0, r1, h, m], i) => {
      const cg = new THREE.CylinderGeometry(r1, r0, h, 32, 6);
      const p = cg.attributes.position;
      for (let k = 0; k < p.count; k++) {
        const x = p.getX(k), z = p.getZ(k), a = Math.atan2(z, x);
        const f = 1 + 0.07 * Math.max(0, Math.cos(a * 12));
        if (Math.hypot(x, z) > 0.1) { p.setX(k, x * f); p.setZ(k, z * f); }
      }
      cg.computeVertexNormals();
      G(ctx, cg, m, m === 'marble' ? col('#f0e8dc') : WHITE, L.x, y + h / 2, L.z);
      ctx.phys.addBox(L.x - r1 * 0.72, y, L.z - r1 * 0.72, L.x + r1 * 0.72, y + h, L.z + r1 * 0.72, SURF.concrete);
      y += h;
      // balcony ring
      const br = r1 + 1.3;
      G(ctx, new THREE.CylinderGeometry(br, r1, 0.9, 32), 'sandstone', col('#c9a27a'), L.x, y - 0.45, L.z);
      for (const [a, b2, c, d] of [[-br, -br, br, -r1 * 0.7], [-br, r1 * 0.7, br, br], [-br, -r1 * 0.7, -r1 * 0.7, r1 * 0.7], [r1 * 0.7, -r1 * 0.7, br, r1 * 0.7]]) ctx.phys.addBox(L.x + a, y - 0.9, L.z + b2, L.x + c, y, L.z + d, SURF.concrete);
      G(ctx, new THREE.TorusGeometry(br, 0.08, 6, 40), 'sandstone', col('#b88a5e'), L.x, y + 0.9, L.z, 0, null, PI / 2);
      if (i === 2) ctx.climbs.push({ x: L.x + st[0][0] + 1.5, z: L.z, y: g0, r: 3, top: [L.x + br - 0.6, y + 0.05, L.z], name: 'the third balcony' });
    });
    dome(ctx, L.x, y, L.z, 1.8, 'marble', col('#f0e8dc'), 1.2);
    // ruins: broken colonnade + the iron pillar
    for (let k = 0; k < 10; k++) cyl(ctx, L.x - 25 + (k % 5) * 4, g0, L.z + 18 + Math.floor(k / 5) * 6, 0.45, 0.5, 3 + (k * 7 % 5) * 0.8, 'sandstone', col('#b98c63'), 10);
    BX(ctx, L.x + 20, g0 - 0.5, L.z - 22, L.x + 38, g0 + 7, L.z - 20, 'sandstone', WHITE);
    cyl(ctx, L.x - 16, g0, L.z - 16, 0.25, 0.3, 7.2, 'metal', col('#4a3c30'), 12);
    addEgg(ctx, { id: 'ironpillar', title: 'The Iron Pillar', text: '1,600 years old. Zero rust. Your gun rusts after one monsoon.', r: 8 }, L.x - 16, L.z - 16);
    ctx.loot.push({ x: L.x + st[2][0] + 1.5, y, z: L.z, tier: 2 });
    addEgg(ctx, L.egg, L.x, L.z + 10);
  },

  cp_circle(ctx, L) {
    const r = L.r || 80, g0 = H(ctx, L.x, L.z);
    const white = col('#f3f0e9');
    const blocks = [[0, -1, 0], [0, 1, 2], [-1, 0, 1], [1, 0, 3], [-0.72, -0.72, 0], [0.72, -0.72, 3], [-0.72, 0.72, 1], [0.72, 0.72, 2]];
    for (const [sx, sz, rot] of blocks) {
      const cx = L.x + sx * r, cz = L.z + sz * r;
      // face the centre: rot 0 faces +z, 1 +x, 2 -z, 3 -x
      const face = sz < -0.1 && Math.abs(sx) < 0.1 ? 0 : sz > 0.1 && Math.abs(sx) < 0.1 ? 2 : sx < -0.1 && Math.abs(sz) < 0.1 ? 1 : sx > 0.1 && Math.abs(sz) < 0.1 ? 3 : rot;
      const F = shell(ctx, { cx, cz, w: 30, d: 14, rot: face, floors: 2, H: 4.2, wallMat: 'plaster', wallCol: white, trimCol: col('#ffffff'), roof: 'flat', shop: true, balcony: false, grills: false, lootTier: 1, dish: false });
      for (let k = 0; k < 9; k++) { const [wx, wz] = F.w(-14 + k * 3.5, 7 + 2.6); cyl(ctx, wx, F.base, wz, 0.3, 0.32, 8.4, 'plaster', col('#fbfaf6'), 12); }
      F.box(-15, F.base + 8.2, 7, 15, F.base + 8.6, 7 + 3.2, 'concrete', col('#eeeae1'));
    }
    // central park + giant flag
    const fy = g0;
    cyl(ctx, L.x, fy, L.z, 0.35, 0.55, 55, 'chrome', col('#ddd'), 12);
    const fc = document.createElement('canvas'); fc.width = 300; fc.height = 200;
    const fg = fc.getContext('2d');
    fg.fillStyle = '#FF9933'; fg.fillRect(0, 0, 300, 67); fg.fillStyle = '#ffffff'; fg.fillRect(0, 67, 300, 66); fg.fillStyle = '#138808'; fg.fillRect(0, 133, 300, 67);
    fg.strokeStyle = '#000080'; fg.lineWidth = 3; fg.beginPath(); fg.arc(150, 100, 28, 0, 7); fg.stroke();
    for (let i = 0; i < 24; i++) { const a = (i / 24) * PI * 2; fg.beginPath(); fg.moveTo(150, 100); fg.lineTo(150 + Math.cos(a) * 28, 100 + Math.sin(a) * 28); fg.lineWidth = 1.2; fg.stroke(); }
    const ft = new THREE.CanvasTexture(fc); ft.colorSpace = THREE.SRGBColorSpace;
    const flagGeo = new THREE.PlaneGeometry(15, 10, 20, 10);
    const flag = new THREE.Mesh(flagGeo, new THREE.MeshStandardMaterial({ map: ft, side: THREE.DoubleSide, roughness: 0.9 }));
    flag.position.set(L.x + 7.5, fy + 49, L.z);
    ctx.group.add(flag);
    const base = flagGeo.attributes.position.array.slice();
    ctx.animated.push((t) => {
      const p = flagGeo.attributes.position;
      for (let k = 0; k < p.count; k++) { const x = base[k * 3] + 7.5; p.setZ(k, Math.sin(x * 0.5 - t * 3) * 0.08 * x); }
      p.needsUpdate = true;
    });
    addEgg(ctx, L.egg, L.x, L.z + 20);
  },

  red_fort(ctx, L) {
    const g0 = H(ctx, L.x, L.z), h = 18, t = 6;
    const rs = WHITE;
    // wall A along x with the gate in the middle, wall B along z
    const gate = 8;
    BX(ctx, L.x - 90, g0 - 1, L.z - t / 2, L.x - gate / 2, g0 + h, L.z + t / 2, 'sandstone', rs);
    BX(ctx, L.x + gate / 2, g0 - 1, L.z - t / 2, L.x + 90, g0 + h, L.z + t / 2, 'sandstone', rs);
    BX(ctx, L.x - gate / 2, g0 + 12, L.z - t / 2, L.x + gate / 2, g0 + h, L.z + t / 2, 'sandstone', rs);
    BX(ctx, L.x + 90 - t, g0 - 1, L.z + t / 2, L.x + 90, g0 + h, L.z + 110, 'sandstone', rs);
    for (let x = -88; x < 88; x += 3) ctx.geo.box(L.x + x, g0 + h, L.z + t / 2 - 0.8, L.x + x + 1.5, g0 + h + 1.4, L.z + t / 2, 'sandstone', rs);
    for (let z = 4; z < 108; z += 3) ctx.geo.box(L.x + 90 - t, g0 + h, L.z + z, L.x + 90 - t + 0.8, g0 + h + 1.4, L.z + z + 1.5, 'sandstone', rs);
    // gate towers + chhatris
    for (const sx of [-1, 1]) {
      const tx = L.x + sx * 10;
      cyl(ctx, tx, g0, L.z - t / 2 - 2, 4, 4.5, h + 6, 'sandstone', rs, 8);
      for (const [a, b2] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) cyl(ctx, tx + a, g0 + h + 6, L.z - t / 2 - 2 + b2, 0.2, 0.2, 3, 'marble', col('#f5efe4'), 8, false);
      dome(ctx, tx, g0 + h + 9, L.z - t / 2 - 2, 2.4, 'marble', col('#f5efe4'), 1.2);
    }
    BX(ctx, L.x - 6, g0 + h, L.z - t / 2, L.x + 6, g0 + h + 5, L.z + t / 2, 'sandstone', rs);
    for (let k = -2; k <= 2; k++) dome(ctx, L.x + k * 2.2, g0 + h + 5, L.z, 0.9, 'marble', col('#f5efe4'), 1.2);
    // stairs up to the rampart inside the fort (+z side)
    for (let s = 0; s < 60; s++) BX(ctx, L.x + 20, g0 - 0.5, L.z + t / 2 + 1 + s * 0.4, L.x + 23, g0 + (s + 1) * 0.3, L.z + t / 2 + 1 + (s + 1) * 0.4, 'sandstone', rs);
    BX(ctx, L.x - 88, g0 + h - 0.3, L.z - t / 2 + 0.5, L.x + 88, g0 + h, L.z + t / 2 - 0.5, 'sandstone', rs);
    ctx.loot.push({ x: L.x + 30, y: g0 + h + 0.05, z: L.z, tier: 2 }, { x: L.x - 40, y: g0 + h + 0.05, z: L.z, tier: 1 });
    addEgg(ctx, L.egg, L.x, L.z + 10);
  },

  cyber_hub(ctx, L) {
    const g0 = H(ctx, L.x, L.z);
    ctx.geo.box(L.x - 36, g0 + 0.02, L.z - 26, L.x + 36, g0 + 0.12, L.z + 26, 'pavers', col('#cfcfd4'));
    buildArchetype(ctx, 'tower', { cx: L.x - 18, cz: L.z - 40, w: 24, d: 20, rot: 0, h: 70, style: 'glass' });
    buildArchetype(ctx, 'tower', { cx: L.x + 20, cz: L.z - 40, w: 20, d: 20, rot: 0, h: 52, style: 'glass' });
    for (let k = 0; k < 3; k++) {
      shell(ctx, { cx: L.x - 30, cz: L.z - 15 + k * 15, w: 10, d: 13, rot: 1, floors: 2, wallMat: 'concrete', wallCol: col('#2b2f36'), roof: 'flat', shop: true, lootTier: 1, dish: false, tank: false });
      shell(ctx, { cx: L.x + 30, cz: L.z - 15 + k * 15, w: 10, d: 13, rot: 3, floors: 2, wallMat: 'concrete', wallCol: col('#2b2f36'), roof: 'flat', shop: true, lootTier: 1, dish: false, tank: false });
    }
    for (let k = 0; k < 3; k++) {
      const t = new THREE.TorusGeometry(9, 0.18, 8, 40, PI);
      const c = col(['#ff3f8e', '#2de2e6', '#b4ff39'][k]);
      G(ctx, t, 'neon', [c[0] * 3, c[1] * 3, c[2] * 3], L.x, g0, L.z + 22 - k * 4, 0);
    }
    board(ctx, L.x, g0 + 12, L.z - 27.5, 0, 20, 7, ['CYBER HUB', '₹600 cold brew · ₹0 parking'], { bg: '#06080c', color: '#2de2e6', color2: '#ff3f8e', glow: true, sizes: [0.4, 0.2], glowI: 1.6 });
    for (let k = 0; k < 6; k++) {
      const x = L.x - 15 + (k % 3) * 15, z = L.z - 6 + Math.floor(k / 3) * 14;
      cyl(ctx, x, g0, z, 0.5, 0.5, 0.75, 'wood', col('#6d4c41'), 10);
      G(ctx, new THREE.ConeGeometry(1.8, 0.6, 10), 'cloth', col(ctx.rng.pick(['#f5f5f5', '#212121', '#b71c1c'])), x, g0 + 2.6, z);
      cyl(ctx, x, g0 + 0.75, z, 0.04, 0.04, 1.6, 'metal', col('#555'), 6, false);
    }
    addEgg(ctx, L.egg, L.x, L.z);
  },

  toll(ctx, L) {
    const g0 = H(ctx, L.x, L.z);
    // find the road direction nearby
    let ang = 0, best = Infinity;
    for (const r of ctx.roads) for (let i = 0; i < r.pts.length - 1; i++) {
      const [a, b] = [r.pts[i], r.pts[i + 1]];
      const s = segDist(L.x, L.z, a[0], a[1], b[0], b[1]);
      if (s.d < best) { best = s.d; ang = Math.atan2(b[0] - a[0], b[1] - a[1]); }
    }
    const perp = ang + PI / 2;
    G(ctx, new THREE.BoxGeometry(34, 1.2, 12), 'paint', col('#f5f5f5'), L.x, g0 + 6.5, L.z, perp);
    G(ctx, new THREE.BoxGeometry(34.2, 0.3, 0.4), 'neon', col('#2de2e6').map((v) => v * 3), L.x + Math.sin(ang) * 6, g0 + 6.1, L.z + Math.cos(ang) * 6, perp);
    for (let k = 0; k < 6; k++) {
      const o = -14 + k * 5.6;
      const bx = L.x + Math.sin(perp) * o, bz = L.z + Math.cos(perp) * o;
      G(ctx, new THREE.BoxGeometry(1.4, 2.6, 2.4), 'paint', col('#eeeeee'), bx, g0 + 1.3, bz, perp);
      ctx.phys.addBox(bx - 0.9, g0, bz - 0.9, bx + 0.9, g0 + 2.6, bz + 0.9, SURF.metal);
      cyl(ctx, bx, g0, bz, 0.25, 0.25, 6, 'paint', col('#ddd'), 8, false);
      G(ctx, new THREE.BoxGeometry(0.1, 0.1, 3.4), 'paint', col('#e53935'), bx + Math.sin(perp) * 2, g0 + 1.1, bz + Math.cos(perp) * 2, ang);
    }
    // the queue
    const rng = ctx.rng;
    for (let lane = 0; lane < 4; lane++) {
      let s = 6;
      for (let q = 0; q < 6; q++) {
        const v = randomVehicle(rng, ['car', 'car', 'suv', 'bus']);
        s += v.len / 2;
        const o = -9 + lane * 5.6;
        const x = L.x - Math.sin(ang) * s + Math.sin(perp) * o, z = L.z - Math.cos(ang) * s + Math.cos(perp) * o;
        modelAt(ctx, v.g, x, H(ctx, x, z), z, ang, true, 0.55);
        s += v.len / 2 + 1.5;
      }
    }
    board(ctx, L.x, g0 + 8.4, L.z, ang + PI, 14, 2.2, ['TOLL PLAZA · ₹100', 'FASTag lanes: beeping, not moving'], { bg: '#0d47a1', color: '#ffffff', color2: '#bbdefb', sizes: [0.42, 0.26], glowI: 0.8 });
    addEgg(ctx, L.egg, L.x, L.z);
  },

  cranes(ctx, L) {
    const g0 = H(ctx, L.x, L.z);
    // skeleton building: slabs, columns, stairs — no walls
    const w = 24, d = 16, floors = 6, Hh = 3.4;
    const F = new Frame(ctx, L.x, L.z, 0, g0 + 0.3);
    const S = { w, d, t: 0.22 };
    const lane = 1.15, sx0 = -w / 2 + 0.22, sz0 = -d / 2 + 0.22 + 1.2, run = 4.2, sz1 = sz0 + run;
    const laneX = (Ln) => [sx0 + Ln * lane, sx0 + (Ln + 1) * lane];
    F.box(-w / 2, g0 - 0.5, -d / 2, w / 2, g0 + 0.3, d / 2, 'concreteFloor', WHITE);
    for (let f = 0; f < floors; f++) {
      const y0 = g0 + 0.3 + f * Hh;
      if (f < floors - 1) flight(F, y0, f % 2, laneX, sz0, run, Hh);
      slab(F, S, y0 + Hh - 0.22, y0 + Hh, f < floors - 1 ? f % 2 : -1, laneX, sz0, sz1, 'concrete', false);
      if (f < floors - 2) rails(F, S, y0 + Hh, f % 2, laneX, sz0, sz1);
      for (let i = 0; i < 4; i++) for (let k = 0; k < 3; k++) F.box(-w / 2 + 0.3 + i * ((w - 0.6) / 3) - 0.25, y0, -d / 2 + 0.3 + k * ((d - 0.6) / 2) - 0.25, -w / 2 + 0.3 + i * ((w - 0.6) / 3) + 0.25, y0 + Hh - 0.22, -d / 2 + 0.3 + k * ((d - 0.6) / 2) + 0.25, 'concrete', col('#a19b91'));
      for (let q = 0; q < 2; q++) F.loot(-4 + ctx.rng() * 14, y0, -4 + ctx.rng() * 8, 1);
      if (ctx.rng() < 0.6) F.box(2, y0, -2, 4, y0 + 1.2, 1, 'wood', col('#a88457'), SURF.wood);
    }
    ctx.buildings.push({ F, w, d, base: g0 + 0.3, floors, H: Hh, top: g0 + 0.3 + floors * Hh });
    // tower cranes
    for (let i = 0; i < (L.n || 3); i++) {
      const a = (i / (L.n || 3)) * PI * 2 + 0.6;
      const cx = L.x + Math.cos(a) * 26, cz = L.z + Math.sin(a) * 26, cg = H(ctx, cx, cz);
      BX(ctx, cx - 1, cg, cz - 1, cx + 1, cg + 48, cz + 1, 'paint', col('#f9a825'), SURF.metal);
      const jy = cg + 48;
      const ja = a + PI;
      G(ctx, new THREE.BoxGeometry(1.2, 1.2, 44), 'paint', col('#f9a825'), cx + Math.sin(ja) * 14, jy + 0.6, cz + Math.cos(ja) * 14, ja);
      G(ctx, new THREE.BoxGeometry(3, 2.5, 3), 'paint', col('#eceff1'), cx, jy + 2, cz, ja);
      G(ctx, new THREE.BoxGeometry(2.4, 2, 5), 'concrete', col('#777'), cx - Math.sin(ja) * 8, jy - 0.4, cz - Math.cos(ja) * 8, ja);
      ctx.geo.box(cx - 0.3, jy + 3.2, cz - 0.3, cx + 0.3, jy + 3.6, cz + 0.3, 'lamp', col('#ff1744'));
    }
    // tin barricade
    for (const [a, b2, c, d2] of [[-34, -26, 34, -25.8], [-34, 25.8, -4, 26], [4, 25.8, 34, 26], [-34, -26, -33.8, 26], [33.8, -26, 34, 26]]) BX(ctx, L.x + a, g0 - 0.5, L.z + b2, L.x + c, g0 + 2.4, L.z + d2, 'tin', col('#1e88e5'), SURF.metal);
    board(ctx, L.x, g0 + 3.4, L.z + 26.1, 0, 10, 1.8, ['POSSESSION: NEXT YEAR', 'Since 2008'], { bg: '#ffffff', color: '#b71c1c', color2: '#333', sizes: [0.42, 0.28], glowI: 0.2 });
    addEgg(ctx, L.egg, L.x, L.z + 28);
  },

  morungs(ctx, L) {
    const g0 = H(ctx, L.x, L.z);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * PI * 2;
      const cx = L.x + Math.cos(a) * 34, cz = L.z + Math.sin(a) * 34;
      const rot = Math.abs(Math.cos(a)) > Math.abs(Math.sin(a)) ? (Math.cos(a) > 0 ? 3 : 1) : (Math.sin(a) > 0 ? 2 : 0);
      const F = shell(ctx, { cx, cz, w: 8, d: 11, rot, floors: 1, H: 3.6, wallMat: 'wood', wallCol: col('#7a5a3a', 0.08, ctx.rng), floorMat: 'wood', roof: 'gable', roofMat: 'wood', roofCol: col('#b09a6a'), winW: 0.9, chajja: false, lootTier: 1, faceUphill: false });
      const b = F.base + 3.6;
      // crossed horns at the gable
      F.box(-2.2, b + 2.2, 5.4, -0.2, b + 2.45, 5.6, 'wood', col('#2b1d12'), SURF.wood, false);
      F.box(0.2, b + 2.2, 5.4, 2.2, b + 2.45, 5.6, 'wood', col('#2b1d12'), SURF.wood, false);
      F.box(-3.9, F.base, 5.51, 3.9, F.base + 3.4, 5.6, 'wood', col('#1a1a1a'), SURF.wood, false);
      for (let q = 0; q < 4; q++) F.box(-3.2 + q * 1.8, F.base + 0.5, 5.6, -2.6 + q * 1.8, F.base + 3.0, 5.66, 'paint', col(q % 2 ? '#c62828' : '#f5f5f5'), SURF.wood, false);
    }
    // arena stage and bleachers
    BX(ctx, L.x - 8, g0 - 0.5, L.z - 4, L.x + 8, g0 + 1.2, L.z + 4, 'wood', col('#5d4037'), SURF.wood);
    board(ctx, L.x, g0 + 4.5, L.z - 4.1, PI, 12, 3, ['HORNBILL FESTIVAL', 'Festival of Festivals'], { bg: '#1a1a1a', color: '#ffb000', color2: '#ffffff', sizes: [0.42, 0.26], glowI: 0.8 });
    addEgg(ctx, L.egg, L.x, L.z + 8);
  },

  cemetery(ctx, L) {
    const g0 = H(ctx, L.x, L.z);
    for (let t = 0; t < 5; t++) {
      const y = g0 + 3 - t * 1.2, z = L.z - 20 + t * 9;
      BX(ctx, L.x - 26, y - 3, z - 4.5, L.x + 26, y, z + 4.5, 'grassPath', col('#b7c79a'));
      BX(ctx, L.x - 26, y - 3, z + 4.3, L.x + 26, y + 0.5, z + 4.5, 'whitestone', col('#d8d2c4'));
      for (let k = 0; k < 14; k++) for (let r = 0; r < 2; r++) ctx.geo.box(L.x - 23 + k * 3.4, y, z - 2.5 + r * 3, L.x - 22.5 + k * 3.4, y + 0.8, z - 2.38 + r * 3, 'whitestone', col('#f2efe8'));
    }
    const cy = g0 + 3;
    BX(ctx, L.x - 0.35, cy, L.z - 24, L.x + 0.35, cy + 9, L.z - 23.3, 'whitestone', col('#f7f4ee'));
    BX(ctx, L.x - 2.2, cy + 6, L.z - 24, L.x + 2.2, cy + 6.7, L.z - 23.3, 'whitestone', col('#f7f4ee'));
    board(ctx, L.x, cy + 1.2, L.z - 22.5, 0, 6, 1.6, ['WHEN YOU GO HOME, TELL THEM OF US'], { bg: '#e7e2d6', color: '#3e3a33', sizes: [0.4], glowI: 0.05 });
    ctx.noLoot.push({ x: L.x, z: L.z, r: 32 });
    addEgg(ctx, L.egg, L.x, L.z - 18, cy);
  },

  hornbill_statue(ctx, L) {
    const g0 = H(ctx, L.x, L.z);
    BX(ctx, L.x - 1.8, g0 - 0.5, L.z - 1.8, L.x + 1.8, g0 + 2.6, L.z + 1.8, 'whitestone', col('#bdb5a6'));
    const b = new THREE.Group();
    part(b, new THREE.SphereGeometry(1, 16, 12), 'paint', '#1a1a1a', 0, 1.2, 0, 0, 0, 0, 1, 0.8, 1.6);
    part(b, new THREE.BoxGeometry(2.2, 0.2, 1.5), 'paint', '#f5f5f5', 0, 1.3, 0.3);
    part(b, new THREE.BoxGeometry(0.5, 0.2, 2.6), 'paint', '#f5f5f5', 0, 0.9, -2.2, 0.3);
    part(b, new THREE.SphereGeometry(0.5, 12, 10), 'paint', '#1a1a1a', 0, 2.1, 1.3);
    part(b, new THREE.ConeGeometry(0.3, 1.8, 10), 'paint', '#fbc02d', 0, 1.9, 2.3, PI / 2 + 0.25);
    part(b, new THREE.BoxGeometry(0.28, 0.35, 1.0), 'paint', '#f57f17', 0, 2.45, 1.85);
    b.scale.setScalar(1.3);
    modelAt(ctx, b, L.x, g0 + 2.6, L.z, 0.6, true, 0.6);
    addEgg(ctx, L.egg, L.x, L.z);
  },

  monastery(ctx, L) {
    const top = H(ctx, L.x, L.z);
    const F = shell(ctx, { cx: L.x, cz: L.z, w: 14, d: 12, rot: 0, floors: 2, wallMat: 'mudwhite', wallCol: col('#f4f1ea'), trimCol: col('#6d1b1b'), roof: 'flat', lootTier: 2, tank: false, dish: false, grills: false });
    const b = ctx.buildings[ctx.buildings.length - 1];
    F.box(-7.05, b.top - 1.1, -6.05, 7.05, b.top + 0.95, 6.05, 'plaster', col('#7b1f1f'), SURF.concrete, false, 'tb');
    G(ctx, new THREE.ConeGeometry(1.4, 3, 12), 'gold', col('#d4af37'), L.x, b.top + 3.5, L.z);
    cyl(ctx, L.x, b.top + 0.95, L.z, 1.2, 1.4, 0.8, 'gold', col('#d4af37'), 12, false);
    const rng = ctx.rng;
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * PI * 2 + rng() * 0.3, rr = 20 + (k % 3) * 8;
      shell(ctx, { cx: L.x + Math.cos(a) * rr, cz: L.z + Math.sin(a) * rr, w: rng.range(7, 10), d: rng.range(7.4, 9), rot: rng.int(0, 3), floors: rng.int(1, 3), wallMat: 'mudwhite', wallCol: col('#f4f1ea', 0.03, rng), trimCol: col('#6d1b1b'), roof: 'flat', lootTier: 1, tank: false, dish: false, grills: false, faceUphill: true });
    }
    addEgg(ctx, L.egg, L.x, L.z + 8, top);
  },

  buddha(ctx, L) {
    const g0 = H(ctx, L.x, L.z);
    cyl(ctx, L.x, g0 - 0.5, L.z, 6, 6.5, 4, 'whitestone', col('#e6dfd2'), 8);
    const gold = col('#d4a017');
    G(ctx, new THREE.SphereGeometry(5, 20, 10), 'gold', col('#c2185b'), L.x, g0 + 4, L.z, 0, [1, 0.3, 1]);
    G(ctx, new THREE.SphereGeometry(4.5, 20, 12), 'gold', gold, L.x, g0 + 5.3, L.z, 0, [1, 0.42, 0.72]);
    G(ctx, new THREE.CylinderGeometry(2.3, 3.0, 6, 20), 'gold', gold, L.x, g0 + 9, L.z);
    G(ctx, new THREE.SphereGeometry(2.4, 18, 12), 'gold', gold, L.x, g0 + 12, L.z, 0, [1, 0.5, 0.8]);
    G(ctx, new THREE.SphereGeometry(1.55, 18, 14), 'gold', gold, L.x, g0 + 14.1, L.z);
    G(ctx, new THREE.SphereGeometry(0.6, 12, 10), 'gold', col('#1a237e'), L.x, g0 + 15.7, L.z);
    for (const sx of [-1, 1]) { G(ctx, new THREE.BoxGeometry(0.3, 1.3, 0.5), 'gold', gold, L.x + sx * 1.55, g0 + 13.8, L.z); G(ctx, new THREE.CylinderGeometry(0.7, 0.6, 4.5, 12), 'gold', gold, L.x + sx * 2.8, g0 + 8.3, L.z + 0.6, 0, null, 0.35, sx * 0.25); }
    ctx.phys.addBox(L.x - 4, g0 + 3.5, L.z - 3, L.x + 4, g0 + 15, L.z + 3, SURF.metal);
    ctx.loot.push({ x: L.x + 5, y: g0 + 3.55, z: L.z, tier: 2 });
    addEgg(ctx, L.egg, L.x, L.z + 9);
  },

  post_office(ctx, L) {
    const F = shell(ctx, { cx: L.x, cz: L.z, w: 8, d: 7.4, rot: 0, floors: 1, wallMat: 'mudwhite', wallCol: col('#f4f1ea'), trimCol: col('#6d1b1b'), roof: 'flat', lootTier: 1, tank: false, dish: false });
    const [px, pz] = F.w(3.5, 6);
    const g = H(ctx, px, pz);
    cyl(ctx, px, g, pz, 0.35, 0.35, 1.3, 'paint', col('#c62828'), 16);
    G(ctx, new THREE.SphereGeometry(0.38, 14, 8, 0, PI * 2, 0, PI / 2), 'paint', col('#b71c1c'), px, g + 1.3, pz);
    board(ctx, ...(() => { const [x, z] = F.w(0, 3.8); return [x, F.base + 3.6, z]; })(), 0, 7, 1.4, ['POST OFFICE · 4,400 m', 'World\'s highest'], { bg: '#c62828', color: '#fff8e1', color2: '#ffe082', sizes: [0.44, 0.3], glowI: 0.3 });
    addEgg(ctx, L.egg, px, pz + 1);
  },
};

function gatehouse(ctx, x, z, g0, alongX) {
  const w = alongX ? 7 : 10, d = alongX ? 10 : 7;
  for (const s of [-1, 1]) {
    if (alongX) BX(ctx, x - 3.5, g0 - 0.5, z + s * 3 - 1, x + 3.5, g0 + 5, z + s * 3 + 1, 'laterite', WHITE);
    else BX(ctx, x + s * 3 - 1, g0 - 0.5, z - 3.5, x + s * 3 + 1, g0 + 5, z + 3.5, 'laterite', WHITE);
  }
  BX(ctx, x - w / 2, g0 + 5, z - d / 2, x + w / 2, g0 + 5.4, z + d / 2, 'wood', col('#5d4431'), SURF.wood);
  const F = new Frame(ctx, x, z, alongX ? 1 : 0);
  const W = 5.5, D = 4.5, y = g0 + 5.4, rh = 3;
  F.quad([[-W, y, D], [W, y, D], [W * 0.3, y + rh, 0], [-W * 0.3, y + rh, 0]], 'rooftile', col('#8f3a28'));
  F.quad([[W, y, -D], [-W, y, -D], [-W * 0.3, y + rh, 0], [W * 0.3, y + rh, 0]], 'rooftile', col('#8f3a28'));
  F.tri([[W, y, D], [W, y, -D], [W * 0.3, y + rh, 0]], 'rooftile', col('#8f3a28'));
  F.tri([[-W, y, -D], [-W, y, D], [-W * 0.3, y + rh, 0]], 'rooftile', col('#8f3a28'));
}

// bridges that auto-orient across the nearest river
function spanBridge(ctx, L, style) {
  let best = null;
  for (const w of ctx.phys.water) {
    if (w.type !== 'river') continue;
    for (let i = 0; i < w.pts.length - 1; i++) {
      const a = w.pts[i], b = w.pts[i + 1];
      const s = segDist(L.x, L.z, a[0], a[1], b[0], b[1]);
      if (!best || s.d < best.d) best = { d: s.d, cx: s.cx, cz: s.cz, dx: b[0] - a[0], dz: b[1] - a[1], w: w.w, lvl: a[2] + (b[2] - a[2]) * s.t };
    }
  }
  if (!best) return;
  // span perpendicular to the river, snapped to an axis for clean colliders
  const riverAlongX = Math.abs(best.dx) > Math.abs(best.dz);
  const span = best.w + 22;
  const cx = best.cx, cz = best.cz;
  const e0 = riverAlongX ? [cx, cz - span / 2] : [cx - span / 2, cz];
  const e1 = riverAlongX ? [cx, cz + span / 2] : [cx + span / 2, cz];
  const h0 = H(ctx, e0[0], e0[1]), h1 = H(ctx, e1[0], e1[1]);
  const deck = Math.max(Math.min(h0, h1), best.lvl + 3);
  const n = 12;
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 1) / n;
    const sag = style === 'root' ? Math.sin(((t0 + t1) / 2) * PI) * 1.2 : 0;
    const y0 = deck + (h1 - h0) * 0 - sag;
    const a = [e0[0] + (e1[0] - e0[0]) * t0, e0[1] + (e1[1] - e0[1]) * t0];
    const b = [e0[0] + (e1[0] - e0[0]) * t1, e0[1] + (e1[1] - e0[1]) * t1];
    const hw = style === 'root' ? 0.9 : 2.6;
    const [x0, z0, x1, z1] = riverAlongX ? [cx - hw, Math.min(a[1], b[1]), cx + hw, Math.max(a[1], b[1])] : [Math.min(a[0], b[0]), cz - hw, Math.max(a[0], b[0]), cz + hw];
    BX(ctx, x0, y0 - 0.4, z0, x1, y0, z1, style === 'root' ? 'bark' : 'metal', style === 'root' ? col('#5b4a33') : col('#8c6e5a'), style === 'root' ? SURF.wood : SURF.metal);
    // handrails
    if (riverAlongX) { BX(ctx, x0 - 0.12, y0, z0, x0, y0 + 1.1, z1, style === 'root' ? 'bark' : 'metal', col(style === 'root' ? '#4a3b28' : '#c62828'), SURF.wood); BX(ctx, x1, y0, z0, x1 + 0.12, y0 + 1.1, z1, style === 'root' ? 'bark' : 'metal', col(style === 'root' ? '#4a3b28' : '#c62828'), SURF.wood); }
    else { BX(ctx, x0, y0, z0 - 0.12, x1, y0 + 1.1, z0, style === 'root' ? 'bark' : 'metal', col(style === 'root' ? '#4a3b28' : '#c62828'), SURF.wood); BX(ctx, x0, y0, z1, x1, y0 + 1.1, z1 + 0.12, style === 'root' ? 'bark' : 'metal', col(style === 'root' ? '#4a3b28' : '#c62828'), SURF.wood); }
  }
  if (style === 'root') {
    // twisting roots draped under and around the deck
    const rng = ctx.rng;
    for (let k = 0; k < 10; k++) {
      const pts = [];
      for (let i = 0; i <= 10; i++) {
        const t = i / 10;
        const x = e0[0] + (e1[0] - e0[0]) * t, z = e0[1] + (e1[1] - e0[1]) * t;
        const off = (k / 9 - 0.5) * 2.2;
        pts.push(new THREE.Vector3(x + (riverAlongX ? off : 0) + (rng() - 0.5) * 0.4, deck - 0.3 - Math.sin(t * PI) * (1.2 + rng() * 1.2) + (k % 3 === 0 ? 1.2 : 0), z + (riverAlongX ? 0 : off) + (rng() - 0.5) * 0.4));
      }
      ctx.geo.geom(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.12 + rng() * 0.12, 6), new THREE.Matrix4(), 'bark', col('#4e3d2a', 0.15, rng));
    }
  } else {
    // steel truss sides
    for (const s of [-1, 1]) {
      for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        const x = e0[0] + (e1[0] - e0[0]) * t + (riverAlongX ? s * 2.6 : 0), z = e0[1] + (e1[1] - e0[1]) * t + (riverAlongX ? 0 : s * 2.6);
        ctx.geo.box(x - 0.15, deck, z - 0.15, x + 0.15, deck + 5, z + 0.15, 'metal', col('#c62828'));
      }
      const [x0, z0] = [e0[0] + (riverAlongX ? s * 2.6 : 0), e0[1] + (riverAlongX ? 0 : s * 2.6)];
      const [x1, z1] = [e1[0] + (riverAlongX ? s * 2.6 : 0), e1[1] + (riverAlongX ? 0 : s * 2.6)];
      ctx.geo.box(Math.min(x0, x1) - 0.2, deck + 4.8, Math.min(z0, z1) - 0.2, Math.max(x0, x1) + 0.2, deck + 5.2, Math.max(z0, z1) + 0.2, 'metal', col('#c62828'));
    }
  }
  addEgg(ctx, L.egg, cx, cz, deck);
}

// ================================================================== PROPS (easter eggs + set dressing)
export const PROP_PAD = { stall: 5, pothole: 0, coder_bike: 3, billboard: 6, banner: 0, auto_sign: 4, sign: 3, foam: 0, jam: 0, gulf_house: 16, tanker: 12, harthal: 0, bus: 7, puli: 6, bank: 12, kudamattam: 8, aqi: 3, suv: 4, wires: 0, parking_fight: 8, baraat: 12, cows: 6, boat: 0, knup: 3, football: 0, ordered_jam: 0, bamboo: 8, honesty_shop: 5, chilli_stall: 5, log_drum: 6, lights: 0, bikers: 8, snow_leopard: 4, yaks: 8, flags: 0 };

export function buildProp(ctx, P) {
  const fn = PB[P.kind];
  if (!fn) { console.warn('no prop', P.kind); return; }
  fn(ctx, P);
}

const PB = {
  stall(ctx, P) {
    const ry = rotY(P.rot), [fx, fz] = fwd(ry);
    const g = new THREE.Group();
    part(g, new THREE.BoxGeometry(3.2, 1.0, 1.1), 'gunwood', '#8d6e63', 0, 0.5, 0.2);
    part(g, new THREE.BoxGeometry(3.4, 2.6, 0.1), 'gunwood', '#6d4c41', 0, 1.3, -1.2);
    part(g, new THREE.BoxGeometry(3.8, 0.08, 2.6), 'cloth', P.color || '#e53935', 0, 2.65, -0.1, -0.12);
    for (const sx of [-1, 1]) part(g, new THREE.CylinderGeometry(0.04, 0.04, 2.6, 6), 'chrome', '#999', sx * 1.7, 1.3, 1.0);
    part(g, new THREE.CylinderGeometry(0.28, 0.24, 0.35, 14), 'chrome', '#bbb', -0.8, 1.18, 0.1);
    part(g, new THREE.CylinderGeometry(0.2, 0.2, 0.06, 14), 'gunmetal', '#333', 0.6, 1.03, 0.2);
    for (let k = 0; k < 3; k++) part(g, new THREE.CylinderGeometry(0.2, 0.2, 0.45, 10), 'plastic', '#1565c0', -1 + k, 0.22, 1.3);
    modelAt(ctx, g, P.x, H(ctx, P.x, P.z), P.z, ry, true, 0.85);
    board(ctx, P.x + fx * 0.3, H(ctx, P.x, P.z) + 3.25, P.z + fz * 0.3, ry, 3.6, 0.9, P.sign, { bg: '#10141c', color: P.color || '#ffb000', color2: '#ffffff', glow: true, sizes: [0.46, 0.3], glowI: ctx.night ? 1.4 : 0.7 });
    ctx.loot.push({ x: P.x + fx * 1.8, y: H(ctx, P.x + fx * 1.8, P.z + fz * 1.8) + 0.05, z: P.z + fz * 1.8, tier: 0, food: true });
    addEgg(ctx, P.egg, P.x + fx * 2, P.z + fz * 2);
  },
  pothole(ctx, P) {
    const g = H(ctx, P.x, P.z);
    const m = new THREE.Mesh(new THREE.CircleGeometry(1.6, 20), ctx.potholeMat);
    m.rotation.x = -PI / 2; m.position.set(P.x, g + 0.1, P.z); ctx.group.add(m);
    ctx.potholes.push({ x: P.x, z: P.z, r: 1.8 });
    addEgg(ctx, P.egg, P.x, P.z);
  },
  coder_bike(ctx, P) {
    const ry = rotY(P.rot), g = H(ctx, P.x, P.z);
    const b = bike('#1565c0');
    const f = figure({ shirt: '#263238', pants: '#1a237e', pose: 'stand' });
    f.position.set(0, 0.4, -0.25); f.scale.setScalar(0.95); b.add(f);
    part(b, new THREE.BoxGeometry(0.34, 0.02, 0.24), 'plastic', '#222', 0, 1.3, 0.3);
    part(b, new THREE.BoxGeometry(0.34, 0.22, 0.02), 'lamp', '#8ab4ff', 0, 1.42, 0.42, -0.3);
    modelAt(ctx, b, P.x, g, P.z, ry, true, 0.7);
    addEgg(ctx, P.egg, P.x, P.z);
  },
  billboard(ctx, P) {
    const ry = rotY(P.rot), g = H(ctx, P.x, P.z);
    const s = Math.cos(ry), c = Math.sin(ry);
    for (const o of [-4, 4]) cyl(ctx, P.x + s * o, g, P.z - c * o, 0.25, 0.3, 9, 'metal', col('#555'), 8);
    board(ctx, P.x, g + 11, P.z, ry, 12, 5, P.text, { bg: '#07090d', color: P.neon || '#2de2e6', color2: '#e8ecf5', glow: true, sizes: [0.32, 0.16], glowI: ctx.night ? 1.5 : 0.8 });
    const [fx, fz] = fwd(ry);
    const nc = col(P.neon || '#2de2e6').map((v) => v * 3);
    G(ctx, new THREE.BoxGeometry(12.4, 0.12, 0.12), 'neon', nc, P.x + fx * 0.05, g + 13.55, P.z + fz * 0.05, ry);
    G(ctx, new THREE.BoxGeometry(12.4, 0.12, 0.12), 'neon', nc, P.x + fx * 0.05, g + 8.45, P.z + fz * 0.05, ry);
    addEgg(ctx, P.egg, P.x + fx * 6, P.z + fz * 6);
  },
  banner(ctx, P) {
    const ry = rotY(P.rot), g = H(ctx, P.x, P.z);
    const s = Math.cos(ry), c = Math.sin(ry);
    for (const o of [-6, 6]) cyl(ctx, P.x + s * o, g, P.z - c * o, 0.1, 0.12, 6, 'metal', col('#666'), 8);
    board(ctx, P.x, g + 4.6, P.z, ry, 11.5, 2, P.text, { bg: P.bg || '#fdd835', color: P.fg || '#b71c1c', color2: P.fg || '#1a1a1a', sizes: [0.45, 0.32], glowI: 0.3, noBack: true });
    board(ctx, P.x, g + 4.6, P.z, ry + PI, 11.5, 2, P.text, { bg: P.bg || '#fdd835', color: P.fg || '#b71c1c', color2: P.fg || '#1a1a1a', sizes: [0.45, 0.32], glowI: 0.3, noBack: true });
    addEgg(ctx, P.egg, P.x, P.z);
  },
  auto_sign(ctx, P) {
    const ry = rotY(P.rot), g = H(ctx, P.x, P.z);
    modelAt(ctx, autoRickshaw(), P.x, g, P.z, ry, true, 0.85);
    const f = figure({ shirt: '#bca06a', pants: '#bca06a', pose: 'stand' });
    modelAt(ctx, f, P.x + Math.cos(ry) * 1.3, g, P.z - Math.sin(ry) * 1.3, ry, false);
    const [fx, fz] = fwd(ry);
    board(ctx, P.x - fx * 1.6, g + 1.7, P.z - fz * 1.6, ry + PI, 1.6, 0.8, P.text, { bg: '#fdd835', color: '#1b1b1b', color2: '#333', sizes: [0.4, 0.28], glowI: 0.2 });
    addEgg(ctx, P.egg, P.x, P.z);
  },
  sign(ctx, P) {
    const ry = rotY(P.rot), g = H(ctx, P.x, P.z);
    const s = Math.cos(ry), c = Math.sin(ry);
    for (const o of [-1.4, 1.4]) cyl(ctx, P.x + s * o, g, P.z - c * o, 0.06, 0.06, 2.6, 'metal', col('#666'), 6);
    board(ctx, P.x, g + 2.4, P.z, ry, 3.4, 1.5, P.text, { bg: '#0d47a1', color: '#ffffff', color2: '#bbdefb', sizes: [0.36, 0.24], glowI: ctx.night ? 0.9 : 0.25 });
    addEgg(ctx, P.egg, P.x, P.z);
  },
  foam(ctx, P) {
    const lvl = ctx.phys.waterLevel(P.x, P.z);
    const rng = ctx.rng;
    const geo = new THREE.SphereGeometry(1, 8, 6);
    const n = 160;
    const inst = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0xf4f6f8, roughness: 0.9, emissive: 0x222222 }), n);
    const m = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      const a = rng() * PI * 2, r = Math.sqrt(rng()) * 60;
      const s = 0.6 + rng() * 2.2;
      m.makeScale(s * 1.3, s * 0.5, s * 1.3); m.setPosition(P.x + Math.cos(a) * r, (lvl > -1e9 ? lvl : 0) + s * 0.1, P.z + Math.sin(a) * r);
      inst.setMatrixAt(i, m);
    }
    ctx.group.add(inst);
    addEgg(ctx, P.egg, P.x, P.z);
  },
  jam(ctx, P) {
    vehicleRow(ctx, P.x, P.z, P.len || 60, P.dir || 'x', undefined, 0.9, 2, 3.3);
    addEgg(ctx, P.egg, P.x, P.z);
  },
  gulf_house(ctx, P) {
    shell(ctx, { cx: P.x, cz: P.z, w: 14, d: 11, rot: 0, floors: 2, wallCol: col('#e8c96a'), trimCol: col('#fff3c4'), roof: 'flat', balcony: true, grills: true, lootTier: 1, compound: { mat: 'plaster', col: col('#f5e6b8') } });
    for (const o of [-3, 3]) modelAt(ctx, car(o < 0 ? '#ffffff' : '#212121', 'suv'), P.x + o, H(ctx, P.x + o, P.z + 11), P.z + 11, 0, true, 0.8);
    addEgg(ctx, P.egg, P.x, P.z + 14);
  },
  tanker(ctx, P) {
    const ry = rotY(P.rot), g = H(ctx, P.x, P.z);
    modelAt(ctx, tanker('#1565c0'), P.x, g, P.z, ry, true, 0.85);
    const pc = ['#e53935', '#1e88e5', '#fdd835', '#43a047', '#8e24aa', '#fb8c00'];
    for (let k = 0; k < 18; k++) {
      const x = P.x + 2.5 + (k % 9) * 0.8, z = P.z - 3 + Math.floor(k / 9) * 0.9;
      G(ctx, new THREE.CylinderGeometry(0.22, 0.3, 0.55, 12), 'plastic', col(pc[k % pc.length]), x, H(ctx, x, z) + 0.28, z);
    }
    addEgg(ctx, P.egg, P.x, P.z);
  },
  harthal(ctx, P) {
    ctx.harthalZone = { x: P.x, z: P.z, r: 160 };
    addEgg(ctx, P.egg, P.x, P.z);
  },
  bus(ctx, P) {
    const ry = rotY(P.rot);
    modelAt(ctx, bus('#c62828', '#f5e6c8'), P.x, H(ctx, P.x, P.z), P.z, ry, true, 0.9);
    const [fx, fz] = fwd(ry);
    board(ctx, P.x + fx * 5.4, H(ctx, P.x, P.z) + 3.3, P.z + fz * 5.4, ry, 2.2, 0.4, ['KSRTC · FAST PASSENGER'], { bg: '#111', color: '#ffb000', sizes: [0.7], glowI: 1.2, noBack: true });
    addEgg(ctx, P.egg, P.x, P.z);
  },
  puli(ctx, P) {
    const g = H(ctx, P.x, P.z);
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * PI * 2;
      const f = figure({ skin: '#f9a825', shirt: '#f9a825', pants: '#f9a825', stripes: true, pose: 'dance' });
      modelAt(ctx, f, P.x + Math.cos(a) * 3, g, P.z + Math.sin(a) * 3, -a, true, 0.5);
    }
    addEgg(ctx, P.egg, P.x, P.z);
  },
  bank(ctx, P) {
    const F = shell(ctx, { cx: P.x, cz: P.z, w: 14, d: 10, rot: 0, floors: 2, wallCol: col('#e8e2d0'), roof: 'flat', lootTier: 1, grills: true });
    const [fx, fz] = F.w(0, 5.2);
    board(ctx, fx, F.base + 3.6, fz, 0, 8, 1.2, ['BANK · EST. 1920', 'Gold loan in 5 minutes'], { bg: '#1a237e', color: '#ffd54f', color2: '#ffffff', sizes: [0.44, 0.3], glowI: 0.6 });
    addEgg(ctx, P.egg, fx, fz + 3);
  },
  kudamattam(ctx, P) {
    const g = H(ctx, P.x, P.z);
    const uc = ['#e53935', '#fdd835', '#43a047', '#1e88e5', '#8e24aa', '#fb8c00', '#ec407a', '#26c6da'];
    for (let k = 0; k < 14; k++) {
      const x = P.x - 13 + k * 2, z = P.z;
      cyl(ctx, x, g, z, 0.03, 0.03, 4.5, 'gunwood', col('#5d4037'), 6, false);
      G(ctx, new THREE.ConeGeometry(0.9, 0.55, 18), ctx.night ? 'lamp' : 'cloth', col(uc[k % uc.length]), x, g + 4.9, z);
      G(ctx, new THREE.CylinderGeometry(0.92, 0.92, 0.3, 18, 1, true), 'cloth', col(uc[(k + 3) % uc.length]), x, g + 4.5, z);
    }
    addEgg(ctx, P.egg, P.x, P.z);
  },
  aqi(ctx, P) {
    const ry = rotY(P.rot), g = H(ctx, P.x, P.z);
    cyl(ctx, P.x, g, P.z, 0.15, 0.15, 3, 'metal', col('#555'), 8);
    board(ctx, P.x, g + 3.8, P.z, ry, 3.6, 1.8, ['AQI 999', 'SEVERE+ · DON\'T BREATHE'], { bg: '#000000', color: '#ff1744', color2: '#ffab00', glow: true, sizes: [0.5, 0.2], glowI: 1.6, font: '700 {s}px "Courier New", monospace' });
    addEgg(ctx, P.egg, P.x, P.z);
  },
  suv(ctx, P) {
    const ry = rotY(P.rot), g = H(ctx, P.x, P.z);
    modelAt(ctx, car('#111111', 'suv'), P.x, g, P.z, ry, true, 0.85);
    const [fx, fz] = fwd(ry);
    board(ctx, P.x - fx * 2.33, g + 1.25, P.z - fz * 2.33, ry + PI, 1.3, 0.28, ['TU JAANTA NAHI MERA BAAP KAUN HAI?'], { bg: '#ffffff', color: '#b71c1c', sizes: [0.7], glowI: 0.2, noBack: true });
    addEgg(ctx, P.egg, P.x, P.z);
  },
  wires(ctx, P) {
    const rng = ctx.rng;
    const poles = [];
    for (let k = 0; k < 7; k++) {
      const x = P.x + (rng() - 0.5) * 50, z = P.z + (rng() - 0.5) * 50, g = H(ctx, x, z);
      cyl(ctx, x, g, z, 0.12, 0.15, 8, 'concrete', col('#8d887e'), 8);
      poles.push(new THREE.Vector3(x, g + 7.6, z));
    }
    const pos = [];
    for (let k = 0; k < 120; k++) {
      const a = rng.pick(poles), b = rng.pick(poles);
      if (a === b) continue;
      const sag = 0.5 + rng() * 2.5, dy = (rng() - 0.5) * 1.2;
      let prev = a.clone();
      for (let i = 1; i <= 8; i++) {
        const t = i / 8;
        const p = a.clone().lerp(b, t); p.y += dy * t - Math.sin(t * PI) * sag;
        pos.push(prev.x, prev.y, prev.z, p.x, p.y, p.z); prev = p;
      }
    }
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    ctx.group.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x111111 })));
    addEgg(ctx, P.egg, P.x, P.z);
  },
  parking_fight(ctx, P) {
    const g = H(ctx, P.x, P.z);
    modelAt(ctx, car('#eeeeee', 'sedan'), P.x - 2.4, g, P.z, PI / 2, true, 0.85);
    modelAt(ctx, car('#c62828', 'suv'), P.x + 2.5, g, P.z, -PI / 2, true, 0.85);
    for (const [x, c] of [[-4.5, '#1565c0'], [4.8, '#2e7d32'], [0, '#6d4c41']]) modelAt(ctx, figure({ shirt: c, pose: 'dance' }), P.x + x, g, P.z + 2.2, 0, false);
    addEgg(ctx, P.egg, P.x, P.z);
  },
  baraat(ctx, P) {
    const g = H(ctx, P.x, P.z);
    const h = quadruped('horse');
    const groom = figure({ shirt: '#fff3e0', pants: '#fff3e0', cap: '#d4af37' }); groom.position.set(0, 1.35, 0); h.add(groom);
    modelAt(ctx, h, P.x, g, P.z, PI / 2, true, 0.7);
    const rng = ctx.rng;
    for (let k = 0; k < 14; k++) {
      const x = P.x - 3 - (k % 7) * 1.6, z = P.z - 2 + Math.floor(k / 7) * 2.4;
      modelAt(ctx, figure({ shirt: rng.pick(['#e91e63', '#ff9800', '#9c27b0', '#fdd835', '#b71c1c']), pose: 'dance' }), x, H(ctx, x, z), z, PI / 2, false);
    }
    for (let k = 0; k < 6; k++) {
      const x = P.x - 2 - k * 2.5, z = P.z + (k % 2 ? 3.6 : -3.6);
      cyl(ctx, x, H(ctx, x, z), z, 0.04, 0.04, 2.4, 'chrome', col('#ccc'), 6, false);
      G(ctx, new THREE.SphereGeometry(0.28, 10, 8), 'lamp', col('#fff1c0'), x, H(ctx, x, z) + 2.6, z);
    }
    addEgg(ctx, P.egg, P.x, P.z);
  },
  cows(ctx, P) {
    const rng = ctx.rng;
    for (let k = 0; k < (P.n || 3); k++) {
      const x = P.x + (rng() - 0.5) * 10, z = P.z + (rng() - 0.5) * 10;
      modelAt(ctx, quadruped('cow'), x, H(ctx, x, z), z, rng() * PI * 2, true, 0.6);
    }
    addEgg(ctx, P.egg, P.x, P.z);
  },
  boat(ctx, P) {
    const lvl = ctx.phys.waterLevel(P.x, P.z);
    const y = lvl > -1e9 ? lvl - 0.25 : H(ctx, P.x, P.z);
    const b = boatModel('#8d6e63');
    if (P.clear) b.position.y = 0;
    modelAt(ctx, b, P.x, y, P.z, ctx.rng() * PI, false);
    const f = figure({ shirt: '#1565c0', lungi: '#eceff1' });
    modelAt(ctx, f, P.x, y + 0.5, P.z, 0, false);
    addEgg(ctx, P.egg, P.x, P.z, y + 0.6);
  },
  knup(ctx, P) {
    const g = H(ctx, P.x, P.z);
    const f = figure({ shirt: '#8d6e63', lungi: '#6d4c41' });
    part(f, new THREE.SphereGeometry(0.75, 14, 8, 0, PI * 2, 0, PI / 2.2), 'cloth', '#c8a86b', 0, 1.2, 0.2, -1.1, 0, 0, 1, 1.2, 0.8);
    modelAt(ctx, f, P.x, g, P.z, 0.4, true, 0.6);
    addEgg(ctx, P.egg, P.x, P.z);
  },
  football(ctx, P) {
    const g = H(ctx, P.x, P.z);
    for (const sz of [-1, 1]) {
      const z = P.z + sz * 22;
      BX(ctx, P.x - 3.7, g, z - 0.06, P.x - 3.5, g + 2.44, z + 0.06, 'paint', col('#fff'), SURF.metal);
      BX(ctx, P.x + 3.5, g, z - 0.06, P.x + 3.7, g + 2.44, z + 0.06, 'paint', col('#fff'), SURF.metal);
      BX(ctx, P.x - 3.7, g + 2.34, z - 0.06, P.x + 3.7, g + 2.46, z + 0.06, 'paint', col('#fff'), SURF.metal);
    }
    G(ctx, new THREE.SphereGeometry(0.11, 12, 8), 'plastic', col('#f5f5f5'), P.x, g + 0.11, P.z);
    addEgg(ctx, P.egg, P.x, P.z);
  },
  ordered_jam(ctx, P) {
    // perfectly aligned single file on the left of the ridge road, other lane empty
    let best = null;
    for (const r of ctx.roads) for (let i = 0; i < r.pts.length - 1; i++) {
      const a = r.pts[i], b = r.pts[i + 1];
      const s = segDist(P.x, P.z, a[0], a[1], b[0], b[1]);
      if (!best || s.d < best.d) best = { d: s.d, a, b };
    }
    if (best) {
      const [a, b] = [best.a, best.b];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]), dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L;
      const ang = Math.atan2(dx, dz);
      let s = 4;
      while (s < L - 4) {
        const v = randomVehicle(ctx.rng, ['car', 'car', 'suv', 'bike', 'bike']);
        const x = a[0] + dx * (s + v.len / 2) - dz * 2.2, z = a[1] + dz * (s + v.len / 2) + dx * 2.2;
        modelAt(ctx, v.g, x, H(ctx, x, z), z, ang, true, 0.6);
        s += v.len + 1.6;
      }
    }
    addEgg(ctx, P.egg, P.x, P.z);
  },
  bamboo(ctx, P) {
    const g = H(ctx, P.x, P.z);
    for (let k = 0; k < 6; k++) G(ctx, new THREE.CylinderGeometry(0.05, 0.05, 8, 6), 'gunwood', col('#b5a150'), P.x, g + 0.08, P.z - 5 + k * 2, 0, null, 0, PI / 2);
    for (const sx of [-1, 1]) G(ctx, new THREE.CylinderGeometry(0.07, 0.07, 11, 6), 'gunwood', col('#8d7a3a'), P.x + sx * 4.2, g + 0.1, P.z, 0, null, PI / 2, 0);
    const rng = ctx.rng;
    for (let k = 0; k < 6; k++) modelAt(ctx, figure({ shirt: rng.pick(['#c62828', '#1a1a1a', '#f5f5f5']), lungi: rng.pick(['#c62828', '#1a1a1a']), pose: 'dance' }), P.x - 3 + (k % 3) * 3, g, P.z - 3 + Math.floor(k / 3) * 6, rng() * 6, false);
    addEgg(ctx, P.egg, P.x, P.z);
  },
  honesty_shop(ctx, P) {
    const g = H(ctx, P.x, P.z);
    BX(ctx, P.x - 1.6, g, P.z - 0.8, P.x + 1.6, g + 0.9, P.z + 0.8, 'wood', col('#b89a5a'), SURF.wood);
    for (const [a, b2] of [[-1.6, -0.8], [1.6, -0.8], [-1.6, 0.8], [1.6, 0.8]]) cyl(ctx, P.x + a, g, P.z + b2, 0.05, 0.05, 2.4, 'gunwood', col('#8d7a3a'), 6, false);
    G(ctx, new THREE.ConeGeometry(2.4, 0.9, 4), 'wood', col('#a88c52'), P.x, g + 2.7, P.z, PI / 4, [1, 1, 0.6]);
    for (let k = 0; k < 4; k++) G(ctx, new THREE.CylinderGeometry(0.28, 0.22, 0.25, 10), 'gunwood', col('#c8a86b'), P.x - 1.1 + k * 0.72, g + 1.02, P.z);
    BX(ctx, P.x + 1.1, g + 0.9, P.z + 0.4, P.x + 1.4, g + 1.15, P.z + 0.65, 'paint', col('#c62828'), SURF.metal, false);
    board(ctx, P.x, g + 1.8, P.z + 0.85, 0, 2.6, 0.6, ['NGHAH LOH DAWR', 'No shopkeeper · honesty only'], { bg: '#f5f0e0', color: '#1b5e20', color2: '#333', sizes: [0.42, 0.28], glowI: 0.15, noBack: true });
    for (let k = 0; k < 3; k++) ctx.loot.push({ x: P.x - 1 + k, y: g + 0.95, z: P.z, tier: 0, boost: true });
    addEgg(ctx, P.egg, P.x, P.z + 2);
  },
  chilli_stall(ctx, P) {
    PB.stall(ctx, { x: P.x, z: P.z, rot: P.rot || 0, sign: ['RAJA MIRCHA', '1,000,000 Scoville · eat at own risk'], color: '#ff1744' });
    const g = H(ctx, P.x, P.z);
    for (let k = 0; k < 30; k++) G(ctx, new THREE.ConeGeometry(0.03, 0.12, 6), 'plastic', col(k % 5 ? '#d50000' : '#ff6d00'), P.x - 1 + (k % 10) * 0.2, g + 1.05, P.z + 0.1 + Math.floor(k / 10) * 0.12, 0, null, PI / 2);
    for (let k = 0; k < 3; k++) ctx.loot.push({ x: P.x - 1 + k, y: g + 0.05, z: P.z + 2.2, tier: 0, chilli: true });
    addEgg(ctx, P.egg, P.x, P.z + 2.5);
  },
  log_drum(ctx, P) {
    const g = H(ctx, P.x, P.z);
    G(ctx, new THREE.CylinderGeometry(0.9, 1.0, 12, 16), 'gunwood', col('#4e342e'), P.x, g + 1.2, P.z, 0, null, 0, PI / 2);
    ctx.phys.addBox(P.x - 6, g, P.z - 0.9, P.x + 6, g + 2.1, P.z + 0.9, SURF.wood);
    G(ctx, new THREE.SphereGeometry(1.0, 12, 8), 'gunwood', col('#3e2723'), P.x + 6.2, g + 1.4, P.z, 0, [0.6, 1, 1]);
    for (const [a, b2] of [[-6, -2.5], [6, -2.5], [-6, 2.5], [6, 2.5]]) cyl(ctx, P.x + a, g, P.z + b2, 0.12, 0.12, 4, 'gunwood', col('#5d4037'), 6);
    BX(ctx, P.x - 6.8, g + 4, P.z - 3.2, P.x + 6.8, g + 4.3, P.z + 3.2, 'wood', col('#b09a6a'), SURF.wood);
    addEgg(ctx, P.egg, P.x, P.z + 3);
  },
  lights(ctx, P) {
    const rng = ctx.rng;
    const cols = ['#fff176', '#ff5252', '#69f0ae', '#40c4ff', '#ffffff'];
    const inst = new THREE.InstancedMesh(new THREE.SphereGeometry(0.09, 6, 4), new THREE.MeshBasicMaterial({ toneMapped: false }), 600);
    const m = new THREE.Matrix4(), c = new THREE.Color();
    let n = 0;
    for (let s = 0; s < 14 && n < 600; s++) {
      const a = new THREE.Vector3(P.x + (rng() - 0.5) * 60, 0, P.z + (rng() - 0.5) * 60);
      const b = new THREE.Vector3(a.x + (rng() - 0.5) * 30, 0, a.z + (rng() - 0.5) * 30);
      a.y = H(ctx, a.x, a.z) + 6 + rng() * 3; b.y = H(ctx, b.x, b.z) + 6 + rng() * 3;
      for (let i = 0; i <= 40 && n < 600; i++) {
        const t = i / 40; const p = a.clone().lerp(b, t); p.y -= Math.sin(t * PI) * 1.5;
        m.makeTranslation(p.x, p.y, p.z); inst.setMatrixAt(n, m);
        c.set(cols[n % cols.length]).multiplyScalar(3); inst.setColorAt(n, c); n++;
      }
      // a hanging star
      const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.6), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.6, 1.2), toneMapped: false }));
      star.position.copy(a).lerp(b, 0.5); star.position.y -= 2.4; ctx.group.add(star);
    }
    inst.count = n; ctx.group.add(inst);
    addEgg(ctx, P.egg, P.x, P.z);
  },
  bikers(ctx, P) {
    const g = H(ctx, P.x, P.z);
    for (let k = 0; k < 5; k++) {
      const b = bike(ctx.rng.pick(['#212121', '#1b5e20', '#b71c1c', '#37474f']));
      const f = figure({ shirt: ctx.rng.pick(['#263238', '#3e2723', '#bf360c']), pants: '#263238' }); f.position.set(0, 0.35, -0.2); b.add(f);
      part(b, new THREE.BoxGeometry(0.6, 0.35, 0.5), 'cloth', '#4e342e', 0, 1.05, -0.8);
      modelAt(ctx, b, P.x - 6 + k * 2.4, g, P.z, 0.2, true, 0.6);
    }
    addEgg(ctx, P.egg, P.x, P.z);
  },
  snow_leopard(ctx, P) {
    const g = H(ctx, P.x, P.z);
    BX(ctx, P.x - 2, g - 0.5, P.z - 1.5, P.x + 2, g + 1.4, P.z + 1.5, 'rock', col('#8a8680'));
    modelAt(ctx, quadruped('leopard'), P.x, g + 1.4, P.z, 1.2, false);
    addEgg(ctx, P.egg, P.x, P.z);
  },
  yaks(ctx, P) {
    const rng = ctx.rng;
    for (let k = 0; k < (P.n || 4); k++) {
      const x = P.x + (rng() - 0.5) * 12, z = P.z + (rng() - 0.5) * 8;
      modelAt(ctx, quadruped('yak'), x, H(ctx, x, z), z, rng() * PI * 2, true, 0.6);
    }
    addEgg(ctx, P.egg, P.x, P.z);
  },
  flags(ctx, P) {
    const rng = ctx.rng;
    const cols = ['#1e40af', '#f5f5f5', '#dc2626', '#16a34a', '#facc15'];
    const inst = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.34, 0.42), new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.9 }), 400);
    const m = new THREE.Matrix4(), c = new THREE.Color(), q = new THREE.Quaternion();
    let n = 0;
    const g0 = H(ctx, P.x, P.z);
    cyl(ctx, P.x, g0, P.z, 0.08, 0.1, 7, 'gunwood', col('#5d4037'), 6);
    for (let s = 0; s < 6; s++) {
      const a = new THREE.Vector3(P.x, g0 + 6.8, P.z);
      const ang = (s / 6) * PI * 2 + rng();
      const b = new THREE.Vector3(P.x + Math.cos(ang) * 16, 0, P.z + Math.sin(ang) * 16);
      b.y = H(ctx, b.x, b.z) + 0.6;
      const L = a.distanceTo(b), k = Math.floor(L / 0.45);
      q.setFromEuler(new THREE.Euler(0, -ang, 0));
      for (let i = 1; i < k && n < 400; i++) {
        const t = i / k; const p = a.clone().lerp(b, t); p.y -= Math.sin(t * PI) * 1.2 + 0.2;
        m.compose(p, q, new THREE.Vector3(1, 1, 1)); inst.setMatrixAt(n, m); c.set(cols[n % 5]); inst.setColorAt(n, c); n++;
      }
    }
    inst.count = n; ctx.group.add(inst);
    addEgg(ctx, P.egg, P.x, P.z);
  },
};

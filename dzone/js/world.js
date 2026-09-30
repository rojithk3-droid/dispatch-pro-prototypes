// World generation: heightfield terrain (splat-blended photo textures), roads + bridges, water, districts of
// procedural buildings, landmarks, easter-egg props, instanced vegetation, GPU grass and a minimap image.
import * as THREE from 'three';
import { Physics, HALF, SURF, setWorldHalf } from './physics.js';
import { generateOSMWorld } from './osmworld.js';
import { GeoBuilder, col, WHITE } from './geo.js';
import { Frame, SignAtlas, buildArchetype, container } from './buildings.js';
import { buildLandmark, buildProp, LANDMARK_PAD, PROP_PAD, board } from './landmarks.js';
import { MM, initModelMats, mergeGroup, car, autoRickshaw, bike } from './models.js';
import { createMaterials, loadTerrainLayers, facadeTextures, foliageTexture, waterNormals, MATDEFS } from './assets.js';
import { hashStr, mulberry32, makeNoise, clamp, lerp, smooth, segDist } from './util.js';

const PLACE_NAMES = {
  bangalore: ['MG Road', 'Brigade Road', 'Malleshwaram', 'Koramangala', 'Whitefield', 'Jayanagar', 'Peenya'],
  kochi: ['Fort Kochi', 'MG Road', 'Ernakulam', 'Kakkanad', 'Edappally', 'Vyttila'],
  chennai: ['George Town', 'T. Nagar', 'Mylapore', 'Anna Nagar', 'OMR', 'Guindy'],
  trivandrum: ['Chalai', 'Sasthamangalam', 'Palayam', 'Technopark', 'Vizhinjam', 'Kowdiar'],
  thrissur: ['Shakthan', 'Poonkunnam', 'Ayyanthole', 'Ollur', 'Kuriachira'],
  delhi: ['Chandni Chowk', 'Lutyens', 'Chanakyapuri', 'Karol Bagh', 'Hauz Khas', 'Paharganj'],
  gurugram: ['DLF Phase 5', 'Cyber City', 'Golf Course Rd', 'Old Gurgaon', 'Sector 29', 'Sohna Road', 'Udyog Vihar'],
  meghalaya: ['Shillong', 'Mawlynnong', 'Sohra', 'Laitlum', 'Dawki'],
  aizawl: ['Chanmari', 'Bara Bazar', 'Durtlang', 'Zarkawt', 'Reiek', 'Sairang'],
  nagaland: ['Kohima Town', 'Jotsoma', 'Khonoma', 'Kigwema'],
  spiti: ['Kaza', 'Kibber', 'Langza', 'Hikkim'],
};

const GRID_STYLES = new Set(['urban', 'shops', 'oldhouse', 'kerala', 'colonial', 'bungalow', 'oldcity', 'techpark', 'glass', 'condo', 'industrial']);

// archetype -> [minW,maxW,minD,maxD, extra margin]
const SIZES = {
  house: [8, 12, 8, 11, 1], apartment: [12, 16, 11, 14, 1], shop: [10, 16, 9, 12, 0.6], oldhouse: [9, 12, 8, 10, 1.5],
  kerala: [9, 12, 8, 10, 3.2], colonial: [12, 16, 10, 12, 1.2], bungalow: [14, 17, 12, 13, 3.4], oldcity: [6.5, 9, 9, 12, 0.3],
  office: [18, 24, 12, 16, 2], tower: [16, 26, 16, 26, 3], warehouse: [18, 24, 24, 30, 2], hill: [7, 9, 7.6, 10, 1.2],
  hut: [5, 7, 4.6, 6, 1.5], spiti: [7, 10, 7.6, 9, 1.5],
};
const STYLE_MIX = {
  urban: [['house', 0.5], ['apartment', 0.25], ['shop', 0.25]],
  shops: [['shop', 0.8], ['apartment', 0.2]],
  oldhouse: [['oldhouse', 0.8], ['house', 0.2]],
  kerala: [['kerala', 0.85], ['shop', 0.15]],
  colonial: [['colonial', 0.7], ['shop', 0.3]],
  bungalow: [['bungalow', 1]],
  oldcity: [['oldcity', 1]],
  techpark: [['tower', 0.4], ['office', 0.6]],
  glass: [['tower', 0.7], ['office', 0.3]],
  condo: [['tower', 0.6], ['apartment', 0.4]],
  industrial: [['warehouse', 0.75], ['house', 0.25]],
  hill: [['hill', 0.85], ['shop', 0.15]],
  village: [['hut', 0.8], ['house', 0.2]],
  spiti: [['spiti', 1]],
};

// ------------------------------------------------------------------ occupancy grid (2 m cells)
export class Occ {
  constructor() { this.c = 2; this.n = Math.ceil((HALF * 2) / this.c); this.a = new Uint8Array(this.n * this.n); }
  idx(x, z) { return [Math.floor((x + HALF) / this.c), Math.floor((z + HALF) / this.c)]; }
  mark(x0, z0, x1, z1, v = 1) {
    const [i0, j0] = this.idx(x0, z0), [i1, j1] = this.idx(x1, z1);
    for (let j = Math.max(0, j0); j <= Math.min(this.n - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(this.n - 1, i1); i++) this.a[j * this.n + i] = Math.max(this.a[j * this.n + i], v);
  }
  markCircle(x, z, r, v = 1) {
    const [i0, j0] = this.idx(x - r, z - r), [i1, j1] = this.idx(x + r, z + r);
    for (let j = Math.max(0, j0); j <= Math.min(this.n - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(this.n - 1, i1); i++) {
      const cx = -HALF + (i + 0.5) * this.c, cz = -HALF + (j + 0.5) * this.c;
      if ((cx - x) ** 2 + (cz - z) ** 2 < r * r) this.a[j * this.n + i] = Math.max(this.a[j * this.n + i], v);
    }
  }
  free(x0, z0, x1, z1) {
    if (x0 < -HALF + 6 || z0 < -HALF + 6 || x1 > HALF - 6 || z1 > HALF - 6) return false;
    const [i0, j0] = this.idx(x0, z0), [i1, j1] = this.idx(x1, z1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (this.a[j * this.n + i]) return false;
    return true;
  }
  at(x, z) { const [i, j] = this.idx(x, z); if (i < 0 || j < 0 || i >= this.n || j >= this.n) return 1; return this.a[j * this.n + i]; }
}

export function polyDist(x, z, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) { const s = segDist(x, z, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]); if (s.d < best) best = s.d; }
  return best;
}
export function densify(pts, step) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(L / step));
    for (let k = 0; k < n; k++) out.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
  }
  out.push([...pts[pts.length - 1]]);
  return out;
}

// ================================================================== main entry
export async function generateWorld(map, opts = {}) {
  setWorldHalf(map.half || 512);
  if (map.osm) return generateOSMWorld(map, opts);
  const t0 = performance.now();
  const progress = opts.onProgress || (() => {});
  const quality = opts.quality || 'medium';
  const seed = hashStr(map.id);
  const rng = mulberry32(seed);
  const noise = makeNoise(seed + 7);
  const phys = new Physics(384);
  initModelMats();
  const group = new THREE.Group(); group.name = 'world';
  const night = !!map.night;

  // ---------------------------------------------------------------- roads list
  const roads = map.roads.map((r) => ({ ...r, pts: r.pts.map((p) => [...p]) }));
  const ring = (x, z, r, w) => { const pts = []; for (let i = 0; i <= 48; i++) { const a = (i / 48) * Math.PI * 2; pts.push([x + Math.cos(a) * r, z + Math.sin(a) * r]); } roads.push({ pts, w, ring: true }); };
  if (map.ringRoad) ring(map.ringRoad.x, map.ringRoad.z, map.ringRoad.r, map.ringRoad.w);
  for (const L of map.landmarks) if (L.kind === 'cp_circle') { ring(L.x, L.z, (L.r || 80) * 0.62, 12); ring(L.x, L.z, (L.r || 80) * 1.38, 12); }
  const mainRoads = roads.slice();
  for (const D of map.districts) {
    if (!GRID_STYLES.has(D.style)) continue;
    const sw = D.style === 'oldcity' ? 6 : D.style === 'bungalow' ? 10 : 8;
    const x0 = D.x - D.w / 2, x1 = D.x + D.w / 2, z0 = D.z - D.d / 2, z1 = D.z + D.d / 2;
    D.xs = []; D.zs = [];
    for (let x = x0; x <= x1 + 0.1; x += D.block) D.xs.push(x);
    for (let z = z0; z <= z1 + 0.1; z += D.block) D.zs.push(z);
    D.sw = sw;
    const nearMain = (pts) => mainRoads.some((r) => { const mid = [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2]; return polyDist(mid[0], mid[1], r.pts) < 10 && polyDist(pts[0][0], pts[0][1], r.pts) < 10; });
    for (const x of D.xs) { const pts = [[x, z0], [x, z1]]; if (!nearMain(pts)) roads.push({ pts, w: sw, street: true }); }
    for (const z of D.zs) { const pts = [[x0, z], [x1, z]]; if (!nearMain(pts)) roads.push({ pts, w: sw, street: true }); }
  }

  // ---------------------------------------------------------------- heightfield
  progress(0.02, 'Shaping terrain');
  const T = map.terrain;
  const ridgeLine = map.roads[0].pts;
  const riverLine = map.rivers && map.rivers[0] ? map.rivers[0].pts : null;
  function natural(x, z) {
    const f = T.freq;
    switch (T.kind) {
      case 'hills': return T.base + T.amp * (0.6 * noise.fbm(x * f, z * f, 5) + 0.5 * (noise.ridged(x * f * 0.7 + 11, z * f * 0.7 - 5, 4) - 0.55));
      case 'ridges': {
        const d = polyDist(x, z, ridgeLine), r = Math.exp(-(d * d) / (2 * 120 * 120));
        return T.base + T.amp * (0.7 * r + 0.5 * noise.ridged(x * f, z * f, 5) * (0.35 + 0.65 * r) - 0.25) + 6 * noise.fbm(x * f * 3, z * f * 3, 3);
      }
      case 'valley': {
        const d = riverLine ? polyDist(x, z, riverLine) : Math.abs(z);
        const s = smooth(40, 380, d);
        return T.base + T.amp * Math.pow(s, 1.25) * (0.55 + 0.45 * noise.ridged(x * f, z * f, 5)) + 5 * noise.fbm(x * f * 4, z * f * 4, 3);
      }
      default: return T.base + T.amp * noise.fbm(x * f, z * f, 4);
    }
  }
  const R = phys.res, C = phys.cellM, W1 = R + 1;
  const hm = phys.h;
  for (let j = 0; j <= R; j++) for (let i = 0; i <= R; i++) hm[j * W1 + i] = natural(-HALF + i * C, -HALF + j * C);
  const eachCell = (x0, z0, x1, z1, fn) => {
    const i0 = clamp(Math.floor((x0 + HALF) / C), 0, R), i1 = clamp(Math.ceil((x1 + HALF) / C), 0, R);
    const j0 = clamp(Math.floor((z0 + HALF) / C), 0, R), j1 = clamp(Math.ceil((z1 + HALF) / C), 0, R);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) fn(j * W1 + i, -HALF + i * C, -HALF + j * C);
  };
  // flatten grid districts
  for (const D of map.districts) {
    if (!GRID_STYLES.has(D.style)) continue;
    let s = 0, n = 0;
    for (let a = 0; a < 5; a++) for (let b = 0; b < 5; b++) { s += phys.height(D.x - D.w / 2 + (D.w * a) / 4, D.z - D.d / 2 + (D.d * b) / 4); n++; }
    const tgt = s / n; D.h = tgt;
    const fall = 45;
    eachCell(D.x - D.w / 2 - fall, D.z - D.d / 2 - fall, D.x + D.w / 2 + fall, D.z + D.d / 2 + fall, (k, x, z) => {
      const dx = Math.max(0, Math.abs(x - D.x) - D.w / 2), dz = Math.max(0, Math.abs(z - D.z) - D.d / 2);
      const w = 1 - smooth(0, fall, Math.hypot(dx, dz));
      hm[k] = lerp(hm[k], tgt + noise(x * 0.02, z * 0.02) * 0.4, w);
    });
  }
  // landmark pads
  for (const L of map.landmarks) {
    const r = LANDMARK_PAD[L.kind] || 0;
    if (L.kind === 'monastery') {
      const base = phys.height(L.x, L.z);
      eachCell(L.x - 110, L.z - 110, L.x + 110, L.z + 110, (k, x, z) => { const d = Math.hypot(x - L.x, z - L.z); hm[k] = Math.max(hm[k], base + 28 * (1 - smooth(12, 95, d))); });
      continue;
    }
    if (!r) continue;
    const tgt = phys.height(L.x, L.z);
    eachCell(L.x - r - 30, L.z - r - 30, L.x + r + 30, L.z + r + 30, (k, x, z) => { const d = Math.hypot(x - L.x, z - L.z); hm[k] = lerp(hm[k], tgt, 1 - smooth(r * 0.85, r + 28, d)); });
  }
  // roads: smoothed longitudinal profile, then flatten a corridor
  progress(0.08, 'Laying roads');
  for (const r of roads) {
    r.dense = densify(r.pts, 4);
    const raw = r.dense.map(([x, z]) => phys.height(x, z));
    const win = r.street ? 3 : 6;
    r.prof = raw.map((_, i) => { let s = 0, n = 0; for (let k = -win; k <= win; k++) { const q = raw[clamp(i + k, 0, raw.length - 1)]; s += q; n++; } return s / n; });
    const hw = r.w / 2;
    for (let i = 0; i < r.dense.length - 1; i++) {
      const [ax, az] = r.dense[i], [bx, bz] = r.dense[i + 1];
      const pa = r.prof[i], pb = r.prof[i + 1];
      eachCell(Math.min(ax, bx) - hw - 9, Math.min(az, bz) - hw - 9, Math.max(ax, bx) + hw + 9, Math.max(az, bz) + hw + 9, (k, x, z) => {
        const s = segDist(x, z, ax, az, bx, bz);
        const w = 1 - smooth(hw + 0.8, hw + 9, s.d);
        if (w > 0) hm[k] = lerp(hm[k], pa + (pb - pa) * s.t - 0.02, w);
      });
    }
  }
  // water: sea
  if (map.sea) {
    const S = map.sea;
    phys.water.push({ type: 'sea', axis: S.axis, sign: S.sign, at: S.at });
    for (let j = 0; j <= R; j++) for (let i = 0; i <= R; i++) {
      const x = -HALF + i * C, z = -HALF + j * C, v = (S.axis === 'x' ? x : z) * S.sign;
      const k = j * W1 + i;
      hm[k] = lerp(hm[k], Math.min(hm[k], 1.4 + (S.at - v) * 0.02), smooth(S.at - 110, S.at - 40, v));
      hm[k] = lerp(hm[k], -6, smooth(S.at - 40, S.at + 30, v));
    }
  }
  // rivers
  for (const rv of map.rivers || []) {
    const dense = densify(rv.pts, 6);
    const raw = dense.map(([x, z]) => phys.height(x, z));
    let prof = raw.map((_, i) => { let s = 0, n = 0; for (let k = -8; k <= 8; k++) { s += raw[clamp(i + k, 0, raw.length - 1)]; n++; } return s / n; });
    prof = prof.map((p) => (map.sea ? Math.max(0.2, p - 2.2) : p - 2.2));
    const pts3 = dense.map(([x, z], i) => [x, z, prof[i]]);
    phys.water.push({ type: 'river', pts: pts3, w: rv.w, clear: rv.clear });
    const hw = rv.w / 2;
    for (let i = 0; i < dense.length - 1; i++) {
      const [ax, az] = dense[i], [bx, bz] = dense[i + 1];
      eachCell(Math.min(ax, bx) - hw - 16, Math.min(az, bz) - hw - 16, Math.max(ax, bx) + hw + 16, Math.max(az, bz) + hw + 16, (k, x, z) => {
        const s = segDist(x, z, ax, az, bx, bz);
        const lvl = prof[i] + (prof[i + 1] - prof[i]) * s.t;
        const bed = lvl - 2.4 * (1 - smooth(0, hw, s.d)) - 0.6;
        const w = 1 - smooth(hw, hw + 16, s.d);
        if (w > 0) hm[k] = Math.min(hm[k], lerp(hm[k], bed, w));
      });
    }
  }
  // lakes / ponds / floods
  for (const lk of map.lakes || []) {
    let lvl;
    if (lk.flood) lvl = phys.height(lk.x, lk.z) + 0.45;
    else {
      let mn = Infinity;
      for (let a = 0; a < 16; a++) mn = Math.min(mn, phys.height(lk.x + Math.cos(a / 16 * 6.283) * lk.r, lk.z + Math.sin(a / 16 * 6.283) * lk.r));
      lvl = mn - (lk.pond ? 0.9 : 1.2);
    }
    lk.level = lvl;
    phys.water.push({ type: 'disc', x: lk.x, z: lk.z, r: lk.r, level: lvl, flood: !!lk.flood, foam: !!lk.foam });
    const rr = lk.r + (lk.flood ? 4 : 20);
    eachCell(lk.x - rr, lk.z - rr, lk.x + rr, lk.z + rr, (k, x, z) => {
      const d = Math.hypot(x - lk.x, z - lk.z);
      if (lk.flood) { if (d < lk.r) hm[k] = Math.min(hm[k], lvl - 0.45 - 0.25 * (1 - d / lk.r)); return; }
      const bed = lvl - 0.6 - 3.5 * Math.sqrt(Math.max(0, 1 - d / lk.r));
      const w = 1 - smooth(lk.r, rr, d);
      if (d < lk.r) hm[k] = Math.min(hm[k], bed);
      else if (w > 0) hm[k] = Math.min(hm[k], lerp(hm[k], lvl + 0.8, w));
    });
  }
  phys.bakeWater();
  // map border blends to an outer level
  let edgeSum = 0, edgeN = 0;
  for (let i = 0; i <= R; i += 8) for (const k of [i, R * W1 + i, i * W1, i * W1 + R]) { edgeSum += hm[k]; edgeN++; }
  const edgeLevel = Math.max(1.5, edgeSum / edgeN);
  for (let j = 0; j <= R; j++) for (let i = 0; i <= R; i++) {
    const x = -HALF + i * C, z = -HALF + j * C, k = j * W1 + i;
    const e = Math.max(Math.abs(x), Math.abs(z));
    if (map.sea) { const v = (map.sea.axis === 'x' ? x : z) * map.sea.sign; if (v > map.sea.at - 60) continue; }
    hm[k] = lerp(hm[k], edgeLevel, smooth(HALF - 34, HALF, e));
  }

  // ---------------------------------------------------------------- materials + builder
  const matKeys = Object.keys(MATDEFS);
  const { mats: texMats } = createMaterials([], '1k');
  const mats = {};
  for (const k of matKeys) {
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0, vertexColors: true });
    m.name = k; m.userData.scale = MATDEFS[k].scale; mats[k] = m;
  }
  Object.assign(mats, MM, texMats);
  const signAtlas = new SignAtlas();
  mats.signs = new THREE.MeshStandardMaterial({ map: signAtlas.tex, emissiveMap: signAtlas.tex, emissive: 0xffffff, emissiveIntensity: night ? 1.25 : 0.35, roughness: 0.6, vertexColors: true });
  mats.marking = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const facadeKeys = { glass: [], conc: [] };
  for (let i = 0; i < 3; i++) for (const st of ['glass', 'conc']) {
    const ft = facadeTextures(seed + i * 31 + (st === 'glass' ? 0 : 7), st === 'glass' ? 'glass' : 'conc');
    const key = 'facade_' + st + i;
    const m = new THREE.MeshStandardMaterial({ map: ft.map, emissiveMap: ft.emissive, emissive: 0xffffff, emissiveIntensity: night ? 0.9 : 0.1, roughness: st === 'glass' ? 0.12 : 0.7, metalness: st === 'glass' ? 0.8 : 0.1, vertexColors: true });
    m.userData.scale = 24; m.name = key; mats[key] = m; facadeKeys[st].push(key);
  }
  const geo = new GeoBuilder(mats);
  const occ = new Occ();
  const wn = await waterNormals();
  const waterMat = (tint = '#1f5160', opacity = 0.9) => {
    const m = new THREE.MeshStandardMaterial({ color: tint, roughness: 0.06, metalness: 0.15, transparent: true, opacity, normalMap: wn, normalScale: new THREE.Vector2(0.35, 0.35) });
    if (wn) { m.normalMap = wn.clone(); m.normalMap.wrapS = m.normalMap.wrapT = THREE.RepeatWrapping; m.normalMap.repeat.set(24, 24); m.normalMap.needsUpdate = true; }
    return m;
  };
  const seaCol = map.id === 'chennai' || map.id === 'trivandrum' ? '#17506a' : '#1c4c55';
  const ctx = {
    geo, phys, rng, map, occ, group, night, roads,
    loot: [], eggs: [], climbs: [], animated: [], signMats: [], mist: [], potholes: [], slowZones: [], noLoot: [],
    buildings: [], roofs: [], flagPoles: [], towerTops: [], harthalZone: null,
    signs: signAtlas,
    pickFacade: (st) => rng.pick(facadeKeys[st === 'glass' ? 'glass' : 'conc']),
    waterMat: waterMat('#2d6b72', 0.85),
    potholeMat: new THREE.MeshStandardMaterial({ color: 0x1a1612, roughness: 1, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
  };
  const waterMats = [ctx.waterMat];

  // ---------------------------------------------------------------- occupancy: water, roads, pads
  for (let z = -HALF; z < HALF; z += 2) for (let x = -HALF; x < HALF; x += 2) {
    const lvl = phys.waterLevel(x + 1, z + 1);
    if (lvl > -1e9 && phys.height(x + 1, z + 1) < lvl + 0.6) occ.mark(x, z, x + 1.9, z + 1.9, 2);
  }
  for (const r of roads) for (let i = 0; i < r.dense.length - 1; i++) {
    const [ax, az] = r.dense[i], [bx, bz] = r.dense[i + 1];
    const hw = r.w / 2 + (r.street ? 1 : 3);
    const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 2);
    for (let k = 0; k <= n; k++) { const t = k / n; occ.markCircle(ax + (bx - ax) * t, az + (bz - az) * t, hw, 3); }
  }
  for (const L of map.landmarks) { const r = LANDMARK_PAD[L.kind]; if (r) occ.markCircle(L.x, L.z, r, 4); }
  for (const L of map.landmarks) if (L.kind === 'metro') for (let i = 0; i < L.pts.length - 1; i++) {
    const [ax, az] = L.pts[i], [bx, bz] = L.pts[i + 1];
    occ.mark(Math.min(ax, bx) - 5, Math.min(az, bz) - 5, Math.max(ax, bx) + 5, Math.max(az, bz) + 5, 4);
    if (L.eggAt) occ.markCircle(L.eggAt[0], L.eggAt[1], 34, 4);
  }
  for (const P of map.props) { const r = PROP_PAD[P.kind]; if (r) occ.markCircle(P.x, P.z, r, 4); }
  for (const p of map.parks || []) occ.markCircle(p.x, p.z, p.r, 5);
  for (const L of map.landmarks) if (L.kind === 'flyover_jam') occ.mark(L.x - (L.len || 150) / 2 - 45, L.z - 20, L.x + (L.len || 150) / 2 + 45, L.z + 20, 4);

  // ---------------------------------------------------------------- landmarks + props
  progress(0.16, 'Raising landmarks');
  for (const L of map.landmarks) { try { buildLandmark(ctx, L); } catch (e) { console.error('landmark', L.kind, e); } }
  for (const P of map.props) { try { buildProp(ctx, P); } catch (e) { console.error('prop', P.kind, e); } }

  // ---------------------------------------------------------------- districts
  progress(0.28, 'Building neighbourhoods');
  const placeBuilding = (kind, cx, cz, w, d, rot, extra = {}) => {
    const m = SIZES[kind] ? SIZES[kind][4] : 1;
    const half = [(rot % 2 ? d : w) / 2 + m, (rot % 2 ? w : d) / 2 + m];
    if (!occ.free(cx - half[0], cz - half[1], cx + half[0], cz + half[1])) return false;
    // reject steep footprints for non-stilt types
    let mx = -Infinity, mn = Infinity;
    for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]]) { const h = phys.height(cx + a * half[0], cz + b * half[1]); mx = Math.max(mx, h); mn = Math.min(mn, h); }
    const stilty = ['hill', 'hut', 'spiti', 'house', 'kerala'].includes(kind);
    if (mx - mn > (stilty ? 9 : 3.5)) return false;
    occ.mark(cx - half[0], cz - half[1], cx + half[0], cz + half[1], 6);
    const inHarthal = ctx.harthalZone && Math.hypot(cx - ctx.harthalZone.x, cz - ctx.harthalZone.z) < ctx.harthalZone.r;
    ctx.harthal = !!inHarthal;
    try { buildArchetype(ctx, kind, { cx, cz, w, d, rot, ...extra }); } catch (e) { console.error('building', kind, e); }
    ctx.harthal = false;
    return true;
  };
  const pickKind = (style) => { const mix = STYLE_MIX[style] || STYLE_MIX.urban; let r = rng(), acc = 0; for (const [k, p] of mix) { acc += p; if (r <= acc) return k; } return mix[0][0]; };
  const sizeOf = (kind) => { const s = SIZES[kind]; return [rng.range(s[0], s[1]), rng.range(s[2], s[3])]; };

  map.districts.forEach((D, di) => {
    if (GRID_STYLES.has(D.style)) {
      const xs = D.xs, zs = D.zs;
      for (let a = 0; a < xs.length - 1; a++) for (let b = 0; b < zs.length - 1; b++) {
        const bx0 = xs[a] + D.sw / 2 + 2, bx1 = xs[a + 1] - D.sw / 2 - 2, bz0 = zs[b] + D.sw / 2 + 2, bz1 = zs[b + 1] - D.sw / 2 - 2;
        if (bx1 - bx0 < 8 || bz1 - bz0 < 8) continue;
        const bd = bz1 - bz0, bw = bx1 - bx0;
        // rows along the south (+z) and north (-z) edges
        for (const [edge, rot] of [[bz1, 0], [bz0, 2]]) {
          let cur = bx0;
          while (cur < bx1 - 5) {
            let kind = pickKind(D.style);
            let [w, d] = sizeOf(kind);
            const m = SIZES[kind][4];
            if (d + 2 * m > bd / 2 && kind !== 'tower') { kind = D.style === 'industrial' ? 'house' : kind === 'warehouse' ? 'house' : kind; [w, d] = sizeOf(kind); }
            d = Math.min(d, bd / 2 - SIZES[kind][4] - 0.5);
            if (kind === 'tower') { w = Math.min(w, bw - 6); d = Math.min(w, bd - 6); }
            if (d < 7.4 && !['hut', 'oldcity', 'shop'].includes(kind)) { cur += 4; continue; }
            if (cur + w + 2 * m > bx1) break;
            const cx = cur + m + w / 2;
            const cz = rot === 0 ? edge - m - d / 2 : edge + m + d / 2;
            if (placeBuilding(kind, cx, cz, w, d, rot)) cur += w + 2 * m + (D.style === 'oldcity' ? 0.2 : rng.range(0.5, 3));
            else cur += 4;
          }
        }
        // parked vehicles along the south street
        if (D.style !== 'industrial' && rng() < 0.6) {
          const z = zs[b + 1] - D.sw / 2 + 1.1;
          for (let x = bx0; x < bx1; x += rng.range(8, 20)) {
            if (rng() < 0.45) {
              const g = rng() < 0.5 ? car(rng.pick(['#c62828', '#eeeeee', '#1565c0', '#212121', '#9e9e9e', '#f9a825']), rng.pick(['hatch', 'sedan'])) : rng() < 0.6 ? autoRickshaw() : bike(rng.pick(['#111', '#b71c1c']));
              const m = new THREE.Matrix4().makeRotationY(Math.PI / 2).setPosition(x, phys.height(x, z), z);
              mergeGroup(geo, g, m);
              const bb = new THREE.Box3().setFromObject(g).applyMatrix4(m);
              phys.addBox(bb.min.x + 0.2, bb.min.y, bb.min.z + 0.1, bb.max.x - 0.2, bb.max.y, bb.max.z - 0.1, SURF.metal);
            }
          }
        }
      }
    } else {
      // scattered: hill towns, villages, spiti hamlets
      const spacing = D.style === 'hill' ? 12 : 16;
      const n = Math.floor((D.w * D.d) / (spacing * spacing));
      for (let k = 0; k < n * 2 && k < 400; k++) {
        const cx = D.x + (rng() - 0.5) * D.w, cz = D.z + (rng() - 0.5) * D.d;
        const kind = pickKind(D.style);
        const [w, d] = sizeOf(kind);
        placeBuilding(kind, cx, cz, w, d, rng.int(0, 3));
      }
    }
  });
  // scattered compounds across the countryside
  const ruralKind = { flat: 'house', coastal: 'kerala', hills: map.id === 'trivandrum' || map.id === 'thrissur' ? 'kerala' : 'hut', ridges: 'hill', valley: 'spiti' }[T.kind] || 'house';
  for (let k = 0, placed = 0; k < 900 && placed < 55; k++) {
    const cx = (rng() - 0.5) * (HALF * 2 - 84), cz = (rng() - 0.5) * (HALF * 2 - 84);
    const cluster = 1 + rng.int(0, 3);
    for (let c = 0; c < cluster; c++) {
      const kind = rng() < 0.2 ? 'warehouse' : ruralKind;
      const [w, d] = sizeOf(kind);
      if (placeBuilding(kind, cx + c * 18, cz + (c % 2) * 14, w, d, rng.int(0, 3))) placed++;
    }
  }

  // ---------------------------------------------------------------- road meshes, bridges, lamps
  progress(0.5, 'Painting lane markings');
  const lampPos = [];
  const cityish = T.kind === 'flat' || T.kind === 'coastal' || map.id === 'trivandrum' || map.id === 'thrissur';
  roads.forEach((r, ri) => {
    const d = densify(r.pts, 3);
    const raw = d.map(([x, z]) => phys.height(x, z));
    // keep road on its pre-carve profile; bridges where water now sits below
    const prof = d.map(([x, z], i) => {
      const lvl = phys.waterLevel(x, z);
      const rp = r.prof ? interpProfile(r, x, z) : raw[i];
      const isFlood = phys.water.some((w) => w.type === 'disc' && w.flood && Math.hypot(x - w.x, z - w.z) < w.r + 2);
      if (lvl > -1e9 && !isFlood && raw[i] < lvl + 0.3) return { y: Math.max(rp, lvl + 3), bridge: true };
      return { y: Math.max(raw[i], rp - 0.3), bridge: false };
    });
    const hw = r.w / 2, yo = 0.05 + (ri % 7) * 0.004;
    let dist = 0;
    for (let i = 0; i < d.length - 1; i++) {
      const [ax, az] = d[i], [bx, bz] = d[i + 1];
      const L = Math.hypot(bx - ax, bz - az); if (L < 0.01) continue;
      const nx = -(bz - az) / L, nz = (bx - ax) / L;
      const ya = prof[i].y + yo, yb = prof[i + 1].y + yo;
      const s = 1 / 7;
      geo.quad([[ax - nx * hw, ya, az - nz * hw], [bx - nx * hw, yb, bz - nz * hw], [bx + nx * hw, yb, bz + nz * hw], [ax + nx * hw, ya, az + nz * hw]].reverse(), r.street ? 'asphaltWorn' : 'asphalt', WHITE,
        [[r.w * s, dist * s], [r.w * s, (dist + L) * s], [0, (dist + L) * s], [0, dist * s]]);
      // center dashes
      if (!r.street && r.w >= 12 && Math.floor(dist / 4) % 2 === 0) {
        const q = 0.08;
        geo.quad([[ax - nx * q, ya + 0.01, az - nz * q], [bx - nx * q, yb + 0.01, bz - nz * q], [bx + nx * q, yb + 0.01, bz + nz * q], [ax + nx * q, ya + 0.01, az + nz * q]].reverse(), 'marking', col('#f2f2f2'), [[0, 0], [0, 1], [1, 1], [1, 0]]);
      }
      if (!r.street && r.w >= 14) for (const sd of [-1, 1]) {
        const e = hw - 0.4, q = 0.07;
        geo.quad([[ax + nx * sd * (e - q), ya + 0.01, az + nz * sd * (e - q)], [bx + nx * sd * (e - q), yb + 0.01, bz + nz * sd * (e - q)], [bx + nx * sd * (e + q), yb + 0.01, bz + nz * sd * (e + q)], [ax + nx * sd * (e + q), ya + 0.01, az + nz * sd * (e + q)]].map((p, k, arr) => sd > 0 ? arr[3 - k] : p), 'marking', col('#f2c200'), [[0, 0], [0, 1], [1, 1], [1, 0]]);
      }
      // sidewalks in town
      if (cityish && !r.street && r.w >= 12 && !prof[i].bridge) {
        const mx = (ax + bx) / 2, mz = (az + bz) / 2;
        const nearOther = roads.some((o, oi) => oi !== ri && polyDist(mx, mz, o.pts) < o.w / 2 + 4);
        if (!nearOther) for (const sd of [-1, 1]) {
          const i0 = hw, i1 = hw + 2.6, yy = 0.14;
          const P = (o, t) => [ (t ? bx : ax) + nx * sd * o, (t ? yb : ya) + yy, (t ? bz : az) + nz * sd * o];
          const top = [P(i0, 0), P(i0, 1), P(i1, 1), P(i1, 0)];
          geo.quad(sd > 0 ? top.slice().reverse() : top, 'pavers', WHITE);
          const curb = [[ax + nx * sd * i0, ya - 0.05, az + nz * sd * i0], [bx + nx * sd * i0, yb - 0.05, bz + nz * sd * i0], P(i0, 1), P(i0, 0)];
          geo.quad(sd > 0 ? curb.slice().reverse() : curb, 'concrete', col('#bdbab2'));
        }
        if (i % 10 === 0) lampPos.push([mx + nx * (hw + 1.2) * (i % 20 ? 1 : -1), mz + nz * (hw + 1.2) * (i % 20 ? 1 : -1), (ya + yb) / 2, Math.atan2(nx, nz) + (i % 20 ? Math.PI : 0)]);
      }
      // bridge deck + colliders
      if (prof[i].bridge || prof[i + 1].bridge) {
        const yy = Math.min(ya, yb) - yo;
        const x0 = Math.min(ax - nx * hw, bx + nx * hw, ax + nx * hw, bx - nx * hw), x1 = Math.max(ax - nx * hw, bx + nx * hw, ax + nx * hw, bx - nx * hw);
        const z0 = Math.min(az - nz * hw, bz + nz * hw, az + nz * hw, bz - nz * hw), z1 = Math.max(az - nz * hw, bz + nz * hw, az + nz * hw, bz - nz * hw);
        phys.addBox(x0, yy - 0.9, z0, x1, yy + 0.02, z1, SURF.concrete);
        geo.quad([[ax - nx * hw, ya - 0.9, az - nz * hw], [ax + nx * hw, ya - 0.9, az + nz * hw], [bx + nx * hw, yb - 0.9, bz + nz * hw], [bx - nx * hw, yb - 0.9, bz - nz * hw]].reverse(), 'concrete', col('#9e9a92'));
        for (const sd of [-1, 1]) {
          const px = (ax + bx) / 2 + nx * sd * (hw + 0.15), pz = (az + bz) / 2 + nz * sd * (hw + 0.15);
          const m = new THREE.Matrix4().makeRotationY(Math.atan2(bx - ax, bz - az)).setPosition(px, (ya + yb) / 2 + 0.45, pz);
          geo.geom(new THREE.BoxGeometry(0.3, 1.0, L + 0.05), m, 'concrete', col('#c9c4ba'));
          phys.addBox(px - 0.2, yy, pz - 0.2, px + 0.2, yy + 1.0, pz + 0.2, SURF.concrete);
        }
        if (i % 5 === 0) {
          const g = phys.height(ax, az) - 1;
          const m = new THREE.Matrix4().setPosition(ax, (g + yy - 0.9) / 2, az);
          geo.geom(new THREE.BoxGeometry(1.4, Math.max(0.5, yy - 0.9 - g), 1.4), m, 'concrete', col('#a8a39a'));
          phys.addBox(ax - 0.7, g, az - 0.7, ax + 0.7, yy - 0.9, az + 0.7, SURF.concrete);
        }
      }
      dist += L;
    }
    r.meshProf = prof; r.meshDense = d;
  });
  // street lamps (instanced)
  if (lampPos.length) {
    const pole = new THREE.CylinderGeometry(0.07, 0.1, 7, 6); pole.translate(0, 3.5, 0);
    const arm = new THREE.BoxGeometry(0.08, 0.08, 1.6); arm.translate(0, 6.95, 0.75);
    const head = new THREE.BoxGeometry(0.35, 0.12, 0.6); head.translate(0, 6.85, 1.5);
    const merged = mergeSimple([pole, arm]);
    const ip = new THREE.InstancedMesh(merged, new THREE.MeshStandardMaterial({ color: 0x4a4f55, roughness: 0.5, metalness: 0.7 }), lampPos.length);
    const ih = new THREE.InstancedMesh(head, new THREE.MeshStandardMaterial({ color: 0x222222, emissive: night ? 0xffe2a8 : 0x6b6152, emissiveIntensity: night ? 3 : 0.4 }), lampPos.length);
    const m = new THREE.Matrix4();
    lampPos.forEach(([x, z, y, a], i) => { m.makeRotationY(a).setPosition(x, phys.height(x, z), z); ip.setMatrixAt(i, m); ih.setMatrixAt(i, m); phys.addBox(x - 0.12, phys.height(x, z), z - 0.12, x + 0.12, phys.height(x, z) + 7, z + 0.12, SURF.metal); });
    ip.castShadow = true; group.add(ip, ih);
  }

  // ---------------------------------------------------------------- build merged static meshes
  progress(0.6, 'Merging geometry');
  const usedKeys = new Set([...geo.bufs.values()].map((b) => b.mat));
  const staticMeshes = geo.build(group);

  // ---------------------------------------------------------------- terrain
  progress(0.66, 'Texturing the ground');
  const layerKeys = map.ground;
  const terrainRes = quality === 'low' ? '1k' : '1k';
  const layers = await loadTerrainLayers(layerKeys, terrainRes);
  const terrainMat = makeTerrainMaterial(layers);
  const terrain = buildTerrainMesh(phys, map, terrainMat, noise);
  terrain.forEach((m) => group.add(m));
  // outer ground skirt (not on the sea side)
  const outerMat = new THREE.MeshStandardMaterial({ map: layers[0].map, roughness: 1, color: 0xdddddd });
  if (layers[0].map) { outerMat.map = layers[0].map.clone(); outerMat.map.needsUpdate = true; outerMat.map.repeat.set(400, 400); }
  for (const [x, z, w, d, side] of [[0, -HALF - 1500, HALF * 2 + 6000, 3000, 'n'], [0, HALF + 1500, HALF * 2 + 6000, 3000, 's'], [-HALF - 1500, 0, 3000, HALF * 2, 'w'], [HALF + 1500, 0, 3000, HALF * 2, 'e']]) {
    if (map.sea) { const s = map.sea; const seaSide = s.axis === 'x' ? (s.sign > 0 ? 'e' : 'w') : (s.sign > 0 ? 's' : 'n'); if (side === seaSide) continue; }
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, d), outerMat);
    p.rotation.x = -Math.PI / 2; p.position.set(x, edgeLevel - 0.3, z); p.receiveShadow = true; group.add(p);
  }
  if (['hills', 'ridges', 'valley'].includes(T.kind) && !map.sea) group.add(mountainRing(map, edgeLevel, layers, noise));

  // ---------------------------------------------------------------- water meshes
  if (map.sea) {
    const s = map.sea;
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), waterMat(seaCol, 0.92));
    waterMats.push(sea.material);
    sea.rotation.x = -Math.PI / 2;
    const off = s.at - 60 + 3000;
    sea.position.set(s.axis === 'x' ? off * s.sign : 0, 0, s.axis === 'z' ? off * s.sign : 0);
    group.add(sea);
  }
  for (const w of phys.water) {
    if (w.type === 'disc') {
      const m = waterMat(w.flood ? '#5e4d33' : w.foam ? '#51615a' : '#27616a', w.flood ? 0.82 : 0.9);
      waterMats.push(m);
      const mesh = new THREE.Mesh(new THREE.CircleGeometry(w.r + (w.flood ? 1 : 6), 48), m);
      mesh.rotation.x = -Math.PI / 2; mesh.position.set(w.x, w.level, w.z); group.add(mesh);
    } else if (w.type === 'river') {
      const m = waterMat(w.clear ? '#3fb7b0' : '#2a5d63', w.clear ? 0.45 : 0.88);
      waterMats.push(m);
      group.add(ribbon(w.pts, w.w + 10, m));
    }
  }

  // ---------------------------------------------------------------- vegetation
  progress(0.74, 'Planting coconut trees');
  const veg = plantTrees(ctx, map, occ, rng, quality);
  veg.meshes.forEach((m) => group.add(m));
  const grass = quality === 'low' || map.id === 'spiti' ? null : new GrassField(phys, map, occ, quality);
  if (grass) group.add(grass.mesh);

  // ---------------------------------------------------------------- textures for used materials
  progress(0.8, 'Downloading photo textures');
  const texKeys = [...usedKeys].filter((k) => MATDEFS[k]);
  const res = createMaterials(texKeys, '1k', (p) => progress(0.8 + p * 0.18, 'Downloading photo textures'));
  for (const k of texKeys) {
    const src = res.mats[k], dst = mats[k];
    res.ready.then(() => { dst.map = src.map; dst.normalMap = src.normalMap; dst.aoMap = src.aoMap; dst.roughnessMap = src.roughnessMap; dst.metalnessMap = src.metalnessMap; dst.metalness = src.metalnessMap ? 1 : 0; dst.roughness = 1; dst.needsUpdate = true; });
  }
  await Promise.race([res.ready, new Promise((r) => setTimeout(r, 25000))]);

  phys.finalize();

  // ---------------------------------------------------------------- places, vehicle spawns, minimap
  const places = [];
  map.districts.forEach((D, i) => { const n = (PLACE_NAMES[map.id] || [])[i]; if (n) places.push({ name: n, x: D.x, z: D.z }); });
  for (const L of map.landmarks) if (L.egg && L.kind !== 'metro') places.push({ name: L.egg.title, x: L.x, z: L.z, landmark: true });

  const vehicleSpawns = [];
  const vk = map.vehicles;
  for (let k = 0; k < 400 && vehicleSpawns.length < map.vehicleCount; k++) {
    const kind = vk[k % vk.length];
    if (kind === 'boat') {
      const w = phys.water.filter((q) => q.type !== 'sea' || true);
      const x = (rng() - 0.5) * 900, z = (rng() - 0.5) * 900;
      const lvl = phys.waterLevel(x, z);
      if (lvl > -1e9 && phys.height(x, z) < lvl - 0.8) vehicleSpawns.push({ kind, x, z, y: lvl, ry: rng() * 6.28 });
      continue;
    }
    const r = rng.pick(roads.filter((q) => !q.street || rng() < 0.3));
    const i = rng.int(0, r.meshDense.length - 2);
    if (r.meshProf[i].bridge) continue;
    const [ax, az] = r.meshDense[i], [bx, bz] = r.meshDense[i + 1];
    const ang = Math.atan2(bx - ax, bz - az);
    const off = (r.w / 2 - 2) * (rng() < 0.5 ? -1 : 1);
    const x = ax + Math.cos(ang) * off, z = az - Math.sin(ang) * off;
    if (Math.abs(x) > HALF - 32 || Math.abs(z) > HALF - 32) continue;
    if (vehicleSpawns.some((v) => Math.hypot(v.x - x, v.z - z) < 40)) continue;
    vehicleSpawns.push({ kind, x, z, y: phys.height(x, z), ry: ang });
  }

  const minimap = drawMinimap(phys, map, roads, ctx, layers);

  console.log(`[world] ${map.id}: ${phys.surf.length} colliders, ${ctx.loot.length} loot spots, ${ctx.buildings.length} buildings, ${staticMeshes.length} meshes, ${Math.round(performance.now() - t0)} ms`);
  progress(1, 'Ready');

  const clock = { t: 0 };
  return {
    map, phys, group, loot: ctx.loot, eggs: ctx.eggs, climbs: ctx.climbs, places, vehicleSpawns, minimap,
    potholes: ctx.potholes, slowZones: ctx.slowZones, noLoot: ctx.noLoot, mist: ctx.mist, buildings: ctx.buildings,
    signMats: ctx.signMats, waterMats, edgeLevel,
    update(dt, cam) {
      clock.t += dt;
      for (const f of ctx.animated) f(clock.t);
      for (const m of waterMats) if (m.normalMap) { m.normalMap.offset.x = clock.t * 0.012; m.normalMap.offset.y = clock.t * 0.008; }
      veg.update(clock.t);
      if (grass && cam) grass.update(cam, clock.t);
    },
    dispose() {
      group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    },
  };
}

function interpProfile(r, x, z) {
  let best = Infinity, y = 0;
  for (let i = 0; i < r.dense.length - 1; i++) {
    const s = segDist(x, z, r.dense[i][0], r.dense[i][1], r.dense[i + 1][0], r.dense[i + 1][1]);
    if (s.d < best) { best = s.d; y = r.prof[i] + (r.prof[i + 1] - r.prof[i]) * s.t; }
  }
  return y;
}

function mergeSimple(geos) {
  const out = new THREE.BufferGeometry();
  const pos = [], nor = [], idx = [];
  let off = 0;
  for (const g of geos) {
    const gi = g.index ? g : g;
    pos.push(...gi.attributes.position.array); nor.push(...gi.attributes.normal.array);
    if (gi.index) for (const i of gi.index.array) idx.push(i + off);
    off += gi.attributes.position.count;
  }
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setIndex(idx);
  return out;
}

// ================================================================== terrain
export function makeTerrainMaterial(layers) {
  const white = new THREE.DataTexture(new Uint8Array([200, 200, 200, 255]), 1, 1); white.needsUpdate = true;
  const flat = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1); flat.needsUpdate = true;
  const L = [0, 1, 2, 3].map((i) => layers[i] || layers[0]);
  const m = new THREE.MeshStandardMaterial({ map: L[0].map || white, normalMap: L[0].normal || flat, roughness: 0.94, metalness: 0 });
  m.normalScale.set(1.1, 1.1);
  m.onBeforeCompile = (sh) => {
    for (let i = 0; i < 4; i++) { sh.uniforms['tL' + i] = { value: L[i].map || white }; sh.uniforms['nL' + i] = { value: L[i].normal || flat }; }
    sh.uniforms.lScale = { value: new THREE.Vector4(...L.map((l) => l.scale)) };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 splat;\nvarying vec4 vSplat;\nvarying vec3 vWPos;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvSplat = splat;\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D tL0, tL1, tL2, tL3, nL0, nL1, nL2, nL3;\nuniform vec4 lScale;\nvarying vec4 vSplat;\nvarying vec3 vWPos;\nvec4 splatW;\nvec2 wuv;')
      .replace('#include <map_fragment>', `
        wuv = vWPos.xz;
        vec4 c0 = texture2D(tL0, wuv / lScale.x);
        vec4 c1 = texture2D(tL1, wuv / lScale.y);
        vec4 c2 = texture2D(tL2, wuv / lScale.z);
        vec4 c3 = texture2D(tL3, wuv / lScale.w);
        float macro = texture2D(tL1, wuv / 173.0).g;
        vec4 hb = vec4(dot(c0.rgb, vec3(.33)), dot(c1.rgb, vec3(.33)), dot(c2.rgb, vec3(.33)), dot(c3.rgb, vec3(.33)));
        vec4 w = vSplat * (0.3 + hb);
        w = w * w * w;
        w /= (w.x + w.y + w.z + w.w + 1e-5);
        splatW = w;
        vec3 tcol = c0.rgb * w.x + c1.rgb * w.y + c2.rgb * w.z + c3.rgb * w.w;
        tcol *= 0.8 + 0.4 * macro;
        diffuseColor.rgb *= tcol;
      `)
      .replace('#include <normal_fragment_maps>', `
        vec3 n0 = texture2D(nL0, wuv / lScale.x).xyz * 2.0 - 1.0;
        vec3 n1 = texture2D(nL1, wuv / lScale.y).xyz * 2.0 - 1.0;
        vec3 n2 = texture2D(nL2, wuv / lScale.z).xyz * 2.0 - 1.0;
        vec3 n3 = texture2D(nL3, wuv / lScale.w).xyz * 2.0 - 1.0;
        vec3 mapN = normalize(n0 * splatW.x + n1 * splatW.y + n2 * splatW.z + n3 * splatW.w);
        mapN.xy *= normalScale;
        normal = normalize(tbn * mapN);
      `);
  };
  return m;
}

export function buildTerrainMesh(phys, map, mat, noise) {
  const R = phys.res, C = phys.cellM, W1 = R + 1, chunks = 8, per = R / chunks;
  const meshes = [];
  const snowLine = map.snowLine != null ? map.terrain.base + map.snowLine : Infinity;
  const nearWater = (x, z, h) => { const l = phys.waterLevel(x, z); return l > -1e9 && h < l + 2.5; };
  for (let cj = 0; cj < chunks; cj++) for (let ci = 0; ci < chunks; ci++) {
    const n = per + 1;
    const pos = new Float32Array(n * n * 3), nor = new Float32Array(n * n * 3), uv = new Float32Array(n * n * 2), sp = new Float32Array(n * n * 4);
    for (let jj = 0; jj < n; jj++) for (let ii = 0; ii < n; ii++) {
      const i = ci * per + ii, j = cj * per + jj, v = jj * n + ii;
      const x = -HALF + i * C, z = -HALF + j * C, h = phys.h[j * W1 + i];
      pos[v * 3] = x; pos[v * 3 + 1] = h; pos[v * 3 + 2] = z;
      const hl = phys.h[j * W1 + Math.max(0, i - 1)], hr = phys.h[j * W1 + Math.min(R, i + 1)];
      const hd = phys.h[Math.max(0, j - 1) * W1 + i], hu = phys.h[Math.min(R, j + 1) * W1 + i];
      const nx = hl - hr, nz = hd - hu, ny = 2 * C, l = Math.hypot(nx, ny, nz);
      nor[v * 3] = nx / l; nor[v * 3 + 1] = ny / l; nor[v * 3 + 2] = nz / l;
      uv[v * 2] = x / 5; uv[v * 2 + 1] = z / 5;
      const slope = 1 - ny / l;
      const pn = noise(x * 0.012 + 40, z * 0.012 - 13) * 0.5 + 0.5;
      let w0 = 1, w1 = smooth(0.45, 0.8, pn) * 0.9, w2 = smooth(0.06, 0.2, slope) * 2.2, w3 = 0;
      if (map.ground[3] === 'snow') w3 = smooth(snowLine - 10, snowLine + 25, h) * 3;
      else if (map.ground[3] === 'sand') w3 = nearWater(x, z, h) || (map.sea && h < 2.2) ? 3 : 0;
      else w3 = smooth(0.55, 0.9, noise(x * 0.02 - 7, z * 0.02 + 3) * 0.5 + 0.5) * 0.8;
      if (w3 > 0.5 && map.ground[3] === 'sand') w2 *= 0.3;
      sp[v * 4] = w0; sp[v * 4 + 1] = w1; sp[v * 4 + 2] = w2; sp[v * 4 + 3] = w3;
    }
    const idx = [];
    for (let jj = 0; jj < per; jj++) for (let ii = 0; ii < per; ii++) {
      const a = jj * n + ii, b = a + 1, c = a + n, d = c + 1;
      // same diagonal split as Physics.height: (a, c, b) and (c, d, b)
      idx.push(a, c, b, c, d, b);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('splat', new THREE.BufferAttribute(sp, 4));
    g.setIndex(idx);
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true; m.castShadow = map.terrain.kind !== 'flat' && map.terrain.kind !== 'coastal';
    m.name = 'terrain';
    meshes.push(m);
  }
  return meshes;
}

function mountainRing(map, edgeLevel, layers, noise) {
  const segA = 96, segR = 14;
  const pos = [], cols = [], idx = [];
  const peak = map.terrain.amp * (map.terrain.kind === 'valley' ? 1.6 : 1.3);
  for (let r = 0; r <= segR; r++) for (let a = 0; a <= segA; a++) {
    const ang = (a / segA) * Math.PI * 2, rad = 760 + (r / segR) * 1800;
    const x = Math.cos(ang) * rad, z = Math.sin(ang) * rad;
    const ramp = smooth(0, 0.45, r / segR) * (1 - smooth(0.75, 1, r / segR) * 0.5);
    const h = edgeLevel - 5 + peak * ramp * (0.35 + 0.9 * noise.ridged(x * 0.0022, z * 0.0022, 5));
    pos.push(x, h, z);
    const snow = map.id === 'spiti' ? smooth(edgeLevel + peak * 0.45, edgeLevel + peak * 0.7, h) : 0;
    const c = new THREE.Color().setRGB(0.55 + snow * 0.45, 0.55 + snow * 0.45, 0.55 + snow * 0.45);
    cols.push(c.r, c.g, c.b);
  }
  for (let r = 0; r < segR; r++) for (let a = 0; a < segA; a++) {
    const i = r * (segA + 1) + a;
    idx.push(i, i + 1, i + segA + 1, i + 1, i + segA + 2, i + segA + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  const uv = []; for (let k = 0; k < pos.length; k += 3) uv.push(pos[k] / 40, pos[k + 2] / 40);
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  const tex = layers[2] && layers[2].map ? layers[2].map : null;
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, vertexColors: true, roughness: 1, side: THREE.DoubleSide }));
  m.name = 'mountains';
  return m;
}

function ribbon(pts, w, mat) {
  const pos = [], idx = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
    const nx = -dz / L, nz = dx / L;
    pos.push(pts[i][0] - nx * w / 2, pts[i][2], pts[i][1] - nz * w / 2, pts[i][0] + nx * w / 2, pts[i][2], pts[i][1] + nz * w / 2);
    if (i < pts.length - 1) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const uv = []; for (let k = 0; k < pos.length; k += 3) uv.push(pos[k] / 40, pos[k + 2] / 40);
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  // make sure the normals point up
  const n = g.attributes.normal; for (let k = 0; k < n.count; k++) if (n.getY(k) < 0) { n.setXYZ(k, -n.getX(k), -n.getY(k), -n.getZ(k)); }
  const m = new THREE.Mesh(g, mat); m.material.side = THREE.DoubleSide;
  return m;
}

// ================================================================== vegetation
function treeParts(kind) {
  const trunk = [], leaf = [];
  const add = (arr, g, m) => { g.applyMatrix4(m); arr.push(g); };
  const M = (x, y, z, rx = 0, ry = 0, rz = 0, s = [1, 1, 1]) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(...s));
  let leafTex = 'broad';
  if (kind === 'coconut' || kind === 'palmyra' || kind === 'banana') {
    const H = kind === 'banana' ? 2.6 : kind === 'palmyra' ? 12 : 11;
    const bend = kind === 'coconut' ? 1.6 : 0.2;
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(bend * 0.3, H * 0.4, 0), new THREE.Vector3(bend, H, 0)]);
    add(trunk, new THREE.TubeGeometry(curve, 10, kind === 'banana' ? 0.16 : 0.2, 7), new THREE.Matrix4());
    const nF = kind === 'banana' ? 7 : 13;
    for (let i = 0; i < nF; i++) {
      const ang = (i / nF) * Math.PI * 2;
      const len = kind === 'banana' ? 2.4 : kind === 'palmyra' ? 2.6 : 4.8;
      const g = new THREE.PlaneGeometry(kind === 'palmyra' ? 2.6 : 1.3, len, 1, 5);
      g.translate(0, len / 2, 0);
      const p = g.attributes.position;
      for (let k = 0; k < p.count; k++) { const y = p.getY(k); p.setZ(k, -(y * y) / (len * (kind === 'banana' ? 3 : 1.6))); }
      g.computeVertexNormals();
      add(leaf, g, M(bend, H - 0.1, 0, 0, ang, 0).multiply(new THREE.Matrix4().makeRotationX(-(Math.PI / 2) * (kind === 'banana' ? 0.55 : 0.78))));
    }
    leafTex = kind === 'palmyra' ? 'broad' : 'frond';
    if (kind === 'coconut') for (let i = 0; i < 5; i++) add(trunk, new THREE.SphereGeometry(0.2, 6, 5), M(bend + Math.cos(i) * 0.35, H - 0.5, Math.sin(i) * 0.35));
  } else if (kind === 'pine') {
    add(trunk, new THREE.CylinderGeometry(0.12, 0.3, 14, 7).translate(0, 7, 0), new THREE.Matrix4());
    for (let t = 0; t < 4; t++) for (let r = 0; r < 3; r++) {
      const s = 4.2 - t * 0.9, y = 4 + t * 2.6;
      add(leaf, new THREE.PlaneGeometry(s * 1.6, s * 1.4).translate(0, s * 0.7, 0), M(0, y, 0, 0, (r / 3) * Math.PI, 0));
    }
    leafTex = 'pine';
  } else if (kind === 'bamboo') {
    for (let i = 0; i < 9; i++) { const a = i * 2.4, r = 0.3 + (i % 3) * 0.2; add(trunk, new THREE.CylinderGeometry(0.05, 0.07, 9, 5).translate(0, 4.5, 0), M(Math.cos(a) * r, 0, Math.sin(a) * r, Math.cos(a) * 0.12, 0, Math.sin(a) * 0.12)); }
    for (let i = 0; i < 8; i++) add(leaf, new THREE.PlaneGeometry(3, 3), M(Math.cos(i) * 0.8, 7 + (i % 3), Math.sin(i) * 0.8, 0.3, i * 0.8, 0));
  } else {
    const tall = kind === 'poplar';
    const H = tall ? 5 : 3.2;
    add(trunk, new THREE.CylinderGeometry(0.22, 0.38, H + 1, 7).translate(0, (H + 1) / 2, 0), new THREE.Matrix4());
    for (let b = 0; b < 3; b++) add(trunk, new THREE.CylinderGeometry(0.08, 0.16, 3, 5).translate(0, 1.5, 0), M(0, H - 0.3, 0, 0.7, b * 2.1, 0));
    const cards = tall ? 12 : 14;
    const cy = tall ? H + 5 : H + 2.6, rx = tall ? 1.6 : kind === 'dry' ? 2.4 : 3.2, ry2 = tall ? 4.5 : 1.8;
    for (let i = 0; i < cards; i++) {
      const u = (i + 0.5) / cards, th = Math.acos(1 - 2 * u), ph = i * 2.399;
      const x = Math.sin(th) * Math.cos(ph) * rx, y = Math.cos(th) * ry2, z = Math.sin(th) * Math.sin(ph) * rx;
      const s = tall ? 3.2 : 4.4;
      add(leaf, new THREE.PlaneGeometry(s, s), M(x, cy + y, z, (Math.random() - 0.5) * 1.2, ph, (Math.random() - 0.5) * 0.6));
    }
    leafTex = kind === 'gulmohar' ? 'gulmohar' : kind === 'dry' ? 'dry' : kind === 'poplar' ? 'dry' : 'broad';
  }
  return { trunk: mergeAll(trunk), leaf: mergeAll(leaf), leafTex, palm: kind === 'coconut' || kind === 'palmyra' };
}
function mergeAll(geos) {
  const pos = [], nor = [], uv = [], idx = [];
  let off = 0;
  for (let g of geos) {
    if (!g.index) g = g.toNonIndexed();
    pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array);
    uv.push(...(g.attributes.uv ? g.attributes.uv.array : new Float32Array(g.attributes.position.count * 2)));
    if (g.index) for (const i of g.index.array) idx.push(i + off); else for (let i = 0; i < g.attributes.position.count; i++) idx.push(i + off);
    off += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setIndex(idx);
  return out;
}

function plantTrees(ctx, map, occ, rng, quality) {
  const phys = ctx.phys;
  const kinds = map.trees.kinds;
  const count = Math.round(map.trees.count * (quality === 'low' ? 0.5 : quality === 'high' ? 1.2 : 1));
  const perKind = new Map(kinds.map((k) => [k, []]));
  const tryPlace = (x, z, kind) => {
    if (Math.abs(x) > HALF - 7 || Math.abs(z) > HALF - 7) return false;
    const o = occ.at(x, z);
    if (o && o !== 5) return false;
    const lvl = phys.waterLevel(x, z), h = phys.height(x, z);
    if (lvl > -1e9 && h < lvl + 0.4) return false;
    const n = phys.normal(x, z);
    if (n[1] < 0.72) return false;
    perKind.get(kind).push([x, h, z, rng() * 6.283, 0.75 + rng() * 0.5]);
    occ.markCircle(x, z, 1.2, 7);
    return true;
  };
  for (const p of map.parks || []) for (let k = 0; k < 90; k++) { const a = rng() * 6.283, r = Math.sqrt(rng()) * p.r; tryPlace(p.x + Math.cos(a) * r, p.z + Math.sin(a) * r, rng.pick(kinds.filter((k2) => k2 !== 'coconut').concat(kinds[0]))); }
  let placed = 0;
  for (let k = 0; k < count * 5 && placed < count; k++) {
    // clustered: groves around seed points
    const cx = (rng() - 0.5) * HALF * 2, cz = (rng() - 0.5) * HALF * 2;
    const kind = rng.pick(kinds);
    for (let q = 0; q < 4 && placed < count; q++) if (tryPlace(cx + (rng() - 0.5) * 22, cz + (rng() - 0.5) * 22, kind)) placed++;
  }
  return treeMeshes(phys, perKind);
}

// instanced trunks + wind-swayed foliage for explicit positions: perKind = Map(kind -> [[x,h,z,rot,scale],...])
export function treeMeshes(phys, perKind) {
  const meshes = [], mats = [];
  const bark = new THREE.MeshStandardMaterial({ color: 0x7a6552, roughness: 0.95 });
  for (const [kind, list] of perKind) {
    if (!list.length) continue;
    const P = treeParts(kind);
    const trunkMat = bark.clone();
    if (kind === 'bamboo') trunkMat.color.set(0x7e8a3a);
    if (P.palm) trunkMat.color.set(0x8a7a64);
    const leafMat = new THREE.MeshStandardMaterial({ map: foliageTexture(P.leafTex), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.85 });
    if (kind === 'poplar') leafMat.color.set(0xd8e08a);
    const uniforms = { uTime: { value: 0 } };
    leafMat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = uniforms.uTime;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace('#include <begin_vertex>', `#include <begin_vertex>
        float ph = instanceMatrix[3].x * 0.11 + instanceMatrix[3].z * 0.07;
        float k = max(0.0, position.y - 2.0) * 0.022;
        transformed.x += sin(uTime * 1.3 + ph) * k;
        transformed.z += cos(uTime * 1.1 + ph * 1.3) * k * 0.7;`);
    };
    mats.push(uniforms);
    const it = new THREE.InstancedMesh(P.trunk, trunkMat, list.length);
    const il = new THREE.InstancedMesh(P.leaf, leafMat, list.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    list.forEach(([x, h, z, r, sc], i) => {
      q.setFromEuler(new THREE.Euler(0, r, 0)); s.set(sc, sc, sc);
      m.compose(new THREE.Vector3(x, h - 0.1, z), q, s);
      it.setMatrixAt(i, m); il.setMatrixAt(i, m);
      phys.addBox(x - 0.28, h, z - 0.28, x + 0.28, h + 5 * sc, z + 0.28, SURF.wood);
    });
    it.castShadow = il.castShadow = true; it.receiveShadow = il.receiveShadow = true;
    it.computeBoundingSphere(); il.computeBoundingSphere();
    meshes.push(it, il);
  }
  return { meshes, update(t) { for (const u of mats) u.uTime.value = t; } };
}

// ================================================================== GPU grass that follows the camera
export class GrassField {
  constructor(phys, map, occ, quality) {
    const N = quality === 'high' ? 90000 : 45000;
    this.size = quality === 'high' ? 64 : 48;
    const R = phys.res, W1 = R + 1;
    // RG float texture: height, grass mask
    const data = new Float32Array(W1 * W1 * 4);
    for (let j = 0; j <= R; j++) for (let i = 0; i <= R; i++) {
      const k = j * W1 + i, x = -HALF + i * phys.cellM, z = -HALF + j * phys.cellM;
      data[k * 4] = phys.h[k];
      const o = occ.at(x, z);
      const lvl = phys.waterLevel(x, z);
      const n = phys.normal(x, z);
      data[k * 4 + 1] = (o === 0 || o === 5 || o === 7) && !(lvl > -1e9 && phys.h[k] < lvl + 0.5) && n[1] > 0.8 ? 1 : 0;
    }
    const tex = new THREE.DataTexture(data, W1, W1, THREE.RGBAFormat, THREE.FloatType);
    tex.magFilter = tex.minFilter = THREE.LinearFilter; tex.needsUpdate = true;
    const blade = new THREE.PlaneGeometry(0.035, 0.38, 1, 3); blade.translate(0, 0.19, 0);
    const p = blade.attributes.position;
    for (let k = 0; k < p.count; k++) { const y = p.getY(k) / 0.38; p.setX(k, p.getX(k) * (1 - y * 0.9)); p.setZ(k, y * y * 0.06); }
    const g = new THREE.InstancedBufferGeometry();
    g.index = blade.index; g.attributes.position = blade.attributes.position; g.attributes.uv = blade.attributes.uv; g.attributes.normal = blade.attributes.normal;
    const offs = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) { offs[i * 4] = Math.random(); offs[i * 4 + 1] = Math.random(); offs[i * 4 + 2] = Math.random() * 6.283; offs[i * 4 + 3] = 0.6 + Math.random() * 0.8; }
    g.setAttribute('offs', new THREE.InstancedBufferAttribute(offs, 4));
    g.instanceCount = N;
    const dry = map.id === 'delhi' || map.id === 'chennai' || map.id === 'gurugram';
    const base = new THREE.Color(dry ? '#4d5228' : '#2c4a1a');
    const tip = new THREE.Color(dry ? '#8e8a4e' : '#6e8c3a');
    this.uniforms = { uH: { value: tex }, uCenter: { value: new THREE.Vector2() }, uSize: { value: this.size }, uTime: { value: 0 }, uBase: { value: base }, uTip: { value: tip }, uHalf: { value: HALF } };
    const mat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.9 });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.uniforms);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
        attribute vec4 offs; uniform sampler2D uH; uniform vec2 uCenter; uniform float uSize, uTime, uHalf; varying float vT;`)
        .replace('#include <begin_vertex>', `
        vec2 wp = uCenter + (fract(offs.xy - uCenter / uSize) - 0.5) * uSize;
        vec2 huv = (wp + uHalf) / (uHalf * 2.0);
        vec4 hs = texture2D(uH, huv);
        float d = length(wp - uCenter) / (uSize * 0.5);
        float sc = offs.w * hs.g * (1.0 - smoothstep(0.7, 1.0, d));
        vec3 transformed = position * vec3(1.0, sc, 1.0);
        float c = cos(offs.z), s = sin(offs.z);
        transformed.xz = mat2(c, -s, s, c) * transformed.xz;
        float bendK = transformed.y * transformed.y;
        transformed.x += sin(uTime * 1.8 + wp.x * 0.3 + wp.y * 0.2) * 0.12 * bendK;
        transformed.z += cos(uTime * 1.4 + wp.y * 0.25) * 0.08 * bendK;
        transformed += vec3(wp.x, hs.r, wp.y);
        vT = position.y / 0.38 * (0.75 + 0.25 * fract(offs.x * 91.7));`)
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uBase, uTip; varying float vT;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = mix(uBase, uTip, vT);');
    };
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
  }
  update(cam, t) { this.uniforms.uCenter.value.set(cam.x, cam.z); this.uniforms.uTime.value = t; }
}

// ================================================================== minimap
function drawMinimap(phys, map, roads, ctx, layers) {
  const S = 640, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  const base = { grass: [96, 128, 70], grassSparse: [128, 132, 86], forest: [70, 96, 56], gravel: [150, 140, 125], redDirt: [150, 100, 70], dryGround: [160, 140, 110] }[map.ground[0]] || [110, 130, 80];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const wx = -HALF + (x / S) * HALF * 2, wz = -HALF + (y / S) * HALF * 2;
    const h = phys.height(wx, wz);
    const n = phys.normal(wx, wz);
    const shade = clamp(0.75 + (n[0] * -0.6 + n[2] * -0.4) * 1.5, 0.45, 1.25);
    let r = base[0], gg = base[1], b = base[2];
    if (map.id === 'spiti' && h > map.terrain.base + (map.snowLine || 70)) { r = gg = b = 235; }
    else if (n[1] < 0.8) { r = 130; gg = 125; b = 118; }
    const lvl = phys.waterLevel(wx, wz);
    if (lvl > -1e9 && h < lvl) { r = 40; gg = 92; b = 118; }
    const k = (y * S + x) * 4;
    img.data[k] = r * shade; img.data[k + 1] = gg * shade; img.data[k + 2] = b * shade; img.data[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const toC = (x, z) => [((x + HALF) / (HALF * 2)) * S, ((z + HALF) / (HALF * 2)) * S];
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (const r of roads) {
    g.strokeStyle = r.street ? 'rgba(70,70,70,0.9)' : 'rgba(55,55,58,0.95)';
    g.lineWidth = Math.max(2, (r.w / (HALF * 2)) * S);
    g.beginPath(); r.pts.forEach(([x, z], i) => { const [a, b] = toC(x, z); if (i) g.lineTo(a, b); else g.moveTo(a, b); }); g.stroke();
  }
  g.fillStyle = 'rgba(210,205,195,0.95)';
  for (const b of ctx.buildings) {
    const [x0, z0, x1, z1] = b.F.aabb(-b.w / 2, -b.d / 2, b.w / 2, b.d / 2);
    const [a, bb] = toC(x0, z0), [c2, d] = toC(x1, z1);
    g.fillStyle = b.tower ? 'rgba(160,170,185,0.95)' : 'rgba(215,208,196,0.95)';
    g.fillRect(a, bb, Math.max(1, c2 - a), Math.max(1, d - bb));
  }
  return c;
}

// Real-place world built from OpenStreetMap data (© OpenStreetMap contributors, ODbL).
// Every road is the real road at its real position (widths from road type / lane count, flyovers raised),
// every building is the real footprint extruded to a plausible height (near-rectangular house-sized ones
// become enterable shells with stairs and loot), every named shop / pub / bank gets its sign on the
// shopfront facing its street. Parks, avenue trees, street lamps with light pools, billboards.
import * as THREE from 'three';
import { Physics, HALF, SURF } from './physics.js';
import { GeoBuilder, col, WHITE } from './geo.js';
import { shell, SignAtlas } from './buildings.js';
import { buildProp, PROP_PAD } from './landmarks.js';
import { MM, initModelMats, mergeGroup, car, autoRickshaw, bike } from './models.js';
import { createMaterials, loadTerrainLayers, facadeTextures, resiFacadeTextures, waterNormals, MATDEFS, dotTexture } from './assets.js';
import { hashStr, mulberry32, makeNoise, clamp, segDist } from './util.js';
import { Occ, makeTerrainMaterial, buildTerrainMesh, treeMeshes, GrassField } from './world.js';

const RW = { motorway: 18, trunk: 18, primary: 14, secondary: 12, tertiary: 10, unclassified: 8, residential: 6.5, living_street: 5, service: 4.5, pedestrian: 4,
  motorway_link: 8, trunk_link: 8, primary_link: 8, secondary_link: 7, tertiary_link: 7 };
const RANK = { motorway: 7, trunk: 7, primary: 6, trunk_link: 5, primary_link: 5, motorway_link: 5, secondary: 5, secondary_link: 4, tertiary: 4, tertiary_link: 3, unclassified: 2, residential: 2, living_street: 1, pedestrian: 1, service: 0 };
const MAJOR = new Set(['motorway', 'trunk', 'primary', 'secondary', 'trunk_link', 'primary_link', 'motorway_link']);
const GREEN = new Set(['park', 'garden', 'playground', 'pitch', 'recreation_ground', 'grass', 'grassland', 'common', 'village_green', 'meadow', 'cemetery', 'scrub', 'wood', 'forest', 'sports_centre']);

// ------------------------------------------------------------------ geometry helpers
const toPts = (flat) => { const p = []; for (let i = 0; i < flat.length; i += 2) p.push([flat[i], flat[i + 1]]); return p; };
function ring(flat) {
  const p = toPts(flat);
  if (p.length > 2 && Math.hypot(p[0][0] - p[p.length - 1][0], p[0][1] - p[p.length - 1][1]) < 0.5) p.pop();
  return p;
}
function areaSigned(p) { let a = 0; for (let i = 0; i < p.length; i++) { const [x0, z0] = p[i], [x1, z1] = p[(i + 1) % p.length]; a += x0 * z1 - x1 * z0; } return a / 2; }
function centroid(p) { let x = 0, z = 0; for (const q of p) { x += q[0]; z += q[1]; } return [x / p.length, z / p.length]; }
function inPoly(x, z, p) {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, zi] = p[i], [xj, zj] = p[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}
function obb(p) {
  let best = null;
  for (let i = 0; i < p.length; i++) {
    const [ax, az] = p[i], [bx, bz] = p[(i + 1) % p.length];
    const L = Math.hypot(bx - ax, bz - az); if (L < 0.5) continue;
    const ux = (bx - ax) / L, uz = (bz - az) / L;
    let a0 = 1e9, a1 = -1e9, b0 = 1e9, b1 = -1e9;
    for (const [x, z] of p) { const a = x * ux + z * uz, b = -x * uz + z * ux; if (a < a0) a0 = a; if (a > a1) a1 = a; if (b < b0) b0 = b; if (b > b1) b1 = b; }
    const area = (a1 - a0) * (b1 - b0);
    if (!best || area < best.area) best = { area, ang: Math.atan2(uz, ux), w: a1 - a0, d: b1 - b0 };
  }
  return best;
}
function bbox(p) { let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; for (const [x, z] of p) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; } return [x0, z0, x1, z1]; }

// uniform grid of items by bounding box
class Grid {
  constructor(cell = 32) { this.c = cell; this.n = Math.ceil((HALF * 2) / cell); this.cells = new Map(); }
  key(i, j) { return j * this.n + i; }
  add(item, x0, z0, x1, z1) {
    const c = this.c;
    const i0 = clamp(Math.floor((x0 + HALF) / c), 0, this.n - 1), i1 = clamp(Math.floor((x1 + HALF) / c), 0, this.n - 1);
    const j0 = clamp(Math.floor((z0 + HALF) / c), 0, this.n - 1), j1 = clamp(Math.floor((z1 + HALF) / c), 0, this.n - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const k = this.key(i, j); let a = this.cells.get(k); if (!a) this.cells.set(k, a = []); a.push(item); }
  }
  near(x, z, r) {
    const c = this.c, out = new Set();
    const i0 = clamp(Math.floor((x - r + HALF) / c), 0, this.n - 1), i1 = clamp(Math.floor((x + r + HALF) / c), 0, this.n - 1);
    const j0 = clamp(Math.floor((z - r + HALF) / c), 0, this.n - 1), j1 = clamp(Math.floor((z + r + HALF) / c), 0, this.n - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const a = this.cells.get(this.key(i, j)); if (a) for (const it of a) out.add(it); }
    return out;
  }
}

// sign atlases, grown on demand; each atlas becomes one material key in the builder
class SignBank {
  constructor(mats, night) { this.mats = mats; this.night = night; this.atlases = []; this.cur = null; }
  add(lines, opts) {
    if (!this.cur || this.cur.n >= 64) {
      const a = new SignAtlas();
      const key = 'poisigns' + this.atlases.length;
      this.mats[key] = new THREE.MeshStandardMaterial({ map: a.tex, emissiveMap: a.tex, emissive: 0xffffff, emissiveIntensity: this.night ? 1.35 : 0.35, roughness: 0.55, vertexColors: true });
      a.key = key; this.atlases.push(a); this.cur = a;
    }
    return { key: this.cur.key, uv: this.cur.add(lines, opts) };
  }
}

// ------------------------------------------------------------------ main
export async function generateOSMWorld(map, opts = {}) {
  const t0 = performance.now();
  const progress = opts.onProgress || (() => {});
  const quality = opts.quality || 'medium';
  progress(0.02, 'Downloading street map');
  const res0 = await fetch(new URL('../' + map.osm, import.meta.url));
  if (!res0.ok) throw new Error(`map data ${map.osm} missing (${res0.status})`);
  const data = await res0.json();
  const seed = hashStr(map.id);
  const rng = mulberry32(seed);
  const noise = makeNoise(seed + 7);
  const phys = new Physics(512);
  initModelMats();
  const group = new THREE.Group(); group.name = 'world';
  const night = !!map.night;
  const T = map.terrain;

  // ---------------------------------------------------------------- terrain (Bengaluru is gently rolling)
  const R = phys.res, C = phys.cellM, W1 = R + 1;
  for (let j = 0; j <= R; j++) for (let i = 0; i <= R; i++) {
    const x = -HALF + i * C, z = -HALF + j * C;
    phys.h[j * W1 + i] = T.base + T.amp * noise.fbm(x * T.freq, z * T.freq, 3);
  }
  phys.bakeWater();
  const H = (x, z) => phys.height(x, z);

  // ---------------------------------------------------------------- materials
  const mats = {};
  for (const k of Object.keys(MATDEFS)) { const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0, vertexColors: true }); m.name = k; m.userData.scale = MATDEFS[k].scale; mats[k] = m; }
  Object.assign(mats, MM);
  const signAtlas = new SignAtlas();
  mats.signs = new THREE.MeshStandardMaterial({ map: signAtlas.tex, emissiveMap: signAtlas.tex, emissive: 0xffffff, emissiveIntensity: night ? 1.3 : 0.35, roughness: 0.6, vertexColors: true });
  mats.marking = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const facadeKeys = { glass: [], conc: [], resi: [] };
  for (let i = 0; i < 3; i++) {
    for (const st of ['glass', 'conc']) {
      const ft = facadeTextures(seed + i * 31 + (st === 'glass' ? 0 : 7), st);
      const key = 'facade_' + st + i;
      mats[key] = new THREE.MeshStandardMaterial({ map: ft.map, emissiveMap: ft.emissive, emissive: 0xffffff, emissiveIntensity: night ? 0.9 : 0.1, roughness: st === 'glass' ? 0.12 : 0.7, metalness: st === 'glass' ? 0.8 : 0.1, vertexColors: true });
      mats[key].userData.scale = 24; facadeKeys[st].push(key);
    }
    const rt = resiFacadeTextures(seed + i * 57);
    const key = 'facade_resi' + i;
    mats[key] = new THREE.MeshStandardMaterial({ map: rt.map, emissiveMap: rt.emissive, emissive: 0xffffff, emissiveIntensity: night ? 1.0 : 0.05, roughness: 0.85, metalness: 0, vertexColors: true });
    mats[key].userData.scale = 20; facadeKeys.resi.push(key);
  }
  mats.shopglow = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  const geo = new GeoBuilder(mats);
  geo.noChunk = (k) => k.startsWith('poisigns') || k === 'shopglow' || k === 'signs' || k === 'neon' || k === 'lamp';
  const occ = new Occ();
  const bank = new SignBank(mats, night);
  const ctx = {
    geo, phys, rng, map, occ, group, night, roads: [],
    loot: [], eggs: [], climbs: [], animated: [], signMats: [], mist: [], potholes: [], slowZones: [], noLoot: [],
    buildings: [], roofs: [], flagPoles: [], towerTops: [], harthalZone: null, signs: signAtlas,
    pickFacade: (st) => rng.pick(facadeKeys[st === 'glass' ? 'glass' : 'conc']),
    waterMat: new THREE.MeshStandardMaterial({ color: '#27616a', roughness: 0.06, transparent: true, opacity: 0.85 }),
    potholeMat: new THREE.MeshStandardMaterial({ color: 0x1a1612, roughness: 1, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
  };

  // ---------------------------------------------------------------- roads
  progress(0.1, 'Laying 380 km of real roads');
  const segGrid = new Grid(32);
  const roads = [];
  data.roads.forEach(([type, name, flat, lanes, oneway, bridge, layer], ri) => {
    const pts = toPts(flat);
    if (pts.length < 2) return;
    let w = RW[type] || 6;
    const ln = parseInt(lanes, 10);
    if (ln > 0) w = Math.max(w, ln * (oneway === 'yes' ? 3.4 : 3.2) + 1);
    const elevated = bridge === 'yes' && (parseInt(layer, 10) >= 1 || /flyover/i.test(name || ''));
    const r = { type, name, pts, w, rank: RANK[type] ?? 1, major: MAJOR.has(type), street: !MAJOR.has(type) && type !== 'tertiary', elevated, deck: elevated ? 6.5 * Math.max(1, parseInt(layer, 10) || 1) : 0, ri };
    roads.push(r);
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const seg = { ax, az, bx, bz, w, road: r };
      segGrid.add(seg, Math.min(ax, bx) - w, Math.min(az, bz) - w, Math.max(ax, bx) + w, Math.max(az, bz) + w);
    }
  });
  ctx.roads = roads;
  const nearestRoad = (x, z, rad = 60, filter) => {
    let best = null;
    for (const s of segGrid.near(x, z, rad)) {
      if (filter && !filter(s.road)) continue;
      const q = segDist(x, z, s.ax, s.az, s.bx, s.bz);
      if (!best || q.d - s.w / 2 < best.d - best.s.w / 2) best = { d: q.d, cx: q.cx, cz: q.cz, s };
    }
    return best;
  };

  // road meshes: miter-joined ribbons draped on the terrain; flyovers raised with ramps inside the bridge way
  const lampPos = [], poolPos = [];
  for (const r of roads) {
    // densify so the ribbon follows the terrain and ramps are smooth
    const d = [];
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 6));
      for (let k = 0; k < n; k++) d.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
    }
    d.push(r.pts[r.pts.length - 1]);
    const dist = [0]; for (let i = 1; i < d.length; i++) dist.push(dist[i - 1] + Math.hypot(d[i][0] - d[i - 1][0], d[i][1] - d[i - 1][1]));
    const L = dist[dist.length - 1];
    const yo = 0.04 + r.rank * 0.006 + (r.ri % 3) * 0.0015;
    const ramp = Math.min(70, L * 0.3);
    const ys = d.map(([x, z], i) => H(x, z) + yo + (r.elevated ? r.deck * smoothstep(0, ramp, dist[i]) * smoothstep(0, ramp, L - dist[i]) : 0));
    // per-vertex miter normals
    const nrm = d.map((_, i) => {
      const a = d[Math.max(0, i - 1)], b = d[Math.min(d.length - 1, i + 1)];
      let nx = -(b[1] - a[1]), nz = b[0] - a[0]; const l = Math.hypot(nx, nz) || 1; return [nx / l, nz / l];
    });
    const hw = r.w / 2, s = 1 / 7;
    const mat = r.street ? 'asphaltWorn' : 'asphalt';
    for (let i = 0; i < d.length - 1; i++) {
      const [ax, az] = d[i], [bx, bz] = d[i + 1];
      const [anx, anz] = nrm[i], [bnx, bnz] = nrm[i + 1];
      const ya = ys[i], yb = ys[i + 1];
      geo.quad([[ax + anx * hw, ya, az + anz * hw], [bx + bnx * hw, yb, bz + bnz * hw], [bx - bnx * hw, yb, bz - bnz * hw], [ax - anx * hw, ya, az - anz * hw]], mat, WHITE,
        [[r.w * s, dist[i] * s], [r.w * s, dist[i + 1] * s], [0, dist[i + 1] * s], [0, dist[i] * s]]);
      if (r.w >= 10 && Math.floor(dist[i] / 4.5) % 2 === 0) {
        const q = 0.08;
        geo.quad([[ax + anx * q, ya + 0.01, az + anz * q], [bx + bnx * q, yb + 0.01, bz + bnz * q], [bx - bnx * q, yb + 0.01, bz - bnz * q], [ax - anx * q, ya + 0.01, az - anz * q]], 'marking', col(r.major ? '#f2f2f2' : '#dcdcdc'), [[0, 0], [0, 1], [1, 1], [1, 0]]);
      }
      if (r.w >= 12) for (const sd of [-1, 1]) {
        const e = hw - 0.4, q = 0.07;
        const P = (o, t) => [(t ? bx + bnx * o * sd : ax + anx * o * sd), (t ? yb : ya) + 0.01, (t ? bz + bnz * o * sd : az + anz * o * sd)];
        const pts = [P(e - q, 0), P(e - q, 1), P(e + q, 1), P(e + q, 0)];
        geo.quad(sd > 0 ? pts.slice().reverse() : pts, 'marking', col('#f2c200'), [[0, 0], [0, 1], [1, 1], [1, 0]]);
      }
      // raised deck: collider + underside + parapets + pillars
      if (r.elevated && (ys[i] - H(ax, az) > 1.2 || ys[i + 1] - H(bx, bz) > 1.2)) {
        const y = Math.min(ya, yb) - yo;
        const xs = [ax + anx * hw, ax - anx * hw, bx + bnx * hw, bx - bnx * hw], zs = [az + anz * hw, az - anz * hw, bz + bnz * hw, bz - bnz * hw];
        phys.addBox(Math.min(...xs), y - 0.7, Math.min(...zs), Math.max(...xs), Math.max(ya, yb) - yo + 0.02, Math.max(...zs), SURF.concrete);
        geo.quad([[ax - anx * hw, ya - 0.8, az - anz * hw], [bx - bnx * hw, yb - 0.8, bz - bnz * hw], [bx + bnx * hw, yb - 0.8, bz + bnz * hw], [ax + anx * hw, ya - 0.8, az + anz * hw]], 'concrete', col('#8f8b84'));
        for (const sd of [-1, 1]) {
          const px = (ax + bx) / 2 + ((anx + bnx) / 2) * sd * (hw + 0.15), pz = (az + bz) / 2 + ((anz + bnz) / 2) * sd * (hw + 0.15);
          const m = new THREE.Matrix4().makeRotationY(Math.atan2(bx - ax, bz - az)).setPosition(px, (ya + yb) / 2 + 0.5, pz);
          geo.geom(new THREE.BoxGeometry(0.3, 1.0, Math.hypot(bx - ax, bz - az) + 0.05), m, 'concrete', col('#c9c4ba'));
          phys.addBox(px - 0.2, y, pz - 0.2, px + 0.2, y + 1.1, pz + 0.2, SURF.concrete);
        }
        if (i % 4 === 0 && ya - H(ax, az) > 3) {
          const g = H(ax, az) - 0.5;
          geo.geom(new THREE.BoxGeometry(1.6, ya - 0.8 - g, 1.6), new THREE.Matrix4().setPosition(ax, (g + ya - 0.8) / 2, az), 'concrete', col('#a8a39a'));
          phys.addBox(ax - 0.8, g, az - 0.8, ax + 0.8, ya - 0.8, az + 0.8, SURF.concrete);
        }
      }
    }
    // street lamps every ~30 m, alternating sides; light pools on the road beneath
    if (r.type !== 'service' || rng() < 0.3) {
      const every = r.major ? 26 : 32;
      for (let s0 = every * rng(); s0 < L; s0 += every) {
        let i = 1; while (i < dist.length - 1 && dist[i] < s0) i++;
        const t = (s0 - dist[i - 1]) / Math.max(0.01, dist[i] - dist[i - 1]);
        const x = d[i - 1][0] + (d[i][0] - d[i - 1][0]) * t, z = d[i - 1][1] + (d[i][1] - d[i - 1][1]) * t;
        const sd = (Math.round(s0 / every) % 2) ? 1 : -1;
        const [nx, nz] = nrm[i];
        const lx = x + nx * sd * (hw + 0.6), lz = z + nz * sd * (hw + 0.6);
        const y = ys[i] - yo;
        lampPos.push([lx, lz, y, Math.atan2(-nx * sd, -nz * sd)]);
        poolPos.push([x + nx * sd * (hw - 1.4), z + nz * sd * (hw - 1.4), y + 0.08]);
      }
    }
    // occupancy: road corridor
    for (let i = 0; i < d.length - 1; i++) {
      const [ax, az] = d[i], [bx, bz] = d[i + 1];
      const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 2);
      for (let k = 0; k <= n; k++) { const t = k / n; occ.markCircle(ax + (bx - ax) * t, az + (bz - az) * t, hw + 0.5, 3); }
    }
    r.dense = d; r.meshProf = ys.map((y, i) => ({ y: y - yo, bridge: r.elevated && y - yo - H(d[i][0], d[i][1]) > 1.2 })); r.meshDense = d;
  }

  // ---------------------------------------------------------------- parks + grounds
  progress(0.3, 'Planting parks');
  const perKind = new Map(map.trees.kinds.map((k) => [k, []]));
  const addTree = (x, z, kind, sc = 1) => {
    if (Math.abs(x) > HALF - 8 || Math.abs(z) > HALF - 8) return;
    const o = occ.at(x, z); if (o && o !== 5) return;
    perKind.get(kind).push([x, H(x, z), z, rng() * 6.283, (0.8 + rng() * 0.45) * sc]);
    occ.markCircle(x, z, 1.6, 7);
  };
  const greens = [];
  for (const [kind, name, flat] of data.areas) {
    const p = ring(flat); if (p.length < 3) continue;
    const green = GREEN.has(kind);
    const park = kind === 'parking';
    if (!green && !park) continue;
    const contour = p.map(([x, z]) => new THREE.Vector2(x, z));
    let tris; try { tris = THREE.ShapeUtils.triangulateShape(contour, []); } catch { continue; }
    const matK = park ? 'asphaltWorn' : kind === 'pitch' ? 'grassSparse' : 'grass';
    for (const [a, b, c] of tris) {
      const A = p[a], B = p[b], Cc = p[c];
      const pa = [A[0], H(A[0], A[1]) + 0.03, A[1]], pb = [B[0], H(B[0], B[1]) + 0.03, B[1]], pc = [Cc[0], H(Cc[0], Cc[1]) + 0.03, Cc[1]];
      const up = (pb[2] - pa[2]) * (pc[0] - pa[0]) - (pb[0] - pa[0]) * (pc[2] - pa[2]);
      geo.tri(up > 0 ? [pa, pb, pc] : [pa, pc, pb], matK, WHITE);
    }
    if (green) {
      greens.push({ p, name, kind });
      const [x0, z0, x1, z1] = bbox(p);
      const a = Math.abs(areaSigned(p));
      if (kind !== 'pitch') {
        const n = Math.min(160, Math.floor(a / 140));
        for (let k = 0; k < n * 3 && k < 500; k++) { const x = x0 + rng() * (x1 - x0), z = z0 + rng() * (z1 - z0); if (inPoly(x, z, p) && rng() < 0.4) addTree(x, z, rng.pick(map.trees.kinds), 1.15); }
      }
      for (let x = Math.ceil(x0 / 2) * 2; x < x1; x += 2) for (let z = Math.ceil(z0 / 2) * 2; z < z1; z += 2) if (inPoly(x, z, p) && !occ.at(x, z)) occ.mark(x - 0.9, z - 0.9, x + 0.9, z + 0.9, 5);
    }
  }

  // ---------------------------------------------------------------- easter-egg props, snapped to the nearest real street
  for (const P of map.props) {
    const nr = nearestRoad(P.x, P.z, 120);
    if (nr && !['foam', 'harthal'].includes(P.kind)) {
      if (P.kind === 'pothole' || P.kind === 'jam' || P.kind === 'coder_bike') { P.x = nr.cx; P.z = nr.cz; if (P.kind === 'jam') P.dir = Math.abs(nr.s.bx - nr.s.ax) > Math.abs(nr.s.bz - nr.s.az) ? 'x' : 'z'; }
      else {
        let vx = P.x - nr.cx, vz = P.z - nr.cz; const l = Math.hypot(vx, vz) || 1; vx /= l; vz /= l;
        if (l < 0.5) { const dx = nr.s.bx - nr.s.ax, dz = nr.s.bz - nr.s.az, dl = Math.hypot(dx, dz) || 1; vx = -dz / dl; vz = dx / dl; }
        const off = nr.s.w / 2 + (P.kind === 'billboard' ? 5 : 2.4);
        P.x = nr.cx + vx * off; P.z = nr.cz + vz * off;
        // face the street
        const ang = Math.atan2(-vx, -vz);
        P.rot = ((Math.round(ang / (Math.PI / 2)) % 4) + 4) % 4;
      }
    }
    const r = PROP_PAD[P.kind]; if (r) occ.markCircle(P.x, P.z, r, 4);
  }

  // ---------------------------------------------------------------- buildings
  progress(0.38, 'Raising 22,000 real buildings');
  const bGrid = new Grid(32);
  const polys = [];
  const walls = map.walls;
  const tankPos = [];
  const maxShells = quality === 'low' ? 450 : quality === 'high' ? 1500 : 900;
  let shells = 0, prisms = 0;
  // pick enterable candidates spread over the map: shuffle order deterministically
  const order = data.buildings.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  for (const bi of order) {
    const [btype, levelsTag, heightTag, flat, bname, bkind] = data.buildings[bi];
    let p = ring(flat);
    if (p.length < 3) continue;
    const a = areaSigned(p);
    const area = Math.abs(a);
    if (area < 6) continue;
    if (a > 0) p = p.slice().reverse();                   // clockwise -> outward wall normals
    const [x0, z0, x1, z1] = bbox(p);
    if (x0 < -HALF + 8 || x1 > HALF - 8 || z0 < -HALF + 8 || z1 > HALF - 8) continue;
    // skip footprints sitting on a road (bad data / overpasses)
    const [cx, cz] = centroid(p);
    if (occ.at(cx, cz) === 4) continue;
    const brng = mulberry32(seed ^ (bi * 2654435761));
    const nr = nearestRoad(cx, cz, 70);
    const nearMajor = nr && nr.s.road.major && nr.d < 40;
    const levels = parseInt(levelsTag, 10) || 0, hTag = parseFloat(heightTag) || 0;
    let floors;
    if (levels) floors = levels;
    else if (hTag) floors = Math.max(1, Math.round(hTag / 3.2));
    else {
      const r = brng();
      floors = area < 45 ? 1 + (r < 0.4 ? 1 : 0) : area < 120 ? 2 + Math.floor(r * 2.2) : area < 320 ? 2 + Math.floor(r * 3) : area < 900 ? 3 + Math.floor(r * 4) : 4 + Math.floor(r * 6);
      if (nearMajor && area > 80) floors += 1 + Math.floor(brng() * 2);
      if (['commercial', 'office', 'retail', 'hotel', 'college', 'university', 'hospital'].includes(btype)) floors += 2;
      if (['roof', 'shed', 'garage', 'construction'].includes(btype)) floors = 1;
    }
    const h = hTag || floors * 3.2 + 0.5;
    polys.push({ p, h, name: bname, kind: bkind });
    bGrid.add(polys[polys.length - 1], x0, z0, x1, z1);
    const wc = col(brng.pick(walls), 0.06, brng);
    // enterable shell?
    const o = obb(p);
    if (o && shells < maxShells && floors <= 4 && area >= 55 && area <= 560 && btype !== 'roof' && btype !== 'construction') {
      const deg = ((o.ang * 180) / Math.PI % 90 + 90) % 90;
      const dev = Math.min(deg, 90 - deg);
      const fill = area / o.area;
      const w = x1 - x0 - 0.7, d = z1 - z0 - 0.7;
      if (dev < 8 && fill > 0.86 && Math.min(w, d) >= 7.4 && Math.max(w, d) <= 26) {
        // door faces the nearest street
        let rot = 0;
        if (nr) { const vx = nr.cx - cx, vz = nr.cz - cz; rot = Math.abs(vx) > Math.abs(vz) ? (vx > 0 ? 1 : 3) : (vz > 0 ? 0 : 2); }
        const lw = rot % 2 ? d : w, ld = rot % 2 ? w : d;
        const shop = nearMajor && brng() < 0.75 || !!bkind;
        try {
          shell(ctx, { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, w: lw, d: ld, rot, floors: Math.max(1, Math.min(4, floors)), wallCol: wc, roof: 'flat', grills: true, balcony: floors > 1 && brng() < 0.45, shop, faceUphill: false, plinth: 0.25 });
          shells++;
          occ.mark(x0, z0, x1, z1, 6);
          continue;
        } catch (e) { console.warn('shell failed', e); }
      }
    }
    // extruded footprint
    prism(p, h, wc, btype, area, brng);
    prisms++;
    occ.mark(x0, z0, x1, z1, 6);
  }

  function prism(p, h, wc, btype, area, brng) {
    let gmin = Infinity, gmax = -Infinity;
    for (const [x, z] of p) { const g = H(x, z); if (g < gmin) gmin = g; if (g > gmax) gmax = g; }
    const base = gmin - 0.4, top = gmax + h;
    const glassy = area > 700 && (btype === 'commercial' || btype === 'office' || h > 20) || btype === 'office';
    const fk = glassy ? rng.pick(facadeKeys.glass) : rng.pick(facadeKeys.resi);
    const U = glassy ? 24 : 20, V = glassy ? 24 : 25.6;
    const c = glassy ? col(brng.pick(['#cfd8e0', '#e6ecf1', '#b8c6d4'])) : wc;
    let per = 0;
    for (let i = 0; i < p.length; i++) {
      const [ax, az] = p[i], [bx, bz] = p[(i + 1) % p.length];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.05) continue;
      const u0 = per / U, u1 = (per + L) / U, v0 = (base - gmin + 0.4) / V, v1 = (top - gmin + 0.4) / V;
      geo.quad([[ax, base, az], [bx, base, bz], [bx, top, bz], [ax, top, az]], fk, c, [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
      per += L;
    }
    // roof cap + a parapet lip
    let tris; try { tris = THREE.ShapeUtils.triangulateShape(p.map(([x, z]) => new THREE.Vector2(x, z)), []); } catch { tris = []; }
    const roofC = col(brng.pick(['#8e8a82', '#9a958b', '#7f7b74', '#a39d92']));
    for (const [a, b, cc] of tris) {
      const pa = [p[a][0], top, p[a][1]], pb = [p[b][0], top, p[b][1]], pc = [p[cc][0], top, p[cc][1]];
      const up = (pb[2] - pa[2]) * (pc[0] - pa[0]) - (pb[0] - pa[0]) * (pc[2] - pa[2]);
      geo.tri(up > 0 ? [pa, pb, pc] : [pa, pc, pb], 'concrete', roofC);
    }
    if (area < 500 && brng() < 0.45) { const [cx, cz] = centroid(p); if (inPoly(cx, cz, p)) tankPos.push([cx + (brng() - 0.5) * 2, top, cz + (brng() - 0.5) * 2]); }
    // collider: horizontal slices of the footprint
    const [bx0, bz0, bx1, bz1] = bbox(p);
    const step = 1.6;
    for (let z = bz0; z < bz1; z += step) {
      let mn = Infinity, mx = -Infinity;
      for (const zz of [z + 0.05, z + step / 2, Math.min(bz1, z + step) - 0.05]) {
        for (let i = 0; i < p.length; i++) {
          const [ax, az] = p[i], [cx2, cz2] = p[(i + 1) % p.length];
          if ((az > zz) === (cz2 > zz)) continue;
          const x = ax + ((zz - az) / (cz2 - az)) * (cx2 - ax);
          if (x < mn) mn = x; if (x > mx) mx = x;
        }
      }
      if (mx > mn) phys.addBox(mn, base, z, mx, top, Math.min(bz1, z + step), glassy ? SURF.glass : SURF.concrete);
    }
  }

  // ---------------------------------------------------------------- shop signs from real named places
  progress(0.62, 'Hanging shop signs');
  const styleFor = (kind) => {
    if (/pub|bar|nightclub|biergarten/.test(kind)) return { bg: '#07090d', fg: rng.pick(['#ff3f8e', '#2de2e6', '#b4ff39', '#ffb000']), glow: true, sub: 'PUB · BREWERY' };
    if (/restaurant|fast_food|food_court/.test(kind)) return { bg: rng.pick(['#b71c1c', '#e65100', '#1b5e20', '#0d0d0d', '#f9a825']), fg: '#fff8e1', glow: night, sub: 'RESTAURANT' };
    if (/cafe|bakery|ice_cream|confectionery/.test(kind)) return { bg: rng.pick(['#3e2723', '#004d40', '#f5f0e6']), fg: '#ffd54f', glow: night, sub: kind.includes('bakery') ? 'BAKERY' : 'CAFE' };
    if (/bank|atm|bureau/.test(kind)) return { bg: '#0d47a1', fg: '#ffffff', glow: false, sub: kind.includes('atm') ? 'ATM' : 'BANK' };
    if (/pharmacy|clinic|hospital|doctors|dentist|health/.test(kind)) return { bg: '#1b5e20', fg: '#ffffff', glow: night, sub: kind.includes('pharmacy') ? 'MEDICALS 24x7' : 'CLINIC' };
    if (/clothes|beauty|hairdresser|jewel|shoes|boutique|cosmetics/.test(kind)) return { bg: rng.pick(['#880e4f', '#ffffff', '#4a148c', '#212121']), fg: rng.pick(['#ffd6ec', '#c2185b', '#ffe082']), glow: night };
    if (/advertising/.test(kind)) return { bg: '#07090d', fg: '#2de2e6', glow: true };
    return { bg: rng.pick(['#fdd835', '#ffffff', '#263238', '#e53935']), fg: '#1a1a1a', glow: night };
  };
  let signs = 0;
  const signedAt = [];
  for (const [px, pz, kind, name, brand] of data.pois) {
    if (!name || Math.abs(px) > HALF - 10 || Math.abs(pz) > HALF - 10) continue;
    if (/^(amenity:(bench|toilets|drinking_water|waste_basket|parking|bicycle_parking|recycling|shelter|telephone|post_box|vending_machine|charging_station))/.test(kind)) continue;
    const nr = nearestRoad(px, pz, 80, (rd) => rd.type !== 'service');
    if (!nr) continue;
    let nx = nr.cx - px, nz = nr.cz - pz; const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
    // find the building the place sits in; put the sign where its wall faces the street
    let sx = px, sz = pz, onWall = false;
    for (const b of bGrid.near(px, pz, 4)) {
      if (!inPoly(px, pz, b.p)) continue;
      let best = Infinity;
      for (let i = 0; i < b.p.length; i++) {
        const [ax, az] = b.p[i], [bx, bz] = b.p[(i + 1) % b.p.length];
        const ex = bx - ax, ez = bz - az;
        const den = nx * ez - nz * ex; if (Math.abs(den) < 1e-6) continue;
        const t = ((ax - px) * ez - (az - pz) * ex) / den, u = ((ax - px) * nz - (az - pz) * nx) / den;
        if (t > 0 && u >= 0 && u <= 1 && t < best) best = t;
      }
      if (best < 60) { sx = px + nx * (best + 0.14); sz = pz + nz * (best + 0.14); onWall = true; }
      break;
    }
    if (!onWall) { const t = Math.max(0, nr.d - nr.s.w / 2 - 1.6); sx = px + nx * t; sz = pz + nz * t; }
    if (signedAt.some(([x, z]) => Math.hypot(x - sx, z - sz) < 2.2)) continue;
    signedAt.push([sx, sz]);
    const st = styleFor(kind);
    const text = (brand && brand.length < name.length ? brand : name).toUpperCase().slice(0, 28);
    const lines = st.sub && text.length < 16 ? [text, st.sub] : [text];
    const S = bank.add(lines, { bg: st.bg, color: st.fg, color2: st.fg, glow: st.glow, sizes: lines.length > 1 ? [0.5, 0.24] : [0.62] });
    const w = clamp(0.36 * text.length + 1.4, 2.4, 9), hh = 1.05;
    const g = H(sx, sz), y0 = g + (onWall ? 3.0 : 3.4);
    // quad facing the street (normal = n); t runs to the viewer's right so the text reads correctly
    const tx = nz, tz = -nx;
    const uv = S.uv;
    geo.quad([[sx - tx * w / 2, y0, sz - tz * w / 2], [sx + tx * w / 2, y0, sz + tz * w / 2], [sx + tx * w / 2, y0 + hh, sz + tz * w / 2], [sx - tx * w / 2, y0 + hh, sz - tz * w / 2]], S.key, WHITE,
      [[uv[0], uv[1]], [uv[2], uv[1]], [uv[2], uv[3]], [uv[0], uv[3]]]);
    const back = new THREE.Matrix4().makeRotationY(Math.atan2(nx, nz)).setPosition(sx - nx * 0.07, y0 + hh / 2, sz - nz * 0.07);
    geo.geom(new THREE.BoxGeometry(w + 0.16, hh + 0.16, 0.1), back, 'metal', col('#1c1f24'));
    if (onWall) {
      // lit shopfront under the sign
      const gw = Math.min(w, 5), glow = /pub|bar|restaurant|cafe|fast_food/.test(kind) ? [0.55, 0.36, 0.16] : [0.42, 0.4, 0.34];
      const k = night ? 1 : 0.25;
      geo.quad([[sx - tx * gw / 2, g + 0.1, sz - tz * gw / 2], [sx + tx * gw / 2, g + 0.1, sz + tz * gw / 2], [sx + tx * gw / 2, g + 2.7, sz + tz * gw / 2], [sx - tx * gw / 2, g + 2.7, sz - tz * gw / 2]], 'shopglow', [glow[0] * k, glow[1] * k, glow[2] * k], [[0, 0], [1, 0], [1, 1], [0, 1]]);
    } else {
      for (const o of [-w / 2 + 0.3, w / 2 - 0.3]) {
        const qx = sx + tx * o, qz = sz + tz * o;
        geo.geom(new THREE.CylinderGeometry(0.06, 0.06, 3.4, 6), new THREE.Matrix4().setPosition(qx, g + 1.7, qz), 'metal', col('#555'));
        phys.addBox(qx - 0.08, g, qz - 0.08, qx + 0.08, g + 3.4, qz + 0.08, SURF.metal);
      }
    }
    // loot at the shop door (restaurants and cafes keep local food)
    ctx.loot.push({ x: sx + nx * 1.4, y: g + 0.05, z: sz + nz * 1.4, tier: 0, food: /restaurant|cafe|fast_food|bakery/.test(kind) });
    signs++;
  }

  // ---------------------------------------------------------------- billboards on the big roads
  const ads = map.billboards || [];
  let bb = 0;
  for (const r of roads) {
    if (!r.major || !ads.length) continue;
    const d = r.dense; let acc = 120 + rng() * 150;
    for (let i = 1; i < d.length; i++) {
      acc -= Math.hypot(d[i][0] - d[i - 1][0], d[i][1] - d[i - 1][1]);
      if (acc > 0) continue;
      acc = 260 + rng() * 260;
      const [ax, az] = d[i - 1], [bx, bz] = d[i];
      const L = Math.hypot(bx - ax, bz - az) || 1, nx = -(bz - az) / L, nz = (bx - ax) / L, sd = rng() < 0.5 ? -1 : 1;
      const x = bx + nx * sd * (r.w / 2 + 6), z = bz + nz * sd * (r.w / 2 + 6);
      const o = occ.at(x, z); if (o === 6 || o === 3) continue;
      const ad = ads[bb++ % ads.length];
      const S = bank.add(ad.text, { bg: '#07090d', color: ad.neon, color2: '#e8ecf5', glow: true, sizes: [0.46, 0.22] });
      const g = H(x, z), fx = -nx * sd, fz = -nz * sd, tx = fz, tz = -fx, w = 11, hh = 4.2, y0 = g + 8;
      const uv = S.uv;
      geo.quad([[x - tx * w / 2, y0, z - tz * w / 2], [x + tx * w / 2, y0, z + tz * w / 2], [x + tx * w / 2, y0 + hh, z + tz * w / 2], [x - tx * w / 2, y0 + hh, z - tz * w / 2]], S.key, WHITE, [[uv[0], uv[1]], [uv[2], uv[1]], [uv[2], uv[3]], [uv[0], uv[3]]]);
      geo.geom(new THREE.BoxGeometry(w + 0.4, hh + 0.4, 0.3), new THREE.Matrix4().makeRotationY(Math.atan2(fx, fz)).setPosition(x - fx * 0.2, y0 + hh / 2, z - fz * 0.2), 'metal', col('#1c1f24'));
      const nc = col(ad.neon).map((v) => v * 3);
      geo.geom(new THREE.BoxGeometry(w + 0.5, 0.12, 0.12), new THREE.Matrix4().makeRotationY(Math.atan2(fx, fz)).setPosition(x + fx * 0.05, y0 + hh + 0.26, z + fz * 0.05), 'neon', nc);
      for (const q of [-3.5, 3.5]) { const px = x + tx * q, pz = z + tz * q; geo.geom(new THREE.CylinderGeometry(0.25, 0.3, 8, 8), new THREE.Matrix4().setPosition(px, g + 4, pz), 'metal', col('#555')); phys.addBox(px - 0.3, g, pz - 0.3, px + 0.3, g + 8, pz + 0.3, SURF.metal); }
    }
  }

  // ---------------------------------------------------------------- props (easter eggs) + avenue trees + parked cars
  progress(0.7, 'Placing easter eggs');
  for (const P of map.props) { try { buildProp(ctx, P); } catch (e) { console.error('prop', P.kind, e); } }
  for (const r of roads) {
    if (!['residential', 'tertiary', 'secondary', 'primary', 'living_street', 'unclassified'].includes(r.type)) continue;
    const d = r.dense; let acc = rng() * 16;
    for (let i = 1; i < d.length; i++) {
      const [ax, az] = d[i - 1], [bx, bz] = d[i];
      const L = Math.hypot(bx - ax, bz - az); acc -= L;
      if (acc > 0) continue;
      acc = (quality === 'low' ? 34 : 22) + rng() * 16;
      const nx = -(bz - az) / (L || 1), nz = (bx - ax) / (L || 1);
      for (const sd of [-1, 1]) {
        if (rng() < 0.42) addTree(bx + nx * sd * (r.w / 2 + 1.8), bz + nz * sd * (r.w / 2 + 1.8), rng() < 0.75 ? 'raintree' : rng.pick(map.trees.kinds));
      }
    }
  }
  let parked = 0;
  const maxParked = quality === 'low' ? 120 : 320;
  for (let k = 0; k < 4000 && parked < maxParked; k++) {
    const r = roads[Math.floor(rng() * roads.length)];
    if (r.type !== 'residential' && r.type !== 'tertiary') continue;
    const d = r.dense, i = Math.floor(rng() * (d.length - 1));
    const [ax, az] = d[i], [bx, bz] = d[i + 1];
    const L = Math.hypot(bx - ax, bz - az); if (L < 3) continue;
    const nx = -(bz - az) / L, nz = (bx - ax) / L, sd = rng() < 0.5 ? -1 : 1;
    const x = (ax + bx) / 2 + nx * sd * (r.w / 2 - 1.1), z = (az + bz) / 2 + nz * sd * (r.w / 2 - 1.1);
    const g = rng() < 0.5 ? car(rng.pick(['#c62828', '#eeeeee', '#1565c0', '#212121', '#9e9e9e', '#f9a825']), rng.pick(['hatch', 'sedan', 'suv'])) : rng() < 0.6 ? autoRickshaw() : bike(rng.pick(['#111', '#b71c1c']));
    const m = new THREE.Matrix4().makeRotationY(Math.atan2(bx - ax, bz - az)).setPosition(x, H(x, z), z);
    mergeGroup(geo, g, m);
    const bbx = new THREE.Box3().setFromObject(g).applyMatrix4(m);
    const shrink = 0.25;
    phys.addBox(bbx.min.x + shrink, bbx.min.y, bbx.min.z + shrink, bbx.max.x - shrink, bbx.max.y, bbx.max.z - shrink, SURF.metal);
    parked++;
  }

  // ---------------------------------------------------------------- instanced lamps, light pools, rooftop tanks
  if (lampPos.length) {
    const pole = new THREE.CylinderGeometry(0.07, 0.1, 7, 6); pole.translate(0, 3.5, 0);
    const head = new THREE.BoxGeometry(0.35, 0.12, 0.7); head.translate(0, 6.9, 0.9);
    const arm = new THREE.BoxGeometry(0.07, 0.07, 1.2); arm.translate(0, 6.98, 0.5);
    const ip = new THREE.InstancedMesh(pole, new THREE.MeshStandardMaterial({ color: 0x4a4f55, roughness: 0.5, metalness: 0.7 }), lampPos.length);
    const ia = new THREE.InstancedMesh(arm, ip.material, lampPos.length);
    const ih = new THREE.InstancedMesh(head, new THREE.MeshStandardMaterial({ color: 0x222222, emissive: night ? 0xffd9a0 : 0x5b5346, emissiveIntensity: night ? 3.2 : 0.3 }), lampPos.length);
    const m = new THREE.Matrix4();
    lampPos.forEach(([x, z, y, a], i) => { m.makeRotationY(a).setPosition(x, y, z); ip.setMatrixAt(i, m); ia.setMatrixAt(i, m); ih.setMatrixAt(i, m); phys.addBox(x - 0.12, y, z - 0.12, x + 0.12, y + 7, z + 0.12, SURF.metal); });
    ip.castShadow = true; group.add(ip, ia, ih);
    if (night) {
      const pg = new THREE.PlaneGeometry(1, 1); pg.rotateX(-Math.PI / 2);
      const pm = new THREE.MeshBasicMaterial({ map: dotTexture(0.35), color: new THREE.Color(1.0, 0.72, 0.42).multiplyScalar(0.55), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6, toneMapped: false });
      const pools = new THREE.InstancedMesh(pg, pm, poolPos.length);
      const s = new THREE.Vector3(12, 1, 12), q = new THREE.Quaternion();
      poolPos.forEach(([x, z, y], i) => { m.compose(new THREE.Vector3(x, y, z), q, s); pools.setMatrixAt(i, m); });
      pools.frustumCulled = false; pools.renderOrder = 2;
      group.add(pools);
    }
  }
  if (tankPos.length) {
    const tg = new THREE.CylinderGeometry(0.55, 0.55, 1.1, 12); tg.translate(0, 0.55, 0);
    const it = new THREE.InstancedMesh(tg, new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.6 }), tankPos.length);
    const m = new THREE.Matrix4();
    tankPos.forEach(([x, y, z], i) => { m.makeTranslation(x, y, z); it.setMatrixAt(i, m); });
    it.castShadow = true; group.add(it);
  }

  // ---------------------------------------------------------------- merge
  progress(0.76, 'Merging geometry');
  const usedKeys = new Set([...geo.bufs.values()].map((b) => b.mat));
  const meshes = geo.build(group);

  // terrain + outer ground
  progress(0.8, 'Texturing the ground');
  const layers = await loadTerrainLayers(map.ground, '1k');
  const terrainMat = makeTerrainMaterial(layers);
  buildTerrainMesh(phys, map, terrainMat, noise).forEach((m) => group.add(m));
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2 + 8000, HALF * 2 + 8000), new THREE.MeshStandardMaterial({ color: 0x3b3a34, roughness: 1 }));
  outer.rotation.x = -Math.PI / 2; outer.position.y = T.base - T.amp - 1.2; group.add(outer);

  // trees
  const veg = treeMeshes(phys, perKind);
  veg.meshes.forEach((m) => group.add(m));
  const grass = quality === 'low' ? null : new GrassField(phys, map, occ, quality);
  if (grass) group.add(grass.mesh);

  // photo textures for the materials actually used
  progress(0.84, 'Downloading photo textures');
  const texKeys = [...usedKeys].filter((k) => MATDEFS[k]);
  const res = createMaterials(texKeys, '1k', (pp) => progress(0.84 + pp * 0.14, 'Downloading photo textures'));
  for (const k of texKeys) {
    const src = res.mats[k], dst = mats[k];
    res.ready.then(() => { dst.map = src.map; dst.normalMap = src.normalMap; dst.aoMap = src.aoMap; dst.roughnessMap = src.roughnessMap; dst.metalnessMap = src.metalnessMap; dst.metalness = src.metalnessMap ? 1 : 0; dst.roughness = 1; dst.needsUpdate = true; });
  }
  await Promise.race([res.ready, new Promise((r) => setTimeout(r, 25000))]);
  phys.finalize();

  // ---------------------------------------------------------------- places, vehicles, minimap
  const [lat0, lon0] = data.center;
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180), kz = 110574;
  const places = (map.places || []).map(([name, lat, lon, big]) => ({ name, x: (lon - lon0) * kx, z: -(lat - lat0) * kz, landmark: !!big }));
  for (const g of greens) if (g.name && Math.abs(areaSigned(g.p)) > 6000) { const [x, z] = centroid(g.p); places.push({ name: g.name, x, z, landmark: true }); }

  const vehicleSpawns = [];
  for (let k = 0; k < 2000 && vehicleSpawns.length < map.vehicleCount; k++) {
    const r = roads[Math.floor(rng() * roads.length)];
    if (!['primary', 'secondary', 'tertiary', 'residential'].includes(r.type) || r.elevated) continue;
    const i = Math.floor(rng() * (r.dense.length - 1));
    const [ax, az] = r.dense[i], [bx, bz] = r.dense[i + 1];
    const ang = Math.atan2(bx - ax, bz - az);
    const off = (r.w / 2 - 1.8) * (rng() < 0.5 ? -1 : 1);
    const x = ax + Math.cos(ang) * off, z = az - Math.sin(ang) * off;
    if (Math.abs(x) > HALF - 40 || Math.abs(z) > HALF - 40) continue;
    if (vehicleSpawns.some((v) => Math.hypot(v.x - x, v.z - z) < 60)) continue;
    vehicleSpawns.push({ kind: map.vehicles[vehicleSpawns.length % map.vehicles.length], x, z, y: H(x, z), ry: ang });
  }

  const minimap = drawOSMMinimap(roads, polys, greens);

  console.log(`[world] ${map.id}: OSM ${data.roads.length} roads, ${shells} enterable + ${prisms} solid buildings, ${signs} shop signs, ${bb} billboards, ${phys.surf.length} colliders, ${ctx.loot.length} loot spots, ${meshes.length} meshes, ${Math.round(performance.now() - t0)} ms`);
  progress(1, 'Ready');
  const clock = { t: 0 };
  return {
    map, phys, group, loot: ctx.loot, eggs: ctx.eggs, climbs: ctx.climbs, places, vehicleSpawns, minimap,
    potholes: ctx.potholes, slowZones: ctx.slowZones, noLoot: ctx.noLoot, mist: ctx.mist, buildings: ctx.buildings,
    signMats: ctx.signMats, waterMats: [], edgeLevel: T.base,
    update(dt, cam) { clock.t += dt; for (const f of ctx.animated) f(clock.t); veg.update(clock.t); if (grass && cam) grass.update(cam, clock.t); },
    dispose() { group.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); },
  };
}

function smoothstep(a, b, v) { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }

// crisp vector minimap: night palette, real streets and footprints
function drawOSMMinimap(roads, polys, greens) {
  const S = 2048, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  const k = S / (HALF * 2), P = (x, z) => [(x + HALF) * k, (z + HALF) * k];
  g.fillStyle = '#20252b'; g.fillRect(0, 0, S, S);
  g.fillStyle = '#27442c';
  for (const gr of greens) { g.beginPath(); gr.p.forEach(([x, z], i) => { const [a, b] = P(x, z); if (i) g.lineTo(a, b); else g.moveTo(a, b); }); g.closePath(); g.fill(); }
  g.fillStyle = '#4a5360';
  for (const b of polys) { g.beginPath(); b.p.forEach(([x, z], i) => { const [a, bb] = P(x, z); if (i) g.lineTo(a, bb); else g.moveTo(a, bb); }); g.closePath(); g.fill(); }
  g.lineCap = 'round'; g.lineJoin = 'round';
  const sorted = roads.slice().sort((a, b) => a.rank - b.rank);
  for (const r of sorted) {
    g.strokeStyle = r.major ? '#f0c060' : r.type === 'tertiary' ? '#d9d4c8' : r.type === 'service' ? '#7d828a' : '#b8bcc4';
    g.lineWidth = Math.max(1, r.w * k);
    g.beginPath(); r.pts.forEach(([x, z], i) => { const [a, b] = P(x, z); if (i) g.lineTo(a, b); else g.moveTo(a, b); }); g.stroke();
  }
  return c;
}

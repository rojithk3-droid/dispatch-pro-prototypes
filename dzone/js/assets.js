// Asset loading: CC0 photo-scanned PBR textures + HDRI skies from Poly Haven, the rigged soldier from the three.js repo.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { textCanvas } from './util.js';

const PH_TEX = (id, res, kind) => `https://dl.polyhaven.org/file/ph-assets/Textures/jpg/${res}/${id}/${id}_${kind}_${res}.jpg`;
const PH_HDR = (id, res) => `https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/${res}/${id}_${res}.hdr`;
const SOLDIER = 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r170/examples/models/gltf/Soldier.glb';

// scale = metres covered by one texture tile
export const MATDEFS = {
  asphalt: { ph: 'asphalt_02', scale: 7 },
  asphaltWorn: { ph: 'asphalt_04', scale: 7 },
  pavers: { ph: 'interlocking_concrete_pavers', scale: 2.5 },
  concrete: { ph: 'concrete_wall_008', scale: 4 },
  plaster: { ph: 'painted_plaster_wall', scale: 3.5 },
  plaster2: { ph: 'grey_plaster', scale: 3.5 },
  brick: { ph: 'red_brick_03', scale: 2.2 },
  laterite: { ph: 'red_laterite_soil_stones', scale: 2.5 },
  sandstone: { ph: 'red_sandstone_wall', scale: 3 },
  marble: { ph: 'marble_01', scale: 3 },
  whitestone: { ph: 'white_sandstone_bricks', scale: 3 },
  mudwhite: { ph: 'white_stucco', scale: 3 },
  rooftile: { ph: 'clay_roof_tiles_02', scale: 2.5 },
  tin: { ph: 'corrugated_iron_02', scale: 2.5 },
  shutter: { ph: 'rusty_metal_shutter', scale: 3 },
  shutterPaint: { ph: 'painted_metal_shutter', scale: 3 },
  wood: { ph: 'wood_planks', scale: 2.5 },
  terrazzo: { ph: 'terrazzo_tiles', scale: 2 },
  concreteFloor: { ph: 'concrete_floor_02', scale: 4 },
  metal: { ph: 'metal_plate', scale: 2 },
  barkPalm: { ph: 'palm_tree_bark', scale: 1.5 },
  bark: { ph: 'bark_brown_02', scale: 1.5 },
  // terrain layers
  grass: { ph: 'rocky_terrain_02', scale: 6 },
  grassSparse: { ph: 'leafy_grass', scale: 5 },
  redDirt: { ph: 'red_dirt_mud_01', scale: 5 },
  forest: { ph: 'forrest_ground_01', scale: 5 },
  mudLeaves: { ph: 'brown_mud_leaves_01', scale: 5 },
  dryGround: { ph: 'dry_ground_rocks', scale: 5 },
  rock: { ph: 'aerial_rocks_02', scale: 10 },
  rockTerrain: { ph: 'dry_riverbed_rock', scale: 6 },
  mossyRock: { ph: 'mossy_rock', scale: 6 },
  sand: { ph: 'coast_sand_01', scale: 5 },
  snow: { ph: 'snow_02', scale: 5 },
  gravel: { ph: 'gravel_road', scale: 4 },
  grassPath: { ph: 'grass_path_2', scale: 5 },
};

const texCache = new Map();
const loader = new THREE.TextureLoader();
loader.setCrossOrigin('anonymous');
let maxAniso = 8;
export function setAniso(n) { maxAniso = n; }

function loadTex(url, srgb) {
  if (texCache.has(url)) return texCache.get(url);
  const p = new Promise((res) => {
    loader.load(url, (t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = maxAniso;
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      res(t);
    }, undefined, () => res(null));
  });
  texCache.set(url, p);
  return p;
}

// Returns {key: material}. Materials exist immediately (flat colour), maps arrive as they load.
export function createMaterials(keys, res, onProgress) {
  const mats = {};
  const jobs = [];
  let done = 0;
  const total = keys.length * 3;
  const tick = () => { done++; onProgress && onProgress(done / total); };
  for (const key of keys) {
    const def = MATDEFS[key];
    if (!def) continue;
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 1, vertexColors: true });
    m.name = key;
    m.userData.scale = def.scale;
    mats[key] = m;
    jobs.push(loadTex(PH_TEX(def.ph, res, 'diff'), true).then((t) => { tick(); if (t) { m.map = t; m.needsUpdate = true; } }));
    jobs.push(loadTex(PH_TEX(def.ph, res, 'nor_gl'), false).then((t) => { tick(); if (t) { m.normalMap = t; m.normalScale.set(1, 1); m.needsUpdate = true; } }));
    jobs.push(loadTex(PH_TEX(def.ph, res, 'arm'), false).then((t) => {
      tick();
      if (t) { m.aoMap = t; m.roughnessMap = t; m.metalnessMap = t; m.aoMapIntensity = 0.8; m.needsUpdate = true; }
      else { m.metalness = 0; m.roughness = 0.9; }
    }));
  }
  return { mats, ready: Promise.all(jobs) };
}

// raw texture sets for the terrain splat shader
export async function loadTerrainLayers(keys, res) {
  const out = [];
  for (const k of keys) {
    const def = MATDEFS[k];
    const [d, n] = await Promise.all([loadTex(PH_TEX(def.ph, res, 'diff'), true), loadTex(PH_TEX(def.ph, res, 'nor_gl'), false)]);
    out.push({ key: k, map: d, normal: n, scale: def.scale });
  }
  return out;
}

// ------------------------------------------------------------------ HDRI sky
// Loads an equirect HDR, finds the sun (brightest texel) so the directional light and shadows line up
// with the photographed sky, and samples the horizon colour for fog.
export function loadSky(id, res) {
  return new Promise((resolve) => {
    const l = new RGBELoader();
    l.setDataType(THREE.FloatType);
    l.load(PH_HDR(id, res), (tex) => {
      tex.mapping = THREE.EquirectangularReflectionMapping;
      const { data, width, height } = tex.image;
      let best = -1, bi = 0, bj = 0;
      const hr = [0, 0, 0]; let hn = 0;
      const zen = [0, 0, 0]; let zn = 0;
      for (let j = 0; j < height; j++) {
        // row 0 = top of the image = zenith
        const v = 1 - (j + 0.5) / height;
        const lat = (v - 0.5) * Math.PI;
        const step = j % 2 ? 2 : 1;
        for (let i = 0; i < width; i += step) {
          const o = (j * width + i) * 4;
          const r = data[o], g = data[o + 1], b = data[o + 2];
          const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          if (lat > 0.02 && lum > best) { best = lum; bi = i; bj = j; }
          if (lat > 0.01 && lat < 0.16) { hr[0] += Math.min(r, 4); hr[1] += Math.min(g, 4); hr[2] += Math.min(b, 4); hn++; }
          if (lat > 0.9) { zen[0] += Math.min(r, 4); zen[1] += Math.min(g, 4); zen[2] += Math.min(b, 4); zn++; }
        }
      }
      const u = (bi + 0.5) / width, v = 1 - (bj + 0.5) / height;
      const phi = (u - 0.5) * Math.PI * 2, th = (v - 0.5) * Math.PI;
      const sunDir = new THREE.Vector3(Math.cos(phi) * Math.cos(th), Math.sin(th), Math.sin(phi) * Math.cos(th)).normalize();
      const o = (bj * width + bi) * 4;
      const sunCol = new THREE.Color(data[o], data[o + 1], data[o + 2]);
      const m = Math.max(sunCol.r, sunCol.g, sunCol.b) || 1;
      sunCol.multiplyScalar(1 / m);
      const horizon = new THREE.Color(hr[0] / hn, hr[1] / hn, hr[2] / hn);
      const zenith = new THREE.Color(zen[0] / Math.max(zn, 1), zen[1] / Math.max(zn, 1), zen[2] / Math.max(zn, 1));
      resolve({ tex, sunDir, sunColor: sunCol, sunPeak: best, horizon, zenith });
    }, undefined, () => resolve(null));
  });
}

// ------------------------------------------------------------------ soldier
let soldierPromise = null;
export function loadSoldier() {
  if (!soldierPromise) {
    soldierPromise = new Promise((resolve) => {
      new GLTFLoader().load(SOLDIER, (g) => {
        g.scene.traverse((o) => {
          if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; }
        });
        resolve(g);
      }, undefined, () => resolve(null));
    });
  }
  return soldierPromise;
}

// ------------------------------------------------------------------ procedural textures
const procCache = new Map();

// glass curtain-wall facade with random lit windows; returns {map, emissive}
export function facadeTextures(seed, style = 'glass') {
  const key = 'facade:' + style + ':' + seed;
  if (procCache.has(key)) return procCache.get(key);
  const W = 512, H = 512;
  const cols = style === 'glass' ? 8 : 6, rows = 8;
  const a = document.createElement('canvas'); a.width = W; a.height = H;
  const e = document.createElement('canvas'); e.width = W; e.height = H;
  const g = a.getContext('2d'), ge = e.getContext('2d');
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  g.fillStyle = style === 'glass' ? '#1d2733' : '#8d8a84';
  g.fillRect(0, 0, W, H);
  ge.fillStyle = '#000'; ge.fillRect(0, 0, W, H);
  const cw = W / cols, rh = H / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * cw, y = r * rh;
      const pad = style === 'glass' ? 3 : cw * 0.18;
      const grad = g.createLinearGradient(x, y, x + cw, y + rh);
      if (style === 'glass') { grad.addColorStop(0, '#3a5570'); grad.addColorStop(0.5, '#243646'); grad.addColorStop(1, '#4f6f8c'); }
      else { grad.addColorStop(0, '#2b3036'); grad.addColorStop(1, '#3d454d'); }
      g.fillStyle = grad;
      g.fillRect(x + pad, y + pad * (style === 'glass' ? 1 : 0.8), cw - pad * 2, rh - pad * (style === 'glass' ? 2 : 1.6));
      if (rnd() < 0.34) {
        const warm = rnd() < 0.6;
        ge.fillStyle = warm ? `rgba(255,${190 + rnd() * 40 | 0},${120 + rnd() * 50 | 0},1)` : `rgba(${150 + rnd() * 60 | 0},${210 + rnd() * 40 | 0},255,1)`;
        ge.globalAlpha = 0.45 + rnd() * 0.55;
        ge.fillRect(x + pad, y + pad, cw - pad * 2, rh - pad * 2);
        ge.globalAlpha = 1;
      }
    }
  }
  // mullions
  g.fillStyle = style === 'glass' ? '#0e141b' : '#6f6c66';
  for (let c = 0; c <= cols; c++) g.fillRect(c * cw - 1.5, 0, 3, H);
  for (let r = 0; r <= rows; r++) g.fillRect(0, r * rh - 2, W, 4);
  const map = new THREE.CanvasTexture(a); map.colorSpace = THREE.SRGBColorSpace; map.wrapS = map.wrapT = THREE.RepeatWrapping; map.anisotropy = maxAniso;
  const em = new THREE.CanvasTexture(e); em.colorSpace = THREE.SRGBColorSpace; em.wrapS = em.wrapT = THREE.RepeatWrapping;
  const out = { map, emissive: em };
  procCache.set(key, out);
  return out;
}

// Indian residential facade: painted plaster (tinted per building by vertex colour), small windows with
// grills and chajja shadows, a floor band per storey. 8 columns × 8 storeys; lit windows in the emissive map.
export function resiFacadeTextures(seed) {
  const key = 'resi:' + seed;
  if (procCache.has(key)) return procCache.get(key);
  const W = 512, H = 512, cols = 8, rows = 8;
  const a = document.createElement('canvas'); a.width = W; a.height = H;
  const e = document.createElement('canvas'); e.width = W; e.height = H;
  const g = a.getContext('2d'), ge = e.getContext('2d');
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  g.fillStyle = '#e8e3da'; g.fillRect(0, 0, W, H);
  // plaster grain + rain streaks
  for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(${rnd() < 0.5 ? '0,0,0' : '255,255,255'},${0.02 + rnd() * 0.05})`; g.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 3, 1 + rnd() * 3); }
  for (let i = 0; i < 60; i++) { const x = rnd() * W; g.fillStyle = 'rgba(60,50,40,0.05)'; g.fillRect(x, rnd() * H, 2 + rnd() * 5, 20 + rnd() * 60); }
  ge.fillStyle = '#000'; ge.fillRect(0, 0, W, H);
  const cw = W / cols, rh = H / rows;
  for (let r = 0; r < rows; r++) {
    g.fillStyle = 'rgba(0,0,0,0.10)'; g.fillRect(0, r * rh + rh - 6, W, 6);          // floor band
    for (let c = 0; c < cols; c++) {
      if (rnd() < 0.18) continue;                                                     // blank wall
      const x = c * cw, y = r * rh;
      const ww = cw * (0.42 + rnd() * 0.2), wh = rh * 0.46;
      const wx = x + (cw - ww) / 2, wy = y + rh * 0.24;
      g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(wx - 4, wy - 7, ww + 8, 6);         // chajja shadow
      g.fillStyle = '#2a2f35'; g.fillRect(wx, wy, ww, wh);
      g.fillStyle = 'rgba(120,150,170,0.35)'; g.fillRect(wx + 2, wy + 2, ww / 2 - 3, wh - 4);
      g.strokeStyle = '#1b1e22'; g.lineWidth = 2;
      for (let k = 1; k < 4; k++) { g.beginPath(); g.moveTo(wx + (ww * k) / 4, wy); g.lineTo(wx + (ww * k) / 4, wy + wh); g.stroke(); }
      if (rnd() < 0.38) {
        const warm = rnd() < 0.75;
        ge.fillStyle = warm ? `rgb(255,${180 + rnd() * 50 | 0},${110 + rnd() * 50 | 0})` : `rgb(${170 + rnd() * 50 | 0},${215 + rnd() * 30 | 0},255)`;
        ge.globalAlpha = 0.5 + rnd() * 0.5;
        ge.fillRect(wx, wy, ww, wh);
        ge.globalAlpha = 1;
        ge.fillStyle = '#000';
        for (let k = 1; k < 4; k++) ge.fillRect(wx + (ww * k) / 4 - 1, wy, 2, wh);
      }
    }
  }
  const map = new THREE.CanvasTexture(a); map.colorSpace = THREE.SRGBColorSpace; map.wrapS = map.wrapT = THREE.RepeatWrapping; map.anisotropy = maxAniso;
  const em = new THREE.CanvasTexture(e); em.colorSpace = THREE.SRGBColorSpace; em.wrapS = em.wrapT = THREE.RepeatWrapping;
  const out = { map, emissive: em };
  procCache.set(key, out);
  return out;
}

export function signTexture(lines, opts) {
  const key = 'sign:' + JSON.stringify([lines, opts]);
  if (procCache.has(key)) return procCache.get(key);
  const t = new THREE.CanvasTexture(textCanvas(lines, opts));
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = maxAniso;
  procCache.set(key, t);
  return t;
}

// soft round sprite for particles
export function dotTexture(soft = 0.5) {
  const key = 'dot:' + soft;
  if (procCache.has(key)) return procCache.get(key);
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(soft, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  procCache.set(key, t);
  return t;
}

// leaf / frond cards with alpha
export function foliageTexture(kind) {
  const key = 'fol:' + kind;
  if (procCache.has(key)) return procCache.get(key);
  const W = 256, H = 256;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  let s = kind.length * 977 + 13;
  const rnd = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  if (kind === 'frond') {
    // coconut frond: central rib with many leaflets
    g.strokeStyle = '#6a7a2e'; g.lineWidth = 5;
    g.beginPath(); g.moveTo(W / 2, H); g.quadraticCurveTo(W / 2 + 6, H / 2, W / 2, 0); g.stroke();
    for (let i = 0; i < 46; i++) {
      const y = H - (i / 46) * H;
      const len = 110 * Math.sin((i / 46) * Math.PI) + 10;
      for (const sd of [-1, 1]) {
        g.strokeStyle = `hsl(${78 + rnd() * 20},${45 + rnd() * 20}%,${24 + rnd() * 14}%)`;
        g.lineWidth = 4 + rnd() * 2;
        g.beginPath(); g.moveTo(W / 2, y); g.quadraticCurveTo(W / 2 + sd * len * 0.6, y - 8, W / 2 + sd * len, y + 22); g.stroke();
      }
    }
  } else if (kind === 'pine') {
    for (let i = 0; i < 900; i++) {
      const y = rnd() * H, spread = (y / H) * W * 0.48;
      const x = W / 2 + (rnd() * 2 - 1) * spread;
      g.strokeStyle = `hsl(${120 + rnd() * 30},${30 + rnd() * 25}%,${12 + rnd() * 14}%)`;
      g.lineWidth = 2;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 16, y + 6 + rnd() * 10); g.stroke();
    }
  } else {
    // broadleaf canopy clump (rain tree / banyan / gulmohar)
    // clumps of leaves with gaps between them, darker toward the clump centre for depth
    const flowers = kind === 'gulmohar';
    const hue = kind === 'dry' ? 58 : 92;
    for (let c = 0; c < 26; c++) {
      const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * W * 0.36;
      const cx = W / 2 + Math.cos(a) * r, cy = H / 2 + Math.sin(a) * r * 0.85;
      const cr = 16 + rnd() * 20;
      for (let i = 0; i < 34; i++) {
        const la = rnd() * Math.PI * 2, lr = Math.sqrt(rnd()) * cr;
        const x = cx + Math.cos(la) * lr, y = cy + Math.sin(la) * lr;
        const depth = lr / cr;
        const fl = flowers && rnd() < 0.3;
        g.fillStyle = fl ? `hsl(${4 + rnd() * 14},82%,${40 + rnd() * 14}%)` : `hsl(${hue + rnd() * 30},${38 + rnd() * 22}%,${12 + depth * 20 + rnd() * 8}%)`;
        g.beginPath(); g.ellipse(x, y, 3.5 + rnd() * 3.5, 2 + rnd() * 2.2, rnd() * 3.14, 0, Math.PI * 2); g.fill();
      }
    }
    // a few twigs
    g.strokeStyle = 'rgba(60,45,30,0.9)'; g.lineWidth = 2;
    for (let i = 0; i < 8; i++) { g.beginPath(); g.moveTo(W / 2, H * 0.95); g.lineTo(W / 2 + (rnd() - 0.5) * W * 0.7, H * (0.2 + rnd() * 0.5)); g.stroke(); }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  procCache.set(key, t);
  return t;
}

// water normal map (tileable)
export function waterNormals() {
  return loadTex('https://cdn.jsdelivr.net/gh/mrdoob/three.js@r170/examples/textures/waternormals.jpg', false);
}

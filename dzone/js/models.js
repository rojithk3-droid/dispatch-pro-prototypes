// Procedural model library: vehicles, people, animals, guns + attachments, gear and loot visuals.
// Every part carries baked vertex colours and a shared material key, so a model can be used live
// (as a THREE.Group) or merged into the static world with mergeGroup().
import * as THREE from 'three';

export const MM = {};
export function initModelMats() {
  if (MM.paint) return MM;
  const S = (o) => new THREE.MeshStandardMaterial({ vertexColors: true, ...o });
  MM.paint = S({ roughness: 0.32, metalness: 0.55 });
  MM.plastic = S({ roughness: 0.55, metalness: 0.0 });
  MM.glassDark = S({ roughness: 0.08, metalness: 0.9, color: 0x9fb4c4 });
  MM.rubber = S({ roughness: 0.9, metalness: 0.0 });
  MM.chrome = S({ roughness: 0.18, metalness: 1.0 });
  MM.cloth = S({ roughness: 0.92, metalness: 0.0 });
  MM.skin = S({ roughness: 0.6, metalness: 0.0 });
  MM.gold = S({ roughness: 0.25, metalness: 1.0, emissive: 0x3a2400, emissiveIntensity: 0.4 });
  MM.gunmetal = S({ roughness: 0.38, metalness: 0.85 });
  MM.polymer = S({ roughness: 0.62, metalness: 0.05 });
  MM.gunwood = S({ roughness: 0.55, metalness: 0.0 });
  MM.lamp = new THREE.MeshStandardMaterial({ vertexColors: true, emissive: 0xffffff, emissiveIntensity: 2.2, roughness: 0.4 });
  MM.lamp.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('vec3 totalEmissiveRadiance = emissive;', 'vec3 totalEmissiveRadiance = emissive * vColor;'); };
  MM.neon = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  MM.fur = S({ roughness: 1.0, metalness: 0.0 });
  MM.tank = S({ roughness: 0.55, metalness: 0.0 });
  for (const k in MM) MM[k].name = k;
  return MM;
}

const _c = new THREE.Color();
function bake(geo, color) {
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  _c.set(color);
  for (let i = 0; i < n; i++) { arr[i * 3] = _c.r; arr[i * 3 + 1] = _c.g; arr[i * 3 + 2] = _c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}
export function part(g, geom, key, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Mesh(bake(geom, color), MM[key]);
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.scale.set(sx, sy, sz);
  m.userData.mat = key;
  m.castShadow = true; m.receiveShadow = true;
  g.add(m);
  return m;
}
const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const Cy = (rt, rb, h, s = 12) => new THREE.CylinderGeometry(rt, rb, h, s);
const Sp = (r, ws = 12, hs = 8) => new THREE.SphereGeometry(r, ws, hs);
const Wheel = (r, w) => { const g = new THREE.CylinderGeometry(r, r, w, 14); g.rotateZ(Math.PI / 2); return g; };

// merge a model group into the static world builder
export function mergeGroup(geo, group, matrix) {
  group.updateMatrixWorld(true);
  const m = new THREE.Matrix4();
  group.traverse((o) => {
    if (!o.isMesh) return;
    m.multiplyMatrices(matrix, o.matrixWorld);
    geo.geom(o.geometry, m, o.userData.mat, [1, 1, 1], true);
  });
}
// size (half extents) of a group for colliders
export function groupBox(group) { return new THREE.Box3().setFromObject(group); }

// ------------------------------------------------------------------ vehicles  (all face +z, origin at ground centre)
export function autoRickshaw(color = '#1b5e20', roof = '#f9d71c') {
  const g = new THREE.Group(); g.name = 'auto';
  // body tub
  part(g, B(1.35, 0.55, 2.3), 'paint', color, 0, 0.62, -0.1);
  part(g, B(1.3, 0.5, 0.9), 'paint', color, 0, 1.05, 0.72);           // front cowl / dash
  part(g, B(0.5, 0.35, 0.35), 'paint', color, 0, 0.55, 1.28);        // nose
  part(g, B(1.36, 0.08, 2.2), 'paint', roof, 0, 1.92, -0.15);        // canvas roof
  part(g, B(1.4, 0.06, 2.3), 'cloth', '#1a1a1a', 0, 1.84, -0.15);
  for (const [x, z] of [[-0.64, 0.95], [0.64, 0.95], [-0.64, -1.2], [0.64, -1.2]]) part(g, B(0.05, 1.3, 0.05), 'chrome', '#aaa', x, 1.2, z);
  part(g, B(1.2, 0.55, 0.04), 'glassDark', '#9ab', 0, 1.55, 1.12, -0.25);
  part(g, B(1.2, 0.5, 0.06), 'cloth', '#1a1a1a', 0, 1.2, -1.24);     // rear canvas
  part(g, B(1.25, 0.45, 0.6), 'cloth', '#3e2723', 0, 1.0, -0.75);    // back seat
  part(g, B(0.5, 0.15, 0.45), 'cloth', '#212121', 0, 1.05, 0.35);    // driver seat
  part(g, Cy(0.02, 0.02, 0.7), 'chrome', '#bbb', 0, 1.35, 0.95, 0, 0, Math.PI / 2); // handlebar
  part(g, Sp(0.1), 'lamp', '#fff6d0', 0, 0.95, 1.32);
  for (const [x, z] of [[0, 1.05], [-0.6, -0.95], [0.6, -0.95]]) part(g, Wheel(0.26, 0.16), 'rubber', '#111', x, 0.26, z);
  part(g, B(1.3, 0.12, 0.3), 'paint', '#111', 0, 0.35, -1.25);
  return g;
}

export function car(color = '#c62828', kind = 'hatch') {
  const g = new THREE.Group(); g.name = 'car';
  const L = kind === 'suv' ? 4.6 : kind === 'sedan' ? 4.4 : 3.8, W = kind === 'suv' ? 1.9 : 1.72, H = kind === 'suv' ? 0.95 : 0.7;
  part(g, B(W, H, L), 'paint', color, 0, 0.35 + H / 2, 0);
  const cabL = kind === 'suv' ? L * 0.62 : L * 0.5;
  part(g, B(W - 0.1, kind === 'suv' ? 0.75 : 0.62, cabL), 'paint', color, 0, 0.35 + H + (kind === 'suv' ? 0.37 : 0.31), kind === 'hatch' ? -0.2 : -0.1);
  part(g, B(W - 0.06, kind === 'suv' ? 0.6 : 0.5, cabL - 0.3), 'glassDark', '#8aa', 0, 0.35 + H + (kind === 'suv' ? 0.37 : 0.3), kind === 'hatch' ? -0.2 : -0.1);
  part(g, B(W - 0.3, 0.45, 0.05), 'glassDark', '#8aa', 0, 0.35 + H + 0.25, (kind === 'hatch' ? -0.2 : -0.1) + cabL / 2 + 0.02, -0.5);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) part(g, Wheel(0.33, 0.24), 'rubber', '#111', sx * (W / 2 - 0.12), 0.33, sz * (L / 2 - 0.75));
  part(g, B(W, 0.18, 0.12), 'chrome', '#999', 0, 0.45, L / 2);
  part(g, B(W, 0.18, 0.12), 'chrome', '#999', 0, 0.45, -L / 2);
  for (const sx of [-1, 1]) { part(g, B(0.3, 0.12, 0.05), 'lamp', '#fff8e1', sx * (W / 2 - 0.3), 0.75, L / 2 + 0.01); part(g, B(0.3, 0.12, 0.05), 'lamp', '#ff1744', sx * (W / 2 - 0.3), 0.8, -L / 2 - 0.01); }
  return g;
}

export function jeep(color = '#33691e') {
  const g = new THREE.Group(); g.name = 'jeep';
  part(g, B(1.7, 0.75, 3.6), 'paint', color, 0, 0.8, 0);
  part(g, B(1.66, 0.5, 1.3), 'paint', color, 0, 1.35, 1.0);
  part(g, B(1.6, 0.55, 0.05), 'glassDark', '#9ab', 0, 1.65, 0.5, -0.15);
  part(g, B(1.7, 0.08, 2.3), 'cloth', '#3b3b2f', 0, 2.05, -0.6);
  for (const [x, z] of [[-0.8, 0.5], [0.8, 0.5], [-0.8, -1.7], [0.8, -1.7]]) part(g, B(0.06, 0.9, 0.06), 'paint', '#222', x, 1.6, z);
  part(g, B(1.4, 0.35, 0.5), 'cloth', '#2b2b2b', 0, 1.3, -0.4);
  part(g, B(1.4, 0.35, 0.5), 'cloth', '#2b2b2b', 0, 1.3, -1.3);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) part(g, Wheel(0.4, 0.3), 'rubber', '#111', sx * 0.82, 0.4, sz * 1.15);
  part(g, Wheel(0.38, 0.28), 'rubber', '#111', 0, 1.05, -1.9, 0, Math.PI / 2, 0);
  for (const sx of [-1, 1]) part(g, Sp(0.12), 'lamp', '#fff8e1', sx * 0.55, 1.0, 1.82);
  part(g, B(1.3, 0.3, 0.08), 'chrome', '#555', 0, 0.95, 1.82);
  return g;
}

export function bike(color = '#212121', kind = 'bullet') {
  const g = new THREE.Group(); g.name = 'bike';
  part(g, Wheel(0.33, 0.12), 'rubber', '#111', 0, 0.33, 0.7);
  part(g, Wheel(0.33, 0.14), 'rubber', '#111', 0, 0.33, -0.72);
  part(g, B(0.32, 0.3, 0.6), 'paint', color, 0, 0.95, 0.25);          // tank
  part(g, B(0.3, 0.12, 0.7), 'cloth', '#1a1a1a', 0, 0.93, -0.35);     // seat
  part(g, B(0.28, 0.35, 0.5), 'chrome', '#888', 0, 0.55, 0.05);       // engine
  part(g, Cy(0.05, 0.05, 1.1), 'chrome', '#aaa', 0.2, 0.45, -0.3, Math.PI / 2 - 0.1, 0, 0); // exhaust
  part(g, Cy(0.025, 0.025, 0.8), 'chrome', '#bbb', 0, 1.2, 0.62, 0, 0, Math.PI / 2);        // handlebar
  part(g, Cy(0.03, 0.03, 0.8), 'chrome', '#999', 0, 0.8, 0.66, -0.35, 0, 0);               // fork
  part(g, Sp(0.12), 'lamp', '#fff8e1', 0, 1.05, 0.78);
  part(g, B(0.2, 0.08, 0.35), 'paint', color, 0, 0.72, -0.75);
  return g;
}

export function bus(body = '#c62828', stripe = '#f5e6c8') {
  const g = new THREE.Group(); g.name = 'bus';
  part(g, B(2.5, 2.3, 10.5), 'paint', body, 0, 1.75, 0);
  part(g, B(2.52, 0.55, 10.52), 'paint', stripe, 0, 2.3, 0);
  part(g, B(2.54, 0.8, 9.2), 'glassDark', '#789', 0, 2.25, -0.3);
  part(g, B(2.3, 1.0, 0.06), 'glassDark', '#9ab', 0, 2.3, 5.26);
  part(g, B(2.5, 0.2, 10.5), 'paint', '#333', 0, 3.0, 0);
  for (const sx of [-1, 1]) for (const z of [3.4, -3.6]) part(g, Wheel(0.5, 0.35), 'rubber', '#111', sx * 1.1, 0.5, z);
  for (const sx of [-1, 1]) part(g, B(0.35, 0.18, 0.05), 'lamp', '#fff8e1', sx * 0.9, 1.1, 5.27);
  return g;
}

export function tanker(color = '#1565c0') {
  const g = new THREE.Group(); g.name = 'tanker';
  part(g, B(2.3, 1.6, 2.2), 'paint', '#eeeeee', 0, 1.6, 2.8);
  part(g, B(2.2, 0.8, 0.05), 'glassDark', '#9ab', 0, 2.0, 3.91);
  const t = Cy(1.05, 1.05, 5.2, 18); t.rotateX(Math.PI / 2);
  part(g, t, 'paint', color, 0, 1.75, -0.9);
  part(g, B(2.2, 0.3, 7.6), 'paint', '#222', 0, 0.75, 0.3);
  for (const sx of [-1, 1]) for (const z of [2.8, -1.2, -2.6]) part(g, Wheel(0.5, 0.3), 'rubber', '#111', sx * 1.0, 0.5, z);
  return g;
}

export function boatModel(color = '#6d4c41', kind = 'country') {
  const g = new THREE.Group(); g.name = 'boat';
  const hull = new THREE.CylinderGeometry(0.9, 0.9, 5.2, 16, 1, false, Math.PI / 2, Math.PI);
  hull.rotateX(Math.PI / 2); hull.scale(1, 0.6, 1);
  part(g, hull, 'gunwood', color, 0, 0.55, 0);
  part(g, B(1.7, 0.08, 4.6), 'gunwood', '#8d6e63', 0, 0.5, 0);
  for (const z of [-1.2, 0, 1.2]) part(g, B(1.7, 0.08, 0.3), 'gunwood', '#795548', 0, 0.65, z);
  part(g, B(0.2, 0.5, 0.3), 'gunmetal', '#333', 0, 0.65, -2.5);
  if (kind === 'speed') part(g, B(1.5, 0.6, 1.0), 'paint', '#eceff1', 0, 0.9, 0.8);
  return g;
}

// houseboat (kettuvallam)
export function houseboat() {
  const g = new THREE.Group();
  const hull = new THREE.CylinderGeometry(2.0, 2.0, 22, 20, 1, false, Math.PI / 2, Math.PI);
  hull.rotateX(Math.PI / 2); hull.scale(1, 0.55, 1);
  part(g, hull, 'gunwood', '#4e342e', 0, 1.1, 0);
  part(g, B(3.8, 0.12, 20), 'gunwood', '#795548', 0, 1.05, 0);
  const roof = new THREE.CylinderGeometry(2.1, 2.1, 15, 16, 1, true, -Math.PI / 2, Math.PI);
  roof.rotateX(Math.PI / 2);
  part(g, roof, 'cloth', '#b08d57', 0, 2.2, 0.5);
  for (const z of [-6.5, -3, 0.5, 4, 7.5]) for (const sx of [-1, 1]) part(g, Cy(0.05, 0.05, 1.3), 'gunwood', '#5d4037', sx * 1.8, 1.7, z);
  part(g, B(3.4, 1.0, 3), 'cloth', '#d7ccc8', 0, 1.6, -8);
  return g;
}

// ------------------------------------------------------------------ people (static NPCs)
export function figure(opts = {}) {
  const g = new THREE.Group();
  const skin = opts.skin || '#8d5a3b', shirt = opts.shirt || '#eeeeee', pants = opts.pants || '#37474f';
  const pose = opts.pose || 'stand';
  const legA = pose === 'walk' ? 0.35 : pose === 'dance' ? 0.5 : 0;
  const armA = pose === 'dance' ? -2.4 : pose === 'walk' ? 0.4 : 0.1;
  part(g, Cy(0.09, 0.08, 0.85), 'cloth', opts.lungi ? opts.lungi : pants, -0.1, 0.43, 0, legA, 0, 0);
  part(g, Cy(0.09, 0.08, 0.85), 'cloth', opts.lungi ? opts.lungi : pants, 0.1, 0.43, 0, -legA, 0, 0);
  if (opts.lungi) part(g, Cy(0.22, 0.26, 0.75), 'cloth', opts.lungi, 0, 0.5, 0);
  part(g, B(0.42, 0.62, 0.24), 'cloth', shirt, 0, 1.2, 0);
  part(g, Sp(0.12), 'skin', skin, 0, 1.66, 0);
  part(g, Cy(0.06, 0.05, 0.62), 'cloth', shirt, -0.28, 1.22, 0, armA, 0, 0.15);
  part(g, Cy(0.06, 0.05, 0.62), 'cloth', shirt, 0.28, 1.22, 0, pose === 'dance' ? -armA : armA * 0.5, 0, -0.15);
  if (opts.cap) part(g, Cy(0.13, 0.13, 0.08), 'cloth', opts.cap, 0, 1.78, 0);
  if (opts.stripes) {
    // puli kali tiger stripes painted on a big belly
    part(g, Sp(0.3), 'skin', '#f9a825', 0, 1.05, 0.08, 0, 0, 0, 1, 1, 0.9);
    for (let i = 0; i < 5; i++) part(g, B(0.62, 0.04, 0.5), 'cloth', '#111', 0, 0.85 + i * 0.12, 0.1, 0, 0, (i % 2 ? 0.3 : -0.3));
  }
  return g;
}

// ------------------------------------------------------------------ animals
export function quadruped(kind = 'cow') {
  const g = new THREE.Group();
  const P = {
    cow: { L: 1.9, H: 1.25, W: 0.62, col: '#e8e2d6', leg: 0.75, head: 0.28, horns: true, hump: true },
    elephant: { L: 4.2, H: 2.9, W: 1.9, col: '#4b4b4b', leg: 1.4, head: 0.9, trunk: true, ears: true },
    yak: { L: 2.0, H: 1.35, W: 0.8, col: '#2b2118', leg: 0.7, head: 0.3, horns: true, hairy: true },
    horse: { L: 2.0, H: 1.5, W: 0.55, col: '#f5f5f5', leg: 0.95, head: 0.26, neck: true },
    leopard: { L: 1.3, H: 0.62, W: 0.35, col: '#cfc6b0', leg: 0.4, head: 0.18, tail: true },
  }[kind];
  const c = P.col;
  const body = Sp(0.5, 14, 10);
  part(g, body, 'fur', c, 0, P.leg + P.H * 0.28, 0, 0, 0, 0, P.W * 1.05, P.H * 0.62, P.L * 1.0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) part(g, Cy(P.W * 0.16, P.W * 0.13, P.leg), 'fur', c, sx * P.W * 0.3, P.leg / 2, sz * P.L * 0.3);
  const hz = P.L * 0.52, hy = P.leg + P.H * 0.45;
  if (P.neck) part(g, Cy(0.14, 0.2, 0.8), 'fur', c, 0, hy + 0.25, hz - 0.1, -0.6, 0, 0);
  part(g, Sp(P.head, 12, 8), 'fur', c, 0, hy + (P.neck ? 0.55 : 0), hz + (P.neck ? 0.2 : 0), 0, 0, 0, 1, 1, 1.35);
  if (P.horns) for (const sx of [-1, 1]) part(g, Cy(0.02, 0.05, 0.35), 'plastic', '#d7ccc8', sx * 0.16, hy + P.head * 0.9, hz, 0, 0, sx * -0.6);
  if (P.hump) part(g, Sp(0.2), 'fur', c, 0, P.leg + P.H * 0.6, P.L * 0.28);
  if (P.hairy) part(g, Sp(0.5, 12, 8), 'fur', '#1b1510', 0, P.leg + P.H * 0.05, 0, 0, 0, 0, P.W * 1.1, P.H * 0.35, P.L * 0.95);
  if (P.trunk) {
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, hy, hz + 0.6), new THREE.Vector3(0, hy - 0.8, hz + 1.0), new THREE.Vector3(0, hy - 1.7, hz + 0.9), new THREE.Vector3(0, hy - 2.2, hz + 1.2)]);
    part(g, new THREE.TubeGeometry(curve, 12, 0.18, 8), 'fur', c);
    for (const sx of [-1, 1]) part(g, Cy(0.05, 0.08, 0.9), 'plastic', '#f5f0e1', sx * 0.35, hy - 0.5, hz + 0.9, 1.0, 0, 0);
  }
  if (P.ears) for (const sx of [-1, 1]) part(g, B(0.08, 1.1, 0.9), 'fur', c, sx * 0.85, hy + 0.1, hz - 0.2, 0, sx * 0.3, 0);
  if (P.tail) {
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, P.leg + P.H * 0.3, -P.L * 0.5), new THREE.Vector3(0.2, P.leg + 0.1, -P.L * 0.9), new THREE.Vector3(0.1, P.leg + 0.3, -P.L * 1.3)]);
    part(g, new THREE.TubeGeometry(curve, 10, 0.07, 6), 'fur', c);
  }
  return g;
}

// ------------------------------------------------------------------ guns
// Each gun group faces -z (barrel forward = -z in its local space, like the camera).
// Anchors: muzzle, sight (eye point for ADS), rail (scope mount), grip (right hand), fore (left hand), mag.
function anchor(g, name, x, y, z) { const o = new THREE.Object3D(); o.name = name; o.position.set(x, y, z); g.add(o); return o; }

export function gunModel(id) {
  const g = new THREE.Group(); g.name = 'gun:' + id;
  const blk = '#1d1f22', dk = '#2a2d31', tan = '#b59a6d', wood = '#6b3a1f', od = '#4b5320';
  const barrel = (len, r, z0, y = 0.05) => { const c = Cy(r, r, len, 10); c.rotateX(Math.PI / 2); part(g, c, 'gunmetal', blk, 0, y, z0 - len / 2); };
  let mag;
  switch (id) {
    case 'm416': {
      part(g, B(0.06, 0.08, 0.34), 'gunmetal', dk, 0, 0.04, -0.02);
      part(g, B(0.058, 0.05, 0.3), 'gunmetal', dk, 0, 0.1, -0.03);             // upper receiver + rail
      part(g, B(0.07, 0.07, 0.26), 'polymer', blk, 0, 0.05, -0.32);             // handguard
      barrel(0.22, 0.012, -0.45);
      part(g, B(0.04, 0.11, 0.05), 'polymer', blk, 0, -0.04, 0.08, 0.3);      // grip
      mag = part(g, B(0.03, 0.18, 0.07), 'gunmetal', blk, 0, -0.07, -0.1, 0.15);
      part(g, B(0.05, 0.07, 0.24), 'polymer', blk, 0, 0.04, 0.3);              // stock
      part(g, B(0.03, 0.03, 0.2), 'gunmetal', dk, 0, 0.06, 0.16);
      break;
    }
    case 'scar': {
      part(g, B(0.065, 0.085, 0.38), 'polymer', tan, 0, 0.04, -0.05);
      part(g, B(0.06, 0.05, 0.4), 'gunmetal', tan, 0, 0.1, -0.1);
      barrel(0.2, 0.013, -0.45);
      part(g, B(0.04, 0.11, 0.05), 'polymer', blk, 0, -0.04, 0.08, 0.3);
      mag = part(g, B(0.03, 0.17, 0.07), 'gunmetal', blk, 0, -0.07, -0.1, 0.1);
      part(g, B(0.055, 0.08, 0.26), 'polymer', tan, 0, 0.04, 0.3);
      break;
    }
    case 'akm': {
      part(g, B(0.055, 0.075, 0.36), 'gunmetal', '#2b2b2b', 0, 0.04, -0.02);
      part(g, B(0.06, 0.06, 0.24), 'gunwood', wood, 0, 0.035, -0.32);
      part(g, B(0.045, 0.03, 0.2), 'gunwood', wood, 0, 0.085, -0.3);
      barrel(0.3, 0.012, -0.44);
      part(g, B(0.035, 0.1, 0.05), 'gunwood', wood, 0, -0.04, 0.08, 0.35);
      mag = part(g, B(0.03, 0.2, 0.07), 'gunmetal', '#3a2a1a', 0, -0.09, -0.1, 0.35);
      part(g, B(0.045, 0.08, 0.3), 'gunwood', wood, 0, 0.02, 0.32, -0.08);
      break;
    }
    case 'ump': {
      part(g, B(0.06, 0.1, 0.36), 'polymer', blk, 0, 0.04, -0.05);
      barrel(0.1, 0.012, -0.23);
      part(g, B(0.04, 0.1, 0.05), 'polymer', blk, 0, -0.05, 0.08, 0.3);
      mag = part(g, B(0.03, 0.18, 0.06), 'polymer', blk, 0, -0.08, -0.1, 0.05);
      part(g, B(0.03, 0.05, 0.25), 'gunmetal', dk, 0, 0.04, 0.26);
      break;
    }
    case 'vector': {
      part(g, B(0.06, 0.14, 0.3), 'polymer', '#202428', 0, 0.02, -0.05);
      barrel(0.1, 0.011, -0.2, 0.06);
      part(g, B(0.04, 0.11, 0.05), 'polymer', blk, 0, -0.06, 0.05, 0.25);
      mag = part(g, B(0.03, 0.16, 0.05), 'polymer', blk, 0, -0.1, -0.12, 0);
      part(g, B(0.04, 0.06, 0.22), 'polymer', blk, 0, 0.05, 0.22);
      break;
    }
    case 'mini14': case 'sks': {
      const c = id === 'sks' ? wood : '#5a4632';
      part(g, B(0.05, 0.07, 0.3), 'gunmetal', dk, 0, 0.05, -0.05);
      part(g, B(0.055, 0.07, 0.5), 'gunwood', c, 0, 0.02, -0.1);
      barrel(0.34, 0.011, -0.36, 0.06);
      mag = part(g, B(0.03, 0.12, 0.06), 'gunmetal', blk, 0, -0.04, -0.08, 0.1);
      part(g, B(0.05, 0.1, 0.36), 'gunwood', c, 0, 0.0, 0.3, -0.12);
      break;
    }
    case 'kar98k': {
      part(g, B(0.05, 0.06, 0.34), 'gunmetal', dk, 0, 0.06, -0.02);
      part(g, B(0.055, 0.07, 0.7), 'gunwood', wood, 0, 0.02, -0.2);
      barrel(0.4, 0.011, -0.5, 0.07);
      part(g, Cy(0.01, 0.01, 0.08), 'gunmetal', '#999', 0.05, 0.08, 0.03, 0, 0, Math.PI / 2); // bolt handle
      part(g, B(0.05, 0.11, 0.36), 'gunwood', wood, 0, -0.01, 0.34, -0.12);
      mag = part(g, B(0.03, 0.04, 0.06), 'gunmetal', blk, 0, -0.02, -0.05);
      break;
    }
    case 'awm': {
      part(g, B(0.07, 0.09, 0.44), 'polymer', od, 0, 0.04, -0.05);
      barrel(0.52, 0.014, -0.28, 0.06);
      part(g, Cy(0.022, 0.022, 0.12), 'gunmetal', blk, 0, 0.06, -0.86, Math.PI / 2, 0, 0);
      part(g, B(0.05, 0.12, 0.34), 'polymer', od, 0, 0.0, 0.3, -0.05);
      part(g, B(0.04, 0.1, 0.05), 'polymer', blk, 0, -0.05, 0.1, 0.3);
      mag = part(g, B(0.035, 0.1, 0.08), 'gunmetal', blk, 0, -0.05, -0.08);
      part(g, Cy(0.01, 0.01, 0.08), 'gunmetal', '#999', 0.05, 0.08, 0.05, 0, 0, Math.PI / 2);
      break;
    }
    case 's12k': {
      part(g, B(0.06, 0.09, 0.36), 'gunmetal', '#2b2b2b', 0, 0.04, -0.02);
      part(g, B(0.06, 0.06, 0.2), 'polymer', blk, 0, 0.03, -0.3);
      barrel(0.28, 0.016, -0.4);
      mag = part(g, B(0.04, 0.2, 0.09), 'polymer', blk, 0, -0.09, -0.1, 0.2);
      part(g, B(0.04, 0.1, 0.05), 'polymer', blk, 0, -0.04, 0.08, 0.3);
      part(g, B(0.045, 0.08, 0.28), 'polymer', blk, 0, 0.02, 0.3);
      break;
    }
    case 'p92': {
      part(g, B(0.03, 0.035, 0.19), 'gunmetal', blk, 0, 0.06, -0.06);
      part(g, B(0.028, 0.11, 0.045), 'polymer', blk, 0, -0.005, 0.02, 0.2);
      mag = part(g, B(0.02, 0.06, 0.035), 'gunmetal', '#333', 0, -0.045, 0.03, 0.2);
      break;
    }
    case 'tawa': {
      // the legendary frying pan. Here: a cast-iron dosa tawa with a handle.
      part(g, Cy(0.2, 0.19, 0.03, 20), 'gunmetal', '#1a1a1a', 0, 0.0, -0.3, Math.PI / 2, 0, 0);
      part(g, Cy(0.018, 0.018, 0.3), 'gunwood', '#5d3a1a', 0, -0.0, 0.0, Math.PI / 2, 0, 0);
      break;
    }
    case 'frag': case 'smoke': {
      part(g, Sp(0.045), 'gunmetal', id === 'frag' ? '#3b4a2a' : '#5b6770', 0, 0, 0);
      part(g, Cy(0.015, 0.015, 0.04), 'gunmetal', '#999', 0, 0.05, 0);
      break;
    }
  }
  if (mag) mag.name = 'mag';
  const A = GUN_ANCHORS[id] || GUN_ANCHORS.m416;
  anchor(g, 'muzzle', 0, A.muzzle[1], A.muzzle[2]);
  anchor(g, 'rail', 0, A.rail[1], A.rail[2]);
  anchor(g, 'grip', 0, -0.02, 0.07);
  anchor(g, 'fore', 0, 0.0, A.fore);
  anchor(g, 'under', 0, 0.0, A.fore);
  anchor(g, 'sight', 0, A.sightY, 0.05);     // iron-sight eye line
  return g;
}

const GUN_ANCHORS = {
  m416: { muzzle: [0, 0.05, -0.57], rail: [0, 0.125, -0.05], fore: -0.3, sightY: 0.15 },
  scar: { muzzle: [0, 0.05, -0.56], rail: [0, 0.125, -0.08], fore: -0.3, sightY: 0.15 },
  akm: { muzzle: [0, 0.05, -0.6], rail: [0, 0.11, -0.05], fore: -0.3, sightY: 0.12 },
  ump: { muzzle: [0, 0.05, -0.3], rail: [0, 0.1, -0.05], fore: -0.2, sightY: 0.13 },
  vector: { muzzle: [0, 0.06, -0.26], rail: [0, 0.1, -0.05], fore: -0.14, sightY: 0.13 },
  mini14: { muzzle: [0, 0.06, -0.54], rail: [0, 0.1, -0.05], fore: -0.3, sightY: 0.13 },
  sks: { muzzle: [0, 0.06, -0.54], rail: [0, 0.1, -0.05], fore: -0.3, sightY: 0.13 },
  kar98k: { muzzle: [0, 0.07, -0.7], rail: [0, 0.1, -0.05], fore: -0.35, sightY: 0.12 },
  awm: { muzzle: [0, 0.06, -0.92], rail: [0, 0.1, -0.05], fore: -0.35, sightY: 0.14 },
  s12k: { muzzle: [0, 0.05, -0.54], rail: [0, 0.1, -0.05], fore: -0.3, sightY: 0.13 },
  p92: { muzzle: [0, 0.06, -0.16], rail: [0, 0.08, -0.05], fore: -0.03, sightY: 0.09 },
  tawa: { muzzle: [0, 0, -0.3], rail: [0, 0, 0], fore: -0.05, sightY: 0.1 },
  frag: { muzzle: [0, 0, 0], rail: [0, 0, 0], fore: 0, sightY: 0.1 },
  smoke: { muzzle: [0, 0, 0], rail: [0, 0, 0], fore: 0, sightY: 0.1 },
};

// scopes/attachments: returns group; for scopes, userData.eye = local eye point offset above rail
export function attachmentModel(id) {
  const g = new THREE.Group(); g.name = 'att:' + id;
  const blk = '#17191b';
  switch (id) {
    case 'reddot': {
      // open-hood reflex sight: low base, two thin cheeks, a thin top bar
      part(g, B(0.03, 0.016, 0.05), 'gunmetal', blk, 0, 0.008, 0);
      for (const s of [-1, 1]) part(g, B(0.004, 0.032, 0.036), 'gunmetal', blk, s * 0.017, 0.032, -0.004);
      part(g, B(0.038, 0.005, 0.036), 'gunmetal', blk, 0, 0.05, -0.004);
      g.userData.eye = 0.033; g.userData.reticle = 'dot'; break;
    }
    case 'holo': {
      part(g, B(0.04, 0.018, 0.08), 'gunmetal', blk, 0, 0.009, 0);
      for (const s of [-1, 1]) part(g, B(0.004, 0.042, 0.05), 'gunmetal', blk, s * 0.022, 0.039, -0.01);
      part(g, B(0.048, 0.006, 0.05), 'gunmetal', blk, 0, 0.062, -0.01);
      g.userData.eye = 0.04; g.userData.reticle = 'holo'; break;
    }
    case 'x2': case 'x4': case 'x8': {
      const len = id === 'x8' ? 0.32 : id === 'x4' ? 0.24 : 0.16, r = id === 'x8' ? 0.022 : 0.019;
      const tube = Cy(r, r, len, 14); tube.rotateX(Math.PI / 2);
      part(g, tube, 'gunmetal', blk, 0, 0.05, 0);
      const bell = Cy(r * 1.5, r, 0.05, 14); bell.rotateX(-Math.PI / 2);
      part(g, bell, 'gunmetal', blk, 0, 0.05, -len / 2 - 0.02);
      part(g, B(0.02, 0.03, 0.02), 'gunmetal', blk, 0, 0.02, 0.04);
      part(g, B(0.02, 0.03, 0.02), 'gunmetal', blk, 0, 0.02, -0.04);
      g.userData.eye = 0.05; break;
    }
    case 'suppressor': { const c = Cy(0.02, 0.02, 0.2, 12); c.rotateX(Math.PI / 2); part(g, c, 'gunmetal', '#222', 0, 0, -0.1); break; }
    case 'compensator': { const c = Cy(0.017, 0.017, 0.07, 10); c.rotateX(Math.PI / 2); part(g, c, 'gunmetal', '#333', 0, 0, -0.035); break; }
    case 'vgrip': part(g, B(0.03, 0.09, 0.03), 'polymer', blk, 0, -0.06, 0); break;
    case 'extmag': part(g, B(0.03, 0.08, 0.06), 'gunmetal', '#222', 0, -0.05, 0); break;
  }
  return g;
}

// ------------------------------------------------------------------ gear (helmets / vests / packs / cosmetics)
export function helmetModel(level) {
  const g = new THREE.Group();
  if (level === 1) {
    part(g, Sp(0.15, 14, 10), 'paint', '#e0e0e0', 0, 0.02, 0, 0, 0, 0, 1, 1.05, 1.1);
    part(g, B(0.24, 0.07, 0.02), 'glassDark', '#333', 0, -0.01, -0.15);
  } else if (level === 2) {
    const s = new THREE.SphereGeometry(0.16, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55);
    part(g, s, 'plastic', '#4b5320', 0, -0.01, 0, 0, 0, 0, 1, 0.95, 1.08);
    part(g, Cy(0.17, 0.17, 0.02, 16), 'plastic', '#3d441a', 0, -0.04, 0.01);
  } else {
    const s = new THREE.SphereGeometry(0.165, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.6);
    part(g, s, 'plastic', '#2b2f33', 0, -0.01, 0, 0, 0, 0, 1, 1, 1.08);
    part(g, B(0.2, 0.11, 0.02), 'gunmetal', '#1a1c1e', 0, -0.07, -0.16);
    part(g, B(0.17, 0.02, 0.02), 'neon', '#27e0ff', 0, -0.05, -0.172);
  }
  return g;
}
export function vestModel(level) {
  const g = new THREE.Group();
  const c = level === 1 ? '#607d8b' : level === 2 ? '#4b5320' : '#26292c';
  part(g, B(0.42, 0.44, 0.07), 'cloth', c, 0, 0, -0.13);
  part(g, B(0.42, 0.44, 0.07), 'cloth', c, 0, 0, 0.13);
  if (level >= 2) for (const x of [-0.13, 0, 0.13]) part(g, B(0.1, 0.12, 0.06), 'cloth', level === 3 ? '#1c1f22' : '#3e4519', x, -0.1, -0.19);
  if (level === 3) { part(g, B(0.44, 0.12, 0.3), 'cloth', c, 0, 0.22, 0); part(g, B(0.3, 0.015, 0.01), 'neon', '#ff3f8e', 0, 0.12, -0.172); }
  return g;
}
export function backpackModel(level) {
  const g = new THREE.Group();
  const s = [0, 0.8, 1.0, 1.2][level];
  part(g, B(0.34 * s, 0.42 * s, 0.18 * s), 'cloth', level === 3 ? '#2b2f33' : level === 2 ? '#556b2f' : '#6d5e45', 0, 0, 0.18 * s / 2);
  part(g, B(0.3 * s, 0.12 * s, 0.08 * s), 'cloth', '#3a3a3a', 0, -0.1 * s, 0.18 * s + 0.03);
  if (level === 3) part(g, B(0.25, 0.015, 0.01), 'neon', '#27e0ff', 0, 0.12, 0.23);
  return g;
}
export function cosmeticModel(id) {
  const g = new THREE.Group();
  switch (id) {
    case 'monkeycap': part(g, Sp(0.16, 14, 10), 'cloth', '#8e1b1b', 0, 0.0, 0, 0, 0, 0, 1, 1.12, 1.1); part(g, Cy(0.1, 0.1, 0.02, 14), 'skin', '#8d5a3b', 0, -0.03, -0.155, Math.PI / 2, 0, 0); break;
    case 'coolingglass': part(g, B(0.2, 0.05, 0.02), 'glassDark', '#111', 0, 0.0, -0.15); part(g, B(0.2, 0.01, 0.01), 'gold', '#d4af37', 0, 0.025, -0.155); break;
    case 'thorthu': part(g, new THREE.TorusGeometry(0.135, 0.028, 8, 20), 'cloth', '#f1f1e8', 0, -0.04, 0.01, Math.PI / 2 + 0.2, 0, 0); part(g, new THREE.TorusGeometry(0.136, 0.008, 6, 20), 'cloth', '#c62828', 0, -0.025, 0.01, Math.PI / 2 + 0.2, 0, 0); break;
    case 'himachali': part(g, Cy(0.14, 0.15, 0.1, 16), 'cloth', '#37474f', 0, 0.08, 0); part(g, Cy(0.152, 0.152, 0.04, 16), 'cloth', '#c62828', 0, 0.05, 0); part(g, Cy(0.153, 0.153, 0.012, 16), 'cloth', '#43a047', 0, 0.035, 0); break;
    case 'hardhat': part(g, new THREE.SphereGeometry(0.16, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), 'plastic', '#fbc02d', 0, 0.02, 0); part(g, Cy(0.2, 0.2, 0.015, 16), 'plastic', '#f9a825', 0, 0.02, 0); break;
    case 'visor': part(g, B(0.24, 0.045, 0.02), 'neon', '#27e0ff', 0, 0.0, -0.155); part(g, B(0.25, 0.06, 0.2), 'gunmetal', '#1b1d20', 0, 0.0, -0.06); break;
    case 'bandana': part(g, new THREE.SphereGeometry(0.155, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.45), 'cloth', '#b71c1c', 0, 0.01, 0); break;
  }
  return g;
}

// ------------------------------------------------------------------ loot visuals
export function lootModel(item) {
  const g = new THREE.Group();
  const t = item.type;
  if (t === 'gun') { const m = gunModel(item.id); m.rotation.set(0, 0.4, Math.PI / 2); m.position.y = 0.05; g.add(m); }
  else if (t === 'ammo') { part(g, B(0.22, 0.12, 0.14), 'polymer', { '556': '#4b5320', '762': '#8d6e63', '9mm': '#1565c0', '45': '#6a1b9a', '12g': '#b71c1c', '300': '#212121' }[item.id] || '#555', 0, 0.06, 0); }
  else if (t === 'att') { const m = attachmentModel(item.id); m.scale.setScalar(1.6); g.add(m); part(g, B(0.2, 0.02, 0.14), 'plastic', '#333', 0, 0.01, 0); }
  else if (t === 'helmet') { const m = helmetModel(item.level); m.position.y = 0.12; g.add(m); }
  else if (t === 'vest') { const m = vestModel(item.level); m.position.y = 0.08; m.rotation.x = -Math.PI / 2; m.scale.setScalar(0.9); g.add(m); }
  else if (t === 'pack') { const m = backpackModel(item.level); m.rotation.x = -Math.PI / 2; m.position.y = 0.1; g.add(m); }
  else if (t === 'med') {
    const c = { bandage: '#eeeeee', fak: '#e53935', medkit: '#f5f5f5' }[item.id] || '#e53935';
    part(g, B(item.id === 'medkit' ? 0.34 : 0.22, 0.1, 0.18), 'plastic', c, 0, 0.05, 0);
    part(g, B(0.1, 0.012, 0.03), 'plastic', item.id === 'fak' ? '#fff' : '#e53935', 0, 0.105, 0);
    part(g, B(0.03, 0.012, 0.1), 'plastic', item.id === 'fak' ? '#fff' : '#e53935', 0, 0.105, 0);
  } else if (t === 'boost' || t === 'food') {
    const c = { kaapi: '#bdbdbd', balm: '#ff7043', chyawan: '#4e342e' }[item.id] || '#ffb300';
    part(g, Cy(0.05, 0.045, 0.14, 12), item.id === 'kaapi' ? 'chrome' : 'plastic', c, 0, 0.07, 0);
    if (t === 'food') part(g, Cy(0.09, 0.07, 0.04, 14), 'plastic', '#ffd54f', 0, 0.02, 0);
  } else if (t === 'throw') { const m = gunModel(item.id); m.position.y = 0.05; g.add(m); }
  else part(g, B(0.2, 0.2, 0.2), 'plastic', '#888', 0, 0.1, 0);
  return g;
}

// airdrop: a giant steel tiffin box ("Amma's Tiffin")
export function tiffinCrate() {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    part(g, Cy(0.85, 0.85, 0.5, 24), 'chrome', '#cfd8dc', 0, 0.3 + i * 0.55, 0);
    part(g, Cy(0.88, 0.88, 0.05, 24), 'chrome', '#b0bec5', 0, 0.55 + i * 0.55, 0);
  }
  part(g, Cy(0.9, 0.9, 0.08, 24), 'chrome', '#b0bec5', 0, 1.9, 0);
  part(g, B(0.1, 1.9, 0.1), 'chrome', '#90a4ae', 0.9, 1.0, 0);
  part(g, B(0.1, 1.9, 0.1), 'chrome', '#90a4ae', -0.9, 1.0, 0);
  part(g, B(1.9, 0.08, 0.12), 'chrome', '#90a4ae', 0, 2.0, 0);
  part(g, B(0.5, 0.05, 0.02), 'neon', '#ff3f8e', 0, 1.2, 0.86);
  return g;
}

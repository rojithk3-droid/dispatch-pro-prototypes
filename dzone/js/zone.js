// Blue zone schedule + visual wall, drop plane, airdrops.
import * as THREE from 'three';
import { mulberry32 } from './util.js';
import { part, tiffinCrate } from './models.js';
import { signTexture } from './assets.js';
import { HALF } from './physics.js';

export const PHASES = [
  { wait: 80, shrink: 60, r: 330, dmg: 0.5 },
  { wait: 60, shrink: 45, r: 200, dmg: 1.0 },
  { wait: 45, shrink: 40, r: 115, dmg: 2.2 },
  { wait: 35, shrink: 30, r: 62, dmg: 4 },
  { wait: 28, shrink: 25, r: 30, dmg: 6 },
  { wait: 20, shrink: 22, r: 10, dmg: 9 },
  { wait: 15, shrink: 25, r: 0, dmg: 13 },
];

export class ZonePlan {
  constructor(seed, phys) {
    const rng = mulberry32(seed ^ 0x51ed);
    // phases are tuned for a 1 km map; bigger maps scale the early circles and give more time to rotate
    const k = HALF / 512;
    this.phases = PHASES.map((P, i) => ({
      ...P,
      r: i < 5 ? P.r * Math.max(1, k * (i < 3 ? 1 : 0.7)) : P.r,
      wait: i < 3 ? P.wait * Math.sqrt(k) : P.wait,
      shrink: i < 3 ? P.shrink * Math.sqrt(k) : P.shrink,
    }));
    const r0 = HALF * 1.45;
    this.circles = [{ x: 0, z: 0, r: r0 }];
    let cur = { x: (rng() - 0.5) * 0.23 * HALF, z: (rng() - 0.5) * 0.23 * HALF, r: r0 };
    for (const P of this.phases) {
      let best = null;
      for (let t = 0; t < 40; t++) {
        const a = rng() * Math.PI * 2, d = Math.sqrt(rng()) * Math.max(0, Math.min(cur.r, HALF * 0.92) - P.r) * 0.9;
        const lim = HALF * 0.84;
        const x = Math.max(-lim, Math.min(lim, cur.x + Math.cos(a) * d)), z = Math.max(-lim, Math.min(lim, cur.z + Math.sin(a) * d));
        const lvl = phys.waterLevel(x, z);
        const dry = !(lvl > -1e9 && phys.height(x, z) < lvl + 0.5);
        if (dry || t === 39) { best = { x, z, r: P.r }; break; }
      }
      this.circles.push(best);
      cur = best;
    }
    this.times = [];
    let t = 0;
    this.phases.forEach((P, i) => { this.times.push({ i, start: t, shrinkAt: t + P.wait, end: t + P.wait + P.shrink }); t += P.wait + P.shrink; });
    this.total = t;
  }
  // state at match time t (seconds since landing phase start)
  at(t) {
    for (const T of this.times) {
      if (t < T.end) {
        const from = this.circles[T.i], to = this.circles[T.i + 1];
        if (t < T.shrinkAt) return { phase: T.i, shrinking: false, x: from.x, z: from.z, r: from.r, next: to, timeLeft: T.shrinkAt - t, dmg: this.phases[Math.max(0, T.i - 1)].dmg * (T.i === 0 ? 0.6 : 1) };
        const k = (t - T.shrinkAt) / (T.end - T.shrinkAt);
        return { phase: T.i, shrinking: true, x: from.x + (to.x - from.x) * k, z: from.z + (to.z - from.z) * k, r: from.r + (to.r - from.r) * k, next: to, timeLeft: T.end - t, dmg: this.phases[T.i].dmg };
      }
    }
    const last = this.circles[this.circles.length - 1];
    return { phase: this.phases.length, shrinking: false, x: last.x, z: last.z, r: 0, next: last, timeLeft: 0, dmg: 15 };
  }
}

// translucent wall with a scrolling hex lattice
export function zoneWall() {
  const g = new THREE.CylinderGeometry(1, 1, 1, 128, 1, true);
  g.translate(0, 0.5, 0);
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uR: { value: 700 }, uCol: { value: new THREE.Color(0.18, 0.55, 1.0) } },
    vertexShader: 'varying vec3 vW; varying float vH; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; vH = position.y; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `uniform float uTime, uR; uniform vec3 uCol; varying vec3 vW; varying float vH;
      float hex(vec2 p){ p.x *= 1.1547; p.y += mod(floor(p.x), 2.0) * 0.5; p = abs(fract(p) - 0.5); return abs(max(p.x * 1.5 + p.y, p.y * 2.0) - 1.0); }
      void main(){
        float a = atan(vW.z, vW.x) * uR * 0.08;
        vec2 uv = vec2(a, vW.y * 0.08 - uTime * 0.15);
        float h = smoothstep(0.0, 0.08, hex(uv));
        float edge = 1.0 - h;
        float fade = (1.0 - smoothstep(0.0, 1.0, vH)) * 0.85 + 0.15;
        float scan = 0.5 + 0.5 * sin(vW.y * 0.6 - uTime * 3.0);
        vec3 c = uCol * (0.5 + edge * 2.2 + scan * 0.25);
        float near = 1.0 - smoothstep(60.0, 420.0, length(cameraPosition.xz - vW.xz));
        gl_FragColor = vec4(c, (0.07 + edge * 0.22 + near * (0.08 + edge * 0.25)) * fade);
      }`,
    transparent: true, side: THREE.DoubleSide, depthWrite: false, toneMapped: false,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  return mesh;
}

// transport plane with the map's airline livery
export function planeModel(name) {
  const g = new THREE.Group();
  const body = new THREE.CylinderGeometry(2.4, 2.2, 30, 20); body.rotateX(Math.PI / 2);
  part(g, body, 'paint', '#dfe3e8', 0, 0, 0);
  const nose = new THREE.SphereGeometry(2.4, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2); nose.rotateX(-Math.PI / 2); nose.scale(1, 1, 1.6);
  part(g, nose, 'paint', '#dfe3e8', 0, 0, -15);
  const tail = new THREE.CylinderGeometry(2.2, 0.6, 9, 20); tail.rotateX(Math.PI / 2 + 0.12);
  part(g, tail, 'paint', '#dfe3e8', 0, 0.8, 19.4);
  part(g, new THREE.BoxGeometry(44, 0.5, 5.5), 'paint', '#cfd5dc', 0, 1.6, -2);
  part(g, new THREE.BoxGeometry(0.4, 8, 5), 'paint', '#ff3f8e', 0, 5.2, 21);
  part(g, new THREE.BoxGeometry(14, 0.3, 3.2), 'paint', '#cfd5dc', 0, 1.2, 21.5);
  for (const x of [-15, -7.5, 7.5, 15]) {
    const eng = new THREE.CylinderGeometry(0.9, 0.9, 3.2, 14); eng.rotateX(Math.PI / 2);
    part(g, eng, 'gunmetal', '#555a60', x, 0.9, -3.6);
    const prop = part(g, new THREE.BoxGeometry(0.25, 4.6, 0.12), 'gunmetal', '#222', x, 0.9, -5.3);
    prop.name = 'prop';
  }
  part(g, new THREE.BoxGeometry(4.9, 0.25, 30), 'neon', '#27e0ff', 0, -0.9, 0).scale.set(1, 1, 1);
  part(g, new THREE.BoxGeometry(4.9, 0.12, 30), 'paint', '#0b1a2b', 0, -1.5, 0);
  const tex = signTexture([name.toUpperCase()], { w: 1024, h: 128, bg: null, color: '#0b1a2b', sizes: [0.7] });
  const lab = new THREE.Mesh(new THREE.PlaneGeometry(16, 2), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
  for (const s of [-1, 1]) { const l = lab.clone(); l.position.set(s * 2.42, 0.6, -2); l.rotation.y = s * Math.PI / 2 * -1; g.add(l); }
  g.scale.setScalar(1.2);
  return g;
}

export function airdropModel() {
  const g = new THREE.Group();
  const crate = tiffinCrate(); g.add(crate);
  const chute = new THREE.Group();
  const geo = new THREE.SphereGeometry(4, 18, 8, 0, Math.PI * 2, 0, Math.PI * 0.35);
  const m = part(chute, geo, 'cloth', '#e53935', 0, 8, 0); m.material = m.material.clone(); m.material.side = THREE.DoubleSide;
  const lines = new THREE.BufferGeometry().setFromPoints([[-2.8, 0], [2.8, 0], [0, -2.8], [0, 2.8]].flatMap(([x, z]) => [new THREE.Vector3(0, 2, 0), new THREE.Vector3(x, 8.8, z)]));
  chute.add(new THREE.LineSegments(lines, new THREE.LineBasicMaterial({ color: 0x333333 })));
  chute.name = 'chute';
  g.add(chute);
  return g;
}

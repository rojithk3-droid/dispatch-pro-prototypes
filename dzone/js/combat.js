// Ballistics + effects. Bullets are simulated projectiles (muzzle velocity, gravity, drag) swept each
// frame against the collision world and against bone hit-spheres. Also tracers, muzzle flash, particles
// (sparks / dust / blood / splash / explosions / smoke), bullet-hole decals and bouncing grenades.
import * as THREE from 'three';
import { raySphere, SURF } from './physics.js';
import { WEAPONS, THROWS } from './weapons.js';
import { audio } from './audio.js';
import { dotTexture } from './assets.js';
import { gunModel } from './models.js';

const G = 9.81;
const _v = new THREE.Vector3(), _d = new THREE.Vector3();

// --------------------------------------------------------------- particle system (points)
class Particles {
  constructor(max, additive) {
    this.max = max; this.n = 0;
    this.p = new Float32Array(max * 3); this.v = new Float32Array(max * 3);
    this.c = new Float32Array(max * 4); this.s = new Float32Array(max);
    this.life = new Float32Array(max); this.age = new Float32Array(max); this.grow = new Float32Array(max); this.grav = new Float32Array(max); this.a0 = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    this.pa = new THREE.BufferAttribute(this.p, 3); this.ca = new THREE.BufferAttribute(this.c, 4); this.sa = new THREE.BufferAttribute(this.s, 1);
    this.pa.setUsage(THREE.DynamicDrawUsage); this.ca.setUsage(THREE.DynamicDrawUsage); this.sa.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.pa); g.setAttribute('rgba', this.ca); g.setAttribute('size', this.sa);
    g.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: dotTexture(0.35) }, scale: { value: 600 } },
      vertexShader: 'attribute float size; attribute vec4 rgba; varying vec4 vC; uniform float scale; void main(){ vC = rgba; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * scale / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform sampler2D map; varying vec4 vC; void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC.rgb, vC.a * t.a); if (gl_FragColor.a < 0.01) discard; }',
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.geo = g;
  }
  emit(x, y, z, vx, vy, vz, r, g, b, a, size, life, grow = 0, grav = 0) {
    let i = this.n < this.max ? this.n++ : Math.floor(Math.random() * this.max);
    this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z;
    this.v[i * 3] = vx; this.v[i * 3 + 1] = vy; this.v[i * 3 + 2] = vz;
    this.c[i * 4] = r; this.c[i * 4 + 1] = g; this.c[i * 4 + 2] = b; this.c[i * 4 + 3] = a; this.a0[i] = a;
    this.s[i] = size; this.life[i] = life; this.age[i] = 0; this.grow[i] = grow; this.grav[i] = grav;
  }
  update(dt) {
    let n = this.n;
    for (let i = 0; i < n; i++) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        n--;
        if (i !== n) {
          for (let k = 0; k < 3; k++) { this.p[i * 3 + k] = this.p[n * 3 + k]; this.v[i * 3 + k] = this.v[n * 3 + k]; }
          for (let k = 0; k < 4; k++) this.c[i * 4 + k] = this.c[n * 4 + k];
          this.s[i] = this.s[n]; this.life[i] = this.life[n]; this.age[i] = this.age[n]; this.grow[i] = this.grow[n]; this.grav[i] = this.grav[n]; this.a0[i] = this.a0[n];
          i--;
        }
        continue;
      }
      this.v[i * 3 + 1] -= this.grav[i] * dt;
      const drag = Math.exp(-dt * 1.5);
      this.v[i * 3] *= drag; this.v[i * 3 + 2] *= drag;
      this.p[i * 3] += this.v[i * 3] * dt; this.p[i * 3 + 1] += this.v[i * 3 + 1] * dt; this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt;
      this.s[i] += this.grow[i] * dt;
      const t = this.age[i] / this.life[i];
      this.c[i * 4 + 3] = this.a0[i] * (1 - t) * Math.min(1, this.age[i] * 12);
    }
    this.n = n;
    this.geo.setDrawRange(0, n);
    this.pa.needsUpdate = this.ca.needsUpdate = this.sa.needsUpdate = true;
  }
}

export class Combat {
  constructor(scene, phys, opts) {
    this.scene = scene; this.phys = phys;
    this.getTargets = opts.getTargets;     // () => [{id, team, alive, pos (feet), avatar}]
    this.onHit = opts.onHit;               // (bullet, target, part, point, dist)
    this.localId = opts.localId;
    this.bullets = [];
    this.nades = [];
    this.smokes = [];
    this.fx = new Particles(3000, false);
    this.fxAdd = new Particles(1500, true);
    scene.add(this.fx.points, this.fxAdd.points);
    // tracers
    this.maxTr = 400;
    this.trPos = new Float32Array(this.maxTr * 6);
    const tg = new THREE.BufferGeometry();
    this.trAttr = new THREE.BufferAttribute(this.trPos, 3); this.trAttr.setUsage(THREE.DynamicDrawUsage);
    tg.setAttribute('position', this.trAttr); tg.setDrawRange(0, 0);
    this.tracers = new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ color: new THREE.Color(3.2, 2.4, 1.2), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, toneMapped: false, depthWrite: false }));
    this.tracers.frustumCulled = false;
    scene.add(this.tracers);
    // decals
    this.maxDec = 300; this.decI = 0;
    this.decals = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.09, 0.09), new THREE.MeshStandardMaterial({ map: dotTexture(0.6), color: 0x111111, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 1 }), this.maxDec);
    this.decals.count = 0; this.decals.frustumCulled = false;
    scene.add(this.decals);
    // one shared flash light
    this.flash = new THREE.PointLight(0xffc27a, 0, 14, 2);
    scene.add(this.flash);
    this.flashT = 0;
    this.shake = 0;
  }

  // shooter: {id, team}; sim: this client decides damage for these bullets
  fire(shooter, origin, dir, weaponId, opts = {}) {
    const W = WEAPONS[weaponId];
    if (!W) return;
    const n = W.pellets || 1;
    for (let k = 0; k < n; k++) {
      const d = dir.clone();
      if (n > 1) { d.x += (Math.random() - 0.5) * 0.09; d.y += (Math.random() - 0.5) * 0.09; d.z += (Math.random() - 0.5) * 0.09; d.normalize(); }
      this.bullets.push({ p: origin.clone(), v: d.multiplyScalar(W.v), o: origin.clone(), shooter, w: weaponId, t: 0, sim: !!opts.sim, trace: k === 0 || Math.random() < 0.3, cracked: false });
    }
    if (opts.muzzle) this.muzzleFlash(opts.muzzle, dir, opts.suppressed);
    audio.gun(origin, W.sound === 'ak' ? 'ak' : W.sound, opts.suppressed, opts.local);
  }

  muzzleFlash(p, dir, suppressed) {
    if (suppressed) return;
    for (let i = 0; i < 6; i++) {
      const s = Math.random() * 0.6;
      this.fxAdd.emit(p.x + dir.x * s * 0.3, p.y + dir.y * s * 0.3, p.z + dir.z * s * 0.3, dir.x * 6 * s, dir.y * 6 * s, dir.z * 6 * s, 1.0, 0.72, 0.35, 0.9, 0.18 + Math.random() * 0.15, 0.05);
    }
    this.fx.emit(p.x, p.y, p.z, dir.x * 1.5, 0.4, dir.z * 1.5, 0.6, 0.6, 0.6, 0.18, 0.2, 0.6, 0.8);
    this.flash.position.copy(p); this.flash.intensity = 6; this.flashT = 0.05;
  }

  impactFx(p, n, surf, dir) {
    const nx = n ? n[0] : 0, ny = n ? n[1] : 1, nz = n ? n[2] : 0;
    if (surf === SURF.flesh) {
      for (let i = 0; i < 10; i++) this.fx.emit(p.x, p.y, p.z, dir.x * 2 + (Math.random() - 0.5) * 3, Math.random() * 2, dir.z * 2 + (Math.random() - 0.5) * 3, 0.45, 0.02, 0.02, 0.85, 0.06 + Math.random() * 0.08, 0.5, 0.1, 6);
      this.fx.emit(p.x, p.y, p.z, 0, 0.3, 0, 0.5, 0.05, 0.05, 0.5, 0.25, 0.4, 0.6);
      return;
    }
    if (surf === SURF.water) {
      for (let i = 0; i < 14; i++) this.fx.emit(p.x, p.y, p.z, (Math.random() - 0.5) * 2, 3 + Math.random() * 4, (Math.random() - 0.5) * 2, 0.85, 0.9, 0.95, 0.8, 0.08, 0.6, 0.1, 9.8);
      return;
    }
    const metal = surf === SURF.metal;
    const dust = surf === SURF.dirt ? [0.42, 0.35, 0.26] : surf === SURF.wood ? [0.5, 0.38, 0.24] : [0.62, 0.6, 0.56];
    for (let i = 0; i < 8; i++) {
      const s = 1 + Math.random() * 3;
      this.fx.emit(p.x, p.y, p.z, nx * s + (Math.random() - 0.5) * 2, ny * s + Math.random(), nz * s + (Math.random() - 0.5) * 2, dust[0], dust[1], dust[2], 0.7, 0.07 + Math.random() * 0.1, 0.6 + Math.random() * 0.5, 0.35, 3);
    }
    this.fx.emit(p.x + nx * 0.1, p.y + ny * 0.1, p.z + nz * 0.1, nx * 0.6, 0.3, nz * 0.6, dust[0], dust[1], dust[2], 0.5, 0.25, 1.2, 0.8);
    if (metal || surf === SURF.concrete) for (let i = 0; i < (metal ? 10 : 4); i++) this.fxAdd.emit(p.x, p.y, p.z, nx * 4 + (Math.random() - 0.5) * 7, ny * 4 + Math.random() * 4, nz * 4 + (Math.random() - 0.5) * 7, 1, 0.75, 0.35, 1, 0.035, 0.25 + Math.random() * 0.2, 0, 9.8);
    if (n) this.decal(p, n);
  }

  decal(p, n) {
    const m = new THREE.Matrix4();
    const nn = new THREE.Vector3(n[0], n[1], n[2]);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), nn);
    m.compose(p.clone().addScaledVector(nn, 0.01), q, new THREE.Vector3(1, 1, 1).multiplyScalar(0.7 + Math.random() * 0.6));
    this.decals.setMatrixAt(this.decI, m);
    this.decI = (this.decI + 1) % this.maxDec;
    this.decals.count = Math.min(this.maxDec, this.decals.count + 1);
    this.decals.instanceMatrix.needsUpdate = true;
  }

  // --------------------------------------------------------------- grenades
  throw(shooter, pos, vel, type, sim) {
    const mesh = gunModel(type);
    mesh.position.copy(pos);
    this.scene.add(mesh);
    this.nades.push({ p: pos.clone(), v: vel.clone(), type, t: 0, shooter, mesh, sim, rest: false });
  }

  explode(n) {
    const p = n.p;
    this.scene.remove(n.mesh);
    if (n.type === 'smoke') {
      this.smokes.push({ p: p.clone(), t: 0, r: 0 });
      audio.impact(p, 6);
      return;
    }
    audio.explosion(p);
    for (let i = 0; i < 40; i++) this.fxAdd.emit(p.x, p.y + 0.3, p.z, (Math.random() - 0.5) * 16, Math.random() * 10, (Math.random() - 0.5) * 16, 1, 0.55 + Math.random() * 0.3, 0.2, 1, 0.5 + Math.random() * 0.8, 0.35 + Math.random() * 0.3, 2);
    for (let i = 0; i < 24; i++) this.fx.emit(p.x, p.y + 0.5, p.z, (Math.random() - 0.5) * 6, 1 + Math.random() * 4, (Math.random() - 0.5) * 6, 0.18, 0.17, 0.16, 0.8, 1 + Math.random(), 3 + Math.random() * 2, 1.5);
    for (let i = 0; i < 20; i++) this.fx.emit(p.x, p.y + 0.2, p.z, (Math.random() - 0.5) * 14, 4 + Math.random() * 8, (Math.random() - 0.5) * 14, 0.3, 0.25, 0.2, 1, 0.08, 1.4, 0, 9.8);
    this.flash.position.copy(p); this.flash.position.y += 1; this.flash.intensity = 60; this.flash.distance = 40; this.flashT = 0.25;
    this.shakeAt = p.clone(); this.shake = 1;
    if (n.sim) {
      const T = THROWS.frag;
      for (const tg of this.getTargets()) {
        if (!tg.alive) continue;
        const c = tg.pos.clone(); c.y += 1;
        const d = c.distanceTo(p);
        if (d > T.radius) continue;
        if (!this.phys.los(p.x, p.y + 0.4, p.z, c.x, c.y, c.z)) continue;
        const dmg = T.dmg * Math.pow(1 - d / T.radius, 1.3);
        this.onHit({ shooter: n.shooter, w: 'frag', explosive: true, dmg }, tg, 'body', c, d);
      }
    }
  }

  // is the line a→b blocked by smoke?
  smokeBlocks(a, b) {
    for (const s of this.smokes) {
      if (s.r < 2) continue;
      _d.subVectors(b, a); const L = _d.length(); _d.divideScalar(L);
      if (raySphere(a.x, a.y, a.z, _d.x, _d.y, _d.z, s.p.x, s.p.y + 2, s.p.z, s.r * 0.8, L) >= 0) return true;
    }
    return false;
  }

  // --------------------------------------------------------------- update
  update(dt, listener) {
    const targets = this.getTargets();
    let tn = 0;
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.t += dt;
      const sp = b.v.length();
      const step = sp * dt;
      _d.copy(b.v).divideScalar(sp);
      let best = step, hitT = null, hitPart = null, hitW = null;
      const hw = this.phys.raycast(b.p.x, b.p.y, b.p.z, _d.x, _d.y, _d.z, step);
      if (hw) best = hw.t;
      for (const tg of targets) {
        if (!tg.alive || tg.id === b.shooter.id) continue;
        // coarse: distance from segment to the target's centre
        const cx = tg.pos.x - b.p.x, cy = tg.pos.y + 1 - b.p.y, cz = tg.pos.z - b.p.z;
        const along = cx * _d.x + cy * _d.y + cz * _d.z;
        if (along < -2 || along > best + 2) continue;
        const px = cx - _d.x * along, py = cy - _d.y * along, pz = cz - _d.z * along;
        if (px * px + py * py + pz * pz > 4) continue;
        for (const h of tg.avatar.hitSpheres) {
          if (h.r <= 0) continue;
          const t = raySphere(b.p.x, b.p.y, b.p.z, _d.x, _d.y, _d.z, h.c.x, h.c.y, h.c.z, h.r, best);
          if (t >= 0 && t < best) { best = t; hitT = tg; hitPart = h.part; }
        }
      }
      // near-miss crack for the local player
      if (!b.cracked && listener && b.shooter.id !== this.localId) {
        const cx = listener.x - b.p.x, cy = listener.y - b.p.y, cz = listener.z - b.p.z;
        const along = cx * _d.x + cy * _d.y + cz * _d.z;
        if (along > 0 && along < step) { const dd = Math.hypot(cx - _d.x * along, cy - _d.y * along, cz - _d.z * along); if (dd < 3) { b.cracked = true; audio.crack(b.p.clone().addScaledVector(_d, along)); } }
      }
      const prev = b.p.clone();
      if (hitT) {
        const hp = b.p.clone().addScaledVector(_d, best);
        this.impactFx(hp, null, SURF.flesh, _d);
        if (b.sim) this.onHit(b, hitT, hitPart, hp, hp.distanceTo(b.o));
        this.bullets.splice(i, 1);
      } else if (hw) {
        const hp = b.p.clone().addScaledVector(_d, hw.t);
        const lvl = this.phys.waterLevel(hp.x, hp.z);
        const surf = hw.id === -2 && lvl > hp.y - 0.3 ? SURF.water : hw.surf;
        this.impactFx(hp, [hw.nx, hw.ny, hw.nz], surf, _d);
        if (Math.random() < 0.35) audio.impact(hp, surf);
        if (b.sim && hw.dyn) this.onHit(b, null, 'vehicle', hp, 0, hw.dyn);
        this.bullets.splice(i, 1);
      } else {
        b.p.addScaledVector(b.v, dt);
        b.v.y -= G * dt;
        b.v.multiplyScalar(Math.exp(-0.05 * dt));
        if (b.t > 3 || b.p.y < -30) this.bullets.splice(i, 1);
      }
      if (b.trace && tn < this.maxTr && b.t > 0.012) {
        const tail = Math.min(step * 1.4, 22);
        const e = hitT || hw ? prev.addScaledVector(_d, best) : b.p;
        this.trPos.set([e.x - _d.x * tail, e.y - _d.y * tail, e.z - _d.z * tail, e.x, e.y, e.z], tn * 6);
        tn++;
      }
    }
    this.tracers.geometry.setDrawRange(0, tn * 2);
    this.trAttr.needsUpdate = true;

    // grenades
    for (let i = this.nades.length - 1; i >= 0; i--) {
      const n = this.nades[i];
      n.t += dt;
      if (!n.rest) {
        const sub = 3;
        for (let s = 0; s < sub; s++) {
          const h = dt / sub;
          n.v.y -= G * h;
          const sp = n.v.length();
          if (sp < 0.001) break;
          _d.copy(n.v).divideScalar(sp);
          const hit = this.phys.raycast(n.p.x, n.p.y, n.p.z, _d.x, _d.y, _d.z, sp * h + 0.08);
          if (hit) {
            n.p.set(hit.x + hit.nx * 0.09, hit.y + hit.ny * 0.09, hit.z + hit.nz * 0.09);
            const nn = new THREE.Vector3(hit.nx, hit.ny, hit.nz);
            n.v.reflect(nn).multiplyScalar(0.38);
            if (Math.abs(hit.ny) > 0.5 && n.v.length() < 1.2) { n.rest = true; n.v.set(0, 0, 0); }
            if (Math.random() < 0.5) audio.impact(n.p, SURF.metal);
            break;
          } else n.p.addScaledVector(n.v, h);
        }
        n.mesh.position.copy(n.p);
        n.mesh.rotation.x += dt * 8; n.mesh.rotation.z += dt * 5;
      }
      if (n.t >= THROWS[n.type].fuse) { this.explode(n); this.nades.splice(i, 1); }
    }
    // smoke clouds
    for (let i = this.smokes.length - 1; i >= 0; i--) {
      const s = this.smokes[i];
      s.t += dt;
      s.r = Math.min(7, s.t * 3);
      if (s.t < 22 && Math.random() < dt * 30) {
        const a = Math.random() * 6.283, rr = Math.random() * s.r * 0.6;
        this.fx.emit(s.p.x + Math.cos(a) * rr, s.p.y + 0.4 + Math.random() * 2.5, s.p.z + Math.sin(a) * rr, Math.cos(a) * 0.5, 0.25, Math.sin(a) * 0.5, 0.82, 0.84, 0.86, 0.55, 3 + Math.random() * 2, 6 + Math.random() * 3, 0.6);
      }
      if (s.t > 30) this.smokes.splice(i, 1);
    }
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) { this.flash.intensity = 0; this.flash.distance = 14; } }
    this.shake = Math.max(0, this.shake - dt * 2);
    this.fx.update(dt); this.fxAdd.update(dt);
  }

  setScale(h) { this.fx.mat.uniforms.scale.value = h * 0.9; this.fxAdd.mat.uniforms.scale.value = h * 0.9; }
  dispose() {
    for (const o of [this.fx.points, this.fxAdd.points, this.tracers, this.decals, this.flash]) this.scene.remove(o);
    for (const n of this.nades) this.scene.remove(n.mesh);
  }
}

// Drivable vehicles: arcade physics with 4-point ground sampling (terrain + bridges + ramps), suspension,
// collisions against the static world, damage/explosion, water handling, roadkill and engine audio.
import * as THREE from 'three';
import { autoRickshaw, jeep, bike, bus, boatModel } from './models.js';
import { audio } from './audio.js';
import { HALF } from './physics.js';

export const VSPEC = {
  auto: { make: () => autoRickshaw(), maxV: 17, acc: 5.5, steer: 1.7, len: 2.8, w: 1.4, h: 2.0, hp: 700, wb: 2.0, tr: 1.2, seats: [[0, 0.62, 0.3], [-0.35, 0.72, -0.72], [0.35, 0.72, -0.72], [0, 0.72, -0.72]], handles: [[-0.3, 1.35, 0.95], [0.3, 1.35, 0.95]], name: 'Auto-rickshaw' },
  jeep: { make: () => jeep('#556b2f'), maxV: 27, acc: 7.5, steer: 1.4, len: 3.8, w: 1.8, h: 2.1, hp: 1300, wb: 2.3, tr: 1.6, seats: [[-0.4, 0.95, 0.35], [0.4, 0.95, 0.35], [-0.4, 0.95, -0.5], [0.4, 0.95, -0.5]], handles: [[-0.62, 1.55, 0.95], [-0.18, 1.55, 0.95]], name: 'Gypsy' },
  bike: { make: () => bike('#212121'), maxV: 31, acc: 9, steer: 1.9, len: 2.1, w: 0.8, h: 1.5, hp: 450, wb: 1.4, tr: 0.3, seats: [[0, 0.62, -0.25], [0, 0.66, -0.75]], handles: [[-0.36, 1.2, 0.58], [0.36, 1.2, 0.58]], name: 'Bullet', lean: true },
  bus: { make: () => bus('#c62828', '#f5e6c8'), maxV: 19, acc: 3.2, steer: 0.9, len: 10.5, w: 2.5, h: 3.1, hp: 2500, wb: 7, tr: 2.2, seats: [[-0.7, 1.3, 4.3], [0.6, 1.3, 2.5], [-0.6, 1.3, 1.0], [0.6, 1.3, -0.5], [-0.6, 1.3, -2], [0.6, 1.3, -3.5]], handles: [[-1.0, 1.9, 4.9], [-0.4, 1.9, 4.9]], name: 'KSRTC Bus' },
  boat: { make: () => boatModel('#6d4c41', 'speed'), maxV: 18, acc: 5, steer: 1.2, len: 5.2, w: 1.8, h: 1.2, hp: 800, wb: 3.5, tr: 1.2, seats: [[0, 0.55, -2.0], [0, 0.55, 0.0], [-0.5, 0.55, 1.2], [0.5, 0.55, 1.2]], handles: [[-0.25, 1.1, -1.6], [0.25, 1.1, -1.6]], name: 'Boat', water: true },
};

let nextId = 1;
const _p = new THREE.Vector3();

export class Vehicle {
  constructor(kind, x, y, z, yaw, id) {
    this.id = id || 'v' + nextId++;
    this.kind = kind; this.S = VSPEC[kind];
    this.model = this.S.make();
    this.root = new THREE.Group(); this.root.add(this.model);
    this.pos = new THREE.Vector3(x, y, z);
    this.yaw = yaw; this.pitch = 0; this.roll = 0; this.speed = 0; this.vy = 0; this.steerA = 0;
    this.hp = this.S.hp; this.dead = false;
    this.seats = new Array(this.S.seats.length).fill(null);
    this.dyn = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0, owner: this };
    this.remote = null; this.owner = null;
    this.engine = null;
    this.bump = 0;
    this.syncT = 0;
    this._apply();
  }
  get driver() { return this.seats[0]; }
  fwd(out = new THREE.Vector3()) { return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }
  seatWorld(i, out = new THREE.Vector3()) { const s = this.S.seats[i]; return this.model.localToWorld(out.set(s[0], s[1], s[2])); }
  handlesWorld() { return this.S.handles.map((h) => this.model.localToWorld(new THREE.Vector3(...h))); }

  _apply() {
    this.root.position.copy(this.pos);
    this.root.rotation.set(0, 0, 0);
    // model faces +z; our yaw convention faces -z
    this.root.quaternion.setFromEuler(new THREE.Euler(-this.pitch, this.yaw + Math.PI, this.roll, 'YXZ'));
    this.root.updateMatrixWorld(true);
    const hl = this.S.len / 2, hw = this.S.w / 2;
    const c = Math.abs(Math.cos(this.yaw)), s = Math.abs(Math.sin(this.yaw));
    const ex = c * hw + s * hl, ez = s * hw + c * hl;
    Object.assign(this.dyn, { minX: this.pos.x - ex * 0.85, maxX: this.pos.x + ex * 0.85, minZ: this.pos.z - ez * 0.85, maxZ: this.pos.z + ez * 0.85, minY: this.pos.y + 0.2, maxY: this.pos.y + this.S.h * 0.75 });
  }

  ground(phys, lx, lz) {
    const f = this.fwd(_p);
    const rx = -f.z, rz = f.x;
    const x = this.pos.x + f.x * lz + rx * lx, z = this.pos.z + f.z * lz + rz * lx;
    if (this.S.water) { const l = phys.waterLevel(x, z); const h = phys.height(x, z); return l > h ? l : h; }
    return phys.support(x, z, 0.25, this.pos.y + 1.4);
  }

  // input: {throttle, steer, brake, horn}; ctx: {phys, map, potholes, slowZones}
  step(dt, input, ctx) {
    if (this.dead) return;
    const S = this.S, phys = ctx.phys;
    const throttle = input ? input.throttle : 0, steer = input ? input.steer : 0, brake = input ? input.brake : false;
    let maxV = S.maxV;
    for (const z of ctx.slowZones || []) if (Math.hypot(this.pos.x - z.x, this.pos.z - z.z) < z.r) maxV = Math.min(maxV, S.maxV * z.k);
    const inWater = !S.water && phys.waterLevel(this.pos.x, this.pos.z) > this.pos.y + 0.9;
    const onLand = S.water && phys.height(this.pos.x, this.pos.z) > phys.waterLevel(this.pos.x, this.pos.z) - 0.2;
    if (inWater) { this.speed *= Math.exp(-dt * 3); this.hp -= 40 * dt; }
    else {
      if (throttle > 0) this.speed += S.acc * throttle * dt * (this.speed < 0 ? 2.5 : 1) * (1 - Math.max(0, this.speed) / maxV * 0.5);
      else if (throttle < 0) this.speed += S.acc * throttle * dt * (this.speed > 0 ? 2.2 : 0.6);
      else this.speed *= Math.exp(-dt * (S.water ? 0.8 : 0.35));
      if (brake) this.speed *= Math.exp(-dt * 4);
      if (onLand) this.speed *= Math.exp(-dt * 6);
    }
    this.speed = Math.max(-maxV * 0.3, Math.min(maxV, this.speed));
    if (Math.abs(this.speed) > maxV) this.speed *= Math.exp(-dt * 3);
    this.steerA += (steer - this.steerA) * Math.min(1, dt * 6);
    const sp = this.speed;
    const turn = this.steerA * S.steer * Math.min(1, Math.abs(sp) / 4) * Math.sign(sp) * (1 / (1 + Math.abs(sp) * 0.025));
    this.yaw += turn * dt;
    const prev = this.pos.clone();
    const f = this.fwd(new THREE.Vector3());
    this.pos.addScaledVector(f, sp * dt);
    this.pos.x = Math.max(-HALF + 7, Math.min(HALF - 7, this.pos.x)); this.pos.z = Math.max(-HALF + 7, Math.min(HALF - 7, this.pos.z));
    // world collision at the bumper
    const probe = this.pos.clone().addScaledVector(f, (S.len / 2) * Math.sign(sp || 1));
    const ids = phys.query(probe.x - S.w / 2, probe.z - S.w / 2, probe.x + S.w / 2, probe.z + S.w / 2, []);
    let blocked = false;
    for (const id of ids) {
      const b = id * 6, top = phys.bx[b + 4], bot = phys.bx[b + 1];
      if (top > this.pos.y + 0.75 && bot < this.pos.y + S.h * 0.8) { blocked = true; break; }
    }
    if (blocked) {
      if (Math.abs(sp) > 6) { this.damage(Math.abs(sp) * 14); audio.impact(this.pos.clone(), 1); ctx.onCrash && ctx.onCrash(this, Math.abs(sp)); }
      this.pos.copy(prev); this.speed = -sp * 0.25;
    }
    // suspension from four wheel contacts
    const hl = S.wb / 2, ht = S.tr / 2;
    const fl = this.ground(phys, -ht, hl), fr = this.ground(phys, ht, hl), bl = this.ground(phys, -ht, -hl), br = this.ground(phys, ht, -hl);
    const target = (fl + fr + bl + br) / 4;
    let pothole = false;
    for (const p of ctx.potholes || []) if (Math.hypot(this.pos.x - p.x, this.pos.z - p.z) < p.r) pothole = true;
    if (pothole && Math.abs(sp) > 3 && this.bump <= 0) { this.bump = 0.35; this.speed *= 0.55; this.vy = 2.5; ctx.onPothole && ctx.onPothole(this); }
    this.bump -= dt;
    if (this.pos.y > target + 0.25 || this.vy > 0) {
      this.vy -= 9.81 * dt;
      this.pos.y += this.vy * dt;
      if (this.pos.y <= target) { if (this.vy < -9) this.damage((-this.vy - 9) * 30); this.pos.y = target; this.vy = 0; }
    } else { this.pos.y += (target - this.pos.y) * Math.min(1, dt * 14); this.vy = 0; }
    const tp = Math.atan2((fl + fr) / 2 - (bl + br) / 2, S.wb), tr = Math.atan2((fl + bl) / 2 - (fr + br) / 2, S.tr);
    this.pitch += (tp - this.pitch) * Math.min(1, dt * 8);
    const lean = S.lean ? -this.steerA * Math.min(1, Math.abs(sp) / 12) * 0.45 : 0;
    this.roll += ((S.lean ? lean : tr) - this.roll) * Math.min(1, dt * 8);
    if (S.water) { this.pitch = Math.sin(performance.now() * 0.002) * 0.03 + sp * 0.004; }
    this._apply();
    // engine sound
    if (this.driver) {
      if (!this.engine) this.engine = audio.loop('eng:' + this.id, 'engine');
      this.engine && this.engine.set({ rpm: Math.min(1, Math.abs(sp) / S.maxV + (throttle ? 0.15 : 0)), pos: this.pos, vol: this.driver.isLocal ? 0.28 : 0.5 });
    } else if (this.engine) { this.engine.stop(); this.engine = null; }
    if (this.hp <= 0) this.explode(ctx);
  }

  damage(d) { this.hp -= d; }
  explode(ctx) {
    if (this.dead) return;
    this.dead = true;
    this.speed = 0;
    this.model.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.material.color && o.material.color.multiplyScalar(0.15); } });
    ctx.onExplode && ctx.onExplode(this);
    if (this.engine) { this.engine.stop(); this.engine = null; }
  }

  // network interpolation for vehicles driven by someone else
  netApply(m) {
    this.remote = { p: new THREE.Vector3(...m.p), yaw: m.y, pitch: m.pi, roll: m.r, t: performance.now() };
    this.speed = m.s; this.hp = m.hp;
  }
  netUpdate(dt) {
    if (!this.remote) return;
    const k = Math.min(1, dt * 10);
    this.pos.lerp(this.remote.p, k);
    let dy = this.remote.yaw - this.yaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
    this.yaw += dy * k; this.pitch += (this.remote.pitch - this.pitch) * k; this.roll += (this.remote.roll - this.roll) * k;
    this._apply();
  }
  snap() { return { id: this.id, p: [+this.pos.x.toFixed(2), +this.pos.y.toFixed(2), +this.pos.z.toFixed(2)], y: +this.yaw.toFixed(3), pi: +this.pitch.toFixed(3), r: +this.roll.toFixed(3), s: +this.speed.toFixed(2), hp: Math.round(this.hp) }; }
}

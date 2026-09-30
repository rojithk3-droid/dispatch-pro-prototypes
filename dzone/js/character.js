// Soldier avatar: Mixamo rig from the three.js repo, animation blending (idle/walk/run/T-pose),
// analytic two-bone IK so hands hold the actual gun, leg IK for crouch, poses for prone / freefall /
// parachute / driving / swimming / death, bone-attached gear and bone-driven hitboxes.
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { gunModel, attachmentModel, helmetModel, vestModel, backpackModel, cosmeticModel, part } from './models.js';
import { WEAPONS } from './weapons.js';

const V = () => new THREE.Vector3();
const _a = V(), _b = V(), _c = V(), _t = V(), _p = V(), _d = V(), _e = V();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

function worldPos(o, out) { return o.getWorldPosition(out); }

// rotate a bone so the direction (from bone to `from`) turns toward `to` (world space)
function swing(bone, from, to) {
  const o = worldPos(bone, _p);
  _d.subVectors(from, o).normalize();
  _e.subVectors(to, o).normalize();
  if (_d.lengthSq() < 1e-8 || _e.lengthSq() < 1e-8) return;
  _q.setFromUnitVectors(_d, _e);
  bone.getWorldQuaternion(_q2);
  _q2.premultiply(_q);
  bone.parent.getWorldQuaternion(_q3).invert();
  bone.quaternion.copy(_q3.multiply(_q2));
  bone.updateMatrixWorld(true);
}

// two-bone IK with a pole target (all world space)
export function ik(upper, lower, end, target, pole, blend = 1) {
  upper.updateMatrixWorld(true);
  const A = worldPos(upper, V()), B = worldPos(lower, V()), C = worldPos(end, V());
  const lab = A.distanceTo(B), lbc = B.distanceTo(C);
  const T = target.clone();
  if (blend < 1) T.lerpVectors(C, target, blend);
  let dist = A.distanceTo(T);
  dist = Math.min(Math.max(dist, Math.abs(lab - lbc) + 1e-3), lab + lbc - 1e-3);
  const dir = T.clone().sub(A).normalize();
  const cosA = (lab * lab + dist * dist - lbc * lbc) / (2 * lab * dist);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const pv = pole.clone().sub(A);
  pv.sub(dir.clone().multiplyScalar(pv.dot(dir))).normalize();
  const Bdes = A.clone().add(dir.clone().multiplyScalar(cosA * lab)).add(pv.multiplyScalar(sinA * lab));
  swing(upper, B, Bdes);
  swing(lower, worldPos(end, V()), T);
}

function rotWorld(bone, axis, ang) {
  if (!ang) return;
  _q.setFromAxisAngle(axis, ang);
  bone.getWorldQuaternion(_q2); _q2.premultiply(_q);
  bone.parent.getWorldQuaternion(_q3).invert();
  bone.quaternion.copy(_q3.multiply(_q2));
  bone.updateMatrixWorld(true);
}

const OUTFITS = {
  classic: { tint: 0xffffff },
  urban: { tint: 0xa9b4c2 },
  desert: { tint: 0xe8cf9f },
  jungle: { tint: 0x9fbf86 },
  midnight: { tint: 0x7d86a8 },
  saffron: { tint: 0xffc48a },
};
export const OUTFIT_LIST = Object.keys(OUTFITS);
export const COSMETICS = ['none', 'monkeycap', 'coolingglass', 'thorthu', 'himachali', 'hardhat', 'visor', 'bandana'];
export const COSMETIC_NAMES = { none: 'None', monkeycap: 'Delhi Monkey Cap', coolingglass: 'Cooling Glass', thorthu: 'Thorthu Headband', himachali: 'Himachali Topi', hardhat: 'Gurugram Hard Hat', visor: 'Neon Visor', bandana: 'Bandana' };
const matCache = new Map();

export class Avatar {
  constructor(gltf, opts = {}) {
    this.root = new THREE.Group();
    this.model = SkeletonUtils.clone(gltf.scene);
    this.root.add(this.model);
    const tint = (OUTFITS[opts.outfit] || OUTFITS.classic).tint;
    this.model.traverse((o) => {
      if (o.isMesh || o.isSkinnedMesh) {
        const key = o.material.uuid + ':' + tint;
        if (!matCache.has(key)) { const m = o.material.clone(); m.color.setHex(tint); matCache.set(key, m); }
        o.material = matCache.get(key);
        o.castShadow = true; o.frustumCulled = false;
      }
    });
    const b = (n) => this.model.getObjectByName('mixamorig' + n);
    this.bones = {
      hips: b('Hips'), spine: b('Spine'), spine1: b('Spine1'), spine2: b('Spine2'), neck: b('Neck'), head: b('Head'),
      lArm: b('LeftArm'), lFore: b('LeftForeArm'), lHand: b('LeftHand'), rArm: b('RightArm'), rFore: b('RightForeArm'), rHand: b('RightHand'),
      lUp: b('LeftUpLeg'), lLeg: b('LeftLeg'), lFoot: b('LeftFoot'), rUp: b('RightUpLeg'), rLeg: b('RightLeg'), rFoot: b('RightFoot'),
    };
    this.mixer = new THREE.AnimationMixer(this.model);
    const clip = (n) => gltf.animations.find((a) => a.name === n);
    this.act = {};
    for (const n of ['Idle', 'Walk', 'Run', 'TPose']) { const a = this.mixer.clipAction(clip(n)); a.play(); a.setEffectiveWeight(n === 'Idle' ? 1 : 0); this.act[n] = a; }
    this.act.Walk.time = Math.random(); this.act.Run.time = Math.random() * 0.5;
    // anchors attached in bind pose so gear follows bones with body-aligned axes in metres
    this.root.updateMatrixWorld(true);
    this.headAnchor = this._anchor(this.bones.head, new THREE.Vector3(0, 0.1, 0.0));
    this.chestAnchor = this._anchor(this.bones.spine2, new THREE.Vector3(0, 0.02, 0.0));
    this.gunPivot = new THREE.Group(); this.root.add(this.gunPivot);
    this.gunHolder = new THREE.Group(); this.gunPivot.add(this.gunHolder);
    this.backSlots = [new THREE.Group(), new THREE.Group()];
    this.backSlots.forEach((s) => this.chestAnchor.add(s));
    this.backSlots[0].position.set(0.02, -0.05, 0.19); this.backSlots[0].rotation.set(Math.PI / 2, 0, 0.55, 'ZYX');
    this.backSlots[1].position.set(-0.02, -0.05, 0.25); this.backSlots[1].rotation.set(Math.PI / 2, 0, -0.55, 'ZYX');
    this.gear = {};
    this.gunId = null; this.gun = null;
    this.state = { speed: 0, fwd: 0, side: 0, stance: 'stand', aiming: false, pitch: 0, dead: false, mode: 'ground' };
    this.crouchT = 0; this.proneT = 0; this.deathT = 0; this.kick = 0; this.reloadT = 0;
    this.hitSpheres = [];
    for (let i = 0; i < 10; i++) this.hitSpheres.push({ c: new THREE.Vector3(), r: 0.1, part: 'body' });
    if (opts.cosmetic && opts.cosmetic !== 'none') this.setCosmetic(opts.cosmetic);
    this.canopy = null;
    this.lod = 0;
  }

  _anchor(bone, offset) {
    const h = new THREE.Group();
    const bw = new THREE.Matrix4().copy(bone.matrixWorld);
    const bs = new THREE.Vector3(), bq = new THREE.Quaternion(), bp = new THREE.Vector3();
    bw.decompose(bp, bq, bs);
    const rq = this.root.getWorldQuaternion(new THREE.Quaternion());
    h.quaternion.copy(bq.clone().invert().multiply(rq));
    h.scale.setScalar(1 / bs.x);
    const wp = bp.clone().add(offset.clone().applyQuaternion(rq));
    h.position.copy(bone.worldToLocal(wp));
    bone.add(h);
    return h;
  }

  setCosmetic(id) {
    if (this.gear.cos) this.headAnchor.remove(this.gear.cos);
    if (id && id !== 'none') { this.gear.cos = cosmeticModel(id); this.gear.cos.name = id; this.headAnchor.add(this.gear.cos); } else this.gear.cos = null;
  }
  setGear(slot, level) {
    const anchor = slot === 'helmet' ? this.headAnchor : this.chestAnchor;
    if (this.gear[slot]) { anchor.remove(this.gear[slot]); this.gear[slot] = null; }
    if (!level) { if (slot === 'helmet' && this.gear.cos) this.gear.cos.visible = true; return; }
    const m = slot === 'helmet' ? helmetModel(level) : slot === 'vest' ? vestModel(level) : backpackModel(level);
    if (slot === 'vest') m.position.set(0, -0.08, 0);
    if (slot === 'pack') m.position.set(0, -0.08, 0.16);
    if (slot === 'helmet') { m.position.set(0, -0.02, 0.01); if (this.gear.cos && ['monkeycap', 'himachali', 'hardhat', 'bandana'].includes(this.gear.cos.name)) this.gear.cos.visible = false; }
    anchor.add(m); this.gear[slot] = m;
  }

  // weapon in hands; attachments: {sight, muzzle, grip, mag}
  setWeapon(id, att = {}) {
    if (this.gun) { this.gunHolder.remove(this.gun); this.gun = null; }
    this.gunId = id;
    if (!id) return;
    this.gun = buildGun(id, att);
    this.gunHolder.add(this.gun);
  }
  setBackGuns(ids) {
    this.backSlots.forEach((s, i) => {
      while (s.children.length) s.remove(s.children[0]);
      if (ids[i] && WEAPONS[ids[i]].cls !== 'pistol' && WEAPONS[ids[i]].cls !== 'melee') s.add(gunModel(ids[i]));
    });
  }

  showCanopy(on, color = '#ff3f8e') {
    if (on && !this.canopy) {
      const g = new THREE.Group();
      const geo = new THREE.SphereGeometry(3.2, 20, 8, 0, Math.PI * 2, 0, Math.PI * 0.32);
      geo.scale(1.3, 0.55, 0.8);
      const cols = [color, '#8a2352'];
      for (let i = 0; i < 2; i++) { const m = part(g, geo.clone(), 'cloth', cols[i], 0, 4.6 - i * 0.02, 0); m.material = m.material.clone(); m.material.side = THREE.DoubleSide; if (i) m.scale.setScalar(0.995); }
      const lines = new THREE.BufferGeometry().setFromPoints([...[-2.6, -1.3, 0, 1.3, 2.6].flatMap((x) => [new THREE.Vector3(0, 1.9, 0), new THREE.Vector3(x * 1.3, 5.9, 0)])]);
      g.add(new THREE.LineSegments(lines, new THREE.LineBasicMaterial({ color: 0x222222 })));
      g.scale.setScalar(0.72); g.position.y = 0.9;
      this.canopy = g; this.root.add(g);
    }
    if (this.canopy) this.canopy.visible = on;
  }

  // s: {speed, fwd, side, stance, aiming, pitch, mode:'ground'|'freefall'|'chute'|'drive'|'swim'|'plane', dead, reloading, fire}
  update(dt, s, camDist = 0) {
    const B = this.bones;
    this.state = s;
    if (s.mode === 'plane') { this.root.visible = false; return; }
    this.root.visible = true;
    if (s.dead) return this._updateDead(dt);
    // LOD: far avatars animate at a lower rate
    this.lod += dt;
    const every = camDist > 160 ? 0.2 : camDist > 70 ? 0.066 : 0;
    if (this.lod < every) return;
    const adt = this.lod; this.lod = 0;

    const ground = s.mode === 'ground' || s.mode === 'swim';
    const speed = s.speed || 0;
    const wantWalk = ground ? THREE.MathUtils.clamp(speed / 2.2, 0, 1) * (1 - THREE.MathUtils.clamp((speed - 3) / 2.5, 0, 1)) : 0;
    const wantRun = ground ? THREE.MathUtils.clamp((speed - 3) / 2.5, 0, 1) : 0;
    const wantT = s.mode === 'freefall' ? 1 : 0;
    const k = 1 - Math.exp(-adt * 10);
    const w = this._w || (this._w = { Idle: 1, Walk: 0, Run: 0, TPose: 0 });
    w.Walk += (wantWalk - w.Walk) * k; w.Run += (wantRun - w.Run) * k; w.TPose += (wantT - w.TPose) * k;
    w.Idle = Math.max(0, 1 - w.Walk - w.Run - w.TPose);
    for (const n in w) this.act[n].setEffectiveWeight(w[n]);
    const back = (s.fwd || 0) < -0.3 ? -1 : 1;
    this.act.Walk.timeScale = back * THREE.MathUtils.clamp(speed / 1.6, 0.6, 1.6) * (s.stance === 'crouch' ? 1.25 : 1);
    this.act.Run.timeScale = back * THREE.MathUtils.clamp(speed / 5.5, 0.8, 1.35);
    this.mixer.update(adt);

    const cT = s.stance === 'crouch' && ground ? 1 : 0, pT = s.stance === 'prone' && ground ? 1 : 0;
    this.crouchT += (cT - this.crouchT) * (1 - Math.exp(-adt * 12));
    this.proneT += (pT - this.proneT) * (1 - Math.exp(-adt * 8));

    this.model.position.set(0, 0, 0);
    this.model.rotation.set(0, 0, 0);
    this.root.updateMatrixWorld(true);

    const rootQ = this.root.getWorldQuaternion(new THREE.Quaternion());
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(rootQ);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(rootQ);

    // strafing: twist the hips toward travel, counter-rotate the spine
    if (ground && speed > 0.5 && this.proneT < 0.5) {
      const twist = Math.atan2(-(s.side || 0), Math.abs(s.fwd || 0) + 0.001) * (s.fwd < -0.3 ? -1 : 1) * 0.7;
      rotWorld(B.hips, UP, twist);
      rotWorld(B.spine, UP, -twist * 0.5); rotWorld(B.spine1, UP, -twist * 0.5);
    }

    // crouch: drop the pelvis, keep the animated feet planted with leg IK
    const drop = this.crouchT * 0.52;
    if (drop > 0.01 && this.proneT < 0.5) {
      const lf = worldPos(B.lFoot, V()), rf = worldPos(B.rFoot, V());
      this.model.position.y = -drop;
      this.root.updateMatrixWorld(true);
      const pole = fwd.clone().multiplyScalar(2);
      ik(B.lUp, B.lLeg, B.lFoot, lf.add(fwd.clone().multiplyScalar(0.08)), worldPos(B.lLeg, V()).add(pole));
      ik(B.rUp, B.rLeg, B.rFoot, rf.add(fwd.clone().multiplyScalar(-0.05)), worldPos(B.rLeg, V()).add(pole));
      rotWorld(B.spine, right, -0.25 * this.crouchT);
    }
    // prone: lay the whole body down, crawl wiggle
    if (this.proneT > 0.01) {
      this.model.rotation.x = -Math.PI / 2 * this.proneT;
      this.model.position.set(0, 0.28 * this.proneT, 0.9 * this.proneT);
      this.root.updateMatrixWorld(true);
      rotWorld(B.neck, right, 0.9 * this.proneT); rotWorld(B.head, right, 0.4 * this.proneT);
    }
    if (s.mode === 'freefall') {
      this.model.rotation.x = -1.25; this.model.position.set(0, 0.9, 0.5);
      this.root.updateMatrixWorld(true);
      rotWorld(B.lArm, fwd, -0.5); rotWorld(B.rArm, fwd, 0.5);
      rotWorld(B.lUp, right, 0.4); rotWorld(B.rUp, right, 0.4);
      rotWorld(B.lLeg, right, -0.9); rotWorld(B.rLeg, right, -0.9);
    }
    if (s.mode === 'drive' || s.mode === 'ride') {
      this.model.position.y = -0.55;
      this.root.updateMatrixWorld(true);
      rotWorld(B.lUp, right, 1.45); rotWorld(B.rUp, right, 1.45);
      rotWorld(B.lLeg, right, -1.5); rotWorld(B.rLeg, right, -1.5);
    }
    if (s.mode === 'swim') {
      this.model.rotation.x = -1.2; this.model.position.set(0, -0.2, 0.5);
      this.root.updateMatrixWorld(true);
    }

    // weapon pivot + arms
    const W = this.gunId ? WEAPONS[this.gunId] : null;
    const eyeY = 1.52 - drop + (this.proneT > 0.5 ? -1.05 : 0);
    const armed = W && ground && s.mode !== 'swim';
    this.gunPivot.visible = !!(W && (ground || s.mode === 'chute') && s.mode !== 'swim' && s.mode !== 'drive');
    if (armed) {
      const aim = s.aiming || s.firing;
      const low = !aim && speed > 5 ? 1 : 0;
      this._low = (this._low || 0) + (low - (this._low || 0)) * (1 - Math.exp(-adt * 8));
      const pitch = THREE.MathUtils.clamp(s.pitch, -1.2, 1.2);
      this.gunPivot.position.set(0.0, eyeY - 0.12, this.proneT > 0.5 ? -0.55 : -0.02);
      this.gunPivot.rotation.set(pitch - this._low * 0.5, this._low * 0.55, 0, 'YXZ');
      const pistol = W.cls === 'pistol', melee = W.cls === 'melee';
      this.kick = Math.max(0, this.kick - adt * 12);
      this.gunHolder.position.set(pistol ? 0.02 : 0.16, pistol ? -0.02 : -0.03, (pistol ? -0.48 : melee ? -0.35 : -0.38) + this.kick * 0.06);
      this.gunHolder.rotation.set(this.kick * 0.08, 0, melee ? 0.3 : 0);
      if (s.reloading) this.gunHolder.rotation.z = Math.sin(Math.min(1, s.reloading) * Math.PI) * 0.6;
      this.root.updateMatrixWorld(true);
      // bend the torso with pitch so the chest follows the gun
      const p = pitch * (this.proneT > 0.5 ? 0.15 : 0.33);
      rotWorld(B.spine, right, p); rotWorld(B.spine1, right, p); rotWorld(B.spine2, right, p * 0.8);
      this.root.updateMatrixWorld(true);
      if (this.gun) {
        const grip = this.gun.getObjectByName('grip').getWorldPosition(V());
        const fore = this.gun.getObjectByName(pistol || melee ? 'grip' : 'fore').getWorldPosition(V());
        if (pistol) fore.add(right.clone().multiplyScalar(-0.04));
        const down = new THREE.Vector3(0, -1, 0);
        ik(B.rArm, B.rFore, B.rHand, grip, worldPos(B.rFore, V()).add(down).add(right.clone().multiplyScalar(0.6)).add(fwd.clone().multiplyScalar(-0.3)));
        if (!melee) ik(B.lArm, B.lFore, B.lHand, fore, worldPos(B.lFore, V()).add(down).add(right.clone().multiplyScalar(-0.6)));
      }
    } else if (s.mode === 'chute') {
      const up = worldPos(B.head, V()).add(new THREE.Vector3(0, 0.45, 0));
      ik(B.rArm, B.rFore, B.rHand, up.clone().add(right.clone().multiplyScalar(0.35)), worldPos(B.rFore, V()).add(right.clone().multiplyScalar(1)).add(fwd.clone().multiplyScalar(-0.5)));
      ik(B.lArm, B.lFore, B.lHand, up.clone().add(right.clone().multiplyScalar(-0.35)), worldPos(B.lFore, V()).add(right.clone().multiplyScalar(-1)).add(fwd.clone().multiplyScalar(-0.5)));
    } else if (s.mode === 'drive' && s.handles) {
      const [hl, hr] = s.handles;
      ik(B.rArm, B.rFore, B.rHand, hr, worldPos(B.rFore, V()).add(new THREE.Vector3(0, -1, 0)).add(right.clone().multiplyScalar(0.7)));
      ik(B.lArm, B.lFore, B.lHand, hl, worldPos(B.lFore, V()).add(new THREE.Vector3(0, -1, 0)).add(right.clone().multiplyScalar(-0.7)));
    }
    // head follows aim pitch
    if (ground && this.proneT < 0.5) rotWorld(B.neck, right, THREE.MathUtils.clamp(s.pitch, -1, 1) * (armed ? 0.25 : 0.5));
    this.showCanopy(s.mode === 'chute');
    this._updateHitSpheres();
  }

  _updateDead(dt) {
    this.deathT = Math.min(1, this.deathT + dt * 2.2);
    const e = 1 - Math.pow(1 - this.deathT, 3);
    this.model.rotation.x = e * (Math.PI / 2) * 0.98;
    this.model.position.set(0, 0.15 * e, 0.35 * e);
    this.gunPivot.visible = false;
    if (this.canopy) this.canopy.visible = false;
    if (this.deathT < 1) { this.mixer.update(dt * 0.3); this.root.updateMatrixWorld(true); }
    this.hitSpheres.forEach((h) => (h.r = 0));
  }

  _updateHitSpheres() {
    const B = this.bones, H = this.hitSpheres;
    const set = (i, bone, r, partName, bone2) => {
      worldPos(bone, H[i].c);
      if (bone2) H[i].c.lerp(worldPos(bone2, _t), 0.5);
      H[i].r = r; H[i].part = partName;
    };
    set(0, B.head, 0.15, 'head'); H[0].c.y += 0.07;
    set(1, B.spine2, 0.22, 'body');
    set(2, B.spine, 0.21, 'body');
    set(3, B.hips, 0.2, 'body');
    set(4, B.lArm, 0.08, 'limb', B.lFore);
    set(5, B.rArm, 0.08, 'limb', B.rFore);
    set(6, B.lUp, 0.12, 'limb', B.lLeg);
    set(7, B.rUp, 0.12, 'limb', B.rLeg);
    set(8, B.lLeg, 0.1, 'limb', B.lFoot);
    set(9, B.rLeg, 0.1, 'limb', B.rFoot);
  }

  headPos(out) { return worldPos(this.bones.head, out); }
  muzzle(out) { if (this.gun) return this.gun.getObjectByName('muzzle').getWorldPosition(out); return this.headPos(out); }
  dispose() { this.root.removeFromParent(); }
}

// gun + attachments assembly (shared by avatars, viewmodel and loot)
export function buildGun(id, att = {}) {
  const g = gunModel(id);
  const W = WEAPONS[id];
  if (!W || W.cls === 'melee') return g;
  if (att.sight) { const s = attachmentModel(att.sight); s.position.copy(g.getObjectByName('rail').position); g.add(s); g.userData.sight = s; }
  if (att.muzzle) { const m = attachmentModel(att.muzzle); m.position.copy(g.getObjectByName('muzzle').position); g.add(m); g.getObjectByName('muzzle').position.z -= att.muzzle === 'suppressor' ? 0.2 : 0.07; }
  if (att.grip) { const m = attachmentModel('vgrip'); m.position.copy(g.getObjectByName('under').position); g.add(m); }
  if (att.mag) { const mag = g.getObjectByName('mag'); if (mag) mag.scale.y = 1.35; }
  return g;
}

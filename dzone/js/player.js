// Local player: input, movement physics, skydiving, camera (TPP / FPP / ADS), weapon handling with
// recoil + bloom + bolt/reload timing, first-person viewmodel with arms, throwables, meds and the tawa.
import * as THREE from 'three';
import { WEAPONS, ATTACHMENTS, MEDS, BOOSTS, THROWS } from './weapons.js';
import { buildGun } from './character.js';
import { part, MM } from './models.js';
import { audio } from './audio.js';
import { clamp, lerp, damp } from './util.js';
import { SURF, HALF } from './physics.js';

const DEG = Math.PI / 180;
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion();
const EYE = { stand: 1.62, crouch: 1.12, prone: 0.38 };
const HEIGHT = { stand: 1.78, crouch: 1.25, prone: 0.6 };

export class Input {
  constructor(el) {
    this.el = el; this.keys = new Set(); this.pressed = new Set(); this.mdx = 0; this.mdy = 0; this.lmb = false; this.rmb = false; this.lmbDown = false; this.rmbDown = false; this.wheel = 0;
    this.enabled = true; this.locked = false;
    // lockFailed: the browser refused mouse capture (embedded views, some kiosks). We then fall back to
    // "cursor look": moving the mouse over the game view turns the camera, buttons still fire/aim.
    this.lockFailed = false;
    this.el.tabIndex = 0;
    const typing = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') && t.offsetParent !== null;
    this._kd = (e) => {
      if (typing(e.target)) return;
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (['Tab', 'Space', 'AltLeft', 'KeyF', 'ControlLeft', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code) || e.code.startsWith('Digit')) e.preventDefault();
    };
    this._ku = (e) => this.keys.delete(e.code);
    this._blur = () => { this.keys.clear(); this.lmb = this.rmb = false; };
    const onView = (e) => e.target === this.el;
    this._mm = (e) => {
      if (this.locked || (this.lockFailed && onView(e))) { this.mdx += e.movementX; this.mdy += e.movementY; }
    };
    this._md = (e) => {
      if (!this.locked && !onView(e)) return;
      this.el.focus({ preventScroll: true });
      if (e.button === 0) { this.lmb = true; this.lmbDown = true; }
      if (e.button === 2) { this.rmb = true; this.rmbDown = true; }
    };
    this._mu = (e) => { if (e.button === 0) this.lmb = false; if (e.button === 2) this.rmb = false; };
    this._wh = (e) => { if (this.locked || onView(e)) this.wheel += Math.sign(e.deltaY); };
    this._pl = () => { this.locked = document.pointerLockElement === this.el; if (this.locked) this.lockFailed = false; else { this.lmb = this.rmb = false; } };
    this._pe = () => { this.lockFailed = true; };
    addEventListener('keydown', this._kd); addEventListener('keyup', this._ku); addEventListener('mousemove', this._mm); addEventListener('blur', this._blur);
    addEventListener('mousedown', this._md); addEventListener('mouseup', this._mu); addEventListener('wheel', this._wh, { passive: true });
    document.addEventListener('pointerlockchange', this._pl);
    document.addEventListener('pointerlockerror', this._pe);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  lock() {
    if (this.locked) return;
    if (document.activeElement && document.activeElement !== this.el && document.activeElement.blur) document.activeElement.blur();
    this.el.focus({ preventScroll: true });
    const fail = () => { this.lockFailed = true; };
    try {
      const p = this.el.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch((err) => {
        if (err && err.name === 'NotSupportedError') { try { const q = this.el.requestPointerLock(); if (q && q.catch) q.catch(fail); } catch { fail(); } }
        else if (err && err.name !== 'NotAllowedError') fail();
      });
    } catch { fail(); }
  }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }
  down(c) { return this.enabled && this.keys.has(c); }
  hit(c) { return this.enabled && this.pressed.has(c); }
  endFrame() { this.pressed.clear(); this.mdx = this.mdy = 0; this.lmbDown = this.rmbDown = false; this.wheel = 0; }
  dispose() {
    removeEventListener('keydown', this._kd); removeEventListener('keyup', this._ku); removeEventListener('mousemove', this._mm);
    removeEventListener('mousedown', this._md); removeEventListener('mouseup', this._mu); removeEventListener('wheel', this._wh); removeEventListener('blur', this._blur);
    document.removeEventListener('pointerlockchange', this._pl);
    document.removeEventListener('pointerlockerror', this._pe);
  }
}

export class LocalPlayer {
  constructor(match, ent, camera, settings) {
    this.m = match; this.e = ent; this.cam = camera; this.set = settings;
    this.input = match.input;
    this.view = 'tpp';
    this.adsK = 0; this.eyeH = EYE.stand; this.camDist = 2.7;
    this.recoil = { p: 0, y: 0, vp: 0 }; this.bloom = 0; this.shotT = 0;
    this.stepAcc = 0; this.freeLook = 0; this.freeLookPitch = 0;
    this.lastGroundY = 0; this.airT = 0; this.vault = null;
    this.vm = this._buildViewmodel();
    this.vmKey = '';
    this.bob = 0; this.sway = new THREE.Vector2(); this.vmKick = 0;
    this.throwHold = 0;
    this.meleeT = 0;
  }

  // ------------------------------------------------------------- viewmodel
  _buildViewmodel() {
    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(55, 1, 0.01, 10);
    scene.add(new THREE.HemisphereLight(0xdde6ff, 0x3b3226, 1.6));
    const dl = new THREE.DirectionalLight(0xffffff, 1.6); dl.position.set(0.5, 1, 0.3); scene.add(dl);
    const holder = new THREE.Group(); cam.add(holder); scene.add(cam);
    const arms = new THREE.Group();
    const sleeve = new THREE.CylinderGeometry(0.045, 0.055, 1, 10); sleeve.rotateX(Math.PI / 2); sleeve.translate(0, 0, 0.5);
    const mk = () => { const g = new THREE.Group(); part(g, sleeve.clone(), 'cloth', '#3d4435'); const glove = part(g, new THREE.BoxGeometry(0.075, 0.05, 0.11), 'cloth', '#1b1c1e', 0, 0, 0.02); glove.name = 'glove'; return g; };
    const la = mk(), ra = mk();
    arms.add(la, ra); holder.add(arms);
    return { scene, cam, holder, arms, la, ra, gun: null };
  }
  _vmSetGun() {
    const g = this.e.gun;
    const key = g ? g.id + JSON.stringify(g.att) : this.e.cur === 4 ? 'throw:' + this.e.throwId : 'none';
    if (key === this.vmKey) return;
    this.vmKey = key;
    const vm = this.vm;
    if (vm.gun) vm.holder.remove(vm.gun);
    vm.gun = g ? buildGun(g.id, g.att) : this.e.cur === 4 && this.e.throwId ? buildGun(this.e.throwId) : null;
    if (vm.gun) { vm.gun.traverse((o) => { if (o.isMesh) o.castShadow = false; }); vm.holder.add(vm.gun); }
  }
  _placeArm(arm, from, to) {
    const d = _v.subVectors(to, from); const L = d.length();
    arm.position.copy(from);
    arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), d.normalize());
    arm.children[0].scale.set(1, 1, L);
    arm.getObjectByName('glove').position.set(0, 0, 0.0);
  }

  sightOffset() {
    const g = this.e.gun; if (!g || !this.vm.gun) return new THREE.Vector3(0, 0.12, 0);
    const s = this.vm.gun.userData.sight;
    if (s) return new THREE.Vector3(0, s.position.y + (s.userData.eye || 0.04), s.position.z);
    return this.vm.gun.getObjectByName('sight').position.clone();
  }
  zoom() { const g = this.e.gun; if (!g) return 1; if (g.att.sight) return ATTACHMENTS[g.att.sight].zoom; return WEAPONS[g.id].cls === 'sr' ? 1.4 : 1.2; }

  // ------------------------------------------------------------- main update
  update(dt) {
    const e = this.e, I = this.input, m = this.m;
    const sens = (this.set.sens || 1) * 0.0022;
    const zoomScale = this.adsK > 0.5 ? 1 / Math.max(1, this.zoom() * 0.8) : 1;
    // Same mapping in every mode: mouse right = turn right, left = turn left, up = look up, down = look down.
    // (yaw grows to the left in this engine, so a positive mouse X lowers it.) Invert settings flip an axis.
    let dYaw = -I.mdx * sens * zoomScale * (this.set.invertX ? -1 : 1);
    let dPitch = -I.mdy * sens * zoomScale * (this.set.invertY ? -1 : 1);
    // arrow keys also turn the camera (works even when the mouse can't be captured)
    const kr = 2.4 * (this.set.sens || 1) * zoomScale * dt;
    dYaw += ((I.down('ArrowLeft') ? 1 : 0) - (I.down('ArrowRight') ? 1 : 0)) * kr;
    dPitch += ((I.down('ArrowUp') ? 1 : 0) - (I.down('ArrowDown') ? 1 : 0)) * kr * 0.7;
    if (!I.enabled || m.uiOpen) { dYaw = 0; dPitch = 0; }
    // free look (hold Alt)
    const free = I.down('AltLeft') && e.mode !== 'plane';
    if (free) { this.freeLook = clamp(this.freeLook + dYaw, -2.2, 2.2); this.freeLookPitch = clamp(this.freeLookPitch + dPitch, -1, 1); }
    else {
      this.freeLook = damp(this.freeLook, 0, 12, dt); this.freeLookPitch = damp(this.freeLookPitch, 0, 12, dt);
      if (e.mode !== 'dead') { e.yaw += dYaw; e.pitch = clamp(e.pitch + dPitch, -1.45, 1.45); }
    }
    if (I.hit('KeyV')) this.view = this.view === 'tpp' ? 'fpp' : 'tpp';

    if (e.mode !== 'ground' && e.mode !== 'swim') this.m.hud.prompt(e.mode === 'plane' ? 'Jump' : e.mode === 'freefall' ? 'Open parachute' : e.mode === 'drive' || e.mode === 'ride' ? 'Exit vehicle' : null);
    switch (e.mode) {
      case 'plane': this._plane(dt); break;
      case 'freefall': case 'chute': this._sky(dt); break;
      case 'drive': case 'ride': this._vehicle(dt); break;
      case 'dead': break;
      default: this._ground(dt);
    }
    this._camera(dt);
  }

  _plane(dt) {
    const e = this.e;
    e.pos.copy(this.m.plane.pos);
    if (this.input.hit('KeyF') || this.input.hit('Space') || this.input.hit('KeyE')) this.m.jumpFromPlane(e);
  }

  _sky(dt) {
    const e = this.e, I = this.input, phys = this.m.phys;
    const f = new THREE.Vector3(-Math.sin(e.yaw), 0, -Math.cos(e.yaw)), r = new THREE.Vector3(-f.z, 0, f.x);
    const fw = (I.down('KeyW') ? 1 : 0) - (I.down('KeyS') ? 1 : 0), st = (I.down('KeyD') ? 1 : 0) - (I.down('KeyA') ? 1 : 0);
    const ground = phys.support(e.pos.x, e.pos.z, 0.3, e.pos.y + 1);
    const agl = e.pos.y - ground;
    if (e.mode === 'freefall') {
      const dive = fw > 0 ? clamp(-e.pitch * 1.2 + 0.4, 0, 1) : 0;
      const hs = fw > 0 ? lerp(16, 9, dive) : fw < 0 ? 4 : 7;
      const vs = fw > 0 ? lerp(40, 62, dive) : fw < 0 ? 36 : 44;
      _v.copy(f).multiplyScalar(fw ? hs * Math.sign(fw) : 0).addScaledVector(r, st * 6);
      e.vel.x = damp(e.vel.x, _v.x, 2, dt); e.vel.z = damp(e.vel.z, _v.z, 2, dt); e.vel.y = damp(e.vel.y, -vs, 1.5, dt);
      if (agl < 125 || ((I.hit('KeyF') || I.hit('Space') || I.hit('KeyE')) && agl < 330)) { e.mode = 'chute'; audio.click('pickup'); this.m.onChute(e); }
      this.m.windLoop(Math.min(1, -e.vel.y / 60));
    } else {
      const hs = fw > 0 ? 13 : fw < 0 ? 3 : 7, vs = fw > 0 ? 6.5 : fw < 0 ? 3.8 : 5;
      _v.copy(f).multiplyScalar(hs).addScaledVector(r, st * 5);
      e.vel.x = damp(e.vel.x, _v.x, 1.5, dt); e.vel.z = damp(e.vel.z, _v.z, 1.5, dt); e.vel.y = damp(e.vel.y, -vs, 2, dt);
      this.m.windLoop(0.25);
    }
    e.pos.addScaledVector(e.vel, dt);
    e.pos.x = clamp(e.pos.x, -HALF + 7, HALF - 7); e.pos.z = clamp(e.pos.z, -HALF + 7, HALF - 7);
    e.speed = 0;
    const lvl = phys.waterLevel(e.pos.x, e.pos.z);
    if (e.pos.y <= ground + 0.05 || (lvl > ground && e.pos.y <= lvl)) {
      e.pos.y = Math.max(ground, lvl > ground ? lvl - 1.2 : ground);
      if (e.mode === 'freefall') this.m.damage(e, 200, null, 'fall');
      e.mode = lvl > ground + 1.2 ? 'swim' : 'ground'; e.vel.set(0, 0, 0);
      this.m.windLoop(0);
      this.m.onLand(e);
    }
  }

  _vehicle(dt) {
    const e = this.e, I = this.input, v = e.vehicle;
    if (!v) { e.mode = 'ground'; return; }
    if (e.seat === 0) {
      v.input = { throttle: (I.down('KeyW') ? 1 : 0) - (I.down('KeyS') ? 1 : 0), steer: (I.down('KeyA') ? 1 : 0) - (I.down('KeyD') ? 1 : 0), brake: I.down('Space') };
      if (I.hit('KeyH')) this.m.horn(v);
    }
    // switch seats with Ctrl+1..4
    for (let k = 0; k < 4; k++) if (I.hit('Digit' + (k + 1)) && (I.down('ControlLeft') || !e.gun)) this.m.changeSeat(e, k);
    if (I.hit('KeyF') || I.hit('KeyE')) this.m.exitVehicle(e);
  }

  _ground(dt) {
    const e = this.e, I = this.input, m = this.m, phys = m.phys;
    const W = e.W;
    const f = new THREE.Vector3(-Math.sin(e.yaw), 0, -Math.cos(e.yaw)), r = new THREE.Vector3(-f.z, 0, f.x);
    let fw = (I.down('KeyW') ? 1 : 0) - (I.down('KeyS') ? 1 : 0), st = (I.down('KeyD') ? 1 : 0) - (I.down('KeyA') ? 1 : 0);
    if (this.m.autoRun) fw = 1;
    const water = phys.waterLevel(e.pos.x, e.pos.z);
    const swimming = water > e.pos.y + 1.15;
    e.mode = swimming ? 'swim' : 'ground';
    if (e.knocked) { e.stance = 'prone'; }
    // stance
    if (!swimming && !e.knocked) {
      if (I.hit('KeyC')) e.stance = e.stance === 'crouch' ? 'stand' : 'crouch';
      if (I.hit('KeyZ')) e.stance = e.stance === 'prone' ? 'stand' : 'prone';
      if (e.stance !== 'stand' && !phys.fits(e.pos.x, e.pos.y, e.pos.z, 0.3, HEIGHT[e.stance === 'prone' ? 'crouch' : 'stand'])) { /* stay low under cover */ }
    }
    if (swimming) e.stance = 'stand';
    const healing = !!e.heal;
    const wantSprint = I.down('ShiftLeft') && fw > 0 && !e.aiming && !healing && e.stance !== 'prone' && !e.knocked && !swimming && this.sprintOK !== false;
    if (wantSprint && e.stance === 'crouch' && e.stamina > 10) e.stance = 'stand';
    const walk = I.down('ControlLeft');
    let speed = swimming ? 2.4 : e.knocked ? 0.9 : e.stance === 'prone' ? 1.15 : e.stance === 'crouch' ? (wantSprint ? 3.4 : 2.3) : walk ? 1.8 : wantSprint ? 6.3 : 4.7;
    if (e.aiming) speed *= e.stance === 'prone' ? 0.3 : 0.58;
    if (healing) speed = Math.min(speed, 1.6);
    if (fw < 0) speed *= 0.72; else if (!fw && st) speed *= 0.88;
    speed *= W ? 1.04 - W.weight * 0.04 : 1.05;
    if (e.boost > 60) speed *= 1.025;
    // uphill costs speed
    const n = phys.normal(e.pos.x, e.pos.z);
    const wish = new THREE.Vector3().addScaledVector(f, fw).addScaledVector(r, st);
    if (wish.lengthSq() > 0) wish.normalize();
    const grade = -(n[0] * wish.x + n[2] * wish.z);
    if (e.grounded && grade > 0) speed *= clamp(1 - grade * 1.4, 0.35, 1);
    if (this.m.map.mechanics.slippery && e.grounded && grade < -0.2) speed *= 1.15;
    // stamina
    const sprinting = wantSprint && wish.lengthSq() > 0 && e.stamina > 0;
    const drain = (this.m.map.mechanics.thinAir ? 1.7 : 1) * (this.m.map.mechanics.heat && this.m.inSun ? 1.35 : 1);
    if (sprinting) e.stamina = Math.max(0, e.stamina - 11 * drain * dt);
    else e.stamina = Math.min(100, e.stamina + (e.boost > 0 ? 22 : 16) * dt);
    if (e.stamina <= 0) this.sprintOK = false; else if (e.stamina > 30) this.sprintOK = true;
    if (!sprinting && wantSprint) speed = Math.min(speed, 4.7);
    // acceleration
    const acc = e.grounded || swimming ? 26 : 3;
    const tvx = wish.x * speed, tvz = wish.z * speed;
    e.vel.x = damp(e.vel.x, tvx, e.grounded ? (wish.lengthSq() ? 12 : 16) : 0.8, dt);
    e.vel.z = damp(e.vel.z, tvz, e.grounded ? (wish.lengthSq() ? 12 : 16) : 0.8, dt);
    // jump / vault
    if (I.hit('Space') && !e.knocked) {
      if (e.stance !== 'stand') e.stance = 'stand';
      else if (e.grounded && !swimming) {
        const v = this._tryVault(f);
        if (!v) { e.vel.y = 4.3; e.grounded = false; this.bloom += 4; }
      }
    }
    if (this.vault) {
      const V = this.vault; V.t += dt / V.dur;
      const k = Math.min(1, V.t);
      e.pos.lerpVectors(V.a, V.b, k); e.pos.y = lerp(V.a.y, V.b.y, Math.min(1, k * 1.6)) + Math.sin(k * Math.PI) * 0.25;
      if (V.t >= 1) this.vault = null;
      e.vel.set(0, 0, 0); e.grounded = true;
    } else if (swimming) {
      e.vel.y = damp(e.vel.y, (water - 1.3 - e.pos.y) * 3, 4, dt);
      e.pos.addScaledVector(e.vel, dt);
      const res = phys.moveCharacter(e.pos, new THREE.Vector3(0, 0, 0), dt, 0.3, 1.6, 0.6, true);
      e.grounded = false;
    } else {
      if (!e.grounded) e.vel.y -= 9.81 * dt;
      const res = phys.moveCharacter(e.pos, e.vel, dt, 0.3, HEIGHT[e.stance], e.stance === 'prone' ? 0.3 : 0.5, e.grounded);
      if (res.landed > 9.5) { const d = (res.landed - 9.5) * (res.landed - 9.5) * 1.1; this.m.damage(e, d, null, 'fall'); audio.click('hurt'); }
      if (res.landed > 3) audio.step(e.pos, this._surface(), 1.4, true);
      e.grounded = res.grounded;
    }
    e.speed = Math.hypot(e.vel.x, e.vel.z);
    const cy = Math.cos(e.yaw), sy = Math.sin(e.yaw);
    e.fwd = (-e.vel.x * sy - e.vel.z * cy) / Math.max(0.1, e.speed); e.side = (e.vel.x * cy - e.vel.z * sy) / Math.max(0.1, e.speed);
    // footsteps
    if (e.grounded && e.speed > 0.6) {
      this.stepAcc += e.speed * dt;
      const stride = sprinting ? 2.2 : 1.6;
      if (this.stepAcc > stride) { this.stepAcc = 0; audio.step(e.pos, swimming ? 'water' : this._surface(), walk || e.stance !== 'stand' ? 0.35 : sprinting ? 1.1 : 0.8, true); this.m.noise(e, sprinting ? 28 : walk ? 6 : 16); }
    }
    this.bob += e.speed * dt * (sprinting ? 1.15 : 1);
    this._weapons(dt, sprinting, swimming);
    this._interact();
  }

  _surface() {
    const e = this.e, phys = this.m.phys;
    const g = phys.height(e.pos.x, e.pos.z);
    if (e.pos.y - g > 0.15) return 'concrete';
    const lvl = phys.waterLevel(e.pos.x, e.pos.z);
    if (lvl > e.pos.y - 0.2) return 'water';
    return this.m.map.id === 'spiti' ? 'snow' : 'grass';
  }

  _tryVault(f) {
    const e = this.e, phys = this.m.phys;
    const hits = [];
    const probe = e.pos.clone().addScaledVector(f, 0.55);
    const ids = phys.query(probe.x - 0.2, probe.z - 0.2, probe.x + 0.2, probe.z + 0.2, hits);
    let top = -Infinity;
    for (const id of ids) { const b = id * 6; const t = phys.bx[b + 4]; if (t > e.pos.y + 0.5 && t < e.pos.y + 1.75 && phys.bx[b + 1] < e.pos.y + 0.6) top = Math.max(top, t); }
    if (top === -Infinity) return false;
    // land beyond the obstacle if there is room there, else on top
    for (const d of [1.3, 0.9]) {
      const land = e.pos.clone().addScaledVector(f, d);
      const g = phys.support(land.x, land.z, 0.25, top + 0.05);
      if (phys.fits(land.x, g, land.z, 0.28, 1.2) && g <= top + 0.05) {
        this.vault = { a: e.pos.clone(), b: new THREE.Vector3(land.x, g, land.z), t: 0, dur: 0.45 };
        audio.step(e.pos, 'concrete', 1.2, true);
        return true;
      }
    }
    return false;
  }

  // ------------------------------------------------------------- weapons
  _weapons(dt, sprinting, swimming) {
    const e = this.e, I = this.input, m = this.m;
    e.fireCd -= dt; e.switchT -= dt; e.boltT -= dt; this.meleeT -= dt;
    // slots
    const sw = (s) => { if (s === e.cur) return; if (s < 4 && !e.weapons[s]) return; e.cur = s; e.switchT = 0.55; e.reload = null; this.cancelHeal(); audio.click('pickup'); m.syncGear(e); };
    if (!I.down('ControlLeft')) {
      if (I.hit('Digit1')) sw(0); if (I.hit('Digit2')) sw(1); if (I.hit('Digit3')) sw(2); if (I.hit('Digit4')) sw(3);
      if (I.hit('Digit5') || I.hit('KeyG')) { const t = e.items.find((q) => q.type === 'throw' && (!e.throwId || q.id !== e.throwId || e.cur !== 4)) || e.items.find((q) => q.type === 'throw'); if (t) { e.throwId = t.id; e.cur = 4; e.switchT = 0.4; m.syncGear(e); } }
    }
    if (I.wheel && !this.adsK) { const order = [0, 1, 2, 3].filter((s) => e.weapons[s]); if (order.length) { const i = order.indexOf(e.cur); sw(order[(i + (I.wheel > 0 ? 1 : -1) + order.length) % order.length]); } }
    if (I.hit('KeyX')) { e.cur = e.cur === -1 ? (this._last ?? 0) : (this._last = e.cur, -1); if (e.cur >= 0 && !e.weapons[e.cur]) e.cur = -1; e.reload = null; m.syncGear(e); }
    // meds
    if (I.hit('Digit7')) this.useItem({ type: 'med', id: 'bandage' });
    if (I.hit('Digit8')) this.useItem({ type: 'med', id: 'fak' });
    if (I.hit('Digit9')) this.useItem({ type: 'med', id: 'medkit' });
    if (I.hit('Digit0')) { const b = e.bestBoost(); if (b) this.useItem(b); }
    this._heal(dt, sprinting);
    const g = e.gun, W = e.W;
    // ADS
    const canAds = g && !sprinting && !swimming && e.switchT <= 0 && W.cls !== 'melee' && !e.knocked;
    e.aiming = canAds && (this.set.adsToggle ? (I.rmbDown ? (this._adsT = !this._adsT) : this._adsT) : I.rmb) && !m.uiOpen;
    if (!canAds) this._adsT = false;
    const adsT = W && W.adsT ? W.adsT : 0.2;
    this.adsK = clamp(this.adsK + (e.aiming ? dt / adsT : -dt / (adsT * 0.8)), 0, 1);
    // fire mode
    if (I.hit('KeyB') && g && W.modes.length > 1) { g.mode = (g.mode + 1) % W.modes.length; m.toast(W.modes[g.mode].toUpperCase(), 'mode'); audio.click('ui'); }
    // reload
    if (I.hit('KeyR')) this.startReload();
    if (e.reload) {
      e.reload.t += dt;
      if (W && W.perRound) {
        if (e.reload.t >= e.reload.dur) {
          const got = e.takeItems('ammo', W.ammo, 1);
          if (got) { g.mag++; audio.click('magin'); }
          if (!got || g.mag >= e.magSize(g)) { e.reload = null; audio.click('bolt'); } else e.reload.t = 0;
        }
      } else if (e.reload.t >= e.reload.dur) {
        const need = e.magSize(g) - g.mag;
        g.mag += e.takeItems('ammo', W.ammo, need);
        e.reload = null; audio.click('magin');
      }
    }
    // firing
    if (m.uiOpen || e.switchT > 0 || swimming || e.knocked) { e.firing = false; return; }
    if (e.cur === 4) return this._throwable(dt);
    if (!g) { if (I.lmbDown) this._punch(); return; }
    if (W.cls === 'melee') { if (I.lmbDown && this.meleeT <= 0) this._melee(); return; }
    const mode = W.modes[g.mode] || W.modes[0];
    // a quick click must still fire one shot even if the button is released before this frame
    const trigger = mode === 'auto' ? I.lmb || I.lmbDown : I.lmbDown;
    e.firing = I.lmb || I.lmbDown;
    if (trigger && e.fireCd <= 0 && e.boltT <= 0) {
      if (e.reload && W.perRound && g.mag > 0) e.reload = null;
      if (e.reload) return;
      if (g.mag <= 0) { audio.click('empty'); if (e.ammo(W.ammo)) this.startReload(); e.fireCd = 0.25; return; }
      this._shoot(g, W, sprinting);
    }
    this.bloom = Math.max(0, this.bloom - dt * (this.adsK > 0.5 ? 12 : 7));
    this.shotT += dt;
  }

  cancelHeal() { if (this.e.heal) { this.e.heal = null; this.m.hud.progress(null); } }
  useItem(it) {
    const e = this.e;
    if (e.heal || !e.count(it.type, it.id)) return;
    if (it.type === 'med') {
      const M = MEDS[it.id];
      if (e.hp >= M.cap) { this.m.toast(`Health above ${M.cap}: can't use ${M.name}`); return; }
      e.heal = { it, t: 0, dur: M.t, name: M.name };
    } else if (it.type === 'boost') { e.heal = { it, t: 0, dur: BOOSTS[it.id].t, name: BOOSTS[it.id].name }; }
    else if (it.type === 'food') { const F = this.m.foodDef(it.id); e.heal = { it, t: 0, dur: F.time || 3, name: F.name }; }
    e.reload = null; audio.click('heal');
  }
  _heal(dt, sprinting) {
    const e = this.e;
    if (!e.heal) return;
    if (sprinting || e.firing || e.mode !== 'ground') { this.cancelHeal(); return; }
    e.heal.t += dt;
    this.m.hud.progress(e.heal.name, e.heal.t / e.heal.dur);
    if (e.heal.t >= e.heal.dur) {
      const it = e.heal.it;
      e.takeItems(it.type, it.id, 1);
      this.m.consume(e, it);
      e.heal = null; this.m.hud.progress(null);
    }
  }

  startReload() {
    const e = this.e, g = e.gun, W = e.W;
    if (!g || !W.ammo || e.reload || g.mag >= e.magSize(g) || !e.ammo(W.ammo)) return;
    e.reload = { t: 0, dur: W.perRound ? W.rl : g.mag > 0 ? W.rl : W.rle || W.rl };
    this.cancelHeal();
    audio.click('magout');
    this.m.net.pubEvent({ t: 'rl', id: e.id });
  }

  spreadDeg() {
    const e = this.e, W = e.W; if (!W) return 0;
    let s = lerp(W.hip, W.ads, this.adsK);
    if (e.speed > 0.5) s += (e.speed / 6) * (this.adsK > 0.5 ? 0.6 : 2.2);
    if (!e.grounded) s += 5;
    if (e.stance === 'crouch') s *= 0.8; else if (e.stance === 'prone') s *= 0.6;
    return s + this.bloom * (this.adsK > 0.5 ? 0.12 : 0.35);
  }

  aimRay() {
    // camera centre ray -> aim point; bullets come from the eye/muzzle toward it
    const cam = this.cam;
    const o = cam.getWorldPosition(new THREE.Vector3()), d = cam.getWorldDirection(new THREE.Vector3());
    const hit = this.m.phys.raycast(o.x, o.y, o.z, d.x, d.y, d.z, 900);
    const pt = hit ? new THREE.Vector3(hit.x, hit.y, hit.z) : o.clone().addScaledVector(d, 900);
    return { o, d, pt };
  }

  _shoot(g, W, sprinting) {
    const e = this.e, m = this.m;
    g.mag--;
    e.fireCd = 60 / W.rpm;
    if (W.modes[0] === 'bolt') { e.boltT = 60 / W.rpm; setTimeout(() => audio.click('bolt'), 350); }
    const { o, pt } = this.aimRay();
    const eye = new THREE.Vector3(e.pos.x, e.pos.y + this.eyeH, e.pos.z);
    const origin = this.adsK > 0.5 || this.view === 'fpp' ? o : eye.addScaledVector(new THREE.Vector3(Math.cos(e.yaw), 0, -Math.sin(e.yaw)), 0.25);
    const dir = pt.clone().sub(origin).normalize();
    const sp = this.spreadDeg() * DEG;
    if (sp > 0) {
      const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * Math.tan(sp / 2);
      const up = Math.abs(dir.y) < 0.99 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
      const ax = new THREE.Vector3().crossVectors(dir, up).normalize(), ay = new THREE.Vector3().crossVectors(ax, dir);
      dir.addScaledVector(ax, Math.cos(a) * rr).addScaledVector(ay, Math.sin(a) * rr).normalize();
    }
    // recoil
    let k = 1;
    if (g.att.grip) k *= 0.8; if (g.att.muzzle === 'compensator') k *= 0.82;
    if (e.stance === 'crouch') k *= 0.85; else if (e.stance === 'prone') k *= 0.6;
    if (this.adsK > 0.5) k *= 0.85;
    const kickP = W.rv * k * (0.85 + Math.random() * 0.3) * DEG;
    const kickY = (Math.random() - 0.45) * W.rh * 2 * k * DEG;
    e.pitch = clamp(e.pitch + kickP, -1.45, 1.45); e.yaw += kickY;
    this.recoil.vp += kickP * 0.6;
    this.bloom += W.cls === 'sr' ? 6 : 1.4;
    this.vmKick = 1; this.shotT = 0;
    if (e.avatar) e.avatar.kick = 1;
    const muzzle = this.adsK > 0.2 || this.view === 'fpp' ? (this.vm.gun ? this._vmMuzzleWorld() : origin) : e.avatar.muzzle(new THREE.Vector3());
    m.fire(e, origin, dir, g.id, { sim: true, local: true, muzzle, suppressed: g.att.muzzle === 'suppressor' });
    m.noise(e, g.att.muzzle === 'suppressor' ? 30 : 250);
  }
  _vmMuzzleWorld() {
    // project viewmodel muzzle into the world camera frame
    const mz = this.vm.gun.getObjectByName('muzzle').getWorldPosition(new THREE.Vector3());
    const local = this.vm.cam.worldToLocal(mz);
    return this.cam.localToWorld(local);
  }

  _throwable(dt) {
    const e = this.e, I = this.input;
    if (!e.throwId || !e.count('throw', e.throwId)) { e.cur = e.weapons[0] ? 0 : -1; this.m.syncGear(e); return; }
    if (I.lmb || I.lmbDown) this.throwHold = Math.min(1, Math.max(this.throwHold, 0.05) + dt * 1.5);
    else if (this.throwHold > 0) {
      const { o, d } = this.aimRay();
      const pow = 10 + this.throwHold * 12;
      const v = d.clone().multiplyScalar(pow); v.y += 3.5;
      const from = new THREE.Vector3(e.pos.x, e.pos.y + this.eyeH, e.pos.z).addScaledVector(d, 0.6);
      e.takeItems('throw', e.throwId, 1);
      this.m.throwNade(e, from, v, e.throwId);
      this.throwHold = 0;
      if (!e.count('throw', e.throwId)) { e.cur = e.weapons[0] ? 0 : -1; this.m.syncGear(e); }
    }
  }

  _melee() {
    this.meleeT = 0.75; this.vmKick = 1.5;
    if (this.e.avatar) this.e.avatar.kick = 2;
    this.m.melee(this.e, 80, 2.3);
    audio.gun(this.e.pos, 'pan', false, true);
  }
  _punch() { if (this.meleeT > 0) return; this.meleeT = 0.5; this.vmKick = 1; this.m.melee(this.e, 12, 1.6); }

  _interact() {
    const e = this.e, I = this.input, m = this.m;
    const opt = m.interaction(e);
    m.hud.prompt(opt ? opt.label : null);
    if (opt && (I.hit('KeyF') || I.hit('KeyE'))) opt.act();
  }

  // ------------------------------------------------------------- camera
  _camera(dt) {
    const e = this.e, cam = this.cam, m = this.m;
    if (m.debugCam) { cam.position.copy(m.debugCam.pos); cam.lookAt(m.debugCam.look); cam.fov = m.debugCam.fov || 60; cam.updateProjectionMatrix(); this.vm.show = false; return; }
    this.eyeH = damp(this.eyeH, e.knocked ? 0.45 : e.mode === 'swim' ? 1.35 : EYE[e.stance] || 1.62, 10, dt);
    const yaw = e.yaw + this.freeLook;
    // under the canopy keep the camera below the parachute so it never fills the screen
    const pitch = clamp(e.pitch + this.freeLookPitch, e.mode === 'chute' ? -0.3 : -1.45, 1.45);
    let fov = this.set.fov || 80;
    const plane = e.mode === 'plane', sky = e.mode === 'freefall' || e.mode === 'chute', car = e.mode === 'drive' || e.mode === 'ride';
    const dead = e.mode === 'dead';
    let pivot;
    if (plane) pivot = m.plane.pos.clone();
    else if (car) pivot = e.vehicle.pos.clone().add(new THREE.Vector3(0, 1.8, 0));
    else if (dead && m.spectate) pivot = m.spectate.pos.clone().add(new THREE.Vector3(0, 1.6, 0));
    else pivot = new THREE.Vector3(e.pos.x, e.pos.y + this.eyeH, e.pos.z);
    const fpp = !plane && !sky && !car && !dead && (this.view === 'fpp' || this.adsK > 0.35);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q), right = new THREE.Vector3(1, 0, 0).applyQuaternion(q), up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    if (fpp) {
      cam.position.copy(pivot).addScaledVector(new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)), 0.12);
      if (this.adsK < 0.5 && e.speed > 0.5) cam.position.y += Math.sin(this.bob * 3.8) * 0.025;
      fov = lerp(fov, fov / this.zoom(), this.adsK);
    } else {
      const dist = plane ? 34 : sky ? 7 : car ? (e.vehicle.kind === 'bus' ? 13 : 6.5) : dead ? 4 : e.stance === 'prone' ? 2.1 : e.stance === 'crouch' ? 2.35 : e.speed > 5.5 ? 3.0 : 2.7;
      this.camDist = damp(this.camDist, dist, 6, dt);
      const side = plane || sky || car || dead ? 0 : 0.58;
      const desired = pivot.clone().addScaledVector(fwd, -this.camDist).addScaledVector(right, side).addScaledVector(up, plane ? 6 : 0.22);
      // pull in against walls
      const o = pivot.clone().addScaledVector(right, side * 0.5);
      const d = desired.clone().sub(o), L = d.length(); d.divideScalar(L);
      const hit = m.phys.raycast(o.x, o.y, o.z, d.x, d.y, d.z, L, { noDynamic: !car });
      cam.position.copy(hit ? o.clone().addScaledVector(d, Math.max(0.3, hit.t - 0.25)) : desired);
      const gy = m.phys.height(cam.position.x, cam.position.z) + 0.3;
      if (cam.position.y < gy) cam.position.y = gy;
    }
    cam.quaternion.copy(q);
    // shake
    const sh = (m.combat ? m.combat.shake : 0) + (this.vmKick > 0 ? this.vmKick * 0.15 : 0) * (this.adsK > 0.5 ? 0.3 : 1);
    if (sh > 0) { cam.rotation.x += (Math.random() - 0.5) * 0.02 * sh; cam.rotation.y += (Math.random() - 0.5) * 0.02 * sh; }
    if (m.burn > 0) { cam.rotation.z += Math.sin(performance.now() * 0.02) * 0.02 * m.burn; }
    cam.fov = damp(cam.fov, fov, 18, dt);
    cam.updateProjectionMatrix();
    // avatar visibility (hidden in first person)
    if (e.avatar) e.avatar.model.visible = !fpp;
    if (e.avatar) e.avatar.gunPivot.visible = e.avatar.gunPivot.visible && !fpp;
    this.fpp = fpp;
    this._updateViewmodel(dt, fpp);
    audio.listener(cam.position, fwd, up);
  }

  _updateViewmodel(dt, fpp) {
    const vm = this.vm, e = this.e;
    this._vmSetGun();
    const scoped = this.adsK > 0.85 && this.zoom() >= 2;
    vm.show = fpp && !scoped && !!vm.gun && e.mode === 'ground';
    this.scoped = scoped && fpp;
    if (!vm.show) return;
    vm.cam.aspect = this.cam.aspect; vm.cam.updateProjectionMatrix();
    this.vmKick = Math.max(0, this.vmKick - dt * 10);
    const W = e.W;
    const I = this.input;
    this.sway.x = damp(this.sway.x, clamp(-I.mdx * 0.0006, -0.04, 0.04), 8, dt);
    this.sway.y = damp(this.sway.y, clamp(I.mdy * 0.0006, -0.04, 0.04), 8, dt);
    const sight = this.sightOffset();
    const hip = new THREE.Vector3(0.14, -0.15, -0.34);
    const ads = new THREE.Vector3(-sight.x, -sight.y, -0.3 - sight.z);
    const pistol = W && W.cls === 'pistol';
    if (pistol) hip.set(0.12, -0.13, -0.38);
    if (e.cur === 4) hip.set(0.16, -0.18, -0.3);
    const p = hip.lerp(ads, this.adsK);
    const bobA = (1 - this.adsK * 0.85) * Math.min(1, e.speed / 4);
    p.x += Math.sin(this.bob * 1.9) * 0.012 * bobA + this.sway.x;
    p.y += Math.abs(Math.cos(this.bob * 1.9)) * 0.014 * bobA - this.sway.y;
    p.z += this.vmKick * 0.045;
    let rx = this.vmKick * 0.06, rz = 0;
    if (e.speed > 5.5 && this.adsK < 0.1) { rz = 0.5; rx -= 0.35; p.x -= 0.04; p.y -= 0.04; }
    if (e.reload) { const k = Math.sin(Math.min(1, e.reload.t / e.reload.dur) * Math.PI); rx -= k * 0.5; rz += k * 0.5; p.y -= k * 0.08; const mag = vm.gun.getObjectByName('mag'); if (mag) mag.visible = e.reload.t / e.reload.dur < 0.3 || e.reload.t / e.reload.dur > 0.6; }
    else { const mag = vm.gun.getObjectByName('mag'); if (mag) mag.visible = true; }
    if (e.switchT > 0) p.y -= e.switchT * 0.5;
    if (W && W.cls === 'melee' && this.meleeT > 0.3) { rx -= (this.meleeT - 0.3) * 3; }
    vm.gun.position.copy(p);
    vm.gun.rotation.set(rx, 0, rz);
    vm.gun.updateMatrixWorld(true);
    // arms from the camera's lower corners to the grip points
    const grip = vm.gun.getObjectByName('grip').getWorldPosition(new THREE.Vector3());
    const fore = vm.gun.getObjectByName(pistol || !W || W.cls === 'melee' ? 'grip' : 'fore').getWorldPosition(new THREE.Vector3());
    const toCam = (v) => vm.cam.localToWorld(v);
    this._placeArm(vm.ra, toCam(new THREE.Vector3(0.32, -0.5, 0.25)), grip);
    this._placeArm(vm.la, toCam(new THREE.Vector3(-0.3, -0.55, 0.05)), fore.add(new THREE.Vector3(pistol ? -0.03 : 0, 0, 0)));
    vm.la.visible = !(W && W.cls === 'melee') && e.cur !== 4;
  }
}

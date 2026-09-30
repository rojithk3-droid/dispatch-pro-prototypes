// Bot brains (simulated by the match host). Perception: range + field of view + line of sight + smoke +
// heard noises. Combat: skill-based aim error, reaction time, burst fire, strafing, crouching, reloading,
// healing. Movement: whisker steering, vault/jump when blocked, stuck recovery, zone rotation.
import * as THREE from 'three';
import { WEAPONS, MEDS } from './weapons.js';
import { clamp, angDiff, damp } from './util.js';

const RANGE = { ar: 260, smg: 110, dmr: 380, sr: 520, sg: 35, pistol: 55, melee: 2 };

export class BotBrain {
  constructor(match, ent, skill, rng) {
    this.m = match; this.e = ent; this.skill = skill; this.rng = rng;
    this.state = 'plane';
    this.jumpAt = null; this.landAt = null;
    this.target = null; this.enemy = null; this.seenT = 0; this.react = 0;
    this.goal = null; this.goalT = 0; this.stuckT = 0; this.lastPos = new THREE.Vector3();
    this.percT = rng() * 0.3; this.burst = 0; this.burstPause = 0; this.strafe = 1; this.strafeT = 0;
    this.lootT = 8 + rng() * 14; this.ignore = new Set(); this.detour = null;
    this.noiseHeard = null; this.lastSeenPos = null; this.healCd = 0;
  }

  planJump(plane, rng) {
    // choose a landing spot: a random loot-rich place, biased toward the flight path
    const spots = this.m.world.loot;
    let best = null;
    for (let k = 0; k < 12; k++) {
      const s = spots[Math.floor(rng() * spots.length)];
      const d = plane.distToPath(s.x, s.z);
      const score = d + rng() * 250 - (s.tier || 0) * 60;
      if (!best || score < best.score) best = { s, score };
    }
    this.landAt = new THREE.Vector3(best.s.x + (rng() - 0.5) * 20, 0, best.s.z + (rng() - 0.5) * 20);
    this.jumpAt = plane.nearestT(this.landAt.x, this.landAt.z) - 0.04 - rng() * 0.05;
  }

  update(dt) {
    const e = this.e, m = this.m;
    if (!e.alive) return;
    switch (e.mode) {
      case 'plane':
        e.pos.copy(m.plane.pos);
        if (m.plane.t >= this.jumpAt || m.plane.t > 0.97) m.jumpFromPlane(e);
        return;
      case 'freefall': case 'chute': return this._sky(dt);
      default: return this._ground(dt);
    }
  }

  _sky(dt) {
    const e = this.e, phys = this.m.phys;
    const to = new THREE.Vector3(this.landAt.x - e.pos.x, 0, this.landAt.z - e.pos.z);
    const d = to.length();
    e.yaw = Math.atan2(-to.x, -to.z);
    const g = phys.height(e.pos.x, e.pos.z);
    if (e.mode === 'freefall') {
      const hs = Math.min(15, d / 3);
      e.vel.x = damp(e.vel.x, (to.x / (d || 1)) * hs, 2, dt); e.vel.z = damp(e.vel.z, (to.z / (d || 1)) * hs, 2, dt); e.vel.y = damp(e.vel.y, d > 200 ? -40 : -58, 1.5, dt);
      if (e.pos.y - g < 130) { e.mode = 'chute'; this.m.onChute(e); }
    } else {
      const hs = Math.min(12, d / 2);
      e.vel.x = damp(e.vel.x, (to.x / (d || 1)) * hs, 1.5, dt); e.vel.z = damp(e.vel.z, (to.z / (d || 1)) * hs, 1.5, dt); e.vel.y = damp(e.vel.y, -5.5, 2, dt);
    }
    e.pos.addScaledVector(e.vel, dt);
    const sup = phys.support(e.pos.x, e.pos.z, 0.3, e.pos.y + 1);
    const lvl = phys.waterLevel(e.pos.x, e.pos.z);
    if (e.pos.y <= Math.max(sup, lvl - 1.2)) { e.pos.y = Math.max(sup, lvl - 1.2); e.mode = 'ground'; e.vel.set(0, 0, 0); this.m.onLand(e); this.state = 'loot'; }
  }

  _ground(dt) {
    const e = this.e, m = this.m, phys = m.phys;
    this.percT -= dt; this.healCd -= dt; this.goalT -= dt;
    if (e.knocked) { this._move(dt, this._fleeDir(), 0.9); return; }
    // perception
    if (this.percT <= 0) { this.percT = 0.22 + this.rng() * 0.1; this._perceive(); }
    // looting simulation: bots are assumed to be sweeping rooms, gear improves over time
    if (!this.enemy) { this.lootT -= dt; if (this.lootT <= 0) { this.lootT = 25 + this.rng() * 40; m.botLootTick(e, this.rng); } }
    // heal
    if (!this.enemy && e.hp < 70 && this.healCd <= 0 && !e.heal) {
      const med = e.count('med', 'medkit') ? 'medkit' : e.count('med', 'fak') ? 'fak' : e.count('med', 'bandage') ? 'bandage' : null;
      if (med && e.hp < MEDS[med].cap) { e.heal = { it: { type: 'med', id: med }, t: 0, dur: MEDS[med].t }; this.healCd = 3; }
    }
    if (e.heal) {
      e.heal.t += dt;
      if (this.enemy) e.heal = null;
      else if (e.heal.t >= e.heal.dur) { e.takeItems('med', e.heal.it.id, 1); m.consume(e, e.heal.it); e.heal = null; }
    }
    // reload
    const g = e.gun, W = e.W;
    if (g && W.ammo && g.mag === 0 && !e.reload) { if (e.ammo(W.ammo) || true) e.reload = { t: 0, dur: W.rle || W.rl * 2 }; }
    if (e.reload) { e.reload.t += dt; if (e.reload.t >= e.reload.dur) { const need = e.magSize(g) - g.mag; const got = e.takeItems('ammo', W.ammo, need); g.mag += got || Math.min(need, 10); e.reload = null; } }
    e.fireCd -= dt;

    let dir = null, speed = 4.7;
    const zone = m.zoneState;
    const zc = zone ? new THREE.Vector3(zone.next.x, 0, zone.next.z) : null;
    const outside = zone && Math.hypot(e.pos.x - zone.x, e.pos.z - zone.z) > zone.r - 8;
    const outsideNext = zone && Math.hypot(e.pos.x - zone.next.x, e.pos.z - zone.next.z) > zone.next.r * 0.85;

    if (this.enemy && this.enemy.alive && !outside) {
      // --- combat
      const t = this.enemy;
      const tp = t.pos.clone(); tp.y += t.stance === 'prone' || t.knocked ? 0.3 : t.stance === 'crouch' ? 0.9 : 1.3;
      const eye = new THREE.Vector3(e.pos.x, e.pos.y + (e.stance === 'crouch' ? 1.1 : 1.55), e.pos.z);
      const to = tp.clone().sub(eye);
      const dist = to.length();
      const wantYaw = Math.atan2(-to.x, -to.z), wantPitch = Math.atan2(to.y, Math.hypot(to.x, to.z));
      e.yaw += angDiff(e.yaw, wantYaw) * Math.min(1, dt * (4 + this.skill * 6));
      e.pitch += (wantPitch - e.pitch) * Math.min(1, dt * 6);
      e.aiming = true;
      this.react -= dt;
      const aligned = Math.abs(angDiff(e.yaw, wantYaw)) < 0.12;
      if (g && W.cls !== 'melee' && aligned && this.react <= 0 && !e.reload && g.mag > 0 && e.fireCd <= 0 && dist < RANGE[W.cls] * 1.2) {
        if (this.burstPause > 0) this.burstPause -= dt;
        else {
          const err = (3.2 - this.skill * 2.5) * (1 + dist / 180) * (t.speed > 3 ? 1.4 : 1) * (Math.PI / 180);
          const d = to.clone().normalize();
          d.x += (this.rng() - 0.5) * err * 2; d.y += (this.rng() - 0.5) * err * 1.4; d.z += (this.rng() - 0.5) * err * 2;
          d.normalize();
          g.mag--;
          e.fireCd = 60 / W.rpm * (W.modes[0] === 'single' ? 1.6 + (1 - this.skill) : 1);
          m.fire(e, eye, d, g.id, { sim: true, muzzle: e.avatar ? e.avatar.muzzle(new THREE.Vector3()) : eye, suppressed: g.att.muzzle === 'suppressor' });
          this.burst++;
          if (this.burst > 3 + this.rng() * 5) { this.burst = 0; this.burstPause = 0.25 + this.rng() * 0.6; }
        }
      }
      if (!g || W.cls === 'melee') {
        // no gun: rush (with a tawa) or run away
        if (g && W.cls === 'melee' && dist < 25) { dir = to.clone().setY(0).normalize(); speed = 6; if (dist < 2) m.melee(e, 80, 2.2); }
        else dir = this._fleeDir();
      } else {
        // strafe
        this.strafeT -= dt;
        if (this.strafeT <= 0) { this.strafeT = 0.6 + this.rng() * 1.4; this.strafe = this.rng() < 0.5 ? -1 : 1; e.stance = dist > 90 && this.rng() < 0.5 ? 'crouch' : 'stand'; }
        const side = new THREE.Vector3(Math.cos(e.yaw), 0, -Math.sin(e.yaw)).multiplyScalar(this.strafe);
        dir = side; speed = e.stance === 'crouch' ? 1.8 : 2.8;
        if (W.cls === 'sg' || W.cls === 'smg') { if (dist > RANGE[W.cls] * 0.6) { dir = to.clone().setY(0).normalize().add(side.multiplyScalar(0.5)).normalize(); speed = 4.7; } }
      }
      if (!t.alive || (m.time - this.seenT > 5)) this.enemy = null;
    } else {
      e.aiming = false;
      if (this.enemy && !this.enemy.alive) this.enemy = null;
      e.stance = 'stand';
      // --- navigation goals
      if (outside || (outsideNext && zone.timeLeft < 50)) { this.goal = zc.clone().add(new THREE.Vector3((this.rng() - 0.5) * zone.next.r, 0, (this.rng() - 0.5) * zone.next.r)); this.goalT = 8; }
      else if (this.noiseHeard && this.rng() < 0.02) { this.goal = this.noiseHeard.clone(); this.goalT = 10; this.noiseHeard = null; }
      if (!this.goal || this.goalT <= 0 || e.pos.distanceTo(this.goal) < 2.5) {
        const lt = this._lootTarget();
        if (lt) { this.goal = new THREE.Vector3(lt.x, lt.y, lt.z); this.goalLoot = lt; this.goalT = 14; }
        else { const a = this.rng() * 6.283; this.goal = e.pos.clone().add(new THREE.Vector3(Math.cos(a) * 40, 0, Math.sin(a) * 40)); if (zc && this.rng() < 0.5) this.goal.lerp(zc, 0.5); this.goalLoot = null; this.goalT = 10; }
      }
      if (this.goalLoot && e.pos.distanceTo(this.goal) < 1.8) { m.botPickup(e, this.goalLoot); this.ignore.add(this.goalLoot.lid); this.goal = null; this.goalLoot = null; }
      if (this.goal) { dir = this.goal.clone().sub(e.pos).setY(0); const L = dir.length(); if (L > 0.01) dir.divideScalar(L); speed = outside ? 6.2 : 4.7; e.yaw += angDiff(e.yaw, Math.atan2(-dir.x, -dir.z)) * Math.min(1, dt * 5); }
      e.pitch = damp(e.pitch, 0, 3, dt);
    }
    this._move(dt, dir, speed);
  }

  _fleeDir() {
    const e = this.e;
    const z = this.m.zoneState;
    const to = z ? new THREE.Vector3(z.next.x - e.pos.x, 0, z.next.z - e.pos.z) : new THREE.Vector3(-e.pos.x, 0, -e.pos.z);
    if (this.enemy) to.sub(this.enemy.pos.clone().sub(e.pos).setY(0).normalize().multiplyScalar(30));
    return to.normalize();
  }

  _lootTarget() {
    const e = this.e;
    let best = null, bd = 45 * 45;
    for (const l of this.m.loot.entries.values()) {
      if (this.ignore.has(l.lid)) continue;
      const dx = l.x - e.pos.x, dz = l.z - e.pos.z, d = dx * dx + dz * dz;
      if (d < bd && Math.abs(l.y - e.pos.y) < 4) { bd = d; best = l; }
    }
    return best;
  }

  _perceive() {
    const e = this.e, m = this.m;
    const W = e.W;
    const range = W ? RANGE[W.cls] * 1.3 : 80;
    const eye = new THREE.Vector3(e.pos.x, e.pos.y + 1.55, e.pos.z);
    let best = null, bd = Infinity;
    for (const t of m.entities.values()) {
      if (!t.alive || t === e || t.team === e.team || t.mode === 'plane') continue;
      if (t.mode === 'freefall') continue;
      const d = t.pos.distanceTo(e.pos);
      if (d > range || d > bd) continue;
      // field of view: 150°, or already engaged
      const to = t.pos.clone().sub(e.pos);
      const a = Math.abs(angDiff(e.yaw, Math.atan2(-to.x, -to.z)));
      if (a > 1.3 && t !== this.enemy && d > 12) continue;
      const tp = t.pos.clone(); tp.y += t.stance === 'prone' ? 0.3 : t.stance === 'crouch' ? 0.9 : 1.4;
      if (!m.phys.los(eye.x, eye.y, eye.z, tp.x, tp.y, tp.z)) continue;
      if (m.combat.smokeBlocks(eye, tp)) continue;
      // spotting chance falls with distance, prone/crouch and fog
      const vis = (t.stance === 'prone' ? 0.35 : t.stance === 'crouch' ? 0.7 : 1) * (1 - d / (range * (m.map.mechanics.smog ? 0.55 : 1) + 1));
      if (t !== this.enemy && this.rng() > vis + 0.25) continue;
      best = t; bd = d;
    }
    if (best) {
      if (best !== this.enemy) this.react = 0.9 - this.skill * 0.6 + this.rng() * 0.3;
      this.enemy = best; this.seenT = m.time; this.lastSeenPos = best.pos.clone();
    }
  }

  hear(pos, loud) {
    if (this.e.pos.distanceTo(pos) < loud) this.noiseHeard = pos.clone();
  }
  hurtBy(att) {
    if (!att || att.team === this.e.team) return;
    if (!this.enemy || this.rng() < 0.6) { this.enemy = att; this.seenT = this.m.time; this.react = Math.min(this.react, 0.4); }
    this.e.yaw += angDiff(this.e.yaw, Math.atan2(-(att.pos.x - this.e.pos.x), -(att.pos.z - this.e.pos.z))) * 0.5;
  }

  _move(dt, dir, speed) {
    const e = this.e, phys = this.m.phys;
    // steering whiskers
    if (dir && dir.lengthSq() > 0.01) {
      if (this.detour && this.detour.t > 0) { this.detour.t -= dt; dir = this.detour.d; }
      const probe = (d, L) => { const o = new THREE.Vector3(e.pos.x, e.pos.y + 0.9, e.pos.z); return phys.raycast(o.x, o.y, o.z, d.x, 0, d.z, L, { noTerrain: true }); };
      const f = probe(dir, 2.2);
      if (f) {
        const l = dir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.8), r = dir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -0.8);
        const hl = probe(l, 3), hr = probe(r, 3);
        dir = !hl ? l : !hr ? r : (hl.t > hr.t ? l : r);
      }
    }
    const tv = dir ? dir.clone().multiplyScalar(e.stance === 'crouch' ? Math.min(speed, 2.3) : speed) : new THREE.Vector3();
    e.vel.x = damp(e.vel.x, tv.x, 10, dt); e.vel.z = damp(e.vel.z, tv.z, 10, dt);
    if (!e.grounded) e.vel.y -= 9.81 * dt;
    const water = phys.waterLevel(e.pos.x, e.pos.z);
    if (water > e.pos.y + 1.15) { e.mode = 'swim'; e.vel.y = (water - 1.3 - e.pos.y) * 3; e.vel.x *= 0.5; e.vel.z *= 0.5; } else if (e.mode === 'swim') e.mode = 'ground';
    const res = phys.moveCharacter(e.pos, e.vel, dt, 0.3, e.stance === 'crouch' ? 1.25 : 1.78, 0.5, e.grounded);
    e.grounded = res.grounded;
    if (res.landed > 10) this.m.damage(e, (res.landed - 9.5) ** 2 * 1.1, null, 'fall');
    e.speed = Math.hypot(e.vel.x, e.vel.z);
    const cy = Math.cos(e.yaw), sy = Math.sin(e.yaw);
    e.fwd = (-e.vel.x * sy - e.vel.z * cy) / Math.max(0.1, e.speed); e.side = (e.vel.x * cy - e.vel.z * sy) / Math.max(0.1, e.speed);
    // stuck recovery
    if (dir && tv.lengthSq() > 1) {
      if (e.pos.distanceTo(this.lastPos) < 0.03 * speed) this.stuckT += dt; else this.stuckT = Math.max(0, this.stuckT - dt);
      if (this.stuckT > 1.2) {
        this.stuckT = 0;
        if (e.grounded) e.vel.y = 4.3;
        const a = this.rng() * 6.283;
        this.detour = { d: new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), t: 1.5 };
        if (this.goalLoot) { this.ignore.add(this.goalLoot.lid); this.goal = null; this.goalLoot = null; }
      }
    }
    this.lastPos.copy(e.pos);
  }
}

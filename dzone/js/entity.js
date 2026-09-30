// Entity (players and bots) + inventory rules shared by everyone.
import * as THREE from 'three';
import { WEAPONS, ATTACHMENTS, AMMO, MEDS, BOOSTS, THROWS, GEAR_CAP, BASE_CAP, itemWeight, HEAD_MULT, LIMB_MULT, ARMOR_RED } from './weapons.js';

export class Entity {
  constructor(o) {
    this.id = o.id; this.name = o.name; this.team = o.team ?? o.id; this.isBot = !!o.isBot; this.isLocal = !!o.isLocal;
    this.outfit = o.outfit || 'classic'; this.cosmetic = o.cosmetic || 'none';
    this.avatar = null;
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.stance = 'stand'; this.mode = 'plane'; this.grounded = false;
    this.hp = 100; this.boost = 0; this.alive = true; this.knocked = false; this.bleed = 100;
    this.kills = 0; this.dmgDealt = 0; this.place = 0;
    this.weapons = [null, null, null, null]; // primary, primary, pistol, melee
    this.cur = -1;                           // equipped slot index, -1 = fists, 4 = throwable
    this.throwId = null;
    this.helmet = null; this.vest = null; this.pack = null; // {level, dur}
    this.items = [];
    this.reload = null; this.heal = null; this.fireCd = 0; this.switchT = 0; this.boltT = 0;
    this.aiming = false; this.firing = false; this.speed = 0; this.fwd = 0; this.side = 0;
    this.stamina = 100; this.vehicle = null; this.seat = -1;
    this.lastHitBy = null; this.lastHitT = 0;
    this.net = { buf: [] };
  }

  get gun() { return this.cur >= 0 && this.cur < 4 ? this.weapons[this.cur] : null; }
  get W() { const g = this.gun; return g ? WEAPONS[g.id] : null; }

  capacity() { return BASE_CAP + (this.vest ? GEAR_CAP.vest[this.vest.level] : 0) + (this.pack ? GEAR_CAP.pack[this.pack.level] : 0); }
  used() { return this.items.reduce((s, it) => s + itemWeight(it), 0); }
  count(type, id) { return this.items.filter((i) => i.type === type && i.id === id).reduce((s, i) => s + (i.n || 1), 0); }
  ammo(id) { return this.count('ammo', id); }

  takeItems(type, id, n) {
    let left = n;
    for (let i = this.items.length - 1; i >= 0 && left > 0; i--) {
      const it = this.items[i];
      if (it.type !== type || it.id !== id) continue;
      const k = Math.min(left, it.n || 1);
      it.n = (it.n || 1) - k; left -= k;
      if (it.n <= 0) this.items.splice(i, 1);
    }
    return n - left;
  }

  // can the item be picked up? returns how many units fit (for stacks) or boolean
  fits(it) {
    const free = this.capacity() - this.used();
    if (['ammo', 'med', 'boost', 'food', 'throw'].includes(it.type)) {
      const per = itemWeight({ ...it, n: 1 });
      return Math.max(0, Math.min(it.n || 1, Math.floor(free / per + 1e-6)));
    }
    if (it.type === 'att') return free >= itemWeight(it) ? 1 : 0;
    return 1;
  }

  // add an item from the ground. returns {taken: bool, left: item|null, dropped: [items to put back on ground]}
  pickup(it) {
    const dropped = [];
    switch (it.type) {
      case 'gun': {
        const W = WEAPONS[it.id];
        let slot;
        if (W.cls === 'pistol') slot = 2; else if (W.cls === 'melee') slot = 3;
        else slot = !this.weapons[0] ? 0 : !this.weapons[1] ? 1 : (this.cur === 0 || this.cur === 1 ? this.cur : 0);
        const old = this.weapons[slot];
        if (old) dropped.push(...this.unequipGun(slot));
        this.weapons[slot] = { id: it.id, att: {}, mag: it.mag ?? 0, mode: 0 };
        // auto-move fitting attachments from the bag
        for (const a of [...this.items]) if (a.type === 'att' && this.canAttach(slot, a.id) && !this.weapons[slot].att[ATTACHMENTS[a.id].slot]) this.attach(slot, a.id);
        if (this.cur < 0 || this.cur === 3) this.cur = slot;
        return { taken: true, dropped };
      }
      case 'helmet': case 'vest': case 'pack': {
        const old = this[it.type];
        if (old && old.level >= it.level && (old.dur ?? 100) > 30) return { taken: false, dropped };
        if (old) dropped.push({ type: it.type, level: old.level, dur: old.dur });
        this[it.type] = { level: it.level, dur: it.dur ?? 100 };
        return { taken: true, dropped };
      }
      case 'att': {
        for (const slot of [this.cur, 0, 1, 2]) {
          if (slot < 0 || slot > 2 || !this.weapons[slot]) continue;
          const s = ATTACHMENTS[it.id].slot;
          if (this.canAttach(slot, it.id) && !this.weapons[slot].att[s]) { this.attach(slot, it.id, true); return { taken: true, dropped }; }
        }
        if (!this.fits(it)) return { taken: false, dropped };
        this.items.push({ ...it });
        return { taken: true, dropped };
      }
      default: {
        const n = this.fits(it);
        if (!n) return { taken: false, dropped };
        const ex = this.items.find((q) => q.type === it.type && q.id === it.id);
        if (ex) ex.n = (ex.n || 1) + n; else this.items.push({ ...it, n });
        const left = (it.n || 1) - n;
        return { taken: true, left: left > 0 ? { ...it, n: left } : null, dropped };
      }
    }
  }

  canAttach(slot, attId) { const g = this.weapons[slot]; return !!g && ATTACHMENTS[attId].fits.includes(WEAPONS[g.id].cls); }
  attach(slot, attId, fromGround = false) {
    const g = this.weapons[slot];
    const s = ATTACHMENTS[attId].slot;
    if (!fromGround) { const i = this.items.findIndex((q) => q.type === 'att' && q.id === attId); if (i < 0) return false; this.items.splice(i, 1); }
    if (g.att[s]) this.items.push({ type: 'att', id: g.att[s] });
    g.att[s] = attId;
    return true;
  }
  unequipGun(slot) {
    const g = this.weapons[slot];
    if (!g) return [];
    const out = [{ type: 'gun', id: g.id, mag: 0 }];
    // unloaded rounds go back into the bag
    const W = WEAPONS[g.id];
    if (W.ammo && g.mag > 0) { const ex = this.items.find((q) => q.type === 'ammo' && q.id === W.ammo); if (ex) ex.n += g.mag; else this.items.push({ type: 'ammo', id: W.ammo, n: g.mag }); }
    for (const s in g.att) { const a = { type: 'att', id: g.att[s] }; if (this.fits(a)) this.items.push(a); else out.push(a); }
    this.weapons[slot] = null;
    if (this.cur === slot) this.cur = -1;
    return out;
  }
  magSize(g) { const W = WEAPONS[g.id]; return g.att.mag ? W.ext : W.mag; }

  // ---- damage model
  // returns final damage after armour; mutates armour durability
  applyDamage(raw, part, weaponId) {
    const W = WEAPONS[weaponId];
    const cls = W ? W.cls : 'ar';
    let d = raw;
    if (part === 'head') { d *= HEAD_MULT[cls] || 2; if (this.helmet) { d *= 1 - ARMOR_RED[this.helmet.level]; this.helmet.dur -= raw * 0.6; if (this.helmet.dur <= 0) this.helmet = null; } }
    else if (part === 'body') { if (this.vest) { d *= 1 - ARMOR_RED[this.vest.level]; this.vest.dur -= raw * 0.4; if (this.vest.dur <= 0) this.vest = null; } }
    else if (part === 'limb') d *= LIMB_MULT[cls] || 0.9;
    return d;
  }

  bestBoost() { for (const id of ['chyawan', 'balm', 'kaapi']) if (this.count('boost', id)) return { type: 'boost', id }; const f = this.items.find((q) => q.type === 'food'); return f ? { type: 'food', id: f.id } : null; }

  // compact snapshot for the network
  snap() {
    const g = this.gun;
    return {
      id: this.id, p: [+this.pos.x.toFixed(2), +this.pos.y.toFixed(2), +this.pos.z.toFixed(2)], y: +this.yaw.toFixed(3), pi: +this.pitch.toFixed(3),
      st: this.stance[0], m: this.mode, sp: +this.speed.toFixed(2), f: +this.fwd.toFixed(2), s: +this.side.toFixed(2), a: this.aiming ? 1 : 0,
      g: g ? g.id : null, ga: g ? g.att : null, bg: [this.weapons[0]?.id || null, this.weapons[1]?.id || null], h: Math.round(this.hp), k: this.knocked ? 1 : 0,
      he: this.helmet?.level || 0, ve: this.vest?.level || 0, pa: this.pack?.level || 0, rl: this.reload ? 1 : 0, v: this.vehicle ? this.vehicle.id : null,
    };
  }
}

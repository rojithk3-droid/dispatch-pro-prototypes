// Ground loot: deterministic spawns from the match seed (identical on every client), meshes streamed in
// around the camera, rarity rings, death crates and airdrop crates.
import * as THREE from 'three';
import { mulberry32 } from './util.js';
import { rollLoot } from './weapons.js';
import { lootModel, tiffinCrate, part } from './models.js';

function rarity(it) {
  if ((it.level === 3) || it.id === 'awm' || it.id === 'x8' || it.id === 'chyawan' || it.id === 'medkit') return '#ffb000';
  if ((it.level === 2) || it.id === 'x4' || it.id === 'suppressor' || it.type === 'gun') return '#b06bff';
  return '#2de2e6';
}
const ringGeo = new THREE.RingGeometry(0.22, 0.26, 24); ringGeo.rotateX(-Math.PI / 2);
const ringMats = new Map();
const ringMat = (c) => { if (!ringMats.has(c)) { const k = new THREE.Color(c).multiplyScalar(2.2); ringMats.set(c, new THREE.MeshBasicMaterial({ color: k, transparent: true, opacity: 0.8, toneMapped: false, depthWrite: false })); } return ringMats.get(c); };

export class LootManager {
  constructor(scene, world, seed, map) {
    this.scene = scene; this.world = world; this.map = map;
    this.entries = new Map();
    this.group = new THREE.Group(); scene.add(this.group);
    this.t = 0;
    const rng = mulberry32(seed ^ 0x1007);
    let n = 0;
    for (const spot of world.loot) {
      if (world.noLoot.some((z) => Math.hypot(spot.x - z.x, spot.z - z.z) < z.r)) continue;
      const chance = spot.food || spot.chilli || spot.boost ? 1 : spot.tier === 2 ? 0.95 : spot.tier === 1 ? 0.75 : 0.55;
      if (rng() > chance) continue;
      const items = rollLoot(rng, spot.tier || 0, spot, map);
      items.forEach((it, k) => {
        const a = (k / Math.max(1, items.length)) * Math.PI * 2 + rng();
        const r = items.length > 1 ? 0.35 : 0;
        this.add('L' + n++, it, spot.x + Math.cos(a) * r, spot.y, spot.z + Math.sin(a) * r);
      });
    }
  }

  add(lid, item, x, y, z, crate = false) {
    const e = { lid, item, x, y, z, crate, mesh: null };
    this.entries.set(lid, e);
    if (crate) this._mesh(e);
    return e;
  }
  crate(lid, items, x, y, z, kind = 'death') {
    const e = { lid, items, x, y, z, crate: kind, mesh: null };
    this.entries.set(lid, e);
    this._mesh(e);
    return e;
  }
  remove(lid) {
    const e = this.entries.get(lid);
    if (!e) return null;
    if (e.mesh) this.group.remove(e.mesh);
    this.entries.delete(lid);
    return e;
  }
  _mesh(e) {
    if (e.mesh) return;
    let m;
    if (e.crate === 'air') { m = tiffinCrate(); }
    else if (e.crate) {
      m = new THREE.Group();
      part(m, new THREE.BoxGeometry(0.9, 0.55, 0.6), 'paint', '#3b3f45', 0, 0.28, 0);
      part(m, new THREE.BoxGeometry(0.92, 0.06, 0.62), 'neon', '#ff3f8e', 0, 0.5, 0);
    } else {
      m = lootModel(e.item);
      const r = new THREE.Mesh(ringGeo, ringMat(rarity(e.item)));
      r.position.y = 0.02; m.add(r);
    }
    m.position.set(e.x, e.y, e.z);
    m.rotation.y = (e.x * 7.13 + e.z * 3.7) % 6.28;
    this.group.add(m);
    e.mesh = m;
  }
  update(dt, cam) {
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.35;
    for (const e of this.entries.values()) {
      const d = Math.abs(e.x - cam.x) + Math.abs(e.z - cam.z);
      if (d < 70) this._mesh(e);
      else if (e.mesh && !e.crate && d > 90) { this.group.remove(e.mesh); e.mesh = null; }
    }
  }
  near(pos, r = 2.4) {
    const out = [];
    for (const e of this.entries.values()) {
      const dx = e.x - pos.x, dz = e.z - pos.z, dy = e.y - pos.y;
      if (dx * dx + dz * dz < r * r && dy > -1.2 && dy < 1.6) out.push(e);
    }
    return out;
  }
  dispose() { this.scene.remove(this.group); }
}

// A match: world, entities (local player, remote humans, host-simulated bots), plane → skydive → zone,
// combat routing, loot, vehicles, easter eggs, weather and all network sync.
//
// Authority model: every client simulates its own player; the host also simulates bots, the clock and
// airdrops. The shooter decides hits (lag-free for the shooter), the target's owner applies damage and
// broadcasts health/death. Loot is deterministic from the seed; take/drop events keep clients in sync.
import * as THREE from 'three';
import { generateWorld } from './world.js';
import { loadSky, loadSoldier, dotTexture } from './assets.js';
import { Entity } from './entity.js';
import { Avatar } from './character.js';
import { Combat } from './combat.js';
import { LootManager } from './loot.js';
import { ZonePlan, zoneWall, planeModel, airdropModel } from './zone.js';
import { Vehicle, VSPEC } from './vehicles.js';
import { BotBrain } from './bots.js';
import { LocalPlayer, Input } from './player.js';
import { HUD } from './hud.js';
import { audio } from './audio.js';
import { net, LS } from './net.js';
import { WEAPONS, MEDS, BOOSTS, rollLoot, airdropLoot, itemName, ATTACHMENTS } from './weapons.js';
import { mulberry32, hashStr, clamp, fmtTime } from './util.js';
import { OUTFIT_LIST, COSMETICS } from './character.js';
import { HALF, SURF } from './physics.js';

const PLANE_SPEED = 72;
const MODES = { solo: 1, duo: 2, squad: 4 };

export class Match {
  constructor(o) {
    Object.assign(this, {
      scene: o.scene, camera: o.camera, renderer: o.renderer, map: o.map, seed: o.seed, mode: o.mode || 'squad',
      matchId: o.matchId, hostId: o.hostId, meInfo: o.me, settings: o.settings, botCount: o.bots ?? 36, difficulty: o.difficulty || 'normal',
      onExit: o.onExit, isPublic: !!o.isPublic, party: o.party || [],
    });
    this.isHost = this.hostId === this.meInfo.id;
    this.entities = new Map(); this.brains = new Map(); this.vehicles = new Map();
    this.time = 0; this.phase = 'loading'; this.uiOpen = false; this.ui = {};
    this.outbox = []; this.stT = 0; this.botT = 0; this.flushT = 0; this.clkT = 0; this.lastClk = 0;
    this.airdrops = []; this.teamMarkers = new Map(); this.hurtFlash = 0; this.burn = 0;
    this.roster = new Map();
    this.eggFound = new Set(LS.get('eggs.' + this.map.id, []));
    this.stats = { kills: 0, dmg: 0, time: 0, eggs: 0 };
    this.dropN = 0;
    this.placeCounter = 0;
    this.deadTeams = new Set();
    this.inSun = true;
  }

  // ================================================================== loading
  async load(progress) {
    const q = this.settings.quality;
    audio.init();
    const soldierP = loadSoldier();
    const skyP = loadSky(this.map.sky, q === 'high' ? '2k' : '1k');
    this.world = await generateWorld(this.map, { quality: q, onProgress: (p, m) => progress(p * 0.85, m) });
    this.phys = this.world.phys;
    progress(0.87, 'Hanging the sky');
    const [sky, gltf] = await Promise.all([skyP, soldierP]);
    this.gltf = gltf;
    this.scene.add(this.world.group);
    this._lighting(sky);
    progress(0.93, 'Spawning loot');
    this.loot = new LootManager(this.scene, this.world, this.seed, this.map);
    this.combat = new Combat(this.scene, this.phys, {
      getTargets: () => this._targets || (this._targets = []),
      onHit: (b, t, part, p, d, veh) => this._onBulletHit(b, t, part, p, d, veh),
      localId: this.meInfo.id,
    });
    this.zone = new ZonePlan(this.seed, this.phys);
    this.zoneMesh = zoneWall(); this.zoneMesh.visible = false; this.scene.add(this.zoneMesh);
    this._plane();
    this._vehicles();
    this._weather();
    // compile every material now, behind the loading screen, instead of stalling the first frames
    progress(0.95, 'Warming up shaders');
    try { if (this.renderer.compileAsync) await this.renderer.compileAsync(this.scene, this.camera); } catch (e) { console.warn('shader precompile', e); }
    progress(0.97, 'Briefing the bots');
    this.input = new Input(this.renderer.domElement);
    const me = this._addEntity({ id: this.meInfo.id, name: this.meInfo.name, outfit: this.meInfo.outfit, cosmetic: this.meInfo.cosmetic, isLocal: true, team: this._teamFor(this.meInfo.id) });
    this.me = me;
    this.player = new LocalPlayer(this, me, this.camera, this.settings);
    this.hud = new HUD(this);
    this._keys();
    net.sub('m:' + this.matchId, (msg) => this._onNet(msg));
    if (!this.isHost) net.pub('m:' + this.matchId, { t: 'hello', id: me.id, name: me.name, outfit: me.outfit, cos: me.cosmetic, party: this.party });
    this.roster.set(me.id, { id: me.id, name: me.name, outfit: me.outfit, cos: me.cosmetic, team: me.team });
    this._startWarmup();
    progress(1, 'Ready');
  }

  _teamFor(id) {
    const size = MODES[this.mode];
    if (size === 1) return id;
    const idx = this.party.findIndex((p) => p.id === id);
    if (idx >= 0) return 'T:' + this.party[0].id + ':' + Math.floor(idx / size);
    return id;
  }

  _lighting(sky) {
    const s = this.scene, map = this.map;
    const pm = new THREE.PMREMGenerator(this.renderer);
    if (sky) {
      this.envRT = pm.fromEquirectangular(sky.tex);
      s.environment = this.envRT.texture; s.background = sky.tex;
      s.environmentIntensity = map.env; s.backgroundIntensity = map.bgI ?? 1.0;
    } else s.background = new THREE.Color(map.night ? 0x0a0e18 : 0x9ec3e6);
    const fogCol = new THREE.Color(map.fogColor || (sky ? sky.horizon.clone().multiplyScalar(map.night ? 1.8 : 0.82).convertLinearToSRGB().getStyle() : '#aab8c8'));
    s.fog = new THREE.FogExp2(fogCol, map.fog);
    this.sunDir = sky ? sky.sunDir.clone() : new THREE.Vector3(0.4, 0.8, 0.3).normalize();
    if (this.sunDir.y < 0.25) { this.sunDir.y = 0.25; this.sunDir.normalize(); }
    this.sun = new THREE.DirectionalLight(sky ? sky.sunColor : 0xffffff, map.sun);
    this.sun.castShadow = this.settings.quality !== 'low';
    const sm = this.settings.quality === 'high' ? 4096 : 2048;
    this.sun.shadow.mapSize.set(sm, sm);
    Object.assign(this.sun.shadow.camera, { left: -90, right: 90, top: 90, bottom: -90, near: 1, far: 900 });
    this.sun.shadow.bias = -0.0003; this.sun.shadow.normalBias = 0.04;
    s.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(map.night ? 0x5a6a9a : 0xcfe0ff, map.night ? 0x151218 : 0x4a4032, map.night ? 0.55 : 0.35);
    s.add(this.hemi);
    if (map.night) { this.moonFill = new THREE.AmbientLight(0x4a5a88, 0.25); s.add(this.moonFill); }
  }

  _plane() {
    const rng = mulberry32(this.seed ^ 0xa11);
    const a = rng() * Math.PI * 2;
    const off = (rng() - 0.5) * HALF;
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const perp = new THREE.Vector3(-dir.z, 0, dir.x);
    let maxH = 0; for (let i = 0; i < 400; i++) maxH = Math.max(maxH, this.phys.height((rng() - 0.5) * HALF * 2, (rng() - 0.5) * HALF * 2));
    const y = Math.max(320, maxH + 160);
    const reach = HALF + 190;
    const A = perp.clone().multiplyScalar(off).addScaledVector(dir, -reach); A.y = y;
    const B = perp.clone().multiplyScalar(off).addScaledVector(dir, reach); B.y = y;
    const model = planeModel(this.map.plane);
    model.visible = false;
    this.scene.add(model);
    const L = A.distanceTo(B);
    this.plane = {
      a: A, b: B, pos: A.clone(), t: 0, dur: L / (PLANE_SPEED * Math.max(1, Math.sqrt(HALF / 512))), model, active: false, start: 0,
      distToPath: (x, z) => { const ax = x - A.x, az = z - A.z; const u = clamp((ax * dir.x + az * dir.z) / L, 0, 1); return Math.hypot(A.x + (B.x - A.x) * u - x, A.z + (B.z - A.z) * u - z); },
      nearestT: (x, z) => clamp(((x - A.x) * dir.x + (z - A.z) * dir.z) / L, 0.06, 0.94),
    };
    model.position.copy(A); model.lookAt(A.clone().multiplyScalar(2).sub(B));
  }

  _vehicles() {
    this.world.vehicleSpawns.forEach((s, i) => {
      const v = new Vehicle(s.kind, s.x, s.y, s.z, s.ry + Math.PI, 'v' + i);
      this.scene.add(v.root); this.vehicles.set(v.id, v); this.phys.dynamic.push(v.dyn);
    });
  }

  _weather() {
    const w = this.map.weather || {};
    this.rainK = w.rain || 0; this.rainTarget = this.rainK;
    const N = 9000;
    const pos = new Float32Array(N * 6);
    for (let i = 0; i < N; i++) { const x = (Math.random() - 0.5) * 80, y = Math.random() * 40, z = (Math.random() - 0.5) * 80; pos.set([x, y, z, x + 0.05, y - 0.7, z], i * 6); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.rain = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xaab8c8, transparent: true, opacity: 0.35, depthWrite: false }));
    this.rain.frustumCulled = false; this.rain.visible = false; this.scene.add(this.rain);
    this.rainN = N;
    if (w.snow) {
      const sp = new Float32Array(4000 * 3);
      for (let i = 0; i < 4000; i++) sp.set([(Math.random() - 0.5) * 90, Math.random() * 45, (Math.random() - 0.5) * 90], i * 3);
      const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
      this.snow = new THREE.Points(sg, new THREE.PointsMaterial({ map: dotTexture(0.5), size: 0.12, transparent: true, depthWrite: false, color: 0xffffff }));
      this.snow.frustumCulled = false; this.scene.add(this.snow);
    }
    this.fireworksT = 3;
  }

  // ================================================================== entities
  _addEntity(o) {
    if (this.entities.has(o.id)) return this.entities.get(o.id);
    const e = new Entity(o);
    e.avatar = new Avatar(this.gltf, { outfit: o.outfit, cosmetic: o.cosmetic });
    e.avatar.root.visible = false;
    e.weapons[3] = null;
    this.scene.add(e.avatar.root);
    this.entities.set(e.id, e);
    this._targets = [...this.entities.values()];
    return e;
  }
  _removeEntity(id) {
    const e = this.entities.get(id);
    if (!e) return;
    if (e.alive && this.phase === 'battle') this._kill(e, null, 'disconnect', false, true);
    e.avatar.dispose(); this.entities.delete(id); this.brains.delete(id);
    this._targets = [...this.entities.values()];
  }
  aliveCount() { let n = 0; for (const e of this.entities.values()) if (e.alive && (this.phase !== 'warmup')) n++; return n; }
  teamsAlive() { const s = new Set(); for (const e of this.entities.values()) if (e.alive) s.add(e.team); return s; }

  _spawnBots() {
    const rng = mulberry32(this.seed ^ 0xb075);
    const size = MODES[this.mode];
    const names = [...this.map.bots];
    const skillBase = { easy: 0.15, normal: 0.4, hard: 0.7 }[this.difficulty] ?? 0.4;
    for (let i = 0; i < this.botCount; i++) {
      if (!names.length) names.push(...this.map.bots.map((n) => n + '_' + (10 + Math.floor(rng() * 89))));
      const nm = names.splice(Math.floor(rng() * names.length), 1)[0];
      const id = 'B' + i;
      const e = this._addEntity({ id, name: nm + (rng() < 0.3 ? '_' + Math.floor(rng() * 99) : ''), isBot: true, outfit: OUTFIT_LIST[Math.floor(rng() * OUTFIT_LIST.length)], cosmetic: COSMETICS[Math.floor(rng() * COSMETICS.length)], team: size === 1 ? id : 'BT' + Math.floor(i / size) });
      e.mode = 'plane';
      // brains draw from their own stream so every client names/dresses bots identically
      if (this.isHost) this._makeBrain(e, mulberry32(hashStr(id) ^ this.seed));
    }
  }
  _makeBrain(e, rng) {
    const skillBase = { easy: 0.15, normal: 0.4, hard: 0.7 }[this.difficulty] ?? 0.4;
    const b = new BotBrain(this, e, clamp(skillBase + (rng() - 0.5) * 0.35, 0.05, 0.95), rng);
    b.planJump(this.plane, rng);
    this.brains.set(e.id, b);
  }

  // ================================================================== phases
  _startWarmup() {
    this.phase = 'warmup';
    const solo = !this.isPublic && this.party.length <= 1;
    this.warmupLeft = solo ? 6 : this.isPublic ? 45 : 12;
    const W = this.world;
    const c = W.places[0] || { x: 0, z: 0 };
    this.warmSpot = { x: c.x, z: c.z };
    this._spawnWarm(this.me);
    this.me.weapons[3] = { id: 'tawa', att: {}, mag: 0, mode: 0 }; this.me.cur = 3; this.syncGear(this.me);
    this.hud.center('WARM-UP<small>Find your feet. The plane leaves soon.</small>', 4);
    if (this.isPublic && this.isHost) this._advertise();
  }
  _spawnWarm(e) {
    const a = Math.random() * Math.PI * 2, r = 4 + Math.random() * 10;
    const x = this.warmSpot.x + Math.cos(a) * r, z = this.warmSpot.z + Math.sin(a) * r;
    e.pos.set(x, this.phys.support(x, z, 0.3, 500), z); e.mode = 'ground'; e.alive = true;
    e.avatar.root.visible = true;
  }
  _advertise() {
    if (!this.isPublic || this.phase !== 'warmup') return;
    const ad = { matchId: this.matchId, host: this.me.name, hostId: this.me.id, map: this.map.id, mode: this.mode, players: this.roster.size, startsIn: Math.round(this.warmupLeft), seed: this.seed, bots: this.botCount };
    this.social && this.social.advertise(ad);
  }
  startPlane(planeStart) {
    if (this.phase === 'plane' || this.phase === 'battle') return;
    this.phase = 'plane';
    this.plane.active = true; this.plane.start = planeStart ?? this.time; this.plane.model.visible = true;
    this.social && this.isPublic && this.isHost && this.social.unadvertise(this.matchId);
    this._spawnBots();
    // reset everyone for the drop
    for (const e of this.entities.values()) {
      e.mode = 'plane'; e.hp = 100; e.boost = 0; e.alive = true; e.items = []; e.weapons = [null, null, null, null]; e.cur = -1; e.helmet = e.vest = e.pack = null;
      e.avatar.root.visible = false; this.syncGear(e);
    }
    this.planeLoop = audio.loop('plane', 'plane');
    this.planeLoop && this.planeLoop.set({ vol: 0.5 });
    this.hud.center(`${this.map.plane.toUpperCase()}<small>Press F to jump · WASD to glide · the chute opens itself</small>`, 6);
    this.hud.toast('Welcome aboard. Chai and coffee will not be served.', '');
  }

  jumpFromPlane(e) {
    if (e.mode !== 'plane') return;
    e.mode = 'freefall';
    e.pos.copy(this.plane.pos); e.pos.y -= 4;
    const d = this.plane.b.clone().sub(this.plane.a).normalize();
    e.vel.copy(d).multiplyScalar(20); e.vel.y = -5;
    e.avatar.root.visible = true;
    if (e === this.me) { audio.click('ui'); this.hud.center('', 0); this._emit({ t: 'jump', id: e.id }); }
  }
  onChute(e) { if (e === this.me) { audio.click('pickup'); this._emit({ t: 'chute', id: e.id }); } }
  onLand(e) {
    if (e === this.me) { this.windLoop(0); this.hud.toast(`Welcome to ${this.map.name}`, ''); }
  }
  windLoop(k) {
    if (!this.wind) this.wind = audio.loop('wind', 'wind');
    this.wind && this.wind.set({ vol: k * 0.6, freq: 400 + k * 900 });
  }

  // ================================================================== update
  update(dt) {
    if (this.phase === 'loading') return;
    dt = Math.min(dt, 0.05);
    this.time += dt;
    this.stats.time = this.me.alive && this.phase === 'battle' ? this.stats.time + dt : this.stats.time;
    this._inputKeys();
    // phase clocks
    if (this.phase === 'warmup') {
      if (this.isHost) {
        this.warmupLeft -= dt;
        if (this.warmupLeft <= 0) { const ps = this.time + 0.5; this._emit({ t: 'start', ps, mt: this.time }); this.startPlane(ps); }
        this._advT = (this._advT || 0) - dt; if (this._advT <= 0) { this._advT = 2; this._advertise(); }
      }
      this.phaseLabel = 'PLANE DEPARTS IN'; this.phaseTime = Math.max(0, this.warmupLeft);
    }
    if (this.phase === 'plane' || this.phase === 'battle') {
      const P = this.plane;
      P.t = clamp((this.time - P.start) / P.dur, 0, 1);
      P.pos.lerpVectors(P.a, P.b, P.t);
      P.model.position.copy(P.pos);
      P.model.traverse((o) => { if (o.name === 'prop') o.rotation.z += dt * 40; });
      if (P.t >= 1 && P.active) {
        P.active = false; P.model.visible = false; this.planeLoop && this.planeLoop.stop();
        for (const e of this.entities.values()) if (e.mode === 'plane' && (e.isLocal || (e.isBot && this.isHost))) this.jumpFromPlane(e);
      }
      if (this.phase === 'plane' && P.t > 0.05) this.phase = 'battle';
      if (this.phase === 'plane') { this.phaseLabel = 'DROP'; this.phaseTime = null; }
    }
    const zt = this.time - this.plane.start - 25;
    this.zoneState = this.phase === 'battle' ? this.zone.at(Math.max(0, zt)) : null;
    if (this.zoneState) this._zoneTick(dt);

    // local player
    this.player.update(dt);
    // bots (host)
    if (this.isHost) for (const b of this.brains.values()) b.update(dt);
    // remote interpolation
    for (const e of this.entities.values()) if (!e.isLocal && !(e.isBot && this.isHost)) this._interp(e, dt);
    // vehicles
    for (const v of this.vehicles.values()) {
      const drv = v.driver;
      if (drv && (drv.isLocal || (drv.isBot && this.isHost))) v.step(dt, v.input || { throttle: 0, steer: 0 }, this._vctx());
      else if (v.remote) v.netUpdate(dt);
      else if (!drv && Math.abs(v.speed) > 0.1) v.step(dt, null, this._vctx());
      for (let s = 0; s < v.seats.length; s++) { const occ = v.seats[s]; if (occ) { v.seatWorld(s, occ.pos); occ.pos.y -= 0.9; occ.yaw = occ === this.me ? occ.yaw : v.yaw; } }
      this._roadkill(v);
    }
    // entity bookkeeping: boost regen, knocked bleed, avatars
    const camPos = this.camera.position;
    for (const e of this.entities.values()) {
      if (e.alive && (e.isLocal || (e.isBot && this.isHost))) this._vitals(e, dt);
      if (!e.avatar) continue;
      const a = e.avatar;
      if (!e.alive && e.mode !== 'dead') continue;
      a.root.position.copy(e.pos);
      a.root.rotation.y = e.vehicle ? e.vehicle.yaw : e.yaw;
      if (e.vehicle) a.root.position.y += 0.35;
      a.update(dt, {
        speed: e.speed, fwd: e.fwd, side: e.side, stance: e.knocked ? 'prone' : e.stance, aiming: e.aiming, firing: e.firing, pitch: e.pitch,
        mode: !e.alive ? 'dead' : e.mode === 'ride' ? 'drive' : e.mode, dead: !e.alive, reloading: e.reload ? e.reload.t / e.reload.dur : 0,
        handles: e.vehicle && e.seat === 0 ? e.vehicle.handlesWorld() : null,
      }, e.isLocal ? 0 : camPos.distanceTo(e.pos));
    }
    // systems
    this.combat.update(dt, camPos);
    this.loot.update(dt, camPos);
    this.world.update(dt, camPos);
    this._airdrops(dt);
    this._weatherTick(dt);
    this._eggs(dt);
    this._sunFollow();
    this._zoneVisual();
    audio.ambience(this.map, dt);
    this.hud.update(dt);
    this._net(dt);
    this.burn = Math.max(0, this.burn - dt * 0.12);
    this.input.endFrame();
  }

  _vctx() {
    return {
      phys: this.phys, potholes: this.world.potholes, slowZones: this.world.slowZones,
      onCrash: (v, s) => { if (v.driver === this.me) this.combat.shake = Math.min(1, s / 15); },
      onPothole: (v) => { if (v.driver === this.me) { this.combat.shake = 0.6; this.toast('Pothole! Namma roads, namma pride.'); this._specialEgg('potholehit', 'Pothole Hit', 'You found a pothole with your vehicle. Your spine will remember this.'); } },
      onExplode: (v) => this._vehicleExplode(v),
    };
  }

  _vitals(e, dt) {
    // boost: health regen + decay
    if (e.boost > 0) {
      const rate = e.boost > 90 ? 4 : e.boost > 60 ? 3 : e.boost > 20 ? 2 : 1;
      if (!e.knocked) e.hp = Math.min(100, e.hp + (rate / 8) * dt);
      e.boost = Math.max(0, e.boost - dt * 0.9);
    }
    if (e.knocked) {
      e.bleed -= dt * (2.5 + (e.knockCount || 0) * 1.5);
      if (e.bleed <= 0) this._kill(e, e.lastHitBy, 'bled out', false);
      // revive progress
      if (e.reviving) { e.reviving.t += dt; if (e.reviving.t >= 5) this._revive(e); }
    }
  }

  _zoneTick(dt) {
    const z = this.zoneState;
    if (this._lastPhase !== z.phase + (z.shrinking ? 0.5 : 0)) {
      const prev = this._lastPhase;
      this._lastPhase = z.phase + (z.shrinking ? 0.5 : 0);
      if (prev !== undefined) {
        const [local, en] = this.map.zoneMsgs;
        if (z.shrinking) { this.hud.toast(local, 'zone', en); audio.click('zone'); }
        else this.hud.toast(`Blue zone ${z.phase === 0 ? 'appears' : 'shrinks'} in ${fmtTime(z.timeLeft)}`, 'zone', 'Check the map (M)');
        if (this.isHost && !z.shrinking && (z.phase === 1 || z.phase === 3)) this._spawnAirdrop(z);
      }
    }
    for (const e of this.entities.values()) {
      if (!e.alive || !(e.isLocal || (e.isBot && this.isHost)) || e.mode === 'plane') continue;
      const out = Math.hypot(e.pos.x - z.x, e.pos.z - z.z) > z.r;
      if (out) { e.zoneAcc = (e.zoneAcc || 0) + z.dmg * dt; if (e.zoneAcc >= 1) { const d = Math.floor(e.zoneAcc); e.zoneAcc -= d; this.damage(e, d, null, 'zone'); } }
    }
  }
  _zoneVisual() {
    const z = this.zoneState;
    this.zoneMesh.visible = !!z && z.r < HALF * 1.17;
    if (!this.zoneMesh.visible) return;
    this.zoneMesh.position.set(z.x, -50, z.z);
    this.zoneMesh.scale.set(Math.max(0.5, z.r), 700, Math.max(0.5, z.r));
    this.zoneMesh.material.uniforms.uTime.value = this.time;
    this.zoneMesh.material.uniforms.uR.value = z.r;
  }

  _sunFollow() {
    const c = this.me.mode === 'plane' ? this.plane.pos : this.me.pos;
    const snap = 8;
    const cx = Math.round(c.x / snap) * snap, cz = Math.round(c.z / snap) * snap, cy = this.phys.height(cx, cz);
    this.sun.target.position.set(cx, cy, cz);
    this.sun.position.set(cx, cy, cz).addScaledVector(this.sunDir, 400);
  }

  _weatherTick(dt) {
    const w = this.map.weather || {};
    if (w.rainAfter && this.phase === 'battle' && this.time - this.plane.start > w.rainAfter && !this._rained) {
      this._rained = true; this.rainTarget = w.rainAmount || 0.7;
      this.hud.toast('It\'s 4:00 PM in Bengaluru. You know what that means.', 'zone', 'Rain incoming');
      this._specialEgg('rain4pm', 'Rain at 4 PM', 'Bengaluru rain arrives exactly at 4 PM. Everyone saw it coming. Nobody carried an umbrella.');
    }
    this.rainK += (this.rainTarget - this.rainK) * Math.min(1, dt * 0.3);
    const cam = this.camera.position;
    this.rain.visible = this.rainK > 0.02;
    if (this.rain.visible) {
      this.rain.position.set(cam.x, cam.y - 15, cam.z);
      this.rain.material.opacity = 0.18 + this.rainK * 0.3;
      const p = this.rain.geometry.attributes.position.array;
      const fall = dt * 22;
      const n = Math.floor(this.rainN * this.rainK);
      for (let i = 0; i < n; i++) { const k = i * 6; p[k + 1] -= fall; p[k + 4] -= fall; if (p[k + 1] < 0) { p[k + 1] += 40; p[k + 4] += 40; } }
      for (let i = n; i < this.rainN; i++) { p[i * 6 + 1] = -999; p[i * 6 + 4] = -999; }
      this.rain.geometry.attributes.position.needsUpdate = true;
      if (!this.rainLoop) this.rainLoop = audio.loop('rain', 'rain');
      this.rainLoop && this.rainLoop.set({ vol: this.rainK * 0.5 });
      this.weatherLabel = 'RAIN';
    }
    if (this.snow) {
      this.snow.position.set(cam.x, cam.y - 20, cam.z);
      const p = this.snow.geometry.attributes.position.array;
      for (let i = 0; i < p.length; i += 3) { p[i + 1] -= dt * 1.4; p[i] += Math.sin(this.time + i) * dt * 0.3; if (p[i + 1] < 0) p[i + 1] += 45; }
      this.snow.geometry.attributes.position.needsUpdate = true;
    }
    // Pooram fireworks over Thrissur
    if (w.fireworks) {
      this.fireworksT -= dt;
      if (this.fireworksT <= 0) {
        this.fireworksT = 1.5 + Math.random() * 4;
        const x = (Math.random() - 0.5) * 300, z = (Math.random() - 0.5) * 300, y = 90 + Math.random() * 60;
        const col = [[1, 0.3, 0.5], [1, 0.8, 0.2], [0.3, 0.9, 1], [0.6, 1, 0.4], [1, 1, 1]][Math.floor(Math.random() * 5)];
        for (let i = 0; i < 90; i++) {
          const a = Math.random() * 6.283, b = Math.acos(Math.random() * 2 - 1), s = 14 + Math.random() * 8;
          this.combat.fxAdd.emit(x, y, z, Math.sin(b) * Math.cos(a) * s, Math.cos(b) * s, Math.sin(b) * Math.sin(a) * s, col[0] * 2, col[1] * 2, col[2] * 2, 1, 1.2, 1.6 + Math.random(), 0, 4);
        }
        audio.firework(new THREE.Vector3(x, y, z));
      }
    }
    // Chennai sun: are we under a roof?
    if (this.map.mechanics.heat) { this._sunT = (this._sunT || 0) - dt; if (this._sunT <= 0) { this._sunT = 0.5; const p = this.me.pos; this.inSun = !this.phys.raycast(p.x, p.y + 1.8, p.z, this.sunDir.x, this.sunDir.y, this.sunDir.z, 80); } }
  }

  // ================================================================== easter eggs
  _eggs(dt) {
    this._eggT = (this._eggT || 0) - dt;
    if (this._eggT > 0 || !this.me.alive || this.me.mode === 'plane') return;
    this._eggT = 0.3;
    const p = this.me.pos;
    for (const g of this.world.eggs) {
      if (this.eggFound.has(g.id)) continue;
      if (Math.hypot(p.x - g.x, p.z - g.z) < (g.r || 12) && Math.abs(p.y - g.y) < 25) this._foundEgg(g);
    }
    // Swaraj Round lap (Thrissur): drive a full circle around the round
    if (this.map.mechanics.swarajRound && this.me.vehicle) {
      const a = Math.atan2(p.z, p.x), r = Math.hypot(p.x, p.z);
      if (r > 105 && r < 160) {
        if (this._lapA !== undefined) { let d = a - this._lapA; if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; this._lapSum = (this._lapSum || 0) + d; }
        this._lapA = a;
        if (Math.abs(this._lapSum || 0) > Math.PI * 2) { this._lapSum = 0; this._specialEgg('swarajlap', 'Swaraj Round Lap', 'You drove a full lap around Swaraj Round. Thrissur doesn\'t have roads, it has one circle. Welcome home.'); }
      } else { this._lapA = undefined; this._lapSum = 0; }
    }
  }
  _foundEgg(g) {
    this.eggFound.add(g.id);
    LS.set('eggs.' + this.map.id, [...this.eggFound]);
    this.stats.eggs++;
    const total = this.world.eggs.length + 3;
    this.hud.egg(g, this.eggFound.size, total);
    audio.click('egg');
  }
  _specialEgg(id, title, text) { if (!this.eggFound.has(id)) this._foundEgg({ id, title, text }); }

  // ================================================================== combat routing
  fire(e, origin, dir, weaponId, opts) {
    this.combat.fire({ id: e.id, team: e.team }, origin, dir, weaponId, opts);
    this._emit({ t: 'shot', id: e.id, o: v3(origin), d: v3(dir, 4), w: weaponId, s: opts.suppressed ? 1 : 0 });
    if (e.isBot) for (const b of this.brains.values()) b.hear(origin, opts.suppressed ? 25 : 200);
  }
  noise(e, loud) { if (this.isHost) for (const b of this.brains.values()) if (b.e !== e) b.hear(e.pos, loud); }

  throwNade(e, from, vel, type) {
    this.combat.throw({ id: e.id, team: e.team }, from, vel, type, true);
    this._emit({ t: 'nade', id: e.id, p: v3(from), v: v3(vel), k: type });
  }

  melee(e, dmg, range) {
    const f = new THREE.Vector3(-Math.sin(e.yaw), 0, -Math.cos(e.yaw));
    for (const t of this.entities.values()) {
      if (t === e || !t.alive || t.team === e.team) continue;
      const d = t.pos.clone().sub(e.pos); d.y = 0;
      if (d.length() < range && d.normalize().dot(f) > 0.5) {
        this._onBulletHit({ shooter: { id: e.id, team: e.team }, w: e.gun ? e.gun.id : 'fists', dmg }, t, 'body', t.pos.clone().add(new THREE.Vector3(0, 1.2, 0)), 1);
        if (e.gun && e.gun.id === 'tawa') audio.gun(t.pos, 'pan');
        break;
      }
    }
    this._emit({ t: 'melee', id: e.id });
  }

  _onBulletHit(b, t, part, p, dist, veh) {
    const shooter = this.entities.get(b.shooter.id);
    if (veh) { // vehicle hit
      if (!veh.dead) { veh.damage(WEAPONS[b.w] ? WEAPONS[b.w].dmg * 0.5 : 20); this._emit({ t: 'vdmg', v: veh.id, hp: Math.round(veh.hp) }); }
      return;
    }
    if (!t || !t.alive) return;
    if (t.team === b.shooter.team && t.id !== b.shooter.id) return; // no friendly fire
    const W = WEAPONS[b.w];
    let raw = b.dmg ?? (W ? W.dmg : 10);
    if (W && !b.explosive) {
      const fall = { smg: [60, 180, 0.6], pistol: [40, 120, 0.55], sg: [12, 40, 0.3], ar: [150, 500, 0.8], dmr: [250, 700, 0.9], sr: [400, 900, 0.95] }[W.cls];
      if (fall) raw *= 1 - (1 - fall[2]) * clamp((dist - fall[0]) / (fall[1] - fall[0]), 0, 1);
    }
    // the legendary tawa on your back stops bullets
    if (!b.explosive && part === 'body' && t.weapons[3] && t.weapons[3].id === 'tawa' && t.cur !== 3 && shooter) {
      const tf = new THREE.Vector3(-Math.sin(t.yaw), 0, -Math.cos(t.yaw));
      const from = shooter.pos.clone().sub(t.pos).setY(0).normalize();
      if (from.dot(tf) < -0.55 && Math.random() < 0.8) {
        audio.gun(p, 'pan');
        this.combat.impactFx(p, [from.x, 0, from.z], SURF.metal, from);
        if (shooter === this.me) this.toast('CLANG! Their tawa blocked it.');
        return;
      }
    }
    if (shooter === this.me) {
      const est = t.applyDamage.call({ helmet: t.helmet && { ...t.helmet }, vest: t.vest && { ...t.vest } }, raw, part, b.w);
      this.stats.dmg += est; this.me.dmgDealt += est;
      const willKill = (t.knocked ? t.bleed : t.hp) - est <= 0;
      this.hud.hit(willKill, part === 'head');
      audio.click(part === 'head' ? 'head' : 'hit');
    }
    if (t.isLocal || (t.isBot && this.isHost)) this.applyHit(t, raw, part, b.w, b.shooter.id, p);
    else this._emit({ t: 'hit', to: t.id, by: b.shooter.id, raw: Math.round(raw * 10) / 10, part, w: b.w, p: v3(p) });
  }

  applyHit(t, raw, part, w, byId, p) {
    if (!t.alive) return;
    const by = this.entities.get(byId);
    const d = w === 'zone' || w === 'fall' ? raw : t.applyDamage(raw, part, w);
    t.lastHitBy = byId; t.lastHitT = this.time;
    if (t.isBot && this.brains.get(t.id) && by) this.brains.get(t.id).hurtBy(by);
    if (t === this.me) {
      this.hurtFlash = Math.min(1, this.hurtFlash + d / 40);
      audio.click('hurt');
      if (by && by !== t) { const a = Math.atan2(by.pos.x - t.pos.x, -(by.pos.z - t.pos.z)) + t.yaw; this.hud.damageFrom(a); }
      if (t.heal) this.player.cancelHeal();
    }
    if (t.knocked) {
      t.bleed -= d * 0.8;
      if (t.bleed <= 0) this._kill(t, byId, w, part === 'head');
    } else {
      t.hp -= d;
      if (t.hp <= 0) {
        t.hp = 0;
        const mates = [...this.entities.values()].filter((q) => q.team === t.team && q !== t && q.alive && !q.knocked);
        if (mates.length && w !== 'zone' && MODES[this.mode] > 1) this._knock(t, byId, w);
        else this._kill(t, byId, w, part === 'head');
      }
    }
    this._emit({ t: 'hp', id: t.id, hp: Math.round(t.hp), k: t.knocked ? 1 : 0, bl: Math.round(t.bleed), he: t.helmet?.level || 0, ve: t.vest?.level || 0 });
  }
  damage(e, d, byId, kind) { this.applyHit(e, d, 'body', kind, byId || e.lastHitBy); }

  _knock(t, byId, w) {
    t.knocked = true; t.bleed = 100; t.knockCount = (t.knockCount || 0) + 1; t.stance = 'prone'; t.cur = -1; t.reload = null; t.heal = null;
    const by = this.entities.get(byId);
    this.hud.killfeed(by ? by.name : '', t.name, 'knocked', false, by === this.me, 'knocked');
    this._emit({ t: 'knock', id: t.id, by: byId });
    if (t === this.me) this.hud.center('KNOCKED DOWN<small>Crawl to cover · a squadmate can revive you</small>', 4);
  }
  _revive(t) {
    t.knocked = false; t.hp = 20; t.bleed = 100; t.reviving = null; t.stance = 'crouch';
    this._emit({ t: 'revived', id: t.id });
    if (t === this.me) this.hud.center('REVIVED', 2);
  }

  _kill(t, byId, w, head, silent) {
    if (!t.alive) return;
    t.alive = false; t.knocked = false; t.hp = 0;
    if (t.vehicle) this._leaveVehicle(t);
    t.mode = 'dead';
    t.place = this.teamsAlive().size + (this.teamsAlive().has(t.team) ? 0 : 1);
    const by = this.entities.get(byId);
    if (by && by !== t) by.kills++;
    // drop everything in a death crate (owner decides contents)
    if ((t.isLocal || (t.isBot && this.isHost)) && !silent) {
      const items = [];
      for (let s = 0; s < 4; s++) if (t.weapons[s] && t.weapons[s].id !== 'tawa') items.push(...t.unequipGun(s));
      items.push(...t.items.filter((i) => (i.n || 1) > 0));
      for (const k of ['helmet', 'vest', 'pack']) if (t[k]) items.push({ type: k, level: t[k].level, dur: t[k].dur });
      t.items = [];
      const lid = 'X' + t.id + ':' + this.dropN++;
      if (items.length) { this.loot.crate(lid, items, t.pos.x, t.pos.y, t.pos.z); this._emit({ t: 'crate', lid, items, x: t.pos.x, y: t.pos.y, z: t.pos.z }); }
      this._emit({ t: 'dead', id: t.id, by: byId, w, head: head ? 1 : 0 });
    }
    this._feedKill(by, t, w, head);
    if (t === this.me) this._onMyDeath(by);
    if (by === this.me && t !== this.me) {
      this.stats.kills = this.me.kills;
      const verbs = this.map.killVerbs;
      this.hud.center(`<span style="color:var(--red)">✕</span> ${t.name}<small>${this.me.kills} kill${this.me.kills > 1 ? 's' : ''} · you ${verbs[Math.floor(Math.random() * verbs.length)]} them</small>`, 2.5);
      audio.click('kill');
      if (w === 'tawa') this._specialEgg('tawakill', 'Dosa Tawa Master', 'Won a fight with a frying pan. Crispy on the outside, soft on the inside. Just like the dosa.');
    }
    this._checkEnd();
  }
  _feedKill(by, t, w, head) {
    const W = WEAPONS[w];
    const wn = W ? W.name : w === 'zone' ? 'the blue zone' : w === 'fall' ? 'gravity' : w === 'frag' ? 'Sutli Bomb' : w === 'vehicle' ? 'roadkill' : w === 'bled out' ? 'bled out' : w;
    if (by && by !== t) this.hud.killfeed(by.name, t.name, wn, head, by === this.me || t === this.me, (W ? W.name : wn));
    else this.hud.killfeed('', t.name, w === 'zone' ? 'got caught in the zone' : w === 'fall' ? 'forgot the parachute exists' : 'died', false, t === this.me);
  }
  _onMyDeath(by) {
    const place = this.me.place || this.teamsAlive().size + 1;
    const alive = [...this.entities.values()].filter((q) => q.team === this.me.team && q.alive);
    this.spectate = alive[0] || (by && by.alive ? by : null);
    if (!alive.length) this._showEnd(false, place);
    else { this.hud.center('ELIMINATED<small>Spectating your squad</small>', 3); this.hud.spectate(this.spectate.name); }
  }
  _checkEnd() {
    if (this.ended) return;
    const teams = this.teamsAlive();
    if (this.phase !== 'battle' || teams.size > 1) return;
    if (!this.isHost) return;
    const win = [...teams][0];
    this._emit({ t: 'end', team: win });
    this._end(win);
  }
  _end(team) {
    if (this.ended) return;
    this.ended = true;
    const win = team === this.me.team;
    if (win) {
      this._showEnd(true, 1);
      audio.click('win');
      this._specialEgg('dinner', this.map.win, 'You won in ' + this.map.name + '. The meal is on the house.');
      const s = LS.get('stats', { wins: 0, kills: 0, games: 0 }); s.wins++; LS.set('stats', s);
    }
  }
  _showEnd(win, place) {
    if (this._endShown) return;
    this._endShown = true;
    const s = LS.get('stats', { wins: 0, kills: 0, games: 0 }); s.kills += this.me.kills; s.games++; LS.set('stats', s);
    const total = new Set([...this.entities.values()].map((e) => e.team)).size;
    this.hud.endScreen(win, place, total, { kills: this.me.kills, dmg: this.stats.dmg, time: this.stats.time, eggs: this.stats.eggs }, this.map);
    this.setUi('end', true);
  }

  consume(e, it) {
    if (it.type === 'med') {
      if (it.id === 'bandage') e.hp = Math.max(e.hp, Math.min(75, e.hp + 10));
      else if (it.id === 'fak') e.hp = Math.max(e.hp, 75);
      else e.hp = 100;
    }
    else if (it.type === 'boost') e.boost = Math.min(100, e.boost + BOOSTS[it.id].boost);
    else if (it.type === 'food') {
      const F = this.foodDef(it.id);
      if (F.kind === 'heal') e.hp = Math.min(100, e.hp + F.amount); else e.boost = Math.min(100, e.boost + F.amount);
      if (F.burn || it.id === 'rajamircha') { if (e === this.me) { this.burn = 1; this.hud.toast('🔥 RAJA MIRCHA. Your screen is on fire.', 'warn'); } }
      if (e === this.me) this.toast(`${F.name}: ${F.desc || ''}`);
    }
    if (e === this.me) audio.click('heal');
  }
  foodDef(id) {
    if (id === 'rajamircha') return { name: 'Raja Mircha', kind: 'boost', amount: 100, time: 2, burn: true, desc: '+100 boost. Burns.' };
    return this.map.food && this.map.food.id === id ? this.map.food : { name: 'Snack', kind: 'heal', amount: 15, time: 3 };
  }

  // ================================================================== loot / inventory actions
  interaction(e) {
    // revive teammate
    for (const t of this.entities.values()) {
      if (t !== e && t.team === e.team && t.knocked && t.alive && t.pos.distanceTo(e.pos) < 2.2) return { label: `Revive ${t.name} (hold)`, act: () => { t.reviving = { t: 0, by: e.id }; this._emit({ t: 'reviving', id: t.id, by: e.id }); this.toast('Reviving… stay close'); } };
    }
    // vehicles
    for (const v of this.vehicles.values()) {
      if (v.dead) continue;
      if (v.pos.distanceTo(e.pos) < Math.max(3, v.S.len * 0.6) && v.seats.some((s) => !s)) return { label: `Enter ${v.S.name}`, act: () => this.enterVehicle(e, v) };
    }
    // climb points
    for (const c of this.world.climbs) {
      if (Math.hypot(c.x - e.pos.x, c.z - e.pos.z) < c.r && Math.abs(e.pos.y - c.y) < 3) return { label: `Climb ${c.name}`, act: () => { e.pos.set(...c.top); e.vel.set(0, 0, 0); audio.step(e.pos, 'metal', 1, true); } };
      if (Math.hypot(c.top[0] - e.pos.x, c.top[2] - e.pos.z) < 2.5 && Math.abs(e.pos.y - c.top[1]) < 2) return { label: 'Climb down', act: () => { e.pos.set(c.x, this.phys.support(c.x, c.z, 0.3, c.y + 2), c.z); } };
    }
    // loot
    const near = this.loot.near(e.pos, 2.2);
    if (near.length) {
      const f = new THREE.Vector3(-Math.sin(e.yaw), 0, -Math.cos(e.yaw));
      near.sort((a, b) => score(a) - score(b));
      function score(l) { const d = new THREE.Vector3(l.x - e.pos.x, 0, l.z - e.pos.z); const L = d.length(); return L - (L > 0.01 ? d.divideScalar(L).dot(f) : 1) * 1.2; }
      const l = near[0];
      if (l.crate) return { label: `Open ${l.crate === 'air' ? "Amma's Tiffin (airdrop)" : 'crate'} [Tab]`, act: () => this.toggleInventory(true) };
      return { label: `Pick up ${itemName(l.item, this.map)}${l.item.n > 1 ? ' ×' + l.item.n : ''}`, act: () => this.pickupFromGround(l.lid) };
    }
    return null;
  }

  pickupFromGround(lid, idx) {
    const e = this.me, l = this.loot.entries.get(lid);
    if (!l || !e.alive) return;
    const it = l.crate ? l.items[idx ?? 0] : l.item;
    if (!it) return;
    const res = e.pickup(it);
    if (!res.taken) { this.toast(it.type === 'helmet' || it.type === 'vest' || it.type === 'pack' ? 'You already have better gear' : 'Not enough space'); return; }
    audio.click('pickup');
    if (l.crate) {
      l.items.splice(idx ?? 0, 1);
      if (res.left) l.items.splice(idx ?? 0, 0, res.left);
      this._emit({ t: 'ctake', lid, i: idx ?? 0, left: res.left || null });
    } else {
      this.loot.remove(lid);
      this._emit({ t: 'take', lid });
      if (res.left) this._dropAt(res.left, l.x, l.y, l.z);
    }
    for (const d of res.dropped) this._dropAt(d, e.pos.x + (Math.random() - 0.5), e.pos.y, e.pos.z + (Math.random() - 0.5));
    this.syncGear(e);
    if (it.type === 'gun' && WEAPONS[it.id].crate === undefined && e.gun && e.gun.mag === 0) this.player.startReload();
  }
  botPickup(e, l) {
    if (!this.loot.entries.has(l.lid) || l.crate) return;
    const res = e.pickup(l.item);
    if (!res.taken) return;
    this.loot.remove(l.lid);
    this._emit({ t: 'take', lid: l.lid });
    if (e.gun && !e.gun.mag && e.W.ammo) { const need = e.magSize(e.gun); e.gun.mag = e.takeItems('ammo', e.W.ammo, need); }
    this.syncGear(e);
  }
  botLootTick(e, rng) {
    // bots sweep rooms off-screen: grant tiered loot over time
    const tier = rng() < 0.2 ? 1 : 0;
    const items = rollLoot(rng, tier, {}, this.map);
    if (!e.weapons[0] && rng() < 0.85) items.push({ type: 'gun', id: rng.pick(['m416', 'akm', 'ump', 'scar', 'mini14', 's12k', 'vector', 'kar98k']) });
    for (const it of items) {
      e.pickup(it);
      if (it.type === 'gun') { const W = WEAPONS[it.id]; if (W.ammo) { e.pickup({ type: 'ammo', id: W.ammo, n: 60 }); const g = e.weapons.find((q) => q && q.id === it.id); if (g) g.mag = e.takeItems('ammo', W.ammo, e.magSize(g)); } }
    }
    if (e.cur < 0 && e.weapons[0]) e.cur = 0;
    this.syncGear(e);
  }
  _dropAt(item, x, y, z) {
    const lid = 'D' + this.me.id + ':' + this.dropN++;
    this.loot.add(lid, item, x, y, z);
    this._emit({ t: 'drop', lid, it: item, x, y, z });
  }
  dropItem(i) { const e = this.me, it = e.items[i]; if (!it) return; e.items.splice(i, 1); this._dropAt(it, e.pos.x, e.pos.y, e.pos.z); audio.click('pickup'); }
  dropGun(s) { const e = this.me; const out = e.unequipGun(s); out.forEach((it) => this._dropAt(it, e.pos.x + (Math.random() - 0.5), e.pos.y, e.pos.z + (Math.random() - 0.5))); this.syncGear(e); }
  dropGear(k) { const e = this.me; if (!e[k]) return; const it = { type: k, level: e[k].level, dur: e[k].dur }; e[k] = null; if (e.used() > e.capacity()) { this.toast('Too much in your bag to drop that'); e[k] = { level: it.level, dur: it.dur }; return; } this._dropAt(it, e.pos.x, e.pos.y, e.pos.z); this.syncGear(e); }
  detach(s, slot) { const e = this.me, g = e.weapons[s]; if (!g || !g.att[slot]) return; const a = { type: 'att', id: g.att[slot] }; delete g.att[slot]; if (e.fits(a)) e.items.push(a); else this._dropAt(a, e.pos.x, e.pos.y, e.pos.z); this.syncGear(e); }
  autoAttach(it) { const e = this.me; for (const s of [e.cur, 0, 1, 2]) { if (s < 0 || s > 2 || !e.weapons[s] || !e.canAttach(s, it.id)) continue; e.attach(s, it.id); this.syncGear(e); return; } this.toast('No weapon fits that attachment'); }

  syncGear(e) {
    const a = e.avatar; if (!a) return;
    const g = e.gun;
    const key = (g ? g.id + JSON.stringify(g.att) : e.cur === 4 ? e.throwId : '') + '|' + (e.helmet?.level || 0) + (e.vest?.level || 0) + (e.pack?.level || 0) + '|' + (e.weapons[0]?.id || '') + (e.weapons[1]?.id || '');
    if (key === e._gearKey) return;
    e._gearKey = key;
    a.setWeapon(g ? g.id : e.cur === 4 ? e.throwId : null, g ? g.att : {});
    a.setGear('helmet', e.helmet?.level || 0); a.setGear('vest', e.vest?.level || 0); a.setGear('pack', e.pack?.level || 0);
    a.setBackGuns([0, 1].map((s) => (e.weapons[s] && s !== e.cur ? e.weapons[s].id : null)));
  }

  // ================================================================== vehicles
  enterVehicle(e, v) {
    let s = v.seats.findIndex((q) => !q);
    if (s < 0) return;
    v.seats[s] = e; e.vehicle = v; e.seat = s; e.mode = s === 0 ? 'drive' : 'ride'; e.stance = 'stand'; e.reload = null;
    if (s === 0) { v.remote = null; v.owner = e.id; }
    this._emit({ t: 'seat', v: v.id, id: e.id, s });
    audio.click('ui');
    if (e === this.me) this.hud.toast(`${v.S.name} · W/S throttle · A/D steer · Space brake · H horn · F exit`, '');
  }
  changeSeat(e, s) {
    const v = e.vehicle; if (!v || s >= v.seats.length || v.seats[s]) return;
    v.seats[e.seat] = null; v.seats[s] = e; e.seat = s; e.mode = s === 0 ? 'drive' : 'ride';
    this._emit({ t: 'seat', v: v.id, id: e.id, s });
  }
  exitVehicle(e) {
    const v = e.vehicle; if (!v) return;
    this._leaveVehicle(e);
    const side = new THREE.Vector3(Math.cos(v.yaw), 0, -Math.sin(v.yaw)).multiplyScalar(v.S.w / 2 + 0.8);
    const p = v.pos.clone().add(side);
    e.pos.set(p.x, this.phys.support(p.x, p.z, 0.3, v.pos.y + 2), p.z);
    e.vel.set(0, 0, 0); e.mode = 'ground';
    if (Math.abs(v.speed) > 8) this.damage(e, Math.abs(v.speed) * 2, null, 'fall');
  }
  _leaveVehicle(e) {
    const v = e.vehicle; if (!v) return;
    v.seats[e.seat] = null; e.vehicle = null; e.seat = -1;
    if (e.mode !== 'dead') e.mode = 'ground';
    this._emit({ t: 'seat', v: v.id, id: e.id, s: -1 });
  }
  horn(v) {
    if (this.map.mechanics.noHonk) { this.toast('Horn disabled. This is Aizawl. Nobody honks here.'); this._specialEgg('nohonk', 'No Honking', 'You tried to honk in Aizawl. The entire city judged you silently.'); return; }
    audio.horn(v.pos); this._emit({ t: 'horn', v: v.id });
  }
  _roadkill(v) {
    const drv = v.driver;
    if (!drv || Math.abs(v.speed) < 6 || !(drv.isLocal || (drv.isBot && this.isHost))) return;
    const f = v.fwd(new THREE.Vector3());
    for (const t of this.entities.values()) {
      if (!t.alive || t.vehicle || t.team === drv.team) continue;
      const d = t.pos.clone().sub(v.pos);
      const along = d.dot(f), side = Math.abs(d.x * -f.z + d.z * f.x);
      if (along > 0 && along < v.S.len / 2 + 0.6 && side < v.S.w / 2 + 0.3 && Math.abs(d.y) < 2) {
        this._onBulletHit({ shooter: { id: drv.id, team: drv.team }, w: 'vehicle', dmg: Math.abs(v.speed) * 6, explosive: true }, t, 'body', t.pos, 0);
        v.speed *= 0.7;
      }
    }
  }
  _vehicleExplode(v) {
    const p = v.pos.clone(); p.y += 1;
    this.combat.explode({ p, type: 'frag', mesh: new THREE.Object3D(), shooter: { id: v.owner || 'world', team: null }, sim: v.driver ? v.driver.isLocal : this.isHost });
    for (const occ of v.seats) if (occ && (occ.isLocal || (occ.isBot && this.isHost))) this.damage(occ, 120, null, 'vehicle');
  }

  // ================================================================== airdrops
  _spawnAirdrop(z) {
    const rng = Math.random;
    const a = rng() * 6.283, r = Math.sqrt(rng()) * z.next.r * 0.8;
    const x = clamp(z.next.x + Math.cos(a) * r, -HALF + 60, HALF - 60), zz = clamp(z.next.z + Math.sin(a) * r, -HALF + 60, HALF - 60);
    const id = 'AD' + Math.floor(this.time);
    const ad = { t: 'ad', id, x, z: zz, t0: this.time, seed: Math.floor(Math.random() * 1e9) };
    this._emit(ad); this._addAirdrop(ad);
  }
  _addAirdrop(ad) {
    if (this.airdrops.some((q) => q.id === ad.id)) return;
    const m = airdropModel();
    const g = this.phys.support(ad.x, ad.z, 0.5, 400);
    const o = { ...ad, g, y: g + 260, m, landed: false };
    m.position.set(ad.x, o.y, ad.z);
    this.scene.add(m);
    this.airdrops.push(o);
    this.hud.toast("Amma's Tiffin is falling from the sky! (airdrop)", 'zone', 'Check the map for the pink marker');
  }
  _airdrops(dt) {
    for (const a of this.airdrops) {
      if (a.landed) { if (Math.random() < dt * 25) this.combat.fx.emit(a.x + 1.5, a.g + 0.3, a.z, (Math.random() - 0.5) * 0.4, 2.2, (Math.random() - 0.5) * 0.4, 0.9, 0.12, 0.2, 0.7, 1.2, 5, 1.2); continue; }
      a.y -= dt * 9;
      a.m.position.y = a.y;
      if (a.y <= a.g) {
        a.landed = true; a.m.getObjectByName('chute').visible = false; a.m.position.y = a.g;
        this.scene.remove(a.m);
        this.loot.crate(a.id, airdropLoot(mulberry32(a.seed)), a.x, a.g, a.z, 'air');
      }
    }
  }

  // ================================================================== network
  _emit(ev) { if (net.mode !== 'offline') this.outbox.push(ev); }
  pubEvent(ev) { this._emit(ev); }
  get net() { return this; }

  _net(dt) {
    if (net.mode === 'offline') return;
    const ch = 'm:' + this.matchId;
    this.stT -= dt; this.flushT -= dt; this.botT -= dt; this.clkT -= dt;
    if (this.stT <= 0) { this.stT = 1 / 15; net.pub(ch, { t: 'st', ...this.me.snap() }); }
    if (this.isHost && this.botT <= 0 && this.brains.size) { this.botT = 1 / 8; net.pub(ch, { t: 'bots', list: [...this.brains.values()].filter((b) => b.e.alive || !b.sentDead).map((b) => { if (!b.e.alive) b.sentDead = true; return b.e.snap(); }) }); }
    if (this.isHost && this.clkT <= 0) { this.clkT = 1; net.pub(ch, { t: 'clk', mt: this.time, ph: this.phase, wl: this.warmupLeft, ps: this.plane.start, roster: [...this.roster.values()] }); }
    // vehicle state from whoever drives
    this._vT = (this._vT || 0) - dt;
    if (this._vT <= 0) { this._vT = 1 / 12; for (const v of this.vehicles.values()) { const d = v.driver; if (d && (d === this.me || (d.isBot && this.isHost))) net.pub(ch, { t: 'veh', ...v.snap() }); } }
    if (this.flushT <= 0 && this.outbox.length) { this.flushT = 0.05; net.pub(ch, { t: 'b', from: this.me.id, ev: this.outbox.splice(0) }); }
    // host migration: lost the host's clock for 5 s
    if (!this.isHost && this.phase !== 'loading' && this.time - this.lastClk > 6 && this.lastClk > 0) {
      const humans = [...this.roster.keys()].filter((id) => id !== this.hostId && this.entities.has(id)).sort();
      if (humans[0] === this.me.id) { this.isHost = true; this.hostId = this.me.id; this.hud.toast('Host left. You are now hosting the bots.'); const rng = mulberry32(Date.now()); for (const e of this.entities.values()) if (e.isBot && e.alive) this._makeBrain(e, rng); }
      else this.lastClk = this.time;
    }
  }

  _onNet(m) {
    if (m.id === this.me.id && m.t !== 'b') return;
    switch (m.t) {
      case 'hello': {
        if (!this.isHost) return;
        if (this.phase !== 'warmup') { net.pub('m:' + this.matchId, { t: 'reject', to: m.id, why: 'Match already in progress' }); return; }
        const team = this._teamFor(m.id);
        this.roster.set(m.id, { id: m.id, name: m.name, outfit: m.outfit, cos: m.cos, team });
        this._rosterSync();
        this.hud.toast(`${m.name} joined the match`);
        break;
      }
      case 'reject': if (m.to === this.me.id) { this.toast('Could not join: ' + m.why); this.quit(); } break;
      case 'clk': {
        this.lastClk = this.time;
        if (m.roster) for (const r of m.roster) if (!this.roster.has(r.id)) this.roster.set(r.id, r);
        if (m.roster) this._rosterSync(m.roster);
        if (Math.abs(this.time - m.mt) > 0.25) this.time = m.mt + 0.05;
        if (this.phase === 'warmup' && m.ph === 'warmup') this.warmupLeft = m.wl;
        if (this.phase === 'warmup' && (m.ph === 'plane' || m.ph === 'battle')) this.startPlane(m.ps);
        break;
      }
      case 'st': {
        let e = this.entities.get(m.id);
        if (!e) { const r = this.roster.get(m.id); if (!r) return; e = this._addEntity({ id: m.id, name: r.name, outfit: r.outfit, cosmetic: r.cos, team: r.team }); }
        this._applySnap(e, m);
        break;
      }
      case 'bots': if (!this.isHost) for (const s of m.list) { const e = this.entities.get(s.id); if (e) this._applySnap(e, s); } break;
      case 'veh': { const v = this.vehicles.get(m.id); if (v && !(v.driver && (v.driver === this.me || (v.driver.isBot && this.isHost)))) v.netApply(m); break; }
      case 'b': for (const ev of m.ev) this._onEvent(ev, m.from); break;
      case 'bye': this.roster.delete(m.id); this._removeEntity(m.id); break;
      case 'end': this._end(m.team); break;
    }
  }
  _rosterSync(list) {
    const src = list || [...this.roster.values()];
    for (const r of src) {
      if (r.id === this.me.id) { if (r.team && this.me.team !== r.team) this.me.team = r.team; continue; }
      if (!this.entities.has(r.id)) { const e = this._addEntity({ id: r.id, name: r.name, outfit: r.outfit, cosmetic: r.cos, team: r.team }); e.avatar.root.visible = true; e.mode = 'ground'; }
    }
    if (this.isHost) net.pub('m:' + this.matchId, { t: 'clk', mt: this.time, ph: this.phase, wl: this.warmupLeft, ps: this.plane.start, roster: [...this.roster.values()] });
  }
  _applySnap(e, s) {
    e.net.target = { p: new THREE.Vector3(...s.p), y: s.y, pi: s.pi };
    e.stance = { s: 'stand', c: 'crouch', p: 'prone' }[s.st] || 'stand';
    if (e.mode !== 'dead' || s.m !== 'dead') e.mode = s.m;
    e.speed = s.sp; e.fwd = s.f; e.side = s.s; e.aiming = !!s.a;
    if (!e.alive && s.m !== 'dead' && this.phase === 'warmup') e.alive = true;
    e.hp = s.h; e.knocked = !!s.k;
    const g = s.g;
    const cur = e.gun;
    if ((cur ? cur.id : null) !== g || JSON.stringify(cur ? cur.att : null) !== JSON.stringify(s.ga)) {
      if (g) { e.weapons[0] = { id: g, att: s.ga || {}, mag: 30, mode: 0 }; e.cur = 0; } else { e.cur = -1; }
    }
    e.helmet = s.he ? { level: s.he, dur: 100 } : null; e.vest = s.ve ? { level: s.ve, dur: 100 } : null; e.pack = s.pa ? { level: s.pa } : null;
    e.reload = s.rl ? (e.reload || { t: 0, dur: 2 }) : null;
    if (s.bg) { e._bg = s.bg; }
    this.syncGear(e);
    if (e.avatar && s.bg) e.avatar.setBackGuns(s.bg.map((id) => (id && id !== g ? id : null)));
    if (e.mode !== 'plane') e.avatar.root.visible = true;
  }
  _interp(e, dt) {
    const T = e.net.target;
    if (!T) return;
    const k = Math.min(1, dt * 12);
    if (e.pos.distanceTo(T.p) > 12) e.pos.copy(T.p); else e.pos.lerp(T.p, k);
    let dy = T.y - e.yaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
    e.yaw += dy * k; e.pitch += (T.pi - e.pitch) * k;
    if (e.reload) e.reload.t += dt;
  }

  _onEvent(ev, from) {
    const E = (id) => this.entities.get(id);
    switch (ev.t) {
      case 'start': this.time = ev.mt; this.startPlane(ev.ps); break;
      case 'shot': {
        const e = E(ev.id); if (!e) return;
        const o = new THREE.Vector3(...ev.o), d = new THREE.Vector3(...ev.d);
        this.combat.fire({ id: ev.id, team: e.team }, o, d, ev.w, { sim: false, muzzle: e.avatar && e.avatar.gun ? e.avatar.muzzle(new THREE.Vector3()) : o, suppressed: !!ev.s });
        if (e.avatar) e.avatar.kick = 1;
        break;
      }
      case 'hit': { const t = E(ev.to); if (t && (t.isLocal || (t.isBot && this.isHost))) this.applyHit(t, ev.raw, ev.part, ev.w, ev.by, ev.p && new THREE.Vector3(...ev.p)); break; }
      case 'hp': { const t = E(ev.id); if (t && !t.isLocal && !(t.isBot && this.isHost)) { t.hp = ev.hp; t.knocked = !!ev.k; t.bleed = ev.bl; t.helmet = ev.he ? { level: ev.he, dur: 100 } : null; t.vest = ev.ve ? { level: ev.ve, dur: 100 } : null; this.syncGear(t); } break; }
      case 'knock': { const t = E(ev.id); if (t && !t.isLocal) { t.knocked = true; const by = E(ev.by); this.hud.killfeed(by ? by.name : '', t.name, 'knocked', false, by === this.me, 'knocked'); } break; }
      case 'revived': { const t = E(ev.id); if (t) { t.knocked = false; t.reviving = null; } break; }
      case 'reviving': { const t = E(ev.id); if (t && (t.isLocal || (t.isBot && this.isHost))) t.reviving = { t: 0, by: ev.by }; break; }
      case 'dead': { const t = E(ev.id); if (t && t.alive) this._kill(t, ev.by, ev.w, !!ev.head, true); break; }
      case 'take': this.loot.remove(ev.lid); break;
      case 'drop': this.loot.add(ev.lid, ev.it, ev.x, ev.y, ev.z); break;
      case 'crate': this.loot.crate(ev.lid, ev.items, ev.x, ev.y, ev.z); break;
      case 'ctake': { const l = this.loot.entries.get(ev.lid); if (l && l.items) { l.items.splice(ev.i, 1); if (ev.left) l.items.splice(ev.i, 0, ev.left); } break; }
      case 'seat': {
        const v = this.vehicles.get(ev.v), e = E(ev.id); if (!v || !e) return;
        const old = v.seats.indexOf(e); if (old >= 0) v.seats[old] = null;
        if (ev.s >= 0) { v.seats[ev.s] = e; e.vehicle = v; e.seat = ev.s; } else { e.vehicle = null; e.seat = -1; if (v.driver == null) v.remote = v.remote; }
        break;
      }
      case 'vdmg': { const v = this.vehicles.get(ev.v); if (v && v.driver && (v.driver === this.me)) v.hp = Math.min(v.hp, ev.hp); break; }
      case 'nade': { const e = E(ev.id); this.combat.throw({ id: ev.id, team: e ? e.team : null }, new THREE.Vector3(...ev.p), new THREE.Vector3(...ev.v), ev.k, false); break; }
      case 'melee': { const e = E(ev.id); if (e && e.avatar) e.avatar.kick = 2; break; }
      case 'jump': { const e = E(ev.id); if (e) { e.mode = 'freefall'; e.avatar.root.visible = true; } break; }
      case 'chute': break;
      case 'rl': break;
      case 'horn': { const v = this.vehicles.get(ev.v); if (v) audio.horn(v.pos); break; }
      case 'ad': this._addAirdrop(ev); break;
      case 'chat': this.hud.chat(ev.name, ev.text, ev.team); break;
      case 'mark': this.teamMarkers.set(ev.id, ev.mk); break;
    }
  }

  sendChat(text) {
    this.hud.chat(this.me.name, text, false);
    this._emit({ t: 'chat', name: this.me.name, text: text.slice(0, 120) });
  }
  shareMarker(mk) { this._emit({ t: 'mark', id: this.me.id, mk }); }

  // ================================================================== input + UI
  _keys() {
    this._onKey = (ev) => {
      if (this.phase === 'loading') return;
      if (ev.target && ev.target.tagName === 'INPUT' && ev.target.offsetParent !== null) return;
      if (ev.code === 'Tab') { ev.preventDefault(); this.toggleInventory(!this.ui.inv); }
      else if (ev.code === 'KeyM') this.toggleMap(!this.ui.map);
      else if (ev.code === 'Escape') { if (this.ui.inv) this.toggleInventory(false); else if (this.ui.map) this.toggleMap(false); else this.togglePause(!this.ui.pause); }
      else if (ev.code === 'Enter' && !this.ui.chat) {
        if (this.phase === 'warmup' && this.isHost) { this.warmupLeft = Math.min(this.warmupLeft, 3); }
        else this.hud.chatOpen(true);
      } else if (ev.code === 'KeyT' && !this.ui.chat) { this.hud.chatOpen(true); ev.preventDefault(); }
      else if (ev.code === 'Equal') this.autoRun = !this.autoRun;
      else if (ev.code === 'KeyK') this.hud.toggleHints();
    };
    addEventListener('keydown', this._onKey);
    this._onClick = () => {
      if (this.uiOpen) return;
      if (this.me.mode === 'dead' && this.spectate) { const mates = [...this.entities.values()].filter((q) => q.alive && (q.team === this.me.team || !this._endShown)); if (mates.length) { const i = (mates.indexOf(this.spectate) + 1) % mates.length; this.spectate = mates[i]; this.hud.spectate(this.spectate.name); } }
      this.input.lock();
    };
    this.renderer.domElement.addEventListener('click', this._onClick);
    const $ = (id) => document.getElementById(id);
    $('btn-resume').onclick = () => { this.togglePause(false); this.input.lock(); };
    $('btn-quit').onclick = () => this.quit();
    $('btn-lobby').onclick = () => this.quit();
    $('btn-spec').onclick = () => { this.hud.hideEnd(); this.setUi('end', false); const alive = [...this.entities.values()].filter((q) => q.alive); this.spectate = alive[0] || null; if (this.spectate) this.hud.spectate(this.spectate.name); };
    $('btn-controls').onclick = () => $('controls-card').classList.toggle('show');
    $('btn-psettings').onclick = () => this.onSettings && this.onSettings();
    $('controls-card').innerHTML = [
      ['Mouse / Arrows', 'Look around'], ['WASD', 'Move'], ['Shift', 'Sprint'], ['Ctrl', 'Walk (quiet)'], ['Space', 'Jump / vault'], ['C / Z', 'Crouch / prone'], ['Mouse L', 'Fire'], ['Mouse R', 'Aim down sights'],
      ['R', 'Reload'], ['B', 'Fire mode'], ['1-4', 'Weapons'], ['5 / G', 'Throwable'], ['X', 'Holster'], ['7 8 9', 'Bandage / First aid / Med kit'], ['0', 'Boost / food'],
      ['F / E', 'Interact · jump from plane (or Space) · open chute'], ['K', 'Show / hide the controls panel'], ['Tab', 'Inventory'], ['M', 'Map (right-click to mark)'], ['V', 'First / third person'], ['Alt', 'Free look'], ['T / Enter', 'Chat'], ['=', 'Auto-run'], ['H', 'Horn'],
    ].map(([k, v]) => `<kbd>${k}</kbd><span>${v}</span>`).join('');
  }
  _inputKeys() {}
  setUi(k, on) {
    this.ui[k] = on;
    this.uiOpen = Object.values(this.ui).some(Boolean);
    this.input.enabled = !this.uiOpen;
    if (this.uiOpen) this.input.unlock();
  }
  toggleInventory(on) { if (!this.me.alive && on) return; this.hud.toggleInventory(on); this.setUi('inv', on); if (!on) this.input.lock(); }
  toggleMap(on) { this.hud.toggleMap(on); this.setUi('map', on); if (!on) this.input.lock(); }
  togglePause(on) { document.getElementById('pause').classList.toggle('show', on); this.setUi('pause', on); }
  toast(t, k) { this.hud.toast(t, k); }

  quit() {
    if (this._quit) return;
    this._quit = true;
    net.pub('m:' + this.matchId, { t: 'bye', id: this.me.id });
    if (this.isPublic && this.isHost && this.social) this.social.unadvertise(this.matchId);
    this.dispose();
    this.onExit && this.onExit();
  }
  dispose() {
    net.unsub('m:' + this.matchId);
    removeEventListener('keydown', this._onKey);
    this.renderer.domElement.removeEventListener('click', this._onClick);
    this.input.dispose(); this.input.unlock();
    audio.stopAll();
    this.hud.show(false); this.hud.hideEnd();
    for (const id of ['inventory', 'bigmap', 'pause']) document.getElementById(id).classList.remove('show');
    this.combat.dispose(); this.loot.dispose();
    this.world.dispose();
    this.scene.clear();
    this.scene.environment = null; this.scene.background = null; this.scene.fog = null;
    if (this.envRT) this.envRT.dispose();
  }
}

const v3 = (v, d = 2) => [+v.x.toFixed(d), +v.y.toFixed(d), +v.z.toFixed(d)];

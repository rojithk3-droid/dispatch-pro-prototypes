// In-match HUD (DOM): vitals, gear, ammo, compass, minimap, big map, killfeed, hit markers, damage
// direction, prompts, inventory screen, easter-egg cards, chat, spectate, end screen.
import { WEAPONS, ATTACHMENTS, AMMO, itemName, MEDS, BOOSTS, THROWS } from './weapons.js';
import { fmtTime, clamp } from './util.js';
import { HALF } from './physics.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ICON = {
  helmet: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3C7 3 3.5 6.8 3.5 12v3h17v-3C20.5 6.8 17 3 12 3zm-9 13.5h18V19H3z"/></svg>',
  vest: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 2l-4 3v15h7v-6h2v6h7V5l-4-3-2 4h-4z"/></svg>',
  pack: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 2h6v2h2a3 3 0 013 3v13a2 2 0 01-2 2H6a2 2 0 01-2-2V7a3 3 0 013-3h2zm-1 11v5h8v-5z"/></svg>',
};

// key chips: [labels shown, key codes that light them up, action text]
const K = (keys, codes, t, wide) => ({ keys, codes, t, wide });
const MOVE = [K(['W', 'A', 'S', 'D'], ['KeyW', 'KeyA', 'KeyS', 'KeyD'], 'Move'), K(['Shift'], ['ShiftLeft'], 'Sprint'), K(['Space'], ['Space'], 'Jump / vault'), K(['Ctrl'], ['ControlLeft'], 'Walk quietly'),
  K(['C'], ['KeyC'], 'Crouch'), K(['Z'], ['KeyZ'], 'Prone'), K(['Mouse', '←→↑↓'], ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'], 'Look around', true)];
const GUN = [K(['LMB'], ['LMB'], 'Fire'), K(['RMB'], ['RMB'], 'Aim (ADS)'), K(['R'], ['KeyR'], 'Reload'), K(['B'], ['KeyB'], 'Fire mode'),
  K(['1', '2'], ['Digit1', 'Digit2'], 'Main guns'), K(['3', '4'], ['Digit3', 'Digit4'], 'Pistol / tawa'), K(['G'], ['KeyG', 'Digit5'], 'Grenade'), K(['X'], ['KeyX'], 'Holster')];
const ITEMS = [K(['F'], ['KeyF', 'KeyE'], 'Pick up / use'), K(['Tab'], ['Tab'], 'Inventory'), K(['7', '8', '9'], ['Digit7', 'Digit8', 'Digit9'], 'Heal'), K(['0'], ['Digit0'], 'Boost'),
  K(['M'], ['KeyM'], 'Map'), K(['V'], ['KeyV'], '1st / 3rd person'), K(['Alt'], ['AltLeft'], 'Free look'), K(['T'], ['KeyT'], 'Chat')];

export class HUD {
  constructor(match) {
    this.m = match;
    this.el = $('hud');
    this.mm = $('minimap').getContext('2d');
    this.bm = $('bigmap-c').getContext('2d');
    this.hitT = 0; this.eggT = 0; this.msgT = 0; this.marker = null;
    this.feed = [];
    this._buildCompass();
    $('bigmap-c').oncontextmenu = (ev) => {
      ev.preventDefault();
      const r = ev.target.getBoundingClientRect();
      const x = ((ev.clientX - r.left) / r.width) * HALF * 2 - HALF, z = ((ev.clientY - r.top) / r.height) * HALF * 2 - HALF;
      this.marker = this.marker && Math.hypot(this.marker.x - x, this.marker.z - z) < 12 ? null : { x, z };
      this.m.shareMarker(this.marker);
      this.drawBigMap();
    };
    $('chat-hud-in').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { const v = e.target.value.trim(); if (v) this.m.sendChat(v); e.target.value = ''; this.chatOpen(false); }
      if (e.key === 'Escape') this.chatOpen(false);
      e.stopPropagation();
    });
    this.show(true);
  }
  show(on) { this.el.classList.toggle('show', on); }

  _buildCompass() {
    const s = $('compass-strip'); s.innerHTML = '';
    const names = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    for (let rep = -1; rep <= 1; rep++) for (let d = 0; d < 360; d += 15) {
      const sp = document.createElement('span');
      const x = (d + rep * 360) * 4;
      sp.style.left = x + 'px';
      if (names[d] !== undefined) { sp.textContent = names[d]; if (d % 90 === 0) sp.className = 'c'; }
      else sp.textContent = d;
      if (d % 45 && d % 15 === 0) sp.style.fontSize = '10px', sp.style.opacity = 0.6;
      s.appendChild(sp);
    }
    this.cmk = document.createElement('span'); this.cmk.className = 'mk'; this.cmk.textContent = '▼'; s.appendChild(this.cmk);
    this.czn = document.createElement('span'); this.czn.className = 'zn'; this.czn.textContent = '◆'; s.appendChild(this.czn);
  }

  // --------------------------------------------------------------- per frame
  update(dt) {
    const m = this.m, e = m.me, P = m.player;
    if (!e) return;
    // compass: heading 0 = north (-z), clockwise
    const hd = ((-(e.yaw + (P ? P.freeLook : 0)) * 180 / Math.PI) % 360 + 360) % 360;
    $('compass-strip').style.transform = `translateX(${260 - hd * 4}px)`;
    const bearing = (x, z) => { let b = Math.atan2(x - e.pos.x, -(z - e.pos.z)) * 180 / Math.PI; b = (b + 360) % 360; if (b - hd > 180) b -= 360; if (hd - b > 180) b += 360; return b * 4; };
    if (this.marker) { this.cmk.style.display = ''; this.cmk.style.left = bearing(this.marker.x, this.marker.z) + 'px'; } else this.cmk.style.display = 'none';
    const zs = m.zoneState;
    if (zs && Math.hypot(e.pos.x - zs.next.x, e.pos.z - zs.next.z) > zs.next.r) { this.czn.style.display = ''; this.czn.style.left = bearing(zs.next.x, zs.next.z) + 'px'; } else this.czn.style.display = 'none';
    // counters
    $('alive-n').textContent = m.aliveCount();
    $('kills-n').textContent = e.kills;
    // vitals
    const hpEl = $('hp');
    const hp = e.knocked ? e.bleed : e.hp;
    $('hp-fill').style.width = clamp(hp, 0, 100) + '%';
    $('hp-ghost').style.width = clamp(hp, 0, 100) + '%';
    hpEl.className = e.knocked ? 'knock' : hp < 25 ? 'low' : hp < 55 ? 'mid' : '';
    const b = $('boost').children, segs = [20, 60, 90, 100];
    for (let i = 0; i < 4; i++) b[i].className = e.boost > (i ? segs[i - 1] : 0) + 0.5 ? 'on' : '';
    $('stam-fill').style.width = e.stamina + '%';
    $('stam').style.opacity = e.stamina < 99 ? 1 : 0.2;
    // gear
    const gi = ['helmet', 'vest', 'pack'].map((k) => {
      const g = e[k];
      const dur = g && k !== 'pack' ? `<span class="dur"><i style="width:${clamp(g.dur ?? 100, 0, 100)}%"></i></span>` : '';
      return `<div class="gi ${g ? 'l' + g.level : 'none'}">${ICON[k]}${g ? g.level : '-'}${dur}</div>`;
    }).join('');
    if (gi !== this._gi) { $('gear-icons').innerHTML = gi; this._gi = gi; }
    // weapon
    const g = e.gun, W = e.W;
    if (g && W.ammo) {
      $('ammo-mag').textContent = e.reload ? '··' : g.mag;
      $('ammo-res').textContent = e.ammo(W.ammo);
      $('ammo').className = g.mag === 0 ? 'empty' : '';
      $('gun-name').innerHTML = esc(W.name) + `<em>${W.modes[g.mode].toUpperCase()}</em>`;
    } else if (e.cur === 4) { $('ammo-mag').textContent = e.count('throw', e.throwId); $('ammo-res').textContent = ''; $('gun-name').textContent = THROWS[e.throwId]?.name || ''; }
    else { $('ammo-mag').textContent = g ? '∞' : '--'; $('ammo-res').textContent = ''; $('gun-name').textContent = g ? W.name : 'FISTS'; }
    const sl = [0, 1, 2, 3].map((i) => `<span class="sl ${e.cur === i ? 'on' : ''}">${i + 1} ${e.weapons[i] ? WEAPONS[e.weapons[i].id].name : '—'}</span>`).join('');
    if (sl !== this._sl) { $('slots').innerHTML = sl; this._sl = sl; }
    // crosshair spread + scope
    const scoped = P && P.scoped;
    $('scope').style.display = scoped ? 'block' : 'none';
    const ch = $('crosshair');
    const ads = P && P.adsK > 0.6;
    ch.style.display = scoped || (P && P.vm.show && ads) || e.mode !== 'ground' && e.mode !== 'swim' ? 'none' : 'block';
    const sightM = P && P.vm.gun && P.vm.gun.userData.sight;
    const ret = P && P.vm.show && P.adsK > 0.85 ? (sightM ? sightM.userData.reticle || 'dot' : 'iron') : '';
    if (ret !== this._ret) { $('reticle').className = ret; this._ret = ret; }
    const sp = P ? Math.min(60, 4 + P.spreadDeg() * 7) : 6;
    ch.querySelector('.t').style.top = -(sp + 8) + 'px'; ch.querySelector('.b').style.top = sp + 'px';
    ch.querySelector('.l').style.left = -(sp + 8) + 'px'; ch.querySelector('.r').style.left = sp + 'px';
    // damage vignette
    const low = e.alive ? clamp(1 - hp / 45, 0, 1) : 0;
    const outside = zs && Math.hypot(e.pos.x - zs.x, e.pos.z - zs.z) > zs.r;
    $('vignette').style.background = outside ? `radial-gradient(ellipse at center, rgba(40,110,255,0.10) 40%, rgba(30,90,255,0.45) 100%)` : `radial-gradient(ellipse at center, transparent 50%, rgba(170,0,20,${0.55 * low + m.hurtFlash * 0.5}) 100%)`;
    m.hurtFlash = Math.max(0, m.hurtFlash - dt * 2);
    // zone info
    if (zs) {
      const zi = $('zone-info');
      $('zone-msg').textContent = zs.phase >= 7 ? 'FINAL ZONE' : zs.shrinking ? 'ZONE SHRINKING' : zs.phase === 0 ? 'ZONE APPEARS IN' : 'NEXT SHRINK IN';
      $('zone-t').textContent = fmtTime(zs.timeLeft);
      zi.classList.toggle('danger', !!outside);
    } else { $('zone-msg').textContent = m.phaseLabel || ''; $('zone-t').textContent = m.phaseTime != null ? fmtTime(m.phaseTime) : ''; }
    // mechanic meters
    const mech = [];
    if (m.map.mechanics.smog) mech.push(`AQI<b style="color:#ff5252">${980 + Math.floor(Math.sin(m.time * 0.3) * 15)}</b>`);
    if (m.map.mechanics.thinAir) mech.push(`O₂<b style="color:#7cc6ff">${Math.round(58 + e.stamina * 0.04)}%</b>`);
    if (m.map.mechanics.heat) mech.push(`HEAT<b style="color:#ffb000">${m.inSun ? '44°C' : '38°C'}</b>`);
    if (m.weatherLabel) mech.push(m.weatherLabel);
    const mh = mech.map((x) => `<div class="mech">${x}</div>`).join('');
    if (mh !== this._mh) { $('mech').innerHTML = mh; this._mh = mh; }
    // team
    const team = [...m.entities.values()].filter((q) => q.team === e.team && q !== e);
    const th = team.map((q) => `<div class="tm ${!q.alive ? 'dead' : q.knocked ? 'down' : ''}">${esc(q.name)}<div class="hb"><i style="width:${q.knocked ? q.bleed : q.hp}%"></i></div></div>`).join('');
    if (th !== this._th) { $('team').innerHTML = th; this._th = th; }
    // hit marker / egg / center message timers
    this.hitT -= dt; if (this.hitT <= 0) $('hitmarker').className = '';
    this.eggT -= dt; if (this.eggT <= 0) $('egg-card').classList.remove('on');
    this.msgT -= dt; if (this.msgT <= 0) $('center-msg').innerHTML = '';
    this._keyhints();
    this._lockhint();
    this._drawMinimap();
    if ($('bigmap').classList.contains('show')) { this._bmT = (this._bmT || 0) - dt; if (this._bmT <= 0) { this._bmT = 0.25; this.drawBigMap(); } }
  }

  // --------------------------------------------------------------- controls panel
  _hintSpec() {
    const m = this.m, e = m.me;
    const mode = e.mode, W = e.W;
    if (this.hintsMin) return { key: 'min', title: 'CONTROLS', groups: [] };
    switch (mode) {
      case 'plane': return { key: 'plane', title: 'IN THE PLANE', groups: [['DROP', [K(['F'], ['KeyF', 'Space', 'KeyE'], 'Jump out now', true), K(['Mouse', '←→↑↓'], ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'], 'Look around', true), K(['M'], ['KeyM'], 'Map: pick a spot', true)]]], note: 'Jump near a named place for good loot. Space or E also jump.' };
      case 'freefall': return { key: 'ff', title: 'SKYDIVING', groups: [['STEER', [K(['W'], ['KeyW'], 'Dive faster'), K(['S'], ['KeyS'], 'Slow down'), K(['A', 'D'], ['KeyA', 'KeyD'], 'Drift sideways'), K(['Mouse'], [], 'Aim your dive'), K(['F'], ['KeyF', 'Space', 'KeyE'], 'Open parachute', true)]]], note: 'Look down while holding W for maximum speed. The chute opens itself low down.' };
      case 'chute': return { key: 'chute', title: 'PARACHUTE', groups: [['STEER', [K(['W'], ['KeyW'], 'Glide far'), K(['S'], ['KeyS'], 'Brake'), K(['A', 'D'], ['KeyA', 'KeyD'], 'Sideways'), K(['Mouse'], [], 'Turn')]]] };
      case 'drive': return { key: 'drive', title: 'DRIVING', groups: [['VEHICLE', [K(['W'], ['KeyW'], 'Accelerate'), K(['S'], ['KeyS'], 'Brake / reverse'), K(['A', 'D'], ['KeyA', 'KeyD'], 'Steer'), K(['Space'], ['Space'], 'Handbrake'), K(['H'], ['KeyH'], 'Horn'), K(['F'], ['KeyF', 'KeyE'], 'Get out'), K(['Ctrl', '1-4'], ['ControlLeft'], 'Change seat', true)]]] };
      case 'ride': return { key: 'ride', title: 'PASSENGER', groups: [['SEAT', [K(['F'], ['KeyF', 'KeyE'], 'Get out'), K(['Ctrl', '1-4'], ['ControlLeft'], 'Change seat')]]] };
      case 'swim': return { key: 'swim', title: 'SWIMMING', groups: [['MOVE', [K(['W', 'A', 'S', 'D'], ['KeyW', 'KeyA', 'KeyS', 'KeyD'], 'Swim', true)]]], note: 'You can\'t shoot while swimming.' };
      case 'dead': return { key: 'dead', title: 'SPECTATING', groups: [['VIEW', [K(['Click'], ['LMB'], 'Next player'), K(['Esc'], ['Escape'], 'Menu')]]] };
    }
    if (e.knocked) return { key: 'knock', title: 'KNOCKED DOWN', groups: [['MOVE', [K(['W', 'A', 'S', 'D'], ['KeyW', 'KeyA', 'KeyS', 'KeyD'], 'Crawl to cover', true)]]], note: 'A squadmate can revive you with F.' };
    const warm = m.phase === 'warmup';
    const melee = W && W.cls === 'melee';
    const gunGroup = !W ? [K(['LMB'], ['LMB'], 'Punch'), K(['1-4'], ['Digit1'], 'Weapons')]
      : melee ? [K(['LMB'], ['LMB'], 'Swing the tawa'), K(['1', '2'], ['Digit1', 'Digit2'], 'Main guns'), K(['X'], ['KeyX'], 'Holster')] : GUN;
    const note = warm ? (m.isHost ? 'Warm-up: press Enter to start the drop now.' : 'Warm-up: the plane leaves when the timer ends.')
      : W ? null : 'Find a gun: walk up to loot and press F.';
    return { key: 'ground' + (W ? W.cls : 'none') + warm, title: (warm ? 'WARM-UP · ' : '') + (W ? W.name.toUpperCase() : 'NO GUN YET'),
      groups: [['MOVE', MOVE], [melee ? 'MELEE' : 'GUN', gunGroup], ['ITEMS', ITEMS]], note };
  }
  _keyhints() {
    const spec = this._hintSpec();
    const el = $('keyhints');
    if (spec.key !== this._hk) {
      this._hk = spec.key;
      el.className = this.hintsMin ? 'min' : '';
      el.innerHTML = `<div class="kh-t">${esc(spec.title)}<span>K ${this.hintsMin ? 'show' : 'hide'}</span></div>` +
        spec.groups.map(([g, items]) => `<div class="kh-g">${g}</div><div class="kh-grid">` + items.map((it) => `<div class="kh ${it.wide ? 'wide' : ''}">${it.keys.map((k) => `<kbd data-c="${it.codes.join(' ')}">${esc(k)}</kbd>`).join('')}<span>${esc(it.t)}</span></div>`).join('') + '</div>').join('') +
        (spec.note ? `<div class="note">${esc(spec.note)}</div>` : '');
      this._kbds = [...el.querySelectorAll('kbd')];
    }
    const I = this.m.input;
    for (const k of this._kbds || []) {
      const codes = k.dataset.c ? k.dataset.c.split(' ') : [];
      const on = codes.some((c) => (c === 'LMB' ? I.lmb : c === 'RMB' ? I.rmb : I.keys.has(c)));
      if (on !== k._on) { k._on = on; k.classList.toggle('on', on); }
    }
  }
  toggleHints() { this.hintsMin = !this.hintsMin; this._hk = null; }
  _lockhint() {
    const m = this.m, I = m.input, el = $('lockhint');
    let mode = '';
    if (!m.uiOpen && !I.locked && m.phase !== 'loading') mode = I.lockFailed ? 'soft' : 'hard';
    if (mode !== this._lm) {
      this._lm = mode;
      el.className = mode ? 'show ' + (mode === 'soft' ? 'soft' : '') : '';
      el.innerHTML = mode === 'hard' ? '<div class="big">CLICK TO PLAY</div><div class="sm">Click the game to capture the mouse for aiming · Esc releases it</div>'
        : mode === 'soft' ? '<div class="big">Mouse capture is blocked here. Move the mouse over the game to look (right turns right), or use the arrow keys.</div>' : '';
    }
  }

  _drawMinimap() {
    const m = this.m, e = m.me, g = this.mm;
    const W = 220, span = 190;
    const img = m.world.minimap, S = img.width;
    const cx = e.pos.x, cz = e.pos.z;
    const sx = ((cx - span / 2 + HALF) / (HALF * 2)) * S, sz = ((cz - span / 2 + HALF) / (HALF * 2)) * S, ss = (span / (HALF * 2)) * S;
    g.fillStyle = '#0b1016'; g.fillRect(0, 0, W, W);
    g.drawImage(img, sx, sz, ss, ss, 0, 0, W, W);
    const tp = (x, z) => [((x - cx) / span + 0.5) * W, ((z - cz) / span + 0.5) * W];
    this._drawZones(g, tp, W / span);
    this._drawMarks(g, tp, 1);
    // me
    g.save(); g.translate(W / 2, W / 2); g.rotate(-e.yaw);
    g.fillStyle = '#ffb000'; g.beginPath(); g.moveTo(0, -8); g.lineTo(5, 5); g.lineTo(0, 2); g.lineTo(-5, 5); g.closePath(); g.fill();
    g.restore();
  }
  _drawZones(g, tp, k) {
    const zs = this.m.zoneState;
    if (!zs) return;
    const [zx, zz] = tp(zs.x, zs.z);
    g.save();
    g.fillStyle = 'rgba(30, 90, 255, 0.28)';
    g.beginPath(); g.rect(-50, -50, 5000, 5000); g.arc(zx, zz, zs.r * k, 0, Math.PI * 2, true); g.fill('evenodd');
    g.strokeStyle = '#4aa3ff'; g.lineWidth = 2; g.beginPath(); g.arc(zx, zz, zs.r * k, 0, Math.PI * 2); g.stroke();
    const [nx, nz] = tp(zs.next.x, zs.next.z);
    g.strokeStyle = '#ffffff'; g.lineWidth = 1.5; g.setLineDash([5, 4]); g.beginPath(); g.arc(nx, nz, zs.next.r * k, 0, Math.PI * 2); g.stroke();
    g.restore();
  }
  _drawMarks(g, tp, s) {
    const m = this.m, e = m.me;
    for (const q of m.entities.values()) {
      if (q === e || q.team !== e.team || !q.alive) continue;
      const [x, y] = tp(q.pos.x, q.pos.z);
      g.fillStyle = q.knocked ? '#ff4d5e' : '#2de2e6'; g.beginPath(); g.arc(x, y, 4 * s, 0, 7); g.fill();
    }
    for (const a of m.airdrops) { const [x, y] = tp(a.x, a.z); g.fillStyle = '#ff3f8e'; g.fillRect(x - 4 * s, y - 4 * s, 8 * s, 8 * s); }
    if (this.marker) { const [x, y] = tp(this.marker.x, this.marker.z); g.fillStyle = '#ff3f8e'; g.beginPath(); g.moveTo(x, y); g.lineTo(x - 5 * s, y - 10 * s); g.lineTo(x + 5 * s, y - 10 * s); g.fill(); }
    for (const [id, mk] of m.teamMarkers) { if (!mk) continue; const [x, y] = tp(mk.x, mk.z); g.fillStyle = '#2de2e6'; g.beginPath(); g.moveTo(x, y); g.lineTo(x - 4 * s, y - 8 * s); g.lineTo(x + 4 * s, y - 8 * s); g.fill(); }
    if (m.plane && m.plane.active) {
      const [ax, ay] = tp(m.plane.a.x, m.plane.a.z), [bx, by] = tp(m.plane.b.x, m.plane.b.z);
      g.strokeStyle = 'rgba(255,255,255,0.7)'; g.setLineDash([8, 6]); g.lineWidth = 2; g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke(); g.setLineDash([]);
      const [px, py] = tp(m.plane.pos.x, m.plane.pos.z); g.fillStyle = '#fff'; g.beginPath(); g.arc(px, py, 5 * s, 0, 7); g.fill();
    }
  }

  drawBigMap() {
    const m = this.m, g = this.bm, W = 900;
    g.drawImage(m.world.minimap, 0, 0, W, W);
    const tp = (x, z) => [((x + HALF) / (HALF * 2)) * W, ((z + HALF) / (HALF * 2)) * W];
    // grid
    g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 1;
    for (let i = 1; i < 8; i++) { g.beginPath(); g.moveTo((i * W) / 8, 0); g.lineTo((i * W) / 8, W); g.moveTo(0, (i * W) / 8); g.lineTo(W, (i * W) / 8); g.stroke(); }
    g.font = '700 18px Rajdhani, sans-serif'; g.textAlign = 'center';
    for (const p of m.world.places) {
      const [x, y] = tp(p.x, p.z);
      g.fillStyle = 'rgba(0,0,0,0.55)'; const w = g.measureText(p.name).width + 10; g.fillRect(x - w / 2, y - 12, w, 20);
      g.fillStyle = p.landmark ? '#ffd27a' : '#ffffff'; g.fillText(p.name, x, y + 4);
    }
    this._drawZones(g, tp, W / (HALF * 2));
    this._drawMarks(g, tp, 1.4);
    const e = m.me; const [x, y] = tp(e.pos.x, e.pos.z);
    g.save(); g.translate(x, y); g.rotate(-e.yaw); g.fillStyle = '#ffb000'; g.beginPath(); g.moveTo(0, -12); g.lineTo(7, 7); g.lineTo(0, 3); g.lineTo(-7, 7); g.closePath(); g.fill(); g.restore();
  }

  // --------------------------------------------------------------- events
  toast(text, kind = '', sub = '') {
    const d = document.createElement('div');
    d.className = 'toast ' + kind; d.innerHTML = esc(text) + (sub ? `<small>${esc(sub)}</small>` : '');
    $('toast-stack').appendChild(d);
    setTimeout(() => d.remove(), kind === 'zone' ? 5000 : 2600);
    while ($('toast-stack').children.length > 4) $('toast-stack').firstChild.remove();
  }
  killfeed(a, v, w, head, mine, verb) {
    const d = document.createElement('div');
    d.className = 'kf' + (mine ? ' me' : '') + (head ? ' hs' : '');
    d.innerHTML = a ? `<span class="a">${esc(a)}</span><span class="w">${esc(verb || w)}</span><span class="v">${esc(v)}</span>` : `<span class="v">${esc(v)}</span><span class="w">${esc(w)}</span>`;
    $('killfeed').prepend(d);
    setTimeout(() => d.remove(), 7000);
    while ($('killfeed').children.length > 5) $('killfeed').lastChild.remove();
  }
  hit(kill, head) { const h = $('hitmarker'); h.className = 'on' + (kill ? ' kill' : ''); this.hitT = kill ? 0.45 : 0.18; }
  damageFrom(angle) {
    const d = document.createElement('div'); d.className = 'dmga';
    d.style.transform = `rotate(${angle}rad) translateY(-110px)`;
    $('dmg-arrows').appendChild(d);
    setTimeout(() => { d.style.opacity = 0; }, 400); setTimeout(() => d.remove(), 1300);
  }
  center(html, t = 3) { $('center-msg').innerHTML = html; this.msgT = t; }
  prompt(label) { const p = $('prompt'); if (label) { p.style.display = 'block'; p.innerHTML = `<b>F</b>${esc(label)}`; } else p.style.display = 'none'; }
  progress(label, k) {
    const p = $('progress');
    if (!label) { p.style.display = 'none'; return; }
    p.style.display = 'block'; $('prog-label').textContent = label; $('prog-arc').style.strokeDashoffset = 107 * (1 - clamp(k, 0, 1));
  }
  egg(e, n, total) {
    $('egg-n').textContent = `${n}/${total}`; $('egg-t').textContent = e.title; $('egg-x').textContent = e.text;
    $('egg-card').classList.add('on'); this.eggT = 7;
  }
  chat(from, text, team) {
    const d = document.createElement('div');
    d.innerHTML = `<b>${esc(from)}${team ? ' (squad)' : ''}:</b> ${esc(text)}`;
    $('chat-hud-log').appendChild(d);
    setTimeout(() => d.remove(), 12000);
    while ($('chat-hud-log').children.length > 6) $('chat-hud-log').firstChild.remove();
  }
  chatOpen(on) { $('chat-hud').classList.toggle('open', on); if (on) setTimeout(() => $('chat-hud-in').focus(), 0); else $('chat-hud-in').blur(); this.m.setUi('chat', on); }
  spectate(name) { const s = $('spectate'); if (name) { s.style.display = 'block'; s.innerHTML = `SPECTATING <b style="color:var(--cyan)">${esc(name)}</b> · click to cycle`; } else s.style.display = 'none'; }

  // --------------------------------------------------------------- inventory
  toggleInventory(on) {
    $('inventory').classList.toggle('show', on);
    if (on) this.renderInventory();
  }
  renderInventory() {
    const m = this.m, e = m.me;
    const rar = (it) => (it.level === 3 || it.id === 'awm' || it.id === 'x8' ? 'r3' : it.level === 2 || it.id === 'x4' ? 'r2' : '');
    const q = (it) => (it.n > 1 ? `×${it.n}` : it.level ? '' : '');
    // ground
    const near = m.loot.near(e.pos, 3.2);
    let gh = '';
    for (const l of near) {
      if (l.crate) (l.items || []).forEach((it, i) => { gh += `<div class="it ${rar(it)}" data-g="${l.lid}" data-i="${i}"><span class="n">${esc(itemName(it, m.map))}</span><span class="q">${q(it)}</span></div>`; });
      else gh += `<div class="it ${rar(l.item)}" data-g="${l.lid}"><span class="n">${esc(itemName(l.item, m.map))}</span><span class="q">${q(l.item)}</span></div>`;
    }
    $('inv-ground').innerHTML = gh || '<p class="muted small">Nothing on the ground here.</p>';
    // bag
    $('inv-cap').textContent = `${Math.round(e.used())}/${e.capacity()}`;
    $('inv-bag').innerHTML = e.items.map((it, i) => `<div class="it ${rar(it)}" data-b="${i}"><span class="n">${esc(itemName(it, m.map))}</span><span class="q">${it.n > 1 ? '×' + it.n : ''}</span></div>`).join('') || '<p class="muted small">Empty. Go loot!</p>';
    // gear + guns
    $('inv-gear').innerHTML = '<div class="gear-row">' + ['helmet', 'vest', 'pack'].map((k) => `<div class="it ${e[k] ? 'r' + e[k].level : ''}" data-gear="${k}">${ICON[k]} ${e[k] ? 'Lv.' + e[k].level : '—'}</div>`).join('') + '</div>';
    $('inv-guns').innerHTML = [0, 1, 2, 3].map((s) => {
      const g = e.weapons[s];
      if (!g) return `<div class="gslot"><div class="gh">${s + 1}. <span>empty</span></div></div>`;
      const W = WEAPONS[g.id];
      const atts = W.cls === 'melee' ? '' : ['sight', 'muzzle', 'grip', 'mag'].map((slot) => {
        const has = g.att[slot];
        const fits = Object.entries(ATTACHMENTS).some(([k, a]) => a.slot === slot && a.fits.includes(W.cls));
        if (!fits) return '';
        return `<span class="att ${has ? 'has' : ''}" data-s="${s}" data-slot="${slot}">${has ? ATTACHMENTS[has].name : slot}</span>`;
      }).join('');
      return `<div class="gslot"><div class="gh">${s + 1}. ${esc(W.name)} <span>${W.ammo ? g.mag + '/' + e.magSize(g) + ' · ' + AMMO[W.ammo].name : 'melee'}</span></div><div class="atts">${atts}</div><div class="row gap" style="margin-top:6px"><button class="btn sm ghost" data-dropgun="${s}">Drop</button></div></div>`;
    }).join('');
    const root = $('inventory');
    root.querySelectorAll('[data-g]').forEach((el) => el.onclick = () => { m.pickupFromGround(el.dataset.g, el.dataset.i != null ? +el.dataset.i : null); this.renderInventory(); });
    root.querySelectorAll('[data-b]').forEach((el) => {
      el.onclick = () => { const it = e.items[+el.dataset.b]; if (!it) return; if (it.type === 'med' || it.type === 'boost' || it.type === 'food') m.player.useItem(it); else if (it.type === 'att') m.autoAttach(it); else if (it.type === 'throw') { e.throwId = it.id; e.cur = 4; m.syncGear(e); } this.renderInventory(); };
      el.oncontextmenu = (ev) => { ev.preventDefault(); m.dropItem(+el.dataset.b); this.renderInventory(); };
    });
    root.querySelectorAll('[data-slot]').forEach((el) => el.oncontextmenu = el.onclick = (ev) => { ev.preventDefault(); m.detach(+el.dataset.s, el.dataset.slot); this.renderInventory(); });
    root.querySelectorAll('[data-dropgun]').forEach((el) => el.onclick = () => { m.dropGun(+el.dataset.dropgun); this.renderInventory(); });
    root.querySelectorAll('[data-gear]').forEach((el) => el.oncontextmenu = (ev) => { ev.preventDefault(); m.dropGear(el.dataset.gear); this.renderInventory(); });
  }
  toggleMap(on) { $('bigmap').classList.toggle('show', on); if (on) this.drawBigMap(); }

  endScreen(win, place, total, stats, map) {
    $('endscreen').classList.add('show');
    const t = $('end-title');
    t.textContent = win ? map.win : `#${place} / ${total}`;
    t.className = 'end-title' + (win ? ' win' : '');
    $('end-sub').textContent = win ? `${map.name} · last squad standing` : place <= 10 ? 'So close. Top 10 in ' + map.name : 'Better luck next drop';
    $('end-stats').innerHTML = [['KILLS', stats.kills], ['DAMAGE', Math.round(stats.dmg)], ['SURVIVED', fmtTime(stats.time)], ['EGGS FOUND', stats.eggs]].map(([k, v]) => `<div><b>${v}</b>${k}</div>`).join('');
  }
  hideEnd() { $('endscreen').classList.remove('show'); }
}

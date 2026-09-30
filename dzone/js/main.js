// Boot: renderer + post-processing, lobby (login, squad, friends, invites, map select, open matches,
// easter-egg collection, settings), character preview, loading screen, match launch.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { MAPS, MAP_BY_ID } from './maps.js';
import { net, Social, LS, uid } from './net.js';
import { Match } from './match.js';
import { audio } from './audio.js';
import { loadSoldier, setAniso } from './assets.js';
import { initModelMats } from './models.js';
import { Avatar, OUTFIT_LIST, COSMETICS, COSMETIC_NAMES } from './character.js';
import { hashStr, mulberry32 } from './util.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const show = (id) => { document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('show', s.id === id)); };
const OUTFIT_COL = { classic: '#c9b89a', urban: '#8f9aab', desert: '#e0c28e', jungle: '#7f9f67', midnight: '#5d6688', saffron: '#ff9d4a' };

const settings = Object.assign({ sens: 1, fov: 80, vol: 0.8, music: 0.45, quality: 'medium', invertX: false, invertY: false, adsToggle: false, bloom: true }, LS.get('settings', {}));
// v2: mouse mapping is now the same in every mode; clear any invert toggles set to work around the old one
if ((settings.v || 1) < 2) { settings.invertX = false; settings.invertY = false; settings.v = 2; LS.set('settings', settings); }
const saveSettings = () => { LS.set('settings', settings); audio.setVolume(settings.vol); audio.setMusic(settings.music); applyQuality(); };

// ------------------------------------------------------------------ renderer
const glOk = (() => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; } })();
if (!glOk) {
  window.__bootFail && window.__bootFail('3D graphics are turned off in this browser',
    '<p>The game needs WebGL. In <b>Edge</b>: open <b>edge://settings/system</b>, turn on <b>"Use graphics acceleration when available"</b>, then restart Edge.</p><p>In Chrome the same switch is at <b>chrome://settings/system</b>. Also make sure your graphics driver is up to date.</p>');
  throw new Error('WebGL unavailable');
}
initModelMats();
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
setAniso(renderer.capabilities.getMaxAnisotropy());
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(80, innerWidth / innerHeight, 0.08, 4500);
const composer = new EffectComposer(renderer);
const rpMain = new RenderPass(scene, camera);
const rpVM = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
rpVM.clear = false; rpVM.clearDepth = true; rpVM.enabled = false;
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.55, 0.45, 0.88);
const grade = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uHurt: { value: 0 }, uWater: { value: 0 }, uBurn: { value: 0 }, uRes: { value: new THREE.Vector2(innerWidth, innerHeight) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime, uHurt, uWater, uBurn; varying vec2 vUv;
    void main(){
      vec2 uv = vUv;
      if (uBurn > 0.0) uv += vec2(sin(uv.y * 30.0 + uTime * 8.0), cos(uv.x * 26.0 + uTime * 7.0)) * 0.004 * uBurn;
      if (uWater > 0.0) uv += vec2(sin(uv.y * 20.0 + uTime * 2.0), 0.0) * 0.003 * uWater;
      vec2 d = uv - 0.5;
      float r = dot(d, d);
      float ca = 0.0012 + r * 0.004 + uHurt * 0.006;
      vec3 c = vec3(texture2D(tDiffuse, uv + d * ca).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - d * ca).b);
      // gentle teal/orange split-tone, medium cyberpunk
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(c, c * vec3(0.94, 1.0, 1.07), (1.0 - smoothstep(0.0, 0.5, l)) * 0.35);
      c = mix(c, c * vec3(1.06, 1.0, 0.94), smoothstep(0.5, 1.0, l) * 0.25);
      c *= 1.0 - r * 0.55;
      c = mix(c, vec3(l) * vec3(1.1, 0.7, 0.7), uHurt * 0.35);
      c = mix(c, c * vec3(0.35, 0.75, 0.85), uWater * 0.7);
      c = mix(c, c * vec3(1.35, 0.8, 0.55), uBurn * 0.6);
      gl_FragColor = vec4(c, 1.0);
    }`,
});
const output = new OutputPass();
const fxaa = new ShaderPass(FXAAShader);
composer.addPass(rpMain); composer.addPass(rpVM); composer.addPass(bloom); composer.addPass(grade); composer.addPass(output); composer.addPass(fxaa);

function applyQuality() {
  const q = settings.quality;
  const pr = q === 'low' ? 0.75 : q === 'high' ? Math.min(devicePixelRatio, 1.6) : Math.min(devicePixelRatio, 1.0);
  renderer.setPixelRatio(pr); composer.setPixelRatio(pr);
  bloom.enabled = settings.bloom && q !== 'low';
  renderer.shadowMap.enabled = q !== 'low';
  resize();
}
function resize() {
  renderer.setSize(innerWidth, innerHeight, false); composer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  const pr = renderer.getPixelRatio();
  fxaa.material.uniforms.resolution.value.set(1 / (innerWidth * pr), 1 / (innerHeight * pr));
  if (match && match.combat) match.combat.setScale(innerHeight * pr);
  sizePreview();
}
addEventListener('resize', resize);

// ------------------------------------------------------------------ lobby preview (own small renderer)
const pvCanvas = $('preview');
const pv = { r: new THREE.WebGLRenderer({ canvas: pvCanvas, antialias: true, alpha: true }), scene: new THREE.Scene(), cam: new THREE.PerspectiveCamera(32, 1, 0.1, 100), avatar: null, rot: 0.5, drag: null };
pv.r.outputColorSpace = THREE.SRGBColorSpace; pv.r.toneMapping = THREE.ACESFilmicToneMapping; pv.r.toneMappingExposure = 1.1;
pv.cam.position.set(0, 1.35, 7.2); pv.cam.lookAt(0, 0.82, 0);
pv.scene.add(new THREE.HemisphereLight(0x9fb8ff, 0x201826, 1.2));
const key = new THREE.DirectionalLight(0xfff2e0, 2.2); key.position.set(2, 4, 3); pv.scene.add(key);
const rimA = new THREE.PointLight(0x2de2e6, 18, 8); rimA.position.set(-2, 2, -1.5); pv.scene.add(rimA);
const rimB = new THREE.PointLight(0xff3f8e, 16, 8); rimB.position.set(2.2, 1.6, -1.2); pv.scene.add(rimB);
{
  const pod = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.15, 0.18, 6), new THREE.MeshStandardMaterial({ color: 0x151a22, metalness: 0.8, roughness: 0.35 }));
  pod.position.y = -0.09; pv.scene.add(pod);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.08, 0.015, 8, 6), new THREE.MeshBasicMaterial({ color: 0x2de2e6 }));
  ring.rotation.x = Math.PI / 2; ring.rotation.z = Math.PI / 6; ring.position.y = 0.005; pv.scene.add(ring);
  const ring2 = ring.clone(); ring2.material = new THREE.MeshBasicMaterial({ color: 0xff3f8e }); ring2.scale.setScalar(1.25); ring2.position.y = -0.17; pv.scene.add(ring2);
}
function sizePreview() { const r = pvCanvas.getBoundingClientRect(); if (!r.width) return; pv.r.setPixelRatio(Math.min(devicePixelRatio, 1.5)); pv.r.setSize(r.width, r.height, false); pv.cam.aspect = r.width / r.height; pv.cam.updateProjectionMatrix(); }
pvCanvas.addEventListener('pointerdown', (e) => { pv.drag = e.clientX; pvCanvas.setPointerCapture(e.pointerId); });
pvCanvas.addEventListener('pointermove', (e) => { if (pv.drag != null) { pv.rot += (e.clientX - pv.drag) * 0.01; pv.drag = e.clientX; } });
pvCanvas.addEventListener('pointerup', () => { pv.drag = null; });
let gltf = null;
async function refreshPreview() {
  gltf = gltf || await loadSoldier();
  if (!gltf) return;
  if (pv.avatar) pv.scene.remove(pv.avatar.root);
  pv.avatar = new Avatar(gltf, { outfit: profile.outfit, cosmetic: profile.cosmetic });
  pv.avatar.setWeapon('m416', { sight: 'holo' });
  pv.avatar.setBackGuns(['awm', null]);
  pv.avatar.setGear('vest', 2); pv.avatar.setGear('pack', 2);
  pv.scene.add(pv.avatar.root);
}

// ------------------------------------------------------------------ profile + social
const NAME_SUGS = ['FilterKaapi', 'AutoAnna', 'JugaadKing', 'DosaDestroyer', 'ChaiSutta', 'VadaPavVandal', 'BlueZoneBhai', 'PaneerPro', 'AdjustMaadi', 'TawaTitan', 'BiryaniBoss', 'SambarSniper'];
const profile = { name: LS.get('name', ''), outfit: LS.get('outfit', 'classic'), cosmetic: LS.get('cosmetic', 'thorthu') };
const social = new Social();
let match = null;

function netStatus(mode) {
  const txt = mode === 'relay' ? 'Online relay · ' + location.host : mode === 'local' ? 'Local mode · tabs on this browser' : 'Offline · solo only';
  for (const [d, t] of [['net-dot', 'net-text'], ['net-dot2', 'net-text2']]) { $(d).className = 'dot ' + (mode === 'relay' ? 'on' : mode === 'local' ? 'local' : ''); $(t).textContent = txt; }
  $('net-help').innerHTML = mode === 'relay'
    ? 'Everyone connected to this server can find you. Friends on your network open <b>http://&lt;your-ip&gt;:8795/</b> when the server runs with <code>-Lan</code>.'
    : 'Local mode links every tab in this browser — open a second tab to play together. For real multiplayer, double-click <code>Play DZone.cmd</code> in the dzone folder and open the game from it.';
}
net.onStatus = netStatus;

function buildLogin() {
  $('login-name').value = profile.name;
  $('name-sugs').innerHTML = NAME_SUGS.map((n) => `<button class="chip">${n}${Math.floor(Math.random() * 90 + 10)}</button>`).join('');
  $('name-sugs').onclick = (e) => { if (e.target.classList.contains('chip')) { $('login-name').value = e.target.textContent; audio.init(); audio.click('ui'); } };
  buildOutfitPickers();
  $('login-go').onclick = doLogin;
  $('login-name').onkeydown = (e) => { if (e.key === 'Enter') doLogin(); };
}
function buildOutfitPickers() {
  for (const id of ['outfit-row', 'stage-outfits']) {
    $(id).innerHTML = OUTFIT_LIST.map((o) => `<div class="sw ${o === profile.outfit ? 'on' : ''}" data-o="${o}" title="${o}" style="background:${OUTFIT_COL[o]}"></div>`).join('');
    $(id).onclick = (e) => { const o = e.target.dataset.o; if (!o) return; profile.outfit = o; LS.set('outfit', o); social.setOutfit({ outfit: o, cosmetic: profile.cosmetic }); buildOutfitPickers(); refreshPreview(); audio.click('ui'); };
  }
  for (const id of ['cos-row', 'stage-cos']) {
    $(id).innerHTML = COSMETICS.map((c) => `<button class="chip ${c === profile.cosmetic ? 'on' : ''}" data-c="${c}">${COSMETIC_NAMES[c]}</button>`).join('');
    $(id).onclick = (e) => { const c = e.target.dataset.c; if (!c) return; profile.cosmetic = c; LS.set('cosmetic', c); buildOutfitPickers(); refreshPreview(); audio.click('ui'); };
  }
}
async function doLogin() {
  audio.init();
  const n = $('login-name').value.trim();
  if (!/^[A-Za-z0-9_\-.]{3,16}$/.test(n)) { $('login-err').textContent = 'Use 3–16 letters, numbers, _ - or .'; return; }
  $('login-go').disabled = true;
  const res = await social.login(n, { outfit: profile.outfit, cosmetic: profile.cosmetic });
  $('login-go').disabled = false;
  if (!res.ok) { $('login-err').textContent = res.error; return; }
  profile.name = n;
  $('me-name').textContent = n;
  enterLobby();
}

function enterLobby() {
  show('scr-lobby');
  document.body.classList.remove('ingame');
  audio.startMusic();
  social.setStatus(social.party.members.length > 1 ? 'in squad' : 'in lobby');
  renderSquad(); renderMaps(); renderModes(); renderFriends(); renderAds(); renderEggs(); renderStats(); renderSettings();
  setTimeout(() => { sizePreview(); refreshPreview(); }, 50);
}

// ---- squad
function renderSquad() {
  const p = social.party, me = social.me;
  const leader = social.isLeader();
  $('squad-count').textContent = `${p.members.length}/4`;
  const rows = p.members.map((m) => `<div class="slot"><span class="dot on"></span><span class="nm">${esc(m.name)}${m.id === me.id ? ' <span class="muted small">(you)</span>' : ''}</span>${m.id === p.leader ? '<span class="badge">LEADER</span>' : ''}${leader && m.id !== me.id ? `<button class="kick" data-kick="${m.id}" title="Remove">✕</button>` : ''}</div>`);
  for (let i = p.members.length; i < 4; i++) rows.push('<div class="slot empty">Empty slot · invite from Friends</div>');
  $('squad-slots').innerHTML = rows.join('');
  $('squad-slots').onclick = (e) => { const k = e.target.dataset.kick; if (k) social.kick(k); };
  $('btn-leave').style.display = p.members.length > 1 ? '' : 'none';
  $('map-leader-note').textContent = leader ? '' : 'leader picks';
  $('btn-play').disabled = !leader; $('btn-host').disabled = !leader;
  $('play-note').textContent = leader ? (p.members.length > 1 ? `Your squad of ${p.members.length} drops together.` : 'Solo queue with bots. Invite friends for a squad.') : 'Waiting for the leader to start…';
  renderMaps(); renderModes();
}
$('btn-leave').onclick = () => social.leaveParty();
$('btn-invite').onclick = () => openDrawer('friends');
$('chat-in').onkeydown = (e) => { if (e.key === 'Enter') { social.partyChat(e.target.value); e.target.value = ''; } };
function chatLine(html) { const d = document.createElement('div'); d.innerHTML = html; $('chat-log').appendChild(d); $('chat-log').scrollTop = 1e6; }

// ---- maps
const artCache = new Map();
function mapArt(M, w = 320, h = 200) {
  const k = M.id + w;
  if (artCache.has(k)) return artCache.get(k);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  const rng = mulberry32(hashStr(M.id));
  const sky = { koramangala: ['#0b1024', '#5a2a6a'], bangalore: ['#2a3f66', '#f08a4b'], kochi: ['#314b52', '#9fb5a6'], chennai: ['#1d6fa5', '#ffd27a'], trivandrum: ['#3b2a5a', '#ff8a5b'], thrissur: ['#0b0f24', '#442a5a'], delhi: ['#8a7a66', '#d9c3a0'], gurugram: ['#120c2e', '#ff3f8e'], meghalaya: ['#56656a', '#b7c4c0'], aizawl: ['#5aa0d8', '#ffe2a8'], nagaland: ['#56615f', '#c8cfc6'], spiti: ['#1a5fb4', '#d9ecff'] }[M.id] || ['#223', '#667'];
  const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, sky[0]); gr.addColorStop(1, sky[1]); g.fillStyle = gr; g.fillRect(0, 0, w, h);
  const hilly = ['hills', 'ridges', 'valley'].includes(M.terrain.kind);
  // far mountains
  g.fillStyle = 'rgba(20,24,36,0.45)'; g.beginPath(); g.moveTo(0, h);
  for (let x = 0; x <= w; x += 8) g.lineTo(x, h * (hilly ? 0.45 : 0.7) - Math.abs(Math.sin(x * 0.02 + rng() * 0.3)) * h * (hilly ? 0.3 : 0.06) - rng() * 6);
  g.lineTo(w, h); g.fill();
  if (M.id === 'spiti') { g.fillStyle = 'rgba(255,255,255,0.8)'; g.beginPath(); g.moveTo(40, h * 0.34); g.lineTo(80, h * 0.2); g.lineTo(120, h * 0.34); g.fill(); g.beginPath(); g.moveTo(180, h * 0.36); g.lineTo(240, h * 0.16); g.lineTo(300, h * 0.36); g.fill(); }
  // skyline
  g.fillStyle = '#0a0d14';
  let x = 0;
  while (x < w) { const bw = 10 + rng() * 26, bh = (hilly ? 0.12 : 0.2) * h + rng() * h * (M.id === 'gurugram' ? 0.5 : hilly ? 0.12 : 0.25); g.fillRect(x, h - bh, bw - 2, bh); if (M.night || M.id === 'gurugram') { g.fillStyle = rng() < 0.5 ? 'rgba(255,200,120,0.8)' : 'rgba(45,226,230,0.8)'; for (let k = 0; k < 6; k++) g.fillRect(x + 2 + rng() * (bw - 6), h - bh + rng() * bh, 2, 2); g.fillStyle = '#0a0d14'; } x += bw; }
  // landmark glyphs
  const L = (M.landmarks[0] || {}).kind;
  g.fillStyle = '#0a0d14';
  const cx = w * 0.62;
  if (L === 'vidhana_soudha' || L === 'india_gate') { g.fillRect(cx - 40, h * 0.55, 80, h * 0.45); g.beginPath(); g.arc(cx, h * 0.55, 18, Math.PI, 0); g.fill(); }
  if (L === 'fishing_nets') { g.strokeStyle = '#0a0d14'; g.lineWidth = 2; for (let k = 0; k < 3; k++) { g.beginPath(); g.moveTo(cx - 60 + k * 50, h); g.lineTo(cx - 30 + k * 50, h * 0.45); g.lineTo(cx + k * 50, h); g.stroke(); } }
  if (L === 'lighthouse' || L === 'gopuram' || L === 'kerala_temple') { g.beginPath(); g.moveTo(cx - 30, h); g.lineTo(cx - 14, h * 0.3); g.lineTo(cx + 14, h * 0.3); g.lineTo(cx + 30, h); g.fill(); }
  if (L === 'root_bridge' || L === 'morungs' || L === 'monastery' || L === 'church') { g.beginPath(); g.moveTo(cx - 34, h); g.lineTo(cx, h * 0.38); g.lineTo(cx + 34, h); g.fill(); }
  if (L === 'cyber_hub') { for (let k = 0; k < 4; k++) g.fillRect(cx - 50 + k * 28, h * (0.2 + k * 0.08), 20, h); }
  // neon horizon line
  g.fillStyle = M.neon[0]; g.globalAlpha = 0.9; g.fillRect(0, h - 3, w, 3); g.globalAlpha = 1;
  const url = c.toDataURL('image/jpeg', 0.85);
  artCache.set(k, url);
  return url;
}
function eggTotal(M) { return M.props.filter((p) => p.egg).length + M.landmarks.filter((l) => l.egg).length + 3 + (M.landmarks.some((l) => l.kind === 'qutub') ? 1 : 0); }
function renderMaps() {
  const sel = social.party ? social.party.map : 'bangalore';
  $('map-grid').innerHTML = MAPS.map((M) => {
    const found = LS.get('eggs.' + M.id, []).length;
    return `<div class="mapc ${M.id === sel ? 'on' : ''}" data-m="${M.id}" style="background-image:url(${mapArt(M)})"><span class="mn">${esc(M.name)}</span><span class="eg">🥚${found}/${eggTotal(M)}</span></div>`;
  }).join('');
  $('map-grid').onclick = (e) => { const c = e.target.closest('.mapc'); if (!c) return; if (!social.isLeader()) return; social.setPartyMap(c.dataset.m); audio.click('ui'); };
  const M = MAP_BY_ID[sel] || MAPS[0];
  $('map-info').innerHTML = `<div class="mi-t">${esc(M.name)}<span>${esc(M.native)}</span></div><p><b style="color:var(--cyan)">${esc(M.tagline)}</b> — ${esc(M.blurb)}</p>`;
}
const lobbyOpts = { mode: LS.get('mode', 'squad'), diff: LS.get('diff', 'normal'), bots: LS.get('bots', 36) };
function renderModes() {
  const mode = social.party ? social.party.mode : lobbyOpts.mode;
  $('mode-seg').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === mode));
  $('diff-seg').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === lobbyOpts.diff));
  $('bots-range').value = lobbyOpts.bots; $('bots-val').textContent = lobbyOpts.bots;
}
$('mode-seg').onclick = (e) => { const v = e.target.dataset.v; if (!v || !social.isLeader()) return; lobbyOpts.mode = v; LS.set('mode', v); social.setPartyMode(v); renderModes(); };
$('diff-seg').onclick = (e) => { const v = e.target.dataset.v; if (!v) return; lobbyOpts.diff = v; LS.set('diff', v); renderModes(); };
$('bots-range').oninput = (e) => { lobbyOpts.bots = +e.target.value; LS.set('bots', lobbyOpts.bots); $('bots-val').textContent = lobbyOpts.bots; };
$('btn-play').onclick = () => launchAsLeader(false);
$('btn-host').onclick = () => launchAsLeader(true);

function launchAsLeader(pub) {
  audio.init(); audio.click('ui');
  const p = social.party;
  const info = { matchId: uid(), seed: Math.floor(Math.random() * 2 ** 31), map: p.map, mode: p.mode, bots: lobbyOpts.bots, diff: lobbyOpts.diff, hostId: social.me.id, party: p.members.map((m) => ({ id: m.id, name: m.name })), isPublic: pub };
  if (p.members.length > 1) social.launch(info);
  startMatch(info);
}
function renderAds() {
  const list = [...social.matchAds.values()].filter((a) => a.hostId !== (social.me && social.me.id));
  $('match-list').innerHTML = list.length ? list.map((a) => `<div class="mrow"><span class="nm">${esc(MAP_BY_ID[a.map]?.name || a.map)} <span class="muted small">· ${a.mode}</span></span><span class="mt">${esc(a.host)} · ${a.players} in · starts ${a.startsIn}s</span><button class="btn sm" data-join="${a.matchId}">Join</button></div>`).join('') : '<p class="muted small">No public matches right now. Press HOST to open one.</p>';
  $('match-list').onclick = (e) => { const id = e.target.dataset.join; if (!id) return; const a = social.matchAds.get(id); if (!a) return; startMatch({ matchId: a.matchId, seed: a.seed, map: a.map, mode: a.mode, bots: a.bots, diff: 'normal', hostId: a.hostId, party: [{ id: social.me.id, name: social.me.name }], isPublic: true }); };
}

// ---- friends
function renderFriends() {
  const q = $('search-in').value;
  const res = social.search(q).slice(0, 30);
  const row = (p, online) => `<div class="prow"><span class="dot ${online ? 'on' : ''}"></span><span class="nm">${esc(p.name)}</span><span class="st">${online ? esc(p.status || '') + (p.psize > 1 ? ` · squad ${p.psize}` : '') : 'offline'}</span>
    <button class="btn sm ghost" data-fr="${esc(p.name)}">${social.isFriend(p.name) ? 'Unfriend' : 'Add'}</button>${online ? `<button class="btn sm" data-inv="${p.id}">Invite</button>` : ''}</div>`;
  $('search-res').innerHTML = res.length ? res.map((p) => row(p, true)).join('') : `<p class="muted small">${q ? 'Nobody online with that name.' : 'No one else is online yet.'}</p>`;
  const fl = social.friendList();
  $('friend-list').innerHTML = fl.length ? fl.map((p) => row(p, p.online)).join('') : '<p class="muted small">Add players from search to see when they are online.</p>';
  $('friends-count').textContent = fl.filter((f) => f.online).length + '/' + fl.length;
  for (const id of ['search-res', 'friend-list']) $(id).onclick = (e) => {
    if (e.target.dataset.fr) { social.toggleFriend(e.target.dataset.fr); renderFriends(); }
    if (e.target.dataset.inv) { const p = social.online.get(e.target.dataset.inv); if (p) social.invite(p); }
  };
}
$('search-in').oninput = renderFriends;

// ---- easter eggs
function renderEggs() {
  let total = 0, found = 0;
  $('eggs-body').innerHTML = MAPS.map((M) => {
    const got = new Set(LS.get('eggs.' + M.id, []));
    const all = [...M.landmarks, ...M.props].filter((x) => x.egg).map((x) => x.egg);
    const tot = eggTotal(M); total += tot; found += Math.min(got.size, tot);
    const li = all.map((e) => got.has(e.id) ? `<div class="egg-li"><b>${esc(e.title)}</b> — ${esc(e.text)}</div>` : '<div class="egg-li locked">??? · keep exploring</div>').join('');
    return `<div class="eggmap"><h4>${esc(M.name)} <span>${got.size}/${tot}</span></h4><div class="eggbar"><i style="width:${(got.size / tot) * 100}%"></i></div>${li}<div class="egg-li locked">+ hidden eggs triggered by doing things…</div></div>`;
  }).join('');
  $('eggs-count').textContent = found + '/' + total;
}
function renderStats() {
  const s = LS.get('stats', { wins: 0, kills: 0, games: 0 });
  const eggs = MAPS.reduce((a, M) => a + LS.get('eggs.' + M.id, []).length, 0);
  $('stats-strip').innerHTML = [['Matches', s.games], ['Wins', s.wins], ['Kills', s.kills], ['Eggs', eggs]].map(([k, v]) => `<div><b>${v}</b>${k}</div>`).join('');
}

// ---- settings
function renderSettings(target = 'settings-body') {
  const rows = [
    ['Mouse sensitivity', 'range', 'sens', 0.2, 3, 0.05], ['Field of view', 'range', 'fov', 65, 105, 1], ['Master volume', 'range', 'vol', 0, 1, 0.05], ['Music', 'range', 'music', 0, 1, 0.05],
  ];
  $(target).innerHTML = rows.map(([l, t, k, a, b, s]) => `<div class="srow"><span>${l}</span><span class="row gap"><input type="range" min="${a}" max="${b}" step="${s}" value="${settings[k]}" data-k="${k}"><span class="v">${settings[k]}</span></span></div>`).join('')
    + `<div class="srow"><span>Graphics quality</span><div class="seg" data-seg="quality">${['low', 'medium', 'high'].map((q) => `<button class="${settings.quality === q ? 'on' : ''}" data-v="${q}">${q}</button>`).join('')}</div></div>`
    + `<div class="srow"><span>Bloom (neon glow)</span><input type="checkbox" data-c="bloom" ${settings.bloom ? 'checked' : ''}></div>`
    + `<div class="srow"><span>Invert mouse left / right</span><input type="checkbox" data-c="invertX" ${settings.invertX ? 'checked' : ''}></div>`
    + `<div class="srow"><span>Invert mouse up / down</span><input type="checkbox" data-c="invertY" ${settings.invertY ? 'checked' : ''}></div>`
    + `<div class="srow"><span>Toggle ADS (instead of hold)</span><input type="checkbox" data-c="adsToggle" ${settings.adsToggle ? 'checked' : ''}></div>`
    + `<p class="muted small">Quality changes the map detail on the next match; resolution, shadows and bloom apply now.</p>`;
  const root = $(target);
  root.querySelectorAll('input[type=range]').forEach((el) => el.oninput = () => { settings[el.dataset.k] = +el.value; el.nextElementSibling.textContent = el.value; saveSettings(); });
  root.querySelectorAll('input[type=checkbox]').forEach((el) => el.onchange = () => { settings[el.dataset.c] = el.checked; saveSettings(); });
  root.querySelectorAll('[data-seg] button').forEach((el) => el.onclick = () => { settings.quality = el.dataset.v; saveSettings(); renderSettings(target); });
}

// ---- drawers
function openDrawer(name) {
  document.querySelectorAll('.drawer').forEach((d) => d.classList.toggle('open', d.id === 'drawer-' + name));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.dataset.drawer === (name || '')));
  if (name === 'eggs') renderEggs();
  if (name === 'friends') { renderFriends(); setTimeout(() => $('search-in').focus(), 50); }
}
document.querySelectorAll('.tab').forEach((t) => t.onclick = () => { audio.click('ui'); openDrawer(t.dataset.drawer); });
document.querySelectorAll('[data-close]').forEach((b) => b.onclick = () => openDrawer(''));

// ---- toasts + invites
function gtoast(text) {
  const d = document.createElement('div'); d.className = 'toast'; d.textContent = text;
  $('global-toasts').appendChild(d); setTimeout(() => d.remove(), 3500);
}
social.addEventListener('toast', (e) => gtoast(e.detail.text));
social.addEventListener('presence', () => { if (!match) renderFriends(); });
social.addEventListener('party', () => { if (!match) renderSquad(); });
social.addEventListener('ads', () => { if (!match) renderAds(); });
social.addEventListener('chat', (e) => { chatLine(`<b>${esc(e.detail.from)}:</b> ${esc(e.detail.text)}`); if (match) match.hud.chat(e.detail.from, e.detail.text, true); });
social.addEventListener('invite', (e) => {
  const inv = e.detail;
  audio.click('egg');
  const d = document.createElement('div'); d.className = 'invite';
  d.innerHTML = `<span><b>${esc(inv.name)}</b> invited you to their squad · ${esc(MAP_BY_ID[inv.map]?.name || '')}</span><button class="btn sm primary">Join</button><button class="btn sm ghost">Nah</button>`;
  const [ok, no] = d.querySelectorAll('button');
  ok.onclick = () => { social.acceptInvite(inv); d.remove(); };
  no.onclick = () => { social.declineInvite(inv); d.remove(); };
  $('invites').appendChild(d);
  setTimeout(() => d.remove(), 20000);
});
social.addEventListener('launch', (e) => { if (!match) startMatch(e.detail); });

// ------------------------------------------------------------------ match lifecycle
async function startMatch(info) {
  if (match) return;
  const M = MAP_BY_ID[info.map];
  openDrawer('');
  show('scr-loading');
  audio.stopMusic();
  $('load-art').style.backgroundImage = `url(${mapArt(M, 960, 600)})`;
  $('load-native').textContent = M.native;
  $('load-name').textContent = M.name.toUpperCase();
  $('load-blurb').textContent = M.blurb + (M.osm ? '  Map data © OpenStreetMap contributors (ODbL).' : '');
  const tips = [...M.tips, 'The Dosa Tawa on your back stops bullets from behind.', 'Easter eggs are everywhere. Walk up to strange things.', 'Hold Alt to look around without turning.', 'Right-click the map (M) to drop a marker for your squad.', 'Knocked teammates can be revived with F.'];
  let ti = 0; $('load-tip').textContent = tips[0];
  const tipIv = setInterval(() => { ti = (ti + 1) % tips.length; $('load-tip').textContent = tips[ti]; }, 3500);
  social.setStatus('in match');
  renderer.toneMappingExposure = M.exposure;
  match = new Match({
    scene, camera, renderer, map: M, seed: info.seed, mode: info.mode, matchId: info.matchId, hostId: info.hostId,
    me: { id: social.me.id, name: social.me.name, outfit: profile.outfit, cosmetic: profile.cosmetic }, settings, bots: info.bots, difficulty: info.diff,
    isPublic: info.isPublic, party: info.party, onExit: exitMatch,
  });
  match.social = social;
  match.onSettings = () => { renderSettings('controls-card'); $('controls-card').classList.add('show'); };
  try {
    await match.load((p, m) => { $('load-bar').style.width = Math.round(p * 100) + '%'; $('load-pct').textContent = Math.round(p * 100) + '%'; $('load-msg').textContent = m || ''; });
  } catch (err) {
    console.error(err);
    clearInterval(tipIv);
    gtoast('Failed to load the map: ' + err.message);
    match = null; enterLobby();
    return;
  }
  clearInterval(tipIv);
  match.combat.setScale(innerHeight * renderer.getPixelRatio());
  rpVM.scene = match.player.vm.scene; rpVM.camera = match.player.vm.cam;
  // first render uploads the whole city to the GPU; do it while the loading screen is still up
  $('load-msg').textContent = 'Uploading the city to your GPU';
  await new Promise((r) => setTimeout(r, 30));
  try { match.update(0.016); composer.render(0.016); } catch (e) { console.warn(e); }
  show('hud');
  document.body.classList.add('ingame');
  match.input.lock();
}
function exitMatch() {
  match = null;
  rpVM.enabled = false;
  camera.fov = 80; camera.updateProjectionMatrix();
  social.setStatus('in lobby');
  enterLobby();
}

// ------------------------------------------------------------------ main loop
const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.1);
  if (match && match.phase !== 'loading') {
    match.update(dt);
    const P = match.player;
    rpVM.enabled = !!(P && P.vm.show);
    grade.uniforms.uTime.value += dt;
    grade.uniforms.uHurt.value = match.hurtFlash;
    const cp = camera.position;
    const wl = match.phys.waterLevel(cp.x, cp.z);
    grade.uniforms.uWater.value = wl > cp.y ? 1 : 0;
    grade.uniforms.uBurn.value = match.burn;
    composer.render(dt);
  } else if (!match) {
    if (pv.avatar && $('scr-lobby').classList.contains('show')) {
      pv.rot += pv.drag == null ? dt * 0.25 : 0;
      pv.avatar.root.rotation.y = pv.rot + Math.PI;
      pv.avatar.update(dt, { speed: 0, stance: 'stand', aiming: false, pitch: 0.05, mode: 'ground' });
      pv.r.render(pv.scene, pv.cam);
    }
  }
}

// ------------------------------------------------------------------ boot
// pointer lock is refused inside some embedded browsers; the game still works, clicks re-request it
addEventListener('unhandledrejection', (e) => { if (/pointer lock/i.test(String(e.reason && e.reason.message))) e.preventDefault(); });
buildLogin();
applyQuality();
frame();
net.connect().then(async (mode) => {
  netStatus(mode);
  if (profile.name) $('login-name').value = profile.name;
  // dev shortcut: ?quick=<map>&bots=<n> logs in and drops straight into a match
  const q = new URLSearchParams(location.search);
  if (q.get('quick')) {
    $('login-name').value = 'Tester' + Math.floor(Math.random() * 9000 + 1000);
    await doLogin();
    social.setPartyMap(q.get('quick'));
    lobbyOpts.bots = +(q.get('bots') ?? 12);
    launchAsLeader(false);
  }
});
addEventListener('beforeunload', () => { if (match) match.quit(); social.logout(); });
window.__br = { get match() { return match; }, social, net, settings, renderer, composer, scene, camera };

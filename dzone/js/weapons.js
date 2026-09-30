// Weapon ballistics, items, attachments and loot tables.
// Velocities are muzzle velocity in m/s; damage is base body damage; recoil is degrees kick per shot.

export const WEAPONS = {
  m416: { name: 'M416', cls: 'ar', ammo: '556', mag: 30, ext: 40, dmg: 41, rpm: 700, v: 880, modes: ['auto', 'single'], rv: 0.52, rh: 0.26, hip: 2.4, ads: 0.1, adsT: 0.2, rl: 2.1, rle: 2.8, weight: 1.0, sound: 'ar' },
  scar: { name: 'SCAR-L', cls: 'ar', ammo: '556', mag: 30, ext: 40, dmg: 41, rpm: 625, v: 870, modes: ['auto', 'single'], rv: 0.5, rh: 0.3, hip: 2.4, ads: 0.1, adsT: 0.2, rl: 2.2, rle: 3.0, weight: 1.0, sound: 'ar' },
  akm: { name: 'AKM', cls: 'ar', ammo: '762', mag: 30, ext: 40, dmg: 48, rpm: 600, v: 715, modes: ['auto', 'single'], rv: 0.78, rh: 0.44, hip: 2.8, ads: 0.14, adsT: 0.24, rl: 2.3, rle: 3.1, weight: 1.1, sound: 'ak' },
  ump: { name: 'UMP45', cls: 'smg', ammo: '45', mag: 25, ext: 35, dmg: 39, rpm: 650, v: 360, modes: ['auto', 'single'], rv: 0.34, rh: 0.2, hip: 1.6, ads: 0.14, adsT: 0.16, rl: 2.6, rle: 3.1, weight: 0.85, sound: 'smg' },
  vector: { name: 'Vector', cls: 'smg', ammo: '9mm', mag: 19, ext: 33, dmg: 31, rpm: 1090, v: 380, modes: ['auto', 'single'], rv: 0.3, rh: 0.22, hip: 1.5, ads: 0.15, adsT: 0.15, rl: 2.0, rle: 2.6, weight: 0.85, sound: 'smg' },
  mini14: { name: 'Mini 14', cls: 'dmr', ammo: '556', mag: 20, ext: 30, dmg: 48, rpm: 600, v: 990, modes: ['single'], rv: 0.9, rh: 0.25, hip: 3.2, ads: 0.05, adsT: 0.24, rl: 3.1, rle: 3.6, weight: 1.05, sound: 'dmr' },
  sks: { name: 'SKS', cls: 'dmr', ammo: '762', mag: 10, ext: 20, dmg: 53, rpm: 520, v: 800, modes: ['single'], rv: 1.3, rh: 0.4, hip: 3.4, ads: 0.06, adsT: 0.26, rl: 2.9, rle: 3.6, weight: 1.1, sound: 'dmr' },
  kar98k: { name: 'Kar98k', cls: 'sr', ammo: '762', mag: 5, ext: 5, dmg: 79, rpm: 32, v: 760, modes: ['bolt'], rv: 2.2, rh: 0.3, hip: 4.5, ads: 0.02, adsT: 0.3, rl: 0.55, perRound: true, weight: 1.15, sound: 'sr' },
  awm: { name: 'AWM', cls: 'sr', ammo: '300', mag: 5, ext: 7, dmg: 105, rpm: 32, v: 945, modes: ['bolt'], rv: 2.8, rh: 0.35, hip: 4.8, ads: 0.01, adsT: 0.34, rl: 3.4, rle: 4.2, weight: 1.2, sound: 'awm', crate: true },
  s12k: { name: 'S12K', cls: 'sg', ammo: '12g', mag: 5, ext: 8, dmg: 24, pellets: 9, rpm: 240, v: 350, modes: ['single'], rv: 2.2, rh: 0.8, hip: 3.2, ads: 2.4, adsT: 0.2, rl: 3.0, rle: 3.6, weight: 1.1, sound: 'sg' },
  p92: { name: 'P92', cls: 'pistol', ammo: '9mm', mag: 15, ext: 20, dmg: 35, rpm: 540, v: 380, modes: ['single'], rv: 0.8, rh: 0.3, hip: 1.8, ads: 0.4, adsT: 0.12, rl: 1.6, rle: 2.0, weight: 0.7, sound: 'pistol' },
  tawa: { name: 'Dosa Tawa', cls: 'melee', dmg: 80, rpm: 70, weight: 0.8, sound: 'pan', desc: 'Cast iron. Stops bullets on your back. Makes dosas.' },
};

export const HEAD_MULT = { ar: 2.3, smg: 2.1, dmr: 2.35, sr: 2.5, sg: 1.5, pistol: 2.1, melee: 1.5 };
export const LIMB_MULT = { ar: 0.9, smg: 1.05, dmr: 0.95, sr: 0.95, sg: 0.9, pistol: 1.0, melee: 1.0 };
export const ARMOR_RED = [0, 0.3, 0.4, 0.55];

export const AMMO = {
  '556': { name: '5.56mm', w: 0.5, stack: 30 }, '762': { name: '7.62mm', w: 0.7, stack: 30 }, '9mm': { name: '9mm', w: 0.375, stack: 30 },
  '45': { name: '.45 ACP', w: 0.4, stack: 30 }, '12g': { name: '12 Gauge', w: 1.25, stack: 8 }, '300': { name: '.300 Magnum', w: 1, stack: 10 },
};

export const ATTACHMENTS = {
  reddot: { name: 'Red Dot', slot: 'sight', zoom: 1.25, fits: ['ar', 'smg', 'dmr', 'sg', 'pistol', 'sr'], w: 10 },
  holo: { name: 'Holographic', slot: 'sight', zoom: 1.25, fits: ['ar', 'smg', 'dmr', 'sg', 'pistol', 'sr'], w: 10 },
  x2: { name: '2x Scope', slot: 'sight', zoom: 2, fits: ['ar', 'smg', 'dmr', 'sr'], w: 15 },
  x4: { name: '4x Scope', slot: 'sight', zoom: 4, fits: ['ar', 'smg', 'dmr', 'sr'], w: 15 },
  x8: { name: '8x Scope', slot: 'sight', zoom: 8, fits: ['dmr', 'sr'], w: 20 },
  suppressor: { name: 'Suppressor', slot: 'muzzle', fits: ['ar', 'smg', 'dmr', 'sr', 'pistol'], w: 10 },
  compensator: { name: 'Compensator', slot: 'muzzle', fits: ['ar', 'smg', 'dmr', 'sr'], w: 10 },
  vgrip: { name: 'Vertical Grip', slot: 'grip', fits: ['ar', 'smg'], w: 8 },
  extmag: { name: 'Extended Mag', slot: 'mag', fits: ['ar', 'smg', 'dmr', 'pistol', 'sg'], w: 12 },
};

export const MEDS = {
  bandage: { name: 'Bandage', t: 4, heal: 10, cap: 75, w: 2 },
  fak: { name: 'First Aid Kit', t: 6, heal: 100, cap: 75, w: 10 },
  medkit: { name: 'Med Kit', t: 8, heal: 100, cap: 100, w: 20 },
};
export const BOOSTS = {
  kaapi: { name: 'Filter Kaapi', t: 4, boost: 40, w: 4, desc: 'Degree coffee in a steel tumbler.' },
  balm: { name: 'Pain Balm', t: 6, boost: 60, w: 10, desc: 'Rub on temples. Feel invincible.' },
  chyawan: { name: 'Chyawanprash', t: 7, boost: 100, w: 20, desc: 'Grandma\'s secret. Full boost.' },
};
export const THROWS = {
  frag: { name: 'Sutli Bomb', w: 12, fuse: 5, dmg: 150, radius: 8, desc: 'Frag grenade. Diwali never ended.' },
  smoke: { name: 'Smoke', w: 14, fuse: 2.5, desc: 'Agarbatti extra-strong. 25 seconds of cover.' },
};
export const GEAR_CAP = { vest: [0, 50, 50, 50], pack: [0, 150, 200, 250] };
export const BASE_CAP = 60;

export function itemName(it, map) {
  switch (it.type) {
    case 'gun': return WEAPONS[it.id].name;
    case 'ammo': return AMMO[it.id].name;
    case 'att': return ATTACHMENTS[it.id].name;
    case 'med': return MEDS[it.id].name;
    case 'boost': return BOOSTS[it.id].name;
    case 'food': return it.name || (map && map.food ? map.food.name : 'Snack');
    case 'throw': return THROWS[it.id].name;
    case 'helmet': return `Helmet (Lv.${it.level})`;
    case 'vest': return `Vest (Lv.${it.level})`;
    case 'pack': return `Backpack (Lv.${it.level})`;
  }
  return '?';
}
export function itemWeight(it) {
  switch (it.type) {
    case 'ammo': return AMMO[it.id].w * it.n;
    case 'att': return ATTACHMENTS[it.id].w;
    case 'med': return MEDS[it.id].w * (it.n || 1);
    case 'boost': return BOOSTS[it.id].w * (it.n || 1);
    case 'food': return 6 * (it.n || 1);
    case 'throw': return THROWS[it.id].w * (it.n || 1);
  }
  return 0;
}

// ------------------------------------------------------------------ loot tables
const T = (arr) => { const tot = arr.reduce((s, a) => s + a[1], 0); return (rng) => { let r = rng() * tot; for (const [v, w] of arr) { r -= w; if (r <= 0) return v; } return arr[0][0]; }; };
const GUNS = [T([['p92', 16], ['ump', 16], ['vector', 9], ['s12k', 10], ['m416', 10], ['scar', 10], ['akm', 12], ['mini14', 7], ['sks', 5], ['kar98k', 5], ['tawa', 5]]),
  T([['ump', 10], ['vector', 10], ['s12k', 6], ['m416', 16], ['scar', 14], ['akm', 14], ['mini14', 11], ['sks', 9], ['kar98k', 8]]),
  T([['m416', 16], ['scar', 12], ['akm', 12], ['mini14', 12], ['sks', 12], ['kar98k', 14], ['vector', 8], ['awm', 2]])];
const CAT = [T([['gun', 24], ['ammo', 26], ['med', 15], ['boost', 8], ['gear', 11], ['att', 11], ['throw', 5]]),
  T([['gun', 26], ['ammo', 22], ['med', 14], ['boost', 9], ['gear', 13], ['att', 12], ['throw', 6]]),
  T([['gun', 26], ['ammo', 18], ['med', 14], ['boost', 10], ['gear', 16], ['att', 14], ['throw', 6]])];
const ATT = [T([['reddot', 14], ['holo', 12], ['x2', 8], ['x4', 4], ['suppressor', 4], ['compensator', 8], ['vgrip', 10], ['extmag', 12], ['x8', 1]]),
  T([['reddot', 10], ['holo', 10], ['x2', 10], ['x4', 8], ['suppressor', 7], ['compensator', 10], ['vgrip', 10], ['extmag', 12], ['x8', 3]]),
  T([['holo', 8], ['x2', 8], ['x4', 12], ['x8', 7], ['suppressor', 10], ['compensator', 8], ['vgrip', 8], ['extmag', 12]])];
const LVL = [T([[1, 70], [2, 28], [3, 2]]), T([[1, 50], [2, 44], [3, 6]]), T([[1, 30], [2, 55], [3, 15]])];

export function rollLoot(rng, tier = 0, spot = {}, map) {
  const out = [];
  if (spot.food && map && map.food) { out.push({ type: 'food', id: map.food.id, name: map.food.name, n: 1 }); if (rng() < 0.5) return out; }
  if (spot.chilli) { out.push({ type: 'food', id: 'rajamircha', name: 'Raja Mircha', n: 1 }); return out; }
  if (spot.boost) { out.push({ type: 'boost', id: rng.pick(['kaapi', 'kaapi', 'balm']), n: 1 }); return out; }
  const cat = CAT[tier](rng);
  switch (cat) {
    case 'gun': {
      const id = GUNS[tier](rng);
      out.push({ type: 'gun', id });
      const w = WEAPONS[id];
      if (w.ammo) for (let k = 0; k < 1 + (rng() < 0.6 ? 1 : 0); k++) out.push({ type: 'ammo', id: w.ammo, n: AMMO[w.ammo].stack });
      break;
    }
    case 'ammo': { const id = rng.pick(['556', '556', '762', '762', '9mm', '45', '12g']); out.push({ type: 'ammo', id, n: AMMO[id].stack }); break; }
    case 'med': out.push({ type: 'med', id: rng.pick(['bandage', 'bandage', 'bandage', 'fak', 'fak', 'medkit']), n: 1 }); if (out[0].id === 'bandage') out[0].n = 5; break;
    case 'boost': out.push({ type: 'boost', id: rng.pick(['kaapi', 'kaapi', 'balm', 'balm', 'chyawan']), n: 1 }); break;
    case 'gear': out.push({ type: rng.pick(['helmet', 'vest', 'pack']), level: LVL[tier](rng) }); break;
    case 'att': out.push({ type: 'att', id: ATT[tier](rng) }); break;
    case 'throw': out.push({ type: 'throw', id: rng() < 0.65 ? 'frag' : 'smoke', n: 1 }); break;
  }
  return out;
}

export function airdropLoot(rng) {
  const g = rng.pick(['awm', 'awm', 'm416', 'mini14']);
  const w = WEAPONS[g];
  return [
    { type: 'gun', id: g }, { type: 'ammo', id: w.ammo, n: w.ammo === '300' ? 20 : 60 },
    { type: 'att', id: g === 'awm' || g === 'mini14' ? 'x8' : 'x4' }, { type: 'att', id: 'suppressor' },
    { type: 'helmet', level: 3 }, { type: 'vest', level: 3 }, { type: 'med', id: 'medkit', n: 1 }, { type: 'boost', id: 'chyawan', n: 1 },
  ];
}

// config.js — pure data: rarity tiers, weapons, heals, world + storm constants.
// No imports; safe to load first.

export const RARITY = {
  common:    { name: 'Common',    color: '#b9c4cf', glow: 0x9aa7b3, dmg: 1.00 },
  uncommon:  { name: 'Uncommon',  color: '#3fd968', glow: 0x2fd05a, dmg: 1.12 },
  rare:      { name: 'Rare',      color: '#3aa0ff', glow: 0x2f8fff, dmg: 1.25 },
  epic:      { name: 'Epic',      color: '#b24bff', glow: 0xa23cff, dmg: 1.42 },
  legendary: { name: 'Legendary', color: '#ffc23d', glow: 0xffb21f, dmg: 1.62 },
};
export const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

// Weighted rarity roll (common most likely, legendary rare).
const RARITY_WEIGHTS = { common: 42, uncommon: 28, rare: 18, epic: 9, legendary: 3 };
export function rollRarity(luck = 0) {
  const w = { ...RARITY_WEIGHTS };
  // luck shifts weight toward higher tiers
  w.epic += luck * 4; w.legendary += luck * 3; w.rare += luck * 2;
  let total = 0; for (const k in w) total += w[k];
  let r = Math.random() * total;
  for (const k of RARITY_ORDER) { r -= w[k]; if (r <= 0) return k; }
  return 'common';
}

// Base weapon archetypes. dmg is per-hit at common tier before rarity multiplier.
export const WEAPON_TYPES = {
  blaster: {
    id: 'blaster', name: '9mm Street Blaster', slotKind: 'gun',
    dmg: 20, fireRate: 7, bloom: 0.013, adsBloom: 0.004, range: 95,
    auto: false, mag: 15, reload: 1.3, headMult: 2.0, pellets: 1, ammo: 'light',
  },
  smg: {
    id: 'smg', name: 'Switch-Burst SMG', slotKind: 'gun',
    dmg: 12, fireRate: 11, bloom: 0.032, adsBloom: 0.016, range: 62,
    auto: true, mag: 28, reload: 1.8, headMult: 1.8, pellets: 1, ammo: 'light',
  },
  shotgun: {
    id: 'shotgun', name: 'Pump Bass-Shotgun', slotKind: 'gun',
    dmg: 10, fireRate: 1.1, bloom: 0.085, adsBloom: 0.06, range: 30,
    auto: false, mag: 6, reload: 2.4, headMult: 1.5, pellets: 9, ammo: 'shells',
  },
  sniper: {
    id: 'sniper', name: 'Tokyo Neon Rail-Sniper', slotKind: 'gun',
    dmg: 95, fireRate: 0.8, bloom: 0.0012, adsBloom: 0.0003, range: 320,
    auto: false, mag: 5, reload: 2.8, headMult: 2.5, pellets: 1, ammo: 'heavy',
  },
};
export const GUN_IDS = ['blaster', 'smg', 'shotgun', 'sniper'];

// Melee harvesting tool — always in slot 1.
export const MELEE = {
  id: 'deck', name: 'Custom Deck Smasher', slotKind: 'melee',
  dmg: 34, harvest: 42, fireRate: 1.6, range: 4.2,
};

// Heals.
export const HEALS = {
  matcha:  { id: 'matcha',  name: 'Matcha Mini-Shield', slotKind: 'heal', shield: 25, time: 1.1 },
  chugjug: { id: 'chugjug', name: '808 Chug Jug',        slotKind: 'heal', hp: 100, shield: 100, time: 3.0 },
};

export function makeWeapon(typeId, rarityKey) {
  const base = WEAPON_TYPES[typeId];
  const r = RARITY[rarityKey];
  return {
    kind: 'gun', typeId, rarity: rarityKey, name: base.name,
    dmg: base.dmg * r.dmg, fireRate: base.fireRate, bloom: base.bloom,
    adsBloom: base.adsBloom, range: base.range, auto: base.auto, mag: base.mag,
    reload: base.reload, headMult: base.headMult, pellets: base.pellets,
    ammoInMag: base.mag, color: r.color, glow: r.glow,
  };
}

export const CONFIG = {
  mapHalf: 200,          // world spans -200..200 on x/z
  gridSize: 4,           // build grid in meters
  buildCost: 10,         // vibe mats per piece
  buildHealth: 180,
  startMats: 80,
  maxMats: 500,
  playerHP: 100,
  playerShield: 100,
  botCount: 11,          // rival bots (one slot reserved for companion)
  gravity: 26,
  // Storm phases: each shrinks the safe circle. radius in world units, dps = tick damage.
  storm: [
    { hold: 20, shrink: 28, radius: 150, dps: 1 },
    { hold: 16, shrink: 24, radius: 105, dps: 2 },
    { hold: 14, shrink: 20, radius: 70,  dps: 4 },
    { hold: 12, shrink: 16, radius: 42,  dps: 7 },
    { hold: 10, shrink: 14, radius: 20,  dps: 10 },
    { hold: 8,  shrink: 12, radius: 7,   dps: 14 },
  ],
  stormStartRadius: 205,
};

// Named points of interest for the minimap + loot/bot seeding.
export const POIS = [
  { name: 'Shuto Highway Chase', x: 0,    z: -110 },
  { name: 'Shibuya 85 Crossing', x: -90,  z: 40 },
  { name: 'Underground Studio Vault', x: 95, z: 70 },
  { name: 'Exclusive Merch District', x: 80, z: -60 },
];

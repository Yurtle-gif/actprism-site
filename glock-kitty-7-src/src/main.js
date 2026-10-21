// main.js — Glock Kitty 7 : Neo-Tokyo 85 battle royale. Engine + all gameplay.
import * as THREE from 'three';
import {
  createRenderer, createComposer, setupEnvironment, makeStylized,
  makeCamoTexture, makeAsphaltTexture, makeDenimTexture, makeStormMaterial,
} from './gfx.js';
import {
  RARITY, GUN_IDS, MELEE, HEALS, makeWeapon, rollRarity, CONFIG, POIS,
} from './config.js';
import { AudioSynth } from './audio.js';
import { loadArt, hasModel, makeProp, makeCharacter, setAnim, aimArms, tiledBox, ART } from './models.js';
import { HUD } from './hud.js';

// ---------------------------------------------------------------- utilities
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const dist2 = (ax, az, bx, bz) => { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; };

// ------------------------------------------------------------------- module state
let renderer, scene, camera, comp, lights, hud, audio;
const clock = new THREE.Clock();
let W = window.innerWidth, H = window.innerHeight;

let player, build, storm;
const bots = [];
const chests = [];
const fx = [];            // transient visual effects {obj, life, max, update}
const anims = [];         // non-destructive scale/transform tweens {obj, t, dur, fn}
const dynamicSolids = []; // recomputed each frame (moving vehicles)

let worldGroup, hitWorld, propsGroup, buildGroup, botGroup, lootGroup, fxGroup;
const solids = [];   // {minx,maxx,minz,maxz,baseY,top, mesh?}
const floors = [];   // {minx,maxx,minz,maxz,y}
const ramps = [];    // {minx,maxx,minz,maxz,y0,y1,axis,dir}
const tops = [];     // {minx,maxx,minz,maxz,top} standable building roofs
const rails = [];    // {x1,z1,x2,z2,y} grindable
const boostPads = []; // {x,z,r}
const vehicles = [];  // moving highway cars

const keys = {};
let locked = false, lookFallback = false, fireDown = false, fireEdge = false, adsDown = false;
let running = false, matchOver = false;
let speedLineTarget = 0;

const rayc = new THREE.Raycaster();
const V = new THREE.Vector3(), V2 = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);

// ------------------------------------------------------------------- collision
function addSolid(x, z, hw, hd, baseY, top, mesh) {
  solids.push({ minx: x - hw, maxx: x + hw, minz: z - hd, maxz: z + hd, baseY, top, mesh });
}
function pointInBox(x, z, b) { return x >= b.minx && x <= b.maxx && z >= b.minz && z <= b.maxz; }

function groundHeightAt(x, z, feetY) {
  let g = 0;
  for (const f of floors) if (pointInBox(x, z, f) && feetY >= f.y - 1.2) g = Math.max(g, f.y);
  for (const t of tops) if (pointInBox(x, z, t) && feetY >= t.top - 1.2) g = Math.max(g, t.top);
  for (const r of ramps) {
    if (!pointInBox(x, z, r)) continue;
    let tt;
    if (r.axis === 'x') tt = (x - r.minx) / (r.maxx - r.minx);
    else tt = (z - r.minz) / (r.maxz - r.minz);
    if (r.dir < 0) tt = 1 - tt;
    const h = lerp(r.y0, r.y1, clamp(tt, 0, 1));
    if (feetY >= h - 1.2) g = Math.max(g, h);
  }
  return g;
}

function resolveHorizontal(pos, radius, feetY, height) {
  const all = solids.concat(dynamicSolids);
  for (const s of all) {
    if (feetY + height < s.baseY + 0.05 || feetY > s.top - 0.05) continue; // vertically clear
    const cx = clamp(pos.x, s.minx, s.maxx);
    const cz = clamp(pos.z, s.minz, s.maxz);
    const dx = pos.x - cx, dz = pos.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 < radius * radius) {
      if (d2 > 1e-5) {
        const d = Math.sqrt(d2);
        pos.x = cx + (dx / d) * radius;
        pos.z = cz + (dz / d) * radius;
      } else {
        // center inside: push out nearest edge
        const left = pos.x - s.minx, right = s.maxx - pos.x;
        const up = pos.z - s.minz, down = s.maxz - pos.z;
        const m = Math.min(left, right, up, down);
        if (m === left) pos.x = s.minx - radius;
        else if (m === right) pos.x = s.maxx + radius;
        else if (m === up) pos.z = s.minz - radius;
        else pos.z = s.maxz + radius;
      }
    }
  }
}

function worldToScreen(v) {
  V.copy(v).project(camera);
  return { x: (V.x * 0.5 + 0.5) * W, y: (-V.y * 0.5 + 0.5) * H, visible: V.z < 1 };
}

// ------------------------------------------------------------------- FX helpers
function addFx(obj, life, update) { obj.userData._life = life; obj.userData._max = life; obj.userData._upd = update; fx.push(obj); fxGroup.add(obj); }

function spawnTracer(from, to, color) {
  const dir = V.copy(to).sub(from);
  const len = dir.length();
  if (len < 0.01) return;
  const geo = new THREE.CylinderGeometry(0.035, 0.035, len, 6, 1, true);
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const m = new THREE.Mesh(geo, mat);
  m.position.copy(from).addScaledVector(dir.normalize(), len * 0.5);
  m.quaternion.setFromUnitVectors(UP, dir);
  addFx(m, 0.09, (o, t) => { o.material.opacity = 0.9 * t; });
}

function spawnSpark(point, color = 0xffd27a) {
  for (let i = 0; i < 5; i++) {
    const g = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.08), new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    g.position.copy(point);
    const vel = new THREE.Vector3(rand(-1, 1), rand(0.5, 2), rand(-1, 1)).multiplyScalar(3);
    addFx(g, 0.35, (o, t, dt) => { o.position.addScaledVector(vel, dt); vel.y -= 9 * dt; o.material.opacity = t; o.scale.setScalar(t); });
  }
}

function spawnExplosion(point, color = 0xff5fd0) {
  const ring = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  ring.position.copy(point);
  addFx(ring, 0.5, (o, t) => { const s = lerp(4, 0.5, t); o.scale.setScalar(s); o.material.opacity = t * 0.8; });
  spawnSpark(point, color);
  spawnSpark(point, 0xffffff);
}

// ------------------------------------------------------------------- world build
function buildWorld() {
  worldGroup = new THREE.Group(); scene.add(worldGroup);
  hitWorld = new THREE.Group(); scene.add(hitWorld);
  propsGroup = new THREE.Group(); scene.add(propsGroup);
  buildGroup = new THREE.Group(); scene.add(buildGroup);
  botGroup = new THREE.Group(); scene.add(botGroup);
  lootGroup = new THREE.Group(); scene.add(lootGroup);
  fxGroup = new THREE.Group(); scene.add(fxGroup);

  // ground island
  const asphalt = makeAsphaltTexture(512); asphalt.repeat.set(40, 40);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(CONFIG.mapHalf * 2, CONFIG.mapHalf * 2),
    makeStylized({ map: asphalt, roughness: 0.92, metalness: 0.08 }, { color: 0x3a2a55, power: 3.0, strength: 0.25 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  hitWorld.add(ground);

  // neon grid underlay
  const grid = new THREE.GridHelper(CONFIG.mapHalf * 2, 100, 0x5fe0ff, 0x2a1a4a);
  grid.position.y = 0.02; grid.material.transparent = true; grid.material.opacity = 0.18;
  worldGroup.add(grid);

  const camo = makeCamoTexture(512);
  // POI building clusters
  let poiIdx = 0;
  for (const poi of POIS) {
    const count = 5 + (Math.random() * 4 | 0);
    const mainFront = FRONTS[poiIdx++ % FRONTS.length];
    for (let i = 0; i < count; i++) {
      const bw = rand(6, 14), bd = rand(6, 14), bh = rand(8, 26);
      const bx = poi.x + rand(-26, 26), bz = poi.z + rand(-26, 26);
      if (addFacadeBuilding(bx, bz, bw, bd, bh, Math.random() < 0.7 ? mainFront : pick(FRONTS), poi)) continue;
      const neon = pick([0xff5fd0, 0x5fe0ff, 0xb6ff3a, 0xb24bff]);
      const mat = makeStylized(
        { color: 0x1c1430, roughness: 0.6, metalness: 0.3, emissive: neon, emissiveIntensity: 0.0 },
        { color: neon, power: 3.2, strength: 0.5 }
      );
      const b = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), mat);
      b.position.set(bx, bh / 2, bz);
      b.castShadow = true; b.receiveShadow = true;
      hitWorld.add(b);
      addSolid(bx, bz, bw / 2, bd / 2, 0, bh, b);
      tops.push({ minx: bx - bw / 2, maxx: bx + bw / 2, minz: bz - bd / 2, maxz: bz + bd / 2, top: bh });
      // emissive neon sign strip
      const sign = new THREE.Mesh(new THREE.BoxGeometry(bw * 0.8, 1.2, 0.3),
        new THREE.MeshStandardMaterial({ color: neon, emissive: neon, emissiveIntensity: 2.4 }));
      sign.position.set(bx, bh * rand(0.4, 0.8), bz + bd / 2 + 0.2);
      worldGroup.add(sign);
    }
    // POI ground pad glow
    const pad = new THREE.Mesh(new THREE.CircleGeometry(18, 40),
      new THREE.MeshBasicMaterial({ color: 0x2a1850, transparent: true, opacity: 0.5 }));
    pad.rotation.x = -Math.PI / 2; pad.position.set(poi.x, 0.03, poi.z);
    worldGroup.add(pad);
  }

  // scatter harvestable props
  for (let i = 0; i < 120; i++) {
    let x = rand(-CONFIG.mapHalf + 10, CONFIG.mapHalf - 10);
    let z = rand(-CONFIG.mapHalf + 10, CONFIG.mapHalf - 10);
    for (let tries = 0; tries < 8 && insideSolid(x, z, 2.5); tries++) {
      x = rand(-CONFIG.mapHalf + 10, CONFIG.mapHalf - 10); z = rand(-CONFIG.mapHalf + 10, CONFIG.mapHalf - 10);
    }
    const art = pickStreetProp();
    if (art) {
      const g = makeProp(art.m, art.o);
      if (g) {
        g.position.set(x, 0, z); g.rotation.y = rand(0, Math.PI * 2);
        g.userData.prop = { hp: art.hp, mats: art.mats };
        propsGroup.add(g);
        continue;
      }
    }
    const kind = pick(['crate', 'can', 'car', 'amp']);
    let mesh, mats, hp;
    if (kind === 'crate') {
      mesh = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 1.4), makeStylized({ map: camo, roughness: 0.8 }, { color: 0xb6ff3a, strength: 0.4 }));
      mesh.position.set(x, 0.7, z); mats = 20; hp = 60;
    } else if (kind === 'can') {
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 1.2, 10), makeStylized({ color: 0x3a4a55, metalness: 0.6, roughness: 0.4 }, { color: 0x5fe0ff, strength: 0.5 }));
      mesh.position.set(x, 0.6, z); mats = 12; hp = 40;
    } else if (kind === 'amp') {
      mesh = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2, 1.2), makeStylized({ color: 0x120a1e, roughness: 0.5, emissive: 0xff5fd0, emissiveIntensity: 0.6 }, { color: 0xff5fd0, strength: 0.7 }));
      mesh.position.set(x, 1, z); mats = 28; hp = 80;
    } else {
      mesh = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.6, 2), makeStylized({ color: pick([0xff5fd0, 0x5fe0ff, 0xffc23d]), roughness: 0.3, metalness: 0.5 }, { color: 0xffffff, strength: 0.35 }));
      mesh.position.set(x, 0.8, z); mats = 36; hp = 120;
    }
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.userData.prop = { hp, mats };
    propsGroup.add(mesh);
  }

  buildHighway();
  buildStreetDecor();
  buildSkyline();

  // flavor: tour blimp high above
  const blimp = new THREE.Mesh(new THREE.CapsuleGeometry(6, 16, 8, 16),
    makeStylized({ color: 0xff5fd0, roughness: 0.4, emissive: 0xff5fd0, emissiveIntensity: 0.5 }, { color: 0x5fe0ff, strength: 0.6 }));
  blimp.rotation.z = Math.PI / 2; blimp.position.set(0, 110, 30);
  worldGroup.add(blimp);
}

// ---- Flock Kitty city art: painted storefront strips, tiled upper floors, rooftop ads
const FRONTS = ['front_sf', 'front_oak', 'front_sj'];
const FRONT_ASPECT = { front_sf: 1280 / 477, front_oak: 1280 / 455, front_sj: 1280 / 493 };
const facadeMats = {};
let roofMat, bbMat, bbBackMat;
function facadeMat(key, glow) {
  if (!facadeMats[key]) {
    const t = ART.tex[key];
    facadeMats[key] = new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: glow, roughness: 0.85, metalness: 0.05 });
  }
  return facadeMats[key];
}
function insideSolid(x, z, pad) {
  for (const s of solids) if (x > s.minx - pad && x < s.maxx + pad && z > s.minz - pad && z < s.maxz + pad) return true;
  return false;
}
function addFacadeBuilding(bx, bz, bw, bd, bh, frontKey, poi) {
  if (!ART.tex[frontKey] || !ART.tex.up_brick || !ART.tex.up_glass) return false;
  roofMat = roofMat || makeStylized({ color: 0x221a30, roughness: 0.9 }, { color: 0xb24bff, power: 3, strength: 0.25 });
  const bandH = 5.2;
  const front = facadeMat(frontKey, 0.6);
  const band = new THREE.Mesh(tiledBox(bw + 0.08, bandH, bd + 0.08, bandH * FRONT_ASPECT[frontKey], bandH, Math.random()),
    [front, front, roofMat, roofMat, front, front]);
  band.position.set(bx, bandH / 2, bz);
  const upKey = bh > 17 ? 'up_glass' : 'up_brick';
  const up = facadeMat(upKey, upKey === 'up_glass' ? 0.5 : 0.35);
  const tile = upKey === 'up_glass' ? 7 : 6;
  const uh = bh - bandH;
  const upper = new THREE.Mesh(tiledBox(bw, uh, bd, tile, tile, Math.random()), [up, up, roofMat, roofMat, up, up]);
  upper.position.set(bx, bandH + uh / 2, bz);
  for (const m of [band, upper]) { m.castShadow = true; m.receiveShadow = true; hitWorld.add(m); }
  addSolid(bx, bz, bw / 2, bd / 2, 0, bh, upper);
  tops.push({ minx: bx - bw / 2, maxx: bx + bw / 2, minz: bz - bd / 2, maxz: bz + bd / 2, top: bh });
  if (ART.tex.billboard && Math.random() < 0.45) addBillboard(bx, bz, bw, bd, bh, poi);
  return true;
}
function addBillboard(bx, bz, bw, bd, bh, poi) {
  bbMat = bbMat || new THREE.MeshStandardMaterial({ map: ART.tex.billboard, emissiveMap: ART.tex.billboard, emissive: 0xffffff, emissiveIntensity: 0.85, roughness: 0.6 });
  bbBackMat = bbBackMat || new THREE.MeshStandardMaterial({ color: 0x151020, roughness: 0.7, metalness: 0.5 });
  const dx = poi.x - bx, dz = poi.z - bz;
  const alongX = Math.abs(dx) > Math.abs(dz);
  const side = (alongX ? Math.sign(dx) : Math.sign(dz)) || 1;
  const span = alongX ? bd : bw;
  const w = Math.min(span * 0.9, 10), h = w / (768 / 430);
  const g = new THREE.Group();
  const back = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, h + 0.3, 0.12), bbBackMat);
  back.position.set(0, 1.6 + h / 2, 0); g.add(back);
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(w, h), bbMat);
  panel.position.set(0, 1.6 + h / 2, 0.07); g.add(panel);
  for (const px of [-w * 0.3, w * 0.3]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.25, 1.7, 0.25), bbBackMat);
    post.position.set(px, 0.85, -0.1); g.add(post);
  }
  if (alongX) { g.position.set(bx + side * (bw / 2 - 0.5), bh, bz); g.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2; }
  else { g.position.set(bx, bh, bz + side * (bd / 2 - 0.5)); g.rotation.y = side > 0 ? 0 : Math.PI; }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  worldGroup.add(g);
}
const STREET_PROPS = [
  { m: 'dumpster', o: { len: 2.6 }, mats: 28, hp: 80, w: 3 },
  { m: 'barrier', o: { len: 2.4 }, mats: 20, hp: 60, w: 3 },
  { m: 'cone', o: { h: 0.9 }, mats: 8, hp: 25, w: 3 },
  { m: 'hydrant', o: { h: 1.0 }, mats: 12, hp: 40, w: 3 },
  { m: 'bench', o: { len: 2.2 }, mats: 16, hp: 50, w: 3 },
  { m: 'lambo_green', o: { len: 4.8 }, mats: 36, hp: 120, w: 1 },
  { m: 'lambo_orange', o: { len: 4.8 }, mats: 36, hp: 120, w: 1 },
  { m: 'gwagon', o: { len: 4.9 }, mats: 40, hp: 140, w: 1 },
  { m: 'cruiser', o: { len: 5.1 }, mats: 36, hp: 120, w: 1 },
];
function pickStreetProp() {
  const avail = STREET_PROPS.filter((p) => hasModel(p.m));
  if (!avail.length) return null;
  let t = Math.random() * avail.reduce((a, p) => a + p.w, 0);
  for (const p of avail) { t -= p.w; if (t <= 0) return p; }
  return avail[0];
}
function placeDecor(name, opts, x, z, rotY) {
  const g = makeProp(name, opts);
  if (!g) return null;
  g.position.set(x, 0, z); g.rotation.y = rotY ?? rand(0, Math.PI * 2);
  worldGroup.add(g);
  return g;
}
function buildStreetDecor() {
  // palms + cam poles around every POI, trees across the island, lamps on the expressway
  for (const poi of POIS) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + rand(-0.2, 0.2), r = rand(30, 38);
      const x = poi.x + Math.cos(a) * r, z = poi.z + Math.sin(a) * r;
      if (!insideSolid(x, z, 1.5)) placeDecor('palm', { h: rand(8, 11) }, x, z);
    }
    for (let i = 0; i < 2; i++) {
      const x = poi.x + rand(-20, 20), z = poi.z + rand(-20, 20);
      if (!insideSolid(x, z, 1)) placeDecor('campole', { h: 3.6 }, x, z);
    }
  }
  for (let i = 0; i < 26; i++) {
    const x = rand(-CONFIG.mapHalf + 12, CONFIG.mapHalf - 12), z = rand(-CONFIG.mapHalf + 12, CONFIG.mapHalf - 12);
    if (Math.abs(x - 20) < 12 || insideSolid(x, z, 2)) continue;
    placeDecor('tree', { h: rand(5.5, 7.5) }, x, z);
  }
  if (hasModel('lamp')) {
    for (let z = -CONFIG.mapHalf + 25; z < CONFIG.mapHalf; z += 45) {
      placeDecor('lamp', { h: 6.5 }, 20 - 7.2, z, -Math.PI / 2).position.y = 9.3;
      placeDecor('lamp', { h: 6.5 }, 20 + 7.2, z + 22, Math.PI / 2).position.y = 9.3;
    }
  }
}
function buildSkyline() {
  // the dark bay all around the island, then the painted Flock Kitty skyline on the horizon
  const bay = new THREE.Mesh(new THREE.CircleGeometry(900, 48), new THREE.MeshStandardMaterial({ color: 0x0c0718, roughness: 0.35, metalness: 0.6 }));
  bay.rotation.x = -Math.PI / 2; bay.position.y = -0.25;
  worldGroup.add(bay);
  const t = ART.tex.skyline;
  if (!t) return;
  const R = 420, reps = 7, tileW = (2 * Math.PI * R) / reps, H = tileW / (2048 / 852);
  t.repeat.set(reps, 1);
  const sky = new THREE.Mesh(new THREE.CylinderGeometry(R, R, H, 96, 1, true),
    new THREE.MeshBasicMaterial({ map: t, transparent: true, side: THREE.BackSide, fog: false, depthWrite: false, color: 0xd8cfff }));
  sky.position.y = H / 2 - 8; sky.renderOrder = -1;
  worldGroup.add(sky);
}

function buildHighway() {
  // elevated Shuto expressway crossing the island along +/- Z
  const roadY = 9, roadW = 16, len = CONFIG.mapHalf * 2;
  const asphalt = makeAsphaltTexture(512); asphalt.repeat.set(2, 40);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(roadW, 0.6, len),
    makeStylized({ map: asphalt, roughness: 0.55, metalness: 0.25 }, { color: 0xff5fd0, power: 3.0, strength: 0.3 }));
  deck.position.set(20, roadY, 0);
  deck.castShadow = true; deck.receiveShadow = true;
  hitWorld.add(deck);
  floors.push({ minx: 20 - roadW / 2, maxx: 20 + roadW / 2, minz: -len / 2, maxz: len / 2, y: roadY + 0.3 });
  // support pillars
  for (let z = -len / 2 + 20; z < len / 2; z += 40) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.6, roadY, 10), makeStylized({ color: 0x241634, roughness: 0.7 }, { color: 0xb24bff, strength: 0.3 }));
    p.position.set(20, roadY / 2, z); p.castShadow = true; hitWorld.add(p);
  }
  // grind rails (both edges) + ramps up from ground
  for (const ex of [-roadW / 2, roadW / 2]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.9, len),
      new THREE.MeshStandardMaterial({ color: 0x5fe0ff, emissive: 0x5fe0ff, emissiveIntensity: 2.2, metalness: 0.8, roughness: 0.2 }));
    rail.position.set(20 + ex, roadY + 0.9, 0);
    worldGroup.add(rail);
    rails.push({ x1: 20 + ex, z1: -len / 2, x2: 20 + ex, z2: len / 2, y: roadY + 0.9 });
  }
  // on-ramp to climb onto the highway near center
  const rampLen = 18;
  const ramp = new THREE.Mesh(new THREE.BoxGeometry(6, 0.5, rampLen),
    makeStylized({ map: asphalt, roughness: 0.6 }, { color: 0xb6ff3a, strength: 0.3 }));
  ramp.position.set(20 - roadW / 2 - 4, roadY / 2, -40);
  ramp.rotation.x = Math.atan2(roadY, rampLen);
  ramp.castShadow = true; ramp.receiveShadow = true;
  hitWorld.add(ramp);
  ramps.push({ minx: 20 - roadW / 2 - 7, maxx: 20 - roadW / 2 - 1, minz: -40 - rampLen / 2, maxz: -40 + rampLen / 2, y0: 0.3, y1: roadY + 0.3, axis: 'z', dir: 1 });

  // boost pads on the deck
  for (let z = -60; z <= 60; z += 60) {
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(roadW * 0.7, 6),
      new THREE.MeshStandardMaterial({ color: 0xb6ff3a, emissive: 0xb6ff3a, emissiveIntensity: 2.0, transparent: true, opacity: 0.8 }));
    pad.rotation.x = -Math.PI / 2; pad.position.set(20, roadY + 0.32, z);
    worldGroup.add(pad);
    boostPads.push({ x: 20, z, r: 8 });
  }

  // moving traffic: the Flock Kitty cars when the art loaded, neon boxes otherwise
  const CAR_MODELS = ['lambo_green', 'lambo_orange', 'gwagon', 'cruiser'].filter(hasModel);
  for (let i = 0; i < 8 && CAR_MODELS.length; i++) {
    const dirSign = i % 2 ? 1 : -1;
    const model = makeProp(CAR_MODELS[i % CAR_MODELS.length], { len: 5.0 });
    if (!model) continue;
    const car = new THREE.Group(); car.add(model);
    model.rotation.y = dirSign > 0 ? -Math.PI / 2 : Math.PI / 2; // model noses point +x
    const dims = model.userData.dims;
    car.userData.hw = dims.z / 2 + 0.1; car.userData.hl = dims.x / 2; car.userData.h = dims.y;
    car.position.set(i % 2 ? 24 : 16, roadY + 0.3, rand(-len / 2, len / 2));
    car.userData.speed = dirSign * rand(22, 34);
    worldGroup.add(car);
    vehicles.push(car);
  }
  const boxTraffic = !vehicles.length;
  for (let i = 0; i < 6 && boxTraffic; i++) {
    const col = pick([0xff5fd0, 0x5fe0ff, 0xffc23d, 0xb24bff]);
    const car = new THREE.Mesh(new THREE.BoxGeometry(3, 1.6, 6),
      makeStylized({ color: 0x15101f, roughness: 0.3, metalness: 0.6, emissive: col, emissiveIntensity: 0.5 }, { color: col, strength: 0.6 }));
    const lane = i % 2 ? 24 : 16;
    car.position.set(lane, roadY + 1.1, rand(-len / 2, len / 2));
    car.userData.speed = (i % 2 ? 1 : -1) * rand(22, 34);
    car.userData.hw = 1.5; car.userData.hl = 3; car.userData.h = 1.6; car.userData.box = true;
    car.castShadow = true;
    worldGroup.add(car);
    vehicles.push(car);
  }
}

// ------------------------------------------------------------------- character
function buildKitty(opts = {}) {
  const scaleRim = opts.rim || { color: 0x59e7ff, power: 2.6, strength: 0.8 };
  const skin = opts.skin || 0x6b4a2f;
  const g = new THREE.Group();
  const parts = { dreads: [], legs: [], arms: [] };

  const camo = makeCamoTexture(512, opts.camo || ['#30402a', '#4c6136', '#6d4a2f', '#1d2418']);
  const denim = makeDenimTexture(256, opts.denim || '#223047');

  // torso / hoodie
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.62, 6, 12),
    makeStylized({ map: camo, roughness: 0.85 }, scaleRim));
  torso.position.y = 1.15; torso.castShadow = true; g.add(torso);

  // head
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 20, 16),
    makeStylized({ color: skin, roughness: 0.6 }, scaleRim));
  head.position.y = 1.78; head.castShadow = true; g.add(head);
  // ears
  for (const sx of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.3, 12),
      makeStylized({ color: skin, roughness: 0.6 }, scaleRim));
    ear.position.set(sx * 0.2, 2.02, 0); ear.rotation.z = -sx * 0.3; g.add(ear);
    const inner = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.16, 10),
      new THREE.MeshStandardMaterial({ color: 0xff8fcf, emissive: 0xff5fd0, emissiveIntensity: 0.4 }));
    inner.position.set(sx * 0.2, 2.0, 0.03); inner.rotation.z = -sx * 0.3; g.add(inner);
  }
  // eyes (white glasses vibe)
  const glasses = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.08),
    new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.6 }));
  glasses.position.set(0, 1.82, 0.3); g.add(glasses);
  // snout
  const snout = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.14), makeStylized({ color: 0xffb0d8 }, scaleRim));
  snout.position.set(0, 1.72, 0.33); g.add(snout);

  // dreadlocks with neon tips
  for (let i = 0; i < 9; i++) {
    const dl = new THREE.Group();
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.7, 6),
      makeStylized({ color: 0x241019, roughness: 0.8 }, scaleRim));
    seg.position.y = -0.35; dl.add(seg);
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.03, 0.18, 6),
      new THREE.MeshStandardMaterial({ color: 0xff5fd0, emissive: 0xff5fd0, emissiveIntensity: 1.8 }));
    tip.position.y = -0.73; dl.add(tip);
    const a = (i / 9) * Math.PI * 2;
    dl.position.set(Math.cos(a) * 0.22, 2.0, Math.sin(a) * 0.22 - 0.05);
    dl.userData.phase = rand(0, 6.28);
    g.add(dl); parts.dreads.push(dl);
  }

  // chain
  const chain = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.03, 8, 20),
    new THREE.MeshStandardMaterial({ color: 0xffd766, metalness: 1, roughness: 0.2, emissive: 0x332200, emissiveIntensity: 0.4 }));
  chain.position.set(0, 1.4, 0.28); chain.rotation.x = 1.2; g.add(chain);

  // arms
  for (const sx of [-1, 1]) {
    const arm = new THREE.Group();
    const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.5, 4, 8), makeStylized({ map: camo, roughness: 0.85 }, scaleRim));
    upper.position.y = -0.25; arm.add(upper);
    arm.position.set(sx * 0.5, 1.4, 0);
    g.add(arm); parts.arms.push(arm);
  }

  // legs (cargo denim) + sneakers
  for (const sx of [-1, 1]) {
    const leg = new THREE.Group();
    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.7, 4, 8), makeStylized({ map: denim, roughness: 0.9 }, scaleRim));
    thigh.position.y = -0.45; leg.add(thigh);
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.16, 0.42),
      makeStylized({ color: 0xffffff, roughness: 0.5, emissive: 0x5fe0ff, emissiveIntensity: 0.3 }, scaleRim));
    shoe.position.set(0, -0.86, 0.08); leg.add(shoe);
    leg.position.set(sx * 0.2, 0.86, 0);
    g.add(leg); parts.legs.push(leg);
  }

  // skateboard backbling
  const board = new THREE.Group();
  const deck = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.08, 1.2),
    makeStylized({ color: 0x120a1e, roughness: 0.3, metalness: 0.4, emissive: 0xff5fd0, emissiveIntensity: 0.5 }, { color: 0xff5fd0, strength: 0.7 }));
  board.add(deck);
  for (const dz of [-0.4, 0.4]) for (const dx of [-0.16, 0.16]) {
    const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 10),
      new THREE.MeshStandardMaterial({ color: 0x5fe0ff, emissive: 0x5fe0ff, emissiveIntensity: 1.5 }));
    wh.rotation.z = Math.PI / 2; wh.position.set(dx, -0.09, dz); board.add(wh);
  }
  board.position.set(0, 1.2, -0.42); board.rotation.x = Math.PI / 2; // on back
  g.add(board); parts.board = board;

  // gun in right hand
  const gun = buildGunMesh(0xb9c4cf);
  gun.position.set(0.55, 1.25, 0.25);
  g.add(gun); parts.gun = gun;
  // muzzle flash
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5),
    new THREE.MeshBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  flash.position.set(0.55, 1.25, 0.95); g.add(flash); parts.flash = flash;

  // melee deck held (hidden by default)
  const deckMelee = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.07, 1.0),
    makeStylized({ color: 0x120a1e, emissive: 0xb6ff3a, emissiveIntensity: 0.6 }, { color: 0xb6ff3a, strength: 0.6 }));
  deckMelee.position.set(0.6, 1.2, 0.3); deckMelee.visible = false; g.add(deckMelee); parts.deckMelee = deckMelee;

  return { group: g, parts };
}

function buildGunMesh(color) {
  const grp = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.2, 0.6),
    new THREE.MeshStandardMaterial({ color: 0x15121c, metalness: 0.7, roughness: 0.4 }));
  grp.add(body);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.5, 8),
    new THREE.MeshStandardMaterial({ color: 0x0c0a12, metalness: 0.8, roughness: 0.3 }));
  barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.03, 0.45); grp.add(barrel);
  const accent = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.06, 0.3),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.4 }));
  accent.position.set(0, 0.13, 0.05); grp.add(accent);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.22, 0.12),
    new THREE.MeshStandardMaterial({ color: 0x222028, metalness: 0.6, roughness: 0.5 }));
  mag.position.set(0, -0.18, -0.05); grp.add(mag);
  grp.userData.accent = accent;
  return grp;
}

// ---- realistic rigged cat from the Flock Kitty art (player + Snow)
function buildRealCat(name, opts = {}) {
  const ch = makeCharacter(name);
  if (!ch) return null;
  const g = new THREE.Group();
  g.add(ch.root);
  const parts = { dreads: [], legs: [], arms: [] };
  const gun = buildGunMesh(opts.gunColor ?? 0xb9c4cf);
  gun.scale.setScalar(0.85);
  g.add(gun); parts.gun = gun;
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.45),
    new THREE.MeshBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  flash.position.set(0, 0.03, 0.78); gun.add(flash); parts.flash = flash;
  const board = new THREE.Group();
  board.add(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.08, 1.2),
    makeStylized({ color: 0x120a1e, roughness: 0.3, metalness: 0.4, emissive: 0xff5fd0, emissiveIntensity: 0.5 }, { color: 0xff5fd0, strength: 0.7 })));
  for (const dz of [-0.4, 0.4]) for (const dx of [-0.16, 0.16]) {
    const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 10),
      new THREE.MeshStandardMaterial({ color: 0x5fe0ff, emissive: 0x5fe0ff, emissiveIntensity: 1.5 }));
    wh.rotation.z = Math.PI / 2; wh.position.set(dx, -0.09, dz); board.add(wh);
  }
  board.position.set(0, 1.2, -0.26); board.rotation.x = Math.PI / 2;
  g.add(board); parts.board = board;
  const deckMelee = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.07, 1.0),
    makeStylized({ color: 0x120a1e, emissive: 0xb6ff3a, emissiveIntensity: 0.6 }, { color: 0xb6ff3a, strength: 0.6 }));
  deckMelee.visible = false; g.add(deckMelee); parts.deckMelee = deckMelee;
  return { group: g, parts, char: ch };
}
const _hp = new THREE.Vector3(), _hp2 = new THREE.Vector3(), _hd = new THREE.Vector3();
const _hm = new THREE.Matrix4(), _hq = new THREE.Quaternion(), _hq2 = new THREE.Quaternion(), _ZERO = new THREE.Vector3();
// put a child of a character group at a world position, +z pointing along a world direction
function placeHeld(obj, pos, dir) {
  const parent = obj.parent;
  _hm.copy(parent.matrixWorld).invert();
  obj.position.copy(pos).applyMatrix4(_hm);
  _hm.lookAt(dir, _ZERO, UP);
  _hq.setFromRotationMatrix(_hm);
  parent.getWorldQuaternion(_hq2);
  obj.quaternion.copy(_hq2.invert().multiply(_hq));
}
// gun / deck follow the right hand: along the aim when aiming, low-ready otherwise
function poseHeld(parts, ch, aimDir, faceDir) {
  const hand = ch.bones.RightHand;
  if (!hand) return;
  hand.getWorldPosition(_hp);
  if (aimDir) _hd.copy(aimDir);
  else { _hd.copy(faceDir); _hd.y -= 0.6; _hd.normalize(); }
  if (parts.gun.visible) {
    _hp2.copy(_hp).addScaledVector(_hd, 0.08); _hp2.y += 0.03;
    placeHeld(parts.gun, _hp2, _hd);
  }
  if (parts.deckMelee.visible) {
    _hp2.copy(_hp).addScaledVector(_hd, 0.42);
    placeHeld(parts.deckMelee, _hp2, _hd);
  }
}
const _aimPt = new THREE.Vector3(), _fd = new THREE.Vector3(), _sw = new THREE.Vector3();
function animatePlayerChar(p, dt, speed, isGun, isMelee) {
  const ch = p.char;
  p.airT = p.onGround ? 0 : (p.airT || 0) + dt;
  if (speed > 0.6 || !p.onGround || fireDown || p.skating) p.emote = false;
  let st = 'idle', ts = 1;
  if (p.freefall) st = 'fall';
  else if (!p.onGround) st = p.airT < 1.1 ? 'jump' : 'fall';
  else if (p.emote) st = 'dance';
  else if (p.skating) st = 'idle';
  else if (speed > 3.2) { st = 'run'; ts = clamp(speed / 8.5, 0.8, 1.3); }
  else if (speed > 0.5) { st = 'walk'; ts = clamp(speed / 2.6, 0.7, 1.4); }
  setAnim(ch, st, ts);
  if (p.emote) { p.parts.gun.visible = false; p.parts.deckMelee.visible = false; }
  ch.root.position.y = p.skating ? 0.16 : 0;
  ch.mixer.update(dt);
  p.group.updateMatrixWorld(true);
  _fd.set(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
  let aimDir = null;
  const sprinting = p.sprint && speed > 7 && !fireDown && !adsDown;
  if (isGun && !p.freefall && !p.emote && p.healT <= 0 && !sprinting) {
    getForward(_aimPt).multiplyScalar(60).add(camera.position);
    aimDir = aimArms(ch, _aimPt, true);
  } else if (isMelee && p.meleeT > 0) {
    const k = clamp(p.meleeT / 0.2, 0, 1); // 1 -> 0 over the swing: overhead to low
    _sw.copy(_fd).setY(lerp(-0.8, 0.9, k));
    aimArms(ch, _sw, false, true);
  }
  poseHeld(p.parts, ch, aimDir, _fd);
}

// ------------------------------------------------------------------- Player
function createPlayer() {
  const real = hasModel('hero') ? buildRealCat('hero') : null;
  const kitty = real || buildKitty({ rim: { color: 0x59e7ff, power: 2.4, strength: 0.9 } });
  scene.add(kitty.group);
  const p = {
    group: kitty.group, parts: kitty.parts, char: real ? real.char : null,
    meleeT: 0, emote: false, airT: 0,
    pos: new THREE.Vector3(POIS[1].x, 100, POIS[1].z),
    vel: new THREE.Vector3(),
    radius: 0.5, height: 1.9,
    yaw: 0, pitch: -0.05,
    onGround: false, freefall: true,
    sprint: false, skating: false, slideT: 0, healT: 0, healItem: null,
    hp: CONFIG.playerHP, maxHp: CONFIG.playerHP,
    shield: 0, maxShield: CONFIG.playerShield,
    mats: CONFIG.startMats, kills: 0,
    cam: { fov: 70, right: 0.9, up: 1.6, back: 3.6 },
    active: 1, lastFire: 0, reloadT: 0, walkPhase: 0, trailT: 0,
    // hotbar: 0 melee, 1-4 weapons/heals
    hotbar: [
      { kind: 'melee', ...MELEE, shortName: 'Deck' },
      makeWeapon('blaster', 'common'),
      null, null,
      { kind: 'heal', ...HEALS.matcha, shortName: 'Matcha', count: 2 },
    ],
  };
  p.hotbar[1].shortName = 'Blaster';
  // glider for drop-in
  const glider = new THREE.Mesh(new THREE.ConeGeometry(2.2, 1.4, 4, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x5fe0ff, emissive: 0x5fe0ff, emissiveIntensity: 1.2, transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
  glider.position.y = 3.2; glider.rotation.y = Math.PI / 4; p.group.add(glider); p.glider = glider;
  return p;
}

function activeItem() { return player.hotbar[player.active]; }

function updatePlayer(dt) {
  const p = player;
  // ---- look (applied from accumulated mouse handled in listeners) ----
  // ---- movement input ----
  const fwd = V.set(Math.sin(p.yaw), 0, Math.cos(p.yaw)).multiplyScalar(-1); // forward on xz
  const right = V2.set(fwd.z, 0, -fwd.x);
  let ix = 0, iz = 0;
  if (keys['KeyW']) iz += 1;
  if (keys['KeyS']) iz -= 1;
  if (keys['KeyD']) ix += 1;
  if (keys['KeyA']) ix -= 1;
  const moveDir = new THREE.Vector3().addScaledVector(fwd, iz).addScaledVector(right, ix);
  const moving = moveDir.lengthSq() > 0.001;
  if (moving) moveDir.normalize();

  // speeds
  let target = 6.2;
  p.sprint = !!keys['ShiftLeft'] || !!keys['ShiftRight'];
  if (p.sprint && moving) target = 9.2;
  if (p.skating) target = p.sprint ? 18 : 15;
  if (p.slideT > 0) target = 13;
  if (p.freefall) target = 11;

  // boost pads / grind while skating
  if (p.skating && p.onGround) {
    for (const bp of boostPads) if (dist2(p.pos.x, p.pos.z, bp.x, bp.z) < bp.r * bp.r) { target += 10; }
    for (const r of rails) {
      const d = pointSegDist(p.pos.x, p.pos.z, r.x1, r.z1, r.x2, r.z2);
      if (d < 2.0 && Math.abs(p.pos.y - r.y) < 2.5) { target += 7; if (Math.random() < 0.5) spawnSpark(V.set(p.pos.x, p.pos.y + 0.1, p.pos.z), 0x5fe0ff); }
    }
  }

  const accel = p.onGround ? 42 : 14;
  const desired = new THREE.Vector3(moveDir.x * target, 0, moveDir.z * target);
  p.vel.x = lerp(p.vel.x, desired.x, 1 - Math.exp(-accel * dt));
  p.vel.z = lerp(p.vel.z, desired.z, 1 - Math.exp(-accel * dt));
  if (!moving && p.onGround && p.slideT <= 0) {
    const fr = 1 - Math.exp(-(p.skating ? 3 : 12) * dt);
    p.vel.x -= p.vel.x * fr; p.vel.z -= p.vel.z * fr;
  }

  // gravity
  const g = p.freefall ? 9 : CONFIG.gravity;
  p.vel.y -= g * dt;
  if (p.freefall) p.vel.y = Math.max(p.vel.y, -16);

  // integrate
  p.pos.addScaledVector(p.vel, dt);
  // bounds
  p.pos.x = clamp(p.pos.x, -CONFIG.mapHalf + 2, CONFIG.mapHalf - 2);
  p.pos.z = clamp(p.pos.z, -CONFIG.mapHalf + 2, CONFIG.mapHalf - 2);

  // collide + ground
  resolveHorizontal(p.pos, p.radius, p.pos.y, p.height);
  const gh = groundHeightAt(p.pos.x, p.pos.z, p.pos.y);
  if (p.pos.y <= gh + 0.001) {
    p.pos.y = gh;
    if (p.vel.y < 0) p.vel.y = 0;
    if (!p.onGround && p.freefall) { p.freefall = false; p.glider.visible = false; }
    p.onGround = true;
  } else {
    p.onGround = false;
  }
  if (p.slideT > 0) p.slideT -= dt;

  // ---- mesh transform + animation ----
  p.group.position.copy(p.pos);
  p.group.rotation.y = p.yaw + Math.PI; // face forward
  const speed = Math.hypot(p.vel.x, p.vel.z);
  p.walkPhase += speed * dt * 2.2;
  const sw = Math.sin(p.walkPhase) * clamp(speed / 8, 0, 1) * 0.5;
  if (p.parts.legs[0]) { p.parts.legs[0].rotation.x = sw; p.parts.legs[1].rotation.x = -sw; }
  if (p.parts.arms[0] && !p.skating) { p.parts.arms[0].rotation.x = -sw * 0.6; }
  // dread sway
  for (const dl of p.parts.dreads) {
    dl.rotation.x = Math.sin(clock.elapsedTime * 3 + dl.userData.phase) * 0.12 - clamp(speed / 20, 0, 0.3) - p.vel.z * 0.01;
    dl.rotation.z = Math.cos(clock.elapsedTime * 2.5 + dl.userData.phase) * 0.1 + p.vel.x * 0.01;
  }
  // skateboard visual
  if (p.skating) {
    p.parts.board.visible = true;
    p.parts.board.position.set(0, 0.12, 0.15); p.parts.board.rotation.set(0, 0, 0);
    p.group.rotation.z = -p.vel.x * 0.02; // lean
    p.trailT -= dt;
    if (p.trailT <= 0 && speed > 6) { p.trailT = 0.04; spawnSkateTrail(); }
  } else {
    p.parts.board.visible = !p.char; // the rigged model keeps the deck stashed until V
    p.parts.board.position.set(0, 1.2, p.char ? -0.26 : -0.42); p.parts.board.rotation.x = Math.PI / 2;
    p.group.rotation.z = 0;
  }
  p.group.position.y = p.pos.y; // feet at pos.y
  // crouch during slide
  p.group.scale.y = p.slideT > 0 && !p.char ? 0.7 : 1;

  // weapon visibility
  const item = activeItem();
  const isGun = item && item.kind === 'gun';
  const isMelee = item && item.kind === 'melee';
  p.parts.gun.visible = isGun;
  p.parts.deckMelee.visible = isMelee || (build.selected != null);
  if (isGun && p.parts.gun.userData.accent) {
    p.parts.gun.userData.accent.material.color.set(item.color);
    p.parts.gun.userData.accent.material.emissive.set(item.color);
  }
  if (p.meleeT > 0) p.meleeT -= dt;
  if (p.char) animatePlayerChar(p, dt, speed, isGun, isMelee);
  // muzzle flash fade
  if (p.parts.flash.material.opacity > 0) p.parts.flash.material.opacity = Math.max(0, p.parts.flash.material.opacity - dt * 12);

  // reload
  if (p.reloadT > 0) {
    p.reloadT -= dt;
    hud.showReload(true, 1 - p.reloadT / (isGun ? item.reload : 1));
    if (p.reloadT <= 0 && isGun) { item.ammoInMag = item.mag; hud.showReload(false); }
  } else hud.showReload(false);

  // healing
  if (p.healT > 0) {
    p.healT -= dt;
    if (p.healT <= 0 && p.healItem) applyHeal(p.healItem);
  }
}

function pointSegDist(px, pz, x1, z1, x2, z2) {
  const dx = x2 - x1, dz = z2 - z1;
  const l2 = dx * dx + dz * dz || 1;
  let t = ((px - x1) * dx + (pz - z1) * dz) / l2;
  t = clamp(t, 0, 1);
  return Math.hypot(px - (x1 + t * dx), pz - (z1 + t * dz));
}

function spawnSkateTrail() {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5),
    new THREE.MeshBasicMaterial({ color: 0xff5fd0, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  m.position.set(player.pos.x, player.pos.y + 0.15, player.pos.z);
  m.rotation.x = -Math.PI / 2;
  addFx(m, 0.4, (o, t) => { o.material.opacity = 0.7 * t; o.scale.setScalar(1 + (1 - t) * 2); });
}

// ------------------------------------------------------------------- camera
function updateCamera(dt) {
  if (import.meta.env.VITE_GK_TEST && window.__gkCamHold) return;
  const p = player;
  // ADS lerp
  const adsT = (adsDown && activeItem() && activeItem().kind === 'gun') ? 1 : 0;
  p.cam.fov = lerp(p.cam.fov, lerp(70, 45, adsT), 1 - Math.exp(-12 * dt));
  // the rigged model is a full-height person: pull back and drop the arm so head-to-sneakers stays in frame
  const tall = !!p.char;
  const right = lerp(tall ? 0.85 : 0.9, tall ? 0.7 : 0.62, adsT), up = lerp(tall ? 0.95 : 1.6, tall ? 0.72 : 1.55, adsT), back = lerp(tall ? 4.4 : 3.6, tall ? 2.6 : 2.5, adsT);
  camera.fov = p.cam.fov; camera.updateProjectionMatrix();

  const focus = V.copy(p.pos); focus.y += p.char ? 1.45 : 1.5;
  const fwd = getForward(V2);
  const camRight = new THREE.Vector3().crossVectors(fwd, UP).normalize();
  let camPos = focus.clone().addScaledVector(fwd, -back).addScaledVector(camRight, right).addScaledVector(UP, up);

  // spring arm: raycast focus->camPos against solids meshes
  const dir = camPos.clone().sub(focus);
  const len = dir.length(); dir.normalize();
  rayc.set(focus, dir); rayc.far = len;
  const hits = rayc.intersectObjects(hitWorld.children, true);
  if (hits.length && hits[0].distance < len) {
    camPos = focus.clone().addScaledVector(dir, Math.max(0.6, hits[0].distance - 0.3));
  }
  camera.position.copy(camPos);
  camera.rotation.set(p.pitch, p.yaw, 0, 'YXZ');
}

function getForward(out) {
  const e = new THREE.Euler(player.pitch, player.yaw, 0, 'YXZ');
  return out.set(0, 0, -1).applyEuler(e);
}

// ------------------------------------------------------------------- combat
function tryFire() {
  const p = player, item = activeItem();
  if (!item) return;
  const now = clock.elapsedTime;
  if (item.kind === 'melee') {
    if (fireEdge || (fireDown && now - p.lastFire > 1 / item.fireRate)) {
      if (now - p.lastFire > 1 / item.fireRate) { p.lastFire = now; meleeSwing(); }
    }
    return;
  }
  if (item.kind === 'heal') { if (fireEdge) useHeal(); return; }
  if (item.kind !== 'gun') return;
  if (p.reloadT > 0 || p.healT > 0) return;
  if (item.ammoInMag <= 0) { startReload(); return; }
  const ready = now - p.lastFire >= 1 / item.fireRate;
  const want = item.auto ? fireDown : fireEdge;
  if (want && ready) { p.lastFire = now; fireGun(item); }
}

function fireGun(item) {
  const p = player;
  item.ammoInMag--;
  audio.gun(item.typeId);
  p.parts.flash.material.opacity = 1; p.parts.flash.scale.setScalar(rand(0.8, 1.4));
  // recoil kick
  p.pitch += rand(0.004, 0.012); p.recentFire = 0.12;
  const origin = camera.position.clone();
  const baseDir = getForward(new THREE.Vector3());
  const bloom = adsDown ? item.adsBloom : item.bloom;
  let muzzle;
  if (p.char) { p.parts.gun.updateMatrixWorld(true); muzzle = p.parts.gun.localToWorld(new THREE.Vector3(0, 0.03, 0.75)); }
  else muzzle = p.group.localToWorld(new THREE.Vector3(0.55, 1.25, 1.0));
  for (let pel = 0; pel < item.pellets; pel++) {
    const dir = baseDir.clone();
    dir.x += rand(-bloom, bloom); dir.y += rand(-bloom, bloom); dir.z += rand(-bloom, bloom);
    dir.normalize();
    rayc.set(origin, dir); rayc.far = item.range;
    const targets = [botGroup, buildGroup, hitWorld, propsGroup];
    const hits = rayc.intersectObjects(targets, true);
    let end = origin.clone().addScaledVector(dir, item.range);
    if (hits.length) {
      const h = hits[0]; end = h.point.clone();
      const bot = findBot(h.object);
      if (bot && bot.alive && !bot.companion) {
        const crit = h.point.y > bot.pos.y + 1.55;
        const dmg = item.dmg * (crit ? item.headMult : 1);
        damageBot(bot, dmg, h.point, crit);
      } else if (bot && bot.companion) {
        spawnSpark(h.point, 0x5fe0ff);
      } else {
        const bp = findProp(h.object);
        spawnSpark(h.point, 0xffd27a);
        if (bp) { /* guns chip props lightly */ bp.userData.prop.hp -= item.dmg * 0.4; if (bp.userData.prop.hp <= 0) breakProp(bp); }
        else damageBuild(h.object, item.dmg);
      }
    }
    spawnTracer(muzzle, end, item.color || 0xffe08a);
  }
}

function meleeSwing() {
  const p = player;
  // swing anim
  p.meleeT = 0.2;
  if (p.parts.arms[1]) { p.parts.arms[1].rotation.x = -1.2; setTimeout(() => { if (p.parts.arms[1]) p.parts.arms[1].rotation.x = 0; }, 120); }
  const origin = camera.position.clone();
  const dir = getForward(new THREE.Vector3());
  rayc.set(origin, dir); rayc.far = MELEE.range + 2;
  const hits = rayc.intersectObjects([propsGroup, botGroup], true);
  if (hits.length) {
    const h = hits[0];
    const prop = findProp(h.object);
    if (prop) {
      // weak-spot ring bonus
      const bonus = Math.random() < 0.3 ? 2 : 1;
      prop.userData.prop.hp -= MELEE.dmg;
      const gained = Math.min(MELEE.harvest * bonus, prop.userData.prop.mats);
      gainMats(gained);
      spawnWeakSpot(h.point, h.face ? h.face.normal : dir, bonus > 1);
      spawnSpark(h.point, 0xb6ff3a);
      if (prop.userData.prop.hp <= 0) breakProp(prop);
    } else {
      const bot = findBot(h.object);
      if (bot && bot.alive && !bot.companion) damageBot(bot, MELEE.dmg, h.point, false);
    }
  }
}

function spawnWeakSpot(point, normal, crit) {
  const m = new THREE.Mesh(new THREE.RingGeometry(0.12, 0.22, 20),
    new THREE.MeshBasicMaterial({ color: crit ? 0xff3b3b : 0x5fe0ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }));
  m.position.copy(point).addScaledVector(normal, 0.05);
  m.lookAt(point.clone().add(normal));
  addFx(m, 0.4, (o, t) => { o.material.opacity = t; o.scale.setScalar(1 + (1 - t) * 1.5); });
}

function breakProp(mesh) {
  if (!mesh.parent) return;
  spawnExplosion(mesh.position.clone().setY(mesh.position.y + (mesh.isMesh ? 0 : 0.8)), 0xb6ff3a);
  gainMats(mesh.userData.prop.mats * 0.5);
  propsGroup.remove(mesh);
  if (mesh.isMesh) mesh.geometry.dispose();
}

function gainMats(n) { player.mats = Math.min(CONFIG.maxMats, player.mats + n); }

function findBot(obj) { let o = obj; while (o) { if (o.userData && o.userData.botRef) return o.userData.botRef; o = o.parent; } return null; }
function findProp(obj) { let o = obj; while (o) { if (o.userData && o.userData.prop) return o; o = o.parent; } return null; }

function damageBot(bot, dmg, point, crit) {
  let remain = dmg, kind;
  if (bot.shield > 0) {
    const s = Math.min(bot.shield, remain); bot.shield -= s; remain -= s; kind = 'shield';
    if (remain > 0) { bot.hp -= remain; kind = 'health'; }
  } else { bot.hp -= remain; kind = 'health'; }
  if (crit) kind = 'crit';
  audio.hit(crit);
  hud.showHitmarker(crit);
  const sp = worldToScreen(point);
  if (sp.visible) hud.damageNumber(sp.x, sp.y, dmg, kind);
  if (bot.hp <= 0) killBot(bot, true);
}

function killBot(bot, byPlayer) {
  if (!bot.alive) return;
  bot.alive = false;
  spawnExplosion(bot.pos.clone().setY(bot.pos.y + 1), bot.companion ? 0x5fe0ff : 0xff3b3b);
  botGroup.remove(bot.group);
  if (byPlayer && !bot.companion) {
    player.kills++;
    audio.elim();
    const w = activeItem();
    const wn = w && w.kind === 'gun' ? w.shortName || w.name : (w && w.kind === 'melee' ? 'Deck' : 'KO');
    hud.addKill(`<b style="color:#b6ff3a">GlockKitty17</b> <span class="wn">[${wn}]</span> ⟶ <b>${bot.name}</b>`);
    hud.banner_('ELIMINATED ' + bot.name, '#ff5fd0', 1600);
  } else if (bot.companion) {
    hud.addKill(`<b>${bot.name}</b> was knocked out`);
  }
  // loot drop
  if (!bot.companion && Math.random() < 0.6) dropLoot(bot.pos.clone());
  updateAlive();
  if (aliveRivals() === 0) winMatch();
}

function aliveRivals() { return bots.filter((b) => b.alive && !b.companion).length; }
function updateAlive() { hud.setAlive(aliveRivals() + 1); }

function damageBuild(obj, dmg) {
  let o = obj; while (o && !(o.userData && o.userData.buildHp !== undefined)) o = o.parent;
  if (!o) return;
  o.userData.buildHp -= dmg;
  spawnSpark(o.position.clone(), 0x00f0ff);
  if (o.userData.buildHp <= 0) {
    buildGroup.remove(o);
    if (o.userData.collider) { const i = solids.indexOf(o.userData.collider); if (i >= 0) solids.splice(i, 1); }
    if (o.userData.floor) { const i = floors.indexOf(o.userData.floor); if (i >= 0) floors.splice(i, 1); }
    if (o.userData.ramp) { const i = ramps.indexOf(o.userData.ramp); if (i >= 0) ramps.splice(i, 1); }
  }
}

function damagePlayer(amt) {
  const p = player;
  if (matchOver) return;
  let remain = amt;
  if (p.shield > 0) { const s = Math.min(p.shield, remain); p.shield -= s; remain -= s; }
  if (remain > 0) p.hp -= remain;
  flashHurt();
  if (p.hp <= 0) { p.hp = 0; loseMatch(); }
}

let hurtEl;
function flashHurt() {
  if (!hurtEl) return;
  hurtEl.style.opacity = '0.5';
  clearTimeout(hurtEl._t);
  hurtEl._t = setTimeout(() => { hurtEl.style.opacity = '0'; }, 120);
}

// ------------------------------------------------------------------- heals
function useHeal() {
  const p = player;
  if (p.healT > 0) return;
  // find heal in hotbar
  let slot = -1;
  for (let i = 1; i < 5; i++) if (p.hotbar[i] && p.hotbar[i].kind === 'heal' && p.hotbar[i].count > 0) {
    if (p.hotbar[i].id === 'chugjug' || slot < 0) slot = i;
  }
  if (slot < 0) return;
  const item = p.hotbar[slot];
  if ((item.hp && p.hp >= p.maxHp && p.shield >= p.maxShield) || (!item.hp && p.shield >= p.maxShield)) return;
  p.healT = item.time; p.healItem = item; p.healSlot = slot;
  audio.shieldSip();
}
function applyHeal(item) {
  const p = player;
  if (item.shield) p.shield = Math.min(p.maxShield, p.shield + item.shield);
  if (item.hp) p.hp = Math.min(p.maxHp, p.hp + item.hp);
  item.count--;
  if (item.count <= 0) p.hotbar[p.healSlot] = null;
  p.healItem = null;
}

// ------------------------------------------------------------------- Bots
let botNameN = 0;
const BOT_NAMES = ['CyberRival', 'NeonGoon', 'ShutoShade', 'BassBandit', 'ChromeClaw', 'VaporViper', 'GlitchGato', 'SynthStray', 'MechaMouser', 'DriftDaemon', 'PixelPanther'];
const ROBOT_MODELS = ['roller', 'tower'];
const ROBOT_FACING = Math.PI; // the cam robots' lenses point down -z in the source models
function makeRobotMesh() {
  const avail = ROBOT_MODELS.filter(hasModel);
  if (!avail.length) return null;
  const m = makeProp(pick(avail), { h: 2.15 });
  const g = new THREE.Group(), body = new THREE.Group();
  m.rotation.y = ROBOT_FACING; body.add(m); g.add(body);
  // red threat ring on the ground so rivals read at a glance
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.9, 32),
    new THREE.MeshBasicMaterial({ color: 0xff3b3b, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05; g.add(ring);
  // the cam robots are skinny poles, so shots test against an invisible body-sized cylinder
  const hitbox = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.55, 2.15, 10), new THREE.MeshBasicMaterial({ visible: false }));
  hitbox.position.y = 1.075; g.add(hitbox);
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5),
    new THREE.MeshBasicMaterial({ color: 0xff8a8a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  flash.position.set(0, 1.75, 0.6); g.add(flash);
  return { group: g, parts: { dreads: [], legs: [], arms: [], flash, body } };
}
function makeBotMesh(companion) {
  if (companion && hasModel('snow')) {
    const k = buildRealCat('snow', { gunColor: 0x5fe0ff });
    if (k) { k.parts.gun.visible = true; return k; }
  }
  if (!companion) { const r = makeRobotMesh(); if (r) return r; }
  const color = companion ? 0x5fe0ff : 0xff3b3b;
  const k = buildKitty({
    rim: { color, power: 2.2, strength: 1.0 }, skin: companion ? 0x2a4a55 : 0x4a2a2a,
    camo: companion ? ['#13303a', '#1c4a55', '#0d2026', '#2a6070'] : ['#3a1a1a', '#5a2222', '#2a1010', '#701a1a'],
    denim: companion ? '#10303a' : '#3a1518',
  });
  k.parts.gun.visible = true;
  if (k.parts.gun.userData.accent) { k.parts.gun.userData.accent.material.color.set(color); k.parts.gun.userData.accent.material.emissive.set(color); }
  return k;
}
function spawnBots() {
  botNameN = 0;
  // companion
  const comp = new Bot(true);
  comp.pos.set(POIS[1].x + 3, 0, POIS[1].z + 3);
  bots.push(comp);
  for (let i = 0; i < CONFIG.botCount; i++) {
    const b = new Bot(false);
    const poi = pick(POIS);
    b.pos.set(poi.x + rand(-20, 20), 0, poi.z + rand(-20, 20));
    bots.push(b);
  }
  updateAlive();
}

class Bot {
  constructor(companion) {
    this.companion = companion;
    const k = makeBotMesh(companion);
    this.name = companion ? (k.char ? 'Snow' : 'Lil Snoop Switch-Bot') : (BOT_NAMES[botNameN++ % BOT_NAMES.length] + '_' + (10 + (Math.random() * 89 | 0)));
    this.group = k.group; this.parts = k.parts; this.char = k.char || null;
    this.aimT = 0; this.aimPt = new THREE.Vector3();
    this.group.userData.botRef = this;
    botGroup.add(this.group);
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.hp = companion ? 150 : 100; this.shield = companion ? 0 : (Math.random() < 0.5 ? 50 : 0);
    this.alive = true;
    this.state = 'wander';
    this.target = new THREE.Vector3();
    this.fireCd = rand(0.5, 2);
    this.think = 0; this.walkPhase = rand(0, 6);
    this.pingCd = rand(4, 10);
    this.giveCd = 10;
    this.pickTarget();
  }
  pickTarget() {
    const r = storm ? storm.radius * 0.8 : CONFIG.stormStartRadius;
    const cx = storm ? storm.cx : 0, cz = storm ? storm.cz : 0;
    const a = rand(0, 6.28), rr = rand(0, r);
    this.target.set(cx + Math.cos(a) * rr, 0, cz + Math.sin(a) * rr);
  }
  update(dt) {
    if (!this.alive) return;
    const toPlayer = V.copy(player.pos).sub(this.pos); toPlayer.y = 0;
    const pdist = toPlayer.length();

    if (this.companion) { this.updateCompanion(dt, pdist, toPlayer); }
    else {
      // vision
      const sees = pdist < 55 && hasLOS(this.pos, player.pos);
      this.think -= dt;
      if (this.state === 'wander') {
        if (sees) this.state = 'aggro';
        else {
          const toT = V2.copy(this.target).sub(this.pos); toT.y = 0;
          if (toT.length() < 3 || this.think <= 0) { this.pickTarget(); this.think = rand(3, 6); }
          this.moveToward(toT, 4.5, dt);
        }
      } else if (this.state === 'aggro') {
        if (!sees && this.think <= 0) { this.state = 'wander'; this.pickTarget(); }
        if (sees) this.think = 2.5;
        // strafe + maintain range
        const dir = toPlayer.clone().normalize();
        const strafe = V2.set(dir.z, 0, -dir.x).multiplyScalar(Math.sin(clock.elapsedTime * 1.5 + this.walkPhase));
        const want = new THREE.Vector3();
        if (pdist > 22) want.add(dir); else if (pdist < 12) want.sub(dir);
        want.add(strafe.multiplyScalar(0.6));
        this.moveToward(want, 5.5, dt);
        this.faceTo(player.pos);
        // shoot
        this.fireCd -= dt;
        if (sees && this.fireCd <= 0) {
          this.fireCd = rand(0.4, 1.1);
          this.shoot(pdist);
        }
        if (this.hp < 28 && Math.random() < 0.01) { this.state = 'flee'; this.pickTarget(); this.think = 3; }
      } else if (this.state === 'flee') {
        this.think -= dt;
        const away = this.pos.clone().sub(player.pos); away.y = 0;
        this.moveToward(away, 6, dt);
        if (this.think <= 0) this.state = 'wander';
      }
    }

    // storm damage
    if (storm && storm.outside(this.pos.x, this.pos.z)) {
      this.hp -= storm.dps * dt;
      if (this.hp <= 0) { killBot(this, false); return; }
      // steer to center
      const toC = V2.set(storm.cx - this.pos.x, 0, storm.cz - this.pos.z);
      this.moveToward(toC, 6, dt);
    }

    // integrate (simple: gravity to ground)
    this.vel.y -= CONFIG.gravity * dt;
    this.pos.addScaledVector(this.vel, dt);
    this.pos.x = clamp(this.pos.x, -CONFIG.mapHalf + 2, CONFIG.mapHalf - 2);
    this.pos.z = clamp(this.pos.z, -CONFIG.mapHalf + 2, CONFIG.mapHalf - 2);
    resolveHorizontal(this.pos, 0.5, this.pos.y, 1.9);
    const gh = groundHeightAt(this.pos.x, this.pos.z, this.pos.y);
    if (this.pos.y <= gh) { this.pos.y = gh; this.vel.y = 0; }
    this.group.position.copy(this.pos);
    // leg anim
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.walkPhase += sp * dt * 2.2;
    const sw = Math.sin(this.walkPhase) * clamp(sp / 6, 0, 1) * 0.5;
    if (this.parts.legs[0]) { this.parts.legs[0].rotation.x = sw; this.parts.legs[1].rotation.x = -sw; }
    for (const dl of this.parts.dreads) dl.rotation.x = Math.sin(clock.elapsedTime * 3 + dl.userData.phase) * 0.12 - 0.1;
    if (this.parts.flash.material.opacity > 0) this.parts.flash.material.opacity -= dt * 12;
    // face where they're going unless they're squaring up to someone
    if (sp > 0.6 && !this.companion && this.state !== 'aggro') this.group.rotation.y = Math.atan2(this.vel.x, this.vel.z);
    if (this.char) this.animateChar(dt, sp);
    else if (this.parts.body) {
      const b = this.parts.body;
      b.rotation.x = lerp(b.rotation.x, clamp(sp * 0.03, 0, 0.18), 1 - Math.exp(-6 * dt));
      b.position.y = Math.abs(Math.sin(this.walkPhase * 2)) * 0.05 * clamp(sp / 4, 0, 1);
    }
  }
  animateChar(dt, sp) {
    const ch = this.char;
    setAnim(ch, sp > 2.5 ? 'run' : sp > 0.4 ? 'walk' : 'idle', sp > 2.5 ? clamp(sp / 8.5, 0.7, 1.2) : 1);
    ch.mixer.update(dt);
    this.group.updateMatrixWorld(true);
    const ry = this.group.rotation.y;
    _fd.set(Math.sin(ry), 0, Math.cos(ry));
    let aimDir = null;
    if (this.aimT > 0) { this.aimT -= dt; aimDir = aimArms(ch, this.aimPt, true); }
    poseHeld(this.parts, ch, aimDir, _fd);
  }
  updateCompanion(dt, pdist, toPlayer) {
    // follow player
    if (pdist > 6) this.moveToward(toPlayer, 7, dt);
    else { this.vel.x *= 0.8; this.vel.z *= 0.8; }
    this.faceTo(player.pos);
    // attack nearest rival occasionally
    this.fireCd -= dt;
    let nearest = null, nd = 1e9;
    for (const b of bots) if (b.alive && !b.companion) { const d = this.pos.distanceTo(b.pos); if (d < nd) { nd = d; nearest = b; } }
    if (nearest && nd < 45 && this.fireCd <= 0 && hasLOS(this.pos, nearest.pos)) {
      this.fireCd = rand(0.6, 1.4); this.faceTo(nearest.pos);
      this.shootAt(nearest.pos);
      if (Math.random() < 0.5) damageBot(nearest, 12, nearest.pos.clone().setY(nearest.pos.y + 1.2), false);
    }
    // ping chests
    this.pingCd -= dt;
    if (this.pingCd <= 0) { this.pingCd = rand(8, 14); hud.banner_(`${this.char ? 'Snow' : 'Switch-Bot'} pinged ${chests.some((c) => c.bag) ? 'a money bag' : 'a loot chest'} nearby`, '#5fe0ff', 1500); }
    // hype drops
    this.giveCd -= dt;
    if (this.giveCd <= 0 && pdist < 10) { this.giveCd = 14; gainMats(20); hud.banner_(`${this.char ? 'Snow' : 'Switch-Bot'} dropped +20 Vibe Mats`, '#b6ff3a', 1400); }
  }
  moveToward(dir, speed, dt) {
    const d = dir.clone(); d.y = 0;
    if (d.lengthSq() > 0.001) d.normalize();
    this.vel.x = lerp(this.vel.x, d.x * speed, 1 - Math.exp(-10 * dt));
    this.vel.z = lerp(this.vel.z, d.z * speed, 1 - Math.exp(-10 * dt));
  }
  faceTo(p) { this.group.rotation.y = Math.atan2(p.x - this.pos.x, p.z - this.pos.z); }
  shoot(pdist) {
    this.shootAt(player.pos);
    this.parts.flash.material.opacity = 1;
    audio.gun('smg');
    // hit chance falls with distance
    const chance = clamp(0.5 - pdist * 0.006, 0.08, 0.5);
    if (Math.random() < chance && hasLOS(this.pos, player.pos)) {
      damagePlayer(rand(6, 12));
    }
  }
  shootAt(targetPos) {
    this.aimPt.copy(targetPos).setY(targetPos.y + 1.0); this.aimT = 0.6;
    let from = this.pos.clone().setY(this.pos.y + 1.3);
    if (this.char) { this.parts.gun.updateMatrixWorld(true); from = this.parts.gun.localToWorld(new THREE.Vector3(0, 0.03, 0.75)); }
    const to = targetPos.clone().setY(targetPos.y + 1.0);
    spawnTracer(from, to, this.companion ? 0x5fe0ff : 0xff5b5b);
    this.parts.flash.material.opacity = 1;
  }
}

function hasLOS(a, b) {
  const from = V.copy(a).setY(a.y + 1.3);
  const dir = V2.copy(b).setY(b.y + 1.1).sub(from);
  const len = dir.length(); dir.normalize();
  rayc.set(from, dir); rayc.far = len - 0.5;
  const hits = rayc.intersectObjects([hitWorld, buildGroup], true);
  return hits.length === 0;
}

// ------------------------------------------------------------------- loot
function randomLootItem() {
  const r = rand();
  if (r < 0.12) return { kind: 'heal', ...HEALS.chugjug, shortName: 'Chug Jug', count: 1 };
  if (r < 0.3) return { kind: 'heal', ...HEALS.matcha, shortName: 'Matcha', count: 2 };
  const type = pick(GUN_IDS);
  const w = makeWeapon(type, rollRarity());
  w.shortName = { blaster: 'Blaster', smg: 'SMG', shotgun: 'Shotgun', sniper: 'Sniper' }[type];
  return w;
}

function giveToPlayer(item) {
  const p = player;
  if (item.kind === 'heal') {
    for (let i = 1; i < 5; i++) if (p.hotbar[i] && p.hotbar[i].kind === 'heal' && p.hotbar[i].id === item.id) { p.hotbar[i].count += item.count; return item; }
  }
  for (let i = 1; i < 5; i++) if (!p.hotbar[i]) { p.hotbar[i] = item; return item; }
  // replace active if it's a gun upgrade
  p.hotbar[p.active && p.active > 0 ? p.active : 1] = item;
  return item;
}

function dropLoot(pos) {
  const item = randomLootItem();
  const color = item.kind === 'gun' ? new THREE.Color(item.color) : new THREE.Color(0xff5fd0);
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.2 }));
  box.position.copy(pos).setY(0.6);
  box.userData.loot = item;
  // rarity beam
  const beam = makeBeam(item.kind === 'gun' ? RARITY[item.rarity].glow : 0xff5fd0);
  beam.position.copy(pos).setY(3);
  box.add(beam);
  lootGroup.add(box);
}

function makeBeam(color) {
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 6, 12, 1, true),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  beam.userData.spin = true;
  return beam;
}

// ------------------------------------------------------------------- Chests
function spawnChests() {
  for (const poi of POIS) {
    const n = 2 + (Math.random() * 2 | 0);
    for (let i = 0; i < n; i++) {
      const x = poi.x + rand(-18, 18), z = poi.z + rand(-18, 18);
      chests.push(new Chest(x, z));
    }
  }
}
class Chest {
  constructor(x, z) {
    this.rarity = rollRarity(1);
    this.opened = false;
    const col = RARITY[this.rarity].glow;
    this.group = new THREE.Group();
    const bag = hasModel('moneybag') ? makeProp('moneybag', { h: 1.25 }) : null;
    if (bag) this.makeBag(bag, col);
    else this.makeBox(col);
    this.beam = makeBeam(col); this.beam.position.y = 3; this.group.add(this.beam);
    const glow = new THREE.PointLight(col, 2, 8); glow.position.y = 1.2; this.group.add(glow);
    this.group.position.set(x, 0, z);
    this.x = x; this.z = z;
    lootGroup.add(this.group);
  }
  makeBag(bag, col) {
    this.bag = true;
    bag.rotation.y = rand(0, Math.PI * 2);
    this.group.add(bag); this.lid = bag;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.75, 0.95, 32),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.04; this.group.add(ring);
  }
  makeBox(col) {
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 0.9),
      makeStylized({ color: 0x1c1430, roughness: 0.4, metalness: 0.5, emissive: col, emissiveIntensity: 0.5 }, { color: col, strength: 0.8 }));
    base.position.y = 0.4; base.castShadow = true;
    this.group.add(base);
    this.lid = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.3, 0.95),
      makeStylized({ color: 0x241a3e, emissive: col, emissiveIntensity: 0.8 }, { color: col, strength: 0.9 }));
    this.lid.position.set(0, 0.85, -0.45); this.lid.geometry.translate(0, 0, 0.45);
    this.group.add(this.lid);
  }
  open() {
    if (this.opened) return;
    this.opened = true;
    audio.openChest();
    if (this.bag) { this.lid.rotation.z = 1.35; this.lid.position.x = 0.45; }
    else this.lid.rotation.x = -1.2;
    this.group.remove(this.beam);
    const given = [];
    given.push(giveToPlayer(randomLootItem()));
    if (Math.random() < 0.6) given.push(giveToPlayer(randomLootItem()));
    gainMats(25);
    const g0 = given[0];
    const label = g0.kind === 'gun' ? `${RARITY[g0.rarity].name} ${g0.shortName}` : g0.shortName;
    hud.banner_('LOOTED: ' + label.toUpperCase() + ' +25 MATS',
      g0.kind === 'gun' ? RARITY[g0.rarity].color : '#ff5fd0', 2000);
  }
}

// ------------------------------------------------------------------- Build
class BuildSystem {
  constructor() {
    this.selected = null; // 'wall'|'ramp'|'floor'
    this.ghost = new THREE.Group();
    this.valid = true;
    const ghostMat = () => new THREE.MeshBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.meshes = {
      wall: new THREE.Mesh(new THREE.BoxGeometry(CONFIG.gridSize, CONFIG.gridSize, 0.3), ghostMat()),
      floor: new THREE.Mesh(new THREE.BoxGeometry(CONFIG.gridSize, 0.3, CONFIG.gridSize), ghostMat()),
      ramp: new THREE.Mesh(new THREE.BoxGeometry(CONFIG.gridSize, 0.3, CONFIG.gridSize * 1.42), ghostMat()),
    };
    for (const k in this.meshes) { this.meshes[k].visible = false; this.ghost.add(this.meshes[k]); }
    // scanline wireframe overlay
    scene.add(this.ghost);
  }
  select(type) {
    if (this.selected === type) { this.selected = null; }
    else this.selected = type;
    for (const k in this.meshes) this.meshes[k].visible = false;
  }
  cancel() { this.selected = null; for (const k in this.meshes) this.meshes[k].visible = false; }
  cellInFront() {
    const fwd = getForward(new THREE.Vector3()); fwd.y = 0; fwd.normalize();
    const gx = Math.round((player.pos.x + fwd.x * CONFIG.gridSize) / CONFIG.gridSize) * CONFIG.gridSize;
    const gz = Math.round((player.pos.z + fwd.z * CONFIG.gridSize) / CONFIG.gridSize) * CONFIG.gridSize;
    const gy = groundHeightAt(gx, gz, player.pos.y);
    return { gx, gz, gy, fwd };
  }
  update() {
    if (!this.selected) return;
    const m = this.meshes[this.selected];
    for (const k in this.meshes) this.meshes[k].visible = (k === this.selected);
    const { gx, gz, gy, fwd } = this.cellInFront();
    const yaw = Math.round((Math.atan2(fwd.x, fwd.z)) / (Math.PI / 2)) * (Math.PI / 2);
    if (this.selected === 'wall') { m.position.set(gx, gy + CONFIG.gridSize / 2, gz); m.rotation.y = yaw; }
    else if (this.selected === 'floor') { m.position.set(gx, gy + 0.15, gz); m.rotation.y = 0; }
    else { m.position.set(gx, gy + CONFIG.gridSize / 2, gz); m.rotation.set(-Math.PI / 5, yaw, 0); }
    this.valid = player.mats >= CONFIG.buildCost;
    m.material.color.set(this.valid ? 0x00f0ff : 0xff2a55);
    m.material.opacity = 0.35 + 0.15 * Math.sin(clock.elapsedTime * 8);
  }
  place() {
    if (!this.selected || player.mats < CONFIG.buildCost) return;
    const { gx, gz, gy, fwd } = this.cellInFront();
    const yaw = Math.round((Math.atan2(fwd.x, fwd.z)) / (Math.PI / 2)) * (Math.PI / 2);
    const col = 0x5fe0ff;
    let mesh, mat = makeStylized({ color: 0x2a1850, roughness: 0.5, metalness: 0.3, emissive: col, emissiveIntensity: 0.6 }, { color: col, power: 2.5, strength: 0.7 });
    if (this.selected === 'wall') {
      mesh = new THREE.Mesh(new THREE.BoxGeometry(CONFIG.gridSize, CONFIG.gridSize, 0.35), mat);
      mesh.position.set(gx, gy + CONFIG.gridSize / 2, gz); mesh.rotation.y = yaw;
      const alongX = Math.abs(Math.cos(yaw)) > 0.5;
      const collider = { minx: gx - (alongX ? CONFIG.gridSize / 2 : 0.3), maxx: gx + (alongX ? CONFIG.gridSize / 2 : 0.3), minz: gz - (alongX ? 0.3 : CONFIG.gridSize / 2), maxz: gz + (alongX ? 0.3 : CONFIG.gridSize / 2), baseY: gy, top: gy + CONFIG.gridSize };
      solids.push(collider); mesh.userData.collider = collider;
    } else if (this.selected === 'floor') {
      mesh = new THREE.Mesh(new THREE.BoxGeometry(CONFIG.gridSize, 0.3, CONFIG.gridSize), mat);
      mesh.position.set(gx, gy + 0.15, gz);
      const f = { minx: gx - CONFIG.gridSize / 2, maxx: gx + CONFIG.gridSize / 2, minz: gz - CONFIG.gridSize / 2, maxz: gz + CONFIG.gridSize / 2, y: gy + 0.3 };
      floors.push(f); mesh.userData.floor = f;
    } else {
      mesh = new THREE.Mesh(new THREE.BoxGeometry(CONFIG.gridSize, 0.3, CONFIG.gridSize * 1.42), mat);
      mesh.position.set(gx, gy + CONFIG.gridSize / 2, gz); mesh.rotation.set(-Math.PI / 5, yaw, 0);
      const r = { minx: gx - CONFIG.gridSize / 2, maxx: gx + CONFIG.gridSize / 2, minz: gz - CONFIG.gridSize / 2, maxz: gz + CONFIG.gridSize / 2, y0: gy, y1: gy + CONFIG.gridSize, axis: Math.abs(Math.cos(yaw)) > 0.5 ? 'x' : 'z', dir: 1 };
      ramps.push(r); mesh.userData.ramp = r;
    }
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.userData.buildHp = CONFIG.buildHealth;
    buildGroup.add(mesh);
    player.mats -= CONFIG.buildCost;
    audio.build();
    // materialize animation (non-destructive tween, does NOT reparent the piece)
    mesh.scale.y = 0.05;
    anims.push({ obj: mesh, t: 0, dur: 0.25, fn: (o, k) => { o.scale.y = lerp(0.05, 1, k); } });
  }
}

// ------------------------------------------------------------------- Storm
class Storm {
  constructor() {
    this.cx = 0; this.cz = 0; this.radius = CONFIG.stormStartRadius;
    this.ncx = 0; this.ncz = 0; this.nextRadius = CONFIG.storm[0].radius;
    this.phase = 'hold'; this.idx = 0; this.timer = CONFIG.storm[0].hold; this.dps = 0;
    this.mesh = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 120, 48, 1, true), makeStormMaterial());
    this.mesh.position.y = 40;
    scene.add(this.mesh);
    this.pickNext();
  }
  pickNext() {
    const ph = CONFIG.storm[this.idx];
    if (!ph) { this.nextRadius = this.radius; return; }
    const maxOff = Math.max(0, this.radius - ph.radius);
    const a = rand(0, 6.28), off = rand(0, maxOff);
    this.ncx = this.cx + Math.cos(a) * off;
    this.ncz = this.cz + Math.sin(a) * off;
    this.nextRadius = ph.radius;
  }
  outside(x, z) { return dist2(x, z, this.cx, this.cz) > this.radius * this.radius; }
  update(dt) {
    const ph = CONFIG.storm[this.idx];
    this.mesh.material.uniforms.uTime.value = clock.elapsedTime;
    if (ph) {
      this.timer -= dt;
      if (this.phase === 'hold') {
        this.dps = this.idx > 0 ? CONFIG.storm[this.idx - 1].dps : 1;
        if (this.timer <= ph.hold - 0.01 && this.phase === 'hold' && !this._warned) {
          this._warned = true; audio.stormAlarm(); hud.banner_('⚠ THE BASS STORM IS CLOSING IN', '#ff3ea5', 2600);
        }
        if (this.timer <= 0) { this.phase = 'shrink'; this.timer = ph.shrink; }
      } else {
        const t = 1 - this.timer / ph.shrink;
        this.radius = lerp(this._r0 ?? this.radius, ph.radius, clamp(t, 0, 1));
        if (this._r0 === undefined) this._r0 = this.radius;
        this.cx = lerp(this._cx0 ?? this.cx, this.ncx, clamp(t, 0, 1));
        this.cz = lerp(this._cz0 ?? this.cz, this.ncz, clamp(t, 0, 1));
        this.dps = ph.dps;
        if (this._cx0 === undefined) { this._cx0 = this.cx; this._cz0 = this.cz; }
        if (this.timer <= 0) {
          this.radius = ph.radius; this.cx = this.ncx; this.cz = this.ncz;
          this.idx++; this.phase = 'hold'; this._warned = false;
          this._r0 = this._cx0 = this._cz0 = undefined;
          const nph = CONFIG.storm[this.idx];
          this.timer = nph ? nph.hold : 999;
          this.pickNext();
        }
      }
    } else { this.dps = CONFIG.storm[CONFIG.storm.length - 1].dps; }
    // visual
    this.mesh.position.set(this.cx, 40, this.cz);
    this.mesh.scale.set(this.radius, 1, this.radius);
    // player damage
    if (this.outside(player.pos.x, player.pos.z)) {
      damagePlayer(this.dps * dt);
      if (stormVignette) stormVignette.style.opacity = '0.6';
    } else if (stormVignette) stormVignette.style.opacity = '0';
  }
}

// ------------------------------------------------------------------- match flow
function startMatch() {
  matchOver = false; running = true;
  // reset player
  bots.length = 0; chests.length = 0;
  botGroup.clear(); lootGroup.clear(); buildGroup.clear();
  solids.length = 0; floors.length = 0; ramps.length = 0;
  rebuildStaticColliders();
  if (storm) { scene.remove(storm.mesh); }
  if (player) scene.remove(player.group);
  player = createPlayer();
  build = new BuildSystem();
  storm = new Storm();
  spawnChests();
  spawnBots();
  hud.showScreen(null);
  hud.banner_('DROPPING INTO NEO-TOKYO 85', '#5fe0ff', 2200);
  audio.startBeat();
}

// static colliders (buildings/highway) persist; rebuild the arrays that gameplay mutates
let staticSolids = [], staticFloors = [], staticRamps = [], staticTops = [];
function snapshotStatic() {
  staticSolids = solids.slice(); staticFloors = floors.slice(); staticRamps = ramps.slice(); staticTops = tops.slice();
}
function rebuildStaticColliders() {
  solids.length = 0; floors.length = 0; ramps.length = 0;
  for (const s of staticSolids) solids.push(s);
  for (const f of staticFloors) floors.push(f);
  for (const r of staticRamps) ramps.push(r);
  tops.length = 0; for (const t of staticTops) tops.push(t);
}

function winMatch() {
  if (matchOver) return;
  matchOver = true; running = false;
  audio.stopBeat();
  const btn = hud.showScreen('victory', { kills: player.kills });
  if (document.exitPointerLock) document.exitPointerLock();
  if (btn) btn.onclick = restart;
}
function loseMatch() {
  if (matchOver) return;
  matchOver = true; running = false;
  audio.stopBeat();
  const place = aliveRivals() + 1;
  const btn = hud.showScreen('defeat', { kills: player.kills, place });
  if (document.exitPointerLock) document.exitPointerLock();
  if (btn) btn.onclick = restart;
}
function lockPointer() {
  if (locked || lookFallback) return;
  const el = renderer.domElement;
  try {
    const r = el.requestPointerLock ? el.requestPointerLock() : null;
    if (r && typeof r.catch === 'function') r.catch(() => { lookFallback = true; });
  } catch (e) { lookFallback = true; }
}
function restart() { startMatch(); lockPointer(); }

// ------------------------------------------------------------------- loop
function update(dt) {
  if (!running) return;
  // dynamic solids (vehicles) refresh
  dynamicSolids.length = 0;
  const roadY = 9;
  for (const car of vehicles) {
    car.position.z += car.userData.speed * dt;
    if (car.position.z > CONFIG.mapHalf) car.position.z = -CONFIG.mapHalf;
    if (car.position.z < -CONFIG.mapHalf) car.position.z = CONFIG.mapHalf;
    const u = car.userData;
    dynamicSolids.push({ minx: car.position.x - u.hw, maxx: car.position.x + u.hw, minz: car.position.z - u.hl, maxz: car.position.z + u.hl, baseY: roadY + 0.3, top: roadY + 0.3 + u.h });
  }

  updatePlayer(dt);
  tryFire();
  fireEdge = false;
  updateCamera(dt);
  build.update();
  for (const b of bots) b.update(dt);
  storm.update(dt);

  // loot pickup + beam spin
  for (let i = lootGroup.children.length - 1; i >= 0; i--) {
    const l = lootGroup.children[i];
    l.traverse((o) => { if (o.userData.spin) o.rotation.y += dt * 2; });
    if (l.userData.loot) {
      l.rotation.y += dt * 2;
      if (dist2(l.position.x, l.position.z, player.pos.x, player.pos.z) < 2.5) {
        giveToPlayer(l.userData.loot);
        const it = l.userData.loot;
        hud.banner_('PICKED UP ' + (it.shortName || it.name).toUpperCase(), it.kind === 'gun' ? RARITY[it.rarity].color : '#ff5fd0', 1400);
        lootGroup.remove(l);
      }
    }
  }

  // chest interact
  let near = null, nd = 3.6 * 3.6;
  for (const c of chests) { if (c.opened) continue; const d = dist2(c.x, c.z, player.pos.x, player.pos.z); if (d < nd) { nd = d; near = c; } }
  player._nearChest = near;
  if (near) hud.showInteract(near.bag ? `<b>E</b> &nbsp;Grab ${RARITY[near.rarity].name} Money Bag` : `<b>E</b> &nbsp;Open ${RARITY[near.rarity].name} Chest`);
  else hud.showInteract(null);

  // speed lines intensity
  let sl = 0;
  if (player.freefall) sl = 0.8;
  else if (player.skating) sl = 0.6;
  else if (player.sprint && Math.hypot(player.vel.x, player.vel.z) > 7) sl = 0.3;
  speedLineTarget = sl;
  comp.speedPass.uniforms.uIntensity.value = lerp(comp.speedPass.uniforms.uIntensity.value, speedLineTarget, 1 - Math.exp(-6 * dt));
  comp.speedPass.uniforms.uTime.value = clock.elapsedTime;

  // sun follows player (tight shadow frustum)
  lights.sun.position.set(player.pos.x + 60, 120, player.pos.z + 40);
  lights.sun.target.position.copy(player.pos);
  lights.sun.target.updateMatrixWorld();

  // non-destructive tweens (e.g. build materialize)
  for (let i = anims.length - 1; i >= 0; i--) {
    const a = anims[i];
    a.t += dt;
    const k = clamp(a.t / a.dur, 0, 1);
    a.fn(a.obj, k);
    if (k >= 1) anims.splice(i, 1);
  }

  // fx lifetimes
  for (let i = fx.length - 1; i >= 0; i--) {
    const o = fx[i];
    o.userData._life -= dt;
    const t = clamp(o.userData._life / o.userData._max, 0, 1);
    if (o.userData._upd) o.userData._upd(o, t, dt);
    if (o.userData._life <= 0) {
      fxGroup.remove(o);
      if (o.geometry && o.parent !== buildGroup) o.geometry.dispose?.();
      fx.splice(i, 1);
    }
  }

  // HUD
  hud.setHealth(player.hp, player.maxHp);
  hud.setShield(player.shield, player.maxShield);
  hud.setMats(player.mats);
  hud.setHotbar(player.hotbar, player.active, build.selected != null);
  // crosshair spread
  const item = activeItem();
  let spread = 10;
  if (item && item.kind === 'gun') {
    const b = adsDown ? item.adsBloom : item.bloom;
    spread = 6 + b * 900 + Math.hypot(player.vel.x, player.vel.z) * 1.4;
  }
  hud.setCrosshair(spread, !matchOver && (locked || lookFallback));
  hud.drawMinimap({
    mapHalf: CONFIG.mapHalf, pois: POIS,
    highway: { x1: 20, z1: -CONFIG.mapHalf, x2: 20, z2: CONFIG.mapHalf },
    player: { x: player.pos.x, z: player.pos.z, angle: player.yaw + Math.PI },
    bots: bots.map((b) => ({ x: b.pos.x, z: b.pos.z, alive: b.alive, companion: b.companion })),
    storm: { cx: storm.cx, cz: storm.cz, radius: storm.radius, nextRadius: storm.nextRadius, ncx: storm.ncx, ncz: storm.ncz, phase: storm.phase === 'hold' && storm.idx < CONFIG.storm.length ? 'warning' : storm.phase },
  });
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  update(dt);
  if (comp) comp.composer.render();
  else renderer.render(scene, camera);
}

// ------------------------------------------------------------------- input
function setupInput(canvas) {
  canvas.addEventListener('click', () => { if (running) lockPointer(); });
  document.addEventListener('pointerlockchange', () => { locked = document.pointerLockElement === canvas; if (locked) lookFallback = false; });
  document.addEventListener('pointerlockerror', () => { lookFallback = true; });
  document.addEventListener('mousemove', (e) => {
    if (!locked && !(lookFallback && running)) return;
    const s = 0.0022;
    player.yaw -= e.movementX * s;
    player.pitch -= e.movementY * s;
    player.pitch = clamp(player.pitch, -1.3, 1.3);
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('mousedown', (e) => {
    if (!running) return;
    if (e.button === 0) {
      if (build && build.selected) build.place();
      else { fireDown = true; fireEdge = true; }
    } else if (e.button === 2) adsDown = true;
  });
  document.addEventListener('mouseup', (e) => {
    if (e.button === 0) fireDown = false;
    else if (e.button === 2) adsDown = false;
  });
  document.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    if (!running || e.repeat) return;
    switch (e.code) {
      case 'KeyV': if (player.onGround) { player.skating = !player.skating; } break;
      case 'KeyC': if (player.onGround && player.slideT <= 0) { player.slideT = 0.6; const f = getForward(new THREE.Vector3()); f.y = 0; f.normalize(); player.vel.x += f.x * 6; player.vel.z += f.z * 6; } break;
      case 'Space': if (player.onGround && !player.freefall) { player.vel.y = 10; player.onGround = false; audio.jump(); } break;
      case 'KeyQ': build.select('wall'); break;
      case 'KeyE': if (player._nearChest) player._nearChest.open(); else build.select('ramp'); break;
      case 'KeyR': build.select('floor'); break;
      case 'KeyF': build.cancel(); break;
      case 'KeyG': useHeal(); break;
      case 'KeyB': if (player.char && player.onGround && !player.freefall) player.emote = !player.emote; break;
      case 'Digit1': player.active = 0; build.cancel(); break;
      case 'Digit2': player.active = 1; build.cancel(); break;
      case 'Digit3': player.active = 2; build.cancel(); break;
      case 'Digit4': player.active = 3; build.cancel(); break;
      case 'Digit5': player.active = 4; build.cancel(); break;
    }
  });
  document.addEventListener('keyup', (e) => { keys[e.code] = false; });
  window.addEventListener('resize', () => {
    W = window.innerWidth; H = window.innerHeight;
    renderer.setSize(W, H);
    camera.aspect = W / H; camera.updateProjectionMatrix();
    comp.setSize(W, H);
  });
}

// ------------------------------------------------------------------- sky
// night gradient with a magenta glow sitting right on the horizon behind the painted skyline
function makeSkyBackground() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 512;
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 512);
  gr.addColorStop(0, '#07051a'); gr.addColorStop(0.3, '#150b36'); gr.addColorStop(0.43, '#30145a');
  gr.addColorStop(0.485, '#7a2a86'); gr.addColorStop(0.5, '#b0408f'); gr.addColorStop(0.52, '#2a1240'); gr.addColorStop(1, '#06040c');
  g.fillStyle = gr; g.fillRect(0, 0, 1024, 512);
  for (let i = 0; i < 260; i++) {
    const y = Math.random() ** 1.6 * 200;
    g.fillStyle = `rgba(255,255,255,${(0.25 + Math.random() * 0.6) * (1 - y / 230)})`;
    g.fillRect(Math.random() * 1024, y, Math.random() < 0.1 ? 2 : 1, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ------------------------------------------------------------------- init
let stormVignette;
async function init() {
  const canvas = document.getElementById('game');
  renderer = createRenderer(canvas);
  // if the GPU drops the context (out of memory, tab backgrounded on a phone) say so instead of freezing on a black frame
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault(); running = false;
    const o = document.getElementById('overlay');
    if (o) o.innerHTML = `<div style="position:absolute;inset:0;display:flex;flex-direction:column;gap:18px;align-items:center;justify-content:center;color:#ff5fd0;font:700 18px system-ui,sans-serif;text-align:center;padding:40px;background:#07051acc">The graphics card ran out of memory.<button onclick="location.reload()" style="font:700 16px system-ui;padding:10px 22px;border-radius:10px;border:0;background:#ff5fd0;color:#07051a">RELOAD</button></div>`;
  });
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(70, W / H, 0.1, 1000);
  camera.position.set(0, 10, 20);
  lights = setupEnvironment(renderer, scene);
  scene.background = makeSkyBackground();
  comp = createComposer(renderer, scene, camera);

  const ov = document.getElementById('overlay');
  const loading = document.createElement('div');
  loading.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#ff5fd0;font:700 18px system-ui,sans-serif;letter-spacing:.12em;text-shadow:0 0 12px #ff5fd0';
  loading.textContent = 'LOADING NEO-TOKYO 85…';
  if (ov) ov.appendChild(loading);
  await new Promise((r) => setTimeout(r, 0));
  await loadArt(renderer).catch((e) => console.warn('[GK7 art]', e));
  loading.remove();

  buildWorld();
  snapshotStatic();

  hud = new HUD(document.getElementById('overlay'));
  hurtEl = document.getElementById('hurt');
  stormVignette = document.getElementById('storm-vig');
  audio = new AudioSynth();

  // temp player so camera/update have something before match starts
  player = createPlayer(); player.pos.set(0, 40, 0);
  build = new BuildSystem();
  storm = new Storm();

  setupInput(canvas);

  const btn = hud.showScreen('start');
  if (btn) btn.onclick = () => { audio.resume(); startMatch(); lockPointer(); };

  animate();
}

init().catch((err) => {
  console.error(err);
  const o = document.getElementById('overlay');
  if (o) o.innerHTML = `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#ff5fd0;font:16px monospace;text-align:center;padding:40px">Failed to start Glock Kitty 7:<br>${err?.message || err}<br><br>This game needs a browser with WebGL.</div>`;
});

// headless test hook — only present in builds made with VITE_GK_TEST=1
if (import.meta.env.VITE_GK_TEST) {
  window.__gk = {
    get player() { return player; }, get bots() { return bots; }, get storm() { return storm; }, get build() { return build; },
    get chests() { return chests; }, get camera() { return camera; }, get scene() { return scene; },
    get running() { return running; }, get matchOver() { return matchOver; }, get locked() { return locked; },
    get buildGroup() { return buildGroup; }, get botGroup() { return botGroup; }, get lootGroup() { return lootGroup; },
    startMatch, winMatch, killBot, damageBot, aliveRivals, CONFIG, keys, update, getForward,
    ART, hasModel, makeProp, vehicles, get propsGroup() { return propsGroup; }, get worldGroup() { return worldGroup; }, get hitWorld() { return hitWorld; },
    setAds(v) { adsDown = v; }, setFire(v) { fireDown = v; fireEdge = v; }, setLocked(v) { locked = v; },
  };
}

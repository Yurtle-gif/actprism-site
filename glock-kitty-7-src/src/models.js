// models.js — the Flock Kitty art in 3D: rigged realistic cat + Snow, cars, cam
// robots, street props, money bag, plus the painted storefront / facade /
// billboard / skyline textures. Everything ships inside the single HTML file:
// GLBs are gzip'd and inlined as data URIs, decoded with DecompressionStream
// (no fetch, no WebAssembly), and their textures go through TextureLoader.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';

import heroUrl from './assets/models/hero.glb.gz?url';
import snowUrl from './assets/models/snow.glb.gz?url';
import lamboGreenUrl from './assets/models/lambo_green.glb.gz?url';
import lamboOrangeUrl from './assets/models/lambo_orange.glb.gz?url';
import gwagonUrl from './assets/models/gwagon.glb.gz?url';
import cruiserUrl from './assets/models/cruiser.glb.gz?url';
import rollerUrl from './assets/models/roller.glb.gz?url';
import towerUrl from './assets/models/tower.glb.gz?url';
import palmUrl from './assets/models/palm.glb.gz?url';
import treeUrl from './assets/models/tree.glb.gz?url';
import lampUrl from './assets/models/lamp.glb.gz?url';
import coneUrl from './assets/models/cone.glb.gz?url';
import barrierUrl from './assets/models/barrier.glb.gz?url';
import hydrantUrl from './assets/models/hydrant.glb.gz?url';
import dumpsterUrl from './assets/models/dumpster.glb.gz?url';
import benchUrl from './assets/models/bench.glb.gz?url';
import campoleUrl from './assets/models/campole.glb.gz?url';
import moneybagUrl from './assets/models/moneybag.glb.gz?url';

import frontSfUrl from './assets/tex/front_sf.webp?url';
import frontOakUrl from './assets/tex/front_oak.webp?url';
import frontSjUrl from './assets/tex/front_sj.webp?url';
import upBrickUrl from './assets/tex/up_brick.webp?url';
import upGlassUrl from './assets/tex/up_glass.webp?url';
import billboardUrl from './assets/tex/billboard.webp?url';
import skylineUrl from './assets/tex/skyline.webp?url';

const MODEL_URLS = {
  hero: heroUrl, snow: snowUrl,
  lambo_green: lamboGreenUrl, lambo_orange: lamboOrangeUrl, gwagon: gwagonUrl, cruiser: cruiserUrl,
  roller: rollerUrl, tower: towerUrl,
  palm: palmUrl, tree: treeUrl, lamp: lampUrl, cone: coneUrl, barrier: barrierUrl, hydrant: hydrantUrl,
  dumpster: dumpsterUrl, bench: benchUrl, campole: campoleUrl, moneybag: moneybagUrl,
};
const TEX_URLS = {
  front_sf: frontSfUrl, front_oak: frontOakUrl, front_sj: frontSjUrl,
  up_brick: upBrickUrl, up_glass: upGlassUrl, billboard: billboardUrl, skyline: skylineUrl,
};

export const ART = { models: {}, tex: {}, failed: [] };
const templates = {};   // name -> { tpl: Group (base at y=0, centred), size: Vector3 }
const charData = {};    // name -> { gltf, scale }

function dataUriBytes(uri) {
  const b64 = uri.slice(uri.indexOf(',') + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function gunzip(bytes) {
  // gzip magic 1f 8b; if a build ever inlines an un-gzipped GLB, pass it through
  if (!(bytes[0] === 0x1f && bytes[1] === 0x8b)) return bytes.buffer;
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).arrayBuffer();
}

function makeLoader() {
  const loader = new GLTFLoader();
  // decode embedded images through <img> (blob: URLs) instead of fetch()
  loader.register((parser) => { parser.textureLoader = new THREE.TextureLoader(parser.options.manager); return { name: 'gk_img_textures' }; });
  return loader;
}

export async function loadArt(renderer) {
  const loader = makeLoader();
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const texLoader = new THREE.TextureLoader();
  const texJobs = Object.entries(TEX_URLS).map(async ([k, url]) => {
    try {
      const t = await texLoader.loadAsync(url);
      t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso;
      // facades tile both ways; storefront strips and the skyline tile sideways only
      t.wrapS = k === 'billboard' ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
      t.wrapT = k.startsWith('up_') ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
      ART.tex[k] = t;
    } catch (e) { ART.failed.push(k); console.warn('[GK7 art] texture', k, e); }
  });
  const modelJobs = Object.entries(MODEL_URLS).map(async ([k, url]) => {
    try {
      const buf = await gunzip(dataUriBytes(url));
      const gltf = await loader.parseAsync(buf, '');
      ART.models[k] = gltf;
    } catch (e) { ART.failed.push(k); console.warn('[GK7 art] model', k, e); }
  });
  await Promise.all([...texJobs, ...modelJobs]);
  for (const k of Object.keys(ART.models)) prepTemplate(k);
  return ART;
}

export function hasModel(name) { return !!(ART.models[name]); }

function prepTemplate(name) {
  const gltf = ART.models[name];
  if (gltf.animations && gltf.animations.length) { prepCharacter(name, gltf); return; }
  const inner = gltf.scene;
  inner.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(inner);
  const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  inner.position.set(-c.x, -box.min.y, -c.z);
  inner.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true; o.receiveShadow = true;
      if (o.material) { o.material.envMapIntensity = 1.35; }
    }
  });
  const tpl = new THREE.Group(); tpl.add(inner);
  templates[name] = { tpl, size };
}

// Static prop instance. opts: { h } scale so height = h, { len } so the longest
// horizontal side = len, or { max } so the largest dimension = max.
export function makeProp(name, opts = {}) {
  const t = templates[name];
  if (!t) return null;
  const g = t.tpl.clone();
  let s = 1;
  if (opts.h) s = opts.h / t.size.y;
  else if (opts.len) s = opts.len / Math.max(t.size.x, t.size.z);
  else if (opts.max) s = opts.max / Math.max(t.size.x, t.size.y, t.size.z);
  g.scale.setScalar(s);
  g.userData.dims = t.size.clone().multiplyScalar(s);
  return g;
}

// ---------------------------------------------------------------- characters
const CHAR_HEIGHT = 1.9;
function prepCharacter(name, gltf) {
  // strip root motion: lock Hips x/z to the first key so clips play in place
  for (const clip of gltf.animations) {
    for (const tr of clip.tracks) {
      if (/Hips\.position$/.test(tr.name)) {
        const v = tr.values, x0 = v[0], z0 = v[2];
        for (let i = 0; i < v.length; i += 3) { v[i] = x0; v[i + 2] = z0; }
      }
    }
  }
  // measure the bind pose height
  const probe = skeletonClone(gltf.scene);
  probe.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(probe);
  const h = Math.max(0.01, box.max.y - box.min.y);
  charData[name] = { gltf, scale: CHAR_HEIGHT / h, minY: box.min.y * (CHAR_HEIGHT / h) };
}

export function makeCharacter(name) {
  const cd = charData[name];
  if (!cd) return null;
  const model = skeletonClone(cd.gltf.scene);
  model.scale.setScalar(cd.scale);
  model.position.y = -cd.minY;
  const bones = {};
  model.traverse((o) => {
    if (o.isBone) bones[o.name] = o;
    if (o.isMesh) {
      o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
      if (o.material) o.material.envMapIntensity = 1.2;
    }
  });
  const rest = {};
  for (const [k, b] of Object.entries(bones)) rest[k] = b.quaternion.clone();
  const root = new THREE.Group(); root.add(model);
  const mixer = new THREE.AnimationMixer(model);
  const actions = {};
  for (const clip of cd.gltf.animations) {
    const a = mixer.clipAction(clip);
    if (clip.name === 'jump') { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
    actions[clip.name] = a;
  }
  const ch = { root, model, mixer, actions, bones, rest, cur: null };
  setAnim(ch, 'idle', 1, 0);
  return ch;
}

export function setAnim(ch, name, timeScale = 1, fade = 0.18) {
  let a = ch.actions[name];
  if (!a) { name = ch.actions.run && (name === 'walk' || name === 'jump' || name === 'fall') ? 'run' : 'idle'; a = ch.actions[name]; }
  if (!a) return;
  if (ch.cur === name) { a.setEffectiveTimeScale(timeScale); return; }
  a.reset(); a.setEffectiveTimeScale(timeScale); a.setEffectiveWeight(1);
  if (fade > 0) a.fadeIn(fade);
  a.play();
  const prev = ch.cur && ch.actions[ch.cur];
  if (prev) { if (fade > 0) prev.fadeOut(fade); else prev.stop(); }
  ch.cur = name;
}

// Upper-body aim: straighten the right arm (and bring the left hand in to
// support) along a world-space aim direction, layered on top of whatever clip
// is playing. Call after mixer.update() and root.updateMatrixWorld(true).
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d0 = new THREE.Vector3(), _d1 = new THREE.Vector3();
const _q = new THREE.Quaternion(), _qw = new THREE.Quaternion(), _qp = new THREE.Quaternion();
function aimBone(bone, tip, dirWorld, rest, foreName, handName, bones) {
  if (bones[foreName] && rest[foreName]) bones[foreName].quaternion.copy(rest[foreName]);
  if (bones[handName] && rest[handName]) bones[handName].quaternion.copy(rest[handName]);
  bone.updateMatrixWorld(true);
  bone.getWorldPosition(_a); tip.getWorldPosition(_b);
  _d0.subVectors(_b, _a).normalize();
  _q.setFromUnitVectors(_d0, dirWorld);
  bone.getWorldQuaternion(_qw);
  bone.parent.getWorldQuaternion(_qp);
  bone.quaternion.copy(_qp.invert().multiply(_q.multiply(_qw)));
  bone.updateMatrixWorld(true);
}
const _dir = new THREE.Vector3();
// target: a world point to aim at (isDir=false) or a world direction (isDir=true)
export function aimArms(ch, target, twoHanded = true, isDir = false) {
  const B = ch.bones;
  const ra = B.RightArm, rh = B.RightHand, la = B.LeftArm, lh = B.LeftHand;
  if (!ra || !rh) return null;
  if (isDir) _dir.copy(target).normalize();
  else { ra.getWorldPosition(_a); _dir.subVectors(target, _a).normalize(); }
  const aimDir = _dir;
  aimBone(ra, rh, aimDir, ch.rest, 'RightForeArm', 'RightHand', B);
  if (twoHanded && la && lh) {
    rh.getWorldPosition(_b); la.getWorldPosition(_a);
    _d1.subVectors(_b, _a).addScaledVector(aimDir, 0.05).normalize();
    aimBone(la, lh, _d1, ch.rest, 'LeftForeArm', 'LeftHand', B);
  }
  return aimDir;
}

// ---------------------------------------------------------------- facades
// Box with per-face UVs scaled to world size so a texture tiles at a fixed
// physical size (tileW x tileH world units) on every side.
export function tiledBox(w, h, d, tileW, tileH, uOff = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const faceW = [d, d, w, w, w, w], faceH = [h, h, d, d, h, h];
  for (let f = 0; f < 6; f++) {
    const side = f !== 2 && f !== 3;
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      if (side) uv.setXY(k, uv.getX(k) * faceW[f] / tileW + uOff + f * 0.31, uv.getY(k) * faceH[f] / tileH);
    }
  }
  uv.needsUpdate = true;
  return g;
}

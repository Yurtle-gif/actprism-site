// fx.js — one pooled, instanced particle system: muzzle, sparks, blood, dust,
// casings. Single draw call, no allocation per spawn.
import * as THREE from 'three';

const N = 2048;
const P = [];
let mesh, col, head = 0, live = 0;
const M = new THREE.Matrix4(), ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const C = new THREE.Color(), T = new THREE.Vector3();

export function createFx(scene) {
  const geo = new THREE.PlaneGeometry(1, 1);
  col = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4);
  col.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aCol', col);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `attribute vec4 aCol; varying vec4 vCol; varying vec2 vUv;
      void main(){ vUv = uv; vCol = aCol;
        vec4 mv = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float s = length(instanceMatrix[0].xyz);
        mv.xy += position.xy * s;
        gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying vec4 vCol; varying vec2 vUv;
      void main(){ float d = length(vUv - 0.5) * 2.0;
        float a = vCol.a * smoothstep(1.0, 0.15, d);
        if (a < 0.01) discard;
        gl_FragColor = vec4(vCol.rgb, a); }`,
  });
  mesh = new THREE.InstancedMesh(geo, mat, N);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false; mesh.renderOrder = 5;
  for (let i = 0; i < N; i++) {
    P.push({ life: 0, max: 1, p: new THREE.Vector3(), v: new THREE.Vector3(), s0: 1, s1: 0, r: 1, g: 1, b: 1, grav: 0, drag: 0 });
    mesh.setMatrixAt(i, ZERO);
  }
  scene.add(mesh);
  return mesh;
}

export function emit(pos, n, { speed = 6, life = 0.4, size = 0.25, end = 0.2, color = 0xffc040, gravity = 0, spread = 1, dir = null, drag = 0 } = {}) {
  if (!mesh) return;
  C.set(color);
  for (let i = 0; i < n; i++) {
    const q = P[head]; head = (head + 1) % N;
    if (q.life <= 0) live++;
    q.life = q.max = life * (0.6 + Math.random() * 0.8);
    q.p.copy(pos);
    q.v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(2 * spread);
    if (dir) q.v.add(dir);
    if (q.v.lengthSq() < 1e-6) q.v.set(0, 1, 0);
    q.v.normalize().multiplyScalar(speed * (0.5 + Math.random()));
    q.s0 = size * (0.7 + Math.random() * 0.6); q.s1 = q.s0 * end;
    q.r = C.r; q.g = C.g; q.b = C.b; q.grav = gravity; q.drag = drag;
  }
}

export function fxTick(dt) {
  if (!mesh || live <= 0) return;
  live = 0;
  for (let i = 0; i < N; i++) {
    const q = P[i];
    if (q.life <= 0) continue;
    q.life -= dt;
    if (q.life <= 0) { mesh.setMatrixAt(i, ZERO); continue; }
    live++;
    q.v.y -= q.grav * dt;
    if (q.drag) q.v.multiplyScalar(Math.exp(-q.drag * dt));
    q.p.addScaledVector(q.v, dt);
    const t = 1 - q.life / q.max, s = q.s0 + (q.s1 - q.s0) * t;
    M.makeScale(s, s, s).setPosition(T.copy(q.p));
    mesh.setMatrixAt(i, M);
    col.setXYZW(i, q.r, q.g, q.b, 1 - t * t);
  }
  mesh.instanceMatrix.needsUpdate = true; col.needsUpdate = true;
}

export function clearFx() {
  if (!mesh) return;
  for (let i = 0; i < N; i++) { P[i].life = 0; mesh.setMatrixAt(i, ZERO); }
  live = 0; mesh.instanceMatrix.needsUpdate = true;
}

// presets
export const fxMuzzle = (p, dir) => { emit(p, 5, { speed: 5, life: 0.07, size: 0.32, color: 0xfff0b0, dir, spread: 0.35 }); emit(p, 3, { speed: 1.2, life: 0.35, size: 0.22, end: 1.8, color: 0x6a6070, spread: 0.6, dir, drag: 3 }); };
export const fxSparks = (p, n, color = 0xffd27a, normal = null) => emit(p, n, { speed: 7, life: 0.32, size: 0.12, end: 0.3, color, gravity: 18, dir: normal, spread: 0.8 });
export const fxBlood = (p, dir) => emit(p, 9, { speed: 4.5, life: 0.4, size: 0.16, end: 0.4, color: 0xff2d55, gravity: 12, dir, spread: 0.7 });
export const fxDust = (p, n = 14) => emit(p, n, { speed: 2.4, life: 0.6, size: 0.45, end: 1.6, color: 0x8a8274, spread: 1, dir: T.set(0, 0.25, 0), drag: 4 });
export const fxCasing = (p, side) => emit(p, 1, { speed: 3.5, life: 0.55, size: 0.06, end: 0.9, color: 0xffb640, gravity: 16, dir: side, spread: 0.25 });

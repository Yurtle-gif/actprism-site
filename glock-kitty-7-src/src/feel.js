// feel.js — game feel: trauma screen shake, hit-stop and a sprung FOV kick.
const f = { trauma: 0, stop: 0, fovKick: 0, fovVel: 0, t: 0 };

export const addTrauma = (a) => { f.trauma = Math.min(1, f.trauma + a); };
export const hitStop = (sec) => { f.stop = Math.max(f.stop, sec); };
export const kickFov = (deg) => { f.fovVel += deg * 12; };
export const trauma = () => f.trauma;
export function resetFeel() { f.trauma = 0; f.stop = 0; f.fovKick = 0; f.fovVel = 0; }

// Once per frame with the real dt; returns the dt the simulation should use.
export function feelTick(dt) {
  f.t += dt;
  f.trauma = Math.max(0, f.trauma - dt * 1.6);
  f.fovVel += (-140 * f.fovKick - 18 * f.fovVel) * dt;
  f.fovKick += f.fovVel * dt;
  if (f.stop > 0) { f.stop -= dt; return dt * 0.05; }
  return dt;
}

export const fovOffset = () => f.fovKick;

// After the camera is placed for the frame. Shake scales with trauma squared.
export function applyShake(cam) {
  const s = f.trauma * f.trauma;
  if (s < 1e-4) return;
  const t = f.t * 38;
  cam.rotation.x += 0.035 * s * Math.sin(t * 1.3);
  cam.rotation.y += 0.035 * s * Math.sin(t * 1.7 + 2);
  cam.rotation.z += 0.02 * s * Math.sin(t * 2.1 + 4);
}

// Phone app: buzz through the native bridge when running inside the iPhone/Android app.
let lastBuzz = 0;
export function haptic(kind) {
  const rn = window.ReactNativeWebView;
  if (!rn) return;
  const now = performance.now();
  if (now - lastBuzz < 70) return;
  lastBuzz = now;
  try { rn.postMessage(JSON.stringify({ t: 'haptic', k: kind })); } catch (e) { /* ignore */ }
}

// gfx.js — rendering pipeline: ACES tone mapping, soft shadows, UnrealBloom,
// a speed-line / chromatic-aberration post pass, a Fresnel rim-light stylized
// material, procedural camo/asphalt/denim textures, a GLSL storm-wall shader,
// and a procedural neon environment (PMREM). Desktop HD/ULTRA add half-res GTAO
// ambient occlusion (contact shadows in corners and under objects); phones skip it.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';

export const LOW_MEM = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
  (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent)) || (navigator.deviceMemory || 8) <= 4;

// Graphics quality, three levels, tuned separately for desktops and for phones/tablets.
// Desktop: PERFORMANCE / HD / 4K ULTRA (ultra renders at least 2160 lines, even on 1080p).
// Phone:   PERFORMANCE / HD / MAX (MAX = the screen's full native resolution).
const QKEY = 'gk7-quality';
const PRESETS = {
  desktop: {
    perf:  { pr: (d) => Math.min(d, 1.25), msaa: 2, shadow: 1024, bloom: 0.5, sharpen: 0.2, aniso: 4, floor: 0.55, ao: 0 },
    hd:    { pr: (d) => Math.min(d, 2), msaa: 4, shadow: 2048, bloom: 0.5, sharpen: 0.25, aniso: 8, floor: 0.55, ao: 0.5 },
    ultra: { pr: (d) => Math.min(3, Math.max(d, 2160 / Math.max(1, window.innerHeight))), msaa: 4, shadow: 4096, bloom: 0.75, sharpen: 0.45, aniso: 16, floor: 1, ao: 0.5 },
  },
  phone: {
    perf:  { pr: (d) => Math.min(d, 1.25), msaa: 2, shadow: 1024, bloom: 0.4, sharpen: 0.35, aniso: 4, floor: 0.6 },
    hd:    { pr: (d) => Math.min(d, 2), msaa: 2, shadow: 2048, bloom: 0.5, sharpen: 0.35, aniso: 8, floor: 0.65 },
    ultra: { pr: (d) => Math.min(d, 3), msaa: 4, shadow: 2048, bloom: 0.5, sharpen: 0.4, aniso: 16, floor: 0.75 },
  },
};
const DEVICE = LOW_MEM ? 'phone' : 'desktop';
// Newer iPhones (3x screens, 844pt+ long side: iPhone 12 and later) and iPads start on HD.
function autoQuality() {
  if (!LOW_MEM) return 'hd';
  const dpr = window.devicePixelRatio || 1, long = Math.max(screen.width, screen.height);
  const ipad = navigator.maxTouchPoints > 1 && /Macintosh|iPad/.test(navigator.userAgent);
  return ipad || (dpr >= 3 && long >= 844) ? 'hd' : 'perf';
}
export const QUALITY = (() => {
  let q = null;
  try { q = localStorage.getItem(QKEY); } catch (e) { /* storage blocked */ }
  return q === 'perf' || q === 'hd' || q === 'ultra' ? q : autoQuality();
})();
export const QP = PRESETS[DEVICE][QUALITY];
export const QUALITY_LABEL = { perf: 'PERFORMANCE', hd: 'HD', ultra: LOW_MEM ? 'MAX' : '4K ULTRA' };
export function setQuality(q) { try { localStorage.setItem(QKEY, q); } catch (e) { /* ignore */ } }
export const qualityPixelRatio = () => QP.pr(window.devicePixelRatio || 1);

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  // phones and tablets run out of GPU memory at full retina res with bloom on top
  renderer.setPixelRatio(qualityPixelRatio());
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  return renderer;
}

// --- Speed-line + chromatic aberration pass -------------------------------
const SpeedLineShader = {
  uniforms: {
    tDiffuse: { value: null },
    uIntensity: { value: 0.0 },
    uTime: { value: 0.0 },
    uAspect: { value: 1.0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uIntensity;
    uniform float uTime;
    uniform float uAspect;
    varying vec2 vUv;
    float hash(float n){ return fract(sin(n)*43758.5453); }
    void main(){
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      c.x *= uAspect;
      float r = length(c);
      // chromatic aberration scaling outward
      float ca = uIntensity * 0.006 * r;
      vec2 dir = normalize(c + 1e-5);
      dir.x /= uAspect;
      vec4 col;
      col.r = texture2D(tDiffuse, uv + dir*ca).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - dir*ca).b;
      col.a = 1.0;
      // radial speed lines
      float ang = atan(c.y, c.x);
      float lines = sin(ang * 90.0 + hash(floor(ang*30.0))*6.28) * 0.5 + 0.5;
      float mask = smoothstep(0.24, 0.5, r) * uIntensity;
      float streak = pow(lines, 8.0) * mask * (0.6 + 0.4*sin(uTime*40.0 + r*20.0));
      col.rgb += streak * vec3(1.0, 0.85, 1.0) * 0.5;
      // edge darken for tunnel feel
      col.rgb *= 1.0 - mask * 0.35 * smoothstep(0.35,0.75,r);
      gl_FragColor = col;
    }`,
};

// --- Final color grade (display space): vibrance, contrast, soft vignette ---
// Pushes the image toward Fortnite's clean saturated look without blowing out
// skin or neon that is already saturated.
// --- Ambient occlusion: three's GTAO at a fraction of the render size ---------
// Only solid meshes write the depth/normal buffer: particles, flashes, glass, the
// storm wall and the ink outline hulls would otherwise cast dark halos.
class LiteGTAOPass extends GTAOPass {
  constructor(scene, camera, w, h, scale) { super(scene, camera, Math.round(w * scale), Math.round(h * scale)); this.aoScale = scale; }
  setSize(w, h) { super.setSize(Math.max(1, Math.round(w * this.aoScale)), Math.max(1, Math.round(h * this.aoScale))); }
  overrideVisibility() {
    const cache = this._visibilityCache;
    this.scene.traverse((o) => {
      cache.set(o, o.visible);
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      if (o.isPoints || o.isLine || o.isSprite || o.userData.outline || (m && (m.transparent || m.blending === THREE.AdditiveBlending))) o.visible = false;
    });
  }
}

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uVibrance: { value: 0.32 }, uContrast: { value: 1.08 }, uVignette: { value: 0.22 },
    uSharpen: { value: 0 }, uTexel: { value: new THREE.Vector2(1 / 1920, 1 / 1080) } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uVibrance, uContrast, uVignette, uSharpen; uniform vec2 uTexel; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      if (uSharpen > 0.0) {
        // unsharp mask against the 4 neighbours: crisper edges and texture detail
        vec3 n = texture2D(tDiffuse, vUv + vec2(uTexel.x, 0.0)).rgb + texture2D(tDiffuse, vUv - vec2(uTexel.x, 0.0)).rgb
               + texture2D(tDiffuse, vUv + vec2(0.0, uTexel.y)).rgb + texture2D(tDiffuse, vUv - vec2(0.0, uTexel.y)).rgb;
        c.rgb = max(c.rgb + (c.rgb - n * 0.25) * uSharpen, 0.0);
      }
      float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(l), c.rgb, 1.0 + uVibrance * (1.0 - (mx - mn)));
      c.rgb = (c.rgb - 0.5) * uContrast + 0.5;
      vec2 d = vUv - 0.5; c.rgb *= 1.0 - uVignette * smoothstep(0.35, 0.85, length(d) * 1.2);
      gl_FragColor = vec4(clamp(c.rgb, 0.0, 1.0), c.a);
    }`,
};

export function createComposer(renderer, scene, camera) {
  const size = renderer.getSize(new THREE.Vector2());
  // the composer's render targets skip the canvas MSAA, so give them their own
  // samples; otherwise every edge in the game is jagged
  const pr = renderer.getPixelRatio();
  const rt = new THREE.WebGLRenderTarget(size.x * pr, size.y * pr, { type: THREE.HalfFloatType, samples: QP.msaa });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  let ao = null;
  if (QP.ao) {
    // radius/thickness in metres: a 1.85 m character, 3-4 m doorways
    ao = new LiteGTAOPass(scene, camera, size.x * pr, size.y * pr, QP.ao);
    ao.updateGtaoMaterial({ radius: 2.2, distanceExponent: 1.2, thickness: 2.5, distanceFallOff: 1, scale: 1.3, samples: 12 });
    ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    ao.blendIntensity = 1;
    composer.addPass(ao);
  }
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.65, 0.4, 0.85);
  composer.addPass(bloom);
  const speedPass = new ShaderPass(SpeedLineShader);
  speedPass.uniforms.uAspect.value = size.x / size.y;
  composer.addPass(speedPass);
  composer.addPass(new OutputPass());
  const grade = new ShaderPass(GradeShader);
  grade.uniforms.uSharpen.value = QP.sharpen;
  composer.addPass(grade);
  return {
    composer, bloom, speedPass, grade, ao,
    setSize(w, h) {
      composer.setSize(w, h);
      // bloom is a soft glow: half resolution looks the same and costs a quarter
      const pr = renderer.getPixelRatio();
      const bs = QP.bloom;
      bloom.setSize(Math.round(w * pr * bs), Math.round(h * pr * bs));
      grade.uniforms.uTexel.value.set(1 / (w * pr), 1 / (h * pr));
      speedPass.uniforms.uAspect.value = w / h;
    },
  };
}

// --- Fresnel rim-light stylized standard material -------------------------
export function makeStylized(params = {}, rim = {}) {
  const mat = new THREE.MeshStandardMaterial({
    color: params.color ?? 0xffffff,
    roughness: params.roughness ?? 0.7,
    metalness: params.metalness ?? 0.05,
    map: params.map ?? null,
    normalMap: params.normalMap ?? null,
    roughnessMap: params.roughnessMap ?? null,
    emissive: params.emissive ?? 0x000000,
    emissiveIntensity: params.emissiveIntensity ?? 1.0,
    transparent: params.transparent ?? false,
    opacity: params.opacity ?? 1.0,
  });
  const rimColor = new THREE.Color(rim.color ?? 0x59e7ff);
  const rimPower = rim.power ?? 2.6;
  const rimStrength = rim.strength ?? 0.7;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRimColor = { value: rimColor };
    shader.uniforms.uRimPower = { value: rimPower };
    shader.uniforms.uRimStrength = { value: rimStrength };
    shader.fragmentShader =
      'uniform vec3 uRimColor;\nuniform float uRimPower;\nuniform float uRimStrength;\n' +
      shader.fragmentShader.replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
        {
          vec3 vd = normalize( vViewPosition );
          float rimDot = 1.0 - clamp( dot( vd, normal ), 0.0, 1.0 );
          float rim = pow( rimDot, uRimPower );
          gl_FragColor.rgb += uRimColor * rim * uRimStrength;
        }`
      );
  };
  mat.customProgramCacheKey = () => 'stylized-rim';
  return mat;
}

// --- Procedural textures --------------------------------------------------
function canvas2d(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return { c, ctx: c.getContext('2d') };
}

export function makeCamoTexture(size = 512, palette = ['#30402a', '#4c6136', '#6d4a2f', '#1d2418']) {
  const { c, ctx } = canvas2d(size);
  ctx.fillStyle = palette[0];
  ctx.fillRect(0, 0, size, size);
  for (let layer = 1; layer < palette.length; layer++) {
    ctx.fillStyle = palette[layer];
    for (let i = 0; i < 26; i++) {
      const x = Math.random() * size, y = Math.random() * size;
      const r = size * (0.05 + Math.random() * 0.12);
      ctx.beginPath();
      for (let a = 0; a < Math.PI * 2; a += 0.5) {
        const rr = r * (0.7 + Math.random() * 0.6);
        const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
        a === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath(); ctx.fill();
    }
  }
  // neon speckle
  ctx.fillStyle = 'rgba(255,95,208,0.5)';
  for (let i = 0; i < 40; i++) ctx.fillRect(Math.random() * size, Math.random() * size, 2, 2);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function makeAsphaltTexture(size = 512) {
  const { c, ctx } = canvas2d(size);
  ctx.fillStyle = '#15131c'; ctx.fillRect(0, 0, size, size);
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() * 40) | 0;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n + 6;
  }
  ctx.putImageData(img, 0, 0);
  // lane markings / cracks
  ctx.strokeStyle = 'rgba(255,220,120,0.5)'; ctx.lineWidth = size * 0.02;
  ctx.setLineDash([size * 0.12, size * 0.1]);
  ctx.beginPath(); ctx.moveTo(size * 0.5, 0); ctx.lineTo(size * 0.5, size); ctx.stroke();
  ctx.setLineDash([]);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function makeDenimTexture(size = 256, base = '#223047') {
  const { c, ctx } = canvas2d(size);
  ctx.fillStyle = base; ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  for (let i = 0; i < size; i += 3) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, size); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.08)';
  for (let i = 0; i < size; i += 3) {
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(size, i); ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// --- Storm wall shader material -------------------------------------------
export function makeStormMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uColorA: { value: new THREE.Color(0x8a2be2) },
      uColorB: { value: new THREE.Color(0xff3ea5) },
    },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      varying vec3 vWorld;
      void main(){
        vUv = uv;
        vWorld = (modelMatrix * vec4(position,1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
      }`,
    fragmentShader: /* glsl */`
      varying vec2 vUv;
      varying vec3 vWorld;
      uniform float uTime;
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      // cheap cellular-ish noise
      vec2 hash2(vec2 p){ p = vec2(dot(p,vec2(127.1,311.7)), dot(p,vec2(269.5,183.3))); return fract(sin(p)*43758.5453); }
      float cells(vec2 p){
        vec2 i = floor(p), f = fract(p);
        float m = 1.0;
        for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){
          vec2 g = vec2(float(x),float(y));
          vec2 o = hash2(i+g);
          o = 0.5 + 0.5*sin(uTime*1.5 + 6.28*o);
          float d = length(g + o - f);
          m = min(m, d);
        }
        return m;
      }
      void main(){
        float v = cells(vUv * vec2(10.0, 4.0) + vec2(uTime*0.4, 0.0));
        float veins = smoothstep(0.08, 0.0, v);           // lightning veins
        float band = 0.4 + 0.6 * sin(vUv.y*20.0 - uTime*3.0);
        vec3 col = mix(uColorA, uColorB, vUv.y + 0.2*sin(uTime+vUv.x*6.28));
        float alpha = 0.18 + 0.5*veins + 0.12*band;
        col += veins * 1.4;
        gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.85));
      }`,
  });
}

// --- Environment & lights -------------------------------------------------
export function setupEnvironment(renderer, scene) {
  // procedural neon sky gradient -> PMREM environment
  const sky = canvas2d(16);
  // use a tall gradient on an equirect-ish canvas
  const eq = document.createElement('canvas'); eq.width = 512; eq.height = 256;
  const ec = eq.getContext('2d');
  const grad = ec.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0.0, '#241146');
  grad.addColorStop(0.45, '#3a1e6e');
  grad.addColorStop(0.7, '#7a2a7d');
  grad.addColorStop(1.0, '#120a22');
  ec.fillStyle = grad; ec.fillRect(0, 0, 512, 256);
  // a few neon "billboard" glows on the horizon
  for (let i = 0; i < 18; i++) {
    ec.fillStyle = ['#ff5fd0', '#5fe0ff', '#b6ff3a'][i % 3] + '';
    ec.globalAlpha = 0.5;
    ec.fillRect(Math.random() * 512, 150 + Math.random() * 70, 6 + Math.random() * 20, 10 + Math.random() * 30);
  }
  ec.globalAlpha = 1;
  const eqTex = new THREE.CanvasTexture(eq);
  eqTex.mapping = THREE.EquirectangularReflectionMapping;
  eqTex.colorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromEquirectangular(eqTex);
  scene.environment = envRT.texture;
  scene.background = eqTex;
  scene.fog = new THREE.FogExp2(0x1a0f2e, 0.0038);
  eqTex.dispose(); pmrem.dispose(); void sky;

  const hemi = new THREE.HemisphereLight(0xa88cff, 0x1c0f30, 0.8);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xffe2f4, 2.0);
  sun.position.set(60, 120, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.setScalar(QP.shadow);
  // the sun follows the player, so a tight frustum keeps shadows crisp
  const d = 55;
  sun.shadow.camera.left = -d; sun.shadow.camera.right = d;
  sun.shadow.camera.top = d; sun.shadow.camera.bottom = -d;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 400;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 3;
  scene.add(sun);
  scene.add(sun.target);

  const fill = new THREE.DirectionalLight(0x5fe0ff, 0.4);
  fill.position.set(-50, 40, -60);
  scene.add(fill);

  return { sun, hemi, fill };
}

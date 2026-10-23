// touch.js — phone controls: floating move stick (left), drag-to-look (right),
// a fire button you can also drag to aim, plus jump / aim / crouch / use buttons.
// Tapping hotbar slots and build chips works too.
export const IS_TOUCH = (typeof window !== 'undefined') &&
  (('ontouchstart' in window) || navigator.maxTouchPoints > 0) && matchMedia('(pointer: coarse)').matches;

const LOOK = 0.0052, STICK_R = 56;

export function setupTouch(api) {
  document.body.classList.add('touch');
  const root = document.createElement('div'); root.id = 'gk-touch'; document.body.appendChild(root);
  const el = (cls, html = '', parent = root) => { const d = document.createElement('div'); d.className = cls; d.innerHTML = html; parent.appendChild(d); return d; };

  const base = el('gk-stick'), knob = el('gk-knob', '', base);
  const btn = (cls, label) => el('gk-tb ' + cls, `<span>${label}</span>`);
  const fire = btn('gk-tb-fire', 'FIRE');
  const jump = btn('gk-tb-jump', 'JUMP');
  const ads = btn('gk-tb-ads', 'AIM');
  const crouch = btn('gk-tb-crouch', 'SLIDE');
  const use = btn('gk-tb-use', 'OPEN');
  const skate = btn('gk-tb-skate', '🛹');
  const rotate = el('gk-rotate', '<div>↻</div><b>Turn your phone sideways</b>');
  rotate.style.display = 'none';

  const touches = new Map(); // id -> {kind, x, y, sx, sy}
  const stick = { x: 0, y: 0 };

  function setStick(t) {
    let dx = t.x - t.sx, dy = t.y - t.sy;
    const d = Math.hypot(dx, dy);
    if (d > STICK_R) { dx *= STICK_R / d; dy *= STICK_R / d; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    stick.x = dx / STICK_R; stick.y = -dy / STICK_R;
    api.move(stick.x, stick.y);
  }

  const press = (b, on) => b.classList.toggle('on', on);
  const hit = (b, x, y) => { if (b.style.display === 'none') return false; const r = b.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; };

  function slotAt(x, y) {
    const s = api.slots();
    for (let i = 0; i < s.length; i++) if (hit(s[i], x, y)) return i;
    return -1;
  }
  function chipAt(x, y) {
    for (const [k, c] of Object.entries(api.chips())) if (hit(c, x, y)) return k;
    return null;
  }

  function start(e) {
    if (!api.running()) return;
    for (const t of e.changedTouches) {
      const x = t.clientX, y = t.clientY;
      let kind = null;
      if (hit(fire, x, y)) { kind = 'fire'; press(fire, true); api.fire(true); }
      else if (hit(jump, x, y)) { kind = 'btn'; press(jump, true); api.jump(); setTimeout(() => press(jump, false), 120); }
      else if (hit(ads, x, y)) { kind = 'btn'; api.toggleAds(); }
      else if (hit(crouch, x, y)) { kind = 'btn'; press(crouch, true); api.key('KeyC'); setTimeout(() => press(crouch, false), 120); }
      else if (hit(use, x, y)) { kind = 'btn'; api.key('KeyE'); }
      else if (hit(skate, x, y)) { kind = 'btn'; api.key('KeyV'); }
      else if (slotAt(x, y) >= 0) { kind = 'btn'; api.key('Digit' + (slotAt(x, y) + 1)); }
      else if (chipAt(x, y)) { kind = 'btn'; api.build(chipAt(x, y)); }
      else if (x < innerWidth * 0.42 && !stickTouch()) {
        kind = 'stick';
        base.style.display = 'block'; base.style.left = x + 'px'; base.style.top = y + 'px';
        knob.style.transform = 'translate(0,0)';
      } else kind = 'look';
      touches.set(t.identifier, { kind, x, y, sx: x, sy: y });
    }
    e.preventDefault();
  }
  const stickTouch = () => [...touches.values()].some((t) => t.kind === 'stick');

  function moveT(e) {
    let mine = false;
    for (const t of e.changedTouches) {
      const s = touches.get(t.identifier); if (!s) continue;
      mine = true;
      const dx = t.clientX - s.x, dy = t.clientY - s.y;
      s.x = t.clientX; s.y = t.clientY;
      if (s.kind === 'stick') setStick(s);
      else if (s.kind === 'look' || s.kind === 'fire') api.look(dx * LOOK, dy * LOOK);
    }
    if (mine || api.running()) e.preventDefault();
  }

  function end(e) {
    let mine = false;
    for (const t of e.changedTouches) {
      const s = touches.get(t.identifier); if (!s) continue;
      mine = true;
      touches.delete(t.identifier);
      if (s.kind === 'stick') { base.style.display = 'none'; stick.x = stick.y = 0; api.move(0, 0); }
      else if (s.kind === 'fire') { press(fire, false); api.fire(false); }
    }
    if (mine) e.preventDefault(); // untracked touches (menus) still become clicks
  }

  document.addEventListener('touchstart', start, { passive: false });
  document.addEventListener('touchmove', moveT, { passive: false });
  document.addEventListener('touchend', end, { passive: false });
  document.addEventListener('touchcancel', end, { passive: false });
  document.addEventListener('gesturestart', (e) => e.preventDefault());

  const orient = () => { rotate.style.display = innerHeight > innerWidth * 1.05 ? 'flex' : 'none'; };
  addEventListener('resize', orient); orient();

  // per-frame: contextual buttons + aim state
  return function touchTick(state) {
    root.style.display = state.running ? 'block' : 'none';
    use.style.display = state.nearChest ? 'flex' : 'none';
    ads.classList.toggle('on', state.ads);
    skate.classList.toggle('on', state.skating);
    fire.querySelector('span').textContent = state.building ? 'PLACE' : state.melee ? 'SWING' : state.heal ? 'HEAL' : 'FIRE';
  };
}

// hud.js — builds the DOM overlay and exposes update methods. Self-contained:
// pass it a root element and it constructs everything inside.
import { RARITY } from './config.js';

export class HUD {
  constructor(root) {
    this.root = root;
    root.innerHTML = '';
    this._build();
  }

  _el(tag, cls, parent, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    (parent || this.root).appendChild(e);
    return e;
  }

  _build() {
    // Crosshair
    this.cross = this._el('div', 'gk-cross', this.root);
    for (const d of ['t', 'b', 'l', 'r']) this._el('i', 'gk-cross-' + d, this.cross);
    this.hitmark = this._el('div', 'gk-hitmark', this.root);

    // Interact prompt
    this.interact = this._el('div', 'gk-interact', this.root);
    this.interact.style.display = 'none';

    // Storm banner
    this.banner = this._el('div', 'gk-banner', this.root);
    this.banner.style.display = 'none';

    // Bottom-left: health + shield
    const bl = this._el('div', 'gk-vitals', this.root);
    this.shieldWrap = this._el('div', 'gk-bar-wrap', bl);
    this.shieldFill = this._el('div', 'gk-bar gk-shield', this.shieldWrap);
    this.shieldTxt = this._el('div', 'gk-bar-txt', this.shieldWrap);
    this.hpWrap = this._el('div', 'gk-bar-wrap', bl);
    this.hpFill = this._el('div', 'gk-bar gk-hp', this.hpWrap);
    this.hpTxt = this._el('div', 'gk-bar-txt', this.hpWrap);

    // Bottom-center: build pieces + mats
    const bc = this._el('div', 'gk-build', this.root);
    this.buildChips = {};
    for (const [key, label, sub] of [['wall', 'Q', 'Tag Wall'], ['ramp', 'E', 'Skate Ramp'], ['floor', 'R', 'Stage Floor'], ['edit', 'F', 'Edit']]) {
      const chip = this._el('div', 'gk-chip', bc);
      this._el('div', 'gk-chip-key', chip, label);
      this._el('div', 'gk-chip-sub', chip, sub);
      this.buildChips[key] = chip;
    }
    this.matsEl = this._el('div', 'gk-mats', bc, '🧱 <b>0</b>');

    // Bottom-right: hotbar
    const br = this._el('div', 'gk-hotbar', this.root);
    this.slots = [];
    for (let i = 0; i < 5; i++) {
      const s = this._el('div', 'gk-slot', br);
      this._el('div', 'gk-slot-num', s, String(i + 1));
      const name = this._el('div', 'gk-slot-name', s, '—');
      const ammo = this._el('div', 'gk-slot-ammo', s, '');
      this.slots.push({ el: s, name, ammo });
    }

    // Top-right: minimap + alive
    const tr = this._el('div', 'gk-topright', this.root);
    this.aliveEl = this._el('div', 'gk-alive', tr, '<span>ALIVE</span><b>12</b>');
    this.miniCanvas = this._el('canvas', 'gk-mini', tr);
    this.miniCanvas.width = 176; this.miniCanvas.height = 176;
    this.mctx = this.miniCanvas.getContext('2d');

    // Top-left: killfeed
    this.feed = this._el('div', 'gk-feed', this.root);

    // Reload indicator
    this.reloadEl = this._el('div', 'gk-reload', this.root);
    this.reloadEl.style.display = 'none';

    // Full-screen screens (start / victory / defeat)
    this.screen = this._el('div', 'gk-screen', this.root);
    this.screen.style.display = 'none';
  }

  setHealth(hp, max) {
    hp = Math.max(0, Math.round(hp));
    this.hpFill.style.width = (100 * hp / max) + '%';
    this.hpTxt.textContent = hp + ' HP';
  }
  setShield(s, max) {
    s = Math.max(0, Math.round(s));
    this.shieldFill.style.width = (100 * s / max) + '%';
    this.shieldTxt.textContent = s;
    this.shieldWrap.style.opacity = s > 0 ? '1' : '0.4';
  }
  setMats(n) { this.matsEl.querySelector('b').textContent = Math.floor(n); }
  setAlive(n) { this.aliveEl.querySelector('b').textContent = n; }

  setHotbar(slots, active, buildMode) {
    for (let i = 0; i < 5; i++) {
      const s = this.slots[i];
      const item = slots[i];
      s.el.classList.toggle('active', i === active && !buildMode);
      if (!item) {
        s.el.style.borderColor = 'rgba(255,255,255,0.14)';
        s.el.style.boxShadow = 'none';
        s.name.textContent = '—';
        s.name.style.color = '#8891a0';
        s.ammo.textContent = '';
        continue;
      }
      let col = '#cfd6de';
      if (item.kind === 'gun') col = item.color || RARITY[item.rarity]?.color || '#cfd6de';
      else if (item.kind === 'heal') col = '#ff5fd0';
      else if (item.kind === 'melee') col = '#9ad7ff';
      s.el.style.borderColor = col;
      s.el.style.boxShadow = (i === active && !buildMode) ? `0 0 14px ${col}` : `0 0 6px ${col}55`;
      s.name.textContent = item.shortName || item.name;
      s.name.style.color = col;
      if (item.kind === 'gun') s.ammo.textContent = item.ammoInMag + ' / ' + item.mag;
      else if (item.kind === 'heal') s.ammo.textContent = 'x' + (item.count || 1);
      else s.ammo.textContent = '';
    }
    for (const k in this.buildChips) this.buildChips[k].classList.toggle('on', !!buildMode);
  }

  setCrosshair(spreadPx, visible) {
    this.cross.style.display = visible ? 'block' : 'none';
    const g = Math.max(3, spreadPx);
    this.cross.style.setProperty('--g', g + 'px');
  }

  showHitmarker(crit) {
    this.hitmark.className = 'gk-hitmark show' + (crit ? ' crit' : '');
    clearTimeout(this._hmT);
    this._hmT = setTimeout(() => { this.hitmark.className = 'gk-hitmark'; }, 160);
  }

  showInteract(text) {
    if (!text) { this.interact.style.display = 'none'; return; }
    this.interact.style.display = 'block';
    this.interact.innerHTML = text;
  }

  showReload(on, pct) {
    this.reloadEl.style.display = on ? 'block' : 'none';
    if (on) this.reloadEl.innerHTML = `RELOADING <span style="width:${Math.round(pct * 100)}%"></span>`;
  }

  banner_(text, color, ms = 2600) {
    this.banner.style.display = 'block';
    this.banner.style.color = color || '#ff5fd0';
    this.banner.textContent = text;
    clearTimeout(this._bT);
    this._bT = setTimeout(() => { this.banner.style.display = 'none'; }, ms);
  }

  addKill(html) {
    const line = this._el('div', 'gk-feed-line', this.feed, html);
    setTimeout(() => { line.style.opacity = '0'; }, 5000);
    setTimeout(() => { line.remove(); }, 5600);
    while (this.feed.children.length > 6) this.feed.removeChild(this.feed.firstChild);
  }

  // Floating damage number at screen coords.
  damageNumber(x, y, value, kind) {
    const d = this._el('div', 'gk-dmg ' + kind, this.root, String(Math.round(value)));
    d.style.left = x + 'px';
    d.style.top = y + 'px';
    const dx = (Math.random() * 2 - 1) * 24;
    requestAnimationFrame(() => {
      d.style.transform = `translate(calc(-50% + ${dx}px), -46px) scale(${kind === 'crit' ? 1.5 : 1})`;
      d.style.opacity = '0';
    });
    setTimeout(() => d.remove(), 760);
  }

  drawMinimap(state) {
    const c = this.mctx, W = 176, H = 176;
    const scale = (W * 0.5) / state.mapHalf; // world -> mini
    c.clearRect(0, 0, W, H);
    c.save();
    c.beginPath(); c.arc(W / 2, H / 2, W / 2 - 1, 0, Math.PI * 2); c.clip();
    c.fillStyle = '#0a0617'; c.fillRect(0, 0, W, H);
    const toX = (wx) => W / 2 + wx * scale;
    const toY = (wz) => H / 2 + wz * scale;
    // POIs
    c.fillStyle = 'rgba(120,200,255,0.5)';
    c.font = '7px monospace';
    for (const p of state.pois) {
      c.fillRect(toX(p.x) - 2, toY(p.z) - 2, 4, 4);
    }
    // highway strip
    if (state.highway) {
      c.strokeStyle = 'rgba(255,95,208,0.4)'; c.lineWidth = 5;
      c.beginPath();
      c.moveTo(toX(state.highway.x1), toY(state.highway.z1));
      c.lineTo(toX(state.highway.x2), toY(state.highway.z2));
      c.stroke();
    }
    // safe zone
    const s = state.storm;
    c.strokeStyle = '#8affff'; c.lineWidth = 2;
    c.beginPath(); c.arc(toX(s.cx), toY(s.cz), s.radius * scale, 0, Math.PI * 2); c.stroke();
    if (s.nextRadius != null && s.phase === 'warning') {
      c.strokeStyle = 'rgba(255,255,255,0.5)'; c.setLineDash([4, 4]);
      c.beginPath(); c.arc(toX(s.ncx), toY(s.ncz), s.nextRadius * scale, 0, Math.PI * 2); c.stroke();
      c.setLineDash([]);
    }
    // bots
    for (const b of state.bots) {
      if (!b.alive) continue;
      c.fillStyle = b.companion ? '#5fe0ff' : '#ff4d4d';
      c.beginPath(); c.arc(toX(b.x), toY(b.z), 2.6, 0, Math.PI * 2); c.fill();
    }
    // player (triangle pointing heading)
    const px = toX(state.player.x), py = toY(state.player.z), a = state.player.angle;
    c.save(); c.translate(px, py); c.rotate(a);
    c.fillStyle = '#b6ff3a';
    c.beginPath(); c.moveTo(0, -5); c.lineTo(4, 4); c.lineTo(-4, 4); c.closePath(); c.fill();
    c.restore();
    c.restore();
    // ring border
    c.strokeStyle = 'rgba(255,95,208,0.8)'; c.lineWidth = 2;
    c.beginPath(); c.arc(W / 2, H / 2, W / 2 - 1, 0, Math.PI * 2); c.stroke();
  }

  showScreen(kind, data) {
    if (!kind) { this.screen.style.display = 'none'; return; }
    this.screen.style.display = 'flex';
    this.screen.className = 'gk-screen ' + kind;
    if (kind === 'start') {
      this.screen.innerHTML = `
        <div class="gk-title">GLOCK&nbsp;KITTY&nbsp;<span>7</span></div>
        <div class="gk-sub">TOKYO&nbsp;85 &nbsp;·&nbsp; NEON BATTLE ROYALE</div>
        <div class="gk-start-btn">CLICK TO DROP IN</div>
        <div class="gk-keys">
          <b>WASD</b> move &nbsp; <b>Shift</b> sprint &nbsp; <b>C</b> slide &nbsp; <b>Space</b> jump &nbsp; <b>V</b> skateboard<br>
          <b>Mouse</b> aim &nbsp; <b>L-Click</b> fire &nbsp; <b>R-Click</b> ADS &nbsp; <b>Q/E/R</b> build &nbsp; <b>1–5</b> hotbar &nbsp; <b>G</b> heal
        </div>`;
    } else if (kind === 'victory') {
      this.screen.innerHTML = `
        <div class="gk-victory">#1 GLOCK KITTY ROYALE</div>
        <div class="gk-sub">TOKYO 85 CERTIFIED 🏆</div>
        <div class="gk-stat">Eliminations: <b>${data.kills}</b> &nbsp;·&nbsp; Survived to the last rival</div>
        <div class="gk-start-btn">CLICK TO PLAY AGAIN</div>`;
    } else if (kind === 'defeat') {
      this.screen.innerHTML = `
        <div class="gk-defeat">KNOCKED OUT</div>
        <div class="gk-sub">${data.place ? 'Placed #' + data.place : ''}</div>
        <div class="gk-stat">Eliminations: <b>${data.kills}</b></div>
        <div class="gk-start-btn">CLICK TO RUN IT BACK</div>`;
    }
    return this.screen.querySelector('.gk-start-btn');
  }
}

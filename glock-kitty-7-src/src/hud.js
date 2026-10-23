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

    // Bottom-left: shield over health, big number in a badge, segmented bars
    const bl = this._el('div', 'gk-vitals', this.root);
    const row = (cls, icon) => {
      const r = this._el('div', 'gk-vrow ' + cls, bl);
      const badge = this._el('div', 'gk-vbadge', r);
      this._el('i', 'gk-vicon', badge, icon);
      const num = this._el('b', 'gk-vnum', badge, '0');
      const wrap = this._el('div', 'gk-bar-wrap', r);
      const fill = this._el('div', 'gk-bar', wrap);
      this._el('div', 'gk-bar-seg', wrap);
      return { r, num, fill };
    };
    const sh = row('gk-vshield', '◆'), hp = row('gk-vhp', '✚');
    this.shieldWrap = sh.r; this.shieldFill = sh.fill; this.shieldTxt = sh.num;
    this.hpWrap = hp.r; this.hpFill = hp.fill; this.hpTxt = hp.num;

    // Bottom-right stack: mats + build pieces above the hotbar
    const br = this._el('div', 'gk-right', this.root);
    const tools = this._el('div', 'gk-tools', br);
    this.matsEl = this._el('div', 'gk-mats', tools, '<i>🧱</i><b>0</b>');
    const bc = this._el('div', 'gk-build', tools);
    this.buildChips = {};
    for (const [key, label, sub] of [['wall', 'Q', 'Wall'], ['ramp', 'E', 'Ramp'], ['floor', 'R', 'Floor'], ['edit', 'F', 'Edit']]) {
      const chip = this._el('div', 'gk-chip', bc);
      this._el('div', 'gk-chip-key', chip, label);
      this._el('div', 'gk-chip-sub', chip, sub);
      this.buildChips[key] = chip;
    }
    const hb = this._el('div', 'gk-hotbar', br);
    this.slots = [];
    for (let i = 0; i < 5; i++) {
      const s = this._el('div', 'gk-slot', hb);
      this._el('div', 'gk-slot-num', s, String(i + 1));
      const ammo = this._el('div', 'gk-slot-ammo', s, '');
      const name = this._el('div', 'gk-slot-name', s, '');
      this.slots.push({ el: s, name, ammo });
    }

    // Top-right: minimap, then players left / eliminations
    const tr = this._el('div', 'gk-topright', this.root);
    this.miniCanvas = this._el('canvas', 'gk-mini', tr);
    this.miniCanvas.width = 176; this.miniCanvas.height = 176;
    this.mctx = this.miniCanvas.getContext('2d');
    const stats = this._el('div', 'gk-stats', tr);
    this.aliveEl = this._el('div', 'gk-statbox', stats, '<i>👤</i><b>12</b>');
    this.killsEl = this._el('div', 'gk-statbox', stats, '<i>🎯</i><b>0</b>');

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
    this.hpTxt.textContent = hp;
    this.hpWrap.classList.toggle('low', hp <= max * 0.25);
  }
  setShield(s, max) {
    s = Math.max(0, Math.round(s));
    this.shieldFill.style.width = (100 * s / max) + '%';
    this.shieldTxt.textContent = s;
    this.shieldWrap.classList.toggle('empty', s <= 0);
  }
  setMats(n) { this.matsEl.querySelector('b').textContent = Math.floor(n); }
  setAlive(n) { this.aliveEl.querySelector('b').textContent = n; }
  setKills(n) { if (n !== this._kills) { this._kills = n; this.killsEl.querySelector('b').textContent = n; } }

  setHotbar(slots, active, buildMode) {
    for (let i = 0; i < 5; i++) {
      const s = this.slots[i];
      const item = slots[i];
      s.el.classList.toggle('active', i === active && !buildMode);
      if (!item) {
        s.el.classList.add('empty');
        s.el.style.removeProperty('--rc');
        s.name.textContent = '';
        s.ammo.textContent = '';
        continue;
      }
      s.el.classList.remove('empty');
      // slot background takes the item's rarity color, like a loot tile
      let col = '#8f9aa8';
      if (item.kind === 'gun') col = item.color || RARITY[item.rarity]?.color || col;
      else if (item.kind === 'heal') col = '#ff5fd0';
      else if (item.kind === 'melee') col = '#5fa8ff';
      s.el.style.setProperty('--rc', col);
      s.name.textContent = item.shortName || item.name;
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
    this.banner.style.setProperty('--bc', color || '#ff5fd0');
    this.banner.innerHTML = '<span>' + text + '</span>';
    this.banner.classList.remove('in'); void this.banner.offsetWidth; this.banner.classList.add('in');
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
    const rr = () => { c.beginPath(); if (c.roundRect) c.roundRect(1, 1, W - 2, H - 2, 14); else c.rect(1, 1, W - 2, H - 2); };
    rr(); c.clip();
    c.fillStyle = '#120a26'; c.fillRect(0, 0, W, H);
    c.strokeStyle = 'rgba(255,255,255,0.06)'; c.lineWidth = 1;
    for (let g = W / 8; g < W; g += W / 8) { c.beginPath(); c.moveTo(g, 0); c.lineTo(g, H); c.moveTo(0, g); c.lineTo(W, g); c.stroke(); }
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
    // grid + border
    c.strokeStyle = 'rgba(255,255,255,0.85)'; c.lineWidth = 2;
    rr(); c.stroke();
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
    if (document.body.classList.contains('touch')) {
      const b = this.screen.querySelector('.gk-start-btn'); if (b) b.textContent = b.textContent.replace('CLICK', 'TAP');
      const k = this.screen.querySelector('.gk-keys'); if (k) k.innerHTML = '<b>Left thumb</b> move &nbsp; <b>Right thumb</b> look &nbsp; <b>FIRE</b> shoots and aims while you drag';
    }
    return this.screen.querySelector('.gk-start-btn');
  }
}

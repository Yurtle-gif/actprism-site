// Cloudflare Pages Function: POST /api/events
// Ingests batches of gameplay events from Flock Kitty and writes them to the D1 database bound as `DB`.
// Without a DB binding it still answers 204 so the game never notices; events are simply dropped.
//
// The game never gets to decide what is stored: every batch is re-validated here against the allow-list
// below, timestamps are clamped to the server clock, strings are trimmed, and the row id is derived from
// the session id and the client's sequence number, so a retried batch cannot double count.

const MAX_BODY = 64 * 1024;     // bytes per request
const MAX_EVENTS = 100;         // events per batch (the client sends at most 100)
const MAX_PROPS = 24;           // props per event
const MAX_STR = 96;             // characters per string prop
const CLOCK_SKEW = 24 * 3600e3; // client timestamps further than a day from now are replaced by the server time
const RATE_PER_MIN = 30;        // batches per device per minute, per isolate (best effort)

// event name -> props the server will keep. Anything else is dropped from the row.
// Numeric limits catch obviously forged values (a 10-million-point wave 2 run is not data, it is a prank).
const EVENTS = {
  session_start:     ['returning', 'best', 'streak', 'owned', 'challenge', 'ref', 'reduced_motion', 'cat', 'skin'],
  session_end:       ['duration_s', 'runs', 'mode', 'wave'],
  heartbeat:         ['fps', 'mode', 'wave', 'minutes', 'ride', 'lives', 'queue'],
  ftue_step:         ['step', 'index', 'minutes_since_first'],
  run_start:         ['daily', 'diff', 'cat', 'skin', 'lives', 'picks', 'pass', 'streak', 'mod'],
  run_retry:         ['wave', 'score', 'daily'],
  run_end:           ['score', 'wave', 'kills', 'secs', 'daily', 'diff', 'city', 'in_ride', 'cash_left', 'cash_earned', 'cash_spent', 'hits', 'gun', 'picks', 'kills_by', 'new_best', 'beat_challenge', 'checkpoint'],
  wave_start:        ['wave', 'city', 'boss', 'lives', 'cash', 'gun', 'picks', 'budget'],
  wave_clear:        ['wave', 'secs', 'lives', 'cash', 'kills', 'score', 'city'],
  boss_kill:         ['kind', 'wave', 'secs', 'lives', 'hits', 'score'],
  player_hit:        ['wave', 'lives', 'x', 'y', 'city', 'boss'],
  pickup:            ['kind', 'wave', 'lives'],
  shop_open:         ['wave', 'cash', 'offer', 'prices'],
  upgrade_buy:       ['id', 'cost', 'cash_after', 'wave', 'level', 'drip'],
  shop_leave:        ['wave', 'bought', 'cash', 'secs'],
  ride_start:        ['kind', 'road', 'wave', 'lives', 'cash'],
  ride_hit:          ['kind', 'road', 'why', 'lives', 'secs'],
  ride_end:          ['kind', 'road', 'wave', 'spotted', 'kills', 'unseen', 'bonus', 'pay', 'lives', 'boosts'],
  cat_select:        ['cat'],
  skin_select:       ['skin'],
  diff_select:       ['diff'],
  unlock:            ['streak', 'items'],
  store_open:        ['owned', 'from'],
  store_buy_click:   ['item'],
  purchase_complete: ['item', 'cents'],   // client-reported; purchase_verified (written by /api/verify) is the trusted one
  purchase_failed:   ['item', 'reason'],
  share_open:        ['score', 'wave', 'daily'],
  share:             ['method', 'score'],
  link_copy:         ['score'],
  challenge_beat:    ['target', 'wave'],
  board_entry:       ['rank', 'score', 'daily'],
};
const LIMITS = { score: 5e6, wave: 500, kills: 1e5, secs: 36000, cash: 1e6, cash_left: 1e6, cash_earned: 1e6, cash_spent: 1e6, cost: 1e5, cash_after: 1e6, cents: 1e5, lives: 20, fps: 400, minutes: 1440, duration_s: 86400, rank: 100, bonus: 1e5, pay: 1e5, budget: 1e4, hits: 1e4, boosts: 1e4, streak: 1000, best: 5e6, target: 5e6, level: 20, x: 5000, y: 5000, spotted: 1e3, index: 20, minutes_since_first: 1e7, runs: 1e4, owned: 100, queue: 1000, bought: 100 };

const ID = /^[A-Za-z0-9-]{8,48}$/;
const KEY = /^[a-z0-9_]{1,40}$/;
const buckets = new Map(); // did -> { n, at }  (per-isolate, resets on cold start; cheap first line of defence)

function limited(did) {
  const now = Date.now(), b = buckets.get(did);
  if (!b || now - b.at > 60e3) { buckets.set(did, { n: 1, at: now }); if (buckets.size > 5000) buckets.clear(); return false; }
  return ++b.n > RATE_PER_MIN;
}

function cleanProps(name, p) {
  const allow = EVENTS[name], out = {}; let n = 0;
  if (!p || typeof p !== 'object') return out;
  for (const k of allow) {
    let v = p[k];
    if (v == null || !KEY.test(k)) continue;
    if (typeof v === 'number') { if (!Number.isFinite(v)) continue; if (k in LIMITS && Math.abs(v) > LIMITS[k]) continue; v = Math.round(v * 1000) / 1000; }
    else if (typeof v === 'string') { v = v.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, MAX_STR); }
    else if (typeof v !== 'boolean') continue;
    out[k] = v; if (++n >= MAX_PROPS) break;
  }
  return out;
}

const text = (s, status) => new Response(status === 204 ? null : s, { status, headers: { 'Cache-Control': 'no-store' } });

export async function onRequestPost({ request, env }) {
  const len = Number(request.headers.get('content-length') || 0);
  if (len > MAX_BODY) return text('too big', 413);
  let raw; try { raw = await request.text(); } catch (e) { return text('bad body', 400); }
  if (raw.length > MAX_BODY) return text('too big', 413);
  let b; try { b = JSON.parse(raw); } catch (e) { return text('bad json', 400); }
  if (!b || b.v !== 1 || !ID.test(b.did || '') || !ID.test(b.sid || '') || !Array.isArray(b.events)) return text('bad batch', 400);
  if (b.events.length === 0) return text('', 204);
  if (b.events.length > MAX_EVENTS) return text('too many events', 413);
  if (limited(b.did)) return text('slow down', 429);
  if (!env.DB) return text('', 204); // telemetry not switched on: accept and drop

  const now = Date.now();
  const ctx = b.ctx && typeof b.ctx === 'object' ? b.ctx : {};
  const country = (request.cf && request.cf.country) || '';
  const device = typeof ctx.device === 'string' ? ctx.device.slice(0, 16) : '';
  const platform = typeof ctx.platform === 'string' ? ctx.platform.slice(0, 16) : '';
  const version = Number.isFinite(ctx.v) ? Math.round(ctx.v) : 0;
  const ctxJson = JSON.stringify({ w: ctx.w | 0, h: ctx.h | 0, dpr: +ctx.dpr || 1, lang: typeof ctx.lang === 'string' ? ctx.lang.slice(0, 8) : '' });

  const stmt = env.DB.prepare(
    'INSERT OR IGNORE INTO events (id, received_at, ts, did, sid, run_id, event, seq, country, device, platform, version, ctx, props) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)'
  );
  const rows = [];
  for (const ev of b.events) {
    if (!ev || typeof ev !== 'object' || typeof ev.e !== 'string' || !(ev.e in EVENTS)) continue;
    const seq = Number.isInteger(ev.seq) && ev.seq > 0 && ev.seq < 1e7 ? ev.seq : null;
    if (seq === null) continue;
    let ts = Number(ev.t);
    if (!Number.isFinite(ts) || Math.abs(ts - now) > CLOCK_SKEW) ts = now; // the server clock wins over a wrong device clock
    const run = typeof ev.run === 'string' && ID.test(ev.run) ? ev.run : null;
    rows.push(stmt.bind(b.sid + ':' + seq, now, Math.round(ts), b.did, b.sid, run, ev.e, seq, country, device, platform, version, ctxJson, JSON.stringify(cleanProps(ev.e, ev.p))));
  }
  if (!rows.length) return text('', 204);
  try { await env.DB.batch(rows); } catch (e) { return text('db error', 500); } // 5xx makes the game retry the batch (up to 3 times)
  return text('', 204);
}

export function onRequestGet() { return text('POST only', 405); }

// Cloudflare Pages Function: GET /api/verify?session=cs_...&did=...&sid=... -> {ok, item}
// Confirms with Stripe that the Checkout Session was paid, so the game can unlock the item.
// When the telemetry database (D1 binding `DB`) exists, it also records a server-stamped
// `purchase_verified` event: the one purchase event that cannot be forged from the browser.
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const ID = /^[A-Za-z0-9-]{8,48}$/;

export async function onRequestGet({ request, env }) {
  const key = env.STRIPE_SECRET_KEY;
  if (!key) return json({ ok: false, error: 'The shop is not switched on yet.' }, 503);
  const q = new URL(request.url).searchParams;
  const id = q.get('session') || '';
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(id)) return json({ ok: false, error: 'Bad session id.' }, 400);
  const r = await fetch('https://api.stripe.com/v1/checkout/sessions/' + id, { headers: { Authorization: 'Bearer ' + key } });
  const s = await r.json();
  const ok = r.ok && s.payment_status === 'paid';
  const item = ok && s.metadata ? s.metadata.item : null;
  if (ok && env.DB) {
    const did = ID.test(q.get('did') || '') ? q.get('did') : 'unknown', sid = ID.test(q.get('sid') || '') ? q.get('sid') : 'server';
    const now = Date.now();
    const props = JSON.stringify({ item, cents: s.amount_total | 0, currency: s.currency || '', mode: s.livemode ? 'live' : 'test' });
    try {
      // id derived from the Stripe session, so re-verifying the same purchase never double counts
      await env.DB.prepare('INSERT OR IGNORE INTO events (id, received_at, ts, did, sid, run_id, event, seq, country, device, platform, version, ctx, props) VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, 0, ?7, ?8, ?9, 0, ?10, ?11)')
        .bind('stripe:' + id, now, now, did, sid, 'purchase_verified', (request.cf && request.cf.country) || '', 'server', 'stripe', '{}', props).run();
    } catch (e) { /* telemetry must never break a paid unlock */ }
  }
  return json({ ok, item });
}

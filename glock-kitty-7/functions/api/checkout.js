// Cloudflare Pages Function: POST /api/checkout {item} -> {url}
// Creates a Stripe Checkout Session with the secret key held in the STRIPE_SECRET_KEY environment variable.
const ITEMS = {
  drip_pack:  { name: 'Full Drip Pack',  amount: 299 },
  skin_ice:   { name: 'Ice slide',       amount: 99 },
  skin_blood: { name: 'Blood red slide', amount: 99 },
  kitty_pass: { name: 'Kitty Pass',      amount: 499 }
};
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export async function onRequestPost({ request, env }) {
  const key = env.STRIPE_SECRET_KEY;
  if (!key) return json({ error: 'The shop is not switched on yet.' }, 503);
  let item = '';
  try { item = (await request.json()).item; } catch (e) {}
  const it = ITEMS[item];
  if (!it) return json({ error: 'Unknown item.' }, 400);
  const origin = new URL(request.url).origin;
  const body = new URLSearchParams({
    mode: 'payment',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': String(it.amount),
    'line_items[0][price_data][product_data][name]': 'Flock Kitty · ' + it.name,
    'line_items[0][quantity]': '1',
    'metadata[item]': item,
    success_url: origin + '/?paid={CHECKOUT_SESSION_ID}&item=' + item,
    cancel_url: origin + '/?canceled=1'
  });
  const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const s = await r.json();
  if (!r.ok || !s.url) return json({ error: (s.error && s.error.message) || 'Stripe did not open a checkout.' }, 502);
  return json({ url: s.url });
}

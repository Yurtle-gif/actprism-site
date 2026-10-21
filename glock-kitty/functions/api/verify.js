// Cloudflare Pages Function: GET /api/verify?session=cs_... -> {ok, item}
// Confirms with Stripe that the Checkout Session was paid, so the game can unlock the item.
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export async function onRequestGet({ request, env }) {
  const key = env.STRIPE_SECRET_KEY;
  if (!key) return json({ ok: false, error: 'The shop is not switched on yet.' }, 503);
  const id = new URL(request.url).searchParams.get('session') || '';
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(id)) return json({ ok: false, error: 'Bad session id.' }, 400);
  const r = await fetch('https://api.stripe.com/v1/checkout/sessions/' + id, { headers: { Authorization: 'Bearer ' + key } });
  const s = await r.json();
  const ok = r.ok && s.payment_status === 'paid';
  return json({ ok, item: ok && s.metadata ? s.metadata.item : null });
}

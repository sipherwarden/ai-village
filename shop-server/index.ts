// AI Village shop server. Deploy one instance (any Node 24 host with HTTPS); every AI Village
// install's browser talks to it to buy cosmetics.
//
//   POST /checkout {item, install, returnUrl} -> { url }   Stripe Checkout page for today's price
//   GET  /claim?session=cs_...                -> { receipt } signed receipt once Stripe says "paid"
//   GET  /catalog                             -> today's deals (informational)
//
// Environment:
//   STRIPE_SECRET_KEY   sk_test_... or sk_live_...   (required for real payments)
//   SHOP_SIGNING_KEY    Ed25519 private key from `npm run shop:keygen` (base64 PEM)
//   PORT                default 8787
//   SHOP_FAKE_PAYMENTS  =1 for local testing only: a fake checkout page, no money moves.
//                       Refused when STRIPE_SECRET_KEY is set or NODE_ENV=production.
//
// Prices always come from shared/cosmetics.ts, never from the request.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createPrivateKey, randomBytes, sign } from 'node:crypto';
import { ITEM, dailyDeals, dealDay, priceToday } from '../shared/cosmetics.ts';

const PORT = Number(process.env.PORT ?? 8787);
const STRIPE = process.env.STRIPE_SECRET_KEY ?? '';
const FAKE = process.env.SHOP_FAKE_PAYMENTS === '1';
if (FAKE && (STRIPE || process.env.NODE_ENV === 'production')) {
  console.error('SHOP_FAKE_PAYMENTS cannot be combined with a Stripe key or NODE_ENV=production.');
  process.exit(1);
}
if (!FAKE && !STRIPE) {
  console.error('Set STRIPE_SECRET_KEY (or SHOP_FAKE_PAYMENTS=1 for local testing).');
  process.exit(1);
}
const keyText = process.env.SHOP_SIGNING_KEY ?? '';
if (!keyText) {
  console.error('Set SHOP_SIGNING_KEY (run `npm run shop:keygen`).');
  process.exit(1);
}
const signingKey = createPrivateKey(keyText.includes('BEGIN') ? keyText : Buffer.from(keyText, 'base64').toString('utf8'));

const INSTALL_RE = /^[A-Za-z0-9_-]{8,40}$/;
const SESSION_RE = /^(cs_(test|live)_[A-Za-z0-9]+|fake_[A-Za-z0-9_-]+)$/;
const fakeSessions = new Map<string, { item: string; install: string; paid: boolean; returnUrl: string }>();

function send(res: ServerResponse, code: number, body: unknown, type = 'application/json') {
  res.writeHead(code, {
    'content-type': type,
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'cache-control': 'no-store',
  });
  res.end(type === 'application/json' ? JSON.stringify(body) : String(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 4096) throw new Error('Request too large.');
  }
  return raw ? JSON.parse(raw) : {};
}

async function stripe(path: string, init: { method: 'GET' | 'POST'; form?: Record<string, string> } = { method: 'GET' }) {
  const r = await fetch(`https://api.stripe.com/v1${path}`, {
    method: init.method,
    headers: { authorization: `Bearer ${STRIPE}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: init.form ? new URLSearchParams(init.form).toString() : undefined,
  });
  const j = (await r.json()) as Record<string, unknown> & { error?: { message?: string } };
  if (!r.ok) throw new Error(j.error?.message ?? `Stripe returned ${r.status}`);
  return j;
}

function receipt(item: string, install: string, session: string) {
  const body = Buffer.from(JSON.stringify({ v: 1, item, install, session, ts: Date.now() })).toString('base64url');
  return `${body}.${sign(null, Buffer.from(body), signingKey).toString('base64url')}`;
}

/** Where Stripe sends the buyer back: the village page they came from. */
function returnTo(raw: unknown) {
  const u = new URL(String(raw));
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Bad return address.');
  return `${u.origin}/`;
}

async function checkout(req: IncomingMessage, res: ServerResponse, self: string) {
  const b = await readJson(req);
  const item = String(b.item ?? '');
  const install = String(b.install ?? '');
  if (!ITEM[item] || ITEM[item].price === 0) return send(res, 400, { error: 'That item is not for sale.' });
  if (!INSTALL_RE.test(install)) return send(res, 400, { error: 'Bad install id.' });
  const back = returnTo(b.returnUrl);
  const day = dealDay();
  const price = priceToday(item, day);
  if (FAKE) {
    const id = `fake_${randomBytes(9).toString('base64url')}`;
    fakeSessions.set(id, { item, install, paid: false, returnUrl: back });
    return send(res, 200, { url: `${self}/fake-checkout?session=${id}` });
  }
  const s = await stripe('/checkout/sessions', {
    method: 'POST',
    form: {
      mode: 'payment',
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][unit_amount]': String(price),
      'line_items[0][price_data][product_data][name]': `AI Village · ${ITEM[item].name}`,
      'line_items[0][price_data][product_data][description]': ITEM[item].blurb,
      success_url: `${back}?shop_session={CHECKOUT_SESSION_ID}`,
      cancel_url: `${back}?shop_cancelled=1`,
      'metadata[item]': item,
      'metadata[install]': install,
      'metadata[day]': day,
    },
  });
  send(res, 200, { url: s.url });
}

async function claim(res: ServerResponse, session: string) {
  if (!SESSION_RE.test(session)) return send(res, 400, { error: 'Bad session id.' });
  if (FAKE) {
    const f = fakeSessions.get(session);
    if (!f?.paid) return send(res, 402, { error: 'Not paid.' });
    return send(res, 200, { receipt: receipt(f.item, f.install, session), item: f.item });
  }
  const s = (await stripe(`/checkout/sessions/${session}`)) as { payment_status?: string; metadata?: Record<string, string> };
  if (s.payment_status !== 'paid') return send(res, 402, { error: 'Payment not completed.' });
  const item = s.metadata?.item ?? '';
  const install = s.metadata?.install ?? '';
  if (!ITEM[item] || !INSTALL_RE.test(install)) return send(res, 400, { error: 'Session is not an AI Village purchase.' });
  send(res, 200, { receipt: receipt(item, install, session), item });
}

function fakePage(res: ServerResponse, session: string) {
  const f = fakeSessions.get(session);
  if (!f) return send(res, 404, 'Unknown session', 'text/plain');
  const i = ITEM[f.item];
  send(
    res,
    200,
    `<!doctype html><meta name="viewport" content="width=device-width"><title>Test checkout</title>
<body style="font:16px system-ui;background:#0b1020;color:#e2e8f0;display:grid;place-items:center;height:100vh;margin:0">
<form method="post" action="/fake-pay?session=${session}" style="background:#151b30;padding:28px;border-radius:18px;max-width:340px">
<p style="color:#f59e0b;font-weight:700;margin:0 0 8px">TEST MODE · no money moves</p>
<h2 style="margin:0 0 6px">${i.name}</h2><p style="margin:0 0 18px;color:#94a3b8">${i.blurb}</p>
<p style="font-size:22px;margin:0 0 18px">$${(priceToday(f.item) / 100).toFixed(2)}</p>
<button style="font:inherit;padding:10px 18px;border-radius:999px;border:0;background:#38bdf8;color:#04111d;font-weight:700">Complete test purchase</button>
<a href="${f.returnUrl}?shop_cancelled=1" style="margin-left:12px;color:#94a3b8">Cancel</a></form></body>`,
    'text/html; charset=utf-8',
  );
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  const self = `${req.headers['x-forwarded-proto'] ?? 'http'}://${req.headers.host}`;
  try {
    if (req.method === 'OPTIONS') return send(res, 204, '');
    if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true, mode: FAKE ? 'fake' : STRIPE.startsWith('sk_live') ? 'live' : 'test' });
    if (req.method === 'GET' && url.pathname === '/catalog') return send(res, 200, { day: dealDay(), deals: dailyDeals() });
    if (req.method === 'POST' && url.pathname === '/checkout') return await checkout(req, res, self);
    if (req.method === 'GET' && url.pathname === '/claim') return await claim(res, url.searchParams.get('session') ?? '');
    if (FAKE && req.method === 'GET' && url.pathname === '/fake-checkout') return fakePage(res, url.searchParams.get('session') ?? '');
    if (FAKE && req.method === 'POST' && url.pathname === '/fake-pay') {
      const f = fakeSessions.get(url.searchParams.get('session') ?? '');
      if (!f) return send(res, 404, 'Unknown session', 'text/plain');
      f.paid = true;
      res.writeHead(303, { location: `${f.returnUrl}?shop_session=${url.searchParams.get('session')}` });
      return res.end();
    }
    send(res, 404, { error: 'Not found' });
  } catch (e) {
    send(res, 500, { error: (e as Error).message });
  }
}).listen(PORT, () => console.log(`AI Village shop server on :${PORT} (${FAKE ? 'FAKE payments, testing only' : STRIPE.startsWith('sk_live') ? 'LIVE Stripe' : 'Stripe test mode'})`));

# Running the shop

AI Village sells cosmetics: characters, accessories, islands and emotes. They never change what
the village reports. Payments go through Stripe Checkout and a small **shop server** that you,
the publisher, run once for everyone.

## How a purchase works

1. In the app, the buyer presses **Buy**. Their browser asks the shop server for a Stripe Checkout
   page for that item at today's price, then goes there.
2. After paying, Stripe sends the buyer back to their village with `?shop_session=…`.
3. The browser asks the shop server to confirm. The shop server checks with Stripe that the
   session is paid and returns a **receipt signed with your Ed25519 private key**.
4. The browser gives the receipt to the buyer's own hub. The hub checks the signature with the
   public key in `shop.config.json`, confirms the receipt is for this install, and unlocks the item.

The hub never talks to Stripe or the shop server and never sees card details. Your Stripe secret
key and signing key live only on the shop server. Prices always come from `shared/cosmetics.ts`
(including the daily deals), never from the browser.

## Set it up

1. **Make the signing keys:** `npm run shop:keygen`. Put the public key in `shop.config.json` as
   `publicKey`. Keep the private key secret; it becomes `SHOP_SIGNING_KEY`.
2. **Get a Stripe secret key** from the Stripe dashboard (start with a `sk_test_…` key).
3. **Deploy `shop-server/`** to any Node 24 host with HTTPS (Render, Fly.io, Railway, a VPS…). It
   needs the repository's `shared/` folder alongside it. Start command:
   `node --disable-warning=ExperimentalWarning shop-server/index.ts`, with environment variables
   `STRIPE_SECRET_KEY`, `SHOP_SIGNING_KEY` and optionally `PORT`.
4. **Point the app at it:** put the server's HTTPS address in `shop.config.json` as `serverUrl`,
   commit, and release. Anyone can override both values with `AI_VILLAGE_SHOP_URL` and
   `AI_VILLAGE_SHOP_PUBLIC_KEY`.
5. Test a purchase with Stripe's test card `4242 4242 4242 4242`, then switch to a `sk_live_…` key.

## Try it locally without Stripe

```bash
npm run shop:keygen
SHOP_FAKE_PAYMENTS=1 SHOP_SIGNING_KEY=<private key> npm run shop:server
AI_VILLAGE_SHOP_URL=http://127.0.0.1:8787 AI_VILLAGE_SHOP_PUBLIC_KEY=<public key> npm run hub
```

Fake mode shows a "TEST MODE" checkout page and moves no money. It refuses to start when a Stripe
key is set or `NODE_ENV=production`.

## Things you are responsible for

- **Business details:** Stripe account, payouts, tax (for example sales tax or VAT on digital
  goods), refunds and customer support.
- **Terms:** publish simple terms of sale and a refund policy and link them from your README.
- **Honesty:** AI Village is open source, so anyone can edit their own copy to unlock items for
  free. Purchases are best presented as a way to support the project.
- **Receipts:** stored in each hub's database. If a buyer reinstalls, they get a new install id;
  to restore a purchase, look the session up in Stripe and reissue a receipt for the new install.

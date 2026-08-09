# BlackHorse — Digital Goods Storefront

A simple, self-contained storefront for selling digital goods (accounts, BMs, emails, etc.)
with **Maya Checkout** online payments and **manual payment** methods (GCash / bank transfer).
Layout follows the FB-account autoshop reference style: shop header, announcement banners,
and product listings grouped into category tables (Product · Price · Stock · Buy).

## Features

- **Homepage** — shop name, announcement banners, products grouped by category in tables.
- **Purchase flow** — "Buy" opens a modal for email + quantity + payment method, then proceeds to payment.
- **Maya Checkout** — redirects the customer to Maya's hosted page; status is confirmed via webhook
  and re-synced when the customer returns.
- **Manual payments** — admin-defined methods (GCash, bank transfer…) whose instructions are shown
  to the customer after the order is placed.
- **Order query page** — customers check status / retrieve their delivery using email + order number.
- **Admin panel** — secure login; manage products, categories, banners, manual payment methods,
  Maya keys, and orders (mark paid, deliver account credentials).

## Tech

- Node.js (Express + EJS), no build step.
- **Database:** SQLite via Node's built-in `node:sqlite` — **no native compilation, nothing to build.**
- Sessions via `express-session`; passwords hashed with `bcryptjs`.

## Run

```powershell
cd C:\Users\Admin\Desktop\fblao-shop
npm install
npm start
```

Then open:
- Shop:  http://localhost:3000
- Admin: http://localhost:3000/admin

Default admin login (from `.env`): **admin / admin123** — change it in Admin → Settings.

> Requires Node 22.5+ (uses the built-in `node:sqlite` module). Tested on Node 24.

## Deployment to Railway (Persistent Data)

Railway has an ephemeral filesystem, meaning the database will be deleted every time you redeploy **unless you use a Volume**.

1.  In your Railway project, click **+ New** → **Volume**.
2.  Set the **Mount Path** to `/data`.
3.  Go to your service's **Variables** tab and add:
    - `DATA_DIR` = `/data`
4.  (Optional but recommended) Set a strong `SESSION_SECRET`.

Now your `shop.db` will be stored in the persistent volume and survive redeployments.

## Configuration (`.env`)

| Var | Purpose |
|-----|---------|
| `PORT` | Server port (default 3000) |
| `NODE_ENV` | Node environment (`development`, `production`) |
| `DATA_DIR` | Persistent data directory path for Railway and file storage |
| `BASE_URL` | Public URL, used to build Maya redirect + webhook URLs |
| `SESSION_SECRET` | Session cookie signing secret |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Seed the first admin on initial DB creation |
| `TELEGRAM_BOT_TOKEN` | Optional Telegram bot token for notifications and login |
| `ADMIN_TELEGRAM_ID` | Optional Telegram chat ID for admin notifications |
| `PAYMONGO_ENABLED` | `1` to enable PayMongo checkout on first-run seed |
| `PAYMONGO_SECRET_KEY` | PayMongo secret key for checkout API |
| `PAYMONGO_WEBHOOK_SECRET` | Optional webhook secret for PayMongo |
| `XENDIT_ENABLED` | `1` to enable Xendit invoices on first-run seed |
| `XENDIT_SECRET_KEY` | Xendit secret key for invoice API |
| `XENDIT_CALLBACK_TOKEN` | Optional callback verification token for Xendit |
| `MAYA_MODE` | `sandbox` or `live` |
| `MAYA_PUBLIC_KEY` / `MAYA_SECRET_KEY` | Maya Business API keys |
| `MAYA_WEBHOOK_SECRET` | Optional — enables HMAC verification of webhooks |
| `COINS_MODE` | `sandbox` or `live` for Coins.ph integration |
| `COINS_API_KEY` / `COINS_API_SECRET` | Coins.ph API credentials |
| `COINS_WEBHOOK_SECRET` | Optional webhook secret for Coins.ph |
| `SWIFTPAY_ENABLED` / `SWIFTPAY_MODE` | Enable Swiftpay and choose `sandbox` or `live` |
| `SWIFTPAY_API_KEY` / `SWIFTPAY_API_SECRET` | Swiftpay credentials (also accepts `SWIFTPAY_ACCESS_KEY` / `SWIFTPAY_SECRET_KEY`) |
| `SWIFTPAY_API_BASE_URL` | Optional override for Swiftpay API host |
| `SWIFTPAY_WEBHOOK_SECRET` | Optional webhook HMAC secret for Swiftpay |
| `MAGPIE_ENABLED` | `1` to enable Magpie checkout |
| `MAGPIE_API_KEY` / `MAGPIE_API_SECRET` | Magpie credentials (also accepts `MAGPIE_SECRET_KEY` / `MAGPIE_PUBLISHABLE_KEY`) |
| `MAGPIE_API_BASE_URL` | Optional override for Magpie API host (defaults by key type) |
| `MAGPIE_TARGET_CURRENCY` | Target settlement currency for Magpie checkout (default `CNY`) |
| `MAGPIE_WEBHOOK_SECRET` | Optional webhook HMAC secret for Magpie |

`.env` only seeds the database on **first run**. After that, change everything in **Admin → Settings**.

## Maya setup

1. In **Admin → Settings → Maya Checkout**, enter your **public** (`pk-…`) and **secret** (`sk-…`) keys,
   choose Sandbox/Live, and enable it.
2. Register this webhook URL in your Maya Business dashboard:
   ```
   {BASE_URL}/webhooks/maya/payment-status
   ```
   (e.g. `https://yourdomain.com/webhooks/maya/payment-status`). For local testing, expose the port
   with a tunnel (ngrok/cloudflared) and set `BASE_URL` to the tunnel URL.
3. The site confirms payment two ways for reliability: the webhook **and** a live status re-check
   when the buyer returns to the result page.

### ⚠️ Note on the keys currently in `.env`
The keys copied from `API.txt` are **rejected by Maya's sandbox** with
`401 / K003 "Invalid authentication credentials"`. This is why "Maya still not working" — the keys
are invalid/expired, **not** a code issue. Get fresh keys from your Maya Business dashboard
(Sandbox keys for testing) and paste them in Admin → Settings. Until then, **manual payment works fully.**

## How payment confirmation → delivery works

1. Customer buys → order created as `pending`.
   - **Maya:** redirected to Maya; on success the webhook (or return re-sync) marks it `paid` and decrements stock.
   - **Manual:** instructions shown; admin clicks **Mark as paid** once payment is verified (decrements stock).
2. Admin opens the order → pastes the account credentials → **Deliver to customer** (status → `delivered`).
3. Customer sees the delivered content on the result page and via **Query Order** (email + order number).

## Project layout

```
src/
  app.js            Express app + middleware
  db.js             Schema, settings helpers, first-run seed
  sqlite.js         Thin wrapper over node:sqlite (prepare/exec/pragma/transaction)
  maya.js           Maya Checkout: create checkout, status lookup, webhook HMAC
  helpers.js        Order numbers, money formatting, escaping
  routes/
    public.js       Storefront, order creation, result, query
    admin.js        Auth + products/categories/payments/banners/settings/orders
    webhook.js      POST /webhooks/maya/payment-status
views/              EJS templates (public + admin)
public/             CSS + purchase-modal JS
data/shop.db        SQLite database (created on first run)
```

Digital goods are delivered to the customer's order page (and intended for the email on file).
For authorized use only.

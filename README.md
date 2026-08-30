# FoodFlow

**Conversational commerce agents for every merchant** — LifeHack 2026, Visa problem statement.

Discover, decide and pay for campus food in a single conversation, without ever leaving the chat window. Built around six real NUS canteens and the stalls in them.

**Live:** <https://lifehacks-foodflow.vercel.app>

**Merchant onboarding bot:** message the FoodFlow Agent on Telegram and send it a photo of any menu.

---

## What's actually behind the agent

Two engines, and it matters which is running:

1. **A deterministic rules engine** (`api/_engine.js`) parses what the customer said into structured *needs* — soupy, no pork, under $4, near Frontier — and applies every **hard filter**: dietary, allergens, budget. This is not optional and never delegated.
2. **A language model** (`api/agent.js`) is then shown *only the dishes that survived those filters*, and picks among them and writes the sentence.

That ordering is the safety design. **The model cannot recommend a dish containing something the customer said they can't eat, because it never sees one.** An agent that confidently says "no shellfish" and is wrong is a real-world harm, not a bug — so allergens are a filter, never a soft preference the model weighs.

Money is likewise never the model's decision. Totals are computed server-side, checkout is triggered by the client, and the model is explicitly instructed that it cannot claim a payment happened.

**Without an API key the whole demo still works** on the rules engine alone — discovery, cart, authorisation, collection. That's deliberate. A judging hall is a terrible place to find out you needed working wifi.

---

## Quick start

```bash
npm install
npm run dev          # → http://localhost:3000
```

That's it. No API key required.

### Adding a model (optional)

```bash
cp .env.example .env
```

Then put a key in `.env`:

```
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
```

Get one at <https://platform.openai.com/api-keys>. It's billed per use — this app sends roughly 2–3 KB per message, so a full demo costs cents, not dollars. `gpt-4o-mini` is the default because it's fast and cheap; `gpt-4o` is better at phrasing if you'd rather pay for it.

**The key is only ever read server-side.** It is never sent to the browser and never appears in client code. `.env` is gitignored — do not commit it.

Restart the server and it will tell you which engine it's on:

```
FoodFlow → http://localhost:3000
agent    → model (gpt-4o-mini)
```

---

## Deploying to Vercel

```bash
npm i -g vercel
vercel            # first deploy, answer the prompts
vercel --prod     # production
```

Vercel serves `public/` statically and turns each file in `api/` into a serverless function. No build step, no config beyond `vercel.json`.

To add the key on Vercel: **Project → Settings → Environment Variables → add `OPENAI_API_KEY`**, then redeploy. Deploy without it first — the site works, and you can add the model later without touching code.

---

## Architecture

```
public/            the storefront and the agent widget (no framework, no build)
  index.html
  styles.css
  app.js           UI, cart, checkout, and a local fallback engine

api/
  catalog.json     one catalog. the single source of truth.
  catalog.js       GET  /api/catalog
  _engine.js       needs-parsing, hard filters, scoring, explanations
  agent.js         POST /api/agent   model + guardrails + fallback

server.js          local dev: serves public/ and mounts api/ the way Vercel does
```

**One catalog.** The client holds no dish data; it fetches `/api/catalog` on boot. Anything published by a merchant is immediately visible to the agent because they read the same file.

**Runtime path.** Customer message → `/api/agent` → needs parsed and merged with what we already knew → hard filters → shortlist → model picks and phrases → client renders, with each pick explained in the customer's own words.

**Catalog shape.** Canteen → stall → category → dish. Every dish carries the attributes the conversation actually turns on:

```json
{
  "name": "Chicken Katsu Don", "price": 4.30, "prep": 10,
  "fl": { "savoury": 3, "sweet": 2, "salty": 2, "spicy": 0, "sour": 0 },
  "tex": ["crispy"], "temp": "hot", "heavy": 4, "form": "rice", "cuisine": "Japanese",
  "diet": [], "has": ["chicken", "egg", "gluten"]
}
```

Keyword search cannot answer "warm and soupy, not too heavy, no pork, under $10". Scoring over these fields can.

---

## Merchant onboarding

Switch to **Merchant** in the header, then **Add a canteen**.

Paste any menu — inconsistent columns, missing prices, section-header rows, duplicates. The catalog agent maps your columns onto the schema, detects the stalls, invents categories that fit *that* menu rather than a fixed taxonomy, writes a customer-facing line for dishes with no description, extracts the flavour and dietary attributes, and flags whatever it couldn't resolve.

You get a **canteen → stall → category → dish** tree. Everything the agent wrote is tagged `AGENT`; unresolved rows are flagged in red. Rename anything, delete anything. **Nothing reaches customers until you press Publish.**

Most merchants in this category have no website, so the integration story is four doors, not a script tag:

| Merchant has | How they adopt it |
|---|---|
| Nothing but a stall | Hosted page + QR code on the counter |
| A Wix / Shopify site | One-click app in that platform's marketplace |
| A GrabFood listing | Import the menu they already keep current |
| Only a phone | **Photograph the menu board into a Telegram bot** — implemented, see below |
| A POS system | API + webhooks, live prices and stock |

All four resolve to the same published agent.

---


## Merchant onboarding by Telegram

The web console expects a spreadsheet. A hawker standing at their stall has a phone and a menu board, so the real ingest path is a photo in a chat they already have open.

**The flow:** merchant messages the bot → sends a photo of the menu board → the agent reads it and replies with a tree → they correct anything by typing → one tap on **Publish** → it is live in the storefront and the food agent can recommend from it immediately. No website, no app, no forms.

The tree they see is deliberately shallow, because Telegram is a narrow column on a phone:

```
🏫 Ah Seng Coffee Shop
Blk 505 Jurong West · 6 min walk

🏪 Ah Seng Noodles
   Noodles
   • Wanton Mee — $4.00
   • Dumpling Soup — $4.50

🏪 Nasi Padang
   • Rice with 2 dishes — $4.50
   • Teh Tarik — —  ⚠️ no price

2 stalls · 5 dishes · 1 missing a price
```

Categories only appear if the board actually printed them. If the menu is just a list, the dishes sit straight under the stall — inventing a taxonomy that isn't on the board would be making things up. Missing prices are flagged rather than guessed, and the merchant fixes one by typing `teh tarik 1.60`.

### What the model is and isn't allowed to conclude

Reading a menu photo means guessing, so the guesses are split by what happens when they're wrong:

| Inferred generously | Never inferred |
|---|---|
| **Contains** — chicken, pork, gluten, dairy, nuts… A false positive only hides the dish from someone avoiding that ingredient, which is the safe direction to be wrong in. | **Halal** — a certification, not something readable off a photo. |
| **Attributes** — noodles vs rice, soupy vs fried, spicy, prep time. Wrong just means a slightly worse recommendation. | **Vegetarian** — calling a dish vegetarian when it isn't puts food in front of someone who didn't want it. |
| **Calories and protein** — estimated and always shown with a `~`. | **Prices** — flagged as missing rather than invented. |

Dietary flags stay empty until the merchant sets them. The bot says so when it publishes.

### What the bot accepts

A merchant doesn't think in file formats, so the bot branches on nothing — everything is normalised to images or text and read the same way (`api/_intake.js`).

| They send | What happens |
|---|---|
| **Photo** of the menu board | Read by the vision model |
| **PDF** | Text pulled straight out of the FlateDecode streams with `zlib` — no dependency. A scan with no text layer is detected and reported, not silently failed |
| **CSV / TXT / TSV / MD** | Read as text |
| **Voice note** | Transcribed. Reading a menu aloud is the one input a stall owner can give with their hands full |
| **Video** | Telegram's cover frame is read, with an honest warning that it's one small frame |
| **A link to their website** | Page text plus any schema.org `ld+json`. No prices on the page usually means a JavaScript shell — it follows a linked PDF, or reads the menu **images** off the page, which is what most restaurant sites actually are |

Every path ends in the same review tree, and a menu spread over several pictures is merged into one.

### Correcting it

Menus are wrong and merchants type like people, so the correction path has two layers (`api/_understand.js`):

1. **Deterministic and instant.** Dish/price pairs in any layout — one per line or several to a line, dashes, colons, commas — matched to the draft token by token with a small edit distance. `classis caesar` finds *Classic Caesar*; `sausage mushroom sauce` finds *Sausage with Mushroom Sauce*.
2. **Then the model, returning an action** — `set_prices`, `add_items`, `remove_items`, `rename`, `set_name`, `set_location`, `answer` — which code performs. *"Take off the striploin, we stopped selling it"* removes a dish. *"It's called Eighteen Chefs, and make the no-price ones 4.90"* does both in one message.

**The model never writes to the catalog and never decides what a price is**, and every confirmation is written by code after the write succeeds — so the bot cannot announce a change it didn't make. Same split as the customer agent: reasoning proposes, deterministic code disposes.

Commands are registered with Telegram, so the ☰ menu lists them: `/start`, `/menu`, `/diet`, `/remove`, `/new`, `/help`. `/diet` is where the merchant confirms halal and vegetarian — the two flags the model is never allowed to infer — writing straight to the live catalog. `/remove` takes a canteen back down. A published canteen stays editable: *"change my storefront name to X"* rewrites it live.

### Setting it up

1. Message [@BotFather](https://t.me/BotFather) → `/newbot` → copy the token.
2. Add these in Vercel → Settings → Environment Variables, then redeploy:

```
TELEGRAM_BOT_TOKEN=123456:ABC...
TELEGRAM_WEBHOOK_SECRET=any-random-string
OPENAI_API_KEY=sk-...            # photo reading needs the model
```

3. Point Telegram at your deployment (once):

```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://lifehacks-foodflow.vercel.app/api/telegram&secret_token=<SECRET>"
```

4. Register the ☰ command menu (once):

```bash
curl "https://lifehacks-foodflow.vercel.app/api/telegram?setup=1"
```

4. Message your bot `/start` and send a photo of any menu.

`GET /api/health` reports whether the bot token and the model are configured.

### Where published menus live

Vercel's filesystem is read-only at runtime, so `api/catalog.json` is the seed catalog and nothing more. Menus published from Telegram go to a key-value store. Set `KV_REST_API_URL` and `KV_REST_API_TOKEN` (Vercel KV or Upstash, both have a free tier) and they persist. Without them it falls back to memory on the running instance — fine for a demo, gone on a cold start. `/api/health` tells you which mode is active, so nobody has to guess.


## Trust, consent and payment

The customer performs **one** deliberate act, not three. No consent checkbox, no separate OTP screen, no separate pay button — those are theatre that people click through without reading.

Instead, one screen shows everything they are agreeing to: the items grouped by stall, where to collect, the linked card, and the **spend mandate** (this agent may spend up to S$40 per order at campus canteens; this order uses S$6.90 of it; single charge, never recurring). Then a **press-and-hold** plus a biometric check. Deliberate enough that it can't fire by accident, reversible until it completes, and that one gesture is simultaneously the consent, the identity verification and the authorisation.

Transparency lives in what the screen *shows*, not in how many times you make someone click.

**Multi-stall orders stay a single authorisation.** A cart spanning two canteens is one charge, split at capture — the receipt shows exactly where the money went, per stall, plus courier and platform fee. Splitting it into separate orders would mean verifying twice, which defeats the whole design.

This maps onto Visa's [Trusted Agent Protocol](https://github.com/visa/trusted-agent-protocol), which requires an agent to prove it is a recognised entity, acting for an authenticated user, carrying valid instructions for that transaction. The authorisation screen produces exactly that payload.

---

## What is real and what is simulated

Being straight about this, because it's the first thing a judge should be able to trust:

| Real | Simulated |
|---|---|
| Stall names, dishes and prices from six NUS canteens | Payment — no charge is made, no Visa integration |
| Attribute extraction, filtering and ranking | Face ID — a scripted step-up, not a WebAuthn passkey |
| The catalog agent's tree generation | Courier quotes — pandago/Lalamove/GrabExpress prices are plausible, not live |
| The model call, when a key is set | Order status — advances on a timer |
| Server-side pricing and the settlement split | Merchant payouts — the split is computed and shown, not paid out |

Prices were gathered from public food guides and drift over time. Menu drift is a real problem for this product, which is precisely what the merchant console and the POS door exist to solve.

---

## Licence

MIT. Built at LifeHack 2026, NUS Students' Computing Club.

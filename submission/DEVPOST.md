# FoodFlow — Devpost submission copy

Paste each section into the matching Devpost field. Replace `<LIVE URL>` and `<BOT>` before submitting.

---

## Tagline

Discover, decide and pay for campus food in one conversation — and onboard a hawker stall by photographing its menu board.

---

## Inspiration

The challenge asks how merchants of *any size* can deploy a commerce agent. Every answer we found assumed the merchant already has a website to drop a `<script>` tag into. Almost no hawker stall in Singapore has one.

That assumption quietly excludes the merchants who need this most. So we built for the hardest case first — a stall owner with a phone, a menu board, and no website — and let everything else fall out of that.

## What it does

**For the customer.** One conversation: "something warm and soupy, no pork, under $6, near Frontier." The agent understands the constraint, filters six real NUS canteens, explains each pick in the customer's own words, builds a cart that can span stalls, and completes payment in the same window. Voice works too — press and hold, speak, and the agent replies out loud.

**For the merchant.** Four ways in, all resolving to the same published agent:

| Merchant has | How they adopt it |
|---|---|
| Nothing but a stall and a phone | **Photograph the menu board into a Telegram bot** — implemented |
| A spreadsheet | Paste any messy menu into the web console |
| A Wix / Shopify site | One-click marketplace app |
| A GrabFood listing | Import the menu they already keep current |
| A POS system | API + webhooks — live prices and stock |

Adding a door is a distribution decision, not an architecture change.

## Architecture (AI + payments)

**Two engines, and it matters which one is running.**

1. A **deterministic rules engine** (`api/_engine.js`) parses the message into structured needs — soupy, no pork, under $4, near Frontier — and applies every **hard filter**: dietary, allergen, budget.
2. A **language model** (`api/agent.js`) is then shown *only the dishes that survived those filters*, and picks among them and writes the sentence.

That ordering is the safety design. **The model cannot recommend a dish containing something the customer said they can't eat, because it never sees one.** Model output is validated against the surviving candidate-ID set before it reaches the browser. An agent that confidently says "no shellfish" and is wrong is a real-world harm, not a bug — so allergens are a hard filter, never a soft preference the model weighs.

Money is never the model's decision either. Totals are computed server-side, checkout is triggered by the client, and the model is explicitly instructed that it cannot claim a payment happened.

```
customer message
  → /api/agent
  → needs parsed, merged with what we already knew
  → hard filters (diet · allergen · budget)   ← deterministic, never delegated
  → shortlist
  → model picks and phrases                    ← sees only survivors
  → client renders, each pick explained
  → authorisation → settlement split per stall
```

**One catalog.** The client holds no dish data; it fetches `/api/catalog` on boot, so anything a merchant publishes is visible to the agent immediately. Every dish carries the attributes a conversation actually turns on — flavour vector, texture, temperature, heaviness, form, cuisine, dietary flags, contained ingredients. Keyword search cannot answer "warm and soupy, not too heavy, no pork, under $10". Scoring over those fields can.

**It runs with no API key at all.** On the rules engine alone the full demo completes — discovery, cart, authorisation, collection. Deliberate: a judging hall is a terrible place to find out you needed working wifi.

Stack: vanilla JS front end, no framework and no build step; Node serverless functions on Vercel; a key-value store for published menus. The whole thing deploys in one command.

## Merchant onboarding flow

**The bridge: onboarding is itself conversational.** The merchant doesn't fill in a form to get an agent — they talk to one, in an app they already have open.

Message the bot → send a photo of the menu board → the agent reads it and replies with a canteen → stall → category → dish tree → correct anything by typing (`teh tarik 1.60`) → one tap on **Publish** → it is live in the storefront and the food agent can recommend from it immediately. No website, no app, no spreadsheet, no forms.

The tree is deliberately shallow, because Telegram is a narrow column on a phone. Categories appear only if the board actually printed them — inventing a taxonomy that isn't on the board would be making things up.

**What the model is and isn't allowed to conclude.** Reading a menu photo means guessing, so we split the guesses by what happens when they're wrong:

| Inferred generously | Never inferred |
|---|---|
| **Contains** — chicken, pork, gluten, dairy, nuts. A false positive only hides the dish from someone avoiding that ingredient — the safe direction to be wrong in. | **Halal** — a certification, not something readable off a photo. |
| **Attributes** — noodles vs rice, soupy vs fried, spicy, prep time. Wrong just means a slightly worse recommendation. | **Vegetarian** — calling a dish vegetarian when it isn't puts food in front of someone who didn't want it. |
| **Calories and protein** — estimated, always shown with a `~`. | **Prices** — flagged as missing, never invented. |

Dietary flags stay empty until the merchant sets them, and the bot says so when it publishes. Everything the agent wrote is tagged `AGENT` in the review tree; unresolved rows are flagged in red. **Nothing reaches customers until the merchant presses Publish.**

The web console still exists for price edits, sold-out toggles and orders — but it's the second thing a merchant touches, not the first. No JSON, no API keys on the front page, no word like "endpoint" visible to a merchant.

## Trust, consent and transparency

**The customer performs one deliberate act, not three.** No consent checkbox, no separate OTP screen, no separate pay button — those are theatre that people click through without reading.

Instead, one screen shows everything being agreed to: items grouped by stall, where to collect, the linked card, and the **spend mandate** — *this agent may spend up to S$40 per order at campus canteens; this order uses S$6.90 of it; single charge, never recurring.* Then a **press-and-hold** plus a biometric check. Deliberate enough that it can't fire by accident, reversible until it completes, and that one gesture is simultaneously the consent, the identity verification and the authorisation.

Transparency lives in what the screen *shows*, not in how many times you make someone click.

**Multi-stall orders stay a single authorisation.** A cart spanning two canteens is one charge, split at capture — the receipt shows exactly where the money went, per stall, plus courier and platform fee. Splitting it into separate orders would mean verifying twice, which defeats the design.

This maps onto Visa's [Trusted Agent Protocol](https://github.com/visa/trusted-agent-protocol): an agent must prove it is a recognised entity, acting for an authenticated user, carrying valid instructions for that transaction. The authorisation screen produces exactly that payload. Checkout never redirects — the entire flow completes in the conversation.

## What is real and what is simulated

We'd rather a judge learn this from us than find it themselves.

| Real | Simulated |
|---|---|
| Stall names, dishes and prices from six NUS canteens | Payment — no charge is made, no live Visa integration |
| Attribute extraction, filtering and ranking | Face ID — a scripted step-up, not a WebAuthn passkey |
| Menu-photo reading and tree generation | Courier quotes — plausible, not live |
| The model call, when a key is set | Order status — advances on a timer |
| Server-side pricing and the settlement split | Merchant payouts — the split is computed and shown, not paid |

## Challenges we ran into

- **The catalog was duplicated in three places** in the prototype we inherited — client array, server array, merchant upload — so publishing a menu changed nothing the agent could see. Collapsing it to one `/api/catalog` was the single highest-value fix.
- **Serverless kills you quietly.** Our Telegram webhook acked Telegram first and did the work after, which is correct on a long-lived server and fatally wrong on Vercel — the invocation ends the moment the response is sent, so menu-photo onboarding silently did nothing in production while every log looked healthy.
- **Vercel's filesystem is read-only at runtime**, so a published menu can't be written back to `catalog.json`. Published catalogs go to a KV store, with an in-memory fallback so the demo survives a missing integration; `/api/health` reports which mode is live rather than making anyone guess.
- **Deciding what the model isn't allowed to infer** took longer than building the inference. "Halal" was the argument that settled it.

## What we learned

The hard part of agentic commerce for small merchants isn't the agent. It's that the merchant has no structured catalog and no way to make one — and that every field the AI fills in is a liability someone eventually eats. Getting the *split* right between what a model may guess and what a human must confirm turned out to be the actual product.

## What's next

- Real settlement: reuse the acquirer's KYC and pay into the account the stall already has.
- POS feed for live prices and sold-out flags — the real fix for menu drift.
- WhatsApp alongside Telegram, since that's what hawkers in Singapore actually use.
- Take rate on completed transactions, not a subscription. The merchant pays only once they've been paid.

## Built with

`javascript` · `node.js` · `vercel` · `openai` · `telegram-bot-api` · `web-speech-api` · `vanilla-js` · `visa-trusted-agent-protocol`

## Links

- **Live demo:** `<LIVE URL>`
- **Merchant onboarding bot:** `t.me/<BOT>` — send it a photo of any menu
- **Source:** https://github.com/theadriankang/foodflow

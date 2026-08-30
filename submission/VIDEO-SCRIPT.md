# FoodFlow — demo video script

**Target: 2:30. Hard cap 3:00.** Screen recording + voiceover. Record the browser at 1280×800, phone screen for the Telegram section.

**Before you hit record**
- Load the live URL, hard-refresh, cart empty, Customer view.
- Telegram open on a second device with a fresh chat (`/new`), and a menu-board photo already in the camera roll.
- Hit `/api/health` once first to warm the functions — a cold start mid-demo costs you 4 seconds of dead air.
- Mute notifications on both devices.

---

## 0:00–0:15 — The problem, in one sentence

**Screen:** FoodFlow landing, canteen grid.

> "Every conversational commerce demo assumes the merchant already has a website to put the widget on. A hawker stall doesn't. We built for that merchant first."

## 0:15–0:55 — Discover and decide

**Screen:** Open the chat. Type — don't paste, let them see it being typed:

> `something warm and soupy, no pork, under $6, near Frontier`

**Voiceover, over the results appearing:**

> "Four constraints in one sentence. Keyword search can't answer this. Every dish carries flavour, texture, temperature, price and ingredients — so the agent filters on all four at once and explains each pick in the words I used."

**Point at one explanation line on screen.** Then follow up in the chat:

> `is there anything with more protein?`

> "It remembers the constraints. I don't have to say 'no pork' again."

## 0:55–1:15 — The safety line (this is the rubric point — don't rush it)

**Screen:** stay in the chat.

> "One thing worth being precise about. The filtering isn't done by the model. A rules engine applies the hard filters — diet, allergens, budget — and the model is shown *only* what survived. It cannot recommend something I said I can't eat, because it never sees it. An agent that says 'no shellfish' and is wrong is a real-world harm, not a bug."

## 1:15–1:45 — Pay, without leaving the conversation

**Screen:** add two items *from different stalls*, open the authorisation screen.

> "One screen, one gesture. Items grouped by stall, where to collect, the card, and the spend mandate — this agent may spend up to forty dollars per order at campus canteens; this order uses six ninety; single charge, never recurring."

**Press and hold. Let the ring fill on camera. Face ID step. Receipt.**

> "Press and hold, plus a biometric check. No consent checkbox, no separate OTP screen, no separate pay button — that's theatre people click through without reading. One deliberate act that is simultaneously the consent, the identity check and the authorisation. Two stalls, one charge, split at capture — the receipt shows exactly where the money went."

**Say it plainly:** "The payment is simulated. Nothing is charged."

## 1:45–2:25 — The merchant, in 40 seconds

**Screen:** cut to the phone. Telegram, fresh chat.

> "Now the other half. This is a stall owner with a phone and a menu board."

**Send the photo. Do not cut the wait — let it run.**

> "One photo. No website, no app, no spreadsheet."

**Tree appears.**

> "It reads the board into stalls, categories and dishes. It flags the item with no price rather than inventing one — and it will not guess halal or vegetarian off a photograph, because those are certifications and allergen decisions, not things you read off an image. Those stay empty until the merchant sets them."

**Type a correction:** `teh tarik 1.60` → **tap Publish.**

**Cut straight back to the browser, refresh the storefront, ask the customer agent for something from that stall.**

> "Published. The customer agent is recommending from it seconds later. That's the whole onboarding."

## 2:25–2:40 — Close

**Screen:** the four-doors table in the README, or the storefront.

> "Same runtime, four ways in — a photo, a spreadsheet, a Shopify app, a POS feed. Adding a door is a distribution decision, not an architecture change. That's how you get to every merchant, not just the ones who already have a developer."

---

## Rules for this recording

- **Never cut a loading state.** Judges assume a cut hides a failure. Real latency reads as real software.
- **Say "simulated" out loud once**, at the payment. Once is honest; three times sounds nervous.
- **Type the queries live.** Pasting looks pre-baked.
- **If the model call fails mid-take, keep going** — the rules engine answers anyway, and you can say so. That's a feature.
- Record it twice, keep the second take.

## If Telegram is still not live at record time

Cut the Telegram section and do merchant onboarding through the **web console** instead (Merchant → Add a canteen → paste a messy menu → tree → Publish). Same 40 seconds, same point, and the messy-CSV parsing is genuinely good. Say "a photo into a chat is the same path from a phone" and move on. **Do not** show a broken bot on camera.

/* POST /api/agent
   { prompt, needs, cart, fulfil } -> { say, itemIds, why, chips, addIds, needs, fulfil, go }

   Safety architecture, and the thing worth explaining to anyone who asks:
   the deterministic engine runs FIRST and applies every hard filter — dietary,
   allergen, budget. Only the surviving candidates are shown to the model. The model
   chooses among them and writes the sentence; it never sees a dish the customer said
   they can't eat, so it cannot recommend one. Money and consent are likewise never
   the model's to decide — checkout is triggered by the client, priced by the server. */

const E = require('./_engine.js');

const KEY   = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

const SYSTEM = `You are FoodFlow, a food-ordering agent for canteens at NUS in Singapore.

You will be given CANDIDATES: dishes that already satisfy every hard constraint the
customer stated (dietary, allergens, budget). Recommend ONLY from that list. If it is
empty, say so plainly and suggest dropping one constraint.

Style: talk like a friend who knows the canteens. Short. Never list features, never use
bullet points, never repeat the customer's words back at them. Singapore English is fine
("chope", "damn hungry") but don't overdo it.

Rules:
- Recommend at most 3 dishes; if one is clearly best, recommend just that one.
- Ask AT MOST one clarifying question, and only when it would genuinely change your pick.
  Good gaps to ask about: which canteen they're near, rice vs noodles, budget.
- Never claim a payment happened, never invent prices, never invent dishes.
- If they ask to pay/checkout/authorise, set "go": true and keep the sentence short.
- If they ask for delivery, set "fulfil": "deliver".
- If they clearly name a dish to add, put its id in "addIds".

Reply with JSON only:
{
  "say": "one or two sentences",
  "itemIds": ["id", ...],
  "why": ["short reason per item, in the customer's own terms, e.g. 'soupy · no pork · S$3.10'"],
  "chips": ["up to 3 short suggested replies"] or null,
  "addIds": [],
  "fulfil": "pickup" | "deliver" | null,
  "go": false
}`;

function deterministic(prompt, needs, cart) {
  const ranked = E.rank(needs);
  if (!ranked.length) {
    return { say: "Nothing on campus clears all of that at once. Drop one of the chips below and I'll look again.",
             itemIds: [], why: [], chips: ['Start over'], needs, go: false };
  }
  const top = ranked.slice(0, ranked[0].s >= 7 ? 1 : ranked[0].s >= 4 ? 2 : 3).map(x => x.d);
  const one = top.length === 1;
  return {
    say: one ? 'This is the one — nothing else fits all of that.' : 'Closest fits. Want me to lock one in?',
    itemIds: top.map(d => d.id),
    why: top.map(d => E.because(d, needs)),
    chips: null, needs, go: false
  };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const body   = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const prompt = String(body.prompt || '').trim();
  const cart   = Array.isArray(body.cart) ? body.cart : [];
  const prior  = body.needs && typeof body.needs === 'object' ? body.needs : {};

  if (!prompt) return res.status(200).json({ say: "Tell me what you're craving.", itemIds: [], needs: prior });

  const needs = E.parse(prompt, prior);
  const wantsCheckout = /authoris|authorize|check ?out|\bpay\b|place (the|my) order/i.test(prompt);
  const wantsDelivery = /deliver|send it to me|don'?t want to walk|too far to walk/i.test(prompt);

  if (!KEY) {
    const out = deterministic(prompt, needs, cart);
    return res.status(200).json({ ...out, engine: 'rules', go: wantsCheckout && cart.length > 0,
                                  fulfil: wantsDelivery ? 'deliver' : null });
  }

  const candidates = E.rank(needs).slice(0, 12).map(({ d }) => ({
    id: d.id, name: d.name, price: d.price, stall: d.stall, canteen: d.courtName, walkMin: d.walk,
    prepMin: d.prep, cuisine: d.cuisine, form: d.form, texture: d.tex, temperature: d.temp,
    heaviness: d.heavy, dietary: d.diet, contains: d.has
  }));

  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.6,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content:
            `CUSTOMER SAID: ${prompt}\n\n` +
            `WHAT WE KNOW SO FAR: ${JSON.stringify(Object.fromEntries(Object.entries(needs).map(([k, v]) => [k, v.label])))}\n\n` +
            `CART: ${cart.length ? JSON.stringify(cart) : 'empty'}\n\n` +
            `CANDIDATES (recommend only from these): ${JSON.stringify(candidates)}` }
        ]
      })
    });

    if (!r.ok) throw new Error(`openai ${r.status}`);
    const data = await r.json();
    const parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}');

    /* the model may only return ids we offered it */
    const allowed = new Set(candidates.map(c => c.id));
    const itemIds = (parsed.itemIds || []).filter(id => allowed.has(id)).slice(0, 3);
    const addIds  = (parsed.addIds  || []).filter(id => E.byId(id)).slice(0, 3);

    return res.status(200).json({
      say:    String(parsed.say || 'Here are the closest matches.').slice(0, 600),
      itemIds,
      why:    Array.isArray(parsed.why) ? parsed.why.slice(0, 3) : itemIds.map(id => E.because(E.byId(id), needs)),
      chips:  Array.isArray(parsed.chips) ? parsed.chips.slice(0, 3) : null,
      addIds,
      needs,
      fulfil: parsed.fulfil === 'deliver' || wantsDelivery ? 'deliver' : (parsed.fulfil === 'pickup' ? 'pickup' : null),
      go:     (!!parsed.go || wantsCheckout) && cart.length > 0,
      engine: 'model'
    });
  } catch (err) {
    console.error('[agent] falling back to rules:', err.message);
    const out = deterministic(prompt, needs, cart);
    return res.status(200).json({ ...out, engine: 'rules-fallback',
                                  go: wantsCheckout && cart.length > 0,
                                  fulfil: wantsDelivery ? 'deliver' : null });
  }
};

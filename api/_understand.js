/* Reacting to whatever the merchant actually typed.

   The old flow was a cascade of hard-coded rules, and anything that didn't fit
   one fell through to "send me a photo of your menu board" — which is the worst
   possible reply to someone who just sent you five corrections. We cannot
   enumerate every shape a person might type, so this file does two things:

     1. Cheap, deterministic parsing of the common shape — dish names and prices
        in any layout, one per line or several to a line.
     2. Everything else goes to the model, which returns an ACTION, not prose.
        The action is then applied by code. The model decides what was meant;
        it never decides what a price is or writes to the catalog itself. */

const KEY   = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

/* ── name/price pairs out of free text ───────────────────────────────── */
const PAIR = /^(.+?)[\s.:\-–—=]*\$?\s*(\d+(?:[.,]\d{1,2})?)\s*$/;

function parsePairs(text) {
  const out = [];
  for (const raw of String(text).split(/[\n;]+/)) {
    /* "a - 8.9, b 4.6" is two pairs; only split on commas that follow a number */
    for (const part of raw.split(/,(?=\s*[^\d])|(?<=\d),/)) {
      const m = part.trim().match(PAIR);
      if (!m) continue;
      const name = m[1].replace(/[\s\-–—:.]+$/, '').trim();
      const price = Number(m[2].replace(',', '.'));
      if (name.length > 1 && name.length < 80 && price > 0 && price < 1000) out.push({ name, price });
    }
  }
  return out;
}

/* ── matching what they typed to what's in the draft ──────────────────
   Merchants typo their own menu ("classis caesar"), drop words ("sausage
   mushroom sauce" for "Sausage with Mushroom Sauce") and change case. Exact
   matching fails on all three, so compare token by token with a small edit
   distance and score the overlap. */
const norm = s => String(s).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
const STOP = new Set(['with', 'and', 'the', 'a', 'of', 'in', 'on', 'w']);
const tokens = s => norm(s).split(' ').filter(t => t && !STOP.has(t));

function editDistance(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 2) return 9;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++)
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
const tokenHit = (a, b) =>
  a === b || (a.length > 3 && b.length > 3 && editDistance(a, b) <= (Math.min(a.length, b.length) > 6 ? 2 : 1));

function similarity(query, candidate) {
  const q = tokens(query), c = tokens(candidate);
  if (!q.length || !c.length) return 0;
  const used = new Set();
  let hit = 0;
  for (const t of q) {
    const i = c.findIndex((x, ix) => !used.has(ix) && tokenHit(t, x));
    if (i >= 0) { used.add(i); hit++; }
  }
  const cover = hit / q.length;
  return cover * (0.6 + 0.4 * (hit / c.length));   /* prefer candidates we matched most of */
}

/* best match for a typed name among the draft's dishes */
function findDish(draft, name, { onlyMissingPrice = false } = {}) {
  let best = null, bestScore = 0;
  for (const s of draft.stalls) for (const c of s.categories) for (const i of c.items) {
    if (onlyMissingPrice && i.price != null) continue;
    const score = similarity(name, i.name);
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return bestScore >= 0.6 ? best : null;
}

/* ── apply a batch of typed pairs ─────────────────────────────────────
   Prefer dishes still missing a price — someone typing a list is almost
   always filling in the gaps, not silently repricing what's already set. */
function applyPairs(draft, pairs) {
  const set = [], changed = [], unmatched = [];
  for (const p of pairs) {
    const dish = findDish(draft, p.name, { onlyMissingPrice: true }) || findDish(draft, p.name);
    if (!dish) { unmatched.push(p); continue; }
    const was = dish.price;
    dish.price = p.price;
    (was == null ? set : changed).push({ name: dish.name, price: p.price, was });
  }
  return { set, changed, unmatched };
}

/* ── anything the rules didn't understand ─────────────────────────────
   The model returns an action, never a catalog write. */
const ACTIONS = `You are the assistant inside a Telegram bot that helps a food merchant
build their menu. The merchant just sent a message the bot's rules did not understand.
Decide what they meant and reply with JSON only.

{
  "action": "set_prices" | "add_items" | "remove_items" | "rename" | "set_name" | "set_location" | "answer",
  "prices":   [ { "name": string, "price": number } ],
  "items":    [ { "name": string, "price": number|null, "category": string|null } ],
  "remove":   [ string ],
  "rename":   [ { "from": string, "to": string } ],
  "value":    string,
  "reply":    string
}

Rules:
- Only include the fields your action needs. "reply" is always required: one or two
  short sentences, plain and warm, no emoji, addressed to the merchant.
- "name" fields must be dish names as the merchant wrote them.
- Never invent a price. If they mention a dish with no price, price is null.
- set_name is for the canteen/shop name, set_location for where it is.
- If they are asking a question or chatting, use "answer" and put the answer in "reply".
  Be honest about what the bot can do: read menus from photos, PDFs, spreadsheets,
  voice notes and website links; fix prices; set halal/vegetarian flags; publish.
- NEVER say you have done, noted, saved, updated or changed anything. Code does
  the doing and code writes the confirmation. For every action other than
  "answer", keep "reply" to an empty string.
- The merchant's canteen stays editable after publishing. "Change my storefront
  name to X", "update it on the website", "rename my shop" are all set_name
  with value X — not something you refuse.`;

async function understand(text, draft) {
  if (!KEY) return null;
  const menu = draft ? draft.stalls.flatMap(s => s.categories.flatMap(c =>
    c.items.map(i => `${i.name} — ${i.price == null ? 'no price yet' : '$' + i.price.toFixed(2)}`))).slice(0, 60) : [];

  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: MODEL, temperature: 0, response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: ACTIONS },
        { role: 'user', content:
          (draft ? `Menu so far${draft.name ? ` for "${draft.name}"` : ''}:\n${menu.join('\n') || '(empty)'}\n\n` : 'No menu started yet.\n\n') +
          `Merchant said:\n${String(text).slice(0, 2000)}` }
      ]
    })
  });
  if (!r.ok) throw new Error(`understand ${r.status}`);
  const out = JSON.parse((await r.json()).choices?.[0]?.message?.content || '{}');

  const num = v => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(Number(v).toFixed(2)) : null);
  const str = v => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 80) : null);
  return {
    action: ['set_prices','add_items','remove_items','rename','set_name','set_location','answer'].includes(out.action)
              ? out.action : 'answer',
    prices: (Array.isArray(out.prices) ? out.prices : []).map(p => ({ name: str(p?.name), price: num(p?.price) })).filter(p => p.name && p.price),
    items:  (Array.isArray(out.items)  ? out.items  : []).map(i => ({ name: str(i?.name), price: num(i?.price), category: str(i?.category) })).filter(i => i.name),
    remove: (Array.isArray(out.remove) ? out.remove : []).map(str).filter(Boolean),
    rename: (Array.isArray(out.rename) ? out.rename : []).map(x => ({ from: str(x?.from), to: str(x?.to) })).filter(x => x.from && x.to),
    value:  str(out.value),
    reply:  typeof out.reply === 'string' ? out.reply.trim().slice(0, 600) : ''
  };
}

module.exports = { parsePairs, applyPairs, findDish, similarity, understand };

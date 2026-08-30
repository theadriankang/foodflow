/* A photo of a menu board -> a structured menu.

   The merchant is standing at their stall with a phone. They are not going to
   type a spreadsheet. So this is the real ingest path, and the CSV upload in the
   web console is the fallback, not the other way round. */

const KEY   = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_VISION_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini';

const PROMPT = `You are reading a photo of a food stall or canteen menu, most likely in Singapore.

Transcribe what is ACTUALLY on the board. Do not invent dishes, prices, or categories.

Rules:
- Prices: numbers only, in dollars. "$3.50", "3.50", "350" written as cents on a board -> 3.50.
- If a price is unreadable or missing, use null. Never guess a price.
- Categories: ONLY use headings the menu itself shows (e.g. "NOODLES", "SET MEALS").
  If the board has no headings, return ONE category with "name": null and put every item in it.
  Do not invent a taxonomy that isn't printed.
- Stalls: if the photo clearly covers several stalls, split them. Otherwise one stall.
- If the stall or canteen name is visible on the board, return it. Otherwise null.
- Keep the dish name as written, tidied for capitalisation only.
- List anything you genuinely could not read in "unreadable".

Reply with JSON only:
{
  "canteen": string | null,
  "stall": string | null,
  "categories": [ { "name": string | null, "items": [ { "name": string, "price": number | null } ] } ],
  "unreadable": [string]
}`;

/* The same rules, for a menu that arrived as text rather than a picture —
   a PDF, a spreadsheet, a voice note, or something typed straight into the chat.
   Identical constraints: never invent a dish, never invent a price, never invent
   a category the source didn't print. */
const TEXT_PROMPT = PROMPT.replace(
  'You are reading a photo of a food stall or canteen menu, most likely in Singapore.',
  'You are reading the text of a food stall or canteen menu, most likely in Singapore. ' +
  'It may be messy — extracted from a PDF, a spreadsheet, or transcribed from someone ' +
  'reading it aloud. Ignore page numbers, addresses, opening hours and other non-menu lines.'
);

const readMenuText = text =>
  callModel([{ role: 'user', content: `${TEXT_PROMPT}\n\n--- MENU ---\n${String(text).slice(0, 12000)}` }]);

const readMenuPhoto = imageUrl =>
  callModel([{ role: 'user', content: [
    { type: 'text', text: PROMPT },
    { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } }
  ] }]);

async function callModel(messages) {
  if (!KEY) throw new Error('no OPENAI_API_KEY — reading a menu needs the model');

  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages
    })
  });

  if (!r.ok) {
    const body = await r.text();
    throw new Error(`menu read ${r.status}: ${body.slice(0, 200)}`);
  }
  const data = await r.json();
  const out  = JSON.parse(data.choices?.[0]?.message?.content || '{}');

  /* never trust the shape that comes back */
  const cats = Array.isArray(out.categories) ? out.categories : [];
  return {
    canteen: typeof out.canteen === 'string' ? out.canteen.trim() : null,
    stall:   typeof out.stall   === 'string' ? out.stall.trim()   : null,
    unreadable: Array.isArray(out.unreadable) ? out.unreadable.slice(0, 8) : [],
    categories: cats.map(c => ({
      name: typeof c.name === 'string' && c.name.trim() ? c.name.trim() : null,
      items: (Array.isArray(c.items) ? c.items : [])
        .filter(i => i && typeof i.name === 'string' && i.name.trim())
        .map(i => ({
          name: i.name.trim().slice(0, 80),
          price: Number.isFinite(Number(i.price)) && Number(i.price) > 0 ? Number(Number(i.price).toFixed(2)) : null
        }))
    })).filter(c => c.items.length)
  };
}

module.exports = { readMenuPhoto, readMenuText };

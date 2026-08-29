/* Where menus published from Telegram actually live.

   Vercel's filesystem is read-only at runtime, so api/catalog.json is the seed
   catalog and nothing more. Anything a merchant publishes goes here instead.

   If Upstash/Vercel KV credentials are present we use them and the data is durable.
   If not, we fall back to memory on the running instance — good enough to demo end
   to end, gone on a cold start. The health endpoint says which one is active, so
   nobody has to guess. */

/* Vercel's storage integrations let you choose the env-var prefix, and Upstash,
   Vercel KV and Redis all name things slightly differently. Rather than make the
   deployer match our spelling, find whatever REST credentials are present. */
function discoverKV() {
  const e = process.env;
  const known = [
    ['KV_REST_API_URL', 'KV_REST_API_TOKEN'],
    ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'],
    ['STORAGE_REST_API_URL', 'STORAGE_REST_API_TOKEN'],
    ['REDIS_REST_API_URL', 'REDIS_REST_API_TOKEN']
  ];
  for (const [u, t] of known) if (e[u] && e[t]) return { url: e[u], token: e[t], via: u };

  for (const key of Object.keys(e)) {
    const m = key.match(/^(.*)_REST_API_URL$/) || key.match(/^(.*)_REST_URL$/);
    if (!m || !/^https?:\/\//.test(e[key] || '')) continue;
    const token = e[`${m[1]}_REST_API_TOKEN`] || e[`${m[1]}_REST_TOKEN`];
    if (token) return { url: e[key], token, via: key };
  }
  return null;
}

const found   = discoverKV();
const URL_    = found?.url;
const TOKEN   = found?.token;
const durable = Boolean(URL_ && TOKEN);
const via     = found?.via || null;

const mem = new Map();

async function kv(cmd) {
  const r = await fetch(URL_, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd)
  });
  if (!r.ok) throw new Error(`kv ${r.status}`);
  return (await r.json()).result;
}

async function get(key) {
  if (!durable) return mem.get(key) ?? null;
  try { const v = await kv(['GET', key]); return v ? JSON.parse(v) : null; }
  catch (e) { console.error('[store] get fell back to memory:', e.message); return mem.get(key) ?? null; }
}

async function set(key, value) {
  mem.set(key, value);
  if (!durable) return;
  try { await kv(['SET', key, JSON.stringify(value)]); }
  catch (e) { console.error('[store] set fell back to memory:', e.message); }
}

/* Canteens published by merchants, newest last. */
const PUB = 'foodflow:published';
const getPublished = async () => (await get(PUB)) || [];
async function publish(court) {
  const all = await getPublished();
  const next = all.filter(c => c.id !== court.id).concat([court]);
  await set(PUB, next);
  return next.length;
}

/* One in-progress Telegram conversation per chat. */
const draftKey = id => `foodflow:draft:${id}`;
const getDraft = id => get(draftKey(id));
const setDraft = (id, d) => set(draftKey(id), d);
const clearDraft = id => set(draftKey(id), null);

module.exports = { durable, via, get, set, getPublished, publish, getDraft, setDraft, clearDraft };

/* POST /api/telegram — Telegram webhook.

   The whole merchant onboarding, in a chat the merchant already has open:
     photo of the menu board -> the agent reads it -> a tree they can check
     -> one tap to publish -> it is live in the storefront and the food agent
        can recommend from it immediately.

   No app to install, no spreadsheet, no website required. */

const store  = require('./_store.js');
const vision = require('./_menuvision.js');
const base   = require('./catalog.json');

const TOKEN  = process.env.TELEGRAM_BOT_TOKEN;
const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
const API    = m => `https://api.telegram.org/bot${TOKEN}/${m}`;

/* ── talking to Telegram ─────────────────────────────────────────────── */
async function tg(method, body) {
  const r = await fetch(API(method), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  const j = await r.json();
  if (!j.ok) console.error('[tg]', method, j.description);
  return j.result;
}
const say = (chat, text, extra = {}) =>
  tg('sendMessage', { chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra });

const keyboard = rows => ({ reply_markup: { inline_keyboard: rows } });

async function photoAsDataUrl(fileId) {
  const f = await tg('getFile', { file_id: fileId });
  if (!f?.file_path) throw new Error('could not fetch the photo');
  const r = await fetch(`https://api.telegram.org/file/bot${TOKEN}/${f.file_path}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const ext = (f.file_path.split('.').pop() || 'jpg').toLowerCase();
  const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

/* ── the tree the merchant checks ─────────────────────────────────────
   Shallow on purpose. Telegram is a narrow column on a phone; a four-level
   ASCII tree is unreadable there. Stall, then category only if the board
   actually had one, then the dishes. */
const money = n => (n == null ? '—' : '$' + Number(n).toFixed(2));

function renderTree(d) {
  const L = [];
  L.push(`🏫 <b>${esc(d.name || 'Your canteen')}</b>`);
  if (d.loc || d.walk) L.push(`<i>${esc([d.loc, d.walk ? d.walk + ' min walk' : ''].filter(Boolean).join(' · '))}</i>`);
  L.push('');

  for (const s of d.stalls) {
    L.push(`🏪 <b>${esc(s.name)}</b>`);
    for (const c of s.categories) {
      if (c.name) L.push(`   <b>${esc(c.name)}</b>`);
      for (const i of c.items) {
        const flag = i.price == null ? '  ⚠️ no price' : '';
        L.push(`   • ${esc(i.name)} — ${money(i.price)}${flag}`);
      }
    }
    L.push('');
  }

  const items = countItems(d);
  const noPrice = allItems(d).filter(i => i.price == null).length;
  L.push(`${d.stalls.length} stall${d.stalls.length > 1 ? 's' : ''} · ${items} dish${items === 1 ? '' : 'es'}` +
         (noPrice ? ` · <b>${noPrice} missing a price</b>` : ''));
  if (noPrice) L.push(`<i>Send me the missing prices as “dish name 4.50”, or publish and fix them later.</i>`);
  return L.join('\n');
}
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const allItems = d => d.stalls.flatMap(s => s.categories.flatMap(c => c.items));
const countItems = d => allItems(d).length;

/* ── make a photographed dish searchable ──────────────────────────────
   The customer agent scores on attributes, so a published dish needs them.
   Guessed from the name, anchored to comparable dishes already on FoodFlow,
   and every nutrition figure is flagged as an estimate. */
const baseDishes = base.flatMap(c => c.stalls.flatMap(s => s.cats.flatMap(k => k.items)));

function enrich(name, price) {
  const n = name.toLowerCase();
  const has = [];
  const test = (re, tag) => { if (re.test(n)) has.push(tag); };
  test(/chicken|ayam|katsu|karaage/, 'chicken');
  test(/pork|char siew|bak|luncheon|bacon/, 'pork');
  test(/beef|gyu|rendang/, 'beef');
  test(/fish|salmon|ikan|mentaiko|anchov/, 'fish');
  test(/prawn|shrimp|seafood|sotong|squid/, 'shellfish');
  test(/egg|tama|omelet/, 'egg');
  test(/noodle|mee|pasta|udon|ramen|bread|prata|bun|toast|bao/, 'gluten');
  test(/milk|cheese|cream|butter|latte|lassi/, 'dairy');
  test(/nut|peanut|kacang/, 'nuts');
  test(/tofu|tau|soy|miso/, 'soy');
  /* Deliberately asymmetric.
     "contains" is inferred generously: a false positive only hides the dish from
     someone who was avoiding that ingredient, which is the safe direction to be wrong in.
     "dietary" is left EMPTY. Halal is a certification, not something you can read off a
     photo, and calling a dish vegetarian when it isn't puts food in front of someone who
     didn't want it. Those flags are the merchant's to set, never the model's to guess. */

  const form = /noodle|mee|bee hoon|pasta|udon|ramen|hor fun|kway/.test(n) ? 'noodles'
             : /prata|bread|toast|wrap|pita|sandwich|bun|roti/.test(n)      ? 'bread'
             : /juice|latte|tea|coffee|kopi|lassi|drink|smoothie/.test(n)   ? 'drink' : 'rice';
  const tex = /soup|broth|bak kut|tang|laksa/.test(n) ? ['soupy']
            : /fried|crisp|katsu|karaage|goreng/.test(n) ? ['crispy'] : ['tender'];
  const heavy = /fried|katsu|curry|creamy|luncheon|cheese/.test(n) ? 4
              : /salad|soup|juice|tea|fruit/.test(n) ? 2 : 3;
  const spicy = /spicy|mala|sambal|chilli|tom yum|penyet|curry|kimchi/.test(n) ? 2 : 0;

  /* anchor the estimate to similar dishes we already carry */
  const peers = baseDishes.filter(d => d.form === form && Math.abs(d.heavy - heavy) <= 1);
  const pool  = peers.length >= 3 ? peers : baseDishes.filter(d => d.form === form);
  const mid = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] || 0; };
  let pro = mid(pool.map(d => d.pro)) || 20, kcal = mid(pool.map(d => d.kcal)) || 500;
  if (/chicken|beef|pork|fish|prawn|egg|tofu|paneer/.test(n)) pro = Math.round(pro * 1.15);
  if (/salad|juice|tea|fruit|veg/.test(n)) { pro = Math.round(pro * 0.4); kcal = Math.round(kcal * 0.6); }
  if (/fried|crisp|creamy|butter|katsu/.test(n)) kcal = Math.round(kcal * 1.2);

  return {
    desc: 'From the stall menu.', cuisine: 'Local', form, tex, temp: form === 'drink' ? 'cold' : 'hot',
    heavy, fl: { savoury: 2, sweet: 0, salty: 2, spicy, sour: 0 },
    diet: [], has, ing: [], pro, kcal, nutEst: true, dietUnset: true,
    prep: form === 'drink' ? 4 : 9, icon: '🍽️',
    tint: '#f0ece2', tintD: '#2b271c'
  };
}

async function publishDraft(d) {
  const id = 'tg' + Date.now().toString(36);
  let uid = 0;
  const court = {
    id, name: d.name || 'New canteen', loc: d.loc || 'Added from Telegram',
    walk: d.walk || 10, live: true, viaTelegram: true,
    stalls: d.stalls.map(s => ({
      name: s.name, cuisine: 'Mixed',
      cats: s.categories.map(c => ({
        name: c.name || 'Menu',
        items: c.items.filter(i => i.price != null).map(i => ({
          id: `${id}-${++uid}`, name: i.name, price: i.price,
          court: id, courtName: d.name, walk: d.walk || 10, stall: s.name,
          cat: c.name || 'Menu', ...enrich(i.name, i.price)
        }))
      })).filter(c => c.items.length)
    })).filter(s => s.cats.length)
  };
  await store.publish(court);
  const n = court.stalls.reduce((a, s) => a + s.cats.reduce((b, k) => b + k.items.length, 0), 0);
  return { court, n };
}

const ASK_PHOTO =
  'Send me a <b>photo of your menu board</b> and I\'ll type it up for you.\n\n' +
  'Snap it straight on if you can. Several photos are fine — send them one at a time.';

/* ── the conversation ─────────────────────────────────────────────────── */
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(200).json({ ok: true, bot: Boolean(TOKEN) });
  if (!TOKEN) return res.status(200).json({ ok: false, reason: 'TELEGRAM_BOT_TOKEN not set' });
  if (SECRET && req.headers['x-telegram-bot-api-secret-token'] !== SECRET)
    return res.status(401).json({ ok: false });

  const u = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  res.status(200).json({ ok: true });          /* ack first — Telegram retries slow replies */

  try { await handle(u); }
  catch (e) { console.error('[telegram]', e); }
};

async function handle(u) {
  /* button taps */
  if (u.callback_query) {
    const q = u.callback_query, chat = q.message.chat.id;
    await tg('answerCallbackQuery', { callback_query_id: q.id });
    const d = (await store.getDraft(chat)) || null;

    if (q.data === 'more') return say(chat, 'Send the next photo.');
    if (q.data === 'restart') { await store.clearDraft(chat); return say(chat, ASK_PHOTO); }
    if (q.data === 'publish') {
      if (!d || !d.stalls?.length) return say(chat, 'Nothing to publish yet — send me a photo first.');
      const { court, n } = await publishDraft(d);
      await store.clearDraft(chat);
      return say(chat,
        `✅ <b>${esc(court.name)}</b> is live.\n\n` +
        `${court.stalls.length} stall${court.stalls.length > 1 ? 's' : ''}, ${n} dish${n === 1 ? '' : 'es'}. ` +
        `Customers can order from it now, and the food agent can recommend it.\n\n` +
        `ℹ️ I did <b>not</b> guess halal or vegetarian — those are yours to confirm, so nobody is told something wrong about their food. Reply <code>/diet</code> when you want to set them.\n\n` +
        (store.durable ? '' : '<i>Note: this deployment has no database configured, so it lives on the running server only.</i>\n\n') +
        'Send another photo any time to add more.');
    }
    return;
  }

  const m = u.message || u.edited_message;
  if (!m) return;
  const chat = m.chat.id;
  const text = (m.text || '').trim();

  if (/^\/(start|help)/.test(text)) {
    await store.clearDraft(chat);
    return say(chat,
      '👋 I put your stall on <b>FoodFlow</b>, so customers can find and pay for your food by just asking for it.\n\n' +
      'No website needed. No forms.\n\n' + ASK_PHOTO);
  }
  if (/^\/(new|reset)/.test(text)) { await store.clearDraft(chat); return say(chat, ASK_PHOTO); }

  let draft = await store.getDraft(chat);

  /* photo — the main path */
  const photo = m.photo ? m.photo[m.photo.length - 1]
              : (m.document && /^image\//.test(m.document.mime_type || '') ? m.document : null);

  if (photo) {
    await tg('sendChatAction', { chat_id: chat, action: 'typing' });
    await say(chat, '📸 Reading your menu…');
    let read;
    try { read = await vision.readMenuPhoto(await photoAsDataUrl(photo.file_id)); }
    catch (e) {
      console.error('[vision]', e.message);
      return say(chat, '😕 I couldn\'t read that one. Try a straighter, brighter shot — or send the menu as text and I\'ll take it that way.');
    }
    if (!read.categories.length)
      return say(chat, 'I couldn\'t find any dishes on that. If the board is long, photograph it in two halves and send them one at a time.');

    draft = draft || { name: null, loc: null, walk: 10, stalls: [], awaiting: null };
    if (!draft.name && read.canteen) draft.name = read.canteen;

    const stallName = read.stall || draft.stalls[0]?.name || 'Main stall';
    let stall = draft.stalls.find(s => s.name.toLowerCase() === stallName.toLowerCase());
    if (!stall) { stall = { name: stallName, categories: [] }; draft.stalls.push(stall); }
    for (const c of read.categories) {
      const existing = stall.categories.find(x => (x.name || '') === (c.name || ''));
      if (existing) existing.items.push(...c.items);
      else stall.categories.push(c);
    }

    if (read.unreadable.length)
      await say(chat, `I couldn't make out: <i>${esc(read.unreadable.join(', '))}</i>`);

    if (!draft.name) {
      draft.awaiting = 'name';
      await store.setDraft(chat, draft);
      return say(chat, renderTree({ ...draft, name: 'Your canteen' }) +
        '\n\n<b>What\'s this canteen or coffee shop called?</b>');
    }
    draft.awaiting = null;
    await store.setDraft(chat, draft);
    return review(chat, draft);
  }

  /* answering the name question */
  if (draft?.awaiting === 'name' && text) {
    draft.name = text.slice(0, 60); draft.awaiting = 'loc';
    await store.setDraft(chat, draft);
    return say(chat, 'Got it. <b>Where is it?</b> (e.g. “Frontier, Science”) — or send <b>skip</b>.');
  }
  if (draft?.awaiting === 'loc' && text) {
    if (!/^skip$/i.test(text)) draft.loc = text.slice(0, 60);
    draft.awaiting = null;
    await store.setDraft(chat, draft);
    return review(chat, draft);
  }

  /* "dish name 4.50" fills in a missing price */
  const priceFix = text.match(/^(.+?)\s+\$?(\d+(?:\.\d{1,2})?)$/);
  if (draft && priceFix) {
    const want = priceFix[1].trim().toLowerCase(), val = Number(priceFix[2]);
    let hit = null;
    for (const s of draft.stalls) for (const c of s.categories) for (const i of c.items)
      if (i.name.toLowerCase().includes(want) || want.includes(i.name.toLowerCase())) hit = i;
    if (hit) {
      hit.price = val; await store.setDraft(chat, draft);
      await say(chat, `Set <b>${esc(hit.name)}</b> to ${money(val)}.`);
      return review(chat, draft);
    }
  }

  /* menu pasted as text still works */
  if (draft === null && text.length > 30 && /\d/.test(text)) {
    const items = text.split(/\n+/).map(l => {
      const mm = l.match(/^(.+?)[\s.\-–]*\$?(\d+(?:\.\d{1,2})?)\s*$/);
      return mm ? { name: mm[1].trim(), price: Number(mm[2]) } : null;
    }).filter(Boolean);
    if (items.length >= 2) {
      draft = { name: null, loc: null, walk: 10, awaiting: 'name',
                stalls: [{ name: 'Main stall', categories: [{ name: null, items }] }] };
      await store.setDraft(chat, draft);
      return say(chat, renderTree({ ...draft, name: 'Your canteen' }) +
        '\n\n<b>What\'s this canteen or coffee shop called?</b>');
    }
  }

  return say(chat, ASK_PHOTO);
}

function review(chat, d) {
  return say(chat, renderTree(d) + '\n\n<b>Look right?</b> Fix anything by telling me, then publish.',
    keyboard([
      [{ text: '✅ Publish it', callback_data: 'publish' }],
      [{ text: '📸 Add another photo', callback_data: 'more' },
       { text: '↩️ Start over', callback_data: 'restart' }]
    ]));
}

module.exports.renderTree = renderTree;
module.exports.enrich = enrich;

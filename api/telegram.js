/* POST /api/telegram — Telegram webhook.

   The whole merchant onboarding, in a chat the merchant already has open:
     photo of the menu board -> the agent reads it -> a tree they can check
     -> one tap to publish -> it is live in the storefront and the food agent
        can recommend from it immediately.

   No app to install, no spreadsheet, no website required. */

const store  = require('./_store.js');
const vision = require('./_menuvision.js');
const intake = require('./_intake.js');
const base   = require('./catalog.json');

const TOKEN  = process.env.TELEGRAM_BOT_TOKEN;
const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
const API    = m => `https://api.telegram.org/bot${TOKEN}/${m}`;

/* ── talking to Telegram ─────────────────────────────────────────────── */
async function tg(method, body) {
  /* Telegram can answer with plain text (rate limits, bad token, proxies), so never
     assume JSON — a parse error here used to take the whole handler down with it. */
  try {
    const r = await fetch(API(method), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const text = await r.text();
    let j;
    try { j = JSON.parse(text); }
    catch { console.error('[tg]', method, r.status, text.slice(0, 160)); return null; }
    if (!j.ok) console.error('[tg]', method, j.description);
    return j.result ?? null;
  } catch (e) {
    console.error('[tg]', method, e.message);
    return null;
  }
}
const say = (chat, text, extra = {}) =>
  tg('sendMessage', { chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra });

const keyboard = rows => ({ reply_markup: { inline_keyboard: rows } });

/* Where the storefront lives, so the bot can hand the merchant a link they can tap. */
const SITE = (process.env.PUBLIC_BASE_URL || 'https://lifehacks-foodflow.vercel.app').replace(/\/$/, '');

/* Telegram's native ☰ menu, next to the input box. A merchant should never have to
   remember a command — registered once by hitting GET /api/telegram?setup=1. */
const COMMANDS = [
  { command: 'start', description: 'What this bot does' },
  { command: 'menu',  description: 'Show what I have so far' },
  { command: 'diet',  description: 'Set halal / vegetarian flags' },
  { command: 'new',   description: 'Start over from scratch' },
  { command: 'help',  description: 'How to send a menu' }
];

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
  if (noPrice) L.push(`<i>Tap “Add the missing price${noPrice > 1 ? 's' : ''}” below, or publish now and fix them later.</i>`);
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

const HOW_IT_WORKS =
  '<b>How this works</b>\n\n' +
  '1. You send a photo of your menu board.\n' +
  '2. I read it and show you a list to check.\n' +
  '3. You fix anything that\'s wrong by tapping or typing.\n' +
  '4. You publish — and customers can order it straight away.\n\n' +
  'I won\'t guess prices, and I won\'t guess halal or vegetarian. Those are yours to confirm.\n\n' +
  'A photo works, so does a PDF, a spreadsheet, a voice note, or a link to your website.';

const PASTE_HELP =
  'No problem — type or paste your menu, one dish per line, with the price at the end:\n\n' +
  '<code>Wanton Mee 4.00\nDumpling Soup 4.50\nTeh Tarik 1.60</code>';

const LINK_HELP =
  'Send me the link and I\'ll read it — the menu page itself if you have one:\n\n' +
  '<code>https://yourshop.com/menu</code>\n\n' +
  'A PDF menu link works too. If the page draws its menu as a picture I\'ll tell you, and a screenshot will do.';

const ASK_PHOTO =
  'Send me a <b>photo of your menu board</b> and I\'ll type it up for you.\n\n' +
  'Snap it straight on if you can. Several photos are fine — send them one at a time.';

/* ── the conversation ─────────────────────────────────────────────────── */
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    /* One-time setup: registers the ☰ command menu with Telegram. Safe to re-run. */
    if (/[?&]setup=1(&|$)/.test(req.url || '') && TOKEN) {
      const done = await tg('setMyCommands', { commands: COMMANDS });
      return res.status(200).json({ ok: true, commandsRegistered: done === true,
        commands: COMMANDS.map(c => '/' + c.command) });
    }
    return res.status(200).json({ ok: true, bot: Boolean(TOKEN) });
  }
  if (!TOKEN) return res.status(200).json({ ok: false, reason: 'TELEGRAM_BOT_TOKEN not set' });
  if (SECRET && req.headers['x-telegram-bot-api-secret-token'] !== SECRET)
    return res.status(401).json({ ok: false });

  const u = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

  /* Do the work BEFORE responding. On Vercel the invocation ends the moment the
     response is sent, so anything awaited after res.json() is simply never run.
     Telegram allows 60s for a webhook reply, which is plenty for one vision call. */
  try {
    await handle(u);
  } catch (e) {
    console.error('[telegram]', e);
    const chat = u.message?.chat?.id || u.callback_query?.message?.chat?.id;
    if (chat) {
      try { await say(chat, `⚠️ Something went wrong on my side:\n<code>${esc(e.message)}</code>\n\nTry again, or send /new to start over.`); }
      catch (_) { /* nothing more we can do */ }
    }
  }
  return res.status(200).json({ ok: true });
};

async function handle(u) {
  /* button taps */
  if (u.callback_query) {
    const q = u.callback_query, chat = q.message.chat.id;
    await tg('answerCallbackQuery', { callback_query_id: q.id });
    const d = (await store.getDraft(chat)) || null;

    if (q.data === 'more') return say(chat, 'Send the next photo.');
    if (q.data === 'restart') { await store.clearDraft(chat); return say(chat, ASK_PHOTO); }
    if (q.data === 'back')    return d ? review(chat, d) : say(chat, ASK_PHOTO);
    if (q.data === 'howto')   return say(chat, HOW_IT_WORKS);
    if (q.data === 'astext')  return say(chat, PASTE_HELP);
    if (q.data === 'aslink')  return say(chat, LINK_HELP);

    if (q.data === 'skiploc') {
      if (!d) return say(chat, ASK_PHOTO);
      d.awaiting = null; await store.setDraft(chat, d);
      return review(chat, d);
    }
    if (q.data === 'fixprices') return d ? priceList(chat, d) : say(chat, ASK_PHOTO);
    if (q.data === 'moreimgs') {
      if (!d?.moreImages?.length) return say(chat, 'Nothing left to read from that page.');
      const batch = d.moreImages.slice(0, 5);
      await say(chat, `📸 Reading ${batch.length} more…`);
      await tg('sendChatAction', { chat_id: chat, action: 'typing' });
      const imgs = await intake.grabImages(batch, 5);
      d.moreImages = d.moreImages.slice(batch.length);
      if (!imgs.length) { await store.setDraft(chat, d); return say(chat, 'I couldn\'t open those ones. Send a photo of that part of the menu instead.'); }
      let extra;
      try { extra = await readSource({ images: imgs, text: '' }); }
      catch { await store.setDraft(chat, d); return say(chat, 'I couldn\'t make a menu out of those.'); }
      const before = allItems(d).length;
      mergeInto(d, extra);
      await store.setDraft(chat, d);
      const added = allItems(d).length - before;
      await say(chat, added ? `Added ${added} more dish${added === 1 ? '' : 'es'}.` : 'Nothing new on those — they were probably the same board.');
      return review(chat, d);
    }
    if (q.data.startsWith('p:')) {
      if (!d) return say(chat, ASK_PHOTO);
      const [, si, ci, ii] = q.data.split(':').map(Number);
      const item = d.stalls[si]?.categories[ci]?.items[ii];
      if (!item) return priceList(chat, d);
      d.awaiting = 'price'; d.priceAt = [si, ci, ii];
      await store.setDraft(chat, d);
      return say(chat, `How much is <b>${esc(item.name)}</b>? Just send the number — e.g. <code>1.60</code>`);
    }

    if (q.data === 'diet')     return dietList(chat);
    if (q.data === 'dietdone') return say(chat, '👍 Saved. Customers see those flags straight away, and the food agent filters on them.');
    if (q.data.startsWith('df:')) return dietDish(chat, q.data.slice(3));
    if (q.data.startsWith('ds:')) {
      const [, id, flag] = q.data.split(':');
      return dietToggle(chat, id, flag);
    }

    if (q.data === 'publish') {
      if (!d || !d.stalls?.length) return say(chat, 'Nothing to publish yet — send me a photo first.');
      const { court, n } = await publishDraft(d);
      await store.clearDraft(chat);
      await store.set('foodflow:lastcourt:' + chat, court.id);   /* so /diet knows what to edit */
      return say(chat,
        `✅ <b>${esc(court.name)}</b> is live.\n\n` +
        `${court.stalls.length} stall${court.stalls.length > 1 ? 's' : ''}, ${n} dish${n === 1 ? '' : 'es'}. ` +
        `Customers can order from it now, and the food agent can recommend it.\n\n` +
        `ℹ️ I did <b>not</b> guess halal or vegetarian — those are yours to confirm, so nobody is told something wrong about their food. Reply <code>/diet</code> when you want to set them.\n\n` +
        (store.durable ? '' : '<i>Note: this deployment has no database configured, so it lives on the running server only.</i>\n\n') +
        'Send another photo any time to add more.',
        keyboard([
          [{ text: '🥗 Set halal / vegetarian flags', callback_data: 'diet' }],
          [{ text: '📸 Add another stall', callback_data: 'more' }],
          [{ text: '🔗 See it in the storefront', url: SITE }]
        ]));
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
      'No website needed. No forms.\n\n' + ASK_PHOTO,
      keyboard([
        [{ text: '🔗 My menu is on a website', callback_data: 'aslink' }],
        [{ text: '✍️ I\'d rather type it out',  callback_data: 'astext' }],
        [{ text: '❓ How does this work?',       callback_data: 'howto' }]
      ]));
  }
  if (/^\/(new|reset)/.test(text)) { await store.clearDraft(chat); return say(chat, ASK_PHOTO); }
  if (/^\/diet/.test(text)) return dietList(chat);
  if (/^\/menu/.test(text)) {
    const dnow = await store.getDraft(chat);
    if (dnow?.stalls?.length) return review(chat, dnow);
    const c = await courtForChat(chat);
    if (c) return say(chat, `✅ <b>${esc(c.name)}</b> is published and live.`,
      keyboard([[{ text: '🥗 Set halal / vegetarian flags', callback_data: 'diet' }],
                [{ text: '📸 Add another stall', callback_data: 'more' }],
                [{ text: '🔗 See it in the storefront', url: SITE }]]));
    return say(chat, 'Nothing yet.\n\n' + ASK_PHOTO);
  }

  let draft = await store.getDraft(chat);

  /* attachments — photo, PDF, spreadsheet, voice note, video cover frame.
     The merchant sends whatever they have; _intake normalises it to images or text. */
  let got = null;
  try { got = await intake.intake(m); }
  catch (e) {
    console.error('[intake]', e.message);
    return say(chat, '😕 I couldn\'t open that file. A photo of the menu works best.');
  }

  if (got) {
    /* nothing readable in it — say why, don't fail silently */
    if (!got.images.length && !got.text) return say(chat, got.note || ASK_PHOTO);

    await tg('sendChatAction', { chat_id: chat, action: 'typing' });
    await say(chat, got.note || '📸 Reading your menu…');

    let read;
    try { read = await readSource(got); }
    catch (e) {
      console.error('[read]', e.message);
      return say(chat, '😕 I couldn\'t read that one. Try a straighter, brighter shot — or send the menu as text and I\'ll take it that way.');
    }
    if (!read.categories.length)
      return say(chat, 'I couldn\'t find any dishes in that. If the board is long, photograph it in two halves and send them one at a time.');

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

  /* a pin from the Share-my-location button */
  if (m.location && draft) {
    const { latitude: la, longitude: lo } = m.location;
    draft.loc = (await placeName(la, lo)) || `${la.toFixed(4)}, ${lo.toFixed(4)}`;
    draft.awaiting = null;
    await store.setDraft(chat, draft);
    await say(chat, `📍 Got it — <b>${esc(draft.loc)}</b>.`, dropKeyboard);
    return review(chat, draft);
  }

  /* questions are not answers */
  if (text && draft && isQuestion(text) && draft.awaiting !== 'price')
    return answerAside(chat, draft, text);

  /* answering the name question */
  if (draft?.awaiting === 'name' && text) {
    draft.name = text.slice(0, 60); draft.awaiting = 'loc';
    await store.setDraft(chat, draft);
    return say(chat, 'Got it. <b>Where is it?</b>\n\nTap 📍 below to drop a pin, or just type it (e.g. “Frontier, Science”).', locKeyboard());
  }
  if (draft?.awaiting === 'loc' && text) {
    if (!/^(⏭\s*)?skip( this)?$/i.test(text.trim())) draft.loc = text.slice(0, 60);
    draft.awaiting = null;
    await store.setDraft(chat, draft);
    await say(chat, draft.loc ? `📍 <b>${esc(draft.loc)}</b>.` : 'Skipped.', dropKeyboard);
    return review(chat, draft);
  }

  /* they tapped a dish on the price list, so a bare number is enough */
  if (draft?.awaiting === 'price' && text) {
    const num = text.match(/^\$?(\d+(?:[.,]\d{1,2})?)$/);
    const [si, ci, ii] = draft.priceAt || [];
    const item = draft.stalls?.[si]?.categories?.[ci]?.items?.[ii];
    if (num && item) {
      item.price = Number(num[1].replace(',', '.'));
      draft.awaiting = null; draft.priceAt = null;
      await store.setDraft(chat, draft);
      await say(chat, `Set <b>${esc(item.name)}</b> to ${money(item.price)}.`);
      return allItems(draft).some(i => i.price == null) ? priceList(chat, draft) : review(chat, draft);
    }
    if (!num) return say(chat, 'Just the number, please — like <code>1.60</code>.');
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

  /* a link to a menu the merchant already publishes */
  const link = intake.findUrl(text);
  if (link) {
    await tg('sendChatAction', { chat_id: chat, action: 'typing' });
    await say(chat, '🔗 Opening that…');
    let got2;
    try { got2 = await intake.fromUrl(link); }
    catch (e) { console.error('[url]', e.message); got2 = { text: '', note: 'I couldn\'t open that link.' }; }
    if (!got2.text && !got2.images?.length) return say(chat, got2.note);

    await say(chat, got2.note);
    await tg('sendChatAction', { chat_id: chat, action: 'typing' });
    let read2;
    try { read2 = await readSource(got2); }
    catch (e) { console.error('[read]', e.message); return say(chat, '😕 I found the page but couldn\'t make a menu out of it. A screenshot works too.'); }
    if (!read2.categories.length)
      return say(chat, 'I opened it but couldn\'t find dishes and prices there. If the menu is on a different page, send me that link — or just send a screenshot.');

    draft = draft || { name: null, loc: null, walk: 10, stalls: [], awaiting: null };
    if (got2.rest?.length) draft.moreImages = got2.rest;      /* so "what about drinks?" has an answer */
    if (!draft.name && read2.canteen) draft.name = read2.canteen;
    mergeInto(draft, read2);
    if (!draft.name) {
      draft.awaiting = 'name';
      await store.setDraft(chat, draft);
      return say(chat, renderTree({ ...draft, name: 'Your canteen' }) + '\n\n<b>What\'s this canteen or coffee shop called?</b>');
    }
    draft.awaiting = null;
    await store.setDraft(chat, draft);
    return review(chat, draft);
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

/* A source can be several images (a carousel of menu boards), or text, or both.
   Read them together in parallel and merge into one menu — a merchant sent one
   menu, not three, so they should see one tree. */
async function readSource(got) {
  const jobs = (got.images || []).slice(0, 3).map(i => vision.readMenuPhoto(i));
  if (got.text) jobs.push(vision.readMenuText(got.text));
  const reads = (await Promise.all(jobs.map(p => p.catch(e => { console.error('[read]', e.message); return null; }))))
                  .filter(Boolean);
  if (!reads.length) throw new Error('nothing could be read');

  const merged = { canteen: null, stall: null, categories: [], unreadable: [] };
  for (const r of reads) {
    merged.canteen = merged.canteen || r.canteen;
    merged.stall   = merged.stall   || r.stall;
    merged.unreadable.push(...r.unreadable);
    for (const c of r.categories) {
      const ex = merged.categories.find(x => (x.name || '') === (c.name || ''));
      if (ex) {
        for (const it of c.items)                      /* the same board photographed twice */
          if (!ex.items.some(y => y.name.toLowerCase() === it.name.toLowerCase())) ex.items.push(it);
      } else merged.categories.push({ name: c.name, items: [...c.items] });
    }
  }
  merged.unreadable = [...new Set(merged.unreadable)].slice(0, 8);
  return merged;
}

/* A merchant mid-flow will ask things — "what about my drinks?" — and the
   old code stored that as the canteen's name. A question is never an answer:
   deal with it, then ask again. */
const QUESTION = /\?\s*$|^(what|whats|what's|why|how|can|could|would|do|does|did|is|are|was|where|when|who|which|should|any|anything|got|have|hv|u |you )/i;
const isQuestion = t => QUESTION.test(String(t).trim());

const PENDING = {
  name:  '<b>What\'s this canteen or coffee shop called?</b>',
  loc:   '<b>Where is it?</b>',
  price: 'Send me the price as a number — like <code>1.60</code>.'
};

async function answerAside(chat, d, text) {
  const t = text.toLowerCase();
  const more = d?.moreImages?.length || 0;

  if (/drink|beverage|dessert|side|add on|addon|more|rest|other|missing|all of|everything|didn|not there|left out|incomplete/i.test(t)) {
    if (more) {
      await say(chat, `There ${more === 1 ? 'was 1 more picture' : `were ${more} more pictures`} on that page that I haven\'t read yet — that\'s probably where the rest is.`,
        keyboard([[{ text: `📸 Read the other ${more}`, callback_data: 'moreimgs' }]]));
    } else {
      await say(chat,
        'I only read what was on the pictures I could see. If the drinks or the rest of the menu are on another page or another board, ' +
        'send me that link or a photo of it and I\'ll add it to this same canteen.');
    }
  } else if (/how|what can|help|work/i.test(t)) {
    await say(chat, HOW_IT_WORKS);
  } else {
    await say(chat, 'I can read menus — photos, PDFs, spreadsheets, a voice note, or a link to your site. Anything else I probably can\'t help with.');
  }

  if (d?.awaiting && PENDING[d.awaiting]) {
    const extra = d.awaiting === 'loc' ? locKeyboard() : {};
    return say(chat, PENDING[d.awaiting], extra);
  }
  return d ? review(chat, d) : say(chat, ASK_PHOTO);
}

/* ── location, without making anyone type an address ──────────────────
   Telegram can hand us a real pin. Reverse-geocoded so the merchant sees a
   street rather than two decimals they can't check. */
const locKeyboard = () => ({ reply_markup: {
  keyboard: [[{ text: '📍 Share my location', request_location: true }], [{ text: '⏭ Skip' }]],
  resize_keyboard: true, one_time_keyboard: true } });
const dropKeyboard = { reply_markup: { remove_keyboard: true } };

async function placeName(lat, lon) {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&lat=${lat}&lon=${lon}`,
      { headers: { 'User-Agent': 'FoodFlowBot/1.0 (menu onboarding)' } });
    if (!r.ok) return null;
    const a = (await r.json()).address || {};
    return [a.amenity || a.building || a.road, a.suburb || a.neighbourhood || a.city_district, a.postcode]
      .filter(Boolean).join(', ').slice(0, 60) || null;
  } catch { return null; }
}

/* fold a freshly-read menu into the draft the merchant is building */
function mergeInto(d, read) {
  const sName = read.stall || d.stalls[0]?.name || 'Main stall';
  let st = d.stalls.find(x => x.name.toLowerCase() === sName.toLowerCase());
  if (!st) { st = { name: sName, categories: [] }; d.stalls.push(st); }
  for (const c of read.categories) {
    const ex = st.categories.find(x => (x.name || '') === (c.name || ''));
    if (ex) {
      for (const it of c.items)
        if (!ex.items.some(y => y.name.toLowerCase() === it.name.toLowerCase())) ex.items.push(it);
    } else st.categories.push({ name: c.name, items: [...c.items] });
  }
  return d;
}

function review(chat, d) {
  const missing = allItems(d).filter(i => i.price == null).length;
  const rows = [];
  if (missing) rows.push([{ text: `💲 Add the ${missing} missing price${missing > 1 ? 's' : ''}`, callback_data: 'fixprices' }]);
  rows.push([{ text: '✅ Publish it', callback_data: 'publish' }]);
  rows.push([{ text: '📸 Add another photo', callback_data: 'more' },
             { text: '↩️ Start over', callback_data: 'restart' }]);
  return say(chat, renderTree(d) + '\n\n<b>Look right?</b> Tap below, or just tell me what to fix.',
    keyboard(rows));
}

/* ── missing prices, without making anyone learn a syntax ───────────────
   Tapping a dish sets it as the thing we're waiting on, so the merchant
   types "1.60" and nothing else. Typing "teh tarik 1.60" still works. */
function priceList(chat, d) {
  const rows = [];
  d.stalls.forEach((s, si) => s.categories.forEach((c, ci) => c.items.forEach((i, ii) => {
    if (i.price == null && rows.length < 20)
      rows.push([{ text: `💲 ${i.name}`.slice(0, 60), callback_data: `p:${si}:${ci}:${ii}` }]);
  })));
  if (!rows.length) return review(chat, d);
  rows.push([{ text: '↩️ Back', callback_data: 'back' }]);
  return say(chat, '<b>Which one?</b> Tap a dish and send me just the number.', keyboard(rows));
}

const DIET_ICON = { halal: '☪️', vegan: '🌱', vegetarian: '🥬' };
const dietMark = i => (i.diet && i.diet.length) ? i.diet.map(d => DIET_ICON[d] || '•').join('') : '▫️';
const courtItems = c => c.stalls.flatMap(s => s.cats.flatMap(k => k.items));

async function courtForChat(chat) {
  const id = await store.get('foodflow:lastcourt:' + chat);
  if (!id) return null;
  return (await store.getPublished()).find(c => c.id === id) || null;
}

/* ── the flags the model is not allowed to guess ───────────────────────
   This is the merchant confirming, by hand, the two things a wrong answer
   would actually hurt someone over. */
async function dietList(chat) {
  const c = await courtForChat(chat);
  if (!c) return say(chat, 'Nothing published yet. Send me a photo of your menu board first, then publish it — I\'ll ask you about diets after.');
  const items = courtItems(c).slice(0, 18);
  if (!items.length) return say(chat, 'That canteen has no priced dishes yet.');
  return say(chat,
    `🥗 <b>Dietary flags — ${esc(c.name)}</b>\n\n` +
    'I never guess these. Halal is a certification, and calling a dish vegetarian when it isn\'t puts food in front of someone who didn\'t want it. So they stay empty until you say.\n\n' +
    '<b>Tap a dish to set it.</b>',
    keyboard(items.map(i => [{ text: `${dietMark(i)} ${i.name}`.slice(0, 60), callback_data: 'df:' + i.id }])
      .concat([[{ text: '✅ Done', callback_data: 'dietdone' }]])));
}

async function dietDish(chat, itemId) {
  const c = await courtForChat(chat);
  const it = c && courtItems(c).find(i => i.id === itemId);
  if (!it) return dietList(chat);
  const on = f => (it.diet || []).includes(f) ? '✅' : '▫️';
  return say(chat, `<b>${esc(it.name)}</b> — ${money(it.price)}\n\nTap to turn a flag on or off.`,
    keyboard([
      [{ text: `${on('halal')} ☪️ Halal`,           callback_data: `ds:${itemId}:halal` }],
      [{ text: `${on('vegetarian')} 🥬 Vegetarian`, callback_data: `ds:${itemId}:vegetarian` }],
      [{ text: `${on('vegan')} 🌱 Vegan`,           callback_data: `ds:${itemId}:vegan` }],
      [{ text: '↩️ Back to the list',               callback_data: 'diet' }]
    ]));
}

async function dietToggle(chat, itemId, flag) {
  const c = await courtForChat(chat);
  const it = c && courtItems(c).find(i => i.id === itemId);
  if (!it) return dietList(chat);
  const set = new Set(it.diet || []);
  set.has(flag) ? set.delete(flag) : set.add(flag);
  if (set.has('vegan')) set.add('vegetarian');          /* vegan implies vegetarian */
  if (!set.has('vegetarian')) set.delete('vegan');
  it.diet = [...set];
  it.dietUnset = it.diet.length === 0;
  await store.publish(c);                                /* replaces the court by id */
  return dietDish(chat, itemId);
}

module.exports.renderTree = renderTree;
module.exports.enrich = enrich;

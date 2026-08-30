/* Anything a merchant can send in a chat -> something the menu reader can use.

   A merchant does not think in file formats. They send whatever they have: a photo
   of the board, the PDF the printer made, the spreadsheet from the coffee shop
   owner, a voice note because typing on a phone is miserable. So the bot branches
   on nothing — every input is normalised here into either images or text, and the
   rest of the pipeline stays the same.

   No new dependencies: Vercel functions cold-start faster without them, and a
   hackathon deploy that needs a native binary is a deploy that breaks on stage. */

const zlib = require('zlib');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const KEY   = process.env.OPENAI_API_KEY;

/* ── Telegram file fetch ─────────────────────────────────────────────── */
async function tgFile(fileId) {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/getFile`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_id: fileId })
  });
  const j = await r.json();
  if (!j.ok || !j.result?.file_path) throw new Error('could not fetch that file from Telegram');
  const f = await fetch(`https://api.telegram.org/file/bot${TOKEN}/${j.result.file_path}`);
  return { buf: Buffer.from(await f.arrayBuffer()), path: j.result.file_path };
}

const MIME = { png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg' };
const asDataUrl = ({ buf, path }) => {
  const ext = (path.split('.').pop() || 'jpg').toLowerCase();
  return `data:${MIME[ext] || 'image/jpeg'};base64,${buf.toString('base64')}`;
};

/* ── PDF -> text, using only zlib ──────────────────────────────────────
   Menus that came out of a design tool or a printer are text PDFs, and the
   words are sitting in FlateDecode streams. Pull them out rather than making
   the merchant photograph a screen. A scanned PDF has no text layer at all —
   we detect that and say so instead of returning nothing and looking broken. */
function pdfText(buf) {
  const out = [];
  const raw = buf.toString('latin1');
  const re = /stream\r?\n?([\s\S]*?)endstream/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    let chunk = Buffer.from(m[1], 'latin1');
    try { chunk = zlib.inflateSync(chunk); }
    catch { try { chunk = zlib.inflateRawSync(chunk); } catch { /* not compressed, or an image */ } }
    const t = chunk.toString('latin1');
    if (!/(Tj|TJ)/.test(t)) continue;
    out.push(textOps(t));
  }
  return out.join('\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

/* Pull the strings out of the content stream's text-showing operators. */
function textOps(s) {
  const lines = [];
  let line = '';
  const push = () => { if (line.trim()) lines.push(line.trim()); line = ''; };
  const re = /\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]+>|\bT[dDmJ*]\b|\bTj\b|\bET\b/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    const tok = m[0];
    if (tok[0] === '(')      line += unescapePdf(tok.slice(1, -1));
    else if (tok[0] === '<') line += hexStr(tok.slice(1, -1));
    else if (/^(Td|TD|T\*|ET)$/.test(tok)) push();
  }
  push();
  return lines.join('\n');
}
const unescapePdf = s => s
  .replace(/\\([0-7]{1,3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)))
  .replace(/\\n/g, '\n').replace(/\\r/g, '').replace(/\\t/g, ' ')
  .replace(/\\([()\\])/g, '$1');
const hexStr = h => {
  const clean = h.replace(/\s/g, '');
  let s = '';
  for (let i = 0; i + 1 < clean.length; i += 2) {
    const c = parseInt(clean.slice(i, i + 2), 16);
    if (c >= 32 || c === 10) s += String.fromCharCode(c);
  }
  return s;
};

/* ── voice note -> text ───────────────────────────────────────────────
   Reading a menu out loud is faster than typing it, and it is the one input
   a stall owner can give with their hands full. */
async function transcribe({ buf, path }) {
  if (!KEY) throw new Error('no OPENAI_API_KEY — listening needs the model');
  const fd = new FormData();
  fd.append('file', new Blob([buf]), (path.split('/').pop() || 'audio.ogg'));
  fd.append('model', process.env.OPENAI_TRANSCRIBE_MODEL || 'whisper-1');
  fd.append('prompt', 'A Singapore hawker or canteen menu: dish names and prices.');
  const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST', headers: { Authorization: `Bearer ${KEY}` }, body: fd
  });
  if (!r.ok) throw new Error(`transcribe ${r.status}: ${(await r.text()).slice(0, 160)}`);
  return ((await r.json()).text || '').trim();
}

const TEXTY = /\.(txt|csv|tsv|md|json)$/i;

/* ── a link to the menu the merchant already publishes ─────────────────
   Plenty of shops do have a website; what they don't have is any way to hand
   it to an agent. Pasting the URL is the least work a merchant can possibly
   do, so it should work. */
const URL_RE = /\bhttps?:\/\/[^\s<>"')]+/i;
const findUrl = t => (String(t || '').match(URL_RE) || [null])[0];

/* Fetching a URL a stranger supplies is a request forgery risk: keep it to
   public http(s) and refuse anything pointing back inside the network. */
const PRIVATE = /^(localhost$|127\.|10\.|192\.168\.|169\.254\.|0\.|\[?::1|172\.(1[6-9]|2\d|3[01])\.)/i;
function safeUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  if (PRIVATE.test(u.hostname)) return null;
  return u;
}

async function getPage(u, ms = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(u, { redirect: 'follow', signal: ctrl.signal,
      headers: { 'User-Agent': 'FoodFlowBot/1.0 (+menu import)', Accept: 'text/html,application/pdf,*/*' } });
    if (!r.ok) throw new Error(`site answered ${r.status}`);
    const type = (r.headers.get('content-type') || '').toLowerCase();
    const buf  = Buffer.from((await r.arrayBuffer()).slice(0, 4e6));
    return { type, buf, url: r.url || String(u) };
  } finally { clearTimeout(t); }
}

/* HTML -> the words a human would see. Scripts and styles out, tags out,
   entities back to characters, blank lines collapsed. */
function htmlText(html) {
  let h = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6])[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  h = h.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
       .replace(/&#0?39;|&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
       .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d));
  return h.split('\n').map(l => l.replace(/[ \t\u00a0]+/g, ' ').trim())
          .filter(Boolean).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/* Restaurants very often carry schema.org markup that already lists the menu.
   If it's there it is far cleaner than the rendered text, so hand it over too. */
function jsonLd(html) {
  const out = [];
  const re = /<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null && out.length < 4) {
    const t = m[1].trim();
    if (/menu|offer|hasMenu|MenuItem|price/i.test(t)) out.push(t.slice(0, 4000));
  }
  return out.join('\n');
}

/* Some sites just link to a PDF of the menu. Follow that once. */
function pdfLink(html, base) {
  const re = /href\s*=\s*["']([^"']+\.pdf(?:\?[^"']*)?)["']/gi;
  const hits = [];
  let m;
  while ((m = re.exec(html)) !== null) hits.push(m[1]);
  if (!hits.length) return null;
  const best = hits.find(h => /menu|food|carte/i.test(h)) || hits[0];
  try { return new URL(best, base).href; } catch { return null; }
}

/* ── a page whose menu IS pictures ────────────────────────────────────
   Very common: a gallery or carousel of photographed menu boards, which is
   exactly what the vision model already reads. Pull the image URLs out, rank
   the ones that look like a menu above the ones that look like furniture,
   and hand them to the same reader a photo goes to. */
const IMG_SKIP = /logo|icon|favicon|sprite|avatar|badge|banner|header|footer|placeholder|pixel|spacer|social|whatsapp|instagram|facebook/i;
const IMG_WANT = /menu|food|dish|card|carte|price|board|gallery/i;
const IMG_EXT  = /\.(jpe?g|png|webp)(\?|$)/i;

function imageUrls(html, base) {
  const found = [];
  const add = u => {
    if (!u) return;
    let abs; try { abs = new URL(u.trim(), base).href; } catch { return; }
    if (!/^https?:/.test(abs) || IMG_SKIP.test(abs)) return;
    if (!IMG_EXT.test(abs) && !/wixstatic|squarespace|cdn|images|photo/i.test(abs)) return;
    if (!found.includes(abs)) found.push(abs);
  };

  let m;
  const src = /<img\b[^>]*?\b(?:data-src|data-original|src)\s*=\s*["']([^"']+)["']/gi;
  while ((m = src.exec(html)) !== null) add(m[1]);

  const sset = /\bsrcset\s*=\s*["']([^"']+)["']/gi;
  while ((m = sset.exec(html)) !== null)
    add(m[1].split(',').pop().trim().split(/\s+/)[0]);      /* the largest variant */

  const bg = /background-image\s*:\s*url\((["']?)([^"')]+)\1\)/gi;
  while ((m = bg.exec(html)) !== null) add(m[2]);

  const og = /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i.exec(html);
  if (og) add(og[1]);

  /* a picture called "menu" beats a picture called "hero-3" */
  return found.sort((a, b) => (IMG_WANT.test(b) ? 1 : 0) - (IMG_WANT.test(a) ? 1 : 0));
}

/* Download in parallel — three sequential vision calls would blow the
   webhook's 60 seconds, three parallel ones comfortably do not. */
async function grabImages(urls, max = 3) {
  const picked = urls.slice(0, max);
  const out = await Promise.all(picked.map(async u => {
    try {
      const p = await getPage(u, 9000);
      if (!/^image\//.test(p.type) || p.buf.length < 3000 || p.buf.length > 5e6) return null;
      const mime = p.type.split(';')[0];
      return `data:${mime};base64,${p.buf.toString('base64')}`;
    } catch { return null; }
  }));
  return out.filter(Boolean);
}

async function fromUrl(raw) {
  const u = safeUrl(raw);
  if (!u) {
    const priv = /^https?:/i.test(raw);
    return { kind: 'url', images: [], text: '',
      note: priv ? 'That address points somewhere private, so I won\'t open it. Send me a public link to your menu.'
                 : 'That doesn\'t look like a web address I can open. It needs to start with <code>http</code>.' };
  }

  let page;
  try { page = await getPage(u); }
  catch (e) {
    return { kind: 'url', images: [], text: '',
      note: `I couldn\'t open <b>${u.hostname}</b> (${esc(e.message)}). If the menu is behind a login or loads as a picture, send me a screenshot instead.` };
  }

  if (/pdf/.test(page.type) || /\.pdf($|\?)/i.test(page.url)) {
    const text = pdfText(page.buf);
    if (text.length > 40) return { kind: 'url', images: [], text, note: `🔗 Read the menu PDF from <b>${u.hostname}</b>.` };
    return { kind: 'url', images: [], text: '',
      note: `The PDF at <b>${u.hostname}</b> is a scan with no text in it. Send me a screenshot of the menu instead.` };
  }

  const html = page.buf.toString('utf8');
  let text = [jsonLd(html), htmlText(html)].filter(Boolean).join('\n\n');

  /* A page is usable when it actually shows prices. Length is a bad test:
     a hawker menu page is legitimately short, and a JavaScript shell is
     legitimately long. Count the prices instead. */
  if (priceCount(text) < 2) {
    const link = pdfLink(html, page.url);
    if (link) {
      try {
        const p2 = await getPage(link);
        const t2 = pdfText(p2.buf);
        if (t2.length > 20) return { kind: 'url', images: [], text: t2, note: `🔗 Found a menu PDF linked from <b>${u.hostname}</b> and read that.` };
      } catch { /* fall through to the honest answer below */ }
    }
    /* the menu is probably the pictures on the page — read those */
    const imgs = await grabImages(imageUrls(html, page.url));
    if (imgs.length)
      return { kind: 'url', images: imgs, text: '',
        note: `🔗 <b>${u.hostname}</b> shows its menu as pictures, so I\'m reading ${imgs.length === 1 ? 'the image' : `all ${imgs.length} of them`}…` };

    /* long page with numbers on it — let the model look rather than refuse */
    if (text.length > 400 && /\d/.test(text))
      return { kind: 'url', images: [], text: text.slice(0, 20000),
               note: `🔗 Read <b>${u.hostname}</b>. I couldn\'t see clear prices, so check them carefully.` };

    return { kind: 'url', images: [], text: '',
      note: `I opened <b>${u.hostname}</b> but found neither menu text nor a menu picture on it — some sites build the whole page in JavaScript, which I can\'t run. Send me a screenshot of the menu and I\'ll read that.` };
  }

  return { kind: 'url', images: [], text: text.slice(0, 20000), note: `🔗 Read the menu from <b>${u.hostname}</b>.` };
}

/* "$8.50", "8.50", "S$4" — two or more of these and it's a menu, not a shell page. */
const priceCount = t => (String(t).match(/(?:S?\$\s?\d+(?:[.,]\d{1,2})?)|(?:\b\d+[.,]\d{2}\b)/g) || []).length;

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* ── the one entry point ──────────────────────────────────────────────
   Returns { kind, images[], text, note } — note is anything the merchant
   should be told about how we read it, so nothing happens silently. */
async function intake(m) {
  /* a photo, or an image sent as a file */
  const photo = m.photo ? m.photo[m.photo.length - 1] : null;
  if (photo) return { kind: 'photo', images: [asDataUrl(await tgFile(photo.file_id))], text: '' };

  const doc = m.document;
  if (doc) {
    const name = doc.file_name || '';
    const mime = doc.mime_type || '';
    if (/^image\//.test(mime))  return { kind: 'photo', images: [asDataUrl(await tgFile(doc.file_id))], text: '' };

    if (/pdf/.test(mime) || /\.pdf$/i.test(name)) {
      const file = await tgFile(doc.file_id);
      const text = pdfText(file.buf);
      if (text.length > 40) return { kind: 'pdf', images: [], text, note: '📄 Read the text straight out of the PDF.' };
      return { kind: 'pdf-scanned', images: [], text: '',
        note: 'That PDF is a scan — there is no text in it to read. Send me a photo of the menu instead and I\'ll read the picture.' };
    }

    if (/^text\//.test(mime) || TEXTY.test(name)) {
      const file = await tgFile(doc.file_id);
      return { kind: 'textfile', images: [], text: file.buf.toString('utf8').slice(0, 20000),
               note: `📄 Read <b>${name || 'your file'}</b>.` };
    }
    return { kind: 'unknown', images: [], text: '',
      note: `I can\'t open <b>${name || 'that'}</b>. A photo of the menu, a PDF, a spreadsheet exported as CSV, or just typing it all work.` };
  }

  /* spoken menu */
  if (m.voice || m.audio) {
    const a = m.voice || m.audio;
    const text = await transcribe(await tgFile(a.file_id));
    if (!text) return { kind: 'voice', images: [], text: '', note: 'I couldn\'t make out any words there.' };
    return { kind: 'voice', images: [], text, note: `🎙 I heard: <i>${text.slice(0, 300)}</i>` };
  }

  /* video: Telegram gives us a cover frame, which is worth trying and worth
     being honest about — one low-resolution frame is not a menu scan. */
  const vid = m.video || m.video_note || m.animation;
  if (vid) {
    const thumb = vid.thumbnail || vid.thumb;
    if (!thumb) return { kind: 'video', images: [], text: '',
      note: 'I can\'t watch video yet. Take a still photo of the board instead — it reads much better.' };
    return { kind: 'video', images: [asDataUrl(await tgFile(thumb.file_id))], text: '',
      note: '🎬 I can only see the video\'s cover frame, and it\'s small. Check what I got carefully — a still photo reads far better.' };
  }

  return null;   /* not an attachment — the caller handles plain text */
}

module.exports = { intake, fromUrl, findUrl, imageUrls, pdfText, textOps, htmlText, jsonLd, pdfLink, safeUrl };

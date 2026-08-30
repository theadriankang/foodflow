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

module.exports = { intake, pdfText, textOps };

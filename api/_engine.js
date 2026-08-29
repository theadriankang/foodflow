/* Server-side rules engine.
   Two jobs: (1) it is the fallback whenever the model is unavailable or unkeyed,
   (2) it does the deterministic filtering the model is never allowed to do —
   dietary and allergen exclusions are hard filters here, never soft-scored by an LLM. */
const COURTS = require('./catalog.json');

const allDishes = () => COURTS.filter(c => c.live)
  .flatMap(c => c.stalls.flatMap(s => s.cats.flatMap(k => k.items)));
const byId = id => allDishes().find(d => d.id === id);
const money = n => 'S$' + Number(n).toFixed(2);

const CUIS = { japanese:'Japanese', chinese:'Chinese', korean:'Korean', thai:'Thai', western:'Western',
  indian:'Indian', indonesian:'Indonesian', malay:'Indonesian', taiwanese:'Taiwanese', local:'Local', hawker:'Local' };

const EXCLUSIONS = [
  [/no pork|without pork|pork.free/, 'pork', 'no pork'],
  [/no beef/, 'beef', 'no beef'],
  [/no (?:dairy|milk)|lactose/, 'dairy', 'no dairy'],
  [/no (?:seafood|shellfish|prawn)/, 'shellfish', 'no shellfish'],
  [/no fish/, 'fish', 'no fish'],
  [/gluten.free|no gluten/, 'gluten', 'gluten-free'],
  [/no egg/, 'egg', 'no egg'],
  [/no nuts|nut allerg|no peanut/, 'nuts', 'no nuts'],
  [/no chicken/, 'chicken', 'no chicken']
];

/* Needs accumulate across turns — this merges the new message into what we already knew. */
function parse(text, prior = {}) {
  const n = { ...prior };
  const q = ' ' + String(text || '').toLowerCase() + ' ';
  const set = (k, label, v) => { n[k] = { label, v }; };

  const b = q.match(/(?:under|below|less than|max|within)\s*(?:s?\$)?\s*(\d+(?:\.\d+)?)/);
  if (b) set('budget', `under $${b[1]}`, +b[1]);

  if (/\bvegan\b/.test(q)) set('diet', 'vegan', 'vegan');
  else if (/vegetarian|veggie|no meat/.test(q)) set('diet', 'vegetarian', 'vegetarian');
  if (/\bhalal\b/.test(q)) set('halal', 'halal', 1);

  for (const [re, tag, label] of EXCLUSIONS) if (re.test(q)) set('ex_' + tag, label, tag);

  if (/soup|soupy|broth|wet/.test(q)) set('tex', 'soupy', 'soupy');
  else if (/\bdry\b|not soupy/.test(q)) set('tex', 'dry', 'dry');
  else if (/crisp|crunch|fried/.test(q)) set('tex', 'crispy', 'crispy');

  if (/noodle|mee\b|ramen|bee hoon|udon|pasta|hor fun/.test(q)) set('form', 'noodles', 'noodles');
  else if (/\brice\b|\bdon\b|briyani|biryani/.test(q)) set('form', 'rice', 'rice');
  else if (/prata|bread|wrap|pita|sandwich|toast/.test(q)) set('form', 'something in bread', 'bread');
  else if (/drink|coffee|latte|juice|lassi|kopi/.test(q)) set('form', 'a drink', 'drink');

  for (const k in CUIS) if (q.includes(' ' + k)) set('cuisine', CUIS[k], CUIS[k]);

  if (/light|not too heavy|not heavy|healthy|small/.test(q)) set('weight', 'something light', 'light');
  else if (/heavy|filling|hearty|starving|very hungry/.test(q)) set('weight', 'filling', 'heavy');

  if (/not spicy|no spice|\bmild\b/.test(q)) set('spice', 'not spicy', 0);
  else if (/spicy|chilli|chili|mala/.test(q)) set('spice', 'spicy', 2);

  if (/\bcold\b|\biced\b|refreshing/.test(q)) set('temp', 'cold', 'cold');
  else if (/\bwarm\b|something hot/.test(q)) set('temp', 'warm', 'hot');

  if (/quick|fast|in a rush|hurry|no time|rushing/.test(q)) set('speed', 'in a rush', 1);
  if (/protein|gym|workout|gains|bulk|lifting|muscle/.test(q)) set('protein', 'high in protein', 1);

  for (const c of COURTS) {
    if (!c.live) continue;
    if (q.includes(c.name.toLowerCase()) || q.includes(c.id)) set('court', `at ${c.name}`, c.id);
  }
  if (/nearest|closest|nearby|on (the|my) way|shortest walk/.test(q)) set('court', 'nearest canteen', 'near');
  return n;
}

function score(d, n) {
  /* hard filters first — an allergen is never a preference */
  if (n.diet && !d.diet.includes(n.diet.v)) return -1;
  if (n.halal && !d.diet.includes('halal')) return -1;
  for (const k in n) if (k.startsWith('ex_') && d.has.includes(n[k].v)) return -1;
  if (n.budget && d.price > n.budget.v) return -1;

  let s = 0;
  if (n.tex) s += n.tex.v === 'dry' ? (d.tex.includes('soupy') ? -3 : 2) : (d.tex.includes(n.tex.v) ? 3 : -1);
  if (n.form) s += d.form === n.form.v ? 3 : -2;
  if (n.cuisine) s += d.cuisine === n.cuisine.v ? 3 : -2;
  if (n.weight) s += n.weight.v === 'light' ? (d.heavy <= 2 ? 2.5 : -1.5) : (d.heavy >= 4 ? 2.5 : -1.5);
  if (n.spice) s += n.spice.v === 2 ? (d.fl.spicy >= 2 ? 3 : -1.5) : (d.fl.spicy === 0 ? 1.5 : -2.5);
  if (n.temp) s += d.temp === n.temp.v ? 2 : -2;
  if (n.speed) s += d.prep <= 8 ? 2 : -1;
  if (n.court) s += n.court.v === 'near' ? (18 - d.walk) * 0.2 : (d.court === n.court.v ? 3 : -2.5);
  if (n.protein) s += d.pro >= 30 ? 2.5 : d.pro >= 22 ? 1 : -2;
  if (n.budget) s += 0.5;
  return s;
}

function because(d, n) {
  const b = [];
  if (n.tex && n.tex.v !== 'dry' && d.tex.includes(n.tex.v)) b.push(n.tex.v);
  if (n.tex && n.tex.v === 'dry' && !d.tex.includes('soupy')) b.push('not soupy');
  if (n.form && d.form === n.form.v) b.push(d.form === 'bread' ? 'in bread' : d.form);
  if (n.cuisine && d.cuisine === n.cuisine.v) b.push(d.cuisine);
  if (n.weight) b.push(d.heavy <= 2 ? 'light' : 'filling');
  if (n.spice && n.spice.v === 2 && d.fl.spicy >= 2) b.push('properly spicy');
  if (n.spice && n.spice.v === 0 && d.fl.spicy === 0) b.push('no chilli');
  if (n.halal) b.push('halal');
  for (const k in n) if (k.startsWith('ex_') && !d.has.includes(n[k].v)) b.push(n[k].label);
  if (n.speed && d.prep <= 8) b.push(`${d.prep} min`);
  b.push(`${d.stall} · ${d.courtName}`);
  if (n.budget) b.push(money(d.price));
  return b.slice(0, 4).join(' · ');
}


/* ── "tell me about that one" ──────────────────────────────────────────────
   Recommending is only half a conversation. When someone asks what's IN a dish,
   or what they can pick, answering that question is the whole job — and pitching
   a different dish instead is the single most annoying thing an agent can do. */
const DETAIL_RE = /(what'?s in|what is in|whats in|ingredient|what can i (pick|choose|select)|what.*options|tell me (more|about)|more about|more info|describe|how does .* work|what comes with|inside)/i;

function isDetailQuestion(text){ return DETAIL_RE.test(String(text || '')); }

/* Which dish do they mean? Their words first, then whatever we just showed them. */
function findFocus(text, lastShown = []) {
  const q = String(text || '').toLowerCase();
  const all = allDishes();

  const named = all.find(d => q.includes(d.name.toLowerCase()));
  if (named) return named;

  const loose = all.find(d => {
    const words = d.name.toLowerCase().replace(/[()]/g, '').split(/\s+/).filter(w => w.length > 3);
    return words.length && words.every(w => q.includes(w));
  });
  if (loose) return loose;

  /* nicknames people actually use */
  const NICK = [[/yong ?tau ?foo|ytf|yong tow foo|young tofu/, 'Yong Tau Foo Soup'],
                [/\bmala\b/, 'Mala'], [/chicken rice/, 'Hainanese'], [/cai ?fan|economy rice|mixed rice/, 'Rice + 3'],
                [/ban ?mian/, 'Ban Mian'], [/katsu/, 'Katsu'], [/ramen/, 'Ramen'], [/prata/, 'Prata']];
  for (const [re, frag] of NICK){
    if (re.test(q)){
      const hit = all.find(d => d.name.includes(frag) && (!lastShown.length || lastShown.includes(d.id)))
               || all.find(d => d.name.includes(frag));
      if (hit) return hit;
    }
  }

  /* No dish named. If we just showed exactly one, that is what "which ones",
     "what's in it" and "how does that work" are all about. */
  if (lastShown.length === 1) return byId(lastShown[0]);
  return null;
}

function describe(d){
  const bits = [];
  bits.push(`<b>${d.name}</b> — ${money(d.price)} at ${d.stall}, ${d.courtName}. ${d.desc}`);
  if (d.ing && d.ing.length) bits.push(`It comes with ${d.ing.slice(0, -1).join(', ')} and ${d.ing[d.ing.length - 1]}.`);
  const flags = [];
  if (d.diet.includes('vegan')) flags.push('vegan');
  else if (d.diet.includes('vegetarian')) flags.push('vegetarian');
  if (d.diet.includes('halal')) flags.push('halal');
  if (d.has.length) flags.push(`contains ${d.has.join(', ')}`);
  if (flags.length) bits.push(flags.join(' · ') + '.');
  bits.push(`About ${d.prep} minutes, ${d.walk} minutes' walk away.`);
  if (d.opts) bits.push(`${d.opts.label} — tap the ones you want below.`);
  return bits.join(' ');
}


/* ── what the agent can point at ───────────────────────────────────────────
   Asking "which of these are high in protein" is a question about the picker
   the customer is looking at. The agent answers by CHANGING that picker, not by
   describing it in prose. Which ingredients carry which tag is a fact from the
   catalog, never the model's opinion. */
const ING_TAGS = {
  /* yong tau foo */
  'Fish ball':['protein'], 'Fish cake':['protein'], 'Meatball':['protein'],
  'Seaweed chicken roll':['protein','fried'], 'Soft tofu':['protein','veg','lowcal'],
  'Tau pok':['protein','veg','fried'], 'Beancurd skin':['protein','veg','fried'],
  'Stuffed brinjal':['veg'], 'Stuffed chilli':['veg'], 'Stuffed okra':['veg','lowcal'],
  'Long bean':['veg','lowcal'], 'Button mushroom':['veg','lowcal'],
  /* mala */
  'Lotus root':['veg'], 'Cauliflower':['veg','lowcal'], 'Lettuce':['veg','lowcal'],
  'Enoki mushroom':['veg','lowcal'], 'Baby corn':['veg','lowcal'],
  'Luncheon meat':['protein','fried'], 'Sliced pork':['protein'], 'Chicken slices':['protein'],
  'Prawns':['protein','lowcal'], 'Quail egg':['protein'], 'Wide noodles':[],
  /* economy rice */
  'Braised egg':['protein'], 'Sweet & sour pork':['protein','fried'], 'Curry chicken':['protein'],
  'Mapo tofu':['protein'], 'Fried fish':['protein','fried'], 'Ngoh hiang':['protein','fried'],
  'Stir-fried cabbage':['veg','lowcal'], 'Sambal brinjal':['veg'], 'Stir-fried beansprouts':['veg','lowcal'],
  'Long bean with egg':['veg','protein'],
  /* chargrill sides */
  'Coleslaw':['veg'], 'Fries':['veg','fried'], 'Baked beans':['veg','protein'],
  'Garden salad':['veg','lowcal'], 'Mashed potato':['veg'], 'Buttered corn':['veg','lowcal']
};

const HL = [
  ['protein', /protein|bulk|gains|after (the )?gym|post.?workout|filling.?up/i, 'highest in protein'],
  ['veg',     /vegetarian|veggie|meat.?free|no meat|plant/i,                    'vegetarian'],
  ['lowcal',  /low.?cal|lighter|lightest|healthiest|healthy|least heavy|cutting/i, 'lightest'],
  ['fried',   /fried|deep.?fried|oily|greasy/i,                                 'the fried ones']
];

/* A question about the picker, even without the words "tell me more". */
function isOptionQuestion(text){
  const q = String(text || '');
  return /\b(which|what)\b/i.test(q) && HL.some(([, re]) => re.test(q));
}

function highlightFor(dish, text){
  if (!dish || !dish.opts) return null;
  for (const [tag, re, note] of HL){
    if (!re.test(String(text || ''))) continue;
    const choices = dish.opts.choices.filter(c => (ING_TAGS[c] || []).includes(tag));
    if (choices.length) return { tag, note, choices };
  }
  return null;
}

function sayHighlight(d, h){
  const list = h.choices.length > 1
    ? h.choices.slice(0, -1).join(', ') + ' and ' + h.choices[h.choices.length - 1]
    : h.choices[0];
  return `Of the ${d.opts.choices.length} you can pick, these ${h.choices.length} are ${h.note}: <b>${list}</b>. I've marked them below — tap the ones you want.`;
}

function rank(needs) {
  return allDishes().map(d => ({ d, s: score(d, needs) }))
    .filter(x => x.s >= 0)
    .sort((a, b) => b.s - a.s || a.d.price - b.d.price);
}

module.exports = { COURTS, allDishes, byId, money, parse, score, because, rank,
                   isDetailQuestion, findFocus, describe,
                   isOptionQuestion, highlightFor, sayHighlight };

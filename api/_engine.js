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

function rank(needs) {
  return allDishes().map(d => ({ d, s: score(d, needs) }))
    .filter(x => x.s >= 0)
    .sort((a, b) => b.s - a.s || a.d.price - b.d.price);
}

module.exports = { COURTS, allDishes, byId, money, parse, score, because, rank };

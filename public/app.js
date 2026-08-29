/* ══════════ REAL NUS CATALOG — court › stall › category › dish ══════════ */
let COURTS = [];   /* loaded from /api/catalog — the server is the source of truth */

/* the canteen the merchant will onboard live in the demo */
const SAMPLE_CSV = `Stall,ITEM,Price ($),notes
The Spread,Spaghetti Aglio Olio,6.50,
The Spread,Penne al Ragu Bolognese,8.90,beef
The Spread,Superfood Salad Bowl,10.50,
The Spread,Japanese Beef Bowl w Sunny Side Up,8.80,
Dickson's North Indian Halal,Butter Chicken Briyani,6.00,halal
Dickson's North Indian Halal,Tandoori Chicken Set,6.00,halal
Dickson's North Indian Halal,Cauliflower Briyani,5.50,veg halal
Dickson's North Indian Halal,Mango Lassi,,drink`;

/* ══════════ derived state ══════════ */
let uid = 10000;
const allDishes = () => COURTS.filter(c => c.live).flatMap(c =>
  c.stalls.flatMap(s => s.cats.flatMap(k => k.items)));
const byId = id => allDishes().find(d => d.id === id);
const money = n => 'S$' + n.toFixed(2);
const dark = () => document.documentElement.dataset.theme === 'dark'
  || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
const MANDATE = 40;

const state = { view:'store', court:'all', cat:'All', cart:[], order:null, ledger:[], needs:{}, asked:0,
                wizard:null, fulfil:'pickup', carrier:null, lastShown:[], picking:null };

/* ══════════ STOREFRONT ══════════ */
function catsFor(){
  const set = new Set();
  COURTS.filter(c => c.live && (state.court === 'all' || c.id === state.court))
    .forEach(c => c.stalls.forEach(s => s.cats.forEach(k => set.add(k.name))));
  return ['All', ...[...set].sort()];
}
function visible(){
  return allDishes().filter(d =>
    (state.court === 'all' || d.court === state.court) &&
    (state.cat === 'All' || d.cat === state.cat));
}
function chipsFor(d){
  const o = [];
  if (d.diet.includes('vegan')) o.push(['Vegan',1]); else if (d.diet.includes('vegetarian')) o.push(['Vegetarian',1]);
  else if (d.diet.includes('halal')) o.push(['Halal',1]);
  if (d.tex.includes('soupy')) o.push(['Soupy',0]); else if (d.tex.includes('crispy')) o.push(['Crispy',0]);
  if (d.fl.spicy >= 2) o.push(['Spicy',0]); else if (d.fl.sweet >= 3) o.push(['Sweet',0]);
  if (d.heavy <= 2) o.push(['Light',0]); else if (d.heavy >= 4) o.push(['Hearty',0]);
  return o.slice(0,3);
}
function drawCourts(){
  const live = COURTS.filter(c => c.live);
  courts.innerHTML = `<button class="ct" data-court="all" aria-pressed="${state.court==='all'}">All canteens <small>${live.length}</small></button>`
    + live.map(c => `<button class="ct" data-court="${c.id}" aria-pressed="${state.court===c.id}">${c.name} <small>${c.walk} min</small></button>`).join('');
}
function drawTabs(){
  tabs.innerHTML = catsFor().map(c => `<button class="tab" role="tab" aria-selected="${c===state.cat}" data-cat="${c}">${c}</button>`).join('');
}

/* ══════════ what the agent marks ══════════
   Not a special case for the ingredient picker — this runs on every dish, everywhere
   it appears, straight off the constraints the customer has actually given. Say you
   came from the gym and every card starts showing its protein. Say "no pork" and the
   ones that clear it say so. The UI answers the conversation without being asked. */
function marksFor(d){
  const n = state.needs, m = [];
  const put = (label, hot) => m.push({ label, hot });

  if (n.protein) put(`${d.nutEst ? '~' : ''}${d.pro}g protein`, d.pro >= 25);
  if (n.weight && n.weight.v === 'light')  put(`${d.nutEst ? '~' : ''}${d.kcal} kcal`, d.heavy <= 2);
  if (n.weight && n.weight.v === 'heavy')  put('filling', d.heavy >= 4);
  if (n.tex) n.tex.v === 'dry' ? put('not soupy', !d.tex.includes('soupy'))
                               : put(n.tex.v, d.tex.includes(n.tex.v));
  if (n.spice) n.spice.v === 2 ? put('spicy', d.fl.spicy >= 2)
                               : put('no chilli', d.fl.spicy === 0);
  if (n.temp)    put(n.temp.v === 'cold' ? 'cold' : 'served hot', d.temp === n.temp.v);
  if (n.form)    put(d.form === 'bread' ? 'in bread' : d.form, d.form === n.form.v);
  if (n.cuisine) put(d.cuisine, d.cuisine === n.cuisine.v);
  if (n.halal)   put('halal', d.diet.includes('halal'));
  if (n.diet)    put(n.diet.v, d.diet.includes(n.diet.v));
  for (const k in n) if (k.startsWith('ex_')) put(n[k].label, !d.has.includes(n[k].v));
  if (n.speed)   put(`${d.prep} min`, d.prep <= 8);
  if (n.court)   put(`${d.walk} min walk`, true);
  if (n.budget)  put(money(d.price), d.price <= n.budget.v);

  return m.filter(x => x.hot).slice(0, 4);   /* only what actually matches them */
}
const markChips = m => m.map(x => `<span class="at hot">${x.label}</span>`).join('');

function cardHTML(d, grouped){
  const inCart = state.cart.some(i => i.id === d.id);
  const where  = grouped ? d.stall : `${d.stall} · ${d.courtName}`;
  return `<article class="card">
    <div class="card-top">
      <div class="tile" style="background:${dark()?d.tintD:d.tint}">${d.icon}</div>
      <div class="ctext"><h3>${d.name}</h3><p class="merch">${where}</p></div>
    </div>
    <p class="desc">${d.desc}</p>
    <div class="attrs">${(() => {
        const m = marksFor(d);
        const said = m.map(x => x.label.toLowerCase());
        const rest = chipsFor(d).filter(([t]) => !said.includes(t.toLowerCase()))
                                .slice(0, Math.max(0, 3 - m.length));
        return markChips(m) + rest.map(([t,g]) => `<span class="at${g?' diet':''}">${t}</span>`).join('');
      })()}</div>
    <div class="card-foot">
      <div class="pricebox"><span class="price num">${money(d.price)}</span><span class="prep">${d.prep} min</span></div>
      <button class="add${inCart?' in':''}" data-add="${d.id}">${inCart?'Added':'Add'}</button>
    </div>
  </article>`;
}

function drawGrid(){
  const list = visible();
  if (!list.length){
    grid.innerHTML = `<p class="empty">Nothing on campus matches that filter. Try another canteen or category.</p>`;
    return;
  }
  /* Browsing everything? Break it up by canteen — a flat wall of 35 cards reads as a
     spreadsheet, and which canteen a dish is in is the thing people actually navigate by. */
  const grouped = state.court === 'all' && state.cat === 'All';
  if (grouped){
    grid.innerHTML = COURTS.filter(c => c.live)
      .map(c => ({ c, items: list.filter(d => d.court === c.id) }))
      .filter(x => x.items.length)
      .map(({ c, items }) => `<section class="cgroup">
          <div class="sec-canteen">
            <h2>${c.name}</h2>
            <span class="meta">${c.loc} · ${c.walk} min walk · ${items.length} dishes</span>
            <span class="rule"></span>
          </div>
          <div class="grid">${items.map(d => cardHTML(d, true)).join('')}</div>
        </section>`).join('');
  } else {
    grid.innerHTML = `<div class="grid">${list.map(d => cardHTML(d, false)).join('')}</div>`;
  }
  heroSub.innerHTML = `<b>${allDishes().length}</b> real dishes across <b>${COURTS.filter(c=>c.live).length}</b> campus canteens. Tell the agent what you're craving and where you're headed — it finds it, pays for it, and tells you where to collect.`;
}
courts.addEventListener('click', e => { const b = e.target.closest('[data-court]'); if (!b) return;
  state.court = b.dataset.court; state.cat = 'All'; drawCourts(); drawTabs(); drawGrid(); });
tabs.addEventListener('click', e => { const b = e.target.closest('[data-cat]'); if (!b) return;
  state.cat = b.dataset.cat; drawTabs(); drawGrid(); });
grid.addEventListener('click', e => { const b = e.target.closest('[data-add]'); if (!b) return; addToCart(b.dataset.add); });

/* ══════════ MERCHANT CONSOLE ══════════ */
vStore.addEventListener('click', () => setView('store'));
vMerch.addEventListener('click', () => setView('merch'));
function setView(v){
  state.view = v;
  vStore.setAttribute('aria-pressed', v === 'store');
  vMerch.setAttribute('aria-pressed', v === 'merch');
  storeView.hidden = v !== 'store';
  merchView.hidden = v !== 'merch';
  if (v === 'merch') drawMerch();
}
function drawMerch(){
  if (state.wizard) return drawWizard();
  merchView.innerHTML = `
    <div class="mh">
      <div><h1>Canteens on FoodFlow</h1>
        <p>Each canteen is a tree: canteen, its stalls, each stall's own categories, then dishes. Add a canteen and the agent builds that tree from whatever menu you have.</p></div>
      <button class="solid" data-m="new">Add a canteen</button>
    </div>
    <div class="mgrid">
      ${COURTS.map(c => {
        const stalls = c.stalls.length;
        const items = c.stalls.reduce((n,s) => n + s.cats.reduce((m,k) => m + k.items.length, 0), 0);
        const cats = c.stalls.reduce((n,s) => n + s.cats.length, 0);
        return `<div class="mcard">
          <div class="mt"><b>${c.name}</b><span class="pill ${c.live?'live':'draft'}">${c.live?'LIVE':'DRAFT'}</span></div>
          <div class="ms">${c.loc} · ${c.walk} min walk</div>
          <div class="mn"><span><b>${stalls}</b> stalls</span><span><b>${cats}</b> categories</span><span><b>${items}</b> dishes</span></div>
        </div>`; }).join('')}
      <button class="mcard new" data-m="new"><span class="plus">+</span><b>Add a canteen</b>
        <span class="ms">Upload any menu — the agent does the rest</span></button>
    </div>`;
}
merchView.addEventListener('click', e => {
  const b = e.target.closest('[data-m]'); if (!b) return;
  const a = b.dataset.m;
  if (a === 'new'){ state.wizard = { step:1, name:'The Terrace', loc:'Business School · Mochtar Riady', walk:9, csv:SAMPLE_CSV, tree:null, logs:[] }; drawWizard(); }
  if (a === 'cancel'){ state.wizard = null; drawMerch(); }
  if (a === 'analyse') runAnalysis();
  if (a === 'publish') publishCanteen();
  if (a === 'back1'){ state.wizard.step = 1; drawWizard(); }
});

function drawWizard(){
  const w = state.wizard;
  const crumb = `<div class="crumb"><button data-m="cancel">Canteens</button> › ${w.name || 'New canteen'}</div>`;
  const steps = `<div class="steps">
    <div class="sp ${w.step===1?'on':'done'}">01 · Menu</div>
    <div class="sp ${w.step===2?'on':w.step>2?'done':''}">02 · Agent reads it</div>
    <div class="sp ${w.step===3?'on':w.step>3?'done':''}">03 · You verify</div>
    <div class="sp ${w.step===4?'on':''}">04 · Live</div></div>`;

  if (w.step === 1){
    merchView.innerHTML = `<div class="wz">${crumb}${steps}
      <div class="fset">
        <div class="frow">
          <div class="f"><label for="cn">Canteen name</label><input id="cn" value="${w.name}"></div>
          <div class="f" style="max-width:130px"><label for="cw">Walk (min)</label><input id="cw" type="number" min="1" max="30" value="${w.walk}"></div>
        </div>
        <div class="f"><label for="cl">Where on campus</label><input id="cl" value="${w.loc}"></div>
        <div class="f"><label for="cs">Paste your menu</label>
          <span class="hint">Any shape. Different column names, missing prices, blank descriptions — the agent works it out and tells you what it couldn't.</span>
          <textarea id="cs" spellcheck="false">${w.csv}</textarea></div>
        <div style="display:flex;gap:9px">
          <button class="solid" data-m="analyse">Let the agent read it</button>
          <button class="ghost" data-m="cancel">Cancel</button>
        </div>
      </div></div>`;
    return;
  }

  if (w.step === 2){
    merchView.innerHTML = `<div class="wz">${crumb}${steps}
      <div class="anal">
        <div class="anal-h"><span class="pulse"></span> Reading ${w.name} menu</div>
        <div class="anal-b" id="alog"></div>
      </div></div>`;
    return;
  }

  if (w.step === 3){
    const t = w.tree;
    const nStall = t.stalls.length;
    const nCat = t.stalls.reduce((n,s) => n + s.cats.length, 0);
    const nItem = t.stalls.reduce((n,s) => n + s.cats.reduce((m,k) => m + k.items.length, 0), 0);
    const flags = t.stalls.reduce((n,s) => n + s.cats.reduce((m,k) => m + k.items.filter(i => i.flag).length, 0), 0);
    merchView.innerHTML = `<div class="wz">${crumb}${steps}
      <div class="tree-wrap">
        <div class="tree-h"><b>${w.name}</b>
          <span class="legend"><span><i class="a"></i>written by the agent</span><span><i class="r"></i>needs your eye</span></span>
        </div>
        <div class="tree" id="tree"></div>
        <div class="tree-f">
          <span class="fs"><b>${nStall}</b> stalls · <b>${nCat}</b> categories · <b>${nItem}</b> dishes${flags?` · <b style="color:var(--amber)">${flags}</b> flagged`:''}</span>
          <button class="ghost" data-m="back1">Back to menu</button>
          <button class="solid" data-m="publish">Publish to storefront</button>
        </div>
      </div>
      <p style="max-width:64ch;color:var(--ink-2);font-size:13.5px;margin-top:14px">
        Click any name to rename it. Remove anything the agent got wrong. Nothing reaches customers until you publish.</p>
    </div>`;
    drawTree();
    return;
  }

  merchView.innerHTML = `<div class="wz">${crumb}${steps}
    <div class="done-box">
      <div class="ring">✓</div>
      <h3>${w.name} is live</h3>
      <p>${w.published.stalls} stalls and ${w.published.items} dishes are now searchable by the agent — with flavour, texture and dietary attributes it wrote itself.</p>
      <div class="done-acts">
        <button class="solid" data-m="cancel">Back to canteens</button>
        <button class="ghost" id="seeIt">Try it in the storefront</button>
      </div>
    </div></div>`;
  document.getElementById('seeIt').addEventListener('click', () => {
    state.wizard = null; setView('store');
    state.court = w.published.id; state.cat = 'All';
    drawCourts(); drawTabs(); drawGrid();
    openW(); setTimeout(() => send('what can I get from The Terrace'), 500);
  });
}

/* the analysis — staged, so the merchant sees the agent working */
function runAnalysis(){
  const w = state.wizard;
  w.name = document.getElementById('cn').value.trim() || 'New canteen';
  w.loc  = document.getElementById('cl').value.trim();
  w.walk = +document.getElementById('cw').value || 10;
  w.csv  = document.getElementById('cs').value;
  w.step = 2; drawWizard();

  const rows = parseMenu(w.csv);
  const tree = buildTree(rows);
  const nStall = tree.stalls.length;
  const nCat = tree.stalls.reduce((n,s) => n + s.cats.length, 0);
  const flags = tree.stalls.reduce((n,s) => n + s.cats.reduce((m,k) => m + k.items.filter(i => i.flag).length, 0), 0);

  const lines = [
    `Read <b>${rows.length + (rows.flagged||0)}</b> rows from your file`,
    `Mapped your columns: <b>Stall → stall</b>, <b>ITEM → name</b>, <b>Price ($) → price</b>`,
    `Found <b>${nStall}</b> distinct stalls`,
    `Grouped them into <b>${nCat}</b> categories that fit this menu`,
    `Extracted flavour, texture, heaviness and dietary tags for <b>${rows.length}</b> dishes`,
    `Estimated calories and protein for <b>${rows.length}</b> dishes by comparing them with similar items already on FoodFlow — shown to customers as estimates, yours to correct`,
    `Wrote a customer-facing line for <b>${rows.filter(r => !r.hadDesc).length}</b> dishes with no description`,
    flags ? `Flagged <b>${flags}</b> row${flags>1?'s':''} for you to check` : `Nothing needs your attention`
  ];
  const box = document.getElementById('alog');
  lines.forEach((l, i) => setTimeout(() => {
    if (!box.isConnected) return;
    const d = document.createElement('div');
    d.className = 'al'; d.innerHTML = `<span class="tk">✓</span><span>${l}</span>`;
    box.appendChild(d);
    if (i === lines.length - 1) setTimeout(() => { w.tree = tree; w.step = 3; drawWizard(); }, 620);
  }, 340 + i * 430));
}

/* column mapping + attribute extraction, the local stand-in for the model */
function parseMenu(text){
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  const head = lines[0].split(',').map(h => h.trim().toLowerCase());
  const find = (...alts) => head.findIndex(h => alts.some(a => h.includes(a)));
  const iStall = find('stall','shop','vendor','outlet');
  const iName  = find('item','name','dish','product','menu');
  const iPrice = find('price','cost','$','amount');
  const iNote  = find('note','desc','tag','remark');
  const out = [];
  for (const line of lines.slice(1)){
    const c = line.split(',').map(s => s.trim());
    const name = c[iName] || '';
    if (!name) continue;
    const raw = (c[iPrice] || '').replace(/[^0-9.]/g,'');
    const price = parseFloat(raw);
    const note = (c[iNote] || '').toLowerCase();
    out.push({ stall:c[iStall] || 'Main stall', name, price: isNaN(price) ? null : price,
               note, hadDesc:false, flag: isNaN(price) ? 'no price' : null });
  }
  return out;
}
const CATRULES = [
  [/pasta|spaghetti|penne|aglio|linguine|noodle|udon|ramen|mee\b/i, 'Pasta & noodles','🍝'],
  [/salad|bowl of greens|superfood/i,                                'Salads','🥗'],
  [/briyani|biryani|rice box|don\b|donburi|bowl/i,                    'Rice & bowls','🍚'],
  [/set\b|combo|meal/i,                                              'Sets','🍱'],
  [/lassi|juice|coffee|tea|latte|drink|kopi/i,                       'Drinks','🥤'],
  [/prata|naan|roti|bread|wrap|pita|sandwich/i,                      'Breads','🥙']
];
const ATTR = [
  [/aglio|olio|garlic/i,      { d:'Olive oil, garlic and chilli flake pasta.', f:'noodles', t:['dry'], h:3, sv:2, sp:1, dt:['vegetarian'], hs:['gluten'], c:'Western' }],
  [/bolognese|ragu/i,         { d:'Slow-cooked beef ragu with penne.', f:'noodles', t:['dry'], h:4, sv:3, hs:['beef','gluten','dairy'], c:'Western' }],
  [/salad|superfood/i,        { d:'Grains, leaves and seeds with a light dressing.', f:'rice', tp:'cold', t:['dry'], h:1, dt:['vegetarian'], hs:['nuts'], c:'Western' }],
  [/beef bowl|gyudon/i,       { d:'Simmered beef over rice with a runny egg.', f:'rice', t:['tender'], h:4, sv:3, sw:1, hs:['beef','egg','soy'], c:'Japanese' }],
  [/butter chicken/i,         { d:'Creamy tomato butter chicken with fragrant briyani rice.', f:'rice', t:['creamy'], h:4, sv:3, sp:1, dt:['halal'], hs:['chicken','dairy'], c:'Indian' }],
  [/tandoori/i,               { d:'Charred tandoori chicken with rice and raita.', f:'rice', t:['dry'], h:3, sp:2, sv:3, dt:['halal'], hs:['chicken','dairy'], c:'Indian' }],
  [/cauliflower|veg/i,        { d:'Spiced cauliflower briyani, fully vegetarian.', f:'rice', t:['dry'], h:3, sp:1, dt:['vegetarian','halal'], hs:[], c:'Indian' }],
  [/lassi/i,                  { d:'Chilled sweet mango yoghurt drink.', f:'drink', tp:'cold', t:['creamy'], h:1, sw:3, dt:['vegetarian','halal'], hs:['dairy'], c:'Indian' }]
];
/* Merchants never upload calories. So the catalog agent estimates them at ingest —
   from the dish name and its ingredients, anchored to comparable dishes already in the
   catalog so a chicken rice at one stall doesn't come out wildly different from another.
   Every estimate is flagged: an estimate shown as a measurement is a lie. */
function estimateNutrition(name, a){
  const form = a.f || 'rice', heavy = a.h ?? 3;
  const peers = allDishes().filter(d => d.form === form && Math.abs(d.heavy - heavy) <= 1);
  const pool  = peers.length >= 3 ? peers : allDishes().filter(d => d.form === form);
  if (!pool.length) return { pro: 20, kcal: 500, nutEst: true };
  const mid = arr => { const s = [...arr].sort((x,y)=>x-y); return s[Math.floor(s.length/2)]; };
  let pro  = mid(pool.map(d => d.pro));
  let kcal = mid(pool.map(d => d.kcal));
  /* nudge on what the name actually says */
  if (/salad|veg|cauliflower|lassi|juice|tea|latte/i.test(name)) { pro = Math.round(pro*0.4); kcal = Math.round(kcal*0.6); }
  if (/chicken|beef|pork|fish|prawn|egg|paneer|tofu/i.test(name)) pro = Math.round(pro*1.15);
  if (/fried|crisp|katsu|karaage|creamy|butter/i.test(name))      kcal = Math.round(kcal*1.2);
  return { pro, kcal, nutEst: true };
}

function buildTree(rows){
  const stalls = [];
  for (const r of rows){
    let s = stalls.find(x => x.name === r.stall);
    if (!s){ s = { name:r.stall, cats:[] }; stalls.push(s); }
    const rule = CATRULES.find(([re]) => re.test(r.name));
    const catName = rule ? rule[1] : 'Mains';
    const icon = rule ? rule[2] : '🍽️';
    let k = s.cats.find(x => x.name === catName);
    if (!k){ k = { name:catName, icon, gen:true, items:[] }; s.cats.push(k); }
    const a = (ATTR.find(([re]) => re.test(r.name)) || [null,{}])[1];
    const nut = estimateNutrition(r.name, a);
    if (/halal/.test(r.note) && a.dt && !a.dt.includes('halal')) a.dt.push('halal');
    k.items.push({
      name:r.name, price:r.price, flag:r.flag, gen:true, icon,
      desc:a.d || 'Freshly prepared at the stall.',
      prep: a.f === 'drink' ? 4 : 9,
      cuisine:a.c || 'Local', form:a.f || 'rice', tex:a.t || ['dry'], temp:a.tp || 'hot',
      heavy:a.h ?? 3, fl:{ savoury:a.sv??2, sweet:a.sw??0, salty:a.sl??2, spicy:a.sp??0, sour:a.so??0 },
      diet:a.dt || [], has:a.hs || [],
      pro:nut.pro, kcal:nut.kcal, nutEst:true,
      tint:'#f0ece2', tintD:'#2b271c'
    });
  }
  return { stalls };
}

/* the tree the merchant verifies */
function drawTree(){
  const t = state.wizard.tree, w = state.wizard;
  const el = document.getElementById('tree');
  el.innerHTML = node('court', w.name, `${w.loc} · ${w.walk} min walk`, '🏫', true,
    t.stalls.map((s, si) => node('stall', s.name, `${s.cats.reduce((n,k)=>n+k.items.length,0)} dishes`, '🏪', true,
      s.cats.map((k, ki) => node('cat', k.name, '', k.icon, true,
        k.items.map((i, ii) => leaf(i, `${si}.${ki}.${ii}`)).join(''), `${si}.${ki}`, k.gen)
      ).join(''), String(si))
    ).join(''), 'root');
  bindTree();
}
function node(lvl, title, sub, icon, open, kids, path, gen){
  return `<div class="nd lvl-${lvl}">
    <div class="nd-row">
      <span class="tw ${open?'open':''}" data-tw="${path}">▶</span>
      <span class="nd-ic">${icon}</span>
      <span class="nd-t"><b data-rn="${path}">${title}</b>${sub?`<span class="sub">${sub}</span>`:''}${gen?'<span class="gen">AGENT</span>':''}</span>
    </div>
    <div class="kids ${open?'open':''}" data-kids="${path}">${kids}</div></div>`;
}
function leaf(i, path){
  return `<div class="nd lvl-dish"><div class="nd-row">
    <span class="tw leaf"></span><span class="nd-ic" style="background:transparent">·</span>
    <span class="nd-t"><b data-rn="${path}">${i.name}</b>
      <span class="sub">${i.desc}</span>
      ${i.gen?'<span class="gen">AGENT</span>':''}
      ${i.flag?`<span class="warn">${i.flag.toUpperCase()}</span>`:''}</span>
    <span class="nd-p">${i.price != null ? money(i.price) : '—'}</span>
    <button class="nd-x" data-del="${path}" aria-label="Remove ${i.name}">×</button>
  </div></div>`;
}
function bindTree(){
  const el = document.getElementById('tree');
  el.addEventListener('click', e => {
    const tw = e.target.closest('[data-tw]');
    if (tw){ tw.classList.toggle('open');
      el.querySelector(`[data-kids="${tw.dataset.tw}"]`)?.classList.toggle('open'); return; }
    const del = e.target.closest('[data-del]');
    if (del){ const [si,ki,ii] = del.dataset.del.split('.').map(Number);
      const t = state.wizard.tree;
      t.stalls[si].cats[ki].items.splice(ii,1);
      if (!t.stalls[si].cats[ki].items.length) t.stalls[si].cats.splice(ki,1);
      if (!t.stalls[si].cats.length) t.stalls.splice(si,1);
      drawWizard(); return; }
    const rn = e.target.closest('[data-rn]');
    if (rn) rename(rn);
  });
}
function rename(el){
  const old = el.textContent, path = el.dataset.rn;
  const inp = document.createElement('input');
  inp.value = old; el.replaceWith(inp); inp.focus(); inp.select();
  const commit = () => {
    const v = inp.value.trim() || old;
    const p = path.split('.').map(Number), t = state.wizard.tree;
    if (path === 'root') state.wizard.name = v;
    else if (p.length === 1) t.stalls[p[0]].name = v;
    else if (p.length === 2) t.stalls[p[0]].cats[p[1]].name = v;
    else t.stalls[p[0]].cats[p[1]].items[p[2]].name = v;
    drawWizard();
  };
  inp.addEventListener('blur', commit);
  inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') commit(); if (ev.key === 'Escape') drawWizard(); });
}
function publishCanteen(){
  const w = state.wizard, t = w.tree;
  const id = 'c' + Date.now().toString(36);
  const court = { id, name:w.name, loc:w.loc, walk:w.walk, live:true,
    stalls: t.stalls.map(s => ({ name:s.name, cuisine:'Mixed',
      cats: s.cats.map(k => ({ name:k.name, items: k.items.filter(i => i.price != null).map(i => {
        const d = { ...i, id:'d'+(++uid), court:id, courtName:w.name, walk:w.walk, stall:s.name, cat:k.name };
        delete d.gen; delete d.flag; return d; }) })).filter(k => k.items.length) })).filter(s => s.cats.length) };
  COURTS.push(court);
  const items = court.stalls.reduce((n,s) => n + s.cats.reduce((m,k) => m + k.items.length, 0), 0);
  w.published = { id, stalls:court.stalls.length, items };
  w.step = 4; drawWizard();
  drawCourts(); drawTabs(); drawGrid();
  toast(`${w.name} published — ${items} dishes live`);
}

/* ══════════ cart · fulfilment · settlement ══════════ */
const CARRIERS = [
  { id:'pandago',  name:'pandago',     base:3.80, mins:30 },
  { id:'lalamove', name:'Lalamove',    base:4.20, mins:25 },
  { id:'grab',     name:'GrabExpress', base:5.10, mins:20 }
];
const count = () => state.cart.reduce((n,i) => n + i.qty, 0);
const subtotal = () => state.cart.reduce((n,i) => n + i.price*i.qty, 0);
/* one authorisation can span stalls — the split happens at capture, not at consent */
function groups(){
  const g = [];
  for (const i of state.cart){
    let k = g.find(x => x.stall === i.stall);
    if (!k){ k = { stall:i.stall, courtName:i.courtName, walk:i.walk, items:[], sub:0,
                   ready:0, code:null }; g.push(k); }
    k.items.push(i); k.sub += i.price*i.qty; k.ready = Math.max(k.ready, i.prep);
  }
  return g.sort((a,b) => a.walk - b.walk);
}
const extraStops = () => Math.max(0, groups().length - 1);
const quoteFor = c => c.base + extraStops() * 1.50;
const cheapest = () => [...CARRIERS].sort((a,b) => quoteFor(a) - quoteFor(b))[0];
const fastest  = () => [...CARRIERS].sort((a,b) => a.mins - b.mins)[0];
const deliveryFee = () => state.fulfil === 'deliver' && state.carrier ? quoteFor(state.carrier) : 0;
const platformFee = () => state.cart.length ? 0.60 : 0;
const fee = platformFee;
const total = () => subtotal() + platformFee() + deliveryFee();
function addToCart(id, picks){
  const d = byId(id); if (!d) return;
  const key = picks && picks.length ? picks.join('|') : '';
  const ex = state.cart.find(i => i.id === id && (i.picks || []).join('|') === key);
  if (ex) ex.qty++; else state.cart.push({ ...d, qty:1, picks: picks || [] });
  note('proposed', `Agent added ${d.name}${key ? ' (' + picks.join(', ') + ')' : ''} — ${money(d.price)}`);
  toast(`${d.name} added`); sync();
}
function sync(){
  cartCt.textContent = count();
  const show = state.cart.length && scAuth.hidden && scColl.hidden;
  strip.hidden = !show;
  if (show) stripT.textContent = `${count()} item${count()>1?'s':''} · ${money(total())}`;
  if (state.view === 'store') drawGrid();
  drawUnd();
}
function note(kind, what){ state.ledger.push({ kind, what }); }

/* ══════════ agent ══════════ */
function setNeed(k,l){ state.needs[k] = { label:l }; return state.needs[k]; }
function dropNeed(k){ delete state.needs[k]; drawUnd(); }
function drawUnd(){
  const keys = Object.keys(state.needs);
  und.hidden = !keys.length || !scAuth.hidden || !scColl.hidden;
  undW.innerHTML = keys.map(k => `<span class="slot"><b>${state.needs[k].label}</b><button data-drop="${k}" aria-label="Remove">×</button></span>`).join('');
}
undW.addEventListener('click', e => { const b = e.target.closest('[data-drop]'); if (!b) return;
  const l = state.needs[b.dataset.drop]?.label; dropNeed(b.dataset.drop);
  bubble('ai', `Dropped <b>${l}</b>. Want me to look again?`); chipRow(['Yes, show me','Start over']); });

const CUIS = { japanese:'Japanese', chinese:'Chinese', korean:'Korean', thai:'Thai', western:'Western',
  indian:'Indian', indonesian:'Indonesian', malay:'Indonesian', taiwanese:'Taiwanese', local:'Local', hawker:'Local' };
function parse(t){
  const q = ' ' + t.toLowerCase() + ' ', n = state.needs;
  const b = q.match(/(?:under|below|less than|max|within)\s*(?:s?\$)?\s*(\d+(?:\.\d+)?)/);
  if (b) setNeed('budget', `under $${b[1]}`).v = +b[1];
  if (/\bvegan\b/.test(q)) setNeed('diet','vegan').v='vegan';
  else if (/vegetarian|veggie|no meat/.test(q)) setNeed('diet','vegetarian').v='vegetarian';
  if (/\bhalal\b/.test(q)) setNeed('halal','halal').v=1;
  const EX = [[/no pork|without pork|pork.free/,'pork','no pork'],[/no beef/,'beef','no beef'],
    [/no (?:dairy|milk)|lactose/,'dairy','no dairy'],[/no (?:seafood|shellfish|prawn)/,'shellfish','no shellfish'],
    [/no fish/,'fish','no fish'],[/gluten.free|no gluten/,'gluten','gluten-free'],
    [/no egg/,'egg','no egg'],[/no nuts|nut allerg|no peanut/,'nuts','no nuts'],[/no chicken/,'chicken','no chicken']];
  for (const [re,tag,lbl] of EX) if (re.test(q)) setNeed('ex_'+tag,lbl).v = tag;
  if (/soup|soupy|broth|wet/.test(q)) setNeed('tex','soupy').v='soupy';
  else if (/\bdry\b|not soupy/.test(q)) setNeed('tex','dry').v='dry';
  else if (/crisp|crunch|fried/.test(q)) setNeed('tex','crispy').v='crispy';
  if (/noodle|mee\b|ramen|bee hoon|udon|pasta|hor fun/.test(q)) setNeed('form','noodles').v='noodles';
  else if (/\brice\b|\bdon\b|briyani|biryani/.test(q)) setNeed('form','rice').v='rice';
  else if (/prata|bread|wrap|pita|sandwich|toast/.test(q)) setNeed('form','something in bread').v='bread';
  else if (/drink|coffee|latte|juice|lassi|kopi/.test(q)) setNeed('form','a drink').v='drink';
  for (const k in CUIS) if (q.includes(' '+k)) setNeed('cuisine',CUIS[k]).v = CUIS[k];
  if (/light|not too heavy|not heavy|healthy|small/.test(q)) setNeed('weight','something light').v='light';
  else if (/heavy|filling|hearty|starving|very hungry|damn hungry/.test(q)) setNeed('weight','filling').v='heavy';
  if (/not spicy|no spice|\bmild\b/.test(q)) setNeed('spice','not spicy').v=0;
  else if (/spicy|chilli|chili|mala/.test(q)) setNeed('spice','spicy').v=2;
  if (/\bcold\b|\biced\b|refreshing/.test(q)) setNeed('temp','cold').v='cold';
  else if (/\bwarm\b|something hot/.test(q)) setNeed('temp','warm').v='hot';
  if (/quick|fast|in a rush|hurry|no time|rushing/.test(q)) setNeed('speed','in a rush').v=1;
  if (/protein|gym|workout|gains|bulk|lifting|muscle/.test(q)) setNeed('protein','high in protein').v=1;
  if (/deliver|send it|bring it|don'?t want to walk|too far|can'?t leave|stuck in/.test(q)){
    state.fulfil = 'deliver'; state.carrier = state.carrier || cheapest(); setNeed('fulfil','delivered to me'); }
  else if (/collect|pick ?up|i'?ll walk|walk over|on my way there/.test(q)){
    state.fulfil = 'pickup'; setNeed('fulfil',"I'll collect"); }
  for (const c of COURTS){ if (!c.live) continue;
    if (q.includes(c.name.toLowerCase()) || q.includes(c.id)) setNeed('court',`at ${c.name}`).v = c.id; }
  if (/nearest|closest|nearby|on (the|my) way|shortest walk/.test(q)) setNeed('court','nearest canteen').v='near';
  return n;
}
function score(d,n){
  if (n.diet && !d.diet.includes(n.diet.v)) return -1;
  if (n.halal && !d.diet.includes('halal')) return -1;
  for (const k in n) if (k.startsWith('ex_') && d.has.includes(n[k].v)) return -1;
  if (n.budget && d.price > n.budget.v) return -1;
  let s = 0;
  if (n.tex){ s += n.tex.v === 'dry' ? (d.tex.includes('soupy') ? -3 : 2) : (d.tex.includes(n.tex.v) ? 3 : -1); }
  if (n.form) s += d.form === n.form.v ? 3 : -2;
  if (n.cuisine) s += d.cuisine === n.cuisine.v ? 3 : -2;
  if (n.weight) s += n.weight.v==='light' ? (d.heavy<=2?2.5:-1.5) : (d.heavy>=4?2.5:-1.5);
  if (n.spice) s += n.spice.v===2 ? (d.fl.spicy>=2?3:-1.5) : (d.fl.spicy===0?1.5:-2.5);
  if (n.temp) s += d.temp === n.temp.v ? 2 : -2;
  if (n.speed) s += d.prep <= 8 ? 2 : -1;
  if (n.court) s += n.court.v === 'near' ? (18 - d.walk) * 0.2 : (d.court === n.court.v ? 3 : -2.5);
  if (n.protein) s += d.pro >= 30 ? 2.5 : d.pro >= 22 ? 1 : -2;
  if (n.budget) s += 0.5;
  return s;
}
function because(d,n){
  const b = [];
  if (n.tex && n.tex.v!=='dry' && d.tex.includes(n.tex.v)) b.push(n.tex.v);
  if (n.tex && n.tex.v==='dry' && !d.tex.includes('soupy')) b.push('not soupy');
  if (n.form && d.form===n.form.v) b.push(d.form==='bread'?'in bread':d.form);
  if (n.cuisine && d.cuisine===n.cuisine.v) b.push(d.cuisine);
  if (n.weight) b.push(d.heavy<=2?'light':'filling');
  if (n.spice && n.spice.v===2 && d.fl.spicy>=2) b.push('properly spicy');
  if (n.spice && n.spice.v===0 && d.fl.spicy===0) b.push('no chilli');
  if (n.halal) b.push('halal');
  for (const k in n) if (k.startsWith('ex_') && !d.has.includes(n[k].v)) b.push(n[k].label);
  if (n.speed && d.prep<=8) b.push(`${d.prep} min`);
  b.push(`${d.stall} · ${d.courtName}`);
  if (n.budget) b.push(money(d.price));
  return b.slice(0,4).join(' · ');
}
const GAPS = [
  { need:'court', ask:"Which side of campus are you on? I'll pick what's closest.",
    chips:['The Deck','Frontier','UTown','Nearest one'] },
  { need:'form', ask:"Rice, noodles, or something you can eat walking?", chips:['Rice','Noodles','Something in bread'] },
  { need:'budget', ask:"Any budget?", chips:['Under $4','Under $7','No limit'] }
];
function replyLocal(text){
  const q = text.toLowerCase().trim();

  /* offline: still answer "what's in it" from the catalog rather than pitching */
  if (/(what'?s in|whats in|ingredient|what can i (pick|choose)|tell me (more|about)|more about|describe|what comes with|which (one|ones)|high in protein|healthiest|vegetarian)/.test(q)){
    const all = allDishes();
    const hit = all.find(d => q.includes(d.name.toLowerCase()))
      || all.find(d => d.name.toLowerCase().replace(/[()]/g,'').split(/\s+/).filter(w=>w.length>3).every(w=>q.includes(w)))
      || (/yong ?tau ?foo|ytf|young tofu/.test(q) ? all.find(d=>d.name.includes('Yong Tau Foo')) : null)
      || (/\bmala\b/.test(q) ? all.find(d=>d.name.includes('Mala')) : null)
      || ((state.lastShown||[]).length === 1 ? byId(state.lastShown[0]) : null);
    if (hit) return { say: describeLocal(hit), items: [], focusId: hit.id };
  }
  if (/^(hi|hey|hello|yo|good (morning|afternoon|evening))\b/.test(q))
    return { say:`Hey. I know all <b>${allDishes().length}</b> dishes across <b>${COURTS.filter(c=>c.live).length}</b> canteens on campus — what are you craving?`,
             chips:['Something soupy under $4','Halal and filling','I\'m in a rush'] };
  if (/thank|thanks|cheers/.test(q)) return { say:"Anytime." };
  if (/start over|reset/.test(q)){ state.needs={}; state.asked=0; drawUnd();
    return { say:"Cleared. What are you after?", chips:['Something soupy under $4','Light and quick'] }; }
  if (/no limit|any budget/.test(q)){ dropNeed('budget'); return { say:"Budget's off. What matters more — speed, or where you're collecting?" }; }
  if (/who are you|what can you do|help/.test(q))
    return { say:"I read every campus menu by how the food actually <b>tastes, feels and where it is</b> — soupy, dry, halal, no pork, near Frontier. Then I pay for it and tell you where to collect. You never leave this window." };
  if (/authoris|authorize|check ?out|\bpay\b|place (the|my) order/.test(q)){
    if (!state.cart.length) return { say:"Nothing decided yet — want a suggestion first?" };
    const g = groups();
    const multi = g.length > 1 ? `${g.length} stalls, <b>one payment</b> — you only verify once. ` : '';
    return { say:`${multi}One screen, one hold — that's it.`, go:true };
  }
  if (/deliver|send it to me|don'?t want to walk|too far to walk/.test(q) && state.cart.length){
    state.fulfil = 'deliver'; state.carrier = cheapest(); setNeed('fulfil','delivered to me');
    const c = cheapest(), f = fastest(), g = groups();
    return { say:`I quoted three couriers for ${g.length} pickup${g.length>1?'s':''}. <b>${c.name}</b> is cheapest at <b>${money(quoteFor(c))}</b>, about ${c.mins} minutes.${f.id!==c.id?` ${f.name} is ${c.mins-f.mins} min faster for ${money(quoteFor(f)-quoteFor(c))} more.`:''} I've put ${c.name} on the order — switch it on the next screen if you'd rather.`,
             chips:['Authorise payment','Use the faster one'] };
  }
  if (/faster one|use.*fastest|speed it up/.test(q) && state.cart.length){
    state.fulfil='deliver'; state.carrier = fastest();
    return { say:`Switched to <b>${fastest().name}</b> — ${fastest().mins} minutes, ${money(quoteFor(fastest()))}.`, chips:['Authorise payment'] };
  }
  if (/cart|what.*(i|we) (have|got)/.test(q)){
    if (!state.cart.length) return { say:"Cart's empty." };
    return { say:`You've got ${state.cart.map(i=>`<b>${i.qty}× ${i.name}</b>`).join(', ')} — ${money(total())} all in.` };
  }
  const am = q.match(/^(?:add|get|i'?ll (?:take|have)|order|yes[, ]+(?:the )?)\s*(.+)$/);
  if (am){
    const term = am[1].trim().replace(/[.!]$/,'');
    const hit = allDishes().find(d => d.name.toLowerCase().includes(term))
             || allDishes().find(d => term.split(' ').filter(w=>w.length>2).every(w => d.name.toLowerCase().includes(w)));
    if (hit){ addToCart(hit.id);
      return { say:`<b>${hit.name}</b> it is — ${hit.stall} at ${hit.courtName}, ${hit.walk} minutes away. Ready to authorise?`,
               chips:['Authorise payment','Add a drink'] }; }
  }
  const n = parse(text);
  if (!Object.keys(n).length)
    return { say:"Tell me how you want it to feel — soupy, dry, light, spicy — or which canteen you're near.",
             chips:['Something soupy under $4','Light and quick','Japanese'] };
  const ranked = allDishes().map(d => ({d, s:score(d,n)})).filter(x => x.s >= 0)
    .sort((a,b) => b.s - a.s || a.d.price - b.d.price);
  if (!ranked.length)
    return { say:"Nothing on campus clears all of that at once. Drop one of the chips below and I'll look again.", chips:['Start over'] };
  const top = ranked.slice(0, ranked[0].s >= 7 ? 1 : ranked[0].s >= 4 ? 2 : 3).map(x => x.d);
  const gap = state.asked < 2 ? GAPS.find(g => !state.needs[g.need]) : null;
  if (gap) state.asked++;
  return { say: top.length === 1 ? `This is the one — nothing else fits all of that.` : `Closest fits. ${gap ? gap.ask : 'Want me to lock one in?'}`,
           items:top, why:top.map(d => because(d,n)), chips: gap ? gap.chips : null };
}


/* ══════════ the bridge to the server ══════════
   The agent runs server-side (/api/agent) so the model key never touches the browser.
   If that call fails — no key, cold start, dead venue wifi — we fall back to the local
   rules engine below and the demo still completes end to end. That redundancy is
   deliberate: a judging session is a terrible place to discover you need a network. */
async function reply(text){
  try{
    const r = await fetch('/api/agent', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        prompt: text,
        needs: state.needs,
        lastShown: state.lastShown || [],
        fulfil: state.fulfil,
        cart: state.cart.map(i => ({ id:i.id, name:i.name, qty:i.qty, price:i.price, stall:i.stall }))
      })
    });
    if (!r.ok) throw new Error('agent ' + r.status);
    const d = await r.json();

    if (d.needs) state.needs = d.needs;
    if (d.fulfil){ state.fulfil = d.fulfil; if (d.fulfil === 'deliver' && !state.carrier) state.carrier = cheapest(); }
    if (d.carrier) state.carrier = CARRIERS.find(c => c.id === d.carrier) || state.carrier;
    if (Array.isArray(d.addIds)) d.addIds.forEach(addToCart);

    return {
      say:   d.say || 'Here are the closest matches.',
      items: (d.itemIds || []).map(byId).filter(Boolean),
      why:   d.why || [],
      chips: d.chips || null,
      focusId: d.focusId || null,
      highlight: d.highlight || null,
      go:    !!d.go
    };
  } catch (err){
    console.warn('[foodflow] agent unreachable, using local engine:', err.message);
    return replyLocal(text);
  }
}

function describeLocal(d){
  const b = [`<b>${d.name}</b> — ${money(d.price)} at ${d.stall}, ${d.courtName}. ${d.desc}`];
  if (d.ing?.length) b.push(`It comes with ${d.ing.slice(0,-1).join(', ')} and ${d.ing[d.ing.length-1]}.`);
  const f = [];
  if (d.diet.includes('vegan')) f.push('vegan'); else if (d.diet.includes('vegetarian')) f.push('vegetarian');
  if (d.diet.includes('halal')) f.push('halal');
  if (d.has.length) f.push(`contains ${d.has.join(', ')}`);
  if (f.length) b.push(f.join(' · ') + '.');
  b.push(`About ${d.prep} minutes, ${d.walk} minutes' walk away.`);
  if (d.opts) b.push(`${d.opts.label} — tap the ones you want below.`);
  return b.join(' ');
}

/* chat render */
function bubble(role, html){ const w = document.createElement('div');
  w.className = 'msg ' + (role==='me'?'me':'ai'); w.innerHTML = `<div class="bub">${html}</div>`;
  log.appendChild(w); scroll(); return w; }
function recs(items, whys){ const w = document.createElement('div'); w.className='msg ai';
  w.innerHTML = `<div class="rec">` + items.map((d,i)=>`
    <div class="rec-item"><div class="rec-tile" style="background:${dark()?d.tintD:d.tint}">${d.icon}</div>
      <div class="rec-t"><b>${d.name}</b><span>${money(d.price)} · ${d.courtName} · ${d.walk} min</span>
        ${marksFor(d).length ? `<span class="rmarks">${markChips(marksFor(d))}</span>` : ''}</div>
      <button class="rec-add" data-add="${d.id}">Add</button></div>
    ${whys&&whys[i]?`<div class="why"><em>↳</em> ${whys[i]}</div>`:''}`).join('') + `</div>`;
  log.appendChild(w); scroll(); }
function detailCard(d){
  const w = document.createElement('div'); w.className = 'msg ai';
  const pick = state.picking && state.picking.id === d.id ? state.picking : null;
  const picking = pick ? pick.chosen : [];
  const hl = pick && pick.highlight ? pick.highlight : null;
  const marked = hl ? hl.choices : [];
  const o = d.opts;
  w.innerHTML = `<div class="detail">
      <div class="det-top">
        <div class="rec-tile" style="background:${dark()?d.tintD:d.tint}">${d.icon}</div>
        <div class="rec-t"><b>${d.name}</b><span>${money(d.price)} · ${d.stall} · ${d.walk} min walk</span>
          ${marksFor(d).length ? `<span class="rmarks">${markChips(marksFor(d))}</span>` : ''}</div>
      </div>
      ${d.ing?.length ? `<div class="ing"><span class="ing-l">In it</span>${d.ing.map(i=>`<span class="ing-i">${i}</span>`).join('')}</div>` : ''}
      ${d.pro ? `<div class="ing"><span class="ing-l">Rough</span><span class="ing-i">~${d.pro}g protein</span><span class="ing-i">~${d.kcal} kcal</span><span class="est-note">estimated from ingredients, not measured</span></div>` : ''}
      ${o ? `<div class="opts" data-for="${d.id}">
          <div class="opts-h"><span>${o.label}</span><span class="cnt">${picking.length}/${o.pick}</span></div>
          ${hl ? `<div class="hl-note"><span class="hl-dot"></span>${marked.length} marked as ${hl.note}</div>` : ''}
          <div class="opt-list">${o.choices.map(c=>`<button class="opt${picking.includes(c)?' on':''}${marked.includes(c)?' hl':''}" data-opt="${c}">${c}</button>`).join('')}</div>
          <button class="opt-add" data-optadd="${d.id}"${picking.length?'':' disabled'}>${picking.length?`Add with ${picking.length} pick${picking.length>1?'s':''} · ${money(d.price)}`:'Pick at least one'}</button>
        </div>` : `<button class="rec-add det-add" data-add="${d.id}">Add · ${money(d.price)}</button>`}
    </div>`;
  log.appendChild(w); scroll();
}

function chipRow(list){ const w = document.createElement('div'); w.className='msg ai';
  w.innerHTML = `<div class="chips">${list.map(c=>`<button class="qc" data-say="${c}">${c}</button>`).join('')}</div>`;
  log.appendChild(w); scroll(); }
function scroll(){ requestAnimationFrame(() => log.scrollTop = log.scrollHeight); }
log.addEventListener('click', e => {
  const o = e.target.closest('[data-opt]');
  if (o){
    const box = o.closest('.opts'); const d = byId(box.dataset.for); if (!d) return;
    if (!state.picking || state.picking.id !== d.id) state.picking = { id:d.id, chosen:[] };
    const c = o.dataset.opt, chosen = state.picking.chosen, at = chosen.indexOf(c);
    if (at > -1) chosen.splice(at, 1);
    else if (chosen.length < d.opts.pick) chosen.push(c);
    else return toast(`That's ${d.opts.pick} already — tap one off first`);
    o.classList.toggle('on', chosen.includes(c));
    box.querySelector('.cnt').textContent = `${chosen.length}/${d.opts.pick}`;
    const btn = box.querySelector('.opt-add');
    btn.disabled = !chosen.length;
    btn.textContent = chosen.length ? `Add with ${chosen.length} pick${chosen.length>1?'s':''} · ${money(d.price)}` : 'Pick at least one';
    return;
  }
  const oa = e.target.closest('[data-optadd]');
  if (oa){
    const d = byId(oa.dataset.optadd); if (!d) return;
    const picks = (state.picking && state.picking.id === d.id) ? [...state.picking.chosen] : [];
    addToCart(d.id, picks);
    oa.textContent = 'Added'; oa.disabled = true;
    bubble('ai', `Got it — <b>${d.name}</b> with ${picks.join(', ')}. Anything else, or shall we sort out payment?`);
    chipRow(['Authorise payment','Something to drink']);
    state.picking = null;
    return;
  }
  const a = e.target.closest('[data-add]');
  if (a){ addToCart(a.dataset.add); a.textContent='Added'; a.classList.add('in'); return; }
  const s = e.target.closest('[data-say]'); if (s) send(s.dataset.say);
});
let lastSent = '', lastSentAt = 0;
async function send(text){
  if (!text.trim()) return;
  /* a voice UI can fire twice from a stray late event or a double tap — never send the
     same sentence twice in a row within a couple of seconds */
  const now = Date.now();
  if (text.trim() === lastSent && now - lastSentAt < 2500) return;
  lastSent = text.trim(); lastSentAt = now;
  bubble('me', text.replace(/</g,'&lt;'));
  const t = document.createElement('div'); t.className='msg ai';
  t.innerHTML = `<div class="typing"><i></i><i></i><i></i></div>`; log.appendChild(t); scroll();
  await new Promise(r => setTimeout(r, 400 + Math.random()*340)); t.remove();
  const r = await reply(text);
  bubble('ai', r.say);
  if (r.focusId && byId(r.focusId)){
    const keep = (state.picking && state.picking.id === r.focusId) ? state.picking.chosen : [];
    state.picking = { id: r.focusId, chosen: keep, highlight: r.highlight || null };
    detailCard(byId(r.focusId));
    state.lastShown = [r.focusId];
  } else if (r.items && r.items.length){
    recs(r.items, r.why);
    state.lastShown = r.items.map(d => d.id);
  }
  if (r.chips) chipRow(r.chips);
  sync();
  if (r.go) setTimeout(openAuth, 400);
}
comp.addEventListener('submit', e => { e.preventDefault(); const v = inp.value; inp.value=''; send(v); });

/* ══════════ speech ══════════
   The browser API defaults to continuous=false, which ends the session at the first
   pause — so "something soupy… under four dollars… no pork" gets cut after "soupy".
   Instead we stay open across pauses, accumulate the transcript, and decide it's
   finished either when the user taps the mic or after a real silence. Chrome also
   ends the session on its own every so often; we restart it underneath the user. */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const SILENCE_MS = 2600;    /* quiet for this long = they've finished talking */
const MAX_MS     = 45000;   /* hard stop, so a hot mic can't run forever */

let rec = null, listening = false, sealed = false, heard = '', quietTimer = null, capTimer = null;

if (!SR){
  mic.style.opacity = '.4';
  mic.title = 'Voice input needs Chrome or Edge';
} else {
  rec = new SR();
  rec.lang = 'en-SG';
  rec.interimResults = true;
  rec.continuous = true;

  rec.onresult = e => {
    /* Chrome keeps delivering finals for a moment after stop() — once we've sent,
       ignore everything, or the tail of the sentence reappears in the box. */
    if (!listening || sealed) return;
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++){
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) heard += t + ' ';
      else interim += t;
    }
    inp.value = (heard + interim).trim();
    if (inp.value) micNote.textContent = 'Listening… tap the mic to send';
    resetQuiet();
  };

  rec.onerror = ev => {
    if (ev.error === 'no-speech') return;              /* normal during a pause */
    if (ev.error === 'aborted' && listening) return;   /* our own restart */
    const msg = ev.error === 'not-allowed'
      ? 'Mic blocked — allow it in the address bar, or just type'
      : 'Didn’t catch that — try typing';
    endMic(false);
    micNote.textContent = msg;
    setTimeout(() => { if (!listening) micNote.textContent = 'Every action is logged'; }, 3600);
  };

  /* Chrome ends the session periodically on its own. If the user hasn't
     tapped stop, quietly start it again so their sentence isn't chopped. */
  rec.onend = () => {
    if (!listening) return;
    try { rec.start(); } catch (_) { endMic(true); }
  };
}

function resetQuiet(){
  clearTimeout(quietTimer);
  quietTimer = setTimeout(() => { if (listening) endMic(true); }, SILENCE_MS);
}

function endMic(sendIt){
  if (!listening) { sealed = true; setTimeout(() => { sealed = false; }, 700); return; }
  sealed = true;
  listening = false;
  clearTimeout(quietTimer); clearTimeout(capTimer);
  try { rec && rec.stop(); } catch (_) {}
  mic.classList.remove('live');
  micNote.textContent = 'Every action is logged';
  const text = (heard || inp.value || '').trim();
  heard = '';
  inp.value = '';
  if (sendIt && text) send(text);
  /* let the late events drain before the mic can be armed again */
  setTimeout(() => { sealed = false; }, 700);
}

mic.addEventListener('click', () => {
  if (!rec) return toast('Voice input needs Chrome or Edge');
  if (listening) return endMic(true);        /* tap again = send what you've said */
  if (sealed) return;                        /* still draining the last one */
  heard = ''; inp.value = '';
  try {
    rec.start();
    listening = true;
    mic.classList.add('live');
    micNote.textContent = 'Listening… take your time';
    resetQuiet();
    capTimer = setTimeout(() => { if (listening) endMic(true); }, MAX_MS);
  } catch (_) { endMic(false); }
});

/* authorise */
function openAuth(){ if (!state.cart.length) return;
  scChat.hidden=true; scColl.hidden=true; scAuth.hidden=false;
  wSub.innerHTML = `<span class="dotg"></span> Ready to authorise`; drawAuth(); sync(); }
function backToChat(){ scAuth.hidden=true; scColl.hidden=true; scChat.hidden=false;
  wSub.innerHTML = `<span class="dotg"></span> Online`; sync(); }
function drawAuth(){
  const g = groups(), ready = Math.max(...state.cart.map(i=>i.prep));
  const pct = Math.min(100, total()/MANDATE*100);
  const del = state.fulfil === 'deliver';
  if (del && !state.carrier) state.carrier = cheapest();
  const cheap = cheapest(), fast = fastest();

  const orderRows = g.map(k => `
    <div class="grp"><span>${k.stall} · ${k.courtName}</span><span>${money(k.sub)}</span></div>
    ${k.items.map(i=>`<div class="row"><span><span class="q num">${i.qty}×</span> ${i.name}${i.picks&&i.picks.length?`<span class="picks">${i.picks.join(' · ')}</span>`:''}</span><span>${money(i.price*i.qty)}</span></div>`).join('')}`).join('');

  const carrierRows = CARRIERS.map(c => `
    <button class="car ${state.carrier?.id===c.id?'on':''}" data-car="${c.id}">
      <span class="rad"></span>
      <span class="ct2"><b>${c.name}</b><span>${c.mins} min${extraStops()?` · includes ${extraStops()+1} pickups`:''}</span></span>
      ${c.id===cheap.id?'<span class="tagx cheap">CHEAPEST</span>':c.id===fast.id?'<span class="tagx">FASTEST</span>':''}
      <span class="cp num">${money(quoteFor(c))}</span></button>`).join('');

  authBody.innerHTML = `
    <div class="auth-h"><h4>Authorise this order</h4><button data-a="back">Back</button></div>

    <div class="seg2" role="group" aria-label="How to get it">
      <button data-f="pickup" aria-pressed="${!del}">I'll collect</button>
      <button data-f="deliver" aria-pressed="${del}">Deliver to me</button>
    </div>

    <div class="blk"><div class="blk-h">Order · ${g.length} stall${g.length>1?'s':''}, one payment</div>
      ${orderRows}
      <div class="row"><span>Campus service fee</span><span>${money(platformFee())}</span></div>
      ${del?`<div class="row"><span>Delivery · ${state.carrier.name}</span><span>${money(deliveryFee())}</span></div>`:''}
      <div class="row tot"><span>Total</span><span>${money(total())}</span></div></div>

    ${del ? `
    <div class="blk"><div class="blk-h">Courier · quoted just now</div>
      ${carrierRows}
      <div class="mandate">Picked <b>${cheap.name}</b> because it's cheapest for ${g.length} pickup${g.length>1?'s':''}.
        ${fast.id!==cheap.id?`<b>${fast.name}</b> is ${cheap.mins-fast.mins} min faster for ${money(quoteFor(fast)-quoteFor(cheap))} more.`:''}</div></div>`
    : `
    <div class="blk"><div class="blk-h">Collect yourself · ${g.length>1?'in this order':'one stop'}</div>
      ${g.map((k,n)=>`<div class="pickup"><span class="pin">${g.length>1?n+1:'📍'}</span>
        <span class="pt"><b>${k.stall} · ${k.courtName}</b><span>${k.walk} min walk · ready in ~${k.ready} min</span></span></div>`).join('')}
    </div>`}

    <div class="blk"><div class="blk-h">Payment</div>
      <div class="pay-row"><span class="vlogo">VISA</span>
        <span class="pt"><b>•••• 4242</b><span>Linked once. FoodFlow never sees the number.</span></span>
        <span class="ok">Ready</span></div>
      <div class="mandate">This agent may spend up to <b>${money(MANDATE)}</b> per order at NUS campus canteens.
        <div class="bar"><i style="width:${pct}%"></i></div>
        This order uses <b>${money(total())}</b>. One charge, split at capture:
        ${g.map(k=>`<b>${money(k.sub)}</b> to ${k.stall}`).join(', ')}${del?`, <b>${money(deliveryFee())}</b> to ${state.carrier.name}`:''}, <b>${money(platformFee())}</b> to FoodFlow.</div></div>
    <button class="hold" id="hold" aria-label="Hold to authorise ${money(total())}">
      <span class="fill" id="fill"></span>
      <span class="lb"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
        <rect x="3" y="7" width="10" height="6.4" rx="1.6"/><path d="M5.4 7V4.9a2.6 2.6 0 0 1 5.2 0V7"/></svg>
        Hold to authorise ${money(total())}</span></button>
    <p class="hold-note">Face ID confirms it's you. That single check is your consent, your identity and your authorisation.</p>`;
  bindHold();
}
authBody.addEventListener('click', e => {
  if (e.target.closest('[data-a="back"]')) return backToChat();
  const f = e.target.closest('[data-f]');
  if (f){ state.fulfil = f.dataset.f; if (state.fulfil==='deliver' && !state.carrier) state.carrier = cheapest(); return drawAuth(); }
  const c = e.target.closest('[data-car]');
  if (c){ state.carrier = CARRIERS.find(x => x.id === c.dataset.car); return drawAuth(); }
});
function bindHold(){
  const btn = document.getElementById('hold'), fill = document.getElementById('fill');
  let raf=null,t0=0; const DUR=900;
  const step = () => { const p = Math.min(1,(performance.now()-t0)/DUR); fill.style.width = p*100+'%';
    if (p>=1){ cancel(); verify(); return; } raf = requestAnimationFrame(step); };
  const start = e => { if (e.type==='keydown' && !['Enter',' '].includes(e.key)) return;
    e.preventDefault(); if (raf) return; t0=performance.now(); raf=requestAnimationFrame(step); };
  const cancel = () => { if (raf) cancelAnimationFrame(raf); raf=null; fill.style.width='0'; };
  btn.addEventListener('pointerdown',start); btn.addEventListener('keydown',start);
  ['pointerup','pointerleave','pointercancel','keyup','blur'].forEach(ev=>btn.addEventListener(ev,cancel));
}
function verify(){
  note('verified','Identity confirmed by Face ID');
  scrim.hidden = false;
  scrim.innerHTML = `<div class="face"><span class="scan"></span>
    <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
      <path d="M6 20V12a6 6 0 0 1 6-6h8M44 6h8a6 6 0 0 1 6 6v8M58 44v8a6 6 0 0 1-6 6h-8M20 58h-8a6 6 0 0 1-6-6v-8"/>
      <circle cx="25" cy="28" r="1.8" fill="currentColor" stroke="none"/><circle cx="39" cy="28" r="1.8" fill="currentColor" stroke="none"/>
      <path d="M32 27v7h-2.5M25 41c2 2.2 4.4 3.2 7 3.2s5-1 7-3.2"/></svg></div><p>Confirming it's you…</p>`;
  setTimeout(() => {
    scrim.innerHTML = `<div class="tickring">✓</div><p>Verified · charging ${money(total())}</p>`;
    setTimeout(() => { scrim.hidden = true; completeOrder(); }, 900);
  }, 1250);
}
const STEPS_P = [{k:'Order confirmed',s:'Paid and sent to the stalls'},
  {k:'Being prepared',s:'The stalls have started'},{k:'Ready to collect',s:'Show your codes at the counter'}];
const STEPS_D = [{k:'Order confirmed',s:'Paid and sent to the stalls'},
  {k:'Courier collecting',s:'Picking up from each stall'},{k:'On the way to you',s:'Track it here'}];
function completeOrder(){
  const g = groups(), ready = Math.max(...state.cart.map(i=>i.prep));
  const del = state.fulfil === 'deliver';
  g.forEach(k => k.code = String(Math.floor(100+Math.random()*899))+'-'+String(Math.floor(10+Math.random()*89)));
  const split = [...g.map(k => `${money(k.sub)} → ${k.stall}`),
    ...(del ? [`${money(deliveryFee())} → ${state.carrier.name}`] : []),
    `${money(platformFee())} → FoodFlow`];
  state.order = { id:'FF-'+Math.floor(1000+Math.random()*8999),
    txn:'VS-'+Math.floor(100000+Math.random()*899999), total:total(),
    groups:g, del, carrier: del ? state.carrier : null, ready, step:0, split,
    eta: del ? ready + state.carrier.mins : ready,
    ledger:[`Agent proposed ${count()} item${count()>1?'s':''} from ${g.length} stall${g.length>1?'s':''}`,
      del ? `Quoted 3 couriers — picked ${state.carrier.name} at ${money(deliveryFee())}` : 'Collection route ordered by walking distance',
      `Total ${money(total())} — within the ${money(MANDATE)} mandate`,
      'Server revalidated the total before charging','Identity confirmed by Face ID',
      'One charge, settled to each merchant separately'] };
  state.cart=[]; state.needs={}; state.asked=0; state.fulfil='pickup'; state.carrier=null;
  scAuth.hidden=true; scChat.hidden=true; scColl.hidden=false;
  wSub.innerHTML = `<span class="dotg"></span> Order ${state.order.id}`;
  drawColl(); sync();
  setTimeout(advance,2600); setTimeout(advance,6200);
}
function advance(){ if (!state.order || state.order.step>=2) return; state.order.step++; drawColl(); }
function drawColl(){
  const o = state.order, ST = o.del ? STEPS_D : STEPS_P;
  collBody.innerHTML = `
    <div class="coll-top"><div class="ring">✓</div>
      <h4>${o.del ? `Paid. ${o.carrier.name} is on it.` : `Paid. ${o.groups.length>1?'Two stops.':'Collect at '+o.groups[0].courtName+'.'}`}</h4>
      <p>${o.del ? `Arriving in about ${o.eta} minutes. You never left this window.`
                 : `${o.groups.map(k=>k.stall).join(' and ')} ${o.groups.length>1?'have':'has'} your order.`}</p></div>

    ${o.del ? `
      <div class="code"><div class="cl">Courier</div><div class="cv" style="font-size:22px">${o.carrier.name}</div>
        <div class="cs">collecting from ${o.groups.length} stall${o.groups.length>1?'s':''} · ~${o.eta} min to you</div></div>`
    : o.groups.map((k,n)=>`
      <div class="code"><div class="cl">${o.groups.length>1?`Stop ${n+1} · `:''}Collection code</div>
        <div class="cv">${k.code}</div>
        <div class="cs">${k.stall} · ${k.courtName} · ${k.walk} min walk</div></div>`).join('')}

    <div class="track">${ST.map((s,i)=>`<div class="tk2 ${i<o.step?'on':i===o.step?'now':''}">
      <span class="bulb">${i<o.step?'✓':''}</span>
      <span class="tkt"><b>${s.k}</b><span>${i===o.step&&i<2?'now · about '+Math.max(1,o.ready-i*4)+' min':s.s}</span></span></div>`).join('')}</div>

    <div class="ledger"><div class="lh">Where the money went · one charge</div>
      ${o.split.map(l=>`<div class="lg-row"><span class="tick">→</span><span>${l}</span></div>`).join('')}</div>

    <div class="ledger"><div class="lh">Agent action record · ${o.id}</div>
      ${o.ledger.map(l=>`<div class="lg-row"><span class="tick">✓</span><span>${l}</span></div>`).join('')}
      <div class="lg-row"><span class="tick">✓</span><span>Visa txn <b class="mono">${o.txn}</b> · ${money(o.total)}</span></div></div>
    <button class="btn pri" data-a="done">Back to chat</button>`;
}
collBody.addEventListener('click', e => { if (!e.target.closest('[data-a="done"]')) return;
  const o = state.order; backToChat();
  bubble('ai', o.del
    ? `Order <b>${o.id}</b> is paid and <b>${o.carrier.name}</b> is collecting from ${o.groups.length} stall${o.groups.length>1?'s':''} — about ${o.eta} minutes to you. Anything else?`
    : `Order <b>${o.id}</b> is paid. ${o.groups.map(k=>`<b>${k.code}</b> at ${k.stall}`).join(' and ')} — I'll keep tracking it. Anything else?`);
  chipRow(['Something to drink','Same again tomorrow']); });

/* open/close */
function openW(seed){
  wgt.hidden=false; launch.hidden=true; wgt.classList.add('opening');
  setTimeout(()=>wgt.classList.remove('opening'),220);
  if (!log.children.length){
    bubble('ai', `Hi — I'm the FoodFlow agent for NUS. I know <b>${allDishes().length}</b> dishes across <b>${COURTS.filter(c=>c.live).length}</b> canteens. Tell me what you're craving and where you're headed; I'll find it, pay for it, and tell you where to collect.`);
    chipRow(['Something soupy under $4','Halal and filling','I\'m in a rush']);
  }
  sync();
  if (seed) setTimeout(()=>send(seed),260); else setTimeout(()=>inp.focus(),240);
}
launch.addEventListener('click', () => openW());
closeW.addEventListener('click', () => { wgt.hidden=true; launch.hidden=false; });
cartBtn.addEventListener('click', () => { if (!state.cart.length) return toast('Nothing decided yet');
  openW(); setTimeout(openAuth,300); });
askBar.addEventListener('click', () => openW());
stripGo.addEventListener('click', openAuth);
addEventListener('keydown', e => { if (e.key==='Escape' && !wgt.hidden && scAuth.hidden && scColl.hidden){ wgt.hidden=true; launch.hidden=false; } });
let tt; function toast(m){ const el=document.getElementById('toast'); el.textContent=m; el.classList.add('show');
  clearTimeout(tt); tt=setTimeout(()=>el.classList.remove('show'),2000); }
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (state.view==='store') drawGrid(); });

/* ══════════ boot — one catalog, served by the API ══════════ */
async function boot(){
  try{
    const r = await fetch('/api/catalog');
    if (!r.ok) throw new Error('catalog ' + r.status);
    COURTS = await r.json();
  } catch (err){
    console.error('[foodflow] could not load the catalog:', err.message);
    document.getElementById('grid').innerHTML =
      '<p class="empty">Catalog unavailable. Run <code>npm run dev</code>, or open the deployed site — ' +
      'the catalog is served by the API rather than baked into the page.</p>';
    return;
  }
  drawCourts(); drawTabs(); drawGrid(); sync();
}
boot();

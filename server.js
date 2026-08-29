/* Local dev server. Vercel runs /api/*.js as serverless functions and serves /public
   statically; this reproduces both so `npm run dev` behaves like production —
   and so you have a demo that works with no internet at all. */
require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const TYPES = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css',
                '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png' };

const routes = {
  '/api/catalog': require('./api/catalog.js'),
  '/api/agent':   require('./api/agent.js'),
  '/api/health':  require('./api/health.js'),
  '/api/telegram': require('./api/telegram.js')
};

function shim(res) {
  res.status = c => { res.statusCode = c; return res; };
  res.json = o => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
  return res;
}

http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];

  if (routes[url]) {
    shim(res);
    let raw = '';
    for await (const chunk of req) raw += chunk;
    try { req.body = raw ? JSON.parse(raw) : {}; } catch { req.body = {}; }
    try { await routes[url](req, res); }
    catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
    return;
  }

  const file = path.join(__dirname, 'public', url === '/' ? 'index.html' : url);
  if (!file.startsWith(path.join(__dirname, 'public'))) { res.statusCode = 403; return res.end('no'); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.statusCode = 404; return res.end('Not found'); }
    res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
    res.end(buf);
  });
}).listen(PORT, () => {
  console.log(`\n  FoodFlow → http://localhost:${PORT}`);
  console.log(`  agent    → ${process.env.OPENAI_API_KEY ? 'model (' + (process.env.OPENAI_MODEL || 'gpt-4o-mini') + ')' : 'local rules engine (no API key set — this is fine)'}\n`);
});

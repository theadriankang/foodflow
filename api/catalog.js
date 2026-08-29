const base = require('./catalog.json');
const store = require('./_store.js');

module.exports = async (req, res) => {
  let published = [];
  try { published = await store.getPublished(); }
  catch (e) { console.error('[catalog] store unavailable:', e.message); }

  res.setHeader('Cache-Control', 'no-store');   /* a merchant publishing must show up at once */
  res.status(200).json([...base, ...published]);
};

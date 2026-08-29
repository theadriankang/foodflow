/* GET /api/health — is the model wired up?
   Deliberately does NOT return the key, only whether one is present and usable.
   Add ?probe=1 to make one real (tiny) call to the model and report what came back. */

const KEY   = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

module.exports = async (req, res) => {
  const base = {
    ok: true,
    engine: KEY ? 'model' : 'rules',
    model: KEY ? MODEL : null,
    keyConfigured: Boolean(KEY),
    keyLooksValid: KEY ? /^sk-[A-Za-z0-9_-]{20,}$/.test(KEY) : false,
    note: KEY
      ? 'A key is set. Add ?probe=1 to this URL to make one real call and confirm it works.'
      : 'No key set — the agent is running on the local rules engine. The demo works fully either way.'
  };

  const wantsProbe = /(\?|&)probe=1(&|$)/.test(req.url || '');
  if (!KEY || !wantsProbe) return res.status(200).json(base);

  try {
    const t0 = Date.now();
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 5,
        messages: [{ role: 'user', content: 'Reply with the single word: connected' }]
      })
    });
    const data = await r.json();
    if (!r.ok) {
      return res.status(200).json({ ...base, probe: 'failed', status: r.status,
        reason: data?.error?.message || 'unknown',
        hint: r.status === 401 ? 'The key is wrong or was revoked.'
            : r.status === 429 ? 'Rate limited, or the OpenAI account has no credit.'
            : r.status === 404 ? `The model "${MODEL}" is not available on this account.`
            : 'See reason above.' });
    }
    return res.status(200).json({ ...base, probe: 'ok', ms: Date.now() - t0,
      replied: data.choices?.[0]?.message?.content?.trim() || '' });
  } catch (err) {
    return res.status(200).json({ ...base, probe: 'failed', reason: err.message });
  }
};

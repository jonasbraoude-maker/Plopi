// Accès à la base Upstash Redis (connectée au projet via Vercel)
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOK = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

async function pipe(cmds) {
  if (!URL_ || !TOK) throw new Error('Base Redis non connectée au projet');
  const r = await fetch(URL_ + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOK, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmds),
  });
  if (!r.ok) throw new Error('Redis ' + r.status);
  const j = await r.json();
  return j.map((x) => x.result);
}

// Date du jour à Paris, au format AAAA-MM-JJ
const day = (d = new Date()) => d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
const addDays = (d, n) => {
  const t = new Date(d + 'T12:00:00Z');
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
const hash = (arr) => {
  const o = {};
  for (let i = 0; i < (arr || []).length; i += 2) o[arr[i]] = arr[i + 1];
  return o;
};

module.exports = { pipe, day, addDays, hash };

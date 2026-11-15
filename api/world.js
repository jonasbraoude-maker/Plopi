// Plopidex mondial : premiers découvreurs, possesseurs et pseudos (facultatifs)
const { pipe } = require('./_redis');

const BAD = ['con', 'pute', 'merde', 'encul', 'nique', 'salop', 'bite', 'couill', 'fuck', 'shit', 'nazi', 'hitler', 'connard', 'batard', 'bitch', 'porn', 'sex', 'pd', 'negr', 'nègr'];
const okPid = (p) => /^[a-z0-9]{8,40}$/.test(p || '');
const okK = (k) => Number.isInteger(k) && k >= 1 && k <= 500000;
const MIN_TS = Date.UTC(2026, 0, 1);

function cleanPseudo(s) {
  s = String(s || '').normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  if (s.length < 2 || s.length > 16) return null;
  if (!/^[\p{L}\p{N} _.\-]+$/u.test(s)) return null;
  const flat = s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
  if (BAD.some((w) => (w.length <= 3 ? flat === w || flat.startsWith(w) && flat.length <= 5 : flat.includes(w.normalize('NFD').replace(/[̀-ͯ]/g, ''))))) return null;
  return s;
}

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      const k = parseInt(req.query.k, 10);
      const pid = String(req.query.pid || '');
      if (!okK(k)) return res.status(400).end();
      const [n, owners, top, rank] = await pipe([
        ['ZCARD', 'disc:' + k],
        ['SCARD', 'own:' + k],
        ['ZRANGE', 'disc:' + k, 0, 9, 'WITHSCORES'],
        okPid(pid) ? ['ZRANK', 'disc:' + k, pid] : ['PING'],
      ]);
      const pids = [], ts = [];
      for (let i = 0; i < (top || []).length; i += 2) { pids.push(top[i]); ts.push(+top[i + 1]); }
      const names = pids.length ? (await pipe([['HMGET', 'pseudo', ...pids]]))[0] : [];
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({
        n: n || 0,
        owners: owners || 0,
        rank: typeof rank === 'number' ? rank + 1 : null,
        top: pids.map((p, i) => ({ name: names[i] || null, me: p === pid, ts: ts[i] })),
      });
    }
    if (req.method !== 'POST') return res.status(405).end();
    let b = req.body;
    if (typeof b === 'string') b = JSON.parse(b || '{}');
    const pid = String((b && b.pid) || '');
    if (!okPid(pid)) return res.status(400).end();

    if ('pseudo' in b) {
      const ps = cleanPseudo(b.pseudo);
      if (ps === null) return res.status(422).json({ error: 'pseudo' });
      await pipe([ps ? ['HSET', 'pseudo', pid, ps] : ['HDEL', 'pseudo', pid]]);
      return res.status(200).json({ pseudo: ps });
    }

    const items = Array.isArray(b.items) ? b.items.slice(0, 150) : [];
    const now = Date.now();
    const cmds = [];
    items.forEach((it) => {
      const k = parseInt(it && it.k, 10);
      if (!okK(k)) return;
      let ts = +it.ts;
      if (!Number.isFinite(ts) || ts < MIN_TS || ts > now) ts = now;
      cmds.push(['ZADD', 'disc:' + k, 'NX', ts, pid], ['SADD', 'own:' + k, pid], ['SADD', 'pk:' + pid, k], ['SADD', 'wk', k]);
    });
    if (cmds.length) await pipe(cmds);
    res.status(204).end();
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
};
module.exports.cleanPseudo = cleanPseudo;

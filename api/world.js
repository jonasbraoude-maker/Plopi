// Plopidex mondial : premiers découvreurs, possesseurs et pseudos (facultatifs)
const { pipe } = require('./_redis');

const BAD = ['con', 'pute', 'merde', 'encul', 'nique', 'salop', 'bite', 'couill', 'fuck', 'shit', 'nazi', 'hitler', 'connard', 'batard', 'bitch', 'porn', 'sex', 'pd', 'negr', 'nègr'];
const okPid = (p) => /^[a-z0-9]{8,40}$/.test(p || '');
const okK = (k) => Number.isInteger(k) && k >= 1 && k <= 500000;
const okL = (k) => Number.isInteger(k) && k >= 1 && k <= 20000;
const MIN_TS = Date.UTC(2026, 0, 1);

// Clé d'unicité : sans majuscules ni accents
const normPs = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
// Raison du refus, ou null si le pseudo est valable
function whyBad(s) {
  s = String(s || '').normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (s.length < 2) return 'court';
  if (s.length > 16) return 'long';
  const badC = [...s].find((c) => !/[\p{L}\p{N} _.\-]/u.test(c));
  if (badC) return 'car:' + badC;
  return cleanPseudo(s) === null ? 'mot' : null;
}
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
    if (req.method === 'GET' && 'check' in req.query) {
      // Vérification en direct d'un pseudo (disponible / pris / refusé)
      const raw = String(req.query.check || '');
      const pid = String(req.query.pid || '');
      res.setHeader('Cache-Control', 'no-store');
      const why = whyBad(raw);
      if (why) return res.status(200).json({ ok: false, why });
      const ps = cleanPseudo(raw);
      if (!ps) return res.status(200).json({ ok: false, why: 'vide' });
      const [owner] = await pipe([['HGET', 'psname', normPs(ps)]]);
      if (owner && owner !== pid) return res.status(200).json({ ok: false, why: 'pris' });
      return res.status(200).json({ ok: true, ps });
    }
    if (req.method === 'GET' && 'lands' in req.query) {
      // Index des Plopiland : nombre de joueurs et « premier au monde »
      const pid = String(req.query.pid || '');
      const ids = String(req.query.lands || '').split(',').map((x) => parseInt(x, 10)).filter(okL).slice(0, 60);
      const cmds = [];
      ids.forEach((id) => { cmds.push(['ZCARD', 'land:' + id]); cmds.push(okPid(pid) ? ['ZRANK', 'land:' + id, pid] : ['PING']); });
      cmds.push(['SCARD', 'lands']);
      const r = await pipe(cmds);
      const L = {};
      ids.forEach((id, i) => { const n = r[i * 2] || 0, rk = r[i * 2 + 1]; L[id] = { n, first: rk === 0 }; });
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ L, tot: r[r.length - 1] || 0 });
    }
    if (req.method === 'GET') {
      const k = parseInt(req.query.k, 10);
      const pid = String(req.query.pid || '');
      if (!okK(k)) return res.status(400).end();
      const [n, owners, top, rank, , tot] = await pipe([
        ['ZCARD', 'disc:' + k],
        ['SCARD', 'own:' + k],
        ['ZRANGE', 'disc:' + k, 0, 9, 'WITHSCORES'],
        okPid(pid) ? ['ZRANK', 'disc:' + k, pid] : ['PING'],
        okPid(pid) ? ['SADD', 'players', pid] : ['PING'],
        ['SCARD', 'players'],
      ]);
      const pids = [], ts = [];
      for (let i = 0; i < (top || []).length; i += 2) { pids.push(top[i]); ts.push(+top[i + 1]); }
      const names = pids.length ? (await pipe([['HMGET', 'pseudo', ...pids]]))[0] : [];
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({
        n: n || 0,
        owners: owners || 0,
        tot: tot || 0,
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
      if (ps === null) return res.status(422).json({ error: 'pseudo', why: whyBad(b.pseudo) });
      const [old] = await pipe([['HGET', 'pseudo', pid]]);
      if (ps) {
        const [set, owner] = await pipe([['HSETNX', 'psname', normPs(ps), pid], ['HGET', 'psname', normPs(ps)]]);
        if (!set && owner !== pid) return res.status(409).json({ error: 'pris' });
      }
      const cmds = [];
      if (old && normPs(old) !== normPs(ps)) cmds.push(['HDEL', 'psname', normPs(old)]);
      cmds.push(ps ? ['HSET', 'pseudo', pid, ps] : ['HDEL', 'pseudo', pid]);
      await pipe(cmds);
      return res.status(200).json({ pseudo: ps });
    }

    if (Array.isArray(b.lands)) {
      const now = Date.now(), cmds = [];
      b.lands.slice(0, 60).forEach((it) => {
        const id = parseInt(it && it.id, 10);
        if (!okL(id)) return;
        let ts = +it.ts;
        if (!Number.isFinite(ts) || ts < MIN_TS || ts > now) ts = now;
        cmds.push(['ZADD', 'land:' + id, 'NX', ts, pid], ['SADD', 'lands', id]);
      });
      if (cmds.length) await pipe(cmds);
      return res.status(204).end();
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
    if (cmds.length) { cmds.push(['SADD', 'players', pid]); await pipe(cmds); }
    res.status(204).end();
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
};
module.exports.cleanPseudo = cleanPseudo;

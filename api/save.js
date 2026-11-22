// Sauvegarde en ligne : un code de partie (sans compte) permet de retrouver sa partie
// sur un autre appareil (site, app Android, app iOS).
const { pipe } = require('./_redis');

const ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans 0/O ni 1/I
const okCode = (c) => /^PLOP-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(c || '');
const okPid = (p) => /^[a-z0-9]{8,40}$/.test(p || '');
const MAX = 900000; // ~900 ko

function newCode() {
  let s = 'PLOP-';
  for (let i = 0; i < 8; i++) {
    if (i === 4) s += '-';
    s += ALPH[Math.floor(Math.random() * ALPH.length)];
  }
  return s;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET') {
      const code = String(req.query.code || '').toUpperCase().trim();
      if (!okCode(code)) return res.status(400).json({ error: 'code' });
      const [raw] = await pipe([['GET', 'save:' + code]]);
      if (!raw) return res.status(404).json({ error: 'absent' });
      const o = JSON.parse(raw);
      if ('meta' in req.query) return res.status(200).json({ ts: o.ts });
      return res.status(200).json({ ts: o.ts, data: o.data });
    }
    if (req.method !== 'POST') return res.status(405).end();
    let b = req.body;
    if (typeof b === 'string') b = JSON.parse(b || '{}');
    const pid = String((b && b.pid) || '');
    const data = String((b && b.data) || '');
    const ts = Number(b && b.ts) || Date.now();
    if (!okPid(pid) || !data) return res.status(400).json({ error: 'requête' });
    if (data.length > MAX) return res.status(413).json({ error: 'trop gros' });
    let code = String(b.code || '').toUpperCase().trim();
    if (code && !okCode(code)) return res.status(400).json({ error: 'code' });
    if (!code) {
      for (let t = 0; t < 8 && !code; t++) {
        const c = newCode();
        const [ok] = await pipe([['SET', 'save:' + c, JSON.stringify({ ts, pid, data }), 'NX']]);
        if (ok === 'OK') code = c;
      }
      if (!code) return res.status(500).json({ error: 'code indisponible' });
      return res.status(200).json({ code, ts });
    }
    const [raw] = await pipe([['GET', 'save:' + code]]);
    if (raw) {
      const o = JSON.parse(raw);
      if (o.ts > ts) return res.status(409).json({ error: 'plus récent', ts: o.ts });
    }
    await pipe([['SET', 'save:' + code, JSON.stringify({ ts, pid, data })]]);
    return res.status(200).json({ code, ts });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
};

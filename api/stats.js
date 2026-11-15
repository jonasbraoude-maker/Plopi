// Statistiques agrégées, protégées par STATS_KEY
const { pipe, day, addDays, hash } = require('./_redis');
const STEPS = ['open', 'eclos', 'grand', 'maj', 'danse', 'fusion', 'mystere'];

module.exports = async (req, res) => {
  try {
    const key = process.env.STATS_KEY;
    if (!key) return res.status(500).json({ error: 'Variable STATS_KEY absente dans Vercel' });
    if (req.query.key !== key) return res.status(401).json({ error: 'Clé requise' });
    res.setHeader('Cache-Control', 'no-store');

    const today = day();
    const days = [];
    for (let i = 13; i >= 0; i--) days.push(addDays(today, -i));

    const base = await pipe([
      ['SCARD', 'players'], ['HGETALL', 'first'], ['HGETALL', 'src'], ['HGETALL', 'plat'], ['HGETALL', 'dance'],
      ...STEPS.map((s) => ['SCARD', 'step:' + s]),
    ]);
    const [players, firstA, srcA, platA, danceA] = base;
    const steps = {};
    STEPS.forEach((s, i) => (steps[s] = base[5 + i] || 0));
    const first = hash(firstA), src = hash(srcA), plat = hash(platA), dance = hash(danceA);

    const per = await pipe(days.flatMap((d) => [['SMEMBERS', 'active:' + d], ['HGETALL', 'ev:' + d], ['HGETALL', 'mins:' + d]]));
    const active = {}, ev = {}, mins = {};
    days.forEach((d, i) => { active[d] = new Set(per[i * 3] || []); ev[d] = hash(per[i * 3 + 1]); mins[d] = hash(per[i * 3 + 2]); });

    // Cohortes et rétention
    const cohorts = {};
    for (const p in first) (cohorts[first[p]] = cohorts[first[p]] || []).push(p);
    const ret = { 1: [0, 0], 3: [0, 0], 7: [0, 0] };
    const cohortRows = days.map((c) => {
      const mem = cohorts[c] || [];
      const row = { day: c, size: mem.length };
      for (const k of [1, 3, 7]) {
        const t = addDays(c, k);
        if (t > today || !mem.length || !active[t]) { row['d' + k] = null; continue; }
        const n = mem.filter((p) => active[t].has(p)).length;
        row['d' + k] = n / mem.length;
        ret[k][0] += n; ret[k][1] += mem.length;
      }
      return row;
    });

    const dayRows = days.map((d) => {
      const m = Object.values(mins[d]).map(Number);
      const e = ev[d];
      return {
        day: d, active: active[d].size, new: (cohorts[d] || []).length,
        opens: +(e.open || 0), fusions: +(e.fusion || 0), danseOk: +(e.danse_ok || 0), danseKo: +(e.danse_ko || 0),
        partages: +(e.partage || 0), mins: m.length ? m.reduce((a, b) => a + b, 0) / m.length : null,
      };
    });

    const count = (o) => { const r = {}; for (const p in o) r[o[p]] = (r[o[p]] || 0) + 1; return r; };
    const totals = {};
    days.forEach((d) => { for (const k in ev[d]) totals[k] = (totals[k] || 0) + +ev[d][k]; });

    res.json({
      today, players, steps,
      retention: { d1: ret[1][1] ? ret[1][0] / ret[1][1] : null, d3: ret[3][1] ? ret[3][0] / ret[3][1] : null, d7: ret[7][1] ? ret[7][0] / ret[7][1] : null,
        n1: ret[1][1], n3: ret[3][1], n7: ret[7][1] },
      cohorts: cohortRows, days: dayRows, bySrc: count(src), byPlat: count(plat), dance, totals14: totals,
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
};

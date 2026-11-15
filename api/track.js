// Reçoit les événements anonymes du jeu
const { pipe, day } = require('./_redis');

const EVENTS = new Set(['open', 'ping', 'eclos', 'grand', 'maj', 'danse', 'danse_ok', 'danse_ko', 'fusion', 'mystere',
  'mission', 'sauvage', 'partage', 'plopidex', 'fiche', 'style', 'oeuf_retour', 'reveil']);
const STEPS = ['open', 'eclos', 'grand', 'maj', 'danse', 'fusion', 'mystere'];

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).end();
    let b = req.body;
    if (typeof b === 'string') b = JSON.parse(b || '{}');
    if (!b || typeof b !== 'object') return res.status(400).end();
    const pid = String(b.pid || '');
    if (!/^[a-z0-9]{8,40}$/.test(pid)) return res.status(400).end();

    // Effacement à la demande du joueur
    if (b.forget) {
      const [days] = await pipe([['SMEMBERS', 'pdays:' + pid]]);
      const cmds = [['SREM', 'players', pid], ['HDEL', 'first', pid], ['HDEL', 'src', pid], ['HDEL', 'plat', pid], ['DEL', 'pdays:' + pid]];
      STEPS.forEach((s) => cmds.push(['SREM', 'step:' + s, pid]));
      (days || []).forEach((d) => { cmds.push(['SREM', 'active:' + d, pid]); cmds.push(['HDEL', 'mins:' + d, pid]); });
      await pipe(cmds);
      return res.status(204).end();
    }

    const evt = String(b.evt || '');
    if (!EVENTS.has(evt)) return res.status(400).end();
    const d = day();
    const src = /^[\w-]{1,24}$/.test(b.src || '') ? b.src : 'direct';
    const plat = ['ios', 'android', 'desktop', 'autre'].includes(b.plat) ? b.plat : 'autre';
    const cmds = [
      ['SADD', 'players', pid],
      ['HSETNX', 'first', pid, d],
      ['HSETNX', 'src', pid, src],
      ['HSETNX', 'plat', pid, plat + (b.app ? '-app' : '')],
      ['SADD', 'active:' + d, pid],
      ['SADD', 'pdays:' + pid, d],
      ['HINCRBY', 'ev:' + d, evt, 1],
    ];
    if (STEPS.includes(evt)) cmds.push(['SADD', 'step:' + evt, pid]);
    if (evt === 'ping') cmds.push(['HINCRBY', 'mins:' + d, pid, 1]);
    if ((evt === 'danse_ok' || evt === 'danse_ko') && Number.isFinite(+b.aff)) {
      const bucket = Math.max(1, Math.min(9, Math.floor(+b.aff / 10))) * 10;
      cmds.push(['HINCRBY', 'dance', bucket + ':' + (evt === 'danse_ok' ? 'ok' : 'ko'), 1]);
    }
    await pipe(cmds);
    res.status(204).end();
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
};

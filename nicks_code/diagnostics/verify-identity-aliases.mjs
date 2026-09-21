#!/usr/bin/env node
/**
 * verify-identity-aliases.mjs — a renamed agent never loses their sales; a stranger's money is loud.
 *
 *   node nicks_code/diagnostics/verify-identity-aliases.mjs           # engine, synthetic floor
 *   node nicks_code/diagnostics/verify-identity-aliases.mjs --live    # + the archive function and the deployed Worker
 *
 * 2026-09-21: the 18 Sep Agent List re-spelt twelve agents and re-issued two under new CB numbers;
 * Salesforce kept the old spellings, so ~206 September sales fell to "Unmatched" and four of
 * Dhamendra Budhu's agents read 0 sales / 0 GWP on the Daily view. specs/identity-aliases-plan.md.
 *
 * Runs the REAL engine (nicks_code/index.html) headlessly over a synthetic floor and replays the
 * incident: the list renames a code → the old spelling is remembered and the sales still land;
 * a new starter's typo, a transposition and a middle name on either side resolve, UNIQUE-OR-NOTHING;
 * two look-alikes and a bare surname stay unmatched; a stranger's sales raise the red banner and
 * V24; Ignore clears both; the manual map beats everything; a live name beats an alias.
 */
import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const LIVE = process.argv.includes('--live');
const { chromium } = await import(pathToFileURL(path.join(HERE, 'node_modules', 'playwright', 'index.mjs')).href);
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } };

const HTML = path.join(ROOT, 'nicks_code', 'index.html');
const SERVE = { '/': HTML, '/index.html': HTML, '/xlsx.full.min.js': path.join(ROOT, 'site', 'xlsx.full.min.js') };
const server = http.createServer((q, s) => { const p = SERVE[q.url.split('?')[0]];
  if (!p || !fs.existsSync(p)) { s.writeHead(404); s.end(); return; }
  s.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' }); fs.createReadStream(p).pipe(s); });
await new Promise((r) => server.listen(8261, '127.0.0.1', r));
const b = await chromium.launch();
try {
  const page = await b.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
  await page.goto('http://127.0.0.1:8261/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__mtd && window.__mtd.state(), null, { timeout: 30000 });

  /* ---- the floor before the rename: the list spells everyone the way Salesforce does ---- */
  const seed = await page.evaluate(async () => {
    const S = window.__mtd.state();
    S.roster = []; S.att = {}; S.calls = {}; S.sales = {}; S.tracker = {}; S.orgHist = {}; S.vici = {}; S.cancRows = {}; S.viciDays = {}; S.leavers = {}; S.map = {}; S.aliases = {}; S.files = [];
    const TL = 'Leader Alpha';
    const mk = (i, name, extra) => Object.assign({ code: 'CB' + (930000 + i), name, sf: name, tl: TL, campaign: 'Courtesy', tenure: 'Exp', callx: '', target: 5, start: '2026-01-01' }, extra || {});
    const R = [
      mk(1, 'Surprise Lucky Cwele'),            // will be re-spelt "Surprize Cwele"
      mk(2, 'Lindokuhle Phakathi'),             // will be re-spelt "Lindokhule Phakathi" (transposition)
      mk(3, 'Nolulamo Mazaka'),                 // will be re-spelt "Nolulamo Mazeka"
      mk(4, 'Roshel Naidoo'),                   // Salesforce says "Roshel Dinika Naidoo"
      mk(5, 'Thokozile Irene Maphumulo'),       // Salesforce says "Thokozile Maphumulo"
      mk(6, 'Thandi Ngcobo'),                   // look-alike pair: "Thandu Ngcobo" is one edit from BOTH
      mk(7, 'Thando Ngcobo'),
      mk(8, 'Mandisa Cele'),                    // an alias will wrongly claim this live name
      mk(9, 'Kyle Naidoo'), mk(10, 'Jabu Naidoo'),   // "Naidoo" alone fits three
      mk(11, 'Amanda Xulu'),                    // one edit from the LEAVER "Ayanda Zulu" in each of two words — never the same person
    ];
    for (let i = 12; i <= 29; i++) R.push(mk(i, 'Stay Agent ' + i));
    R.push(mk(30, 'Zodwa Original Holder'));      // her code will be handed to somebody else
    S.roster = R;
    const head = ['Employee Code', 'Agent Name', 'Sales Force', 'Team Leader', 'Campaign', 'Tenure', 'Call x', 'Target', 'Start Date'];
    const csv = (rows) => [head.join(',')].concat(rows.map((a) => [a.code, a.name, a.sf || a.name, a.tl, a.campaign, a.tenure, a.callx, a.target, a.start].join(','))).join(String.fromCharCode(10));
    window.__csvOf = csv;
    window.__mtd.setRosterAsOf('2026-09-16');
    await window.__mtd.ingest('Matrix - Agent List.csv', csv(R), 'roster', 'alias-seed');
    const D = '2026-09-17';
    S.att[D] = {}; S.calls[D] = {}; S.sales[D] = {};
    for (const a of S.roster) { S.att[D][a.code] = 'P'; S.calls[D][a.code] = { talk: 3600, calls: 30, ans: 15, opt: 0, saleD: 0, v: 1 }; }
    const sale = (owner, n) => { S.sales[D][owner] = { a: Object.fromEntries(Array.from({ length: n }, (_, i) => ['2' + owner.length + i, 86.08])), u: 'case', n, gwp: n * 99, canc: 0, x: n * 86.08 }; };
    sale('Surprise Lucky Cwele', 3); sale('Lindokuhle Phakathi', 1); sale('Nolulamo Mazaka', 6);
    sale('Delano Rajagopal', 6);                // a new starter the NEXT list will name "Delano Rajagopaul"
    sale('Roshel Dinika Naidoo', 2); sale('Thokozile Maphumulo', 4);
    sale('Thandu Ngcobo', 2); sale('Naidoo', 1);
    sale('Zanele Stranger Person', 5);          // nobody on any list
    sale('Gone Person', 2);                     // a known leaver
    sale('Ayanda Zulu', 3);                     // a known leaver whose name is one edit per word from a live agent
    sale('amandabridgetexulu', 2);              // Salesforce's collapsed spelling with a middle name — Amanda Xulu
    sale('Amande Xula', 1);                     // two misspelt words: fits nobody
    sale('Bongi Mthembu', 1);                   // one edit from TWO leavers (Bongo / Bonga Mthembu): nobody's, and LOUD
    S.leavers['CB939997'] = { code: 'CB939997', name: 'Bongo Mthembu', sf: 'Bongo Mthembu', tl: 'Leader Alpha', campaign: 'Courtesy', tenure: 'Exp', callx: '', target: 5, start: '2026-01-01', left: '2026-09-01' };
    S.leavers['CB939996'] = { code: 'CB939996', name: 'Bonga Mthembu', sf: 'Bonga Mthembu', tl: 'Leader Alpha', campaign: 'Courtesy', tenure: 'Exp', callx: '', target: 5, start: '2026-01-01', left: '2026-09-01' };
    S.leavers['CB939998'] = { code: 'CB939998', name: 'Ayanda Zulu', sf: 'Ayanda Zulu', tl: 'Leader Alpha', campaign: 'Courtesy', tenure: 'Exp', callx: '', target: 5, start: '2026-01-01', left: '2026-09-01' };
    S.leavers['CB939999'] = { code: 'CB939999', name: 'Gone Person', sf: 'Gone Person', tl: 'Leader Alpha', campaign: 'Courtesy', tenure: 'Exp', callx: '', target: 5, start: '2026-01-01', left: '2026-09-14' };
    S.ui.team = ''; S.ui.camp = ''; S.ui.mtdSub = 'Courtesy'; S.ui.dailyFilter = {};
    window.__mtd.setPeriod('2026-09', 'month');
    const M = window.__mtd.model();
    const f = (code) => ((M.facts || []).find((x) => x.code === code && x.date === D) || {}).sales;
    return { roster: S.roster.length, before: { cwele: f('CB930001'), phakathi: f('CB930002'), mazaka: f('CB930003') }, un: Object.keys(M.unmatched || {}) };
  });
  console.log('\nA · BEFORE THE RENAME (the list spells everyone as Salesforce does)');
  ok('30 agents on the roster', seed.roster === 30, String(seed.roster));
  ok('Cwele 3, Phakathi 1, Mazaka 6 on 17 Sep', seed.before.cwele === 3 && seed.before.phakathi === 1 && seed.before.mazaka === 6, JSON.stringify(seed.before));

  /* ---- the 18 Sep list: three re-spelt, one new starter under a new spelling ---- */
  const after = await page.evaluate(async () => {
    const S = window.__mtd.state();
    const R = S.roster.map((a) => Object.assign({}, a));
    const set = (code, name) => { const r = R.find((a) => a.code === code); r.name = name; r.sf = name; };
    set('CB930001', 'Surprize Cwele'); set('CB930002', 'Lindokhule Phakathi'); set('CB930003', 'Nolulamo Mazeka');
    R.push({ code: 'CB930031', name: 'Delano Rajagopaul', sf: 'Delano Rajagopaul', tl: 'Leader Alpha', campaign: 'Courtesy', tenure: 'Exp', callx: '', target: 5, start: '2026-09-14' });
    set('CB930030', 'Completely Different Person');   // Stay Agent 30's code handed to somebody else: a reassignment, never an alias
    R.find((a) => a.code === 'CB930008').sf = 'Zinhle Mchunu';   // Sales Force typed differently from Agent Name (Mandisa Cele)
    window.__mtd.setRosterAsOf('2026-09-18');
    const toasts = []; const t0 = window.toast; window.toast = (m) => { toasts.push(String(m)); };
    await window.__mtd.ingest('Matrix - Agent List.csv', window.__csvOf(R), 'roster', 'alias-rename');
    window.toast = t0;
    window.__mtd.rebuild();
    const M = window.__mtd.model(); const D = '2026-09-17';
    const f = (code) => ((M.facts || []).find((x) => x.code === code && x.date === D) || {}).sales;
    const rk = (k) => resolveKey(k);
    const un = M.unmatched || {};
    const mtd = PAGES.mtd(), daily = PAGES.daily(), weekly = PAGES.weekly(), data = PAGES.data();
    const v24 = (window.__mtd.checks() || []).find((c) => c.id === 'V24');
    return {
      aliases: S.aliases, names: { c1: S.roster.find((a) => a.code === 'CB930001').name }, reassigned: resolveKey('Zodwa Original Holder'), sfRow: { name: S.roster.find((a) => a.code === 'CB930008').name, viaSf: resolveKey('Zinhle Mchunu') },
      sales: { cwele: f('CB930001'), phakathi: f('CB930002'), mazaka: f('CB930003'), delano: f('CB930031'), roshel: f('CB930004'), thokozile: f('CB930005') },
      rk: { cwele: rk('Surprise Lucky Cwele'), phakathi: rk('Lindokuhle Phakathi'), mazaka: rk('Nolulamo Mazaka'), delano: rk('Delano Rajagopal'), roshel: rk('Roshel Dinika Naidoo'),
        thokozile: rk('Thokozile Maphumulo'), thandie: rk('Thandu Ngcobo'), naidoo: rk('Naidoo'), stranger: rk('Zanele Stranger Person'), gone: rk('Gone Person'),
        ayanda: rk('Ayanda Zulu'), bongi: rk('Bongi Mthembu'), bongiLeaver: !!leaverMatch('Bongi Mthembu'), amandaFlat: rk('amandabridgetexulu'), twoTypos: rk('Amande Xula'), delanoFlat: rk('delanorajagopal'), roshelFlat: rk('rosheldinikanaidoo') },
      near: M.near || null, ambig: M.ambig || null, unKeys: Object.keys(un), unStranger: un['Zanele Stranger Person'], toasts,
      banner: { mtd: /belong to nobody/.test(mtd), daily: /belong to nobody/.test(daily), weekly: /belong to nobody/.test(weekly), data: /belong to nobody on the Agent List/.test(data) && /Zanele Stranger Person/.test(data),
        leaverLine: /Gone Person/.test(data) && /left the list/.test(data), tie: /Thandu Ngcobo<\/code> \(2 — fits CB93000[67] and CB93000[67]\)/.test(data), strangerCount: (data.match(/<b>(\d+) sales? \(R[\d\s,. ]+\)/) || [])[1] },
      spellingCard: /Matched by spelling/.test(data) && /Delano Rajagopal/.test(data) && /CB930031/.test(data),
      nearLine: /matched an agent by near spelling/.test(data) && /Delano Rajagopal/.test(data),
      nearOnReports: /matched an agent by near spelling/.test(mtd) || /matched an agent by near spelling/.test(daily) || /matched an agent by near spelling/.test(weekly),
      v24a: (window.__mtd.checks() || []).find((c) => c.id === 'V24a'),
      v24 };
  });
  console.log('\nB · THE LIST RENAMES A CODE — the old spelling is remembered');
  ok('the roster now reads the new spelling', after.names.c1 === 'Surprize Cwele', after.names.c1);
  ok('S.aliases remembers "Surprise Lucky Cwele" → CB930001', after.aliases && after.aliases.surpriseluckycwele && after.aliases.surpriseluckycwele.code === 'CB930001', JSON.stringify(after.aliases).slice(0, 200));
  ok('…and the other two renames', after.aliases && after.aliases.lindokuhlephakathi && after.aliases.lindokuhlephakathi.code === 'CB930002' && after.aliases.nolulamomazaka && after.aliases.nolulamomazaka.code === 'CB930003');
  ok('a code handed to a DIFFERENT person is a reassignment: "Zodwa Original Holder" is not aliased to CB930030', !(after.aliases && after.aliases.zodwaoriginalholder) && after.reassigned === null, JSON.stringify([after.aliases && after.aliases.zodwaoriginalholder, after.reassigned]));
  ok('AGENT NAME is the identity (Nick, 21 Sep): a row whose Sales Force differs shows the Agent Name…', after.sfRow.name === 'Mandisa Cele', JSON.stringify(after.sfRow));
  ok('…still resolves the Sales Force spelling, and the upload said the two columns differ', after.sfRow.viaSf === 'CB930008' && after.toasts.some((t) => /Sales Force differs from Agent Name/.test(t) && /CB930008/.test(t)), JSON.stringify(after.sfRow));
  ok('the ingest said so (a rename toast naming the old and new spelling)', after.toasts.some((t) => /renamed/i.test(t) && /Surprise Lucky Cwele/.test(t) && /Surprize Cwele/.test(t)), after.toasts.join(' | ').slice(0, 300));
  ok('resolveKey answers the alias', after.rk.cwele === 'CB930001' && after.rk.phakathi === 'CB930002' && after.rk.mazaka === 'CB930003', JSON.stringify(after.rk));
  ok('Cwele still has 3 sales, Phakathi 1, Mazaka 6 on 17 Sep', after.sales.cwele === 3 && after.sales.phakathi === 1 && after.sales.mazaka === 6, JSON.stringify(after.sales));

  console.log('\nC · NEAR SPELLING — the Ops doctrine: either-direction tokens, one edit, UNIQUE-OR-NOTHING');
  ok('a new starter never listed as Salesforce spells him resolves (Rajagopal → Rajagopaul, one insertion)', after.rk.delano === 'CB930031' && after.sales.delano === 6, JSON.stringify([after.rk.delano, after.sales.delano]));
  ok('a middle name only Salesforce carries resolves (Roshel Dinika Naidoo → Roshel Naidoo)', after.rk.roshel === 'CB930004' && after.sales.roshel === 2);
  ok('a middle name only the list carries resolves (Thokozile Maphumulo → Thokozile Irene Maphumulo)', after.rk.thokozile === 'CB930005' && after.sales.thokozile === 4);
  ok('two look-alikes fit → NOBODY ("Thandu Ngcobo" one edit from Thandi AND Thando)', after.rk.thandie === null && after.unKeys.includes('Thandu Ngcobo'), String(after.rk.thandie));
  ok('…and the tie is named on the model (M.ambig lists both codes)', after.ambig && after.ambig['Thandu Ngcobo'] && after.ambig['Thandu Ngcobo'].slice().sort().join(',') === 'CB930006,CB930007', JSON.stringify(after.ambig));
  ok('a bare surname fits three → NOBODY', after.rk.naidoo === null && after.unKeys.includes('Naidoo'));
  ok('a stranger resolves to nobody', after.rk.stranger === null && after.unStranger && after.unStranger.n === 5);
  ok('near matches are reported on the model (M.near names Delano → CB930031)', after.near && after.near['Delano Rajagopal'] && after.near['Delano Rajagopal'].code === 'CB930031', JSON.stringify(after.near).slice(0, 300));
  ok('…and on the Data tab under "Matched by spelling"', after.spellingCard);
  ok('…and on an amber line on the Upload Station, naming the match', after.nearLine);
  ok('…and NOT on Month to date, Weekly or Daily (Nick, 21 Sep PM: the report pages stay clean)', after.nearOnReports === false);
  ok('V24a is a warn, not an info footnote', after.v24a && after.v24a.sev === 'warn' && after.v24a.ok === false, JSON.stringify(after.v24a));
  ok('an alias is not a near match (Cwele resolved by the alias, not listed as spelling)', !(after.near && after.near['Surprise Lucky Cwele']));
  ok('a COLLAPSED key (how the BI ingest stores an Owner) resolves on one edit: delanorajagopal → CB930031', after.rk.delanoFlat === 'CB930031', String(after.rk.delanoFlat));
  ok('…and on a middle name inside it: rosheldinikanaidoo → Roshel Naidoo, amandabridgetexulu → Amanda Xulu', after.rk.roshelFlat === 'CB930004' && after.rk.amandaFlat === 'CB930011', JSON.stringify([after.rk.roshelFlat, after.rk.amandaFlat]));
  ok('ONE typo per name: "Amande Xula" (two misspelt words) fits nobody', after.rk.twoTypos === null, String(after.rk.twoTypos));
  ok('two leavers one edit away → not a leaver (unique-or-nothing): "Bongi Mthembu" stays a loud stranger', after.rk.bongi === null && after.rk.bongiLeaver === false && after.unKeys.includes('Bongi Mthembu'), JSON.stringify([after.rk.bongi, after.rk.bongiLeaver]));
  ok('a known LEAVER\'s name is a leaver, never a misspelling of someone still here ("Ayanda Zulu" ≠ Amanda Xulu)', after.rk.ayanda === null && !(after.near && after.near['Ayanda Zulu']), String(after.rk.ayanda));

  console.log('\nD · LOUD WHERE THE NUMBERS ARE');
  ok('the Upload Station carries the red banner naming the stranger', after.banner.data, JSON.stringify(after.banner));
  ok('Month to date, Weekly and Daily do NOT (Nick, 21 Sep PM: "remove this part, do not display")', !after.banner.mtd && !after.banner.daily && !after.banner.weekly, JSON.stringify(after.banner));
  ok('the banner counts every unattributed sale that is not a leaver\'s: stranger 5 + tie 2 + bare surname 1 + two-typo 1 + leaver-tie 1 = 10', after.banner.strangerCount === '10', String(after.banner.strangerCount));
  ok('…and says the tie fits two agents', after.banner.tie, JSON.stringify(after.banner));
  ok('the known leaver is named on a muted line, not as a stranger', after.banner.leaverLine);
  ok('V24 fails while a stranger carries sales (warn: the red banner is the loud part)', after.v24 && after.v24.ok === false && after.v24.sev === 'warn' && /Zanele Stranger Person/.test(after.v24.msg), JSON.stringify(after.v24));

  /* ---- a human answers: Ignore the stranger, and the manual map beats everything ---- */
  const fixed = await page.evaluate(() => {
    const S = window.__mtd.state();
    S.map['Zanele Stranger Person'] = '__ignore__';
    S.map['Thandu Ngcobo'] = 'CB930006';
    S.map['Delano Rajagopal'] = '__ignore__';           // a person says "not the same man": the map beats the near match
    S.map['Naidoo'] = '__ignore__';
    S.map['Amande Xula'] = '__ignore__';
    S.map['Bongi Mthembu'] = '__ignore__';
    S.aliases['mandisacele'] = { code: 'CB930009', name: 'Mandisa Cele', since: '2026-09-01' };   // an alias claiming a LIVE agent's name
    window.__mtd.rebuild();
    const M = window.__mtd.model(); const D = '2026-09-17';
    const f = (code) => ((M.facts || []).find((x) => x.code === code && x.date === D) || {}).sales;
    const data = PAGES.data();
    const v24 = (window.__mtd.checks() || []).find((c) => c.id === 'V24');
    return { banner: /belong to nobody/.test(data), v24ok: v24 && v24.ok === true, thandi: f('CB930006'), delano: f('CB930031'), delanoRk: resolveKey('Delano Rajagopal'), cele: resolveKey('Mandisa Cele'),
      unKeys: Object.keys(M.unmatched || {}) };
  });
  console.log('\nE · A PERSON ANSWERS ONCE, AND IT STICKS');
  ok('Ignore clears the banner and V24 passes', fixed.banner === false && fixed.v24ok, JSON.stringify(fixed));
  ok('mapping the look-alike lands its 2 sales', fixed.thandi === 2, String(fixed.thandi));
  ok('the manual map beats a near match (Delano ignored → 0 sales, resolves to nobody)', fixed.delanoRk === null && !fixed.delano, JSON.stringify([fixed.delanoRk, fixed.delano]));
  ok('a LIVE name beats an alias (Mandisa Cele is CB930008, not the alias\'s CB930009)', fixed.cele === 'CB930008', String(fixed.cele));
  ok('the leavers stay in Unmatched (off the report by rule), nothing else does', fixed.unKeys.slice().sort().join(',') === 'Ayanda Zulu,Gone Person', fixed.unKeys.join(','));

  /* ---- the store survives the machinery ---- */
  const store = await page.evaluate(() => {
    const S = window.__mtd.state();
    const mine = { files: [], sales: {}, calls: {}, att: {}, evals: {}, tracker: {}, map: {}, roster: [{ code: 'CB1' }], rosterEffect: { at: '2026-09-15 10:00' }, leavers: {}, orgHist: {}, settings: {}, aliases: { a: { code: 'CB1', name: 'A' } }, _rev: 1 };
    const theirs = { files: [], sales: {}, calls: {}, att: {}, evals: {}, tracker: {}, map: {}, roster: [{ code: 'CB2' }], rosterEffect: { at: '2026-09-15 09:00' }, leavers: {}, orgHist: {}, settings: {}, aliases: { b: { code: 'CB2', name: 'B' } }, _rev: 2 };
    const merged = mergeStates(mine, theirs);
    const keep = S.aliases; S.aliases = undefined; normalizeState(); const healed = S.aliases; S.aliases = keep;
    const adopted = adoptAliases([{ code: 'cb930001', name: 'Surprise L. Cwele', last_on: '2026-09-10' }, { code: 'CB930001', name: 'Surprize Cwele' }, { code: 'CB000000', name: 'Nobody Here' }, { code: '', name: 'x' }]);
    return { merged: merged.aliases, healed, adopted, alias2: S.aliases.surpriselcwele, live: S.aliases.surprizecwele, nobody: S.aliases.nobodyhere };
  });
  console.log('\nF · THE STORE');
  ok('mergeStates unions aliases from both sides', store.merged && store.merged.a && store.merged.b, JSON.stringify(store.merged));
  ok('normalizeState seeds an empty map for a blob saved before this build', store.healed && typeof store.healed === 'object' && !Array.isArray(store.healed));
  ok('adoptAliases takes the record\'s spellings (normalised code, dated)', store.adopted === true && store.alias2 && store.alias2.code === 'CB930001' && store.alias2.since === '2026-09-10', JSON.stringify(store.alias2));
  ok('…skips a spelling the live roster already carries, and a code not on the roster', !store.live && !store.nobody, JSON.stringify([store.live, store.nobody]));

  ok('no page errors', errs.length === 0, errs.join(' | '));

  if (LIVE) {
    console.log('\nG · LIVE — the archive and the Worker');
    const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, 'supabase.env'), 'utf8').split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
    const H = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY, 'Content-Type': 'application/json' };
    const r = await fetch(env.SUPABASE_URL + '/rest/v1/rpc/agent_list_aliases', { method: 'POST', headers: H, body: JSON.stringify({ p_days: 180 }) });
    const rows = r.ok ? await r.json() : null;
    ok('agent_list_aliases() answers (' + (rows ? rows.length : r.status) + ' rows)', Array.isArray(rows));
    /* Both spellings of the 18 Sep incident must be KNOWN for each code — one as the current name, the
       other as an alias — whichever way the list of the day spells them (Ashton corrected the list
       at 10:19 on 21 Sep, so the typo became the alias). And no alias may equal a live spelling. */
    const nn = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
    const recCur = (await (await fetch(env.SUPABASE_URL + '/rest/v1/rules?key=eq.' + encodeURIComponent('kv:roster-current') + '&select=value', { headers: H })).json())[0].value.roster;
    const liveNames = new Set(); for (const a of recCur) for (const n of [a.name, a.sf, a.callx]) if (n) liveNames.add(nn(n));
    const knows = (code, a, b) => { const cur = recCur.find((x) => x.code === code); const names = new Set([nn(cur && cur.name), nn(cur && cur.sf)]); (rows || []).filter((x) => x.code === code).forEach((x) => names.add(nn(x.name))); return names.has(nn(a)) && names.has(nn(b)); };
    ok('both spellings are known for CB242, CB263, CB275 (current name + alias, either way round)', knows('CB242', 'Surprise Lucky Cwele', 'Surprize Cwele') && knows('CB263', 'Lindokuhle Phakathi', 'Lindokhule Phakathi') && knows('CB275', 'Nolulamo Mazaka', 'Nolulamo Mazeka'),
      JSON.stringify((rows || []).filter((x) => /CB(242|263|275)/.test(x.code))));
    ok('it never returns a spelling the current list carries', Array.isArray(rows) && !rows.some((x) => liveNames.has(nn(x.name))));
    /* the deployed Worker, as a signed-in user would see it */
    const crypto = await import('node:crypto');
    const token = crypto.randomBytes(32).toString('hex'), tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const u = (await (await fetch(env.SUPABASE_URL + '/rest/v1/app_users?username=eq.aarav&select=id', { headers: H })).json())[0];
    await fetch(env.SUPABASE_URL + '/rest/v1/app_sessions', { method: 'POST', headers: { ...H, Prefer: 'return=minimal' },
      body: JSON.stringify([{ token_hash: tokenHash, user_id: u.id, expires_at: new Date(Date.now() + 300000).toISOString(), user_agent: 'verify-identity-aliases' }]) });
    const j = await (await fetch('https://chatterbox-agentos-api.chatterbox-agentos.workers.dev/api/roster', { headers: { Authorization: 'Bearer ' + token } })).json();
    await fetch(env.SUPABASE_URL + '/rest/v1/app_sessions?token_hash=eq.' + tokenHash, { method: 'DELETE', headers: H });
    ok('/api/roster serves aliases[] beside leavers[]', Array.isArray(j.aliases) && Array.isArray(j.leavers), Object.keys(j).join(','));
    ok('…including CB242\'s other spelling', Array.isArray(j.aliases) && j.aliases.some((a) => a.code === 'CB242' && /surpri[sz]e/i.test(a.name)));
    ok('…and nothing degraded (the archive answered every lookup)', Array.isArray(j.extras_degraded) && j.extras_degraded.length === 0, JSON.stringify(j.extras_degraded));
  }
} finally { await b.close(); server.close(); }
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

/**
 * VEHICLE TRACKING HEALTH (spec 071, Phase F, task F3) — the sentinel watches the VT pipeline the way health.mjs watches VAS.
 *
 * Five alerts, all in plain words, all clearing themselves the tick the condition ends (they ride kv:health-alerts, so they
 * reach exactly the people the existing banner reaches — nobody new is added):
 *   vt-digest-stale    a VT upload was committed after the VT figures agents see were published (> 15 min), or the published
 *                      figures are for an older business month while this one has uploads
 *   vt-upload-gap      a working day (Mon–Fri, not an SA public holiday or a rule-book extra holiday) has passed with no
 *                      committed BI Active Fitted or no Scheduled & Missed file — sale days shift to the next upload
 *   vt-staging-stuck   an upload has sat half-loaded for over an hour
 *   vt-budget-missing  the live business month has no Sales Review budgets in the rule book (the rating falls back to the
 *                      latest earlier month and says so) — or no budget at all
 *   vt-db-size         the vt_* tables are past the size the plan expects (§DB-5: ≈ 27 MB steady state)
 *   vt-unmatched       more of this business month's sales than usual name a seller the Agent List cannot place
 * Plus the WEEKLY TRIM: on a Sunday (SAST), once a week, vt_trim() runs and its counts are kept in kv:vt-trim-log.
 *
 * NOTHING HERE FIRES BEFORE THE VT TABLES EXIST: if vt_uploads cannot be read (migration 071 not applied yet, or the read
 * failed) the module has no opinion and raises nothing — the pre-deploy Worker stays quiet.
 *
 * evaluateVtHealth() is PURE (verify-vt-health.mjs feeds it fixtures); gatherVt() is the plumbing, ≤ 4 subrequests a tick
 * (vt_uploads, vt_db_size, at most one Storage read of the digest, and vt_trim + its log once a week).
 */
import { cycleKeyOf } from './cycle.mjs';

const HOUR = 3600000, DAY = 864e5;
export const VT_HEALTH = {
  digestStaleMin: 15,          // plan F3: book newer than the published digest by > 15 min
  uploadGapWorkingDays: 1,     // = specs/vt_engine_rules.json guards.uploadGapWorkingDays (verify-vt-health checks)
  dueHourSast: 13,             // a day's files are due by 13:00 SAST (the VAS drop's hour, rules.mjs expectedReachFor)
  stagingStuckMin: 60,         // vt_upload_begin abandons a staging row after an hour; past that it is stuck
  dbWarnBytes: 60 * 1048576,   // ~2× the plan's 27 MB steady state (§DB-5)
  unmatchedShare: 0.05,        // the November reference month was 3.8 % (66 of ~1,756 cases): above 5 % is new
  unmatchedMinCases: 10,
  trimEveryDays: 6,
};
/* one-off holidays the Act does not list — = specs/vt_engine_rules.json periods.extraHolidays (verify-vt-health checks) */
export const VT_EXTRA_HOLIDAYS = ['2026-11-04'];
export const VT_TRIM_KEY = 'kv:vt-trim-log';
const KIND_LABEL = { bi_fitted: 'BI Active Fitted', sched_missed: 'Scheduled & Missed' };

/* @mirror:sa-holidays start — identical in nicks_code/index.html and agent/index.html; verify-public-holidays.mjs fails on any difference */
/* SA PUBLIC HOLIDAYS, COMPUTED (Public Holidays Act 36 of 1994): the ten fixed dates, Good
   Friday and Family Day from the Gregorian Easter algorithm (Meeus/Jones/Butcher), and a
   holiday that falls on a Sunday observed on the Monday. Returns the OBSERVED dates for the
   year as 'YYYY-MM-DD' strings — the table this replaces had to be extended every December
   and would have silently gone blank in a January. One-off holidays the Act does not list
   (an election day) are added by the caller from the rule book, never here. */
function saHolidaysFor(year){
  var y=+year, a=y%19, b=Math.floor(y/100), c=y%100, d=Math.floor(b/4), e=b%4, f=Math.floor((b+8)/25),
      g=Math.floor((b-f+1)/3), h=(19*a+b-d-g+15)%30, i=Math.floor(c/4), k=c%4, l=(32+2*e+2*i-h-k)%7,
      m=Math.floor((a+11*h+22*l)/451), em=Math.floor((h+l-7*m+114)/31), ed=((h+l-7*m+114)%31)+1;
  var easter=Date.UTC(y,em-1,ed), DAY=864e5;
  var iso=function(t){ return new Date(t).toISOString().slice(0,10); };
  var days=[Date.UTC(y,0,1),Date.UTC(y,2,21),easter-2*DAY,easter+DAY,Date.UTC(y,3,27),Date.UTC(y,4,1),
            Date.UTC(y,5,16),Date.UTC(y,7,9),Date.UTC(y,8,24),Date.UTC(y,11,16),Date.UTC(y,11,25),Date.UTC(y,11,26)];
  var out=[]; for(var n=0;n<days.length;n++){ var t=days[n]; if(new Date(t).getUTCDay()===0) t+=DAY; out.push(iso(t)); }
  return out;
}
/* @mirror:sa-holidays end */

const isoDay = (t) => new Date(t).toISOString().slice(0, 10);
const addDays = (d, n) => isoDay(Date.parse(d + 'T00:00:00Z') + n * DAY);
const sast = (ms) => new Date(+ms + 2 * HOUR).toISOString().slice(0, 16).replace('T', ' ') + ' SAST';
const ms = (v) => { const t = Date.parse(v || ''); return isNaN(t) ? 0 : t; };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthName = (key) => { const m = /^cycle-(\d{4})-(\d{2})$/.exec(String(key || '')); return m ? MONTHS[+m[2] - 1] + ' ' + m[1] : String(key || ''); };
const dayLabel = (d) => { const t = new Date(d + 'T00:00:00Z'); return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][t.getUTCDay()] + ' ' + t.getUTCDate() + ' ' + MONTHS[t.getUTCMonth()].slice(0, 3); };

/** a VT working day: Mon–Fri, not an SA public holiday, not a rule-book extra holiday (the engine's isWorkingDay, same calendar) */
export function vtWorkingDay(d, extra = VT_EXTRA_HOLIDAYS) {
  const w = new Date(d + 'T00:00:00Z').getUTCDay();
  return w >= 1 && w <= 5 && !saHolidaysFor(+d.slice(0, 4)).includes(d) && !extra.includes(d);
}

/** the working days after `lastDay` whose files are already due at `nowMs` (today counts from 13:00 SAST) */
export function overdueDays(lastDay, nowMs, extra = VT_EXTRA_HOLIDAYS) {
  const s = new Date(nowMs + 2 * HOUR), today = isoDay(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate()));
  const last = s.getUTCHours() >= VT_HEALTH.dueHourSast ? today : addDays(today, -1);
  const out = [];
  for (let d = addDays(lastDay, 1); d <= last && out.length < 40; d = addDays(d, 1)) if (vtWorkingDay(d, extra)) out.push(d);
  return out;
}

/** the few digest fields the sentinel needs, read WITHOUT parsing the ~200 KB payload (CPU: the free plan's 10 ms) */
export function readVtDigestHead(text) {
  const t = String(text || '');
  if (!t) return null;
  const pick = (re) => { const m = re.exec(t); return m ? m[1] : null; };
  let period = null;
  try { const p = pick(/"period":(\{[^{}]*\})/); period = p ? JSON.parse(p) : null; } catch { period = null; }
  const updatedAt = pick(/"updatedAt":"([^"]+)"/);
  const empty = pick(/"empty":(true|false)/);
  const budgetCycle = pick(/"budgets":\{"cycle":"([^"]+)"/);
  const noBudgets = /"budgets":null/.test(t);
  const um = /"unmatched":\{"sellers":(\d+),"cases":(\d+)/.exec(t);
  const fm = /"floor":\{"mtd":\{"sales":(\d+)/.exec(t);
  const gaps = pick(/"gaps":(null|\[[^\]]*\])/);
  return { period, updatedAt, empty: empty === 'true', budgetCycle: noBudgets ? null : budgetCycle, noBudgets,
    unmatched: um ? { sellers: +um[1], cases: +um[2] } : null, floorSales: fm ? +fm[1] : null,
    gapDays: gaps && gaps !== 'null' ? (gaps.match(/"date":/g) || []).length : 0 };
}

/**
 * The VT alerts from what the cron read. Pure.
 *   t.uploads   vt_uploads rows (newest first, ≤ 60) | null/undefined = unreadable → no opinion at all
 *   t.digest    readVtDigestHead() of kv:vt-digest | null (never published)
 *   t.size      vt_db_size() | null
 *   t.now       ms
 */
export function evaluateVtHealth(t) {
  const alerts = [];
  if (!t || !Array.isArray(t.uploads)) return alerts;            // VT not live here (or unreadable): say nothing
  const now = t.now || Date.now();
  const committed = t.uploads.filter((u) => u && u.state === 'committed' && u.kind !== 'opening_book');
  const todaySast = isoDay(now + 2 * HOUR), curCycle = cycleKeyOf(todaySast);
  const d = t.digest || null;

  /* 1 · the published figures are behind the book */
  const newest = committed.map((u) => ms(u.committed_at)).reduce((a, b) => Math.max(a, b), 0);
  if (newest) {
    const pub = d ? ms(d.updatedAt) : 0;
    const dCycle = d && d.period ? d.period.key : null;
    const curHasUploads = committed.some((u) => cycleKeyOf(u.extract_on) === curCycle);
    const behind = newest - pub > VT_HEALTH.digestStaleMin * 60000 && now - newest > VT_HEALTH.digestStaleMin * 60000;
    const oldMonth = !!dCycle && dCycle < curCycle && curHasUploads;
    if (!d || behind || oldMonth) {
      alerts.push({ id: 'vt-digest-stale', severity: 'warning',
        message: (!d ? 'Vehicle Tracking files have been loaded but the VT figures for agents, team leaders and the campaign manager have never been published.'
          : oldMonth ? 'The Vehicle Tracking figures agents see are still ' + monthName(dCycle) + ' while ' + monthName(curCycle) + ' files have been loaded.'
          : 'The Vehicle Tracking figures agents see were published ' + sast(pub) + ', before the newest VT upload (' + sast(newest) + ').')
          + ' Someone with the Upload Station should open VAS Analytics → Vehicle Tracking → Month to date: the page republishes the figures (or run node tools/digest-republish.mjs --apply).',
        since: new Date(newest).toISOString() });
    }
  }

  /* 2 · a working day passed with no file of a kind (only once that kind has ever been loaded) */
  const late = [];
  for (const kind of Object.keys(KIND_LABEL)) {
    const days = committed.filter((u) => u.kind === kind).map((u) => String(u.extract_on || '').slice(0, 10)).filter(Boolean).sort();
    if (!days.length) continue;
    const miss = overdueDays(days[days.length - 1], now, t.extraHolidays || VT_EXTRA_HOLIDAYS);
    if (miss.length >= VT_HEALTH.uploadGapWorkingDays) late.push({ kind, last: days[days.length - 1], miss });
  }
  if (late.length) {
    alerts.push({ id: 'vt-upload-gap', severity: late.some((x) => x.miss.length >= 2) ? 'critical' : 'warning',
      message: 'No Vehicle Tracking ' + late.map((x) => KIND_LABEL[x.kind] + ' file since ' + dayLabel(x.last) + ' (missing: ' + x.miss.map(dayLabel).join(', ') + ')').join('; ')
        + '. Load the day\'s files on the Upload Station (VT slots). Until they are loaded, sales first seen on a later file are counted on that later day.',
      since: late.map((x) => addDays(x.last, 1)).sort()[0] });
  }

  /* 3 · a half-loaded upload */
  const stuck = t.uploads.filter((u) => u && u.state === 'staging' && now - ms(u.started_at) > VT_HEALTH.stagingStuckMin * 60000);
  if (stuck.length) {
    alerts.push({ id: 'vt-staging-stuck', severity: 'warning',
      message: stuck.length + ' Vehicle Tracking upload' + (stuck.length > 1 ? 's have' : ' has') + ' been half-loaded since ' + sast(Math.min(...stuck.map((u) => ms(u.started_at))))
        + ' — nothing from ' + (stuck.length > 1 ? 'them' : 'it') + ' reached the figures. Drop the same file on the Upload Station again; the half-load is cleared automatically.',
      since: new Date(Math.min(...stuck.map((u) => ms(u.started_at)))).toISOString() });
  }

  /* 4 · the live business month's budgets (Sales Review), read off the published figures */
  if (d && d.period && d.period.key === curCycle && !d.empty) {
    if (d.noBudgets || !d.budgetCycle) {
      alerts.push({ id: 'vt-budget-missing', severity: 'critical',
        message: 'There are no Sales Review budgets for Vehicle Tracking at all, so no VT agent can be rated on fitment or missed appointments. Add this business month\'s budgets to specs/vt_engine_rules.json and its copy in nicks_code/vt-engine.js.',
        since: d.period.from || 'rules' });
    } else if (d.budgetCycle !== curCycle) {
      alerts.push({ id: 'vt-budget-missing', severity: 'warning',
        message: 'The Sales Review budgets for ' + monthName(curCycle) + ' have not been entered, so the VT rating is using ' + monthName(d.budgetCycle) + '\'s (each card says so). Add "' + curCycle + '" to the budgets in specs/vt_engine_rules.json and its copy in nicks_code/vt-engine.js, with a dated _changes entry.',
        since: d.period.from || 'rules' });
    }
  }

  /* 5 · the tables are growing past the plan */
  if (t.size && typeof t.size === 'object') {
    const bytes = Object.values(t.size).reduce((s, x) => s + (Number(x && x.bytes) || 0), 0);
    if (bytes > VT_HEALTH.dbWarnBytes) {
      alerts.push({ id: 'vt-db-size', severity: 'warning',
        message: 'The Vehicle Tracking tables hold ' + Math.round(bytes / 1048576) + ' MB — the plan expects about 27 MB once a year of history is kept. Run node tools/vt-db-size.mjs to see which table grew, and check the weekly trim ran (kv:vt-trim-log).',
        since: 'db' });
    }
  }

  /* 6 · sellers the Agent List cannot place */
  if (d && d.unmatched && d.period && d.period.key === curCycle) {
    const total = (d.floorSales || 0) + d.unmatched.cases;
    if (d.unmatched.cases >= VT_HEALTH.unmatchedMinCases && total > 0 && d.unmatched.cases / total > VT_HEALTH.unmatchedShare) {
      alerts.push({ id: 'vt-unmatched', severity: 'warning',
        message: d.unmatched.cases + ' of this business month\'s Vehicle Tracking sales (' + Math.round(100 * d.unmatched.cases / total) + '%) name ' + d.unmatched.sellers + ' seller' + (d.unmatched.sellers === 1 ? '' : 's')
          + ' the Agent List cannot place, so nobody is credited with them. The names are on VAS Analytics → Vehicle Tracking ("Unmatched sellers"): fix the Sales Force name on the Agent List, or add an alias.',
        since: d.period.from || 'list' });
    }
  }
  return alerts;
}

/** Is the weekly trim due? Sunday SAST, and the last trim (kv:vt-trim-log) is at least six days old. Pure. */
export function trimDue(nowMs, lastAt) {
  const s = new Date(nowMs + 2 * HOUR);
  return s.getUTCDay() === 0 && (!lastAt || nowMs - ms(lastAt) >= VT_HEALTH.trimEveryDays * DAY);
}

/**
 * The plumbing. `rows` = the rules rows health.mjs already selected (kv:vt-digest, kv:vt-trim-log ride that select).
 * Never throws: whatever fails leaves {uploads: undefined} and the VT checks have no opinion.
 */
export async function gatherVt(DB, rows, nowMs = Date.now()) {
  const out = { uploads: undefined, digest: null, size: null, now: nowMs, trimmed: null };
  try {
    out.uploads = await DB.select('vt_uploads?select=kind,state,extract_on,committed_at,started_at&order=id.desc&limit=60');
    if (!Array.isArray(out.uploads)) out.uploads = undefined;
  } catch (e) { out.uploads = undefined; }
  if (!out.uploads) return out;                                   // migration 071 not applied (or unreadable): nothing else
  const byKey = Object.fromEntries((rows || []).map((r) => [r.key, r.value]));
  try {
    const v = byKey['kv:vt-digest'];
    let text = v ? (typeof v.data === 'string' ? v.data : '') : '';
    if (!text && v && v.store) text = (await DB.storageGet('raw', String(v.store).replace(/^raw\//, ''))) || '';
    out.digest = readVtDigestHead(text);
  } catch (e) { out.digest = null; }
  try { out.size = await DB.rpc('vt_db_size', {}); } catch (e) { out.size = null; }
  let last = null;
  try { const tl = byKey[VT_TRIM_KEY]; last = tl ? JSON.parse(tl.data || '{}').at || null : null; } catch (e) { last = null; }
  if (trimDue(nowMs, last)) {
    try {
      const res = await DB.rpc('vt_trim', {});
      out.trimmed = res;
      await DB.insert('rules', [{ key: VT_TRIM_KEY, value: { data: JSON.stringify({ at: new Date(nowMs).toISOString(), result: res }) }, updated_by: 'health-cron', updated_at: new Date(nowMs).toISOString() }], true);
      console.info('[health] vt_trim: ' + JSON.stringify(res).slice(0, 200));
    } catch (e) { console.warn('[health] vt_trim failed: ' + String((e && e.message) || e).slice(0, 160)); }
  }
  return out;
}


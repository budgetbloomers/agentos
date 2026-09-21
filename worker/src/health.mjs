/**
 * PERSISTENCE HEALTH — the server notices what did NOT arrive.
 *
 * Phase 2 and 4 of specs/save-reliability-plan.md. Born from the 28–31 Aug
 * incident: a CORS preflight refusal meant every PULSE save died inside the
 * browser, so no server log could ever have shown it — the requests never
 * arrived. The one thing the server COULD have seen, and didn't look at, was
 * the shape of what it was receiving: raw files landing in the upload archive
 * every day while neither dashboard's state blob moved. That comparison is
 * what this module makes, every cron tick.
 *
 * DESIGN RULES, in order of importance:
 *   · The sentinel derives from ACTIVITY, never a schedule. The floor does not
 *     upload on Sundays; "state must move daily" would cry wolf weekly and be
 *     muted within a month. Files-arriving-while-state-freezes can never
 *     legitimately happen.
 *   · An alert must CLEAR ITSELF the tick after the condition ends. An alert
 *     that needs a human to dismiss it trains humans to dismiss alerts.
 *   · Everything here is best-effort and wrapped by the caller: the health
 *     checks must never be the thing that breaks the cron they ride on.
 *
 * evaluateFreshness() is a PURE function of timestamps so the logic is
 * testable without a database — verify-store-freshness.mjs feeds it fixtures.
 * Everything around it is plumbing.
 */

const HOUR = 3600000;
/* EVERY TIME A PERSON READS IN AN ALERT IS SOUTH AFRICAN TIME (Nick, 2026-09-08: "it needs to be CAT south african time"). SAST is UTC+2 with no daylight saving; the `since` fields stay ISO — they are for the machine. */
const sast = (ms) => new Date(+ms + 2 * HOUR).toISOString().slice(0, 16).replace('T', ' ') + ' SAST';

/* THE DAY EACH SOURCE SHOULD REACH RIGHT NOW (never-stale plan, Phase 2). The daily drop lands
   by 13:00 SAST carrying yesterday; there is no Sunday data. Mirrors expectedReach() in PULSE. */
import { expectedReachFor } from './rules.mjs';
export { expectedReachFor };                              // lives in rules.mjs since 2026-09-07 (one source); re-exported for the suites
const SATURDAY_SOURCES = new Set(['sales', 'calls']);
/* The Help Center's HighLevel location, read once: {ok, status, help, assist, error}. `help` and
   `assist` say whether each pipeline exists (both self-provision on first use, so a missing one
   is a warning, not an outage); a non-2xx or a timeout is the outage. */
export async function probeHelpCenter(env) {
  if (!env || !env.HL_HELP_API_KEY || !env.HL_HELP_LOCATION_ID) return { ok: false, status: 0, error: 'HL_HELP_API_KEY / HL_HELP_LOCATION_ID not set' };
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort('timeout'), 10000);
  try {
    const r = await fetch('https://services.leadconnectorhq.com/opportunities/pipelines?locationId=' + env.HL_HELP_LOCATION_ID,
      { headers: { Authorization: 'Bearer ' + env.HL_HELP_API_KEY, Version: '2021-07-28' }, signal: ctl.signal });
    const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) {}
    if (!r.ok) return { ok: false, status: r.status, error: t.slice(0, 120) };
    const names = ((j && j.pipelines) || []).map((p) => p.name);
    return { ok: true, status: r.status, help: names.includes('Agent Help Center'), assist: names.includes('Campaign Assistance') };
  } catch (e) {
    return { ok: false, status: 0, error: ctl.signal.aborted ? 'no answer within 10s' : String(e && e.message || e).slice(0, 120) };
  } finally { clearTimeout(timer); }
}
const SAST_WORKING = (nowMs) => { const s = new Date(nowMs + 2 * HOUR); const h = s.getUTCHours(), w = s.getUTCDay(); return w >= 1 && w <= 5 && h >= 6 && h < 20; };
const REACH_LABEL = { sales: 'Sales (BI Active cases)', calls: 'Calls (ViciDial)', attendance: 'Attendance register', qa: 'QA evaluations' };
export const ALERTS_KEY = 'kv:health-alerts';

/**
 * The sentinel itself. Pure: timestamps in, alerts out.
 *
 * @param {object} t  {manifestAt, vasAt, opsAt, staffLoginRecent, now} — ISO
 *                    strings (or null) and a boolean; now is epoch ms.
 * @returns {array}   alert objects {id, severity, message, since}
 */
export function evaluateFreshness(t) {
  const ms = (iso) => (iso ? Date.parse(iso) : 0);
  const now = t.now || Date.now();
  const manifest = ms(t.manifestAt), vas = ms(t.vasAt), ops = ms(t.opsAt);
  const alerts = [];

  /* THE INCIDENT'S SIGNATURE: files archived, neither state saved within the
     hour after. This is exactly what ran unseen for four days. */
  if (manifest && manifest - vas > HOUR && manifest - ops > HOUR) {
    alerts.push({
      id: 'uploads-not-persisting', severity: 'critical',
      message: 'Uploads are being archived but NEITHER dashboard has saved its state since '
        + sast(Math.max(vas, ops))
        + ' — saves may be silently failing for everyone. Check the browser console on an open tab, and run verify-live-save.mjs --live.',
      since: new Date(manifest).toISOString(),
    });
  }

  /* ABSOLUTE BACKSTOP, gated on people actually being signed in: a store that
     has not moved in 26 hours on a working day. Catches a freeze that starts
     on a day with no uploads at all. */
  /* OPENED SINCE ITS LAST SAVE, AND STILL NOT SAVED (2026-09-04). When the Worker stamps
     app opens (t.opened = {vas, ops} from kv:app-opened), the question is asked per app:
     was THIS dashboard opened after it last saved, and is that save now over 26 hours
     old? A dashboard nobody opened is quiet — the old rule fired "AgentOS Analytics has
     not saved despite staff signing in" over a VAS-only day. Without stamps (older
     Workers, the unit fixtures) the staff-sign-in rule stands. */
  const opened = (t.opened && typeof t.opened === 'object') ? t.opened : null;
  const usedSince = (app, savedAt) => opened ? (ms(opened[app]) > savedAt) : !!t.staffLoginRecent;
  if (vas && now - vas > 26 * HOUR && usedSince('vas', vas)) {
    alerts.push({
      id: 'vas-state-stale', severity: 'warning',
      message: 'PULSE has not saved its state since ' + sast(vas)
        + (opened ? ' although it was opened at ' + String(opened.vas || '').slice(0, 16).replace('T', ' ') : ' despite staff signing in since')
        + ' — if anyone uploaded in that time, their work is not stored.',
      since: new Date(vas).toISOString(),
    });
  }
  if (ops && now - ops > 26 * HOUR && usedSince('ops', ops)) {
    alerts.push({
      id: 'cb-config-stale', severity: 'warning',
      message: 'AgentOS Analytics has not saved its config since ' + sast(ops)
        + (opened ? ' although it was opened at ' + String(opened.ops || '').slice(0, 16).replace('T', ' ') : ' despite staff signing in since')
        + '.',
      since: new Date(ops).toISOString(),
    });
  }
  /* THE AGENT DIGEST MUST BE THIS MONTH AND RECENT (audit, 2026-09-03). On 3 September
     every agent read August for hours because a VAS browser on a past month republished
     it; and the digest only moves while a VAS tab is open at all. Both are now visible:
     the wrong month is critical, a digest older than a day with staff signed in is a
     warning. `digestMonth` is the payload's own period month, `curMonth` the SAST month. */
  if (t.digestMonth && t.curMonth && t.digestMonth !== t.curMonth) {
    alerts.push({
      id: 'agent-digest-wrong-month', severity: 'critical',
      message: 'The live agent digest is for ' + t.digestMonth + ' but the month is ' + t.curMonth
        + ' — every agent, team leader and campaign manager is reading last month. Run tools/digest-republish.mjs --apply.',
      since: t.digestAt || new Date(now).toISOString(),
    });
  }
  const dg = ms(t.digestAt);
  if (t.staffLoginRecent && dg && now - dg > 26 * HOUR) {
    alerts.push({
      id: 'agent-digest-stale', severity: 'warning',
      message: 'The agent digest was last published ' + sast(dg)
        + ' — nothing has republished it since (no VAS tab open?). Agents are reading yesterday. Run tools/digest-republish.mjs --apply.',
      since: new Date(dg).toISOString(),
    });
  }
  /* THE LIST, THE LOGINS AND THE CAMPAIGNS MUST AGREE (Nick, 2026-09-03: "so this never
     happens again"). agent_list_integrity is the database's own sentence-checks — list vs
     logins vs campaigns vs the roster of record. Any failing row means a person or a
     campaign the list names is missing, or one it dropped is still here. Critical when
     accounts, campaigns or the record disagree; a warning when a leader has no login (a
     human has to supply the CB number). `since` is fixed so a persisting condition is
     written once, not every tick. */
  /* SAVES THE CLIENTS REPORTED AS FAILED (2026-09-07). Three or more in an hour is a
     dashboard that cannot store what it holds — critical, and the alert names the keys
     and statuses so the reason is readable without asking anyone what the toast said. */
  const sf = Array.isArray(t.saveFailures) ? t.saveFailures : [];
  if (sf.length >= 3) {
    const by = {};
    for (const r of sf) { const k = (r.app || '?') + ' ' + (r.key || '?') + ' → ' + String(r.status || '?').slice(0, 60); by[k] = (by[k] || 0) + 1; }
    const oldest = sf.map((r) => Date.parse(r.at) || now).reduce((a, b) => Math.min(a, b), now);
    alerts.push({
      id: 'saves-failing', severity: 'critical',
      message: sf.length + ' cloud saves failed in the last hour, reported by the dashboards themselves: '
        + Object.entries(by).map(([k, n]) => k + (n > 1 ? ' ×' + n : '')).join('; ')
        + '. The data is queued in those tabs and retrying; see the save_failures table for the full reasons.',
      since: new Date(oldest).toISOString(),
    });
  }
  /* OPS MUST FOLLOW THE UPLOADS (never-stale plan, Phase 0, 2026-09-07). Ops ingests only
     when a tab is open and its relay's saves land; on 4–7 Sep nobody's did, and the Ops
     dashboard sat five days behind the archive with nothing on screen to say so. The
     manifest is the record of what was uploaded; the newest Ops fact store is the record of
     what Ops took. Thirty minutes apart, with uploads newer, is the gap — named in hours. */
  /* RETIRED 2026-09-18 — Nick: "stop this red banner, I don't want to see this anymore". With
     GitHub Actions off there is no runner to relay Ops between opens, so this was critical every
     morning until somebody happened to open Ops — and Ops relays itself within three minutes of
     being opened, so the banner asked the VAS reader to do something that happens by itself.
     The gap is still measured (opsFactsAt travels in the blob) for anyone who wants to look;
     it is no longer an alert. */
  /* THE RELAY SAYS IT RAN, NO STORE MOVED (2026-09-21). Not the retired banner: that fired whenever
     nobody had opened Ops. This fires only when the relay itself REPORTED a run after the newest
     upload and still no Ops fact store has been saved since two hours before that upload — the
     20–21 Sep signature (browser closed mid-loop on wire silence, audit "passed", seven files never
     decided, four stores three days stale, Courtesy's 17 Sep attendance one row). A warning, not a
     banner: the tick retries every 15 minutes and the fix is in the tool, not on the floor. */
  /* THE HELP CENTER ANSWERS (Nick, 2026-09-21). The probe above fails → every "Ask my team
     leader" and every "Ask the campaign manager" is a 502 right now; a missing pipeline only
     means the next request will re-create it. */
  if (t.helpCenter && !t.helpCenter.ok) {
    alerts.push({ id: 'help-center-unreachable', severity: 'critical',
      message: 'HighLevel is refusing the Help Center (' + (t.helpCenter.status ? 'HTTP ' + t.helpCenter.status + ': ' : '') + String(t.helpCenter.error || '').slice(0, 100)
        + ') — agents asking their team leader and team leaders asking the campaign manager get an error until this clears. Check the HL_HELP_API_KEY secret and the location in HighLevel.',
      since: new Date(now).toISOString() });
  } else if (t.helpCenter && t.helpCenter.ok && (!t.helpCenter.help || !t.helpCenter.assist)) {
    alerts.push({ id: 'help-center-pipeline-missing', severity: 'warning',
      message: 'The HighLevel location is missing the ' + [!t.helpCenter.help && '"Agent Help Center"', !t.helpCenter.assist && '"Campaign Assistance"'].filter(Boolean).join(' and ')
        + ' pipeline — the next request re-creates it, but any open requests it held are gone from the dashboards.',
      since: new Date(now).toISOString() });
  }
  { const relay = t.jobs && t.jobs.steps && t.jobs.steps['ops-relay'];
    const relayAt = ms(relay && relay.ranAt), facts = ms(t.opsFactsAt);
    if (manifest && relayAt > manifest && facts && manifest - facts > 2 * HOUR && now - manifest > 2 * HOUR) {
      alerts.push({ id: 'ops-relay-no-store-moved', severity: 'warning',
        message: 'The Ops relay reported a run at ' + sast(relayAt) + ' but no Ops fact store has been saved since '
          + sast(facts) + ', while files were uploaded up to ' + sast(manifest)
          + ' — Ops is showing older figures than VAS. Run node tools/ops-relay.mjs --wait 540 and read its DEADLINE/FAILED lines.',
        since: new Date(manifest).toISOString() });
    } }
  /* THE DIGEST MUST FOLLOW THE STATE (same plan). PULSE saved — an upload landed or a rule
     changed — but the live agent digest did not republish within the half hour, so every
     agent, team leader and campaign manager is reading the state before the save. */
  const digestAt = ms(t.digestAt);
  if (vas && digestAt && vas - digestAt > 30 * 60000) {
    alerts.push({
      id: 'digest-behind-store', severity: 'warning',
      message: 'VAS Analytics saved at ' + sast(vas) + ' but the live agent digest was last published '
        + sast(digestAt) + ' — agents are reading the state before that save. Run tools/digest-republish.mjs --apply.',
      since: new Date(vas).toISOString(),
    });
  }
  /* THE SCHEDULED RUNNER (never-stale plan, Phase 1). Every step it runs writes kv:jobs-status.
     Never written = it has never run — say what unblocks it. Silent for 45 min in working hours
     = the scheduler itself has stopped. A verify step that failed in the last day = the nightly
     proof is red. `jobs` undefined = unreadable = no opinion; null = the row does not exist. */
  /* THERE IS NO SCHEDULED RUNNER TO BE SILENT (2026-09-16). GitHub Actions is off (billing; Nick will
     not pay) and the pipeline runs without one: in-page Rake, Worker-cron coaching, PULSE's own digest
     push, Ops relaying on open, the laptop tick when it is on. A "runner silent" banner would now be
     red every working day and say nothing anyone can act on. What still matters is said elsewhere:
     source-stale (the data itself is behind) and verification-failed (a proof went red). The two
     runner alerts return only when GITHUB_RUNNER=on is set on the Worker. */
  const runnerExpected = t.runnerExpected === true;
  if (runnerExpected && t.jobs === null) {
    alerts.push({ id: 'runner-never-ran', severity: 'warning',
      message: 'The scheduled runner has never reported. Digests, the Ops relay, the lake and coaching refresh only while somebody has a tab open or runs a tool. Add the three Supabase secrets on GitHub (specs/never-stale-data-plan.md, Phase 1) and it takes over.',
      since: 'plan' });
  } else if (t.jobs && t.jobs.steps) {
    const steps = Object.entries(t.jobs.steps);
    const newest = steps.map(([, v]) => ms(v.ranAt)).reduce((a, b) => Math.max(a, b), 0);
    if (runnerExpected && newest && SAST_WORKING(now) && now - newest > 45 * 60000) {
      alerts.push({ id: 'runner-silent', severity: 'critical',
        message: 'The scheduled runner has not reported since ' + sast(newest) + ' — nothing is republishing or relaying'
          + (t.jobs.lastRunner ? ' (the last tick came from ' + t.jobs.lastRunner + '; the local fallback on Aarav\'s machine takes over within 15 minutes when it is on)' : '') + '.'
          + (t.kick && t.kick.at ? ' The Worker asked GitHub to run it at ' + sast(Date.parse(t.kick.at)).slice(11) + ' (HTTP ' + t.kick.http + ')'
            + (t.kick.last_run && t.kick.last_run.conclusion !== 'success'
              ? '. GitHub says of run #' + t.kick.last_run.number + ': "' + (t.kick.last_run.reason || t.kick.last_run.conclusion) + '"'
                + (/payments|spending limit|billing/i.test(t.kick.last_run.reason || '') ? ' — a GitHub billing setting on the repository owner\'s account; nothing in the code can fix it.' : '.')
              : (t.kick.http === 204 ? '; if this stays red the run itself is failing — read its log.' : ' — the ask was refused; check GH_DISPATCH_TOKEN.')) : ' GitHub drops scheduled runs under load; the Worker re-asks for the tick by itself once the GH_DISPATCH_TOKEN secret is set on the Worker (cd worker && npx wrangler secret put GH_DISPATCH_TOKEN).'),
        since: new Date(newest).toISOString() });
    }
    const red = steps.filter(([k, v]) => /^verify/.test(k) && v.ok === false && now - ms(v.ranAt) < 24 * HOUR);
    if (red.length) {
      alerts.push({ id: 'verification-failed', severity: 'critical',
        message: 'The nightly verification is red: ' + red.map(([k, v]) => k + (v.note ? ' (' + String(v.note).slice(0, 80) + ')' : '')).join('; ') + '. A figure on screen may be wrong — read the run log before trusting today.',
        since: new Date(Math.min(...red.map(([, v]) => ms(v.ranAt)))).toISOString() });
    }
  }
  /* SOURCES MUST REACH THE DAY THEY ARE DUE (never-stale plan, Phase 2). The digest carries the
     last day each source covers; the cadence table names who owns each drop. A source a day
     short at 15:00 is a missed upload with a name on it, not a mystery on Monday. */
  if (t.reach && typeof t.reach === 'object') {
    const cad = Object.fromEntries((Array.isArray(t.cadence) ? t.cadence : []).map((c) => [c.source, c]));
    const expFor = (k) => expectedReachFor(now, cad[k] && cad[k].saturday != null ? !!cad[k].saturday : SATURDAY_SOURCES.has(k));
    const late = [];
    for (const k of ['sales', 'calls', 'attendance', 'qa']) {
      const r = t.reach[k]; if (!r) continue;
      const exp = expFor(k);
      const days = Math.round((Date.parse(exp) - Date.parse(r)) / 86400000);
      if (days >= 1) late.push({ k, r, exp, days, owner: (cad[k] && cad[k].owner) || '' });
    }
    if (late.length) {
      alerts.push({ id: 'source-stale', severity: late.some((x) => x.days >= 2) ? 'critical' : 'warning',
        message: 'Data is behind where it should be: '
          + late.map((x) => (REACH_LABEL[x.k] || x.k) + ' reaches ' + x.r + ', expected ' + x.exp + ' (' + x.days + 'd short' + (x.owner ? ', owner ' + x.owner : '') + ')').join('; ')
          + '. Upload the missing day in either Upload Station.',
        since: late.map((x) => x.exp).sort()[0] });
    }
  }
  const integ = Array.isArray(t.integrity) ? t.integrity.filter((r) => r && r.failures > 0) : [];
  if (integ.length) {
    alerts.push({
      id: 'agent-list-out-of-sync', severity: integ.some((r) => r.severity === 'critical') ? 'critical' : 'warning',
      message: 'The Agent List, the logins and the campaigns disagree: '
        + integ.map((r) => r.check_name + ' (' + r.failures + (r.detail ? ': ' + r.detail : '') + ')').join('; ')
        + '. Re-upload the latest Agent List in either Upload Station; if it persists, run tools/dry-run-provision.mjs.',
      since: 'list',
    });
  }
  /* THE RAKE (Data Rake, Phase 1). A large file received but not picked up within an hour, a file that
     failed three times, or a message in the dead-letter queue is an alert — the station said
     "received", so somebody is waiting for those rows. */
  /* AN AGENT LIST UPLOADED BUT NOT PUBLISHED (2026-09-15). Five daily uploads (10–14 Sep) were
     refused by the publish — a legacy sheet duplicated a CB — and the only sign was a 20-second
     toast in the uploader's tab; the integrity view stayed green because everything downstream
     agreed with an 8 Sep record. Two signals, either raises: the newest Agent List in the archive
     is older than the roster of record's own upload stamp by more than the grace, or the Worker
     recorded a refusal since the last accepted publish (kv:roster-refused). The message names
     the reason, so the fix is on the sheet, not in a log. */
  if (t.roster) {
    const r = t.roster; const GRACE = 90 * 60000;
    const sast = (m) => new Date(m + 2 * 3600000).toISOString().slice(0, 16).replace('T', ' ') + ' SAST';
    const newest = ms(r.newestListAt), published = ms(r.recordUploadedAt);
    const refused = r.refused && r.refused.at ? r.refused : null;
    const unpublished = newest && (!published || newest - published > GRACE) && now - newest > GRACE;
    if (refused || unpublished) {
      const why = refused ? ('The last publish was REFUSED' + (refused.stage ? ' at the ' + refused.stage + ' stage' : '')
          + (refused.file ? ' ("' + refused.file + '"' + (refused.actor ? ', uploaded by ' + refused.actor : '') + ')' : '')
          + ': ' + (refused.errors && refused.errors.length ? refused.errors.join('; ') : (refused.detail || 'no reason given')) + '.')
        : ('An Agent List archived at ' + sast(newest) + ' has not been published; the roster of record is still the list uploaded at ' + (published ? sast(published) : '(never)') + '.');
      alerts.push({ id: 'agent-list-not-published', severity: 'critical',
        message: 'The Agent List is NOT coming through: ' + why + ' Every login, campaign and team view is still on the previous list. Fix the sheet and upload it again in the Upload Station.',
        since: (refused && refused.at) || r.newestListAt });
    }
  }
  if (t.rake) {
    const k = t.rake; const bits = [];
    if (k.received_stuck > 0) bits.push(k.received_stuck + ' file' + (k.received_stuck === 1 ? '' : 's') + ' received over an hour ago and not picked up');
    if (k.loading_stalled > 0) bits.push(k.loading_stalled + ' load' + (k.loading_stalled === 1 ? '' : 's') + ' stopped halfway over 30 minutes ago (' + (k.stalled_names || []).slice(0, 3).join(', ') + ') — open the Upload Station in VAS and it reloads itself, or press "Load from here"');
    if (k.failed_24h > 0) bits.push(k.failed_24h + ' failed in the last day (' + (k.failed_names || []).slice(0, 3).join(', ') + ')');
    if (k.dlq_depth > 0) bits.push(k.dlq_depth + ' in the dead-letter queue');
    if (bits.length) alerts.push({ id: 'rake-stuck', severity: k.received_stuck > 0 || k.loading_stalled > 0 || k.dlq_depth > 0 ? 'critical' : 'warning',
      message: 'Large-file uploads need attention: ' + bits.join('; ') + '. Upload Station → Large files shows each one with its reason.', since: 'rake' });
  }
  /* A PUBLISH THAT REMOVED MANY PEOPLE OR A CAMPAIGN — published, and questioned for three days.
     The list wins (Nick: "I will always be changing the list"); this only asks a person to look. */
  /* OFF (Nick, 2026-09-18: "needs to stop now it is alarming"). A list that removes people is the list doing its job;
     the removal note stays on the record (kv:roster-current.review) for anyone who asks, and the Upload Station
     slot still shows the count. No banner. */
  if (false && t.roster && t.roster.review && t.roster.review.at && now - Date.parse(t.roster.review.at) < 72 * HOUR) {
    const v = t.roster.review;
    const who = (v.removed || []).slice(0, 8).map((a) => (a.name || a.code) + (a.tl ? ' (' + a.tl + ')' : '')).join(', ') + ((v.removed_n || 0) > 8 ? ' +' + (v.removed_n - 8) + ' more' : '');
    alerts.push({ id: 'agent-list-review', severity: 'warning',
      message: 'The Agent List published ' + (v.as_of ? 'as of ' + v.as_of : sast(Date.parse(v.at))) + (v.file ? ' ("' + v.file + '")' : '') + ' removed '
        + ((v.removed_n || 0) ? (v.removed_n + ' agent' + (v.removed_n === 1 ? '' : 's') + ': ' + who) : '')
        + ((v.campaigns_gone || []).length ? ((v.removed_n ? '; and ' : '') + 'the whole ' + v.campaigns_gone.join(', ') + ' campaign' + (v.campaigns_gone.length === 1 ? '' : 's')) : '')
        + '. Their days up to that list still count; if any of them should still be on the list, upload the corrected list.',
      since: v.at });
  }
  /* THE DISK (migration-041). 15 Sep: the database filled the disk and Postgres restarted with no
     warning anywhere. Warn at 4 GB, critical at 6 GB of an 8 GB disk; a table carrying more than
     two million dead tuples is the September open-cases partition all over again. */
  if (t.db && t.db.db_bytes != null) {
    const gb = (n) => (n / 1073741824).toFixed(2) + ' GB';
    const bits = [];
    if (t.db.db_bytes >= 4 * 1073741824) bits.push('the database is ' + gb(t.db.db_bytes));
    if (t.db.wal_bytes != null && t.db.wal_bytes >= 1073741824) bits.push('WAL is ' + gb(t.db.wal_bytes));
    const heavy = (t.db.dead_heavy || []).filter((x) => x && x.dead >= 2000000);
    if (heavy.length) bits.push(heavy.map((x) => x.table + ' carries ' + Math.round(x.dead / 1e6) + 'M dead rows').join(', '));
    if (bits.length) alerts.push({ id: 'database-size', severity: t.db.db_bytes >= 6 * 1073741824 ? 'critical' : 'warning',
      message: 'The database needs attention: ' + bits.join('; ') + '. The weekly vacuum runs Sunday 03:30 SAST; run VACUUM (ANALYZE) on the named table now if this is red.', since: 'db' });
  }
  /* No alert about the start password: keeping it is allowed (Nick, 2026-09-08 — "only if they want
     to"). accounts_on_default_password remains the audit view for whoever asks. */
  return alerts;
}

/**
 * Run the sentinel against the live timestamps and keep kv:health-alerts in
 * step: written when the alerts change, cleared the tick the condition ends.
 * The value is stored as a legacy small row ({data}) so GET /api/kv serves it
 * to the apps' pollers directly with no Storage round-trip.
 */
export async function runHealthChecks(DB, opts = {}) {
  const rows = await DB.select(
    `rules?key=in.(${encodeURIComponent('kv:upload-manifest,kv:vas-state,kv:cb-config,kv:app-opened')})&select=key,updated_at,value`);
  const at = {}; let opened = null;
  for (const r of rows || []) { at[r.key] = r.updated_at; if (r.key === 'kv:app-opened') opened = (r.value && typeof r.value === 'object') ? r.value : {}; }

  /* Staff = a username that is not an agent's CB number. Filtered here rather
     than in PostgREST regex syntax so the query stays simple and indexable. */
  const logins = await DB.select(
    `auth_log?event=eq.login_ok&at=gt.${new Date(Date.now() - 26 * HOUR).toISOString()}&select=username&limit=500`)
    .catch(() => []);
  const staffLoginRecent = (logins || []).some((l) => !/^cb\d{1,5}$/i.test(String(l.username || '').trim()));

  /* the digest's OWN stamps — the rules row's updated_at does not move when the republish
     tool writes Storage directly, so read the payload (one small object every ten minutes) */
  let digestMonth = null, digestAt = null, reach = null, expectedReach = null;
  try {
    const dr = await DB.select(`rules?key=eq.${encodeURIComponent('kv:agent-digest')}&select=value`);
    const v = dr && dr[0] && dr[0].value;
    let payload = v ? String(v.data || '') : '';
    if (!payload && v && v.store) payload = (await DB.storageGet('raw', String(v.store).replace(/^raw\//, ''))) || '';
    if (payload) { const d = JSON.parse(payload); digestMonth = String((d.period || {}).from || '').slice(0, 7) || null; digestAt = d.updatedAt || null; reach = d.dataReach || null; expectedReach = d.expectedReach || null; }
  } catch (e) { /* unreadable digest: the freshness alert has nothing to say; the portal will say plenty */ }
  const curMonth = new Date(Date.now() + 2 * 3600000).toISOString().slice(0, 7);
  /* the scheduled runner's own report (tools/job-status.mjs); null = row absent, undefined = unreadable */
  let jobs;
  try { const jr = await DB.select('rules?key=eq.' + encodeURIComponent('kv:jobs-status') + '&select=value');
    if (!jr || !jr.length) jobs = null; else { const v = jr[0].value || {}; jobs = v.steps ? v : (v.data ? JSON.parse(v.data) : null); } }
  catch (e) { jobs = undefined; }
  /* who owns each source's daily drop */
  let cadence = [];
  try { cadence = (await DB.select('source_cadence?select=source,owner,label,grace_hours,saturday')) || []; } catch (e) { cadence = []; }
  /* the rake's own health (migration-028): stuck, failed, dead-lettered */
  let rake = null;
  try { rake = await DB.rpc('rake_health', {}); } catch (e) { rake = null; }
  /* the disk (migration-041): size, WAL, dead tuples — the 15 Sep disk-full had no warning at all */
  let dbh = null;
  try { dbh = await DB.rpc('db_health', {}); } catch (e) { dbh = null; }
  /* the Worker's last ask for the GitHub tick (runner.mjs) — so the alert says what was already done */
  let kick = null;
  try { const kr = await DB.select('rules?key=eq.' + encodeURIComponent('kv:runner-kick') + '&select=value'); kick = kr && kr[0] && kr[0].value ? JSON.parse(kr[0].value.data || 'null') : null; } catch (e) { kick = null; }
  /* the newest Ops fact store — what Ops has actually taken from the archive */
  let opsFactsAt = null;
  try { const fr = await DB.select('rules?key=like.' + encodeURIComponent('kv:cb-facts-%') + '&select=key,updated_at&order=updated_at.desc&limit=20');
    for (const r of fr || []) { if (/SES_/.test(r.key)) continue; opsFactsAt = r.updated_at; break; } }
  catch (e) { opsFactsAt = null; }
  /* the database's own view of list ↔ logins ↔ campaigns; unreadable = no opinion, never a false alarm */
  let integrity = [];
  try { integrity = (await DB.select('agent_list_integrity?failures=gt.0&select=check_name,severity,failures,detail')) || []; }
  catch (e) { integrity = []; }
  /* what the dashboards could NOT save in the last hour, by their own report */
  let saveFailures = [];
  try { saveFailures = (await DB.select('save_failures?at=gte.' + new Date(Date.now() - HOUR).toISOString() + '&select=at,username,app,key,status&order=at.desc&limit=100')) || []; }
  catch (e) { saveFailures = []; }
  /* the Agent List: newest upload in the archive vs the roster of record, and any stored refusal */
  let roster = null;
  try {
    const rr = await DB.select('rules?key=in.(' + encodeURIComponent('kv:roster-current,kv:roster-refused,kv:upload-manifest') + ')&select=key,value');
    const byKey = {}; for (const r of rr || []) byKey[r.key] = r.value;
    const files = ((byKey['kv:upload-manifest'] || {}).files) || [];
    const newest = files.filter((f) => /agent list|matrix/i.test(String(f.n || f.name || ''))).map((f) => f.at).sort().pop() || null;
    const rec = byKey['kv:roster-current'] || {};
    const refused = byKey['kv:roster-refused'] ? (typeof byKey['kv:roster-refused'].data === 'string' ? JSON.parse(byKey['kv:roster-refused'].data) : byKey['kv:roster-refused']) : null;
    roster = { newestListAt: newest, recordUploadedAt: rec.uploaded_at || null, refused, review: rec.review || null };
  } catch (e) { roster = null; }
  /* ASKING FOR HELP MUST WORK (Nick, 2026-09-21: "always make sure if I ask the team leader for
     help or ask campaign manager it works"). Both legs live in one HighLevel location: the agent's
     "Agent Help Center" pipeline (help.mjs) and the team leader's "Campaign Assistance" pipeline
     (assist.mjs). Probe the location every sentinel run with the same key the requests use —
     a revoked key, a deleted location or a dead endpoint is then a banner before it is an
     agent's 502. Read-only: one GET, nothing minted. */
  const helpCenter = await probeHelpCenter(env);
  const alerts = evaluateFreshness({
    helpCenter,
    manifestAt: at['kv:upload-manifest'], vasAt: at['kv:vas-state'], opsAt: at['kv:cb-config'],
    staffLoginRecent, now: Date.now(), digestMonth, digestAt, curMonth, integrity, opened, saveFailures, opsFactsAt, jobs, cadence, reach, expectedReach, kick, rake, roster, db: dbh, runnerExpected: !!opts.runnerExpected,
  });

  const prev = await DB.select(`rules?key=eq.${encodeURIComponent(ALERTS_KEY)}&select=value`).catch(() => null);
  let prevAlerts = [];
  try { prevAlerts = JSON.parse((prev && prev[0] && prev[0].value && prev[0].value.data) || '{}').alerts || []; } catch (e) {}

  /* Write when the alerts CHANGED — and once when the key does not exist yet, so
     "the sentinel is healthy" and "the sentinel never ran" stop looking identical.
     After that first write, a healthy tick costs one select and no write; checked_at
     is only refreshed when something changes, so the row's updated_at going stale
     for days while alerts sit empty is itself the sign to look at the cron. */
  const neverWritten = !(prev && prev.length);
  /* the MESSAGE counts too (2026-09-08): a wording change — UTC → SAST — must reach the banner without waiting for an alert to come or go */
  let prevCadence = null;
  try { prevCadence = JSON.parse((prev && prev[0] && prev[0].value && prev[0].value.data) || '{}').cadence || null; } catch (e) {}
  const changed = neverWritten || JSON.stringify(alerts.map((a) => a.id + a.since + a.message))
    !== JSON.stringify(prevAlerts.map((a) => a.id + a.since + a.message))
    || JSON.stringify(prevCadence) !== JSON.stringify(cadence);
  if (changed) {
    await DB.insert('rules', [{ key: ALERTS_KEY,
      value: { data: JSON.stringify({ alerts, checked_at: new Date().toISOString(), cadence }) },
      updated_by: 'health-cron', updated_at: new Date().toISOString() }], true);
  }
  if (alerts.length) console.warn('[health] ' + alerts.map((a) => a.id).join(', ') + ' — ' + alerts[0].message);
  return { alerts, changed };
}

/**
 * DAILY STATE SNAPSHOTS — the recovery point this incident never had.
 *
 * The 28–31 Aug data came back only because the raw-file relay happens to
 * archive uploads; a loss in a store the relay does not cover would have been
 * permanent. One gzipped copy per store per day it changed, kept 30 days:
 * vas-state is ~0.6 MB compressed, so a month of both stores is ~20 MB.
 *
 * "First tick after the key changed today": snapshot exists for today → skip;
 * key not updated today (SAST) → nothing new to protect → skip. So the write
 * happens once, within ten minutes of the day's first successful save.
 */
export async function dailySnapshots(env, DB) {
  const sHdr = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY };
  const today = new Date(Date.now() + 2 * HOUR).toISOString().slice(0, 10);   // SAST, no DST
  const out = [];
  /* THE FACT STORES ARE SNAPSHOT TOO (2026-08-31). The two state blobs were the only
     things with a way back, and they are not where the uploaded source data lives: the nine
     cb-facts-* objects are 142 MB whose only copy was the live object — the very set the
     dedupe backfill rewrites. One cheap select finds the ones that actually changed today,
     so a quiet day still costs a single query and no copies. Fourteen days of history each,
     against thirty for the state blobs: they are larger, they change far less often, and a
     fortnight is well past the point anyone notices a bad upload. */
  const factKeys = [];
  try {
    /* SAST MIDNIGHT, EXPRESSED IN UTC. `today` is the SAST date (Date.now()+2h); pasting
       'T00:00:00Z' onto it asks for 02:00 SAST, so a store written between midnight and 2am
       fell before the cutoff all day and the next day's cutoff had already moved past it —
       a nightly two-hour window whose uploads were never snapshotted. */
    const since = new Date(Date.parse(today + 'T00:00:00Z') - 2 * HOUR).toISOString();
    const changed = await DB.select(
      `rules?key=like.${encodeURIComponent('kv:cb-facts-%')}&updated_at=gte.${since}&select=key`).catch(() => []);
    for (const r of (changed || [])) factKeys.push(String(r.key).replace(/^kv:/, ''));
  } catch { /* a failed lookup must not cost the state snapshots below */ }

  for (const key of ['vas-state', 'cb-config', ...factKeys]) {
    const keep = key.startsWith('cb-facts-') ? 14 : 30;
    const ptr = await DB.select(`rules?key=eq.${encodeURIComponent('kv:' + key)}&select=updated_at`).catch(() => null);
    const upd = ptr && ptr[0] && ptr[0].updated_at;
    if (!upd || new Date(Date.parse(upd) + 2 * HOUR).toISOString().slice(0, 10) !== today) continue;

    const snapPath = `raw/kv-history/${key}/${today}.json.gz`;
    const have = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${snapPath}`, { method: 'HEAD', headers: sHdr });
    if (have.ok) continue;                                   // today's copy already exists

    const src = await fetch(`${env.SUPABASE_URL}/storage/v1/object/raw/kv/${key}`, { headers: sHdr });
    if (!src.ok) continue;
    const gz = await new Response(src.body.pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
    const put = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${snapPath}`, {
      method: 'POST', headers: { ...sHdr, 'Content-Type': 'application/gzip', 'x-upsert': 'true' }, body: gz });
    if (put.ok) out.push(key + ' → ' + snapPath + ' (' + Math.round(gz.byteLength / 1024) + ' KB)');

    /* prune beyond 30 — list is newest-last by name because the name IS the date */
    const list = await fetch(`${env.SUPABASE_URL}/storage/v1/object/list/raw`, {
      method: 'POST', headers: { ...sHdr, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix: `kv-history/${key}/`, limit: 100, sortBy: { column: 'name', order: 'asc' } }) });
    if (list.ok) {
      const names = ((await list.json()) || []).map((o) => o.name).filter((n) => /\.json\.gz$/.test(n));
      for (const n of names.slice(0, Math.max(0, names.length - keep)))
        await fetch(`${env.SUPABASE_URL}/storage/v1/object/raw/kv-history/${key}/${n}`, { method: 'DELETE', headers: sHdr });
    }
  }
  return out;
}

/**
 * HYGIENE — probe keys and old write-log rows must never become the thing
 * that grows instead. Tests delete their own zz-* keys; this is the belt to
 * that braces (a test killed mid-run leaves its probe behind).
 */
export async function hygiene(env, DB) {
  const cutoff = new Date(Date.now() - 24 * HOUR).toISOString();
  const stale = await DB.select(`rules?key=like.${encodeURIComponent('kv:zz-%')}&updated_at=lt.${cutoff}&select=key`).catch(() => []);
  for (const r of stale || []) {
    const k = String(r.key).slice(3);
    await fetch(`${env.SUPABASE_URL}/storage/v1/object/raw/kv/${k}`, { method: 'DELETE',
      headers: { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY } }).catch(() => {});
    await DB.del(`rules?key=eq.${encodeURIComponent(r.key)}`).catch(() => {});
  }
  await DB.del(`kv_write_log?at=lt.${new Date(Date.now() - 90 * 24 * HOUR).toISOString()}`).catch(() => {});

  /* EXPIRED SESSIONS ARE NOT KEPT (audit, 2026-08-31). 436 of the 451 rows in
     app_sessions were already past their expiry: dead tokens that authenticate nobody but
     sit in the table growing, on a table that exists to answer "is this token still good".
     Sign-out and expiry are different things and neither was clearing them. A day of grace
     past expiry so a token that dies mid-request is still explainable in the log, then it
     goes. Deleting an EXPIRED row signs nobody out — the session was already over. The
     audit trail of who signed in when lives in auth_log, which this never touches. */
  await DB.del(`app_sessions?expires_at=lt.${new Date(Date.now() - 24 * HOUR).toISOString()}`).catch(() => {});

  return (stale || []).length;
}

/** One row per acknowledged write — called from the /api/kv POST handler. */
export function logKvWrite(DB, key, bytes, username) {
  return DB.insert('kv_write_log', [{ key, bytes, username: username || '' }]).catch(() => {});
}

/**
 * THE COACHING HUB AND THE KPI HUB, PROXIED.
 *
 * WHY A PROXY AND NOT A FETCH FROM THE BROWSER — this is the whole point of the
 * file. Neither Convex deployment authenticates anything. Every query and every
 * mutation takes the leader's id as an ARGUMENT, so a caller who supplies a
 * different id reads and writes a different leader's records. The hubs' own
 * "Unauthorized" checks compare a record's owner against that same
 * caller-supplied id, which stops you editing a form you did not claim and
 * nothing else.
 *
 * So the browser never talks to Convex. Every call goes through here, and the
 * leader id is taken from `app_users.hub_ids` on the SESSION — resolved once by
 * tools/map-hub-ids.mjs and used verbatim. A team leader cannot ask for another
 * leader's sessions because there is no request shape in which they could say
 * whose sessions they want.
 *
 * Agents never reach any of this: the Worker's role lockdown refuses them every
 * route, and these routes additionally require role team_leader.
 */

const COACHING = 'https://acrobatic-setter-212.eu-west-1.convex.cloud';
const KPI = 'https://cautious-bass-675.eu-west-1.convex.cloud';

/* The six coaching products, and the only tables this proxy will touch. An
   allow-list, not a passthrough: `type` arrives from the browser, so anything
   not on this list must not become a Convex function name. */
export const COACH_TABLES = {
  formalCoachingCalls: 'Formal Coaching',
  informalCoaching: 'Informal Coaching',
  qualityCoaching: 'Coaching Scorecard',
  leadManagementCoaching: 'Lead Management Coaching',
  groupCoaching: 'Group Coaching',
  qualityAssuranceCoaching: 'Quality Assurance Coaching',
};

/* WHAT A CREATE MAY CARRY, PER TABLE — mirrored from each product's Convex
   create mutation, because Convex validates arguments strictly: one field
   it does not declare rejects the whole write, and one required string left out
   does the same. The previous four-field version of this list was written for a
   quick-capture box and did both — it sent qualityCoaching fields that table has
   never had, and omitted the signDate / teamLeader / sign-date strings that
   Lead Management and QA declare as required.

   required are that table's non-optional strings: absent ones are sent as ''
   rather than dropped, so a half-filled form saves as a draft-shaped record
   instead of failing at the hub. Anything not named here is DROPPED — a create
   is a write into a system we do not own, so it carries exactly what it means to. */

const SCORECARD_CRITERIA = [
  'tonePaceConfidence', 'emphasisOnKeywords', 'introScriptFollowed', 'confirmedDetails',
  'factFind', 'listeningInterruptionControl', 'buildRapport', 'productExplained',
  'empathyProfessionalism', 'pitchScriptFollowed', 'priceExplained', 'acknowledgedObjection',
  'respondedConfidently', 'maintainedControl', 'quoteScriptFollowed', 'clearCloseAttempted',
  'confirmedNextSteps', 'professionalCallWrapUp', 'trackingReferrals',
];

const CREATE_SPEC = {
  informalCoaching: {
    fields: ['date', 'campaign', 'agentName', 'teamLeaderFeedback', 'agentFeedback', 'wayForward',
      'employeeNumber', 'employeeCode', 'clusterTeamLeaderFeedback', 'clusterAgentCommitment',
      'clusterNextAction', 'agentSignature', 'teamLeaderSignature'],
    required: ['date', 'campaign', 'agentName', 'teamLeaderFeedback', 'agentFeedback', 'wayForward'],
  },
  formalCoachingCalls: {
    fields: ['date', 'campaign', 'agentName', 'calls', 'supportProvided', 'agreedPlanAgentFeedback',
      'employeeNumber', 'employeeCode', 'clusterGap', 'clusterAgentCommitment',
      'clusterSupportProvided', 'agentSignature', 'teamLeaderSignature'],
    required: ['date', 'campaign', 'agentName', 'supportProvided', 'agreedPlanAgentFeedback'],
    calls: true,
  },
  qualityAssuranceCoaching: {
    fields: ['agentName', 'employeeNumber', 'employeeCode', 'teamLeader', 'campaign', 'dateOfCoaching',
      'qaEvaluationDate', 'callDate', 'caseNumbers', 'qaScore', 'developmentAreas',
      'teamLeaderComments', 'agentFeedback', 'clusterPurpose', 'clusterDevelopmentArea',
      'clusterTeamLeaderGuidance', 'clusterAgentCommitment', 'agentSignature', 'agentSignDate',
      'teamLeaderSignature', 'teamLeaderSignDate'],
    required: ['agentName', 'employeeNumber', 'teamLeader', 'campaign', 'dateOfCoaching',
      'qaEvaluationDate', 'callDate', 'caseNumbers', 'qaScore', 'developmentAreas',
      'teamLeaderComments', 'agentFeedback', 'agentSignDate', 'teamLeaderSignDate'],
    noLeaderName: true,
  },
  leadManagementCoaching: {
    fields: ['agentName', 'employeeNumber', 'employeeCode', 'sosName', 'campaign', 'date', 'purpose',
      'developmentAreas', 'sosComments', 'agentFeedback', 'clusterPurpose', 'clusterGap',
      'clusterGuidance', 'clusterAgentCommitment', 'agentSignature', 'sosSignature', 'signDate'],
    required: ['agentName', 'employeeNumber', 'sosName', 'campaign', 'date', 'developmentAreas',
      'sosComments', 'agentFeedback', 'signDate'],
    /* A union of three literals — anything else fails at the hub, so it is
       checked here where the message can say so. */
    enums: { purpose: ['improve_lead_management', 'maximize_contact', 'increase_conversion'] },
    noLeaderName: true,
  },
  groupCoaching: {
    fields: ['date', 'campaign', 'coachingDetails', 'feedback1', 'feedback2', 'feedback3', 'employeeSignoffs'],
    required: ['date', 'campaign', 'coachingDetails', 'feedback1', 'feedback2', 'feedback3'],
    signoffs: true,
  },
  qualityCoaching: {
    /* The scorecard names the leader tlName and takes no campaign and no CB. */
    fields: ['date', 'agentName', 'tlName', 'criteria', 'call1Notes', 'call2Notes', 'call3Notes'],
    required: ['date', 'agentName', 'tlName', 'call1Notes', 'call2Notes', 'call3Notes'],
    scorecard: true,
    noLeaderName: true,
  },
};

/* A signature is a base64 PNG. Bounded because it crosses two networks and lands
   in someone else's database, and rejected outright if it is not an image — a
   text blob in that column would render as a broken document forever. */
const MAX_SIG = 250000;
const sig = (v) => (typeof v === 'string' && v.startsWith('data:image/') && v.length <= MAX_SIG ? v : '');

const str = (v) => (v == null ? '' : String(v));

async function convex(base, kind, path, args) {
  const r = await fetch(base + '/api/' + kind, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, args }),
  });
  if (!r.ok) throw new Error(`${path} → HTTP ${r.status}`);
  const j = await r.json();
  if (j.status !== 'success') throw new Error(`${path} → ${j.errorMessage || 'failed'}`);
  return j.value;
}
const q = (base, path, args) => convex(base, 'query', path, args || {});
const m = (base, path, args) => convex(base, 'mutation', path, args || {});

/** The ids resolved for this session, or null with the reason. */
export function hubIdsOf(user) {
  if (user.role !== 'team_leader') return { error: 'The hubs are a team leader tool.', status: 403 };
  const ids = user.hub_ids || null;
  if (!ids || (!ids.coaching && !ids.kpi))
    return { error: 'Your account is not linked to the hubs yet. Ask Nick to run tools/map-hub-ids.mjs.', status: 409 };
  return { ids };
}

/* Signatures are megabytes of base64 and must not travel to a browser that has
   no use for them — the same rule the read-only snapshot already follows. */
const strip = (rec) => {
  const out = {};
  for (const k of Object.keys(rec)) {
    const v = rec[k];
    if (/signature/i.test(k) || (typeof v === 'string' && v.startsWith('data:image'))) continue;
    out[k] = v;
  }
  return out;
};

/** Everything this leader has in the Coaching Hub, by product. */
export async function coachingList(ids) {
  if (!ids.coaching) return { error: 'You are not on the Coaching Hub yet.', linked: false };
  const out = { linked: true, byType: {}, sessions: [] };
  const jobs = Object.keys(COACH_TABLES).map((t) =>
    q(COACHING, `${t}:list`, { teamLeaderId: ids.coaching })
      .then((rows) => ({ t, rows: Array.isArray(rows) ? rows : [] }))
      .catch((e) => ({ t, rows: [], error: String(e.message || e) })));
  const res = await Promise.all(jobs);
  const errors = [];
  for (const r of res) {
    if (r.error) errors.push(`${r.t}: ${r.error}`);
    out.byType[COACH_TABLES[r.t]] = r.rows.length;
    for (const rec of r.rows)
      out.sessions.push({ ...strip(rec), _table: r.t, _label: COACH_TABLES[r.t] });
  }
  out.sessions.sort((a, b) => String(b.date || b.dateOfCoaching || '').localeCompare(String(a.date || a.dateOfCoaching || '')));
  if (errors.length) out.errors = errors;
  return out;
}

/** Create one coaching session. teamLeaderId comes from the session, always. */
export async function coachingCreate(ids, user, body) {
  if (!ids.coaching) return { error: 'You are not on the Coaching Hub yet.', status: 409 };
  const table = String(body.type || '');
  const spec = CREATE_SPEC[table];
  if (!COACH_TABLES[table] || !spec) return { error: 'Unknown coaching type.', status: 400 };

  const args = { teamLeaderId: ids.coaching };
  /* The scorecard, QA and Lead Management documents name the leader in their own
     field, so the generic one would be an argument they do not declare. */
  if (!spec.noLeaderName) args.teamLeaderName = user.full_name || user.username;

  for (const f of spec.fields) {
    const v = body[f];
    if (v === undefined || v === null) continue;
    if (/[Ss]ignature$/.test(f)) { const g = sig(v); if (g) args[f] = g; continue; }
    if (f === 'calls' || f === 'employeeSignoffs' || f === 'criteria') continue; // shaped below
    if (spec.enums && spec.enums[f]) { if (spec.enums[f].includes(String(v))) args[f] = String(v); continue; }
    if (v !== '') args[f] = str(v);
  }

  /* A required string the person left blank is sent EMPTY, not dropped: the hub
     declares it non-optional, so dropping it fails the write outright and loses
     everything they did fill in. */
  for (const f of spec.required) if (args[f] === undefined) args[f] = '';

  if (table !== 'groupCoaching' && !args.agentName)
    return { error: 'Choose the agent this session is for.', status: 400 };
  const dateField = table === 'qualityAssuranceCoaching' ? 'dateOfCoaching' : 'date';
  if (!args[dateField]) args[dateField] = new Date().toISOString().slice(0, 10);

  /* Three calls per formal session; each is a contact number and what came out
     of listening to it. Shaped here so a malformed array cannot reach Convex. */
  if (spec.calls) {
    const raw = Array.isArray(body.calls) ? body.calls : [];
    args.calls = raw.slice(0, 3).map((c) => ({
      contactNumber: str(c && c.contactNumber),
      developmentAreas: str(c && c.developmentAreas),
    }));
    while (args.calls.length < 3) args.calls.push({ contactNumber: '', developmentAreas: '' });
  }

  /* A group session is signed by everyone who attended. */
  if (spec.signoffs) {
    const raw = Array.isArray(body.employeeSignoffs) ? body.employeeSignoffs : [];
    args.employeeSignoffs = raw.slice(0, 40)
      .filter((r) => r && str(r.employeeName).trim())
      .map((r) => {
        const row = { employeeName: str(r.employeeName), date: str(r.date) };
        const g = sig(r.signature);
        if (g) row.signature = g;
        return row;
      });
  }

  /* Nineteen criteria × three calls. Every key must be present and every cell a
     string — the hub declares the whole object, not a partial one. */
  if (spec.scorecard) {
    const inC = (body.criteria && typeof body.criteria === 'object') ? body.criteria : {};
    const out = {};
    for (const k of SCORECARD_CRITERIA) {
      const c = inC[k] || {};
      out[k] = { call1: str(c.call1), call2: str(c.call2), call3: str(c.call3) };
    }
    args.criteria = out;
  }

  /* THE CB NUMBER IS DERIVED, NOT TYPED. The hub indexes on employeeCode
     ("CB287") while people type employeeNumber ("CB-287"); storing only what was
     typed is why 43 of its records carry stray spaces and cannot be looked up. */
  if (args.employeeNumber && !args.employeeCode) {
    const d = String(args.employeeNumber).replace(/[^0-9]/g, '');
    if (d) args.employeeCode = 'CB' + String(parseInt(d, 10));
  }
  const id = await m(COACHING, `${table}:create`, args);
  return { ok: true, id, table, label: COACH_TABLES[table] };
}

/** This leader's KPI forms. */
export async function kpiList(ids) {
  if (!ids.kpi) return { error: 'You are not on the KPI Hub yet.', linked: false };
  const rows = await q(KPI, 'forms:listByLeader', { leaderId: ids.kpi });
  return { linked: true, forms: (Array.isArray(rows) ? rows : []).map(strip) };
}

/* The three form types the KPI Hub offers. Allow-listed for the same reason as
   the coaching tables: `title` reaches Convex. */
export const KPI_TITLES = [
  'Monthly KPI Acknowledgement Form',
  'Nesting Phase KPI Acknowledgement Form',
  'Performance Improvement Program (PIP)',
];

/** Create / update / submit / delete a KPI form. leaderId is always the session's. */
export async function kpiWrite(ids, body) {
  if (!ids.kpi) return { error: 'You are not on the KPI Hub yet.', status: 409 };
  const act = String(body.action || 'create');

  if (act === 'create') {
    const title = String(body.title || '');
    if (!KPI_TITLES.includes(title)) return { error: 'Choose one of the KPI form types.', status: 400 };
    const now = new Date();
    const id = await m(KPI, 'forms:createForm', {
      leaderId: ids.kpi, title,
      weekLabel: String(body.weekLabel || 'Week 1 / 5'),
      month: String(body.month || now.toLocaleString('en-ZA', { month: 'long' })),
      year: Number(body.year) || now.getFullYear(),
    });
    /* An agent name is a separate patch in their model — do it here so the form
       arrives complete rather than as an untitled draft somebody must reopen. */
    if (body.agentName) await m(KPI, 'forms:updateForm', { formId: id, leaderId: ids.kpi, agentName: String(body.agentName) });
    return { ok: true, id };
  }

  const formId = String(body.formId || '');
  if (!formId) return { error: 'No form specified.', status: 400 };
  /* Every one of these passes leaderId, and the hub refuses when the form does
     not belong to it — so a form id guessed from another leader fails there as
     well as here. */
  if (act === 'submit') { await m(KPI, 'forms:submitForm', { formId, leaderId: ids.kpi }); return { ok: true }; }
  if (act === 'delete') { await m(KPI, 'forms:deleteForm', { formId, leaderId: ids.kpi }); return { ok: true }; }
  if (act === 'update') {
    const args = { formId, leaderId: ids.kpi };
    if (body.agentName !== undefined) args.agentName = String(body.agentName);
    if (body.formData !== undefined) args.formData = String(body.formData).slice(0, 20000);
    await m(KPI, 'forms:updateForm', args);
    return { ok: true };
  }
  return { error: 'Unknown action.', status: 400 };
}

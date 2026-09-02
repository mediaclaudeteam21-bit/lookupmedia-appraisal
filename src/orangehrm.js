// ---------------------------------------------------------------------------
// OrangeHRM client — ONE-WAY PUSH.
//
// The appraisal site owns the whole multi-rater review. OrangeHRM only ever
// receives the finished result, and it receives it in the place OrangeHRM was
// built for: the Performance module.
//
//   1. KPIs           — each role scorecard criterion becomes a KPI on that
//                       job title, rated 1–5, plus two extra KPIs for the
//                       pooled peer and upward averages.
//   2. Review         — Performance ▸ Manage Reviews gets a real review row
//                       for the person and cycle.
//   3. Evaluation     — the lead's per-criterion ratings and notes are written
//                       against those KPIs.
//   4. Final rating   — the blended score is written as the review's final
//                       rating and the review is completed.
//   5. Summary PDF    — optionally attached to the employee's PIM record.
//
// AUTH: OrangeHRM 5.5+ open source authenticates outside tools with OAuth2
// (authorization code + PKCE). Register this app once under
// Admin ▸ Configuration ▸ Register OAuth Client, then click Connect in the
// admin console. There is no API-key path in the free edition.
//
// SAFETY: ORANGEHRM_DRY_RUN defaults to true. In dry run nothing is sent —
// every call is returned as a plan you can read first.
// ---------------------------------------------------------------------------

const crypto = require('crypto');
const tokenStore = require('./tokenStore');

const cfg = () => ({
  baseUrl: (process.env.ORANGEHRM_BASE_URL || '').replace(/\/+$/, ''),
  clientId: process.env.ORANGEHRM_CLIENT_ID || '',
  clientSecret: process.env.ORANGEHRM_CLIENT_SECRET || '', // only for confidential clients
  redirectUri: process.env.ORANGEHRM_REDIRECT_URI || '',
  dryRun: String(process.env.ORANGEHRM_DRY_RUN ?? 'true').toLowerCase() !== 'false',
  // OrangeHRM insists on a reviewer for every review row. A handful of people
  // here have no internal supervisor by design (the CEO, and the contractors
  // who report to Barbara or the other external partners). Their reviews are
  // filed under this person instead. It changes who OrangeHRM lists as
  // reviewer — it does not change the rating, which still comes from whoever
  // actually filled in the form on this site.
  fallbackReviewerEmpNumber: process.env.ORANGEHRM_FALLBACK_REVIEWER_EMPNUMBER || ''
});

const api = (p) => `${cfg().baseUrl}/web/index.php/api/v2${p}`;
const web = (p) => `${cfg().baseUrl}/web/index.php${p}`;

function isConfigured() {
  const c = cfg();
  return Boolean(c.baseUrl && c.clientId && c.redirectUri);
}

// --- OAuth2 with PKCE -------------------------------------------------------

const pending = new Map(); // state -> { verifier, createdAt }

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function buildAuthorizeUrl() {
  const c = cfg();
  const verifier = base64url(crypto.randomBytes(64));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  const state = base64url(crypto.randomBytes(16));

  pending.set(state, { verifier, createdAt: Date.now() });
  for (const [k, v] of pending) if (Date.now() - v.createdAt > 10 * 60 * 1000) pending.delete(k);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: c.clientId,
    redirect_uri: c.redirectUri,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state
  });
  return web(`/oauth2/authorize?${params}`);
}

async function exchangeCode(code, state) {
  const c = cfg();
  const entry = pending.get(state);
  if (!entry) throw new Error('That sign-in link has expired. Start the connection again from the admin console.');
  pending.delete(state);

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: c.redirectUri,
    client_id: c.clientId,
    code_verifier: entry.verifier
  });
  if (c.clientSecret) body.set('client_secret', c.clientSecret);

  const res = await fetch(web('/oauth2/token'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    throw new Error(`OrangeHRM rejected the connection (${res.status}): ${json.error_description || json.error || 'no access token returned'}`);
  }
  return tokenStore.save(json);
}

async function refresh() {
  const c = cfg();
  const saved = tokenStore.load();
  if (!saved?.refreshToken) throw new Error('Not connected to OrangeHRM. Open the admin console and click Connect.');

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: saved.refreshToken,
    client_id: c.clientId
  });
  if (c.clientSecret) body.set('client_secret', c.clientSecret);

  const res = await fetch(web('/oauth2/token'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    tokenStore.clear();
    throw new Error('The OrangeHRM connection expired. Open the admin console and click Connect again.');
  }
  return tokenStore.save(json);
}

async function accessToken() {
  let saved = tokenStore.load();
  if (!saved) throw new Error('Not connected to OrangeHRM. Open the admin console and click Connect.');
  if (Date.now() >= saved.expiresAt) saved = await refresh();
  return saved.accessToken;
}

function connectionStatus() {
  const saved = tokenStore.load();
  return {
    configured: isConfigured(),
    connected: Boolean(saved),
    dryRun: cfg().dryRun,
    baseUrl: cfg().baseUrl || null,
    fallbackReviewerEmpNumber: cfg().fallbackReviewerEmpNumber || null,
    expiresAt: saved ? new Date(saved.expiresAt).toISOString() : null
  };
}

// --- Request plumbing -------------------------------------------------------

async function request(method, path, { body, query } = {}) {
  const token = await accessToken();
  const url = api(path) + (query ? `?${new URLSearchParams(query)}` : '');

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }

  if (!res.ok) {
    const message = json?.error?.message || json?.error || `HTTP ${res.status}`;
    const err = new Error(`${method} ${path} failed — ${message}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

const get = (p, query) => request('GET', p, { query });
const post = (p, body) => request('POST', p, { body });
const put = (p, body) => request('PUT', p, { body });

// --- Reference data ---------------------------------------------------------

async function listJobTitles() {
  const res = await get('/admin/job-titles', { limit: 0 });
  return res.data || [];
}

async function listEmployees() {
  const res = await get('/pim/employees', { limit: 0, includeEmployees: 'onlyCurrent', model: 'detailed' });
  return (res.data || []).map((e) => ({
    empNumber: e.empNumber,
    employeeId: e.employeeId,
    name: [e.firstName, e.middleName, e.lastName].filter(Boolean).join(' '),
    jobTitle: e.jobTitle?.title || null,
    jobTitleId: e.jobTitle?.id || null,
    supervisors: e.supervisors || []
  }));
}

async function listSupervisors(empNumber) {
  const res = await get(`/pim/employees/${empNumber}/supervisors`, { limit: 0 });
  return res.data || [];
}

// --- 1. KPIs ----------------------------------------------------------------

async function listKpis(jobTitleId) {
  const res = await get('/performance/kpis', { limit: 0, ...(jobTitleId ? { jobTitleId } : {}) });
  return res.data || [];
}

async function createKpi({ title, jobTitleId, minRating = 1, maxRating = 5 }) {
  const res = await post('/performance/kpis', { title, jobTitleId, minRating, maxRating, isDefault: false });
  return res.data;
}

/**
 * Make sure every KPI this role needs exists on that job title. Existing KPIs
 * with the same title are reused, never duplicated — so this is safe to run
 * again after adding a criterion.
 */
async function ensureKpis({ jobTitleId, kpiTitles }) {
  const existing = await listKpis(jobTitleId);
  const byTitle = new Map(existing.map((k) => [k.title.trim().toLowerCase(), k]));

  const created = [];
  const reused = [];
  for (const title of kpiTitles) {
    const hit = byTitle.get(title.trim().toLowerCase());
    if (hit) { reused.push(hit); continue; }
    const made = await createKpi({ jobTitleId, title });
    byTitle.set(title.trim().toLowerCase(), made);
    created.push(made);
  }
  return { created, reused, all: [...byTitle.values()] };
}

// --- 2–4. Reviews -----------------------------------------------------------

const asDate = (d) => (d instanceof Date ? d : new Date(d)).toISOString().slice(0, 10);

async function createReview({ empNumber, reviewerEmpNumber, startDate, endDate, dueDate, activate = true }) {
  const res = await post('/performance/manage/reviews', {
    empNumber: Number(empNumber),
    reviewerEmpNumber: Number(reviewerEmpNumber),
    startDate: asDate(startDate),
    endDate: asDate(endDate),
    dueDate: asDate(dueDate),
    activate
  });
  return res.data;
}

async function getSupervisorEvaluation(reviewId) {
  const res = await get(`/performance/reviews/${reviewId}/evaluation/supervisor`, { limit: 0 });
  return { rows: res.data || [], kpis: res.meta?.kpis || [], meta: res.meta || {} };
}

/**
 * Write the lead's ratings against the review's KPIs.
 *
 * The rating rows come back from the GET above already lined up with the KPIs
 * for that review, so we match on KPI id and send the row ids back. If the
 * instance turns out to key this by KPI id instead, the fallback below retries
 * that shape rather than failing the whole push — OrangeHRM has moved this
 * field between point releases.
 */
async function putSupervisorEvaluation(reviewId, ratingsByKpiId, generalComment) {
  const { rows } = await getSupervisorEvaluation(reviewId);
  const rowByKpi = new Map(rows.map((r) => [r.kpi?.id, r]));

  const ratings = [];
  for (const [kpiId, value] of ratingsByKpiId) {
    const row = rowByKpi.get(Number(kpiId));
    ratings.push({
      kpiId: Number(kpiId),
      rating: value.rating,
      comment: (value.comment || '').slice(0, 2000)
    });
  }

  const payload = { ratings, generalComment: (generalComment || '').slice(0, 2000) };
  try {
    return await put(`/performance/reviews/${reviewId}/evaluation/supervisor`, payload);
  } catch (err) {
    if (err.status !== 422 && err.status !== 400) throw err;
    // Retry keyed by KPI id.
    const alt = {
      ratings: [...ratingsByKpiId].map(([kpiId, value]) => ({
        kpiId: Number(kpiId), rating: value.rating, comment: (value.comment || '').slice(0, 2000)
      })),
      generalComment: payload.generalComment
    };
    return put(`/performance/reviews/${reviewId}/evaluation/supervisor`, alt);
  }
}

async function finaliseReview(reviewId, { finalRating, finalComment, completedDate }) {
  return put(`/performance/reviews/${reviewId}/evaluation/final`, {
    finalRating: String(finalRating),
    completedDate: asDate(completedDate || new Date()),
    finalComment: (finalComment || '').slice(0, 2000),
    complete: true
  });
}

// --- 5. Summary PDF on the employee record ----------------------------------

async function attachPdf({ empNumber, pdfBuffer, fileName, description }) {
  return post(`/pim/employees/${empNumber}/screen/personal/attachments`, {
    attachment: {
      name: fileName,
      type: 'application/pdf',
      base64: pdfBuffer.toString('base64'),
      size: pdfBuffer.length
    },
    description: (description || '').slice(0, 200)
  });
}

module.exports = {
  cfg, isConfigured, connectionStatus,
  buildAuthorizeUrl, exchangeCode, refresh, tokenStore,
  get, post, put,
  listJobTitles, listEmployees, listSupervisors,
  listKpis, createKpi, ensureKpis,
  createReview, getSupervisorEvaluation, putSupervisorEvaluation, finaliseReview,
  attachPdf
};

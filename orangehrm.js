// -----------------------------------------------------------------------
// OrangeHRM integration — ONE-WAY PUSH ONLY. This app never reads from
// OrangeHRM or touches its Performance module; it only attaches a finished
// review PDF to the right employee record once you click Send.
//
// AUTH: the free/open-source edition of OrangeHRM doesn't have a separate
// API-key/OAuth path for outside tools — its API is the same one the
// browser calls, secured by a logged-in session cookie. So this logs in
// exactly like a browser would (submits the login form, keeps the cookie),
// then calls the same PIM attachment endpoint used for contractor
// contracts.
//
// This has NOT been run against your live instance. Test with
// ORANGEHRM_DRY_RUN=true first (default) — it logs/returns what it would
// send without contacting OrangeHRM — then flip it off once verified.
// If the login step fails on your instance, the most likely fix is the
// `_csrf_token` field name below, which can vary slightly by OrangeHRM
// point release.
// -----------------------------------------------------------------------

const BASE_URL = process.env.ORANGEHRM_BASE_URL || '';
const USERNAME = process.env.ORANGEHRM_USERNAME || '';
const PASSWORD = process.env.ORANGEHRM_PASSWORD || '';
const DRY_RUN = String(process.env.ORANGEHRM_DRY_RUN || 'true').toLowerCase() !== 'false';

function isConfigured() {
  return Boolean(BASE_URL && USERNAME && PASSWORD);
}

function cookieHeaderFrom(setCookieValues) {
  return setCookieValues.map((c) => c.split(';')[0]).join('; ');
}

async function login() {
  if (!isConfigured()) {
    throw new Error('OrangeHRM is not configured. Set ORANGEHRM_BASE_URL, ORANGEHRM_USERNAME, ORANGEHRM_PASSWORD in .env');
  }

  const loginPageUrl = `${BASE_URL.replace(/\/$/, '')}/web/index.php/auth/login`;

  const getRes = await fetch(loginPageUrl);
  const getCookies = getRes.headers.getSetCookie ? getRes.headers.getSetCookie() : [];
  const html = await getRes.text();

  const csrfMatch = html.match(/name=["']_csrf_token["']\s+value=["']([^"']+)["']/i);
  const csrfToken = csrfMatch ? csrfMatch[1] : null;
  const cookieHeader = cookieHeaderFrom(getCookies);

  const form = new URLSearchParams();
  form.set('username', USERNAME);
  form.set('password', PASSWORD);
  if (csrfToken) form.set('_csrf_token', csrfToken);

  const postRes = await fetch(loginPageUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookieHeader },
    body: form.toString(),
    redirect: 'manual'
  });

  const postCookies = postRes.headers.getSetCookie ? postRes.headers.getSetCookie() : [];
  const finalCookieHeader = cookieHeaderFrom([...getCookies, ...postCookies]);

  if (postRes.status !== 302 && postRes.status !== 200) {
    throw new Error(`OrangeHRM login did not behave as expected (status ${postRes.status}). The login form may have changed.`);
  }

  return { cookieHeader: finalCookieHeader, csrfToken };
}

/**
 * @param {object} opts
 * @param {string|number} opts.orangehrmEmployeeId
 * @param {Buffer} opts.pdfBuffer
 * @param {string} opts.fileName
 * @param {string} opts.comment
 */
async function pushReviewSummary({ orangehrmEmployeeId, pdfBuffer, fileName, comment }) {
  if (!orangehrmEmployeeId) {
    return { ok: false, skipped: true, reason: 'No OrangeHRM Employee ID was entered on the form — add it and try again.' };
  }

  if (DRY_RUN) {
    return {
      ok: true,
      dryRun: true,
      wouldSendTo: `${BASE_URL || '(set ORANGEHRM_BASE_URL)'}/web/index.php/api/v2/pim/employees/${orangehrmEmployeeId}/attachments`,
      fileName,
      comment
    };
  }

  try {
    const { cookieHeader, csrfToken } = await login();
    const endpoint = `${BASE_URL.replace(/\/$/, '')}/web/index.php/api/v2/pim/employees/${orangehrmEmployeeId}/attachments`;

    const body = {
      employeeId: orangehrmEmployeeId,
      fileName,
      fileType: 'application/pdf',
      comment,
      attachment: pdfBuffer.toString('base64')
    };

    const headers = { 'Content-Type': 'application/json', Cookie: cookieHeader };
    if (csrfToken) headers['X-CSRF-TOKEN'] = csrfToken;

    const res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, status: res.status, reason: `OrangeHRM rejected the upload (HTTP ${res.status}).`, detail: text.slice(0, 500) };
    }

    return { ok: true, status: res.status };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

module.exports = { isConfigured, pushReviewSummary, DRY_RUN };

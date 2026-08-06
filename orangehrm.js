// -----------------------------------------------------------------------
// OrangeHRM integration -- real OAuth2 + PKCE, the way OrangeHRM 5.x
// Starter actually wants external tools to authenticate (confirmed against
// OrangeHRM's own API docs: api-starter-orangehrm.readme.io). This is NOT
// the same as logging into the website like a browser -- it's a separate,
// proper API auth flow.
//
// ONE-TIME SETUP (see README):
//   1. In OrangeHRM: Admin > Configuration > Register OAuth Client.
//      Redirect URI must be exactly: <this app's URL>/oauth/callback
//      Copy the Client ID it gives you into ORANGEHRM_CLIENT_ID.
//   2. Visit <this app's URL>/oauth/start in your browser (while logged
//      into OrangeHRM) and click "Allow Access" once.
//   3. That's it -- tokens are saved to disk and refreshed automatically
//      from then on. Pushing a review never needs a browser again.
// -----------------------------------------------------------------------

const crypto = require('crypto');
const tokenStore = require('./tokenStore');

const BASE_URL = (process.env.ORANGEHRM_BASE_URL || '').replace(/\/$/, '');
const CLIENT_ID = process.env.ORANGEHRM_CLIENT_ID || '';
const REDIRECT_URI = process.env.ORANGEHRM_REDIRECT_URI || '';
const DRY_RUN = String(process.env.ORANGEHRM_DRY_RUN || 'true').toLowerCase() !== 'false';

function isConfigured() {
  return Boolean(BASE_URL && CLIENT_ID && REDIRECT_URI);
}

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// In-memory map of state -> code_verifier for the few seconds between
// starting the OAuth flow and OrangeHRM redirecting back with the code.
const pendingVerifiers = new Map();

function buildAuthorizeUrl() {
  if (!isConfigured()) {
    throw new Error('Set ORANGEHRM_BASE_URL, ORANGEHRM_CLIENT_ID, and ORANGEHRM_REDIRECT_URI first.');
  }
  const verifier = base64url(crypto.randomBytes(64));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  const state = base64url(crypto.randomBytes(16));
  pendingVerifiers.set(state, verifier);
  // Clean up if it's never used (avoid an unbounded map on a long-running server)
  setTimeout(() => pendingVerifiers.delete(state), 10 * 60 * 1000).unref?.();

  const url = new URL(`${BASE_URL}/web/index.php/oauth2/authorize`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('state', state);
  return url.toString();
}

async function handleCallback(code, state) {
  const verifier = pendingVerifiers.get(state);
  pendingVerifiers.delete(state);
  if (!verifier) {
    throw new Error("That authorization link expired or was already used -- go back to /oauth/start and try again.");
  }

  const body = new URLSearchParams();
  body.set('grant_type', 'authorization_code');
  body.set('code', code);
  body.set('client_id', CLIENT_ID);
  body.set('redirect_uri', REDIRECT_URI);
  body.set('code_verifier', verifier);

  const res = await fetch(`${BASE_URL}/web/index.php/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`OrangeHRM rejected the token exchange (HTTP ${res.status}): ${text.slice(0, 300)}`);
  }

  const json = JSON.parse(text);
  tokenStore.write({
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_at: Date.now() + (json.expires_in || 1800) * 1000
  });
  return json;
}

async function refreshAccessToken(refreshToken) {
  const body = new URLSearchParams();
  body.set('grant_type', 'refresh_token');
  body.set('refresh_token', refreshToken);
  body.set('client_id', CLIENT_ID);

  const res = await fetch(`${BASE_URL}/web/index.php/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`OrangeHRM rejected the refresh request (HTTP ${res.status}): ${text.slice(0, 300)}`);
  }

  const json = JSON.parse(text);
  const tokens = {
    access_token: json.access_token,
    refresh_token: json.refresh_token, // OrangeHRM issues a new one each refresh
    expires_at: Date.now() + (json.expires_in || 1800) * 1000
  };
  tokenStore.write(tokens);
  return tokens;
}

async function getValidAccessToken() {
  const saved = tokenStore.read();
  if (!saved) {
    throw new Error('Not connected to OrangeHRM yet -- visit /oauth/start once to connect it, then try again.');
  }
  // Refresh a bit early (60s buffer) rather than right at the edge of expiry
  if (Date.now() < saved.expires_at - 60000) {
    return saved.access_token;
  }
  const refreshed = await refreshAccessToken(saved.refresh_token);
  return refreshed.access_token;
}

/**
 * @param {object} opts
 * @param {string|number} opts.orangehrmEmployeeId - the empNumber
 * @param {Buffer} opts.pdfBuffer
 * @param {string} opts.fileName
 * @param {string} opts.comment
 */
async function pushReviewSummary({ orangehrmEmployeeId, pdfBuffer, fileName, comment }) {
  if (!orangehrmEmployeeId) {
    return { ok: false, skipped: true, reason: 'No OrangeHRM Employee ID was entered on the form -- add it and try again.' };
  }

  if (DRY_RUN) {
    return {
      ok: true,
      dryRun: true,
      wouldSendTo: `${BASE_URL}/web/index.php/api/v2/pim/employees/${orangehrmEmployeeId}/screen/job/attachments`,
      fileName,
      comment
    };
  }

  try {
    const accessToken = await getValidAccessToken();
    const endpoint = `${BASE_URL}/web/index.php/api/v2/pim/employees/${orangehrmEmployeeId}/screen/job/attachments`;

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        description: comment,
        attachment: {
          name: fileName,
          type: 'application/pdf',
          base64: pdfBuffer.toString('base64'),
          size: pdfBuffer.length
        }
      })
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, status: res.status, reason: `OrangeHRM rejected the upload (HTTP ${res.status}).`, detail: text.slice(0, 500) };
    }

    return { ok: true, status: res.status };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

module.exports = { isConfigured, pushReviewSummary, buildAuthorizeUrl, handleCallback, DRY_RUN, isConnected: () => Boolean(tokenStore.read()), getValidAccessToken };

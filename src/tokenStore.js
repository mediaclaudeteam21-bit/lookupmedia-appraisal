// ---------------------------------------------------------------------------
// Saves the OrangeHRM OAuth tokens to disk so the connection survives a
// restart. One small file, deliberately separate from the appraisal data so it
// can be deleted on its own to force a fresh "Connect to OrangeHRM".
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'orangehrm-tokens.json');

function load() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return null;
  }
}

function save(tokens) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const record = {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    // Refresh a minute early so a call never fails on a token that expires mid-flight.
    expiresAt: Date.now() + (Number(tokens.expires_in || 3600) - 60) * 1000,
    savedAt: new Date().toISOString()
  };
  fs.writeFileSync(FILE, JSON.stringify(record, null, 2), { mode: 0o600 });
  return record;
}

function clear() {
  try { fs.unlinkSync(FILE); } catch { /* already gone */ }
}

module.exports = { load, save, clear, FILE };

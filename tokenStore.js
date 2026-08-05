// Stores the OrangeHRM OAuth tokens on disk so they survive between
// requests (and between deploys, as long as the container keeps its
// filesystem). If the container gets rebuilt from scratch, this file is
// gone and you'll need to redo the one-time /oauth/start step again --
// that only takes a few seconds.

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'data', 'oauth-tokens.json');

function ensureDir() {
  const dir = path.dirname(FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function read() {
  ensureDir();
  if (!fs.existsSync(FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return null;
  }
}

function write(tokens) {
  ensureDir();
  fs.writeFileSync(FILE, JSON.stringify(tokens, null, 2));
}

module.exports = { read, write };

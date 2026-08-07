// ---------------------------------------------------------------------------
// Storage. Deliberately a single JSON file — 76 contractors reviewed a few
// times a year is a few thousand rows at most, and a file means there is no
// database to install, back up, or pay for. If this ever outgrows that, the
// shape below maps cleanly onto three SQL tables (reviews, cycles, people).
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'appraisal.json');

const EMPTY = {
  reviews: [],       // one row per rater, per subject, per cycle
  cycles: [],        // { id, name, startDate, endDate, dueDate, status }
  roster: [],        // cached from OrangeHRM: { empNumber, name, jobTitle, jobTitleId, supervisorEmpNumber }
  rosterSyncedAt: null,
  pushes: []         // audit log of everything sent to OrangeHRM
};

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function read() {
  ensureDir();
  if (!fs.existsSync(FILE)) return structuredClone(EMPTY);
  try {
    return { ...structuredClone(EMPTY), ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
  } catch (err) {
    // Never lose data to a parse error — move the bad file aside and start clean.
    const backup = FILE + '.corrupt-' + Date.now();
    fs.copyFileSync(FILE, backup);
    console.error(`[store] Could not read ${FILE} (${err.message}). Moved to ${backup}.`);
    return structuredClone(EMPTY);
  }
}

function write(db) {
  ensureDir();
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, FILE); // atomic-ish: never leaves a half-written file
  return db;
}

function update(fn) {
  const db = read();
  const result = fn(db);
  write(db);
  return result;
}

function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

module.exports = { read, write, update, newId, FILE, DATA_DIR };

require('dotenv').config();

const express = require('express');
const path = require('path');

const store = require('./src/store');
const ohrm = require('./src/orangehrm');
const criteria = require('./shared/criteria.json');
const { blend } = require('./src/blend');
const { pushReview } = require('./src/push');
const { buildSummaryPdf } = require('./src/pdf');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_PASSWORD || '';

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// --- helpers ---------------------------------------------------------------

const slug = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

function subjectKeyFor({ subjectEmpNumber, subject }) {
  return subjectEmpNumber ? `emp:${subjectEmpNumber}` : `name:${slug(subject)}`;
}

function requireAdmin(req, res, next) {
  if (!ADMIN_KEY) {
    return res.status(500).json({ error: 'No ADMIN_PASSWORD is set on the server, so the HR console is locked. Set one in .env and restart.' });
  }
  const given = req.get('x-admin-key') || req.query.key;
  if (given !== ADMIN_KEY) return res.status(401).json({ error: 'Wrong HR password.' });
  next();
}

function openCycle(db) {
  return db.cycles.find((c) => c.status === 'open') || null;
}

// --- rater-facing ----------------------------------------------------------

app.get('/api/criteria', (req, res) => res.json(criteria));

app.get('/api/context', (req, res) => {
  const db = store.read();
  const cycle = openCycle(db);
  res.json({
    cycle: cycle ? { id: cycle.id, name: cycle.name, startDate: cycle.startDate, endDate: cycle.endDate } : null,
    roster: db.roster.map((p) => ({ empNumber: p.empNumber, name: p.name, jobTitle: p.jobTitle })),
    rosterSyncedAt: db.rosterSyncedAt
  });
});

app.post('/api/reviews', (req, res) => {
  const body = req.body || {};

  if (!body.reviewType || !body.subject || !body.reviewer) {
    return res.status(400).json({ error: 'A review needs a review type, the person being reviewed, and your name.' });
  }
  if (body.reviewType === 'lead_member' && !body.role) {
    return res.status(400).json({ error: "A lead's scorecard needs the role of the person being reviewed." });
  }

  const saved = store.update((db) => {
    const cycle = openCycle(db);
    if (!cycle) throw Object.assign(new Error('There is no open review cycle. HR opens one in the console before reviews can be submitted.'), { status: 409 });

    const key = subjectKeyFor(body);

    // One rater, one form, per person, per cycle — a resubmission replaces the
    // earlier one rather than quietly double-counting.
    const existing = db.reviews.findIndex(
      (r) => r.cycleId === cycle.id && r.subjectKey === key && slug(r.reviewer) === slug(body.reviewer) && r.reviewType === body.reviewType
    );

    const row = {
      id: store.newId('rev'),
      cycleId: cycle.id,
      subjectKey: key,
      subjectEmpNumber: body.subjectEmpNumber || null,
      ...body,
      submittedAt: new Date().toISOString()
    };

    if (existing >= 0) {
      row.id = db.reviews[existing].id;
      row.replacedAt = new Date().toISOString();
      db.reviews[existing] = row;
    } else {
      db.reviews.push(row);
    }

    const forSubject = db.reviews.filter((r) => r.cycleId === cycle.id && r.subjectKey === key);
    return { replaced: existing >= 0, cycle: cycle.name, received: forSubject.length, blend: blend(forSubject) };
  });

  res.json({
    ok: true,
    replaced: saved.replaced,
    message: saved.replaced
      ? 'Your earlier review of this person was replaced with this one.'
      : 'Review recorded.',
    receivedForThisPerson: saved.received,
    stillNeeded: saved.blend.blockers
  });
});

// --- HR console ------------------------------------------------------------

app.get('/api/admin/status', requireAdmin, (req, res) => {
  const db = store.read();
  res.json({
    orangehrm: ohrm.connectionStatus(),
    cycles: db.cycles,
    rosterSize: db.roster.length,
    rosterSyncedAt: db.rosterSyncedAt,
    reviewCount: db.reviews.length,
    pushes: db.pushes.slice(-20).reverse()
  });
});

app.post('/api/admin/cycles', requireAdmin, (req, res) => {
  const { name, startDate, endDate, dueDate } = req.body || {};
  if (!name || !startDate || !endDate) return res.status(400).json({ error: 'A cycle needs a name, a start date and an end date.' });

  const cycle = store.update((db) => {
    db.cycles.forEach((c) => { if (c.status === 'open') c.status = 'closed'; });
    const row = { id: store.newId('cyc'), name, startDate, endDate, dueDate: dueDate || endDate, status: 'open', createdAt: new Date().toISOString() };
    db.cycles.push(row);
    return row;
  });
  res.json({ ok: true, cycle });
});

app.post('/api/admin/cycles/:id/close', requireAdmin, (req, res) => {
  store.update((db) => {
    const c = db.cycles.find((x) => x.id === req.params.id);
    if (c) c.status = 'closed';
  });
  res.json({ ok: true });
});

app.post('/api/admin/sync-roster', requireAdmin, async (req, res) => {
  try {
    const [people, jobTitles] = await Promise.all([ohrm.listEmployees(), ohrm.listJobTitles()]);

    // Supervisors are not on the employee list payload, so fetch them per person.
    const withSupervisors = [];
    for (const p of people) {
      let supervisorEmpNumber = null;
      try {
        const sups = await ohrm.listSupervisors(p.empNumber);
        supervisorEmpNumber = sups[0]?.supervisor?.empNumber ?? null;
      } catch { /* leave null — HR can pick a reviewer at push time */ }
      withSupervisors.push({ ...p, supervisorEmpNumber });
    }

    store.update((db) => {
      db.roster = withSupervisors;
      db.jobTitles = jobTitles;
      db.rosterSyncedAt = new Date().toISOString();
    });
    res.json({ ok: true, count: withSupervisors.length, jobTitles: jobTitles.length });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/admin/subjects', requireAdmin, (req, res) => {
  const db = store.read();
  const cycle = db.cycles.find((c) => c.id === req.query.cycleId) || openCycle(db);
  if (!cycle) return res.json({ cycle: null, subjects: [] });

  const rows = db.reviews.filter((r) => r.cycleId === cycle.id);
  const byKey = new Map();
  for (const r of rows) {
    if (!byKey.has(r.subjectKey)) byKey.set(r.subjectKey, []);
    byKey.get(r.subjectKey).push(r);
  }

  const rosterByEmp = new Map(db.roster.map((p) => [String(p.empNumber), p]));

  const subjects = [...byKey.entries()].map(([key, reviews]) => {
    const first = reviews.find((r) => r.reviewType === 'lead_member') || reviews[0];
    const emp = first.subjectEmpNumber ? rosterByEmp.get(String(first.subjectEmpNumber)) : null;
    const pushed = db.pushes.filter((p) => p.subjectKey === key && p.cycleId === cycle.id).slice(-1)[0] || null;
    return {
      key,
      name: first.subject,
      role: first.role || null,
      empNumber: first.subjectEmpNumber || null,
      jobTitle: emp?.jobTitle || null,
      supervisorEmpNumber: emp?.supervisorEmpNumber || null,
      blend: blend(reviews),
      pushed
    };
  }).sort((a, b) => a.name.localeCompare(b.name));

  res.json({ cycle, subjects });
});

app.get('/api/admin/subjects/:key', requireAdmin, (req, res) => {
  const db = store.read();
  const cycle = db.cycles.find((c) => c.id === req.query.cycleId) || openCycle(db);
  const reviews = db.reviews.filter((r) => r.cycleId === cycle?.id && r.subjectKey === req.params.key);
  if (!reviews.length) return res.status(404).json({ error: 'No reviews for that person in this cycle.' });

  // Peer and upward raters were promised anonymity — HR sees the ratings and
  // the comments, never which rater said what.
  const safe = reviews.map((r) => ({
    ...r,
    reviewer: r.reviewType === 'lead_member' ? r.reviewer : 'Anonymous rater'
  }));

  res.json({ cycle, reviews: safe, blend: blend(reviews) });
});

app.get('/api/admin/subjects/:key/pdf', requireAdmin, async (req, res) => {
  try {
    const db = store.read();
    const cycle = db.cycles.find((c) => c.id === req.query.cycleId) || openCycle(db);
    const reviews = db.reviews.filter((r) => r.cycleId === cycle?.id && r.subjectKey === req.params.key);
    if (!reviews.length) return res.status(404).send('No reviews for that person in this cycle.');

    const first = reviews.find((r) => r.reviewType === 'lead_member') || reviews[0];
    const pdf = await buildSummaryPdf({
      subject: { name: first.subject, role: first.role },
      cycle,
      blend: blend(reviews),
      reviews,
      roleDef: criteria.roles[first.role]
    });
    res.type('application/pdf').send(pdf);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.post('/api/admin/push', requireAdmin, async (req, res) => {
  const { subjectKey, cycleId, supervisorEmpNumber, empNumber, attachPdf, force } = req.body || {};
  const db = store.read();
  const cycle = db.cycles.find((c) => c.id === cycleId) || openCycle(db);
  if (!cycle) return res.status(400).json({ error: 'No review cycle to push.' });

  const reviews = db.reviews.filter((r) => r.cycleId === cycle.id && r.subjectKey === subjectKey);
  if (!reviews.length) return res.status(404).json({ error: 'No reviews for that person in this cycle.' });

  const first = reviews.find((r) => r.reviewType === 'lead_member') || reviews[0];
  const chosenEmp = empNumber || first.subjectEmpNumber;
  const rosterEntry = db.roster.find((p) => String(p.empNumber) === String(chosenEmp));

  const subject = {
    name: first.subject,
    role: first.role,
    empNumber: chosenEmp,
    jobTitleId: rosterEntry?.jobTitleId || null,
    supervisorEmpNumber: supervisorEmpNumber || rosterEntry?.supervisorEmpNumber || null
  };

  try {
    const result = await pushReview({ subject, cycle, reviews, options: { attachPdf, force } });

    if (result.ok && !result.dryRun) {
      store.update((d) => {
        d.pushes.push({
          id: store.newId('push'),
          subjectKey, cycleId: cycle.id, name: subject.name,
          reviewId: result.reviewId, finalRating: result.blend.finalRating,
          at: new Date().toISOString(), steps: result.steps
        });
      });
    }
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err.message, detail: err.body || null });
  }
});

// --- OAuth -----------------------------------------------------------------

app.get('/oauth/start', (req, res) => {
  if (!ohrm.isConfigured()) {
    return res.status(500).send('OrangeHRM is not configured yet. Fill in ORANGEHRM_BASE_URL, ORANGEHRM_CLIENT_ID and ORANGEHRM_REDIRECT_URI in .env, then restart.');
  }
  res.redirect(ohrm.buildAuthorizeUrl());
});

app.get('/oauth/callback', async (req, res) => {
  const { code, state, error, error_description: description } = req.query;
  if (error) return res.status(400).send(`OrangeHRM refused the connection: ${description || error}`);
  if (!code || !state) return res.status(400).send('OrangeHRM did not send back an authorisation code.');

  try {
    await ohrm.exchangeCode(code, state);
    res.send('<h2>Connected to OrangeHRM.</h2><p>You can close this tab and go back to the HR console.</p>');
  } catch (err) {
    res.status(500).send(`Could not finish connecting: ${err.message}`);
  }
});

app.post('/api/admin/disconnect', requireAdmin, (req, res) => {
  ohrm.tokenStore.clear();
  res.json({ ok: true });
});

// --- errors ----------------------------------------------------------------

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Something went wrong on the server.' });
});

app.listen(PORT, () => {
  console.log(`LookUp Media appraisal site running on http://localhost:${PORT}`);
  console.log(`  Rater form:  http://localhost:${PORT}/`);
  console.log(`  HR console:  http://localhost:${PORT}/admin.html`);
  console.log(`  OrangeHRM:   ${ohrm.cfg().baseUrl || '(not configured)'}  dry run: ${ohrm.cfg().dryRun}`);
});

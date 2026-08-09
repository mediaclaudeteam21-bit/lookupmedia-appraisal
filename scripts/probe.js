#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Read-only check. Run this after connecting and before you turn dry run off.
// It only ever reads — it will not create a KPI, a review, or anything else.
//
//   npm run probe
// ---------------------------------------------------------------------------

require('dotenv').config();
const ohrm = require('../src/orangehrm');
const criteria = require('../shared/criteria.json');

const ok = (s) => console.log(`  ✓ ${s}`);
const bad = (s) => console.log(`  ✗ ${s}`);

(async () => {
  console.log('\nOrangeHRM connection check\n' + '─'.repeat(60));
  const status = ohrm.connectionStatus();
  console.log(`  Instance : ${status.baseUrl || '(not set)'}`);
  console.log(`  Connected: ${status.connected}`);
  console.log(`  Dry run  : ${status.dryRun}\n`);

  if (!status.configured) return bad('Fill in ORANGEHRM_BASE_URL, ORANGEHRM_CLIENT_ID and ORANGEHRM_REDIRECT_URI in .env first.');
  if (!status.connected) return bad('Not connected. Start the site, open the HR console and click Connect to OrangeHRM.');

  let jobTitles = [];
  try {
    jobTitles = await ohrm.listJobTitles();
    ok(`Job titles readable — ${jobTitles.length} found.`);
  } catch (err) {
    return bad(`Could not read job titles: ${err.message}`);
  }

  try {
    const people = await ohrm.listEmployees();
    ok(`Employees readable — ${people.length} found.`);
    const noJobTitle = people.filter((p) => !p.jobTitleId).length;
    if (noJobTitle) console.log(`      ${noJobTitle} of them have no job title. KPIs hang off job titles, so those people can't be pushed until that's set.`);
  } catch (err) {
    bad(`Could not read employees: ${err.message}`);
  }

  try {
    const kpis = await ohrm.listKpis();
    ok(`Performance KPIs readable — ${kpis.length} already configured.`);
  } catch (err) {
    bad(`Could not read KPIs — the Performance module may be disabled: ${err.message}`);
  }

  console.log('\nJob titles this site expects\n' + '─'.repeat(60));
  const byName = new Map(jobTitles.map((j) => [j.title.trim().toLowerCase(), j]));
  const covered = new Set();
  let missing = 0;
  for (const role of Object.values(criteria.roles)) {
    console.log(`\n  ${role.label} (${role.items.length} KPIs)`);
    for (const wanted of role.orangeHrmJobTitles) {
      const hit = byName.get(wanted.trim().toLowerCase());
      if (hit) { ok(`  ${wanted} → id ${hit.id}`); covered.add(hit.title); }
      else { bad(`  ${wanted} — no matching job title in OrangeHRM`); missing++; }
    }
  }

  const excluded = new Set((criteria.excludedJobTitles || []).map((t) => t.trim().toLowerCase()));
  const uncovered = jobTitles.filter((j) => !covered.has(j.title) && !excluded.has(j.title.trim().toLowerCase()));
  if (uncovered.length) {
    console.log('\nJob titles with no scorecard\n' + '─'.repeat(60));
    uncovered.forEach((j) => console.log(`  · ${j.title}`));
    console.log('  These people can receive peer and upward reviews, but no lead');
    console.log('  scorecard exists for them, so they cannot get a final rating yet.');
  }

  console.log('\n' + '─'.repeat(60));
  if (missing) {
    console.log(`${missing} job title${missing === 1 ? '' : 's'} missing. Add them in OrangeHRM under Admin ▸ Job ▸ Job Titles,`);
    console.log('spelled exactly as above, then run this again.');
  } else {
    console.log('Everything this site needs is in place. Next: npm run sync-kpis');
  }
  console.log('');
})().catch((err) => { console.error('\n' + err.message + '\n'); process.exit(1); });

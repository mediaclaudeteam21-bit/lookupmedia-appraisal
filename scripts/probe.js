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
  let missing = 0;
  for (const [key, role] of Object.entries(criteria.roles)) {
    const hit = byName.get(role.orangeHrmJobTitle.trim().toLowerCase());
    if (hit) ok(`${role.orangeHrmJobTitle} → id ${hit.id} (${role.items.length} KPIs)`);
    else { bad(`${role.orangeHrmJobTitle} — no matching job title in OrangeHRM (role "${key}")`); missing++; }
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

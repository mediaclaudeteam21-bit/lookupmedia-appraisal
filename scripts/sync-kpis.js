#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Creates the KPIs. Every criterion on a role's scorecard becomes a KPI on
// that job title inside OrangeHRM (Performance ▸ Configure ▸ KPIs), rated 1–5,
// plus two extra KPIs on every role for the pooled peer and upward averages.
//
// Safe to run again: a KPI that already exists by title is left alone, so
// after you add a criterion to the form you just run this once more.
//
//   npm run sync-kpis            # respects ORANGEHRM_DRY_RUN
//   npm run sync-kpis -- --write # forces the write even in dry-run mode
// ---------------------------------------------------------------------------

require('dotenv').config();
const ohrm = require('../src/orangehrm');
const criteria = require('../shared/criteria.json');

const force = process.argv.includes('--write');
const dryRun = ohrm.cfg().dryRun && !force;

(async () => {
  const jobTitles = await ohrm.listJobTitles();
  const byName = new Map(jobTitles.map((j) => [j.title.trim().toLowerCase(), j]));

  console.log(`\nKPI sync — ${dryRun ? 'DRY RUN, nothing will be written' : 'writing to OrangeHRM'}\n` + '─'.repeat(64));

  const extras = criteria.blendedKpis.map((k) => k.kpiTitle);
  let created = 0;

  for (const [key, role] of Object.entries(criteria.roles)) {
    const titles = [...role.items.map((i) => i.kpiTitle), ...extras];
    console.log(`\n${role.label} scorecard — ${titles.length} KPIs on ${role.orangeHrmJobTitles.length} job title(s)`);

    for (const wanted of role.orangeHrmJobTitles) {
      const jt = byName.get(wanted.trim().toLowerCase());
      if (!jt) {
        console.log(`  ✗ "${wanted}" — no such job title in OrangeHRM. Check the spelling and run again.`);
        continue;
      }
      console.log(`  ${wanted} (id ${jt.id})`);

      if (dryRun) {
        titles.forEach((t) => console.log(`      would create: ${t}  [1–5]`));
        continue;
      }

      const res = await ohrm.ensureKpis({ jobTitleId: jt.id, kpiTitles: titles });
      res.created.forEach((k) => console.log(`      created: ${k.title}`));
      if (res.reused.length) console.log(`      ${res.reused.length} already existed and were left alone.`);
      created += res.created.length;
    }
  }

  console.log('\n' + '─'.repeat(64));
  console.log(dryRun
    ? 'Dry run finished. Run with --write, or set ORANGEHRM_DRY_RUN=false, to create these.'
    : `Done — ${created} KPIs created. Check Performance ▸ Configure ▸ KPIs in OrangeHRM.`);
  console.log('');
})().catch((err) => { console.error('\n' + err.message + '\n'); process.exit(1); });

// setup-kpis.js
//
// One-time setup script. Creates a single KPI called "360 Performance Rating"
// (rated 1-5) for every Job Title in OrangeHRM that doesn't already have one.
// This is a prerequisite for pushing ratings into the Performance tab --
// OrangeHRM only shows KPIs on a review if the employee's Job Title has at
// least one KPI defined.
//
// Run once from Railway's Console tab (lookupmedia-appraisal service):
//   node setup-kpis.js
//
// Safe to run more than once -- it skips any Job Title that already has
// a KPI, so re-running just confirms everything is already set up.

const tokenStore = require('./tokenStore');

const BASE_URL = (process.env.ORANGEHRM_BASE_URL || '').replace(/\/$/, '');
const KPI_TITLE = '360 Performance Rating';

async function apiGet(path) {
  const accessToken = await tokenStore.getValidAccessToken();
  const res = await fetch(`${BASE_URL}/web/index.php${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GET ${path} failed: ${res.status} ${text}`);
  }
  return JSON.parse(text);
}

async function apiPost(path, body) {
  const accessToken = await tokenStore.getValidAccessToken();
  const res = await fetch(`${BASE_URL}/web/index.php${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`POST ${path} failed: ${res.status} ${text}`);
  }
  return JSON.parse(text);
}

async function main() {
  if (!BASE_URL) {
    console.error('ORANGEHRM_BASE_URL is not set. Aborting.');
    process.exit(1);
  }

  console.log(`Using OrangeHRM base URL: ${BASE_URL}`);
  console.log('Fetching job titles...');
  const jobTitlesRes = await apiGet('/api/v2/admin/job-titles?limit=200');
  const jobTitles = jobTitlesRes.data || [];
  console.log(`Found ${jobTitles.length} job title(s):`);
  jobTitles.forEach((jt) => console.log(`  - [${jt.id}] ${jt.title}`));

  console.log('\nFetching existing KPIs...');
  const kpisRes = await apiGet('/api/v2/performance/kpis?limit=200');
  const existingKpis = kpisRes.data || [];
  console.log(`Found ${existingKpis.length} existing KPI(s).`);

  console.log('\nCreating missing KPIs...');
  let created = 0;
  let skipped = 0;
  for (const jt of jobTitles) {
    const already = existingKpis.some(
      (k) => k.jobTitle && k.jobTitle.id === jt.id
    );
    if (already) {
      console.log(`  Skip "${jt.title}" -- KPI already exists.`);
      skipped += 1;
      continue;
    }
    try {
      const result = await apiPost('/api/v2/performance/kpis', {
        title: KPI_TITLE,
        jobTitleId: jt.id,
        minRating: 1,
        maxRating: 5,
        isDefault: true,
      });
      const newId = result.data && result.data.id;
      console.log(`  Created KPI for "${jt.title}" -- new KPI id ${newId}`);
      created += 1;
    } catch (err) {
      console.error(`  FAILED for "${jt.title}": ${err.message}`);
    }
  }

  console.log(`\nDone. Created ${created}, skipped ${skipped} (already had a KPI).`);
}

main().catch((err) => {
  console.error('Setup script failed:', err);
  process.exit(1);
});

// push-performance-review.js
//
// Pushes a final consolidated rating into an employee's OrangeHRM
// Performance tab: creates a Performance Review, scores it against that
// employee's KPI (created by setup-kpis.js), and finalizes it.
//
// Usage (run from Railway's Console tab):
//   node push-performance-review.js <empNumber> <rating 1-5> "<comment>"
//
// Example:
//   node push-performance-review.js 2 5 "Strong quarter, great communication."
//
// IMPORTANT: test this on ONE throwaway/real-but-safe employee record first
// before using it for everyone. This is new, unverified against a few of
// OrangeHRM's own type quirks (some fields are documented as strings where
// you'd expect numbers/booleans) -- if something's off, the error printed
// here will show exactly what OrangeHRM rejected and why, and we fix from
// that rather than guessing again.

const { getValidAccessToken } = require('./orangehrm');

const BASE_URL = (process.env.ORANGEHRM_BASE_URL || '').replace(/\/$/, '');

async function apiCall(method, path, body) {
  const accessToken = await getValidAccessToken();
  const res = await fetch(`${BASE_URL}/web/index.php${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  console.log(`  ${method} ${path} -> HTTP ${res.status}`);
  if (!res.ok) {
    throw new Error(`${method} ${path} failed: ${res.status} ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

async function main() {
  const [, , empNumberArg, ratingArg, ...commentParts] = process.argv;
  const comment = commentParts.join(' ') || 'Performance review summary.';

  if (!BASE_URL) {
    console.error('ORANGEHRM_BASE_URL is not set. Aborting.');
    process.exit(1);
  }
  if (!empNumberArg || !ratingArg) {
    console.error('Usage: node push-performance-review.js <empNumber> <rating 1-5> "<comment>"');
    process.exit(1);
  }

  const empNumber = Number(empNumberArg);
  const rating = Number(ratingArg);

  console.log(`Employee empNumber: ${empNumber}`);
  console.log(`Rating: ${rating}`);
  console.log(`Comment: ${comment}\n`);

  console.log('Step 1: Looking up supervisor...');
  const supervisorsRes = await apiCall('GET', `/api/v2/pim/employees/${empNumber}/supervisors`);
  const supervisors = (supervisorsRes && supervisorsRes.data) || [];
  if (supervisors.length === 0) {
    console.error(
      `No supervisor found for employee ${empNumber}. A reviewer is required to create a review -- ` +
      `this employee needs a supervisor assigned in PIM > Report-to first.`
    );
    process.exit(1);
  }
  const reviewerEmpNumber =
    supervisors[0].empNumber || (supervisors[0].employee && supervisors[0].employee.empNumber);
  console.log(`  Using reviewer empNumber: ${reviewerEmpNumber}\n`);

  console.log('Step 2: Creating performance review...');
  const now = Math.floor(Date.now() / 1000);
  const ninetyDaysAgo = now - 90 * 24 * 60 * 60;
  const reviewRes = await apiCall('POST', '/api/v2/performance/manage/reviews', {
    empNumber,
    reviewerEmpNumber,
    startDate: ninetyDaysAgo,
    endDate: now,
    dueDate: now,
    activate: true,
  });
  const reviewId = reviewRes.data.id;
  console.log(`  Created review id ${reviewId}\n`);

  console.log('Step 3: Fetching KPIs attached to this review...');
  const kpisRes = await apiCall('GET', `/api/v2/performance/reviews/${reviewId}/kpis`);
  const kpis = (kpisRes && kpisRes.data) || [];
  if (kpis.length === 0) {
    console.error(
      `No KPI found on this review. This usually means the employee's Job Title doesn't have a KPI -- ` +
      `re-run setup-kpis.js, or check the employee's Job Title in PIM.`
    );
    process.exit(1);
  }
  const kpiId = kpis[0].id;
  console.log(`  Using KPI id ${kpiId} ("${kpis[0].title}")\n`);

  console.log('Step 4: Submitting the supervisor evaluation...');
  await apiCall('PUT', `/api/v2/performance/reviews/${reviewId}/evaluation/supervisor`, {
    reviewers: [{ id: kpiId, rating, comment }],
    generalComment: comment,
    complete: true,
  });
  console.log('  Evaluation submitted.\n');

  console.log('Step 5: Finalizing the review...');
  await apiCall('PUT', `/api/v2/performance/reviews/${reviewId}/evaluation/final`, {
    finalRating: String(rating),
    completedDate: now,
    finalComment: comment,
    complete: 'true',
  });
  console.log('  Review finalized.\n');

  console.log(`Done. Review ${reviewId} for employee ${empNumber} should now show on their Performance tab.`);
}

main().catch((err) => {
  console.error('\nPush failed:', err.message);
  process.exit(1);
});

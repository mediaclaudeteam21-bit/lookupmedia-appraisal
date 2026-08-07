// ---------------------------------------------------------------------------
// Blending. Each rater's form gives one average. This turns every review a
// person received in a cycle into the single final rating, applying the same
// rules that are printed on the form itself:
//
//   • a rater group only counts once it has enough responses (peer 2+, upward 3+)
//   • weights re-normalise over whichever groups actually counted
//   • nobody is finalised on fewer than 3 raters
//   • peer/upward comments stay sealed below 3 responses in that group,
//     because below that they are traceable to one person
// ---------------------------------------------------------------------------

const criteria = require('../shared/criteria.json');

const GROUP_OF = {
  lead_member: 'lead',
  peer: 'peer',
  member_lead: 'upward'
};

const GROUP_LABEL = { lead: 'Lead', peer: 'Peer', upward: 'Upward' };

function mean(nums) {
  const valid = nums.filter((n) => typeof n === 'number' && !Number.isNaN(n));
  if (!valid.length) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

function round2(n) {
  return n === null ? null : Math.round(n * 100) / 100;
}

function band(score) {
  return Math.min(5, Math.max(1, Math.round(score)));
}

/**
 * @param {Array} reviews  all reviews for one subject in one cycle
 * @param {object} [opts]  { weights: {lead,peer,upward} } to override defaults
 */
function blend(reviews, opts = {}) {
  const weights = { ...criteria.weights, ...(opts.weights || {}) };
  const min = criteria.minimums;

  const groups = { lead: [], peer: [], upward: [] };
  for (const r of reviews) {
    const g = GROUP_OF[r.reviewType];
    if (g && typeof r.raterScore === 'number') groups[g].push(r);
  }

  const required = { lead: 1, peer: min.peer, upward: min.upward };

  const summary = {};
  for (const g of ['lead', 'peer', 'upward']) {
    const scores = groups[g].map((r) => r.raterScore);
    summary[g] = {
      label: GROUP_LABEL[g],
      responses: groups[g].length,
      required: required[g],
      counts: groups[g].length >= required[g],
      average: round2(mean(scores)),
      weight: weights[g],
      commentsReleasable: groups[g].length >= 3 || g === 'lead'
    };
  }

  const counting = ['lead', 'peer', 'upward'].filter(
    (g) => summary[g].counts && summary[g].average !== null && weights[g] > 0
  );

  const totalWeight = counting.reduce((a, g) => a + weights[g], 0);
  const finalRating = counting.length
    ? round2(counting.reduce((a, g) => a + summary[g].average * weights[g], 0) / totalWeight)
    : null;

  const totalRaters = groups.lead.length + groups.peer.length + groups.upward.length;

  // Spread check — the rule carried over from Step 06 of the HR guide.
  const averages = counting.map((g) => summary[g].average);
  const spread = averages.length > 1 ? round2(Math.max(...averages) - Math.min(...averages)) : 0;

  const blockers = [];
  if (totalRaters < min.raters) {
    blockers.push(`Only ${totalRaters} rater${totalRaters === 1 ? '' : 's'} so far — needs at least ${min.raters} before this can be finalised.`);
  }
  if (!summary.lead.counts) {
    blockers.push("The lead's scorecard is missing — it carries the role criteria that OrangeHRM's KPIs are built from.");
  }
  if (counting.length < 2) {
    blockers.push('Only one rater group counted — a final rating needs at least two different directions.');
  }

  const warnings = [];
  if (spread >= 2) {
    const hi = counting.reduce((a, g) => (summary[g].average > summary[a].average ? g : a), counting[0]);
    const lo = counting.reduce((a, g) => (summary[g].average < summary[a].average ? g : a), counting[0]);
    warnings.push(
      `Significant gap — ${spread.toFixed(2)} points. ${GROUP_LABEL[hi]} raters scored ${summary[hi].average}, ${GROUP_LABEL[lo]} raters scored ${summary[lo].average}. Raise and explain this in the feedback session before finalising.`
    );
  }
  for (const g of ['peer', 'upward']) {
    if (groups[g].length > 0 && groups[g].length < 3) {
      warnings.push(`${GROUP_LABEL[g]} comments stay sealed — only ${groups[g].length} response${groups[g].length === 1 ? '' : 's'}, so the feedback would be traceable to one person.`);
    }
    if (groups[g].length > 0 && !summary[g].counts) {
      warnings.push(`${GROUP_LABEL[g]} reviews do not count yet — ${groups[g].length} of ${required[g]} needed. Their weight has been redistributed.`);
    }
  }

  const scale = finalRating !== null ? criteria.scale[band(finalRating)] : null;

  return {
    finalRating,
    band: finalRating !== null ? band(finalRating) : null,
    ratingLabel: scale ? scale.label : null,
    recommendedAction: scale ? scale.action : null,
    totalRaters,
    spread,
    countingGroups: counting,
    normalisedOver: totalWeight,
    groups: summary,
    blockers,
    warnings,
    readyToFinalise: blockers.length === 0 && finalRating !== null
  };
}

/**
 * Per-criterion view of the lead's scorecard. This is what becomes the KPI
 * ratings inside OrangeHRM — the peer and upward numbers go in as their own
 * two KPIs rather than being smeared across the role criteria, so nobody
 * reading the OrangeHRM record can mistake a peer average for the lead's
 * judgement of a specific criterion.
 */
function leadCriteriaBreakdown(reviews) {
  const leadReviews = reviews.filter((r) => r.reviewType === 'lead_member');
  if (!leadReviews.length) return [];

  const byCriterion = new Map();
  for (const r of leadReviews) {
    for (const c of r.criteria || []) {
      if (!byCriterion.has(c.criterion)) byCriterion.set(c.criterion, { criterion: c.criterion, ratings: [], notes: [] });
      const row = byCriterion.get(c.criterion);
      if (c.rating && c.rating !== 'NA') row.ratings.push(Number(c.rating));
      if (c.notes) row.notes.push(c.notes);
    }
  }

  return [...byCriterion.values()].map((row) => ({
    criterion: row.criterion,
    rating: round2(mean(row.ratings)),
    notApplicable: row.ratings.length === 0,
    comment: row.notes.join(' · ')
  }));
}

module.exports = { blend, leadCriteriaBreakdown, GROUP_OF, GROUP_LABEL };

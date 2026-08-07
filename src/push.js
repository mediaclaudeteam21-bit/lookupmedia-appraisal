// ---------------------------------------------------------------------------
// The push. Takes one person's finished review set for one cycle and lands it
// in OrangeHRM's Performance module as a real, completed review with KPI
// ratings — not a PDF stapled to a record.
//
// Every step is planned first. In dry run the plan is returned and nothing is
// sent, so HR can read exactly what would land in OrangeHRM before it does.
// ---------------------------------------------------------------------------

const ohrm = require('./orangehrm');
const criteria = require('../shared/criteria.json');
const { blend, leadCriteriaBreakdown } = require('./blend');
const { buildSummaryPdf } = require('./pdf');

/**
 * @param {object} args
 * @param {object} args.subject   { name, empNumber, role, jobTitleId, supervisorEmpNumber }
 * @param {object} args.cycle     { name, startDate, endDate, dueDate }
 * @param {Array}  args.reviews   every review this person received in the cycle
 * @param {object} [args.options] { attachPdf: boolean, force: boolean }
 */
async function pushReview({ subject, cycle, reviews, options = {} }) {
  const result = blend(reviews);
  const steps = [];

  if (!result.readyToFinalise && !options.force) {
    return { ok: false, blocked: true, blockers: result.blockers, blend: result };
  }
  if (!subject.empNumber) {
    return { ok: false, blocked: true, blockers: ['No OrangeHRM employee is linked to this person yet. Link them on the People tab, then push again.'], blend: result };
  }
  // Who OrangeHRM will list as the reviewer on the row.
  const fallback = ohrm.cfg().fallbackReviewerEmpNumber;
  const reviewerEmpNumber = subject.supervisorEmpNumber || fallback || null;
  const usedFallback = !subject.supervisorEmpNumber && Boolean(fallback);

  if (!reviewerEmpNumber) {
    return { ok: false, blocked: true, blockers: [`OrangeHRM needs a reviewer on every review row, and ${subject.name} has no supervisor on their PIM record. Either add a Report-to in OrangeHRM, or set ORANGEHRM_FALLBACK_REVIEWER_EMPNUMBER so people without an internal supervisor are filed under one nominated person.`], blend: result };
  }
  if (String(reviewerEmpNumber) === String(subject.empNumber)) {
    return { ok: false, blocked: true, blockers: [`${subject.name} would end up listed as their own reviewer in OrangeHRM. Give them a supervisor on their PIM record, or nominate someone else as the fallback reviewer.`], blend: result };
  }

  const roleDef = criteria.roles[subject.role];
  if (!roleDef) {
    return { ok: false, blocked: true, blockers: [`Unknown role "${subject.role}" — cannot work out which KPIs to use.`], blend: result };
  }

  // ---- Plan the KPI ratings -----------------------------------------------
  const leadRows = leadCriteriaBreakdown(reviews);
  const byText = new Map(leadRows.map((r) => [r.criterion, r]));

  const plannedRatings = [];
  for (const item of roleDef.items) {
    const row = byText.get(item.text);
    if (!row || row.notApplicable) continue; // N/A stays out rather than going in as a guess
    plannedRatings.push({ kpiTitle: item.kpiTitle, rating: row.rating, comment: row.comment || 'No note given by the lead.' });
  }
  for (const extra of criteria.blendedKpis) {
    const group = result.groups[extra.source === 'peer' ? 'peer' : 'upward'];
    if (!group.counts || group.average === null) continue;
    plannedRatings.push({
      kpiTitle: extra.kpiTitle,
      rating: group.average,
      comment: `Pooled average of ${group.responses} ${group.label.toLowerCase()} reviews. Individual raters are not identified.`
    });
  }

  const generalComment = buildGeneralComment(subject, cycle, result, reviews);

  const kpiTitles = [...roleDef.items.map((i) => i.kpiTitle), ...criteria.blendedKpis.map((k) => k.kpiTitle)];

  const plan = {
    employee: `${subject.name} (empNumber ${subject.empNumber})`,
    jobTitle: roleDef.orangeHrmJobTitle,
    cycle: `${cycle.name} — ${cycle.startDate} to ${cycle.endDate}`,
    reviewer: usedFallback
      ? `empNumber ${reviewerEmpNumber} — nominated stand-in, because ${subject.name} has no internal supervisor`
      : `empNumber ${reviewerEmpNumber}`,
    kpisRequired: kpiTitles,
    kpiRatings: plannedRatings,
    finalRating: result.finalRating,
    finalRatingLabel: result.ratingLabel,
    generalComment,
    attachPdf: options.attachPdf !== false
  };

  if (ohrm.cfg().dryRun) {
    return { ok: true, dryRun: true, plan, blend: result, steps: ['Dry run — nothing was sent. Set ORANGEHRM_DRY_RUN=false once this plan looks right.'] };
  }

  // ---- 1. KPIs -------------------------------------------------------------
  const jobTitleId = subject.jobTitleId;
  if (!jobTitleId) {
    return { ok: false, blocked: true, blockers: [`${subject.name} has no job title in OrangeHRM. KPIs hang off job titles, so set their job title to "${roleDef.orangeHrmJobTitle}" first.`], blend: result, plan };
  }

  const kpiSync = await ohrm.ensureKpis({ jobTitleId, kpiTitles });
  steps.push(`KPIs: ${kpiSync.created.length} created, ${kpiSync.reused.length} already there.`);
  const kpiIdByTitle = new Map(kpiSync.all.map((k) => [k.title.trim().toLowerCase(), k.id]));

  // ---- 2. Review row -------------------------------------------------------
  const review = await ohrm.createReview({
    empNumber: subject.empNumber,
    reviewerEmpNumber,
    startDate: cycle.startDate,
    endDate: cycle.endDate,
    dueDate: cycle.dueDate || cycle.endDate,
    activate: true
  });
  steps.push(`Review #${review.id} created and activated in Performance ▸ Manage Reviews.`);
  if (usedFallback) {
    steps.push(`Listed under empNumber ${reviewerEmpNumber} as reviewer, because ${subject.name} has no internal supervisor. The rating itself is unchanged — it came from whoever filled in the form.`);
  }

  // ---- 3. KPI ratings ------------------------------------------------------
  const ratingsByKpiId = new Map();
  const skipped = [];
  for (const r of plannedRatings) {
    const id = kpiIdByTitle.get(r.kpiTitle.trim().toLowerCase());
    if (!id) { skipped.push(r.kpiTitle); continue; }
    ratingsByKpiId.set(id, { rating: r.rating, comment: r.comment });
  }
  await ohrm.putSupervisorEvaluation(review.id, ratingsByKpiId, generalComment);
  steps.push(`${ratingsByKpiId.size} KPI ratings written${skipped.length ? ` (${skipped.length} skipped: ${skipped.join(', ')})` : ''}.`);

  // ---- 4. Final rating -----------------------------------------------------
  await ohrm.finaliseReview(review.id, {
    finalRating: result.finalRating,
    finalComment: generalComment,
    completedDate: new Date()
  });
  steps.push(`Final rating ${result.finalRating}/5 (${result.ratingLabel}) written and the review marked complete.`);

  // ---- 5. Summary PDF ------------------------------------------------------
  let attachment = null;
  if (options.attachPdf !== false) {
    try {
      const pdfBuffer = await buildSummaryPdf({ subject, cycle, blend: result, reviews, roleDef });
      const fileName = `${cycle.name.replace(/\s+/g, '-')}-review-${subject.name.replace(/\s+/g, '-')}.pdf`;
      await ohrm.attachPdf({
        empNumber: subject.empNumber,
        pdfBuffer,
        fileName,
        description: `${cycle.name} performance review — final ${result.finalRating}/5 (${result.ratingLabel})`
      });
      attachment = fileName;
      steps.push(`Summary PDF attached to the employee record (${fileName}).`);
    } catch (err) {
      // The review itself is already in — never fail the push over the PDF.
      steps.push(`Summary PDF could not be attached: ${err.message}. The review itself went in fine; attach the PDF by hand if you need it there.`);
    }
  }

  return { ok: true, dryRun: false, reviewId: review.id, plan, blend: result, steps, attachment };
}

function buildGeneralComment(subject, cycle, result, reviews) {
  const lead = reviews.find((r) => r.reviewType === 'lead_member');
  const parts = [
    `${cycle.name} multi-rater review. Final ${result.finalRating}/5 — ${result.ratingLabel}. ${result.recommendedAction}.`,
    `Blended from ${result.totalRaters} raters: ${result.countingGroups
      .map((g) => `${result.groups[g].label} ${result.groups[g].average} (${result.groups[g].weight}%)`)
      .join(', ')}.`
  ];
  if (lead?.strength) parts.push(`Greatest strength: ${lead.strength}`);
  if (lead?.improvement) parts.push(`Area for improvement: ${lead.improvement}`);
  if (lead?.goal) parts.push(`Goal for next period: ${lead.goal}`);
  if (result.spread >= 2) parts.push(`Rater groups disagreed by ${result.spread} points — discussed in the feedback session.`);
  return parts.join(' ');
}

module.exports = { pushReview };

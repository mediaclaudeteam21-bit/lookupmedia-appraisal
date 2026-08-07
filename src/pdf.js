// ---------------------------------------------------------------------------
// The one-page summary that goes on the employee's record and gets handed over
// in the feedback session. It shows the blend, the lead's scorecard in full,
// and the pooled peer/upward numbers — never an individual peer or upward
// rater's name or score, because those forms promised anonymity.
// ---------------------------------------------------------------------------

const PDFDocument = require('pdfkit');
const criteria = require('../shared/criteria.json');
const { leadCriteriaBreakdown } = require('./blend');

const INK = '#0f172a';
const MUTED = '#64748b';
const ACCENT = '#312e81';
const LINE = '#e2e8f0';

function buildSummaryPdf({ subject, cycle, blend, reviews, roleDef }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = doc.page.width - 96;

    // Header
    doc.rect(0, 0, doc.page.width, 76).fill(ACCENT);
    doc.fillColor('#ffffff').fontSize(16).font('Helvetica-Bold')
      .text('Look Up Media LLC — Performance Review', 48, 24, { width: W });
    doc.fontSize(9).font('Helvetica')
      .text('Multi-rater result · Human Resources Department · Confidential', 48, 46, { width: W });
    doc.y = 100;

    // Who / when
    doc.fillColor(INK).fontSize(18).font('Helvetica-Bold').text(subject.name);
    doc.fontSize(10).font('Helvetica').fillColor(MUTED)
      .text(`${roleDef?.label || subject.role} · ${cycle.name} (${cycle.startDate} to ${cycle.endDate})`);
    doc.moveDown(1);

    // Final rating block
    const boxTop = doc.y;
    doc.roundedRect(48, boxTop, W, 62, 8).fillAndStroke('#eef2ff', LINE);
    doc.fillColor(ACCENT).fontSize(28).font('Helvetica-Bold')
      .text(`${blend.finalRating} / 5`, 62, boxTop + 12);
    doc.fillColor(INK).fontSize(12).font('Helvetica-Bold')
      .text(blend.ratingLabel, 180, boxTop + 16, { width: W - 150 });
    doc.fillColor(MUTED).fontSize(9).font('Helvetica')
      .text(blend.recommendedAction, 180, boxTop + 34, { width: W - 150 });
    doc.y = boxTop + 78;

    // How it was blended
    section(doc, 'How this rating was reached', W);
    for (const key of ['lead', 'peer', 'upward']) {
      const g = blend.groups[key];
      const counted = g.counts && g.average !== null;
      doc.fontSize(10).font('Helvetica').fillColor(counted ? INK : MUTED);
      doc.text(
        `${g.label}: ${g.average ?? '—'}  ·  ${g.responses} response${g.responses === 1 ? '' : 's'}  ·  ` +
        (counted ? `weight ${g.weight}%` : `not counted (needs ${g.required})`),
        { width: W }
      );
    }
    doc.fillColor(MUTED).fontSize(9)
      .text(`Weights normalised over ${blend.normalisedOver}%. ${blend.totalRaters} raters in total.`, { width: W });
    if (blend.spread >= 2) {
      doc.moveDown(0.3).fillColor('#92400e').fontSize(9)
        .text(`Rater groups disagreed by ${blend.spread} points. This was raised in the feedback session.`, { width: W });
    }
    doc.moveDown(0.8);

    // Lead's scorecard
    const leadRows = leadCriteriaBreakdown(reviews);
    if (leadRows.length) {
      section(doc, "The lead's scorecard", W);
      for (const row of leadRows) {
        if (doc.y > doc.page.height - 120) doc.addPage();
        doc.fontSize(9.5).font('Helvetica-Bold').fillColor(INK)
          .text(`${row.notApplicable ? 'N/A' : row.rating}  `, { continued: true })
          .font('Helvetica').text(row.criterion, { width: W });
        if (row.comment) {
          doc.fontSize(8.5).fillColor(MUTED).text(row.comment, { indent: 18, width: W - 18 });
        }
        doc.moveDown(0.25);
      }
      doc.moveDown(0.5);
    }

    // Narrative from the lead
    const lead = reviews.find((r) => r.reviewType === 'lead_member');
    if (lead) {
      if (doc.y > doc.page.height - 200) doc.addPage();
      section(doc, 'Summary', W);
      field(doc, 'Greatest strength', lead.strength, W);
      field(doc, 'Area for improvement', lead.improvement, W);
      field(doc, 'Goal for next period', lead.goal, W);
      if (lead.recognition === 'Yes') field(doc, 'Recommended for recognition', 'Yes', W);
      if (lead.pip === 'Yes') field(doc, 'Recommended for a Performance Improvement Plan', 'Yes', W);
    }

    // Pooled peer / upward themes, only where releasable
    for (const key of ['peer', 'upward']) {
      const g = blend.groups[key];
      const rows = reviews.filter((r) => (key === 'peer' ? r.reviewType === 'peer' : r.reviewType === 'member_lead'));
      if (!rows.length) continue;
      if (doc.y > doc.page.height - 160) doc.addPage();
      section(doc, `${g.label} feedback (pooled, ${rows.length} raters)`, W);
      if (!g.commentsReleasable) {
        doc.fontSize(9).font('Helvetica-Oblique').fillColor(MUTED)
          .text('Held back — fewer than three responses, so the comments would be traceable to one person.', { width: W });
        doc.moveDown(0.5);
        continue;
      }
      const shuffled = rows
        .map((r) => [r.strength, r.improvement].filter(Boolean).join(' — '))
        .filter(Boolean)
        .sort(() => Math.random() - 0.5); // pooled and unordered, so nothing maps back to a rater
      for (const line of shuffled) {
        doc.fontSize(9).font('Helvetica').fillColor(INK).text(`• ${line}`, { width: W });
      }
      doc.moveDown(0.5);
    }

    doc.fontSize(8).fillColor(MUTED)
      .text(`Generated ${new Date().toISOString().slice(0, 10)} · rating scale version ${criteria.version}`, 48, doc.page.height - 60, { width: W });

    doc.end();
  });
}

function section(doc, title, W) {
  doc.moveDown(0.4);
  doc.fontSize(10).font('Helvetica-Bold').fillColor(ACCENT).text(title.toUpperCase(), { width: W, characterSpacing: 0.6 });
  doc.moveTo(48, doc.y + 2).lineTo(48 + W, doc.y + 2).strokeColor(LINE).stroke();
  doc.moveDown(0.5);
}

function field(doc, label, value, W) {
  if (!value) return;
  doc.fontSize(9).font('Helvetica-Bold').fillColor(MUTED).text(label, { width: W });
  doc.fontSize(10).font('Helvetica').fillColor('#0f172a').text(value, { width: W });
  doc.moveDown(0.4);
}

module.exports = { buildSummaryPdf };

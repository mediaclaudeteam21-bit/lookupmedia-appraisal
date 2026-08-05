const PDFDocument = require('pdfkit');

function buildReviewPdf(d) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(9).fillColor('#64748b').text('LOOK UP MEDIA LLC — CONFIDENTIAL — INTERNAL HR DOCUMENT');
    doc.moveDown(0.5);
    doc.fontSize(20).fillColor('#0f172a').text('Performance Review Summary');
    doc.moveDown(0.3);
    doc.fontSize(12).fillColor('#334155').text(
      `${d.contractor || '—'}  ·  ${d.role || ''}${d.editorType ? ' (' + d.editorType + ')' : ''}  ·  ${d.period || ''}`
    );
    doc.moveDown(0.2);
    doc.fontSize(10).fillColor('#64748b').text(`Channel(s): ${d.channel || '—'}    Reviewer: ${d.reviewer || '—'}`);
    doc.moveDown(0.8);

    doc.fontSize(11).fillColor('#0f172a');
    doc.font('Helvetica-Bold').text('Overall Rating: ', { continued: true }).font('Helvetica')
      .text(d.overall != null ? `${d.overall} / 5` : 'Not calculated');
    doc.moveDown(0.3);
    doc.font('Helvetica-Bold').text('Recognition recommended: ', { continued: true }).font('Helvetica').text(d.recognition || 'No');
    doc.font('Helvetica-Bold').text('PIP recommended: ', { continued: true }).font('Helvetica').text(d.pip || 'No');
    doc.moveDown(0.8);

    doc.font('Helvetica-Bold').fontSize(12).text('Criteria Breakdown');
    doc.moveDown(0.3);
    doc.fontSize(10);

    (d.criteria || []).forEach((row, i) => {
      doc.font('Helvetica-Bold').fillColor('#0f172a').text(`${i + 1}. ${row.criterion}`, { width: 495 });
      doc.font('Helvetica').fillColor('#334155').text(`Self: ${row.self || '—'}    Manager: ${row.manager || '—'}`);
      if (row.notes) doc.fillColor('#64748b').text(`Note: ${row.notes}`, { width: 495 });
      doc.moveDown(0.4);
      doc.fillColor('#0f172a');
    });

    doc.moveDown(0.4);
    doc.font('Helvetica-Bold').fontSize(12).text('Summary');
    doc.font('Helvetica').fontSize(10).moveDown(0.2);

    const line = (label, value) => {
      doc.font('Helvetica-Bold').text(`${label}: `, { continued: true }).font('Helvetica').text(value || '—', { width: 430 });
    };
    line('Greatest strength', d.strength);
    line('Primary area for improvement', d.improvement);
    line('Action plan / goal for next period', d.goal);
    line('Additional comments', d.comments);

    doc.moveDown(1);
    doc.fontSize(8).fillColor('#94a3b8').text(
      `Generated ${new Date().toLocaleString()} by the LookUp Media appraisal page. Confidential — internal HR use only.`
    );

    doc.end();
  });
}

module.exports = { buildReviewPdf };

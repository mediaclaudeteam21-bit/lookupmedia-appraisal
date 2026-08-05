require('dotenv').config();
const express = require('express');
const path = require('path');
const orangehrm = require('./orangehrm');
const { buildReviewPdf } = require('./pdf');

const app = express();
const PORT = process.env.PORT || 3400;

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/push-to-orangehrm', async (req, res) => {
  const d = req.body || {};

  try {
    const pdfBuffer = await buildReviewPdf(d);
    const periodLabel = (d.period || 'Review').replace(/\s+/g, '_');
    const fileName = `${periodLabel}_Performance_Review.pdf`;
    const comment = `${d.period || 'Performance review'} — final rating ${d.overall != null ? d.overall + '/5' : 'not set'}`;

    const result = await orangehrm.pushReviewSummary({
      orangehrmEmployeeId: d.orangehrmEmployeeId,
      pdfBuffer,
      fileName,
      comment
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, reason: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`LookUp Media appraisal page running at http://localhost:${PORT}`);
  console.log(`OrangeHRM push configured: ${orangehrm.isConfigured()} (dry run: ${orangehrm.DRY_RUN})`);
});

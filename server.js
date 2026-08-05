require('dotenv').config();
const express = require('express');
const path = require('path');
const orangehrm = require('./orangehrm');
const { buildReviewPdf } = require('./pdf');

const app = express();
const PORT = process.env.PORT || 3400;

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---- One-time OrangeHRM OAuth connection -------------------------------
// Visit /oauth/start once (while logged into OrangeHRM in the same
// browser) to connect this app. After that, pushes work automatically.

app.get('/oauth/status', (req, res) => {
  res.json({ configured: orangehrm.isConfigured(), connected: orangehrm.isConnected(), dryRun: orangehrm.DRY_RUN });
});

app.get('/oauth/start', (req, res) => {
  try {
    const url = orangehrm.buildAuthorizeUrl();
    res.redirect(url);
  } catch (err) {
    res.status(500).send(`<p style="font-family:sans-serif">Can't start the connection yet: ${err.message}</p>`);
  }
});

app.get('/oauth/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;
  if (error) {
    return res.status(400).send(`<p style="font-family:sans-serif">OrangeHRM declined: ${error_description || error}</p>`);
  }
  try {
    await orangehrm.handleCallback(code, state);
    res.send(`
      <div style="font-family:sans-serif; max-width:520px; margin:60px auto; text-align:center;">
        <h2 style="color:#166534;">✅ Connected to OrangeHRM</h2>
        <p>This app can now push finalized reviews automatically. You can close this tab and go back to the appraisal page.</p>
        <a href="/" style="color:#4f46e5;">← Back to the appraisal page</a>
      </div>
    `);
  } catch (err) {
    res.status(500).send(`<p style="font-family:sans-serif">Connection failed: ${err.message}. <a href="/oauth/start">Try again</a></p>`);
  }
});

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

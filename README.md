# LookUp Media Appraisal — connected to OrangeHRM

This is your existing appraisal page (`public/index.html`), unchanged
except for one new field, plus the smallest possible server to make the
"Send to OrangeHRM" button actually do something. That's it — no
database, no login screen, no dashboard. Fill in a review, click Send,
it attaches the PDF to that employee's OrangeHRM record.

## Run it

```bash
npm install
cp .env.example .env
npm start
```

Open `http://localhost:3400`. Fill in the form like before. When you hit
**Send to OrangeHRM**, it now actually calls the server instead of
showing a demo message.

## What's new vs. your original file

- One added field: **OrangeHRM Employee ID** — the number from that
  person's OrangeHRM record URL. Needed so the server knows which record
  to attach the PDF to.
- The **Send to OrangeHRM** button now really sends the data to a small
  server, instead of just printing a demo message.
- Everything else — the form, the criteria, "Print / Save PDF," "Download
  data (JSON)" — is exactly what you already had.

## Connecting it to your real OrangeHRM

Edit `.env`:

```
ORANGEHRM_BASE_URL=https://your-orangehrm-domain
ORANGEHRM_USERNAME=...
ORANGEHRM_PASSWORD=...
ORANGEHRM_DRY_RUN=true
```

Leave `ORANGEHRM_DRY_RUN=true` at first — clicking Send will show you
exactly what *would* be sent without touching OrangeHRM. Once that looks
right, set it to `false` and test on one throwaway employee before using
it for real.

Use a dedicated OrangeHRM admin login for this rather than a real
person's account, so it doesn't break when someone changes their
password.

## Putting it online (so it's a real website, not just something on your laptop)

This still needs to run on a server somewhere to have a real URL and to
actually reach OrangeHRM. Shortest path — [Railway](https://railway.app),
about 10 minutes:

1. Sign up at railway.app.
2. Upload this folder to a GitHub repo (the web upload works, no command
   line needed), then in Railway: **New Project → Deploy from GitHub repo**.
3. Add the three `.env.example` variables under the project's **Variables** tab.
4. **Settings → Networking → Generate Domain** — that's your live URL.

No volume/database needed this time — there's nothing to persist on the
server itself; every review just gets pushed straight to OrangeHRM.

## If the OrangeHRM push fails

The login step (`orangehrm.js`) submits OrangeHRM's login form the same
way a browser does, since the free/open-source edition doesn't have a
separate API-key path. The one part that can vary by OrangeHRM version is
the CSRF field name it looks for — if login fails, check that against
your instance's login page source and adjust the regex near the top of
`login()` in `orangehrm.js`.

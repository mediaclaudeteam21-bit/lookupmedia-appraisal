# LookUp Media LLC — Performance Appraisal Site

The multi-rater appraisal form, plus an HR console that blends every review a
person receives and writes the result into OrangeHRM's **Performance** module
as a real review with KPI ratings.

Two pages:

| Page | Who uses it | Address |
|---|---|---|
| Rater form | Leads, members — anyone filling in a review | `/` |
| HR console | HR only, password protected | `/admin.html` |

---

## Run it

You need Node 18 or newer.

```bash
npm install
cp .env.example .env      # then fill it in — see below
npm start
```

Then open `http://localhost:3000`.

### What goes in `.env`

```
PORT=3000
ADMIN_PASSWORD=<pick something long — this guards the HR console>

ORANGEHRM_BASE_URL=http://localhost/orangehrm
ORANGEHRM_CLIENT_ID=<from OrangeHRM, see below>
ORANGEHRM_REDIRECT_URI=http://localhost:3000/oauth/callback
ORANGEHRM_FALLBACK_REVIEWER_EMPNUMBER=35
ORANGEHRM_DRY_RUN=true
```

`ORANGEHRM_BASE_URL` is only the base — no `/web/index.php/...` on the end.
The code adds that itself.

---

## Connect it to OrangeHRM

**1. Register this site inside OrangeHRM.**
In OrangeHRM: **Admin ▸ Configuration ▸ Register OAuth Client ▸ Add**.
Name it anything. For **Redirect URI**, put this site's address plus
`/oauth/callback` — it must match `ORANGEHRM_REDIRECT_URI` exactly, including
`http`/`https` and no trailing slash. Save, then copy the **Client ID** into
`.env` and restart.

**2. Check the connection.**

```bash
npm run probe
```

Read-only. It never writes anything. It tells you whether the token works,
whether the Performance module is reachable, and — importantly — whether the
seven job titles exist.

**3. Make sure the job titles exist.**
KPIs in OrangeHRM hang off **job titles**, so these seven must exist under
**Admin ▸ Job ▸ Job Titles**, spelled exactly:

```
Ideator · Scriptwriter · Thumbnail Creator · Video Editor
Uploader · Channel Manager · Quality Analyst
```

Every contractor also needs their job title set on their PIM record. This is
separate from employment status — everyone is *Independent Contractor* for
employment status, and additionally one of the seven above for job title.

**4. Create the KPIs.**

```bash
npm run sync-kpis
```

This creates every scorecard criterion as a KPI on the matching job title,
rated 1–5, plus two extras on every role: *Peer review — pooled average* and
*Upward review — pooled average*. Around 69 KPIs in total.

Safe to run again — anything that already exists by title is left alone. So
when you add a criterion to the form later, just run it once more.

**5. Sign in and sync the staff list.**
Open `/admin.html`, enter the HR password, click **Connect to OrangeHRM**
(a tab opens for OrangeHRM to confirm), then **Sync staff list**. Raters can
now pick people from a list instead of typing names, which is what links a
review to the right employee record.

**6. Turn dry run off** once a preview push looks right:
set `ORANGEHRM_DRY_RUN=false` and restart.

---

## Running a review round

1. **HR console ▸ Review round ▸ Open a new round.** Give it a name
   (`Q3 2026`), a period, and a due date. Opening a round closes the previous
   one. Raters can only submit into the open round.
2. **Send everyone the form link.** Each rater fills it in once per person
   they're reviewing. If someone submits twice about the same person, the
   second one replaces the first — it never double-counts.
3. **Watch the console.** Each person shows how many lead / peer / upward
   reviews are in, the blended score so far, and whether they're ready.
4. **Open a person ▸ Preview summary PDF** to check before anything is sent.
5. **Send to OrangeHRM.** With dry run on, you get the exact plan instead.

### People with no internal supervisor

OrangeHRM insists on a reviewer for every review row, but six people here have
no internal supervisor on purpose:

| Person | Who actually rates them | Row filed under |
|---|---|---|
| Luka Pecirep | CEO — rated from the form, not by a manager | Cenri |
| Jehanne Antocan, Kelvin Garcia | Barbara (external partner) | Cenri |
| Alvin Apuada, Zaid Arshad, Mark Flores | External partners | Cenri |

`ORANGEHRM_FALLBACK_REVIEWER_EMPNUMBER=35` files their review rows under
**John Maspara ("Cenri")**. This changes only the name OrangeHRM prints in the
Reviewer column — the rating still comes from whoever actually filled in the
form on this site, and the push log says plainly when the stand-in was used.

This includes Luka. His row showing Cenri as reviewer is a filing artifact,
not a reporting line — it does not make Cenri his manager, and it does not
change who rated him.

The one row this cannot cover is **Cenri's own**. OrangeHRM does not let a
person be their own reviewer — its own Add Review screen only offers people
from the employee's supervisor list — so the site blocks that push rather than
sending something OrangeHRM would reject. Cenri needs a Report-to in
OrangeHRM (PIM ▸ Report-to) before his own review can be filed. Luka is the
obvious choice.

### The blending rules the console enforces

- Lead's scorecard **60%**, peer average **25%**, upward average **15%**.
- Peer only counts at 2+ responses, upward at 3+. Below that the weight is
  redistributed across the groups that did count.
- Nobody is finalised on fewer than 3 raters, or without a lead scorecard —
  the lead's form is where the KPI ratings come from.
- Peer and upward comments stay sealed below 3 responses in that group,
  because below that they're traceable to one person.
- A 2+ point gap between rater groups is flagged for the feedback session.

HR sees peer and upward **ratings and comments**, never which rater said what.

---

## What lands in OrangeHRM

For one person, one round:

1. Any missing KPIs are created on their job title.
2. A review row appears in **Performance ▸ Manage Reviews**, with their
   supervisor as reviewer.
3. The lead's per-criterion ratings and notes are written against those KPIs.
   The pooled peer and upward averages go in as their own two KPIs, so nobody
   reading the record mistakes a peer number for the lead's judgement.
4. The blended score is written as the **final rating** and the review is
   marked complete.
5. The summary PDF is attached to the employee's record.

Individual reviews never leave this site. OrangeHRM only ever receives the
finished result.

---

## If something goes wrong

**"Not connected to OrangeHRM"** — the token expired or the app restarted
without its data folder. Click Connect again in the console.

**Redirect URI mismatch during Connect** — the URI in OrangeHRM's OAuth client
settings must match `ORANGEHRM_REDIRECT_URI` character for character.

**A push fails on the KPI ratings step** — OrangeHRM has moved this field
between point releases. The code fetches the rating rows first and matches on
KPI, and retries the other shape automatically, so this should self-correct.
If it still fails, the error from OrangeHRM is shown verbatim in the console
and is the most useful clue.

**"X has no job title in OrangeHRM"** — set it on their PIM job tab. KPIs
can't attach without one.

**"X has no supervisor, and no stand-in reviewer set"** — set
`ORANGEHRM_FALLBACK_REVIEWER_EMPNUMBER` (see below), or add a Report-to for
that person in OrangeHRM.

**"X would end up listed as their own reviewer"** — the stand-in reviewer is
the person being reviewed. Give them a supervisor in OrangeHRM, or push them
with a different reviewer.

---

## Where the data lives

```
data/appraisal.json          every review, cycle, roster cache, push log
data/orangehrm-tokens.json   the OrangeHRM connection
```

Both are plain files in `data/`. **Back this folder up**, and if you host this
somewhere that wipes the disk on redeploy (Railway, Render, Fly), attach a
persistent volume mounted at `data/` — otherwise a redeploy loses every review
that hasn't been pushed yet.

---

## What's in it

```
server.js              routes: the form, the console, OAuth, the push
shared/criteria.json   all 9 forms + the scale + the weights — ONE source of
                       truth, used by the form, the PDF, and the KPIs
src/store.js           the JSON file store
src/blend.js           blending + the guard rails
src/orangehrm.js       OAuth2 (PKCE) + every OrangeHRM API call
src/push.js            orchestrates one person's push
src/pdf.js             the summary PDF
src/tokenStore.js      keeps the connection across restarts
scripts/probe.js       read-only connection check
scripts/sync-kpis.js   creates the KPIs
public/index.html      the rater form
public/admin.html      the HR console
docs/KPI_MAPPING.md    which criterion becomes which KPI
```

### Changing the questions

Edit `shared/criteria.json` — nothing else. The form, the PDF and the KPI
names all read from it. After adding or renaming a criterion, run
`npm run sync-kpis` so OrangeHRM gets the new KPI.

Renaming an existing criterion creates a *new* KPI rather than renaming the
old one, since KPIs are matched by title. Delete the stale one in OrangeHRM if
you don't want both.

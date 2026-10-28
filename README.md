# Sailor Pension Entry

A web tool for research assistants (RAs) to transcribe Union Navy pension files for the Black prize-winners project (Clegg & Weaver). The form is a pension-only rebuild of the Union Army Data project's inputting program (`new_mil.exe`) and its 2010 *National Archives Inputting Manual*, adapted for Navy files.

- **The page** is static HTML and JavaScript, hosted free on GitHub Pages.
- **The data** lives in a [Supabase](https://supabase.com) project: a Postgres database with logins.
- **Every RA signs in.** Every save is stored as a new version stamped with who saved it and when, so you can see exactly who entered or changed each field. The database stamps the name from the login; nobody can type someone else's name.

## How it works

| Piece | Where | What it does |
|---|---|---|
| `index.html`, `css/`, `js/` | GitHub Pages | The form, records list, edit history and team pages. No build step. |
| `config.js` | GitHub Pages | Your Supabase URL and public key. Both are safe to publish. |
| `supabase/migrations/*.sql` | Supabase | Tables, permission rules and history triggers. Applied by a GitHub Action. |
| `.github/workflows/deploy.yml` | GitHub Actions | On every push to `main`: runs the checks, then applies new migrations, then publishes the site. Nothing deploys if a check fails. Pull requests get the checks only. |
| `.github/workflows/backup.yml` | GitHub Actions | Nightly encrypted backup: kept 30 days as an artifact, plus the latest good one in the `backup-latest` release. See `docs/BACKUPS.md`. |
| `.github/workflows/supabase-keepalive.yml` | GitHub Actions | Pings the database every 3 days so a free project isn't paused. |
| `data_dictionary.csv` | — | Every field: label, type, codes, old Union Army variable, coding instructions. |
| `tools/`, `test/`, `schema.lock.json` | GitHub Actions / your machine | The checks (see "Checks before deploying"). |
| `CLAUDE.md`, `AGENTS.md` | — | Rules for anyone, including AI agents, changing this repo. |
| `docs/GUIDE.md` | — | Developer guide: how it works, a map of every file, the record format, and how to make common changes. |

**Database tables**

- `profiles`: one row per login. It holds the name shown in the history, the role (`ra` or `admin`) and an `active` switch. New logins start **inactive**, so they can see and change nothing until an admin switches them on.
- `records`: one row per pension file. The whole form is in `data` (JSON), with `sailor_id`, `sailor_name`, `status`, `version`, `created_by`, `updated_by` and timestamps alongside.
- `record_versions`: a full snapshot of every save (`create`, `edit`, `delete`, `restore`) with `edited_by` and `edited_at`. Only the database writes here. Nobody can edit or delete history from the app.

**Views:** `records_overview` (records with creator and last-editor names), `ra_activity` (per person per day: records created, saves, records touched), and `record_fields` (all data in long format, one row per filled field, for analysis). The function `record_changes(uid)` lists every field changed in every save of one record.

**Rules the database enforces**

- Only signed-in, active people can read or save anything.
- A save carries the version the RA opened. If someone else saved in between, the save is refused and the RA chooses: keep mine (theirs stays in history) or load theirs.
- Only admins can delete (soft delete; the history is kept) or restore a record, activate people, or change roles. An admin can't demote or deactivate themselves.
- Nobody can hard-delete records or alter history from the app.

## One-time setup (about 30 minutes)

### 1. Create the Supabase project

1. Sign up at supabase.com and create a project. Pick the region nearest your team, and check whether UBC research-data rules require a particular one. Save the **database password** you set.
2. If Supabase asks about the Data API when you create the project: **Enable Data API: on** (the tool uses it). **Automatically expose new tables: off** (recommended; the migrations grant exactly the access the tool needs). **Enable automatic RLS: on** (a safety net; the migrations turn on row-level security anyway).
3. Turn off public sign-up. Under **Authentication → Sign In / Providers**, switch off **Allow new users to sign up**, and keep **Email** sign-in on. People get accounts only when you add them.
4. Note four things:
   - **Project URL** and **anon / publishable key**: Project Settings → API (or API Keys).
   - **Project ref**: the ID in your dashboard URL, `supabase.com/dashboard/project/<ref>`.
   - **Access token**: your account menu → Access Tokens → Generate. This one is for GitHub only. Keep it secret.

### 2. Put the code on GitHub

1. Push this folder to a GitHub repository.
2. In the repo, go to **Settings → Secrets and variables → Actions** and add three secrets: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF` and `SUPABASE_DB_PASSWORD`.
3. Go to **Settings → Pages** and set **Source** to **GitHub Actions**. The workflow, not GitHub, then publishes the site, and only after the checks pass.
4. Go to **Actions → Check and deploy → Run workflow** (tick *Apply database migrations* the first time). When it's green, the database has its tables and the site is live at `https://<user>.github.io/<repo>/`.
   - No GitHub Action? You can instead paste the four files in `supabase/migrations/` into Supabase's **SQL Editor**, in name order, and run each one.
5. Edit `config.js` with your Project URL and anon key, then commit and push. The workflow redeploys the site.

### 3. Make yourself the first admin

1. In Supabase, go to **Authentication → Users → Add user → Create new user**. Enter your email and a password, and tick **Auto Confirm User**.
2. In the **SQL Editor**, run:
   ```sql
   update public.profiles set role = 'admin', active = true, display_name = 'Your Name'
   where email = 'you@university.edu';
   ```
3. Sign in on the GitHub Pages site. You'll see **Team & activity** in the left menu.

### 4. Add RAs

1. In Supabase, go to **Authentication → Users → Add user → Create new user**. Use their email and a temporary password, and tick **Auto Confirm User**.
2. In the tool, go to **Team & activity**, set the name that should appear in the history, and tick **Active**.
3. Send them the site link and temporary password. They change it from the button with their name (top right).

To remove someone, untick **Active**. Their history stays. To reset a forgotten password, use Supabase → Authentication → Users → the person → Reset or Send password recovery. Email recovery needs Supabase's email set up; otherwise set a new temporary password there.

### 5. Free plan only: keep-alive

Free Supabase projects pause after about a week without activity. `supabase-keepalive.yml` pings every 3 days using the URL and key in `config.js`, so it needs no extra setup. Run it once by hand (**Actions → Supabase keep-alive → Run workflow**) to check. It also commits a one-line timestamp on the 1st of each month, because GitHub switches off scheduled workflows in repos with no commits for 60 days. On a paid plan, delete this workflow.

**Backups:** the free plan has none of its own, so `.github/workflows/backup.yml` makes an encrypted backup every night. Each is kept 30 days, and the most recent good one is kept indefinitely. Setup (a key for each PI and one secret) and restoring are in [docs/BACKUPS.md](docs/BACKUPS.md). The Pro plan ($25/month) would add Supabase's own daily backups and stop the pausing.

## Using it (RAs)

- **Sign in**, choose **New record**, and enter the **Sailor ID** first.
- **Save** (button, or Ctrl+S). It also saves itself every 2 minutes when there are changes. The status at the top shows *Unsaved changes* or *Saved · v5 · time*.
- Unsaved work is also kept in the browser. If a tab closes, reopening the record offers it back.
- **Records** lists every file with who created it, who last saved it and how many people have edited it. **History** shows each save, who made it, and every field it changed, before and after. **Load into editor** brings back an older version; it becomes current only when saved.
- If someone else saved the same record while you had it open, you'll be asked whether to keep yours or load theirs. Nothing is lost either way: both versions stay in the history.

## Tracking who did what

In the tool, open **Team & activity** (admins) for records created, saves, and records touched per person per day, and use **History** on any record.

In Supabase's SQL Editor, for example:

```sql
-- every change to children's names, with who made it
select r.sailor_id, c.*
from records r, record_changes(r.uid) c
where c.path like 'family.children.%.name';

-- all saves by one RA last week
select rv.record_uid, rv.version, rv.action, rv.edited_at
from record_versions rv join profiles p on p.id = rv.edited_by
where p.email = 'ra@university.edu' and rv.edited_at > now() - interval '7 days';

-- who entered each record
select sailor_id, sailor_name, created_by_name, updated_by_name, n_editors from records_overview;
```

## Getting the data into R

Connect directly to the database. In Supabase, click **Connect** and copy the session pooler connection string.

```r
library(DBI); library(dplyr); library(tidyr)
con <- dbConnect(RPostgres::Postgres(),
  host = "aws-0-<region>.pooler.supabase.com", port = 5432, dbname = "postgres",
  user = "postgres.<project-ref>", password = Sys.getenv("SUPABASE_DB_PASSWORD"))

fields <- dbGetQuery(con, "select * from record_fields")   # one row per filled field
children <- fields |>
  filter(section == "family", group == "children") |>
  pivot_wider(id_cols = c(sailor_id, row), names_from = field, values_from = value)
```

This login is the database owner and bypasses the RA permission rules, so keep the password out of scripts you share. The CSV export in the tool has the same long layout, plus the old Union Army variable name in `ua_var`.

## Changing the form

The fields are defined in `js/schema.js` (`SCHEMA`). After editing it, run `node tools/update.js`, which refreshes `schema.lock.json` and `data_dictionary.csv`, and commit all three. Saved records pick up new fields automatically. RAs see the change after the workflow finishes, when they reload the page.

- **Safe:** new fields, blocks or codes; new or changed labels, help text, hints, order.
- **Dropping or moving** a field, block or section is not breaking if you mark it `hide:true` in `js/schema.js`: it leaves the form but its saved values stay. See the developer guide.
- **Breaking:** renaming or removing a field key, block or section; switching a block between one-off and repeatable. Saved values would disappear from the form and the exports. `tools/update.js` refuses these. If one is really needed, see `CLAUDE.md` rule 1 (it needs a data migration as well).

Database changes go in a **new** migration file with a later timestamp (e.g. `supabase/migrations/20261101000000_add_x.sql`). Never edit one that has already been applied; the checks block that.

`CLAUDE.md` has the full rules, written so that an AI assistant opening this repo in a new session follows them too.

## Checks before deploying

Every push to `main`, and every pull request, runs three checks in `deploy.yml`. If any fails, nothing is deployed, the live site and database stay as they were, and the run's summary page says what to fix.

| Check | Catches |
|---|---|
| `tools/check.js` | JavaScript syntax errors. Field keys or blocks renamed or removed, or a block switched between one-off and repeatable, without acknowledgement. `schema.lock.json` or `data_dictionary.csv` not regenerated. Edited, deleted, misnamed or out-of-order migrations. A secret or service-role key in `config.js` or any file. Exported data files committed. |
| `test/run_sql_tests.sh` | Any database change that breaks the rules: inactive accounts, editor stamping, conflict detection, admin-only delete, untouchable history, signed-out access. Runs 28 checks on a throwaway Postgres, with "Automatically expose new tables" both off and on. |
| `tools/smoke_test.js` | The page failing in a browser. It opens the site in demo mode (never the live database), signs in, opens every section, adds a row, saves, checks the edit history, the date check, the export and the admin page, checks phone-width layout, and fails on any JavaScript error. |

Run them locally the same way (needs Node, plus a scratch Postgres for the second):

```
node tools/check.js
bash test/run_sql_tests.sh "postgres://postgres:postgres@localhost:5432/postgres"
npm install --no-save playwright && npx playwright install chromium && node tools/smoke_test.js
```

Never point the SQL tests at the real project. `bash test/run_sql_tests.sh <url> --walkthrough` also prints `test/run_tests.sql`, a readable tour of the same rules.

A failing check doesn't stop the commit from landing on `main`, but it stops it from going live. Fix it in a new commit, or `git revert` it; the next green run deploys. Don't add a GitHub branch rule requiring the checks: it would also block the keep-alive workflow's monthly commit.

The page also runs without a database. With `config.js` blank it starts in **demo mode**: three pretend people, data kept in the browser, the same rules. Use it to try things out or to train RAs.

## Security notes

- The anon key in `config.js` is meant to be public. On its own it can only call the keep-alive and attempt a sign-in. Everything else is checked against the signed-in person in the database.
- Keep public sign-up off (setup step 1.3). Even if it were turned on, new accounts start inactive and can't see data.
- Never put the database password, access token or service-role key in this repo. They belong in GitHub secrets only.

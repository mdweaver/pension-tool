# Working on this repo (for AI agents and people)

Read this before changing anything. It is the data-entry tool research assistants use to transcribe Union Navy pension files; the data is live research data in Supabase.

Background, the live setup, a map of every file, the record format, and how-tos are in the developer guide, imported here so it loads with this file:

@docs/GUIDE.md

## How it fits together

- **Site** (`index.html`, `css/`, `js/`, `config.js`): static, no build step, published to GitHub Pages **only** by `.github/workflows/deploy.yml` after its checks pass.
  - `js/schema.js`: the form (`SCHEMA`), code lists (`CODES`), and help text (`HELP`, from the Union Army program). **Most changes happen here.**
  - `js/backend.js`: two interchangeable backends. `SupabaseBackend` (live) and `DemoBackend` (in-browser, same rules), chosen by whether `config.js` is filled in.
  - `js/app.js` (state, local drafts), `js/render.js` (fields, validation, field guide), `js/views.js` (records, history, team, sign-in), `js/events.js` (editing, saving, startup), `js/export.js` (JSON/CSV export, demo example record).
- **Database** (`supabase/migrations/*.sql`): applied in name order by the same workflow, only after checks pass.
  - Each record is one JSON document in `records.data`. Every save writes a snapshot to `record_versions`, stamped by a trigger with the editor's login (never trust or accept an editor name from the client).
  - Row-level security: only active profiles can read or save; only admins delete (soft) or restore, activate people or change roles; nobody edits history.
  - `save_record(uid, data, base_version)` refuses stale saves (`conflict`).
- **Checks**: `tools/check.js`, `test/run_sql_tests.sh` (`test/assertions.sql`), `tools/smoke_test.js`. Run them all before committing.

## Rules

1. **Never rename or remove a field key, block id or section id in `js/schema.js`**, and never switch a block between one-off and repeatable. Saved records use those keys, and the old values would vanish from the form and the exports. Changing labels, help text, order, hints and adding new fields or codes is safe.
   - If a rename is truly needed: run `node tools/update.js --allow-breaking`, **and** add a migration that moves existing values in `records.data` (e.g. `jsonb_set`/`#-` in an `update public.records ...`). Remember that the update creates new history versions; run it as `postgres`, so `updated_by` is null, and say so in the commit.
2. **After any change to `js/schema.js`, run `node tools/update.js`.** It regenerates `schema.lock.json` and `data_dictionary.csv`, and refuses breaking changes (rule 1). CI fails if either file is stale.
3. **Never edit, rename or delete a migration file that is already on `main`.** It has already run and will never run again. Put every database change in a new file named `YYYYMMDDHHMMSS_short_name.sql`, with a timestamp later than every existing one. Write migrations to be safe to re-run (`create or replace`, `if not exists`, `drop policy if exists` …).
4. **New tables or functions need explicit grants** (see `20261019000300_grants.sql`). The project runs with "Automatically expose new tables" off. Enable row-level security and write policies for every new table. Keep `revoke ... from anon` for anything not meant for signed-out visitors.
5. **Never weaken the database's protections** (editor stamping, versioning, conflict checks, admin-only delete, new accounts inactive) unless the project owner explicitly asks. `test/assertions.sql` encodes them; if a change makes it fail, fix the change, not the test.
6. **`config.js` holds only the project URL and the publishable/anon key.** Never commit `sb_secret_...`, service-role keys, the database password, access tokens or connection strings anywhere. Secrets live only in GitHub Actions secrets.
7. **Never commit exported data** (`pension_records_*.json/csv`, `<sailor>_<date>.json/csv`) or anything copied from the database. The repo is public.
8. **Page code that needs a new database function must ship together with, or after, the migration that creates it.** The workflow applies migrations before publishing the site, so one push with both is fine.
9. **Don't add a build step, framework, or npm dependency to the site.** It must stay plain files that GitHub Pages serves as-is. Pin any CDN script to an exact version.
10. **Keep the demo backend in step with the database.** If you change a rule in SQL, change `DemoBackend` to match, so demo mode (and the smoke test) behaves like the live site.

## Before committing

```bash
node tools/update.js                      # if js/schema.js changed
node tools/check.js                       # repo checks (add BASE_SHA=origin/main to compare with what is live)
bash test/run_sql_tests.sh "postgres://postgres:postgres@localhost:5432/postgres"   # needs a scratch Postgres 15+
npm install --no-save playwright && npx playwright install chromium && node tools/smoke_test.js
```

The same three checks run in CI on every push and pull request; nothing deploys unless they pass. For larger changes, work on a branch and open a pull request so the checks run before `main` changes.

## Testing by hand

Open `index.html` with `config.js` blank (or temporarily blanked, without committing) to get demo mode: three pretend people, a fictional example record, and data kept in the browser. Never test against the live Supabase project with made-up records unless you delete them afterwards (admins can soft-delete).

## Commit messages

Say what changed for the RAs, whether a migration is included, and whether the change is breaking (rule 1).

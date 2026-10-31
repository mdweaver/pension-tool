# Developer guide

Background, a map of the files, and how-tos for working on this repo. The rules in `CLAUDE.md` take precedence over anything here.

## What this is

A web tool for research assistants (RAs) to transcribe **Union Navy pension files** from the National Archives. It belongs to the Clegg & Weaver project on Black Union Navy sailors who won prize money during the Civil War (a natural experiment in cash transfers to formerly enslaved people). Pension files supply family, residence, occupation, wealth, literacy and death information. They also link sailors to censuses, and their children's details support intergenerational analysis.

The form rebuilds the **Union Army Data project's** Windows inputting program (`new_mil.exe`, Tcl/Tk, Center for Population Economics, University of Chicago, 2004) and its *National Archives Inputting Manual* (2010). It keeps only what comes from pension files, and adapts military service for the Navy (ratings, vessels). The `ua` / `ua_var` fields record each field's variable name in that old program, and most help text is that program's own pop-up help. Additions for this project are tagged `project` and Navy adaptations `navy`.

Users are a few RAs and two PIs (admins). There are hundreds to low thousands of records. Every save matters for provenance, so the database keeps a full history of who entered what.

## Live setup (as of October 2026)

| Thing | Value or where |
|---|---|
| Site | https://mdweaver.github.io/pension-tool/, deployed by `.github/workflows/deploy.yml`. Pages source is **GitHub Actions**. |
| Repo | https://github.com/mdweaver/pension-tool, **public** (no secrets or data in it). |
| Database | Supabase project `xbmnzznrjejgxkzrttdl` (the URL is in `config.js`). Free plan, kept awake by `supabase-keepalive.yml`. |
| Supabase settings | Data API on; "Automatically expose new tables" **off** (hence explicit grants); automatic RLS on; **public sign-up off**; email/password sign-in on. No custom SMTP, so invitation and reset emails aren't used. |
| GitHub secrets | `SUPABASE_ACCESS_TOKEN` (scoped to this project, expires; see README), `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`. |
| Accounts | Created by an admin in the Supabase dashboard (Authentication → Users → Add user, auto-confirm), then switched on in the tool's **Team & activity** page. PIs are admins. |
| Backups | Nightly, encrypted with `age` for the keys in `backup/recipients.txt`; 30-day artifacts plus the `backup-latest` release (indefinite). Secret `SUPABASE_DB_URL` (session pooler). See `docs/BACKUPS.md`. |
| Commit email | Commits use the GitHub noreply address (`10960653+mdweaver@users.noreply.github.com`). Pushes signed with the private email are blocked by GitHub. |

## How it works

```
RA's browser ── index.html + js/ (GitHub Pages)
     │  supabase-js 2.45.4 (CDN), publishable key from config.js
     ▼
Supabase ── Auth (email + password) ── Data API (PostgREST) ── Postgres
                                                               ├─ profiles         (who; role; active)
                                                               ├─ records          (one JSON doc per pension file)
                                                               └─ record_versions  (snapshot of every save; trigger-written)
```

- **No build step.** The site is plain HTML, CSS and JS loaded as separate `<script>` files in a fixed order (see `index.html`). Globals are shared between files on purpose.
- **Demo mode.** If `config.js` is blank, `DemoBackend` stores everything in `localStorage`, with three pretend users and a fictional example record. It follows the same rules as the database. The smoke test uses it.
- **Who did what** is never taken from the browser. The `records_stamp` trigger sets `created_by` / `updated_by` from `auth.uid()`, and `records_log_version` writes the history. The client can't fake either.

## File map

| Path | What it is |
|---|---|
| `index.html` | Page shell: header buttons, three-column layout (section index · form · field guide), script tags in load order. |
| `config.js` | `window.CONFIG = { SUPABASE_URL, SUPABASE_ANON_KEY }`. Public values only. Blank means demo mode. |
| `css/style.css` | All styles. Colour tokens on `:root` with dark-mode overrides; IBM Plex fonts; responsive down to phone width. |
| `js/schema.js` | **The form.** (After `SCHEMA`: the loop that adds the Fold3 `src` field to every block, and `visSections`, `visGroups`, `visFields`.) `HELP` (old-program help, keyed by variable), `STATES` (state/country codes from the manual's Appendix A), `CODES` (all code lists), `RATINGS`, field helpers, and `SCHEMA` (sections → blocks → fields). Most changes happen here. |
| `js/app.js` | Storage helpers, `newRecord()`, `upgrade()` (fills fields added since a record was saved), global state (`API`, `ME`, `LIST`, `cur`, `curMeta`, `dirty`…), local drafts, utilities. |
| `js/render.js` | Validation (`checkDate`, `checkField`, `allChecks`), field and block HTML, the field-guide panel, `buildDatalists`, `fieldForPath`. |
| `js/views.js` | Screens: top bar and save state, section index, sign-in, inactive notice, records list, edit history (`pathLabel` turns paths into readable labels), team and activity, account dialog, conflict dialog. |
| `js/backend.js` | `SupabaseBackend(url, key)` and `DemoBackend()`, with identical method names: `init, signIn, signOut, me, list, get, save, versions, changes, versionData, setDeleted, team, updateProfile, activity, setMyName, changePassword, allData`. |
| `js/export.js` | `flatRows` / `toCSV` (long format with `ua_var`), JSON and CSV download, and `exampleRecord()` for the demo. |
| `js/events.js` | Input handling (uppercase, date masking), side-panel refresh timing, navigation, `saveNow` (autosave every 2 min), `openRec` (restores local drafts), click actions, import, minutes counter, sign-in, `boot()`. Loads last. |
| `supabase/migrations/` | Database, applied in name order and never edited afterwards. `…000000_keepalive` (ping function), `…000100_core` (tables, triggers, RLS, `save_record`, `record_changes`, `jsonb_flatten`), `…000200_views` (`ra_activity`, `records_overview`, `record_fields`), `…000300_grants` (explicit privileges). |
| `supabase/config.toml` | Supabase CLI project file, used by the workflow's `supabase link` and `db push`. Local-dev settings in it don't affect the live project. |
| `supabase/.temp/` | Git-ignored scratch space (CLI state, ad-hoc check scripts). |
| `schema.lock.json` | Generated by `tools/update.js`: the field keys and block shapes that saved data depends on, plus acknowledged breaking changes. Don't edit by hand. |
| `data_dictionary.csv` | Generated by `tools/update.js`: every field with label, type, codes, old variable, origin, status (`active` or `retired`) and help. |
| `tools/lib.js` | Loads `js/schema.js` in Node (`vm`), computes the schema "shape", compares shapes, and builds the dictionary. |
| `tools/update.js` | Run after editing the schema. Regenerates the lock and dictionary, and refuses breaking changes unless `--allow-breaking`. |
| `tools/check.js` | Repo checks: JS syntax, config key type, lock and dictionary current, breaking changes vs `BASE_SHA`, migration naming, immutability and order, secrets, exported data files. |
| `tools/smoke_test.js` | Playwright, demo mode, with `config.js` replaced by a blank one: sign in, all sections, edit, save, history, date check, export, admin page, phone width, no JS errors. |
| `test/supabase_stub.sql` | Imitates Supabase's `auth` schema and the `anon`, `authenticated` and `service_role` roles on plain Postgres. |
| `test/assertions.sql` | 28 database rules, each failing loudly (`testkit.ok` / `testkit.fails`). |
| `test/run_sql_tests.sh` | Builds throwaway databases (expose off and on), applies the migrations, runs the assertions. `--walkthrough` also runs `test/run_tests.sql`, a readable tour. |
| `.github/workflows/deploy.yml` | Runs `checks` → `deploy-db` (only if migrations changed, or forced) → `deploy-site` (publishes only `index.html`, `config.js`, `css/`, `js/`). Pull requests run the checks only. |
| `.github/workflows/backup.yml` | Nightly: dump (PostgreSQL 17 in Docker) → test-restore → guard against data loss → encrypt → 30-day artifact → replace the `backup-latest` release. |
| `tools/backup.sh` / `tools/verify_backup.sh` / `tools/backup_guard.js` / `tools/restore.sh` | Make a backup folder; prove it restores (counts and checksums); refuse to replace `backup-latest` after a big drop; restore into the same project or (`--with-auth`) a new one. |
| `backup/recipients.txt` | Public `age` keys that can decrypt backups. Public keys only. |
| `docs/BACKUPS.md` | Backup setup, restore steps and troubleshooting. |
| `.github/workflows/supabase-keepalive.yml` | Pings `keepalive_ping()` every 3 days, and makes a monthly timestamp commit so GitHub keeps the schedule enabled. |
| `README.md` | For the PIs: setup, adding RAs, tracking edits, R access, security notes. |
| `CLAUDE.md` / `AGENTS.md` | Rules for anyone changing the repo, including AI agents. |

## The data model

A record is one JSON object in `records.data`, mirroring `SCHEMA`:

```jsonc
{
  "_uid": "rmvffiq7nunwb8l",            // also the primary key in records.uid; ^r[a-z0-9]{4,40}$
  "_schema": 2,
  "meta":     { "file": { "sailor_id": "S-0042", "status": "P", "minutes": "12", ... }, "qc": { ... } },
  "personal": { "names": [ { "name": "FREEMAN, ISAAC", "note": "" } ],      // repeatable block = array of rows
                "death": { "date": "03/--/1902", "date_q": "1", ... } },    // one-off block = object
  "apps":     { "app": [ { "type": "N", "claims": [ { "claim": "RHEUMATISM", "by_sailor": "X", "by_board": "X" } ], ... } ] },
  ...
}
```

- **Section ids:** `meta, personal, family, socio, service, apps` are shown. `medical, aff, slavery, va` are **hidden** (see "Hidden fields"); their data is kept and the content of `medical` and `slavery` was re-created in `service` and `personal`.
- **Every value is a string.** Dates are `MM/DD/YYYY` with `-` for what the file doesn't give (`--/--/1865` for a year only, `04/--/1865` for year and month). The form shows year, month and day as three boxes and builds this string (`composeDate` / `dateParts` in `js/render.js`). Each date field `x` with a quality code also has `x_q`. Checkboxes store `"X"` or `""`.
- **Paths** like `family.children.2.name` are used in the HTML (`data-path`), in the field-level history (`record_changes`), and in the `record_fields` view (where row numbers are 1-based).
- **`upgrade(r)`** adds any fields or blocks missing from an older record. It never removes keys, so old keys survive in the JSON even if dropped from the schema.
- **Keys starting with `_`, and `meta.file.minutes`** (bumped automatically every 30 s), are left out of the change log.

### Field definitions in `SCHEMA`

Helpers build field objects: `U` (URL, checked as a web address; Fold3 expected), `T` (text), `NM` (name, uppercase), `D` (date; adds a `_q` quality code unless `{q:false}`), `C` (code from `CODES[list]`), `NUM` (number with min and max; `{dec:true}` for decimals), `AR` (long text), `X` (checkbox), `Q` (quality-code field), `BR` (line break), `PLACE(prefix, uaVars, withQ, {addr:false})` (address, city, county, state, country and quality-code fields; choosing a US state fills the country with US through the state field's `cty` option), `IMG` (image number), `AF` (a drop-down of the application / certificate numbers entered in File & tracking; stores the label, e.g. "Application number 12345", and flags a value that is no longer listed), and `{t:'sub', k, l, fields}` for a nested repeatable block (only `apps.app.claims` today).

Common options: `hide:true` (retired, see below), `sel:true` (a code field shown as a drop-down), `cty` (key of the country field a state fills in), `ua` / `uaq` (old variable names, which also look up help text), `help` (overrides it), `tag:'navy'|'project'`, `req:true`, `nameRule:true` (warn without `LAST, FIRST`), `list:'RATINGS'` (text with suggestions), `min` / `max` (date years or number range), `w` (width in characters).

A block is `{id, title, repeat?, sortBy?, hint?, hide?, nosrc?, init?, ignore?, fields}`. `nosrc` leaves out the automatic Fold3 source URL; `init` is a list of starting rows (File & tracking starts with an application row and a certificate row); `ignore` lists fields pre-filled in `init` that don't count as "entered". A section is `{id, n, title, ua, intro, groups}`.

## Saving, conflicts and history

1. Opening a record loads `data` and `version` (`curMeta.version`).
2. Edits mark the record dirty and are copied to `localStorage` (`spe.draft.<user>.<uid>`) within 0.3 s, so a closed tab loses nothing. Reopening offers the draft back. If the server moved on, the draft is offered as a "stale" copy.
3. **Save** (button, Ctrl+S, or autosave every 2 minutes) calls `save_record(uid, data, base_version)`:
   - new record (`base 0`) → insert, version 1;
   - `base` equals the current version → update; the trigger bumps the version and stamps the editor; history row `edit`;
   - `base` is out of date → returns `{ok:false, conflict:true, updated_by, updated_at}`, and the RA chooses *Save mine anyway* (re-save with the new base) or *Load their version*;
   - identical data → no new version.
4. History: `record_versions` (one full snapshot per save, `create | edit | delete | restore`) and `record_changes(uid)` (field-level before and after, computed on demand by `jsonb_flatten`).
5. Admin delete is a **soft delete** (`deleted_at`). Records can't be saved while deleted, and admins can restore them. Nobody can hard-delete from the app.

## How to…

**Add a field.** Add it to the right block in `js/schema.js` with a new, unique key. Run `node tools/update.js`, check it in demo mode, run the checks, and commit `schema.js`, `schema.lock.json` and `data_dictionary.csv` together. Existing records show the field empty.

**Add a code to a list.** Edit `CODES.<LIST>` in `schema.js`, then run `node tools/update.js`. Removing a code is allowed but warned about: records using it get flagged in the form.

**Change a label, help text, hint or order.** Edit `schema.js`, then run `node tools/update.js` (the dictionary changes). Not breaking.

**Add a block or section.** Same as adding a field. A new section needs a unique `id` and `n`. Keep the order meaningful, since the section index numbers come from `n`.

**Drop or move a field, block or section.** Don't delete it. Put `hide:true` on it (and on the section if a whole tab goes), run `node tools/update.js`, and, for a move, add the new block in its new home with a new id (re-using the old field keys and `ua` names is fine). Hidden items leave the form, the checks, the tool's CSV export and the section index, but stay in `schema.lock.json`, in saved records and in the JSON export. They also still appear in the database view `record_fields`, so filter on the dictionary's `status` column when analysing. Existing values are **not** copied to the new location automatically; add a migration if real data needs it (this was skipped in October 2026 because only test records existed).

**Rename a field key (avoid if possible).** Run `node tools/update.js --allow-breaking`, and add a migration that moves the values, for example:

```sql
-- 20261201000000_rename_rating_to_enl_rating.sql
update public.records r
set data = jsonb_set(r.data, '{service,enl}', (
  select coalesce(jsonb_agg((row - 'rating') || jsonb_build_object('enl_rating', row -> 'rating')), '[]'::jsonb)
  from jsonb_array_elements(r.data #> '{service,enl}') row))
where r.data #> '{service,enl}' is not null;
```

This creates a new history version per record, with `updated_by` null because it runs as `postgres`. Say so in the commit message.

**Add a database function or view.** Write a new migration (`create or replace …`). Grant it to `authenticated` in the same file and revoke it from `anon` unless public. Use `security invoker` unless it must bypass RLS, as the history trigger does. Mirror the behaviour in `DemoBackend`, add assertions to `test/assertions.sql`, and add a backend method if the page needs it. Push the migration with, or before, the page code.

**Change a permission rule.** Write a new migration (`drop policy if exists …; create policy …`) and update `test/assertions.sql` only if the owner asked for the new behaviour. Mirror it in `DemoBackend`.

**Add a person or admin.** In the dashboard, go to Authentication → Users → Add user → *Auto Confirm*, then tick **Active** on the Team page. To make someone admin, use the Team page's Role menu (another admin), or run `update public.profiles set role='admin', active=true where email='…';` in the SQL editor.

**Reset a password.** In the dashboard, open Authentication → Users → the person, and set a new password (no email is sent, since there's no SMTP).

**Get the data for analysis.** Use `select * from record_fields` (long format) through a direct Postgres connection (session pooler string from Supabase **Connect**), or export from the tool (Records → Export all). Never commit exports.

**Upgrade supabase-js.** Change the pinned version in `index.html`, and test sign-in and save on the live project with a test record. The CI smoke test runs in demo mode and doesn't load the library.

## Checks and deployment

`deploy.yml` runs on every push to `main` and every pull request. Its summary page shows each check. If a check fails, nothing deploys; fix it with a new commit or `git revert`. The database job only runs when files in `supabase/migrations/` changed (or when run by hand with *Apply database migrations*). Versions are pinned: Node 20, Postgres 15 (tests), Supabase CLI 2.20.12, Playwright 1.47.2, supabase-js 2.45.4.

## Notes for AI agents working in this repo

- **When working on the owner's computer through Claude's remote tools:** writing files into `.github/` is blocked on purpose, because workflows can reach repository secrets. Write workflow files elsewhere (e.g. `github-workflows/`) and ask the owner to move them; don't work around the block. The shell there allows only a few commands (`git`, `python3`, `ls`, `cat`, `mkdir`, …), has no `cd` (use `git -C <path>`), mangles backslashes in inline code (write a script file instead), and **can't push** (no GitHub credentials). Commit, then ask the owner to `git push`.
- Use `supabase/.temp/` for throwaway scripts; it's ignored by git.
- **After copying files to the owner's computer, compare checksums of what landed against what was sent, before committing.** A transfer once silently delivered an older copy of a file (the backup key list), and the nightly backup failed because of it.
- Verify live behaviour with the publishable key only: the keep-alive ping, and signed-out requests that should be refused. Never sign in as a real person, and never create test records on the live project without deleting them.
- Before saying a change works, run the three checks. To test against real PostgREST locally, run PostgREST against a stubbed database (`test/supabase_stub.sql` + migrations) with a small auth stand-in. This was done during development, but that harness isn't kept in the repo.

## Backups

See `docs/BACKUPS.md`. The scripts name the app's tables explicitly (`profiles`, `records`, `record_versions`, `keepalive`). If a migration adds a table that holds data, add it to the `truncate` in `tools/restore.sh`, and to the checks in `tools/verify_backup.sh` if it matters. `public_data.sql` picks up new tables automatically. Test with a local backup → verify → restore cycle: `DB_URL=<scratch db> bash tools/backup.sh out && bash tools/verify_backup.sh out <scratch admin url>`.

## Hidden fields and what moved (October 2026)

Hidden fields (`hide:true`): File & tracking: Quality check block, Prize ID, # images, # surgeons certs, NARA file / box reference, scan folder (added 28 Oct). Sailor: the File type block, the old Application & certificate numbers block, the one-off "If immigrant" block (`immig`, replaced by the repeatable `immigs`; no data was migrated because none had been entered), Death contributing cause and its start date, illness length. Family: spouse officiator and best source. Image # fields everywhere (replaced by the Fold3 source URL). Hidden sections: In-service illness & injury (now Navy service), Affidavits (now the visible Depositions tab, section `deps`, with deponent name, rank and a File drop-down; no data was migrated because none had been entered), Enslavement (now Sailor), VA home survey. The Applications section is now numbered 5 and Depositions 6.

## Planned work

See `docs/LINKING_ROADMAP.md` for linking records to prize lists, muster rolls, census matches and other sources, and what that needs from the database.

## Open decisions

These are listed in the README and not yet settled: the Sailor ID format (add a format check once it is fixed); the image-numbering convention; whether to scan Surgeons' Certificates or only count them; double entry for reliability; whether to code ratings; and whether to add email invitations (needs SMTP, a Site URL and a "choose password" screen).

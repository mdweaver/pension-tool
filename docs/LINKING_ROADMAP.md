# Roadmap: linking records to other tables

**Status: planned, not built.** This page records what the project wants next and what each piece needs from the database and the tool, so changes made now don't paint us into a corner. Nothing here changes the live site.

## What we want to link to

| Table (new) | One row is | Comes from | Links to a pension record by |
|---|---|---|---|
| `sailors` | one sailor identified from Navy documents (one row per Sailor ID) | admin bulk load | `records.sailor_id` (`meta.file.sailor_id`) |
| `prizes` | one prize (ships, prize, total amount, dates) | admin bulk load | `record_prize_links` (below) |
| `prize_awards` | one payment of prize money: which sailor, which prize, how much | admin bulk load | `sailor_id` + `prize_id` |
| `muster_entries` | one muster-roll line (vessel, date, rating, sailor) | admin bulk load, or entered in the tool | `sailor_id`, and `prize_id` where known |
| `census_links` | a proposed match between a person in a record and a census record | script proposes, RAs confirm | person in the record (see "stable ids") |
| `external_links` | a find-a-grave, ancestry.com or other URL for a sailor, spouse or child | RAs | sailor or person in the record |

The pension record itself stays what it is: one JSON document per file, entered by RAs. The new tables are relational reference data around it.

## What the form already does for this

- **Prizes as reported** (`service.prizes`: capturing vessel, prize vessel, date of capture, payment received) are kept exactly as transcribed. A script will propose matches to the `prizes` table later; the transcription is never overwritten by a match. The old `meta.file.prize_id` box is retired for the same reason: the match belongs in a link table, not typed by hand.
- **Fold3 source URL on every row** (`src`), plus the Fold3 record URL on each application row, so a checker can open the exact page for any value.
- **Partial dates** are stored as `MM/DD/YYYY` with `-` for what the file doesn't give (`--/--/1863`, `04/--/1865`).
- **Addresses and countries** are separate fields on every place.
- **Application and certificate numbers, fiche numbers and the NARA record group** are on the File & tracking tab, one row per application.

## Changes we will need later

1. **Stable row ids.** Links point at rows (a prize row, a child, a spouse). Today rows are addressed by position (`family.children.2`), and *Sort by date* or deleting a row changes positions. Before building any link table, give every row in a repeatable block a permanent `_id` (e.g. `c8f3k2`) when it is created. Keys starting with `_` are already ignored by the change log, so this needs no schema change; old rows get ids the first time a record is opened and saved.
2. **Sailor ID rules.** Decide the format (still an open decision in the README) and whether one Sailor ID may have more than one record (a sailor's own file and his widow's file are separate pension files). Then add a `sailors` table and have the tool check the typed ID against it instead of accepting any text. A record should show the sailor's name from `sailors` next to the typed ID, so a typo is obvious.
3. **A generic link table** rather than one table per kind of link:

   ```
   links(id, left_type, left_id, right_type, right_id,
         link_kind,            -- prize | census | muster | findagrave | ...
         status,               -- proposed | confirmed | rejected
         method, score, evidence jsonb,
         created_by, created_at, reviewed_by, reviewed_at)
   ```

   A script writes `proposed` rows (with `created_by` null and `method = 'script'`); RAs confirm or reject. A review screen is just a queue of `proposed` rows, so the same screen works for prizes, census and muster links.
4. **Every new table follows the existing protections** (`CLAUDE.md` rules 3 to 5, 10, 11): a new migration; row-level security and explicit grants (revoke from `anon`); editor stamping and a version table written by trigger, not by the browser; admin-only delete; assertions in `test/assertions.sql`; a matching `DemoBackend`; and the table added by name to `tools/backup.sh`, `tools/verify_backup.sh` and `tools/restore.sh`. Reference tables are read-only for RAs; only admins (or the load script) write them. Link tables are writable by active RAs.
5. **Partial dates in the database.** Matching a capture date to a prize date needs ranges, not strings. Add a SQL function that turns a stored partial date into `date_min` and `date_max` (`--/--/1863` becomes 1863-01-01 to 1863-12-31), and use it in views. Storage in the records does not need to change.
6. **Names that match.** Vessel names, owners' names and sailor names need fuzzy matching. Supabase has `pg_trgm`; add a canonical `vessels` table with aliases so `USS MINNESOTA`, `MINNESOTA` and `U.S.S. MINNESOTA` resolve to one vessel. The form can then offer vessel suggestions from that table. The stored text stays as typed; a `vessel_id` is added next to it later.
7. **Matching scripts** run outside the browser, in a GitHub Action or locally against the session-pooler connection, never with keys in the repo (rule 6). They read `records`/`record_fields` and the reference tables and only insert `proposed` links.
8. **Views for analysis.** Extend `record_fields` with joins to confirmed links so R and Stata users get prize payments, census years and muster entries next to the transcribed values.
9. **Tool structure.** The review screens (candidate list, confirm/reject, side-by-side with the Fold3 page) will be the first part of the site that needs its own data fetching. Add them as new files loaded after `js/views.js`, with new backend methods in both `SupabaseBackend` and `DemoBackend`. Still no build step. If the site outgrows plain scripts, that is a separate decision to make with the owner.

## Open questions for the owners

- Can one sailor have several pension records, and should the tool prevent duplicates?
- Who may confirm a link: any RA, or only a second person (double entry for linking)?
- Does a rejected link stay on file (recommended, so the script does not propose it again)?
- Which fields of the reference tables should RAs see while entering (name, vessel, prize amount)?
- Are Fold3 URLs stable enough to keep as the only pointer to a page, or should the page number and a NARA identifier be recorded as well?

# Backups

The database is backed up every night by `.github/workflows/backup.yml`.

| What | Where | Kept |
|---|---|---|
| Each night's backup | **Actions → Nightly backup → (a run) → Artifacts** | 30 days |
| The most recent *good* backup | **Releases → `backup-latest`** → `pension-backup-latest.tar.gz.age` | Indefinitely (replaced only by a newer good one) |

A backup counts as "good", and replaces `backup-latest`, only if both of these hold:
1. It **restores cleanly** into a throwaway database, with counts and checksums matching the live database.
2. It shows **no sign of data loss** compared with the previous good backup. History never shrinks, records don't all vanish, and active records don't fall by more than 10%.

If either check fails, the run goes red (GitHub emails you) and the previous good backup stays in `backup-latest`. Each backup is encrypted for the people listed in `backup/recipients.txt`. The repo and release are public, so without a matching private key the files are unreadable.

Each backup contains:
- **`public_data.sql`:** every row of the app's tables (people, records, full history).
- **`auth_data.sql`:** the logins, including password hashes, so RAs keep their passwords after a restore.
- **`records.jsonl`, `record_versions.jsonl`, `profiles.jsonl`:** the same data in readable form, one JSON object per line.
- **`manifest.json`:** counts, checksums, the time taken, and the code version.
- **`SHA256SUMS`, `README.txt`.**

The table structure isn't in the backup; it comes from `supabase/migrations` at the code version in `manifest.json`.

## One-time setup

### 1. Make a backup key, for you and ideally John too

Each person who should be able to read the backups makes their own key pair, on their own computer:

```bash
sudo apt install age            # macOS: brew install age; Windows: see github.com/FiloSottile/age
age-keygen -o ~/pension-backup-key.txt
```

The output shows `Public key: age1...`. That line is safe to share and goes into the repo. The file `~/pension-backup-key.txt` holds the **private key** (`AGE-SECRET-KEY-1...`). Keep it safe:

- Store a copy in a password manager (as a secure note) or on an encrypted USB drive.
- **Never** commit it, email it, or put it in a shared folder.
- If every private key is lost, the backups can't be read by anyone. That's why two people should each have one.

### 2. Add the public keys to the repo

Add each `age1...` public key as its own line in `backup/recipients.txt`, then commit and push. New backups are then readable by each listed key. Older backups stay readable only by the keys that existed when they were made.

### 3. Give the workflow the database connection string

1. In Supabase, click **Connect** (top of the project dashboard) and choose the **Session pooler** connection string. It looks like `postgresql://postgres.<ref>:[YOUR-PASSWORD]@aws-…pooler.supabase.com:5432/postgres`. Replace `[YOUR-PASSWORD]` with the database password.
2. In GitHub, go to **Settings → Secrets and variables → Actions → New repository secret**, name it `SUPABASE_DB_URL`, and paste the string.

Use the *session pooler* string, not the "direct connection" one: GitHub's servers can't reach the direct address.

### 4. Run it once

Go to **Actions → Nightly backup → Run workflow**. When it's green, check that **Releases** shows `backup-latest` with today's date and counts in its notes. After that it runs every night at about 3 a.m. Vancouver time.

## Restoring

You need `age`, `psql` and `bash` on your computer (`sudo apt install age postgresql-client`), plus this repo checked out.

### Get and decrypt a backup

- The latest good one is on the **Releases → `backup-latest`** page; download `pension-backup-latest.tar.gz.age`.
- An older one (up to 30 days): go to **Actions → Nightly backup**, pick the night, and download the artifact. It arrives as a `.zip` containing the `.age` file.

```bash
mkdir restore
age -d -i ~/pension-backup-key.txt pension-backup-latest.tar.gz.age | tar -xz -C restore
cat restore/manifest.json          # when it was taken, and how many records
```

`restore/` is git-ignored. Delete it when you're done: it isn't encrypted.

### Just read the data (no restore)

```r
recs <- jsonlite::stream_in(file("restore/records.jsonl"))
hist <- jsonlite::stream_in(file("restore/record_versions.jsonl"))
```

### Put the data back into the existing project

Use this if records were wiped or damaged but the project and its logins still exist.

```bash
bash tools/restore.sh restore "postgresql://postgres.<ref>:<password>@<pooler-host>:5432/postgres"
```

The script shows what's in the backup and what's in the database now, then asks you to type `RESTORE`. It **replaces all app data** (people, records, history) with the backup's, then checks the counts and checksums. Anything saved after the backup was taken is lost, so check `manifest.json` first. Logins aren't touched.

To undo a mistake in one or a few records, you don't need a backup: use **Edit history → Load into editor** in the tool.

### Rebuild in a brand-new Supabase project

Use this if the project itself is lost.

1. Create a new project with the same settings (README, setup step 1). **Don't create any users yet.**
2. Point the repo at it: update the GitHub secrets `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`, `SUPABASE_DB_URL` (and the access token if it was limited to the old project). Then run **Actions → Check and deploy → Run workflow** with *Apply database migrations* ticked.
3. Restore the data **and the logins**:
   ```bash
   bash tools/restore.sh restore "<new project's session pooler string>" --with-auth
   ```
4. Put the new project's URL and publishable key in `config.js`, then commit and push. RAs sign in with their usual passwords.

## Practising

It's worth doing a restore drill once, before you need it. Do it against a spare free Supabase project, not the live one.

The workflow also proves every night that the backup restores into a stand-in database. That stand-in imitates Supabase's login tables, so the `--with-auth` path has only been tested against it, not against a real new Supabase project. A one-time drill there would settle it.

## If the nightly backup fails

Open the failed run. The step that failed tells you why:

- **Check setup:** the `SUPABASE_DB_URL` secret is missing, or `backup/recipients.txt` has no key.
- **Dump the database:** the connection string or password changed, or the project is paused (restore it in Supabase).
- **Test-restore:** the backup didn't restore cleanly. Don't ignore this one: the previous good backup is still in `backup-latest`.
- **Compare with the previous good backup:** a big drop in records or history. If it was deliberate (say, an admin deleted a batch of test records), run the workflow by hand with **allow shrink** ticked. If it wasn't, investigate before anything else, and don't run with allow shrink.

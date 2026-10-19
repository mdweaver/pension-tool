#!/usr/bin/env bash
# Dumps the live database into a folder (NOT encrypted; the workflow encrypts it right after).
# Used by .github/workflows/backup.yml. Needs PostgreSQL client tools at least as new as the server.
#   usage: DB_URL='postgresql://postgres.<ref>:<password>@<pooler-host>:5432/postgres' bash tools/backup.sh OUTDIR
#
# The folder gets:
#   public_data.sql   all rows of the app's tables (profiles, records, record_versions, keepalive)
#   auth_data.sql     the logins (auth.users, auth.identities, including password hashes)
#   records.jsonl     one line per record (readable without a database)
#   record_versions.jsonl, profiles.jsonl   the history and the people, likewise
#   manifest.json / manifest.env   counts and checksums used to verify the backup and catch data loss
#   SHA256SUMS, README.txt
# The table structure is not dumped: it comes from supabase/migrations at commit git_sha.
set -euo pipefail
OUT="${1:?give an output folder}"
: "${DB_URL:?set DB_URL to the database connection string}"
mkdir -p "$OUT"
export PGCONNECT_TIMEOUT=30
q() { psql "$DB_URL" -qAtX -v ON_ERROR_STOP=1 -c "$1"; }

pg_dump "$DB_URL" --data-only --schema=public --no-owner --no-privileges --file="$OUT/public_data.sql"
pg_dump "$DB_URL" --data-only --table=auth.users --table=auth.identities --no-owner --no-privileges --file="$OUT/auth_data.sql"

q "select row_to_json(r) from (select uid, sailor_id, sailor_name, status, version, created_by, created_at, updated_by, updated_at, deleted_at, deleted_by, data from public.records order by uid) r" > "$OUT/records.jsonl"
q "select row_to_json(v) from (select id, record_uid, version, action, edited_by, edited_at, data from public.record_versions order by id) v" > "$OUT/record_versions.jsonl"
q "select row_to_json(p) from (select id, email, display_name, role, active, created_at from public.profiles order by email) p" > "$OUT/profiles.jsonl"

RECORDS=$(q "select count(*) from public.records")
ACTIVE=$(q "select count(*) from public.records where deleted_at is null")
VERSIONS=$(q "select count(*) from public.record_versions")
PROFILES=$(q "select count(*) from public.profiles")
USERS=$(q "select count(*) from auth.users")
LAST_SAVE=$(q "select coalesce(max(edited_at)::text, '') from public.record_versions")
DATA_MD5=$(q "select coalesce(md5(string_agg(uid || ':' || version || ':' || data::text, '|' order by uid)), '') from public.records")
HIST_MD5=$(q "select coalesce(md5(string_agg(id || ':' || record_uid || ':' || version || ':' || coalesce(edited_by::text, '') || ':' || data::text, '|' order by id)), '') from public.record_versions")
SERVER=$(q "show server_version")
MIGRATIONS=""
if [ "$(q "select to_regclass('supabase_migrations.schema_migrations') is not null")" = "t" ]; then
  MIGRATIONS=$(q "select coalesce(string_agg(version, ' ' order by version), '') from supabase_migrations.schema_migrations")
fi
CREATED=$(date -u +%Y-%m-%dT%H:%M:%SZ)

cat > "$OUT/manifest.env" <<EOF
CREATED=$CREATED
RECORDS=$RECORDS
ACTIVE=$ACTIVE
VERSIONS=$VERSIONS
PROFILES=$PROFILES
USERS=$USERS
DATA_MD5=$DATA_MD5
HIST_MD5=$HIST_MD5
EOF
cat > "$OUT/manifest.json" <<EOF
{
  "created_at": "$CREATED",
  "git_sha": "${GITHUB_SHA:-local}",
  "server_version": "$SERVER",
  "records": $RECORDS,
  "records_active": $ACTIVE,
  "record_versions": $VERSIONS,
  "profiles": $PROFILES,
  "auth_users": $USERS,
  "last_save": "$LAST_SAVE",
  "data_md5": "$DATA_MD5",
  "history_md5": "$HIST_MD5",
  "migrations_applied": "$MIGRATIONS"
}
EOF
cat > "$OUT/README.txt" <<'EOF'
Sailor Pension Entry: database backup.
records.jsonl / record_versions.jsonl / profiles.jsonl can be read directly (one JSON object per line).
To restore into Supabase, see docs/BACKUPS.md in the repository (tools/restore.sh).
public_data.sql and auth_data.sql are data only; the tables come from supabase/migrations at git_sha in manifest.json.
EOF
(cd "$OUT" && sha256sum public_data.sql auth_data.sql records.jsonl record_versions.jsonl profiles.jsonl manifest.json > SHA256SUMS)
echo "Backup written to $OUT: $ACTIVE records ($RECORDS incl. deleted), $VERSIONS history entries, $PROFILES people, last save $LAST_SAVE"

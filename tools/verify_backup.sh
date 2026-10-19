#!/usr/bin/env bash
# Proves a backup folder can be restored: builds a throwaway database (Supabase stub + every
# migration), loads public_data.sql exactly as tools/restore.sh would, and checks that counts and
# checksums match the manifest. Never point it at the real project.
#   usage: bash tools/verify_backup.sh BACKUP_DIR "postgres://postgres:postgres@localhost:5432/postgres"
set -euo pipefail
DIR="${1:?backup folder}"; ADMIN_URL="${2:?scratch Postgres URL}"
cd "$(dirname "$0")/.."
export PGOPTIONS="-c client_min_messages=warning"
(cd "$DIR" && sha256sum --quiet -c SHA256SUMS)
# shellcheck disable=SC1090,SC1091
source "$DIR/manifest.env"
DB=pension_backup_verify
psql "$ADMIN_URL" -qX -c "drop database if exists $DB" -c "create database $DB" >/dev/null
URL="${ADMIN_URL%/*}/$DB"
psql "$URL" -qX -v ON_ERROR_STOP=1 -f test/supabase_stub.sql >/dev/null
for f in supabase/migrations/*.sql; do psql "$URL" -qX -v ON_ERROR_STOP=1 -f "$f" >/dev/null; done
psql "$URL" -qX -v ON_ERROR_STOP=1 --single-transaction -c "set session_replication_role = replica" -f "$DIR/public_data.sql" >/dev/null
q() { psql "$URL" -qAtX -v ON_ERROR_STOP=1 -c "$1"; }
fail=0
check() { if [ "$2" = "$3" ]; then echo "  ok   $1 ($2)"; else echo "  FAIL $1: backup says $2, restored copy has $3"; fail=1; fi; }
check "records" "$RECORDS" "$(q 'select count(*) from public.records')"
check "active records" "$ACTIVE" "$(q 'select count(*) from public.records where deleted_at is null')"
check "history entries" "$VERSIONS" "$(q 'select count(*) from public.record_versions')"
check "people" "$PROFILES" "$(q 'select count(*) from public.profiles')"
check "record data checksum" "$DATA_MD5" "$(q "select coalesce(md5(string_agg(uid || ':' || version || ':' || data::text, '|' order by uid)), '') from public.records")"
check "history checksum" "$HIST_MD5" "$(q "select coalesce(md5(string_agg(id || ':' || record_uid || ':' || version || ':' || coalesce(edited_by::text, '') || ':' || data::text, '|' order by id)), '') from public.record_versions")"
# the next save after a restore must not collide with restored history
NEXT=$(q "select nextval(pg_get_serial_sequence('public.record_versions', 'id'))")
MAXID=$(q "select coalesce(max(id), 0) from public.record_versions")
if [ "$NEXT" -gt "$MAXID" ]; then echo "  ok   history id counter restored ($NEXT > $MAXID)"; else echo "  FAIL history id counter ($NEXT <= $MAXID)"; fail=1; fi
psql "$ADMIN_URL" -qX -c "drop database $DB" >/dev/null
if [ $fail -ne 0 ]; then echo "Backup verification FAILED"; exit 1; fi
echo "Backup verified: it restores completely and matches the live database."

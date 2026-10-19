#!/usr/bin/env bash
# Restores a decrypted backup folder into a Supabase database. See docs/BACKUPS.md first.
#
#   bash tools/restore.sh BACKUP_DIR TARGET_DB_URL              # same project: replace the app's data
#   bash tools/restore.sh BACKUP_DIR TARGET_DB_URL --with-auth  # brand-new project: data AND logins
#
# Before running, the target must already have the tables: run the "Check and deploy" workflow
# against it (or the SQL files in supabase/migrations, in order).
# It REPLACES all rows in profiles, records, record_versions and keepalive with the backup's.
# It asks you to type the target's host name to confirm (or pass --yes).
set -euo pipefail
DIR="${1:?backup folder (decrypted)}"; URL="${2:?target database connection string}"; shift 2
WITH_AUTH=0; YES=0
for a in "$@"; do case "$a" in --with-auth) WITH_AUTH=1 ;; --yes) YES=1 ;; *) echo "unknown option $a"; exit 2 ;; esac; done
export PGOPTIONS="-c client_min_messages=warning"
q() { psql "$URL" -qAtX -v ON_ERROR_STOP=1 -c "$1"; }

(cd "$DIR" && sha256sum --quiet -c SHA256SUMS) || { echo "Backup files are damaged or incomplete (checksum mismatch). Stopping."; exit 1; }
# shellcheck disable=SC1090,SC1091
source "$DIR/manifest.env"
if [ "$(q "select to_regclass('public.record_versions') is not null")" != "t" ]; then
  echo "The target has no app tables yet. Run the migrations first (the 'Check and deploy' workflow, or supabase/migrations/*.sql in order)."; exit 1
fi
HOST=$(q "select coalesce(inet_server_addr()::text, 'local')")
TARGET_USERS=$(q "select count(*) from auth.users")
echo "Backup:  taken $CREATED: $ACTIVE records ($RECORDS incl. deleted), $VERSIONS history entries, $PROFILES people, $USERS logins"
echo "Target:  $(echo "$URL" | sed -E 's#://([^:]+):[^@]*@#://\1:***@#')"
echo "         now holds $(q 'select count(*) from public.records') records, $(q 'select count(*) from public.record_versions') history entries, $TARGET_USERS logins"
if [ $WITH_AUTH -eq 1 ] && [ "$TARGET_USERS" -gt 0 ]; then
  echo "--with-auth is for a brand-new project with no logins, but the target has $TARGET_USERS. Restore without --with-auth, or delete those users first."; exit 1
fi
if [ $WITH_AUTH -eq 0 ]; then
  IDS=$(grep -o '"id":"[0-9a-f-]*"' "$DIR/profiles.jsonl" | cut -d'"' -f4 | paste -sd, -)
  MISSING=0
  [ -n "$IDS" ] && MISSING=$(q "select count(*) from unnest(string_to_array('$IDS', ',')::uuid[]) i where i not in (select id from auth.users)")
  if [ "$MISSING" != "0" ]; then echo "Note: $MISSING person(s) in the backup have no login in the target. Their records and history restore fine, but they can't sign in until an admin creates their account again (or use --with-auth on a new project)."; fi
fi
if [ $YES -eq 0 ]; then
  read -r -p "This REPLACES the app data in the target. Type RESTORE to continue: " ans
  [ "$ans" = "RESTORE" ] || { echo "Cancelled."; exit 1; }
fi
ARGS=(-c "set session_replication_role = replica" -c "truncate public.record_versions, public.records, public.profiles, public.keepalive")
[ $WITH_AUTH -eq 1 ] && ARGS+=(-f "$DIR/auth_data.sql")
ARGS+=(-f "$DIR/public_data.sql")
psql "$URL" -qX -v ON_ERROR_STOP=1 --single-transaction "${ARGS[@]}" >/dev/null
echo "Restored. Checking:"
fail=0
check() { if [ "$2" = "$3" ]; then echo "  ok   $1 ($2)"; else echo "  FAIL $1: backup $2, now $3"; fail=1; fi; }
check "records" "$RECORDS" "$(q 'select count(*) from public.records')"
check "history entries" "$VERSIONS" "$(q 'select count(*) from public.record_versions')"
check "people" "$PROFILES" "$(q 'select count(*) from public.profiles')"
check "record data checksum" "$DATA_MD5" "$(q "select coalesce(md5(string_agg(uid || ':' || version || ':' || data::text, '|' order by uid)), '') from public.records")"
[ $WITH_AUTH -eq 1 ] && check "logins" "$USERS" "$(q 'select count(*) from auth.users')"
[ $fail -eq 0 ] && echo "Restore complete." || { echo "Restore finished with mismatches; see above."; exit 1; }

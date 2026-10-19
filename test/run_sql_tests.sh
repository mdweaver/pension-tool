#!/usr/bin/env bash
# Tests the database rules on a scratch Postgres server (15+), NEVER your Supabase project.
# For each of Supabase's two "Automatically expose new tables" settings it builds a throwaway
# database, imitates Supabase's auth schema and roles, applies every migration, and runs
# test/assertions.sql, which stops with "FAILED: ..." if any rule breaks.
#   usage: bash test/run_sql_tests.sh "postgres://postgres@localhost:5432/postgres" [--walkthrough]
# --walkthrough also prints test/run_tests.sql, a readable tour of the same rules.
set -euo pipefail
export PGOPTIONS="-c client_min_messages=warning"
ADMIN_URL="${1:?give a connection URL to a scratch Postgres server}"
cd "$(dirname "$0")/.."
for MODE in expose-off expose-on; do
  DB="pension_tool_test_${MODE//-/_}"
  psql "$ADMIN_URL" -qX -c "drop database if exists $DB" -c "create database $DB" >/dev/null
  URL="${ADMIN_URL%/*}/$DB"
  if [ "$MODE" = expose-off ]; then
    sed '/alter default privileges/d' test/supabase_stub.sql | psql "$URL" -qX -v ON_ERROR_STOP=1 >/dev/null
    psql "$URL" -qX -c "alter default privileges in schema public revoke execute on functions from public" >/dev/null
  else
    psql "$URL" -qX -v ON_ERROR_STOP=1 -f test/supabase_stub.sql >/dev/null
  fi
  for f in supabase/migrations/*.sql; do
    psql "$URL" -qX -v ON_ERROR_STOP=1 -f "$f" 2>&1 | { grep -v NOTICE || true; }
  done
  echo "== $MODE: 'Automatically expose new tables' ${MODE#expose-}"
  psql "$URL" -qX -v ON_ERROR_STOP=1 -f test/assertions.sql 2>&1 | sed -e 's/^psql:[^ ]* WARNING:  /  /' -e 's/^WARNING:  /  /'
  psql "$ADMIN_URL" -qX -c "drop database $DB" >/dev/null
done
if [ "${2:-}" = "--walkthrough" ]; then
  DB=pension_tool_walkthrough
  psql "$ADMIN_URL" -qX -c "drop database if exists $DB" -c "create database $DB" >/dev/null
  URL="${ADMIN_URL%/*}/$DB"
  psql "$URL" -qX -v ON_ERROR_STOP=1 -f test/supabase_stub.sql >/dev/null
  for f in supabase/migrations/*.sql; do psql "$URL" -qX -f "$f" >/dev/null 2>&1; done
  psql "$URL" -X -f test/run_tests.sql
fi

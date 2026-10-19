#!/usr/bin/env bash
# Runs the database tests against a scratch Postgres server (15+), NOT your Supabase project.
# It creates a throwaway database, imitates Supabase's auth schema and roles, applies the
# migrations, then runs test/run_tests.sql and prints what happens (errors in the output are
# the expected refusals; compare with the comments in run_tests.sql).
#   usage: test/run_sql_tests.sh "postgres://postgres@localhost:5432/postgres"
set -euo pipefail
ADMIN_URL="${1:?give a connection URL to a scratch Postgres server}"
DB=pension_tool_test
cd "$(dirname "$0")/.."
psql "$ADMIN_URL" -qc "drop database if exists $DB" -c "create database $DB"
TEST_URL="${ADMIN_URL%/*}/$DB"
psql "$TEST_URL" -q -v ON_ERROR_STOP=1 -f test/supabase_stub.sql
for f in supabase/migrations/*.sql; do psql "$TEST_URL" -q -v ON_ERROR_STOP=1 -f "$f" 2>&1 | grep -v NOTICE || true; done
psql "$TEST_URL" -X -f test/run_tests.sql

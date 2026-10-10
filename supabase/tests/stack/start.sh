#!/usr/bin/env bash
# Sobe o "mini Supabase" local: Postgres (já rodando) + PostgREST + gateway Deno.
# Requer: psql, postgrest e deno no PATH (ou POSTGREST_BIN / DENO_BIN).
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$DIR/../.."
DB="${E2E_DB:-gestor_e2e}"
PSQL="${PSQL:-psql -v ON_ERROR_STOP=1 -q}"
$PSQL -d postgres -c "drop database if exists $DB with (force)" -c "create database $DB"
$PSQL -d "$DB" -f "$ROOT/tests/bootstrap.sql"
for f in "$ROOT"/migrations/*.sql; do $PSQL -d "$DB" -f "$f"; done
$PSQL -d "$DB" -f "$DIR/setup.sql"

export PGRST_DB_URI="postgres://authenticator:authenticator@localhost:5432/$DB"
export PGRST_DB_SCHEMAS=public
export PGRST_DB_ANON_ROLE=anon
export PGRST_JWT_SECRET="${JWT_SECRET:-super-secret-jwt-token-with-at-least-32-characters}"
export PGRST_SERVER_PORT=3000
"${POSTGREST_BIN:-postgrest}" > "${LOG_DIR:-/tmp}/postgrest.log" 2>&1 &
echo $! > "${LOG_DIR:-/tmp}/postgrest.pid"
sleep 2
DATABASE_URL="${DATABASE_URL:-postgres://postgres:postgres@localhost:5432/$DB}" \
  "${DENO_BIN:-deno}" run -A "$DIR/gateway.ts" > "${LOG_DIR:-/tmp}/gateway.log" 2>&1 &
echo $! > "${LOG_DIR:-/tmp}/gateway.pid"
for i in $(seq 1 60); do curl -s localhost:54321/fake-fx >/dev/null && break; sleep 1; done
echo "mini Supabase pronto em http://localhost:54321"

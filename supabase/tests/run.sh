#!/usr/bin/env bash
# Recria um banco de teste, aplica bootstrap + migrações e roda os testes SQL.
# Uso: supabase/tests/run.sh   (precisa de psql e de um Postgres acessível; padrão: usuário postgres local)
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
PSQL="${PSQL:-psql -v ON_ERROR_STOP=1 -q}"
DB="${TEST_DB:-gestor_test}"
$PSQL -d postgres -c "drop database if exists $DB" -c "create database $DB"
$PSQL -d "$DB" -f "$DIR/bootstrap.sql"
for f in "$DIR"/../migrations/*.sql; do $PSQL -d "$DB" -f "$f"; done
for f in "$DIR"/*.test.sql; do echo "== $(basename "$f")"; $PSQL -d "$DB" -f "$f"; done
echo "OK: todos os testes SQL passaram"

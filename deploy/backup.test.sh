#!/bin/sh
# Backup and restore drill against a disposable Postgres container.
# Needs Docker. Run it in CI or on the server, never against live data:
#   sh deploy/backup.test.sh
# It starts its own throwaway compose project, creates x_test, inserts a row,
# backs up with deploy/backup.sh, restores into x_restore with
# deploy/restore.sh, checks the row, and checks that restoring into
# "storecentral" is refused. The project and its volume are removed on exit.
set -eu

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
work=$(mktemp -d)
export COMPOSE_FILE="$work/compose.yml"
export COMPOSE_PROJECT_NAME="storecentral-drill-$$"
export BACKUP_DB=x_test

cleanup() {
  docker compose -f "$COMPOSE_FILE" down -v >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

cat > "$COMPOSE_FILE" <<'YAML'
services:
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: drill-only-not-a-real-credential
      POSTGRES_DB: postgres
YAML

psql_in() {
  docker compose -f "$COMPOSE_FILE" exec -T postgres \
    sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -v ON_ERROR_STOP=1 -At -h 127.0.0.1 -U "$POSTGRES_USER" "$@"' sh "$@"
}

docker compose -f "$COMPOSE_FILE" up -d
i=0
until psql_in -d postgres -c "select 1" >/dev/null 2>&1; do
  i=$((i + 1))
  [ "$i" -le 30 ] || { echo "FAIL: postgres did not become ready" >&2; exit 1; }
  sleep 2
done

psql_in -d postgres -c "create database x_test"
psql_in -d x_test -c "create table t (v text); insert into t values ('drill-row')"

dump=$(sh "$here/backup.sh" "$work/out")
[ -s "$dump" ] || { echo "FAIL: dump is empty" >&2; exit 1; }

sh "$here/restore.sh" "$dump" x_restore
got=$(psql_in -d x_restore -c "select v from t")
[ "$got" = "drill-row" ] || { echo "FAIL: restored row missing" >&2; exit 1; }

if sh "$here/restore.sh" "$dump" storecentral >/dev/null 2>&1; then
  echo "FAIL: restore into storecentral was not refused" >&2
  exit 1
fi

echo "PASS: backup and restore drill"

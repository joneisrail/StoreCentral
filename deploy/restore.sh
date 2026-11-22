#!/bin/sh
# Restore a dump made by deploy/backup.sh into a NEW scratch database.
#
# Usage: deploy/restore.sh <dump-file> <target-database>
# The target name must end in _restore or _test, so this script can never
# overwrite the live database. The name is checked first, before any docker or
# database call. Nothing secret or connection-like is printed.
#
# Optional override: COMPOSE_FILE (default: deploy/docker-compose.yml).
set -eu

if [ "$#" -ne 2 ]; then
  echo "usage: deploy/restore.sh <dump-file> <target-database>" >&2
  exit 2
fi

dump=$1
target=$2

case "$target" in
  *_restore | *_test) ;;
  *)
    echo "refused: target database name must end in _restore or _test" >&2
    exit 2
    ;;
esac

# Plain identifier only, so the name is safe to use in SQL.
case "$target" in
  *[!a-z0-9_]* | [!a-z]*)
    echo "refused: target database name must be lowercase letters, digits and underscores" >&2
    exit 2
    ;;
esac

if [ ! -f "$dump" ]; then
  echo "dump file not found" >&2
  exit 1
fi

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
compose_file=${COMPOSE_FILE:-"$here/docker-compose.yml"}

docker compose -f "$compose_file" exec -T -e TARGET_DB="$target" postgres sh -c \
  'PGPASSWORD="$POSTGRES_PASSWORD" psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -U "$POSTGRES_USER" -d postgres -c "CREATE DATABASE \"$TARGET_DB\""' \
  >/dev/null

docker compose -f "$compose_file" exec -T -e TARGET_DB="$target" postgres sh -c \
  'PGPASSWORD="$POSTGRES_PASSWORD" pg_restore --no-owner --exit-on-error -h 127.0.0.1 -U "$POSTGRES_USER" -d "$TARGET_DB"' \
  < "$dump"

echo "restored into database $target"

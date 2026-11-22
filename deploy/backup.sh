#!/bin/sh
# Back up the compose Postgres database to a custom-format dump.
#
# Usage: deploy/backup.sh <output-dir>
# Prints only the path of the dump it wrote. Credentials are read from the
# postgres container's own environment; nothing secret touches the host
# command line or the output.
#
# Optional overrides (used by deploy/backup.test.sh):
#   COMPOSE_FILE  compose file to use (default: deploy/docker-compose.yml)
#   BACKUP_DB     database to dump (default: the container's POSTGRES_DB)
set -eu

if [ "$#" -ne 1 ] || [ -z "$1" ]; then
  echo "usage: deploy/backup.sh <output-dir>" >&2
  exit 2
fi

out_dir=$1
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
compose_file=${COMPOSE_FILE:-"$here/docker-compose.yml"}

mkdir -p "$out_dir"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
dump="$out_dir/storecentral-$stamp.dump"

if ! docker compose -f "$compose_file" exec -T -e BACKUP_DB="${BACKUP_DB:-}" postgres sh -c \
  'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump --format=custom -h 127.0.0.1 -U "$POSTGRES_USER" -d "${BACKUP_DB:-$POSTGRES_DB}"' \
  > "$dump"; then
  rm -f "$dump"
  echo "backup failed" >&2
  exit 1
fi

echo "$dump"

#!/usr/bin/env bash
# Mounted at /docker-entrypoint-initdb.d/10-init.sh. The postgres image runs it
# once, on first start with an empty data directory, as the postgres superuser.
# It exists because the image executes *.sql files without psql variables, and
# the role passwords must come from the environment, never from a literal.
set -euo pipefail

: "${MEDUSA_DB_PASSWORD:?MEDUSA_DB_PASSWORD is required}"
: "${SELLER_HUB_DB_PASSWORD:?SELLER_HUB_DB_PASSWORD is required}"

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v dbname="$POSTGRES_DB" \
  -v medusa_pw="$MEDUSA_DB_PASSWORD" \
  -v seller_hub_pw="$SELLER_HUB_DB_PASSWORD" \
  -f /opt/init/init.sql

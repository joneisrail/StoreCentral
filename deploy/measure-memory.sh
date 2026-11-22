#!/bin/sh
# Print resident memory (MB) per StoreCentral service. Read-only.
#
# Output columns: name, rss_mb_after_boot, rss_mb_after_smoke.
#
#   (default)  Reads `docker stats --no-stream` for the compose stack
#              (containers named storecentral-<service>-1).
#   --local    Reads the resident set (VmRSS) of the process listening on each
#              dev port (backend 9000, seller-hub 7005, storefront 8000,
#              pos 8001) via ss/lsof and /proc. Never reads command lines or
#              environment, never stops, starts or signals anything.
#   --smoke    Optional. Without it the script is a pure read and
#              rss_mb_after_smoke is the current value read a second time. With
#              it, exactly one GET is sent to each service URL (backend /health,
#              seller-hub /health, storefront /, pos /) between the two reads.
#
# A service that is not running prints "not running"; the script still exits 0.

LOCAL=0
SMOKE=0
for arg in "$@"; do
  case "$arg" in
    --local) LOCAL=1 ;;
    --smoke) SMOKE=1 ;;
    *) echo "usage: $0 [--local] [--smoke]" >&2; exit 2 ;;
  esac
done

SERVICES="backend:9000:http://localhost:9000/health
seller-hub:7005:http://localhost:7005/health
storefront:8000:http://localhost:8000/
pos:8001:http://localhost:8001/"

pid_for_port() {
  if command -v ss >/dev/null 2>&1; then
    ss -ltnpH "sport = :$1" 2>/dev/null | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' | head -n 1
  elif command -v lsof >/dev/null 2>&1; then
    lsof -t -iTCP:"$1" -sTCP:LISTEN 2>/dev/null | head -n 1
  fi
}

local_mb() {
  pid=$(pid_for_port "$1")
  [ -n "$pid" ] || return 1
  kb=$(sed -n 's/^VmRSS:[[:space:]]*\([0-9][0-9]*\) kB.*/\1/p' "/proc/$pid/status" 2>/dev/null)
  [ -n "$kb" ] || return 1
  echo $((kb / 1024))
}

docker_mb() {
  command -v docker >/dev/null 2>&1 || return 1
  usage=$(docker stats --no-stream --format '{{.Name}} {{.MemUsage}}' 2>/dev/null |
    awk -v n="storecentral-$1-" 'index($1, n) == 1 { print $2; exit }')
  [ -n "$usage" ] || return 1
  echo "$usage" | awk '
    /GiB$/ { sub(/GiB$/, ""); printf "%d\n", $0 * 1024; exit }
    /MiB$/ { sub(/MiB$/, ""); printf "%d\n", $0; exit }
    /KiB$/ { sub(/KiB$/, ""); printf "%d\n", $0 / 1024; exit }
    /B$/   { sub(/B$/, ""); printf "%d\n", $0 / 1048576; exit }'
}

read_mb() {
  if [ "$LOCAL" = 1 ]; then local_mb "$2"; else docker_mb "$1"; fi
}

printf '%-12s %-20s %s\n' name rss_mb_after_boot rss_mb_after_smoke
echo "$SERVICES" | while IFS=: read -r name port url; do
  first=$(read_mb "$name" "$port") || first=""
  if [ -z "$first" ]; then
    printf '%-12s %-20s %s\n' "$name" "not running" "not running"
    continue
  fi
  if [ "$SMOKE" = 1 ]; then
    if command -v curl >/dev/null 2>&1; then
      curl -s -o /dev/null --max-time 10 "$url" || true
    elif command -v wget >/dev/null 2>&1; then
      wget -q -O /dev/null -T 10 "$url" || true
    fi
  fi
  second=$(read_mb "$name" "$port") || second="$first"
  printf '%-12s %-20s %s\n' "$name" "$first" "$second"
done
exit 0

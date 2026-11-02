#!/usr/bin/env bash
# Blue/green deploy of MyDefense (ARCHITECTURE.md > Delivery). Runs on the VPS from the wefaber self-hosted runner.
#   deploy/mydefense.sh <sha>        build is already in the workspace; install into the idle slot, check it, switch nginx
#   deploy/mydefense.sh --rollback   switch back to the previous slot (no rebuild)
# The previous slot keeps running, so a rollback is a flip, not a rebuild.
set -euo pipefail

BASE=/home/hermes/apps/mydefense            # blue/ and green/ live here
STATE=/home/hermes/deploy/state/mydefense   # `active` holds the live slot name
SNIPPET=/etc/nginx/snippets/mydefense-active.conf
BUN=/opt/bun/bun
SYSTEMCTL="sudo -n /usr/bin/systemctl"
NGINX="sudo -n /usr/sbin/nginx"
DOMAIN="${MYDEFENSE_DOMAIN:-defense.eternum.lat}"
declare -A PORT=([blue]=5191 [green]=5192)

UNIT=/etc/systemd/system/mydefense@.service
ENV_FILE=/home/hermes/deploy/env/mydefense.env
DATA=/home/hermes/data/mydefense

log() { printf '[mydefense %s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }
other() { [[ "$1" == blue ]] && echo green || echo blue; }

wait_for() { # url, tries
  local url=$1 tries=${2:-30}
  for ((i = 1; i <= tries; i++)); do
    if [[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "$url" || true)" == 200 ]]; then return 0; fi
    sleep 1
  done
  return 1
}

point_nginx_at() { # slot
  local slot=$1
  printf 'set $mydefense_port %s;\n' "${PORT[$slot]}" | sudo -n /usr/bin/tee "$SNIPPET" >/dev/null
  $NGINX -t
  $SYSTEMCTL reload nginx
}

# Read-only check of the one-time VPS setup (deploy/README.md). Lists everything that is missing, then stops
# before the idle slot, the unit or nginx are touched.
preflight() { # slot
  local slot=$1 miss=() p
  for p in "$BASE" "$DATA" "$STATE"; do [[ -d $p && -w $p ]] || miss+=("2. directory missing or not writable: $p"); done
  [[ -r $ENV_FILE ]] || miss+=("3. env file missing or unreadable: $ENV_FILE")
  [[ -f $UNIT ]] || miss+=("4. systemd unit not installed: $UNIT (then: sudo systemctl daemon-reload)")
  [[ -f $SNIPPET ]] || miss+=("5. nginx snippet missing: $SNIPPET (initial: set \$mydefense_port 5191;)")
  # -R, not -r: sites-enabled/ entries are symlinks into sites-available, and grep -r does not follow a
  # symlink it meets while recursing. With -r this check fails on every vhost installed the house way.
  grep -Rqs mydefense-active.conf /etc/nginx/sites-enabled/ || miss+=("5. no enabled nginx vhost includes mydefense-active.conf (deploy/nginx/defense.eternum.lat.conf)")
  local cmds=(
    "/usr/bin/systemctl start mydefense@$slot" "/usr/bin/systemctl stop mydefense@$slot"
    "/usr/bin/systemctl status mydefense@$slot" "/usr/bin/systemctl reload nginx"
    "/usr/sbin/nginx -t" "/usr/bin/tee $SNIPPET")
  for p in "${cmds[@]}"; do
    # shellcheck disable=SC2086 # $p is a command line, split on purpose
    sudo -n -l $p >/dev/null 2>&1 || miss+=("6. sudoers does not allow, passwordless: sudo $p")
  done
  if ! /usr/bin/systemctl is-active --quiet "mydefense@$slot" 2>/dev/null && ss -ltnH "sport = :${PORT[$slot]}" 2>/dev/null | grep -q .; then
    miss+=("1. port ${PORT[$slot]} is taken by another process: ss -ltnp 'sport = :${PORT[$slot]}'")
  fi
  ((${#miss[@]} == 0)) && return 0
  log "preflight failed, the VPS setup is incomplete (step numbers are from deploy/README.md):"
  printf '  - %s\n' "${miss[@]}" >&2
  log "nothing was changed"
  return 1
}

# The seed only needs the database path. Read just that line: the env file holds secrets and is not sourced.
db_path() {
  local line
  line=$(grep -E '^MYDEFENSE_DB=' "$ENV_FILE" | tail -n1 || true)
  line=${line#MYDEFENSE_DB=}
  line=${line%\"}
  line=${line#\"}
  echo "${line:-$DATA/mydefense.db}"
}

# Which slot is live? The state file is the source of truth; on a host that has never deployed, read the port the
# enabled snippet points at. Assuming green blind is how a failed first deploy left Nginx proxying the idle slot: the
# health check fails, the script exits before switching, and the domain keeps 502-ing against the slot that crashed.
if [[ -s $STATE/active ]]; then
  ACTIVE=$(cat "$STATE/active")
else
  ACTIVE=green
  for s in blue green; do
    if grep -q "set \$mydefense_port ${PORT[$s]};" "$SNIPPET" 2>/dev/null; then ACTIVE=$s; fi
  done
fi
IDLE=$(other "$ACTIVE")

if [[ "${1:-}" == --rollback ]]; then
  log "rollback: $ACTIVE -> $IDLE"
  wait_for "http://127.0.0.1:${PORT[$IDLE]}/ready" 5 || { log "slot $IDLE is not answering, rollback aborted"; exit 1; }
  point_nginx_at "$IDLE"
  echo "$IDLE" >"$STATE/active"
  wait_for "https://$DOMAIN/ready" 10 && log "rollback ok, $IDLE is live"
  exit 0
fi

SHA=${1:?usage: mydefense.sh <sha> | --rollback}
[[ -d dist && -f server/index.ts ]] || { log "run from the repo root after 'bun run build'"; exit 1; }

preflight "$IDLE" || exit 1

log "deploying $SHA into $IDLE (live is $ACTIVE)"
$SYSTEMCTL stop "mydefense@$IDLE" 2>/dev/null || true
rm -rf "${BASE:?}/$IDLE"
mkdir -p "$BASE/$IDLE"
# src/lib is runtime code, not only UI: the server imports pure modules from it (server/ai/recap.ts imports
# ../../src/lib/simulacro.ts) and Bun resolves the .ts at startup. Leaving it out ships a slot that exits on boot,
# so the copy list has to cover everything server/ can reach, not just the folders that look like the server.
mkdir -p "$BASE/$IDLE/src"
cp -r dist server shared scripts seed package.json bun.lock tsconfig.json tsconfig.server.json "$BASE/$IDLE/"
# Separate, and into src/: `cp -r src/lib <dest>` copies the directory as <dest>/lib, and the import would miss.
cp -r src/lib "$BASE/$IDLE/src/"
( cd "$BASE/$IDLE" && $BUN install --frozen-lockfile --production )
echo "$SHA" >"$BASE/$IDLE/REVISION"

# Migrations and the (idempotent) Eternum seed run against the shared database before the slot starts. They are
# expand-only, so the live slot keeps working.
( cd "$BASE/$IDLE" && NODE_ENV=production MYDEFENSE_DB="$(db_path)" $BUN run scripts/seed.ts )

$SYSTEMCTL start "mydefense@$IDLE"
if ! wait_for "http://127.0.0.1:${PORT[$IDLE]}/ready" 30; then
  log "slot $IDLE never became ready; $ACTIVE stays live"
  $SYSTEMCTL status "mydefense@$IDLE" --no-pager -n 30 || true
  $SYSTEMCTL stop "mydefense@$IDLE" || true
  exit 1
fi

point_nginx_at "$IDLE"
echo "$IDLE" >"$STATE/active"

# The real thing: the public domain, not the slot.
if ! wait_for "https://$DOMAIN/ready" 15 || ! wait_for "https://$DOMAIN/" 5; then
  log "$DOMAIN failed after the switch, rolling back to $ACTIVE"
  point_nginx_at "$ACTIVE"
  echo "$ACTIVE" >"$STATE/active"
  exit 1
fi
log "ok: $SHA is live on $DOMAIN (slot $IDLE, previous $ACTIVE kept for rollback)"

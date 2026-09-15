#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../deploy/compose" && pwd)
PROJECT=pi-agent-split-e2e-$$
TMP=$(mktemp -d)
COMPOSE="docker compose --project-name $PROJECT --project-directory $TMP --file $TMP/docker-compose.yml"

cleanup() {
  $COMPOSE down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT

command -v docker >/dev/null
docker compose version >/dev/null
cp "$ROOT/docker-compose.yml" "$TMP/docker-compose.yml"
mkdir -p "$TMP/data/workspace" "$TMP/data/pi" "$TMP/secrets"
chown -R 1000:1000 "$TMP/data"
printf '%s\n' "compose-e2e-$PROJECT" >"$TMP/secrets/pi-agent-rpc-token"
chown 1000:1000 "$TMP/secrets/pi-agent-rpc-token"
chmod 0400 "$TMP/secrets/pi-agent-rpc-token"
node "$ROOT/check-secret.mjs" "$TMP/secrets/pi-agent-rpc-token"

PI_AGENT_WEB_PORT=0 $COMPOSE up -d agent
PI_AGENT_WEB_PORT=0 $COMPOSE up -d web
agent_id=$($COMPOSE ps -q agent)
web_id=$($COMPOSE ps -q web)
test -n "$agent_id"
test -n "$web_id"
test -z "$(docker port "$agent_id")"

port=$(docker port "$web_id" 30141/tcp | awk -F: 'NR==1 {print $NF}')
test -n "$port"
for _ in $(seq 1 60); do
  if curl --fail --silent "http://127.0.0.1:$port/api/health/ready" >/dev/null; then break; fi
  sleep 1
done
curl --fail --silent "http://127.0.0.1:$port/api/health/live" | grep -Fq '"status":"ok"'
curl --fail --silent "http://127.0.0.1:$port/api/health/ready" | grep -Fq '"status":"ok"'
curl --fail --silent "http://127.0.0.1:$port/api/agent/running" | grep -Fq '"runningSessionIds"'
curl --fail --silent "http://127.0.0.1:$port/api/sessions" >/dev/null

echo "Compose E2E verified"

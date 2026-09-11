#!/bin/sh
set -eu
WEB_IMAGE=${WEB_IMAGE:-pi-agent-web-handshake:0.1.0-dev}
AGENT_IMAGE=${AGENT_IMAGE:-pi-agent-rpc:0.1.0}
! docker image inspect pi-agent-web:0.1.0 >/dev/null 2>&1
docker image inspect "$WEB_IMAGE" --format '{{index .Config.Labels "io.pi-agent.release-ready"}}' | grep -Fx false
if docker run --rm "$WEB_IMAGE" >/tmp/pi-agent-web-no-secret.log 2>&1; then
  echo "Web started without its Secret" >&2
  exit 1
fi
grep -Fq 'Invalid RPC token file' /tmp/pi-agent-web-no-secret.log
root=$(mktemp -d /tmp/pi-agent-handshake.XXXXXX)
agent=pi-agent-handshake-agent-$$
web=pi-agent-handshake-web-$$
cleanup() { docker rm -f "$agent" "$web" >/dev/null 2>&1 || true; rm -rf "$root"; }
trap cleanup EXIT INT TERM
printf '%s\n' handshake-test-token > "$root/token"
chown 1000:1000 "$root/token"
chmod 0400 "$root/token"
docker run -d --name "$agent" -v "$root/token:/run/secrets/pi-agent-rpc-token:ro" "$AGENT_IMAGE" >/dev/null
agent_ip=$(docker inspect "$agent" --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}')
docker run -d --name "$web" -v "$root/token:/run/secrets/pi-agent-rpc-token:ro" -e "PI_AGENT_RPC_URL=http://$agent_ip:8080" "$WEB_IMAGE" >/dev/null
for container in "$agent" "$web"; do
  i=0
  while :; do
    status=$(docker inspect "$container" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}')
    [ "$status" = healthy ] && break
    [ "$status" = unhealthy ] && { docker logs "$container"; exit 1; }
    [ "$i" -lt 40 ] || exit 1
    i=$((i+1)); sleep 2
  done
done
web_ip=$(docker inspect "$web" --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}')
docker exec "$web" curl -fsS http://127.0.0.1:30141/api/health/live | grep -Fq '"status":"ok"'
docker exec "$web" curl -fsS http://127.0.0.1:30141/api/health/ready | grep -Fq '"status":"ok"'
printf 'HANDSHAKE_OK agent=%s web=%s\n' "$agent_ip" "$web_ip"

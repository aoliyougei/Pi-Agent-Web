#!/bin/sh
set -eu
IMAGE=${1:-pi-agent-web:0.1.0}
meta=$(docker image inspect "$IMAGE" --format '{{.Architecture}}/{{.Os}} {{.Config.User}} {{.Config.WorkingDir}} {{index .Config.Labels "io.pi-agent-web.version"}} {{index .Config.Labels "io.pi-agent-web.upstream-version"}} {{index .Config.Labels "io.pi-agent-contract.version"}} {{index .Config.Labels "io.pi-agent.release-ready"}}')
[ "$meta" = "amd64/linux 1000:1000 /opt/pi-agent-web 0.1.0 0.8.11 0.1.0 true" ]
docker image inspect "$IMAGE" --format '{{json .Config.ExposedPorts}}' | grep -Fq '30141/tcp'
docker image inspect "$IMAGE" --format '{{json .Config.Healthcheck}}' | grep -Fq 'pi-agent-web-healthcheck'
docker run --rm --entrypoint sh "$IMAGE" -lc '
  test -f /opt/pi-agent-web/server.js
  test -d /opt/pi-agent-web/.next/static
  test ! -e /app
  test ! -e /home/node/.pi
  test ! -e /run/secrets/pi-agent-rpc-token
  test ! -e /opt/pi-agent-web/packages/pi-web-agent-server
  test ! -e /opt/pi-agent-web/node_modules/@earendil-works
  test ! -e /opt/pi-agent-web/node_modules/@aoliyougei/pi-web-agent-server
  ! command -v pi >/dev/null
  ! command -v git >/dev/null
  ! command -v ssh >/dev/null
  ! command -v npm >/dev/null
  ! command -v npx >/dev/null
  ! command -v yarn >/dev/null
  ! command -v pnpm >/dev/null
  ! env | grep -Eq "(^|_)(TOKEN|API_KEY|SECRET)="
'
if docker run --rm "$IMAGE" >/tmp/pi-agent-web-no-secret.log 2>&1; then
  echo "Web started without its Secret" >&2
  exit 1
fi
grep -Fq 'Invalid RPC token file' /tmp/pi-agent-web-no-secret.log
printf '%s\n' "Pi Agent Web image verified"

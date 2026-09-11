#!/bin/sh
set -eu
node /opt/pi-agent-web/scripts/check-rpc-token.mjs
exec "$@"

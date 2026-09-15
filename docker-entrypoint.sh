#!/bin/sh
set -eu
node /opt/pi-agent-web/check-rpc-token.mjs
exec "$@"

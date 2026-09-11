#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$ROOT"
exec docker buildx build --platform linux/amd64 --load -f Dockerfile.handshake -t pi-agent-web-handshake:0.1.0-dev .

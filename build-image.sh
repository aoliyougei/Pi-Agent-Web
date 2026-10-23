#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$ROOT"
exec docker buildx build --platform linux/amd64 --load \
  --build-arg PROJECT_VERSION=0.2.7 \
  --build-arg WEB_VERSION=0.8.11 \
  --build-arg CONTRACT_VERSION=0.1.0 \
  -t pi-agent-web:0.2.7 .

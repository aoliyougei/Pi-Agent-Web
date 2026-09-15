# Docker Compose deployment

This stack exposes Pi Agent Web on host port `30141` and keeps Agent RPC on an internal Docker network. Only Agent RPC mounts `./data/workspace` at `/app` and `./data/pi` at `/home/node/.pi`.

## Setup

Run from this directory:

```sh
mkdir -p data/workspace data/pi secrets
chown -R 1000:1000 data
openssl rand -hex 32 >secrets/pi-agent-rpc-token
chown 1000:1000 secrets/pi-agent-rpc-token
chmod 0400 secrets/pi-agent-rpc-token
node check-secret.mjs
cp .env.example .env # optional: change the Web host port
```

The Secret must be a regular, non-symlink file owned by UID 1000, mode `0400`, non-empty, and no larger than 4096 bytes. It is ignored by Git. Do not put the token in `.env` or Compose environment values.

Start and inspect the stack with your Compose implementation:

```sh
docker compose up -d
docker compose ps
curl --fail http://127.0.0.1:${PI_AGENT_WEB_PORT:-30141}/api/health/ready
```

Stop only this stack with `docker compose down`. The bind-mounted `data/` directory is retained. Agent RPC has no host port; requests enter through Web only.

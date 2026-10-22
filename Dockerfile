# syntax=docker/dockerfile:1

FROM registry.aoliyougei.com/library/node:22-alpine AS builder
WORKDIR /build/web
COPY package.json package-lock.json ./
COPY packages/agent-contract/package.json packages/agent-contract/package.json
COPY packages/pi-web-agent-server/package.json packages/pi-web-agent-server/package.json
RUN npm ci --ignore-scripts
COPY . .
RUN npm --workspace @aoliyougei/pi-agent-contract run build && npm run build

FROM registry.aoliyougei.com/library/node:22-alpine AS runtime
ARG PROJECT_VERSION=0.2.5
ARG WEB_VERSION=0.8.11
ARG CONTRACT_VERSION=0.1.0
LABEL io.pi-agent-web.version="$PROJECT_VERSION" \
      io.pi-agent-web.upstream-version="$WEB_VERSION" \
      io.pi-agent-contract.version="$CONTRACT_VERSION" \
      io.pi-agent.release-ready="true"
ENV HOME=/home/node NODE_ENV=production HOSTNAME=0.0.0.0 PORT=30141 PI_WEB_HOSTNAME=0.0.0.0 PI_WEB_CONFIG_DIR=/var/lib/pi-agent-web/backends
RUN rm -rf /usr/local/lib/node_modules/npm \
      /usr/local/bin/npm /usr/local/bin/npx \
      /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/pnpm && \
    mkdir -p /opt/pi-agent-web /var/lib/pi-agent-web && chown 1000:1000 /opt/pi-agent-web /var/lib/pi-agent-web
WORKDIR /opt/pi-agent-web
COPY --from=builder --chown=1000:1000 /build/web/.next/standalone ./
COPY --from=builder --chown=1000:1000 /build/web/.next/static ./.next/static
COPY --from=builder --chown=1000:1000 /build/web/public ./public
COPY docker-entrypoint.sh pi-agent-web-healthcheck /usr/local/bin/
RUN chmod 0755 /usr/local/bin/docker-entrypoint.sh /usr/local/bin/pi-agent-web-healthcheck
USER 1000:1000
EXPOSE 30141
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD ["pi-agent-web-healthcheck"]
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]

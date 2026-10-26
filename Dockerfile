ARG NODE_IMAGE=node:24-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205
FROM ${NODE_IMAGE} AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY . .
RUN npm run build

FROM ${NODE_IMAGE} AS runtime
ARG APP_VERSION=development
ARG VCS_REF=unknown
LABEL org.opencontainers.image.source="https://github.com/chinmaykrishnroy/ludo" \
      org.opencontainers.image.title="Ludo Club" \
      org.opencontainers.image.description="Multiplayer and offline Ludo with configurable bots" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${VCS_REF}"
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DB_PATH=/data/ludo.sqlite BACKUP_DIR=/data/backups
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --ignore-scripts && mkdir /data && chown node:node /data
COPY LICENSE ./LICENSE
COPY --from=builder --chown=node:node /app/build ./build
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/scripts/restore.mjs /app/scripts/backup.mjs /app/scripts/moderate.mjs ./scripts/
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","build/server/index.js","--production"]

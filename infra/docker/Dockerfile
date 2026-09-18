# CRA Compliance OS — production image
#
# Multi-stage: native modules (better-sqlite3) are compiled in the builder and
# copied into a slim runtime that has no compilers in it.
#
#   docker build -f infra/docker/Dockerfile -t cra-compliance-os .
#   docker run -p 8787:8787 -v cra-data:/app/data \
#     -e APP_URL=https://cra.example.com -e SESSION_SECRET=... -e ENCRYPTION_KEY=... \
#     cra-compliance-os

FROM node:20-bookworm-slim AS builder

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependency layer first, so source edits do not invalidate `npm ci`.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci

COPY tsconfig.base.json ./
COPY drizzle ./drizzle
COPY apps ./apps
COPY action ./action

RUN npm run build \
  && npm prune --omit=dev

FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production

RUN apt-get update \
  && apt-get install -y --no-install-recommends sqlite3 ca-certificates tini \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/web/dist ./apps/web/dist
COPY --from=builder /app/drizzle ./drizzle

# The API resolves the built frontend at ../web/dist and the database at
# DATABASE_PATH, so it must run from the api workspace directory.
WORKDIR /app/apps/api

ENV DATABASE_PATH=/app/data/cra.db \
    STORAGE_DIR=/app/data/storage \
    RUN_WORKER_IN_PROCESS=false \
    PORT=8787 \
    HOST=0.0.0.0

VOLUME ["/app/data"]
EXPOSE 8787

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/index.js"]

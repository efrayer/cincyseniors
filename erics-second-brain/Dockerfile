# ── Stage 1: install deps + build the client ──────────────────────
FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci

COPY client/ client/
# BASE_PATH is baked into asset URLs at build time — keep it in sync
# with the runtime BASE_PATH env var.
ARG BASE_PATH=/erics_second_brain
ENV BASE_PATH=$BASE_PATH
RUN npm run build -w client

# ── Stage 2: lean runtime ──────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
COPY server/package.json server/
RUN npm ci --omit=dev -w esb-server && npm cache clean --force

COPY server/src server/src
COPY server/scripts server/scripts
COPY --from=build /app/client/dist client/dist

RUN mkdir -p /data && chown node:node /data
USER node
ENV DATA_DIR=/data PORT=3111
VOLUME /data
EXPOSE 3111

CMD ["node", "server/src/index.js"]

FROM node:22.22.0-bookworm-slim AS dependencies
WORKDIR /worker
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22.22.0-bookworm-slim
ENV NODE_ENV=production
WORKDIR /worker
RUN groupadd --system --gid 10001 worker \
  && useradd --system --uid 10001 --gid worker --home-dir /worker worker
COPY --from=dependencies --chown=worker:worker /worker/node_modules ./node_modules
COPY --chown=worker:worker package.json package-lock.json worker.mjs video.mjs corpus.mjs ./
USER worker
CMD ["node", "worker.mjs"]

# syntax=docker/dockerfile:1

# The published artefact is plain JavaScript, so dependencies and the TypeScript
# build run on the *build* platform and are reused for every target platform.
# Only the tiny runtime stage is emulated, which keeps multi-arch builds fast.
FROM --platform=$BUILDPLATFORM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM --platform=$BUILDPLATFORM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:24-alpine AS runtime
LABEL org.opencontainers.image.title="github-trending-bot" \
      org.opencontainers.image.description="Discord bot posting GitHub trending repositories (daily/weekly/monthly) to one or more channels" \
      org.opencontainers.image.source="https://github.com/tonyctalope/github-trending-bot" \
      org.opencontainers.image.licenses="MIT"

ENV NODE_ENV=production \
    DATA_DIR=/data \
    CONFIG_PATH=/config/config.yaml \
    HEALTH_PORT=8080 \
    TZ=UTC

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

# /data holds the subscriptions created from Discord, /config the optional
# declarative file. Both are owned by the unprivileged runtime user.
RUN mkdir -p /data /config && chown -R node:node /data /config
USER node
VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "const p=process.env.HEALTH_PORT||8080;fetch('http://127.0.0.1:'+p+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["node", "dist/index.js"]

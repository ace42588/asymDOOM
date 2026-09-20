# syntax=docker/dockerfile:1
# Host-only image for Coolify / GHCR. No Emscripten / no SPA.
# Web client is deployed separately to GitHub Pages.

FROM node:22-bookworm AS build
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends clang make python3 \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY contracts/package.json contracts/
COPY native/package.json native/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY contracts contracts
COPY native native
COPY server server
COPY assets/doom1.wad assets/doom1.wad
RUN CC=clang npm run build:native \
    && npm run build:contracts \
    && npm run build -w server \
    && npm prune --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8666
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl libstdc++6 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/contracts/package.json ./contracts/package.json
COPY --from=build /app/contracts/dist ./contracts/dist
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/settings.json ./server/settings.json
COPY --from=build /app/native/build/libasymdoom.so ./native/build/libasymdoom.so
COPY --from=build /app/assets/doom1.wad ./assets/doom1.wad
RUN chown -R node:node /app
USER node
EXPOSE 8666
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8666/health || exit 1
CMD ["node", "server/dist/index.js"]

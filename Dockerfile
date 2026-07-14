# syntax=docker/dockerfile:1.7
FROM node:22.18.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json biome.json ./
COPY src ./src
COPY sdk ./sdk
COPY scripts ./scripts
RUN npm run build && npm prune --omit=dev

FROM node:22.18.0-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN groupadd --system --gid 10001 libreward && useradd --system --uid 10001 --gid libreward --home /app libreward
COPY --from=build --chown=libreward:libreward /app/node_modules ./node_modules
COPY --from=build --chown=libreward:libreward /app/dist ./dist
COPY --chown=libreward:libreward package.json package-lock.json ./
COPY --chown=libreward:libreward migrations ./migrations
USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:8080/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "dist/src/server.js"]

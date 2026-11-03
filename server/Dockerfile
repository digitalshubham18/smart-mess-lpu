# Smart Mess API. Build from the repo root OR server/:  docker build -t smartmess-api server
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# better-sqlite3 ships prebuilt binaries for this image; the toolchain is only a fallback if one isn't available.
RUN npm ci --omit=dev || (apt-get update && apt-get install -y --no-install-recommends python3 make g++ && npm ci --omit=dev)

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=4000 \
    DB_PATH=/data/smartmess.sqlite \
    OUTBOX_DIR=/data/outbox \
    BACKUP_DIR=/data/backups
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY scripts ./scripts
# The database, outbox and backups live on a volume — never inside the container's own layer.
RUN mkdir -p /data && chown -R node:node /data /app
VOLUME /data
USER node
EXPOSE 4000
# NODE_ENV=production makes the server REFUSE to start without a real JWT_SECRET (32+ chars) and CORS_ORIGIN.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/index.js"]

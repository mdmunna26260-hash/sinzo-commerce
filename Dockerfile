# Production container (see docker-compose.yml for full stack with PostgreSQL)
FROM node:20-bookworm-slim AS deps
RUN apt-get update -qq && apt-get install -y -qq openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json* ./
# prisma schema needed for the postinstall `prisma generate` (use PROD schema: postgresql + correct binaryTargets)
COPY prisma ./prisma
RUN npm ci --ignore-scripts && npx prisma generate --schema prisma/schema.prod.prisma && npm rebuild sharp --foreground-scripts

FROM node:20-bookworm-slim AS builder
RUN apt-get update -qq && apt-get install -y -qq openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# cap Node heap so `next build` fits in small VPS RAM (2GB, no swap by default)
ENV NODE_OPTIONS=--max-old-space-size=614
# production build uses the PostgreSQL schema (same as `npm run build` script)
# Catalogue/admin routes render at request time. Do not pass live DB credentials
# as build arguments (they leak through image provenance/cache metadata).
# DATABASE_URL is supplied only to the running container.
# minimize build-time memory: no webpack cache, single worker
ENV WEBPACK_CACHE=false NEXT_PRIVATE_WORKER_THREADS=1
RUN npx prisma generate --schema prisma/schema.prod.prisma && npm run build

FROM node:20-bookworm-slim AS runner
RUN apt-get update -qq && apt-get install -y -qq openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/prisma ./prisma
# The entrypoint needs the schema safety net after runtime DATABASE_URL is set.
COPY --from=builder /app/scripts/ensure-db.js ./scripts/ensure-db.js
COPY --from=builder /app/scripts/abandoned-worker.js ./scripts/abandoned-worker.js
COPY --from=builder /app/next.config.mjs ./next.config.mjs
# entrypoint: runs prisma/migrate-from-neon.js first when MIGRATE_ON_BOOT is set in the panel, then the app
COPY --from=builder /app/docker-entrypoint.sh /usr/local/bin/sinzo-entrypoint.sh
RUN chmod +x /usr/local/bin/sinzo-entrypoint.sh
EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/sinzo-entrypoint.sh"]
# ensure DB columns on container start (runs before next start)
CMD ["npm", "run", "start"]

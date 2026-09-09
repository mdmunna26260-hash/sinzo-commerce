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
# DATABASE_URL build-arg: static pages prerender from the real DB (same as Vercel builds)
ARG DATABASE_URL
ENV DATABASE_URL=$DATABASE_URL
# minimize build-time memory: no webpack cache, single worker
ENV WEBPACK_CACHE=false NEXT_PRIVATE_WORKER_THREADS=1
RUN npx prisma generate --schema prisma/schema.prod.prisma && npm run build
# ensure DB columns exist before the app starts (needed for shared PG database)
RUN node scripts/ensure-db.js || echo "ensure-db: skipped (no DB access at build time)"

FROM node:20-bookworm-slim AS runner
RUN apt-get update -qq && apt-get install -y -qq openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/next.config.mjs ./next.config.mjs
EXPOSE 3000
# ensure DB columns on container start (runs before next start)
CMD ["sh", "-c", "node scripts/ensure-db.js || true && npm run start"]

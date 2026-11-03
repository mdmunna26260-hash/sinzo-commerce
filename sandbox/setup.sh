#!/usr/bin/env bash
# Sandbox bootstrap helper. Rebuilds everything the preview needs after a sandbox
# reset: deps, local PostgreSQL, schema, seed, .env.local, prisma wasm patch.
# Usage: bash sandbox/setup.sh
set -euo pipefail
cd "$(dirname "$0")/.."
REPO="$PWD"
SB=/home/user/sandbox-tools
mkdir -p "$SB"

echo "== [1/6] npm ci (ignore scripts — prisma engine download is blocked here)"
npm ci --ignore-scripts --no-audit --no-fund >/dev/null 2>&1 || npm ci --ignore-scripts --no-audit --no-fund
npm install --no-save --ignore-scripts --no-audit --no-fund pg@8.23.1 @prisma/adapter-pg@5.22.0 >/dev/null 2>&1

echo "== [2/6] prisma generate (prod/postgres schema, engines stubbed locally)"
export PRISMA_QUERY_ENGINE_LIBRARY="$SB/fake-engine" PRISMA_SCHEMA_ENGINE_BINARY="$SB/fake-engine" \
       PRISMA_QUERY_ENGINE_BINARY="$SB/fake-engine" PRISMA_FMT_BINARY="$SB/fake-engine" PRISMA_HIDE_UPDATE_MESSAGE=1
[ -f "$SB/fake-engine" ] || echo "not-a-real-engine" > "$SB/fake-engine"
npx prisma generate --schema prisma/schema.prod.prisma | tail -1
# Node 22 fix: default loader leaves engineWasm undefined → patch the generated client
node -e "
const fs=require('fs');
const f='node_modules/.prisma/client/index.js';
if (fs.existsSync(f)) {
  let s=fs.readFileSync(f,'utf8');
  if (s.includes('config.engineWasm = undefined') && !s.includes('__pgWasmPatched')) {
    s=s.replace(/config\.engineWasm = undefined[^\n]*/, 'config.engineWasm = undefined; try { config.engineWasm = { getRuntime: function(){ return require(\"./query_engine_bg.js\"); }, getQueryEngineWasmModule: async function(){ return new WebAssembly.Module(require(\"fs\").readFileSync(require(\"path\").join(__dirname,\"query_engine_bg.wasm\"))); } }; } catch (e) {} /* __pgWasmPatched */');
    fs.writeFileSync(f,s);
    console.log('   wasm engine patch applied');
  }
}
"

echo "== [3/6] local PostgreSQL 16 via pgserver (PyPI wheel)"
if [ ! -x "$SB/pg/lib/pgserver/pginstall/bin/postgres" ]; then
  pip3 install --quiet --target "$SB/pg/lib" "pgserver==0.1.4"
fi
export PATH="$SB/pg/lib/pgserver/pginstall/bin:$PATH"
if [ ! -d "$SB/pg/data/PG_VERSION" ]; then
  initdb -D "$SB/pg/data" -U postgres --auth=trust >/dev/null
fi
if ! pg_ctl -D "$SB/pg/data" status >/dev/null 2>&1; then
  pg_ctl -D "$SB/pg/data" -o "-h 127.0.0.1 -p 5433 -k $SB" -l "$SB/pg.log" start >/dev/null
  sleep 1
fi
createdb -h 127.0.0.1 -p 5433 -U postgres sinzo 2>/dev/null || true

echo "== [4/6] schema from prisma/schema.prod.prisma"
node sandbox/prisma-to-pg-ddl.cjs prisma/schema.prod.prisma > "$SB/schema.sql"
psql -h 127.0.0.1 -p 5433 -U postgres -d sinzo -v ON_ERROR_STOP=1 -q -f "$SB/schema.sql" >/dev/null 2>&1 || \
psql -h 127.0.0.1 -p 5433 -U postgres -d sinzo -v ON_ERROR_STOP=1 -q -f "$SB/schema.sql" >/dev/null

echo "== [5/6] .env.local (gitignored)"
cat > .env.local <<'EOF'
DATABASE_URL="postgresql://postgres@127.0.0.1:5433/sinzo?sslmode=disable"
DEPLOY_CHANNEL="vps"
SESSION_SECRET="sandbox-preview-local-secret-change-me"
NEXT_PUBLIC_SITE_URL="http://localhost:3000"
EOF

echo "== [6/6] seed (skip if products already exist)"
COUNT=$(psql -h 127.0.0.1 -p 5433 -U postgres -d sinzo -tAc "select count(*) from \"Product\"" 2>/dev/null || echo 0)
if [ "$COUNT" = "0" ]; then
  DATABASE_URL="postgresql://postgres@127.0.0.1:5433/sinzo?sslmode=disable" \
  NODE_OPTIONS="--require $REPO/sandbox/pg-adapter-preload.cjs" node prisma/seed.js | tail -2
else
  echo "seed skipped — $COUNT products already present"
fi
echo "SETUP DONE. Start dev server with:"
echo "  NODE_OPTIONS=\"--require $REPO/sandbox/pg-adapter-preload.cjs\" npm run dev"

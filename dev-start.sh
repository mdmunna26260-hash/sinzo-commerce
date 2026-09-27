#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
# Reinstall deps if node_modules got wiped
if [ ! -x node_modules/next/dist/bin/next ]; then
  echo "[dev-start] installing deps..."
  npm install --ignore-scripts --no-audit --no-fund
  npm install bcryptjs@2.4.3 jsonwebtoken@9.0.2 --no-save --no-audit --no-fund
fi
# Rebuild .prisma/client skeleton + in-memory stub
mkdir -p node_modules/.prisma/client/runtime
cp -r node_modules/prisma/prisma-client/* node_modules/.prisma/client/ 2>/dev/null || true
for f in default.js edge.js wasm.js index-browser.js extension.js; do
  echo 'module.exports = require("./index.js");' > node_modules/.prisma/client/$f
done
cat > node_modules/.prisma/client/schema.prisma <<EOF
generator client { provider = "prisma-client-js" }
datasource db { provider = "sqlite" url = env("DATABASE_URL") }
EOF
cp scripts/prisma-stub.js node_modules/.prisma/client/index.js
[ -f node_modules/@prisma/client/runtime/wasm.js ] && cp node_modules/@prisma/client/runtime/wasm.js node_modules/.prisma/client/runtime/
cp node_modules/@prisma/client/runtime/*.wasm node_modules/.prisma/client/runtime/ 2>/dev/null || true
# Force fresh Next.js compile
rm -rf .next
exec node node_modules/next/dist/bin/next dev -H 0.0.0.0 -p 3000

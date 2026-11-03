/* Sandbox preload: makes the generated Prisma client work on plain Node 22 without
   native engine binaries (binaries.prisma.sh is unreachable here).

   1. Patches node_modules/.prisma/client/index.js: the default loader sets
      `config.engineWasm = undefined` on Node 22 → replace that line with an
      engineWasm object whose getQueryEngineWasmModule compiles query_engine_bg.wasm
      from fs bytes (the loader expects engineWasm.getRuntime()/getQueryEngineWasmModule()).
   2. Wraps the `@prisma/client` root export so `new PrismaClient()` without options
      (as lib/db.ts does) still gets a PrismaPg adapter over DATABASE_URL. */
"use strict";
const fs = require("fs");
const path = require("path");
const Module = require("module");

/* --- 1. patch generated client --- */
try {
  const idx = path.join(__dirname, "..", "node_modules", ".prisma", "client", "index.js");
  if (fs.existsSync(idx)) {
    let s = fs.readFileSync(idx, "utf8");
    if (s.includes("config.engineWasm = undefined") && !s.includes("__pgWasmPatched")) {
      s = s.replace(
        /config\.engineWasm = undefined[^\n]*/,
        "config.engineWasm = undefined; try { config.engineWasm = { getRuntime: function(){ return require('./query_engine_bg.js'); }, getQueryEngineWasmModule: async function(){ return new WebAssembly.Module(require('fs').readFileSync(require('path').join(__dirname,'query_engine_bg.wasm'))); } }; } catch (e) { console.error('[pg-adapter-preload] wasm patch failed:', e.message); } /* __pgWasmPatched */"
      );
      fs.writeFileSync(idx, s);
    }
  }
} catch (e) {
  console.error("[pg-adapter-preload] index patch failed:", e.message);
}

/* --- 2. default adapter for `new PrismaClient()` --- */
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  const exp = origLoad.apply(this, arguments);
  if (request === "@prisma/client" && exp && exp.PrismaClient && !exp.__pgAdapterWrapped) {
    try {
      const { PrismaPg } = origLoad.call(this, "@prisma/adapter-pg", parent, isMain);
      const pg = origLoad.call(this, "pg", parent, isMain);
      const Orig = exp.PrismaClient;
      class PatchedClient extends Orig {
        constructor(opts) {
          const o = { ...(opts || {}) };
          if (!o.adapter) o.adapter = new PrismaPg(new pg.Pool({ connectionString: process.env.DATABASE_URL }));
          super(o);
        }
      }
      return Object.assign({}, exp, { PrismaClient: PatchedClient, __pgAdapterWrapped: true });
    } catch (e) {
      console.error("[pg-adapter-preload] adapter wrap failed:", e.message);
    }
  }
  return exp;
};

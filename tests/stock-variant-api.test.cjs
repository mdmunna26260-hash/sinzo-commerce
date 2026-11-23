const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./load-ts.cjs');
function api(options = {}) {
  const writes = [];
  const tx = {
    product: { updateMany: async () => ({ count: 1 }), findUnique: async () => ({ title: 'Test shirt', stock: options.productStock ?? 10 }), update: async data => { writes.push(['product', data]); } },
    productVariant: { findFirst: async ({ where }) => where.id === 9 && where.productId === 1 ? { stock: 3, size: 'M', color: 'Black' } : null, update: async data => { writes.push(['variant', data]); } },
    inventoryMovement: { create: async data => { writes.push(['ledger', data]); } },
  };
  const load = loader({ '@/lib/db': { db: { $transaction: async fn => fn(tx) } }, '@/lib/admin-guard': { requirePerm: async () => options.denied ? { res: Response.json({ error: 'Forbidden' }, { status: 403 }) } : { user: { email: 'owner@example.invalid' } } }, '@/lib/auth': { logAudit: async () => {} }, 'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } } });
  const route = load('app/api/admin/stock/route.ts');
  return { writes, post: patch => route.POST(new Request('http://local/api/admin/stock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId: 1, variantId: 9, mode: 'add', qty: 2, expectedStock: 3, expectedProductStock: options.productStock ?? 10, ...patch }) })) };
}
test('variant adjustment updates variant and product by the same delta and identifies variant in ledger', async () => {
  const ui = api(); const response = await ui.post({}); assert.equal(response.status, 200); const json = await response.json(); assert.equal(json.stock, 5); assert.equal(json.productStock, 12);
  assert.equal(ui.writes[0][1].data.stock, 12); assert.equal(ui.writes[1][1].data.stock, 5); assert.equal(ui.writes[2][1].data.delta, 2); assert.match(ui.writes[2][1].data.ref, /variant#9 M \/ Black/);
});
test('exact zero variant count updates product total rather than resetting it to the variant count', async () => {
  const ui = api(); const response = await ui.post({ mode: 'set', qty: 0 }); assert.equal(response.status, 200); const json = await response.json(); assert.equal(json.stock, 0); assert.equal(json.productStock, 7);
});
test('stale previews and wrong product/variant ownership are rejected without ledger/count writes', async () => {
  for (const [patch, status] of [[{ expectedStock: 2 }, 409], [{ expectedProductStock: 9 }, 409], [{ variantId: 10 }, 404]]) {
    const ui = api(); assert.equal((await ui.post(patch)).status, status); assert.deepEqual(ui.writes, []);
  }
});
test('variant reductions cannot underflow product total and unauthorized users cannot mutate stock', async () => {
  const underflow = api({ productStock: 1 }); assert.equal((await underflow.post({ mode: 'set', qty: 0 })).status, 400); assert.deepEqual(underflow.writes, []);
  const denied = api({ denied: true }); assert.equal((await denied.post({})).status, 403); assert.deepEqual(denied.writes, []);
});

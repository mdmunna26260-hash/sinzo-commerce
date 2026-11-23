const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./load-ts.cjs');
function api() {
  const saved = [];
  const load = loader({
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    'next/cache': { revalidatePath() {} },
    '@/lib/admin-guard': { requirePerm: async () => ({ user: { email: 'owner@example.invalid' } }) },
    '@/lib/auth': { logAudit: async () => {} },
    '@/lib/settings': { getSettings: async () => ({ store: { name: 'Existing' }, shipping: { outsideDhaka: 120 }, notifications: { smtp: { pass: 'fixture-password-value', port: 587 } } }), saveGroup: async (group, value) => { saved.push([group, value]); } },
  });
  const route = load('app/api/admin/settings/route.ts');
  return { saved, put: (group, value) => route.PUT(new Request('http://local/api/admin/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ group, value }) })) };
}
test('settings save returns its canonical normalized group without touching other sections', async () => {
  const ui = api(); const r = await ui.put('shipping', { insideDhaka: '80' }); assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).value, { insideDhaka: 80, outsideDhaka: 120 }); assert.equal(ui.saved.length, 1); assert.equal(ui.saved[0][0], 'shipping');
});
test('canonical settings save response masks stored secrets while preserving masked credentials', async () => {
  const ui = api(); const r = await ui.put('notifications', { smtp: { pass: '••••••', port: 465 } }); const body = await r.json();
  assert.equal(ui.saved[0][1].smtp.pass, 'fixture-password-value'); assert.equal(body.value.smtp.port, 465); assert.ok(body.value.smtp.pass.startsWith('••')); assert.ok(!JSON.stringify(body).includes('fixture-password-value'));
});
test('invalid shipping values do not persist or report a successful group', async () => {
  const ui = api(); assert.equal((await ui.put('shipping', { insideDhaka: -1 })).status, 400); assert.deepEqual(ui.saved, []);
});

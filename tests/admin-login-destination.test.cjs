const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./load-ts.cjs');
const { adminLoginDestination } = loader()('lib/admin-login-destination.ts');

test('preview keeps the verified token in its first navigation even if cookies appear available', async () => {
  let checked;
  const href = await adminLoginDestination('preview/token+value', async token => { checked = token; return true; });
  assert.equal(checked, 'preview/token+value');
  assert.equal(href, '/admin/dashboard?t=preview%2Ftoken%2Bvalue');
});
test('production without an API-issued token remains cookie-only', async () => {
  let checked = 'unset';
  const href = await adminLoginDestination(undefined, async token => { checked = token; return true; });
  assert.equal(checked, undefined);
  assert.equal(href, '/admin/dashboard');
});
test('a failed session probe shows an actionable error instead of a redirect loop', async () => {
  for (const token of [undefined, 'invalid-token']) {
    await assert.rejects(adminLoginDestination(token, async () => false), /Open the preview in a new tab/);
  }
});

test('preview identity probe uses the URL token rather than a proxy-sensitive Bearer header', () => {
  const { adminSessionProbeUrl } = loader()('lib/admin-login-destination.ts');
  assert.equal(adminSessionProbeUrl('preview+token/'), '/api/admin/whoami?t=preview%2Btoken%2F');
  assert.equal(adminSessionProbeUrl(), '/api/admin/whoami');
});
test('dev preview token is not shadowed by a gateway-injected Bearer header', () => {
  const { tokenFromRequest } = loader({ './db': { db: {} } })('lib/auth.ts');
  const req = new Request('http://test/api/admin/whoami?t=signed-preview-session', { headers: { Authorization: 'Bearer gateway-credential' } });
  assert.equal(tokenFromRequest(req), 'signed-preview-session');
});
test('production still prefers Bearer and does not enable query sessions by default', () => {
  const { tokenFromRequest } = loader({ './db': { db: {} } }, { NODE_ENV: 'production', SESSION_SECRET: 'unit-test-only-production-session-secret' })('lib/auth.ts');
  assert.equal(tokenFromRequest(new Request('https://store.test/api/admin/whoami?t=preview')), null);
  assert.equal(tokenFromRequest(new Request('https://store.test/api/admin/whoami?t=preview', { headers: { Authorization: 'Bearer application-session' } })), 'application-session');
});

test('invalid primary cookie does not shadow a valid fallback, but revocation still applies', async () => {
  let active = true;
  const current = { email: 'admin@example.test', name: 'Owner', role: 'SUPER_ADMIN', sessionVersion: 0 };
  const auth = loader({ './db': { db: { user: { findUnique: async () => ({ ...current, active }) } } } })('lib/auth.ts');
  const token = auth.createToken({ ...current, id: 1, sv: 0 });
  const req = new Request('http://test/api/admin/whoami', { headers: { cookie: `sz_session=expired; sz_session_fb=${token}` } });
  assert.equal((await auth.getSessionUser(req)).id, 1);
  active = false;
  assert.equal(await auth.getSessionUser(req), null);
});

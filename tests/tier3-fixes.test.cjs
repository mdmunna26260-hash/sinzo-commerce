/* Tier 3 fixes: order tabs are filtered in the query, and the fraud-check URL is allowlisted.
   Run with: npm run test:unit */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./load-ts.cjs');

const { orderTabWhere, tabCounts, readyToSendWhere, ORDER_TAB_STATUSES } = loader()('lib/admin-workflow.ts');

/* The orders list used to load a fixed window of the newest 200 rows and filter the tabs in
   the browser, so "Delivered" only meant "delivered among the newest 200". Tabs are now part
   of the query; this is the contract the orders page and the API both rely on. */
test('orderTabWhere maps every tab to a filter the database can run', () => {
  assert.deepEqual(orderTabWhere('ALL'), {});
  assert.deepEqual(orderTabWhere('DELIVERED'), { status: { in: ['DELIVERED'] } });
  assert.deepEqual(orderTabWhere('ACTIVE'), { status: { in: ['PROCESSING', 'PACKED', 'SHIPPED'] } });
  assert.deepEqual(orderTabWhere('CLOSED'), { status: { in: ['CANCELLED', 'RETURNED'] } });
  assert.deepEqual(orderTabWhere('READY'), readyToSendWhere());
  assert.deepEqual(orderTabWhere('PREORDER'), { items: { some: { preorder: true } } });
});

test('orderTabWhere never yields a filter that matches nothing', () => {
  // an unknown/legacy tab must fall back to the whole list, not to an empty page
  assert.deepEqual(orderTabWhere('NOPE'), {});
  assert.deepEqual(orderTabWhere(''), {});
  assert.deepEqual(orderTabWhere(undefined), {});
  for (const tab of Object.keys(ORDER_TAB_STATUSES)) {
    const where = orderTabWhere(tab);
    assert.ok(where && typeof where === 'object');
    assert.ok(!('status' in where) || (Array.isArray(where.status.in) && where.status.in.length > 0));
  }
});

test('tabCounts reports the server total per tab and keeps "All" honest', () => {
  const counts = tabCounts({ PENDING: 2, CONFIRMED: 5, PROCESSING: 1, PACKED: 1, SHIPPED: 3, DELIVERED: 40, CANCELLED: 2, RETURNED: 1, ON_HOLD: 1 }, 4, 7, 60);
  assert.equal(counts.ALL, 60, 'ALL is the total, not the sum of the mapped statuses');
  assert.equal(counts.PENDING, 2);
  assert.equal(counts.CONFIRMED, 5);
  assert.equal(counts.ACTIVE, 5, 'PROCESSING + PACKED + SHIPPED');
  assert.equal(counts.CLOSED, 3);
  assert.equal(counts.READY, 4);
  assert.equal(counts.PREORDER, 7);
});

test('tabCounts tolerates a status that belongs to no tab', () => {
  // a legacy status in the database must not silently vanish from the "All" badge
  const counts = tabCounts({ ARCHIVED: 9, PENDING: 1 }, 0, 0, 10);
  assert.equal(counts.ALL, 10);
  assert.equal(counts.PENDING, 1);
  assert.equal(counts.DELIVERED, 0);
});

/* ── fraudcheck ────────────────────────────────────────────────────────────────────── */
// lib/fraudcheck.ts imports ./settings, which pulls in @prisma/client. The URL guard is pure,
// so the settings lookup is stubbed out rather than needing a generated client.
const fraud = (env) => loader(
  { './settings': { getSettings: async () => ({}), envFallback: (s) => s } },
  { NODE_ENV: 'test', SESSION_SECRET: 'unit-test-only-session-secret', ...env },
)('lib/fraudcheck.ts');

test('fraud-check URL accepts only http(s) on an allowlisted host', () => {
  const { safeFraudApiUrl } = fraud({});
  assert.equal(safeFraudApiUrl('https://fraudbd.com/api/check-courier-info'), 'https://fraudbd.com/api/check-courier-info');
  assert.equal(safeFraudApiUrl('https://FRAUDBD.COM/api/x'), 'https://fraudbd.com/api/x');
  assert.equal(safeFraudApiUrl('https://app.fraudbd.com/api/x'), 'https://app.fraudbd.com/api/x');
});

test('fraud-check URL blocks SSRF targets and non-http schemes', () => {
  const { safeFraudApiUrl } = fraud({});
  // cloud metadata, localhost, private ranges and plain http off-loopback
  assert.equal(safeFraudApiUrl('http://169.254.169.254/latest/meta-data/'), null);
  assert.equal(safeFraudApiUrl('http://127.0.0.1:3000/admin'), null);
  assert.equal(safeFraudApiUrl('http://10.0.0.5/api/check-courier-info'), null);
  assert.equal(safeFraudApiUrl('http://fraudbd.com/api/check-courier-info'), null, 'plain http is refused even on an allowlisted host');
  // suffix trick: a subdomain-looking attacker host must not pass
  assert.equal(safeFraudApiUrl('https://fraudbd.com.evil.example/api'), null);
  assert.equal(safeFraudApiUrl('https://notfraudbd.com/api'), null);
  assert.equal(safeFraudApiUrl('https://evil.example/steal'), null);
  // scheme and junk
  assert.equal(safeFraudApiUrl('file:///etc/passwd'), null);
  assert.equal(safeFraudApiUrl('gopher://fraudbd.com/x'), null);
  assert.equal(safeFraudApiUrl('//fraudbd.com/x'), null);
  assert.equal(safeFraudApiUrl('not a url'), null);
  assert.equal(safeFraudApiUrl(''), null);
  assert.equal(safeFraudApiUrl('https://fraudbd.com/\u0000evil'), null, 'control characters are refused');
});

test('fraud-check URL allows an operator-listed partner host', () => {
  const { safeFraudApiUrl } = fraud({ FRAUD_API_ALLOWLIST: 'partner.example, https://other.example/api' });
  assert.equal(safeFraudApiUrl('https://partner.example/check'), 'https://partner.example/check');
  assert.equal(safeFraudApiUrl('https://api.partner.example/check'), 'https://api.partner.example/check');
  assert.equal(safeFraudApiUrl('https://other.example/check'), 'https://other.example/check');
  // the default host is still allowed, and unrelated hosts still are not
  assert.ok(safeFraudApiUrl('https://fraudbd.com/api/check-courier-info'));
  assert.equal(safeFraudApiUrl('https://evil.example/check'), null);
});

test('fraud-check URL keeps the default provider when the allowlist is blank or malformed', () => {
  const { safeFraudApiUrl } = fraud({ FRAUD_API_ALLOWLIST: '   ' });
  assert.ok(safeFraudApiUrl('https://fraudbd.com/api/check-courier-info'));
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./load-ts.cjs');

test('admin fetch keeps preview tokens internal and replaces existing query tokens safely', async () => {
  const before = { location: global.location, fetch: global.fetch };
  const calls = [];
  try {
    global.location = { search: '?t=private-preview-token' };
    global.fetch = async (...args) => { calls.push(args); return {}; };
    const { withToken, afetch } = loader()('lib/afetch.ts');
    assert.equal(withToken('/admin/orders?t=old#items'), '/admin/orders?t=private-preview-token#items');
    for (const url of ['https://outside.test/admin', '//outside.test/admin', '/\\outside.test/admin', '/api/administer', '/products']) {
      assert.equal(withToken(url), url);
      await afetch(url);
      assert.equal(calls.at(-1)[1].headers.has('Authorization'), false);
      assert.equal(calls.at(-1)[0], url);
    }
    await afetch('/api/admin/orders?t=old', { headers: { Authorization: 'Bearer proxy-sensitive', 'X-Test': 'keep' } });
    assert.equal(calls.at(-1)[0], '/api/admin/orders?t=private-preview-token');
    assert.equal(calls.at(-1)[1].headers.has('Authorization'), false);
    assert.equal(calls.at(-1)[1].headers.get('X-Test'), 'keep');
    assert.equal(calls.at(-1)[1].referrerPolicy, 'no-referrer');
    const prod = loader({}, { NODE_ENV: 'production' })('lib/afetch.ts');
    await prod.afetch('/api/admin/orders');
    assert.equal(calls.at(-1)[0], '/api/admin/orders');
    assert.equal(calls.at(-1)[1].headers.get('Authorization'), 'Bearer private-preview-token');
  } finally {
    for (const key of Object.keys(before)) {
      if (before[key] === undefined) delete global[key]; else global[key] = before[key];
    }
  }
});

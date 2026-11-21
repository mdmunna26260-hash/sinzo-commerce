const { test } = require('node:test');
const assert = require('node:assert/strict');
const { escapeHtml } = require('./load-ts.cjs').loader()('lib/escape-html.ts');
test('printable HTML encodes all markup delimiters from order text', () => {
  assert.equal(escapeHtml(`<img src=x onerror="alert('x')"> &`), '&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt; &amp;');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(2), '2');
});

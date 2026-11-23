const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { loader } = require('./load-ts.cjs');
const helpers = loader()('lib/product-editor.ts');
const productInput = loader()('lib/product-input.ts');
const product = { id: 7, title: 'Cotton shirt', slug: 'cotton-shirt', price: 100, stock: 5, lowStock: 0, status: 'ACTIVE', images: ['/shirt.png'], variants: [{ id: 9, size: 'M', color: 'Black', sku: 'M-B', stock: 3, price: null }], sku: 'SHIRT', barcode: '1234' };
function screen(options = {}) {
  let cursor = 0; const state = [], calls = [], confirmations = [];
  const mocks = {
    react: {
      useState(value) { const i = cursor++; if (!(i in state)) state[i] = typeof value === 'function' ? value() : value; return [state[i], v => { state[i] = typeof v === 'function' ? v(state[i]) : v; }]; },
      useRef(value) { const i = cursor++; if (!(i in state)) state[i] = { current: value }; return state[i]; },
      useEffect() {}, useMemo: fn => fn(),
    },
    'next/navigation': { useRouter: () => ({ refresh() {} }) },
    '@/lib/product-editor': helpers, '@/lib/product-input': productInput,
    '@/lib/afetch': { withToken: x => x, afetch: async (url, opts) => { if (!opts) return { json: async () => ({ groups: [] }) }; calls.push([url, opts]); if (options.request) return options.request(url, opts); throw Error('Offline'); } },
  };
  const module = { exports: {} };
  const compiled = ts.transpileModule(fs.readFileSync('app/admin/(panel)/products/client.tsx', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  new Function('require', 'module', 'exports', 'confirm', 'setTimeout', compiled)(id => mocks[id] || require(id), module, module.exports, text => { confirmations.push(text); return options.confirm !== false; }, () => {});
  const nodes = () => {
    cursor = 0; const result = [];
    const walk = n => { if (Array.isArray(n)) return n.forEach(walk); if (!n?.props) return; result.push(n); walk(n.props.children); };
    walk(module.exports.default({ initial: [product], categories: [], initialCreate: options.create !== false })); return result;
  };
  const find = fn => { const n = nodes().find(fn); assert.ok(n, 'Expected element'); return n; };
  return { nodes, calls, confirmations, find, change(id, value) { find(n => n.props.id === id).props.onChange({ target: { value } }); }, button(text) { return find(n => n.type === 'button' && n.props.children === text); } };
}
test('new products default to DRAFT and missing required fields do not send requests', async () => {
  const ui = screen(); assert.equal(ui.find(n => n.props.id === 'product-status').props.value, 'DRAFT');
  await ui.button('Save draft').props.onClick(); assert.equal(ui.calls.length, 0);
  assert.match(ui.find(n => n.props.className === 'product-editor-feedback').props.children, /Title/);
  ui.change('product-title', 'New shirt'); ui.change('product-price', '-1');
  await ui.button('Save draft').props.onClick(); assert.equal(ui.calls.length, 0);
});
test('failed draft save preserves edits and allows retry with the same data', async () => {
  const ui = screen(); ui.change('product-title', 'New shirt'); ui.change('product-price', '0');
  await ui.button('Save draft').props.onClick();
  assert.equal(ui.find(n => n.props.id === 'product-title').props.value, 'New shirt');
  assert.equal(ui.button('Save draft').props.disabled, false);
  const body = JSON.parse(ui.calls[0][1].body); assert.equal(body.status, 'DRAFT'); assert.equal(body.price, 0);
  assert.match(ui.find(n => n.props.className === 'product-editor-feedback').props.children, /edits are kept/);
  await ui.button('Save draft').props.onClick(); assert.equal(ui.calls.length, 2);
});
test('publishing and discarding dirty forms require confirmation', async () => {
  const ui = screen({ confirm: false }); ui.change('product-title', 'New shirt'); ui.change('product-price', '100');
  await ui.button('Publish product').props.onClick(); assert.equal(ui.calls.length, 0);
  ui.find(n => n.props['aria-label'] === 'Close product editor').props.onClick();
  assert.equal(ui.nodes().filter(n => n.props.role === 'dialog').length, 1);
  assert.match(ui.confirmations[0], /Publish/); assert.match(ui.confirmations[1], /Discard/);
});
test('save lock blocks repeated clicks and closing while a request is pending', async () => {
  let finish; const ui = screen({ request: () => new Promise(resolve => { finish = resolve; }) });
  ui.change('product-title', 'New shirt'); ui.change('product-price', '100');
  const button = ui.button('Save draft'); const saving = button.props.onClick(); await button.props.onClick();
  ui.find(n => n.props['aria-label'] === 'Close product editor').props.onClick();
  assert.equal(ui.calls.length, 1); assert.equal(ui.nodes().filter(n => n.props.role === 'dialog').length, 1);
  finish({ ok: true, json: async () => ({ ok: true }) }); await saving;
  assert.equal(ui.nodes().filter(n => n.props.role === 'dialog').length, 0);
});
test('partial multi-photo upload keeps successes and releases the save lock', async () => {
  let count = 0;
  const ui = screen({ request: async () => { if (++count === 2) throw Error('Offline'); return { ok: true, json: async () => ({ url: '/uploaded.png' }) }; } });
  await ui.find(n => n.type === 'input' && n.props.multiple).props.onChange({ target: { files: [new File(['a'], 'first.png'), new File(['b'], 'second.png')], value: 'files' } });
  // onChange delegates without awaiting; let the serial upload settle.
  for (let i = 0; i < 10; i++) await Promise.resolve();
  ui.find(n => n.type === 'img' && n.props.src === '/uploaded.png');
  assert.match(ui.find(n => n.props.className === 'product-editor-feedback').props.children, /failed: second.png/);
  assert.equal(ui.button('Save draft').props.disabled, false);
});
test('size presets preserve existing variant IDs and stock, add zero-stock missing sizes only', () => {
  const editor = { sku: 'SHIRT', variants: product.variants };
  const variants = helpers.appendSizePreset(editor, 'alpha');
  assert.equal(variants.length, 5); assert.deepEqual(variants[0], product.variants[0]);
  assert.ok(variants.slice(1).every(v => v.stock === '0' && v.price === '' && !v.id));
  assert.equal(helpers.appendSizePreset({ ...editor, variants }, 'alpha').length, 5);
});
test('bulk stock and variant removal require confirmation and preserve data on cancel', () => {
  const ui = screen({ create: false, confirm: false }); ui.button('Edit').props.onClick();
  ui.change('variant-bulk-stock', '8'); ui.button('Apply to all').props.onClick();
  assert.equal(ui.find(n => n.props['aria-label'] === 'Variant 1 stock').props.value, '3');
  ui.find(n => n.props['aria-label'] === 'Remove variant 1').props.onClick();
  ui.find(n => n.props['aria-label'] === 'Variant 1 stock'); assert.equal(ui.confirmations.length, 2);
});
test('saving a live product as draft confirms removal and preserves barcode/variant IDs', async () => {
  const ui = screen({ create: false }); ui.button('Edit').props.onClick(); await ui.button('Save draft').props.onClick();
  assert.match(ui.confirmations[0], /Remove this product from the live store/);
  const payload = JSON.parse(ui.calls[0][1].body); assert.equal(payload.barcode, '1234'); assert.equal(payload.variants[0].id, 9); assert.equal(payload.lowStock, 0);
});
test('duplicate opens the returned draft with copied photos and variants', async () => {
  const ui = screen({ create: false, request: async () => ({ ok: true, json: async () => ({ product: { ...product, id: 8, title: 'Cotton shirt Copy', status: 'DRAFT', stock: 0, images: [{ url: '/copy.png', position: 0 }], variants: [{ ...product.variants[0], id: 10, stock: 0 }] } }) }) });
  await ui.find(n => n.props['aria-label'] === 'Duplicate Cotton shirt').props.onClick();
  assert.equal(ui.find(n => n.props.id === 'product-title').props.value, 'Cotton shirt Copy');
  assert.equal(ui.find(n => n.props.id === 'product-stock').props.value, '0');
  ui.find(n => n.type === 'img' && n.props.src === '/copy.png');
});
test('incomplete combo tiers cannot be silently dropped on save', () => {
  assert.throws(() => helpers.productEditorPayload({ comboTiers: [{ qty: '2', total: '' }] }, 'DRAFT'), /Complete or remove/);
});

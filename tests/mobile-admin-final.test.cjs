const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { loader } = require('./load-ts.cjs');
const products = [{ id: 1, title: 'Cotton shirt', stock: 10, lowStock: 5, cost: 20, sku: 'SHIRT', variants: [{ id: 9, size: 'M', color: 'Black', sku: 'MB', stock: 3 }] }];
const groups = { store: { name: 'Sinzo' }, shipping: { insideDhaka: 60 }, theme: {}, homepage: {}, homeSections: [], notifications: {}, integrations: {}, maintenance: {}, checkout: {}, fraud: {}, courier: {}, policies: {}, seo: {} };
function screen(kind, options = {}) {
  let cursor = 0, refreshes = 0; const state = [], calls = [], confirmations = [];
  const mocks = {
    react: { useState(value) { const i = cursor++; if (!(i in state)) state[i] = typeof value === 'function' ? value() : value; return [state[i], v => { state[i] = typeof v === 'function' ? v(state[i]) : v; }]; }, useRef(value) { const i = cursor++; if (!(i in state)) state[i] = { current: value }; return state[i]; }, useEffect() {}, useMemo: fn => fn() },
    'next/navigation': { useRouter: () => ({ refresh() { refreshes++; } }) },
    '@/lib/stock-adjustment': loader()('lib/stock-adjustment.ts'), '@/lib/home-sections': loader()('lib/home-sections.ts'), '@/lib/home-hero': loader()('lib/home-hero.ts'),
    '@/lib/settings-workflow': loader()('lib/settings-workflow.ts'), '@/lib/settings-values': loader()('lib/settings-values.ts'),
    '@/lib/afetch': { withToken: x => x, afetch: async (url, opts) => { calls.push([url, opts]); if (options.request) return options.request(url, opts); throw Error('Offline'); } },
  };
  const module = { exports: {} };
  const compiled = ts.transpileModule(fs.readFileSync('app/admin/(panel)/' + (kind === 'stock' ? 'stock' : 'settings') + '/client.tsx', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  new Function('require', 'module', 'exports', 'confirm', compiled)(id => mocks[id] || require(id), module, module.exports, message => { confirmations.push(message); return options.confirm !== false; });
  const nodes = () => { cursor = 0; const result = []; const walk = n => { if (Array.isArray(n)) return n.forEach(walk); if (!n?.props) return; result.push(n); if (['SettingsField', 'SettingsImageField'].includes(n.type?.name)) walk(n.type(n.props)); else walk(n.props.children); }; walk(module.exports.default(kind === 'stock' ? { products } : { groups, user: { name: 'Owner' }, userCount: 1, hasCourier: false })); return result; };
  const find = fn => { const value = nodes().find(fn); assert.ok(value, 'Expected element'); return value; };
  return { nodes, calls, confirmations, refreshes: () => refreshes, find, change(id, value) { find(n => n.props.id === id).props.onChange({ target: { value } }); }, button(text) { return find(n => n.type === 'button' && n.props.children === text); } };
}
test('inventory searches variants by SKU and shows before/after including parent total', () => {
  const ui = screen('stock'); ui.change('inventory-search', 'MB');
  ui.find(n => n.props['aria-label'] === 'Adjust Cotton shirt M / Black').props.onClick();
  ui.change('stock-quantity', '4');
  const preview = ui.find(n => n.props.className === 'stock-preview full');
  assert.ok(JSON.stringify(preview.props.children).includes('Product total: '));
  assert.ok(JSON.stringify(preview.props.children).includes('14'));
});
test('stock save requires confirmation; cancellation never calls the API', async () => {
  const ui = screen('stock', { confirm: false }); ui.find(n => n.props['aria-label'] === 'Adjust Cotton shirt Product total').props.onClick(); ui.change('stock-quantity', '2');
  await ui.button('Review and save').props.onClick(); assert.equal(ui.calls.length, 0); assert.match(ui.confirmations[0], /10 -> 12/);
});
test('failed stock save retains inputs, releases locks, and sends optimistic preview counts', async () => {
  const ui = screen('stock'); ui.find(n => n.props['aria-label'] === 'Adjust Cotton shirt M / Black').props.onClick(); ui.change('stock-quantity', '2'); ui.change('stock-note', 'invoice-123');
  await ui.button('Review and save').props.onClick();
  assert.equal(ui.find(n => n.props.id === 'stock-quantity').props.value, '2'); assert.equal(ui.button('Review and save').props.disabled, false);
  const body = JSON.parse(ui.calls[0][1].body); assert.equal(body.variantId, 9); assert.equal(body.expectedStock, 3); assert.equal(body.expectedProductStock, 10);
  ui.find(n => n.props.role === 'alert');
});
test('stock mutation lock blocks repeat submissions and selection changes', async () => {
  let finish; const ui = screen('stock', { request: () => new Promise(resolve => { finish = resolve; }) });
  ui.find(n => n.props['aria-label'] === 'Adjust Cotton shirt M / Black').props.onClick(); ui.change('stock-quantity', '2');
  const button = ui.button('Review and save'); const save = button.props.onClick(); await button.props.onClick();
  ui.find(n => n.props['aria-label'] === 'Adjust Cotton shirt Product total').props.onClick(); assert.equal(ui.calls.length, 1);
  finish({ ok: true, json: async () => ({ ok: true, stock: 5, productStock: 12 }) }); await save;
  assert.equal(ui.find(n => n.props.id === 'stock-quantity').props.value, ''); assert.equal(ui.button('Review and save').props.disabled, true);
});
test('stale stock errors preserve draft and request new counts rather than silently overwrite', async () => {
  const ui = screen('stock', { request: async () => ({ ok: false, status: 409, json: async () => ({ error: 'Stock changed' }) }) });
  ui.find(n => n.props['aria-label'] === 'Adjust Cotton shirt Product total').props.onClick(); ui.change('stock-mode', 'set'); ui.change('stock-quantity', '0'); await ui.button('Review and save').props.onClick();
  assert.equal(ui.refreshes(), 1); assert.equal(ui.find(n => n.props.id === 'stock-quantity').props.value, '0');
});
test('settings drafts survive section switches; each save includes only its own group', async () => {
  const ui = screen('settings'); ui.change('setting-store-name', 'New name'); ui.change('settings-section', 'Shipping'); ui.change('setting-shipping-insideDhaka', '80');
  await ui.button('Save Shipping').props.onClick();
  assert.equal(JSON.parse(ui.calls[0][1].body).group, 'shipping');
  ui.change('settings-section', 'Store'); assert.equal(ui.find(n => n.props.id === 'setting-store-name').props.value, 'New name');
});
test('settings failed saves retain drafts and unlock; successful group save leaves other groups dirty', async () => {
  let success = false; const ui = screen('settings', { request: async () => { if (!success) throw Error('Offline'); return { ok: true, json: async () => ({ ok: true }) }; } });
  ui.change('setting-store-name', 'New name'); await ui.button('Save Store').props.onClick(); ui.find(n => n.props.role === 'alert');
  assert.equal(ui.find(n => n.props.id === 'setting-store-name').props.value, 'New name');
  ui.change('settings-section', 'Shipping'); ui.change('setting-shipping-insideDhaka', '80'); success = true; await ui.button('Save Shipping').props.onClick();
  const bar = ui.find(n => n.props.className === 'settings-savebar'); assert.ok(JSON.stringify(bar.props.children).includes('No unsaved changes'));
  ui.change('settings-section', 'Store'); assert.equal(ui.button('Save Store').props.disabled, false);
});
test('settings mutation lock blocks duplicate save requests', async () => {
  let finish; const ui = screen('settings', { request: () => new Promise(resolve => { finish = resolve; }) }); ui.change('setting-store-name', 'New name');
  const button = ui.button('Save Store'); const saving = button.props.onClick(); await button.props.onClick(); assert.equal(ui.calls.length, 1);
  finish({ ok: true, json: async () => ({ ok: true }) }); await saving; assert.equal(ui.button('Save Store').props.disabled, true);
});
test('homepage section drafts are parent-controlled and shared content groups are mapped to both sections', () => {
  const ui = screen('settings'); ui.change('settings-section', 'Homepage Layout');
  const layout = ui.find(n => n.type?.name === 'HomepageLayoutTab'); layout.props.onChange([{ id: 'hero', enabled: false }]);
  ui.change('settings-section', 'Store'); ui.change('settings-section', 'Homepage Layout');
  assert.deepEqual(ui.find(n => n.type?.name === 'HomepageLayoutTab').props.groups.homeSections, [{ id: 'hero', enabled: false }]);
  const { SETTINGS_SECTIONS } = loader()('lib/settings-workflow.ts'); assert.ok(SETTINGS_SECTIONS['Homepage Layout'].includes('homepage'));
});
test('financial and maintenance settings require explicit live-store confirmation', async () => {
  const ui = screen('settings', { confirm: false }); ui.change('settings-section', 'Shipping'); ui.change('setting-shipping-insideDhaka', '100'); await ui.button('Save Shipping').props.onClick(); assert.equal(ui.calls.length, 0); assert.match(ui.confirmations[0], /live store/);
});

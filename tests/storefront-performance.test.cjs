const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { loader } = require('./load-ts.cjs');
const images = loader()('components/img-src.ts');
const root = path.resolve(__dirname, '..');

// Render the image components' initial HTML without a browser or a new dependency.
function component(file, states) {
  let state = 0;
  const hooks = {
    ...React,
    useState: (initial) => [states ? states[state++] : initial, () => {}],
    useRef: () => ({ current: null }),
    useEffect: () => {},
  };
  const module = { exports: {} };
  const compiled = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    fileName: file,
  }).outputText;
  const localRequire = (id) => {
    if (id === 'react') return hooks;
    if (id === './img-src') return images;
    if (id === 'next/link') return ({ href, children, ...props }) => React.createElement('a', { ...props, href }, children);
    return require(id);
  };
  vm.runInThisContext('(function(require,module,exports){' + compiled + '\n})', { filename: file })(localRequire, module, module.exports);
  return module.exports.default;
}

const SmartImg = component('components/smart-img.tsx');
const imageHtml = (props) => renderToStaticMarkup(React.createElement(SmartImg, props));

test('priority hero is visible in server HTML and retains responsive high-priority loading', () => {
  const html = imageHtml({ src: '/api/media/banner?v=revision', alt: '', className: 'hero-img', priority: true });
  assert.match(html, /class="hero-img fade-img loaded"/);
  assert.match(html, /loading="eager"/);
  assert.match(html, /fetchPriority="high"/);
  assert.match(html, /\/api\/media\/banner\/w600v2\?v=revision 600w/);
  assert.match(html, /\/api\/media\/banner\/w1000v2\?v=revision 1000w/);
  assert.match(html, /sizes="100vw"/);
});

test('non-priority banners keep their lazy loading and decode fade', () => {
  const html = imageHtml({ src: '/api/media/banner', alt: 'Banner' });
  assert.match(html, /class="fade-img"/);
  assert.match(html, /loading="lazy"/);
  assert.doesNotMatch(html, /fetchPriority/);
});

test('SmartImg handles empty candidates and does not invent widths for existing assets', () => {
  const html = imageHtml({ src: '/uploads/seed/banner-600.webp', alt: '', widths: [] });
  assert.match(html, /src="\/uploads\/seed\/banner-600.webp"/);
  assert.doesNotMatch(html, /srcSet/);
  assert.equal(imageHtml({ alt: '' }), '');
});

test('recently viewed images use variant URLs with placement-specific sizes', () => {
  const Recent = component('components/recently-viewed-server.tsx', [[{
    id: 1, slug: 'shirt', title: 'Shirt', image: '/api/media/shirt?v=2', price: 1200,
  }], true]);
  const home = renderToStaticMarkup(React.createElement(Recent, { homepage: true }));
  assert.match(home, /\/api\/media\/shirt\/w300v2\?v=2/);
  assert.match(home, /w600v2\?v=2 600w/);
  assert.match(home, /sizes="\(max-width: 700px\) 142px, 170px"/);
  assert.match(home, /loading="lazy"/);
});

test('media srcsets retain cache-busting queries and external images stay unchanged', () => {
  assert.equal(images.imgSrcSet('/api/media/photo?v=updated', [200, 400]), '/api/media/photo/w200v2?v=updated 200w, /api/media/photo/w400v2?v=updated 400w');
  assert.equal(images.imgSrcSet('https://images.example/photo.jpg', [200, 400]), undefined);
  assert.equal(images.imgSrc('https://images.example/photo.jpg', 300), 'https://images.example/photo.jpg');
});

test('homepage shelves render one product tree, retaining mobile paging and desktop grid', () => {
  const page = fs.readFileSync(path.join(root, 'app/page.tsx'), 'utf8');
  const shelf = page.slice(page.indexOf('function ProductShelf('), page.indexOf('function CatTile('));
  assert.equal((shelf.match(/<ProductCard\b/g) || []).length, 1);
  assert.match(shelf, /className="grid grid-4 shelf-grid"/);
  assert.match(shelf, /className="shelf-carousel" desktopGrid/);
  const css = fs.readFileSync(path.join(root, 'app/globals.css'), 'utf8');
  assert.match(css, /\.shelf-carousel \.crs-page > \.grid \{ display: contents; \}/);
  const carousel = fs.readFileSync(path.join(root, 'components/home/carousel.tsx'), 'utf8');
  assert.match(carousel, /desktopGrid && window\.matchMedia\("\(min-width: 900px\)"\)\.matches/);
  assert.match(carousel, /setPages\(1\)/);
});

test('admin CSS is owned by the admin layout, not the storefront root layout', () => {
  const css = fs.readFileSync(path.join(root, 'app/globals.css'), 'utf8');
  const adminCss = fs.readFileSync(path.join(root, 'app/admin/admin.css'), 'utf8');
  assert.doesNotMatch(css, /\.admin-body\s*\{/);
  assert.match(adminCss, /\.admin-body\s*\{/);
  assert.match(adminCss, /\.order-card-note/);
  assert.match(fs.readFileSync(path.join(root, 'app/admin/layout.tsx'), 'utf8'), /import "\.\/admin\.css"/);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'app/layout.tsx'), 'utf8'), /admin\.css/);
  // Shared status pills must still style storefront account/order history.
  assert.match(css, /\.pill\.PENDING\s*\{/);
});

test('recommendations use one compact strip with responsive images and product links', () => {
  const Strip = component('components/related-strip.tsx');
  const html = renderToStaticMarkup(React.createElement(Strip, { items: [{
    id: 1, slug: 'shirt blue', title: 'Blue shirt', image: '/api/media/shirt?v=3', price: 1200,
  }, { id: 2, slug: 'jacket', title: 'Jacket', price: 2400 }] }));
  assert.match(html, /class="recent-strip related-strip"/);
  assert.match(html, /aria-label="Recommended products" tabindex="0"/);
  assert.match(html, /href="\/products\/shirt%20blue"/);
  assert.match(html, /w300v2\?v=3/);
  assert.match(html, /sizes="140px"/);
  assert.match(html, /loading="lazy"/);
  assert.equal((html.match(/class="recent-card"/g) || []).length, 2);
  assert.match(html, /1,200/);
  assert.doesNotMatch(html, /rel-page|desktop-only|pcard-cell/);
  assert.equal(renderToStaticMarkup(React.createElement(Strip, { items: [] })), '');
});

test('PDP recommendations retain their cap and do not duplicate a desktop grid', () => {
  const Strip = component('components/related-strip.tsx');
  const html = renderToStaticMarkup(React.createElement(Strip, { items: Array.from({ length: 45 }, (_, i) => ({
    id: i + 1, slug: 'item-' + i, title: 'Item ' + i, price: 100,
  })) }));
  assert.equal((html.match(/class="recent-card"/g) || []).length, 40);
  const page = fs.readFileSync(path.join(root, 'app/products/[slug]/page.tsx'), 'utf8');
  assert.match(page, /<RelatedStrip items=/);
  assert.doesNotMatch(page, /<RelatedCarousel|<ProductCard/);
});

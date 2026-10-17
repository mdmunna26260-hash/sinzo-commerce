const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./load-ts.cjs');
const load = loader();
const { MAX_HERO_SLIDES, sanitizeHeroSlides, buildHomeHeroSlides } = load('lib/home-hero.ts');
const { mergeHomeSections } = load('lib/home-sections.ts');

const slide = (id, patch = {}) => ({ id, title: `Slide ${id}`, image: `/uploads/${id}.jpg`, href: '/products', enabled: true, ...patch });

test('hero settings are bounded, use internal CTAs and reject unsafe image schemes', () => {
  const many = Array.from({ length: 8 }, (_, index) => slide(String(index + 1)));
  assert.equal(sanitizeHeroSlides(many).length, MAX_HERO_SLIDES);
  const cleaned = sanitizeHeroSlides([slide('safe', { href: 'https://attacker.example/phish', mobileImage: 'javascript:alert(1)' })]);
  assert.equal(cleaned[0].href, '/products');
  assert.equal(cleaned[0].mobileImage, '');
  assert.deepEqual(sanitizeHeroSlides([slide('bad', { image: 'javascript:alert(1)' })]), []);
});

test('manual hero slides win over automatic catalogue content', () => {
  const result = buildHomeHeroSlides({ heroSlides: [slide('manual')] }, [
    { id: 10, title: 'Catalogue piece', slug: 'catalogue-piece', image: '/uploads/product.jpg' },
  ]);
  assert.deepEqual(result.map((item) => item.id), ['manual']);
});

test('hybrid fallback preserves the legacy hero and fills from real featured products', () => {
  const result = buildHomeHeroSlides({
    heroImage: '/uploads/hero.jpg', heroTitle: 'Legacy headline', heroCta: 'Explore',
  }, [
    { id: 10, title: 'First piece', slug: 'first-piece', image: '/uploads/first.jpg', categoryName: 'Shirts' },
    { id: 11, title: 'Duplicate image', slug: 'duplicate', image: '/uploads/first.jpg' },
    { id: 12, title: 'Second piece', slug: 'second-piece', image: '/uploads/second.jpg' },
  ]);
  assert.deepEqual(result.map((item) => item.id), ['legacy-hero', 'catalog-10', 'catalog-12']);
  assert.equal(result[1].href, '/products/first-piece');
  assert.equal(result[1].eyebrow, 'Shirts');
});

test('new homepage sections are inserted in their intended positions without rearranging saved ones', () => {
  const old = ['hero', 'values', 'featured', 'categories', 'promo', 'bestsellers', 'testimonials']
    .map((id) => ({ id, enabled: true }));
  const ids = mergeHomeSections(old).map((section) => section.id);
  assert.ok(ids.indexOf('quicklinks') > ids.indexOf('values'));
  assert.ok(ids.indexOf('quicklinks') < ids.indexOf('featured'));
  assert.ok(ids.indexOf('discounts') > ids.indexOf('categories'));
  assert.ok(ids.indexOf('limited') > ids.indexOf('bestsellers'));
  assert.ok(ids.indexOf('recently') > ids.indexOf('limited'));
  assert.deepEqual(ids.filter((id) => old.some((section) => section.id === id)), old.map((section) => section.id));
});

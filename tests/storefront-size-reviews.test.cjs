const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./load-ts.cjs');
const load = loader();
const { makeReviewLoop } = load('lib/review-marquee.ts');
const { recommendSize, validateRecInput, estimateBody, detectGarmentType, classifySizeSystem, normAlpha, readSizeChart } = load('lib/size-rec.ts');
const suggest = (patch = {}) => {
  const sizes = patch.sizes || ['S', 'M', 'L', 'XL', '2XL', '3XL'];
  return recommendSize({ heightCm: 173, weightKg: 70, productTitle: 'Regular Shirt', sizes, stockMap: Object.fromEntries(sizes.map((s) => [s, 10])), ...patch });
};

test('review loop includes every review rather than a four-review slice', () => {
  const reviews = Array.from({ length: 12 }, (_, id) => ({ id }));
  assert.deepEqual(makeReviewLoop(reviews), reviews);
});
test('short review loops repeat complete sets with identical animation halves', () => {
  for (const reviews of [[1], [1, 2], [1, 2, 3]]) {
    const loop = makeReviewLoop(reviews);
    assert.ok(loop.length >= 4);
    assert.equal(loop.length % reviews.length, 0);
    assert.deepEqual(loop.slice(0, reviews.length), reviews);
    assert.deepEqual([...loop, ...loop].slice(0, loop.length), [...loop, ...loop].slice(loop.length));
  }
});
test('empty review data never produces fake or undefined cards', () => {
  assert.deepEqual(makeReviewLoop([]), []);
});

test('garment detection distinguishes wide-leg waist sizing from shirts', () => {
  assert.equal(detectGarmentType('WIDE LEG PANT', 'Bottoms'), 'wide-leg-pants');
  assert.equal(detectGarmentType('Wideleg trousers', 'Pants'), 'wide-leg-pants');
  assert.equal(detectGarmentType('Classic jeans', 'Bottoms'), 'pants');
  assert.equal(detectGarmentType('Regular Polo', 'T-Shirts'), 'shirt');
  assert.equal(detectGarmentType('Leather Tote', 'Accessories'), 'unknown');
});
test('numeric shirts use chest sizes while numeric pants use waist sizes', () => {
  const shirt = suggest({ sizes: ['38', '40', '42', '44'] });
  const pant = suggest({ productTitle: 'Wide-leg Pant', sizes: ['28', '30', '32', '34', '36'] });
  assert.equal(shirt.status, 'ok'); assert.equal(shirt.size, '40'); assert.equal(shirt.alphaSize, 'M');
  assert.equal(pant.status, 'ok'); assert.equal(pant.size, '32'); assert.equal(pant.alphaSize, 'M');
});
test('alpha shirts and pants return the appropriate numeric equivalent', () => {
  assert.equal(suggest().numericSize, '40');
  assert.equal(suggest({ productTitle: 'Wide-leg Pant' }).numericSize, '32');
});
test('a single configured numeric size is supported', () => {
  assert.equal(suggest({ productTitle: 'Wide-leg Pant', sizes: ['32'] }).size, '32');
});
test('height-adjusted weight distinguishes tall and short people of the same weight', () => {
  assert.ok(estimateBody(185, 75).waist < estimateBody(165, 75).waist);
  assert.ok(estimateBody(185, 75).chest < estimateBody(165, 75).chest);
});
test('decimal weights are continuous, without the old between-band dead zones', () => {
  for (const weightKg of [49.5, 59.5, 60.5, 70.5, 80.5]) {
    assert.notEqual(suggest({ heightCm: 170, weightKg, sizes: ['XXS', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL'] }).status, 'uncertain');
  }
});
test('size aliases and mixed numeric/letter variants preserve real product labels', () => {
  assert.equal(normAlpha('2XL'), 'XXL'); assert.equal(normAlpha('3XL'), 'XXXL');
  assert.equal(classifySizeSystem(['32']), 'numeric');
  assert.equal(classifySizeSystem(['40', 'M']), 'mixed');
  assert.equal(suggest({ heightCm: 170, weightKg: 99, sizes: ['XL', '2XL', '3XL'] }).size, '2XL');
  const result = suggest({ sizes: ['40', 'M', '42', 'L'], stockMap: { '40': 0, M: 5, '42': 10, L: 10 } });
  assert.equal(result.size, 'M'); assert.equal(result.numericSize, '40'); assert.equal(result.alphaSize, 'M');
  assert.deepEqual(result.matches, [{ size: '40', available: false }, { size: 'M', available: true }]);
});
test('combined product labels keep number and letter guides separate', () => {
  const result = suggest({ sizes: ['40 / M', '42(L)'] });
  assert.equal(result.size, '40 / M'); assert.equal(result.numericSize, '40'); assert.equal(result.alphaSize, 'M');
});
test('a suitable sold-out size is not replaced with a wrong-fit stocked size', () => {
  const result = suggest({ heightCm: 170, weightKg: 70, sizes: ['M', 'L', 'XL'], stockMap: { M: 5, L: 0, XL: 5 } });
  assert.equal(result.status, 'oos'); assert.equal(result.size, 'L');
});
test('actual product chart measurements take priority over generic alpha mappings', () => {
  const result = suggest({ sizes: ['S', 'M', 'L'], sizeChartHtml: '<table><tr><th>Size</th><th>Chest (inches)</th></tr><tr><td>S</td><td>40</td></tr><tr><td>M</td><td>44</td></tr><tr><td>L</td><td>48</td></tr></table>' });
  assert.equal(result.source, 'chart'); assert.equal(result.size, 'S'); assert.equal(result.numericSize, '40'); assert.equal(result.alphaSize, 'S');
});
test('chart parser supports CM, explicit flat width, ranges and row-header cells', () => {
  const chart = '<table><tr><th>Size</th><th>Half chest (cm)</th></tr><tr><th scope="row">M</th><td>50–51</td></tr></table>';
  const rows = readSizeChart(chart, 'shirt');
  assert.equal(rows.length, 1); assert.equal(rows[0].label, 'M');
  assert.ok(Math.abs(rows[0].dimension - 102 / 2.54) < 0.001);
  assert.equal(suggest({ sizes: ['M'], sizeChartHtml: chart }).size, 'M');
});
test('mixed numeric and alpha variants can match the same chart dimensions', () => {
  const result = suggest({ sizes: ['40', 'M'], sizeChartHtml: '<table><tr><th>Size</th><th>Chest</th></tr><tr><td>M</td><td>40"</td></tr></table>' });
  assert.equal(result.source, 'chart'); assert.deepEqual(result.matches.map((s) => s.size), ['40', 'M']);
});
test('wide-leg cut does not arbitrarily upsize a matching waist', () => {
  assert.equal(suggest({ productTitle: 'Regular Pant', sizes: ['30', '32', '34'] }).size, suggest({ productTitle: 'Loose Wide-leg Pant', sizes: ['30', '32', '34'] }).size);
});
test('oversized and slim shirt styles use different chest ease, not pant rules', () => {
  assert.notEqual(suggest({ productTitle: 'Oversized Shirt' }).size, suggest({ productTitle: 'Slim Shirt' }).size);
});
test('invalid/unsupported measurements and incompatible size runs never invent a size', () => {
  for (const heightCm of [NaN, Infinity, 90, 250]) assert.equal(suggest({ heightCm }).status, 'uncertain');
  assert.equal(suggest({ sizes: ['XXS'], weightKg: 150 }).status, 'uncertain');
  assert.equal(suggest({ productTitle: 'Leather Tote', sizes: ['ONE'] }).status, 'uncertain');
  assert.equal(suggest({ sizes: ['EU 42'] }).status, 'uncertain');
});
test('feet/inches and CM inputs represent the same height and preserve decimal weights', () => {
  const input = { unit: 'ft', ft: '5', inch: '7', cm: '', wt: '70.5' };
  const feet = validateRecInput(input), cm = validateRecInput({ ...input, unit: 'cm', cm: '170.2' });
  assert.equal(feet.heightCm, cm.heightCm); assert.equal(feet.weightKg, 70.5);
  assert.equal(suggest({ heightCm: feet.heightCm, weightKg: feet.weightKg }).size, suggest({ heightCm: cm.heightCm, weightKg: cm.weightKg }).size);
  assert.ok(validateRecInput({ ...input, inch: '12' }).errors.inches);
  assert.ok(validateRecInput({ ...input, ft: '5.5' }).errors.feet);
  assert.ok(validateRecInput({ ...input, wt: '-1' }).errors.weight);
  assert.equal(validateRecInput({ ...input, wt: '' }).incomplete, true);
});


test('body-measurement charts produce garment-number equivalents with shirt ease', () => {
  const result = suggest({ sizes: ['M'], sizeChartHtml: '<table><tr><th>Size</th><th>Body chest (inches)</th></tr><tr><td>M</td><td>38</td></tr></table>' });
  assert.equal(result.size, 'M'); assert.equal(result.numericSize, '40'); assert.equal(result.alphaSize, 'M');
});
test('explicit measurement units win and foreign numeric labels require a chart', () => {
  const rows = readSizeChart('<table><caption>Measurements in cm</caption><tr><th>Size</th><th>Chest</th></tr><tr><td>M</td><td>40&quot;</td></tr></table>', 'shirt');
  assert.equal(rows[0].dimension, 40);
  assert.equal(suggest({ sizes: ['EU42'] }).status, 'uncertain');
  assert.equal(suggest({ sizes: ['EU42'], sizeChartHtml: '<table><tr><th>Size</th><th>Chest</th></tr><tr><td>EU42</td><td>40"</td></tr></table>' }).size, 'EU42');
});


test('CM chart rounding still links equivalent numeric and alphabet stock choices', () => {
  const result = suggest({ sizes: ['40', 'M'], stockMap: { '40': 5, M: 0 }, sizeChartHtml: '<table><tr><th>Size</th><th>Chest (cm)</th></tr><tr><td>M</td><td>102</td></tr></table>' });
  assert.equal(result.source, 'chart'); assert.equal(result.size, '40'); assert.equal(result.status, 'ok');
  assert.deepEqual(result.matches, [{ size: '40', available: true }, { size: 'M', available: false }]);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');

test('all bundled product originals and responsive variants have the PDP 4:5 ratio', async () => {
  const dir = path.join(__dirname, '../public/uploads/seed');
  const files = (await fs.readdir(dir)).filter(name => /^p-.*\.(jpg|webp)$/.test(name));
  assert.ok(files.length > 0, 'product assets must exist');
  for (const name of files) {
    const { width, height } = await sharp(path.join(dir, name)).metadata();
    assert.equal(width * 5, height * 4, `${name} must be exactly 4:5`);
  }
  for (const original of files.filter(name => name.endsWith('.jpg'))) {
    const stem = original.slice(0, -4);
    for (const width of [200, 300, 400, 600, 800, 1000, 1200, 1600, 2000]) {
      assert.ok(files.includes(`${stem}-${width}.webp`), `${stem} missing responsive width ${width}`);
    }
  }
});

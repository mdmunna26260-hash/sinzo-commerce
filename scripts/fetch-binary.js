// Fetches binary via the __SCRIPTS fetch proxy? No — we don't have access to agent's fetch.
// We try Node with http_proxy via process.env.HTTP_PROXY if available.

// Approach: Read response chunk by chunk, decode into latin1 (bytes preserved as chars).
import https from 'https';
import fs from 'fs';
import zlib from 'zlib';

const url = process.argv[2];
const out = process.argv[3];
if (!url || !out) { console.error('usage: fetch-binary <url> <out>'); process.exit(1); }

const options = new URL(url);
options.headers = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  'Accept': '*/*',
  'Accept-Encoding': 'identity',
  'Connection': 'close',
};
options.agent = new https.Agent({ keepAlive: false, maxVersion: 'TLSv1.3' });

const req = https.get(options, (res) => {
  console.log('status', res.statusCode, 'headers', res.headers['content-length'], res.headers['content-encoding']);
  if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
    console.log('redirect to', res.headers.location);
  }
  const stream = fs.createWriteStream(out);
  if (res.headers['content-encoding'] === 'gzip') {
    res.pipe(zlib.createGunzip()).pipe(stream);
  } else {
    res.pipe(stream);
  }
  stream.on('finish', () => {
    console.log('wrote', out, fs.statSync(out).size, 'bytes');
  });
});
req.on('error', (e) => { console.error('error', e.message); process.exit(2); });
req.setTimeout(15000, () => { req.destroy(new Error('timeout')); });

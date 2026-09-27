// Tiny local HTTP proxy that fetches URLs using Node's built-in globalThis.fetch
// which in Node 22 uses undici and may have slightly different TLS behavior.
import http from 'http';
import { URL } from 'url';

const PORT = process.env.PROXY_PORT || 9999;

const server = http.createServer(async (req, res) => {
  try {
    const target = new URL(req.url, 'http://localhost/');
    const realUrl = target.searchParams.get('url');
    if (!realUrl) {
      res.writeHead(400);
      res.end('missing ?url=');
      return;
    }
    console.log('[proxy]', realUrl);
    const r = await fetch(realUrl, { redirect: 'follow' });
    res.writeHead(r.status, Object.fromEntries(r.headers.entries()));
    if (r.body) {
      for await (const chunk of r.body) {
        res.write(chunk);
      }
    }
    res.end();
  } catch (e) {
    console.error('[proxy err]', e);
    res.writeHead(500);
    res.end(String(e && e.stack || e));
  }
});
server.listen(PORT, '127.0.0.1', () => console.log('proxy on', PORT));

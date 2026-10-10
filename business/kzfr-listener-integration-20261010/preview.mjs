// Local-only preview. Does not proxy, scrape, stream, embed or call providers.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/handoff.mjs', ['handoff.mjs', 'text/javascript; charset=utf-8']],
  ['/programs.json', ['programs.json', 'application/json; charset=utf-8']]
]);
const port = Number(process.env.PORT || 8787);
createServer(async (req, res) => {
  const entry = files.get((req.url || '').split('?')[0]);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'");
  if (!entry || req.method !== 'GET') { res.writeHead(404); res.end('Not found'); return; }
  try {
    const content = await readFile(new URL('./' + entry[0], import.meta.url));
    res.writeHead(200, { 'Content-Type': entry[1] }); res.end(content);
  } catch { res.writeHead(500); res.end('Preview unavailable'); }
}).listen(port, '127.0.0.1', () => console.log(`KZFR local preview: http://127.0.0.1:${port}/`));

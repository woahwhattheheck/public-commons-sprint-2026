// MIT. Fixed, read-only static assets for the browser capacity planner.
import { readFile } from 'node:fs/promises';
const assets = new Map([
 ['index.html', 'text/html; charset=utf-8'],
 ['planner.css', 'text/css; charset=utf-8'],
 ['model.js', 'text/javascript; charset=utf-8'],
 ['planner.js', 'text/javascript; charset=utf-8'],
 ['GUIDE.md', 'text/plain; charset=utf-8']
]);
export async function routeAPM2Capacity({ request, response, url }) {
 if (!['GET','HEAD'].includes(request.method)) return false;
 if (url.pathname === '/apm2-capacity') {
  response.writeHead(302, { Location:'/apm2-capacity/', 'Cache-Control':'no-store' }); response.end(); return true;
 }
 if (!url.pathname.startsWith('/apm2-capacity/')) return false;
 const name = url.pathname.slice('/apm2-capacity/'.length) || 'index.html';
 if (!assets.has(name)) return false;
 const bytes = await readFile(new URL('./'+name, import.meta.url));
 response.writeHead(200, {
  'Content-Type':assets.get(name), 'Content-Length':bytes.length,
  'Cache-Control':'no-cache', 'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer',
  'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
 });
 response.end(request.method === 'HEAD' ? undefined : bytes);
 return true;
}

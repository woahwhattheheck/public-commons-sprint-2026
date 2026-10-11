// MIT. Private operator query workspace over the original immutable dataset engine.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadDatasetConfig } from './dataset-handler.mjs';
import { datasetQueryParameters } from './dataset-cli.mjs';

const HELP = `Usage: node dataset-workspace.mjs --dataset FILE [--port 8430] [--resource https://your-api.example/data]
Opens the operator's CSV snapshot for local query preparation, NOT payment or public serving.
Use the printed session URL on the same trusted computer. No dataset path is accepted over HTTP.`;
const shell = value => `'${value.replaceAll("'", "'\"'\"'")}'`;
function canonicalResource(raw) {
  if (raw === undefined) return null;
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || raw !== url.href)
    throw new TypeError('--resource must be a canonical HTTPS resource URL, without credentials, query or fragment');
  return url.href;
}

export async function startDatasetWorkspace({ datasetPath, port = 8430, resource } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new TypeError('Invalid port');
  resource = canonicalResource(resource);
  const dataset = await loadDatasetConfig(datasetPath);
  const [html, javascript] = await Promise.all(['dataset-workspace.html', 'dataset-workspace.js']
    .map(name => readFile(new URL(name, import.meta.url))));
  const token = randomBytes(32).toString('base64url');
  const expectedAuth = Buffer.from(`Bearer ${token}`);
  let origin;
  const server = createServer({ maxHeaderSize: 16384, requestTimeout: 10000,
    headersTimeout: 10000, keepAliveTimeout: 1000 }, async (req, res) => {
    const reply = (status, body, type = 'application/json; charset=utf-8') => {
      res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store',
        'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
        'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'" });
      res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
    };
    try {
      if (req.headers.host !== new URL(origin).host ||
          (req.headers.origin && req.headers.origin !== origin) || req.headers['sec-fetch-site'] === 'cross-site')
        return reply(403, { error: 'LOCAL_ORIGIN_REQUIRED' });
      if (req.method === 'GET' && req.url === '/') return reply(200, html, 'text/html; charset=utf-8');
      if (req.method === 'GET' && req.url === '/workspace.js') return reply(200, javascript, 'text/javascript; charset=utf-8');
      const auth = Buffer.from(req.headers.authorization ?? '');
      if (auth.length !== expectedAuth.length || !timingSafeEqual(auth, expectedAuth))
        return reply(401, { error: 'SESSION_REQUIRED', message: 'Reopen the session URL printed by the workspace command.' });
      if (req.method === 'GET' && req.url === '/api/schema') return reply(200, {
        mode: 'LOCAL_OPERATOR_PREVIEW', dataset: dataset.describe(), resource,
        queryParameters: datasetQueryParameters(dataset.describe()),
      });
      if (req.method !== 'POST' || req.url !== '/api/query') return reply(404, { error: 'NOT_FOUND' });
      if (req.headers['content-type'] !== 'application/json') return reply(415, { error: 'JSON_REQUIRED' });
      let size = 0;
      const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 16384) return reply(413, { error: 'QUERY_TOO_LARGE' });
        chunks.push(chunk);
      }
      let input;
      try { input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
      catch { return reply(400, { error: 'INVALID_JSON' }); }
      if (!input || typeof input !== 'object' || Array.isArray(input) ||
          Object.keys(input).join(',') !== 'query' || typeof input.query !== 'string' || input.query.length > 8192)
        return reply(400, { error: 'EXPECTED_QUERY_STRING' });
      const query = new URLSearchParams(input.query);
      const context = { query };
      const admission = dataset.admit(context);
      const response = admission === true ? dataset.handle(context) : admission;
      if (response.status !== 200) return reply(response.status, response.body);
      const suffix = query.size ? '?' + query.toString() : '';
      const requestUrl = resource ? resource + suffix : null;
      const artifact = { schema: 'stellar-forge.dataset-query.v1', mode: 'LOCAL_OPERATOR_PREVIEW',
        snapshot: dataset.describe().snapshot, query: query.toString(), requestUrl };
      const curl = resource ? `curl --get ${shell(resource)}` + [...query]
        .map(([key, value]) => ` \\\n  --data-urlencode ${shell(`${key}=${value}`)}`).join('') : null;
      return reply(200, { ...artifact, curl, result: response.body });
    } catch {
      // Avoid returning local paths, source text, or implementation traces to the browser.
      if (!res.headersSent) reply(500, { error: 'WORKSPACE_REQUEST_FAILED' });
      else res.end();
    }
  });
  server.maxRequestsPerSocket = 100;
  server.on('clientError', (_error, socket) => socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'));
  await new Promise((yes, no) => {
    server.once('error', no);
    server.listen(port, '127.0.0.1', () => { server.off('error', no); yes(); });
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, url: `${origin}/#${token}`, token,
    close: () => new Promise((yes, no) => server.close(error => error ? no(error) : yes())) };
}

export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') { console.log(HELP); return; }
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--dataset', '--port', '--resource'].includes(args[i]) || Object.hasOwn(options, args[i]) ||
        !args[i + 1] || args[i + 1].startsWith('--')) throw new TypeError('Invalid options; use --help');
    options[args[i]] = args[i + 1];
  }
  if (!options['--dataset']) throw new TypeError('--dataset is required');
  if (options['--port'] && !/^(0|[1-9][0-9]{0,4})$/.test(options['--port'])) throw new TypeError('Invalid port');
  const app = await startDatasetWorkspace({ datasetPath: options['--dataset'],
    port: options['--port'] === undefined ? 8430 : Number(options['--port']), resource: options['--resource'] });
  console.log(`Dataset workspace — local operator preview, no payment\n${app.url}\nKeep this session URL private. Stop with Ctrl+C.`);
  let closing = false;
  const stop = async () => { if (!closing) { closing = true; await app.close(); } };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  return app;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { console.error(`Dataset workspace: ${error.message}`); process.exitCode = 1; });

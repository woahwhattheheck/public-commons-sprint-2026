// MIT. Private operator workspace over the original immutable/versioned dataset engine.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadDatasetConfig } from './dataset-handler.mjs';
import { datasetQueryParameters } from './dataset-cli.mjs';

const HELP = [
  'Usage: node dataset-workspace.mjs (--dataset FILE | --state PRIVATE_DIR)',
  '  [--port 8430] [--resource https://your-api.example/data] [--catalog PRIVATE_DIR]',
  'Or: node dataset-workspace.mjs --stellar-expert PRIVATE_DIR [--inbox PRIVATE_INBOX] [--port 8436]',
  '  [--release-runtime PRIVATE_JSON]',
  'Open a CSV snapshot, attach to the original dataset service, or investigate Stellar assets.',
  'The private workspace previews native queries and can activate retained versions.',
  'Use the printed session URL on the same trusted computer. Paths are startup-only.',
].join('\n');
const shell = value => "'" + value.replaceAll("'", "'\"'\"'") + "'";
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function canonicalResource(raw) {
  if (raw === undefined) return null;
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || raw !== url.href)
    throw new TypeError('--resource must be a canonical HTTPS resource URL, without credentials, query or fragment');
  return url.href;
}

export async function startDatasetWorkspace({ datasetPath, stateDirectory, catalogDirectory,
  port = 8430, resource } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new TypeError('Invalid port');
  if (Boolean(datasetPath) === Boolean(stateDirectory)) throw new TypeError('Choose exactly one of --dataset or --state');
  resource = canonicalResource(resource);
  let dataset, control, snapshotParameter, catalogRequest;
  if (stateDirectory) {
    stateDirectory = resolve(stateDirectory);
    ({ datasetControl: control } = await import('./dataset-refresh/service.mjs'));
    ({ DATASET_SNAPSHOT_PARAMETER: snapshotParameter } = await import('./dataset-refresh/versions.mjs'));
  } else dataset = await loadDatasetConfig(datasetPath);
  if (catalogDirectory) {
    catalogDirectory = resolve(catalogDirectory);
    ({ requestCatalogOperator: catalogRequest } = await import('../sf60-durable-catalog-transaction/operator.mjs'));
  }
  const schema = async () => {
    if (dataset) return { mode: 'LOCAL_OPERATOR_PREVIEW', source: 'file',
      dataset: dataset.describe(), resource, queryParameters: datasetQueryParameters(dataset.describe()),
      catalogConfigured: Boolean(catalogDirectory) };
    const live = await control(stateDirectory, 'schema');
    const route = resource ? live.resources.find(route => route.resource === resource) : live.resources[0];
    if (!route) throw Object.assign(new Error('The selected resource is not advertised by this dataset service.'),
      { code: 'WORKSPACE_RESOURCE_UNAVAILABLE', status: 503 });
    return { ...live, source: 'service', resource: route.resource,
      publicSnapshotSelection: route.snapshotSelection,
      queryParameters: [...datasetQueryParameters(live.dataset), snapshotParameter],
      catalogConfigured: Boolean(catalogDirectory) };
  };
  // Attach before opening the browser listener. No second store or writer is opened.
  await schema();
  const [html, javascript] = await Promise.all(['dataset-workspace.html', 'dataset-workspace.js']
    .map(name => readFile(new URL(name, import.meta.url))));
  const token = randomBytes(32).toString('base64url');
  const expectedAuth = Buffer.from('Bearer ' + token);
  let origin;
  const server = createServer({ maxHeaderSize: 16384, requestTimeout: 10000,
    headersTimeout: 10000, keepAliveTimeout: 1000 }, async (req, res) => {
    const reply = (status, body, type = 'application/json; charset=utf-8') => {
      if (res.destroyed) return;
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
      if (req.method === 'GET' && req.url === '/api/schema') return reply(200, await schema());
      if (req.method === 'GET' && req.url === '/api/catalog' && catalogRequest) {
        try {
          const result = await catalogRequest({ directory: catalogDirectory, operation: 'status', timeoutMs: 10000 });
          return reply(200, { state: result.state, journalHead: result.journalHead,
            committedOperations: result.committedOperations, activeResources: result.activeResources,
            discoveryOrigin: result.discoveryOrigin });
        } catch {
          return reply(503, { error: 'CATALOG_UNAVAILABLE',
            message: 'The private catalog operator is unavailable. Dataset queries and version controls remain available.' });
        }
      }
      if (req.method !== 'POST' || !['/api/query', '/api/activate'].includes(req.url))
        return reply(404, { error: 'NOT_FOUND' });
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
      if (req.url === '/api/activate') {
        if (!control) return reply(404, { error: 'LIVE_SERVICE_REQUIRED' });
        if (!object(input) || Object.keys(input).sort().join(',') !== 'expectedRevision,expectedSnapshot,snapshot' ||
            !hash(input.snapshot) || !hash(input.expectedSnapshot) || !Number.isSafeInteger(input.expectedRevision) ||
            input.expectedRevision < 1) return reply(400, { error: 'EXPECTED_VERSION_SELECTION' });
        // One attempt using the state the operator actually saw. Never silently
        // retry a stale revision or cancel an accepted write on browser disconnect.
        const activation = await control(stateDirectory, 'activate', input);
        return reply(200, { activation, workspace: await schema() });
      }
      if (!object(input) || Object.keys(input).join(',') !== 'query' ||
          typeof input.query !== 'string' || input.query.length > 8192)
        return reply(400, { error: 'EXPECTED_QUERY_STRING' });
      const query = new URLSearchParams(input.query);
      let result, description;
      if (control) {
        const controller = new AbortController();
        const disconnected = () => { if (!res.writableFinished) controller.abort(); };
        res.once('close', disconnected);
        try {
          description = await schema();
          result = await control(stateDirectory, 'preview', { query: query.toString() }, { signal: controller.signal });
        } finally { res.removeListener('close', disconnected); }
      } else {
        const context = { query }, admission = dataset.admit(context);
        const response = admission === true ? dataset.handle(context) : admission;
        if (response.status !== 200) return reply(response.status, response.body);
        result = response.body; description = await schema();
      }
      // A private retained preview is useful even if its public route did not opt
      // into first-page selection. Do not export a URL that route cannot accept.
      const requestUnavailable = control && query.has('snapshot') && !description.publicSnapshotSelection ?
        'This seller route does not advertise first-page snapshot selection. The selected snapshot is available for private preview; use a current query or an original continuation cursor for its public request.' : null;
      const publicResource = requestUnavailable ? null : description.resource;
      const requestUrl = publicResource ? publicResource + (query.size ? '?' + query.toString() : '') : null;
      const artifact = { schema: 'stellar-forge.dataset-query.v1', mode: 'LOCAL_OPERATOR_PREVIEW',
        snapshot: result.dataset.snapshot, query: query.toString(), requestUrl };
      const curl = publicResource ? 'curl --get ' + shell(publicResource) + [...query]
        .map(([key, value]) => ' \\\n  --data-urlencode ' + shell(key + '=' + value)).join('') : null;
      return reply(200, { ...artifact, curl, requestUnavailable, result });
    } catch (error) {
      // Native query and CAS errors contain operator-relevant facts. Filesystem,
      // transport and loader exceptions never reveal local paths or source text.
      if (res.headersSent) { if (!res.writableEnded) res.end(); return; }
      if (typeof error.code === 'string' &&
          (error.code.startsWith('DATASET_') || error.code === 'INVALID_DATASET_QUERY') &&
          [400, 409, 410, 413, 429].includes(error.status))
        return reply(error.status, { error: error.code, message: error.message });
      if (error.code === 'WORKSPACE_RESOURCE_UNAVAILABLE')
        return reply(503, { error: error.code, message: error.message });
      return reply(control ? 503 : 500, { error: control ? 'DATASET_SERVICE_UNAVAILABLE' : 'WORKSPACE_REQUEST_FAILED',
        ...(control ? { message: 'The running dataset service could not complete this request. Refresh live state before retrying an activation.' } : {}) });
    }
  });
  server.maxRequestsPerSocket = 100;
  server.on('clientError', (_error, socket) => socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'));
  await new Promise((yes, no) => {
    server.once('error', no);
    server.listen(port, '127.0.0.1', () => { server.off('error', no); yes(); });
  });
  origin = 'http://127.0.0.1:' + server.address().port;
  return { origin, url: origin + '/#' + token, token,
    close: () => new Promise((yes, no) => {
      server.close(error => error ? no(error) : yes()); server.closeIdleConnections?.();
    }) };
}

export async function main(args = process.argv.slice(2)) {
  if (args.includes('--stellar-expert')) {
    const { main: stellarExpertMain } = await import('./stellar-expert/workspace.mjs');
    return stellarExpertMain(args.map(value => value === '--stellar-expert' ? '--workspace' : value));
  }
  if (args.length === 1 && args[0] === '--help') { console.log(HELP); return; }
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--dataset', '--state', '--catalog', '--port', '--resource'].includes(args[i]) ||
        Object.hasOwn(options, args[i]) || !args[i + 1] || args[i + 1].startsWith('--'))
      throw new TypeError('Invalid options; use --help');
    options[args[i]] = args[i + 1];
  }
  if (Boolean(options['--dataset']) === Boolean(options['--state']))
    throw new TypeError('Choose exactly one of --dataset or --state');
  if (options['--port'] && !/^(0|[1-9][0-9]{0,4})$/.test(options['--port'])) throw new TypeError('Invalid port');
  const app = await startDatasetWorkspace({ datasetPath: options['--dataset'],
    stateDirectory: options['--state'], catalogDirectory: options['--catalog'],
    port: options['--port'] === undefined ? 8430 : Number(options['--port']), resource: options['--resource'] });
  console.log('Dataset workspace — local operator preview, no payment\n' + app.url +
    '\nKeep this session URL private. Stop with Ctrl+C.');
  let closing = false;
  const stop = async () => { if (!closing) { closing = true; await app.close(); } };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  return app;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { console.error('Dataset workspace: ' + error.message); process.exitCode = 1; });

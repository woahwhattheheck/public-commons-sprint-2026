// MIT. SF61: loopback discovery and offline review using original SF88 preparation.
// The original SF44 fixture is the ONLY default source. Real providers require explicit CLI opt-in.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { startLocalDevelopmentCatalog } from '../sf44-developer-onramp/onboard.mjs';
import { prepareReview } from '../sf88-operator-buyer-cli/prepare.mjs';
import { createAtlasWorkspaceHttp } from './workspace-http.mjs';
import { publishAtlasLaunch } from './managed-launch.mjs';

const HOST = '127.0.0.1';
const MAX_PAGE_BYTES = 16 * 1024 * 1024;
const STATIC = Object.freeze({
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.mjs': ['app.mjs', 'text/javascript; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/workspace-ui.mjs': ['workspace-ui.mjs', 'text/javascript; charset=utf-8'],
  '/workspace.css': ['workspace.css', 'text/css; charset=utf-8'],
});
const HEADERS = Object.freeze({
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
});
const FILTERS = new Set(['network', 'type', 'scheme', 'payTo', 'extensions']);

async function reviewRequest(req) {
  const max = 2 * 1024 * 1024;
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] ?? ''))
    throw new TypeError('JSON_REQUIRED');
  if (req.headers['content-encoding'] || Number(req.headers['content-length']) > max)
    throw new RangeError('REVIEW_INPUT_TOO_LARGE');
  const chunks = []; let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > max) throw new RangeError('REVIEW_INPUT_TOO_LARGE');
    chunks.push(chunk);
  }
  const body = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).some(key => !['discovery','selection'].includes(key)) ||
      typeof body.discovery !== 'string') throw new TypeError('INVALID_REVIEW_INPUT');
  return prepareReview(Buffer.from(body.discovery,'utf8'),body.selection);
}

export function normalizeUpstream(address) {
  const url = new URL(address);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      !['/', '/discovery/resources'].includes(url.pathname) || url.port ||
      url.hostname === 'localhost' || url.hostname.endsWith('.local') ||
      url.hostname.endsWith('.internal')) {
    throw new TypeError('An explicit public HTTPS facilitator root is required (no credentials, port, or query)');
  }
  return url.origin;
}

export function normalizeLocalUpstream(address) {
  const url = new URL(address);
  // The ORIGINAL SF60 service binds only to IPv4 127.0.0.1 and rejects any
  // nonliteral Host. No hostnames, DNS, credentials or custom remote targets.
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' ||
      !url.port || url.username || url.password || url.search || url.hash ||
      !['/', '/discovery/resources'].includes(url.pathname)) {
    throw new TypeError('SF60 backend must be an explicit http://127.0.0.1:<port> origin');
  }
  return url.origin;
}

function selectDiscoveryRequest(url, upstream) {
  if (url.searchParams.size > 11) throw new RangeError('Too many query parameters');
  const view = url.searchParams.get('view') ?? 'list';
  if (!['list', 'search'].includes(view)) throw new RangeError('Unknown read-only view');
  const allowed = new Set([...FILTERS, 'view', 'limit', ...(view === 'list' ? ['offset'] : ['cursor', 'query'])]);
  const output = new URL(view === 'list' ? '/discovery/resources' : '/discovery/search', upstream);
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1)
      throw new RangeError('Unknown or repeated query parameter');
  }
  for (const key of FILTERS) {
    const value = url.searchParams.get(key);
    if (value === null || value === '') continue;
    if (value.length > 256 || /[\x00-\x1f\x7f]/.test(value)) throw new RangeError('Invalid discovery filter');
    if (key === 'network' && !['stellar:testnet', 'stellar:pubnet'].includes(value))
      throw new RangeError('Only explicit Stellar networks are supported');
    if (key === 'type' && !['http', 'mcp'].includes(value))
      throw new RangeError('Invalid Bazaar resource type');
    output.searchParams.set(key, value);
  }
  const limit = url.searchParams.get('limit') ?? '25';
  if (!/^[1-9][0-9]?$|^100$/.test(limit)) throw new RangeError('Page limit must be 1..100');
  output.searchParams.set('limit', limit);
  if (view === 'list') {
    const offset = url.searchParams.get('offset') ?? '0';
    if (!/^(0|[1-9][0-9]{0,6})$/.test(offset)) throw new RangeError('Invalid offset');
    output.searchParams.set('offset', offset);
  } else {
    const query = url.searchParams.get('query');
    if (typeof query !== 'string' || !query.trim() || query.length > 1024 ||
        /[\x00-\x1f\x7f]/.test(query)) throw new RangeError('Search query is required (max 1024 chars)');
    output.searchParams.set('query', query);
    const cursor = url.searchParams.get('cursor');
    if (cursor !== null) {
      // Native x402 Bazaar search cursors are opaque strings: providers may use
      // padded base64 or signed tokens with +, / and =. URLSearchParams
      // re-encodes the exact value for the fixed, operator-selected upstream.
      if (cursor.length === 0 || cursor.length > 512 || /[\x00-\x1f\x7f]/.test(cursor))
        throw new RangeError('Invalid opaque cursor');
      output.searchParams.set('cursor', cursor);
    }
  }
  return { view, upstreamUrl: output };
}

async function boundedJson(response) {
  const contentType = response.headers.get('content-type') ?? '';
  if (!/json/i.test(contentType)) throw new Error('Discovery endpoint did not return JSON');
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_PAGE_BYTES) throw new Error('Page exceeds maximum size');
  if (!response.body) throw new Error('No provider response body');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_PAGE_BYTES) throw new Error('Page exceeds maximum size');
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
}

function rowsOf(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.resources)) return body.resources;
  if (Array.isArray(body?.items)) return body.items;
  if (Array.isArray(body?.data?.resources)) return body.data.resources;
  if (Array.isArray(body?.data?.items)) return body.data.items;
  throw new Error('Unexpected native Bazaar resources/items response');
}

function send(res, status, data, mime = 'application/json; charset=utf-8') {
  res.writeHead(status, { ...HEADERS, 'content-type': mime });
  res.end(data);
}

/**
 * Serve original SF44, independently operated original SF60, or an explicitly
 * selected public HTTPS Bazaar GET endpoint. This has no registration, wallet,
 * signer, paid-origin, verify, settle, or mutable catalog route.
 */
export async function startExplorer({ fixture = false, upstream = null, localUpstream = null, workspaceDirectory = null, port = 0 } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new RangeError('Invalid local listener port');
  const sourceCount = [fixture, Boolean(upstream), Boolean(localUpstream)].filter(Boolean).length;
  if (sourceCount > 1 || sourceCount === 0 && !workspaceDirectory)
    throw new TypeError('Choose exactly one original discovery source');
  let development = null;
  let server = null;
  let workspace = null;
  try {
    const source = sourceCount === 0 ? 'RETAINED_CATALOG_WORKSPACE' : fixture ? 'LOCAL_NONPAYABLE_SF44_FIXTURE' :
      localUpstream ? 'ORIGINAL_SF60_DURABLE_CATALOG' : 'PUBLIC_FACILITATOR_READ_ONLY';
    let upstreamOrigin;
    if (fixture) {
      development = await startLocalDevelopmentCatalog();
      upstreamOrigin = development.baseUrl;
    } else if (localUpstream) {
      upstreamOrigin = normalizeLocalUpstream(localUpstream);
    } else if (upstream) {
      upstreamOrigin = normalizeUpstream(upstream);
    }
    if (workspaceDirectory) workspace = await createAtlasWorkspaceHttp({ directory: workspaceDirectory });
    const assets = new Map(await Promise.all(Object.entries(STATIC).map(async ([route, [file, mime]]) =>
      [route, { bytes: await readFile(new URL(file, import.meta.url)), mime }])));
    let expectedHost = '';
    server = createServer(async (req, res) => {
      const reply = (status, obj) => send(res, status, JSON.stringify(obj));
      try {
        // The URL comes from an untrusted browser. Do not let Host headers, CORS,
        // query args, redirects or arbitrary URLs choose the remote target.
        if (req.socket.localAddress !== HOST || req.socket.remoteAddress !== HOST ||
            req.headers.host !== expectedHost) return reply(403, { error: 'LOCAL_ORIGIN_ONLY' });
        if (!req.url || req.url.length > 4096) return reply(400, { error: 'BAD_URL' });
        const request = new URL(req.url, 'http://127.0.0.1');
        if (workspace && await workspace.handle({ request: req, url: request, origin: 'http://' + expectedHost, reply })) return;
        if (request.pathname === '/api/prepare-review' && request.search === '') {
          if (req.method !== 'POST') return reply(405,{error:'POST_ONLY'});
          if (req.headers.origin !== 'http://' + expectedHost ||
              req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin')
            return reply(403,{error:'LOCAL_ORIGIN_ONLY'});
          try {
            const prepared = await reviewRequest(req);
            return reply(200,{mode:'OFFLINE_REVIEW_PREPARED',
              config:prepared.draft, configText:prepared.data.toString('utf8'),
              configSha256:prepared.configSha256,
              sourceFileSha256:prepared.draft.preparedFrom.discoveryFileSha256,
              paidRequestsEnabled:false, executionReady:false});
          } catch (error) {
            return reply(400,{error:error.code ?? 'INVALID_REVIEW_INPUT',
              reason:String(error.message).slice(0,180)});
          }
        }
        if (req.method !== 'GET') return reply(405, { error: 'GET_ONLY' });
        if (request.pathname === '/api/source' && request.search === '')
          return reply(200, { mode: source, origin: fixture ? 'original SF44 fixture' : upstreamOrigin ?? 'Retained local catalog observations',
            paidRequestsEnabled: false, autoPaymentEnabled: false, workspaceEnabled: Boolean(workspace) });
        if (request.pathname === '/api/discovery') {
          if (!upstreamOrigin) return reply(200, { mode: source, resources: [], pagination: { total: 0 },
            completeResponse: false, readOnly: true, paidRequestsEnabled: false });
          let target;
          try { target = selectDiscoveryRequest(request, upstreamOrigin); }
          catch (error) { return reply(400, { error: 'INVALID_QUERY', reason: String(error.message).slice(0, 180) }); }
          let response;
          try {
            response = await fetch(target.upstreamUrl, {
              method: 'GET', redirect: 'error', headers: { accept: 'application/json' },
              signal: AbortSignal.timeout(10000),
            });
            if (!response.ok) {
              await response.body?.cancel();
              return reply(502, { error: 'SOURCE_HTTP_ERROR', sourceStatus: response.status });
            }
            const parsed = await boundedJson(response);
            const rows = rowsOf(parsed);
            return reply(200, {
              mode: source, view: target.view, observedAt: new Date().toISOString(),
              sourceUrl:target.upstreamUrl.href,
              resources: rows, pagination: parsed?.pagination ?? {},
              partialResults: parsed?.partialResults === true,
              x402Version: parsed?.x402Version ?? null,
              completeResponse: false, // This is one native provider page, not a captured whole catalog.
              readOnly: true, paidRequestsEnabled: false,
            });
          } catch (error) {
            return reply(502, { error: 'SOURCE_UNAVAILABLE',
              reason: String(error.message).replace(/[\r\n]/g, ' ').slice(0, 160) });
          }
        }
        const asset = assets.get(req.url);
        if (!asset) return reply(404, { error: 'NOT_FOUND' });
        return send(res, 200, asset.bytes, asset.mime);
      } catch {
        if (!res.headersSent) reply(500, { error: 'EXPLORER_INTERNAL_ERROR' });
        else if (!res.writableEnded) res.end();
      }
    });
    server.requestTimeout = 10000;
    server.headersTimeout = 10000;
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, HOST, resolve);
    });
    expectedHost = new URL('http://' + HOST + ':' + server.address().port).host;
    return {
      source, sourceOrigin: upstreamOrigin ?? null, url: 'http://' + expectedHost + (workspace ? '/#' + workspace.token : ''),
      async close() {
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        await workspace?.close();
        if (development) await development.close();
      },
    };
  } catch (error) {
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    await workspace?.close();
    if (development) await development.close();
    throw error;
  }
}

function cli() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Use: node server.mjs [--fixture OR --local-upstream http://127.0.0.1:8787 OR --upstream https://public-facilitator.example] [--workspace ABSOLUTE_PRIVATE_DIRECTORY] [--port 0] [--managed-source ABS_SELECTED_ATLAS_SOURCE]\nWith --workspace and no live source, reopen retained catalog pages and buyer requests.');
    return;
  }
  const count = name => args.filter(value => value === name).length;
  if (args.some((arg, i) => !['--fixture', '--upstream', '--local-upstream', '--workspace', '--port', '--managed-source'].includes(arg) &&
      !(i > 0 && ['--upstream', '--local-upstream', '--workspace', '--port', '--managed-source'].includes(args[i - 1]))) ||
      count('--fixture') > 1 || count('--upstream') > 1 ||
      count('--local-upstream') > 1 || count('--workspace') > 1 || count('--port') > 1 || count('--managed-source') > 1 ||
      [args.includes('--fixture'), args.includes('--upstream'),
        args.includes('--local-upstream')].filter(Boolean).length > 1) {
    throw new TypeError('Unknown, duplicate or conflicting CLI options');
  }
  const value = name => { const i = args.indexOf(name); return i < 0 ? null : args[i + 1]; };
  const portArg = value('--port');
  const port = portArg === null ? 0 : Number(portArg);
  const fixture = args.includes('--fixture') ||
    (!args.includes('--upstream') && !args.includes('--local-upstream') && !args.includes('--workspace'));
  const managedSource = value('--managed-source');
  if (managedSource && !value('--workspace'))
    throw new TypeError('Managed Atlas requires its original private workspace');
  return startExplorer({ fixture, upstream: value('--upstream'),
    localUpstream: value('--local-upstream'), workspaceDirectory: value('--workspace'), port }).then(async session => {
    let managedLaunch = null, stopping = false, closing = null;
    const startup = managedSource ? publishAtlasLaunch({ directory: value('--workspace'),
      sourceDirectory: managedSource, source: session.source, sourceOrigin: session.sourceOrigin,
      url: session.url }).then(value => { managedLaunch = value; }) : Promise.resolve();
    const close = () => closing ??= (async () => {
      await startup.catch(() => {});
      try { await managedLaunch?.retire(); } finally { await session.close(); }
    })();
    const stop = async () => {
      if (stopping) return;
      stopping = true;
      try { await close(); }
      catch (error) { console.error(error); process.exitCode = 1; }
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    try {
      await startup;
      if (stopping) { await close(); return; }
      console.log(managedLaunch ? JSON.stringify(managedLaunch.value)
        : JSON.stringify({ status: 'RUNNING', url: session.url, source: session.source,
          paidRequestsEnabled: false }, null, 2));
    } catch (error) {
      await close().catch(() => {});
      process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
      throw error;
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  Promise.resolve().then(cli).catch(error => { console.error(error); process.exitCode = 1; });
}

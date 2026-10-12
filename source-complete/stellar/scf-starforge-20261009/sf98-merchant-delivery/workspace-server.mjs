// MIT. Local HTTP surface for the shared original SF98 delivery controller.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomBytes, timingSafeEqual, createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {openDeliveryWorkspace, workspaceFault} from './workspace-model.mjs';

const messages = {
  WORKSPACE_CHANGED_RELOAD:'The workspace changed. Refresh before applying this action.',
  RECEIVER_PROFILE_CHANGED_RELOAD:'The receiver revision changed. Select the current revision.',
  DELIVERY_EVENT_CHANGED_RELOAD:'A selected event changed. Refresh the queue and select its current state.',
  RECEIVER_SECRET_ENVIRONMENT_UNAVAILABLE:'Set the profile’s secret environment variable in the process that starts this workspace.',
  SF98_DELIVERY_BUSY:'The original outbox has an active delivery owner. Its current owner is shown in Worker status.',
  RECEIVER_PROFILE_REQUIRED:'Save and select a receiver profile.',
  EXPLICIT_WORKER_RESUME_REQUIRED:'Choose whether the owned worker should resume after repair.',
};
function codeOf(error) {
  return [error?.code,error?.message].find(value => typeof value === 'string' &&
    /^[A-Z][A-Z0-9_]{0,100}$/.test(value)) ?? 'DELIVERY_WORKSPACE_ERROR';
}

/** Mount this handler beside an existing private operator listener. */
export async function createDeliveryWorkspaceHandler({model, origins, basePath = '',
  token = randomBytes(32).toString('hex')} = {}) {
  if (!model || !Array.isArray(origins) || !origins.length ||
    !/^(?:\/[A-Za-z0-9_-]+)*$/.test(basePath)) throw workspaceFault('EXPLICIT_WORKSPACE_ORIGIN_REQUIRED');
  const allowedOrigins = new Set(origins.map(value => new URL(value).origin));
  const hosts = new Set([...allowedOrigins].map(value => new URL(value).host));
  const html = await readFile(new URL('./workspace.html', import.meta.url));
  const app = await readFile(new URL('./workspace-app.mjs', import.meta.url));
  const style = /<style>([\s\S]*?)<\/style>/.exec(html.toString('utf8'))?.[1];
  if (style === undefined) throw workspaceFault('WORKSPACE_STYLE_MISSING');
  const styleHash = createHash('sha256').update(style).digest('base64');
  const headers = {'cache-control':'no-store','x-content-type-options':'nosniff',
    'referrer-policy':'no-referrer','cross-origin-resource-policy':'same-origin',
    'content-security-policy':"default-src 'none'; script-src 'self'; style-src 'sha256-" + styleHash +
      "'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"};
  const reading = new Set();
  const jsonType = 'application/json; charset=utf-8';
  const assets = new Map([['/',{bytes:html,type:'text/html; charset=utf-8'}],
    ['/workspace-app.mjs',{bytes:app,type:'text/javascript; charset=utf-8'}]]);
  let closing = false;
  const handler = async (req,res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (basePath && pathname !== basePath && !pathname.startsWith(basePath + '/')) return false;
    function reply(status,type,value,extra = {}) {
      if (res.destroyed) return;
      const bytes = Buffer.isBuffer(value) ? value : Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
      res.writeHead(status,{...headers,'content-type':type,'content-length':String(bytes.length),...extra});
      res.end(req.method === 'HEAD' ? undefined : bytes);
    }
    const json = (status,value) => reply(status,jsonType,value);
    try {
      if (closing) throw workspaceFault('WORKSPACE_CLOSING',503);
      if (!hosts.has(req.headers.host) || req.headers.origin && !allowedOrigins.has(req.headers.origin) ||
        ['cross-site','same-site'].includes(req.headers['sec-fetch-site']))
        throw workspaceFault('WORKSPACE_ORIGIN_REQUIRED',403);
      const url = new URL(req.url, 'http://' + req.headers.host);
      const path = url.pathname.slice(basePath.length) || '/';
      if (basePath && url.pathname === basePath) {
        if (req.method !== 'GET' && req.method !== 'HEAD') throw workspaceFault('NOT_FOUND',404);
        reply(307,'text/plain','Open delivery workspace.',{location:basePath + '/'}); return true;
      }
      if (req.method === 'GET' || req.method === 'HEAD') {
        const asset = assets.get(path);
        if (asset && !url.search) { reply(200,asset.type,asset.bytes); return true; }
        if (path === '/api/state' && !url.search) { json(200,{...await model.state(),token}); return true; }
        if (path === '/api/events') {
          if ([...url.searchParams.keys()].some(key => !['state','query','offset','limit'].includes(key)))
            throw workspaceFault('INVALID_EVENT_QUERY');
          json(200,await model.events({state:url.searchParams.get('state') ?? 'ALL',
            query:url.searchParams.get('query') ?? '',offset:Number(url.searchParams.get('offset') ?? 0),
            limit:Number(url.searchParams.get('limit') ?? 100)})); return true;
        }
        if (url.search) throw workspaceFault('INVALID_WORKSPACE_URL');
        let match = /^\/api\/events\/([a-f0-9]{64})$/.exec(path);
        if (match) { json(200,await model.event(match[1])); return true; }
        match = /^\/api\/profiles\/(profile-[a-f0-9-]{36})(?:\/([1-9][0-9]*))?$/.exec(path);
        if (match) { json(200,await model.profile(match[1],match[2] ? Number(match[2]) : undefined)); return true; }
        match = /^\/api\/jobs\/(job-[a-f0-9-]{36})$/.exec(path);
        if (match) { json(200,await model.job(match[1])); return true; }
        if (path === '/api/handoff') {
          reply(200,jsonType,await model.handoff(),{'content-disposition':'attachment; filename="sf98-operator-handoff.json"'});
          return true;
        }
        throw workspaceFault('NOT_FOUND',404);
      }
      if (req.method !== 'POST') {
        reply(405,'text/plain','Use GET or POST.',{allow:'GET, HEAD, POST'}); return true;
      }
      if (url.search) throw workspaceFault('INVALID_WORKSPACE_URL');
      const provided = Buffer.from(String(req.headers['x-sf98-session'] ?? ''));
      const expected = Buffer.from(token);
      if (provided.length !== expected.length || !timingSafeEqual(provided,expected))
        throw workspaceFault('WORKSPACE_SESSION_REQUIRED',403);
      if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json')
        throw workspaceFault('JSON_REQUIRED',415);
      if (Number(req.headers['content-length'] ?? 0) > 65536) throw workspaceFault('REQUEST_TOO_LARGE',413);
      const chunks = []; let length = 0;
      reading.add(req);
      try {
        for await (const chunk of req) {
          length += chunk.length;
          if (length > 65536) throw workspaceFault('REQUEST_TOO_LARGE',413);
          chunks.push(chunk);
        }
      } finally { reading.delete(req); }
      let input;
      try {
        input = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error();
      } catch { throw workspaceFault('INVALID_JSON'); }
      const actions = {'/api/profiles/save':'saveProfile','/api/worker/start':'start',
        '/api/worker/pause':'pause','/api/worker/drain':'drain',
        '/api/maintenance/requeue':'requeue','/api/maintenance/resume':'resumeMaintenance'};
      const action = actions[path];
      if (!action) throw workspaceFault('NOT_FOUND',404);
      json(['start','drain','requeue','resumeMaintenance'].includes(action) ? 202 : 200,await model[action](input));
    } catch (error) {
      if (res.headersSent) { res.destroy(); return true; }
      const code = codeOf(error), status = error.status ?? (code === 'SF98_DELIVERY_BUSY' ? 409 :
        code === 'ENOENT' ? 404 : error instanceof TypeError || error instanceof RangeError ? 400 : 500);
      json(status,{code,message:messages[code] ?? (status === 500 ?
        'Inspect the private workspace and original outbox state.' : code.toLowerCase().replaceAll('_',' ') + '.')});
    }
    return true;
  };
  handler.close = () => { closing = true; for (const request of reading) request.destroy(); };
  return handler;
}

export async function startDeliveryWorkspace({port = 8462, basePath = '', ...options} = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw workspaceFault('INVALID_PORT');
  const model = await openDeliveryWorkspace(options);
  let handler, closePromise;
  const server = createServer((req,res) => {
    if (!handler) { res.writeHead(503); res.end(); return; }
    handler(req,res).then(handled => { if (!handled) { res.writeHead(404); res.end(); } })
      .catch(() => { if (!res.headersSent) res.writeHead(500); res.end(); });
  });
  server.requestTimeout = 20000; server.headersTimeout = 10000; server.keepAliveTimeout = 2000;
  try {
    await new Promise((done,fail) => {
      server.once('error',fail); server.listen(port,'127.0.0.1',() => { server.off('error',fail); done(); });
    });
    const assigned = server.address().port;
    const origin = 'http://127.0.0.1:' + assigned;
    handler = await createDeliveryWorkspaceHandler({model,basePath,
      origins:[origin,'http://localhost:' + assigned]});
    return {model,server,url:origin + basePath + '/',
      close() {
        return closePromise ??= (async () => {
          handler.close();
          const stopped = new Promise(done => server.close(done));
          server.closeIdleConnections?.();
          await model.close(); server.closeAllConnections?.(); await stopped;
        })();
      }};
  } catch (error) { server.close(); await model.close(); throw error; }
}

const usage = 'Usage: workspace-server.mjs serve --workspace /private/delivery-ops --state /private/sf98-outbox [--port 8462]\n' +
  '\nOpen the private SF98 delivery operator workspace on 127.0.0.1.\n' +
  '  --workspace  Absolute private directory for receiver revisions and worker intent.\n' +
  '  --state      Absolute private directory containing the original SF98 outbox.\n' +
  '  --port       Local listener port, 0-65535; default 8462.\n' +
  '\nReceiver profiles contain the signing secret environment name; set its value before starting.\n' +
  'Use --help, -h, or help to show this usage without opening any state.\n';
const usageFault = code => Object.assign(workspaceFault(code), {usage:code + '\n\n' + usage});

export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && ['--help','-h','help'].includes(args[0]) ||
    args.length === 2 && args[0] === 'serve' && ['--help','-h','help'].includes(args[1])) {
    process.stdout.write(usage); return {help:true};
  }
  const [command,...rest] = args, values = new Map();
  if (command !== 'serve' || rest.length % 2) throw usageFault('INVALID_WORKSPACE_USAGE');
  for (let index = 0; index < rest.length; index += 2) {
    if (!['--workspace','--state','--port'].includes(rest[index]) || values.has(rest[index]))
      throw usageFault('INVALID_OR_DUPLICATE_OPTION');
    values.set(rest[index],rest[index + 1]);
  }
  if (!values.get('--workspace') || !values.get('--state')) throw usageFault('WORKSPACE_AND_STATE_REQUIRED');
  const rawPort = values.get('--port') ?? '8462';
  if (!/^[0-9]{1,5}$/.test(rawPort) || Number(rawPort) > 65535) throw usageFault('INVALID_PORT');
  const workspace = await startDeliveryWorkspace({directory:values.get('--workspace'),
    outboxDirectory:values.get('--state'),port:Number(rawPort)});
  process.stdout.write(JSON.stringify({url:workspace.url,directory:workspace.model.directory,
    outboxDirectory:workspace.model.outboxDirectory}) + '\n');
  let stopping = false;
  const stop = async () => {
    if (stopping) return; stopping = true;
    process.removeListener('SIGTERM',stop); process.removeListener('SIGINT',stop);
    await workspace.close();
  };
  process.on('SIGTERM',stop); process.on('SIGINT',stop);
  return workspace;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(error => { process.stderr.write(error.usage ?? codeOf(error) + '\n'); process.exitCode = 1; });

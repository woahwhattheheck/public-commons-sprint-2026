// MIT. Operator-local HTTP interface for the original merchant pricing workflow.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { openBundleDownload } from '../economics/archive.mjs';
import { openWorkspace, fault } from './model.mjs';
import { openPlanningWorkspace } from '../planning/workspace.mjs';

const POLICY = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
const REPORT_POLICY = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";

export async function startWorkspace({port = 8457, ...options} = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new TypeError('Port must be 0–65535.');
  const model = await openWorkspace(options), token = randomBytes(32).toString('hex');
  const planning = await openPlanningWorkspace({model,directory:options.directory});
  const assets = new Map(await Promise.all([
    ['/', 'index.html','text/html; charset=utf-8'],
    ['/economics','../economics/index.html','text/html; charset=utf-8'],
    ['/economics/browser.mjs','../economics/browser.mjs','text/javascript; charset=utf-8'],
    ['/economics/style.css','../economics/style.css','text/css; charset=utf-8'],
    ['/browser.mjs','browser.mjs','text/javascript; charset=utf-8'],
    ['/style.css','style.css','text/css; charset=utf-8'],
    ['/planning','../planning/index.html','text/html; charset=utf-8'],
    ['/planning/browser.mjs','../planning/browser.mjs','text/javascript; charset=utf-8'],
    ['/planning/style.css','../planning/style.css','text/css; charset=utf-8'],
  ].map(async ([path,name,type]) => [path,{type,bytes:await readFile(new URL(name,import.meta.url))}])));
  let hosts = new Set(), origins = new Set();
  const server = createServer((req,res) => {
    function reply(status,type,data,extra = {}) {
      if (res.destroyed) return;
      const bytes = Buffer.isBuffer(data) ? data : Buffer.from(typeof data === 'string' ? data : JSON.stringify(data));
      res.writeHead(status,{'content-type':type,'content-length':String(bytes.length),'cache-control':'no-store',
        'x-content-type-options':'nosniff','referrer-policy':'no-referrer',
        'cross-origin-resource-policy':'same-origin','content-security-policy':POLICY,...extra});
      res.end(req.method === 'HEAD' ? undefined : bytes);
    }
    const json = (status,value) => reply(status,'application/json; charset=utf-8',value);
    function authorize() {
      const supplied = Buffer.from(String(req.headers['x-sf97-workspace'] ?? ''));
      const expected = Buffer.from(token);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied,expected))
        throw fault('WORKSPACE_SESSION_REQUIRED','Reload this workspace before saving.',403);
    }
    async function body(maximum = 2 * 1024 * 1024) {
      if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json')
        throw fault('JSON_REQUIRED','Use application/json.',415);
      authorize();
      let size = 0; const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > maximum) throw fault('REQUEST_TOO_LARGE','Input exceeds the documented workspace size limit.',413);
        chunks.push(chunk);
      }
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
        return value;
      } catch { throw fault('INVALID_JSON','Use a JSON object for commercial inputs.'); }
    }
    (async () => {
      if (!hosts.has(req.headers.host) || (req.headers.origin && !origins.has(req.headers.origin)) ||
          ['cross-site','same-site'].includes(req.headers['sec-fetch-site']))
        throw fault('OPERATOR_ORIGIN_REQUIRED','Open the local operator workspace directly.',403);
      const url = new URL(req.url,`http://${req.headers.host}`);
      if (url.search || url.hash) throw fault('INVALID_URL','Use the workspace URL without query parameters.',400);
      if (req.method === 'GET' || req.method === 'HEAD') {
        const asset = assets.get(url.pathname);
        if (asset) return reply(200,asset.type,asset.bytes);
        if (url.pathname === '/api/economics/state') return json(200,{...await model.economics.state(),token});
        const costFile = /^\/cost-files\/(source|export|edition)\/([a-f0-9-]{36})(?:\/(.+))?$/.exec(url.pathname);
        if (costFile) {
          if (costFile[1] === 'source' && !costFile[3]) {
            const value=await model.economics.sourceDownload(costFile[2]);
            return reply(200,'application/octet-stream',value.bytes,{'content-disposition':'attachment; filename="'+value.source.metadata.name.replace(/[^a-zA-Z0-9_.-]/g,'_')+'"'});
          }
          if (costFile[1] === 'edition' && costFile[3]) {
            const name=decodeURIComponent(costFile[3]),bytes=await model.economics.download(costFile[2],name);
            return reply(200,name.endsWith('.csv')?'text/csv; charset=utf-8':'application/json; charset=utf-8',bytes,
              {'content-disposition':'attachment; filename="'+name.replace(/[^a-zA-Z0-9_.-]/g,'_')+'"'});
          }
          if (costFile[1] === 'export' && !costFile[3]) {
            const file=await model.economics.exportFile(costFile[2]),opened=await openBundleDownload(file);
            try{
              res.writeHead(200,{'content-type':'application/x-tar','content-length':String(file.bytes),
                'content-disposition':'attachment; filename="'+file.filename+'"','cache-control':'no-store',
                'x-content-type-options':'nosniff','referrer-policy':'no-referrer','cross-origin-resource-policy':'same-origin',
                'content-security-policy':POLICY});
              if(req.method==='HEAD')res.end();else await pipeline(opened.stream(),res);
            }finally{await opened.close();}
            return;
          }
          throw fault('NOT_FOUND','Cost file not found.',404);
        }
        if (url.pathname === '/api/state') return json(200,{...await model.state(),token});
        if (url.pathname === '/api/planning/state') return json(200,await planning.list());
        const match = /^\/(files|repricing-files|planning-files)\/([a-f0-9-]{36})\/(.+)$/.exec(url.pathname);
        if (match) {
          const name = decodeURIComponent(match[3]);
          const bytes = await (match[1] === 'planning-files' ? planning.download(match[2],name)
            : match[1] === 'repricing-files' ? model.downloadRepricing(match[2],name)
            : model.download(match[2],name)), last = name.split('/').at(-1);
          const html = name.endsWith('.html');
          const type = html ? 'text/html; charset=utf-8' : name.endsWith('.json')
            ? 'application/json; charset=utf-8' : name.endsWith('.csv') ? 'text/csv; charset=utf-8' : 'application/octet-stream';
          return reply(200,type,bytes,{'content-security-policy':REPORT_POLICY,
            ...(html ? {} : {'content-disposition':`attachment; filename="${last.replace(/[^a-zA-Z0-9_.-]/g,'_')}"`})});
        }
        throw fault('NOT_FOUND','Workspace page not found.',404);
      }
      if (req.method !== 'POST') return reply(405,'text/plain','Use GET or POST.',{allow:'GET, HEAD, POST'});
      const upload = /^\/api\/economics\/uploads\/([a-f0-9-]{36})$/.exec(url.pathname);
      if (upload) {
        authorize();let metadata;
        const header=req.headers['x-sf97-source'];
        if(typeof header!=='string'||header.length>12000)throw fault('SOURCE_METADATA_REQUIRED','Provide the original source metadata header.');
        try{metadata=JSON.parse(decodeURIComponent(header));}catch{throw fault('SOURCE_METADATA_INVALID','Source metadata header is invalid.');}
        return json(200,await model.economics.upload({requestId:upload[1],metadata,body:req}));
      }
      const input = await body(url.pathname.startsWith('/api/economics/') ? 32*1024*1024 : 2*1024*1024);
      const costActions = {
        '/api/economics/list':()=>model.economics.list(input),
        '/api/economics/pricing':()=>model.economics.pricing(input.version),
        '/api/economics/source-inspect':()=>model.economics.inspectSource(input.sourceId,input),
        '/api/economics/map-charges':()=>model.economics.mapCharges(input),
        '/api/economics/capture':()=>model.economics.capture(input),
        '/api/economics/weights':()=>model.economics.weights(input),
        '/api/economics/preview':()=>model.economics.preview(input),
        '/api/economics/save':()=>model.economics.save(input),
        '/api/economics/edition':()=>model.economics.edition(input.edition),
        '/api/economics/compare':()=>model.economics.compare(input),
        '/api/economics/proposal':()=>model.economics.proposal(input),
        '/api/economics/apply-pricing':()=>model.economics.applyPricing(input),
        '/api/economics/export':()=>model.economics.bundle(input),
      };
      if(Object.hasOwn(costActions,url.pathname))return json(200,await costActions[url.pathname]());
      if (url.pathname === '/api/planning/source') return json(200,await planning.source(input.version));
      if (url.pathname === '/api/planning/preview') return json(200,await planning.preview(input));
      if (url.pathname === '/api/planning/save') return json(200,await planning.save(input));
      if (url.pathname === '/api/planning/load') return json(200,await planning.load(input.planId));
      if (url.pathname === '/api/planning/apply') return json(200,await planning.selection(input));
      if (url.pathname === '/api/source') return json(200,{...await model.state(input.selection),token});
      if (url.pathname === '/api/preview') return json(200,await model.preview(input));
      if (url.pathname === '/api/save') return json(200,await model.save(input));
      if (url.pathname === '/api/load-version') return json(200,await model.loadVersion(input.version));
      if (url.pathname === '/api/compare') return json(200,await model.compare(input));
      if (url.pathname === '/api/repricing/source') return json(200,await model.repricingSource(input.version));
      if (url.pathname === '/api/repricing/preview') return json(200,await model.previewRepricing(input));
      if (url.pathname === '/api/repricing/save') return json(200,await model.saveRepricing(input));
      if (url.pathname === '/api/repricing/stage') return json(200,await model.stageRepricing(input));
      throw fault('NOT_FOUND','Workspace operation not found.',404);
    })().catch(error => json(error.status ?? (error instanceof TypeError || error instanceof RangeError ? 422 : 500),
      {code:error.code ?? 'WORKSPACE_OPERATION_FAILED',
        message:error.status || error instanceof TypeError || error instanceof RangeError ? error.message : 'Workspace operation failed. Check the configured private source and state directory.'}));
  });
  server.requestTimeout = 20000; server.headersTimeout = 10000; server.keepAliveTimeout = 2000;
  await new Promise((done,fail) => {
    const onError = error => { server.removeListener('listening',onListen); fail(error); };
    const onListen = () => { server.removeListener('error',onError); done(); };
    server.once('error',onError); server.once('listening',onListen); server.listen(port,'127.0.0.1');
  });
  const assigned = server.address().port;
  hosts = new Set([`127.0.0.1:${assigned}`,`localhost:${assigned}`]);
  origins = new Set([...hosts].map(host => `http://${host}`));
  let closing;
  return {url:`http://127.0.0.1:${assigned}`,planningUrl:`http://127.0.0.1:${assigned}/planning`,server,model,planning,
    close() { return closing ??= new Promise((done,fail) => {
      server.close(error => error ? fail(error) : done()); server.closeIdleConnections?.();
    }); }};
}

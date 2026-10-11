// MIT. Loopback browser controls for the original operator runbook.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomBytes, timingSafeEqual} from 'node:crypto';
import {pipeline} from 'node:stream/promises';
import {openRunbookWorkspace, fault} from './workspace-model.mjs';
import {OPERATION_HANDOFF_MAX_BYTES} from '../sf88-operator-buyer-cli/operation-handoff.mjs';

const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
const messages = {
  DRAFT_CHANGED_RELOAD:'This draft changed in another window. Reopen it before saving.',
  RUNBOOK_METADATA_LOCK_EXISTS:'Another workspace process is saving or initializing a draft. Reopen this plan when it finishes.',
  RUNBOOK_REVIEW_CHANGED:'A selected config or body changed after review. Save and review a new draft revision.',
  CONTROLLING_TERMINAL_REQUIRED:'Start this workspace in the operator terminal. The original buyer asks for approval there.',
  WORKSPACE_EXECUTION_BUSY:'An acquisition is already running in this workspace.',
  RUNBOOK_EXECUTION_LOCK_EXISTS:'This acquisition has an execution owner. Inspect its current state before recovery.',
  EXECUTION_CHANGED_RELOAD:'That execution has finished or changed. Refresh the acquisition.',
  ACQUISITION_ALREADY_INITIALIZED:'This plan already has an acquisition. Open its saved run to continue.',
  CONFIG_OUTSIDE_SELECTED_DIRECTORY:'Select a config from the directory used to start this workspace.',
  RESOURCE_BYTES_CHANGED:'The saved file differs from its original buyer result.',
  LOCK_OWNER_IS_STILL_RUNNING:'The original execution owner is still running.',
  NATIVE_BUYER_IS_STILL_RUNNING:'The original buyer process is still running.',
  REQUEST_OPERATOR_PRESET_REQUIRED:'Start this workspace with its local operator settings file to prepare received requests.',
  REQUEST_OPERATOR_SETTINGS_CHANGED:'The local operator settings changed. Review this request again before preparing it.',
  REQUEST_REVIEW_CHANGED:'The selected request review changed. Reopen it and review the current payment option and budget.',
  REQUEST_ALREADY_PREPARED:'This request already has a local buyer configuration. Open the prepared request to continue.',
  REQUEST_BUDGET_OUTSIDE_OPERATOR_LIMITS:'The daily budget must cover this request and fit within both the total budget and the local operator limits.',
  REQUEST_OPERATOR_SETUP_CHANGED:'The retained buyer configuration or operator keys need local attention before this operation can start.',
  OPERATION_TICKET_EXPIRED:'This merchant operation ticket has expired. Request a current operation from the merchant.',
};

export async function startRunbookWorkspace({port = 8460, ...options} = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw fault('INVALID_PORT');
  const model = await openRunbookWorkspace(options), token = randomBytes(32).toString('hex');
  const assets = new Map(await Promise.all([
    ['/', 'index.html','text/html; charset=utf-8'],
    ['/app.mjs','app.mjs','text/javascript; charset=utf-8'],
    ['/intake.mjs','intake.mjs','text/javascript; charset=utf-8'],
    ['/style.css','style.css','text/css; charset=utf-8'],
  ].map(async ([path,name,type]) => [path,{type,bytes:await readFile(new URL('workspace-ui/' + name,import.meta.url))}])));
  let hosts = new Set(), origins = new Set(), closing = false;
  const reading = new Set();
  const headers = {'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer',
    'cross-origin-resource-policy':'same-origin','content-security-policy':CSP};
  const server = createServer((req,res) => {
    function reply(status,type,data,extra = {}) {
      if (res.destroyed) return;
      const bytes = Buffer.isBuffer(data) ? data : Buffer.from(typeof data === 'string' ? data : JSON.stringify(data));
      res.writeHead(status,{...headers,'content-type':type,'content-length':String(bytes.length),...extra});
      res.end(req.method === 'HEAD' ? undefined : bytes);
    }
    const json = (status,value) => reply(status,'application/json; charset=utf-8',value);
    async function body(limit = 1024 * 1024) {
      const provided = Buffer.from(String(req.headers['x-runbook-session'] ?? ''));
      const expected = Buffer.from(token);
      if (provided.length !== expected.length || !timingSafeEqual(provided,expected)) throw fault('WORKSPACE_SESSION_REQUIRED',403);
      if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') throw fault('JSON_REQUIRED',415);
      if (Number(req.headers['content-length'] ?? 0) > limit) throw fault('REQUEST_TOO_LARGE',413);
      const chunks = []; let length = 0;
      reading.add(req);
      try {
        for await (const chunk of req) {
          length += chunk.length;
          if (length > limit) throw fault('REQUEST_TOO_LARGE',413);
          chunks.push(chunk);
        }
      } finally { reading.delete(req); }
      try {
        const value = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
        return value;
      } catch { throw fault('INVALID_JSON'); }
    }
    (async () => {
      if (closing) throw fault('WORKSPACE_CLOSING',503);
      if (!hosts.has(req.headers.host) || req.headers.origin && !origins.has(req.headers.origin) ||
          ['cross-site','same-site'].includes(req.headers['sec-fetch-site'])) throw fault('WORKSPACE_ORIGIN_REQUIRED',403);
      const url = new URL(req.url,`http://${req.headers.host}`);
      if (url.search || url.hash) throw fault('INVALID_WORKSPACE_URL');
      const key = '(draft-[a-f0-9-]{36}|import-[a-f0-9]{32})';
      if (req.method === 'GET' || req.method === 'HEAD') {
        const asset = assets.get(url.pathname);
        if (asset) return reply(200,asset.type,asset.bytes);
        if (url.pathname === '/api/state') return json(200,{...await model.state(),token});
        let match = /^\/api\/requests\/(request-[a-f0-9]{64})$/.exec(url.pathname);
        if (match) return json(200,await model.request(match[1]));
        match = /^\/files\/requests\/(request-[a-f0-9]{64})\/(body|handoff)$/.exec(url.pathname);
        if (match) {
          const result = await model.requestAttachment(match[1],match[2]);
          return reply(200,'application/octet-stream',result.bytes,
            {'content-disposition':`attachment; filename="${result.name}"`});
        }
        match = new RegExp('^/api/drafts/' + key + '(?:/([1-9][0-9]*))?$').exec(url.pathname);
        if (match) return json(200,await model.draft(match[1],match[2] ? Number(match[2]) : undefined));
        match = new RegExp('^/api/runs/' + key + '$').exec(url.pathname);
        if (match) return json(200,await model.run(match[1]));
        match = new RegExp('^/api/runs/' + key + '/resources/([A-Za-z0-9][A-Za-z0-9_-]{0,63})$').exec(url.pathname);
        if (match) return json(200,await model.previewResource(match[1],match[2]));
        match = new RegExp('^/files/' + key + '/report\\.(json|html)$').exec(url.pathname);
        if (match) {
          const result = await model.export(match[1],match[2]);
          return reply(200,match[2] === 'json' ? 'application/json' : 'text/html',result.bytes,
            {'content-disposition':`attachment; filename="${result.name.replace(/[^a-zA-Z0-9_.-]/g,'_')}"`});
        }
        match = new RegExp('^/files/' + key + '/resources/([A-Za-z0-9][A-Za-z0-9_-]{0,63})$').exec(url.pathname);
        if (match) {
          const result = await model.download(match[1],match[2]);
          res.writeHead(200,{...headers,'content-type':'application/octet-stream','content-length':String(result.bytes),
            'content-disposition':`attachment; filename="${result.name}"`,'x-content-sha256':result.sha256});
          if (req.method === 'HEAD') { await result.file.close(); return res.end(); }
          try { await pipeline(result.file.createReadStream({start:0,autoClose:true}),res); }
          finally { await result.file.close().catch(() => {}); }
          return;
        }
        throw fault('NOT_FOUND',404);
      }
      if (req.method !== 'POST') return reply(405,'text/plain','Use GET or POST.',{allow:'GET, HEAD, POST'});
      const input = await body(url.pathname === '/api/requests/upload' ? 4*Math.ceil(OPERATION_HANDOFF_MAX_BYTES/3)+1024 : 1024 * 1024);
      if (url.pathname === '/api/requests/upload') return json(200,await model.receiveRequest(input));
      if (url.pathname === '/api/requests/review') return json(200,await model.reviewRequest(input));
      if (url.pathname === '/api/requests/prepare') return json(200,await model.prepareRequest(input));
      if (url.pathname === '/api/drafts/save') return json(200,await model.save(input));
      if (url.pathname === '/api/drafts/initialize') return json(200,await model.initialize(input));
      const actions = {'/api/runs/execute':'execute','/api/runs/cancel':'cancel','/api/runs/recover':'recover','/api/runs/unlock':'unlock'};
      const action = actions[url.pathname];
      if (action) return json(action === 'execute' ? 202 : 200,await model[action](input));
      throw fault('NOT_FOUND',404);
    })().catch(error => {
      if (res.headersSent) { if (!res.writableEnded) res.destroy(); return; }
      const code = /^[A-Z0-9_]{1,120}$/.test(error?.code ?? '') ? error.code : 'WORKSPACE_LOCAL_ERROR';
      const status = error.status ?? (error.code === 'ENOENT' ? 404 : error.code === 'EEXIST' || error.code === 'RUNBOOK_METADATA_LOCK_EXISTS' ? 409 : ['InputError','OperationTicketError'].includes(error.name) ? 422 : 500);
      json(status,{code,message:messages[code] ?? (status === 500 ? 'Check the configured private source and state directory.' : code.toLowerCase().replaceAll('_',' ') + '.')});
    });
  });
  server.requestTimeout = 20000; server.headersTimeout = 10000; server.keepAliveTimeout = 2000;
  await new Promise((done,fail) => {
    const onError = error => { server.off('listening',onListen); fail(error); };
    const onListen = () => { server.off('error',onError); done(); };
    server.once('error',onError); server.once('listening',onListen); server.listen(port,'127.0.0.1');
  });
  const assigned = server.address().port;
  hosts = new Set([`127.0.0.1:${assigned}`,`localhost:${assigned}`]);
  origins = new Set([...hosts].map(host => `http://${host}`));
  let closePromise;
  return {url:`http://127.0.0.1:${assigned}`,server,model,
    close() { return closePromise ??= (async () => {
      closing = true;
      const stopped = new Promise((done,fail) => server.close(error => error ? fail(error) : done()));
      for (const request of reading) request.destroy();
      server.closeIdleConnections?.();
      await model.close(); server.closeAllConnections?.(); await stopped;
    })(); }};
}

// MIT. Loopback browser controls for the original operator runbook.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomBytes, timingSafeEqual} from 'node:crypto';
import {pipeline} from 'node:stream/promises';
import {openRunbookWorkspace, fault} from './workspace-model.mjs';
import {OPERATION_HANDOFF_MAX_BYTES} from '../sf88-operator-buyer-cli/operation-handoff.mjs';
import {CLIENT_FILE_UPLOAD_MAX_BYTES,CLIENT_REQUEST_UPLOAD_MAX_BYTES} from './client-intake.mjs';

const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
const messages = {
  DRAFT_CHANGED_RELOAD:'This draft changed in another window. Reopen it before saving.',
  RUNBOOK_METADATA_LOCK_EXISTS:'Another workspace process is saving or initializing a draft. Reopen this plan when it finishes.',
  RUNBOOK_REVIEW_CHANGED:'A selected config or body changed after review. Save and review a new draft revision.',
  CONTROLLING_TERMINAL_REQUIRED:'Start this workspace in the operator terminal. The original buyer asks for approval there.',
  WORKSPACE_EXECUTION_BUSY:'An acquisition is already running in this workspace.',
  WORKSPACE_RECOVERY_BUSY:'This workspace is capturing or checking its recovery archive.',
  RUNBOOK_RECOVERY_REVIEW_CHANGED:'The selected recovery state changed. Review the current operators and acquisitions again.',
  RUNBOOK_RECOVERY_DEPENDENCY_OUTSIDE_ROOT:'Choose the original private parent containing the workspace, configurations, operator settings, operators and retained outputs.',
  WORKSPACE_RECOVERY_UNSELECTED_OPERATOR_LEDGER:'An original operator ledger was not selected. Review the complete operator list before capture.',
  WORKSPACE_RECOVERY_PASSPHRASE_REQUIRED:'Set the separate backup passphrase in the selected environment variable of the process that starts this workspace.',
  WORKSPACE_RECOVERY_QUIESCED_SOURCE_REQUIRED:'Confirm that other programs writing these original operators are stopped. This workspace locks its own acquisitions during capture.',
  WORKSPACE_RECOVERY_ARCHIVE_EXISTS:'That archive path already exists. Verify the retained archive or choose a new output path.',
  WORKSPACE_RECOVERY_ARCHIVE_OVERLAPS_STATE:'Choose an archive destination outside the selected original state root.',
  RUNBOOK_EXECUTION_LOCK_EXISTS:'This acquisition has an execution owner. Inspect its current state before recovery.',
  EXECUTION_CHANGED_RELOAD:'That execution has finished or changed. Refresh the acquisition.',
  ACQUISITION_ALREADY_INITIALIZED:'This plan already has an acquisition. Open its saved run to continue.',
  CONFIG_OUTSIDE_SELECTED_DIRECTORY:'Select a config from the directory used to start this workspace.',
  RESOURCE_BYTES_CHANGED:'The saved file differs from its original buyer result.',
  LOCK_OWNER_IS_STILL_RUNNING:'The original execution owner is still running.',
  NATIVE_BUYER_IS_STILL_RUNNING:'The original buyer process is still running.',
  CLIENT_RECEIVE_INCOMPLETE:'Upload the five files named in this original completion receipt before preparing a request.',
  CLIENT_RECEIVE_MANIFEST_CHANGED:'The retained SDK differs from the receipt you reviewed. Reopen the original customer export.',
  CLIENT_RECEIVE_FILE_CHANGED:'This file differs from the original completion receipt. Select the merchant’s exact file.',
  CLIENT_RECEIVE_BODY_CHOICE_REQUIRED:'Choose the declared request body or explicitly omit an optional body.',
  CLIENT_RECEIVE_PATH_VALUES_REQUIRED:'Fill every declared path parameter using its original name.',
  CLIENT_RECEIVE_QUERY_VALUES_REQUIRED:'Supply query parameters as a JSON object of strings or arrays of strings.',
  OPERATION_HANDOFF_RETAINED_INPUT_CHANGED:'The retained request input changed. Reopen its original source before resuming setup.',
  REQUEST_OPERATOR_PRESET_REQUIRED:'Start this workspace with its local operator settings file to prepare received requests.',
  REQUEST_OPERATOR_SETTINGS_CHANGED:'The local operator settings changed. Review this request again before preparing it.',
  REQUEST_REVIEW_CHANGED:'The selected request review changed. Reopen it and review the current payment option and budget.',
  REQUEST_ALREADY_PREPARED:'This request already has a local buyer configuration. Open the prepared request to continue.',
  REQUEST_BUDGET_OUTSIDE_OPERATOR_LIMITS:'The daily budget must cover this request and fit within both the total budget and the local operator limits.',
  REQUEST_OPERATOR_SETUP_CHANGED:'The retained buyer configuration or operator keys need local attention before this operation can start.',
  PAID_FILE_MERCHANT_ORDER_CHANGED:'This merchant order already has a different retained promise. Open the original order and ask the merchant to reconcile its order reference.',
  PAID_FILE_REVIEW_CHANGED:'This file-order review changed. Reopen the order and use its current saved review.',
  PAID_FILE_ALREADY_PREPARING:'This order already has a retained buyer setup. Reopen it to resume or use that buyer.',
  PAID_FILE_OPERATOR_CHANGED:'The retained buyer source changed. Restore this order’s original operator and source configuration.',
  PAID_FILE_TRANSPORT_CHANGED:'This order’s buyer transport changed. Restore the transport selected in its saved local review.',
  PAID_FILE_CLAIM_ENVS_CHANGED:'Reopen with the same declared claim environment names, or omit --claim-envs to reuse them.',
  PAID_FILE_SELECTED_REQUEST_CHANGED:'The selected order or acquisition changed. Refresh the acquisition before retrieving its file.',
  PAID_FILE_DOWNLOAD_CHANGED:'The saved customer file changed. Inspect the original transfer and restore the promised file bytes.',
  RUNBOOK_ACCOUNTING_WORKSPACE_REQUIRED:'Select the existing SF88 operator workspace for this operation. Requests received here reuse their retained original operator automatically.',
  RUNBOOK_ACCOUNTING_ORIGINAL_WORKSPACE_REQUIRED:'That workspace has a different original payer, ledger, transport or payment terms. Select this request’s original operator workspace.',
  RUNBOOK_ACCOUNTING_ORIGINAL_ATTEMPT_REQUIRED:'This operation needs its original recorded buyer attempt before accounting can finish.',
  OPERATION_TICKET_EXPIRED:'This merchant operation ticket has expired. Request a current operation from the merchant.',
};

export async function startRunbookWorkspace({port = 8460, ...options} = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw fault('INVALID_PORT');
  const model = await openRunbookWorkspace(options), token = randomBytes(32).toString('hex');
  const assets = new Map(await Promise.all([
    ['/', 'index.html','text/html; charset=utf-8'],
    ['/app.mjs','app.mjs','text/javascript; charset=utf-8'],
    ['/intake.mjs','intake.mjs','text/javascript; charset=utf-8'],
    ['/clients.mjs','clients.mjs','text/javascript; charset=utf-8'],
    ['/paid-files.mjs','paid-files.mjs','text/javascript; charset=utf-8'],
    ['/accounting.mjs','accounting.mjs','text/javascript; charset=utf-8'],
    ['/recovery.mjs','recovery.mjs','text/javascript; charset=utf-8'],
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
        let match=/^\/api\/clients\/(client-[a-f0-9]{64})$/.exec(url.pathname);
        if(match)return json(200,await model.client(match[1]));
        match=/^\/files\/clients\/(client-[a-f0-9]{64})\/(client-export\.json|seller-client\.mjs|seller-client\.d\.mts|seller-openapi\.json|package\.json|README\.md)$/.exec(url.pathname);
        if(match) {
          const result=await model.clientAttachment(match[1],match[2]);
          return reply(200,'application/octet-stream',result.bytes,{'content-disposition':'attachment; filename="'+result.name+'"',
            'x-content-sha256':result.sha256});
        }
        match = /^\/api\/paid-files\/(file-[a-f0-9]{64})$/.exec(url.pathname);
        if(match)return json(200,await model.paidFile(match[1]));
        match = /^\/files\/paid-files\/(file-[a-f0-9]{64})\/handoff$/.exec(url.pathname);
        if(match) {
          const result=await model.paidFileAttachment(match[1]);
          return reply(200,'application/json',result.bytes,{'content-disposition':`attachment; filename="${result.name}"`});
        }
        match = new RegExp('^/files/'+key+'/paid-files/([A-Za-z0-9][A-Za-z0-9_-]{0,63})$').exec(url.pathname);
        if(match) {
          const result=await model.downloadPaidFile(match[1],match[2]);
          res.writeHead(200,{...headers,'content-type':'application/octet-stream','content-length':String(result.bytes),
            'content-disposition':`attachment; filename="${result.name}"`,'x-content-sha256':result.sha256});
          if(req.method==='HEAD'){await result.file.close();return res.end();}
          try {await pipeline(result.file.createReadStream({start:0,autoClose:true}),res);}
          finally {await result.file.close().catch(()=>{});}return;
        }
        match = /^\/api\/requests\/(request-[a-f0-9]{64})$/.exec(url.pathname);
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
        match = new RegExp('^/files/' + key + '/accounting\\.csv$').exec(url.pathname);
        if(match){
          const result=await model.export(match[1],'csv');
          return reply(200,'text/csv; charset=utf-8',result.bytes,
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
      const limit=url.pathname==='/api/clients/file'?CLIENT_FILE_UPLOAD_MAX_BYTES:
        url.pathname==='/api/clients/request'?CLIENT_REQUEST_UPLOAD_MAX_BYTES:
        url.pathname==='/api/requests/upload'?4*Math.ceil(OPERATION_HANDOFF_MAX_BYTES/3)+1024:1024*1024;
      const input=await body(limit);
      if(url.pathname==='/api/clients/upload')return json(200,await model.receiveClient(input));
      if(url.pathname==='/api/clients/file')return json(200,await model.uploadClientFile(input));
      if(url.pathname==='/api/clients/request')return json(200,await model.composeClientRequest(input));
      if (url.pathname === '/api/recovery/review') return json(200,await model.inspectRecovery(input));
      if (url.pathname === '/api/recovery/start') return json(202,await model.startRecovery(input));
      if (url.pathname === '/api/recovery/cancel') return json(200,await model.cancelRecovery(input));
      if (url.pathname === '/api/requests/upload') return json(200,await model.receiveRequest(input));
      if (url.pathname === '/api/requests/review') return json(200,await model.reviewRequest(input));
      if (url.pathname === '/api/requests/prepare') return json(200,await model.prepareRequest(input));
      if (url.pathname === '/api/paid-files/upload') return json(200,await model.receivePaidFile(input));
      if (url.pathname === '/api/paid-files/review') return json(200,await model.reviewPaidFile(input));
      if (url.pathname === '/api/paid-files/prepare') return json(200,await model.preparePaidFile(input));
      if (url.pathname === '/api/drafts/save') return json(200,await model.save(input));
      if (url.pathname === '/api/drafts/initialize') return json(200,await model.initialize(input));
      const actions = {'/api/runs/execute':'execute','/api/runs/cancel':'cancel','/api/runs/recover':'recover',
        '/api/runs/unlock':'unlock','/api/runs/finalize':'finalize','/api/runs/accounting-workspace':'bindAccounting',
        '/api/runs/retrieve-file':'retrievePaidFile','/api/runs/reset-file-transfer':'resetPaidFile'};
      const action = actions[url.pathname];
      if (action) return json(['execute','finalize','retrievePaidFile','resetPaidFile'].includes(action) ? 202 : 200,await model[action](input));
      throw fault('NOT_FOUND',404);
    })().catch(error => {
      if (res.headersSent) { if (!res.writableEnded) res.destroy(); return; }
      const code = /^[A-Z0-9_]{1,120}$/.test(error?.code ?? '') ? error.code : 'WORKSPACE_LOCAL_ERROR';
      const status = error.status ?? (error.code === 'ENOENT' ? 404 : error.code === 'EEXIST' || error.code === 'RUNBOOK_METADATA_LOCK_EXISTS' ? 409 : ['InputError','OperationTicketError'].includes(error.name) || code.startsWith('CLIENT_EXPORT_') ? 422 : 500);
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

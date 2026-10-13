// MIT. Original loopback/capability pattern applied to the runtime operator workflow.
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { transferOperationFields } from './transfer-workspace.mjs';
import { MAX_MANIFEST_BYTES } from '../runtime-transfer-lock.mjs';
import { imageOperationFields } from './image-workspace.mjs';
import { managedOperationFields } from './managed-workspace.mjs';
import { pythonOperationFields } from '../python-runtime/workspace.mjs';
import { sourceBuildOperationFields } from './source-build-workspace.mjs';
import { PRODUCT_PLAN_MAX_BYTES } from './source-product-plans.mjs';
import { openRuntimeWorkspace } from './model.mjs';
import { OPENAPI_SETUP_ROUTES, openApiSetupBodyLimit } from './openapi-connection-setup.mjs';
import { plain, need, fail, runtimeWorkspaceError } from './storage.mjs';
import { RUNTIME_PROCEDURE_BODY_MAX_BYTES } from './operating-procedures.mjs';

const HOST = '127.0.0.1';
const security = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  'referrer-policy': 'no-referrer', 'cross-origin-resource-policy': 'same-origin' };
async function body(req, allowed, maximum = 32768) {
  need((req.headers['content-type'] ?? '').split(';')[0].trim() === 'application/json',
    'RUNTIME_WORKSPACE_JSON_REQUIRED', undefined, 415);
  const chunks = []; let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length; need(bytes <= maximum, 'RUNTIME_WORKSPACE_REQUEST_TOO_LARGE', undefined, 413); chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks)); } catch { fail('RUNTIME_WORKSPACE_JSON_INVALID'); }
  need(plain(value) && Object.keys(value).every(key => allowed.includes(key)), 'RUNTIME_WORKSPACE_FIELDS_INVALID');
  return value;
}
function params(url, allowed) {
  need([...url.searchParams.keys()].every(key => allowed.includes(key) && url.searchParams.getAll(key).length === 1),
    'RUNTIME_WORKSPACE_QUERY_INVALID');
  return Object.fromEntries(url.searchParams);
}

export async function startRuntimeWorkspace({ directory, port = 8465, openApiSetupPolicy = {} } = {}) {
  need(Number.isInteger(port) && port >= 0 && port <= 65535, 'RUNTIME_WORKSPACE_PORT_INVALID');
  const model = await openRuntimeWorkspace({ directory, openApiSetupPolicy });
  const token = randomBytes(32).toString('hex'), tokenBytes = Buffer.from(token);
  const assets = new Map(await Promise.all([
    ['/', 'index.html', 'text/html; charset=utf-8'],
    ['/app.mjs', 'app.mjs', 'text/javascript; charset=utf-8'],
    ['/operation-history.mjs', 'operation-history.mjs', 'text/javascript; charset=utf-8'],
    ['/operation-history-model.mjs', 'operation-history-model.mjs', 'text/javascript; charset=utf-8'],
    ['/managed.mjs', 'managed.mjs', 'text/javascript; charset=utf-8'],
    ['/applications.mjs', 'applications.mjs', 'text/javascript; charset=utf-8'],
    ['/application-output.mjs', 'application-output.mjs', 'text/javascript; charset=utf-8'],
    ['/runtime-output.mjs', 'runtime-output.mjs', 'text/javascript; charset=utf-8'],
    ['/workbook-results.mjs', 'workbook-results.mjs', 'text/javascript; charset=utf-8'],
    ['/application-library.mjs', 'application-library.mjs', 'text/javascript; charset=utf-8'],
    ['/application-inputs.mjs', 'application-inputs.mjs', 'text/javascript; charset=utf-8'],
    ['/application-input-sets.mjs', 'application-input-sets.mjs', 'text/javascript; charset=utf-8'],
    ['/application-input-set-editions.mjs', 'application-input-set-editions.mjs', 'text/javascript; charset=utf-8'],
    ['/application-input-sets.css', 'application-input-sets.css', 'text/css; charset=utf-8'],
    ['/application-input-set-format.mjs', 'application-input-set-format.mjs', 'text/javascript; charset=utf-8'],
    ['/application-drafts.mjs', 'application-drafts.mjs', 'text/javascript; charset=utf-8'],
    ['/application-review.mjs', 'application-review.mjs', 'text/javascript; charset=utf-8'],
    ['/openapi-application.mjs', 'openapi-application.mjs', 'text/javascript; charset=utf-8'],
    ['/accounting-application.mjs', 'accounting-application.mjs', 'text/javascript; charset=utf-8'],
    ['/openapi-connection-setup.mjs', 'openapi-connection-setup.mjs', 'text/javascript; charset=utf-8'],
    ['/style.css', 'style.css', 'text/css; charset=utf-8'],
    ['/transfer.mjs', 'transfer.mjs', 'text/javascript; charset=utf-8'],
    ['/workspace-receiving.mjs', 'workspace-receiving.mjs', 'text/javascript; charset=utf-8'],
    ['/operating-procedures.mjs', 'operating-procedures.mjs', 'text/javascript; charset=utf-8'],
    ['/image.mjs', 'image.mjs', 'text/javascript; charset=utf-8'],
    ['/python.mjs', 'python.mjs', 'text/javascript; charset=utf-8'],
    ['/source-build.mjs', 'source-build.mjs', 'text/javascript; charset=utf-8'],
    ['/product-plan-briefing.css', 'product-plan-briefing.css', 'text/css; charset=utf-8'],
  ].map(async ([path, name, type]) => [path, { bytes: await readFile(new URL('./public/' + name, import.meta.url)), type }])));
  assets.set('/product-catalog/catalog.mjs', {
    bytes: await readFile(new URL('../product-catalog/catalog.mjs', import.meta.url)),
    type: 'text/javascript; charset=utf-8',
  });
  assets.set('/product-plan-runtime.mjs', {
    bytes: await readFile(new URL('./product-plan-runtime.mjs', import.meta.url)),
    type: 'text/javascript; charset=utf-8',
  });
  assets.set('/product-requirements.mjs', {
    bytes: await readFile(new URL('../discovery/product-requirements.mjs', import.meta.url)),
    type: 'text/javascript; charset=utf-8',
  });
  assets.set('/source-catalog.css', {
    bytes: await readFile(new URL('./public/source-catalog.css', import.meta.url)),
    type: 'text/css; charset=utf-8',
  });
  for (const name of ['operating-plan.mjs','operating-plan-return.mjs','catalog.mjs'])
    assets.set('/'+name,{bytes:await readFile(new URL('../discovery/'+name,import.meta.url)),type:'text/javascript; charset=utf-8'});
  assets.set('/runtime-procedures-guide',{bytes:await readFile(new URL('./RUNTIME_PROCEDURES.md',import.meta.url)),type:'text/markdown; charset=utf-8'});
  let origin, host, closing = false;
  const workspaceBackupDownloads = new Map(), applicationOutputDownloads = new Map(), runtimeOutputDownloads = new Map();
  const applicationInputDownloads = new Map();
  const sockets = new Set(), imageDownloads = new Map(), transferDownloads = new Map(), pythonDownloads = new Map(), sourceBuildDownloads = new Map(), workbookDownloads = new Map();
  const server = createServer(async (req, res) => {
    const reply = (status, type, bytes, headers = {}) => {
      if (res.headersSent || res.destroyed) return;
      const data = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
      res.writeHead(status, { ...security, 'content-type': type, 'content-length': data.length, ...headers });
      res.end(req.method === 'HEAD' ? undefined : data);
    };
    const send = (status, value) => reply(status, 'application/json; charset=utf-8', JSON.stringify(value));
    try {
      need(req.headers.host === host && (!req.headers.origin || req.headers.origin === origin) &&
        !['cross-site', 'same-site'].includes(req.headers['sec-fetch-site']), 'RUNTIME_WORKSPACE_ORIGIN_REQUIRED', undefined, 403);
      need(req.url?.startsWith('/') && !req.url.startsWith('//'), 'RUNTIME_WORKSPACE_TARGET_INVALID');
      const url = new URL(req.url, origin);
      if (['GET', 'HEAD'].includes(req.method) && assets.has(url.pathname) && !url.search) {
        const asset = assets.get(url.pathname); return reply(200, asset.type, asset.bytes);
      }
      need(!closing, 'RUNTIME_WORKSPACE_CLOSED', undefined, 409);
      if (req.method === 'GET' && /^\/image-download\/[a-f0-9]{64}$/.test(url.pathname) && !url.search) {
        const key = url.pathname.split('/').at(-1), selected = imageDownloads.get(key);
        imageDownloads.delete(key);
        need(selected && selected.expires > Date.now(), 'RUNTIME_IMAGE_DOWNLOAD_EXPIRED', 'Request a new download from the open workspace', 410);
        const file = await model.imagesDownload(selected.input);
        try {
          res.writeHead(200, { ...security, 'content-type': file.type, 'content-length': file.bytes,
            'content-disposition': 'attachment; filename="' + file.file + '"' });
          await pipeline(file.handle.createReadStream({ autoClose: false }), res);
        } finally { await file.handle.close(); }
        return;
      }
      if (req.method === 'GET' && /^\/transfer-download\/[a-f0-9]{64}$/.test(url.pathname) && !url.search) {
        const key = url.pathname.split('/').at(-1), selected = transferDownloads.get(key);
        transferDownloads.delete(key);
        need(selected && selected.expires > Date.now(), 'RUNTIME_TRANSFER_DOWNLOAD_EXPIRED', 'Request a new download from the open workspace', 410);
        const file = await model.transfersDownload(selected.input);
        try {
          res.writeHead(200, { ...security, 'content-type': file.type, 'content-length': file.bytes,
            'content-disposition': 'attachment; filename="' + file.file + '"' });
          await pipeline(file.handle.createReadStream({ autoClose: false }), res);
        } finally { await file.handle.close(); }
        return;
      }
      if (req.method === 'GET' && /^\/python-download\/[a-f0-9]{64}$/.test(url.pathname) && !url.search) {
        const key = url.pathname.split('/').at(-1), selected = pythonDownloads.get(key);
        pythonDownloads.delete(key);
        need(selected && selected.expires > Date.now(), 'PYTHON_DOWNLOAD_EXPIRED', 'Request this exact bundle again from the workspace.', 410);
        const file = await model.pythonDownload(selected.input);
        try {
          res.writeHead(200, { ...security, 'content-type': file.type, 'content-length': file.bytes,
            'content-disposition': 'attachment; filename="' + file.file + '"', etag: '"' + file.sha256 + '"' });
          await pipeline(file.handle.createReadStream({ autoClose: false, start: 0 }), res);
        } finally { await file.handle.close(); }
        return;
      }
      if (req.method === 'GET' && /^\/source-build-download\/[a-f0-9]{64}$/.test(url.pathname) && !url.search) {
        const key = url.pathname.split('/').at(-1), selected = sourceBuildDownloads.get(key);
        sourceBuildDownloads.delete(key);
        need(selected && selected.expires > Date.now(), 'SOURCE_BUILD_DOWNLOAD_EXPIRED', 'Request this package again from the workspace.', 410);
        const file = await model.sourceBuildsDownload(selected.reviewId);
        try {
          res.writeHead(200, { ...security, 'content-type': file.type, 'content-length': file.bytes,
            'content-disposition': 'attachment; filename="' + file.file + '"', etag: '"' + file.sha256 + '"' });
          await pipeline(file.handle.createReadStream({ autoClose: false, start: 0 }), res);
        } finally { await file.handle.close(); }
        return;
      }
      if (req.method === 'GET' && /^\/workbook-download\/[a-f0-9]{64}$/.test(url.pathname) && !url.search) {
        const key = url.pathname.split('/').at(-1), selected = workbookDownloads.get(key);
        workbookDownloads.delete(key);
        need(selected && selected.expires > Date.now(), 'WORKBOOK_DOWNLOAD_EXPIRED', 'Request this original workbook file again.', 410);
        const file = await model.applicationsWorkbookDownload(selected.input);
        try {
          res.writeHead(200, { ...security, 'content-type': file.type, 'content-length': file.bytes,
            'content-disposition': 'attachment; filename="' + file.file + '"', etag: '"' + file.sha256 + '"',
            'x-content-sha256': file.sha256 });
          await pipeline(file.handle.createReadStream({ autoClose: false, start: 0 }), res);
        } finally { await file.handle.close(); }
        return;
      }
      if (req.method === 'GET' && /^\/workspace-backup-download\/[a-f0-9]{64}$/.test(url.pathname) && !url.search) {
        const key = url.pathname.split('/').at(-1), selected = workspaceBackupDownloads.get(key);
        workspaceBackupDownloads.delete(key);
        need(selected && selected.expires > Date.now(), 'WORKSPACE_BACKUP_DOWNLOAD_EXPIRED',
          'Request the same saved backup again from the workspace.', 410);
        const file = await model.workspaceBackupDownload(selected.input);
        try {
          const filename = String(file.filename).replace(/[^A-Za-z0-9._-]/g, '_');
          res.writeHead(200, { ...security, 'content-type': file.type, 'content-length': file.bytes,
            'content-disposition': 'attachment; filename="' + filename + '"', etag: '"' + file.sha256 + '"' });
          await pipeline(file.stream, res);
        } finally { file.stream.destroy(); }
        return;
      }
      if (req.method === 'GET' && /^\/application-input-download\/[a-f0-9]{64}$/.test(url.pathname) && !url.search) {
        const key=url.pathname.split('/').at(-1),selected=applicationInputDownloads.get(key);
        applicationInputDownloads.delete(key);
        need(selected && selected.expires>Date.now(),'APPLICATION_INPUT_DOWNLOAD_EXPIRED','Request the original file again.',410);
        const file=await model.applicationInputDownload(selected.input);
        try {
          res.writeHead(200,{...security,'content-type':'application/octet-stream',
            'content-length':file.bytes,'content-disposition':'attachment; filename="'+file.filename+'"',
            'x-content-sha256':file.sha256});
          await pipeline(file.stream,res);
        } finally {file.stream.destroy();await file.close();}
        return;
      }
      if (req.method === 'GET' && /^\/application-output-download\/[a-f0-9]{64}$/.test(url.pathname) && !url.search) {
        const key = url.pathname.split('/').at(-1), selected = applicationOutputDownloads.get(key);
        applicationOutputDownloads.delete(key);
        need(selected && selected.expires > Date.now(), 'APPLICATION_OUTPUT_DOWNLOAD_EXPIRED',
          'Request the same selected output from the open workspace.', 410);
        const file = await model.applicationsOutputDownload(selected.input);
        try {
          res.writeHead(200, { ...security, 'content-type': file.type, 'content-length': file.bytes,
            'content-disposition': 'attachment; filename="' + file.filename + '"' });
          await pipeline(file.stream, res);
        } finally { file.stream.destroy(); await file.close(); }
        return;
      }
      if (req.method === 'GET' && /^\/runtime-output-download\/[a-f0-9]{64}$/.test(url.pathname) && !url.search) {
        const key = url.pathname.split('/').at(-1), selected = runtimeOutputDownloads.get(key);
        runtimeOutputDownloads.delete(key);
        need(selected && selected.expires > Date.now(), 'RUNTIME_OUTPUT_DOWNLOAD_EXPIRED',
          'Request the same selected output from the open workspace.', 410);
        const file = await model.runtimeOutputDownload(selected.input);
        try {
          res.writeHead(200, { ...security, 'content-type': file.type, 'content-length': file.bytes,
            'content-disposition': 'attachment; filename="' + file.filename + '"' });
          await pipeline(file.stream, res);
        } finally { file.stream.destroy(); await file.close(); }
        return;
      }
      const supplied = Buffer.from(typeof req.headers['x-runtime-workspace-token'] === 'string' ? req.headers['x-runtime-workspace-token'] : '');
      need(supplied.length === tokenBytes.length && timingSafeEqual(supplied, tokenBytes),
        'RUNTIME_WORKSPACE_CAPABILITY_REQUIRED', 'Open the current private URL printed by the workspace command', 401);
      if (req.method === 'GET' && url.pathname === '/api/runtime-procedures')
        return send(200,await model.runtimeProceduresState(params(url,['storageDirectory'])));
      if (req.method === 'POST' && url.pathname.startsWith('/api/runtime-procedures/')) {
        params(url,[]);
        const actions={
          read:['runtimeProcedureRead',['procedureId']],
          create:['runtimeProcedureCreate',['requestId','title','customer','owner','period','purpose','selection']],
          save:['runtimeProcedureSave',['requestId','procedureId','expectedSha256','draft']],
          record:['runtimeProcedureRecord',['requestId','procedureId','expectedSha256','stepId','status','recordedResult','owner','selection']],
          return:['runtimeProcedureReturn',['requestId','procedureId','expectedSha256','incoming','reviewer','notes']],
          decide:['runtimeProcedureDecide',['requestId','procedureId','expectedSha256','reviewId','key','decision']],
          apply:['runtimeProcedureApply',['requestId','procedureId','expectedSha256','reviewId']],
          receive:['runtimeProcedureReceive',['requestId','document']],
          export:['runtimeProcedureExport',['procedureId','format','reviewId']],
        };
        const action=url.pathname.slice('/api/runtime-procedures/'.length);
        need(Object.hasOwn(actions,action),'RUNTIME_PROCEDURE_ACTION',undefined,404);
        const [method,fields]=actions[action];
        return send(200,await model[method](await body(req,fields,RUNTIME_PROCEDURE_BODY_MAX_BYTES)));
      }
      if (req.method === 'GET' && url.pathname === '/api/workspace-backups/state')
        return send(200, await model.workspaceBackupState(params(url, ['storageDirectory'])));
      if (req.method === 'GET' && url.pathname === '/api/source-builds/plans') {
        const value = params(url, ['query', 'limit', 'cursor', 'receivingQuery', 'receivingStatus', 'receivingLimit', 'receivingCursor']);
        for (const field of ['limit', 'receivingLimit']) if (value[field] !== undefined) {
          need(/^(?:[1-9][0-9]?|100)$/.test(value[field]), 'PRODUCT_PLANS_LIMIT_INVALID');
          value[field] = Number(value[field]);
        }
        return send(200, await model.sourcePlansState(value));
      }
      if (req.method === 'GET' && url.pathname === '/api/source-builds/plan')
        return send(200, await model.sourcePlanRead(params(url, ['planId', 'bindingId'])));
      if (req.method === 'GET' && url.pathname === '/api/source-builds/plan-runtimes')
        return send(200, await model.sourcePlanRuntimes(params(url, ['planId', 'bindingId'])));
      if (req.method === 'GET' && url.pathname === '/api/source-builds/plan-handoff')
        return send(200, await model.sourcePlanHandoff(params(url, ['planId', 'bindingId', 'runtimeId'])));
      if (req.method === 'GET' && url.pathname === '/api/source-builds/plan-briefing')
        return send(200, await model.sourcePlanBriefing(params(url, ['planId', 'bindingId', 'format', 'runtimeId'])));
      if (req.method === 'GET' && url.pathname === '/api/source-builds/plan-export')
        return send(200, await model.sourcePlanExport(params(url, ['planId'])));
      if (req.method === 'GET' && url.pathname === '/api/source-builds/plan-receiving')
        return send(200, await model.sourcePlanReceiving(params(url, ['receiptId'])));
      if (req.method === 'GET' && url.pathname === '/api/source-builds/state') {
        params(url, []); return send(200, await model.sourceBuildsState());
      }
      if (req.method === 'GET' && url.pathname === '/api/source-builds/review') {
        const value = params(url, ['reviewId']); return send(200, await model.sourceBuildsReadReview(value.reviewId));
      }
      if (req.method === 'GET' && url.pathname === '/api/python/state')
        return send(200, await model.pythonState(params(url, ['runtimeId'])));
      if (req.method === 'GET' && url.pathname === '/api/transfers/state')
        return send(200, await model.transfersState(params(url, ['cacheTransferId'])));
      if (req.method === 'GET' && url.pathname === '/api/images/state') {
        params(url, []); return send(200, await model.imagesState());
      }
      if (req.method === 'GET' && url.pathname === '/api/state')
        return send(200, await model.state(params(url, ['runtimeId', 'operationDetail'])));
      if (req.method === 'GET' && url.pathname === '/api/catalog') {
        const value = params(url, ['archiveId']); return send(200, await model.catalog(value.archiveId));
      }
      if (req.method === 'GET' && url.pathname === '/api/operations') {
        const value = params(url, ['query', 'filter', 'runtimeId', 'limit', 'cursor']);
        if (value.limit !== undefined) {
          need(/^(?:[1-9][0-9]?|100)$/.test(value.limit), 'RUNTIME_OPERATION_HISTORY_LIMIT_INVALID');
          value.limit = Number(value.limit);
        }
        return send(200, await model.operationHistory(value));
      }
      if (req.method === 'GET' && url.pathname === '/api/operation-status')
        return send(200, await model.operationStatus(params(url, ['operationId'])));
      if (req.method === 'GET' && ['/api/runtime-output/sources', '/api/runtime-output/page'].includes(url.pathname)) {
        const inventory = url.pathname.endsWith('/sources');
        const value = params(url, inventory ? ['operationId', 'runtimeId', 'cursor', 'limit']
          : ['operationId', 'runtimeId', 'logFile', 'selection', 'offset', 'limit']);
        for (const name of ['offset', 'limit']) if (value[name] !== undefined) {
          need(/^(?:0|[1-9][0-9]*)$/.test(value[name]) && Number.isSafeInteger(Number(value[name])),
            'RUNTIME_OUTPUT_PAGE_INVALID');
          value[name] = Number(value[name]);
        }
        return send(200, await model[inventory ? 'runtimeOutputSources' : 'runtimeOutputPage'](value));
      }
      if (req.method === 'GET' && url.pathname === '/api/log')
        return send(200, await model.logs(params(url, ['runtimeId', 'operationId'])));
      if (req.method === 'GET' && url.pathname === '/api/handoff') {
        const value = params(url, ['runtimeId']); return send(200, await model.handoff(value.runtimeId));
      }
      if (req.method === 'GET' && url.pathname === '/api/application-input-sets') {
        const value=params(url,['query','offset','limit','workingOffset','workingLimit']);
        for(const key of ['offset','limit','workingOffset','workingLimit'])if(value[key]!==undefined) {
          need(/^(0|[1-9][0-9]*)$/.test(value[key])&&Number.isSafeInteger(Number(value[key])),'APPLICATION_INPUT_SET_PAGE_INVALID');
          value[key]=Number(value[key]);
        }
        return send(200,await model.applicationInputSetsState(value));
      }
      if (req.method === 'GET' && url.pathname === '/api/application-input-set-editions') {
        const value=params(url,['selectionRequestId','offset','limit']);
        for(const key of ['offset','limit'])if(value[key]!==undefined) {
          need(/^(0|[1-9][0-9]*)$/.test(value[key])&&Number.isSafeInteger(Number(value[key])),'APPLICATION_INPUT_EDITION_PAGE_INVALID');
          value[key]=Number(value[key]);
        }
        return send(200,await model.applicationInputSetEditionsState(value));
      }
      if (req.method === 'GET' && url.pathname === '/api/application-input-set-editions/read')
        return send(200,await model.applicationInputSetEditionRead(params(url,['requestId'])));
      if (req.method === 'GET' && url.pathname === '/api/application-input-set-editions/received')
        return send(200,await model.applicationInputSetEditionReceived(params(url,['requestId'])));
      if (req.method === 'GET' && url.pathname === '/api/application-input-sets/inspect')
        return send(200,await model.applicationInputSetInspect(params(url,['setId'])));
      if (req.method === 'GET' && url.pathname === '/api/application-input-sets/selection')
        return send(200,await model.applicationInputSetSelection(params(url,['requestId'])));
      if (req.method === 'GET' && url.pathname === '/api/application-inputs') {
        const value=params(url,['query','offset','limit','workingOffset','workingLimit']);
        for(const name of ['offset','limit','workingOffset','workingLimit']) if(value[name]!==undefined) {
          need(/^(0|[1-9][0-9]*)$/.test(value[name]) && Number.isSafeInteger(Number(value[name])),
            'APPLICATION_INPUT_PAGE_INVALID');
          value[name]=Number(value[name]);
        }
        return send(200,await model.applicationInputsState(value));
      }
      if (req.method === 'GET' && url.pathname === '/api/application-inputs/inspect')
        return send(200,await model.applicationInputInspect(params(url,['uploadId'])));
      if (req.method === 'GET' && url.pathname === '/api/application-inputs/selection')
        return send(200,await model.applicationInputSelection(params(url,['requestId'])));
      if (req.method === 'GET' && url.pathname === '/api/applications/state') {
        const value = params(url, ['historyLimit']);
        if (value.historyLimit !== undefined) {
          need(/^(?:[1-9][0-9]?|100)$/.test(value.historyLimit), 'APPLICATION_HISTORY_LIMIT_INVALID');
          value.historyLimit = Number(value.historyLimit);
        }
        return send(200, await model.applicationsState(value));
      }
      if (req.method === 'GET' && url.pathname === '/api/applications/history') {
        const value = params(url, ['applicationId', 'limit', 'cursor']);
        if (value.limit !== undefined) {
          need(/^(?:[1-9][0-9]?|100)$/.test(value.limit), 'APPLICATION_HISTORY_LIMIT_INVALID');
          value.limit = Number(value.limit);
        }
        return send(200, await model.applicationsHistory(value));
      }
      if (req.method === 'GET' && url.pathname === '/api/applications/workbook-result')
        return send(200, await model.applicationsWorkbookResult(params(url, ['applicationId', 'operationId'])));
      if (req.method === 'GET' && url.pathname === '/api/applications/output-page') {
        const value = params(url, ['applicationId', 'operationId', 'selection', 'offset', 'limit']);
        for (const name of ['offset', 'limit']) if (value[name] !== undefined) {
          need(/^(?:0|[1-9][0-9]*)$/.test(value[name]) && Number.isSafeInteger(Number(value[name])),
            'APPLICATION_OUTPUT_PAGE_INVALID');
          value[name] = Number(value[name]);
        }
        return send(200, await model.applicationsOutputPage(value));
      }
      if (req.method === 'GET' && url.pathname === '/api/applications/output')
        return send(200, await model.applicationsOutput(params(url, ['applicationId', 'operationId'])));
      if (req.method === 'GET' && url.pathname === '/api/applications/terminal')
        return send(200, await model.applicationsTerminal(params(url, ['applicationId', 'operationId'])));
      if (req.method === 'GET' && url.pathname === '/api/managed/state')
        return send(200, await model.managedState(params(url, ['homeId'])));
      if (req.method === 'GET' && url.pathname === '/api/managed/config')
        return send(200, await model.managedConfig(params(url, ['homeId', 'path'])));
      need(req.method === 'POST' && req.headers.origin === origin, 'RUNTIME_WORKSPACE_ORIGIN_REQUIRED', undefined, 403);
      if (url.pathname === '/api/runtime-output/download') {
        const input = await body(req, ['operationId', 'runtimeId', 'logFile', 'selection'], 4096);
        const file = await model.runtimeOutputDownload(input);
        file.stream.destroy(); await file.close();
        for (const [key, item] of runtimeOutputDownloads) if (item.expires <= Date.now()) runtimeOutputDownloads.delete(key);
        need(runtimeOutputDownloads.size < 256, 'RUNTIME_OUTPUT_DOWNLOAD_LIMIT',
          'Finish or reopen a recent output download.', 429);
        const key = randomBytes(32).toString('hex');
        runtimeOutputDownloads.set(key, { input: { ...input, selection: file.selection }, expires: Date.now() + 60000 });
        return send(200, { url: origin + '/runtime-output-download/' + key,
          filename: file.filename, bytes: file.bytes, sourceId: file.sourceId, selection: file.selection });
      }
      if (url.pathname === '/api/applications/output-download') {
        const input = await body(req, ['applicationId', 'operationId', 'selection'], 4096);
        const file = await model.applicationsOutputDownload(input);
        file.stream.destroy(); await file.close();
        for (const [key, item] of applicationOutputDownloads) if (item.expires <= Date.now()) applicationOutputDownloads.delete(key);
        need(applicationOutputDownloads.size < 256, 'APPLICATION_OUTPUT_DOWNLOAD_LIMIT',
          'Finish or reopen a recent output download.', 429);
        const key = randomBytes(32).toString('hex');
        applicationOutputDownloads.set(key, { input: { ...input, selection: file.selection }, expires: Date.now() + 60000 });
        return send(200, { url: origin + '/application-output-download/' + key,
          filename: file.filename, bytes: file.bytes, sourceId: file.sourceId, selection: file.selection });
      }
      if (url.pathname === '/api/source-builds/plan-save')
        return send(201, await model.sourcePlanSave(await body(req,
          ['repository', 'ref', 'selection', 'offline', 'python', 'requirements', 'label', 'purpose'], 262144)));
      if (url.pathname === '/api/source-builds/plan-refresh')
        return send(200, await model.sourcePlanRefresh(await body(req, ['planId', 'bindingId'])));
      if (url.pathname === '/api/source-builds/plan-receive')
        return send(201, await model.sourcePlanReceive(await body(req,
          ['bundle', 'repository', 'offline', 'python'], PRODUCT_PLAN_MAX_BYTES + 8192)));
      if (url.pathname === '/api/source-builds/plan-receive-continue')
        return send(200, await model.sourcePlanContinue(await body(req, ['receiptId'])));
      if (url.pathname === '/api/source-builds/catalog')
        return send(200, await model.sourceBuildsCatalog(await body(req, ['repository', 'ref', 'offline'])));
      if (url.pathname === '/api/source-builds/product')
        return send(200, await model.sourceBuildsProduct(await body(req, ['repository', 'ref', 'selection', 'offline', 'python'])));
      if (url.pathname === '/api/source-builds/review')
        return send(201, await model.sourceBuildsReview(await body(req, ['repository', 'ref', 'selection', 'offline', 'python'])));
      if (url.pathname === '/api/source-builds/recover') {
        const value = await body(req, ['operationId']); return send(202, await model.recoverSourceBuildOperation(value.operationId));
      }
      if (url.pathname === '/api/source-builds/download') {
        const value = await body(req, ['reviewId']), file = await model.sourceBuildsDownload(value.reviewId);
        await file.handle.close();
        for (const [key, item] of sourceBuildDownloads) if (item.expires <= Date.now()) sourceBuildDownloads.delete(key);
        need(sourceBuildDownloads.size < 256, 'SOURCE_BUILD_DOWNLOAD_LIMIT', 'Finish or reopen a recent download.', 429);
        const key = randomBytes(32).toString('hex');
        sourceBuildDownloads.set(key, { reviewId: value.reviewId, expires: Date.now() + 60000 });
        return send(200, { url: origin + '/source-build-download/' + key, file: file.file, bytes: file.bytes, sha256: file.sha256 });
      }
      if (url.pathname === '/api/workspace-backups/upload') {
        need((req.headers['content-type'] ?? '').split(';')[0].trim() === 'application/octet-stream',
          'WORKSPACE_BACKUP_UPLOAD_TYPE_REQUIRED', undefined, 415);
        const value = params(url, ['requestId', 'sha256', 'bytes', 'offset', 'storageDirectory']);
        for (const field of ['bytes', 'offset']) {
          need(/^(?:0|[1-9][0-9]*)$/.test(value[field] ?? '') && Number.isSafeInteger(Number(value[field])),
            'WORKSPACE_BACKUP_UPLOAD_RANGE_INVALID');
          value[field] = Number(value[field]);
        }
        return send(200, await model.workspaceBackupUpload({ ...value, body: req }));
      }
      if (url.pathname === '/api/python/upload') {
        need((req.headers['content-type'] ?? '').split(';')[0].trim() === 'application/octet-stream', 'PYTHON_ARCHIVE_TYPE_REQUIRED');
        return send(201, await model.pythonUpload({ ...params(url, ['sha256']), body: req }));
      }
      if (url.pathname === '/api/transfers/upload') {
        need((req.headers['content-type'] ?? '').split(';')[0].trim() === 'application/octet-stream', 'RUNTIME_TRANSFER_UPLOAD_TYPE_REQUIRED');
        const value = params(url, ['cacheTransferId', 'index']);
        need(/^(?:0|[1-9][0-9]*)$/.test(value.index ?? '') && Number.isSafeInteger(Number(value.index)), 'RUNTIME_TRANSFER_PART_INVALID');
        return send(200, await model.transfersUpload({ ...value, index: Number(value.index), body: req }));
      }
      if (url.pathname === '/api/images/upload') {
        need((req.headers['content-type'] ?? '').split(';')[0] === 'application/octet-stream', 'RUNTIME_IMAGE_UPLOAD_TYPE_REQUIRED');
        const value = params(url, ['transferId', 'offset']);
        need(/^(?:0|[1-9][0-9]*)$/.test(value.offset ?? ''), 'RUNTIME_IMAGE_UPLOAD_OFFSET_INVALID');
        return send(200, await model.imagesUpload({ ...value, offset: Number(value.offset), body: req }));
      }
      if (url.pathname === '/api/archive-upload') {
        need((req.headers['content-type'] ?? '').split(';')[0] === 'application/octet-stream', 'RUNTIME_WORKSPACE_ARCHIVE_TYPE_REQUIRED');
        const value = params(url, ['sha256', 'label', 'requestId']);
        return send(202, await model.receiveArchive({ ...value, body: req }));
      }
      need(!url.search, 'RUNTIME_WORKSPACE_QUERY_INVALID');
      if (url.pathname === '/api/workspace-backups/review')
        return send(200, await model.workspaceBackupReview(await body(req, ['requestId', 'label', 'storageDirectory'])));
      if (url.pathname === '/api/workspace-backups/create')
        return send(202, await model.workspaceBackupCreate(await body(req, ['requestId', 'reviewId', 'reviewSha256', 'storageDirectory'])));
      if (url.pathname === '/api/workspace-backups/inspect')
        return send(200, await model.workspaceBackupInspect(await body(req, ['archivePath', 'uploadId', 'sha256', 'storageDirectory'])));
      if (url.pathname === '/api/workspace-backups/restore')
        return send(202, await model.workspaceBackupRestore(await body(req, ['requestId', 'archiveId', 'manifestSha256', 'directory', 'mode', 'storageDirectory'])));
      if (url.pathname === '/api/workspace-backups/continue')
        return send(202, await model.workspaceBackupContinue(await body(req, ['operationId', 'storageDirectory'])));
      if (url.pathname === '/api/workspace-backups/bindings')
        return send(200, await model.workspaceBackupBindings(await body(req, ['receivingId', 'hostBindings', 'storageDirectory'])));
      if (url.pathname === '/api/workspace-backups/open')
        return send(200, await model.workspaceBackupOpen(await body(req, ['receivingId', 'reviewId', 'reviewSha256', 'storageDirectory'])));
      if (url.pathname === '/api/workspace-backups/download') {
        const input = await body(req, ['archiveId', 'storageDirectory']);
        const file = await model.workspaceBackupDownload(input);
        file.stream.destroy();
        for (const [key, item] of workspaceBackupDownloads)
          if (item.expires <= Date.now()) workspaceBackupDownloads.delete(key);
        need(workspaceBackupDownloads.size < 256, 'WORKSPACE_BACKUP_DOWNLOAD_LIMIT',
          'Finish or reopen a recent download.', 429);
        const key = randomBytes(32).toString('hex');
        workspaceBackupDownloads.set(key, { input, expires: Date.now() + 60000 });
        return send(200, { url: origin + '/workspace-backup-download/' + key,
          filename: file.filename, bytes: file.bytes, sha256: file.sha256 });
      }
      if (url.pathname === '/api/python/review')
        return send(200, await model.pythonReview(await body(req, ['runtimeId', 'python', 'extras'])));
      if (url.pathname === '/api/python/command')
        return send(200, await model.pythonCommand(await body(req, ['runtimeId', 'installationId', 'command', 'args'], 131072)));
      if (url.pathname === '/api/python/recover') {
        const value = await body(req, ['operationId']); return send(202, await model.recoverPythonOperation(value.operationId));
      }
      if (url.pathname === '/api/python/download') {
        const input = await body(req, ['operationId']), file = await model.pythonDownload(input);
        await file.handle.close();
        for (const [key, value] of pythonDownloads) if (value.expires <= Date.now()) pythonDownloads.delete(key);
        need(pythonDownloads.size < 256, 'PYTHON_DOWNLOAD_LIMIT', 'Finish or reopen a recent download.', 429);
        const key = randomBytes(32).toString('hex');
        pythonDownloads.set(key, { input, expires: Date.now() + 60000 });
        return send(200, { url: origin + '/python-download/' + key, file: file.file, bytes: file.bytes, sha256: file.sha256 });
      }
      if (url.pathname === '/api/transfers/review')
        return send(200, await model.transfersReview(await body(req, ['runtimeId'])));
      if (url.pathname === '/api/transfers/attach')
        return send(201, await model.transfersAttach(await body(req, ['directory', 'label'])));
      if (url.pathname === '/api/transfers/receive')
        return send(201, await model.transfersReceive(await body(req, ['manifest', 'manifestSha256', 'requestId', 'label'], MAX_MANIFEST_BYTES * 2 + 4096)));
      if (url.pathname === '/api/transfers/recover-operation') {
        const value = await body(req, ['operationId']); return send(202, await model.recoverTransferOperation(value.operationId));
      }
      if (url.pathname === '/api/transfers/download') {
        const input = await body(req, ['cacheTransferId', 'kind', 'index']), file = await model.transfersDownload(input);
        await file.handle.close();
        for (const [key, value] of transferDownloads) if (value.expires <= Date.now()) transferDownloads.delete(key);
        need(transferDownloads.size < 256, 'RUNTIME_TRANSFER_DOWNLOAD_LIMIT', 'Finish or reopen a recent download', 429);
        const key = randomBytes(32).toString('hex');
        transferDownloads.set(key, { input, expires: Date.now() + 60000 });
        return send(200, { url: origin + '/transfer-download/' + key, file: file.file, bytes: file.bytes, sha256: file.sha256 });
      }
      if (url.pathname === '/api/images/attach') return send(201, await model.imagesAttach(await body(req, ['directory', 'label'])));
      if (url.pathname === '/api/images/review') return send(200, await model.imagesReview(await body(req,
        ['runtimeId', 'id', 'baseImage', 'platform', 'sourceRoot', 'runtime', 'uid', 'gid', 'pythonModules', 'nodeHeaders'])));
      if (url.pathname === '/api/images/transfer-attach') return send(201, await model.imagesTransferAttach(await body(req, ['directory', 'label'])));
      if (url.pathname === '/api/images/transfer') return send(201, await model.imagesTransfer(await body(req, ['manifest', 'requestId', 'label'], 65536)));
      if (url.pathname === '/api/images/container-review') return send(200, await model.imagesContainerReview(await body(req,
        ['imageId', 'transferId', 'runtimeId', 'containerPlan', 'hostPlan', 'sourceMode', 'useImageRuntime', 'selectedSourceRoot'])));
      if (url.pathname === '/api/images/download') {
        const input = await body(req, ['transferId', 'file']), file = await model.imagesDownload(input);
        await file.handle.close();
        for (const [key, value] of imageDownloads) if (value.expires <= Date.now()) imageDownloads.delete(key);
        need(imageDownloads.size < 256, 'RUNTIME_IMAGE_DOWNLOAD_LIMIT', 'Finish or reopen a recent download', 429);
        const key = randomBytes(32).toString('hex');
        imageDownloads.set(key, { input, expires: Date.now() + 60000 });
        return send(200, { url: origin + '/image-download/' + key, file: file.file, bytes: file.bytes });
      }
      if (url.pathname === '/api/attach') return send(201, await model.attach(await body(req, ['directory', 'label'])));
      if (url.pathname === '/api/review') return send(200, await model.review(await body(req, ['archiveId', 'selection'])));
      if (url.pathname === '/api/operation') return send(202, await model.begin(await body(req,
        ['requestId', 'operation', 'runtimeId', 'archiveId', 'name', 'selection', 'profileId', 'offline', 'cache',
          'load', 'source', 'install', 'archive', 'sha256', 'label', 'nodeHeaders', ...Object.values(managedOperationFields).flat(), ...new Set(Object.values(imageOperationFields).flat()), ...new Set(Object.values(transferOperationFields).flat()), ...new Set(Object.values(pythonOperationFields).flat()), ...new Set(Object.values(sourceBuildOperationFields).flat())])));
      if (url.pathname === '/api/resume-queued') {
        const value = await body(req, ['operationId']); return send(202, await model.resumeQueued(value.operationId));
      }
      if (url.pathname.startsWith('/api/applications/openapi-setup/')) {
        const action = url.pathname.slice('/api/applications/openapi-setup/'.length);
        need(!url.search && Object.hasOwn(OPENAPI_SETUP_ROUTES, action), 'OAUTH_SETUP_INPUT_INVALID');
        const value = await body(req, ['runtimeId', 'context', 'input'], openApiSetupBodyLimit(action));
        return send(200, await model.applicationsOpenApiSetup({ ...value, action }));
      }
      if (url.pathname === '/api/applications/workbook-download') {
        const input = await body(req, ['applicationId', 'operationId', 'file', 'manifestSha256']);
        const file = await model.applicationsWorkbookDownload(input);
        await file.handle.close();
        for (const [key, value] of workbookDownloads) if (value.expires <= Date.now()) workbookDownloads.delete(key);
        need(workbookDownloads.size < 256, 'WORKBOOK_DOWNLOAD_LIMIT', 'Finish or reopen a recent workbook download.', 429);
        const key = randomBytes(32).toString('hex');
        workbookDownloads.set(key, { input, expires: Date.now() + 60000 });
        return send(200, { url: origin + '/workbook-download/' + key, file: file.file, bytes: file.bytes, sha256: file.sha256 });
      }
      if (url.pathname === '/api/application-input-set-editions/review')
        return send(200,await model.applicationInputSetEditionReview(await body(req,['selectionRequestId','name'],8192)));
      if (url.pathname === '/api/application-input-set-editions/capture')
        return send(200,await model.applicationInputSetEditionCapture(await body(req,['requestId','review'],4*1024*1024)));
      if (url.pathname === '/api/application-input-sets/begin')
        return send(200,await model.applicationInputSetBegin(await body(req,['manifest'],2*1024*1024)));
      if (url.pathname === '/api/application-input-sets/complete')
        return send(200,await model.applicationInputSetComplete(await body(req,['setId'],4096)));
      if (url.pathname === '/api/application-input-sets/prepare')
        return send(200,await model.applicationInputSetPrepare(await body(req,['requestId','setId','kind','field','memberPath'],8192)));
      if (url.pathname === '/api/application-inputs/begin')
        return send(200,await model.applicationInputBegin(await body(req,['manifest'],16384)));
      if (url.pathname === '/api/application-inputs/chunk') {
        need((req.headers['content-type']??'').split(';')[0].trim()==='application/octet-stream',
          'APPLICATION_INPUT_CHUNK_TYPE_REQUIRED',undefined,415);
        const value=params(url,['uploadId','index']);
        need(/^(0|[1-9][0-9]*)$/.test(value.index??''),'APPLICATION_INPUT_CHUNK_INDEX_INVALID');
        return send(200,await model.applicationInputChunk({...value,index:Number(value.index),body:req}));
      }
      if (url.pathname === '/api/application-inputs/complete')
        return send(200,await model.applicationInputComplete(await body(req,['uploadId'],4096)));
      if (url.pathname === '/api/application-inputs/prepare')
        return send(200,await model.applicationInputPrepare(await body(req,['requestId','uploadId','kind','field'],4096)));
      if (url.pathname === '/api/application-inputs/download') {
        const input=await body(req,['uploadId'],4096),file=await model.applicationInputDownload(input);
        file.stream.destroy();await file.close();
        for(const [key,value] of applicationInputDownloads)if(value.expires<=Date.now())applicationInputDownloads.delete(key);
        need(applicationInputDownloads.size<256,'APPLICATION_INPUT_DOWNLOAD_LIMIT',undefined,429);
        const key=randomBytes(32).toString('hex');
        applicationInputDownloads.set(key,{input,expires:Date.now()+60000});
        return send(200,{url:origin+'/application-input-download/'+key,filename:file.filename,bytes:file.bytes,sha256:file.sha256});
      }
      if (url.pathname === '/api/applications/review')
        return send(200, await model.applicationsReview(await body(req, ['runtimeId', 'kind', 'settings', 'label', 'applicationId', 'expectedRevision', 'homeId', 'providerId'])));
      if (url.pathname === '/api/applications/save')
        return send(201, await model.applicationsSave(await body(req, ['requestId', 'reviewId', 'applicationId'])));
      if (url.pathname === '/api/applications/connect')
        return send(202, await model.applicationsConnect(await body(req, ['applicationId'])));
      if (url.pathname === '/api/applications/start-review')
        return send(200, await model.applicationsStartReview({ ...await body(req, ['applicationId']), navigationOrigin: origin }));
      if (url.pathname === '/api/applications/start')
        return send(202, await model.applicationsStart(await body(req, ['applicationId', 'requestId', 'reviewId'])));
      if (url.pathname === '/api/applications/stop')
        return send(202, await model.applicationsStop(await body(req, ['applicationId', 'operationId'])));
      if (url.pathname === '/api/applications/recover')
        return send(202, await model.applicationsRecover(await body(req, ['applicationId', 'operationId'])));
      if (url.pathname === '/api/applications/input')
        return send(202, await model.applicationsInput(await body(req, ['applicationId', 'operationId', 'inputId', 'text'])));
      if (url.pathname === '/api/managed/open')
        return send(201, await model.openManagedHome(await body(req, ['directory', 'label'])));
      if (url.pathname === '/api/managed/review')
        return send(200, await model.reviewManagedAdoption(await body(req, ['homeId', 'runtimeId'])));
      if (url.pathname === '/api/managed/recover') {
        const value = await body(req, ['operationId']); return send(202, await model.recoverManagedOperation(value.operationId));
      }
      if (url.pathname === '/api/managed/stop') {
        const value = await body(req, ['operationId']); return send(202, await model.stopManagedCommand(value.operationId));
      }
      if (url.pathname === '/api/compare') return send(200, await model.compare(await body(req, ['before', 'after'])));
      fail('RUNTIME_WORKSPACE_ROUTE_NOT_FOUND', undefined, 404);
    } catch (error) {
      if (res.headersSent) { res.destroy(); return; }
      const diagnostic = runtimeWorkspaceError(error), code = diagnostic.code;
      send(error.status ?? (/(?:CHANGED|BUSY|RUNNING|EXIST)/.test(code) ? 409 : 400),
        { error: code, message: diagnostic.message, ...(diagnostic.flock ? { flock: diagnostic.flock } : {}) });
    }
  });
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  server.requestTimeout = 120000; server.headersTimeout = 10000; server.keepAliveTimeout = 5000;
  server.maxRequestsPerSocket = 100;
  await new Promise((done, reject) => { server.once('error', reject); server.listen(port, HOST, done); });
  origin = new URL('http://' + HOST + ':' + server.address().port).origin;
  host = new URL(origin).host;
  return { origin, url: origin + '/#' + token, directory: model.directory,
    async close() {
      if (closing) return;
      closing = true; applicationInputDownloads.clear(); workspaceBackupDownloads.clear(); imageDownloads.clear(); transferDownloads.clear(); pythonDownloads.clear(); sourceBuildDownloads.clear(); workbookDownloads.clear();
      const stopped = new Promise(done => server.close(done));
      await model.close(); server.closeIdleConnections();
      for (const socket of sockets) socket.destroy();
      await stopped;
    } };
}

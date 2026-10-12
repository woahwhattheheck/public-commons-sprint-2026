#!/usr/bin/env node
// MIT. Local-only interactive wrapper around the ORIGINAL SF70 merchant intake.
// Private case persistence and original-source diagnostic/runtime workorders.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {parseArgs, capture} from '../sf70-merchant-intake/run.mjs';
import {compare, validateIntake} from '../sf76-merchant-remediation-delta/compare.mjs';
import {evaluate as postPreflight} from '../sf72-post-only-preflight/preflight.mjs';
import {uploadedSource,workorderFromSources} from './workorder-source.mjs';
import {operateCaseCommissioning,prepareCaseCommissioning,inspectCaseCommissioning} from './case-commissioning.mjs';
import {openCaseStore, inspectCaseWriter, recoverCaseWriter, CASE_STATUSES, caseMetadata} from './case-store.mjs';
import {MAX_WORKSPACE_BYTES} from './workspace-file.mjs';
import {createCaseSourceDelivery} from './case-source-delivery.mjs';
import {openCasePackageOperations} from './case-package-operations.mjs';
import {createCasePackageHttp} from './case-package-http.mjs';
import {createSourceEditionDeliveryRoutes} from '../../scf_2026/sf49_data_commissioning/source-edition-http.mjs';
import {openIncidentSources, incidentProblem} from './incident-sources.mjs';
import {inspectSupportSelection, supportSelectionSha256, createSupportLaunch, supportListenerIdentity} from './managed-launch.mjs';
import {inspectRuntimeFiles, reviewRuntime, exportRuntimeHandoff, importRuntimeHandoff,
  MAX_RUNTIME_BYTES, MAX_HANDOFF_BYTES} from './runtime-support.mjs';

import {openCaseCommercial,commercialWorkspaceId} from './case-commercial.mjs';
import {openCommercialReceivingController} from './commercial/operator.mjs';

const ASSETS = Object.freeze({
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/commercial': ['commercial.html', 'text/html; charset=utf-8'],
  '/commercial/receiving-desk.mjs': ['commercial/receiving-desk.mjs', 'text/javascript; charset=utf-8'],
  '/commercial/receiving-desk.css': ['commercial/receiving-desk.css', 'text/css; charset=utf-8'],
  '/commercial/RECEIVING.md': ['commercial/RECEIVING.md', 'text/markdown; charset=utf-8'],
  '/commercial-app.mjs': ['commercial-app.mjs', 'text/javascript; charset=utf-8'],
  '/commercial-desk.mjs': ['commercial-desk.mjs', 'text/javascript; charset=utf-8'],
  '/commercial-desk.css': ['commercial-desk.css', 'text/css; charset=utf-8'],
  '/console.mjs': ['console.mjs', 'text/javascript; charset=utf-8'],
  '/terms-editor.mjs': ['terms-editor.mjs', 'text/javascript; charset=utf-8'],
  '/workspace-file.mjs': ['workspace-file.mjs', 'text/javascript; charset=utf-8'],
  '/commissioning.mjs': ['commissioning.mjs', 'text/javascript; charset=utf-8'],
  '/source-bundle-reference.mjs': ['source-bundle-reference.mjs', 'text/javascript; charset=utf-8'],
  '/commissioning-source/panel.mjs': ['../../scf_2026/sf49_data_commissioning/source-edition-panel.mjs', 'text/javascript; charset=utf-8'],
  '/commissioning-source/panel.css': ['../../scf_2026/sf49_data_commissioning/source-edition-panel.css', 'text/css; charset=utf-8'],
  '/commissioning-desk.mjs': ['commissioning-desk.mjs', 'text/javascript; charset=utf-8'],
  '/commissioning-desk.css': ['commissioning-desk.css', 'text/css; charset=utf-8'],
  '/workspace-files.mjs': ['workspace-files.mjs', 'text/javascript; charset=utf-8'],
  '/case-desk.mjs': ['case-desk.mjs', 'text/javascript; charset=utf-8'],
  '/case-package-desk.mjs': ['case-package-desk.mjs', 'text/javascript; charset=utf-8'],
  '/case-package-desk.css': ['case-package-desk.css', 'text/css; charset=utf-8'],
  '/runtime-desk.mjs': ['runtime-desk.mjs', 'text/javascript; charset=utf-8'],
  '/handoff-desk.mjs': ['handoff-desk.mjs', 'text/javascript; charset=utf-8'],
  '/incident-desk.mjs': ['incident-desk.mjs', 'text/javascript; charset=utf-8'],
  '/incident-desk.css': ['incident-desk.css', 'text/css; charset=utf-8'],
  '/service-commitments.mjs': ['service-commitments.mjs', 'text/javascript; charset=utf-8'],
  '/service-desk.mjs': ['service-desk.mjs', 'text/javascript; charset=utf-8'],
  '/service-desk.css': ['service-desk.css', 'text/css; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
});
const ROOT = new URL('.', import.meta.url);
const MAX_BODY = 8192;
const MAX_SOURCE = 2_000_000; // Same per-file limit as the original SF76 CLI.
const MAX_COMPARISON_BODY = 4 * Math.ceil(MAX_SOURCE / 3) * 4 + 512;
const MAX_WORKORDER_BODY = 5 * Math.ceil(MAX_SOURCE / 3) * 4 + 512;
const HEADERS = Object.freeze({
  'cache-control': 'no-store, max-age=0',
  'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'",
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
});

function json(res, code, data) {
  res.writeHead(code, {'content-type': 'application/json; charset=utf-8'});
  res.end(JSON.stringify(data));
}
function argsFromForm(input, allowLoopback) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Expected one merchant intake object');
  const allowed = new Set(['resource', 'catalog', 'origin', 'network', 'payTo', 'method', 'permission', 'credentialed']);
  if (Object.keys(input).some(k => !allowed.has(k))) throw new TypeError('Unexpected intake field');
  if (input.permission !== true) throw new TypeError('Operator must confirm authorization for the named resource and facilitator');
  if (input.credentialed !== undefined && typeof input.credentialed !== 'boolean')
    throw new TypeError('credentialed must be a boolean');
  const opts = [
    ['--resource', 'resource'], ['--catalog', 'catalog'], ['--origin', 'origin'],
    ['--network', 'network'], ['--pay-to', 'payTo'], ['--method', 'method'],
  ];
  const argv = [];
  for (const [flag, field] of opts) {
    const v = input[field];
    if (typeof v !== 'string' || !v.trim() || v.length > 2048 || v !== v.trim())
      throw new TypeError('Invalid ' + field + ': expected a nonempty trimmed string');
    argv.push(flag, v);
  }
  if (allowLoopback) argv.push('--allow-loopback');
  if (input.credentialed === true) argv.push('--credentialed');
  // Keep the exact canonical SF70 endpoint, network, address, method and origin validation.
  return parseArgs(argv);
}
async function boundedBody(req, maximum = MAX_BODY) {
  if (req.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json')
    throw Object.assign(new TypeError('Content-Type must be application/json'), {status:415});
  const length = Number(req.headers['content-length']);
  if (Number.isFinite(length) && length > maximum)
    throw Object.assign(new TypeError('Request payload exceeds byte limit'), {status:413});
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.byteLength;
    if (size > maximum) throw Object.assign(new TypeError('Request payload exceeds byte limit'), {status:413});
    chunks.push(chunk);
  }
  if (!size) throw new TypeError('Intake payload is empty');
  try { return JSON.parse(Buffer.concat(chunks, size).toString('utf8')); }
  catch { throw new TypeError('Invalid JSON document'); }
}


function compareUploadedSources(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new TypeError('Expected before and after source files');
  const fields = ['before', 'after', 'postBefore', 'postAfter'];
  if (Object.keys(input).some(key => !fields.includes(key))) throw new TypeError('Unexpected source field');
  const before = uploadedSource(input.before, 'before', true), after = uploadedSource(input.after, 'after', true);
  const pb = uploadedSource(input.postBefore, 'postBefore'), pa = uploadedSource(input.postAfter, 'postAfter');
  return compare({before: before.data, after: after.data, beforeSha: before.sha, afterSha: after.sha,
    postBefore: pb?.data, postAfter: pa?.data, postBeforeSha: pb?.sha, postAfterSha: pa?.sha});
}

export {workorderFromSources} from './workorder-source.mjs';

// Injection is only for the focused loopback HTTP-contract check, not for deployed usage.
export function createConsoleServer({runCapture = capture, allowLoopback = false, caseStore = null, handoffDesk = null, incidentDesk = null, commercialDesk = null, commercialReceivingDesk = null, sourceDelivery = null, casePackages = null, launchRecord = () => null} = {}) {
  let active = false;
  const sourceRoutes=sourceDelivery?createSourceEditionDeliveryRoutes({service:sourceDelivery.service}):null;
  const packageRoutes=createCasePackageHttp(casePackages);
  const server = createServer(async (req, res) => {
    for (const [key, value] of Object.entries(HEADERS)) res.setHeader(key, value);
    const port = server.address()?.port;
    const ownOrigin = new URL(`http://127.0.0.1:${port}`).origin;
    if (req.socket.remoteAddress !== '127.0.0.1' && req.socket.remoteAddress !== '::ffff:127.0.0.1') {
      json(res, 403, {error: 'LOOPBACK_ONLY'}); return;
    }
    if (req.headers.host !== new URL(ownOrigin).host) {
      json(res, 403, {error: 'INVALID_LOCAL_HOST'}); return;
    }
    const route = (req.url || '').split('?')[0];
    if (req.method === 'GET' && route === '/health') {
      json(res, 200, {status: 'LOCAL_READY', originalIntake: 'SF70', providerCallsOnPageLoad: 0, paidCalls: 0, casesEnabled:Boolean(caseStore),commercialEnabled:Boolean(commercialDesk),commercialReceivingEnabled:Boolean(commercialReceivingDesk),handoffsEnabled:Boolean(handoffDesk),incidentsEnabled:Boolean(incidentDesk),sourceBundlesEnabled:Boolean(sourceDelivery),casePackagesEnabled:Boolean(casePackages)}); return;
    }
    if (route === '/api/support-launch') {
      if (req.method !== 'GET') {json(res,405,{error:'METHOD_NOT_ALLOWED'});return;}
      if ((req.headers.origin && req.headers.origin !== ownOrigin) ||
          (req.headers['sec-fetch-site'] && !['same-origin','none'].includes(req.headers['sec-fetch-site']))) {
        json(res,403,{error:'ORIGIN_MISMATCH'});return;
      }
      if (new URL(req.url,ownOrigin).search) {json(res,400,{error:'UNEXPECTED_QUERY'});return;}
      const identity=supportListenerIdentity(launchRecord());
      json(res,identity?200:404,identity??{error:'MANAGED_STARTUP_DISABLED'});return;
    }
    if (req.method === 'GET' && Object.hasOwn(ASSETS, route)) {
      try {
        const [filename, mime] = ASSETS[route];
        const data = await readFile(new URL(filename, ROOT));
        res.writeHead(200, {'content-type': mime}); res.end(data);
      } catch { json(res, 500, {error: 'STATIC_ASSET_UNAVAILABLE'}); }
      return;
    }
    if (await packageRoutes(req,res,{origin:ownOrigin}))return;
    if (route === '/api/services/incident-snapshot') {
      if (req.method!=='GET') {json(res,405,{error:'METHOD_NOT_ALLOWED'});return;}
      if ((req.headers.origin&&req.headers.origin!==ownOrigin)||
          (req.headers['sec-fetch-site']&&!['same-origin','none'].includes(req.headers['sec-fetch-site']))) {
        json(res,403,{error:'ORIGIN_MISMATCH'});return;
      }
      if(!incidentDesk){json(res,503,{error:'INCIDENT_SOURCES_DISABLED',detail:'Configure the original incident sources for this Support desk.'});return;}
      try{
        const query=new URL(req.url,ownOrigin).searchParams;
        if([...query.keys()].some(key=>!['source','merchant'].includes(key))||query.getAll('source').length!==1||query.getAll('merchant').length!==1)
          throw new TypeError('Choose one original incident source and merchant.');
        const snapshot=await incidentDesk.serviceSnapshot(query.get('source'),{merchantId:query.get('merchant')});
        json(res,200,{snapshot});
      }catch(error){const problem=incidentProblem(error);json(res,problem.status,{error:problem.error,detail:problem.detail});}
      return;
    }
    if (route === '/api/commissioning/source-file') {
      if(req.method!=='GET'){json(res,405,{error:'METHOD_NOT_ALLOWED'});return;}
      if ((req.headers.origin && req.headers.origin !== ownOrigin) ||
          (req.headers['sec-fetch-site'] && !['same-origin','none'].includes(req.headers['sec-fetch-site']))) {
        json(res,403,{error:'ORIGIN_MISMATCH'});return;
      }
      if(!sourceDelivery){json(res,503,{error:'SOURCE_DELIVERY_DISABLED',detail:'Open a private saved-case directory to receive source files.'});return;}
      try {
        const input={},query=new URL(req.url,ownOrigin).searchParams;
        for(const [key,value]of query) {
          if(!['bundleId','manifestSha256','path'].includes(key)||Object.hasOwn(input,key))
            throw new TypeError('Choose one complete original source file identity.');
          input[key]=value;
        }
        if(Object.keys(input).length!==3)throw new TypeError('Choose the bundle, manifest and original file.');
        const file=await sourceDelivery.resolveFile(input);
        json(res,200,{url:file.url,filename:file.filename,bytes:file.bytes,sha256:file.sha256,
          bundleId:file.bundleId,manifestSha256:file.manifestSha256});
      } catch(error) {
        const known=/^(?:SOURCE_|INVALID_CASE_SOURCE_|SF49_)/.test(error.code||'');
        json(res,Number(error.status)||(error instanceof TypeError?422:503),{
          error:known?error.code:'SOURCE_FILE_UNAVAILABLE',
          detail:known||error instanceof TypeError?String(error.message).slice(0,240):
            'The original source file could not be opened. Receive its complete source bundle to this workspace.',
        });
      }
      return;
    }
    if (route === '/api/commissioning/source-bundles' || route.startsWith('/api/commissioning/source-bundles/')) {
      if(!sourceRoutes){json(res,503,{error:'SOURCE_DELIVERY_DISABLED',detail:'Open a private saved-case directory to receive source files.'});return;}
      await sourceRoutes.handle(req,res,{origin:ownOrigin});return;
    }
    if (route === '/api/incidents' || route.startsWith('/api/incidents/')) {
      if ((req.headers.origin && req.headers.origin !== ownOrigin) ||
          (req.headers['sec-fetch-site'] && !['same-origin','none'].includes(req.headers['sec-fetch-site'])) ||
          (req.method !== 'GET' && req.headers.origin !== ownOrigin)) {
        json(res,403,{error:'ORIGIN_MISMATCH'});return;
      }
      if (!incidentDesk) {
        json(res,route==='/api/incidents/profiles'&&req.method==='GET'?200:503,
          {enabled:false,sources:[],error:'INCIDENT_SOURCES_DISABLED'});return;
      }
      try {
        const url=new URL(req.url,ownOrigin);
        if(route==='/api/incidents/profiles'&&req.method==='GET') {
          if(url.search)throw new TypeError('Unexpected incident profile query');
          json(res,200,incidentDesk.profiles());return;
        }
        const match=/^\/api\/incidents\/([a-z0-9][a-z0-9_-]{0,63})(?:\/(configure|destination|start|stop)|\/notifications\/([a-f0-9-]{36})\/(retry|cancel)|\/([a-f0-9-]{36})(?:\/(ack|notify|case))?)?$/.exec(route);
        if(!match){json(res,404,{error:'NOT_FOUND'});return;}
        const [,source,operation,eventId,eventAction,incidentId,incidentAction]=match;
        if(req.method==='GET'&&!operation&&!eventId&&!incidentAction) {
          if(incidentId) {
            if(url.search)throw new TypeError('Unexpected incident query');
            json(res,200,await incidentDesk.view(source,incidentId));return;
          }
          if([...url.searchParams.keys()].some(key=>!['q','status','merchant','kind','offset','limit'].includes(key)))
            throw new TypeError('Unexpected incident list filter');
          const filters=Object.fromEntries(url.searchParams);
          for(const key of ['offset','limit'])if(key in filters)filters[key]=Number(filters[key]);
          json(res,200,await incidentDesk.list(source,filters));return;
        }
        if(url.search)throw new TypeError('Unexpected incident operation query');
        if(req.method!=='POST'){json(res,405,{error:'METHOD_NOT_ALLOWED'});return;}
        const input=await boundedBody(req,incidentAction==='case'?MAX_WORKSPACE_BYTES*2+100000:65536);
        if(!input||typeof input!=='object'||Array.isArray(input))throw new TypeError('Expected incident controls');
        let result;
        if(operation==='configure')result=await incidentDesk.configure(source,input);
        else if(operation==='destination')result=await incidentDesk.inspectDestination(source,input);
        else if(operation==='start')result=await incidentDesk.start(source,input);
        else if(operation==='stop') {
          if(Object.keys(input).length)throw new TypeError('Unexpected stop input');
          result=await incidentDesk.stop(source);
        } else if(eventId)result=await incidentDesk.notification(source,eventId,{...input,action:eventAction});
        else if(incidentAction==='ack')result=await incidentDesk.acknowledge(source,incidentId,input);
        else if(incidentAction==='notify')result=await incidentDesk.notify(source,incidentId,input);
        else if(incidentAction==='case')result=await incidentDesk.prepareCase(source,incidentId,input);
        else {json(res,405,{error:'METHOD_NOT_ALLOWED'});return;}
        json(res,operation==='start'?202:200,result);
      } catch(error) {
        const problem=incidentProblem(error);json(res,problem.status,{error:problem.error,detail:problem.detail});
      }
      return;
    }
    if (route === '/api/handoffs' || route.startsWith('/api/handoffs/')) {
      if ((req.headers.origin && req.headers.origin !== ownOrigin) ||
          (req.headers['sec-fetch-site'] && !['same-origin','none'].includes(req.headers['sec-fetch-site'])) ||
          (req.method !== 'GET' && req.headers.origin !== ownOrigin)) {
        json(res,403,{error:'ORIGIN_MISMATCH'});return;
      }
      if (!handoffDesk) {
        json(res,route==='/api/handoffs/profiles'&&req.method==='GET'?200:503,
          {enabled:false,sources:[],error:'HANDOFF_SOURCES_DISABLED'});return;
      }
      try {
        const url=new URL(req.url,ownOrigin);
        if(route==='/api/handoffs/profiles'&&req.method==='GET') {
          if(url.search)throw new TypeError('Unexpected handoff profile query');
          json(res,200,handoffDesk.profiles());return;
        }
        if(route==='/api/handoffs'&&req.method==='GET') {
          if([...url.searchParams.keys()].some(key=>!['source','offset','limit'].includes(key)))throw new TypeError('Unexpected handoff list filter');
          json(res,200,await handoffDesk.list(url.searchParams.get('source'),{
            offset:Number(url.searchParams.get('offset')??0),limit:Number(url.searchParams.get('limit')??20)}));return;
        }
        if(url.search)throw new TypeError('Unexpected handoff query');
        const match=/^\/api\/handoffs\/([a-z0-9][a-z0-9_-]{0,63})\/([a-z0-9][a-z0-9_-]{0,63})(?:\/(inspect|receive|stop|open|files\/([a-z0-9][a-z0-9_.-]{0,63})))?$/.exec(route);
        if(!match){json(res,404,{error:'NOT_FOUND'});return;}
        const [,source,exportId,action,name]=match;
        if(req.method==='GET'&&!action){json(res,200,await handoffDesk.view(source,exportId));return;}
        if(req.method==='GET'&&name){
          const file=await handoffDesk.file(source,exportId,name);
          res.writeHead(200,{'content-type':'application/octet-stream','content-length':file.bytes.length,
            'content-disposition':'attachment; filename="'+file.name+'"','etag':'"'+file.sha256+'"'});res.end(file.bytes);return;
        }
        if(req.method==='POST'&&['inspect','receive','stop','open'].includes(action)){
          const input=await boundedBody(req);
          if(!input||typeof input!=='object'||Array.isArray(input)||action!=='receive'&&Object.keys(input).length)
            throw new TypeError('Use the displayed handoff controls');
          const result=action==='inspect'?await handoffDesk.inspect(source,exportId):action==='receive'?await handoffDesk.receive(source,exportId,input):
            action==='stop'?await handoffDesk.stop(source,exportId):await handoffDesk.reopen(source,exportId);
          json(res,action==='receive'?202:200,result);return;
        }
        json(res,405,{error:'METHOD_NOT_ALLOWED'});
      }catch(error){
        if(error instanceof TypeError){json(res,422,{error:'HANDOFF_INVALID_INPUT',detail:'Use the displayed source, export ID and handoff controls.'});return;}
        const problem=(await import('./handoff-store.mjs')).handoffProblem(error);json(res,problem.status,{error:problem.error,detail:problem.detail});
      }
      return;
    }
    if (route === '/api/cases' || route.startsWith('/api/cases/')) {
      if ((req.headers.origin && req.headers.origin !== ownOrigin) ||
          (req.headers['sec-fetch-site'] && !['same-origin','none'].includes(req.headers['sec-fetch-site'])) ||
          (req.method !== 'GET' && req.headers.origin !== ownOrigin)) {
        json(res, 403, {error:'ORIGIN_MISMATCH'}); return;
      }
      if (!caseStore) {
        json(res, route === '/api/cases' && req.method === 'GET' ? 200 : 503,
          {enabled:false, cases:[], statuses:CASE_STATUSES, error:'CASE_STORAGE_DISABLED'}); return;
      }
      try {
        const url = new URL(req.url, ownOrigin);
        if (route === '/api/cases' && req.method === 'GET') {
          const query = Object.fromEntries(url.searchParams);
          if (Object.keys(query).some(key=>!['q','status','dueOn','offset','limit'].includes(key)))
            throw new TypeError('Unexpected case list filter');
          for (const field of ['offset','limit']) if (field in query) query[field] = Number(query[field]);
          json(res,200,{...await caseStore.list(query), statuses:CASE_STATUSES}); return;
        }
        if (route === '/api/cases' && req.method === 'POST') {
          json(res,200,await caseStore.save(await boundedBody(req, (MAX_WORKSPACE_BYTES + MAX_RUNTIME_BYTES) * 2 + 100000))); return;
        }
        const commercial=/^\/api\/cases\/([a-f0-9-]+)\/commercial(?:\/(preview|save-draft|publish|receive|receive-pricing|compare|download|receiving-status|receiving-capture|receiving-inspect|receiving-attach|receiving-case|receiving-restore))?$/.exec(route);
        if(commercial) {
          if(!commercialDesk){json(res,503,{error:'COMMERCIAL_DISABLED',detail:'Open the original merchant workspace with its private case directory.'});return;}
          if(req.method==='GET'&&!commercial[2]) {
            if([...url.searchParams.keys()].some(key=>key!=='revision')||url.searchParams.getAll('revision').length>1)
              throw new TypeError('Use one original case revision.');
            json(res,200,await commercialDesk.read({id:commercial[1],...(url.searchParams.has('revision')?{revision:url.searchParams.get('revision')}:{})}));return;
          }
          if(req.method!=='POST'||!commercial[2]){json(res,405,{error:'METHOD_NOT_ALLOWED'});return;}
          if(url.search)throw new TypeError('Unexpected quotation query');
          const input=await boundedBody(req,commercial[2].startsWith('receiving-')?64*1024:MAX_WORKSPACE_BYTES*2+100000);
          if(!input||typeof input!=='object'||Array.isArray(input)||Object.hasOwn(input,'id'))
            throw new TypeError('Supply the quotation request for the selected case.');
          if(commercial[2].startsWith('receiving-')) {
            if(!commercialReceivingDesk){json(res,503,{error:'COMMERCIAL_RECEIVING_DISABLED',detail:'Open the original saved-case receiving workspace.'});return;}
            const selected=commercial[2].slice('receiving-'.length),action=selected==='case'?'inspect-case':selected;
            json(res,200,await commercialReceivingDesk.call(action,{id:commercial[1],...input}));return;
          }
          const method={'save-draft':'saveDraft','receive-pricing':'receivePricing'}[commercial[2]]??commercial[2];
          const result=await commercialDesk[method]({id:commercial[1],...input});
          if(method==='download') {
            const file=result.descriptor;
            res.writeHead(200,{'content-type':file.mediaType,'content-length':file.bytes,
              'content-disposition':'attachment; filename="'+file.filename+'"',
              'x-sf74-file-name':encodeURIComponent(file.filename),'x-sf74-file-bytes':String(file.bytes),
              'x-content-sha256':file.sha256,'etag':'"'+file.sha256+'"'});
            res.end(result.body);return;
          }
          json(res,200,result);return;
        }
        const implementation=/^\/api\/cases\/([a-f0-9-]+)\/implementation(?:\/(prepare))?$/.exec(route);
        if(implementation) {
          if(req.method==='GET'&&!implementation[2]) {
            const options=Object.fromEntries(url.searchParams);
            if(Object.keys(options).some(key=>!['revision','section','offset','limit'].includes(key)))
              throw new TypeError('Unexpected implementation query');
            for(const key of ['offset','limit'])if(Object.hasOwn(options,key))options[key]=Number(options[key]);
            json(res,200,await inspectCaseCommissioning(caseStore,{id:implementation[1],...options}));return;
          }
          if(req.method==='POST') {
            if(url.search)throw new TypeError('Unexpected implementation query');
            const input=await boundedBody(req,MAX_WORKSPACE_BYTES*2+100000);
            if(!input||typeof input!=='object'||Array.isArray(input)||Object.hasOwn(input,'id'))
              throw new TypeError('Supply the implementation command for the selected case');
            const operate=implementation[2]?prepareCaseCommissioning:operateCaseCommissioning;
            json(res,200,await operate(caseStore,{id:implementation[1],...input}));return;
          }
          json(res,405,{error:'METHOD_NOT_ALLOWED'});return;
        }
        const match = /^\/api\/cases\/([a-f0-9-]+)(\/history)?$/.exec(route);
        if (match && req.method === 'GET') {
          if ([...url.searchParams.keys()].some(key=>!['revision','before','limit'].includes(key)))
            throw new TypeError('Unexpected case version filter');
          const result = match[2] ? await caseStore.history(match[1], {
            before:url.searchParams.get('before'), limit:Number(url.searchParams.get('limit') || 20),
          }) : await caseStore.read(match[1], url.searchParams.get('revision'));
          json(res,200,result); return;
        }
        json(res,404,{error:'NOT_FOUND'});
      } catch (error) {
        const known = /^(?:CASE_|INVALID_|COMMISSIONING_|COMMERCIAL_|PRICING_|REQUEST_|EDITION_|SOURCE_CHANGE_|HISTORY_|MATERIAL_|UNKNOWN_COMMISSIONING_)/.test(error.code || '');
        json(res, Number(error.status) || (error instanceof TypeError ? 422 : 503), {
          error:known ? error.code : 'CASE_OPERATION_FAILED',
          detail:known || error instanceof TypeError ? String(error.message).slice(0,240) : 'The case operation could not be completed. Your editor is unchanged.',
          ...(error.currentRevision ? {currentRevision:error.currentRevision} : {}),
          ...(route.includes('/commercial/') && (error instanceof TypeError || error instanceof SyntaxError ||
            known && [400,404,409,422].includes(Number(error.status))) ? {requestState:'REJECTED'} : {}),
        });
      }
      return;
    }
    if (route.startsWith('/api/runtime/') && req.method === 'POST') {
      if(req.headers.origin!==ownOrigin) {json(res,403,{error:'ORIGIN_MISMATCH'});return;}
      try {
        const input=await boundedBody(req,MAX_HANDOFF_BYTES*2+100000);
        if(!input||typeof input!=='object'||Array.isArray(input))throw new TypeError('Expected runtime support sources');
        const allowed={
          '/api/runtime/inspect':['files','inputs','routeId','path'],
          '/api/runtime/review':['supportText','inputs'],
          '/api/runtime/export':['workspaceText','supportText','metadata'],
          '/api/runtime/import':['handoffText'],
        }[route];
        if(!allowed) {json(res,404,{error:'NOT_FOUND'});return;}
        if(Object.keys(input).some(key=>!allowed.includes(key)))throw new TypeError('Unexpected runtime support field');
        if(route==='/api/runtime/inspect')json(res,200,inspectRuntimeFiles(input));
        else if(route==='/api/runtime/review')json(res,200,{report:reviewRuntime(input.supportText,input.inputs)});
        else if(route==='/api/runtime/export')json(res,200,await exportRuntimeHandoff({...input,metadata:caseMetadata(input.metadata)}));
        else {
          const imported=await importRuntimeHandoff(input.handoffText);
          json(res,200,{...imported,metadata:caseMetadata(imported.metadata)});
        }
      } catch(error) {
        json(res,Number(error.status)||422,{error:'INVALID_RUNTIME_SUPPORT',detail:String(error.message).slice(0,240)});
      }
      return;
    }
    if (route === '/api/compare' && req.method === 'POST') {
      if (req.headers.origin !== ownOrigin) { json(res, 403, {error: 'ORIGIN_MISMATCH'}); return; }
      try {
        // Original SF76 is a pure offline comparison: no capture, paths or network calls.
        const report = compareUploadedSources(await boundedBody(req, MAX_COMPARISON_BODY));
        json(res, 200, {report});
      } catch (error) {
        json(res, Number(error?.status) || 422, {error: 'INVALID_COMPARISON',
          detail: String(error?.message ?? error).slice(0, 240)});
      }
      return;
    }
    if (route === '/api/workorder' && req.method === 'POST') {
      if (req.headers.origin !== ownOrigin) { json(res, 403, {error: 'ORIGIN_MISMATCH'}); return; }
      try {
        // Offline and in-memory: no filesystem paths, fetching, sending or acceptance side effects.
        json(res, 200, workorderFromSources(await boundedBody(req, MAX_RUNTIME_BYTES*2+MAX_WORKORDER_BODY)));
      } catch (error) {
        json(res, Number(error?.status) || 422, {error: 'INVALID_WORKORDER',
          detail: String(error?.message ?? error).slice(0, 240)});
      }
      return;
    }
    if (route === '/api/post-preflight' && req.method === 'POST') {
      if (req.headers.origin !== ownOrigin) { json(res, 403, {error: 'ORIGIN_MISMATCH'}); return; }
      if (active) { json(res, 409, {error: 'DIAGNOSIS_IN_PROGRESS'}); return; }
      active = true;
      try {
        const input = await boundedBody(req, Math.ceil(MAX_SOURCE / 3) * 4 + 512);
        if (!input || typeof input !== 'object' || Array.isArray(input) ||
            Object.keys(input).some(key => !['intake', 'permission'].includes(key)))
          throw new TypeError('Expected one original intake and explicit permission');
        if (input.permission !== true) throw new TypeError('Authorize one OPTIONS preflight for the displayed seller');
        const source = uploadedSource(input.intake, 'intake', true);
        const scope = validateIntake(source.data);
        if (scope.intendedRetryMethod !== 'POST' || typeof scope.browserCredentialed !== 'boolean')
          throw new TypeError('A current POST intake with explicit browser credential mode is required');
        // SF72 remains the sole eligibility gate and OPTIONS implementation.
        const report = await postPreflight(source.data, {allowLoopback, credentialed: scope.browserCredentialed});
        report.source.intakeSha256 = source.sha;
        json(res, 200, {report});
      } catch (error) {
        const status = Number(error?.status) || (error instanceof TypeError ? 422 : 502);
        json(res, status, {error: status === 502 ? 'ORIGINAL_PREFLIGHT_FAILED' : 'INVALID_PREFLIGHT',
          detail: String(error?.message ?? error).slice(0, 240)});
      } finally { active = false; }
      return;
    }
    if (route === '/api/intake' && req.method === 'POST') {
      // Enforce same-origin. Browser POSTs have Origin; empty Origin must not bypass the CSRF fence.
      if (req.headers.origin !== ownOrigin) { json(res, 403, {error: 'ORIGIN_MISMATCH'}); return; }
      if (active) { json(res, 409, {error: 'INTAKE_IN_PROGRESS'}); return; }
      active = true;
      try {
        const config = argsFromForm(await boundedBody(req), allowLoopback);
        const report = await runCapture(config);
        // Direct return of original SF70 schema and exact finding states, not a recomputation.
        json(res, 200, {report});
      } catch (error) {
        const status = Number(error?.status) || (error instanceof TypeError ? 422 : 502);
        json(res, status, {error: status === 502 ? 'ORIGINAL_INTAKE_FAILED' : 'INVALID_INTAKE',
          detail: String(error?.message ?? error).slice(0, 240)});
      } finally { active = false; }
      return;
    }
    json(res, 404, {error: 'NOT_FOUND'});
  });
  sourceRoutes?.configure(server);
  server.closeSourceDelivery=()=>sourceRoutes?.close()??Promise.resolve();
  server.closeCasePackages=()=>casePackages?.close()??Promise.resolve();
  server.closeCommercialReceiving=()=>commercialReceivingDesk?.close()??Promise.resolve();
  server.once('close',()=>{void Promise.allSettled([server.closeCasePackages(),server.closeCommercialReceiving()]).then(()=>server.closeSourceDelivery()).catch(()=>{});});
  return server;
}

export async function start({port = 0, allowLoopback = false, runCapture = capture, casesDir = null, handoffSources = null,
  incidentSources = null, sourceDir = null, packageDir = null, environment = process.env, startupFormat = 'text', expectedSelectionSha256 = null} = {}) {
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new TypeError('Invalid port');
  if (!['text','json'].includes(startupFormat)) throw new TypeError('Startup format must be text or json');
  if (expectedSelectionSha256 !== null &&
      (startupFormat !== 'json' || !/^[a-f0-9]{64}$/.test(expectedSelectionSha256)))
    throw new TypeError('Managed startup requires the reviewed selection SHA-256 and JSON format');
  if (startupFormat === 'json' && (casesDir === null || incidentSources === null || handoffSources !== null))
    throw new TypeError('Managed startup requires private cases and incident source profiles');
  if((sourceDir!==null||packageDir!==null)&&casesDir===null)throw new TypeError('Source and package delivery require the original saved-case directory.');
  const caseStore = casesDir === null ? null : await openCaseStore(casesDir);
  const commercialDesk=caseStore?openCaseCommercial({store:caseStore,workspaceId:commercialWorkspaceId(resolve(casesDir))}):null;
  const commercialReceivingDesk=caseStore?openCommercialReceivingController({store:caseStore,casesDirectory:resolve(casesDir),environment}):null;
  const handoffDesk = handoffSources === null ? null : await (await import('./handoff-store.mjs')).openHandoffDesk({configPath:handoffSources,casesDir,environment});
  let incidentDesk,sourceDelivery,casePackages,selection=null,launch=null;
  try {
    sourceDelivery=caseStore?await createCaseSourceDelivery({store:caseStore,
      directory:sourceDir===null?join(resolve(casesDir),'source-bundles'):resolve(sourceDir),environment}):null;
    casePackages=caseStore?await openCasePackageOperations({store:caseStore,casesDirectory:resolve(casesDir),
      ...(packageDir===null?{}:{directory:resolve(packageDir)}),sourceDelivery,handoffDesk,
      python:environment.SCF_PYTHON??'python3',environment}):null;
    incidentDesk = incidentSources === null ? null : await openIncidentSources({configPath:incidentSources,environment});
    if(startupFormat==='json') {
      selection=await inspectSupportSelection({casesDir,incidentSources,allowLoopback,
        sourceDir:sourceDelivery.directory,packageDir:casePackages.directory,incidentSelection:incidentDesk.configuration()});
      if(expectedSelectionSha256!==null&&supportSelectionSha256(selection)!==expectedSelectionSha256)
        throw Object.assign(new Error('The selected support configuration changed; review the current application before starting.'),
          {code:'SUPPORT_APPLICATION_SELECTION_CHANGED'});
    }
  } catch(error) {await Promise.allSettled([casePackages?.close(),commercialReceivingDesk?.close()]);await Promise.allSettled([handoffDesk?.close(),incidentDesk?.close(),sourceDelivery?.close()]);throw error;}
  let server;
  try{server=createConsoleServer({allowLoopback,runCapture,caseStore,handoffDesk,incidentDesk,commercialDesk,commercialReceivingDesk,sourceDelivery,casePackages,launchRecord:()=>launch});}
  catch(error){await Promise.allSettled([casePackages?.close(),commercialReceivingDesk?.close()]);await Promise.allSettled([handoffDesk?.close(),incidentDesk?.close(),sourceDelivery?.close()]);throw error;}
  try {await new Promise((resolveListen, reject) => {
    server.once('error', reject);server.listen(port, '127.0.0.1', resolveListen);
  });}catch(error){await Promise.allSettled([server.closeCasePackages(),server.closeCommercialReceiving()]);await Promise.allSettled([handoffDesk?.close(),incidentDesk?.close(),server.closeSourceDelivery()]);throw error;}
  const url='http://127.0.0.1:'+server.address().port+'/';
  if(selection)launch=createSupportLaunch(selection,url);
  let closing;
  const close=()=>closing??=(async()=>{
    if(launch)launch.state='STOPPING';
    const packageResults=await Promise.allSettled([server.closeCasePackages(),server.closeCommercialReceiving()]);
    const results=packageResults.concat(await Promise.allSettled([handoffDesk?.close(),incidentDesk?.close(),server.closeSourceDelivery()]));
    await new Promise((done,reject)=>{server.close(error=>error?reject(error):done());server.closeAllConnections();});
    const failed=results.find(result=>result.status==='rejected');if(failed)throw failed.reason;
  })();
  server.once('close',()=>{if(launch)launch.state='STOPPED';void Promise.allSettled([server.closeCasePackages(),server.closeCommercialReceiving()]).then(()=>Promise.allSettled([handoffDesk?.close(),incidentDesk?.close(),server.closeSourceDelivery()])).catch(()=>{});});
  return {server,url,close,launch};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), options = {}, seen = new Set();
  let writerAction = null;
  try {
    for (let index = 0; index < args.length; index++) {
      const token = args[index], separator = token.indexOf('=');
      const flag = separator < 0 ? token : token.slice(0,separator);
      if (seen.has(flag)) throw new TypeError('Duplicate option: ' + flag);
      seen.add(flag);
      if (flag === '--allow-loopback' && separator < 0) { options.allowLoopback = true; continue; }
      if (['--inspect-case-writer','--recover-case-writer'].includes(flag) && separator < 0) {
        if (writerAction) throw new TypeError('Choose one case writer operation');
        writerAction = flag; continue;
      }
      if (!['--port','--cases-dir','--source-dir','--package-dir','--handoff-sources','--incident-sources','--startup-format','--expected-selection-sha256'].includes(flag)) throw new TypeError('Unknown option: ' + flag);
      const value = separator < 0 ? args[++index] : token.slice(separator + 1);
      if (!value || value.startsWith('--')) throw new TypeError('Missing value for ' + flag);
      if (flag === '--port' && !/^\d+$/.test(value)) throw new TypeError('Invalid port');
      options[{'--port':'port','--cases-dir':'casesDir','--source-dir':'sourceDir','--package-dir':'packageDir','--handoff-sources':'handoffSources','--incident-sources':'incidentSources','--startup-format':'startupFormat','--expected-selection-sha256':'expectedSelectionSha256'}[flag]] = flag === '--port' ? Number(value) : value;
    }
    if (writerAction) {
      if (!options.casesDir || seen.has('--port') || seen.has('--source-dir') || seen.has('--package-dir') || seen.has('--allow-loopback') || seen.has('--handoff-sources') || seen.has('--incident-sources') || seen.has('--startup-format') || seen.has('--expected-selection-sha256'))
        throw new TypeError('A case writer operation requires --cases-dir and does not start a server');
      const action = writerAction === '--inspect-case-writer' ? inspectCaseWriter : recoverCaseWriter;
      process.stdout.write(JSON.stringify(await action(options.casesDir), null, 2) + '\n');
    } else {
      const {url,close,launch} = await start(options);
      let stopping=false;
      const stop=()=>{if(stopping)return;stopping=true;void close().catch(()=>{process.stderr.write('SF74 shutdown could not finish. Retained work remains available.\n');process.exitCode=1;});};
      process.once('SIGINT',stop);process.once('SIGTERM',stop);
      if(launch)process.stdout.write(JSON.stringify(launch)+'\n');
      else process.stdout.write('Open locally: '+url+'\n' +
        (options.casesDir ? 'Merchant case desk enabled.\n' : 'Session mode. Use --cases-dir /absolute/private/directory to retain merchant cases.\n'));
    }
  } catch (error) {
    process.stderr.write('SF74: ' + String(error.message) + '\nUsage: node server.mjs [--cases-dir /absolute/private/directory] [--source-dir /absolute/private/sources] [--package-dir /absolute/private/packages] [--handoff-sources PRIVATE_CONFIG.json] [--incident-sources PRIVATE_CONFIG.json] [--port 8784] [--allow-loopback] [--startup-format text|json] [--expected-selection-sha256 SHA256]\n' +
      '       node server.mjs --cases-dir /absolute/private/directory --inspect-case-writer|--recover-case-writer\n');
    process.exitCode = 1;
  }
}

#!/usr/bin/env node
// MIT. Local-only interactive wrapper around the ORIGINAL SF70 merchant intake.
// Private case persistence and original-source diagnostic/runtime workorders.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {parseArgs, capture} from '../sf70-merchant-intake/run.mjs';
import {compare, validateIntake} from '../sf76-merchant-remediation-delta/compare.mjs';
import {evaluate as postPreflight} from '../sf72-post-only-preflight/preflight.mjs';
import {buildPacket, buildRuntimePacket, renderHtml, renderChecklist} from '../sf77-merchant-workorder/workorder.mjs';
import {openCaseStore, inspectCaseWriter, recoverCaseWriter, CASE_STATUSES, caseMetadata} from './case-store.mjs';
import {MAX_WORKSPACE_BYTES} from './workspace-file.mjs';
import {inspectRuntimeFiles, reviewRuntime, exportRuntimeHandoff, importRuntimeHandoff,
  MAX_RUNTIME_BYTES, MAX_HANDOFF_BYTES} from './runtime-support.mjs';

const ASSETS = Object.freeze({
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/console.mjs': ['console.mjs', 'text/javascript; charset=utf-8'],
  '/terms-editor.mjs': ['terms-editor.mjs', 'text/javascript; charset=utf-8'],
  '/workspace-file.mjs': ['workspace-file.mjs', 'text/javascript; charset=utf-8'],
  '/workspace-files.mjs': ['workspace-files.mjs', 'text/javascript; charset=utf-8'],
  '/case-desk.mjs': ['case-desk.mjs', 'text/javascript; charset=utf-8'],
  '/runtime-desk.mjs': ['runtime-desk.mjs', 'text/javascript; charset=utf-8'],
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

function uploadedSource(encoded, field, required = false) {
  if (encoded === undefined || encoded === null) {
    if (required) throw new TypeError('Missing ' + field + ' source');
    return null;
  }
  if (typeof encoded !== 'string' || !encoded.length ||
      encoded.length > Math.ceil(MAX_SOURCE / 3) * 4)
    throw new TypeError(field + ' source must contain 1..2,000,000 bytes');
  // Hash the uploaded bytes, never a parsed/reformatted JSON representation.
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.toString('base64') !== encoded || !bytes.length || bytes.length > MAX_SOURCE)
    throw new TypeError(field + ' source has invalid encoding or size');
  let data;
  try { data = JSON.parse(new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(bytes)); }
  catch { throw new TypeError(field + ' source must be valid UTF-8 JSON'); }
  return {data, sha: createHash('sha256').update(bytes).digest('hex')};
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

export function workorderFromSources(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new TypeError('Expected original capture files and owner terms');
  const fields = ['before', 'after', 'postBefore', 'postAfter', 'terms', 'supportText', 'inputs'];
  if (Object.keys(input).some(key => !fields.includes(key))) throw new TypeError('Unexpected workorder field');
  const terms = uploadedSource(input.terms, 'terms', true);
  if(Object.hasOwn(input,'supportText')) {
    if(['before','after','postBefore','postAfter'].some(key=>Object.hasOwn(input,key)))
      throw new TypeError('Select original diagnostic sources or the attached runtime case for this workorder');
    const packet=buildRuntimePacket({supportText:input.supportText,inputs:input.inputs},terms.data,new Date().toISOString());
    return {packet,html:renderHtml(packet),checklist:renderChecklist(packet)};
  }
  if(Object.hasOwn(input,'inputs'))throw new TypeError('Runtime mapping requires its original supportText');
  const before = uploadedSource(input.before, 'before', true);
  const after = uploadedSource(input.after, 'after');
  const pb = uploadedSource(input.postBefore, 'postBefore'), pa = uploadedSource(input.postAfter, 'postAfter');
  if (!after && (pb || pa)) throw new TypeError('Browser check comparison requires an after capture');
  validateIntake(before.data);
  // Original SF77 owns terms, economics, acceptance and its optional SF76 repair review.
  const packet = buildPacket(before.data, terms.data, before.sha, new Date().toISOString(), after ? {
    after: after.data, afterSha: after.sha, postBefore: pb?.data, postAfter: pa?.data,
    postBeforeSha: pb?.sha, postAfterSha: pa?.sha,
  } : null);
  return {packet, html: renderHtml(packet), checklist: renderChecklist(packet)};
}

// Injection is only for the focused loopback HTTP-contract check, not for deployed usage.
export function createConsoleServer({runCapture = capture, allowLoopback = false, caseStore = null} = {}) {
  let active = false;
  const server = createServer(async (req, res) => {
    for (const [key, value] of Object.entries(HEADERS)) res.setHeader(key, value);
    const port = server.address()?.port;
    const ownOrigin = `http://127.0.0.1:${port}`;
    if (req.socket.remoteAddress !== '127.0.0.1' && req.socket.remoteAddress !== '::ffff:127.0.0.1') {
      json(res, 403, {error: 'LOOPBACK_ONLY'}); return;
    }
    if (req.headers.host !== `127.0.0.1:${port}`) {
      json(res, 403, {error: 'INVALID_LOCAL_HOST'}); return;
    }
    const route = (req.url || '').split('?')[0];
    if (req.method === 'GET' && route === '/health') {
      json(res, 200, {status: 'LOCAL_READY', originalIntake: 'SF70', providerCallsOnPageLoad: 0, paidCalls: 0, casesEnabled:Boolean(caseStore)}); return;
    }
    if (req.method === 'GET' && Object.hasOwn(ASSETS, route)) {
      try {
        const [filename, mime] = ASSETS[route];
        const data = await readFile(new URL(filename, ROOT));
        res.writeHead(200, {'content-type': mime}); res.end(data);
      } catch { json(res, 500, {error: 'STATIC_ASSET_UNAVAILABLE'}); }
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
        const known = /^CASE_|^INVALID_/.test(error.code || '');
        json(res, Number(error.status) || (error instanceof TypeError ? 422 : 503), {
          error:known ? error.code : 'CASE_OPERATION_FAILED',
          detail:known || error instanceof TypeError ? String(error.message).slice(0,240) : 'The case operation could not be completed. Your editor is unchanged.',
          ...(error.currentRevision ? {currentRevision:error.currentRevision} : {}),
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
  return server;
}

export async function start({port = 0, allowLoopback = false, runCapture = capture, casesDir = null} = {}) {
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new TypeError('Invalid port');
  const caseStore = casesDir === null ? null : await openCaseStore(casesDir);
  const server = createConsoleServer({allowLoopback, runCapture, caseStore});
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolveListen);
  });
  return {server, url: `http://127.0.0.1:${server.address().port}/`};
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
      if (!['--port','--cases-dir'].includes(flag)) throw new TypeError('Unknown option: ' + flag);
      const value = separator < 0 ? args[++index] : token.slice(separator + 1);
      if (!value || value.startsWith('--')) throw new TypeError('Missing value for ' + flag);
      if (flag === '--port' && !/^\d+$/.test(value)) throw new TypeError('Invalid port');
      options[flag === '--port' ? 'port' : 'casesDir'] = flag === '--port' ? Number(value) : value;
    }
    if (writerAction) {
      if (!options.casesDir || seen.has('--port') || seen.has('--allow-loopback'))
        throw new TypeError('A case writer operation requires --cases-dir and does not start a server');
      const action = writerAction === '--inspect-case-writer' ? inspectCaseWriter : recoverCaseWriter;
      process.stdout.write(JSON.stringify(await action(options.casesDir), null, 2) + '\n');
    } else {
      const {url} = await start(options);
      process.stdout.write('Open locally: '+url+'\n' +
        (options.casesDir ? 'Merchant case desk enabled.\n' : 'Session mode. Use --cases-dir /absolute/private/directory to retain merchant cases.\n'));
    }
  } catch (error) {
    process.stderr.write('SF74: ' + String(error.message) + '\nUsage: node server.mjs [--cases-dir /absolute/private/directory] [--port 8784] [--allow-loopback]\n' +
      '       node server.mjs --cases-dir /absolute/private/directory --inspect-case-writer|--recover-case-writer\n');
    process.exitCode = 1;
  }
}

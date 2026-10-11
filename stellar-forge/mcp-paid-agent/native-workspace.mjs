// SPDX-License-Identifier: MIT
// Connect the existing MCP agentCommerce hook to the original SF88 buyer inbox.
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { open, lstat, realpath, mkdir, rename, link, unlink, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requiredQueryKeys } from './query-requirements.mjs';
import {createNativeObjects, nativeObjectActions} from './native-objects.mjs';
import {createSavedFileReader} from './native-file.mjs';
import { initializeQueue, openQueue } from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/queue.mjs';
import { openWorkspace } from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/workspace.mjs';
import { discoveryOptions, discoverCatalog } from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/discovery.mjs';
import { prepareReview } from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/prepare.mjs';
import { execution, need, InputError } from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/config.mjs';

const SCHEMA = 'stellar-forge.mcp-native-workspace.v1';
const RESULT = 'stellar-forge.mcp-native-buyer.v1';
const queueCli = fileURLToPath(new URL('../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/queue-cli.mjs', import.meta.url));
const sha = data => createHash('sha256').update(data).digest('hex');
const encoded = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const intentKey = value => {
  need(typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value), 'STABLE_INTENT_ID_REQUIRED');
  return sha(value);
};
const fail = code => { throw new InputError(code); };
const nativeRoot = path => {
  need(typeof path === 'string' && isAbsolute(path) && !path.includes('\0'), 'MCP_NATIVE_ABSOLUTE_PATH_REQUIRED');
  return resolve(path);
};
function ownPrivate(info) {
  return (info.mode & 0o077) === 0 &&
    (typeof process.getuid !== 'function' || info.uid === process.getuid());
}
async function privateDirectory(path) {
  const info = await lstat(path);
  need(info.isDirectory() && !info.isSymbolicLink() && ownPrivate(info) &&
    await realpath(path) === resolve(path), 'MCP_NATIVE_PRIVATE_DIRECTORY_REQUIRED');
}
async function privateBytes(path, maximum = 2 * 1024 * 1024) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    need(info.isFile() && ownPrivate(info) && info.size <= maximum, 'MCP_NATIVE_PRIVATE_FILE_REQUIRED');
    const bytes = await handle.readFile();
    need(bytes.length <= maximum, 'MCP_NATIVE_FILE_TOO_LARGE');
    return bytes;
  } finally { await handle.close(); }
}
async function privateJson(path, maximum) {
  const bytes = await privateBytes(path, maximum);
  try { return JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes)); }
  catch { fail('MCP_NATIVE_JSON_INVALID'); }
}
async function syncDirectory(path) {
  const handle = await open(path, constants.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close(); }
}
async function createFile(path, bytes) {
  const temporary = join(dirname(path), '.write-' + randomUUID());
  const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  try {
    try { await handle.writeFile(bytes); await handle.sync(); }
    finally { await handle.close(); }
    await link(temporary, path);
    await syncDirectory(dirname(path));
  } finally { await unlink(temporary).catch(() => {}); }
}
function https(value) {
  let url;
  try { url = new URL(value); } catch { fail('MCP_NATIVE_HTTPS_REQUIRED'); }
  need(url.protocol === 'https:' && !url.username && !url.password && !url.hash, 'MCP_NATIVE_HTTPS_REQUIRED');
  return url;
}
function binding(workspace) {
  const {op, owner, transport} = execution(workspace.config);
  return {network:op.expect.network, scheme:op.expect.scheme, asset:op.expect.asset,
    payTo:op.expect.payTo, payer:workspace.config.trustedPayer,
    operator:owner, buyerTransport:transport, signerModule:workspace.config.signerModule,
    evidenceDir:workspace.config.evidenceDir};
}
function sameBinding(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function responseLimits(value = {}) {
  need(object(value) && Object.keys(value).every(key => ['maxBytes','timeoutMs'].includes(key)),
    'MCP_NATIVE_RESPONSE_LIMITS_INVALID');
  const result = {maxBytes:value.maxBytes ?? 64 * 1024 * 1024, timeoutMs:value.timeoutMs ?? 30000};
  need(Number.isSafeInteger(result.maxBytes) && result.maxBytes > 0 &&
    Number.isSafeInteger(result.timeoutMs) && result.timeoutMs > 0 && result.timeoutMs <= 2147483647,
    'MCP_NATIVE_RESPONSE_LIMITS_INVALID');
  return result;
}

/** New MCP state only; this never creates or replaces a wallet or spending ledger. */
export async function initializeNativeWorkspace({directory, workspace, catalog, response = {}} = {}) {
  need(process.platform !== 'win32', 'MCP_NATIVE_POSIX_REQUIRED');
  const root = nativeRoot(directory), operatorPath = nativeRoot(workspace);
  await privateDirectory(dirname(root));
  const original = await openWorkspace(['--dir', operatorPath]);
  const {op} = execution(original.config);
  need(op.expect.network === 'stellar:testnet', 'MCP_NATIVE_TESTNET_REQUIRED');
  // Native adapter callers cannot inherit hidden body bytes or fulfillment headers.
  need(op.bodyFile === undefined && op.orderReference === undefined, 'MCP_NATIVE_BODY_OR_ORDER_REQUIRES_EXPLICIT_WORKFLOW');
  const selectedCatalog = catalog ?? original.config.catalog;
  const discovered = discoveryOptions(selectedCatalog);
  need(discovered.captureDir === null && discovered.allPages === false,
    'MCP_NATIVE_USE_ORIGINAL_CATALOG_SESSION_SEPARATELY');
  need(discovered.timeoutMs <= 30000, 'MCP_NATIVE_DISCOVERY_TIMEOUT_EXCEEDS_30_SECONDS');
  const route = https(op.url);
  const manifest = {schema:SCHEMA, createdAt:new Date().toISOString(), directory:root,
    workspace:operatorPath, workspaceBinding:binding(original), catalog:selectedCatalog,
    route:{origin:route.origin, pathname:route.pathname, method:op.method,
      headers:op.headers ?? {}}, response:responseLimits(response)};
  let created = false;
  try {
    await mkdir(root, {mode:0o700}); created = true;
    await privateDirectory(root);
    for (const name of ['requests','downloads']) await mkdir(join(root, name), {mode:0o700});
    await initializeQueue(join(root, 'inbox'));
    const moduleUrl = new URL('./native-workspace.mjs', import.meta.url).href;
    const adapter = [
      '// Private trusted MCP adapter; no wallet key is stored here.',
      'import {openNativeWorkspace} from ' + JSON.stringify(moduleUrl) + ';',
      'const workspace = await openNativeWorkspace(' + JSON.stringify(root) + ');',
      'export const agentCommerce = (args, context) => workspace.call(args, context);',
      'export const approve = async () => false;',
      'export async function signPayment() { throw Object.assign(new Error("Use the native sf43 tool"), {code:"MCP_NATIVE_TOOL_REQUIRED"}); }',
      'export const close = () => workspace.close();',
      '',
    ].join('\n');
    await createFile(join(root, 'operator.mjs'), Buffer.from(adapter));
    await createFile(join(root, 'native-workspace.json'), encoded(manifest));
    return {schema:SCHEMA, status:'NATIVE_MCP_WORKSPACE_CREATED', directory:root,
      originalWorkspace:operatorPath, originalLedger:original.config.operator.ledger,
      resource:manifest.route, network:op.expect.network, walletKeyStored:false,
      environment:{MCP_OPERATOR_MODULE:join(root, 'operator.mjs'),
        MCP_STATE_DIR:join(root, 'quotes'), BAZAAR_DISCOVERY_URL:selectedCatalog.origin,
        PAID_RESOURCE_ORIGINS:route.origin},
      tool:'sf43_discover_review_and_pay'};
  } catch (error) {
    if (created) await rm(root, {recursive:true, force:true}).catch(() => {});
    throw error;
  }
}

function normalizedPurchase(args, manifest, current, {enforceCaps = true} = {}) {
  need(typeof args.search === 'string' && args.search.trim().length > 0 && args.search.length <= 256,
    'MCP_NATIVE_SEARCH_REQUIRED');
  const url = https(args.targetResourceURL), method = args.targetMethod ?? 'GET';
  need(url.origin === manifest.route.origin && url.pathname === manifest.route.pathname &&
    method === manifest.route.method, 'MCP_NATIVE_WORKSPACE_ROUTE_MISMATCH');
  need(typeof args.maxAtomic === 'string' && /^[1-9][0-9]{0,18}$/.test(args.maxAtomic),
    'MCP_NATIVE_SPEND_CAP_EXCEEDED');
  need(!enforceCaps || BigInt(args.maxAtomic) <= BigInt(current.config.operation.expect.maxAtomic) &&
    BigInt(args.maxAtomic) <= BigInt(current.manifest.signer.maxAtomic), 'MCP_NATIVE_SPEND_CAP_EXCEEDED');
  need(args.acceptIndex === undefined || Number.isSafeInteger(args.acceptIndex) && args.acceptIndex >= 0,
    'MCP_NATIVE_ACCEPT_INDEX_INVALID');
  need(args.body === undefined || typeof args.body === 'string' && !['GET','HEAD'].includes(method),
    'MCP_NATIVE_BODY_INVALID');
  const body = args.body === undefined ? null : Buffer.from(args.body, 'utf8');
  need(body === null || body.length <= 1048576, 'MCP_NATIVE_BODY_TOO_LARGE');
  // Reject unpaired UTF-16 surrogates instead of silently replacing submitted text.
  need(body === null || body.toString('utf8') === args.body, 'MCP_NATIVE_BODY_INVALID_UTF8');
  const specification = {intentId:args.intentId, search:args.search, targetResourceURL:url.href,
    targetMethod:method, maxAtomic:args.maxAtomic, acceptIndex:args.acceptIndex ?? null,
    bodySha256:body === null ? null : sha(body), bodyBytes:body?.length ?? 0};
  return {specification, body};
}
function nativeView(record) {
  return {schema:RESULT, intentId:record.operation.intentId, state:record.state,
    createdAt:record.createdAt, request:{url:record.operation.url, method:record.operation.method,
      expected:record.operation.expect, bodySha256:record.bodySha256, bodyBytes:record.bodyBytes},
    attempt:record.attempt ? {id:record.attempt.id, kind:record.attempt.kind,
      startedAt:record.attempt.startedAt} : null,
    originalBuyer:record.outcome, originalRecovery:record.recovery,
    lastError:record.lastError, retry:record.retry};
}

/** Original CLI isolation preserves its exit codes and controlling-terminal approval. */
function runOriginalQueue({root, workspace, intentId, signal}) {
  return new Promise((resolveRun, reject) => {
    if (signal.aborted) { reject(new InputError('OPERATOR_ABORTED')); return; }
    let child, timer, finished = false, stderr = '', bytes = 0;
    const finish = (error, value) => {
      if (finished) return; finished = true; clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      error ? reject(error) : resolveRun(value);
    };
    const abort = () => {
      if (child && child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        timer ??= setTimeout(() => child.kill('SIGKILL'), 10000);
      }
    };
    try {
      child = spawn(process.execPath, [queueCli, 'execute', '--root', root,
        '--intent', intentId, '--workspace', workspace], {
        shell:false, detached:false, env:process.env, stdio:['ignore','pipe','pipe'],
      });
    } catch { finish(new InputError('MCP_NATIVE_EXECUTOR_START_FAILED')); return; }
    child.once('error', () => finish(new InputError('MCP_NATIVE_EXECUTOR_START_FAILED')));
    // Status comes from the original durable inbox; stdout is not a second result store.
    child.stdout.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > 8 * 1024 * 1024) abort();
    });
    child.stderr.on('data', chunk => { if (stderr.length < 8192) stderr += chunk.toString('utf8').slice(0, 8192 - stderr.length); });
    child.once('close', (exitCode, childSignal) => {
      let error = null;
      for (const line of stderr.split(/\r?\n/)) try {
        const parsed = JSON.parse(line);
        if (/^[A-Z0-9_]{1,120}$/.test(parsed.error ?? '')) error = parsed.error;
      } catch {}
      finish(null, {exitCode, signal:childSignal, error, interrupted:signal.aborted});
    });
    signal.addEventListener('abort', abort, {once:true});
    if (signal.aborted) abort();
  });
}

export async function openNativeWorkspace(directory) {
  const root = nativeRoot(directory);
  await privateDirectory(root);
  const manifest = await privateJson(join(root, 'native-workspace.json'), 65536);
  need(manifest?.schema === SCHEMA && manifest.directory === root, 'MCP_NATIVE_MANIFEST_INVALID');
  nativeRoot(manifest.workspace);
  need(discoveryOptions(manifest.catalog).timeoutMs <= 30000,
    'MCP_NATIVE_DISCOVERY_TIMEOUT_EXCEEDS_30_SECONDS');
  responseLimits(manifest.response);
  await privateDirectory(join(root, 'requests'));
  await privateDirectory(join(root, 'downloads'));
  const queue = await openQueue(join(root, 'inbox'));
  const shutdown = new AbortController(), preparing = new Map(), active = new Map();
  const readSavedFile = createSavedFileReader();
  let closed = false;
  async function currentWorkspace() {
    const current = await openWorkspace(['--dir', manifest.workspace]);
    need(sameBinding(binding(current), manifest.workspaceBinding), 'MCP_NATIVE_ORIGINAL_WORKSPACE_CHANGED');
    return current;
  }
  await currentWorkspace();
  async function runOwned(key, kind, context, task) {
    if(active.has(key)) {
      need(active.get(key).kind===kind,'MCP_NATIVE_OPERATOR_BUSY');
      return active.get(key).promise;
    }
    need(active.size===0,'MCP_NATIVE_OPERATOR_BUSY');
    const controller=new AbortController();
    const signal=AbortSignal.any([shutdown.signal,controller.signal,...(context.signal?[context.signal]:[])]);
    need(!closed&&!signal.aborted,'OPERATOR_ABORTED');
    const entry={controller,kind};
    entry.promise=Promise.resolve().then(()=>task(signal));
    active.set(key,entry);
    try{return await entry.promise;}finally{active.delete(key);}
  }
  const objects=createNativeObjects({manifest,currentWorkspace,runOwned,
    isClosed:()=>closed,isActive:key=>active.has(key),
    cancelOwned:async key=>{
      const entry=active.get(key);if(!entry)return false;
      entry.controller.abort();await entry.promise;return true;
    }});
  async function retained(intentId) {
    const path = join(root, 'requests', intentKey(intentId));
    await privateDirectory(path);
    const saved = await privateJson(join(path, 'request.json'), 65536);
    need(saved.schema === SCHEMA && saved.specification?.intentId === intentId &&
      saved.specificationSha256 === sha(encoded(saved.specification)), 'MCP_NATIVE_REQUEST_CHANGED');
    const raw = await privateBytes(join(path, 'buyer.json'), 65536);
    need(saved.configSha256 === sha(raw), 'MCP_NATIVE_CONFIG_CHANGED');
    return {path, saved, raw};
  }
  async function existing(intentId) {
    try { return await retained(intentId); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async function requireQueued(saved) {
    const intentId = saved.saved.specification.intentId;
    try { await lstat(join(queue.root, 'jobs', intentKey(intentId))); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      // Repair a crash after private publication but before original inbox intake.
      return queue.enqueue(join(saved.path, 'buyer.json'));
    }
    const record = await queue.show(intentId);
    need(record.sourceConfigSha256 === saved.saved.configSha256, 'MCP_NATIVE_INBOX_BINDING_CHANGED');
    return record;
  }
  async function prepare(args) {
    const key = intentKey(args.intentId);
    if (preparing.has(key)) {
      await preparing.get(key);
      return prepare(args); // Recheck the caller's own exact specification after the join.
    }
    const task = (async () => {
      const current = await currentWorkspace();
      const before = await existing(args.intentId);
      const {specification, body} = normalizedPurchase(args, manifest, current, {enforceCaps:before === null});
      if (before) {
        need(before.saved.specificationSha256 === sha(encoded(specification)), 'MCP_NATIVE_INTENT_CONFLICT');
        return nativeView(await requireQueued(before));
      }
      need(!closed, 'MCP_NATIVE_WORKSPACE_CLOSING');
      const catalog = await discoverCatalog({...manifest.catalog, query:specification.search,
        filters:{...(manifest.catalog.filters ?? {}), type:'http',
          network:current.config.operation.expect.network, scheme:'exact'}, limit:100, offset:0});
      need(!closed, 'MCP_NATIVE_WORKSPACE_CLOSING');
      const matches = [];
      for (let rowIndex = 0; rowIndex < catalog.originalListings.length; rowIndex++) {
        const row = catalog.originalListings[rowIndex];
        let url; try { url = https(typeof row.resource === 'string' ? row.resource : row.resource?.url); } catch { continue; }
        const input = row.extensions?.bazaar?.info?.input;
        if (url.origin !== manifest.route.origin || url.pathname !== manifest.route.pathname ||
            input?.type !== 'http' || input.method !== specification.targetMethod) continue;
        // Fixed advertised query values cannot be removed or changed by a selected request.
        const requested = new URL(specification.targetResourceURL);
        if ([...new Set(url.searchParams.keys())].some(name =>
          JSON.stringify(url.searchParams.getAll(name)) !== JSON.stringify(requested.searchParams.getAll(name)))) continue;
        matches.push({rowIndex, row});
      }
      need(matches.length === 1, 'MCP_NATIVE_RESOURCE_NOT_UNIQUELY_DISCOVERED');
      const {rowIndex, row} = matches[0];
      const requested = new URL(specification.targetResourceURL);
      need(requiredQueryKeys(row.extensions?.bazaar?.schema).every(name => requested.searchParams.has(name)),
        'INPUT_REQUIRED');
      const expected = current.config.operation.expect;
      const eligible = (row.accepts ?? []).map((value, index) => ({value, index})).filter(({value}) =>
        ['scheme','network','asset','payTo'].every(key => value?.[key] === expected[key]) &&
        typeof value.amount === 'string' && /^[1-9][0-9]*$/.test(value.amount) &&
        BigInt(value.amount) <= BigInt(specification.maxAtomic));
      const chosen = specification.acceptIndex === null ? eligible : eligible.filter(value => value.index === specification.acceptIndex);
      need(chosen.length === 1, 'MCP_NATIVE_PAYMENT_OPTION_NOT_UNIQUE');
      const rawCatalog = encoded(catalog);
      const destination = join(root, 'requests', key);
      const selected = prepareReview(rawCatalog, {rowIndex, acceptIndex:chosen[0].index,
        intentId:args.intentId, url:specification.targetResourceURL, method:specification.targetMethod,
        ...(body === null ? {} : {bodyFile:join(destination, 'body.bin')}),
        headers:manifest.route.headers});
      const cfg = {...selected.draft, operator:current.config.operator,
        signerModule:current.config.signerModule, evidenceDir:current.config.evidenceDir,
        trustedPayer:current.config.trustedPayer, captureBody:false,
        ...(current.config.buyerTransport === undefined ? {} : {
          buyerTransport:structuredClone(current.config.buyerTransport)}),
        responseFile:{destination:join(root, 'downloads', key + '.bin'), ...manifest.response}};
      execution(cfg);
      const raw = encoded(cfg);
      need(raw.length <= 65536, 'MCP_NATIVE_CONFIG_TOO_LARGE');
      const saved = {schema:SCHEMA, specification, specificationSha256:sha(encoded(specification)),
        configSha256:sha(raw), discoverySha256:sha(rawCatalog),
        source:catalog.source, rowIndex, acceptIndex:chosen[0].index};
      const stage = join(root, 'requests', '.prepare-' + randomUUID());
      await mkdir(stage, {mode:0o700});
      let published = false;
      try {
        await createFile(join(stage, 'buyer.json'), raw);
        await createFile(join(stage, 'request.json'), encoded(saved));
        await createFile(join(stage, 'discovery.json'), rawCatalog);
        if (body !== null) await createFile(join(stage, 'body.bin'), body);
        await syncDirectory(stage);
        try { await rename(stage, destination); published = true; await syncDirectory(dirname(destination)); }
        catch (error) {
          if (!['EEXIST','ENOTEMPTY'].includes(error.code)) throw error;
          const prior = await retained(args.intentId);
          need(prior.saved.specificationSha256 === saved.specificationSha256, 'MCP_NATIVE_INTENT_CONFLICT');
        }
      } finally { if (!published) await rm(stage, {recursive:true, force:true}).catch(() => {}); }
      return nativeView(await requireQueued(await retained(args.intentId)));
    })();
    preparing.set(key, task);
    try { return await task; } finally { preparing.delete(key); }
  }
  async function executeIntent(args, context) {
    intentKey(args.intentId);
    const complete = ['search','targetResourceURL','maxAtomic'].every(key => args[key] !== undefined);
    const purchaseFields = ['search','targetResourceURL','maxAtomic','targetMethod','body','acceptIndex'];
    need(complete || purchaseFields.every(key => args[key] === undefined), 'MCP_NATIVE_COMPLETE_REQUEST_REQUIRED');
    if (complete) await prepare(args);
    else await requireQueued(await retained(args.intentId));
    if (active.has('request:'+args.intentId)) return active.get('request:'+args.intentId).promise;
    if (active.size) return {...nativeView(await queue.show(args.intentId)), execution:'OPERATOR_BUSY'};
    const controller = new AbortController();
    const signal = AbortSignal.any([shutdown.signal, controller.signal,
      ...(context.signal ? [context.signal] : [])]);
    const entry = {controller};
    entry.promise = (async () => {
      const before = await queue.show(args.intentId);
      if (before.attempt) return nativeView(before);
      need(!closed && !signal.aborted, 'OPERATOR_ABORTED');
      const worker = await runOriginalQueue({root:queue.root, workspace:manifest.workspace, intentId:args.intentId, signal});
      return {...nativeView(await queue.show(args.intentId)), execution:worker};
    })();
    active.set('request:'+args.intentId, entry);
    try { return await entry.promise; } finally { active.delete('request:'+args.intentId); }
  }
  async function readResult(args) {
    const record = await queue.show(args.intentId);
    const file = record.outcome?.responseFile;
    const destination = join(root, 'downloads', intentKey(args.intentId) + '.bin');
    need(file?.status === 'SAVED' && (file.destination ?? file.path) === destination,
      'MCP_NATIVE_SAVED_RESULT_REQUIRED');
    return {schema:RESULT,intentId:args.intentId,state:record.state,
      result:await readSavedFile({...file,destination},args),retry:'NO_AUTOMATIC_RETRY'};
  }
  const allowedFields = {
    prepare:['intentId','search','targetResourceURL','targetMethod','maxAtomic','body','acceptIndex'],
    execute:['intentId','search','targetResourceURL','targetMethod','maxAtomic','body','acceptIndex'],
    status:['intentId'], recover:['intentId'], cancel:['intentId'],
    read:['intentId','byteOffset','maxBytes'], history:['limit','cursor'],
  };
  return {
    manifest:structuredClone(manifest),
    registerObjects:objects.register,
    async call(args = {}, context = {}) {
      need(!closed, 'MCP_NATIVE_WORKSPACE_CLOSING');
      need(object(args) && object(context) &&
        (context.signal === undefined || context.signal instanceof AbortSignal), 'MCP_NATIVE_ARGUMENTS_INVALID');
      const action = args.action ?? 'execute';
      if(nativeObjectActions.includes(action))return objects.call(args,context);
      need(Object.hasOwn(allowedFields, action) &&
        Object.keys(args).every(key => key === 'action' || allowedFields[action].includes(key)), 'MCP_NATIVE_ARGUMENTS_INVALID');
      if (action !== 'history') intentKey(args.intentId);
      if (action === 'prepare') return prepare(args);
      if (action === 'execute') return executeIntent(args, context);
      if (action === 'history') {
        const limit = args.limit ?? 25;
        need(Number.isInteger(limit) && limit >= 1 && limit <= 100 &&
          (args.cursor === undefined || typeof args.cursor === 'string' && /^[0-9a-f]{64}$/.test(args.cursor)),
          'MCP_NATIVE_HISTORY_PAGE_INVALID');
        const jobs = (await queue.list()).reverse();
        const offset = args.cursor === undefined ? 0 : jobs.findIndex(job => job.id === args.cursor) + 1;
        need(args.cursor === undefined || offset > 0, 'MCP_NATIVE_HISTORY_CURSOR_UNKNOWN');
        const selected = jobs.slice(offset, offset + limit);
        return {schema:RESULT, total:jobs.length, records:selected.map(nativeView),
          nextCursor:offset + selected.length < jobs.length ? selected.at(-1).id : null};
      }
      await retained(args.intentId);
      if (action === 'status') return nativeView(await queue.show(args.intentId));
      if (action === 'recover') {
        need(!active.has('request:'+args.intentId), 'MCP_NATIVE_OPERATION_ACTIVE');
        return nativeView(await queue.recover(args.intentId));
      }
      if (action === 'cancel') {
        if (active.has('request:'+args.intentId)) {
          active.get('request:'+args.intentId).controller.abort();
          return active.get('request:'+args.intentId).promise;
        }
        const record = await queue.show(args.intentId);
        return nativeView(record.attempt ? record : await queue.cancel(args.intentId));
      }
      return readResult(args);
    },
    async close() {
      if (closed) return;
      closed = true; shutdown.abort();
      await Promise.allSettled([objects.close(), ...preparing.values(), ...[...active.values()].map(value => value.promise)]);
    },
  };
}


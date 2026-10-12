// MIT. Selected remote MCP requests inside the existing receiving application.
// The original broker owns discovery, quotes, transport, result storage and replay.
import { open, mkdir, lstat, realpath, link, rename, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, join, dirname, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual as same } from 'node:util';
import { readBytes } from './application.mjs';

const SCHEMA = 'stellar-forge.application-remote-mcp.v1';
const STATE = 'stellar-forge.application-remote-mcp-state.v1';
const REQUEST = 'stellar-forge.application-remote-mcp-request.v1';
const MAX_RESULT = 2 * 1024 * 1024;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = code => Object.assign(new Error(code), {code});
const need = (condition, code) => { if (!condition) throw fail(code); };
const keys = (value, allowed) => object(value) && Object.keys(value).every(key => allowed.includes(key));
const text = (value, maximum) => typeof value === 'string' && value.trim() === value &&
  value.length > 0 && value.length <= maximum && !/[\x00-\x1f\x7f]/.test(value);
const id = value => text(value,128) && /^[A-Za-z0-9._:-]+$/.test(value);
const absolute = value => {
  need(typeof value === 'string' && isAbsolute(value) && resolve(value) === value && value !== '/' &&
    !/[\\\x00-\x1f\x7f]/.test(value), 'APPLICATION_ABSOLUTE_PATH_REQUIRED');
  return value;
};
const checkSignal = signal => signal?.throwIfAborted();
async function privateDirectory(path) {
  absolute(path);
  try { await mkdir(path,{mode:0o700}); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  const st = await lstat(path);
  need(st.isDirectory() && !st.isSymbolicLink() && !(st.mode & 0o077) && await realpath(path) === path &&
    (typeof process.getuid !== 'function' || st.uid === process.getuid()), 'APPLICATION_REMOTE_STATE_INVALID');
}
async function optionalJSON(path) {
  try {
    const st = await lstat(path);
    need(st.isFile() && !st.isSymbolicLink() && !(st.mode & 0o077) &&
      (typeof process.getuid !== 'function' || st.uid === process.getuid()), 'APPLICATION_REMOTE_STATE_INVALID');
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readBytes(path,256*1024)));
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function saveBytes(path, bytes, {replace = false} = {}) {
  absolute(path);
  const temporary = join(dirname(path),'.' + randomUUID() + '.pending');
  let handle;
  try {
    handle = await open(temporary,constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL |
      (constants.O_NOFOLLOW ?? 0),0o600);
    await handle.writeFile(bytes); await handle.sync(); await handle.close(); handle = null;
    if (replace) await rename(temporary,path);
    else await link(temporary,path);
    const directory = await open(dirname(path),'r');
    try { await directory.sync(); } finally { await directory.close(); }
  } finally {
    await handle?.close();
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}
const saveJSON = (path,value,options) => saveBytes(path,Buffer.from(JSON.stringify(value,null,2) + '\n'),options);
function https(value, {origin = false, catalog = false} = {}) {
  let url;
  try { url = new URL(value); } catch { throw fail('APPLICATION_REMOTE_URL_INVALID'); }
  need(url.protocol === 'https:' && !url.username && !url.password && !url.hash &&
    (!catalog || !url.search) && (!origin || value === url.origin), 'APPLICATION_REMOTE_URL_INVALID');
  return url;
}
async function nativeSource(sourceRoot, file) {
  return import(pathToFileURL(join(absolute(sourceRoot),'stellar-forge/mcp-paid-agent',file)).href);
}

/** Inspect the receiving host's selection; this never loads its signer or calls a provider. */
export async function inspectRemoteMcp(file, {sourceRoot} = {}) {
  absolute(file);
  const raw = await readBytes(file,2*1024*1024);
  const config = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
  need(keys(config,['schema','discoveryUrl','allowedResourceOrigins','operatorModule','timeoutMs','requests']) &&
    config.schema === SCHEMA && Array.isArray(config.requests) && config.requests.length >= 1 &&
    config.requests.length <= 24, 'APPLICATION_REMOTE_CONFIG_INVALID');
  https(config.discoveryUrl,{catalog:true}); absolute(config.operatorModule);
  need(Array.isArray(config.allowedResourceOrigins) && config.allowedResourceOrigins.length >= 1 &&
    config.allowedResourceOrigins.length <= 24 &&
    new Set(config.allowedResourceOrigins).size === config.allowedResourceOrigins.length,
    'APPLICATION_REMOTE_ORIGINS_REQUIRED');
  for (const origin of config.allowedResourceOrigins) https(origin,{origin:true});
  need(config.timeoutMs === undefined || Number.isSafeInteger(config.timeoutMs) &&
    config.timeoutMs >= 1000 && config.timeoutMs <= 300000, 'APPLICATION_REMOTE_TIMEOUT_INVALID');
  const {mcpJson,normalizeMcpPolicies} = await nativeSource(sourceRoot,'remote-mcp.mjs');
  const sourceSha256 = hash(raw), requests = new Map(), policies = new Map();
  for (const definition of config.requests) {
    need(keys(definition,['intentId','label','query','endpoint','toolName','transport','paymentResourceUrl',
      'arguments','acceptedTerms','inputSchemaSha256']) && id(definition.intentId) &&
      (definition.label === undefined || text(definition.label,160)) && text(definition.query,1024) &&
      object(definition.arguments) && object(definition.acceptedTerms),
      'APPLICATION_REMOTE_SELECTION_INVALID');
    need(!requests.has(definition.intentId),'APPLICATION_REMOTE_INTENT_DUPLICATE');
    const endpoint = https(definition.endpoint);
    need(endpoint.href === definition.endpoint && config.allowedResourceOrigins.includes(endpoint.origin),
      'APPLICATION_REMOTE_ORIGIN_NOT_SELECTED');
    const [policy] = normalizeMcpPolicies([{endpoint:definition.endpoint,toolName:definition.toolName,
      transport:definition.transport,paymentResourceUrl:definition.paymentResourceUrl}]);
    need(['sse','streamable-http'].includes(definition.transport) &&
      typeof definition.paymentResourceUrl === 'string' &&
      policy.paymentResourceUrl === definition.paymentResourceUrl, 'APPLICATION_REMOTE_SELECTION_INVALID');
    need(definition.inputSchemaSha256 === undefined || /^[a-f0-9]{64}$/.test(definition.inputSchemaSha256),
      'APPLICATION_REMOTE_SCHEMA_HASH_INVALID');
    const terms = definition.acceptedTerms;
    need(terms.scheme === 'exact' && ['stellar:testnet','stellar:pubnet'].includes(terms.network) &&
      typeof terms.amount === 'string' && /^(0|[1-9]\d*)$/.test(terms.amount) &&
      text(terms.asset,256) && text(terms.payTo,128) &&
      Number.isSafeInteger(terms.maxTimeoutSeconds) && terms.maxTimeoutSeconds > 0,
      'APPLICATION_REMOTE_PAYMENT_TERMS_INVALID');
    // Keep every selected term, including extension fields, in the original canonical form.
    mcpJson(terms);
    const bodyText = mcpJson(definition.arguments), configSha256 = hash(mcpJson(definition,128*1024));
    const policyId = policy.endpoint + '\n' + policy.toolName;
    need(!policies.has(policyId) || same(policies.get(policyId),policy),
      'APPLICATION_REMOTE_POLICY_CONFLICT');
    policies.set(policyId,policy);
    requests.set(definition.intentId,{definition:structuredClone(definition),view:{
      intentId:definition.intentId,label:definition.label ?? definition.toolName,requestKind:'mcp',
      method:'tools/call',toolName:definition.toolName,transport:definition.transport,
      url:definition.endpoint,paymentResourceUrl:definition.paymentResourceUrl,
      inputSchemaSha256:definition.inputSchemaSha256 ?? null,paymentNetwork:terms.network,
      mode:'remote-mcp',acceptedTerms:structuredClone(terms),bodyText,
      bodyBytes:Buffer.byteLength(bodyText),bodySha256:hash(bodyText),configSha256,
      responseByteLimit:MAX_RESULT,actions:['review','execute','status','recover','read','export','cancel','spending','reconcile'],
    }});
  }
  return {config,sourceSha256,requests,policies:[...policies.values()],mcpJson};
}

const fileMetadata = file => file ? Object.fromEntries(
  ['status','bytes','sha256','contentType','representation','capturedAt','manifestStatus','recovered','error']
    .filter(key => file[key] !== undefined).map(key => [key,structuredClone(file[key])])) : null;
function publicQuote(quote) {
  const out = structuredClone(quote);
  if (out.result?.responseFile) out.result.responseFile = fileMetadata(out.result.responseFile);
  return out;
}
function publicBinding(entry,record) {
  return {intentId:entry.view.intentId,quoteId:record.quoteId,configSha256:entry.view.configSha256,
    bodySha256:entry.view.bodySha256,ticketSha256:record.ticketSha256};
}
function outcome(entry,record,quote,extra = {}) {
  const result = quote.result, file = fileMetadata(result?.responseFile);
  return {phase:quote.phase,source:'ORIGINAL_REMOTE_MCP',binding:publicBinding(entry,record),
    operation:{intentId:entry.view.intentId,quoteId:quote.quoteId,state:quote.status,
      nativeStatus:quote.status,attemptRecorded:quote.attempts > 0,
      signedRequestDispatched:quote.signedRequestDispatched,
      resultRecoverable:file?.status === 'SAVED',deliveryStatus:file?.status ?? 'NOT_RECEIVED'},
    result:result ? {native:true,status:quote.status,
      ok:['CONFIRMED_BY_SERVER','FREE_SUCCESS'].includes(quote.status),
      recordedAt:new Date(quote.updatedAt ?? quote.createdAt).toISOString(),
      runtimeError:quote.failure,delivery:file, paymentResponse:result.paymentResponse ?? null,
      reconciliation:result.reconciliation ?? null} : null,
    quote:publicQuote(quote),...extra};
}

/** Add the original governed remote buyer to the host's existing HTTP application. */
export async function attachRemoteMcpApplication({application,configurationFile,sourceRoot,stateDirectory,authorize} = {}) {
  need(application && typeof application.requests === 'function' && typeof application.call === 'function' &&
    typeof authorize === 'function','APPLICATION_HOST_AUTHORIZATION_REQUIRED');
  const selected = await inspectRemoteMcp(configurationFile,{sourceRoot});
  const {config,sourceSha256,requests,policies,mcpJson} = selected;
  need(Array.isArray(application.selectedIntentIds) && application.selectedIntentIds.every(intent => !requests.has(intent)),
    'APPLICATION_REMOTE_INTENT_COLLISION');
  const applicationId = application.identity.applicationId;
  const root = join(absolute(stateDirectory),'remote-mcp');
  await privateDirectory(root);
  const identity = {schema:STATE,applicationId,sourceSha256,configurationFile,sourceRoot,
    operatorModule:config.operatorModule};
  const identityFile = join(root,'application.json'), previous = await optionalJSON(identityFile);
  if (previous) need(same(previous,identity),'APPLICATION_REMOTE_SELECTION_CHANGED');
  else await saveJSON(identityFile,identity);
  const recordPath = entry => join(root,hash(entry.view.intentId) + '.json');
  const pending = new Map(), executions = new Map();
  let closed = false, closing, operator, quoteStore, resultStore, broker;
  async function current() {
    need(!closed,'APPLICATION_REMOTE_CLOSED');
    need(hash(await readBytes(configurationFile,2*1024*1024)) === sourceSha256 &&
      same(await optionalJSON(identityFile),identity),'APPLICATION_REMOTE_SELECTION_CHANGED');
  }
  async function permitted(context,action,entry) {
    need(object(context) && text(context.subject,256),'APPLICATION_AUTHENTICATED_SUBJECT_REQUIRED');
    need(await authorize({context:structuredClone(context),action,applicationId,
      request:entry ? structuredClone(entry.view) : null}) === true,'APPLICATION_AUTHORIZATION_DENIED');
  }
  function checkQuote(entry,record,quote) {
    const d = entry.definition, invocation = quote.invocation;
    need(record.schema === REQUEST && record.applicationId === applicationId &&
      record.sourceSha256 === sourceSha256 && record.intentId === d.intentId &&
      record.quoteId === quote.quoteId && quote.method === 'tools/call' &&
      quote.requestUrl === d.endpoint && same(quote.acceptedTerms,d.acceptedTerms) &&
      same(quote.acceptedTerms,record.acceptedTerms) && same(invocation,record.invocation) &&
      invocation?.endpoint === d.endpoint && invocation.toolName === d.toolName &&
      invocation.transport === d.transport && invocation.paymentResourceUrl === d.paymentResourceUrl &&
      same(invocation.arguments,d.arguments) && invocation.argumentsSha256 === entry.view.bodySha256 &&
      (d.inputSchemaSha256 === undefined || invocation.inputSchemaSha256 === d.inputSchemaSha256) &&
      record.ticketSha256 === hash(mcpJson({quoteId:record.quoteId,invocation,
        acceptedTerms:record.acceptedTerms},128*1024)), 'APPLICATION_REMOTE_QUOTE_BINDING_CHANGED');
    return quote;
  }
  async function attached(entry,context,{optional = false} = {}) {
    const record = await optionalJSON(recordPath(entry));
    if (!record) { need(optional,'APPLICATION_REQUEST_NOT_PREPARED'); return null; }
    need(record.subject === context.subject,'APPLICATION_SUBJECT_BINDING_CHANGED');
    return {record,quote:checkQuote(entry,record,broker.status({quoteId:record.quoteId}))};
  }
  async function executionAuthority(quote) {
    const owner = executions.get(quote.quoteId);
    need(owner,'APPLICATION_REMOTE_EXECUTION_CONTEXT_REQUIRED');
    checkSignal(owner.signal); checkSignal(quote.signal);
    await current(); await permitted(owner.context,'execute',owner.entry);
    checkSignal(owner.signal); checkSignal(quote.signal);
    await attached(owner.entry,owner.context);
    return owner;
  }
  try {
    const [native,quotes,results] = await Promise.all([
      nativeSource(sourceRoot,'agent-server.mjs'),nativeSource(sourceRoot,'quote-store.mjs'),
      nativeSource(sourceRoot,'result-store.mjs')]);
    const operatorModule = await import(pathToFileURL(config.operatorModule).href);
    operator = typeof operatorModule.openOperator === 'function' ? await operatorModule.openOperator() : operatorModule;
    need(['approve','signPayment','spendingStatus','reconcilePayment','close'].every(key =>
      typeof operator[key] === 'function'),'APPLICATION_REMOTE_GOVERNED_OPERATOR_REQUIRED');
    quoteStore = new quotes.SqliteQuoteStore({directory:join(root,'quotes')});
    resultStore = new results.McpResultStore({directory:join(quoteStore.directory,'results')});
    broker = new native.McpPaidToolBroker({
      discoveryUrl:config.discoveryUrl,allowedResourceOrigins:config.allowedResourceOrigins,
      timeoutMs:config.timeoutMs ?? 30000,remoteMcpPolicies:policies,quoteStore,resultStore,
      ...(operator.fetchImpl ? {fetchImpl:operator.fetchImpl} : {}),
      approve:async quote => {
        await executionAuthority(quote);
        const allowed = await operator.approve(quote);
        // A host grant may change while the native terminal waits for a human.
        try { await executionAuthority(quote); }
        catch (error) { broker.cancel({quoteId:quote.quoteId}); throw error; }
        return allowed === true;
      },
      signPayment:async quote => {
        // Check the same authenticated owner immediately before the original
        // governor reserves aggregate funds and the native SDK signs.
        await executionAuthority(quote);
        return operator.signPayment(quote);
      },
      spendingStatus:(...args) => operator.spendingStatus(...args),
      reconcilePayment:input => operator.reconcilePayment(input),
    });
  } catch (error) {
    if (broker) await broker.close();
    else { await resultStore?.close(); quoteStore?.close(); }
    await operator?.close?.(); throw error;
  }
  async function discover(entry,signal) {
    const d = entry.definition, terms = d.acceptedTerms, cursors = new Set();
    let cursor;
    for (;;) {
      checkSignal(signal);
      const page = await broker.search({query:d.query,limit:100,network:terms.network,scheme:terms.scheme,
        asset:terms.asset,maxAmount:terms.amount,...(cursor ? {cursor} : {})});
      for (const row of page.resources) {
        if (row.resourceType !== 'mcp' || row.resource?.url !== d.endpoint || row.toolName !== d.toolName) continue;
        const description = broker.describe({handle:row.handle});
        const remote = description.preview?.remoteMcp;
        if (!remote || remote.endpoint !== d.endpoint || remote.toolName !== d.toolName ||
            remote.transport !== d.transport || remote.paymentResourceUrl !== d.paymentResourceUrl ||
            (d.inputSchemaSha256 && remote.inputSchemaSha256 !== d.inputSchemaSha256)) continue;
        const alternatives = description.accepts;
        need(Array.isArray(alternatives),'APPLICATION_REMOTE_DISCOVERY_INVALID');
        const matches = alternatives.map((offer,index) => same(offer,terms) ? index : -1).filter(index => index >= 0);
        if (matches.length !== 1) continue;
        checkSignal(signal);
        return broker.preview({handle:row.handle,acceptIndex:matches[0],input:{arguments:d.arguments}});
      }
      const next = page.pagination?.nextCursor ?? page.pagination?.cursor;
      if (!next || page.pagination?.hasMore === false) break;
      need(typeof next === 'string' && !cursors.has(next) && cursors.size < 100,
        'APPLICATION_REMOTE_DISCOVERY_CURSOR_INVALID');
      cursors.add(next); cursor = next;
    }
    throw fail('APPLICATION_REMOTE_SELECTED_OFFER_NOT_FOUND');
  }
  async function review(entry,context,signal) {
    let saved = await attached(entry,context,{optional:true});
    const expired = saved && ['PREVIEWED','EXPIRED'].includes(saved.quote.status) &&
      saved.quote.expiresAt <= Date.now() && saved.quote.attempts === 0 && !saved.quote.signedRequestDispatched;
    if (expired) {
      const budget = await broker.spendingStatus({quoteId:saved.quote.quoteId});
      need(budget.outcome === 'NOT_RESERVED' && !budget.reservation,'APPLICATION_REMOTE_RESERVATION_EXISTS');
    }
    if (!saved || expired) {
      const quote = await discover(entry,signal);
      await current(); await permitted(context,'review',entry); checkSignal(signal);
      const record = {schema:REQUEST,applicationId,sourceSha256,intentId:entry.view.intentId,
        subject:context.subject,quoteId:quote.quoteId,invocation:structuredClone(quote.invocation),
        acceptedTerms:structuredClone(quote.acceptedTerms),reviewedAt:new Date().toISOString(),
        ticketSha256:hash(mcpJson({quoteId:quote.quoteId,invocation:quote.invocation,
          acceptedTerms:quote.acceptedTerms},128*1024)),
        previousQuoteIds:saved ? [...(saved.record.previousQuoteIds ?? []),saved.record.quoteId] : []};
      checkQuote(entry,record,quote);
      await saveJSON(recordPath(entry),record,{replace:Boolean(saved)});
      saved = {record,quote};
    }
    const spending = await broker.spendingStatus({quoteId:saved.record.quoteId});
    return {request:{...structuredClone(entry.view),inputSchemaSha256:saved.quote.invocation.inputSchemaSha256},
      binding:publicBinding(entry,saved.record),review:{reviewedAt:saved.record.reviewedAt,
        native:{mode:'remote-mcp',quote:publicQuote(saved.quote)},spending}};
  }
  async function readResult(entry,record,quote,options) {
    const format = options.format ?? 'json', limit = options.limitBytes ?? MAX_RESULT;
    need(['json','text','base64','file'].includes(format) && Number.isSafeInteger(limit) &&
      limit >= 1 && limit <= MAX_RESULT,'APPLICATION_READ_OPTIONS_INVALID');
    const file = quote.result?.responseFile;
    need(file?.status === 'SAVED','RESULT_NOT_AVAILABLE');
    need(file.bytes <= limit,'APPLICATION_RESULT_LIMIT_EXCEEDED');
    const chunks = []; let offset = 0;
    do {
      checkSignal(options.signal);
      const page = await broker.readResult({quoteId:record.quoteId,byteOffset:offset,
        maxBytes:format === 'file' ? 1 : 65536});
      need(page.quoteId === record.quoteId && page.bytes === file.bytes && page.sha256 === file.sha256 &&
        page.byteOffset === offset && page.encoding === 'base64','APPLICATION_REMOTE_RESULT_BINDING_CHANGED');
      const chunk = Buffer.from(page.data,'base64');
      need(chunk.length === page.returnedBytes && (page.nextByteOffset === null ||
        page.nextByteOffset === offset + chunk.length && page.nextByteOffset > offset),
        'APPLICATION_REMOTE_RESULT_RANGE_INVALID');
      if (format === 'file') break; // The original store verifies the entire file before every first range.
      chunks.push(chunk); offset += chunk.length;
      if (page.nextByteOffset === null) break;
    } while (offset <= file.bytes);
    let data;
    if (format !== 'file') {
      const bytes = Buffer.concat(chunks);
      need(bytes.length === file.bytes && hash(bytes) === file.sha256,'APPLICATION_REMOTE_RESULT_BINDING_CHANGED');
      data = format === 'base64' ? bytes.toString('base64') :
        new TextDecoder('utf-8',{fatal:true}).decode(bytes);
      if (format === 'json') data = JSON.parse(data);
    }
    return {format,partial:false,binding:publicBinding(entry,record),
      result:{nativeStatus:quote.status,recordedAt:new Date(quote.updatedAt ?? quote.createdAt).toISOString(),
        deliveryStatus:file.status,file:fileMetadata(file),representation:file.representation},
      ...(format === 'file' ? {} : {data})};
  }
  const remote = {
    selectedIntentIds:Object.freeze([...application.selectedIntentIds,...requests.keys()]),
    identity:{...application.identity,remoteMcp:{schema:SCHEMA,sourceSha256,requests:requests.size,
      responseByteLimit:MAX_RESULT,readiness:structuredClone(operator.readiness?.aggregateSpending ?? null)}},
    responseByteLimit(intentId) { return requests.has(intentId) ? MAX_RESULT :
      application.responseByteLimit?.(intentId) ?? 1048576; },
    supportsAction(action) { return ['cancel','spending','reconcile'].includes(action); },
    async requests(context) {
      await current();
      const original = await application.requests(context);
      need(original.requests.every(entry => !requests.has(entry.intentId)),'APPLICATION_REMOTE_INTENT_COLLISION');
      await permitted(context,'list',null);
      const rows = [];
      for (const entry of requests.values()) {
        try {
          await permitted(context,'status',entry);
          const saved = await attached(entry,context,{optional:true});
          rows.push({...structuredClone(entry.view),
            ...(saved ? {inputSchemaSha256:saved.quote.invocation.inputSchemaSha256,
              state:outcome(entry,saved.record,saved.quote).operation} : {state:{state:'AVAILABLE'}})});
        } catch (error) {
          if (!['APPLICATION_AUTHORIZATION_DENIED','APPLICATION_SUBJECT_BINDING_CHANGED'].includes(error.code)) throw error;
        }
      }
      return {...original,remoteMcpSourceSha256:sourceSha256,requests:[...original.requests,...rows]};
    },
    async call(context,action,intentId,options = {}) {
      if (!requests.has(intentId)) return application.call(context,action,intentId,options);
      const entry = requests.get(intentId);
      need(entry.view.actions.includes(action),'APPLICATION_ACTION_INVALID');
      need(keys(options,['signal','format','limitBytes','destination','transaction']) &&
        (options.transaction === undefined || action === 'reconcile') &&
        (options.destination === undefined || action === 'export') &&
        (options.format === undefined && options.limitBytes === undefined || action === 'read'),
        'APPLICATION_OPTIONS_INVALID');
      await current(); await permitted(context,action,entry); checkSignal(options.signal);
      if (pending.has(intentId) && !['status','cancel','spending'].includes(action))
        throw fail('APPLICATION_OPERATION_RUNNING');
      const operation = (async () => {
        if (action === 'review') return review(entry,context,options.signal);
        const {record,quote} = await attached(entry,context);
        const args = {quoteId:record.quoteId};
        if (action === 'status') return outcome(entry,record,quote);
        if (action === 'cancel') return outcome(entry,record,broker.cancel(args));
        if (action === 'spending') return outcome(entry,record,quote,{spending:await broker.spendingStatus(args)});
        if (action === 'reconcile') return outcome(entry,record,await broker.reconcilePayment(
          {...args,...(options.transaction ? {transaction:options.transaction} : {})}));
        if (action === 'recover') {
          if (quote.result?.responseFile?.status === 'SAVED' || quote.result?.responseFile)
            return outcome(entry,record,await broker.recoverResult(args));
          return outcome(entry,record,quote);
        }
        if (action === 'read') return readResult(entry,record,quote,options);
        if (action === 'export') {
          absolute(options.destination);
          const artifact = await readResult(entry,record,quote,{format:'base64',signal:options.signal});
          checkSignal(options.signal); await permitted(context,'export',entry);
          await saveBytes(options.destination,Buffer.from(artifact.data,'base64'));
          return {intentId,quoteId:record.quoteId,exported:{destination:options.destination,...artifact.result.file}};
        }
        await permitted(context,'execute',entry); checkSignal(options.signal);
        executions.set(record.quoteId,{context:structuredClone(context),entry,signal:options.signal});
        const aborted = () => { try { broker.cancel(args); } catch { /* Original broker retains any persistence error. */ } };
        options.signal?.addEventListener('abort',aborted,{once:true});
        try {
          if (options.signal?.aborted) aborted();
          return outcome(entry,record,await broker.execute(args));
        } finally {
          options.signal?.removeEventListener('abort',aborted); executions.delete(record.quoteId);
        }
      })();
      const mutating = !['status','cancel','spending'].includes(action);
      if (mutating) pending.set(intentId,operation);
      try { return await operation; } finally { if (mutating) pending.delete(intentId); }
    },
    close() {
      if (closing) return closing;
      closed = true;
      closing = (async () => {
        try { await broker.close(); await Promise.allSettled([...pending.values()]); }
        finally { try { await operator.close(); } finally { await application.close(); } }
      })();
      return closing;
    },
  };
  return remote;
}

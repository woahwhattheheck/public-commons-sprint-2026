// MIT. GoldRush wallet work on the original Node buyer, inbox and resource library.
import { mkdir, lstat, readFile, readdir } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { sourceRoot, nativePath, nativeImport, readJson, sha256, argumentsMap, required } from './runtime.mjs';
import { loadCustomerRelease, buildCustomerRequest } from './customer.mjs';
import { parseWalletResponse, compareWalletResponses, walletCsv } from './wallet-data.mjs';
import { serveLibrary } from '../../../sf88-operator-buyer-cli/resource-library/server.mjs';

const SCHEMA = 'stellar-forge.goldrush-workbench.v1';
const LIMIT = 1048576;
const CAPTURE = {responseFile:{maxBytes:LIMIT,timeoutMs:30000,expectedContentType:'application/json'},requestTimeoutMs:90000};
const own = (value,key) => Object.prototype.hasOwnProperty.call(value,key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const canonical = value => JSON.stringify(value, function(key,item) {
  return object(item) ? Object.fromEntries(Object.keys(item).sort().map(name => [name,item[name]])) : item;
});
function need(condition,code,status=400) {
  if (!condition) throw Object.assign(new Error(code),{code,status});
}
function exact(value,keys) {
  need(object(value) && Object.keys(value).every(key => keys.includes(key)),'GOLDRUSH_REQUEST_FIELDS_INVALID');
}
function intent(value) {
  need(typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value),'GOLDRUSH_INTENT_REQUIRED');
  return value;
}
function oneQuery(url,key,fallback) {
  need(url.searchParams.getAll(key).length <= 1,'GOLDRUSH_DUPLICATE_QUERY');
  return url.searchParams.get(key) ?? fallback;
}
function requestScope(operation) {
  const url = new URL(operation.url);
  const parts = /^\/v1\/([^/]+)\/address\/(0x[0-9a-fA-F]{40})\/(balances_v2|transfers_v2)\/?$/.exec(url.pathname);
  need(operation.method === 'GET' && parts && !url.username && !url.password,'GOLDRUSH_REQUEST_SCOPE_INVALID');
  const query = {};
  for (const [name,value] of url.searchParams) {
    need(!own(query,name),'GOLDRUSH_DUPLICATE_QUERY');
    query[name] = value;
  }
  return {operation:parts[3] === 'balances_v2' ? 'balances' : 'transfers',
    chain:parts[1],wallet:parts[2],query};
}
function jobView(job) {
  const value = {id:job.id,intentId:job.operation?.intentId,state:job.state,source:'inbox',
    createdAt:job.createdAt,configSha256:job.configSha256,
    method:job.operation?.method,url:job.operation?.url,expect:job.operation?.expect,
    outcome:job.outcome ? {status:job.outcome.status,httpStatus:job.outcome.httpStatus,
      deliveryStatus:job.outcome.responseFile?.status ?? 'NOT_REQUESTED'} : null};
  try { value.scope = requestScope(job.operation); } catch { value.scope = null; }
  return value;
}
async function configFor(options,root) {
  const {writeJson} = await nativeImport(root,'sf88-operator-buyer-cli/node/store.mjs');
  const state = resolve(required(options,'--state'));
  await mkdir(state,{recursive:true,mode:0o700});
  const st = await lstat(state);
  need(st.isDirectory() && !st.isSymbolicLink() &&
    (process.platform === 'win32' || (st.mode & 0o077) === 0),'PRIVATE_WORKBENCH_DIRECTORY_REQUIRED');
  const file = join(state,'workbench.json');
  let config;
  try { config = (await readJson(file,65536)).value; }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    need(!(options.has('--workspace') && options.has('--profile')),'CHOOSE_ORIGINAL_WORKSPACE_OR_PROFILE');
    config = {schema:SCHEMA,id:randomUUID(),createdAt:new Date().toISOString(),
      release:resolve(required(options,'--release')),
      buyerState:resolve(required(options,'--buyer-state')),inbox:resolve(required(options,'--inbox')),
      workspace:options.has('--workspace') ? resolve(options.get('--workspace')) : null,
      profile:options.has('--profile') ? resolve(options.get('--profile')) : null,
      referenceFile:options.has('--reference-file') ? resolve(options.get('--reference-file')) : null};
    try { await writeJson(file,config,{exclusive:true}); }
    catch (problem) {
      if (problem.code !== 'EEXIST') throw problem;
      config = (await readJson(file,65536)).value;
    }
  }
  need(config.schema === SCHEMA && typeof config.id === 'string','GOLDRUSH_WORKBENCH_CONFIG_INVALID');
  for (const [flag,key] of [['--release','release'],['--buyer-state','buyerState'],
    ['--inbox','inbox'],['--workspace','workspace'],['--profile','profile']]) {
    need(!options.has(flag) || resolve(options.get(flag)) === config[key],
      'GOLDRUSH_WORKBENCH_BINDING_CHANGED',409);
  }
  need(typeof config.release === 'string' && typeof config.buyerState === 'string' &&
    typeof config.inbox === 'string' && !(config.workspace && config.profile),'GOLDRUSH_WORKBENCH_CONFIG_INVALID');
  await mkdir(join(state,'requests'),{recursive:true,mode:0o700});
  return {state,config,referenceFile:options.has('--reference-file') ?
    resolve(options.get('--reference-file')) : config.referenceFile};
}
async function observations(file) {
  if (!file) return [];
  const {value} = await readJson(file,65536);
  need(value.schema === 'stellar-forge.goldrush-observations.v1' &&
    Array.isArray(value.observations) && value.observations.length <= 100,'GOLDRUSH_OBSERVATIONS_INVALID');
  const ids = new Set();
  return value.observations.map(row => {
    need(object(row) && typeof row.id === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(row.id) &&
      !ids.has(row.id) && ['balances','transfers'].includes(row.operation) &&
      typeof row.path === 'string' && /^[a-f0-9]{64}$/.test(row.sha256 ?? '') &&
      Number.isSafeInteger(row.bytes) && row.bytes > 0 && row.bytes <= LIMIT &&
      object(row.source) && typeof row.source.operator === 'string' &&
      typeof row.source.url === 'string' && typeof row.source.retrievedAt === 'string',
      'GOLDRUSH_OBSERVATION_BINDING_INVALID');
    const url = new URL(row.source.url);
    need(url.protocol === 'https:' && !url.username && !url.password,'GOLDRUSH_OBSERVATION_URL_INVALID');
    ids.add(row.id);
    return {...row,path:resolve(dirname(file),row.path)};
  });
}
export async function openWorkbench({state,config,referenceFile,root}) {
  const {Buyer} = await nativeImport(root,'sf88-operator-buyer-cli/node/index.mjs');
  const {writeJson} = await nativeImport(root,'sf88-operator-buyer-cli/node/store.mjs');
  const {openQueue} = await nativeImport(root,'sf88-operator-buyer-cli/queue.mjs');
  const {openLibrary} = await nativeImport(root,'sf88-operator-buyer-cli/resource-library/library.mjs');
  const buyer = await new Buyer({runtimeDirectory:nativePath(root,'sf88-operator-buyer-cli'),
    stateDirectory:config.buyerState,...(config.profile ? {operatorProfile:config.profile} : {})}).ready();
  let inbox;
  try { await lstat(config.inbox); inbox = buyer.inbox(config.inbox); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    inbox = await buyer.createInbox({directory:config.inbox});
  }
  const queue = await openQueue(config.inbox);
  const library = await openLibrary({state:join(state,'resources'),kind:'inbox',source:config.inbox,
    roots:[config.buyerState,config.inbox],maxFileBytes:LIMIT,indexBytes:LIMIT});
  const active = new Set();
  const exclusive = async (id,run) => {
    need(!active.has(id),'ORIGINAL_INTENT_ACTION_RUNNING',409);
    active.add(id);
    try { return await run(); } finally { active.delete(id); }
  };
  async function resourcesFor(jobs) {
    // This is a view of the original library's current generation, not another index.
    const resources = library.exportReview().resources;
    const byIntent = new Map();
    for (const resource of resources) {
      const rows = byIntent.get(resource.intentId) ?? [];
      rows.push({id:resource.id,status:resource.status,sha256:resource.sha256,
        bytes:resource.bytes,contentType:resource.contentType});
      byIntent.set(resource.intentId,rows);
    }
    return jobs.map(job => ({...jobView(job),resources:byIntent.get(job.operation?.intentId) ?? []}));
  }
  async function nodeJob(id) {
    const retained=buyer.operation(id);
    // The original SDK validates its retained configuration and file bindings.
    const {meta,config:saved}=await retained._bound();
    const inspected=await retained.inspect(), result=await retained.recover();
    return {...jobView({id:sha256(id),operation:saved.operation,state:inspected.state,
      createdAt:meta.createdAt,configSha256:meta.configSha256,outcome:result?.native ?? null}),
      source:'node',operatorConfigured:Boolean(saved.operator && saved.signerModule),
      inboxDirectory:inspected.inboxDirectory ?? null,resources:[]};
  }
  async function nodePreparations(queuedIds) {
    const rows=[];
    for(const entry of await readdir(join(state,'requests'),{withFileTypes:true})) {
      if(!/^[a-f0-9]{64}\.json$/.test(entry.name))continue;
      need(entry.isFile() && !entry.isSymbolicLink(),'GOLDRUSH_REQUEST_FILE_INVALID');
      const {value:authored}=await readJson(join(state,'requests',entry.name),65536);
      const id=intent(authored.operation?.intentId);
      need(entry.name===sha256(id)+'.json','GOLDRUSH_REQUEST_ID_CHANGED');
      if(queuedIds.has(id))continue;
      try {rows.push(await nodeJob(id));}
      catch(error) {
        rows.push({...jobView({id:sha256(id),operation:authored.operation,
          state:'REVIEW_REQUIRED',createdAt:null,configSha256:null}),
          source:'node',resources:[],error:error.code ?? 'GOLDRUSH_PREPARATION_UNAVAILABLE'});
      }
    }
    return rows;
  }
  async function context({offset=0,q=''}={}) {
    need(Number.isSafeInteger(offset) && offset >= 0 && offset <= 100000 &&
      typeof q === 'string' && q.length <= 200,'GOLDRUSH_LIST_QUERY_INVALID');
    const release = await loadCustomerRelease(config.release);
    const queued=await queue.list();
    const jobs=[...await resourcesFor(queued),
      ...await nodePreparations(new Set(queued.map(job=>job.operation?.intentId)))]
      .filter(job=>job.scope)
      .filter(job=>!q || [job.intentId,job.url,job.state].join(' ').toLowerCase().includes(q.toLowerCase()))
      .sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)) || a.id.localeCompare(b.id));
    let refs = [], observationsError = null;
    try { refs = await observations(referenceFile); }
    catch (error) { observationsError = error.code ?? 'GOLDRUSH_OBSERVATION_MANIFEST_INVALID'; }
    return {schema:SCHEMA,id:config.id,release:{sha256:release.sha256,manifest:release.manifest,
      operations:release.client.operations},workspaceConfigured:Boolean(config.workspace),
      profileConfigured:Boolean(config.profile),library:library.status(),
      jobs:{offset,limit:50,total:jobs.length,items:jobs.slice(offset,offset+50)},
      observations:refs.map(({path,...row}) => row),observationsError,activeIntents:[...active]};
  }
  async function prepare(input,{signal}={}) {
    exact(input,['operation','chain','wallet','query','intentId','acceptIndex','maxAtomic','paymentFlow','releaseSha256']);
    const id = intent(input.intentId);
    return exclusive(id,async () => {
      signal?.throwIfAborted();
      const release = await loadCustomerRelease(config.release);
      need(input.releaseSha256 === release.sha256,'GOLDRUSH_RELEASE_CHANGED_REFRESH',409);
      const operation = await buildCustomerRequest({selectedRelease:release,operation:input.operation,
        inputs:{path:{chainName:input.chain,walletAddress:input.wallet},query:input.query ?? {}},
        intentId:id,acceptIndex:input.acceptIndex,maxAtomic:input.maxAtomic,paymentFlow:input.paymentFlow},root);
      const file = join(state,'requests',sha256(id)+'.json'), authored = {operation};
      try { await writeJson(file,authored,{exclusive:true}); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        need(canonical((await readJson(file,65536)).value) === canonical(authored),'GOLDRUSH_INTENT_REQUEST_CONFLICT',409);
      }
      let retained;
      try {
        retained = config.workspace
          ? await buyer.fromWorkspace(config.workspace,{...CAPTURE,configuration:file,signal})
          : await buyer.fromConfig(authored,CAPTURE);
      } catch (error) {
        if (error.code !== 'INTENT_ALREADY_EXISTS_USE_RECOVER') throw error;
        retained = buyer.operation(id);
        const saved = (await readJson(retained.configPath,65536)).value;
        need(canonical(saved.operation) === canonical(operation),'GOLDRUSH_EXISTING_INTENT_DIFFERS',409);
      }
      signal?.throwIfAborted();
      const {config:saved}=await retained._bound();
      if(!saved.operator || !saved.signerModule) {
        const review=await retained.review();
        return {status:'PREPARED_OFFLINE',job:await nodeJob(id),review};
      }
      const {execution}=await nativeImport(root,'sf88-operator-buyer-cli/config.mjs');
      execution(saved);
      await inbox.enqueue(retained,{signal});
      const review = await inbox.review(id,{signal});
      return {status:'PREPARED',job:jobView((await inbox.show(id,{signal})).native),review};
    });
  }
  async function selected(selection,{signal}={}) {
    exact(selection,['kind','id']);
    need(typeof selection.id === 'string','GOLDRUSH_SELECTION_REQUIRED');
    if (selection.kind === 'reference') {
      const row = (await observations(referenceFile)).find(value => value.id === selection.id);
      need(row,'GOLDRUSH_OBSERVATION_NOT_FOUND',404);
      signal?.throwIfAborted();
      const stat = await lstat(row.path);
      need(stat.isFile() && !stat.isSymbolicLink() && stat.size === row.bytes,'GOLDRUSH_OBSERVATION_BYTES_CHANGED',409);
      const bytes = await readFile(row.path);
      need(bytes.length === row.bytes && sha256(bytes) === row.sha256,'GOLDRUSH_OBSERVATION_BYTES_CHANGED',409);
      const source = {...row.source,kind:'reference',id:row.id,sha256:row.sha256,bytes:row.bytes};
      const snapshot = parseWalletResponse(new TextDecoder('utf-8',{fatal:true}).decode(bytes),{
        operation:row.operation,chain:row.chain,wallet:row.wallet,query:row.query ?? {},source});
      return {selection,snapshot,annotation:null,resource:null};
    }
    need(selection.kind === 'buyer','GOLDRUSH_SELECTION_KIND_INVALID');
    const resource = library.resource(selection.id);
    need(resource.status === 'VERIFIED' && resource.deliveryStatus === 'SAVED' &&
      resource.httpStatus >= 200 && resource.httpStatus < 300,'GOLDRUSH_SUCCESSFUL_SAVED_RESPONSE_REQUIRED',409);
    const job = (await inbox.show(resource.intentId,{signal})).native;
    need(job.configSha256 === resource.configSha256 &&
      job.outcome?.responseFile?.sha256 === resource.sha256,'GOLDRUSH_SOURCE_BINDING_CHANGED',409);
    const scope = requestScope(job.operation);
    const preview = await library.preview(resource.id,{signal});
    need(preview.coverage === 'COMPLETE' && typeof preview.text === 'string' &&
      preview.bytes <= LIMIT,'GOLDRUSH_COMPLETE_JSON_REQUIRED',409);
    const snapshot = parseWalletResponse(preview.text,{...scope,source:{kind:'buyer',id:resource.id,
      sha256:preview.sha256,bytes:preview.bytes,url:job.operation.url,
      retrievedAt:null,requestCreatedAt:resource.createdAt,operator:new URL(job.operation.url).origin}});
    return {selection,snapshot,annotation:library.resource(resource.id).annotation,
      resource:{id:resource.id,intentId:resource.intentId,sha256:resource.sha256,bytes:resource.bytes,
        configSha256:resource.configSha256},job:jobView(job)};
  }
  async function handle({request,response,url,signal,send,body:readBody}) {
    if (!url.pathname.startsWith('/api/goldrush/')) return false;
    const route = url.pathname.slice('/api/goldrush/'.length), method = request.method;
    if (method === 'GET' && route === 'context')
      send(await context({offset:Number(oneQuery(url,'offset','0')),q:oneQuery(url,'q','')}));
    else if (method === 'POST' && route === 'prepare') send(await prepare(await readBody(),{signal}),201);
    else if (method === 'POST' && ['review','execute','recover','finalize'].includes(route)) {
      const input = await readBody();
      exact(input,route === 'execute' ? ['intentId','review'] : ['intentId']);
      const id = intent(input.intentId);
      const result = await exclusive(id,async () => {
        const published=(await queue.list()).some(job=>job.operation?.intentId===id);
        if(!published) {
          const job=await nodeJob(id);
          need(job.scope,'GOLDRUSH_REQUEST_SCOPE_INVALID');
          need(['review','recover'].includes(route),'GOLDRUSH_PREPARED_OPERATOR_REQUIRED',409);
          if(route==='review')return {job,review:await buyer.operation(id).review()};
          return {job:await nodeJob(id)};
        }
        const job = (await inbox.show(id,{signal})).native;
        requestScope(job.operation);
        if (route === 'review') return {job:jobView(job),review:await inbox.review(id,{signal})};
        if (route === 'finalize') need(config.workspace,'ORIGINAL_WORKSPACE_REQUIRED');
        const action = route === 'execute'
          ? await inbox.execute(id,{review:input.review,...(config.workspace ? {workspaceDirectory:config.workspace} : {}),signal})
          : route === 'recover' ? await inbox.recover(id,{signal})
          : await inbox.finalize(id,{workspaceDirectory:config.workspace,signal});
        return {job:jobView(action.native)};
      });
      send(result);
    } else if (method === 'POST' && route === 'refresh') {
      exact(await readBody(),[]);
      send({scan:await library.scan({signal})});
    } else if (method === 'GET' && route === 'response') {
      send(await selected({kind:oneQuery(url,'kind','buyer'),id:oneQuery(url,'id','')},{signal}));
    } else if (method === 'POST' && route === 'compare') {
      const input = await readBody(); exact(input,['left','right']);
      const left = await selected(input.left,{signal}), right = await selected(input.right,{signal});
      send(compareWalletResponses(left.snapshot,right.snapshot));
    } else if (method === 'GET' && route === 'export') {
      const value = await selected({kind:oneQuery(url,'kind','buyer'),id:oneQuery(url,'id','')},{signal});
      const format = oneQuery(url,'format','json');
      need(['json','csv'].includes(format),'GOLDRUSH_EXPORT_FORMAT_INVALID');
      response.setHeader('Content-Disposition','attachment; filename="goldrush-'+value.snapshot.operation+'.'+format+'"');
      if (format === 'json') send(value);
      else {
        const bytes = Buffer.from(walletCsv(value.snapshot));
        response.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Length':bytes.length});
        response.end(bytes);
      }
    } else need(false,'GOLDRUSH_ROUTE_NOT_FOUND',404);
    return true;
  }
  return {state,config,buyer,inbox,library,context,prepare,selected,handle,async close() {await library.close();}};
}
export async function main(args=process.argv.slice(2)) {
  const options = argumentsMap(args,['--state','--release','--buyer-state','--inbox',
    '--workspace','--profile','--reference-file','--source-root','--port']);
  const root = sourceRoot(options.get('--source-root')), binding = await configFor(options,root);
  const app = await openWorkbench({...binding,root});
  let listener;
  try {
    await app.library.scan();
    const assets = await Promise.all([['/goldrush','wallet-view.html','text/html'],
      ['/goldrush/app.js','wallet-view.js','text/javascript'],['/goldrush/style.css','wallet-view.css','text/css']]
      .map(async ([route,file,type]) => ({route,bytes:await readFile(new URL(file,import.meta.url)),type})));
    listener = await serveLibrary(app.library,{port:Number(options.get('--port') ?? 0),
      additionalAssets:assets,authenticatedRoute:app.handle});
    const url = listener.origin + '/goldrush#' + listener.token;
    process.stdout.write(JSON.stringify({status:'GOLDRUSH_WORKBENCH_READY',url,state:binding.state,
      workspaceId:binding.config.id})+'\n');
    let closing;
    const close = () => closing ??= (async () => {await listener.close();await app.close();})();
    const stop = () => {void close().catch(() => {process.exitCode=1;});};
    process.once('SIGINT',stop);process.once('SIGTERM',stop);
    return {app,listener,url,close};
  } catch (error) {
    if (listener) await listener.close();
    await app.close();throw error;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => {process.stderr.write((error.code ?? 'GOLDRUSH_WORKBENCH_FAILED')+'\n');process.exitCode=1;});

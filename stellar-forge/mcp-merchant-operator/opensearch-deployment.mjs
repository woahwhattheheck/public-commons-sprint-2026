// MIT. MCP access to the original OpenSearch managed deployment and customer exports.
import { lstat, realpath } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import { createHash } from 'node:crypto';
import { exact, failure, identifier, line, privateSupportDirectory } from './config.mjs';
import { RetainedFileReads, MAX_RETAINED_CHUNK_BYTES } from './retained-file-reads.mjs';

const alias = {type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'};
const originalId = {type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$'};
const generation = {type:'integer',minimum:0};
const digest = {type:'string',pattern:'^[0-9a-f]{64}$'};
const offset = {type:'integer',minimum:0};
const readId = {type:'string',minLength:1,maxLength:160};
const chunks = {readId,expectedSha256:digest,offset,limit:{type:'integer',minimum:1,maximum:MAX_RETAINED_CHUNK_BYTES}};
const omit = (value,keys) => Object.fromEntries(Object.entries(value ?? {}).filter(([key]) => !keys.includes(key)));
const pick = (value,keys) => Object.fromEntries(keys.filter(key => Object.hasOwn(value ?? {},key)).map(key => [key,value[key]]));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function integer(value,label,min=0,max=Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw failure('INVALID_PARAMS',label+' must be an integer from '+min+' to '+max+'.');
  return value;
}
function record(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(value))
    throw failure('INVALID_PARAMS','Use the original request or seller instance ID.');
  return value;
}
function reviewed(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value))
    throw failure('INVALID_PARAMS','Use the original inspected SHA-256.');
  return value;
}
function retainedReadId(value) {
  if (typeof value !== 'string' || !value || value.length > 160)
    throw failure('INVALID_PARAMS','Use the original retained file read ID.');
  return value;
}
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  return '{'+Object.keys(value).sort().map(key => JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
}

/** Runtime options are selected by the host connection, never by MCP arguments. */
export function openSearchRuntimeOptions(raw={}) {
  exact(raw,['port','facilitator','allowLocalFacilitator']);
  const runtime = {port:integer(raw.port ?? 0,'Seller port',0,65535)};
  if (raw.facilitator !== undefined) {
    let url;
    try { url = new URL(raw.facilitator); }
    catch { throw failure('CONFIGURATION_ERROR','Use a complete facilitator URL.'); }
    if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
      throw failure('CONFIGURATION_ERROR','Use an HTTP(S) facilitator URL without credentials, query or fragment.');
    runtime.facilitator = url.href.replace(/\/$/,'');
  }
  if (raw.allowLocalFacilitator !== undefined && typeof raw.allowLocalFacilitator !== 'boolean')
    throw failure('CONFIGURATION_ERROR','allowLocalFacilitator must be a boolean.');
  if (raw.allowLocalFacilitator === true) runtime.allowLocalFacilitator = true;
  return runtime;
}

export function openSearchDeploymentTools(tool) {
  const read = {readOnly:true,idempotent:true}, write = {idempotent:true};
  const fields = properties => ({workspace:alias,...properties});
  const run = properties => ({requestId:originalId,...properties});
  return [
    tool('merchant_opensearch_deployment_status','Inspect the original OpenSearch deployment selection, retained releases, runtime owner and generation. This read does not open a seller console.',fields({}),['workspace'],read),
    tool('merchant_opensearch_deployment_compare','Compare two retained original releases, including source/query/customer terms and runtime differences. Omit from to use the current selection.',fields({from:alias,to:alias}),['workspace','to'],read),
    tool('merchant_opensearch_deployment_open','Open the original workspace deployment console and retain this request in the original journal. All lifecycle actions use that same controller.',fields(run({})),['workspace','requestId'],write),
    tool('merchant_opensearch_deployment_stage','Stage an original prepared merchant package after its saved file, source, plan and binding checks. Runtime options come from this alias’s host configuration.',fields(run({packageId:originalId,releaseId:alias,label:{type:'string',minLength:1,maxLength:160}})),['workspace','requestId','packageId','releaseId'],write),
    tool('merchant_opensearch_deployment_activate','Select a retained original release using the displayed selection generation. Starting or restarting its owned seller is a separate original action.',fields(run({releaseId:alias,expectedGeneration:generation,reason:{type:'string',minLength:1,maxLength:1000}})),['workspace','requestId','releaseId','expectedGeneration'],write),
    tool('merchant_opensearch_deployment_rollback','Select a previous retained release at the displayed generation. Omit to for the original previous release; restart the current owned instance to run the selection.',fields(run({to:alias,expectedGeneration:generation,reason:{type:'string',minLength:1,maxLength:1000}})),['workspace','requestId','expectedGeneration'],write),
    tool('merchant_opensearch_deployment_start','Start the selected original merchant through its maintained deployment owner. Preserve the displayed generation and returned seller instance ID.',fields(run({expectedGeneration:generation})),['workspace','requestId','expectedGeneration'],{...write,openWorld:true}),
    tool('merchant_opensearch_deployment_stop','Gracefully stop the seller instance currently owned by this original deployment console. Use its exact instance ID.',fields(run({instanceId:originalId})),['workspace','requestId','instanceId'],write),
    tool('merchant_opensearch_deployment_restart','Drain the current owned instance and run the selected release through the original controller. Both instance ID and selection generation must match.',fields(run({instanceId:originalId,expectedGeneration:generation})),['workspace','requestId','instanceId','expectedGeneration'],{...write,openWorld:true}),
    tool('merchant_opensearch_deployment_generate_client','Generate a retained customer export from the actual owned seller’s OpenAPI. exportId is a new customer export ID; instanceId identifies the running seller. Original request replay applies.',fields(run({exportId:alias,instanceId:originalId})),['workspace','requestId','exportId','instanceId'],write),
    tool('merchant_opensearch_deployment_clients','Page customer exports in the original deployment.clients directory. Reads saved completion records independently of a running seller.',fields({after:alias,limit:{type:'integer',minimum:1,maximum:50}}),['workspace'],read),
    tool('merchant_opensearch_deployment_client','Inspect the original customer export, offers, completion provenance and retained file reads.',fields({exportId:alias}),['workspace','exportId'],read),
    tool('merchant_opensearch_deployment_manifest','Read the exact retained customer manifest and its file digest before transferring original files or the complete archive.',fields({exportId:alias}),['workspace','exportId'],read),
    tool('merchant_opensearch_deployment_file','Transfer an original customer file through the maintained MerchantClientExports reader. Bind the export ID, inspected manifest digest, original file digest and original readId/offset.',fields({exportId:alias,file:{type:'string',minLength:1,maxLength:512},expectedManifestSha256:digest,...chunks}),['workspace','exportId','file','expectedManifestSha256','expectedSha256'],read),
    tool('merchant_opensearch_deployment_file_release','Release an unfinished original customer-file read owned by this export.',fields({exportId:alias,readId}),['workspace','exportId','readId'],write),
    tool('merchant_opensearch_deployment_archive','Transfer the original customer tar.gz archive through a SHA-256-pinned snapshot. The original archive encoder verifies every retained file against the inspected manifest. Continue with readId and expectedSha256; read_release releases unfinished archive reads.',fields({exportId:alias,expectedManifestSha256:digest,...chunks}),['workspace','exportId','expectedManifestSha256'],read),
    tool('merchant_opensearch_deployment_handover','Generate the original deployment handover for a retained release, including its current selection/runtime and customer commands. This is a current operator document with a generated timestamp.',fields({releaseId:alias}),['workspace','releaseId'],read),
  ];
}

function releaseView(value) {
  if (!value) return value;
  const {handlerEntry,runtime,...rest} = value;
  return {...rest,...(runtime ? {runtime:{...omit(runtime,['handlers']),applicationConfigured:Boolean(value.opensearch || runtime.handlers || runtime.upstreams)}} : {}),
    ...(handlerEntry ? {handlerEntry:pick(handlerEntry,['sha256','bytes','scope'])} : {})};
}
function runtimeView(value) {
  if (!value) return value;
  return {...pick(value,['state','message','managerAlive','childAlive']),
    observed:value.observed ? pick(value.observed,['instanceId','releaseId','releaseDigest','selectionGeneration',
      'listener','operations','mode','phase','startedAt','readyAt','endedAt','exitCode','exitSignal']) : null};
}
export function openSearchDeploymentStatusView(value) {
  if (!value) return value;
  return {...omit(value,['root','releases','runtime','console','deployment']),
    ...(value.releases ? {releases:value.releases.map(releaseView)} : {}),
    ...(value.runtime ? {runtime:runtimeView(value.runtime)} : {}),
    ...(value.console ? {console:omit(value.console,['operatorUrl','token'])} : {}),
    ...(value.deployment ? {deployment:omit(value.deployment,['root'])} : {})};
}

/** Remove only controller capabilities from managed-operation views; native data stays untouched. */
export function projectOpenSearchDeploymentOperation(value) {
  if (typeof value?.kind !== 'string' || !value.kind.startsWith('deployment-')) return value;
  return {...value,...(value.result ? {result:{...value.result,
    ...(value.result.status ? {status:openSearchDeploymentStatusView(value.result.status)} : {}),
    ...(value.result.release ? {release:releaseView(value.result.release)} : {}),
    ...(value.result.client ? {client:omit(value.result.client,['directory'])} : {})}} : {})};
}

const MUTATIONS = new Map([
  ['open','open'],['stage','stage'],['activate','activate'],['rollback','rollback'],
  ['start','run'],['stop','stop'],['restart','restart'],['generate_client','generate-client'],
]);

/** No second release controller, export store, job journal or provider adapter. */
export class MerchantOpenSearchDeployments {
  #customers = new Map(); #archives = new Map();
  #files = new RetainedFileReads({errorPrefix:'OPENSEARCH_DEPLOYMENT'});
  #closing = false; #close;
  get summary() { return {customerHandles:this.#customers.size,archiveHandles:this.#archives.size,...this.#files.summary}; }
  #native(model) {
    if (!model.deployment || typeof model.deployment.run !== 'function' ||
        model.deployment.root !== join(model.store.directory,'deployment'))
      throw failure('OPENSEARCH_DEPLOYMENT_UNAVAILABLE','Use the maintained OpenSearch workspace with its original managed-deployment module.');
    return model.deployment;
  }
  async #customerDirectory(model,{optional=false}={}) {
    const directory = this.#native(model).root+'.clients';
    let stat;
    try { stat = await lstat(directory); }
    catch (error) {
      if (optional && error.code === 'ENOENT') return null;
      if (error.code === 'ENOENT') throw failure('CLIENT_EXPORT_NOT_FOUND','Generate or restore the original customer export in this workspace first.');
      throw error;
    }
    if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(directory) !== resolve(directory) ||
        process.platform !== 'win32' && process.getuid && stat.uid !== process.getuid())
      throw failure('CONFIGURATION_ERROR','Use the original owned customer export directory beside this workspace deployment.');
    await privateSupportDirectory(directory);
    return directory;
  }
  async #customer(workspace,model) {
    if (!this.#customers.has(workspace)) {
      const pending = (async () => {
        const directory = await this.#customerDirectory(model);
        const {MerchantClientExports} = await import('./client-exports.mjs');
        return new MerchantClientExports({directory});
      })();
      this.#customers.set(workspace,pending);
      try { await pending; } catch (error) { if (this.#customers.get(workspace) === pending) this.#customers.delete(workspace); throw error; }
    }
    return this.#customers.get(workspace);
  }
  async #archive(workspace,model) {
    if (!this.#archives.has(workspace)) {
      const pending = (async () => {
        const directory = await this.#customerDirectory(model);
        const {createReleaseClientConsole} = await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/release-client.mjs');
        // Only the original customer archive encoder is used here. It has no
        // listener or managed seller, and cannot generate a customer export.
        return createReleaseClientConsole(this.#native(model).root,{directory,getManaged:()=>null});
      })();
      this.#archives.set(workspace,pending);
      try { await pending; } catch (error) { if (this.#archives.get(workspace) === pending) this.#archives.delete(workspace); throw error; }
    }
    return this.#archives.get(workspace);
  }
  async #mutate(action,args,model,entry) {
    const native = this.#native(model);
    const request = {requestId:record(args.requestId),action};
    if (args.expectedGeneration !== undefined) request.expectedGeneration = integer(args.expectedGeneration,'Selection generation');
    if (args.instanceId !== undefined) request.instanceId = record(args.instanceId);
    if (args.reason !== undefined) {
      if (typeof args.reason !== 'string' || !args.reason.trim() || args.reason.length > 1000)
        throw failure('INVALID_PARAMS','Use a nonempty selection reason of at most 1,000 characters.');
      request.reason = args.reason;
    }
    if (args.releaseId !== undefined) { identifier(args.releaseId,'Release ID'); request.id = args.releaseId; }
    if (args.to !== undefined) { identifier(args.to,'Rollback release ID'); request.to = args.to; }
    if (action === 'generate-client') { identifier(args.exportId,'Customer export ID'); request.id = args.exportId; }
    if (action === 'stage') {
      request.packageId = record(args.packageId);
      if (args.label !== undefined) {
        if (typeof args.label !== 'string' || args.label.length > 160)
          throw failure('INVALID_PARAMS','Use a release label of at most 160 characters.');
        request.label = line(args.label,'Release label');
      }
      request.runtime = openSearchRuntimeOptions(entry.runtime ?? {});
      // The browser can omit default runtime fields. Recover its exact request
      // when the original operation and current host selection are equivalent.
      let prior;
      try { prior = model.operation(request.requestId); }
      catch (error) { if (error.code !== 'WORKSPACE_OPERATION_NOT_FOUND') throw error; }
      if (prior?.kind === 'deployment-stage' && prior.request &&
          canonical({...prior.request,runtime:openSearchRuntimeOptions(prior.request.runtime ?? {})}) === canonical(request))
        Object.assign(request,prior.request);
      if (prior?.kind === 'deployment-stage' && prior.request && !Object.hasOwn(prior.request,'runtime') &&
          canonical({...prior.request,runtime:openSearchRuntimeOptions({})}) === canonical(request))
        delete request.runtime;
    }
    await native.run(request);
    // Await the accepted ORIGINAL task; a closing MCP handle must not set
    // workspace.closed while that task is still opening its original console.
    const accepted = native.tasks.get(request.requestId);
    if (accepted) await accepted;
    return projectOpenSearchDeploymentOperation(model.operation(request.requestId));
  }
  async #archiveBytes(workspace,model,args) {
    const original = await this.#archive(workspace,model);
    const request = new EventEmitter(); request.headers = {};
    const parts = []; let count = 0, status = null, headers = null;
    const maximum = 256_000_000-this.#files.summary.snapshotBytes;
    const response = new Writable({write(chunk,encoding,done) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk,encoding);
      count += bytes.length;
      if (count > maximum) return done(failure('OPENSEARCH_DEPLOYMENT_READ_CAPACITY','Finish or release an existing archive read before loading more original customer bytes.'));
      parts.push(bytes); done();
    }});
    response.writeHead = (code,value) => { status=code; headers=value; return response; };
    await original.sendDownload(request,response,{exportId:args.exportId,expectedManifestSha256:args.expectedManifestSha256});
    if (status !== 200 || headers?.['x-client-manifest-sha256'] !== args.expectedManifestSha256 ||
        headers?.['content-type'] !== 'application/gzip')
      throw failure('OPENSEARCH_DEPLOYMENT_ARCHIVE_CHANGED','The original archive response differs from this reviewed customer export.');
    return {bytes:Buffer.concat(parts,count),name:args.exportId+'-client.tar.gz',type:'application/gzip'};
  }
  async call(name,args,{model,entry}) {
    if (this.#closing) throw failure('OPENSEARCH_DEPLOYMENT_CLOSING','The managed deployment adapter is closing.');
    const native = this.#native(model), selected = name.slice('merchant_opensearch_deployment_'.length);
    if (MUTATIONS.has(selected)) return this.#mutate(MUTATIONS.get(selected),args,model,entry);
    switch (selected) {
      case 'status': return openSearchDeploymentStatusView(await native.status());
      case 'compare':
        identifier(args.to,'Release ID');
        if (args.from !== undefined) identifier(args.from,'Release ID');
        return native.compare(pick(args,['from','to']));
      case 'clients': {
        if (args.after !== undefined) identifier(args.after,'Customer export cursor');
        if (args.limit !== undefined) integer(args.limit,'Customer export page limit',1,50);
        if (!await this.#customerDirectory(model,{optional:true}))
          return {schema:'stellar-forge.seller-client-export-list.v1',entries:[],nextAfter:null};
        return (await this.#customer(args.workspace,model)).list(pick(args,['after','limit']));
      }
      case 'client':
        identifier(args.exportId,'Customer export ID');
        return omit(await (await this.#customer(args.workspace,model)).inspect({exportId:args.exportId,includeOffers:true}),['directory']);
      case 'manifest':
        identifier(args.exportId,'Customer export ID');
        return (await this.#customer(args.workspace,model)).call('merchant_client_export_manifest',{exportId:args.exportId});
      case 'file':
        identifier(args.exportId,'Customer export ID'); reviewed(args.expectedManifestSha256); reviewed(args.expectedSha256);
        if (typeof args.file !== 'string' || !args.file || args.file.length > 512)
          throw failure('INVALID_PARAMS','Select a file from the original customer manifest.');
        return (await this.#customer(args.workspace,model)).call('merchant_client_export_file',omit(args,['workspace']));
      case 'file_release':
        identifier(args.exportId,'Customer export ID'); retainedReadId(args.readId);
        return (await this.#customer(args.workspace,model)).call('merchant_client_export_file_release',{exportId:args.exportId,readId:args.readId});
      case 'archive':
        identifier(args.exportId,'Customer export ID'); reviewed(args.expectedManifestSha256);
        return this.#files.read({scope:args.workspace,key:JSON.stringify([args.exportId,args.expectedManifestSha256]),
          kind:'opensearch-customer-archive',directory:entry.directory,
          load:()=>this.#archiveBytes(args.workspace,model,args),...pick(args,['readId','expectedSha256','offset','limit'])});
      case 'handover': {
        identifier(args.releaseId,'Release ID');
        const original = await native.handover(args.releaseId), bytes = Buffer.from(original.body);
        return {releaseId:args.releaseId,snapshot:'CURRENT_DEPLOYMENT',file:{name:original.filename,
          contentType:original.type,bytes:bytes.length,sha256:sha(bytes)},text:original.body};
      }
      default: throw failure('METHOD_NOT_FOUND','Unknown managed OpenSearch deployment tool.');
    }
  }
  releaseArchive(workspace,readId) { return this.#files.release(workspace,readId); }
  async closeWorkspace(workspace) {
    await this.#files.closeScope(workspace);
    const selected = [this.#customers,this.#archives].map(map => {
      const pending = map.get(workspace); map.delete(workspace); return pending;
    }).filter(Boolean);
    const results = await Promise.allSettled(selected.map(async handle => (await handle).close()));
    const failed = results.find(result => result.status === 'rejected');
    if (failed) throw failed.reason;
  }
  close() {
    if (!this.#close) {
      this.#closing = true;
      this.#close = (async () => {
        const files = await Promise.allSettled([this.#files.close()]);
        const aliases = new Set([...this.#customers.keys(),...this.#archives.keys()]);
        const results = await Promise.allSettled([...aliases].map(workspace => this.closeWorkspace(workspace)));
        const failed = [...files,...results].find(result => result.status === 'rejected');
        if (failed) throw failed.reason;
      })();
    }
    return this.#close;
  }
}

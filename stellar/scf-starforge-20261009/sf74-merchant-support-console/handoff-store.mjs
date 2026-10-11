// MIT. The original support downloader and case store, operated from the SF74 desk.
import {constants} from 'node:fs';
import {open, readdir, realpath} from 'node:fs/promises';
import {resolve, dirname, join, sep} from 'node:path';
import {createHash} from 'node:crypto';
import * as transfer from '../../../stellar-forge/mcp-merchant-operator/support-download.mjs';
import {parseSupportExportManifest} from '../../../stellar-forge/mcp-merchant-operator/support.mjs';
import {privateSupportDirectory} from '../../../stellar-forge/mcp-merchant-operator/config.mjs';
import {MAX_HANDOFF_BYTES} from './runtime-support.mjs';

const ALIAS = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const SHA = /^[0-9a-f]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const decode = bytes => new TextDecoder('utf-8', {fatal:true}).decode(bytes);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (code, detail, status=422) => Object.assign(new Error(detail), {code, status, handoffLocal:true});
const inside = (child, parent) => child === parent || child.startsWith(parent + sep);
function exact(value, fields) {
  if (!plain(value) || Object.keys(value).some(key=>!fields.includes(key)))
    throw fail('HANDOFF_INVALID_INPUT', 'Use the displayed handoff fields.');
}
function alias(value) {
  if (typeof value !== 'string' || !ALIAS.test(value)) throw fail('HANDOFF_INVALID_ID', 'Use the original export ID: lowercase letters, digits, underscores or hyphens.');
  return value;
}
async function privateBytes(path, maximum=65000) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size < 1 || before.size > maximum || before.mode & 0o077)
      throw fail('HANDOFF_PRIVATE_FILE_REQUIRED', 'The selected host file must be a private regular file within its original size limit.', 503);
    const bytes = await handle.readFile(), after = await handle.stat();
    if (bytes.length !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs)
      throw fail('HANDOFF_FILE_CHANGED', 'The retained file changed while it was being read. Reopen the handoff.', 409);
    return bytes;
  } finally { await handle.close(); }
}
async function canonicalDirectory(path) {
  const directory = resolve(path);
  await privateSupportDirectory(directory);
  if (await realpath(directory) !== directory) throw fail('HANDOFF_CONFIGURATION', 'Use canonical private handoff directories without symlink components.');
  return directory;
}

export function handoffProblem(error) {
  const code = /^[A-Z][A-Z0-9_]{0,95}$/.test(error?.code ?? '') ? error.code : 'HANDOFF_OPERATION_FAILED';
  let detail = 'The original handoff operation did not complete. Its retained files are available for continuation.';
  if (error?.handoffLocal === true) detail = String(error.message).slice(0,300);
  else if (code === 'ENOENT' || /FILE_NOT_FOUND|CASE_NOT_FOUND/.test(code)) detail = 'The selected original handoff or saved case is unavailable. Check its export ID and host source.';
  else if (/HTTP_40[13]$/.test(code)) detail = 'The source did not authorize this read. Correct the configured host credential, then resume the same handoff.';
  else if (/HTTP_404$/.test(code)) detail = 'The configured source endpoint was not found. Correct its host configuration, then resume.';
  else if (/HTTP_429$/.test(code)) detail = 'The source asked for fewer requests. Wait for its limit to reset, then resume the same handoff.';
  else if (/CHANGED|CONFLICT/.test(code)) detail = 'The original files or retained identity differ from this request. Inspect the saved handoff before continuing; existing bytes are preserved.';
  else if (/INTERRUPTED|ABORT/.test(code) || error?.name === 'AbortError') detail = 'Transfer stopped. Resume uses the same saved files and verified byte checkpoint.';
  else if (/BUSY|CAPACITY/.test(code)) detail = 'An original operation currently owns this work or its available capacity. Let it finish or stop this desk’s active transfer, then resume.';
  else if (/CONFIGURATION|PRIVATE/.test(code)) detail = 'The host connection or private storage needs correction. Check its endpoint, bearer environment, directory permissions and the operating guide.';
  else if (code === 'ENOSPC') detail = 'The host is out of disk space. Make room, then resume the same retained transfer.';
  else if (/LEASE|WRITER/.test(code)) detail = 'The original storage owner needs attention. Use the existing case-writer or Linux lease recovery procedure, then reopen this handoff.';
  const status=Number(error?.status);
  return {error:code, detail, status:Number.isInteger(status)&&status>=400&&status<=599?status:(code.startsWith('HANDOFF_') ? 422 : 503)};
}

/** Host configuration names sources and paths; browser input can select only aliases. */
export async function openHandoffDesk({configPath, casesDir, environment=process.env}) {
  if (!casesDir) throw fail('HANDOFF_CONFIGURATION', 'Handoff sources require the existing --cases-dir.');
  const cases = await canonicalDirectory(casesDir), filename=resolve(configPath);
  const raw = JSON.parse(decode(await privateBytes(filename)));
  exact(raw, ['schema','sources']);
  if (raw.schema !== 'stellar-forge.support-handoff-sources.v1' || !plain(raw.sources) || Object.keys(raw.sources).length > 32)
    throw fail('HANDOFF_CONFIGURATION', 'Use the support handoff sources schema with at most 32 configured sources.');
  const sources = new Map(), directories=[cases];
  for (const [key, entry] of Object.entries(raw.sources)) {
    alias(key); exact(entry, ['label','url','tokenEnv','directory']);
    if (typeof entry.label !== 'string' || !entry.label.trim() || entry.label.length > 120 || /[\u0000-\u001f\u007f]/.test(entry.label))
      throw fail('HANDOFF_CONFIGURATION', 'Give every source a short readable label.');
    let endpoint;
    try { endpoint = new URL(entry.url); } catch { throw fail('HANDOFF_CONFIGURATION', 'Use an HTTPS source endpoint or the original loopback HTTP listener.'); }
    if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
        endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['127.0.0.1','[::1]'].includes(endpoint.hostname)) ||
        !/^[A-Za-z_][A-Za-z0-9_]*$/.test(entry.tokenEnv ?? '') || typeof entry.directory !== 'string' || !entry.directory)
      throw fail('HANDOFF_CONFIGURATION', 'Use an HTTPS or loopback endpoint, a bearer environment name and a private download directory.');
    const directory = await canonicalDirectory(resolve(dirname(filename),entry.directory));
    if (directories.some(other=>inside(directory,other)||inside(other,directory)))
      throw fail('HANDOFF_CONFIGURATION', 'Keep each source download directory separate from the other sources and original case directory.');
    directories.push(directory);
    sources.set(key, Object.freeze({key,label:entry.label.trim(),url:endpoint.href,tokenEnv:entry.tokenEnv,directory}));
  }
  return new HandoffDesk({sources,cases,environment});
}

class HandoffDesk {
  #sources; #cases; #environment; #jobs=new Map(); #recent=new Map(); #pending=new Set();
  #shutdown=new AbortController(); #closing=false; #closed;
  constructor({sources,cases,environment}) {this.#sources=sources;this.#cases=cases;this.#environment=environment;}
  profiles() {
    return {enabled:true,sources:[...this.#sources.values()].map(({key,label,tokenEnv})=>({key,label,
      credentialConfigured:typeof this.#environment[tokenEnv] === 'string' && this.#environment[tokenEnv].length >= 24})),
      activeTransfers:this.#jobs.size,maximumTransfers:2};
  }
  #source(key) {
    alias(key); const source=this.#sources.get(key);
    if (!source) throw fail('HANDOFF_SOURCE_UNAVAILABLE', 'Choose a configured handoff source.', 404);
    return source;
  }
  #key(source,id) {return source+'\0'+id;}
  #ready() {if(this.#closing)throw fail('HANDOFF_CLOSING','The desk is closing. Reopen it to continue the same files.',503);}
  #track(promise) {this.#pending.add(promise);promise.then(()=>this.#pending.delete(promise),()=>this.#pending.delete(promise));return promise;}
  async inspect(sourceKey, exportId) {
    this.#ready();const source=this.#source(sourceKey);alias(exportId);
    return this.#track(transfer.inspectSupportExport({url:source.url,exportId,tokenEnv:source.tokenEnv,
      environment:this.#environment,signal:this.#shutdown.signal}));
  }
  async #local(source, exportId) {
    const root=join(source.directory,alias(exportId));
    try {await canonicalDirectory(root);} catch(error){if(error.code==='ENOENT')return null;throw error;}
    const stateDirectory=await canonicalDirectory(join(root,'download-state'));
    const manifestBytes=await privateBytes(join(stateDirectory,'support-export.json'));
    const manifest=parseSupportExportManifest(manifestBytes,exportId),manifestSha256=digest(manifestBytes);
    const checkpoint=JSON.parse(decode(await privateBytes(join(stateDirectory,'checkpoint.json'))));
    if(checkpoint.schema!=='stellar-forge.merchant-support-download.v1' || checkpoint.exportId!==exportId ||
       checkpoint.endpoint!==source.url || checkpoint.manifestSha256!==manifestSha256 || !plain(checkpoint.files) ||
       Object.keys(checkpoint.files).some(name=>!manifest.files.some(file=>file.name===name)))
      throw fail('HANDOFF_CHECKPOINT_CONFLICT','This directory belongs to another original handoff or source endpoint.',409);
    const files=manifest.files.map(file=>{
      const saved=checkpoint.files[file.name];
      if(saved && (!Number.isSafeInteger(saved.bytes)||saved.bytes<0||saved.bytes>file.bytes||!SHA.test(saved.sha256??'')||
          typeof saved.complete!=='boolean'||saved.complete&&(saved.bytes!==file.bytes||saved.sha256!==file.sha256)))
        throw fail('HANDOFF_CHECKPOINT_CONFLICT','A saved file checkpoint differs from its original completion manifest.',409);
      return {...file,savedBytes:saved?.bytes??0,complete:saved?.complete??false};
    });
    let complete=false;
    try {
      const final=await privateBytes(join(root,'support-export.json'));
      if(!final.equals(manifestBytes))throw fail('HANDOFF_FILE_CHANGED','The saved completion manifest differs from its original bytes.',409);
      complete=true;
    }catch(error){if(error.code!=='ENOENT')throw error;}
    let localCase=null;
    if(checkpoint.localCase) {
      const value=checkpoint.localCase;
      if(value.directory!==this.#cases || !UUID.test(value.id??'') || value.revision!==null&&!SHA.test(value.revision??''))
        throw fail('HANDOFF_CASE_CONFLICT','This download belongs to a different original case directory.',409);
      localCase={id:value.id,importedRevision:value.revision};
    }
    return {root,manifestBytes,manifest,manifestSha256,files,complete,localCase,createdAt:checkpoint.createdAt};
  }
  async view(sourceKey, exportId) {
    const source=this.#source(sourceKey);alias(exportId);const key=this.#key(sourceKey,exportId),job=this.#jobs.get(key);
    const recent=this.#recent.get(key);let local=null,problem=null;
    try {local=await this.#local(source,exportId);}catch(error){if(!job||error.code!=='ENOENT')problem=handoffProblem(error);}
    const files=local?.files??[],progress={files:files.length,completeFiles:files.filter(file=>file.complete).length,
      bytes:files.reduce((total,file)=>total+file.bytes,0),savedBytes:files.reduce((total,file)=>total+file.savedBytes,0)};
    return {source:sourceKey,label:source.label,exportId,state:job?job.stopping?'STOPPING':'DOWNLOADING':
      problem?'NEEDS_ATTENTION':local?.complete?'COMPLETE':local?'PAUSED':'NOT_DOWNLOADED',
      manifestSha256:local?.manifestSha256??null,sourceCase:local?.manifest.case??null,exportedAt:local?.manifest.createdAt??null,createdAt:local?.createdAt??null,
      localCase:local?.localCase??null,files,progress,active:job?{startedAt:job.startedAt,file:job.progress?.file??null}:null,
      problem:problem?{error:problem.error,detail:problem.detail}:recent?.problem??null};
  }
  async list(sourceKey,{offset=0,limit=20}={}) {
    const source=this.#source(sourceKey);
    if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>100)
      throw fail('HANDOFF_INVALID_PAGE','Choose a valid retained handoff page.');
    const names=(await readdir(source.directory,{withFileTypes:true})).filter(entry=>entry.isDirectory()&&ALIAS.test(entry.name))
      .map(entry=>entry.name);
    for(const job of this.#jobs.values())if(job.source===sourceKey&&!names.includes(job.exportId))names.push(job.exportId);
    names.sort();const selected=names.slice(offset,offset+limit),transfers=[];
    for(const name of selected)transfers.push(await this.view(sourceKey,name));
    return {source:sourceKey,transfers,total:names.length,offset,limit,nextOffset:offset+limit<names.length?offset+limit:null};
  }
  async receive(sourceKey,exportId,input) {
    this.#ready();exact(input,['expectedManifestSha256']);
    if(!SHA.test(input.expectedManifestSha256??''))throw fail('HANDOFF_REVIEW_REQUIRED','Inspect the original handoff before downloading its reviewed manifest.');
    const source=this.#source(sourceKey);alias(exportId);const key=this.#key(sourceKey,exportId),current=this.#jobs.get(key);
    if(current) {
      if(current.sha!==input.expectedManifestSha256)throw fail('HANDOFF_REVIEW_CONFLICT','This active transfer belongs to a different reviewed manifest.',409);
      return this.view(sourceKey,exportId);
    }
    if(this.#jobs.size>=2)throw fail('HANDOFF_CAPACITY','Finish or stop one of this desk’s two active transfers before starting another.',409);
    const controller=new AbortController(),job={source:sourceKey,exportId,sha:input.expectedManifestSha256,
      controller,startedAt:new Date().toISOString(),stopping:false,progress:null,promise:null};
    this.#jobs.set(key,job);this.#recent.delete(key);
    job.promise=(async()=>{
      try {
        await transfer.downloadSupportExport({url:source.url,exportId,directory:join(source.directory,exportId),
          tokenEnv:source.tokenEnv,environment:this.#environment,expectedManifestSha256:job.sha,
          signal:AbortSignal.any([controller.signal,this.#shutdown.signal]),onProgress:value=>{job.progress=value;}});
      }catch(error){const problem=handoffProblem(error);this.#recent.set(key,{problem:{error:problem.error,detail:problem.detail}});}
      finally {this.#jobs.delete(key);if(this.#recent.size>128)this.#recent.delete(this.#recent.keys().next().value);}
    })();
    return this.view(sourceKey,exportId);
  }
  async stop(sourceKey,exportId) {
    this.#source(sourceKey);alias(exportId);const job=this.#jobs.get(this.#key(sourceKey,exportId));
    if(job){job.stopping=true;job.controller.abort(fail('HANDOFF_INTERRUPTED','Transfer stopped. Resume uses the same saved files and byte checkpoint.'));}
    return this.view(sourceKey,exportId);
  }
  async reopen(sourceKey,exportId) {
    this.#ready();const source=this.#source(sourceKey);alias(exportId);
    if(this.#jobs.has(this.#key(sourceKey,exportId)))throw fail('HANDOFF_BUSY','Finish or stop this transfer before opening its original case.',409);
    const result=await this.#track(transfer.reopenDownloadedSupportExport({directory:join(source.directory,exportId),casesDirectory:this.#cases}));
    return {schema:result.schema,exportId:result.exportId,sourceCase:result.sourceCase,
      case:{id:result.case.id,revision:result.case.revision,importedRevision:result.case.importedRevision},
      manifestSha256:result.manifestSha256,state:result.state};
  }
  async file(sourceKey,exportId,name) {
    const source=this.#source(sourceKey),local=await this.#local(source,exportId);
    if(!local?.complete)throw fail('HANDOFF_INCOMPLETE','Complete the retained download before using its files.',409);
    const file=name==='support-export.json'?{name,bytes:local.manifestBytes.length,sha256:local.manifestSha256}:
      local.manifest.files.find(value=>value.name===name);
    if(!file)throw fail('HANDOFF_FILE_UNAVAILABLE','Choose a file from this original completion manifest.',404);
    const bytes=name==='support-export.json'?local.manifestBytes:await privateBytes(join(local.root,name),MAX_HANDOFF_BYTES);
    if(bytes.length!==file.bytes||digest(bytes)!==file.sha256)throw fail('HANDOFF_FILE_CHANGED','This saved file differs from its original completion manifest.',409);
    return {name,bytes,sha256:file.sha256};
  }
  close() {
    if(!this.#closed){this.#closing=true;this.#shutdown.abort(fail('HANDOFF_INTERRUPTED','Desk closed. Resume the original transfer when it reopens.'));
      this.#closed=Promise.allSettled([...this.#jobs.values()].map(job=>job.promise).concat([...this.#pending]));}
    return this.#closed;
  }
}

// MIT. Local and installed-MCP controls for the original complete case package.
// Case history, archives, downloads and receiving retain their original owners.
import {constants} from 'node:fs';
import {open,mkdir,lstat,realpath,readdir} from 'node:fs/promises';
import {resolve,join,dirname,basename,isAbsolute,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {atomicJson,atomicBytes,readBytes,fileDigest,acceptStream} from '../sf30-seller-sdk/duckdb/cloud-delivery/files.mjs';
import {acquireWorkspace} from '../sf30-seller-sdk/postgres/publisher/files.mjs';
import {openCaseStore} from './case-store.mjs';
import {exportCaseSourcePackage,inspectCaseSourcePackage,receiveCaseSourcePackage,
  parseCaseSourcePackageManifest,MAX_CASE_SOURCE_MANIFEST_BYTES} from './case-source-package.mjs';
import {SOURCE_ARCHIVE_LIMITS} from '../../scf_2026/sf49_data_commissioning/source-edition-archive.mjs';
import {RetainedFileReads,MAX_RETAINED_CHUNK_BYTES} from '../../../stellar-forge/mcp-merchant-operator/retained-file-reads.mjs';
import {createRetainedDownload} from '../../../stellar-forge/mcp-merchant-operator/retained-download.mjs';

export const CASE_PACKAGE_OPERATIONS_SCHEMA='stellar-forge.merchant-case-package-operations.v1';
export const CASE_PACKAGE_HTTP_BASE='/api/case-packages';
const ID=/^[a-z0-9][a-z0-9_-]{0,63}$/,SHA=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const MAX_STATE=MAX_CASE_SOURCE_MANIFEST_BYTES*2,MAX_INPUT=MAX_CASE_SOURCE_MANIFEST_BYTES+65536;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const sha=value=>createHash('sha256').update(value).digest('hex');
const now=()=>new Date().toISOString();
const inside=(child,parent)=>child===parent||child.startsWith(parent+sep);
const order=(a,b)=>a<b?-1:a>b?1:0;
const error=(code,message=code,status=422)=>Object.assign(new Error(message),{code,status,casePackageLocal:true});
const ensure=(value,code,message,status)=>{if(!value)throw error(code,message,status);};
function object(value,fields) {
  ensure(plain(value)&&Object.keys(value).every(key=>fields.includes(key)),
    'CASE_PACKAGE_OPERATION_INPUT','Use the displayed original operation fields.');
}
function identifier(value) {
  ensure(typeof value==='string'&&ID.test(value),'CASE_PACKAGE_OPERATION_ID',
    'Use an operation ID containing lowercase letters, digits, underscores or hyphens.');return value;
}
function digest(value) {
  ensure(typeof value==='string'&&SHA.test(value),'CASE_PACKAGE_OPERATION_DIGEST',
    'Use the exact original SHA-256 identity.');return value;
}
function actor(value) {
  ensure(typeof value==='string'&&value.trim()&&Buffer.byteLength(value)<=200&&!/[\x00-\x1f\x7f]/.test(value),
    'CASE_PACKAGE_OPERATOR','Name the operator receiving or exporting this package.');return value;
}
function page(value={}) {
  object(value,['offset','limit','q']);
  const offset=value.offset??0,limit=value.limit??50;
  ensure(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>=1&&limit<=200&&
    (value.q===undefined||typeof value.q==='string'&&value.q.length<=240),
    'CASE_PACKAGE_PAGE','Use a nonnegative offset and a page of at most 200 rows.');
  return {offset,limit,q:(value.q??'').toLowerCase()};
}
function slice(rows,options) {
  const {offset,limit,q}=page(options),found=q?rows.filter(row=>JSON.stringify(row).toLowerCase().includes(q)):rows;
  return {rows:found.slice(offset,offset+limit),total:found.length,offset,limit,
    nextOffset:offset+limit<found.length?offset+limit:null};
}
function relativeName(value) {
  ensure(typeof value==='string'&&value.length>0&&Buffer.byteLength(value)<=4096&&
    !/^[\\/]/.test(value)&&!/^[A-Za-z]:/.test(value)&&!/[\\\x00-\x1f\x7f]/.test(value)&&
    value.split('/').length<=32&&value.split('/').every(part=>part&&part!=='.'&&part!=='..'),
    'CASE_PACKAGE_MEMBER','Select an original relative member name.');return value;
}
async function privateRoot(value) {
  ensure(typeof value==='string'&&isAbsolute(value)&&!value.includes('\0')&&resolve(value)!=='/',
    'CASE_PACKAGE_OPERATION_DIRECTORY','Use the configured private package directory.',503);
  const path=resolve(value);await mkdir(path,{recursive:true,mode:0o700});
  const info=await lstat(path);
  ensure(info.isDirectory()&&!info.isSymbolicLink()&&await realpath(path)===path&&
    (process.platform==='win32'||!(info.mode&0o077)&&info.uid===process.getuid()),
    'CASE_PACKAGE_OPERATION_DIRECTORY','The configured package directory must be owned, canonical and private.',503);
  return path;
}
async function memberPath(root,name,{create=false}={}) {
  const parts=relativeName(name).split('/');let parent=root;
  for(const part of parts.slice(0,-1)) {
    parent=join(parent,part);
    if(create)await privateRoot(parent);
    else{const info=await lstat(parent);ensure(info.isDirectory()&&!info.isSymbolicLink()&&await realpath(parent)===parent,
      'CASE_PACKAGE_OPERATION_DIRECTORY','An original member directory changed.',409);}
  }
  const path=join(parent,parts.at(-1));
  try{const info=await lstat(path);ensure(info.isFile()&&!info.isSymbolicLink()&&
    (process.platform==='win32'||!(info.mode&0o077)&&info.uid===process.getuid()),
    'CASE_PACKAGE_MEMBER','Use the retained owned private member.',409);}
  catch(problem){if(problem.code!=='ENOENT'||!create)throw problem;}
  return path;
}
async function optional(path,maximum=MAX_STATE) {
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readBytes(path,maximum)));}
  catch(problem){if(problem.code==='ENOENT')return null;throw problem;}
}
async function locked(root,operation) {
  await privateRoot(root);const release=await acquireWorkspace(root);let primary;
  try{return await operation();}catch(problem){primary=problem;throw problem;}
  finally{try{await release();}catch(problem){if(primary){primary.closeError=problem;throw primary;}throw problem;}}
}
export function casePackageProblem(problem) {
  const code=/^[A-Z][A-Z0-9_]{0,95}$/.test(problem?.code??'')?problem.code:'CASE_PACKAGE_OPERATION_FAILED';
  let detail='The original operation has retained its case, source files and checkpoints. Inspect and resume that same operation.';
  if(problem?.casePackageLocal)detail=String(problem.message).slice(0,360);
  else if(/ABORT|INTERRUPT/.test(code)||problem?.name==='AbortError')detail='This operation paused. Continue its original retained request.';
  else if(code==='ENOSPC')detail='The configured storage is full. Make room, then resume this original operation.';
  else if(/CONFLICT|CHANGED/.test(code))detail='The selected original identity or bytes differ. Inspect this retained operation before continuing.';
  else if(/BUSY|LEASE|WRITER/.test(code))detail='The original case or package writer currently owns this work. Its existing operation and files remain available.';
  else if(code==='ENOENT')detail='The selected retained case, package or original source file is unavailable.';
  const status=Number(problem?.status);
  return {error:code,detail,status:Number.isInteger(status)&&status>=400&&status<600?status:503};
}
const remoteTransfer=createRetainedDownload({
  manifestName:'case-source-package.json',parseManifest:(bytes,id)=>{
    const parsed=parseCaseSourcePackageManifest(bytes);
    ensure(parsed.manifest.exportId===id,'CASE_PACKAGE_REMOTE_ID','The original export ID differs from the selected package.');
    return parsed.manifest;
  },maximumBytes:SOURCE_ARCHIVE_LIMITS.archiveBytes,maximumManifestBytes:MAX_CASE_SOURCE_MANIFEST_BYTES,
  maximumCheckpointBytes:MAX_STATE,nestedFiles:true,
  stateSchema:'stellar-forge.merchant-case-package-download.v1',
  resultSchema:'stellar-forge.merchant-case-package-download-result.v1',
  toolPrefix:'merchant_case_package_export',errorPrefix:'CASE_PACKAGE',
  clientName:'starforge-case-package-receiver',
  describe:manifest=>({case:manifest.case,sourceBundles:manifest.sourceBundles.length})
});

export function defaultCasePackagesDirectory(casesDirectory) {
  ensure(typeof casesDirectory==='string'&&isAbsolute(casesDirectory),'CASE_PACKAGE_OPERATION_DIRECTORY',
    'Choose the original absolute case directory.');
  const cases=resolve(casesDirectory);return join(dirname(cases),basename(cases)+'-packages');
}

/** Original operation directories are shared by browser and MCP. Reads never
 * start a worker. Each explicit continuation acquires the existing writer lease
 * and then calls the same native package/archive/case implementation. */
export async function openCasePackageOperations({store,casesDirectory,directory,sourceDelivery,
  handoffDesk=null,python=process.env.SCF_PYTHON||'python3',environment=process.env}={}) {
  const cases=await privateRoot(casesDirectory),root=await privateRoot(directory??defaultCasePackagesDirectory(cases));
  ensure(!inside(root,cases)&&!inside(cases,root),'CASE_PACKAGE_OPERATION_DIRECTORY',
    'Keep complete packages separate from the working case store.',503);
  ensure(sourceDelivery&&typeof sourceDelivery.directory==='string'&&sourceDelivery.service,
    'CASE_PACKAGE_SOURCE_DIRECTORY','Open the original configured source delivery service.',503);
  const sourceRoot=await privateRoot(sourceDelivery.directory);
  ensure(!inside(root,sourceRoot)&&!inside(sourceRoot,root),'CASE_PACKAGE_OPERATION_DIRECTORY',
    'Keep package operations separate from the working source service.',503);
  store??=await openCaseStore(cases);
  const inputs=await privateRoot(join(root,'inputs')),operations=await privateRoot(join(root,'operations'));
  const active=new Map(),pending=new Set(),shutdown=new AbortController(),manifestCache=new Map();let cachedManifestBytes=0;
  const reads=new RetainedFileReads({errorPrefix:'CASE_PACKAGE',
    maxImmutableFileBytes:SOURCE_ARCHIVE_LIMITS.archiveBytes});
  let closing=false,closePromise=null;
  const inputRoot=id=>join(inputs,identifier(id)),operationRoot=id=>join(operations,identifier(id));
  const inputPackage=id=>join(inputRoot(id),'package');
  const assertOpen=()=>ensure(!closing,'CASE_PACKAGE_CLOSING','This package owner is closing.',503);
  function track(operation) {
    assertOpen();const promise=Promise.resolve().then(()=>{assertOpen();return operation();});
    pending.add(promise);promise.then(()=>pending.delete(promise),()=>pending.delete(promise));return promise;
  }
  async function inputRequest(id) {
    const request=await optional(join(inputRoot(id),'input-request.json'),65536);
    ensure(request?.schema==='stellar-forge.merchant-case-package-input.v1'&&request.id===id,
      'CASE_PACKAGE_INPUT_NOT_FOUND','Choose an original received input.',404);return request;
  }
  async function request(id) {
    const value=await optional(join(operationRoot(id),'operation-request.json'),65536);
    ensure(value?.schema==='stellar-forge.merchant-case-package-operation.v1'&&value.id===id,
      'CASE_PACKAGE_OPERATION_NOT_FOUND','Choose an original operation.',404);return value;
  }
  async function manifestAt(directory,name='case-source-package.json') {
    const path=await memberPath(directory,name),before=await lstat(path,{bigint:true});
    const identity=['dev','ino','size','mtimeNs','ctimeNs'].map(key=>String(before[key])).join(':');
    const retained=manifestCache.get(path);
    if(retained?.identity===identity)return retained.value;
    if(retained){manifestCache.delete(path);cachedManifestBytes-=retained.value.bytes.length;}
    const bytes=await readBytes(path,MAX_CASE_SOURCE_MANIFEST_BYTES),after=await lstat(path,{bigint:true});
    ensure(['dev','ino','size','mtimeNs','ctimeNs'].every(key=>before[key]===after[key]),
      'CASE_PACKAGE_SELECTION_CHANGED','The original manifest changed while it was opened.',409);
    const parsed=parseCaseSourcePackageManifest(bytes),value={...parsed,bytes,
      fileIndex:new Map(parsed.manifest.files.map(file=>[file.name,file])),
      bundleIndex:new Map(parsed.manifest.sourceBundles.map(bundle=>[bundle.bundleId+'\0'+bundle.manifestSha256,bundle]))};
    while(manifestCache.size&&cachedManifestBytes+bytes.length>MAX_CASE_SOURCE_MANIFEST_BYTES) {
      const oldest=manifestCache.keys().next().value;cachedManifestBytes-=manifestCache.get(oldest).value.bytes.length;manifestCache.delete(oldest);
    }
    manifestCache.set(path,{identity,value});cachedManifestBytes+=bytes.length;
    return value;
  }
  async function inputManifest(id) {
    const intent=await inputRequest(id),parsed=await manifestAt(inputRoot(id),'selected-manifest.json');
    ensure(parsed.manifestSha256===intent.manifestSha256,'CASE_PACKAGE_INPUT_CHANGED',
      'The received manifest differs from this original input.',409);
    return {...parsed,intent};
  }
  async function sourceLocation(selection) {
    object(selection,['kind','id']);identifier(selection.id);
    ensure(['input','operation'].includes(selection.kind),'CASE_PACKAGE_SELECTION','Select an original input or operation.');
    if(selection.kind==='input')return {directory:inputPackage(selection.id),selection};
    const intent=await request(selection.id),base=operationRoot(selection.id);
    ensure(intent.kind!=='inspect','CASE_PACKAGE_SELECTION','An inspection refers to its original package input.');
    return {directory:join(base,intent.kind==='receive'?'receiving/package':intent.kind==='remote'?'download':'package'),selection,intent};
  }
  async function selectedManifest(selection,expectedManifestSha256) {
    const location=await sourceLocation(selection);
    const parsed=await manifestAt(location.directory);
    if(expectedManifestSha256!==undefined)ensure(parsed.manifestSha256===digest(expectedManifestSha256),
      'CASE_PACKAGE_SELECTION_CHANGED','This package manifest differs from the original selection.',409);
    return {...location,...parsed};
  }
  function describe(manifest,manifestSha256) {
    return {exportId:manifest.exportId,manifestSha256,generatedAt:manifest.generatedAt,case:manifest.case,
      headRevision:manifest.caseHistory.headRevision,revisions:manifest.caseHistory.revisions.length,
      sourceBundles:manifest.sourceBundles.length,sourceFiles:manifest.sourceBundles.reduce((sum,row)=>sum+row.files.length,0),
      files:manifest.files.length,bytes:manifest.files.reduce((sum,row)=>sum+BigInt(row.bytes),0n).toString()};
  }
  async function getInput(id,{members=false,...options}={}) {
    identifier(id);const context=await inputManifest(id),available=[],missing=[];
    for(const file of context.manifest.files) {
      try{const path=await memberPath(inputPackage(id),file.name),stat=await lstat(path);
        if(stat.size===Number(file.bytes))available.push(file.name);else missing.push(file.name);}
      catch(problem){if(problem.code==='ENOENT')missing.push(file.name);else throw problem;}
    }
    const availableSet=new Set(available),state=await optional(join(inputRoot(id),'input-result.json'));
    return {id,kind:'input',request:context.intent,...describe(context.manifest,context.manifestSha256),
      state:state?.state??(missing.length?'AWAITING_FILES':'AWAITING_INSPECTION'),
      availableFiles:available.length,missingFiles:missing.length,inspection:state,
      ...(members?{members:slice(context.manifest.files.map(file=>({...file,present:availableSet.has(file.name)})),options)}:{})};
  }
  async function status(id) {
    const intent=await request(identifier(id)),base=operationRoot(id),saved=await optional(join(base,'operation-state.json'));
    const native=intent.kind==='receive'?await optional(join(base,'receiving/package-state/receiving-state.json')):null;
    return {id,request:intent,state:saved?.state??'PREPARED',stage:saved?.stage??'prepared',
      runningHere:active.has(id),observedState:saved,nativeReceiving:native,
      result:await optional(join(base,'operation-result.json'))};
  }
  async function list(options={}) {
    const rows=[];
    for(const name of (await readdir(operations)).filter(name=>ID.test(name)).sort(order)) {
      const intent=await optional(join(operationRoot(name),'operation-request.json'),65536);if(!intent)continue;
      const saved=await optional(join(operationRoot(name),'operation-state.json'));
      rows.push({id:name,kind:intent.kind,actor:intent.actor,createdAt:intent.createdAt,
        state:saved?.state??'PREPARED',stage:saved?.stage??'prepared',runningHere:active.has(name),
        source:intent.source??null,caseId:intent.caseId??saved?.case?.id??null,
        exportId:intent.exportId??null,manifestSha256:intent.manifestSha256??saved?.manifestSha256??null});
    }
    rows.sort((a,b)=>order(b.createdAt,a.createdAt)||order(a.id,b.id));return slice(rows,options);
  }
  async function listInputs(options={}) {
    const rows=[];
    for(const name of (await readdir(inputs)).filter(name=>ID.test(name)).sort(order)) {
      const intent=await optional(join(inputRoot(name),'input-request.json'),65536);if(!intent)continue;
      const result=await optional(join(inputRoot(name),'input-result.json'));
      rows.push({id:name,...intent,state:result?.state??'RETAINED_INPUT',inspection:result?.summary??null});
    }
    rows.sort((a,b)=>order(b.createdAt,a.createdAt)||order(a.id,b.id));return slice(rows,options);
  }
  async function prepareInput(value) {
    assertOpen();object(value,['id','actor','manifestText','expectedManifestSha256']);
    const id=identifier(value.id),who=actor(value.actor);
    ensure(typeof value.manifestText==='string'&&Buffer.byteLength(value.manifestText)<=MAX_CASE_SOURCE_MANIFEST_BYTES,
      'CASE_PACKAGE_MANIFEST_LIMIT','Select the complete original package manifest.');
    const bytes=Buffer.from(value.manifestText),parsed=parseCaseSourcePackageManifest(bytes);
    ensure(parsed.manifestSha256===digest(value.expectedManifestSha256),'CASE_PACKAGE_INPUT_CHANGED',
      'The selected manifest bytes differ from the original digest.',409);
    const base=await privateRoot(inputRoot(id)),identity={schema:'stellar-forge.merchant-case-package-input.v1',id,actor:who,
      manifestSha256:parsed.manifestSha256,exportId:parsed.manifest.exportId,case:parsed.manifest.case};
    const recorded=await optional(join(base,'input-request.json'),65536);
    if(recorded) {
      ensure(isDeepStrictEqual({...recorded,createdAt:undefined},{...identity,createdAt:undefined}),
        'CASE_PACKAGE_INPUT_CONFLICT','This input ID belongs to another original selection.',409);
      const priorBytes=await readBytes(join(base,'selected-manifest.json'),MAX_CASE_SOURCE_MANIFEST_BYTES).catch(problem=>{
        if(problem.code==='ENOENT')return null;throw problem;});
      if(priorBytes) {ensure(priorBytes.equals(bytes),'CASE_PACKAGE_INPUT_CHANGED','The original manifest bytes differ.',409);return getInput(id);}
    }
    await locked(join(base,'control'),async()=>{
      const prior=await optional(join(base,'input-request.json'),65536);
      if(prior)ensure(isDeepStrictEqual({...prior,createdAt:undefined},{...identity,createdAt:undefined}),
        'CASE_PACKAGE_INPUT_CONFLICT','This input ID belongs to another original selection.',409);
      else await atomicJson(join(base,'input-request.json'),{...identity,createdAt:now()});
      await atomicBytes(join(base,'selected-manifest.json'),bytes);await privateRoot(inputPackage(id));
    });
    return getInput(id);
  }
  async function upload({id,name,stream,signal}) {
    assertOpen();identifier(id);relativeName(name);
    const context=await inputManifest(id),file=context.fileIndex.get(name);
    ensure(file,'CASE_PACKAGE_MEMBER','This member is not in the original complete manifest.',404);
    return locked(join(inputRoot(id),'uploads',sha(name)),async()=>{
      const retained=await acceptStream(await memberPath(inputPackage(id),name,{create:true}),stream,
        {bytes:String(file.bytes),sha256:file.sha256},{signal:signal?AbortSignal.any([signal,shutdown.signal]):shutdown.signal});
      return {id,file:{...file,bytes:Number(retained.bytes)},reused:retained.reused};
    });
  }

  async function prepare(value) {
    assertOpen();object(value,['id','kind','actor','caseId','revision','source','expectedManifestSha256',
      'profile','exportId']);
    const id=identifier(value.id),who=actor(value.actor),kind=value.kind;
    ensure(['export','inspect','receive','remote'].includes(kind),'CASE_PACKAGE_OPERATION_KIND',
      'Choose export, inspect, receive or a configured remote receiving operation.');
    const selected={schema:'stellar-forge.merchant-case-package-operation.v1',id,kind,actor:who};
    if(kind==='export') {
      ensure(UUID.test(value.caseId??''),'CASE_PACKAGE_OPERATION_CASE','Select an original saved case.');
      selected.caseId=value.caseId;selected.revision=digest(value.revision);selected.exportId=id;
      ensure(value.source===undefined&&value.expectedManifestSha256===undefined&&value.profile===undefined&&
        (value.exportId===undefined||value.exportId===id),'CASE_PACKAGE_OPERATION_INPUT','An export uses its original operation ID.');
    } else if(kind==='remote') {
      selected.profile=identifier(value.profile);selected.exportId=identifier(value.exportId);
      selected.manifestSha256=digest(value.expectedManifestSha256);
      ensure(value.source===undefined&&value.caseId===undefined&&value.revision===undefined,
        'CASE_PACKAGE_OPERATION_INPUT','Remote receiving selects one configured source and original export.');
      ensure(handoffDesk&&typeof handoffDesk.connection==='function','CASE_PACKAGE_SOURCES_DISABLED',
        'Configure the original Handoffs source file for remote package receiving.',503);
      const connection=await handoffDesk.connection(selected.profile);
      selected.endpoint=connection.url;
    } else {
      ensure(value.caseId===undefined&&value.revision===undefined&&value.profile===undefined&&value.exportId===undefined,
        'CASE_PACKAGE_OPERATION_INPUT','Inspect or receive the selected complete package.');
      await sourceLocation(value.source);selected.source={kind:value.source.kind,id:value.source.id};
      selected.manifestSha256=digest(value.expectedManifestSha256);
    }
    const base=await privateRoot(operationRoot(id)),recorded=await optional(join(base,'operation-request.json'),65536);
    if(recorded) {
      ensure(isDeepStrictEqual({...recorded,createdAt:undefined},{...selected,createdAt:undefined}),
        'CASE_PACKAGE_OPERATION_CONFLICT','This operation ID belongs to a different original request.',409);
      return status(id);
    }
    await locked(join(base,'control'),async()=>{
      const prior=await optional(join(base,'operation-request.json'),65536);
      if(prior)ensure(isDeepStrictEqual({...prior,createdAt:undefined},{...selected,createdAt:undefined}),
        'CASE_PACKAGE_OPERATION_CONFLICT','This operation ID belongs to a different original request.',409);
      else await atomicJson(join(base,'operation-request.json'),{...selected,createdAt:now()});
    });
    return status(id);
  }
  async function finishInput(id,signal,progress) {
    const base=inputRoot(id);
    return locked(join(base,'control'),async()=>{
      const context=await inputManifest(id);
      let checked=0,checkedBytes=0n;
      for(const file of context.manifest.files) {
        signal?.throwIfAborted();
        const found=await fileDigest(await memberPath(inputPackage(id),file.name),Math.max(Number(file.bytes),1));
        ensure(found.bytes===String(file.bytes)&&found.sha256===file.sha256,'CASE_PACKAGE_INPUT_CHANGED',
          'A received member differs from the original complete manifest.',409);
        checked++;checkedBytes+=BigInt(file.bytes);
        if(checked%10===0||checked===context.manifest.files.length)
          await progress?.({stage:'verify-received-input',files:checked,totalFiles:context.manifest.files.length,
            bytes:checkedBytes.toString()});
      }
      await atomicBytes(join(inputPackage(id),'case-source-package.json'),context.bytes);
      const result=await inspectCaseSourcePackage({directory:inputPackage(id),
        expectedManifestSha256:context.manifestSha256,python,environment,signal});
      await atomicJson(join(base,'input-result.json'),{state:'COMPLETE',checkedAt:now(),summary:result},{replace:true});
      return result;
    });
  }
  async function selectionReady(selection,expectedManifestSha256,signal,progress) {
    let inspection=null;
    if(selection.kind==='input') {
      const input=await inputManifest(selection.id);
      ensure(input.manifestSha256===expectedManifestSha256,'CASE_PACKAGE_SELECTION_CHANGED',
        'This input differs from the selected package manifest.',409);
      inspection=await finishInput(selection.id,signal,progress);
    }
    return {...await selectedManifest(selection,expectedManifestSha256),inspection};
  }
  async function execute(id,handle) {
    const intent=await request(id),base=operationRoot(id);
    return locked(join(base,'control'),async()=>{
      const finished=await optional(join(base,'operation-result.json'));
      const previous=await optional(join(base,'operation-state.json'));
      if(finished) {
        ensure(finished.state==='COMPLETE','CASE_PACKAGE_OPERATION_RESULT','The original completion record is invalid.',409);
        if(previous?.state!=='COMPLETE')await atomicJson(join(base,'operation-state.json'),{
          schema:CASE_PACKAGE_OPERATIONS_SCHEMA,...previous,id,kind:intent.kind,actor:intent.actor,
          state:'COMPLETE',stage:'complete',completedAt:previous?.completedAt??now(),updatedAt:now(),
          reconciledCompletion:true,lastError:null,manifestSha256:finished.manifestSha256??finished.receiving?.manifestSha256??null,
          case:finished.receiving?.case??finished.case??null},{replace:true});
        return finished;
      }
      let state=previous??{},stage='start-original-operation';
      const checkpoint=async patch=>{
        state={schema:CASE_PACKAGE_OPERATIONS_SCHEMA,id,kind:intent.kind,actor:intent.actor,
          ...state,...patch,updatedAt:now()};
        await atomicJson(join(base,'operation-state.json'),state,{replace:true});
      };
      const progress=async patch=>{stage=patch.stage??stage;await checkpoint({state:'RUNNING',...patch});};
      try {
        await progress({stage,startedAt:state.startedAt??now(),lastError:null});
        handle.controller.signal.throwIfAborted();
        let result;
        if(intent.kind==='export') {
          stage='export-original-case-history-and-sources';await progress({stage});
          result=await exportCaseSourcePackage({store,casesDirectory:cases,id:intent.caseId,
            revision:intent.revision,directory:join(base,'package'),exportId:intent.exportId,
            sourceDelivery,python,environment,signal:handle.controller.signal});
        } else if(intent.kind==='remote') {
          const connection=await handoffDesk.connection(intent.profile);
          ensure(connection.url===intent.endpoint,'CASE_PACKAGE_SOURCE_CHANGED',
            'The configured original source endpoint changed. Preserve this operation and restore its original source.',409);
          stage='download-original-complete-package';await progress({stage});
          const download=await remoteTransfer.download({url:connection.url,tokenEnv:connection.tokenEnv,
            environment,exportId:intent.exportId,directory:join(base,'download'),
            expectedManifestSha256:intent.manifestSha256,signal:handle.controller.signal,
            onProgress:value=>progress({stage:'download-original-complete-package',download:value})});
          stage='inspect-downloaded-originals';await progress({stage});
          const inspection=await inspectCaseSourcePackage({directory:join(base,'download'),
            expectedManifestSha256:intent.manifestSha256,python,environment,signal:handle.controller.signal});
          stage='receive-original-case-and-all-sources';await progress({stage});
          const receiving=await receiveCaseSourcePackage({directory:join(base,'download'),
            receivingDirectory:join(base,'receiving'),casesDirectory:cases,sourceDelivery,
            requestId:intent.id,actor:intent.actor,expectedManifestSha256:intent.manifestSha256,
            python,environment,signal:handle.controller.signal});
          result={schema:CASE_PACKAGE_OPERATIONS_SCHEMA,state:'COMPLETE',kind:'remote',download,inspection,receiving};
        } else {
          stage='select-original-complete-package';await progress({stage});
          const context=await selectionReady(intent.source,intent.manifestSha256,handle.controller.signal,progress);
          if(intent.kind==='inspect') {
            stage='inspect-original-package';await progress({stage});
            result=context.inspection??await inspectCaseSourcePackage({directory:context.directory,
              expectedManifestSha256:intent.manifestSha256,python,environment,signal:handle.controller.signal});
          } else {
            stage='receive-original-case-and-all-sources';await progress({stage});
            result=await receiveCaseSourcePackage({directory:context.directory,receivingDirectory:join(base,'receiving'),
              casesDirectory:cases,sourceDelivery,requestId:intent.id,actor:intent.actor,
              expectedManifestSha256:intent.manifestSha256,python,environment,signal:handle.controller.signal});
          }
        }
        await atomicJson(join(base,'operation-result.json'),result);
        await checkpoint({state:'COMPLETE',stage:'complete',completedAt:now(),lastError:null,
          manifestSha256:result.manifestSha256??result.receiving?.manifestSha256??null,
          case:result.receiving?.case??result.case??null});
        return result;
      } catch(problem) {
        try{await checkpoint({state:handle.controller.signal.aborted?'PAUSED':'NEEDS_CONTINUATION',
          stage,lastError:casePackageProblem(problem)});}
        catch(checkpointError){problem.checkpointError=checkpointError;}
        throw problem;
      }
    });
  }
  async function run(id) {
    assertOpen();identifier(id);await request(id);assertOpen();
    if(active.has(id))return {...await status(id),joined:true};
    const handle={controller:new AbortController(),done:null,lastError:null};
    active.set(id,handle);
    handle.done=execute(id,handle).catch(problem=>{handle.lastError=casePackageProblem(problem);throw problem;})
      .finally(()=>{if(active.get(id)===handle)active.delete(id);});
    handle.done.catch(()=>{});
    return {...await status(id),joined:false};
  }
  async function wait(id) {
    const current=active.get(identifier(id));if(current)await current.done;
    return status(id);
  }
  async function stop(id) {
    identifier(id);const current=active.get(id);
    if(!current){const observed=await status(id);if(['PAUSED','COMPLETE'].includes(observed.state))return observed;}
    ensure(current,'CASE_PACKAGE_OPERATION_NOT_OWNED','This process does not own a running instance of that operation.',409);
    current.controller.abort();await current.done.catch(()=>{});return status(id);
  }
  async function inspectRemote({profile,exportId}) {
    assertOpen();identifier(profile);identifier(exportId);
    ensure(handoffDesk&&typeof handoffDesk.connection==='function','CASE_PACKAGE_SOURCES_DISABLED',
      'Configure the original Handoffs source file before inspecting a remote package.',503);
    const source=await handoffDesk.connection(profile);
    assertOpen();
    const result=await remoteTransfer.inspect({url:source.url,tokenEnv:source.tokenEnv,environment,exportId,signal:shutdown.signal});
    return {profile,...result,summary:describe(result.manifest,result.manifestSha256)};
  }
  async function inventory({source,expectedManifestSha256,section='files',bundleId,manifestSha256,...options}) {
    object(source,['kind','id']);identifier(source.id);
    const context=source.kind==='input'?await inputManifest(source.id):await selectedManifest(source,expectedManifestSha256);
    if(expectedManifestSha256!==undefined)ensure(context.manifestSha256===digest(expectedManifestSha256),
      'CASE_PACKAGE_SELECTION_CHANGED','The original package selection changed.',409);
    ensure(['files','sourceBundles','originalFiles','revisions'].includes(section),'CASE_PACKAGE_INVENTORY','Choose files, source bundles, original members or case revisions.');
    let rows;
    if(section==='sourceBundles')rows=context.manifest.sourceBundles.map(({manifestText,files,...row})=>({...row,files:files.length}));
    else if(section==='originalFiles') {
      digest(bundleId);digest(manifestSha256);
      const bundle=context.bundleIndex.get(bundleId+'\0'+manifestSha256);
      ensure(bundle,'CASE_PACKAGE_SOURCE_BUNDLE','Choose an original bundle in this package.',404);rows=bundle.files;
    } else rows=section==='revisions'?context.manifest.caseHistory.revisions:context.manifest.files;
    return {source,section,...describe(context.manifest,context.manifestSha256),...slice(rows,options)};
  }
  async function manifest(source,expectedManifestSha256) {
    const context=await selectedManifest(source,expectedManifestSha256);
    return {source,...describe(context.manifest,context.manifestSha256),manifest:context.manifest,
      manifestFile:{name:'case-source-package.json',bytes:context.bytes.length,sha256:context.manifestSha256}};
  }
  async function artifact({source,name,expectedManifestSha256}) {
    const context=await selectedManifest(source,expectedManifestSha256);relativeName(name);
    const file=name==='case-source-package.json'?{name,bytes:context.bytes.length,sha256:context.manifestSha256,role:'complete-manifest'}:
      context.fileIndex.get(name);
    ensure(file,'CASE_PACKAGE_MEMBER','This file is absent from the complete original manifest.',404);
    return {source,directory:context.directory,manifestSha256:context.manifestSha256,exportId:context.manifest.exportId,
      path:await memberPath(context.directory,name),file:{...file,bytes:Number(file.bytes)}};
  }
  async function readFile({source,name,expectedManifestSha256,expectedSha256,readId,offset=0,limit=65536}) {
    object(source,['kind','id']);identifier(source.id);
    const scope=source.kind+':'+source.id,manifestSha=digest(expectedManifestSha256);
    relativeName(name);
    const result=await reads.read({scope,key:manifestSha+'\0'+name,directory:root,
      readId,offset,limit,expectedSha256,
      load:async()=>{
        const selected=await artifact({source,name,expectedManifestSha256:manifestSha});
        const handle=await open(selected.path,constants.O_RDONLY|constants.O_NOFOLLOW);let transferred=false;
        try {
          const stat=await handle.stat();
          ensure(stat.isFile()&&stat.size===selected.file.bytes,'CASE_PACKAGE_MEMBER_CHANGED',
            'The retained original file size changed.',409);
          const value={readonlyFileHandle:handle,bytes:selected.file.bytes,sha256:selected.file.sha256,
            name:selected.file.name,type:mediaType(name)};
          transferred=true;return value;
        } finally{if(!transferred)await handle.close();}
      }});
    return {source,manifestSha256:manifestSha,...result};
  }
  async function release({source,readId}) {
    object(source,['kind','id']);identifier(source.id);
    ensure(['input','operation'].includes(source.kind)&&UUID.test(readId??''),
      'CASE_PACKAGE_FILE_READ','Choose this original file read.');
    await reads.release(source.kind+':'+source.id,readId);return {source,readId,released:true};
  }
  async function exportManifest(exportId) {
    const intent=await request(identifier(exportId));
    ensure(intent.kind==='export'&&intent.exportId===exportId,'CASE_PACKAGE_EXPORT_NOT_FOUND',
      'Select a complete original package export.',404);
    const value=await manifest({kind:'operation',id:exportId});
    return {state:'MANIFEST_RETAINED',exportId,manifestSha256:value.manifestSha256,manifestFile:value.manifestFile,
      case:value.case,sourceBundles:value.sourceBundles,revisions:value.revisions};
  }
  async function exportFile(value) {
    object(value,['exportId','file','expectedManifestSha256','expectedSha256','readId','offset','limit']);
    const intent=await request(identifier(value.exportId));
    ensure(intent.kind==='export'&&intent.exportId===value.exportId,'CASE_PACKAGE_EXPORT_NOT_FOUND',
      'Select a complete original package export.',404);
    const result=await readFile({source:{kind:'operation',id:value.exportId},name:value.file,
      expectedManifestSha256:value.expectedManifestSha256,expectedSha256:value.expectedSha256,
      readId:value.readId,offset:value.offset,limit:value.limit});
    return {exportId:value.exportId,...result};
  }
  async function originalFile({source,expectedManifestSha256,bundleId,manifestSha256,path}) {
    const context=await selectedManifest(source,expectedManifestSha256);digest(bundleId);digest(manifestSha256);relativeName(path);
    const bundle=context.bundleIndex.get(bundleId+'\0'+manifestSha256),
      member=bundle?.files.find(row=>row.path===path);
    ensure(member,'CASE_PACKAGE_ORIGINAL_MEMBER','This original member is absent from the selected native bundle.',404);
    const found=await sourceDelivery.resolveFile({bundleId,manifestSha256,path});
    ensure(found.sha256===member.sha256&&Number(found.bytes)===Number(member.bytes),
      'CASE_PACKAGE_ORIGINAL_CHANGED','The native source member differs from the package identity.',409);
    return {source,packageManifestSha256:context.manifestSha256,bundleId,manifestSha256,
      path:found.path,url:found.url,file:{name:path,bytes:Number(member.bytes),sha256:member.sha256,role:member.role}};
  }
  async function readOriginal(value) {
    const {source,expectedManifestSha256,bundleId,manifestSha256,path,expectedSha256,readId,offset=0,limit=65536}=value;
    object(source,['kind','id']);identifier(source.id);digest(expectedManifestSha256);digest(bundleId);digest(manifestSha256);relativeName(path);
    const result=await reads.read({scope:source.kind+':'+source.id,key:expectedManifestSha256+'\0native\0'+manifestSha256+'\0'+path,
      directory:root,readId,offset,limit,expectedSha256,
      load:async()=>{
        const selected=await originalFile(value),handle=await open(selected.path,constants.O_RDONLY|constants.O_NOFOLLOW);
        let transferred=false;
        try {const stat=await handle.stat();ensure(stat.isFile()&&stat.size===selected.file.bytes,
          'CASE_PACKAGE_ORIGINAL_CHANGED','The retained original source size changed.',409);
          const result={readonlyFileHandle:handle,bytes:selected.file.bytes,sha256:selected.file.sha256,
            name:path,type:mediaType(path)};transferred=true;return result;
        } finally{if(!transferred)await handle.close();}
      }});
    return {source,packageManifestSha256:expectedManifestSha256,bundleId,manifestSha256,...result};
  }
  async function receivedCase(id) {
    const value=await status(id),result=value.result;
    ensure(value.state==='COMPLETE'&&['receive','remote'].includes(value.request.kind),
      'CASE_PACKAGE_RECEIVING_INCOMPLETE','Complete this original receiving operation before opening its case.',409);
    const received=value.request.kind==='remote'?result.receiving:result;
    const record=await store.read(received.case.id);
    return {operationId:id,sourceCase:received.sourceCase,importedRevision:received.case.importedRevision,
      case:{id:record.id,revision:record.revision},sourceDirectory:sourceRoot,
      originalCaseHistory:received.originalCaseHistory,sourceBundles:received.sourceBundles.length};
  }
  async function close() {
    if(closePromise)return closePromise;closing=true;
    closePromise=(async()=>{
      shutdown.abort();for(const handle of active.values())handle.controller.abort();
      const outcomes=await Promise.allSettled([...active.values()].map(handle=>handle.done).concat([...pending]));
      await reads.close();manifestCache.clear();cachedManifestBytes=0;
      return {closed:true,stopped:outcomes.length};
    })().catch(problem=>{closePromise=null;throw problem;});
    return closePromise;
  }
  return Object.freeze({directory:root,casesDirectory:cases,sourceDirectory:sourceRoot,
    catalog:()=>({schema:CASE_PACKAGE_OPERATIONS_SCHEMA,enabled:true,directory:root,casesDirectory:cases,
      sourceDirectory:sourceRoot,remoteSources:handoffDesk?.profiles?.().sources??[],
      limits:{manifestBytes:MAX_CASE_SOURCE_MANIFEST_BYTES,fileBytes:SOURCE_ARCHIVE_LIMITS.archiveBytes,
        chunkBytes:MAX_RETAINED_CHUNK_BYTES},fileReads:reads.summary}),
    list,listInputs,status,getInput,
    prepareInput:value=>track(()=>prepareInput(value)),upload:value=>track(()=>upload(value)),
    prepare:value=>track(()=>prepare(value)),run:id=>track(()=>run(id)),wait:id=>track(()=>wait(id)),
    stop:id=>track(()=>stop(id)),inspectRemote:value=>track(()=>inspectRemote(value)),
    inventory,manifest,artifact,readFile,release,exportManifest,exportFile,originalFile,readOriginal,receivedCase,close});
}
export function casePackageMediaType(name) {
  return mediaType(name);
}
function mediaType(name) {
  return name.endsWith('.json')?'application/json':name.endsWith('.html')?'text/html; charset=utf-8':
    name.endsWith('.csv')?'text/csv; charset=utf-8':name.endsWith('.md')||name.endsWith('.txt')?
    'text/plain; charset=utf-8':name.endsWith('.zip')?'application/zip':'application/octet-stream';
}

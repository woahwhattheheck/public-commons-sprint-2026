// MIT. Agent operation of the same retained Baserow source browser and publisher.
import { constants } from 'node:fs';
import { open, lstat, realpath, mkdtemp, unlink, rmdir } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { BaserowRetainedExports, BASEROW_EXPORT_MAX_BYTES, BASEROW_DEPLOYMENT_NAMES,
  baserowExportSelection } from './baserow-workspace-files.mjs';
import { BASEROW_PUBLISHER_READ_ACTIONS, BASEROW_PUBLISHER_WRITE_ACTIONS } from
  '../../stellar/scf-starforge-20261009/sf30-seller-sdk/baserow/workspace/publisher-operations.mjs';

export const BASEROW_WORKSPACE_CONNECTION_SCHEMA='stellar-forge.baserow-workspace-connection.v1';
const ALIAS=/^[a-z0-9][a-z0-9_-]{0,63}$/,HASH=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const V4=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const sha=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>Array.isArray(value)?value.map(canonical):plain(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const identity=value=>sha(JSON.stringify(canonical(value)));
const fail=(code,message=code)=>Object.assign(new Error(message),{code});
const decode=value=>new TextDecoder('utf-8',{fatal:true}).decode(value);
function exact(value,keys,required=[]) {
  if(!plain(value)||Object.keys(value).some(key=>!keys.includes(key))||required.some(key=>!Object.hasOwn(value,key)))
    throw fail('BASEROW_MCP_INVALID_PARAMS','Use the declared fields and every required original identifier.');
}
function checked(value,pattern,label) {
  if(typeof value!=='string'||!pattern.test(value))throw fail('BASEROW_MCP_INVALID_PARAMS','Use a valid '+label+'.');
  return value;
}
function line(value,label,max=160) {
  if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u001f\u007f]/.test(value))
    throw fail('BASEROW_MCP_INVALID_PARAMS','Use printable '+label+'.');
  return value;
}
function hostPath(value,base) {
  if(typeof value!=='string'||!value||value.includes('\0'))throw fail('CONFIGURATION_ERROR','Declare an original host path.');
  return resolve(base,value);
}
async function sourceHandle(path,maximum=BASEROW_EXPORT_MAX_BYTES) {
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try {
    const info=await handle.stat();
    if(!info.isFile()||info.nlink!==1||info.size>maximum||process.platform!=='win32'&&info.mode&0o077)
      throw fail('BASEROW_MCP_PRIVATE_FILE_REQUIRED','Use the original private regular source file.');
    return {handle,info};
  } catch(issue){await handle.close();throw issue;}
}
async function fileBytes(path,maximum) {
  const {handle,info}=await sourceHandle(path,maximum);
  try {
    const content=await handle.readFile(),after=await handle.stat();
    if(content.length!==info.size||after.size!==info.size||after.mtimeMs!==info.mtimeMs||after.ctimeMs!==info.ctimeMs)
      throw fail('BASEROW_MCP_INPUT_CHANGED');
    return content;
  } finally{await handle.close();}
}
async function fingerprint(handle,info) {
  const digest=createHash('sha256');let size=0;
  for await(const block of handle.createReadStream({autoClose:false,start:0})){size+=block.length;digest.update(block);}
  const after=await handle.stat();
  if(size!==info.size||after.size!==info.size||after.mtimeMs!==info.mtimeMs||after.ctimeMs!==info.ctimeMs)
    throw fail('BASEROW_MCP_INPUT_CHANGED');
  return {bytes:size,sha256:digest.digest('hex')};
}
// A host-selected input may still have an active writer. Freeze its exact bytes
// before the original receiving operation can make any change.
async function snapshotInput(file,expectedSha256,maximum) {
  const {handle:source}=await sourceHandle(file.path,maximum);
  let snapshot,temporary,snapshotPath,retained=false;
  try {
    const before=await source.stat({bigint:true});
    if(!before.isFile()||before.nlink!==1n||before.size>BigInt(maximum)||
        process.platform!=='win32'&&((before.mode&0o077n)!==0n||
          typeof process.getuid==='function'&&before.uid!==BigInt(process.getuid())))
      throw fail('BASEROW_MCP_PRIVATE_FILE_REQUIRED','Use the original owned private regular source file.');
    const bytes=Number(before.size);
    if(file.bytes!==undefined&&file.bytes!==bytes||file.sha256&&file.sha256!==expectedSha256)
      throw fail('BASEROW_MCP_INPUT_CHANGED');
    temporary=await mkdtemp(join(tmpdir(),'sf-baserow-input-'));
    snapshotPath=join(temporary,'snapshot');
    snapshot=await open(snapshotPath,'wx+',0o600);
    await unlink(snapshotPath);snapshotPath=null;
    await rmdir(temporary);temporary=null;
    const digest=createHash('sha256'),block=Buffer.alloc(Math.min(1048576,Math.max(bytes,1)));
    let position=0;
    while(position<bytes) {
      const {bytesRead}=await source.read(block,0,Math.min(block.length,bytes-position),position);
      if(!bytesRead)throw fail('BASEROW_MCP_INPUT_CHANGED');
      const chunk=block.subarray(0,bytesRead);digest.update(chunk);
      let written=0;
      while(written<bytesRead) {
        const result=await snapshot.write(chunk,written,bytesRead-written,position+written);
        if(!result.bytesWritten)throw fail('BASEROW_MCP_INPUT_SNAPSHOT_FAILED');
        written+=result.bytesWritten;
      }
      position+=bytesRead;
    }
    const extra=await source.read(block,0,1,bytes),after=await source.stat({bigint:true});
    if(extra.bytesRead||['dev','ino','size','mtimeNs','ctimeNs','mode','uid','nlink'].some(key=>before[key]!==after[key])||
        digest.digest('hex')!==expectedSha256)
      throw fail('BASEROW_MCP_INPUT_CHANGED','The selected packet changed before receiving. Inspect the same source input.');
    await snapshot.sync();await source.close();retained=true;
    return {handle:snapshot,bytes};
  } finally {
    await source.close().catch(()=>{});
    if(!retained)await snapshot?.close().catch(()=>{});
    if(snapshotPath)await unlink(snapshotPath).catch(()=>{});
    if(temporary)await rmdir(temporary).catch(()=>{});
  }
}
export async function readBaserowWorkspaceConfiguration(path) {
  path=resolve(path);const raw=JSON.parse(decode(await fileBytes(path,1048576))),base=dirname(path);
  exact(raw,['schema','workspaces'],['schema','workspaces']);
  if(raw.schema!==BASEROW_WORKSPACE_CONNECTION_SCHEMA||!plain(raw.workspaces)||
      Object.keys(raw.workspaces).length<1||Object.keys(raw.workspaces).length>32)
    throw fail('CONFIGURATION_ERROR','Declare 1–32 original Baserow source workspaces.');
  const workspaces=Object.create(null),directories=new Set();
  for(const [alias,input] of Object.entries(raw.workspaces)) {
    checked(alias,ALIAS,'workspace alias');
    exact(input,['label','directory','consoleUrlEnv','consoleUrlFile','files','terms','runtimes'],['directory']);
    if((input.consoleUrlEnv===undefined)===(input.consoleUrlFile===undefined))
      throw fail('CONFIGURATION_ERROR','Bind exactly one original source console URL file or environment name.');
    const directory=hostPath(input.directory,base),stat=await lstat(directory),canonical=await realpath(directory);
    if(!stat.isDirectory()||stat.isSymbolicLink()||process.platform!=='win32'&&stat.mode&0o077||canonical!==directory||directories.has(canonical))
      throw fail('CONFIGURATION_ERROR','Each alias must bind one distinct original private Baserow workspace.');
    directories.add(canonical);
    const files=Object.create(null),terms=Object.create(null),runtimes=Object.create(null);
    for(const key of ['files','terms','runtimes'])if(input[key]!==undefined&&(!plain(input[key])||Object.keys(input[key]).length>128))
      throw fail('CONFIGURATION_ERROR','Declare up to 128 original '+key+' aliases.');
    for(const [file,item] of Object.entries(input.files??{})) {
      checked(file,ALIAS,'source packet alias');exact(item,['path','label','sha256'],['path']);
      files[file]={path:hostPath(item.path,base),label:line(item.label??file,'source packet label'),
        ...(item.sha256===undefined?{}:{sha256:checked(item.sha256,HASH,'source packet SHA256')})};
    }
    for(const [name,item] of Object.entries(input.terms??{})) {
      checked(name,ALIAS,'merchant terms profile');exact(item,['origin','path','payment'],['origin','path','payment']);
      if(!plain(item.payment)||typeof item.origin!=='string'||typeof item.path!=='string')throw fail('CONFIGURATION_ERROR','Declare complete original public payment terms.');
      terms[name]=structuredClone(item);
    }
    for(const [name,item] of Object.entries(input.runtimes??{})) {
      checked(name,ALIAS,'runtime profile');exact(item,['port','facilitator','allowLocalFacilitator']);
      if(item.port!==undefined&&(!Number.isSafeInteger(item.port)||item.port<0||item.port>65535)||
          item.facilitator!==undefined&&typeof item.facilitator!=='string'||
          item.allowLocalFacilitator!==undefined&&typeof item.allowLocalFacilitator!=='boolean')
        throw fail('CONFIGURATION_ERROR','Declare original SF82 dataset runtime options.');
      runtimes[name]=structuredClone(item);
    }
    workspaces[alias]={directory,label:line(input.label??alias,'workspace label'),files,terms,runtimes,
      ...(input.consoleUrlFile===undefined?{consoleUrlEnv:checked(input.consoleUrlEnv,/^[A-Za-z_][A-Za-z0-9_]*$/,'console environment name')}
        :{consoleUrlFile:hostPath(input.consoleUrlFile,base)})};
  }
  return {schema:BASEROW_WORKSPACE_CONNECTION_SCHEMA,workspaces};
}
const alias={type:'string',pattern:ALIAS.source},id={type:'string',pattern:UUID.source},v4={type:'string',pattern:V4.source};
const hash={type:'string',pattern:HASH.source},object={type:'object'},positive={type:'integer',minimum:1},revision={type:'integer',minimum:0};
const scope={workspace:alias},page={offset:revision,limit:{type:'integer',minimum:1,maximum:100}};
const read={readOnly:true,idempotent:true},write={idempotent:true,openWorld:true};
const publisherActions=['open','close',...BASEROW_PUBLISHER_READ_ACTIONS,...BASEROW_PUBLISHER_WRITE_ACTIONS];
const deploymentActions=['status','package','compare','review','prepare','stage','open','close','command'];
export function baserowWorkspaceTools(tool) {
  return [
    tool('merchant_baserow_workspaces','List declared original Baserow source consoles, packet inputs and merchant/runtime profile names. Browser and agent share the same saved source and publisher.',{},[],read),
    tool('merchant_baserow_status','Read the current native source draft/revision/selection, captures, versions, discovery pages and pending requests. Private browser credentials remain on the host.',{...scope,limit:page.limit,capturesOffset:revision,versionsOffset:revision,discoveriesOffset:revision},['workspace'],read),
    tool('merchant_baserow_input','Inspect one complete host-declared source packet and its original byte count/SHA256 before importing it.',{...scope,file:alias},['workspace','file'],read),
    tool('merchant_baserow_discover','Inspect an actual public grid or authorized table through an existing Baserow connectionAlias. input retains slug/tableId/viewId/filter/search and a stable requestId. Saved discovery preserves native field IDs/types and full source selection.',{...scope,input:object},['workspace','input'],write),
    tool('merchant_baserow_discovery','Read the original saved discovery including full fields, view selection and actual source metadata.',{...scope,id},['workspace','id'],read),
    tool('merchant_baserow_capture','Capture all original pages and selected attachment bytes. input requires discoveryId, connectionAlias, explicit orderBy, queries, attachments, title, expectedDraftRevision and one requestId. Reconcile the same request after interruption.',{...scope,input:object},['workspace','input'],write),
    tool('merchant_baserow_capture_read','Read complete native record pages, file descriptors, source schema or a retained interrupted capture attempt. For a complete capture, pin expectedCaptureSha256 and continue nextOffset to null. Exact number tokens and structured values remain complete.',{...scope,id,kind:{enum:['rows','files','schema','attempt']},expectedCaptureSha256:hash,...page},['workspace','id','kind'],read),
    tool('merchant_baserow_draft','Save the complete public query/projection draft against its original expectedRevision. Keep source field IDs, explicit scalar encodings, nullable values and original requestId.',{...scope,draft:object,expectedRevision:revision,requestId:id},['workspace','draft','expectedRevision','requestId'],write),
    tool('merchant_baserow_preview','Validate every original captured row against this exact draftRevision, producing the native preview ID and complete reports.',{...scope,draftRevision:revision,requestId:id},['workspace','draftRevision','requestId'],write),
    tool('merchant_baserow_version','Read, review/save or select an original source version. Save input contains draftRevision, previewId, reviewer, note, expectedSelectedVersion and requestId; select uses versionId, expectedSelectedVersion and requestId.',{...scope,action:{enum:['read','save','select']},id:positive,input:object},['workspace','action'],write),
    tool('merchant_baserow_compare','Compare the complete schemas and retained dataset results of two original saved source versions.',{...scope,left:positive,right:positive},['workspace','left','right'],read),
    tool('merchant_baserow_publisher','Operate the same original publisher and scheduler used by the source browser. Open/close use a source requestId; reads use input; writes require current expectedSelectedVersion and requestId. Extract additionally pins planId/planDigest and an explicit runId. Native review IDs, target revisions and buyer handoff records remain authoritative.',{...scope,action:{enum:publisherActions},input:object,expectedSelectedVersion:positive,requestId:id},['workspace','action'],write),
    tool('merchant_baserow_deployment','Review and prepare the original merchant package, stage it into this source workspace SF82 store, and operate that same native release console. Review selects host termsProfile; stage selects host runtimeProfile. Other inputs preserve native review/request IDs, source hashes, console instance and release generation.',{...scope,action:{enum:deploymentActions},input:object},['workspace','action'],write),
    tool('merchant_baserow_operation','Inspect the exact source request after a lost reply; resume:true reconciles that original request. Current publisher/run state remains available through publisher reads.',{...scope,requestId:id,resume:{type:'boolean'}},['workspace','requestId'],write),
    tool('merchant_baserow_import','Receive a complete original source packet from one declared file alias or retained source export. Pin its original SHA256, title, expectedDraftRevision and requestId. Receiving reuses all captured rows/files and original source metadata.',{...scope,file:alias,exportId:v4,expectedSha256:hash,title:{type:'string',maxLength:128},expectedDraftRevision:revision,requestId:id},['workspace','expectedSha256','title','expectedDraftRevision','requestId'],write),
    tool('merchant_baserow_export','Retain an entire native capture/version packet, original five-file merchant deployment, combined handoff, or one original attachment. Choose a stable exportId and exact selection hashes. Repeating that ID recovers the same retained files.',{...scope,exportId:v4,selection:object},['workspace','exportId','selection'],write),
    tool('merchant_baserow_exports','Page original complete and preparing exports, including lost initial replies. Continue the returned expectedSnapshot with offset.',{...scope,...page,expectedSnapshot:hash},['workspace'],read),
    tool('merchant_baserow_export_manifest','Read a retained completion manifest and its SHA256. The complete original files remain available with the source browser closed.',{exportId:v4},['exportId'],read),
    tool('merchant_baserow_export_file','Read an original retained file in SHA-pinned base64 ranges. Repeat manifest/file hashes and readId; use nextOffset until null. Large source packets stream once into the shared private snapshot.',{exportId:v4,file:{type:'string',maxLength:80},expectedManifestSha256:hash,expectedSha256:hash,readId:v4,offset:revision,limit:{type:'integer',minimum:1,maximum:196608}},['exportId','file','expectedManifestSha256','expectedSha256'],read),
    tool('merchant_baserow_export_file_release','Release the temporary original download snapshot while retaining its source export for later receiving.',{exportId:v4,readId:v4},['exportId','readId'],{idempotent:true}),
  ];
}
const definitions=new Map(baserowWorkspaceTools((name,description,properties,required)=>({name,properties,required})).map(value=>[value.name,value]));
async function responseBytes(response,maximum=67108864) {
  const blocks=[];let length=0;
  for await(const block of response.body??[]){length+=block.length;if(length>maximum)throw fail('BASEROW_MCP_REPLY_TOO_LARGE','Use the complete retained export for this native result.');blocks.push(block);}
  return Buffer.concat(blocks,length);
}
// Strip only native control-envelope credentials. Query columns and source
// records may legitimately be named token, operatorUrl or url.
function controlView(value) {
  if(!plain(value))return value;
  const {url,operatorUrl,token,...result}=value;
  return result;
}
function operationResult(kind,value) {
  if(!plain(value))return value;
  if(['PUBLISHER','STOP_PUBLISHER','DEPLOYMENT_CONSOLE_OPEN','DEPLOYMENT_CONSOLE_CLOSE'].includes(kind))
    return controlView(value);
  if(kind==='DEPLOYMENT_COMMAND'&&Object.hasOwn(value,'currentConsole'))
    return {...value,currentConsole:controlView(value.currentConsole)};
  return value;
}
function operationView(value) {
  return plain(value)?{...value,result:operationResult(value.kind,value.result)}:value;
}
function safeView(value,tool,input) {
  if(!plain(value))return value;
  if(tool==='merchant_baserow_status')
    return {...value,publisher:controlView(value.publisher),deployment:controlView(value.deployment)};
  if(tool==='merchant_baserow_publisher'&&['open','close'].includes(input.action))return controlView(value);
  if(tool==='merchant_baserow_operation')return operationView(value);
  if(tool==='merchant_baserow_deployment') {
    if(['open','close'].includes(input.action))return controlView(value);
    if(input.action==='status')return {...value,console:controlView(value.console),
      operations:value.operations.map(operationView)};
    if(input.action==='command')return operationResult('DEPLOYMENT_COMMAND',value);
  }
  return value;
}
export class MerchantBaserowWorkspaces {
  #config;#exports;#sessions=new Map();#pending=new Set();#closing=false;#close;
  constructor(config) {
    this.#config=config;
    this.#exports=new BaserowRetainedExports({directory:config.exportsDirectory,workspaces:config.baserowWorkspaces?.workspaces??{}});
  }
  get summary() {
    return {configured:Boolean(this.#config.baserowWorkspaces),...this.#exports.summary,
      workspaces:Object.entries(this.#config.baserowWorkspaces?.workspaces??{}).map(([workspace,item])=>({
        workspace,label:item.label,ownership:'ORIGINAL_SOURCE_CONSOLE',inputs:Object.entries(item.files).map(([file,value])=>({file,label:value.label,sha256:value.sha256??null})),
        termsProfiles:Object.keys(item.terms),runtimeProfiles:Object.keys(item.runtimes)}))};
  }
  #definition(workspace) {
    checked(workspace,ALIAS,'workspace alias');
    const value=this.#config.baserowWorkspaces?.workspaces[workspace];
    if(!value)throw fail('BASEROW_MCP_NOT_CONFIGURED','Choose a declared original Baserow workspace.');
    return value;
  }
  async #request(connection,route,{body,method=body===undefined?'GET':'POST',headers={}}={}) {
    try {
      const response=await fetch(connection.origin+route,{method,redirect:'error',signal:AbortSignal.timeout(175000),
        headers:{'x-baserow-workspace-token':connection.token,origin:connection.origin,...headers},
        ...(body===undefined?{}:{body,...(typeof body==='string'||Buffer.isBuffer(body)?{}:{duplex:'half'})})});
      if(!response.ok) {
        let detail;try{detail=JSON.parse(decode(await responseBytes(response,65536)));}catch{}
        const code=/^[A-Z][A-Z0-9_]{0,79}$/.test(detail?.error??'')?detail.error:'BASEROW_MCP_NATIVE_REJECTED';
        const issue=fail(code,'Original Baserow operation returned HTTP '+response.status+'. '+(typeof detail?.message==='string'?detail.message.slice(0,1000):'Inspect the original saved request.'));
        issue.nativeReply=true;issue.status=response.status;throw issue;
      }
      return response;
    } catch(issue) {
      if(issue.nativeReply)throw issue;
      throw fail('BASEROW_MCP_RESPONSE_INTERRUPTED','Reconnect the original source console and inspect the same native request before another change.');
    }
  }
  async #json(connection,route,input) {
    const body=input===undefined?undefined:JSON.stringify(input);
    if(body!==undefined&&Buffer.byteLength(body)>262144)throw fail('BASEROW_MCP_INPUT_TOO_LARGE','Use a declared source packet file for complete large input.');
    const response=await this.#request(connection,route,{body,headers:body===undefined?{}:{'content-type':'application/json'}});
    return JSON.parse(decode(await responseBytes(response)));
  }
  async #connection(workspace) {
    const definition=this.#definition(workspace);
    const raw=definition.consoleUrlFile?decode(await fileBytes(definition.consoleUrlFile,4096)).trim():process.env[definition.consoleUrlEnv];
    let url;try{url=new URL(raw);}catch{}
    if(!url||url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password||
        url.pathname!=='/'||url.search||!/^#token=[a-f0-9]{64}$/.test(url.hash))
      throw fail('BASEROW_MCP_CONNECTION_INVALID','Use the original complete private source workspace URL.');
    const signature=sha(url.href),prior=this.#sessions.get(workspace);
    if(prior?.signature===signature)return prior.promise;
    const connection={origin:url.origin,token:url.hash.slice(7)};
    const promise=(async()=>{
      const status=await this.#json(connection,'/api/status?limit=1');
      if(status.schema!=='stellar-forge.baserow-authoring.v1'||status.directory!==definition.directory)
        throw fail('BASEROW_MCP_WORKSPACE_CHANGED','The selected console belongs to a different original workspace.');
      return connection;
    })();
    this.#sessions.set(workspace,{signature,promise});
    promise.catch(()=>{if(this.#sessions.get(workspace)?.promise===promise)this.#sessions.delete(workspace);});
    return promise;
  }
  async #input(definition,file) {
    const item=definition.files[checked(file,ALIAS,'source packet alias')];
    if(!item)throw fail('BASEROW_MCP_INPUT_NOT_CONFIGURED');
    const {handle,info}=await sourceHandle(item.path);
    try{
      const result=await fingerprint(handle,info);
      if(item.sha256&&item.sha256!==result.sha256)throw fail('BASEROW_MCP_INPUT_CHANGED');
      return {file,label:item.label,...result};
    }finally{await handle.close();}
  }
  async #import(connection,file,{expectedSha256,title,expectedDraftRevision,requestId}) {
    checked(expectedSha256,HASH,'original packet SHA256');checked(requestId,UUID,'request UUID');
    line(title,'source title',128);
    if(!Number.isSafeInteger(expectedDraftRevision)||expectedDraftRevision<0)throw fail('BASEROW_MCP_INVALID_PARAMS');
    const before=Buffer.from('{"packet":'),after=Buffer.from(','+JSON.stringify({title,expectedDraftRevision,requestId}).slice(1));
    const {handle,bytes}=await snapshotInput(file,expectedSha256,BASEROW_EXPORT_MAX_BYTES-before.length-after.length);
    let stream;
    try {
      stream=handle.createReadStream({autoClose:false,start:0});
      async function* original(){yield before;for await(const chunk of stream)yield chunk;yield after;}
      const response=await this.#request(connection,'/api/import-package',{body:original(),headers:{
        'content-type':'application/json','content-length':String(bytes+before.length+after.length)}});
      return JSON.parse(decode(await responseBytes(response)));
    }finally{stream?.destroy();await handle.close();}
  }
  async #export(workspace,connection,exportId,input) {
    const selection=baserowExportSelection(input);
    const query=(path,values)=>path+'?'+new URLSearchParams(Object.entries(values).map(([key,value])=>[key,String(value)]));
    const inspect=async()=>{
      const source={expectedFiles:{}};
      if(['capture','attachment'].includes(selection.kind)) {
        const native=await this.#json(connection,query('/api/capture',{id:selection.captureId}));
        if(native.capture?.manifestSha256!==selection.expectedCaptureSha256)throw fail('BASEROW_MCP_CAPTURE_CHANGED');
        Object.assign(source,{captureId:native.capture.id,captureSha256:native.capture.manifestSha256,
          rows:native.capture.rowCount,attachmentCount:native.attachments.count,attachmentBytes:native.attachments.bytes});
        if(selection.kind==='attachment') {
          const file=native.manifest.attachments.find(item=>item.file===selection.file);
          if(!file||file.sha256!==selection.expectedFileSha256)throw fail('BASEROW_MCP_ATTACHMENT_CHANGED');
          source.expectedFiles[selection.file]={bytes:file.bytes,sha256:file.sha256};
        }
      }
      if(['version','handoff'].includes(selection.kind)) {
        const native=await this.#json(connection,query('/api/version',{id:selection.versionId}));
        if(native.sourceSha256!==selection.expectedSourceSha256||native.observationSha256!==selection.expectedCaptureSha256)
          throw fail('BASEROW_MCP_VERSION_CHANGED');
        Object.assign(source,{versionId:native.id,captureId:native.captureId,captureSha256:native.observationSha256,
          sourceSha256:native.sourceSha256,rows:native.rowCount,queries:native.queries});
      }
      if(['deployment','handoff'].includes(selection.kind)) {
        const native=await this.#json(connection,query('/api/deployment/package',{id:selection.packageRequestId}));
        if(native.sourceSha256!==selection.expectedPackageSha256)throw fail('BASEROW_MCP_PACKAGE_CHANGED');
        for(const name of BASEROW_DEPLOYMENT_NAMES) {
          const file=native.files.find(item=>item.file===name);
          if(!file||!Number.isSafeInteger(file.bytes)||!HASH.test(file.sha256??''))throw fail('BASEROW_MCP_PACKAGE_CHANGED');
          source.expectedFiles[name]={bytes:file.bytes,sha256:file.sha256};
        }
        if(selection.kind==='handoff') {
          const provenance=await this.#json(connection,query('/api/deployment/file',{packageId:selection.packageRequestId,file:'source.json'}));
          if(provenance.sourcePlan?.sourceSha256!==selection.expectedSourceSha256||
              provenance.sourcePlan?.observationSha256!==selection.expectedCaptureSha256)throw fail('BASEROW_MCP_HANDOFF_SOURCE_CHANGED');
        }
        Object.assign(source,{packageRequestId:selection.packageRequestId,packageSourceSha256:native.sourceSha256,
          candidateDigest:native.candidateDigest,runId:native.runId,dataset:native.dataset});
      }
      return source;
    };
    const fetchFile=name=>{
      if(name==='baserow-source.json')return this.#request(connection,selection.kind==='capture'
        ?query('/api/export-capture',{id:selection.captureId}):query('/api/export',{id:selection.versionId}));
      if(selection.kind==='attachment')return this.#request(connection,query('/api/capture-file',{id:selection.captureId,file:name,
        manifestSha256:selection.expectedCaptureSha256,sha256:selection.expectedFileSha256}));
      return this.#request(connection,query('/api/deployment/file',{packageId:selection.packageRequestId,file:name}));
    };
    return this.#exports.retain({workspace,exportId,selection,inspect,fetchFile});
  }
  async #execute(name,args) {
    if(name==='merchant_baserow_workspaces')return this.summary;
    if(name==='merchant_baserow_export_manifest')return this.#exports.manifest(args.exportId);
    if(name==='merchant_baserow_export_file')return this.#exports.file(args);
    if(name==='merchant_baserow_export_file_release')return this.#exports.release(args);
    const {workspace,...input}=args,definition=this.#definition(workspace);
    if(name==='merchant_baserow_exports')return this.#exports.list({workspace,...input});
    if(name==='merchant_baserow_input')return {workspace,...await this.#input(definition,input.file)};
    if(name==='merchant_baserow_export') {
      const selection=baserowExportSelection(input.selection);
      try {
        const existing=await this.#exports.manifest(input.exportId);
        if(existing.workspace!==workspace||identity(existing.manifest.selection)!==identity(selection))
          throw fail('BASEROW_FILE_EXPORT_CONFLICT');
        return existing;
      } catch(issue){if(issue.code!=='ENOENT')throw issue;}
    }
    const connection=await this.#connection(workspace);
    const get=(path,query={})=>this.#json(connection,path+(Object.keys(query).length?'?'+new URLSearchParams(Object.entries(query).map(([k,v])=>[k,String(v)])):'')); 
    const post=(path,body)=>this.#json(connection,path,body),result=native=>({workspace,native:safeView(native,name,input)});
    switch(name) {
      case 'merchant_baserow_status':return result(await get('/api/status',input));
      case 'merchant_baserow_discover':return result(await post('/api/discover',input.input));
      case 'merchant_baserow_discovery':return result(await get('/api/discovery',{id:checked(input.id,UUID,'discovery UUID')}));
      case 'merchant_baserow_capture':return result(await post('/api/capture',input.input));
      case 'merchant_baserow_capture_read': {
        checked(input.id,UUID,'capture UUID');
        const routes={schema:'/api/capture',rows:'/api/capture-rows',files:'/api/capture-files',attempt:'/api/capture-attempt'};
        if(!Object.hasOwn(routes,input.kind))throw fail('BASEROW_MCP_INVALID_PARAMS');
        if(input.kind!=='attempt')checked(input.expectedCaptureSha256,HASH,'original capture SHA256');
        const value=await get(routes[input.kind],{id:input.id,...(['rows','files'].includes(input.kind)
          ?{offset:input.offset??0,limit:input.limit??25}:{})});
        if(input.kind!=='attempt'&&(value.manifestSha256??value.capture?.manifestSha256)!==input.expectedCaptureSha256)
          throw fail('BASEROW_MCP_CAPTURE_CHANGED');
        return result(value);
      }
      case 'merchant_baserow_draft':return result(await post('/api/draft',input));
      case 'merchant_baserow_preview':return result(await post('/api/preview',input));
      case 'merchant_baserow_version':
        if(input.action==='read') {
          if(input.input!==undefined||!Number.isSafeInteger(input.id)||input.id<1)throw fail('BASEROW_MCP_INVALID_PARAMS');
          return result(await get('/api/version',{id:input.id}));
        }
        if(!['save','select'].includes(input.action)||input.id!==undefined||!plain(input.input))throw fail('BASEROW_MCP_INVALID_PARAMS');
        return result(await post(input.action==='save'?'/api/version':'/api/select',input.input));
      case 'merchant_baserow_compare':return result(await get('/api/compare',input));
      case 'merchant_baserow_operation': {
        checked(input.requestId,UUID,'source request UUID');
        if(input.resume!==undefined&&typeof input.resume!=='boolean')throw fail('BASEROW_MCP_INVALID_PARAMS');
        const original=await get('/api/operation',{id:input.requestId});
        if(!input.resume)return result(original);
        const resumed=await post('/api/resume',{requestId:input.requestId});
        return {workspace,native:operationResult(original?.kind,resumed)};
      }
      case 'merchant_baserow_publisher': {
        if(!publisherActions.includes(input.action)||input.input!==undefined&&!plain(input.input))throw fail('BASEROW_MCP_INVALID_PARAMS');
        if(input.action==='open'||input.action==='close') {
          if(input.input!==undefined)throw fail('BASEROW_MCP_INVALID_PARAMS');
          checked(input.requestId,UUID,'source request UUID');
          return result(await post('/api/publisher/'+(input.action==='open'?'start':'stop'),input.action==='open'
            ?{expectedSelectedVersion:input.expectedSelectedVersion,requestId:input.requestId}:{requestId:input.requestId}));
        }
        if(BASEROW_PUBLISHER_READ_ACTIONS.includes(input.action)) {
          if(input.requestId!==undefined||input.expectedSelectedVersion!==undefined)throw fail('BASEROW_MCP_INVALID_PARAMS');
          return result(await post('/api/publisher/state',{action:input.action,input:input.input??{}}));
        }
        checked(input.requestId,UUID,'source request UUID');
        return result(await post('/api/publisher/command',{action:input.action,input:input.input??{},
          expectedSelectedVersion:input.expectedSelectedVersion,requestId:input.requestId}));
      }
      case 'merchant_baserow_deployment': {
        if(!deploymentActions.includes(input.action)||!plain(input.input??{}))throw fail('BASEROW_MCP_INVALID_PARAMS');
        const payload=structuredClone(input.input??{});
        if(input.action==='status')return result(await get('/api/deployment/status',payload));
        if(input.action==='package')return result(await get('/api/deployment/package',payload));
        if(input.action==='compare')return result(await get('/api/deployment/compare',payload));
        if(input.action==='review') {
          const profile=definition.terms[checked(payload.termsProfile,ALIAS,'merchant terms profile')];
          if(!profile||Object.hasOwn(payload,'terms'))throw fail('BASEROW_MCP_TERMS_PROFILE_REQUIRED');
          delete payload.termsProfile;payload.terms=structuredClone(profile);
        }
        if(input.action==='stage') {
          const profile=definition.runtimes[checked(payload.runtimeProfile,ALIAS,'runtime profile')];
          if(!profile||Object.hasOwn(payload,'runtime'))throw fail('BASEROW_MCP_RUNTIME_PROFILE_REQUIRED');
          delete payload.runtimeProfile;payload.runtime=structuredClone(profile);
        }
        const route={review:'review',prepare:'prepare',stage:'stage',open:'console/open',close:'console/close',command:'command'}[input.action];
        return result(await post('/api/deployment/'+route,payload));
      }
      case 'merchant_baserow_import': {
        if((input.file===undefined)===(input.exportId===undefined))throw fail('BASEROW_MCP_INPUT_REQUIRED');
        let file;
        if(input.file!==undefined) {
          file=definition.files[checked(input.file,ALIAS,'source packet alias')];
          if(!file)throw fail('BASEROW_MCP_INPUT_NOT_CONFIGURED');
        }else file=await this.#exports.sourcePacket(input.exportId);
        return result(await this.#import(connection,file,input));
      }
      case 'merchant_baserow_export':return this.#export(workspace,connection,input.exportId,input.selection);
      default:throw fail('TOOL_NOT_FOUND','Unknown original Baserow operation.');
    }
  }
  async call(name,args={}) {
    if(this.#closing)throw fail('BASEROW_MCP_CLOSING');
    const tool=definitions.get(name);if(!tool)throw fail('TOOL_NOT_FOUND');
    exact(args,Object.keys(tool.properties),tool.required);
    const pending=Promise.resolve().then(()=>this.#execute(name,args));this.#pending.add(pending);
    try{return await pending;}finally{this.#pending.delete(pending);}
  }
  close() {
    if(!this.#close){this.#closing=true;this.#close=(async()=>{
      await Promise.allSettled([...this.#pending]);await this.#exports.close();this.#sessions.clear();
    })();}return this.#close;
  }
}

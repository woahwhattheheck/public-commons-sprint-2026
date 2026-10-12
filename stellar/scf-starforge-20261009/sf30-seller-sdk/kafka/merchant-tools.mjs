// MIT. Complete merchant access to the original Kafka/NDJSON HTTP owner.
import { constants } from 'node:fs';
import { open, mkdir, lstat, realpath, readdir, link, unlink } from 'node:fs/promises';
import { resolve, join, dirname, basename } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import {
  KafkaWorkspaceClient, inspectKafkaDownload, readKafkaWorkspaceConnection,
  readKafkaHostFile, parseKafkaJson, stringifyKafkaJson, KAFKA_LIMITS
} from './client.mjs';
import { exact, plain, failure, identifier, operationName, integer } from './client-protocol.mjs';
import { kafkaWorkspaceTools } from './merchant-catalog.mjs';
import { RetainedFileReads } from '../../../../stellar-forge/mcp-merchant-operator/retained-file-reads.mjs';
import { acquireStateLease } from '../../merchant-fleet-gateway/state-lease.mjs';
export { kafkaWorkspaceTools } from './merchant-catalog.mjs';

export const KAFKA_MERCHANT_CONFIGURATION='stellar-forge.kafka-merchant-connection.v1';
export const KAFKA_EXPORT_SELECTION='stellar-forge.kafka-merchant-export-selection.v1';
export const KAFKA_EXPORT_MANIFEST='stellar-forge.kafka-merchant-export.v1';
const ALIAS=/^[a-z0-9][a-z0-9_-]{0,63}$/;
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const SHA=/^[a-f0-9]{64}$/;
const RESPONSE_BYTES=131072;
const digest=value=>createHash('sha256').update(value).digest('hex');
const decode=bytes=>new TextDecoder('utf-8',{fatal:true}).decode(bytes);
const canonical=value=>JSON.stringify(value,(_key,item)=>plain(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])) : item);
const copy=value=>JSON.parse(canonical(value));
function alias(value) {
  if(typeof value!=='string'||!ALIAS.test(value))
    throw failure('KAFKA_INVALID_PARAMS','Select an original host-declared alias.');
  return value;
}
function text(value,label,maximum=240) {
  if(typeof value!=='string'||!value.trim()||value!==value.trim()||value.length>maximum||/[\x00-\x1f\x7f]/.test(value))
    throw failure('KAFKA_INVALID_PARAMS',label+' must be nonempty printable text within its declared limit.');
  return value;
}
function hostFile(value,base) {
  if(typeof value!=='string'||!value||value.includes('\0'))
    throw failure('KAFKA_CONFIGURATION_INVALID','Select a complete host file path.');
  return resolve(base,value);
}
function sourceMaximum(kind) {
  if(kind==='kafka-project')return KAFKA_LIMITS.kafkaPacketBytes;
  if(kind==='ndjson-project')return KAFKA_LIMITS.nativePacketBytes;
  if(kind==='ndjson')return KAFKA_LIMITS.sourceBytes;
  throw failure('KAFKA_CONFIGURATION_INVALID','An input kind must be kafka-project, ndjson-project or ndjson.');
}
/** Only host configuration names local paths; MCP arguments choose declared aliases. */
export async function readKafkaWorkspaceConfiguration(filename) {
  const path=resolve(filename),base=dirname(path);
  const value=parseKafkaJson(decode(await readKafkaHostFile(path,131072,{privateFile:true})));
  exact(value,['schema','workspaces']);
  if(value.schema!==KAFKA_MERCHANT_CONFIGURATION||!plain(value.workspaces)||
      Object.keys(value.workspaces).length<1||Object.keys(value.workspaces).length>32)
    throw failure('KAFKA_CONFIGURATION_INVALID','Declare 1–32 original Kafka workspaces.');
  const workspaces=Object.create(null);
  for(const [name,entry] of Object.entries(value.workspaces)) {
    alias(name);exact(entry,['label','connectionFile'],['expectedWorkspaceId','expectedBindingSha256','inputs']);
    text(entry.label,'Workspace label');
    const definition={label:entry.label,connectionFile:hostFile(entry.connectionFile,base)};
    if(entry.expectedWorkspaceId!==undefined) {
      if(typeof entry.expectedWorkspaceId!=='string'||!UUID.test(entry.expectedWorkspaceId))
        throw failure('KAFKA_CONFIGURATION_INVALID','Use the original workspace UUID.');
      definition.expectedWorkspaceId=entry.expectedWorkspaceId;
    }
    if(entry.expectedBindingSha256!==undefined)definition.expectedBindingSha256=identifier(entry.expectedBindingSha256,'Original source binding');
    // This reads the private original URL/Applications record, without starting a server.
    await readKafkaWorkspaceConnection(definition.connectionFile);
    const inputs=entry.inputs??{};
    if(!plain(inputs)||Object.keys(inputs).length>64)
      throw failure('KAFKA_CONFIGURATION_INVALID','Declare at most 64 original input files per workspace.');
    definition.inputs=Object.create(null);
    for(const [input,selected] of Object.entries(inputs)) {
      alias(input);exact(selected,['path','kind','sha256']);
      const maximum=sourceMaximum(selected.kind),inputPath=hostFile(selected.path,base);
      identifier(selected.sha256,'Original input SHA-256');
      const info=await lstat(inputPath);
      if(!info.isFile()||info.isSymbolicLink()||info.size>maximum)
        throw failure('KAFKA_CONFIGURATION_INVALID','Choose an existing complete regular input within its native size limit.');
      definition.inputs[input]=Object.freeze({path:inputPath,kind:selected.kind,sha256:selected.sha256});
    }
    Object.freeze(definition.inputs);workspaces[name]=Object.freeze(definition);
  }
  return Object.freeze({schema:value.schema,workspaces:Object.freeze(workspaces)});
}
async function privateDirectory(path,create=false) {
  if(create) {
    try {
      await mkdir(path,{mode:0o700});
      const parent=await open(dirname(path),constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
      try{await parent.sync();}finally{await parent.close();}
    } catch(error){if(error.code!=='EEXIST')throw error;}
  }
  const info=await lstat(path);
  if(!info.isDirectory()||info.isSymbolicLink()||await realpath(path)!==path||
      process.platform!=='win32'&&((info.mode&0o077)!==0||typeof process.getuid==='function'&&info.uid!==process.getuid()))
    throw failure('KAFKA_EXPORT_DIRECTORY','Keep exports in the original private, owned canonical directory.');
  return path;
}
async function ownedBytes(path,maximum) {
  const before=await lstat(path);
  if(!before.isFile()||before.isSymbolicLink()||process.platform!=='win32'&&
      ((before.mode&0o077)!==0||typeof process.getuid==='function'&&before.uid!==process.getuid()))
    throw failure('KAFKA_EXPORT_CONFLICT','Retained metadata must remain a private, owned regular file.');
  // A crash after link() can retain the private temporary hard link. The exact
  // final inode and bytes remain valid; never require deletion to recover them.
  const bytes=await readKafkaHostFile(path,maximum);
  const after=await lstat(path);
  if(before.dev!==after.dev||before.ino!==after.ino||before.mode!==after.mode||before.uid!==after.uid)
    throw failure('KAFKA_EXPORT_CONFLICT','The original retained metadata changed during its read.');
  return bytes;
}
async function jsonFile(path) {
  return parseKafkaJson(decode(await ownedBytes(path,2*1048576)));
}
async function optionalJson(path) {
  try{return await jsonFile(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}
}
/** Link only a complete synced file; never replace a retained selection or manifest. */
async function immutableFile(path,bytes) {
  const temporary=join(dirname(path),'.kafka-record-'+randomUUID()+'.pending');
  let handle,owned,linked=false;
  try {
    handle=await open(temporary,'wx',0o600);owned=await handle.stat();
    await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;
    try{await link(temporary,path);linked=true;}
    catch(error) {
      if(error.code!=='EEXIST')throw error;
      const existing=await ownedBytes(path,Math.max(bytes.length,1));
      if(!existing.equals(bytes))throw failure('KAFKA_EXPORT_CONFLICT','The original retained file has different complete bytes.');
    }
    const directory=await open(dirname(path),constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
    try{await directory.sync();}finally{await directory.close();}
  } finally {
    if(handle)await handle.close();
    if(owned) {
      try{const now=await lstat(temporary);if(now.dev===owned.dev&&now.ino===owned.ino)await unlink(temporary);}
      catch(error){if(error.code!=='ENOENT')throw error;}
    }
  }
  return linked;
}
const jsonBytes=value=>Buffer.from(canonical(value)+'\n');
const definitions=new Map(kafkaWorkspaceTools((name,_description,properties,required)=>({name,properties,required}))
  .map(value=>[value.name,value]));
const recordKinds=new Set(['connection','inspection','capture','projection','source','plan']);
function selectedExport(kind,input) {
  if(!plain(input))throw failure('KAFKA_INVALID_PARAMS','Supply the exact native export selection.');
  switch(kind) {
    case 'kafka-project':
      exact(input,['build'],['projection']);identifier(input.build,'Build');
      if(input.projection!==undefined)identifier(input.projection,'Projection');break;
    case 'ndjson-project':case 'dataset':
      exact(input,['build']);identifier(input.build,'Build');break;
    case 'changes':case 'message':case 'projection':
      exact(input,['id']);identifier(input.id);break;
    case 'state':exact(input,[]);break;
    case 'record':
      exact(input,['kind','id']);
      if(!recordKinds.has(input.kind)||input.kind==='projection')
        throw failure('KAFKA_INVALID_PARAMS','Choose connection, inspection, capture, source or plan for a record export.');
      if(input.kind==='connection')operationName(input.id,'Connection');else identifier(input.id);
      break;
    case 'query':
      exact(input,['build','query']);identifier(input.build,'Build');
      if(!plain(input.query)||Object.values(input.query).some(item=>typeof item!=='string'))
        throw failure('KAFKA_INVALID_PARAMS','Use original scalar-string query parameters.');
      break;
    case 'merchant':
      exact(input,['build','payment','origin','path']);identifier(input.build,'Build');
      if(!plain(input.payment))throw failure('KAFKA_INVALID_PARAMS','Supply the original merchant payment terms.');
      text(input.origin,'Public origin',2048);text(input.path,'Merchant route',2048);break;
    default:throw failure('KAFKA_INVALID_PARAMS','Choose a declared complete native export kind.');
  }
  if(Buffer.byteLength(stringifyKafkaJson(input))>KAFKA_LIMITS.datasetRequestBytes)
    throw failure('KAFKA_INVALID_PARAMS','The original file selection exceeds 128 KiB.');
  return copy(input);
}
function fileType(kind) {
  if(['kafka-project','ndjson-project','dataset','merchant'].includes(kind))
    return {name:'original.zip',contentType:'application/zip'};
  if(kind==='changes')return {name:'changes.ndjson',contentType:'application/x-ndjson'};
  return {name:'original.json',contentType:'application/json'};
}
function sameBinding(left,right) {
  return left&&right&&['workspace','workspaceId','bindingSha256'].every(key=>left[key]===right[key]);
}
function selectionIdentity(workspace,operation) {
  return digest(canonical({schema:KAFKA_EXPORT_SELECTION,workspace,operation}));
}
export class MerchantKafkaWorkspaces {
  #config;#options;#clients=new Map();#pending=new Set();#closing=false;#close;
  #reads;#readsClose;#exporting=new Map();#controller=new AbortController();
  constructor(config,options={}) {
    exact(options,[],['timeoutMs','maximumJsonBytes','concurrency']);
    this.#config=config;this.#options={...options};
    this.#reads=new RetainedFileReads({errorPrefix:'KAFKA'});
  }
  get summary() {
    return {configured:Boolean(this.#config.kafkaWorkspaces),ownership:'ORIGINAL_KAFKA_HTTP_WORKSPACE',
      closing:this.#closing,activeOperations:this.#pending.size,...this.#reads.summary,
      workspaces:Object.entries(this.#config.kafkaWorkspaces?.workspaces??{}).map(([workspace,item])=>({
        workspace,label:item.label,
        expectedWorkspaceId:item.expectedWorkspaceId??null,expectedBindingSha256:item.expectedBindingSha256??null,
        inputs:Object.entries(item.inputs).map(([input,file])=>({input,kind:file.kind,sha256:file.sha256}))
      }))};
  }
  #definition(workspace) {
    alias(workspace);
    const value=this.#config.kafkaWorkspaces?.workspaces[workspace];
    if(!value)throw failure('KAFKA_WORKSPACE_NOT_CONFIGURED','Choose an original workspace from merchant_kafka_workspaces.');
    return value;
  }
  #client(workspace) {
    const value=this.#definition(workspace);
    if(!this.#clients.has(workspace)) {
      const definition={connectionFile:value.connectionFile};
      for(const key of ['expectedWorkspaceId','expectedBindingSha256'])
        if(value[key]!==undefined)definition[key]=value[key];
      this.#clients.set(workspace,new KafkaWorkspaceClient(definition,this.#options));
    }
    return this.#clients.get(workspace);
  }
  #admitted() {
    if(this.#closing)throw failure('KAFKA_MERCHANT_CLOSING','This original merchant client is closing.');
  }
  async #workspaceExports(workspace,create=false) {
    this.#definition(workspace);
    const root=resolve(this.#config.exportsDirectory);
    await privateDirectory(root);
    const kafka=await privateDirectory(join(root,'kafka-workspaces'),create);
    return privateDirectory(join(kafka,digest(workspace)),create);
  }
  async #artifactDirectory(workspace,artifact,create=false) {
    identifier(artifact,'Artifact');
    return privateDirectory(join(await this.#workspaceExports(workspace,create),artifact),create);
  }
  #selection(value,workspace,artifact) {
    exact(value,['schema','artifact','workspace','operation','binding','kind','input']);
    if(value.schema!==KAFKA_EXPORT_SELECTION||value.workspace!==workspace||value.artifact!==artifact||
        selectionIdentity(workspace,operationName(value.operation))!==artifact||!plain(value.binding)||
        typeof value.binding.workspace!=='string'||!UUID.test(value.binding.workspaceId)||
        !SHA.test(value.binding.bindingSha256))
      throw failure('KAFKA_EXPORT_CONFLICT','This retained selection belongs to another original workspace or operation.');
    return value;
  }
  #manifest(value,selection) {
    exact(value,['schema','artifact','workspace','operation','workspaceId','bindingSha256','kind','selectionSha256','createdAt','file']);
    const expected=fileType(selection.kind);
    if(value.schema!==KAFKA_EXPORT_MANIFEST||value.artifact!==selection.artifact||value.workspace!==selection.workspace||
        value.operation!==selection.operation||value.workspaceId!==selection.binding.workspaceId||
        value.bindingSha256!==selection.binding.bindingSha256||value.kind!==selection.kind||
        value.selectionSha256!==digest(jsonBytes(selection))||typeof value.createdAt!=='string'||
        !Number.isFinite(Date.parse(value.createdAt)))
      throw failure('KAFKA_EXPORT_CONFLICT','The original export manifest no longer matches its retained selection.');
    exact(value.file,['name','contentType','bytes','sha256']);
    if(value.file.name!==expected.name||value.file.contentType!==expected.contentType||
        !Number.isSafeInteger(value.file.bytes)||value.file.bytes<0||value.file.bytes>KAFKA_LIMITS.downloadBytes||
        !SHA.test(value.file.sha256))
      throw failure('KAFKA_EXPORT_CONFLICT','Use the complete original export file and metadata.');
    return value;
  }
  async #retained(workspace,artifact) {
    const directory=await this.#artifactDirectory(workspace,artifact);
    const selection=this.#selection(await jsonFile(join(directory,'selection.json')),workspace,artifact);
    let bytes;
    try{bytes=await ownedBytes(join(directory,'manifest.json'),2*1048576);}
    catch(error){if(error.code!=='ENOENT')throw error;throw failure('KAFKA_EXPORT_INCOMPLETE','Resume the original export operation to finish its retained file and manifest.');}
    const value=parseKafkaJson(decode(bytes));
    return {directory,selection,manifest:this.#manifest(value,selection),manifestBytes:bytes};
  }
  async #retain(workspace,operation,kind,input,produce) {
    operationName(operation);
    const artifact=selectionIdentity(workspace,operation),client=this.#client(workspace);
    const selected={kind,input:copy(input)};
    const key=workspace+'/'+artifact;
    const prior=this.#exporting.get(key);
    if(prior) {
      if(prior.selection!==canonical(selected))throw failure('KAFKA_EXPORT_CONFLICT','This export operation is already receiving another selection.');
      return prior.pending;
    }
    const pending=(async()=>{
      this.#admitted();
      await client.inspect();
      const selection={schema:KAFKA_EXPORT_SELECTION,artifact,workspace,operation,binding:client.binding,...selected};
      const directory=await this.#artifactDirectory(workspace,artifact,true);
      let lease;
      try {lease=await acquireStateLease(directory);}
      catch(error) {
        throw failure('KAFKA_EXPORT_OWNED',error.message==='FLEET_STATE_ALREADY_OWNED'
          ? 'Another original merchant process is receiving this same export. Reopen this operation after it finishes.'
          : 'The original retained export requires its Linux flock lease.');
      }
      try {
        this.#admitted();lease.assertHeld();
        const saved=await optionalJson(join(directory,'selection.json'));
        if(saved) {
          this.#selection(saved,workspace,artifact);
          if(canonical(saved)!==canonical(selection))
            throw failure('KAFKA_EXPORT_CONFLICT','Reuse this operation only with its original workspace, source binding and full selection.');
        } else await immutableFile(join(directory,'selection.json'),jsonBytes(selection));
        const file=fileType(kind),destination=join(directory,file.name);
        const manifest=await optionalJson(join(directory,'manifest.json'));
        if(manifest) {
          this.#manifest(manifest,selection);
          await inspectKafkaDownload(destination,{sha256:manifest.file.sha256,signal:this.#controller.signal});
          return {recovered:true,...manifest};
        }
        let received;
        try {received=await inspectKafkaDownload(destination,{signal:this.#controller.signal});}
        catch(error) {if(error.code!=='ENOENT')throw error;}
        if(!received) {
          this.#admitted();lease.assertHeld();
          try {received=await produce(client,destination);}
          catch(error) {
            if(!error.retainedFile)throw error;
            received=await inspectKafkaDownload(destination,{sha256:error.retainedFile.sha256,signal:this.#controller.signal});
          }
          if(received.workspaceId!==undefined&&received.workspaceId!==selection.binding.workspaceId||
              received.bindingSha256!==undefined&&received.bindingSha256!==selection.binding.bindingSha256||
              !sameBinding(client.binding,selection.binding))
            throw failure('KAFKA_BINDING_CHANGED','The original workspace binding changed during the selected complete export.');
        }
        lease.assertHeld();
        const completed={schema:KAFKA_EXPORT_MANIFEST,artifact,workspace,operation,
          workspaceId:selection.binding.workspaceId,bindingSha256:selection.binding.bindingSha256,
          kind,selectionSha256:digest(jsonBytes(selection)),createdAt:new Date().toISOString(),
          file:{...file,bytes:received.bytes,sha256:received.sha256}};
        this.#manifest(completed,selection);
        await immutableFile(join(directory,'manifest.json'),jsonBytes(completed));
        return {recovered:Boolean(saved),...completed};
      } finally {await lease.close();}
    })();
    this.#exporting.set(key,{selection:canonical(selected),pending});
    try{return await pending;}finally{this.#exporting.delete(key);}
  }
  #export(workspace,operation,kind,input) {
    input=selectedExport(kind,input);
    return this.#retain(workspace,operation,kind,input,async(client,destination)=>{
      switch(kind) {
        case 'kafka-project':return client.exportKafka(input,destination);
        case 'ndjson-project':return client.exportNative(input.build,destination);
        case 'dataset':return client.exportDataset(input.build,destination);
        case 'changes':return client.exportChanges(input.id,destination);
        case 'merchant':return client.exportMerchant(input,destination);
        case 'message':return client.downloadMessage(input.id,destination);
        case 'state':return client.downloadState(destination);
        case 'projection':return client.downloadProjection(input.id,destination);
        case 'record':return client.downloadRecord(input.kind,input.id,destination);
        case 'query':return client.downloadQuery(input,destination);
      }
    });
  }
  async #result(workspace,name,input,value) {
    const serialized=stringifyKafkaJson(value);
    if(Buffer.byteLength(serialized)<=RESPONSE_BYTES)return {workspace,native:value};
    const bytes=Buffer.from(serialized+'\n'),sha256=digest(bytes);
    const artifact=await this.#retain(workspace,'response.'+sha256,'response',
      {tool:name,input:copy(input),responseSha256:sha256},async(_client,destination)=>{
        await immutableFile(destination,bytes);
        return inspectKafkaDownload(destination,{sha256,signal:this.#controller.signal});
      });
    return {workspace,response:{complete:true,encoding:'retained-native-json',...artifact}};
  }
  async #exports(workspace,{offset=0,limit=50}) {
    integer(offset,0,1000000000,'Page offset');integer(limit,1,200,'Page size');
    let directory;
    try{directory=await this.#workspaceExports(workspace);}
    catch(error){if(error.code==='ENOENT')return {workspace,total:0,offset,items:[],nextOffset:null};throw error;}
    const names=(await readdir(directory,{withFileTypes:true})).filter(item=>item.isDirectory()&&SHA.test(item.name))
      .map(item=>item.name).sort();
    const items=[];
    for(const artifact of names.slice(offset,offset+limit)) {
      const folder=await this.#artifactDirectory(workspace,artifact);
      const raw=await optionalJson(join(folder,'selection.json'));
      if(!raw){items.push({artifact,state:'SELECTING'});continue;}
      const selection=this.#selection(raw,workspace,artifact),manifest=await optionalJson(join(folder,'manifest.json'));
      items.push(manifest?{state:'COMPLETE',...this.#manifest(manifest,selection)}:{
        artifact,state:'RECEIVING',operation:selection.operation,kind:selection.kind,input:selection.input,
        workspaceId:selection.binding.workspaceId,bindingSha256:selection.binding.bindingSha256
      });
    }
    const next=offset+items.length;
    return {workspace,total:names.length,offset,items,nextOffset:next<names.length?next:null};
  }
  async #readFile(workspace,input) {
    const {directory,manifest}=await this.#retained(workspace,input.artifact);
    if(input.expectedSha256!==manifest.file.sha256)
      throw failure('KAFKA_EXPORT_CONFLICT','Select the original completed file SHA-256.');
    return {workspace,artifact:input.artifact,...await this.#reads.read({
      scope:workspace,key:input.artifact,kind:manifest.kind,directory,
      expectedSha256:input.expectedSha256,readId:input.readId,offset:input.offset,limit:input.limit,
      load:async()=>{
        let handle;
        try {
          handle=await open(join(directory,manifest.file.name),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
          const info=await handle.stat({bigint:true});
          if(!info.isFile()||info.size!==BigInt(manifest.file.bytes)||
              process.platform!=='win32'&&((info.mode&0o077n)!==0n||
                typeof process.getuid==='function'&&info.uid!==BigInt(process.getuid())))
            throw failure('KAFKA_EXPORT_CONFLICT','The original complete file must remain private and unchanged.');
          const result={readonlyFileHandle:handle,bytes:manifest.file.bytes,sha256:manifest.file.sha256,
            name:manifest.file.name,type:manifest.file.contentType};
          handle=null;return result;
        } finally {if(handle)await handle.close();}
      }
    })};
  }
  async #execute(name,args) {
    if(name==='merchant_kafka_workspaces')return this.summary;
    const {workspace,...input}=args;this.#definition(workspace);
    if(name==='merchant_kafka_exports')return this.#exports(workspace,input);
    if(name==='merchant_kafka_manifest') {
      if(input.includeFile!==undefined&&typeof input.includeFile!=='boolean')
        throw failure('KAFKA_INVALID_PARAMS','includeFile must be boolean.');
      const retained=await this.#retained(workspace,input.artifact);
      if(!input.includeFile)return retained.manifest;
      const bytes=retained.manifestBytes;
      return {...retained.manifest,manifestFile:{name:'manifest.json',bytes:bytes.length,
        sha256:digest(bytes),encoding:'base64',data:bytes.toString('base64')}};
    }
    if(name==='merchant_kafka_file_read')return this.#readFile(workspace,input);
    if(name==='merchant_kafka_file_release') {
      if(typeof input.readId!=='string'||!UUID.test(input.readId))
        throw failure('KAFKA_INVALID_PARAMS','Use the original retained read UUID.');
      await this.#reads.release(workspace,input.readId);
      return {workspace,readId:input.readId,state:'RELEASED'};
    }
    if(name==='merchant_kafka_export')return this.#export(workspace,input.operation,input.kind,input.selection);
    if(name==='merchant_kafka_message')return this.#export(workspace,input.operation??'message.'+input.id,'message',{id:input.id});
    const client=this.#client(workspace);
    let value;
    switch(name) {
      case 'merchant_kafka_inspect':{
        const status=await client.inspect();
        return {workspace,status:status.status,workspaceId:status.workspaceId,bindingSha256:status.bindingSha256,
          origin:status.origin,pid:status.pid,application:status.application??null};
      }
      case 'merchant_kafka_state':value=await client.state();break;
      case 'merchant_kafka_configured_topics':value=await client.configuredTopics();break;
      case 'merchant_kafka_read':
        if(!recordKinds.has(input.kind))throw failure('KAFKA_INVALID_PARAMS','Choose a declared original record kind.');
        value=await client[input.kind](input.id);break;
      case 'merchant_kafka_save_connection':value=await client.saveConnection(input);break;
      case 'merchant_kafka_inspect_connection':value=await client.inspectConnection(input);break;
      case 'merchant_kafka_prepare_capture':value=await client.prepareCapture(input);break;
      case 'merchant_kafka_run_capture':value=await client.runCapture(input);break;
      case 'merchant_kafka_resume_capture':value=await client.resumeCapture(input);break;
      case 'merchant_kafka_cancel_capture':value=await client.cancelCapture(input.capture);break;
      case 'merchant_kafka_wait_capture':{
        const {capture,...options}=input;value=await client.waitForCapture(capture,options);break;
      }
      case 'merchant_kafka_messages':{
        const {capture,...pagination}=input;value=await client.messages(capture,pagination);break;
      }
      case 'merchant_kafka_project':value=await client.project(input);break;
      case 'merchant_kafka_save_plan':
        if(typeof input.planJson!=='string'||Buffer.byteLength(input.planJson)>KAFKA_LIMITS.datasetRequestBytes)
          throw failure('KAFKA_INVALID_PARAMS','Supply the complete original mapping plan JSON within 128 KiB.');
        value=await client.savePlan(parseKafkaJson(input.planJson));break;
      case 'merchant_kafka_build':value=await client.build(input);break;
      case 'merchant_kafka_query':value=await client.query(input);break;
      case 'merchant_kafka_compare':value=await client.compare(input);break;
      case 'merchant_kafka_changes':{
        const {id,...pagination}=input;value=await client.changes(id,pagination);break;
      }
      case 'merchant_kafka_import':{
        alias(input.input);const selected=this.#definition(workspace).inputs[input.input];
        if(!selected)throw failure('KAFKA_INPUT_NOT_CONFIGURED','Choose a host-declared complete input file.');
        if(selected.kind!=='ndjson'&&(input.name!==undefined||input.label!==undefined))
          throw failure('KAFKA_INVALID_PARAMS','Source names and labels apply only to NDJSON source inputs.');
        const options={sha256:selected.sha256};
        if(selected.kind==='kafka-project')value=await client.importKafka(selected.path,options);
        else if(selected.kind==='ndjson-project')value=await client.importNative(selected.path,options);
        else {
          const metadata={};
          if(input.name!==undefined)metadata.name=input.name;
          if(input.label!==undefined)metadata.label=input.label;
          value=await client.addSource(selected.path,metadata,options);
        }
        break;
      }
      default:throw failure('TOOL_NOT_FOUND','Unknown original Kafka merchant operation.');
    }
    return this.#result(workspace,name,input,value);
  }
  async call(name,args={}) {
    this.#admitted();
    const definition=definitions.get(name);
    if(!definition)throw failure('TOOL_NOT_FOUND','Unknown original Kafka merchant operation.');
    exact(args,definition.required,Object.keys(definition.properties).filter(key=>!definition.required.includes(key)));
    const pending=Promise.resolve().then(()=>{this.#admitted();return this.#execute(name,args);});
    this.#pending.add(pending);
    try{return await pending;}finally{this.#pending.delete(pending);}
  }
  requestClose() {
    this.#closing=true;this.#controller.abort();
    // Cancel client-owned IO only. The original native capture belongs to Applications.
    for(const client of this.#clients.values())void client.close().catch(()=>{});
    // Signal the original reader now so an admitted full-file hash can drain.
    if(!this.#readsClose){this.#readsClose=this.#reads.close();this.#readsClose.catch(()=>{});}
  }
  close() {
    if(this.#close)return this.#close;
    this.requestClose();
    const attempt=(async()=>{
      while(this.#pending.size)await Promise.allSettled([...this.#pending]);
      const results=await Promise.allSettled([...this.#clients.values()].map(client=>client.close()));
      await this.#readsClose;
      const rejected=results.filter(value=>value.status==='rejected').map(value=>value.reason);
      if(rejected.length)throw new AggregateError(rejected,'Original Kafka client close needs retry.');
    })();
    this.#close=attempt.catch(error=>{this.#close=null;this.#readsClose=null;throw error;});
    return this.#close;
  }
}

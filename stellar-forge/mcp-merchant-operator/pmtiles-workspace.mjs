// MIT. One merchant provider over the original PMTiles workspace, server and portable receiver.
import {constants} from 'node:fs';
import {open,realpath,lstat} from 'node:fs/promises';
import {resolve,dirname,join,sep} from 'node:path';
import {exact,failure,identifier as aliasId,line,plain} from './host-files.mjs';
import {RetainedFileReads} from './retained-file-reads.mjs';
import {PMTILES_DOWNLOAD_SCHEMA,PMTILES_DOWNLOAD_MANIFEST,PMTILES_DOWNLOAD_FILE,
  parsePMTilesExportId,parsePMTilesDownload} from './pmtiles-download.mjs';
import {pmtilesWorkspaceTools} from './catalog/pmtiles-workspace.mjs';
import {servePMTilesWorkspace} from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/pmtiles/server.mjs';
import {readOperationsPackage,receiveOperationsPackage} from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/pmtiles/portable.mjs';
import {identifier,rights,clone,digest,hash,need,HASH} from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/pmtiles/model.mjs';
import {retainJson,MAX_METADATA_BYTES} from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/pmtiles/files.mjs';
import {privateDirectory,readBytes,readJson,writeBytes} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/node/store.mjs';
import {ObjectReport,ObjectDelivery} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/node/object.mjs';
import {acquireStateLease} from '../../stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs';

export const PMTILES_WORKSPACE_CONNECTION_SCHEMA='stellar-forge.pmtiles-workspace-connection.v1';
const CONFIG_SCHEMA='stellar-forge.merchant-mcp.v1';
const TOOL_FIELDS=new Map(pmtilesWorkspaceTools((name,_description,fields,required)=>[name,{keys:Object.keys(fields),required}]));
const kinds=new Set(['pmtiles','style','sprite-json','sprite-png','glyph','document']);
const pick=(value,keys)=>Object.fromEntries(keys.filter(key=>Object.hasOwn(value??{},key)).map(key=>[key,value[key]]));
function integer(value,label,min=0,max=Number.MAX_SAFE_INTEGER){
  if(!Number.isSafeInteger(value)||value<min||value>max)throw failure('INVALID_PARAMS',label+' is outside its declared integer range.');
  return value;
}
function sha(value){need(typeof value==='string'&&HASH.test(value),'PMTILES_SHA256_REQUIRED');return value;}
function hostPath(value,base){
  need(typeof value==='string'&&value.length>0&&!value.includes('\0'),'PMTILES_HOST_PATH_REQUIRED');
  return resolve(base,value);
}
function separate(left,right){
  need(left!==right&&!left.startsWith(right+sep)&&!right.startsWith(left+sep),'PMTILES_SEPARATE_HOST_DIRECTORIES_REQUIRED');
}
async function canonicalPrivate(path,{create=false}={}){
  path=resolve(path);await privateDirectory(path,{create});
  need(await realpath(path)===path,'PMTILES_CANONICAL_PRIVATE_DIRECTORY_REQUIRED');return path;
}
async function hostFile(path){
  path=resolve(path);const info=await lstat(path);
  need(info.isFile()&&!info.isSymbolicLink()&&await realpath(path)===path,'PMTILES_CANONICAL_HOST_FILE_REQUIRED');return path;
}
async function connectionBytes(path){
  const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const info=await file.stat();
    need(info.isFile()&&info.size<=1024*1024&&(process.platform==='win32'||
      (info.mode&0o077)===0&&(!process.getuid||info.uid===process.getuid())),'PMTILES_PRIVATE_CONNECTION_REQUIRED');
    const bytes=await file.readFile();need(bytes.length<=1024*1024,'PMTILES_CONNECTION_SIZE_LIMIT');return bytes;
  }finally{await file.close();}
}
function sourceSelection(value){
  exact(value,['path','report','reportSha256','name','kind','rights','expected','maxBytes'],['name','kind','rights']);
  need(kinds.has(value.kind),'PMTILES_RESOURCE_KIND_INVALID');
  const out={name:line(value.name,'Source name'),kind:value.kind,rights:rights(value.rights)};
  if(value.expected!==undefined){
    exact(value.expected,['bytes','sha256'],['bytes','sha256']);
    out.expected={bytes:integer(value.expected.bytes,'Source bytes',1),sha256:sha(value.expected.sha256)};
  }
  if(value.maxBytes!==undefined)out.maxBytes=integer(value.maxBytes,'Source byte limit',1);
  return out;
}
/** Reading host configuration selects paths and identities; native operations begin at open. */
export async function readPMTilesWorkspaceConfiguration(path,{exportsDirectory}={}){
  path=resolve(path);const bytes=await connectionBytes(path);let raw;
  try{raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch{throw failure('PMTILES_CONNECTION_JSON_INVALID','Use a valid private UTF-8 connection JSON file.');}
  exact(raw,['schema','workspaces'],['schema','workspaces']);
  need(raw.schema===PMTILES_WORKSPACE_CONNECTION_SCHEMA&&plain(raw.workspaces)&&
    Object.keys(raw.workspaces).length>0&&Object.keys(raw.workspaces).length<=32,'PMTILES_CONNECTION_SCHEMA_INVALID');
  const base=dirname(path),workspaces=Object.create(null),seen=new Set();
  for(const [alias,value]of Object.entries(raw.workspaces)){
    aliasId(alias,'Workspace alias');
    exact(value,['label','directory','expectedWorkspaceId','runtime','imports','sf88Objects','receivingTargets'],
      ['directory','expectedWorkspaceId','runtime']);
    const directory=await canonicalPrivate(hostPath(value.directory,base));
    need(!seen.has(directory),'PMTILES_DUPLICATE_WORKSPACE_ALIAS');seen.add(directory);
    if(exportsDirectory)separate(directory,resolve(exportsDirectory));
    const entry={label:line(value.label??alias,'Workspace label'),directory,
      expectedWorkspaceId:identifier(value.expectedWorkspaceId),runtime:await hostFile(hostPath(value.runtime,base)),
      imports:Object.create(null),sf88Objects:Object.create(null),receivingTargets:Object.create(null)};
    for(const field of ['imports','sf88Objects']){
      const values=value[field]??{};need(plain(values)&&Object.keys(values).length<=256,'PMTILES_SOURCE_ALIASES_INVALID');
      for(const [key,item]of Object.entries(values)){
        aliasId(key,'Source alias');const selected=sourceSelection(item);
        if(field==='imports'){
          need(typeof item.path==='string'&&item.report===undefined&&item.reportSha256===undefined,'PMTILES_LOCAL_ALIAS_REQUIRED');
          selected.path=await hostFile(hostPath(item.path,base));
        }else{
          need(typeof item.report==='string'&&item.path===undefined,'PMTILES_OBJECT_REPORT_ALIAS_REQUIRED');
          selected.report=await hostFile(hostPath(item.report,base));selected.reportSha256=sha(item.reportSha256);
        }
        entry[field][key]=selected;
      }
    }
    need(plain(value.receivingTargets??{})&&Object.keys(value.receivingTargets??{}).length<=32,'PMTILES_RECEIVING_TARGETS_INVALID');
    for(const [key,item]of Object.entries(value.receivingTargets??{})){
      aliasId(key,'Receiving target');exact(item,['directory'],['directory']);
      const selected=await canonicalPrivate(hostPath(item.directory,base));separate(directory,selected);
      if(exportsDirectory)separate(resolve(exportsDirectory),selected);
      entry.receivingTargets[key]={directory:selected};
    }
    workspaces[alias]=entry;
  }
  // A received installation cannot overlap another configured original workspace.
  for(const entry of Object.values(workspaces))
    for(const target of Object.values(entry.receivingTargets))
      for(const peer of Object.values(workspaces))separate(target.directory,peer.directory);
  return {connection:path,connectionSha256:hash(bytes),workspaces};
}
/** Original atomic setup and release-store resume preserve interrupted configuration. */
export async function initializePMTilesWorkspaceMerchant(options){
  options=clone(options);exact(options,['directory','connection','name'],['directory','connection']);
  const directory=await canonicalPrivate(hostPath(options.directory,process.cwd()),{create:true});
  const connection=hostPath(options.connection,process.cwd()),name=line(options.name??'Starforge PMTiles release operations','Merchant name');
  const exportsDirectory=await canonicalPrivate(join(directory,'customer-exports'),{create:true});
  const selected=await readPMTilesWorkspaceConfiguration(connection,{exportsDirectory});
  const lease=await acquireStateLease(directory);
  try{
    lease.assertHeld();
    await retainJson(join(directory,'pmtiles-setup.json'),{schema:'stellar-forge.pmtiles-merchant-setup.v1',
      directory,connection,connectionSha256:selected.connectionSha256,name});
    const releaseStore=join(directory,'releases');
    await (await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs')).initReleaseStore(releaseStore,{resume:true});
    const configuration=join(directory,'merchant-mcp.json');
    const config={schema:CONFIG_SCHEMA,name,releaseStore:'./releases',exportsDirectory:'./customer-exports',
      sources:{},pmtilesWorkspaceConnection:connection};
    const bytes=Buffer.from(JSON.stringify(config,null,2)+'\n');lease.assertHeld();
    try{await writeBytes(configuration,bytes,{exclusive:true});}
    catch(error){if(error.code!=='EEXIST')throw error;need((await readBytes(configuration,bytes.length)).equals(bytes),'PMTILES_MERCHANT_CONFIGURATION_CHANGED');}
    await (await import('./config.mjs')).readMerchantConfig(configuration);
    return {schema:CONFIG_SCHEMA,configuration,state:'INITIALIZED',pmtilesWorkspacesConfigured:true,
      workspaces:Object.entries(selected.workspaces).map(([workspace,entry])=>({workspace,label:entry.label,workspaceId:entry.expectedWorkspaceId})),
      authoring:'OPENED_BY_MERCHANT_PMTILES_OPEN'};
  }finally{await lease.close();}
}
function releaseView(value){return pick(value,['id','workspaceId','reviewSha256','editionId','editionVersion','previousReleaseId','runtimeSha256','manifestSha256','createdAt']);}
function previewView(value){return value?pick(value,['alive','releaseId','manifestSha256','runtimeSha256']):null;}
function originalStatus(server,page={}){
  const value=server.controller.workspace.state(page),live=server.controller.state();
  return {...value,releases:value.releases.map(releaseView),preview:previewView(live.preview),runtime:live.runtime,origin:server.origin};
}
function packageView(result,manifest,manifestSha256){
  return {state:'COMPLETE',workspace:manifest.workspace,workspaceId:result.workspaceId,requestId:manifest.requestId,
    exportId:manifest.exportId,packageId:result.packageId,packageManifestSha256:result.manifestSha256,
    runtimeSha256:result.runtimeSha256,archive:{name:PMTILES_DOWNLOAD_FILE,bytes:result.archive.bytes,sha256:result.archive.sha256},
    downloadManifestSha256:manifestSha256,workspaceSnapshot:pick(result.workspace,['schema','workspaceId','revision','currentRelease','sha256']),
    logicalFiles:result.logicalFiles,uniquePayloads:result.uniquePayloads,completedAt:result.completedAt};
}

export class MerchantPMTilesWorkspaces{
  #config;#handles=new Map();#tails=new Map();#pending=new Set();#reads=new RetainedFileReads({errorPrefix:'PMTILES'});
  #closing=false;#closePromise;#shutdown=new AbortController();
  constructor(config){
    this.#config={exportsDirectory:resolve(config.exportsDirectory),pmtilesWorkspaces:clone(config.pmtilesWorkspaces??{workspaces:{}})};
  }
  get summary(){return {configured:Object.keys(this.#config.pmtilesWorkspaces.workspaces).length>0,
    count:Object.keys(this.#config.pmtilesWorkspaces.workspaces).length,opened:[...this.#handles.keys()],
    pending:this.#pending.size,closing:this.#closing,...this.#reads.summary};}
  #entry(alias){
    aliasId(alias,'Workspace alias');const entry=this.#config.pmtilesWorkspaces.workspaces[alias];
    if(!entry)throw failure('PMTILES_WORKSPACE_NOT_CONFIGURED','Choose a host-selected alias from merchant_pmtiles_status.');return entry;
  }
  #paths(alias,requestId){
    this.#entry(alias);identifier(requestId);
    const directory=join(this.#config.exportsDirectory,'pmtiles',alias,requestId);separate(directory,this.#entry(alias).directory);
    return {directory,stagingDirectory:join(directory,'staging'),destination:join(directory,PMTILES_DOWNLOAD_FILE),
      manifest:join(directory,PMTILES_DOWNLOAD_MANIFEST),workspaceExport:join(directory,'workspace-export')};
  }
  async #server(alias){
    const promise=this.#handles.get(alias);
    if(!promise)throw failure('PMTILES_WORKSPACE_CLOSED','Open this original workspace with merchant_pmtiles_open.');return promise;
  }
  async #status(args){
    const rows=Object.entries(this.#config.pmtilesWorkspaces.workspaces).map(([workspace,entry])=>({
      workspace,label:entry.label,workspaceId:entry.expectedWorkspaceId,state:this.#handles.has(workspace)?'OPEN':'CLOSED',
      imports:Object.entries(entry.imports).map(([source,item])=>({source,...pick(item,['name','kind','expected'])})),
      sf88Objects:Object.entries(entry.sf88Objects).map(([source,item])=>({source,...pick(item,['name','kind','expected'])})),
      receivingTargets:Object.keys(entry.receivingTargets)}));
    if(args.workspace===undefined)return {...this.summary,workspaces:rows};
    this.#entry(args.workspace);const row=rows.find(item=>item.workspace===args.workspace);
    if(this.#closing)return {...row,state:'CLOSING'};
    const promise=this.#handles.get(args.workspace);
    return {...row,...(promise?{authoring:originalStatus(await promise,{
      offset:integer(args.offset??0,'Edition offset'),limit:integer(args.limit??50,'Edition page size',1,200)})}:{}),
      retainedFiles:this.#reads.status(args.workspace)};
  }
  async #open(alias){
    const entry=this.#entry(alias);
    if(!this.#handles.has(alias)){
      const promise=servePMTilesWorkspace({directory:entry.directory,runtime:entry.runtime,port:0,
        expectedWorkspaceId:entry.expectedWorkspaceId,title:entry.label});
      this.#handles.set(alias,promise);
      try{const server=await promise;if(this.#closing)await server.close();}
      catch(error){if(this.#handles.get(alias)===promise)this.#handles.delete(alias);throw error;}
    }
    return this.#status({workspace:alias});
  }
  async #closeWorkspace(alias){
    const promise=this.#handles.get(alias);await this.#reads.closeScope(alias);
    if(promise){await (await promise).close();if(this.#handles.get(alias)===promise)this.#handles.delete(alias);}
    return {workspace:alias,state:'CLOSED'};
  }
  async #packageMetadata(alias,requestId){
    const entry=this.#entry(alias),paths=this.#paths(alias,requestId);
    const request=await readJson(join(paths.stagingDirectory,'package-request.json'),MAX_METADATA_BYTES);
    const result=await readJson(join(paths.stagingDirectory,'package-complete.json'),MAX_METADATA_BYTES);
    need(request.schema==='starforge.pmtiles-package-request.v1'&&request.requestId===requestId&&
      request.workspaceId===entry.expectedWorkspaceId&&request.destination===paths.destination&&
      result.schema==='starforge.pmtiles-package-complete.v1'&&result.workspaceId===entry.expectedWorkspaceId&&
      result.requestSha256===digest(request)&&result.archive.path===paths.destination,'PMTILES_PACKAGE_SELECTION_CHANGED');
    sha(result.archive.sha256);integer(result.archive.bytes,'Archive bytes',1);
    const manifest={schema:PMTILES_DOWNLOAD_SCHEMA,exportId:alias+':'+requestId,workspace:alias,requestId,
      workspaceId:result.workspaceId,packageId:result.packageId,packageManifestSha256:result.manifestSha256,
      runtimeSha256:result.runtimeSha256,files:[{name:PMTILES_DOWNLOAD_FILE,bytes:result.archive.bytes,sha256:result.archive.sha256}]};
    const manifestBytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');
    return {entry,paths,result,manifest,manifestBytes,manifestSha256:hash(manifestBytes)};
  }
  async #packageInfo(alias,requestId){
    const value=await this.#packageMetadata(alias,requestId);
    await readOperationsPackage({requestId,expectedWorkspaceId:value.entry.expectedWorkspaceId,
      stagingDirectory:value.paths.stagingDirectory,archiveSha256:value.result.archive.sha256});
    await retainJson(value.paths.manifest,value.manifest);
    return packageView(value.result,value.manifest,value.manifestSha256);
  }
  async #downloadMetadata(exportId){
    const {workspace,requestId}=parsePMTilesExportId(exportId),value=await this.#packageMetadata(workspace,requestId);
    const saved=await readBytes(value.paths.manifest,65536);
    need(saved.equals(value.manifestBytes),'PMTILES_DOWNLOAD_MANIFEST_CHANGED');
    return {...value,workspace,requestId};
  }
  async #download(name,args){
    const selection=parsePMTilesExportId(args.exportId);this.#entry(selection.workspace);
    if(name==='merchant_pmtiles_download_file_release')return {exportId:args.exportId,...await this.#reads.release(selection.workspace,args.readId)};
    const value=await this.#downloadMetadata(args.exportId);
    if(name==='merchant_pmtiles_download_manifest')return {state:'MANIFEST_RETAINED',exportId:args.exportId,
      manifestFile:{name:PMTILES_DOWNLOAD_MANIFEST,bytes:value.manifestBytes.length,sha256:value.manifestSha256}};
    need(name==='merchant_pmtiles_download_file','TOOL_NOT_FOUND');
    need(args.expectedManifestSha256===value.manifestSha256,'PMTILES_DOWNLOAD_MANIFEST_CHANGED');
    const isManifest=args.file===PMTILES_DOWNLOAD_MANIFEST;
    need(isManifest||args.file===PMTILES_DOWNLOAD_FILE,'PMTILES_DOWNLOAD_FILE_INVALID');
    const expected=isManifest?{bytes:value.manifestBytes.length,sha256:value.manifestSha256}:value.result.archive;
    need(sha(args.expectedSha256)===expected.sha256,'PMTILES_DOWNLOAD_FILE_CHANGED');
    const result=await this.#reads.read({scope:selection.workspace,key:args.exportId+':'+args.file,kind:'PMTILES_PACKAGE',
      directory:value.paths.directory,readId:args.readId,expectedSha256:args.expectedSha256,
      offset:args.offset??0,limit:args.limit??65536,
      load:async()=>{
        if(isManifest)return {bytes:value.manifestBytes,name:PMTILES_DOWNLOAD_MANIFEST,type:'application/json'};
        const original=await readOperationsPackage({requestId:selection.requestId,expectedWorkspaceId:value.entry.expectedWorkspaceId,
          stagingDirectory:value.paths.stagingDirectory,archiveSha256:expected.sha256});
        const readonlyFileHandle=await open(original.file.path,constants.O_RDONLY|constants.O_NOFOLLOW);
        return {readonlyFileHandle,bytes:expected.bytes,sha256:expected.sha256,name:PMTILES_DOWNLOAD_FILE,type:'application/zip'};
      }});
    return {exportId:args.exportId,manifestSha256:value.manifestSha256,...result};
  }
  async #execute(name,args){
    if(this.#closing)throw failure('OPERATOR_CLOSING','The PMTiles operator is closing.');
    if(name.startsWith('merchant_pmtiles_download_'))return this.#download(name,args);
    if(name==='merchant_pmtiles_status')return this.#status(args);
    const alias=args.workspace,entry=this.#entry(alias);
    if(name==='merchant_pmtiles_open')return this.#open(alias);
    if(name==='merchant_pmtiles_close')return this.#closeWorkspace(alias);
    if(name==='merchant_pmtiles_package_info')return this.#packageInfo(alias,identifier(args.requestId));
    if(name==='merchant_pmtiles_file_release')return {workspace:alias,...await this.#reads.release(alias,args.readId)};
    const server=await this.#server(alias),controller=server.controller,model=controller.workspace;
    const owner=fields=>({...fields,requestId:identifier(args.requestId),expectedWorkspaceId:entry.expectedWorkspaceId});
    const execute=(action,input)=>controller.execute(action,owner(input),{signal:this.#shutdown.signal});
    switch(name){
      case 'merchant_pmtiles_console':return {workspace:alias,workspaceId:entry.expectedWorkspaceId,url:server.url,origin:server.origin};
      case 'merchant_pmtiles_resources':return model.listResources({offset:integer(args.offset??0,'Resource offset'),
        limit:integer(args.limit??100,'Resource page size',1,200),kind:args.kind??null});
      case 'merchant_pmtiles_resource':return model.getResource(identifier(args.resourceId));
      case 'merchant_pmtiles_resource_file':{
        const row=model.getResource(identifier(args.resourceId));need(sha(args.expectedSha256)===row.sha256,'PMTILES_RESOURCE_CHANGED');
        return this.#reads.read({scope:alias,key:'resource:'+row.id,kind:'PMTILES_RESOURCE',directory:entry.directory,
          readId:args.readId,expectedSha256:args.expectedSha256,offset:args.offset??0,limit:args.limit??65536,
          load:async()=>({readonlyFileHandle:await open(model.resourceFile(row.id).path,constants.O_RDONLY|constants.O_NOFOLLOW),
            bytes:row.bytes,sha256:row.sha256,name:row.name,type:row.kind==='style'||row.kind==='sprite-json'?'application/json':'application/octet-stream'})});
      }
      case 'merchant_pmtiles_import':{
        const source=entry.imports[aliasId(args.source,'Source alias')];need(source,'PMTILES_LOCAL_SOURCE_NOT_CONFIGURED');
        return execute('import-local',clone(source));
      }
      case 'merchant_pmtiles_acquire':return execute('acquire',pick(args,['url','name','kind','rights','expected','maxBytes','etag']));
      case 'merchant_pmtiles_adopt_object':{
        const source=entry.sf88Objects[aliasId(args.source,'Object source alias')];need(source,'PMTILES_OBJECT_SOURCE_NOT_CONFIGURED');
        const bytes=await readBytes(source.report,64*1024*1024);need(hash(bytes)===source.reportSha256,'PMTILES_OBJECT_REPORT_CHANGED');
        const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
        const report=new ObjectReport(value.record??value,value.process??null),delivery=new ObjectDelivery(report);
        return model.adoptObject(owner(pick(source,['name','kind','rights','expected','maxBytes'])),delivery,{signal:this.#shutdown.signal});
      }
      case 'merchant_pmtiles_save':return execute('save-edition',pick(args,['editionId','expectedVersion','edition']));
      case 'merchant_pmtiles_edition':return model.getEdition(identifier(args.editionId),integer(args.version,'Edition version',1));
      case 'merchant_pmtiles_compare':return model.compare({leftId:identifier(args.leftId),leftVersion:integer(args.leftVersion,'Left version',1),
        rightId:identifier(args.rightId),rightVersion:integer(args.rightVersion,'Right version',1)});
      case 'merchant_pmtiles_inspect':return execute('inspect',pick(args,['editionId','version']));
      case 'merchant_pmtiles_request':return {workspace:alias,request:model.getRequest(identifier(args.requestId))};
      case 'merchant_pmtiles_review':return execute('review',pick(args,['editionId','version','inspectionRequestId','expectedCurrentRelease','reviewer','note']));
      case 'merchant_pmtiles_review_status':return model.getReview(identifier(args.reviewId));
      case 'merchant_pmtiles_prepare':return execute('prepare-release',pick(args,['reviewId','reviewSha256']));
      case 'merchant_pmtiles_release':return model.getRelease(identifier(args.releaseId));
      case 'merchant_pmtiles_publish':{
        const value=await execute('publish',pick(args,['releaseId','manifestSha256','expectedCurrentRelease']));
        return {...value,preview:previewView(value.preview),origin:server.origin};
      }
      case 'merchant_pmtiles_restore':{
        const value=await execute('restore',pick(args,['fromReleaseId','manifestSha256']));
        return {...value,preview:previewView(value.preview),origin:server.origin};
      }
      case 'merchant_pmtiles_preview':return {preview:previewView(await execute('preview',pick(args,['releaseId']))),origin:server.origin};
      case 'merchant_pmtiles_stop_preview':return execute('stop-preview',{});
      case 'merchant_pmtiles_export':{
        const paths=this.#paths(alias,args.requestId);
        return execute('export',{destination:paths.workspaceExport});
      }
      case 'merchant_pmtiles_package':{
        const paths=this.#paths(alias,args.requestId);
        await execute('package',{stagingDirectory:paths.stagingDirectory,destination:paths.destination});
        return this.#packageInfo(alias,args.requestId);
      }
      case 'merchant_pmtiles_receive':{
        const target=entry.receivingTargets[aliasId(args.target,'Receiving target')];need(target,'PMTILES_RECEIVING_TARGET_NOT_CONFIGURED');
        const value=await this.#packageMetadata(alias,identifier(args.packageRequestId));
        need(sha(args.archiveSha256)===value.result.archive.sha256,'PMTILES_RECEIVING_ARCHIVE_CHANGED');
        await readOperationsPackage({requestId:args.packageRequestId,expectedWorkspaceId:entry.expectedWorkspaceId,
          stagingDirectory:value.paths.stagingDirectory,archiveSha256:args.archiveSha256});
        const base=join(target.directory,identifier(args.requestId));
        return receiveOperationsPackage({requestId:args.requestId,archive:value.paths.destination,
          directory:join(base,'installation'),workspaceDirectory:join(base,'workspace'),
          pythonExecutable:controller.runtime.pythonExecutable.path,expectedArchiveSha256:args.archiveSha256,
          expectedWorkspaceId:entry.expectedWorkspaceId},{signal:this.#shutdown.signal});
      }
      default:throw failure('TOOL_NOT_FOUND','Unknown PMTiles workspace operation.');
    }
  }
  call(name,input){
    if(this.#closing)return Promise.reject(failure('OPERATOR_CLOSING','The PMTiles operator is closing.'));
    const fields=TOOL_FIELDS.get(name);if(!fields)return Promise.reject(failure('TOOL_NOT_FOUND','Unknown PMTiles workspace operation.'));
    let args,alias;
    try{
      args=clone(input??{});exact(args,fields.keys,fields.required);
      alias=name.startsWith('merchant_pmtiles_download_')?parsePMTilesExportId(args.exportId).workspace:args.workspace;
      if(alias!==undefined)this.#entry(alias);
    }catch(error){return Promise.reject(error);}
    // Calls accepted for an alias retain their order; close cannot overtake a saved mutation.
    // Global status stays available while the original native operation is in progress.
    const previous=alias===undefined?Promise.resolve():(this.#tails.get(alias)??Promise.resolve());
    const pending=previous.catch(()=>{}).then(()=>this.#execute(name,args));
    if(alias!==undefined)this.#tails.set(alias,pending);this.#pending.add(pending);
    const done=()=>{this.#pending.delete(pending);if(alias!==undefined&&this.#tails.get(alias)===pending)this.#tails.delete(alias);};
    pending.then(done,done);return pending;
  }
  requestClose(){
    this.#closing=true;this.#shutdown.abort(new Error('PMTILES_MERCHANT_CLOSING'));
    for(const promise of this.#handles.values())promise.then(server=>server.close()).catch(()=>{});
  }
  close(){
    if(this.#closePromise)return this.#closePromise;this.requestClose();
    this.#closePromise=(async()=>{
      await Promise.allSettled([...this.#pending]);
      const results=await Promise.allSettled([...this.#handles.entries()].map(async([alias,promise])=>{
        await (await promise).close();this.#handles.delete(alias);
      }));
      try{await this.#reads.close();}catch(error){results.push({status:'rejected',reason:error});}
      const failed=results.find(result=>result.status==='rejected');
      if(failed)throw failure('PMTILES_MERCHANT_CLOSE_INCOMPLETE',String(failed.reason?.message??'The original native owner is still closing.'));
    })();
    this.#closePromise.catch(()=>{this.#closePromise=null;});return this.#closePromise;
  }
}

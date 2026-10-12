// MIT. Complete agent receiving attached to the original Property Operations owner.
import {constants} from 'node:fs';
import {open,mkdir,mkdtemp,unlink,rmdir,realpath,link} from 'node:fs/promises';
import {resolve,join,relative,isAbsolute} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {PropertyWorkspaceConnections,verifyPropertyHostFile} from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/property-operations/provider.mjs';
import {PropertyClientError,PROPERTY_GROUPS,PROPERTY_WRITE_ACTIONS,PROPERTY_FILE_KINDS} from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/property-operations/client.mjs';
import {propertyWorkspaceTools} from './catalog/property-workspace.mjs';
import {RetainedFileReads,MAX_RETAINED_CHUNK_BYTES} from './retained-file-reads.mjs';
import {exact,plain,failure,privateSupportDirectory,writePrivate} from './host-files.mjs';
import {PROPERTY_DOWNLOAD_MANIFEST,PROPERTY_NATIVE_MANIFEST,PROPERTY_MAX_FILE_BYTES,PROPERTY_MAX_MANIFEST_BYTES,
  createPropertyDownloadManifest,propertyRelativeFile,propertyCanonical,validatePropertyExportId} from './property-download-contract.mjs';
export {propertyWorkspaceTools} from './catalog/property-workspace.mjs';
const HASH=/^[a-f0-9]{64}$/,ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/,MAX_FILES=30000;
const fail=(code,message)=>failure('PROPERTY_'+code,message);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>Buffer.from(propertyCanonical(value)+'\n');
const same=(a,b)=>propertyCanonical(a)===propertyCanonical(b);
const definitions=new Map(propertyWorkspaceTools((name,description,properties,required)=>({name,properties,required})).map(v=>[v.name,v]));
function hash(value){if(!HASH.test(value??''))throw fail('FILE_IDENTITY','Retain the complete original SHA-256.');return value;}
function integer(value,maximum=Number.MAX_SAFE_INTEGER,minimum=0){if(!Number.isSafeInteger(value)||value<minimum||value>maximum)throw fail('FILE_RANGE','Use an integer in the declared range.');return value;}
function nativeFile(value){
  if(!plain(value)||!Number.isSafeInteger(value.bytes)||value.bytes<0||value.bytes>PROPERTY_MAX_FILE_BYTES||!HASH.test(value.sha256??''))
    throw fail('FILE_IDENTITY','The original file must have a complete byte count and SHA-256.');
  propertyRelativeFile(value.name);return value;
}
function nativeRecord(value){
  if(!plain(value)||value.schema!=='stellar-forge.property-native-manifest.v1'||typeof value.createdAt!=='string'||
    !Number.isFinite(Date.parse(value.createdAt))||!plain(value.selection)||!plain(value.record)||
    !Array.isArray(value.files)||!value.files.length||value.files.length>MAX_FILES)
    throw fail('RECEIVING_MANIFEST','Retain the complete original export or selected customer resource.');
  const names=new Set();
  for(const file of value.files){
    nativeFile(file);
    if(names.has(file.name)||!plain(file.selection))throw fail('RECEIVING_MANIFEST','Native file names and original selections must be unique and complete.');
    names.add(file.name);
    if(value.selection.kind==='source-export'){
      if(file.selection.kind!=='source-export'||file.selection.exportId!==value.selection.exportId||file.selection.name!==file.name)
        throw fail('RECEIVING_MANIFEST','Every source member must bind the same original export.');
    }else if(value.selection.kind==='property-resource'){
      if(file.selection.kind!=='property'||typeof file.selection.file!=='string'||
        !file.selection.file.startsWith('property/resources/'+value.selection.resourceId+'/'))
        throw fail('RECEIVING_MANIFEST','Every selected resource file must retain its original path.');
    }else throw fail('RECEIVING_MANIFEST','Select source-export or property-resource.');
    if(file.selection.bytes!==file.bytes||file.selection.sha256!==file.sha256)
      throw fail('RECEIVING_MANIFEST','The original source descriptor differs from its receiving entry.');
  }
  return value;
}
function retained(value,raw=json(value)){
  nativeRecord(value);const nativeSha=sha(raw);
  const selected=createPropertyDownloadManifest({workspaceId:value.createdAt,
    native:{selection:value.selection,propertyId:value.propertyId,recordSha256:sha(json(value.record)),manifestSha256:nativeSha},
    files:[{name:PROPERTY_NATIVE_MANIFEST,bytes:raw.length,sha256:nativeSha},
      ...value.files.map(f=>({name:'files/'+f.name,bytes:f.bytes,sha256:f.sha256}))]});
  return {...selected,native:value,nativeRaw:raw,
    manifestFile:{name:PROPERTY_DOWNLOAD_MANIFEST,bytes:selected.bytes.length,sha256:selected.sha256}};
}
async function privateBytes(path,maximum){
  const h=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try {const s=await h.stat({bigint:true}),signature=x=>[x.dev,x.ino,x.size,x.mode,x.mtimeNs,x.ctimeNs].join(':');
    if(!s.isFile()||(s.mode&0o077n)||s.size>BigInt(maximum))throw fail('PRIVATE_FILE','Use a bounded original private receiving file.');
    const raw=await h.readFile();if(raw.length>maximum||signature(await h.stat({bigint:true}))!==signature(s))
      throw fail('RECEIVING_CHANGED','The complete retained receiving file changed.');
    return raw;
  }finally{await h.close();}
}
async function publish(directory,name,raw){
  const temporary=join(directory,'.property-'+randomUUID()+'.tmp'),target=join(directory,name);
  await writePrivate(temporary,raw);
  try{
    try{await link(temporary,target);}catch(error){
      if(error.code!=='EEXIST')throw error;
      if(!(await privateBytes(target,PROPERTY_MAX_MANIFEST_BYTES)).equals(raw))throw fail('RECEIVING_CHANGED','This retained identity has different original bytes.');
    }
    const h=await open(directory,constants.O_RDONLY);try{await h.sync();}finally{await h.close();}
  }finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
export class MerchantPropertyWorkspaces extends PropertyWorkspaceConnections {
  #config;#reads;#closing=false;#closePromise;#temps=new Set();#cache=new Map();#cachedBytes=0;#locations=new Set();
  constructor(config){super(config);this.#config=config;
    this.#reads=new RetainedFileReads({errorPrefix:'PROPERTY',maxImmutableFileBytes:PROPERTY_MAX_FILE_BYTES,maxSnapshotBytes:PROPERTY_MAX_MANIFEST_BYTES*2});}
  get summary(){return {...super.summary,receiving:{retainedReads:this.#reads.summary,closing:this.#closing}};}
  #scope(alias,createdAt){return alias+':'+createdAt;}
  async #storage(alias,createdAt){
    const selected=this.configuration?.workspaces?.[alias];
    if(!selected||selected.expectedCreatedAt!==createdAt)throw fail('WORKSPACE_CHANGED','Use the original configured workspace identity.');
    if(typeof this.#config.exportsDirectory!=='string')throw fail('RECEIVING_CONFIGURATION','Configure the original private merchant exports directory.');
    const root=resolve(this.#config.exportsDirectory);await privateSupportDirectory(root);
    const realRoot=await realpath(root),native=await realpath(selected.directory),rel=relative(native,realRoot);
    if(realRoot!==root||rel===''||!rel.startsWith('..'+(process.platform==='win32'?'\\':'/'))&&rel!=='..'&&!isAbsolute(rel))
      throw fail('RECEIVING_OVERLAP','Keep merchant receiving storage outside the original native workspace.');
    let directory=root;
    for(const name of ['property-receiving',sha(Buffer.from(createdAt))]){
      directory=join(directory,name);await mkdir(directory,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});
      await privateSupportDirectory(directory);
      if(await realpath(directory)!==directory)throw fail('PRIVATE_DIRECTORY','The original receiving path must be canonical.');
    }
    return directory;
  }
  async #importPath(prepared){
    if(prepared?.action!=='property.file.import')return;
    const input=prepared.payload,entries=Object.entries(this.configuration?.files??{});
    const selected=entries.find(([,v])=>v.path===input?.path&&v.sha256===input?.sha256);
    if(!selected)throw fail('HOST_FILE_REQUIRED','Native file imports must use an original host-declared file alias.');
    await verifyPropertyHostFile(this.configuration,selected[0],selected[1]);
  }
  #remember(value){
    const key=value.manifest.exportId;
    if(this.#cache.has(key))return value;
    const size=value.bytes.length+value.nativeRaw.length;
    if(size<=32*1024*1024){while(this.#cache.size&&(this.#cache.size>=4||this.#cachedBytes+size>32*1024*1024)){
      const [old,entry]=this.#cache.entries().next().value;this.#cache.delete(old);this.#cachedBytes-=entry.size;}
      this.#cache.set(key,{value,size});this.#cachedBytes+=size;}
    return value;
  }
  async #record(alias,createdAt,exportId){
    validatePropertyExportId(exportId);let cached=this.#cache.get(exportId)?.value;
    if(cached){if(cached.manifest.workspaceId!==createdAt)throw fail('WORKSPACE_CHANGED','This manifest belongs to another workspace.');return cached;}
    const raw=await privateBytes(join(await this.#storage(alias,createdAt),exportId+'.json'),PROPERTY_MAX_MANIFEST_BYTES);
    let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch{throw fail('RECEIVING_MANIFEST','Read the full original UTF-8 manifest.');}
    if(!json(value).equals(raw)||value.createdAt!==createdAt)throw fail('RECEIVING_CHANGED','The saved source manifest changed.');
    cached=retained(value,raw);if(cached.manifest.exportId!==exportId)throw fail('RECEIVING_CHANGED','The retained export ID differs from its original complete files.');
    return this.#remember(cached);
  }
  async #selection(client,selection){
    if(!plain(selection))throw fail('EXPORT_SELECTION','Select an existing native export or property resource.');
    const state=await client.status();let record,descriptors,propertyId=null;
    if(selection.kind==='source-export'){
      exact(selection,['kind','exportId'],['kind','exportId']);
      if(!ID.test(selection.exportId??''))throw fail('EXPORT_SELECTION','Select an original saved export ID.');
      record=state.exports.find(v=>v.id===selection.exportId);
      if(!record)throw fail('EXPORT_NOT_FOUND','The original native source export is absent.');
      descriptors=record.files.map(d=>({name:d.name,bytes:d.bytes,sha256:d.sha256,
        selection:{kind:'source-export',exportId:record.id,name:d.name,bytes:d.bytes,sha256:d.sha256}}));
    }else if(selection.kind==='property-resource'){
      exact(selection,['kind','resourceId'],['kind','resourceId']);
      if(!ID.test(selection.resourceId??''))throw fail('EXPORT_SELECTION','Select an original customer property resource.');
      const result=await client.record('resources',selection.resourceId);record=result.result.record;propertyId=result.state.property.id;
      descriptors=record.files.map(d=>({name:d.name,bytes:d.bytes,sha256:d.sha256,
        selection:{kind:'property',file:d.file,bytes:d.bytes,sha256:d.sha256}}));
    }else throw fail('EXPORT_SELECTION','Select source-export or property-resource.');
    return nativeRecord({schema:'stellar-forge.property-native-manifest.v1',createdAt:state.createdAt,propertyId,selection,record,files:descriptors});
  }
  async #cleanup(item){
    const errors=[];
    for(const key of ['writer','reader'])if(item[key])try{await item[key].close();item[key]=null;}catch(error){errors.push(error);}
    for(const key of ['path','directory'])if(item[key])try{await (key==='path'?unlink:rmdir)(item[key]);item[key]=null;}
      catch(error){if(error.code==='ENOENT')item[key]=null;else errors.push(error);}
    if(!item.writer&&!item.reader&&!item.path&&!item.directory)this.#temps.delete(item);
    if(errors.length)throw new AggregateError(errors,'The original receiving temporary did not fully close.');
  }
  async #handle(alias,createdAt,descriptor,receive){
    nativeFile(descriptor);const root=await this.#storage(alias,createdAt);
    const item={directory:await mkdtemp(join(root,'.native-')),path:null,writer:null,reader:null};this.#temps.add(item);
    try{
      item.path=join(item.directory,'original');item.writer=await open(item.path,'wx',0o600);
      let count=0;const hash=createHash('sha256');
      await receive(async chunk=>{count+=chunk.length;if(count>descriptor.bytes)throw fail('FILE_CHANGED','The original file exceeded its complete descriptor.');
        hash.update(chunk);let offset=0;while(offset<chunk.length){const written=await item.writer.write(chunk,offset,chunk.length-offset);
          if(!written.bytesWritten)throw fail('RECEIVING_WRITE','The complete native file could not be written.');offset+=written.bytesWritten;}});
      if(count!==descriptor.bytes||hash.digest('hex')!==descriptor.sha256)throw fail('FILE_CHANGED','The original file differs from its reviewed full byte/hash identity.');
      await item.writer.sync();await item.writer.close();item.writer=null;
      item.reader=await open(item.path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
      const stat=await item.reader.stat();if(!stat.isFile()||stat.size!==descriptor.bytes||(stat.mode&0o077))throw fail('PRIVATE_FILE','The complete received original must remain private.');
      await unlink(item.path);item.path=null;await rmdir(item.directory);item.directory=null;
      const handle=item.reader;item.reader=null;this.#temps.delete(item);
      return {readonlyFileHandle:handle,name:descriptor.name,bytes:descriptor.bytes,sha256:descriptor.sha256,type:'application/octet-stream'};
    }catch(error){try{await this.#cleanup(item);}catch(closeError){error.closeError=closeError;}throw error;}
  }
  async #execute(short,args,{client,state,selected}){
    const createdAt=state.createdAt,scope=this.#scope(args.workspace,createdAt);
    if(short==='status')return {workspace:args.workspace,native:state};
    if(short==='reconnect'){
      if(args.createdAt!==createdAt||args.propertyId!==undefined&&args.propertyId!==state.property.id)throw fail('WORKSPACE_CHANGED','Reconnect only the original saved workspace.');
      return {state:'CONNECTED',workspace:args.workspace,createdAt,propertyId:state.property.id,native:state};
    }
    if(short==='records'||short==='files'){
      const rows=short==='files'?state.property.files:state.property[args.group];
      if(!Array.isArray(rows)||short==='records'&&!PROPERTY_GROUPS.includes(args.group))throw fail('RECORD_GROUP','Choose an original property collection.');
      const offset=integer(args.offset??0,rows.length),limit=integer(args.limit??100,250,1),revision=state.property.revision;
      if(offset>0&&args.expectedRevision===undefined||args.expectedRevision!==undefined&&args.expectedRevision!==revision)
        throw fail('REVISION_CHANGED','Keep the original revision through every complete inventory page.');
      const values=rows.slice(offset,offset+limit);
      return {workspace:args.workspace,createdAt,propertyId:state.property.id,revision,
        ...(short==='files'?{files:values}:{group:args.group,records:values}),
        page:{offset,limit,total:rows.length,next:offset+values.length<rows.length?offset+values.length:null}};
    }
    if(short==='record')return {workspace:args.workspace,native:await client.record(args.group,args.id)};
    if(short==='operation')return {workspace:args.workspace,native:await client.operation(args.key)};
    if(short==='prepare'){if(!PROPERTY_WRITE_ACTIONS.includes(args.action)||args.action==='property.file.import')throw fail('HOST_FILE_REQUIRED','Use the dedicated host file alias preparation for imports.');return {workspace:args.workspace,prepared:await client.prepare(args.action,args.input,{key:args.key})};}
    if(short==='file_import_prepare'){
      const selected=await verifyPropertyHostFile(this.configuration,args.fileAlias,{bytes:args.bytes,sha256:args.sha256});
      return {workspace:args.workspace,fileAlias:args.fileAlias,prepared:await client.prepare('property.file.import',
        {path:selected.path,sha256:selected.sha256,actor:args.actor,note:args.note},{key:args.key})};
    }
    if(short==='inspect_request')return {workspace:args.workspace,native:await client.inspectPrepared(args.prepared)};
    if(short==='invoke'){await this.#importPath(args.prepared);return {workspace:args.workspace,native:await client.invoke(args.prepared,{resumeIssued:args.resumeIssued??false})};}
    if(short==='action'){if(!definitions.get('merchant_property_action').properties.action.enum.includes(args.action))throw fail('ACTION_REQUIRED','Prepare and retain original property changes before invocation.');return {workspace:args.workspace,native:await client.act(args.action,args.payload)};}
    if(short==='file')return {workspace:args.workspace,native:await client.selectFile(args.selection)};
    if(short==='file_read'){
      hash(args.expectedSha256);const file=await client.selectFile({...args.selection,sha256:args.expectedSha256});
      return this.#reads.read({scope,key:'native:'+propertyCanonical(file.selection),kind:'PROPERTY_NATIVE',
        directory:await this.#storage(args.workspace,createdAt),expectedSha256:args.expectedSha256,
        offset:integer(args.offset??0,file.descriptor.bytes),limit:integer(args.limit??65536,MAX_RETAINED_CHUNK_BYTES,1),readId:args.readId,
        load:()=>this.#handle(args.workspace,createdAt,file.descriptor,onChunk=>client.receiveFile(file.selection,{onChunk}))});
    }
    if(short==='publisher_file')return {workspace:args.workspace,native:await client.receivePublisherFile(
      {resourceId:args.resourceId??null,kind:args.kind,id:args.id},{onChunk:()=>{}})};
    if(short==='publisher_file_read'){
      hash(args.expectedSha256);integer(args.bytes,PROPERTY_MAX_FILE_BYTES);
      const selected={resourceId:args.resourceId??null,kind:args.kind,id:args.id,bytes:args.bytes,sha256:args.expectedSha256};
      if(!PROPERTY_FILE_KINDS.includes(selected.kind))throw fail('PUBLISHER_FILE','Choose an original publisher file kind.');
      const descriptor={name:selected.kind+'-'+selected.id.replace(/[^A-Za-z0-9._-]/g,'_'),bytes:selected.bytes,sha256:selected.sha256};
      return this.#reads.read({scope,key:'publisher:'+propertyCanonical(selected),kind:'PROPERTY_PUBLISHER',
        directory:await this.#storage(args.workspace,createdAt),expectedSha256:args.expectedSha256,
        offset:integer(args.offset??0,args.bytes),limit:integer(args.limit??65536,MAX_RETAINED_CHUNK_BYTES,1),readId:args.readId,
        load:()=>this.#handle(args.workspace,createdAt,descriptor,onChunk=>client.receivePublisherFile(selected,{onChunk}))});
    }
    if(short==='export_prepare'){
      if(args.createdAt!==createdAt)throw fail('WORKSPACE_CHANGED','Prepare receiving from the original saved workspace.');
      const first=await this.#selection(client,args.selection),second=await this.#selection(client,args.selection);
      if(!same(first,second))throw fail('EXPORT_CHANGED','The original selected export changed while its complete inventory was read.');
      const value=retained(first),directory=await this.#storage(args.workspace,createdAt);
      try{await publish(directory,value.manifest.exportId+'.json',value.nativeRaw);}
      catch(error){error.details={createdAt,exportId:value.manifest.exportId,manifestSha256:value.sha256};throw error;}
      this.#remember(value);return {state:'RETAINED',workspace:args.workspace,createdAt,exportId:value.manifest.exportId,
        manifestFile:value.manifestFile,native:value.manifest.native,files:value.manifest.files.length,bytes:value.manifest.totalBytes};
    }
    const record=await this.#record(args.workspace,createdAt,args.exportId);
    if(short==='export_manifest')return {state:'MANIFEST_RETAINED',workspace:args.workspace,createdAt,exportId:args.exportId,manifestFile:record.manifestFile};
    if(short==='export_inventory'){
      const offset=integer(args.offset??0,record.manifest.files.length),limit=integer(args.limit??100,250,1);
      const files=record.manifest.files.slice(offset,offset+limit);
      return {workspace:args.workspace,createdAt,exportId:args.exportId,manifestSha256:record.sha256,native:record.manifest.native,files,
        page:{offset,limit,total:record.manifest.files.length,next:offset+files.length<record.manifest.files.length?offset+files.length:null}};
    }
    if(short==='export_file'){
      propertyRelativeFile(args.file);hash(args.expectedSha256);
      if(hash(args.expectedManifestSha256)!==record.sha256)throw fail('MANIFEST_CHANGED','Use the exact retained complete manifest SHA-256.');
      const descriptor=args.file===PROPERTY_DOWNLOAD_MANIFEST?record.manifestFile:record.manifest.files.find(f=>f.name===args.file);
      if(!descriptor||descriptor.sha256!==args.expectedSha256)throw fail('FILE_CHANGED','Choose one exact original declared file.');
      const result=await this.#reads.read({scope,key:'export:'+args.exportId+':'+args.file,kind:'PROPERTY_EXPORT',
        directory:await this.#storage(args.workspace,createdAt),expectedSha256:args.expectedSha256,
        offset:integer(args.offset??0,descriptor.bytes),limit:integer(args.limit??65536,MAX_RETAINED_CHUNK_BYTES,1),readId:args.readId,
        load:async()=>{
          if(args.file===PROPERTY_DOWNLOAD_MANIFEST)return {name:args.file,bytes:record.bytes,type:'application/json'};
          if(args.file===PROPERTY_NATIVE_MANIFEST)return {name:args.file,bytes:record.nativeRaw,type:'application/json'};
          const original=record.native.files.find(f=>'files/'+f.name===args.file);
          if(!original)throw fail('FILE_CHANGED','This file is absent from the exact native selection.');
          return this.#handle(args.workspace,createdAt,descriptor,onChunk=>client.receiveFile(original.selection,{onChunk}));
        }});
      return {exportId:args.exportId,manifestSha256:record.sha256,...result};
    }
    throw fail('TOOL_NOT_FOUND','Choose an original Property Operations tool.');
  }
  async call(name,args={}){
    if(this.#closing)throw fail('WORKSPACES_CLOSING','Finish closing this borrowed attachment.');
    const definition=definitions.get(name);if(!definition)throw fail('TOOL_NOT_FOUND','Choose an original Property Operations tool.');
    exact(args,Object.keys(definition.properties),definition.required);args=structuredClone(args);
    const short=name.slice('merchant_property_'.length);
    if(short==='workspaces')return this.summary;
    if(short==='file_release'||short==='export_file_release'){
      if(short==='export_file_release')validatePropertyExportId(args.exportId);
      const selected=this.configuration?.workspaces?.[args.workspace];
      if(!selected)throw fail('WORKSPACE_NOT_CONFIGURED','Choose the original configured workspace.');
      await this.#reads.release(this.#scope(args.workspace,selected.expectedCreatedAt),args.readId);
      return {state:'RELEASED',workspace:args.workspace,readId:args.readId,...(args.exportId?{exportId:args.exportId}:{})};
    }
    return this.withWorkspace(args.workspace,bound=>this.#execute(short,args,bound));
  }
  close(){
    if(this.#closePromise)return this.#closePromise;this.#closing=true;
    return this.#closePromise=(async()=>{
      const errors=[];try{await super.close();}catch(error){errors.push(error);}
      try{await this.#reads.close();}catch(error){errors.push(error);}
      for(const item of [...this.#temps])try{await this.#cleanup(item);}catch(error){errors.push(error);}
      if(errors.length)throw new AggregateError(errors,'The original Property Operations borrower did not fully close.');
      this.#cache.clear();this.#cachedBytes=0;
    })().catch(error=>{this.#closePromise=null;throw error;});
  }
}

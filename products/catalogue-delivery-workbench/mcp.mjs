// SPDX-License-Identifier: MIT
// Installed aliases bind the privately selected original Catalogue Store and ApprovalStore.
import {constants} from 'node:fs';
import {open,realpath,lstat,link} from 'node:fs/promises';
import {dirname,resolve,basename,join} from 'node:path';
import {createHash} from 'node:crypto';
import {catalogueDeliveryTools,NATIVE_DEFINITIONS} from './tools.mjs';
import {CatalogueDeliveryFiles,present} from './files.mjs';
import {CatalogueDeliveryRequests,canonical} from './requests.mjs';
import {CatalogueDeliveryClient,need,plain,exact,absolute,identifier,digest,integer,hash,readJson,readFile,readConnection,readLaunchConfiguration,privateDirectory,ownedDirectory,inside,MAX_JSON,MAX_FILE} from './connection.mjs';
export const CATALOGUE_DELIVERY_HOST_SCHEMA='stellar-forge.catalogue-delivery-host.v1';
const definitions=new Map(NATIVE_DEFINITIONS.map(x=>[x.suffix,x]));
const schemas=new Map(catalogueDeliveryTools((name,description,properties,required)=>({name,properties,required})).map(x=>[x.name,x]));
const alias=v=>{need(typeof v==='string'&&/^[a-z0-9][a-z0-9_-]{0,63}$/.test(v),'CATALOGUE_DELIVERY_ALIAS','Choose a declared host alias.');return v;};
const label=(v,f)=>{v=v??f;need(typeof v==='string'&&v.length>0&&v.length<=240&&!/[\x00-\x1f\x7f]/.test(v),'CATALOGUE_DELIVERY_LABEL','Use a readable label.');return v;};
const recordId=v=>{need(typeof v==='string'&&/^[a-f0-9]{24}$/.test(v),'CATALOGUE_DELIVERY_ID','Use an original24-character record ID.');return v;};
const same=(a,b)=>['dev','ino','size','mtimeMs','ctimeMs'].every(k=>a[k]===b[k]);
function mapInput(v,name,max=256){need(v===undefined||plain(v)&&Object.keys(v).length<=max,'CATALOGUE_DELIVERY_CONFIGURATION','Declare the complete '+name+' object.');return v??{};}
async function ordinary(path,size){need(await realpath(path)===path,'CATALOGUE_DELIVERY_INPUT','Select a canonical ordinary input file.');const f=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const s=await f.stat();need(s.isFile()&&(size===undefined||s.size===size),'CATALOGUE_DELIVERY_INPUT','The declared full file size changed.',409);}finally{await f.close();}}
async function verifyClosed(path,expected){
 const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const before=await fd.stat();need(before.isFile()&&before.size===expected.bytes&&await realpath(path)===path,'CATALOGUE_DELIVERY_INPUT_CHANGED','The retained original input changed.',409);
  const h=createHash('sha256'),buffer=Buffer.alloc(1024*1024);let offset=0;
  while(offset<before.size){const r=await fd.read(buffer,0,Math.min(buffer.length,before.size-offset),offset);need(r.bytesRead>0,'CATALOGUE_DELIVERY_INPUT_CHANGED','The retained input ended early.',409);h.update(buffer.subarray(0,r.bytesRead));offset+=r.bytesRead;}
  need(same(before,await fd.stat())&&h.digest('hex')===expected.sha256,'CATALOGUE_DELIVERY_INPUT_CHANGED','The exact retained input identity changed.',409);
 }finally{await fd.close();}
}
export async function readCatalogueDeliveryConfiguration(path){
 const source=await readJson(path,2*1024*1024),raw=source.value,base=dirname(source.path);
 exact(raw,['schema','workspaces'],['schema','workspaces']);
 need(raw.schema===CATALOGUE_DELIVERY_HOST_SCHEMA&&plain(raw.workspaces)&&Object.keys(raw.workspaces).length>=1&&Object.keys(raw.workspaces).length<=32,'CATALOGUE_DELIVERY_HOST','Declare one to32 existing original catalogue installations.');
 const workspaces=Object.create(null),seen=new Set(),connectionDirectories=new Map();
 for(const[name,v]of Object.entries(raw.workspaces)){
  alias(name);exact(v,['label','directory','connectionFile','inputs','producers','targets','credentials','destinations'],['directory','connectionFile']);
  const directory=absolute(resolve(base,v.directory)),connectionFile=absolute(resolve(base,v.connectionFile));
  await ownedDirectory(dirname(directory));await privateDirectory(dirname(connectionFile));
  try{await ownedDirectory(directory);}catch(e){if(e.code!=='ENOENT')throw e;}
  need(!inside(directory,connectionFile)&&connectionFile!==source.path&&(!connectionDirectories.has(connectionFile)||connectionDirectories.get(connectionFile)===directory),'CATALOGUE_DELIVERY_LAYOUT','Each generated connection belongs to one original workspace outside its exports.');
  const identity=canonical([directory,connectionFile]);need(!seen.has(identity),'CATALOGUE_DELIVERY_LAYOUT','Declare each original listener once.');seen.add(identity);connectionDirectories.set(connectionFile,directory);
  const inputs=Object.create(null),producers=Object.create(null),credentials=Object.create(null),targets=Object.create(null),destinations=Object.create(null);
  for(const[key,x]of Object.entries(mapInput(v.inputs,'inputs'))){
   alias(key);exact(x,['label','file','sha256','bytes','filename','mediaType'],['file','sha256','bytes','filename','mediaType']);
   digest(x.sha256);integer(x.bytes,'complete input bytes',MAX_FILE);const file=absolute(resolve(base,x.file));await ordinary(file,x.bytes);
   need(x.filename===basename(x.filename)&&x.filename.length>0&&x.filename.length<=240&&!/[\x00-\x1f\x7f\\]/.test(x.filename),'CATALOGUE_DELIVERY_FILENAME','Use a plain original input filename.');
   need(typeof x.mediaType==='string'&&x.mediaType.length>0&&x.mediaType.length<=200&&!/[\r\n]/.test(x.mediaType),'CATALOGUE_DELIVERY_MEDIA','Use the original media type.');
   inputs[key]={label:label(x.label,key),file,sha256:x.sha256,bytes:x.bytes,filename:x.filename,mediaType:x.mediaType};
  }
  for(const[key,x]of Object.entries(mapInput(v.producers,'producers'))){
   alias(key);exact(x,['label','csvPath','candidatePath','datasetPath'],['csvPath']);const item={label:label(x.label,key)};
   for(const field of ['csvPath','candidatePath','datasetPath'])if(x[field]!==undefined){item[field]=absolute(resolve(base,x[field]));await ownedDirectory(dirname(item[field]));try{await ordinary(item[field]);}catch(e){if(e.code!=='ENOENT')throw e;}}
   producers[key]=item;
  }
  for(const[key,x]of Object.entries(mapInput(v.credentials,'credential references',64))){
   alias(key);exact(x,['label','environment'],['environment']);
   need(typeof x.environment==='string'&&/^[A-Za-z_][A-Za-z0-9_]*$/.test(x.environment),'CATALOGUE_DELIVERY_ENVIRONMENT','Use an original declared service-token environment name.');
   credentials[key]={label:label(x.label,key),environment:x.environment};
  }
  for(const[key,x]of Object.entries(mapInput(v.targets,'destinations',256))){
   alias(key);exact(x,['label','config','credential'],['config','credential']);alias(x.credential);need(credentials[x.credential],'CATALOGUE_DELIVERY_CREDENTIAL','Select a declared environment reference.');
   exact(x.config,['base_url','package_id','resource_id','token_header','name','timeout_seconds','allow_local_http','download_origins'],['base_url','package_id','resource_id']);
   need(typeof x.config.base_url==='string'&&typeof x.config.package_id==='string'&&typeof x.config.resource_id==='string','CATALOGUE_DELIVERY_TARGET','Keep the full original CKAN target contract.');
   const u=new URL(x.config.base_url);need(!u.username&&!u.password&&!u.hash&&!u.search&&u.protocol==='https:'||x.config.allow_local_http===true&&u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname)&&!u.username&&!u.password&&!u.hash&&!u.search,'CATALOGUE_DELIVERY_TARGET','Select an HTTPS catalogue or an explicitly permitted loopback target.');
   targets[key]={label:label(x.label,key),config:x.config,credential:x.credential};
  }
  for(const[key,x]of Object.entries(mapInput(v.destinations,'fresh receiving destinations',64))){
   alias(key);exact(x,['label','directory'],['directory']);const output=absolute(resolve(base,x.directory));await privateDirectory(dirname(output));
   need(output!==directory&&!inside(directory,output)&&!inside(output,directory),'CATALOGUE_DELIVERY_DESTINATION','Receive into a separately declared directory, preserving the original workspace.');
   destinations[key]={label:label(x.label,key),directory:output};
  }
  workspaces[name]={label:label(v.label,name),directory,connectionFile,inputs,producers,credentials,targets,destinations};
 }
 const privateFiles=new Set([source.path,...Object.values(workspaces).map(x=>x.connectionFile)]);
 for(const scope of Object.values(workspaces)){
  for(const i of Object.values(scope.inputs))need(!privateFiles.has(i.file),'CATALOGUE_DELIVERY_SECRET_INPUT','Do not declare host or connection files as ordinary inputs.');
  for(const p of Object.values(scope.producers))for(const k of ['csvPath','candidatePath','datasetPath'])if(p[k])need(!privateFiles.has(p[k]),'CATALOGUE_DELIVERY_SECRET_INPUT','Producer paths must not select private configuration.');
 }
 return{configuration:source.path,sha256:source.sha256,workspaces};
}
export class MerchantCatalogueDeliveryWorkspaces{
 #config;#clients=new Map();#files;#requests;#tail=Promise.resolve();#pending=new Set();#closing=false;#closed=null;
 constructor(config){this.#config=config;this.#files=new CatalogueDeliveryFiles(config.exportsDirectory,{authorize:(name,selection)=>this.#authorize(name,selection)});this.#requests=new CatalogueDeliveryRequests(this.#files);}
 get summary(){return{configured:Boolean(this.#config.catalogueDelivery),connected:[...this.#clients.keys()],pending:this.#pending.size,closing:this.#closing,retainedReads:this.#files.summary};}
 #scope(name){const s=this.#config.catalogueDelivery?.workspaces?.[alias(name)];need(s,'CATALOGUE_DELIVERY_NOT_CONFIGURED','Choose a declared original catalogue workspace.',404);return{...s,alias:name};}
 #client(s){const c=this.#clients.get(s.alias);need(c,'CATALOGUE_DELIVERY_DISCONNECTED','Connect the original managed application.',409);return c;}
 #authority(s){const c=this.#client(s).connection;need(c.directory===s.directory&&typeof c.applicationDirectory==='string'&&typeof c.sourceManifestSha256==='string','CATALOGUE_DELIVERY_AUTHORITY','Select the original workspace and complete private source.',409);return{directory:c.directory,applicationDirectory:c.applicationDirectory,sourceManifestSha256:c.sourceManifestSha256};}
 async #access(s){await this.#client(s).info();return this.#authority(s);}
 async #authorize(name,selection){const s=this.#scope(name);need(selection?.access&&canonical(selection.access)===canonical(this.#authority(s)),'CATALOGUE_DELIVERY_RETAINED_AUTHORITY','This complete file belongs to another original workspace or source.',403);await this.#client(s).info();}
 #view(s){const c=this.#clients.get(s.alias);return{workspace:s.alias,label:s.label,state:c?'CONNECTED':'DISCONNECTED',...(c?c.connection:{}),
  inputs:Object.entries(s.inputs).map(([sourceInput,x])=>({sourceInput,label:x.label,sha256:x.sha256,bytes:x.bytes,filename:x.filename,mediaType:x.mediaType})),
  producers:Object.entries(s.producers).map(([producer,x])=>({producer,label:x.label})),targets:Object.entries(s.targets).map(([target,x])=>({target,label:x.label})),
  credentials:Object.entries(s.credentials).map(([credential,x])=>({credential,label:x.label,environment:x.environment})),destinations:Object.entries(s.destinations).map(([destination,x])=>({destination,label:x.label}))};}
 async #secrets(){
  const result=new Set([this.#config.catalogueDelivery.configuration]);
  for(const s of Object.values(this.#config.catalogueDelivery.workspaces)){
   result.add(s.connectionFile);
   try{
    const c=await readConnection(s.connectionFile,{directory:s.directory}),v=c.value;
    if(v.capabilityFile)result.add(absolute(v.capabilityFile));
    if(v.configurationFile){result.add(absolute(v.configurationFile));const launch=await readLaunchConfiguration(v.configurationFile);
     for(const x of Object.values(launch.value.environment??{}))result.add(absolute(x.file));}
   }catch(e){if(e.code!=='ENOENT')throw e;}
  }
  return result;
 }
 async #input(s,name,expected){
  const x=s.inputs[alias(name)];need(x,'CATALOGUE_DELIVERY_INPUT','Choose a declared complete source input.',404);need(!expected||digest(expected)===x.sha256,'CATALOGUE_DELIVERY_INPUT_SELECTION','Keep the original input hash.',409);
  need(!(await this.#secrets()).has(x.file),'CATALOGUE_DELIVERY_SECRET_INPUT','Private capabilities and service-token files cannot become retained input artifacts.',403);
  const access=await this.#access(s);
  const retained=await this.#files.capture(s.alias,{access,operation:'declared-input',sourceInput:name,sourceSha256:x.sha256},async sink=>{
   const fd=await open(x.file,constants.O_RDONLY|constants.O_NOFOLLOW);try{const before=await fd.stat();need(before.isFile()&&before.size===x.bytes&&await realpath(x.file)===x.file,'CATALOGUE_DELIVERY_INPUT_CHANGED','The complete selected input changed.',409);
    const h=createHash('sha256'),buffer=Buffer.alloc(1024*1024);let offset=0;
    while(offset<before.size){const r=await fd.read(buffer,0,Math.min(buffer.length,before.size-offset),offset);need(r.bytesRead>0,'CATALOGUE_DELIVERY_INPUT_TRUNCATED','The complete source ended early.',409);const b=buffer.subarray(0,r.bytesRead);h.update(b);await sink(b);offset+=b.length;}
    need(same(before,await fd.stat()),'CATALOGUE_DELIVERY_INPUT_CHANGED','The original source changed while copied.',409);
    return{bytes:offset,sha256:h.digest('hex'),filename:x.filename,mediaType:x.mediaType};
   }finally{await fd.close();}
  },x);
  const scoped=await this.#files.directory(s.alias),content=join(scoped,retained.sha256+'.content');
  const inputs=join(scoped,'inputs');await privateDirectory(inputs,{create:true});
  const selected=join(inputs,retained.sha256);await privateDirectory(selected,{create:true});
  const path=join(selected,x.filename);await verifyClosed(content,retained);
  try{await link(content,path);const parent=await open(selected,'r');try{await parent.sync();}finally{await parent.close();}}
  catch(e){if(e.code!=='EEXIST')throw e;}
  await verifyClosed(path,retained);
  return{...retained,path};
 }
 async #response(s,response,operation,extra={}){
  const body=response.body??(Buffer.isBuffer(response.bytes)?response.bytes:null);
  need(Buffer.isBuffer(body)&&body.length===(typeof response.bytes==='number'?response.bytes:body.length)&&hash(body)===response.sha256,'CATALOGUE_DELIVERY_RESPONSE','Retain the exact original response body and complete digest.',409);
  const access=this.#authority(s),retained=await this.#files.retain(s.alias,{...response,bytes:body},{access,operation,...extra});
  return{...retained,ok:response.ok,status:response.status,originalOutcome:'HTTP_OBSERVED'};
 }
 async #invoke(s,operation,requestId,intent,send,{safeReplay=false,source=null}={}){
  const access=await this.#access(s),record=await this.#requests.prepare(s.alias,access,operation,requestId,intent,source);
  const old=await this.#requests.observations(record);
  if(old.length){const selected=old.find(row=>row.ok===true&&row.responseFile)??(!safeReplay?(old.find(row=>row.responseFile)??old[0]):null);if(selected?.responseFile)return{...selected.responseFile,workspace:s.alias,requestId,state:'HTTP_OBSERVED',ok:selected.ok,status:selected.originalStatus,replayed:true,observations:old,originalRequest:record.originalRequest};}
  const dispatch=await this.#requests.begin(record,{operation,selection:intent});
  if(!dispatch.fresh&&!safeReplay)return{workspace:s.alias,requestId,state:'DISPATCH_UNCERTAIN',originalRequest:record.originalRequest,dispatch:dispatch.value,
   recovery:'Inspect the original saved job/review/implementation and native operation. A missing response is not permission to repeat this request. Use the explicit original reconciliation operation where available.'};
  const response=await send(),retained=await this.#response(s,response,operation,{requestId,requestKey:record.key});
  await this.#requests.confirm(record,response,retained);
  return{...retained,requestId,originalRequest:record.originalRequest,replayed:!dispatch.fresh};
 }
 async #credential(s,name){const c=s.credentials[alias(name)];need(c,'CATALOGUE_DELIVERY_CREDENTIAL','Choose a declared service credential reference.',404);const info=await this.#client(s).info();need(info.value?.environmentNames?.includes(c.environment),'CATALOGUE_DELIVERY_CREDENTIAL','This token reference is not declared by the original managed process.',403);return c.environment;}
 async #producer(s,name){
  const p=s.producers[alias(name)];need(p,'CATALOGUE_DELIVERY_PRODUCER','Choose the complete declared mutable producer.',404);
  const denied=await this.#secrets(),out={};
  for(const [key,field]of [['csvPath','csv_path'],['candidatePath','candidate_path'],['datasetPath','dataset_path']])if(p[key]){need(!denied.has(p[key]),'CATALOGUE_DELIVERY_SECRET_INPUT','A producer cannot read private host credentials.',403);out[field]=p[key];}
  return out;
 }
 async #destination(s,name){const d=s.destinations[alias(name)];need(d,'CATALOGUE_DELIVERY_DESTINATION','Choose a declared receiving destination.',404);const c=this.#client(s).connection;
  need(!inside(c.applicationDirectory,d.directory)&&!inside(d.directory,c.applicationDirectory),'CATALOGUE_DELIVERY_DESTINATION','Keep private source and receiving outputs separate.');
  await privateDirectory(dirname(d.directory));return d.directory;
 }
 async #native(s,suffix,args){
  const d=definitions.get(suffix);const{workspace,requestId,...a}=args;let source=null;
  if(suffix==='import_source'){
   source=await this.#input(s,a.sourceInput,a.expectedSourceSha256);const candidate=a.candidateInput?await this.#input(s,a.candidateInput):null,dataset=a.datasetInput?await this.#input(s,a.datasetInput):null;
   for(const k of Object.keys(a))delete a[k];a.csv_path=source.path;if(candidate)a.candidate_path=candidate.path;if(dataset)a.dataset_path=dataset.path;
  }else if(suffix==='add_target'){const t=s.targets[alias(a.target)];need(t,'CATALOGUE_DELIVERY_TARGET','Choose a declared original target.',404);delete a.target;a.config={...t.config,token_env:await this.#credential(s,t.credential)};}
  else if(suffix==='approval_add_profile'){a.token_env=await this.#credential(s,a.credential);delete a.credential;}
  else if(['configure_feed','replace_feed'].includes(suffix)){const paths=await this.#producer(s,a.producer);delete a.producer;
   need(plain(a.config)&&!['csv_path','candidate_path','dataset_path'].some(k=>Object.hasOwn(a.config,k)),'CATALOGUE_DELIVERY_PRODUCER','Only the declared producer selects source paths.');a.config={...a.config,...paths};}
  else if(suffix==='approval_restore'){source=await this.#input(s,a.sourceInput,a.expectedSourceSha256);const destination=await this.#destination(s,a.destination);for(const k of Object.keys(a))delete a[k];a.archive_path=source.path;a.destination=destination;}
  const call=()=>this.#client(s).call('catalogue_'+suffix,a);
  if(d.read)return this.#response(s,await call(),'catalogue_'+suffix);
  const safeReplay=['import_source','queue_delivery','approval_request','approval_decide','approval_retry'].includes(suffix);
  return this.#invoke(s,'catalogue_'+suffix,requestId,{name:'catalogue_'+suffix,arguments:a},call,{safeReplay,source});
 }
 async #artifact(s,a){
  const access=await this.#access(s);need(Boolean(a.uri)!==Boolean(a.route),'CATALOGUE_DELIVERY_ARTIFACT','Select either an original catalogue URI or an original returned HTTP download route.');
  if(a.uri){
   const response=await this.#client(s).call('catalogue_artifact_info',{uri:a.uri});if(response.ok===false)return this.#response(s,response,'native-artifact-error',{uri:a.uri});
   const d=response.value;digest(d.sha256);integer(d.bytes,'complete artifact bytes',MAX_FILE);
   let retainedError;const stopCapture=new Error('Original artifact response retained.');
   try{return await this.#files.capture(s.alias,{access,operation:'native-artifact',uri:a.uri},async sink=>{
    let offset=0;const h=createHash('sha256');
    while(offset<d.bytes){
     const result=await this.#client(s).call('catalogue_download_chunk',{uri:a.uri,offset,length:196608,expected_sha256:d.sha256});
     if(result.ok===false){retainedError=await this.#response(s,result,'native-artifact-range-error',{uri:a.uri,offset});throw stopCapture;}
     const v=result.value,b=Buffer.from(v.data,'base64');
     need(v.encoding==='base64'&&typeof v.data==='string'&&b.toString('base64')===v.data&&v.length===b.length&&v.offset===offset&&v.sha256===d.sha256&&v.bytes===d.bytes&&hash(b)===v.chunk_sha256&&b.length>0&&offset+b.length<=d.bytes&&v.next_offset===offset+b.length,'CATALOGUE_DELIVERY_ARTIFACT_RANGE','The original range does not match its complete selected artifact.',409);
     h.update(b);await sink(b);offset+=b.length;need(v.eof===(offset===d.bytes),'CATALOGUE_DELIVERY_ARTIFACT_RANGE','The native range EOF differs.',409);
    }
    return{bytes:offset,sha256:h.digest('hex'),filename:d.filename,mediaType:d.mimeType};
   },{sha256:a.expectedSha256??d.sha256,bytes:a.expectedBytes??d.bytes,filename:a.filename??d.filename});}catch(e){if(e===stopCapture)return retainedError;throw e;}
  }
  let retainedError;const stopCapture=new Error('Original HTTP artifact response retained.');
  try{return await this.#files.capture(s.alias,{access,operation:'http-artifact',route:a.route,query:a.query??{}},async sink=>{
   const response=await this.#client(s).download(a.route,{query:a.query??{},sink});
   if(response.ok===false){retainedError=await this.#response(s,response,'http-artifact-error',{route:a.route,query:a.query??{}});throw stopCapture;}
   return response;
  },{sha256:a.expectedSha256,bytes:a.expectedBytes,filename:a.filename});}catch(e){if(e===stopCapture)return retainedError;throw e;}
 }
 async #implementation(s,suffix,a){
  if(suffix==='implementation_receive'){
   const source=await this.#input(s,a.sourceInput,a.expectedSourceSha256),destination=await this.#destination(s,a.destination);
   return this.#invoke(s,suffix,a.requestId,{archivePath:source.path,destination},()=>this.#client(s).implementationReceive({archivePath:source.path,destination}),{source});
  }
  if(suffix==='implementation_read'){
   const kind=a.kind;
   if(kind==='inspect'){const source=await this.#input(s,a.profileInput,a.expectedSourceSha256);need(source.bytes<=MAX_JSON,'CATALOGUE_DELIVERY_PROFILE','The original profile exceeds the JSON limit.');const body=(await readJson(source.path,MAX_JSON)).value;return this.#response(s,await this.#client(s).invoke('/api/implementations/inspect',body),suffix);}
   need(['template','list','get','deployment'].includes(kind),'CATALOGUE_DELIVERY_IMPLEMENTATION','Choose the original implementation view.');
   const route=kind==='template'?'/api/implementation-template':kind==='list'?'/api/implementations':'/api/implementations/'+recordId(a.implementationId)+(kind==='deployment'?'/deployment':'');
   return this.#response(s,await this.#client(s).read(route,{}),suffix);
  }
  let route,body,source=null;
  if(a.action==='prepare'){source=await this.#input(s,a.profileInput,a.expectedSourceSha256);need(source.bytes<=MAX_JSON,'CATALOGUE_DELIVERY_PROFILE','The original profile exceeds the JSON limit.');body=(await readJson(source.path,MAX_JSON)).value;route='/api/implementations';}
  else{route='/api/implementations/'+recordId(a.implementationId)+'/'+a.action;body=a.payload??{};need(plain(body),'CATALOGUE_DELIVERY_IMPLEMENTATION','Use the exact original action payload.');}
  return this.#invoke(s,suffix,a.requestId,{route,body},()=>this.#client(s).invoke(route,body),{safeReplay:a.action==='prepare',source});
 }
 async #call(name,args){
  const schema=schemas.get(name);need(schema,'CATALOGUE_DELIVERY_TOOL','Choose an installed Catalogue tool.',404);exact(args,Object.keys(schema.properties),schema.required);
  const suffix=name.slice('merchant_catalogue_'.length);
  if(suffix==='connections'&&!args.workspace)return{workspaces:Object.keys(this.#config.catalogueDelivery?.workspaces??{}).map(n=>this.#view(this.#scope(n)))};
  const s=this.#scope(args.workspace);
  if(suffix==='connections')return this.#view(s);
  if(suffix==='connect'){if(this.#clients.has(s.alias)){await this.#client(s).info();if(args.expectedLaunchId)need(this.#client(s).connection.launchId===args.expectedLaunchId,'CATALOGUE_DELIVERY_LAUNCH','The selected managed launch changed.',409);return this.#view(s);}
   const c=await CatalogueDeliveryClient.connect(s.connectionFile,{directory:s.directory,expectedLaunchId:args.expectedLaunchId});this.#clients.set(s.alias,c);return this.#view(s);}
  if(suffix==='disconnect'){const c=this.#client(s);need(c.connection.launchId===args.launchId,'CATALOGUE_DELIVERY_LAUNCH','Disconnect only the selected original client.',409);await c.close();await this.#files.disconnect(s.alias);this.#clients.delete(s.alias);return this.#view(s);}
  if(definitions.has(suffix))return this.#native(s,suffix,args);
  if(suffix==='info')return this.#response(s,await this.#client(s).info(),suffix);
  if(suffix==='catalogue')return this.#response(s,await this.#client(s).catalogue(),suffix);
  if(suffix==='browser'){await this.#access(s);return this.#client(s).browser(args.view);}
  if(suffix==='files'){await this.#access(s);return this.#files.list(s.alias,args);}
  if(suffix==='file')return this.#files.read(s.alias,args);
  if(suffix==='file_release')return this.#files.release(s.alias,args.readId);
  if(suffix==='file_inspect')return this.#files.inspect(s.alias,args);
  if(suffix==='requests'){const access=await this.#access(s);return this.#requests.list(s.alias,args,access);}
  if(suffix==='artifact')return this.#artifact(s,args);
  if(suffix.startsWith('implementation_'))return this.#implementation(s,suffix,args);
  need(false,'CATALOGUE_DELIVERY_TOOL','Unknown installed operation.',404);
 }
 call(name,args={}){
  need(!this.#closing,'CATALOGUE_DELIVERY_CLOSING','Wait for the original attached client to close.',409);
  const run=this.#tail.then(()=>this.#call(name,args));this.#tail=run.catch(()=>{});this.#pending.add(run);run.finally(()=>this.#pending.delete(run)).catch(()=>{});return run;
 }
 close(){
  if(this.#closed)return this.#closed;this.#closing=true;
  this.#closed=(async()=>{await Promise.allSettled([...this.#pending]);for(const[name,c]of this.#clients){await c.close();await this.#files.disconnect(name);this.#clients.delete(name);}await this.#files.close();})();
  this.#closed=this.#closed.catch(e=>{this.#closed=null;throw e;});return this.#closed;
 }
}

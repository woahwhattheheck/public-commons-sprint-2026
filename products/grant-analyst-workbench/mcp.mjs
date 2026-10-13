// SPDX-License-Identifier: MIT
// Complete original grant, learning and commissioned-study operations; no replacement analysis engine.
import {constants} from 'node:fs';
import {open,realpath,link} from 'node:fs/promises';
import {dirname,resolve,basename,join} from 'node:path';
import {createHash} from 'node:crypto';
import {grantAnalystTools,ACTIONS,READ_KINDS,ARTIFACT_KINDS} from './tools.mjs';
import {GrantAnalystFiles,present} from './files.mjs';
import {GrantAnalystRequests,canonical} from './requests.mjs';
import {GrantAnalystClient,need,plain,exact,absolute,identifier,digest,integer,hash,readJson,readFile,readConnection,readLaunchConfiguration,privateDirectory,ownedDirectory,inside,MAX_JSON,MAX_FILE} from './connection.mjs';
export const GRANT_ANALYST_HOST_SCHEMA='stellar-forge.grant-analyst-host.v1';
const schemas=new Map(grantAnalystTools((name,description,properties,required)=>({name,properties,required})).map(x=>[x.name,x]));
const alias=v=>{need(typeof v==='string'&&/^[a-z0-9][a-z0-9_-]{0,63}$/.test(v),'GRANT_ANALYST_ALIAS','Choose a declared host alias.');return v;};
const label=(v,f)=>{v=v??f;need(typeof v==='string'&&v.length>0&&v.length<=240&&!/[\x00-\x1f\x7f]/.test(v),'GRANT_ANALYST_LABEL','Use a readable label.');return v;};
const same=(a,b)=>['dev','ino','size','mtimeMs','ctimeMs'].every(k=>a[k]===b[k]);
function mapInput(v,name,max=256){need(v===undefined||plain(v)&&Object.keys(v).length<=max,'GRANT_ANALYST_CONFIGURATION','Declare the complete '+name+' object.');return v??{};}
async function ordinary(path,size){need(await realpath(path)===path,'GRANT_ANALYST_INPUT','Select a canonical ordinary input file.');const f=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const s=await f.stat();need(s.isFile()&&(size===undefined||s.size===size),'GRANT_ANALYST_INPUT','The declared full file size changed.',409);}finally{await f.close();}}
async function verifyClosed(path,expected){
 const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const before=await fd.stat();need(before.isFile()&&before.size===expected.bytes&&await realpath(path)===path,'GRANT_ANALYST_INPUT_CHANGED','The retained original input changed.',409);
  const h=createHash('sha256'),buffer=Buffer.alloc(1024*1024);let offset=0;
  while(offset<before.size){const r=await fd.read(buffer,0,Math.min(buffer.length,before.size-offset),offset);need(r.bytesRead>0,'GRANT_ANALYST_INPUT_CHANGED','The retained input ended early.',409);h.update(buffer.subarray(0,r.bytesRead));offset+=r.bytesRead;}
  need(same(before,await fd.stat())&&h.digest('hex')===expected.sha256,'GRANT_ANALYST_INPUT_CHANGED','The exact retained input identity changed.',409);
 }finally{await fd.close();}
}

async function ownedAncestor(path){
 path=absolute(path);
 for(;;){
  try{return await ownedDirectory(path);}
  catch(e){if(e.code!=='ENOENT')throw e;const parent=dirname(path);need(parent!==path,'GRANT_ANALYST_LAYOUT','A declared workspace needs an existing owned canonical ancestor.');path=parent;}
 }
}

export async function readGrantAnalystConfiguration(path){
 const source=await readJson(path,2*1024*1024),raw=source.value,base=dirname(source.path);
 exact(raw,['schema','workspaces'],['schema','workspaces']);
 need(raw.schema===GRANT_ANALYST_HOST_SCHEMA&&plain(raw.workspaces)&&Object.keys(raw.workspaces).length>=1&&Object.keys(raw.workspaces).length<=32,'GRANT_ANALYST_HOST','Declare one to32 original analyst installations.');
 const workspaces=Object.create(null),seen=new Set(),connections=new Map();
 for(const[name,v]of Object.entries(raw.workspaces)){
  alias(name);exact(v,['label','directory','connectionFile','inputs','destinations'],['directory','connectionFile']);
  const directory=absolute(resolve(base,v.directory)),connectionFile=absolute(resolve(base,v.connectionFile));
  await ownedAncestor(dirname(directory));await privateDirectory(dirname(connectionFile));
  try{await ownedDirectory(directory);}catch(e){if(e.code!=='ENOENT')throw e;}
  need(!inside(directory,connectionFile)&&connectionFile!==source.path&&(!connections.has(connectionFile)||connections.get(connectionFile)===directory),'GRANT_ANALYST_LAYOUT','Keep each private live connection outside its original workspace.');
  const identity=canonical([directory,connectionFile]);need(!seen.has(identity),'GRANT_ANALYST_LAYOUT','Declare each original listener once.');seen.add(identity);connections.set(connectionFile,directory);
  const inputs=Object.create(null),destinations=Object.create(null);
  for(const[key,x]of Object.entries(mapInput(v.inputs,'complete inputs'))){
   alias(key);exact(x,['label','file','sha256','bytes','filename','mediaType'],['file','sha256','bytes','filename','mediaType']);
   digest(x.sha256);integer(x.bytes,'full input bytes',MAX_FILE);const file=absolute(resolve(base,x.file));await ordinary(file,x.bytes);
   need(typeof x.filename==='string'&&x.filename===basename(x.filename)&&x.filename.length>0&&x.filename.length<=240&&!/[\x00-\x1f\x7f\\]/.test(x.filename),'GRANT_ANALYST_FILENAME','Use the original plain input filename.');
   need(typeof x.mediaType==='string'&&x.mediaType.length>0&&x.mediaType.length<=150&&!/[\r\n]/.test(x.mediaType),'GRANT_ANALYST_MEDIA','Use the original MIME type.');
   inputs[key]={label:label(x.label,key),file,sha256:x.sha256,bytes:x.bytes,filename:x.filename,mediaType:x.mediaType};
  }
  for(const[key,x]of Object.entries(mapInput(v.destinations,'fresh receiving destinations',64))){
   alias(key);exact(x,['label','directory'],['directory']);const output=absolute(resolve(base,x.directory));await privateDirectory(dirname(output));
   need(!inside(directory,output)&&!inside(output,directory),'GRANT_ANALYST_DESTINATION','Receive into a separate declared directory and preserve the original workspace.');
   destinations[key]={label:label(x.label,key),directory:output};
  }
  workspaces[name]={label:label(v.label,name),directory,connectionFile,inputs,destinations};
 }
 const privateFiles=new Set([source.path,...Object.values(workspaces).map(x=>x.connectionFile)]);
 for(const s of Object.values(workspaces))for(const i of Object.values(s.inputs))need(!privateFiles.has(i.file),'GRANT_ANALYST_SECRET_INPUT','Host and connection files are not ordinary inputs.');
 return{configuration:source.path,sha256:source.sha256,workspaces};
}
const request=v=>{need(typeof v==='string'&&/^[A-Za-z0-9._:-]{1,180}$/.test(v),'GRANT_ANALYST_REQUEST','Use the original stable request ID.');return v;};
const readRoutes={state:['/api/state',[]],source:['/api/source',['edition']],report:['/api/report',['edition','search','offset','limit']],studies:['/api/studies',['study']],learning:['/api/learning',['cycle']],compare:['/api/compare',['baseline','candidate']],'study-release':['/api/study-release',['study','release','format']]};
const artifactRoutes={
 source:['/api/source',['edition']], 'report-json':['/_merchant/report',['edition']], 'report-csv':['/api/csv',['edition']],
 'learning-json':['/api/learning',['cycle']], 'learning-csv':['/api/learning-csv',[]], 'learning-markdown':['/api/learning-markdown',[]],
 'study-json':['/api/studies',['study']], 'study-document':['/api/study-document',['study','evidence','number']],
 'study-release-json':['/api/study-release',['study','release']], 'study-release-markdown':['/api/study-release',['study','release']], 'study-release-csv':['/api/study-release',['study','release']],
 handover:['/api/export',[]]};
function selectedQuery(kind,query,artifacts=false){
 const table=artifacts?artifactRoutes:readRoutes,item=table[kind];need(item,'GRANT_ANALYST_READ','Choose a declared original reader.',404);
 query=query??{};exact(query,item[1],[]);
 for(const[key,value]of Object.entries(query)){
  if(['offset','limit','number'].includes(key))integer(value,key,key==='limit'?200:Number.MAX_SAFE_INTEGER,key==='offset'?0:1);
  else need(typeof value==='string'&&value.length>0&&value.length<=4000,'GRANT_ANALYST_QUERY','Use the complete selected original query value.');
 }
 const required=kind==='compare'?['baseline','candidate']:['source','report','report-json','report-csv'].includes(kind)?['edition']:
 kind==='study-document'?['study','evidence']:kind.startsWith('study-release')?['study','release']:[];
 for(const key of required)need(Object.hasOwn(query,key),'GRANT_ANALYST_QUERY','Select '+key+'.');
 if(query.format!==undefined)need(['json','markdown','csv'].includes(query.format),'GRANT_ANALYST_QUERY','Select a native release format.');
 const out={...query};if(artifacts&&kind.startsWith('study-release-'))out.format=kind.slice('study-release-'.length);
 return{route:item[0],query:out};
}
export class MerchantGrantAnalystWorkspaces{
 #config;#clients=new Map();#files;#requests;#tail=Promise.resolve();#pending=new Set();#closing=false;#closed=null;
 constructor(config){this.#config=config;this.#files=new GrantAnalystFiles(config.exportsDirectory,{authorize:(name,selection)=>this.#authorize(name,selection)});this.#requests=new GrantAnalystRequests(this.#files);}
 get summary(){return{configured:Boolean(this.#config.grantAnalyst),connected:[...this.#clients.keys()],pending:this.#pending.size,closing:this.#closing,retainedReads:this.#files.summary};}
 #scope(name){const s=this.#config.grantAnalyst?.workspaces?.[alias(name)];need(s,'GRANT_ANALYST_NOT_CONFIGURED','Choose a declared analyst workspace.',404);return{...s,alias:name};}
 #client(s){const c=this.#clients.get(s.alias);need(c,'GRANT_ANALYST_DISCONNECTED','Connect the original managed analyst.',409);return c;}
 #authority(s){const c=this.#client(s).connection;need(c.directory===s.directory&&typeof c.workspaceId==='string'&&typeof c.applicationDirectory==='string'&&typeof c.sourceManifestSha256==='string','GRANT_ANALYST_AUTHORITY','Bind the original workspace and full private source.',409);return{directory:c.directory,workspaceId:c.workspaceId,applicationDirectory:c.applicationDirectory,sourceManifestSha256:c.sourceManifestSha256};}
 async #access(s){await this.#client(s).info();return this.#authority(s);}
 async #authorize(name,selection){const s=this.#scope(name);need(selection?.access&&canonical(selection.access)===canonical(this.#authority(s)),'GRANT_ANALYST_RETAINED_AUTHORITY','This retained file belongs to another original workspace or source.',403);await this.#client(s).info();}
 #view(s){const c=this.#clients.get(s.alias);return{workspace:s.alias,label:s.label,state:c?'CONNECTED':'DISCONNECTED',...(c?c.connection:{}),
  inputs:Object.entries(s.inputs).map(([sourceInput,x])=>({sourceInput,label:x.label,sha256:x.sha256,bytes:x.bytes,filename:x.filename,mediaType:x.mediaType})),
  destinations:Object.entries(s.destinations).map(([destination,x])=>({destination,label:x.label}))};}
 async #secrets(){
  const result=new Set([this.#config.grantAnalyst.configuration]);
  for(const s of Object.values(this.#config.grantAnalyst.workspaces)){
   result.add(s.connectionFile);
   try{const c=await readConnection(s.connectionFile,{directory:s.directory}),v=c.value;
    for(const key of ['capabilityFile','configurationFile','sourceManifestFile'])if(v[key])result.add(absolute(v[key]));
    if(v.configurationFile){const launch=await readLaunchConfiguration(v.configurationFile);if(launch.value.sourceManifestFile)result.add(absolute(launch.value.sourceManifestFile));}
   }catch(e){if(e.code!=='ENOENT')throw e;}
  }
  return result;
 }
 async #input(s,name,expected){
  const x=s.inputs[alias(name)];need(x,'GRANT_ANALYST_INPUT','Choose a declared complete source input.',404);need(!expected||digest(expected)===x.sha256,'GRANT_ANALYST_INPUT_SELECTION','Keep the original input hash.',409);
  need(!(await this.#secrets()).has(x.file),'GRANT_ANALYST_SECRET_INPUT','Private capabilities and service-token files cannot become retained input artifacts.',403);
  const access=await this.#access(s);
  const retained=await this.#files.capture(s.alias,{access,operation:'declared-input',sourceInput:name,sourceSha256:x.sha256},async sink=>{
   const fd=await open(x.file,constants.O_RDONLY|constants.O_NOFOLLOW);try{const before=await fd.stat();need(before.isFile()&&before.size===x.bytes&&await realpath(x.file)===x.file,'GRANT_ANALYST_INPUT_CHANGED','The complete selected input changed.',409);
    const h=createHash('sha256'),buffer=Buffer.alloc(1024*1024);let offset=0;
    while(offset<before.size){const r=await fd.read(buffer,0,Math.min(buffer.length,before.size-offset),offset);need(r.bytesRead>0,'GRANT_ANALYST_INPUT_TRUNCATED','The complete source ended early.',409);const b=buffer.subarray(0,r.bytesRead);h.update(b);await sink(b);offset+=b.length;}
    need(same(before,await fd.stat()),'GRANT_ANALYST_INPUT_CHANGED','The original source changed while copied.',409);
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
  need(Buffer.isBuffer(body)&&body.length===(typeof response.bytes==='number'?response.bytes:body.length)&&hash(body)===response.sha256,'GRANT_ANALYST_RESPONSE','Retain the exact original response body and complete digest.',409);
  const access=this.#authority(s),retained=await this.#files.retain(s.alias,{...response,bytes:body},{access,operation,...extra});
  return{...retained,ok:response.ok,status:response.status,originalOutcome:'HTTP_OBSERVED'};
 }
 async #invoke(s,operation,requestId,intent,send,{safeReplay=true,source=null}={}){
  const access=await this.#access(s),record=await this.#requests.prepare(s.alias,access,operation,requestId,intent,source);
  const old=await this.#requests.observations(record);
  if(old.length){const selected=old.find(row=>row.ok===true&&row.responseFile)??(!safeReplay?old.find(row=>row.responseFile):null);if(selected?.responseFile)return{...selected.responseFile,workspace:s.alias,requestId,state:'HTTP_OBSERVED',ok:selected.ok,status:selected.originalStatus,replayed:true,observations:old,originalRequest:record.originalRequest};}
  const dispatch=await this.#requests.begin(record,{operation,selection:intent});
  if(!dispatch.fresh&&!safeReplay)return{workspace:s.alias,requestId,state:'DISPATCH_UNCERTAIN',originalRequest:record.originalRequest,dispatch:dispatch.value,
   recovery:'Inspect the original saved job/review/implementation and native operation. A missing response is not permission to repeat this request. Use the explicit original reconciliation operation where available.'};
  const response=await send(),retained=await this.#response(s,response,operation,{requestId,requestKey:record.key});
  await this.#requests.confirm(record,response,retained);
  return{...retained,requestId,originalRequest:record.originalRequest,replayed:!dispatch.fresh};
 }

 async #destination(s,name){
  const d=s.destinations[alias(name)];need(d,'GRANT_ANALYST_DESTINATION','Choose a declared independent receiving destination.',404);
  const source=this.#client(s).connection.applicationDirectory;need(!inside(source,d.directory)&&!inside(d.directory,source),'GRANT_ANALYST_DESTINATION','Keep original source and received output separate.');
  await privateDirectory(dirname(d.directory));return d.directory;
 }
 async #mutation(s,action,requestId,payload,source=null){
  request(requestId);need(ACTIONS.includes(action)&&plain(payload),'GRANT_ANALYST_ACTION','Select one original action and its complete body.');
  need(!Object.hasOwn(payload,'requestId')&&!Object.hasOwn(payload,'sourceFile')&&!Object.hasOwn(payload,'documentFile'),'GRANT_ANALYST_ACTION','Use the selected stable request ID and declared original-file tools, not arbitrary file paths.');
  const body={...payload,requestId},bytes=Buffer.from(JSON.stringify(body));need(bytes.length<=MAX_JSON,'GRANT_ANALYST_ACTION_SIZE','The complete original HTTP action exceeds64MiB.',413);
  return this.#invoke(s,'mutation',requestId,{route:'/api/'+action,body},()=>this.#client(s).invoke('/api/'+action,body),{safeReplay:true,source});
 }
 async #action(s,suffix,a){
  if(suffix==='action')return this.#mutation(s,a.action,a.requestId,a.payload);
  const source=await this.#input(s,a.sourceInput,a.expectedSourceSha256);
  if(suffix==='receive'){const destination=await this.#destination(s,a.destination);
   return this.#invoke(s,'receive',request(a.requestId),{archivePath:source.path,destination},()=>this.#client(s).receiveWorkspace({archivePath:source.path,destination}),{safeReplay:true,source});}
  if(suffix==='action_input'){
   need(source.bytes<=MAX_JSON,'GRANT_ANALYST_ACTION_SIZE','The full action input exceeds64MiB.',413);
   const payload=(await readJson(source.path,MAX_JSON)).value;need(plain(payload),'GRANT_ANALYST_ACTION','Use a complete JSON action object.');
   if(Object.hasOwn(payload,'requestId')){need(payload.requestId===a.requestId,'GRANT_ANALYST_REQUEST','The complete input chooses another original request.',409);delete payload.requestId;}
   return this.#mutation(s,a.action,a.requestId,payload,source);
  }
  need(source.bytes<=32*1024*1024&&(suffix!=='evidence_document'||source.bytes>0),'GRANT_ANALYST_INPUT_SIZE','Original source and document bytes must fit the native32MiB bound.',413);
  const raw=(await readFile(source.path,32*1024*1024)).bytes;need(raw.length===source.bytes&&hash(raw)===source.sha256,'GRANT_ANALYST_INPUT_CHANGED','The exact closed original input changed.',409);
  if(suffix==='import_source')return this.#mutation(s,'import',a.requestId,{dataset:a.dataset,...(a.name===undefined?{}:{name:a.name}),...(a.sourceUrl===undefined?{}:{sourceUrl:a.sourceUrl}),base64:raw.toString('base64')},source);
  need(suffix==='evidence_document'&&plain(a.payload)&&!Object.hasOwn(a.payload,'document')&&(!Object.hasOwn(a.payload,'documentAction')||a.payload.documentAction==='replace'),'GRANT_ANALYST_DOCUMENT','Use this complete replacement document with the original study evidence body.');
  return this.#mutation(s,'study-evidence',a.requestId,{...a.payload,documentAction:'replace',document:{name:source.filename,mime:source.mediaType,base64:raw.toString('base64')}},source);
 }
 async #read(s,kind,query={}){const selection=selectedQuery(kind,query);return this.#response(s,await this.#client(s).read(selection.route,selection.query),'read',{kind,query:selection.query});}
 async #artifact(s,a){
  const selection=selectedQuery(a.kind,a.query,true),access=await this.#access(s);
  let rejected;
  try{return await this.#files.capture(s.alias,{access,operation:'original-artifact',kind:a.kind,...selection},
   async sink=>{const response=await this.#client(s).download(selection.route,{query:selection.query,sink});
    if(response.ok===false){rejected=await this.#response(s,response,'artifact-error',{kind:a.kind,...selection});throw new Error('Original artifact request returned an HTTP error.');}
    return response;},
   {sha256:a.expectedSha256,bytes:a.expectedBytes,filename:a.filename});}
  catch(error){if(rejected)return rejected;throw error;}
 }
 async #call(name,args){
  const schema=schemas.get(name);need(schema,'GRANT_ANALYST_TOOL','Choose an installed Grant Analyst tool.',404);exact(args,Object.keys(schema.properties),schema.required);
  const suffix=name.slice('merchant_grant_analyst_'.length);
  if(suffix==='connections'&&!args.workspace)return{workspaces:Object.keys(this.#config.grantAnalyst?.workspaces??{}).map(n=>this.#view(this.#scope(n)))};
  const s=this.#scope(args.workspace);
  if(suffix==='connections')return this.#view(s);
  if(suffix==='connect'){
   if(this.#clients.has(s.alias)){await this.#client(s).info();if(args.expectedLaunchId)need(this.#client(s).connection.launchId===args.expectedLaunchId,'GRANT_ANALYST_LAUNCH','The selected original launch changed.',409);return this.#view(s);}
   const client=await GrantAnalystClient.connect(s.connectionFile,{directory:s.directory,expectedLaunchId:args.expectedLaunchId});this.#clients.set(s.alias,client);return this.#view(s);
  }
  if(suffix==='disconnect'){const c=this.#client(s);need(c.connection.launchId===args.launchId,'GRANT_ANALYST_LAUNCH','Disconnect only the selected attachment.',409);await c.close();await this.#files.disconnect(s.alias);this.#clients.delete(s.alias);return this.#view(s);}
  if(suffix==='info')return this.#response(s,await this.#client(s).info(),suffix);
  if(suffix==='browser'){await this.#access(s);return this.#client(s).browser();}
  if(suffix==='state')return this.#response(s,await this.#client(s).read('/_merchant/state',{}),suffix);
  if(suffix==='read')return this.#read(s,args.kind,args.query);
  if(suffix==='report'){
   const q={edition:args.edition,...(args.search===undefined?{}:{search:args.search}),...(args.offset===undefined?{}:{offset:args.offset}),...(args.limit===undefined?{}:{limit:args.limit})};
   if(args.paged===true)return this.#read(s,'report',q);
   need(args.search===undefined&&args.offset===undefined&&args.limit===undefined,'GRANT_ANALYST_REPORT','Use paged:true for an explicit search or page; the default retains the full report.');
   selectedQuery('report',q);return this.#response(s,await this.#client(s).read('/_merchant/report',q),'full-report');
  }
  if(suffix==='compare')return this.#read(s,'compare',{baseline:args.baseline,candidate:args.candidate});
  if(suffix==='learning')return this.#read(s,'learning',args.cycle===undefined?{}:{cycle:args.cycle});
  if(suffix==='studies')return this.#read(s,'studies',args.study===undefined?{}:{study:args.study});
  if(['action','action_input','import_source','evidence_document','receive'].includes(suffix))return this.#action(s,suffix,args);
  if(suffix==='artifact')return this.#artifact(s,args);
  if(suffix==='files'){await this.#access(s);return this.#files.list(s.alias,args);}
  if(suffix==='file')return this.#files.read(s.alias,args);
  if(suffix==='file_release')return this.#files.release(s.alias,args.readId);
  if(suffix==='file_inspect')return this.#files.inspect(s.alias,args);
  if(suffix==='requests'){await this.#access(s);return this.#requests.list(s.alias,args,this.#authority(s));}
  need(false,'GRANT_ANALYST_TOOL','Unknown installed operation.',404);
 }
 call(name,args={}){
  need(!this.#closing,'GRANT_ANALYST_CLOSING','Wait for the original attached client to close.',409);
  const run=this.#tail.then(()=>this.#call(name,args));this.#tail=run.catch(()=>{});this.#pending.add(run);run.finally(()=>this.#pending.delete(run)).catch(()=>{});return run;
 }
 close(){
  if(this.#closed)return this.#closed;this.#closing=true;
  this.#closed=(async()=>{await Promise.allSettled([...this.#pending]);for(const[name,c]of this.#clients){await c.close();await this.#files.disconnect(name);this.#clients.delete(name);}await this.#files.close();})();
  this.#closed=this.#closed.catch(e=>{this.#closed=null;throw e;});return this.#closed;
 }
}

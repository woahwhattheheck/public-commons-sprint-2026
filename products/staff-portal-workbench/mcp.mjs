// SPDX-License-Identifier: MIT
// Attach to the unchanged private portal; original sessions and writers remain authoritative.
import {constants} from 'node:fs';
import {open,realpath} from 'node:fs/promises';
import {dirname,resolve,basename,join} from 'node:path';
import {createHash} from 'node:crypto';
import {staffPortalTools,READ_ROUTES,ARTIFACT_KINDS} from './tools.mjs';
import {StaffPortalFiles,present} from './files.mjs';
import {StaffPortalRequests,canonical} from './requests.mjs';
import {StaffPortalClient,need,plain,exact,absolute,identifier,digest,integer,hash,readJson,readFile,privateDirectory,ownedDirectory,inside,MAX_JSON,MAX_FILE,MAX_UPLOAD}
 from './connection.mjs';
export const STAFF_PORTAL_HOST_SCHEMA='stellar-forge.staff-portal-host.v1';
const schemas=new Map(staffPortalTools((name,description,properties,required)=>({name,properties,required})).map(x=>[x.name,x]));
const alias=v=>{need(typeof v==='string'&&/^[a-z0-9][a-z0-9_-]{0,63}$/.test(v),'STAFF_PORTAL_ALIAS','Choose a host-declared alias.');return v;};
const same=(a,b)=>['dev','ino','size','mtimeMs','ctimeMs'].every(k=>a[k]===b[k]);
const label=(v,fallback)=>{v=v??fallback;need(typeof v==='string'&&v.trim()===v&&v.length>0&&v.length<=240&&!/[\x00-\x1f\x7f]/.test(v),
 'STAFF_PORTAL_LABEL','Use a readable host label.');return v;};
export async function readStaffPortalConfiguration(path){
 const source=await readJson(path,1024*1024),raw=source.value,base=dirname(source.path);
 exact(raw,['schema','workspaces'],['schema','workspaces']);
 need(raw.schema===STAFF_PORTAL_HOST_SCHEMA&&plain(raw.workspaces)&&Object.keys(raw.workspaces).length>=1&&Object.keys(raw.workspaces).length<=32,
  'STAFF_PORTAL_HOST_CONFIGURATION','Declare one to32 original private Staff installations.');
 const workspaces=Object.create(null),connections=new Map(),bindings=new Set();
 for(const [name,v]of Object.entries(raw.workspaces)){
  alias(name);exact(v,['label','directory','connectionFile','inputs','nativeConnections'],['directory','connectionFile']);
  const directory=absolute(resolve(base,v.directory)),connectionFile=absolute(resolve(base,v.connectionFile));
  await ownedDirectory(dirname(directory));await privateDirectory(dirname(connectionFile));
  try{await ownedDirectory(directory);}catch(e){if(e.code!=='ENOENT')throw e;}
  need(!inside(directory,connectionFile)&&connectionFile!==source.path&&(!connections.has(connectionFile)||connections.get(connectionFile)===directory),
   'STAFF_PORTAL_HOST_LAYOUT','Keep each connection outside its one original workspace.');
  const binding=canonical([directory,connectionFile]);need(!bindings.has(binding),'STAFF_PORTAL_HOST_LAYOUT','Give each original staff portal attachment one alias.');
  connections.set(connectionFile,directory);bindings.add(binding);
  need(v.inputs===undefined||plain(v.inputs)&&Object.keys(v.inputs).length<=256,'STAFF_PORTAL_INPUTS','Declare at most256 complete original input files.');
  const inputs=Object.create(null);
  for(const [key,input]of Object.entries(v.inputs??{})){
   alias(key);exact(input,['label','file','sha256','bytes','filename','mediaType'],['file','sha256','bytes','filename','mediaType']);
   digest(input.sha256);integer(input.bytes,'complete input bytes',MAX_UPLOAD);
   const file=absolute(resolve(base,input.file));need(file!==connectionFile&&file!==source.path,'STAFF_PORTAL_HOST_LAYOUT','Keep full input files separate from private host/connection configuration.');
   need(await realpath(file)===file,'STAFF_PORTAL_INPUT_PATH','Select a canonical original regular file.');
   const fd=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
   try{const st=await fd.stat();need(st.isFile()&&st.size===input.bytes,'STAFF_PORTAL_INPUT_CHANGED','The complete declared input size changed.',409);}finally{await fd.close();}
   need(typeof input.filename==='string'&&input.filename===basename(input.filename)&&input.filename.length>0&&input.filename.length<=240&&!/[\x00-\x1f\x7f\\]/.test(input.filename),
    'STAFF_PORTAL_FILENAME','Use a plain original filename.');
   need(typeof input.mediaType==='string'&&input.mediaType.length>0&&input.mediaType.length<=200&&!/[\r\n]/.test(input.mediaType),'STAFF_PORTAL_MEDIA_TYPE','Use the original input media type.');
   inputs[key]={label:label(input.label,key),file,sha256:input.sha256,bytes:input.bytes,filename:input.filename,mediaType:input.mediaType};
  }
  const nativeConnections=Object.create(null);
  need(v.nativeConnections===undefined||plain(v.nativeConnections)&&Object.keys(v.nativeConnections).length<=32,'STAFF_PORTAL_NATIVE_CONFIGURATION','Declare at most32 native connection inputs.');
  for(const [key,native]of Object.entries(v.nativeConnections??{})){
   alias(key);exact(native,['label','origin','tokenFile'],['origin','tokenFile']);
   const parsed=new URL(native.origin);need(['http:','https:'].includes(parsed.protocol)&&parsed.origin===native.origin&&!parsed.username&&!parsed.password,'STAFF_PORTAL_NATIVE_ORIGIN','Use one exact original allowed origin.');
   const tokenFile=absolute(resolve(base,native.tokenFile));await privateDirectory(dirname(tokenFile));
   need(tokenFile!==source.path&&tokenFile!==connectionFile&&!Object.values(inputs).some(i=>i.file===tokenFile),'STAFF_PORTAL_SECRET_INPUT','Keep native token inputs separate from public input/download files.');
   const selected=await readJson(tokenFile,16384);exact(selected.value,['schema','token'],['schema','token']);
   need(selected.value.schema==='stellar-forge.staff-portal-native-secret.v1'&&typeof selected.value.token==='string'&&selected.value.token.length>0&&selected.value.token.length<=8192,'STAFF_PORTAL_NATIVE_SECRET','Supply the private native token envelope.');
   nativeConnections[key]={label:label(native.label,key),origin:native.origin,tokenFile};
  }
  workspaces[name]={label:label(v.label,name),directory,connectionFile,inputs,nativeConnections};
 }
 const secrets=new Set([source.path,...Object.values(workspaces).flatMap(v=>[v.connectionFile,...Object.values(v.nativeConnections).map(n=>n.tokenFile)])]);
 for(const v of Object.values(workspaces))for(const input of Object.values(v.inputs))need(!secrets.has(input.file),'STAFF_PORTAL_SECRET_INPUT','No declared ordinary input may select any private host, connection or native token file.');
 return{configuration:source.path,sha256:source.sha256,workspaces};
}

const nativeId=(v,label)=>{need(typeof v==='string'&&v.length>0&&v.length<=200&&!/[\x00-\x1f\x7f]/.test(v),'STAFF_PORTAL_ID','Use the original '+label+'.');return v;};
function query(value){need(plain(value)&&Object.keys(value).length<=40,'STAFF_PORTAL_QUERY','Use an original query object.');
 for(const[k,v]of Object.entries(value))need(k.length<=100&&['string','number','boolean'].includes(typeof v)&&String(v).length<=16384,'STAFF_PORTAL_QUERY','Use bounded original scalar query fields.');return value;}
function mutation(body){exact(body,['requestId','expectedRevision','action','payload'],['requestId','expectedRevision','action','payload']);
 nativeId(body.requestId,'request ID');nativeId(body.action,'action');integer(body.expectedRevision,'workspace revision');need(plain(body.payload),'STAFF_PORTAL_ACTION','Use the complete original payload.');
 need(Buffer.byteLength(JSON.stringify(body))<=MAX_JSON,'STAFF_PORTAL_REQUEST_SIZE','The original JSON request limit is8MiB.',413);return body;}
export class MerchantStaffPortalWorkspaces{
 #config;#clients=new Map();#files;#requests;#tail=Promise.resolve();#pending=new Set();#closing=false;#closed=null;
 constructor(config){this.#config=config;this.#files=new StaffPortalFiles(config.exportsDirectory,{authorize:(name,selection)=>this.#authorize(name,selection)});this.#requests=new StaffPortalRequests(this.#files);}
 get summary(){return{configured:Boolean(this.#config.staffPortal),connected:[...this.#clients.keys()],pending:this.#pending.size,closing:this.#closing,retainedReads:this.#files.summary};}
 #scope(name){const value=this.#config.staffPortal?.workspaces?.[alias(name)];need(value,'STAFF_PORTAL_NOT_CONFIGURED','Choose a declared staff portal installation.',404);return{...value,alias:name};}
 #client(scope){const c=this.#clients.get(scope.alias);need(c,'STAFF_PORTAL_DISCONNECTED','Connect the original managed portal.',409);return c;}
 #view(scope){const client=this.#clients.get(scope.alias);return{workspace:scope.alias,label:scope.label,state:client?'CONNECTED':'DISCONNECTED',...(client?client.connection:{}),
  inputs:Object.entries(scope.inputs).map(([sourceInput,v])=>({sourceInput,label:v.label,sha256:v.sha256,bytes:v.bytes,filename:v.filename,mediaType:v.mediaType})),
  nativeConnections:Object.entries(scope.nativeConnections).map(([nativeConnection,v])=>({nativeConnection,label:v.label,origin:v.origin}))};}
 #authority(scope){const c=this.#client(scope).connection;need(c.directory===scope.directory&&typeof c.applicationDirectory==='string'&&typeof c.sourceManifestSha256==='string'&&typeof c.actor==='string',
  'STAFF_PORTAL_AUTHORITY','Select the exact original portal directory, private source and operator.',409);return{directory:c.directory,applicationDirectory:c.applicationDirectory,sourceManifestSha256:c.sourceManifestSha256,actor:c.actor};}
 async #access(scope){await this.#client(scope).info();return this.#authority(scope);}
 async #authorize(name,selection){const scope=this.#scope(name);
  need(selection?.access&&canonical(selection.access)===canonical(this.#authority(scope)),'STAFF_PORTAL_RETAINED_AUTHORITY','This retained file belongs to another operator or private source.',403);
  await this.#client(scope).info();
 }
 async #selected(scope,workspaceId){nativeId(workspaceId,'workspace ID');const response=await this.#client(scope).session();
  need(response.ok!==false&&response.value?.authenticated&&response.value.workspaceId===workspaceId,'STAFF_PORTAL_WORKSPACE_SELECTION','Select the intended original workspace before this operation.',409);
  return workspaceId;
 }
 async #retain(scope,response,selection,record=null){
  selection={...selection,access:record?.access??await this.#access(scope)};
  let retained,retentionFailure=null,confirmationFailure=null;
  try{retained=await this.#files.retain(scope.alias,response,selection);}catch(e){if(!record)throw e;retentionFailure={code:e.code??'STAFF_PORTAL_RETENTION',message:'The original HTTP response arrived; preserve its exact request and recover its full native outcome.'};}
  if(record)try{await this.#requests.confirm(record,response,retained);}catch(e){confirmationFailure={code:e.code??'STAFF_PORTAL_OBSERVATION',message:'The complete selected request remains retained.'};}
  return{workspace:scope.alias,...(retained??{sha256:response.sha256,bytes:response.bytes.length,value:present(response.value)}),ok:response.ok??response.status<400,originalStatus:response.status,
   ...(record?{requestId:record.requestId,originalOutcome:'HTTP_OBSERVED',originalRequest:record.originalRequest}:{}),...(retentionFailure?{retentionFailure}:{}),...(confirmationFailure?{confirmationFailure}:{})};
 }
 async #mutation(scope,operation,requestId,intent,dispatch,source=null){
  nativeId(requestId,'request ID');need(Buffer.byteLength(JSON.stringify(intent))<=MAX_JSON+65536,'STAFF_PORTAL_REQUEST_SIZE','Select an original bounded request.',413);
  const access=await this.#access(scope),record=await this.#requests.prepare(scope.alias,access,operation,requestId,intent,source);
  let response;try{response=await dispatch();}catch(e){e.details={...e.details,requestId:record.requestId,originalRequest:record.originalRequest,
   recovery:'Retain this exact source, operator, workspace and request. Read the original operation response or deliberately replay only its documented idempotent route.'};throw e;}
  return this.#retain(scope,response,{operation,workspaceId:intent.workspaceId,requestId},record);
 }
 async #input(scope,args){
  const input=scope.inputs[alias(args.sourceInput)];digest(args.expectedSourceSha256);
  need(input&&input.sha256===args.expectedSourceSha256,'STAFF_PORTAL_INPUT_SELECTION','Choose the complete declared source and exact SHA-256.',409);
  const access=await this.#access(scope);
  for(const selected of Object.values(this.#config.staffPortal.workspaces)){
   let connection;try{connection=(await readJson(selected.connectionFile,65536)).value;}catch(e){if(e.code!=='ENOENT')throw e;}
   need(!connection?.capabilityFile||absolute(connection.capabilityFile)!==input.file,'STAFF_PORTAL_SECRET_INPUT','A private application access-key file cannot be retained as an ordinary source input.',403);
  }
  const retained=await this.#files.capture(scope.alias,{operation:'host-input',sourceInput:args.sourceInput,access},async sink=>{
   need(await realpath(input.file)===input.file,'STAFF_PORTAL_INPUT_CHANGED','The original input path changed.',409);
   const fd=await open(input.file,constants.O_RDONLY|constants.O_NOFOLLOW),buffer=Buffer.alloc(1024*1024),h=createHash('sha256');let at=0;
   try{const before=await fd.stat();need(before.isFile()&&before.size===input.bytes,'STAFF_PORTAL_INPUT_CHANGED','The declared full input size changed.',409);
    while(at<before.size){const r=await fd.read(buffer,0,Math.min(buffer.length,before.size-at),at);need(r.bytesRead>0,'STAFF_PORTAL_INPUT_CHANGED','The original input ended early.',409);
     const bytes=buffer.subarray(0,r.bytesRead);h.update(bytes);await sink(bytes);at+=r.bytesRead;}
    const sha256=h.digest('hex');need(same(before,await fd.stat())&&sha256===input.sha256,'STAFF_PORTAL_INPUT_CHANGED','The original complete source changed.',409);
    return{sha256,bytes:at,filename:input.filename,contentType:input.mediaType};
   }finally{await fd.close();}
  },{sha256:input.sha256,bytes:input.bytes,filename:input.filename});
  return{retained,path:join(await this.#files.directory(scope.alias),retained.sha256+'.content'),identity:{sha256:input.sha256,bytes:input.bytes}};
 }

 async #capture(scope,args){
  await this.#selected(scope,args.workspaceId);nativeId(args.runId,'run ID');nativeId(args.requestId,'request ID');
  const client=this.#client(scope),access=await this.#access(scope),intent={workspaceId:args.workspaceId,route:'/api/insights/capture',body:{runId:args.runId}};
  const record=await this.#requests.prepare(scope.alias,access,'native_capture',args.requestId,intent);
  const current=await client.state({workspaceId:args.workspaceId});
  need(current.ok!==false,'STAFF_PORTAL_NATIVE_STATE','Read the selected original run before capture.',409);
  const run=current.value?.thoughtfarmerInsights?.runs?.find(r=>r.id===args.runId);need(run,'STAFF_PORTAL_NATIVE_RUN','Select an actual retained original native run.',404);
  const before={workspaceId:args.workspaceId,runId:args.runId,runSha256:hash(canonical(run)),run};
  const begun=await this.#requests.begin(record,before);
  if(!begun.fresh){
   const observed=await this.#requests.observations(record),complete=observed.filter(o=>o.responseFile);
   if(complete.length)return{workspace:scope.alias,requestId:record.requestId,originalOutcome:'HTTP_OBSERVED',originalRequest:record.originalRequest,observations:complete,replayed:true};
   const changed=hash(canonical(run))!==begun.value.before.runSha256;
   const after=await this.#retain(scope,current,{operation:'native_capture_recovery',workspaceId:args.workspaceId,requestId:record.requestId});
   return{workspace:scope.alias,requestId:record.requestId,originalOutcome:'DISPATCH_UNCERTAIN',originalRequest:record.originalRequest,
    before:present(begun.value.before),current:after,runChanged:changed,
    recovery:'This original capture is not repeated. Inspect complete current run, response objects and original request; a later capture requires a distinct deliberate host request.'};
  }
  let response;try{response=await client.invoke('/api/insights/capture',{runId:args.runId},{workspaceId:args.workspaceId});}
  catch(e){e.details={...e.details,requestId:record.requestId,originalRequest:record.originalRequest,recovery:'Do not repeat this native exchange. Call the same capture request to read recovery evidence, then inspect the original run.'};throw e;}
  return this.#retain(scope,response,{operation:'native_capture',workspaceId:args.workspaceId,requestId:record.requestId},record);
 }
 async #dispatch(name,args){
  const schema=schemas.get(name);need(schema,'STAFF_PORTAL_TOOL','Choose a declared staff portal tool.');exact(args,Object.keys(schema.properties),schema.required);
  const suffix=name.slice('merchant_staff_portal_'.length);
  if(suffix==='status'&&args.workspace===undefined)return{...this.summary,workspaces:Object.entries(this.#config.staffPortal?.workspaces??{}).map(([name,v])=>this.#view({...v,alias:name}))};
  const scope=this.#scope(args.workspace);
  if(suffix==='status')return this.#view(scope);
  if(suffix==='connect'){
   const old=this.#clients.get(scope.alias);
   if(old){need(args.expectedLaunchId===undefined||old.connection.launchId===args.expectedLaunchId,'STAFF_PORTAL_LAUNCH_CHANGED','Disconnect the selected original client before another launch.',409);await old.info();return this.#view(scope);}
   const client=await StaffPortalClient.connect(scope.connectionFile,{directory:scope.directory,expectedLaunchId:args.expectedLaunchId});
   this.#clients.set(scope.alias,client);return{...this.#view(scope),native:await this.#retain(scope,await client.info(),{operation:'info'})};
  }
  if(suffix==='disconnect'){
   const client=this.#clients.get(scope.alias);need(!client||client.connection.launchId===args.launchId,'STAFF_PORTAL_LAUNCH_CHANGED','Disconnect the exact original launch.',409);
   await client?.close();await this.#files.disconnect(scope.alias);this.#clients.delete(scope.alias);return{workspace:scope.alias,launchId:args.launchId,state:'DISCONNECTED'};
  }
  const client=this.#client(scope),{workspace,...input}=args;
  if(suffix==='files')return this.#files.list(scope.alias,input);
  if(suffix==='file')return this.#files.read(scope.alias,input);
  if(suffix==='file_release'){await this.#files.release(scope.alias,args.readId);return{workspace:scope.alias,readId:args.readId,released:true};}
  if(suffix==='inspect')return this.#files.inspect(scope.alias,input);
  if(suffix==='requests'){const access=await this.#access(scope),value=await this.#requests.list(scope.alias,input);
   need(value.requests.every(r=>canonical(r.access)===canonical(access)),'STAFF_PORTAL_REQUEST_AUTHORITY','The retained request belongs to another original authority.',403);return value;}
  if(suffix==='info')return this.#retain(scope,await client.info(),{operation:'info'});
  if(suffix==='workspaces')return this.#retain(scope,await client.workspaces(),{operation:'workspaces'});
  if(suffix==='browser')return{workspace:scope.alias,...await client.browser(args.view)};
  if(suffix==='select'){nativeId(args.workspaceId,'workspace ID');return this.#retain(scope,await client.select(args.workspaceId),{operation:'select',workspaceId:args.workspaceId});}
  if(suffix==='create'||suffix==='receive'){
   nativeId(args.workspaceId,'origin workspace ID');nativeId(args.requestId,'request ID');
   const route=suffix==='create'?'/api/workspaces':'/api/receive';
   if(suffix==='receive')digest(args.objectSha256);else need(typeof args.name==='string'&&args.name.trim().length>0&&args.name.length<=1000,'STAFF_PORTAL_NAME','Use an original workspace name.');
   const body=suffix==='create'?{name:args.name,requestId:args.requestId}:{objectSha256:args.objectSha256,requestId:args.requestId};
   return this.#mutation(scope,suffix,args.requestId,{workspaceId:args.workspaceId,route,body},()=>client.invoke(route,body,{workspaceId:args.workspaceId}));
  }
  await this.#selected(scope,args.workspaceId);
  switch(suffix){
   case'state':return this.#retain(scope,await client.state({workspaceId:args.workspaceId}),{operation:'state',workspaceId:args.workspaceId});
   case'read':need(Object.hasOwn(READ_ROUTES,args.route),'STAFF_PORTAL_READ','Choose a declared original read.');return this.#retain(scope,await client.read(READ_ROUTES[args.route],query(args.query),{workspaceId:args.workspaceId}),{operation:'read',workspaceId:args.workspaceId,route:args.route,query:args.query});
   case'action':{const body=mutation(args.body);return this.#mutation(scope,'action',body.requestId,{workspaceId:args.workspaceId,route:'/api/mutate',body},()=>client.invoke('/api/mutate',body,{workspaceId:args.workspaceId}));}
   case'operation':need(['mutate','upload'].includes(args.kind)&&plain(args.request),'STAFF_PORTAL_OPERATION','Use the exact original mutation/upload request.');
    return this.#retain(scope,await client.invoke('/api/portal/operation',{kind:args.kind,request:args.request},{workspaceId:args.workspaceId}),{operation:'operation',workspaceId:args.workspaceId,kind:args.kind,request:args.request});
   case'upload_input':{
    const selected=await this.#input(scope,args),input=scope.inputs[args.sourceInput],body={requestId:args.requestId,sha256:input.sha256,bytes:input.bytes,name:input.filename,contentType:input.mediaType};
    return this.#mutation(scope,'upload',args.requestId,{workspaceId:args.workspaceId,route:'/api/upload',body},
     ()=>client.upload({path:selected.path,...body},{workspaceId:args.workspaceId}),selected.retained);
   }
   case'native_connection':return this.#retain(scope,await client.read('/api/insights/connection',{}, {workspaceId:args.workspaceId}),{operation:'native_connection',workspaceId:args.workspaceId});
   case'native_connect':{
    const native=scope.nativeConnections[alias(args.nativeConnection)];need(native,'STAFF_PORTAL_NATIVE_CONFIGURATION','Choose a host-declared native token input.',404);
    const secret=await readJson(native.tokenFile,16384);need(secret.value.schema==='stellar-forge.staff-portal-native-secret.v1'&&typeof secret.value.token==='string','STAFF_PORTAL_NATIVE_SECRET','Select the private original native token.');
    const response=await client.invoke('/api/insights/connect',{origin:native.origin,token:secret.value.token},{workspaceId:args.workspaceId});
    return this.#retain(scope,response,{operation:'native_connect',workspaceId:args.workspaceId,nativeConnection:args.nativeConnection,origin:native.origin});
   }
   case'native_disconnect':return this.#retain(scope,await client.invoke('/api/insights/disconnect',{}, {workspaceId:args.workspaceId}),{operation:'native_disconnect',workspaceId:args.workspaceId});
   case'native_start':{
    exact(args.body,['operationId','title','kind','query','pageSize','audienceId','purpose','nativeBinding'],['operationId','title','kind','nativeBinding']);
    need(plain(args.body)&&typeof args.body.operationId==='string'&&plain(args.body.nativeBinding),'STAFF_PORTAL_NATIVE_START','Use the complete original operationId and currently observed nativeBinding.');
    return this.#mutation(scope,'native_start',args.requestId,{workspaceId:args.workspaceId,route:'/api/insights/start',body:args.body},()=>client.invoke('/api/insights/start',args.body,{workspaceId:args.workspaceId}));
   }
   case'native_capture':return this.#capture(scope,args);
   case'artifact':{
    need(ARTIFACT_KINDS.includes(args.kind),'STAFF_PORTAL_ARTIFACT','Choose an original full artifact.');
    const q=query(args.query);let route,selected={...q};
    if(args.kind==='object'){digest(args.objectSha256);route='/api/object/'+args.objectSha256;need(Object.keys(q).length===0,'STAFF_PORTAL_ARTIFACT','An original object has no query.');}
    else if(args.kind==='report'||args.kind==='portal_report')route=args.kind==='report'?'/api/report':'/api/portal/report';
    else{route=args.kind.startsWith('portal_')||args.kind==='delivery'?'/api/portal/download':'/api/download';selected.kind=({workspace:'workspace',batch:'batch',batch_file:'batch-file',portal_batch:'batch',portal_batch_file:'batch-file',delivery:'delivery'})[args.kind];}
    const access=await this.#access(scope);
    try{return{workspace:scope.alias,...await this.#files.capture(scope.alias,{operation:'artifact',workspaceId:args.workspaceId,kind:args.kind,query:selected,access},async sink=>{
     const observed=await client.download(route,selected,{sink,workspaceId:args.workspaceId});
     if(observed.ok===false){const e=new Error('Original download returned an HTTP response.');e.originalResponse=observed;throw e;}return observed;
    },{...(args.expectedSha256?{sha256:args.expectedSha256}:{}),...(args.expectedBytes===undefined?{}:{bytes:args.expectedBytes}),...(args.filename?{filename:args.filename}:{})})};}
    catch(e){if(e.originalResponse)return this.#retain(scope,e.originalResponse,{operation:'artifact-error',workspaceId:args.workspaceId,kind:args.kind,query:selected});throw e;}
   }
   default:need(false,'STAFF_PORTAL_TOOL','Choose a declared staff portal tool.');
  }
 }
 async call(name,args={}){need(!this.#closing,'STAFF_PORTAL_CLOSING','This portal attachment is closing.',409);const pending=this.#tail.then(()=>this.#dispatch(name,args));this.#tail=pending.catch(()=>{});this.#pending.add(pending);try{return await pending;}finally{this.#pending.delete(pending);}}
 close(){if(this.#closed)return this.#closed;this.#closing=true;return this.#closed=(async()=>{await Promise.allSettled([...this.#pending]);await Promise.all([...this.#clients.values()].map(c=>c.close()));await this.#files.close();this.#clients.clear();})().catch(e=>{this.#closed=null;throw e;});}
}
export {staffPortalTools} from './tools.mjs';

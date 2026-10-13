// MIT. Complete original Stellar RPC pages; provider-typed XDR and explicit cursor custody.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {need,keys,object,clone,identity,hash,bytes,text,integer,address,sha} from './value.mjs';
import {directory,writeExact,readJSON,fileDescriptor,verifyFile,confined,syncDirectory} from './files.mjs';
import {parseSourceJSON} from './source-json.mjs';
import {API} from './catalogue.mjs';
const LIMIT=128*1024*1024;
const stamp=()=>new Date().toISOString();
export function eventQuery(config,input,api=API){
 keys(input,['contractKeys','startLedger','cursor','limit','eventType'],['contractKeys','limit','eventType']);
 need(Array.isArray(input.contractKeys)&&input.contractKeys.length>=1&&input.contractKeys.length<=5&&new Set(input.contractKeys).size===input.contractKeys.length,'EVENT_CONTRACT_SELECTION');
 const contracts=input.contractKeys.map(key=>{need(Object.hasOwn(api.contracts,key),'UNKNOWN_CONTRACT');const c=config.contracts?.[key];need(c?.id&&c.wasmSha256,'CONTRACT_BINDING_REQUIRED');address(c.id);need(c.id.startsWith('C'),'CONTRACT_ADDRESS_REQUIRED');sha(c.wasmSha256);return{key,id:c.id,wasmSha256:c.wasmSha256};});
 need(new Set(contracts.map(c=>c.id)).size===contracts.length,'DISTINCT_CONTRACT_BINDINGS_REQUIRED');
 need(Object.hasOwn(input,'cursor')!==Object.hasOwn(input,'startLedger'),'EVENT_START_OR_CURSOR');
 if(Object.hasOwn(input,'cursor'))text(input.cursor,4096);else integer(input.startLedger,'u32');
 integer(input.limit,'u32');need(BigInt(input.limit)>=1n&&BigInt(input.limit)<=10000n,'EVENT_PAGE_LIMIT');
 need(['all','contract','system'].includes(input.eventType),'EVENT_TYPE_REQUIRED');
 need(config.network?.rpcUrl&&config.network?.passphrase,'NETWORK_REQUIRED');
 const endpoint=new URL(config.network.rpcUrl);need(['https:','http:'].includes(endpoint.protocol)&&!endpoint.username&&!endpoint.password&&!endpoint.hash,'RPC_URL_REQUIRED');
 const query=clone(input),filter={contractIds:contracts.map(c=>c.id)};if(input.eventType!=='all')filter.type=input.eventType;
 const params={filters:[filter],pagination:{limit:Number(input.limit)},xdrFormat:'json'};
 if(Object.hasOwn(input,'cursor'))params.pagination.cursor=input.cursor;else params.startLedger=Number(input.startLedger);
 return{query,params,binding:{network:clone(config.network),contracts,apiSha256:identity(api),codeVerification:'CONFIGURATION_PIN_ONLY'}};
}
export function eventSelection(config,args,previous,api=API){
 keys(args,['query','previousPageId'],['query']);const selected=eventQuery(config,args.query,api);
 if(Object.hasOwn(args,'previousPageId')){text(args.previousPageId,250);need(previous?.id===args.previousPageId&&previous.status==='CAPTURED'&&previous.nextQuery&&identity(previous.nextQuery)===identity(selected.query)&&identity(previous.binding)===identity(selected.binding),'ORIGINAL_EVENT_CONTINUATION_CHANGED');}
 return selected;
}
export function eventIndex(pages){
 const selected=new Map(),identities=new Map();
 for(const page of pages.filter(p=>p.status==='CAPTURED'))for(const [index,original]of page.events.entries()){
  const numberTokens=page.eventNumberTokens[index];
  const sourceKey=identity({network:page.binding.network,contractId:original.contractId,providerId:original.id});
  const id='event-'+identity({sourceKey,original,numberTokens});const old=selected.get(id);
  if(old){if(!old.pageIds.includes(page.id))old.pageIds.push(page.id);continue;}
  const contract=page.binding.contracts.find(c=>c.id===original.contractId);
  const row={id,providerId:original.id,contractKey:contract.key,contractId:original.contractId,ledger:original.ledger,ledgerClosedAt:original.ledgerClosedAt??null,type:original.type,txHash:original.txHash??null,topicJson:clone(original.topicJson),valueJson:clone(original.valueJson),original:clone(original),numberTokens:clone(numberTokens),binding:clone(page.binding),pageIds:[page.id],identityConflict:false};
  selected.set(id,row);const prior=identities.get(sourceKey)??[];prior.push(row);identities.set(sourceKey,prior);
 }
 for(const rows of identities.values())if(rows.length>1)for(const row of rows)row.identityConflict=true;
 return[...selected.values()];
}
function basePage(requestId,selected,previousPageId,createdAt){
 return{id:'event-page-'+requestId,createdAt,query:selected.query,binding:selected.binding,previousPageId,status:'ERROR',events:[],nextQuery:null,coverage:'SELECTED_RPC_PAGE',populationComplete:false};
}
function project(page,value,numberTokens){
 need(object(numberTokens),'EVENT_NUMBER_TOKENS_REQUIRED');
 need(object(value)&&Array.isArray(value.events)&&value.events.length<=Number(page.query.limit)&&typeof value.cursor==='string','EVENT_PAGE_SHAPE');
 integer(value.latestLedger,'u32');integer(value.oldestLedger,'u32');need(BigInt(value.oldestLedger)<=BigInt(value.latestLedger),'EVENT_LEDGER_RANGE');
 const ids=new Set();for(const event of value.events){
  need(object(event)&&typeof event.id==='string'&&event.id&&!ids.has(event.id)&&page.binding.contracts.some(c=>c.id===event.contractId)&&['contract','system'].includes(event.type),'EVENT_SOURCE_IDENTITY');ids.add(event.id);integer(event.ledger,'u32');
  need(BigInt(event.ledger)>=BigInt(value.oldestLedger)&&BigInt(event.ledger)<=BigInt(value.latestLedger)&&Array.isArray(event.topicJson)&&Object.hasOwn(event,'valueJson'),'COMPLETE_TYPED_EVENT_REQUIRED');
  if(Object.hasOwn(page.query,'startLedger'))need(BigInt(event.ledger)>=BigInt(page.query.startLedger),'EVENT_START_CHANGED');
  if(page.query.eventType!=='all')need(event.type===page.query.eventType,'EVENT_FILTER_CHANGED');
 }
 page.status='CAPTURED';page.events=value.events;page.latestLedger=value.latestLedger;page.oldestLedger=value.oldestLedger;page.latestLedgerCloseTime=value.latestLedgerCloseTime??null;page.oldestLedgerCloseTime=value.oldestLedgerCloseTime??null;page.cursor=value.cursor;
 if(value.cursor)page.nextQuery={contractKeys:clone(page.query.contractKeys),cursor:value.cursor,limit:page.query.limit,eventType:page.query.eventType};
 page.originalResult=value;page.numberTokens=clone(numberTokens);
 page.eventNumberTokens=value.events.map((_,index)=>{const prefix='/result/events/'+index;return Object.fromEntries(Object.entries(numberTokens).filter(([key])=>key.startsWith(prefix+'/')).map(([key,value])=>[key.slice(prefix.length),value]));});return page;
}
function requestBody(requestId,method,params){return{jsonrpc:'2.0',id:requestId+':'+method,method,...(params?{params}:{})};}
function failure(error){return{code:error.code??'RPC_CAPTURE_FAILED',message:String(error.message??error)};}
// Used at initial publication, local recovery and complete portable inspection.
// The complete original HTTP response proves every accepted projected event.
export function validateEventCapture(page,requestId,config,args,previous,full,api=API){
 const selected=eventSelection(config,args,previous,api),spec={schema:'principal.event-attempt.v1',requestId,selected,previousPageId:args.previousPageId??null};
 const files=new Map();for(const f of full){need(typeof f.path==='string'&&!f.path.includes('/')&&!f.path.includes('\\')&&!files.has(f.path)&&f.bytes===f.data.length&&f.sha256===hash(f.data),'EVENT_SOURCE_FILE_CHANGED');files.set(f.path,f);}
 const json=name=>{const f=files.get(name);need(f,'EVENT_SOURCE_FILE_MISSING',{name});return JSON.parse(f.data.toString('utf8'));};
 need(identity(json('input.json'))===identity(spec),'EVENT_INPUT_CHANGED');
 const reservation=json('reserved.json'),terminal=json('result.json');
 need(reservation.requestId===requestId&&reservation.inputSha256===hash(bytes(spec))&&typeof reservation.createdAt==='string','EVENT_RESERVATION_CHANGED');
 need(terminal.schema==='principal.event-result.v1'&&terminal.requestId===requestId&&terminal.inputSha256===hash(bytes(spec))&&identity(terminal.page)===identity(page)&&Array.isArray(terminal.files),'EVENT_RESULT_CHANGED');
 need(terminal.files.length+1===files.size&&new Set(terminal.files.map(f=>f.path)).size===terminal.files.length,'EVENT_SOURCE_ROSTER_CHANGED');
 for(const f of terminal.files){const actual=files.get(f.path);need(f.path!=='result.json'&&actual?.bytes===f.bytes&&actual.sha256===f.sha256,'EVENT_SOURCE_FILE_CHANGED');}
 const expected=basePage(requestId,selected,spec.previousPageId,reservation.createdAt);
 need(['CAPTURED','ERROR','INTERRUPTED'].includes(page.status),'EVENT_STATUS_CHANGED');
 if(page.status==='CAPTURED'){
  const rpc=(method,params)=>{
   const request=requestBody(requestId,method,params),raw=files.get(method+'.body'),headers=json(method+'.headers.json'),complete=json(method+'.complete.json');
   need(identity(json(method+'.request.json'))===identity(request)&&raw&&complete.bytes===raw.bytes&&complete.sha256===raw.sha256&&complete.requestSha256===hash(bytes(request))&&headers.status>=200&&headers.status<300&&headers.url===new URL(selected.binding.network.rpcUrl).href,'EVENT_HTTP_BINDING_CHANGED');
   const parsed=parseSourceJSON(raw.data,{maxBytes:LIMIT}),value=parsed.value;need(value.jsonrpc==='2.0'&&value.id===request.id&&!value.error&&object(value.result),'EVENT_RPC_RESULT_CHANGED');return{value:value.result,numberTokens:parsed.numberTokens};
  };
  need(rpc('getNetwork').value.passphrase===selected.binding.network.passphrase,'RPC_NETWORK_CHANGED');
  const received=rpc('getEvents',selected.params);project(expected,received.value,received.numberTokens);need(identity(expected)===identity(page),'EVENT_PROJECTION_CHANGED');
 }else{
  expected.status=page.status;expected.error=page.error;need(object(page.error)&&typeof page.error.code==='string'&&typeof page.error.message==='string'&&identity(expected)===identity(page),'EVENT_FAILURE_CHANGED');
 }
 return page;
}
export async function captureEvents(root,requestId,config,args,previous,{signal}={}){
 const selected=eventSelection(config,args,previous),attempt=path.join(root,'events',hash(requestId));await directory(attempt);
 const spec={schema:'principal.event-attempt.v1',requestId,selected,previousPageId:args.previousPageId??null};
 await writeExact(path.join(attempt,'input.json'),bytes(spec));const terminal=path.join(attempt,'result.json');
 let result=await readJSON(terminal,true);
 const files=async()=>{const rows=[];for(const name of (await fs.readdir(attempt)).sort()){
  if(name==='result.json'||name.includes('.pending-'))continue;const f=await confined(attempt,name),handle=await fs.open(f,'r');
  try{await handle.sync();}finally{await handle.close();}const d=await fileDescriptor(f,name);rows.push(d);
 }await syncDirectory(attempt);return rows;};
 if(!result){
  const reservation=await readJSON(path.join(attempt,'reserved.json'),true);
  if(reservation){
   const page=basePage(requestId,selected,spec.previousPageId,reservation.createdAt);page.status='INTERRUPTED';page.error={code:'ORIGINAL_RPC_INTERRUPTED',message:'The original Node owner ended before complete capture. Preserved files are observations, not a completed page.'};
   result={schema:'principal.event-result.v1',requestId,inputSha256:hash(bytes(spec)),page,files:await files()};
  }else{
   const createdAt=stamp();await writeExact(path.join(attempt,'reserved.json'),bytes({requestId,createdAt,inputSha256:hash(bytes(spec))}));
   const page=basePage(requestId,selected,spec.previousPageId,createdAt);
   async function rpc(method,params){
    const request=requestBody(requestId,method,params);await writeExact(path.join(attempt,method+'.request.json'),bytes(request));
    const bounded=signal?AbortSignal.any([signal,AbortSignal.timeout(60000)]):AbortSignal.timeout(60000);
    let response,reader,handle,size=0;
    try{
     response=await fetch(selected.binding.network.rpcUrl,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(request),redirect:'error',signal:bounded});
     await writeExact(path.join(attempt,method+'.headers.json'),bytes({url:response.url,status:response.status,headers:Object.fromEntries(response.headers),receivedAt:stamp()}));
     handle=await fs.open(path.join(attempt,method+'.body'),'wx',0o600);
     reader=response.body?.getReader();need(reader,'RPC_BODY_REQUIRED');
     while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;need(size<=LIMIT,'RPC_BODY_CAPACITY');await handle.writeFile(part.value);}
    }finally{
     let first;try{if(reader)await reader.cancel();else await response?.body?.cancel();}catch(e){first=e;}
     try{reader?.releaseLock();}catch(e){first??=e;}
     if(handle){try{await handle.sync();}catch(e){first??=e;}try{await handle.close();}catch(e){first??=e;}}
     try{await syncDirectory(attempt);}catch(e){first??=e;}if(first)throw first;
    }
    const raw=await fs.readFile(path.join(attempt,method+'.body')),decoded=parseSourceJSON(raw,{maxBytes:LIMIT}),parsed=decoded.value;
    need(response.ok&&parsed.jsonrpc==='2.0'&&parsed.id===request.id&&!parsed.error&&object(parsed.result),'RPC_RESPONSE_REJECTED',{status:response.status,error:parsed.error??null});
    await writeExact(path.join(attempt,method+'.complete.json'),bytes({bytes:raw.length,sha256:hash(raw),requestSha256:hash(bytes(request))}));return{value:parsed.result,numberTokens:decoded.numberTokens};
   }
   try{const network=await rpc('getNetwork');need(network.value.passphrase===selected.binding.network.passphrase,'RPC_NETWORK_CHANGED');const received=await rpc('getEvents',selected.params);project(page,received.value,received.numberTokens);}
   catch(error){Object.assign(page,basePage(requestId,selected,spec.previousPageId,createdAt));page.error=failure(error);}
   result={schema:'principal.event-result.v1',requestId,inputSha256:hash(bytes(spec)),page,files:await files()};
  }
  await writeExact(terminal,bytes(result));
 }
 const descriptors=[...result.files,{...(await fileDescriptor(terminal)),path:'result.json'}],full=[];
 for(const d of descriptors){await verifyFile(attempt,d);const f=await confined(attempt,d.path),handle=await fs.open(f,'r');try{await handle.sync();}finally{await handle.close();}const data=await fs.readFile(f);need(data.length===d.bytes&&hash(data)===d.sha256,'EVENT_FILE_CHANGED');full.push({...d,data});}await syncDirectory(attempt);
 validateEventCapture(result.page,requestId,config,args,previous,full);return{page:clone(result.page),files:full};
}

// MIT. Turbolong original runtime, telemetry, RPC and keeper history transport.
import {createHash,randomUUID} from 'node:crypto';
import {AsyncLocalStorage} from 'node:async_hooks';
import {promises as fs} from 'node:fs';
import {resolve,relative,isAbsolute,sep} from 'node:path';
import {TURBOLONG_ACTIONS,TURBOLONG_ORIGINAL,getTurbolongAction,validateTurbolongArguments} from './catalogue.mjs';

const SCHEMA='stellar-forge.turbolong-operations-prepared.v1';
const DEFAULTS={
  mainnet:{rpcUrl:'https://mainnet.sorobanrpc.com',horizonUrl:'https://horizon.stellar.org'},
  testnet:{rpcUrl:'https://soroban-testnet.stellar.org',horizonUrl:'https://horizon-testnet.stellar.org'}
};
const WORKER='https://turbolong-alerts.turbolong.workers.dev';
const sha=value=>createHash('sha256').update(value).digest('hex');
const clone=value=>JSON.parse(JSON.stringify(value));
const now=()=>new Date().toISOString();
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function canonical(value) {
  if (value===null||typeof value!=='object') return JSON.stringify(value);
  if (Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
}
function freeze(value) { if(value&&typeof value==='object'){for(const x of Object.values(value))freeze(x);Object.freeze(value);}return value; }
function problem(code,message,detail) {return Object.assign(new Error(message),{code,detail});}
function need(value,code,message,detail) {if(!value)throw problem(code,message,detail);}
function strictURL(value,name) {
  let u;try{u=new URL(value);}catch{throw problem('INVALID_CONNECTION',name+' must be an absolute URL');}
  need(u.protocol==='https:'||u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname),'INVALID_CONNECTION',name+' must use HTTPS or a loopback HTTP endpoint');
  need(!u.username&&!u.password&&!u.hash,'INVALID_CONNECTION',name+' cannot contain embedded credentials or a fragment');
  return u;
}
function publicURL(value) {
  const u=new URL(value);
  for(const key of [...u.searchParams.keys()])if(/key|token|secret|password|signature|credential|auth/i.test(key))u.searchParams.set(key,'[private]');
  return u.href;
}
function endpoint(base,path,query={}) {
  const u=new URL(base);u.pathname=u.pathname.replace(/\/$/,'')+'/'+path.replace(/^\//,'');
  for(const [key,value]of Object.entries(query))if(value!==undefined&&value!==null)u.searchParams.set(key,String(value));
  return u.href;
}
function timestamp(value) {
  if(typeof value!=='string')return null;
  let s=value.trim();
  if(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(?:\.\d+)?$/.test(s))s=s.replace(' ','T')+'Z';
  if(!/(?:[zZ]|[+-]\d\d:\d\d)$/.test(s))return null;
  const ms=Date.parse(s);return Number.isFinite(ms)?ms:null;
}
function selected(rows,args,timeKey) {
  const start=args.startsAt?timestamp(args.startsAt):-Infinity,end=args.endsAt?timestamp(args.endsAt):Infinity;
  return rows.filter(row=>{const t=timestamp(row[timeKey]);return t!==null&&t>=start&&t<end;});
}
function decimalCursor(value,name='cursor') {
  need(typeof value==='string'&&/^[1-9][0-9]*$/.test(value)||Number.isSafeInteger(value)&&value>0,'PROVIDER_SHAPE',name+' must be a positive integer cursor');
  const n=BigInt(value);need(n<=BigInt(Number.MAX_SAFE_INTEGER),'UNSAFE_PROVIDER_CURSOR','Original Worker converts cursors to Number; this value cannot be sent without changing it',{cursor:String(value)});
  return String(value);
}
// Keep original JSON integer tokens beyond the safe range as strings. Exact bytes
// and offsets remain in the observation, including any exponent notation.
export function parseTurbolongOriginalJSON(text) {
  let inside=false,escaped=false,out='',last=0;const numberPreservation=[];
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(inside){if(escaped)escaped=false;else if(ch==='\\')escaped=true;else if(ch==='"')inside=false;continue;}
    if(ch==='"'){inside=true;continue;}
    if(ch==='-'||ch>='0'&&ch<='9'){
      const found=text.slice(i).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
      if(!found)continue;const token=found[0],n=Number(token);
      if(!Number.isFinite(n)||Number.isInteger(n)&&!Number.isSafeInteger(n)){
        out+=text.slice(last,i)+JSON.stringify(token);last=i+token.length;numberPreservation.push({offset:i,token});
      }
      i+=token.length-1;
    }
  }
  out+=text.slice(last);
  return {value:JSON.parse(out),numberPreservation};
}
function decodeJSON(bytes) {
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  return parseTurbolongOriginalJSON(text);
}
function jsonLineRows(text,format) {
  if(format==='json'){
    const parsed=parseTurbolongOriginalJSON(text);
    const value=parsed.value,rows=Array.isArray(value)?value:Array.isArray(value?.rows)?value.rows:Array.isArray(value?.observations)?value.observations:null;
    need(rows,'INVALID_HISTORY','Selected JSON history must contain an array, rows or observations');
    return {rows,lines:rows.map((_,i)=>({rowIndex:i,jsonIndex:i})),errors:[],numberPreservation:parsed.numberPreservation};
  }
  const rows=[],lines=[],errors=[],numberPreservation=[];
  const split=text.split(/\r?\n/);
  for(let i=0;i<split.length;i++){
    const line=split[i];if(!line.trim())continue;
    const prefix=line.startsWith('[route] ')?8:0;
    try{
      const p=parseTurbolongOriginalJSON(line.slice(prefix));
      need(plain(p.value),'INVALID_HISTORY_ROW','History row must be a JSON object');
      lines.push({rowIndex:rows.length,line:i+1});rows.push(p.value);
      for(const numeric of p.numberPreservation)numberPreservation.push({line:i+1,...numeric});
    }catch(error){errors.push({line:i+1,code:error.code||'INVALID_JSON',message:error.message,rawLineSha256:sha(Buffer.from(line,'utf8'))});}
  }
  return {rows,lines,errors,numberPreservation};
}
export async function openTurbolongConnection({connection={}}={}) {
  need(plain(connection),'INVALID_CONNECTION','connection must be an object');
  const network=connection.network||connection.private?.network||'mainnet';
  need(DEFAULTS[network],'INVALID_CONNECTION','network must be mainnet or testnet');
  const telemetryUrl=strictURL(connection.telemetryUrl||WORKER,'telemetryUrl').href;
  const rpcUrl=strictURL(connection.rpcUrl||connection.private?.rpcUrl||DEFAULTS[network].rpcUrl,'rpcUrl').href;
  const horizonUrl=strictURL(connection.horizonUrl||connection.private?.horizonUrl||DEFAULTS[network].horizonUrl,'horizonUrl').href;
  const timeoutMs=connection.timeoutMs??30000;
  need(Number.isSafeInteger(timeoutMs)&&timeoutMs>=1000&&timeoutMs<=300000,'INVALID_CONNECTION','timeoutMs must be between 1000 and 300000');
  const privateHeaders=connection.private?.httpHeaders||{};
  for(const [target,headers]of Object.entries(privateHeaders)){
    need(['telemetry','rpc','horizon'].includes(target)&&plain(headers),'INVALID_CONNECTION','Private HTTP headers must select a supported endpoint');
    for(const [key,value]of Object.entries(headers))need(typeof value==='string'&&!/[\r\n]/.test(key+value),'INVALID_CONNECTION','HTTP header values must be strings without newlines');
  }
  const secretValues=new Set();
  for(const headers of Object.values(privateHeaders))for(const value of Object.values(headers)){if(value)secretValues.add(value);const bearer=value.match(/^Bearer (.+)$/i);if(bearer)secretValues.add(bearer[1]);}
  for(const url of [telemetryUrl,rpcUrl,horizonUrl])for(const [key,value]of new URL(url).searchParams)if(/key|token|secret|password|signature|credential|auth/i.test(key)&&value)secretValues.add(value);
  const surfaces=(connection.surfaces||[
    {id:'application',name:'Turbolong application',url:'https://app.turbolong.com/',kind:'http',expectedStatus:200},
    {id:'telemetry',name:'Rate snapshot service',url:endpoint(telemetryUrl,'snapshots',{limit:1}),kind:'http',expectedStatus:200},
    {id:'rpc',name:'Selected Stellar RPC',url:rpcUrl,kind:'rpc-health',expectedStatus:200}
  ]).map(s=>{
    need(plain(s)&&typeof s.id==='string'&&s.id.length>0,'INVALID_CONNECTION','Each surface requires an ID');
    const url=strictURL(s.url,'surface '+s.id).href;
    for(const [key,value]of new URL(url).searchParams)if(/key|token|secret|password|signature|credential|auth/i.test(key)&&value)secretValues.add(value);
    need(s.kind===undefined||['http','rpc-health'].includes(s.kind),'INVALID_CONNECTION','Surface kind must be http or rpc-health');
    return {...clone(s),url,kind:s.kind||'http'};
  });
  need(new Set(surfaces.map(s=>s.id)).size===surfaces.length,'INVALID_CONNECTION','Surface IDs must be unique');
  const publicConnection=freeze({
    id:connection.id||null,name:connection.name||'Turbolong operating connection',network,
    telemetryUrl:publicURL(telemetryUrl),rpcUrl:publicURL(rpcUrl),horizonUrl:publicURL(horizonUrl),timeoutMs,
    endpointIdentities:{telemetry:sha(telemetryUrl),rpc:sha(rpcUrl),horizon:sha(horizonUrl)},
    surfaces:surfaces.map(s=>({...s,url:publicURL(s.url),endpointSha256:sha(s.url)})),
    original:TURBOLONG_ORIGINAL
  });
  const active=new Set(),captures=new AsyncLocalStorage();let closed=false,runtimePromise=null;
  function retainObservation(record){const selected=captures.getStore();if(selected&&!selected.some(o=>o.id===record.id))selected.push(record);}
  function redact(text){let clean=text;for(const value of secretValues){for(const variant of new Set([value,JSON.stringify(value).slice(1,-1),encodeURIComponent(value)]))if(variant)clean=clean.split(variant).join('[private]');}return clean;}
  function redactValue(value){if(typeof value==='string')return redact(value);if(Array.isArray(value))return value.map(redactValue);if(plain(value)){const out={};for(const [key,v]of Object.entries(value))Object.defineProperty(out,redact(key),{value:redactValue(v),enumerable:true,writable:true,configurable:true});return out;}return value;}
  function bodyDescriptor(bytes) {
    const wire={bytes:bytes.length,sha256:sha(bytes)};
    let body=bytes,redacted=false;
    if(secretValues.size){
      let decoded;try{decoded=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{}
      if(decoded!==undefined){const clean=redact(decoded);if(clean!==decoded){body=Buffer.from(clean,'utf8');redacted=true;}}
      else if([...secretValues].some(v=>bytes.includes(Buffer.from(v,'utf8'))))return {...wire,privateBodyOmitted:true,wire};
    }
    return {bodyBase64:body.toString('base64'),bytes:body.length,sha256:sha(body),...(redacted?{redacted:true,wire}:{})};
  }
  async function runtime(){
    if(!runtimePromise)runtimePromise=import('./runtime.mjs').then(m=>m.openTurbolongRuntimeExecution({connection})).catch(error=>{runtimePromise=null;throw error;});
    return runtimePromise;
  }
  function assertOpen(){need(!closed,'CONNECTION_CLOSED','Turbolong connection is closed');}
  function describe(){return {schema:'stellar-forge.turbolong-operations-connection.v1',connection:publicConnection,actions:TURBOLONG_ACTIONS.length};}
  function catalog(){return {schema:'stellar-forge.turbolong-operations-catalogue.v1',original:TURBOLONG_ORIGINAL,actions:TURBOLONG_ACTIONS};}
  async function selectedHistoryPath(path){
    const configured=connection.historyRoot||connection.private?.historyRoot;
    need(typeof configured==='string'&&configured.length,'HISTORY_ROOT_REQUIRED','Select the original keeper history root in this connection');
    need(!isAbsolute(path)&&!path.split(/[\\/]/).includes('..'),'INVALID_HISTORY_PATH','History path must remain inside the selected original root');
    const root=await fs.realpath(configured),file=await fs.realpath(resolve(root,path)),r=relative(root,file);
    need(r!==''&&!r.startsWith('..'+sep)&&r!=='..'&&!isAbsolute(r),'INVALID_HISTORY_PATH','History file resolves outside the selected original root');
    return file;
  }
  async function prepare({action,args={},requestId}={}) {
    assertOpen();validateTurbolongArguments(action,args);
    if(args.network!==undefined)need(args.network===network,'NETWORK_MISMATCH','Action network must match its selected connection');
    const definition=getTurbolongAction(action),input=clone(args);
    const id=requestId||randomUUID();
    need(typeof id==='string'&&id.length>0&&id.length<=200&&!/[\x00-\x1f]/.test(id),'INVALID_REQUEST_ID','requestId must be a nonempty printable identifier');
    let original=null;
    if(definition.transport==='original-runtime')original=await (await runtime()).prepare({action,args:input,requestId:id});
    else if(action==='keeper.history.import'){
      const path=await selectedHistoryPath(input.path),stat=await fs.stat(path,{bigint:true});
      need(stat.isFile(),'INVALID_HISTORY_PATH','Selected history must be a regular file');
      original={kind:'history-file',path:input.path,size:String(stat.size),mtimeNs:String(stat.mtimeNs),inode:String(stat.ino)};
    }else if(action==='snapshots.list'&&input.before!==undefined)input.before=decimalCursor(input.before,'before');
    else if(action==='surfaces.inspect'){
      const ids=input.surfaces||surfaces.map(s=>s.id);
      for(const selectedId of ids)need(surfaces.some(s=>s.id===selectedId),'UNKNOWN_SURFACE','Surface is not configured: '+selectedId);
    }
    const request={schema:SCHEMA,id,requestId:id,action,args:input,connection:publicConnection,transport:definition.transport,preparedAt:now(),mutates:definition.mutates||input.telemetry===true,original:original===undefined?null:clone(original)};
    request.requestSha256=sha(canonical(request));
    return freeze(request);
  }
  function checkRequest(request){
    assertOpen();need(plain(request)&&request.schema===SCHEMA,'INVALID_PREPARED_REQUEST','A Turbolong prepared request is required');
    const unsigned=clone(request);delete unsigned.requestSha256;
    need(request.requestSha256===sha(canonical(unsigned)),'PREPARED_REQUEST_CHANGED','Prepared request bytes or selected inputs changed');
    need(canonical(request.connection)===canonical(publicConnection),'CONNECTION_MISMATCH','Prepared request belongs to a different selected connection');
    validateTurbolongArguments(request.action,request.args);
    const definition=getTurbolongAction(request.action);
    need(request.transport===definition.transport,'PREPARED_REQUEST_CHANGED','Prepared transport does not match its catalogue action');
    return definition;
  }
  async function exchange({request,target,url,method='GET',body,kind,signal,headers={}}){
    const startedAt=now(),controller=new AbortController();active.add(controller);
    const combined=AbortSignal.any([controller.signal,AbortSignal.timeout(timeoutMs),...(signal?[signal]:[])]);
    const outgoing={method,url:publicURL(url),endpointSha256:sha(url),...(body===undefined?{}:bodyDescriptor(Buffer.from(body,'utf8')))};
    const record={schema:'stellar-forge.turbolong-operations-observation.v1',kind,operationId:request.id,observedAt:startedAt,network,request:outgoing};
    let response,bytes;
    try{
      const boundUrl=target==='telemetry'?telemetryUrl:target==='rpc'?rpcUrl:target==='horizon'?horizonUrl:null;
      const boundHeaders=boundUrl&&new URL(boundUrl).origin===new URL(url).origin?privateHeaders[target]:{};
      response=await fetch(url,{method,headers:{Accept:'application/json',...boundHeaders,...headers},body,redirect:'manual',signal:combined});
      bytes=Buffer.from(await response.arrayBuffer());
      const safeHeaders={};
      for(const [key,value]of response.headers)if(!/^(set-cookie|authorization|proxy-authorization|cookie)$/i.test(key))safeHeaders[key]=redact(value);
      record.response={status:response.status,statusText:response.statusText,headers:safeHeaders,...bodyDescriptor(bytes)};
      record.completedAt=now();record.id='observation-'+sha(canonical(record));retainObservation(record);
      let decoded,error;
      try{decoded=decodeJSON(bytes);}catch(e){error={code:'NON_JSON_RESPONSE',message:redact(e.message)};}
      if(decoded){decoded.value=redactValue(decoded.value);record.numberPreservation=redactValue(decoded.numberPreservation);record.parsed=decoded.value;}
      if(error)record.parseError=error;
      return {observation:record,response,bytes,parsed:decoded?.value,parseError:error};
    }catch(error){
      record.error={code:error.code||error.name||'TRANSPORT_ERROR',message:redact(error.message||String(error))};record.completedAt=now();record.id='observation-'+sha(canonical(record));
      throw problem('TRANSPORT_ERROR',record.error.message,{observation:record});
    }finally{active.delete(controller);}
  }
  function httpValue(result){
    need(result.response.ok,'HTTP_ERROR','Provider returned HTTP '+result.response.status,{observation:result.observation});
    need(!result.parseError,'PROVIDER_SHAPE','Provider response is not valid UTF-8 JSON',{observation:result.observation});
    return result.parsed;
  }
  async function rpc(request,method,params,kind,signal){
    const body=JSON.stringify({jsonrpc:'2.0',id:request.id,method,params});
    const result=await exchange({request,target:'rpc',url:rpcUrl,method:'POST',body,kind,signal,headers:{'Content-Type':'application/json'}});
    const value=httpValue(result);
    need(plain(value)&&value.jsonrpc==='2.0'&&value.id===request.id,'RPC_PROTOCOL_ERROR','RPC response does not match the original request ID',{observation:result.observation});
    need(!value.error,'RPC_ERROR',value.error?.message||'RPC returned an error',{observation:result.observation,providerError:value.error});
    need(plain(value.result),'RPC_PROTOCOL_ERROR','RPC response has no result object',{observation:result.observation});
    return {...result,result:value.result};
  }
  async function snapshots(request,signal){
    const args=request.args,url=endpoint(telemetryUrl,'snapshots',{pool_id:args.pool_id,asset:args.asset,limit:args.limit||500,before:args.before});
    const got=await exchange({request,target:'telemetry',url,kind:'rates.snapshots',signal}),value=httpValue(got);
    need(plain(value)&&Array.isArray(value.snapshots)&&Object.prototype.hasOwnProperty.call(value,'nextCursor'),'PROVIDER_SHAPE','Snapshot response requires snapshots and nextCursor',{observation:got.observation});
    const rows=value.snapshots;let prior=args.before===undefined?null:BigInt(decimalCursor(args.before)),last=null;
    for(const row of rows){
      need(plain(row),'PROVIDER_SHAPE','Snapshot rows must be objects',{observation:got.observation});
      const id=BigInt(decimalCursor(row.id,'snapshot id'));
      need(prior===null||id<prior,'CURSOR_ORDER','Snapshot IDs do not follow the original descending cursor order',{observation:got.observation});
      prior=id;last=id;
      if(args.pool_id)need(row.pool_id===args.pool_id,'QUERY_MISMATCH','Snapshot belongs to a different selected pool',{observation:got.observation});
      if(args.asset)need(row.asset_symbol===args.asset,'QUERY_MISMATCH','Snapshot belongs to a different selected asset',{observation:got.observation});
    }
    const next=value.nextCursor===null?null:decimalCursor(value.nextCursor);
    if(next!==null)need(last!==null&&BigInt(next)===last,'CURSOR_MISMATCH','Original nextCursor must equal the last snapshot ID',{observation:got.observation});
    const coverage={kind:'cursor-history',complete:next===null,network,query:{pool_id:args.pool_id||null,asset:args.asset||null},returnedRows:rows.length,startsAt:args.startsAt||null,endsAt:args.endsAt||null,providerCursor:next};
    const content={kind:'rates.snapshots',network,snapshots:rows,nextCursor:value.nextCursor,selectedRows:selected(rows,args,'recorded_at'),coverage};
    got.observation.parsed=content;got.observation.coverage=coverage;
    return {status:next===null?'COMPLETED':'PARTIAL',content,observations:[got.observation],pagination:{complete:next===null,...(next===null?{}:{cursor:next,nextArgs:{...args,before:next}}),coverage}};
  }
  async function routes(request,signal){
    const args=request.args,url=endpoint(telemetryUrl,'swap-routes',{network,strategy_id:args.strategy_id,limit:args.limit||500});
    const got=await exchange({request,target:'telemetry',url,kind:'routing.window',signal}),value=httpValue(got);
    need(plain(value)&&plain(value.report)&&Array.isArray(value.rows),'PROVIDER_SHAPE','Route response requires report and rows',{observation:got.observation});
    const seen=new Set();
    for(const row of value.rows){
      need(plain(row),'PROVIDER_SHAPE','Route rows must be objects',{observation:got.observation});
      if(row.id!==undefined){const id=String(row.id);need(!seen.has(id),'DUPLICATE_PROVIDER_ROW','Route window repeats an original row ID',{observation:got.observation});seen.add(id);}
      need(row.network===undefined||row.network===network,'NETWORK_MISMATCH','Route row belongs to another network',{observation:got.observation});
      if(args.strategy_id)need(row.strategy_id===args.strategy_id,'QUERY_MISMATCH','Route row belongs to another strategy',{observation:got.observation});
    }
    const coverage={kind:'latest-window',complete:false,network,returnedRows:value.rows.length,maximumRows:args.limit||500,allTimeAggregate:true,query:{strategy_id:args.strategy_id||null},startsAt:args.startsAt||null,endsAt:args.endsAt||null,hasProviderCursor:false};
    const content={kind:'routing.window',network,rows:value.rows,report:value.report,selectedRows:selected(value.rows,args,'ts'),coverage};
    got.observation.parsed=content;got.observation.coverage=coverage;
    return {status:'COMPLETED',content,observations:[got.observation],pagination:{complete:true,coverage}};
  }
  async function transaction(request,signal){
    const hash=request.args.hash.toLowerCase(),observations=[],providerErrors=[];let rpcResult=null;
    try{
      const got=await rpc(request,'getTransaction',{hash,xdrFormat:request.args.xdrFormat||'base64'},'transaction.rpc',signal);
      observations.push(got.observation);rpcResult=got.result;
      need(rpcResult.txHash===undefined||rpcResult.txHash.toLowerCase()===hash,'TRANSACTION_MISMATCH','RPC returned a different transaction',{observation:got.observation});
      need(['SUCCESS','FAILED','NOT_FOUND'].includes(rpcResult.status),'PROVIDER_SHAPE','Unknown original RPC transaction status',{observation:got.observation});
      if(rpcResult.status!=='NOT_FOUND'){
        const content={kind:'transaction.record',network,hash,provider:'rpc',status:rpcResult.status,successful:rpcResult.status==='SUCCESS',record:rpcResult};
        got.observation.parsed=content;return {status:'COMPLETED',content,observations};
      }
    }catch(error){
      if(error.detail?.observation&&!observations.some(o=>o.id===error.detail.observation.id))observations.push(error.detail.observation);
      if(['TRANSACTION_MISMATCH','PROVIDER_SHAPE'].includes(error.code))throw error;
      providerErrors.push({provider:'rpc',code:error.code||'RPC_ERROR',message:redact(error.message)});
    }
    if(signal?.aborted)return {status:'UNCERTAIN',content:{kind:'transaction.record',network,hash,status:'NOT_RESOLVED',rpcResult,providerErrors},observations};
    try{
      const got=await exchange({request,target:'horizon',url:endpoint(horizonUrl,'transactions/'+hash),kind:'transaction.horizon',signal});
      observations.push(got.observation);
      if(got.response.status===404)return {status:'PARTIAL',content:{kind:'transaction.record',network,hash,status:'NOT_FOUND',successful:null,rpcResult,providerErrors},observations};
      const value=httpValue(got);
      need(plain(value)&&typeof value.hash==='string'&&value.hash.toLowerCase()===hash,'TRANSACTION_MISMATCH','Horizon returned a different transaction',{observation:got.observation});
      need(typeof value.successful==='boolean','PROVIDER_SHAPE','Horizon transaction requires its original successful value',{observation:got.observation});
      const content={kind:'transaction.record',network,hash,provider:'horizon',status:value.successful?'SUCCESS':'FAILED',successful:value.successful,record:value,rpcResult,providerErrors};
      got.observation.parsed=content;return {status:'COMPLETED',content,observations};
    }catch(error){
      if(error.detail?.observation&&!observations.some(o=>o.id===error.detail.observation.id))observations.push(error.detail.observation);
      providerErrors.push({provider:'horizon',code:error.code||'HORIZON_ERROR',message:redact(error.message)});
      return {status:'PARTIAL',content:{kind:'transaction.record',network,hash,status:'NOT_RESOLVED',successful:null,rpcResult,providerErrors},observations};
    }
  }
  async function events(request,signal){
    const args=request.args,limit=args.limit||1000,params={pagination:{limit},xdrFormat:args.xdrFormat||'base64'};
    if(args.filters)params.filters=args.filters;
    if(args.cursor)params.pagination.cursor=args.cursor;
    else{params.startLedger=args.startLedger;if(args.endLedger!==undefined)params.endLedger=args.endLedger;}
    const got=await rpc(request,'getEvents',params,'network.events',signal),value=got.result;
    need(Array.isArray(value.events)&&Number.isSafeInteger(value.latestLedger),'PROVIDER_SHAPE','getEvents response requires events and latestLedger',{observation:got.observation});
    const endLedger=args.endLedger??value.latestLedger+1,rows=value.events;let prior=null;
    for(const row of rows){
      need(plain(row)&&typeof row.id==='string'&&Number.isSafeInteger(row.ledger),'PROVIDER_SHAPE','Event requires an original ID and ledger',{observation:got.observation});
      need(prior===null||row.id>prior,'CURSOR_ORDER','Event IDs do not follow original ascending order',{observation:got.observation});prior=row.id;
    }
    const selectedEvents=rows.filter(e=>e.ledger>=args.startLedger&&e.ledger<endLedger);
    const passedEnd=rows.some(e=>e.ledger>=endLedger);
    const exhausted=rows.length<limit&&value.latestLedger>=endLedger-1;
    const complete=passedEnd||exhausted;
    if(!complete)need(typeof value.cursor==='string'&&value.cursor.length&&value.cursor!==args.cursor,'CURSOR_STALLED','RPC event cursor did not advance',{observation:got.observation});
    const coverage={kind:'ledger-window',complete,network,startLedger:args.startLedger,endLedger,latestLedger:value.latestLedger,oldestLedger:value.oldestLedger??null,latestLedgerCloseTime:value.latestLedgerCloseTime??null,oldestLedgerCloseTime:value.oldestLedgerCloseTime??null,returnedRows:rows.length,selectedRows:selectedEvents.length};
    const content={kind:'network.events',network,events:selectedEvents,providerEvents:rows,cursor:value.cursor||null,coverage};
    got.observation.parsed=content;got.observation.coverage=coverage;
    return {status:complete?'COMPLETED':'PARTIAL',content,observations:[got.observation],pagination:{complete,...(complete?{}:{cursor:value.cursor,nextArgs:{...args,endLedger,cursor:value.cursor}}),coverage}};
  }
  async function history(request){
    const path=await selectedHistoryPath(request.args.path),handle=await fs.open(path,'r');let before,after,bytes;
    try{before=await handle.stat({bigint:true});need(before.isFile(),'INVALID_HISTORY_PATH','History must remain a regular file');bytes=await handle.readFile();after=await handle.stat({bigint:true});}finally{await handle.close();}
    const changed=String(before.size)!==request.original.size||String(before.mtimeNs)!==request.original.mtimeNs||before.size!==after.size||before.mtimeNs!==after.mtimeNs||String(before.ino)!==request.original.inode;
    const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),parsed=jsonLineRows(text,request.args.format||'jsonl');
    const coverage={kind:'selected-original-file',complete:!changed&&!parsed.errors.length,network,path:request.args.path,sourceBytes:bytes.length,rows:parsed.rows.length,invalidLines:parsed.errors.length,changedDuringAcquisition:changed,startsAt:request.args.startsAt||null,endsAt:request.args.endsAt||null};
    const kind=request.args.kind||'keeper.history';
    const content={kind,network,rows:parsed.rows,lines:parsed.lines,errors:parsed.errors,numberPreservation:parsed.numberPreservation,coverage};
    const observation={schema:'stellar-forge.turbolong-operations-observation.v1',id:'history-'+sha(bytes),kind,operationId:request.id,observedAt:now(),network,request:{method:'READ',path:request.args.path},response:{status:200,...bodyDescriptor(bytes)},parsed:content,coverage,original:request.original};
    return {status:coverage.complete?'COMPLETED':'PARTIAL',content,observations:[observation],pagination:{complete:true,coverage}};
  }
  async function inspectSurfaces(request,signal){
    const ids=request.args.surfaces||surfaces.map(s=>s.id),observations=[],rows=[];
    for(const id of ids){
      const surface=surfaces.find(s=>s.id===id);need(surface,'UNKNOWN_SURFACE','Surface is not configured: '+id);
      const start=Date.now();let observation;
      try{
        const body=surface.kind==='rpc-health'?JSON.stringify({jsonrpc:'2.0',id:request.id,method:'getHealth',params:{}}):undefined;
        const got=await exchange({request,target:surface.kind==='rpc-health'?'rpc':'surfaces',url:surface.url,method:body?'POST':'GET',body,kind:'surface.observation',signal,headers:body?{'Content-Type':'application/json'}:{}});
        observation=got.observation;let healthy=surface.expectedStatus===undefined?got.response.ok:got.response.status===surface.expectedStatus;
        const checks={http:healthy};
        if(surface.requiredText!==undefined){checks.requiredText=got.bytes.toString('utf8').includes(surface.requiredText);healthy=healthy&&checks.requiredText;}
        if(surface.kind==='rpc-health'){checks.rpc=got.parsed?.jsonrpc==='2.0'&&got.parsed?.id===request.id&&!got.parsed?.error&&got.parsed?.result?.status==='healthy';healthy=healthy&&checks.rpc;}
        const row={surfaceId:id,name:surface.name||id,url:publicURL(surface.url),observedAt:observation.observedAt,completedAt:observation.completedAt,network,healthy,status:got.response.status,durationMs:Date.now()-start,checks,provider:surface.kind==='rpc-health'?got.parsed?.result||null:null};
        rows.push(row);observation.parsed={kind:'surface.observations',network,rows:[row]};
      }catch(error){
        observation=error.detail?.observation;
        rows.push({surfaceId:id,name:surface.name||id,url:publicURL(surface.url),observedAt:observation?.observedAt||now(),network,healthy:false,status:null,durationMs:Date.now()-start,error:{code:error.code||'TRANSPORT_ERROR',message:redact(error.message)}});
        if(observation)observation.parsed={kind:'surface.observations',network,rows:[rows.at(-1)]};
      }
      if(observation)observations.push(observation);
      if(signal?.aborted)break;
    }
    const content={kind:'surface.observations',network,rows,coverage:{kind:'point-observations',complete:rows.length===ids.length,requestedSurfaces:ids,observedSurfaces:rows.map(r=>r.surfaceId)}};
    return {status:rows.length===ids.length?'COMPLETED':'PARTIAL',content,observations};
  }
  async function perform({request,signal}={}) {
    const definition=checkRequest(request);
    return captures.run([],async()=>{let nativeDispatchStarted=false;
    try{
      if(definition.transport==='original-runtime'){const selected=await runtime();nativeDispatchStarted=true;return await selected.perform({request,signal});}
      if(request.action==='snapshots.list')return await snapshots(request,signal);
      if(request.action==='routes.list')return await routes(request,signal);
      if(request.action==='transaction.inspect')return await transaction(request,signal);
      if(request.action==='events.list')return await events(request,signal);
      if(request.action==='keeper.history.import')return await history(request);
      if(request.action==='surfaces.inspect')return await inspectSurfaces(request,signal);
      throw problem('UNKNOWN_ACTION','No transport for '+request.action);
    }catch(error){
      if(error.detail?.observation)retainObservation(error.detail.observation);
      return {status:nativeDispatchStarted&&request.mutates?'UNCERTAIN':'FAILED',content:{kind:getTurbolongAction(request.action).resultKind,error:{code:error.code||error.name||'TRANSPORT_ERROR',message:redact(error.message||String(error)),...(error.detail?.providerError?{providerError:JSON.parse(redact(JSON.stringify(error.detail.providerError)))}:{})}},observations:[...(captures.getStore()||[])]};
    }
    });
  }
  async function reconcile({operation,signal}={}) {
    assertOpen();const request=operation?.request||operation?.preparedRequest||operation?.prepared||operation;
    checkRequest(request);
    if(request.transport==='original-runtime')return (await runtime()).reconcile({operation,signal});
    const result=await perform({request,signal});
    return {...result,reconciliation:{mode:'fresh-read',originalRequestId:request.id,originalRequestSha256:request.requestSha256,observedAt:now()}};
  }
  async function close(){
    closed=true;for(const controller of active)controller.abort(new Error('Turbolong connection closed'));active.clear();
    if(runtimePromise){try{await (await runtimePromise).close?.();}catch{}}
  }
  return {describe,catalog,prepare,perform,reconcile,close};
}

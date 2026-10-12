// MIT. Original ElementPay HTTP/RPC source and its two distinct webhook protocols.
import {createHmac,timingSafeEqual,randomUUID} from 'node:crypto';
import {openHorizonSource} from '../settlement-audit/horizon-native.mjs';
import {openSDPSource} from '../settlement-audit/sdp-native.mjs';
import {normalizeNetwork} from '../settlement-audit/native-http.mjs';
import {InvoiceError,need,object,text,clone,sha256,integerText,canonicalHash,parseInvoiceJSON,iso} from './lossless-json.mjs';
import {invoiceEventTopics,decodeInvoiceLog,INVOICE_EVENT_PROFILES} from './events.mjs';
export {parseInvoiceJSON} from './lossless-json.mjs';
const EVENT_PATHS={OrderCreated:'/events/order-created',OrderSettled:'/events/order-settled',OrderRefunded:'/events/order-refunded'};
const ORDER_STATUS=['pending','failed','settled','settled_unverified','refunded'];
const EVM_KINDS=['chain','head','block','code','storage','call','logs','transaction','receipt'];
const JSON_OBJECT=properties=>({type:'object',properties,additionalProperties:false});
const STRING={type:'string'},INTEGER={type:'integer',minimum:0};
const ELEMENT_CATALOG={
  orders:{method:'GET',path:'/orders/me',recordsPath:'/data',pagination:'offset-observation',
    filtersSchema:JSON_OBJECT({status_filter:{enum:ORDER_STATUS},order_type:{enum:['onramp','offramp']},limit:{type:'integer',minimum:1,maximum:200},offset:INTEGER})},
  order:{method:'GET',path:'/orders/{order_id}',recordsPath:'/data',pagination:'none',
    filtersSchema:{...JSON_OBJECT({orderId:{type:'string',pattern:'^(0x)?[0-9a-fA-F]{64}$'}}),required:['orderId']}},
  orderByTransaction:{method:'GET',path:'/orders/tx/{tx_hash}',recordsPath:'/data',pagination:'none',
    filtersSchema:{...JSON_OBJECT({transactionHash:STRING}),required:['transactionHash']}},
};
const EVM_CATALOG={
  chain:{rpcMethod:'eth_chainId',recordsPath:'/result',filtersSchema:JSON_OBJECT({}),pagination:'none'},
  head:{rpcMethod:'eth_blockNumber',recordsPath:'/result',filtersSchema:JSON_OBJECT({}),pagination:'none'},
  block:{rpcMethod:'eth_getBlockByNumber',recordsPath:'/result',filtersSchema:{...JSON_OBJECT({blockNumber:STRING,fullTransactions:{type:'boolean'}}),required:['blockNumber']},pagination:'none'},
  code:{rpcMethod:'eth_getCode',recordsPath:'/result',filtersSchema:{...JSON_OBJECT({address:{type:'string',pattern:'^0x[0-9a-fA-F]{40}$'},blockNumber:STRING}),required:['address','blockNumber']},pagination:'none'},
  storage:{rpcMethod:'eth_getStorageAt',recordsPath:'/result',filtersSchema:{...JSON_OBJECT({address:{type:'string',pattern:'^0x[0-9a-fA-F]{40}$'},position:STRING,blockNumber:STRING}),required:['address','position','blockNumber']},pagination:'none'},
  call:{rpcMethod:'eth_call',recordsPath:'/result',filtersSchema:{...JSON_OBJECT({address:{type:'string',pattern:'^0x[0-9a-fA-F]{40}$'},data:{type:'string',pattern:'^0x([0-9a-fA-F]{2})*$'},blockNumber:STRING}),required:['address','data','blockNumber']},pagination:'none'},
  logs:{rpcMethod:'eth_getLogs',recordsPath:'/result',filtersSchema:{...JSON_OBJECT({fromBlock:STRING,throughBlock:STRING,events:{type:'array',items:{enum:Object.keys(EVENT_PATHS)},minItems:1,uniqueItems:true}}),required:['fromBlock','throughBlock']},pagination:'frozen-block-range'},
  transaction:{rpcMethod:'eth_getTransactionByHash',recordsPath:'/result',filtersSchema:{...JSON_OBJECT({transactionHash:STRING}),required:['transactionHash']},pagination:'none'},
  receipt:{rpcMethod:'eth_getTransactionReceipt',recordsPath:'/result',filtersSchema:{...JSON_OBJECT({transactionHash:STRING}),required:['transactionHash']},pagination:'none'},
};
function catalogue(definitions){
  return Object.entries(definitions).map(([kind,definition])=>({kind,...definition,
    inputSchema:{...JSON_OBJECT({kind:{const:kind},filters:definition.filtersSchema,pageSize:{type:'integer',minimum:1},cursor:{type:['string','null']}}),required:['kind']}}));
}
function runtimeOptions(connection){return connection.runtime??{installationDirectory:connection.installationDirectory,runtimeDirectory:connection.runtimeDirectory,expectedManifestSha256:connection.expectedManifestSha256};}
function runtimePublic(runtime){
  return runtime?{id:runtime.id,manifestSha256:runtime.manifestSha256,version:runtime.version??runtime.manifest?.version??'6.13.5'}:null;
}
function selectedNetwork(provider,connection){
  if(provider==='evm'){
    const chainId=integerText(connection.chainId??String(connection.network??'').replace(/^eip155:/,''),'chainId',{hex:true});
    need(BigInt(chainId)>0n,'INVALID_NETWORK','Select the original positive EVM chain ID.');
    return {network:'eip155:'+chainId,chainId};
  }
  if(['horizon','sdp'].includes(provider))return {network:normalizeNetwork(connection.network),chainId:null};
  return {network:text(connection.network,'network',1024),chainId:null};
}
function connectionTransport(provider,connection,{requireScope=false}={}){
  object(connection,'connection');let base;
  try{base=new URL(connection.baseUrl);}catch{throw new InvoiceError('CONNECTION_REQUIRED','Configure the original service base URL.');}
  need(!base.username&&!base.password&&!base.hash&&(provider==='evm'||!base.search),'INVALID_CONNECTION','Select the original service URL without userinfo or fragment; native RPC query credentials remain in private connection configuration.');
  need(base.protocol==='https:'||(base.protocol==='http:'&&connection.allowHttp===true),'INVALID_CONNECTION','Use HTTPS or explicitly select a private HTTP connection.');
  const rpcEndpoint=new URL(base.href);base.pathname=base.pathname.replace(/\/+$/,'')+'/';
  const accountScope=connection.accountScope??connection.merchantId??null;
  if(requireScope)text(accountScope,'accountScope',1024);
  const selected=selectedNetwork(provider==='listener'?'elementpay':provider,connection);
  const descriptor={provider,...selected,origin:base.origin,basePathSha256:sha256(base.pathname),accountScope};
  descriptor.id=sha256(descriptor);
  const timeoutMs=connection.timeoutMs??30000,maximumResponseBytes=connection.maximumResponseBytes??32*1024*1024;
  need(Number.isSafeInteger(timeoutMs)&&timeoutMs>=1&&timeoutMs<=300000,'INVALID_CONNECTION','Select a native request timeout between 1 and 300000 milliseconds.');
  need(Number.isSafeInteger(maximumResponseBytes)&&maximumResponseBytes>=1&&maximumResponseBytes<=256*1024*1024,'INVALID_CONNECTION','Select a bounded native response size.');
  function url(path,query={}){
    if(provider==='evm'){need(path==='/'&&Object.keys(query).length===0,'INVALID_ROUTE','The original RPC endpoint has no alternate route.');return new URL(rpcEndpoint.href);}
    need(typeof path==='string'&&path.startsWith('/')&&!path.startsWith('//')&&!path.includes('\\'),'INVALID_ROUTE','Select an original native route.');
    const result=new URL(path.slice(1),base);
    need(result.origin===base.origin&&result.pathname.startsWith(base.pathname),'INVALID_ROUTE','The native route escaped the selected service.');
    for(const [key,value] of Object.entries(query))if(value!==null&&value!==undefined)result.searchParams.set(key,String(value));
    return result;
  }
  async function exchange({path,query={},method='GET',body=null,headers={},metadata={},signal}){
    const target=url(path,query),request={provider,sourceScope:descriptor.id,method,path,query:clone(query),...clone(metadata)};
    if(body!==null)Object.assign(request,{bodySha256:sha256(body),bytes:body.length});
    const startedAt=new Date().toISOString(),started=performance.now(),controller=new AbortController();
    let reason='NATIVE_REQUEST_FAILED',status=null,responseHeaders={},complete=false,error=null,parts=[],size=0;
    const abort=()=>{reason='INTERRUPTED';controller.abort();};
    if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(()=>{reason='NATIVE_TIMEOUT';controller.abort();},timeoutMs);timer.unref?.();
    try{
      const selectedHeaders=new Headers(connection.headers??{});
      for(const [key,value] of Object.entries(headers))selectedHeaders.set(key,value);
      selectedHeaders.set('Accept','application/json');
      const response=await fetch(target,{method,headers:selectedHeaders,body,signal:controller.signal,redirect:'manual'});
      status=response.status;responseHeaders=Object.fromEntries(response.headers);
      if(response.body){
        const reader=response.body.getReader();
        try{for(;;){const {done,value}=await reader.read();if(done){complete=true;break;}
          if(size+value.length>maximumResponseBytes){const count=maximumResponseBytes-size;if(count>0)parts.push(Buffer.from(value.subarray(0,count)));size=maximumResponseBytes;reason='NATIVE_RESPONSE_TOO_LARGE';await reader.cancel();break;}
          parts.push(Buffer.from(value));size+=value.length;
        }}finally{reader.releaseLock();}
      }else complete=true;
      if(!complete)error={code:reason,message:'The original native response ended before its complete body was retained.'};
      else if(status<200||status>=300)error={code:'NATIVE_HTTP_ERROR',message:'The original service returned HTTP '+status+'.',details:{status,retryAfter:responseHeaders['retry-after']??null}};
    }catch{error={code:reason,message:reason==='INTERRUPTED'?'The native request was interrupted.':'The selected native service did not return a complete response.'};}
    finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
    const response={status,headers:responseHeaders,body:Buffer.concat(parts),bodyComplete:complete,startedAt,observedAt:new Date().toISOString(),elapsedMs:Math.max(0,Math.round(performance.now()-started))};
    let value=null,numericLexemes={};
    if(complete&&response.body.length){try{const parsed=parseInvoiceJSON(response.body,{maximumBytes:maximumResponseBytes});value=parsed.value;numericLexemes=parsed.numericLexemes;}catch(problem){if(!error)error={code:problem.code??'INVALID_NATIVE_JSON',message:problem.message};}}
    return {request,response,value,numericLexemes,records:[],recordsPath:null,continuation:{done:true,next:null},error};
  }
  return {descriptor,url,exchange};
}
function filters(input,allowed){
  const value=object(input.filters??{},'filters');
  for(const key of Object.keys(value))need(allowed.includes(key),'INVALID_FILTER','The original native route does not accept '+key+'.',{kind:input.kind,field:key});
  return Object.fromEntries(Object.entries(value).filter(([,value])=>value!==undefined&&value!==null&&value!==''));
}
function bounded(value,name,defaultValue,maximum){
  const result=value??defaultValue;need(Number.isSafeInteger(result)&&result>=1&&result<=maximum,'INVALID_ARGUMENT',name+' is outside its supported native range.');return result;
}
function errorResult(result,error){return {...result,records:[],continuation:{done:true,next:null},error:{code:error.code??'NATIVE_SCHEMA_ERROR',message:error.message,details:error.details??{}}};}
function continuationInput(input){const result=clone({...input,signal:undefined});delete result.signal;return result;}
export function openInvoiceSource(connection){
  object(connection,'connection');const provider=connection.provider;
  if(provider==='horizon'||provider==='sdp'){
    const original=provider==='horizon'?openHorizonSource(connection):openSDPSource(connection);
    return {describe(){
      const descriptor=original.describe(),kinds=descriptor.kinds;
      const entries=Object.entries(kinds).map(([kind,entry])=>{
        const properties=Object.fromEntries((entry.filters??[]).map(key=>[key,['include_failed','enabled','include_deleted','user_managed'].includes(key)?{type:'boolean'}:STRING]));
        return {kind,...entry,filtersSchema:JSON_OBJECT(properties),inputSchema:{type:'object',properties:{kind:{const:kind},id:STRING,filters:JSON_OBJECT(properties),pageSize:{type:'integer',minimum:1,maximum:entry.maximumPageSize??200},cursor:{type:['string','null']}},required:['kind'],additionalProperties:false}};
      });
      return {...descriptor,catalog:entries,kinds:Object.fromEntries(entries.map(entry=>[entry.kind,entry]))};
    },async read(input){const result=await original.read(input);result.recordsPath=original.describe().kinds[input.kind]?.recordsPath??'';return result;}};
  }
  if(provider==='elementpay'){
    const transport=connectionTransport(provider,connection,{requireScope:true});
    const catalog=catalogue(ELEMENT_CATALOG);
    return {describe:()=>({...transport.descriptor,catalog,kinds:Object.fromEntries(catalog.map(item=>[item.kind,item])),consistency:'Original offset pages are mutable observations; the API does not publish a snapshot token.'}),async read(input={}){
      object(input,'read');const entry=ELEMENT_CATALOG[input.kind];need(entry,'UNKNOWN_NATIVE_KIND','Select an original ElementPay read kind.');
      const f=filters(input,Object.keys(entry.filtersSchema.properties)),headers={};
      if(connection.apiKey!==undefined)headers['X-API-Key']=text(connection.apiKey,'apiKey',16384);
      else need(new Headers(connection.headers??{}).has('X-API-Key'),'CONNECTION_REQUIRED','Configure the original private ElementPay API key.');
      let path=entry.path,query={},offset=null,limit=null;
      if(input.kind==='orders'){
        if(f.status_filter!==undefined)need(ORDER_STATUS.includes(f.status_filter),'INVALID_FILTER','Select an original order status_filter.');
        if(f.order_type!==undefined)need(['onramp','offramp'].includes(f.order_type),'INVALID_FILTER','Select onramp or offramp.');
        limit=bounded(f.limit??input.pageSize,'limit',50,200);
        offset=Number(integerText(input.cursor??f.offset??0,'offset'));
        need(Number.isSafeInteger(offset),'INVALID_CURSOR','The original offset exceeds the safe request range.');
        query={...f,limit,offset};delete query.orderId;
      }else{
        need(input.cursor===undefined||input.cursor===null,'INVALID_CURSOR','The original detail route has no pagination cursor.');
        if(input.kind==='order'){need(canonicalHash(f.orderId),'INVALID_ORDER_ID','Use the original 32-byte hexadecimal order ID.');path=path.replace('{order_id}',encodeURIComponent(f.orderId));}
        else path=path.replace('{tx_hash}',encodeURIComponent(text(f.transactionHash,'transactionHash',255)));
      }
      const result=await transport.exchange({path,query,headers,metadata:{kind:input.kind,filters:clone(f),cursor:input.cursor??null},signal:input.signal});
      if(result.error)return result;
      try{
        object(result.value,'native response');need(result.value.status==='success','NATIVE_API_ERROR','The original API did not report success.');
        const data=result.value.data;result.recordsPath='/data';
        if(input.kind==='orders'){
          need(Array.isArray(data),'NATIVE_SCHEMA_ERROR','The original order page has no data array.');
          need(data.length<=limit,'NATIVE_SCHEMA_ERROR','The original order page exceeds its selected native limit.');
          data.forEach(row=>object(row,'native order'));result.records=data;
          if(data.length===limit){need(offset+limit<=Number.MAX_SAFE_INTEGER,'INVALID_CURSOR','The original offset exceeds its safe range.');result.continuation={done:false,next:{...continuationInput(input),cursor:String(offset+limit),pageSize:limit}};}
        }else{object(data,'native order');if(input.kind==='order')need(canonicalHash(data.order_id)===canonicalHash(f.orderId),'NATIVE_SELECTION_CHANGED','The original order detail belongs to another order.');else if(data.creation_transaction_hash)need((canonicalHash(data.creation_transaction_hash)??data.creation_transaction_hash)===(canonicalHash(f.transactionHash)??f.transactionHash),'NATIVE_SELECTION_CHANGED','The original order detail belongs to another transaction.');result.records=[data];}
        return result;
      }catch(error){return errorResult(result,error);}
    }};
  }
  need(provider==='evm','INVALID_PROVIDER','Select elementpay, evm, horizon or sdp.');
  const transport=connectionTransport(provider,connection);
  const contract=connection.contract===undefined||connection.contract===null?null:text(connection.contract,'contract',42);
  need(contract===null||/^0x[0-9a-fA-F]{40}$/.test(contract),'INVALID_CONTRACT','Select the original deployed EVM contract address.');
  const eventProfile=connection.eventProfile??'all';need(INVOICE_EVENT_PROFILES.includes(eventProfile),'INVALID_EVENT_PROFILE','Select all, listener-v2 or elementflow-v1.');
  transport.descriptor.contract=contract?.toLowerCase()??null;transport.descriptor.eventProfile=eventProfile;const scope={...transport.descriptor};delete scope.id;transport.descriptor.id=sha256(scope);
  let loadedRuntime=null;const catalog=catalogue(EVM_CATALOG);
  const describe=()=>({...transport.descriptor,contract,catalog,kinds:Object.fromEntries(catalog.map(item=>[item.kind,item])),runtime:runtimePublic(loadedRuntime),consistency:'Frozen native block ranges; retain original block hashes and explicit canonical observations.'});
  async function read(input={}){
    object(input,'read');need(EVM_KINDS.includes(input.kind),'UNKNOWN_NATIVE_KIND','Select an original EVM read kind.');
    const f=filters(input,Object.keys(EVM_CATALOG[input.kind].filtersSchema.properties)),selected=continuationInput(input);
    let params=[],range=null,topics=null;
    if(input.kind==='logs'){
      need(contract,'CONTRACT_REQUIRED','Select the original deployed contract before capturing its listener logs.');
      const start=BigInt(integerText(f.fromBlock,'fromBlock')),through=BigInt(integerText(f.throughBlock,'throughBlock'));
      need(start<=through,'INVALID_RANGE','The selected first block must not follow its last block.');
      const next=input.cursor===undefined||input.cursor===null?start:BigInt(integerText(input.cursor,'cursor'));
      need(next>=start&&next<=through,'INVALID_CURSOR','The original range cursor is outside its frozen selection.');
      const span=BigInt(bounded(input.pageSize,'pageSize',2000,100000)),end=next+span-1n<through?next+span-1n:through;
      const prepared=await invoiceEventTopics({runtime:runtimeOptions(connection),events:f.events,eventProfile});loadedRuntime=prepared.runtime;topics=prepared.topics;
      range={fromBlock:next.toString(),throughBlock:end.toString(),selectedFromBlock:start.toString(),selectedThroughBlock:through.toString()};
      params=[{address:contract,fromBlock:'0x'+next.toString(16),toBlock:'0x'+end.toString(16),topics:[topics]}];
    }else{
      need(input.cursor===undefined||input.cursor===null,'INVALID_CURSOR','The selected original RPC read has no cursor.');
      if(input.kind==='block'){const block=integerText(f.blockNumber,'blockNumber');need(f.fullTransactions===undefined||typeof f.fullTransactions==='boolean','INVALID_FILTER','fullTransactions must be a boolean.');params=['0x'+BigInt(block).toString(16),f.fullTransactions??false];}
      else if(input.kind==='call'){
        need(/^0x[0-9a-fA-F]{40}$/.test(f.address??'')&&typeof f.data==='string'&&/^0x(?:[0-9a-fA-F]{2})*$/.test(f.data),'INVALID_CALL','Select the original target address and complete call data bytes.');
        params=[{to:f.address,data:f.data},'0x'+BigInt(integerText(f.blockNumber,'blockNumber')).toString(16)];
      }
      else if(input.kind==='code'||input.kind==='storage'){
        need(/^0x[0-9a-fA-F]{40}$/.test(f.address??''),'INVALID_ADDRESS','Select the original account or contract address.');
        const block='0x'+BigInt(integerText(f.blockNumber,'blockNumber')).toString(16);
        params=input.kind==='code'?[f.address,block]:[f.address,'0x'+BigInt(integerText(f.position,'position',{hex:true})).toString(16),block];
      }
      else if(input.kind==='transaction'||input.kind==='receipt'){const hash=canonicalHash(f.transactionHash);need(hash,'INVALID_TRANSACTION_HASH','Select the original EVM transaction hash.');params=[hash];}
    }
    const rpcId=sha256({sourceScope:transport.descriptor.id,selected,params}),rpcMethod=EVM_CATALOG[input.kind].rpcMethod;
    const body=Buffer.from(JSON.stringify({jsonrpc:'2.0',id:rpcId,method:rpcMethod,params}));
    const result=await transport.exchange({path:'/',method:'POST',body,headers:{'Content-Type':'application/json'},metadata:{kind:input.kind,filters:clone(f),cursor:input.cursor??null,rpcMethod,params,range,eventProfile},signal:input.signal});
    result.runtime=runtimePublic(loadedRuntime);result.recordsPath='/result';
    if(result.error)return result;
    try{
      object(result.value,'RPC response');need(result.value.jsonrpc==='2.0'&&result.value.id===rpcId,'RPC_RESPONSE_MISMATCH','The original RPC response ID differs from its request.');
      if(result.value.error)throw new InvoiceError('NATIVE_RPC_ERROR','The original RPC returned an error.',{rpcError:clone(result.value.error)});
      need(Object.hasOwn(result.value,'result'),'NATIVE_SCHEMA_ERROR','The original RPC response has no result.');
      const value=result.value.result;
      if(input.kind==='chain'){
        const actual=integerText(value,'native chainId',{hex:true});need(actual===transport.descriptor.chainId,'NETWORK_MISMATCH','The original RPC belongs to another chain.',{expected:transport.descriptor.chainId,observed:actual});
        result.records=[value];
      }else if(input.kind==='head'){integerText(value,'native head',{hex:true});result.records=[value];}
      else if(input.kind==='logs'){
        need(Array.isArray(value),'NATIVE_SCHEMA_ERROR','The original log response is not an array.');
        for(const log of value){
          object(log,'native log');need(String(log.address).toLowerCase()===contract.toLowerCase(),'NATIVE_SELECTION_CHANGED','A returned log belongs to another contract.');
          const block=BigInt(integerText(log.blockNumber,'native blockNumber',{hex:true}));
          need(block>=BigInt(range.fromBlock)&&block<=BigInt(range.throughBlock),'NATIVE_SELECTION_CHANGED','A returned log lies outside its original requested range.');
          need(Array.isArray(log.topics)&&topics.includes(log.topics[0]),'NATIVE_SELECTION_CHANGED','A returned log does not match the selected original event topics.');
        }
        result.records=value;const end=BigInt(range.throughBlock),through=BigInt(range.selectedThroughBlock);
        if(end<through)result.continuation={done:false,next:{...selected,cursor:(end+1n).toString()}};
      }else if(input.kind==='code'||input.kind==='storage'||input.kind==='call'){
        need(typeof value==='string'&&/^0x(?:[0-9a-fA-F]{2})*$/.test(value),'NATIVE_SCHEMA_ERROR','The original RPC value must contain complete native data bytes.');
        if(input.kind==='storage')need(value.length===66,'NATIVE_SCHEMA_ERROR','The original EVM storage value must contain one complete 32-byte word.');
        result.records=[value];
      }else if(value===null)result.records=[];
      else{object(value,'native RPC record');if(input.kind==='receipt')need(canonicalHash(value.transactionHash)===params[0],'NATIVE_SELECTION_CHANGED','The original receipt belongs to another transaction.');if(input.kind==='transaction')need(canonicalHash(value.hash)===params[0],'NATIVE_SELECTION_CHANGED','The original transaction belongs to another hash.');if(input.kind==='block')need(integerText(value.number,'native block number',{hex:true})===integerText(f.blockNumber,'blockNumber'),'NATIVE_SELECTION_CHANGED','The original block belongs to another height.');result.records=[value];}
      return result;
    }catch(error){return errorResult(result,error);}
  }
  return {describe,read};
}
export function describeListenerBackend(connection){return connectionTransport('listener',connection,{requireScope:true}).descriptor;}
export async function prepareListenerDelivery({record,backend,runtime}){
  object(record,'source record');object(backend,'backend');
  need(record.provider==='evm'&&record.kind==='logs','INVALID_DELIVERY_SOURCE','Select an original retained listener log.');
  const event=await decodeInvoiceLog(record.original,{runtime:runtime??runtimeOptions(backend),network:record.network,chainId:record.projection?.chainId});
  need(event.known&&!event.removed,'INVALID_DELIVERY_SOURCE','Select an original supported event that is not marked removed.');
  const descriptor=backend.baseUrl?describeListenerBackend(backend):backend;
  need(typeof descriptor.id==='string'&&/^[0-9a-f]{64}$/.test(descriptor.id),'INVALID_BACKEND','Select the trusted original listener backend.');
  need(descriptor.network===record.network,'NETWORK_MISMATCH','The listener backend and source event must select the same network.');
  let payload;
  if(event.event==='OrderCreated')payload={orderId:event.orderId,requester:event.requester,token:event.token,amount:event.amount,messageHash:event.messageHash,orderType:event.orderType,transactionHash:record.original.transactionHash};
  else payload={orderId:event.orderId,transactionHash:record.original.transactionHash};
  const body=Buffer.from(JSON.stringify(payload)),path=EVENT_PATHS[event.event],bodySha256=sha256(body);
  const deliveryId=sha256({backendId:descriptor.id,sourceOccurrenceKey:event.sourceOccurrenceKey,path,bodySha256});
  return {schema:'stellar-forge.invoice-listener-delivery.v1',deliveryId,sourceRecordId:record.id,sourceOccurrenceKey:event.sourceOccurrenceKey,
    event:event.event,orderId:event.orderId,sourceBodySha256:record.projection?.bodySha256??sha256(record.original),backendId:descriptor.id,
    request:{method:'POST',path,contentType:'application/json',body,bodySha256,bytes:body.length},payload};
}
export async function sendListenerDelivery({connection,delivery,signal}){
  object(delivery,'delivery');const transport=connectionTransport('listener',connection,{requireScope:true});
  need(delivery.backendId===transport.descriptor.id,'BACKEND_CHANGED','The original delivery selects another backend scope.');
  const request=object(delivery.request,'original delivery request'),body=request.body;
  need(Buffer.isBuffer(body)&&sha256(body)===request.bodySha256&&body.length===request.bytes,'DELIVERY_SOURCE_CHANGED','The retained original request body differs from its prepared delivery.');
  need(request.method==='POST'&&EVENT_PATHS[delivery.event]===request.path,'INVALID_DELIVERY_ROUTE','The selected delivery is not an original listener route.');
  const identity=sha256({backendId:delivery.backendId,sourceOccurrenceKey:delivery.sourceOccurrenceKey,path:request.path,bodySha256:request.bodySha256});
  need(identity===delivery.deliveryId,'DELIVERY_SOURCE_CHANGED','The original delivery identity differs from its retained bytes.');
  const secret=text(connection.secret??connection.listenerWebhookSecret,'listenerWebhookSecret',65536);
  const timestamp=String(Math.floor(Date.now()/1000));
  const signature=createHmac('sha256',Buffer.from(secret,'utf8')).update(timestamp+'.').update(body).digest('hex');
  const result=await transport.exchange({path:request.path,method:'POST',body,
    headers:{'Content-Type':'application/json','X-EP-Timestamp':timestamp,'X-EP-Signature':'v1='+signature,'X-EP-Client':'listener'},
    metadata:{deliveryId:delivery.deliveryId,sourceOccurrenceKey:delivery.sourceOccurrenceKey,event:delivery.event,orderId:delivery.orderId,timestamp,signatureProtocol:'X-EP-v1-hex'},signal});
  const acknowledged=result.response.status>=200&&result.response.status<300&&result.response.bodyComplete;
  const interpretationError=acknowledged&&result.error?.code==='INVALID_SOURCE_JSON'?result.error:null;
  return {...result,...(interpretationError?{error:null,interpretationError}:{}),acknowledged,deliveryId:delivery.deliveryId};
}
export async function verifyCustomerWebhook({rawBody,headers,secret,receivedAt=new Date().toISOString(),sourceId,captureId=null,sourceScope,network}){
  need(Buffer.isBuffer(rawBody),'INVALID_WEBHOOK_BODY','Verify the exact original webhook bytes.');
  const selected=new Headers(headers),signature=selected.get('X-Webhook-Signature');
  need(typeof signature==='string','WEBHOOK_SIGNATURE_MISSING','The original X-Webhook-Signature is required.');
  const fields={};for(const component of signature.split(',')){const at=component.indexOf('=');need(at>0,'INVALID_WEBHOOK_SIGNATURE','The original signature header is malformed.');const key=component.slice(0,at).trim(),value=component.slice(at+1).trim();need(!Object.hasOwn(fields,key),'INVALID_WEBHOOK_SIGNATURE','A signature component is repeated.');fields[key]=value;}
  need(typeof fields.t==='string'&&/^(?:0|[1-9]\d*)$/.test(fields.t)&&fields.t.length<=16,'INVALID_WEBHOOK_TIMESTAMP','The original signature timestamp is invalid.');
  const timestamp=Number(fields.t),time=typeof receivedAt==='number'?receivedAt:Date.parse(receivedAt);
  need(Number.isSafeInteger(timestamp)&&Number.isFinite(time),'INVALID_WEBHOOK_TIMESTAMP','The original receipt timestamp is invalid.');
  need(Math.abs(Math.floor(time/1000)-timestamp)<=300,'WEBHOOK_EXPIRED','The original webhook timestamp exceeds its published five-minute tolerance.');
  need(typeof fields.v1==='string'&&/^[A-Za-z0-9+/]{43}=$/.test(fields.v1),'INVALID_WEBHOOK_SIGNATURE','The original signature is not canonical HMAC-SHA256 base64.');
  const actual=Buffer.from(fields.v1,'base64'),expected=createHmac('sha256',Buffer.from(text(secret,'webhook secret',65536),'utf8')).update(fields.t+'.').update(rawBody).digest();
  need(actual.length===expected.length&&timingSafeEqual(actual,expected),'WEBHOOK_SIGNATURE_MISMATCH','The original webhook signature does not match its exact body.');
  const id=text(selected.get('X-Webhook-Id'),'X-Webhook-Id',1024),event=text(selected.get('X-Webhook-Event'),'X-Webhook-Event',255);
  const parsed=parseInvoiceJSON(rawBody),observedAt=new Date(time).toISOString();
  const {normalizeInvoiceRecords}=await import('./reconciliation.mjs');
  const records=sourceId?await normalizeInvoiceRecords({provider:'elementpay',kind:'webhook',records:Array.isArray(parsed.value)?parsed.value:[parsed.value],sourceId,captureId,sourceScope:sourceScope??sourceId,observedAt,network,rawBody,recordsPath:'',webhook:{id,event}}):[];
  return {schema:'stellar-forge.invoice-webhook-receipt.v1',id,event,bodySha256:parsed.bodySha256,bytes:parsed.bytes,timestamp:fields.t,receivedAt:observedAt,
    headers:{'X-Webhook-Id':id,'X-Webhook-Event':event,'X-Webhook-Signature':signature},value:parsed.value,numericLexemes:parsed.numericLexemes,records};
}

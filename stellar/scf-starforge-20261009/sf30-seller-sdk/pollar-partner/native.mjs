// MIT. Original Pollar backend and scoped MCP operations with retained provider exchanges.
import {createHash,randomUUID} from 'node:crypto';
import {promises as fs} from 'node:fs';
import {isAbsolute} from 'node:path';
import {POLLAR_NATIVE_ACTIONS,getPollarAction,validatePollarArguments,validatePollarValue} from './catalogue.mjs';

const SERVER='https://server.api.pollar.xyz',MCP='https://mcp.api.pollar.xyz/mcp';
const PROTOCOL='2025-11-25',PROTOCOLS=new Set(['2025-03-26','2025-06-18','2025-11-25']);
const SOURCE='https://github.com/pollar-xyz/pollar-docs/tree/0a3b5384de21a5d1355df1cfeec4745e5f22496a';
const SCHEMA='stellar-forge.pollar-partner.native-request.v1';
const SECRET_FIELD=/^(?:authorization|cookie|set-cookie|access_?token|refresh_?token|id_?token|session_?token|private_?key|secret_?key|password|client_?secret|server_?key|personal_?access_?token|x-pollar-api-key|mcp-session-id)$/i;
const KEY_RESPONSE_FIELD=/^(?:key|value|token|secret|api_?key|raw_?key|secret_?key|publishable_?key|access_?token|refresh_?token|private_?key|personal_?access_?token)$/i;
const HASH=/^[a-f0-9]{64}$/,PUBLIC_KEY=/^G[A-Z2-7]{55}$/;
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null);
const own=(v,k)=>Object.prototype.hasOwnProperty.call(v,k);
const sha=value=>createHash('sha256').update(value).digest('hex');
const at=()=>new Date().toISOString();
function fail(code,message,details={}){const e=new Error(message??code);e.code=code;e.details=details;throw e;}
function need(ok,code,message,details){if(!ok)fail(code,message,details);}
function jsonValue(value,path='$'){
 if(value===null||typeof value==='string'||typeof value==='boolean')return value;
 if(typeof value==='number'){need(Number.isFinite(value)&&(!Number.isInteger(value)||Number.isSafeInteger(value)),'INVALID_JSON','Use finite original JSON numbers and exact integer values.',{path});return value;}
 if(Array.isArray(value))return value.map((v,i)=>jsonValue(v,path+'['+i+']'));
 need(plain(value),'INVALID_JSON','Use complete original JSON objects and values.',{path});
 const out={};for(const key of Object.keys(value).sort())Object.defineProperty(out,key,{value:jsonValue(value[key],path+'.'+key),enumerable:true});
 return out;
}
function parseProviderJSON(source){
 return JSON.parse(source,(key,value)=>{
  if(typeof value==='number')need(Number.isFinite(value)&&(!Number.isInteger(value)||Number.isSafeInteger(value)),
   'PROVIDER_NUMERIC_PRECISION','The original provider numeric token cannot be projected without integer precision loss.');
  return value;
 });
}
const canonical=value=>JSON.stringify(jsonValue(value));
const copy=value=>JSON.parse(canonical(value));
function errorPublic(error){return {code:String(error?.code??error?.name??'TRANSPORT_ERROR'),message:cleanText(String(error?.message??error)),details:plain(error?.details)?redact(error.details):null};}
function cleanText(value){return String(value).replace(/\b(?:sec_(?:mainnet|testnet)_|pat_)[A-Za-z0-9_-]+\b/g,'[redacted]');}
function redact(value,{keyResponse=false}={}){
 if(Array.isArray(value))return value.map(v=>redact(v,{keyResponse}));
 if(plain(value)){const result={};for(const[key,item]of Object.entries(value)){
  if(SECRET_FIELD.test(key)||(keyResponse&&KEY_RESPONSE_FIELD.test(key)))result[key]='[redacted]';
  else if(keyResponse&&key==='text'&&typeof item==='string'){
   try{result[key]=JSON.stringify(redact(JSON.parse(item),{keyResponse:true}));}catch{result[key]='[redacted one-time key response]';}
  }else result[key]=redact(item,{keyResponse});
 }return result;}
 return typeof value==='string'?cleanText(value):value;
}
function sealed(value){const body=copy(value);delete body.sha256;return {...body,sha256:sha(canonical(body))};}
function checked(value){
 need(plain(value)&&value.schema===SCHEMA,'INVALID_NATIVE_REQUEST','Use an original prepared Pollar request.');
 const body=copy(value);delete body.sha256;
 need(HASH.test(value.sha256??'')&&sha(canonical(body))===value.sha256,'NATIVE_REQUEST_CHANGED','The original prepared request changed.');
 return value;
}
function endpoint(input,{kind,allowHttp=false}){
 const url=new URL(input);
 need(!url.username&&!url.password&&!url.hash&&!url.search,'INVALID_CONNECTION','Keep credentials and query parameters out of the selected service endpoint.');
 need(url.protocol==='https:'||url.protocol==='http:'&&allowHttp&&['127.0.0.1','localhost','[::1]'].includes(url.hostname),
  'INVALID_CONNECTION','Select the original HTTPS service or explicit loopback development service.');
 if(kind==='server')need(url.pathname==='/'||url.pathname==='','INVALID_CONNECTION','Select the original server API origin; routes include /v1.');
 return kind==='server'?url.origin:url.href;
}
function finiteInteger(value,label,min=0){need(Number.isSafeInteger(value)&&value>=min,'INVALID_ARGUMENT','Use an integer '+label+'.');return value;}
function publicHeaders(headers){
 const result={};for(const[key,value]of headers.entries())result[key]=SECRET_FIELD.test(key)?'[redacted]':cleanText(value);return result;
}
function decodedTool(result){
 if(plain(result?.structuredContent))return result.structuredContent;
 const text=(result?.content??[]).filter(v=>v.type==='text'&&typeof v.text==='string');
 const parsed=[];for(const item of text){try{parsed.push(parseProviderJSON(item.text));}catch{}}
 if(parsed.length===1)return parsed[0];
 return {content:copy(result?.content??[]),...(parsed.length?{parsedContent:parsed}:{})};
}
function payloadOf(value){
 let row=value;const seen=new Set();
 for(let i=0;i<5&&plain(row);i++){
  if(seen.has(row))break;seen.add(row);
  if(own(row,'content')&&!Array.isArray(row.content)&&plain(row.content)){row=row.content;continue;}
  if(own(row,'data')&&plain(row.data)){row=row.data;continue;}
  break;
 }return row;
}
function pageShape(value,kind){
 let source=payloadOf(value);if(plain(source)&&plain(source[kind]))source=payloadOf(source[kind]);let rows=null,path=null;
 if(Array.isArray(source)){rows=source;path='$';}
 else if(plain(source)){
  const names=kind==='users'?['records','users','items','results','data','content']:['records','transactions','items','results','data','content'];
  const choices=names.filter(k=>Array.isArray(source[k]));
  if(choices.length===1){path=choices[0];rows=source[path];}
 }
 if(!rows)return null;
 const containers=[source,plain(value)?value:null,plain(source?.pagination)?source.pagination:null,plain(source?.meta)?source.meta:null].filter(plain);
 const field=names=>{for(const c of containers)for(const name of names)if(own(c,name))return c[name];return null;};
 return {rows,path,total:field(['total','totalCount','total_count']),limit:field(['limit','pageSize','page_size']),offset:field(['offset']),hasMore:field(['hasMore','has_more']),
  nextOffset:field(['nextOffset','next_offset'])};
}
function resultIds(value){
 const body=payloadOf(value),result={};
 if(!plain(body))return result;
 for(const field of ['id','applicationId','application_id','userId','user_id','publicKey','public_key','hash','transactionHash','transaction_hash','assetId','ruleId','keyId']){
  const item=body[field];if(typeof item==='string'&&item)result[field]=item;
 }return result;
}
function originalBoolean(value){
 const body=payloadOf(value);
 if(plain(body))for(const key of ['funded','isFunded','is_funded','exists'])if(typeof body[key]==='boolean')return {value:body[key],path:key};
 return null;
}
function publicEnvelope(exchange,outcome,extra={}){
 return {request:copy(exchange.request),response:exchange.response?copy(exchange.response):null,outcome:copy(outcome),
  observations:copy(exchange.observations??[]),...extra};
}
function makeSSEParser(onEvent){
 let pending='',data=[],event='',id=null,lastId=null;
 function dispatch(){
  if(data.length){const row={event:event||'message',id,data:data.join('\n')};onEvent(row);}
  if(id!==null)lastId=id;data=[];event='';id=null;
 }
 function line(value){
  if(value===''){dispatch();return;}
  if(value.startsWith(':'))return;
  const split=value.indexOf(':'),name=split<0?value:value.slice(0,split);let item=split<0?'':value.slice(split+1);
  if(item.startsWith(' '))item=item.slice(1);
  if(name==='data')data.push(item);else if(name==='event')event=item;else if(name==='id'&&!item.includes('\0'))id=item;
 }
 return {feed(chunk,{end=false}={}){
  pending+=chunk;let start=0;
  for(let i=0;i<pending.length;i++){
   if(pending[i]==='\n'){line(pending.slice(start,i));start=i+1;}
   else if(pending[i]==='\r'){
    if(i+1===pending.length&&!end)break;
    line(pending.slice(start,i));if(pending[i+1]==='\n')i++;start=i+1;
   }
  }
  pending=pending.slice(start);
  if(end){if(pending)line(pending);pending='';dispatch();}
 },lastId:()=>lastId};
}

/** Secrets enter only this host adapter. Prepared requests carry selected custody references. */
export async function openPollarOperatorConnection({connection={}}={}){
 need(plain(connection),'INVALID_CONNECTION','Supply the original private Pollar connection.');
 need(connection.provider===undefined||connection.provider==='pollar','INVALID_CONNECTION','Select the original Pollar provider.');
 const network=connection.network??null,applicationId=connection.applicationId??null;
 need(network===null||network==='testnet'||network==='mainnet','INVALID_CONNECTION','Select the original application network.');
 need(applicationId===null||typeof applicationId==='string'&&applicationId.length>0,'INVALID_CONNECTION','Supply the actual provider application ID.');
 const serverBaseUrl=endpoint(connection.serverBaseUrl??SERVER,{kind:'server',allowHttp:connection.allowHttp===true});
 const mcpUrl=endpoint(connection.mcpUrl??MCP,{kind:'mcp',allowHttp:connection.allowHttp===true});
 const timeout=finiteInteger(connection.requestTimeoutMs??45000,'request timeout',1);
 const credentialRefs={server:connection.serverCredentialRef??'pollar.serverSecretKey',mcp:connection.mcpCredentialRef??'pollar.personalAccessToken'};
 for(const value of Object.values(credentialRefs))need(typeof value==='string'&&value.length>0,'INVALID_CONNECTION','Use public custody-reference labels.');
 const publicSelection={provider:'pollar',applicationId,network,serverBaseUrl,mcpUrl,credentialRefs,
  contracts:{repository:'pollar-xyz/pollar-docs',commit:'0a3b5384de21a5d1355df1cfeec4745e5f22496a',sourceUrl:SOURCE}};
 const selection=sealed(publicSelection),controllers=new Set();let closed=false,session=null,initializing=null,discovery=null,discoveryPromise=null;
 const fetcher=connection.fetch??globalThis.fetch;need(typeof fetcher==='function','FETCH_REQUIRED','Use a native runtime with fetch.');
 function check(){need(!closed,'CONNECTION_CLOSED','Reopen the original private Pollar connection.');}
 async function credential(kind){
  const configured=kind==='server'?connection.serverSecretKey:connection.personalAccessToken;let value=configured;
  if(plain(configured)){
   const keys=Object.keys(configured);need(keys.length===1&&['env','file'].includes(keys[0]),'INVALID_CREDENTIAL_REFERENCE','Use one explicit private environment or file reference.');
   if(own(configured,'env')){need(typeof configured.env==='string'&&/^[A-Za-z_][A-Za-z0-9_]*$/.test(configured.env),'INVALID_CREDENTIAL_REFERENCE','Use the selected private environment name.');value=process.env[configured.env];}
   else{need(typeof configured.file==='string'&&isAbsolute(configured.file),'INVALID_CREDENTIAL_REFERENCE','Use the selected absolute private credential file.');value=(await fs.readFile(configured.file,'utf8')).trim();}
  }
  need(typeof value==='string'&&value.length>0,'CREDENTIAL_REQUIRED','Attach the selected private '+(kind==='server'?'server key':'personal access token')+'.',{credentialRef:credentialRefs[kind]});
  if(kind==='server'){
   need(/^sec_(testnet|mainnet)_[A-Za-z0-9_-]+$/.test(value),'INVALID_SERVER_KEY','Select the original server secret key.');
   if(network)need(value.startsWith('sec_'+network+'_'),'APPLICATION_NETWORK_MISMATCH','The selected server key belongs to another network.');
  }else need(/^pat_[A-Za-z0-9_-]+$/.test(value),'INVALID_PERSONAL_ACCESS_TOKEN','Select the original Pollar account personal access token.');
  return value;
 }
 function localRequest({action,args,transport,method,url,body,credentialKind,id=randomUUID(),schemaSource=null,originalRequestId=null}){
  body=body===null?null:copy(body);
  const bytes=body===null?null:Buffer.from(JSON.stringify(body),'utf8');
  const header={'accept':transport==='server'?'application/json':'application/json, text/event-stream'};
  if(bytes)header['content-type']='application/json';
  if(credentialKind==='server')header['x-pollar-api-key']='[redacted]';else header.authorization='[redacted]';
  return sealed({schema:SCHEMA,id,action,args:copy(args),connection:copy(selection),transport,method,url,headers:header,
   credentialRef:credentialRefs[credentialKind],body:body===null?null:copy(body),bodyBytes:bytes?.length??0,bodySha256:bytes?sha(bytes):null,
   schemaSource:schemaSource?copy(schemaSource):null,originalRequestId,createdAt:at()});
 }
 function actualBody(request){return request.body===null?null:Buffer.from(JSON.stringify(request.body),'utf8');}
 function checkRequest(request){
  checked(request);
  need(canonical(request.connection)===canonical(selection),'CONNECTION_CHANGED','Reattach the original application, network, service and custody references.');
  const expected=request.transport==='server'?serverBaseUrl:mcpUrl;
  need(request.transport==='server'?new URL(request.url).origin===expected:request.url===expected,'NATIVE_ENDPOINT_CHANGED','Use the original selected provider endpoint.');
  const body=actualBody(request);need(request.bodyBytes===(body?.length??0)&&request.bodySha256===(body?sha(body):null),'NATIVE_REQUEST_CHANGED','The original request bytes changed.');
  return request;
 }
 async function wire(request,{signal,wireBody=null,sessionSelection=null,expectId=null,notification=false,sensitive=false,methodOverride=null,lastEventId=null,privateValues=[]}={}){
  check();checkRequest(request);const kind=request.transport==='server'?'server':'mcp';
  const token=await credential(kind),headers=new Headers(request.headers),privateStrings=[token,...privateValues].filter(value=>typeof value==='string'&&value.length>0);
  const privateText=value=>privateStrings.reduce((text,secret)=>text.replaceAll(secret,'[redacted]'),String(value));
  function privateView(value){
   if(typeof value==='string')return privateText(value);
   if(Array.isArray(value))return value.map(privateView);
   if(plain(value)){const result={};for(const [key,item]of Object.entries(value))Object.defineProperty(result,key,{value:privateView(item),enumerable:true});return result;}
   return value;
  }
  if(kind==='server')headers.set('x-pollar-api-key',token);else headers.set('authorization','Bearer '+token);
  if(sessionSelection){headers.set('MCP-Protocol-Version',sessionSelection.protocol);if(sessionSelection.id)headers.set('Mcp-Session-Id',sessionSelection.id);}
  if(lastEventId!==null)headers.set('Last-Event-ID',lastEventId);
  const body=wireBody??actualBody(request),controller=new AbortController(),started=at(),chunks=[],events=[],messages=[],aux=[],projectionErrors=[];
  controllers.add(controller);const signals=[controller.signal,AbortSignal.timeout(timeout)];if(signal)signals.push(signal);
  const combined=AbortSignal.any(signals);let response=null,bytes=Buffer.alloc(0),bodyComplete=false,matched=null,lastId=null,streamClosedAfterResponse=false,dispatched=false,transportError=null;
  const method=methodOverride??request.method,sentBody=['GET','HEAD'].includes(method)?null:body;
  function observe(message){
   if(!plain(message)||message.jsonrpc!=='2.0')return;
   messages.push(message);
   if(expectId!==null&&message.id===expectId&&(own(message,'result')||own(message,'error')))matched=message;
   if(message.method==='notifications/tools/list_changed')discovery=null;
  }
  try{
   combined.throwIfAborted();dispatched=true;
   response=await fetcher(request.url,{method,headers,body:sentBody??undefined,signal:combined,redirect:'manual'});
   const contentType=(response.headers.get('content-type')??'').split(';')[0].trim().toLowerCase();
   if(contentType==='text/event-stream'&&response.body){
    const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true}),parser=makeSSEParser(event=>{
     events.push(event);if(event.id!==null)lastId=event.id;
     try{observe(parseProviderJSON(event.data));}catch(error){projectionErrors.push({eventIndex:events.length-1,error:errorPublic(error)});}
    });
    try{
     while(true){
      const item=await reader.read();if(item.done){bodyComplete=true;parser.feed(decoder.decode(),{end:true});if(parser.lastId()!==null)lastId=parser.lastId();break;}
      chunks.push(Buffer.from(item.value));parser.feed(decoder.decode(item.value,{stream:true}));if(parser.lastId()!==null)lastId=parser.lastId();
      const waiting=messages.filter(message=>own(message,'id')&&typeof message.method==='string'&&!aux.some(x=>x.id===message.id));
      for(const message of waiting){
       const answer=message.method==='ping'?{jsonrpc:'2.0',id:message.id,result:{}}:{jsonrpc:'2.0',id:message.id,error:{code:-32601,message:'This client did not advertise '+message.method}};
       const reply=localRequest({action:'mcp.protocol.response',args:{requestId:message.id},transport:'mcp',method:'POST',url:mcpUrl,body:answer,credentialKind:'mcp'});
       const exchange=await wire(reply,{signal:combined,sessionSelection,notification:true});
       aux.push({id:message.id,exchange});
      }
      if(matched){streamClosedAfterResponse=true;await reader.cancel();break;}
     }
    }finally{reader.releaseLock();}
   }else{
    if(response.body){const reader=response.body.getReader();try{while(true){const item=await reader.read();if(item.done){bodyComplete=true;break;}chunks.push(Buffer.from(item.value));}}finally{reader.releaseLock();}}
    else bodyComplete=true;
   }
  }catch(error){transportError=errorPublic(error);}
  finally{controllers.delete(controller);bytes=Buffer.concat(chunks);}
  let parsed=null;
  if(response&&(response.headers.get('content-type')??'').toLowerCase().includes('text/event-stream'))parsed=matched;
  else if(bytes.length){try{parsed=parseProviderJSON(new TextDecoder('utf-8',{fatal:true}).decode(bytes));observe(parsed);}catch(error){projectionErrors.push({error:errorPublic(error)});}}
  if(expectId!==null&&matched)parsed=matched;
  if(transportError)transportError=privateView(transportError);
  let retainedBytes=bytes,retainedParsed=parsed,ephemeral=null,privateEcho=false;
  if(bytes.length&&privateStrings.some(secret=>bytes.includes(secret))){privateEcho=true;retainedBytes=Buffer.from(privateText(bytes.toString('utf8')),'utf8');retainedParsed=privateView(parsed);}
  if(sensitive&&bytes.length){
   retainedParsed=redact(parsed??{unstructuredResponse:true},{keyResponse:true});
   retainedBytes=Buffer.from(JSON.stringify({redacted:true,originalBodySha256:sha(bytes),originalBodyBytes:bytes.length,response:retainedParsed}),'utf8');
   ephemeral={schema:'stellar-forge.pollar-partner.one-time-provider-result.v1',action:request.action,requestId:request.id,
    response:{status:response?.status??null,bodyBase64:bytes.toString('base64'),bodySha256:sha(bytes),bodyBytes:bytes.length},result:parsed};
  }
  const summary=response?{status:response.status,statusText:response.statusText,headers:publicHeaders(response.headers),bodyBase64:retainedBytes.toString('base64'),
   bodySha256:sha(retainedBytes),bodyBytes:retainedBytes.length,bodyComplete,streamClosedAfterMatchingResponse:streamClosedAfterResponse,
   originalBodySha256:sha(bytes),originalBodyBytes:bytes.length,bodyRedacted:privateEcho||sensitive&&bytes.length>0,receivedAt:at()}:null;
  return {request:copy(request),response:summary,parsed:retainedParsed,ephemeral,
   sessionId:response?.headers.get('mcp-session-id')??null,
   observations:[{kind:'provider-http-exchange',startedAt:started,finishedAt:at(),dispatched,method,
    requestBodySha256:sentBody?sha(sentBody):null,requestBodyBytes:sentBody?.length??0,
    responseMatched:expectId===null?null:Boolean(matched),lastEventId:lastId,transportError,projectionErrors,
    credentialEchoRedacted:privateEcho,
    events:sensitive?events.map(event=>({...event,data:'[redacted one-time key response]'})):privateView(redact(events)),messages:privateView(sensitive?redact(messages,{keyResponse:true}):redact(messages)),
    relatedExchanges:aux.map(item=>({requestId:item.id,request:item.exchange.request,response:item.exchange.response,observations:item.exchange.observations}))}],
   transportError,dispatched,lastEventId:lastId,matched:expectId===null?null:Boolean(matched)};
 }
 function exchangeSource(exchange){return {request:exchange.request,response:exchange.response,observations:exchange.observations};}
 async function initialize(signal){
  check();if(session)return session;if(initializing)return initializing;
  initializing=(async()=>{
   const id=randomUUID(),request=localRequest({action:'mcp.protocol.initialize',args:{protocolVersion:PROTOCOL},transport:'mcp',method:'POST',url:mcpUrl,credentialKind:'mcp',id,
    body:{jsonrpc:'2.0',id,method:'initialize',params:{protocolVersion:PROTOCOL,capabilities:{},clientInfo:{name:'stellar-pollar-partner',version:'1.0.0'}}}});
   const exchange=await wire(request,{signal,expectId:id}),result=exchange.parsed?.result;
   if(!exchange.matched||exchange.parsed?.error||!plain(result))fail('MCP_INITIALIZATION_FAILED','The original MCP gateway did not complete initialization.',{exchange:exchangeSource(exchange)});
   need(PROTOCOLS.has(result.protocolVersion),'MCP_PROTOCOL_VERSION_UNSUPPORTED','The gateway selected an unsupported protocol version.',{selected:result.protocolVersion,supported:[...PROTOCOLS],exchange:exchangeSource(exchange)});
   need(plain(result.capabilities?.tools),'MCP_TOOLS_UNAVAILABLE','The original gateway did not advertise tools.',{exchange:exchangeSource(exchange)});
   const active={id:exchange.sessionId,protocol:result.protocolVersion,info:redact(result),sources:[exchangeSource(exchange)]};
   const notice=localRequest({action:'mcp.protocol.initialized',args:{},transport:'mcp',method:'POST',url:mcpUrl,credentialKind:'mcp',body:{jsonrpc:'2.0',method:'notifications/initialized'}});
   const initialized=await wire(notice,{signal,sessionSelection:active,notification:true});active.sources.push(exchangeSource(initialized));
   need(initialized.response&&initialized.response.status>=200&&initialized.response.status<300&&!initialized.transportError,
    'MCP_INITIALIZATION_FAILED','The original gateway did not accept the initialized notification.',{exchange:exchangeSource(initialized)});
   session=active;return active;
  })();try{return await initializing;}finally{initializing=null;}
 }
 async function rpc(request,{signal,sensitive=false,resumeEventId=null}={}){
  const active=await initialize(signal);
  const exchange=await wire(request,{signal,sessionSelection:active,expectId:request.body?.id??null,sensitive,
   ...(resumeEventId!==null?{methodOverride:'GET',lastEventId:resumeEventId}:{})});
  if(exchange.response?.status===404){session=null;discovery=null;}
  exchange.observations.unshift({kind:'original-mcp-session',protocolVersion:active.protocol,server:active.info,initialization:active.sources});
  return exchange;
 }
 async function discoverTools({signal,refresh=false}={}){
  if(discovery&&!refresh)return discovery;if(discoveryPromise)return discoveryPromise;
  discoveryPromise=(async()=>{
   const tools=[],pages=[],cursors=new Set();let cursor=null;
   while(true){
    if(cursor!==null){need(typeof cursor==='string'&&!cursors.has(cursor),'MCP_CURSOR_REPEATED','The original tools/list continuation did not advance.');cursors.add(cursor);}
    const id=randomUUID(),request=localRequest({action:'mcp.tools.list',args:cursor===null?{}:{cursor},transport:'mcp-discovery',method:'POST',url:mcpUrl,credentialKind:'mcp',id,
     body:{jsonrpc:'2.0',id,method:'tools/list',params:cursor===null?{}:{cursor}}});
    const exchange=await rpc(request,{signal}),result=exchange.parsed?.result;pages.push(exchangeSource(exchange));
    if(!exchange.matched||exchange.parsed?.error||!Array.isArray(result?.tools))fail('MCP_DISCOVERY_FAILED','The original gateway did not return a complete tools page.',{pages});
    for(const tool of result.tools){
     need(plain(tool)&&typeof tool.name==='string'&&plain(tool.inputSchema),'MCP_TOOL_SCHEMA_INVALID','The original tool declaration is malformed.',{pages});
     const prior=tools.find(row=>row.name===tool.name);
     need(!prior||canonical(prior)===canonical(tool),'MCP_TOOL_SCHEMA_CHANGED','A tool changed inside the original paginated catalogue.',{name:tool.name,pages});
     if(!prior)tools.push(copy(tool));
    }
    cursor=result.nextCursor??null;if(cursor===null)break;
   }
   discovery=sealed({schema:'stellar-forge.pollar-partner.native-catalogue.v1',connection:selection,tools,pages,complete:true,observedAt:at()});return discovery;
  })();try{return await discoveryPromise;}finally{discoveryPromise=null;}
 }
 function catalog(){
  check();return POLLAR_NATIVE_ACTIONS.map(spec=>{
   const observed=discovery?.tools.find(row=>row.name===spec.tool);
   return {...copy(spec),...(observed?{observedTool:copy(observed),observedInputSchema:copy(observed.inputSchema),observedCatalogueSha256:discovery.sha256}:{})};
  });
 }
 function describe(){check();return {...copy(selection),available:{server:Boolean(connection.serverSecretKey),mcp:Boolean(connection.personalAccessToken)},
  actions:POLLAR_NATIVE_ACTIONS.length,protocolVersion:session?.protocol??null,observedCatalogue:discovery?{sha256:discovery.sha256,tools:discovery.tools.length,complete:discovery.complete,observedAt:discovery.observedAt}:null};}
 async function prepare({action,args={},signal}={}){
  check();const spec=getPollarAction(action,{surface:'native'});args=copy(args);validatePollarArguments(action,args,{surface:'native'});
  if(applicationId&&typeof args.id==='string')need(args.id===applicationId,'APPLICATION_SCOPE_MISMATCH','Select the original attached application.',{expected:applicationId,actual:args.id});
  if(spec.transport==='server'){
   let path=spec.path,body=copy(args);
   if(path.includes('{publicKey}')){path=path.replace('{publicKey}',encodeURIComponent(args.publicKey));delete body.publicKey;}
   return localRequest({action,args,transport:'server',method:spec.method,url:serverBaseUrl+path,body:Object.keys(body).length?body:null,credentialKind:'server'});
  }
  const id=randomUUID();
  if(action==='mcp.tools.list')return localRequest({action,args,transport:'mcp-discovery',method:'POST',url:mcpUrl,body:{jsonrpc:'2.0',id,method:'tools/list',params:{}},credentialKind:'mcp',id});
  const observed=await discoverTools({signal}),tool=observed.tools.find(row=>row.name===spec.tool);
  need(tool,'MCP_TOOL_UNAVAILABLE','The original scoped gateway does not expose this tool.',{action,observedCatalogueSha256:observed.sha256});
  if(['mcp.get_application_transactions','mcp.get_application_users'].includes(action)){
   if(args.limit===undefined)args.limit=Math.max(1,Math.min(100,tool.inputSchema.properties?.limit?.maximum??100));
   if(args.offset===undefined)args.offset=0;
  }
  validatePollarValue(args,tool.inputSchema);
  return localRequest({action,args,transport:'mcp',method:'POST',url:mcpUrl,credentialKind:'mcp',id,
   body:{jsonrpc:'2.0',id,method:'tools/call',params:{name:spec.tool,arguments:args}},
   schemaSource:{catalogueSha256:observed.sha256,tool,observedAt:observed.observedAt,pages:observed.pages}});
 }

 function classify(exchange,spec){
  const status=exchange.response?.status??null,parsed=exchange.parsed,observed=exchange.observations.find(row=>row.kind==='provider-http-exchange');
  const error=exchange.transportError;
  const completedEnvelope=status>=200&&status<300&&(spec.transport==='server'?plain(parsed)&&(parsed.success===true||parsed.success===false):exchange.matched===true);
  if(error&&!completedEnvelope)return {state:spec.mutates&&exchange.dispatched?'UNCERTAIN':'FAILED',error,dispatched:exchange.dispatched,
   resolution:spec.mutates&&exchange.dispatched?'provider-readback-required':'transport-failed'};
  if(status===null)return {state:spec.mutates?'UNCERTAIN':'FAILED',error:{code:'PROVIDER_RESPONSE_ABSENT',message:'The original HTTP response is absent.'}};
  if(status>=300&&status<400)return {state:'FAILED',error:{code:'PROVIDER_REDIRECT_REJECTED',message:'The original endpoint returned a redirect; its credentials were kept at the selected origin.'},httpStatus:status};
  if(spec.transport==='server'){
   if(status===409&&spec.action==='server.wallet.fund'&&parsed?.code==='WALLET_ALREADY_FUNDED')
    return {state:'COMPLETE',resolution:'provider-already-funded',providerCode:parsed.code,result:copy(parsed),providerIds:{publicKey:exchange.request.args.publicKey}};
   if(status>=200&&status<300&&parsed?.success===true)
    return {state:'COMPLETE',resolution:'original-server-response',providerCode:parsed.code??null,result:copy(parsed.content??null),providerIds:resultIds(parsed)};
   if(plain(parsed)&&parsed.success===false)
    return {state:'FAILED',resolution:'original-server-error',providerCode:parsed.code??null,result:copy(parsed),httpStatus:status,
     retryable:parsed.code==='FUND_XLM_FAILED',error:{code:String(parsed.code??'SERVER_OPERATION_FAILED'),message:'The original Pollar server rejected or failed this operation.'}};
   return {state:spec.mutates&&(status>=500||status>=200&&status<300)?'UNCERTAIN':'FAILED',httpStatus:status,
    error:{code:'SERVER_RESPONSE_UNRECOGNIZED',message:'The original server response did not contain its documented completion envelope.'}};
  }
  if(status===202&&!exchange.matched)return {state:'PENDING',resolution:'provider-accepted-awaiting-rpc-result',providerIds:{rpcRequestId:exchange.request.body?.id??null},
   resume:{lastEventId:exchange.lastEventId,sessionAvailable:Boolean(session)}};
  if(status<200||status>=300)return {state:spec.mutates&&status>=500?'UNCERTAIN':'FAILED',httpStatus:status,
   error:{code:status===429?'PROVIDER_RATE_LIMITED':status===401?'PROVIDER_AUTHENTICATION_FAILED':status===403?'PROVIDER_SCOPE_DENIED':'PROVIDER_HTTP_ERROR',
    message:'The original gateway returned HTTP '+status+'.'},retryAfter:exchange.response.headers['retry-after']??null};
  if(!exchange.matched)return {state:spec.mutates?'UNCERTAIN':'FAILED',resolution:'rpc-response-incomplete',
   error:{code:'MCP_RESPONSE_INCOMPLETE',message:'The original JSON-RPC response was not received in full.'},resume:{lastEventId:exchange.lastEventId,sessionAvailable:Boolean(session)}};
  if(plain(parsed?.error))return {state:'FAILED',resolution:'original-json-rpc-error',error:{code:String(parsed.error.code),message:String(parsed.error.message??'Original MCP protocol error'),data:parsed.error.data??null},sideEffectsUnknown:spec.mutates===true};
  const result=parsed?.result;
  if(!plain(result))return {state:spec.mutates?'UNCERTAIN':'FAILED',error:{code:'MCP_RESULT_INVALID',message:'The original gateway returned a malformed tool result.'}};
  if(result.isError===true)return {state:'FAILED',resolution:'original-mcp-tool-error',result:copy(result),sideEffectsUnknown:spec.mutates===true,
   error:{code:'MCP_TOOL_ERROR',message:'The original gateway returned a tool execution error.'}};
  const value=decodedTool(result);
  return {state:'COMPLETE',resolution:'original-mcp-tool-result',result:copy(value),nativeResult:copy(result),providerIds:resultIds(value),
   rpcRequestId:exchange.request.body?.id??null};
 }
 async function pagination(request,outcome){
  if(!['mcp.get_application_transactions','mcp.get_application_users'].includes(request.action)||outcome.state!=='COMPLETE')return null;
  const kind=request.action.endsWith('_users')?'users':'transactions',page=pageShape(outcome.result,kind);
  if(!page)return {kind:'offset',complete:false,nextRequest:null,sourceShape:'unrecognized',originalArguments:copy(request.args),
   error:{code:'PAGINATION_SOURCE_SHAPE_REQUIRED',message:'Retain the original page and select its actual records and returned bounds.'}};
  const input=request.args,limit=page.limit??input.limit,offset=page.offset??input.offset??0,total=page.total;
  if(limit!==undefined&&limit!==null)finiteInteger(limit,'original page limit',1);
  finiteInteger(offset,'original page offset');if(total!==null)finiteInteger(total,'original total');
  if(page.nextOffset!==null)finiteInteger(page.nextOffset,'original next offset');
  let next=null,complete=false;
  if(page.hasMore===false)complete=true;
  else if(total!==null&&offset+page.rows.length>=total)complete=true;
  else if(page.rows.length===0)complete=true;
  else if(page.nextOffset!==null)next=page.nextOffset;
  else if(page.hasMore===true||total!==null)next=offset+page.rows.length;
  else if(limit!==undefined&&limit!==null){if(page.rows.length<limit)complete=true;else next=offset+page.rows.length;}
  const metadata={kind:'offset',recordsPath:page.path,returnedRecords:page.rows.length,offset,limit:limit??null,total,
   complete,nextOffset:next,nextRequest:null,snapshotSemantics:'original live provider offset pages',originalArguments:copy(input)};
  if(!complete&&next===null){metadata.error={code:'PAGINATION_BOUNDS_ABSENT',message:'The original result did not return enough pagination bounds.'};return metadata;}
  if(next!==null){
   need(next>offset,'PAGINATION_CURSOR_REPEATED','The original offset did not advance.');
   const args={...copy(input),offset:next};if(limit!==null&&limit!==undefined)args.limit=limit;
   // Reuse the original observed schema; a continuation is a read of the same original selection.
   const spec=getPollarAction(request.action,{surface:'native'});validatePollarArguments(request.action,args,{surface:'native'});
   if(request.schemaSource?.tool?.inputSchema)validatePollarValue(args,request.schemaSource.tool.inputSchema);
   const id=randomUUID();metadata.nextRequest=localRequest({action:request.action,args,transport:'mcp',method:'POST',url:mcpUrl,credentialKind:'mcp',id,
    body:{jsonrpc:'2.0',id,method:'tools/call',params:{name:spec.tool,arguments:args}},schemaSource:request.schemaSource,originalRequestId:request.originalRequestId??request.id});
  }
  return metadata;
 }
 async function perform({request,signal}={}){
  check();checkRequest(request);const spec=getPollarAction(request.action,{surface:'native'});
  validatePollarArguments(request.action,request.args,{surface:'native'});
  need(request.transport===spec.transport,'NATIVE_REQUEST_CHANGED','The prepared action transport changed.');
  if(spec.transport==='server'){
   let path=spec.path,expectedBody=copy(request.args);
   if(path.includes('{publicKey}')){path=path.replace('{publicKey}',encodeURIComponent(request.args.publicKey));delete expectedBody.publicKey;}
   if(Object.keys(expectedBody).length===0)expectedBody=null;
   need(request.method===spec.method&&request.url===serverBaseUrl+path&&canonical(request.body)===canonical(expectedBody),
    'NATIVE_REQUEST_CHANGED','The original server path, method or complete argument body changed.');
  }else{
   need(request.method==='POST'&&request.body?.jsonrpc==='2.0'&&request.body.id===request.id&&
    request.body.method===(request.action==='mcp.tools.list'?'tools/list':'tools/call'),
    'NATIVE_REQUEST_CHANGED','The original JSON-RPC method or identity changed.');
   if(request.action!=='mcp.tools.list'){
    need(request.body.params?.name===spec.tool&&canonical(request.body.params?.arguments)===canonical(request.args),
     'NATIVE_REQUEST_CHANGED','The original MCP tool or complete arguments changed.');
    if(request.schemaSource?.tool?.inputSchema)validatePollarValue(request.args,request.schemaSource.tool.inputSchema);
   }
  }
  if(request.action==='mcp.tools.list'){
   try{
    const value=await discoverTools({signal,refresh:true}),body=Buffer.from(JSON.stringify(value),'utf8');
    return {request:copy(request),response:{status:null,headers:{'content-type':'application/json'},bodyBase64:body.toString('base64'),
     bodySha256:sha(body),bodyBytes:body.length,bodyComplete:true,assembledFromOriginalPages:true},
     outcome:{state:'COMPLETE',resolution:'complete-original-gateway-catalogue',result:{tools:value.tools,catalogueSha256:value.sha256,complete:true}},
     pagination:{kind:'opaque-cursor',complete:true,pages:value.pages.length,nextRequest:null},
     observations:value.pages.map(page=>({kind:'original-tools-list-page',...page})),selection:copy(selection)};
   }catch(error){return {request:copy(request),response:null,outcome:{state:'FAILED',error:errorPublic(error)},observations:error.details?.pages??[],selection:copy(selection)};}
  }
  if(applicationId&&typeof request.args.id==='string')need(request.args.id===applicationId,'APPLICATION_SCOPE_MISMATCH','The original request belongs to another attached application.');
  let exchange;
  try{
   exchange=spec.transport==='server'?await wire(request,{signal}):await rpc(request,{signal,sensitive:request.action==='mcp.create_api_key'});
  }catch(error){
   return {request:copy(request),response:null,outcome:{state:'FAILED',resolution:'provider-preparation-failed',dispatched:false,error:errorPublic(error)},
    observations:error.details?.exchange?[error.details.exchange]:[],selection:copy(selection)};
  }
  const outcome=classify(exchange,spec);
  let page=null;try{page=await pagination(request,outcome);}catch(error){
   page={kind:'offset',complete:false,nextRequest:null,error:errorPublic(error)};
  }
  const result=publicEnvelope(exchange,outcome,{pagination:page,selection:copy(selection)});
  if(exchange.ephemeral)result.ephemeral=exchange.ephemeral;
  return result;
 }
 async function verifySession({accessToken,signal}={}){
  check();need(typeof accessToken==='string'&&accessToken.length>0,'TOKEN_REQUIRED','Supply the original ephemeral SDK access token.');
  const request=localRequest({action:'server.session.verify',args:{token:'[redacted]'},transport:'server',method:'POST',url:serverBaseUrl+'/v1/tokens/verify',
   credentialKind:'server',body:{token:'[redacted]'}});
  const body=Buffer.from(JSON.stringify({token:accessToken}),'utf8'),exchange=await wire(request,{signal,wireBody:body,privateValues:[accessToken]});
  const parsed=exchange.parsed,content=parsed?.content;
  if(exchange.response?.status!==200||parsed?.success!==true||parsed.code!=='SERVER_TOKEN_VERIFIED'||
    !plain(content)||typeof content.userId!=='string'||typeof content.applicationId!=='string'||!['testnet','mainnet'].includes(content.network))
   fail('SESSION_NOT_VERIFIED','The original Pollar server did not verify this session.',{exchange:exchangeSource(exchange),providerCode:parsed?.code??null});
  if(applicationId)need(content.applicationId===applicationId,'SESSION_APPLICATION_MISMATCH','The original token belongs to another attached application.',{exchange:exchangeSource(exchange)});
  if(network)need(content.network===network,'SESSION_NETWORK_MISMATCH','The original token belongs to another network.',{exchange:exchangeSource(exchange)});
  // The access token is used only by this native POST. Only its request hash and
  // the provider's public verification result return to the durable workspace.
  const result=publicEnvelope(exchange,{state:'COMPLETE',resolution:'original-server-session-verification',providerCode:parsed.code,
   providerIds:{userId:content.userId,applicationId:content.applicationId}},{content:copy(content),selection:copy(selection)});
  return result;
 }
 async function readAll(action,args,{signal}={}){
  let request=await prepare({action,args,signal}),rows=[],sources=[],totals=[],offsets=[],complete=false,error=null,seen=new Set();
  while(request){
   const signature=sha(canonical({action:request.action,args:request.args}));
   if(seen.has(signature)){error={code:'PAGINATION_REQUEST_REPEATED',message:'The retained original continuation repeated.'};break;}seen.add(signature);
   const result=await perform({request,signal});sources.push(result);
   if(result.outcome.state!=='COMPLETE'){error=result.outcome.error??{code:'READ_INCOMPLETE',message:'The original read did not complete.'};break;}
   const page=pageShape(result.outcome.result,action.endsWith('_users')?'users':'transactions');
   if(page){rows.push(...page.rows);if(page.total!==null)totals.push(page.total);if(page.offset!==null)offsets.push(page.offset);}
   else{const value=payloadOf(result.outcome.result);if(Array.isArray(value))rows.push(...value);else rows.push(value);}
   if(!result.pagination){complete=true;break;}
   if(result.pagination.error){error=result.pagination.error;break;}
   complete=result.pagination.complete===true;request=result.pagination.nextRequest??null;
   if(!request)break;
  }
  return {rows,sources,complete,totals,offsets,liveTotalsChanged:new Set(totals).size>1,error};
 }
 function originalTerminal(operation,request){
  const sources=[...(operation.sources??[])].reverse();
  for(const source of sources){
   if(['COMPLETE','FAILED'].includes(source?.outcome?.state)&&source.request?.action===operation.action&&source.request?.sha256===request.sha256&&
     source.outcome.resolution!=='provider-preparation-failed'&&source.outcome.resolution!=='transport-failed'&&source.outcome.sideEffectsUnknown!==true)return source;
  }
  return null;
 }
 async function reconcile({operation,signal}={}){
  check();need(plain(operation)&&typeof operation.action==='string','INVALID_OPERATION','Supply the original retained Pollar operation.');
  const request=operation.attempt?.request??operation.request;checkRequest(request);
  const spec=getPollarAction(operation.action,{surface:'native'});
  const terminal=originalTerminal(operation,request);
  if(terminal)return {...copy(terminal),request:copy(request),outcome:{...copy(terminal.outcome),recoveredFromRetainedSource:true},
   observations:[...(terminal.observations??[]),{kind:'original-retained-terminal-result',originalRequestId:terminal.request.id}]};
  if(!spec.mutates){
   const next=await prepare({action:operation.action,args:request.args,signal}),result=await perform({request:next,signal});
   result.observations.unshift({kind:'original-read-recovery',operationId:operation.id??null,originalRequestId:request.id});return result;
  }
  // Resume only the original server stream; never repeat a tools/call mutation.
  const cursor=[...(operation.sources??[])].reverse().flatMap(source=>source.observations??[]).find(row=>row.lastEventId)?.lastEventId??null;
  if(session&&cursor&&spec.transport!=='server'){
   const exchange=await rpc(request,{signal,sensitive:request.action==='mcp.create_api_key',resumeEventId:cursor}),outcome=classify(exchange,spec);
   if(exchange.matched){const result=publicEnvelope(exchange,outcome,{selection:copy(selection)});if(exchange.ephemeral)result.ephemeral=exchange.ephemeral;return result;}
  }
  const sources=[],observations=[],args=request.args,id=args.id??applicationId,providerIds=copy(operation.providerIds??{});
  let current=null,goal=null;
  async function read(action,input){
   const all=await readAll(action,input,{signal});sources.push(...all.sources);observations.push({kind:'original-reconciliation-read',action,
    complete:all.complete,records:all.rows.length,totals:all.totals,liveTotalsChanged:all.liveTotalsChanged,error:all.error});
   return all;
  }
  function complete(value,reason,ids={}){
   goal={state:'COMPLETE',resolution:'target-state-observed',reason,result:copy(value),providerIds:{...providerIds,...ids},
    originalDispatchOutcome:'reconciled from current provider state'};
  }
  try{
   if(['mcp.update_application_domains','mcp.update_application_redirect_uris','mcp.enable_asset'].includes(operation.action)&&id){
    const detail=await read('mcp.get_application',{id});current=detail.rows[0]??null;
    if(detail.complete&&plain(current)){
     if(operation.action==='mcp.update_application_domains'||operation.action==='mcp.update_application_redirect_uris'){
      const key=operation.action==='mcp.update_application_domains'?'allowed_origins':'allowed_redirect_uris';
      const camel=key==='allowed_origins'?'allowedOrigins':'allowedRedirectUris';
      const candidates=[current,current.settings,current.application].filter(plain);
      const actual=candidates.find(value=>Array.isArray(value[key])||Array.isArray(value[camel]));
      const value=actual?.[key]??actual?.[camel];
      if(Array.isArray(value)&&canonical([...value].sort())===canonical([...args[key]].sort()))complete(current,'The original application now contains the complete requested list.',{applicationId:id});
     }else{
      const candidates=[current.assets,current.enabledAssets,current.enabled_assets,current.trustlines,current.settings?.assets].filter(Array.isArray).flat();
      const asset=candidates.find(row=>plain(row)&&(row.code??row.asset_code)===args.code&&(row.issuer??row.asset_issuer)===args.issuer);
      if(asset)complete(asset,'The original application exposes the requested code and issuer.',{applicationId:id,...resultIds(asset)});
     }
    }
   }else if(['server.user.register','server.user.registerWithWallet'].includes(operation.action)&&id){
    const users=await read('mcp.get_application_users',{id,limit:100,offset:0});
    const matches=users.rows.filter(row=>plain(row)&&(row.externalId??row.external_id)===args.externalId);current={matches,pagesComplete:users.complete};
    if(users.complete&&matches.length===1){
     const user=matches[0],userId=user.userId??user.id??user.user_id;
     if(operation.action==='server.user.register')complete(user,'The original application contains one matching external user identity.',{applicationId:id,...(typeof userId==='string'?{userId}:{})});
     else{
      const ownWallet=user.wallet??user.stellarWallet??user.stellar_wallet;
      let wallet=plain(ownWallet)&&PUBLIC_KEY.test(ownWallet.publicKey??ownWallet.public_key??ownWallet.address??'')?ownWallet:null;
      if(!wallet&&typeof userId==='string'){
       const wallets=await read('mcp.get_application_wallets',{id});
       const original=wallets.rows.flatMap(row=>Array.isArray(row?.wallets)?row.wallets:Array.isArray(row?.content)?row.content:[row]);
       wallet=original.find(row=>plain(row)&&(row.userId??row.user_id)===userId&&PUBLIC_KEY.test(row.publicKey??row.public_key??row.address??''))??null;
      }
      if(wallet)complete({user,wallet},'The original external user and its Stellar wallet are present in this application.',{applicationId:id,...(typeof userId==='string'?{userId}:{}),publicKey:wallet.publicKey??wallet.public_key??wallet.address});
     }
    }
   }else if(['server.wallet.fund','mcp.fund_testnet_wallet','mcp.ensure_wallet_funded'].includes(operation.action)&&id){
    if(operation.action==='mcp.ensure_wallet_funded'){
     const balances=await read('mcp.get_application_wallet_by_role',{id,...(args.role?{role:args.role}:{})});current=balances.rows[0]??null;
     const funded=originalBoolean(current);
     if(balances.complete&&funded?.value===true)complete(current,'The original role wallet exists on Stellar.',{applicationId:id,...resultIds(current)});
     else if(balances.complete&&network==='mainnet'&&funded?.value===false)complete(current,'The original helper reports the unfunded mainnet wallet without a funding action.',{applicationId:id,...resultIds(current)});
    }else{
     const balances=await read('mcp.get_wallet_balances',{id,publicKey:args.publicKey});current=balances.rows[0]??null;
     const funded=originalBoolean(current);
     if(balances.complete&&funded?.value===true)complete(current,'The original requested wallet exists on Stellar.',{applicationId:id,publicKey:args.publicKey});
    }
   }else if(operation.action==='mcp.create_application'){
    const retainedId=providerIds.applicationId??providerIds.application_id??providerIds.id;
    if(typeof retainedId==='string'){
     const detail=await read('mcp.get_application',{id:retainedId});current=detail.rows[0]??null;
     if(detail.complete&&plain(current)&&(current.id??current.applicationId)===retainedId)complete(current,'The original returned application identity is present.',{applicationId:retainedId});
    }else{const applications=await read('mcp.list_applications',{});current={applications:applications.rows,pagesComplete:applications.complete};}
   }else if(id){
    const detail=await read('mcp.get_application',{id});current=detail.rows[0]??null;
   }
  }catch(error){observations.push({kind:'original-reconciliation-error',error:errorPublic(error)});}
  const assembled={schema:'stellar-forge.pollar-partner.reconciliation.v1',operationId:operation.id??null,originalRequestId:request.id,
   current:current??null,sources,observations,observedAt:at()},bytes=Buffer.from(JSON.stringify(assembled),'utf8');
  return {request:copy(request),response:{status:null,headers:{'content-type':'application/json'},bodyBase64:bytes.toString('base64'),
   bodySha256:sha(bytes),bodyBytes:bytes.length,bodyComplete:true,assembledFromOriginalExchanges:true},
   outcome:goal??{state:'UNCERTAIN',resolution:'original-provider-state-retained',providerIds,result:current??null,
    message:'The original dispatch is retained together with its current provider state.'},
   observations,selection:copy(selection),pagination:null};
 }
 async function close(){
  if(closed)return;closed=true;for(const controller of controllers)controller.abort(new Error('Pollar connection closed'));
  controllers.clear();session=null;discovery=null;
 }
 return {describe,catalog,prepare,perform,reconcile,verifySession,close};
}

// MIT. Original Bluechip, Horizon, Stellar Expert and configured source HTTP reads.
import {RatingsError,need,clone,canonical,sha256,text,object,list,parseRatingsJSON,parseRatingsCSV,ratingsNetwork,safeInteger,iso,atPointer,integerText} from './lossless-json.mjs';
import {openRatingsStellarSource,prepareRatingsAccounts,prepareRatingsAssets} from './stellar.mjs';
import {normalizeRatingsRegistry,normalizeWalletPolicy} from './reconciliation.mjs';
export {parseRatingsJSON,parseRatingsCSV,prepareRatingsAccounts,prepareRatingsAssets};
const MAXIMUM_BODY=128*1024*1024;
const TYPE={type:'object',additionalProperties:false},STRING={type:'string',minLength:1},ACCOUNT={type:'string',pattern:'^G[A-Z2-7]{55}$'},LEDGER={type:'integer',minimum:1,maximum:4294967295};
const queryCatalog=(kind,label,path,properties={},required=[],recordsPath='/_embedded/records',extra={})=>({kind,label,path,filtersSchema:{...TYPE,properties,required},recordsPath,...extra});
export const BLUECHIP_CATALOG=[
 queryCatalog('coins','Original rated coins','coins/',{},[],''),
 queryCatalog('grade','Original Bluechip grade','coins/{coin}/grade',{coin:STRING},['coin'],'')
];
const COMMON={order:{type:'string',enum:['asc','desc']},include_failed:{type:'boolean'},join:{type:'string',enum:['transactions']}};
export const HORIZON_CATALOG=[
 queryCatalog('root','Original Horizon network','/',{},[],''),
 queryCatalog('account','Original account and balances','/accounts/{account}',{account:ACCOUNT},['account'],''),
 queryCatalog('assets','Original issued-asset metadata','/assets',{asset_code:STRING,asset_issuer:ACCOUNT},[]),
 queryCatalog('ledger','Original ledger','/ledgers/{ledger}',{ledger:LEDGER},['ledger'],''),
 queryCatalog('ledgers','Original ledgers','/ledgers',{order:COMMON.order},[]),
 queryCatalog('transaction','Original transaction','/transactions/{hash}',{hash:{type:'string',pattern:'^[0-9a-fA-F]{64}$'}},['hash'],''),
 queryCatalog('operations','Original operations','/operations',COMMON,[]),
 queryCatalog('payments','Original payments','/payments',COMMON,[]),
 queryCatalog('account-operations','Original account operations','/accounts/{account}/operations',{account:ACCOUNT,...COMMON},['account']),
 queryCatalog('account-payments','Original account payments','/accounts/{account}/payments',{account:ACCOUNT,...COMMON},['account']),
 queryCatalog('account-effects','Original account effects','/accounts/{account}/effects',{account:ACCOUNT,order:COMMON.order},['account']),
 queryCatalog('ledger-operations','Original ledger operations','/ledgers/{ledger}/operations',{ledger:LEDGER,...COMMON},['ledger']),
 queryCatalog('ledger-payments','Original ledger payments','/ledgers/{ledger}/payments',{ledger:LEDGER,...COMMON},['ledger']),
 queryCatalog('effects','Original effects','/effects',{order:COMMON.order},[]),
 queryCatalog('operation-effects','Original operation effects','/operations/{operationId}/effects',{operationId:STRING,order:COMMON.order},['operationId']),
 queryCatalog('operations-window','Complete original daily operations','/operations',{startLedger:LEDGER,endLedger:LEDGER,from:{type:'string',format:'date-time'},to:{type:'string',format:'date-time'},includeEffects:{type:'boolean'}},['startLedger','endLedger'], '/_embedded/records',{pagination:'native-ledger-anchor-and-global-cursor'})
];
export const EXPERT_CATALOG=[
 queryCatalog('directory','Original account labels','/explorer/directory',{address:{type:'array',minItems:1,maxItems:50,items:ACCOUNT},tag:{type:'array',minItems:1,maxItems:10,items:STRING},search:{type:'string',minLength:5},order:COMMON.order},[], '/_embedded/records',{fixedNextQuery:{sort:'address'}}),
 queryCatalog('directory-entry','Original account label','/explorer/directory/{address}',{address:ACCOUNT},['address'],''),
 queryCatalog('directory-tags','Original directory tags','/explorer/directory/tags',{},[],''),
 queryCatalog('blocked-domains','Original reported domains','/explorer/directory/blocked-domains',{search:{type:'string',minLength:2},order:COMMON.order},[], '/_embedded/records',{maximumPageSize:1000}),
 queryCatalog('blocked-domain','Original domain observation','/explorer/directory/blocked-domains/{domain}',{domain:STRING},['domain'],''),
 queryCatalog('assets','Original indexed assets','/explorer/{network}/asset',{search:STRING,sort:{type:'string',enum:['rating','created','payments','trades','trustlines','volume','volume7d']},order:COMMON.order},[]),
 queryCatalog('asset-rating','Original network technical rating','/explorer/{network}/asset/{asset}/rating',{asset:STRING},['asset'],''),
 queryCatalog('holders','Original nonzero asset holders','/explorer/{network}/asset/{asset}/holders',{asset:STRING},['asset']),
 queryCatalog('supply','Original issued supply','/explorer/{network}/asset/{asset}/supply',{asset:STRING},['asset'],'',{contentType:'text/plain'}),
 queryCatalog('ledger-from-time','Original ledger at or before time','/explorer/{network}/ledger/sequence-from-timestamp',{timestamp:{anyOf:[{type:'string'},{type:'integer',minimum:0}]}},['timestamp'],''),
 queryCatalog('ledger-from-sequence','Original ledger close time','/explorer/{network}/ledger/timestamp-from-sequence',{sequence:LEDGER},['sequence'],'')
];
function validated(value,schema,name){
 if(schema.anyOf){for(const s of schema.anyOf){try{return validated(value,s,name);}catch{}}throw new RatingsError('INVALID_FILTER',name+' does not match its original source type.');}
 if(schema.type==='string'){text(value,name,schema.maxLength??4096);if(schema.minLength)need(value.length>=schema.minLength,'INVALID_FILTER',name+' is too short.');if(schema.pattern)need(new RegExp(schema.pattern).test(value),'INVALID_FILTER',name+' has an invalid original format.');}
 else if(schema.type==='integer')value=safeInteger(value,name,{minimum:schema.minimum??0,maximum:schema.maximum??Number.MAX_SAFE_INTEGER});
 else if(schema.type==='boolean')need(typeof value==='boolean','INVALID_FILTER',name+' must be a boolean.');
 else if(schema.type==='array'){list(value,name);need(value.length>=(schema.minItems??0)&&value.length<=(schema.maxItems??10000),'INVALID_FILTER',name+' exceeds its original source size.');value=value.map((item,i)=>validated(item,schema.items??STRING,name+'['+i+']'));}
 else if(schema.type==='object')object(value,name);
 if(schema.enum)need(schema.enum.includes(value),'INVALID_FILTER',name+' is not an original source option.');return value;
}
function filterInput(input,entry){
 const filters=clone(input??{});object(filters,'Original filters');
 for(const key of Object.keys(filters)){need(Object.hasOwn(entry.filtersSchema.properties,key),'INVALID_FILTER','The original route does not accept this filter.',{kind:entry.kind,key});filters[key]=validated(filters[key],entry.filtersSchema.properties[key],key);}
 for(const key of entry.filtersSchema.required??[])need(filters[key]!==undefined&&filters[key]!==null,'MISSING_FILTER','The original route requires '+key+'.',{kind:entry.kind,key});
 return filters;
}
function hostHeaders(connection){
 const result={};for(const [name,value] of Object.entries(connection.headers??{})){need(/^[!#$%&'*+.^_\x60|~0-9A-Za-z-]+$/.test(name)&&typeof value==='string'&&!/[\r\n]/.test(value),'INVALID_CONNECTION','A source header is malformed.');result[name]=value;}
 if(connection.apiKey)result[connection.apiKeyHeader??'X-API-Key']=connection.apiKey;
 if(connection.bearerToken)result.Authorization='Bearer '+connection.bearerToken;
 return result;
}
function sourceRoutes(value){
 list(value,'Configured original source routes');need(value.length>0,'INVALID_CONNECTION','Configure the original pricing/CMS read routes.');
 return value.map(row=>{
  object(row,'Original source route');text(row.kind,'Original source kind',128);text(row.path,'Original relative GET path',2048);
  need(!/^[a-z]+:/i.test(row.path)&&!row.path.startsWith('//')&&!row.path.includes('?')&&!row.path.includes('#')&&!row.path.split('/').some(x=>x==='..'),'INVALID_CONNECTION','A configured original route must be a fixed relative HTTP path.');
  need(row.method===undefined||row.method==='GET','INVALID_CONNECTION','The original Bluechip commissioning source is read-only.');
  const filtersSchema=clone(row.filtersSchema??{...TYPE,properties:{}});object(filtersSchema.properties??{},'Original filter schema');
  const recordsPath=row.recordsPath===null?'':row.recordsPath??'';need(recordsPath===''||recordsPath.startsWith('/'),'INVALID_CONNECTION','Select the original response JSON pointer.');
  return {...clone(row),method:'GET',filtersSchema:{...TYPE,...filtersSchema,additionalProperties:false},recordsPath,projection:clone(row.projection??null)};
 });
}
export function describeRatingsSource(connection){
 object(connection,'Source connection');const provider=connection.provider;
 if(provider==='stellar')return openRatingsStellarSource(connection).descriptor;
 need(['bluechip','horizon','stellar-expert','source'].includes(provider),'UNKNOWN_PROVIDER','Select a maintained source provider.');
 const network=ratingsNetwork(connection.network??'stellar:pubnet').network;
 const defaultURL=provider==='bluechip'?'https://backend.bluechip.org/api/1.2/':provider==='horizon'?network==='stellar:testnet'?'https://horizon-testnet.stellar.org':'https://horizon.stellar.org':provider==='stellar-expert'?'https://api.stellar.expert':null;
 let base;try{base=new URL(connection.baseUrl??defaultURL);}catch{throw new RatingsError('INVALID_CONNECTION','Select the original absolute source base URL.');}
 need((base.protocol==='https:'||base.protocol==='http:'&&connection.allowHttp===true)&&!base.username&&!base.password&&!base.hash,'INVALID_CONNECTION','The original source uses the selected HTTP transport without embedded user credentials.');
 const routes=provider==='source'?sourceRoutes(connection.routes??[]):null;
 if(provider==='source'&&(connection.apiKey||connection.bearerToken||Object.keys(connection.headers??{}).length))need(typeof connection.accountScope==='string'&&connection.accountScope.length>0,'SOURCE_SCOPE_REQUIRED','An authenticated source needs its original account/tenant scope.');
 const scope={provider,network,origin:base.origin,accountScope:connection.accountScope??null,sourceProfile:routes??(provider==='bluechip'?{version:'1.2'}:provider==='stellar-expert'?{version:'1.4.0'}:{version:'horizon-rest'}),sourceName:connection.sourceName??null};
 return {...scope,id:sha256(scope),sourceScope:sha256(scope),authType:connection.apiKey?'api-key':connection.bearerToken?'bearer':Object.keys(connection.headers??{}).length?'host-headers':'public'};
}
function configured(connection){
 const descriptor=describeRatingsSource(connection),provider=descriptor.provider;
 const defaultURL=provider==='bluechip'?'https://backend.bluechip.org/api/1.2/':provider==='horizon'?descriptor.network==='stellar:testnet'?'https://horizon-testnet.stellar.org':'https://horizon.stellar.org':provider==='stellar-expert'?'https://api.stellar.expert':null;
 const base=new URL(connection.baseUrl??defaultURL);base.pathname=base.pathname.replace(/\/?$/,'/');
 return {descriptor,base,headers:hostHeaders(connection),timeout:safeInteger(connection.timeoutMs??30000,'Source timeout',{minimum:1,maximum:300000}),maximumBytes:safeInteger(connection.maximumResponseBytes??MAXIMUM_BODY,'Source byte limit',{minimum:1024,maximum:MAXIMUM_BODY}),routes:provider==='source'?sourceRoutes(connection.routes??[]):null};
}
function deadline(signal,timeout){
 const controller=new AbortController(),abort=()=>controller.abort(signal?.reason);if(signal){if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});}
 const timer=setTimeout(()=>controller.abort(new RatingsError('SOURCE_TIMEOUT','Original source request exceeded its configured deadline.')),timeout);
 return {signal:controller.signal,close(){clearTimeout(timer);signal?.removeEventListener('abort',abort);}};
}
function responseHeaders(headers){const out={};for(const [name,value] of headers.entries())if(!/^(set-cookie|authorization|proxy-authorization)$/i.test(name))out[name]=value;return out;}
function requestURL(selected,path,query){
 const u=new URL(selected.base);u.pathname=selected.base.pathname+path.replace(/^\//,'');for(const [name,value] of Object.entries(query??{})){
  if(Array.isArray(value)){u.searchParams.delete(name);u.searchParams.delete(name+'[]');for(const item of value)u.searchParams.append(name+'[]',String(item));}
  else if(value!==undefined&&value!==null)u.searchParams.set(name,String(value));
 }return u;
}
async function http(selected,path,query,request,signal){
 const u=requestURL(selected,path,query),scope=deadline(signal,selected.timeout),observedAt=new Date().toISOString();
 const exchange={kind:request.kind,request:{method:'GET',origin:selected.descriptor.origin,path:request.publicPath??path,query:clone(query),filters:clone(request.filters??{}),...(request.nativeSelection?{nativeSelection:clone(request.nativeSelection)}:{}),...(request.projection?{projection:clone(request.projection)}:{})},response:null};
 let res;
 try{
  res=await fetch(u,{method:'GET',headers:selected.headers,signal:scope.signal,redirect:'manual'});const parts=[];let bytes=0,bodyComplete=true,error=null;
  try{if(res.body)for await(const part of res.body){const chunk=Buffer.from(part),remaining=selected.maximumBytes-bytes;if(chunk.length>remaining){if(remaining>0){parts.push(chunk.subarray(0,remaining));bytes+=remaining;}bodyComplete=false;error={code:'SOURCE_TOO_LARGE',message:'The original source exceeded its selected byte limit.'};break;}parts.push(chunk);bytes+=chunk.length;}}
  catch{bodyComplete=false;error={code:scope.signal.aborted?'INTERRUPTED':'SOURCE_RESPONSE_INTERRUPTED',message:'The original source response ended before completion.'};}
  exchange.response={status:res.status,statusText:res.statusText,headers:responseHeaders(res.headers),body:Buffer.concat(parts,bytes),bodyComplete,observedAt,finishedAt:new Date().toISOString()};
  if(error)exchange.error=error;else if(res.status<200||res.status>=300)exchange.error={code:res.status===429?'SOURCE_RATE_LIMITED':'SOURCE_HTTP_ERROR',message:'Original source returned HTTP '+res.status+'.',details:{status:res.status,retryAfter:res.headers.get('retry-after')}};
 }catch{exchange.response={status:0,headers:{},body:Buffer.alloc(0),bodyComplete:false,observedAt,finishedAt:new Date().toISOString()};exchange.error={code:scope.signal.aborted?'INTERRUPTED':'SOURCE_TRANSPORT_ERROR',message:'The original source did not return a complete HTTP response.'};}
 finally{scope.close();}
 return exchange;
}
function projectResponse(exchange,entry){
 exchange.recordsPath=entry.recordsPath;
 if(exchange.error){exchange.records=[];return null;}
 if(entry.contentType==='text/plain'){exchange.value=new TextDecoder('utf-8',{fatal:true}).decode(exchange.response.body);exchange.records=[exchange.value];return exchange.value;}
 let value;try{value=(entry.format==='csv'?parseRatingsCSV(exchange.response.body):parseRatingsJSON(exchange.response.body)).value;}catch(error){exchange.error={code:error.code??'INVALID_SOURCE_JSON',message:error.message};exchange.records=[];return null;}
 exchange.value=value;
 try{const records=atPointer(value,entry.recordsPath);exchange.records=Array.isArray(records)?records:[records];}
 catch(error){exchange.error={code:error.code,message:error.message};exchange.records=[];}
 return value;
}
function nativeNext(value,selected,path,query,entry,request,records){
 if(entry.recordsPath===''&&!entry.pagination)return {done:true,next:null};
 if(records.length===0)return {done:true,next:null};
 const pagination=entry.pagination;
 if(pagination&&typeof pagination==='object'){
  const pointer=(path)=>{if(path===undefined||path===null)return undefined;try{return atPointer(value,path);}catch(error){if(error.code==='RECORDS_PATH_MISSING')return undefined;throw error;}};
  if(pagination.type==='cursor'){const cursor=pointer(pagination.nextPointer);return cursor===undefined||cursor===null||cursor===''?{done:true,next:null}:{done:false,next:{kind:request.kind,filters:clone(request.filters??{}),pageSize:request.pageSize,cursor:{nativeCursor:String(cursor)}}};}
  if(pagination.type==='offset'||pagination.type==='page'){
   const total=pointer(pagination.totalPointer),current=safeInteger(request.cursor?.position??pagination.start??(pagination.type==='page'?1:0),'Native page position');
   const step=pagination.type==='page'?1:records.length,next=safeInteger(current+step,'Next native page position'),count=total===undefined?null:BigInt(integerText(total,'Original total result count')),done=count!==null?pagination.type==='page'?BigInt(current)*BigInt(request.pageSize??100)>=count:BigInt(next)>=count:records.length<(request.pageSize??100);
   return {done,next:done?null:{kind:request.kind,filters:clone(request.filters??{}),pageSize:request.pageSize,cursor:{position:next}}};
  }
 }
 const href=typeof pagination==='object'&&pagination.nextPointer?(()=>{let v=value;for(const p of pagination.nextPointer.slice(1).split('/'))v=v?.[p];return v;})():value?._links?.next?.href;
 if(!href)return {done:true,next:null};
 const next=new URL(href,requestURL(selected,path,query));need(next.origin===selected.base.origin&&next.pathname===requestURL(selected,path,{}).pathname,'SOURCE_CURSOR_SCOPE_MISMATCH','The original next page changed the selected source route.');
 const allowed=new Set(['cursor','limit','order',...(entry.pagination?.queryKeys??[])]);
 for(const [key,val] of next.searchParams){if(selected.base.searchParams.has(key))continue;need(entry.fixedNextQuery?.[key]===val||allowed.has(key)||String(query[key]??query[key.replace(/\[\]$/,'')]??'')===val||Array.isArray(query[key.replace(/\[\]$/,'')])&&query[key.replace(/\[\]$/,'')].map(String).includes(val),'SOURCE_CURSOR_SCOPE_MISMATCH','The original next page changed its selected filters.',{key});}
 const cursor=next.searchParams.get(entry.pagination?.cursorQuery??'cursor');
 need(cursor!==null,'INVALID_NATIVE_CURSOR','The original nonempty list did not expose its next cursor.');
 const nextRequest={kind:request.kind,filters:clone(request.filters??{}),pageSize:safeInteger(next.searchParams.get('limit')??request.pageSize??100,'Native page size',{minimum:1,maximum:entry.maximumPageSize??200}),cursor:{nativeCursor:cursor,order:next.searchParams.get('order')??query.order??null}};
 return {done:false,next:nextRequest,cursor,waiting:cursor===(request.cursor?.nativeCursor??request.cursor)};
}
function sourceEntry(selected,request,catalog){
 const entry=catalog.find(row=>row.kind===request.kind);need(entry,'UNKNOWN_READ_KIND','Select an original read from this source catalogue.');return entry;
}
function expanded(selected,entry,filters){
 const used=new Set(),network=selected.descriptor.network==='stellar:pubnet'?'public':'testnet';
 let path=entry.path.replace(/\{([^}]+)\}/g,(_all,key)=>{const value=key==='network'?network:filters[key];need(value!==undefined&&value!==null,'MISSING_FILTER','Original route requires '+key+'.');used.add(key);return encodeURIComponent(String(value));});
 const query={};for(const [key,value] of Object.entries(filters))if(!used.has(key))query[entry.queryMapping?.[key]??key]=value;
 return {path,query};
}
async function windowRead(selected,request,entry){
 const filters=filterInput(request.filters,entry),from=safeInteger(filters.startLedger,'Start ledger',{minimum:1,maximum:0xffffffff}),end=safeInteger(filters.endLedger,'Exclusive end ledger',{minimum:1,maximum:0xffffffff});need(end>from,'INVALID_RANGE','The original ledger range must increase.');
 if(filters.from)filters.from=iso(filters.from,'Period start');if(filters.to)filters.to=iso(filters.to,'Period end');
 const cursor=request.cursor??{phase:'anchor',ledger:from,nativeCursor:null},pageSize=safeInteger(request.pageSize??200,'Original page size',{minimum:1,maximum:200}),exchanges=[];
 need(['anchor','global'].includes(cursor.phase),'INVALID_NATIVE_CURSOR','Use the original window continuation.');
 const root=await http(selected,'/',{}, {kind:'root',filters:{}},request.signal);projectResponse(root,HORIZON_CATALOG[0]);exchanges.push(root);
 if(root.error)return {...root,exchanges:[],continuation:{done:false,next:{kind:request.kind,filters,pageSize,cursor}}};
 const actual=ratingsNetwork(selected.descriptor.network);if(root.value.network_passphrase!==actual.passphrase){root.error={code:'NETWORK_MISMATCH',message:'The original Horizon network differs from the selected registry.'};return {...root,exchanges:[],continuation:{done:false,next:{kind:request.kind,filters,pageSize,cursor}}};}
 const oldest=safeInteger(root.value.history_elder_ledger??1,'Original retained oldest ledger',{minimum:1,maximum:0xffffffff}),latest=safeInteger(root.value.history_latest_ledger,'Original retained latest ledger',{minimum:1,maximum:0xffffffff}),required=safeInteger(cursor.ledger??from,'Original continuation ledger',{minimum:from,maximum:0xffffffff});
 if(required<oldest||latest<end-1){root.error={code:required<oldest?'RETENTION_GAP':'WAITING_FOR_LEDGER',message:required<oldest?'The original next required ledger is outside this Horizon retained range.':'The selected interval end has not been ingested by this Horizon.',details:{requiredLedger:required,oldestLedger:oldest,latestLedger:latest,endLedger:end}};return {...root,exchanges:[],continuation:{done:false,next:{kind:request.kind,filters,pageSize,cursor},waiting:latest<end-1}};}
 const path=cursor.phase==='anchor'?'/ledgers/'+required+'/operations':'/operations',query={order:'asc',limit:pageSize,include_failed:false,join:'transactions'};
 if(cursor.phase==='global')query.cursor=text(cursor.nativeCursor,'Original operation cursor',128);
 const nativeSelection={startLedger:from,endLedger:end,from:filters.from??null,to:filters.to??null,scope:'network',...(cursor.phase==='anchor'?{ledger:required}:{})};
 const main=await http(selected,path,query,{kind:'operations-window',filters,nativeSelection},request.signal);projectResponse(main,entry);
 if(main.error)return {...main,exchanges,continuation:{done:false,next:{kind:request.kind,filters,pageSize,cursor}}};
 let overrun=false,last=null,lastLedger=required;
 try{
 for(const row of main.records){
  const ledger=Number(row.transaction?.ledger??row.ledger??(cursor.phase==='anchor'?required:NaN));
  need(Number.isSafeInteger(ledger)&&ledger>=1,'JOINED_LEDGER_REQUIRED','Original joined operations must retain their actual ledger.');
  if(ledger>=end||filters.to&&row.created_at&&Date.parse(row.created_at)>=Date.parse(filters.to))overrun=true;
  last=row.paging_token;lastLedger=ledger;
 }
 const relevant=new Set(['path_payment_strict_receive','path_payment_strict_send','account_merge','claim_claimable_balance','clawback_claimable_balance','liquidity_pool_deposit','liquidity_pool_withdraw','invoke_host_function','manage_sell_offer','manage_buy_offer','create_passive_sell_offer']);
 if(filters.includeEffects!==false)for(const row of main.records.filter(x=>relevant.has(x.type))){
  const ledger=Number(row.transaction?.ledger??row.ledger??required);if(ledger>=end)continue;
  let effectCursor=null;
  for(;;){
   const effectQuery={limit:200,order:'asc',...(effectCursor?{cursor:effectCursor}:{})},effectEntry=HORIZON_CATALOG.find(x=>x.kind==='operation-effects');
   const selection={...nativeSelection,operationId:String(row.id),operationType:row.type,transactionHash:row.transaction_hash??row.transaction?.hash,ledger,occurredAt:row.created_at??row.transaction?.created_at,selected:ledger>=from&&ledger<end,sourceAccount:row.source_account??row.from??null,destination:row.to??row.into??null,balanceId:row.balance_id??null};
   const effect=await http(selected,'/operations/'+encodeURIComponent(String(row.id))+'/effects',effectQuery,{kind:'operation-effects',filters:{operationId:String(row.id)},nativeSelection:selection},request.signal);projectResponse(effect,effectEntry);exchanges.push(effect);
   if(effect.error){main.error={code:'NATIVE_EFFECTS_INCOMPLETE',message:'The complete original operation effects did not return.',details:{operationId:row.id,error:effect.error}};break;}
   if(!effect.records.length)break;
   const next=effect.value?._links?.next?.href;if(!next)break;
   const nextURL=new URL(next,selected.base),nextCursor=nextURL.searchParams.get('cursor');
   need(nextURL.origin===selected.base.origin&&nextURL.pathname===requestURL(selected,'/operations/'+encodeURIComponent(String(row.id))+'/effects',{}).pathname,'SOURCE_CURSOR_SCOPE_MISMATCH','Original effects cursor changed operation.');
   need(nextCursor&&nextCursor!==effectCursor,'SOURCE_CURSOR_STALLED','Original effects cursor did not advance.');effectCursor=nextCursor;
  }
  if(main.error)break;
 }
 let done=overrun,nextCursor;
 if(main.records.length===0){if(cursor.phase==='anchor'){done=required+1>=end;nextCursor={phase:'anchor',ledger:required+1,nativeCursor:null};}else done=true;}
 else nextCursor={phase:'global',nativeCursor:text(last,'Original next operation cursor',128),ledger:lastLedger};
 if(main.error)done=false;
 return {...main,exchanges,continuation:{done,next:done?null:{kind:request.kind,filters,pageSize,cursor:main.error?cursor:nextCursor},selectedEndLedger:end}};
 }catch(error){return {...main,error:{code:error.code??'NATIVE_WINDOW_ERROR',message:error.message,details:error.details??null},exchanges,continuation:{done:false,next:{kind:request.kind,filters,pageSize,cursor},selectedEndLedger:end}};}
}
export function openRatingsSource(connection){
 if(connection.provider==='stellar')return openRatingsStellarSource(connection);
 const selected=configured(connection),catalog=selected.routes??(selected.descriptor.provider==='bluechip'?BLUECHIP_CATALOG:selected.descriptor.provider==='horizon'?HORIZON_CATALOG:EXPERT_CATALOG);
 return {descriptor:selected.descriptor,catalog:clone(catalog),describe(){return {descriptor:clone(selected.descriptor),catalog:clone(catalog)};},async read(request){
  object(request,'Original source read');const entry=sourceEntry(selected,request,catalog);
  if(selected.descriptor.provider==='horizon'&&request.kind==='operations-window')return windowRead(selected,request,entry);
  const filters=filterInput(request.filters,entry),route=expanded(selected,entry,filters),listRoute=selected.descriptor.provider==='source'?Boolean(entry.pagination):entry.recordsPath!==''||entry.pagination;
  if(listRoute){route.query[entry.pagination?.limitQuery??'limit']=safeInteger(request.pageSize??entry.defaultPageSize??100,'Original page size',{minimum:1,maximum:entry.maximumPageSize??200});}
  if(request.cursor!==undefined&&request.cursor!==null){
   if(entry.pagination?.type==='offset'||entry.pagination?.type==='page')route.query[entry.pagination.positionQuery??entry.pagination.type]=safeInteger(request.cursor.position,'Original page position');
   else route.query[entry.pagination?.cursorQuery??'cursor']=text(typeof request.cursor==='string'?request.cursor:request.cursor.nativeCursor,'Original native cursor',4096);
   if(request.cursor.order)route.query.order=request.cursor.order;
  }
  const main=await http(selected,route.path,route.query,{kind:request.kind,filters,projection:entry.projection??null,publicPath:selected.descriptor.provider==='source'?'configured-route:'+entry.kind:route.path},request.signal);
  projectResponse(main,entry);
  if(selected.descriptor.provider==='horizon'&&request.kind==='root'&&!main.error&&main.value.network_passphrase!==ratingsNetwork(selected.descriptor.network).passphrase)main.error={code:'NETWORK_MISMATCH',message:'Original Horizon network differs from the selected registry.'};
  let continuation={done:true,next:null};
  if(!main.error){try{continuation=nativeNext(main.value,selected,route.path,route.query,entry,{...request,filters},main.records);}catch(error){main.error={code:error.code??'SOURCE_PAGINATION_ERROR',message:error.message,details:error.details??null};continuation={done:false,next:{kind:request.kind,filters,pageSize:request.pageSize??100,cursor:request.cursor??null}};}}
  else continuation={done:false,next:{kind:request.kind,filters,pageSize:request.pageSize??100,cursor:request.cursor??null}};
  return {...main,continuation,exchanges:[],...(entry.projection?{mapping:clone(entry.projection)}:{}),...(entry.format?{format:entry.format}:{})};
 }};
}


function frozenDefinition(value,kind){return kind==='registry'?normalizeRatingsRegistry(value?.definition??value):normalizeWalletPolicy(value?.definition??value);}
function selectedConnections(connections,aliases,network){
 object(connections,'Trusted source connections');object(aliases??{},'Selected source aliases');
 const all=Object.entries(connections).map(([alias,configuration])=>{
  text(alias,'Connection alias',128);object(configuration,'Trusted connection');
  const source=openRatingsSource(configuration);
  return {alias,configuration,source,descriptor:source.descriptor};
 });
 const pick=(key,provider,required=false)=>{
  const name=aliases?.[key];
  const item=name?all.find(row=>row.alias===name):all.find(row=>row.descriptor.provider===provider&&row.descriptor.network===network);
  if(name)need(item&&item.descriptor.provider===provider,'CONNECTION_SELECTION_MISMATCH','The selected '+key+' alias has a different original provider.',{alias:name,provider});
  if(item)need(item.descriptor.network===network,'NETWORK_MISMATCH','The selected connection is on another Stellar network.',{alias:item.alias});
  if(required)need(item,'SOURCE_CONNECTION_REQUIRED','Select an original '+provider+' connection for this complete collection.',{role:key});
  return item??null;
 };
 return {all,pick};
}
function observation(exchange,selected){
 return {provider:selected.descriptor.provider,kind:exchange.kind??exchange.request?.kind??'native',network:selected.descriptor.network,connectionAlias:selected.alias,descriptor:clone(selected.descriptor),sourceScope:selected.descriptor.sourceScope??selected.descriptor.id,
  request:clone(exchange.request),response:{...exchange.response,body:Buffer.from(exchange.response.body)},records:clone(exchange.records??[]),recordsPath:exchange.recordsPath??null,
  ...(exchange.runtime?{runtime:clone(exchange.runtime)}:{}),...(exchange.mapping?{mapping:clone(exchange.mapping)}:{}),...(exchange.format?{format:exchange.format}:{}),...(exchange.error?{error:clone(exchange.error)}:{})};
}
async function observe(selected,request,observations){
 const result=await selected.source.read(request);
 for(const exchange of result.exchanges??[])observations.push(observation(exchange,selected));
 observations.push(observation({...result,kind:request.kind},selected));return result;
}
function planningFailure(code,message,details,observations,runtime){
 const error=new RatingsError(code,message,details);error.observations=observations;error.runtime=runtime??null;return error;
}
function planTask(selected,kind,filters,{assetId=null,pageSize,required=true,coverage=null}={}){
 const entry=selected.source.catalog.find(row=>row.kind===kind);need(entry,'UNKNOWN_READ_KIND','The selected source lacks this original native read.',{alias:selected.alias,kind});
 const body={connectionAlias:selected.alias,kind,filters:clone(filters),...(pageSize?{pageSize}:{}),assetId,required,coverage:clone(coverage)};
 return {id:sha256(body),...body};
}
function planRuntime(runtime,stellarSource){return runtime??(stellarSource?runtimeOptionsFor(stellarSource.configuration):{});}
function runtimeOptionsFor(connection){return connection.runtime??{installationDirectory:connection.installationDirectory,runtimeDirectory:connection.runtimeDirectory,expectedManifestSha256:connection.expectedManifestSha256};}
function providerAsset(asset){return asset.assetType==='native'?'XLM':asset.assetCode+'-'+asset.assetIssuer;}
function bindingValue(path,context){
 need(typeof path==='string'&&/^(asset|registry|policy|period)\.[A-Za-z][A-Za-z0-9]*$|^asOf$/.test(path),'INVALID_SOURCE_PLANNING','A source planning binding must select one original registry/policy/period field.');
 if(path==='asOf')return context.asOf;
 const [object,key]=path.split('.');return context[object]?.[key];
}
function plannedExternal(tasks,issues,selected,context,entities){
 if(!selected)return;
 for(const route of selected.source.catalog){
  if(!entities.includes(route.projection?.entity??route.planning?.entity))continue;
  const planning=route.planning??{},bindings=planning.bindings??{},schema=route.filtersSchema??{properties:{}},properties=schema.properties??{};
  const defaults={assetKey:'asset.assetKey',assetId:'asset.id',pricingKey:'asset.pricingKey',assetCode:'asset.assetCode',assetIssuer:'asset.assetIssuer',symbol:'asset.bluechipSymbol',quoteCurrency:'policy.quoteCurrency',network:'registry.network',from:'period.from',to:'period.to',asOf:'asOf'};
  const selectedBindings={...Object.fromEntries(Object.entries(defaults).filter(([key])=>Object.hasOwn(properties,key))),...bindings};
  const assetScoped=planning.scope==='asset'||planning.scope!=='all'&&Object.values(selectedBindings).some(value=>value.startsWith('asset.'));
  const scopes=assetScoped?context.assets.filter(asset=>asset.enabled):[null];
  for(const asset of scopes){
   const filters=clone(planning.filters??{});
   for(const [name,path] of Object.entries(selectedBindings)){const value=bindingValue(path,{...context,asset});if(value!==undefined&&value!==null)filters[name]=clone(value);}
   const missing=(schema.required??[]).filter(name=>filters[name]===undefined||filters[name]===null);
   if(missing.length){issues.push({code:'SOURCE_PLANNING_BINDING_REQUIRED',connectionAlias:selected.alias,kind:route.kind,assetId:asset?.id??null,fields:missing});continue;}
   tasks.push(planTask(selected,route.kind,filters,{assetId:asset?.id??null,pageSize:route.pagination?safeInteger(route.defaultPageSize??100,'Original source page size',{minimum:1,maximum:route.maximumPageSize??200}):undefined,required:planning.required!==false,coverage:{kind:route.projection?.entity??planning.entity,scope:asset?'asset':'configured-original-source',assetId:asset?.id??null}}));
  }
 }
}
function externalConnections(selected,aliases,entity){
 const preferred=aliases?.[entity==='price'?'prices':entity==='score'?'scores':entity];
 if(preferred){const value=selected.all.find(item=>item.alias===preferred);need(value&&value.descriptor.provider==='source','CONNECTION_SELECTION_MISMATCH','Select an original configured pricing/CMS source.',{alias:preferred});return [value];}
 return selected.all.filter(item=>item.descriptor.provider==='source'&&item.source.catalog.some(route=>route.projection?.entity===entity||route.planning?.entity===entity));
}
function addExternalPlans(tasks,issues,selected,aliases,context){
 const used=new Set();
 for(const entity of ['price','score','fx','rating','methodology'])for(const source of externalConnections(selected,aliases,entity)){
  const key=source.alias+':'+entity;if(used.has(key))continue;used.add(key);plannedExternal(tasks,issues,source,context,[entity]);
 }
 if(!tasks.some(item=>selected.all.find(source=>source.alias===item.connectionAlias)?.source.catalog.find(route=>route.kind===item.kind)?.projection?.entity==='price'))
  issues.push({code:'RETAINED_PRICE_SOURCE_REQUIRED',message:'Valuation needs an original retained price edition or a configured native pricing read.'});
}
function uniqueTasks(tasks){return [...new Map(tasks.map(row=>[row.id,row])).values()];}
/** One complete original wallet collection; the owning workspace journals each returned task. */
export async function prepareRatingsWalletPlan({registry,policy,addresses,connections,connectionAliases={},asOf=new Date().toISOString(),runtime,signal}){
 const reg=frozenDefinition(registry,'registry'),pol=frozenDefinition(policy,'policy'),observations=[],issues=[],tasks=[],at=iso(asOf,'Wallet source time');
 const selected=selectedConnections(connections,connectionAliases,reg.network),stellar=selected.pick('stellar','stellar'),horizon=selected.pick('horizon','horizon'),bluechip=selected.pick('bluechip','bluechip'),expert=selected.pick('stellarExpert','stellar-expert');
 const accounts=await prepareRatingsAccounts({addresses,registry:reg,runtime:planRuntime(runtime,stellar)});
 try{
  if(accounts.accounts.some(item=>item.type==='G')){
   if(!horizon)throw planningFailure('SOURCE_CONNECTION_REQUIRED','Select Horizon for the original classic wallet balances.',{provider:'horizon'},observations,accounts.runtime);
   const root=await observe(horizon,{kind:'root',filters:{},signal},observations);
   if(root.error)throw planningFailure(root.error.code,root.error.message,root.error.details??{},observations,accounts.runtime);
   for(const account of accounts.accounts.filter(item=>item.type==='G'))tasks.push(planTask(horizon,'account',{account:account.account},{required:true,coverage:{kind:'account',scope:'account',account:account.account}}));
  }
  if(expert){
   const labeled=accounts.accounts.filter(item=>item.type==='G').map(item=>item.account);
   for(let offset=0;offset<labeled.length;offset+=50)tasks.push(planTask(expert,'directory',{address:labeled.slice(offset,offset+50)},{pageSize:200,required:false,coverage:{kind:'directory',scope:'accounts',accounts:labeled.slice(offset,offset+50)}}));
  }
  if(stellar){
   const network=await observe(stellar,{kind:'network',filters:{},signal},observations);
   if(network.error)throw planningFailure(network.error.code,network.error.message,network.error.details??{},observations,accounts.runtime);
   for(const asset of accounts.assets.filter(item=>item.enabled&&item.assetType!=='contract'))tasks.push(planTask(stellar,'asset-contract',{assetType:asset.assetType,assetCode:asset.assetCode,...(asset.assetIssuer?{assetIssuer:asset.assetIssuer}:{}),contractId:asset.contractId},{assetId:asset.id,required:false,coverage:{kind:'asset-contract',scope:'asset',assetId:asset.id}}));
  }
  const contractAccounts=accounts.accounts.filter(item=>item.type==='C');
  if(contractAccounts.length){
   if(!stellar)throw planningFailure('SOURCE_CONNECTION_REQUIRED','Select RPC for explicitly enabled contract wallet balances.',{provider:'stellar'},observations,accounts.runtime);
   const simulationAccount=stellar.configuration.simulationAccount??reg.assets.find(item=>item.assetIssuer)?.assetIssuer??null;
   for(const account of contractAccounts)for(const asset of accounts.assets.filter(item=>item.enabled)){
    const filters={contractId:asset.contractId,account:account.account,assetType:asset.assetType,...(asset.assetCode?{assetCode:asset.assetCode}:{}),...(asset.assetIssuer?{assetIssuer:asset.assetIssuer}:{}),...(asset.decimals!==null?{decimals:asset.decimals}:{}),...(simulationAccount?{simulationAccount}:{})};
    tasks.push(planTask(stellar,'contract-balance',filters,{assetId:asset.id,required:true,coverage:{kind:'contract-balance',scope:'account-asset',account:account.account,assetId:asset.id}}));
   }
  }
  if(bluechip)for(const symbol of [...new Set(reg.assets.filter(item=>item.enabled&&item.bluechipSymbol).map(item=>item.bluechipSymbol))])
   tasks.push(planTask(bluechip,'grade',{coin:symbol},{required:false,coverage:{kind:'rating',scope:'original-symbol',symbol}}));
  addExternalPlans(tasks,issues,selected,connectionAliases,{registry:reg,policy:pol,assets:accounts.assets,asOf:at,period:null});
  return {schema:'stellar-forge.ratings-wallet-plan.v1',phase:'READY',network:reg.network,asOf:at,inputs:accounts.inputs,accounts:accounts.accounts,addresses:accounts,assets:accounts.assets,runtime:accounts.runtime,tasks:uniqueTasks(tasks),observations,issues};
 }catch(error){if(!error.observations)error.observations=observations;if(!error.runtime)error.runtime=accounts.runtime;throw error;}
}
function selectedPeriod(value){
 object(value,'UTC collection period');const from=iso(value.from,'Period start'),to=iso(value.to,'Period end');
 need(value.timeZone===undefined||value.timeZone==='UTC','INVALID_PERIOD','Daily collection periods use UTC.');
 need(Date.parse(to)>Date.parse(from)&&Date.parse(to)-Date.parse(from)<=86400000,'INVALID_PERIOD','Select one forward UTC interval of at most 24 hours.');
 return {from,to,timeZone:'UTC'};
}
function originalJSON(result){need(result.response?.bodyComplete&&!result.error,'SOURCE_OBSERVATION_FAILED','An original boundary observation did not complete.');return parseRatingsJSON(result.response.body).value;}
async function ledgerObservation(horizon,sequence,observations,cache,signal){
 if(cache.has(sequence))return cache.get(sequence);
 const result=await observe(horizon,{kind:'ledger',filters:{ledger:sequence},signal},observations);
 if(result.error)throw planningFailure(result.error.code,result.error.message,result.error.details??{},observations);
 const value=originalJSON(result),number=safeInteger(value.sequence,'Original ledger sequence',{minimum:1,maximum:0xffffffff}),time=iso(value.closed_at,'Original ledger close time');
 need(number===sequence,'LEDGER_IDENTITY_MISMATCH','The original ledger response differs from its selected sequence.');
 const item={sequence:number,closedAt:time,at:Date.parse(time)};cache.set(sequence,item);return item;
}
async function firstLedgerAtOrAfter({time,horizon,expert,oldest,latest,observations,cache,signal}){
 const target=Date.parse(time);let low=oldest,high=latest;
 if(expert){
  const result=await observe(expert,{kind:'ledger-from-time',filters:{timestamp:time},signal},observations);
  if(!result.error){
   const original=originalJSON(result),candidate=safeInteger(original.sequence,'Original indexed ledger',{minimum:1,maximum:0xffffffff});
   if(candidate>=oldest&&candidate<=latest){
    const actual=await ledgerObservation(horizon,candidate,observations,cache,signal);
    if(actual.at===target)return candidate;
    if(actual.at<target)low=candidate+1;else high=candidate;
   }
  }
 }
 while(low<high){
  const mid=low+Math.floor((high-low)/2),entry=await ledgerObservation(horizon,mid,observations,cache,signal);
  if(entry.at<target)low=mid+1;else high=mid;
 }
 const selected=await ledgerObservation(horizon,low,observations,cache,signal);
 need(selected.at>=target,'WAITING_FOR_BOUNDARY','The original retained ledger history has not reached this UTC boundary.',{time,latestLedger:latest});
 return low;
}
/** Freeze the original UTC ledger boundaries, then return full native collection tasks. */
export async function prepareRatingsActivityPlan({registry,policy,period,connections,connectionAliases={},asOf=new Date().toISOString(),runtime,signal}){
 const reg=frozenDefinition(registry,'registry'),pol=frozenDefinition(policy,'policy'),window=selectedPeriod(period),at=iso(asOf,'Collection observation time'),observations=[],issues=[],tasks=[];
 const selected=selectedConnections(connections,connectionAliases,reg.network),horizon=selected.pick('horizon','horizon',true),expert=selected.pick('stellarExpert','stellar-expert'),stellar=selected.pick('stellar','stellar'),bluechip=selected.pick('bluechip','bluechip');
 // The original SDK binds each SAC/network identity before any mutable provider read.
 const identity=await prepareRatingsAssets({registry:reg,runtime:planRuntime(runtime,stellar)});
 const assets=identity.assets;let frozen=null;
 try{
  const root=await observe(horizon,{kind:'root',filters:{},signal},observations);
  if(root.error)throw planningFailure(root.error.code,root.error.message,root.error.details??{},observations,identity.runtime);
  const header=originalJSON(root),oldest=safeInteger(header.history_elder_ledger??1,'Original oldest ledger',{minimum:1,maximum:0xffffffff}),latest=safeInteger(header.history_latest_ledger,'Original latest ledger',{minimum:1,maximum:0xffffffff}),cache=new Map();
  const head=await ledgerObservation(horizon,latest,observations,cache,signal);
  if(head.at<Date.parse(window.to))return {schema:'stellar-forge.ratings-activity-plan.v1',phase:'WAITING_FOR_BOUNDARY',network:reg.network,period:window,asOf:at,runtime:identity.runtime,assets,tasks:[],observations,issues,boundary:{requiredTime:window.to,latestLedger:latest,latestClosedAt:head.closedAt}};
  const elder=await ledgerObservation(horizon,oldest,observations,cache,signal);
  if(elder.at>Date.parse(window.from))throw planningFailure('RETENTION_GAP','The original selected UTC interval begins before this Horizon retained history.',{from:window.from,oldestLedger:oldest,oldestClosedAt:elder.closedAt},observations,identity.runtime);
  const startLedger=await firstLedgerAtOrAfter({time:window.from,horizon,expert,oldest,latest,observations,cache,signal}),endLedger=await firstLedgerAtOrAfter({time:window.to,horizon,expert,oldest,latest,observations,cache,signal});
  need(endLedger>=startLedger,'LEDGER_BOUNDARY_MISMATCH','Original UTC ledger boundaries are inconsistent.');
  frozen={startLedger,endLedger,historyOldestLedger:oldest,historyLatestLedger:latest,headClosedAt:head.closedAt,from:window.from,to:window.to};
  if(endLedger>startLedger)tasks.push(planTask(horizon,'operations-window',{startLedger,endLedger,from:window.from,to:window.to,includeEffects:true},{pageSize:200,required:true,coverage:{kind:'operations-window',scope:'network',from:window.from,to:window.to,startLedger,endLedger}}));
  else issues.push({code:'EMPTY_NATIVE_LEDGER_INTERVAL',from:window.from,to:window.to,startLedger,endLedger,message:'No original ledger closed inside this interval.'});
  if(expert)for(const asset of assets.filter(item=>item.enabled&&item.assetType!=='contract')){
   const originalAsset=providerAsset(asset),coverage={scope:'asset',assetId:asset.id};
   tasks.push(planTask(expert,'assets',{search:originalAsset},{assetId:asset.id,pageSize:200,required:false,coverage:{...coverage,kind:'asset-info'}}));
   tasks.push(planTask(expert,'supply',{asset:originalAsset},{assetId:asset.id,required:true,coverage:{...coverage,kind:'supply'}}));
   tasks.push(planTask(expert,'holders',{asset:originalAsset},{assetId:asset.id,pageSize:200,required:true,coverage:{...coverage,kind:'holders'}}));
  }
  else issues.push({code:'RETAINED_HOLDER_SUPPLY_SOURCE_REQUIRED',message:'Supply and holder concentration need a retained original snapshot or the selected indexed source.'});
  if(stellar&&endLedger>startLedger){
   const nativeNetwork=await observe(stellar,{kind:'network',filters:{},signal},observations);
   if(nativeNetwork.error)throw planningFailure(nativeNetwork.error.code,nativeNetwork.error.message,nativeNetwork.error.details??{},observations,identity.runtime);
   const contractAssets=assets.filter(item=>item.enabled&&(item.assetType==='contract'||reg.assets.find(original=>original.id===item.id)?.sacContractId));
   for(let offset=0;offset<contractAssets.length;offset+=5){
    const group=contractAssets.slice(offset,offset+5);
    tasks.push(planTask(stellar,'events',{contractIds:group.map(item=>item.contractId),assets:group,startLedger,endLedger,from:window.from,to:window.to},{pageSize:1000,required:true,coverage:{kind:'events',scope:'assets',assetIds:group.map(item=>item.id),from:window.from,to:window.to,startLedger,endLedger}}));
   }
  }
  if(bluechip)for(const symbol of [...new Set(assets.filter(item=>item.enabled&&item.bluechipSymbol).map(item=>item.bluechipSymbol))])
   tasks.push(planTask(bluechip,'grade',{coin:symbol},{required:false,coverage:{kind:'rating',scope:'original-symbol',symbol}}));
  addExternalPlans(tasks,issues,selected,connectionAliases,{registry:reg,policy:pol,assets,period:window,asOf:at});
  return {schema:'stellar-forge.ratings-activity-plan.v1',phase:'READY',network:reg.network,period:window,asOf:at,boundary:frozen,assets,runtime:identity.runtime,tasks:uniqueTasks(tasks),coverage:endLedger===startLedger?[{kind:'operations-window',scope:'network',status:'COMPLETE',from:window.from,to:window.to,startLedger,endLedger,empty:true}]:[],observations,issues};
 }catch(error){if(!error.observations)error.observations=observations;if(!error.runtime)error.runtime=identity.runtime;throw error;}
}

// MIT. Source-owned Stellar asset, wallet and daily-activity calculations.
import {RatingsError,need,clone,canonical,sha256,text,object,list,atPointer,parseRatingsJSON,parseRatingsCSV,decimalParts,decimalUnits,formatUnits,integerText,iso,ratingsNetwork,stellarAddress,safeInteger,jsonNative} from './lossless-json.mjs';
import {decodeRatingsStellarSource,decodeRatingsClaimableBalanceRemoval} from './stellar.mjs';

const SCHEMA='stellar-forge.stellar-ratings';
const ATTRIBUTION={label:'by Bluechip',url:'https://bluechip.org/'};
const ENTITY=new Set(['price','fx','score','rating','holding','activity','methodology','holder','supply','asset-info','directory']);
const ZERO={n:0n,d:1n};
function gcd(a,b){a=a<0n?-a:a;b=b<0n?-b:b;while(b){const t=a%b;a=b;b=t;}return a||1n;}
function rat(n,d=1n){need(d!==0n,'ZERO_DENOMINATOR','An exact calculation has a zero denominator.');if(d<0n){n=-n;d=-d;}const g=gcd(n,d);return {n:n/g,d:d/g};}
function dec(value,name='decimal'){const p=decimalParts(exactText(value,name),name);return p.scale<0?rat(p.coefficient*10n**BigInt(-p.scale)):rat(p.coefficient,10n**BigInt(p.scale));}
function add(a,b){return rat(a.n*b.d+b.n*a.d,a.d*b.d);}
function mul(a,b){return rat(a.n*b.n,a.d*b.d);}
function div(a,b){return rat(a.n*b.d,a.d*b.n);}
function cmp(a,b){return a.n*b.d<b.n*a.d?-1:a.n*b.d>b.n*a.d?1:0;}
function decimal(a,scale=12,mode='half-even'){
 let n=a.n,sign='';if(n<0n){n=-n;sign='-';}
 const factor=10n**BigInt(scale),scaled=n*factor,q=scaled/a.d,r=scaled%a.d;let rounded=q;
 if(mode==='half-even'&&(r*2n>a.d||(r*2n===a.d&&q%2n!==0n)))rounded++;
 else if(mode==='half-up'&&r*2n>=a.d)rounded++;
 else if(mode==='up'&&r!==0n)rounded++;
 let out=formatUnits(rounded,scale);if(scale)out=out.replace(/0+$/,'').replace(/\.$/,'');return (rounded===0n?'':sign)+out;
}
function wireRat(value,policy){return {value:decimal(value,policy?.rounding?.scale??12,policy?.rounding?.mode??'half-even'),numerator:value.n.toString(),denominator:value.d.toString()};}
function exactText(value,name){
 if(typeof value==='number'){need(Number.isSafeInteger(value),'UNSAFE_NUMERIC_INPUT',name+' must preserve its original decimal or integer text.');return String(value);}
 need(typeof value==='string','INVALID_AMOUNT',name+' requires exact text.');return value;
}
const optional=(value,name,maximum=2048)=>value===undefined||value===null||value===''?null:text(value,name,maximum);
const sourceIds=value=>[...new Set((value??[]).map(x=>text(x,'Source ID',256)))];
const cleanId=(value,name)=>{text(value,name,128);need(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value),'INVALID_ID',name+' must be a portable identifier.');return value;};
function url(value,name){if(value===undefined||value===null||value==='')return null;let u;try{u=new URL(value);}catch{throw new RatingsError('INVALID_URL',name+' must be an absolute HTTP URL.');}need(['http:','https:'].includes(u.protocol)&&!u.username&&!u.password,'INVALID_URL',name+' must be an HTTP URL without embedded credentials.');return u.href;}
function wrapper(value,name){object(value,name);const definition=value.definition??value;return {identity:value.definition?{id:value.id,version:value.version,sha256:value.sha256}:null,definition};}
function effective(row){const p=row.projection??{};return p.asOf??p.effectiveAt??p.occurredAt??row.observedAt;}
function timestamp(value,name='source time'){if(value===undefined||value===null||value==='')return null;return iso(value,name);}
function ref(row){return {recordId:row.id,sourceId:row.sourceId,captureId:row.captureId??null,sourceScope:row.sourceScope,provider:row.provider,kind:row.kind,asOf:effective(row)};}
function uniqueRefs(rows){return [...new Map(rows.flatMap(row=>[ref(row),...(row.duplicateSourceRefs??[])]).map(item=>[item.recordId,item])).values()];}
function keyAccount(value){if(typeof value!=='string')return value;return value;}
export function canonicalRatingsAsset(network,code,issuer,contractId=null){
 const selected=ratingsNetwork(network).network;
 if(contractId)return selected+'/contract:'+stellarAddress(contractId,'Contract token',{kind:'contract'});
 if(issuer===null||issuer===undefined||issuer===''){need(code==='XLM','INVALID_ASSET','An issuer-free classic asset must be native XLM.');return selected+'/XLM';}
 need(typeof code==='string'&&/^[A-Za-z0-9]{1,12}$/.test(code),'INVALID_ASSET','Classic asset code must contain one to twelve letters or digits.');
 return selected+'/'+code+':'+stellarAddress(issuer,'Asset issuer',{kind:'account'});
}
export function normalizeRatingsRegistry(input){
 const value=clone(object(input,'Registry')),network=ratingsNetwork(value.network).network;
 text(value.name,'Registry name',256);list(value.assets,'Registry assets');
 const ids=new Set(),slugs=new Set(),keys=new Set();
 const assets=value.assets.map((raw,index)=>{
  object(raw,'Registry asset');const row=clone(raw);
  row.id=cleanId(row.id??row.slug,'Registry asset ID');row.slug=cleanId(row.slug??row.id,'Public asset slug');
  row.assetType=row.assetType??(row.contractId&&!row.assetIssuer?'contract':row.assetIssuer?'credit':'native');
  need(['native','credit','contract'].includes(row.assetType),'INVALID_ASSET','Select native, credit or contract asset type.');
  if(row.assetType==='contract'){
   row.contractId=stellarAddress(row.contractId,'Contract token',{kind:'contract'});row.assetCode=row.assetCode??null;row.assetIssuer=null;
   row.assetKey=canonicalRatingsAsset(network,null,null,row.contractId);
   row.decimals=row.decimals===undefined||row.decimals===null?null:safeInteger(row.decimals,'Token decimals',{maximum:255});
  }else{
   row.assetIssuer=row.assetType==='native'?null:stellarAddress(row.assetIssuer,'Asset issuer',{kind:'account'});
   row.assetCode=row.assetType==='native'?'XLM':text(row.assetCode,'Asset code',12);
   row.assetKey=canonicalRatingsAsset(network,row.assetCode,row.assetIssuer);row.decimals=7;
  }
  row.sacContractId=row.sacContractId?stellarAddress(row.sacContractId,'Selected SAC',{kind:'contract'}):null;
  row.homeDomain=optional(row.homeDomain,'Home domain',253);row.bluechipSymbol=optional(row.bluechipSymbol,'Bluechip symbol',128);
  row.bluechipSlug=optional(row.bluechipSlug,'Bluechip slug',128);row.ratingUrl=url(row.ratingUrl,'Original rating URL');row.pricingKey=optional(row.pricingKey,'Original pricing key',512);
  row.peg=row.peg===null||row.peg===undefined?null:{currency:text(row.peg.currency,'Peg currency',16),amount:exactText(row.peg.amount,'Peg amount')};
  if(row.peg)need(cmp(dec(row.peg.amount),ZERO)>0,'INVALID_PEG','Peg amount must be positive.');
  for(const field of ['issuerAccounts','distributionAccounts','supplyChangingDistributionAccounts'])row[field]=[...new Set((row[field]??(field==='issuerAccounts'&&row.assetIssuer?[row.assetIssuer]:[])).map(x=>stellarAddress(x,field,{kind:'account'})))];
  row.supplyScope=clone(row.supplyScope??{source:'stellar-expert',kind:'issued-supply'});
  row.holderScope=clone(row.holderScope??{source:'stellar-expert',kind:'nonzero-indexed-holders',denominator:'issued-supply',topN:10});
  if(row.holderScope&&typeof row.holderScope==='object')row.holderScope.topN=safeInteger(row.holderScope.topN??10,'Top holder count',{minimum:1,maximum:10000});
  row.enabled=row.enabled!==false;row.sourceIds=sourceIds(row.sourceIds);
  need(!ids.has(row.id)&&!slugs.has(row.slug)&&!keys.has(row.assetKey),'DUPLICATE_REGISTRY_ASSET','Each registry ID, public slug and canonical asset must be unique.',{index});
  ids.add(row.id);slugs.add(row.slug);keys.add(row.assetKey);return row;
 });
 return {...value,name:value.name,network,assets,contractAccounts:[...new Set((value.contractAccounts??[]).map(x=>stellarAddress(x,'Enabled contract account',{kind:'contract'})))],sourceIds:sourceIds(value.sourceIds)};
}
export function normalizeWalletPolicy(input){
 const value=clone(object(input,'Wallet policy'));text(value.name,'Policy name',256);
 const minimumCoveragePercent=exactText(value.minimumCoveragePercent??'50','Minimum coverage');
 need(cmp(dec(minimumCoveragePercent),ZERO)>=0&&cmp(dec(minimumCoveragePercent),dec('100'))<=0,'INVALID_POLICY','Coverage must be between zero and100 percent.');
 const scoreRange={min:exactText(value.scoreRange?.min??'0','Minimum score'),max:exactText(value.scoreRange?.max??'1','Maximum score')};
 need(cmp(dec(scoreRange.min),dec(scoreRange.max))<0,'INVALID_POLICY','Score range must increase.');
 const bands=(value.gradeBands??[]).map(row=>({grade:text(row.grade,'Source-owned grade',32),minScore:exactText(row.minScore,'Grade threshold')}));
 const names=new Set();for(const band of bands){need(!names.has(band.grade),'INVALID_POLICY','Each source grade must be unique.');names.add(band.grade);need(cmp(dec(band.minScore),dec(scoreRange.min))>=0&&cmp(dec(band.minScore),dec(scoreRange.max))<=0,'INVALID_POLICY','A grade threshold is outside the selected score range.');}
 bands.sort((a,b)=>-cmp(dec(a.minScore),dec(b.minScore)));
 for(let i=1;i<bands.length;i++)need(cmp(dec(bands[i-1].minScore),dec(bands[i].minScore))!==0,'INVALID_POLICY','Grade thresholds must be distinct.');
 const mode=value.rounding?.mode??'half-even';need(['half-even','half-up','down','up'].includes(mode),'INVALID_POLICY','Select an explicit supported rounding mode.');
 const result={...value,name:value.name,minimumCoveragePercent,quoteCurrency:value.quoteCurrency??'USD',scoreRange,gradeBands:bands,rounding:{scale:safeInteger(value.rounding?.scale??12,'Output scale',{maximum:100}),mode},
  allowStalePrices:value.allowStalePrices===true,allowStaleRatings:value.allowStaleRatings===true,allowStaleScores:value.allowStaleScores===true,
  methodologySourceIds:sourceIds(value.methodologySourceIds),priceSourceScopes:sourceIds(value.priceSourceScopes),ratingSourceScopes:sourceIds(value.ratingSourceScopes),scoreSourceScopes:sourceIds(value.scoreSourceScopes)};
 need(result.quoteCurrency==='USD','INVALID_POLICY','This original wallet programme aggregates USD valuations.');
 for(const field of ['priceMaxAgeSeconds','ratingMaxAgeSeconds','scoreMaxAgeSeconds'])result[field]=safeInteger(value[field]??(field==='priceMaxAgeSeconds'?3600:172800),field,{minimum:1,maximum:315360000});
 return result;
}
function maybePointer(value,path){try{return atPointer(value,path);}catch(error){if(error.code==='RECORDS_PATH_MISSING')return undefined;throw error;}}
function assetFields(network,value,prefix=''){
 const type=value[prefix+'asset_type'],issuer=value[prefix+'asset_issuer']??value.assetIssuer??(prefix===''?value.issuer:undefined),code=value[prefix+'asset_code']??value.assetCode??(prefix===''?value.code:undefined);
 if(type==='liquidity_pool_shares')return {assetKey:ratingsNetwork(network).network+'/pool:'+text(value.liquidity_pool_id,'Liquidity pool ID',128),assetType:'pool',assetCode:null,assetIssuer:null,decimals:7,liquidityPoolId:value.liquidity_pool_id};
 if(type==='native'||(code==='XLM'&&!issuer))return {assetKey:canonicalRatingsAsset(network,'XLM',null),assetType:'native',assetCode:'XLM',assetIssuer:null,decimals:7};
 if(code&&issuer)return {assetKey:canonicalRatingsAsset(network,code,issuer),assetType:'credit',assetCode:code,assetIssuer:issuer,decimals:7};
 return null;
}
function parsedAsset(network,value){
 if(value==='native'||value==='XLM')return assetFields(network,{asset_type:'native'});
 if(typeof value!=='string')return null;
 const match=/^([A-Za-z0-9]{1,12})[:-](G[A-Z2-7]{55})(?:-\d+)?$/.exec(value);return match?assetFields(network,{asset_code:match[1],asset_issuer:match[2]}):null;
}
function originalFlow(network,asset,amount,from,to,kind,leg='transfer'){
 if(!asset||amount===undefined||amount===null)return null;
 const units=decimalUnits(exactText(amount,'Original operation amount'),asset.decimals);
 need(units>=0n,'INVALID_AMOUNT','Original transferred amount must not be negative.');
 return {...asset,amount:exactText(amount,'Original amount'),amountUnits:units.toString(),from:from??null,to:to??null,kind,leg};
}
function operationProjection(row,network,request){
 const type=row.type,source=row.source_account??row.from??null,flows=[],flowErrors=[];
 const push=(x)=>{if(x)flows.push(x);};
 if(type==='payment')push(originalFlow(network,assetFields(network,row),row.amount,row.from??source,row.to,type));
 else if(type==='create_account')push(originalFlow(network,assetFields(network,{asset_type:'native'}),row.starting_balance,row.funder??source,row.account,type));
 else if(type==='path_payment_strict_receive'||type==='path_payment_strict_send'){
  const send=assetFields(network,row,'source_'),receive=assetFields(network,row);
  if(send&&receive&&send.assetKey===receive.assetKey&&decimalUnits(row.source_amount,7)===decimalUnits(row.amount,7))
   push(originalFlow(network,receive,row.amount,row.from??source,row.to,type,'same-asset-path'));
  else{
   push(originalFlow(network,receive,row.amount,null,row.to,type,'destination'));
   push(originalFlow(network,send,row.source_amount,row.from??source,null,type,'source'));
  }
 }else if(type==='clawback')push(originalFlow(network,assetFields(network,row),row.amount,row.from,null,type,'burn'));
 else if(type==='create_claimable_balance')push(originalFlow(network,parsedAsset(network,row.asset),row.amount,source,row.balance_id??null,type,'escrow-funding'));
 else if(type==='liquidity_pool_deposit'||type==='liquidity_pool_withdraw'){
  const deposit=type==='liquidity_pool_deposit',pool='liquidity-pool:'+row.liquidity_pool_id;
  for(const reserve of (deposit?row.reserves_deposited:row.reserves_received)??[])push(originalFlow(network,parsedAsset(network,reserve.asset),reserve.amount,deposit?source:pool,deposit?pool:source,type,'pool'));
 }
 else if(type==='invoke_host_function'){
  if(Array.isArray(row.asset_balance_changes))for(let index=0;index<row.asset_balance_changes.length;index++){
   const change=row.asset_balance_changes[index],asset=assetFields(network,change);
   if(!asset||!['transfer','mint','burn','clawback'].includes(change.type)){flowErrors.push({code:'UNKNOWN_NATIVE_ASSET_CHANGE',index});continue;}
   const flow=originalFlow(network,asset,change.amount,change.from??null,change.to??null,change.type,'horizon-sac-event');
   if(flow)push({...flow,nativeBalanceChangeIndex:index,destinationMuxedId:change.destination_muxed_id??change.to_muxed_id??null});
  }else flowErrors.push({code:'NATIVE_ASSET_CHANGES_MISSING'});
 }
 const selection=request?.nativeSelection??request?.selection??{},ledger=String(row.transaction?.ledger??row.ledger??selection.ledger??''),occurredAt=row.created_at??row.transaction?.created_at??selection.occurredAt??null;
 const selected=(!selection.startLedger||!ledger||BigInt(ledger)>=BigInt(selection.startLedger))&&(!selection.endLedger||!ledger||BigInt(ledger)<BigInt(selection.endLedger))&&(!selection.from||!occurredAt||Date.parse(occurredAt)>=Date.parse(selection.from))&&(!selection.to||!occurredAt||Date.parse(occurredAt)<Date.parse(selection.to));
 return {entity:'operation',operationId:String(row.id??row.paging_token??''),transactionHash:row.transaction_hash??row.transaction?.hash??null,operationType:type,sourceAccount:source,destination:row.to??row.into??null,balanceId:row.balance_id??null,ledger:ledger||null,occurredAt,successful:row.transaction_successful!==false&&row.transaction?.successful!==false,selected,flows,flowErrors,assetBalanceChangesPresent:Array.isArray(row.asset_balance_changes),requiresEffects:['path_payment_strict_receive','path_payment_strict_send','account_merge','claim_claimable_balance','liquidity_pool_deposit','liquidity_pool_withdraw','manage_sell_offer','manage_buy_offer','create_passive_sell_offer'].includes(type)};
}
function effectProjection(row,network,request){
 const selection=request?.nativeSelection??request?.selection??{},type=row.type,asset=assetFields(network,row)??parsedAsset(network,row.asset),flows=[];
 const push=value=>{if(value)flows.push(value);};
 if(['liquidity_pool_deposited','liquidity_pool_withdrew'].includes(type)){
  const values=row.reserves_deposited??row.reserves_received??[];
  for(const value of values)push(originalFlow(network,parsedAsset(network,value.asset),value.amount,type==='liquidity_pool_deposited'?row.account:null,type==='liquidity_pool_withdrew'?row.account:null,type,'pool'));
 }else if(type==='account_credited'&&selection.operationType==='account_merge'){
  push(originalFlow(network,asset,row.amount,selection.sourceAccount??null,row.account,'account_merge','merge'));
 }else if(type==='claimable_balance_claimed'){
  push(originalFlow(network,asset,row.amount,row.balance_id??selection.balanceId??null,row.account,'claim_claimable_balance','escrow-release'));
 }else if(type==='liquidity_pool_trade'){
  const pool=row.liquidity_pool?.id?'liquidity-pool:'+row.liquidity_pool.id:null;
  push(originalFlow(network,parsedAsset(network,row.sold?.asset),row.sold?.amount,row.account,pool,'trade','pool-trade-sold'));
  push(originalFlow(network,parsedAsset(network,row.bought?.asset),row.bought?.amount,pool,row.account,'trade','pool-trade-bought'));
 }else if(type==='trade'){
  const from=row.account??null,to=row.seller??null;
  push(originalFlow(network,assetFields(network,row,'sold_'),row.sold_amount,from,to,'trade','trade-sold'));
  push(originalFlow(network,assetFields(network,row,'bought_'),row.bought_amount,to,from,'trade','trade-bought'));
 }
 let operationId=selection.operationId??null;
 if(!operationId){const original=row._links?.operation?.href;if(typeof original==='string'){const match=/\/operations\/([0-9]+)(?:[?#].*)?$/.exec(original);if(match)operationId=match[1];}}
 return {entity:'effect',effectId:row.id??row.paging_token??null,operationId,operationType:selection.operationType??null,transactionHash:selection.transactionHash??row.transaction_hash??null,ledger:selection.ledger??null,occurredAt:row.created_at??selection.occurredAt??null,effectType:type,account:row.account??null,seller:row.seller??null,offerId:row.offer_id??null,...(asset??{}),amount:row.amount===undefined?null:exactText(row.amount,'Original effect amount'),amountUnits:asset&&row.amount!==undefined?decimalUnits(exactText(row.amount,'Original effect amount'),asset.decimals).toString():null,flows,selected:selection.selected!==false};
}
function mappingProjection(raw,mapping,kind,network){
 const entity=mapping?.entity??kind;need(ENTITY.has(entity),'INVALID_SOURCE_MAPPING','Select an original rating, score, price, holding, activity or metadata source kind.');
 const p={entity},fields=mapping?.fields??null;
 if(fields){object(fields,'Source fields');for(const [name,pointer] of Object.entries(fields)){need(typeof pointer==='string','INVALID_SOURCE_MAPPING','Field mappings use exact JSON pointers.');const value=maybePointer(raw,pointer);if(value!==undefined)p[name]=clone(value);}}
 else Object.assign(p,clone(object(raw,'Imported source row')));
 p.entity=entity;
 if(p.assetKey===undefined){
  const asset=assetFields(network,p)??parsedAsset(network,p.asset);
  if(asset)Object.assign(p,asset);else if(p.contractId)p.assetKey=canonicalRatingsAsset(network,null,null,p.contractId);
 }
 if(p.asOf!==undefined)p.asOf=timestamp(p.asOf);
 if(p.effectiveAt!==undefined)p.effectiveAt=timestamp(p.effectiveAt);
 if(p.occurredAt!==undefined)p.occurredAt=timestamp(p.occurredAt);
 for(const field of ['price','score','amount','rate','value','pegAmount'])if(p[field]!==undefined&&p[field]!==null){p[field]=exactText(p[field],field);dec(p[field],field);}
 if(entity==='price'){p.quoteCurrency=p.quoteCurrency??mapping?.quoteCurrency??'USD';need(p.price!==undefined,'INVALID_PRICE','A price source needs its original price.');need(cmp(dec(p.price),ZERO)>=0,'INVALID_PRICE','Price must not be negative.');}
 if(entity==='score'){need(p.score!==undefined,'INVALID_SCORE','A numerical score source needs its original score.');p.methodologyVersion=p.methodologyVersion??mapping?.methodologyVersion??null;}
 if(['holding','holder'].includes(entity)){
  const precision=p.decimals??mapping?.decimals??(p.assetType==='contract'||p.contractId?null:7);need(precision!==null,'TOKEN_DECIMALS_REQUIRED','An original contract holding must retain its observed precision.');p.decimals=safeInteger(precision,'Original asset precision',{maximum:255});
  if(p.amountUnits!==undefined)p.amountUnits=integerText(p.amountUnits,'Balance units');
  else if(p.amount!==undefined)p.amountUnits=(mapping?.units==='base'?BigInt(integerText(p.amount,'Balance units')):decimalUnits(p.amount,p.decimals)).toString();
  need(p.amountUnits!==undefined,'INVALID_HOLDING','An original holding needs its exact quantity.');
  p.amount=formatUnits(p.amountUnits,p.decimals);p.account=stellarAddress(p.account,'Holding account');
 }
 if(entity==='rating'){p.grade=text(p.grade,'Original Bluechip grade',32);p.url=url(p.url??p.ratingUrl,'Original rating page');p.attribution={...ATTRIBUTION,gradeUrl:p.url};}
 if(entity==='fx'){p.baseCurrency=text(p.baseCurrency,'FX base',16);p.quoteCurrency=text(p.quoteCurrency,'FX quote',16);need(p.rate!==undefined&&cmp(dec(p.rate),ZERO)>0,'INVALID_PRICE','An FX rate must be positive.');}
 return p;
}
export async function normalizeRatingsRecords(context){
 object(context,'Original source context');const provider=context.provider,kind=context.kind,network=ratingsNetwork(context.network??'stellar:pubnet').network,body=Buffer.isBuffer(context.rawBody)?context.rawBody:Buffer.from(context.rawBody??'');
 const status=context.response?.status??context.status??null,complete=context.response?.bodyComplete!==false,observedAt=iso(context.observedAt??new Date().toISOString(),'Observation time');
 const base={provider,kind,sourceId:text(context.sourceId,'Source ID',256),captureId:context.captureId??null,sourceScope:context.sourceScope??context.sourceId,observedAt,network},result=[];
 const make=(original,projection,locator)=>{
  const id=sha256({sourceId:base.sourceId,locator,projectionEntity:projection.entity});
  result.push({...base,id,recordRef:locator,original:clone(original),projection:{...projection,sourceBodySha256:sha256(body)},...(context.runtimeDescriptor?{runtime:clone(context.runtimeDescriptor)}:{})});
 };
 if(!complete||status!==null&&(status<200||status>=300)){
  make(null,{entity:'source-error',status,bodyComplete:complete,request:clone(context.request??null)},'');return result;
 }
 if(provider==='document'){make(null,{entity:'document',bytes:body.length},'');return result;}
 let parsed;
 if(context.format==='csv'){need(['source','activity'].includes(provider),'INVALID_SOURCE_FORMAT','Native provider data remains original JSON.');parsed=parseRatingsCSV(body);}
 else if(provider==='stellar-expert'&&kind==='supply'){
  let amount;try{amount=new TextDecoder('utf-8',{fatal:true}).decode(body).trim();}catch{throw new RatingsError('INVALID_SOURCE','The original supply is not UTF-8.');}
  const asset=parsedAsset(network,context.request?.filters?.asset??context.request?.selection?.asset??context.request?.asset);
  need(asset,'INVALID_ASSET','Original supply source must retain its selected canonical asset.');const units=decimalUnits(amount,7);
  make(amount,{entity:'supply',...asset,amount,amountUnits:units.toString(),scope:'stellar-expert-issued-supply',asOf:observedAt},'');return result;
 }else parsed=parseRatingsJSON(body);
 const recordsPath=context.recordsPath===null?'':context.recordsPath??(provider==='stellar'?'/result':provider==='horizon'&&!['account','root','ledger','transaction'].includes(kind)?'/_embedded/records':provider==='stellar-expert'&&['assets','holders','directory','blocked-domains'].includes(kind)?'/_embedded/records':'');
 let records;
 if(provider==='stellar'){
  const value=await decodeRatingsStellarSource({kind,body,request:context.request??{},runtime:context.runtime,network,contracts:context.contracts});
  for(let i=0;i<value.records.length;i++){const row=value.records[i];make(row.original,row.projection,'/native/'+i);if(value.runtime)result[result.length-1].runtime=clone(value.runtime);}
  return result;
 }
 const selected=atPointer(parsed.value,recordsPath);records=Array.isArray(selected)?selected:[selected];
 for(let i=0;i<records.length;i++){
  const row=records[i],locator=recordsPath+(Array.isArray(selected)?'/'+i:'');
  if(provider==='bluechip'){
   if(kind==='coins'){object(row,'Original rated coin');make(row,{entity:'rated-coin',name:text(row.name,'Original coin name',256),symbol:text(row.symbol,'Original coin symbol',128),url:url(row.url,'Original coin URL'),asOf:observedAt},locator);}
   else{object(row,'Original grade');make(row,{entity:'rating',name:text(row.name,'Original coin name',256),symbol:text(row.symbol,'Original coin symbol',128),grade:text(row.grade,'Original Bluechip grade',32),url:url(row.url,'Original grade URL'),asOf:observedAt,attribution:{...ATTRIBUTION,gradeUrl:row.url}},locator);}
  }else if(provider==='horizon'){
   if(kind==='account'){
    object(row,'Original Horizon account');make(row,{entity:'account',account:row.account_id??row.id,sequence:row.sequence,ledger:row.last_modified_ledger??null,asOf:observedAt,exists:true},locator);
    list(row.balances,'Original Horizon balances');
    for(let n=0;n<row.balances.length;n++){const holding=row.balances[n],asset=assetFields(network,holding);need(asset,'UNKNOWN_CLASSIC_ASSET','Original Horizon balance has an unknown asset type.');const units=decimalUnits(holding.balance,7);need(units>=0n,'INVALID_HOLDING','A native balance must not be negative.');
     make(holding,{entity:'holding',account:row.account_id??row.id,...asset,amount:holding.balance,amountUnits:units.toString(),ledger:row.last_modified_ledger??null,asOf:observedAt,view:'classic',nativeAccountSourceId:base.sourceId,liabilities:{buying:holding.buying_liabilities??null,selling:holding.selling_liabilities??null}},locator+'/balances/'+n);}
   }else if(['operations','operations-window','account-operations','ledger-operations','payments','account-payments','ledger-payments'].includes(kind)){
    const projection=operationProjection(row,network,context.request);let usedRuntime=null;
    if(row.type==='clawback_claimable_balance'){
     try{const native=await decodeRatingsClaimableBalanceRemoval({row,network,runtime:context.runtime});usedRuntime=native.runtime;projection.flows.push({...native.asset,amount:native.amount,amountUnits:native.amountUnits,from:row.balance_id,to:null,kind:'clawback_claimable_balance',leg:'burn'});projection.metadata={sha256:native.metadataSha256,operationIndex:native.operationIndex,balanceId:native.balanceId};}
     catch(error){projection.flowErrors.push({code:error.code??'ORIGINAL_META_DECODE_FAILED',message:error.message});}
    }
    make(row,projection,locator);if(usedRuntime)result[result.length-1].runtime=usedRuntime;
   }
   else if(['effects','operation-effects','account-effects'].includes(kind))make(row,effectProjection(row,network,context.request),locator);
   else make(row,{entity:kind==='root'?'network':kind==='ledger'||kind==='ledgers'?'ledger':kind==='assets'?'asset-info':'native-record',asOf:observedAt,...(kind==='root'?{passphrase:row.network_passphrase,latestLedger:row.history_latest_ledger,oldestLedger:row.history_elder_ledger}:{})},locator);
  }else if(provider==='stellar-expert'){
   if(kind==='holders'){
    const asset=parsedAsset(network,context.request?.filters?.asset??context.request?.selection?.asset);need(asset,'INVALID_ASSET','Holder capture must retain its original selected asset.');
    make(row,{entity:'holder',...asset,account:row.account,amountUnits:integerText(row.balance,'Original holder stroops'),amount:formatUnits(row.balance,7),asOf:observedAt,scope:'stellar-expert-nonzero-indexed-holders',pagingToken:row.paging_token},locator);
   }else if(kind==='assets'){
    const asset=parsedAsset(network,row.asset);make(row,{entity:'asset-info',...(asset??{}),providerAssetId:row.asset,supplyUnits:row.supply===undefined?null:decimalUnits(exactText(row.supply,'Original supply'),0).toString(),fundedTrustlines:row.trustlines?.funded??null,trustlines:clone(row.trustlines??null),payments:row.payments??null,paymentsAmountUnits:row.payments_amount===undefined?null:decimalUnits(exactText(row.payments_amount,'Original payment volume'),0).toString(),trades:row.trades??null,tradedAmountUnits:row.traded_amount===undefined?null:decimalUnits(exactText(row.traded_amount,'Original traded volume'),0).toString(),domain:row.domain??null,technicalRating:clone(row.rating??null),asOf:observedAt,scope:'stellar-expert-indexed-asset'},locator);
   }else if(kind==='directory'||kind==='directory-entry')make(row,{entity:'directory',account:stellarAddress(row.address,'Original directory address',{kind:'account'}),label:row.name??null,domain:row.domain??null,tags:clone(row.tags??[]),url:'https://stellar.expert/explorer/'+(network==='stellar:pubnet'?'public':'testnet')+'/account/'+row.address,attribution:{label:'Stellar Expert directory',url:'https://stellar.expert/directory'},asOf:observedAt},locator);
   else make(row,{entity:kind.startsWith('ledger-')?'ledger':kind==='asset-rating'?'technical-rating':'native-record',asOf:observedAt,sequence:row.sequence??null,date:row.date??null},locator);
  }else if(['source','activity'].includes(provider))make(row,mappingProjection(row,context.mapping??context.request?.projection,kind,network),locator);
  else throw new RatingsError('UNKNOWN_PROVIDER','Select a native or original imported source provider.');
 }
 return result;
}

function selectedRows(input,registry,decisions,issues){
 const rows=list(input??[],'Original source rows').map(row=>clone(row)),byId=new Map(rows.map(row=>[row.id,row])),superseded=new Set((decisions??[]).map(x=>x.supersedes).filter(Boolean));
 const active=(decisions??[]).filter(x=>!superseded.has(x.id)),seen=new Set();
 for(const decision of active){
  object(decision,'Attributable correction');need(['exclude','include','map'].includes(decision.action),'INVALID_DECISION','Select include, exclude or original attribution mapping.');
  need(decision.actor&&decision.reason,'INVALID_DECISION','A correction needs its actor and reason.');
  if(decision.registryId!==undefined&&registry.identity)need(decision.registryId===registry.identity.id,'DECISION_SCOPE_MISMATCH','Correction belongs to another registry.');
  const row=byId.get(decision.recordId);need(row&&(!decision.sourceId||decision.sourceId===row.sourceId),'DECISION_SOURCE_MISMATCH','Correction must select an exact retained original row.');
  need(!seen.has(row.id),'CONFLICTING_DECISIONS','Two active corrections select the same original row; use supersedes.');seen.add(row.id);
  row.decision=clone(decision);
  if(decision.action==='exclude')row.excluded=true;
  else if(decision.action==='include')row.excluded=false;
  else{
   const mapping=object(decision.mapping,'Attribution mapping');const allowed=new Set(['assetId','account','pricingKey','bluechipSymbol']);
   for(const key of Object.keys(mapping))need(allowed.has(key),'INVALID_DECISION','Corrections cannot rewrite original quantities, prices, grades or statuses.');
   const p=row.projection;
   if(mapping.assetId){const asset=registry.definition.assets.find(x=>x.id===mapping.assetId);need(asset,'INVALID_DECISION','Select a current registry asset.');p.registryAssetId=asset.id;p.assetKey=asset.assetKey;}
   if(mapping.account)p.account=stellarAddress(mapping.account,'Attributed account');
   if(mapping.pricingKey)p.pricingKey=text(mapping.pricingKey,'Pricing key',512);
   if(mapping.bluechipSymbol)p.symbol=text(mapping.bluechipSymbol,'Bluechip symbol',128);
   p.attributionCorrection=decision.id;
  }
 }
 return rows.filter(row=>{
  if(row.network!==registry.definition.network){issues.push({code:'OTHER_NETWORK',recordId:row.id,sourceId:row.sourceId});return false;}
  if(row.excluded||row.projection?.selected===false||row.projection?.successful===false)return false;
  return true;
 });
}
function inTime(row,asOf){const at=effective(row);return !at||Date.parse(at)<=Date.parse(asOf);}
function valueIdentity(row){const p={...row.projection};for(const name of ['asOf','effectiveAt','sourceBodySha256','attributionCorrection','nativeAccountSourceId'])delete p[name];return canonical(p);}
function newest(rows,asOf,issues,label){
 const available=rows.filter(row=>inTime(row,asOf));
 if(!available.length)return null;
 available.sort((a,b)=>Date.parse(effective(b)??b.observedAt)-Date.parse(effective(a)??a.observedAt)||a.id.localeCompare(b.id));
 const first=available[0],time=effective(first),same=available.filter(row=>effective(row)===time);
 if(new Set(same.map(valueIdentity)).size>1){issues.push({code:'SOURCE_VALUE_CONFLICT',selection:label,sourceRefs:uniqueRefs(same)});return null;}
 return first;
}
function age(row,asOf,maximum){const at=effective(row);return {asOf:at,seconds:at?Math.max(0,(Date.parse(asOf)-Date.parse(at))/1000):null,stale:!at||Date.parse(asOf)-Date.parse(at)>maximum*1000};}
function priceFor(holding,asset,rows,policy,asOf,issues){
 const pool=rows.filter(row=>row.projection?.entity==='price'&&(!policy.priceSourceScopes.length||policy.priceSourceScopes.includes(row.sourceScope)));
 const candidates=pool.filter(row=>{const p=row.projection;return p.assetKey===holding.assetKey||(asset&&(p.assetId===asset.id||p.registryAssetId===asset.id||(asset.pricingKey&&p.pricingKey===asset.pricingKey)));});
 const selected=newest(candidates,asOf,issues,'price:'+holding.assetKey);if(!selected)return null;
 const p=selected.projection,aged=age(selected,asOf,policy.priceMaxAgeSeconds);let rate=dec(p.price),fx=null;
 if(p.quoteCurrency!=='USD'){
  const observed=newest(rows.filter(row=>row.projection.entity==='fx'&&row.projection.baseCurrency===p.quoteCurrency&&row.projection.quoteCurrency==='USD'),asOf,issues,'FX:'+p.quoteCurrency);
  if(!observed)return {unavailable:'FX_RATE_MISSING',source:ref(selected),quoteCurrency:p.quoteCurrency};
  const fxAge=age(observed,asOf,policy.priceMaxAgeSeconds);fx={rate:observed.projection.rate,...fxAge,source:ref(observed)};rate=mul(rate,dec(observed.projection.rate));aged.stale=aged.stale||fxAge.stale;
 }
 return {rate,value:wireRat(rate,policy),source:ref(selected),originalPrice:p.price,originalQuoteCurrency:p.quoteCurrency,fx,...aged};
}
function ratingFor(asset,rows,policy,asOf,issues,entity){
 if(!asset)return null;
 const scopes=entity==='score'?policy.scoreSourceScopes:policy.ratingSourceScopes;
 const candidates=rows.filter(row=>{
  const p=row.projection;if(p.entity!==entity||scopes.length&&!scopes.includes(row.sourceScope))return false;
  return p.assetKey===asset.assetKey||p.assetId===asset.id||p.registryAssetId===asset.id||asset.bluechipSymbol&&p.symbol===asset.bluechipSymbol||asset.bluechipSlug&&p.slug===asset.bluechipSlug;
 });
 return newest(candidates,asOf,issues,entity+':'+asset.id);
}
function preparedAddresses(value,registry){
 const source=Array.isArray(value)?value:value?.inputs??[],accounts=new Map(),inputs=[];
 for(const item of source){
  const row=typeof item==='string'?{input:item,type:item[0],account:item}:clone(item);
  need(row.type!=='M'||row.muxedId!==undefined&&/^G/.test(row.account),'ADDRESS_PREPARATION_REQUIRED','Muxed inputs must be decoded with the original installed Stellar SDK.');
  stellarAddress(row.account,'Canonical wallet account');need(!/^C/.test(row.account)||row.enabled===true||registry.contractAccounts.includes(row.account),'CONTRACT_ACCOUNT_NOT_CONFIGURED','Contract balances need an explicit original registry/input selection.');
  row.input=row.input??row.address??row.account;row.type=row.type??row.account[0];inputs.push(row);
  if(!accounts.has(row.account))accounts.set(row.account,{account:row.account,type:row.account[0],inputs:[]});accounts.get(row.account).inputs.push({input:row.input,type:row.type,muxedId:row.muxedId??null});
 }
 return {inputs,accounts:[...accounts.values()]};
}
export function reviewStellarWallet(input){
 const registry=wrapper(input.registry,'Registry'),policy=wrapper(input.policy,'Wallet policy');registry.definition=normalizeRatingsRegistry(registry.definition);policy.definition=normalizeWalletPolicy(policy.definition);
 const asOf=iso(input.asOf??new Date().toISOString(),'Wallet source time'),issues=[],rows=selectedRows(input.records,registry,input.decisions,issues),addresses=preparedAddresses(input.addresses,registry.definition),assets=new Map(registry.definition.assets.map(x=>[x.assetKey,x]));
 const sourceAccounts=new Map(),accountViews=[],unresolvedHoldings=[];
 for(const account of addresses.accounts){
  const observations=rows.filter(row=>row.projection.entity==='account'&&row.projection.account===account.account);
  const original=newest(observations,asOf,issues,'account:'+account.account);
  const candidates=rows.filter(row=>['holding','holding-observation'].includes(row.projection.entity)&&row.projection.account===account.account&&inTime(row,asOf)&&(row.projection.view!=='classic'||!original||row.sourceId===original.sourceId));
  const groups=new Map();for(const row of candidates){const key=row.projection.assetKey;if(!key)continue;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
  const selected=[];
  for(const [key,values] of groups){
   const classic=values.filter(row=>row.projection.view==='classic');
   const eligible=account.type==='G'&&classic.length?classic:values.filter(row=>row.projection.view!=='sac'||row.projection.verifiedAsset===true);
   const value=newest(eligible,asOf,issues,'holding:'+account.account+':'+key);if(!value)continue;
   if(value.projection.entity==='holding-observation'){unresolvedHoldings.push({account:account.account,assetKey:key,status:value.projection.status??'SOURCE_REQUIRED',entryPresent:value.projection.entryPresent,sourceRefs:[ref(value)]});continue;}
   selected.push(value);
   for(const alternative of values)if(alternative.id!==value.id&&alternative.projection.amountUnits!==value.projection.amountUnits&&effective(alternative)===effective(value))issues.push({code:'BALANCE_VIEWS_DIFFER',account:account.account,assetKey:key,sourceRefs:uniqueRefs([value,alternative])});
  }
  sourceAccounts.set(account.account,selected);
  const requiredAssets=account.type==='C'?registry.definition.assets.filter(asset=>asset.enabled):[];
  const missingAssets=requiredAssets.filter(asset=>!selected.some(row=>row.projection.assetKey===asset.assetKey));
  for(const asset of missingAssets)if(!unresolvedHoldings.some(row=>row.account===account.account&&row.assetKey===asset.assetKey))unresolvedHoldings.push({account:account.account,assetKey:asset.assetKey,status:'SOURCE_REQUIRED',sourceRefs:[]});
  const failedReads=(input.coverage??[]).filter(row=>row.account===account.account&&['account','contract-balance'].includes(row.kind)&&row.status!=='COMPLETE');
  const nativeSuccess=(Boolean(original?.projection.exists)||account.type==='C'&&requiredAssets.length>0&&missingAssets.length===0&&selected.every(row=>row.projection.verifiedAsset===true||row.projection.view==='contract'))&&failedReads.length===0;
  const labelRows=rows.filter(row=>row.projection.entity==='directory'&&row.projection.account===account.account&&inTime(row,asOf)),labelGroups=new Map();
  for(const row of labelRows){if(!labelGroups.has(row.sourceScope))labelGroups.set(row.sourceScope,[]);labelGroups.get(row.sourceScope).push(row);}
  const labels=[];for(const [scope,values] of labelGroups){const row=newest(values,asOf,issues,'directory:'+scope+':'+account.account);if(row)labels.push({name:row.projection.label??row.projection.name??null,domain:row.projection.domain??null,tags:clone(row.projection.tags??[]),url:row.projection.url??null,provider:row.provider,asOf:effective(row),sourceRefs:[ref(row)],attribution:clone(row.projection.attribution??null)});}
  accountViews.push({...account,status:nativeSuccess?'COMPLETE':selected.length?'PARTIAL':'SOURCE_REQUIRED',labels,sourceRefs:uniqueRefs([...(original?[original]:[]),...selected,...labelRows]),holdingCount:selected.length,balanceScope:account.type==='G'?{kind:'complete-original-classic-balance-set'}:{kind:'explicitly-selected-contract-assets',assetIds:requiredAssets.map(asset=>asset.id),assetKeys:requiredAssets.map(asset=>asset.assetKey)},unresolvedAssetKeys:missingAssets.map(asset=>asset.assetKey),sourceConditions:failedReads.map(row=>({captureId:row.captureId??null,status:row.status,kind:row.kind,assetId:row.assetId??null}))});
 }
 const holdings=[];let totalKnown=ZERO,ratedValue=ZERO,excludedValue=ZERO,scoreWeight=ZERO,scoreWeighted=ZERO,unpriced=0,positiveHoldings=0;
 for(const [account,values] of sourceAccounts){
  for(const row of values){
   const p=row.projection,asset=assets.get(p.assetKey)??null,units=BigInt(p.amountUnits),quantity=rat(units,10n**BigInt(p.decimals));if(units>0n)positiveHoldings++;
   const exclusions=[],price=priceFor(p,asset,rows,policy.definition,asOf,issues),rating=ratingFor(asset,rows,policy.definition,asOf,issues,'rating'),score=ratingFor(asset,rows,policy.definition,asOf,issues,'score');
   let value=null;
   if(units===0n)value=ZERO;
   else if(!price||price.unavailable){unpriced++;exclusions.push(price?.unavailable??'PRICE_MISSING');}
   else if(price.stale&&!policy.definition.allowStalePrices){unpriced++;exclusions.push('PRICE_STALE');}
   else value=mul(quantity,price.rate);
   if(!asset)exclusions.push('UNTRACKED_ASSET');else if(!asset.enabled)exclusions.push('ASSET_DISABLED');
   const ratingAge=rating?age(rating,asOf,policy.definition.ratingMaxAgeSeconds):null;
   if(!rating)exclusions.push('RATING_MISSING');else if(ratingAge.stale&&!policy.definition.allowStaleRatings)exclusions.push('RATING_STALE');
   const eligible=Boolean(asset?.enabled&&rating&&(!ratingAge.stale||policy.definition.allowStaleRatings)&&value!==null);
   if(value!==null){totalKnown=add(totalKnown,value);if(eligible)ratedValue=add(ratedValue,value);else excludedValue=add(excludedValue,value);}
   let numeric=null;const scoreAge=score?age(score,asOf,policy.definition.scoreMaxAgeSeconds):null;
   if(score){
    const s=dec(score.projection.score,'Original numerical score');
    if(cmp(s,dec(policy.definition.scoreRange.min))<0||cmp(s,dec(policy.definition.scoreRange.max))>0)issues.push({code:'SCORE_OUTSIDE_POLICY_RANGE',assetId:asset?.id,sourceRefs:[ref(score)]});
    else if(scoreAge.stale&&!policy.definition.allowStaleScores)issues.push({code:'SCORE_STALE',assetId:asset?.id,sourceRefs:[ref(score)]});
    else numeric=s;
   }
   if(eligible&&numeric!==null){scoreWeight=add(scoreWeight,value);scoreWeighted=add(scoreWeighted,mul(value,numeric));}
   holdings.push({id:sha256({account,assetKey:p.assetKey}),account,assetKey:p.assetKey,registryAssetId:asset?.id??null,slug:asset?.slug??null,assetCode:p.assetCode??asset?.assetCode??null,assetIssuer:p.assetIssuer??asset?.assetIssuer??null,contractId:p.contractId??asset?.contractId??asset?.sacContractId??null,view:p.view??'original',amountUnits:units.toString(),decimals:p.decimals,amount:formatUnits(units,p.decimals),
    valueUSD:value===null?null:wireRat(value,policy.definition),price:price?((({rate,...metadata})=>metadata)(price)):null,rating:rating?{grade:rating.projection.grade,name:rating.projection.name??null,symbol:rating.projection.symbol??null,methodologyVersion:rating.projection.methodologyVersion??null,effectiveAt:rating.projection.effectiveAt??effective(rating),source:ref(rating),...ratingAge,attribution:{...ATTRIBUTION,gradeUrl:rating.projection.url??asset?.ratingUrl??null}}:null,
    score:score?{value:score.projection.score,methodologyVersion:score.projection.methodologyVersion??null,source:ref(score),...scoreAge,accepted:numeric!==null}:null,eligible,exclusionReasons:exclusions,sourceRefs:uniqueRefs([row,...(rating?[rating]:[]),...(score?[score]:[])]),correction:row.decision??null});
  }
 }
 const denominatorComplete=unpriced===0&&accountViews.every(x=>x.status==='COMPLETE'),hasValue=totalKnown.n>0n,percent=hasValue?mul(div(ratedValue,totalKnown),dec('100')):null,minimum=dec(policy.definition.minimumCoveragePercent);
 const below=percent===null||cmp(percent,minimum)<0;
 const scoreComplete=cmp(scoreWeight,ratedValue)===0&&ratedValue.n>0n,weightedScore=scoreWeight.n>0n?div(scoreWeighted,scoreWeight):null;
 let aggregateStatus=!denominatorComplete?'partial':!positiveHoldings?'empty':ratedValue.n===0n?'unrated':below?'low_coverage':!scoreComplete?'numeric_scores_required':policy.definition.gradeBands.length===0?'score_policy_required':'rated';
 let grade=null;if(aggregateStatus==='rated'&&weightedScore){const band=policy.definition.gradeBands.find(row=>cmp(weightedScore,dec(row.minScore))>=0);if(band)grade=band.grade;else aggregateStatus='outside_grade_policy';}
 const coverage={balanceScope:{classic:'all original account balances',contracts:'explicitly selected registry asset balances'},percent:percent?wireRat(percent,policy.definition):null,minimumPercent:policy.definition.minimumCoveragePercent,denominatorComplete,status:!denominatorComplete?'incomplete_denominator':below?'low_coverage':'sufficient',numericScorePercent:ratedValue.n>0n?wireRat(mul(div(scoreWeight,ratedValue),dec('100')),policy.definition):null};
 return {schema:SCHEMA+'.wallet.v1',kind:'wallet',registry:registry.identity,policy:policy.identity,network:registry.definition.network,asOf,status:aggregateStatus,addresses:addresses.inputs,accounts:accountViews,successfulAccounts:accountViews.filter(x=>x.status==='COMPLETE').map(x=>x.account),holdings,unresolvedHoldings,
  summary:{totalKnownValueUSD:wireRat(totalKnown,policy.definition),ratedValueUSD:wireRat(ratedValue,policy.definition),excludedValueUSD:wireRat(excludedValue,policy.definition),unpricedHoldings:unpriced,unresolvedHoldings:unresolvedHoldings.length,holdingCount:holdings.length,accountCount:accountViews.length},
  coverage,aggregate:{score:weightedScore?wireRat(weightedScore,policy.definition):null,grade,status:aggregateStatus,numericCoverageComplete:scoreComplete,attribution:{...ATTRIBUTION,methodologySourceIds:policy.definition.methodologySourceIds}},
  issues,sourceIds:[...new Set(rows.map(x=>x.sourceId))],decisions:clone(input.decisions??[]),attribution:clone(ATTRIBUTION)};
}

function coverageRows(value){return (value??[]).map(row=>({...row,status:row.status??row.captureStatus??(row.complete?'COMPLETE':'PARTIAL')}));}
function sourceCovered(row,coverage){return coverage.some(item=>item.status==='COMPLETE'&&(item.captureId&&item.captureId===row.captureId||(item.sourceIds??[]).includes(row.sourceId)));}
function metricStatus(complete,hasValue){return !hasValue?'unavailable':complete?'complete':'partial';}
function periodSelection(value){object(value,'Daily UTC period');const from=iso(value.from,'Period start'),to=iso(value.to,'Period end');need(value.timeZone===undefined||value.timeZone==='UTC','INVALID_PERIOD','Daily activity is selected in UTC.');need(Date.parse(to)>Date.parse(from)&&Date.parse(to)-Date.parse(from)<=86400000,'INVALID_PERIOD','Select one forward daily interval of at most24 hours.');return {from,to,timeZone:'UTC'};}
function inPeriod(row,period){const at=row.projection.occurredAt;if(!at)return false;return Date.parse(at)>=Date.parse(period.from)&&Date.parse(at)<Date.parse(period.to);}
function distinctOperations(rows,issues){
 const groups=new Map();
 for(const row of rows){const p=row.projection;if(!['operation','token-event'].includes(p.entity))continue;const key=p.entity==='operation'?'op:'+p.operationId:'event:'+p.eventId;
  if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
 const result=[];
 for(const [key,values] of groups){
  const originalIdentical=new Set(values.map(row=>canonical(row.original))).size===1;
  if(originalIdentical)values.sort((a,b)=>(a.projection.flowErrors?.length??0)-(b.projection.flowErrors?.length??0)||Number(Boolean(a.projection.unsupported))-Number(Boolean(b.projection.unsupported))||String(effective(b)).localeCompare(String(effective(a))));
  const resolved=originalIdentical?values.filter(row=>(row.projection.flowErrors?.length??0)===(values[0].projection.flowErrors?.length??0)&&Boolean(row.projection.unsupported)===Boolean(values[0].projection.unsupported)):values;
  const identities=new Set(resolved.map(row=>canonical({flows:row.projection.flows,successful:row.projection.successful,selected:row.projection.selected,transactionHash:row.projection.transactionHash})));
  if(identities.size>1){issues.push({code:'NATIVE_OPERATION_CONFLICT',identity:key,sourceRefs:uniqueRefs(values)});continue;}
  resolved.sort((a,b)=>String(effective(b)).localeCompare(String(effective(a))));result.push({...resolved[0],duplicateSourceRefs:uniqueRefs(values)});
 }
 return result;
}
function holderSnapshot(rows,asset,coverage,asOf){
 const groups=new Map();
 for(const row of rows.filter(x=>x.projection.entity==='holder'&&x.projection.assetKey===asset.assetKey&&inTime(x,asOf))){
  const id=row.sourceScope+':'+(row.captureId??row.sourceId);if(!groups.has(id))groups.set(id,[]);groups.get(id).push(row);
 }
 const choices=[...groups.values()].map(group=>({rows:group,asOf:group.reduce((a,r)=>effective(r)>a?effective(r):a,''),complete:group.some(r=>sourceCovered(r,coverage))}));
 choices.sort((a,b)=>Number(b.complete)-Number(a.complete)||String(b.asOf).localeCompare(String(a.asOf)));
 if(!choices.length&&coverage.some(row=>row.kind==='holders'&&row.assetId===asset.id&&row.status==='COMPLETE'))return {rows:[],complete:true,asOf};
 return choices[0]??null;
}
function previousMetric(previous,assetId,name){return previous?.metrics?.filter(row=>row.assetId===assetId&&row.name===name&&row.value!==null).sort((a,b)=>String(b.asOf).localeCompare(String(a.asOf)))[0]??null;}

function distinctEffects(rows,issues){
 const groups=new Map();
 for(const row of rows){const key=row.projection.effectId;if(!key)continue;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
 const result=[];
 for(const [id,items] of groups){
  if(new Set(items.map(row=>canonical({operationId:row.projection.operationId,flows:row.projection.flows,effectType:row.projection.effectType}))).size>1){issues.push({code:'NATIVE_EFFECT_CONFLICT',effectId:id,sourceRefs:uniqueRefs(items)});continue;}
  items.sort((a,b)=>String(effective(b)).localeCompare(String(effective(a))));result.push({...items[0],duplicateSourceRefs:uniqueRefs(items)});
 }
 return result;
}
function originalEffectFlows(effects,operations){
 const byOperation=new Map(operations.map(row=>[row.projection.operationId,row])),direct=[],mirrors=new Map();
 for(const row of effects){
  const parent=byOperation.get(row.projection.operationId),p=parent?.projection??{},projection=row.projection;
  for(const flow of projection.flows??[]){
   if(flow.leg==='pool'&&p.flows?.some(item=>item.leg==='pool'&&item.assetKey===flow.assetKey))continue;
   const item={row,flow,parent};
   if(projection.effectType!=='trade'){direct.push(item);continue;}
   // Horizon retains both account perspectives. Pair only identical directional
   // asset/quantity movements, preserving repeated equal trades as a multiset.
   const key=canonical({operationId:projection.operationId,assetKey:flow.assetKey,amountUnits:flow.amountUnits,from:flow.from,to:flow.to});
   if(!mirrors.has(key))mirrors.set(key,new Map());const group=mirrors.get(key),side=projection.account??row.id;
   if(!group.has(side))group.set(side,[]);group.get(side).push(item);
  }
 }
 for(const sides of mirrors.values()){
  const groups=[...sides.values()].sort((a,b)=>b.length-a.length||String(a[0].row.projection.account).localeCompare(String(b[0].row.projection.account)));
  const refs=uniqueRefs(groups.flat().map(item=>item.row));
  for(const item of groups[0])direct.push({...item,row:{...item.row,duplicateSourceRefs:refs}});
 }
 return direct;
}
export function buildStellarActivity(input){
 const registry=wrapper(input.registry,'Registry'),policy=wrapper(input.policy,'Wallet policy');registry.definition=normalizeRatingsRegistry(registry.definition);policy.definition=normalizeWalletPolicy(policy.definition);
 const period=periodSelection(input.period),asOf=iso(input.asOf??new Date().toISOString(),'Activity observation time'),utcDate=period.from.slice(0,10),issues=[],coverage=coverageRows(input.coverage);
 const rows=selectedRows(input.records,registry,input.decisions,issues),metrics=[],holders=[],assets=[];
 const operationRows=distinctOperations(rows.filter(row=>inPeriod(row,period)&&row.projection.selected!==false&&row.projection.successful!==false),issues);
 const classic=operationRows.filter(row=>row.projection.entity==='operation'),token=operationRows.filter(row=>row.projection.entity==='token-event');
 const declaredOperationCoverage=coverage.filter(row=>['operations-window','operations','payments','account-operations','ledger-operations'].includes(row.kind));
 const operationObserved=classic.length>0||token.length>0||declaredOperationCoverage.some(row=>row.status==='COMPLETE');
 const operationComplete=declaredOperationCoverage.some(row=>row.status==='COMPLETE'&&row.scope==='network'&&(!row.from||Date.parse(row.from)<=Date.parse(period.from))&&(!row.to||Date.parse(row.to)>=Date.parse(period.to)));
 const relevantEffects=distinctEffects(rows.filter(row=>row.projection.entity==='effect'&&inPeriod(row,period)),issues),effectFlows=originalEffectFlows(relevantEffects,classic);
 const knownOperations=new Map(classic.map(row=>[row.projection.operationId,row]));
 function append(asset,name,value,unit,sourceRows,scope,status='complete',observed=asOf,extra={}){
  const sourceRefs=uniqueRefs(sourceRows),source=[...new Set(sourceRefs.map(x=>x.provider))].join('+')||null;
  let record={assetId:asset?.id??'__all_tracked_assets__',assetKey:asset?.assetKey??null,utcDate,name,value:value===null?null:typeof value==='string'?value:value.toString(),unit,source,asOf:observed,status,scope,sourceRefs,...extra};
  if(record.value===null){const prior=previousMetric(input.previousEdition,record.assetId,name);if(prior)record={...record,value:prior.value,unit:prior.unit,source:prior.source,asOf:prior.asOf,status:'stale',sourceRefs:clone(prior.sourceRefs),previousPeriod:input.previousEdition.period,currentObservation:{status,asOf}};}
  metrics.push(record);return record;
 }
 for(const asset of registry.definition.assets.filter(row=>row.enabled)){
  const assetIssues=[],info=newest(rows.filter(row=>row.projection.entity==='asset-info'&&row.projection.assetKey===asset.assetKey),asOf,assetIssues,'asset-info:'+asset.id);
  const originalSupply=newest(rows.filter(row=>row.projection.entity==='supply'&&row.projection.assetKey===asset.assetKey),asOf,assetIssues,'supply:'+asset.id);
  const supplyUnits=originalSupply?.projection.amountUnits??info?.projection.supplyUnits??null;
  const observedPrecisions=[...new Set(rows.flatMap(row=>row.projection.assetKey===asset.assetKey&&row.projection.decimals!==undefined&&row.projection.decimals!==null?[safeInteger(row.projection.decimals,'Original precision',{maximum:255})]:[]).concat(operationRows.flatMap(row=>(row.projection.flows??[]).filter(flow=>flow.assetKey===asset.assetKey).map(flow=>flow.decimals))))];
  const decimals=asset.decimals??originalSupply?.projection.decimals??(observedPrecisions.length===1?observedPrecisions[0]:asset.assetType==='contract'?null:7),precisionConflict=observedPrecisions.some(value=>value!==decimals);
  if(decimals===null)assetIssues.push({code:'TOKEN_DECIMALS_REQUIRED',assetId:asset.id});
  if(precisionConflict)assetIssues.push({code:'TOKEN_PRECISION_CONFLICT',assetId:asset.id,selected:decimals,observed:observedPrecisions});
  const formatQuantity=value=>decimals===null||precisionConflict?null:formatUnits(value,decimals);
  const supply=supplyUnits===null||decimals===null||precisionConflict?null:rat(BigInt(supplyUnits),10n**BigInt(decimals)),supplyRows=originalSupply?[originalSupply]:info?[info]:[];
  const supplyAsOf=originalSupply?effective(originalSupply):info?effective(info):asOf;
  const supplyCovered=supplyRows.some(row=>sourceCovered(row,coverage));
  append(asset,'supply',supply?decimal(supply,decimals):null,'asset',supplyRows,clone(asset.supplyScope),metricStatus(supplyCovered,supply!==null),supplyAsOf,{amountUnits:supplyUnits,decimals});
  const snapshot=holderSnapshot(rows,asset,coverage,asOf),holderRows=snapshot?.rows??[],holderByAccount=new Map();
  for(const row of holderRows){
   const p=row.projection,old=holderByAccount.get(p.account);
   if(old&&old.projection.amountUnits!==p.amountUnits){assetIssues.push({code:'HOLDER_SNAPSHOT_CONFLICT',account:p.account,sourceRefs:uniqueRefs([old,row])});continue;}
   if(!old)holderByAccount.set(p.account,row);
  }
  const ranked=[...holderByAccount.values()].sort((a,b)=>{const aa=BigInt(a.projection.amountUnits),bb=BigInt(b.projection.amountUnits);return aa>bb?-1:aa<bb?1:a.projection.account.localeCompare(b.projection.account);});
  const topN=typeof asset.holderScope==='object'?asset.holderScope.topN??10:10,top=ranked.slice(0,topN),topUnits=top.reduce((n,row)=>n+BigInt(row.projection.amountUnits),0n),allUnits=ranked.reduce((n,row)=>n+BigInt(row.projection.amountUnits),0n);
  for(let index=0;index<top.length;index++){const row=top[index];holders.push({assetId:asset.id,assetKey:asset.assetKey,rank:index+1,account:row.projection.account,amountUnits:row.projection.amountUnits,amount:row.projection.amount,decimals:row.projection.decimals,asOf:effective(row),status:snapshot.complete?'complete':'partial',sourceRefs:[ref(row)]});}
  const count=snapshot?.complete?String(ranked.length):info?.projection.fundedTrustlines===null||info?.projection.fundedTrustlines===undefined?null:String(info.projection.fundedTrustlines);
  const countRows=snapshot?.complete?holderRows:info?[info]:[],countScope=snapshot?.complete?asset.holderScope:{kind:'funded-trustlines',provider:'stellar-expert',contractHoldersIncluded:false};
  append(asset,'holder_count',count,'accounts',countRows,clone(countScope),metricStatus(snapshot?.complete||Boolean(info&&sourceCovered(info,coverage)),count!==null),snapshot?.complete?snapshot.asOf:info?effective(info):asOf);
  const holderDenominator=typeof asset.holderScope==='object'&&asset.holderScope.denominator==='holder-balances'?snapshot?.complete?allUnits:null:supplyUnits===null?null:BigInt(supplyUnits);
  const concentration=holderDenominator&&holderDenominator>0n?mul(rat(topUnits,holderDenominator),dec('100')):null;
  append(asset,'top_n_concentration',concentration?decimal(concentration,policy.definition.rounding.scale):null,'percent',[...top,...supplyRows],{...typeof asset.holderScope==='object'?asset.holderScope:{kind:asset.holderScope},topN,selectedHolders:top.length,denominatorUnits:holderDenominator?.toString()??null},metricStatus(Boolean(snapshot?.complete&&supplyCovered),concentration!==null),snapshot?.asOf??asOf);
  let issuance=0n,burn=0n,volume=0n,distribution=0n,poolDeposit=0n,poolWithdrawal=0n;const transactions=new Set(),flowRows=[];
  const issuers=new Set([...asset.issuerAccounts,...asset.supplyChangingDistributionAccounts]),distributors=new Set(asset.distributionAccounts);
  const selectedEffects=effectFlows.filter(item=>item.flow.assetKey===asset.assetKey);
  const tradedSupplyOps=new Set(selectedEffects.filter(item=>item.flow.kind==='trade'&&(issuers.has(item.flow.from)||issuers.has(item.flow.to))).map(item=>item.row.projection.operationId));
  const candidates=[...classic,...token].flatMap(row=>(row.projection.flows??[]).filter(flow=>flow.assetKey===asset.assetKey).map(flow=>({row,flow,parent:knownOperations.get(row.projection.operationId)})));
  candidates.push(...selectedEffects);
  for(const item of candidates){
   const {row,flow,parent}=item,p=row.projection,original=parent?.projection;
   if(p.entity==='token-event'&&original?.flows?.some(value=>value.assetKey===asset.assetKey)){
    assetIssues.push({code:'DUPLICATE_PROTOCOL_VIEW',recordId:row.id,operationId:p.operationId,selectedSource:'horizon'});continue;
   }
   const amount=BigInt(flow.amountUnits);flowRows.push(row);if(p.transactionHash)transactions.add(p.transactionHash);
   const fromIssuer=flow.from&&issuers.has(flow.from),toIssuer=flow.to&&issuers.has(flow.to),pathEndpoint=p.entity==='operation'&&['path_payment_strict_receive','path_payment_strict_send'].includes(p.operationType);
   if(!(pathEndpoint&&tradedSupplyOps.has(p.operationId))){
    if(flow.kind==='mint'||fromIssuer&&!toIssuer)issuance+=amount;
    if(['burn','clawback','clawback_claimable_balance'].includes(flow.kind)||flow.leg==='burn'||toIssuer&&!fromIssuer)burn+=amount;
   }
   if(distributors.has(flow.from)||distributors.has(flow.to))distribution+=amount;
   const tradeEndpoint=flow.kind==='trade'&&original&&['path_payment_strict_receive','path_payment_strict_send'].includes(original.operationType)&&original.flows.some(value=>value.assetKey===asset.assetKey);
   if(!tradeEndpoint&&!['set_admin','set_authorized','approve','trust'].includes(flow.kind))volume+=amount;
   if(['liquidity_pool_deposit','liquidity_pool_deposited'].includes(flow.kind))poolDeposit+=amount;
   if(['liquidity_pool_withdraw','liquidity_pool_withdrew'].includes(flow.kind))poolWithdrawal+=amount;
  }
  const contractCoverage=coverage.filter(row=>row.kind==='events'&&(row.assetId===asset.id||(row.assetIds??[]).includes(asset.id))&&(!row.from||Date.parse(row.from)<=Date.parse(period.from))&&(!row.to||Date.parse(row.to)>=Date.parse(period.to))),tokenComplete=contractCoverage.some(row=>row.status==='COMPLETE');
  const nativeErrors=classic.flatMap(row=>(row.projection.flowErrors??[]).filter(error=>!(error.code==='NATIVE_ASSET_CHANGES_MISSING'&&tokenComplete)).map(error=>({...error,operationId:row.projection.operationId,sourceRefs:[ref(row)]})));
  const missingEffects=classic.filter(row=>row.projection.requiresEffects&&!relevantEffects.some(effect=>effect.projection.operationId===row.projection.operationId)&&!sourceCovered(row,coverage));
  if(missingEffects.length)nativeErrors.push({code:'ORIGINAL_EFFECTS_REQUIRED',sourceRefs:uniqueRefs(missingEffects)});
  const unsupportedEvents=token.filter(row=>row.projection.assetKey===asset.assetKey&&row.projection.unsupported&&row.projection.unsupported!=='UNRECOGNIZED_EVENT');
  assetIssues.push(...nativeErrors,...unsupportedEvents.map(row=>({code:row.projection.unsupported,sourceRefs:[ref(row)]})));
  const metricComplete=decimals!==null&&!precisionConflict&&(asset.assetType==='contract'?tokenComplete&&unsupportedEvents.length===0:operationComplete&&nativeErrors.length===0);
  const hasActivitySource=asset.assetType==='contract'?tokenComplete||token.some(row=>row.projection.assetKey===asset.assetKey):operationObserved;
  const flowScope={kind:'retained-successful-asset-movements',from:period.from,to:period.to,issuers:[...issuers],distributionAccounts:[...distributors],volume:'payment endpoint quantities plus intermediate trade and pool reserve movements; mirrored effects and Horizon/RPC views counted once',sourceAssetPathLeg:'both original endpoints, same-asset equal transfer counted once',nativeContractEventsIncluded:token.some(row=>row.projection.assetKey===asset.assetKey),coverage:metricComplete?'complete':'partial'};
  append(asset,'issuance_24h',hasActivitySource?formatQuantity(issuance):null,'asset',flowRows,{...flowScope,classifier:'issuer-outgoing-or-original-mint'},metricComplete?'complete':'partial');
  append(asset,'burn_24h',hasActivitySource?formatQuantity(burn):null,'asset',flowRows,{...flowScope,classifier:'issuer-incoming-or-original-burn-clawback'},metricComplete?'complete':'partial');
  append(asset,'transaction_count_24h',hasActivitySource?String(transactions.size):null,'transactions',flowRows,{...flowScope,identity:'unique-original-transaction-hash'},metricComplete?'complete':'partial');
  append(asset,'transaction_volume_24h',hasActivitySource?formatQuantity(volume):null,'asset',flowRows,flowScope,metricComplete?'complete':'partial');
  append(asset,'distribution_transfers_24h',hasActivitySource?formatQuantity(distribution):null,'asset',flowRows,{...flowScope,changesSupplyOnlyWhenExplicitlySelected:true},metricComplete?'complete':'partial');
  append(asset,'pool_deposits_24h',hasActivitySource?formatQuantity(poolDeposit):null,'asset',flowRows,{kind:'original-pool-reserve-movements'},metricComplete?'complete':'partial');
  append(asset,'pool_withdrawals_24h',hasActivitySource?formatQuantity(poolWithdrawal):null,'asset',flowRows,{kind:'original-pool-reserve-movements'},metricComplete?'complete':'partial');
  const price=priceFor({assetKey:asset.assetKey},asset,rows,policy.definition,asOf,assetIssues);
  append(asset,'price',price&&!price.unavailable?price.value.value:null,'USD',price&&!price.unavailable?rows.filter(x=>x.id===price.source.recordId):[],{kind:'original-selected-price',pricingKey:asset.pricingKey},price?.stale?'stale':price&&!price.unavailable?'complete':'unavailable',price?.asOf??asOf,price&&!price.unavailable?{exact:price.value}:{}); 
  let pegUSD=null,pegRows=[];
  if(asset.peg?.currency==='USD')pegUSD=dec(asset.peg.amount);
  else if(asset.peg){const fx=newest(rows.filter(x=>x.projection.entity==='fx'&&x.projection.baseCurrency===asset.peg.currency&&x.projection.quoteCurrency==='USD'),asOf,assetIssues,'peg-FX:'+asset.id);if(fx){pegUSD=mul(dec(asset.peg.amount),dec(fx.projection.rate));pegRows=[fx];}}
  append(asset,'peg_target',pegUSD?decimal(pegUSD,policy.definition.rounding.scale):null,'USD',pegRows,{kind:'registry-original-peg',original:asset.peg},pegUSD?'complete':'unavailable');
  const deviation=pegUSD&&price&&!price.unavailable?mul(div(add(price.rate,rat(-pegUSD.n,pegUSD.d)),pegUSD),dec('100')):null;
  append(asset,'peg_deviation',deviation?decimal(deviation,policy.definition.rounding.scale):null,'percent',pegRows,{kind:'signed-price-minus-target-over-target',originalPeg:asset.peg},deviation?(price.stale?'stale':'complete'):'unavailable',price?.asOf??asOf);
  const currentCounters=info?{payments:info.projection.payments,paymentsAmountUnits:info.projection.paymentsAmountUnits,asOf:effective(info),sourceScope:info.sourceScope,sourceRefs:[ref(info)]}:null;
  const previousCounters=input.previousEdition?.assets?.find(x=>x.id===asset.id)?.counters;
  if(currentCounters&&previousCounters&&currentCounters.sourceScope===previousCounters.sourceScope){
   for(const [field,name,unit] of [['payments','indexed_payment_count_delta','operations'],['paymentsAmountUnits','indexed_payment_volume_delta','asset']]){
    if(currentCounters[field]===null||currentCounters[field]===undefined||previousCounters[field]===null||previousCounters[field]===undefined)continue;
    const delta=BigInt(currentCounters[field])-BigInt(previousCounters[field]);if(delta<0n){assetIssues.push({code:'INDEXED_COUNTER_REGRESSION',assetId:asset.id,field});continue;}
    append(asset,name,unit==='asset'?formatQuantity(delta):delta.toString(),unit,[info],{kind:'original-cumulative-counter-difference',from:previousCounters.asOf,to:currentCounters.asOf,metricIsTransactionCount:false},'complete',currentCounters.asOf);
   }
  }
  const rating=ratingFor(asset,rows,policy.definition,asOf,assetIssues,'rating');
  assets.push({id:asset.id,slug:asset.slug,assetKey:asset.assetKey,assetCode:asset.assetCode,assetIssuer:asset.assetIssuer,decimals,rating:rating?{grade:rating.projection.grade,asOf:effective(rating),attribution:{...ATTRIBUTION,gradeUrl:rating.projection.url??asset.ratingUrl},source:ref(rating)}:null,counters:currentCounters,issues:assetIssues});issues.push(...assetIssues);
 }
 const aggregates=[];
 for(const name of ['supply','issuance_24h','burn_24h','transaction_volume_24h']){
  let sum=ZERO,complete=true;const refs=[];let count=0;
  for(const asset of assets){const metric=metrics.find(x=>x.assetId===asset.id&&x.name===name),price=metrics.find(x=>x.assetId===asset.id&&x.name==='price');if(!metric||metric.value===null||!price||price.value===null){complete=false;continue;}sum=add(sum,mul(dec(metric.value),price.exact?rat(BigInt(price.exact.numerator),BigInt(price.exact.denominator)):dec(price.value)));refs.push(...metric.sourceRefs,...price.sourceRefs);count++;if(metric.status!=='complete'||price.status!=='complete')complete=false;}
  const row={assetId:'__all_tracked_assets__',assetKey:null,utcDate,name:name+'_usd',value:count?decimal(sum,policy.definition.rounding.scale):null,unit:'USD',source:[...new Set(refs.map(x=>x.provider))].join('+'),asOf,status:complete?'complete':count?'partial':'unavailable',scope:{kind:'sum-of-original-priced-token-metrics',includedAssets:count,totalAssets:assets.length},sourceRefs:[...new Map(refs.map(x=>[x.recordId,x])).values()],exact:wireRat(sum,policy.definition)};
  aggregates.push(row);metrics.push(row);
 }
 for(const name of ['holder_count','transaction_count_24h']){
  const selected=metrics.filter(x=>x.assetId!=='__all_tracked_assets__'&&x.name===name),known=selected.filter(x=>x.value!==null),sum=known.reduce((n,row)=>n+BigInt(row.value),0n);
  const row={assetId:'__all_tracked_assets__',assetKey:null,utcDate,name,value:known.length?sum.toString():null,unit:name==='holder_count'?'account-asset-memberships':'asset-transactions',source:[...new Set(known.map(x=>x.source))].join('+'),asOf,status:known.length===assets.length&&known.every(x=>x.status==='complete')?'complete':known.length?'partial':'unavailable',scope:{kind:'sum-per-asset',crossAssetDoubleCounting:true},sourceRefs:[...new Map(known.flatMap(x=>x.sourceRefs).map(x=>[x.recordId,x])).values()]};aggregates.push(row);metrics.push(row);
 }
 return {schema:SCHEMA+'.activity.v1',kind:'activity',registry:registry.identity,policy:policy.identity,network:registry.definition.network,period,asOf,status:metrics.every(x=>x.status==='complete')?'complete':metrics.some(x=>x.value!==null)?'partial':'unavailable',assets,metrics,holders,aggregates,coverage,issues,sourceIds:[...new Set(rows.map(x=>x.sourceId))],decisions:clone(input.decisions??[]),attribution:clone(ATTRIBUTION)};
}
export function compareRatingsEditions(left,right){
 object(left,'Original edition');object(right,'Following edition');need(left.kind===right.kind&&left.network===right.network,'INCOMPATIBLE_EDITIONS','Compare editions of the same native kind and network.');
 const key=row=>left.kind==='wallet'?row.account+'|'+row.assetKey:row.assetId+'|'+row.utcDate+'|'+row.name;
 const a=new Map((left.kind==='wallet'?left.holdings:left.metrics).map(row=>[key(row),row])),b=new Map((right.kind==='wallet'?right.holdings:right.metrics).map(row=>[key(row),row])),changes=[];
 for(const id of [...new Set([...a.keys(),...b.keys()])].sort()){
  const before=a.get(id)??null,after=b.get(id)??null;if(canonical(before)===canonical(after))continue;
  const fields=[];for(const field of new Set([...Object.keys(before??{}),...Object.keys(after??{})]))if(canonical(before?.[field]??null)!==canonical(after?.[field]??null))fields.push(field);
  changes.push({key:id,change:before===null?'added':after===null?'removed':'changed',fields,before,after});
 }
 return {schema:SCHEMA+'.comparison.v1',kind:left.kind,network:left.network,left:{registry:left.registry,policy:left.policy,asOf:left.asOf,period:left.period??null},right:{registry:right.registry,policy:right.policy,asOf:right.asOf,period:right.period??null},changes,summary:{added:changes.filter(x=>x.change==='added').length,removed:changes.filter(x=>x.change==='removed').length,changed:changes.filter(x=>x.change==='changed').length}};
}
const escape=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const csv=value=>{const s=value===undefined||value===null?'':typeof value==='object'?JSON.stringify(value):String(value);return /[",\r\n]/.test(s)?'"'+s.replaceAll('"','""')+'"':s;};
export function buildRatingsReport({edition,format='json',assetId=null,account=null}){
 object(edition,'Original result edition');need(['wallet','activity'].includes(edition.kind),'INVALID_EDITION','Select a wallet or activity edition.');need(['json','csv','html'].includes(format),'INVALID_REPORT_FORMAT','Select JSON, CSV or HTML.');
 const selected=clone(edition);
 if(edition.kind==='wallet'){
  selected.holdings=selected.holdings.filter(row=>(!assetId||row.registryAssetId===assetId)&&(!account||row.account===account));selected.unresolvedHoldings=(selected.unresolvedHoldings??[]).filter(row=>(!assetId||edition.holdings.some(holding=>holding.registryAssetId===assetId&&holding.assetKey===row.assetKey))&&(!account||row.account===account));selected.accounts=selected.accounts.filter(row=>!account||row.account===account);selected.addresses=selected.addresses.filter(row=>!account||row.account===account);selected.successfulAccounts=selected.successfulAccounts.filter(row=>!account||row===account);
  if(assetId||account){selected.originalSummary=selected.summary;selected.summary={selection:'scoped-original-holdings',holdingCount:selected.holdings.length};selected.coverage={selection:'whole-wallet-coverage-retained',original:selected.coverage};selected.aggregate={selection:'whole-wallet-grade-retained',original:selected.aggregate};}
 }else{
  selected.assets=selected.assets.filter(row=>!assetId||row.id===assetId);selected.metrics=selected.metrics.filter(row=>!assetId||row.assetId===assetId);selected.holders=selected.holders.filter(row=>(!assetId||row.assetId===assetId)&&(!account||row.account===account));selected.aggregates=selected.aggregates.filter(row=>!assetId);
 }
 const scope={kind:edition.kind,assetId,account,network:edition.network,period:edition.period??null,registry:edition.registry,policy:edition.policy,asOf:edition.asOf,sourceIds:edition.sourceIds,attribution:clone(ATTRIBUTION)};
 if(format==='json')return {filename:'ratings-result.json',contentType:'application/json; charset=utf-8',body:JSON.stringify({...selected,reportScope:scope},null,2)+'\n',scope};
 if(format==='csv'){
  const fields=edition.kind==='activity'?['asset_id','utc_date','metric_name','value','source','as_of_ts']:['account','asset_key','asset_id','amount_units','decimals','amount','value_usd','grade','score','eligible','exclusion_reasons','rating_url','attribution','source_refs'];
  const rows=edition.kind==='activity'?selected.metrics.map(row=>[row.assetId,row.utcDate,row.name,row.value,row.source,row.asOf]):selected.holdings.map(row=>[row.account,row.assetKey,row.registryAssetId,row.amountUnits,row.decimals,row.amount,row.valueUSD?.value,row.rating?.grade,row.score?.value,row.eligible,row.exclusionReasons,row.rating?.attribution?.gradeUrl,'by Bluechip',row.sourceRefs]);
  return {filename:edition.kind==='activity'?'daily-activity.csv':'wallet-holdings.csv',contentType:'text/csv; charset=utf-8',body:fields.join(',')+'\r\n'+rows.map(row=>row.map(csv).join(',')).join('\r\n')+(rows.length?'\r\n':''),scope};
 }
 const title=edition.kind==='wallet'?'Stellar wallet rating':'Stellar daily activity';
 const rows=edition.kind==='wallet'?selected.holdings.map(row=>[row.account,row.assetCode??row.assetKey,row.amount,row.valueUSD?.value??'Unpriced',row.rating?.grade??'Unrated',row.eligible?'Eligible':row.exclusionReasons.join(', '),row.rating?.attribution?.gradeUrl]):selected.metrics.map(row=>[row.assetId,row.utcDate,row.name,row.value??'Unavailable',row.unit,row.status,row.asOf]);
 const headings=edition.kind==='wallet'?['Account','Asset','Quantity','Value USD','Bluechip grade','Coverage','Original rating']:['Asset','UTC date','Metric','Value','Unit','Status','Source time'];
 const table='<table><thead><tr>'+headings.map(x=>'<th>'+escape(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map((x,i)=>'<td>'+(edition.kind==='wallet'&&i===4&&row[6]?'<a href="'+escape(url(row[6],'Original rating URL'))+'">'+escape(x)+'</a>':edition.kind==='wallet'&&i===6&&x?'<a href="'+escape(url(x,'Original rating URL'))+'">Original rating</a>':escape(x))+'</td>').join('')+'</tr>').join('')+'</tbody></table>';
 const body='<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>'+title+'</title><style>body{font:14px system-ui,sans-serif;color:#202020;background:#fff;margin:32px;line-height:1.5}h1{font-size:24px}table{border-collapse:collapse;width:100%;margin:20px 0}td,th{border:1px solid #ccc;padding:8px;text-align:left;vertical-align:top}th{background:#eee}pre{white-space:pre-wrap;overflow-wrap:anywhere}a{color:inherit;text-decoration:underline}</style><h1>'+title+'</h1><p>Source time '+escape(edition.asOf)+' · '+escape(edition.network)+' · '+escape(edition.status)+'</p><p>Grades <a href="https://bluechip.org/">by Bluechip</a>. Each asset grade links to its original agency rating.</p>'+table+'<h2>Original selection and source attribution</h2><pre>'+escape(JSON.stringify(scope,null,2))+'</pre><h2>Source conditions</h2><pre>'+escape(JSON.stringify(edition.issues??[],null,2))+'</pre></html>\n';
 return {filename:'ratings-result.html',contentType:'text/html; charset=utf-8',body,scope};
}

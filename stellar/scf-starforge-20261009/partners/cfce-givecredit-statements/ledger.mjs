// MIT. Source-native CFCE payments, Soroban events and observed contract state.
import { createHash } from 'node:crypto';
import { need, copy, plain, parseNativeJSON, units, validateSourceEdition } from './source.mjs';

export const CFCE_LEDGER_DEFAULTS = Object.freeze({
  network:'mainnet',
  networkPassphrase:'Public Global Stellar Network ; September 2015',
  rpcUrl:'https://mainnet.sorobanrpc.com',
  horizonUrl:'https://horizon.stellar.org',
  archiveRpcUrl:'https://archive-rpc.lightsail.network/',
  contractId:'CAIRWEYKTLVRQBXQGYNLDUAKWIUV4NO6WPTCMVHH2BOMUUUBTXRJF43R',
  account:'GD2IBAC2WK3XOD64APP4OKQTX4URQFAH5WRHODEOJF7EN2MLDOV45VKI',
});
const HASH = /^[a-fA-F0-9]{64}$/;
const TABLES = ['transactions','transfers','donationEvents','contractObservations'];
const now = () => new Date().toISOString();
const sha = value => createHash('sha256').update(value).digest('hex');
const get = (value,key) => typeof value?.[key] === 'function' ? value[key]() : value?.[key];
const valueOf = value => get(value,'value');
const xdrIn = (type,value) => (type.fromXDR || type.fromXdr).call(type,value,'base64');
const xdrOut = value => (value.toXDR || value.toXdr).call(value,'base64');
function variant(value) {
  const sw = get(value,'switch');
  return typeof sw === 'number' ? 'v' + sw : sw?.name || value?.type || '';
}
function exact(value) {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') {
    need(Number.isSafeInteger(value),'LEDGER_INTEGER_PRECISION','The decoded ledger integer must retain full precision.');
    return String(value);
  }
  if (value instanceof Uint8Array) return Buffer.from(value).toString('hex');
  if (Array.isArray(value)) return value.map(exact);
  if (value instanceof Map) return Object.fromEntries([...value].map(([k,v])=>[String(exact(k)),exact(v)]));
  if (plain(value)) return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,exact(v)]));
  return value;
}
const native = (sdk,value) => exact(sdk.scValToNative(value));
function atom(value,label='ledger amount') {
  const result = typeof value === 'bigint' ? value.toString() : String(value);
  need(/^-?(?:0|[1-9]\d*)$/.test(result) && BigInt(result) >= -(1n<<127n) && BigInt(result) < (1n<<127n),
    'LEDGER_AMOUNT', 'Keep the exact original ' + label + '.');
  return result;
}
function timestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  const s = String(value);
  if (/^\d+$/.test(s)) {
    const millis = BigInt(s)*1000n;
    need(millis <= 8640000000000000n,'LEDGER_TIME','Invalid ledger close timestamp.');
    return new Date(Number(millis)).toISOString();
  }
  need(Number.isFinite(Date.parse(s)),'LEDGER_TIME','Keep the original ledger close timestamp.');
  return new Date(s).toISOString();
}
function endpoint(value,label) {
  const url = new URL(value);
  need((url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname))) &&
    !url.username && !url.password && !url.hash, 'LEDGER_ENDPOINT', 'Use the configured ' + label + ' HTTPS or local endpoint.');
  return url.href.replace(/\/+$/,'');
}
const integer = (value,label) => {
  const n = Number(value);
  need(Number.isSafeInteger(n) && n >= 0,'LEDGER_SEQUENCE','Use the original ' + label + '.');
  return n;
};
function blankObservation(ctx,contractId,ledger,createdAt,key,refs,phase) {
  return {key,network:ctx.network,ledger:String(ledger),createdAt,contractId,
    provider:null,vendor:null,providerFees:null,vendorFees:null,tokenContractId:null,
    bucketAtoms:null,minimumAtoms:null,accountedRemainderAtoms:null,tokenBalanceAtoms:null,
    phase,rawRefs:refs,sourceStatus:{}};
}
const STATE_FIELDS = {
  Provider:'provider',Vendor:'vendor',ProviderFees:'providerFees',VendorFees:'vendorFees',
  XLM:'tokenContractId',Bucket:'bucketAtoms',Minimum:'minimumAtoms',Balance:'accountedRemainderAtoms',
};
function storageName(sdk,key) {
  try {
    const v = native(sdk,key);
    return Array.isArray(v) && v.length === 1 ? String(v[0]) : (typeof v === 'string' ? v : null);
  } catch { return null; }
}
function applyContractData(ctx,observation,data,ref) {
  if (!data || !/contractData/i.test(variant(data))) return false;
  const entry = get(data,'contractData') || valueOf(data);
  const address = ctx.sdk.Address.fromScAddress(get(entry,'contract')).toString();
  if (address !== observation.contractId) return false;
  const key = get(entry,'key'), val = get(entry,'val');
  if (/LedgerKeyContractInstance|ledgerKeyContractInstance/.test(variant(key))) {
    const instance = get(val,'instance') || valueOf(val);
    for (const item of get(instance,'storage') || []) {
      const name = storageName(ctx.sdk,get(item,'key')), field = STATE_FIELDS[name];
      if (field) {
        observation[field] = native(ctx.sdk,get(item,'val'));
        observation.sourceStatus[field] = {status:'observed',rawRef:ref};
      }
    }
  } else {
    const field = STATE_FIELDS[storageName(ctx.sdk,key)];
    if (field) {
      observation[field] = native(ctx.sdk,val);
      observation.sourceStatus[field] = {status:'observed',rawRef:ref};
    }
  }
  return true;
}
function add(ctx,table,row) {
  const key = table === 'transactions' ? row.hash : row.key;
  if (table === 'transactions') for (const alias of row.hashAliases || [row.hash]) {
    const prior=ctx.index.transactions.get(ctx.aliases?.get(alias));
    if(alias===row.hash||!prior||row.successful===true&&prior.successful!==true)ctx.aliases?.set(alias,row.hash);
  }
  const index = ctx.index[table], prior = index.get(key);
  if (prior) {
    const refs = [...new Set([...(prior.rawRefs||[]),...(row.rawRefs||[])])];
    Object.assign(prior,row,{rawRefs:refs});
  } else { ctx.source.tables[table].push(row); index.set(key,row); }
}
function issue(ctx,code,message,details={}) {
  const key = sha(JSON.stringify({code,message,details}));
  if (!ctx.source.metadata.issues.some(row=>row.key===key))
    ctx.source.metadata.issues.push({key,code,message,...details});
}
function clearTransactionDerived(ctx,hash) {
  if(ctx.source.metadata.contractChanges)ctx.source.metadata.contractChanges=ctx.source.metadata.contractChanges.filter(row=>row.hash!==hash);
  for (const name of ['transfers','donationEvents','contractObservations']) {
    ctx.source.tables[name] = ctx.source.tables[name].filter(row=>row.hash !== hash);
    ctx.index[name] = new Map(ctx.source.tables[name].map(row=>[row.key,row]));
  }
}
function nativeAsset(ctx) {
  return {key:'native',code:'XLM',issuer:null,contractId:ctx.nativeContract,decimals:7};
}
function classicAsset(ctx,row,prefix='') {
  if (row[prefix+'asset_type'] === 'native') return nativeAsset(ctx);
  const code = row[prefix+'asset_code'], issuer = row[prefix+'asset_issuer'];
  need(typeof code === 'string' && typeof issuer === 'string','LEDGER_ASSET','Keep the original classic asset code and issuer.');
  return {key:code+':'+issuer,code,issuer,contractId:new ctx.sdk.Asset(code,issuer).contractId(ctx.passphrase),decimals:7};
}
function addressFromBytes(ctx,bytes) { return bytes ? ctx.sdk.StrKey.encodeContract(bytes) : null; }
function normalizedEvent(ctx,event,tx,operationIndex,eventIndex,ref) {
  const body = get(get(event,'body'),'v0') || valueOf(get(event,'body'));
  const contractId = addressFromBytes(ctx,get(event,'contractID'));
  const topic = (get(body,'topics')||[]).map(value=>native(ctx.sdk,value));
  const amount = native(ctx.sdk,get(body,'data'));
  return {contractId,topic,amount,hash:tx.hash,ledger:tx.ledger,createdAt:tx.createdAt,
    operationIndex:String(operationIndex),eventIndex:String(eventIndex),rawRefs:[ref]};
}
async function tokenAsset(ctx,contractId,topic) {
  if (contractId === ctx.nativeContract) return nativeAsset(ctx);
  if (ctx.assets.has(contractId)) return ctx.assets.get(contractId);
  // SAC transfer topics may contain the exact code:issuer asset name.
  const name = typeof topic?.[3] === 'string' ? topic[3] : '';
  const split = name.lastIndexOf(':');
  if (split > 0) {
    try {
      const candidate = new ctx.sdk.Asset(name.slice(0,split),name.slice(split+1));
      if (candidate.contractId(ctx.passphrase) === contractId) {
        const result={key:name,code:name.slice(0,split),issuer:name.slice(split+1),contractId,decimals:7};
        ctx.assets.set(contractId,result); return result;
      }
    } catch { /* Full event retained; custom token metadata is read below. */ }
  }
  try {
    const d = await simulateView(ctx,contractId,'decimals');
    const decimals = integer(d.value,'token decimal precision');
    need(decimals <= 38,'LEDGER_TOKEN_PRECISION','The source token decimal precision exceeds the reporting range.');
    let symbol = null;
    try { symbol = String((await simulateView(ctx,contractId,'symbol')).value); } catch { /* Symbol is optional identity metadata. */ }
    const result={key:'contract:'+contractId,code:symbol,issuer:null,contractId,decimals,
      metadataLedger:d.ledger,metadataRawRefs:d.rawRefs};
    ctx.assets.set(contractId,result); return result;
  } catch (error) {
    issue(ctx,'TOKEN_METADATA_UNAVAILABLE','Retained token transfer awaits its original decimal metadata.',
      {contractId,error:error.message});
    return null;
  }
}
async function recordEvent(ctx,event,{eventId,ref,tx,operationIndex='0',eventIndex='0'}={}) {
  if (!event.contractId || !Array.isArray(event.topic) || !event.topic.length) return;
  const kind = event.topic[0], rawRefs = event.rawRefs || [ref];
  const key = ctx.network + ':' + event.hash + ':event:' + operationIndex + ':' + eventIndex;
  const fields={admin:'admin',bucket:'bucketAtoms',minimum:'minimumAtoms',provider:'provider',provfees:'providerFees',vendor:'vendor',vendfees:'vendorFees',xlm:'tokenContractId'};
  if(ctx.contracts.has(event.contractId)&&event.topic[1]==='change'&&fields[kind]&&Array.isArray(event.amount)&&event.amount.length===2){
    const rows=ctx.source.metadata.contractChanges||=([]);
    const row={key,hash:event.hash,network:ctx.network,ledger:String(event.ledger),createdAt:event.createdAt,
      contractId:event.contractId,field:fields[kind],oldValue:copy(event.amount[0]),newValue:copy(event.amount[1]),
      operationIndex,eventIndex,rawRefs};
    const prior=rows.find(value=>value.key===key);if(prior)Object.assign(prior,row);else rows.push(row);
  }
  if (kind === 'donation' && ctx.contracts.has(event.contractId)) {
    need(event.topic.length === 3 && typeof event.topic[1] === 'string' && typeof event.topic[2] === 'string',
      'CFCE_DONATION_EVENT','Keep the original CFCE donor and provider event topics.');
    const amountAtoms=atom(event.amount);
    need(BigInt(amountAtoms)>=0n,'CFCE_DONATION_AMOUNT','CFCE donation event amount must be nonnegative.');
    add(ctx,'donationEvents',{key,hash:event.hash,network:ctx.network,ledger:String(event.ledger),createdAt:event.createdAt,
      contractId:event.contractId,donor:event.topic[1],provider:event.topic[2],amountAtoms,
      eventId:eventId||null,operationIndex,eventIndex,rawRefs});
  } else if (kind === 'transfer' && event.topic.length >= 3) {
    const asset=await tokenAsset(ctx,event.contractId,event.topic);
    if (!asset) return;
    const amountAtoms=atom(event.amount);
    need(BigInt(amountAtoms)>=0n,'TOKEN_TRANSFER_AMOUNT','A transfer event amount must be nonnegative.');
    add(ctx,'transfers',{key,hash:event.hash,network:ctx.network,ledger:String(event.ledger),createdAt:event.createdAt,
      from:String(event.topic[1]),to:String(event.topic[2]),asset,amountAtoms,
      eventId:eventId||null,operationIndex,eventIndex,sourceKind:'contract-event',rawRefs});
  }
}
function metadataParts(ctx,encoded) {
  const meta=xdrIn(ctx.sdk.xdr.TransactionMeta,encoded), tag=variant(meta);
  need(['v0','v1','v2','v3','v4'].includes(tag),'LEDGER_METADATA_VERSION','The retained ledger metadata needs a matching native Stellar SDK.');
  const body=valueOf(meta);
  return {meta,body,tag,operations:tag==='v0'?body:(get(body,'operations')||[])};
}
function observeChanges(ctx,changes,tx,phase,ref) {
  const observations=new Map();
  for (const [index,change] of (changes||[]).entries()) {
    const tag=variant(change), entry=valueOf(change);
    if (!/created|updated|state/i.test(tag)) continue;
    const data=get(entry,'data');
    for (const contractId of ctx.contracts) {
      const stage=/state/i.test(tag)?'before':'after';
      const group=contractId+':'+stage;
      let observation=observations.get(group);
      if (!observation) {
        observation=blankObservation(ctx,contractId,tx.ledger,tx.createdAt,
          ctx.network+':'+tx.hash+':state:'+sha(phase+group).slice(0,16),[ref],phase+':'+stage);
        observation.hash=tx.hash; observations.set(group,observation);
      }
      applyContractData(ctx,observation,data,ref+'#changes/'+index);
    }
  }
  for (const row of observations.values()) if (Object.keys(row.sourceStatus).length) add(ctx,'contractObservations',row);
}
async function decodeTransaction(ctx,row,ref) {
  let hash=String(row.txHash||row.hash||row.requestedHash||'').toLowerCase();
  need(HASH.test(hash),'LEDGER_HASH','Use the exact original transaction hash.');
  const successful=row.status==='SUCCESS'||row.successful===true;
  const envelope=row.envelopeXdr||row.envelope_xdr||null;
  let metadata=row.resultMetaXdr||row.result_meta_xdr||null;
  const tx={hash,network:ctx.network,ledger:String(row.ledger),createdAt:timestamp(row.createdAt??row.created_at),
    successful,status:row.status||(successful?'SUCCESS':'FAILED'),rawRefs:[ref],
    envelopeXdr:envelope,resultXdr:row.resultXdr||row.result_xdr||null,resultMetaXdr:metadata,
    applicationOrder:row.applicationOrder===undefined?null:String(row.applicationOrder),
    feeBump:row.feeBump===true||!!row.fee_bump_transaction,hashAliases:[hash],
    metadataStatus:metadata?'retained':'unavailable',metadataRawRef:metadata?ref:null};
  if (envelope) {
    const parsed=ctx.sdk.TransactionBuilder.fromXDR(envelope,ctx.passphrase);
    const actual=Buffer.from(parsed.hash()).toString('hex');
    tx.hashAliases=[...new Set([hash,actual,...(parsed.innerTransaction?[Buffer.from(parsed.innerTransaction.hash()).toString('hex')]:[])])];
    tx.nativeOperationKinds=(parsed.innerTransaction||parsed).operations.map(operation=>operation.type);
    tx.requestedHash=row.requestedHash||hash;
    tx.hash=actual;
    need(tx.hashAliases.includes(hash) && (hash===actual || parsed.innerTransaction &&
      hash===Buffer.from(parsed.innerTransaction.hash()).toString('hex')),'LEDGER_HASH_MISMATCH',
      'The original envelope hash does not match the selected network and transaction.');
  }
  // Consolidate observations of the same envelope. Different failed fee-bump
  // envelopes may share an inner hash and remain separate native transactions.
  const aliases=new Set(tx.hashAliases);
  const priorRows=ctx.source.tables.transactions.filter(prior=>prior.hash===tx.hash||
    (envelope&&prior.envelopeXdr===envelope)||
    (!prior.envelopeXdr&&aliases.has(prior.hash)&&String(prior.ledger)===tx.ledger));
  for(const prior of priorRows)for(const alias of prior.hashAliases||[prior.hash])aliases.add(alias);
  tx.hashAliases=[...aliases];
  tx.rawRefs=[...new Set([...tx.rawRefs,...priorRows.flatMap(prior=>prior.rawRefs||[])])];
  if(tx.applicationOrder===null){const ordered=priorRows.find(prior=>prior.applicationOrder!==null&&prior.applicationOrder!==undefined);if(ordered)tx.applicationOrder=String(ordered.applicationOrder);}
  const retained=priorRows.find(prior=>prior.metadataStatus==='retained');
  if(retained&&!metadata){
    metadata=retained.resultMetaXdr;tx.resultMetaXdr=metadata;tx.metadataStatus='retained';
    tx.metadataRawRef=retained.metadataRawRef||retained.rawRefs?.[0]||ref;
    ref=tx.metadataRawRef;
  }
  hash=tx.hash;
  for(const prior of priorRows){clearTransactionDerived(ctx,prior.hash);ctx.index.transactions.delete(prior.hash);}
  ctx.source.tables.transactions=ctx.source.tables.transactions.filter(prior=>!priorRows.includes(prior));
  clearTransactionDerived(ctx,hash);
  add(ctx,'transactions',tx);
  if (!successful) return tx;
  const parts=metadata?metadataParts(ctx,metadata):null;
  let eventGroups=null;
  if (parts?.tag==='v4') {
    eventGroups=parts.operations.map(op=>get(op,'events')||[]);
  } else if (parts?.tag==='v3') {
    eventGroups=[get(get(parts.body,'sorobanMeta'),'events')||[]];
  } else if (Array.isArray(row.events?.contractEventsXdr)) {
    eventGroups=row.events.contractEventsXdr.map(list=>list.map(encoded=>xdrIn(ctx.sdk.xdr.ContractEvent,encoded)));
  }
  tx.contractChangesComplete=Array.isArray(eventGroups);
  if (eventGroups) {
    for (const [operationIndex,events] of eventGroups.entries()) for (const [eventIndex,event] of events.entries()) {
      const rawRef=ref+'#contractEvents/'+operationIndex+'/'+eventIndex;
      const normalized=normalizedEvent(ctx,event,tx,operationIndex,eventIndex,rawRef);
      await recordEvent(ctx,normalized,{tx,operationIndex:String(operationIndex),eventIndex:String(eventIndex),ref:rawRef});
    }
  }
  if (parts) {
    observeChanges(ctx,get(parts.body,'txChangesBefore')||get(parts.body,'txChanges'),tx,'transaction-before',ref);
    for (const [index,op] of parts.operations.entries()) observeChanges(ctx,get(op,'changes'),tx,'operation-'+index,ref);
    observeChanges(ctx,get(parts.body,'txChangesAfter'),tx,'transaction-after',ref);
  }
  return tx;
}

async function makeContext(options) {
  const sdk=options.sdk || await import('@stellar/stellar-sdk');
  const network=options.network||'mainnet';
  need(['mainnet','testnet'].includes(network),'LEDGER_NETWORK','Choose the actual mainnet or testnet source.');
  const passphrase=options.networkPassphrase || (network==='mainnet'?sdk.Networks.PUBLIC:sdk.Networks.TESTNET);
  const expected=network==='mainnet'?sdk.Networks.PUBLIC:sdk.Networks.TESTNET;
  need(passphrase===expected,'LEDGER_PASSPHRASE','Use the selected network original passphrase.');
  const rpcUrl=endpoint(options.rpcUrl||(network==='mainnet'?CFCE_LEDGER_DEFAULTS.rpcUrl:'https://soroban-testnet.stellar.org'),'RPC');
  const horizonUrl=endpoint(options.horizonUrl||(network==='mainnet'?CFCE_LEDGER_DEFAULTS.horizonUrl:'https://horizon-testnet.stellar.org'),'Horizon');
  const archiveRpcUrl=options.archiveRpcUrl===null?null:endpoint(options.archiveRpcUrl||(network==='mainnet'?CFCE_LEDGER_DEFAULTS.archiveRpcUrl:rpcUrl),'ledger archive');
  need(network==='mainnet'||options.contractId||options.contractIds,'TESTNET_CONTRACT_REQUIRED','Select the original CFCE testnet contract.');
  const contracts=[...new Set(options.contractIds||[options.contractId||CFCE_LEDGER_DEFAULTS.contractId])];
  for (const contractId of contracts) new sdk.Contract(contractId);
  const selection={network,networkPassphrase:passphrase,rpcUrl,horizonUrl,archiveRpcUrl,contracts,
    from:options.from||options.fromDate||null,before:options.before||options.beforeDate||null,
    startLedger:options.startLedger===undefined?null:String(options.startLedger),
    endLedger:options.endLedger===undefined?null:String(options.endLedger)};
  const source=options.checkpoint?copy(options.checkpoint):{
    schema:'stellar-forge.givecredit-source.v1',kind:'ledger',
    metadata:{origin:'cfce-stellar-ledger',network,networkPassphrase:passphrase,selection,
      startedAt:now(),updatedAt:now(),status:'capturing',coverage:{},issues:[],progress:{},assetMetadata:[],
      dateBasis:'Ledger close timestamps. Original database dates and carbon retirement dates remain separate.',
      sourceCommit:'3d20065447bd56c9c05a3e658ccd11e0b9cb985e'},
    files:{},responses:[],tables:Object.fromEntries(TABLES.map(name=>[name,[]])),
  };
  need(source.kind==='ledger' && source.schema==='stellar-forge.givecredit-source.v1' &&
    JSON.stringify(source.metadata.selection)===JSON.stringify(selection),
    'LEDGER_CHECKPOINT_SELECTION','Resume the original network, endpoints, contracts and source boundaries.');
  source.metadata.status='capturing'; delete source.metadata.interruption;
  const ctx={sdk,network,passphrase,rpcUrl,horizonUrl,archiveRpcUrl,contracts:new Set(contracts),source,options,
    nativeContract:sdk.Asset.native().contractId(passphrase),assets:new Map(),archiveCache:new Map(),
    index:Object.fromEntries(TABLES.map(name=>[name,new Map(source.tables[name].map(row=>[name==='transactions'?row.hash:row.key,row]))])),
    simulationAccount:null,simulationTried:false,horizonRows:new Map(),rawEvents:new Map(),
    aliases:new Map(),ledgerTimes:new Map(),
    accounts:new Set(options.accounts || (network==='mainnet'?[options.account||CFCE_LEDGER_DEFAULTS.account]:options.account?[options.account]:[])),
  };
  for (const row of source.tables.transactions) for (const alias of row.hashAliases||[row.hash]) {
    const prior=ctx.index.transactions.get(ctx.aliases.get(alias));
    if(alias===row.hash||!prior||row.successful===true&&prior.successful!==true)ctx.aliases.set(alias,row.hash);
  }
  for (const row of source.tables.contractObservations) if (row.provider && /^G[A-Z2-7]{55}$/.test(row.provider)) ctx.accounts.add(row.provider);
  const fetchImpl=options.fetchImpl||globalThis.fetch;
  need(typeof fetchImpl==='function','FETCH_UNAVAILABLE','Run ledger capture in the native Node receiver.');
  for (const asset of options.assets||[]) {
    need(asset.contractId&&asset.decimals!==null&&asset.decimals!==undefined&&Number.isInteger(Number(asset.decimals))&&Number(asset.decimals)>=0&&Number(asset.decimals)<=38,
      'LEDGER_ASSET_METADATA','Keep original token identity and decimal metadata.');
    ctx.assets.set(asset.contractId,copy(asset));
  }
  for (const asset of source.metadata.assetMetadata||[]) ctx.assets.set(asset.contractId,copy(asset));
  ctx.request=async(url,{method='GET',request=null,provider='horizon'}={})=>{
    if (options.signal?.aborted) throw Object.assign(new Error('Ledger capture was paused.'),{code:'CAPTURE_PAUSED'});
    const timeoutMs=Number(options.timeoutMs||45000);
    need(Number.isSafeInteger(timeoutMs)&&timeoutMs>0,'LEDGER_TIMEOUT','Use a positive native request timeout.');
    const signal=typeof AbortSignal?.timeout==='function'?AbortSignal.timeout(timeoutMs):options.signal;
    const combined=options.signal&&signal&&typeof AbortSignal.any==='function'?AbortSignal.any([options.signal,signal]):signal;
    const headers={Accept:'application/json',...(provider==='rpc'?options.rpcHeaders:provider==='archive'?options.archiveHeaders:options.horizonHeaders)};
    if(method==='POST')headers['Content-Type']='application/json';
    const response=await fetchImpl(url,{method,headers,body:request?JSON.stringify(request):undefined,redirect:'error',signal:combined});
    const content=await response.text(),retrievedAt=now();
    const ref='ledger/responses/'+String(source.responses.length+1).padStart(6,'0')+'.json';
    source.files[ref]=content;
    source.responses.push({url,method,...(request?{request:copy(request)}:{}),retrievedAt,status:String(response.status),content,file:ref,sha256:sha(content)});
    if(!response.ok)throw Object.assign(new Error(provider+' returned HTTP '+response.status+'.'),{
      code:'LEDGER_HTTP_'+response.status,status:response.status,retryAfter:response.headers?.get?.('retry-after')||null,rawRefs:[ref]});
    const body=parseNativeJSON(content);
    if(request){
      need(plain(body)&&body.jsonrpc==='2.0','LEDGER_RPC_RESPONSE','Keep the original JSON-RPC response.');
      if(body.error)throw Object.assign(new Error(body.error.message||'RPC request failed.'),{code:'LEDGER_RPC_ERROR',rpcCode:body.error.code,rawRefs:[ref]});
      need(plain(body.result),'LEDGER_RPC_RESPONSE','RPC omitted its original result.');
      return {data:body.result,ref,retrievedAt};
    }
    return {data:body,ref,retrievedAt};
  };
  ctx.rpc=(method,params={},archive=false)=>ctx.request(archive?archiveRpcUrl:rpcUrl,{method:'POST',
    request:{jsonrpc:'2.0',id:'capture-'+String(source.responses.length+1),method,params},provider:archive?'archive':'rpc'});
  ctx.progress=async(phase,details={})=>{
    source.metadata.updatedAt=now();source.metadata.assetMetadata=[...ctx.assets.values()].map(copy);
    if(options.onProgress)await options.onProgress({phase,...details,checkpoint:copy(source)});
  };
  return ctx;
}
async function simulationAccount(ctx) {
  if(ctx.simulationAccount)return ctx.simulationAccount;
  if(ctx.simulationTried)throw Object.assign(new Error('No retained source account is available for the read-only getter.'),{code:'GETTER_ACCOUNT'});
  ctx.simulationTried=true;
  const candidates=[...new Set([ctx.options.simulationSource,...ctx.accounts].filter(Boolean))];
  for(const address of candidates){
    if(!/^G[A-Z2-7]{55}$/.test(address))continue;
    try{
      const result=await ctx.request(ctx.horizonUrl+'/accounts/'+encodeURIComponent(address));
      need(result.data.account_id===address&&typeof result.data.sequence==='string','LEDGER_ACCOUNT_SOURCE','Retain the original account and sequence.');
      ctx.simulationAccount={address,sequence:result.data.sequence,ref:result.ref};return ctx.simulationAccount;
    }catch(error){if(error.status!==404)throw error;}
  }
  throw Object.assign(new Error('The source accounts did not resolve for a read-only contract getter.'),{code:'GETTER_ACCOUNT'});
}
async function simulateView(ctx,contractId,method) {
  const source=await simulationAccount(ctx);
  const transaction=new ctx.sdk.TransactionBuilder(new ctx.sdk.Account(source.address,source.sequence),{
    fee:'100',networkPassphrase:ctx.passphrase,
  }).addOperation(new ctx.sdk.Contract(contractId).call(method)).setTimeout(60).build();
  const result=await ctx.rpc('simulateTransaction',{transaction:transaction.toXDR()});
  need(!result.data.error&&!result.data.restorePreamble&&result.data.results?.[0]?.xdr,
    'LEDGER_GETTER_RESULT',result.data.error||'The original read-only getter did not return a live result.');
  return {value:native(ctx.sdk,xdrIn(ctx.sdk.xdr.ScVal,result.data.results[0].xdr)),
    ledger:String(result.data.latestLedger),rawRefs:[source.ref,result.ref]};
}
function persistentKey(ctx,contractId,name) {
  const durability=ctx.sdk.xdr.ContractDataDurability.persistent;
  return ctx.sdk.xdr.LedgerKey.contractData(new ctx.sdk.xdr.LedgerKeyContractData({
    contract:new ctx.sdk.Contract(contractId).address().toScAddress(),
    key:ctx.sdk.xdr.ScVal.scvVec([ctx.sdk.xdr.ScVal.scvSymbol(name)]),
    durability:typeof durability==='function'?durability():durability,
  }));
}
async function ledgerClose(ctx,ledger) {
  const key=String(ledger);
  if(ctx.ledgerTimes.has(key))return ctx.ledgerTimes.get(key);
  try{
    const result=await ctx.request(ctx.horizonUrl+'/ledgers/'+key);
    if(result.data.sequence!==undefined)need(String(result.data.sequence)===key,'LEDGER_CLOSE_ID','Keep the exact ledger header identity.');
    const close={createdAt:timestamp(result.data.closed_at),ref:result.ref};
    ctx.ledgerTimes.set(key,close);return close;
  }catch(error){if(error.status!==404)throw error;return {createdAt:null,ref:null};}
}

async function currentContractState(ctx) {
  for(const contractId of ctx.contracts){
    const keys=[new ctx.sdk.Contract(contractId).getFootprint(),persistentKey(ctx,contractId,'Balance'),persistentKey(ctx,contractId,'XLM')].map(xdrOut);
    const result=await ctx.rpc('getLedgerEntries',{keys,xdrFormat:'base64'});
    const ledger=String(result.data.latestLedger);
    const close=await ledgerClose(ctx,ledger),createdAt=close.createdAt,closeRef=close.ref;
    const observation=blankObservation(ctx,contractId,ledger,createdAt,
      ctx.network+':'+contractId+':observed:'+ledger,[result.ref,...(closeRef?[closeRef]:[])],'latest-ledger-entry');
    for(const [index,entry] of (result.data.entries||[]).entries()){
      const data=xdrIn(ctx.sdk.xdr.LedgerEntryData,entry.xdr);
      applyContractData(ctx,observation,data,result.ref+'#entries/'+index);
    }
    if(observation.provider&&/^G[A-Z2-7]{55}$/.test(observation.provider))ctx.accounts.add(observation.provider);
    add(ctx,'contractObservations',observation);
    // The contract getter distinguishes actual token balance from its provider remainder.
    try{
      const balance=await simulateView(ctx,contractId,'getContractBalance');
      const getterClose=await ledgerClose(ctx,balance.ledger);
      const getter=blankObservation(ctx,contractId,balance.ledger,getterClose.createdAt,
        ctx.network+':'+contractId+':token-balance:'+balance.ledger,[...balance.rawRefs,...(getterClose.ref?[getterClose.ref]:[])],'read-only-getter');
      getter.tokenBalanceAtoms=atom(balance.value);
      getter.sourceStatus.tokenBalanceAtoms={status:'observed-getter',method:'getContractBalance',ledger:balance.ledger};
      add(ctx,'contractObservations',getter);
    }catch(error){
      if(error.status===429||Number(error.status)>=500)throw error;
      issue(ctx,'CONTRACT_BALANCE_GETTER_UNAVAILABLE','The current contract token balance getter did not resolve.',
        {contractId,error:error.message,rawRefs:error.rawRefs||[]});
    }
  }
}
async function archiveTransaction(ctx,horizonRow,hash) {
  if(!ctx.archiveRpcUrl||horizonRow?.ledger===undefined)return null;
  const ledger=integer(horizonRow.ledger,'transaction ledger');
  let retained=ctx.archiveCache.get(String(ledger));
  if(!retained){
    const result=await ctx.rpc('getLedgers',{startLedger:ledger,pagination:{limit:1},xdrFormat:'base64'},true);
    const record=(result.data.ledgers||[]).find(row=>String(row.sequence)===String(ledger));
    need(record?.metadataXdr,'ARCHIVE_LEDGER_MISSING','The archive did not return the original selected ledger.');
    retained={record,ref:result.ref};ctx.archiveCache.set(String(ledger),retained);
  }
  const close=xdrIn(ctx.sdk.xdr.LedgerCloseMeta,retained.record.metadataXdr), body=valueOf(close);
  const processing=get(body,'txProcessing')||[];
  const aliases=new Set([hash,horizonRow.hash,horizonRow.inner_transaction?.hash,horizonRow.fee_bump_transaction?.hash].filter(Boolean));
  for(const [index,entry] of processing.entries()){
    const pair=get(entry,'result'), nativeHash=Buffer.from(get(pair,'transactionHash')).toString('hex');
    if(!aliases.has(nativeHash))continue;
    const result=get(pair,'result'), tag=variant(get(result,'result'));
    const successful=/txSuccess|txFeeBumpInnerSuccess/.test(tag);
    return {row:{...copy(horizonRow),hash:nativeHash,txHash:nativeHash,status:successful?'SUCCESS':'FAILED',
      ledger:String(ledger),createdAt:retained.record.ledgerCloseTime,
      applicationOrder:String(index+1),resultXdr:xdrOut(result),resultMetaXdr:xdrOut(get(entry,'txApplyProcessing'))},
      ref:retained.ref+'#txProcessing/'+index};
  }
  throw Object.assign(new Error('The original ledger did not contain the selected transaction hash.'),{code:'ARCHIVE_TRANSACTION_MISSING',rawRefs:[retained.ref]});
}
async function horizonOperations(ctx,tx) {
  let cursor='0',ordinal=0;
  for(;;){
    const url=new URL(ctx.horizonUrl+'/transactions/'+tx.hash+'/operations');
    url.searchParams.set('limit','200');url.searchParams.set('order','asc');url.searchParams.set('cursor',cursor);
    const result=await ctx.request(url.href),rows=result.data?._embedded?.records;
    need(Array.isArray(rows),'HORIZON_OPERATIONS','Keep the original Horizon operation list.');
    if(!rows.length)break;
    for(const row of rows){
      const operationIndex=String(ordinal++);
      const hasNativeTransfer=ctx.source.tables.transfers.some(item=>item.hash===tx.hash&&item.operationIndex===operationIndex&&item.sourceKind==='contract-event');
      if(hasNativeTransfer||!tx.successful)continue;
      let from,to,asset,amountAtoms;
      if(row.type==='payment'){from=row.from;to=row.to;asset=classicAsset(ctx,row);amountAtoms=units(row.amount,7).toString();}
      else if(row.type==='create_account'){from=row.funder;to=row.account;asset=nativeAsset(ctx);amountAtoms=units(row.starting_balance,7).toString();}
      else if(['path_payment_strict_send','path_payment_strict_receive'].includes(row.type)){
        // The original operation gives an exact payer debit and exact delivered output.
        // Keep them on one operation; intermediate path counterparties are not fabricated.
        const sourceAsset=classicAsset(ctx,row,'source_'),destinationAsset=classicAsset(ctx,row);
        add(ctx,'transfers',{key:ctx.network+':'+tx.hash+':operation:'+row.id+':path',hash:tx.hash,network:ctx.network,
          ledger:tx.ledger,createdAt:tx.createdAt,from:row.from,to:row.to,asset:sourceAsset,
          amountAtoms:units(row.source_amount,7).toString(),destinationAsset,
          destinationAmountAtoms:units(row.amount,7).toString(),operationId:String(row.id),operationIndex,
          sourceKind:row.type,amountBasis:'original payer debit; delivered output retained separately',
          rawRefs:[result.ref+'#operations/'+operationIndex]});
        continue;
      }else continue;
      add(ctx,'transfers',{key:ctx.network+':'+tx.hash+':operation:'+row.id+':destination',hash:tx.hash,network:ctx.network,
        ledger:tx.ledger,createdAt:tx.createdAt,from,to,asset,amountAtoms,operationId:String(row.id),operationIndex,
        sourceKind:row.type,rawRefs:[result.ref+'#operations/'+operationIndex]});
    }
    const next=String(rows[rows.length-1].paging_token);
    need(/^\d+$/.test(next)&&BigInt(next)>BigInt(cursor),'HORIZON_CURSOR','Horizon repeated an operation cursor.');
    cursor=next;
  }
  tx.operationsCaptured=true;
}
async function captureOne(ctx,hash,horizonRecord=null,providedRef=null) {
  hash=String(hash).toLowerCase();need(HASH.test(hash),'LEDGER_HASH','Use the original 64-character transaction hash.');
  const previous=ctx.index.transactions.get(ctx.aliases.get(hash)||hash);
  if(previous?.metadataStatus==='retained'&&(previous.hash===hash||previous.successful===true)){
    if(!previous.operationsCaptured)await horizonOperations(ctx,previous);
    return previous;
  }
  let rpc=null,horizon=horizonRecord,ref=providedRef;
  try{
    const outsideRetention=horizon?.ledger!==undefined&&ctx.health?.oldestLedger!==undefined&&BigInt(horizon.ledger)<BigInt(ctx.health.oldestLedger);
    if(!horizon?.result_meta_xdr&&!outsideRetention){
      const result=await ctx.rpc('getTransaction',{hash,xdrFormat:'base64'});
      if(result.data.status!=='NOT_FOUND'){rpc={...result.data,requestedHash:hash,hash:result.data.txHash||result.data.hash||hash};ref=result.ref;}
    }
  }catch(error){
    if(error.status===429||Number(error.status)>=500)throw error;
    issue(ctx,'TRANSACTION_RPC_READ',error.message,{hash,rawRefs:error.rawRefs||[]});
  }
  if(!horizon){
    try{const result=await ctx.request(ctx.horizonUrl+'/transactions/'+hash);horizon=result.data;ctx.horizonRows.set(hash,horizon);if(!rpc)ref=result.ref;}
    catch(error){if(error.status!==404)throw error;}
  }
  let row=rpc||horizon;
  if(!row){
    issue(ctx,'TRANSACTION_NOT_FOUND','The selected transaction is absent from the retained RPC and Horizon responses.',{hash});
    return null;
  }
  if(!row.resultMetaXdr&&!row.result_meta_xdr&&horizon&&ctx.archiveRpcUrl){
    try{const recovered=await archiveTransaction(ctx,horizon,hash);if(recovered){row=recovered.row;ref=recovered.ref;}}
    catch(error){
      if(error.status===429||Number(error.status)>=500)throw error;
      issue(ctx,'TRANSACTION_ARCHIVE_READ',error.message,{hash,ledger:String(horizon.ledger),rawRefs:error.rawRefs||[]});
    }
  }
  const tx=await decodeTransaction(ctx,row,ref);
  if(horizon&&providedRef&&!tx.rawRefs.includes(providedRef))tx.rawRefs.push(providedRef);
  try{
    if(tx.metadataStatus==='retained'&&tx.nativeOperationKinds?.length&&tx.nativeOperationKinds.every(kind=>kind==='invokeHostFunction')) tx.operationsCaptured=true;
    else await horizonOperations(ctx,tx);
  }catch(error){
    if(error.status!==404)throw error;
    issue(ctx,'TRANSACTION_OPERATIONS_UNAVAILABLE','Horizon operation details are unavailable for this source transaction.',{hash:tx.hash});
  }
  if(tx.metadataStatus!=='retained')issue(ctx,'TRANSACTION_METADATA_UNAVAILABLE',
    'Original transaction metadata remains to be supplied by its native ledger source.',{hash:tx.hash,ledger:tx.ledger});
  for(const observation of ctx.source.tables.contractObservations)
    if(observation.hash===tx.hash&&observation.provider&&/^G[A-Z2-7]{55}$/.test(observation.provider))ctx.accounts.add(observation.provider);
  await ctx.progress('transaction',{hash:tx.hash});
  return tx;
}

async function verifyNetwork(ctx) {
  const rpc=await ctx.rpc('getNetwork');
  need(rpc.data.passphrase===ctx.passphrase,'LEDGER_NETWORK_MISMATCH','The RPC network passphrase does not match this source edition.');
  const horizon=await ctx.request(ctx.horizonUrl);
  need(horizon.data.network_passphrase===ctx.passphrase,'LEDGER_NETWORK_MISMATCH','The Horizon network passphrase does not match this source edition.');
  const health=await ctx.rpc('getHealth');
  ctx.health=health.data;
  ctx.source.metadata.networkObservations={rpc:{...copy(rpc.data),rawRef:rpc.ref},horizon:{...copy(horizon.data),rawRef:horizon.ref},
    health:{...copy(health.data),rawRef:health.ref}};
  return health.data;
}
function selectedTime(ctx,createdAt) {
  const from=ctx.source.metadata.selection.from,before=ctx.source.metadata.selection.before;
  const time=timestamp(createdAt);
  return (!from||time>=timestamp(from))&&(!before||time<timestamp(before));
}
async function collectEvents(ctx,health,query={}) {
  const oldest=integer(health.oldestLedger,'oldest retained ledger'),latest=integer(health.latestLedger,'latest retained ledger');
  const queryKey=query.id||'events';
  let progress=ctx.source.metadata.progress[queryKey];
  if(!progress){
    const requestedStart=ctx.options.startLedger===undefined?oldest:integer(ctx.options.startLedger,'start ledger');
    const requestedEnd=ctx.options.endLedger===undefined?latest+1:integer(ctx.options.endLedger,'exclusive end ledger');
    need(requestedEnd>requestedStart,'LEDGER_RANGE','The exclusive end ledger must follow the start ledger.');
    const start=Math.max(oldest,requestedStart),end=Math.min(latest+1,requestedEnd);
    progress=ctx.source.metadata.progress[queryKey]={start:String(start),end:String(end),cursor:null,complete:false};
    ctx.source.metadata.coverage[queryKey]={requestedStart:String(requestedStart),requestedEnd:String(requestedEnd),
      capturedStart:String(start),capturedEnd:String(end),availableOldest:String(oldest),availableLatest:String(latest),
      contracts:query.contractIds||[...ctx.contracts],topics:query.topics||null,dateFiltered:false,
      status:requestedStart<oldest||requestedEnd>latest+1?'available-range-with-original-hash-archive-recovery':'capturing'};
    if(requestedStart<oldest)issue(ctx,'RPC_EVENT_HISTORY_RANGE',
      'This RPC event index begins after the requested source start. Older identified payments are recovered from original ledger archives.',
      {requestedStart:String(requestedStart),oldestLedger:String(oldest)});
    if(requestedEnd>latest+1)issue(ctx,'RPC_EVENT_FUTURE_RANGE','The selected source range ends after the observed latest ledger.',
      {requestedEnd:String(requestedEnd),latestLedger:String(latest)});
  }
  const start=Number(progress.start),end=Number(progress.end);
  if(progress.complete||start>=end){progress.complete=true;return;}
  const contracts=query.contractIds||[...ctx.contracts];
  need(contracts.length<=5,'LEDGER_CONTRACT_FILTERS','One native capture edition supports up to five selected CFCE contracts.');
  ctx.source.metadata.nativeEvents ||= [];
  const seen=new Set(ctx.source.metadata.nativeEvents.map(row=>row.id));
  while(!progress.complete){
    const params={filters:[{type:'contract',contractIds:contracts,...(query.topics?{topics:query.topics}:{})}],pagination:{limit:1000},xdrFormat:'base64'};
    if(progress.cursor)params.pagination.cursor=progress.cursor;
    else{params.startLedger=start;params.endLedger=end;}
    const result=await ctx.rpc('getEvents',params),rows=result.data.events;
    need(Array.isArray(rows),'LEDGER_EVENTS_RESPONSE','Keep the original native event list.');
    let beyond=false;
    for(const row of rows){
      const ledger=integer(row.ledger,'event ledger');
      if(ledger>=end){beyond=true;break;}
      if(ledger<start)continue;
      need(typeof row.id==='string'&&HASH.test(row.txHash),'LEDGER_EVENT_ID','Keep the original event ID and transaction hash.');
      if(!seen.has(row.id)){ctx.source.metadata.nativeEvents.push({...copy(row),rawRefs:[result.ref]});seen.add(row.id);}
    }
    const cursor=result.data.cursor===undefined?null:String(result.data.cursor);
    if(!rows.length||beyond){progress.complete=true;progress.terminalRawRef=result.ref;}
    else{
      need(cursor&&cursor!==progress.cursor,'LEDGER_EVENT_CURSOR','RPC repeated an event cursor.');
      progress.cursor=cursor;
    }
    await ctx.progress('events',{events:String(ctx.source.metadata.nativeEvents.length)});
  }
  ctx.source.metadata.coverage[queryKey].traversal='terminal';
}
function providerTokenQueries(ctx) {
  const providers=new Set(ctx.source.tables.donationEvents.map(row=>row.provider));
  const tokens=new Set();
  for(const row of ctx.source.tables.contractObservations){
    if(row.provider)providers.add(row.provider);
    if(row.tokenContractId)tokens.add(row.tokenContractId);
  }
  for(const row of ctx.source.tables.transfers)
    if(ctx.contracts.has(row.from)&&providers.has(row.to)&&row.asset?.contractId)tokens.add(row.asset.contractId);
  const symbol=xdrOut(ctx.sdk.xdr.ScVal.scvSymbol('transfer')),queries=[];
  for(const token of tokens)for(const provider of providers){
    const address=xdrOut(ctx.sdk.Address.fromString(provider).toScVal());
    queries.push({id:'provider-events-'+sha(token+':'+provider).slice(0,16),contractIds:[token],
      topics:[[symbol,address,'*','**']],provider});
  }
  return queries;
}

async function acquireAccountHistory(ctx,address) {
  need(/^G[A-Z2-7]{55}$/.test(address),'LEDGER_ACCOUNT','Use the original Stellar account address.');
  const all=ctx.source.metadata.progress.accounts ||= {};
  const progress=all[address] ||= {cursor:'0',complete:false,pages:'0'};
  if(progress.complete)return;
  ctx.source.metadata.coverage.accounts ||= {};
  ctx.source.metadata.coverage.accounts[address]={status:'capturing',source:'Horizon account transaction index',
    from:ctx.source.metadata.selection.from,before:ctx.source.metadata.selection.before,scope:'all indexed transactions within the selected close-time period'};
  while(!progress.complete){
    const url=new URL(ctx.horizonUrl+'/accounts/'+address+'/transactions');
    url.searchParams.set('order','asc');url.searchParams.set('limit','200');
    url.searchParams.set('include_failed','true');url.searchParams.set('cursor',progress.cursor);
    let result;
    try{result=await ctx.request(url.href);}catch(error){
      if(error.status!==404)throw error;
      ctx.source.metadata.coverage.accounts[address].status='account-not-found';
      progress.complete=true;return;
    }
    const rows=result.data?._embedded?.records;
    need(Array.isArray(rows),'HORIZON_TRANSACTIONS','Keep the original account transaction list.');
    let beyond=false;
    for(const row of rows){
      if(ctx.source.metadata.selection.before&&timestamp(row.created_at)>=timestamp(ctx.source.metadata.selection.before)){beyond=true;break;}
      if(!selectedTime(ctx,row.created_at))continue;
      need(HASH.test(row.hash),'LEDGER_HASH','Keep each original account transaction hash.');
      ctx.horizonRows.set(row.hash,row);
      await captureOne(ctx,row.hash,row,result.ref);
    }
    progress.pages=String(Number(progress.pages)+1);
    if(!rows.length||beyond){
      progress.complete=true;
      ctx.source.metadata.coverage.accounts[address].status=beyond?'exclusive-end-reached':'terminal-empty-page';
      ctx.source.metadata.coverage.accounts[address].terminalRawRef=result.ref;
    }else{
      const cursor=String(rows[rows.length-1].paging_token);
      need(/^\d+$/.test(cursor)&&BigInt(cursor)>BigInt(progress.cursor),'HORIZON_CURSOR','Horizon repeated an account transaction cursor.');
      progress.cursor=cursor;
    }
    await ctx.progress('account',{account:address});
  }
}
async function eventFallbacks(ctx) {
  for(const event of ctx.source.metadata.nativeEvents||[]){
    const tx=ctx.index.transactions.get(ctx.aliases.get(event.txHash)||event.txHash);
    if(!tx||!tx.successful||tx.metadataStatus==='retained')continue;
    const topic=(event.topic||[]).map(value=>native(ctx.sdk,xdrIn(ctx.sdk.xdr.ScVal,value)));
    const decoded={contractId:event.contractId,topic,amount:native(ctx.sdk,xdrIn(ctx.sdk.xdr.ScVal,event.value)),
      hash:tx.hash,ledger:String(event.ledger),createdAt:timestamp(event.ledgerClosedAt),rawRefs:event.rawRefs};
    const operationIndex=String(event.operationIndex||'0'),eventIndex=String(event.id).split('-').at(-1);
    await recordEvent(ctx,decoded,{tx,eventId:event.id,operationIndex,eventIndex,ref:event.rawRefs[0]});
  }
}
function suppliedHashes(options,network) {
  const hashes=[...(options.transactionHashes||options.hashes||[]),...(options.hash?[options.hash]:[])];
  const editions=[...(options.registrySources||[]),...(options.registrySource?[options.registrySource]:[])];
  for(const source of editions)for(const row of source.tables?.nfts||[]){
    if(String(row.chainName||'').toLowerCase()==='stellar'&&String(row.network||'').toLowerCase()===network&&row.transactionId)
      hashes.push(row.transactionId);
  }
  for(const hash of hashes)need(typeof hash==='string'&&HASH.test(hash),'LEDGER_HASH','Keep original Stellar donor payment hashes.');
  return [...new Set(hashes.map(hash=>hash.toLowerCase()))];
}
function finish(ctx) {
  ctx.source.metadata.assetMetadata=[...ctx.assets.values()].map(copy);
  for(const observation of ctx.source.tables.contractObservations){
    for(const field of [...Object.values(STATE_FIELDS),'tokenBalanceAtoms'])
      if(!observation.sourceStatus[field])observation.sourceStatus[field]={status:'not-present-in-this-observation'};
  }
  ctx.source.metadata.issues=ctx.source.metadata.issues.filter(row=>{
    if(row.code==='TRANSACTION_METADATA_UNAVAILABLE')return ctx.index.transactions.get(ctx.aliases.get(row.hash)||row.hash)?.metadataStatus!=='retained';
    if(row.code==='TRANSACTION_NOT_FOUND')return !ctx.index.transactions.has(ctx.aliases.get(row.hash)||row.hash);
    return true;
  });
  ctx.source.metadata.status=ctx.source.metadata.issues.length?'complete-with-source-notes':'complete';
  ctx.source.metadata.completedAt=now();ctx.source.metadata.updatedAt=ctx.source.metadata.completedAt;
  ctx.source.metadata.captureSummary=Object.fromEntries(TABLES.map(name=>[name,String(ctx.source.tables[name].length)]));
  validateSourceEdition(ctx.source);
  return ctx.source;
}
function interrupted(ctx,error) {
  ctx.source.metadata.status='interrupted';ctx.source.metadata.updatedAt=now();
  ctx.source.metadata.interruption={code:error.code||'CAPTURE_INTERRUPTED',message:error.message,retryAfter:error.retryAfter||null};
  ctx.source.metadata.assetMetadata=[...ctx.assets.values()].map(copy);
  error.checkpoint=copy(ctx.source);
  throw error;
}

/**
 * Complete donor/payment and provider-account source acquisition. Requires only the
 * existing @stellar/stellar-sdk native peer; no secret key and no transaction sends.
 *
 * Mainnet defaults are the original GiveCredit production contract and CFCE wallet.
 * Options: rpcUrl, horizonUrl, archiveRpcUrl (null disables), network,
 * networkPassphrase, contractId/contractIds, accounts, simulationSource,
 * transactionHashes, registrySource/registrySources, from/before or fromDate/beforeDate,
 * startLedger/endLedger (exclusive), assets (original token metadata),
 * fetchImpl, sdk, signal, timeoutMs, checkpoint, onProgress.
 *
 * Queries retain their complete original response text, source bounds and cursors.
 * An interrupted acquisition throws with .checkpoint for exact native resumption.
 */
export async function captureLedger(options={}) {
  const ctx=await makeContext(options);
  try{
    const health=await verifyNetwork(ctx);
    await currentContractState(ctx);
    await collectEvents(ctx,health);
    const hashes=new Set([...suppliedHashes(options,ctx.network),...(ctx.source.metadata.nativeEvents||[]).map(row=>row.txHash)]);
    ctx.source.metadata.coverage.requestedTransactions={hashes:[...hashes],source:'Original receipt payment IDs and native CFCE contract event IDs'};
    for(const hash of hashes)await captureOne(ctx,hash);
    // Source-observed historical providers, including contract addresses, define
    // the next acquisition frontier. Each source account/query is completed once.
    const completedAccounts=new Set(),completedQueries=new Set(),completedHashes=new Set(hashes);
    for(;;){
      let advanced=false;
      for(const address of [...ctx.accounts])if(!completedAccounts.has(address)){
        await acquireAccountHistory(ctx,address);completedAccounts.add(address);advanced=true;
      }
      for(const query of providerTokenQueries(ctx))if(!completedQueries.has(query.id)){
        await collectEvents(ctx,health,query);completedQueries.add(query.id);advanced=true;
      }
      for(const event of ctx.source.metadata.nativeEvents||[])if(!completedHashes.has(event.txHash)){
        await captureOne(ctx,event.txHash);completedHashes.add(event.txHash);advanced=true;
      }
      if(!advanced)break;
    }
    ctx.source.metadata.coverage.requestedTransactions.hashes=[...completedHashes];
    await eventFallbacks(ctx);
    const source=finish(ctx);await ctx.progress('complete');return source;
  }catch(error){return interrupted(ctx,error);}
}
export async function captureTransaction(options={}) {
  need(typeof options.hash==='string'&&HASH.test(options.hash),'LEDGER_HASH','Select the original Stellar transaction hash.');
  const ctx=await makeContext(options);
  try{
    await verifyNetwork(ctx);
    ctx.source.metadata.coverage.requestedTransactions={hashes:[options.hash.toLowerCase()],source:'Explicit original transaction hash'};
    await captureOne(ctx,options.hash);
    const source=finish(ctx);await ctx.progress('complete');return source;
  }catch(error){return interrupted(ctx,error);}
}

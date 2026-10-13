import {createHash} from 'node:crypto';
import {Buffer} from 'node:buffer';

export const STELLAR_SDK_VERSION='16.0.1';
export const MAX_I128=(1n<<127n)-1n;
export function need(ok,message){if(!ok){const error=new Error(message);error.code='PROVIDER_VALIDATION';error.publicMessage=message;throw error;}}
export function object(v){return v!==null&&typeof v==='object'&&!Array.isArray(v);}
export function exactKeys(v,allowed,required=[]){need(object(v),'Supply the complete named input object.');for(const k of Object.keys(v))need(allowed.includes(k),'Unsupported input field: '+k);for(const k of required)need(Object.hasOwn(v,k),'Missing input field: '+k);return v;}
export function integer(v,{positive=false,max=MAX_I128}={}){need(typeof v==='string'&&/^(0|[1-9][0-9]*)$/.test(v),'Keep exact nonnegative integers as decimal text.');const n=BigInt(v);need(n<=max&&(!positive||n>0n),'Integer is outside the selected native range.');return n;}
export function small(v,min,max){need(Number.isSafeInteger(v)&&v>=min&&v<=max,'Select a whole number in the documented range.');return v;}
export function safeNumber(v){const n=integer(v);need(n<=BigInt(Number.MAX_SAFE_INTEGER),'This issued HTTP interface accepts numbers; use the exact direct-contract workflow for larger amounts.');return Number(n);}
export function canonical(v){if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';if(object(v))return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';need(v!==undefined,'Undefined values are not retained JSON.');return JSON.stringify(v);}
export const sha=s=>createHash('sha256').update(s).digest('hex');
export const base64=s=>Buffer.from(s,'utf8').toString('base64');
export function https(value){const u=new URL(value);need(u.protocol==='https:'&&!u.username&&!u.password&&!u.hash,'Select an ordinary HTTPS provider URL.');return u;}
export function jsonValue(value){if(typeof value==='bigint')return value.toString();if(value instanceof Uint8Array)return {bytesBase64:Buffer.from(value).toString('base64')};if(value instanceof Map)return {entries:[...value].map(([k,v])=>[jsonValue(k),jsonValue(v)])};if(Array.isArray(value))return value.map(jsonValue);if(object(value))return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,jsonValue(v)]));if(typeof value==='number')need(Number.isSafeInteger(value),'Native decoded numeric value exceeded exact integer range.');return value===undefined?null:value;}
export function evidence(ctx,id,predicate=()=>true){need(typeof id==='string'&&id,'Select the retained original evidence ID.');const rows=(ctx.evidence||[]).filter(x=>x.id===id&&predicate(x));need(rows.length===1,'Select exactly one matching retained original evidence record.');return rows[0];}
export function stellarNetwork(ctx){const n=ctx.config?.network;need(n?.kind==='stellar'&&typeof n.id==='string'&&n.id&&typeof n.passphrase==='string'&&n.passphrase,'Select the full original Stellar network and passphrase.');return n;}
export function address(sdk,value,contract=false){need(typeof value==='string'&&(contract?sdk.StrKey.isValidContract(value):sdk.StrKey.isValidEd25519PublicKey(value)||sdk.StrKey.isValidContract(value)),'Select an exact valid '+(contract?'contract':'Stellar')+' address.');return value;}
export function wallet(sdk,ctx){const n=stellarNetwork(ctx),w=ctx.config.wallet;need(w&&w.networkId===n.id,'Select a wallet on the original configured network.');address(sdk,w.address);return w.address;}
export function providerBinding(ctx,id){const p=ctx.config.providers?.[id];need(object(p),'Configure the selected '+id+' provider.');return {network:stellarNetwork(ctx),provider:p};}
export function assertBinding(ctx,id,value){need(canonical(providerBinding(ctx,id))===canonical(value),'The retained evidence belongs to a different original provider/network configuration.');}
export async function requestJSON(ctx,{url,method='GET',body,bodyText,credential,allowStatuses=[]}){
  const options={url:https(url).href,method,headers:{Accept:'application/json'},semantics:'read',timeoutMs:30000,maxBytes:16*1024*1024};
  if(credential)options.credential=credential;
  if(body!==undefined||bodyText!==undefined){options.headers['Content-Type']='application/json';options.bodyBase64=base64(bodyText===undefined?JSON.stringify(body):bodyText);}
  const x=await ctx.http(options);
  need((x.status>=200&&x.status<300)||allowStatuses.includes(x.status),'Original provider returned HTTP '+x.status+'; retained exchange '+x.exchangeId+'.');
  need(!x.parseError&&x.parsed!==null,'Original provider did not return complete valid JSON; retained exchange '+x.exchangeId+'.');
  return {value:x.parsed,exchange:x,exchangeId:x.exchangeId};
}
export function createStellarTools(sdk,ctx){
  need(sdk?.TransactionBuilder&&sdk?.rpc?.assembleTransaction,'Load the pinned complete Stellar SDK '+STELLAR_SDK_VERSION+'.');
  const network=stellarNetwork(ctx),rpcURL=network.rpcUrl?https(network.rpcUrl).href:null;
  const ids=[];let observedNetwork=null;
  function remember(id){if(!ids.includes(id))ids.push(id);}
  async function rpc(method,params={}){
    need(rpcURL,'Select the original Stellar RPC URL.');
    need(['getNetwork','getLatestLedger','getLedgerEntries','getTransaction','simulateTransaction','getEvents'].includes(method),'Only the selected read/simulation RPC methods are available.');
    const id='bim:'+sha(canonical({method,params,now:ctx.now})).slice(0,32);
    const r=await requestJSON(ctx,{url:rpcURL,method:'POST',body:{jsonrpc:'2.0',id,method,params}});
    remember(r.exchangeId);need(r.value.jsonrpc==='2.0'&&r.value.id===id,'Original JSON-RPC response identity differs.');
    need(!r.value.error&&Object.hasOwn(r.value,'result'),'Original RPC error retained in '+r.exchangeId+': '+JSON.stringify(r.value.error||null));
    return {result:r.value.result,exchangeId:r.exchangeId,exchange:r.exchange};
  }
  async function verifyNetwork(){
    if(!observedNetwork){const r=await rpc('getNetwork');need(r.result.passphrase===network.passphrase,'Original RPC network passphrase differs from the selected network.');observedNetwork=r;}
    return observedNetwork;
  }
  async function horizon(path,{allowStatuses=[]}={}){
    need(network.horizonUrl,'Select the original Horizon URL.');const base=https(network.horizonUrl);const url=new URL(base.href.replace(/\/$/,'')+'/'+path.replace(/^\//,'')).href;
    const r=await requestJSON(ctx,{url,allowStatuses});remember(r.exchangeId);return r;
  }
  async function account(value){
    address(sdk,value);need(sdk.StrKey.isValidEd25519PublicKey(value),'An actual G-address transaction source is required; contract-wallet authorization needs its selected external wallet transaction builder.');
    await verifyNetwork();const root=await horizon('');need(root.value.network_passphrase===network.passphrase,'Original Horizon network differs.');
    const r=await horizon('accounts/'+encodeURIComponent(value));need(r.value.account_id===value,'Original source account differs.');integer(r.value.sequence,{max:(1n<<63n)-1n});
    return {address:value,sequence:r.value.sequence,exchangeIds:[...ids]};
  }
  function inspectEnvelope({xdr,expectedSource}){
    need(typeof xdr==='string'&&xdr.length>0&&xdr.length<=8*1024*1024,'Supply the complete bounded original transaction XDR.');
    const tx=sdk.TransactionBuilder.fromXDR(xdr,network.passphrase),inner=tx.innerTransaction||tx;
    if(expectedSource)need(inner.source===expectedSource,'Unsigned transaction source differs from the selected wallet.');
    let rawOps;try{rawOps=inner.toEnvelope().v1().tx().operations();}catch{throw new Error('Select a complete supported Stellar v1 transaction envelope.');}
    const operations=inner.operations.map((op,i)=>{
      const result={index:i,type:op.type,source:op.source||inner.source,operationXdr:rawOps[i].toXDR('base64')};
      if(op.type==='invokeHostFunction'){
        const tag=op.func.switch().name;result.hostFunction=tag;
        if(tag==='hostFunctionTypeInvokeContract'){
          const call=op.func.invokeContract();
          result.contractId=sdk.Address.fromScAddress(call.contractAddress()).toString();
          result.method=call.functionName().toString();
          result.args=call.args().map(v=>jsonValue(sdk.scValToNative(v)));
          result.argsXdr=call.args().map(v=>v.toXDR('base64'));
        }
        result.authorizationXdr=(op.auth||[]).map(a=>a.toXDR('base64'));
      }else{
        result.fields=jsonValue(Object.fromEntries(Object.entries(op).filter(([k])=>!['type','source'].includes(k))));
      }
      return result;
    });
    return {networkId:network.id,networkPassphrase:network.passphrase,transactionHash:Buffer.from(tx.hash()).toString('hex'),innerTransactionHash:Buffer.from(inner.hash()).toString('hex'),
      source:inner.source,sequence:inner.sequence,fee:tx.fee,innerFee:inner.fee,feeBump:!!tx.innerTransaction,timeBounds:jsonValue(inner.timeBounds),memo:jsonValue(inner.memo),operations,
      signatures:tx.signatures.map(s=>({hint:Buffer.from(s.hint()).toString('hex'),signatureBase64:Buffer.from(s.signature()).toString('base64')})),innerSignatures:inner.signatures.map(s=>({hint:Buffer.from(s.hint()).toString('hex'),signatureBase64:Buffer.from(s.signature()).toString('base64')}))};
  }
  async function simulateEnvelope({xdr,expectedSource}){
    await verifyNetwork();const inspected=inspectEnvelope({xdr,expectedSource});
    need(!inspected.feeBump,'Prepare the original inner transaction before any separately reviewed fee sponsorship.');
    need(inspected.operations.length===1&&inspected.operations[0].type==='invokeHostFunction','Soroban simulation requires the exact single original contract invocation.');
    const r=await rpc('simulateTransaction',{transaction:xdr}),simulation=r.result;
    const restore=simulation.restorePreamble&&simulation.restorePreamble.transactionData;
    const error=typeof simulation.error==='string'?simulation.error:null;
    if(!error&&!restore)need(typeof simulation.transactionData==='string'&&typeof simulation.minResourceFee==='string'&&Array.isArray(simulation.results)&&simulation.results.length===1&&typeof simulation.results[0].xdr==='string','Retain the complete original single-invocation simulation result.');
    const returned=simulation.results?.[0]?.xdr||null;
    return {status:error?'FAILED':restore?'NEEDS_RESTORE':'SIMULATED',transactionXdr:xdr,simulation,returnValue:returned?jsonValue(sdk.scValToNative(sdk.xdr.ScVal.fromXDR(returned,'base64'))):null,returnXdr:returned,
      latestLedger:simulation.latestLedger??null,selection:inspected,error,restorePreamble:simulation.restorePreamble||null,exchangeIds:[...ids]};
  }
  async function simulateCall({contractId,method,args,source,timeoutSeconds=300}){
    address(sdk,contractId,true);address(sdk,source);need(typeof method==='string'&&/^[A-Za-z_][A-Za-z0-9_]{0,31}$/.test(method),'Select the original contract method.');need(Array.isArray(args),'Supply the original typed ScVal arguments.');small(timeoutSeconds,1,3600);
    const a=await account(source);const now=Date.parse(ctx.now);need(Number.isFinite(now),'Retain the original request time.');
    const tx=new sdk.TransactionBuilder(new sdk.Account(source,a.sequence),{fee:'100',networkPassphrase:network.passphrase})
      .addOperation(new sdk.Contract(contractId).call(method,...args)).setTimebounds(0,Math.floor(now/1000)+timeoutSeconds).build();
    return simulateEnvelope({xdr:tx.toXDR(),expectedSource:source});
  }
  function prepareSimulation(sim){
    if(sim.status!=='SIMULATED')return {status:'NEEDS_REVIEW',unsignedPayload:null,selection:sim.selection,simulation:sim.simulation,restorePreamble:sim.restorePreamble,error:sim.error,exchangeIds:sim.exchangeIds};
    need(typeof sim.simulation.transactionData==='string'&&typeof sim.simulation.minResourceFee==='string'&&Array.isArray(sim.simulation.results)&&sim.simulation.results.length===1,'Complete successful original simulation is required.');
    const raw=sdk.TransactionBuilder.fromXDR(sim.transactionXdr,network.passphrase),tx=sdk.rpc.assembleTransaction(raw,sim.simulation).build(),xdr=tx.toXDR();
    const inspected=inspectEnvelope({xdr,expectedSource:sim.selection.source});
    const expiry=integer(String(inspected.timeBounds?.maxTime??'0'),{positive:true,max:8640000000000n});need(expiry>BigInt(Math.floor(Date.parse(ctx.now)/1000)),'The original prepared transaction has expired.');
    return {status:'PREPARED',unsignedPayload:{kind:'stellar-xdr',xdr,transactionHash:inspected.transactionHash,networkId:network.id,networkPassphrase:network.passphrase,source:inspected.source},
      selection:inspected,simulation:sim.simulation,returnValue:sim.returnValue,latestLedger:sim.latestLedger,expiresAt:new Date(Number(expiry)*1000).toISOString(),exchangeIds:sim.exchangeIds};
  }
  async function prepareCall(input){return prepareSimulation(await simulateCall(input));}
  function decodeReturn(metaXdr){
    if(!metaXdr)return {value:null,warning:'No original result metadata supplied; full ledger result remains retained.'};
    try{
      const meta=sdk.xdr.TransactionMeta.fromXDR(metaXdr,'base64'),version=meta.switch();
      if(version===3){const m=meta.value().sorobanMeta();return {value:m?jsonValue(sdk.scValToNative(m.returnValue())):null,warning:null};}
      // Metadata editions are independently versioned. Keep all original XDR
      // rather than treating an unsupported presentation accessor as a failed payment.
      return {value:null,warning:'Return-value presentation is unavailable for original transaction metadata version '+version+'. Full original resultMetaXdr is retained.'};
    }catch(error){return {value:null,warning:'Original metadata retained; optional return-value decoding: '+String(error.message)};}
  }
  async function confirm({transactionHash,signedXdr,expectedSource}){
    need(typeof transactionHash==='string'&&/^[0-9a-f]{64}$/i.test(transactionHash),'Select the original transaction hash.');transactionHash=transactionHash.toLowerCase();
    await verifyNetwork();let submitted=null;
    if(signedXdr){submitted=inspectEnvelope({xdr:signedXdr,expectedSource});need(submitted.transactionHash===transactionHash||submitted.innerTransactionHash===transactionHash,'Client-reported hash does not match the original signed envelope.');}
    const r=await rpc('getTransaction',{hash:transactionHash}),v=r.result;
    need(['SUCCESS','FAILED','NOT_FOUND'].includes(v.status),'Retain the unknown original RPC status for review.');
    if(v.status==='NOT_FOUND'){
      if(network.horizonUrl){
        const root=await horizon('');need(root.value.network_passphrase===network.passphrase,'Original Horizon fallback network differs.');
        const h=await horizon('transactions/'+transactionHash,{allowStatuses:[404]});
        if(h.exchange.status!==404){
          const original=h.value;need(original.hash===transactionHash&&typeof original.successful==='boolean'&&typeof original.envelope_xdr==='string'&&typeof original.result_xdr==='string','Complete original Horizon transaction proof is required.');
          const seen=inspectEnvelope({xdr:original.envelope_xdr,expectedSource});
          need(seen.transactionHash===transactionHash||seen.innerTransactionHash===transactionHash,'Original Horizon envelope/hash differs.');
          if(submitted)need(seen.innerTransactionHash===submitted.innerTransactionHash,'Original Horizon transaction differs from wallet submission.');
          const code=sdk.xdr.TransactionResult.fromXDR(original.result_xdr,'base64').result().switch().name;
          const successful=code==='txSuccess'||code==='txFeeBumpInnerSuccess';need(successful===original.successful,'Horizon status and original result XDR disagree.');
          const decoded=decodeReturn(original.result_meta_xdr);
          return {status:successful?'CONFIRMED':'FAILED',terminal:true,transactionHash,networkId:network.id,ledger:original.ledger,observed:seen,returnValue:decoded.value,returnValueWarning:decoded.warning,rpc:v,horizon:original,exchangeIds:[...ids]};
        }
      }
      return {status:'PENDING_OR_UNAVAILABLE',terminal:false,transactionHash,networkId:network.id,rpc:v,submitted,exchangeIds:[...ids]};
    }
    need(typeof v.envelopeXdr==='string'&&typeof v.resultXdr==='string'&&typeof v.resultMetaXdr==='string','Complete original ledger transaction evidence is required.');
    const seen=inspectEnvelope({xdr:v.envelopeXdr,expectedSource});
    need(seen.transactionHash===transactionHash||seen.innerTransactionHash===transactionHash,'Observed ledger envelope does not match selected transaction hash.');
    if(v.txHash)need(v.txHash.toLowerCase()===transactionHash,'Original RPC transaction identity differs.');
    if(submitted)need(seen.innerTransactionHash===submitted.innerTransactionHash,'Observed original transaction body differs from wallet submission.');
    const result=sdk.xdr.TransactionResult.fromXDR(v.resultXdr,'base64'),code=result.result().switch().name;
    const successful=code==='txSuccess'||code==='txFeeBumpInnerSuccess';
    need((v.status==='SUCCESS')===successful,'RPC status and full original transaction result disagree.');
    const decoded=decodeReturn(v.resultMetaXdr);const returnValue=decoded.value;
    return {status:successful?'CONFIRMED':'FAILED',terminal:true,transactionHash,networkId:network.id,ledger:v.ledger,observed:seen,returnValue,returnValueWarning:decoded.warning,rpc:v,exchangeIds:[...ids]};
  }
  return {account,rpc,verifyNetwork,horizon,simulateCall,simulateEnvelope,prepareSimulation,prepareCall,inspectEnvelope,confirm,exchangeIds:()=>[...ids]};
}

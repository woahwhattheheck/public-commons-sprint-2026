import {need,object,exactKeys,integer,small,canonical,https,address,wallet,providerBinding,assertBinding,evidence,requestJSON,createStellarTools} from './stellar-provider.mjs';
import {intent,normalizedQuote,selectedQuote} from './exchange-domain.mjs';

const PROVIDER='soroswap',BASE='https://api.soroswap.finance';
const NETWORKS={mainnet:'Public Global Stellar Network ; September 2015',testnet:'Test SDF Network ; September 2015'};
const PROTOCOLS=['soroswap','phoenix','aqua','comet','sushi','sdex'];
const SOURCE={repository:'soroswap/sdk',commit:'33fa216f5fcf82b299805ce7c078451ec254eb96',version:'0.5.0',paths:['src/soroswap-sdk.ts','src/types/quote.ts','src/types/send.ts']};
const field=(name,type,required=true)=>({name,type,required});
export function createSoroswapAdapter({sdk}){
 const catalogue=[
  {id:'soroswap.protocols',label:'Available swap protocols',mode:'read',fields:[]},
  {id:'soroswap.pools',label:'Pools and exact reserves',mode:'read',fields:[field('protocols','string[]'),field('assetA','string',false),field('assetB','string',false)]},
  {id:'soroswap.balances',label:'Original wallet token balances',mode:'read',fields:[field('address','string',false),field('token','string',false)]},
  {id:'soroswap.quote',label:'Obtain a complete exact-amount quote',mode:'read',fields:[field('tokenIn','string'),field('tokenOut','string'),field('amount','integer-text'),field('mode','EXACT_IN|EXACT_OUT'),field('slippageBps','integer-text',false),field('ttlSeconds','integer-text',false)]},
  {id:'soroswap.prepare',label:'Build and independently inspect swap transaction',mode:'prepare',fields:[field('quoteId','evidence-id'),field('routeIndex','integer-text',false)]},
  {id:'soroswap.confirm',label:'Confirm original wallet submission on the ledger',mode:'read',fields:[field('submissionId','evidence-id')]}
 ].map(d=>({...d,origins:[BASE],source:SOURCE}));
 function configuration(ctx){
  const binding=providerBinding(ctx,PROVIDER),p=binding.provider;
  const network=p.environment;need(Object.hasOwn(NETWORKS,network)&&binding.network.passphrase===NETWORKS[network],'Select matching explicit Soroswap mainnet/testnet and Stellar passphrase.');
  const base=https(p.baseUrl||BASE);need(base.origin===BASE&&!base.search,'Use the issued Soroswap API origin.');need(typeof p.credentialAlias==='string'&&p.credentialAlias,'Select the retained server-side Soroswap credential alias.');
  return {binding,network,p,base:base.href.replace(/\/$/,'')};
 }
 function protocolList(v){need(Array.isArray(v)&&v.length>0&&new Set(v).size===v.length&&v.every(x=>PROTOCOLS.includes(x)),'Select a distinct complete supported protocol list.');return v;}
 async function http(ctx,c,path,{body,bodyText,query=[]}={}){
  const url=new URL(c.base+path);if(!path.startsWith('/api/'))url.searchParams.set('network',c.network);for(const [k,v]of query)url.searchParams.append(k,v);
  return requestJSON(ctx,{url:url.href,method:body!==undefined||bodyText!==undefined?'POST':'GET',body,bodyText,credential:c.p.credentialAlias});
 }
 function quoteInput(input){
  exactKeys(input,['assetIn','assetOut','amount','tradeType','protocols','slippageBps','parts','maxHops','feeBps','gaslessTrustline'],['assetIn','assetOut','amount','tradeType','protocols','slippageBps']);
  address(sdk,input.assetIn,true);address(sdk,input.assetOut,true);need(input.assetIn!==input.assetOut,'Choose different original input/output assets.');integer(input.amount,{positive:true});
  need(['EXACT_IN','EXACT_OUT'].includes(input.tradeType),'Select EXACT_IN or EXACT_OUT.');protocolList(input.protocols);small(input.slippageBps,0,10000);
  if(input.parts!==undefined)small(input.parts,1,100);if(input.maxHops!==undefined)small(input.maxHops,1,10);if(input.feeBps!==undefined)small(input.feeBps,0,10000);
  if(input.gaslessTrustline!==undefined)need(input.gaslessTrustline==='create','Only the issued create trustline mode is supported.');
  return input;
 }
 function checkedQuote(q,input){
  need(object(q)&&q.assetIn===input.assetIn&&q.assetOut===input.assetOut&&q.tradeType===input.tradeType,'Original quote asset/trade binding differs.');
  for(const key of ['amountIn','amountOut','otherAmountThreshold'])integer(q[key],{positive:true});
  need((input.tradeType==='EXACT_IN'?q.amountIn:q.amountOut)===input.amount,'Original quote requested amount differs.');
  need(['router','aggregator','sdex'].includes(q.platform)&&object(q.rawTrade)&&Array.isArray(q.routePlan),'Complete original quote route is required.');
  if(q.platformFee){small(Number(q.platformFee.feeBps),0,10000);integer(q.platformFee.feeAmount);if(input.feeBps!==undefined)need(String(q.platformFee.feeBps)===String(input.feeBps),'Original quote fee differs from selection.');}
  return q;
 }
 function units7(s){need(typeof s==='string'&&/^(0|[1-9][0-9]*)(\.[0-9]{1,7})?$/.test(s),'Keep the original Stellar decimal amount.');const [a,b='']=s.split('.');return (BigInt(a)*10000000n+BigInt(b.padEnd(7,'0'))).toString();}
 function assetId(asset,passphrase){return asset.contractId(passphrase);}
 function swapCheck(c,q,inspected,tx,to,contractId,now){
  const findings=[];const ops=inspected.operations;
  if(inspected.feeBump)findings.push('Fee sponsorship is retained for separate complete review.');
  if(ops.length!==1){findings.push('This complete transaction contains fee/trustline or other additional operations; review all operations before signing.');return findings;}
  const op=ops[0],native=(tx.innerTransaction||tx).operations[0];
  need(op.source===inspected.source,'Swap operation source differs from selected source.');
  if(q.platform==='sdex'){
   const expected=q.tradeType==='EXACT_IN'?'pathPaymentStrictSend':'pathPaymentStrictReceive';
   need(native.type===expected&&native.destination===to,'Original classic swap method/destination differs.');
   need(assetId(native.sendAsset,c.binding.network.passphrase)===q.assetIn&&assetId(native.destAsset,c.binding.network.passphrase)===q.assetOut,'Original classic swap assets differ.');
   if(q.tradeType==='EXACT_IN'){need(units7(native.sendAmount)===q.amountIn&&BigInt(units7(native.destMin))>=BigInt(q.otherAmountThreshold),'Original classic exact-input limit differs.');}
   else need(units7(native.destAmount)===q.amountOut&&BigInt(units7(native.sendMax))<=BigInt(q.otherAmountThreshold),'Original classic exact-output limit differs.');
   return findings;
  }
  need(to===inspected.source,'Selected source-backed Soroban swap contracts require the authenticated funding/recipient address to match.');
  need(op.type==='invokeHostFunction'&&op.contractId===contractId,'Original swap invokes a different selected contract.');
  const expected=q.tradeType==='EXACT_IN'?'swap_exact_tokens_for_tokens':'swap_tokens_for_exact_tokens';
  if(op.method!==expected){findings.push('The returned method is outside the selected full router/aggregator source edition; complete original XDR is retained.');return findings;}
  const a=op.args,aggregator=q.platform==='aggregator';
  need(a.length===(aggregator?7:5),'Complete original swap argument count differs.');
  let amount,limit,path,recipient,deadline;
  if(aggregator){need(a[0]===q.assetIn&&a[1]===q.assetOut,'Original aggregator assets differ.');[amount,limit]=a.slice(2,4);recipient=a[5];deadline=a[6];need(Array.isArray(a[4])&&a[4].length>0,'Complete original distribution is required.');}
  else{[amount,limit,path,recipient,deadline]=a;need(Array.isArray(path)&&path[0]===q.assetIn&&path.at(-1)===q.assetOut,'Original router path assets differ.');}
  need(recipient===to&&String(amount)===(q.tradeType==='EXACT_IN'?q.amountIn:q.amountOut),'Original swap recipient/amount differs.');
  integer(String(limit),{positive:true});need(q.tradeType==='EXACT_IN'?BigInt(limit)>=BigInt(q.otherAmountThreshold):BigInt(limit)<=BigInt(q.otherAmountThreshold),'Original swap threshold weakens the selected quote.');
  const d=integer(String(deadline),{positive:true,max:(1n<<64n)-1n});need(d>BigInt(Math.floor(Date.parse(now)/1000)),'Original swap deadline has expired.');
  return findings;
 }
 async function execute(id,input,ctx){
  const c=configuration(ctx),tools=createStellarTools(sdk,ctx);
  if(id==='soroswap.protocols'){exactKeys(input,[]);const r=await http(ctx,c,'/protocols');return {kind:'soroswap-protocols',binding:c.binding,protocols:r.value,exchangeIds:[r.exchangeId]};}
  if(id==='soroswap.pools'){exactKeys(input,['protocols','assetA','assetB'],['protocols']);protocolList(input.protocols);need(!!input.assetA===!!input.assetB,'Select both pool assets or neither.');if(input.assetA){address(sdk,input.assetA,true);address(sdk,input.assetB,true);}const path=input.assetA?'/pools/'+encodeURIComponent(input.assetA)+'/'+encodeURIComponent(input.assetB):'/pools';const r=await http(ctx,c,path,{query:input.protocols.map(p=>['protocol',p])});return {kind:'soroswap-pools',binding:c.binding,selection:input,pools:r.value,exchangeIds:[r.exchangeId]};}
  if(id==='soroswap.balances'){exactKeys(input,['address','token']);const who=input.address||wallet(sdk,ctx);address(sdk,who);if(input.token)address(sdk,input.token,true);const r=await http(ctx,c,'/balances/'+encodeURIComponent(who)+(input.token?'/'+encodeURIComponent(input.token):''));return {kind:'soroswap-balances',binding:c.binding,address:who,token:input.token||null,balances:r.value,exchangeIds:[r.exchangeId]};}
  if(id==='soroswap.quote'){
   exactKeys(input,['tokenIn','tokenOut','amount','mode','slippageBps','ttlSeconds'],['tokenIn','tokenOut','amount','mode']);
   const i=intent(input,ctx.config,PROVIDER,ctx.now),options=c.p.publicConfig||{};
   const request=quoteInput({assetIn:i.tokenIn,assetOut:i.tokenOut,amount:i.amount,tradeType:i.mode,protocols:protocolList(options.protocols||['soroswap']),slippageBps:Number(i.slippageBps),
    ...(options.parts!==undefined?{parts:small(options.parts,1,100)}:{}),...(options.maxHops!==undefined?{maxHops:small(options.maxHops,1,10)}:{}),
    ...(options.feeBps!==undefined?{feeBps:small(options.feeBps,0,9999)}:{}),...(options.gaslessTrustline?{gaslessTrustline:options.gaslessTrustline}:{})});
   const r=await http(ctx,c,'/quote',{body:request}),native=checkedQuote(r.value,request);
   need(typeof r.exchange.text==='string','Retain the complete original quote JSON text.');
   const q=normalizedQuote(i,{provider:PROVIDER,amountIn:native.amountIn,amountOut:native.amountOut,
    route:{platform:native.platform,routePlan:native.routePlan,rawTrade:native.rawTrade},
    exchangeIds:[r.exchangeId],snapshot:{binding:c.binding,request,providerResponse:native,originalJSON:r.exchange.text,source:SOURCE}});
   // The normalized limits are independently derived from the same exact intent.
   // A provider may be stricter but must not weaken its selected limit.
   need(i.mode==='EXACT_IN'?BigInt(native.otherAmountThreshold)>=BigInt(q.minAmountOut):BigInt(native.otherAmountThreshold)<=BigInt(q.maxAmountIn),'Original provider threshold weakens the exact selected slippage limit.');
   if(i.mode==='EXACT_IN')q.minAmountOut=native.otherAmountThreshold;else q.maxAmountIn=native.otherAmountThreshold;
   q.fees.provider=native.platformFee?{status:'REPORTED',amount:native.platformFee.feeAmount,basisPoints:String(native.platformFee.feeBps),unit:'provider fee amount in original response',original:native.platformFee}:{status:'NOT_REPORTED',amount:null};
   q.priceImpact={status:typeof native.priceImpactPct==='string'?'REPORTED':'NOT_REPORTED',basisPoints:null,percentage:native.priceImpactPct??null};
   q.routeComplexity={routes:native.routePlan.length,hops:native.routePlan.map(r=>({protocol:r.swapInfo?.protocol??null,hops:Array.isArray(r.swapInfo?.path)?r.swapInfo.path.length-1:null,percent:r.percent??null}))};
   return {status:'QUOTED',provider:PROVIDER,intent:i,quotes:[q],exchangeIds:[r.exchangeId]};
  }
  if(id==='soroswap.prepare'){
   exactKeys(input,['quoteId','routeIndex'],['quoteId']);const {record:row,quote:normalized,index}=selectedQuote(ctx,input,PROVIDER),v=normalized.snapshot;
   assertBinding(ctx,PROVIDER,v.binding);const q=checkedQuote(v.providerResponse,v.request),from=wallet(sdk,ctx),to=from,options=c.p.publicConfig||{};
   need(normalized.tokenIn===q.assetIn&&normalized.tokenOut===q.assetOut&&normalized.mode===q.tradeType&&normalized.amountIn===q.amountIn&&normalized.amountOut===q.amountOut,'Original normalized quote differs from its retained provider response.');
   need(q.tradeType==='EXACT_IN'?normalized.minAmountOut===q.otherAmountThreshold:normalized.maxAmountIn===q.otherAmountThreshold,'Original normalized threshold differs from its native quote.');
   const maxFee=options.maxFeeStroops===undefined?null:integer(options.maxFeeStroops,{positive:true}),referralId=options.referralId;
   if(referralId)address(sdk,referralId);need(!q.platformFee||BigInt(q.platformFee.feeAmount)===0n||referralId,'The selected fee quote requires its configured original referral address.');
   const fields={from,to,...(referralId?{referralId}:{})};
   need(typeof v.originalJSON==='string','Keep the complete original native quote JSON.');
   const bodyText='{"quote":'+v.originalJSON+','+JSON.stringify(fields).slice(1);
   const r=await http(ctx,c,'/quote/build',{bodyText});need(typeof r.value.xdr==='string','Original build response omitted the complete transaction XDR.');
   const original=tools.inspectEnvelope({xdr:r.value.xdr,expectedSource:from});if(maxFee!==null)need(BigInt(original.fee)<=maxFee,'Original transaction fee exceeds the selected wallet limit.');
   need(!original.feeBump&&original.signatures.length===0&&original.innerSignatures.length===0,'A prepared wallet transaction must be an unsigned original inner transaction.');
   // Restrict the original unsigned envelope to the retained quote lifetime.
   const parsed=sdk.TransactionBuilder.fromXDR(r.value.xdr,c.binding.network.passphrase),expiry=BigInt(Math.floor(Date.parse(normalized.expiresAt)/1000)),now=BigInt(Math.floor(Date.parse(ctx.now)/1000));
   const minTime=BigInt(original.timeBounds?.minTime??'0'),oldMax=BigInt(original.timeBounds?.maxTime??'0'),maxTime=oldMax>0n&&oldMax<expiry?oldMax:expiry;
   need(maxTime>now&&minTime<=maxTime,'The original transaction or quote has expired.');
   const builder=sdk.TransactionBuilder.cloneFrom(parsed,{timebounds:{minTime:minTime.toString(),maxTime:maxTime.toString()}});
   const data=parsed.toEnvelope().v1().tx().ext().value();if(data)builder.setSorobanData(data);
   const bounded=builder.build(),boundedXdr=bounded.toXDR(),inspected=tools.inspectEnvelope({xdr:boundedXdr,expectedSource:from});
   let contractId=null,contractEvidence=null;
   if(q.platform!=='sdex'){const a=await http(ctx,c,'/api/'+c.network+'/'+q.platform);contractId=address(sdk,a.value.address,true);contractEvidence=a.exchangeId;const selected=c.p.contractIds?.[q.platform];if(selected)need(selected===contractId,'Current provider address differs from the selected original contract ID.');}
   const findings=swapCheck(c,q,inspected,bounded,to,contractId,ctx.now);
   let prepared={status:findings.length?'NEEDS_REVIEW':'PREPARED',unsignedPayload:{kind:'stellar-xdr',xdr:boundedXdr,transactionHash:inspected.transactionHash,networkId:c.binding.network.id,networkPassphrase:c.binding.network.passphrase,source:from},selection:inspected,exchangeIds:[]};
   if(!findings.length&&q.platform!=='sdex'){const simulated=await tools.simulateEnvelope({xdr:boundedXdr,expectedSource:from});prepared=tools.prepareSimulation(simulated);}
   if(q.platform==='sdex')await tools.verifyNetwork();
   if(prepared.selection?.fee&&maxFee!==null)need(BigInt(prepared.selection.fee)<=maxFee,'Fresh simulation fee exceeds selected limit.');
   return {...prepared,kind:'soroswap-plan',provider:PROVIDER,binding:c.binding,quoteId:row.id,quote:normalized,quoteReference:{quoteId:row.id,routeIndex:String(index)},buildResponse:r.value,originalBuildEnvelope:original,contractId,findings,
    selection:{...prepared.selection,quoteId:row.id,routeIndex:String(index),intent:normalized.selection,tokenIn:q.assetIn,tokenOut:q.assetOut,mode:q.tradeType,amountIn:q.amountIn,amountOut:q.amountOut,minAmountOut:normalized.minAmountOut,maxAmountIn:normalized.maxAmountIn,maxFeeStroops:maxFee?.toString()??null,from,to},
    expiresAt:new Date(Number(maxTime)*1000).toISOString(),exchangeIds:[...new Set([...normalized.exchangeIds,r.exchangeId,...(contractEvidence?[contractEvidence]:[]),...tools.exchangeIds()])]};
  }
  if(id==='soroswap.confirm'){
   exactKeys(input,['submissionId'],['submissionId']);const s=evidence(ctx,input.submissionId,r=>r.planId&&r.submission),p=evidence(ctx,s.planId,r=>r.actionId==='soroswap.prepare');assertBinding(ctx,PROVIDER,p.value.binding);const payload=p.unsignedPayload||p.value.unsignedPayload;
   need(payload&&s.submission.transactionHash,'Original selected plan and wallet submission are required.');
   const result=await tools.confirm({transactionHash:s.submission.transactionHash,signedXdr:s.submission.signedXdr||s.submission.xdr,expectedSource:payload.source});
   if(result.observed)need(result.observed.innerTransactionHash===payload.transactionHash,'Confirmed transaction does not match the selected original prepared plan.');
   return {...result,kind:'soroswap-confirmation',submissionId:s.id,planId:p.id,quoteId:p.value.quoteId};
  }
  throw new Error('Unsupported Soroswap action: '+id);
 }
 return {catalogue,execute};
}

import { createHash, randomUUID } from 'node:crypto';

export const VERSION = 'stellar-forge.rozo-payments.v1';
export const PROFILE_TYPES = ['merchant-key-v2','checkout-mpp-0.1.21','intent-common-0.1.43','rozo-testnet-v1'];
export const STELLAR_TYPES = ['rozo-payment-v1','rozo-forwarder-v2','rozo-intent-bridge-v2'];
export const PAYMENT_STATUSES = ['payment_unpaid','payment_started','payment_payin_completed','payment_payout_completed','payment_completed','payment_bounced','payment_expired','payment_refunded'];
export const TERMINAL_STATUSES = new Set(['payment_payout_completed','payment_completed','payment_bounced','payment_expired','payment_refunded']);

export class RozoError extends Error {
  constructor(code,message,status=400,details={}) { super(message); this.name='RozoError'; this.code=code; this.status=status; this.details=details; }
}
export function fail(code,message,status=400,details={}) { throw new RozoError(code,message,status,details); }
export function assert(ok,code,message,status=400,details={}) { if(!ok) fail(code,message,status,details); }
export function canonical(value) {
  if(value===null || typeof value==='boolean' || typeof value==='string') return JSON.stringify(value);
  if(typeof value==='number') { assert(Number.isFinite(value),'INVALID_NUMBER','JSON numbers must be finite; monetary amounts use exact decimal strings.'); return JSON.stringify(value); }
  if(Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  assert(value && typeof value==='object' && Object.getPrototypeOf(value)===Object.prototype,'INVALID_JSON','Use ordinary JSON values.');
  return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
}
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export const jsonDigest = value => digest(Buffer.from(canonical(value),'utf8'));
export const clone = value => JSON.parse(JSON.stringify(value));
export const newId = prefix => prefix+'-'+randomUUID();
export function text(value,name,max=200) {
  assert(typeof value==='string' && value.trim().length>0 && value.length<=max && !/[\u0000-\u001f]/.test(value),'INVALID_FIELD',name+' must be nonempty text without control characters.');
  return value;
}
export function id(value,name='id') { text(value,name,160); assert(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(value),'INVALID_ID',name+' uses letters, numbers, dot, colon, underscore or hyphen.'); return value; }
export function iso(value,name='timestamp') { text(value,name,40); const time=Date.parse(value); assert(Number.isFinite(time),'INVALID_DATE',name+' must be an ISO timestamp.'); return new Date(time).toISOString(); }
export function own(value,key) { return Object.prototype.hasOwnProperty.call(value,key); }
export function object(value,name='value') { assert(value && typeof value==='object' && !Array.isArray(value),'INVALID_OBJECT',name+' must be an object.'); return value; }
export function fields(value,allowed,name='value') { object(value,name); for(const key of Object.keys(value)) assert(allowed.includes(key),'UNKNOWN_FIELD',name+' contains unsupported field '+key); return value; }
export function sha(value,name='sha256') { assert(typeof value==='string' && /^[a-f0-9]{64}$/.test(value),'INVALID_HASH',name+' must be a lowercase SHA-256.'); return value; }
export function integer(value,name,min=0,max=Number.MAX_SAFE_INTEGER) { assert(Number.isSafeInteger(value) && value>=min && value<=max,'INVALID_INTEGER',name+' is outside its allowed integer range.'); return value; }
export function safeUrl(value,name,{loopback=false}={}) {
  text(value,name,2048); let url;try{url=new URL(value);}catch{fail('INVALID_URL',name+' must be an absolute URL.');}
  assert(!url.username && !url.password && !url.hash,'INVALID_URL',name+' cannot contain user information or a fragment.');
  assert(url.protocol==='https:' || (loopback && url.protocol==='http:' && ['127.0.0.1','localhost','[::1]'].includes(url.hostname)),'INVALID_URL',name+' requires HTTPS (HTTP is available only for an explicitly configured local receiver).');
  return url.href.replace(/\/$/,'');
}
export function amountUnits(value,decimals,{signed=false}={}) {
  integer(decimals,'asset decimals',0,36);
  assert(typeof value==='string' && (signed?/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/:/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/).test(value),'INVALID_AMOUNT','Amounts must be exact decimal strings without exponent notation.');
  const negative=value.startsWith('-'),[whole,fraction='']=(negative?value.slice(1):value).split('.');
  assert(fraction.length<=decimals || /^0*$/.test(fraction.slice(decimals)),'AMOUNT_PRECISION','Amount has nonzero digits beyond the selected asset precision.');
  const units=BigInt(whole)*10n**BigInt(decimals)+BigInt((fraction.slice(0,decimals)+'0'.repeat(decimals)).slice(0,decimals)||'0');
  return negative?-units:units;
}
export function formatUnits(value,decimals) {
  const n=BigInt(value),negative=n<0n,absolute=negative?-n:n,power=10n**BigInt(decimals);
  return (negative?'-':'')+(absolute/power).toString()+(decimals?'.'+(absolute%power).toString().padStart(decimals,'0'):'');
}
export function decimal(value,name='amount') { assert(typeof value==='string' && /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value),'INVALID_AMOUNT',name+' must be an exact nonnegative decimal string.'); return value; }
export function validateAsset(asset) {
  fields(asset,['chainId','network','tokenSymbol','tokenAddress','decimals'],'asset');
  text(asset.chainId,'chainId',80);text(asset.network,'actual network',300);text(asset.tokenSymbol,'tokenSymbol',40);
  text(asset.tokenAddress,'tokenAddress or native asset sentinel',200);integer(asset.decimals,'decimals',0,36);
  return clone(asset);
}
export function assetKey(asset) { return [asset.chainId,asset.network,asset.tokenAddress,asset.decimals].map(String).join('|'); }
export function findAsset(profile,side) {
  if(!side || side.chainId===undefined) return null;
  const candidates=profile.assets.filter(a=>a.chainId===String(side.chainId) && (side.tokenAddress?a.tokenAddress===side.tokenAddress:a.tokenSymbol===side.tokenSymbol));
  return candidates.length===1?candidates[0]:null;
}
export function measured(profile,side,field) {
  if(side?.[field]===null || side?.[field]===undefined) return null;
  const raw=side[field],asset=findAsset(profile,side);
  if(!asset) return {raw,units:null,asset:null,issue:'asset_precision_unselected'};
  try{return {raw,units:amountUnits(raw,asset.decimals).toString(),asset,issue:null};}catch(error){return {raw,units:null,asset,issue:error.code};}
}
export function validateProfile(value) {
  fields(value,['id','label','type','connection','appId','assets','wallet','stellar','notes'],'profile');
  id(value.id,'profile id');text(value.label,'profile label');assert(PROFILE_TYPES.includes(value.type),'INVALID_PROFILE','Select an original provider profile.');
  id(value.connection,'host connection alias');
  if(value.type==='merchant-key-v2') text(value.appId,'observed merchant appId');
  else if(value.appId!==undefined && value.appId!==null) text(value.appId,'appId');
  assert(Array.isArray(value.assets) && value.assets.length>0 && value.assets.length<=200,'INVALID_ASSETS','Select actual network and precision for each used asset.');
  const assets=value.assets.map(validateAsset),keys=assets.map(assetKey);
  assert(new Set(keys).size===keys.length,'DUPLICATE_ASSET','Asset definitions must be unique.');
  if(value.wallet){fields(value.wallet,['chainId','network','tokenAddress','address','memo','sourceRef'],'wallet');for(const k of ['chainId','network','tokenAddress','address','sourceRef'])text(value.wallet[k],'wallet '+k,1024);if(value.wallet.memo!==undefined && value.wallet.memo!==null)text(value.wallet.memo,'wallet memo');}
  if(value.stellar){fields(value.stellar,['profile','connection','networkPassphrase','contractId','startLedger'],'Stellar source');assert(STELLAR_TYPES.includes(value.stellar.profile),'INVALID_STELLAR_PROFILE','Select the deployed original Stellar contract profile.');id(value.stellar.connection,'Stellar connection');text(value.stellar.networkPassphrase,'network passphrase',300);assert(/^C[A-Z2-7]{55}$/.test(value.stellar.contractId),'INVALID_CONTRACT','Select the original Soroban contract ID.');integer(value.stellar.startLedger,'first ledger',1);}
  if(value.notes!==undefined)text(value.notes,'profile notes',4000);
  return {...clone(value),assets};
}
export function validateOrder(value,profile) {
  fields(value,['id','profileId','orderId','title','source','expectedDestination','fulfilmentRef','checkout','notes'],'order');
  id(value.id,'internal order id');assert(value.profileId===profile.id,'PROFILE_MISMATCH','The order must bind the selected profile.');
  text(value.orderId,'original orderId');text(value.title,'order title',300);
  object(value.source,'source');
  for(const key of ['chainId','tokenSymbol','amount'])text(value.source[key],'source '+key,200);
  fields(value.source,['chainId','tokenSymbol','amount'],'source');
  decimal(value.source.amount);assert(BigInt(value.source.amount.replace('.',''))>0n,'INVALID_AMOUNT','The expected source amount must be positive.');
  const a=findAsset(profile,value.source);assert(a,'ASSET_UNSELECTED','Select one actual network/asset precision before saving this order.');amountUnits(value.source.amount,a.decimals);
  if(value.expectedDestination){fields(value.expectedDestination,['chainId','tokenSymbol','tokenAddress','amount','receiverAddress','receiverMemo'],'expectedDestination');if(value.expectedDestination.amount!==undefined)decimal(value.expectedDestination.amount);if(value.expectedDestination.receiverMemo!==undefined && value.expectedDestination.receiverMemo!==null)text(value.expectedDestination.receiverMemo,'destination memo');}
  if(profile.type==='checkout-mpp-0.1.21'){
    fields(value.checkout,['url','provider','email','utmSource'],'Checkout');
    text(value.checkout.url,'original invoice URL or link ID',2048);
    assert(!value.checkout.provider || value.checkout.provider==='coinbase','CHECKOUT_PROFILE','This order form selects the native Coinbase MPP creation flow. Existing Bitrefill orders can be attached and inspected without recreating them.');
    if(value.checkout.email)assert(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.checkout.email),'INVALID_EMAIL','Use the original payer contact email.');
  } else assert(!value.checkout,'INVALID_PROFILE','Checkout inputs belong to the Checkout MPP profile.');
  if(value.fulfilmentRef)text(value.fulfilmentRef,'fulfilment reference',1024);
  if(value.notes)text(value.notes,'order notes',4000);
  return clone(value);
}
export function merchantCreateBody(profile,order) {
  assert(profile.type==='merchant-key-v2','INVALID_PROFILE','Keyed merchant creation is a separate profile.');
  return {type:'exactIn',orderId:order.orderId,display:{name:order.title},source:clone(order.source)};
}
export function validatePayment(profile,payment,{paymentId,orderId}={}) {
  object(payment,'original payment');text(payment.id,'provider payment id');
  if(paymentId)assert(payment.id===paymentId,'PAYMENT_IDENTITY','Provider returned another payment.',409);
  if(profile.type==='merchant-key-v2')assert(payment.appId===profile.appId,'MERCHANT_IDENTITY','The selected key returned another appId; rebind the original connection.',409);
  if(orderId!==undefined)assert(payment.orderId===orderId,'ORDER_IDENTITY','Provider returned another original orderId.',409);
  return payment;
}
export function paymentIdentity(profile,payment) { return profile.id+':'+payment.id; }
export function paymentDate(payment) { const time=Date.parse(payment.updatedAt||payment.createdAt||'');return Number.isFinite(time)?time:null; }
export function selectPayment(observations) {
  const full=observations.filter(o=>o.kind==='payment' && o.value?.id);
  if(!full.length)return {observation:null,issues:[]};
  const dated=full.filter(o=>paymentDate(o.value)!==null);
  const cohort=dated.length?dated:full;
  cohort.sort((a,b)=>(paymentDate(b.value)??0)-(paymentDate(a.value)??0) || b.sequence-a.sequence);
  const selected=cohort[0],issues=[];
  const same=cohort.filter(o=>(paymentDate(o.value)??0)===(paymentDate(selected.value)??0));
  if(new Set(same.map(o=>jsonDigest(o.value))).size>1)issues.push('same_provider_time_changed');
  if(!dated.length)issues.push('provider_time_missing');
  return {observation:selected,issues};
}
function expectedDiff(expected,actual,prefix,issues,profile) {
  if(!expected)return;
  for(const [key,value]of Object.entries(expected)){
    if(value===undefined || value===null)continue;
    if(key==='amount'){
      const asset=findAsset(profile,actual??expected);
      if(asset){try{if(amountUnits(String(actual?.[key]),asset.decimals)===amountUnits(String(value),asset.decimals))continue;}catch{}}
    }
    if(String(actual?.[key]??'')!==String(value))issues.push(prefix+'.'+key+'_differs');
  }
}
export function settlementRow({profile,order=null,paymentId,observations,decisions=[]}) {
  const selected=selectPayment(observations),obs=selected.observation,p=obs?.value||{},issues=[...selected.issues];
  if(!obs)issues.push('full_payment_missing');
  if(p.status && !PAYMENT_STATUSES.includes(p.status))issues.push('unknown_provider_status');
  if(profile.type==='merchant-key-v2' && p.appId && p.appId!==profile.appId)issues.push('merchant_app_differs');
  const source=measured(profile,p.source,'amount'),received=measured(profile,p.source,'amountReceived'),fee=measured(profile,p.source,'fee'),destination=measured(profile,p.destination,'amount');
  for(const pair of [['source',source],['received',received],['fee',fee],['destination',destination]])if(pair[1]?.issue)issues.push(pair[0]+'.'+pair[1].issue);
  if(source?.units && received?.units && BigInt(source.units)!==BigInt(received.units))issues.push('source_amount_differs');
  if(order){
    expectedDiff(order.source,p.source,'order_source',issues,profile);
    expectedDiff(order.expectedDestination,p.destination,'order_destination',issues,profile);
    if(profile.type==='merchant-key-v2' && p.orderId!==order.orderId)issues.push('order_id_differs');
  }else issues.push('order_unmatched');
  if(profile.wallet && p.destination){
    if(profile.wallet.chainId!==String(p.destination.chainId) || profile.wallet.address!==p.destination.receiverAddress || profile.wallet.tokenAddress!==p.destination.tokenAddress || (profile.wallet.memo??null)!==(p.destination.receiverMemo??null))issues.push('merchant_wallet_differs');
  }
  const sourceConfirmed=Boolean(p.source?.txHash && p.source?.confirmedAt),payoutConfirmed=Boolean(p.destination?.txHash && p.destination?.confirmedAt);
  const callback=observations.filter(o=>o.kind==='callback');
  if(callback.length && !obs)issues.push('callback_requires_full_refresh');
  if(callback.some(o=>paymentDate(o.value?.data??{})>(paymentDate(p)??0)))issues.push('callback_newer_than_payment');
  if(['payment_bounced','payment_refunded'].includes(p.status))issues.push(p.status);
  if(p.status==='payment_expired' && (sourceConfirmed || p.source?.txHash || (received?.units && BigInt(received.units)>0n)))issues.push('expired_after_source_payment');
  if(['payment_payout_completed','payment_completed'].includes(p.status) && !payoutConfirmed)issues.push('payout_proof_fields_missing');
  const receipt=observations.filter(o=>o.kind==='checkout_receipt').sort((a,b)=>b.sequence-a.sequence)[0];
  const superseded=new Set(decisions.map(d=>d.supersedes).filter(Boolean));
  const active=decisions.filter(d=>!superseded.has(d.id));
  const delivery=active.filter(d=>d.kind==='fulfilment').sort((a,b)=>b.revision-a.revision)[0]??null;
  const currentDecisions=active.filter(d=>d.basisSha256===obs?.sha256 || d.kind==='fulfilment');
  const dismissed=new Set(currentDecisions.filter(d=>d.kind==='accepted_variance').flatMap(d=>d.issues||[]));
  const unresolved=[...new Set(issues)].filter(v=>!dismissed.has(v));
  if(active.some(d=>!['fulfilment','reopen'].includes(d.kind) && d.basisSha256!==obs?.sha256))unresolved.push('decision_basis_changed');
  return {
    profileId:profile.id,appId:p.appId??profile.appId??null,orderId:p.orderId??order?.orderId??null,internalOrderId:order?.id??null,paymentId,
    status:p.status??'unobserved',providerUpdatedAt:p.updatedAt??null,sourceTime:obs?.recordedAt??null,sourceObservationId:obs?.id??null,sourceSha256:obs?.sha256??null,
    expectedSource:source,receivedSource:received,sourceFee:fee,destinationAmount:destination,
    sourcePayment:{state:sourceConfirmed?'provider_confirmed':p.source?.txHash?'detected':'unobserved',txHash:p.source?.txHash??null,confirmedAt:p.source?.confirmedAt??null,chainId:p.source?.chainId??null,address:p.source?.receiverAddress??null,memo:p.source?.receiverMemo??null},
    destinationPayout:{state:payoutConfirmed?'provider_confirmed':'unobserved',txHash:p.destination?.txHash??null,confirmedAt:p.destination?.confirmedAt??null,chainId:p.destination?.chainId??null,address:p.destination?.receiverAddress??null,memo:p.destination?.receiverMemo??null},
    merchantSettlement:profile.type==='checkout-mpp-0.1.21'?{state:receipt?.value?.receipt?.merchantSettlement?.status??receipt?.value?.snapshot?.state??'unobserved',originalReceiptId:receipt?.id??null,receipt:receipt?.value?.receipt??null}:{state:payoutConfirmed && ['payment_payout_completed','payment_completed'].includes(p.status)?'provider_confirmed':'unobserved'},
    fulfilment:delivery?{state:delivery.value.state,reference:delivery.value.reference,actor:delivery.actor,decisionId:delivery.id}:{state:'unobserved'},
    issues:[...new Set(issues)],unresolved:[...new Set(unresolved)],decisions:decisions.map(d=>({id:d.id,revision:d.revision,kind:d.kind,reason:d.reason,actor:d.actor,basisSha256:d.basisSha256,current:!superseded.has(d.id)&&(d.kind==='fulfilment'||d.basisSha256===obs?.sha256),superseded:superseded.has(d.id),supersedes:d.supersedes??null})),
    callbackCount:callback.length,observationCount:observations.length,createdAt:p.createdAt??null
  };
}
export function validateDecision(value,row) {
  fields(value,['id','profileId','paymentId','kind','basisSha256','issues','reason','value','supersedes'],'decision');
  id(value.id);assert(value.profileId===row.profileId && value.paymentId===row.paymentId,'DECISION_IDENTITY','Select the original profile/payment.');
  assert(['accepted_variance','provider_review','fulfilment','reopen'].includes(value.kind),'DECISION_KIND','Select an explained decision.');
  sha(value.basisSha256);assert(value.basisSha256===row.sourceSha256,'STALE_DECISION','Refresh the original payment before reviewing it.',409);
  text(value.reason,'reason',4000);
  if(value.kind==='accepted_variance'){assert(Array.isArray(value.issues)&&value.issues.length>0,'INVALID_ISSUES','Select the exact differences you reviewed.');for(const issue of value.issues)assert(row.issues.includes(issue),'ISSUE_CHANGED','A selected difference no longer belongs to this source.',409);}
  if(value.kind==='fulfilment'){fields(value.value,['state','reference'],'fulfilment');assert(['pending','delivered','failed','cancelled'].includes(value.value.state),'FULFILMENT_STATE','Select an observed fulfilment state.');text(value.value.reference,'fulfilment source reference',2000);}
  if(value.kind==='reopen')id(value.supersedes,'decision to reopen');
  if(value.supersedes!==undefined && value.supersedes!==null)id(value.supersedes,'superseded decision');
  return clone(value);
}
export function reportTotals(rows) {
  const groups={};
  for(const row of rows)for(const [name,m]of [['receivedSource',row.receivedSource],['sourceFee',row.sourceFee],['destinationAmount',row.destinationAmount]]){
    if(!m?.asset || m.units===null)continue;
    const key=assetKey(m.asset);groups[key]??={asset:m.asset,receivedSource:'0',sourceFee:'0',destinationAmount:'0'};
    groups[key][name]=(BigInt(groups[key][name])+BigInt(m.units)).toString();
  }
  return Object.values(groups).map(g=>({...g,formatted:Object.fromEntries(['receivedSource','sourceFee','destinationAmount'].map(k=>[k,formatUnits(g[k],g.asset.decimals)]))}));
}
export function compareReports(before,after) {
  assert(before.profileId===after.profileId,'REPORT_PROFILE','Compare reports for the same merchant profile.');
  const a=new Map(before.rows.map(x=>[x.paymentId,x])),b=new Map(after.rows.map(x=>[x.paymentId,x])),changes=[];
  for(const key of new Set([...a.keys(),...b.keys()]))if(canonical(a.get(key)??null)!==canonical(b.get(key)??null))changes.push({paymentId:key,before:a.get(key)??null,after:b.get(key)??null});
  return {schema:VERSION+'.report-comparison',baselineId:before.id,followingId:after.id,baselinePeriod:before.period,followingPeriod:after.period,changes};
}

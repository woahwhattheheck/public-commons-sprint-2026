/**
 * SF19: secretless x402 Stellar signing boundary for embedding operators.
 * NO wallet, key, vault credential, HTTP, RPC, settlement or chain finality here.
 * The host must independently supply authorization and an isolated signer.
 * Persistent replay and fee sponsorship are separate SF18 / SF17 concerns.
 */
const fail=(code)=>{const e=new Error(code);e.code=code;throw e;};
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)
 &&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null);
const text=v=>typeof v==='string'&&v.length>0&&v.length<=2048&&!/[\x00-\x1f\x7f]/.test(v);
const decimal=v=>typeof v==='string'&&/^(0|[1-9][0-9]*)$/.test(v)&&v.length<=40;
function origin(value){
 if(!text(value))fail('ORIGIN_INVALID');
 let u;try{u=new URL(value);}catch{fail('ORIGIN_INVALID');}
 const host=u.hostname.toLowerCase();
 if(u.protocol!=='https:'||u.username||u.password||u.hash||
  host==='localhost'||host.endsWith('.local')||host.endsWith('.internal')||
  host.endsWith('.home.arpa')||host.includes(':')||
  /^\d+(?:\.\d+){3}$/.test(host))fail('ORIGIN_INVALID');
 return u.origin;
}
const num=(v)=>{if(!decimal(v))fail('AMOUNT_INVALID');return BigInt(v);};
const mandatory=['quoteId','actor','resourceUrl','method','scheme','network','asset','payTo','amount','expiresAt'];
function verifyFields(raw,keys){
 if(!plain(raw)||Object.keys(raw).length!==keys.length||
  !keys.every(k=>Object.hasOwn(raw,k)))fail('UNEXPECTED_FIELDS');
}
function rejectSecrets(value,depth=0){
 if(depth>8||!plain(value))fail('SIGNER_ENVELOPE_INVALID');
 for(const [k,v] of Object.entries(value)){
  if(/private.?key|secret|seed|password|mnemonic|bearer|access.?token/i.test(k))
   fail('SIGNER_ENVELOPE_SECRET_FIELD');
  if(typeof v==='number'&&!Number.isFinite(v))fail('SIGNER_ENVELOPE_INVALID');
  if(typeof v==='string'&&v.length>32768)fail('SIGNER_ENVELOPE_INVALID');
  if(plain(v))rejectSecrets(v,depth+1);
  if(Array.isArray(v)){
   if(v.length>200)fail('SIGNER_ENVELOPE_INVALID');
   for(const x of v)if(plain(x))rejectSecrets(x,depth+1);
  }
 }
}
export class SecretlessSignerBoundary {
 #actors;#origins;#assets;#approve;#sign;#clock;
 #seen=new Set();#revoked=false;#maxEntries;#ttl;
 constructor({actors,allowedOrigins,assetPolicies,approve,sign=null,clock=Date.now,
  maxEntries=2048,maxTtlMs=300000}={}){
  if(!Array.isArray(actors)||!actors.length||actors.some(x=>!text(x))||
   !Array.isArray(allowedOrigins)||!allowedOrigins.length||
   !plain(assetPolicies)||!Object.keys(assetPolicies).length||
   typeof approve!=='function'||(sign!==null&&typeof sign!=='function')||
   typeof clock!=='function'||!Number.isSafeInteger(maxEntries)||maxEntries<1||
   !Number.isSafeInteger(maxTtlMs)||maxTtlMs<1||maxTtlMs>3600000)
   throw new TypeError('Explicit host policies and independent approval callback required');
  this.#actors=new Set(actors);
  this.#origins=new Set(allowedOrigins.map(s=>{
   const u=new URL(s);
   if(origin(s)!==s||u.pathname!=='/'||u.search||u.hash)
    throw new TypeError('Configured origins must be exact HTTPS origins');
   return s;
  }));
  this.#assets=new Map();
  for(const [asset,p] of Object.entries(assetPolicies)){
   if(!text(asset)||!plain(p)||!['stellar:testnet','stellar:pubnet'].includes(p.network)||
    !Array.isArray(p.payTo)||!p.payTo.length||p.payTo.some(x=>!text(x)))
    throw new TypeError('Invalid asset authority');
   const limit=num(p.maxBaseUnits);
   if(limit===0n)throw new TypeError('Positive base-unit max required');
   this.#assets.set(asset,{network:p.network,allowedPayTo:new Set(p.payTo),limit});
  }
  this.#approve=approve;this.#sign=sign;this.#clock=clock;
  this.#maxEntries=maxEntries;this.#ttl=maxTtlMs;
 }
 revoke(){this.#revoked=true;}
 get readiness(){return {revoked:this.#revoked,approvalAttached:true,
  externalSignerAttached:!!this.#sign,holdsSecrets:false,
  persistentIdempotencyAttached:false};}
 async authorizeAndSign(input){
  // No request-owned 'approved' field and no caller-specified signer callback.
  verifyFields(input,mandatory);
  const {quoteId,actor,resourceUrl,method,scheme,network,asset,payTo,amount,expiresAt}=input;
  if(!text(quoteId)||quoteId.length>128||!text(actor)||actor.length>128||
   !text(resourceUrl)||!text(asset)||!text(payTo)||
   method!=='GET'||scheme!=='exact'||
   !['stellar:testnet','stellar:pubnet'].includes(network)||
   !Number.isSafeInteger(expiresAt))fail('QUOTE_INVALID');
  if(this.#revoked)fail('CUSTODY_REVOKED');
  if(!this.#actors.has(actor))fail('ACTOR_NOT_AUTHORIZED');
  if(!this.#origins.has(origin(resourceUrl)))fail('ORIGIN_NOT_AUTHORIZED');
  const terms=this.#assets.get(asset);
  if(!terms||terms.network!==network||!terms.allowedPayTo.has(payTo))
   fail('PAYMENT_TERMS_NOT_ALLOWED');
  if(num(amount)>terms.limit)fail('SPEND_CAP_EXCEEDED');
  const at=this.#clock();
  if(!Number.isSafeInteger(at)||expiresAt<=at||expiresAt-at>this.#ttl)
   fail('QUOTE_EXPIRED_OR_UNBOUNDED');
  if(!this.#sign)fail('SIGNER_NOT_CONNECTED');
  if(this.#seen.has(quoteId))fail('QUOTE_ALREADY_SEEN');
  if(this.#seen.size>=this.#maxEntries)fail('IDEMPOTENCY_CAPACITY_EXHAUSTED');
  // Synchronous reservation before the first await prevents concurrent approval.
  this.#seen.add(quoteId);
  const quote=Object.freeze({quoteId,actor,resourceUrl,method,scheme,network,
   asset,payTo,amount,expiresAt});
  let granted;
  try{granted=await this.#approve(quote);}catch{fail('APPROVAL_UNAVAILABLE');}
  if(this.#revoked)fail('CUSTODY_REVOKED');
  if(this.#clock()>=expiresAt)fail('QUOTE_EXPIRED_OR_UNBOUNDED');
  if(granted!==true)fail('APPROVAL_REQUIRED');
  let signed;
  try{signed=await this.#sign(quote);}catch{fail('SIGNER_FAILED');}
  if(!plain(signed)||signed.x402Version!==2||!plain(signed.resource)||
   signed.resource.url!==resourceUrl||!plain(signed.accepted)||
   !['scheme','network','asset','amount','payTo'].every(k=>signed.accepted[k]===quote[k])||
   !plain(signed.payload)||
   Object.keys(signed).some(k=>!['x402Version','resource','accepted','payload'].includes(k)))
   fail('SIGNER_ENVELOPE_MISMATCH');
  rejectSecrets(signed);
  return {status:'SIGNED_ONLY_NOT_SETTLED',payment:structuredClone(signed),
   audit:{quoteId,network,status:'SIGNED_ONLY',settled:false}};
 }
}

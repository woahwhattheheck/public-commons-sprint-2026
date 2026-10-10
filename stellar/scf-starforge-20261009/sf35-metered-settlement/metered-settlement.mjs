// MIT License. SCF SF-35: meter on the resource server, settle once through an
// injected, real x402 Stellar facilitator. No wallet keys or transaction signer.
// Source contract: x402-foundation/x402 PR3134 head aa268ec9 (2026-09-11),
// spec schemes/upto/scheme_upto_stellar.md. Stateless UptoSettlement profile.
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';

const I128_MAX = (1n << 127n) - 1n;
const NETWORKS = new Set(['stellar:testnet', 'stellar:pubnet']);
const canonical = x => typeof x === 'string' && /^(0|[1-9][0-9]*)$/.test(x);
const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const snap = x => JSON.parse(JSON.stringify(x));
const hash = x => createHash('sha256').update(x).digest('hex');
function amount(x, name, {allowZero=true}={}) {
  if (!canonical(x)) throw new MeterError('INVALID_ATOMIC', name);
  const n=BigInt(x);
  if (n>I128_MAX || (!allowZero && n===0n)) throw new MeterError('AMOUNT_OUT_OF_RANGE',name);
  return n;
}
function integer(x,name,{min=0}={}) {
  if (!Number.isSafeInteger(x) || x<min) throw new MeterError('INVALID_INTEGER',name);
  return x;
}
function nonempty(x,name) {
  if (typeof x!=='string' || !x.trim() || x.length>2048) throw new MeterError('INVALID_FIELD',name);
  return x;
}
function canonicalTerms(x) {
  if(!plain(x) || x.scheme!=='upto' || !NETWORKS.has(x.network) || !plain(x.extra))
    throw new MeterError('UNSUPPORTED_UPTO_WIRE');
  amount(x.amount,'ceiling',{allowZero:false});
  for(const k of ['payTo','asset']) nonempty(x[k],k);
  integer(x.maxTimeoutSeconds,'maxTimeoutSeconds',{min:1});
  if(x.maxTimeoutSeconds>86400)throw new MeterError('UNSAFE_TIMEOUT');
  if(x.extra.areFeesSponsored!==true)throw new MeterError('FEE_SPONSORSHIP_REQUIRED');
  nonempty(x.extra.settlementContract,'settlementContract');
  if(x.extra.uptoProfile!==undefined && x.extra.uptoProfile!=='stateless')
    throw new MeterError('UPTO_PROFILE_UNSUPPORTED');
  return x;
}
function identicalTerms(a,b) {
  for(const k of ['scheme','network','payTo','asset','amount','maxTimeoutSeconds'])
    if(a[k]!==b[k])throw new MeterError('PAYMENT_TERMS_DRIFT',k);
  if(a.extra.settlementContract!==b.extra.settlementContract ||
     a.extra.uptoProfile!==b.extra.uptoProfile ||
     a.extra.areFeesSponsored!==b.extra.areFeesSponsored)
    throw new MeterError('SETTLEMENT_CONTRACT_DRIFT');
}
function inputCheck({paymentRequired,paymentPayload,verifyRequirements,registry,price,mode}) {
  if(paymentRequired?.x402Version!==2 || paymentPayload?.x402Version!==2 ||
     !Array.isArray(paymentRequired.accepts) || paymentRequired.accepts.length<1 ||
     !plain(paymentPayload.accepted) || !plain(paymentPayload.payload))
    throw new MeterError('X402_V2_ENVELOPE_REQUIRED');
  const accepted=canonicalTerms(paymentPayload.accepted);
  const offered=paymentRequired.accepts.filter(o=>{
    try { canonicalTerms(o); identicalTerms(o,accepted); return true; }catch{return false;}
  });
  if(offered.length!==1)throw new MeterError('OFFER_NOT_UNIQUE_OR_MISSING');
  canonicalTerms(verifyRequirements);identicalTerms(accepted,verifyRequirements);
  const pinned=registry?.[accepted.network]?.stateless?.settlementContract;
  if(typeof pinned!=='string' || pinned!==accepted.extra.settlementContract)
    throw new MeterError('TRUSTED_CONTRACT_MISMATCH');
  const p=paymentPayload.payload;
  for(const k of ['from','payTo','asset','salt']) nonempty(p[k],k);
  if(p.payTo!==accepted.payTo || p.asset!==accepted.asset ||
     amount(p.maxAmount,'payload.maxAmount')!==amount(accepted.amount,'accepted.amount'))
    throw new MeterError('SIGNED_CEILING_OR_RECIPIENT_DRIFT');
  integer(p.validAfter,'validAfter');integer(p.deadline,'deadline',{min:1});
  integer(p.expirationLedger,'expirationLedger',{min:1});
  if(p.deadline<=p.validAfter)throw new MeterError('INVALID_TIME_WINDOW');
  if(p.autoRevoke!==true)throw new MeterError('AUTO_REVOKE_REQUIRED');
  if(!Array.isArray(p.authEntries) || p.authEntries.length!==1 ||
     typeof p.authEntries[0]!=='string' || !p.authEntries[0].trim())
    throw new MeterError('ONE_SIGNED_AUTH_ENTRY_REQUIRED');
  if(!plain(price) || !['bytes','units'].includes(mode))throw new MeterError('INVALID_METER_CONFIGURATION');
  const numerator=amount(price.numerator,'price.numerator',{allowZero:false});
  const denominator=amount(price.denominator,'price.denominator',{allowZero:false});
  // Pricing is trusted server configuration, not a payer or caller supplied field.
  return {accepted,p,maximum:amount(accepted.amount,'maximum'),numerator,denominator};
}
function charge(units,numerator,denominator) {return (units*numerator+denominator-1n)/denominator;}
function eventDigest(events) {return hash(JSON.stringify(events));}
async function replaceAtomic(path,obj){
  const temp=path+'.'+randomUUID()+'.tmp';
  try {
    const h=await open(temp,'wx',0o600);
    try {await h.writeFile(JSON.stringify(obj,null,2)+'\n');await h.sync();}
    finally {await h.close();}
    await rename(temp,path);
  } catch(e) {await rm(temp,{force:true}).catch(()=>{});throw e;}
}
function verifyResult(result) {
  if(!plain(result) || result.isValid!==true)throw new MeterError('UPSTREAM_VERIFY_DENIED');
  // The real upstream adapter is responsible for XDR parsing, signatures,
  // enforcing simulation, nonce/ledger validity, and authentic verification.
}
export class MeterError extends Error {
  constructor(code,detail=''){super(code+(detail?': '+detail:''));this.name='MeterError';this.code=code;}
}

export class MeteredUptoSettlement {
  #file; #state; #wire; #quote; #busy=false;
  constructor(file,state,wire,quote){this.#file=file;this.#state=state;this.#wire=wire;this.#quote=quote;}
  get id(){return this.#state.id;}
  get status(){return this.#state.status;}
  get tally(){return {units:this.#state.units,chargeAtomic:this.#state.chargeAtomic,ceilingAtomic:this.#state.maxAtomic};}
  get receipt(){return snap({id:this.id,status:this.status,network:this.#state.network,
    source:this.#state.resource,price:this.#state.price,units:this.#state.units,
    amount:this.#state.chargeAtomic,ceiling:this.#state.maxAtomic,
    usageDigest:this.#state.usageDigest??null,transaction:this.#state.transaction??null,
    ledgerProof:this.#state.ledgerProof??null,finality:this.status==='LEDGER_CONFIRMED'});}
  async #commit(update){
    // The on-disk journal is authoritative. Never expose a transition that failed to persist.
    const next={...this.#state,...update};
    await replaceAtomic(this.#file,next);
    this.#state=next;
  }
  async #exclusive(fn){
    if(this.#busy)throw new MeterError('CONCURRENT_SESSION_MUTATION');
    this.#busy=true;try{return await fn();}finally{this.#busy=false;}
  }
  static async open({journalDir,paymentRequired,paymentPayload,verifyRequirements,
    registry,price,mode='bytes',verifyPayment}) {
    if(typeof verifyPayment!=='function')throw new MeterError('VERIFIER_REQUIRED');
    const wire=snap({paymentRequired,paymentPayload,verifyRequirements});
    const q=inputCheck({...wire,registry,price,mode});
    const now=Math.floor(Date.now()/1000);
    if(now<q.p.validAfter || now>=q.p.deadline)throw new MeterError('TIME_WINDOW_NOT_ACTIVE');
    nonempty(paymentRequired.resource?.url,'resource.url');
    if(typeof journalDir!=='string'||!journalDir.trim())throw new MeterError('JOURNAL_DIR_REQUIRED');
    await mkdir(journalDir,{recursive:true,mode:0o700});
    // Signed authorization entry is the unique one-use identity. A different
    // merchant cannot reopen the same signed entry with a changed request ID.
    const id=hash(q.p.authEntries[0]);
    const file=join(journalDir,id+'.json');
    const s={version:1,id,status:'RESERVED',network:q.accepted.network,
      resource:paymentRequired.resource.url,from:q.p.from,payTo:q.p.payTo,
      asset:q.p.asset,contract:q.accepted.extra.settlementContract,salt:q.p.salt,
      maxAtomic:q.maximum.toString(),price:{numerator:q.numerator.toString(),denominator:q.denominator.toString(),mode},
      units:'0',chargeAtomic:'0',events:[],authorizationDigest:hash(JSON.stringify(wire.paymentPayload))};
    let h;
    try{h=await open(file,'wx',0o600);}catch(e){
      if(e.code==='EEXIST')throw new MeterError('AUTHORIZATION_ALREADY_RESERVED');throw e;
    }
    try{await h.writeFile(JSON.stringify(s,null,2)+'\n');await h.sync();}finally{await h.close();}
    const session=new MeteredUptoSettlement(file,s,wire,q);
    try{
      // Only a trusted genuine SDK/facilitator adapter may implement this hook.
      verifyResult(await verifyPayment({paymentPayload:snap(paymentPayload),
        paymentRequirements:snap(verifyRequirements),phase:'verify'}));
      await session.#commit({status:'VERIFIED'});
    }catch(e){await session.#commit({status:'VERIFY_REJECTED',reason:String(e.code||e.message)});throw e;}
    return session;
  }
  async recordBytes(bytes){
    if(this.#state.price.mode!=='bytes'||!(bytes instanceof Uint8Array))throw new MeterError('BYTE_BUFFER_REQUIRED');
    return this.#record(String(bytes.byteLength),'bytes');
  }
  async recordUnits(units){
    if(this.#state.price.mode!=='units')throw new MeterError('UNIT_METER_REQUIRED');
    return this.#record(units,'units');
  }
  async #record(units,kind){return this.#exclusive(async()=>{
    if(this.status!=='VERIFIED')throw new MeterError('SESSION_NOT_METERABLE');
    const next=amount(units,'usage.units',{allowZero:false});
    const total=BigInt(this.#state.units)+next;
    const cost=charge(total,this.#quote.numerator,this.#quote.denominator);
    if(cost>this.#quote.maximum)throw new MeterError('METER_EXCEEDS_AUTHORIZED_CEILING');
    const events=[...this.#state.events,{sequence:this.#state.events.length+1,kind,units:next.toString(),cumulative:total.toString()}];
    await this.#commit({units:total.toString(),chargeAtomic:cost.toString(),events});
    return {totalUnits:total.toString(),chargeAtomic:cost.toString()};
  });}
  async seal(){return this.#exclusive(async()=>{
    if(this.status!=='VERIFIED')throw new MeterError('SESSION_NOT_SEALABLE');
    const digest=eventDigest(this.#state.events);
    await this.#commit({status:'SEALED',usageDigest:digest});
    return this.receipt;
  });}
  async submit({verifyPayment,submitAuthorizedPayment}){return this.#exclusive(async()=>{
    if(this.status!=='SEALED')throw new MeterError('SETTLEMENT_ALREADY_STARTED_OR_NOT_SEALED');
    if(typeof verifyPayment!=='function'||typeof submitAuthorizedPayment!=='function')
      throw new MeterError('REAL_FACILITATOR_ADAPTER_REQUIRED');
    try{
      // Reverify the originally signed ceiling, never the variable charge.
      verifyResult(await verifyPayment({paymentPayload:snap(this.#wire.paymentPayload),
        paymentRequirements:snap(this.#wire.verifyRequirements),phase:'verify'}));
    }catch(e){await this.#commit({status:'REVERIFY_REJECTED',reason:String(e.code||e.message)});throw e;}
    const settleRequirements=snap(this.#wire.verifyRequirements);
    settleRequirements.amount=this.#state.chargeAtomic;
    if(amount(settleRequirements.amount,'actual')>this.#quote.maximum)throw new MeterError('OVER_SIGNED_CEILING');
    // Persist before any possible broadcast. A timeout/crash can NEVER cause
    // this module to resubmit an authorization automatically.
    await this.#commit({status:'SUBMIT_UNKNOWN',submittedAt:new Date().toISOString(),attempts:1});
    let response;
    try {
      response=await submitAuthorizedPayment({paymentPayload:snap(this.#wire.paymentPayload),
        paymentRequirements:settleRequirements,maximumAtomic:this.#state.maxAtomic,
        actualAtomic:this.#state.chargeAtomic,authorizationId:this.id,
        usageDigest:this.#state.usageDigest});
    }catch(e){await this.#commit({lastTransportError:String(e.code||e.message)});throw new MeterError('SUBMIT_INDETERMINATE_RECONCILE_ONLY');}
    if(!plain(response)||response.success!==true || response.network!==this.#state.network ||
       typeof response.transaction!=='string' || !response.transaction ||
       response.amount!==this.#state.chargeAtomic){
      await this.#commit({settlementResponse:snap(response??{}),reason:'UNVERIFIED_SETTLEMENT_RESPONSE'});
      throw new MeterError('SUBMIT_RESULT_INDETERMINATE_RECONCILE_ONLY');
    }
    await this.#commit({status:'AWAITING_LEDGER',transaction:response.transaction,
      settlementResponse:snap(response)});
    return this.receipt;
  });}
  async reconcile({observeTransaction}){return this.#exclusive(async()=>{
    if(this.status!=='AWAITING_LEDGER')throw new MeterError('NO_RECONCILABLE_TRANSACTION');
    if(typeof observeTransaction!=='function')throw new MeterError('LEDGER_OBSERVER_REQUIRED');
    const proof=await observeTransaction({network:this.#state.network,transaction:this.#state.transaction,
      asset:this.#state.asset,payTo:this.#state.payTo,from:this.#state.from,
      expectedAmount:this.#state.chargeAtomic});
    if(!plain(proof) || proof.transaction!==this.#state.transaction || proof.network!==this.#state.network ||
      proof.status!=='SUCCESS' || !Number.isSafeInteger(proof.ledger) || proof.ledger<1 ||
      !Array.isArray(proof.transfers))throw new MeterError('LEDGER_PROOF_PENDING_OR_INVALID');
    const expected=BigInt(this.#state.chargeAtomic);
    if(expected>0n){
      if(proof.transfers.length!==1)throw new MeterError('TRANSFER_EVENT_COUNT_MISMATCH');
      const t=proof.transfers[0];
      if(t?.from!==this.#state.from || t.to!==this.#state.payTo || t.asset!==this.#state.asset ||
         amount(t.amount,'event.amount')!==expected)throw new MeterError('LEDGER_TRANSFER_MISMATCH');
    } else if(proof.transfers.length!==0)throw new MeterError('ZERO_CHARGE_HAS_TRANSFER');
    await this.#commit({status:'LEDGER_CONFIRMED',ledgerProof:snap(proof)});
    return this.receipt;
  });}
  static async inspect({journalDir,authorizationId}){
    if(typeof authorizationId!=='string'||!/^[a-f0-9]{64}$/.test(authorizationId))throw new MeterError('BAD_AUTHORIZATION_ID');
    const record=JSON.parse(await readFile(join(journalDir,authorizationId+'.json'),'utf8'));
    return snap({id:record.id,status:record.status,amount:record.chargeAtomic,
      maximum:record.maxAtomic,units:record.units,usageDigest:record.usageDigest??null,
      transaction:record.transaction??null});
  }
}

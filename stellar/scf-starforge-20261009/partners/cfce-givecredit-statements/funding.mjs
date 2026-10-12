// MIT. Exact original-call funding capacity and native execution order; no I/O.
const integer = value => value !== null && value !== undefined && value !== '' &&
  (typeof value !== 'number' || Number.isSafeInteger(value)) && /^-?\d+$/.test(String(value)) ? BigInt(value) : null;
const ordinal = value => {const n=integer(value);return n!==null&&n>=0n?n:null;};
const refs = rows => [...new Set(rows.flatMap(row=>[...(row?.rawRefs||[]),
  ...Object.values(row?.sourceStatus||{}).map(value=>value?.rawRef).filter(Boolean)]))];
const same = (a,b) => a !== null && a !== undefined && b !== null && b !== undefined && String(a)===String(b);
function transactionIndex(source){
  const rows=(source?.tables?.transactions||[]).filter(row=>row.successful===true),index=new Map();
  for(const row of rows)index.set(row.network+':'+String(row.hash).toLowerCase(),row);
  for(const row of rows)for(const alias of row.hashAliases||[]){
    const key=row.network+':'+String(alias).toLowerCase();if(!index.has(key))index.set(key,row);
  }
  return index;
}
function transaction(index,row){return index.get(row?.network+':'+String(row?.hash||'').toLowerCase())||null;}
const belongs = (index,row,tx) => row?.network===tx?.network&&transaction(index,row)?.hash===tx?.hash;
const position = row => {const operation=ordinal(row?.operationIndex),event=ordinal(row?.eventIndex);
  return operation===null||event===null?null:{operation,event};};
const cmp = (a,b) => a<b?-1:a>b?1:0;

/** Tri-state comparison in actual execution order; a missing native ordinal never becomes a lexical tie. */
export function compareNativeOrder(source,left,right){
  const index=transactionIndex(source),ltx=transaction(index,left),rtx=transaction(index,right),rawRefs=refs([left,right,ltx,rtx]);
  const result=(comparison,sourceBasis)=>({comparison,sourceBasis,rawRefs});
  if(left?.network!==right?.network)return result(null,'Different Stellar networks.');
  if(!ltx||!rtx)return result(null,'Both records require their original successful transactions.');
  const ll=ordinal(left.ledger??ltx.ledger),rl=ordinal(right.ledger??rtx.ledger);
  if(ll===null||rl===null)return result(null,'An original ledger sequence is unavailable.');
  if(ordinal(ltx.ledger)!==ll||ordinal(rtx.ledger)!==rl)return result(null,'The transfer ledger differs from its original transaction.');
  if(ll!==rl)return result(cmp(ll,rl),'Original ledger sequence.');
  if(ltx.hash!==rtx.hash){
    const la=ordinal(ltx.applicationOrder),ra=ordinal(rtx.applicationOrder);
    if(la===null||ra===null)return result(null,'Original transaction application order within this ledger is unavailable.');
    if(la===ra)return result(null,'Different transactions repeat an application ordinal in the retained source.');
    return result(cmp(la,ra),'Original transaction application order within the same ledger.');
  }
  if(left.key&&left.key===right.key)return result(0,'Same original transfer or event.');
  const lo=ordinal(left.operationIndex),ro=ordinal(right.operationIndex);
  if(lo===null||ro===null)return result(null,'Original operation order within this transaction is unavailable.');
  if(lo!==ro)return result(cmp(lo,ro),'Original operation order within the same transaction.');
  const le=ordinal(left.eventIndex),re=ordinal(right.eventIndex);
  if(le===null||re===null)return result(null,'Original event order within this operation is unavailable.');
  if(le===re)return result(null,'Different records repeat one native event position.');
  return result(cmp(le,re),'Original event order within the same operation.');
}
export function paymentBeforePayout(source,payment,payout){
  const result=compareNativeOrder(source,payment,payout);
  return {...result,precedes:result.comparison===null?null:result.comparison<0};
}
function atPhase(observations,operation,stage,field){
  const rows=observations.filter(row=>row.phase==='operation-'+operation+':'+stage&&
    row[field]!==null&&row[field]!==undefined);
  const values=[...new Set(rows.map(row=>String(row[field])))];
  return {value:values.length===1?values[0]:null,conflict:values.length>1,rows};
}
/** Recover a field at the donor transfer from the operation's own state and ordered original setter events. */
function fieldAtPayment(observations,changes,operation,event,field){
  const before=atPhase(observations,operation,'before',field),after=atPhase(observations,operation,'after',field);
  const events=changes.filter(row=>row.field===field&&ordinal(row.operationIndex)===operation);
  const rows=[...before.rows,...after.rows,...events];
  if(before.conflict||after.conflict||events.some(row=>ordinal(row.eventIndex)===null))
    return {value:null,conflict:true,rows};
  events.sort((a,b)=>cmp(ordinal(a.eventIndex),ordinal(b.eventIndex)));
  let current=before.value;
  if(current===null)current=events.length?String(events[0].oldValue):after.value;
  let value=current,conflict=false;
  for(const row of events){
    if(current!==null&&!same(current,row.oldValue))conflict=true;
    current=String(row.newValue);
    if(ordinal(row.eventIndex)<event)value=current;
  }
  if(after.value!==null&&current!==null&&!same(after.value,current))conflict=true;
  return {value:conflict?null:value,conflict,rows};
}

/**
 * Original gross amounts remain allocation weights. Capacity is only the provider
 * portion deposited into the Credits pool, with source-derived vendor fees and
 * indivisible residual atoms shown separately. No current fee is used for a past call.
 */
export function paymentFundingCapacity(source,payment){
  const index=transactionIndex(source),gross=integer(payment?.amountAtoms),tx=transaction(index,payment),payPos=position(payment);
  const used=[payment,tx],reasons=[];
  const base={paymentKey:payment?.key||null,grossWeightAtoms:gross===null?String(payment?.amountAtoms??''):String(gross),
    contractId:payment?.to||null,provider:null,vendor:null,providerFees:null,vendorFees:null,
    providerPortionAtoms:null,vendorPortionAtoms:null,residualAtoms:null,providerPayoutAtoms:null,
    donationEventKey:null,capacityAtoms:null,status:'operator-capacity-required',
    sourceBasis:'An explicit capacity tied to the original provider share is required.'};
  const finish=extra=>({...base,...extra,unresolvedReasons:[...new Set(reasons)],rawRefs:refs(used)});
  if(gross===null||gross<=0n||!tx||!payPos){reasons.push('Original successful payment amount or event position is unavailable.');return finish();}
  const events=(source.tables.donationEvents||[]).filter(row=>belongs(index,row,tx)&&row.contractId===payment.to&&
    ordinal(row.operationIndex)===payPos.operation&&ordinal(row.eventIndex)!==null)
    .sort((a,b)=>cmp(ordinal(a.eventIndex),ordinal(b.eventIndex)));
  const possible=events.filter(row=>row.donor===payment.from&&same(row.amountAtoms,gross)&&ordinal(row.eventIndex)>payPos.event);
  const terminal=possible[0];
  if(!terminal){reasons.push('The incoming transfer has no matching original terminal donation event.');return finish();}
  const terminalIndex=ordinal(terminal.eventIndex),prior=events.filter(row=>ordinal(row.eventIndex)<terminalIndex).at(-1);
  const lower=prior?ordinal(prior.eventIndex):-1n;
  const sameOperation=(source.tables.transfers||[]).filter(row=>belongs(index,row,tx)&&
    ordinal(row.operationIndex)===payPos.operation&&ordinal(row.eventIndex)!==null);
  const incoming=sameOperation.filter(row=>row.to===payment.to&&row.from===terminal.donor&&
    same(row.amountAtoms,terminal.amountAtoms)&&ordinal(row.eventIndex)>lower&&ordinal(row.eventIndex)<terminalIndex);
  if(incoming.length!==1||incoming[0].key!==payment.key){
    reasons.push('The source contains more than one possible incoming transfer for this donation call.');return finish();
  }
  base.provider=terminal.provider;base.donationEventKey=terminal.key;used.push(terminal);
  const outgoing=sameOperation.filter(row=>row.from===payment.to&&row.asset?.key===payment.asset?.key&&
    ordinal(row.eventIndex)>payPos.event&&ordinal(row.eventIndex)<terminalIndex)
    .sort((a,b)=>cmp(ordinal(a.eventIndex),ordinal(b.eventIndex)));
  const observations=(source.tables.contractObservations||[]).filter(row=>belongs(index,row,tx)&&row.contractId===payment.to);
  const changes=(source.metadata?.contractChanges||[]).filter(row=>belongs(index,row,tx)&&row.contractId===payment.to);
  const values={};
  for(const field of ['provider','vendor','providerFees','vendorFees','tokenContractId']){
    const result=tx.contractChangesComplete===true?fieldAtPayment(observations,changes,payPos.operation,payPos.event,field):{value:null,conflict:false,rows:[]};
    values[field]=result.value;used.push(...result.rows);
    if(result.conflict)reasons.push('Original same-operation '+field+' observations conflict.');
  }
  base.vendor=values.vendor;base.providerFees=values.providerFees;base.vendorFees=values.vendorFees;
  if(values.provider!==null&&values.provider!==terminal.provider)reasons.push('The observed provider differs from the original donation event.');
  if(values.tokenContractId!==null&&payment.asset?.contractId&&values.tokenContractId!==payment.asset.contractId)
    reasons.push('The observed donation token differs from the incoming transfer asset.');
  const providerRate=integer(values.providerFees),vendorRate=integer(values.vendorFees);
  if(providerRate!==null&&(providerRate<0n||providerRate>100n)||vendorRate!==null&&(vendorRate<0n||vendorRate>100n)||
    providerRate!==null&&vendorRate!==null&&providerRate+vendorRate>100n)
    reasons.push('The original fee configuration is negative or allocates more than the gross donation.');
  let provider=providerRate===null?null:gross*providerRate/100n,vendor=vendorRate===null?null:gross*vendorRate/100n;
  let payout=null,flowVendor=null,flowBasis=null;
  const before=atPhase(observations,payPos.operation,'before','accountedRemainderAtoms');
  const after=atPhase(observations,payPos.operation,'after','accountedRemainderAtoms');
  const oldBalance=integer(before.value),newBalance=integer(after.value);
  const singleCall=tx.contractChangesComplete===true&&events.length===1&&oldBalance!==null&&newBalance!==null&&!before.conflict&&!after.conflict;
  used.push(...outgoing,...before.rows,...after.rows);
  if(outgoing.length===0){payout=0n;flowVendor=0n;flowBasis='No original outgoing transfer in this donation call.';}
  else if(outgoing.length===2&&outgoing[1].to===terminal.provider){
    flowVendor=integer(outgoing[0].amountAtoms);payout=integer(outgoing[1].amountAtoms);
    base.vendor=base.vendor||outgoing[0].to;
    if(base.vendor!==outgoing[0].to)reasons.push('The original first outgoing transfer differs from the observed vendor.');
    flowBasis='Original vendor transfer followed by the provider bucket transfer.';
  }else if(outgoing.length===1){
    const row=outgoing[0],amount=integer(row.amountAtoms);
    if(row.to!==terminal.provider){flowVendor=amount;payout=0n;base.vendor=base.vendor||row.to;
      if(base.vendor!==row.to)reasons.push('The outgoing vendor transfer differs from the observed vendor.');
      flowBasis='Original vendor-only transfer.';}
    else if(singleCall&&provider!==null){
      const expectedPayout=provider+oldBalance-newBalance;
      if(expectedPayout===0n){payout=0n;flowVendor=amount;base.vendor=base.vendor||row.to;flowBasis='Same-call provider balance identifies the vendor-only transfer.';}
      else if(expectedPayout===amount){payout=amount;flowVendor=0n;flowBasis='Same-call provider balance identifies the provider-only transfer.';}
      else reasons.push('The original outgoing amount does not reconcile to the same-call provider balance.');
    }else if(vendor!==null){
      if(vendor===0n){payout=amount;flowVendor=0n;flowBasis='Original provider-only transfer with zero vendor share.';}
      else if(vendor===amount){payout=0n;flowVendor=amount;base.vendor=base.vendor||row.to;flowBasis='Original vendor-only transfer matches the same-call vendor share.';}
      else reasons.push('The original outgoing amount differs from the same-call vendor share.');
    }else if(base.vendor!==null&&base.vendor!==terminal.provider){
      payout=amount;flowVendor=0n;flowBasis='Original provider-only transfer to a distinct provider address.';
    }
  }else reasons.push('The donation call has an unexpected number or order of outgoing transfers.');
  if(flowVendor!==null&&flowVendor>0n&&values.vendor!==null&&outgoing[0]?.to!==values.vendor)
    reasons.push('The original vendor transfer recipient differs from the same-call vendor setting.');
  if(singleCall&&payout!==null){
    const retainedProvider=newBalance-oldBalance+payout;
    if(provider!==null&&provider!==retainedProvider)reasons.push('The same-call fee share and original provider balance movement disagree.');
    if(provider===null)provider=retainedProvider;
  }
  if(flowVendor!==null){
    if(vendor!==null&&vendor!==flowVendor)reasons.push('The same-call vendor fee and original vendor transfer disagree.');
    if(vendor===null)vendor=flowVendor;
  }
  if(provider===null)reasons.push('The provider share is unavailable from same-call fees or balance movement.');
  if(vendor===null)reasons.push('The vendor portion is unavailable from same-call fees or transfer order.');
  if(provider!==null&&vendor!==null&&(provider<0n||vendor<0n||provider+vendor>gross))
    reasons.push('The original provider and vendor portions exceed the available gross payment or are negative.');
  const resolved=provider!==null&&vendor!==null&&reasons.length===0;
  return finish({providerPortionAtoms:provider===null?null:String(provider),vendorPortionAtoms:vendor===null?null:String(vendor),
    providerPayoutAtoms:payout===null?null:String(payout),flowBasis,
    residualAtoms:provider!==null&&vendor!==null?String(gross-provider-vendor):null,
    capacityAtoms:resolved?String(provider):null,status:resolved?'source-derived':'operator-capacity-required',
    sourceBasis:resolved?(providerRate!==null?'Original same-call provider fee, with separately retained vendor share.':
      'Original provider balance before and after the sole donation call, plus its ordered provider payout.'):
      'An explicit capacity tied to the original provider share is required.',
    balanceBasis:singleCall?{beforeAtoms:String(oldBalance),afterAtoms:String(newBalance),donationCallsInOperation:events.length}:null});
}

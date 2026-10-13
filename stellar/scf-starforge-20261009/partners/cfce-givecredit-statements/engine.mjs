// MIT. Exact donor, pooled payout and carbon attribution over distinct original source editions.
import {need,copy,plain,text,id,units,decimal,dayOf,windowOf,inWindow,atoms,network,
  validateSourceEdition,sourceSummary,keyForReceipt,txKey} from './source.mjs';
import {canonical,compareEditions as compareCarbonEditions} from '../stellarcarbon-statements/engine.mjs';
import {paymentFundingCapacity,compareNativeOrder,paymentBeforePayout} from './funding.mjs';
import {isImmutableJSON} from './immutable.mjs';
export {canonical};
export const WORKSPACE_SCHEMA='stellar-forge.givecredit-workspace.v1';
export const STATEMENT_SCHEMA='stellar-forge.givecredit-statement.v1';
export const HANDOVER_SCHEMA='stellar-forge.givecredit-handover.v1';
export const now=()=>new Date().toISOString();
export function newWorkspace({workspaceId,name='GiveCredit statements',createdAt=now()}){
  return {schema:WORKSPACE_SCHEMA,workspaceId:id(workspaceId),name:text(name,'workspace name',300),createdAt,
    revision:0,editions:[],paymentLinks:[],allocations:[],bridges:[],statements:[],history:[],operations:[]};
}
export function validateWorkspace(state){
  need(state?.schema===WORKSPACE_SCHEMA,'WORKSPACE_SCHEMA','Open a GiveCredit statements workspace.');
  id(state.workspaceId);need(Number.isSafeInteger(state.revision)&&state.revision>=0&&
    ['editions','paymentLinks','allocations','bridges','statements','history','operations'].every(key=>Array.isArray(state[key])),
    'WORKSPACE_INCOMPLETE','Receive the complete editable workspace.');
  const ids=new Set();
  for(const source of state.editions){id(source.id);need(!ids.has(source.id),'DUPLICATE_EDITION','Keep distinct source editions.');ids.add(source.id);validateSourceEdition(source);}
  return state;
}
export function recordFor(rows,recordId,label='record'){
  const row=rows.find(value=>value.id===recordId);need(row,'RECORD_NOT_FOUND','Choose an existing '+label+'.',404);return row;
}
export function editionFor(state,editionId,kind){
  const source=recordFor(state.editions,editionId,'source edition');
  need(!kind||source.kind===kind,'SOURCE_KIND_MISMATCH','Choose a '+kind+' source edition.');return source;
}
const active=row=>row.active!==false;
export const assetKey=asset=>asset.key;
const transferOrder=(a,b)=>String(a.createdAt).localeCompare(String(b.createdAt))||String(a.ledger).padStart(15,'0').localeCompare(String(b.ledger).padStart(15,'0'))||a.key.localeCompare(b.key);
function ledger(state,editionId){return editionFor(state,editionId,'ledger');}
function transferFor(source,key){const row=source.tables.transfers.find(row=>row.key===key);need(row,'PAYMENT_NOT_FOUND','Choose an original retained token transfer.',404);return row;}
function registry(state,editionId){return editionFor(state,editionId,'registry');}
function donationFor(source,key){return recordFor(source.tables.donations,key,'original donation');}
export function transactionFor(source,hash){
  const key=String(hash).toLowerCase();
  return source.tables.transactions.find(row=>row.hash===key)||
    source.tables.transactions.find(row=>row.successful===true&&(row.hashAliases||[]).includes(key))||
    source.tables.transactions.find(row=>(row.hashAliases||[]).includes(key));
}
function completeTx(source,hash){const row=transactionFor(source,hash);return row?.successful===true?row:null;}
function receiptMatches(source,receipt,payment){
  return String(receipt.chainName||receipt.chain||'').toLowerCase()==='stellar'&&
    String(receipt.network||'').toLowerCase()===payment.network&&
    transactionFor(source,receipt.transactionId)?.hash===transactionFor(source,payment.hash)?.hash;
}
const eventOrder=row=>/^\d+$/.test(String(row.eventIndex))?BigInt(row.eventIndex):null;
const sameOperation=(a,b)=>String(a.operationIndex??'0')===String(b.operationIndex??'0');
export function providerPayoutCandidates(source){
  const results=new Map();
  for(const event of source.tables.donationEvents){
    const tx=completeTx(source,event.hash),end=eventOrder(event);if(!tx||end===null)continue;
    const rows=source.tables.transfers.filter(row=>transactionFor(source,row.hash)?.hash===tx.hash&&sameOperation(row,event)&&eventOrder(row)!==null&&eventOrder(row)<end);
    const previous=source.tables.donationEvents.filter(row=>row.key!==event.key&&row.contractId===event.contractId&&
      transactionFor(source,row.hash)?.hash===tx.hash&&sameOperation(row,event)&&eventOrder(row)!==null&&eventOrder(row)<end)
      .reduce((last,row)=>eventOrder(row)>last?eventOrder(row):last,-1n);
    const incoming=rows.filter(row=>eventOrder(row)>previous&&row.to===event.contractId&&row.from===event.donor&&row.amountAtoms===event.amountAtoms)
      .sort((a,b)=>eventOrder(a)<eventOrder(b)?1:-1)[0];
    if(!incoming)continue;
    const outgoing=rows.filter(row=>eventOrder(row)>eventOrder(incoming)&&row.from===event.contractId&&row.asset.key===incoming.asset.key)
      .sort((a,b)=>eventOrder(a)<eventOrder(b)?-1:1);
    const funding=paymentFundingCapacity(source,incoming);
    const observed=source.tables.contractObservations.filter(row=>row.hash&&transactionFor(source,row.hash)?.hash===tx.hash&&row.contractId===event.contractId&&
      (row.phase===('operation-'+String(event.operationIndex??'0')+':before')||row.phase==='transaction-before:before'));
    const field=name=>{const values=[...new Set(observed.map(row=>row[name]).filter(value=>value!==null&&value!==undefined).map(String))];return values.length===1?values[0]:null;};
    for(const row of outgoing.filter(value=>value.to===event.provider)){
      let classification='requires-source-classification',basis='The source has a single provider-address transfer; vendor and provider identity need resolution.';
      if(outgoing.length===2&&funding.donationEventKey===event.key){
        classification=row.key===outgoing.at(-1).key?'provider-payout':'vendor-fee';
        basis='Original donate call order: the immediate vendor transfer precedes the bucket payout and terminal donation event.';
      }else if(outgoing.length===1){
        if(funding.providerPayoutAtoms===row.amountAtoms&&funding.status==='source-derived'){
          classification='provider-payout';basis=funding.flowBasis||funding.sourceBasis;
        }else if(funding.providerPayoutAtoms==='0'&&funding.vendorPortionAtoms===row.amountAtoms&&funding.status==='source-derived'){
          classification='vendor-fee';basis=funding.flowBasis||funding.sourceBasis;
        }

      }
      results.set(row.key,{...copy(row),classification,classificationBasis:basis,donationEvent:copy(event),donorPaymentKey:incoming.key,
        observationRefs:[...new Set([...observed.flatMap(value=>value.rawRefs||[]),...funding.rawRefs])],fundingSource:funding});
    }
  }
  return [...results.values()];
}
export function providerPayouts(source){return providerPayoutCandidates(source).filter(row=>row.classification==='provider-payout');}
export function nativePayments(source){
  return source.tables.transfers.filter(row=>{
    if(!completeTx(source,row.hash)||!source.tables.donationEvents.some(event=>
      transactionFor(source,event.hash)?.hash===transactionFor(source,row.hash)?.hash&&event.network===row.network&&
      event.contractId===row.to&&event.donor===row.from&&event.amountAtoms===row.amountAtoms))return false;
    return paymentFundingCapacity(source,row).donationEventKey!==null;
  });
}
export function registrySummary(state,editionId){
  const source=registry(state,editionId);
  return {editionId,organizations:copy(source.tables.organizations),initiatives:copy(source.tables.initiatives),
    counts:sourceSummary(source).counts};
}
function registrySelection(row,query={}){
  return (!query.organizationId||row.organizationId===query.organizationId)&&
    (!query.initiativeId||row.initiativeId===query.initiativeId)&&
    (!query.donorAddress||row.wallet===query.donorAddress)&&
    (!query.fromDate||dayOf(row.created)>=query.fromDate)&&(!query.beforeDate||dayOf(row.created)<query.beforeDate);
}
export function donationDetail(state,editionId,donationId,ledgerEditionId){
  const source=registry(state,editionId),donation=donationFor(source,donationId);
  const receipts=source.tables.nfts.filter(row=>row.donationId===donation.id);
  const candidates=source.tables.nfts.filter(row=>!row.donationId&&row.organizationId===donation.organizationId&&
    (!donation.initiativeId||row.initiativeId===donation.initiativeId)&&row.donorAddress===donation.wallet);
  const paymentLinks=state.paymentLinks.filter(row=>active(row)&&row.registryEditionId===editionId&&row.donationId===donationId&&
    (!ledgerEditionId||row.ledgerEditionId===ledgerEditionId));
  const candidatePayments=[];
  if(ledgerEditionId){
    const original=ledger(state,ledgerEditionId);
    for(const row of original.tables.transfers)if([...receipts,...candidates].some(receipt=>receiptMatches(original,receipt,row))&&row.from===donation.wallet&&completeTx(original,row.hash))
      candidatePayments.push(copy(row));
  }
  return {donation:copy(donation),organization:copy(source.tables.organizations.find(row=>row.id===donation.organizationId)||donation.organization||null),
    initiative:copy(source.tables.initiatives.find(row=>row.id===donation.initiativeId)||donation.initiative||null),
    receipts:copy(receipts),receiptCandidates:copy(candidates),paymentLinks:copy(paymentLinks),candidatePayments,
    matchingRule:'Only saved source assignments attribute a payment. Receipt candidates retain the original payment hash and separately minted token identifiers.'};
}
function page(rows,query={}){
  const offset=Number(query.offset||0),limit=Number(query.limit||50);
  need(Number.isSafeInteger(offset)&&offset>=0&&Number.isInteger(limit)&&limit>=1&&limit<=500,'INVALID_PAGE','Choose a valid record page.');
  return {items:rows.slice(offset,offset+limit),offset,limit,total:rows.length,nextOffset:offset+limit<rows.length?offset+limit:null};
}
export function donationsPage(state,query={}){
  const source=registry(state,query.editionId),search=String(query.search||'').toLowerCase();
  const rows=source.tables.donations.filter(row=>registrySelection(row,query)&&(!search||[row.id,row.wallet,row.asset,row.organization?.name,row.initiative?.title]
    .some(value=>String(value||'').toLowerCase().includes(search)))).map(row=>{
      const detail=donationDetail(state,source.id,row.id,query.ledgerEditionId);
      return {...copy(row),organizationName:detail.organization?.name||'Organization record',initiativeName:detail.initiative?.title||(row.initiativeId?'Initiative record':'Direct donation'),
        linkedPayments:detail.paymentLinks.length,receiptCount:detail.receipts.length,candidateCount:detail.candidatePayments.length};
    }).sort((a,b)=>b.created.localeCompare(a.created)||a.id.localeCompare(b.id));
  return {...page(rows,query),editionId:source.id};
}
export function transfersPage(state,query={}){
  const source=ledger(state,query.editionId),payouts=new Set(providerPayouts(source).map(row=>row.key)),payments=new Set(nativePayments(source).map(row=>row.key));
  const rows=source.tables.transfers.filter(row=>(!query.fromDate||dayOf(row.createdAt)>=query.fromDate)&&
    (!query.beforeDate||dayOf(row.createdAt)<query.beforeDate)&&(!query.address||row.from===query.address||row.to===query.address)&&
    (!query.kind||query.kind==='payment'&&payments.has(row.key)||query.kind==='payout'&&payouts.has(row.key))&&
    (!query.search||canonical(row).toLowerCase().includes(String(query.search).toLowerCase())))
    .sort(transferOrder).reverse().map(row=>({...copy(row),role:payouts.has(row.key)?'Provider payout':payments.has(row.key)?'Donor payment':'Token transfer',
      amount:decimal(BigInt(row.amountAtoms),Number(row.asset.decimals))}));
  return {...page(rows,query),editionId:source.id};
}
export function transferDetail(state,editionId,key){
  const source=ledger(state,editionId),row=transferFor(source,key);
  return {...copy(row),transaction:copy(source.tables.transactions.find(tx=>tx.hash===row.hash)||null),
    events:copy(source.tables.donationEvents.filter(event=>event.hash===row.hash)),
    paymentLinks:copy(state.paymentLinks.filter(link=>active(link)&&link.ledgerEditionId===editionId&&link.paymentKey===key)),
    allocations:copy(state.allocations.filter(link=>active(link)&&link.ledgerEditionId===editionId&&(link.payoutKey===key||link.parts.some(part=>part.paymentKey===key)))),
    bridges:copy(state.bridges.filter(link=>active(link)&&link.ledgerEditionId===editionId&&link.payoutKey===key))};
}
export function poolRegister(state,editionId,query={}){
  const source=ledger(state,editionId),contracts=new Set([...source.tables.donationEvents.map(row=>row.contractId),...source.tables.contractObservations.map(row=>row.contractId)]);
  const payouts=providerPayouts(source),classified=state.allocations.filter(row=>active(row)&&row.ledgerEditionId===editionId&&row.payoutClassification==='operator-source-assignment');
  return {editionId,network:source.metadata.network,period:{fromDate:query.fromDate||null,beforeDate:query.beforeDate||null},
    dateBasis:'Ledger close time for transfers. Each contract balance is a separately dated native observation.',
    pools:[...contracts].sort().filter(contract=>!query.contractId||contract===query.contractId).map(contract=>{
      const rows=source.tables.transfers.filter(row=>completeTx(source,row.hash)&&(row.from===contract||row.to===contract)&&
        (!query.fromDate||dayOf(row.createdAt)>=query.fromDate)&&(!query.beforeDate||dayOf(row.createdAt)<query.beforeDate));
      const assets=new Map();
      for(const row of rows){const flow=assets.get(row.asset.key)||{asset:copy(row.asset),incoming:0n,outgoing:0n,providerPayout:0n,operatorClassifiedPayout:0n};
        if(row.to===contract)flow.incoming+=BigInt(row.amountAtoms);if(row.from===contract)flow.outgoing+=BigInt(row.amountAtoms);
        if(payouts.some(value=>value.key===row.key))flow.providerPayout+=BigInt(row.amountAtoms);
        if(classified.some(value=>value.payoutKey===row.key))flow.operatorClassifiedPayout+=BigInt(row.amountAtoms);assets.set(row.asset.key,flow);}
      return {contractId:contract,flows:[...assets.values()].map(row=>({asset:row.asset,incomingAtoms:String(row.incoming),outgoingAtoms:String(row.outgoing),
        netAtoms:String(row.incoming-row.outgoing),providerPayoutAtoms:String(row.providerPayout),
        operatorClassifiedPayoutAtoms:String(row.operatorClassifiedPayout),otherOutgoingAtoms:String(row.outgoing-row.providerPayout-row.operatorClassifiedPayout),incoming:decimal(row.incoming,Number(row.asset.decimals)),
        outgoing:decimal(row.outgoing,Number(row.asset.decimals)),net:decimal(row.incoming-row.outgoing,Number(row.asset.decimals))})),
        transfers:copy(rows),payoutCandidates:providerPayoutCandidates(source).filter(row=>row.from===contract),observations:copy(source.tables.contractObservations.filter(row=>row.contractId===contract).sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt))))};
    })};
}
/** Largest remainders, with exact capacity limits. Output sums exactly to the input. */
export function apportion(total,entries){
  need(typeof total==='bigint'&&total>=0n,'ALLOCATION_AMOUNT','Use a nonnegative exact amount.');
  need(entries.length&&new Set(entries.map(row=>row.id)).size===entries.length,'ALLOCATION_MEMBERS','Choose distinct allocation members.');
  const rows=entries.map(row=>({id:row.id,weight:BigInt(row.weight),cap:row.cap===undefined?total:BigInt(row.cap),amount:0n}));
  need(rows.every(row=>row.weight>=0n&&row.cap>=0n)&&rows.reduce((n,row)=>n+row.cap,0n)>=total,'ALLOCATION_CAPACITY','The selected source amounts do not cover this allocation.');
  let remaining=total;
  while(remaining>0n){
    const available=rows.filter(row=>row.cap>row.amount&&row.weight>0n),denominator=available.reduce((n,row)=>n+row.weight,0n);
    need(denominator>0n,'ALLOCATION_WEIGHTS','Positive source weights must cover this allocation.');
    const initial=remaining;let spent=0n;
    const fractions=[];
    for(const row of available){const numerator=initial*row.weight,quota=numerator/denominator;
      const add=quota<row.cap-row.amount?quota:row.cap-row.amount;row.amount+=add;spent+=add;
      fractions.push({row,remainder:numerator%denominator});}
    remaining-=spent;
    if(!remaining)break;
    const sorted=fractions.sort((a,b)=>a.remainder===b.remainder?a.row.id.localeCompare(b.row.id):a.remainder>b.remainder?-1:1);
    for(const {row} of sorted){if(!remaining)break;if(row.amount<row.cap){row.amount++;remaining--;}}
  }
  return rows.map(row=>({id:row.id,amount:row.amount}));
}
function fundingUsed(state,ledgerEditionId,exceptId){
  const exceptPayout=state.allocations.find(row=>row.id===exceptId&&row.ledgerEditionId===ledgerEditionId)?.payoutKey;
  const versions=[...state.allocations.filter(row=>active(row)&&row.ledgerEditionId===ledgerEditionId),
    ...state.bridges.filter(row=>active(row)&&row.ledgerEditionId===ledgerEditionId).map(row=>row.allocationSnapshot).filter(Boolean)];
  const payouts=new Map();
  for(const group of versions){
    if(group.payoutKey===exceptPayout)continue;
    const paymentMax=payouts.get(group.payoutKey)||new Map();
    for(const part of group.parts){const amount=BigInt(part.amountAtoms),prior=paymentMax.get(part.paymentKey)||0n;if(amount>prior)paymentMax.set(part.paymentKey,amount);}
    payouts.set(group.payoutKey,paymentMax);
  }
  const result=new Map();
  for(const paymentMax of payouts.values())for(const [paymentKey,amount]of paymentMax)result.set(paymentKey,(result.get(paymentKey)||0n)+amount);
  return result;
}
export function prepareAllocation(state,input){
  const source=ledger(state,input.ledgerEditionId),payout=providerPayoutCandidates(source).find(row=>row.key===input.payoutKey&&row.classification!=='vendor-fee');
  need(payout,'PAYOUT_SOURCE_REQUIRED','Choose a provider-address transfer identified in its original donation call.');
  const classificationNote=payout.classification==='provider-payout'?(input.classificationNote||''):text(input.classificationNote,'provider payout classification note',10000);
  need(payout.classification==='provider-payout'||input.confirmProviderPayout===true,'PAYOUT_CLASSIFICATION_REQUIRED','Resolve the original vendor-versus-provider transfer before allocating it.');
  need(['PROPORTIONAL_GROSS','FIFO_GROSS','EXPLICIT'].includes(input.method),'ALLOCATION_METHOD','Choose proportional, FIFO or explicit funding.');
  const selected=input.paymentKeys||input.parts?.map(row=>row.paymentKey)||[];
  need(Array.isArray(selected)&&selected.length&&new Set(selected).size===selected.length,'PAYMENTS_REQUIRED','Choose distinct original donor payments.');
  const payments=selected.map(key=>transferFor(source,key)),native=new Set(nativePayments(source).map(row=>row.key)),used=fundingUsed(state,source.id,input.id);
  const capacities=payments.map(payment=>{
    need(native.has(payment.key)&&payment.to===payout.from&&payment.asset.key===payout.asset.key,
      'PAYOUT_PAYMENT_MISMATCH','Funding payments must enter this original contract in the same asset.');
    const order=paymentBeforePayout(source,payment,payout),operatorOrder=(input.ordering||[]).find(row=>row.paymentKey===payment.key);
    need(order.precedes!==false,'PAYMENT_AFTER_PAYOUT','This original payment occurs after the selected provider payout.');
    if(order.precedes===null)need(operatorOrder?.precedesPayout===true&&text(operatorOrder.note,'original payment order note',10000),
      'PAYMENT_ORDER_REQUIRED','Resolve the original payment-before-payout order and retain its source note.');
    const original=paymentFundingCapacity(source,payment),supplied=(input.capacities||[]).find(row=>row.paymentKey===payment.key);
    let capacity,capacityNote='';
    if(original.capacityAtoms!==null)capacity=BigInt(original.capacityAtoms);
    else{
      need(supplied,'PAYMENT_CAPACITY_REQUIRED','Enter the source-resolved provider funding capacity for this original payment.');
      capacity=BigInt(atoms(supplied.amountAtoms));capacityNote=text(supplied.note,'original provider funding capacity note',10000);
      const gross=BigInt(payment.amountAtoms),vendor=original.vendorPortionAtoms===null?0n:BigInt(original.vendorPortionAtoms);
      need(vendor>=0n&&capacity<=gross-vendor,'PAYMENT_CAPACITY_EXCEEDED','Provider funding capacity must exclude the original vendor share and stay within the payment.');
    }
    const available=capacity-(used.get(payment.key)||0n);
    need(available>=0n,'PAYMENT_OVERALLOCATED','Prior funding exceeds this original payment provider capacity.');
    return {id:payment.key,weight:BigInt(original.grossWeightAtoms),cap:available,capacity,capacityNote,original,order,operatorOrder:operatorOrder?copy(operatorOrder):null};
  });
  const total=BigInt(payout.amountAtoms);let distribution;
  if(input.method==='PROPORTIONAL_GROSS')distribution=apportion(total,capacities);
  else if(input.method==='FIFO_GROSS'){
    let manual=false;
    for(let i=0;i<payments.length;i++)for(let j=i+1;j<payments.length;j++)
      if(compareNativeOrder(source,payments[i],payments[j]).comparison===null)manual=true;
    const ranks=new Map();
    if(manual){
      for(const payment of payments){
        const row=(input.ordering||[]).find(row=>row.paymentKey===payment.key),rank=Number(row?.rank);
        need(row&&row.rank!==null&&row.rank!==undefined&&row.rank!==''&&Number.isSafeInteger(rank)&&rank>=0&&text(row.note,'original FIFO order note',10000),
          'FIFO_SOURCE_ORDER_REQUIRED','Enter distinct original execution ranks and source notes for FIFO payments whose native order is unavailable.');
        need(![...ranks.values()].includes(rank),'FIFO_RANK_REPEATED','Give each selected payment a distinct execution rank.');
        ranks.set(payment.key,rank);
      }
      for(let i=0;i<payments.length;i++)for(let j=i+1;j<payments.length;j++){
        const compared=compareNativeOrder(source,payments[i],payments[j]).comparison;
        need(compared===null||Math.sign(ranks.get(payments[i].key)-ranks.get(payments[j].key))===compared,
          'FIFO_SOURCE_ORDER_MISMATCH','The entered FIFO ranks differ from the retained native execution order.');
      }
    }
    const ordered=payments.slice().sort((a,b)=>manual?ranks.get(a.key)-ranks.get(b.key):compareNativeOrder(source,a,b).comparison);
    let remaining=total;
    distribution=ordered.map(payment=>{const capacity=capacities.find(row=>row.id===payment.key).cap,amount=remaining<capacity?remaining:capacity;remaining-=amount;return {id:payment.key,amount};});
    need(remaining===0n,'ALLOCATION_CAPACITY','The selected original provider contributions do not cover this payout.');
  }else{
    need(Array.isArray(input.parts)&&input.parts.length===selected.length&&new Set(input.parts.map(row=>row.paymentKey)).size===selected.length&&input.parts.every(row=>selected.includes(row.paymentKey)),
      'ALLOCATION_PARTS_REQUIRED','Enter the exact token atoms attributed to each selected payment.');
    distribution=input.parts.map(row=>({id:row.paymentKey,amount:BigInt(atoms(row.amountAtoms))}));
    need(distribution.reduce((n,row)=>n+row.amount,0n)===total&&distribution.every(row=>row.amount<=capacities.find(x=>x.id===row.id).cap),
      'ALLOCATION_TOTAL_MISMATCH','Explicit funding must equal the actual payout and stay within each available provider contribution.');
  }
  return {ledgerEditionId:source.id,payoutKey:payout.key,method:input.method,name:text(input.name||'Provider payout allocation','allocation name',300),
    note:text(input.note||'','allocation note',10000,true),active:input.active!==false,
    source:{network:payout.network,contractId:payout.from,provider:payout.to,asset:copy(payout.asset),payoutAtoms:payout.amountAtoms,createdAt:payout.createdAt},
    payoutClassification:payout.classification==='provider-payout'?'native-call-order':'operator-source-assignment',classificationNote,
    confirmProviderPayout:payout.classification!=='provider-payout',classificationSource:copy(payout),
    capacities:capacities.map(row=>({paymentKey:row.id,amountAtoms:String(row.capacity),note:row.capacityNote})),
    ordering:copy(input.ordering||[]),
    parts:distribution.map(row=>{const capacity=capacities.find(item=>item.id===row.id);return {paymentKey:row.id,amountAtoms:String(row.amount),
      weightAtoms:String(capacity.weight),capacityAtoms:String(capacity.capacity),availableCapacityAtoms:String(capacity.cap),capacityNote:capacity.capacityNote,
      capacitySource:copy(capacity.original),orderSource:copy(capacity.order),operatorOrder:copy(capacity.operatorOrder),
      payment:copy(transferFor(source,row.id))};}),
    rounding:'Exact token atoms; original gross weights and provider contribution capacities; largest remainder with stable native-key ties.'};
}

export function prepareBridge(state,input){
  const native=ledger(state,input.ledgerEditionId),carbon=editionFor(state,input.carbonEditionId,'carbon');
  need(native.metadata.network===carbon.metadata.network,'SOURCE_NETWORK_MISMATCH','Connect source editions from the same Stellar network.');
  const payout=providerPayoutCandidates(native).find(row=>row.key===input.payoutKey&&row.classification!=='vendor-fee');
  need(payout,'PAYOUT_SOURCE_REQUIRED','Choose an original provider payout.');
  const group=recordFor(state.allocations,input.allocationId,'saved payout allocation');
  need(active(group)&&group.ledgerEditionId===native.id&&group.payoutKey===payout.key,'ALLOCATION_PAYOUT_MISMATCH','Choose the saved allocation for this payout.');
  const sink=carbon.carbon.tables.sinking_txs.find(row=>row.hash===input.sinkHash);
  need(sink,'SINK_SOURCE_REQUIRED','Choose an original Stellarcarbon contribution.');
  const cash=BigInt(atoms(input.paymentAtoms)),tonnes=units(input.carbonAmount);
  need(cash>0n&&tonnes>0n,'BRIDGE_AMOUNT_REQUIRED','Enter positive original payout atoms and attributed CARBON.');
  const others=state.bridges.filter(row=>active(row)&&row.id!==input.id&&row.ledgerEditionId===native.id&&row.carbonEditionId===carbon.id);
  need(cash+others.filter(row=>row.payoutKey===payout.key).reduce((n,row)=>n+BigInt(row.paymentAtoms),0n)<=BigInt(payout.amountAtoms),
    'PAYOUT_BRIDGE_OVERDRAWN','Linked sink payments exceed the original payout.');
  need(tonnes+others.filter(row=>row.sinkHash===sink.hash).reduce((n,row)=>n+units(row.carbonAmount),0n)<=units(sink.carbon_amount),
    'SINK_BRIDGE_OVERDRAWN','Attributed CARBON exceeds the original sinking transaction.');
  return {ledgerEditionId:native.id,carbonEditionId:carbon.id,payoutKey:payout.key,allocationId:group.id,sinkHash:sink.hash,
    paymentAtoms:String(cash),carbonAmount:decimal(tonnes),allocationVersion:group.version,allocationSnapshot:copy(group),note:text(input.note,'payout-to-sink source association',10000),
    active:input.active!==false,source:{payout:copy(payout),sink:copy(sink)},
    attributionBasis:'Explicit operator association of payout token atoms and original sinking CARBON; donor attribution uses the saved payout funding proportions.'};
}
function splitImpact(carbonAtoms,certificates,members){
  const budgets=apportion(carbonAtoms,members.map(row=>({id:row.id,weight:row.weight})));
  const rows=budgets.map(row=>({id:row.id,carbonAtoms:row.amount,allocatedAtoms:0n,remainingAtoms:row.amount,certificates:[]}));
  for(const certificate of certificates){
    const values=apportion(BigInt(certificate.amountAtoms),rows.map(row=>({id:row.id,weight:row.carbonAtoms,cap:row.remainingAtoms})));
    for(const value of values){const row=rows.find(row=>row.id===value.id);row.allocatedAtoms+=value.amount;row.remainingAtoms-=value.amount;
      if(value.amount)row.certificates.push({...copy(certificate),amountAtoms:String(value.amount),amount:decimal(value.amount)});}
  }
  return rows.map(row=>({...row,carbonAtoms:String(row.carbonAtoms),allocatedAtoms:String(row.allocatedAtoms),remainingAtoms:String(row.remainingAtoms),
    carbon:decimal(row.carbonAtoms),allocated:decimal(row.allocatedAtoms),remaining:decimal(row.remainingAtoms)}));
}
export function carbonAttributions(state,ledgerEditionId,carbonEditionId){
  const native=ledger(state,ledgerEditionId),carbon=editionFor(state,carbonEditionId,'carbon');
  need(native.metadata.network===carbon.metadata.network,'SOURCE_NETWORK_MISMATCH','Choose matching Stellar source networks.');
  const bridges=state.bridges.filter(row=>active(row)&&row.ledgerEditionId===ledgerEditionId&&row.carbonEditionId===carbonEditionId);
  const certificates=new Map(carbon.carbon.tables.retirements.map(row=>[row.certificate_id,row])),result=[];
  for(const sinkHash of [...new Set(bridges.map(row=>row.sinkHash))]){
    const sink=carbon.carbon.tables.sinking_txs.find(row=>row.hash===sinkHash);
    need(sink,'SINK_SOURCE_REQUIRED','A saved association needs its complete original sink.');
    const selected=bridges.filter(row=>row.sinkHash===sinkHash),total=units(sink.carbon_amount);
    const assigned=selected.reduce((n,row)=>n+units(row.carbonAmount),0n);
    need(assigned<=total,'SINK_BRIDGE_OVERDRAWN','Saved associations exceed the original source CARBON.');
    const fills=carbon.carbon.tables.sink_status.filter(row=>row.sinking_tx_hash===sinkHash).map(row=>{
      const certificate=certificates.get(row.certificate_id);
      return {certificateId:row.certificate_id,retirementDate:certificate.retirement_date,amountAtoms:String(units(row.amount_filled)),
        finalized:row.finalized,certificate:copy(certificate)};
    }).sort((a,b)=>a.retirementDate.localeCompare(b.retirementDate)||(BigInt(a.certificateId)<BigInt(b.certificateId)?-1:BigInt(a.certificateId)>BigInt(b.certificateId)?1:0));
    // Include the source portion outside the saved links so rounding never assigns it to a donor.
    const members=selected.map(row=>({id:row.id,weight:units(row.carbonAmount)}));
    if(total>assigned)members.push({id:'__unattributed__',weight:total-assigned});
    const shares=splitImpact(total,fills,members);
    for(const bridge of selected){
      const share=shares.find(row=>row.id===bridge.id);
      const group=bridge.allocationSnapshot||recordFor(state.allocations,bridge.allocationId,'payout allocation');
      need(group.id===bridge.allocationId&&(!bridge.allocationVersion||group.version===bridge.allocationVersion)&&group.payoutKey===bridge.payoutKey&&group.ledgerEditionId===ledgerEditionId,
        'BRIDGE_ALLOCATION_MISMATCH','Keep each association with its active source payout allocation.');
      const payments=splitImpact(BigInt(share.carbonAtoms),share.certificates,group.parts.map(row=>({id:row.paymentKey,weight:BigInt(row.amountAtoms)})));
      for(const payment of payments)result.push({...payment,paymentKey:payment.id,bridgeId:bridge.id,allocationId:group.id,
        payoutKey:bridge.payoutKey,sinkHash,sink:copy(sink),method:group.method,allocationVersion:group.version,allocationSnapshot:copy(group),
        bridgePaymentAtoms:bridge.paymentAtoms,sourceCarbonAmount:bridge.carbonAmount});
    }
  }
  return result;
}
function splitForRegistry(state,impact,registryEditionId,ledgerEditionId){
  const source=ledger(state,ledgerEditionId),payment=transferFor(source,impact.paymentKey);
  const links=state.paymentLinks.filter(row=>active(row)&&row.registryEditionId===registryEditionId&&
    row.ledgerEditionId===ledgerEditionId&&row.paymentKey===payment.key);
  const sum=links.reduce((n,row)=>n+BigInt(row.amountAtoms),0n),total=BigInt(payment.amountAtoms);
  need(sum<=total,'PAYMENT_LINK_OVERDRAWN','Saved donation shares exceed the source payment.');
  const members=links.map(row=>({id:row.id,weight:BigInt(row.amountAtoms)}));
  if(sum<total)members.push({id:'__unassigned__',weight:total-sum});
  if(!members.length)return [];
  return splitImpact(BigInt(impact.carbonAtoms),impact.certificates,members).filter(row=>row.id!=='__unassigned__')
    .map(row=>({...copy(impact),...row,paymentKey:payment.key,linkId:row.id,donationId:links.find(link=>link.id===row.id).donationId}));
}
function sumAssets(rows,mode){
  const totals=new Map();
  for(const row of rows){
    const asset=mode==='registry'?{key:[row.chain||'',row.network||'',row.asset||'',row.issuer||''].join('|'),
      code:row.asset||'Unspecified asset',issuer:row.issuer||null,network:row.network||null,chain:row.chain||null,decimals:4}:row.asset;
    const current=totals.get(asset.key)||{asset:copy(asset),value:0n,count:0};
    current.value+=mode==='registry'?units(row.amount,4):BigInt(row.amountAtoms);current.count++;totals.set(asset.key,current);
  }
  return [...totals.values()].map(row=>({asset:row.asset,amountAtoms:String(row.value),amount:decimal(row.value,Number(row.asset.decimals)),records:row.count}));
}
export function prepareStatement(state,input){
  const period=windowOf(input),basis=input.basis||'REGISTRY_CREATED';
  need(['REGISTRY_CREATED','LEDGER_CLOSED'].includes(basis),'STATEMENT_BASIS','Choose registry creation or native ledger close time.');
  const registrySource=input.registryEditionId?registry(state,input.registryEditionId):null;
  const native=input.ledgerEditionId?ledger(state,input.ledgerEditionId):null;
  const carbon=input.carbonEditionId?editionFor(state,input.carbonEditionId,'carbon'):null;
  need(basis==='REGISTRY_CREATED'?registrySource:native,'STATEMENT_SOURCE_REQUIRED','Choose the original source for this statement date basis.');
  need(!carbon||native,'LEDGER_SOURCE_REQUIRED','Choose the payout ledger edition for carbon attribution.');
  if(input.organizationId)need(registrySource,'REGISTRY_SOURCE_REQUIRED','Choose the registry source for organization selection.');
  if(input.initiativeId)need(registrySource,'REGISTRY_SOURCE_REQUIRED','Choose the registry source for initiative selection.');
  const selection={...period,organizationId:input.organizationId||null,initiativeId:input.initiativeId||null,donorAddress:input.donorAddress||null};
  const donations=registrySource?registrySource.tables.donations.filter(row=>registrySelection(row,basis==='REGISTRY_CREATED'?selection:
    {organizationId:selection.organizationId,initiativeId:selection.initiativeId,donorAddress:selection.donorAddress})):[];
  const donationIds=new Set(donations.map(row=>row.id));
  const links=registrySource&&native?state.paymentLinks.filter(row=>active(row)&&row.registryEditionId===registrySource.id&&
    row.ledgerEditionId===native.id&&donationIds.has(row.donationId)):[];
  let payments=[];
  if(native){
    if(basis==='REGISTRY_CREATED'){
      const byPayment=new Map();
      for(const link of links){const total=byPayment.get(link.paymentKey)||0n;byPayment.set(link.paymentKey,total+BigInt(link.amountAtoms));}
      payments=[...byPayment].map(([key,value])=>({...copy(transferFor(native,key)),amountAtoms:String(value),sourceAmountAtoms:transferFor(native,key).amountAtoms}));
    }else{
      const anchored=new Set(links.map(row=>row.paymentKey));
      const nativeKeys=new Set(nativePayments(native).map(row=>row.key));
      let originals=native.tables.transfers.filter(row=>(nativeKeys.has(row.key)||anchored.has(row.key))&&completeTx(native,row.hash)&&
        inWindow(row.createdAt,period)&&(!selection.donorAddress||row.from===selection.donorAddress));
      if(selection.organizationId||selection.initiativeId){
        const amounts=new Map();
        for(const link of links)amounts.set(link.paymentKey,(amounts.get(link.paymentKey)||0n)+BigInt(link.amountAtoms));
        originals=originals.filter(row=>amounts.has(row.key));
        payments=originals.map(row=>({...copy(row),sourceAmountAtoms:row.amountAtoms,amountAtoms:String(amounts.get(row.key))}));
      }else payments=copy(originals);
    }
  }
  const paymentIds=new Set(payments.map(row=>row.key));
  let impacts=[];
  if(native&&carbon){
    const all=carbonAttributions(state,native.id,carbon.id);
    if(basis==='REGISTRY_CREATED'||selection.organizationId||selection.initiativeId)
      impacts=all.flatMap(row=>splitForRegistry(state,row,registrySource.id,native.id)).filter(row=>donationIds.has(row.donationId)&&paymentIds.has(row.paymentKey));
    else impacts=all.filter(row=>paymentIds.has(row.paymentKey));
  }
  const selectedDonations=(basis==='REGISTRY_CREATED'?donations:donations.filter(row=>links.some(link=>link.donationId===row.id&&paymentIds.has(link.paymentKey))))
    .map(row=>({...copy(row),organization:copy(registrySource.tables.organizations.find(item=>item.id===row.organizationId)||row.organization||null),
      initiative:copy(registrySource.tables.initiatives.find(item=>item.id===row.initiativeId)||row.initiative||null)}));
  const certificateMap=new Map();
  for(const impact of impacts)for(const row of impact.certificates){
    const known=certificateMap.get(row.certificateId)||{...copy(row.certificate),attributedAtoms:0n};
    known.attributedAtoms+=BigInt(row.amountAtoms);certificateMap.set(row.certificateId,known);
  }
  const certificateRows=[...certificateMap.values()].map(row=>{const {attributedAtoms,...rest}=row;
    return {...rest,attributedAmount:decimal(attributedAtoms),withinRetirementPeriod:inWindow(row.retirement_date,period)};});
  const selectedReceiptRows=registrySource?registrySource.tables.nfts.filter(row=>
    selectedDonations.some(donation=>row.donationId===donation.id)||payments.some(payment=>receiptMatches(native,row,payment))):[];
  const receiptGroups=new Map();
  for(const row of selectedReceiptRows)if(row.transactionId){const resolved=native&&transactionFor(native,row.transactionId);const key=resolved?'stellar:'+resolved.network+':'+resolved.hash:keyForReceipt(row);const list=receiptGroups.get(key)||[];list.push(row.id);receiptGroups.set(key,list);}
  const relatedAllocations=native?state.allocations.filter(row=>active(row)&&row.ledgerEditionId===native.id&&row.parts.some(part=>paymentIds.has(part.paymentKey))):[];
  const fundingVersions=[...new Map([...relatedAllocations,...impacts.map(row=>row.allocationSnapshot).filter(Boolean)]
    .map(row=>[row.id+':'+row.version,row])).values()];
  const selectedLinkIds=new Set(links.filter(row=>paymentIds.has(row.paymentKey)).map(row=>row.id));
  function selectedFunding(part){
    if(!(basis==='REGISTRY_CREATED'||selection.organizationId||selection.initiativeId))return copy(part);
    const original=transferFor(native,part.paymentKey),all=state.paymentLinks.filter(row=>active(row)&&row.registryEditionId===registrySource.id&&
      row.ledgerEditionId===native.id&&row.paymentKey===part.paymentKey);
    const assigned=all.reduce((n,row)=>n+BigInt(row.amountAtoms),0n),gross=BigInt(original.amountAtoms);
    need(assigned<=gross,'PAYMENT_LINK_OVERDRAWN','Saved donation shares exceed the original payment.');
    const members=all.map(row=>({id:row.id,weight:BigInt(row.amountAtoms)}));
    if(assigned<gross)members.push({id:'__unassigned__',weight:gross-assigned});
    const split=apportion(BigInt(part.amountAtoms),members),selectedAtoms=split.filter(row=>selectedLinkIds.has(row.id)).reduce((n,row)=>n+row.amount,0n);
    return {...copy(part),amountAtoms:String(selectedAtoms),sourceFundingAtoms:part.amountAtoms,
      selectedLinkIds:all.filter(row=>selectedLinkIds.has(row.id)).map(row=>row.id)};
  }
  const relatedPayouts=fundingVersions.map(row=>({
    payout:copy(transferFor(native,row.payoutKey)),allocationId:row.id,allocationVersion:row.version,method:row.method,
    current:state.allocations.some(value=>active(value)&&value.id===row.id&&value.version===row.version),
    usedForCarbon:impacts.some(value=>value.allocationId===row.id&&value.allocationVersion===row.version),
    selectedFunding:row.parts.filter(part=>paymentIds.has(part.paymentKey)).map(selectedFunding),wholeFunding:copy(row.parts),
  }));
  const usedAllocationIds=new Set(fundingVersions.map(row=>row.id)),usedBridgeIds=new Set(impacts.map(row=>row.bridgeId));
  const toSource=source=>source?{id:source.id,label:source.label,kind:source.kind,importedAt:source.importedAt,
    sha256:source.sha256||null,metadata:copy(source.metadata)}:null;
  const totalCarbon=impacts.reduce((n,row)=>n+BigInt(row.carbonAtoms),0n),filled=impacts.reduce((n,row)=>n+BigInt(row.allocatedAtoms),0n);
  return {schema:STATEMENT_SCHEMA,spec:{title:text(input.title,'statement title',300),basis,...selection,
      registryEditionId:registrySource?.id||null,ledgerEditionId:native?.id||null,carbonEditionId:carbon?.id||null,note:text(input.note||'','statement note',10000,true)},
    sources:{registry:toSource(registrySource),ledger:toSource(native),carbon:toSource(carbon)},
    dateBasis:basis==='REGISTRY_CREATED'?'Original Donation.created; inclusive start and exclusive end. Linked payments and retirements are known at the retained source editions.':
      'Native payment ledger close time; inclusive start and exclusive end. Registry creation and certificate retirement dates remain separate.',
    allocationBasis:'Saved operator payment assignments, exact native payout funding allocations and explicit payout-to-sink associations. Later linked certificate dates remain visible.',
    retirementDateBasis:'The dated retirement register contains only linked certificates whose own retirement_date falls inside this period.',
    totals:{registryRecords:selectedDonations.length,registryAssets:sumAssets(selectedDonations,'registry'),
      registryUSD:decimal(selectedDonations.reduce((n,row)=>n+units(row.usdvalue,4),0n),4),paymentRecords:payments.length,paymentAssets:sumAssets(payments,'ledger'),
      carbon:decimal(totalCarbon),allocated:decimal(filled),remaining:decimal(totalCarbon-filled),
      linkedCertificates:certificateRows.length,periodCertificates:certificateRows.filter(row=>row.withinRetirementPeriod).length},
    coverage:{registryDateBasis:basis==='REGISTRY_CREATED',ledgerDateBasis:basis==='LEDGER_CLOSED',
      unassignedDonations:selectedDonations.filter(row=>!links.some(link=>link.donationId===row.id)).length,
      receiptsWithSharedPayment:[...receiptGroups].filter(([,ids])=>ids.length>1).map(([paymentKey,receiptIds])=>({paymentKey,receiptIds})),
      paymentSourceAvailable:Boolean(native),carbonSourceAvailable:Boolean(carbon)},
    organization:copy(registrySource?.tables.organizations.find(row=>row.id===selection.organizationId)||null),
    initiative:copy(registrySource?.tables.initiatives.find(row=>row.id===selection.initiativeId)||null),
    donations:copy(selectedDonations),payments:copy(payments),receipts:copy(selectedReceiptRows),impacts,
    relatedPayouts,
    certificates:certificateRows,retirementRegister:certificateRows.filter(row=>row.withinRetirementPeriod),
    assignmentSnapshot:copy(links.filter(row=>paymentIds.has(row.paymentKey))),
    allocationSnapshot:copy([...new Map([...state.allocations.filter(row=>usedAllocationIds.has(row.id)),
      ...impacts.map(row=>row.allocationSnapshot).filter(Boolean)].map(row=>[row.id+':'+row.version,row])).values()]),
    bridgeSnapshot:copy(state.bridges.filter(row=>usedBridgeIds.has(row.id)))};
}

function normalizePaymentLink(state,input){
  const reg=registry(state,input.registryEditionId),native=ledger(state,input.ledgerEditionId);
  const donation=donationFor(reg,input.donationId),payment=transferFor(native,input.paymentKey);
  need(completeTx(native,payment.hash),'PAYMENT_SUCCESS_REQUIRED','Choose an original successful ledger payment.');
  const value=BigInt(atoms(input.amountAtoms));
  need(value>0n,'PAYMENT_SHARE_REQUIRED','Enter a positive share of the actual token atoms.');
  const used=state.paymentLinks.filter(row=>active(row)&&row.id!==input.id&&row.registryEditionId===reg.id&&row.ledgerEditionId===native.id&&row.paymentKey===payment.key)
    .reduce((n,row)=>n+BigInt(row.amountAtoms),0n);
  need(used+value<=BigInt(payment.amountAtoms),'PAYMENT_LINK_OVERDRAWN','Donation assignments exceed this original payment.');
  if(input.receiptId){
    const receipt=recordFor(reg.tables.nfts,input.receiptId,'original receipt');
    need(receiptMatches(native,receipt,payment),'RECEIPT_PAYMENT_MISMATCH','The receipt must retain this exact original payment hash and network.');
  }
  return {registryEditionId:reg.id,ledgerEditionId:native.id,donationId:donation.id,paymentKey:payment.key,
    amountAtoms:String(value),receiptId:input.receiptId||null,note:text(input.note,'source assignment note',10000),
    active:input.active!==false,source:{donation:copy(donation),payment:copy(payment)},
    walletMatches:!donation.wallet||donation.wallet===payment.from,
    registryAmount:donation.amount,registryPrecision:4,ledgerPrecision:Number(payment.asset.decimals)};
}
function saveRecord(rows,value,context,normalize){
  const recordId=value.id?id(value.id):context.recordId,existing=rows.find(row=>row.id===recordId);
  if(existing)need(value.expectedVersion===existing.version,'STALE_RECORD','Reload the current mapping before saving.',409);
  const saved={...normalize(value),id:recordId,version:(existing?.version||0)+1,createdAt:existing?.createdAt||context.at,updatedAt:context.at};
  if(existing)rows[rows.indexOf(existing)]=saved;else rows.push(saved);return copy(saved);
}
export function statementVersion(state,statementId,version){
  const statement=recordFor(state.statements,statementId,'saved statement');
  const selected=version===undefined||version===null||version===''?statement.versions.at(-1):statement.versions.find(row=>row.version===Number(version));
  need(selected,'STATEMENT_VERSION_NOT_FOUND','Choose an original statement version.',404);return copy(selected);
}
export function compareEditions(state,beforeId,afterId){
  const before=editionFor(state,beforeId),after=editionFor(state,afterId);
  need(before.kind===after.kind,'COMPARISON_KIND','Compare two editions of the same source kind.');
  if(before.kind==='ledger'||before.kind==='carbon')need(before.metadata.network===after.metadata.network,'COMPARISON_NETWORK','Compare editions from the same network.');
  if(before.kind==='carbon'){
    const comparison=compareCarbonEditions({editions:[{...before.carbon,id:before.id},{...after.carbon,id:after.id}]},before.id,after.id);
    const tables=Object.fromEntries(Object.entries(comparison.tables).map(([name,row])=>[name,{...row,
      added:row.added.map(value=>({key:value.key,row:value.after})),removed:row.removed.map(value=>({key:value.key,row:value.before}))}]));
    return {schema:'stellar-forge.givecredit-comparison.v1',before:{id:before.id,label:before.label},after:{id:after.id,label:after.label},kind:before.kind,tables};
  }
  const leftTables=before.tables,rightTables=after.tables,tables={};
  const coverageFor=(source,table)=>{
    const declared=source.metadata.coverage;
    if(source.kind==='registry'&&Array.isArray(declared))return {available:declared.includes(table),scope:'Original exported registry tables'};
    if(source.kind==='registry'&&plain(declared)&&Object.keys(declared).length){
      const record=declared[table];
      return {available:Boolean(record)&&!['capturing','interrupted'].includes(record.status),scope:record?.scope||null};
    }
    return {available:Array.isArray(source.tables[table]),scope:copy(source.metadata.selection||null)};
  };
  const identity=(name,row)=>name==='transactions'?txKey(row):row.key||row.id||
    (name==='sink_status'?row.sinking_tx_hash+':'+row.certificate_id:name==='retirement_from_block'?row.retirement_id+':'+row.block_hash:
    name==='distribution_txs'?row.toid:name==='minted_blocks'?row.serial_hash:row.hash||row.serial_hash||row.certificate_id||row.toid);
  for(const table of [...new Set([...Object.keys(leftTables),...Object.keys(rightTables)])]){
    const left=new Map((leftTables[table]||[]).map(row=>[identity(table,row),row])),right=new Map((rightTables[table]||[]).map(row=>[identity(table,row),row]));
    const added=[],removed=[],changed=[],coverage={before:coverageFor(before,table),after:coverageFor(after,table)};
    if(!coverage.before.available||!coverage.after.available){
      tables[table]={comparisonStatus:'unavailable',coverage,
        note:!coverage.before.available&&!coverage.after.available?'Neither source acquired this table.':!coverage.before.available?'The earlier source did not acquire this table.':'The later source did not acquire this table.',
        counts:{before:left.size,after:right.size,added:null,removed:null,changed:null},added,removed,changed};
      continue;
    }
    for(const [key,row] of right)if(!left.has(key))added.push({key,row:copy(row)});else if(canonical(left.get(key))!==canonical(row))changed.push({key,before:copy(left.get(key)),after:copy(row)});
    for(const [key,row] of left)if(!right.has(key))removed.push({key,row:copy(row)});
    tables[table]={comparisonStatus:'available',coverage,note:'Differences between retained original table populations; each edition keeps its acquisition scope.',counts:{before:left.size,after:right.size,added:added.length,removed:removed.length,changed:changed.length},added,removed,changed};
  }
  return {schema:'stellar-forge.givecredit-comparison.v1',before:{id:before.id,label:before.label},after:{id:after.id,label:after.label},kind:before.kind,tables};
}
export function mutate(state,operation,{reuseImmutableEditions=false}={}){
  validateWorkspace(state);
  need(plain(operation)&&plain(operation.value),'OPERATION_REQUIRED','Send a complete operator action.');
  const requestId=id(operation.requestId),actor=text(operation.actor||'Local operator','operator',300);
  const intent=operation.intentSha256||canonical({action:operation.action,value:operation.value,actor});
  const previous=state.operations.find(row=>row.requestId===requestId);
  if(previous){need(previous.intent===intent,'REQUEST_REUSED','This request identifier belongs to another operation.',409);return {state,result:copy(previous.result),replayed:true};}
  need(operation.revision===state.revision,'STALE_WORKSPACE','Refresh the workspace before saving.',409);
  if(reuseImmutableEditions)need(state.editions.every(isImmutableJSON),'IMMUTABLE_EDITIONS_REQUIRED','Native edition reuse requires deeply retained immutable source editions.');
  const next=reuseImmutableEditions?{...copy({...state,editions:[]}),editions:[...state.editions]}:copy(state),value=operation.value,context={recordId:id(operation.recordId||requestId),at:operation.at||now()};
  let result;
  if(operation.action==='import'){
    validateSourceEdition(value.source);
    const previous=value.source.sha256&&next.editions.find(row=>row.sha256===value.source.sha256);
    if(previous)result={edition:{id:previous.id,label:previous.label,...sourceSummary(previous)},alreadyPresent:true};
    else{const retainedSource=reuseImmutableEditions&&isImmutableJSON(value.source)?value.source:copy(value.source);
      const source={...retainedSource,id:context.recordId,label:text(value.label,'source edition label',300),importedAt:context.at};
      next.editions.push(source);result={edition:{id:source.id,label:source.label,...sourceSummary(source)}};}
  }else if(operation.action==='payment-link'){
    result={paymentLink:saveRecord(next.paymentLinks,value,context,input=>normalizePaymentLink(next,input))};
  }else if(operation.action==='allocation'){
    need(!next.allocations.some(row=>active(row)&&row.id!==value.id&&row.ledgerEditionId===value.ledgerEditionId&&row.payoutKey===value.payoutKey),
      'PAYOUT_ALREADY_ALLOCATED','Edit the existing allocation for this original payout.');
    if(value.active===false)need(!next.bridges.some(row=>active(row)&&row.allocationId===value.id),'ALLOCATION_HAS_ASSOCIATIONS','Edit the associated sink links before retiring this allocation.');
    result={allocation:saveRecord(next.allocations,value,context,input=>prepareAllocation(next,input))};
  }else if(operation.action==='bridge'){
    result={bridge:saveRecord(next.bridges,value,context,input=>prepareBridge(next,input))};
  }else if(operation.action==='statement'){
    const existing=value.id?recordFor(next.statements,value.id,'saved statement'):null;
    if(existing)need(value.expectedVersion===existing.versions.at(-1).version,'STALE_STATEMENT','Reopen the latest statement before issuing a new version.',409);
    const statementId=existing?.id||context.recordId,report=prepareStatement(next,value);
    const saved={...report,version:(existing?.versions.at(-1).version||0)+1,createdAt:context.at,actor};
    if(existing){existing.versions.push(saved);existing.updatedAt=context.at;}
    else next.statements.push({id:statementId,title:report.spec.title,createdAt:context.at,updatedAt:context.at,versions:[saved]});
    result={statementId,statement:copy(saved)};
  }else if(operation.action==='settings'){
    next.name=text(value.name,'workspace name',300);result={name:next.name};
  }else if(operation.action==='carry-payment-links'){
    const beforeRegistry=registry(next,value.fromRegistryEditionId),afterRegistry=registry(next,value.toRegistryEditionId);
    const beforeLedger=ledger(next,value.fromLedgerEditionId),afterLedger=ledger(next,value.toLedgerEditionId);
    need(beforeLedger.metadata.network===afterLedger.metadata.network,'SOURCE_NETWORK_MISMATCH','Carry assignments across the same network.');
    const created=[],changed=[];
    for(const link of next.paymentLinks.filter(row=>active(row)&&row.registryEditionId===beforeRegistry.id&&row.ledgerEditionId===beforeLedger.id)){
      const donation=afterRegistry.tables.donations.find(row=>row.id===link.donationId),payment=afterLedger.tables.transfers.find(row=>row.key===link.paymentKey);
      const priorDonation=donationFor(beforeRegistry,link.donationId),priorPayment=transferFor(beforeLedger,link.paymentKey);
      const donationCore=row=>row&&[row.id,row.organizationId,row.initiativeId,row.wallet,row.chain,row.network,row.asset,row.issuer,row.amount,row.usdvalue,row.created];
      const paymentCore=row=>row&&[row.hash,row.network,row.from,row.to,row.amountAtoms,row.asset,row.ledger,row.createdAt];
      if(!donation||!payment||canonical(donationCore(donation))!==canonical(donationCore(priorDonation))||canonical(paymentCore(payment))!==canonical(paymentCore(priorPayment))){
        changed.push({linkId:link.id,donationId:link.donationId,paymentKey:link.paymentKey});continue;
      }
      if(next.paymentLinks.some(row=>active(row)&&row.registryEditionId===afterRegistry.id&&row.ledgerEditionId===afterLedger.id&&row.donationId===link.donationId&&row.paymentKey===link.paymentKey))continue;
      const data={...copy(link),id:undefined,expectedVersion:undefined,registryEditionId:afterRegistry.id,ledgerEditionId:afterLedger.id,
        receiptId:link.receiptId&&afterRegistry.tables.nfts.some(row=>row.id===link.receiptId)?link.receiptId:null};
      const saved=saveRecord(next.paymentLinks,data,{...context,recordId:context.recordId+'-'+created.length},input=>normalizePaymentLink(next,input));created.push(saved);
    }
    result={created,changed};
  }else throw Object.assign(new Error('Choose a supported GiveCredit operator action.'),{code:'UNKNOWN_ACTION',status:400});
  next.revision++;
  next.history.push({requestId,action:operation.action,actor,at:context.at,revision:next.revision,recordId:context.recordId});
  next.operations.push({requestId,intent,result:copy(result),revision:next.revision});
  return {state:next,result:copy(result),replayed:false};
}
export function workspaceOverview(state){
  validateWorkspace(state);
  return {schema:state.schema,workspaceId:state.workspaceId,name:state.name,revision:state.revision,createdAt:state.createdAt,
    editions:state.editions.map(source=>({id:source.id,label:source.label,importedAt:source.importedAt,sha256:source.sha256||null,metadata:copy(source.metadata),...sourceSummary(source)})),
    paymentLinks:copy(state.paymentLinks),allocations:copy(state.allocations),bridges:copy(state.bridges),
    statements:state.statements.map(row=>({id:row.id,title:row.versions.at(-1).spec.title,versions:row.versions.length,createdAt:row.createdAt,updatedAt:row.updatedAt,
      latest:{version:row.versions.at(-1).version,spec:copy(row.versions.at(-1).spec),totals:copy(row.versions.at(-1).totals)}})),
    history:copy(state.history.slice(-50))};
}
export function exportHandover(state){validateWorkspace(state);return {schema:HANDOVER_SCHEMA,exportedAt:now(),workspace:copy(state)};}
export function receiveHandover(value,{workspaceId}={}){
  need(value?.schema===HANDOVER_SCHEMA,'HANDOVER_SCHEMA','Receive the full editable GiveCredit workspace export.');
  const state=validateWorkspace(copy(value.workspace));
  if(workspaceId){state.receivedFrom={workspaceId:state.workspaceId,exportedAt:value.exportedAt,receivedAt:now()};state.workspaceId=id(workspaceId);}
  return state;
}

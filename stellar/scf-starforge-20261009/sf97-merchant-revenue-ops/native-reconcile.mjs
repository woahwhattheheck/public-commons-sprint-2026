// MIT. SF97 merchant revenue view joined to ORIGINAL SF98 native-success outbox.
// Read-only source reconciliation, not payment verification or a transaction ledger.
import { createHash } from 'node:crypto';
import { lstat, readFile, mkdir, open } from 'node:fs/promises';
import { resolve, join, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { normalizeSellerPaymentOptions } from '../sf30-seller-sdk/seller.mjs';
import { supportsSellerMethod } from '../sf30-seller-sdk/http-methods.mjs';
import { normalizeTrafficHistoryReport } from '../sf30-seller-sdk/operations/history.mjs';

const HASH=/^[a-f0-9]{64}$/;
const NATIVE='stellar-forge.sf98.delivery-event.v1';
const TRAFFIC='stellar-forge.merchant-revenue-ops.v1';
const sha=b=>createHash('sha256').update(b).digest('hex');
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const fail=x=>{throw new Error(x);};
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time=x=>typeof x==='string'&&Number.isFinite(Date.parse(x))?Date.parse(x):NaN;
const number=x=>Number.isSafeInteger(x)&&x>=0;
const flags=['DELIVERED','RETRY','EXHAUSTED','REQUEUE'];
async function strictFile(path,max=64*1024*1024){
  if(!isAbsolute(path)||resolve(path)!==path)fail('ABSOLUTE_NORMALIZED_SOURCE_REQUIRED');
  const s=await lstat(path);
  if(!s.isFile()||s.isSymbolicLink()||s.size>max||(s.mode&0o077)!==0)
    fail('PRIVATE_SOURCE_FILE_REQUIRED_0600');
  const bytes=await readFile(path);
  if(bytes.length>max)fail('SOURCE_SIZE_EXCEEDED');
  return bytes;
}
async function journal(path){
  let bytes;
  try{bytes=await strictFile(path);}
  catch(e){if(e.code==='ENOENT')return {rows:[],hash:null,bytes:0};throw e;}
  const source=bytes.toString('utf8');
  if(source&&!source.endsWith('\n'))fail('TRUNCATED_ORIGINAL_SF98_JOURNAL');
  const rows=source.split('\n').filter(Boolean).map((line,index)=>{
    let r;try{r=JSON.parse(line);}catch{fail('INVALID_ORIGINAL_SF98_JSON_LINE_'+(index+1));}
    if(!object(r))fail('INVALID_ORIGINAL_SF98_JOURNAL_ROW_'+(index+1));
    return r;
  });
  return {rows,hash:sha(bytes),bytes:bytes.length};
}
function nativeEvent(e){
  if(!object(e)||e.schema!==NATIVE||!HASH.test(e.id)||
    typeof e.routeId!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(e.routeId)||
    !supportsSellerMethod(e.method)||!['stellar:testnet','stellar:pubnet'].includes(e.network)||
    typeof e.amountAtomic!=='string'||!/^[0-9]+$/.test(e.amountAtomic)||
    typeof e.assetDigest!=='string'||!HASH.test(e.assetDigest)||
    (e.recipientDigest!=null&&(typeof e.recipientDigest!=='string'||!HASH.test(e.recipientDigest)))||
    !HASH.test(e.receiptFingerprint)||e.authority!=='ORIGINAL_NATIVE_PROCESS_SETTLEMENT_SUCCESS'||
    !Number.isFinite(time(e.at)))fail('NONCANONICAL_ORIGINAL_SF98_NATIVE_EVENT');
}
function delivery(d,ids){
  if(!HASH.test(d.id)||!ids.has(d.id)||!flags.includes(d.state)||
    !number(d.attempt)||!Number.isFinite(time(d.at)))fail('INVALID_OR_ORPHAN_SF98_DELIVERY');
}
function paymentIdentity(p){
  const {scheme,network,asset,atomicAmount,payTo}=p;
  return {scheme,network,asset,atomicAmount,payTo};
}
function routeOptions(r){
  let options;
  if(Object.hasOwn(r,'paymentOptions')){
    if(!Array.isArray(r.paymentOptions))fail('INVALID_ORIGINAL_SF97_PAYMENT_OPTIONS');
    // Reuse the original seller's complete validation, including duplicate rails,
    // timeout and extra JSON limits. Old reports below predate those new fields.
    options=normalizeSellerPaymentOptions({paymentOptions:r.paymentOptions.map(p=>{
      if(!object(p)||Object.hasOwn(p,'amount'))fail('INVALID_ORIGINAL_SF97_PAYMENT_OPTION');
      const {atomicAmount,...rest}=p;
      return {...rest,amount:atomicAmount};
    })}).map(p=>({scheme:p.scheme,network:p.network,asset:p.asset,
      atomicAmount:p.amount,payTo:p.payTo,maxTimeoutSeconds:p.maxTimeoutSeconds,
      ...(Object.hasOwn(p,'extra')?{extra:p.extra}:{})}));
    if(r.payment!=null&&(options.length!==1||
      !isDeepStrictEqual(paymentIdentity(r.payment),paymentIdentity(options[0]))))
      fail('CONFLICTING_ORIGINAL_SF97_PAYMENT_FIELDS');
  }else{
    const p=r.payment;
    if(!object(p)||p.scheme!=='exact'||!['stellar:testnet','stellar:pubnet'].includes(p.network)||
      typeof p.atomicAmount!=='string'||!/^[1-9][0-9]*$/.test(p.atomicAmount)||
      typeof p.asset!=='string'||!p.asset||typeof p.payTo!=='string'||!p.payTo)
      fail('INVALID_LEGACY_SF97_PAYMENT');
    options=[paymentIdentity(p)];
  }
  return options.map((p,index)=>{
    const assetDigest=sha(p.asset),recipientDigest=sha(p.payTo);
    // Same identity as merchant-settlement-accounting: exact selected terms,
    // independent of presentation order or the merchant's USD quote.
    const key=[r.routeId,r.method,p.network,assetDigest,p.atomicAmount,recipientDigest].join('\n');
    return {optionId:sha('stellar-forge.merchant-option.v1\n'+key),
      optionIndex:index+1,routeId:r.routeId,method:r.method,scheme:p.scheme,
      network:p.network,assetDigest,amountAtomic:p.atomicAmount,recipientDigest,
      maxTimeoutSeconds:p.maxTimeoutSeconds??null,
      hasExtra:Object.hasOwn(p,'extra'),
      termsSource:Object.hasOwn(r,'paymentOptions')?'COMPLETE_OPTIONS':'LEGACY_SINGLE_PAYMENT'};
  });
}
function traffic(report){
  const history=report?.observationKind==='DURABLE_HISTORY'?normalizeTrafficHistoryReport(report.usageHistory):null;
  if(!object(report)||report.schema!==TRAFFIC||
    !['CHALLENGE_ONLY','NATIVE_X402','UNKNOWN',...(history?['MIXED']:[])].includes(report.originalSellerMode)||
    !Array.isArray(report.routes)||(!history&&report.routes.length===0)||
    !Number.isFinite(time(report.observedFrom))||
    !Number.isFinite(time(report.observedUntil))||
    time(report.observedFrom)>time(report.observedUntil))fail('INVALID_ORIGINAL_SF97_REPORT');
  if(history){
    const mode=history.modes.length>1?'MIXED':history.modes[0]??'UNKNOWN';
    if(report.sessionId!==null||report.originalSellerMode!==mode||
      !isDeepStrictEqual(report.sessionIds,history.sessions.map(session=>session.sessionId)))
      fail('SF97_HISTORY_SESSION_IDENTITY_DIFFERS');
  }else if(Object.hasOwn(report,'usageHistory'))fail('SF97_HISTORY_OBSERVATION_KIND_REQUIRED');
  const routes=new Map();
  for(const r of report.routes){
    if(!object(r)||typeof r.routeId!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(r.routeId)||routes.has(r.routeId)||
      !supportsSellerMethod(r.method)||
      !/^[0-9]+$/.test(String(r.actual2xx))||
      !/^[0-9]+$/.test(String(r.actual402))||!number(Number(r.actual2xx))||
      !number(Number(r.actual402)))fail('INVALID_ORIGINAL_SF97_ROUTE');
    if(history){
      if(typeof r.path!=='string'||!r.path.startsWith('/')||
        (history.range.routeId!==null&&history.range.routeId!==r.routeId))fail('INVALID_SF97_HISTORY_ROUTE_SELECTION');
      const observed=history.routes.find(row=>row.id===r.routeId&&row.method===r.method&&row.path===r.path);
      if(Number(r.actual2xx)!==(observed?.success??0)||Number(r.actual402)!==(observed?.challenge??0))
        fail('SF97_ROUTE_COUNTERS_DIFFER_FROM_RETAINED_HISTORY');
    }
    routes.set(r.routeId,{source:r,options:routeOptions(r)});
  }
  return {routes,history};
}
function eventCoverage(report,history,routes){
  if(!history){
    const from=time(report.observedFrom),until=time(report.observedUntil);
    return e=>({included:time(e.at)>=from&&time(e.at)<=until,
      reason:'SESSION_INTERVAL',basis:'ORIGINAL_SESSION_INTERVAL',routeBinding:'CURRENT_ROUTE',
      sessionIds:[report.sessionId],modes:[report.originalSellerMode],routeKeys:[]});
  }
  const dayIndex=new Map(history.days.map(day=>[day.day,day]));
  const sessions=history.sessions.map(session=>({...session,from:time(session.startedAt),until:time(session.capturedAt),
    dayIndex:session.retainedDays===null?null:new Map(session.retainedDays.map(day=>[day.day,new Set(day.routeKeys)]))}));
  const dated=new Map();
  const excluded=reason=>({included:false,reason});
  return e=>{
    const at=time(e.at),date=new Date(at).toISOString().slice(0,10);
    if(history.range.outsideRetention||date<history.range.effectiveFrom||date>history.range.effectiveTo)
      return excluded('OUTSIDE_SELECTED_PERIOD');
    if(history.range.routeId!==null&&e.routeId!==history.range.routeId)return excluded('OUTSIDE_ROUTE_SELECTION');
    const day=dayIndex.get(date);
    if(!day)return excluded('NO_SAVED_DAY');
    if(!dated.has(date))dated.set(date,sessions.filter(session=>
      session.startedAt.slice(0,10)<=date&&session.capturedAt.slice(0,10)>=date&&
      (session.dayIndex===null||session.dayIndex.has(date))));
    const active=dated.get(date).filter(session=>at>=session.from&&at<=session.until);
    if(!active.length)return excluded('SESSION_GAP');
    const dayRoutes=day.routes.filter(row=>row.id===e.routeId&&row.method===e.method);
    const covered=[];
    for(const session of active){
      const keys=session.dayIndex?.get(date);
      const variants=dayRoutes.filter(row=>keys===undefined||keys.has(row.routeKey));
      if(variants.length)covered.push({session,variants});
    }
    if(!covered.length)return excluded('NO_SAVED_ROUTE_COVERAGE');
    const variants=[...new Map(covered.flatMap(row=>row.variants).map(row=>[row.routeKey,row])).values()];
    const current=routes.get(e.routeId)?.source;
    const matching=current?variants.filter(row=>row.path===current.path&&row.method===current.method):[];
    const routeBinding=!current?'REMOVED_ROUTE':matching.length===variants.length?'CURRENT_ROUTE':
      matching.length?'AMBIGUOUS_ROUTE_VARIANTS':'HISTORICAL_ROUTE_VARIANT';
    return {included:true,reason:'SAVED_SESSION_DAY_ROUTE',routeBinding,
      basis:covered.some(row=>row.session.dayIndex===null)?'LEGACY_SESSION_AND_DAY':'EXACT_SESSION_DAY_ROUTE',
      sessionIds:covered.map(row=>row.session.sessionId),modes:[...new Set(covered.map(row=>row.session.mode))].sort(),
      routeKeys:variants.map(row=>row.routeKey).sort()};
  };
}
export function reconcile(report,events,deliveries){
  const {routes,history}=traffic(report);
  const seen=new Map(),issue=[];
  for(const e of events){
    nativeEvent(e);
    if(seen.has(e.id)){
      if(JSON.stringify(seen.get(e.id))!==JSON.stringify(e))fail('CONFLICTING_SF98_NATIVE_EVENT_ID');
      continue;
    }
    seen.set(e.id,e);
  }
  const outcomes=new Map();
  for(const d of deliveries){delivery(d,seen);outcomes.set(d.id,d);}
  const cover=eventCoverage(report,history,routes);
  const considered=[...seen.values()].map(event=>({event,coverage:cover(event)}));
  const observed=considered.filter(row=>row.coverage.included);
  const excluded=considered.filter(row=>!row.coverage.included),outside=excluded.length;
  const excludedCounts={};
  for(const {coverage} of excluded)excludedCounts[coverage.reason]=(excludedCounts[coverage.reason]??0)+1;
  const byRoute=new Map(),byOption=new Map(),eventMatches=[];
  for(const {source:r,options} of routes.values()){
    byRoute.set(r.routeId,{
      routeId:r.routeId,method:r.method,http2xx:Number(r.actual2xx),
      http402:Number(r.actual402),nativeSuccessEvents:0,paymentOptionCount:options.length,
      acceptedByMerchantInbox:0,pendingDelivery:0,exhaustedDelivery:0,
      quotedUsd:r.quoteUsd,flags:[]
    });
    for(const option of options)byOption.set(option.optionId,{
      ...option,nativeSuccessEvents:0,acceptedByMerchantInbox:0,
      pendingDelivery:0,exhaustedDelivery:0,exactRecipientEvents:0,
      legacyUniqueRecipientEvents:0,nativeAtomicAmount:'0',
      inboxAcceptedAtomicAmount:'0',pendingAtomicAmount:'0',exhaustedAtomicAmount:'0',
      quotedUsd:r.quoteUsd,priceScope:'SHARED_ROUTE_QUOTE',http2xx:null,http402:null
    });
  }
  let unassigned=0;
  for(const {event:e,coverage} of observed){
    const r=routes.get(e.routeId);
    const hasRecipient=e.recipientDigest!=null;
    const currentCoverage=!['HISTORICAL_ROUTE_VARIANT','AMBIGUOUS_ROUTE_VARIANTS'].includes(coverage.routeBinding);
    const candidates=currentCoverage?r?.options.filter(p=>p.method===e.method&&p.network===e.network&&
      p.amountAtomic===e.amountAtomic&&p.assetDigest===e.assetDigest&&
      (!hasRecipient||p.recipientDigest===e.recipientDigest))??[]:[];
    const matched=candidates.length===1?candidates[0]:null;
    const termsMatch=!r?'MISSING_ROUTE_TERMS':!currentCoverage?coverage.routeBinding:matched?
      (hasRecipient?'EXACT_OPTION':'LEGACY_UNIQUE_OPTION'):
      (!hasRecipient&&candidates.length>1?'AMBIGUOUS_LEGACY_OPTIONS':'OPTION_TERMS_MISMATCH');
    const state=outcomes.get(e.id)?.state??'PENDING';
    eventMatches.push({eventId:e.id,at:e.at,routeId:e.routeId,method:e.method,
      network:e.network,assetDigest:e.assetDigest,amountAtomic:e.amountAtomic,
      recipientDigest:e.recipientDigest??null,receiptFingerprint:e.receiptFingerprint,
      termsRecipientDigest:matched?.recipientDigest??null,optionId:matched?.optionId??null,
      termsMatch,termsCandidateCount:candidates.length,
      candidateOptionIds:candidates.map(p=>p.optionId),deliveryState:state});
    if(history)Object.assign(eventMatches.at(-1),{observationMatch:coverage.reason,
      coverageBasis:coverage.basis,observedSessionIds:coverage.sessionIds,
      observedSessionModes:coverage.modes,usageRouteKeys:coverage.routeKeys});
    if(!matched){
      unassigned++;
      const flag=!r?'Original SF98 event route is absent from this SF97 seller report':
        !currentCoverage?'Saved history places this event on an older or ambiguous method/path variant; current route pricing is not assigned':
        termsMatch==='AMBIGUOUS_LEGACY_OPTIONS'?
          'Legacy SF98 event has no recipient digest and matches multiple offered recipients; no option selected':
          'Native SF98 original payment identity differs: method/network/amount/asset/recipient digest';
      issue.push({routeId:e.routeId,eventId:e.id,termsMatch,flag});
      continue;
    }
    const row=byRoute.get(e.routeId);
    const option=byOption.get(matched.optionId);
    for(const target of [row,option]){
      target.nativeSuccessEvents++;
      if(state==='DELIVERED')target.acceptedByMerchantInbox++;
      else if(state==='EXHAUSTED')target.exhaustedDelivery++;
      else target.pendingDelivery++;
    }
    option[hasRecipient?'exactRecipientEvents':'legacyUniqueRecipientEvents']++;
    const atomicField=state==='DELIVERED'?'inboxAcceptedAtomicAmount':
      state==='EXHAUSTED'?'exhaustedAtomicAmount':'pendingAtomicAmount';
    option.nativeAtomicAmount=String(BigInt(option.nativeAtomicAmount)+BigInt(e.amountAtomic));
    option[atomicField]=String(BigInt(option[atomicField])+BigInt(e.amountAtomic));
    if(history&&report.originalSellerMode==='MIXED'&&coverage.modes.every(mode=>mode==='CHALLENGE_ONLY'))
      issue.push({routeId:e.routeId,eventId:e.id,flag:'Native event overlaps only challenge-only saved session coverage; correlate the original seller and journal source'});
  }
  const aligned=[...byRoute.values()];
  for(const row of aligned){
    if(row.nativeSuccessEvents>0&&report.originalSellerMode==='CHALLENGE_ONLY')
      row.flags.push('Native success inside a challenge-only observation window: verify same original seller/session/source');
    if(row.nativeSuccessEvents>row.http2xx)
      row.flags.push('Native-success journal count exceeds observed HTTP 2xx in this window: check observer completeness/window');
    if(row.exhaustedDelivery)row.flags.push('Merchant callback delivery exhausted: repair merchant receiver and requeue explicitly');
    if(row.pendingDelivery)row.flags.push('Native-success callbacks awaiting merchant inbox delivery');
    issue.push(...row.flags.map(flag=>({routeId:row.routeId,flag})));
  }
  if(outside)issue.push({routeId:'*',flag:history?
    String(outside)+' native SF98 event(s) outside selected saved coverage: '+Object.entries(excludedCounts).map(([reason,n])=>reason+'='+n).join(', '):
    String(outside)+' native SF98 event(s) predate/postdate this original SF30 observation window; excluded, not discarded'});
  if(unassigned)issue.push({routeId:'*',flag:String(unassigned)+' native SF98 event(s) in window not aligned to original seller payment identity; require operator reconciliation'});
  const totals={
    originalOutboxEvents:seen.size,withinObservedWindow:observed.length,
    alignedNativeSuccessEvents:aligned.reduce((a,r)=>a+r.nativeSuccessEvents,0),
    deliveredToMerchantInbox:aligned.reduce((a,r)=>a+r.acceptedByMerchantInbox,0),
    pendingDelivery:aligned.reduce((a,r)=>a+r.pendingDelivery,0),
    exhaustedDelivery:aligned.reduce((a,r)=>a+r.exhaustedDelivery,0),
    unmatchedEventIdentity:unassigned,outsideObservationWindow:outside,
    configuredPaymentOptions:byOption.size,
    exactRecipientEvents:eventMatches.filter(e=>e.termsMatch==='EXACT_OPTION').length,
    legacyUniqueRecipientEvents:eventMatches.filter(e=>e.termsMatch==='LEGACY_UNIQUE_OPTION').length,
    ambiguousLegacyEvents:eventMatches.filter(e=>e.termsMatch==='AMBIGUOUS_LEGACY_OPTIONS').length
  };
  if(history)Object.assign(totals,{outsideSelectedPeriod:excludedCounts.OUTSIDE_SELECTED_PERIOD??0,
    outsideRouteSelection:excludedCounts.OUTSIDE_ROUTE_SELECTION??0,
    outsideSavedCoverage:(excludedCounts.NO_SAVED_DAY??0)+(excludedCounts.SESSION_GAP??0)+(excludedCounts.NO_SAVED_ROUTE_COVERAGE??0),
    historicalRouteVariantEvents:eventMatches.filter(e=>['HISTORICAL_ROUTE_VARIANT','AMBIGUOUS_ROUTE_VARIANTS'].includes(e.termsMatch)).length});
  return {schema:'stellar-forge.sf97-native-merchant-reconciliation.v1',
    generatedAt:new Date().toISOString(),merchantName:report.merchantName,
    sessionId:report.sessionId,sellerMode:report.originalSellerMode,
    observedFrom:report.observedFrom,observedUntil:report.observedUntil,
    ...(history?{observationKind:'DURABLE_HISTORY',sessionIds:report.sessionIds,
      usageSummary:{range:history.range,modes:history.modes,days:history.days.length,
        coverageFormat:history.coverageFormat,sessions:history.sessions.map(({retainedDays,...session})=>session),
        excludedByReason:excludedCounts},
      excludedEvents:excluded.map(({event:e,coverage})=>({eventId:e.id,at:e.at,routeId:e.routeId,
        method:e.method,reason:coverage.reason}))}:{}),
    totals,routes:aligned,options:[...byOption.values()],events:eventMatches,issues:issue,
    boundaries:{
      originalSf98NativeProcessSettlementOnly:true,
      nativeEventIsIndependentChainProof:false,customerFulfillmentKnown:false,
      callbackDeliveredDoesNotProveMerchantFulfilled:true,
      revenueBooked:false,sessionsMustBeOperatorCorrelated:true,
      httpCountersHaveNoPaymentOptionAttribution:true,atomicTotalsScopedToCompleteOption:true,
      legacyRecipientMatchesRequireUniqueCandidate:true,
      ...(history?{retainedSessionGapsExcluded:true,currentPricesNotAssignedToHistoricalRouteVariants:true}: {})
    }};
}
function coverageHtml(report){
  if(!report.usageSummary)return '';
  const scope=report.usageSummary;
  const reasons={OUTSIDE_SELECTED_PERIOD:'Outside the selected retained UTC period',
    OUTSIDE_ROUTE_SELECTION:'Different route from the selected history filter',
    NO_SAVED_DAY:'No saved observations on that UTC day',SESSION_GAP:'Outside saved original session intervals',
    NO_SAVED_ROUTE_COVERAGE:'No saved session/day coverage for this route and method'};
  const rows=report.excludedEvents.map(e=>'<tr><th scope="row"><code>'+esc(e.eventId)+
    '</code><small>'+esc(e.routeId)+' · '+esc(e.method)+'</small></th><td>'+esc(e.at)+
    '</td><td>'+esc(reasons[e.reason]??e.reason)+'</td></tr>').join('');
  const sessions=scope.sessions.map(session=>'<tr><th scope="row"><code>'+esc(session.sessionId)+
    '</code><small>'+esc(session.mode)+'</small></th><td>'+esc(session.state)+
    '</td><td>'+esc(session.startedAt)+'<small>through '+esc(session.capturedAt)+
    '</small></td><td>'+session.matchingDays+'</td><td>'+session.outstandingAtCheckpoint+'</td></tr>').join('');
  return '<section class="panel"><h2>Retained event coverage</h2><p>Selected UTC period '+esc(scope.range.from)+
    ' through '+esc(scope.range.to)+' · '+scope.days+' saved day(s) · '+scope.sessions.length+' original session(s). '+
    'Events must fall inside a saved original session and selected day, with that route and method observed. New exports also bind the exact session/day route variant. Older exports retain their coarser session/day scope.</p>'+
    '<p class="muted">A continuous date range does not fill restart gaps. Historical or ambiguous method/path variants remain in the assignment table without current pricing. Missing checkpoints do not establish that no transactions occurred.</p>'+
    '<div class="scroll"><table><thead><tr><th>Original session / mode</th><th>State</th><th>Saved observation interval</th><th>Selected days</th><th>Outstanding at checkpoint</th></tr></thead><tbody>'+
    (sessions||'<tr><td colspan="5">No original sessions in the selected retained period.</td></tr>')+
    '</tbody></table></div></section><section class="panel"><h2>Events outside saved coverage</h2><p class="muted">These original events stay in the outbox. The selected report does not include them in an option total; their source IDs and exclusion reasons remain below.</p><div class="scroll"><table class="events"><thead><tr><th>Original event / route</th><th>Recorded time</th><th>Coverage decision</th></tr></thead><tbody>'+
    (rows||'<tr><td colspan="3">No original events excluded by the retained selection.</td></tr>')+'</tbody></table></div></section>';
}
function render(report){
  const t=report.totals;
  const observation=report.usageSummary?'Retained period '+report.usageSummary.range.from+' through '+
    report.usageSummary.range.to+' · '+report.sessionIds.length+' sessions':'Session '+report.sessionId;
  const rows=report.routes.map(r=>'<tr><th scope="row">'+esc(r.routeId)+
    '<small>'+esc(r.method)+' · '+esc(r.paymentOptionCount)+' payment option(s)</small></th><td>'+esc(r.http2xx)+'</td><td>'+
    esc(r.nativeSuccessEvents)+'</td><td>'+esc(r.acceptedByMerchantInbox)+'</td><td>'+
    esc(r.pendingDelivery)+'</td><td>'+esc(r.exhaustedDelivery)+'</td><td>'+
    esc(r.quotedUsd)+'</td></tr>').join('');
  const options=report.options.map(p=>`<article class="option" id="option-${esc(p.optionId)}">
    <h3>${esc(p.routeId)} · Option ${p.optionIndex}</h3>
    <p>${esc(p.method)} · ${esc(p.network)} · ${esc(p.scheme)} · ${esc(p.amountAtomic)} atomic units
      <small>Timeout ${p.maxTimeoutSeconds===null?'not recorded in legacy report':esc(p.maxTimeoutSeconds)+' seconds'} · Extra ${p.hasExtra?'preserved in private SF97 source JSON':'none'}</small></p>
    <dl><dt>Asset SHA-256</dt><dd><code>${esc(p.assetDigest)}</code></dd>
      <dt>Recipient SHA-256</dt><dd><code>${esc(p.recipientDigest)}</code></dd>
      <dt>Option identity</dt><dd><code>${esc(p.optionId)}</code></dd></dl>
    <div class="scroll"><table><thead><tr><th>Native notices</th><th>Inbox accepted</th><th>Pending</th><th>Exhausted</th></tr></thead>
      <tbody><tr><td>${p.nativeSuccessEvents}</td><td>${p.acceptedByMerchantInbox}</td><td>${p.pendingDelivery}</td><td>${p.exhaustedDelivery}</td></tr>
      <tr><td>${esc(p.nativeAtomicAmount)} atomic</td><td>${esc(p.inboxAcceptedAtomicAmount)} atomic</td><td>${esc(p.pendingAtomicAmount)} atomic</td><td>${esc(p.exhaustedAtomicAmount)} atomic</td></tr></tbody></table></div>
    <p class="muted">${p.exactRecipientEvents} exact recipient event(s); ${p.legacyUniqueRecipientEvents} uniquely matched legacy event(s).
      Route quote USD ${esc(p.quotedUsd)} applies to every option. HTTP 2xx/402 attribution to this option is unknown.</p>
    </article>`).join('');
  const eventRows=report.events.map(e=>`<tr><th scope="row"><code>${esc(e.eventId)}</code><small>${esc(e.routeId)} · ${esc(e.at)}</small></th>
    <td>${e.optionId?`<a href="#option-${esc(e.optionId)}">${esc(e.termsMatch)}</a>`:esc(e.termsMatch)}<small>${e.termsCandidateCount} matching option(s)</small>${e.coverageBasis?`<small>${esc(e.coverageBasis)} · ${e.observedSessionIds.length} session(s) · ${esc(e.observedSessionModes.join(', '))}</small>`:''}</td>
    <td>${esc(e.deliveryState)}</td><td><code>${esc(e.recipientDigest??'Not recorded')}</code></td></tr>`).join('')||
    '<tr><td colspan="4">No original native notices in this observation window.</td></tr>';
  const issues=report.issues.length?report.issues.map(i=>'<li><b>'+esc(i.routeId)+'</b>: '+
    esc(i.flag)+(i.eventId?' <code>'+esc(i.eventId)+'</code>':'')+'</li>').join(''):'<li>No journal mismatches or pending callbacks in the matched window.</li>';
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">'+
    '<meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; base-uri \'none\'">'+
    '<meta name="robots" content="noindex,nofollow"><title>SF97 Native Merchant Settlement Ops</title>'+
    '<style>body{font:15px/1.5 system-ui,-apple-system,sans-serif;background:#f3f4f5;color:#1b252b;margin:0}'+
    'main{max-width:1120px;margin:auto;padding:32px 18px}header{border-bottom:2px solid #28343b;padding-bottom:18px}'+
    'h1{font-size:26px;margin:4px 0}h2{font-size:18px}.eyebrow{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#58656b}'+
    '.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:20px 0}.card,.panel{background:white;border:1px solid #ccd4d9;border-radius:4px;padding:18px}'+
    '.card strong{font-size:24px;display:block}table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}'+
    'th,td{text-align:right;border-bottom:1px solid #dce1e4;padding:12px}th:first-child{text-align:left}small{display:block;color:#5a6872}'+
    'ul{padding-left:22px}.muted{color:#53616a}.scroll{overflow-x:auto}.panel{margin-top:16px}'+
    '.options{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr));gap:16px}.option{border:1px solid #ccd4d9;padding:16px;min-width:0}'+
    'h3{font-size:16px;margin:0}dl{margin:12px 0}dt{font-size:12px;color:#53616a}dd{margin:3px 0 10px}code{font-size:12px;overflow-wrap:anywhere}'+
    'a{color:inherit;text-decoration:underline}.events th,.events td{vertical-align:top;max-width:290px;overflow-wrap:anywhere}.events th{font-weight:400}'+
    '@media(max-width:800px){.cards{grid-template-columns:repeat(2,1fr)}}'+
    '@media print{body{background:white}main{padding:0}.card,.panel{break-inside:avoid}}</style></head>'+
    '<body><main><header><div class="eyebrow">Original SF30 × SF97 × SF98 | Private merchant operations</div><h1>'+
    esc(report.merchantName)+'</h1><div class="muted">'+esc(observation)+' | '+esc(report.sellerMode)+
    ' | '+esc(report.observedFrom)+' to '+esc(report.observedUntil)+'</div></header><section class="cards">'+
    [['Native success notices',t.alignedNativeSuccessEvents],['Delivered to inbox',t.deliveredToMerchantInbox],
    ['Pending callbacks',t.pendingDelivery],['Exhausted callbacks',t.exhaustedDelivery]].map(([label,value])=>
      '<div class="card"><span class="eyebrow">'+esc(label)+'</span><strong>'+esc(value)+'</strong></div>').join('')+
    '</section><section class="panel"><h2>Actual seller routes and original SF98 native events</h2><div class="scroll"><table>'+
    '<thead><tr><th>Route</th><th>HTTP 2xx</th><th>Native successes</th><th>Inbox accepted*</th><th>Retry queue</th><th>Exhausted</th><th>Owner USD quote</th></tr></thead><tbody>'+
    rows+'</tbody></table></div><p class="muted">*Original SF98 sender marked HTTP webhook acceptance; this does not establish merchant fulfillment. '+
    esc(t.outsideObservationWindow)+' native event(s) outside this SF30 saved observation coverage; '+
    esc(t.unmatchedEventIdentity)+' identity mismatches inside window.</p></section>'+
    '<section class="panel"><h2>Selected payment options</h2><p class="muted">Atomic totals stay within one complete network, asset, amount and recipient option. '+
    'Original HTTP counters stay on their route; no option share or exchange rate is inferred. All configured options remain visible, including those with zero native notices.</p><div class="options">'+options+'</div></section>'+
    '<section class="panel"><h2>Native event assignments</h2><p class="muted">Legacy notices with no recipient digest match only when the other terms identify one option. '+
    'Ambiguous notices stay unassigned. The private JSON includes every candidate option ID and the original receipt fingerprint.</p><div class="scroll"><table class="events">'+
    '<thead><tr><th>Original event</th><th>Option match</th><th>Callback state</th><th>Recorded recipient SHA-256</th></tr></thead><tbody>'+eventRows+'</tbody></table></div></section>'+
    coverageHtml(report)+'<section class="panel"><h2>Operator repair queue</h2><ul>'+issues+'</ul></section>'+
    '<section class="panel"><h2>Revenue and payment interpretation</h2><p>Original native SDK successful processSettlement is a separate observation from '+
    'HTTP 2xx, merchant inbox delivery, customer fulfillment, independently confirmed chain receipt, signed order, invoice, or revenue. '+
    'Owner price quotes remain scenario inputs only. Never multiply these event counts into booked cash without independent settlement and merchant accounting.</p></section>'+
    '<p class="muted">Generated '+esc(report.generatedAt)+' | Private offline read-only source reconciliation | No wallet, payments, Actions or network calls.</p></main></body></html>';
}
async function writeNew(path,files){
  if(!isAbsolute(path)||resolve(path)!==path)fail('ABSOLUTE_OUTPUT_DIRECTORY_REQUIRED');
  await mkdir(path,{recursive:false,mode:0o700});
  for(const [name,value] of Object.entries(files)){
    const handle=await open(join(path,name),'wx',0o600);
    try{await handle.writeFile(value);}finally{await handle.close();}
  }
}
export async function run({reportPath,outboxDir,outDir}){
  const stat=await lstat(outboxDir);
  if(!stat.isDirectory()||stat.isSymbolicLink()||(stat.mode&0o077)!==0)
    fail('ORIGINAL_PRIVATE_SF98_OUTBOX_REQUIRED');
  const reportBytes=await strictFile(reportPath,64*1024*1024);
  const report=JSON.parse(reportBytes.toString('utf8'));
  const events=await journal(join(outboxDir,'events.ndjson'));
  const deliveries=await journal(join(outboxDir,'deliveries.ndjson'));
  const view=reconcile(report,events.rows,deliveries.rows);
  view.sourceSha256={sf97Report:sha(reportBytes),
    sf98EventsJournal:events.hash,sf98DeliveriesJournal:deliveries.hash};
  const reportOut=Buffer.from(JSON.stringify(view,null,2)+'\n');
  const page=Buffer.from(render(view));
  const summary=Buffer.from('# Original SF30 × SF97 × SF98 native merchant operations\n\n'+
    (view.usageSummary?'Retained UTC period: '+view.usageSummary.range.from+' through '+view.usageSummary.range.to+
      '\nOriginal sessions: '+view.sessionIds.length:'Session: '+view.sessionId)+
    '\nNative events matched: '+view.totals.alignedNativeSuccessEvents+
    '\nInbox accepted: '+view.totals.deliveredToMerchantInbox+
    '\nConfigured payment options: '+view.totals.configuredPaymentOptions+
    '\nExact recipient events: '+view.totals.exactRecipientEvents+
    '\nUniquely matched legacy events: '+view.totals.legacyUniqueRecipientEvents+
    '\nAmbiguous legacy events: '+view.totals.ambiguousLegacyEvents+
    '\n\n## Operator actions\n\n'+(view.issues.map(i=>'- [ ] '+i.routeId+': '+i.flag+
      (i.eventId?' (event `'+i.eventId+'`)':'')).join('\n')||
    '- [ ] Correlate native settlement, merchant order and independent chain evidence before invoicing')+
    '\n\nNo HTTP or callback observation is booked revenue.\n');
  const files={'native-ops.json':reportOut,'native-ops.html':page,'operator-actions.md':summary};
  files['manifest.json']=Buffer.from(JSON.stringify({
    schema:'stellar-forge.sf97-native-source-manifest.v1',sessionId:view.sessionId,
    sources:view.sourceSha256,files:Object.fromEntries(Object.entries(files).map(([name,b])=>
      [name,{sha256:sha(b),bytes:b.length}]))
  },null,2)+'\n');
  await writeNew(outDir,files);
  return {output:outDir,matchedNativeEvents:view.totals.alignedNativeSuccessEvents,
    originalEvents:view.totals.originalOutboxEvents,issues:view.issues.length,
    paymentOptions:view.totals.configuredPaymentOptions,
    exactRecipientEvents:view.totals.exactRecipientEvents,
    legacyUniqueRecipientEvents:view.totals.legacyUniqueRecipientEvents,
    ambiguousLegacyEvents:view.totals.ambiguousLegacyEvents};
}
function args(argv){
  const o={};
  for(let i=0;i<argv.length;i+=2){
    if(!['--report','--outbox','--out'].includes(argv[i])||
      !argv[i+1]||Object.hasOwn(o,argv[i]))fail('USAGE: --report SF97_REPORT --outbox ORIGINAL_SF98_OUTBOX_DIR --out NEW_PRIVATE_DIR');
    o[argv[i]]=argv[i+1];
  }
  if(!o['--report']||!o['--outbox']||!o['--out'])fail('REQUIRED_SOURCES_MISSING');
  return {reportPath:resolve(o['--report']),outboxDir:resolve(o['--outbox']),outDir:resolve(o['--out'])};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  run(args(process.argv.slice(2))).then(result=>process.stdout.write(JSON.stringify(result)+'\n'))
    .catch(error=>{process.stderr.write('SF97_NATIVE: '+error.message+'\n');process.exitCode=1;});
}

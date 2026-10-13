// MIT. Recorded source quantities compared with an unchanged saved merchant tariff.
import {createHash} from 'node:crypto';
import {quoteTariff,normalizeTariff} from '../tariffs/model.mjs';
import {csv} from '../economics/common.mjs';

export const PERFORMANCE_REVIEW_SCHEMA='stellar-forge.merchant-tariff-performance-review.v1';
export const PERFORMANCE_BASES=Object.freeze(['HTTP_2XX','NATIVE_SUCCESS','INBOX_ACCEPTED','SERVICE_CONSUMED_REQUESTS','SERVICE_2XX']);
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH=/^[a-f0-9]{64}$/;
const own=(value,key)=>Object.hasOwn(value,key);
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value);
const copy=value=>structuredClone(value);
const fail=(code,message,status=422)=>{throw Object.assign(new TypeError(message),{code,status});};
const canonical=value=>JSON.stringify(value,(_,item)=>plain(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const fingerprint=value=>createHash('sha256').update(canonical(value)).digest('hex');
const LABELS=Object.freeze({HTTP_2XX:'Recorded HTTP 2xx responses',NATIVE_SUCCESS:'Matched original native settlement events',
  INBOX_ACCEPTED:'Matched native events accepted by the merchant inbox',SERVICE_CONSUMED_REQUESTS:'Requests newly consuming purchased service allowance',
  SERVICE_2XX:'Requests with a newly retained native 2xx response'});
function integer(value,label){
  const text=typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?String(value):value;
  if(typeof text!=='string'||!/^(0|[1-9]\d*)$/.test(text)||BigInt(text)>BigInt(Number.MAX_SAFE_INTEGER))
    fail('PERFORMANCE_QUANTITY_INVALID',label+' must retain its original nonnegative safe integer.');
  return BigInt(text);
}
function micros(value,label){
  if(typeof value!=='string'||!/^(-?)(0|[1-9]\d*)(\.\d{1,6})?$/.test(value))
    fail('PERFORMANCE_AMOUNT_INVALID',label+' must retain its original exact USD decimal.');
  const negative=value[0]==='-',parts=(negative?value.slice(1):value).split('.');
  return (negative?-1n:1n)*(BigInt(parts[0])*1000000n+BigInt((parts[1]??'').padEnd(6,'0')));
}
function usd(value){
  if(value===null)return null;
  const negative=value<0n,absolute=negative?-value:value,tail=String(absolute%1000000n).padStart(6,'0').replace(/0+$/,'');
  return (negative?'-':'')+String(absolute/1000000n)+(tail?'.'+tail:'');
}
function routeIn(report,identity){
  const row=report.routes?.find(value=>value.routeId===identity.routeId);
  if(!row||row.method!==identity.method||row.path!==identity.path)
    fail('PERFORMANCE_ROUTE_CHANGED','Choose recorded usage for this exact saved route, method and path.',409);
  return row;
}
export function normalizePerformanceInputs(raw){
  if(!plain(raw)||Object.keys(raw).some(key=>!['selectionRequestId','usageVersion','basis','optionId','costEdition','costBasis','servicePeriodSourceId'].includes(key)))
    fail('PERFORMANCE_INPUT_INVALID','Choose the saved tariff selection and its complete recorded source.');
  if(!UUID.test(raw.selectionRequestId??'')||!UUID.test(raw.usageVersion??'')||!PERFORMANCE_BASES.includes(raw.basis))
    fail('PERFORMANCE_INPUT_INVALID','Choose the original selection UUID, saved usage version and quantity basis.');
  const result={selectionRequestId:raw.selectionRequestId,usageVersion:raw.usageVersion,basis:raw.basis,
    optionId:raw.optionId??null,costEdition:raw.costEdition??null,costBasis:raw.costBasis??'BILLED',
    servicePeriodSourceId:raw.servicePeriodSourceId??null};
  if(result.optionId!==null&&!HASH.test(result.optionId)||result.costEdition!==null&&!UUID.test(result.costEdition)||
      !['BILLED','QUOTED'].includes(result.costBasis)||result.servicePeriodSourceId!==null&&!HASH.test(result.servicePeriodSourceId))
    fail('PERFORMANCE_SOURCE_SELECTION_INVALID','Use original payment, cost and service-period source identifiers.');
  const service=result.basis.startsWith('SERVICE_');
  if(service!==(result.servicePeriodSourceId!==null))
    fail('PERFORMANCE_SERVICE_SOURCE_REQUIRED','Select a complete opening/closing service source for a service quantity basis.');
  if(result.optionId!==null&&!['NATIVE_SUCCESS','INBOX_ACCEPTED'].includes(result.basis))
    fail('PERFORMANCE_OPTION_SCOPE','HTTP and service-request quantities belong to their original route; choose a native event basis to select a payment option.');
  return result;
}
function periodFor(report){
  const history=report.usageHistory;
  return {observationKind:report.observationKind??'SESSION',observedFrom:report.observedFrom,observedUntil:report.observedUntil,
    range:history?.range??null,sessionIds:copy(report.sessionIds??[report.sessionId]),
    daysWithObservations:history?history.days.map(day=>day.day):[],
    coverage:{observerErrors:String(integer(report.observerErrors,'Observer errors')),sellerMode:report.originalSellerMode,
      retentionDays:history?.retentionDays??null,storage:copy(history?.storage??null),
      sessions:copy(history?.sessions??[]),coverageFormat:history?.coverageFormat??null,
      startsAndCompletionsHaveIndependentUtcDates:report.periodReview?.startsAndCompletionsHaveIndependentUtcDates??null,
      absentDaysHaveNoSavedObservations:report.periodReview?.absentDaysHaveNoSavedObservations??null}};
}
function selectedServiceCalls(period,route,basis){
  return period.calls.filter(call=>call.routeId===route.routeId&&call.method===route.method&&call.path===route.path&&
    (basis==='SERVICE_CONSUMED_REQUESTS'?BigInt(call.consumedUnits)>0n:
      call.closing.storedStatus==='COMPLETED'&&call.opening?.storedStatus!=='COMPLETED'&&
      call.closing.result?.status>=200&&call.closing.result.status<=299));
}
function eventSelected(event,route,optionId,basis){
  return event.routeId===route.routeId&&event.method===route.method&&
    ['EXACT_OPTION','LEGACY_UNIQUE_OPTION'].includes(event.termsMatch)&&
    (optionId===null||event.optionId===optionId)&&(basis!=='INBOX_ACCEPTED'||event.deliveryState==='DELIVERED');
}
/** Inputs are the full original source contexts returned by inspectPerformanceSource. */
export function createPerformanceReview({inputs:raw,selected,usage,cost=null,servicePeriod=null,originalsSha256}={}){
  const inputs=normalizePerformanceInputs(raw);
  if(!HASH.test(originalsSha256??''))fail('PERFORMANCE_ORIGINALS_REQUIRED','Keep the complete selected original source fingerprint.');
  if(!selected?.comparison||!selected?.record||!selected?.selection||!selected?.pricing||!usage?.report)
    fail('PERFORMANCE_ORIGINAL_SOURCE_REQUIRED','Read the complete saved tariff and original usage files.');
  const comparison=selected.comparison,identity={routeId:comparison.routeId,method:comparison.method,path:comparison.path};
  const observed=routeIn(usage.report,identity),quoted=routeIn(selected.pricing.report,identity);
  const schedule=normalizeTariff(selected.record.inputs.tariffs.find(row=>row.id===comparison.tariffId));
  const savedUnit=micros(comparison.quote.chosenUniformQuoteUsd,'Saved uniform quote');
  if(micros(quoted.quoteUsd,'Saved native pricing quote')!==savedUnit)
    fail('PERFORMANCE_SAVED_QUOTE_CHANGED','The selected native pricing version differs from its saved tariff quote.',409);
  const native=usage.native?.value??null;
  const nativeRoute=native?.routes.find(row=>row.routeId===identity.routeId&&row.method===identity.method)??null;
  const options=copy(native?.options.filter(row=>row.routeId===identity.routeId&&row.method===identity.method)??[]);
  const option=inputs.optionId===null?null:options.find(row=>row.optionId===inputs.optionId);
  if(inputs.optionId!==null&&!option)fail('PERFORMANCE_OPTION_UNAVAILABLE','The selected payment option is absent from this original native report.');
  const nativeCounts=option??nativeRoute;
  const counts={http2xx:String(integer(observed.actual2xx,'HTTP 2xx')),http402:String(integer(observed.actual402,'HTTP challenges')),
    nativeSuccessEvents:nativeCounts?String(integer(nativeCounts.nativeSuccessEvents,'Native successes')):null,
    inboxAcceptedEvents:nativeCounts?String(integer(nativeCounts.acceptedByMerchantInbox,'Inbox accepted events')):null,
    pendingDelivery:nativeCounts?String(integer(nativeCounts.pendingDelivery,'Pending callbacks')):null,
    exhaustedDelivery:nativeCounts?String(integer(nativeCounts.exhaustedDelivery,'Exhausted callbacks')):null,
    exactRecipientEvents:native?String(options.filter(row=>inputs.optionId===null||row.optionId===inputs.optionId).reduce((sum,row)=>sum+integer(row.exactRecipientEvents,'Exact recipient events'),0n)):null,
    legacyUniqueRecipientEvents:native?String(options.filter(row=>inputs.optionId===null||row.optionId===inputs.optionId).reduce((sum,row)=>sum+integer(row.legacyUniqueRecipientEvents,'Legacy recipient events'),0n)):null};
  const originalPeriod=periodFor(usage.report),issues=[],timeline=[];
  let quantity,period=originalPeriod,service=null;
  if(inputs.basis==='HTTP_2XX')quantity=integer(counts.http2xx,'HTTP 2xx');
  else if(inputs.basis==='NATIVE_SUCCESS'||inputs.basis==='INBOX_ACCEPTED'){
    if(!nativeCounts)fail('PERFORMANCE_NATIVE_SOURCE_REQUIRED','Choose a saved Pricing review with its original native reconciliation.');
    quantity=integer(inputs.basis==='NATIVE_SUCCESS'?counts.nativeSuccessEvents:counts.inboxAcceptedEvents,'Native quantity');
  }else{
    if(!servicePeriod?.period||servicePeriod.id!==inputs.servicePeriodSourceId)
      fail('PERFORMANCE_SERVICE_SOURCE_REQUIRED','Retain both original service snapshots for this selected period.');
    const sourcePeriod=servicePeriod.period;
    const route=sourcePeriod.routes.find(row=>row.routeId===identity.routeId&&row.method===identity.method&&row.path===identity.path);
    if(!route)fail('PERFORMANCE_SERVICE_ROUTE_CHANGED','Choose a purchased service route with this exact tariff route, method and path.',409);
    const calls=selectedServiceCalls(sourcePeriod,identity,inputs.basis);quantity=BigInt(calls.length);
    period={observationKind:'SERVICE_PERIOD',observedFrom:sourcePeriod.from,observedUntil:sourcePeriod.until,range:null,
      sessionIds:[],daysWithObservations:[],coverage:{timeBasis:sourcePeriod.timeBasis,
        openingSource:copy(sourcePeriod.openingSource),closingSource:copy(sourcePeriod.closingSource),
        orderRef:sourcePeriod.orderRef,planId:sourcePeriod.planId,planSha256:sourcePeriod.planSha256,manifestSha256:sourcePeriod.manifestSha256}};
    service={sourceId:servicePeriod.id,orderRef:sourcePeriod.orderRef,eventId:sourcePeriod.eventId,planId:sourcePeriod.planId,
      planSha256:sourcePeriod.planSha256,manifestSha256:sourcePeriod.manifestSha256,from:sourcePeriod.from,until:sourcePeriod.until,
      timeBasis:sourcePeriod.timeBasis,opening:copy(sourcePeriod.opening),closing:copy(sourcePeriod.closing),route:copy(route),
      totals:copy(sourcePeriod.totals),selectedRequestIds:calls.map(call=>call.requestId),
      quantityUnit:'REQUESTS',allowanceQuantityUnit:'PURCHASED_SERVICE_UNITS',
      entitlement:copy(servicePeriod.entitlement),comparisonBasis:'SAVED_INNER_ROUTE_PER_REQUEST_PRICE',
      resultRecoveries:route.resultRecoveries,passResultRecoveries:sourcePeriod.totals.resultRecoveries};
    Object.assign(counts,{serviceRequests:String(quantity),serviceConsumedUnits:route.consumedUnits,
      serviceAdmittedUnits:route.admittedUnits,serviceReleasedUnits:route.releasedUnits,
      sourceHttpAndNativePeriod:originalPeriod});
    const days=new Map();for(const call of calls){const day=new Date(call.closing.updatedAt).toISOString().slice(0,10);days.set(day,(days.get(day)??0n)+1n);}
    for(const [day,count]of [...days].sort(([a],[b])=>a.localeCompare(b)))timeline.push({day,quantity:String(count),timeBasis:'ORIGINAL_CALL_UPDATE_UTC_DAY'});
  }
  if(quantity>BigInt(Number.MAX_SAFE_INTEGER))fail('PERFORMANCE_QUANTITY_INVALID','The original request count exceeds the native tariff quantity range.');
  if(!inputs.basis.startsWith('SERVICE_')){
    if(inputs.basis==='HTTP_2XX'&&usage.report.periodReview){
      for(const day of usage.report.periodReview.days){
        const row=day.routes.find(row=>row.routeId===identity.routeId&&row.method===identity.method&&row.path===identity.path&&row.binding==='CURRENT_ROUTE');
        timeline.push({day:day.day,quantity:row?String(integer(row.actual2xx,'Daily HTTP 2xx')):'0',timeBasis:'ORIGINAL_HTTP_COMPLETION_DAY'});
      }
    }else if(inputs.basis!=='HTTP_2XX'){
      const days=new Map();for(const event of native.events){
        if(!eventSelected(event,identity,inputs.optionId,inputs.basis))continue;
        const day=new Date(event.at).toISOString().slice(0,10);days.set(day,(days.get(day)??0n)+1n);
      }
      const total=[...days.values()].reduce((a,b)=>a+b,0n);
      if(total!==quantity)fail('PERFORMANCE_NATIVE_COUNTS_CHANGED','The complete native matched-event rows differ from their original totals.',409);
      for(const [day,count]of [...days].sort(([a],[b])=>a.localeCompare(b)))timeline.push({day,quantity:String(count),timeBasis:'ORIGINAL_NATIVE_EVENT_TIME'});
    }
  }
  const tariffQuote=quoteTariff(schedule,String(quantity)),quotedValue=savedUnit*quantity;
  const unitCost=observed.variablePerFulfilledUsd===null?null:micros(observed.variablePerFulfilledUsd,'Original fulfilled cost');
  const challengeCost=observed.perChallengeUsd===null?null:micros(observed.perChallengeUsd,'Original challenge cost');
  const estimatedCost=unitCost===null?null:unitCost*quantity;
  const routeHttpCost=unitCost===null||challengeCost===null?null:
    unitCost*integer(observed.actual2xx,'HTTP 2xx')+challengeCost*integer(observed.actual402,'HTTP challenges');
  let recorded=null;
  if(cost!==null){
    if(cost.edition!==inputs.costEdition||cost.pricingVersion!==usage.version||cost.binding?.pricingReportSha256!==usage.reportFile.sha256)
      fail('PERFORMANCE_COST_SOURCE_CHANGED','Choose a saved cost edition bound to this exact original usage review.',409);
    const row=cost.report.routes.find(row=>row.routeId===identity.routeId&&row.method===identity.method&&row.path===identity.path);
    if(!row)fail('PERFORMANCE_COST_ROUTE_CHANGED','The selected cost edition has no matching route.');
    recorded={edition:cost.edition,revision:cost.revision,basis:inputs.costBasis,period:copy(cost.report.period),
      periodAlignment:copy(cost.report.periodAlignment),coverage:copy(row.coverage),
      costs:copy(row.costs.filter(item=>item.basis===inputs.costBasis)),proposal:copy(row.proposals[inputs.costBasis]),
      quantityScope:'COMPLETE_ORIGINAL_USAGE_ROUTE',pricingObservationPeriod:originalPeriod};
  }else if(inputs.costEdition!==null)fail('PERFORMANCE_COST_SOURCE_REQUIRED','Retain the selected complete original cost edition.');
  const paymentTermsChanged=canonical(observed.paymentOptions)!==canonical(quoted.paymentOptions);
  if(paymentTermsChanged)issues.push({code:'PAYMENT_TERMS_CHANGED',message:'The saved quote and selected usage preserve different configured payment options. Both complete identities are included.'});
  if(integer(usage.report.observerErrors,'Observer errors')>0n)
    issues.push({code:'OBSERVER_ERRORS',message:'The original usage report records observer errors; its exact count and source coverage are retained.'});
  for(const row of usage.report.issues??[])if(row.routeId==='*'||row.routeId===identity.routeId)issues.push({code:'ORIGINAL_USAGE_REVIEW',message:row.flag});
  for(const row of native?.issues??[])if(row.routeId==='*'||row.routeId===identity.routeId)
    issues.push({code:'ORIGINAL_NATIVE_RECONCILIATION',message:row.flag,...(row.eventId?{eventId:row.eventId}:{})});
  if(native?.totals.unmatchedEventIdentity)issues.push({code:'UNMATCHED_NATIVE_EVENTS',message:String(native.totals.unmatchedEventIdentity)+' in-scope original native events remain outside matched payment identities.'});
  if(inputs.basis==='INBOX_ACCEPTED')issues.push({code:'DELIVERY_SNAPSHOT_BASIS',message:'Acceptance uses the final retained delivery-journal state, including callbacks recorded after the selected event interval.'});
  if(service)issues.push({code:'SERVICE_SNAPSHOT_BASIS',message:'Per-request price comparison for observed service calls: the selected inner-route quote supplies the comparison rate. Complete snapshots retain the prepaid purchase, allowance and result recoveries separately.'});
  const source={originalsSha256,selectionRequestId:inputs.selectionRequestId,tariffPlanId:selected.record.planId,comparisonId:comparison.id,
    tariffId:schedule.id,tariffReviewSha256:selected.record.review.tariffReviewSha256,
    scenarioPlanId:selected.selection.intent.request.planRequestId,scenarioId:comparison.scenario.id,
    sourceVersion:selected.record.version,pricingVersion:selected.pricing.version,usageVersion:usage.version,usageRevision:usage.revision,
    usageReportSha256:usage.reportFile.sha256,nativeReportSha256:usage.native?.file.sha256??null,
    costEdition:cost?.edition??null,costEditionRevision:cost?.revision??null,costReportSha256:cost?.reportFile.sha256??null,
    servicePeriodSourceId:servicePeriod?.id??null};
  const review={schema:PERFORMANCE_REVIEW_SCHEMA,source,
    route:{...identity,quotePaymentOptions:copy(quoted.paymentOptions),observedPaymentOptions:copy(observed.paymentOptions),
      paymentTermsChanged,optionId:inputs.optionId},
    period,basis:{kind:inputs.basis,quantity:String(quantity),optionId:inputs.optionId,label:LABELS[inputs.basis],counts},
    quoted:{currency:'USD',selectedQuantity:comparison.quantity,savedUnitUsd:usd(savedUnit),valueAtObservedQuantityUsd:usd(quotedValue),
      comparisonBasis:service?'PER_REQUEST_PRICE_COMPARISON_FOR_OBSERVED_SERVICE_CALLS':'SAVED_ROUTE_QUOTE_AT_RECORDED_QUANTITY'},
    tariff:{id:schedule.id,label:schedule.label,mode:schedule.mode,quote:tariffQuote,
      deltaFromSavedQuoteUsd:usd(BigInt(tariffQuote.totalMicroUsd)-quotedValue)},
    native:{reportSha256:usage.native?.file.sha256??null,capturedAt:native?.generatedAt??null,
      deliveryStatusBasis:'RETAINED_DELIVERY_JOURNAL_SNAPSHOT',options,
      unmatchedEventIdentity:native?String(integer(native.totals.unmatchedEventIdentity,'Unmatched native identities')):null,
      observationPeriod:originalPeriod},
    costs:{estimated:{perFulfilledUsd:observed.variablePerFulfilledUsd,perChallengeUsd:observed.perChallengeUsd,
      valueAtBasisQuantityUsd:usd(estimatedCost),routeHttpVariableUsd:usd(routeHttpCost),
      unknownInputs:[...(unitCost===null?['perFulfilledUsd']:[]),...(challengeCost===null?['perChallengeUsd']:[])]},
      recorded,contributionUsingEstimatedUnitCostUsd:estimatedCost===null?null:usd(quotedValue-estimatedCost)},
    servicePeriod:service,timeline,issues};
  return {...review,performanceSha256:fingerprint(review)};
}
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const table=(heads,rows)=>'<table><thead><tr>'+heads.map(x=>'<th>'+escape(x)+'</th>').join('')+'</tr></thead><tbody>'+
  rows.map(row=>'<tr>'+row.map(x=>'<td>'+escape(x===null?'Unknown':x)+'</td>').join('')+'</tr>').join('')+'</tbody></table>';
export function renderPerformanceReview(review,{label='Recorded tariff performance'}={}){
  if(review?.schema!==PERFORMANCE_REVIEW_SCHEMA)fail('PERFORMANCE_REVIEW_REQUIRED','Choose a saved performance review.');
  const r=review,e=escape;
  return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>'+e(label)+'</title><style>body{font:15px/1.55 system-ui,sans-serif;color:#202020;background:#fff;max-width:1100px;margin:36px auto;padding:0 24px}'+
    'h1{font-size:27px}h2{font-size:19px;margin-top:30px}p{max-width:90ch}table{border-collapse:collapse;width:100%;margin:14px 0}th,td{padding:10px;border:1px solid #d4d4d4;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#f0f0f0;font-weight:600}code{overflow-wrap:anywhere;font-size:12px}'+
    '.meta{color:#595959}.numbers{font-variant-numeric:tabular-nums}li{margin:7px 0}@media print{body{margin:0;max-width:none}h2{break-after:avoid}tr{break-inside:avoid}}</style><body>'+
    '<header><p class="meta">Merchant Pricing · Recorded usage</p><h1>'+e(label)+'</h1><p>'+e(r.route.method)+' '+e(r.route.path)+' · '+e(r.route.routeId)+'</p>'+
    '<p>'+e(r.period.observedFrom)+' through '+e(r.period.observedUntil)+'</p></header>'+
    '<section class="numbers"><h2>Saved quote at recorded quantity</h2>'+table(['Quantity basis','Recorded requests','Saved USD/request','Value at saved rate','Tariff at this quantity','Tariff minus saved rate'],[
      [r.basis.label,r.basis.quantity,r.quoted.savedUnitUsd,r.quoted.valueAtObservedQuantityUsd,r.tariff.quote.totalUsd,r.tariff.deltaFromSavedQuoteUsd]])+
    '<p>The quantity belongs to this saved period. A revised monthly quotation uses an explicitly entered monthly request target.</p></section>'+
    '<section><h2>Original '+e(r.tariff.mode)+' schedule · '+e(r.tariff.label)+'</h2>'+
    table(['Band','From quantity','Through quantity','Requests','USD/request','USD subtotal'],r.tariff.quote.lines.map(x=>[x.tierIndex+1,x.lowerExclusiveQuantity,x.upTo??'Unbounded',x.quantity,x.unitPriceUsd,x.subtotalUsd]))+
    table(['Derived uniform USD/request','Uniform value','Upward rounding delta'],[[r.tariff.quote.chosenUniformQuoteUsd,r.tariff.quote.uniformGrossUsd,r.tariff.quote.roundingDeltaUsd]])+'</section>'+
    '<section><h2>Recorded payment options</h2><p>'+ (r.route.optionId?'The headline quantity selects option <code>'+e(r.route.optionId)+'</code>.':'The headline quantity uses its selected route-level or service-request basis.')+'</p><p>Atomic totals retain each complete native payment identity. Callback status is the retained delivery-journal snapshot.</p>'+
    table(['Scope','Option','Network / asset digest / recipient digest','Atomic amount/request','Matched events','Total atoms','Inbox accepted','Pending','Exhausted'],r.native.options.map(x=>[
      r.route.optionId===x.optionId?'Selected':'Original option',x.optionId,[x.network,x.assetDigest,x.recipientDigest].join(' / '),x.amountAtomic,x.nativeSuccessEvents,x.nativeAtomicAmount,x.acceptedByMerchantInbox,x.pendingDelivery,x.exhaustedDelivery]))+'</section>'+
    '<section><h2>Cost basis</h2>'+table(['Merchant cost / fulfillment','Merchant cost / challenge','Modeled cost at selected quantity','Modeled cost for original HTTP activity'],[
      [r.costs.estimated.perFulfilledUsd,r.costs.estimated.perChallengeUsd,r.costs.estimated.valueAtBasisQuantityUsd,r.costs.estimated.routeHttpVariableUsd]])+
    (r.costs.recorded?'<p>Saved '+e(r.costs.recorded.basis)+' cost edition <code>'+e(r.costs.recorded.edition)+'</code>; original route coverage '+e(r.costs.recorded.coverage.state)+'.</p>'+
      table(['Basis','Currency','Allocated amount','Source lines'],r.costs.recorded.costs.map(x=>[x.basis,x.currency,x.amount,x.lines.join(', ')])):
      '<p>No cost edition is selected. Merchant unit cost assumptions are shown above.</p>')+'</section>'+
    (r.servicePeriod?'<section><h2>Purchased service allowance</h2>'+table(['Order','Newly consumed units','Newly admitted units','Released units','Selected requests'],[
      [r.servicePeriod.orderRef,r.servicePeriod.route.consumedUnits,r.servicePeriod.route.admittedUnits,r.servicePeriod.route.releasedUnits,r.basis.quantity]])+
      '<p>Per-request price comparison for observed service calls. '+e(r.servicePeriod.resultRecoveries)+' original response result(s) were recovered. The original prepaid purchase and its allowance are retained with both complete snapshots.</p></section>':'')+
    (r.timeline.length?'<section><h2>Recorded activity</h2>'+table(['Original day','Requests','Time basis'],r.timeline.map(row=>[row.day,row.quantity,row.timeBasis]))+'</section>':'')+
    '<section><h2>Source coverage</h2>'+table(['Original pricing source','Saved selection','Recorded usage version','Performance SHA-256'],[
      [r.source.pricingVersion,r.source.selectionRequestId,r.source.usageVersion,r.performanceSha256]])+
    (r.issues.length?'<ul>'+r.issues.map(x=>'<li>'+e(x.message)+'</li>').join(''):'')+'</section></body></html>';
}
export function performanceCsv(review){
  const rows=review.timeline.length?review.timeline:[{day:null,quantity:review.basis.quantity,timeBasis:review.period.observationKind}];
  return csv(rows.map(row=>({...row,routeId:review.route.routeId,method:review.route.method,path:review.route.path,
    performanceSha256:review.performanceSha256,selectionRequestId:review.source.selectionRequestId,usageVersion:review.source.usageVersion,
    basis:review.basis.kind,observedFrom:review.period.observedFrom,observedUntil:review.period.observedUntil})),
    [['Performance SHA-256','performanceSha256'],['Saved selection UUID','selectionRequestId'],['Usage version','usageVersion'],
      ['Route','routeId'],['Method','method'],['Path','path'],['Quantity basis','basis'],['Source from','observedFrom'],
      ['Source until','observedUntil'],['Original day','day'],['Requests','quantity'],['Time basis','timeBasis']]);
}

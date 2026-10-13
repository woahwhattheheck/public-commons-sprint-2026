// MIT. Recorded native usage carried through the original Commercial case and quotations.
import {inspectPerformanceSource} from '../../sf97-merchant-revenue-ops/performance/source.mjs';
import {canonical,sha256,jsonBytes,commercialError} from '../commercial-pricing.mjs';
import {MAX_MATERIAL_BYTES} from '../commissioning.mjs';

export const COMMERCIAL_PERFORMANCE_SCHEMA='stellar-forge.merchant-commercial-performance-source.v1';
const HASH=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const FILE_NAME='merchant-tariff-performance-source.json';
const copy=value=>JSON.parse(JSON.stringify(value));
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fail=(code,message,status=422)=>{throw commercialError(code,message,status);};
function exact(value,keys,label){
  if(!plain(value)||Object.keys(value).some(key=>!keys.includes(key)))
    fail('COMMERCIAL_PERFORMANCE_INPUT','Keep the complete '+label+' fields.');
}
function same(a,b,message){
  if(canonical(a)!==canonical(b))fail('COMMERCIAL_PERFORMANCE_SOURCE_CHANGED',message,409);
}
function identity(value){
  const {text,...file}=value.file;
  return sha256(canonical({schema:value.schema,tariffSourceId:value.tariffSourceId,quote:value.quote,file}));
}
function exactDecimal(value){
  if(typeof value!=='string'||!/^(0|[1-9]\d*)(?:\.\d+)?$/.test(value))
    fail('COMMERCIAL_PERFORMANCE_PRICE','Keep the saved decimal USD rate.');
  const [whole,fraction='']=value.split('.');
  const trimmed=fraction.replace(/0+$/,'');
  return whole+(trimmed?'.'+trimmed:'');
}
function quoteFrom(quotes,id,hash){
  if(!UUID.test(id??'')||!HASH.test(hash??''))fail('COMMERCIAL_PERFORMANCE_QUOTE_REQUIRED','Choose a saved quotation.');
  const quote=quotes.find(row=>row.id===id);
  if(!quote||quote.sha256!==hash)
    fail('COMMERCIAL_PERFORMANCE_QUOTE_CHANGED','Reopen the quotation selected for this usage review.',409);
  return quote;
}
function originalTariff(portfolio,selectionRequestId){
  const selection=portfolio?.selections?.find(row=>row.id===selectionRequestId);
  const planId=selection?.intent?.selection?.planId;
  const plan=portfolio?.plans?.find(row=>row.planId===planId);
  if(!selection||!plan)
    fail('COMMERCIAL_PERFORMANCE_TARIFF_REQUIRED','Retain the selected native tariff plan and pricing request.');
  return {plan,selection};
}
/** Receive the complete native export; the native inspector owns source replay and arithmetic. */
export async function captureCommercialPerformanceSource({tariffSources,quotes},{sourceText,sourceSha256,quoteId,quoteSha256,tariffSourceId}={}){
  if(typeof sourceText!=='string'||!HASH.test(sourceSha256??''))
    fail('COMMERCIAL_PERFORMANCE_FILE_REQUIRED','Choose the complete saved usage review file.');
  const bytes=Buffer.from(sourceText);
  if(!bytes.length||bytes.length>MAX_MATERIAL_BYTES||sha256(bytes)!==sourceSha256)
    fail('COMMERCIAL_PERFORMANCE_FILE_CHANGED','Use the complete original usage review bytes.');
  const quote=quoteFrom(quotes,quoteId,quoteSha256);
  tariffSourceId=tariffSourceId??quote.sourceBindings.tariff?.id;
  const value={schema:COMMERCIAL_PERFORMANCE_SCHEMA,tariffSourceId,
    quote:{id:quote.id,sha256:quote.sha256},
    file:{name:FILE_NAME,bytes:bytes.length,sha256:sourceSha256,text:sourceText}};
  value.id=identity(value);
  if(jsonBytes(value).length>MAX_MATERIAL_BYTES)
    fail('COMMERCIAL_PERFORMANCE_MATERIAL_LIMIT','This review exceeds the original complete case material size.');
  return inspectCommercialPerformanceSource(value,{tariffSources,quotes});
}
/** Reopen with the original quote and tariff; full native source validation also runs after case receiving. */
export async function inspectCommercialPerformanceSource(value,{tariffSources,quotes}={}){
  exact(value,['schema','id','tariffSourceId','quote','file'],'Commercial usage source');
  if(value.schema!==COMMERCIAL_PERFORMANCE_SCHEMA||!HASH.test(value.id??'')||
      !HASH.test(value.tariffSourceId??'')||!Array.isArray(tariffSources)||!Array.isArray(quotes))
    fail('COMMERCIAL_PERFORMANCE_SOURCE_REQUIRED','Keep the saved usage review with its quotation and tariff.');
  exact(value.quote,['id','sha256'],'measured quotation');
  exact(value.file,['name','bytes','sha256','text'],'usage source file');
  const file=value.file;
  if(file.name!==FILE_NAME||!Number.isSafeInteger(file.bytes)||file.bytes<1||
      file.bytes>MAX_MATERIAL_BYTES||typeof file.text!=='string'||!HASH.test(file.sha256??''))
    fail('COMMERCIAL_PERFORMANCE_FILE_REQUIRED','Keep the complete native usage source file.');
  const bytes=Buffer.from(file.text);
  if(bytes.length!==file.bytes||sha256(bytes)!==file.sha256||identity(value)!==value.id)
    fail('COMMERCIAL_PERFORMANCE_FILE_CHANGED','The usage source differs from its saved bytes.',409);
  const quote=quoteFrom(quotes,value.quote.id,value.quote.sha256);
  const tariff=tariffSources.find(row=>row.id===value.tariffSourceId);
  if(!tariff||quote.sourceBindings.tariff?.id!==tariff.id||
      quote.sourceBindings.pricing?.id!==tariff.pricingSourceId)
    fail('COMMERCIAL_PERFORMANCE_TARIFF_CHANGED','Select the tariff and pricing source retained by the measured quotation.',409);
  const envelope=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  const native=await inspectPerformanceSource(envelope);
  const review=native.review;
  if(review?.schema!=='stellar-forge.merchant-tariff-performance-review.v1'||
      !HASH.test(review.performanceSha256??'')||!HASH.test(native.id??''))
    fail('COMMERCIAL_PERFORMANCE_REVIEW_REQUIRED','Open a complete saved native tariff performance review.');
  const selected={
    selectionRequestId:tariff.selectionRequestId,tariffPlanId:tariff.tariffPlanId,
    comparisonId:tariff.comparisonId,scenarioPlanId:tariff.scenarioPlanId,
    sourceVersion:tariff.sourceVersion,pricingVersion:tariff.pricingVersion
  };
  for(const [key,expected]of Object.entries(selected))
    same(review.source?.[key],expected,'The recorded review selects a different original '+key+'.');
  same(originalTariff(envelope.originals?.tariffPortfolio,tariff.selectionRequestId),
    originalTariff(tariff.portfolio,tariff.selectionRequestId),
    'The recorded review and customer quotation retain different native tariff source bytes.');
  same(review.route?.routeId,tariff.routeId,'The recorded review selects a different quoted route.');
  const line=quote.lines.find(row=>row.kind==='ROUTE_USAGE'&&row.routeId===tariff.routeId);
  if(!line)fail('COMMERCIAL_PERFORMANCE_ROUTE_REQUIRED','The measured quotation needs its original route price line.');
  same(exactDecimal(review.quoted.savedUnitUsd),exactDecimal(line.unitUsd),
    'The recorded review must evaluate the unit rate in the measured quotation.');
  return {id:value.id,nativeSourceId:native.id,performanceId:native.record.performanceId,
    performanceSha256:review.performanceSha256,label:native.record.label,savedAt:native.record.savedAt,
    tariffSourceId:tariff.id,pricingSourceId:tariff.pricingSourceId,
    measuredQuote:{id:quote.id,sha256:quote.sha256,title:quote.title},
    review:copy(review),file:{name:file.name,bytes:file.bytes,sha256:file.sha256},
    files:copy(native.files),source:value,envelope,record:native.record};
}
export function commercialPerformanceSummary(value){
  return {id:value.id,title:value.label,label:value.label,savedAt:value.savedAt,
    nativeSourceId:value.nativeSourceId,performanceId:value.performanceId,performanceSha256:value.performanceSha256,
    tariffSourceId:value.tariffSourceId,pricingSourceId:value.pricingSourceId,
    measuredQuote:copy(value.measuredQuote),file:copy(value.file),
    ...(value.material?{material:copy(value.material)}:{}),review:copy(value.review)};
}
export async function readCommercialPerformanceSources(documents,tariffSources,quotes){
  const sources=[];
  for(const document of documents.filter(row=>row.kind==='PERFORMANCE')){
    const inspected=await inspectCommercialPerformanceSource(document.payload,{tariffSources,quotes});
    sources.push({...inspected,material:copy(document.material),documentId:document.id});
  }
  return sources.sort((a,b)=>b.savedAt.localeCompare(a.savedAt)||a.id.localeCompare(b.id));
}
export function commercialPerformanceQuoteDescends(quotes,quoteId,ancestorId){
  const seen=new Set();
  while(quoteId){
    if(quoteId===ancestorId)return true;
    if(seen.has(quoteId))fail('COMMERCIAL_PERFORMANCE_QUOTE_HISTORY','The saved quotation history contains a cycle.');
    seen.add(quoteId);
    const quote=quotes.find(row=>row.id===quoteId);
    if(!quote)return false;
    quoteId=quote.parentId??null;
  }
  return false;
}
function chosenPerformance(context,sourceId){
  if(!HASH.test(sourceId??''))fail('COMMERCIAL_PERFORMANCE_SOURCE_REQUIRED','Choose a recorded usage review.');
  const source=(context.performanceSources??[]).find(row=>row.id===sourceId);
  if(!source)fail('COMMERCIAL_PERFORMANCE_SOURCE_MISSING','This recorded usage review is not retained in the current case.',404);
  return source;
}
/** Prepare the ordinary quotation draft. A measured period never silently becomes a monthly volume. */
export function prepareCommercialPerformanceRevision(context,{sourceId,quoteId,quoteSha256,proposedMonthlyRequests,targetTariffSourceId}={}){
  const source=chosenPerformance(context,sourceId),quote=quoteFrom(context.quotes,quoteId,quoteSha256);
  if(!commercialPerformanceQuoteDescends(context.quotes,quote.id,source.measuredQuote.id))
    fail('COMMERCIAL_PERFORMANCE_QUOTE_HISTORY','Revise the measured quotation or one of its later editions.');
  if(typeof proposedMonthlyRequests!=='string'||!/^[1-9]\d*$/.test(proposedMonthlyRequests)||
      !Number.isSafeInteger(Number(proposedMonthlyRequests)))
    fail('COMMERCIAL_PERFORMANCE_PROPOSAL_REQUIRED','Enter the proposed whole monthly request volume.');
  const targetId=targetTariffSourceId??quote.sourceBindings.tariff?.id;
  const tariff=context.tariffSources.find(row=>row.id===targetId);
  const pricing=context.pricingSources.find(row=>row.id===tariff?.pricingSourceId);
  if(!tariff||!pricing||tariff.routeId!==source.review.route.routeId)
    fail('COMMERCIAL_PERFORMANCE_TARGET_REQUIRED','Choose a saved tariff and pricing scenario for the same route.');
  const route=pricing.selected.metrics.routes.find(row=>row.routeId===tariff.routeId);
  if(!route||route.method!==source.review.route.method||route.path!==source.review.route.path)
    fail('COMMERCIAL_PERFORMANCE_ROUTE_CHANGED','The proposed pricing source must retain the measured route method and path.');
  const draft=copy(quote.draft),old=new Map(draft.pricing.routes.map(row=>[row.routeId,row.monthlyRequests]));
  draft.parentId=quote.id;draft.performanceSourceId=source.id;
  draft.tariffSourceId=tariff.id;draft.pricingSourceId=pricing.id;
  draft.pricing.routes=pricing.rows.map(row=>({routeId:row.routeId,
    monthlyRequests:row.routeId===tariff.routeId?proposedMonthlyRequests:
      old.get(row.routeId)??String(row.monthlyRequests)}));
  return {draft,source:commercialPerformanceSummary(source),
    parent:{id:quote.id,sha256:quote.sha256,title:quote.title},
    proposal:{routeId:tariff.routeId,monthlyRequests:proposedMonthlyRequests,
      tariffSourceId:tariff.id,pricingSourceId:pricing.id,
      rateChanged:exactDecimal(route.quoteUsd)!==exactDecimal(source.review.quoted.savedUnitUsd)}};
}
/** Quote review remains synchronous after Commercial context has inspected the complete source. */
export function bindCommercialPerformance(context,draft,{tariff,pricing,usage}={}){
  if(!draft.performanceSourceId)return null;
  const source=chosenPerformance(context,draft.performanceSourceId);
  if(!draft.parentId||!commercialPerformanceQuoteDescends(context.quotes,draft.parentId,source.measuredQuote.id))
    fail('COMMERCIAL_PERFORMANCE_QUOTE_HISTORY','Retain the measured quotation in the new edition history.');
  const route=draft.pricing.routes.find(row=>row.routeId===source.review.route.routeId);
  const proposed=usage?.lines.find(row=>row.routeId===source.review.route.routeId);
  if(!tariff||!pricing||tariff.routeId!==source.review.route.routeId||!route||!proposed)
    fail('COMMERCIAL_PERFORMANCE_TARGET_REQUIRED','Keep this recorded review with a saved tariff and pricing line for its route.');
  const proposedRoute=pricing.selected.metrics.routes.find(row=>row.routeId===source.review.route.routeId);
  if(!proposedRoute||proposedRoute.method!==source.review.route.method||proposedRoute.path!==source.review.route.path)
    fail('COMMERCIAL_PERFORMANCE_ROUTE_CHANGED','The proposed route must retain the measured method and path.');
  return {id:source.id,nativeSourceId:source.nativeSourceId,performanceId:source.performanceId,
    performanceSha256:source.performanceSha256,label:source.label,savedAt:source.savedAt,
    material:copy(source.material),file:copy(source.file),measuredQuote:copy(source.measuredQuote),
    measuredTariffSourceId:source.tariffSourceId,selectionRequestId:source.review.source.selectionRequestId,
    usageVersion:source.review.source.usageVersion,usageRevision:source.review.source.usageRevision,
    route:copy(source.review.route),period:copy(source.review.period),basis:copy(source.review.basis),
    quoted:copy(source.review.quoted),tariff:copy(source.review.tariff),
    costs:copy(source.review.costs),issues:copy(source.review.issues),
    proposed:{monthlyRequests:route.monthlyRequests,tariffSourceId:tariff.id,pricingSourceId:pricing.id,
      unitUsd:proposed.unitUsd,amountUsd:proposed.amountUsd,
      rateChanged:exactDecimal(proposed.unitUsd)!==exactDecimal(source.review.quoted.savedUnitUsd)}};
}
export function commercialPerformancePeriodText(period){
  const start=period?.observedFrom,end=period?.observedUntil;
  return start&&end?start+' through '+end:start||end||'Saved observation period';
}
export function renderCommercialPerformanceBasis(binding){
  const lines=[
    'Recorded period: '+commercialPerformancePeriodText(binding.period)+'.',
    'Recorded quantity: '+binding.basis.quantity+' '+binding.basis.label+'.',
    'At that recorded quantity, the earlier saved uniform rate of USD '+binding.quoted.savedUnitUsd+
      ' gives USD '+binding.quoted.valueAtObservedQuantityUsd+
      '; the selected '+binding.tariff.mode+' tariff schedule gives USD '+binding.tariff.quote.totalUsd+'.',
    'This revised quotation proposes '+binding.proposed.monthlyRequests+
      ' requests per month at USD '+binding.proposed.unitUsd+' per request.',
    'The proposed monthly volume is an explicit planning choice. The saved review retains the measured period and quantity separately.'
  ];
  return lines.join('\n\n');
}
export function renderCommercialPerformanceReport(source){
  const r=source.review,lines=['# '+source.label,'',
    'Quotation reviewed: '+source.measuredQuote.title,
    'Recorded period: '+commercialPerformancePeriodText(r.period),
    'Route: '+r.route.method+' '+r.route.path,
    'Quantity basis: '+r.basis.label,'Recorded quantity: '+r.basis.quantity,'',
    '## Price comparison','',
    'Saved uniform rate: USD '+r.quoted.savedUnitUsd,
    'Saved quote value at the recorded quantity: USD '+r.quoted.valueAtObservedQuantityUsd,
    'Original '+r.tariff.mode+' schedule at that quantity: USD '+r.tariff.quote.totalUsd,
    'Schedule less saved quote value: USD '+r.tariff.deltaFromSavedQuoteUsd,'',
    '## Original observation counts',''];
  for(const [name,value]of Object.entries(r.basis.counts??{}))
    lines.push('- '+name+': '+(value===null?'Not present in this retained source':value));
  lines.push('','## Cost view','',
    'Estimated unit cost at the selected quantity: '+(r.costs.estimated.valueAtBasisQuantityUsd===null?
      'Incomplete original inputs':'USD '+r.costs.estimated.valueAtBasisQuantityUsd),
    'Contribution using estimated unit cost: '+(r.costs.contributionUsingEstimatedUnitCostUsd===null?
      'Incomplete original inputs':'USD '+r.costs.contributionUsingEstimatedUnitCostUsd));
  if(r.costs.recorded)lines.push('','Selected recorded cost edition: '+r.costs.recorded.edition,
    'Cost period alignment: '+(typeof r.costs.recorded.periodAlignment==='object'?JSON.stringify(r.costs.recorded.periodAlignment):String(r.costs.recorded.periodAlignment)));
  if(r.issues.length)lines.push('','## Source and interpretation notes','',...r.issues.map(row=>'- '+row.message));
  lines.push('','The full native export accompanies this review. The original event, payment-option and delivery quantities retain their own meanings.','');
  return lines.join('\n');
}

// MIT. Quotation documents carried by the original merchant implementation files.
import {newCommissioning,commissioningWorkorder,commissioningFileBytes,validateCommissioning} from './commissioning.mjs';
import {validateServiceRecord} from './service-commitments.mjs';
import {canonical,sha256,jsonBytes,commercialError,inspectCommercialPricingSource,reviewCommercialUsage} from './commercial-pricing.mjs';

export const COMMERCIAL_DOCUMENT_SCHEMA='stellar-forge.merchant-commercial-document.v1';
export const COMMERCIAL_QUOTE_SCHEMA='stellar-forge.merchant-commercial-quote.v1';
export const COMMERCIAL_MATERIAL_KINDS={DRAFT:'commercial-quote-draft',PRICING:'commercial-pricing-source',
  QUOTE:'commercial-quote-edition',RESPONSE:'commercial-customer-response'};
const copy=value=>JSON.parse(JSON.stringify(value));
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const HASH=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const MICRO=1_000_000n;
const kinds=new Set(Object.values(COMMERCIAL_MATERIAL_KINDS));
function fail(code,message){throw commercialError(code,message);}
function object(value,allowed,label){if(!plain(value)||Object.keys(value).some(k=>!allowed.includes(k)))fail('COMMERCIAL_INPUT_INVALID','Unexpected '+label+' fields.');}
function text(value,label,max=16000,{empty=true}={}){if(typeof value!=='string'||value.length>max||/\0/.test(value)||!empty&&!value.trim())fail('COMMERCIAL_INPUT_INVALID','Supply '+label+' as complete text.');return value;}
function rows(value,label,max=500){if(!Array.isArray(value)||value.length>max)fail('COMMERCIAL_INPUT_INVALID','Supply the complete '+label+' list.');return value;}
function unique(values,label){if(new Set(values).size!==values.length)fail('COMMERCIAL_INPUT_INVALID','Every '+label+' needs a distinct identity.');}
function id(value,label='identity'){if(typeof value!=='string'||!value||value.length>200||/[\x00-\x20\x7f]/.test(value))fail('COMMERCIAL_INPUT_INVALID','Supply the original '+label+'.');return value;}
function selected(value,label){return value===null||value===''?null:id(value,label);}
function decimal(value,label){if(typeof value!=='string'||!/^(0|[1-9]\d{0,20})(?:\.\d{1,6})?$/.test(value))fail('COMMERCIAL_AMOUNT_INVALID','Enter '+label+' as nonnegative decimal text with at most six decimal places.');const [whole,fraction='']=value.split('.');return BigInt(whole)*MICRO+BigInt((fraction+'000000').slice(0,6));}
function usd(value){const negative=value<0n,n=negative?-value:value,f=String(n%MICRO).padStart(6,'0').replace(/0+$/,'');return (negative?'-':'')+String(n/MICRO)+(f?'.'+f:'');}
function date(value){if(value==='')return value;if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)fail('COMMERCIAL_DATE_INVALID','Use a calendar date for quote validity.');return value;}
export function emptyCommercialDraft(){return {parentId:null,title:'',customer:{name:'',contact:''},currency:'USD',
  implementationSourceId:'',serviceSourceId:'',pricingSourceId:'',validThrough:'',
  implementation:{lines:[]},service:{period:'MONTH',lines:[]},pricing:{routes:[]},
  terms:{scope:'',deliverables:'',exclusions:'',payment:'',acceptance:''},notes:''};}
export function normalizeCommercialDraft(value) {
  object(value,['parentId','title','customer','currency','implementationSourceId','serviceSourceId','pricingSourceId',
    'validThrough','implementation','service','pricing','terms','notes'],'quotation');
  const next=copy(value);
  next.parentId=selected(value.parentId??null,'parent quote');
  text(value.title,'quote title',400);object(value.customer,['name','contact'],'customer');
  text(value.customer.name,'customer name',500);text(value.customer.contact,'customer contact',2000);
  if(value.currency!=='USD')fail('COMMERCIAL_CURRENCY_INVALID','The original pricing source and this quote use USD.');
  for(const key of ['implementationSourceId','serviceSourceId','pricingSourceId'])text(value[key],key,200);
  date(value.validThrough);text(value.notes,'quote notes');
  object(value.implementation,['lines'],'implementation');object(value.service,['period','lines'],'service');
  object(value.pricing,['routes'],'pricing');object(value.terms,['scope','deliverables','exclusions','payment','acceptance'],'customer terms');
  for(const [key,v]of Object.entries(value.terms))text(v,key,64000);
  if(value.service.period!=='MONTH')fail('COMMERCIAL_PERIOD_INVALID','The original planned pricing period is a month.');
  for(const kind of ['implementation','service']) {
    const isWork=kind==='implementation',lineRows=rows(value[kind].lines,kind);
    unique(lineRows.map(row=>id(row.id,'quoted line')),'quoted line');
    for(const row of lineRows) {
      object(row,isWork?['id','taskId','title','hours','rateUsd']:['id','commitmentId','title','quantity','unitUsd'],kind+' line');
      selected(row[isWork?'taskId':'commitmentId'],'original work');text(row.title,'quoted work',2400);
      text(row[isWork?'hours':'quantity'],'quoted quantity',40);text(row[isWork?'rateUsd':'unitUsd'],'quoted USD unit price',40);
    }
  }
  const routes=rows(value.pricing.routes,'route volume');
  unique(routes.map(row=>id(row.routeId,'pricing route')),'pricing route');
  for(const row of routes){object(row,['routeId','monthlyRequests'],'route volume');text(row.monthlyRequests,'monthly request volume',24);}
  return next;
}
function documentKind(kind){if(!Object.hasOwn(COMMERCIAL_MATERIAL_KINDS,kind))fail('COMMERCIAL_DOCUMENT_INVALID','Unknown original commercial document.');return COMMERCIAL_MATERIAL_KINDS[kind];}
export function makeCommercialDocument({kind,requestId,caseId,createdAt,request,payload}) {
  documentKind(kind);
  if(!UUID.test(requestId??'')||!UUID.test(caseId??'')||!Number.isFinite(Date.parse(createdAt))||
      new Date(createdAt).toISOString()!==createdAt||!HASH.test(request?.sha256??''))
    fail('COMMERCIAL_DOCUMENT_INVALID','Keep the original case, operation and complete request identity.');
  return {schema:COMMERCIAL_DOCUMENT_SCHEMA,kind,id:requestId,caseId,createdAt,request:copy(request),payload:copy(payload)};
}
export function readCommercialDocuments(state,caseId) {
  const result=[];
  for(const material of state.materials)if(kinds.has(material.kind)) {
    const bytes=Buffer.from(commissioningFileBytes(state,material.sha256)),value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    if(value?.schema!==COMMERCIAL_DOCUMENT_SCHEMA||!UUID.test(value.id??'')||!UUID.test(value.caseId??'')||
        documentKind(value.kind)!==material.kind||material.id!=='commercial:'+value.id||
        !HASH.test(value.request?.sha256??'')||typeof value.createdAt!=='string'||
        value.createdAt!==material.recordedAt||value.request.actor!==material.actor||material.taskIds.length)
      fail('COMMERCIAL_DOCUMENT_CHANGED','A retained commercial document differs from its original case or material.');
    result.push({...value,material:{id:material.id,sha256:material.sha256,bytes:bytes.length}});
  }
  unique(result.map(row=>row.id),'original commercial request');
  return result;
}
function implementationSource(state,edition) {
  const {packet}=commissioningWorkorder(state,edition.id);
  const tasks=state.tasks.filter(t=>t.editionId===edition.id||t.editionId===null);
  const snapshot={edition:copy(edition),packet:copy(packet),plan:copy(state.plan),tasks:copy(tasks)};
  return {id:edition.id,title:packet.title||state.plan.title||'Implementation '+edition.id,
    sha256:sha256(canonical(snapshot)),summary:tasks.filter(t=>!t.retired).length+' retained implementation tasks',
    rows:tasks.filter(t=>!t.retired).map(row=>({id:row.id,title:row.title,status:row.status,acceptance:row.acceptance,owner:row.owner})),
    snapshot};
}
export async function commercialContext(workspace,{caseId,workspaceId,revision}={}) {
  if(!UUID.test(caseId??'')||!HASH.test(revision??'')||typeof workspaceId!=='string'||!workspaceId)
    fail('COMMERCIAL_CASE_REQUIRED','Open the original saved case and workspace.');
  const state=await validateCommissioning(workspace.commissioning??newCommissioning());
  const documents=readCommercialDocuments(state,caseId);
  const implementationSources=state.editions.map(e=>implementationSource(state,e));
  const service=workspace.service?await validateServiceRecord(workspace.service):null;
  const serviceSources=(service?.terms??[]).map(terms=>({id:terms.id+':'+terms.revision,
    title:terms.title+' / revision '+terms.revision,sha256:terms.sha256,
    summary:terms.status+' · '+terms.owner+' · '+terms.effectiveFrom,
    rows:[{id:terms.id,title:terms.title}],snapshot:copy(terms)}));
  const pricingSources=documents.filter(d=>d.kind==='PRICING').map(document=>{
    const inspected=inspectCommercialPricingSource(document.payload);
    return {...inspected,material:document.material,documentId:document.id};
  });
  const quotes=documents.filter(d=>d.kind==='QUOTE').map(d=>{
    const quote=copy(d.payload),{sha256:hash,...unsealed}=quote;
    if(quote.schema!==COMMERCIAL_QUOTE_SCHEMA||quote.id!==d.id||sha256(canonical(unsealed))!==hash)
      fail('COMMERCIAL_QUOTE_CHANGED','A saved quote differs from its original edition.');
    const receiving=documents.filter(r=>r.kind==='RESPONSE'&&r.payload.quoteId===quote.id).map(r=>{
      if(r.payload.quoteSha256!==quote.sha256)fail('COMMERCIAL_RESPONSE_CHANGED','A customer response points to different quote bytes.');
      return {id:r.id,recordedAt:r.createdAt,actor:r.request.actor,...copy(r.payload)};
    }).sort((a,b)=>b.recordedAt.localeCompare(a.recordedAt)||b.id.localeCompare(a.id));
    return {...quote,originCaseId:d.caseId,receiving,material:d.material};
  }).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id));
  const drafts=documents.filter(d=>d.kind==='DRAFT').sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id));
  return {state,documents,scope:{caseId,workspaceId},revision,implementationSources,serviceSources,pricingSources,
    quotes,draft:drafts.length?normalizeCommercialDraft(drafts[0].payload):null};
}
function sourceBinding(source,kind) {
  if(!source)return null;
  if(kind==='pricing')return {id:source.id,sha256:source.sha256,planId:source.planId,scenarioId:source.scenarioId,
    version:source.version,title:source.title,planLabel:source.planLabel,scenarioLabel:source.scenarioLabel,
    reviewSha256:source.reviewSha256,material:copy(source.material),
    files:source.source.files.map(({name,bytes,sha256})=>({name,bytes,sha256}))};
  return {id:source.id,sha256:source.sha256,snapshot:copy(source.snapshot)};
}
export function commercialView(context) {
  const summary=({id,title,sha256,summary,rows,version,planId,scenarioId,reviewSha256})=>({id,title,sha256,summary,rows,
    ...(version?{version,planId,scenarioId,reviewSha256}:{})});
  return {schema:'stellar-forge.merchant-commercial-workspace.v1',scope:context.scope,revision:context.revision,
    implementationRevision:context.state.revision,implementationSources:context.implementationSources.map(summary),
    serviceSources:context.serviceSources.map(summary),pricingSources:context.pricingSources.map(summary),
    draft:context.draft,quotes:context.quotes,
    requests:context.documents.map(d=>({requestId:d.id,action:d.request.action,state:'COMPLETE',documentSha256:d.material.sha256}))};
}
function choose(rows,selectedId,label) {
  if(!selectedId)return null;
  const value=rows.find(r=>r.id===selectedId);
  if(!value)fail('COMMERCIAL_SOURCE_REQUIRED','The selected '+label+' is not retained in this original case.');
  return value;
}
function feeLine(row,kind,source) {
  const isWork=kind==='IMPLEMENTATION',reference=row[isWork?'taskId':'commitmentId'];
  if(reference&&!source?.rows.some(r=>r.id===reference))fail('COMMERCIAL_WORK_CHANGED','A quoted line no longer belongs to its selected original work.');
  text(row.title,'quoted work title',2400,{empty:false});
  const quantityText=row[isWork?'hours':'quantity'],priceText=row[isWork?'rateUsd':'unitUsd'];
  const quantity=decimal(quantityText,isWork?'quoted hours':'quoted service quantity'),unit=decimal(priceText,'quoted USD unit price');
  const numerator=quantity*unit,amount=(numerator+MICRO/2n)/MICRO;
  return {id:row.id,kind,title:row.title,sourceId:source?.id??null,sourceRowId:reference??null,
    quantity:quantityText,unitUsd:priceText,amountUsd:usd(amount),calculation:{quantityMillionths:quantity.toString(),
      unitMicroUsd:unit.toString(),numerator:numerator.toString(),denominator:MICRO.toString(),
      rounding:'HALF_UP_TO_MICRO_USD',rounded:numerator%MICRO!==0n}};
}
export function reviewCommercialQuote(context,input) {
  const draft=normalizeCommercialDraft(input);
  text(draft.title,'quote title',400,{empty:false});text(draft.customer.name,'customer name',500,{empty:false});
  for(const key of ['scope','deliverables','payment','acceptance'])text(draft.terms[key],key,64000,{empty:false});
  if(draft.parentId&&!context.quotes.some(q=>q.id===draft.parentId))fail('COMMERCIAL_PARENT_REQUIRED','Keep the original parent edition when revising a quote.');
  const implementation=choose(context.implementationSources,draft.implementationSourceId,'implementation edition');
  const service=choose(context.serviceSources,draft.serviceSourceId,'service terms');
  const pricing=choose(context.pricingSources,draft.pricingSourceId,'pricing scenario');
  const lines=[...draft.implementation.lines.map(row=>feeLine(row,'IMPLEMENTATION',implementation)),
    ...draft.service.lines.map(row=>feeLine(row,'RECURRING_SERVICE',service))];
  let usage=null;
  if(pricing){usage=reviewCommercialUsage(pricing.source,draft.pricing.routes);lines.push(...usage.lines);}
  else if(draft.pricing.routes.length)fail('COMMERCIAL_PRICING_SOURCE_REQUIRED','Select the original pricing source for the quoted routes.');
  if(!lines.length)fail('COMMERCIAL_LINES_REQUIRED','Add the work, service or original route volumes included in this quotation.');
  if(usage?.grossUsd===null)fail('COMMERCIAL_USD_VALUE_REQUIRED','Complete the selected route USD valuations in the original pricing workspace before quoting them.');
  const sum=kind=>lines.filter(l=>l.kind===kind).reduce((total,l)=>total+decimal(l.amountUsd,'calculated line amount'),0n);
  const implementationTotal=sum('IMPLEMENTATION'),serviceTotal=sum('RECURRING_SERVICE'),usageTotal=sum('ROUTE_USAGE');
  const sourceBindings={implementation:sourceBinding(implementation,'implementation'),
    service:sourceBinding(service,'service'),pricing:sourceBinding(pricing,'pricing')};
  const totals={currency:'USD',implementationUsd:usd(implementationTotal),recurringServiceUsd:usd(serviceTotal),
    routeUsageUsd:usd(usageTotal),recurringUsd:usd(serviceTotal+usageTotal),recurringPeriod:'MONTH'};
  const issues=[];
  if(service&&service.snapshot.status!=='active')issues.push({code:'SERVICE_TERMS_'+service.snapshot.status.toUpperCase(),
    severity:'warning',message:'The selected original service terms are '+service.snapshot.status+'. Quote acceptance is recorded separately from activating service.'});
  if(lines.some(l=>l.calculation?.rounded))issues.push({code:'MICRO_USD_ROUNDING',severity:'info',
    message:'Quoted work quantities use six decimals. Each extended fee is rounded half-up to one millionth of a USD; the route calculation remains original SF97.'});
  const review={schema:'stellar-forge.merchant-commercial-review.v1',draftSha256:sha256(canonical(draft)),
    sourceBindings,lines,totals,issues,pricingReview:usage?.review??null};
  // Native review generation time is descriptive; all calculation inputs remain in its original identity.
  const fingerprint=copy(review);if(fingerprint.pricingReview)delete fingerprint.pricingReview.generatedAt;
  review.reviewSha256=sha256(canonical(fingerprint));
  review.customerDocument=renderCommercialQuote({draft,...review});
  return review;
}
function serviceCalendarText(calendar) {
  const weekdays=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  const windows=rows=>rows.length?rows.map(row=>row.start+'–'+row.end).join(', '):'Closed';
  const lines=['Time zone: '+calendar.timeZone+'.'];
  if(calendar.mode==='always')lines.push('Regular coverage: 24 hours every day.');
  else for(let day=1;day<=7;day++)lines.push('- '+weekdays[day-1]+': '+windows(calendar.week.find(row=>row.day===day)?.windows??[]));
  if(calendar.exceptions.length)lines.push('Dated coverage changes:',...calendar.exceptions.map(row=>'- '+row.date+': '+windows(row.windows)));
  return lines;
}
export function renderCommercialQuote(value) {
  const d=value.draft,t=value.totals,lines=value.lines;
  const reference=value.id&&value.createdAt?'Q-'+value.createdAt.slice(0,10).replaceAll('-','')+'-'+value.id.slice(0,8):null;
  const out=['# '+d.title,'',d.customer.name,...(d.customer.contact?[d.customer.contact]:[]),'',
    ...(reference?['Quote edition: '+reference,'Issued: '+value.createdAt.slice(0,10)]:['Quotation review']),
    'Currency: USD',...(d.validThrough?['Valid through: '+d.validThrough]:[]),'',
    '## Commercial terms','','Implementation: USD '+t.implementationUsd,
    'Service per month: USD '+t.recurringServiceUsd,'Planned route usage per month: USD '+t.routeUsageUsd,
    'Total recurring amount per month: USD '+t.recurringUsd,'',
    '## Included work and service',''];
  for(const line of lines)out.push('- '+line.title+' — '+line.quantity+
    (line.kind==='IMPLEMENTATION'?' hours':line.kind==='ROUTE_USAGE'?' requests':' units')+
    ' × USD '+line.unitUsd+' = USD '+line.amountUsd+(line.kind==='IMPLEMENTATION'?'':' / month'));
  for(const [key,title]of [['scope','Scope'],['deliverables','Deliverables'],['payment','Payment schedule'],
    ['acceptance','Receiving and acceptance'],['exclusions','Exclusions']])if(d.terms[key])out.push('','## '+title,'',d.terms[key]);
  const service=value.sourceBindings.service?.snapshot;
  if(service) {
    const condition={ENDPOINT_UNAVAILABLE:'Endpoint unavailable',OBSERVER_INCOMPLETE:'Incomplete observation',
      HTTP_5XX:'Server error',DISCONNECTED:'Disconnected endpoint',DELIVERY_UNAVAILABLE:'Delivery unavailable',
      DELIVERY_BACKLOG:'Delivery backlog',DELIVERY_EXHAUSTED:'Delivery attempts exhausted'};
    out.push('','## Selected service commitments','',service.title+' / revision '+service.revision,
      'Responsible owner: '+service.owner,...serviceCalendarText(service.calendar),
      ...service.targets.map(row=>'- '+condition[row.kind]+': response within '+row.responseMinutes+
        ' service minutes; recovery within '+row.recoveryMinutes+' service minutes.'),
      'Service minutes accrue during the coverage windows above.',
      'Terms status: '+service.status+'.',...(service.note?[service.note]:[]));
  }
  const pricing=value.sourceBindings.pricing;
  if(pricing)out.push('','## Route volume basis','',
    'The quoted request volumes are explicit monthly planning assumptions. Route USD unit values and totals use the selected merchant pricing scenario.',
    'Pricing source: '+(pricing.planLabel||pricing.title||'Saved merchant pricing')+'.',
    'Scenario: '+(pricing.scenarioLabel||'Selected saved scenario')+'.');
  if(d.notes)out.push('','## Notes','',d.notes);
  out.push('','## Calculation terms','',
    'Work and service quantities and unit prices use up to six decimal places. Each extended work or service fee uses half-up rounding to one millionth of a USD.',
    'Planned route charges use the selected merchant pricing calculation and the monthly request quantities shown above.','');
  return out.join('\n');
}
export function sealCommercialQuote({id,createdAt,draft,review}) {
  const value={schema:COMMERCIAL_QUOTE_SCHEMA,id,parentId:draft.parentId??null,createdAt,title:draft.title,
    draft:copy(draft),reviewSha256:review.reviewSha256,draftSha256:review.draftSha256,
    sourceBindings:copy(review.sourceBindings),lines:copy(review.lines),totals:copy(review.totals),
    issues:copy(review.issues),pricingReview:copy(review.pricingReview),
    customerDocument:renderCommercialQuote({draft,...review,id,createdAt})};
  return {...value,sha256:sha256(canonical(value))};
}
export function compareCommercialQuotes(before,after) {
  const amounts=['implementationUsd','recurringServiceUsd','routeUsageUsd','recurringUsd'];
  const differences=Object.fromEntries(amounts.map(k=>[k,usd(decimal(after.totals[k],k)-decimal(before.totals[k],k))]));
  const changes=[];
  for(const key of ['implementation','service','pricing'])if(canonical(before.sourceBindings[key])!==canonical(after.sourceBindings[key]))changes.push(key+' original source changed');
  for(const key of ['scope','deliverables','payment','acceptance','exclusions'])if(before.draft.terms[key]!==after.draft.terms[key])changes.push(key+' changed');
  return {before:{id:before.id,sha256:before.sha256,title:before.title},after:{id:after.id,sha256:after.sha256,title:after.title},
    differences,changes,lines:{before:before.lines,after:after.lines},
    customerResponses:{before:before.receiving,after:after.receiving}};
}

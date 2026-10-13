// MIT. Private operator assessments in the original SF74 commercial case.
import {evaluateWorkshareEconomics} from '../../../scf_2026/sf47_budget_model/workspace/cohort_planning.mjs';
import {canonical,sha256,commercialError} from '../commercial-pricing.mjs';

export const COMMERCIAL_ECONOMICS_INPUT_SCHEMA='stellar-forge.merchant-commercial-economics-input.v1';
export const COMMERCIAL_ECONOMICS_REVIEW_SCHEMA='stellar-forge.merchant-commercial-economics-review.v1';
export const COMMERCIAL_ECONOMICS_SCHEMA='stellar-forge.merchant-commercial-economics.v1';
const HASH=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const copy=value=>JSON.parse(JSON.stringify(value));
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function fail(code,message){throw commercialError(code,message);}
function fields(value,allowed,label){if(!object(value)||Object.keys(value).some(key=>!allowed.includes(key)))fail('COMMERCIAL_ECONOMICS_INPUT','Unexpected '+label+' fields.');}
function text(value,label,max=16000,empty=true){if(typeof value!=='string'||value.length>max||/\0/.test(value)||!empty&&!value.trim())fail('COMMERCIAL_ECONOMICS_INPUT','Supply '+label+' as complete text.');return value;}
function decimal(value,label){if(value===null)return null;if(typeof value!=='string'||value.length>100||!/^(0|[1-9]\d*)(?:\.\d{1,24})?$/.test(value))fail('COMMERCIAL_ECONOMICS_AMOUNT',label+' must be nonnegative decimal text or null.');return value;}
function day(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)fail('COMMERCIAL_ECONOMICS_DATE','Use the actual assessment date in YYYY-MM-DD form.');return value;}
function section(value,label){
  fields(value,['hours','cashHourlyCostUsd','valuationHourlyRateUsd','costs','costCoverage','note'],label);
  for(const key of ['hours','cashHourlyCostUsd','valuationHourlyRateUsd'])decimal(value[key],label+'.'+key);
  if(!['INCOMPLETE','COMPLETE'].includes(value.costCoverage)||!Array.isArray(value.costs)||value.costs.length>200)
    fail('COMMERCIAL_ECONOMICS_COSTS','Retain an explicit cost coverage and complete cost-line list.');
  const ids=new Set();
  for(const row of value.costs){
    fields(row,['id','label','amountUsd','source'],label+' cost');
    if(typeof row.id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(row.id)||ids.has(row.id))
      fail('COMMERCIAL_ECONOMICS_COST_ID','Each cost needs a unique stable identifier.');
    ids.add(row.id);text(row.label,'cost label',500,false);decimal(row.amountUsd,'cost amount');
    text(row.source,'cost source or explicit assumption',4000);
  }
  text(value.note,label+' cost scope and labor basis');
  return copy(value);
}
export function emptyCommercialEconomicsInput(quote,{asOfDate=new Date().toISOString().slice(0,10)}={}){
  const blank=()=>({hours:null,cashHourlyCostUsd:null,valuationHourlyRateUsd:null,costs:[],costCoverage:'INCOMPLETE',note:''});
  return {schema:COMMERCIAL_ECONOMICS_INPUT_SCHEMA,quoteId:quote.id,quoteSha256:quote.sha256,asOfDate,
    implementation:blank(),care:blank(),
    careCapacity:{availableHoursMonthly:null,committedOtherHoursMonthly:null,source:''},
    effortIncreasesPct:['0','20','25'],note:''};
}
export function normalizeCommercialEconomicsInput(value){
  fields(value,['schema','quoteId','quoteSha256','asOfDate','implementation','care','careCapacity','effortIncreasesPct','note'],'assessment');
  if(value.schema!==COMMERCIAL_ECONOMICS_INPUT_SCHEMA||!UUID.test(value.quoteId??'')||!HASH.test(value.quoteSha256??''))
    fail('COMMERCIAL_ECONOMICS_QUOTE','Keep the original sealed quote identity.');
  day(value.asOfDate);section(value.implementation,'implementation');section(value.care,'care');
  fields(value.careCapacity,['availableHoursMonthly','committedOtherHoursMonthly','source'],'care capacity');
  decimal(value.careCapacity.availableHoursMonthly,'available monthly care hours');
  decimal(value.careCapacity.committedOtherHoursMonthly,'other committed monthly care hours');
  text(value.careCapacity.source,'capacity source or explicit assumption',4000);
  if(!Array.isArray(value.effortIncreasesPct)||value.effortIncreasesPct.length>30)
    fail('COMMERCIAL_ECONOMICS_SENSITIVITY','Supply at most 30 explicit effort increases.');
  for(const increase of value.effortIncreasesPct){if(increase===null)fail('COMMERCIAL_ECONOMICS_SENSITIVITY','Effort increases must be explicit.');decimal(increase,'effort increase');}
  text(value.note,'assessment note');
  return copy(value);
}
function selectedQuote(context,input){
  const quote=context.quotes.find(row=>row.id===input.quoteId);
  if(!quote||quote.sha256!==input.quoteSha256)fail('COMMERCIAL_ECONOMICS_QUOTE_CHANGED','Choose the exact retained quote edition.');
  if(quote.draft?.currency!=='USD'||quote.totals?.currency!=='USD')fail('COMMERCIAL_ECONOMICS_CURRENCY','The original quote and assessment must use USD.');
  for(const name of ['implementationUsd','recurringServiceUsd','routeUsageUsd'])decimal(quote.totals[name],name);
  return quote;
}
function reviewSection(value,{label,fee,effortIncreasesPct,capacity}){
  const row={id:label,label:label==='care'?'Monthly quoted care':'Quoted implementation',currency:'USD',
    fee,hours:value.hours,hourlyCost:value.cashHourlyCostUsd,otherCosts:null,sourceIds:[],sourceNote:value.note};
  const options={effortIncreasesPct,costs:value.costs.map(cost=>cost.amountUsd),costCoverage:value.costCoverage,
    ...(capacity?{availableHours:capacity.availableHoursMonthly,committedHours:capacity.committedOtherHoursMonthly}:{})};
  const cash=evaluateWorkshareEconomics(row,options);
  const valuation=evaluateWorkshareEconomics({...row,hourlyCost:value.valuationHourlyRateUsd},options);
  const missingInputs=[];
  for(const key of ['hours','cashHourlyCostUsd'])if(value[key]===null)missingInputs.push(label+'.'+key);
  for(const cost of value.costs)if(cost.amountUsd===null)missingInputs.push(label+'.costs.'+cost.id+'.amountUsd');
  if(value.costCoverage!=='COMPLETE')missingInputs.push(label+'.costCoverage');
  return {cash,valuation,knownOtherCostsUsd:cash.otherCostCoverage.knownSubtotal,missingInputs,
    scope:label==='care'?'One full monthly care term; no daily prorating or route-usage income.':'One complete quoted implementation.',
    costCoverage:value.costCoverage};
}
export function reviewCommercialEconomics(context,raw){
  const input=normalizeCommercialEconomicsInput(raw),quote=selectedQuote(context,input);
  const implementation=reviewSection(input.implementation,{label:'implementation',fee:quote.totals.implementationUsd,effortIncreasesPct:input.effortIncreasesPct});
  const care=reviewSection(input.care,{label:'care',fee:quote.totals.recurringServiceUsd,effortIncreasesPct:input.effortIncreasesPct,capacity:input.careCapacity});
  const c=care.cash.capacity;
  const capacity={availableHoursMonthly:c.availableHours,committedOtherHoursMonthly:c.committedHours,
    remainingHoursMonthly:c.remainingHours,maxWholeCareContracts:c.maxWholeWorkshares,status:c.status,
    source:input.careCapacity.source,
    cases:care.cash.capacityCases.map(row=>({effortIncreasePct:row.effortIncreasePct,hours:row.hours,maxWholeCareContracts:row.maxWholeWorkshares,status:row.status})),
    scope:'Whole identical care contracts that fit the remaining monthly hours, including this proposed contract. Other commitments exclude it. This is a planning ceiling, not booked demand.'};
  const issues=[];
  for(const result of [implementation,care])for(const path of result.missingInputs)issues.push({code:'COST_UNKNOWN',path,message:'This declared cash-cost input is unspecified; review the scope before treating the assessment as complete.'});
  if(c.status==='UNKNOWN')issues.push({code:'CAPACITY_UNKNOWN',path:'careCapacity',message:'Enter available hours, other committed hours and hours per care contract to calculate capacity.'});
  if(c.status==='OVERCOMMITTED')issues.push({code:'CAPACITY_OVERCOMMITTED',path:'careCapacity',message:'Other committed hours already exceed the selected available hours.'});
  if(c.status==='ZERO_HOURS_UNBOUNDED')issues.push({code:'CAPACITY_ZERO_HOURS',path:'care.hours',message:'A zero-hour care estimate does not yield a finite capacity ceiling.'});
  const review={schema:COMMERCIAL_ECONOMICS_REVIEW_SCHEMA,input,
    quote:{id:quote.id,sha256:quote.sha256,originCaseId:quote.originCaseId,title:quote.title,currency:quote.draft.currency,
      implementationUsd:quote.totals.implementationUsd,recurringServiceUsd:quote.totals.recurringServiceUsd,
      routeUsageUsd:quote.totals.routeUsageUsd,sourceBindings:copy(quote.sourceBindings)},
    implementation,care,capacity,routeEconomics:copy(quote.pricingReview??null),issues,
    scope:'Private operator planning attached to the original quote. Cash cost and planning labor valuation are separate scenarios, not additive. No receipts, customer acceptance, paid purchases, work records or Forecast rows are created. Quote prices and original route economics are unchanged.'};
  return {...review,reviewSha256:sha256(canonical(review))};
}
export function sealCommercialEconomics({id,createdAt,review}){
  if(!UUID.test(id??'')||typeof createdAt!=='string'||!Number.isFinite(Date.parse(createdAt))||new Date(createdAt).toISOString()!==createdAt)
    fail('COMMERCIAL_ECONOMICS_ID','Keep the original assessment request and recorded time.');
  const {reviewSha256,...body}=review;
  if(review.schema!==COMMERCIAL_ECONOMICS_REVIEW_SCHEMA||sha256(canonical(body))!==reviewSha256)
    fail('COMMERCIAL_ECONOMICS_REVIEW','Retain the complete reviewed calculation.');
  const value={schema:COMMERCIAL_ECONOMICS_SCHEMA,id,createdAt,quoteId:review.input.quoteId,
    quoteSha256:review.input.quoteSha256,review:copy(review)};
  return {...value,sha256:sha256(canonical(value))};
}
export function readCommercialEconomics(context){
  const assessments=context.documents.filter(document=>document.kind==='ECONOMICS').map(document=>{
    const value=document.payload;
    if(!object(value)||value.schema!==COMMERCIAL_ECONOMICS_SCHEMA||value.id!==document.id||value.createdAt!==document.createdAt)
      fail('COMMERCIAL_ECONOMICS_CHANGED','The retained assessment differs from its original case material.');
    const {sha256:hash,...body}=value;
    if(!HASH.test(hash??'')||sha256(canonical(body))!==hash||value.quoteId!==value.review?.input?.quoteId||value.quoteSha256!==value.review?.input?.quoteSha256)
      fail('COMMERCIAL_ECONOMICS_CHANGED','Keep the original assessment bytes and quote binding.');
    const actual=reviewCommercialEconomics(context,value.review.input);
    if(canonical(actual)!==canonical(value.review))
      fail('COMMERCIAL_ECONOMICS_REPLAY_CHANGED','The saved assessment does not reproduce from its original quote and retained inputs.');
    return {...copy(value),originCaseId:document.caseId,material:copy(document.material)};
  }).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id));
  const latestByQuote={};
  for(const row of assessments)if(!Object.hasOwn(latestByQuote,row.quoteId))latestByQuote[row.quoteId]=row.id;
  return {schema:'stellar-forge.merchant-commercial-economics-workspace.v1',assessments,latestByQuote};
}
function cell(value){return value===null?'Unknown':String(value).replace(/\|/g,'\\|').replace(/[\r\n]/g,' ');}
export function renderCommercialEconomics(assessment){
  const review=assessment.review??assessment;
  const lines=['# Private quote economics assessment','',
    'Quote: '+review.quote.title+' ('+review.quote.id+')','Quote SHA-256: '+review.quote.sha256,
    'As of: '+review.input.asOfDate,'',review.scope,''];
  for(const [key,title]of [['implementation','Implementation'],['care','Monthly care']]){
    const section=review[key],input=review.input[key];
    lines.push('## '+title,'',section.scope,'','Other-cost coverage: '+input.costCoverage+'. Known other-cost subtotal: USD '+section.knownOtherCostsUsd+'.',
      '', 'Cost scope and labor basis: '+input.note,'',
      '| Cost | USD | Source / assumption |','| --- | ---: | --- |');
    for(const cost of input.costs)lines.push('| '+cell(cost.label)+' | '+cell(cost.amountUsd)+' | '+cell(cost.source)+' |');
    for(const [basis,label]of [['cash','Cash-cost scenario'],['valuation','Planning-value scenario (not cash)']]){
      lines.push('','### '+label,'','Hourly input: USD '+cell(section[basis].hourlyCost)+'. Break-even hours: '+cell(section[basis].breakEvenHours)+'.','',
        '| Effort increase % | Hours | Labor USD | Total cost USD | Contribution USD | Margin % |',
        '| ---: | ---: | ---: | ---: | ---: | ---: |');
      for(const row of section[basis].cases)lines.push('| '+[row.effortIncreasePct,row.hours,row.laborCost,row.totalCost,row.contribution,row.marginPercent].map(cell).join(' | ')+' |');
    }
  }
  lines.push('','## Monthly care capacity','',review.capacity.scope,'',
    'Available hours: '+cell(review.capacity.availableHoursMonthly)+'. Other committed hours: '+cell(review.capacity.committedOtherHoursMonthly)+'. Remaining hours: '+cell(review.capacity.remainingHoursMonthly)+'.',
    'Whole care contracts: '+cell(review.capacity.maxWholeCareContracts)+'. Status: '+review.capacity.status+'.',
    'Source / assumption: '+review.capacity.source,'',
    '## Original route pricing','',
    'Quoted route usage: USD '+cell(review.quote.routeUsageUsd)+' / month. The original SF97 review is retained in the complete assessment JSON; it is not added to the care contribution.',
    '','## Assessment notes','',review.input.note,'','## Incomplete inputs and findings','');
  for(const issue of review.issues)lines.push('- '+issue.path+': '+issue.message);
  if(!review.issues.length)lines.push('The declared cost and capacity inputs are complete for this assessment scope.');
  lines.push('','Review SHA-256: '+review.reviewSha256);
  return lines.join('\n')+'\n';
}

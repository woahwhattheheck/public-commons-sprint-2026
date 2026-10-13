// MIT. Exact forecast assumptions through the original workbook reader and forecast writer.
import {zipWorkspace} from '../../../../stellar-forge/developer-site/dist/onboarding.mjs';
import {sha256,parseTable} from '../../../../stellar-forge/developer-site/dist/source-table-workspace.mjs';
import {workbookUpload,decodeWorkbookBytes,encodeWorkbookBytes,validateWorkbookSource,
  validateWorkbookProjection,MAX_WORKBOOK_PROJECT_BYTES} from './source-workbooks.mjs';

export const FORECAST_WORKBOOK_SCHEMA='stellar-forge.forecast-workbook.v1';
export const FORECAST_WORKBOOK_RETURN_SCHEMA=FORECAST_WORKBOOK_SCHEMA+'.return';
export const MAX_FORECAST_WORKBOOK_BYTES=8*1024*1024;
const copy=v=>JSON.parse(JSON.stringify(v));
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const own=(v,k)=>Object.prototype.hasOwnProperty.call(v,k);
const need=(v,m)=>{if(!v)throw Error(m);};
const text=v=>v===null||v===undefined?'':String(v);
const utf8=v=>new TextEncoder().encode(v);
const json=v=>JSON.stringify(v,null,2)+'\n';
export const signature=v=>JSON.stringify(Array.isArray(v)?v.map(x=>JSON.parse(signature(x))):
  plain(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,JSON.parse(signature(v[k]))])):v);
const equal=(a,b)=>signature(a)===signature(b);
const stable=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(v);
const HASH=/^[a-f0-9]{64}$/;
const ROOT=['name','asOfDate','calendarStart','openingCash','packageOverrides','invoiceOverrides','grantReceipts','commercial','capacity','note','fxRates','customerFunding'];
function safe(v,depth=0){need(depth<40,'Keep the complete original forecast within its supported nesting.');if(Array.isArray(v)){need(v.length<=5000,'A forecast list exceeds the original record limit.');v.forEach(x=>safe(x,depth+1));}else if(plain(v)){for(const [k,x]of Object.entries(v)){need(!['__proto__','prototype','constructor'].includes(k),'Use ordinary forecast field names.');safe(x,depth+1);}}else need(v===null||typeof v==='string'&&v.length<=100000||typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v),'Keep original JSON values.');}
function verifyInputs(v){need(plain(v)&&Object.keys(v).every(k=>ROOT.includes(k)),'Use the complete original Forecast input.');safe(v);need(['packageOverrides','invoiceOverrides','grantReceipts','commercial'].every(k=>Array.isArray(v[k]))&&plain(v.openingCash)&&plain(v.capacity),'Retain every original Forecast section.');need(utf8(json(v)).length<=MAX_FORECAST_WORKBOOK_BYTES,'The complete forecast exceeds its original input limit.');return copy(v);}
function optionsValid(o){need(/^operation-[a-f0-9]{32}$/.test(o.caseId||'')&&HASH.test(o.planContentSha256||''),'Bind the workbook to its original case and selected plan content.');}
const fields=(name,headers,key)=>({name,headers:headers.split('|'),key});
export const FORECAST_WORKBOOK_SHEETS=[
 fields('Forecast','field|state|value',[0]),
 fields('Packages','costId|operation|remainingCostUsd|remainingHours|startDate|endDate|paymentMode|directCashIds|note',[0]),
 fields('Invoices','invoiceId|operation|dueDate|include|note',[0]),
 fields('Grants','tranche|operation|date|include|note',[0]),
 fields('Customers','id|operation|title|caseRef|sourceUrl|sourceIds|stage|selected|pricingMode|priceUsd|totalDeliveryCostUsd|remainingHours|startDate|endDate|paymentMode|cashIds|invoiceIds|directCashIds|scope|note',[0]),
 fields('Receipts','projectId|id|operation|label|amountUsd|amountNative|date',[0,1]),
 fields('Timing','projectId|operation|mode|startCondition|deliveryBusinessDays|reviewedReleaseDate',[0]),
 fields('Conditions','projectId|receiptId|operation|condition',[0,1]),
 fields('Native amounts','projectId|component|amount|currency|fxRateId',[0,1]),
 fields('Price credits','projectId|cashId|operation|amount|note',[0,1]),
 fields('Cost credits','projectId|kind|id|operation|amount|note',[0,1,2]),
 fields('Rates','id|operation|baseCurrency|quoteCurrency|rate|observationDate|publicationDate|basis|rounding|sourceUrl|sourceIds|sourceReference|note',[0]),
 fields('Original','part|json',[0]),
];
const SCALARS=['name','asOfDate','calendarStart','note','openingCash.amountUsd','openingCash.basis','openingCash.sourceIds','openingCash.note','capacity.weeklyHours','capacity.note'];
const pathGet=(v,p)=>p.split('.').reduce((a,k)=>a&&own(a,k)?a[k]:undefined,v);
function pathSet(v,p,x){const ps=p.split('.'),last=ps.pop();let at=v;for(const k of ps)at=at[k]??=( {} );if(x===undefined)delete at[last];else at[last]=x;}
const listText=v=>JSON.stringify(v||[]);
function bool(v,label){need(v==='true'||v==='false',label+': enter true or false explicitly.');return v==='true';}
function nullable(v,before){return v===''?(before===''?'':before===undefined?undefined:null):v;}
function references(v,label){let x;try{x=JSON.parse(v);}catch{throw Error(label+': retain an exact JSON array of original IDs.');}need(Array.isArray(x)&&x.every(id=>typeof id==='string'&&id.length>0)&&new Set(x).size===x.length,label+': original IDs must be distinct.');return x;}
function action(v,label){need(v==='UPSERT'||v==='REMOVE',label+': select UPSERT or REMOVE.');return v;}
function unique(rows,key,label){const keys=rows.map(row=>signature(key.map(i=>row[i])));need(new Set(keys).size===keys.length,label+': each original identity must appear only once.');}
function originalParts(origin){const s=json(origin),rows=[];for(let at=0,n=1;at<s.length;n++){let end=Math.min(s.length,at+16000);if(end<s.length&&/[\uD800-\uDBFF]/.test(s[end-1]))end--;rows.push([String(n),s.slice(at,end)]);at=end;}return rows;}
function scalarRow(inputs,field){const v=pathGet(inputs,field);return[field,v===undefined?'MISSING':v===null?'NULL':'VALUE',v===undefined||v===null?'':Array.isArray(v)?JSON.stringify(v):String(v)];}
function tablesFor(inputs,origin){
 const out={Forecast:SCALARS.map(p=>scalarRow(inputs,p)),Packages:[],Invoices:[],Grants:[],Customers:[],Receipts:[],Timing:[],Conditions:[],'Native amounts':[],'Price credits':[],'Cost credits':[],Rates:[],Original:originalParts(origin)};
 for(const r of inputs.packageOverrides)out.Packages.push([r.costId,'UPSERT',text(r.remainingCostUsd),text(r.remainingHours),text(r.startDate),text(r.endDate),r.paymentMode,listText(r.directCashIds),r.note]);
 for(const r of inputs.invoiceOverrides)out.Invoices.push([r.invoiceId,'UPSERT',text(r.dueDate),String(r.include),r.note]);
 for(const r of inputs.grantReceipts)out.Grants.push([String(r.tranche),'UPSERT',text(r.date),String(r.include),r.note]);
 for(const r of inputs.commercial){
  const native=own(r,'nativePricing');
  out.Customers.push([r.id,'UPSERT',r.title,r.caseRef,r.sourceUrl,listText(r.sourceIds),r.stage,String(r.selected),native?'NATIVE':'USD',text(r.priceUsd),text(r.totalDeliveryCostUsd),text(r.remainingHours),text(r.startDate),text(r.endDate),r.paymentMode,listText(r.cashIds),listText(r.invoiceIds),listText(r.directCashIds),r.scope,r.note]);
  for(const q of r.receipts||[])out.Receipts.push([r.id,q.id,'UPSERT',q.label,text(q.amountUsd),text(q.amountNative),text(q.date)]);
  if(r.timing){const t=r.timing;out.Timing.push([r.id,'UPSERT',t.mode,t.startCondition,String(t.deliveryBusinessDays),text(t.reviewedReleaseDate)]);for(const q of t.receiptConditions)out.Conditions.push([r.id,q.receiptId,'UPSERT',q.condition]);}
  if(native){for(const key of ['price','deliveryCost']){const a=r.nativePricing[key];out['Native amounts'].push([r.id,key,text(a.amount),a.currency,text(a.fxRateId)]);}for(const q of r.nativePricing.priceCredits)out['Price credits'].push([r.id,q.cashId,'UPSERT',q.amount,q.note]);for(const q of r.nativePricing.costCredits)out['Cost credits'].push([r.id,q.kind,q.id,'UPSERT',q.amount,q.note]);}
 }
 for(const r of inputs.fxRates||[])out.Rates.push([r.id,'UPSERT',r.baseCurrency,r.quoteCurrency,r.rate,r.observationDate,text(r.publicationDate),r.basis,r.rounding,r.sourceUrl,listText(r.sourceIds),r.sourceReference,r.note]);
 return FORECAST_WORKBOOK_SHEETS.map(s=>({...copy(s),rows:out[s.name].map(r=>r.map(text))}));
}
export async function forecastWorkbookTables(inputs,options={}){
 inputs=verifyInputs(inputs);optionsValid(options);
 const origin={schema:FORECAST_WORKBOOK_SCHEMA,caseId:options.caseId,planContentSha256:options.planContentSha256,createdAt:options.createdAt||new Date().toISOString(),inputs,inputsSha256:await sha256(signature(inputs))};
 need(typeof origin.createdAt==='string'&&Number.isFinite(Date.parse(origin.createdAt)),'Retain the original preparation time.');
 return{origin,tables:tablesFor(inputs,origin)};
}
function tableMap(tables){need(Array.isArray(tables),'Retain all complete forecast worksheets.');const m=new Map;for(const spec of FORECAST_WORKBOOK_SHEETS){const found=tables.filter(t=>t.name===spec.name);need(found.length===1&&equal(found[0].headers,spec.headers)&&Array.isArray(found[0].rows),'Retain exact '+spec.name+' headings and worksheet.');const rows=found[0].rows;need(rows.length<=5000&&rows.every(r=>Array.isArray(r)&&r.length===spec.headers.length&&r.every(x=>typeof x==='string')),'Retain every complete '+spec.name+' row and cell.');unique(rows,spec.key,spec.name);m.set(spec.name,rows);}need(tables.length===FORECAST_WORKBOOK_SHEETS.length,'Retain only the supported complete worksheets.');return m;}
function upsert(list,id,match,next,remove,label){const at=list.findIndex(match);if(remove){need(at>=0,label+': REMOVE must name an existing original row.');list.splice(at,1);}else if(at>=0)list[at]=next;else list.push(next);}
const emptyCustomer=id=>({id,title:'',caseRef:'',sourceUrl:'',sourceIds:[],stage:'QUOTED',selected:true,priceUsd:'',totalDeliveryCostUsd:'',remainingHours:'',startDate:null,endDate:null,paymentMode:'accrual',receipts:[],cashIds:[],invoiceIds:[],directCashIds:[],scope:'',note:''});
export async function receiveForecastWorkbookTables(tables,options={}){
 optionsValid(options);const sheets=tableMap(tables),parts=sheets.get('Original');
 need(parts.length>0&&parts.every((r,i)=>r[0]===String(i+1)),'Retain the complete ordered Original worksheet.');
 let origin;try{origin=JSON.parse(parts.map(r=>r[1]).join(''));}catch{throw Error('The Original worksheet must retain its complete source JSON.');}
 need(origin?.schema===FORECAST_WORKBOOK_SCHEMA&&Object.keys(origin).every(k=>['schema','caseId','planContentSha256','createdAt','inputs','inputsSha256'].includes(k)),'Choose the original complete Forecast preparation workbook.');safe(origin);need(typeof origin.createdAt==='string'&&Number.isFinite(Date.parse(origin.createdAt)),'Retain the exact original preparation time.');
 const base=verifyInputs(origin.inputs);
 need(HASH.test(origin.inputsSha256||'')&&await sha256(signature(base))===origin.inputsSha256,'The retained original inputs differ from their source identity.');
 need([options.caseId,options.originCaseId].filter(Boolean).includes(origin.caseId)&&origin.planContentSha256===options.planContentSha256,'This workbook belongs to another original case or selected plan content.');
 const next=copy(base),scalars=sheets.get('Forecast');
 need(scalars.length===SCALARS.length&&scalars.every(r=>SCALARS.includes(r[0])),'Retain each original Forecast field once.');
 for(const [p,state,value]of scalars){need(['MISSING','NULL','VALUE'].includes(state),'Forecast value state must be MISSING, NULL or VALUE.');need(state==='VALUE'||value==='','A missing or null field must have an empty value cell.');let v=state==='MISSING'?undefined:state==='NULL'?null:p==='openingCash.sourceIds'?references(value,p):value;pathSet(next,p,v);}
 for(const r of sheets.get('Packages')){const[id,op,cost,hours,start,end,mode,ids,note]=r;need(stable(id),'Use the original package identity.');if(action(op,'Package')==='REMOVE'){upsert(next.packageOverrides,id,x=>x.costId===id,null,true,'Package');continue;}const old=next.packageOverrides.find(x=>x.costId===id)||{};upsert(next.packageOverrides,id,x=>x.costId===id,{...old,costId:id,remainingCostUsd:nullable(cost,old.remainingCostUsd),remainingHours:nullable(hours,old.remainingHours),startDate:nullable(start,old.startDate),endDate:nullable(end,old.endDate),paymentMode:mode,directCashIds:references(ids,'Package cash'),note},action(op,'Package')==='REMOVE','Package');}
 for(const r of sheets.get('Invoices')){const[id,op,date,include,note]=r;need(typeof id==='string'&&id.length>0,'Use the original invoice identity.');if(action(op,'Invoice')==='REMOVE'){upsert(next.invoiceOverrides,id,x=>x.invoiceId===id,null,true,'Invoice');continue;}const old=next.invoiceOverrides.find(x=>x.invoiceId===id)||{};upsert(next.invoiceOverrides,id,x=>x.invoiceId===id,{...old,invoiceId:id,dueDate:nullable(date,old.dueDate),include:bool(include,'Invoice include'),note},action(op,'Invoice')==='REMOVE','Invoice');}
 for(const r of sheets.get('Grants')){const[id,op,date,include,note]=r;need(/^[0-3]$/.test(id),'Grant tranche must be the original 0, 1, 2 or 3.');const tranche=Number(id);if(action(op,'Grant')==='REMOVE'){upsert(next.grantReceipts,id,x=>x.tranche===tranche,null,true,'Grant');continue;}const old=next.grantReceipts.find(x=>x.tranche===tranche)||{};upsert(next.grantReceipts,id,x=>x.tranche===tranche,{...old,tranche,date:nullable(date,old.date),include:bool(include,'Grant include'),note},action(op,'Grant')==='REMOVE','Grant');}
 const removed=new Set;
 for(const r of sheets.get('Customers')){const[id,op,title,caseRef,sourceUrl,sourceIds,stage,selected,pricingMode,price,cost,hours,start,end,paymentMode,cashIds,invoiceIds,directCashIds,scope,note]=r;need(stable(id),'Use a stable customer scenario identity.');if(action(op,'Customer')==='REMOVE'){need(next.commercial.some(x=>x.id===id),'Remove an existing original customer scenario.');next.commercial=next.commercial.filter(x=>x.id!==id);if(next.customerFunding)next.customerFunding.opening=next.customerFunding.opening.filter(x=>x.commercialId!==id);removed.add(id);continue;}
  const old=next.commercial.find(x=>x.id===id)||emptyCustomer(id),v={...old,id,title,caseRef,sourceUrl,sourceIds:references(sourceIds,'Customer sources'),stage,selected:bool(selected,'Customer selected'),remainingHours:nullable(hours,old.remainingHours),startDate:nullable(start,old.startDate),endDate:nullable(end,old.endDate),paymentMode,cashIds:references(cashIds,'Customer receipts'),invoiceIds:references(invoiceIds,'Customer invoices'),directCashIds:references(directCashIds,'Customer direct expenses'),scope,note};
  need(['USD','NATIVE'].includes(pricingMode),'Choose original USD or NATIVE pricing explicitly.');
  if(pricingMode==='NATIVE'){need(price===''&&cost==='','Native pricing retains its native amounts; leave both USD price cells empty.');delete v.priceUsd;delete v.totalDeliveryCostUsd;v.nativePricing=copy(old.nativePricing||{price:{amount:'',currency:'',fxRateId:null},deliveryCost:{amount:'',currency:'',fxRateId:null},priceCredits:[],costCredits:[]});}
  else{delete v.nativePricing;v.priceUsd=price;v.totalDeliveryCostUsd=cost;}
  upsert(next.commercial,id,x=>x.id===id,v,false,'Customer');
 }
 const originalTables=new Map(tablesFor(base,origin).map(t=>[t.name,t]));
 const unchangedIrrelevant=(sheet,row)=>{const t=originalTables.get(sheet),spec=FORECAST_WORKBOOK_SHEETS.find(x=>x.name===sheet),prior=t.rows.find(r=>spec.key.every(i=>r[i]===row[i]));need(prior&&equal(prior,row),'This customer is using USD pricing. Remove newly added or changed '+sheet+' rows, or select NATIVE pricing before applying them.');};
 const project=id=>{const p=next.commercial.find(x=>x.id===id);need(p,'Select an existing customer in Customers before its related rows.');return p;};
 for(const r of sheets.get('Receipts')){const[pid,id,op,label,usd,native,date]=r;if(removed.has(pid))continue;const p=project(pid);need(stable(id),'Use a stable receipt milestone identity.');if(action(op,'Receipt')==='REMOVE'){upsert(p.receipts,id,x=>x.id===id,null,true,'Receipt');continue;}const old=p.receipts.find(x=>x.id===id)||{},key=p.nativePricing?'amountNative':'amountUsd';need((p.nativePricing?usd:native)==='','Keep only the amount for this customer pricing mode.');const v={...old,id,label,[key]:p.nativePricing?native:usd,date:nullable(date,old.date)};delete v[p.nativePricing?'amountUsd':'amountNative'];upsert(p.receipts,id,x=>x.id===id,v,action(op,'Receipt')==='REMOVE','Receipt');}
 const removedTiming=new Set;
 for(const [pid,op,mode,startCondition,days,release]of sheets.get('Timing')){if(removed.has(pid))continue;const p=project(pid);if(action(op,'Timing')==='REMOVE'){need(p.timing,'Remove an existing event-dependent timing selection.');delete p.timing;removedTiming.add(pid);continue;}need(mode==='EVENT_DEPENDENT'&&/^[1-9]\d*$/.test(days)&&Number.isSafeInteger(Number(days)),'Retain EVENT_DEPENDENT and a whole quoted working-day count.');p.timing={...(p.timing||{}),mode,startCondition,deliveryBusinessDays:Number(days),reviewedReleaseDate:nullable(release,p.timing?.reviewedReleaseDate),receiptConditions:p.timing?.receiptConditions||[]};}
 for(const [pid,id,op,condition]of sheets.get('Conditions')){if(removed.has(pid)||removedTiming.has(pid))continue;const p=project(pid);need(p.timing,'Select event-dependent timing before collection conditions.');upsert(p.timing.receiptConditions,id,x=>x.receiptId===id,{receiptId:id,condition},action(op,'Condition')==='REMOVE','Condition');}
 for(const [pid,component,amount,currency,fxRateId]of sheets.get('Native amounts')){if(removed.has(pid))continue;const p=project(pid);if(!p.nativePricing){unchangedIrrelevant('Native amounts',[pid,component,amount,currency,fxRateId]);continue;}need(['price','deliveryCost'].includes(component),'Use price or deliveryCost for native money.');p.nativePricing[component]={amount,currency,fxRateId:nullable(fxRateId,p.nativePricing[component]?.fxRateId)};}
 for(const [pid,cashId,op,amount,note]of sheets.get('Price credits')){if(removed.has(pid))continue;const p=project(pid);if(!p.nativePricing){if(op!=='REMOVE')unchangedIrrelevant('Price credits',[pid,cashId,op,amount,note]);continue;}upsert(p.nativePricing.priceCredits,cashId,x=>x.cashId===cashId,{cashId,amount,note},action(op,'Price credit')==='REMOVE','Price credit');}
 for(const [pid,kind,id,op,amount,note]of sheets.get('Cost credits')){if(removed.has(pid))continue;const p=project(pid);if(!p.nativePricing){if(op!=='REMOVE')unchangedIrrelevant('Cost credits',[pid,kind,id,op,amount,note]);continue;}need(['INVOICE','DIRECT_CASH'].includes(kind),'Keep each original cost-credit kind.');upsert(p.nativePricing.costCredits,id,x=>x.kind===kind&&x.id===id,{kind,id,amount,note},action(op,'Cost credit')==='REMOVE','Cost credit');}
 const rates=sheets.get('Rates');if(rates.length||own(base,'fxRates')||next.commercial.some(x=>x.nativePricing))next.fxRates||=[];
 for(const r of rates){const[id,op,baseCurrency,quoteCurrency,rate,observationDate,publicationDate,basis,rounding,sourceUrl,sourceIds,sourceReference,note]=r;need(stable(id),'Use a stable original exchange-rate identity.');if(action(op,'Exchange rate')==='REMOVE'){upsert(next.fxRates,id,x=>x.id===id,null,true,'Exchange rate');continue;}const old=next.fxRates.find(x=>x.id===id)||{};upsert(next.fxRates,id,x=>x.id===id,{...old,id,baseCurrency,quoteCurrency,rate,observationDate,publicationDate:nullable(publicationDate,old.publicationDate),basis,rounding,sourceUrl,sourceIds:references(sourceIds,'Rate sources'),sourceReference,note},action(op,'Exchange rate')==='REMOVE','Exchange rate');}
 const returnedInputs=verifyInputs(copy(next));
 return{schema:FORECAST_WORKBOOK_RETURN_SCHEMA,origin:copy(origin),baseInputs:base,returnedInputs,tables:copy(tables)};
}
const MISSING=Symbol('missing');
const view=v=>v===MISSING?{present:false}:{present:true,value:copy(v)};
const same=(a,b)=>a===MISSING||b===MISSING?a===b:equal(a,b);
const pointer=p=>'/'+p.map(k=>String(k).replace(/~/g,'~0').replace(/\//g,'~1')).join('/');
function keyFields(parts){const k=parts.at(-1);return k==='opening'&&parts.at(-2)==='customerFunding'?['commercialId']:k==='packageOverrides'?['costId']:k==='invoiceOverrides'?['invoiceId']:k==='grantReceipts'?['tranche']:k==='priceCredits'?['cashId']:k==='costCredits'?['kind','id']:k==='receiptConditions'?['receiptId']:['commercial','receipts','fxRates'].includes(k)?['id']:null;}
export function reconcileForecastWorkbook(received,currentInputs,choices={}){
 need(received?.schema===FORECAST_WORKBOOK_RETURN_SCHEMA&&plain(choices),'Receive the complete forecast workbook first.');
 const base=verifyInputs(received.baseInputs),returned=verifyInputs(received.returnedInputs),current=verifyInputs(currentInputs),changes=[],conflicts=[],used=new Set;
 // A customer removal and its dependent attribution are one reviewed decision.
 // Preserve the attribution during field merge; prune only after the resolved customer result.
 const mergeReturned=copy(returned),mergeCurrent=copy(current),removedCustomers=new Set(base.commercial.filter(row=>!returned.commercial.some(x=>x.id===row.id)).map(row=>row.id));
 if(base.customerFunding&&mergeReturned.customerFunding){
  for(const row of base.customerFunding.opening)if(removedCustomers.has(row.commercialId)&&!mergeReturned.customerFunding.opening.some(x=>x.commercialId===row.commercialId))mergeReturned.customerFunding.opening.push(copy(row));
 }
 if(base.customerFunding&&mergeCurrent.customerFunding){
  for(const row of base.customerFunding.opening)if(!current.commercial.some(x=>x.id===row.commercialId)&&!mergeCurrent.customerFunding.opening.some(x=>x.commercialId===row.commercialId))mergeCurrent.customerFunding.opening.push(copy(row));
 }
 const fundingAt=(inputs,id)=>inputs.customerFunding?.opening.find(row=>row.commercialId===id)??MISSING;
 function merge(a,b,c,p){
  if(same(a,b))return c===MISSING?MISSING:copy(c);
  if([a,b,c].every(plain)){const out={};for(const k of new Set([...Object.keys(c),...Object.keys(b),...Object.keys(a)])){const v=merge(own(a,k)?a[k]:MISSING,own(b,k)?b[k]:MISSING,own(c,k)?c[k]:MISSING,[...p,k]);if(v!==MISSING)out[k]=v;}return out;}
  const keys=keyFields(p);
  if(keys&&[a,b,c].every(Array.isArray)){
   const k=r=>signature(keys.map(x=>r[x]));for(const rows of[a,b,c])need(rows.every(plain)&&new Set(rows.map(k)).size===rows.length,'Retain unique original '+p.at(-1)+' identities.');
   const maps=[a,b,c].map(rows=>new Map(rows.map(r=>[k(r),r]))),out=[];
   for(const id of new Set([...c.map(k),...b.map(k),...a.map(k)])){const v=merge(...maps.map(m=>m.has(id)?m.get(id):MISSING),[...p,'@'+id]);if(v!==MISSING)out.push(v);}return out;
  }
  const path=pointer(p);
  const dependentChanged=p.length===2&&p[0]==='commercial'&&b===MISSING&&plain(a)&&plain(c)&&!same(fundingAt(base,a.id),fundingAt(current,a.id));
  if(!dependentChanged&&(same(c,a)||same(c,b))){if(!same(c,b))changes.push({path,before:view(c),after:view(b)});return b===MISSING?MISSING:copy(b);}
  const choice=choices[path];need(choice===undefined||choice==='current'||choice==='returned','Choose current or returned for each actual conflict.');
  conflicts.push({path,original:view(dependentChanged?{...a,relatedCustomerFunding:view(fundingAt(base,a.id))}:a),current:view(dependentChanged?{...c,relatedCustomerFunding:view(fundingAt(current,a.id))}:c),returned:view(b),choice:choice||null});
  if(choice)used.add(path);if(choice==='returned'){changes.push({path,before:view(c),after:view(b),resolved:true});return b===MISSING?MISSING:copy(b);}return c===MISSING?MISSING:copy(c);
 }
 const inputs=verifyInputs(merge(base,mergeReturned,mergeCurrent,[]));
 if(inputs.customerFunding){
  const kept=new Set(inputs.commercial.map(row=>row.id));
  inputs.customerFunding.opening=inputs.customerFunding.opening.filter(row=>{
   if(kept.has(row.commercialId))return true;
   changes.push({path:'/customerFunding/opening/@'+row.commercialId,before:view(row),after:view(MISSING),dependentCustomerRemoval:true});return false;
  });
 }
 for(const k of Object.keys(choices))need(used.has(k),'A saved conflict choice no longer matches this complete current draft.');
 return{inputs,changes,conflicts,unresolved:conflicts.filter(x=>!x.choice).length,currentSignature:signature(current),returnedSignature:signature(returned)};
}

const XML='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const MAIN='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_REL='http://schemas.openxmlformats.org/package/2006/relationships';
const xml=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
function column(value){let out='';for(;value>0;value=Math.floor((value-1)/26))out=String.fromCharCode(65+(value-1)%26)+out;return out;}
function excelText(value){
  return text(value).replace(/_x([0-9a-fA-F]{4})_/g,'_x005F_x$1_')
    .replace(/[\u0000-\u0008\u000B-\u001F\uFFFE\uFFFF]/g,c=>'_x'+c.charCodeAt(0).toString(16).padStart(4,'0')+'_');
}
function cell(ref,value,style=0){
  need(text(value).length<=32767,'An original value exceeds one Excel text cell. Keep the complete JSON recovery for that value.');
  return '<c r="'+ref+'" s="'+style+'" t="inlineStr"><is><t xml:space="preserve">'+xml(excelText(value))+'</t></is></c>';
}
function worksheet(headers,rows,{filter=true}={}){
  const all=[headers,...(rows.length?rows:[headers.map(()=>'')])],end=column(headers.length)+all.length;
  const data=all.map((row,index)=>'<row r="'+(index+1)+'">'+headers.map((_,col)=>cell(column(col+1)+(index+1),row[col]??'',index===0?1:0)).join('')+'</row>').join('');
  return XML+'<worksheet xmlns="'+MAIN+'"><dimension ref="A1:'+end+'"/><sheetViews><sheetView workbookViewId="0">'+
    '<pane xSplit="1" ySplit="1" topLeftCell="B2" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>'+
    '<sheetFormatPr defaultRowHeight="15"/><cols>'+headers.map((name,i)=>'<col min="'+(i+1)+'" max="'+(i+1)+'" width="'+
      (/notes|Note|Reference|population|output|quality|value|conclusion|Reason/.test(name)?60:27)+'" customWidth="1"/>').join('')+
    '</cols><sheetData>'+data+'</sheetData>'+(filter?'<autoFilter ref="A1:'+column(headers.length)+Math.max(1,rows.length+1)+'"/>':'')+
    '<pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>'+
    '<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>';
}
const STYLE=XML+'<styleSheet xmlns="'+MAIN+'"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>'+
  '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill>'+
  '<fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEAEAEA"/><bgColor indexed="64"/></patternFill></fill></fills>'+
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'+
  '<cellXfs count="2"><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>'+
  '<xf numFmtId="49" fontId="1" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFill="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs>'+
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

export function forecastWorkbookGuide(origin){
 return '# Forecast preparation workbook\n\nOriginal case: '+origin.caseId+'\n\n'+
 'Edit forecast-assumptions.xlsx or complete sheet CSVs. Retain original-forecast.json and the hidden Original sheet. All cells are literal text: blank money is unknown; 0 is entered zero. Dates remain YYYY-MM-DD. Explicit true and false preserve selections. Keep original IDs. Omission retains an original row; REMOVE explicitly removes its assumption override or customer scenario. Native cash, invoices, costs and grants remain unchanged.\n\n'+
 'Forecast retains name, dates, opening cash, capacity and notes. MISSING/NULL/VALUE distinguish absent, null and entered values. Packages adjusts remaining package cost/hours/dates. Invoices and Grants adjust expected timing and inclusion. Customers and Receipts prepare customer scenarios and milestones. Timing and Conditions retain event-dependent release and collection. Native amounts, Price credits, Cost credits and Rates preserve explicit currency valuations and original selected actual payments. References are exact JSON arrays of IDs already in the case.\n\n'+
 'Receive the complete XLSX through the maintained native reader, or choose original-forecast.json and one or more returned CSV/TSV sheets with explicit column mapping. Review all changes against the CURRENT Forecast draft. Independently changed fields remain. Resolve each conflicting field explicitly as current or returned. Apply retains the complete original return as a case source and runs the original native preview. Then use the original Forecast save to create its next immutable saved edition. No payment, invoice, purchase or actual cash entry is created by this preparation.\n\n'+
 'Keep native and USD price modes explicit. Native price and deliveryCost each require amount, currency and the selected exchange-rate ID where applicable. When changing modes, update the receipt amount columns as well; native validation owns currency, amount, date and source rules. Event-dependent timing remains provisional until its original release is reviewed. Omitted values never become zero.\n\n'+
 'Download the complete working file before handing off unfinished work. It retains original inputs, full returned bytes and sheet projections, conflict choices, note and the same pending source/save request. After native save, the original full case export carries the source and all saved forecasts. Reviewed XLSX formulas must be pasted as literal values; formulas are rejected on receive.\n';
}
export async function createForecastWorkbook(inputs,options={}){
 const result=await forecastWorkbookTables(inputs,options),guide=forecastWorkbookGuide(result.origin);
 const tables=[...result.tables,{name:'Read me',headers:['Item','Detail'],rows:[
 ['Original case',result.origin.caseId],['Selected plan',result.origin.planContentSha256],['Original input SHA-256',result.origin.inputsSha256],
 ['Values','Literal text. Blank is unknown; 0 is entered zero. true/false are explicit.'],
 ['Original IDs','Keep stable IDs; omitted rows remain. REMOVE is explicit.'],
 ['Currencies','Keep USD or NATIVE price mode and matching receipt fields. Original native preview validates exact values.'],
 ['Source','Keep Original unchanged. Receive complete XLSX or original JSON plus mapped CSV sheets.'],
 ['Review','Resolve current/returned conflicts, retain original source, preview, then save through the original Forecast controls.']]}];
 const parts=tables.map((t,i)=>({path:'xl/worksheets/sheet'+(i+1)+'.xml',content:worksheet(t.headers,t.rows,{filter:!['Original','Read me'].includes(t.name)})}));
 parts.unshift({path:'[Content_Types].xml',content:XML+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'+tables.map((_,i)=>'<Override PartName="/xl/worksheets/sheet'+(i+1)+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('')+'</Types>'},
 {path:'_rels/.rels',content:XML+'<Relationships xmlns="'+PACKAGE_REL+'"><Relationship Id="workbook" Type="'+REL+'/officeDocument" Target="xl/workbook.xml"/></Relationships>'},
 {path:'xl/workbook.xml',content:XML+'<workbook xmlns="'+MAIN+'" xmlns:r="'+REL+'"><workbookPr date1904="0"/><bookViews><workbookView activeTab="0"/></bookViews><sheets>'+tables.map((t,i)=>'<sheet name="'+xml(t.name)+'" sheetId="'+(i+1)+'"'+(t.name==='Original'?' state="hidden"':'')+' r:id="rId'+(i+1)+'"/>').join('')+'</sheets></workbook>'},
 {path:'xl/_rels/workbook.xml.rels',content:XML+'<Relationships xmlns="'+PACKAGE_REL+'">'+tables.map((_,i)=>'<Relationship Id="rId'+(i+1)+'" Type="'+REL+'/worksheet" Target="worksheets/sheet'+(i+1)+'.xml"/>').join('')+'<Relationship Id="styles" Type="'+REL+'/styles" Target="styles.xml"/></Relationships>'},
 {path:'xl/styles.xml',content:STYLE});
 const data=zipWorkspace(parts);need(data.length<=MAX_FORECAST_WORKBOOK_BYTES,'The complete XLSX exceeds the original case source allowance.');
 const workbook={filename:'forecast-assumptions.xlsx',data,bytes:data.length,sha256:await sha256(data)};
 const files=[{path:workbook.filename,content:data},{path:'original-forecast.json',content:json(result.origin)},{path:'README.md',content:guide},
 ...result.tables.filter(t=>t.name!=='Original').map(t=>({path:'csv/'+t.name.replace(/ /g,'-')+'.csv',content:forecastSheetCsv(t)}))];
 return{schema:FORECAST_WORKBOOK_SCHEMA,...result,workbook,guide,files,kit:{filename:'forecast-preparation.zip',data:zipWorkspace(files)}};
}
export function forecastSheetCsv(table){return '\uFEFF'+[table.headers,...table.rows].map(row=>row.map(v=>'"'+text(v).replace(/"/g,'""')+'"').join(',')).join('\r\n')+'\r\n';}
function sourceRange(metadata,width){
 const m=/^([A-Z]+)([1-9]\d*)(?::([A-Z]+)([1-9]\d*))?$/.exec(metadata?.observedRange||'');
 need(m&&m[1]==='A'&&m[2]==='1'&&(m[3]||m[1])===column(width),'Keep the complete original worksheet columns beginning at A1.');
 return 'A1:'+column(width)+Math.max(2,Number(m[4]||m[2]));
}
function sheetMapping(spec,range){return{schema:'stellar-forge.planning-workbook-mapping.v1',plan:{
 name:'Forecast assumptions '+spec.name,notes:'Complete exact literal assumptions; original workbook and full selected cells retained.',
 sheet:spec.name,range,headerRow:1,hiddenRows:'include',blankRows:'skip',mergedCells:'reject',
 columns:spec.headers.map((name,index)=>({name,source:column(index+1),blank:'empty',formula:'reject',error:'reject',date:'raw',trim:false,valueMap:[]}))},
 numericText:Object.fromEntries(spec.headers.map(name=>[name,['amount','amountUsd','amountNative','priceUsd','totalDeliveryCostUsd','remainingCostUsd','remainingHours','rate'].includes(name)?'decimal':'source']))};}
function receivedTime(value){need(typeof value==='string'&&Number.isFinite(Date.parse(value)),'Retain the actual complete source receiving time.');return value;}
function returnLimit(value){need(utf8(json(value)).length<=MAX_WORKBOOK_PROJECT_BYTES,'The full source and selected cells exceed the original 32 MiB recovery allowance.');return value;}
export async function receiveForecastWorkbook(upload,options={}){
 need(typeof options.inspectWorkbook==='function'&&typeof options.projectWorkbook==='function','Use the maintained native workbook reader.');
 need(upload?.bytes>0&&upload.bytes<=MAX_FORECAST_WORKBOOK_BYTES,'Choose a complete workbook within the original 8 MiB source allowance.');
 let source=upload;const tables=[],projections=[];
 for(const spec of FORECAST_WORKBOOK_SHEETS){
  const inspected=await options.inspectWorkbook({source,preview:{sheet:spec.name,offset:0,limit:1}});
  await validateWorkbookSource(inspected.source);source=inspected.source;
  const header=inspected.preview.rows[0]?.cells;
  need(Array.isArray(header)&&header.length===spec.headers.length&&header.every((v,i)=>text(v.value)===spec.headers[i]&&!v.formula),'Retain exact '+spec.name+' headings.');
  const selected=sheetMapping(spec,sourceRange(inspected.preview.metadata,spec.headers.length));
  const projected=await options.projectWorkbook({source,mapping:selected});
  await validateWorkbookSource(projected.source);source=projected.source;
  const body=await validateWorkbookProjection(projected.projection,source);
  tables.push({name:spec.name,headers:[...spec.headers],rows:body.rows.map(row=>row.cells.map(cell=>cell.output))});
  projections.push({sheet:spec.name,projection:copy(projected.projection)});
 }
 const received=await receiveForecastWorkbookTables(tables,options);
 return returnLimit({...received,transport:'xlsx',source:{...copy(source),mediaType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'},projections,
 receivedAt:receivedTime(options.receivedAt||new Date().toISOString())});
}
function decodeUtf8(bytes){
 const value=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
 need(equal(Array.from(utf8(value)),Array.from(bytes)),'Keep complete valid UTF-8 source bytes, including their original BOM.');return value;
}
export function inspectForecastCsv(source,{delimiter=','}={}){
 const raw=decodeWorkbookBytes(source.dataBase64),parsed=parseTable(decodeUtf8(raw),{delimiter,header:true,skipEmptyRecords:false});
 return{headings:parsed.headings,rows:parsed.rows.map(r=>[...r.cells]),delimiter:parsed.delimiter};
}
async function validateRaw(source){
 need(plain(source)&&typeof source.filename==='string'&&source.filename.length>0&&source.filename.length<=500&&!/[\\/]/.test(source.filename),'Keep the original source filename.');
 const bytes=decodeWorkbookBytes(source.dataBase64);
 need(bytes.length>0&&bytes.length<=MAX_FORECAST_WORKBOOK_BYTES&&bytes.length===source.bytes&&await sha256(bytes)===source.sha256,'The full original source bytes or identity differ.');
 return bytes;
}
export async function receiveForecastCsv(baseline,materials,options={}){
 const original=await validateRaw(baseline);let origin;
 try{origin=JSON.parse(decodeUtf8(original).replace(/^\uFEFF/,''));}catch{throw Error('Choose the complete original-forecast.json exported with these sheets.');}
 need(origin?.schema===FORECAST_WORKBOOK_SCHEMA,'Use the original exported Forecast JSON.');
 const base=verifyInputs(origin.inputs),tables=tablesFor(base,origin),seen=new Set;
 need(Array.isArray(materials)&&materials.length>0&&materials.length<FORECAST_WORKBOOK_SHEETS.length,'Select one or more complete returned assumption sheets.');
 for(const item of materials){
  const spec=FORECAST_WORKBOOK_SHEETS.find(s=>s.name===item.sheet&&s.name!=='Original');
  need(spec&&!seen.has(spec.name),'Select each returned sheet once.');seen.add(spec.name);await validateRaw(item.source);
  const parsed=inspectForecastCsv(item.source,{delimiter:item.delimiter}),columns=item.columns;
  need(plain(columns)&&Object.keys(columns).length===spec.headers.length&&spec.headers.every(h=>Number.isInteger(columns[h])&&columns[h]>=0&&columns[h]<parsed.headings.length)&&new Set(Object.values(columns)).size===spec.headers.length,'Map every original field to one distinct returned column.');
  need(parsed.rows.length<=5000,'Keep the complete returned sheet within its record allowance.');
  tables.find(t=>t.name===spec.name).rows=parsed.rows.map(r=>spec.headers.map(h=>r[columns[h]]));
 }
 const result=await receiveForecastWorkbookTables(tables,options);
 const manifest={schema:FORECAST_WORKBOOK_SCHEMA+'.csv-source',baseline:copy(baseline),materials:copy(materials)};
 const fileBodies=[{path:'original/'+baseline.filename,content:original},
 ...materials.map((m,i)=>({path:'returned/'+String(i+1).padStart(2,'0')+'-'+m.source.filename,content:decodeWorkbookBytes(m.source.dataBase64)})),
 {path:'mapping.json',content:json(manifest)}];
 const data=zipWorkspace(fileBodies);
 need(data.length<=MAX_FORECAST_WORKBOOK_BYTES,'The complete original JSON, returned sheets and mappings exceed the 8 MiB source allowance.');
 const source={...(await workbookUpload('forecast-returned-sheets.zip',data)),mediaType:'application/zip'};
 return returnLimit({...result,transport:'csv',baseline:copy(baseline),materials:copy(materials),source,
 receivedAt:receivedTime(options.receivedAt||new Date().toISOString())});
}
export async function validateForecastWorkbookReturn(value,options={}){
 need(value?.schema===FORECAST_WORKBOOK_RETURN_SCHEMA,'Receive the complete original Forecast review.');receivedTime(value.receivedAt);
 let replay;
 if(value.transport==='csv')replay=await receiveForecastCsv(value.baseline,value.materials,{...options,receivedAt:value.receivedAt});
 else{
  need(value.transport==='xlsx'&&Array.isArray(value.projections)&&value.projections.length===FORECAST_WORKBOOK_SHEETS.length,'Retain every original selected worksheet.');
  await validateWorkbookSource(value.source);need(value.source.mediaType==='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Retain the XLSX source media type.');
  need(value.source.bytes<=MAX_FORECAST_WORKBOOK_BYTES,'Retain a complete workbook within the case source allowance.');
  const tables=[];
  for(const spec of FORECAST_WORKBOOK_SHEETS){
   const selected=value.projections.filter(r=>r.sheet===spec.name);need(selected.length===1,'Retain one complete original '+spec.name+' projection.');
   const body=await validateWorkbookProjection(selected[0].projection,value.source);
   need(body.mapping.plan.sheet===spec.name&&equal(body.mapping,sheetMapping(spec,body.mapping.plan.range)),'Retain exact original worksheet headings and literal-cell mappings.');
   tables.push({name:spec.name,headers:[...spec.headers],rows:body.rows.map(r=>r.cells.map(c=>c.output))});
  }
  replay={...copy(value),...await receiveForecastWorkbookTables(tables,options)};
 }
 need(equal(replay.baseInputs,value.baseInputs)&&equal(replay.returnedInputs,value.returnedInputs)&&equal(replay.tables,value.tables)&&equal(replay.origin,value.origin)&&equal(replay.source,value.source),'The complete retained review differs from its original source and selected cells.');
 return returnLimit(replay);
}
export {workbookUpload,decodeWorkbookBytes,encodeWorkbookBytes};

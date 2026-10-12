(function(root,factory){if(typeof module==="object"&&module.exports)module.exports=factory(require("./rules.js"));else root.NycSurveyPlan=factory(root.NycSurveyRules);})(typeof globalThis!=="undefined"?globalThis:this,function(R) {
"use strict";
if(!R||R.schema!=="nyc-survey-procurement-rules/v1")throw new Error("Original procurement rules are required.");
const SCHEMA="nyc-survey-workplan/v1";
const RATE_SCALE=1000000n, QUANTITY_SCALE=10000n, CENT_DIVISOR=100000000n;
const catalogue=new Map(R.catalog.map(r=>[r.id,r]));
const statuses=new Set(["not_started","prepared","reviewed","not_applicable"]);
const forbidden=new Set(["__proto__","constructor","prototype"]);
function clone(x){return JSON.parse(JSON.stringify(x));}
function fail(message){throw new Error(message);}
function object(x,label){if(!x||typeof x!=="object"||Array.isArray(x))fail(label+" must be an object.");for(const k of Object.keys(x))if(forbidden.has(k))fail("Unsafe object key.");return x;}
function str(x,label,max=10000){if(typeof x!=="string"||x.length>max)fail(label+" must be text of at most "+max+" characters.");return x;}
function iso(x,label){str(x,label,40);if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(x)||!Number.isFinite(Date.parse(x)))fail(label+" must be an ISO UTC timestamp.");const normalized=new Date(x).toISOString();if(normalized!==x&&normalized.replace(".000Z","Z")!==x)fail(label+" is not a valid calendar timestamp.");return x;}
function scaled(value,places,label,maxWhole=9999999999n){
  if(typeof value!=="string")fail(label+" must be a decimal string.");
  const s=value.trim();if(!s)return null;
  const rx=new RegExp("^(?:0|[1-9][0-9]*)(?:\\.([0-9]{1,"+places+"}))?$");
  if(!rx.test(s))fail(label+" must be a nonnegative decimal with at most "+places+" decimal places.");
  const pieces=s.split("."), whole=BigInt(pieces[0]);if(whole>maxWhole)fail(label+" exceeds the supported range.");
  return whole*(10n**BigInt(places))+BigInt((pieces[1]||"").padEnd(places,"0")||"0");
}
function money(cents){if(cents===null||cents===undefined)return null;const n=BigInt(cents),negative=n<0n,a=negative?-n:n;return(negative?"-":"")+(a/100n).toString()+"."+(a%100n).toString().padStart(2,"0");}
function decimal(scaledValue,places){const n=BigInt(scaledValue),scale=10n**BigInt(places);return(n/scale).toString()+"."+(n%scale).toString().padStart(places,"0");}
function centsFromRate(rate,quantity){return(rate*quantity+CENT_DIVISOR/2n)/CENT_DIVISOR;}
function csvCell(value){let s=value===null||value===undefined?"":String(value);if(/^[\s]*[=+@\t\r]/.test(s)||(/^\s*-/.test(s)&&!/^-\d+(?:\.\d+)?$/.test(s)))s="'"+s;return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;}
function csv(headers,rows){return[headers,...rows].map(row=>row.map(csvCell).join(",")).join("\r\n")+"\r\n";}
function newWorkplan({id,title="NYC survey workplan",at}){
  str(id,"Workplan id",160);if(!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id))fail("Workplan id is invalid.");iso(at,"Creation time");
  const documents={},questionnaires={};for(const d of R.documents)documents[d.id]={status:"not_started",reference:"",notes:""};
  for(const q of R.questionnaires)questionnaires[q.id]={status:"not_started",reference:"",notes:""};
  return {schema:SCHEMA,rules_version:R.version,workplan_id:id,revision:1,title:str(title,"Title",240),created_at:at,updated_at:at,
    proposer:"",rates:Object.fromEntries(R.catalog.map(r=>[r.id,{value:"",source:""}])),
    assignment:{project_ref:"",agency_due_at:"",scope:"",experience_reference:"",staff_reference:"",schedule:"",lines:[],expenses:[]},
    documents,questionnaires,portal:{d1:"",item_total:"",receipt_reference:""},
    evaluation:{experience:"",capability:"",approach:"",lowest_qualifying_price:""},notes:""};
}
function validateWorkplan(value){
  const p=clone(object(value,"Workplan"));
  if(p.schema!==SCHEMA||p.rules_version!==R.version)fail("This workplan uses a different schema or procurement edition.");
  str(p.workplan_id,"Workplan id",160);if(!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(p.workplan_id))fail("Invalid workplan identity.");
  if(!Number.isSafeInteger(p.revision)||p.revision<1)fail("Invalid workplan revision.");
  iso(p.created_at,"Creation time");iso(p.updated_at,"Update time");
  str(p.title,"Title",240);str(p.proposer,"Proposer",400);str(p.notes,"Notes",20000);
  object(p.rates,"Rate schedule");if(Object.keys(p.rates).length!==R.catalog.length)fail("The workplan must retain every original schedule item.");
  for(const [id,entry]of Object.entries(p.rates)){if(!catalogue.has(id))fail("Unknown rate item: "+id);object(entry,"Rate");str(entry.value,"Rate value",64);str(entry.source,"Rate source",4000);}
  const a=object(p.assignment,"Assignment");for(const k of ["project_ref","agency_due_at","scope","experience_reference","staff_reference","schedule"])str(a[k],"Assignment "+k,12000);
  if(a.agency_due_at)iso(a.agency_due_at,"Agency assignment deadline");
  if(!Array.isArray(a.lines)||a.lines.length>500)fail("Assignment must have at most 500 rows.");
  const ids=new Set();
  for(const line of a.lines){object(line,"Assignment row");str(line.id,"Row id",160);if(!line.id||ids.has(line.id))fail("Assignment row identities must be unique.");ids.add(line.id);
    if(!catalogue.has(line.rate_id))fail("Unknown assignment rate item: "+line.rate_id);
    for(const k of ["quantity","unit_rate","scope","language","order_ref"])str(line[k],"Assignment row "+k,k==="scope"?12000:1000);
    if(typeof line.translation_minimum!=="boolean"||typeof line.covered_by_deliverable!=="boolean")fail("Invalid assignment row options.");
  }
  if(!Array.isArray(a.expenses)||a.expenses.length>200)fail("At most 200 expense rows are supported.");
  const expenseIds=new Set();
  for(const e of a.expenses){object(e,"Expense");str(e.id,"Expense id",160);if(!e.id||expenseIds.has(e.id))fail("Expense identities must be unique.");expenseIds.add(e.id);
    for(const k of ["kind","description","amount","approval_reference","receipt_reference"])str(e[k],"Expense "+k,4000);
    if(typeof e.at_cost!=="boolean")fail("Expense cost basis must be explicit.");
  }
  for(const [key,definition]of [["documents",R.documents],["questionnaires",R.questionnaires]]){
    object(p[key],key);if(Object.keys(p[key]).length!==definition.length)fail("Original preparation items must be retained.");
    for(const d of definition){const e=object(p[key][d.id],key+" "+d.id);if(!statuses.has(e.status))fail("Unknown preparation status.");str(e.reference,"Preparation reference",4000);str(e.notes,"Preparation notes",12000);if(e.status==="not_applicable"&&(key==="documents"||d.id!=="subcontractors"))fail("This original preparation item is required.");}
  }
  object(p.portal,"Portal values");for(const k of ["d1","item_total","receipt_reference"])str(p.portal[k],"Portal "+k,4000);
  object(p.evaluation,"Evaluation");for(const k of ["experience","capability","approach","lowest_qualifying_price"])str(p.evaluation[k],"Evaluation "+k,64);
  return p;
}
function touch(p,at){const result=clone(p);iso(at,"Update time");result.revision++;result.updated_at=at;return validateWorkplan(result);}
function rateStatus(p){
  const entries=[],errors=[];let complete=0;
  for(const r of R.catalog){const e=p.rates[r.id];let rate=null,error=null;try{rate=scaled(e.value,6,r.label);}catch(err){error=err.message;errors.push({id:r.id,message:error});}
    if(rate!==null&&!error)complete++;
    entries.push({...r,value:e.value,source:e.source,scaled:rate===null?null:rate.toString(),error});
  }
  return{entries,complete,total:R.catalog.length,missing:entries.filter(e=>e.scaled===null&&!e.error).map(e=>e.id),errors,ready:complete===R.catalog.length&&errors.length===0};
}
function priceScenario(p){
  const status=rateStatus(p),rates=new Map(status.entries.map(r=>[r.id,r]));let subtotal=0n;const phases={1:0n,2:0n,3:0n},missing=[];
  const rows=R.scenario.map((line,index)=>{
    const rate=rates.get(line.rate_id),quantity=scaled(line.quantity,4,"Official quantity"),amount=rate.scaled===null?null:centsFromRate(BigInt(rate.scaled),quantity);
    if(amount===null)missing.push(rate.id);else{subtotal+=amount;phases[line.phase]+=amount;}
    return{index:index+1,rate_id:rate.id,part:rate.part,item:rate.item,label:rate.label,unit:rate.unit,quantity:line.quantity,rate:rate.value,phase:line.phase,pdf_page:line.pdf_page,total:money(amount),total_cents:amount===null?null:amount.toString(),error:rate.error};
  });
  const complete=missing.length===0&&!rows.some(r=>r.error);
  return{rows,complete,missing,subtotal:money(subtotal),total:complete?money(subtotal):null,total_cents:complete?subtotal.toString():null,phases:Object.fromEntries(Object.entries(phases).map(([k,v])=>[k,money(v)])),all_schedule_rates_complete:status.ready};
}
function priceAssignment(p){
  const errors=[],notices=[],rows=[];let service=0n,expense=0n;
  const translationOrders=new Map();
  for(const line of p.assignment.lines)if(line.rate_id==="translation"&&line.order_ref.trim()&&line.language.trim()){
    const key=JSON.stringify([line.order_ref.trim(),line.language.trim().toLowerCase()]),group=translationOrders.get(key)||{count:0,minimum:false};
    group.count++;group.minimum=group.minimum||line.translation_minimum;translationOrders.set(key,group);
  }
  for(const line of p.assignment.lines){const r=catalogue.get(line.rate_id);let ceiling=null,unitRate=null,quantity=null,total=null,billQuantity=null;const rowErrors=[];
    try{ceiling=scaled(p.rates[r.id].value,6,r.label+" ceiling");if(ceiling===null)rowErrors.push("Enter this item's schedule ceiling.");
      unitRate=line.unit_rate.trim()?scaled(line.unit_rate,6,r.label+" assignment rate"):ceiling;
      quantity=scaled(line.quantity,4,r.label+" quantity",1000000000n);
      if(quantity===null)rowErrors.push("Enter the quantity.");
      if(r.unit!=="hour"&&quantity!==null&&quantity%QUANTITY_SCALE!==0n)rowErrors.push("This unit requires a whole-number quantity.");
      if(unitRate!==null&&ceiling!==null&&unitRate>ceiling)rowErrors.push("Assignment rate exceeds the schedule ceiling.");
      billQuantity=quantity;
      if(r.id==="translation"){
        if(!line.language.trim()||!line.order_ref.trim())rowErrors.push("Identify the translation language and separate order.");
        const order=translationOrders.get(JSON.stringify([line.order_ref.trim(),line.language.trim().toLowerCase()]));
        if(order&&order.count>1&&order.minimum)rowErrors.push("Consolidate this language and order into one row before applying its translation minimum.");
        if(line.translation_minimum&&quantity!==null&&quantity>0n&&quantity<1000n*QUANTITY_SCALE)billQuantity=1000n*QUANTITY_SCALE;
      }
      if(r.part===4){if(!line.scope.trim())rowErrors.push("Describe the distinct ad hoc work.");if(line.covered_by_deliverable)rowErrors.push("Labor already included in a project deliverable cannot be added as an ad hoc charge.");}
      if(unitRate!==null&&billQuantity!==null&&rowErrors.length===0)total=centsFromRate(unitRate,billQuantity);
    }catch(err){rowErrors.push(err.message);}
    if(total!==null)service+=total;for(const message of rowErrors)errors.push({id:line.id,message});
    rows.push({id:line.id,rate_id:r.id,label:r.label,part:r.part,item:r.item,unit:r.unit,quantity:line.quantity,bill_quantity:billQuantity===null?null:decimal(billQuantity,4),rate:unitRate===null?null:decimal(unitRate,6),ceiling:p.rates[r.id].value,scope:line.scope,language:line.language,order_ref:line.order_ref,total:money(total),errors:rowErrors});
  }
  const allowed=new Set(["participant_incentive","sampling_frame","other"]);
  const expenseRows=p.assignment.expenses.map(e=>{
    const rowErrors=[];let amount=null;
    try{amount=scaled(e.amount,2,"Expense amount");if(amount===null)rowErrors.push("Enter the proposed at-cost amount.");}catch(err){rowErrors.push(err.message);}
    if(!allowed.has(e.kind))rowErrors.push("This expense category is not reimbursable under the original RFP.");
    if(!e.at_cost)rowErrors.push("Confirm that the amount is at cost, with no markup.");
    if(!e.description.trim())rowErrors.push("Describe the expense.");
    if(rowErrors.length===0&&amount!==null)expense+=amount;
    const invoiceReady=rowErrors.length===0&&!!e.approval_reference.trim()&&!!e.receipt_reference.trim();
    if(!invoiceReady&&rowErrors.length===0)notices.push({id:e.id,message:"Proposed expense: prior written approval and an original receipt are needed for reimbursement."});
    for(const message of rowErrors)errors.push({id:e.id,message});
    return{...clone(e),total:money(amount),errors:rowErrors,invoice_ready:invoiceReady};
  });
  return{rows,expense_rows:expenseRows,errors,notices,complete:errors.length===0&&rows.length>0,service_subtotal:money(service),proposed_expenses:money(expense),total:errors.length===0&&rows.length>0?money(service+expense):null,known_subtotal:money(service+expense),expense_receiving_complete:expenseRows.every(e=>e.invoice_ready)};
}
function evaluation(p,scenario){
  const errors=[],scores={};let technical=0,all=true;
  for(const c of R.evaluation.categories){const s=p.evaluation[c.id].trim();if(!s){all=false;scores[c.id]=null;continue;}if(!/^\d+(?:\.\d{1,2})?$/.test(s)||Number(s)>c.maximum){errors.push("Enter "+c.label+" between 0 and "+c.maximum+".");scores[c.id]=null;all=false;}else{scores[c.id]=Number(s);technical+=Number(s);}}
  technical=Math.round(technical*100)/100;
  let floor=null,price=null,priceReason="",qualifies=all&&errors.length===0?technical>=R.evaluation.technical_threshold_points:null;
  try{floor=scaled(p.evaluation.lowest_qualifying_price,2,"Lowest qualifying price");}catch(err){errors.push(err.message);}
  const own=scenario.total_cents===null?null:BigInt(scenario.total_cents);
  if(qualifies===false){price=0;priceReason="Below the stated technical threshold in this planning calculation.";}
  else if(own===0n){priceReason="The RFP ratio is undefined with a zero denominator; no score is assigned here.";}
  else if(own===null||floor===null){priceReason="Enter a complete scenario and the lowest qualifying price to calculate the ratio.";}
  else if(floor>own){errors.push("The lowest qualifying price cannot exceed this proposal's qualifying total.");}
  else if(qualifies===true){price=Number((floor*100000000n)/own)/10000000;priceReason="10 × lowest qualifying price / this scenario total.";}
  return{basis:"Operator-entered planning scores; agency evaluation is separate.",scores,technical:all?technical:null,threshold:63,qualifies,price,price_reason:priceReason,total:all&&price!==null?technical+price:null,errors};
}
function preparation(p,scenario,status){
  const items=[...R.documents.map(d=>({...d,kind:"document",...p.documents[d.id]})),...R.questionnaires.map(d=>({...d,kind:"questionnaire",...p.questionnaires[d.id]}))];
  const issues=[];
  for(const item of items)if(item.status==="reviewed"&&!item.reference.trim())issues.push({id:item.id,message:"Record the material reference for "+item.label+"."});
  for(const item of items)if(!["reviewed","not_applicable"].includes(item.status))issues.push({id:item.id,message:item.label+" remains "+item.status.replace(/_/g," ")+"."});
  if(!status.ready)issues.push({id:"all_rates",message:"Every Attachment C rate must be entered, including explicit zero-price items."});
  if(!scenario.complete)issues.push({id:"official_total",message:"The official scenario total is incomplete."});
  const portal={expected:scenario.total,d1:null,item_total:null,receipt_reference:p.portal.receipt_reference,recorded:false,matches:null};
  for(const key of ["d1","item_total"]){try{const value=scaled(p.portal[key],2,"PASSPort "+key);portal[key]=money(value);}catch(err){issues.push({id:key,message:err.message});}}
  if(portal.d1!==null||portal.item_total!==null){portal.recorded=true;portal.matches=portal.d1!==null&&portal.item_total!==null&&scenario.total!==null&&portal.d1===scenario.total&&portal.item_total===scenario.total;if(!portal.matches)issues.push({id:"portal_prices",message:"Recorded D1 and Item values must both equal the complete Attachment D total."});}
  return{items,issues,complete:issues.length===0,portal,submission_claim:"Preparation status only. No portal submission is performed or inferred."};
}
function inspect(value){
  const p=validateWorkplan(value),rates=rateStatus(p),scenario=priceScenario(p),assignment=priceAssignment(p);
  return{schema:"nyc-survey-workplan-report/v1",workplan_id:p.workplan_id,revision:p.revision,title:p.title,rules_version:R.version,rates,scenario,assignment,evaluation:evaluation(p,scenario),preparation:preparation(p,scenario,rates)};
}
function rateCsv(p){const s=rateStatus(p);return csv(["part","item","rate_id","description","unit","proposed_ceiling_usd","source_reference","rfp_pdf_page"],s.entries.map(r=>[r.part,r.item,r.id,r.label,r.unit,r.value,r.source,r.pdf_page]));}
function scenarioCsv(p){const s=priceScenario(p);return csv(["phase","line","rate_id","description","quantity","unit","ceiling_usd","extended_usd","rfp_pdf_page","calculation_state"],s.rows.map(r=>[r.phase,r.index,r.rate_id,r.label,r.quantity,r.unit,r.rate,r.total,r.pdf_page,r.total===null?"incomplete":"priced"]).concat([[ "", "", "",s.complete?"SCENARIO TOTAL":"KNOWN SUBTOTAL","","","",s.complete?s.total:s.subtotal,"",s.complete?"complete":"incomplete"]]));}
function assignmentCsv(p){const a=priceAssignment(p);return csv(["kind","id","rate_id","description","quantity","billed_quantity","unit","unit_rate_usd","extended_usd","scope","language","order_reference","state"],a.rows.map(r=>["service",r.id,r.rate_id,r.label,r.quantity,r.bill_quantity,r.unit,r.rate,r.total,r.scope,r.language,r.order_ref,r.errors.join(" ")||"priced"]).concat(a.expense_rows.map(e=>["expense",e.id,"",e.description,"1","1","expense",e.total,e.total,"","","",e.errors.join(" ")||(e.invoice_ready?"approval and receipt recorded":"proposed expense")])));}
function preparationCsv(p){const r=inspect(p);return csv(["kind","id","requirement","status","reference","notes"],r.preparation.items.map(i=>[i.kind,i.id,i.label,i.status,i.reference,i.notes]));}
function reportText(p){
  const r=inspect(p),a=r.assignment,s=r.scenario;
  return"# "+p.title+"\n\nWorkplan: "+p.workplan_id+"; revision "+p.revision+"\nProcurement: "+R.epin+"; source edition "+R.version+"\n\n"+
    "## Rates and official scenario\n\n"+r.rates.complete+"/36 rates entered. Official scenario: "+(s.complete?"USD "+s.total:"incomplete; known subtotal USD "+s.subtotal)+".\n\n"+
    "The calculation contains the original 19 Attachment D lines. The schedule contains all 36 Attachment C items. Proposed rate inputs remain the operator's values.\n\n"+
    "## Assignment\n\nProject: "+(p.assignment.project_ref||"Not entered")+"\n\n"+p.assignment.scope+"\n\n"+
    "Services: USD "+a.service_subtotal+"\nProposed reimbursables: USD "+a.proposed_expenses+"\n"+(a.total?"Proposed total: USD "+a.total:"Assignment total is incomplete.")+"\n\n"+
    "Schedule: "+p.assignment.schedule+"\nExperience reference: "+p.assignment.experience_reference+"\nStaff reference: "+p.assignment.staff_reference+"\n\n"+
    (a.errors.length?"Items to correct:\n"+a.errors.map(e=>"- "+e.id+": "+e.message).join("\n")+"\n\n":"")+
    "## Preparation\n\n"+r.preparation.items.map(i=>"- "+i.label+": "+i.status.replace(/_/g," ")+"; "+i.reference).join("\n")+"\n\n"+
    "D1 / Item total to transcribe after review: "+(s.total?"USD "+s.total:"not yet calculated")+". Keep the original agency forms unchanged.\n\n"+
    "## Calculation convention\n\n"+R.calculation_policy.line_total_rounding+"\n\n"+
    "## Original sources\n\n"+R.sources.map(x=>"- "+x.label+": "+x.url).join("\n")+"\n\n"+
    "This bundle records prospective costing and proposal preparation. Awards, work orders, earned invoices and payment claims continue through the original commercial case and agency workflow.\n";
}
function exportsFor(p){p=validateWorkplan(p);return{
  "workplan.json":JSON.stringify(p,null,2)+"\n",
  "rate-schedule.csv":rateCsv(p),"official-scenario.csv":scenarioCsv(p),"assignment.csv":assignmentCsv(p),"preparation.csv":preparationCsv(p),
  "calculation-report.json":JSON.stringify(inspect(p),null,2)+"\n","workplan-summary.md":reportText(p),"original-source-register.json":JSON.stringify({rules_version:R.version,sources:R.sources,dates:R.dates,calculation_policy:R.calculation_policy},null,2)+"\n"};}
function verifyExports(workplan,entries){
  const p=validateWorkplan(workplan),expected=exportsFor(p);
  for(const [name,value] of Object.entries(expected))if(typeof entries[name]!=="string"||entries[name]!==value)fail("The saved calculation does not match this workplan and source edition: "+name);
  return{workplan:p,verified_files:Object.keys(expected)};
}
return Object.freeze({rules:R,newWorkplan,validateWorkplan,touch,inspect,rateStatus,priceScenario,priceAssignment,evaluation,preparation,rateCsv,scenarioCsv,assignmentCsv,preparationCsv,reportText,exportsFor,verifyExports,scaled,money,csv});
});

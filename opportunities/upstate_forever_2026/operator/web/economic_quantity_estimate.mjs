// Copyright (c) 2026 TokenJunkie Labs. MIT License.
// Quantity estimates feed the original Economic cost worksheet; they never change a scientific run.
const SCHEMA="upstate.economic-quantity-estimate/v1";
const copy=value=>JSON.parse(JSON.stringify(value));
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const nonempty=value=>typeof value==="string"&&value.trim().length>0;
const fail=(code,message)=>{throw Object.assign(Error(message),{code});};
function decimal(value,label){
 const text=typeof value==="number"&&Number.isFinite(value)?String(value):value;
 if(typeof text!=="string"||!/^(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(text))fail("QUANTITY_NUMBER",label+" must be a nonnegative finite decimal.");
 const [mantissa,exp="0"]=text.toLowerCase().split("e"),exponent=Number(exp);
 if(!Number.isSafeInteger(exponent)||Math.abs(exponent)>308)fail("QUANTITY_NUMBER",label+" is outside the supported numeric range.");
 const [whole,fraction=""]=mantissa.split("."),power=fraction.length-exponent;
 return power>=0?{n:BigInt(whole+fraction),d:10n**BigInt(power)}:{n:BigInt(whole+fraction)*10n**BigInt(-power),d:1n};
}
const mul=(a,b)=>({n:a.n*b.n,d:a.d*b.d});
const ratio=(n,d=1n)=>({n:BigInt(n),d:BigInt(d)});
const UNITS={
 m2:["area",ratio(1)],square_metre:["area",ratio(1)],square_foot:["area",ratio(9290304,100000000)],
 ha:["area",ratio(10000)],acre:["area",ratio(40468564224,10000000)],
 m:["length",ratio(1)],metre:["length",ratio(1)],ft:["length",ratio(3048,10000)],foot:["length",ratio(3048,10000)],
 mile:["length",ratio(1609344,1000)],each:["count",ratio(1)],hour:["time",ratio(1)],week:["week",ratio(1)],DiaInFt:["diameter-inch-foot",ratio(1)]
};
function converted(value,from,to){
 const a=UNITS[from],b=UNITS[to];if(!a||!b||a[0]!==b[0])fail("QUANTITY_UNIT","The quantity and source rate use incompatible units.");
 if(a[0]==="count"&&value.n%value.d!==0n)fail("QUANTITY_COUNT","Use a whole number of items.");
 return mul(value,{n:a[1].n*b[1].d,d:a[1].d*b[1].n});
}
function cents(value){
 const rounded=(value.n*2n+value.d)/(value.d*2n);
 if(rounded>BigInt(Number.MAX_SAFE_INTEGER))fail("QUANTITY_AMOUNT","The calculated amount exceeds exact integer cents.");
 return Number(rounded);
}
function approximate(value){return Number(value.n)/Number(value.d);}
function catalogueRow(context,line){
 const matchesCatalogue=context.catalogues?.filter(x=>x.id===line.catalogue_id)??[];
 if(matchesCatalogue.length!==1)fail("QUANTITY_SOURCE","Choose one retained source catalogue.");
 const catalogue=matchesCatalogue[0];
 const matches=catalogue.rows?.filter(x=>x.id===line.row_id)??[];
 if(matches.length!==1)fail("QUANTITY_SOURCE","Choose one complete source row.");
 const row=matches[0],source=catalogue.sources?.find(x=>x.id===row.source_id);
 if(!source||row.currency!=="USD"||catalogue.currency!=="USD")fail("QUANTITY_SOURCE","The source row must retain its original USD source.");
 return {catalogue,row,source};
}
export function newQuantityEstimate(context){
 if(context?.schema!=="upstate.economic-quantity-source/v1"||!context.binding||!Array.isArray(context.catalogues)||!Array.isArray(context.quantities))fail("QUANTITY_CONTEXT","Receive the complete selected Economic quantity source.");
 return {schema:SCHEMA,context:copy(context),lines:[]};
}
export function calculateQuantityEstimate(draft){
 if(draft?.schema!==SCHEMA||!Array.isArray(draft.lines))fail("QUANTITY_DRAFT","Use the complete original quantity estimate.");
 const context=newQuantityEstimate(draft.context).context,issues=[],lines=[],ids=new Set(),scopes=new Map();
 let capital=0n,annual=0n;
 for(const line of draft.lines){
  try{
   if(!line||typeof line!=="object"||Array.isArray(line))fail("QUANTITY_LINE","Use a complete quantity line.");
   if(!nonempty(line.id)||ids.has(line.id))fail("QUANTITY_ID","Every quantity line needs a distinct identity.");
   ids.add(line.id);const {catalogue,row,source}=catalogueRow(context,line);
   if(!["capital","annual","context"].includes(line.classification))fail("QUANTITY_CLASS","Choose capital, explicit annual cost, or reference context.");
   if(!nonempty(line.applicability_reason))fail("QUANTITY_APPLICABILITY","Record why this source practice and geography apply to the selected work.");
   if(row.price_kind==="assistance_payment"&&line.classification!=="context")fail("QUANTITY_PAYMENT","A programme payment belongs in reference context, not gross implementation cost.");
   if(!["assistance_payment","service_component","material_component","historical_scenario_benchmark","observed_survey_gross"].includes(row.price_kind))fail("QUANTITY_SOURCE","The source price kind is unsupported.");
   let quantity,unit,basis;
   if(line.quantity?.kind==="native"){
    const found=context.quantities.filter(x=>x.key===line.quantity.key);
    if(found.length!==1||!["native_changed_area","native_transition_area","native_implementation_quantity"].includes(found[0].basis))fail("QUANTITY_NATIVE","Select an original verified treatment quantity.");
    const selected=found[0];if(!selected.source_ref)fail("QUANTITY_NATIVE","The treatment quantity has no original source reference.");
    quantity=decimal(selected.value,"Original treatment quantity");unit=selected.unit;basis=copy(selected);
   }else if(line.quantity?.kind==="manual"){
    if(!nonempty(line.quantity.reason))fail("QUANTITY_MANUAL","Retain the basis for the entered implementation quantity.");
    quantity=decimal(line.quantity.value,"Entered quantity");unit=line.quantity.unit;basis=copy(line.quantity);
   }else fail("QUANTITY_NATIVE","Choose a native treatment quantity or an explicitly entered quantity.");
   const inSourceUnits=converted(quantity,unit,row.quantity_unit),pricing=row.pricing;
   if(!pricing||!["linear","per_thousand"].includes(pricing.type))fail("QUANTITY_PRICE","The original source pricing rule is unsupported.");
   let rate=pricing.rate_cents??row.rate_cents;
   if(!Number.isSafeInteger(rate)||rate<0)fail("QUANTITY_PRICE","The source rate must use exact nonnegative cents.");
   let override=null;
   if(line.rate_override!==undefined&&line.rate_override!==null){
    override=line.rate_override;
    const edited=typeof override.rate_cents==="string"&&/^(?:0|[1-9]\d*)$/.test(override.rate_cents)?Number(override.rate_cents):override.rate_cents;
    if(!Number.isSafeInteger(edited)||edited<0||!nonempty(override.reason)||!nonempty(override.source_ref))fail("QUANTITY_RATE","An edited rate needs exact cents, its source and the reason for the change.");
    rate=edited;
   }
   const divisor=pricing.type==="per_thousand"?decimal(pricing.divisor??1000,"Source pricing divisor"):ratio(1);
   if(divisor.n===0n)fail("QUANTITY_PRICE","The source pricing divisor must be positive.");
   if(pricing.minimum_quantity!==undefined&&pricing.minimum_quantity!==null){
    const minimum=decimal(pricing.minimum_quantity,"Source minimum quantity");
    if(inSourceUnits.n*minimum.d<minimum.n*inSourceUnits.d)fail("QUANTITY_MINIMUM","The selected quantity is below the original source minimum.");
   }
   const occurrenceCost=mul(mul(inSourceUnits,ratio(rate)),{n:divisor.d,d:divisor.n});
   let occurrences=ratio(1);
   if(line.classification==="annual"){
    if(!own(line,"annual_occurrences"))fail("QUANTITY_RECURRENCE","Enter the reviewed number of occurrences per year.");
    occurrences=decimal(line.annual_occurrences,"Annual occurrences");
    if(occurrences.n===0n||!nonempty(line.recurrence_reason))fail("QUANTITY_RECURRENCE","Annual cost needs a positive occurrence frequency and its basis.");
   }
   const total=cents(mul(occurrenceCost,occurrences)),perOccurrence=cents(occurrenceCost);
   const output={id:line.id,title:line.title||row.title,scope_group:line.scope_group??null,overlap_reason:line.overlap_reason??null,classification:line.classification,currency:"USD",
    quantity:{value:approximate(inSourceUnits),exact_numerator:String(inSourceUnits.n),exact_denominator:String(inSourceUnits.d),unit:row.quantity_unit,basis},
    source:{catalogue_id:catalogue.id,row_id:row.id,price_kind:row.price_kind,row:copy(row),document:copy(source)},
    rate_cents:rate,rate_override:override?copy(override):null,per_occurrence_cents:perOccurrence,
    annual_occurrences:line.classification==="annual"?String(line.annual_occurrences):null,
    recurrence_reason:line.classification==="annual"?line.recurrence_reason:null,amount_cents:total,applicability_reason:line.applicability_reason};
   if(line.classification!=="context"){
    const scope=nonempty(line.scope_group)?line.scope_group:"selected-intervention";
    const declared=context.catalogues.flatMap(item=>item.component_bindings??[]).find(item=>item.catalogue_id===catalogue.id&&item.row_id===row.id);
    const components=row.includes_components??declared?.includes_components??[],group=scopes.get(scope)??[];
    for(const previous of group){
     const overlaps=components.filter(component=>previous.components.includes(component));
     if(overlaps.length&&!(nonempty(line.overlap_reason)&&nonempty(previous.line.overlap_reason)))fail("QUANTITY_OVERLAP","Overlapping cost components need an explicit allocation basis on both lines: "+overlaps.join(", ")+".");
    }
    group.push({line,components});scopes.set(scope,group);
    if(line.classification==="capital")capital+=BigInt(total);else annual+=BigInt(total);
   }
   lines.push(output);
  }catch(error){issues.push({line_id:line?.id??null,code:error.code??"QUANTITY_LINE",message:error.message});}
 }
 if(capital>BigInt(Number.MAX_SAFE_INTEGER)||annual>BigInt(Number.MAX_SAFE_INTEGER))issues.push({line_id:null,code:"QUANTITY_AMOUNT",message:"The total exceeds exact integer cents."});
 const ready=issues.length===0&&lines.some(x=>x.classification!=="context");
 return {schema:"upstate.economic-quantity-result/v1",binding:copy(context.binding),lines,issues,ready,
  totals:ready?{currency:"USD",capital_cents:Number(capital),annual_cents:Number(annual)}:null};
}
export function prepareQuantityCostWorksheet(draft,{source,economicDraft}={}){
 const result=calculateQuantityEstimate(draft);
 if(!result.ready)fail("QUANTITY_REVIEW","Complete every quantity, source, applicability and recurrence choice before preparing costs.");
 const binding=result.binding,run=binding.run_id;
 if(!source||!economicDraft||typeof run!=="string"||!run)fail("QUANTITY_PLANNING","Receive the selected original Economic source and draft.");
 for(const key of ["project_id","report_id","report_sha256","zone_id"]){
  if(!nonempty(binding[key]))fail("QUANTITY_PLANNING","The original Economic binding is missing "+key+".");
  if(source.identity?.[key]!==undefined&&source.identity[key]!==binding[key])fail("QUANTITY_PLANNING","The quantity and Economic source bindings differ.");
 }
 const originalIdentity={project_id:String(source.project?.id??""),report_id:source.producer_report_id,report_sha256:source.source?.sha256,zone_id:economicDraft.zoneId};
 for(const key of ["project_id","report_id","report_sha256","zone_id"])if(originalIdentity[key]!==binding[key])fail("QUANTITY_PLANNING","The quantity and original Economic source bindings differ.");
 if(economicDraft.reportId!==binding.report_id||economicDraft.reportSha!==binding.report_sha256||!source.zones?.some(zone=>zone.zone_id===binding.zone_id))fail("QUANTITY_PLANNING","Return to the original completed report and zone.");
 const alternative=source.alternatives?.find(value=>value.run_id===run),current=economicDraft.costs?.[run];
 if(!alternative||!current||!nonempty(source.baseline_run_id))fail("QUANTITY_PLANNING","The treatment run is not in the selected original Economic alternatives.");
 const planningNumber=(value,label,positive=false)=>{
  const raw=String(value??"").trim();
  if(!/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw)||!Number.isFinite(Number(raw))||Number(raw)<0||(positive&&Number(raw)<=0))fail("QUANTITY_PLANNING","Set the original explicit "+label+".");
 };
 planningNumber(current.horizon_years,"positive planning horizon",true);
 planningNumber(current.discount_percent,"nonnegative discount percentage");
 if(current.currency!==undefined&&String(current.currency).trim().toUpperCase()!=="USD")fail("QUANTITY_PLANNING","The selected source prices use USD; choose the matching original currency.");
 if(!nonempty(current.source_title)||!nonempty(current.source_uri)||!/^\d{4}-\d{2}-\d{2}$/.test(current.source_as_of??"")||Number(current.source_as_of.slice(0,4))<1||Number.isNaN(Date.parse(current.source_as_of+"T00:00:00Z"))||new Date(current.source_as_of+"T00:00:00Z").toISOString().slice(0,10)!==current.source_as_of)
  fail("QUANTITY_PLANNING","Retain the estimate source title, URI and actual ISO source date in the original cost form.");
 const money=value=>String(Math.floor(value/100))+"."+String(value%100).padStart(2,"0");
 return {schema:"upstate.economic-cost-worksheet/v1",
  identity:Object.fromEntries(["project_id","report_id","report_sha256","zone_id"].map(key=>[key,binding[key]])),
  title:economicDraft.title,baseline_run_id:source.baseline_run_id,
  rows:[{run_id:run,label:alternative.label,value:{...copy(current),enabled:true,currency:"USD",
   capital:money(result.totals.capital_cents),annual_operating:money(result.totals.annual_cents),
   cost_scope:"whole-scenario",quantity_estimate:copy(draft),
   note:[current.note??"","Source-linked quantities and original catalogue rows are retained in quantity_estimate."].filter(Boolean).join("\n")}}]};
}

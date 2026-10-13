/** Complete property commissioning input over the original Installation model.
 * Source preparation only. Native preview/save/return and Property operation remain original.
 */
import {bindingTemplate, prepareInstallation} from "./prepare-core.mjs";
export const PROPERTY_SCHEMA = "stellar-forge.property-commissioning-selection.v1";
export const PROPERTY_REVIEW = "stellar-forge.property-commissioning-review.v1";
export const PROFILE = "property-inspections";
export const ORIGINAL_COHORT = Object.freeze({bytes:41555,sha256:"e2897ec89225e6ff42eace2b833a5d0ecb1c298ebe5c5f8296cc4a0819a60ac6",
  pairId:"insparisk-rentcheck-nyc-inspection",caseId:"scf-cohort-rentcheck-inspection-20261012"});
const CHECK_STATES = ["OPEN","IN_PROGRESS","ACCEPTED","CHANGES_REQUIRED","NOT_APPLICABLE"];
const APPROVALS = ["UNSELECTED","PROPOSED","APPROVED","DECLINED"];
const PHASES = ["selection","merchant","buyer","later-edition","operation","handover"];
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
export const clone = value => JSON.parse(JSON.stringify(value));
const ordered = value => Array.isArray(value) ? value.map(ordered) : record(value) ?
  Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])])) : value;
export const canonical = value => JSON.stringify(ordered(value));
export const same = (left,right) => canonical(left) === canonical(right);
const own = (value,key) => Object.prototype.hasOwnProperty.call(value,key);
const need = (condition,message) => {if(!condition)throw new Error(message);};
const hash = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const text = (value,label,maximum=4000,blank=true) => {
  need(typeof value === "string" && value.length <= maximum && (blank || value.trim().length>0),label+" must be complete text.");
  return value;
};
const id = (value,label) => text(value,label,200,false);
const array = (value,label,maximum) => {need(Array.isArray(value)&&value.length<=maximum,label+" exceeds its complete selection bound.");return value;};
const unique = values => [...new Set(values)];
function keys(value,allowed,required,label) {
  need(record(value)&&Object.keys(value).every(key=>allowed.includes(key))&&required.every(key=>own(value,key)),
    "Use the declared complete "+label+" fields.");
}
function timestamp(value,label,nullable=false) {
  if(nullable&&value===null)return;
  need(typeof value==="string"&&/^\d{4}-\d\d-\d\dT.+(?:Z|[+-]\d\d:\d\d)$/.test(value)&&Number.isFinite(Date.parse(value)),
    "Retain a timezone-qualified "+label+".");
}
function strings(value,label,maximum=100) {
  array(value,label,maximum).forEach(item=>id(item,label));
  need(unique(value).length===value.length,"Keep each "+label+" once.");return value;
}
function sameNativeSource(selected,current) {
  need(record(selected)&&record(current)&&Number.isSafeInteger(selected.version)&&Number.isSafeInteger(current.version)&&
    current.version>=selected.version,"Keep the original native source and a current case revision.");
  const stable=value=>Object.fromEntries(Object.entries(value).filter(([key])=>key!=="version"));
  need(same(stable(selected),stable(current)),"The original case or selected plan source changed. Prepare a deliberate successor selection.");
}
function nativeCatalogue(caseState,nativeSource) {
  need(record(caseState)&&caseState.program?.id===nativeSource.caseId&&caseState.program.version===nativeSource.version&&
    caseState.program.planId===nativeSource.planId&&Array.isArray(caseState.sources),
    "Read the complete original case source catalogue at the selected native seed version.");
  const sources=new Map();
  for(const row of caseState.sources) {
    need(record(row)&&typeof row.id==="string"&&!sources.has(row.id),"Keep distinct complete original case source identities.");
    sources.set(row.id,row);
  }
  return sources;
}
function catalogueFiles(sources,catalogue) {
  for(const row of sources.values()) {
    if(row.nativeSourceId===null)continue;
    const native=catalogue.get(row.nativeSourceId);
    need(native&&native.bytes===row.bytes&&native.sha256===row.sha256&&native.mediaType===row.mediaType&&native.sourceUrl===row.sourceUrl&&native.observedAt===row.observedAt,
      "The attached original case source differs from the complete selected bytes: "+row.id);
  }
}
function attachedDocument(catalogue,sha256,bytes,label) {
  need(hash(sha256)&&Number.isSafeInteger(bytes)&&bytes>0,"Keep the complete "+label+" file identity.");
  const rows=[...catalogue.values()].filter(row=>row.sha256===sha256&&row.bytes===bytes&&row.mediaType==="application/json");
  need(rows.length,"Attach the exact complete "+label+" JSON through the original case before preparing this native input.");
  return clone(rows.sort((a,b)=>a.id.localeCompare(b.id))[0]);
}
function seedBinding(seed) {
  need(record(seed)&&record(seed.source)&&record(seed.document),"Read the complete original Installation seed.");
  for(const key of ["caseId","version","planId","planRevision","planContentSha256","planSourceSha256"])
    need(own(seed.source,key),"The original seed is missing source."+key);
  need(seed.document.workshare?.caseId===ORIGINAL_COHORT.caseId,"Select the original RentCheck commercial Workshare.");
  const phases=seed.document.workshare.phaseChecks;
  need(Array.isArray(phases)&&phases.length===PHASES.length&&same(phases.map(row=>row.phaseId),PHASES),
    "Keep all six original property Workshare phases in their original order.");
  need(unique(phases.map(row=>row.checkId)).length===phases.length&&Array.isArray(seed.document.checks),
    "Keep the original distinct native acceptance checks.");
  phases.forEach(row=>need(seed.document.checks.some(check=>check.id===row.checkId),"An original phase check is missing."));
  return clone(seed.source);
}
export function originalScope(corpus) {
  need(record(corpus)&&corpus.bytes===ORIGINAL_COHORT.bytes&&corpus.sha256===ORIGINAL_COHORT.sha256,
    "Retain the full original 41,555-byte cohort.json and its exact SHA-256.");
  const pair=corpus.value?.pairs?.find(row=>row.id===ORIGINAL_COHORT.pairId);
  need(pair&&corpus.value.case_intake?.case_ids?.rentcheck===ORIGINAL_COHORT.caseId,"The original property offer is missing.");
  need(same(pair.phases.map(row=>row.id),PHASES)&&same(pair.phases.map(row=>row.hours),[8,16,20,16,12,12]),
    "The six original phase identities or proposed hours changed.");
  need(pair.commercial.fixed_fee==="14400.00"&&pair.commercial.price_status==="PROPOSED"&&
    pair.commercial.delivery_window.staff_hours===84&&pair.commercial.delivery_window.contingency_hours===16&&
    pair.commercial.delivery_window.total_estimated_hours===100&&pair.commercial.delivery_window.active_business_days===20,
    "Keep the complete original proposed commercial terms.");
  return pair;
}
/** Author an explicitly proposed native Workshare from the complete original offer.
 * The original Python load_workshares validates it before the CLI publishes it.
 */
export function propertyWorkshare(corpus,profile) {
  const scope=originalScope(corpus);need(profile?.id===PROFILE,"Use the complete original property workorder profile.");
  const days=[2,4,4,4,3,3];
  const acceptance=[
    "The original owner and buyer have selected the complete roster, source and hosting rights, receiving environment, existing templates, allowed fields, payment path and customer acceptance examples; unselected items remain explicit.",
    "The deliberately selected earlier merchant source is retained in full with its source coverage, original property identity joins and original report/request history; each unavailable or unresolved item has an explicit disposition.",
    "The authorized buyer operator has received the selected report, reviewed each property identity, and completed the agreed original inspection/template/report workflow or recorded the buyer's explicit exception for every selected property.",
    "The second authentic source edition and complete comparison retain unchanged, changed, null, missing and unavailable meanings; any create uncertainty has been reconciled to its original action and no duplicate inspection was dispatched.",
    "The selected existing report/PMS route is operated and the original selected workspace, source/report/request and any actual purchase identities reopen through the complete export and independent receiving procedure.",
    "Two consolidated review rounds and all five customer-selected examples have their actual outcomes; the full source/configuration, customer-specific mapping, original results and operator/recovery guide have been handed over with the named maintainer and defect-correction terms."
  ];
  const plan={
    version:"dealscout.workshare-plan.v1",
    title:"RentCheck / Propply selected-property report and inspection implementation",
    customer:"RentCheck",supplier:"TJLabs",
    outcome:profile.task.completeOutput,
    commercial:{currency:scope.commercial.currency,amount:scope.commercial.fixed_fee,
      price_status:scope.commercial.price_status,source_url:"https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8NEPJSAV",
      milestones:scope.commercial.milestones.map(row=>({label:row.label,amount:row.amount,trigger:row.label})),
      terms:scope.commercial.terms,contracting_payer:scope.commercial.contracting_payer,
      resource_payment:scope.commercial.resource_payment,metric_boundary:scope.commercial.metric_boundary,
      customer_specific_work:scope.commercial.customer_specific_work,
      original_delivery_window:clone(scope.commercial.delivery_window)},
    schedule:{business_days:20,start_conditions:[scope.commercial.delivery_window.display,
      "The parties confirm the supported native source/inspection/report route, complete authorized inputs, actual receiving environment and staffing before kickoff.",
      "Waiting for source availability, access or consolidated customer feedback follows the agreed active-work calendar."],
      phase_day_basis:"New proposed implementation allocation: 2/4/4/4/3/3 active days, preserving the original 20-day offer. These individual durations are authored planning choices, not dates or durations quoted by either customer."},
    phases:scope.phases.map((row,index)=>({id:row.id,title:profile.steps[index].title,description:row.work,
      owner:"TJLabs delivery operator, assigned at the agreed kickoff",business_days:days[index],
      depends_on:index?[scope.phases[index-1].id]:[],acceptance:acceptance[index]})),
    rights:profile.receiving.changeAndWithdraw+" "+scope.commercial.terms,
    change_process:scope.commercial.terms+" "+profile.source.changePolicy,
    original_phase_sources:clone(scope.phases),
    effort_basis:{planned_phase_hours:84,included_unallocated_contingency_hours:16,total_estimated_hours:100,
      actual_hours_recorded:0,meaning:"The native six-phase effort projection totals 84 planned hours. The remaining 16 hours are an included unallocated contingency; no extra phase, time record, reservation, funding assignment or invoice is created."},
    status_basis:"Authored source preparation from the original proposed offer. No customer acceptance, native CaseDesk/Workshare save, staffing reservation, vendor access, payment or grant adoption is established."
  };
  const source={version:"tjlabs.property-cohort-workshare-source.v1",case_id:ORIGINAL_COHORT.caseId,
    original_packet:{filename:"cohort.json",bytes:ORIGINAL_COHORT.bytes,sha256:ORIGINAL_COHORT.sha256,
      source_url:plan.commercial.source_url,pair_id:ORIGINAL_COHORT.pairId},
    original_scope:clone(scope),authored_plan_basis:plan.status_basis};
  return {source,plan,production_effort:scope.phases.map(row=>({phase_id:row.id,hours:String(row.hours)}))};
}
const emptyApproval = () => ({state:"UNSELECTED",by:"",at:null,note:"",sourceIds:[]});
const emptyHost = () => ({host:"",operator:"",environment:"UNSELECTED",sourceIds:[]});
export function propertyTemplate(seed,corpus) {
  originalScope(corpus);const source=seedBinding(seed);
  return {
    schema:PROPERTY_SCHEMA,id:"rentcheck-property-commissioning",edition:1,previous:null,
    source,workshareCaseId:ORIGINAL_COHORT.caseId,selectedBy:"",selectedAt:null,
    properties:[],templates:[],editions:[
      {slot:"earlier",reference:"",sourceIds:[]},{slot:"later",reference:"",sourceIds:[]}],
    fields:[],includeWholeReport:false,
    rights:{sourceUse:emptyApproval(),merchantHost:emptyApproval(),buyerUse:emptyApproval(),
      buyerHost:emptyApproval(),wholeReportDelivery:emptyApproval(),resourcePayment:emptyApproval()},
    hosts:{merchant:emptyHost(),buyer:emptyHost()},
    route:{name:"",kind:"UNSELECTED",reference:"",sourceIds:[]},
    deployments:{merchantDeploymentId:seed.document.merchantDeploymentId,buyerDeploymentIds:clone(seed.document.buyerDeploymentIds)},
    payment:{mode:"UNSELECTED",native:clone(seed.document.payment)},
    examples:Array.from({length:5},(_,i)=>({id:"example-"+(i+1),propertyKeys:[],task:"",expectedReview:"",sourceIds:[]})),
    sourceFiles:[],note:""
  };
}
/** Files are complete hash-verified originals supplied by the local reader, not provider responses. */
function sourceTable(selection,files,findings) {
  array(selection.sourceFiles,"original source files",100);
  const result=new Map();let total=0;
  for(const selected of selection.sourceFiles) {
    keys(selected,["id","filename","bytes","sha256","mediaType","sourceUrl","observedAt","nativeSourceId"],
      ["id","filename","bytes","sha256","mediaType","sourceUrl","observedAt","nativeSourceId"],"source file");
    id(selected.id,"Source file ID");
    need(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/.test(selected.id)&&!result.has(selected.id),"Each original source file needs a distinct safe local ID.");
    need(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/.test(selected.filename),"Use an explicit safe source filename.");
    need(Number.isSafeInteger(selected.bytes)&&selected.bytes>0&&selected.bytes<=8*1024*1024&&hash(selected.sha256),
      "Keep each complete native source within 8 MiB with its exact SHA-256.");
    text(selected.mediaType,"Original media type",200,false);
    need(/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/.test(selected.mediaType),"Retain the original plain MIME media type.");
    text(selected.sourceUrl,"Original source URL");
    if(selected.sourceUrl) {
      const url=new URL(selected.sourceUrl);
      need(["https:","http:"].includes(url.protocol)&&url.hostname&&!url.username&&!url.password,"Use an original HTTP(S) source URL without credentials, or an explicit empty local-source URL.");
    }
    timestamp(selected.observedAt,"original source observation");
    need(selected.nativeSourceId===null||typeof selected.nativeSourceId==="string"&&selected.nativeSourceId.length>0&&selected.nativeSourceId.length<=100,
      "Use an actual attached source ID or null.");
    const found=own(files,selected.id)?files[selected.id]:null;
    need(found&&found.bytes===selected.bytes&&found.sha256===selected.sha256&&found.filename===selected.filename,
      "The complete original source differs: "+selected.filename);
    if(!selected.nativeSourceId)findings.push({field:"sourceFiles."+selected.id+".nativeSourceId",message:"Attach this complete original through the existing case or let receive.mjs attach it."});
    total+=selected.bytes;need(total<=24*1024*1024,"Selected full source files exceed the original 24 MiB case source bound.");
    result.set(selected.id,{...selected,value:found.value});
  }
  need(Object.keys(files).length===result.size,"Use exactly the selected complete source roster.");
  return result;
}
function references(values,sources,label) {
  strings(values,label);
  values.forEach(value=>need(sources.has(value),"A complete source is absent for "+label+": "+value));
  return values;
}
function nativeSources(values,sources,required=false) {
  return unique(values.map(value=>{
    const native=sources.get(value)?.nativeSourceId;
    need(!required||native,"Attach every selected acceptance source before native return: "+value);
    return native;
  }).filter(Boolean));
}
function approval(value,sources,label,findings) {
  keys(value,["state","by","at","note","sourceIds"],["state","by","at","note","sourceIds"],label);
  need(APPROVALS.includes(value.state),"Select the actual "+label+" decision.");
  text(value.by,label+" decision maker",200);timestamp(value.at,label+" decision date",true);text(value.note,label+" decision");
  references(value.sourceIds,sources,label+" sources");
  if(value.state==="APPROVED")need(value.by.trim()&&value.at&&value.note.trim()&&value.sourceIds.length,
    "An approved "+label+" needs its named original decision and source.");
  if(value.state!=="APPROVED")findings.push({field:label,message:"Actual "+label+" remains "+value.state.toLowerCase()+"."});
}
function host(value,sources,label,findings) {
  keys(value,["host","operator","environment","sourceIds"],["host","operator","environment","sourceIds"],label);
  text(value.host,label+" host");text(value.operator,label+" operator",200);
  need(["UNSELECTED","STAGING","PRODUCTION"].includes(value.environment),"Select the actual "+label+" environment.");
  references(value.sourceIds,sources,label+" sources");
  if(!value.host.trim()||!value.operator.trim()||value.environment==="UNSELECTED"||!value.sourceIds.length)
    findings.push({field:label,message:"Select the authorized host, environment, named operator and original source."});
}
export function inspectPropertySelection(selection,files={},previous=null) {
  const fields=["schema","id","edition","previous","source","workshareCaseId","selectedBy","selectedAt",
    "properties","templates","editions","fields","includeWholeReport","rights","hosts","route","deployments","payment","examples","sourceFiles","note"];
  keys(selection,fields,fields,"property commissioning selection");
  need(selection.schema===PROPERTY_SCHEMA&&selection.workshareCaseId===ORIGINAL_COHORT.caseId,"Keep the original property/customer selection.");
  id(selection.id,"Original selection ID");need(Number.isSafeInteger(selection.edition)&&selection.edition>=1,"Use a positive selection edition.");
  need(record(selection.source)&&typeof selection.source.caseId==="string","Keep the original native case/plan binding.");
  const findings=[];const missing=(condition,field,message)=>{if(!condition)findings.push({field,message});};
  text(selection.selectedBy,"Selecting operator",200);timestamp(selection.selectedAt,"selection time",true);text(selection.note,"Selection note");
  missing(selection.selectedBy.trim()&&selection.selectedAt,"selection","Name the actual selecting operator and time.");
  if(selection.edition===1)need(selection.previous===null&&!previous,"The first selection has no predecessor.");
  else {
    keys(selection.previous,["sha256","reason"],["sha256","reason"],"selection predecessor");
    need(hash(selection.previous.sha256)&&previous&&previous.sha256===selection.previous.sha256&&
      previous.value.schema===PROPERTY_SCHEMA&&previous.value.id===selection.id&&previous.value.edition+1===selection.edition&&
      previous.value.workshareCaseId===selection.workshareCaseId&&previous.value.source.caseId===selection.source.caseId,
      "Select the exact preceding complete edition of this original customer selection.");
    text(selection.previous.reason,"Reason for the new retained edition",4000,false);
  }
  const sources=sourceTable(selection,files,findings);
  const propertyKeys=new Set(),templates=new Set();
  array(selection.templates,"existing templates",3);
  for(const row of selection.templates) {
    keys(row,["id","name","sourceIds"],["id","name","sourceIds"],"template");
    id(row.id,"Original template ID");text(row.name,"Template name",300);need(!templates.has(row.id),"Select each existing template once.");templates.add(row.id);
    references(row.sourceIds,sources,"Template sources");missing(row.sourceIds.length,"templates."+row.id,"Retain the actual template response/source.");
  }
  array(selection.properties,"original property roster",50);
  missing(selection.properties.length>0,"properties","Select the complete actual property roster, up to 50.");
  for(const row of selection.properties) {
    keys(row,["key","address","city","state","zip","bbl","bin","buyerPropertyId","templateId","inspection","identityNote","sourceIds"],
      ["key","address","city","state","zip","bbl","bin","buyerPropertyId","templateId","inspection","identityNote","sourceIds"],"property");
    id(row.key,"Original selected property key");need(!propertyKeys.has(row.key),"Keep each original property key once.");propertyKeys.add(row.key);
    for(const key of ["address","city","state","zip","bbl","bin","buyerPropertyId","identityNote"])text(row[key],"Property "+key,key==="identityNote"?4000:500);
    need(row.templateId===null||templates.has(row.templateId),"Select an actual retained template ID or null.");
    need(["UNSELECTED","REQUIRED","NOT_REQUIRED"].includes(row.inspection),"Choose the actual inspection requirement.");
    references(row.sourceIds,sources,"Property sources");
    missing(row.address.trim()&&row.state.trim()&&row.zip.trim()&&row.sourceIds.length,"properties."+row.key,"Retain original address/state/ZIP and whole roster source.");
    missing(row.identityNote.trim(),"properties."+row.key+".identity","Record the explicit match or unresolved identity basis.");
    missing(row.inspection!=="UNSELECTED","properties."+row.key+".inspection","The buyer selects whether an inspection is required.");
    if(row.inspection==="REQUIRED")missing(row.buyerPropertyId&&row.templateId,"properties."+row.key+".buyer","Select the actual buyer property and existing template IDs.");
  }
  need(Array.isArray(selection.editions)&&selection.editions.length===2&&same(selection.editions.map(row=>row.slot),["earlier","later"]),
    "Keep both authentic source-edition slots in their original order.");
  for(const row of selection.editions) {
    keys(row,["slot","reference","sourceIds"],["slot","reference","sourceIds"],"source edition");
    text(row.reference,"Original source edition");references(row.sourceIds,sources,"Edition sources");
    missing(row.reference.trim()&&row.sourceIds.length,"editions."+row.slot,"Retain the actual "+row.slot+" edition reference and complete source.");
  }
  strings(selection.fields,"selected report field pointers",100).forEach(pointer=>need(pointer.startsWith("/")&&!/~(?![01])/.test(pointer),"Use explicit JSON Pointers for selected report fields."));
  missing(selection.fields.length,"fields","Select the permitted report projection.");
  need(typeof selection.includeWholeReport==="boolean","Select the explicit whole-report delivery choice.");
  const rights=["sourceUse","merchantHost","buyerUse","buyerHost","wholeReportDelivery","resourcePayment"];
  keys(selection.rights,rights,rights,"source/host rights");
  for(const key of rights) {
    const local=[];approval(selection.rights[key],sources,"rights."+key,local);
    if(key!=="wholeReportDelivery"&&key!=="resourcePayment"||key==="wholeReportDelivery"&&selection.includeWholeReport||
       key==="resourcePayment"&&selection.payment.mode==="STELLAR_RESOURCE")findings.push(...local);
  }
  if(selection.includeWholeReport)need(selection.rights.wholeReportDelivery.state==="APPROVED","Whole-report delivery needs its recorded explicit approval.");
  keys(selection.hosts,["merchant","buyer"],["merchant","buyer"],"host selection");
  for(const key of ["merchant","buyer"])host(selection.hosts[key],sources,"hosts."+key,findings);
  keys(selection.route,["name","kind","reference","sourceIds"],["name","kind","reference","sourceIds"],"report/PMS route");
  text(selection.route.name,"Report/PMS route name",300);text(selection.route.reference,"Report/PMS route reference");
  need(["UNSELECTED","REPORT","PMS"].includes(selection.route.kind),"Select the existing report or PMS route.");
  references(selection.route.sourceIds,sources,"Report/PMS route sources");
  missing(selection.route.kind!=="UNSELECTED"&&selection.route.name.trim()&&selection.route.reference.trim()&&selection.route.sourceIds.length,
    "route","Select the one existing report/PMS route and its original source.");
  keys(selection.deployments,["merchantDeploymentId","buyerDeploymentIds"],["merchantDeploymentId","buyerDeploymentIds"],"deployments");
  need(selection.deployments.merchantDeploymentId===null||typeof selection.deployments.merchantDeploymentId==="string"&&selection.deployments.merchantDeploymentId.length>0,"Use the original merchant deployment ID or null.");
  strings(selection.deployments.buyerDeploymentIds,"original buyer deployments",20);
  keys(selection.payment,["mode","native"],["mode","native"],"payment selection");
  need(["UNSELECTED","CONVENTIONAL_API","STELLAR_RESOURCE"].includes(selection.payment.mode)&&record(selection.payment.native),
    "Select the actual payment path separately from the implementation fee.");
  if(selection.payment.mode==="UNSELECTED")findings.push({field:"payment.mode",message:"The parties select conventional API billing or their actual merchant resource/payment path."});
  for(const key of ["priceAtomic","taskBudgetAtomic"])need(selection.payment.native[key]===null||
    typeof selection.payment.native[key]==="string"&&/^(0|[1-9][0-9]{0,29})$/.test(selection.payment.native[key]),"Keep exact atomic "+key+" or null.");
  const units=selection.payment.native.taskUnits;
  need(units===null||Number.isSafeInteger(units)&&units>=0&&units<=1e12,"Keep the original whole task count or null.");
  if(units!==null&&selection.payment.native.priceAtomic!==null&&selection.payment.native.taskBudgetAtomic!==null)
    need(BigInt(units)*BigInt(selection.payment.native.priceAtomic)<=BigInt(selection.payment.native.taskBudgetAtomic),"The useful task count exceeds the selected atomic budget.");
  if(selection.payment.mode!=="STELLAR_RESOURCE")need(["priceAtomic","taskBudgetAtomic","taskUnits"].every(key=>selection.payment.native[key]===null),
    "Ordinary API billing or an unselected path must not turn the implementation fee into an atomic payment.");
  array(selection.examples,"customer acceptance examples",5);missing(selection.examples.length===5,"examples","Retain five customer-selected acceptance examples.");
  const exampleIds=new Set();
  for(const row of selection.examples) {
    keys(row,["id","propertyKeys","task","expectedReview","sourceIds"],["id","propertyKeys","task","expectedReview","sourceIds"],"acceptance example");
    id(row.id,"Acceptance example ID");need(!exampleIds.has(row.id),"Keep each customer acceptance example once.");exampleIds.add(row.id);
    strings(row.propertyKeys,"Example property keys",50).forEach(key=>need(propertyKeys.has(key),"An example references an unselected property."));
    text(row.task,"Example task");text(row.expectedReview,"Expected review");references(row.sourceIds,sources,"Example sources");
    missing(row.propertyKeys.length&&row.task.trim()&&row.expectedReview.trim()&&row.sourceIds.length,"examples."+row.id,"Select the actual task, properties and customer acceptance basis.");
  }
  return {selection:clone(selection),sources,findings,counts:{properties:selection.properties.length,templates:selection.templates.length,
    sourceEditions:selection.editions.filter(row=>row.reference&&row.sourceIds.length).length,examples:selection.examples.length},
    qualification:"Operator-selected source and rights statements; native preview and actual customer acceptance remain separate."};
}
function conciseSource(selection) {
  return selection.editions.map(row=>row.slot+": "+(row.reference||"not selected")).join("\n")+
    "\nComplete property selection "+selection.id+", edition "+selection.edition+"; "+selection.properties.length+
    " original property records, "+selection.templates.length+" original templates. Full roster, rights, host and field selections remain in the attached original JSON.";
}
export function preparePropertyInstallation({seed,profile,selection,selectionSha256,selectionBytes,caseState=null,corpus,files={},previous=null}) {
  const scope=originalScope(corpus),binding=seedBinding(seed);
  need(profile?.id===PROFILE,"Use the complete maintained property-inspections profile.");
  sameNativeSource(selection.source,binding);
  const inspected=inspectPropertySelection(selection,files,previous);
  let selectionAttachment=null;
  if(caseState) {
    const catalogue=nativeCatalogue(caseState,binding);catalogueFiles(inspected.sources,catalogue);
    selectionAttachment=attachedDocument(catalogue,selectionSha256,selectionBytes,"customer selection");
  } else inspected.findings.push({field:"selectionSource",message:"Attach the exact complete customer selection, then read the current case catalogue and native seed to include its original source ID."});
  const nativeIds=unique([...nativeSources(selection.sourceFiles.map(row=>row.id),inspected.sources),...(selectionAttachment?[selectionAttachment.id]:[])]);
  const rightsText=["sourceUse","merchantHost","buyerUse","buyerHost"].map(key=>key+": "+selection.rights[key].state+"; "+selection.rights[key].note).join("\n");
  need(rightsText.length<=4000,"Keep the complete selected rights statements within the native field; full sources remain attached.");
  const supplied={
    merchantDeploymentId:selection.deployments.merchantDeploymentId,buyerDeploymentIds:clone(selection.deployments.buyerDeploymentIds),
    source:{sourceIds:nativeIds,reference:conciseSource(selection),authority:rightsText},
    payment:clone(selection.payment.native),
    receiving:{host:selection.hosts.buyer.host,operator:selection.hosts.buyer.operator,sourceIds:nativeIds,
      acceptanceRule:profile.receiving.acceptanceRule+"\nCustomer selection "+selection.id+" / edition "+selection.edition+
        " names all properties, five examples and the original source/host decisions. Payment path: "+selection.payment.mode+"."}
  };
  let prepared,bindings;
  if((seed.installationId??null)===null) {
    bindings={...bindingTemplate(seed,profile),...supplied};
    prepared=prepareInstallation(seed,profile,bindings);
  } else {
    need(typeof seed.installationId==="string"&&Number.isSafeInteger(seed.expectedRevision)&&seed.expectedRevision>0,
      "Keep the existing native Installation identity and current selected revision.");
    const document=clone(seed.document);
    for(const section of ["source","payment","receiving"])document[section]={...document[section],...supplied[section]};
    for(const section of ["source","receiving"])document[section].sourceIds=unique([...seed.document[section].sourceIds,...nativeIds]);
    document.payment.termsSourceIds=unique([...seed.document.payment.termsSourceIds,...selection.payment.native.termsSourceIds]);
    document.merchantDeploymentId=supplied.merchantDeploymentId;document.buyerDeploymentIds=supplied.buyerDeploymentIds;
    // Existing operated task, stage, observations, workorder, cost assignment and new native fields stay retained.
    for(const key of Object.keys(seed.document).filter(key=>!["source","payment","receiving","merchantDeploymentId","buyerDeploymentIds"].includes(key)))
      need(same(document[key],seed.document[key]),"The retained native "+key+" changed.");
    bindings=supplied;
    prepared={schema:"stellar-forge.installation-workorder-preparation.v1",profile:PROFILE,source:binding,
      workshareCaseId:ORIGINAL_COHORT.caseId,document,selections:[],implementation:clone(profile.steps),inputs:clone(profile.inputs),sourceFiles:clone(profile.sourceFiles)};
  }
  const preview={expectedVersion:binding.version,installationId:seed.installationId??null,
    expectedRevision:seed.expectedRevision??0,document:clone(prepared.document)};
  return {...prepared,preview,bindings,property:{schema:PROPERTY_SCHEMA,selection:clone(selection),findings:inspected.findings,
    counts:inspected.counts,selectionAttachment,commercial:clone(scope.commercial),phases:clone(scope.phases),sourceFiles:clone(selection.sourceFiles),
    qualification:inspected.qualification}};
}

function pointer(value,path) {
  need(typeof path==="string"&&path.startsWith("/")&&path.length<=2000&&!/~(?![01])/.test(path),"Select an exact original JSON Pointer.");
  for(const part of path.split("/").slice(1)) {
    const key=part.replace(/~1/g,"/").replace(/~0/g,"~");
    if(Array.isArray(value))need(/^(0|[1-9][0-9]*)$/.test(key)&&Number(key)<value.length,"An original array source is missing.");
    else need(record(value)&&own(value,key),"The complete original source does not contain "+path);
    value=value[key];
  }
  return value;
}
function fact(value,sources,label,expected) {
  keys(value,["sourceId","pointer","expected"],["sourceId","pointer","expected"],label);
  const source=sources.get(value.sourceId);need(source&&source.value!==undefined,"Select a complete original JSON source for "+label);
  need(same(pointer(source.value,value.pointer),value.expected),"The original JSON source differs from "+label);
  if(expected!==undefined)need(same(value.expected,expected),"The retained "+label+" selects another original identity.");
  return value.sourceId;
}
function savedObservation(check) {
  return clone(Object.fromEntries(["id","state","operator","observedAt","note","sourceIds","workIds","purchaseIds","outcomeIds"]
    .map(key=>[key,check[key]])));
}
function returnBinding(nativeSeed,installation,selection) {
  need(nativeSeed?.schema==="stellar-forge.sf47-installation-return.v1.seed"&&record(nativeSeed.inputs)&&record(nativeSeed.source),
    "Read the complete original Installation Return seed.");
  need(installation?.id===nativeSeed.baseline?.id&&installation.revision===nativeSeed.baseline?.revision&&
    installation.sha256===nativeSeed.baseline?.sha256&&record(installation.preview?.document),
    "Select the complete original Installation edition bound by this Return seed.");
  const document=installation.preview.document;
  need(document.workshare?.caseId===selection.workshareCaseId,"The selected Installation belongs to another original customer Workshare.");
  const phases=document.workshare.phaseChecks;
  need(Array.isArray(phases)&&same(phases.map(row=>row.phaseId),PHASES),"Retain all six original phase/check bindings.");
  need(nativeSeed.inputs.installationId===installation.id&&nativeSeed.inputs.revision===installation.revision&&nativeSeed.inputs.sha256===installation.sha256,
    "The native Return inputs select another Installation edition.");
  const definitions=document.checks.map(row=>Object.fromEntries(["id","title","criterion","tranche","required"].map(key=>[key,row[key]])));
  need(same(nativeSeed.checks,definitions)&&Array.isArray(nativeSeed.inputs.observations)&&
    same(nativeSeed.inputs.observations.map(row=>row.id),document.checks.map(row=>row.id)),
    "Keep every original acceptance definition and observation.");
  return phases;
}
export function propertyReviewTemplate({nativeSeed,installation,selection,selectionSha256,selectionBytes}) {
  need(hash(selectionSha256),"Retain the complete selected commissioning JSON digest.");
  const phases=returnBinding(nativeSeed,installation,selection);
  timestamp(selection.selectedAt,"retained customer selection");
  need(Number.isSafeInteger(selectionBytes)&&selectionBytes>0&&selectionBytes<=8*1024*1024,"Retain the complete selection byte count.");
  const sourceId="commissioning-selection-"+selectionSha256.slice(0,16);
  need(!selection.sourceFiles.some(row=>row.id===sourceId),"The retained selection source ID is already used.");
  return {schema:PROPERTY_REVIEW,selectionSha256,selectionSourceId:sourceId,
    baseline:clone(nativeSeed.baseline),nativeSource:clone(nativeSeed.source),
    reviewer:{name:"",at:null,recipient:nativeSeed.inputs.recipient||"",environment:nativeSeed.inputs.environment||"",note:""},
    sourceFiles:[...clone(selection.sourceFiles),{id:sourceId,filename:"Property_Selection_"+selectionSha256.slice(0,16)+".json",bytes:selectionBytes,
      sha256:selectionSha256,mediaType:"application/json",sourceUrl:"",
      observedAt:selection.selectedAt,nativeSourceId:null}],
    properties:selection.properties.map(row=>({key:row.key,disposition:"PENDING",by:"",at:null,note:"",sourceIds:[],
      editions:[{slot:"earlier",state:"UNREVIEWED",reference:"",facts:[],sourceIds:[],note:""},
        {slot:"later",state:"UNREVIEWED",reference:"",facts:[],sourceIds:[],note:""}],
      identityFacts:[],inspection:null,reports:[]})),
    examples:selection.examples.map(row=>({id:row.id,state:"OPEN",by:"",at:null,note:"",sourceIds:[]})),
    reopening:{state:"OPEN",by:"",at:null,note:"",sourceIds:[],before:null,after:null},
    phases:phases.map(row=>{
      const retainedObservation=savedObservation(installation.preview.document.checks.find(check=>check.id===row.checkId));
      return {phaseId:row.phaseId,checkId:row.checkId,action:"KEEP",state:retainedObservation.state,
        by:retainedObservation.operator,at:retainedObservation.observedAt,note:retainedObservation.note,
        sourceIds:[],workIds:clone(retainedObservation.workIds),purchaseIds:clone(retainedObservation.purchaseIds),
        outcomeIds:clone(retainedObservation.outcomeIds),retainedObservation};
    })};
}
export function preparePropertyReturn({nativeSeed,installation,selection,selectionSha256,review,reviewSha256,reviewBytes,caseState,files={},previous=null}) {
  const phases=returnBinding(nativeSeed,installation,selection);
  keys(review,["schema","selectionSha256","selectionSourceId","baseline","nativeSource","reviewer","sourceFiles","properties","examples","reopening","phases"],
    ["schema","selectionSha256","selectionSourceId","baseline","nativeSource","reviewer","sourceFiles","properties","examples","reopening","phases"],"property acceptance review");
  need(review.schema===PROPERTY_REVIEW&&hash(selectionSha256)&&review.selectionSha256===selectionSha256&&
    same(review.baseline,nativeSeed.baseline),"Keep the original selection and native Return binding.");
  sameNativeSource(review.nativeSource,nativeSeed.source);
  const findings=[],sources=sourceTable(review,files,findings),catalogue=nativeCatalogue(caseState,nativeSeed.source);
  catalogueFiles(sources,catalogue);
  const reviewAttachment=attachedDocument(catalogue,reviewSha256,reviewBytes,"customer review");
  const selectedSource=sources.get(review.selectionSourceId);
  need(selectedSource&&selectedSource.sha256===selectionSha256&&same(selectedSource.value,selection)&&selectedSource.nativeSourceId&&
    unique([...(installation.preview.document.source.sourceIds||[]),...(installation.preview.document.receiving.sourceIds||[])])
      .includes(selectedSource.nativeSourceId),
    "The complete selected commissioning JSON must already belong to this saved Installation's source/receiving set.");
  const originalFiles={};
  for(const row of selection.sourceFiles) {
    const found=sources.get(row.id);
    need(found&&["filename","bytes","sha256","mediaType","sourceUrl","observedAt"].every(key=>found[key]===row[key]),
      "Keep every full original commissioning source in the acceptance review.");
    originalFiles[row.id]=files[row.id];
  }
  const inspected=inspectPropertySelection(selection,originalFiles,previous);
  keys(review.reviewer,["name","at","recipient","environment","note"],["name","at","recipient","environment","note"],"receiving reviewer");
  id(review.reviewer.name,"Actual receiving reviewer");timestamp(review.reviewer.at,"actual receiving review");
  text(review.reviewer.recipient,"Actual recipient",300,false);text(review.reviewer.environment,"Actual receiving environment",4000,false);
  text(review.reviewer.note,"Complete receiving note",8000,false);
  need(Array.isArray(review.properties)&&same(review.properties.map(row=>row.key),selection.properties.map(row=>row.key)),
    "Review every selected property once in its original order.");
  const propertyReports=[],used=new Set([review.selectionSourceId]);
  for(let index=0;index<selection.properties.length;index++) {
    const selected=selection.properties[index],row=review.properties[index],usedHere=new Set();
    keys(row,["key","disposition","by","at","note","sourceIds","editions","identityFacts","inspection","reports"],
      ["key","disposition","by","at","note","sourceIds","editions","identityFacts","inspection","reports"],"property result");
    need(["PENDING","ACCEPTED","EXCEPTION_ACCEPTED","CHANGES_REQUIRED"].includes(row.disposition),"Select the actual property disposition.");
    text(row.by,"Property decision maker",200);timestamp(row.at,"property decision time",true);text(row.note,"Property disposition");
    references(row.sourceIds,sources,"Property disposition sources").forEach(v=>usedHere.add(v));
    if(row.disposition!=="PENDING")need(row.by.trim()&&row.at&&row.note.trim()&&row.sourceIds.length,"A property decision needs its named actual source and reason.");
    need(Array.isArray(row.editions)&&same(row.editions.map(item=>item.slot),["earlier","later"]),"Keep both original source-edition outcomes per property.");
    for(let e=0;e<2;e++) {
      const outcome=row.editions[e],expected=selection.editions[e];
      keys(outcome,["slot","state","reference","facts","sourceIds","note"],["slot","state","reference","facts","sourceIds","note"],"property source outcome");
      need(["UNREVIEWED","AVAILABLE","UNAVAILABLE","NOT_RETURNED"].includes(outcome.state),"Keep the observed source availability.");
      text(outcome.reference,"Actual source edition");text(outcome.note,"Source outcome note");
      references(outcome.sourceIds,sources,"Source outcome evidence").forEach(v=>usedHere.add(v));
      array(outcome.facts,"Original source outcome facts",100).forEach(value=>usedHere.add(fact(value,sources,"source outcome")));
      if(outcome.state!=="UNREVIEWED") {
        need(outcome.reference.trim()&&outcome.sourceIds.length&&outcome.note.trim(),"Retain the actual edition, source and outcome meaning.");
        if(expected.reference)need(outcome.reference===expected.reference,"The reviewed source edition differs from its customer selection.");
        if(outcome.state==="AVAILABLE")need(outcome.facts.length,"A present property source must bind its original returned JSON.");
      }
    }
    const identityFields=new Set();
    array(row.identityFacts,"Original property identity facts",20).forEach(value=>{
      keys(value,["field","fact"],["field","fact"],"selected property identity binding");
      need(["key","address","city","state","zip","bbl","bin","buyerPropertyId","templateId"].includes(value.field)&&
        !identityFields.has(value.field)&&selected[value.field]!==null&&selected[value.field]!=="",
        "Bind each supplied original property identity field once.");
      identityFields.add(value.field);usedHere.add(fact(value.fact,sources,"property "+value.field,selected[value.field]));
    });
    const identityComplete=["key","bbl","bin","buyerPropertyId"].some(key=>identityFields.has(key))||
      ["address","state","zip"].every(key=>identityFields.has(key));
    array(row.reports,"Complete selected report files",20).forEach(value=>{
      need(typeof value==="string"&&sources.has(value),"Keep each complete original report file.");usedHere.add(value);
    });
    if(row.inspection!==null) {
      const observed=row.inspection;
      keys(observed,["origin","id","buyerPropertyId","templateId","requestId","facts","sourceIds","note"],
        ["origin","id","buyerPropertyId","templateId","requestId","facts","sourceIds","note"],"original inspection result");
      need(["CREATED","ADOPTED_EXISTING"].includes(observed.origin),"Preserve created versus explicitly adopted inspection meaning.");
      for(const key of ["id","buyerPropertyId","templateId"])id(observed[key],"Original inspection "+key);
      need(observed.buyerPropertyId===selected.buyerPropertyId&&observed.templateId===selected.templateId,
        "The original inspection belongs to another selected property/template.");
      keys(observed.facts,["id","buyerPropertyId","templateId","requestId"],["id","buyerPropertyId","templateId","requestId"],"inspection facts");
      for(const key of ["id","buyerPropertyId","templateId"])usedHere.add(fact(observed.facts[key],sources,"inspection "+key,observed[key]));
      if(observed.origin==="CREATED") {
        id(observed.requestId,"Original inspection request");usedHere.add(fact(observed.facts.requestId,sources,"inspection request",observed.requestId));
      } else {
        need(observed.requestId===null&&observed.facts.requestId===null,"An adopted inspection must not invent a create request.");
      }
      references(observed.sourceIds,sources,"Inspection/adoption sources").forEach(v=>usedHere.add(v));
      text(observed.note,"Original inspection meaning",4000,false);need(observed.sourceIds.length,"Retain the inspection/adoption's complete original source.");
    }
    const sourceComplete=row.editions.every(value=>value.state!=="UNREVIEWED");
    const inspectionComplete=selected.inspection==="NOT_REQUIRED"||selected.inspection==="REQUIRED"&&row.inspection!==null&&row.reports.length>0;
    const normalComplete=sourceComplete&&identityComplete&&inspectionComplete&&row.reports.length>0;
    if(row.disposition==="ACCEPTED")need(normalComplete,"An accepted property must retain both source outcomes, identity and its selected inspection/report.");
    // Exception acceptance remains the buyer's explicit disposition and source; it is never a fabricated resolved condition.
    const done=row.disposition==="ACCEPTED"||row.disposition==="EXCEPTION_ACCEPTED";
    if(!done)findings.push({field:"properties."+row.key,message:"Property remains "+row.disposition.toLowerCase().replaceAll("_"," ")+". " + row.note});
    for(const value of usedHere)used.add(value);
    propertyReports.push({key:row.key,disposition:row.disposition,complete:done,sourceComplete,inspectionComplete,identityComplete,
      normalComplete,sourceIds:[...usedHere],note:row.note});
  }
  need(Array.isArray(review.examples)&&same(review.examples.map(row=>row.id),selection.examples.map(row=>row.id)),
    "Keep every selected customer example in its original order.");
  for(const row of review.examples) {
    keys(row,["id","state","by","at","note","sourceIds"],["id","state","by","at","note","sourceIds"],"example outcome");
    need(CHECK_STATES.includes(row.state),"Use the original native acceptance state.");
    text(row.by,"Example observer",200);timestamp(row.at,"example observation",true);text(row.note,"Example result");
    references(row.sourceIds,sources,"Example result sources").forEach(v=>used.add(v));
    if(row.state!=="OPEN")need(row.by.trim()&&row.at&&row.note.trim()&&row.sourceIds.length,"Retain the actual example observation and source.");
  }
  const reopen=review.reopening;
  keys(reopen,["state","by","at","note","sourceIds","before","after"],["state","by","at","note","sourceIds","before","after"],"independent reopening");
  need(CHECK_STATES.includes(reopen.state),"Use the original native acceptance state.");
  text(reopen.by,"Reopening operator",200);timestamp(reopen.at,"reopening observation",true);text(reopen.note,"Reopening result");
  references(reopen.sourceIds,sources,"Reopening sources").forEach(v=>used.add(v));
  if(reopen.before!==null)used.add(fact(reopen.before,sources,"original selected workspace identity"));
  if(reopen.after!==null)used.add(fact(reopen.after,sources,"reopened original workspace identity"));
  if(reopen.state==="ACCEPTED")need(reopen.by.trim()&&reopen.at&&reopen.note.trim()&&reopen.sourceIds.length&&
    reopen.before!==null&&reopen.after!==null&&record(reopen.before.expected)&&Object.keys(reopen.before.expected).length>0&&same(reopen.before.expected,reopen.after.expected),
    "An accepted reopen needs the same original identity, complete results and actual named observation.");
  need(Array.isArray(review.phases)&&same(review.phases.map(row=>({phaseId:row.phaseId,checkId:row.checkId})),phases),
    "Keep every original commercial phase/check binding.");
  const inputs=clone(nativeSeed.inputs);
  // The native Return seed intentionally starts OPEN. Preserve the complete selected
  // Installation's actual observation roster, including checks outside these six phases.
  inputs.observations=installation.preview.document.checks.map(savedObservation);
  const observations=new Map(inputs.observations.map(row=>[row.id,row]));
  const baselineObservations=new Map(inputs.observations.map(row=>[row.id,clone(row)]));
  const changes=[];
  for(const row of review.phases) {
    keys(row,["phaseId","checkId","action","state","by","at","note","sourceIds","workIds","purchaseIds","outcomeIds","retainedObservation"],
      ["phaseId","checkId","action","state","by","at","note","sourceIds","workIds","purchaseIds","outcomeIds","retainedObservation"],"original phase observation");
    need(["KEEP","OBSERVE"].includes(row.action)&&CHECK_STATES.includes(row.state),"Select KEEP or an explicit native observation.");
    const retained=baselineObservations.get(row.checkId);
    need(same(row.retainedObservation,retained),"The displayed original phase observation differs from the selected saved Installation.");
    if(row.action==="KEEP") {
      need(row.state===retained.state&&row.by===retained.operator&&row.at===retained.observedAt&&row.note===retained.note&&
        Array.isArray(row.sourceIds)&&row.sourceIds.length===0&&["workIds","purchaseIds","outcomeIds"].every(key=>same(row[key],retained[key])),
        "KEEP preserves the displayed original observation. Select OBSERVE for a deliberate new phase decision.");
      continue;
    }
    text(row.by,"Phase observer",200);timestamp(row.at,"phase observation",true);text(row.note,"Phase observation",8000);
    references(row.sourceIds,sources,"Phase evidence");for(const key of ["workIds","purchaseIds","outcomeIds"])strings(row[key],"Original "+key,100);
    if(row.state!=="OPEN")need(row.by.trim()&&row.at&&row.note.trim()&&row.sourceIds.length,
      "A phase observation requires its actual named decision, time and retained evidence.");
    if(row.state==="OPEN")need(!row.by&&row.at===null,"An open observation keeps observer/time empty.");
    if(row.state==="ACCEPTED") {
      if(row.phaseId==="selection")need(inspected.findings.filter(item=>!item.field.startsWith("sourceFiles.")&&!item.field.startsWith("editions.")).length===0,
        "Close actual customer selection/rights/host findings before accepting selection.");
      if(row.phaseId==="merchant")need(review.properties.every(row=>row.editions[0].state!=="UNREVIEWED"||row.disposition==="EXCEPTION_ACCEPTED"),
        "Receive each property's actual source outcomes or an explicit buyer exception.");
      if(["buyer","later-edition","operation","handover"].includes(row.phaseId))
        need(propertyReports.length>0&&propertyReports.every(row=>row.complete),"Every selected property needs an accepted outcome or the buyer's explicit exception.");
      if(row.phaseId==="later-edition")need(review.properties.every(row=>row.editions.every(value=>value.state!=="UNREVIEWED")||row.disposition==="EXCEPTION_ACCEPTED"),
        "Retain both authentic edition outcomes for each property.");
      if(row.phaseId==="operation"||row.phaseId==="handover")need(reopen.state==="ACCEPTED","Retain the actual accepted independent reopen.");
      if(row.phaseId==="handover")need(review.examples.length===5&&review.examples.every(row=>["ACCEPTED","NOT_APPLICABLE"].includes(row.state)),
        "The five customer-selected examples need their explicit results/dispositions.");
    }
    const evidence=unique([review.selectionSourceId,...row.sourceIds,...used]);
    const sourceIds=unique([...nativeSources(evidence,sources,true),reviewAttachment.id]),old=baselineObservations.get(row.checkId);
    const note=unique([old.note,row.note,"Property commissioning "+selection.id+" edition "+selection.edition+
      "; complete review retains every property, source outcome, example and exception."].filter(Boolean)).join("\n\n");
    need(note.length<=8000,"The original and new phase notes exceed the native 8,000-character field; retain full detail in the source and use a concise new note.");
    const next={...observations.get(row.checkId),state:row.state,operator:row.by,observedAt:row.at,note,
      sourceIds:unique([...old.sourceIds,...sourceIds]),workIds:unique([...old.workIds,...row.workIds]),
      purchaseIds:unique([...old.purchaseIds,...row.purchaseIds]),outcomeIds:unique([...old.outcomeIds,...row.outcomeIds])};
    observations.set(row.checkId,next);changes.push({phaseId:row.phaseId,checkId:row.checkId,from:old.state,to:row.state});
  }
  inputs.name="Property inspection receiving — "+selection.id+" / "+selection.edition;
  inputs.recipient=review.reviewer.recipient;inputs.environment=review.reviewer.environment;
  inputs.note=review.reviewer.note+"\n\nComplete original property review: "+reviewAttachment.id+"; SHA-256 "+reviewSha256+"; "+reviewBytes+" bytes.";
  need(inputs.note.length<=12000,"Keep the native complete receiving note within 12,000 characters.");
  inputs.observations=inputs.observations.map(row=>observations.get(row.id));
  return {schema:"stellar-forge.property-commissioning-return-preparation.v1",baseline:clone(nativeSeed.baseline),
    nativeSource:clone(nativeSeed.source),selectionSha256,reviewAttachment,selectionAttachment:clone(selectedSource),inputs,changes,properties:propertyReports,findings,
    sourceFiles:clone(review.sourceFiles),review:clone(review),qualification:
      "Prepared named observations only. The original Installation Return preview/save and owner KEEP/APPLY workflow determine native acceptance. No vendor, inspection, purchase, cash or grant record is created."};
}

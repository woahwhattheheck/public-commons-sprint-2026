/* MIT. Complete original relationship reading inside the Directory conformance operator. */
const SCHEMA="stellar-forge.directory-conformance-foreign-keys.v1";
const BUDGET=4194304;
const HASH=/^[0-9a-f]{64}$/;
const VIEWS={
 outcomes:{title:"Relationship outcomes",route:"foreign-keys",query:"conformance_foreign_keys",rowKind:"outcome",fileKind:"foreignKeys"},
 candidates:{title:"Original target candidates",route:"foreign-key-candidates",query:"conformance_foreign_key_candidates",rowKind:"candidate",fileKind:"foreignKeyCandidates"},
 matches:{title:"Every original match",route:"foreign-key-matches",query:"conformance_foreign_key_matches",rowKind:"match",fileKind:"foreignKeyMatches"},
 coverage:{title:"Declarations and coverage",fileKind:"foreignKeyCoverage"}
};
const FIELD_LABELS={table:"Table",state:"Outcome state",ruleId:"Original declaration",sourceId:"Original source",
 recordId:"Original record",groupId:"Target group",outcomeId:"Outcome ID",candidateId:"Candidate ID"};
const FILE_LABELS={foreignKeys:"Complete relationship outcomes",foreignKeyCandidates:"All original target candidates",
 foreignKeyMatches:"Every original match",foreignKeyCoverage:"Full declarations and coverage"};
const OUTCOME_STATES=["resolved","ambiguous","missing-target","null-reference","invalid-key","target-table-unavailable",
 "representation-not-tabular","unsupported-declaration","nonmatching-value"];
const CANDIDATE_STATES=["value","null","invalid","nonmatching","representation-not-tabular"];
const need=(condition,message)=>{if(!condition)throw new Error(message);};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export const directoryForeignKeyViews=Object.freeze(VIEWS);

export function createDirectoryForeignKeyWorkbench(ctx){
 const {S,el,button,panel,table,badge,api,download,showDialog,showRow,jsonView,saveJSON,pager,showError,short}=ctx;
 const count=value=>Number(value||0).toLocaleString();
 const route=(record,tail)=>"/api/directory/conformance/assessments/"+encodeURIComponent(record.id)+"/"+tail;
 const fileRoute=(record,kind)=>route(record,"files/"+kind);
 const code=value=>el("code",{class:"cell-sub",text:value==null?"":String(value)});
 const label=value=>String(value==null?"":value);
 function original(ref){
  if(!ref)return el("span",{class:"muted",text:"No original row is selected."});
  return el("div",{class:"foreign-key-original"},[
   el("strong",{text:ref.table||"Original source row"}),
   code(ref.nativeId==null?ref.recordId:ref.nativeId),
   code(ref.pointer||""),code(ref.memberName||""),
   ...(ref.sourceId&&ref.recordId?[button("Open original row",()=>showRow({
    sourceId:ref.sourceId,recordId:ref.recordId}),{kind:"small",test:"foreign-key-original-row"})]:[]),
   button("Full original reference",()=>showDialog("Original relationship source reference",jsonView(ref,true)),{kind:"small"})
  ]);
 }
 function components(value){
  const rows=value.components||[];
  return el("div",{},[
   el("p",{class:"muted",text:"The original physical cell or JSON value and its checking interpretation are retained separately. Open the original row for the complete source value."}),
   rows.length?table([
    {label:"Field",get:r=>el("div",{},[el("strong",{text:r.field}),code(r.originalPointer)])},
    {label:"Physical input",get:r=>jsonView(r.physical,true)},
    {label:"Interpretation",get:r=>el("div",{},[badge(r.state),
     ...(Object.hasOwn(r,"logicalNull")?[el("p",{text:"Logical null: "+String(r.logicalNull)})]:[]),
     ...(Object.hasOwn(r,"matchedMarker")?[el("div",{},[el("strong",{text:"Matched original missing marker"}),jsonView(r.matchedMarker,true)])]:[]),
     ...(Object.hasOwn(r,"logical")?[jsonView(r.logical,true)]:[]),
     ...(r.reason?[el("p",{text:r.reason})]:[]),
     ...(r.headerPositions?[code("Original header positions: "+r.headerPositions.join(", "))]:[])] )},
    {label:"Original field declaration",get:r=>jsonView(r.fieldDeclaration,true)}
   ],rows):el("p",{class:"empty",text:"This outcome has no interpreted tuple components."}),
   el("details",{},[el("summary",{text:"Complete exact key and component record"}),jsonView({
    keyJson:value.keyJson,keySha256:value.keySha256,components:value.components},true)])
  ]);
 }
 function complete(record,view,rows){
  return el("div",{class:"actions"},[
   button(FILE_LABELS[VIEWS[view].fileKind],()=>download(fileRoute(record,VIEWS[view].fileKind)),
    {kind:"small",test:"foreign-key-download-"+view}),
   ...(rows?[button("Save this complete page",()=>saveJSON(rows,
    "Directory_Foreign_Keys_"+record.id+"_"+view+"_Page_"+rows.offset+".json"),{kind:"small"})]:[])
  ]);
 }
 return async function foreignKeyWorkbench(record){
  const keys=Object.keys(FILE_LABELS),present=keys.filter(key=>record.files?.[key]);
  if(!present.length){
   if(record.family!=="hsds-3.3.1")return null;
   return panel("Original relationship assessment",[
    el("p",{class:"muted",text:"This saved assessment retains its original implementation edition and files. It has no declared tabular foreign-key results. Its original findings and history remain available above."}),
    el("p",{class:"help",text:"Use a separately selected assessment from the current engine to evaluate the original declarations; this view does not add results to the earlier record."})
   ]);
  }
  need(present.length===keys.length,"The saved relationship assessment must retain all four complete foreign-key files.");
  const summary=record.summary?.foreignKeys;
  need(summary&&typeof summary.implementationEdition==="string","The saved relationship assessment omitted its original implementation edition.");
  const definitions=S.catalogue?.conformanceCatalogue?.querySchemas;
  for(const view of Object.values(VIEWS))if(view.query)need(definitions?.[view.query]?.properties,
   "This installation needs the complete original foreign-key query catalogue.");
  const epoch=S.generation;
  const current=()=>S.generation===epoch&&S.section==="conformance"&&
   S.selected.conformanceTab==="assessments"&&S.selected.conformanceAssessment===record.id;
  const root=el("section",{class:"panel foreign-key-workbench","data-testid":"foreign-key-workbench",
    "data-foreign-key-assessment":record.id}),
   controls=el("form",{class:"foreign-key-filters","data-testid":"foreign-key-filters"}),
   body=el("div",{"data-testid":"foreign-key-results","aria-live":"polite"}),
   mode=el("select",{"aria-label":"Relationship view","data-testid":"foreign-key-view"},
    Object.entries(VIEWS).map(([value,view])=>el("option",{value,text:view.title}))),
   limit=el("input",{type:"number",min:1,max:250,step:1,value:"25","aria-label":"Relationship page size"}),
   stateValues=el("datalist",{id:"foreign-key-states-"+record.id}),
   fields={};
  for(const [key,title]of Object.entries(FIELD_LABELS)){
   fields[key]=el("input",{type:"text","aria-label":title,placeholder:title,"data-testid":"foreign-key-filter-"+key,
    ...(key==="state"?{list:stateValues.id}:{})});
  }
  let offset=0,generation=0,coverage=null;
  const memoryKey="foreignKeys:"+record.id;
  const memory=S.selected[memoryKey];
  if(memory&&VIEWS[memory.view]){
   mode.value=memory.view;
   for(const [key,value]of Object.entries(memory.filters||{}))if(fields[key])fields[key].value=String(value);
   if(Number.isSafeInteger(memory.limit)&&memory.limit>=1&&memory.limit<=250)limit.value=String(memory.limit);
  }
  const supported=()=>mode.value==="coverage"?{}:definitions[VIEWS[mode.value].query].properties;
  function filters(){
   const schema=supported(),values={};
   for(const [key,input]of Object.entries(fields)){
    if(!schema[key]||input.value==="")continue;
    const value=input.value,spec=schema[key],length=Array.from(value).length;
    need(length>=(spec.minLength||0)&&length<=(spec.maxLength||Infinity)&&
     (!spec.pattern||new RegExp(spec.pattern).test(value)),FIELD_LABELS[key]+" must match the original native filter format.");
    values[key]=value;
   }
   return values;
  }
  function fieldVisibility(){
   const spec=supported();
   for(const [key,input]of Object.entries(fields)){
    input.disabled=!Object.hasOwn(spec,key);
    input.closest("label").hidden=input.disabled;
    if(spec[key]?.maxLength)input.maxLength=spec[key].maxLength;
    if(spec[key]?.pattern)input.pattern=spec[key].pattern;
   }
   limit.disabled=mode.value==="coverage";
   limit.closest("label").hidden=limit.disabled;
   stateValues.replaceChildren(...(mode.value==="outcomes"?OUTCOME_STATES:
    mode.value==="candidates"?CANDIDATE_STATES:[]).map(value=>el("option",{value})));
  }
  async function select(view,values={}){
   need(VIEWS[view],"Select an original relationship view.");
   mode.value=view;offset=0;
   for(const [key,input]of Object.entries(fields))input.value=values[key]||"";
   fieldVisibility();await load();
  }
  function details(value,view){
   const actions=[button("Save complete record",()=>saveJSON(value,
    "Directory_Foreign_Key_"+value.kind+"_"+value.id+".json"),{kind:"small"})];
   if(value.kind==="outcome"){
    actions.push(button("Every matching original target",async()=>{document.querySelector("#record-dialog").close();
     await select("matches",{outcomeId:value.id});},{kind:"small"}));
    if(value.candidateGroupId)actions.push(button("Full target group",async()=>{document.querySelector("#record-dialog").close();
     await select("candidates",{groupId:value.candidateGroupId});},{kind:"small"}));
   }else if(value.kind==="candidate")actions.push(button("Every relationship using this candidate",async()=>{
    document.querySelector("#record-dialog").close();await select("matches",{candidateId:value.id});},{kind:"small"}));
   const content=[el("div",{class:"actions"},actions)];
   if(value.kind==="match")content.push(panel("Original child row",original(value.sourceRef)),
    panel("Original target row",original(value.targetRef)));
   else content.push(original(value.ref),components(value));
   if(value.kind==="outcome")content.push(panel("Original declaration and selected target coverage",[
    el("dl",{class:"record-meta"},[
     el("dt",{text:"Existence check"}),el("dd",{},badge(value.constraintOutcome)),
     el("dt",{text:"Identity resolution"}),el("dd",{},badge(value.resolutionOutcome)),
     el("dt",{text:"Matching original targets"}),el("dd",{text:count(value.candidateCount)})]),
    ...(value.nullPolicy?[el("p",{text:value.nullPolicy})]:[]),
    jsonView({requirement:value.requirement,source:value.source,targetCoverage:value.targetCoverage},true)]));
   content.push(el("details",{open:true},[el("summary",{text:"Complete retained relationship record"}),jsonView(value,true)]));
   showDialog(VIEWS[view].title,el("div",{class:"foreign-key-detail"},content));
  }
  function columns(view){
   if(view==="outcomes")return [
    {label:"Original child",get:r=>original(r.ref)},
    {label:"Declaration",get:r=>el("div",{},[el("strong",{text:r.table}),code(r.declarationId),
     button("Complete outcome",()=>details(r,view),{kind:"small",test:"foreign-key-outcome-detail"})])},
    {label:"Existence",get:r=>badge(r.constraintOutcome)},
    {label:"Resolution",get:r=>el("div",{},[badge(r.resolutionOutcome),code(r.state)])},
    {label:"Original targets",get:r=>el("div",{},[
     el("strong",{text:count(r.candidateCount)+" exact matches"}),
     button("Read every match",()=>select("matches",{outcomeId:r.id}),{kind:"small",test:"foreign-key-outcome-matches"}),
     ...(r.candidateGroupId?[button("Inspect target group",()=>select("candidates",{groupId:r.candidateGroupId}),{kind:"small"})]:[]),
     el("span",{class:"cell-sub",text:r.targetCoverage?
      (r.targetCoverage.establishedTabularCoverage?"Selected table coverage retained":"Target table outside selected tabular coverage"):
      "No tabular target coverage was assigned"})])}
   ];
   if(view==="candidates")return [
    {label:"Original target",get:r=>original(r.ref)},
    {label:"Interpretation",get:r=>el("div",{},[badge(r.state),el("span",{class:"cell-sub",text:r.representation}),
     button("Physical values and complete candidate",()=>details(r,view),{kind:"small",test:"foreign-key-candidate-detail"})])},
    {label:"Original group",get:r=>el("div",{},[code(r.groupId),code(r.id)])},
    {label:"Related matches",get:r=>button("Read every use",()=>select("matches",{candidateId:r.id}),
     {kind:"small",test:"foreign-key-candidate-matches"})}
   ];
   return [
    {label:"Original child",get:r=>original(r.sourceRef)},
    {label:"Original target",get:r=>original(r.targetRef)},
    {label:"Exact relationship",get:r=>el("div",{},[code(r.outcomeId),code(r.candidateId),
     button("Complete match",()=>details(r,view),{kind:"small",test:"foreign-key-match-detail"})])},
    {label:"Original declaration",get:r=>code(r.declarationId)}
   ];
  }
  async function loadCoverage(){
   if(coverage)return coverage;
   const declared=record.files.foreignKeyCoverage;
   need(Number.isSafeInteger(declared.bytes)&&declared.bytes<=BUDGET,
    "The complete coverage view must fit its native four-megabyte record bound; use the original complete file route.");
   const value=await api(fileRoute(record,"foreignKeyCoverage"));
   need(value?.schema===SCHEMA&&value.subjectId===record.subjectId&&value.subjectKind===record.subjectKind,
    "The complete coverage file belongs to a different original assessment subject.");
   for(const key of Object.keys(summary))need(same(value[key],summary[key]),
    "The original relationship summary differs from its complete coverage file: "+key);
   for(const key of ["declarations","targetGroups","tableDomains","selectedSources","selectedChildTables"])
    need(Array.isArray(value[key]),"The original complete coverage omitted "+key+".");
   coverage=value;return coverage;
  }
  function coverageBody(value){
   const policies=Object.entries(value.policy||{}).filter(([key,item])=>typeof item==="string"&&!key.toLowerCase().includes("source"));
   return el("div",{"data-testid":"foreign-key-coverage"},[
    el("p",{text:value.meaning}),
    complete(record,"coverage"),
    el("dl",{class:"record-meta"},[
     el("dt",{text:"Subject"}),el("dd",{},code(value.subjectKind+"/"+value.subjectId)),
     el("dt",{text:"Selected child tables"}),el("dd",{text:value.selectedChildTables.join(", ")}),
     el("dt",{text:"Original data package version"}),el("dd",{text:label(value.originalDatapackageVersion)}),
     el("dt",{text:"Implementation edition"}),el("dd",{},code(value.implementationEdition))]),
    panel("Declared relationships",[
     el("p",{class:"muted",text:"Every original declaration is shown, including repeated and unselected declarations. A declaration can have no rows in the chosen population."}),
     table([
      {label:"Original declaration",get:r=>el("div",{},[el("strong",{text:r.table}),code(r.source?.path),code(r.source?.pointer),code(r.id)])},
      {label:"Fields and target",get:r=>el("div",{},[jsonView({fields:r.fields,targetTable:r.targetTable,targetFields:r.targetFields},true)])},
      {label:"Selection",get:r=>el("div",{},[el("strong",{text:r.selected?"Selected":"Unselected"}),
       el("span",{class:"cell-sub",text:count(r.checkedOriginalRows)+" original row outcomes"}),
       ...(r.unsupportedReason?[el("p",{text:r.unsupportedReason})]:[])])},
      {label:"Outcomes",get:r=>el("div",{},[...Object.entries(r.outcomes||{}).filter(([,n])=>n).map(([state,n])=>
       el("span",{class:"cell-sub",text:state+": "+count(n)})),
       button("Read declaration outcomes",()=>select("outcomes",{ruleId:r.id}),{kind:"small"})])}
     ],value.declarations)
    ]),
    panel("Complete original target groups",[
     table([
      {label:"Target table",get:r=>el("div",{},[el("strong",{text:r.table}),jsonView(r.fields,true)])},
      {label:"Original group",get:r=>code(r.id)},
      {label:"Candidate interpretations",get:r=>el("div",{},Object.entries(r.candidateStates||{}).map(([state,n])=>
       el("span",{class:"cell-sub",text:state+": "+count(n)})))},
      {label:"Candidates",get:r=>button("Read complete group",()=>select("candidates",{groupId:r.id}),{kind:"small"})}
     ],value.targetGroups)
    ]),
    panel("Original table domains",[
     el("p",{class:"muted",text:"An explicit empty table and an omitted or unselected table retain different coverage. Original table pointers, ranges and row counts remain in each complete coverage record."}),
     table([
      {label:"Original source",get:r=>code(r.sourceId)},
      {label:"Table",get:r=>el("div",{},[el("strong",{text:r.table}),el("span",{class:"cell-sub",text:r.representation})])},
      {label:"Edition selection",get:r=>el("div",{},[
       badge(r.selected?"selected":"outside selected edition"),
       el("span",{class:"cell-sub",text:r.coverage||""})])},
      {label:"Original table rows",get:r=>r.tableRows===undefined||r.tableRows===null?
       el("span",{class:"muted",text:"No table row count declared"}):el("strong",{text:count(r.tableRows)})},
      {label:"Original member",get:r=>el("div",{},[code(r.memberName),code(r.memberSha256)])},
      {label:"Complete coverage",get:r=>button("Open original coverage record",()=>showDialog("Original table coverage",jsonView(r,true)),{kind:"small"})}
     ],value.tableDomains)
    ]),
    panel("Recorded interpretation",[
     el("dl",{class:"foreign-key-policies"},policies.flatMap(([key,item])=>[el("dt",{text:key}),el("dd",{text:item})])),
     el("details",{},[el("summary",{text:"Full original coverage JSON, sources and limits"}),jsonView(value,true)])
    ])
   ]);
  }
  async function load(){
   const own=++generation,view=mode.value,selection=filters(),pageLimit=Number(limit.value);
   need(Number.isSafeInteger(pageLimit)&&pageLimit>=1&&pageLimit<=250,"Choose a relationship page size from 1 to 250.");
   S.selected[memoryKey]={view,filters:selection,limit:pageLimit};
   body.setAttribute("aria-busy","true");
   try{
    if(view==="coverage"){
     const value=await loadCoverage();
     if(own===generation&&current()){
      body.replaceChildren(coverageBody(value));
      body.dataset.view="coverage";body.dataset.offset="0";delete body.dataset.total;
     }
     return;
    }
    const query=new URLSearchParams({...selection,offset:String(offset),limit:String(pageLimit)});
    const page=await api(route(record,VIEWS[view].route)+"?"+query);
    if(own!==generation||!current())return;
    need(page.assessmentId===record.id&&page.offset===offset&&page.limit===pageLimit&&
     Number.isSafeInteger(page.total)&&page.total>=0&&Array.isArray(page.rows)&&page.rows.length<=pageLimit&&
     page.byteBudget===BUDGET&&Number.isSafeInteger(page.bytes)&&page.bytes>=0&&page.bytes<=BUDGET,
     "The original relationship page has an incomplete identity or byte bound.");
    const end=offset+page.rows.length;
    need(end<=page.total&&(page.nextOffset===null?end===page.total:
     page.rows.length>0&&page.nextOffset===end&&end<page.total),"Follow the original contiguous relationship page.");
    need(page.rows.every(row=>row.schema===SCHEMA&&row.kind===VIEWS[view].rowKind&&HASH.test(row.id)),
     "The original relationship page contains a different record kind.");
    body.dataset.view=view;body.dataset.offset=String(page.offset);body.dataset.total=String(page.total);
    body.replaceChildren(el("p",{class:"muted","data-testid":"foreign-key-page-count",
     text:count(page.total)+" selected "+VIEWS[view].title.toLowerCase()+". This page retains "+count(page.rows.length)+" original records."}),
     complete(record,view,page),
     page.rows.length?table(columns(view),page.rows):el("p",{class:"empty",text:"No original relationship records match these filters."}),
     pager(page,async next=>{offset=next;await load();}));
   }finally{if(own===generation)body.removeAttribute("aria-busy");}
  }
  controls.append(el("label",{},["View",mode]),el("label",{},["Rows per page",limit]),
   ...Object.entries(fields).map(([key,input])=>el("label",{"data-foreign-key-filter":key},[FIELD_LABELS[key],input])),
   el("button",{type:"submit",text:"Apply relationship filters","data-testid":"foreign-key-filter-submit"}),
   button("Clear filters",()=>select(mode.value),{kind:"small"}),stateValues);
  controls.onsubmit=event=>{event.preventDefault();offset=0;load().catch(error=>{if(current())showError(error,body);});};
  mode.onchange=()=>{offset=0;fieldVisibility();load().catch(error=>{if(current())showError(error,body);});};
  const metrics=[["Original declarations",summary.declaredForeignKeys],["Selected declarations",summary.selectedDeclarations],
   ["Original outcomes",summary.outcomeRows],["Target candidates",summary.candidateRows],["Exact matches",summary.matchRows]];
  root.append(el("div",{class:"panel-heading"},[el("h2",{text:"Declared tabular relationships"}),
   button("Complete assessment package",()=>download(fileRoute(record,"package")),{kind:"small"})]),
   el("p",{class:"muted",text:"Read each original declaration, its selected child row and every exact target candidate. Existence and identity resolution remain separate; ambiguous matches are never reduced to one target."}),
   el("div",{class:"foreign-key-metrics"},metrics.map(([title,value])=>el("div",{class:"metric"},[
    el("span",{class:"eyebrow",text:title}),el("strong",{text:count(value)})]))),
   el("div",{class:"foreign-key-states"},Object.entries(summary.states||{}).map(([state,n])=>
    button(state+" · "+count(n),()=>select("outcomes",{state}),{kind:"small",test:"foreign-key-state-"+state}))),
   el("p",{class:"help",text:"Composite declarations in this original source: "+count(summary.declaredCompositeKeys)+
    "; selected: "+count(summary.selectedCompositeKeys)+". Source declarations determine this count."}),
   controls,body);
  fieldVisibility();await load();root.dataset.foreignKeysReady="true";return root;
 };
}

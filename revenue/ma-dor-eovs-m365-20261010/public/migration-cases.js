"use strict";
(function(){
"use strict";
const SCHEMA="commons.case-migration-browser-working-file.v1";
const tabs=[["datasets","Source mappings"],["plans","Destination plans"],["rehearsals","Rehearsals"],["reviews","Finding decisions"],["cutover","Cutover"],["records","All case records"]];
const fieldNames=["case_id","document_id","version_id","status","deleted","target_id","path","size_bytes","content_sha256","principals","label","modified_at"];
const kinds=["cases","documents","links"];
const states=["MATCH","DIFFERENT","UNKNOWN","AMBIGUOUS","MISSING","UNEXPECTED"];
let current=null;
const copy=value=>JSON.parse(JSON.stringify(value));
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const object=value=>value&&typeof value==="object"&&!Array.isArray(value);
const lines=value=>String(value||"").split(/\r?\n/).filter(x=>x!=="");
const ids=value=>lines(value).map(x=>x.trim()).filter(Boolean);
const pretty=value=>JSON.stringify(value,null,2);
const stable=value=>value===null||typeof value!=="object"?JSON.stringify(value):Array.isArray(value)?"["+value.map(stable).join(",")+"]":"{"+Object.keys(value).sort().map(key=>JSON.stringify(key)+":"+stable(value[key])).join(",")+"}";
function cleanMap(value,label){
  if(!object(value))throw new Error(label+" must be a JSON object.");
  return value;
}
function download(name,value){
  const url=URL.createObjectURL(new Blob([pretty(value)+"\n"],{type:"application/json"}));
  const anchor=document.createElement("a");anchor.href=url;anchor.download=name;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
function database(){
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open("migration-case-working-files",1);
    request.onupgradeneeded=()=>request.result.createObjectStore("workspaces",{keyPath:"workspaceId"});
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error||new Error("Working-file storage could not open."));
  });
}
async function loadSaved(workspaceId){
  const db=await database();
  try{return await new Promise((resolve,reject)=>{
    const tx=db.transaction("workspaces","readonly"),q=tx.objectStore("workspaces").get(workspaceId);let value;
    q.onsuccess=()=>{value=q.result;};tx.oncomplete=()=>resolve(value||null);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error("Working-file read stopped."));
  });}finally{db.close();}
}
async function commitSaved(workspaceId,revision,body){
  const db=await database();
  try{return await new Promise((resolve,reject)=>{
    const tx=db.transaction("workspaces","readwrite"),store=tx.objectStore("workspaces");let failure=null;
    const q=store.get(workspaceId);
    q.onsuccess=()=>{
      const previous=q.result;
      if((previous?.journalRevision||0)!==revision){failure=new Error("A different tab saved this working file. Download your current work, then load the saved edition before continuing.");tx.abort();return;}
      store.put({...body,workspaceId,journalRevision:revision+1});
    };
    tx.oncomplete=()=>resolve(revision+1);tx.onerror=()=>reject(failure||tx.error);tx.onabort=()=>reject(failure||tx.error||new Error("Working-file save stopped."));
  });}finally{db.close();}
}
function create(context){
  if(!current||current.workspaceId!==context.model.state.project.id){
    current={workspaceId:context.model.state.project.id,journalRevision:0,drafts:{},pending:{},history:[],selected:{},tab:"datasets",ready:false,error:null,queue:Promise.resolve(),c:context,host:null,generation:0,opening:null,draw:null};
  }
  const s=current;s.c=context;const c=context;
  const {el,input,area,select,field,button,linkButton,panel,heading,note,details,table,badge,jsonRecord,read,run,setNotice}=c;
  const root=el("div",{class:"stack case-desk"});s.host=root;const generation=++s.generation;s.draw=render;
  root.append(heading("Case and document migration","Map original records, review each destination at a declared cutoff, compare complete target captures, and retain the cutover decision."));
  if(!s.ready){
    root.append(note("Opening this workspace's saved case working file…"));
    if(!s.opening)s.opening=loadSaved(s.workspaceId).then(saved=>{
      if(current!==s||s.c.model.state.project.id!==s.workspaceId)return;
      if(saved){validateWorking(saved);s.journalRevision=saved.journalRevision;s.drafts=saved.drafts;s.pending=saved.pending;s.history=saved.history||[];s.selected=saved.selected;s.tab=saved.tab||"datasets";}
      adoptPending();s.ready=true;s.error=null;s.opening=null;s.draw();
    }).catch(error=>{
      if(current!==s)return;
      s.error=error;s.opening=null;
      s.host.append(note(error.message),button("Retry opening working file",()=>{s.ready=false;s.error=null;s.c.render();}));
    });
  }else render();
  function working(){return {schema:SCHEMA,workspaceId:s.workspaceId,drafts:copy(s.drafts),pending:copy(s.pending),history:copy(s.history),selected:copy(s.selected),tab:s.tab};}
  function validateWorking(value){
    if(!object(value)||value.schema!==SCHEMA||value.workspaceId!==s.workspaceId||!object(value.drafts)||!object(value.pending)||!object(value.selected))throw new Error("Choose a complete case working file for this exact workspace.");
    if(value.history!==undefined&&!Array.isArray(value.history))throw new Error("The complete retained attempt history must be an array.");
    if(value.tab&&!tabs.some(x=>x[0]===value.tab))throw new Error("The working file names an unsupported case view.");
    for(const [key,draft] of Object.entries(value.drafts)){
      if(!["dataset","plan","rehearsal","review","cutover"].includes(key)||!object(draft)||!object(draft.values)||!object(draft.extra))throw new Error("A saved case form is incomplete.");
      for(const v of Object.values(draft.values))if(typeof v!=="string"&&typeof v!=="boolean")throw new Error("Draft controls must retain their complete text or checked value.");
      const fields=draft.extra.fieldList;
      if(fields!==undefined&&(!Array.isArray(fields)||fields.length>128||new Set(fields).size!==fields.length||fields.some(v=>typeof v!=="string"||!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(v))))throw new Error("The saved mapping field list is invalid.");
      const tasks=draft.extra.taskKeys;
      if(tasks!==undefined&&(!Array.isArray(tasks)||tasks.length>1000||new Set(tasks).size!==tasks.length||tasks.some(v=>typeof v!=="string"||!/^[a-f0-9]{32}$/.test(v))))throw new Error("The saved cutover task list is invalid.");
    }
    for(const item of value.history||[])if(!object(item)||!object(item.request)||!object(item.request.payload)||!object(item.observation)||typeof item.reason!=="string")throw new Error("A preserved attempt is incomplete.");
    for(const [key,entry] of Object.entries(value.pending)){
      const r=entry?.request;
      if(!object(entry)||!object(r)||!object(r.payload)||typeof r.operation!=="string"||!/^case\.|^operation\.resume$/.test(r.operation)||typeof r.payload.operation_id!=="string"||!Number.isSafeInteger(r.payload.expected_revision)||typeof r.payload.actor!=="string")throw new Error("Working file contains an incomplete original request: "+key);
    }
  }
  function adoptPending(){
    for(const entry of Object.values(s.pending)){
      const r=entry.request,existing=c.model.pending.get(r.payload.operation_id);
      if(existing&&stable(existing)!==stable(r))throw new Error("An original request differs from this tab's retained request. Keep both working files for review.");
      c.model.pending.set(r.payload.operation_id,r);
    }
    for(const r of c.model.pending.values()){
      if((r.operation.startsWith("case.")||r.operation==="operation.resume")&&!Object.values(s.pending).some(entry=>entry.request.payload.operation_id===r.payload.operation_id)){
        s.pending["recovered:"+r.payload.operation_id]={request:copy(r)};
      }
    }
    c.savePending();
  }
  function persist(){
    const body=working();
    s.queue=s.queue.catch(()=>{}).then(async()=>{
      if(s.error)throw s.error;
      try{s.journalRevision=await commitSaved(s.workspaceId,s.journalRevision,body);}
      catch(error){s.error=error;throw error;}
    });
    return s.queue;
  }
  function autosave(){persist().catch(error=>setNotice(error.message+" Download the current working file to keep your edits.","error"));}
  function saveForm(key,form,extra){
    const values=Object.create(null);
    for(const node of form.querySelectorAll("input[name],select[name],textarea[name]")){
      if(node.type==="file")continue;
      values[node.name]=node.type==="checkbox"?node.checked:node.value;
    }
    s.drafts[key]={values,extra:extra?extra():{}};
  }
  function draftForm(key,content,label,build,extra,after){
    const form=el("form",{},el("div",{class:"form-grid"},content),el("div",{class:"actions"},el("button",{type:"submit",class:"primary"},label)));
    const values=s.drafts[key]?.values||{};
    for(const node of form.querySelectorAll("input[name],select[name],textarea[name]")){
      if(!own(values,node.name)||node.type==="file")continue;
      if(node.type==="checkbox")node.checked=values[node.name]===true;
      else node.value=String(values[node.name]??"");
    }
    form.addEventListener("input",()=>{saveForm(key,form,extra);autosave();});
    form.addEventListener("change",()=>{saveForm(key,form,extra);autosave();});
    form.addEventListener("submit",event=>{event.preventDefault();run(async()=>{
      saveForm(key,form,extra);await persist();
      const data=Object.fromEntries(new FormData(form).entries());
      const request=await build(data,form);
      const result=await command(key,request.operation,request.payload);
      if(after)await after(result);
      else {s.selected.last={operation:request.operation,result};await persist();render();}
    });});
    return form;
  }
  async function command(key,operation,payload){
    if(s.pending[key])throw new Error("This form has an original request awaiting a result. Inspect or continue it in the working-file panel before creating another.");
    if(operation!=="operation.resume"&&Object.keys(s.pending).length)throw new Error("Inspect or recover the original unanswered case request before recording another case change.");
    await s.queue;if(s.error)throw s.error;
    try{
      const result=await c.mutate(operation,payload,{prepared:async request=>{
        s.pending[key]={request:copy(request)};await persist();
      }});
      delete s.pending[key];await persist();return result;
    }catch(error){
      if(error.code==="REVISION_CONFLICT"){delete s.pending[key];await persist();}
      throw error;
    }
  }
  function basicForm(content,label,action){
    const form=el("form",{},el("div",{class:"form-grid"},content),el("div",{class:"actions"},el("button",{type:"submit"},label)));
    form.addEventListener("submit",event=>{event.preventDefault();run(()=>action(Object.fromEntries(new FormData(form).entries()),form));});
    return form;
  }
  function exactId(label,name,value="",help="Use the exact retained record ID. All records below searches the complete history."){
    return field(label,input(name,value,{required:true}),help);
  }
  function optionalId(label,name,value=""){return field(label,input(name,value),"Optional exact retained predecessor ID.");}
  function rawView(title,value){return linkButton(title,()=>jsonRecord(title,value));}
  function exportsFor(kind,id){
    return el("div",{class:"actions"},["ndjson","csv"].map(format=>el("a",{href:"/api/exports?kind="+encodeURIComponent("case."+kind)+"&id="+encodeURIComponent(id)+"&format="+format,download:"case-"+kind+"-"+id+"."+format},"Download complete "+format.toUpperCase())));
  }
  function paging(page,move){
    if(!Array.isArray(page.rows)||!Number.isSafeInteger(page.total)||!Number.isSafeInteger(page.offset)||!Number.isSafeInteger(page.limit)||page.limit<1)throw new Error("The retained page is incomplete.");
    return c.pageControls(page,move);
  }
  async function readRecord(kind,id,target){
    if(!id)throw new Error("Choose a retained "+kind+" ID.");
    const record=await read("case."+kind+".get",{id});
    s.selected[kind]=id;await persist();
    target.replaceChildren(heading(record.title||"Retained "+kind,"ID "+record.id),exportsFor(kind,id));
    if(kind==="dataset"){
      target.append(note("Scope "+record.scope_id+" · Namespace "+record.identity_namespace+" · "+record.side+" / "+(record.destination||"source")+" · "+record.row_count+" original occurrences"),
        rawView("Original source and mapping",record),el("div",{class:"stack",id:"case-dataset-rows"}));
      await rows(record.id,target.lastChild,0,"");
    }else if(kind==="plan"){
      target.append(policy(record.policy),rawView("Frozen source selection",record));
      const area=el("div",{class:"stack"});target.append(area);await items("plan",id,area,{},0);
    }else if(kind==="rehearsal"){
      target.append(metrics(record.summary),rawView("Original target selection and summary",record));
      const area=el("div",{class:"stack"});
      target.append(basicForm([field("Record family",select("kind",[["","All"],...kinds.map(x=>[x,x])],"")),field("Finding state",select("status",[["","All"],...states.map(x=>[x,x])],"")),field("Find identity or record",input("query"))],"Filter findings",data=>items("rehearsal",id,area,data,0)),area);
      await items("rehearsal",id,area,{},0);
    }else if(kind==="review"){
      target.append(note(record.disposition+" · "+record.reason),rawView("Complete finding decision",record));
    }else{
      target.append(note(record.decision+" · Owner: "+record.owner),note(record.reason),
        table("Cutover tasks",[{label:"Task",render:r=>r.title},{label:"Owner",render:r=>r.owner},{label:"State",render:r=>badge(r.status)},{label:"Evidence and note",render:r=>[r.note||"",rawView("Complete task",r)]}],record.tasks||[]),
        rawView("Complete cutover decision, exceptions and reviews",record));
    }
  }
  function policy(value){
    return note("Cutoff "+value.cutoff_at+" · Live statuses: "+pretty(value.live_statuses)+" · Closed statuses: "+pretty(value.closed_statuses)+" · Source capture allowance: "+(value.max_snapshot_age_seconds??0)+" seconds · Document identity: "+value.document_identity+" · Shared documents: "+value.multi_case_policy);
  }
  function metrics(summary){
    return el("div",{class:"case-metrics"},Object.entries(summary?.counts||summary||{}).filter(([,v])=>typeof v==="number").map(([key,value])=>el("div",{class:"metric"},el("strong",{},value),el("span",{},key))));
  }
  async function rows(id,target,offset,query){
    const page=await read("case.dataset.rows",{id,offset,limit:50,...(query?{query}:{})});
    target.replaceChildren(projections(page.rows),paging(page,next=>rows(id,target,next,query)));
  }
  function projections(values){
    return table("Original projected occurrences",[
      {label:"Occurrence",render:r=>[el("span",{class:"mono"},r.id),el("br"),"Original row "+r.source_row_id]},
      {label:"Identity",render:r=>pretty(r.key)},
      {label:"Values",render:r=>pretty(r.values)},
      {label:"Findings",render:r=>pretty(r.issues)},
      {label:"Review",render:r=>[rawView("Full projection",r),linkButton("Original row",async()=>jsonRecord("Original source row",await read("row.get",{id:r.source_row_id})))]}
    ],values);
  }
  async function items(kind,id,target,filters,offset){
    const page=await read("case."+kind+".items",{id,offset,limit:50,...Object.fromEntries(Object.entries(filters).filter(([,v])=>v!==""))});
    target.replaceChildren(table("Complete paged "+kind+" findings",[
      {label:"State",render:r=>badge(r.status)},
      {label:"Identity / family",render:r=>[r.kind,el("br"),el("span",{class:"mono"},pretty(r.key))]},
      {label:"Destination",render:r=>pretty(r.expected_destinations)},
      {label:"Checks",render:r=>Object.entries(r.checks||{}).map(([k,v])=>k+": "+v.status).join(" · ")},
      {label:"Review",render:r=>el("div",{class:"row-actions"},linkButton("Inspect sources and checks",()=>finding(r)),kind==="rehearsal"?linkButton("Record decision",async()=>{
        s.drafts.review={values:{rehearsal_id:id,item_id:r.id,disposition:"rework",reason:"",assigned_to:"",parent_review_id:"",evidence_row_ids:""},extra:{}};
        s.tab="reviews";await persist();render();
      }):null)}
    ],page.rows),paging(page,next=>items(kind,id,target,filters,next)));
  }
  function finding(item){
    jsonRecord("Case migration finding "+item.id,item);
    const target=document.querySelector("#record-body"),refs=new Set();
    for(const key of ["source_rows","observed_rows","reported_rows"]){
      for(const row of item[key]||[])if(row.source_row_id)refs.add(row.source_row_id);
    }
    target.prepend(el("div",{class:"actions"},[...refs].map(id=>linkButton("Original "+id,async()=>jsonRecord("Original source occurrence",await read("row.get",{id}))))));
  }
  function datasetView(){
    const key="dataset",saved=s.drafts[key]?.extra||{};
    let fieldList=Array.isArray(saved.fieldList)?saved.fieldList.slice():fieldNames.slice();
    const mapRows=el("div",{class:"case-map-list"});
    function addMap(name){
      const index=fieldList.indexOf(name),prefix="mapping_"+index+"_";
      const row=el("div",{class:"case-map-row"},
        field("Map "+name,input(prefix+"enabled","",{type:"checkbox"})),
        field("Selector type",select(prefix+"type",[["column","Exact CSV heading"],["pointer","JSON pointer"]],"column")),
        field("Original field",input(prefix+"selector"),"Keep the original heading or RFC 6901 pointer exactly."));
      row.dataset.field=name;mapRows.append(row);
    }
    fieldList.forEach(addMap);
    const custom=input("custom_field");
    const customControls=el("div",{class:"full"},field("Additional comparison field",custom,"Use a canonical name beginning with a letter; letters, digits and underscores only."),
      button("Add comparison field",()=>{
        const name=custom.value;
        if(!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name)||fieldList.includes(name))throw new Error("Enter a unique canonical field name.");
        fieldList.push(name);addMap(name);custom.value="";saveForm(key,form,()=>({fieldList}));autosave();
      }));
    function config(data){
      const columns=Object.create(null);
      for(let i=0;i<fieldList.length;i++){
        if(data["mapping_"+i+"_enabled"]===undefined)continue;
        const type=data["mapping_"+i+"_type"],value=data["mapping_"+i+"_selector"];
        if(type==="column"&&!value)throw new Error("Supply the exact CSV heading for "+fieldList[i]+".");
        if(type==="pointer"&&value!==""&&!value.startsWith("/"))throw new Error("JSON pointers begin with / or are empty for the original object.");
        columns[fieldList[i]]={[type]:value};
      }
      const value_maps=cleanMap(JSON.parse(data.value_maps||"{}"),"Value mappings");
      return {source_id:data.source_id,kind:data.kind,side:data.side,destination:data.side==="source"?null:data.destination,columns,value_maps};
    }
    const preview=el("div",{class:"stack"});
    const form=draftForm(key,[
      field("Dataset title",input("title","",{required:true})),
      exactId("Retained original source","source_id","","Import the complete file in Sources first. Use its retained source ID."),
      field("Record family",select("kind",kinds,"cases")),field("Source role",select("side",[["source","Original source"],["target","Independent target capture"],["receipt","Loader's reported result"]],"source")),
      field("Target destination",select("destination",["dynamics","sharepoint","archive"],"dynamics"),"Applied only to target captures and loader receipts."),
      optionalId("Previous mapping edition","parent_dataset_id"),
      el("div",{class:"full"},note("Enable each field you explicitly mapped. Original IDs, dates and values remain available alongside every converted value."),mapRows),
      customControls,
      field("Exact value mappings (JSON)",area("value_maps","{}"),'Optional exact conversions, such as {"deleted":{"Y":true,"N":false}}. Business identity crosswalks must be explicit.',true),
      field("Mapping review note",area("review_note","",{required:true}),null,true)
    ],"Save complete dataset mapping",data=>({operation:"case.dataset.create",payload:{...config(data),title:data.title,review_note:data.review_note,...(data.parent_dataset_id?{parent_dataset_id:data.parent_dataset_id}:{})}}),()=>({fieldList}),async result=>{
      s.selected.dataset=result.id;await persist();await readRecord("dataset",result.id,preview);
    });
    async function previewPage(offset){
      const data=Object.fromEntries(new FormData(form).entries()),page=await read("case.dataset.preview",{...config(data),offset,limit:25});
      preview.replaceChildren(note("Mapping preview · "+page.total+" original occurrences"),rawView("Original source capture and coverage",page.source),projections(page.rows),paging(page,next=>previewPage(next)));
    }
    form.append(el("div",{class:"actions"},button("Preview mapped occurrences",()=>previewPage(0)),button("Open source intake",()=>c.go("sources"))));
    const browse=el("div",{class:"stack"});
    return el("div",{class:"stack"},panel("Interpret original source fields",form,preview),
      panel("Saved dataset",basicForm([exactId("Dataset ID","id",s.selected.dataset||"")],"Open complete dataset",data=>readRecord("dataset",data.id,browse)),browse));
  }
  function planView(){
    const results=el("div",{class:"stack"});
    const form=draftForm("plan",[
      field("Destination plan title",input("title","",{required:true})),
      optionalId("Previous destination plan","parent_plan_id"),
      field("Original source dataset IDs",area("source_dataset_ids","",{required:true}),"One ID per line. Include all selected case, document and relationship populations.",true),
      field("Cutoff timestamp",input("cutoff_at","",{required:true}),"Use the agreed cutoff with its explicit time-zone offset."),
      field("Permitted source capture age, seconds",input("max_snapshot_age_seconds","0",{type:"number",min:"0",step:"1",required:true}),"Zero requires the capture at the cutoff. Older captures remain findings beyond this allowance."),
      field("Exact live case status values",area("live_statuses","",{required:true}),"One original status per line. Whitespace and case remain exact."),
      field("Exact closed case status values",area("closed_statuses","",{required:true}),"One original status per line; values must be separate from live statuses."),
      field("Document identity",select("document_identity",[["document_id","Document ID"],["document_version","Document ID and version"]],"document_id")),
      field("Documents linked across destinations",select("multi_case_policy",[["require_single_destination","Require one destination"],["copy_per_destination","Explicit copy at each destination"]],"require_single_destination")),
      field("Case fields to compare",area("case_checks"),"One explicitly mapped field per line. Identity, destination, relationships and lifecycle are always checked."),
      field("Document fields to compare",area("document_checks"),"One explicitly mapped field per line, for example content_sha256, size_bytes or principals."),
      field("Policy review note",area("review_note","",{required:true}),null,true),
      field("Additional plan note",area("note"),null,true)
    ],"Freeze complete destination plan",data=>{
      const age=Number(data.max_snapshot_age_seconds);
      if(!Number.isSafeInteger(age)||age<0)throw new Error("Capture age must be a nonnegative whole number of seconds.");
      return {operation:"case.plan.create",payload:{title:data.title,source_dataset_ids:ids(data.source_dataset_ids),cutoff_at:data.cutoff_at,max_snapshot_age_seconds:age,live_statuses:lines(data.live_statuses),closed_statuses:lines(data.closed_statuses),document_identity:data.document_identity,multi_case_policy:data.multi_case_policy,checks:{cases:ids(data.case_checks),documents:ids(data.document_checks)},review_note:data.review_note,note:data.note,...(data.parent_plan_id?{parent_plan_id:data.parent_plan_id}:{})}};
    },null,async result=>{s.selected.plan=result.id;await persist();await readRecord("plan",result.id,results);});
    return el("div",{class:"stack"},panel("Cutoff and routing policy",note("Live cases go to Dynamics and their documents to SharePoint. Closed cases and their documents go to the designated archive. The plan retains unknown statuses, unresolved links and duplicate identities for review."),form),
      panel("Frozen destination plan",basicForm([exactId("Plan ID","id",s.selected.plan||"")],"Open complete plan",data=>readRecord("plan",data.id,results)),results));
  }
  function rehearsalView(){
    const results=el("div",{class:"stack"}),comparison=el("div",{class:"stack"});
    const form=draftForm("rehearsal",[
      field("Rehearsal title",input("title","",{required:true})),exactId("Frozen destination plan","plan_id",s.selected.plan||""),
      field("Independent target dataset IDs",area("target_dataset_ids","",{required:true}),"One ID per line. Select the actual Dynamics, SharePoint and archive captures needed for the complete population.",true),
      field("Loader receipt dataset IDs",area("receipt_dataset_ids"),"Optional separate reports of attempted loads. Target comparisons use the independent target captures.",true),
      optionalId("Previous rehearsal","parent_rehearsal_id"),
      field("Rehearsal note",area("note","",{required:true}),"Record this run's purpose, capture and correction context.",true)
    ],"Reconcile complete selected populations",data=>({operation:"case.rehearsal.create",payload:{title:data.title,plan_id:data.plan_id,target_dataset_ids:ids(data.target_dataset_ids),receipt_dataset_ids:ids(data.receipt_dataset_ids),note:data.note,...(data.parent_rehearsal_id?{parent_rehearsal_id:data.parent_rehearsal_id}:{})}}),null,async result=>{
      s.selected.rehearsal=result.id;await persist();await readRecord("rehearsal",result.id,results);
    });
    async function compare(data,offset){
      const page=await read("case.rehearsal.compare",{before_id:data.before_id,after_id:data.after_id,offset,limit:50});
      comparison.replaceChildren(table("Complete paged rehearsal transitions",[
        {label:"Identity / family",render:r=>[r.kind,el("br"),pretty(r.key)]},
        {label:"Transition",render:r=>pretty(r.transition)},
        {label:"Before",render:r=>rawView("Earlier original result",r.before)},
        {label:"After",render:r=>rawView("Later original result",r.after)}
      ],page.rows),paging(page,next=>compare(data,next)));
    }
    return el("div",{class:"stack"},panel("Full target reconciliation",form),
      panel("Rehearsal findings",basicForm([exactId("Rehearsal ID","id",s.selected.rehearsal||"")],"Open complete rehearsal",data=>readRecord("rehearsal",data.id,results)),results),
      panel("Compare rehearsals and cutoff changes",basicForm([exactId("Earlier rehearsal","before_id"),exactId("Later rehearsal","after_id",s.selected.rehearsal||"")],"Compare full populations",data=>compare(data,0)),comparison));
  }
  function reviewView(){
    const results=el("div",{class:"stack"});
    const form=draftForm("review",[
      exactId("Rehearsal ID","rehearsal_id",s.selected.rehearsal||""),exactId("Exact finding ID","item_id"),
      field("Decision",select("disposition",[["rework","Rework"],["waiting_evidence","Waiting for evidence"],["accepted_variance","Accepted variance"],["withdrawn","Withdrawn"]],"rework")),
      field("Assigned to",input("assigned_to")),optionalId("Previous decision","parent_review_id"),
      field("Decision reason",area("reason","",{required:true}),null,true),
      field("Supporting original row IDs",area("evidence_row_ids"),"One retained source occurrence ID per line.",true)
    ],"Retain finding decision",data=>({operation:"case.review.create",payload:{rehearsal_id:data.rehearsal_id,item_id:data.item_id,disposition:data.disposition,reason:data.reason,evidence_row_ids:ids(data.evidence_row_ids),...(data.assigned_to?{assigned_to:data.assigned_to}:{}),...(data.parent_review_id?{parent_review_id:data.parent_review_id}:{})}}),null,async result=>{
      s.selected.review=result.id;await persist();await readRecord("review",result.id,results);
    });
    return el("div",{class:"stack"},panel("Decision on an exact retained finding",form),
      panel("Original decision",basicForm([exactId("Decision ID","id",s.selected.review||"")],"Open decision",data=>readRecord("review",data.id,results)),results));
  }
  function cutoverView(){
    const key="cutover",taskList=el("div",{class:"entry-list"});
    let taskKeys=Array.isArray(s.drafts[key]?.extra?.taskKeys)?s.drafts[key].extra.taskKeys.slice():[];
    function addTask(key){
      const prefix="task_"+key+"_";
      const row=el("div",{class:"entry"},el("div",{class:"form-grid"},
        field("Task ID",input(prefix+"id","",{required:true})),field("Task title",input(prefix+"title","",{required:true})),
        field("Task owner",input(prefix+"owner","",{required:true})),field("Task state",select(prefix+"status",["pending","complete","blocked"],"pending")),
        field("Evidence file SHA-256 values",area(prefix+"evidence"),"One original retained file digest per line. Completed tasks require evidence.",true),
        field("Task note",area(prefix+"note"),null,true)));
      row.append(button("Remove this draft task",()=>{taskKeys=taskKeys.filter(x=>x!==key);row.remove();saveForm("cutover",form,()=>({taskKeys}));autosave();}));
      taskList.append(row);
    }
    taskKeys.forEach(addTask);
    const results=el("div",{class:"stack"});
    const form=draftForm(key,[
      field("Cutover decision title",input("title","",{required:true})),exactId("Reconciled rehearsal","rehearsal_id",s.selected.rehearsal||""),
      field("Recorded decision",select("decision",[["hold","Hold"],["ready_for_review","Ready for review"],["approved","Approved"]],"ready_for_review")),
      field("Decision owner",input("owner","",{required:true})),
      field("Window start",input("window_start"),"Explicit time-zone timestamp, or leave both window fields blank."),
      field("Window end",input("window_end"),"Explicit time-zone timestamp, or leave both window fields blank."),
      optionalId("Earlier cutover decision","parent_cutover_id"),
      field("Selected accepted-variance decision IDs",area("review_ids"),"Only exact decisions against findings in this rehearsal.",true),
      field("Decision reason",area("reason","",{required:true}),null,true),
      field("Recovery and rollback instructions",area("rollback","",{required:true}),"Name the actual recovery boundary, responsible operator and supported actions.",true),
      el("div",{class:"full"},el("h3",{},"Cutover tasks"),taskList,button("Add cutover task",()=>{
        const k=crypto.randomUUID().replaceAll("-","");taskKeys.push(k);addTask(k);saveForm(key,form,()=>({taskKeys}));autosave();
      }))
    ],"Record cutover decision",data=>({operation:"case.cutover.create",payload:{
      title:data.title,rehearsal_id:data.rehearsal_id,decision:data.decision,reason:data.reason,owner:data.owner,
      window_start:data.window_start||null,window_end:data.window_end||null,rollback:data.rollback,
      review_ids:ids(data.review_ids),...(data.parent_cutover_id?{parent_cutover_id:data.parent_cutover_id}:{}),
      tasks:taskKeys.map(k=>{const p="task_"+k+"_";return {id:data[p+"id"],title:data[p+"title"],owner:data[p+"owner"],status:data[p+"status"],evidence_file_sha256s:ids(data[p+"evidence"]),note:data[p+"note"]};})
    }}),()=>({taskKeys}),async result=>{s.selected.cutover=result.id;await persist();await readRecord("cutover",result.id,results);});
    return el("div",{class:"stack"},panel("Release readiness and recorded decision",note("Record the accountable operator's decision against the actual rehearsal, selected exceptions, migration window and recovery plan."),form),
      panel("Retained cutover edition",basicForm([exactId("Cutover ID","id",s.selected.cutover||"")],"Open complete decision",data=>readRecord("cutover",data.id,results)),results));
  }
  function catalogue(){
    const results=el("div",{class:"stack"}),opened=el("div",{class:"stack"});
    async function load(data,offset){
      const page=await read("case.list",{kind:data.kind,offset,limit:50,...(data.query?{query:data.query}:{})});
      results.replaceChildren(table("All retained case "+data.kind+" records",[
        {label:"Record",render:r=>[el("strong",{},r.title||r.id),el("div",{class:"mono"},r.id)]},
        {label:"Scope and selection",render:r=>[r.scope_id||r.source?.context?.scope_id||"",el("br"),r.kind||r.decision||r.disposition||"",el("br"),r.side||""]},
        {label:"Review",render:r=>linkButton("Open complete record",()=>readRecord(data.kind,r.id,opened))}
      ],page.rows),paging(page,next=>load(data,next)));
    }
    return panel("Complete retained case history",basicForm([field("Record kind",select("kind",["dataset","plan","rehearsal","review","cutover"],"dataset")),field("Search records",input("query"))],"Search complete history",data=>load(data,0)),results,opened);
  }
  function verifyOriginal(operation,request){
    if(operation.id!==request.payload.operation_id||operation.operation!==request.operation||stable(operation.request)!==stable(request.payload))throw new Error("The retained operation differs from the selected original request. Preserve this working file and inspect both records.");
  }
  async function finishPending(key,entry){
    const operation=await read("operation.get",{id:entry.request.payload.operation_id});
    verifyOriginal(operation,entry.request);
    jsonRecord("Original case operation",operation);
    if(operation.status==="SUCCEEDED"){
      if(s.pending[key]?.request.payload.operation_id===entry.request.payload.operation_id)delete s.pending[key];
      c.model.pending.delete(entry.request.payload.operation_id);c.savePending();await persist();await c.refresh(false);
      setNotice("Recovered the original case operation and saved result.");
    }
    return operation;
  }
  async function preserveAttempt(key,entry,reason){
    if(!reason.trim())throw new Error("Enter the reason for preserving this attempt and revising its draft.");
    let observation;
    try{
      observation=await read("operation.get",{id:entry.request.payload.operation_id});
      verifyOriginal(observation,entry.request);
      if(observation.status==="SUCCEEDED"){await finishPending(key,entry);render();return;}
      if(observation.status!=="INTERRUPTED")throw new Error("The original request has not stopped. Inspect its retained result before revising this draft.");
    }catch(error){
      if(error.code!=="OPERATION_NOT_FOUND")throw error;
      throw new Error("The original request has not been found yet. Retry that same request or inspect it again before revising the draft.");
    }
    if(s.pending[key]?.request.payload.operation_id!==entry.request.payload.operation_id)throw new Error("This working-file request changed. Inspect the current selection.");
    s.history.push({key,request:copy(entry.request),observation:copy(observation),reason,observed_at:new Date().toISOString()});
    delete s.pending[key];await persist();
    c.model.pending.delete(entry.request.payload.operation_id);c.savePending();await c.refresh(false);
    setNotice("Original attempt preserved. Review and correct the retained draft before submitting its next edition.");render();
  }
  function workingPanel(){
    const file=input("working_file","",{type:"file",accept:".json,application/json"});
    const reason=input("resume_reason");
    const pending=table("Original case requests awaiting a confirmed result",[
      {label:"Form / request",render:([key,entry])=>[key,el("div",{class:"mono"},entry.request.payload.operation_id)]},
      {label:"Actions",render:([key,entry])=>el("div",{class:"row-actions"},
        linkButton("Inspect result",()=>finishPending(key,entry)),
        linkButton("Retry original request",async()=>{
          const result=await c.api("/api/operations",entry.request);
          if(s.pending[key]?.request.payload.operation_id===entry.request.payload.operation_id)delete s.pending[key];
          c.model.pending.delete(entry.request.payload.operation_id);c.savePending();await persist();await c.refresh(false);
          jsonRecord("Recovered original operation result",result);render();
        }),
        linkButton("Continue interrupted request",async()=>{
          if(!reason.value.trim())throw new Error("Enter a continuation reason below.");
          const original=await read("operation.get",{id:entry.request.payload.operation_id});
          verifyOriginal(original,entry.request);
          if(original.status==="SUCCEEDED"){await finishPending(key,entry);render();return;}
          await command("resume:"+entry.request.payload.operation_id,"operation.resume",{target_operation_id:entry.request.payload.operation_id,reason:reason.value});
          await finishPending(key,entry);render();
        }),
        linkButton("Preserve attempt and revise draft",()=>preserveAttempt(key,entry,reason.value)),
        rawView("Complete original request",entry.request))}
    ],Object.entries(s.pending),"Every submitted case request has a confirmed response.");
    return details("Working file, drafts and request recovery",
      note("Draft mappings, policies, decisions and original requests are saved for workspace "+s.workspaceId+". Complete imported files and accepted records remain in the workspace handover."),
      s.error?note(s.error.message):null,
      el("div",{class:"actions"},
        button("Download current working file",()=>download("case-migration-working-file.json",working())),
        button("Save current drafts",async()=>{await persist();setNotice("Complete case working file saved.");}),
        button("Load saved working file",async()=>{
          await s.queue.catch(()=>{});
          const saved=await loadSaved(s.workspaceId);if(!saved)throw new Error("No saved working file is available.");
          validateWorking(saved);s.drafts=saved.drafts;s.pending=saved.pending;s.history=saved.history||[];s.selected=saved.selected;s.tab=saved.tab||"datasets";s.journalRevision=saved.journalRevision;s.error=null;adoptPending();render();setNotice("Saved working file loaded.");
        })),
      field("Restore downloaded working file",file,"Choose a complete working file from this same workspace."),
      button("Restore selected working file",async()=>{
        if(!file.files.length)throw new Error("Choose the complete working file.");
        const value=JSON.parse(await file.files[0].text());validateWorking(value);
        for(const [key,entry] of Object.entries(s.pending))if(stable(value.pending[key])!==stable(entry))throw new Error("The selected file would drop or replace an unanswered original request. Preserve and reconcile that request first.");
        s.drafts=value.drafts;s.pending=value.pending;s.history=[...new Map([...s.history,...(value.history||[])].map(entry=>[stable(entry),entry])).values()];s.selected=value.selected;s.tab=value.tab||"datasets";adoptPending();await persist();render();setNotice("Complete selected working file restored.");
      }),pending,field("Continuation or revision reason",reason,"Used to continue an original interrupted request or to preserve a stopped attempt while revising its draft."),
      table("Preserved attempts",[
        {label:"Original request",render:r=>r.request.payload.operation_id},
        {label:"Reason",render:r=>r.reason},
        {label:"Original observation",render:r=>rawView("Complete attempt and retained result",r)}
      ],s.history,"No stopped attempts have been preserved in this working file."));
  }
  function render(){
    if(s.host!==root||s.generation!==generation)return;
    const body={datasets:datasetView,plans:planView,rehearsals:rehearsalView,reviews:reviewView,cutover:cutoverView,records:catalogue}[s.tab]();
    root.replaceChildren(heading("Case and document migration","Map original records, review each destination at a declared cutoff, compare complete target captures, and retain the cutover decision."),
      el("nav",{class:"case-navigation","aria-label":"Case migration workflow"},tabs.map(([key,label])=>el("button",{type:"button","aria-current":key===s.tab?"page":null,onclick:()=>run(async()=>{s.tab=key;await persist();render();})},label))),
      workingPanel(),body);
  }
  return root;
}
window.MigrationCases={create};
})();

"use strict";
(function(){
"use strict";
const SCHEMA="commons.register-migration-browser-working-file.v1";
const tabs=[["datasets","Source mappings"],["plans","Destination plans"],["rehearsals","Rehearsals"],["reviews","Finding decisions"],["cutover","Cutover"],["records","All register records"]];
const fieldNames=[];
const kinds=["record","reference","control"];
const states=["MATCH","DIFFERENT","UNKNOWN","AMBIGUOUS","MISSING","UNEXPECTED"];
let current=null;
const targetReads=new WeakMap();
function nextRead(target){const id=(targetReads.get(target)||0)+1;targetReads.set(target,id);return ()=>targetReads.get(target)===id&&target.isConnected;}
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
    const request=indexedDB.open("migration-register-working-files",1);
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
  root.append(heading("Register migration and cutover","Map original records, review each destination at a declared cutoff, compare complete target captures, and retain the cutover decision."));
  if(!s.ready){
    root.append(note("Opening this workspace's saved register working file…"));
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
    if(!object(value)||value.schema!==SCHEMA||value.workspaceId!==s.workspaceId||!object(value.drafts)||!object(value.pending)||!object(value.selected))throw new Error("Choose a complete register working file for this exact workspace.");
    if(value.history!==undefined&&!Array.isArray(value.history))throw new Error("The complete retained attempt history must be an array.");
    if(value.tab&&!tabs.some(x=>x[0]===value.tab))throw new Error("The working file names an unsupported register view.");
    for(const [key,draft] of Object.entries(value.drafts)){
      if(!["dataset","plan","rehearsal","review","cutover"].includes(key)||!object(draft)||!object(draft.values)||!object(draft.extra))throw new Error("A saved register form is incomplete.");
      for(const v of Object.values(draft.values))if(typeof v!=="string"&&typeof v!=="boolean")throw new Error("Draft controls must retain their complete text or checked value.");
      const fields=draft.extra.fieldList;
      if(fields!==undefined&&(!Array.isArray(fields)||fields.length>128||new Set(fields).size!==fields.length||fields.some(v=>typeof v!=="string"||!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(v))))throw new Error("The saved mapping field list is invalid.");
      for(const group of ["destinations","references","controls"]){const members=draft.extra[group];if(members!==undefined&&(!Array.isArray(members)||members.length>1000||new Set(members).size!==members.length||members.some(v=>typeof v!=="string"||!/^[a-f0-9]{32}$/.test(v))))throw Error("Saved plan rows are incomplete.");}
      const tasks=draft.extra.taskKeys;
      if(tasks!==undefined&&(!Array.isArray(tasks)||tasks.length>1000||new Set(tasks).size!==tasks.length||tasks.some(v=>typeof v!=="string"||!/^[a-f0-9]{32}$/.test(v))))throw new Error("The saved cutover task list is invalid.");
    }
    for(const item of value.history||[])if(!object(item)||!object(item.request)||!object(item.request.payload)||!object(item.observation)||typeof item.reason!=="string")throw new Error("A preserved attempt is incomplete.");
    for(const [key,entry] of Object.entries(value.pending)){
      const r=entry?.request;
      if(!object(entry)||!object(r)||!object(r.payload)||typeof r.operation!=="string"||!new Set(["register.dataset.create","register.plan.create","register.rehearsal.create","register.review.create","register.cutover.create","operation.resume"]).has(r.operation)||typeof r.payload.operation_id!=="string"||!Number.isSafeInteger(r.payload.expected_revision)||typeof r.payload.actor!=="string")throw new Error("Working file contains an incomplete original request: "+key);
    }
  }
  function adoptPending(){
    for(const entry of Object.values(s.pending)){
      const r=entry.request,existing=c.model.pending.get(r.payload.operation_id);
      if(existing&&stable(existing)!==stable(r))throw new Error("An original request differs from this tab's retained request. Keep both working files for review.");
      c.model.pending.set(r.payload.operation_id,r);
    }
    for(const r of c.model.pending.values()){
      if((r.operation.startsWith("register.")||(r.operation==="operation.resume"&&Object.values(s.pending).some(e=>e.request.payload.operation_id===r.payload.target_operation_id)))&&!Object.values(s.pending).some(entry=>entry.request.payload.operation_id===r.payload.operation_id)){
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
      if(node.type==="checkbox")node.checked=values[node.name]===true;else node.value=String(values[node.name]??"");
    }
    for(const type of ["input","change"])form.addEventListener(type,()=>{saveForm(key,form,extra);autosave();});
    form.addEventListener("submit",event=>{
      event.preventDefault();if(c.model.busy)return;
      let request;try{saveForm(key,form,extra);request=copy(build(Object.fromEntries(new FormData(form).entries()),form));}
      catch(error){setNotice(error.message,"error");return;}
      const workspace=s.workspaceId;
      run(async()=>{
        await persist();if(c.model.state.project.id!==workspace)throw Error("The selected workspace changed before this original request.");
        const result=await command(key,request.operation,request.payload);
        if(after)await after(result);
        else{s.selected.last={operation:request.operation,result};await persist();render();}
      });
    });
    return form;
  }
  async function command(key,operation,payload){
    if(s.pending[key])throw new Error("This form has an original request awaiting a result. Inspect or continue it in the working-file panel before creating another.");
    if(operation!=="operation.resume"&&Object.keys(s.pending).length)throw new Error("Inspect or recover the original unanswered register request before recording another register change.");
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
    return el("div",{class:"actions"},["ndjson","csv"].map(format=>el("a",{href:"/api/exports?kind="+encodeURIComponent("register."+kind)+"&id="+encodeURIComponent(id)+"&format="+format,download:"case-"+kind+"-"+id+"."+format},"Download complete "+format.toUpperCase())));
  }
  function paging(page,move){
    if(!Array.isArray(page.rows)||!Number.isSafeInteger(page.total)||!Number.isSafeInteger(page.offset)||!Number.isSafeInteger(page.limit)||page.limit<1)throw new Error("The retained page is incomplete.");
    return c.pageControls(page,move);
  }
  async function readRecord(kind,id,target){
    if(!id)throw Error("Choose the exact retained "+kind+" ID.");
    const valid=nextRead(target),record=await read("register."+kind+".get",{id});if(!valid())return;
    s.selected[kind]=id;await persist();if(!valid())return;
    target.replaceChildren(heading(record.title||"Retained "+kind,"ID "+record.id),exportsFor(kind,id));
    if(kind==="dataset"){
      target.append(note("Register "+record.register+" · "+record.side+" / "+record.system+" · Scope "+record.scope_id+" · Namespace "+record.identity_namespace+" · "+record.row_count+" original occurrences"),rawView("Complete original source, typed mapping and coverage",record));
      const area=el("div",{class:"stack"});target.append(basicForm([field("Find original occurrence",input("query"))],"Find in complete register",data=>rows(id,area,0,data.query)),area);await rows(id,area,0,"");
    }else if(kind==="plan"||kind==="rehearsal"){
      target.append(metrics(record.summary),rawView("Complete frozen "+kind+" and original selections",record));if(record.policy)target.append(policy(record.policy));
      const area=el("div",{class:"stack"});
      target.append(basicForm([field("Register",input("register")),field("Finding state",select("status",[["","All"],...states.map(x=>[x,x])],"")),field("Finding type",select("kind",[["","All"],...kinds.map(x=>[x,x])],"")),field("Find exact identity",input("query"))],"Filter complete findings",data=>{if(kind==="plan")delete data.kind;return items(kind,id,area,data,0);}),area);
      await items(kind,id,area,{},0);
    }else if(kind==="review"){
      target.append(note(record.disposition+" · "+record.reason),rawView("Complete original finding and decision",record),button("Prepare successor decision",async()=>{
        s.drafts.review={values:{title:"",rehearsal_id:record.rehearsal_id,item_id:record.item_id,disposition:record.disposition,reason:"",parent_review_id:record.id,evidence_row_ids:(record.evidence_rows||[]).map(r=>r.row_id||r.source_row_id||r.id).filter(Boolean).join("\n"),note:""},extra:{}};
        s.tab="reviews";await persist();render();
      }));
    }else target.append(note(record.decision+" · Acceptance owner: "+record.acceptance_owner),note(record.reason),metrics(record.summary),rawView("Complete cutover review, selected exceptions and unresolved findings",record));
  }
  function policy(value){
    return details("Complete destination and control policy",note("Cutoff "+value.cutoff_at+" · Source age allowance "+(value.max_snapshot_age_seconds??0)+" seconds"),el("pre",{},pretty(value)));
  }
  function metrics(summary){
    return el("div",{class:"case-metrics"},Object.entries(summary?.counts||summary||{}).filter(([,v])=>typeof v==="number").map(([key,value])=>el("div",{class:"metric"},el("strong",{},value),el("span",{},key))));
  }
  async function rows(id,target,offset,query){
    const valid=nextRead(target),page=await read("register.dataset.rows",{id,offset,limit:50,...(query?{query}:{})});if(!valid())return;
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
    const valid=nextRead(target),page=await read("register."+kind+".items",{id,offset,limit:50,...Object.fromEntries(Object.entries(filters).filter(([,v])=>v!==""))});if(!valid())return;
    target.replaceChildren(note(page.total+" complete findings"),table("Complete paged "+kind+" findings",[
      {label:"State",render:r=>badge(r.status)},
      {label:"Register / identity",render:r=>[r.register,el("br"),r.details?.type==="population"?"Population coverage":r.kind,el("br"),el("span",{class:"mono"},pretty(r.key))]},
      {label:"Checks",render:r=>pretty(r.checks)},
      {label:"Original detail",render:r=>el("div",{class:"row-actions"},linkButton("Inspect sources and complete checks",()=>finding(r)),kind==="rehearsal"?linkButton("Record decision",async()=>{
        s.drafts.review={values:{title:"",rehearsal_id:id,item_id:r.id,disposition:"rework",reason:"",parent_review_id:"",evidence_row_ids:"",note:""},extra:{}};
        s.tab="reviews";await persist();render();
      }):null)}
    ],page.rows),paging(page,next=>items(kind,id,target,filters,next)));
  }
  function finding(item){
    jsonRecord("Register migration finding "+item.id,item);
    const target=document.querySelector("#record-body"),refs=new Set();
    for(const key of ["source_rows","target_rows"]){
      for(const row of item[key]||[])if(row.source_row_id)refs.add(row.source_row_id);
    }
    target.prepend(el("div",{class:"actions"},[...refs].map(id=>linkButton("Original "+id,async()=>jsonRecord("Original source occurrence",await read("row.get",{id}))))));
  }
  function datasetView(){
    const key="dataset",saved=s.drafts[key]?.extra||{},mapRows=el("div",{class:"case-map-list"}),preview=el("div",{class:"stack"});
    let fieldList=Array.isArray(saved.fieldList)?saved.fieldList.slice():[];
    function addMap(name){
      const prefix="mapping_"+fieldList.indexOf(name)+"_";
      mapRows.append(el("div",{class:"register-field-row"},el("h4",{},name),el("div",{class:"form-grid"},
        field("Include field",input(prefix+"enabled","",{type:"checkbox"})),
        field("Original selector",select(prefix+"selectorType",[["column","Exact CSV heading"],["pointer","JSON pointer"]],"column")),
        field("Original heading or pointer",input(prefix+"selector"),"Keep the exact heading. A JSON pointer may be empty for the whole original object."),
        field("Value type",select(prefix+"valueType",["text","decimal","date","datetime","boolean","json"],"text")),
        field("Required value",input(prefix+"required","",{type:"checkbox"})),
        field("Identity order",input(prefix+"keyOrder","",{type:"number",min:"1",step:"1"}),"Blank excludes this field from the logical key. Ordered key fields must be text."))));
    }
    fieldList.forEach(addMap);
    const custom=input("custom_field"),customControls=el("div",{class:"full"},field("Canonical field name",custom,"Choose the field name used in this migration. Letters, digits and underscores, beginning with a letter."),
      button("Add mapped field",()=>{const name=custom.value;if(!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name)||fieldList.includes(name)||fieldList.length>=128)throw Error("Enter a distinct valid canonical field name.");fieldList.push(name);addMap(name);custom.value="";saveForm(key,form,()=>({fieldList}));autosave();}));
    function config(data){
      const fields=Object.create(null),keys=[];
      for(let i=0;i<fieldList.length;i++){
        const pre="mapping_"+i+"_";if(data[pre+"enabled"]===undefined)continue;
        const type=data[pre+"selectorType"],selector=data[pre+"selector"];
        if(type==="column"&&!selector)throw Error("Supply the complete original heading for "+fieldList[i]+".");
        if(type==="pointer"&&selector!==""&&!selector.startsWith("/"))throw Error("Use the exact RFC6901 pointer.");
        fields[fieldList[i]]={selector:{[type]:selector},type:data[pre+"valueType"],required:data[pre+"required"]!==undefined};
        const order=data[pre+"keyOrder"];if(order!==""){if(!/^[1-9][0-9]*$/.test(order)||fields[fieldList[i]].type!=="text")throw Error("Key order must be a positive integer on a text field.");keys.push({name:fieldList[i],order:Number(order)});}
      }
      if(!Object.keys(fields).length||!keys.length||new Set(keys.map(x=>x.order)).size!==keys.length)throw Error("Map at least one field and a distinct ordered text identity.");
      return {source_id:data.source_id,register:data.register,system:data.system,side:data.side,fields,key_fields:keys.sort((a,b)=>a.order-b.order).map(x=>x.name),value_maps:cleanMap(JSON.parse(data.value_maps||"{}"),"Exact value maps")};
    }
    const form=draftForm(key,[
      field("Dataset title",input("title","",{required:true})),exactId("Retained original source","source_id","","Import the full original inventory in Sources, then use its retained source ID."),
      field("Register name",input("register","",{required:true}),"One exact family identifier chosen for this migration."),
      field("Original system name",input("system","",{required:true}),"The actual source or target system label."),
      field("Observation side",select("side",[["source","Original source"],["target","Independent target capture"]],"source")),
      optionalId("Earlier mapping edition","parent_dataset_id"),
      el("div",{class:"full"},mapRows),customControls,
      field("Exact value maps (JSON)",area("value_maps","{}"),"Explicit conversions only. Every original value stays in the retained source and projected occurrence.",true),
      field("Mapping review note",area("review_note","",{required:true}),null,true),
      field("Additional note",area("note"),null,true)
    ],"Save complete mapped register",data=>({operation:"register.dataset.create",payload:{...config(data),title:data.title,review_note:data.review_note,note:data.note,...(data.parent_dataset_id?{parent_dataset_id:data.parent_dataset_id}:{})}}),()=>({fieldList}),async result=>{s.selected.dataset=result.id;await persist();await readRecord("dataset",result.id,preview);});
    async function previewPage(offset,frozen){
      const selected=frozen||config(Object.fromEntries(new FormData(form).entries())),valid=nextRead(preview);
      const page=await read("register.dataset.preview",{...selected,offset,limit:50});if(!valid())return;
      preview.replaceChildren(note("Preview: "+page.total+" original occurrences"),rawView("Complete selected configuration",page.configuration),projections(page.rows),paging(page,next=>previewPage(next,selected)));
    }
    form.append(el("div",{class:"actions"},button("Preview full mapped population",()=>previewPage(0)),button("Open original source intake",()=>c.go("sources"))));
    const browse=el("div",{class:"stack"});
    return el("div",{class:"stack"},panel("Typed source and target registers",form,preview),panel("Retained mapping edition",basicForm([exactId("Dataset ID","id",s.selected.dataset||"")],"Open original dataset",data=>readRecord("dataset",data.id,browse)),browse));
  }
  function planView(){
    const key="plan",results=el("div",{class:"stack"}),saved=s.drafts[key]?.extra||{};
    const groups={destinations:[],references:[],controls:[]},holders=Object.fromEntries(Object.keys(groups).map(k=>[k,el("div",{class:"entry-list"})]));
    for(const kind of Object.keys(groups))groups[kind]=Array.isArray(saved[kind])?saved[kind].slice():[];
    function entry(kind,id){
      const p=kind+"_"+id+"_";let controls=[];
      if(kind==="destinations")controls=[
        field("Register",input(p+"register","",{required:true})),field("Expected target system",input(p+"system","",{required:true})),
        field("Compared fields",area(p+"checks"),"One mapped nonkey field per line. Blank selects all mapped nonkey fields.",true)];
      if(kind==="references")controls=[
        field("Rule ID",input(p+"id","",{required:true})),field("From register",input(p+"register","",{required:true})),
        field("From fields",area(p+"fields","",{required:true}),"Ordered field names, one per line."),field("To register",input(p+"to_register","",{required:true})),
        field("Referenced fields",area(p+"to_fields","",{required:true}),"Matching ordered target identity fields, one per line."),
        field("Required relation",input(p+"required","",{type:"checkbox",checked:true})),
        field("Cardinality",select(p+"cardinality",[["one","Exactly one"],["many","One or more"]],"one"))];
      if(kind==="controls")controls=[
        field("Control ID",input(p+"id","",{required:true})),field("Register",input(p+"register","",{required:true})),
        field("Decimal measures",area(p+"measure_fields","",{required:true}),"One mapped exact decimal field per line. Each measure is summed separately."),
        field("Unit fields",area(p+"unit_fields","",{required:true}),"One explicitly mapped text field per line, such as the original currency field."),
        field("Group fields",area(p+"group_fields"),"Optional mapped account/period fields; one per line.")];
      const row=el("div",{class:"entry"},el("div",{class:"form-grid"},controls));
      row.append(button("Remove draft "+kind.slice(0,-1),()=>{groups[kind]=groups[kind].filter(x=>x!==id);row.remove();saveForm(key,form,()=>copy(groups));autosave();}));holders[kind].append(row);
    }
    for(const kind of Object.keys(groups))for(const id of groups[kind])entry(kind,id);
    function section(kind,title){return el("div",{class:"full"},el("h3",{},title),holders[kind],button("Add "+title.toLowerCase(),()=>{const id=crypto.randomUUID().replaceAll("-","");groups[kind].push(id);entry(kind,id);saveForm(key,form,()=>copy(groups));autosave();}));}
    const form=draftForm(key,[
      field("Plan title",input("title","",{required:true})),optionalId("Earlier plan edition","parent_plan_id"),
      field("Original source dataset IDs",area("source_dataset_ids","",{required:true}),"One immutable source dataset ID per line. Include every selected register and dependent identity population.",true),
      field("Cutoff timestamp",input("cutoff_at","",{required:true}),"Full ISO timestamp with explicit UTC offset."),
      field("Permitted source age in seconds",input("max_snapshot_age_seconds","0",{type:"number",min:"0",step:"1",required:true}),"Capture older than this interval remains an explicit finding."),
      section("destinations","Target destinations"),section("references","Relationship rules"),section("controls","Exact unit and group controls"),
      field("Plan review note",area("review_note","",{required:true}),null,true),field("Additional note",area("note"),null,true)
    ],"Save source-bound destination plan",data=>{
      const destinations=Object.create(null),checks=Object.create(null);
      for(const id of groups.destinations){const p="destinations_"+id+"_",register=data[p+"register"];if(own(destinations,register))throw Error("Select one target destination per register.");destinations[register]=data[p+"system"];if(ids(data[p+"checks"]).length)checks[register]=ids(data[p+"checks"]);}
      if(!Object.keys(destinations).length)throw Error("Add every register's target destination.");
      const references=groups.references.map(id=>{const p="references_"+id+"_";return {id:data[p+"id"],register:data[p+"register"],fields:ids(data[p+"fields"]),to_register:data[p+"to_register"],to_fields:ids(data[p+"to_fields"]),required:data[p+"required"]!==undefined,cardinality:data[p+"cardinality"]};});
      const controls=groups.controls.map(id=>{const p="controls_"+id+"_";return {id:data[p+"id"],register:data[p+"register"],measure_fields:ids(data[p+"measure_fields"]),unit_fields:ids(data[p+"unit_fields"]),group_fields:ids(data[p+"group_fields"])};});
      const age=Number(data.max_snapshot_age_seconds);if(!Number.isSafeInteger(age)||age<0)throw Error("Source age must be a nonnegative integer.");
      return {operation:"register.plan.create",payload:{title:data.title,source_dataset_ids:ids(data.source_dataset_ids),cutoff_at:data.cutoff_at,max_snapshot_age_seconds:age,destinations,checks,references,controls,review_note:data.review_note,note:data.note,...(data.parent_plan_id?{parent_plan_id:data.parent_plan_id}:{})}};
    },()=>copy(groups),async result=>{s.selected.plan=result.id;await persist();await readRecord("plan",result.id,results);});
    return el("div",{class:"stack"},panel("Complete source selection and destination policy",form),panel("Frozen plan",basicForm([exactId("Plan ID","id",s.selected.plan||"")],"Open complete plan",data=>readRecord("plan",data.id,results)),results));
  }
  function rehearsalView(){
    const results=el("div",{class:"stack"}),comparison=el("div",{class:"stack"});
    const form=draftForm("rehearsal",[
      field("Rehearsal title",input("title","",{required:true})),exactId("Frozen plan ID","plan_id",s.selected.plan||""),
      field("Independent target dataset IDs",area("target_dataset_ids","",{required:true}),"One complete target observation per retained dataset ID. Include each selected register.",true),
      optionalId("Earlier rehearsal","parent_rehearsal_id"),
      field("Rehearsal review note",area("review_note","",{required:true}),"Describe the observed target capture and purpose of this comparison.",true),
      field("Additional note",area("note"),null,true)
    ],"Reconcile every selected register",data=>({operation:"register.rehearsal.create",payload:{title:data.title,plan_id:data.plan_id,target_dataset_ids:ids(data.target_dataset_ids),review_note:data.review_note,note:data.note,...(data.parent_rehearsal_id?{parent_rehearsal_id:data.parent_rehearsal_id}:{})}}),null,async result=>{s.selected.rehearsal=result.id;await persist();await readRecord("rehearsal",result.id,results);});
    async function compare(data,offset){
      const valid=nextRead(comparison),page=await read("register.rehearsal.compare",{before_id:data.before_id,after_id:data.after_id,offset,limit:50});if(!valid())return;
      comparison.replaceChildren(note("Comparing "+page.before_id+" to "+page.after_id+" · "+page.total+" complete transitions"),table("Register rehearsal transitions",[
        {label:"Register / identity",render:r=>[r.register,el("br"),r.kind,el("br"),pretty(r.key)]},
        {label:"Transition",render:r=>pretty(r.transition)},
        {label:"Before",render:r=>rawView("Complete original earlier result",r.before)},
        {label:"After",render:r=>rawView("Complete original later result",r.after)}
      ],page.rows),paging(page,next=>compare(data,next)));
    }
    return el("div",{class:"stack"},panel("Independent target reconciliation",form),
      panel("Rehearsal findings",basicForm([exactId("Rehearsal ID","id",s.selected.rehearsal||"")],"Open complete rehearsal",data=>readRecord("rehearsal",data.id,results)),results),
      panel("Compare whole rehearsals",basicForm([exactId("Earlier rehearsal","before_id"),exactId("Later rehearsal","after_id",s.selected.rehearsal||"")],"Compare all retained transitions",data=>compare(data,0)),comparison));
  }
  function reviewView(){
    const results=el("div",{class:"stack"}),form=draftForm("review",[
      field("Decision title",input("title","",{required:true})),exactId("Rehearsal ID","rehearsal_id",s.selected.rehearsal||""),exactId("Original finding ID","item_id"),
      field("Disposition",select("disposition",[["rework","Rework"],["waiting_evidence","Waiting for evidence"],["accepted_variance","Accepted variance"],["withdrawn","Withdrawn"]],"rework")),
      optionalId("Current earlier decision","parent_review_id"),
      field("Reason",area("reason","",{required:true}),null,true),
      field("Supporting original row IDs",area("evidence_row_ids"),"One exact retained source occurrence per line.",true),field("Additional note",area("note"),null,true)
    ],"Retain the finding decision",data=>({operation:"register.review.create",payload:{title:data.title,rehearsal_id:data.rehearsal_id,item_id:data.item_id,disposition:data.disposition,reason:data.reason,evidence_row_ids:ids(data.evidence_row_ids),note:data.note,...(data.parent_review_id?{parent_review_id:data.parent_review_id}:{})}}),null,async result=>{s.selected.review=result.id;await persist();await readRecord("review",result.id,results);});
    return el("div",{class:"stack"},panel("Review an exact retained finding",form),panel("Recorded decision",basicForm([exactId("Review ID","id",s.selected.review||"")],"Open complete review",data=>readRecord("review",data.id,results)),results));
  }
  function cutoverView(){
    const results=el("div",{class:"stack"}),form=draftForm("cutover",[
      field("Cutover review title",input("title","",{required:true})),
      field("Complete rehearsal IDs",area("rehearsal_ids",s.selected.rehearsal||"",{required:true}),"One immutable full rehearsal ID per line. Preserve their exact source scope and identity namespace.",true),
      field("Recorded decision",select("decision",[["hold","Hold"],["ready_for_review","Ready for review"],["approved","Approved"]],"ready_for_review")),
      field("Acceptance owner",input("acceptance_owner","",{required:true}),"The actual named human or role responsible for this local review."),
      field("Current accepted-variance review IDs",area("accepted_review_ids"),"Only explicit current reviews of exact findings in these rehearsals. One ID per line.",true),
      optionalId("Earlier cutover review","parent_cutover_id"),field("Reason",area("reason","",{required:true}),null,true),
      field("Cutover and recovery note",area("note"),"Record the selected run, actual operational recovery boundary and continuation instructions.",true)
    ],"Record the complete cutover review",data=>({operation:"register.cutover.create",payload:{title:data.title,rehearsal_ids:ids(data.rehearsal_ids),decision:data.decision,reason:data.reason,acceptance_owner:data.acceptance_owner,accepted_review_ids:ids(data.accepted_review_ids),note:data.note,...(data.parent_cutover_id?{parent_cutover_id:data.parent_cutover_id}:{})}}),null,async result=>{s.selected.cutover=result.id;await persist();await readRecord("cutover",result.id,results);});
    return el("div",{class:"stack"},panel("Cutover review",note("Record the accountable review against the selected complete rehearsals and current accepted exceptions. The full unresolved findings remain attached."),form),panel("Retained cutover edition",basicForm([exactId("Cutover ID","id",s.selected.cutover||"")],"Open complete cutover",data=>readRecord("cutover",data.id,results)),results));
  }
  function catalogue(){
    const results=el("div",{class:"stack"}),opened=el("div",{class:"stack"});
    async function load(data,offset){
      const valid=nextRead(results),page=await read("register.list",{kind:data.kind,offset,limit:50});if(!valid())return;
      results.replaceChildren(table("All retained register "+data.kind+" records",[
        {label:"Record",render:r=>[el("strong",{},r.title||r.id),el("div",{class:"mono"},r.id)]},
        {label:"Scope / register",render:r=>[r.scope_id||"",el("br"),r.register||r.decision||r.disposition||"",el("br"),r.side||""]},
        {label:"Review",render:r=>linkButton("Open complete record",()=>readRecord(data.kind,r.id,opened))}
      ],page.rows),paging(page,next=>load(data,next)));
    }
    return panel("Complete register history",basicForm([field("Record kind",select("kind",["dataset","plan","rehearsal","review","cutover"],"dataset"))],"Browse every retained record",data=>load(data,0)),results,opened);
  }
  function verifyOriginal(operation,request){
    if(operation.id!==request.payload.operation_id||operation.operation!==request.operation||stable(operation.request)!==stable(request.payload))throw new Error("The retained operation differs from the selected original request. Preserve this working file and inspect both records.");
  }
  async function finishPending(key,entry){
    const operation=await read("operation.get",{id:entry.request.payload.operation_id});
    verifyOriginal(operation,entry.request);
    jsonRecord("Original register operation",operation);
    if(operation.status==="SUCCEEDED"){
      if(s.pending[key]?.request.payload.operation_id===entry.request.payload.operation_id)delete s.pending[key];
      c.model.pending.delete(entry.request.payload.operation_id);c.savePending();await persist();await c.refresh(false);
      setNotice("Recovered the original register operation and saved result.");
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
    const pending=table("Original register requests awaiting a confirmed result",[
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
    ],Object.entries(s.pending),"Every submitted register request has a confirmed response.");
    return details("Working file, drafts and request recovery",
      note("Draft mappings, policies, decisions and original requests are saved for workspace "+s.workspaceId+". Complete imported files and accepted records remain in the workspace handover."),
      s.error?note(s.error.message):null,
      el("div",{class:"actions"},
        button("Download current working file",()=>download("register-migration-working-file.json",working())),
        button("Save current drafts",async()=>{await persist();setNotice("Complete register working file saved.");}),
        button("Load saved working file",async()=>{
          await s.queue.catch(()=>{});
          const saved=await loadSaved(s.workspaceId);if(!saved)throw new Error("No saved working file is available.");
          validateWorking(saved);s.drafts=saved.drafts;s.pending=saved.pending;s.history=saved.history||[];s.selected=saved.selected;s.tab=saved.tab||"datasets";s.journalRevision=saved.journalRevision;s.error=null;adoptPending();render();setNotice("Saved working file loaded.");
        })),
      field("Restore downloaded working file",file,"Choose a complete working file from this same workspace."),
      button("Restore selected working file",async()=>{
        if(!file.files.length)throw new Error("Choose the complete working file.");
        const selectedFile=file.files[0];const value=JSON.parse(await selectedFile.text());validateWorking(value);
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
    root.replaceChildren(heading("Register migration and cutover","Map original records, review each destination at a declared cutoff, compare complete target captures, and retain the cutover decision."),
      el("nav",{class:"case-navigation","aria-label":"Register migration workflow"},tabs.map(([key,label])=>el("button",{type:"button","aria-current":key===s.tab?"page":null,onclick:()=>run(async()=>{s.tab=key;await persist();render();})},label))),
      workingPanel(),body);
  }
  return root;
}
window.MigrationRegisters={create};
})();

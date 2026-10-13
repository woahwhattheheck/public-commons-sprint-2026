"use strict";
(function(){
"use strict";
const SCHEMA="commons.adviser-migration-browser-working-file.v1";
const tabs=[["programmes","Migration programmes"],["work","Reconstruction work"],["releases","Release review"],["records","Complete history"]];
const fieldNames=[];
const kinds=["record","reference","control"];
const states=["MATCH","DIFFERENT","UNKNOWN","AMBIGUOUS","MISSING","UNEXPECTED"];
let current=null;
const workspaceStates=new Map();
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
    const request=indexedDB.open("migration-adviser-working-files",1);
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
    current=workspaceStates.get(context.model.state.project.id)||{workspaceId:context.model.state.project.id,journalRevision:0,drafts:{},pending:{},history:[],selected:{},tab:"programmes",ready:false,error:null,queue:Promise.resolve(),c:context,host:null,generation:0,opening:null,draw:null};
    workspaceStates.set(current.workspaceId,current);
  }
  const s=current;s.c=context;const c=context;
  const {el,input,area,select,field,button,linkButton,panel,heading,note,details,table,badge,jsonRecord,read,run,setNotice}=c;
  const root=el("div",{class:"stack case-desk"});s.host=root;const generation=++s.generation;s.draw=render;
  root.append(heading("Adviser migration commissioning","Review original migration scope, assign excluded reconstruction work, inspect returned target evidence, and retain the complete handover."));
  if(!s.ready){
    root.append(note("Opening this workspace's saved adviser working file…"));
    if(!s.opening)s.opening=loadSaved(s.workspaceId).then(saved=>{
      if(current!==s||s.c.model.state.project.id!==s.workspaceId)return;
      if(saved){validateWorking(saved);s.journalRevision=saved.journalRevision;s.drafts=saved.drafts;s.pending=saved.pending;s.history=saved.history||[];s.selected=saved.selected;s.tab=saved.tab||"programmes";}
      adoptPending();s.ready=true;s.error=null;s.opening=null;s.draw();
    }).catch(error=>{
      if(current!==s)return;
      s.error=error;s.opening=null;
      s.host.append(note(error.message),button("Retry opening working file",()=>{s.ready=false;s.error=null;s.c.render();}));
    });
  }else render();
  function working(){return {schema:SCHEMA,workspaceId:s.workspaceId,drafts:copy(s.drafts),pending:copy(s.pending),history:copy(s.history),selected:copy(s.selected),tab:s.tab};}
  function validateWorking(value){
    if(!object(value)||value.schema!==SCHEMA||value.workspaceId!==s.workspaceId||!object(value.drafts)||!object(value.pending)||!object(value.selected))throw new Error("Choose a complete adviser working file for this exact workspace.");
    if(value.history!==undefined&&!Array.isArray(value.history))throw new Error("The complete retained attempt history must be an array.");
    if(value.tab&&!tabs.some(x=>x[0]===value.tab))throw new Error("The working file names an unsupported adviser view.");
    for(const [key,draft] of Object.entries(value.drafts)){
      if(!["programme","work","release"].includes(key)||!object(draft)||!object(draft.values)||!object(draft.extra))throw new Error("A saved adviser form is incomplete.");
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
      if(!object(entry)||!object(r)||!object(r.payload)||typeof r.operation!=="string"||!new Set(["adviser.programme.create","adviser.work.create","adviser.release.create","operation.resume"]).has(r.operation)||typeof r.payload.operation_id!=="string"||!Number.isSafeInteger(r.payload.expected_revision)||typeof r.payload.actor!=="string")throw new Error("Working file contains an incomplete original request: "+key);
    }
  }
  function adoptPending(){
    for(const entry of Object.values(s.pending)){
      const r=entry.request,existing=c.model.pending.get(r.payload.operation_id);
      if(existing&&stable(existing)!==stable(r))throw new Error("An original request differs from this tab's retained request. Keep both working files for review.");
      c.model.pending.set(r.payload.operation_id,r);
    }
    for(const r of c.model.pending.values()){
      if((r.operation.startsWith("adviser.")||(r.operation==="operation.resume"&&Object.values(s.pending).some(e=>e.request.payload.operation_id===r.payload.target_operation_id)))&&!Object.values(s.pending).some(entry=>entry.request.payload.operation_id===r.payload.operation_id)){
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
    if(operation!=="operation.resume"&&Object.keys(s.pending).length)throw new Error("Inspect or recover the original unanswered adviser request before recording another adviser change.");
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
    return el("div",{class:"actions"},["ndjson","csv"].map(format=>el("a",{href:"/api/exports?kind="+encodeURIComponent("adviser_"+kind)+"&id="+encodeURIComponent(id)+"&format="+format,download:"adviser-"+kind+"-"+id+"."+format},"Download complete "+format.toUpperCase())));
  }
  function paging(page,move){
    if(!Array.isArray(page.rows)||!Number.isSafeInteger(page.total)||!Number.isSafeInteger(page.offset)||!Number.isSafeInteger(page.limit)||page.limit<1)throw new Error("The retained page is incomplete.");
    return c.pageControls(page,move);
  }

  const familyInfo=[
    ["contacts","People, households, companies and trusts",false],
    ["relationships","Household and other relationships",false],
    ["principals","Current and legacy staff, teams and roles",true],
    ["activity_history","Notes, tasks, events and history",false],
    ["recurring_work","Recurring tasks and events",true],
    ["workflow_templates","Workflow templates",true],
    ["active_workflows","Active workflows and linked steps",true],
    ["document_versions","Original document versions and links",true],
    ["note_templates","Note templates",true],["task_templates","Task templates",true],
    ["email_templates","Email templates",true],["report_templates","Report templates",true],
    ["access_rules","Workspace placement and visibility rules",true]
  ];
  function parseObject(value,label){return cleanMap(JSON.parse(value||"{}"),label);}
  function refs(value,label){
    const parsed=JSON.parse(value||"[]");
    if(!Array.isArray(parsed)||parsed.some(r=>!object(r)||typeof r.dataset_id!=="string"||typeof r.row_id!=="string"))throw Error(label+" must contain exact dataset_id and row_id records.");
    return parsed;
  }
  function meaningfulQuery(query){return query?{query}:{};}
  function rowsSummary(items){return items.map(r=>({dataset_id:r.dataset_id,row_id:r.id}));}
  function useWork(programme,family,source,currentWork=null){
    const original=currentWork||{};
    s.drafts.work={values:{
      programme_id:programme,family,source_rows:pretty(rowsSummary(source)),
      title:currentWork?original.title:"",owner:original.owner||"",reason:"",
      method:original.method||"recreate",status:currentWork?original.status:"planned",
      parent_work_id:original.id||"",due_at:original.due_at||"",
      requested_definition:pretty(original.requested_definition||{}),document_files:pretty((original.document_files||[]).map(r=>({source_row_id:r.source_row_id,source_id:r.source.id,sha256_field:r.sha256_field||"content_sha256",bytes_field:r.bytes_field||"bytes"}))),
      expected_fields:pretty(original.expected_fields||{}),target_rows:pretty(rowsSummary(original.target_rows||[])),
      target_links:pretty((original.target_links||[]).map(r=>({source_row_id:r.source_row_id,target_row_id:r.target_row_id,reason:r.reason,expected_fields:r.expected_fields||{}}))),
      evidence_source_ids:(original.evidence_sources||[]).map(r=>r.id).join("\n"),
      verified_by:"",verified_at:"",accepted_by:""
    },extra:{}};
    s.selected.programme=programme;s.tab="work";
  }
  async function readRecord(kind,id,target){
    const valid=nextRead(target),record=await read("adviser."+kind+".get",{id});
    if(!valid())return;
    s.selected[kind]=id;await persist();if(!valid())return;
    target.replaceChildren(heading(record.title,"Retained "+kind+" · "+record.id),exportsFor(kind,id),
      note("Recorded by "+record.actor+" at "+record.created_at+" · Revision "+record.created_revision),
      rawView("Complete original record and evidence",record));
    if(kind==="programme"){
      const a=await read("adviser.programme.assessment",{id});if(!valid())return;
      target.append(note("Source: "+record.source_system+" · Destination: "+record.target_system+" · Accountable owner: "+record.owner),
        note(a.reconstruction_complete?"The selected reconstruction work has its recorded dispositions.":"Reconstruction or source intake remains open."),
        table("All source families",[
          {label:"Family",render:([key,f])=>f.title},
          {label:"Coverage",render:([key,f])=>[badge(f.status),el("div",{},f.reason)]},
          {label:"Work",render:([key,f])=>[String(a.families[key].counts.source_rows)+" original rows",el("br"),String(a.families[key].counts.unassigned)+" unassigned"]},
          {label:"Open",render:([key,f])=>linkButton("Inspect original rows",async()=>{family.value=key;await familyRows(id,key,result,0,"");})}
        ],Object.entries(record.families)),rawView("Complete current reconstruction assessment",a),
        button("Prepare reviewed successor programme",async()=>{
          const values={title:record.title,purpose:record.purpose,owner:record.owner,source_system:record.source_system,target_system:record.target_system,review_note:"",plan_id:record.plan_id,parent_programme_id:record.id,evidence_source_ids:record.evidence_sources.map(r=>r.id).join("\n")};
          for(const [key,f]of Object.entries(record.families)){values["family_"+key+"_status"]=f.status;values["family_"+key+"_reason"]=f.reason;values["family_"+key+"_datasets"]=f.source_dataset_ids.join("\n");values["family_"+key+"_required"]=f.reconstruction_required;}
          s.drafts.programme={values,extra:{}};s.tab="programmes";await persist();render();
        }));
      const family=select("family",familyInfo.map(([key,label])=>[key,label]),"contacts"),query=input("query"),result=el("div",{class:"stack"});
      target.append(panel("Every original occurrence and its current work",basicForm([field("Source family",family),field("Find in original rows",query)],"Read complete selected family",data=>familyRows(id,data.family,result,0,data.query)),result));
      await familyRows(id,"contacts",result,0,"");
    }else if(kind==="work"){
      target.append(note("State: "+record.status+" · Owner: "+record.owner+(record.due_at?" · Due: "+record.due_at:"")),
        table("Original assigned source rows",[
          {label:"Original identity",render:r=>[r.register,el("br"),r.key||"Identity unavailable"]},
          {label:"Evidence",render:r=>rawView("Full source occurrence",r)},
          {label:"History",render:r=>linkButton("Every assignment edition",()=>history(record.programme_id,r.id,target,0))}
        ],record.source_rows),
        rawView("Explicit source-to-target associations",record.target_links||[]),
        rawView("Inventory-bound original document files",record.document_files||[]),
        table("Independent target field checks",[
          {label:"Source",render:r=>r.source_row_id||"Earlier work edition"},
          {label:"Target / field",render:r=>[r.target_row_id,el("br"),r.field]},
          {label:"Expected",render:r=>pretty(r.expected)},{label:"Returned",render:r=>pretty(r.observed)},
          {label:"Result",render:r=>r.matches?"Matches":"Does not match"}
        ],record.target_checks),
        button("Continue this reconstruction",async()=>{useWork(record.programme_id,record.family,record.source_rows,record);await persist();render();}));
    }else target.append(note(record.decision+" · "+record.reason),rawView("Retained native cutover and full reconstruction assessment",record.assessment));
  }
  async function familyRows(id,family,target,offset,query){
    const valid=nextRead(target),p=await read("adviser.programme.rows",{id,family,offset,limit:50,...meaningfulQuery(query)});
    if(!valid())return;
    target.replaceChildren(note(p.total+" original rows · "+family),
      table("Original records and reconstruction",[
        {label:"Original",render:r=>[el("strong",{},r.source.key||"Identity unavailable"),el("div",{},r.source.register+" · occurrence "+r.source.ordinal)]},
        {label:"Current work",render:r=>r.current_work?[badge(r.current_work.status),el("div",{},r.current_work.owner),el("div",{},r.current_work.title)]:badge("unassigned")},
        {label:"Review",render:r=>el("div",{class:"row-actions"},rawView("Original values and source",r.source),
          linkButton(r.current_work?"Open current work":"Assign reconstruction",async()=>{
            if(r.current_work){await readRecord("work",r.current_work.id,target);return;}
            useWork(id,family,[r.source]);await persist();render();
          }),linkButton("Assignment history",()=>history(id,r.source.id,target,0)))}
      ],p.rows),paging(p,next=>familyRows(id,family,target,next,query)));
  }
  async function history(programme_id,row_id,target,offset){
    const valid=nextRead(target),p=await read("adviser.work.history",{programme_id,row_id,offset,limit:50});
    if(!valid())return;
    target.replaceChildren(heading("Complete assignment history",row_id),table("All original assignment editions",[
      {label:"Edition",render:r=>[r.title,el("br"),r.created_at]},
      {label:"Status / owner",render:r=>[r.status,el("br"),r.owner]},
      {label:"Open",render:r=>linkButton("Complete original work",()=>readRecord("work",r.id,target))}
    ],p.rows),paging(p,next=>history(programme_id,row_id,target,next)));
  }
  function programmeView(){
    const result=el("div",{class:"stack"});
    const familyControls=familyInfo.map(([key,title,required])=>details(title,
      field("Applicability",select("family_"+key+"_status",[["awaiting_source","Awaiting original source"],["selected","Selected original datasets"],["not_applicable","Not applicable to this migration"]],"awaiting_source")),
      field("Reason and source boundary",area("family_"+key+"_reason","",{required:true}),"State why this family is selected, absent, or awaiting the original owner."),
      field("Complete original dataset IDs",area("family_"+key+"_datasets"),"One source-side register dataset per line; each dataset occurs in one family."),
      field("Requires local reconstruction",input("family_"+key+"_required","",{type:"checkbox",checked:required}),"Retain a deliberate applicability decision. History alone does not demonstrate restored recurring settings, workflow links or templates.")
    ));
    const form=draftForm("programme",[
      field("Programme title",input("title","",{required:true})),field("Accountable owner",input("owner","",{required:true})),
      field("Original CRM or source system",input("source_system","",{required:true})),field("Selected destination system",input("target_system","Wealthbox",{required:true})),
      exactId("Native register plan","plan_id"),optionalId("Earlier programme","parent_programme_id"),
      field("Purpose and client scope",area("purpose","",{required:true}),null,true),field("Reviewed source/cutoff decision",area("review_note","",{required:true}),null,true),
      field("Supporting original evidence source IDs",area("evidence_source_ids"),"Use the original file intake for actual planning records and attachments.",true),
      el("div",{class:"field full"},el("h4",{},"Complete source-family decisions"),familyControls)
    ],"Retain complete migration programme",data=>{
      const families={};
      for(const [key]of familyInfo)families[key]={status:data["family_"+key+"_status"],reason:data["family_"+key+"_reason"],source_dataset_ids:ids(data["family_"+key+"_datasets"]),reconstruction_required:!!data["family_"+key+"_required"]};
      return {operation:"adviser.programme.create",payload:{title:data.title,owner:data.owner,source_system:data.source_system,target_system:data.target_system,purpose:data.purpose,review_note:data.review_note,plan_id:data.plan_id,families,evidence_source_ids:ids(data.evidence_source_ids),...(data.parent_programme_id?{parent_programme_id:data.parent_programme_id}:{})}};
    },null,async r=>{s.selected.programme=r.id;await persist();await readRecord("programme",r.id,result);});
    return el("div",{class:"stack"},panel("Original intake and destination mapping",
      note("Begin with the complete original export and declared source coverage. Map its exact fields in Register migration, retain its source cutoff and intended destinations, then account for every source family here."),
      el("div",{class:"actions"},button("Open original file intake",()=>c.go("sources")),button("Open register mappings and reconciliation",()=>c.go("registers")),button("Open complete workspace handover",()=>c.go("handover")))),
      panel("Programme definition",form),
      panel("Continue an existing programme",basicForm([exactId("Programme ID","id",s.selected.programme||"")],"Open programme and complete family review",data=>readRecord("programme",data.id,result)),result));
  }
  function workView(){
    const result=el("div",{class:"stack"});
    const form=draftForm("work",[
      exactId("Programme ID","programme_id",s.selected.programme||""),field("Source family",select("family",familyInfo.map(([k,l])=>[k,l]),"recurring_work")),
      field("Work title",input("title","",{required:true})),field("Accountable operator",input("owner","",{required:true})),
      field("Method",select("method",[["recreate","Recreate the reviewed configuration"],["link_existing","Link the original retained destination"],["retain_history","Retain original history"],["archive_original","Archive original source"],["review_configuration","Inspect actual target configuration"]],"recreate")),
      field("Work state",select("status",[["planned","Planned"],["in_progress","In progress"],["verified","Verified against returned target evidence"],["deferred","Deferred with a reason"],["accepted_omission","Explicitly accepted omission"]],"planned")),
      optionalId("Current work predecessor","parent_work_id"),field("Due time with UTC offset",input("due_at"),"Example 2026-10-20T16:00:00-04:00. Keep the customer's actual timezone."),
      field("Original source row references",area("source_rows","[]",{required:true}),"Complete JSON array of {dataset_id,row_id}. The programme's family list can prepare this selection.",true),
      field("Complete requested definition",area("requested_definition","{}"),"Original recurrence/timezone, workflow steps and links, template content, staff/account visibility, or document-version plan. Retain exact definitions and original identifiers.",true),
      field("Original document-file bindings",area("document_files","[]"),"Document versions: JSON array of {source_row_id,source_id,sha256_field,bytes_field}. Defaults are content_sha256 and bytes. Map the original SHA-256 as text and original size as decimal; the retained file must match both unchanged inventory values. Required for verified recreated or archived documents.",true),
      field("Reason and reconstruction decision",area("reason","",{required:true}),null,true),
      field("Exact expected target fields",area("expected_fields","{}"),"JSON object keyed by mapped field. Use original JSON values, booleans, exact decimal strings, or offset timestamps under the selected target mapping.",true),
      field("Independent returned target row references",area("target_rows","[]"),"Exact {dataset_id,row_id} array from a separately imported target capture.",true),
      field("Source-to-target associations",area("target_links","[]"),"JSON array of {source_row_id,target_row_id,reason,expected_fields?}. Explicitly account for every selected source and target. Per-association fields override the common expectations; retain actual original identities for each person, household and document version.",true),
      field("Original operating evidence source IDs",area("evidence_source_ids"),"One retained attachment or original inventory source ID per line; required for verification.",true),
      field("Verified by",input("verified_by")),field("Actual verification time",input("verified_at"),"An offset timestamp is required for verified work."),
      field("Omission accepted by",input("accepted_by"),"Name the actual accountable decision maker for an accepted omission.")
    ],"Retain reconstruction edition",data=>({operation:"adviser.work.create",payload:{
      programme_id:data.programme_id,family:data.family,title:data.title,owner:data.owner,method:data.method,status:data.status,reason:data.reason,
      source_rows:refs(data.source_rows,"Source rows"),document_files:JSON.parse(data.document_files||"[]"),requested_definition:parseObject(data.requested_definition,"Requested definition"),
      expected_fields:parseObject(data.expected_fields,"Target expectations"),target_rows:refs(data.target_rows,"Target rows"),target_links:JSON.parse(data.target_links||"[]"),evidence_source_ids:ids(data.evidence_source_ids),
      ...(data.parent_work_id?{parent_work_id:data.parent_work_id}:{}),...(data.due_at?{due_at:data.due_at}:{}),
      ...(data.status==="verified"?{verified_by:data.verified_by,verified_at:data.verified_at}:{}),
      ...(data.status==="accepted_omission"?{accepted_by:data.accepted_by}:{})
    }}),null,async r=>{s.selected.work=r.id;await persist();await readRecord("work",r.id,result);});
    const target=el("div",{class:"stack"});
    async function targets(data,offset){
      const valid=nextRead(target),ds=await read("register.dataset.get",{id:data.id});
      if(ds.side!=="target")throw Error("Choose a separately retained target dataset.");
      const p=await read("register.dataset.rows",{id:data.id,offset,limit:50,...meaningfulQuery(data.query)});if(!valid())return;
      target.replaceChildren(note(ds.title+" · "+p.total+" target occurrences"),
        table("Complete independent returned target rows",[
          {label:"Identity",render:r=>[r.key||"Identity unavailable",el("br"),r.ordinal]},
          {label:"Mapped values",render:r=>rawView("All returned values, definitions and source", {dataset:ds,row:r})},
          {label:"Reference",render:r=>el("code",{},JSON.stringify({dataset_id:ds.id,row_id:r.id}))}
        ],p.rows),paging(p,next=>targets(data,next)));
    }
    return el("div",{class:"stack"},panel("Local reconstruction and verification",note("Follow the current assignment when recording a new edition. Every selected original row retains its history. A verified result requires current target source, exact typed field checks and original operating evidence."),form),
      panel("Inspect complete independent target evidence",basicForm([exactId("Target dataset ID","id"),field("Find original target rows",input("query"))],"Inspect returned target rows",data=>targets(data,0)),target),
      panel("Saved reconstruction",basicForm([exactId("Work ID","id",s.selected.work||"")],"Open complete reconstruction",data=>readRecord("work",data.id,result)),result));
  }
  function releaseView(){
    const results=el("div",{class:"stack"}),assessmentArea=el("div",{class:"stack"});
    const form=draftForm("release",[
      exactId("Programme ID","programme_id",s.selected.programme||""),field("Release review title",input("title","",{required:true})),
      exactId("Original native cutover review","cutover_id"),field("Decision",select("decision",[["hold","Hold"],["ready_for_review","Ready for review"],["approved","Approved"]],"ready_for_review")),
      field("Acceptance owner",input("acceptance_owner","",{required:true})),optionalId("Earlier release review","parent_release_id"),
      field("Complete current reconstruction IDs",area("work_ids"),"Use the assessment below; select every current work edition.",true),
      field("Reason and handover boundary",area("reason","",{required:true}),null,true),field("Original handover evidence source IDs",area("evidence_source_ids"),null,true)
    ],"Retain complete release review",data=>({operation:"adviser.release.create",payload:{
      programme_id:data.programme_id,title:data.title,cutover_id:data.cutover_id,decision:data.decision,acceptance_owner:data.acceptance_owner,reason:data.reason,
      work_ids:ids(data.work_ids),evidence_source_ids:ids(data.evidence_source_ids),...(data.parent_release_id?{parent_release_id:data.parent_release_id}:{})
    }}),null,async r=>{s.selected.release=r.id;await persist();await readRecord("release",r.id,results);});
    return el("div",{class:"stack"},panel("Current complete reconstruction assessment",basicForm([exactId("Programme ID","id",s.selected.programme||"")],"Inspect readiness and current work",async data=>{
      const valid=nextRead(assessmentArea),a=await read("adviser.programme.assessment",{id:data.id});if(!valid())return;
      assessmentArea.replaceChildren(note(a.reconstruction_complete?"All selected reconstruction work has its current disposition.":"Original source or reconstruction work is still open."),
        table("Complete source-family position",[{label:"Family",render:([k,v])=>v.title},{label:"Coverage",render:([k,v])=>v.status},{label:"Original work counts",render:([k,v])=>pretty(v.counts)}],Object.entries(a.families)),
        table("Open boundaries",[{label:"Family",render:r=>r.family},{label:"Reason",render:r=>r.reason}],a.blockers),
        details("Complete selected current work IDs",el("pre",{},a.current_work_ids.join("\n"))),rawView("Full exact assessment",a));
    }),assessmentArea),
    panel("Release and accountable acceptance",note("The original native cutover retains every record/reference/control finding and its current decision. Approval also requires this programme's complete reconstruction dispositions."),form),
    panel("Retained release",basicForm([exactId("Release ID","id",s.selected.release||"")],"Open complete release",data=>readRecord("release",data.id,results)),results),
    panel("Complete handover",note("Use the original workspace handover to carry the database, every original source file, all application source, reports and request history. Download the browser working file before transferring unsent drafts."),
      button("Open complete portable handover",()=>c.go("handover"))));
  }
  function catalogue(){
    const result=el("div",{class:"stack"}),opened=el("div",{class:"stack"});
    async function list(data,offset){
      const valid=nextRead(result),p=await read("adviser.list",{kind:"adviser_"+data.kind,offset,limit:50,...meaningfulQuery(data.query)});if(!valid())return;
      result.replaceChildren(table("All adviser migration records",[
        {label:"Record",render:r=>[r.title,el("div",{class:"mono"},r.id)]},
        {label:"Owner / state",render:r=>[r.owner||r.acceptance_owner||"",el("br"),r.status||r.decision||""]},
        {label:"Retained",render:r=>[r.created_at,el("br"),"Revision "+r.created_revision]},
        {label:"Open",render:r=>linkButton("Complete original record",()=>readRecord(data.kind,r.id,opened))}
      ],p.rows),paging(p,next=>list(data,next)));
    }
    return panel("Complete programme and decision history",basicForm([field("Record kind",select("kind",["programme","work","release"],"programme")),field("Find in complete original records",input("query"))],"Read all retained records",data=>list(data,0)),result,opened);
  }
  async function originalOperation(request){
    const reply=await read("operation.get",{id:request.payload.operation_id});
    if(!reply.found){const error=new Error("The original request has not been found.");error.code="OPERATION_NOT_FOUND";throw error;}
    if(!object(reply.operation))throw Error("The original operation response is incomplete.");
    return reply.operation;
  }
  function verifyOriginal(operation,request){
    if(operation.id!==request.payload.operation_id||operation.operation!==request.operation||stable(operation.request)!==stable(request.payload))throw new Error("The retained operation differs from the selected original request. Preserve this working file and inspect both records.");
  }
  async function finishPending(key,entry){
    const operation=await originalOperation(entry.request);
    verifyOriginal(operation,entry.request);
    jsonRecord("Original adviser operation",operation);
    if(operation.status==="SUCCEEDED"){
      if(s.pending[key]?.request.payload.operation_id===entry.request.payload.operation_id)delete s.pending[key];
      c.model.pending.delete(entry.request.payload.operation_id);c.savePending();await persist();await c.refresh(false);
      setNotice("Recovered the original adviser operation and saved result.");
    }
    return operation;
  }
  async function preserveAttempt(key,entry,reason){
    if(!reason.trim())throw new Error("Enter the reason for preserving this attempt and revising its draft.");
    let observation;
    try{
      observation=await originalOperation(entry.request);
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
    const pending=table("Original adviser requests awaiting a confirmed result",[
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
          const original=await originalOperation(entry.request);
          verifyOriginal(original,entry.request);
          if(original.status==="SUCCEEDED"){await finishPending(key,entry);render();return;}
          await command("resume:"+entry.request.payload.operation_id,"operation.resume",{target_operation_id:entry.request.payload.operation_id,reason:reason.value});
          await finishPending(key,entry);render();
        }),
        linkButton("Preserve attempt and revise draft",()=>preserveAttempt(key,entry,reason.value)),
        rawView("Complete original request",entry.request))}
    ],Object.entries(s.pending),"Every submitted adviser request has a confirmed response.");
    return details("Working file, drafts and request recovery",
      note("Draft mappings, policies, decisions and original requests are saved for workspace "+s.workspaceId+". Complete imported files and accepted records remain in the workspace handover."),
      s.error?note(s.error.message):null,
      el("div",{class:"actions"},
        button("Download current working file",()=>download("adviser-migration-working-file.json",working())),
        button("Save current drafts",async()=>{await persist();setNotice("Complete adviser working file saved.");}),
        button("Load saved working file",async()=>{
          await s.queue.catch(()=>{});
          const saved=await loadSaved(s.workspaceId);if(!saved)throw new Error("No saved working file is available.");
          validateWorking(saved);s.drafts=saved.drafts;s.pending=saved.pending;s.history=saved.history||[];s.selected=saved.selected;s.tab=saved.tab||"programmes";s.journalRevision=saved.journalRevision;s.error=null;adoptPending();render();setNotice("Saved working file loaded.");
        })),
      field("Restore downloaded working file",file,"Choose a complete working file from this same workspace."),
      button("Restore selected working file",async()=>{
        if(!file.files.length)throw new Error("Choose the complete working file.");
        const selectedFile=file.files[0];const value=JSON.parse(await selectedFile.text());validateWorking(value);
        for(const [key,entry] of Object.entries(s.pending))if(stable(value.pending[key])!==stable(entry))throw new Error("The selected file would drop or replace an unanswered original request. Preserve and reconcile that request first.");
        s.drafts=value.drafts;s.pending=value.pending;s.history=[...new Map([...s.history,...(value.history||[])].map(entry=>[stable(entry),entry])).values()];s.selected=value.selected;s.tab=value.tab||"programmes";adoptPending();await persist();render();setNotice("Complete selected working file restored.");
      }),pending,field("Continuation or revision reason",reason,"Used to continue an original interrupted request or to preserve a stopped attempt while revising its draft."),
      table("Preserved attempts",[
        {label:"Original request",render:r=>r.request.payload.operation_id},
        {label:"Reason",render:r=>r.reason},
        {label:"Original observation",render:r=>rawView("Complete attempt and retained result",r)}
      ],s.history,"No stopped attempts have been preserved in this working file."));
  }

  function render(){
    if(s.host!==root||s.generation!==generation)return;
    const body={programmes:programmeView,work:workView,releases:releaseView,records:catalogue}[s.tab]();
    root.replaceChildren(heading("Adviser migration commissioning","Review the complete original scope, reconstruct excluded configuration, reconcile independent returns, and retain the full handover."),
      el("nav",{class:"case-navigation","aria-label":"Adviser migration workflow"},tabs.map(([key,label])=>el("button",{type:"button","aria-current":key===s.tab?"page":null,onclick:()=>run(async()=>{s.tab=key;await persist();render();})},label))),workingPanel(),body);
  }
  return root;
}
window.MigrationAdvisers={create};
})();

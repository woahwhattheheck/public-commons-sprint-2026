"use strict";
(() => {
  const $ = selector => document.querySelector(selector);
  const model = {state:null,schema:null,view:"overview",source:null,reconciliation:null,correction:null,pending:new Map(),busy:false};
  const sections = [["overview","Overview"],["sources","Sources"],["rounds","Rounds"],["mappings","Mappings & evidence"],["reconciliations","Reconciliations"],["corrections","Corrections"],["catalogue","All records"],["cases","Cases & cutover"],["registers","Register migration"],["handover","Handover & history"]];
  const roles = ["source_inventory","target_inventory","migration_items","migration_failures","summary","structure","purview","mapping","attachment"];
  const checks = ["presence","path","size","hash","principals","label","classification_order"];
  const statuses = ["MATCH","DIFFERENT","UNKNOWN","AMBIGUOUS","MISSING","UNEXPECTED"];
  const canonicalFields = ["source_id","target_id","path","expected_target_path","size_bytes","content_sha256","principals","label","classified_at","migrated_at","reported_source","reported_destination","name","extension","content_type","status","result_category","message","error_code","package_number","task_id","round_label","job_id","device_name","scan_job_id","scan_cycle_id"];
  const fmtFallback = ["mm_item_report","mm_item_failure_report","mm_item_summary","mm_task_summary","mm_scan_summary","mm_structure_report","mm_structure_failure_report","mm_structure_failure_summary","inventory_jsonl","inventory_csv","purview_csv","user_mapping_csv","identity_mapping_jsonl","status_mapping_jsonl","attachment"];
  let serial = 0;
  function el(tag, props, ...children) {
    const node = document.createElement(tag);
    Object.entries(props || {}).forEach(([key,value]) => {
      if(value === undefined || value === null || value === false) return;
      if(key === "class") node.className=value;
      else if(key.startsWith("on")) node.addEventListener(key.slice(2).toLowerCase(),value);
      else if(key === "text") node.textContent=value;
      else if(key === "value" || key === "checked" || key === "disabled") node[key]=value;
      else node.setAttribute(key,value === true ? "" : String(value));
    });
    children.flat(Infinity).forEach(child => {
      if(child !== null && child !== undefined && child !== false) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    });
    if(model.busy && tag==="button"){node.dataset.preDisabled=node.disabled?"1":"0";node.disabled=true;}
    return node;
  }
  const human = value => String(value || "").replaceAll("_"," ").replaceAll("."," / ");
  const show = value => value === undefined ? "Not supplied" : value === null ? "Null" : typeof value === "object" ? JSON.stringify(value) : String(value);
  const records = name => {const value=model.state && model.state[name];return Array.isArray(value)?value:(value && Array.isArray(value.rows)?value.rows:[]);};
  const idOf = value => value.id || value.source_id || value.item_id;
  const nameOf = value => value.title || value.filename || value.name || idOf(value) || "Retained record";
  const summary = value => value.context || {};
  function input(name,value="",props={}) {return el("input",{name,value,...props});}
  function area(name,value="",props={}) {return el("textarea",{name,...props},value);}
  function select(name,values,value,props={}) {
    const node=el("select",{name,...props},values.map(item=>el("option",{value:Array.isArray(item)?item[0]:item},Array.isArray(item)?item[1]:human(item))));
    if(value !== undefined && value !== null) node.value=value;
    return node;
  }
  function field(label,control,help,wide=false) {
    if(!control.id) control.id="field-"+(++serial);
    const noteId=control.id+"-help";
    if(help) control.setAttribute("aria-describedby",noteId);
    return el("div",{class:"field"+(wide?" full":"")},el("label",{for:control.id},label),control,help?el("p",{class:"help",id:noteId},help):null);
  }
  function button(label,action,primary=false) {return el("button",{type:"button",class:primary?"primary":"",onclick:()=>run(action)},label);}
  function linkButton(label,action) {return el("button",{type:"button",class:"quiet",onclick:()=>run(action)},label);}
  function badge(value) {return el("span",{class:"status","data-status":value || "UNKNOWN"},human(value || "UNKNOWN"));}
  function heading(title,description) {return el("div",{class:"section-heading"},el("div",{},el("h2",{},title),el("p",{},description)));}
  function panel(title,...children) {return el("section",{class:"panel"},el("h3",{},title),children);}
  function details(title,...children) {return el("details",{},el("summary",{},title),el("div",{},children));}
  function note(text) {return el("p",{class:"inline-note"},text);}
  function datalistInput(name,collection,filter) {
    const control=input(name,"",{list:"list-"+name+"-"+(++serial),autocomplete:"off"});
    const list=el("datalist",{id:control.getAttribute("list")},records(collection).filter(filter || (()=>true)).map(row=>el("option",{value:idOf(row)},nameOf(row))));
    const wrap=el("div",{},control,list);
    return {control,wrap};
  }
  function idField(label,name,collection,filter,help) {
    const made=datalistInput(name,collection,filter);
    made.control.id="id-"+(++serial);
    const root=field(label,made.control,help || "Choose a recent record or enter any exact retained ID.");
    root.append(made.wrap.lastChild);
    return root;
  }
  function formData(form) {return Object.fromEntries(new FormData(form).entries());}
  function textFields(data,names) {return Object.fromEntries(names.filter(name=>data[name] && data[name].trim()).map(name=>[name,data[name].trim()]));}
  function requiredArray(text,label) {
    const value=JSON.parse(text);
    if(!Array.isArray(value)) throw new Error(label+" must be an array.");
    return value;
  }
  function ids(value) {return String(value || "").split(/[\s,]+/).filter(Boolean);}
  function jsonRecord(title,value) {
    $("#record-heading").textContent=title;
    $("#record-body").replaceChildren(el("pre",{tabindex:"0"},JSON.stringify(value,null,2)));
    if(!$("#record-dialog").open) $("#record-dialog").showModal();
  }
  function table(caption,columns,rows,emptyText) {
    if(!rows.length) return el("div",{class:"empty"},emptyText || "No records yet.");
    return el("div",{class:"table-wrap",tabindex:"0",role:"region","aria-label":caption},
      el("table",{},el("caption",{},caption),
        el("thead",{},el("tr",{},columns.map(col=>el("th",{scope:"col"},col.label)))),
        el("tbody",{},rows.map(row=>el("tr",{},columns.map(col=>el("td",{},col.render(row))))))));
  }
  function setNotice(message,level="normal") {$("#notice").textContent=message;$("#notice").dataset.level=level;}
  async function api(path,body,options={}) {
    const response=await fetch(path,body===undefined?options:{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),...options});
    const raw=await response.text();
    let value;
    try{value=JSON.parse(raw);}catch{throw new Error("The server returned an unreadable response. Keep the original operation ID in Handover & history.");}
    if(!response.ok || value.error) {
      const error=new Error(value.error?.message || "Workspace request failed.");
      error.code=value.error?.code;error.details=value.error?.details;error.status=response.status;
      throw error;
    }
    return value;
  }
  async function read(operation,payload={}) {
    const result=await api("/api/read",{operation,payload});
    if(operation==="operation.get"){
      if(!result.found){const error=new Error("Original operation was not found.");error.code="OPERATION_NOT_FOUND";throw error;}
      return result.operation;
    }
    return result;
  }
  function savePending() {
    try{sessionStorage.setItem("migration-pending-"+model.state.project.id,JSON.stringify([...model.pending]));}catch{}
  }
  function loadPending() {
    try{const saved=JSON.parse(sessionStorage.getItem("migration-pending-"+model.state.project.id)||"[]");model.pending=new Map(saved);}catch{model.pending=new Map();}
  }
  async function refresh(renderView=true) {
    model.state=await api("/api/state");
    $("#workspace-title").textContent=model.state.project.title;
    $("#workspace-identity").textContent="Workspace "+model.state.project.id+" · Revision "+model.state.project.revision;
    if(renderView) render();
    return model.state;
  }
  async function run(action) {
    if(model.busy) return;
    model.busy=true;document.body.dataset.busy="true";
    const frozen=[...document.querySelectorAll("#main,#navigation,.operator,#record-body")].map(node=>[node,node.inert]);
    frozen.forEach(([node])=>{node.inert=true;});
    document.querySelectorAll("button").forEach(node=>{node.dataset.preDisabled=node.disabled?"1":"0";node.disabled=true;});
    try{await action();}
    catch(error) {setNotice((error.code?error.code+": ":"")+error.message+" Changes are only complete when their retained operation reports success.","error");}
    finally{
      model.busy=false;document.body.dataset.busy="false";
      frozen.forEach(([node,previous])=>{node.inert=previous;});
      document.querySelectorAll("button").forEach(node=>{if(node.dataset.preDisabled!==undefined){node.disabled=node.dataset.preDisabled==="1";delete node.dataset.preDisabled;}});
    }
  }
  async function mutate(operation,payload,lifecycle={}) {
    const actor=$("#actor").value.trim();
    if(!actor){$("#actor").focus();throw new Error("Enter the operator name to record with this change.");}
    if(!crypto.randomUUID) throw new Error("Open this local workbench on localhost so operation IDs can be created securely.");
    const request={operation,payload:{...payload,actor,expected_revision:model.state.project.revision,operation_id:"op-"+crypto.randomUUID()}};
    if(new Blob([JSON.stringify(request)]).size>2*1024*1024)throw new Error("This command exceeds 2 MiB. Use complete file intake for bulk source rows and mappings.");
    model.pending.set(request.payload.operation_id,request);savePending();
    setNotice("Applying "+human(operation)+" to revision "+request.payload.expected_revision+".");
    try {
      if(lifecycle.prepared) await lifecycle.prepared(request);
      const result=await api("/api/operations",request);
      model.pending.delete(request.payload.operation_id);savePending();
      await refresh(false);
      setNotice(human(operation)+" complete · "+result.result.id+" · Revision "+result.revision+(result.reused?" · Original result reused":""));
      return result.result;
    } catch(error) {
      if(error.code==="REVISION_CONFLICT") {
        model.pending.delete(request.payload.operation_id);savePending();
        await refresh(false);
        error.message+=" The current revision has been refreshed; review the unchanged form before submitting again.";
      }
      throw error;
    }
  }
  function operationForm(content,label,build,after) {
    const form=el("form",{},el("div",{class:"form-grid"},content),
      el("div",{class:"actions"},el("button",{type:"submit",class:"primary"},label)));
    form.addEventListener("submit",event=>{event.preventDefault();run(async()=>{
      const request=await build(formData(form),form);
      if(!request) return;
      const result=await mutate(request.operation,request.payload);
      if(after) await after(result); else render();
    });});
    return form;
  }
  function go(view) {model.view=view;render();$("#main").focus();}
  function render() {
    if(!model.state)return;
    $("#navigation").replaceChildren(...sections.map(([id,label])=>el("button",{type:"button","aria-current":model.view===id?"page":null,onclick:()=>go(id)},label)));
    const renderers={overview:overview,sources:sources,rounds:rounds,mappings:mappings,reconciliations:reconciliations,corrections:corrections,catalogue:catalogue,cases:caseDesk,registers:registerDesk,handover:handover};
    $("#main").replaceChildren(renderers[model.view]());
  }
  function caseDesk() {
    return window.MigrationCases.create({model,el,input,area,select,field,button,linkButton,panel,heading,note,details,table,badge,jsonRecord,read,run,setNotice,api,mutate,savePending,refresh,render,go,pageControls});
  }
  function registerDesk() {
    return window.MigrationRegisters.create({model,el,input,area,select,field,button,linkButton,panel,heading,note,details,table,badge,jsonRecord,read,run,setNotice,api,mutate,savePending,refresh,render,go,pageControls});
  }
  function recentColumns(kind,collection) {
    return [
      {label:"Record",render:r=>el("div",{},el("strong",{},nameOf(r)),el("div",{class:"mono"},idOf(r)))},
      {label:"Scope / round",render:r=>[summary(r).scope_id || r.scope_id || "—",el("br"),summary(r).round_label || r.round_label || "—"]},
      {label:"State",render:r=>badge(r.status || "retained")},
      {label:"Review",render:r=>linkButton("Open record",async()=>jsonRecord(nameOf(r),await read(kind+".get",{id:idOf(r)})))}
    ];
  }
  function overview() {
    const counts=[["Sources","sources"],["Migration rounds","rounds"],["Reconciliations","reconciliations"],["Open corrections","corrections"]];
    const metrics=el("div",{class:"metrics"},counts.map(([label,key])=>el("div",{class:"metric"},el("strong",{},key==="corrections"?records(key).filter(r=>!["resolved","accepted_variance","withdrawn"].includes(r.status)).length:records(key).length),el("span",{},label+" · recent view"))));
    return el("div",{class:"stack"},heading("Operating overview","Import original inventories and migration reports, select a precise round, review differences, then carry the editable work forward."),
      metrics,
      el("div",{class:"two-col"},
        panel("Start or continue a migration",
          el("ol",{},el("li",{},"Import source and target inventories with their scope, identity namespace and coverage."),el("li",{},"Select the exact reports and inventory occurrences that belong to the migration round."),el("li",{},"Review identity and evidence mappings, then reconcile the fields you need."),el("li",{},"Track corrections against a later matching observation and prepare a full handover.")),
          el("div",{class:"actions"},button("Import sources",()=>go("sources"),true),button("Review differences",()=>go("reconciliations"))),note("This workspace evaluates the evidence you supply. Reported success, file content, permissions and classification are separate checks.")),
        panel("Work in progress",table("Recent operations",[
          {label:"Operation",render:r=>human(r.operation)},
          {label:"State",render:r=>badge(r.status)},
          {label:"Inspect",render:r=>linkButton("View",async()=>jsonRecord("Retained operation",await read("operation.get",{id:r.id})))}
        ],records("operations").slice(0,8),"No recorded operations."),el("div",{class:"actions"},button("Handover & history",()=>go("handover"))))),
      panel("Recent rounds",table("Selected report sets",recentColumns("round","rounds"),records("rounds").slice(0,8),"Create the first round after importing its sources.")));
  }
  function sourceLabel(source) {const ctx=summary(source);return nameOf(source)+" · "+(ctx.role || source.role || "")+" · "+idOf(source);}
  function sources() {
    const root=el("div",{class:"stack"},heading("Source intake","Retain complete original files. Each import declares its meaning, coverage and report context; the original bytes remain available."));
    let staged=null,preview=null;
    const file=input("file","",{type:"file",required:true});
    const formats=model.schema.source_formats || {};
    const formatKeys=Array.isArray(formats)?formats.map(x=>typeof x==="string"?x:x.id):Object.keys(formats);
    const format=select("format",formatKeys.length?formatKeys:fmtFallback,"inventory_jsonl");
    const role=select("role",roles,"source_inventory");
    const delimiter=select("delimiter",[[",","Comma"],[";","Semicolon"],["\t","Tab"],["|","Pipe"]],",");
    const encoding=select("encoding",["utf-8-sig","utf-8","utf-16","utf-16-le","utf-16-be"],"utf-8-sig");
    const stagedNote=el("p",{class:"help"},"Choose a file, then retain it to preview headers and configure its import.");
    const maps=el("div",{class:"column-map"});
    const sample=el("div",{class:"sample"});
    const formatMeaning=el("p",{class:"inline-note"});
    function renderMaps() {
      const spec=Array.isArray(formats)?null:formats[format.value];
      const suggestedRole=spec && spec.role;
      if(suggestedRole) role.value=suggestedRole;
      formatMeaning.textContent=spec?.meaning || "Declare the source role and the complete coverage of this input.";
      maps.replaceChildren();
      const headers=preview?.headers || [];
      const required=Array.isArray(spec?.headers)?spec.headers:[];
      const add=(key,label,group)=>{
        const control=select(group+"|"+key,[["","Not mapped"],...headers.map(h=>[h,h])],"");
        control.dataset.mappingKind=group;control.dataset.mappingKey=key;
        control.id="mapping-"+(++serial);
        maps.append(el("label",{for:control.id},label),control);
      };
      if(["inventory_csv","purview_csv"].includes(format.value)||required.length) canonicalFields.forEach(key=>add(key,human(key),"columns"));
      if(required.length) required.forEach(key=>add(key,"Provider heading: "+key,"header_mapping"));
      if(!headers.length) maps.append(el("p",{class:"help"},"Retain the file to select exact CSV headings. JSONL and binary attachments use their own native format."));
      sample.replaceChildren();
      if(preview) sample.append(table("Header preview — first rows only",headers.map((h,index)=>({label:h,render:r=>r[index]??""})),preview.sample_rows || [],"No preview rows."));
    }
    const upload=button("Retain file & preview",async()=>{
      if(!file.files.length)throw new Error("Choose a complete source file.");
      const selected=file.files[0];setNotice("Retaining "+selected.name+" ("+selected.size+" bytes).");
      const response=await fetch("/api/files?filename="+encodeURIComponent(selected.name),{method:"POST",headers:{"Content-Type":"application/octet-stream"},body:selected});
      const result=await response.json();if(!response.ok||result.error)throw new Error(result.error?.message||"Source upload failed.");
      staged=result;
      stagedNote.textContent=result.filename+" · "+result.bytes+" bytes · SHA256 "+result.sha256;
      preview=await api("/api/file-preview?sha256="+result.sha256+"&encoding="+encodeURIComponent(encoding.value)+"&delimiter="+encodeURIComponent(delimiter.value));
      renderMaps();setNotice("Original bytes retained. Review the format, context and any column mapping before import.");
    });
    format.addEventListener("change",renderMaps);
    file.addEventListener("change",()=>{staged=null;preview=null;stagedNote.textContent="New file selected; retain its complete bytes before importing.";renderMaps();});
    const repreview=()=>run(async()=>{if(staged){preview=await api("/api/file-preview?sha256="+staged.sha256+"&encoding="+encodeURIComponent(encoding.value)+"&delimiter="+encodeURIComponent(delimiter.value));renderMaps();}});
    encoding.addEventListener("change",repreview);
    delimiter.addEventListener("change",repreview);
    const importForm=operationForm([
      field("Complete source file",file,null,true),el("div",{class:"full"},upload,stagedNote),
      field("Report format",format),field("Role in this migration",role),
      el("div",{class:"full"},formatMeaning),
      field("Scope ID",input("scope_id","",{required:true}),"The business or migration cohort represented by this capture."),
      field("Identity namespace",input("identity_namespace","",{required:true}),"Declare the system in which source IDs have the same meaning."),
      field("Capture kind",select("capture_kind",[["customer_export","Customer export"],["local_reference","Local product reference"],["public_reference","Public reference"]],"customer_export")),
      field("Coverage",select("coverage_mode",["unknown","complete","partial","failure_only"],"unknown")),
      field("Coverage description",area("coverage_description","",{required:true}),"Explain what was included, filtered, excluded or unavailable.",true),
      field("Expected original rows",input("expected_rows","",{type:"number",min:"0",step:"1"}),"Optional declared row count; distinct from migrated or scanned counts."),
      field("Text encoding",encoding),field("CSV delimiter",delimiter),
      field("Task ID",input("task_id")),field("Incremental round",input("round_label")),
      field("Migration job ID",input("job_id")),field("Snapshot ID",input("snapshot_id")),
      field("Report set ID",input("report_set_id")),field("Captured at",input("captured_at"),"Use an explicit time-zone timestamp when known."),
      field("Producer",input("producer")),field("Observed at",input("observed_at"),"Use the original explicit time-zone timestamp, when supplied."),
      field("Scan job ID",input("scan_job_id")),field("Scan cycle ID",input("scan_cycle_id")),
      field("Scan mode",select("scan_mode",["unknown","full","incremental"],"unknown")),
      field("Classification capture",select("policy_only",[["unknown","Not declared"],["false","Full declared classification scope"],["true","Policy-only capture"]],"unknown")),
      el("div",{class:"full"},details("Exact CSV columns and provider header variants",el("p",{class:"help"},"Generic inventories and Purview CSVs require an explicit field map. Provider headings keep their documented meanings; map only a reviewed locale or producer variant."),maps,sample)),
      field("Column mapping review note",area("column_mapping_note"),"Required when any column or provider header is remapped.",true),
      field("Source note",area("note"),null,true)
    ],"Import retained source",data=>{
      if(!staged)throw new Error("Retain the complete source file first.");
      const context={...textFields(data,["scope_id","identity_namespace","task_id","round_label","job_id","snapshot_id","report_set_id","captured_at","producer","observed_at","scan_job_id","scan_cycle_id","note"]),role:data.role,capture_kind:data.capture_kind,encoding:data.encoding,delimiter:data.delimiter,scan_mode:data.scan_mode,coverage:{mode:data.coverage_mode,description:data.coverage_description}};
      if(data.expected_rows!==""){const n=Number(data.expected_rows);if(!Number.isSafeInteger(n)||n<0)throw new Error("Expected rows must be a nonnegative safe integer.");context.coverage.expected_rows=n;}
      if(data.policy_only!=="unknown")context.policy_only=data.policy_only==="true";
      const payload={file_sha256:staged.sha256,bytes:staged.bytes,filename:staged.filename,format:data.format,context};
      maps.querySelectorAll("select").forEach(node=>{if(node.value){payload[node.dataset.mappingKind] ||= {};payload[node.dataset.mappingKind][node.dataset.mappingKey]=node.value;}});
      if(data.column_mapping_note.trim())payload.column_mapping_note=data.column_mapping_note.trim();
      return {operation:"source.import",payload};
    },result=>{model.source=result.id;render();});
    renderMaps();
    const browse=el("div",{class:"stack"});
    const chooser=operationFreeForm([
      idField("Retained source","source_id","sources"),
      field("Find a row",input("query"),"Search within this source."),
    ],"Browse rows",async data=>{model.source=data.source_id;await sourceRows(browse,data.source_id,0,data.query);});
    if(model.source) chooser.elements.source_id.value=model.source;
    root.append(el("div",{class:"two-col"},panel("Import a report or inventory",importForm),el("div",{class:"stack"},panel("Browse original records",chooser,browse),panel("Recent sources",table("Retained inputs",[
      {label:"Source",render:r=>el("div",{},nameOf(r),el("div",{class:"mono"},idOf(r)))},
      {label:"Context",render:r=>el("div",{},human(summary(r).role || r.role),el("br"),summary(r).scope_id || "",el("br"),summary(r).round_label || "")},
      {label:"Review",render:r=>el("div",{class:"row-actions"},linkButton("Rows",async()=>{model.source=idOf(r);chooser.elements.source_id.value=idOf(r);await sourceRows(browse,idOf(r),0,"");}),linkButton("Record",async()=>jsonRecord("Source",await read("source.get",{id:idOf(r)}))))}
    ],records("sources"))))));
    return root;
  }
  function operationFreeForm(content,label,action) {
    const form=el("form",{},el("div",{class:"form-grid"},content),el("div",{class:"actions"},el("button",{type:"submit"},label)));
    form.addEventListener("submit",event=>{event.preventDefault();run(()=>action(formData(form),form));});
    return form;
  }
  function rowValues(row) {return row.values || row.normalized?.values || row.normalized || row;}
  function pageControls(page,move) {
    const start=page.total?Number(page.offset)+1:0;
    return el("div",{class:"pagination"},el("span",{},start+"–"+Math.min(Number(page.offset)+page.rows.length,Number(page.total))+" of "+page.total),el("div",{class:"actions"},
      el("button",{type:"button",disabled:page.offset<=0,onclick:()=>run(()=>move(Math.max(0,page.offset-page.limit)))},"Previous"),
      el("button",{type:"button",disabled:Number(page.offset)+page.rows.length>=Number(page.total),onclick:()=>run(()=>move(Number(page.offset)+Number(page.limit)))},"Next")));
  }
  async function sourceRows(target,id,offset,query) {
    if(!id)throw new Error("Choose a source ID.");
    const [source,page]=await Promise.all([read("source.get",{id}),read("source.rows",{id,offset,limit:50,...(query?{query}:{})})]);
    const sha=source.file_sha256 || source.sha256;
    target.replaceChildren(el("div",{class:"actions"},linkButton("Source declaration",()=>jsonRecord("Source declaration",source)),sha?el("a",{href:"/api/files/"+sha+"?filename="+encodeURIComponent(source.filename || sha),download:source.filename},"Download original bytes"):null),
      table("Original occurrences",[
        {label:"Occurrence",render:r=>el("div",{},el("span",{class:"mono"},r.id),el("div",{class:"help"},"Row "+(r.ordinal ?? r.row_ordinal ?? r.source_ref?.row_ordinal ?? "—")))},
        {label:"Item / path",render:r=>el("div",{},rowValues(r).source_id || "ID not supplied",el("br"),rowValues(r).path || rowValues(r).name || rowValues(r).reported_source || "Path not supplied")},
        {label:"Task / round",render:r=>el("div",{},rowValues(r).task_id || "—",el("br"),rowValues(r).round_label || "—")},
        {label:"Original record",render:r=>linkButton("Inspect & copy IDs",async()=>jsonRecord("Original occurrence "+r.id,await read("row.get",{id:r.id})))}
      ],page.rows),pageControls(page,next=>sourceRows(target,id,next,query)));
  }
  function rounds() {
    const selections=el("div",{class:"selection-list"},records("sources").map(source=>el("label",{class:"choice"},
      input("source_choice",idOf(source),{type:"checkbox"}),el("span",{},nameOf(source),el("small",{},sourceLabel(source))))));
    const form=operationForm([
      field("Round title",input("title","",{required:true})),field("Scope ID",input("scope_id","",{required:true})),
      field("Round label",input("round_label","",{required:true})),field("Task ID",input("task_id")),
      idField("Predecessor round","parent_round_id","rounds"),
      field("Review note",area("note"),null,true),
      el("div",{class:"full"},el("h3",{},"Select retained sources"),el("p",{class:"help"},"Select the baseline inventory and the exact target/report captures for this round."),selections),
      field("Additional exact source IDs",area("additional_sources"),"One ID per line. This also selects sources older than the recent list.",true),
      field("Per-source row selectors (optional JSON)",area("selectors","[]"),'Use [{"source_id":"…","task_id":"…","round_label":"…","job_id":"…"}] only when a file contains several tasks or rounds.',true)
    ],"Create migration round",(data,element)=>{
      const selected=[...element.querySelectorAll('[name="source_choice"]:checked')].map(node=>node.value);
      const exact=[...new Set([...selected,...ids(data.additional_sources)])];
      const selectors=requiredArray(data.selectors,"Row selectors");
      if(selectors.some(row=>!row||typeof row!=="object"||Array.isArray(row)))throw new Error("Each row selector must be an object.");
      for(const row of selectors)if(!exact.includes(row.source_id))throw new Error("A row selector must name one of the selected sources.");
      return {operation:"round.create",payload:{...textFields(data,["title","scope_id","round_label","task_id","parent_round_id","note"]),sources:exact.flatMap(source_id=>selectors.some(row=>row.source_id===source_id)?selectors.filter(row=>row.source_id===source_id):[{source_id}])}};
    });
    return el("div",{class:"stack"},heading("Migration rounds","Freeze exact source selections and optional task, job and round selectors. Later rounds reference the previous round and keep its findings available."),
      el("div",{class:"two-col"},panel("Create a round",form),panel("Recent rounds",table("Retained round editions",recentColumns("round","rounds"),records("rounds")))));
  }
  function mappingEditor(kind) {
    const list=el("div",{class:"entry-list"});
    function addEntry() {
      let fields;
      if(kind==="identity") fields=[field("Source occurrence ID",input("source_row_id","",{required:true})),field("Target occurrence ID",input("target_row_id","",{required:true})),field("Link reason",input("reason","",{required:true}),null,true)];
      else if(kind==="evidence")fields=[field("Subject occurrence ID",input("subject_row_id","",{required:true})),field("Evidence occurrence ID",input("evidence_row_id","",{required:true})),field("Evidence fields",input("fields","",{required:true}),"Separate canonical field names with commas or spaces."),field("Review reason",input("reason","",{required:true}))];
      else if(kind==="principal")fields=[field("Source principal",input("source_principal","",{required:true})),field("Destination principal",input("target_principal","",{required:true})),field("AD group flag",select("is_group",[["false","FALSE — individual"],["true","TRUE — AD group"]],"false")),field("Review reason",input("reason"))];
      else fields=[field("Original status text",input("raw_status","",{required:true})),field("Reviewed meaning",select("classification",["reported_success","reported_failure","reported_filtered","reported_in_progress"])),field("Review reason",input("reason"),null,true)];
      const entry=el("div",{class:"entry"},el("div",{class:"form-grid"},fields));
      entry.append(el("div",{class:"actions"},button("Remove entry",()=>entry.remove())));
      list.append(entry);
    }
    const form=operationForm([
      field("Mapping title",input("title","",{required:true})),
      idField("Previous mapping edition","parent_mapping_id","mappings",row=>row.kind===kind),
      idField("Imported mapping source (optional)","source_id","sources",row=>(summary(row).role||row.role)==="mapping","Use an exact imported mapping file, or add the manual entries below."),
      ...(kind==="principal"?[field("Entra fallback declaration",select("entra_fallback",["unknown","enabled","disabled"],"unknown"),"This records the chosen setting. An unresolved identity remains unresolved.")]:[]),
      field("Mapping review note",area("review_note","",{required:true}),null,true),
      el("div",{class:"full"},list,el("div",{class:"actions"},button("Add "+human(kind)+" entry",addEntry)))
    ],"Save reviewed "+human(kind)+" mapping",(data,element)=>{
      const entries=[...list.children].map(entry=>{
        const values=Object.fromEntries([...entry.querySelectorAll("input,select")].map(node=>[node.name,node.value.trim()]));
        if(kind==="principal")values.is_group=values.is_group==="true";
        if(kind==="evidence")values.fields=ids(values.fields);
        if(!values.reason)delete values.reason;
        return values;
      });
      if(data.source_id.trim()&&entries.length)throw new Error("Choose the imported mapping source or manual entries, then remove the other input.");
      const payload={...textFields(data,["title","parent_mapping_id","review_note"]),kind,...(data.source_id.trim()?{source_id:data.source_id.trim()}:{entries})};
      if(kind==="principal")payload.options={entra_fallback:data.entra_fallback};
      return {operation:"mapping.create",payload};
    });
    return form;
  }
  function mappings() {
    const evidenceChoices=el("div",{class:"checks"},["path","expected_target_path","size_bytes","content_sha256","principals","label","classified_at","migrated_at"].map(value=>el("label",{class:"choice"},input("evidence_field",value,{type:"checkbox"}),el("span",{},human(value)))));
    const evidenceForm=operationForm([
      field("Subject occurrence ID",input("subject_row_id","",{required:true})),field("Evidence occurrence ID",input("evidence_row_id","",{required:true})),
      el("div",{class:"full"},el("h3",{},"Fields supplied by this evidence"),evidenceChoices),
      field("Link review reason",area("reason","",{required:true}),"Explain why these exact occurrences refer to the same item and these fields.",true)
    ],"Retain evidence link",(data,form)=>({operation:"evidence.link",payload:{...textFields(data,["subject_row_id","evidence_row_id","reason"]),fields:[...form.querySelectorAll('[name="evidence_field"]:checked')].map(node=>node.value)}}));
    const mappingRows=el("div",{class:"stack"});
    async function showMapping(id,offset){
      const [record,page]=await Promise.all([read("mapping.get",{id}),read("mapping.rows",{id,offset,limit:50})]);
      mappingRows.replaceChildren(el("div",{class:"actions"},linkButton("Edition & review note",()=>jsonRecord("Reviewed mapping edition",record))),
        table("Complete paged mapping entries",[
          {label:"Entry",render:r=>el("span",{class:"mono"},r.id)},
          {label:"Binding",render:r=>r.source_row_id||r.source_principal||r.raw_status||r.subject_row_id||"—"},
          {label:"Destination / meaning",render:r=>r.target_row_id||r.target_principal||r.classification||r.evidence_row_id||"—"},
          {label:"Review",render:r=>linkButton("Original entry",()=>jsonRecord("Reviewed entry",r))}
        ],page.rows),pageControls(page,next=>showMapping(id,next)));
    }
    const browse=operationFreeForm([idField("Mapping edition","id","mappings")],"Read mapping entries",data=>showMapping(data.id,0));
    return el("div",{class:"stack"},heading("Reviewed mappings and evidence","Link exact retained occurrences, declare principal translations and interpret report status vocabulary. Each reviewed edition remains available to its selected reconciliation."),
      el("div",{class:"two-col"},el("div",{class:"stack"},panel("Identity links",mappingEditor("identity")),panel("Principal mapping",mappingEditor("principal"))),
        el("div",{class:"stack"},panel("Report status vocabulary",mappingEditor("status")),panel("Attach item evidence",evidenceForm),panel("Reviewed evidence collection",mappingEditor("evidence")))),
      panel("Mapping editions",browse,mappingRows,table("Recent reviewed editions",[
        {label:"Mapping",render:r=>el("div",{},nameOf(r),el("div",{class:"mono"},r.id))},
        {label:"Kind",render:r=>human(r.kind)},
        {label:"Review",render:r=>linkButton("Open",async()=>jsonRecord("Reviewed mapping",await read("mapping.get",{id:r.id})))}
      ],records("mappings"))),panel("Recent evidence links",table("Exact item evidence",[
        {label:"Link",render:r=>el("span",{class:"mono"},r.id)},
        {label:"Subject / evidence",render:r=>el("div",{},r.subject_row_id,el("br"),r.evidence_row_id)},
        {label:"Fields",render:r=>show(r.fields)},
        {label:"Review",render:r=>linkButton("Open link",()=>jsonRecord("Evidence link",r))}
      ],records("evidence_links"))));
  }
  function reconciliations() {
    const checkboxes=el("div",{class:"checks"},checks.map(value=>el("label",{class:"choice"},input("check",value,{type:"checkbox",checked:true}),el("span",{},human(value)))));
    const create=operationForm([
      field("Reconciliation title",input("title","",{required:true})),idField("Selected migration round","round_id","rounds"),
      field("Identity policy",select("identity_mode",[["shared_source_id","Shared source ID namespace"],["explicit_map","Reviewed occurrence mapping"]],"shared_source_id")),
      field("Target observation basis",select("target_basis",[["target_inventory","Target inventory"],["migration_items","Attempted-item migration report"]],"target_inventory"),"Choose one observation population. A report alone cannot prove target absence."),
      field("Identity policy reason",area("identity_reason","",{required:true}),null,true),
      idField("Identity mapping edition","identity_mapping_id","mappings",row=>row.kind==="identity"),
      idField("Principal mapping edition","principal_mapping_id","mappings",row=>row.kind==="principal"),
      idField("Status mapping edition","status_mapping_id","mappings",row=>row.kind==="status"),
      idField("Evidence mapping edition","evidence_mapping_id","mappings",row=>row.kind==="evidence","Select a reviewed evidence collection for any number of imported original links."),
      field("Evidence link IDs",area("evidence_link_ids"),"One exact link ID per line."),
      el("div",{class:"full"},el("h3",{},"Field checks"),checkboxes)
    ],"Run selected reconciliation",(data,form)=>({operation:"reconciliation.create",payload:{
      ...textFields(data,["title","round_id","identity_mapping_id","principal_mapping_id","status_mapping_id","evidence_mapping_id"]),
      identity_policy:{mode:data.identity_mode,reason:data.identity_reason},target_basis:data.target_basis,
      evidence_link_ids:ids(data.evidence_link_ids),checks:[...form.querySelectorAll('[name="check"]:checked')].map(node=>node.value)
    }}),result=>{model.reconciliation=result.id;render();});
    const resultArea=el("div",{class:"stack"});
    const browse=operationFreeForm([
      idField("Reconciliation","id","reconciliations"),
      field("Finding state",select("status",[["","All states"],...statuses.map(value=>[value,human(value)])],"")),
      field("Search findings",input("query")),
      idField("Compare against earlier reconciliation","before_id","reconciliations")
    ],"Load findings",data=>loadFindings(resultArea,data,0));
    if(model.reconciliation)browse.elements.id.value=model.reconciliation;
    const recent=table("Recent reconciliation runs",[
      {label:"Run",render:r=>el("div",{},nameOf(r),el("div",{class:"mono"},r.id))},
      {label:"Selected round",render:r=>el("span",{class:"mono"},r.round_id || r.request?.round_id || "—")},
      {label:"Review",render:r=>el("div",{class:"row-actions"},linkButton("Findings",async()=>{browse.elements.id.value=r.id;model.reconciliation=r.id;await loadFindings(resultArea,{id:r.id},0);}),linkButton("Summary",async()=>jsonRecord("Reconciliation summary",await read("reconciliation.get",{id:r.id}))))}
    ],records("reconciliations"));
    return el("div",{class:"stack"},heading("Reconciliation","Compare the selected baseline with an explicit observation population. Inspect original field values and evidence references before deciding how to address a finding."),
      details("Create a reconciliation",create),panel("Findings",browse,resultArea),panel("Recent runs",recent));
  }
  async function loadFindings(target,data,offset) {
    if(!data.id)throw new Error("Choose a reconciliation.");
    const [record,page]=await Promise.all([read("reconciliation.get",{id:data.id}),read("reconciliation.items",{id:data.id,offset,limit:50,...textFields(data,["status","query","before_id"])})]);
    const compare=data.before_id?await read("reconciliation.compare",{before_id:data.before_id,after_id:data.id}):null;
    model.reconciliation=data.id;
    target.replaceChildren(el("div",{class:"actions"},linkButton("Selected inputs & coverage",()=>jsonRecord("Reconciliation inputs and coverage",record)),compare?linkButton("Round comparison",()=>jsonRecord("Comparison by baseline occurrence",compare)):null),
      table("Item findings",[
        {label:"State",render:r=>badge(r.status)},
        {label:"Item",render:r=>el("div",{},r.path || r.source_path || r.expected?.values?.path || r.expected?.values?.source_id || r.source_id || r.expected_row_id || r.baseline_row_id || r.source_row_id || r.id,el("div",{class:"mono"},r.id))},
        {label:"Field results",render:r=>{const c=r.checks || r.fields || {};return Array.isArray(c)?c.map(x=>human(x.field)+": "+x.status).join(" · "):Object.entries(c).map(([k,v])=>human(k)+": "+(v.status||show(v))).join(" · ");}},
        {label:"Review",render:r=>el("div",{class:"row-actions"},linkButton("Field evidence",()=>findingRecord(r,data.id)),linkButton("Open correction",()=>newCorrection(r,data.id)))}
      ],page.rows),pageControls(page,next=>loadFindings(target,data,next)));
  }
  function findingRecord(item,reconciliationId) {
    $("#record-heading").textContent="Finding "+item.id;
    const record=el("pre",{tabindex:"0"},JSON.stringify(item,null,2));
    const refs=new Set();
    function collect(value,key=""){
      if(Array.isArray(value)){value.forEach(v=>collect(v,key));return;}
      if(value&&typeof value==="object"){Object.entries(value).forEach(([k,v])=>collect(v,k));return;}
      if(typeof value==="string"&&(/row_id$/.test(key)||key==="row_id"))refs.add(value);
    }
    collect(item);
    $("#record-body").replaceChildren(el("p",{},badge(item.status)," · Reconciliation ",el("span",{class:"mono"},reconciliationId)),
      el("div",{class:"actions"},[...refs].map(id=>linkButton("Original "+id,async()=>jsonRecord("Original occurrence",await read("row.get",{id}))))),record);
    if(!$("#record-dialog").open)$("#record-dialog").showModal();
  }
  function newCorrection(item,reconciliationId) {
    model.correction={item,reconciliationId};
    go("corrections");
  }
  function corrections() {
    const draft=model.correction;
    const form=operationForm([
      idField("Finding reconciliation","reconciliation_id","reconciliations"),
      field("Finding item ID",input("item_id",draft?.item.id||"",{required:true})),
      field("Correction title",input("title","",{required:true})),
      field("Assigned to",input("assigned_to")),
      field("Review note",area("note","",{required:true}),null,true),
      field("Evidence occurrence IDs",area("evidence_row_ids"),"One exact retained row ID per line.",true)
    ],"Open correction",data=>({operation:"correction.create",payload:{...textFields(data,["reconciliation_id","item_id","title","assigned_to","note"]),evidence_row_ids:ids(data.evidence_row_ids)}}),()=>{model.correction=null;render();});
    if(draft)form.elements.reconciliation_id.value=draft.reconciliationId;
    const update=operationForm([
      idField("Correction","id","corrections"),
      field("Decision state",select("status",["open","in_progress","waiting_evidence","resolved","accepted_variance","withdrawn"],"in_progress")),
      field("Decision note",area("note","",{required:true}),null,true),
      field("Evidence occurrence IDs",area("evidence_row_ids"),null,true),
      idField("Later matching reconciliation","verification_reconciliation_id","reconciliations"),
      field("Later matching item ID",input("verification_item_id"),"Resolution requires a later MATCH for the same baseline occurrence.")
    ],"Record correction decision",data=>{
      const payload={...textFields(data,["id","status","note"]),evidence_row_ids:ids(data.evidence_row_ids)};
      if(data.verification_reconciliation_id||data.verification_item_id)payload.verification={reconciliation_id:data.verification_reconciliation_id,item_id:data.verification_item_id};
      return {operation:"correction.update",payload};
    });
    const browse=operationFreeForm([idField("Exact correction ID","id","corrections")],"Open correction history",async data=>jsonRecord("Correction history",await read("correction.get",{id:data.id})));
    return el("div",{class:"stack"},heading("Correction queue","Assign and document the work needed to address a finding. A later reconciliation can resolve the same baseline occurrence; an accepted variance remains a recorded decision."),
      panel("Recent correction states",browse,table("Correction queue",[
        {label:"Correction",render:r=>el("div",{},nameOf(r),el("div",{class:"mono"},r.id))},
        {label:"State",render:r=>badge(r.status)},
        {label:"Assignee",render:r=>r.assigned_to||"Unassigned"},
        {label:"History",render:r=>linkButton("Open",async()=>jsonRecord("Correction",await read("correction.get",{id:r.id})))}
      ],records("corrections"))),
      el("div",{class:"two-col"},panel("Open a correction",form),panel("Update a correction",update)));
  }
  async function recover(request) {
    let operation;
    try{operation=await read("operation.get",{id:request.payload.operation_id});}
    catch(error){
      if(error.code!=="OPERATION_NOT_FOUND")throw error;
      jsonRecord("Request not yet reserved",{operation:request.operation,request:request.payload,message:"No retained operation was found. Retry the same request from Handover & history if this revision is still the intended input."});
      return;
    }
    if(operation.status==="SUCCEEDED"){
      model.pending.delete(request.payload.operation_id);savePending();await refresh();setNotice("The original operation completed; its saved result has been recovered.");
    }
    jsonRecord("Original operation",operation);
  }
  function catalogue() {
    const results=el("div",{class:"stack"});
    const kinds=["source","round","mapping","evidence_link","reconciliation","correction","delivery","workspace_edit"];
    const form=operationFreeForm([field("Record kind",select("kind",kinds,"source")),field("Search retained records",input("query"))],"Search all records",data=>load(data,0));
    async function load(data,offset){
      const page=await read("entity.list",{kind:data.kind,offset,limit:50,...textFields(data,["query"])});
      results.replaceChildren(table("All retained "+human(data.kind)+" records",[
        {label:"Record",render:r=>el("div",{},nameOf(r),el("div",{class:"mono"},idOf(r)))},
        {label:"State / kind",render:r=>r.status?badge(r.status):human(r.kind || data.kind)},
        {label:"Selected context",render:r=>el("div",{},r.context?.scope_id || r.scope_id || "",el("br"),r.context?.round_label || r.round_label || "")},
        {label:"Details",render:r=>el("div",{class:"row-actions"},linkButton("Open record",()=>jsonRecord(human(data.kind),r)),
          data.kind==="source"?linkButton("Browse rows",()=>{model.source=r.id;go("sources");}):null,
          data.kind==="reconciliation"?linkButton("Findings",()=>{model.reconciliation=r.id;go("reconciliations");}):null,
          data.kind==="delivery"?el("a",{href:"/api/deliveries/"+encodeURIComponent(r.id)},"Download ZIP"):null)}
      ],page.rows),pageControls(page,next=>load(data,next)));
    }
    return el("div",{class:"stack"},heading("All retained records","Search the complete workspace catalogue. Results are paged; recent lists elsewhere are shortcuts and do not limit the retained project."),panel("Workspace catalogue",form,results));
  }
  function handover() {
    const prepare=operationForm([
      field("Handover title",input("title","Migration workbench handover",{required:true}),null,true),
      field("Operator handover note",area("note"),"Record the receiving operator's immediate work, selected results and unresolved items.",true)
    ],"Prepare complete editable delivery",data=>({operation:"delivery.prepare",payload:textFields(data,["title","note"])}));
    const resume=operationForm([
      idField("Original operation ID","target_operation_id","operations"),
      field("Continuation reason",area("reason","",{required:true}),"Continue the retained input and selected revision of an interrupted operation.",true)
    ],"Continue original operation",data=>({operation:"operation.resume",payload:textFields(data,["target_operation_id","reason"])}));
    const pending=table("Requests awaiting a confirmed result",[
      {label:"Request",render:r=>el("div",{},human(r.operation),el("div",{class:"mono"},r.payload.operation_id))},
      {label:"Selected revision",render:r=>r.payload.expected_revision},
      {label:"Actions",render:r=>el("div",{class:"row-actions"},
        linkButton("Inspect original",()=>recover(r)),
        linkButton("Retry same request",async()=>{
          const result=await api("/api/operations",r);
          model.pending.delete(r.payload.operation_id);savePending();await refresh();setNotice("Original request complete at revision "+result.revision+".");
        }),
        linkButton("Request details",()=>jsonRecord("Original request",r)))}
    ],[...model.pending.values()],"No unanswered requests are retained in this browser tab.");
    const histories=el("div",{class:"stack"});
    const loadHistory=async offset=>{
      const page=await read("events",{offset,limit:50});
      histories.replaceChildren(table("Workspace event history",[
        {label:"Revision",render:r=>r.revision},
        {label:"Action",render:r=>human(r.kind || r.event || r.type)},
        {label:"Operator",render:r=>r.actor},
        {label:"Time",render:r=>r.created_at || r.at || "—"},
        {label:"Details",render:r=>linkButton("Open event",()=>jsonRecord("Workspace event",r))}
      ],page.rows),pageControls(page,loadHistory));
    };
    return el("div",{class:"stack"},heading("Complete handover and retained history","Export the entire editable workspace, original source files, application and review history. An operator can reopen the delivery locally and continue the same project."),
      el("div",{class:"two-col"},panel("Prepare handover",prepare,note("The delivery captures the selected workspace revision. The sender records the export operation afterward; the receiving project starts from the captured revision.")),
        panel("Receive and continue",
          el("ol",{},el("li",{},"Download the complete ZIP and transfer it through your normal project channel."),el("li",{},"Use the receive command below from this application directory. It verifies and restores the complete application and workspace."),el("li",{},"Start the included workbench against the received workspace. Later changes append to the same review history.")),
          el("pre",{},'python migration_portable.py receive \\\n  --archive "/path/to/Migration_Workbench_delivery.zip" \\\n  --destination "/path/to/received-migration"\n\npython "/path/to/received-migration/application/migration_server.py" \\\n  --workspace "/path/to/received-migration/workspace"'),
          el("p",{class:"help"},"Linux with Python 3.10 or later. Repeating receive for the same completed delivery preserves later workspace edits."))),
      panel("Completed deliveries",table("Complete editable downloads",[
        {label:"Delivery",render:r=>el("div",{},nameOf(r),el("div",{class:"mono"},r.id))},
        {label:"Revision / size",render:r=>el("div",{},r.revision ?? "Open details",el("br"),r.archive_bytes===undefined?"Complete retained archive":r.archive_bytes+" bytes")},
        {label:"Contents",render:r=>r.file_count===undefined?"Application, reports and workspace":r.file_count+" complete files"},
        {label:"Download",render:r=>el("div",{class:"row-actions"},el("a",{href:"/api/deliveries/"+encodeURIComponent(r.id),download:r.filename},"Download ZIP"),linkButton("File identities",async()=>jsonRecord("Complete delivery",await read("delivery.get",{id:r.id}))))}
      ],records("deliveries"))),
      panel("Unanswered browser requests",pending),
      el("div",{class:"two-col"},panel("Continue an interrupted operation",resume),panel("Recent operations",table("Original reservations",[
        {label:"Operation",render:r=>el("div",{},human(r.operation),el("div",{class:"mono"},r.id))},
        {label:"State",render:r=>badge(r.status)},
        {label:"Inspect",render:r=>linkButton("Open",async()=>jsonRecord("Original operation",await read("operation.get",{id:r.id})))}
      ],records("operations")))),
      panel("Full event history",button("Load history",()=>loadHistory(0)),histories));
  }
  $("#close-dialog").addEventListener("click",()=>$("#record-dialog").close());
  $("#refresh").addEventListener("click",()=>run(async()=>{await refresh();setNotice("Workspace refreshed at revision "+model.state.project.revision+".");}));
  try{$("#actor").value=sessionStorage.getItem("migration-actor")||"";}catch{}
  $("#actor").addEventListener("change",()=>{try{sessionStorage.setItem("migration-actor",$("#actor").value);}catch{}});
  run(async()=>{[model.state,model.schema]=await Promise.all([api("/api/state"),api("/api/schema")]);loadPending();await refresh();setNotice("Workspace ready. Select a section to continue.");});
})();

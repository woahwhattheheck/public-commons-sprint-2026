import {openReviewStore} from "/review-store.js";
const $ = id => document.getElementById(id);
const token = document.querySelector('meta[name="publication-review-token"]').content;
const ui = {state:null, tab:"publications",store:null,scope:null,pending:{},drafts:{},draftWrites:new Map()};
const el=(tag,text="",className="")=>{const e=document.createElement(tag);if(text!==undefined&&text!==null)e.textContent=String(text);if(className)e.className=className;return e;};
const clear=e=>e.replaceChildren();
const pretty=value=>JSON.stringify(value,null,2);
const notice=message=>{$("notice").textContent=message||"";};
const bytes=n=>new Intl.NumberFormat().format(n)+" bytes";
const id=prefix=>prefix+"-"+crypto.randomUUID().replaceAll("-","");
const bodyURL=(capture,download=false)=>"/api/captures/"+encodeURIComponent(capture.operation_id)+"/body"+(download?"?download=1":"");
function link(title,url){const a=el("a",title);a.href=url;return a;}
function button(title,fn,cls=""){const b=el("button",title,cls);b.type="button";b.addEventListener("click",()=>Promise.resolve().then(fn).catch(showError));return b;}
function showError(error){notice((error.code?error.code+": ":"")+(error.message||String(error)));}
async function api(path,body){const options=body?{method:"POST",headers:{"Content-Type":"application/json","X-Publication-Review-Token":token},body:JSON.stringify(body)}:{};const r=await fetch(path,options);const value=await r.json();if(!r.ok||value.error){const e=new Error(value.error?.message||"The original operation could not be read");Object.assign(e,value.error||{});throw e;}return value;}
function pending(){return ui.pending;}
async function retainPending(payload){await ui.store.putPending(payload);ui.pending[payload.operation_id]=payload;}
async function removePending(operationId){await ui.store.removePending(operationId);delete ui.pending[operationId];}
function persistDraft(captureId,draft){
  ui.drafts[captureId]={...draft};
  const previous=ui.draftWrites.get(captureId)||Promise.resolve();
  const write=previous.catch(()=>{}).then(()=>ui.store.putDraft(captureId,draft));
  ui.draftWrites.set(captureId,write);
  write.catch(showError);
  return write;
}
async function currentDraft(captureId){
  await (ui.draftWrites.get(captureId)||Promise.resolve());
  return {...ui.drafts[captureId]};
}
function actor(){const value=$("actor").value.trim();if(!value)throw new Error("Enter the operator name used for this review.");localStorage.setItem("qwc-publication-review.actor",value);return value;}
function selectedRun(select){return ui.state.runs.find(r=>r.id===$(select).value);}
function latestReview(capture){return (ui.state.reviews[capture.operation_id]||[]).at(-1);}
function allCaptures(run){return Object.values(run.results).flat();}
function details(title,value){const d=el("details");d.append(el("summary",title),el("pre",typeof value==="string"?value:pretty(value)));return d;}
function badge(value,review=false){return el("span",value,"badge"+(review?" review":""));}
function sectionTab(name){ui.tab=name;document.querySelectorAll(".tab").forEach(e=>e.hidden=e.id!==name);document.querySelectorAll("nav button").forEach(e=>e.classList.toggle("active",e.dataset.tab===name));}
function fillRuns(select){const e=$(select),old=e.value;clear(e);for(const run of ui.state.runs){const option=el("option",run.title);option.value=run.id;e.append(option);}if(ui.state.runs.some(r=>r.id===old))e.value=old;}
function renderPublications(){const target=$("publication-list");clear(target);if(!ui.state.runs.length){target.append(el("div","Retain the publisher's original plan and source manifests to begin.","empty"));return;}for(const run of ui.state.runs){const card=el("article",null,"card"),top=el("div",null,"card-top");top.append(el("h3",run.title),badge(run.id));card.append(top,el("p",run.service.url,"mono small"));const captures=allCaptures(run);card.append(el("p",run.checks.length+" native operations · "+run.roles.length+" existing role views · "+captures.length+" retained responses"));card.append(details("Original publication and selected service",{publication:run.publication,service:run.service,plan_sha256:run.plan.sha256}));const sources=el("div",null,"source-links");run.sources.forEach((source,index)=>sources.append(link(source.path.split("/").at(-1)+" · "+bytes(source.bytes),"/api/runs/"+encodeURIComponent(run.id)+"/sources/"+index)));card.append(sources);card.append(button("Open native responses",()=>{$("capture-run").value=run.id;renderCapture();sectionTab("capture");}));target.append(card);}}
function renderCapture(){const target=$("capture-matrix"),context=$("capture-context");clear(target);clear(context);const run=selectedRun("capture-run");if(!run){target.append(el("div","Select a retained original publication.","empty"));return;}const sessions=new Set(ui.state.session_roles);const roles=run.roles.map(role=>role.title+": "+(role.authentication==="anonymous"?"anonymous native view":sessions.has(role.id)?"existing session selected":"existing session needed"));context.append(el("p",roles.join(" · "),"small"));if(ui.state.session_error)context.append(el("p",ui.state.session_error.message,"small"));const table=el("table"),head=el("tr");head.append(el("th","Native operation"));for(const role of run.roles)head.append(el("th",role.title));const thead=el("thead");thead.append(head);table.append(thead);const tbody=el("tbody");for(const check of run.checks){const row=el("tr");const name=el("td");name.append(el("strong",check.title),el("div",check.operation,"small"));row.append(name);for(const role of run.roles){const cell=el("td");const captures=run.results[check.id+"/"+role.id]||[];const latest=captures.at(-1);if(latest){cell.append(badge(latest.evaluation.state,latest.evaluation.state!=="PASS"),el("div","HTTP "+latest.response.status+" · "+captures.length+" response"+(captures.length===1?"":"s"),"small"));}else cell.append(el("div","Awaiting response","small"));const ready=role.authentication==="anonymous"||sessions.has(role.id);const b=button(latest?"Capture new response":"Capture response",()=>dispatch({action:"capture",run_id:run.id,check_id:check.id,role_id:role.id,operation_id:id("capture"),actor:actor()}));b.disabled=!ready;cell.append(b,button("Import original response",()=>openNativeImport(run,check,role)));row.append(cell);}tbody.append(row);}table.append(tbody);const wrap=el("div",null,"table-wrap");wrap.append(table);target.append(wrap,details("Selected original request plan",run.checks));}
function reviewForm(capture){
  const captureId=capture.operation_id,old=latestReview(capture),retained=ui.drafts[captureId];
  const starting=retained||{decision:old?.decision||"accepted",note:old?.note||"",base_revision:ui.state.revision};
  const form=el("div",null,"review-form"),choice=el("select");
  for(const [value,title] of [["accepted","Accepted"],["correction_required","Correction required"],["not_applicable","Not applicable"]]){
    const option=el("option",title);option.value=value;choice.append(option);
  }
  choice.value=starting.decision;
  const label=el("label","Decision");label.append(choice);
  const note=el("textarea");note.rows=3;note.maxLength=8000;note.value=starting.note;
  note.placeholder="Record what you inspected and any required correction.";
  const noteLabel=el("label","Operator note");noteLabel.append(note);
  const status=el("p",retained?"Unfinished note retained at revision "+retained.base_revision:"Review starts at revision "+starting.base_revision,"small");
  const readDraft=()=>({decision:choice.value,note:note.value,base_revision:starting.base_revision});
  const changed=()=>{persistDraft(captureId,readDraft()).then(()=>{status.textContent="Unfinished note saved in this browser · revision "+starting.base_revision;}).catch(()=>{});};
  choice.addEventListener("change",changed);note.addEventListener("input",changed);
  const save=button("Save review",async()=>{
    if(!note.value.trim())throw new Error("Add the operator's review note.");
    const submitted=readDraft();await persistDraft(captureId,submitted);
    await dispatch({action:"review",capture_id:captureId,decision:submitted.decision,note:submitted.note,
      operation_id:id("review"),actor:actor(),expected_revision:submitted.base_revision});
    const removed=await ui.store.removeDraft(captureId,submitted);
    if(removed.removed)delete ui.drafts[captureId];else ui.drafts[captureId]=removed.draft;
    renderReview();
  },"primary");
  const discard=button("Discard unfinished note",async()=>{
    await (ui.draftWrites.get(captureId)||Promise.resolve()).catch(()=>{});
    await ui.store.removeDraft(captureId);delete ui.drafts[captureId];renderReview();
  });
  form.append(label,noteLabel,status,save,discard);
  if(starting.base_revision!==ui.state.revision){
    form.append(el("p","This note began at revision "+starting.base_revision+". The workspace is now at revision "+ui.state.revision+". Review the current original response and latest saved decision before updating the note's revision.","small"));
    form.append(details("Current saved decision",old||{state:"No saved decision"}));
    form.append(button("Use current revision after review",async()=>{
      await persistDraft(captureId,readDraft());
      const expected=await currentDraft(captureId);
      const rebased=await ui.store.rebaseDraft(captureId,ui.state.revision,expected);
      ui.drafts[captureId]=rebased;renderReview();
    }));
  }
  return form;
}
function renderReview(){const target=$("review-cards");clear(target);const run=selectedRun("review-run");if(!run){target.append(el("div","Select a retained publication.","empty"));return;}const filter=$("review-filter").value;let count=0;for(const check of run.checks){for(const role of run.roles){const captures=run.results[check.id+"/"+role.id]||[];for(const capture of captures){const previous=latestReview(capture);if(filter==="unreviewed"&&previous||filter==="correction_required"&&previous?.decision!=="correction_required")continue;count++;const card=el("article",null,"card"),top=el("div",null,"card-top"),labels=el("div",null,"badges");labels.append(badge(capture.evaluation.state,capture.evaluation.state!=="PASS"),badge(previous?previous.decision:"Awaiting review",!previous));top.append(el("h3",check.title+" · "+role.title),labels);card.append(top,el("p","HTTP "+capture.response.status+" · "+capture.response.observed_at+" · "+bytes(capture.body.bytes),"small"));card.append(link("Open original "+(check.operation==="GetPrint"?"print PDF":"response"),bodyURL(capture,true)));if(check.operation==="GetMap"&&capture.response.media_type.split(";")[0]==="image/png"){const img=el("img",undefined,"map-output");img.alt="Original native map for "+check.title+" in "+role.title;img.loading="lazy";img.src=bodyURL(capture);card.append(img);}if(capture.evaluation.issues.length)card.append(details("Native findings",capture.evaluation.issues));card.append(details("Resolved native response",capture.evaluation.model),details("Original request and response identity",{request:capture.request,response:capture.response,body:capture.body,role_id:capture.role_id,principal_reference:capture.principal_reference,operation_id:capture.operation_id}));if(previous)card.append(el("p","Last reviewed by "+previous.actor+" at "+previous.at,"small"));card.append(reviewForm(capture));const history=ui.state.reviews[capture.operation_id]||[];if(history.length>1)card.append(details("All retained review decisions",history));target.append(card);}}}if(!count)target.append(el("div","No captured responses match this view.","empty"));}
function captureById(captureId){for(const run of ui.state.runs){for(const capture of allCaptures(run))if(capture.operation_id===captureId)return capture;}return null;}
async function compare(){const left=$("compare-left").value,right=$("compare-right").value;if(!left||!right||left===right)throw new Error("Select two different retained publication editions.");const data=await api("/api/compare?left="+encodeURIComponent(left)+"&right="+encodeURIComponent(right));const target=$("comparison");clear(target);target.append(details("Original publication identities",{earlier:data.left_publication,later:data.right_publication}));for(const change of data.changes){const card=el("article",null,"card");card.append(el("h3",change.check_id+" · "+change.role_id));const labels=el("div",null,"badges");labels.append(badge(change.state));if(change.request_changed)labels.append(badge("Request selection changed",true));card.append(labels);const a=captureById(change.left),b=captureById(change.right);if(a&&b){card.append(el("p","Native outcomes: "+change.evaluation.join(" → ")+" · HTTP "+change.status.join(" → "),"small"));if(a.request.operation==="GetMap"&&b.request.operation==="GetMap"){const pair=el("div",null,"image-pair");for(const [label,value] of [["Earlier original map",a],["Later original map",b]]){const figure=el("figure"),img=el("img");img.alt=label;img.src=bodyURL(value);img.loading="lazy";figure.append(img,el("figcaption",label+" · "+value.response.observed_at));pair.append(figure);}card.append(pair);}if(change.model_changes.length){card.append(details("Changed native layer, feature or layout values",change.model_changes));}else card.append(el("p","Resolved native values are unchanged.","small"));if(change.request_changed)card.append(details("Original request difference",{earlier:a.request,later:b.request}));const links=el("div",null,"source-links");links.append(link("Earlier original response",bodyURL(a,true)),link("Later original response",bodyURL(b,true)));card.append(links);}else card.append(el("p","The selected role and operation need their corresponding original response in both editions."));target.append(card);}}
function renderDelivery(){const target=$("delivery-summary");clear(target);const captures=ui.state.runs.flatMap(allCaptures),reviewed=captures.filter(c=>latestReview(c)),corrections=captures.filter(c=>latestReview(c)?.decision==="correction_required");const metrics=el("div",null,"metrics");for(const [n,label] of [[ui.state.runs.length,"Publication editions"],[captures.length,"Native responses"],[reviewed.length,"Reviewed responses"],[corrections.length,"Corrections retained"]]){const metric=el("div",null,"metric");metric.append(el("strong",n),el("span",label));metrics.append(metric);}target.append(metrics);const exports=$("exports");clear(exports);for(const [operationId,operation]of Object.entries(ui.state.operations).reverse()){if(operation.kind!=="export")continue;const card=el("article",null,"card");card.append(el("h3",operationId),el("p",operation.view_state||operation.state,"small"));if(operation.state==="COMPLETE"){card.append(link("Download complete original handover","/api/exports/"+encodeURIComponent(operationId)),details("Original archive identity",operation.result));}else if(operation.view_state==="RETAINED_RUNNING_HISTORY")card.append(el("p","This entry is the original archive's historical in-progress snapshot. Use Export complete handover for a new receiving edition."));else if(operation.error)card.append(details("Original export outcome",operation.error));exports.append(card);}const history=$("history");clear(history);if(ui.state.receiving_context)history.append(details("Original receiving context",ui.state.receiving_context));for(const [operationId,operation] of Object.entries(ui.state.operations).reverse()){const row=el("div",null,"history-operation");row.append(el("strong",operation.kind+" · "+(operation.view_state||operation.state)),el("div",operationId+" · "+operation.actor+" · "+operation.started_at,"small"),details("Original retained operation",operation));history.append(row);}}
function renderPending(){const target=$("pending-actions");clear(target);for(const [operationId,payload] of Object.entries(pending())){const card=el("div",null,"card");card.append(el("h3","Retained local action"),el("p",payload.action+" · "+operationId,"mono small"),button("Resume same action",()=>dispatch(payload,true)),button("Release local pending marker",async()=>{await removePending(operationId);renderPending();}));target.append(card);}}
function render(){const state=ui.state;$("workspace-title").textContent=state.title;$("workspace-details").textContent="Workspace "+state.id+"\nRevision "+state.revision;for(const name of ["capture-run","review-run","compare-left","compare-right"])fillRuns(name);if(state.runs.length>1&&$("compare-left").value===$("compare-right").value)$("compare-right").value=state.runs.at(-1).id;renderPublications();renderCapture();renderReview();renderDelivery();renderPending();}
async function refresh(){
  const state=await api("/api/state"),context=state.receiving_context?.archive_sha256||"original",scope=state.id+":"+context;
  if(ui.scope!==scope){
    ui.store?.close();ui.store=await openReviewStore(state.id,context);ui.scope=scope;
    [ui.pending,ui.drafts]=await Promise.all([ui.store.listPending(),ui.store.listDrafts()]);
    if(ui.store.migrationError)showError(ui.store.migrationError);
  }
  ui.state=state;render();
}
async function dispatch(payload,resuming=false){await retainPending(payload);renderPending();let job=await api("/api/actions",payload);notice("");const progress=$("job-progress");while(job.state==="QUEUED"||job.state==="RUNNING"){progress.replaceChildren(el("div",payload.action+" · "+job.state+" · "+(job.completed||0)+"/"+(job.total||1),"progress"));await new Promise(resolve=>setTimeout(resolve,700));job=await api("/api/jobs/"+encodeURIComponent(payload.operation_id));}progress.replaceChildren();if(job.state==="FAILED"){const e=new Error(job.error?.message||"The original operation failed.");Object.assign(e,job.error||{});await refresh();throw e;}await removePending(payload.operation_id);await refresh();if(job.result?.complete===false){notice("The plan finished with retained native outcomes requiring review. Open the original operation details.");progress.append(details("Original plan outcomes",job.result));}else notice("Saved "+payload.action.replaceAll("_"," ")+" in this publication workspace.");return job.result;}
async function sourceFile(file,limit=16*1024*1024){if(file.size>limit)throw new Error("The selected original file exceeds "+bytes(limit)+".");const raw=new Uint8Array(await file.arrayBuffer());const digest=new Uint8Array(await crypto.subtle.digest("SHA-256",raw));let binary="";for(let offset=0;offset<raw.length;offset+=32768)binary+=String.fromCharCode(...raw.subarray(offset,offset+32768));return{name:file.name,base64:btoa(binary),sha256:Array.from(digest,x=>x.toString(16).padStart(2,"0")).join("")};}

function openNativeImport(run,check,role){
  $("import-native").open=true;
  $("import-title").textContent=check.title+" · "+role.title;
  $("import-native").dataset.run=run.id;$("import-native").dataset.check=check.id;$("import-native").dataset.role=role.id;
  $("import-binding").textContent=pretty({run_id:run.id,check_id:check.id,role_id:role.id,
    principal_reference:role.principal_reference??null});
  $("import-native").scrollIntoView({behavior:"smooth"});
}
async function importNativeResponse(){
  const form=$("import-native"),body=$("native-body").files[0],metadata=$("native-metadata").files[0];
  if(!form.dataset.run||!body||!metadata)throw new Error("Select the original response body and its complete original metadata file.");
  const meta=JSON.parse(await metadata.text());
  const run=ui.state.runs.find(x=>x.id===form.dataset.run),role=run.roles.find(x=>x.id===form.dataset.role);
  if(meta.role_id!==role.id||(meta.principal_reference??null)!==(role.principal_reference??null))
    throw new Error("The original metadata identifies a different role or principal. Select its original matching view.");
  const native_response={body:await sourceFile(body,32*1024*1024),metadata:await sourceFile(metadata,4*1024*1024)};
  await dispatch({action:"import_capture",run_id:run.id,check_id:form.dataset.check,role_id:role.id,
    operation_id:id("import"),actor:actor(),native_response});
  form.open=false;$("review-run").value=run.id;renderReview();sectionTab("review");
}

$("actor").value=localStorage.getItem("qwc-publication-review.actor")||"";
document.querySelectorAll("nav button").forEach(e=>e.addEventListener("click",()=>sectionTab(e.dataset.tab)));
$("refresh").addEventListener("click",()=>refresh().catch(showError));
$("new-publication").addEventListener("click",()=>{$("add-publication").open=true;$("add-publication").scrollIntoView({behavior:"smooth"});});
$("plan-file").addEventListener("change",async()=>{try{const file=$("plan-file").files[0];if(file)$("plan-json").value=pretty(JSON.parse(await file.text()));}catch(e){showError(e);}});
$("source-files").addEventListener("change",()=>{$("source-preview").textContent=Array.from($("source-files").files).map(file=>file.name+" · "+bytes(file.size)).join("\n");});
$("save-publication").addEventListener("click",async()=>{try{const plan=JSON.parse($("plan-json").value),files=Array.from($("source-files").files);if(!files.length)throw new Error("Select the original publication/source manifest files.");const sources=[];for(const file of files)sources.push(await sourceFile(file));await dispatch({action:"add_run",plan,sources,operation_id:id("publication"),actor:actor(),expected_revision:ui.state.revision});$("add-publication").open=false;$("capture-run").value=plan.run_id;renderCapture();sectionTab("capture");}catch(e){showError(e);}});
$("capture-run").addEventListener("change",()=>{$("import-native").open=false;renderCapture();});
$("import-response").addEventListener("click",()=>importNativeResponse().catch(showError));
$("review-run").addEventListener("change",renderReview);
$("review-filter").addEventListener("change",renderReview);
$("capture-all").addEventListener("click",()=>{try{const run=selectedRun("capture-run");if(!run)throw new Error("Select a publication.");dispatch({action:"capture_run",run_id:run.id,operation_id:id("plan"),actor:actor()}).catch(showError);}catch(e){showError(e);}});
$("compare").addEventListener("click",()=>compare().catch(showError));
$("export").addEventListener("click",()=>{try{dispatch({action:"export",operation_id:id("handover"),actor:actor(),expected_revision:ui.state.revision}).catch(showError);}catch(e){showError(e);}});
refresh().catch(showError);

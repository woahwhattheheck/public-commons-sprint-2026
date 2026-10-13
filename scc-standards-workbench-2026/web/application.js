const $=s=>document.querySelector(s), esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const copy=v=>structuredClone(v), pretty=v=>JSON.stringify(v,null,2);
const label=k=>String(k).replace(/([a-z])([A-Z])/g,"$1 $2").replaceAll("_"," ").replace(/\b[a-z]/g,c=>c.toUpperCase());
const WORK_SCHEMA="standards-application-working-file/v1";
const sessions=new Map(), inFlight=new WeakSet();
const integerPaths=new Set(["selection.engineering_budget_row","reviewed.authoring.selectedReviewDays","reviewed.schedule.months","reviewed.commercial.invoice_due_days","reviewed.commercial.defect_correction_days"]);
const decimalPaths=new Map([["reviewed.authoring.baseBudget",2],["reviewed.authoring.olaMaximum",2],["reviewed.authoring.maximumBudget",2],["reviewed.authoring.engineeringFee",2],["reviewed.schedule.hours_per_week",4],["reviewed.schedule.engineering_hours",4]]);
const nullableNumericPaths=new Set(["reviewed.schedule.months","reviewed.schedule.hours_per_week","reviewed.schedule.engineering_hours","reviewed.commercial.invoice_due_days","reviewed.commercial.defect_correction_days"]);
const numericPaths=new Set([...integerPaths,...decimalPaths.keys()]);
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
let context=null,work=null,data=null,epoch=0,databasePromise=null,queue=Promise.resolve();
const active=(ctx,token)=>context===ctx&&epoch===token&&ctx.isCurrent();
const endpoint=ctx=>"/api/projects/"+encodeURIComponent(ctx.project.id);
const uid=prefix=>prefix+"-"+crypto.randomUUID();
function database(){
 if(!databasePromise)databasePromise=new Promise((resolve,reject)=>{
  const request=indexedDB.open("standards-prime-application",1);
  request.onupgradeneeded=()=>{const store=request.result.createObjectStore("working",{keyPath:"branchId"});store.createIndex("projectId","projectId");};
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(request.error);
 });
 return databasePromise;
}
async function allSaved(projectId){
 const db=await database();return new Promise((resolve,reject)=>{
  const tx=db.transaction("working","readonly"),r=tx.objectStore("working").index("projectId").getAll(projectId);
  let result;r.onsuccess=()=>{result=r.result;};tx.oncomplete=()=>resolve(result||[]);tx.onabort=tx.onerror=()=>reject(tx.error);
 });
}
function persist(value=work){
 const snapshot=copy(value);snapshot.savedAt=new Date().toISOString();
 queue=queue.catch(()=>{}).then(async()=>{
  const db=await database();await new Promise((resolve,reject)=>{
   const tx=db.transaction("working","readwrite");tx.objectStore("working").put(snapshot);
   tx.oncomplete=resolve;tx.onabort=tx.onerror=()=>reject(tx.error||Error("The working file could not be saved. Download it before continuing."));
  });
 });
 return queue;
}
function fresh(projectId){
 return {schema:WORK_SCHEMA,projectId,branchId:uid("branch"),savedAt:"",title:"Application working draft",
  selection:{answer_source_id:"",form_source_id:"",rfp_source_id:"",edition_id:"",engineering_budget_row:0,evidence_source_ids:[]},
  reviewed:{},include_source_ids:[],predecessor_id:"",draftId:"",applicationId:"",
  reviewNote:"",inspection:null,pending:null,requests:[],generation:0,rawFields:{}};
}
function validWorking(value,projectId){
 const object=v=>v&&typeof v==="object"&&!Array.isArray(v);
 if(!object(value)||value.schema!==WORK_SCHEMA||value.projectId!==projectId||
    !object(value.selection)||!object(value.reviewed)||!Array.isArray(value.requests)||value.requests.length>10000||
    !Array.isArray(value.selection.evidence_source_ids)||!value.selection.evidence_source_ids.every(v=>typeof v==="string")||
    !Array.isArray(value.include_source_ids)||!value.include_source_ids.every(v=>typeof v==="string")||
    !Number.isInteger(value.generation)||value.generation<0||
    !["title","predecessor_id","draftId","applicationId","reviewNote"].every(k=>typeof value[k]==="string"))
  throw Error("Choose a complete working file from this original project.");
 if(value.rawFields!==undefined&&(!object(value.rawFields)||!Object.entries(value.rawFields).every(([k,v])=>typeof k==="string"&&typeof v==="string")))
  throw Error("The working file's unfinished fields are incomplete.");
 if(value.pending){
  const c=value.pending.command;
  if(!object(c)||!["application.save","application.freeze"].includes(c.operation)||typeof c.request_id!=="string"||!c.request_id||
     !Number.isInteger(c.expected_revision)||c.expected_revision<0||!object(c.payload)||typeof c.actor!=="string")
   throw Error("The retained pending application request is incomplete.");
 }
 value.rawFields=value.rawFields||{};
 for(const field of value.unparsedFields||[])if(field&&typeof field.path==="string"&&typeof field.text==="string")value.rawFields[field.path]=field.text;
 delete value.unparsedFields;
 return value;
}
async function allRecords(ctx,name){
 let rows=[],offset=0;
 for(;;){
  const page=await ctx.api(endpoint(ctx)+"/records/"+name+"?offset="+offset+"&limit=500");
  rows.push(...page.rows);offset+=page.rows.length;
  if(offset>=page.total)return rows;
  if(!page.rows.length)throw Error("The original record list ended before its declared count.");
 }
}
function message(text,error=false){const el=$("#application-message");if(el){el.textContent=text;el.className=error?"application-error":"application-message";}else context?.notify(text);}
function options(rows,value,caption=r=>r.title||r.label||r.id){
 return '<option value="">Choose an original record</option>'+rows.map(r=>'<option value="'+esc(r.id)+'" '+(r.id===value?"selected":"")+'>'+esc(caption(r))+"</option>").join("");
}
function scalar(path,caption,value,{long=false,readonly=false}={}){
 const attrs=' data-path="'+esc(path)+'" '+(readonly?"readonly":"");
 if(typeof value==="boolean")return '<label class="application-check"><input type="checkbox"'+attrs+(value?" checked":"")+">"+esc(caption)+"</label>";
 const shown=work.rawFields?.[path]??value;
 const area=long||(typeof shown==="string"&&(shown.length>160||shown.includes("\n")));
 const mode=numericPaths.has(path)?' inputmode="'+(decimalPaths.has(path)?"decimal":"numeric")+'"':"";
 return '<label>'+esc(caption)+(area?'<textarea'+attrs+' rows="'+(path.includes("Markdown")?12:3)+'">'+esc(shown??"")+"</textarea>":
  '<input'+attrs+' type="text"'+mode+' value="'+esc(shown??"")+'">')+"</label>";
}
function structured(path,caption,value,help=""){
 if(["reviewed.authoring.budgetRows","reviewed.authoring.phaseAmounts","reviewed.authoring.subcontractMilestones","reviewed.commercial.milestones"].includes(path))
  help+=(help?" ":"")+'Use quoted strings for decimal amounts (for example "123.45"); whole amounts may be integers.';
 return '<label>'+esc(caption)+'<textarea class="application-structured" data-json-path="'+esc(path)+'" spellcheck="false" rows="7">'+esc(work.rawFields?.[path]??pretty(value))+'</textarea>'+(help?'<small>'+esc(help)+"</small>":"")+"</label>";
}
function fieldset(title,body,open=false){return '<details class="application-section"'+(open?" open":"")+"><summary>"+esc(title)+"</summary><div>"+body+"</div></details>";}
function getPath(object,path){return path.split(".").reduce((v,k)=>v?.[k],object);}
function setPath(object,path,value){const keys=path.split(".");let target=object;for(const key of keys.slice(0,-1)){if(!target[key]||typeof target[key]!=="object")target[key]={};target=target[key];}target[keys.at(-1)]=value;}
function invalidate(){
 work.generation++;work.inspection=null;
 if(work.reviewed&&Object.keys(work.reviewed).length){work.reviewed.narrativeReviewed=false;work.reviewed.narrativeBasisSha256=null;}
}
function collect(){
 const root=$("#prime-application");
 if(!root)return;
 const signature=()=>JSON.stringify({selection:work.selection,reviewed:work.reviewed,title:work.title,reviewNote:work.reviewNote,rawFields:work.rawFields||{}});
 const before=signature();
 work.rawFields=work.rawFields||{};
 for(const input of root.querySelectorAll("[data-json-path]"))work.rawFields[input.dataset.jsonPath]=input.value;
 let firstError=null;
 for(const input of root.querySelectorAll("[data-path]")){
  const path=input.dataset.path;
  let value=input.type==="checkbox"?input.checked:input.value;
  if(numericPaths.has(path)){
   work.rawFields[path]=input.value;
   const text=input.value.trim();
   if(text===""&&nullableNumericPaths.has(path))value=null;
   else if(decimalPaths.has(path)){
    const places=decimalPaths.get(path);
    if(!new RegExp("^\\d+(?:\\.\\d{1,"+places+"})?$").test(text)){
     firstError=firstError||Error("Enter an exact nonnegative decimal for "+label(path.split(".").at(-1))+" (at most "+places+" decimal places).");
     continue;
    }
    value=text;
   }else{
    if(!/^\d+$/.test(text)||!Number.isSafeInteger(Number(text))){
     firstError=firstError||Error("Enter a nonnegative whole number for "+label(path.split(".").at(-1))+".");
     continue;
    }
    value=Number(text);
   }
   delete work.rawFields[path];
  }else if(typeof getPath(work,path)==="number"){
   // Retain the same strict integer treatment for any future scalar integer.
   work.rawFields[path]=input.value;
   if(!/^\d+$/.test(input.value.trim())||!Number.isSafeInteger(Number(input.value.trim()))){
    firstError=firstError||Error("Enter a nonnegative whole number for "+label(path.split(".").at(-1))+".");
    continue;
   }
   value=Number(input.value.trim());delete work.rawFields[path];
  }
  setPath(work,path,value);
 }
 for(const input of root.querySelectorAll("[data-json-path]")){
  try{setPath(work,input.dataset.jsonPath,JSON.parse(input.value));delete work.rawFields[input.dataset.jsonPath];}
  catch(error){firstError=firstError||Error(label(input.dataset.jsonPath.split(".").at(-1))+": "+error.message);}
 }
 work.selection.evidence_source_ids=[...root.querySelectorAll("[data-evidence-source]:checked")].map(x=>x.dataset.evidenceSource);
 if(work.reviewed.authoring)work.reviewed.authoring.outlineTable=work.reviewed.outlineMarkdown;
 if(before!==signature())invalidate();
 if(firstError)throw firstError;
}
function table(headers,rows){return '<div class="table-wrap"><table><thead><tr>'+headers.map(h=>"<th>"+esc(h)+"</th>").join("")+"</tr></thead><tbody>"+rows.map(r=>"<tr>"+r.map((cell,i)=>'<td data-label="'+esc(headers[i])+'">'+cell+"</td>").join("")+"</tr>").join("")+"</tbody></table></div>";}
function render(){
 if(!context?.isCurrent())return;
 const r=work.reviewed||{},a=r.authoring||{},applicant=r.applicant||{},schedule=r.schedule||{},commercial=r.commercial||{};
 const sources=data.sources.filter(s=>s.source_file_id);
 let html='<section id="prime-application" class="prime-application"><div class="heading"><div><p class="eyebrow">Project application</p><h1>Prime application</h1><p>Receive the original form and authored answers, prepare the applicant and budget, then save a complete application edition.</p></div></div>';
 html+='<div class="application-toolbar"><button data-application-action="sources">Add original files</button><button data-application-action="download">Download working file</button><label class="application-file">Open working file<input type="file" id="application-working-file" accept=".json"></label><a href="'+endpoint(context)+'/export?audience=private_restore">Download complete private workspace</a></div>';
 html+='<p id="application-message" class="application-message" role="status"></p>';
 if(work.pending)html+='<section class="panel"><h2>Retained request</h2><p>'+esc(work.pending.command.operation==="application.save"?"Save application draft":"Freeze application edition")+' — '+esc(work.pending.state||"Outcome to resolve")+'</p><p>The original inputs are retained with this working file.</p><button data-application-action="resolve">Resolve original request</button> <button data-application-action="retry">Continue original request</button>'+(work.pending.state==="rejected"?'<button data-application-action="revise">Keep rejected request and review current project</button>':"")+"</section>";
 const selection='<div class="application-grid">'+scalar("title","Application title",work.title)+
  '<label>Authored application JSON<select data-path="selection.answer_source_id">'+options(sources,work.selection.answer_source_id)+"</select></label>"+
  '<label>Original application form PDF<select data-path="selection.form_source_id">'+options(sources,work.selection.form_source_id)+"</select></label>"+
  '<label>Original issuer call PDF<select data-path="selection.rfp_source_id">'+options(sources,work.selection.rfp_source_id)+"</select></label>"+
  '<label>Selected standard edition<select data-path="selection.edition_id">'+options(data.editions,work.selection.edition_id)+"</select></label>"+
  scalar("selection.engineering_budget_row","Engineering budget row (first row is 0)",work.selection.engineering_budget_row)+"</div>"+
  '<details><summary>Additional private supporting sources</summary><p>Select the original qualifications, role confirmations and supporting documents used in this application.</p><div class="application-source-list">'+sources.map(s=>'<label class="application-check"><input type="checkbox" data-evidence-source="'+esc(s.id)+'" '+(work.selection.evidence_source_ids.includes(s.id)?"checked":"")+">"+esc(s.title)+"</label>").join("")+"</div></details>"+
  '<button class="primary" data-application-action="inspect">Inspect selected inputs</button>';
 html+=fieldset("1. Original sources and standard edition",selection,true);
 if(Object.keys(a).length){
  html+=fieldset("2. Applicant and project",'<div class="application-grid">'+
   scalar("reviewed.authoring.date","Application date",a.date)+
   scalar("reviewed.authoring.proposalTitle","Project title",a.proposalTitle)+
   scalar("reviewed.authoring.frenchTitle","French project title",a.frenchTitle)+
   scalar("reviewed.applicant.legal_name","Applicant legal name",applicant.legal_name)+
   scalar("reviewed.applicant.country","Applicant country",applicant.country)+
   scalar("reviewed.applicant.establishment","Permanent establishment",applicant.establishment)+
   scalar("reviewed.applicant.status","Applicant information status",applicant.status)+"</div>"+
   structured("reviewed.applicant.signers","Proposed signing contacts",applicant.signers||[])+
   structured("reviewed.applicant.contacts","Project contacts",applicant.contacts||[])+
   structured("reviewed.applicant.source_ids","Applicant supporting source IDs",applicant.source_ids||[]),true);
  html+=fieldset("3. Team and supporting requirements",
   structured("reviewed.roles","Named team roles",r.roles||[], "Use actual project people and selected source references; keep proposed and confirmed roles distinct.")+
   structured("reviewed.requirements","Application requirements and supporting documents",r.requirements||[])+
   structured("reviewed.supporters","Recorded supporters",r.supporters||[]));
  const financial='<div class="application-grid">'+
   scalar("reviewed.authoring.baseBudget","Base budget (CAD)",a.baseBudget)+
   scalar("reviewed.authoring.olaMaximum","Additional eligible language maximum (CAD)",a.olaMaximum)+
   scalar("reviewed.authoring.maximumBudget","Total planning maximum (CAD)",a.maximumBudget)+
   scalar("reviewed.authoring.engineeringFee","Engineering fee (CAD)",a.engineeringFee)+"</div>"+
   structured("reviewed.authoring.budgetRows","Cost rows: description and four phase amounts",a.budgetRows)+
   structured("reviewed.authoring.phaseAmounts","Four phase totals",a.phaseAmounts)+
   structured("reviewed.authoring.engineeringWeeks","Engineering weeks in each phase",a.engineeringWeeks)+
   structured("reviewed.authoring.subcontractMilestones","Separate engineering payment installments",a.subcontractMilestones);
  html+=fieldset("4. Budget and cash schedule",financial);
  let scheduleFields='<div class="application-grid">';
  for(const key of ["start_month","months","hours_per_week","engineering_hours","review_basis"])scheduleFields+=scalar("reviewed.schedule."+key,label(key),schedule[key]);
  scheduleFields+="</div>"+structured("reviewed.schedule.phase_months","Phase calendar",schedule.phase_months||[])+
   structured("reviewed.schedule.activities","Complete activity schedule",schedule.activities||[])+
   scalar("reviewed.authoring.selectedReviewDays","Selected review period (days)",a.selectedReviewDays)+
   scalar("reviewed.authoring.selectedReviewStart","Review begins",a.selectedReviewStart)+
   scalar("reviewed.authoring.selectedReviewEnd","Review ends",a.selectedReviewEnd)+
   scalar("reviewed.scheduleMarkdown","Reviewed schedule text",r.scheduleMarkdown,{long:true});
  html+=fieldset("5. Schedule and review period",scheduleFields);
  let commercialFields='<div class="application-grid">';
  for(const key of ["provider","status","currency","tax_basis","invoice_due_days","defect_correction_days"])commercialFields+=scalar("reviewed.commercial."+key,label(key),commercial[key]);
  commercialFields+="</div>";
  for(const key of ["milestones","included","excluded","responsibilities","source_ids"])commercialFields+=structured("reviewed.commercial."+key,label(key),commercial[key]||[]);
  commercialFields+=scalar("reviewed.offerMarkdown","Reviewed technical offer",r.offerMarkdown,{long:true});
  html+=fieldset("6. Engineering workshare",commercialFields);
  html+=fieldset("7. Complete answers and outline",scalar("reviewed.authoring.responseMarkdown","Complete application answers",a.responseMarkdown,{long:true})+
   scalar("reviewed.outlineMarkdown","Outline",r.outlineMarkdown,{long:true})+
   '<details><summary>Original form wording</summary><p>Applicant, title, date and budget cells are generated from the structured selections above. The other cells retain the reviewed wording you supply.</p>'+
   structured("reviewed.formFields","Original form fields",r.formFields||{})+"</details>");
  const reviewed=!!r.narrativeReviewed;
  html+=fieldset("8. Review and save",'<p>Inspect the complete current values and answers together. A later edit resets this review selection.</p>'+
   '<button data-application-action="preview">Review complete current inputs</button> <button data-application-action="mark-reviewed">Record review of current inputs</button>'+
   '<p>Current narrative review: <strong id="application-review-status">'+esc(reviewed?"Recorded for these exact inputs":"Not yet recorded")+"</strong></p>"+
   scalar("reviewNote","Edition review note",work.reviewNote,{long:true})+
   '<div class="application-toolbar"><button class="primary" data-application-action="save">Save application draft</button>'+
   '<button data-application-action="freeze" '+(!work.draftId?"disabled":"")+'>Freeze saved draft</button></div>'+
   '<p class="muted">Saved drafts and frozen editions retain their original inputs. An application edition is prepared work; actual applicant signatures and submission follow the selected applicant’s process.</p>',true);
 }
 if(work.inspection){
  const input=work.inspection.input_snapshot?.renderer_inputs;
  html+='<details class="application-section"><summary>Current input review and findings</summary><pre>'+esc(pretty(input))+"</pre></details>";
 }
 html+='<section class="panel"><h2>Saved application editions</h2>'+table(["Title","Prepared","Source","Documents"],data.status.editions.map(r=>[
  esc(r.title),esc(r.frozen_at),esc(r.input_sha256.slice(0,16)),
  '<a href="'+endpoint(context)+'/export?audience=application&application_id='+encodeURIComponent(r.id)+'">Download complete application ZIP</a> <button data-application-action="load-edition" data-record-id="'+esc(r.id)+'">Continue as a new draft</button>']))+"</section>";
 html+='<section class="panel"><h2>Saved drafts</h2>'+table(["Title","Saved","Actions"],data.status.drafts.map(r=>[
  esc(r.title),esc(r.recorded_at),'<button data-application-action="load-draft" data-record-id="'+esc(r.id)+'">Open draft</button>']))+"</section>";
 html+='<details class="application-section"><summary>Saved browser working files</summary><p>Each open tab keeps its own working branch. Reopening a file creates a separate branch and retains any original pending request.</p>'+
  (data.saved.length?table(["Working file","Saved","Open"],data.saved.map(s=>[esc(s.title),esc(s.savedAt),'<button data-application-action="load-branch" data-record-id="'+esc(s.branchId)+'">Open in this tab</button>'])):"<p>No earlier browser work is recorded for this project.</p>")+"</details></section>";
 $("#main").innerHTML=html;
 const root=$("#prime-application");
 const retainEdit=()=>{
  let error=null;try{collect();}catch(e){error=e;}
  persist().catch(e=>message(e.message,true));
  const reviewStatus=$("#application-review-status");if(reviewStatus)reviewStatus.textContent=work.reviewed.narrativeReviewed?"Recorded for these exact inputs":"Not yet recorded";
  if(error)message("Your unfinished text is retained. "+error.message,true);
 };
 root.addEventListener("input",retainEdit);
 root.addEventListener("change",e=>{if(e.target.matches("[data-path],[data-json-path],[data-evidence-source]"))retainEdit();});
 root.addEventListener("click",e=>{
  const button=e.target.closest("[data-application-action]");if(!button)return;e.preventDefault();
  const ctx=context,token=epoch,selected=work;
  handle(button.dataset.applicationAction,button.dataset.recordId).catch(error=>{if(active(ctx,token)&&work===selected){render();message(error.message,true);}});
 });
 $("#application-working-file").addEventListener("change",async e=>{
  const file=e.target.files[0];if(!file)return;
  const ctx=context,token=epoch,selected=work,generation=work.generation;
  try{
   if(file.size>48*1024*1024)throw Error("This working file exceeds 48 MiB.");
   const incoming=validWorking(JSON.parse(await file.text()),ctx.project.id);
   if(active(ctx,token)&&work===selected&&selected.generation===generation)await openWorking(incoming);
  }catch(error){if(active(ctx,token)&&work===selected)message(error.message,true);}
 });
}

function payload(selected=work){
 return {selection:copy(selected.selection),reviewed:copy(selected.reviewed),
  include_source_ids:copy(selected.include_source_ids||[])};
}
async function inspectCurrent(){
 collect();const ctx=context,token=epoch,generation=work.generation,selected=work;
 const result=await ctx.api(endpoint(ctx)+"/application/inspect",{method:"POST",body:JSON.stringify(payload(selected))});
 if(!active(ctx,token)||work!==selected||generation!==selected.generation)return null;
 selected.inspection=result;
 if(!Object.keys(selected.reviewed).length)selected.reviewed=copy(result.input_snapshot.reviewed);
 await persist(selected);
 return active(ctx,token)&&work===selected&&generation===selected.generation?result:null;
}
function download(){
 try{collect();}catch{}
 const result=copy(work);
 const url=URL.createObjectURL(new Blob([pretty(result)+"\n"],{type:"application/json"}));
 const a=document.createElement("a");a.href=url;a.download="application-working-"+work.projectId+".json";a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
async function recordResult(selected,command,result){
 const prior=selected.requests.find(r=>r.command?.request_id===command.request_id&&r.result);
 const matches=selected.pending?.command.request_id===command.request_id;
 if(!prior)selected.requests.push({command:copy(command),result:copy(result),resolved_at:new Date().toISOString()});
 if(!matches){
  // A late resolution can enrich the original history, never select an older
  // draft over a subsequent successful request or a later editor selection.
  if(!prior)await persist(selected);
  return false;
 }
 const acknowledged={...selected.pending,state:"acknowledged",result:copy(result)};
 selected.pending=acknowledged;
 if(result.application_draft_id){selected.draftId=result.application_draft_id;selected.predecessor_id=result.application_draft_id;}
 if(result.application_edition_id)selected.applicationId=result.application_edition_id;
 // First make the full acknowledgment and original command durable. If that
 // fails, exact request resolution/retry remains possible in the visible branch.
 await persist(selected);
 if(selected.pending?.command.request_id!==command.request_id)return false;
 selected.pending=null;
 try{await persist(selected);}
 catch(error){
  if(!selected.pending)selected.pending=acknowledged;
  throw Error("The original request was acknowledged, but the working-file update failed. Its exact request and result are retained; download the working file or resolve that same request. "+error.message);
 }
 return true;
}
async function finished(ctx,token,selected,command,result){
 const current=await recordResult(selected,command,result);
 if(current&&active(ctx,token)&&work===selected){
  await ctx.refresh();
  if(context?.project.id===selected.projectId&&work===selected)message("Saved in the original project. The complete input edition and earlier history are retained.");
 }
}
async function sendPending(){
 const ctx=context,selected=work,token=epoch;
 if(!selected.pending)throw Error("There is no retained request to continue.");
 if(inFlight.has(selected))throw Error("The original request is already in progress in this tab.");
 const command=copy(selected.pending.command);
 inFlight.add(selected);
 try{
  await persist(selected);
  let result;
  try{result=await ctx.api(endpoint(ctx)+"/operations",{method:"POST",body:JSON.stringify(command)});}
  catch(error){
   if(selected.pending?.command.request_id===command.request_id){
    selected.pending.state=[400,409].includes(error.status)?"rejected":"uncertain";
    selected.pending.error=error.message;await persist(selected);
   }
   throw error;
  }
  await finished(ctx,token,selected,command,result);
 }finally{inFlight.delete(selected);}
}
async function resolve(){
 const ctx=context,selected=work,token=epoch;
 if(!selected.pending)return;
 const command=copy(selected.pending.command);
 const result=await ctx.api(endpoint(ctx)+"/application/request",{method:"POST",body:JSON.stringify(command)});
 if(result.found&&result.matches)return finished(ctx,token,selected,command,result.result);
 if(!active(ctx,token)||work!==selected)return;
 if(result.found)throw Error("This request ID belongs to different retained inputs. Preserve this working file and inspect the original project history.");
 message("The original request is not recorded at project revision "+result.revision+". Continue its retained request or review the current project after a confirmed rejection.");
}
async function operation(name,body){
 const ctx=context,selected=work,token=epoch;
 if(selected.pending||inFlight.has(selected))throw Error("Resolve the retained request before starting another application operation.");
 selected.pending={state:"prepared",command:{operation:name,payload:copy(body),
  expected_revision:data.status.revision,request_id:uid("application-request"),actor:"Operator"}};
 await persist(selected);
 if(!active(ctx,token)||work!==selected)return;
 render();return sendPending();
}
async function openWorking(incoming){
 const ctx=context,token=epoch,selected=work;
 validWorking(incoming,ctx.project.id);
 if(selected.pending)throw Error("Resolve this tab's retained request before opening another working file.");
 try{collect();}catch{}
 const generation=selected.generation;
 await persist(selected);
 if(!active(ctx,token)||work!==selected||selected.generation!==generation||selected.pending)return;
 const next=copy(incoming);next.branchId=uid("branch");next.generation++;next.inspection=null;
 await persist(next);
 if(!active(ctx,token)||work!==selected||selected.generation!==generation||selected.pending)return;
 work=next;sessions.set(next.projectId,next);render();
}
async function loadRecord(collection,id){
 const ctx=context,token=epoch,selected=work,generation=work.generation;
 if(selected.pending)throw Error("Resolve this tab's retained request before changing its selected draft.");
 const row=await ctx.api(endpoint(ctx)+"/records/"+collection+"/"+encodeURIComponent(id));
 if(!active(ctx,token)||work!==selected||generation!==selected.generation||selected.pending)return;
 try{collect();}catch{}
 const collectedGeneration=selected.generation;
 await persist(selected);
 if(!active(ctx,token)||work!==selected||selected.generation!==collectedGeneration||selected.pending)return;
 const next=fresh(ctx.project.id),snap=row.input_snapshot;
 next.title=row.title;next.selection=copy(snap.selection);next.reviewed=copy(snap.reviewed);
 next.include_source_ids=copy(row.source_ids);next.predecessor_id=collection==="application_drafts"?row.id:row.draft_id;
 next.draftId=next.predecessor_id;next.applicationId=collection==="application_editions"?row.id:"";
 await persist(next);
 if(!active(ctx,token)||work!==selected||selected.generation!==collectedGeneration||selected.pending)return;
 work=next;sessions.set(next.projectId,next);render();
}
async function handle(action,id){
 if(action==="download")return download();
 if(action==="sources"){
  const ctx=context,token=epoch,selected=work;try{collect();}catch{}await persist(selected);
  if(active(ctx,token)&&work===selected)return ctx.openSection("sources");return;
 }
 if(action==="resolve")return resolve();
 if(action==="retry")return sendPending();
 if(action==="revise"){
  const ctx=context,token=epoch,selected=work;
  if(selected.pending?.state!=="rejected")throw Error("The original request's outcome must be resolved first.");
  if(inFlight.has(selected))throw Error("Wait for the in-progress original request to resolve.");
  const pending=copy(selected.pending),command=pending.command;
  const resolution=await ctx.api(endpoint(ctx)+"/application/request",{method:"POST",body:JSON.stringify(command)});
  if(resolution.found){if(resolution.matches)return finished(ctx,token,selected,command,resolution.result);throw Error("A different original request is recorded with this identity.");}
  if(selected.pending?.command.request_id!==command.request_id)return;
  selected.requests.push({...pending,resolved_at:new Date().toISOString(),resolution:"rejected_and_absent"});
  selected.pending=null;selected.inspection=null;await persist(selected);
  if(active(ctx,token)&&work===selected){await ctx.refresh();message("The rejected request is retained. Review the current project and save the intended new edition.");}return;
 }
 if(action==="load-draft")return loadRecord("application_drafts",id);
 if(action==="load-edition")return loadRecord("application_editions",id);
 if(action==="load-branch"){const selected=data.saved.find(s=>s.branchId===id);if(selected)return openWorking(selected);return;}
 if(action==="inspect"||action==="preview"){
  const result=await inspectCurrent();
  if(result){render();message("The complete original inputs and selected values are available for review.");}return;
 }
 if(action==="mark-reviewed"){
  collect();work.reviewed.narrativeReviewed=false;work.reviewed.narrativeBasisSha256=null;
  const ctx=context,token=epoch,selected=work,generation=work.generation;
  const result=await inspectCurrent();if(!result)return;
  const basis=result.input_snapshot.renderer_inputs.inputProvenance?.reviewBasisSha256;
  if(!basis)throw Error("The current input review did not return its complete review basis.");
  selected.reviewed.narrativeReviewed=true;selected.reviewed.narrativeBasisSha256=basis;
  await persist(selected);
  if(active(ctx,token)&&work===selected&&generation===selected.generation)render();return;
 }
 if(action==="save"){
  const ctx=context,token=epoch,selected=work;
  const result=await inspectCurrent();if(!result||!active(ctx,token)||work!==selected)return;
  return operation("application.save",{id:uid("application-draft"),title:selected.title,...payload(selected),predecessor_id:selected.predecessor_id||""});
 }
 if(action==="freeze"){
  if(!work.draftId)throw Error("Save the complete application draft first.");
  collect();const ctx=context,token=epoch,selected=work,generation=work.generation;
  const saved=await ctx.api(endpoint(ctx)+"/records/application_drafts/"+encodeURIComponent(selected.draftId));
  if(!active(ctx,token)||work!==selected||generation!==selected.generation)return;
  const savedSourceIds=new Set(saved.source_ids);
  if(!equal(saved.input_snapshot.reviewed,selected.reviewed)||!equal(saved.input_snapshot.selection,selected.selection)||
    selected.include_source_ids.some(id=>!savedSourceIds.has(id)))
   throw Error("These inputs differ from the selected saved draft. Save their new edition before freezing.");
  return operation("application.freeze",{id:uid("application-edition"),draft_id:selected.draftId,title:selected.title,review_note:selected.reviewNote});
 }
}
export async function mountApplication(ctx){
 const token=++epoch;context=ctx;
 $("#main").innerHTML='<section class="prime-application"><h1>Prime application</h1><p role="status">Opening the original project and retained working files…</p></section>';
 try{
  const [status,sources,editions,saved]=await Promise.all([
   ctx.api(endpoint(ctx)+"/application/status"),allRecords(ctx,"sources"),allRecords(ctx,"editions"),allSaved(ctx.project.id)]);
  if(!active(ctx,token))return;
  data={status,sources,editions,saved:saved.sort((a,b)=>String(b.savedAt).localeCompare(String(a.savedAt)))};
  work=sessions.get(ctx.project.id);
  if(!work){
   const prior=data.saved[0];
   work=prior?copy(validWorking(prior,ctx.project.id)):fresh(ctx.project.id);
   work.branchId=uid("branch");sessions.set(ctx.project.id,work);
  }
  render();await persist(work);
 }catch(error){
  if(active(ctx,token))$("#main").innerHTML='<section class="prime-application"><h1>Prime application</h1><p role="alert">'+esc(error.message)+"</p><p>The existing complete workspace and application editions remain available from the workspace export.</p></section>";
 }
}

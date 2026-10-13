"use strict";
/* Full original field issue/return review. All effects stay in the selected host. */
window.HighwayFieldHost=(()=>{
const clone=v=>structuredClone(v), same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const queues=new Map();
function serial(key,fn){const p=(queues.get(key)||Promise.resolve()).catch(()=>{}).then(fn);queues.set(key,p);p.finally(()=>{if(queues.get(key)===p)queues.delete(key);}).catch(()=>{});return p;}
function text(v){return JSON.stringify(v,null,2)??"(absent)";}
function element(tag,attrs={},...children){const n=document.createElement(tag);for(const[k,v]of Object.entries(attrs)){if(k==="text")n.textContent=v;else if(k==="on")for(const[e,f]of Object.entries(v))n.addEventListener(e,f);else if(k==="value")n.value=v??"";else if(k==="checked")n.checked=!!v;else if(v!==false&&v!=null)n.setAttribute(k,String(v));}for(const x of children.flat(Infinity))if(x!=null)n.append(x instanceof Node?x:document.createTextNode(String(x)));return n;}
const show=(title,value)=>element("details",{},element("summary",{},title),element("pre",{},text(value)));
function control(label,node){const id="field-exchange-"+crypto.randomUUID();node.id=id;return element("div",{class:"field"},element("label",{for:id},label),node);}
function choose(options,value="",blank="Select…"){const n=element("select",{},blank===null?null:element("option",{value:""},blank),options.map(x=>element("option",{value:x.value},x.label)));n.value=value??"";return n;}
function line(value="",extra={}){return element("input",{type:"text",value,...extra});}
function area(value="",extra={}){return element("textarea",{...extra},value);}
function panel(title,copy,...contents){return element("section",{class:"panel"},element("h2",{},title),copy?element("p",{class:"muted"},copy):null,...contents);}
async function render(main,env){
 const owner=clone(env.branch()),prefix="field-exchange:"+JSON.stringify([owner.id,owner.directory])+":";
 const workspace=clone(env.model()),active=workspace.view.fieldExchange||{issues:[],returns:[],adoptions:[]};
 const check=()=>{if(!same(owner,env.branch()))throw Error("Open the original workspace directory before continuing this field work.");};
 const read=key=>new Promise((resolve,reject)=>{const t=env.db.transaction("records","readonly"),r=t.objectStore("records").get(prefix+key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 const put=(key,value)=>new Promise((resolve,reject)=>{const t=env.db.transaction("records","readwrite");t.objectStore("records").put(value,prefix+key);t.oncomplete=resolve;t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error);});
 const all=kind=>new Promise((resolve,reject)=>{const rows=[],t=env.db.transaction("records","readonly"),r=t.objectStore("records").openCursor();r.onsuccess=()=>{const c=r.result;if(!c)return resolve(rows);if(String(c.key).startsWith(prefix+kind))rows.push(c.value);c.continue();};r.onerror=()=>reject(r.error);});
 const draftBases=new Map();
 function rememberDraft(key,value){draftBases.set(key,{version:value?.valueVersion||0,encoded:JSON.stringify(value?.values||{})});return value;}
 const headers=()=>({"Authorization":"Bearer "+env.token,"X-Workspace-Id":owner.id,"X-Workspace-Directory":owner.directory});
 async function api(path,options={}){
  check();const h=new Headers({...headers(),...(options.headers||{})});let body=options.body;
  if(body!==undefined&&!(body instanceof ArrayBuffer)&&!(body instanceof Blob)){
   body=JSON.stringify({...body,workspaceId:owner.id,workspaceDirectory:owner.directory});h.set("Content-Type","application/json");
  }
  const response=await fetch(path,{...options,body,headers:h,cache:"no-store"});
  const result=await response.json();if(!response.ok||result.error){const error=Error(result.error?.message||"The original field request did not return.");error.code=result.error?.code;error.status=response.status;throw error;}return result;
 }
 async function download(path,name){check();const response=await fetch(path,{headers:headers(),cache:"no-store"});if(!response.ok)throw Error("The original selected field file is unavailable.");const blob=await response.blob();check();const disposition=response.headers.get("Content-Disposition")||"",actual=disposition.match(/filename="([^"]+)"/);env.saveBlob(blob,actual?actual[1]:name);}
 function button(label,fn,secondary=false){const b=element("button",{type:"button",class:secondary?"secondary":""},label);b.addEventListener("click",async()=>{const disabled=b.disabled;b.disabled=true;try{check();await fn();}catch(error){env.message(error.message,true);}finally{b.disabled=disabled;}});return b;}
 async function mutateDraft(key,change){
  return serial(prefix+"draft:"+key,()=>new Promise((resolve,reject)=>{
   const tx=env.db.transaction("records","readwrite"),objects=tx.objectStore("records"),r=objects.get(prefix+"draft:"+key);let next,error;
   r.onsuccess=()=>{try{next=change(r.result);if(next!==undefined)objects.put(next,prefix+"draft:"+key);}catch(e){error=e;if(e.recovery)objects.put(e.recovery,prefix+"recovery:"+e.recovery.id);else tx.abort();}};
   tx.oncomplete=()=>error?reject(error):resolve(next);tx.onerror=()=>reject(error||tx.error);tx.onabort=()=>reject(error||tx.error);
  }));
 }
 function updateDraft(key,values,extra={}){
  const candidate=clone(values),extras=clone(extra);
  return serial(prefix+"values:"+key,async()=>{extra=extras;const encoded=JSON.stringify(candidate),candidateSha256=await env.digest(new TextEncoder().encode(encoded));
  const result=await mutateDraft(key,old=>{
   const basis=draftBases.get(key)||{version:0,encoded:"{}"};
   if((old?.valueVersion||0)!==basis.version||JSON.stringify(old?.values||{})!==basis.encoded){
    const recovery={id:crypto.randomUUID(),key,at:new Date().toISOString(),basis,current:clone(old||null),
      candidate:{values:candidate,extra:clone(extra),sha256:candidateSha256},branch:owner};
    throw Object.assign(Error("Another tab saved this field draft. Both complete copies are retained in Field draft recovery; reopen the screen and review them before continuing."),{recovery});
   }
   if(extra.rejectPending&&old?.pendingRequestId)throw Error("Resolve the original pending request before selecting a new revision.");
   const additions={...extra};delete additions.rejectPending;
   return {...old,...additions,values:candidate,valueVersion:(old?.valueVersion||0)+1,valueSha256:candidateSha256};
  });
  rememberDraft(key,result);return result;
  });
 }
 async function settle(task){
  if(!task.draftKey||!task.result)return;
  await mutateDraft(task.draftKey,old=>{
   if(!old||old.pendingRequestId!==task.id)return old;
   const unchanged=same(old.values,task.draftValues);
   const next={...old,values:unchanged?{}:old.values,pendingRequestId:null,
    valueVersion:(old.valueVersion||0)+(unchanged?1:0),
    valueSha256:unchanged?"44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a":old.valueSha256,
    settledRequestId:task.id,revision:task.result.revision,needsReview:!unchanged};
   if(draftBases.get(task.draftKey)?.encoded===JSON.stringify(old.values||{}))rememberDraft(task.draftKey,next);
   return next;
  });
 }
 async function runTaskBody(task){
  check();if(!same(task.branch,owner))throw Error("This request belongs to a different original or received directory.");
  if(task.result){await settle(task);env.message("Original field result is saved at revision "+task.result.revision+".");await env.refresh();return task.result;}
  task.attempted=true;await put("task:"+task.id,task);
  try{
   let result;
   if(task.kind==="issue")result=await api("/api/field-issue",{method:"POST",body:task.input});
   else{
    if(task.kind==="receive"&&!task.retained){
     task.retained=await api("/api/field-file",{method:"POST",body:task.fileBytes,
      headers:{"Content-Type":"application/octet-stream","X-Content-SHA256":task.fileSha256}});
     if(task.retained.sha256!==task.fileSha256||task.retained.bytes!==task.fileBytes.byteLength)throw Error("Returned-file identity changed during intake.");
     await put("task:"+task.id,task);
    }
    if(task.kind==="receive"&&!task.command){
     task.command={requestId:task.id,kind:"field.receive",actor:clone(task.actor),at:task.at,
      body:{id:task.returnId,issueId:task.retained.issueId,document:{sha256:task.fileSha256,bytes:task.fileBytes.byteLength}}};
     await put("task:"+task.id,task);
    }
    result=await api("/api/command",{method:"POST",body:{expectedRevision:task.expectedRevision,command:task.command}});
   }
   task.result=result;task.status="COMPLETE";await put("task:"+task.id,task);await settle(task);
   env.message("Field work saved at revision "+result.revision+".");await env.refresh();return result;
  }catch(error){task.lastError={code:error.code||null,status:error.status||null,message:error.message};await put("task:"+task.id,task);throw error;}
 }
 async function runTask(task){
  return serial(prefix+"task:"+task.id,async()=>runTaskBody(await read("task:"+task.id)||task));
 }
 async function begin(task,draftKey=null,draftValues=null){
  check();task={...task,branch:owner,draftKey,draftValues:clone(draftValues),status:"PENDING"};
  const persist=()=>new Promise((resolve,reject)=>{
   const tx=env.db.transaction("records","readwrite"),objects=tx.objectStore("records");let error;
   const write=old=>{try{
    if(old?.pendingRequestId)throw Error("Continue or reconcile the original pending field request before creating another.");
    objects.put(task,prefix+"task:"+task.id);
    if(draftKey){
     const basis=draftBases.get(draftKey);
     if(!basis||(old?.valueVersion||0)!==basis.version||JSON.stringify(old?.values||{})!==basis.encoded||!same(old.values,draftValues))
      throw Error("The field draft changed before dispatch. Review its complete saved copies before creating a request.");
     objects.put({...old,pendingRequestId:task.id},prefix+"draft:"+draftKey);
    }
   }catch(e){error=e;tx.abort();}};
   if(draftKey){const get=objects.get(prefix+"draft:"+draftKey);get.onsuccess=()=>write(get.result);}else write(null);
   tx.oncomplete=resolve;tx.onerror=()=>reject(error||tx.error);tx.onabort=()=>reject(error||tx.error);
  });
  if(draftKey)await serial(prefix+"draft:"+draftKey,persist);else await persist();
  return runTask(task);
 }
 async function tasksView(container){
  const tasks=(await all("task:")).sort((a,b)=>String(b.at||b.input?.request?.at).localeCompare(String(a.at||a.input?.request?.at)));
  if(!tasks.length)return;
  let offset=0;const contents=element("div");
  const draw=()=>{contents.replaceChildren(...tasks.slice(offset,offset+15).map(task=>panel(
   (task.kind==="issue"?"Issue field copy":task.kind==="receive"?"Receive field file":"Adopt returned observations")+" · "+task.id.slice(0,8),
   task.result?"Saved revision "+task.result.revision:task.lastError?.message||"Original request retained",
   show("Original request and result",{...task,fileBytes:task.fileBytes?{bytes:task.fileBytes.byteLength,sha256:task.fileSha256}:undefined}),
   element("div",{class:"actions"},
    button(task.result?"Reopen saved result":"Continue original request",()=>runTask(task),true),
    button("Check original result",async()=>{
     const found=await api("/api/request?id="+encodeURIComponent(task.id));
     if(found.request){task.result=found.request.result;task.status="COMPLETE";await put("task:"+task.id,task);await settle(task);env.message("Original command found at revision "+task.result.revision+".");await env.refresh();}
     else{task.checkedAbsentAt=new Date().toISOString();await put("task:"+task.id,task);env.message("No committed command currently exists for this UUID. The complete original request remains available.");draw();}
    },true),
    !task.result&&task.checkedAbsentAt&&[400,409].includes(task.lastError?.status)&&task.lastError?.code!=="APPLICATION_ERROR"?button("Release rejected request for revised work",async()=>{
     const found=await api("/api/request?id="+encodeURIComponent(task.id));
     if(found.request)throw Error("The original command is now saved. Reopen its result before preparing later work.");
     if(task.draftKey)await mutateDraft(task.draftKey,old=>old?.pendingRequestId===task.id?{...old,pendingRequestId:null,needsReview:true}:old);
     task.status="RELEASED_AFTER_ABSENT_READ";await put("task:"+task.id,task);env.message("Original request remains in history. Review the current workspace before a deliberately revised request.");await env.refresh();
    },true):null,
    task.fileBytes?button("Download original selected return",()=>env.saveBlob(new Blob([task.fileBytes]),task.filename||"Highway_Selected_Field_Return"),true):null)
  )),element("div",{class:"actions"},offset?button("Previous requests",()=>{offset=Math.max(0,offset-15);draw();},true):null,offset+15<tasks.length?button("More requests",()=>{offset+=15;draw();},true):null));};draw();
  container.append(panel("Field request recovery","Each request retains its original person, time, bytes, directory and revision before dispatch.",contents));
 }
 const draftKey="issue",saved=rememberDraft(draftKey,await read("draft:"+draftKey)),initial=saved?.values||{};
 const recipientName=line(initial.recipientName||"",{maxlength:200}),recipientId=line(initial.recipientId||"",{maxlength:180});
 const instruction=area(initial.note||"",{maxlength:30000});
 let selectedIds=new Set(initial.inspectionIds||[]),issueRevision=saved?.revision??workspace.revision;
 const search=line("",{placeholder:"Find an inspection or source object"}),pick=element("div");let page=0;
 const issueValues=()=>({recipientName:recipientName.value,recipientId:recipientId.value,note:instruction.value,inspectionIds:[...selectedIds]});
 const saveIssue=()=>updateDraft(draftKey,issueValues()).catch(error=>env.message("Field draft could not be saved: "+error.message,true));
 const inspections=workspace.view.inspections||[];
 const drawPick=()=>{const q=search.value.toLowerCase(),rows=inspections.filter(i=>(i.title+" "+i.id+" "+i.sourceRef.objectId).toLowerCase().includes(q));page=Math.min(page,Math.max(0,Math.floor((rows.length-1)/25)));
  pick.replaceChildren(...rows.slice(page*25,page*25+25).map(i=>element("label",{class:"field inline"},
   element("input",{type:"checkbox",checked:selectedIds.has(i.id),on:{change:event=>{if(event.target.checked)selectedIds.add(i.id);else selectedIds.delete(i.id);saveIssue();}}}),
   i.title+" · object "+i.sourceRef.objectId+" · "+i.status+" · edition "+i.currentVersion)),
   element("p",{class:"help"},selectedIds.size+" selected · "+rows.length+" matching inspections"),
   element("div",{class:"actions"},page?button("Previous inspections",()=>{page--;drawPick();},true):null,(page+1)*25<rows.length?button("More inspections",()=>{page++;drawPick();},true):null));
 };
 search.addEventListener("input",()=>{page=0;drawPick();});drawPick();
 for(const input of[recipientName,recipientId,instruction])input.addEventListener("input",saveIssue);
 const currentNotice=element("p",{class:"note"});
 const notice=()=>{currentNotice.textContent=issueRevision!==workspace.revision||saved?.needsReview?
  "This issue draft needs review against the current workspace. Its selected inspections and instructions remain unchanged.":"The issued copy will freeze complete selected inspections, forms, assignment details and original source files.";};notice();
 const issuePanel=panel("Issue a named field copy","Select saved inspections for the colleague. To start from an assignment, open its inspection in Crews & assignments first.",
  currentNotice,element("div",{class:"grid"},control("Recipient name",recipientName),control("Recipient reference",recipientId)),
  control("Field instructions",instruction),control("Find inspections",search),pick,
  element("div",{class:"actions"},
   button("Use the reviewed current workspace revision",async()=>{check();issueRevision=workspace.revision;
    await updateDraft(draftKey,issueValues(),{revision:issueRevision,needsReview:false,rejectPending:true});
    currentNotice.textContent="Current revision selected. The original inspection and source identities will be frozen in the issue.";},true),
   button("Prepare field JSON and editable HTML",async()=>{
    const d=await read("draft:"+draftKey);
    if(d?.pendingRequestId){const task=await read("task:"+d.pendingRequestId);if(!task)throw Error("The pending issue identity is retained but its original request is missing.");return runTask(task);}
    if(issueRevision!==workspace.revision||d?.needsReview||(d?.revision!==undefined&&d.revision!==workspace.revision))throw Error("Review the current workspace revision before preparing this issue.");
    const values=issueValues(),actor=env.actor(),id=crypto.randomUUID(),at=new Date().toISOString();
    if(!values.recipientName.trim()||!values.recipientId.trim()||!values.inspectionIds.length)throw Error("Enter a recipient name/reference and select at least one original inspection.");
    const request={id,recipient:{id:values.recipientId.trim(),name:values.recipientName.trim()},inspectionIds:values.inspectionIds,
     workspaceRevision:workspace.revision,stateSha256:workspace.sha256,note:values.note,actor,at};
    await updateDraft(draftKey,values);await begin({id,kind:"issue",input:{expectedRevision:workspace.revision,request},at},draftKey,values);
   })));
 main.append(issuePanel);
 const issued=element("div");let issueOffset=0;const issueRows=[...active.issues].reverse();
 const drawIssues=()=>issued.replaceChildren(...issueRows.slice(issueOffset,issueOffset+15).map(row=>panel(
  row.recipient.name+" · "+row.inspectionIds.length+" inspections",row.at+" · original revision "+row.workspaceRevision,
  element("div",{class:"actions"},
   button("Download original field JSON",()=>download("/api/field-file?kind=issues&id="+encodeURIComponent(row.id)+"&format=json","Highway_Field_Issue_"+row.id+".json"),true),
   button("Download original editable HTML",()=>download("/api/field-file?kind=issues&id="+encodeURIComponent(row.id)+"&format=html","Highway_Field_Issue_"+row.id+".html"),true)),
  show("Issued source and recipient identity",row))),element("div",{class:"actions"},issueOffset?button("Previous issued copies",()=>{issueOffset=Math.max(0,issueOffset-15);drawIssues();},true):null,issueOffset+15<issueRows.length?button("More issued copies",()=>{issueOffset+=15;drawIssues();},true):null));
 drawIssues();main.append(panel("Issued field copies","Download the exact original field files, including after receiving this complete workspace on another machine.",issued));
 const file=element("input",{type:"file",accept:".json,.html,.htm,application/json,text/html"});
 main.append(panel("Receive the colleague’s field file","Keep the complete returned JSON or editable HTML. Receiving preserves all named editions, unfinished text and attachments before any inspection changes.",
  control("Complete returned field file",file),button("Retain and receive selected file",async()=>{
   const selected=file.files[0];if(!selected)throw Error("Select the complete returned field file.");
   if(selected.size>67108864)throw Error("The complete field file exceeds 64 MiB.");
   const actor=env.actor(),at=new Date().toISOString(),bytes=await selected.arrayBuffer();check();
   const hash=await env.digest(bytes);check();
   await begin({id:crypto.randomUUID(),returnId:crypto.randomUUID(),kind:"receive",actor,at,expectedRevision:workspace.revision,
    fileBytes:bytes,fileSha256:hash,filename:selected.name});
  })));
 const returned=element("div");let returnOffset=0;const returnRows=[...active.returns].reverse();
 async function openComparison(row,editionId,target,adoption=null){
  const key="compare:"+row.id+":"+editionId,comparison=await api("/api/field-compare?id="+encodeURIComponent(row.id)+"&edition="+encodeURIComponent(editionId)+(adoption?"&adoption="+encodeURIComponent(adoption.id):""));
  const historical=comparison.readOnly===true,existing=historical?null:rememberDraft(key,await read("draft:"+key));const comparisonRevision=comparison.workspaceRevision;if(!Number.isSafeInteger(comparisonRevision))throw Error("The comparison has no exact workspace revision.");let values=historical?{note:comparison.historicalAdoption.note,items:comparison.historicalAdoption.decisions}:existing?.values||{note:"",items:comparison.items.map(i=>({inspectionId:i.inspectionId,action:"keep",choices:{},reason:""}))};
  const byId=new Map(values.items.map(x=>[x.inspectionId,x]));for(const item of comparison.items)if(!byId.has(item.inspectionId))byId.set(item.inspectionId,{inspectionId:item.inspectionId,action:"keep",choices:{},reason:""});
  let confirmed=existing?.reviewSha256?existing.reviewSha256===comparison.sha256:true;
  let expectedRevision=existing?.revision??comparisonRevision;
  const notes=area(values.note||"",{maxlength:30000}),selector=choose(comparison.items.map(i=>({value:i.inspectionId,label:"Inspection "+i.inspectionId.slice(0,8)+" · current edition "+i.currentVersion})),comparison.items[0]?.inspectionId,null);
  const body=element("div"),warning=element("p",{class:"note"});
  notes.readOnly=historical;
  const readValues=()=>({note:notes.value,items:comparison.items.map(i=>clone(byId.get(i.inspectionId)))});
  const save=()=>historical?Promise.resolve():updateDraft(key,readValues(),{reviewSha256:confirmed?comparison.sha256:existing?.reviewSha256,revision:expectedRevision});
  const saveInput=()=>save().catch(e=>env.message("Comparison choices could not be retained: "+e.message,true));
  const draw=()=>{
   const item=comparison.items.find(i=>i.inspectionId===selector.value);if(!item)return;
   const decision=byId.get(item.inspectionId),action=choose([{value:"keep",label:"Keep current inspection"},{value:"apply",label:"Apply reviewed field observations"}],decision.action,null);
   const reason=area(decision.reason||"",{maxlength:10000});action.disabled=historical;reason.readOnly=historical;
   action.addEventListener("change",()=>{decision.action=action.value;if(action.value==="keep")decision.choices={};saveInput();draw();});
   reason.addEventListener("input",()=>{decision.reason=reason.value;saveInput();});
   const fields=element("div");let fieldOffset=0;
   const drawFields=()=>fields.replaceChildren(...item.fields.slice(fieldOffset,fieldOffset+20).map(f=>{
    const choice=choose([{value:"current",label:"Use current value"},{value:"returned",label:"Use returned value"}],decision.choices[f.key]||"",f.conflict?"Choose the conflicting value":"Use nonconflicting result");
    choice.disabled=historical||decision.action!=="apply"||!item.sameSource;
    choice.addEventListener("change",()=>{if(choice.value)decision.choices[f.key]=choice.value;else delete decision.choices[f.key];saveInput();});
    return panel(f.label,f.conflict?"Both current and returned changed this value.":f.returnedChanged?"The colleague changed this value.":f.currentChanged?"The supervisor workspace changed this value.":"Value is unchanged.",
     element("div",{class:"grid three"},show("Issued",f.issued),show("Current",f.current),show("Returned",f.returned)),
     control("Receiving choice",choice));
   }),element("div",{class:"actions"},fieldOffset?button("Previous fields",()=>{fieldOffset=Math.max(0,fieldOffset-20);drawFields();},true):null,fieldOffset+20<item.fields.length?button("More fields",()=>{fieldOffset+=20;drawFields();},true):null));
   drawFields();body.replaceChildren(element("p",{class:"note"},item.sameSource?"Original form and source binding are unchanged.":item.sourceMessage),
    control("Inspection decision",action),control("Reason for this inspection",reason),
    show("Actual current source assessment",item.sourceAssessment),show("Issued assignment",item.assignment),show("Current assignment",item.currentAssignment??null),fields);
  };
  selector.addEventListener("change",draw);notes.addEventListener("input",saveInput);draw();
  const refreshWarning=()=>warning.textContent=historical?"This is the exact original receiving comparison at revision "+comparisonRevision+", with its saved decisions. Later inspection changes remain in their own history.":confirmed&&expectedRevision===comparisonRevision?
   "Review each inspection and every conflict. Changes are saved as draft inspection editions for the normal submission and supervisor process.":
   "This workspace or comparison advanced. Your earlier choices remain; review the displayed current values and explicitly accept this new comparison before applying.";
  refreshWarning();
  target.replaceChildren(panel("Review returned observations",comparison.selectedEdition.label+" · "+comparison.selectedEdition.actor.name+" · "+comparison.selectedEdition.at,
   warning,control("Inspection",selector),body,control("Overall receiving reason",notes),
   show("Complete retained unfinished draft",comparison.draft),
   element("div",{class:"actions"},
    !historical?button("Use this reviewed current comparison",async()=>{const old=await read("draft:"+key);if(old?.pendingRequestId)throw Error("Resolve the original pending adoption before choosing another comparison.");
     confirmed=true;expectedRevision=comparisonRevision;await save();refreshWarning();},true):null,
    !historical?button("Save receiving decisions",async()=>{
     const d=await read("draft:"+key);if(d?.pendingRequestId){const task=await read("task:"+d.pendingRequestId);if(!task)throw Error("The original adoption request is unavailable.");return runTask(task);}
     if(!confirmed||expectedRevision!==comparisonRevision)throw Error("Review and choose the current comparison before applying.");
     const selected=readValues();if(!selected.note.trim()||selected.items.some(x=>!x.reason.trim()))throw Error("Record an overall reason and a decision reason for every inspection.");
     const command={requestId:crypto.randomUUID(),kind:"field.adopt",actor:env.actor(),at:new Date().toISOString(),
      body:{id:crypto.randomUUID(),returnId:row.id,editionId,reviewSha256:comparison.sha256,items:selected.items,note:selected.note}};
     await save();await begin({id:command.requestId,kind:"adopt",command,expectedRevision,at:command.at},key,selected);
    }):null,
    button("Download complete comparison",()=>env.saveJSON(comparison,"Highway_Field_Comparison_"+row.id+".json"),true))));
 }
 const drawReturns=()=>returned.replaceChildren(...returnRows.slice(returnOffset,returnOffset+15).map(row=>{
  const review=element("div"),edition=choose(row.editions.map(x=>({value:x.id,label:x.label+" · "+x.actor.name+" · "+x.at})),row.selectedEditionId||"",row.editions.length?null:"No saved named edition");
  const decided=active.adoptions.find(x=>x.returnId===row.id);
  return panel("Returned field file · "+row.id.slice(0,8),row.editionCount?row.editionCount+" complete named editions retained.":"Unfinished field copy retained. No named edition is available to adopt.",
   element("div",{class:"actions"},button("Download exact returned file",()=>download("/api/field-file?kind=returns&id="+encodeURIComponent(row.id), "Highway_Field_Return_"+row.id),true)),
   control("Named edition for review",edition),row.editions.length&&!decided?button("Compare with current inspections",()=>openComparison(row,edition.value,review),true):null,
   decided?element("div",{},button("Open original receiving comparison",()=>openComparison(row,decided.editionId,review,decided),true),show("Original receiving decisions",decided)):null,show("Complete return identity and edition history",row),review);
 }),element("div",{class:"actions"},returnOffset?button("Previous returns",()=>{returnOffset=Math.max(0,returnOffset-15);drawReturns();},true):null,returnOffset+15<returnRows.length?button("More returns",()=>{returnOffset+=15;drawReturns();},true):null));
 drawReturns();main.append(panel("Returned work and supervisor review","The issued baseline, current local inspection and selected named return stay separate until these decisions are saved.",returned));
 const recoveries=(await all("recovery:")).sort((a,b)=>b.at.localeCompare(a.at));
 if(recoveries.length){
  let offset=0;const body=element("div");
  const draw=()=>body.replaceChildren(...recoveries.slice(offset,offset+10).map(r=>panel("Field draft copies · "+r.key,r.at,
   show("Complete saved device copy",r.current),show("Complete incoming editor copy",r.candidate),
   element("div",{class:"actions"},
    button("Download both complete draft copies",()=>env.saveJSON(r,"Highway_Field_Draft_Recovery_"+r.id+".json"),true),
    button("Use incoming values after current-copy review",async()=>{
     const now=await read("draft:"+r.key);if(now?.pendingRequestId)throw Error("Resolve the original pending request before replacing draft values.");
     if(!same(now,r.current))throw Error("This draft changed after the retained recovery. Reopen its current values before choosing another copy.");
     rememberDraft(r.key,now);
     await updateDraft(r.key,r.candidate.values,{...r.candidate.extra,needsReview:true,rejectPending:true});
     env.message("Incoming draft selected; both complete earlier copies remain retained. Review the current workspace before dispatch.");await env.refresh();
    },true)))),
    element("div",{class:"actions"},offset?button("Previous draft recoveries",()=>{offset=Math.max(0,offset-10);draw();},true):null,offset+10<recoveries.length?button("More draft recoveries",()=>{offset+=10;draw();},true):null));
  draw();main.append(panel("Field draft recovery","Both complete copies are retained when another tab has changed the same field draft. Reopen the screen to work with the saved device copy, or inspect and explicitly select the incoming values below.",body));
 }
 await tasksView(main);
}
return {render};
})();

/* MIT. Assigned reviewer exchange in the original monitoring workspace. */
const copy=v=>structuredClone(v), encoded=v=>JSON.stringify(v);
const canonical=v=>JSON.stringify(v,(_k,x)=>x&&typeof x==="object"&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const eq=(a,b)=>canonical(a)===canonical(b);
const showJSON=v=>JSON.stringify(v,null,2);
const sha=async bytes=>[...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))].map(x=>x.toString(16).padStart(2,"0")).join("");
const bytes=v=>new TextEncoder().encode(encoded(v));
function el(tag,attributes={},...children){
 const node=document.createElement(tag);
 for(const[k,v]of Object.entries(attributes)){
  if(k==="on")for(const[e,f]of Object.entries(v))node.addEventListener(e,f);
  else if(k==="value")node.value=v??"";
  else if(k==="checked")node.checked=!!v;
  else if(v!==false&&v!==null&&v!==undefined)node.setAttribute(k,String(v));
 }
 for(const v of children.flat(Infinity))if(v!==null&&v!==undefined)node.append(v instanceof Node?v:document.createTextNode(String(v)));
 return node;
}
function detail(label,value){const n=el("details",{},el("summary",{},label));let ready=false;n.addEventListener("toggle",()=>{if(n.open&&!ready){ready=true;n.append(el("pre",{class:"scroll-box"},showJSON(value)));}});return n;}
const label=(title,node)=>el("label",{},title,node);
const input=(value="",attributes={})=>el("input",{type:"text",value,...attributes});
const area=(value="")=>el("textarea",{rows:"4"},value);
function select(rows,value="",blank="Select…"){const n=el("select",{},blank===null?null:el("option",{value:""},blank),rows.map(r=>el("option",{value:r.value},r.label)));n.value=value;return n;}
const section=(title,...body)=>el("article",{},el("h3",{},title),body);
function saveBlob(blob,name){const u=URL.createObjectURL(blob),a=el("a",{href:u,download:name});a.click();setTimeout(()=>URL.revokeObjectURL(u),30000);}
function saveJSON(v,name){saveBlob(new Blob([showJSON(v)+"\n"],{type:"application/json"}),name);}
export async function mountReviewExchange({root,api,refresh,navigate,inspectCase,message}){
 let context=null,active=false,selectedRecord=null,recordOffset=0,operationTail=Promise.resolve(),db=null,dbError=null;
 const queues=new Map(),bases=new Map(),memory=new Map();
 const open=new Promise(resolve=>{
  try{
   const r=indexedDB.open("source-monitoring-review-exchange",1);
   r.onupgradeneeded=()=>r.result.createObjectStore("records",{keyPath:"key"});
   r.onsuccess=()=>{db=r.result;resolve();};
   r.onerror=()=>{dbError=r.error;resolve();};
   r.onblocked=()=>{dbError=Error("Close older reviewer-exchange tabs to open this local draft store.");resolve();};
  }catch(e){dbError=e;resolve();}
 });
 function serial(key,fn){const next=(queues.get(key)||Promise.resolve()).catch(()=>{}).then(fn);queues.set(key,next);next.finally(()=>{if(queues.get(key)===next)queues.delete(key);}).catch(()=>{});return next;}
 const notice=(s,error=false)=>{message(s,error);const n=root.querySelector("[data-exchange-notice]");if(n){n.textContent=s;n.className=error?"error":"muted";}};
 function owner(){if(!context)throw Error("Open the original monitoring workspace.");return context.workspace;}
 function check(branch){if(branch!==owner())throw Error("Reopen the original workspace directory for this reviewer work.");}
 const key=(kind,id="",branch=owner())=>JSON.stringify([branch,kind,id]);
 async function tx(mode,fn){
  await open;if(!db)throw dbError||Error("Local draft storage is unavailable. Download your entered draft before closing.");
  return new Promise((resolve,reject)=>{const t=db.transaction("records",mode),s=t.objectStore("records");let answer,error;
   try{fn(s,v=>answer=v,e=>error=e);}catch(e){error=e;t.abort();}
   t.oncomplete=()=>error?reject(error):resolve(answer);
   t.onerror=()=>reject(error||t.error);t.onabort=()=>reject(error||t.error||Error("Local draft transaction did not complete."));
  });
 }
 async function get(k){return tx("readonly",(s,done)=>{s.get(k).onsuccess=e=>done(e.target.result);});}
 const put=v=>tx("readwrite",s=>s.put(v));
 async function all(kind,branch=owner()){return tx("readonly",(s,done)=>{s.getAll().onsuccess=e=>done(e.target.result.filter(v=>{try{const k=JSON.parse(v.key);return k[0]===branch&&k[1]===kind;}catch{return false;}}));});}
 async function call(path,body,branch=owner(),options={}){
  check(branch);return api(path,body,{...options,headers:{"X-Review-Workspace":encodeURIComponent(branch),...options.headers}});
 }
 function button(title,fn){const b=el("button",{type:"button"},title);b.onclick=()=>{
  const task=async()=>{const old=b.disabled;b.disabled=true;try{await fn();}catch(e){notice(e.message,true);}finally{if(b.isConnected)b.disabled=old;}};
  const next=operationTail.catch(()=>{}).then(task);operationTail=next;return next;
 };return b;}
 async function loadDraft(id){
  const k=key("draft",id);let d;
  try{d=await get(k);if(d?.valueSha256&&await sha(bytes(d.values))!==d.valueSha256)throw Error("The saved local draft content differs from its complete hash.");}
  catch(e){notice(e.message,true);d=memory.get(k);}
  bases.set(k,{version:d?.version||0,encoded:encoded(d?.values||{})});return d;
 }
 async function writeDraft(id,values,extras={},branch=owner()){
  check(branch);const k=key("draft",id,branch),candidate=copy(values),extra=copy(extras);
  memory.set(k,{key:k,values:candidate,extra,workspace:branch});
  return serial(k,async()=>{
   const hash=await sha(bytes(candidate)),basis=bases.get(k)||{version:0,encoded:"{}"};
   const next=await tx("readwrite",(s,done,fail)=>{
    s.get(k).onsuccess=e=>{
     const old=e.target.result;
     if((old?.version||0)!==basis.version||encoded(old?.values||{})!==basis.encoded){
      const recovery={key:key("recovery",crypto.randomUUID(),branch),workspace:branch,draftId:id,at:new Date().toISOString(),
       basis,current:copy(old||null),candidate:{values:candidate,extras:extra,sha256:hash}};
      s.put(recovery);fail(Error("Another tab changed this draft. Both complete copies are retained in Draft recovery."));return;
     }
     if(extra.requireResolved&&old?.pendingRequestId){fail(Error("Recover the original pending request before changing this draft's reviewed basis."));return;}
     delete extra.requireResolved;
     const value={...old,...extra,key:k,workspace:branch,values:candidate,version:(old?.version||0)+1,valueSha256:hash};
     s.put(value);done(value);
    };
   });
   bases.set(k,{version:next.version,encoded:encoded(next.values)});memory.set(k,copy(next));return next;
  });
 }
 function capture(id,read,branch){const f=()=>{const value=read();memory.set(key("draft",id,branch),{values:copy(value),workspace:branch});
  writeDraft(id,value,{},branch).catch(e=>notice(e.message,true));};return f;}
 async function settle(task){
  if(!task.draftId||!task.result)return;
  const k=key("draft",task.draftId,task.workspace);
  await serial(k,()=>tx("readwrite",(s,done)=>{
   s.get(k).onsuccess=e=>{
    const d=e.target.result;if(!d||d.pendingRequestId!==task.id)return done();
    const same=eq(d.values,task.submittedValues);
    const next={...d,pendingRequestId:null,settledRequestId:task.id,needsReview:!same};
    s.put(next);done(next);
   };
  }));
 }
 async function retainedTask(task){
  if(task.result){await settle(task);return task.result;}
  check(task.workspace);
  task.status="PENDING";await put(task);
  try{
   if(task.kind==="receive"&&!task.upload){
    const actual=await call("object",new Blob([task.fileBytes],{type:task.file.mediaType}),task.workspace,
     {headers:{"Content-Type":task.file.mediaType,"X-Original-Name":encodeURIComponent(task.file.name)}});
    if(actual.id!==task.file.sha256||actual.bytes!==task.file.bytes)throw Error("The complete original returned file changed during retention.");
    task.upload=actual;await put(task);
   }
   if(task.kind==="receive"&&!task.preview){
    task.preview=await call("review-exchange-return-preview",{file:task.file},task.workspace);await put(task);
   }
   task.dispatched=true;await put(task);
   task.result=await call(task.kind==="issue"?"review-exchange-issue":"review-exchange-command",task.input,task.workspace);
   task.status="COMPLETE";task.error=null;await put(task);await settle(task);
   notice("Reviewer "+task.kind+" saved. Its original request and complete files are retained.");
   return task.result;
  }catch(e){
   task.error={message:e.message,status:e.status||null,notCommitted:e.native?.notCommitted===true&&e.native?.requestId===task.id};
   task.status=task.result?"COMPLETE":task.error.notCommitted?"NOT_COMMITTED":"UNRESOLVED";await put(task);throw e;
  }
 }
 async function runTask(task){return serial(task.key,async()=>retainedTask(await get(task.key)||task));}
 async function begin(task,draftId=null,submittedValues=null){
  const branch=owner();task={...task,id:task.input.requestId,key:key("request",task.input.requestId,branch),workspace:branch,
   draftId,submittedValues:copy(submittedValues),status:"PENDING",result:null,createdAt:new Date().toISOString()};
  const dk=draftId?key("draft",draftId,branch):null;
  await serial(dk||task.key,()=>tx("readwrite",(s,done,fail)=>{
   const write=d=>{
    if(d?.pendingRequestId){fail(Error("Continue the original pending request before issuing another from this draft."));return;}
    if(dk){const basis=bases.get(dk);if(!basis||(d?.version||0)!==basis.version||encoded(d?.values||{})!==basis.encoded||!eq(d.values,submittedValues)){
     fail(Error("The draft changed before dispatch. Reopen its saved copies before continuing."));return;}
     s.put({...d,pendingRequestId:task.id});
    }
    s.put(task);done();
   };
   if(dk)s.get(dk).onsuccess=e=>write(e.target.result);else write(null);
  }));
  return runTask(task);
 }
 function identity(){
  const id=root.querySelector("[data-reviewer-id]").value.trim(),name=root.querySelector("[data-reviewer-name]").value.trim();
  if(!id||!name)throw Error("Enter the operating reviewer ID and name.");
  return{id,name};
 }
 async function download(id,file,branch=owner()){
  const r=await call("review-exchange-file?"+new URLSearchParams({id,role:file.role}),undefined,branch,{download:true});
  const raw=await r.blob.arrayBuffer();
  if(raw.byteLength!==file.bytes||await sha(raw)!==file.sha256)throw Error("The original reviewer download differs from its selected descriptor.");
  check(branch);saveBlob(new Blob([raw],{type:file.mediaType}),file.name);
 }
 function fileButtons(id,files,branch){return el("div",{class:"actions"},files.map(f=>button("Download "+(f.role==="issued_html"?"editable reviewer HTML":f.role==="issued_json"?"original issue JSON":"original returned file"),()=>download(id,f,branch))));}
 async function originalObject(file,branch){
  const id=file.sha256||file.id;
  const r=await call("object?"+new URLSearchParams({id}),undefined,branch,{download:true}),raw=await r.blob.arrayBuffer();
  if(await sha(raw)!==id||file.bytes!==undefined&&raw.byteLength!==file.bytes)throw Error("The retained source or review evidence changed.");
  check(branch);saveBlob(new Blob([raw],{type:file.mediaType||file.media||"application/octet-stream"}),file.name||"Original_Review_Evidence");
 }
 function evidenceView(files,branch){const root=el("div");let offset=0;const draw=()=>root.replaceChildren(
  el("p",{},files.length+" complete source/evidence files"),
  files.slice(offset,offset+20).map(f=>el("p",{},f.name+" · "+f.bytes+" bytes ",button("Download original",()=>originalObject(f,branch)))),
  offset?button("Previous files",()=>{offset=Math.max(0,offset-20);draw();}):null,
  offset+20<files.length?button("More files",()=>{offset+=20;draw();}):null);draw();return root;}
 async function recover(task){
  check(task.workspace);if(task.result){await settle(task);return openRecord(task.result.returnId||task.result.issueId);}
  const found=await call("review-exchange-request?"+new URLSearchParams({requestId:task.id}),undefined,task.workspace);
  if(found.committed){
   const original=task.kind==="issue"?found.event.observations.issueRequest:found.event.request;
   if(!eq(original,task.input))throw Error("The committed original reviewer request has different input.");
   task.result=found.event.result;task.status="COMPLETE";await put(task);await settle(task);return openRecord(task.result.returnId||task.result.issueId);
  }
  const result=await runTask(task);await records();return openRecord(result.returnId||result.issueId);
 }
 async function requestList(){
  const place=root.querySelector("[data-exchange-requests]");place.replaceChildren();
  if(!db){place.append(el("p",{},"Local request storage is unavailable. Existing server requests can still be looked up below."));return;}
  const rows=(await all("request")).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));let page=0;
  const draw=()=>place.replaceChildren(el("h3",{},"Original requests"),
   rows.slice(page*15,page*15+15).map(r=>section(r.kind+" · "+r.status,
    el("p",{},r.id+" · "+r.createdAt),detail("Original input, result and file identity",{...r,fileBytes:r.fileBytes?{bytes:r.fileBytes.byteLength,sha256:r.file.sha256}:undefined}),
    button(r.result?"Open saved result":"Recover original request",()=>recover(r)),
    !r.result&&r.status==="NOT_COMMITTED"?button("Release rejected draft",async()=>{
     const found=await call("review-exchange-request?"+new URLSearchParams({requestId:r.id}),undefined,r.workspace);
     if(found.committed)throw Error("This original request is saved. Recover that result.");
     if(!r.error?.notCommitted)throw Error("An absent lookup does not settle an uncertain request.");
     if(r.draftId)await serial(key("draft",r.draftId,r.workspace),()=>tx("readwrite",s=>{const k=key("draft",r.draftId,r.workspace);s.get(k).onsuccess=e=>{const d=e.target.result;if(d?.pendingRequestId===r.id)s.put({...d,pendingRequestId:null,needsReview:true});};}));
     r.status="RELEASED";await put(r);await requestList();notice("Original rejected request retained. Refresh and review the current case versions before revising.");
    }):null,
    r.fileBytes?button("Download original selected return",()=>saveBlob(new Blob([r.fileBytes],{type:r.file.mediaType}),r.file.name)):null)),
   el("div",{class:"actions"},page?button("Previous requests",()=>{page--;draw();}):null,(page+1)*15<rows.length?button("More requests",()=>{page++;draw();}):null));
  draw();
 }
 async function recoveryList(){
  const place=root.querySelector("[data-exchange-recovery]");place.replaceChildren(el("h3",{},"Draft recovery"));
  place.append(button("Download complete current browser drafts",()=>saveJSON([...memory.entries()].filter(([k])=>JSON.parse(k)[0]===owner()),"Reviewer_Browser_Drafts.json")));
  if(!db)return;
  const rows=await all("recovery");let offset=0;
  const contents=el("div"),draw=()=>contents.replaceChildren(...rows.slice(offset,offset+10).reverse().map(r=>section(r.at,
   detail("Original reviewed basis",r.basis),detail("Complete current saved draft",r.current),detail("Complete incoming draft",r.candidate),
   button("Download both complete copies",()=>saveJSON(r,"Reviewer_Draft_Recovery.json")),
   button("Keep current saved draft",()=>activate()),
   button("Use incoming values after review",async()=>{
    const k=key("draft",r.draftId,r.workspace);check(r.workspace);
    await serial(k,async()=>{
     const current=await get(k);if(current?.pendingRequestId)throw Error("Recover the original pending request before selecting another draft.");
     if(!eq(current||null,r.current))throw Error("The saved draft has changed again. Reopen the current screen before choosing.");
     const h=await sha(bytes(r.candidate.values));
     await tx("readwrite",(s,done,fail)=>{s.get(k).onsuccess=e=>{
      if(!eq(e.target.result||null,current||null)){fail(Error("The saved draft changed during selection. Both original copies remain retained."));return;}
      const next={...current,...r.candidate.extras,key:k,workspace:r.workspace,pendingRequestId:null,values:copy(r.candidate.values),version:(current?.version||0)+1,valueSha256:h,needsReview:true};
      s.put(next);done(next);
     };});
    });await activate();
   }))),offset?button("Previous recovery records",()=>{offset=Math.max(0,offset-10);draw();}):null,offset+10<rows.length?button("More recovery records",()=>{offset+=10;draw();}):null);
  draw();place.append(contents);
 }
 async function records(){
  const branch=owner(),result=await call("review-exchanges?"+new URLSearchParams({offset:recordOffset,limit:25}),undefined,branch);
  const place=root.querySelector("[data-exchange-records]");place.replaceChildren(el("h3",{},"Issued and returned work"),
   el("p",{},result.total+" retained actions"),
   result.rows.map(r=>el("p",{},button(r.action+" · "+r.at+" · "+r.actor.name,()=>openRecord(r.id)), " · "+r.adopted+" cases adopted")),
   recordOffset?button("Previous records",async()=>{recordOffset=Math.max(0,recordOffset-25);await records();}):null,
   result.nextOffset!==null&&result.nextOffset!==undefined?button("More records",async()=>{recordOffset=result.nextOffset;await records();}):null);
  await requestList();await recoveryList();
 }
 async function openRecord(id){
  const branch=owner(),record=await call("review-exchange?"+new URLSearchParams({id}),undefined,branch);
  selectedRecord=id;const place=root.querySelector("[data-exchange-detail]");place.replaceChildren(el("h2",{},record.kind==="issue"?"Original reviewer issue":"Received reviewer file"),fileButtons(id,record.files,branch));
  const issue=record.issue;place.append(detail("Complete original issue and case/source bindings",issue),evidenceView(issue.files||[],branch));
  if(record.kind==="issue"){
   place.append(detail("Original issue requests",record.requests),el("h3",{},"Received files"));
   for(const returned of record.returns)place.append(button("Open returned file "+returned.returnId.slice(0,16),()=>openRecord(returned.returnId)));
  }else{
   const returned=record.return;
   place.append(detail("Complete returned document",returned),detail("Unfinished draft",returned.draft),evidenceView(returned.files||[],branch));
   const editions=returned.editions||[];
   if(!editions.length)place.append(el("p",{},"This original return contains unfinished work only. Retain it or send the complete file back to its reviewer to save a named edition."));
   else{
    const selected=select(editions.map(e=>({value:e.id,label:e.name+" · "+e.actor.name+" · "+e.at})),returned.selectedEditionId||editions.at(-1).id,null);
    place.append(label("Named returned edition",selected),button("Compare named edition",()=>openComparison(id,selected.value)));
   }
   for(const a of record.adoptions||[])place.append(button("Open saved adoption "+a.requestId,async()=>{
    const found=await call("review-exchange-request?"+new URLSearchParams({requestId:a.requestId}),undefined,branch);
    const original=found.event?.request;
    if(!found.committed||original?.action!=="apply")throw Error("The original adoption request is unavailable.");
    await openComparison(id,original.body.editionId,a.requestId);
   }));
  }
 }
 async function openComparison(returnId,editionId,adoptionRequestId=null){
  const branch=owner(),query={returnId,editionId,...(adoptionRequestId?{adoptionRequestId}:{})};
  const response=await call("review-exchange-compare?"+new URLSearchParams(query),undefined,branch);
  const historical=!!response.readOnly,comparison=historical?response.comparison:response;
  const target=root.querySelector("[data-exchange-comparison]");target.replaceChildren(el("h2",{},historical?"Saved adoption comparison":"Review original, current and returned decisions"),
   el("p",{},"Cycle version "+comparison.cycle.version+" · "+comparison.cycle.status),
   detail("Complete comparison and exact original identities",comparison));
  if(historical)target.append(detail("Original adoption request and result",response.event||response),detail("Current workspace identities",response.current));
  const draftId="apply:"+returnId+":"+editionId,draft=historical?null:await loadDraft(draftId);
  const initial=draft?.values||{},sameReview=initial.reviewSha256===comparison.reviewSha256;
  const choices=copy(sameReview?initial.choices||{}:{}),lookup=new Map(comparison.rows.map(r=>[r.caseId,r]));
  const read=()=>({returnId,editionId,reviewSha256:comparison.reviewSha256,expectedCycleVersion:comparison.cycle.version,
   expectedCases:copy(comparison.expectedCases),choices:copy(choices)});
  const save=capture(draftId,read,branch);
  if(draft&&!sameReview)target.append(el("p",{class:"error"},"An earlier decision draft belongs to a different comparison. Its complete original values remain available below; review this current comparison before creating new choices."),detail("Earlier complete decision draft",draft.values));
  let offset=0;const search=input("",{placeholder:"Find a case or value"}),body=el("div"),pager=el("div",{class:"actions"});
  const draw=()=>{
   const rows=comparison.rows.filter(r=>showJSON(r).toLowerCase().includes(search.value.toLowerCase()));offset=Math.min(offset,Math.max(0,Math.floor((rows.length-1)/10)*10));
   body.replaceChildren(...rows.slice(offset,offset+10).map(row=>{
    const article=section(row.currentCase.counterpartyId+" · "+row.currentCase.candidateId,
     el("p",{},row.caseId),button("Open current original case",async()=>{await inspectCase(row.caseId);navigate("review");}),
     detail("Assignment and original/current case identity",{assignment:row.assignment,baselineCaseRevision:row.baselineCaseRevision,currentCase:row.currentCase}));
    if(row.blocked.length)article.append(el("p",{class:"error"},row.blocked.join("; ")));
    const picked=choices[row.caseId]||{action:"",fields:{}};choices[row.caseId]=picked;
    if(!historical){
     const options=[{value:"keep",label:"Keep current case and completion"},...(row.blocked.length?[]:[{value:"apply",label:"Apply the reviewed returned changes"}])];
     const action=select(options,picked.action,"Choose a case decision…");
     action.onchange=()=>{picked.action=action.value;if(action.value==="keep")picked.fields={};save();draw();};article.append(label("Decision for this case",action));
    }
    const table=el("table",{},el("thead",{},el("tr",{},["Field","Issued baseline","Current","Returned","Choice"].map(v=>el("th",{},v)))));
    const tbody=el("tbody");
    for(const[field,f]of Object.entries(row.fields)){
     let decision=el("span",{},f.status);
     if(!historical&&f.status==="conflict"&&picked.action==="apply"){
      const choose=select([{value:"current",label:"Keep current"},{value:"returned",label:"Use returned"}],picked.fields[field]||"");
      choose.onchange=()=>{if(choose.value)picked.fields[field]=choose.value;else delete picked.fields[field];save();};
      decision=choose;
     }
     tbody.append(el("tr",{},el("th",{},field),el("td",{},el("pre",{class:"scroll-box"},showJSON(f.baseline))),el("td",{},el("pre",{class:"scroll-box"},showJSON(f.current))),
      el("td",{},el("pre",{class:"scroll-box"},showJSON(f.returned))),el("td",{},decision)));
    }
    table.append(tbody);article.append(el("div",{class:"table-scroll"},table));return article;
   }));
   pager.replaceChildren(el("p",{},rows.length+" matching / "+comparison.rows.length+" complete cases"),offset?button("Previous cases",()=>{offset=Math.max(0,offset-10);draw();}):null,
    offset+10<rows.length?button("More cases",()=>{offset+=10;draw();}):null);
  };
  // Initialize every case, including rows beyond the visible page.
  for(const row of comparison.rows)if(!choices[row.caseId])choices[row.caseId]={action:"",fields:{}};
  search.oninput=()=>{offset=0;draw();};draw();target.append(label("Find case or original value",search),body,pager);
  if(!historical)target.append(button("Save decision draft",async()=>{await writeDraft(draftId,read(),{},branch);notice("Complete decision draft saved for this exact comparison.");}),
   button("Refresh current comparison",()=>openComparison(returnId,editionId)),
   button("Download complete entered decision draft",()=>saveJSON(read(),"Reviewer_Adoption_Draft.json")),
   button("Apply selected review",async()=>{
    const values=read();for(const[caseId,choice]of Object.entries(values.choices)){
     const row=lookup.get(caseId);if(!["keep","apply"].includes(choice.action))throw Error("Choose apply or keep for every selected case, including later pages.");if(choice.action==="apply"){if(row.blocked.length)throw Error("This case must remain current: "+row.blocked.join("; "));
      for(const[field,entry]of Object.entries(row.fields))if(entry.status==="conflict"&&!choice.fields[field])throw Error("Choose current or returned for every conflicting field.");}
    }
    await writeDraft(draftId,values,{},branch);
    const command={requestId:crypto.randomUUID(),action:"apply",actor:identity(),at:new Date().toISOString(),body:values};
    const result=await begin({kind:"apply",input:command},draftId,values);await refresh();await records();await openRecord(result.returnId);await openComparison(returnId,editionId,result.requestId);
   }));
 }
 async function issueEditor(){
  const branch=owner(),place=root.querySelector("[data-exchange-issue]"),draft=await loadDraft("issue"),v=draft?.values||{};
  const cycles=await call("cycles",undefined,branch),picker=select(cycles.rows.map(r=>({value:r.id,label:r.label+" · "+r.status+" · version "+r.version})),v.cycleId||"");
  const reviewerId=input(v.reviewer?.id||""),reviewerName=input(v.reviewer?.name||""),title=input(v.label||"");
  const evidence=area((v.evidenceIds||[]).join("\n")),files=el("input",{type:"file",multiple:true});
  const search=input("",{placeholder:"Find assigned cases"}),population=el("div"),basis=el("p",{class:"muted"});
  let cycle=null,expectedVersion=v.expectedVersion??null,selected=new Set(v.caseIds||[]),page=0;
  const values=()=>({cycleId:picker.value,expectedVersion,caseIds:[...selected],reviewer:{id:reviewerId.value.trim(),name:reviewerName.value.trim()},label:title.value,evidenceIds:evidence.value.split(/\s+/).filter(Boolean)});
  const save=capture("issue",values,branch);
  const draw=()=>{
   const rows=Object.values(cycle?.items||{}).filter(r=>showJSON([r.caseId,r.impact.case.counterpartyId,r.assignment]).toLowerCase().includes(search.value.toLowerCase()));
   page=Math.min(page,Math.max(0,Math.ceil(rows.length/25)-1));
   population.replaceChildren(...rows.slice(page*25,page*25+25).map(r=>label(r.impact.case.counterpartyId+" · "+r.impact.case.candidateId+" · "+(r.assignment?.reviewer.name||"Unassigned"),
    el("input",{type:"checkbox",checked:selected.has(r.caseId),on:{change:e=>{if(e.target.checked)selected.add(r.caseId);else selected.delete(r.caseId);save();}}}))),
    el("p",{},selected.size+" selected · "+rows.length+" matching"),
    page?button("Previous assigned cases",()=>{page--;draw();}):null,(page+1)*25<rows.length?button("More assigned cases",()=>{page++;draw();}):null);
   basis.textContent=cycle?"Selected cycle version "+expectedVersion+"; current version "+cycle.version+". "+cycle.status+".":"Select a saved cycle. Assign the intended reviewer in Review cycles first.";
  };
  async function loadCycle(adopt=false){
   if(!picker.value){cycle=null;draw();return;}
   cycle=await call("cycle?"+new URLSearchParams({id:picker.value}),undefined,branch);
   if(adopt||expectedVersion===null)expectedVersion=cycle.version;
   draw();
  }
  picker.onchange=async()=>{try{expectedVersion=null;selected=new Set();await loadCycle(true);await writeDraft("issue",values(),{requireResolved:true},branch);}catch(e){notice(e.message,true);}};
  search.oninput=()=>{page=0;draw();};
  for(const n of[reviewerId,reviewerName,title,evidence])n.oninput=save;
  place.replaceChildren(el("h2",{},"Issue a reviewer copy"),el("p",{},"Select the actual assigned cases and colleague. The file includes their original case/source/native evidence and a complete editable reviewer."),
   label("Saved review cycle",picker),basis,el("div",{class:"form-grid"},label("Assigned reviewer ID",reviewerId),label("Assigned reviewer name",reviewerName)),
   label("Issue label and instructions",title),label("Find assigned case",search),population,
   button("Select all cases assigned to this reviewer",async()=>{if(!cycle)throw Error("Select the current saved cycle.");selected=new Set(Object.values(cycle.items).filter(i=>i.assignment?.reviewer.id===reviewerId.value.trim()).map(i=>i.caseId));draw();await writeDraft("issue",values(),{},branch);}),
   label("Additional original evidence files",files),button("Retain selected evidence",async()=>{
    check(branch);const ids=new Set(values().evidenceIds);
    for(const file of files.files){const returned=await call("object",file,branch,{headers:{"Content-Type":file.type||"application/octet-stream","X-Original-Name":encodeURIComponent(file.name)}});ids.add(returned.id);}
    evidence.value=[...ids].join("\n");await writeDraft("issue",values(),{},branch);
   }),label("Retained evidence object IDs",evidence),
   button("Use reviewed current cycle version",async()=>{await loadCycle(true);await writeDraft("issue",values(),{requireResolved:true},branch);}),
   button("Download complete issue draft",()=>saveJSON(values(),"Reviewer_Issue_Draft.json")),
   button("Issue reviewer copy",async()=>{
    if(!cycle)throw Error("Select a saved review cycle.");const body=values();
    if(!body.caseIds.length||!body.reviewer.id||!body.reviewer.name||!body.label.trim())throw Error("Select assigned cases, named reviewer and issue instructions.");
    await writeDraft("issue",body,{},branch);
    const selection={requestId:crypto.randomUUID(),...body,actor:identity(),at:new Date().toISOString()};
    const result=await begin({kind:"issue",input:selection},"issue",body);await records();await openRecord(result.issueId);
   }));
  await loadCycle();
 }
 async function activate(){
  active=true;const seen=await api("cycle-context");context=seen;await open;
  root.replaceChildren(el("h1",{},"Reviewer exchange"),el("p",{class:"muted"},"Workspace: "+context.name),
   el("p",{"data-exchange-notice":true},db?"Issue selected work, receive attributed reviews and reconcile the actual current case history.":"Local draft storage is unavailable. Read and download retained server work; save complete entered drafts before closing."),
   el("div",{class:"form-grid"},label("Operating reviewer ID",input("",{"data-reviewer-id":true})),label("Operating reviewer name",input("",{"data-reviewer-name":true}))),
   button("Use this reviewer",async()=>{await put({key:key("actor"),actor:identity()});notice("Reviewer identity saved for this workspace.");}),
   button("Refresh reviewer exchange",activate),el("section",{"data-exchange-issue":true}),el("section",{"data-exchange-receive":true}),
   el("section",{"data-exchange-records":true}),el("section",{"data-exchange-detail":true}),el("section",{"data-exchange-comparison":true}),
   el("section",{"data-exchange-requests":true}),el("section",{"data-exchange-recovery":true}));
  if(db){const a=await get(key("actor"));if(a){root.querySelector("[data-reviewer-id]").value=a.actor.id;root.querySelector("[data-reviewer-name]").value=a.actor.name;}}
  const receiving=root.querySelector("[data-exchange-receive]"),file=el("input",{type:"file",accept:".json,.html,.htm,application/json,text/html"}),lookup=input("");
  receiving.replaceChildren(el("h2",{},"Receive reviewer file"),el("p",{},"Retain the exact downloaded JSON or HTML. Unfinished work remains available even when no named edition has been saved."),
   label("Original reviewer file",file),button("Receive reviewer file",async()=>{
    const selected=file.files[0];if(!selected)throw Error("Select the complete original reviewer file.");if(selected.size>256*1024*1024)throw Error("The full selected file exceeds 256 MiB.");
    const branch=owner(),raw=await selected.arrayBuffer();check(branch);
    const descriptor={sha256:await sha(raw),bytes:raw.byteLength,name:selected.name,mediaType:selected.type||"application/octet-stream"};
    const command={requestId:crypto.randomUUID(),action:"receive",actor:identity(),at:new Date().toISOString(),body:{file:descriptor}};
    const result=await begin({kind:"receive",input:command,file:descriptor,fileBytes:raw});await records();await openRecord(result.returnId);
   }),label("Original reviewer request UUID",lookup),button("Open retained original request",async()=>{
    const found=await call("review-exchange-request?"+new URLSearchParams({requestId:lookup.value.trim()}));
    receiving.append(detail("Original request result",found));if(found.committed)await openRecord(found.event.result.returnId||found.event.result.issueId);
   }));
  await issueEditor();await records();if(selectedRecord)await openRecord(selectedRecord);
 }
 return{activate,deactivate(){active=false;},isActive:()=>active};
}

import {auditRequestId,auditSha256} from "/client.mjs";
const FORMAT="commons.audit-review-transition-working.v1";
const clone=v=>JSON.parse(JSON.stringify(v));
const $=id=>document.getElementById(id);
const el=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=String(text);return node;};
export function mountRevisionReview(host){
  let workspace=null,loaded=null,draft=null,draftId=null,draftVersion=0,database=null;
  let serial=Promise.resolve(),pending=0,error=null,loading=false,inventory="",archiveKey="";
  const panel=$("revision-review-panel");
  function db(){if(!database)database=new Promise((resolve,reject)=>{const q=indexedDB.open("audit-revision-reviews",1);
    q.onupgradeneeded=()=>q.result.createObjectStore("drafts",{keyPath:"id"});
    q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});return database;}
  async function transaction(mode,fn){const d=await db();return new Promise((resolve,reject)=>{const tx=d.transaction("drafts",mode);let result;
    tx.oncomplete=()=>resolve(result);tx.onabort=tx.onerror=()=>reject(tx.error||new Error("The complete working copy could not be saved."));
    fn(tx.objectStore("drafts"),v=>result=v);});}
  function raw(value){const text=JSON.stringify(value);if(new TextEncoder().encode(text).length>128*1024*1024)throw new Error("The whole working copy exceeds 128 MiB; preserve it and choose fewer reviews.");return text;}
  async function list(){const rows=await transaction("readonly",(s,done)=>{const rows=[],q=s.openCursor();q.onsuccess=()=>{const cursor=q.result;if(!cursor){done(rows);return;}const r=cursor.value;if(r.workspaceId===workspace)rows.push({id:r.id,workspaceId:r.workspaceId,updatedAt:r.updatedAt,title:r.body.title});cursor.continue();};});
    const select=$("revision-review-working"),held=select.value;select.replaceChildren(new Option("Choose a saved unfinished working copy",""));
    for(const row of rows.filter(r=>r.workspaceId===workspace).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)))select.add(new Option(row.title+" · "+row.updatedAt+" · "+row.id.slice(0,8),row.id));
    if(Array.from(select.options).some(r=>r.value===held))select.value=held;
  }
  let dirtyGeneration=0,savedGeneration=0,writing=null;
  function persist(){
    if(!draft)return serial;dirtyGeneration++;error=null;
    if(writing)return writing;
    pending=1;syncControls();
    // At most one frozen complete body exists for an active transaction. Further
    // typing changes only the live draft + generation; the next write captures
    // the latest whole state after this transaction drains.
    writing=Promise.resolve().then(async()=>{
      while(savedGeneration<dirtyGeneration){
        const generation=dirtyGeneration,body=clone(draft),wid=workspace;
        raw(body);const id=draftId||auditRequestId(),expected=draftVersion;
        const result=await transaction("readwrite",(s,done)=>{const q=s.get(id);q.onsuccess=()=>{const old=q.result;
          const target=old&&old.version!==expected?auditRequestId():id;
          const row={id:target,workspaceId:wid,version:target===id?expected+1:1,updatedAt:new Date().toISOString(),body};
          s.put(row);done({id:row.id,version:row.version});};});
        if(workspace!==wid)throw new Error("Preserve the original working workspace before switching.");
        if(result.id!==id)host.notice("Both competing working copies were kept. This tab now uses its own copy.");
        draftId=result.id;draftVersion=result.version;savedGeneration=generation;
      }
    }).catch(e=>{error=e;host.notice("Browser save failed. Download the complete working copy before closing. "+e.message,"error");})
      .finally(()=>{pending=0;writing=null;syncControls();});
    serial=writing;return writing;
  }
  async function flush(){await serial;if(error)throw error;if(savedGeneration<dirtyGeneration)throw new Error("Preserve the complete unsaved working copy before continuing.");}
  function fresh(){
    draft={format:FORMAT,workspaceId:workspace,title:"Revision impact review",sourceId:"",reviewIds:[],
      preview:null,decisions:[],note:"",activeReviewId:null,receipts:[]};
    draftId=null;draftVersion=0;dirtyGeneration=0;savedGeneration=0;error=null;inventory="";render();
  }
  function applied(){return Boolean(draft?.preview&&(host.state()?.exports||[]).some(r=>r.kind==="review-transition"&&!r.receivedFrom&&r.transition?.workspaceId===workspace&&r.transition?.previewSha256===draft.preview.previewSha256));}
  function syncControls(){
    const blocked=loading||host.busy()||!host.state()||Boolean(host.pending());
    for(const form of panel.querySelectorAll("form"))form.inert=blocked;
    for(const button of panel.querySelectorAll("button"))button.disabled=blocked||pending>0||button.dataset.unavailable==="true";
    $("revision-review-download").disabled=!draft||loading;
    $("revision-review-apply").disabled=blocked||pending>0||Boolean(error)||!draft?.preview||applied();
    $("revision-review-persistence").textContent=error?"Browser save failed: download this complete copy.":pending?"Saving unfinished decisions…":draftId?"Unfinished decisions retained in this browser.":"Start a review or reopen a complete working copy.";
  }
  function sync(){
    const state=host.state(),wid=state?.workspaceId||null;
    if(wid!==loaded&&!loading){loading=true;
      serial.then(async()=>{workspace=wid;loaded=wid;draft=null;draftId=null;draftVersion=0;inventory="";archiveKey="";
        if(wid){fresh();await list();}else render();
      }).catch(e=>host.notice(e.message,"error")).finally(()=>{loading=false;syncControls();});}
    const next=JSON.stringify([state?.version,state?.sources.map(s=>[s.id,s.currentRevisionId])]);
    if(next!==inventory){inventory=next;renderSources();renderCandidates();renderStatus();}
    const archives=(state?.exports||[]).filter(r=>r.kind==="review-transition"),key=JSON.stringify(archives.map(r=>[r.id,r.sha256]));
    if(key!==archiveKey){archiveKey=key;host.table("revision-review-history",archives,[
      {label:"Review archive",cell:r=>{const b=el("button",r.name);b.type="button";b.onclick=()=>host.run("Download retained revision review",()=>host.download(r));return b;}},
      {label:"Saved",cell:r=>r.createdAt},{label:"Origin",cell:r=>r.receivedFrom?"Received original · "+r.receivedFrom.workspaceId:"This workspace"},
      {label:"Complete ZIP SHA-256",cell:r=>r.sha256}],{emptyText:"No applied revision review is retained yet."});}
    syncControls();
  }
  function renderSources(){const select=$("revision-review-source");select.replaceChildren(new Option("Choose an original source",""));
    for(const source of host.state()?.sources||[])select.add(new Option(source.name+" · revision "+source.revisionNumber,source.id));
    select.value=draft?.sourceId||"";
  }
  function renderCandidates(){
    const source=(host.state()?.sources||[]).find(s=>s.id===draft?.sourceId);
    const rows=(host.state()?.reviews||[]).filter(r=>r.sourceId===source?.id&&r.revisionId!==source.currentRevisionId);
    host.table("revision-review-candidates",rows,[
      {label:"Select",cell:r=>{const input=el("input");input.type="checkbox";input.dataset.reviewId=r.id;input.setAttribute("aria-label","Select "+r.title);
        input.checked=Boolean(draft?.reviewIds.includes(r.id));input.disabled=host.busy()||loading;
        input.onchange=()=>{if(input.checked)draft.reviewIds.push(r.id);else draft.reviewIds=draft.reviewIds.filter(id=>id!==r.id);persist();renderStatus();};return input;}},
      {label:"Retained review",cell:r=>r.title},{label:"Status",cell:r=>r.status},{label:"Assignee",cell:r=>r.assignee||"Unassigned"},
      {label:"Original revision",cell:r=>r.revisionId}],{emptyText:source?"Every current review is already on this source revision, or no reviews exist.":"Choose a source to see reviews retained on earlier revisions."});
  }
  function renderStatus(){
    const p=draft?.preview,state=host.state();
    const selected=p&&JSON.stringify(p.selection.reviewIds)===JSON.stringify(draft.reviewIds)&&p.sourceId===draft.sourceId;
    const accepted=applied();
    $("revision-review-state").textContent=!draft?"Connect the original Audit workspace.":!p?"Choose earlier reviews, then preview the complete native changes.":accepted?"Applied archive retained. The working copy and all decisions remain available.":!selected?"Selection changed. Preview again before applying; the existing reviewed copy remains saved.":p.version!==state?.version?"Workspace changed since this preview. Preview again and review the retained decisions before applying.":"Preview binds workspace version "+p.version+". Every selected review requires an explicit decision and reason.";
  }
  function lazy(label,value){const box=el("details"),pre=el("pre");box.append(el("summary",label),pre);
    box.addEventListener("toggle",()=>{pre.textContent=box.open?JSON.stringify(value,null,2):"";});return box;}
  function renderDecisionList(){
    const rows=draft?.preview?.reviews||[];host.table("revision-review-decisions",rows,[
      {label:"Review",cell:r=>{const b=el("button",r.review.title);b.type="button";b.dataset.reviewId=r.review.id;b.onclick=()=>host.run("Open retained decision",async()=>{await flush();draft.activeReviewId=r.review.id;await persist();renderEditor();});return b;}},
      {label:"Original status",cell:r=>r.review.status},{label:"Impact",cell:r=>Object.entries(r.impact.counts).map(([k,v])=>k+": "+v).join(" · ")},
      {label:"Entity",cell:r=>r.identityChanged?"Original entity absent or its identity changed":"Compare the complete retained scope"},
      {label:"Decision",cell:r=>draft.decisions.find(d=>d.reviewId===r.review.id)?.mode||"Unselected"}],{emptyText:"Preview the selected reviews to make explicit decisions."});
  }
  function renderEditor(){
    const preview=draft?.preview,row=preview?.reviews.find(r=>r.review.id===draft.activeReviewId);
    const form=$("revision-review-decision");form.hidden=!row;if(!row)return;
    const choice=draft.decisions.find(d=>d.reviewId===row.review.id),review=choice.review||draft.editedReviews?.[row.review.id]||row.review;
    $("revision-review-title").textContent=row.review.title;
    $("revision-review-mode").value=choice.mode;$("revision-review-reason").value=choice.reason;
    const select=$("revision-review-entity");select.replaceChildren(new Option("Choose the current entity explicitly","__choose__"),new Option("Whole document",""));
    for(const entity of preview.targetEntities)select.add(new Option(entity.label+" · "+entity.path,entity.key));
    select.value=(choice.review||draft.editedReviews?.[row.review.id])?.entityKey??"__choose__";
    for(const field of ["status","title","note","assignee","dueDate"])$("revision-review-field-"+field).value=review[field]||"";
    $("revision-review-field-evidence").value=(review.evidence||[]).map(v=>v.label+" | "+v.url).join("\n");
    $("revision-review-fields").disabled=choice.mode!=="update";
    $("revision-review-native").replaceChildren(lazy("Complete earlier review and its history",row.review),lazy("Entity before / same path now",{before:row.beforeEntity,samePathNow:row.samePathEntity}),
      lazy("All scalar and reference changes in this entity scope",row.impact),
      lazy("Whole source comparison and previous validation",preview.fromRevisions[row.fromRevisionId]),
      lazy("Current validation",preview.targetValidation));
    syncControls();
  }
  function render(){ $("revision-review-name").value=draft?.title||"";$("revision-review-note").value=draft?.note||"";
    renderSources();renderCandidates();renderStatus();renderDecisionList();renderEditor();syncControls(); }
  function evidence(text){return text.split("\n").filter(line=>line.trim()).map(line=>{const at=line.indexOf("|");
    if(at<1)throw new Error("Use one evidence label | https://URL per line.");return {label:line.slice(0,at).trim(),url:line.slice(at+1).trim()};});}
  // Preserve exact unfinished evidence text independently until it is valid enough
  // for a native decision. A malformed line never erases the saved text.
  function captureEditor(){const row=draft?.decisions.find(r=>r.reviewId===draft.activeReviewId);if(!row)return;
    if(row.review){draft.editedReviews??={};draft.editedReviews[row.reviewId]=clone(row.review);}
    row.mode=$("revision-review-mode").value;row.reason=$("revision-review-reason").value;
    if(row.mode==="update"){row.review={entityKey:$("revision-review-entity").value};
      for(const field of ["status","title","note","assignee","dueDate"])row.review[field]=$("revision-review-field-"+field).value;
      draft.evidenceText??={};draft.evidenceText[row.reviewId]=$("revision-review-field-evidence").value;
      try{row.review.evidence=evidence(draft.evidenceText[row.reviewId]);}catch{row.review.evidence=[];}draft.editedReviews??={};draft.editedReviews[row.reviewId]=clone(row.review);}
    else delete row.review;
    $("revision-review-fields").disabled=row.mode!=="update";
  }
  function restoreEvidence(){const text=draft?.evidenceText?.[draft.activeReviewId];if(text!==undefined)$("revision-review-field-evidence").value=text;}
  const originalRenderEditor=renderEditor;renderEditor=function(){originalRenderEditor();restoreEvidence();};
  $("revision-review-source").onchange=()=>{if(!draft)return;draft.sourceId=$("revision-review-source").value;draft.reviewIds=[];persist();renderCandidates();renderStatus();};
  for(const [id,key] of [["revision-review-name","title"],["revision-review-note","note"]])$(id).oninput=()=>{draft[key]=$(id).value;persist();};
  $("revision-review-decision").addEventListener("input",()=>{captureEditor();persist();});
  $("revision-review-decision").addEventListener("change",()=>{captureEditor();persist();renderDecisionList();});
  $("revision-review-decision").onsubmit=e=>{e.preventDefault();host.run("Keep complete decision",async()=>{captureEditor();await persist();await flush();renderDecisionList();host.notice("Decision retained. Apply the complete selection when every reason and update is reviewed.");});};
  $("revision-review-new").onclick=()=>host.run("Start another revision review",async()=>{await flush();fresh();await persist();await list();});
  $("revision-review-preview").onclick=()=>host.run("Preview current XML impact",async()=>{
    await flush();const source=host.state().sources.find(s=>s.id===draft.sourceId);
    if(!source)throw new Error("Choose an original source.");if(!draft.reviewIds.length)throw new Error("Select at least one earlier review.");
    const selection={sourceId:source.id,toRevisionId:source.currentRevisionId,reviewIds:[...draft.reviewIds]};
    const p=await host.read("review.transition.preview",selection);
    // A new preview is a separate full working edition; never overwrite decisions
    // authored against a preceding source/review head.
    draftId=null;draftVersion=0;
    draft={format:FORMAT,workspaceId:workspace,title:draft.title,sourceId:source.id,reviewIds:selection.reviewIds,
      preview:p,decisions:p.reviews.map(row=>({reviewId:row.review.id,mode:"retain",reason:""})),
      note:draft.note,activeReviewId:p.reviews[0]?.review.id||null,receipts:[]};
    await persist();await list();render();
  });
  $("revision-review-apply").onclick=()=>host.run("Apply explicit revision review",async()=>{
    captureEditor();await flush();const p=draft.preview;
    if(!p||p.version!==host.state().version||p.sourceId!==draft.sourceId||JSON.stringify(p.selection.reviewIds)!==JSON.stringify(draft.reviewIds))throw new Error("Preview this exact current selection again.");
    const decisions=clone(draft.decisions);
    for(const choice of decisions){if(!choice.reason.trim())throw new Error("Give a reason for every decision.");
      if(choice.mode==="update"){choice.review.evidence=evidence(draft.evidenceText?.[choice.reviewId]??choice.review.evidence.map(r=>r.label+" | "+r.url).join("\n"));
        if(choice.review.entityKey==="__choose__")throw new Error("Choose the current entity or whole document explicitly for every update.");}}
    const input={...p.selection,previewSha256:p.previewSha256,decisions,actor:host.operator(),note:draft.note};
    const result=await host.mutate("review.transition.apply",input);
    await recovered(result);
  });
  async function recovered(result){if(draft&&result.previewSha256===draft.preview?.previewSha256){draft.receipts.push(clone(result));await persist();renderStatus();}
    await host.download(result.archive);host.notice("Applied decisions and retained the complete source/before-after archive.");}
  $("revision-review-download").onclick=()=>{if(draft)host.downloadBytes(raw(draft)+"\n","Audit_Revision_Review_Working.json","application/json");};
  $("revision-review-working-refresh").onclick=()=>host.run("List saved working copies",list);
  $("revision-review-working-open").onclick=()=>host.run("Reopen complete working copy",async()=>{await flush();const id=$("revision-review-working").value;
    const row=await transaction("readonly",(s,done)=>{const q=s.get(id);q.onsuccess=()=>done(q.result);});
    if(!row||row.workspaceId!==workspace)throw new Error("Choose this workspace's retained working copy.");
    await validateWorking(row.body);draft=clone(row.body);draftId=row.id;draftVersion=row.version;render();});
  async function validateWorking(body){
    raw(body);if(body?.format!==FORMAT||body.workspaceId!==workspace||typeof body.title!=="string"||typeof body.note!=="string"||typeof body.sourceId!=="string"||!Array.isArray(body.reviewIds)||!body.reviewIds.every(x=>typeof x==="string")||!Array.isArray(body.decisions)||!Array.isArray(body.receipts))throw new Error("Select a complete working copy for this original workspace.");
    if(body.preview&&(body.preview.format!=="commons.audit-review-transition.v1"||body.preview.workspaceId!==workspace||!Array.isArray(body.preview.reviews)||!Array.isArray(body.preview.targetEntities)))throw new Error("The retained original preview is incomplete.");
    if(body.preview){const p=body.preview;
      if(!p.selection||!Array.isArray(p.selection.reviewIds)||!p.fromRevisions||!p.toRevision||typeof p.previewSha256!=="string"||!p.reviews.every(r=>r?.review&&typeof r.review.id==="string"&&r.impact?.counts&&p.fromRevisions[r.fromRevisionId])||!p.targetEntities.every(e=>typeof e.key==="string"&&typeof e.label==="string"&&typeof e.path==="string"))throw new Error("The complete original preview tables and source bindings are absent.");
      const original=clone(body.preview);delete original.previewSha256;
      function canonical(value){if(Array.isArray(value))return "["+value.map(canonical).join(",")+"]";if(value!==null&&typeof value==="object")return "{"+Object.keys(value).sort((a,b)=>{const x=Array.from(a),y=Array.from(b);for(let i=0;i<Math.min(x.length,y.length);i++){const d=x[i].codePointAt(0)-y[i].codePointAt(0);if(d)return d;}return x.length-y.length;}).map(k=>JSON.stringify(k)+":"+canonical(value[k])).join(",")+"}";return JSON.stringify(value);}
      if(await auditSha256(new TextEncoder().encode(canonical(original)+"\n"))!==body.preview.previewSha256)throw new Error("The complete original preview changed; its hash does not match. Preserve the file and obtain a new native preview.");
    }
    if(body.preview&&JSON.stringify(body.decisions.map(r=>r.reviewId))!==JSON.stringify(body.preview.reviews.map(r=>r.review.id)))throw new Error("The complete decision order differs.");
    for(const choice of body.decisions)if(!["retain","update"].includes(choice.mode)||typeof choice.reason!=="string"||(choice.mode==="update"&&(!choice.review||!Array.isArray(choice.review.evidence))))throw new Error("A complete unfinished decision is absent.");
  }
  $("revision-review-import").onsubmit=e=>{e.preventDefault();host.run("Import complete working copy",async()=>{await flush();const file=$("revision-review-import-file").files[0];if(!file)throw new Error("Choose the complete working JSON.");
    if(file.size>128*1024*1024)throw new Error("The complete working copy exceeds 128 MiB.");const body=JSON.parse(await file.text());await validateWorking(body);
    draft=body;draftId=null;draftVersion=0;await persist();await list();render();});};
  window.addEventListener("beforeunload",event=>{if(pending||error){event.preventDefault();event.returnValue="";}});
  async function open(){await serial;if(draft){render();await list();}}
  return {sync,recovered,open};
}

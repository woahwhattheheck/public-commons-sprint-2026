/* MIT. Saved review cycles in the original source-monitoring console. */
export async function mountReviewCycles({api,run,navigate,inspectCase,getState,refresh,escape,pretty,openPortfolioRefresh}) {
  const $=(q,r=document)=>r.querySelector(q);
  const host=$("#view-cycles");
  let context=null, selected=null, cyclePage=0, cycleSearch="", cycleStatus="", queue=Promise.resolve();
  const ready=new Promise((resolve,reject)=>{
    const request=indexedDB.open("starforge-source-review-cycles",1);
    request.onupgradeneeded=()=>request.result.createObjectStore("records",{keyPath:"key"});
    request.onsuccess=()=>resolve(request.result); request.onerror=()=>reject(request.error);
  });
  async function transaction(mode,fn) {
    const db=await ready;
    return new Promise((resolve,reject)=>{
      const tx=db.transaction("records",mode), store=tx.objectStore("records");
      let result;
      try {result=fn(store);} catch(e){tx.abort();reject(e);return;}
      tx.oncomplete=()=>resolve(typeof result==="function"?result():result);
      tx.onerror=()=>reject(tx.error); tx.onabort=()=>reject(tx.error||new Error("Draft transaction interrupted"));
    });
  }
  async function get(key){let value;await transaction("readonly",s=>{s.get(key).onsuccess=e=>{value=e.target.result;};});return value;}
  async function list(prefix){let values;await transaction("readonly",s=>{s.getAll().onsuccess=e=>{values=e.target.result.filter(v=>v.key.startsWith(prefix));};});return values;}
  const put=value=>transaction("readwrite",s=>s.put(value));
  function serial(fn){const next=queue.then(fn);queue=next.catch(()=>{});return next;}
  function branchKey(kind,id=""){if(!context)throw Error("Open the original workspace first");return JSON.stringify([context.workspace,kind,id]);}
  function sameBranch(branch){if(!context||context.workspace!==branch)throw Error("Reopen the original workspace branch for this saved request");}
  async function call(path,body,branch=context?.workspace,options={}) {
    sameBranch(branch);
    return api(path,body,{...options,headers:{"X-Review-Workspace":encodeURIComponent(branch),...options.headers}});
  }
  function field(label,name,type="text",required=true,value="") {
    return '<label>'+escape(label)+'<input name="'+name+'" type="'+type+'" '+(required?'required ':'')+'value="'+escape(value)+'"></label>';
  }
  const textArea=(label,name,value="")=>'<label>'+escape(label)+'<textarea name="'+name+'" rows="3">'+escape(value)+'</textarea></label>';
  const value=(f,n)=>f.elements.namedItem(n).value;
  const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==="object"&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(k=>[k,item[k]])):item);
  const iso=v=>v?new Date(v).toISOString():null;
  const local=v=>v?new Date(new Date(v).getTime()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16):"";
  function values(form){return Object.fromEntries([...form.elements].filter(e=>e.name&&e.type!=="file"&&e.type!=="submit").map(e=>[e.name,e.type==="checkbox"?e.checked:e.value]));}
  function restore(form,values){for(const [k,v] of Object.entries(values||{})){const e=form.elements.namedItem(k);if(e){if(e.type==="checkbox")e.checked=v;else e.value=v;}}}
  function identity(){const id=$("#cycle-actor-id").value.trim(),name=$("#cycle-actor-name").value.trim();if(!id||!name)throw Error("Enter the reviewer ID and name before recording a cycle action");return {id,name};}
  async function download(path,filename) {
    const r=await call(path,undefined,context.workspace,{download:true}),u=URL.createObjectURL(r.blob),a=document.createElement("a");
    a.href=u;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(u),10000);
  }
  function select(name,rows,label,chosen="") {
    return '<select name="'+name+'">'+rows.map(r=>'<option value="'+escape(r.id)+'" '+(r.id===chosen?"selected":"")+'>'+escape(label(r))+'</option>').join("")+'</select>';
  }
  async function bind(form,kind,bodyBuilder,expectedVersion,cycleId,after) {
    const branch=context.workspace, draftKey=branchKey("draft",kind), saved=await get(draftKey);
    if(saved)restore(form,saved.values);
    let baseVersion=saved?.expectedVersion??expectedVersion;
    async function save(){
      const content=values(form);
      return serial(async()=>{
        sameBranch(branch);
        const old=await get(draftKey);
        const draft={...old,key:draftKey,workspace:branch,kind,values:content,
          expectedVersion:old?.expectedVersion??baseVersion,cycleId};
        await put(draft);return draft;
      });
    }
    form.oninput=()=>save().catch(e=>$("#cycle-notice").textContent=e.message);
    form.onchange=()=>save().catch(e=>$("#cycle-notice").textContent=e.message);
    const evidenceInput=form.elements.namedItem("evidenceFiles");
    if(evidenceInput)form.querySelector("[data-retain-evidence]").onclick=()=>run("Retain review evidence",async()=>{
      sameBranch(branch);
      const ids=JSON.parse(value(form,"evidence")||"[]");
      if(!Array.isArray(ids))throw Error("Evidence IDs must be an array");
      for(const file of evidenceInput.files){
        const r=await call("object",file,branch,{headers:{"Content-Type":file.type||"application/octet-stream","X-Original-Name":encodeURIComponent(file.name)}});
        if(!ids.includes(r.id))ids.push(r.id);
      }
      form.elements.namedItem("evidence").value=JSON.stringify(ids,null,2);
      await save();
    });
    form.onsubmit=e=>{e.preventDefault();run("Save review cycle action",async()=>{
      const draft=await save();
      if(draft.pendingRequestId)throw Error("This draft has an unresolved original request. Use Saved cycle requests to recover it.");
      const input=bodyBuilder(form);
      const command={requestId:crypto.randomUUID(),cycleId,expectedVersion:draft.expectedVersion,
        action:kind.split(":")[0],actor:identity(),at:new Date().toISOString(),body:input};
      const request={key:branchKey("request",command.requestId),workspace:branch,command,draftKey,
        submittedValues:values(form),state:"PENDING",result:null,error:null};
      await serial(async()=>{
        const latest=await get(draftKey);
        if(latest?.pendingRequestId)throw Error("Recover this draft's original pending request");
        await transaction("readwrite",store=>{
          store.put({...latest,pendingRequestId:command.requestId});
          store.put(request);
        });
      });
      await send(request);
      await after?.(request.result);
    });};
    if(saved?.pendingRequestId){
      const p=document.createElement("p");p.textContent="An original request is pending. Recover it from Saved cycle requests before a new submission.";form.prepend(p);
    }
    form.querySelector("[data-cycle-rebase]")?.remove();
    const reset=document.createElement("button");reset.dataset.cycleRebase="true";reset.type="button";reset.textContent="Use current cycle version";
    reset.onclick=()=>run("Select current cycle version",async()=>{
      await serial(async()=>{
        const d=await get(draftKey);if(d?.pendingRequestId)throw Error("Reconcile the original pending request first");
        const current=cycleId?await call("cycle?"+new URLSearchParams({id:cycleId}),undefined,branch):null;
        baseVersion=current?.version??0;await put({...d,key:draftKey,workspace:branch,kind,cycleId,values:values(form),expectedVersion:baseVersion});
      });
    });
    form.append(reset);
  }
  async function settle(request) {
    await serial(async()=>{
      const d=await get(request.draftKey);
      if(!d||d.pendingRequestId!==request.command.requestId)return;
      if(JSON.stringify(d.values)===JSON.stringify(request.submittedValues)){
        await transaction("readwrite",s=>s.delete(request.draftKey));
      }else{
        const sameCycle=request.command.cycleId===request.result.cycleId;
        await put({...d,pendingRequestId:null,expectedVersion:sameCycle?request.result.version:d.expectedVersion,
          completedRequestId:request.command.requestId});
      }
    });
  }
  async function send(request) {
    sameBranch(request.workspace);
    if(request.result){await settle(request);return request.result;}
    try{
      const outcome=await call("cycle-command",request.command,request.workspace);
      request.result=outcome;request.state="COMPLETE";request.error=null;await put(request);await settle(request);
      selected=outcome.cycleId;
      await loadCycles();await openCycle(selected);
      return outcome;
    }catch(error){
      request.error=error.message;
      // A transport failure can follow the server commit. Only its original lookup settles it.
      if(!request.result){request.state=error.native?.notCommitted===true&&error.native?.requestId===request.command.requestId?"REJECTED_NOT_COMMITTED":"UNRESOLVED";await put(request);}
      throw error;
    }
  }
  async function recover(request) {
    sameBranch(request.workspace);
    if(request.result){await settle(request);return openCycle(request.result.cycleId);}
    const found=await call("cycle-request?"+new URLSearchParams({id:request.command.requestId}),undefined,request.workspace);
    if(found.committed){
      if(canonical(found.event.command)!==canonical(request.command))throw Error("The retained request body differs");
      request.result=found.event.result;request.state="COMPLETE";request.error=null;await put(request);await settle(request);
      selected=request.result.cycleId;await loadCycles();await openCycle(selected);
    }else await send(request);
  }
  async function requests() {
    const all=await list(JSON.stringify([context.workspace,"request"]).slice(0,-1)+",");
    $("#cycle-requests").replaceChildren();
    for(const r of all.reverse()){
      const article=document.createElement("article"),title=document.createElement("h3"),pre=document.createElement("pre"),button=document.createElement("button");
      title.textContent=r.command.action+" · "+r.state+" · "+r.command.at;
      pre.textContent=pretty({workspace:r.workspace,command:r.command,result:r.result,error:r.error});pre.className="scroll-box";
      button.type="button";button.textContent=r.result?"Open saved result":"Recover original request";
      button.onclick=()=>run("Recover original cycle request",()=>recover(r));
      article.append(title,button);
      if(!r.result&&r.state==="REJECTED_NOT_COMMITTED"){
        const release=document.createElement("button");release.type="button";release.textContent="Confirm not saved and release draft";
        release.onclick=()=>run("Reconcile original request",async()=>{
          sameBranch(r.workspace);
          const status=await call("cycle-request?"+new URLSearchParams({id:r.command.requestId}),undefined,r.workspace);
          if(status.committed)throw Error("This request was saved. Recover its result.");
          // Release only follows this exact command endpoint’s definite rejection,
          // never an absent lookup after uncertain transport.
          r.state="NOT_COMMITTED";await put(r);
          await serial(async()=>{const d=await get(r.draftKey);if(d?.pendingRequestId===r.command.requestId)await put({...d,pendingRequestId:null});});
          await requests();
        });
        article.append(release);
      }
      const details=document.createElement("details"),summary=document.createElement("summary");summary.textContent="Original command and result";details.append(summary,pre);article.append(details);$("#cycle-requests").append(article);
    }
  }
  async function loadCycles() {
    const result=await call("cycles");
    const container=$("#cycle-list");container.replaceChildren();
    for(const row of result.rows){
      const b=document.createElement("button");b.type="button";b.textContent=row.label+" · "+row.status+" · "+row.counts.reviewed+"/"+row.counts.selected+" reviewed · "+row.counts.stale+" stale";
      b.onclick=()=>run("Open review cycle",()=>openCycle(row.id));container.append(b);
    }
    if(!result.rows.length)container.textContent="Create a cycle from an existing source-dataset or customer-portfolio comparison.";
    await requests();
  }
  const evidenceFields=()=>'<label>Review evidence files<input name="evidenceFiles" type="file" multiple></label><button type="button" data-retain-evidence>Retain review evidence</button>'+textArea("Retained evidence object IDs","evidence","[]");
  async function openCycle(id) {
    const cycle=await call("cycle?"+new URLSearchParams({id}));
    if(selected!==id){cyclePage=0;cycleSearch="";cycleStatus="";}selected=id;
    const customerCycle=cycle.basis.sourceKind==='portfolio_refresh';
    const originalReviews=customerCycle?(await call('portfolio-cycle-reviews?'+new URLSearchParams({comparisonId:cycle.basis.comparison.id}))).rows:[];
    const allItems=Object.values(cycle.items),filtered=allItems.filter(item=>(!cycleStatus||item.status===cycleStatus)&&
      JSON.stringify([item.caseId,item.impact.case.counterpartyId,item.impact.case.candidateId,item.assignment?.reviewer]).toLowerCase().includes(cycleSearch.toLowerCase()));
    cyclePage=Math.min(cyclePage,Math.max(0,Math.ceil(filtered.length/25)-1));
    const visible=filtered.slice(cyclePage*25,cyclePage*25+25);
    const target=$("#cycle-detail");
    target.innerHTML='<h2>'+escape(cycle.label)+'</h2><p>'+escape(cycle.scopeNote)+'</p><p><strong>'+escape(cycle.status)+'</strong> · version '+cycle.version+
      ' · '+cycle.counts.reviewed+' / '+cycle.counts.selected+' reviewed · '+cycle.counts.stale+' stale · '+cycle.counts.overdue+' overdue</p>'+
      '<p>Supervisor: '+escape(cycle.supervisor.name)+' · '+escape(cycle.supervisor.id)+'. '+(customerCycle?'Customer portfolios: '+escape(cycle.basis.beforePortfolio.label)+' → '+escape(cycle.basis.afterPortfolio.label):'Source dataset: '+escape(cycle.basis.beforeEdition.version)+' → '+escape(cycle.basis.afterEdition.version))+
      '. '+cycle.excludedCaseIds.length+' impacted cases explicitly outside this cycle.</p><button type="button" id="cycle-full-download">Download complete cycle JSON</button><div class="form-grid"><label>Find case or reviewer<input id="cycle-search" value="'+escape(cycleSearch)+'"></label><label>Review state<select id="cycle-status"><option value="">All</option>'+['OPEN','FOLLOW_UP','STALE','REVIEWED'].map(x=>'<option '+(x===cycleStatus?'selected':'')+'>'+x+'</option>').join('')+'</select></label></div><button id="cycle-filter" type="button">Filter cases</button><p>'+filtered.length+' matching / '+allItems.length+' selected cases · page '+(cyclePage+1)+' of '+Math.max(1,Math.ceil(filtered.length/25))+'</p><div class="pager"><button id="cycle-prev" type="button">Previous cases</button><button id="cycle-next" type="button">Next cases</button></div><div id="cycle-items"></div><article id="cycle-signoff"></article><div id="cycle-reports"></div>'+
      '<details><summary>Original source bindings</summary><pre class="scroll-box">'+escape(pretty({comparison:cycle.basis.comparison,beforeEdition:cycle.basis.beforeEdition,afterEdition:cycle.basis.afterEdition,beforePortfolio:cycle.basis.beforePortfolio,afterPortfolio:cycle.basis.afterPortfolio,sourceKind:cycle.basis.sourceKind,excludedCaseIds:cycle.excludedCaseIds}))+'</pre></details>';
    $('#cycle-full-download').onclick=()=>run('Download complete cycle',()=>download('cycle?'+new URLSearchParams({id}),'Review_Cycle_Complete.json'));
    $('#cycle-filter').onclick=()=>run('Filter cycle cases',async()=>{cycleSearch=$('#cycle-search').value;cycleStatus=$('#cycle-status').value;cyclePage=0;await openCycle(id);});
    $('#cycle-prev').disabled=cyclePage===0;$('#cycle-next').disabled=(cyclePage+1)*25>=filtered.length;
    $('#cycle-prev').onclick=()=>run('Previous cycle cases',async()=>{cyclePage--;await openCycle(id);});
    $('#cycle-next').onclick=()=>run('Next cycle cases',async()=>{cyclePage++;await openCycle(id);});
    for(const item of visible){
      const article=document.createElement("article"),c=item.impact.case;
      article.innerHTML='<h3>'+escape(c.counterpartyId)+' · '+escape(c.candidateId)+'</h3><p>'+escape(item.status)+(item.overdue?' · OVERDUE':'')+
        (customerCycle?' · Explicit customer portfolio review':' · Identity review: '+(item.impact.identityReview?'required':'retained')+' · Relevance review: '+(item.impact.relevanceReview?'required':'retained'))+'</p>'+
        '<p>'+escape(item.impact.reasons.join("; "))+'</p><button type="button" data-open-case>Open original case decision</button>'+
        (customerCycle?'<button type="button" data-open-portfolio-refresh>Open original portfolio review</button><details><summary>Exact customer attribute changes</summary><pre class="scroll-box">'+escape(pretty(item.impact.customerChange))+'</pre></details>':'')+
        (item.assignment?'<p>Assigned to '+escape(item.assignment.reviewer.name)+' · '+escape(item.assignment.dueAt||"no due date")+'</p>':'<p>Reviewer not assigned.</p>')+
        '<details><summary>Assign reviewer</summary><form data-assign>'+field("Reviewer ID","reviewerId","text",true,item.assignment?.reviewer.id||"")+
        field("Reviewer name","reviewerName","text",true,item.assignment?.reviewer.name||"")+field("Due","dueAt","datetime-local",false,local(item.assignment?.dueAt||cycle.dueAt))+
        textArea("Assignment note","note")+ '<button type="submit">Save assignment</button></form></details>'+
        '<details><summary>Record review completion or follow-up</summary><form data-complete>'+field("Original case decision revision","caseRevision","text",true,item.currentCaseRevision)+
        '<label>Outcome<select name="disposition"><option value="REVIEWED">Reviewed</option><option value="FOLLOW_UP">Follow-up remains</option></select></label>'+
        (customerCycle?'<label>Original attributed portfolio review<select name="portfolioReviewRequestId"><option value="">Choose the original review, or retain follow-up</option>'+originalReviews.filter(r=>r.caseId===c.id).map(r=>'<option value="'+escape(r.requestId)+'">'+escape(r.decision+' · '+r.reviewer+' · '+new Date(r.createdAt*1000).toLocaleString()+' · '+r.caseRevision.slice(0,12))+'</option>').join('')+'</select></label><p>Reviewed requires the assigned reviewer’s exact original retain/continue event and current case revision. Source-only reviews cannot complete an existing case assignment.</p>':'')+
        textArea("Review note","note")+evidenceFields()+'<button type="submit">Record review</button></form></details>'+
        '<details><summary>Reopen review</summary><form data-reopen>'+textArea("Reason","reason")+'<button type="submit">Reopen this case review</button></form></details>'+
        (item.completion?'<details><summary>Retained completion</summary><pre class="scroll-box">'+escape(pretty(item.completion))+'</pre></details>':'');
      article.querySelector("[data-open-case]").onclick=()=>run("Open original customer decision",async()=>{
        await inspectCase(c.id);navigate("review");
      });
      if(customerCycle)article.querySelector("[data-open-portfolio-refresh]").onclick=()=>run("Open original portfolio review",()=>openPortfolioRefresh(cycle.basis.comparison.id,c.counterpartyId));
      $("#cycle-items").append(article);
      await bind($("[data-assign]",article),"assign:"+id+":"+c.id,f=>({caseId:c.id,reviewer:{id:value(f,"reviewerId").trim(),name:value(f,"reviewerName").trim()},dueAt:iso(value(f,"dueAt")),note:value(f,"note")}),cycle.version,id);
      await bind($("[data-complete]",article),"complete:"+id+":"+c.id,f=>({caseId:c.id,caseRevision:value(f,"caseRevision").trim(),disposition:value(f,"disposition"),note:value(f,"note"),evidence:JSON.parse(value(f,"evidence")||"[]"),
        ...(customerCycle?{portfolioReviewRequestId:value(f,"portfolioReviewRequestId")||null}:{})}),cycle.version,id);
      await bind($("[data-reopen]",article),"reopen:"+id+":"+c.id,f=>({caseId:c.id,reason:value(f,"reason")}),cycle.version,id);
    }
    $("#cycle-signoff").innerHTML='<h3>Supervisor sign-off</h3><p>Sign-off freezes the selected source, exact case decision versions, assignments and completion evidence. Changed decisions remain visible as stale reviews.</p><form id="cycle-signoff-form">'+textArea("Supervisor note","note")+evidenceFields()+'<button type="submit">Sign off and freeze report</button></form>';
    await bind($("#cycle-signoff-form"),"signoff:"+id,f=>({note:value(f,"note"),evidence:JSON.parse(value(f,"evidence")||"[]")}),cycle.version,id);
    for(const report of cycle.reports){
      const p=document.createElement("p");p.textContent="Signed report version "+report.version+" · "+report.signedAt+" · "+report.supervisor.name+" ";
      for(const [label,route,name] of [["Download full report JSON","cycle-report","Review_Cycle.json"],["Download readable report","cycle-report-html","Review_Cycle.html"]]){
        const b=document.createElement("button");b.type="button";b.textContent=label;b.onclick=()=>run("Download frozen review report",()=>download(route+"?"+new URLSearchParams({id,version:report.version}),name));p.append(b);
      }$("#cycle-reports").append(p);
    }
  }
  async function initialize() {
    context=await api("cycle-context");
    $("#cycle-branch").textContent="Workspace: "+context.name;
    const savedActor=await get(branchKey("actor"));if(savedActor){$("#cycle-actor-id").value=savedActor.actor.id;$("#cycle-actor-name").value=savedActor.actor.name;}
    const editions=getState().editions,comparisons=getState().comparisons;
    const customerComparisons=(await call("portfolio-refreshes")).rows;
    $("#cycle-comparison").innerHTML='<optgroup label="Source dataset changes">'+comparisons.map(c=>'<option value="'+escape(c.id)+'">'+escape(c.dataset+" · "+(editions.find(e=>e.id===c.before)?.version||c.before.slice(0,8))+" → "+(editions.find(e=>e.id===c.after)?.version||c.after.slice(0,8)))+'</option>').join("")+'</optgroup><optgroup label="Customer portfolio refresh">'+customerComparisons.map(c=>'<option value="portfolio-refresh:'+escape(c.id)+'">'+escape(c.portfolioKey+' · '+c.before.slice(0,12)+' → '+c.after.slice(0,12))+'</option>').join('')+'</optgroup>';
    await bind($("#cycle-create-form"),"create",f=>({label:value(f,"label"),comparison:value(f,"comparison").replace(/^portfolio-refresh:/,''),...(value(f,"comparison").startsWith('portfolio-refresh:')?{sourceKind:'portfolio_refresh'}:{}),caseIds:value(f,"caseIds").trim()?value(f,"caseIds").split(/\s+/).filter(Boolean):null,
      scopeNote:value(f,"scopeNote"),supervisor:{id:value(f,"supervisorId").trim(),name:value(f,"supervisorName").trim()},dueAt:iso(value(f,"dueAt"))}),0,null);
    await loadCycles();if(selected)await openCycle(selected);
  }
  $("#cycle-use-actor").onclick=()=>run("Select review operator",async()=>{await put({key:branchKey("actor"),actor:identity()});$("#cycle-notice").textContent="Reviewer identity saved for this workspace.";});
  $("#cycle-refresh").onclick=()=>run("Refresh review cycles",async()=>{await refresh();await initialize();});
  document.querySelector('nav [data-view="cycles"]').addEventListener("click",()=>run("Open review cycles",initialize));
}

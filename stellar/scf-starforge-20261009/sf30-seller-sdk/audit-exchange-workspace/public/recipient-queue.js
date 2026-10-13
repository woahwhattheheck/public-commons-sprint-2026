import {auditRequestId} from "/client.mjs";
const FORMAT="commons.audit-recipient-queue-working.v1";
const clone=value=>JSON.parse(JSON.stringify(value));
const $=id=>document.getElementById(id);
const element=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=String(text);return node;};
export function mountRecipientQueue(host,desk){
  let workspace=null,draft=null,draftId=null,draftVersion=0,selectedExport=null,readOnly=false;
  let database=null,loading=false,dirty=false,pendingWrites=0,persistenceError=null,serial=Promise.resolve(),progress=new Map();
  let loadedWorkspace=null,renderedInventory="",history=[],knownVersion=null;
  const panel=$("recipient-queue-panel");
  function db(){
    if(database)return database;
    database=new Promise((resolve,reject)=>{const request=indexedDB.open("audit-recipient-queues",1);
      request.onupgradeneeded=()=>request.result.createObjectStore("drafts",{keyPath:"id"});
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    return database;
  }
  async function transaction(mode,fn){
    const database=await db();return new Promise((resolve,reject)=>{const tx=database.transaction("drafts",mode),store=tx.objectStore("drafts");let result;
      tx.oncomplete=()=>resolve(result);tx.onabort=tx.onerror=()=>reject(tx.error||new Error("Queue working copy was not retained."));
      fn(store,value=>{result=value;},tx);});
  }
  async function listDrafts(){
    const rows=await transaction("readonly",(store,done)=>{const r=store.getAll();r.onsuccess=()=>done(r.result);});
    const select=$("recipient-queue-working"),held=select.value;select.replaceChildren(new Option("Choose a retained unfinished working copy",""));
    for(const row of rows.filter(r=>r.workspaceId===workspace).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))){
      select.add(new Option(row.body.title+" · "+row.updatedAt+" · "+row.id.slice(0,8),row.id));
    }if(Array.from(select.options).some(o=>o.value===held))select.value=held;
  }
  function capture(){if(!draft)return null;return clone(draft);}
  function bounded(value){
    const raw=JSON.stringify(value);if(new TextEncoder().encode(raw).length>16*1024*1024)throw new Error("The complete queue working copy exceeds 16 MiB. Download and preserve the current file.");
    return raw;
  }
  function persist(){
    const body=capture(),wid=workspace;if(!body||readOnly)return serial;
    bounded(body);pendingWrites++;dirty=true;sync();
    serial=serial.then(async()=>{
      const id=draftId||auditRequestId(),expected=draftVersion;
      const saved=await transaction("readwrite",(store,done)=>{
        const read=store.get(id);read.onsuccess=()=>{
          const current=read.result;
          // Preserve a competing tab's complete row and save this one separately.
          const target=current&&current.version!==expected?auditRequestId():id;
          const version=target===id?expected+1:1;
          const row={id:target,workspaceId:wid,version,updatedAt:new Date().toISOString(),body};
          store.put(row);done({id:target,version,conflict:target!==id});
        };
      });
      if(workspace===wid){draftId=saved.id;draftVersion=saved.version;
        if(saved.conflict)host.notice("A concurrent working copy was retained separately. Both complete copies remain available.","info");
        persistenceError=null;
      }
    }).catch(error=>{persistenceError=error;host.notice("The complete queue remains in this page but its browser save failed. Download the working file before closing. "+error.message,"error");})
      .finally(()=>{pendingWrites--;dirty=pendingWrites>0;sync();});
    return serial;
  }
  async function flush(){await persist();await serial;if(persistenceError)throw persistenceError;}
  function fresh(){
    draft={format:FORMAT,workspaceId:workspace,queueId:auditRequestId(),expectedQueueSha256:null,
      title:"Recipient review queue",note:"",selectedReturnSha256:null,entries:[]};
    draftId=null;draftVersion=0;selectedExport=null;readOnly=false;history=[];progress.clear();render();
  }
  function controls(){
    const nativeBlocked=host.busy()||loading||!host.state()||Boolean(host.pending()),blocked=nativeBlocked||pendingWrites>0;
    for(const button of panel.querySelectorAll("button"))button.disabled=blocked||button.dataset.queueUnavailable==="true";
    for(const form of panel.querySelectorAll("form"))form.inert=nativeBlocked;
    $("recipient-queue-add").disabled=blocked||readOnly||!draft;
    $("recipient-queue-save").disabled=blocked||readOnly||!draft?.entries.length||Boolean(persistenceError);
    $("recipient-queue-export").disabled=blocked||!selectedExport;
    $("recipient-queue-download-working").disabled=loading||!draft;
    $("recipient-queue-download-history").disabled=loading||!history.length;
    $("recipient-queue-open").disabled=blocked||!$("recipient-queue-saved").value;
    $("recipient-queue-working-open").disabled=blocked||!$("recipient-queue-working").value;
    $("recipient-queue-next").disabled=blocked||readOnly||!draft?.entries.some(row=>row.disposition==="review"&&progress.get(row.returnSha256)?.status!=="accepted");
    $("recipient-queue-persistence").textContent=persistenceError?"Browser save failed. Preserve the complete working file.":dirty?"Saving complete unfinished work…":draftId?"Unfinished work retained in this browser.":"New queue; save its complete working copy.";
  }
  function sync(){
    const state=host.state();
    if(state?.workspaceId!==loadedWorkspace&&!loading){loading=true;const wid=state?.workspaceId||null;
      serial.then(async()=>{workspace=wid;loadedWorkspace=wid;draft=null;draftId=null;draftVersion=0;selectedExport=null;history=[];progress.clear();
        if(wid){fresh();await listDrafts();}else render();
      }).catch(error=>host.notice(error.message,"error")).finally(()=>{loading=false;controls();});
    }
    if(knownVersion!==state?.version){knownVersion=state?.version;progress.clear();}
    const rows=(state?.exports||[]).filter(row=>row.kind==="recipient-queue"),key=JSON.stringify(rows.map(row=>[row.id,row.sha256]));
    if(key!==renderedInventory){renderedInventory=key;const select=$("recipient-queue-saved"),held=select.value;select.replaceChildren(new Option("Choose a complete saved queue edition",""));
      for(const row of rows)select.add(new Option(row.name+(row.receivedFrom?" · received original":""),row.id));
      if(rows.some(row=>row.id===held))select.value=held;
    }
    controls();
  }
  function render(){
    $("recipient-queue-title").value=draft?.title||"";$("recipient-queue-note").value=draft?.note||"";$("recipient-queue-title").readOnly=readOnly;$("recipient-queue-note").readOnly=readOnly;
    $("recipient-queue-state").textContent=!draft?"Connect the original author workspace.":readOnly?"Received queue history is read-only. Its exact original return/custody files remain available; native acceptance belongs to its original author.":selectedExport?"Saved queue edition retained. Subsequent changes remain unfinished until Save queue edition.":"Select retained returns below; each acceptance remains an explicit original preview/apply.";
    const selection=$("recipient-queue-add-select"),held=selection.value;selection.replaceChildren(new Option("Choose an already-retained complete return",""));
    for(const row of host.state()?.exports||[])if(row.kind==="recipient-return"&&!row.receivedFrom)selection.add(new Option(row.name+" · "+row.sha256.slice(0,12),row.id));
    if(Array.from(selection.options).some(row=>row.value===held))selection.value=held;
    const body=$("recipient-queue-rows");body.replaceChildren();
    for(const [index,row] of (draft?.entries||[]).entries()){
      const tr=element("tr"),pick=element("button","Open review");pick.type="button";
      pick.addEventListener("click",()=>openRow(row));
      const order=element("td"),buttons=element("div");buttons.className="actions";
      for(const [label,offset]of [["Up",-1],["Down",1]]){const b=element("button",label);b.type="button";b.dataset.queueUnavailable=String(readOnly||index+offset<0||index+offset>=draft.entries.length);
        b.addEventListener("click",async()=>{if(readOnly)return;[draft.entries[index],draft.entries[index+offset]]=[draft.entries[index+offset],draft.entries[index]];await persist();render();});buttons.append(b);}
      const remove=element("button","Remove from this edition");remove.type="button";remove.dataset.queueUnavailable=String(readOnly);
      remove.addEventListener("click",async()=>{if(readOnly)return;draft.entries.splice(index,1);if(draft.selectedReturnSha256===row.returnSha256)draft.selectedReturnSha256=null;await persist();render();});
      order.append(element("span",index+1),buttons,remove);
      const description=element("td"),record=(host.state()?.exports||[]).find(item=>item.id===row.returnId);
      description.append(element("p",record?.name||row.returnId),element("small",row.returnSha256),pick);
      const status=element("td",progress.get(row.returnSha256)?.status||"Inspect current original progress");
      const inspect=element("button","Inspect progress");inspect.type="button";inspect.addEventListener("click",()=>host.run("Read original review progress",async()=>{await flush();const value=await host.read("recipient.queue.inspect",{returnId:row.returnId});progress.set(row.returnSha256,value);render();}));status.append(inspect);
      const choice=element("td"),select=element("select");select.setAttribute("aria-label","Workflow choice for "+(record?.name||row.returnId));select.add(new Option("Review","review"));select.add(new Option("Defer","deferred"));select.value=row.disposition;select.disabled=readOnly;
      select.addEventListener("change",()=>{row.disposition=select.value;persist();});choice.append(select);
      const note=element("td"),textarea=element("textarea");textarea.rows=3;textarea.maxLength=6000;textarea.value=row.note;textarea.readOnly=readOnly;textarea.setAttribute("aria-label","Staff note for "+(record?.name||row.returnId));textarea.addEventListener("input",()=>{row.note=textarea.value;persist();});note.append(textarea);
      if(row.previewSha256)note.append(element("small","Saved preview "+row.previewSha256));
      tr.append(order,description,status,choice,note);body.append(tr);
    }
    $("recipient-queue-table").hidden=!draft?.entries.length;$("recipient-queue-empty").hidden=Boolean(draft?.entries.length);
    controls();
  }
  async function openRow(row){
    if(host.busy()||host.pending())return;
    draft.selectedReturnSha256=row.returnSha256;await flush();
    if(readOnly){host.notice("This is inherited original history. Download its complete return or inspect the native received source; do not apply it as a different author.","info");return;}
    desk.selectReturn(row.returnId);$("recipient-apply-form").scrollIntoView({block:"start"});$("recipient-preview").focus();
  }
  function adopt(value){
    selectedExport=value.export;readOnly=value.readOnly;history=value.history;progress.clear();
    const q=value.queue;
    draft={format:FORMAT,workspaceId:workspace,queueId:q.queueId,expectedQueueSha256:value.export.sha256,
      title:q.title,note:q.note,selectedReturnSha256:q.selectedReturnSha256,
      entries:value.entries.map(row=>({returnId:row.retainedReturnId,returnSha256:row.returnSha256,note:row.note,
        disposition:row.disposition,previewSha256:row.preview?.sha256||null}))};
    draftId=null;draftVersion=0;render();
  }
  function checkedWorking(value){
    const keys=["format","workspaceId","queueId","expectedQueueSha256","title","note","selectedReturnSha256","entries"];
    if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).sort().join()!==keys.sort().join()||value.format!==FORMAT||value.workspaceId!==workspace
      ||typeof value.queueId!=="string"||typeof value.title!=="string"||!value.title.trim()||value.title.length>500
      ||typeof value.note!=="string"||value.note.length>6000||!Array.isArray(value.entries)||value.entries.length>128)throw new Error("Choose this author's complete queue working file.");
    const seen=new Set();
    for(const row of value.entries){
      if(!row||typeof row!=="object"||Array.isArray(row)||Object.keys(row).sort().join()!==["returnId","returnSha256","note","disposition","previewSha256"].sort().join()
        ||typeof row.note!=="string"||row.note.length>6000||!["review","deferred"].includes(row.disposition)||seen.has(row.returnSha256))throw new Error("The complete queue contains invalid or repeated entries.");
      seen.add(row.returnSha256);
      const retained=(host.state().exports||[]).find(item=>item.id===row.returnId&&item.kind==="recipient-return"&&item.sha256===row.returnSha256);
      if(!retained||retained.receivedFrom)throw new Error("An exact original return is absent. Preserve this working file and restore its original author workspace.");
    }
    if(value.selectedReturnSha256!==null&&!seen.has(value.selectedReturnSha256))throw new Error("The selected return is absent from this queue.");
    bounded(value);return clone(value);
  }
  $("recipient-queue-title").addEventListener("input",()=>{if(draft&&!readOnly){draft.title=$("recipient-queue-title").value;persist();}});
  $("recipient-queue-note").addEventListener("input",()=>{if(draft&&!readOnly){draft.note=$("recipient-queue-note").value;persist();}});
  $("recipient-queue-new").addEventListener("click",()=>host.run("Retain current working copy and start queue",async()=>{if(draft)await flush();fresh();await persist();await listDrafts();}));
  $("recipient-queue-add").addEventListener("click",()=>host.run("Add complete retained return",async()=>{
    if(readOnly||!draft)throw new Error("Open or start a queue in its original author.");
    const row=(host.state().exports||[]).find(item=>item.id===$("recipient-queue-add-select").value&&item.kind==="recipient-return");
    if(!row||row.receivedFrom)throw new Error("Choose an original author return.");
    if(draft.entries.some(item=>item.returnSha256===row.sha256))throw new Error("This exact complete return is already selected.");
    if(draft.entries.length>=128)throw new Error("A queue holds at most128 complete returns.");
    draft.entries.push({returnId:row.id,returnSha256:row.sha256,note:"",disposition:"review",previewSha256:null});await persist();render();
  }));
  $("recipient-queue-open").addEventListener("click",()=>host.run("Open saved complete queue",async()=>{await flush();const value=await host.read("recipient.queue.get",{exportId:$("recipient-queue-saved").value});adopt(value);await persist();await listDrafts();}));
  $("recipient-queue-save-form").addEventListener("submit",event=>{event.preventDefault();host.run("Save complete queue edition",async()=>{
    if(readOnly)throw new Error("Received queue history remains original. Start a new queue in its original author to edit.");
    await flush();const value=checkedWorking(draft);
    const {format,workspaceId,...inputs}=value;
    const result=await host.mutate("recipient.queue.save",{...inputs,actor:host.operator()});
    adopt(await host.read("recipient.queue.get",{exportId:result.archive.id}));await persist();await listDrafts();
    host.notice("Complete queue edition saved. Prepare a fresh original preview before accepting a return.");
  });});
  $("recipient-queue-export").addEventListener("click",()=>host.run("Export complete selected queue and originals",async()=>{
    await flush();if(!selectedExport)throw new Error("Select a saved queue edition first.");
    const result=await host.mutate("recipient.queue.export",{exportId:selectedExport.id,actor:host.operator(),note:"Complete selected recipient queue with original history and custody"});
    await host.download(result.archive);
  }));
  $("recipient-queue-next").addEventListener("click",async()=>{const row=await host.run("Inspect the next pending original return",async()=>{await flush();for(const item of draft?.entries||[]){if(item.disposition!=="review")continue;const value=await host.read("recipient.queue.inspect",{returnId:item.returnId});progress.set(item.returnSha256,value);if(value.status!=="accepted"){render();return item;}}render();host.notice("Every selected review return has original accepted custody, or is explicitly deferred.");return null;});if(row)try{await openRow(row);}catch(error){host.notice(error.message,"error");}});
  $("recipient-queue-download-working").addEventListener("click",()=>{if(draft)host.downloadBytes(bounded(draft)+"\n","Audit_Recipient_Queue_Working.json","application/json");});
  $("recipient-queue-download-history").addEventListener("click",()=>host.downloadBytes(JSON.stringify(history,null,2)+"\n","Audit_Recipient_Queue_History.json","application/json"));
  $("recipient-queue-import").addEventListener("change",()=>host.run("Open complete queue working file",async()=>{
    const file=$("recipient-queue-import").files[0];if(!file)return;if(file.size>16*1024*1024)throw new Error("The working file exceeds16MiB.");
    const value=checkedWorking(JSON.parse(await file.text()));await flush();draft=value;draftId=null;draftVersion=0;selectedExport=null;history=[];readOnly=false;await persist();render();await listDrafts();
  }));
  $("recipient-queue-working-open").addEventListener("click",()=>host.run("Open retained unfinished queue",async()=>{
    await flush();const id=$("recipient-queue-working").value;
    const row=await transaction("readonly",(store,done)=>{const read=store.get(id);read.onsuccess=()=>done(read.result);});
    const value=checkedWorking(row.body);draft=value;draftId=row.id;draftVersion=row.version;selectedExport=null;history=[];readOnly=false;render();
  }));
  for(const id of ["recipient-queue-saved","recipient-queue-working"])$(id).addEventListener("change",controls);
  window.addEventListener("beforeunload",event=>{if(dirty||persistenceError){event.preventDefault();event.returnValue="";}});
  return {sync,rememberPreview:async(value)=>{
    const row=draft?.entries.find(item=>item.returnId===value.returnId);
    if(row&&!readOnly){row.previewSha256=value.preview.sha256;draft.selectedReturnSha256=row.returnSha256;await persist();render();}
  },recovered:async(action,result)=>{
    if(action==="recipient.queue.save"){adopt(await host.read("recipient.queue.get",{exportId:result.archive.id}));await persist();await listDrafts();return true;}
    if(action==="recipient.queue.export"){await host.download(result.archive);return true;}
    return false;
  }};
}

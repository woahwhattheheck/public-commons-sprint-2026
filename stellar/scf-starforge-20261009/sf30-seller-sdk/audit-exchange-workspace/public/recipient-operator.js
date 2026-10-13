import {auditSha256} from "/client.mjs";
import {mountRecipientQueue} from "/recipient-queue.js";

export function mountRecipientOperator(host){
  const $=id=>document.getElementById(id), clone=value=>JSON.parse(JSON.stringify(value));
  const LIMIT=256*1024*1024;
  let queue=null;
  let workspaceId=null, inventory="", selectedPreview=null, returnFile=null;
  const source=$("recipient-author-export"), returned=$("recipient-return");
  const record=id=>(host.state()?.exports||[]).find(row=>row.id===id);
  const same=()=>selectedPreview&&selectedPreview.returnId===returned.value
    && selectedPreview.preview.workspaceId===host.state()?.workspaceId
    && selectedPreview.preview.expectedVersion===host.state()?.version
    && selectedPreview.preview.operator===host.operator();
  const clearPreview=message=>{
    selectedPreview=null;$("recipient-preview-summary").textContent=message||"Select a retained return and preview its complete authored reviews.";
    $("recipient-review-table").replaceChildren();$("recipient-preview-json").textContent="";
    $("recipient-preview-detail").open=false;
  };
  function options(select,rows,label){
    const held=select.value;select.replaceChildren(new Option(label,""));
    for(const row of rows)select.add(new Option(row.name+" · "+row.sha256.slice(0,12)+" · "+row.bytes.toLocaleString()+" bytes",row.id));
    if(rows.some(row=>row.id===held))select.value=held;
  }
  function summary(value){
    const p=value.preview, accepted=p.reviews.filter(row=>row.accepted).length;
    $("recipient-preview-summary").textContent=p.reviews.length+" authored reviews; "+accepted+" already accepted and "+(p.reviews.length-accepted)+" pending. Original workspace "+p.workspaceId+", reviewed version "+p.expectedVersion+". Full return SHA256 "+p.returnSha256+".";
    host.table("recipient-review-table",p.reviews,[
      {label:"Native outcome",cell:row=>row.accepted?"Already accepted":"Pending"},
      {label:"Review",cell:row=>row.request.inputs.title},
      {label:"Status / assignee",cell:row=>row.request.inputs.status+" / "+(row.request.inputs.assignee||"Unassigned")},
      {label:"Original source / revision",cell:row=>row.request.inputs.sourceId+"\n"+row.request.inputs.revisionId},
      {label:"Complete note",cell:row=>row.request.inputs.note},
      {label:"Original request",cell:row=>row.request.requestId}
    ],{pageSize:50,emptyText:"This whole manuscript has no review changes."});
    $("recipient-preview-json").textContent="";
    if($("recipient-preview-detail").open)$("recipient-preview-json").textContent=JSON.stringify(p,null,2);
  }
  function sync(){
    const state=host.state(),busy=host.busy(),blocked=busy||!state||Boolean(host.pending());
    if(workspaceId!==state?.workspaceId){
      workspaceId=state?.workspaceId||null;inventory="";returnFile=null;$("recipient-return-file").value="";
      $("recipient-file-status").textContent="Choose the complete returned ZIP; its original source remains inside.";
      clearPreview();
    }
    const entries=state?.exports||[],key=JSON.stringify(entries.map(row=>[row.id,row.kind,row.sha256]));
    if(key!==inventory){inventory=key;
      options(source,entries.filter(row=>["workspace","application"].includes(row.kind)),"Choose an original complete author export");
      options(returned,entries.filter(row=>row.kind==="recipient-return"),"Choose a retained complete return");
    }
    let current=false;try{current=Boolean(same());}catch{}
    if(selectedPreview&&!current)$("recipient-preview-summary").textContent="The selected workspace version, operator or return changed. Preserve the displayed preview and prepare a fresh one before applying. An outstanding request is recovered above with its original body.";
    $("recipient-prepare").disabled=blocked||!source.value;
    $("recipient-stage").disabled=blocked||!returnFile;
    $("recipient-preview").disabled=blocked||!returned.value;
    $("recipient-apply").disabled=blocked||!current;
    $("recipient-download-preview").disabled=busy||!selectedPreview;
    $("recipient-download-return").disabled=busy||!record(returned.value);
    source.disabled=busy||!state;returned.disabled=busy||!state;
    $("recipient-empty").hidden=Boolean(entries.some(row=>["workspace","application"].includes(row.kind)));
    queue?.sync();
  }
  source.addEventListener("change",sync);
  returned.addEventListener("change",()=>{clearPreview();sync();});
  $("actor").addEventListener("input",sync);
  $("recipient-preview-detail").addEventListener("toggle",()=>{
    $("recipient-preview-json").textContent=$("recipient-preview-detail").open&&selectedPreview?JSON.stringify(selectedPreview.preview,null,2):"";
  });
  $("recipient-return-file").addEventListener("change",()=>{
    returnFile=$("recipient-return-file").files[0]||null;
    if(returnFile&&returnFile.size>LIMIT){returnFile=null;$("recipient-return-file").value="";host.notice("The complete returned ZIP exceeds 256 MiB. Preserve the original archive and use the documented native receiving course.","error");}
    $("recipient-file-status").textContent=returnFile?returnFile.name+" · "+returnFile.size.toLocaleString()+" complete bytes; not yet retained by the author.":"Choose the complete returned ZIP; its original source remains inside.";
    sync();
  });
  $("recipient-prepare-form").addEventListener("submit",event=>{event.preventDefault();host.run("Prepare complete recipient editor",async()=>{
    const item=record(source.value);if(!item||!["workspace","application"].includes(item.kind))throw new Error("Choose the original complete author export.");
    const result=await host.mutate("recipient.prepare",{exportId:item.id,expectedSha256:item.sha256,actor:host.operator(),note:$("recipient-prepare-note").value});
    $("recipient-result").textContent="Complete recipient editor retained as "+result.archive.id+". Extract the whole ZIP and open Audit_Recipient_Review.html with the adjacent original source files.";
    await host.download(result.archive);
  });});
  $("recipient-stage-form").addEventListener("submit",event=>{event.preventDefault();host.run("Receive complete returned review",async()=>{
    const file=returnFile;if(!file||file.size>LIMIT)throw new Error("Choose the complete returned ZIP.");
    const raw=new Uint8Array(await file.arrayBuffer()),sha=await auditSha256(raw);
    const result=await host.mutate("recipient.stage",{name:file.name,contentBase64:await host.fileBase64(new Blob([raw])),expectedSha256:sha,actor:host.operator(),note:$("recipient-stage-note").value});
    sync();returned.value=result.archive.id;clearPreview();
    $("recipient-result").textContent="Retained manuscript "+result.manuscriptId+" with "+result.editions+" immutable editions and "+result.reviews+" authored reviews. Preview before applying.";
  });});
  $("recipient-preview").addEventListener("click",()=>host.run("Preview every returned review",async()=>{
    const id=returned.value;if(!record(id))throw new Error("Choose a retained complete return.");
    const value=await host.read("recipient.preview",{returnId:id,operator:host.operator()});
    if(value.returnId!==id||value.preview.workspaceId!==host.state().workspaceId)throw new Error("The preview belongs to a different original selection.");
    selectedPreview=clone(value);summary(selectedPreview);await queue.rememberPreview(selectedPreview);
  }));
  $("recipient-apply-form").addEventListener("submit",event=>{event.preventDefault();host.run("Apply exact recipient review preview",async()=>{
    if(!same())throw new Error("Preview this complete return against the current operator and native version.");
    const held=clone(selectedPreview);
    const result=await host.mutate("recipient.apply",{returnId:held.returnId,previewSha256:held.preview.sha256,preview:held.preview,actor:held.preview.operator,note:$("recipient-apply-note").value});
    clearPreview("The exact reviewed return has been accepted. Its full original requests, source and native outcomes are retained.");
    $("recipient-result").textContent="Accepted manuscript "+result.accepted.manuscriptId+". Complete custody download "+result.archive.id+" is retained in this original workspace.";
    await host.download(result.archive);
  });});
  $("recipient-download-preview").addEventListener("click",()=>{
    if(selectedPreview)host.downloadBytes(JSON.stringify(selectedPreview.preview,null,2)+"\n","Audit_Recipient_Preview_"+selectedPreview.preview.sha256+".json","application/json");
  });
  $("recipient-download-return").addEventListener("click",()=>host.run("Download complete retained return",async()=>{
    const item=record(returned.value);if(item)await host.download(item);
  }));
  queue=mountRecipientQueue(host,{selectReturn:id=>{if(!record(id)||record(id).kind!=="recipient-return")throw new Error("The original retained return is unavailable.");returned.value=id;clearPreview();sync();}});
  return {sync,recovered:async(action,result)=>{
    if(await queue.recovered(action,result))return;
    if(result?.archive){sync();if(action==="recipient.stage")returned.value=result.archive.id;
      $("recipient-result").textContent="Recovered original "+action+" and retained complete artifact "+result.archive.id+".";
      await host.download(result.archive);}
  }};
}

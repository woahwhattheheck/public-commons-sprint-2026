/* Complete colleague-return interaction; shares the response desk's original working-copy store. */
(function(){
"use strict";
const C=HCPSCore,R=HCPSReturns,D=HCPSDesk.reviewBridge,$=id=>document.getElementById(id);
let view=null;
const empty=()=>({version:1,selected:"",drafts:[],pendingIssue:null});
function state(){const s=D.state()||empty();C.need(s.version===1&&Array.isArray(s.drafts),"Restore the complete original review working copies.");return s;}
function selected(s=state()){return s.drafts.find(x=>x.id===s.selected)||null;}
function text(id,value){$(id).textContent=String(value??"");}
function options(el,rows,value){el.replaceChildren();for(const [id,label] of rows){const o=document.createElement("option");o.value=id;o.textContent=label;el.append(o);}el.value=value||"";}
function node(tag,value,cls){const e=document.createElement(tag);if(value!==undefined)e.textContent=String(value);if(cls)e.className=cls;return e;}
function cellText(value){return value.present?JSON.stringify(value.value,null,2):"(field or record absent)";}
function currentWorkspace(){return HCPSDesk.current()?.workspace;}
function message(value,error=false){D.notice(value,error);}
function run(fn){return D.run(fn);}
async function retain(s,rerender=false){await D.retainState(s);if(rerender)render();}
function mutate(fn,rerender=false){const s=state(),d=selected(s);C.need(d,"Choose or create a complete review working copy.");C.need(!d.pending,"Recover the original saved request before changing this review working copy.");fn(d,s);d.plan=null;d.request=null;D.retainState(s).then(()=>{if(rerender)render();}).catch(e=>message(e.message,true));}
function controls(){
 const d=selected(),pending=!!d?.pending,busy=HCPSDesk.storageState().busy;
 document.querySelectorAll("[data-return-edit]").forEach(e=>e.disabled=busy||!d||pending);
 $("return-recover").disabled=busy||!pending;$("return-rebase").disabled=busy||!pending;
 $("return-apply").disabled=busy||!d?.plan||pending||!!d?.plan?.unresolved?.length;
 $("issue-recover").disabled=busy||!state().pendingIssue;
}
function renderRows(d){
 const holder=$("return-changes");holder.replaceChildren();
 if(!d?.preview)return;
 const map=new Map((d.choices||[]).map(x=>[x.id,x]));
 for(const row of d.preview.changes){
  const box=node("details",undefined,"return-change"),summary=node("summary",row.path+" · "+row.status);
  const choice=map.get(row.id),select=document.createElement("select");select.dataset.returnEdit="";select.setAttribute("aria-label","Choice for "+row.path);select.dataset.changeId=row.id;
  options(select,[["","Choose content"],["current","Keep author content"],["returned","Use returned content"],["custom","Write complete custom value"]],choice?.choice||"");
  select.onchange=()=>mutate(x=>{const found=x.choices.find(c=>c.id===row.id);found.choice=select.value;if(select.value==="custom"&&!found.customText)found.customText=JSON.stringify(row.current,null,2);},true);
  const columns=node("div",undefined,"return-values");for(const [label,key] of [["Issued baseline","baseline"],["Current author","current"],["Returned colleague","returned"]]){const col=node("div");col.append(node("h4",label),node("pre",cellText(row[key]),"readout"));columns.append(col);}
  box.append(summary,columns,node("label","Explicit selection"),select);
  if(choice?.choice==="custom"){const area=document.createElement("textarea");area.rows=7;area.className="code";area.value=choice.customText||JSON.stringify(row.current,null,2);area.setAttribute("aria-label","Complete custom value for "+row.path);area.dataset.returnEdit="";area.oninput=()=>mutate(x=>{x.choices.find(c=>c.id===row.id).customText=area.value;});box.append(node("p",'Use {"present":false} to remove a field, or {"present":true,"value":...} for its exact complete value. Record additions retain their original ID.',"hint"),area);}
  holder.append(box);
 }
}
function render(){
 const w=currentWorkspace();if(!w)return;
 const s=state(),d=selected(s);view={copyId:HCPSDesk.current().id,draftId:d?.id};
 options($("issue-edition"),[["","Choose reviewed edition"],...w.editions.map(e=>[e.id,"Edition "+e.number+" · "+e.actor+" · "+e.note])],s.issueEdition||w.editions.at(-1)?.id||"");
 $("issue-note").value=s.issueNote||"";
 const h=R.history(w);
 text("issue-count",h.issues.length+" issued complete packages · "+h.decisions.length+" saved return decisions");
 const issues=$("issued-list");issues.replaceChildren();
 for(const i of h.issues){const li=node("li"),b=node("button","Download issued original");b.onclick=()=>run(async()=>D.download("HCPS_Issued_"+i.id+".json",R.history(currentWorkspace()).archives[i.archiveSha256].raw));li.append(node("p",i.actor+" · "+i.issuedAt+" · "+i.note),node("code",i.archiveSha256),b);issues.append(li);}
 options($("return-working-copy"),[["","Select review working copy"],...s.drafts.map(x=>[x.id,x.name+(x.completed?" · applied":x.pending?" · original request retained":"")])],s.selected);
 $("return-editor").hidden=!d;
 $("return-recovery").hidden=!d?.pending;
 $("issue-recovery").hidden=!s.pendingIssue;
 if(d){
  options($("return-issue"),[["","Choose exact original issue"],...h.issues.map(i=>[i.id,i.issuedAt+" · "+i.actor+" · "+i.note])],d.issueId);
  $("return-actor").value=d.actor||"";$("return-note").value=d.note||"";$("return-ack").checked=d.acknowledgeUnapplied===true;
  text("return-file-name",d.fileName?d.fileName+" · "+C.bytes(d.raw||"").length+" original UTF-8 bytes":"Choose the whole returned workspace or working-copy JSON.");
  text("return-summary",d.preview?d.preview.counts.all+" changed fields/records · "+d.preview.counts.conflicts+" conflicts · returned "+d.preview.returned.sha256:"Compare the exact complete returned file with its issued baseline and the current author content.");
  text("return-unapplied",d.preview?.returned.unappliedEditors.length?"The original return contains unapplied editor text: "+d.preview.returned.unappliedEditors.join(", ")+". It remains in the preserved complete return; the comparison uses its applied draft.":"");
  $("return-material-json").value=d.materialText||"[]";
  text("return-plan",d.plan?JSON.stringify({planSha256:d.plan.planSha256,draftSha256:d.plan.draftSha256,materialReviews:d.plan.requiredMaterialReviews,unresolved:d.plan.unresolved,reviewer:d.plan.actor,purpose:d.plan.note},null,2):"Review the complete explicit selections, then prepare a plan.");
  text("return-pending",d.pending?d.pending.kind+" · "+d.pending.inputs.requestId+" · "+d.pending.at:"");
  text("return-completed",d.completed?"Saved author edition "+d.completed.editionId+" · original decision "+d.completed.requestId:"");
  renderRows(d);
 }
 const decisions=$("return-decisions");decisions.replaceChildren();
 for(const r of h.decisions){const li=node("li"),a=node("button","Download complete review record");a.onclick=()=>run(async()=>D.download("HCPS_Return_Review_"+r.requestId+".json",JSON.stringify(r,null,2)));const b=node("button","Download complete returned original");b.onclick=()=>run(async()=>D.download("HCPS_Returned_"+r.returnedSha256+".json",R.history(currentWorkspace()).archives[r.returnedSha256].raw));li.append(node("p",r.plan.actor+" · "+r.appliedAt+" · "+r.plan.note),node("code",r.editionSha256),a,b);decisions.append(li);}
 controls();
}
async function newDraft(){
 const s=state(),w=currentWorkspace(),d={id:C.id(),name:"Return review "+(s.drafts.length+1),issueId:R.history(w).issues.at(-1)?.id||"",raw:"",fileName:"",actor:w.draft.actor,note:"",acknowledgeUnapplied:false,choices:[],materialText:"[]",preview:null,plan:null,request:null,pending:null,completed:null};
 s.drafts.push(d);s.selected=d.id;await retain(s,true);message("Opened an independent review working copy; every previous return and unfinished choice remains retained.");
}
async function recoverIssue(){
 let s=state();C.need(s.pendingIssue,"No original issue request is pending.");const held=C.clone(s.pendingIssue),snapshot=await D.snapshot();
 C.need(snapshot.copyId===held.copyId,"Open this original author working copy.");
 const result=await R.issue(snapshot.workspace,held.inputs);
 s=state();C.need(C.equal(s.pendingIssue,held),"The original issued request changed.");
 s.pendingIssue=null;s.issueEdition=held.inputs.editionId;s.issueNote=held.inputs.note;
 await D.install(result.workspace,{copyId:snapshot.copyId,workspaceSha256:await C.sha(C.canonical(snapshot.workspace))},s);
 D.download("HCPS_Issued_"+result.issue.id+".json",result.raw);message("The exact reviewed edition and full original source were issued and retained.");
}
async function compare(){
 const s=state(),d=selected(s);C.need(d&&!d.pending,"Recover the original pending action before comparing this working copy.");C.need(d.issueId&&d.raw,"Choose the original issue and complete returned file.");const snap=await D.snapshot();C.need(!snap.unapplied.length,"Apply or explicitly discard the author's retained editor drafts before comparing; the whole working-copy download keeps them.");
 const p=await R.preview(snap.workspace,{issueId:d.issueId,raw:d.raw}),old=d.preview,oldChoices=new Map((d.choices||[]).map(c=>[c.id,c]));
 d.choices=p.changes.map(row=>{const prior=old?.changes.find(r=>r.id===row.id),choice=oldChoices.get(row.id);return prior&&choice&&C.equal(prior,row)?C.clone(choice):{id:row.id,choice:"",customText:""};});
 d.preview=p;d.plan=null;d.request=null;d.materialText="[]";await retain(s,true);message("The full three-way comparison is retained. Choose each changed value or use an explicit whole-side selection.");
}
function choiceInputs(d){
 C.need(d.preview,"Compare the complete source first.");
 return d.preview.changes.map(row=>{const c=d.choices.find(x=>x.id===row.id);C.need(c&&c.choice,"Choose content for "+row.path);return{id:row.id,choice:c.choice,...(c.choice==="custom"?{value:JSON.parse(c.customText)}:{})};});
}
async function prepare(){
 const s=state(),d=selected(s);C.need(d&&!d.pending,"Recover the original request first.");const snap=await D.snapshot();C.need(!snap.unapplied.length,"Apply or explicitly discard the author's unfinished editor fields before preparing the full plan.");
 const req=d.request||{requestId:C.id(),at:new Date().toISOString()};
 const inputs={...req,issueId:d.issueId,raw:d.raw,expectedPreviewSha256:d.preview?.previewSha256,choices:choiceInputs(d),materialReviews:JSON.parse(d.materialText||"[]"),acknowledgeUnapplied:d.acknowledgeUnapplied===true,actor:d.actor,note:d.note};
 const result=await R.plan(snap.workspace,inputs);d.request=req;d.plan=result.plan;await retain(s,true);message(result.plan.unresolved.length?"The complete plan is retained. Explicitly reopen or re-review the listed changed-material decisions.":"The complete plan is retained and ready for deliberate application.");
}
async function recoverApply(){
 let s=state(),d=selected(s);C.need(d?.pending,"Choose the review working copy with its original retained request.");const held=C.clone(d.pending),draftId=d.id,snap=await D.snapshot();C.need(snap.copyId===held.copyId,"Reopen the original author working copy.");
 const result=await R.apply(snap.workspace,held.inputs);
 s=state();d=s.drafts.find(x=>x.id===draftId);C.need(d&&C.equal(d.pending,held),"Keep the exact original pending return decision.");
 d.pending=null;d.completed={requestId:result.decision.requestId,editionId:result.decision.editionId,editionSha256:result.decision.editionSha256};d.plan=null;d.request=null;
 await D.install(result.workspace,{copyId:snap.copyId,workspaceSha256:await C.sha(C.canonical(snap.workspace))},s);
 message("Saved the complete attributed author edition, explicit review plan and whole returned original.");
}
$("issue-edition").onchange=()=>{const s=state();s.issueEdition=$("issue-edition").value;D.retainState(s).catch(e=>message(e.message,true));};
$("issue-note").oninput=()=>{const s=state();s.issueNote=$("issue-note").value;D.retainState(s).catch(e=>message(e.message,true));};
$("issue-create").onclick=()=>run(async()=>{
 const s=state();C.need(!s.pendingIssue,"Recover the original pending issue.");const snap=await D.snapshot();C.need(!snap.unapplied.length,"Apply or explicitly discard unfinished author editors before issuing a reviewed edition.");
 const inputs={requestId:C.id(),at:new Date().toISOString(),actor:snap.workspace.draft.actor,note:$("issue-note").value,editionId:$("issue-edition").value,expectedWorkspaceSha256:await C.sha(C.canonical(snap.workspace))};
 await R.issue(snap.workspace,inputs);s.pendingIssue={kind:"issue",copyId:snap.copyId,at:inputs.at,inputs};await retain(s,true);await recoverIssue();
});
$("issue-recover").onclick=()=>run(recoverIssue);
$("return-new").onclick=()=>run(newDraft);
$("return-working-copy").onchange=()=>run(async()=>{const s=state();s.selected=$("return-working-copy").value;await retain(s,true);});
$("return-issue").onchange=()=>mutate(d=>{d.issueId=$("return-issue").value;d.preview=null;d.choices=[];d.materialText="[]";},true);
$("return-file").onchange=()=>run(async()=>{const s=state(),d=selected(s),f=$("return-file").files[0];C.need(d&&!d.pending&&f,"Choose a complete original returned file.");C.need(f.size<=800*1024*1024,"This complete original exceeds the receiving envelope limit.");const raw=await f.text();await R.readPackage(raw);d.raw=raw;d.fileName=f.name;d.preview=null;d.plan=null;d.request=null;d.choices=[];d.materialText="[]";await retain(s,true);message("Retained the whole original returned file and its complete unfinished editors.");});
for(const [id,key] of [["return-actor","actor"],["return-note","note"]])$(id).oninput=()=>mutate(d=>{d[key]=$(id).value;});
$("return-ack").onchange=()=>mutate(d=>{d.acknowledgeUnapplied=$("return-ack").checked;});
$("return-material-json").oninput=()=>mutate(d=>{d.materialText=$("return-material-json").value;});
$("return-compare").onclick=()=>run(compare);
for(const [id,choice] of [["return-all-current","current"],["return-all-returned","returned"]])$(id).onclick=()=>run(async()=>{const s=state(),d=selected(s);C.need(d?.preview&&!d.pending,"Compare this original return first.");d.choices=d.preview.changes.map(r=>({id:r.id,choice,customText:""}));d.plan=null;d.request=null;d.materialText="[]";await retain(s,true);message("Explicitly selected "+(choice==="current"?"current author":"returned colleague")+" content for every changed field and record. Review the complete plan before applying.");});
$("return-plan-create").onclick=()=>run(prepare);
$("return-reopen-materials").onclick=()=>run(async()=>{const s=state(),d=selected(s);C.need(d?.plan&&!d.pending,"Prepare the complete plan first.");d.materialText=JSON.stringify(d.plan.requiredMaterialReviews.map(x=>({id:x.id,mode:"reopen",...(x.kind==="requirement"?{status:"ready-for-review"}:{}),reason:"Reopened for explicit assessment of the newly assembled source and evidence."})),null,2);d.plan=null;d.request=null;await retain(s,true);message("Explicit reopening decisions are retained. Prepare the complete plan again to inspect the final result.");});
$("return-apply").onclick=()=>run(async()=>{const s=state(),d=selected(s);C.need(d?.plan&&!d.pending&&!d.plan.unresolved.length,"Prepare the exact fully resolved plan first.");const snap=await D.snapshot();const inputs={...d.request,issueId:d.issueId,raw:d.raw,expectedPreviewSha256:d.preview.previewSha256,expectedPlanSha256:d.plan.planSha256,choices:choiceInputs(d),materialReviews:JSON.parse(d.materialText||"[]"),acknowledgeUnapplied:d.acknowledgeUnapplied===true,actor:d.actor,note:d.note};d.pending={kind:"return.apply",copyId:snap.copyId,at:inputs.at,inputs};await retain(s,true);await recoverApply();});
$("return-recover").onclick=()=>run(recoverApply);

$("return-rebase").onclick=()=>run(async()=>{
 const s=state(),d=selected(s);C.need(d?.pending,"Select the retained original request.");const snap=await D.snapshot();await C.validate(snap.workspace);
 const prior=R.history(snap.workspace).decisions.find(r=>r.requestId===d.pending.inputs.requestId);
 if(prior){await recoverApply();return;}
 C.need(snap.copyId===d.pending.copyId,"Open the original author working copy.");
 C.need(await C.sha(C.canonical(snap.workspace))!==d.plan?.currentWorkspaceSha256,"The author content has not changed. Recover or resolve this original request.");
 const old=C.clone(d.pending),next=C.clone(d);next.id=C.id();next.name=d.name+" · recompare";next.pending=null;next.plan=null;next.request=null;next.completed=null;next.materialText="[]";
 d.rejectedRequests=d.rejectedRequests||[];d.rejectedRequests.push({original:old,reason:"Author workspace changed before this original apply was committed; no matching saved decision exists.",retainedAt:new Date().toISOString()});d.pending=null;
 s.drafts.push(next);s.selected=next.id;await retain(s,true);await compare();message("Preserved the complete earlier request and compared a distinct review copy against the actual current author source.");
});

$("return-download-original").onclick=()=>run(async()=>{const d=selected();C.need(d?.raw,"Choose a retained original return.");D.download(d.fileName||"HCPS_Complete_Returned_Original.json",d.raw);});
$("return-download-unapplied").onclick=()=>run(async()=>{const d=selected();C.need(d?.raw,"Choose a retained original return.");const p=await R.readPackage(d.raw);D.download("HCPS_Returned_Unapplied_Editors.json",JSON.stringify({originalSha256:p.packageSha256,rawEditors:p.rawEditors,ui:p.ui},null,2));});
window.HCPSReturnUI={render,controls};
if(currentWorkspace())render();
})();
// SPDX-License-Identifier: MIT
// Hosted Learning exchange. Native requests retain the original app's saved UUID.
import * as X from "./learning-exchange.mjs";
import {renderLearningReview} from "./learning-exchange-render.mjs";

const ROOT="/_merchant/",now=()=>new Date().toISOString(),uid=prefix=>prefix+"-"+crypto.randomUUID();
const S={workspace:null,learning:null,ledger:null,active:null,preview:null,contextText:null,busy:false,sequence:0,sections:[],sectionPage:0,assets:null};
const arrays=["packets","drafts","returns","operations","applications"];
const el=(tag,text,parent,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;if(parent)parent.append(n);return n;};
const panel=document.createElement("section");panel.id="learning-exchange";panel.className="learning-exchange";
const host=document.getElementById("learning-panel");
if(!host)throw new Error("The original Learning panel is unavailable.");
host.append(panel);
const nodes={};
function named(tag,key,text,parent,cls){const n=el(tag,text,parent,cls);n.id="exchange-"+key;nodes[key]=n;return n;}
function field(parent,key,label,kind="input"){const wrap=el("label",undefined,parent);el("span",label,wrap);const n=named(kind,key,undefined,wrap);if(kind==="textarea")n.rows=3;return n;}
function button(parent,key,label,work){const n=named("button",key,label,parent);n.type="button";n.addEventListener("click",()=>run(work));return n;}
function notice(message,error=false){nodes.notice.textContent=message;nodes.notice.classList.toggle("error",error);}
function same(a,b){return X.canonical(a)===X.canonical(b);}
function option(value,label){const n=el("option",label);n.value=value;return n;}
function choose(n,values,keep=n.value){n.replaceChildren(...values.map(row=>option(row.value,row.label)));if(values.some(row=>row.value===keep))n.value=keep;}
function download(name,text,type="application/json"){const u=URL.createObjectURL(new Blob([text],{type})),a=el("a");a.href=u;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),30000);}
function details(parent,label,value){const d=el("details",undefined,parent);el("summary",label,d);el("pre",typeof value==="string"?value:X.canonical(value),d);return d;}
function sync(){
 for(const n of panel.querySelectorAll("button,input,select,textarea"))n.disabled=S.busy;
 if(S.busy)return;
 nodes.apply.disabled=!S.preview?.canApply;
 nodes.rebase.disabled=!S.preview||S.preview.canApply;
 nodes.download.disabled=!S.active;nodes.offline.disabled=!S.active;
 nodes.compare.disabled=S.active?.schema!==X.SCHEMAS.returned;
 nodes.issue.disabled=!S.learning?.cycles?.length;
 const section=S.sections[Number(nodes.section.value)||0],length=Array.isArray(section?.value)?section.value.length:0;
 nodes.previous.disabled=S.sectionPage===0;nodes.next.disabled=!length||(S.sectionPage+1)*30>=length;
}
async function run(work){if(S.busy)return;S.busy=true;sync();try{await work();}catch(error){notice(error.message,true);}finally{S.busy=false;sync();}}
async function request(path,body){
 const headers={Authorization:"Bearer "+token};if(body!==undefined)headers["Content-Type"]="application/json";
 const r=await fetch(ROOT+path,{method:body===undefined?"GET":"POST",headers,body:body===undefined?undefined:JSON.stringify(body),cache:"no-store"});
 const text=await r.text();if(!r.ok){let message;try{message=JSON.parse(text).error;}catch{}throw new Error(message||"The original host did not return a readable response.");}return text;
}
function checked(value){
 if(value.schema===X.SCHEMAS.packet)return X.inspectPacket(value);
 if(value.schema===X.SCHEMAS.draft)return X.inspectDraft(value);
 if(value.schema===X.SCHEMAS.returned)return X.inspectReturn(value);
 throw new Error("Select an issued packet, complete draft or returned decision.");
}
function requireWorkspace(value){const c=checked(value).context;if(c.workspaceId!==S.workspace.id)throw new Error("This exchange belongs to a different original workspace.");return c;}
function emptyLedger(){return {workspaceId:S.workspace.id,revision:0,packets:[],drafts:[],returns:[],operations:[],applications:[]};}
function bundleOf(row){return X.createBundle({id:uid("bundle"),createdAt:now(),...Object.fromEntries(arrays.map(key=>[key,row[key]]))});}
let database;
async function db(){if(database)return database;database=await new Promise((resolve,reject)=>{const r=indexedDB.open("tjlabs-grant-analyst-learning-exchange",1);r.onupgradeneeded=()=>r.result.createObjectStore("workspaces");r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.onblocked=()=>reject(new Error("Close the older exchange tab before opening its local history."));});return database;}
function mergeRows(old,added,key){const map=new Map(old.map(row=>[row[key],row]));for(const row of added){const prior=map.get(row[key]);if(prior&&!same(prior,row))throw new Error("A retained "+key+" names different exchange content.");map.set(row[key],row);}return [...map.values()];}
async function ledger(additions={}){
 const workspaceId=S.workspace.id,d=await db();
 const result=await new Promise((resolve,reject)=>{
  const tx=d.transaction("workspaces","readwrite"),store=tx.objectStore("workspaces"),r=store.get(workspaceId);let result,failure;
  r.onsuccess=()=>{try{
   const row=r.result||emptyLedger();if(row.workspaceId!==workspaceId)throw new Error("The local exchange workspace changed.");
   for(const key of arrays)row[key]=mergeRows(row[key],additions[key]||[],key==="operations"?"id":key==="applications"?"operationId":"sha256");
   for(const key of ["packets","drafts","returns"])for(const value of row[key])requireWorkspace(value);
   bundleOf(row);row.revision+=1;store.put(row,workspaceId);result=row;
  }catch(error){failure=error;tx.abort();}};
  tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(failure||tx.error||new Error("Exchange history could not be saved."));tx.onabort=()=>reject(failure||tx.error||new Error("Exchange history was interrupted."));
 });
 if(S.workspace.id!==workspaceId)throw new Error("The original workspace changed during the local save.");
 S.ledger=result;renderHistory();return result;
}
function additions(value){
 const c=checked(value),out={packets:[c.packet]};
 if(c.draft)out.drafts=[c.draft];if(c.returned)out.returns=[c.returned];return out;
}
function setActive(value){
 requireWorkspace(value);S.active=value;S.preview=null;S.contextText=null;
 const c=checked(value);nodes.selection.textContent=(value.schema===X.SCHEMAS.returned?"Returned decision":value.schema===X.SCHEMAS.draft?"Saved draft":"Issued packet")+" · "+value.id+" · "+c.context.cycle.title;
 nodes.comparison.replaceChildren();renderSections();renderHistory();sync();
}
function renderHistory(){
 const keep=nodes.history.value,rows=[];for(const key of ["packets","drafts","returns"])for(const value of S.ledger?.[key]||[])rows.push({value:key+":"+value.sha256,label:key.slice(0,-1)+" · "+value.id+" · "+value.sha256.slice(0,12)});
 choose(nodes.history,rows,keep);
 nodes.operations.replaceChildren();
 for(const op of S.ledger?.operations||[]){
  const receipt=S.ledger.applications.find(a=>a.operationId===op.id),row=el("div",undefined,nodes.operations,"exchange-operation");
  el("strong",receipt?"Saved in original workspace":"Retained original request",row);
  el("p",op.request.action+" · "+op.request.body.requestId,row);
  const b=el("button",receipt?"Reopen saved result":"Resume original request",row);b.type="button";b.addEventListener("click",()=>run(()=>resume(op)));
  details(row,"Complete request and "+(receipt?"saved result":"selected context"),receipt||op);
 }
 if(!S.ledger?.operations.length)el("p","Applied and unfinished requests appear here with their original request IDs.",nodes.operations,"muted");
}
function renderSections(){
 const keep=nodes.section.value,sections=[];
 if(S.active){const c=checked(S.active),ctx=c.context;
  sections.push({label:"Finding and complete cycle history",value:ctx.cycle},{label:"Selected codebook",value:ctx.selectedCodebook},{label:"All original codebooks",value:ctx.codebooks});
  if(c.decision)sections.push({label:"Returned or drafted decision",value:c.decision});
  if(ctx.report)sections.push({label:"Issued complete report",value:ctx.report});
  if(ctx.comparison)sections.push({label:"Issued edition comparison",value:ctx.comparison});
  for(const source of ctx.sources)sections.push({label:"Original source · "+source.edition.id,value:source.text});
  if(c.draft)sections.push({label:"Complete draft history",value:c.draft.history});
  if(c.packet.rebase)sections.push({label:"Full prior return and rebase choices",value:c.packet.rebase});
  if(S.preview){sections.push({label:"Current complete cycle history",value:S.preview.current.cycle},{label:"Current selected codebook",value:S.preview.current.selectedCodebook});
   if(S.preview.current.report)sections.push({label:"Current complete report",value:S.preview.current.report});
   if(S.preview.current.comparison)sections.push({label:"Current edition comparison",value:S.preview.current.comparison});
   for(const source of S.preview.current.sources)sections.push({label:"Current original source · "+source.edition.id,value:source.text});
  }
 }
 S.sections=sections;choose(nodes.section,sections.map((s,i)=>({value:String(i),label:s.label})),keep);S.sectionPage=0;renderSection();
}
function renderSection(){
 const section=S.sections[Number(nodes.section.value)||0];nodes.context.replaceChildren();if(!section)return;
 let value=section.value;
 if(Array.isArray(value)){const start=S.sectionPage*30;el("p","Showing "+(value.length?start+1:0)+"–"+Math.min(start+30,value.length)+" of "+value.length+" entries. The download retains all entries.",nodes.context);value=value.slice(start,start+30);}
 el("pre",typeof value==="string"?value:X.canonical(value),nodes.context);sync();
}
function selectedCycle(){return S.learning?.cycles.find(row=>row.id===nodes.cycle.value);}
function renderIssueSelection(){
 const c=selectedCycle();choose(nodes.action,(c?.actions||[]).map(a=>({value:a.id,label:a.revisions.at(-1).title+" · "+a.id})));
 const dataset=c?.baseline.report.edition.dataset,editions=(S.workspace?.editions||[]).filter(x=>x.dataset===dataset);
 const prior=nodes.edition.value;choose(nodes.edition,editions.map(e=>({value:e.id,label:e.name+" · "+e.sha256.slice(0,12)})),prior);
 if(!prior&&c)nodes.edition.value=c.reviews.at(-1)?.snapshot.report.edition.id||c.baseline.report.edition.id;
 nodes.action.parentElement.hidden=nodes.mode.value!=="action";nodes.edition.parentElement.hidden=nodes.mode.value!=="review";nodes.grants.parentElement.hidden=nodes.mode.value!=="review";
}
async function refreshWorkspace(){
 const sequence=++S.sequence,[stateResponse,learningResponse]=await Promise.all([api("state"),api("learning")]);
 const [state,learning]=await Promise.all([stateResponse.json(),learningResponse.json()]);
 if(sequence!==S.sequence)return;if(S.workspace&&state.id!==S.workspace.id)throw new Error("Reload this page for the newly opened original workspace.");
 S.workspace=state;S.learning=learning;nodes.workspace.textContent=state.name+" · "+state.id;
 choose(nodes.cycle,learning.cycles.map(c=>({value:c.id,label:c.title+" · "+c.id})));renderIssueSelection();await ledger();
 notice("Original workspace and locally saved exchange history refreshed.");
}
async function capture(selection){const result=await request("learning-exchange/context",selection),value=JSON.parse(result);if(value.workspaceId!==S.workspace.id)throw new Error("The source context belongs to another workspace.");return result;}
async function sources(){
 if(S.assets)return S.assets;
 const names={domainSource:"learning-exchange.mjs",uiSource:"learning-exchange-offline.mjs",css:"learning-exchange-offline.css",template:"learning-exchange-offline.html"};
 const rows=await Promise.all(Object.entries(names).map(async([key,name])=>{const response=await fetch(ROOT+name,{cache:"no-store"});if(!response.ok)throw new Error("The selected offline source is unavailable: "+name);return [key,await response.text()];}));
 S.assets=Object.fromEntries(rows);return S.assets;
}
async function offline(value=S.active){if(!value)throw new Error("Select complete exchange work first.");const rendered=await renderLearningReview(value,await sources());download(rendered.filename,rendered.html,"text/html");notice("Complete offline reviewer downloaded with original context and all retained draft history.");}
async function issue(){
 const chosen={mode:nodes.mode.value,cycle:nodes.cycle.value},issuedBy=nodes.issuer.value,recipient=nodes.recipient.value,instructions=nodes.instructions.value;
 if(chosen.mode==="action")chosen.action=nodes.action.value;else{chosen.edition=nodes.edition.value;chosen.grantIds=nodes.grants.value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);}
 const literal=await capture(chosen),packet=X.issuePacket(literal,{id:uid("packet"),issuedAt:now(),issuedBy,recipient,instructions});
 setActive(packet);await ledger(additions(packet));await offline(packet);
}
async function importFile(){
 const file=nodes.import.files[0];if(!file)throw new Error("Choose a complete exchange JSON file.");
 if(file.size>64*1024*1024)throw new Error("The exchange file exceeds the selected 64 MiB limit.");
 const value=X.parseExchange(await file.text());
 if(value.schema===X.SCHEMAS.bundle){
  const b=X.inspectBundle(value);for(const key of ["packets","drafts","returns"])for(const item of b[key])requireWorkspace(item);
  const active=b.returns.at(-1)||b.drafts.at(-1)||b.packets.at(-1);if(active)setActive(active);
  await ledger(Object.fromEntries(arrays.map(k=>[k,b[k]])));
 }else{setActive(value);await ledger(additions(value));}
 nodes.import.value="";notice("Complete exchange imported into local history. Select a returned decision to compare it with the original workspace.");
}
async function compare(){
 const value=S.active;if(value?.schema!==X.SCHEMAS.returned)throw new Error("Select a returned decision first.");
 const c=X.inspectReturn(value),literal=await capture(c.context.selection);
 if(S.active?.sha256!==value.sha256)return;
 S.preview=X.previewReturn(value,literal);S.contextText=literal;renderComparison();renderSections();
 notice(S.preview.canApply?"The returned decision matches current source and cycle context. Review the displayed changes, then apply.":"Current context changed. Review the differences and make explicit choices before producing a new draft.");
}
function renderComparison(){
 const p=S.preview;nodes.comparison.replaceChildren();if(!p)return;
 el("h4",p.canApply?"Ready for analyst review":"Current context has changed",nodes.comparison);
 for(const c of p.conflicts)el("p",c.message,nodes.comparison,"exchange-conflict");
 for(const action of p.actions){
  const wrap=el("div",undefined,nodes.comparison,"exchange-action");el("h4",action.id,wrap);
  const table=el("table",undefined,wrap),head=el("tr",undefined,el("thead",undefined,table));
  for(const name of ["Field","Issued","Current workspace","Returned","Rebase choice"])el("th",name,head);
  const body=el("tbody",undefined,table);
  for(const change of action.changes){
   const tr=el("tr",undefined,body);el("th",change.field,tr);
   for(const key of ["issued","current","returned"])el("td",typeof change[key]==="string"?change[key]:X.canonical(change[key]),tr);
   const td=el("td",undefined,tr);
   if(change.choiceRequired){const select=el("select",undefined,td);select.dataset.action=action.id;select.dataset.field=change.field;select.append(option("","Choose explicitly"),option("current","Keep current"),option("returned","Use returned"));select.setAttribute("aria-label",action.id+" "+change.field+" rebase choice");}
   else el("span",change.hostChanged?"Current and returned agree":change.reviewerChanged?"Use returned change":"Unchanged",td);
  }
 }
 if(!p.canApply){
  const box=el("div",undefined,nodes.comparison,"exchange-rebase");
  const label=el("label",undefined,box),check=el("input",undefined,label);check.type="checkbox";check.id="exchange-accept-context";el("span","I have reviewed the current cycle, codebook and source context.",label);
  const r=field(box,"rebase-reviewer","Analyst making these choices");r.value=nodes.issuer.value;
  field(box,"rebase-reason","Reason for the new draft","textarea");
 }
 sync();
}
async function rebase(){
 if(!S.preview||S.preview.canApply||!S.contextText)throw new Error("Compare a changed return first.");
 if(!document.getElementById("exchange-accept-context")?.checked)throw new Error("Review and accept the current context before rebasing.");
 const choices={context:"accept-current-context",actions:{}};
 for(const n of nodes.comparison.querySelectorAll("select[data-action]")){if(!n.value)throw new Error("Choose current or returned for every changed field.");(choices.actions[n.dataset.action]??={})[n.dataset.field]=n.value;}
 const draft=X.rebaseReturn(S.active,S.contextText,{id:uid("rebase"),recordedAt:now(),reviewer:nodes["rebase-reviewer"].value,reason:nodes["rebase-reason"].value,choices});
 setActive(draft);await ledger(additions(draft));await offline(draft);
}
async function originalReceipt(op){
 const result=JSON.parse(await request("learning-exchange/receipt?requestId="+encodeURIComponent(op.request.body.requestId)));
 if(result.workspaceId!==S.workspace.id||result.requestId!==op.request.body.requestId)throw new Error("The original receipt belongs to another workspace or request.");
 if(!result.receipt)return null;
 const application={operationId:op.id,returnSha256:op.returnSha256,contextText:op.contextText,request:op.request,receipt:result.receipt};
 await ledger({applications:[application]});return application;
}
async function settleNativePending(op){
 // A verified native receipt can outlive a lost response in the original UI.
 // Clear only this exact saved request; preserve another request or active writer.
 if(!current||current.id!==S.workspace.id||requestInFlight)return;
 requestInFlight=true;pendingView();
 try{
  const retained=await saved(undefined,{workspaceId:S.workspace.id});
  if(retained&&!same(retained,op.request))return;
  if(pending&&!same(pending,op.request))return;
  if(retained)await saved(undefined,{remove:true,requestId:op.request.body.requestId,workspaceId:S.workspace.id});
  if(pending?.body?.requestId===op.request.body.requestId)pending=null;
 }finally{requestInFlight=false;pendingView();}
 try{await refresh();}catch(error){notice("The native result is saved. Refresh its original workspace view when available. "+error.message,true);}
}
async function resume(op){
 await ledger();
 const stored=S.ledger.operations.find(o=>o.id===op.id);if(!stored||!same(stored,op))throw new Error("Reopen the complete retained operation from this workspace's history.");
 const existing=await originalReceipt(op);if(existing){await settleNativePending(op);notice("The original saved request and complete native result have been reopened.");return existing;}
 if(!current||current.id!==S.workspace.id)throw new Error("Refresh the original Learning workspace before applying.");
 if(requestInFlight)throw new Error("Finish the current original source request before resuming.");
 if(pending&&!same(pending,op.request))throw new Error("Resolve the original saved request shown above before resuming this exchange.");
 let entered=false,dispatchError=null;requestInFlight=true;pendingView();
 try{
  // The original request store compares literal object order. A portable bundle
  // can sort those keys; reopen the existing exact object when its meaning matches.
  const retained=await saved(undefined,{workspaceId:S.workspace.id});
  if(retained&&!same(retained,op.request))throw new Error("Another original saved request is present.");
  const nativeRequest=retained||op.request;
  await saved(nativeRequest,{workspaceId:S.workspace.id});pending=retainedOperation(nativeRequest);pendingView();
  requestInFlight=false;entered=true;
  await submit(nativeRequest.action,nativeRequest.body,true);
 }catch(error){dispatchError=error;}
 finally{if(!entered){requestInFlight=false;pendingView();}}
 let application;
 try{application=await originalReceipt(op);}catch(error){throw new Error((dispatchError?dispatchError.message+" ":"")+"The exact operation remains saved. "+error.message);}
 if(application){await settleNativePending(op);notice("Returned Learning work saved through the original request, with its complete native result retained.");return application;}
 throw dispatchError||new Error("The original request remains in exchange history. Resume it to recover its saved result.");
}
async function apply(){
 if(S.active?.schema!==X.SCHEMAS.returned||!S.preview?.canApply)throw new Error("Compare a returned decision and review its current changes first.");
 const returned=S.active,prior=S.ledger.operations.filter(op=>op.returnSha256===returned.sha256);
 if(prior.length){if(prior.length!==1)throw new Error("Select the exact retained operation from history.");return resume(prior[0]);}
 const literal=await capture(X.inspectReturn(returned).context.selection),preview=X.previewReturn(returned,literal);
 S.preview=preview;S.contextText=literal;renderComparison();renderSections();
 if(!preview.canApply)throw new Error("The workspace changed after the displayed comparison. Review the new context and rebase this return.");
 const prepared=X.prepareApply(returned,literal),op={id:uid("operation"),returnSha256:returned.sha256,contextText:literal,request:{action:prepared.action,body:{...prepared.body,requestId:crypto.randomUUID()}}};
 await ledger({...additions(returned),operations:[op]});
 return resume(op);
}

el("h3","Offline Learning reviews",panel);
el("p","Send a complete finding or cycle review to a colleague. Reopen their returned work here, compare it with the current workspace and apply it through the original saved request.",panel);
named("p","workspace","Opening original workspace…",panel,"muted");
named("p","notice","",panel,"exchange-notice").setAttribute("role","status");
const toolbar=el("div",undefined,panel,"exchange-toolbar");
button(toolbar,"refresh","Refresh workspace",refreshWorkspace);
button(toolbar,"export","Export complete exchange history",async()=>{await ledger();download("learning-exchange-"+S.workspace.id+".json",X.canonical(bundleOf(S.ledger)));notice("All issued work, draft versions, returns, retained requests and saved results exported.");});
const issueBox=el("details",undefined,panel);issueBox.open=true;el("summary","Issue work to a colleague",issueBox);
const form=el("div",undefined,issueBox,"exchange-grid");
field(form,"mode","Work to send","select").append(option("action","One action update"),option("review","Complete cycle review"));
field(form,"cycle","Original Learning cycle","select");field(form,"action","Action to update","select");
field(form,"edition","Review source edition","select");field(form,"grants","Exact grant references, one per line","textarea");
field(form,"issuer","Issuing analyst");field(form,"recipient","Colleague or role");field(form,"instructions","Requested work","textarea");
button(issueBox,"issue","Save and download offline reviewer",issue);
nodes.cycle.addEventListener("change",renderIssueSelection);nodes.mode.addEventListener("change",renderIssueSelection);
const importBox=el("div",undefined,panel,"exchange-toolbar");field(importBox,"import","Returned work or exchange bundle").type="file";nodes.import.accept=".json,application/json";
button(importBox,"import-button","Import complete file",importFile);
const historyBar=el("div",undefined,panel,"exchange-toolbar");field(historyBar,"history","Saved exchange work","select");
button(historyBar,"open","Open selected history",()=>{const [key,sha]=nodes.history.value.split(":");const v=S.ledger?.[key]?.find(x=>x.sha256===sha);if(!v)throw new Error("Choose saved work first.");setActive(v);notice("Complete saved exchange reopened.");});
named("p","selection","Select or issue complete exchange work.",panel);
const selectedBar=el("div",undefined,panel,"exchange-toolbar");
button(selectedBar,"download","Download selected JSON",()=>download("learning-"+S.active.id+".json",X.canonical(S.active)));
button(selectedBar,"offline","Download offline reviewer",()=>offline());
button(selectedBar,"compare","Compare returned work",compare);
button(selectedBar,"apply","Apply reviewed return",apply);
button(selectedBar,"rebase","Save new draft with these choices",rebase);
named("div","comparison",undefined,panel);
const contextBar=el("div",undefined,panel,"exchange-toolbar");field(contextBar,"section","Complete context and history","select");
button(contextBar,"previous","Previous entries",()=>{S.sectionPage=Math.max(0,S.sectionPage-1);renderSection();});
button(contextBar,"next","Next entries",()=>{S.sectionPage+=1;renderSection();});
button(contextBar,"context-download","Download full selected context",()=>{const selected=S.sections[Number(nodes.section.value)||0];if(!selected)throw new Error("Select context first.");download("learning-context.txt",typeof selected.value==="string"?selected.value:X.canonical(selected.value),"text/plain");});
nodes.section.addEventListener("change",()=>{S.sectionPage=0;renderSection();});
named("div","context",undefined,panel,"exchange-context");
el("h4","Original requests and saved results",panel);named("div","operations",undefined,panel);
el("p","Keep the complete exchange history alongside the original workspace handover. The original handover contains source work and native decisions; the exchange download carries colleague drafts, issued packets and saved request history.",panel,"muted");
await run(refreshWorkspace);

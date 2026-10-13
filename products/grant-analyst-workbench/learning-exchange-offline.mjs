/* Complete offline reviewer. No network access or native mutation is performed. */
(async function(){
"use strict";
const P=globalThis.LearningExchange,$=id=>document.getElementById(id),now=()=>new Date().toISOString(),uuid=()=>crypto.randomUUID();
const sources=JSON.parse($("exchange-sources").textContent),seed=P.parseExchange($("exchange-payload").textContent);
const S={draft:null,decision:null,packets:[],drafts:[],returns:[],operations:[],applications:[],queue:Promise.resolve(),busy:false,dirty:false,unpersisted:false,storageAvailable:true,lastSaved:null,sections:[],page:0,recovery:null};
let database,timer;
function notice(message,error=false){$("notice").textContent=message;$("notice").classList.toggle("error",error);}
function node(tag,text,parent,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;if(parent)parent.append(e);return e;}
function option(value,label){const n=document.createElement("option");n.value=value;n.textContent=label;return n;}
function syncEnabled(){for(const e of document.querySelectorAll("button,input,select,textarea"))e.disabled=S.busy||!!S.recovery;for(const id of ["recover","keep-file"])$(id).disabled=S.busy;if(!S.busy&&!S.recovery){const selected=S.sections[Number($("context-select").value)||0],rows=selected?.value?.rows||selected?.value?.grants;$("previous").disabled=!Array.isArray(rows)||S.page===0;$("next").disabled=!Array.isArray(rows)||(S.page+1)*25>=rows.length;}}
function run(fn){const task=S.queue.then(async()=>{S.busy=true;syncEnabled();try{return await fn();}finally{S.busy=false;syncEnabled();}});S.queue=task.catch(error=>notice(error.message,true));return task;}
function saveFile(name,value,type="application/json"){
 const blob=new Blob([value],{type}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;a.style.display="none";document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
function unique(rows,key){const map=new Map();for(const row of rows){const k=row[key],prior=map.get(k);if(prior&&P.canonical(prior)!==P.canonical(row))throw new Error("A retained "+key+" names different contents");map.set(k,row);}return [...map.values()];}
async function db(){if(database)return database;database=await new Promise((resolve,reject)=>{const r=indexedDB.open("stellar-forge-learning-offline",1);r.onupgradeneeded=()=>r.result.createObjectStore("drafts");r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});return database;}
function key(){return "draft:"+S.draft.packet.sha256;}
async function localRead(k){const d=await db();return new Promise((resolve,reject)=>{const t=d.transaction("drafts","readonly"),r=t.objectStore("drafts").get(k);let value;r.onsuccess=()=>value=r.result;t.oncomplete=()=>resolve(value);t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error);});}
async function persist(){
 const d=await db(),value={draft:S.draft,packets:S.packets,drafts:S.drafts,returns:S.returns,operations:S.operations,applications:S.applications},k=key(),expected=S.lastSaved;
 await new Promise((resolve,reject)=>{const t=d.transaction("drafts","readwrite"),store=t.objectStore("drafts"),r=store.get(k);let failure;
 r.onsuccess=()=>{const existing=r.result;if((existing?P.identityText(P.canonical(existing)).sha256:null)!==expected){failure=new Error("Another tab saved this packet. Your complete work remains open; export it before reopening or choosing the other saved draft.");t.abort();return;}store.put(value,k);};
 t.oncomplete=()=>resolve();t.onerror=()=>reject(failure||t.error);t.onabort=()=>reject(failure||t.error);});
 S.lastSaved=P.identityText(P.canonical(value)).sha256;S.unpersisted=false;$("save-state").textContent="Local draft revision "+S.draft.history.length+" saved at "+S.draft.history.at(-1).recordedAt+". Download a file for portable custody.";
}
async function flush(){
 clearTimeout(timer);
 if(S.dirty){S.draft=P.saveDraft(S.draft,S.decision,{recordedAt:now(),editor:S.decision.reviewer.trim()||S.draft.packet.recipient});S.dirty=false;S.unpersisted=true;renderHistory();}
 try{await persist();}catch(error){$("save-state").textContent="Local persistence unavailable. The complete current draft remains in this page; save a draft file or HTML now.";throw error;}
}
async function flushForDownload(){try{await flush();}catch(error){if(S.dirty)throw error;/* Complete current draft exists; only browser persistence failed. */}}
function capture(){
 if(!S.draft)return;const d={reviewer:$("reviewer").value,reviewId:$("review-fields").hidden?null:$("review-id").value,interpretation:$("review-fields").hidden?"":$("interpretation").value,limitations:$("review-fields").hidden?"":$("limitations").value,actions:[]};
 for(const box of $("actions").querySelectorAll("fieldset")){const row={id:box.dataset.action};for(const f of ["title","owner","dueOn","successCriteria","status","note","evidence"])row[f]=box.querySelector('[data-field="'+f+'"]').value;d.actions.push(row);}
 S.decision=d;S.dirty=true;S.unpersisted=true;$("save-state").textContent="Unsaved changes in this page…";clearTimeout(timer);timer=setTimeout(()=>run(flush).catch(()=>{}),500);
}
function field(parent,label,key,value,{area=false,type="text",choices=null}={}){
 const wrapper=node("label",label,parent),input=document.createElement(choices?"select":area?"textarea":"input");input.dataset.field=key;
 if(choices)for(const value of choices)input.append(option(value,value));else if(area)input.rows=key==="note"?4:3;else input.type=type;
 input.value=value;input.required=true;wrapper.append(input);return input;
}
function renderDecision(){
 const checked=P.inspectDraft(S.draft),c=checked.context,d=S.decision;
 $("reviewer").value=d.reviewer;$("review-fields").hidden=c.selection.mode!=="review";
 $("review-id").value=d.reviewId||"";$("review-id").required=c.selection.mode==="review";
 $("interpretation").value=d.interpretation;$("limitations").value=d.limitations;
 $("interpretation").required=$("limitations").required=c.selection.mode==="review";
 $("decision-heading").textContent=c.selection.mode==="review"?"Complete cycle review":"Action update";
 $("mode-help").textContent=c.selection.mode==="review"?"Review every original action against the complete selected later evidence. The interpretation and evidence limits are retained with the native cycle review.":"Return a proposed update for this original action. Its complete finding, baseline and earlier cycle reviews remain visible alongside it.";
 $("actions").replaceChildren();
 for(const row of d.actions){const action=c.cycle.actions.find(x=>x.id===row.id),latest=action.revisions.at(-1),box=node("fieldset",undefined,$("actions"));box.dataset.action=row.id;node("legend",row.id+" · issued revision "+latest.revision,box);
 field(box,"Concrete action","title",row.title);const pair=node("div",undefined,box,"pair");field(pair,"Responsible owner","owner",row.owner);field(pair,"Review due","dueOn",row.dueOn,{type:"date"});
 field(box,"Success and review criteria","successCriteria",row.successCriteria,{area:true});field(box,"Proposed status","status",row.status,{choices:["OPEN","IN_PROGRESS","COMPLETED","WITHDRAWN"]});field(box,"Decision rationale","note",row.note,{area:true});field(box,"Evidence or source reference","evidence",row.evidence,{area:true});
 const detail=node("details",undefined,box);node("summary","Complete original action history",detail);node("pre",P.canonical(action.revisions),detail);
 }
}
function section(label,value,raw=null){S.sections.push({label,value,raw});}
function renderContext(){
 const {packet,context:c}=P.inspectDraft(S.draft);$("subtitle").textContent=c.cycle.title+" · "+c.workspaceName;
 $("identity").textContent="Packet "+packet.id+" · "+packet.sha256+" · source workspace "+c.workspaceId;
 $("assignment").replaceChildren();for(const [label,value] of [["Issued by",packet.issuedBy],["Intended reviewer",packet.recipient],["Issued",packet.issuedAt],["Instructions",packet.instructions],["Original selection",c.selection.mode==="review"?"Whole cycle · "+c.selection.edition:c.selection.action]]){node("dt",label,$("assignment"));node("dd",value,$("assignment"));}
 $("finding").replaceChildren();node("h3",c.cycle.title,$("finding"));node("p",c.cycle.finding,$("finding"));node("p","Review question: "+c.cycle.reviewQuestion,$("finding"));
 S.sections=[];section("Original finding report",c.cycle.baseline.report);section("Original finding references",c.cycle.baseline.references);
 if(c.report){section("Selected later report",c.report);section("Complete source comparison",c.comparison);section("Selected review snapshot",c.snapshot);}
 for(const r of c.cycle.reviews)section("Earlier review · "+r.id,r);
 for(const b of c.codebooks)section("Codebook · "+b.id,b);
 for(const s of c.sources)section("Original source · "+s.edition.name+" · "+s.sha256.slice(0,12),{edition:s.edition,sha256:s.sha256,bytes:s.bytes},s.text);
 section("Complete issued context",c,packet.contextText);
 if(packet.rebase)section("Complete prior return and rebase choices",packet.rebase);
 $("context-select").replaceChildren(...S.sections.map((s,i)=>option(String(i),s.label)));S.page=0;renderSection();
 $("packet-text").textContent=P.canonical(packet);
}
function renderSection(){
 const selected=S.sections[Number($("context-select").value)||0];if(!selected)return;
 $("context-text").textContent=selected.raw??P.canonical(selected.value);
 const rows=Array.isArray(selected.value?.rows)?selected.value.rows:Array.isArray(selected.value?.grants)?selected.value.grants:null;
 const table=$("report");table.querySelector("thead").replaceChildren();table.querySelector("tbody").replaceChildren();table.hidden=!rows;
 $("previous").hidden=$("next").hidden=!rows;
 if(rows){const columns=selected.value.rows?["grantId","title","amountAwarded","currency","reviewState","categoryLabel","reason"]:["id","title","amountAwarded","currency","description"];
 S.page=Math.max(0,Math.min(S.page,Math.max(0,Math.ceil(rows.length/25)-1)));const tr=node("tr",undefined,table.querySelector("thead"));for(const col of columns)node("th",col,tr);
 for(const row of rows.slice(S.page*25,(S.page+1)*25)){const tr=node("tr",undefined,table.querySelector("tbody"));for(const col of columns){const v=row[col];node("td",v===null?"null":typeof v==="object"?JSON.stringify(v):String(v??""),tr);}}
 $("page-info").textContent=rows.length?"Rows "+(S.page*25+1)+"–"+Math.min(rows.length,(S.page+1)*25)+" of "+rows.length:"No rows";
 $("previous").disabled=S.page===0;$("next").disabled=(S.page+1)*25>=rows.length;
 }else $("page-info").textContent="";
 $("context-summary").textContent=selected.label+(selected.raw?" · "+P.identityText(selected.raw).bytes+" literal bytes":" · complete JSON");
}
function renderHistory(){
 const keep=$("history").value;$("history").replaceChildren(...S.draft.history.map(r=>option(String(r.revision),"Revision "+r.revision+" · "+r.editor+" · "+r.recordedAt)));$("history").value=keep&&S.draft.history.some(r=>String(r.revision)===keep)?keep:String(S.draft.history.length);
 $("history-text").textContent=P.canonical(S.draft.history[Number($("history").value)-1]);
 $("returns").replaceChildren();for(const r of S.returns){const detail=node("details",undefined,$("returns"));node("summary",r.id+" · "+r.submittedBy+" · "+r.submittedAt,detail);node("p","Returned draft "+r.draft.sha256,detail);const b=node("button","Download exact return",detail);b.type="button";b.addEventListener("click",()=>saveFile("learning-return-"+r.id+".json",P.canonical(r)));}
 if(!S.returns.length)node("p","No return has been created in this exchange yet.",$("returns"));
}
function asBundle(){return P.createBundle({id:"exchange-"+S.draft.id,createdAt:now(),packets:unique([...S.packets,S.draft.packet],"sha256"),drafts:[...unique(S.drafts,"sha256").filter(d=>d.sha256!==S.draft.sha256),S.draft],returns:unique(S.returns,"sha256"),operations:S.operations,applications:S.applications});}
function from(value){
 if(value.schema===P.SCHEMAS.packet){P.inspectPacket(value);return {draft:P.createDraft(value,{id:uuid(),recordedAt:now(),editor:value.recipient}),packets:[value],drafts:[],returns:[],operations:[],applications:[]};}
 if(value.schema===P.SCHEMAS.draft){P.inspectDraft(value);return {draft:value,packets:[value.packet],drafts:[value],returns:[],operations:[],applications:[]};}
 if(value.schema===P.SCHEMAS.returned){P.inspectReturn(value);return {draft:value.draft,packets:[value.draft.packet],drafts:[value.draft],returns:[value],operations:[],applications:[]};}
 const b=P.inspectBundle(value),draft=b.drafts.at(-1)||b.returns.at(-1)?.draft;
 if(!draft){if(b.packets.length)return {...from(b.packets.at(-1)),...b,draft:from(b.packets.at(-1)).draft};throw new Error("This complete bundle contains no editable packet.");}
 return {draft,packets:b.packets,drafts:b.drafts,returns:b.returns,operations:b.operations,applications:b.applications};
}
function adopt(data){P.inspectDraft(data.draft);P.createBundle({id:"checked",createdAt:now(),packets:data.packets||[],drafts:[...(data.drafts||[]),data.draft],returns:data.returns||[],operations:data.operations||[],applications:data.applications||[]});S.draft=data.draft;S.decision=P.inspectDraft(S.draft).decision;S.packets=data.packets;S.drafts=data.drafts||[];S.returns=data.returns;S.operations=data.operations||[];S.applications=data.applications||[];S.dirty=false;S.unpersisted=true;S.lastSaved=null;renderContext();renderDecision();renderHistory();}
function mergeRetained(data){S.unpersisted=true;S.packets=unique([...S.packets,...data.packets,data.draft.packet],"sha256");S.drafts=unique([...S.drafts,...(data.drafts||[]),data.draft],"sha256");S.returns=unique([...S.returns,...data.returns],"sha256");S.operations=unique([...S.operations,...(data.operations||[])],"id");S.applications=unique([...S.applications,...(data.applications||[])],"operationId");}
function prefix(a,b){return a.packet.sha256===b.packet.sha256&&a.history.length<=b.history.length&&a.history.every((r,i)=>r.sha256===b.history[i].sha256);}
async function openValue(value){
 const data=from(value);adopt(data);
 let local;try{local=await localRead(key());}catch(error){S.storageAvailable=false;$("save-state").textContent="Memory-only draft. Download a complete file before leaving this page.";notice("Browser storage is unavailable. Use Save draft file or Save offline HTML to retain your work. "+error.message,true);return;}
 if(local){P.inspectDraft(local.draft);if(value.schema===P.SCHEMAS.packet||prefix(S.draft,local.draft)){adopt(local);mergeRetained(data);S.lastSaved=P.identityText(P.canonical(local)).sha256;await persist();notice("Reopened complete local draft revision "+S.draft.history.length+".");}
 else if(prefix(local.draft,S.draft)){mergeRetained(local);S.lastSaved=P.identityText(P.canonical(local)).sha256;await persist();}
 else{S.recovery={local,file:data};$("recovery").hidden=false;$("recovery-text").textContent="The opened file and this browser's saved draft have different histories. Both remain intact. Choose which one to continue; the other can be exported first.";syncEnabled();return;}
 }else await persist();
}
$("form").addEventListener("submit",e=>e.preventDefault());$("form").addEventListener("input",capture);$("form").addEventListener("change",capture);
$("save").addEventListener("click",()=>run(async()=>{await flushForDownload();saveFile("learning-draft-"+S.draft.id+".json",P.canonical(S.draft));notice("Downloaded the complete current draft and every saved revision.");}).catch(()=>{}));
$("return").addEventListener("click",()=>run(async()=>{if(!$("form").reportValidity())return;await flushForDownload();const r=P.createReturn(S.draft,{id:uuid(),submittedAt:now(),submittedBy:S.decision.reviewer});S.returns=unique([...S.returns,r],"sha256");S.unpersisted=true;try{await persist();}catch{}renderHistory();saveFile("learning-return-"+r.id+".json",P.canonical(r));notice("Return file created. Send that complete file to the issuing operator for current-context review and explicit application.");}).catch(()=>{}));
$("bundle").addEventListener("click",()=>run(async()=>{await flushForDownload();saveFile("learning-exchange-"+S.draft.id+".json",P.canonical(asBundle()));notice("Downloaded the complete exchange, including retained operations and native receipts where present.");}).catch(()=>{}));
$("html").addEventListener("click",()=>run(async()=>{await flushForDownload();const rendered=await P.renderLearningReview(asBundle(),sources);saveFile(rendered.filename,rendered.html,"text/html");notice("Downloaded a complete offline page with the current draft, original context, return history and exact source.");}).catch(()=>{}));
$("open").addEventListener("change",()=>{const file=$("open").files[0];if(!file)return;run(async()=>{await flush();if(file.size>64*1024*1024)throw new Error("Keep the complete file within the 64 MiB portable selection limit.");const literal=await file.text(),value=P.parseExchange(literal);await openValue(value);$("open").value="";}).catch(()=>{});});
$("recover").addEventListener("click",()=>run(async()=>{const selected=S.recovery;saveFile("preserved-opened-draft-"+selected.file.draft.id+".json",P.canonical(selected.file.draft));S.recovery=null;$("recovery").hidden=true;adopt(selected.local);mergeRetained(selected.file);S.lastSaved=P.identityText(P.canonical(selected.local)).sha256;await persist();notice("Opened the saved local draft. The other complete draft was downloaded first.");}).catch(()=>{}));
$("keep-file").addEventListener("click",()=>run(async()=>{const selected=S.recovery;saveFile("preserved-local-draft-"+selected.local.draft.id+".json",P.canonical(selected.local.draft));S.recovery=null;$("recovery").hidden=true;adopt(selected.file);mergeRetained(selected.local);S.lastSaved=P.identityText(P.canonical(selected.local)).sha256;await persist();notice("Continued the opened file after preserving the other complete local draft.");}).catch(()=>{}));
$("context-select").addEventListener("change",()=>run(async()=>{await flush();S.page=0;renderSection();}).catch(()=>{}));
$("previous").addEventListener("click",()=>run(async()=>{await flush();S.page--;renderSection();}).catch(()=>{}));
$("next").addEventListener("click",()=>run(async()=>{await flush();S.page++;renderSection();}).catch(()=>{}));
$("history").addEventListener("change",()=>{$("history-text").textContent=P.canonical(S.draft.history[Number($("history").value)-1]);});
$("context-download").addEventListener("click",()=>{const selected=S.sections[Number($("context-select").value)||0];saveFile("learning-context-"+$("context-select").value+".json",selected.raw??P.canonical(selected.value));});
addEventListener("beforeunload",event=>{if(S.dirty||S.unpersisted){event.preventDefault();event.returnValue="";}});
await run(async()=>{await openValue(seed);if(!S.recovery&&S.storageAvailable)notice("Complete issued context opened. Draft changes save locally; download a complete file to carry them to another device.");});
})().catch(error=>{const box=document.getElementById("notice");box.textContent=error.message;box.classList.add("error");for(const e of document.querySelectorAll("input,select,textarea,button"))e.disabled=true;});

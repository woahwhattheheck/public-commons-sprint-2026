/* SPDX-License-Identifier: MIT */
(function(){
"use strict";
const C=globalThis.CmdbWorkspace,$=id=>document.getElementById(id),esc=C.escape;
const source=JSON.parse($("source-bundle").textContent),included=JSON.parse($("included-workspace").textContent);
let db,workspace=null,activeKey=null,tab="overview",busy=false,pending=null,selectedRun="",filter="all",query="",page=0,detail="",draftMapping=null;
const readable=stamp=>new Date(stamp).toLocaleString("en-US",{dateStyle:"medium",timeStyle:"short"});
const uid=()=>crypto.randomUUID();
const note=(message,error=false)=>{$("notice").hidden=!message;$("notice").textContent=message;$("notice").className="notice"+(error?" error":"");};
function openDb(){return new Promise((resolve,reject)=>{const r=indexedDB.open("tjlabs-cmdb-acceptance",1);r.onupgradeneeded=()=>{for(const name of ["books","meta","pending"])r.result.createObjectStore(name);};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function read(store,key){return new Promise((resolve,reject)=>{const r=db.transaction(store,"readonly").objectStore(store).get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function put(store,key,value){return new Promise((resolve,reject)=>{const t=db.transaction(store,"readwrite");t.objectStore(store).put(value,key);t.oncomplete=resolve;t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error||Error("The browser could not save this operation."));});}
async function refreshPicker(){
 const rows=await new Promise((resolve,reject)=>{const r=db.transaction("books","readonly").objectStore("books").getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 $("workspace-select").innerHTML=rows.map(r=>'<option value="'+esc(r.key)+'" '+(r.key===activeKey?"selected":"")+'>'+esc(r.workspace.label+" · "+r.workspace.customer+" · edition "+r.workspace.revision)+'</option>').join("");
}
async function select(key){
 const row=await read("books",key);if(!row)throw Error("That saved workspace could not be opened.");
 workspace=C.validate(row.workspace);activeKey=key;pending=await read("pending",key)||null;
 await put("meta","active",key);selectedRun=workspace.runs.at(-1)?.id||"";page=0;detail="";draftMapping=null;
 $("retry").hidden=!pending;await refreshPicker();render();
}
async function addBook(w){
 C.validate(w);const key=w.id+"-"+C.hash(w).slice(0,16),old=await read("books",key);
 if(old&&C.canonical(old.workspace)!==C.canonical(w))throw Error("An existing received copy has different content.");
 if(!old)await put("books",key,{key,workspace:w});
 await select(key);
}
function command(action,payload){return {requestId:uid(),expectedRevision:workspace.revision,actor:$("actor").value.trim(),at:new Date().toISOString(),action,payload};}
async function commit(cmd){
 if(!activeKey||!workspace)throw Error("Create or open a workspace first.");
 const key=activeKey;pending=cmd;$("retry").hidden=false;await put("pending",key,cmd);
 const result=await new Promise((resolve,reject)=>{
  const tx=db.transaction(["books","pending"],"readwrite"),books=tx.objectStore("books");let value,error;
  const r=books.get(key);
  r.onsuccess=()=>{try{if(!r.result)throw Error("The original saved workspace is missing.");value=C.transition(r.result.workspace,cmd);books.put({key,workspace:value.workspace},key);tx.objectStore("pending").delete(key);}catch(e){error=e;tx.abort();}};
  tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(error||tx.error);tx.onabort=()=>reject(error||tx.error||Error("The complete save did not finish."));
 });
 workspace=result.workspace;pending=null;$("retry").hidden=true;
 await refreshPicker();return result;
}
const value=id=>$(id)?.value??"";
const options=(rows,chosen,empty="Choose a saved item")=>'<option value="">'+esc(empty)+'</option>'+rows.map(x=>'<option value="'+esc(x.id)+'" '+(x.id===chosen?"selected":"")+'>'+esc(x.label+(x.rows==null?"":" · "+x.rows+" rows"))+'</option>').join("");
const latestSide=side=>workspace.snapshots.filter(s=>s.side===side).at(-1)?.id||"";
const selected=()=>workspace.runs.find(r=>r.id===selectedRun)||workspace.runs.at(-1)||null;
const table=(headers,rows)=>'<div class="table-wrap"><table><thead><tr>'+headers.map(x=>"<th>"+x+"</th>").join("")+"</tr></thead><tbody>"+rows.map(r=>"<tr>"+r.map(c=>"<td>"+c+"</td>").join("")+"</tr>").join("")+"</tbody></table></div>";
const badge=t=>'<span class="status">'+esc(String(t).replaceAll("_"," "))+"</span>";
const field=(id,label,v="",type="text")=>'<label>'+esc(label)+'<input id="'+id+'" type="'+type+'" value="'+esc(v)+'"></label>';
const selectField=(id,label,body)=>'<label>'+esc(label)+'<select id="'+id+'">'+body+"</select></label>";
function overview(){
 const run=selected(),rows=run?C.reviewRows(workspace,run.id):[],open=rows.filter(r=>r.status!=="accepted_change"),a=run?C.acceptance(workspace,run.id):null;
 const stale=run&&(run.sourceId!==latestSide("source")||run.targetId!==latestSide("target"));
 return '<div class="metrics">'+[[workspace.snapshots.length,"Retained exports"],[workspace.runs.length,"Saved comparisons"],[open.length,"Exceptions in review"],[workspace.acceptances.length,"Receiving decisions"]].map(([n,l])=>'<div class="metric"><strong>'+n+"</strong>"+esc(l)+"</div>").join("")+
 '</div><div class="grid"><section class="panel"><h2>'+esc(workspace.label)+'</h2><p>'+esc(workspace.customer)+" · "+esc(workspace.tableClass)+'</p><p>Operating owner: '+esc(workspace.owner)+'</p><p>'+badge(a?.current?a.status:"Review in progress")+'</p>'+
 (stale?'<p><strong>Newer exports are available.</strong> Compare the selected new editions before making a new receiving decision.</p>':"")+
 '<div class="actions"><button data-tab="intake">Receive original exports</button><button data-tab="comparison">Continue review</button></div></section>'+
 '<section class="panel"><h2>One complete operating record</h2><ol><li>Receive source and target files; preserve every corrected edition.</li><li>Map the stable record key and agreed comparison fields.</li><li>Assign each difference and record its correction or accepted change.</li><li>Record the receiving reviewer and download the complete private handover.</li></ol><p class="muted">The original comparator uses exact strings. Column mapping is explicit; no inferred record joins or silent normalization are applied.</p></section></div>'+
 '<section class="panel"><h2>Current comparison</h2>'+(run?'<p>'+esc(run.label)+" · "+readable(run.createdAt)+" · "+esc(run.createdBy)+'</p>'+table(["Source records","Target records","Findings","Critical"],[[run.audit.summary.source_records,run.audit.summary.target_records,run.audit.summary.findings,run.audit.summary.critical]]) :'<p>Receive two exports and map their fields to begin.</p>')+"</section>";
}
function intake(){
 return '<div class="grid"><section class="panel"><h2>Receive an export edition</h2><div class="fields">'+selectField("import-side","Export side",'<option value="source">Source / baseline</option><option value="target">Target / changed system</option>')+field("import-label","Export label")+
 '<label class="wide">Original CSV file<input id="csv-file" type="file" accept=".csv,text/csv"></label>'+selectField("import-parent","Corrects an earlier export (optional)",options(workspace.snapshots,"","New original export"))+
 '<label class="wide">Receipt or correction note<textarea id="import-note"></textarea></label></div><p class="muted">Keep the complete issued CSV. Each file may contain up to 100,000 records and 16 MiB. Parsing failures are retained for correction; the comparison will identify missing columns and invalid keys.</p><div class="actions"><button data-action="import" class="primary">Receive complete file</button></div></section>'+
 '<section class="panel"><h2>Original data stays intact</h2><p>Every received edition retains its full UTF-8 file, filename, checksum, receipt person and source relationship. A corrected export is a new edition. Earlier comparisons and review decisions keep their original inputs.</p><p>Choose the appropriate side and prior export when receiving a correction. Save the private workspace before handing it to another operator.</p></section></div>'+
 '<section class="panel"><h2>Received exports</h2>'+table(["Export","Side / receipt","Rows / parsing","Original file",""],workspace.snapshots.map(s=>[esc(s.label)+(s.parentId?"<small> · corrected edition</small>":""),esc(s.side)+"<br><small>"+readable(s.receivedAt)+" · "+esc(s.receivedBy)+"</small>",s.parseError?esc(s.parseError):String(s.rows),esc(s.filename)+"<details><summary>Original identity</summary><div class=hash>"+s.sha256+"</div>"+s.bytes.toLocaleString()+" bytes</details>",'<button data-action="export-original" data-id="'+esc(s.id)+'">Save original CSV</button>']))+"</section>";
}
function mapping(){
 const sourceRow=workspace.snapshots.find(s=>s.id===value("mapping-source"))||workspace.snapshots.find(s=>s.id===latestSide("source"));
 const targetRow=workspace.snapshots.find(s=>s.id===value("mapping-target"))||workspace.snapshots.find(s=>s.id===latestSide("target"));
 const initial=draftMapping||workspace.mappings.at(-1)||{key:{name:"sys_id",source:"sys_id",target:"sys_id"},fields:CmdbOriginal.DEFAULT_FIELDS.map(name=>({name,source:name,target:name}))};
 const column=(columns,chosen)=>'<option value="">Choose a column</option>'+columns.map(c=>'<option '+(c===chosen?"selected":"")+' value="'+esc(c)+'">'+esc(c)+'</option>').join("");
 return '<section class="panel"><h2>Explicit field mapping</h2><p>Match the two exported schemas without changing original file values. The stable key must identify the same record on both sides.</p><div class="fields">'+selectField("mapping-source","Source export",options(workspace.snapshots.filter(x=>x.side==="source"),sourceRow?.id))+selectField("mapping-target","Target export",options(workspace.snapshots.filter(x=>x.side==="target"),targetRow?.id))+field("mapping-label","Mapping name",initial.label||"Hardware asset mapping")+'</div><h3>Stable record key</h3><div class="fields">'+field("key-name","Canonical key",initial.key.name)+selectField("key-source","Source key",column(sourceRow?.headers||[],initial.key.source))+selectField("key-target","Target key",column(targetRow?.headers||[],initial.key.target))+'</div><h3>Compared fields</h3><div id="mapping-rows">'+initial.fields.map((r,i)=>'<div class="fields mapping-row" data-index="'+i+'">'+field("field-name-"+i,"Canonical field",r.name)+selectField("field-source-"+i,"Source column",column(sourceRow?.headers||[],r.source))+selectField("field-target-"+i,"Target column",column(targetRow?.headers||[],r.target))+'<button data-action="remove-field" data-index="'+i+'">Remove field</button></div>').join("")+'</div><div class="actions"><button data-action="add-field">Add field</button><button data-action="preview-mapping">Review input problems</button><button class="primary" data-action="save-mapping">Save complete mapping</button></div><div id="mapping-preview"></div></section>'+
 '<section class="panel"><h2>Saved mapping editions</h2>'+table(["Mapping","Key","Fields","Saved"],workspace.mappings.map(m=>[esc(m.label),esc(m.key.name),m.fields.length,readable(m.createdAt)+" · "+esc(m.createdBy)]))+"</section>";
}
function readMapping(){return {label:value("mapping-label"),key:{name:value("key-name"),source:value("key-source"),target:value("key-target")},fields:[...document.querySelectorAll(".mapping-row")].map((r,i)=>({name:value("field-name-"+i),source:value("field-source-"+i),target:value("field-target-"+i)}))};}
function runSelector(){const r=selected();return selectField("run-select","Saved comparison",options(workspace.runs,r?.id));}
function filtered(){const r=selected();return r?C.reviewRows(workspace,r.id).filter(row=>(filter==="all"||row.status===filter)&&(query===""||[row.record_key,row.field,row.reason,row.review?.owner||""].join(" ").toLowerCase().includes(query.toLowerCase()))):[];}
function comparison(){
 const run=selected(),items=filtered(),shown=items.slice(page*50,page*50+50);
 const lineage=run?C.lineage(workspace,run.id):null;
 return '<section class="panel"><h2>Compare selected export editions</h2><div class="fields">'+selectField("compare-source","Source",options(workspace.snapshots.filter(s=>s.side==="source"),latestSide("source")))+selectField("compare-target","Target",options(workspace.snapshots.filter(s=>s.side==="target"),latestSide("target")))+selectField("compare-mapping","Field mapping",options(workspace.mappings,workspace.mappings.at(-1)?.id))+field("compare-label","Comparison name","Comparison "+(workspace.runs.length+1))+selectField("compare-previous","Continues earlier comparison",options(workspace.runs,run?.id,"First comparison"))+'</div><label class="check"><input type="checkbox" id="carry-accepted">Carry accepted decisions only with the same baseline, field mapping and identical findings</label><div class="actions"><button data-action="compare" class="primary">Create comparison</button></div></section>'+
 (run?'<section class="panel">'+runSelector()+'<p>'+run.audit.summary.findings+' findings · '+run.audit.summary.critical+' critical'+(lineage?.previousRunId?" · "+lineage.unchanged+" identical to prior · "+lineage.absent.length+" prior findings absent from this comparison":"")+'</p><div class="fields">'+selectField("filter-status","Disposition",'<option value="all">All findings</option>'+["open","assigned","correction_required","accepted_change"].map(s=>'<option value="'+s+'" '+(s===filter?"selected":"")+'>'+esc(s.replaceAll("_"," "))+'</option>').join(""))+field("filter-query","Record, field or owner",query)+'</div></section>'+
 '<div class="review-grid"><section class="panel"><h2>Exceptions</h2>'+table(['<input type="checkbox" id="select-page" aria-label="Select visible findings">',"Record / field","Finding","Disposition / owner",""],shown.map(r=>['<input type="checkbox" class="finding-choice" value="'+r.id+'" aria-label="Select '+esc(r.record_key+" "+r.field)+'">',esc(r.record_key)+"<br><small>"+esc(r.field)+"</small>",badge(r.reason)+"<br>"+esc(r.severity),badge(r.status)+"<br>"+esc(r.review?.owner||"Unassigned"),'<button data-action="inspect-finding" data-id="'+r.id+'">Inspect</button>']))+
 '<div class="page-controls"><button data-action="prev-page" '+(page===0?"disabled":"")+'>Previous</button><span>'+items.length+' matching · page '+(page+1)+'</span><button data-action="next-page" '+((page+1)*50>=items.length?"disabled":"")+'>Next</button></div><div id="finding-detail">'+findingDetail()+'</div></section>'+
 '<section class="panel"><h2>Review selected exceptions</h2><p>Only the checked findings are changed. Each saved decision keeps the named reviewer and original comparison.</p><div class="fields">'+selectField("review-status","Disposition",'<option value="assigned">Assign owner</option><option value="correction_required">Correction required</option><option value="accepted_change">Accepted change</option><option value="open">Reopen review</option>')+field("review-owner","Responsible owner")+field("review-due","Due date","","date")+'<label>Decision and next work<textarea id="review-note"></textarea></label>'+field("review-evidence","Written reference / change approval")+'</div><div class="actions"><button data-action="review" class="primary">Save selected review</button></div><p class="muted">Receive a corrected target as a new export and compare it again. Earlier findings and decisions remain in History.</p></section></div>':'<section class="empty"><h2>Receive and map exports to compare</h2><p>The source and target files plus a saved field mapping create a complete comparison.</p></section>');
}
function findingDetail(){
 const run=selected();if(!run||!detail)return "";const f=C.reviewRows(workspace,run.id).find(x=>x.id===detail);if(!f)return "";
 const mapping=workspace.mappings.find(m=>m.id===run.mappingId),fields=[mapping.key,...mapping.fields];
 const values=side=>{const snapshot=workspace.snapshots.find(s=>s.id===run[side+"Id"]),rows=CmdbOriginal.parseCsv(snapshot.text).records;return rows.find(row=>row[mapping.key[side]]===f.record_key);};
 const a=values("source"),b=values("target"),chosen=f.field==="*"?fields:fields.filter(x=>x.name===f.field);
 return '<h3>'+esc(f.record_key)+" · "+esc(f.reason.replaceAll("_"," "))+'</h3>'+table(["Field","Original source value","Original target value"],chosen.map(c=>[esc(c.name),'<div class=value>'+esc(a?a[c.source]:"Record absent")+"</div>",'<div class=value>'+esc(b?b[c.target]:"Record absent")+"</div>"]))+
 '<p>'+esc(f.review?.note||"No review note yet.")+'</p>';
}
function receiving(){
 const run=selected();if(!run)return '<section class="empty"><h2>Complete a comparison first</h2><p>A receiving decision is tied to its exact source, target, mapping and exception review.</p></section>';
 const a=C.acceptance(workspace,run.id),rows=C.reviewRows(workspace,run.id),remaining=rows.filter(x=>x.status!=="accepted_change").length;
 return '<div class="grid"><section class="panel"><h2>Receiving decision</h2>'+runSelector()+'<p>'+remaining+' exceptions still require an accepted-change disposition.</p><div class="fields">'+selectField("accept-status","Decision",'<option value="REVIEW_REQUIRED">Review required</option><option value="ACCEPTED">Accepted</option><option value="REJECTED">Rejected</option>')+field("accept-person","Receiving reviewer")+field("accept-authority","Authority or written approval reference")+'<label class="wide">Acceptance terms or remaining work<textarea id="accept-note"></textarea></label></div><div class="actions"><button data-action="accept" class="primary">Record receiving decision</button></div>'+
 (a?'<h3>Latest saved decision</h3><p>'+badge(a.status)+(a.current?"":" · superseded by later exception review")+'</p><p>'+esc(a.signoffBy)+" · "+readable(a.at)+'</p><p>'+esc(a.note)+"</p>":"")+'</section>'+
 '<section class="panel"><h2>Complete handover</h2><p>The editable package contains the full original CSV editions, mappings, comparison results, ownership decisions, acceptance history and application source.</p><div class="actions"><button data-action="report">Save acceptance report</button><button data-action="exceptions">Save exceptions CSV</button><button data-action="audit">Save original audit JSON</button><button data-action="workspace">Save private workspace</button><button data-action="package">Download complete handover</button></div><h3>Receiving on another machine</h3><ol><li>Extract the handover into a private folder.</li><li>Open Open_CMDB_Workspace.html in a browser.</li><li>Open the supplied workspace.json to receive the same operating history.</li><li>Select the saved comparison, inspect its original inputs and continue the named review.</li></ol></section></div>';
}
function history(){
 return '<section class="panel"><h2>Complete operation history</h2><p>Every original export, comparison, review and receiving decision remains attached to this workspace.</p>'+table(["Edition","Operation","Person","Time","Result"],workspace.events.map(e=>[e.revision,esc(e.action),esc(e.actor),readable(e.at),esc(e.result.status||e.result.reviewed&&e.result.reviewed+" reviewed"||e.result.rows!=null&&e.result.rows+" rows"||"Saved")]))+'</section><section class="panel"><h2>Comparison editions</h2>'+table(["Comparison","Source / target","Findings","Saved",""],workspace.runs.map(r=>[esc(r.label),esc(workspace.snapshots.find(s=>s.id===r.sourceId).label)+" / "+esc(workspace.snapshots.find(s=>s.id===r.targetId).label),r.audit.summary.findings,readable(r.createdAt),'<button data-action="open-comparison" data-id="'+r.id+'">Open comparison</button>']))+"</section>";
}
function guide(){
 const inline=s=>esc(s).replace(/\*\*([^*]+)\*\*/g,"<strong>$1</strong>").replace(/\x60([^\x60]+)\x60/g,"<code>$1</code>");
 const blocks=source.files["OPERATOR.md"].trim().split(/\n\s*\n/).map(block=>{
  const head=block.match(/^(#{1,3}) (.*)$/);
  if(head)return "<h"+Math.min(3,head[1].length+1)+">"+inline(head[2])+"</h"+Math.min(3,head[1].length+1)+">";
  const lines=block.split("\n");if(lines.every(s=>s.startsWith("- ")))return "<ul>"+lines.map(s=>"<li>"+inline(s.slice(2))+"</li>").join("")+"</ul>";
  return "<p>"+inline(block).replaceAll("\n"," ")+"</p>";
 }).join("");
 return '<section class="panel guide"><button data-action="save-guide">Save operating guide</button>'+blocks+"</section>";
}
function render(){
 document.querySelectorAll("nav [data-tab]").forEach(b=>b.setAttribute("aria-current",b.dataset.tab===tab?"page":"false"));
 $("save-file").disabled=$("package").disabled=!workspace;
 $("save-state").textContent=workspace?"Saved edition "+workspace.revision+" · "+readable(workspace.updatedAt):"No workspace open";
 $("content").innerHTML=tab==="guide"?guide():workspace?({overview,intake,mapping,comparison,receiving,history,guide}[tab]||overview)():'<section class="empty"><h2>Open a complete operating workspace</h2><p>Create a workspace for authorized customer exports, receive an existing handover, or open the included worked example.</p><div class="actions"><button data-action="new">New workspace</button><button data-action="example">Open worked example</button></div></section>';
}
function download(name,body,type="application/json"){
 const blob=new Blob([body],{type}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
}
const json=x=>JSON.stringify(x,null,2)+"\n";
function saveWorkspace(){download("workspace.json",json(C.pack(workspace)));}
function handover(){
 const packet=C.pack(workspace),run=selected(),all={"Open_CMDB_Workspace.html":CmdbCompose.build(source.files,packet),"workspace.json":json(packet),"OPERATOR.md":source.files["OPERATOR.md"]};
 for(const [name,content]of Object.entries(source.files)){const path=name.startsWith("../")?"cmdb-qa/"+name.slice(3):"cmdb-qa/acceptance-workspace/"+name;all[path]=content;}
 workspace.snapshots.forEach((s,i)=>all["original-exports/"+String(i+1).padStart(3,"0")+"-"+s.filename.replace(/[^A-Za-z0-9_.-]/g,"_")]=s.text);
 if(run){all["acceptance-report.html"]=C.report(workspace,run.id);all["exceptions.csv"]=C.exceptionsCsv(workspace,run.id);all["audit.json"]=json(run.audit);}
 all["HANDOVER.json"]=json({schema:"cmdb-acceptance-handover/1",workspaceId:workspace.id,revision:workspace.revision,workspaceSha256:packet.sha256,files:Object.entries(all).map(([path,text])=>({path,...CmdbHash.sha256Utf8(text)}))});
 download("CMDB_Acceptance_Handover.zip",buildCompanionZip(all),"application/zip");
}
async function act(action,button){
 if(action==="new"){$("new-form").elements.owner.value=$("actor").value;$("new-dialog").showModal();return;}
 if(action==="cancel-new"){$("new-dialog").close();return;}
 if(action==="guide"){tab="guide";render();return;}
 if(action==="save-guide"){download("OPERATOR.md",source.files["OPERATOR.md"],"text/markdown");return;}
 if(action==="example"){const result=CmdbExample.operate();await addBook(result.workspace);note("Opened the complete authored hardware-asset example, including its original exports and two comparison editions.");return;}
 if(!workspace)throw Error("Open a workspace first.");
 if(action==="workspace"){saveWorkspace();return;}
 if(action==="package"){handover();return;}
 if(action==="export-original"){const s=workspace.snapshots.find(x=>x.id===button.dataset.id);download(s.filename,s.text,"text/csv");return;}
 if(action==="import"){
  const f=$("csv-file").files[0];if(!f)throw Error("Select the complete original CSV.");
  if(f.size>CmdbOriginal.MAX_BYTES)throw Error("Each CSV may be at most 16 MiB.");
  const raw=new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(await f.arrayBuffer());
  const r=await commit(command("import",{side:value("import-side"),label:value("import-label")||f.name,filename:f.name,text:raw,parentId:value("import-parent")||null,note:value("import-note")}));
  note(r.result.parseError?"Received and retained the original file. Correct its parsing problem: "+r.result.parseError:"Received "+r.result.rows+" original rows.");render();return;
 }
 if(action==="add-field"||action==="remove-field"){draftMapping=readMapping();if(action==="add-field")draftMapping.fields.push({name:"",source:"",target:""});else draftMapping.fields.splice(Number(button.dataset.index),1);render();return;}
 if(action==="preview-mapping"){
  const result=C.preview(workspace,value("mapping-source"),value("mapping-target"),readMapping());
  $("mapping-preview").innerHTML="<h3>Input review</h3>"+["source","target"].map(side=>"<h4>"+esc(side)+"</h4>"+(result[side].problems.length?table(["Row","Problem","Column","Key"],result[side].problems.slice(0,200).map(p=>[p.row??"—",esc(p.kind),esc(p.column),esc(p.key)])):"<p>All "+result[side].rows+" row keys and selected columns are valid.</p>")+(result[side].problems.length>200?"<p>Showing 200 of "+result[side].problems.length+" original input problems.</p>":"")).join("");return;
 }
 if(action==="save-mapping"){await commit(command("mapping",readMapping()));draftMapping=null;tab="comparison";render();note("Saved the complete field mapping.");return;}
 if(action==="compare"){const r=await commit(command("compare",{sourceId:value("compare-source"),targetId:value("compare-target"),mappingId:value("compare-mapping"),label:value("compare-label"),previousRunId:value("compare-previous")||null,carryAccepted:$("carry-accepted").checked}));selectedRun=r.result.id;page=0;detail="";render();note("Comparison saved: "+r.result.findings+" findings.");return;}
 if(action==="prev-page"||action==="next-page"){page+=action==="next-page"?1:-1;render();return;}
 if(action==="inspect-finding"){detail=button.dataset.id;$("finding-detail").innerHTML=findingDetail();return;}
 if(action==="review"){const ids=[...document.querySelectorAll(".finding-choice:checked")].map(el=>el.value);await commit(command("review",{runId:selected().id,findingIds:ids,status:value("review-status"),owner:value("review-owner"),due:value("review-due"),note:value("review-note"),evidence:value("review-evidence")}));render();note("Saved the selected exception decisions.");return;}
 if(action==="accept"){await commit(command("accept",{runId:selected().id,status:value("accept-status"),signoffBy:value("accept-person"),authority:value("accept-authority"),note:value("accept-note")}));render();note("Saved the receiving decision.");return;}
 if(action==="open-comparison"){selectedRun=button.dataset.id;tab="comparison";page=0;render();return;}
 if(action==="report"){download("acceptance-report.html",C.report(workspace,selected().id),"text/html");return;}
 if(action==="exceptions"){download("exceptions.csv",C.exceptionsCsv(workspace,selected().id),"text/csv");return;}
 if(action==="audit"){download("audit.json",json(selected().audit));return;}
}
async function run(fn){if(busy)return;busy=true;document.body.dataset.busy="true";try{note("");await fn();}catch(e){note(e.message,true);}finally{busy=false;delete document.body.dataset.busy;}}
document.addEventListener("click",event=>{
 const b=event.target.closest("[data-action],[data-tab]");if(!b)return;event.preventDefault();
 if(b.dataset.tab){if(busy)return;tab=b.dataset.tab;render();return;}
 run(()=>act(b.dataset.action,b));
});
document.addEventListener("change",event=>{
 const t=event.target;
 if(t.id==="run-select"){selectedRun=t.value;page=0;detail="";render();}
 if(t.id==="filter-status"){filter=t.value;page=0;render();}
 if(t.id==="mapping-source"||t.id==="mapping-target"){draftMapping=readMapping();render();}
 if(t.id==="select-page")document.querySelectorAll(".finding-choice").forEach(x=>x.checked=t.checked);
});
document.addEventListener("input",event=>{if(event.target.id==="filter-query"){query=event.target.value;page=0;const start=event.target.selectionStart;render();$("filter-query").focus();$("filter-query").setSelectionRange(start,start);}});
$("save-file").onclick=()=>run(saveWorkspace);$("package").onclick=()=>run(handover);
$("retry").onclick=()=>run(async()=>{if(!pending)throw Error("No saved operation needs continuation.");await commit(pending);render();note("Continued the original saved operation.");});
$("workspace-select").onchange=()=>run(()=>select($("workspace-select").value));
$("actor").onchange=()=>run(()=>put("meta","actor",$("actor").value));
$("open-file").onchange=()=>run(async()=>{const f=$("open-file").files[0];if(!f)return;if(f.size>128*1024*1024)throw Error("The complete workspace exceeds 128 MiB.");const w=C.receive(await f.text());await addBook(w);$("open-file").value="";note("Received the complete original workspace in a separate saved copy.");});
$("new-form").onsubmit=event=>{event.preventDefault();run(async()=>{const p=Object.fromEntries(new FormData(event.target));const w=C.create({...p,id:uid(),at:new Date().toISOString()});await addBook(w);$("new-dialog").close();note("Created the acceptance workspace.");});};
(async()=>{try{db=await openDb();$("actor").value=await read("meta","actor")||"";const active=await read("meta","active");if(active&&await read("books",active))await select(active);else if(included)await addBook(C.receive(included));else{await refreshPicker();render();}}catch(e){note("Browser working storage could not open: "+e.message+". Keep the original workspace file and open this application in a browser with local storage enabled.",true);}})();
})();

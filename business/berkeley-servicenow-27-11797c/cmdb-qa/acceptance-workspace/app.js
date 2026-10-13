/* SPDX-License-Identifier: MIT */
(function(){
"use strict";
const C=globalThis.CmdbWorkspace,$=id=>document.getElementById(id),esc=C.escape;
const source=JSON.parse($("source-bundle").textContent),included=JSON.parse($("included-workspace").textContent);
let db,workspace=null,activeKey=null,tab="overview",busy=false,pending=null,selectedRun="",filter="all",query="",page=0,detail="",draftMapping=null;

const Drafts=globalThis.CmdbDrafts,drafts=new Map(),draftBases=new Map(),draftFiles=new Map();
let editorContext=null,recoverySequence=0;
const draftGroups={intake:/^import-/,mapping:/^(mapping-|key-|field-)/,compare:/^(compare-|carry-accepted$)/,review:/^review-/,accept:/^accept-/};
const groupTitle={intake:"Original CSV intake",mapping:"Field mapping",compare:"New comparison",review:"Exception review",accept:"Receiving decision"};
function baseKey(){return workspace?C.pack(workspace).sha256:"";}
function visibleGroups(){return tab==="intake"?["intake"]:tab==="mapping"?["mapping"]:tab==="comparison"?(selected()?["compare","review"]:["compare"]):tab==="receiving"&&selected()?["accept"]:[];}
function groupRun(group){return ["review","accept"].includes(group)?selected()?.id||"":"";}
function matchingDraft(group,sha=baseKey(),runId=groupRun(group)){return [...drafts.values()].find(e=>e.bookKey===activeKey&&e.baseSha256===sha&&e.group===group&&e.runId===runId);}
function fieldsFor(group){return [...$("content").querySelectorAll("input[id],select[id],textarea[id]")].filter(el=>draftGroups[group].test(el.id));}
function draftValues(group){return Object.fromEntries(fieldsFor(group).map(el=>[el.id,el.type==="checkbox"?el.checked:el.value]));}
function captureDraft(group){
 const ctx=editorContext;if(!ctx||!ctx.groups.includes(group)||!workspace)return null;
 const runId=["review","accept"].includes(group)?ctx.runId:"";
 let entry=[...drafts.values()].find(e=>e.bookKey===ctx.bookKey&&e.baseSha256===ctx.base.sha256&&e.group===group&&e.runId===runId);
 if(!entry)entry={id:uid(),bookKey:ctx.bookKey,group,runId,baseSha256:ctx.base.sha256,createdAt:new Date().toISOString(),updatedAt:"",values:{},mapping:null,findings:[],file:null};
 entry.updatedAt=new Date().toISOString();entry.values=draftValues(group);
 if(group==="mapping")entry.mapping=readMapping();
 if(group==="review"){
  const chosen=new Set(entry.findings);
  for(const el of document.querySelectorAll(".finding-choice"))el.checked?chosen.add(el.value):chosen.delete(el.value);
  entry.findings=[...chosen];
 }
 if(group==="intake"&&$("csv-file")?.files[0]){
  const file=$("csv-file").files[0],old=draftFiles.get(entry.id);
  if(old!==file){draftFiles.set(entry.id,file);entry.file=null;}
 }
 draftBases.set(ctx.base.sha256,ctx.base);drafts.set(entry.id,entry);showDrafts();return entry;
}
function rememberDrafts(){
 if(!editorContext)return;
 for(const group of editorContext.groups){
  const exists=[...drafts.values()].some(e=>e.bookKey===editorContext.bookKey&&e.baseSha256===editorContext.base.sha256&&e.group===group&&e.runId===(["review","accept"].includes(group)?editorContext.runId:""));
  if(exists)captureDraft(group);
 }
}
function clearDraft(group,ctx=editorContext){
 if(!ctx)return;
 for(const [id,e]of drafts)if(e.bookKey===ctx.bookKey&&e.baseSha256===ctx.base.sha256&&e.group===group&&e.runId===(["review","accept"].includes(group)?ctx.runId:"")){drafts.delete(id);draftFiles.delete(id);}
}
function hydrateDrafts(){
 if(!workspace){editorContext=null;showDrafts();return;}
 const base=C.pack(workspace);
 editorContext={bookKey:activeKey,base,runId:selected()?.id||"",groups:visibleGroups()};
 for(const group of editorContext.groups){
  const entry=matchingDraft(group,base.sha256);
  if(!entry)continue;
  for(const [id,v]of Object.entries(entry.values)){const el=$(id);if(!el)continue;if(el.type==="checkbox")el.checked=v===true;else el.value=String(v);}
  if(group==="review")for(const el of document.querySelectorAll(".finding-choice"))el.checked=entry.findings.includes(el.value);
  if(group==="intake")$("draft-file-name").textContent=(draftFiles.get(entry.id)?.name||entry.file?.name)?"Retained original: "+(draftFiles.get(entry.id)?.name||entry.file.name):"";
 }
 showDrafts();
}
function showDrafts(){
 const box=$("unfinished-work");if(!box)return;
 const entries=[...drafts.values()].filter(e=>e.bookKey===activeKey),others=drafts.size-entries.length;
 box.hidden=!entries.length&&!others;
 if(box.hidden){box.innerHTML="";return;}
 const sha=workspace?C.pack(workspace).sha256:"";
 box.innerHTML='<h2>Unfinished work</h2><p>Entered forms stay in this session when you change views. Download their complete recovery file before closing or reloading. Saved workspace files contain recorded operations.</p>'+
 (entries.length?'<div class="actions"><button data-action="save-recovery">Download all unfinished work</button></div><ul>'+entries.map(e=>'<li><strong>'+esc(groupTitle[e.group])+'</strong> · '+(e.baseSha256===sha?"current saved edition":"earlier saved edition")+(e.group==="review"?" · "+e.findings.length+" selected findings":"")+' <button data-action="open-draft" data-id="'+esc(e.id)+'">'+(e.baseSha256===sha?"Continue":"Open original edition")+'</button> <button data-action="save-one-draft" data-id="'+esc(e.id)+'">Save this group</button> <button data-action="discard-draft" data-id="'+esc(e.id)+'">Discard group</button></li>').join("")+"</ul>":"")+
 (others?"<p>"+others+" unfinished group(s) remain with other workspace copies in the selector.</p>":"");
}
async function recoveryPacket(onlyId=null){
 rememberDrafts();
 const entries=[...drafts.values()].filter(e=>e.bookKey===activeKey&&(!onlyId||e.id===onlyId));
 if(!entries.length)return null;
 const bases={};
 for(const e of entries){
  const f=draftFiles.get(e.id);
  if(f&&!e.file){
   if(f.size>CmdbOriginal.MAX_BYTES)throw Error("Each unfinished CSV may be at most 16 MiB.");
   const raw=new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(await f.arrayBuffer());
   e.file={name:f.name,type:f.type||"text/csv",text:raw,...CmdbHash.sha256Utf8(raw)};
  }
  bases[e.baseSha256]=draftBases.get(e.baseSha256);
 }
 return Drafts.pack(workspace,entries.map(({bookKey,...entry})=>entry),bases);
}
async function openDraft(id){
 rememberDrafts();const entry=drafts.get(id);if(!entry)throw Error("That unfinished group is no longer present.");
 if(entry.bookKey!==activeKey)throw Error("Select its saved workspace first.");
 if(entry.baseSha256!==baseKey()){
  const oldKey=activeKey,base=draftBases.get(entry.baseSha256);
  await addBook(C.receive(base),true);entry.bookKey=activeKey;
  note("Opened the original saved edition in a separate workspace copy. The later workspace and all its recorded operations remain in the selector.");
 }
 tab=Drafts.GROUPS[entry.group];selectedRun=entry.runId||workspace.runs.at(-1)?.id||"";page=0;filter="all";query="";draftMapping=entry.mapping;
 editorContext=null;render();
}
async function receiveRecovery(file){
 if(file.size>Drafts.MAX_BYTES)throw Error("The complete recovery exceeds 256 MiB.");
 const received=Drafts.receive(await file.text());
 rememberDrafts();await addBook(received.workspace,true);
 for(const [sha,base]of Object.entries(received.bases))draftBases.set(sha,base);
 for(const original of received.entries){const entry={...original,id:uid(),bookKey:activeKey};drafts.set(entry.id,entry);}
 editorContext=null;render();note("Opened the complete saved workspace and every unfinished group. Continue a current group, or open its preserved earlier edition, before saving a recorded operation.");
}

const readable=stamp=>new Date(stamp).toLocaleString("en-US",{dateStyle:"medium",timeStyle:"short"});
const uid=()=>crypto.randomUUID();
const note=(message,error=false)=>{$("notice").hidden=!message;$("notice").textContent=message;$("notice").className="notice"+(error?" error":"");};
const openDb=()=>CmdbStore.open();
const read=(name,key)=>db.get(name,key);
const put=(name,key,value)=>db.put(name,key,value);
async function refreshPicker(){
 const rows=await db.list("books");
 $("workspace-select").innerHTML=rows.map(r=>'<option value="'+esc(r.key)+'" '+(r.key===activeKey?"selected":"")+'>'+esc(r.workspace.label+" · "+r.workspace.customer+" · edition "+r.workspace.revision)+'</option>').join("");
}
async function select(key){
 rememberDrafts();editorContext=null;
 const row=await read("books",key);if(!row)throw Error("That saved workspace could not be opened.");
 workspace=C.validate(row.workspace);activeKey=key;pending=await read("pending",key)||null;
 await put("meta","active",key);selectedRun=workspace.runs.at(-1)?.id||"";page=0;detail="";draftMapping=null;
 $("retry").hidden=!pending;await refreshPicker();render();
}
async function addBook(w,separate=false){
 C.validate(w);const key=w.id+"-"+C.hash(w).slice(0,16)+(separate?"-"+uid():""),old=await read("books",key);
 if(old&&C.canonical(old.workspace)!==C.canonical(w))throw Error("An existing received copy has different content.");
 if(!old)await put("books",key,{key,workspace:w});
 await select(key);
}
function command(action,payload){return {requestId:uid(),expectedRevision:workspace.revision,actor:$("actor").value.trim(),at:new Date().toISOString(),action,payload};}
async function commit(cmd){
 if(!activeKey||!workspace)throw Error("Create or open a workspace first.");
 const key=activeKey;pending=cmd;$("retry").hidden=false;await put("pending",key,cmd);
 const result=await db.commit(key,cmd);
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
 '<label class="wide">Original CSV file<input id="csv-file" type="file" accept=".csv,text/csv"><small id="draft-file-name"></small></label>'+selectField("import-parent","Corrects an earlier export (optional)",options(workspace.snapshots,"","New original export"))+
 '<label class="wide">Receipt or correction note<textarea id="import-note"></textarea></label></div><p class="muted">Keep the complete issued CSV. Each file may contain up to 100,000 records and 16 MiB. Parsing failures are retained for correction; the comparison will identify missing columns and invalid keys.</p><div class="actions"><button data-action="import" class="primary">Receive complete file</button></div></section>'+
 '<section class="panel"><h2>Original data stays intact</h2><p>Every received edition retains its full UTF-8 file, filename, checksum, receipt person and source relationship. A corrected export is a new edition. Earlier comparisons and review decisions keep their original inputs.</p><p>Choose the appropriate side and prior export when receiving a correction. Save the private workspace before handing it to another operator.</p></section></div>'+
 '<section class="panel"><h2>Received exports</h2>'+table(["Export","Side / receipt","Rows / parsing","Original file",""],workspace.snapshots.map(s=>[esc(s.label)+(s.parentId?"<small> · corrected edition</small>":""),esc(s.side)+"<br><small>"+readable(s.receivedAt)+" · "+esc(s.receivedBy)+"</small>",s.parseError?esc(s.parseError):String(s.rows),esc(s.filename)+"<details><summary>Original identity</summary><div class=hash>"+s.sha256+"</div>"+s.bytes.toLocaleString()+" bytes</details>",'<button data-action="export-original" data-id="'+esc(s.id)+'">Save original CSV</button>']))+"</section>";
}
function mapping(){
 const retained=matchingDraft("mapping");if(retained)draftMapping=retained.mapping;
 const sourceRow=workspace.snapshots.find(s=>s.id===(retained?.values["mapping-source"]||value("mapping-source")))||workspace.snapshots.find(s=>s.id===latestSide("source"));
 const targetRow=workspace.snapshots.find(s=>s.id===(retained?.values["mapping-target"]||value("mapping-target")))||workspace.snapshots.find(s=>s.id===latestSide("target"));
 const initial=retained?.mapping||workspace.mappings.at(-1)||{key:{name:"sys_id",source:"sys_id",target:"sys_id"},fields:CmdbOriginal.DEFAULT_FIELDS.map(name=>({name,source:name,target:name}))};
 const column=(columns,chosen)=>'<option value="">Choose a column</option>'+(chosen&&!columns.includes(chosen)?'<option selected value="'+esc(chosen)+'">'+esc(chosen)+' · not present in selected export</option>':"")+columns.map(c=>'<option '+(c===chosen?"selected":"")+' value="'+esc(c)+'">'+esc(c)+'</option>').join("");
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
 rememberDrafts();
 document.querySelectorAll("nav [data-tab]").forEach(b=>b.setAttribute("aria-current",b.dataset.tab===tab?"page":"false"));
 $("save-file").disabled=$("package").disabled=!workspace;
 $("save-state").textContent=workspace?(db?.mode==="temporary"?"Session edition ":"Saved edition ")+workspace.revision+" · "+readable(workspace.updatedAt):"No workspace open";
 $("content").innerHTML=tab==="guide"?guide():workspace?({overview,intake,mapping,comparison,receiving,history,guide}[tab]||overview)():'<section class="empty"><h2>Open a complete operating workspace</h2><p>Create a workspace for authorized customer exports, receive an existing handover, or open the included worked example.</p><div class="actions"><button data-action="new">New workspace</button><button data-action="example">Open worked example</button></div></section>';
 hydrateDrafts();
}
function download(name,body,type="application/json"){
 const blob=new Blob([body],{type}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
}
const json=x=>JSON.stringify(x,null,2)+"\n";
function saveWorkspace(){download("workspace.json",json(C.pack(workspace)));}
async function handover(){
 const unfinished=await recoveryPacket();
 const packet=C.pack(workspace),run=selected(),all={"Open_CMDB_Workspace.html":CmdbCompose.build(source.files,packet),"workspace.json":json(packet),"OPERATOR.md":source.files["OPERATOR.md"]};
 if(unfinished)all["UNFINISHED-WORK.json"]=json(unfinished);
 for(const [name,content]of Object.entries(source.files)){const path=name.startsWith("../")?"cmdb-qa/"+name.slice(3):"cmdb-qa/acceptance-workspace/"+name;all[path]=content;}
 workspace.snapshots.forEach((s,i)=>all["original-exports/"+String(i+1).padStart(3,"0")+"-"+s.filename.replace(/[^A-Za-z0-9_.-]/g,"_")]=s.text);
 if(run){all["acceptance-report.html"]=C.report(workspace,run.id);all["exceptions.csv"]=C.exceptionsCsv(workspace,run.id);all["audit.json"]=json(run.audit);}
 all["HANDOVER.json"]=json({schema:"cmdb-acceptance-handover/1",workspaceId:workspace.id,revision:workspace.revision,workspaceSha256:packet.sha256,files:Object.entries(all).map(([path,text])=>({path,...CmdbHash.sha256Utf8(text)}))});
 download("CMDB_Acceptance_Handover.zip",buildCompanionZip(all),"application/zip");
}
async function act(action,button){
 if(action==="save-recovery"||action==="save-one-draft"){const packet=await recoveryPacket(action==="save-one-draft"?button.dataset.id:null);if(!packet)throw Error("There is no unfinished work in this workspace.");download("CMDB_Unfinished_Work.json",json(packet));note("Saved the complete workspace, original editions and unfinished fields. Review each group before recording its operation.");return;}
 if(action==="open-draft"){await openDraft(button.dataset.id);return;}
 if(action==="discard-draft"){const e=drafts.get(button.dataset.id);if(e&&confirm("Discard this unfinished "+groupTitle[e.group]+"? Saved operations stay unchanged.")){drafts.delete(e.id);draftFiles.delete(e.id);editorContext=null;draftMapping=null;render();}return;}
 if(action==="new"){$("new-form").elements.owner.value=$("actor").value;$("new-dialog").showModal();return;}
 if(action==="cancel-new"){$("new-dialog").close();return;}
 if(action==="guide"){tab="guide";render();return;}
 if(action==="save-guide"){download("OPERATOR.md",source.files["OPERATOR.md"],"text/markdown");return;}
 if(action==="example"){const result=CmdbExample.operate();await addBook(result.workspace);note("Opened the complete authored hardware-asset example, including its original exports and two comparison editions.");return;}
 if(!workspace)throw Error("Open a workspace first.");
 if(action==="workspace"){saveWorkspace();return;}
 if(action==="package"){await handover();return;}
 if(action==="export-original"){const s=workspace.snapshots.find(x=>x.id===button.dataset.id);download(s.filename,s.text,"text/csv");return;}
 if(action==="import"){
  const ctx=editorContext,entry=captureDraft("intake"),f=$("csv-file").files[0]||draftFiles.get(entry?.id),retained=entry?.file;
  if(!f&&!retained)throw Error("Select the complete original CSV.");
  if(f&&f.size>CmdbOriginal.MAX_BYTES)throw Error("Each CSV may be at most 16 MiB.");
  const cmd=command("import",{side:value("import-side"),label:value("import-label")||(f?.name||retained.name),filename:f?.name||retained.name,text:"",parentId:value("import-parent")||null,note:value("import-note")});
  cmd.payload.text=f?new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(await f.arrayBuffer()):retained.text;
  if(activeKey!==ctx.bookKey||baseKey()!==ctx.base.sha256)throw Error("The original intake workspace changed. Its unfinished file and fields remain available.");
  const r=await commit(cmd);clearDraft("intake",ctx);editorContext=null;
  note(r.result.parseError?"Received and retained the original file. Correct its parsing problem: "+r.result.parseError:"Received "+r.result.rows+" original rows.");render();return;
 }
 if(action==="add-field"||action==="remove-field"){const entry=captureDraft("mapping");draftMapping=readMapping();if(action==="add-field")draftMapping.fields.push({name:"",source:"",target:""});else draftMapping.fields.splice(Number(button.dataset.index),1);entry.mapping=draftMapping;entry.values=Object.fromEntries(Object.entries(entry.values).filter(([id])=>!id.startsWith("field-")));editorContext=null;render();return;}
 if(action==="preview-mapping"){
  const result=C.preview(workspace,value("mapping-source"),value("mapping-target"),readMapping());
  $("mapping-preview").innerHTML="<h3>Input review</h3>"+["source","target"].map(side=>"<h4>"+esc(side)+"</h4>"+(result[side].problems.length?table(["Row","Problem","Column","Key"],result[side].problems.slice(0,200).map(p=>[p.row??"—",esc(p.kind),esc(p.column),esc(p.key)])):"<p>All "+result[side].rows+" row keys and selected columns are valid.</p>")+(result[side].problems.length>200?"<p>Showing 200 of "+result[side].problems.length+" original input problems.</p>":"")).join("");return;
 }
 if(action==="save-mapping"){rememberDrafts();const ctx=editorContext;await commit(command("mapping",readMapping()));clearDraft("mapping",ctx);editorContext=null;draftMapping=null;tab="comparison";render();note("Saved the complete field mapping.");return;}
 if(action==="compare"){rememberDrafts();const ctx=editorContext;const r=await commit(command("compare",{sourceId:value("compare-source"),targetId:value("compare-target"),mappingId:value("compare-mapping"),label:value("compare-label"),previousRunId:value("compare-previous")||null,carryAccepted:$("carry-accepted").checked}));clearDraft("compare",ctx);editorContext=null;selectedRun=r.result.id;page=0;detail="";render();note("Comparison saved: "+r.result.findings+" findings.");return;}
 if(action==="prev-page"||action==="next-page"){page+=action==="next-page"?1:-1;render();return;}
 if(action==="inspect-finding"){detail=button.dataset.id;$("finding-detail").innerHTML=findingDetail();return;}
 if(action==="review"){rememberDrafts();const ctx=editorContext,entry=captureDraft("review"),ids=entry.findings;await commit(command("review",{runId:selected().id,findingIds:ids,status:value("review-status"),owner:value("review-owner"),due:value("review-due"),note:value("review-note"),evidence:value("review-evidence")}));clearDraft("review",ctx);editorContext=null;render();note("Saved the selected exception decisions.");return;}
 if(action==="accept"){rememberDrafts();const ctx=editorContext;await commit(command("accept",{runId:selected().id,status:value("accept-status"),signoffBy:value("accept-person"),authority:value("accept-authority"),note:value("accept-note")}));clearDraft("accept",ctx);editorContext=null;render();note("Saved the receiving decision.");return;}
 if(action==="open-comparison"){selectedRun=button.dataset.id;tab="comparison";page=0;render();return;}
 if(action==="report"){download("acceptance-report.html",C.report(workspace,selected().id),"text/html");return;}
 if(action==="exceptions"){download("exceptions.csv",C.exceptionsCsv(workspace,selected().id),"text/csv");return;}
 if(action==="audit"){download("audit.json",json(selected().audit));return;}
}
async function run(fn){if(busy)return;busy=true;const root=$("cmdb-root");root.dataset.busy="true";root.inert=true;try{note("");rememberDrafts();await fn();}catch(e){note(e.message,true);}finally{busy=false;root.inert=false;delete root.dataset.busy;showDrafts();}}
document.addEventListener("click",event=>{
 const b=event.target.closest("[data-action],[data-tab]");if(!b)return;event.preventDefault();
 if(b.dataset.tab){if(busy)return;tab=b.dataset.tab;render();return;}
 run(()=>act(b.dataset.action,b));
});
document.addEventListener("change",event=>{
 if(busy)return;const t=event.target;
 if(t.id==="csv-file")captureDraft("intake");
 for(const [group,pattern]of Object.entries(draftGroups))if(pattern.test(t.id)&&editorContext?.groups.includes(group))captureDraft(group);
 if(t.classList.contains("finding-choice"))captureDraft("review");
 if(t.id==="run-select"){rememberDrafts();selectedRun=t.value;page=0;detail="";render();}
 if(t.id==="filter-status"){rememberDrafts();filter=t.value;page=0;render();}
 if(t.id==="mapping-source"||t.id==="mapping-target"){draftMapping=readMapping();render();}
 if(t.id==="select-page"){document.querySelectorAll(".finding-choice").forEach(x=>x.checked=t.checked);captureDraft("review");}
});
document.addEventListener("input",event=>{
 if(busy)return;const t=event.target;
 for(const [group,pattern]of Object.entries(draftGroups))if(pattern.test(t.id)&&editorContext?.groups.includes(group))captureDraft(group);
 if(t.id==="filter-query"){rememberDrafts();query=t.value;page=0;const start=t.selectionStart;render();$("filter-query").focus();$("filter-query").setSelectionRange(start,start);}
});
$("save-file").onclick=()=>run(saveWorkspace);$("package").onclick=()=>run(handover);
$("retry").onclick=()=>run(async()=>{if(!pending)throw Error("No saved operation needs continuation.");const ctx=editorContext,cmd=pending;await commit(cmd);const group={import:"intake",mapping:"mapping",compare:"compare",review:"review",accept:"accept"}[cmd.action];if(group)clearDraft(group,ctx);editorContext=null;render();note("Continued the original saved operation.");});
$("workspace-select").onchange=()=>{const key=$("workspace-select").value;run(()=>select(key));};
$("actor").onchange=()=>run(()=>put("meta","actor",$("actor").value));
$("open-file").onchange=()=>run(async()=>{const f=$("open-file").files[0];if(!f)return;if(f.size>128*1024*1024)throw Error("The complete workspace exceeds 128 MiB.");const w=C.receive(await f.text());await addBook(w);$("open-file").value="";note("Received the complete original workspace in a separate saved copy.");});
$("open-recovery").onchange=()=>{const f=$("open-recovery").files[0];if(f)run(async()=>{await receiveRecovery(f);$("open-recovery").value="";});};
window.addEventListener("beforeunload",e=>{if(drafts.size||db?.mode==="temporary"&&workspace){e.preventDefault();e.returnValue="";}});
$("new-form").onsubmit=event=>{event.preventDefault();run(async()=>{const p=Object.fromEntries(new FormData(event.target));const w=C.create({...p,id:uid(),at:new Date().toISOString()});await addBook(w);$("new-dialog").close();note("Created the acceptance workspace.");});};
(async()=>{try{db=await openDb();$("storage-mode").hidden=db.mode!=="temporary";$("actor").value=await read("meta","actor")||"";const active=await read("meta","active");if(active&&await read("books",active))await select(active);else if(included)await addBook(C.receive(included));else{await refreshPicker();render();}}catch(e){note("Browser working storage could not open: "+e.message+". Keep the original workspace file and open this application in a browser with local storage enabled.",true);}})();
})();

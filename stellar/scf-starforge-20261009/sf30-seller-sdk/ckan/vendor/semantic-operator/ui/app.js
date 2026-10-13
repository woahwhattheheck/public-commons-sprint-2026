"use strict";
const $ = (q,root=document)=>root.querySelector(q);
const $$ = (q,root=document)=>Array.from(root.querySelectorAll(q));
const esc = v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const views=[["overview","Overview"],["sources","Sources"],["mappings","Mappings"],["snapshots","Snapshots"],["validation","Validation"],["queries","Queries"],["changes","Changes"],["jobs","Jobs"],["receiving","Receiving"],["recovery","Recovery"]];
let state=null, references=null, dirty=false, busy=false;
const records=kind=>state?.records?.[kind]||[];
const key=r=>r.id+"@"+r.revision;
const ref=value=>{const at=value.lastIndexOf("@");return {id:value.slice(0,at),revision:Number(value.slice(at+1))};};
const current=()=>views.some(v=>v[0]===location.hash.slice(1))?location.hash.slice(1):"overview";
const bytes=n=>Number(n)<1024?String(n)+" B":Number(n)<1048576?(n/1024).toFixed(1)+" KiB":(n/1048576).toFixed(2)+" MiB";
const stamp=v=>v?new Date(v).toLocaleString():"—";
const badge=v=>'<span class="badge">'+esc(v)+'</span>';
const empty=message=>'<p class="empty">'+esc(message)+'</p>';
const button=(label,attrs="",primary=false)=>'<button type="button" '+attrs+(primary?' class="primary"':'')+'>'+esc(label)+'</button>';
const field=(label,control,note="")=>'<label>'+esc(label)+control.replace(/^<(input|select|textarea)\b/,'<$1 aria-label="'+esc(label)+'"')+(note?'<small>'+esc(note)+'</small>':'')+'</label>';
const input=(name,value="",attrs="")=>'<input name="'+name+'" value="'+esc(value)+'" '+attrs+'>';
const area=(name,value="",attrs="")=>'<textarea name="'+name+'" '+attrs+'>'+esc(value)+'</textarea>';
const panel=(title,body)=>'<section class="panel"><h2>'+esc(title)+'</h2>'+body+'</section>';
const form=(id,body,label)=>'<form id="'+id+'">'+body+'<div class="actions"><button type="submit" class="primary">'+esc(label)+'</button></div></form>';
const options=(kind,filter=()=>true)=>records(kind).filter(filter).map(r=>'<option value="'+esc(key(r))+'">'+esc(r.payload.title||r.id)+' · r'+r.revision+(kind==="snapshot"?(r.payload.parameters?.data_model==="dataset"?" · dataset":" · graph"):"")+'</option>').join("");
const select=(name,content,multiple=false)=>'<select name="'+name+'" '+(multiple?'multiple':'required')+'>'+content+'</select>';
const selected=(form,name)=>$$('[name="'+name+'"] option:checked',form).map(o=>ref(o.value));
const table=(heads,rows)=>rows.length?'<div class="table-scroll"><table><thead><tr>'+heads.map(v=>'<th scope="col">'+esc(v)+'</th>').join("")+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(v=>'<td>'+v+'</td>').join("")+'</tr>').join("")+'</tbody></table></div>':empty("No records in this workspace yet.");
const titleCell=r=>'<strong>'+esc(r.payload.title||r.id)+'</strong><br><code>'+esc(r.id)+'</code>';
const historyButton=(kind,r)=>button("History",'data-history="'+kind+'" data-id="'+esc(r.id)+'"');
const detailButton=(kind,r)=>button("Open",'data-record="'+kind+'" data-id="'+esc(r.id)+'"');
const fileButtons=(id,name)=>button("Download",'data-download="'+esc(id)+'" data-name="'+esc(name||"original-file")+'"')+' '+button("Preview",'data-preview="'+esc(id)+'" data-name="'+esc(name||"Original file")+'"');
const filesList=items=>items?.length?'<div class="file-list">'+items.map(i=>'<div class="file-item"><div><strong>'+esc(i.title||i.path||i.name)+'</strong><small>'+esc(i.role||"source")+" · "+bytes(i.bytes)+' · '+esc(i.media_type||"")+'</small><code>'+esc(i.sha256)+'</code></div><div class="actions">'+fileButtons(i.artifact_id||i.id,i.path||i.name)+'</div></div>').join("")+'</div>':empty("No complete files are attached to this record.");
const datasets=window.createSemanticDatasetUI({$, $$, esc, field, input, panel, table, badge, empty, records, ref, selected, json, api});
function notice(message,error=false){$("#notice").innerHTML=message?'<div class="notice '+(error?'error':'')+'">'+esc(message)+'</div>':"";}
async function api(path,options={}){
  let response;
  try{response=await fetch(path,{...options,headers:{"X-Semantic-Operator":"1",...(options.body?{"Content-Type":"application/json"}:{}),...options.headers}});}
  catch(error){error.network=true;throw error;}
  if(!response.ok){const body=await response.json().catch(()=>({}));const error=new Error(body.error?.message||"Operation returned HTTP "+response.status);error.status=response.status;throw error;}
  return response;
}
async function json(path,options){return (await api(path,options)).json();}
let stateRequest=0, backgroundRefresh=false;
async function refresh(renderNow=true,{preserveEdits=false}={}){
  const request=++stateRequest;
  const next=await json("/api/state");
  if(request!==stateRequest)return;
  state=next;
  $("#workspace-id").textContent=state.workspace_id;
  $("#worker-state").textContent=state.native_worker.running?"Native job running":"Native worker idle";
  const liveEditing=dirty||$("#detail").open||document.activeElement?.closest("form");
  if(renderNow&&(!preserveEdits||(!busy&&!liveEditing)))render();
}
async function operate(action,payload,element=null){
  const operation_id="op-"+crypto.randomUUID();
  const request={action,payload,operation_id,actor:$("#actor").value.trim()||"Local operator"};
  busy=true;
  const buttons=element?$$("button",element):[];
  buttons.forEach(b=>b.disabled=true);
  sessionStorage.setItem("semantic-original-operation",JSON.stringify({operation_id,action}));
  notice("Running "+action+" · "+operation_id);
  try{
    let result;
    try{result=(await json("/api/operate",{method:"POST",body:JSON.stringify(request)})).result;}
    catch(error){
      if(error.network){
        const original=await json("/api/operations/"+encodeURIComponent(operation_id)).catch(()=>null);
        if(original?.status==="complete")result=original.result;
        else throw new Error("Original operation "+operation_id+" is retained. Refresh Jobs and original operations before continuing. "+error.message);
      }else throw error;
    }
    sessionStorage.removeItem("semantic-original-operation");
    dirty=false;
    await refresh(true);
    notice("Completed "+action+" · "+operation_id);
    return result;
  }catch(error){notice(error.message,true);throw error;}
  finally{busy=false;buttons.forEach(b=>b.disabled=false);}
}
async function fileData(file){
  if(!file)throw new Error("Select the original source file.");
  if(file.size>64*1024*1024)throw new Error("Choose a file of at most 64 MiB.");
  return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(reader.error);reader.onload=()=>resolve(String(reader.result).split(",")[1]);reader.readAsDataURL(file);});
}
async function download(id,name){
  const response=await api("/api/files/"+encodeURIComponent(id));
  const object=URL.createObjectURL(await response.blob());
  const a=document.createElement("a");a.href=object;a.download=String(name).split("/").pop();a.click();
  setTimeout(()=>URL.revokeObjectURL(object),10000);
}
function typedTerm(value){
  if(!value)return '<span class="section-note">Unbound</span>';
  const kind=value.type||"value", annotation=value["xml:lang"]?("@"+value["xml:lang"]):value.datatype||kind;
  return '<code>'+esc(value.value)+'</code><br><small>'+esc(annotation)+'</small>';
}
async function preview(id,name){
  const response=await api("/api/files/"+encodeURIComponent(id));
  const content=await response.text();
  let display=content, data=null, structured="";
  try{data=JSON.parse(content);if(content.length<120000)display=JSON.stringify(data,null,2);}catch{}
  if(data?.head?.vars&&Array.isArray(data?.results?.bindings)){
    const variables=data.head.vars, rows=data.results.bindings;
    structured='<h3>Typed query bindings</h3><p class="section-note">'+rows.length+' retained rows; showing up to 300. Datatypes, language tags and unbound values are shown explicitly. Query-summary.json records any native row limit.</p>'+
      table(variables,rows.slice(0,300).map(row=>variables.map(v=>typedTerm(row[v]))));
  }else if(typeof data?.boolean==="boolean"){
    structured='<h3>Native ASK result</h3><p>'+badge(data.boolean?"True":"False")+'</p>';
  }else if(Array.isArray(data?.findings)){
    const terms=items=>(items||[]).map(typedTerm).join("<hr>");
    structured='<h3>Native validation findings</h3><p class="section-note">'+esc(data.native_outcome||"Validation")+' · '+data.findings.length+' retained findings; showing up to 300.</p>'+
      table(["Focus node","Path","Value","Message","Severity / source shape"],data.findings.slice(0,300).map(row=>[
        terms(row.focus_nodes),terms(row.paths),terms(row.values),terms(row.messages),terms(row.severity)+"<hr>"+terms(row.source_shapes)]));
  }
  structured+=datasets.preview(data);
  const note='<p class="section-note">The raw preview displays up to 120,000 characters. Download keeps every original byte.</p>';
  const raw='<pre>'+esc(display.slice(0,120000))+(display.length>120000?"\\n[Preview limit reached]":"")+'</pre>';
  showDialog(name,'<div class="actions">'+fileButtons(id,name)+'</div>'+structured+(structured?'<details><summary>Original structured result</summary>'+note+raw+'</details>':note+raw));
}
function showDialog(title,body){
  $("#detail-title").textContent=title;$("#detail-body").innerHTML=body;
  if(!$("#detail").open)$("#detail").showModal();
}
function jobTable(rows){
  return table(["Operation","State","Native result","Actions"],rows.map(r=>{
    const p=r.payload,n=p.native_result,actions=[detailButton("job",r)];
    if(["queued","running","cancelling"].includes(p.status))actions.push(button("Cancel",'data-cancel="'+esc(r.id)+'"'));
    if(["failed","interrupted","cancelled"].includes(p.status))actions.push(button("Continue original",'data-continue="'+esc(r.id)+'"'));
    return [titleCell(r)+'<br><small>'+esc(p.action)+'</small>',badge(p.status)+'<br><small>Attempt '+(p.generation||0)+'</small>',n?esc(n.summary.overview||n.summary.message||"Complete native result")+'<br><small>'+n.files.length+' complete files</small>':esc(p.error?.message||"Original inputs retained"),'<div class="actions">'+actions.join(" ")+'</div>'];
  }));
}
function engineeringTable(kind){
  const summary=s=>{
    const fields=[["quad_count","Quads"],["graph_count","Graphs"],["empty_graph_count","Empty graphs"],["added_quads","Added quads"],["removed_quads","Removed quads"],["rows_returned","Rows"],["triples","Triples"],["before_triples","Before triples"],["after_triples","After triples"],
      ["added_triples","Added"],["removed_triples","Removed"],["root_results","Root findings"],["all_results_including_details","All findings"],
      ["impact_nodes","Impact nodes"],["shapes_valid","Shapes valid"],["data_validation_performed","Data checked"],
      ["result_complete","Complete result"],["graph_difference_complete","Complete difference"]];
    const items=fields.filter(([key])=>s[key]!==undefined&&s[key]!==null).map(([key,label])=>esc(label)+": "+esc(s[key]));
    return badge(s.native_outcome||"Retained result")+(items.length?'<p class="section-note">'+items.join("<br>")+'</p>':"")+
      (s.truncated===true||s.impact_truncated===true?badge("Declared result limit"):"");
  };
  return table(["Record","Native result","Completed","Actions"],records(kind).map(r=>[titleCell(r),summary(r.payload.summary||{}),stamp(r.payload.completed_at),'<div class="actions">'+detailButton(kind,r)+" "+historyButton(kind,r)+'</div>']));
}
function heading(title,description){return '<div class="page-heading"><h1>'+esc(title)+'</h1><p class="muted">'+esc(description)+'</p></div>';}
function overview(){
  const active=records("job").filter(r=>["queued","running","cancelling"].includes(r.payload.status));
  const counts=[["Original sources",records("source").length],["Semantic snapshots",records("snapshot").length],["Validation runs",records("validation").length],["Active native jobs",active.length]];
  return heading("Engineering workspace","Curate original sources, map tabular data, build semantic snapshots and examine their conformance and change impact.")+
    '<div class="stats">'+counts.map(([label,n])=>'<div class="stat"><strong>'+n+'</strong><span>'+label+'</span></div>').join("")+'</div>'+
    panel("Current work",active.length?jobTable(active):'<p>No native work is running. Start with Sources, then build a Snapshot.</p><div class="actions"><a class="button" href="#sources">Open sources</a><a class="button" href="#snapshots">Build a snapshot</a></div>')+
    '<div class="columns">'+panel("Delivery sequence",'<ol><li>Retain original RDF, CSV, ontology and shapes sources with their edition and provenance.</li><li>Map tables explicitly and build a snapshot from exact source revisions.</li><li>Run native SHACL validation, SPARQL queries and graph comparisons.</li><li>Record review decisions and transfer or recover the complete workspace.</li></ol>')+
    panel("Recent decisions",table(["Decision","Disposition","Record"],records("decision").slice(0,8).map(r=>[esc(r.payload.title),badge(r.payload.disposition),'<code>'+esc(r.payload.record_id)+'</code> · r'+r.payload.record_revision])))+'</div>'+
    panel("Original operations",table(["Operation","Action","Status","Updated"],state.operations.slice(0,15).map(r=>['<code>'+esc(r.id)+'</code>',esc(r.kind),badge(r.status),stamp(r.updated_at)])));
}
function sources(){
  const edit=form("source-form",input("id","","type=hidden")+input("expected_revision","0","type=hidden")+
    field("Source title",input("title","","required maxlength=300"))+
    field("Original source file",'<input type="file" name="file" required>')+
    '<section data-catalogue-companion hidden>'+field("Optional graph catalogue companion",'<input type="file" name="catalog_file" accept=".json,application/json">',"When importing a retained dataset.nq, include its matching graph-catalog.json to keep empty graphs. External N-Quads alone records graphs present in its quad bytes.")+'</section>'+
    '<div class="fields">'+field("Source format",select("format",Object.entries({"turtle":"Turtle","nt":"N-Triples","xml":"RDF/XML","json-ld":"JSON-LD","trig":"TriG dataset","nquads":"N-Quads dataset","csv":"CSV table"}).map(([v,n])=>'<option value="'+v+'">'+n+'</option>').join("")))+
    field("Source role",select("role",["data","table","ontology","shapes"].map(v=>'<option>'+v+'</option>').join("")))+'</div>'+
    field("Source reference",input("source_reference","","required"),"Original publication URL, source-system reference or file origin.")+
    '<div class="fields">'+field("Source edition",input("edition",""))+field("Source license",input("license",""))+'</div>',"Retain source revision");
  const profiles=references?.profiles||[];
  const profile=profiles.length?'<h3>Complete published profile</h3>'+form("profile-form",field("Published profile",select("profile_id",profiles.map(p=>'<option value="'+esc(p.profile_id||p.id)+'">'+esc(p.title||p.profile_id||p.id)+'</option>').join("")))+'<p class="section-note">Import the documented shape modules and ontology together. Each original file keeps its own source identity; choose the returned sources explicitly for validation.</p>',"Import profile"):"";
  const bundled=(references?.files||[]).filter(r=>/\.(ttl|nt|rdf|jsonld|trig|nq)$/.test(r.path));
  const reference=form("reference-form",field("Bundled original reference",select("path",bundled.map(r=>'<option value="'+esc(r.path)+'">'+esc(r.path)+'</option>').join("")))+
    field("Reference role",select("role",["data","ontology","shapes"].map(v=>'<option>'+v+'</option>').join("")))+
    '<p class="section-note">These are unchanged upstream public reference files with their original licenses and byte identities. Select shapes and ontologies explicitly for each validation.</p>',"Retain reference source");
  return heading("Sources","Keep each source edition intact. Source edits create another revision; completed snapshots keep their original input revisions.")+
    '<div class="columns">'+panel("Import or revise a source",edit)+panel("Published reference collection",reference+profile)+'</div>'+
    panel("Original source records",table(["Source","Role / format","Edition / bytes","Actions"],records("source").map(r=>[titleCell(r),esc(r.payload.role)+" / "+esc(r.payload.format),esc(r.payload.edition||"Unspecified edition")+"<br>"+bytes(r.payload.bytes)+' · revision '+r.revision,
      '<div class="actions">'+button("Inspect",'data-inspect="'+esc(key(r))+'"')+" "+(r.payload.role==="data"&&r.payload.format!=="csv"?button("Inspect dataset",'data-inspect-dataset="'+esc(key(r))+'"')+" ":"")+button("Revise",'data-edit-source="'+esc(r.id)+'"')+" "+historyButton("source",r)+" "+fileButtons(r.payload.artifact_id,r.payload.title)+'</div>'])));
}
function mappingRow(index,value={}){
  return '<div class="field-row" data-field-row><div class="fields">'+
    field("Column "+index,input("column",value.column||"","required"))+
    field("Predicate "+index,input("predicate",value.predicate||"","required"))+
    field("Term kind "+index,'<select name="kind" aria-label="Term kind '+index+'"><option value="literal"'+(value.kind!=="iri"?" selected":"")+'>literal</option><option value="iri"'+(value.kind==="iri"?" selected":"")+'>IRI</option></select>')+
    field("Datatype "+index,input("datatype",value.datatype||""))+
    field("Language "+index,input("language",value.language||""))+
    field("Object IRI template "+index,input("iri_template",value.iri_template||""))+'</div><div class="actions">'+button("Remove field","data-remove-field")+'</div></div>';
}
function mappings(){
  const edit=form("mapping-form",input("id","","type=hidden")+input("expected_revision","0","type=hidden")+
    field("Mapping title",input("title","","required"))+
    field("Original CSV source",select("source",options("source",r=>r.payload.format==="csv")))+
    field("Subject IRI template",input("subject_template","https://example.org/records/{ID}","required"),"Column values are encoded into each {Column} placeholder.")+
    field("RDF classes",area("classes","","placeholder='One absolute class IRI per line'"))+
    '<div class="fields">'+field("CSV delimiter",input("delimiter",",","maxlength=1 required"))+
    field("Exact null strings",area("null_values",'[""]',"rows=2"),"JSON array; only the declared strings are omitted.")+'</div>'+
    '<div id="mapping-fields">'+mappingRow(1,{column:"title",predicate:"http://purl.org/dc/terms/title",kind:"literal"})+'</div>'+
    '<div class="actions">'+button("Add column mapping","data-add-field")+'</div>'+
    field("Mapping review note",area("review_note","")),"Save mapping revision");
  return heading("Mappings","Translate original table columns into explicit RDF terms. Every mapping pins the source revision and retains row-level provenance.")+
    panel("Mapping editor",edit)+panel("Saved mappings",table(["Mapping","Pinned source","Fields","Actions"],records("mapping").map(r=>[titleCell(r),'<code>'+esc(r.payload.source.id)+'</code> · r'+r.payload.source.revision,String(r.payload.definition.fields.length),
      '<div class="actions">'+button("Edit",'data-edit-mapping="'+esc(r.id)+'"')+" "+detailButton("mapping",r)+" "+historyButton("mapping",r)+'</div>'])));
}
function snapshots(){
  const build=form("snapshot-form",field("Snapshot title",input("title","","required"))+
    '<div class="columns">'+field("RDF data revisions",select("sources",options("source",r=>r.payload.role==="data"&&r.payload.format!=="csv"),true))+
    field("CSV mapping revisions",select("mappings",options("mapping"),true))+'</div>'+datasets.snapshotControls()+
    '<p class="section-note">Single-graph snapshots retain canonical N-Triples and Turtle. Dataset snapshots retain graph membership and empty graphs. Both keep complete source/row provenance; select ontologies and shapes separately in Validation.</p>',"Build native snapshot");
  return heading("Snapshots","A snapshot joins exact original data and mapping revisions into a retained graph or named-graph dataset.")+
    panel("Build a semantic snapshot",build)+panel("Complete snapshots",engineeringTable("snapshot"));
}
function validation(){
  const run=form("validation-form",field("Validation title",input("title","","required"))+
    field("Snapshot to validate",select("snapshot",options("snapshot")))+
    '<div class="columns">'+field("SHACL shapes revisions",select("shapes",options("source",r=>r.payload.role==="shapes"),true))+
    field("Ontology revisions",select("ontologies",options("source",r=>r.payload.role==="ontology"),true))+'</div>'+
    field("Inference mode",select("inference",["none","rdfs","owlrl","both"].map(v=>'<option>'+v+'</option>').join("")))+
    '<div class="actions"><label class="check"><input name="allow_infos" type="checkbox">Allow Info results for conformance</label><label class="check"><input name="allow_warnings" type="checkbox">Allow Warning results for conformance</label></div>'+
    datasets.runControls("validation")+
    '<p class="section-note">Native pySHACL checks the shapes and selected data. The complete report graph and findings remain attached to this exact run.</p>',"Run native validation");
  return heading("Validation","Evaluate explicit SHACL constraints against the original retained graph and the selected inference mode.")+
    panel("Validation inputs",run)+panel("Validation results",engineeringTable("validation"));
}
function queries(){
  const run=form("query-form",field("Query title",input("title","","required"))+
    field("Query snapshot",select("snapshot",options("snapshot")))+
    field("SPARQL query",area("query","SELECT ?s ?p ?o\nWHERE { ?s ?p ?o }\nORDER BY ?s ?p ?o","required class=mono"))+
    field("Result row limit",input("row_limit","10000","type=number min=1 max=100000 required"))+
    datasets.runControls("query")+
    '<p class="section-note">Queries run locally against this snapshot. Structured native results retain term types, datatypes and languages. Any row limit is reported in the result.</p>',"Run native query");
  return heading("Queries","Explore a retained graph with native SPARQL and keep the complete result or declared result limit.")+
    panel("Query editor",run)+panel("Saved query results",engineeringTable("query"));
}
function changes(){
  const run=form("comparison-form",field("Comparison title",input("title","","required"))+
    '<div class="fields">'+field("Before snapshot",select("before",options("snapshot")))+field("After snapshot",select("after",options("snapshot")))+'</div>'+
    field("Impact edge predicates",area("edge_predicates","","placeholder='Optional: one absolute predicate IRI per line'"),"Select the relationships relevant to the impact review.")+
    '<div class="fields">'+field("Impact depth",input("depth","2","type=number min=0 max=8 required"))+
    field("Impact node limit",input("node_limit","100000","type=number min=1 max=100000 required"))+'</div>'+datasets.runControls("comparison"),"Compare retained snapshots");
  return heading("Changes","Compare exact graph or dataset editions and trace affected nodes through the selected relationships, graph scope and depth.")+
    panel("Change and impact inputs",run)+panel("Retained comparisons",engineeringTable("comparison"));
}
function receiving(){
  const intake=form("handoff-form",field("Receiving title",input("title","Received semantic workspace","required"))+
    field("Complete workspace ZIP",'<input name="file" type="file" accept=".zip" required>')+
    field("Transfer source reference",input("source_reference","Original operator workspace transfer","required")),"Receive complete workspace");
  const exportForm=form("handoff-export-form",'<p>Export every source, mapping revision, graph, native result and review decision. The transfer is an ordinary ZIP for an intended recipient.</p><p class="section-note">Receiving preserves an independent complete branch with its original IDs. Export later work from that child operator itself. This parent retains its incoming edition and receiving history.</p>',"Download complete handoff");
  return heading("Receiving","Transfer the entire engineering history and reopen a received workspace without replacing its recipient's existing work.")+
    '<div class="columns">'+panel("Export this workspace",exportForm)+panel("Receive a workspace",intake)+'</div>'+
    panel("Received workspaces",table(["Workspace","Contents","Conflicts","Actions"],records("receiving").map(r=>[titleCell(r)+'<br><code>'+esc(r.payload.source_workspace_id)+'</code>',r.payload.summary.records+" records · "+r.payload.summary.revisions+" revisions<br>"+r.payload.summary.artifacts+" source/result files",String(r.payload.conflicts.length)+' · both branches retained<br><small>'+esc(r.payload.location_status==="retained_archive_available"?"Incoming edition ready to reopen on this host":"Local independent workspace")+'</small>',
      '<div class="actions">'+button("Open workspace",'data-open-workspace="receiving" data-id="'+esc(r.id)+'"')+" "+detailButton("receiving",r)+'</div>'])));
}
function recovery(){
  const outgoing=form("recovery-export-form",field("New recovery passphrase",'<input name="passphrase" type="password" autocomplete="new-password" minlength="12" maxlength="1024" required>',"At least 12 characters. Keep the passphrase separately; it is required to restore.")+
    '<p class="section-note">Encrypted recovery retains original IDs, sources, graph results and native histories. A receiving operator gets a fresh local key.</p>',"Download encrypted recovery");
  const incoming=form("recovery-restore-form",field("Encrypted recovery file",'<input name="file" type="file" accept=".csw" required>')+
    field("Original recovery passphrase",'<input name="passphrase" type="password" autocomplete="current-password" minlength="12" maxlength="1024" required>')+
    field("New private recovery directory",input("destination","","required placeholder='/absolute/path/to/new-workspace'"),"Choose a new directory outside this current workspace."),"Restore original workspace");
  return heading("Recovery","Keep a self-contained encrypted copy and recover the original engineering history into a new private directory.")+
    '<div class="columns">'+panel("Export encrypted workspace",outgoing)+panel("Restore a saved workspace",incoming)+'</div>'+
    panel("Recovered workspaces",table(["Original workspace","Contents","Destination","Actions"],records("recovery").map(r=>[titleCell(r)+'<br><code>'+esc(r.payload.source_workspace_id)+'</code>',r.payload.summary.records+" records · "+r.payload.summary.revisions+" revisions",r.payload.location_status==="local"?'<code>'+esc(r.payload.workspace_path)+'</code>':'<span class="section-note">Restore the original encrypted archive on this host.</span>',
      '<div class="actions">'+(r.payload.location_status==="local"?button("Open workspace",'data-open-workspace="recovery" data-id="'+esc(r.id)+'"'):"")+" "+detailButton("recovery",r)+'</div>'])));
}
function render(){
  if(!state)return;
  const view=current();
  $("#navigation").innerHTML=views.map(([id,title])=>'<a href="#'+id+'" '+(id===view?'aria-current="page"':'')+'>'+title+'</a>').join("");
  const pages={overview,sources,mappings,snapshots,validation,queries,changes,receiving,recovery,jobs:()=>heading("Native jobs","Each operation keeps its original inputs, complete native files and all interrupted attempts.")+panel("Original native operations",jobTable(records("job")))};
  $("#content").innerHTML=pages[view]();
  datasets.mount($("#content"),state.workspace_id);
  if(state.worker_error)notice("Native worker: "+state.worker_error.message,true);
  dirty=false;
}

function lines(value){return String(value||"").split(/\r?\n/).map(v=>v.trim()).filter(Boolean);}
function value(form,name){return $('[name="'+name+'"]',form)?.value||"";}
function choose(form,name,wanted,title){
  const control=$('[name="'+name+'"]',form);
  if(!Array.from(control.options).some(o=>o.value===wanted)){
    const option=document.createElement("option");option.value=wanted;option.textContent=title||wanted;control.append(option);
  }
  control.value=wanted;
}
function reviewForm(kind,row){
  if(!["mapping","snapshot","validation","query","comparison"].includes(kind))return "";
  const prior=records("decision").filter(r=>r.payload.record_kind===kind&&r.payload.record_id===row.id);
  return '<h3>Review decision</h3>'+form("decision-form",input("record_kind",kind,"type=hidden")+input("record_id",row.id,"type=hidden")+input("record_revision",row.revision,"type=hidden")+
    field("Decision title",input("title","Review "+row.payload.title,"required"))+
    field("Disposition",select("disposition",["reviewed","accepted","changes_requested"].map(v=>'<option>'+v+'</option>').join("")))+
    field("Decision note",area("note","","required")),"Save decision")+
    '<h3>Previous decisions</h3>'+table(["Decision","Revision","Disposition","Note"],prior.map(r=>[esc(r.payload.title),"r"+r.payload.record_revision,badge(r.payload.disposition),esc(r.payload.note)]));
}
function showRecord(kind,id){
  const row=records(kind).find(r=>r.id===id);if(!row)throw new Error("The original record is missing.");
  const p=row.payload,files=p.files||p.native_result?.files||[];
  let body=datasets.recordSummary(row)+'<p><code>'+esc(row.id)+'</code> · revision '+row.revision+'</p>'+
    (p.summary?'<pre>'+esc(JSON.stringify(p.summary,null,2))+'</pre>':"")+filesList(files);
  if(kind==="receiving")body+='<h3>Received branch</h3><p class="section-note">'+esc(p.resolution)+'</p><code>'+esc(p.workspace_path)+'</code><h3>Conflicting original records</h3>'+table(["Kind","Original ID","Current / received revisions"],p.conflicts.map(v=>[esc(v.kind),'<code>'+esc(v.id)+'</code>',v.current_revision+" / "+v.received_revision]));
  body+='<details><summary>Complete retained record</summary><pre>'+esc(JSON.stringify(row,null,2))+'</pre></details>'+reviewForm(kind,row);
  showDialog(p.title||row.id,body);
}
async function showHistory(kind,id){
  const history=await json("/api/history/"+encodeURIComponent(kind)+"/"+encodeURIComponent(id));
  showDialog("Original revision history",history.map(row=>{
    const p=row.payload;
    return '<article class="history-entry"><h3>Revision '+row.revision+'</h3><p>'+esc(row.actor||"Original operator")+" · "+stamp(row.created_at)+'</p><code>'+esc(row.sha256)+'</code>'+
      (p.artifact_id?'<div class="actions">'+fileButtons(p.artifact_id,p.title)+'</div>':"")+'<pre>'+esc(JSON.stringify(p,null,2))+'</pre></article>';
  }).join(""));
}
document.addEventListener("submit",async event=>{
  const target=event.target;if(!(target instanceof HTMLFormElement))return;
  // Named controls such as id can shadow HTMLFormElement properties.
  const formId=target.getAttribute("id");
  event.preventDefault();if(busy)return;
  try{
    const get=name=>value(target,name);
    let action,payload;
    if(formId==="source-form"){
      const file=$('[name="file"]',target).files[0];
      action="source.import";payload={title:get("title"),format:get("format"),role:get("role"),edition:get("edition"),license:get("license"),
        source_reference:get("source_reference"),name:file?.name,data_base64:await fileData(file)};
      const companion=$('[name="catalog_file"]',target)?.files[0];
      if(companion&&get("format")==="nquads")Object.assign(payload,{catalog_name:companion.name,catalog_data_base64:await fileData(companion)});
      if(get("id"))Object.assign(payload,{id:get("id"),expected_revision:Number(get("expected_revision"))});
    }else if(formId==="reference-form"){
      action="source.reference";payload={path:get("path"),role:get("role")};
    }else if(formId==="profile-form"){
      action="source.profile";payload={profile_id:get("profile_id")};
    }else if(formId==="mapping-form"){
      action="mapping.save";
      const fields=$$("[data-field-row]",target).map(row=>({column:value(row,"column"),predicate:value(row,"predicate"),kind:value(row,"kind"),
        datatype:value(row,"datatype")||null,language:value(row,"language")||null,iri_template:value(row,"iri_template")||null}));
      payload={title:get("title"),source:ref(get("source")),review_note:get("review_note"),definition:{subject_template:get("subject_template"),
        classes:lines(get("classes")),delimiter:get("delimiter"),null_values:JSON.parse(get("null_values")),fields}};
      if(get("id"))Object.assign(payload,{id:get("id"),expected_revision:Number(get("expected_revision"))});
    }else if(formId==="snapshot-form"){
      action="snapshot.build";payload={title:get("title"),sources:selected(target,"sources"),mappings:selected(target,"mappings")};
    }else if(formId==="validation-form"){
      action="validation.run";payload={title:get("title"),snapshot:ref(get("snapshot")),shapes:selected(target,"shapes"),ontologies:selected(target,"ontologies"),
        inference:get("inference"),allow_infos:$('[name="allow_infos"]',target).checked,allow_warnings:$('[name="allow_warnings"]',target).checked};
    }else if(formId==="query-form"){
      action="query.run";payload={title:get("title"),snapshot:ref(get("snapshot")),query:get("query"),row_limit:Number(get("row_limit"))};
    }else if(formId==="comparison-form"){
      action="comparison.run";payload={title:get("title"),before:ref(get("before")),after:ref(get("after")),edge_predicates:lines(get("edge_predicates")),
        depth:Number(get("depth")),node_limit:Number(get("node_limit"))};
    }else if(formId==="decision-form"){
      action="decision.save";payload={title:get("title"),record_kind:get("record_kind"),record_id:get("record_id"),
        record_revision:Number(get("record_revision")),disposition:get("disposition"),note:get("note")};
    }else if(formId==="handoff-export-form"){
      action="handoff.export";payload={};
    }else if(formId==="handoff-form"){
      const file=$('[name="file"]',target).files[0];
      action="handoff.receive";payload={title:get("title"),name:file?.name,data_base64:await fileData(file),source_reference:get("source_reference")};
    }else if(formId==="recovery-export-form"){
      action="recovery.export";payload={passphrase:get("passphrase")};
    }else if(formId==="recovery-restore-form"){
      const file=$('[name="file"]',target).files[0];
      action="recovery.restore";payload={name:file?.name,data_base64:await fileData(file),passphrase:get("passphrase"),destination:get("destination")};
    }else return;
    payload=datasets.augment(formId,payload,target);
    const result=await operate(action,payload,target);
    if(["handoff.export","recovery.export"].includes(action))await download(result.artifact.id,result.artifact.name);
    if(action==="decision.save")$("#detail").close();
    if(action==="source.profile")notice("Imported "+result.title+" · "+result.sources.length+" original sources retained. Select these sources together in Validation.");
    if(result.kind==="job"){location.hash="jobs";render();}
    if(action==="recovery.restore")notice("Recovered original workspace "+result.payload.source_workspace_id+" into "+result.payload.workspace_path+". Open workspace to continue.");
  }catch(error){notice(error.message,true);}
});
document.addEventListener("click",async event=>{
  const control=event.target.closest("button");if(!control||busy)return;
  try{
    const d=control.dataset;
    if(d.download)await download(d.download,d.name);
    else if(d.preview)await preview(d.preview,d.name);
    else if(d.history)await showHistory(d.history,d.id);
    else if(d.record)showRecord(d.record,d.id);
    else if(d.inspectDataset){
      const source=ref(d.inspectDataset),row=records("source").find(r=>r.id===source.id);
      await operate("source.inspect",{source,data_model:"dataset",title:"Inspect dataset "+row.payload.title});
      location.hash="jobs";render();
    }else if(d.inspect){
      const source=ref(d.inspect),row=records("source").find(r=>r.id===source.id);
      await operate("source.inspect",{source,title:"Inspect "+row.payload.title});
      location.hash="jobs";render();
    }else if(d.cancel)await operate("job.cancel",{job_id:d.cancel});
    else if(d.continue)await operate("job.continue",{job_id:d.continue});
    else if("addField" in d){
      $("#mapping-fields").insertAdjacentHTML("beforeend",mappingRow($$("[data-field-row]").length+1));dirty=true;
    }else if("removeField" in d){control.closest("[data-field-row]").remove();dirty=true;}
    else if(d.editSource){
      const row=records("source").find(r=>r.id===d.editSource),form=$("#source-form");
      for(const name of ["title","format","role","source_reference","edition","license"])$('[name="'+name+'"]',form).value=row.payload[name]||"";
      $('[name="id"]',form).value=row.id;$('[name="expected_revision"]',form).value=row.revision;
      dirty=true;form.scrollIntoView({behavior:"smooth",block:"start"});$('[name="title"]',form).focus();
      $('[name="format"]',form).dispatchEvent(new Event("change"));
      notice("Editing source revision "+row.revision+". Select the complete original file for the next revision. A retained N-Quads catalogue must be selected again when it belongs to the new source bytes.");
    }else if(d.editMapping){
      const row=records("mapping").find(r=>r.id===d.editMapping),p=row.payload,form=$("#mapping-form");
      for(const [name,v] of Object.entries({id:row.id,expected_revision:row.revision,title:p.title,review_note:p.review_note,
        subject_template:p.definition.subject_template,classes:p.definition.classes.join("\n"),delimiter:p.definition.delimiter,
        null_values:JSON.stringify(p.definition.null_values)}))$('[name="'+name+'"]',form).value=v;
      choose(form,"source",p.source.id+"@"+p.source.revision);
      $("#mapping-fields").innerHTML=p.definition.fields.map((v,i)=>mappingRow(i+1,v)).join("");
      dirty=true;form.scrollIntoView({behavior:"smooth",block:"start"});$('[name="title"]',form).focus();
    }else if(d.openWorkspace){
      const result=await operate("workspace.open",{kind:d.openWorkspace,id:d.id});
      const url=new URL(result.url);
      if(url.protocol!=="http:"||!["localhost","127.0.0.1"].includes(url.hostname))throw new Error("The received workspace returned an unexpected local address.");
      showDialog("Received workspace is open",'<p>The original workspace and all retained records are available in a separate local operator.</p><p><code>'+esc(result.workspace_id)+'</code></p><a class="button" href="'+esc(url.href)+'" target="_blank" rel="noopener">Open received operator</a>');
    }
  }catch(error){notice(error.message,true);}
});
document.addEventListener("input",event=>{
  if(event.target.closest("#content")||event.target.closest("#detail-body"))dirty=true;
});
document.addEventListener("change",event=>{
  if(event.target.matches('#source-form [name="format"]')){
    const role=$('#source-form [name="role"]');if(event.target.value==="csv")role.value="table";else if(role.value==="table")role.value="data";
  }
});
$("#close-detail").addEventListener("click",()=>$("#detail").close());
$("#refresh").addEventListener("click",()=>{if(dirty&&!confirm("Discard the unsaved form changes and refresh the saved workspace?"))return;refresh(true).catch(error=>notice(error.message,true));});
document.addEventListener("click",event=>{const link=event.target.closest("#navigation a");if(link&&dirty&&!confirm("Discard unsaved form changes and open another view?"))event.preventDefault();});
window.addEventListener("beforeunload",event=>{if(dirty){event.preventDefault();event.returnValue="";}});
$("#actor").value=localStorage.getItem("semantic-operator-name")||"Local operator";
$("#actor").addEventListener("change",()=>localStorage.setItem("semantic-operator-name",$("#actor").value));
window.addEventListener("hashchange",()=>{if(state)render();});
async function start(){
  try{
    references=await json("/api/references");
    await refresh(true);
    const pending=sessionStorage.getItem("semantic-original-operation");
    if(pending){
      const saved=JSON.parse(pending),original=await json("/api/operations/"+encodeURIComponent(saved.operation_id)).catch(()=>null);
      if(original?.status==="complete"){sessionStorage.removeItem("semantic-original-operation");notice("Original operation completed: "+saved.operation_id);}
      else notice("Original operation retained: "+saved.operation_id+". Review the original operations and Jobs before continuing.",true);
    }
  }catch(error){notice(error.message,true);}
}
setInterval(async()=>{
  if(busy||!state||document.hidden||backgroundRefresh)return;
  backgroundRefresh=true;
  try{await refresh(true,{preserveEdits:true});}
  catch(error){notice(error.message,true);}
  finally{backgroundRefresh=false;}
},2500);
start();

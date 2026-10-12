"use strict";
/* SQL Server joins the existing operator; private values remain in that workspace. */
const sqlSelection={section:"connections",profile:null,query:null,job:null,capture:null,plan:null,table:null,receipt:null};
const sqlDrafts=new Map();
let sqlDraftKey="",sqlEditing=false,sqlVisibleRecord=null,sqlBuilderCatalog=null,sqlMappingPlan=null,sqlMappingCapture=null,sqlRefreshBusy=false;
const sqlSections={connections:"Connections & catalog",queries:"Queries & review",jobs:"Capture jobs",mapping:"Model bindings",receiving:"Receiving"};
const sqlJson=value=>JSON.stringify(value,null,2);
function sqlRemember(){
  if(tab!=="sql"||!sqlDraftKey)return;
  const fields={};document.querySelectorAll("#content input[id],#content select[id],#content textarea[id]").forEach(el=>{
    if(el.type!=="file")fields[el.id]=el.type==="checkbox"?el.checked:el.value;
  });sqlDrafts.set(sqlDraftKey,fields);
}
function sqlAfterRender(){
  const fields=sqlDrafts.get(sqlDraftKey)||{};for(const[id,v]of Object.entries(fields)){const el=$(id);if(el)el.type==="checkbox"?el.checked=v:el.value=v;}
}
function sqlForget(){sqlDrafts.delete(sqlDraftKey);sqlEditing=false;}
function sqlButtons(){return '<div class="panel"><div class="actions" aria-label="SQL Server steps">'+Object.entries(sqlSections).map(([key,title])=>'<button data-action="sql-section" data-section="'+key+'"'+(sqlSelection.section===key?' class="primary"':'')+'>'+h(title)+'</button>').join("")+'</div></div>';}
function sqlArea(title,id,initial,rows=5){return '<label>'+h(title)+'<textarea class="code" id="'+id+'" rows="'+rows+'">'+h(typeof initial==="string"?initial:sqlJson(initial))+'</textarea></label>';}
function sqlSelect(title,id,items,chosen){return '<label>'+h(title)+'<select id="'+id+'"><option value="">Choose…</option>'+items.map(i=>'<option value="'+h(i.value)+'"'+(i.value===chosen?' selected':'')+'>'+h(i.label)+'</option>').join("")+'</select></label>';}
function sqlNotes(p){return '<div class="source-note">'+h((p.origin||(workspace.sql_profile||[]).find(r=>r.id===p.profile?.id)?.payload.origin)==="protocol-example"?"Explicit local protocol example. No SQL Server connection is asserted.":"Original SQL Server read operation.")+'<br>One observed statement per page under the database’s configured isolation. Individual pages and capture times are retained; there is no shared snapshot claim for the collection.</div>';}
function sqlProfileLabel(id){return label((workspace.sql_profile||[]).find(r=>r.id===id)||{id,payload:{}});}
async function sqlConnections(){
  const pRecord=sqlSelection.profile?await entity("sql_profile",sqlSelection.profile):null;
  const p=pRecord?.payload||{},c=p.connection||{},runtime=workspace.sql_runtime||{};
  sqlVisibleRecord=pRecord;sqlDraftKey="connection:"+(pRecord?.id||"new")+":"+(pRecord?.revision||0);
  const completed=(workspace.sql_job||[]).filter(r=>r.payload.document.action==="catalog"&&r.payload.status==="complete");
  let catalogs="";
  for(const job of completed.slice(0,8)){
    catalogs+='<tr><td>'+h(label(job))+'</td><td>'+h(sqlProfileLabel(job.payload.profile.id))+'</td><td>'+h(job.payload.document.table||"Accessible tables")+'</td><td><button data-action="sql-open-job" data-id="'+job.id+'">Open original catalog</button></td></tr>';
  }
  return '<div class="metrics">'+metric((workspace.sql_profile||[]).length,"Private profiles")+metric((workspace.sql_query||[]).length,"Versioned queries")+metric((workspace.sql_capture||[]).filter(r=>r.payload.complete).length,"Complete captures")+metric((workspace.sql_job||[]).filter(r=>["running","queued","starting"].includes(r.payload.status)).length,"Active jobs")+'</div>'
    +'<div class="panel"><div class="panel-head"><h2>Private SQL Server connection</h2><button data-action="sql-new-profile">New connection</button></div>'
    +formSelect("Saved connection","sql-profile-select",workspace.sql_profile||[],pRecord?.id)
    +'<div class="grid three">'+input("Connection label","sql-profile-label",p.label||"")+input("Server host","sql-host",c.host||"")+input("TCP port","sql-port",c.port||1433,"number",'min="1" max="65535"')
    +input("Database","sql-database",c.database||"")+input("SQL user","sql-user",c.user||"")+input("Password environment variable NAME","sql-password-env",c.passwordEnv||"BI_SQL_PASSWORD")+'</div>'
    +'<div class="grid"><label>Transport<select id="sql-tls"><option value="verify-full"'+(c.tls!=="local-plaintext"?" selected":"")+'>Verified TLS</option><option value="local-plaintext"'+(c.tls==="local-plaintext"?" selected":"")+'>Loopback development plaintext</option></select></label><label>Original CA certificate, optional<input id="sql-ca" type="file" accept=".pem,.crt,.cer"></label></div>'
    +(p.ca?'<p>'+objectButton(p.ca,"Retained CA certificate")+'</p><label><input type="checkbox" id="sql-remove-ca">Remove this CA in the next revision</label>':"")
    +'<label>Connection notes<textarea id="sql-profile-notes">'+h(p.description||"")+'</textarea></label>'
    +'<div class="actions"><button data-action="sql-save-profile" class="primary">Save connection revision</button>'+(pRecord?historyButton(pRecord):"")+'</div>'
    +'<p class="muted">Set the named password variable on the existing operator/native-worker host before launch. Password values are never entered here or included in jobs and handoffs. TLS verifies the server certificate; the development option is limited to a loopback host.</p>'
    +(p.origin==="protocol-example"?sqlNotes(p):"")+'</div>'
    +'<div class="panel"><h2>Inspect the actual native catalog</h2><div class="grid">'+formSelect("Connection","sql-catalog-profile",workspace.sql_profile||[],pRecord?.id)
    +input("Optional schema-qualified table / view","sql-catalog-table","", "text",'placeholder="[dbo].[OffenseCells]"')+'</div><label><input type="checkbox" id="sql-catalog-start">Start on this existing host after preparing the immutable job</label><button data-action="sql-catalog" class="primary">Prepare catalog job</button><p class="muted">Blank table lists accessible tables and views. A selected table captures columns, native types, nullability, precision, collation and primary-key membership. Each native catalog is retained; a truncated list is identified as partial.</p></div>'
    +(catalogs?'<div class="panel tight">'+rowsTable(["Catalog","Connection","Selection",""],[catalogs])+'</div>':"")
    +'<details><summary>Native runtime and portable host setup</summary><p>Node22.16+ · mssql12.7.4 · pinned source '+h(runtime.driver_ref||"")+'</p><p>Node detected: '+h(runtime.node_available?"yes":"no")+'; driver in this portable profile: '+h(runtime.driver_present_in_portable_profile?"yes":"not observed")+'. An existing external worker can run the downloaded job and return its exact result ZIP.</p><pre>npm install --prefix tools/sql-server/core/mssql\npython tools/sql-server/SQL_SERVER_WORKER.py --job /private/job/job.json --operation /private/job/operation --mode execute</pre><p class="muted">Use a Node executable through BI_SQL_NODE if it is not on PATH. The job ZIP carries its original worker under worker/. Its worker/core/mssql folder has the same dependency manifest.</p></details>';
}
async function sqlQueries(){
  const query=sqlSelection.query?await entity("sql_query",sqlSelection.query):null;
  sqlVisibleRecord=query;const p=query?.payload||{},def=p.definition||{sql:"SELECT [Id] AS [Id], [Amount] AS [Amount] FROM [dbo].[ReviewedSource]",parameters:{},parameterOrder:[],columns:["Id","Amount"],orderBy:[{column:"Id",direction:"ASC"}],maxRows:1000,maxBytes:917504,timeoutMs:10000};
  sqlDraftKey="query:"+(query?.id||"new")+":"+(query?.revision||0);
  const catalogJobs=(workspace.sql_job||[]).filter(r=>r.payload.document.action==="catalog"&&r.payload.document.table&&r.payload.status==="complete");
  const chosen=sqlSelection.catalog||catalogJobs[0]?.id;
  let tableForm="";
  sqlBuilderCatalog=null;
  if(chosen){const job=await entity("sql_job",chosen);const catalog=job.payload.catalog;if(catalog?.columns){sqlBuilderCatalog={job,catalog};
    tableForm=rowsTable(["Include","Source / native type","Projected alias","Cursor key"],catalog.columns.map((c,i)=>'<tr><td><input type="checkbox" class="sql-column-use" data-index="'+i+'" checked aria-label="Include '+h(c.name)+'"></td><td><strong>'+h(c.name)+'</strong><div class="muted">'+h(c.columnType)+' · '+h(c.nullable==="NO"?"NOT NULL":"nullable")+' · '+h(c.collation||"")+'</div></td><td><input class="sql-column-alias" data-index="'+i+'" value="'+h(/^[A-Za-z_]/.test(c.name)?c.name.replace(/[^A-Za-z0-9_]/g,"_"):"field_"+i)+'" aria-label="Alias '+h(c.name)+'"></td><td><input class="sql-column-key" type="checkbox" data-index="'+i+'"'+(c.keyKind==="PRI"?" checked":"")+' aria-label="Cursor '+h(c.name)+'"></td></tr>'));
    tableForm+='<div class="grid">'+input("Generated query label","sql-builder-label",catalog.table+" complete capture")+input("Page rows (1–1000)","sql-page-rows",1000,"number",'min="1" max="1000"')+'</div>'+input("Unique-key source, if the full observed primary key is not used","sql-unique-reference","")
      +sqlArea("Typed filters, optional","sql-builder-filters",[],3)+'<p class="muted">Filter example: [{"column":"Status","operator":"=","parameter":"status","value":"Open"}]. Values remain typed parameters. Choose a complete unique, nonnull cursor; native database ordering and collation determine page boundaries.</p><button data-action="sql-build-query" class="primary">Create full cursor query</button>';
  }}
  const preflights=(workspace.sql_job||[]).filter(r=>r.payload.status==="complete"&&r.payload.document.action==="preflight"&&r.payload.document.query_sha256===p.query_sha256);
  return '<div class="panel"><div class="panel-head"><h2>Query and schema review</h2><button data-action="sql-new-query">New explicit query</button></div>'+formSelect("Retained query","sql-query-select",workspace.sql_query||[],query?.id)
    +(query?'<p>'+badge(p.state||"draft")+' '+historyButton(query)+'</p>':"")
    +'<div class="grid">'+input("Query label","sql-query-label",p.label||"")+formSelect("Exact connection revision","sql-query-profile",workspace.sql_profile||[],p.profile?.id||sqlSelection.profile)+'</div>'
    +sqlArea("One native SELECT with explicit aliases","sql-query-text",def.sql,7)
    +'<div class="grid">'+sqlArea("Named parameter declarations","sql-query-parameters",def.parameters,5)+sqlArea("Current typed parameter values","sql-query-values",p.parameters||{},5)+'</div>'
    +'<div class="grid">'+sqlArea("Projected aliases","sql-query-columns",def.columns,3)+sqlArea("Complete ordering key","sql-query-order",def.orderBy,3)+'</div>'
    +sqlArea("Page continuation and total limits","sql-query-pagination",p.pagination||{mode:"single",max_pages:100,max_total_rows:100000,max_total_bytes:50331648},5)
    +'<div class="grid three">'+input("Native rows per page","sql-query-maxrows",def.maxRows||1000,"number",'min="1" max="1000"')+input("Native bytes per page","sql-query-maxbytes",def.maxBytes||917504,"number",'min="1024" max="917504"')+input("Query timeout, milliseconds","sql-query-timeout",def.timeoutMs||10000,"number",'min="50" max="30000"')+'</div>'
    +'<label>Mapping / selection notes<textarea id="sql-query-notes">'+h(p.notes||"")+'</textarea></label><button class="primary" data-action="sql-save-query">Save query revision</button>'
    +'<p class="muted">A saved change resets review. Integer and decimal inputs are exact text; use JSON booleans for boolean parameters. The original driver validates the SELECT and every declared field before execution.</p></div>'
    +'<details'+(!query?" open":"")+'><summary>Create the complete query from an original native catalog</summary>'+formSelect("Complete table-column catalog","sql-builder-catalog",catalogJobs,chosen)+tableForm+'</details>'
    +(query?'<div class="panel"><h2>Run preflight, then review its actual projection</h2>'+sqlNotes(p)+'<div class="actions"><button data-action="sql-preflight" data-id="'+query.id+'" class="primary">Prepare native preflight</button><label><input id="sql-preflight-start" type="checkbox">Start on this host</label></div><div class="spacer"></div>'+formSelect("Completed preflight for this exact query","sql-preflight-result",preflights,p.review?.preflight_job||preflights[0]?.id)
      +'<label>Schema, cursor and source-window review<textarea id="sql-review-note">'+h(p.review?.note||"")+'</textarea></label><button data-action="sql-review-query" data-id="'+query.id+'" data-revision="'+query.revision+'">Accept this observed schema</button>'
      +(p.expected_column_types?'<details><summary>Accepted native types</summary>'+rowsTable(["Alias","Native type","Null","Precision / scale","Encoding"],p.expected_column_types.map(c=>'<tr><td>'+h(c.name)+'</td><td>'+h(c.type)+'</td><td>'+h(c.nullable)+'</td><td>'+h(c.precision)+" / "+h(c.scale)+'</td><td>'+h(c.encoding)+'</td></tr>'))+'</details>':"")
      +(p.review?'<div class="help"><h3>Capture the reviewed selection</h3>'+input("Capture label","sql-capture-label",p.label+" — capture")+'<label><input type="checkbox" id="sql-capture-start">Start on this host</label><button class="primary" data-action="sql-prepare-capture" data-id="'+query.id+'">Prepare complete capture job</button><p class="muted">The job pins these exact query, schema, connection and typed parameter values. Paging continues automatically until the original driver returns an untruncated final page or the declared total limit is reached.</p></div>':"")+'</div>':"");
}
async function sqlJobs(){
  const jobs=workspace.sql_job||[],chosen=sqlSelection.job||jobs[0]?.id;
  const job=chosen?await entity("sql_job",chosen):null;sqlVisibleRecord=job;
  const p=job?.payload||{};sqlSelection.job=job?.id||null;sqlDraftKey="job:"+(job?.id||"none");
  let detail="";
  if(job){
    const native=p.document,detached=(workspace.sql_detached_jobs||[]).includes(job.id);
    const active=["starting","running","queued","cancel_requested"].includes(p.status);
    detail='<div class="panel"><div class="panel-head"><h2>'+h(label(job))+'</h2>'+badge(p.status,p.complete)+'</div>'
      +'<div class="metrics">'+metric(p.progress?.rows||0,"Retained rows")+metric(p.progress?.pages||0,"Committed pages")+metric(p.launch_generation||0,"Local launches")+metric(p.complete?"Complete":"Retained","Collection")+'</div>'
      +sqlNotes(native)+'<p class="source-note">Original native job: '+h(native.job_id)+'<br>Exact job SHA256: '+h(p.job_sha256)+'<br>Source declaration: '+h(native.source_sha256)+'</p>'
      +(detached?'<p>Received operation: automatic native launch is disabled. Inspect the retained original state and choose this host before continuing it.</p>':"")
      +'<div class="actions">'+objectButton(p.package,"Download original native job")+(p.result_bundle?objectButton(p.result_bundle,"Download complete result ZIP"):"")+(p.checkpoint?objectButton(p.checkpoint,"Download retained checkpoint"):"")+historyButton(job)+'</div><div class="spacer"></div>'
      +'<div class="actions"><button data-action="sql-inspect-job" data-id="'+job.id+'">Read current native progress</button>'
      +(!p.complete?'<button data-action="sql-launch-job" data-id="'+job.id+'" data-revision="'+job.revision+'" class="primary">'+(["prepared","queued"].includes(p.status)?"Start original job":"Continue original job")+'</button>':"")
      +(active?'<button data-action="sql-cancel-job" data-id="'+job.id+'">Cancel the original read</button>':"")
      +(p.dataset_id?'<button data-action="sql-open-data" data-id="'+h(p.dataset_id)+'">Open complete data & corrections</button>':"")+'</div>'
      +(p.error||p.observer_error?'<p class="source-note">'+h(p.observer_error||sqlJson(p.error))+'</p>':"")
      +'<details><summary>Original selection, parameters and observations</summary><pre>'+h(sqlJson({action:native.action,query:native.query,table:native.table,parameters:native.parameters,pagination:native.pagination,window:{created:native.created_at,updated:p.native_updated_at},events:p.native_events||[],schema:p.column_types||[]}))+'</pre></details>'
      +'<div class="help"><h3>Receive this same job from its equipped host</h3><label>Original result.bundle.zip<input type="file" id="sql-result-file" accept=".zip"></label><button data-action="sql-import-result" data-id="'+job.id+'">Validate and receive complete result</button><p class="muted">Every returned file, the original job bytes, committed page rows, native types and the generated CSV are compared before adoption. A partial/canceled capture stays retained; only a complete capture becomes a full input dataset.</p></div></div>';
    if(p.catalog){
      const catalog=p.catalog;
      detail+='<div class="panel"><h2>Original native catalog</h2><p>'+h(catalog.serverVersion||"")+' · '+h(catalog.truncated?"Truncated native list":"Complete returned list")+'</p>'
        +(catalog.tables?rowsTable(["Schema-qualified table","Kind",""],catalog.tables.map(t=>'<tr><td>'+h(t.name)+'</td><td>'+h(t.type)+'</td><td><button data-action="sql-table-catalog" data-profile="'+p.profile.id+'" data-table="'+h(t.name)+'">Inspect columns</button></td></tr>')):"")
        +(catalog.columns?rowsTable(["Column","Native type","Nullability","Key","Collation"],catalog.columns.map(c=>'<tr><td>'+h(c.name)+'</td><td>'+h(c.columnType)+'</td><td>'+h(c.nullable)+'</td><td>'+h(c.keyKind)+'</td><td>'+h(c.collation||"")+'</td></tr>'))+'<div class="spacer"></div><button data-action="sql-query-from-catalog" data-id="'+job.id+'" class="primary">Build reviewed cursor query</button>':"")+'</div>';
    }
  }
  return '<div class="panel"><div class="panel-head"><h2>Original native jobs</h2><span class="muted">Progress refreshes while this view is open.</span></div>'
    +formSelect("Job","sql-job-select",jobs,chosen)+(jobs.length?rowsTable(["Job","Action","State","Rows / pages",""],jobs.map(r=>'<tr><td>'+h(label(r))+'</td><td>'+h(r.payload.document.action)+'</td><td>'+badge(r.payload.status)+'</td><td>'+h(r.payload.progress?.rows||0)+' / '+h(r.payload.progress?.pages||0)+'</td><td><button data-action="sql-open-job" data-id="'+r.id+'">Open</button></td></tr>')):empty("No prepared job","Inspect a connection catalog or save and review a query."))+'</div>'+detail;
}
async function sqlMappings(){
  const captures=(workspace.sql_capture||[]).filter(r=>r.payload.complete);
  const captureId=sqlSelection.capture||captures[0]?.id,planId=sqlSelection.plan||workspace.plan[0]?.id;
  sqlMappingCapture=captureId?await entity("sql_capture",captureId):null;
  sqlMappingPlan=planId?await entity("plan",planId):null;
  const tables=sqlMappingPlan?.payload.project.tables||[],tableName=sqlSelection.table||tables[0]?.name;
  const table=tables.find(t=>t.name===tableName);sqlSelection.table=table?.name||null;
  sqlDraftKey="mapping:"+captureId+":"+planId+":"+(sqlMappingPlan?.revision||0)+":"+tableName;
  let fields="";
  if(table&&sqlMappingCapture){
    const types=Object.fromEntries(sqlMappingCapture.payload.column_types.map(c=>[c.name,c]));
    fields=rowsTable(["Model field / type","Original captured SQL alias","Native information"],table.columns.map((c,i)=>{
      const match=sqlMappingCapture.payload.columns.find(n=>n===c.name)||"";
      return '<tr><td><strong>'+h(c.name)+'</strong><div class="muted">'+h(c.data_type||c.dataType||c.type||"")+'</div></td><td><select class="sql-binding-field" data-target="'+h(c.name)+'"><option value="">Choose…</option>'+sqlMappingCapture.payload.columns.map(n=>'<option value="'+h(n)+'"'+(n===match?" selected":"")+'>'+h(n)+'</option>').join("")+'</select></td><td>'+h(match?types[match]?.type:"Review the complete native type list below")+'</td></tr>';
    }));
  }
  const mappings=workspace.sql_mapping||[];
  return '<div class="panel"><h2>Bind complete native captures to the original model</h2><div class="grid">'+formSelect("Complete SQL capture","sql-mapping-capture",captures,captureId)+formSelect("Migration plan","sql-mapping-plan",workspace.plan,planId)+'</div>'+sqlSelect("Actual model table","sql-mapping-table",tables.map(t=>({value:t.name,label:t.name})),tableName)+fields
    +(fields?'<label>Precision, schema and source-selection review<textarea id="sql-mapping-note"></textarea></label><button data-action="sql-save-mapping" class="primary">Retain reviewed field mapping</button><p class="muted">Every model field requires an exact captured alias. Applying the mapping creates a plan revision with the complete mapped CSV, the original NULL marker, native types, parameters and capture-window lineage. Existing baselines and source files remain retained.</p>':empty("Choose a capture and migration plan","Complete a reviewed SQL capture and retain an original report/model source first."))
    +(sqlMappingCapture?'<details><summary>Original native types and capture window</summary><pre>'+h(sqlJson({types:sqlMappingCapture.payload.column_types,parameters:sqlMappingCapture.payload.parameters,consistency:sqlMappingCapture.payload.consistency,captured_at:sqlMappingCapture.payload.captured_at}))+'</pre></details>':"")+'</div>'
    +'<div class="panel"><h2>Reviewed mappings</h2>'+(mappings.length?rowsTable(["Mapping","Review","Original plan",""],mappings.map(r=>'<tr><td>'+h(label(r))+'</td><td>'+h(r.payload.review_note)+'</td><td>'+h(r.payload.plan.id)+' · r'+h(r.payload.plan.revision)+'</td><td><button data-action="sql-apply-mapping" data-id="'+r.id+'">Apply as plan revision</button> '+inspectButton(r)+'</td></tr>')):empty("No reviewed mapping","Save the complete source-to-model mapping above."))+'</div>';
}
async function sqlReceiving(){
  const receipts=workspace.sql_receipt||[],chosen=sqlSelection.receipt||receipts[0]?.id;
  const receipt=chosen?await entity("sql_receipt",chosen):null;sqlVisibleRecord=receipt;
  sqlDraftKey="receiving:"+(receipt?.id||"new")+":"+(receipt?.revision||0);
  let receiving="";
  if(receipt){const p=receipt.payload;
    receiving='<div class="panel"><h2>'+h(label(receipt))+'</h2><p>'+badge(p.status)+' · '+h(p.records)+' records · '+h(p.revisions)+' revisions · '+h(p.objects)+' original objects</p><p class="source-note">Original workspace '+h(p.original_workspace_id)+'<br>Bundle SHA256 '+h(p.bundle_sha256)+'</p>'
      +rowsTable(["Record","Incoming / current","Disposition"],p.plan.rows.map(r=>'<tr><td>'+h(r.kind)+' · '+h(r.id)+'</td><td>'+h(r.incoming_revision)+' / '+h(r.current_revision)+'</td><td>'+badge(r.status)+'</td></tr>'))
      +(p.status==="preview"?'<label>Receiving decision<select id="sql-receive-choice">'+(p.plan.conflicts?'<option value="keep_both">Keep local work and retain the complete incoming branch separately</option>':'<option value="preserve">Preserve original IDs and advance matching source history</option>')+'</select></label><label>Receiving owner / reason<textarea id="sql-receive-reason"></textarea></label><button data-action="sql-adopt-receipt" data-id="'+receipt.id+'" data-revision="'+receipt.revision+'" data-plan="'+h(p.plan.sha256)+'" class="primary">Adopt complete workstream</button>':'<p>Accepted. Repeated receipt of these same bytes reopens this original receipt. Native database work was not started.</p>')
      +'<div class="spacer"></div>'+objectButton(p.bundle,"Download original receiving bundle")+'</div>';
  }
  return '<div class="panel"><h2>Deliver the complete SQL/report workstream</h2>'+input("Handoff label","sql-handoff-label","SQL Server migration and receiving")
    +'<label>Receiving owner and operating notes<textarea id="sql-handoff-notes"></textarea></label><button data-action="sql-build-handoff" class="primary">Build full workstream handoff</button><p class="muted">Includes original profiles, query/schema/catalog history, prepared jobs, committed native page results, complete/partial capture state, model mappings, original report sources, comparisons and support records. Access tokens, password values and previous encrypted backups are excluded. This is a private operating handoff.</p>'
    +(workspace.sql_delivery||[]).map(r=>'<p>'+h(label(r))+' · '+h(r.payload.records)+' records / '+h(r.payload.revisions)+' revisions '+objectButton(r.payload.package,"Download handoff")+'</p>').join("")+'</div>'
    +'<div class="panel"><h2>Receive and continue original work</h2><label>Complete workstream ZIP<input id="sql-receive-file" type="file" accept=".zip"></label><button data-action="sql-preview-receipt" class="primary">Preview exact source and conflicts</button><p class="muted">All files, revision sequences and native result identities are checked before adoption. Conflicting work remains available as a separate complete branch; imported jobs wait for an explicit continuation decision.</p>'+formSelect("Prior receiving operation","sql-receipt-select",receipts,chosen)+'</div>'+receiving
    +'<div class="panel"><h2>Encrypted full workspace recovery</h2><p>The existing Handoff & recovery screen includes SQL profile/query history, native result objects and committed checkpoints of unfinished captures. Restore into a new directory to reopen the same business IDs; the browser key is renewed.</p><button data-tab="delivery">Open encrypted backup</button></div>';
}
async function sqlServerView(){
  const builders={connections:sqlConnections,queries:sqlQueries,jobs:sqlJobs,mapping:sqlMappings,receiving:sqlReceiving};
  return sqlButtons()+await builders[sqlSelection.section]();
}
async function sqlPick(section,field,id){sqlRemember();sqlSelection.section=section;if(field)sqlSelection[field]=id;sqlEditing=false;await render();}
async function sqlServerAction(action,button){
  const id=button.dataset.id,revision=Number(button.dataset.revision);
  if(action==="sql-section")return sqlPick(button.dataset.section);
  if(action==="sql-new-profile"){sqlForget();sqlSelection.profile=null;return render();}
  if(action==="sql-new-query"){sqlForget();sqlSelection.query=null;return render();}
  if(action==="sql-save-profile"){
    const old=sqlVisibleRecord,ca=$("sql-ca").files[0],file=ca?await filePayload(ca):null;
    const body={...(old?{id:old.id,expected:old.revision}:{}),label:value("sql-profile-label"),
      connection:{host:value("sql-host"),port:Number(value("sql-port")),database:value("sql-database"),user:value("sql-user"),passwordEnv:value("sql-password-env"),tls:value("sql-tls")},
      description:value("sql-profile-notes"),...(file?{ca_base64:file.base64}:{}),remove_ca:$("sql-remove-ca")?.checked||false};
    sqlForget();const saved=await act("sql.profile.save",body);sqlSelection.profile=saved.id;return render();
  }
  if(action==="sql-catalog"||action==="sql-table-catalog"){
    const body={profile_id:action==="sql-catalog"?value("sql-catalog-profile"):button.dataset.profile,action:"catalog",
      table:action==="sql-catalog"?(value("sql-catalog-table")||undefined):button.dataset.table,
      start:action==="sql-catalog"?$("sql-catalog-start").checked:false};
    sqlForget();const saved=await act("sql.job.prepare",body);return sqlPick("jobs","job",saved.id);
  }
  if(action==="sql-query-from-catalog"){sqlSelection.catalog=id;return sqlPick("queries","query",null);}
  if(action==="sql-build-query"){
    if(!sqlBuilderCatalog)throw new Error("Select one complete native table-column catalog.");
    const columns=[],keys=[];
    for(const[i,c]of sqlBuilderCatalog.catalog.columns.entries()){
      if(document.querySelector('.sql-column-use[data-index="'+i+'"]').checked)columns.push({source:c.name,alias:document.querySelector('.sql-column-alias[data-index="'+i+'"]').value});
      if(document.querySelector('.sql-column-key[data-index="'+i+'"]').checked)keys.push(c.name);
    }
    const body={catalog_job_id:sqlBuilderCatalog.job.id,label:value("sql-builder-label"),columns,key_columns:keys,
      uniqueness_reference:value("sql-unique-reference"),page_rows:Number(value("sql-page-rows")),filters:parse("sql-builder-filters",[])};
    sqlForget();const saved=await act("sql.query.from_table",body);sqlSelection.query=saved.id;return render();
  }
  if(action==="sql-save-query"){
    const parameters=parse("sql-query-parameters",{}),old=sqlVisibleRecord;
    const body={...(old?{id:old.id,expected:old.revision}:{}),label:value("sql-query-label"),profile_id:value("sql-query-profile"),
      definition:{sql:value("sql-query-text"),parameters,parameterOrder:Object.keys(parameters),columns:parse("sql-query-columns",[]),orderBy:parse("sql-query-order",[]),
      maxRows:Number(value("sql-query-maxrows")),maxBytes:Number(value("sql-query-maxbytes")),timeoutMs:Number(value("sql-query-timeout"))},
      pagination:parse("sql-query-pagination",{}),parameters:parse("sql-query-values",{}),notes:value("sql-query-notes"),
      catalog:old?.payload.catalog,source_columns:old?.payload.source_columns||[]};
    sqlForget();const saved=await act("sql.query.save",body);sqlSelection.query=saved.id;return render();
  }
  if(action==="sql-preflight"||action==="sql-prepare-capture"){
    const kind=action==="sql-preflight"?"preflight":"capture";
    const body={query_id:id,action:kind,start:$("sql-"+kind+"-start").checked,...(kind==="capture"?{label:value("sql-capture-label")}: {})};
    sqlForget();const saved=await act("sql.job.prepare",body);return sqlPick("jobs","job",saved.id);
  }
  if(action==="sql-review-query"){const body={id,expected:revision,preflight_job_id:value("sql-preflight-result"),note:value("sql-review-note")};sqlForget();const saved=await act("sql.query.review",body);sqlSelection.query=saved.id;return render();}
  if(action==="sql-open-job")return sqlPick("jobs","job",id);
  if(action==="sql-inspect-job"){sqlForget();return act("sql.job.inspect",{id});}
  if(action==="sql-launch-job"){sqlForget();return act("sql.job.launch",{id,expected:revision});}
  if(action==="sql-cancel-job"){sqlForget();return act("sql.job.cancel",{id,note:"Operator requested cancellation from the original job screen."});}
  if(action==="sql-import-result"){const body={id,...await filePayload($("sql-result-file").files[0])};sqlForget();return act("sql.result.import",body);}
  if(action==="sql-open-data"){selection.data=id;dataOffset=0;dataSearch="";return changeTab("data");}
  if(action==="sql-save-mapping"){
    if(!sqlMappingPlan||!sqlMappingCapture)throw new Error("Select a complete capture and a retained model.");
    const body={capture_id:sqlMappingCapture.id,capture_revision:sqlMappingCapture.revision,plan_id:sqlMappingPlan.id,plan_revision:sqlMappingPlan.revision,table:value("sql-mapping-table"),
      fields:Array.from(document.querySelectorAll(".sql-binding-field")).map(el=>({target:el.dataset.target,source:el.value})),review_note:value("sql-mapping-note")};
    sqlForget();return act("sql.mapping.save",body);
  }
  if(action==="sql-apply-mapping"){sqlForget();const saved=await act("sql.mapping.apply",{id});selection.plan=saved.id;return changeTab("migration");}
  if(action==="sql-build-handoff"){const body={label:value("sql-handoff-label"),notes:value("sql-handoff-notes")};sqlForget();return act("sql.handoff",body);}
  if(action==="sql-preview-receipt"){const body=await filePayload($("sql-receive-file").files[0]);sqlForget();const saved=await act("sql.receive.preview",body);sqlSelection.receipt=saved.id;return render();}
  if(action==="sql-adopt-receipt"){const body={id,expected:revision,plan_sha256:button.dataset.plan,choice:value("sql-receive-choice"),reason:value("sql-receive-reason")};sqlForget();return act("sql.receive.apply",body);}
}
document.addEventListener("input",event=>{if(tab==="sql"&&event.target.closest("#content")){sqlEditing=true;sqlRemember();}});
document.addEventListener("change",event=>run(async()=>{
  if(tab!=="sql")return;
  const routes={"sql-profile-select":["connections","profile"],"sql-query-select":["queries","query"],"sql-builder-catalog":["queries","catalog"],
    "sql-job-select":["jobs","job"],"sql-mapping-capture":["mapping","capture"],"sql-mapping-plan":["mapping","plan"],
    "sql-mapping-table":["mapping","table"],"sql-receipt-select":["receiving","receipt"]};
  const route=routes[event.target.id];if(route){if(event.target.id==="sql-mapping-plan")sqlSelection.table=null;await sqlPick(route[0],route[1],event.target.value||null);}
  else{sqlEditing=true;sqlRemember();}
}));
setInterval(async()=>{
  if(typeof workspace==="undefined"||tab!=="sql"||sqlSelection.section!=="jobs"||busy||sqlRefreshBusy||sqlEditing||$("sql-result-file")?.files.length)return;
  sqlRefreshBusy=true;try{
    const next=await request("/api/state");
    const before=(workspace.sql_job||[]).map(r=>r.id+":"+r.revision).join(",");
    const after=(next.sql_job||[]).map(r=>r.id+":"+r.revision).join(",");
    if(before!==after){workspace=next;await render();}
  }catch{/* Keep the exact original view and allow its existing request to finish. */}
  finally{sqlRefreshBusy=false;}
},3000);

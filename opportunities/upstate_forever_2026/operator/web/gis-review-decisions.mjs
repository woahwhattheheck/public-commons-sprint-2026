/** Human review of exact original-source vector findings using the native queue. */
export function attachGISReviewDecisions({getState,api,refreshState,showTask,toast}) {
  let root=null,workspace=null,catalogue=null,data=null,draft=null,selected="",page=0;
  let query="",finding="",disposition="",viewVersion=0,featureVersion=0,importVersion=0,request=null;
  let pending=null,upload=null,detail=null,busy=false,message="",loadError="",taskSignature="";
  const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const clone=v=>JSON.parse(JSON.stringify(v));
  const stable=v=>v&&typeof v==="object"?(Array.isArray(v)?"["+v.map(stable).join(",")+"]":"{"+Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+stable(v[k])).join(",")+"}"):JSON.stringify(v);
  const labels={unreviewed:"Not reviewed",accepted:"Accepted",follow_up:"Follow up",rejected:"Rejected"};
  const pretty=n=>Number(n).toLocaleString(), prefix="upstate-gis-decisions:";
  const read=key=>{try{return JSON.parse(localStorage.getItem(prefix+key)||"null");}catch{return null;}};
  function write(key,value){try{localStorage.setItem(prefix+key,JSON.stringify(value));return true;}catch{return false;}}
  function current(w=workspace){return !!root&&workspace===w&&getState()?.workspace_key===w;}
  const draftKey=()=>workspace+":"+data?.review.id+":"+(data?.snapshot?.id||"new");
  function retain(){
    if(data&&draft)write(draftKey(),{comparison_sha256:data.comparison_sha256,draft,selected,query,finding,disposition,page});
    if(workspace&&data)write(workspace+":selection",{review_id:data.review.id,snapshot_id:data.snapshot?.id||""});
  }
  function status(text,error=false){message=error?"":text;loadError=error?text:"";if(root){
    const n=root.querySelector("[data-review-message]");if(n)n.textContent=text;n?.setAttribute("role",error?"alert":"status");
  }}
  function decision(key){return draft?.decisions[key]||{key,disposition:"unreviewed",note:""};}
  function setDecision(key,field,value){
    const row={...decision(key),[field]:value};draft.decisions[key]=row;retain();
    const badge=root?.querySelector('[data-choice-badge="'+key+'"]');if(badge)badge.textContent=labels[row.disposition];
  }
  const identity=row=>row.comparison.status==="layer_definition"?"Layer schema and CRS":row.comparison.source_id===null?"Missing identity":String(row.comparison.source_id);
  function options(value,all){return Object.entries(all).map(([key,label])=>'<option value="'+esc(key)+'" '+(key===value?"selected":"")+'>'+esc(label)+'</option>').join("");}
  function rows(){
    const q=query.toLowerCase();
    return (data?.rows||[]).filter(row=>(!finding||row.comparison.status===finding)&&
      (!disposition||decision(row.key).disposition===disposition)&&
      (!q||(row.layer_title+" "+identity(row)+" "+JSON.stringify(row.comparison)+" "+decision(row.key).note).toLowerCase().includes(q)));
  }
  function operationKey(op){return op.workspace+":operation:"+op.payload.review_id;}
  function rememberOperation(op=pending){if(op)write(operationKey(op),op);}
  function payload(){
    if(!data||!draft)throw Error("Open an original vector review.");
    if(!draft.title.trim())throw Error("Enter a title for this review revision.");
    if(Object.values(draft.decisions).some(row=>row.disposition!=="unreviewed")&&!draft.reviewer.trim())throw Error("Enter a reviewer label for recorded review dispositions.");
    return {review_id:data.review.id,previous_id:data.snapshot?.id||null,title:draft.title,reviewer:draft.reviewer,
      decisions:Object.values(draft.decisions).filter(r=>r.disposition!=="unreviewed"||r.note).sort((a,b)=>a.key.localeCompare(b.key))};
  }
  function disabled(){return busy||!!(pending&&!pending.completed_snapshot&&!pending.failed);}
  function toolbar(){
    const sourceOptions=(catalogue?.reviews||[]).map(row=>'<option value="'+esc(row.id)+'" '+(data?.review.id===row.id?"selected":"")+'>'+esc(row.title)+'</option>').join("");
    const revisions=(data?.revisions||[]).map(row=>'<option value="'+esc(row.id)+'" '+(data?.snapshot?.id===row.id?"selected":"")+'>'+esc(row.title)+" · "+esc(row.reviewer||"No reviewer label")+" · "+esc(row.id.slice(0,10))+'</option>').join("");
    return '<header><h1>Source review decisions</h1><p>Inspect the retained original and returned GIS features. Save review notes and dispositions as an independent, reopenable revision.</p></header>'+
      '<div class="grd-controls"><label>Original vector comparison<select data-review-select><option value="">Choose a saved comparison</option>'+sourceOptions+'</select></label>'+
      '<label>Saved decision revision<select data-revision-select '+(!data?"disabled":"")+'><option value="">New review draft</option>'+revisions+'</select></label>'+
      '<button type="button" data-refresh>Refresh saved reviews</button></div><p data-review-message role="'+(loadError?"alert":"status")+'">'+esc(loadError||message)+'</p>';
  }
  function downloads(){
    const files=data?.snapshot?._downloads||[];
    if(!files.length)return "";
    const names={"review-decisions.zip":"Complete review ZIP","decisions.json":"Editable decision JSON",
      "decisions.csv":"Complete decision CSV","comparison.json":"Complete original comparison","review.html":"Open saved report"};
    return '<section class="grd-saved"><h2>Saved review</h2><p>'+esc(data.snapshot.title)+' · '+esc(data.snapshot.reviewer||"Reviewer label not supplied")+'</p><nav aria-label="Saved review downloads">'+
      files.filter(f=>names[f.filename]).map(f=>'<a href="'+esc(f.url)+'?download='+(f.filename==="review.html"?"0":"1")+'" '+(f.filename==="review.html"?'target="_blank" rel="noopener"':"")+'>'+esc(names[f.filename])+'</a>').join("")+
      '</nav><details><summary>Revision and original source identities</summary><pre>'+esc(JSON.stringify({snapshot_id:data.snapshot.id,previous_id:data.snapshot.previous_id,
        comparison_sha256:data.comparison_sha256,review_id:data.review.id,source_selection:data.review.selection},null,2))+'</pre></details></section>';
  }
  function table(){
    const filtered=rows(),total=filtered.length;page=Math.min(page,Math.max(0,Math.ceil(total/50)-1));
    const visible=filtered.slice(page*50,page*50+50);
    const statuses=Object.fromEntries([...new Set(data.rows.map(row=>row.comparison.status))].sort().map(s=>[s,s.replaceAll("_"," ")]));
    return '<section><div class="grd-filters"><label>Search features or notes<input data-search value="'+esc(query)+'" type="search"></label>'+
      '<label>Finding<select data-finding><option value="">All findings</option>'+options(finding,statuses)+'</select></label>'+
      '<label>Decision<select data-disposition><option value="">All decisions</option>'+options(disposition,labels)+'</select></label></div>'+
      '<p>'+pretty(total)+' matching rows · '+pretty(data.rows.length)+' complete feature and layer findings</p><div class="grd-scroll"><table><thead><tr><th>Layer / retained identity</th><th>Finding</th><th>Decision</th><th>Review</th></tr></thead><tbody>'+
      visible.map(row=>'<tr '+(selected===row.key?'class="grd-selected"':"")+'><td>'+esc(row.layer_title)+'<br><code>'+esc(identity(row))+'</code></td><td>'+esc(row.comparison.status.replaceAll("_"," "))+
        '</td><td data-choice-badge="'+row.key+'">'+esc(labels[decision(row.key).disposition])+'</td><td><button type="button" data-open-feature="'+row.key+'">Inspect and review</button></td></tr>').join("")+
      (!visible.length?'<tr><td colspan="4">No findings match these filters.</td></tr>':"")+'</tbody></table></div>'+
      '<div class="grd-pages"><button data-page="-1" '+(!page?"disabled":"")+'>Previous</button><span>Page '+(page+1)+' of '+Math.max(1,Math.ceil(total/50))+'</span><button data-page="1" '+((page+1)*50>=total?"disabled":"")+'>Next</button></div></section>';
  }
  function selectedPanel(){
    const row=data.rows.find(r=>r.key===selected);if(!row)return '<section class="grd-detail"><h2>Inspect a feature</h2><p>Choose a finding to see original and returned values, source-coordinate outlines and its saved review note.</p></section>';
    const choice=decision(row.key),disabledText=disabled()?"disabled":"";
    const definition=row.comparison.status==="layer_definition";
    return '<section class="grd-detail" aria-label="Selected original finding"><h2>'+esc(identity(row))+'</h2><p>'+esc(row.layer_title)+' · '+esc(row.comparison.status.replaceAll("_"," "))+'</p>'+
      '<div class="grd-decision"><label>Review disposition<select data-choice '+disabledText+'>'+options(choice.disposition,labels)+'</select></label>'+
      '<label>Review note<textarea data-note rows="4" maxlength="16000" '+disabledText+'>'+esc(choice.note)+'</textarea></label></div>'+
      '<p>Decisions preserve the original findings and do not edit or adopt source geometry.</p>'+
      '<div data-feature-detail>'+ (definition?'<h3>Layer schema and CRS</h3><pre>'+esc(JSON.stringify(row.comparison,null,2))+'</pre>':
      detail?.key===selected?renderFeature(detail):'<p>Reading the selected original features…</p>')+'</div>'+
      '<details><summary>Complete retained finding</summary><pre>'+esc(JSON.stringify(row.comparison,null,2))+'</pre></details></section>';
  }
  function render(){
    if(!root)return;
    root.innerHTML='<div class="grd-workspace">'+toolbar()+
      (!catalogue?'<p>Opening the retained review catalogue…</p>':!catalogue.reviews.length?'<section><h2>No original vector comparisons yet</h2><p>Open a received project in Editable GIS projects and run its original-source vector review. Its complete comparison will appear here.</p></section>':
      !data?'<p>Choose a retained comparison to start or reopen a review.</p>':
      '<section class="grd-edit"><div class="grd-controls"><label>Review title<input data-title value="'+esc(draft.title)+'" maxlength="300" '+(disabled()?"disabled":"")+'></label>'+
      '<label>Reviewer label<input data-reviewer value="'+esc(draft.reviewer)+'" maxlength="300" '+(disabled()?"disabled":"")+'></label></div>'+
      '<div class="grd-actions"><button data-save '+(disabled()?"disabled":"")+'>Save review revision</button><button data-check-task '+(!pending?"disabled":"")+'>Reopen saved operation</button></div>'+
      '<p>A reviewer label is required for recorded dispositions. Draft edits stay in this browser. Save a revision to retain them in the original Workspace and include them in exports.</p></section>'+
      downloads()+table()+selectedPanel()+
      '<section><h2>Receive review decisions</h2><p>Choose exported editable JSON or the complete review ZIP. It must bind the same original comparison. Existing saved revisions and this browser draft remain available.</p>'+
      '<input data-import-file type="file" accept=".json,.zip,application/json,application/zip" '+(disabled()?"disabled":"")+'>'+
      (upload?'<p>'+esc(upload.preview.title)+' · '+pretty(upload.preview.counts.total)+' findings · '+pretty(upload.preview.counts.notes)+' notes</p><button data-import '+(disabled()?"disabled":"")+'>Import as a saved revision</button>':"")+'</section>')+'</div>';
    bind();
  }
  function bind(){
    root.querySelector("[data-review-select]")?.addEventListener("change",e=>{retain();void open(e.target.value,"");});
    root.querySelector("[data-revision-select]")?.addEventListener("change",e=>{retain();void open(data.review.id,e.target.value);});
    root.querySelector("[data-refresh]")?.addEventListener("click",()=>void catalogueLoad(true));
    for(const [selector,field] of [["[data-title]","title"],["[data-reviewer]","reviewer"]])
      root.querySelector(selector)?.addEventListener("input",e=>{draft[field]=e.target.value;retain();});
    root.querySelector("[data-search]")?.addEventListener("input",e=>{query=e.target.value;page=0;retain();renderResults("data-search");});
    root.querySelector("[data-finding]")?.addEventListener("change",e=>{finding=e.target.value;page=0;retain();render();});
    root.querySelector("[data-disposition]")?.addEventListener("change",e=>{disposition=e.target.value;page=0;retain();render();});
    for(const button of root.querySelectorAll("[data-page]"))button.addEventListener("click",()=>{page+=Number(button.dataset.page);retain();render();});
    for(const button of root.querySelectorAll("[data-open-feature]"))button.addEventListener("click",()=>{selected=button.dataset.openFeature;detail=null;retain();render();void featureLoad();});
    root.querySelector("[data-choice]")?.addEventListener("change",e=>setDecision(selected,"disposition",e.target.value));
    root.querySelector("[data-note]")?.addEventListener("input",e=>setDecision(selected,"note",e.target.value));
    root.querySelector("[data-save]")?.addEventListener("click",()=>{try{void submit("gis.review.decisions.save",payload()).catch(e=>status(e.message,true));}catch(e){status(e.message,true);}});
    root.querySelector("[data-check-task]")?.addEventListener("click",()=>void reconcile(true).catch(e=>status(e.message,true)));
    root.querySelector("[data-import-file]")?.addEventListener("change",e=>void prepareImport(e.target.files[0]));
    root.querySelector("[data-import]")?.addEventListener("click",()=>void receiveImport());
  }
  function renderResults(focus){
    const element=root?.querySelector("["+focus+"]"),position=element?.selectionStart;
    render();const next=root?.querySelector("["+focus+"]");next?.focus();if(position!=null)next?.setSelectionRange(position,position);
  }
  async function catalogueLoad(force=false){
    const w=getState()?.workspace_key;if(!root||!w)return;
    if(workspace!==w){retain();workspace=w;catalogue=data=draft=detail=upload=pending=null;selected="";page=0;query=finding=disposition="";message=loadError="";busy=false;viewVersion++;featureVersion++;importVersion++;}
    const token=++viewVersion,node=root;request?.abort();request=new AbortController();
    if(!catalogue)render();
    try{
      const value=await api("/api/gis-review-decisions/catalog?"+new URLSearchParams({workspace:w}),{signal:request.signal});
      if(!current(w)||root!==node||token!==viewVersion)return;
      if(value.workspace_key!==w)throw Error("The catalogue belongs to another Workspace.");
      catalogue=value;
      if(data){
        data.revisions=value.revisions.filter(r=>r.review_id===data.review.id);render();
      }else{
        const saved=read(w+":selection"),first=saved&&value.reviews.some(r=>r.id===saved.review_id)?saved:{review_id:value.reviews[0]?.id,snapshot_id:""};
        if(first.review_id)await open(first.review_id,first.snapshot_id);else render();
      }
    }catch(e){if(e.name!=="AbortError"&&current(w)&&token===viewVersion){status(e.message,true);render();}}
  }
  async function open(reviewId,snapshotId=""){
    retain();const w=workspace,node=root,token=++viewVersion;featureVersion++;importVersion++;detail=upload=null;data=draft=pending=null;busy=false;
    if(!reviewId){data=draft=null;render();return;}
    message="Opening the exact retained comparison…";loadError="";render();
    try{
      const value=await api("/api/gis-review-decisions/view?"+new URLSearchParams({workspace:w,review_id:reviewId,snapshot_id:snapshotId}));
      if(!current(w)||root!==node||token!==viewVersion)return;
      if(value.workspace_key!==w||value.review.id!==reviewId||(value.snapshot?.id||"")!==snapshotId)throw Error("The review response changed its original selection.");
      data=value;
      draft={title:value.snapshot?.title||value.review.title+" · review",reviewer:value.snapshot?.reviewer||"",
             decisions:Object.fromEntries((value.snapshot?.decisions||[]).map(r=>[r.key,clone(r)]))};
      const cached=read(draftKey());
      if(cached?.comparison_sha256===value.comparison_sha256 && typeof cached.draft?.title==="string" && typeof cached.draft?.reviewer==="string" && cached.draft?.decisions && !Array.isArray(cached.draft.decisions) && Object.entries(cached.draft.decisions).every(([k,r])=>r && r.key===k && value.rows.some(row=>row.key===k) && Object.hasOwn(labels,r.disposition) && typeof r.note==="string")){
        draft=cached.draft;selected=cached.selected||"";query=cached.query||"";finding=cached.finding||"";disposition=cached.disposition||"";page=Number.isInteger(cached.page)&&cached.page>=0?cached.page:0;
      }else{selected="";query=finding=disposition="";page=0;}
      const valid=new Set(data.rows.map(r=>r.key));
      if(Object.keys(draft.decisions).some(key=>!valid.has(key)))throw Error("The local draft belongs to another comparison.");
      if(!valid.has(selected))selected=data.rows[0]?.key||"";
      pending=read(w+":operation:"+reviewId);
      if(pending&&pending.workspace!==w)pending=null;
      retain();message="Original source comparison opened.";loadError="";render();
      if(selected)void featureLoad();
      if(pending&&!pending.completed_snapshot)void reconcile().catch(e=>status(e.message,true));
    }catch(e){if(current(w)&&root===node&&token===viewVersion){status(e.message,true);render();}}
  }
  async function featureLoad(){
    const row=data?.rows.find(r=>r.key===selected);if(!row||row.comparison.status==="layer_definition")return;
    const w=workspace,id=data.review.id,key=selected,token=++featureVersion,node=root;
    try{
      const value=await api("/api/gis-review-decisions/feature?"+new URLSearchParams({workspace:w,review_id:id,key}));
      if(!current(w)||root!==node||data?.review.id!==id||selected!==key||token!==featureVersion)return;
      if(value.workspace_key!==w||value.key!==key)throw Error("The selected native feature changed identity.");
      detail=value;const target=root.querySelector("[data-feature-detail]");if(target)target.innerHTML=renderFeature(value);
    }catch(e){if(current(w)&&data?.review.id===id&&selected===key&&token===featureVersion){const target=root.querySelector("[data-feature-detail]");if(target)target.textContent=e.message;}}
  }
  function renderFeature(value){
    function bounds(features){
      let box=null,invalid=false;
      function visit(node){
        if(!Array.isArray(node)){invalid=true;return;}
        if(node.length>=2 && !Array.isArray(node[0])){
          if(!Number.isFinite(node[0])||!Number.isFinite(node[1])){invalid=true;return;}
          if(!box)box=[node[0],node[1],node[0],node[1]];
          else{box[0]=Math.min(box[0],node[0]);box[1]=Math.min(box[1],node[1]);box[2]=Math.max(box[2],node[0]);box[3]=Math.max(box[3],node[1]);}
        }else node.forEach(visit);
      }
      function geometry(g){if(!g)return;if(g.type==="GeometryCollection")(g.geometries||[]).forEach(geometry);else visit(g.coordinates);}
      features.forEach(f=>geometry(f.geometry));
      if(box&&(!Number.isFinite(box[2]-box[0])||!Number.isFinite(box[3]-box[1])))invalid=true;
      return {box,invalid};
    }
    const extent=bounds([...value.original,...value.working]);
    function sketch(features,common){
      const own=bounds(features),box=common?.box||own.box;
      if(own.invalid || common?.invalid)return "<p>The retained coordinates cannot be drawn as finite XY values. Their original geometry and comparison remain unchanged.</p>";
      if(!box)return "<p>No drawable native XY geometry.</p>";
      const width=Math.max(box[2]-box[0],1e-12),height=Math.max(box[3]-box[1],1e-12),scale=Math.min(340/width,190/height);
      const point=p=>[20+(p[0]-box[0])*scale,210-(p[1]-box[1])*scale];
      function path(g){
        if(!g)return "";if(g.type==="GeometryCollection")return (g.geometries||[]).map(path).join("");
        const line=c=>c.map((p,i)=>(i?"L":"M")+point(p).join(",")).join(" ");
        if(g.type==="Polygon")return '<path d="'+g.coordinates.map(r=>line(r)+" Z").join(" ")+'" fill-rule="evenodd"/>';
        if(g.type==="MultiPolygon")return g.coordinates.map(c=>path({type:"Polygon",coordinates:c})).join("");
        if(g.type==="LineString")return '<path d="'+line(g.coordinates)+'" fill="none"/>';
        if(g.type==="MultiLineString")return g.coordinates.map(c=>path({type:"LineString",coordinates:c})).join("");
        if(g.type==="Point"){const p=g.coordinates;if(!Number.isFinite(p?.[0])||!Number.isFinite(p?.[1]))return "";const q=point(p);return '<circle cx="'+q[0]+'" cy="'+q[1]+'" r="3"/>';}
        if(g.type==="MultiPoint")return g.coordinates.map(c=>path({type:"Point",coordinates:c})).join("");
        return "";
      }
      return '<svg viewBox="0 0 380 230" role="img" aria-label="Retained source XY geometry outline">'+features.map(f=>path(f.geometry)).join("")+'</svg>';
    }
    function pane(name,features,crs){
      return '<div><h3>'+name+'</h3><p><code>'+esc(crs)+'</code></p>'+sketch(features,value.crs.equivalent?extent:null)+
        features.map(f=>'<details open><summary>Native feature '+esc(f.feature_id)+'</summary><div class="grd-scroll"><table><thead><tr><th>Field name</th><th>Literal value</th></tr></thead><tbody>'+
          Object.entries(f.properties).map(([k,v])=>'<tr><td><code>'+esc(k)+'</code></td><td><code>'+esc(JSON.stringify(v))+'</code></td></tr>').join("")+'</tbody></table></div></details>').join("")+
        (!features.length?"<p>No paired native feature on this side.</p>":"")+'</div>';
    }
    return '<p>'+(value.crs.equivalent?"Both XY outlines use the same retained coordinate extent.":"The declared CRS differ; each XY outline uses its own native extent. No coordinate transformation is applied.")+
      ' Z/M comparisons retain their explicit status in the original finding below.</p><div class="grd-feature-panes">'+
      pane("Original",value.original,value.crs.original)+pane("Returned working edition",value.working,value.crs.working)+'</div>'+
      '<details><summary>Original-to-working field mapping</summary><pre>'+esc(JSON.stringify(value.source_field_map,null,2))+'</pre></details>';
  }
  function accept(task,op){
    if(task?.workspace!==op.workspace||task.action!==op.action||stable(task.payload)!==stable(op.payload))
      throw Error("The native task belongs to another original review selection.");
    const accepted=op.accepted_operation_id||op.operation_id;
    if(task.operation_id!==accepted){
      if(op.accepted_operation_id||!["queued","running"].includes(task.state))throw Error("The native task changed its accepted operation identity.");
      op.accepted_operation_id=task.operation_id;
    }
    if(op.completed_snapshot && task.state!=="complete")return task;
    op.task_id=task.id;op.state=task.state;op.failed=["failed","cancelled","interrupted"].includes(task.state);
    if(task.state==="complete"){
      if(task.result?.review_id!==op.payload.review_id||!task.result.id)throw Error("The saved result belongs to another original review.");
      op.completed_snapshot=task.result.id;
    }
    return task;
  }
  async function finish(task,op){
    accept(task,op);rememberOperation(op);
    if(!current(op.workspace)||data?.review.id!==op.payload.review_id)return;
    pending=op;busy=false;
    if(op.completed_snapshot){
      status("Review revision saved in the original Workspace.");toast("Review revision saved.");
      if(data?.snapshot?.id!==op.completed_snapshot)await open(op.payload.review_id,op.completed_snapshot);else render();
    }else{status(op.failed?"The original operation needs attention in Tasks.":"The original review operation is "+task.state+".",op.failed);render();}
  }
  async function submit(action,value){
    const w=workspace,frozen=clone(value);if(!current(w))throw Error("Open the original Workspace before saving.");
    const previous=pending;
    if(previous&&!previous.completed_snapshot&&!previous.failed&&
      (previous.action!==action||stable(previous.payload)!==stable(frozen)))throw Error("Finish or reopen the current original operation before submitting another revision.");
    if(!previous||previous.action!==action||stable(previous.payload)!==stable(frozen)){
      const bytes=new Uint8Array(16);crypto.getRandomValues(bytes);
      pending={workspace:w,action,payload:frozen,operation_id:"gis-review-"+[...bytes].map(x=>x.toString(16).padStart(2,"0")).join("")};
    }
    const op=pending;rememberOperation();retain();busy=true;render();
    try{
      let task;
      try{task=await api("/api/actions",{method:"POST",body:{workspace:w,action,payload:frozen,operation_id:op.operation_id}});}
      catch(error){
        const state=await api("/api/state?"+new URLSearchParams({workspace:w}));
        task=state.tasks?.find(t=>t.operation_id===(op.accepted_operation_id||op.operation_id));
        if(!task)throw error;
      }
      accept(task,op);rememberOperation(op);
      if(current(w)&&data?.review.id===op.payload.review_id){await showTask(task.id);await refreshState({force:true});}
      const fresh=getState()?.tasks?.find(t=>t.id===task.id);
      await finish(fresh||task,op);
    }catch(e){if(current(w)&&data?.review.id===op.payload.review_id){busy=false;status(e.message,true);render();}throw e;}
  }
  async function reconcile(show=false){
    if(!pending)return;
    const op=pending,w=op.workspace;
    if(op.completed_snapshot){if(current(w))await open(op.payload.review_id,op.completed_snapshot);return;}
    const state=await api("/api/state?"+new URLSearchParams({workspace:w}));
    const task=state.tasks?.find(t=>t.id===op.task_id||t.operation_id===(op.accepted_operation_id||op.operation_id));
    if(task){if(show&&current(w))await showTask(task.id);await finish(task,op);}
    else await submit(op.action,op.payload);
  }
  async function prepareImport(file){
    if(!file)return;const w=workspace,id=data?.review.id,node=root,token=++importVersion;
    if(!id)return;retain();busy=true;render();
    try{
      const saved=await api("/api/upload",{method:"POST",raw:file,filename:file.name});
      if(!current(w)||root!==node||data?.review.id!==id||token!==importVersion)return;
      const preview=await api("/api/gis-review-decisions/receive-preview?"+new URLSearchParams({workspace:w,review_id:id,upload_id:saved.id}));
      if(!current(w)||root!==node||data?.review.id!==id||token!==importVersion)return;
      if(preview.workspace_key!==w||preview.comparison_sha256!==data.comparison_sha256)throw Error("The uploaded decisions use another original comparison.");
      upload={id:saved.id,review_id:id,preview};status("Imported source identity matches. Save it as a new revision when ready.");
    }catch(e){if(current(w)&&data?.review.id===id)status(e.message,true);}
    finally{if(current(w)&&data?.review.id===id&&token===importVersion){busy=false;render();}}
  }
  async function receiveImport(){
    if(!upload||upload.review_id!==data?.review.id)return;
    try{await submit("gis.review.decisions.receive",{review_id:data.review.id,previous_id:data.snapshot?.id||null,upload_id:upload.id});}
    catch(e){status(e.message,true);}
  }
  async function openForReview(value){
    const w=getState()?.workspace_key;
    if(!root||value?.workspace_key!==w||typeof value.review_id!=="string")throw Error("Open the same original Workspace and retained review.");
    if(workspace!==w)await catalogueLoad(true);
    if(!current(w))throw Error("The Workspace changed while opening this review.");
    await open(value.review_id,value.snapshot_id||"");
    return {workspace_key:w,review_id:value.review_id,snapshot_id:value.snapshot_id||""};
  }
  return {
    mount(element,state){root=element;void catalogueLoad(true);},
    update(state){
      if(!root)return;
      if(state?.workspace_key!==workspace){void catalogueLoad(true);return;}
      const next=JSON.stringify((state.tasks||[]).filter(t=>t.action?.startsWith("gis.review.decisions.")).map(t=>[t.id,t.state]));
      if(next===taskSignature)return;taskSignature=next;
      if(pending&&!pending.completed_snapshot){
        const task=(state.tasks||[]).find(t=>t.id===pending.task_id||t.operation_id===(pending.accepted_operation_id||pending.operation_id));
        if(task)void finish(task,pending).catch(e=>status(e.message,true));
      }
    },
    detach(){retain();viewVersion++;featureVersion++;importVersion++;request?.abort();root=null;},
    openForReview
  };
}

/** Original saved-plan export and edited-design receiving in the native operator. */
import {OriginalDesignEditor} from './conservation_design_editor.mjs';
const esc = value => String(value ?? "").replace(/[&<>"']/g, c =>
  ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const roleLabels = {
  reporting_units: "Reporting portions of each selected unit",
  whole_units: "Complete original selected units",
  reporting_union: "Saved reporting-area union",
  whole_unit_union: "Union of complete original selected units",
};
const options = (rows, selected) => rows.map(([id, label]) => '<option value="' + esc(id) +
  '"' + (id === selected ? " selected" : "") + ">" + esc(label) + "</option>").join("");
const operationId = () => "conservation-design-" + crypto.randomUUID();
const maximumHandoverBytes = 100 * 1024 * 1024;
const uploadCapacity = host => {
  const configured=Number(host.getState()?.limits?.upload_bytes);
  return Number.isSafeInteger(configured)&&configured>0 ?
    Math.min(configured,maximumHandoverBytes) : maximumHandoverBytes;
};
const capacityLabel = count => (count/1024/1024).toLocaleString(undefined,{maximumFractionDigits:2})+" MiB";

class DesignBridge {
  constructor(root, host) {
    this.root = root; this.host = host; this.workspace = host.getState()?.workspace_key;
    this.key = "upstate.conservation-design/" + this.workspace;
    this.generation = 0; this.recordVersion = 0; this.gone = false; this.busy = false;
    this.overview = null; this.record = null; this.error = ""; this.notice = "";
    this.editor = null;
    this.planId = ""; this.title = ""; this.role = "reporting_units";
    this.inputMode = "upload"; this.descriptor = ""; this.file = null; this.upload = null; this.pending = null;
    this.controller = new AbortController();
    root.addEventListener("click", event => { const button = event.target.closest("[data-design-action]");
      if (button) { event.preventDefault(); void this.act(button).catch(e => this.fail(e)); }
    }, {signal:this.controller.signal});
    root.addEventListener("change", event => this.change(event), {signal:this.controller.signal});
    root.addEventListener("input", event => {
      const key = event.target.dataset.designField;
      if (key && ["title","descriptor"].includes(key)) this[key] = event.target.value;
    }, {signal:this.controller.signal});
    try {
      const saved = JSON.parse(sessionStorage.getItem(this.key) || "null");
      if (saved?.workspace === this.workspace) this.pending = saved.pending;
    } catch (_) {}
  }
  cache() {
    if (this.pending) sessionStorage.setItem(this.key, JSON.stringify({
      workspace:this.workspace,pending:this.pending}));
    else sessionStorage.removeItem(this.key);
  }
  read(path, args={}) {
    return this.host.api(this.host.endpoint(path, args));
  }
  async start() {
    this.render();
    await this.reload();
    if (this.pending?.id) await this.finish(this.pending.id);
  }
  async reload() {
    const turn=++this.generation, result=await this.read("/api/conservation-design/overview");
    if (this.gone || turn!==this.generation || this.host.getState()?.workspace_key!==this.workspace) return;
    this.overview=result;
    if (!result.plans.some(p=>p.id===this.planId)) this.planId=result.plans[0]?.id || "";
    this.render();
  }
  fail(error) { if(this.gone)return;this.error=error?.message||String(error);this.busy=false;this.render(); }
  change(event) {
    const field=event.target.dataset.designField;
    if(field==="file") {
      this.file=event.target.files[0]||null;this.upload=null;
      this.error=this.file?.size>uploadCapacity(this.host) ?
        "The complete handover must fit this operator's "+capacityLabel(uploadCapacity(this.host))+" upload limit." : "";
      this.render();return;
    }
    if(["planId","role","inputMode"].includes(field)) {
      this[field]=event.target.value;
      if(field==="inputMode") this.render();
    }
  }
  async queue(action, payload) {
    if(this.gone||this.host.getState()?.workspace_key!==this.workspace)return;
    if(this.pending) throw Error("Open or resume the retained operation before submitting another design.");
    this.pending={operation_id:operationId(),action,payload,id:null,state:"submitting"};
    try {this.cache();} catch(error) {
      this.pending=null;
      throw Error("Browser storage is full. Free space for this operation identity, then submit the same retained design.");
    }
    await this.submit();
  }
  async submit() {
    const pending=this.pending;if(!pending||this.gone||this.host.getState()?.workspace_key!==this.workspace)return;
    this.busy=true;this.error="";this.render();
    let response;
    try {
      response=await this.host.api("/api/actions",{method:"POST",body:{
        workspace:this.workspace,action:pending.action,payload:pending.payload,
        operation_id:pending.operation_id}});
    } catch(error) {
      if(!this.gone&&this.pending===pending) {
        if([400,401,403,404,405,413,415,422].includes(Number(error?.status))) {
          this.pending=null;this.cache();
          this.notice="The request was rejected before acceptance. Revise this same design and submit again.";
        } else {
          this.notice="The original operation identity is retained. Retry to recover its accepted task or submit the same request.";
        }
        this.busy=false;this.render();
      }
      throw error;
    }
    if(this.gone||this.pending!==pending||this.host.getState()?.workspace_key!==this.workspace)return;
    const task=response.task||response;
    this.pending={...pending,id:task.id,state:task.state};
    // The original task retains the entire payload once accepted.
    delete this.pending.payload;this.cache();this.busy=false;
    this.notice="Original operation "+task.id+" is "+task.state+".";
    this.render();
    await this.host.refresh({force:true});
    if(task.state==="complete")await this.finish(task.id);
  }
  async finish(id) {
    if(this.resolving===id)return;
    this.resolving=id;
    try {
      const task=await this.read("/api/task",{id});
      if(this.gone||this.pending?.id!==id)return;
      this.pending.state=task.state;this.cache();
      if(task.state==="complete"){
        const result=task.result,kind=result.kind;
        if(!["preparation","receiving"].includes(kind))throw Error("The native task returned a different design operation.");
        const recordVersion=++this.recordVersion;
        const record=await this.read("/api/conservation-design/"+kind,{id:result.id});
        if(this.gone||this.pending?.id!==id||this.host.getState()?.workspace_key!==this.workspace)return;
        if(recordVersion===this.recordVersion)this.record=record;
        this.pending=null;this.cache();
        this.notice=kind==="preparation"?"The complete original plan is ready to edit.":"The edited design is retained in the original native Workspace.";
        this.error="";await this.reload();
      } else if(["failed","cancelled","interrupted"].includes(task.state)){
        this.error=task.error?.message||("The original task is "+task.state+".");
        this.render();
      } else this.render();
    }finally{if(this.resolving===id)this.resolving=null;}
  }
  async update(state) {
    if(this.gone)return;
    if(state?.workspace_key!==this.workspace){this.detach();return;}
    if(this.pending) {
      const task=(state.tasks||[]).find(row=>this.pending.id ?
        row.id===this.pending.id : row.operation_id===this.pending.operation_id);
      if(task) {
        const needsRead=!this.pending.id||task.state!==this.pending.state;
        this.pending.id=task.id;delete this.pending.payload;this.cache();
        if(needsRead)await this.finish(task.id);
      }
    }
  }
  async act(button) {
    const action=button.dataset.designAction;
    if(action==="refresh"){await this.reload();return;}
    if(action==="edit"){
      if(this.record?.kind!=="preparation")throw Error("Open the original prepared project first.");
      const editor=new OriginalDesignEditor(this.host,this.record,async()=>{
        this.editor=null;this.notice="The original editor saved this project in the selected Workspace.";this.render();
      });
      this.editor=editor;this.render();
      try{await editor.start();}catch(error){editor.detach();this.editor=null;this.render();throw error;}
      return;
    }
    if(action==="prepare") {
      if(!this.planId)throw Error("Choose a completed original portfolio.");
      await this.queue("conservation.design.prepare",{plan_id:this.planId,geometry_role:this.role,
        ...(this.title.trim()?{title:this.title.trim()}:{})});return;
    }
    if(action==="receive"){
      if(this.busy||this.pending)return;
      let payload;
      if(this.inputMode==="upload"){
        if(!this.file||this.file.size===0||this.file.size>uploadCapacity(this.host))
          throw Error("Choose the complete native handover ZIP, up to "+capacityLabel(uploadCapacity(this.host))+".");
        const selectedFile=this.file;
        this.busy=true;this.error="";this.notice="Retaining the complete original ZIP…";this.render();
        try {
          let upload=this.upload?.file===selectedFile?this.upload.record:null;
          if(!upload)upload=await this.host.api("/api/upload",{method:"POST",
            raw:selectedFile,filename:selectedFile.name,signal:this.controller.signal});
          if(this.gone||this.host.getState()?.workspace_key!==this.workspace||this.file!==selectedFile)return;
          if(!/^[a-f0-9]{64}$/.test(upload?.id||"")||
             !/^[a-f0-9]{64}$/.test(upload?.sha256||"")||upload.bytes!==selectedFile.size)
            throw Error("The upload service did not return the complete original file identity.");
          this.upload={file:selectedFile,record:upload};
          payload={upload_id:upload.id};
          await this.queue("conservation.design.receive",payload);
        } finally {
          if(!this.gone){this.busy=false;this.render();}
        }
      }else{
        let descriptor;try{descriptor=JSON.parse(this.descriptor);}catch(_){throw Error("Paste the complete retained file descriptor JSON.");}
        payload={file:descriptor};
        await this.queue("conservation.design.receive",payload);
      }
      return;
    }
    if(action==="retry") {
      if(this.pending?.id)await this.finish(this.pending.id);else await this.submit();return;
    }
    if(action==="resume"){
      if(!this.pending?.id)throw Error("Open the original task first.");
      await this.host.api("/api/task/resume",{method:"POST",body:{id:this.pending.id}});
      this.pending.state="queued";this.cache();this.error="";this.render();
      await this.host.refresh({force:true});return;
    }
    if(action==="clear"){
      if(!["failed","cancelled"].includes(this.pending?.state))throw Error("Keep the active original operation.");
      this.pending=null;this.cache();this.error="";this.render();return;
    }
    if(action==="open") {
      const kind=button.dataset.kind,id=button.dataset.id;
      if(!["preparation","receiving"].includes(kind))throw Error("Choose a retained design operation.");
      const recordVersion=++this.recordVersion, workspace=this.workspace;
      const record=await this.read("/api/conservation-design/"+kind,{id});
      if(this.gone||recordVersion!==this.recordVersion||this.host.getState()?.workspace_key!==workspace)return;
      this.record=record;this.error="";this.render();return;
    }
  }
  render() {
    if(this.gone)return;
    if(this.editor){this.editor.render(this.root);return;}
    const data=this.overview||{plans:[],preparations:[],receivings:[]};
    const disabled=this.busy||!!this.pending?" disabled":"";
    const button=(action,label,extra="",blocked=false)=>'<button type="button" data-design-action="'+action+'" '+extra+(blocked?" disabled":"")+">"+esc(label)+"</button>";
    const pending=this.pending?'<section class="cd-panel" aria-label="Retained operation"><h2>Retained operation</h2><p><code>'+
      esc(this.pending.id||this.pending.operation_id)+"</code> · "+esc(this.pending.state)+'</p><div class="cd-actions">'+
      button("retry",this.pending.id?"Read original task":"Retry original operation")+
      (this.pending.state==="interrupted"?button("resume","Resume original task"):"")+
      (["failed","cancelled"].includes(this.pending.state)?button("clear","Return to design controls"):"")+"</div></section>":"";
    const record=this.record;
    const downloads=record?'<section class="cd-panel" aria-label="Retained design result"><h2>'+esc(record.title||record.kind)+'</h2><dl>'+
      [["Original plan",record.plan_id],["Design operation",record.id],["Geometry view",roleLabels[record.geometry_role]||record.geometry_role],
       ["Edited features",record.edited_feature_count],["Native scenario",record.scenario_id],["Prepared run",record.run_id]]
      .filter(([,v])=>v!==null&&v!==undefined).map(([k,v])=>"<dt>"+esc(k)+"</dt><dd>"+esc(v)+"</dd>").join("")+
      "</dl>"+(record.kind==="preparation"?'<div class="cd-actions">'+button("edit","Edit this original project")+"</div>":"")+
      ((record.scenario_id||record.run_id)?'<div class="cd-actions">'+
      (record.scenario_id?'<button type="button" data-action="item" data-kind="scenarios" data-id="'+esc(record.scenario_id)+'">Open original scenario</button>':"")+
      (record.run_id?'<button type="button" data-action="item" data-kind="runs" data-id="'+esc(record.run_id)+'">Open prepared run</button>':"")+"</div>":"")+
      (record.model_domain_coverage?"<p>Model domain covers "+esc((100*record.model_domain_coverage.model_domain_covered_fraction).toFixed(3))+
      "% of the complete edited footprint. Reporting overlap: "+esc(record.model_domain_coverage.reporting_overlap_area_ha)+" ha.</p>":"")+
      '<ul class="cd-downloads">'+(record._downloads||[]).map(item=>'<li><a href="'+esc(item.url)+"?download=1"+'">'+
      esc(item.label||item.filename||"Download retained file")+"</a></li>").join("")+"</ul></section>":"";
    const history=(rows,kind)=>'<table><caption>'+esc(kind==="preparation"?"Prepared projects":"Received native designs")+
      '</caption><thead><tr><th>Title</th><th>Saved</th><th>Original native scenario</th><th>Open</th></tr></thead><tbody>'+
      (rows.map(row=>"<tr><td>"+esc(row.title||row.id)+"</td><td>"+esc(row.created_at)+"</td><td><code>"+esc(row.scenario_id||"")+
      "</code></td><td>"+button("open","Open",'data-kind="'+kind+'" data-id="'+esc(row.id)+'"')+"</td></tr>").join("")||
      '<tr><td colspan="4">No retained '+esc(kind)+" yet.</td></tr>")+"</tbody></table>";
    this.root.innerHTML='<section class="cd-root"><header><div><h1>Scenario design</h1><p>Carry a saved conservation selection into the editable geometry workbench, then receive its complete land-cover design.</p></div>'+
      button("refresh","Refresh")+"</header>"+(this.error?'<p role="alert" class="cd-alert">'+esc(this.error)+"</p>":"")+
      (this.notice?'<p role="status">'+esc(this.notice)+"</p>":"")+pending+downloads+
      '<div class="cd-columns"><section class="cd-panel"><h2>Prepare an editable project</h2><label>Original completed portfolio<select data-design-field="planId"'+disabled+'>'+
      options(data.plans.map(p=>[p.id,p.title||p.id]),this.planId)+'</select></label><label>Geometry view<select data-design-field="role"'+disabled+'>'+
      options(Object.entries(roleLabels),this.role)+'</select></label><label>Project title (optional)<input data-design-field="title" value="'+esc(this.title)+'"'+disabled+
      '></label><div class="cd-actions">'+button("prepare","Prepare original plan","",!!disabled||!this.planId)+'</div>'+
      '<p>Choose Edit this original project in its prepared result. Create an alternative, edit its polygons, and export the complete native handover from Land-cover scenario. The original editor saves its project and revisions inside this Workspace.</p>'+
      '<p>The complete editable ZIP also opens in the supplied standalone editor for portable work.</p></section>'+
      '<section class="cd-panel"><h2>Receive an edited native handover</h2><label>Input<select data-design-field="inputMode"'+disabled+'>'+
      options([["upload","Complete ZIP from this browser"],["descriptor","Retained Workspace file descriptor"]],this.inputMode)+'</select></label>'+
      (this.inputMode==="upload"?'<label>Native handover ZIP (up to '+esc(capacityLabel(uploadCapacity(this.host)))+')<input type="file" accept=".zip,application/zip" data-design-field="file"'+disabled+
        '></label><p>'+esc(this.file?.name||"Choose the complete native handover exported by Land-cover scenario.")+'</p>':
        '<label>Complete file descriptor<textarea data-design-field="descriptor" rows="7" spellcheck="false"'+disabled+'>'+esc(this.descriptor)+'</textarea></label><p>Retain the original ZIP inside this Workspace and supply its path, bytes and sha256. This route supports full handovers up to 100 MiB.</p>')+
      '<div class="cd-actions">'+button("receive","Receive native design","",!!disabled)+'</div><p>The existing queue imports the original geometry and companion files, saves the original scenario, and prepares a run only when the handover requests one.</p></section></div>'+
      '<section class="cd-panel"><h2>Saved design operations</h2>'+history(data.preparations,"preparation")+history(data.receivings,"receiving")+"</section></section>";
  }
  detach(){this.gone=true;this.editor?.detach();this.editor=null;this.controller.abort();this.generation++;}
}
export function attachConservationDesign(host) {
  let active=null;
  const drafts=new Map();
  const draftFields=["planId","title","role","inputMode","descriptor","file","upload"];
  function release() {
    if(!active)return;
    drafts.set(active.workspace,Object.fromEntries(draftFields.map(name=>[name,active[name]])));
    active.detach();active=null;
  }
  return {
    mount(root) {
      release();
      active=new DesignBridge(root,host);
      const saved=drafts.get(active.workspace);
      if(saved)for(const name of draftFields)active[name]=saved[name];
      const instance=active;void instance.start().catch(e=>instance.fail(e));
    },
    update(state) {const instance=active;if(instance)void instance.update(state).catch(e=>instance.fail(e));},
    detach() {release();},
  };
}

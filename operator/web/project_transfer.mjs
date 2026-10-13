const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pretty = value => JSON.stringify(value, null, 2);
const short = value => String(value ?? '').slice(0, 12);
const date = value => value ? new Date(value).toLocaleString() : '—';
const action = (name, label, id='') => '<button type="button" data-action="transfer-'+name+'"'+(id?' data-id="'+esc(id)+'"':'')+'>'+esc(label)+'</button>';
const table = (headers, rows) => '<div class="table-scroll"><table><thead><tr>'+headers.map(x=>'<th>'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table></div>';

export function attachProjectTransfers({getState,api,endpoint,openForm,submitAction,detail,fileList,uploadFile,showTask}) {
  let host=null;
  const current=()=>getState();
  const sameWorkspace=key=>{if(current()?.workspace_key!==key)throw Error('The workspace changed. Reopen this operation in the intended project.');};
  const available=task=>current()?.data?.project_continuity?.actions?.includes(task.action)??task.handler_available!==false;
  const tasksFor=id=>(current()?.tasks??[]).filter(t=>t.transfer_origin?.transfer_id===id);
  function mount(container,state) {
    host=container;
    const transfers=state.data.project_continuity?.transfers??[];
    const retained=(state.tasks??[]).filter(t=>t.transfer_origin);
    const unfinished=retained.filter(t=>!['complete','cancelled'].includes(t.state));
    const snapshots=(state.tasks??[]).filter(t=>['workspace.snapshot','workspace.receive','workspace.recovery.resume'].includes(t.action));
    container.innerHTML='<div class="page-header"><div><p class="eyebrow">PROJECT CONTINUITY</p><h1>Save the project and its work</h1><p>Carry the original sources, completed results, outstanding selections and required uploads through the same scientific archive.</p></div><div class="inline-actions">'+action('snapshot','Create complete project')+action('receive','Receive a project')+'</div></div>'+
      '<div class="cards"><div class="card"><h3>Saved transfers</h3><strong class="number">'+transfers.length+'</strong><p>Complete scientific projects with their operating history.</p></div>'+
      '<div class="card"><h3>Received operations</h3><strong class="number">'+retained.length+'</strong><p>Original request identities retained in this workspace.</p></div>'+
      '<div class="card"><h3>Work to continue</h3><strong class="number">'+unfinished.length+'</strong><p>Saved selections ready for the original native action queue.</p></div></div>'+
      '<section class="section"><header><h2>Project transfers</h2><p>Inspect the retained work, download its package, or continue a received project.</p></header>'+
      (transfers.length?table(['Project / created','Completed history','Unfinished at capture','Current receiving','Open'],transfers.map(t=>{
        const received=tasksFor(t.id);const left=received.filter(x=>!['complete','cancelled'].includes(x.state)).length;
        return '<tr><td><strong>'+esc(t.title)+'</strong><small>'+esc(date(t.created_at))+'</small><small class="mono">'+esc(short(t.id))+'</small></td><td>'+t.summary.complete+'</td><td>'+t.summary.unfinished+'</td><td>'+(received.length?received.length+' operations · '+left+' unfinished':'Original saved transfer')+'</td><td><div class="inline-actions">'+action('inspect','Inspect',t.id)+(received.length?action('resume','Resume unfinished work',t.id):'')+'</div></td></tr>';
      })):'<div class="empty"><h3>Create a complete project</h3><p>The archive includes the same source and native model workspace, plus the selected operation history and original inputs needed to continue unfinished work.</p></div>')+'</section>'+
      '<section class="section"><header><h2>Transfer operations</h2><p>Open a completed snapshot to download its whole ZIP. A receiving result identifies the restored workspace.</p></header>'+
      (snapshots.length?table(['Created','Operation','State','Request','Open'],snapshots.map(t=>'<tr><td>'+esc(date(t.created_at))+'</td><td>'+esc({'workspace.snapshot':'Create project','workspace.receive':'Receive project','workspace.recovery.resume':'Resume work'}[t.action])+'</td><td>'+esc(t.state)+'</td><td class="mono">'+esc(t.operation_id)+'</td><td>'+action('task','Open operation',t.id)+'</td></tr>')):'<div class="empty"><p>No project transfer has been created by this operator.</p></div>')+'</section>'+
      '<section class="section"><header><h2>Operator route</h2></header><div class="section-body"><ol><li>Create a complete project with the work you want to carry forward.</li><li>Open its completed operation and download the scientific-workspace ZIP.</li><li>In the receiving operator, choose Receive a project and select that ZIP.</li><li>Switch to the received workspace. Inspect its preserved history, then resume unfinished work.</li></ol><p>Already completed native runs and comparison outputs reopen directly. Cancelled operations remain cancelled until explicitly selected.</p></div></section>';
  }
  function detach(){host=null;}
  async function snapshotForm() {
    const key=current().workspace_key;
    const plan=await api(endpoint('/api/extensions/project-continuity/plan'));
    sameWorkspace(key);
    const rows=plan.tasks.map(t=>'<tr><td><input type="checkbox" name="transfer-task" value="'+esc(t.id)+'" checked aria-label="Include '+esc(t.action)+' '+esc(short(t.id))+'"></td><td>'+esc(t.action)+'</td><td>'+esc(t.state)+'</td><td><code>'+esc(t.operation_id)+'</code></td></tr>');
    openForm('Create a complete project','Save the scientific workspace with the chosen operation history and original inputs needed by unfinished work.',
      '<label class="field"><span>Project title</span><input id="transfer-title" required value="'+esc(plan.project.title+' — complete project')+'"></label>'+
      '<label class="checkbox"><input id="transfer-intermediates" type="checkbox" checked>Include native intermediate files so original model stages can continue.</label>'+
      '<p>'+plan.summary.complete+' completed operations and '+plan.summary.unfinished+' unfinished operations are available.</p>'+
      (rows.length?table(['Include','Operation','State','Original request'],rows):'<p>This project has no operator tasks to include. Its retained source and model workspace will still be saved.</p>'),
      'Create project',async()=>{
        sameWorkspace(key);
        const selected=[...document.querySelectorAll('input[name="transfer-task"]:checked')].map(x=>x.value);
        await submitAction('workspace.snapshot',{title:document.querySelector('#transfer-title').value.trim(),task_ids:selected,include_intermediates:document.querySelector('#transfer-intermediates').checked});
      });
  }
  function receiveForm() {
    const key=current().workspace_key;let retained=null,selectedFile=null;
    openForm('Receive a complete project','The original archive is restored into a new workspace. Its operation selections, history and required original uploads are then rejoined to this operator.',
      '<label class="field"><span>Complete scientific-workspace ZIP</span><input id="transfer-archive" type="file" accept=".zip,application/zip" required></label>'+
      '<p>Choose the ZIP downloaded from a completed Create complete project operation. Ordinary scientific archives also reopen through this route.</p>',
      'Receive project',async()=>{
        sameWorkspace(key);
        const file=document.querySelector('#transfer-archive').files[0];
        if(!file)throw Error('Choose the complete project archive.');
        if(file!==selectedFile){retained=await uploadFile(file);selectedFile=file;}
        sameWorkspace(key);
        await submitAction('workspace.receive',{upload_id:retained.id});
      });
  }
  async function inspect(id) {
    const key=current().workspace_key;
    const record=await api(endpoint('/api/extensions/project-continuity/inspect',{transfer_id:id}));
    sameWorkspace(key);
    const rows=record.tasks.map(t=>'<tr><td>'+esc(t.action)+'</td><td>'+esc(t.state)+'</td><td><code>'+esc(t.operation_id)+'</code></td><td>'+esc(t.attempts?.length??0)+'</td></tr>');
    const uploads=Object.values(record.uploads).map(x=>'<tr><td>'+esc(x.record.filename)+'</td><td>'+x.record.bytes.toLocaleString()+'</td><td><code>'+esc(x.record.sha256)+'</code></td></tr>');
    detail(record.title,'<p>'+esc(record.project.title)+' · '+esc(date(record.created_at))+'</p><p>Original project <code>'+esc(record.project.id)+'</code></p>'+
      '<h3>Complete project files</h3>'+fileList(record._downloads)+
      '<h3>Retained work</h3>'+table(['Operation','Captured state','Original request','Attempts'],rows)+
      '<h3>Original inputs for unfinished work</h3>'+(uploads.length?table(['File','Bytes','SHA256'],uploads):'<p>No unimported upload is required by the selected unfinished work.</p>')+
      '<details><summary>Complete original selection and source previews</summary><pre>'+esc(pretty({selection:record.selection,previews:record.previews}))+'</pre></details>');
  }
  function resumeForm(id) {
    const key=current().workspace_key;
    const records=tasksFor(id).filter(t=>t.state!=='complete');
    openForm('Continue the received project','Review the original operations to resume. Their saved selections and original inputs remain attached to this received workspace.',
      (records.length?table(['Resume','Operation','Current state','Original request'],records.map(t=>'<tr><td><input type="checkbox" name="transfer-resume-task" value="'+esc(t.id)+'" '+(t.state!=='cancelled'&&available(t)?'checked':'')+' '+(!available(t)?'disabled':'')+' aria-label="Resume '+esc(t.action)+'"></td><td>'+esc(t.action)+(!available(t)?'<small>Install this operation’s original application component to resume it.</small>':'')+'</td><td>'+esc(t.state)+'</td><td><code>'+esc(t.operation_id)+'</code></td></tr>')):'<p>Every received operation is already complete.</p>'),
      'Resume selected work',async()=>{
        sameWorkspace(key);
        const selected=[...document.querySelectorAll('input[name="transfer-resume-task"]:checked')].map(x=>x.value);
        await submitAction('workspace.recovery.resume',{transfer_id:id,task_ids:selected});
      });
  }
  async function dispatch(button) {
    const command=button.dataset.action;
    if(command==='transfer-snapshot')return snapshotForm();
    if(command==='transfer-receive')return receiveForm();
    if(command==='transfer-inspect')return inspect(button.dataset.id);
    if(command==='transfer-resume')return resumeForm(button.dataset.id);
    if(command==='transfer-task')return showTask(button.dataset.id);
  }
  return {mount,detach,dispatch};
}

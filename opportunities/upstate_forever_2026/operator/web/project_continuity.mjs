const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pretty = value => JSON.stringify(value, null, 2);
const short = value => String(value ?? '').slice(0, 12);
const date = value => value ? new Date(value).toLocaleString() : '—';
const action = (name, label, id='') => '<button type="button" data-action="transfer-'+name+'"'+(id?' data-id="'+esc(id)+'"':'')+'>'+esc(label)+'</button>';
const table = (headers, rows) => '<div class="table-scroll"><table><thead><tr>'+headers.map(x=>'<th>'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table></div>';

export function attachProjectTransfers({getState,api,endpoint,openForm,submitAction,detail,fileList,uploadFile,showTask,selectWorkspace,navigate}) {
  let host=null,viewIntent=0,mountedWorkspace=null;
  async function readCurrent(path,parameters) {
    const intent=viewIntent,key=getState()?.workspace_key,container=host;
    const live=()=>intent===viewIntent&&getState()?.workspace_key===key&&host===container&&container?.isConnected;
    try {
      const result=await api(endpoint(path,parameters));
      return live()?result:null;
    } catch(error) {
      if(live())throw error;
      return null;
    }
  }
  const current=()=>getState();
  const sameWorkspace=key=>{if(current()?.workspace_key!==key)throw Error('The workspace changed. Reopen this operation in the intended project.');};
  const available=task=>current()?.data?.project_continuity?.accepted_actions?.includes(task.action)??task.handler_available!==false;
  const tasksFor=id=>(current()?.tasks??[]).filter(t=>t.transfer_origin?.transfer_id===id);
  const hasIncremental=()=>['project.transfer.capture','project.transfer.restore'].every(name=>current()?.data?.project_continuity?.accepted_actions?.includes(name));
  const size=value=>(Number(value)||0).toLocaleString()+' bytes';
  function mount(container,state) {
    if(host!==container||mountedWorkspace!==state.workspace_key)viewIntent+=1;
    host=container;mountedWorkspace=state.workspace_key;
    const transfers=state.data.project_continuity?.transfers??[];
    const retained=(state.tasks??[]).filter(t=>t.transfer_origin);
    const unfinished=retained.filter(t=>!['complete','cancelled'].includes(t.state));
    const snapshots=(state.tasks??[]).filter(t=>['workspace.snapshot','workspace.receive','workspace.recovery.resume'].includes(t.action));
    container.innerHTML='<div class="page-header"><div><p class="eyebrow">PROJECT CONTINUITY</p><h1>Save the project and its work</h1><p>Carry the original sources, completed results, outstanding selections and required uploads through the same scientific archive.</p></div><div class="inline-actions">'+action('journey','Save or continue the selected analysis')+action('snapshot','Create complete project')+action('receive','Receive a project')+'</div></div>'+
      '<div class="cards"><div class="card"><h3>Saved transfers</h3><strong class="number">'+transfers.length+'</strong><p>Complete scientific projects with their operating history.</p></div>'+
      '<div class="card"><h3>Received operations</h3><strong class="number">'+retained.length+'</strong><p>Original request identities retained in this workspace.</p></div>'+
      '<div class="card"><h3>Work to continue</h3><strong class="number">'+unfinished.length+'</strong><p>Saved selections ready for the original native action queue.</p></div></div>'+
      '<section class="section"><header><h2>Project transfers</h2><p>Inspect the retained work, download its package, or continue a received project.</p></header>'+
      (transfers.length?table(['Project / created','Completed history','Unfinished at capture','Current receiving','Open'],transfers.map(t=>{
        const received=tasksFor(t.id);const left=received.filter(x=>!['complete','cancelled'].includes(x.state)).length;
        return '<tr><td><strong>'+esc(t.title)+'</strong><small>'+esc(date(t.created_at))+'</small><small class="mono">'+esc(short(t.id))+'</small></td><td>'+t.summary.complete+'</td><td>'+t.summary.unfinished+'</td><td>'+(received.length?received.length+' operations · '+left+' unfinished':'Original saved transfer')+'</td><td><div class="inline-actions">'+action('inspect','Inspect',t.id)+(received.length?action('resume','Resume unfinished work',t.id):'')+'</div></td></tr>';
      })):'<div class="empty"><h3>Create a complete project</h3><p>The archive includes the same source and native model workspace, plus the selected operation history and original inputs needed to continue unfinished work.</p></div>')+'</section>'+
      '<section class="section"><header><h2>Transfer operations</h2><p>Open a completed snapshot to download its whole ZIP. A receiving result identifies the restored workspace.</p></header>'+
      (snapshots.length?table(['Created','Operation','State','Request','Open'],snapshots.map(t=>'<tr><td>'+esc(date(t.created_at))+'</td><td>'+esc({'workspace.snapshot':'Create project','workspace.receive':'Receive project','workspace.recovery.resume':'Resume work'}[t.action])+'</td><td>'+esc(t.state)+'</td><td class="mono">'+esc(t.operation_id)+'</td><td>'+action('task','Open operation',t.id)+(t.state==='complete'&&t.result?.workspace_key&&t.result.workspace_key!==state.workspace_key?action('workspace','Open received project',t.result.workspace_key):'')+'</td></tr>')):'<div class="empty"><p>No project transfer has been created by this operator.</p></div>')+'</section>'+
      (hasIncremental()?'<section class="section"><header><h2>Incremental handover</h2><p>Use the original handover engine to send only the receiving computer’s missing blocks. Its retained editions carry the same operation history and original unfinished inputs.</p></header><div class="section-body"><div class="inline-actions">'+action('block-browse','Open retained editions')+action('block-upload','Receive a manifest or part')+'</div><ol><li>Create a complete project using incremental handover, then download its manifest.</li><li>Receive the manifest on the destination and save its missing-block request.</li><li>Use that request on the sender to create transfer parts, then receive those parts on the destination.</li><li>Receive the completed edition as an independent project and continue its saved work.</li></ol></div></section>':'')+
      '<section class="section"><header><h2>Archive route</h2></header><div class="section-body"><ol><li>Create a complete project with the work you want to carry forward.</li><li>Open its completed operation and download the scientific-workspace ZIP.</li><li>In the receiving operator, choose Receive a project and select that ZIP.</li><li>Switch to the received workspace. Inspect its preserved history, then resume unfinished work.</li></ol><p>Already completed native runs and comparison outputs reopen directly. Cancelled operations remain cancelled until explicitly selected.</p></div></section>';
  }
  function update(state){if(host)mount(host,state);}
  function detach(){viewIntent+=1;host=null;mountedWorkspace=null;}
  async function snapshotForm() {
    const key=current().workspace_key;
    const plan=await readCurrent('/api/extensions/project-continuity/plan');
    if(!plan)return;
    const rows=plan.tasks.map(t=>'<tr><td><input type="checkbox" name="transfer-task" value="'+esc(t.id)+'" checked aria-label="Include '+esc(t.action)+' '+esc(short(t.id))+'"></td><td>'+esc(t.action)+'</td><td>'+esc(t.state)+'</td><td><code>'+esc(t.operation_id)+'</code></td></tr>');
    openForm('Create a complete project','Save the scientific workspace with the chosen operation history and original inputs needed by unfinished work.',
      '<label class="field"><span>Project title</span><input id="transfer-title" required value="'+esc(plan.project.title+' — complete project')+'"></label>'+
      '<label class="field"><span>Delivery method</span><select id="transfer-transport"><option value="archive">Complete scientific-workspace ZIP</option>'+(hasIncremental()?'<option value="incremental">Incremental handover with resumable parts</option>':'')+'</select></label>'+
      '<label class="checkbox"><input id="transfer-intermediates" type="checkbox" checked>Include native intermediate files so original model stages can continue.</label>'+
      (plan.operator_session?'<p>The selected analysis and notes saved '+esc(date(plan.operator_session.saved_at))+' are included. This operation retains that exact saved view.</p>':'<p>To carry your current analysis selection and notes, close this form and choose Save or continue the selected analysis, then Save view and transfer project.</p>')+
      '<p>'+plan.summary.complete+' completed operations and '+plan.summary.unfinished+' unfinished operations are available.</p>'+
      (rows.length?table(['Include','Operation','State','Original request'],rows):'<p>This project has no operator tasks to include. Its retained source and model workspace will still be saved.</p>'),
      'Create project',async()=>{
        sameWorkspace(key);
        const selected=[...document.querySelectorAll('input[name="transfer-task"]:checked')].map(x=>x.value);
        await submitAction('workspace.snapshot',{title:document.querySelector('#transfer-title').value.trim(),task_ids:selected,include_intermediates:document.querySelector('#transfer-intermediates').checked,transport:document.querySelector('#transfer-transport').value,...(plan.operator_session?{journey:plan.operator_session.journey,journey_revision:plan.operator_session.revision}:{})});
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
    const record=await readCurrent('/api/extensions/project-continuity/inspect',{transfer_id:id});
    if(!record)return;
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

  async function browseTransport() {
    const result=await readCurrent('/api/extensions/project-continuity/transport');
    if(!result)return;
    if(!result.available)throw Error('Install the original incremental handover component to open its editions.');
    detail('Retained handover editions',
      '<p>These editions belong to the original handover cache for this operator workspace. Open an edition to inspect actual receiving progress, create parts, or receive its independent working copy.</p>'+
      (result.snapshots.length?table(['Project / edition','Created','Files','Original bytes','Retained blocks','Open'],result.snapshots.map(row=>
        '<tr><td><strong>'+esc(row.project.title)+'</strong><small class="mono">'+esc(short(row.id))+'</small></td><td>'+esc(date(row.created_at))+'</td><td>'+row.files+'</td><td>'+esc(size(row.logical_bytes))+'</td><td>'+row.unique_blocks+' · '+esc(size(row.unique_bytes))+'</td><td>'+action('block-inspect','Open edition',row.id)+'</td></tr>')):
        '<p>Create an incremental project snapshot here, or receive its original manifest or transfer part.</p>'));
  }
  async function inspectTransport(id) {
    const result=await readCurrent('/api/extensions/project-continuity/transport',{snapshot_id:id});
    if(!result)return;
    if(!result.available)throw Error('Install the original incremental handover component to open this edition.');
    const request=result.request;
    detail(result.project.title+' — handover edition',
      '<p>Edition <code>'+esc(result.snapshot_id)+'</code></p>'+
      '<div class="cards"><div class="card"><h3>Original project files</h3><strong class="number">'+result.file_count+'</strong><p>'+esc(size(result.logical_bytes))+'</p></div>'+
      '<div class="card"><h3>Verified receiving blocks</h3><strong class="number">'+request.blocks_present+' / '+request.blocks_total+'</strong><p>'+esc(size(request.bytes_present))+'</p></div>'+
      '<div class="card"><h3>Still to receive</h3><strong class="number">'+esc(size(request.bytes_remaining))+'</strong><p>'+esc(size(request.bytes_for_whole_block_packs))+' in complete transfer parts.</p></div></div>'+
      '<div class="inline-actions">'+action('block-request','Save manifest and missing-block request',id)+
      action('block-parts','Create transfer parts',id)+action('block-report','Export full file inventory',id)+
      (request.complete?action('block-reopen','Receive independent project',id):action('block-upload','Receive missing parts'))+'</div>'+
      '<p>'+(request.complete?'Every required original block is available. Receiving creates a new native workspace and restores its saved operation history.':'Return the missing-block request to the sender. Receive the resulting parts here, then reopen this edition to inspect its progress.')+'</p>');
  }
  function uploadTransportForm() {
    const key=current().workspace_key;let retained=null,selectedFile=null;
    openForm('Receive handover files','Select one original transfer manifest or transfer part. Completed blocks remain available when later parts arrive.',
      '<label class="field"><span>Original handover file</span><input id="transfer-block-file" type="file" accept=".json,.zip" required></label>'+
      '<label class="field"><span>File type</span><select id="transfer-block-kind"><option value="manifest">Transfer manifest</option><option value="part">Transfer part (.uptransfer.zip)</option></select></label>',
      'Receive file',async()=>{
        sameWorkspace(key);
        const file=document.querySelector('#transfer-block-file').files[0];
        if(!file)throw Error('Choose the original transfer manifest or part.');
        const kind=document.querySelector('#transfer-block-kind').value;
        if(file!==selectedFile){retained=await uploadFile(file);selectedFile=file;}
        sameWorkspace(key);
        await submitAction(kind==='part'?'project.transfer.receive':'project.transfer.accept',{upload_id:retained.id});
      });
  }
  function partsForm(id) {
    const key=current().workspace_key;let retained=null,selectedFile=null;
    openForm('Create transfer parts','Use the receiving computer’s saved request to send only its missing data. The original handover engine keeps the selected edition and block identities.',
      '<label class="field"><span>Receiver missing-block request (optional)</span><input id="transfer-block-request" type="file" accept=".json,application/json"></label>'+
      '<label class="field"><span>Maximum raw block payload per part (MiB)</span><input id="transfer-block-size" type="number" min="4" max="1024" step="1" value="64" required></label>'+
      '<p>Allow room for the complete manifest and ZIP metadata beneath the sharing service’s file-size limit. With no receiver request, the sender includes the whole edition.</p>',
      'Create parts',async()=>{
        sameWorkspace(key);
        const mib=Number(document.querySelector('#transfer-block-size').value);
        if(!Number.isInteger(mib)||mib<4||mib>1024)throw Error('Choose a whole payload size from 4 through 1024 MiB.');
        const payload={snapshot_id:id,payload_bytes:mib*1024*1024};
        const file=document.querySelector('#transfer-block-request').files[0];
        if(file){if(file!==selectedFile){retained=await uploadFile(file);selectedFile=file;}payload.request_upload_id=retained.id;}
        sameWorkspace(key);
        await submitAction('project.transfer.parts',payload);
      });
  }
  function reopenTransport(id) {
    const key=current().workspace_key;
    openForm('Receive independent project','Reopen this complete retained edition through the original native receiver, then restore its saved scientific operation history.',
      '<p>Edition <code>'+esc(id)+'</code> will receive into its own working directory. Select the returned workspace when this operation completes to inspect the work and continue its unfinished selections.</p>',
      'Receive project',async()=>{sameWorkspace(key);await submitAction('workspace.receive',{snapshot_id:id});});
  }
  async function dispatch(button) {
    viewIntent+=1;
    const command=button.dataset.action;
    if(command==='transfer-snapshot')return snapshotForm();
    if(command==='transfer-receive')return receiveForm();
    if(command==='transfer-inspect')return inspect(button.dataset.id);
    if(command==='transfer-resume')return resumeForm(button.dataset.id);
    if(command==='transfer-task')return showTask(button.dataset.id);
    if(command==='transfer-journey')return navigate('journey');
    if(command==='transfer-workspace'){
      await selectWorkspace(button.dataset.id);
      return navigate('project-continuity');
    }
    if(command==='transfer-block-browse')return browseTransport();
    if(command==='transfer-block-inspect')return inspectTransport(button.dataset.id);
    if(command==='transfer-block-upload')return uploadTransportForm();
    if(command==='transfer-block-parts')return partsForm(button.dataset.id);
    if(command==='transfer-block-reopen')return reopenTransport(button.dataset.id);
    if(command==='transfer-block-request')return submitAction('project.transfer.inspect',{snapshot_id:button.dataset.id});
    if(command==='transfer-block-report')return submitAction('project.transfer.report',{snapshot_id:button.dataset.id});
  }
  return {mount,update,detach,dispatch};
}

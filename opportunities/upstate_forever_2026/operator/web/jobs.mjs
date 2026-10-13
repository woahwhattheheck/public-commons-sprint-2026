/** Native calculation console inside the original operator. */
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const short = value => value ? String(value).slice(0,12) : '—';
const pretty = value => JSON.stringify(value,null,2);
const duration = seconds => {
  if(!Number.isFinite(seconds))return 'Waiting for worker';
  const value=Math.floor(Math.max(0,seconds)),hours=Math.floor(value/3600),minutes=Math.floor(value%3600/60);
  return (hours?hours+'h ':'')+(minutes?minutes+'m ':'')+(value%60)+'s';
};
const bytes = value => {
  if(!Number.isFinite(value))return '—';
  let n=value,i=0;const units=['B','KiB','MiB','GiB'];
  while(n>=1024&&i<3){n/=1024;i++;}
  return n.toLocaleString(undefined,{maximumFractionDigits:i?1:0})+' '+units[i];
};
const when = value => value ? new Date(value).toLocaleString() : '—';
const button = (action,label,id,disabled=false) => '<button type="button" data-action="native-job-'+action+'" data-id="'+esc(id)+'" '+(disabled?'disabled':'')+'>'+esc(label)+'</button>';

function reuseMarkup(native){
  const row=native.native_execution?.stage_reuse;
  if(!row)return '';
  const labels={searching:'Finding a retained stage',checking:'Checking original stage identity',
    comparing_original_inputs:'Comparing original scientific inputs',transferring:'Retaining verified outputs',
    complete:'Original stage retained',no_matching_stage:'Native calculation required'};
  const source=row.source_run_id?'<p>Original run <code>'+esc(row.source_run_id)+'</code></p>':'';
  const file=row.current_file?'<p>Current original file <code>'+esc(row.current_file)+'</code></p>':'';
  const scope=row.candidate_kind==='exact_index'?'Exact content-signature index':
    row.candidate_kind==='explicit_source'?'Explicit original source comparison':'Exact index, then selected original sources';
  const count=value=>Number.isInteger(value)?value.toLocaleString():'—';
  return '<h3>'+esc((row.model||'').toUpperCase())+' · '+esc(labels[row.phase]||row.phase)+'</h3>'+
    '<p class="note">'+esc(scope)+'</p>'+source+file+
    '<div class="native-metrics"><dl><dt>Verified files</dt><dd>'+count(row.files_completed)+' / '+count(row.files_total)+'</dd></dl>'+
    '<dl><dt>Verified output bytes</dt><dd>'+bytes(row.logical_bytes_completed)+' / '+bytes(row.logical_bytes_total)+'</dd></dl>'+
    '<dl><dt>Exact index candidates</dt><dd>'+count(row.index_candidates_checked)+'</dd></dl>'+
    '<dl><dt>Explicit source candidates</dt><dd>'+count(row.explicit_candidates_checked)+'</dd></dl>'+
    '<dl><dt>Reuse lookup and transfer</dt><dd>'+duration(row.elapsed_seconds)+'</dd></dl></div>'+
    (row.last_rejection?'<details><summary>Last unavailable original source</summary><p>'+
      esc(row.last_rejection.reason)+'</p></details>':'')+
    '<p class="note">Byte counts are complete, independently retained and verified files. Copy, reflink and already-retained files keep their original source identities.</p>';
}

export function attachNativeJobs({api,endpoint,detail,refresh,getWorkspace,getDetailContext,openItem,toast,getState}){
  let selected=null,workspace=null,timer=null,controller=null,offset=0,stream='native',snapshot=null,busy=false,generation=0;
  const style=document.createElement('link');style.rel='stylesheet';style.href=new URL('./jobs.css',import.meta.url);document.head.append(style);
  const root=()=>document.querySelector('[data-native-console]');
  function current(){return selected&&getWorkspace()===workspace&&getDetailContext()?.kind==='native-job'&&getDetailContext()?.id===selected&&root();}
  function detach(){generation++;clearTimeout(timer);timer=null;controller?.abort();controller=null;selected=null;snapshot=null;busy=false;}
  function controls(task,native){
    const id=task.id;let html=button('refresh','Refresh',id);
    if(task.state==='queued')html+=button('stop','Cancel queued run',id);
    else if(native.alive)html+=button('stop',native.stop_requested?'Stop requested':native.programme_context?'Stop calculation and pause programme':'Stop calculation',id,native.stop_requested);
    if(['failed','interrupted','cancelled'].includes(task.state))html+=button('resume',native.alive?'Reconnect to calculation':'Resume retained run',id);
    html+=button('result','Inspect native result',id)+button('snapshot','Download operation record',id);
    return html;
  }
  function phase(native){
    if(native.stop_requested&&native.alive)return 'Stopping the selected calculation';
    if(native.run_state==='complete')return 'Calculation complete';
    if(native.alive){
      const execution=native.native_execution;
      if(execution?.phase==='stage_reuse')return 'Reusing original '+(execution.model||'native').toUpperCase()+' stage';
      if(execution?.phase==='waiting_stage')return 'Waiting for the matching original stage';
      if(execution?.phase==='native')return 'Calculating original '+(execution.model||'native').toUpperCase()+' model';
      if(execution?.phase==='export')return 'Retaining physical export rasters';
      return native.programme_context?'Programme native calculation running':'Native model calculation running';
    }
    if(native.task_state==='queued')return 'Waiting in the operator queue';
    if(native.task_state==='interrupted')return 'Operator reopened — retained work available';
    if(native.task_state==='cancelled')return 'Calculation stopped — retained work available';
    if(native.task_state==='failed'||native.run_state==='failed')return 'Calculation needs continuation';
    return 'Prepared native calculation';
  }
  function stageRows(native){
    const stages=native.stages||{},artifacts=native.artifacts||{};
    const models=native.selection?.models??['ndr','sdr'];
    const modelStatus=name=>stages[name]?'Complete':!models.includes(name)?'Not selected':native.run_state==='complete'?'No retained stage':'Waiting for a retained stage';
    return [
      ['Land-cover edit',stages.landcover,stages.landcover?'Retained':native.selection?.scenario_id?'Selected scenario':'—'],
      ['Nutrients · NDR',stages.ndr,modelStatus('ndr')],
      ['Sediment · SDR',stages.sdr,modelStatus('sdr')]
    ].map(([name,row,status])=>'<tr><th scope="row">'+esc(name)+'</th><td>'+esc(status)+'</td><td>'+esc(when(row?.completed_at))+'</td><td>'+esc(row?.files?Object.keys(row.files).length:row?.artifact?1:'—')+'</td></tr>').join('')+
      '<tr><th scope="row">Physical export rasters</th><td>'+Object.keys(artifacts).length+' retained</td><td>—</td><td>'+Object.keys(artifacts).length+'</td></tr>';
  }
  function paint(value){
    const node=current();if(!node)return;
    snapshot=value;const task=value.task,native=value.native_job;
    node.querySelector('[data-native-phase]').textContent=phase(native);
    node.querySelector('[data-native-elapsed]').textContent=duration(native.elapsed_seconds);
    node.querySelector('[data-native-memory]').textContent=bytes(native.resources?.resident_bytes);
    node.querySelector('[data-native-storage]').textContent=bytes(native.storage_free_bytes);
    node.querySelector('[data-native-heartbeat]').textContent=when(native.heartbeat_at);
    node.querySelector('[data-native-controls]').innerHTML=controls(task,native);
    node.querySelector('[data-native-stages]').innerHTML=stageRows(native);
    node.querySelector('[data-native-selection]').textContent=pretty({
      selection:native.selection,native_run_id:native.run_id,execution_id:native.execution_id,
      programme:native.programme_context});
    const reuse=node.querySelector('[data-native-reuse]');
    reuse.innerHTML=reuseMarkup(native);reuse.hidden=!reuse.innerHTML;
    const issue=native.run_error?.message||(task.error?.code==='NATIVE_DETACHED'?null:task.error?.message)||native.failure?.message;
    const error=node.querySelector('[data-native-error]');error.hidden=!issue;error.textContent=issue||'';
    const carry=node.querySelector('[data-native-continuation]');
    carry.textContent=native.run_error?.kind==='storage_exhausted'&&!native.alive
      ?native.run_error.recovery||'Make space on the recorded Workspace filesystem, then resume this same retained run.'
      :native.alive&&task.state==='interrupted'
      ?'The original calculation is still running. Reconnect to follow the same worker.'
      :native.stop_requested&&native.alive
      ?'Stop requested for this calculation. Completed native stages remain saved while the worker closes.'
      :native.run_state==='complete'
      ?'Open the native result to inspect the selected model outputs.'
      :'Completed native stages are retained in the selected run and reused by its next continuation.';
    if(value.log){
      const output=node.querySelector('[data-native-log]'),follow=node.querySelector('[data-native-follow]').checked;
      if(value.log.reset)output.textContent='';
      output.textContent+=value.log.text||'';
      if(output.textContent.length>700000){
        output.textContent='[Earlier displayed text trimmed. Use the source log stream to read it again.]\n'+output.textContent.slice(-600000);
      }
      offset=value.log.next_offset??offset;
      node.querySelector('[data-native-log-position]').textContent=bytes(offset)+' read of '+bytes(value.log.bytes);
      if(follow)output.scrollTop=output.scrollHeight;
    }
    node.querySelector('[data-native-record]').textContent=pretty({task,native_job:native});
  }
  async function update(){
    if(!current()||busy)return;
    busy=true;clearTimeout(timer);const id=selected,requestedWorkspace=workspace,epoch=generation;
    controller=new AbortController();
    try{
      const value=await api(endpoint('/api/native-job',{id,stream,offset,run_id:snapshot?.native_job?.run_id||'',execution_id:snapshot?.native_job?.execution_id||''}),{signal:controller.signal});
      if(epoch!==generation||selected!==id||getWorkspace()!==requestedWorkspace||!current())return;
      paint(value);
    }catch(error){
      if(epoch===generation&&error.name!=='AbortError'&&current()){
        const node=root().querySelector('[data-native-error]');node.hidden=false;node.textContent=error.message;
      }
    }finally{
      if(epoch===generation){busy=false;controller=null;
        if(current())timer=setTimeout(update,snapshot?.native_job?.alive?1700:3500);}
    }
  }
  function resetLog(nextStream=stream){generation++;clearTimeout(timer);controller?.abort();controller=null;busy=false;stream=nextStream;offset=0;root().querySelector('[data-native-log]').textContent='';return update();}
  async function open(id){
    detach();selected=id;workspace=getWorkspace();offset=0;stream='native';
    detail('Native calculation console',
      '<section class="native-console" data-native-console>'+
      '<h2 data-native-phase aria-live="polite">Opening retained calculation…</h2>'+
      '<p class="note" data-native-continuation></p>'+
      '<div class="native-metrics"><dl><dt>Elapsed</dt><dd data-native-elapsed>—</dd></dl>'+
      '<dl><dt>Worker memory</dt><dd data-native-memory>—</dd></dl>'+
      '<dl><dt>Workspace disk available</dt><dd data-native-storage>—</dd></dl>'+
      '<dl><dt>Last worker update</dt><dd data-native-heartbeat>—</dd></dl></div>'+
      '<div class="page-actions" data-native-controls></div>'+
      '<div class="notice error" data-native-error hidden></div>'+
      '<section data-native-reuse aria-live="polite" hidden></section>'+
      '<div class="table-scroll"><table><thead><tr><th>Native stage</th><th>Status</th><th>Saved at</th><th>Retained files</th></tr></thead><tbody data-native-stages></tbody></table></div>'+
      '<h3>Original worker output</h3><div class="native-log-controls">'+
      '<label>Log stream<select data-native-stream><option value="native">Native model log</option><option value="process">Worker process output</option></select></label>'+
      '<label class="check"><input type="checkbox" data-native-follow checked> Follow new output</label>'+
      '<span data-native-log-position></span>'+button('rewind','Read from start',id)+'</div>'+
      '<pre class="native-log" data-native-log tabindex="0" aria-label="Original model log"></pre>'+
      '<details><summary>Selected input identities</summary><pre data-native-selection></pre></details>'+
      '<details><summary>Retained task and process record</summary><pre data-native-record></pre></details>'+
      '</section>',{kind:'native-job',id});
    root().querySelector('[data-native-stream]').addEventListener('change',event=>{
      resetLog(event.target.value);
    });
    await update();
  }
  function taskActions(task){
    const supported=task?.action==='run.start'||task?.action==='compute.programme.run'||
      (task?.action==='compute.programme.pair-completion'&&task.payload?.run===true);
    return supported?'<div class="page-actions">'+button('open','Open calculation console',task.id)+'</div>':'';
  }
  function runActions(run){
    const tasks=(getState()?.tasks||[]).filter(task=>task.action==='run.start'&&task.payload?.run_id===run.id);
    return tasks.length?taskActions(tasks[0]):'';
  }
  async function dispatch(target){
    const action=target.dataset.action?.replace('native-job-',''),id=target.dataset.id;
    if(action==='open')return open(id);
    if(action==='refresh')return update();
    if(action==='rewind')return resetLog();
    if(action==='stop'||action==='resume'){
      target.disabled=true;
      try{
        await api('/api/task/'+(action==='stop'?'cancel':'resume'),{method:'POST',body:{id}});
        toast(action==='stop'?'Stop requested for the selected calculation.':'The retained calculation is continuing.');
        await refresh({force:true});await update();
      }finally{if(target.isConnected)target.disabled=false;}
      return;
    }
    if(action==='result'&&snapshot){const run=snapshot.native_job.run_id;detach();return openItem('runs',run);}
    if(action==='snapshot'&&snapshot){
      const body=pretty({schema:'upstate.native-operation-export/v1',saved_at:new Date().toISOString(),
                         task:snapshot.task,native_job:snapshot.native_job});
      const url=URL.createObjectURL(new Blob([body],{type:'application/json'}));
      const a=document.createElement('a');a.href=url;a.download='native-operation-'+short(snapshot.task.id)+'.json';a.click();
      setTimeout(()=>URL.revokeObjectURL(url),20000);
    }
  }
  document.querySelector('#detail-dialog').addEventListener('close',detach);
  return {open,dispatch,detach,taskActions,runActions};
}

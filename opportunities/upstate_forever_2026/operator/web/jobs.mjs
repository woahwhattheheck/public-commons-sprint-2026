import {nativePresentation,selectionMarkup,outputsMarkup,issueMarkup} from './native_presentation.mjs';
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

const observedBytes = value => value === 'max' ? 'Unlimited' : bytes(value);
const count = value => Number.isInteger(value) && value >= 0 ? value.toLocaleString() : '—';
function resourceMarkup(native){
  const saved=native.resource_observation;
  if(!saved?.values)return '';
  const value=saved.values,process=value.process||{},group=value.cgroup||{},cache=value.gdal_bytes||{};
  const metric=(label,content)=>'<dl><dt>'+esc(label)+'</dt><dd>'+esc(content)+'</dd></dl>';
  const limit=group['memory.max'],current=group['memory.current'];
  const share=Number.isFinite(current)&&Number.isFinite(limit)&&limit>0
    ?' ('+(100*current/limit).toLocaleString(undefined,{maximumFractionDigits:1})+'%)':'';
  const events=group['memory.events.local']||group['memory.events'];
  const metrics=[
    metric('Worker peak memory',bytes(process.VmHWM_bytes)),
    metric('Worker threads',count(process.threads)),
    ...(group.version===2?[
      metric('Group memory / limit',bytes(current)+' / '+observedBytes(limit)+share),
      metric('Group shared memory',bytes(group['memory.stat']?.shmem)),
      metric('Group peak memory',bytes(group['memory.peak']))
    ]:[]),
    ...(Object.keys(cache).length?[
      metric('GDAL cache used / maximum',bytes(cache.GetCacheUsed)+' / '+observedBytes(cache.GetCacheMax))
    ]:[])
  ];
  const settings=Object.entries(value.environment||{});
  const errors=value.read_errors||[];
  return '<h3>Memory and cache</h3><p class="note">'+
    (native.alive?'Saved worker observation':'Last saved worker observation')+' · '+esc(when(saved.observed_at))+
    (saved.source==='worker_start'?' · worker start':' · heartbeat')+'.</p>'+
    '<div class="native-metrics">'+metrics.join('')+'</div>'+
    (group.version===2?'<p class="note">Group values include other processes sharing this memory limit. Shared memory is part of file memory; these figures overlap.</p>':'')+
    (events?'<p>Group memory events'+(group['memory.events.local']?' (local)':'')+': '+[
      ['High threshold',events.high],['Limit reached',events.max],
      ['Out of memory',events.oom],['Processes killed',events.oom_kill]
    ].map(([label,total])=>esc(label)+' '+count(total)).join(' · ')+
    '.</p><p class="note">Event totals cover the group lifetime and do not identify the cause of this calculation\'s outcome.</p>':'')+
    (settings.length?'<details><summary>Inherited cache and thread settings</summary><div class="table-scroll"><table><thead><tr><th scope="col">Setting</th><th scope="col">Inherited value</th></tr></thead><tbody>'+
      settings.map(([name,raw])=>'<tr><th scope="row">'+esc(name)+'</th><td>'+esc(raw??'Not set')+'</td></tr>').join('')+
      '</tbody></table></div><p class="note">Values are shown as received by the worker. A cache maximum appears above after GDAL has initialized its cache.</p></details>':'')+
    (errors.length?'<details><summary>Unavailable observations ('+errors.length+')</summary><ul>'+errors.map(row=>'<li>'+esc(row.source||'Resource')+': '+esc(row.type||'Read error')+'</li>').join('')+'</ul></details>':'');
}

function reuseMarkup(native,state){
  const row=native.native_execution?.stage_reuse;
  if(!row)return '';
  const labels={searching:'Finding a retained stage',checking:'Checking original stage identity',
    comparing_original_inputs:'Comparing original scientific inputs',transferring:'Retaining verified outputs',
    complete:'Original stage retained',no_matching_stage:'Native calculation required'};
  const original=(state?.data?.runs||[]).find(value=>value.id===row.source_run_id);
  const scenario=(state?.data?.scenarios||[]).find(value=>value.id===original?.selection?.scenario_id);
  const source=row.source_run_id?'<p>Original saved case: '+esc(scenario?.title||'Retained scientific run')+'</p><details><summary>Original source run identity</summary><code>'+esc(row.source_run_id)+'</code></details>':'';
  const file=row.current_file?'<p>Current file: '+esc(String(row.current_file).split(/[\\/]/).pop())+'</p>':'';
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
  const renderedMarkup=new WeakMap();
  function markup(node,body){
    if(renderedMarkup.get(node)===body)return;
    const disclosures=Array.from(node.querySelectorAll('details')).map(item=>({label:item.querySelector('summary')?.textContent,open:item.open,focused:item.querySelector('summary')===document.activeElement}));
    const focused=document.activeElement;
    const buttonFocus=focused&&node.contains(focused)&&focused.matches('button[data-action]')?{action:focused.dataset.action,id:focused.dataset.id,kind:focused.dataset.kind}:null;
    node.innerHTML=body;renderedMarkup.set(node,body);
    for(const item of node.querySelectorAll('details')){
      const previous=disclosures.find(row=>row.label===item.querySelector('summary')?.textContent);
      if(previous){item.open=previous.open;if(previous.focused)item.querySelector('summary')?.focus({preventScroll:true});}
    }
    if(buttonFocus){const next=Array.from(node.querySelectorAll('button[data-action]')).find(button=>button.dataset.action===buttonFocus.action&&button.dataset.id===buttonFocus.id&&button.dataset.kind===buttonFocus.kind);if(next&&!next.disabled)next.focus({preventScroll:true});}
  }
  function current(){return selected&&getWorkspace()===workspace&&getDetailContext()?.kind==='native-job'&&getDetailContext()?.id===selected&&root();}
  function detach(){generation++;clearTimeout(timer);timer=null;controller?.abort();controller=null;selected=null;snapshot=null;busy=false;}
  function controls(task,native){
    const id=task.id;let html=button('refresh','Refresh',id);
    if(task.state==='queued')html+=button('stop','Cancel queued run',id);
    else if(native.alive||(native.ensemble_context&&task.state==='running'))html+=button('stop',native.stop_requested?'Stop requested':native.ensemble_context?'Stop saved ensemble':native.programme_context?'Stop calculation and pause programme':'Stop calculation',id,native.stop_requested);
    if(['failed','interrupted','cancelled'].includes(task.state))html+=button('resume',native.alive?'Reconnect to calculation':'Resume retained run',id);
    html+=button('result','Open saved maps and results',id)+button('snapshot','Download operation record',id);
    return html;
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
    node.querySelector('[data-native-connection]').hidden=true;
    snapshot=value;const task=value.task,native=value.native_job;
    const view=nativePresentation(value,getState());
    node.querySelector('[data-native-phase]').textContent=view.heading;
    node.querySelector('[data-native-guidance]').textContent=view.message;
    markup(node.querySelector('[data-native-case]'),selectionMarkup(view));
    const ensemble=native.ensemble_context,ensembleNode=node.querySelector('[data-native-ensemble]');
    ensembleNode.hidden=!ensemble;
    if(ensemble)ensembleNode.textContent=(ensemble.ensemble_title||'Saved ensemble')+' · original run '+ensemble.run_number+' of '+ensemble.run_count+'. '+[...new Set((ensemble.bindings||[]).map(row=>row.member_label).filter(Boolean))].join(' · ')+'. Completed cases stay available; stop or reconnect continues this same saved design.';
    markup(node.querySelector('[data-native-outputs]'),outputsMarkup(view));
    node.querySelector('[data-native-elapsed]').textContent=duration(native.elapsed_seconds);
    const retainedMemory=native.resource_observation?.values?.process?.VmRSS_bytes;
    const liveMemory=Number.isFinite(native.resources?.resident_bytes);
    node.querySelector('[data-native-memory]').textContent=bytes(liveMemory?native.resources.resident_bytes:retainedMemory);
    node.querySelector('[data-native-memory-label]').textContent=liveMemory||!Number.isFinite(retainedMemory)?'Worker memory':'Last worker memory';
    const resource=node.querySelector('[data-native-resources]');
    const previousDetails=Array.from(resource.querySelectorAll('details'));
    const resourceDetails=previousDetails.map(item=>item.open);
    const focusedDetail=previousDetails.findIndex(item=>item.querySelector('summary')===document.activeElement);
    resource.innerHTML=resourceMarkup(native);resource.hidden=!resource.innerHTML;
    Array.from(resource.querySelectorAll('details')).forEach((item,index)=>{
      item.open=Boolean(resourceDetails[index]);
      if(index===focusedDetail)item.querySelector('summary')?.focus({preventScroll:true});
    });
    node.querySelector('[data-native-storage]').textContent=bytes(native.storage_free_bytes);
    node.querySelector('[data-native-heartbeat]').textContent=when(native.heartbeat_at);
    markup(node.querySelector('[data-native-controls]'),controls(task,native));
    node.querySelector('[data-native-stages]').innerHTML=stageRows(native);
    node.querySelector('[data-native-selection]').textContent=pretty({
      selection:native.selection,native_run_id:native.run_id,execution_id:native.execution_id,
      programme:native.programme_context,parameter_study:native.study_context,ensemble:native.ensemble_context});
    const reuse=node.querySelector('[data-native-reuse]');
    markup(reuse,reuseMarkup(native,getState()));reuse.hidden=!reuse.innerHTML;
    const error=node.querySelector('[data-native-error]');
    const issueDetailsOpen=Boolean(error.querySelector('details')?.open);
    const issueSummaryFocused=error.querySelector('summary')===document.activeElement;
    error.hidden=!view.problem;error.innerHTML=issueMarkup(view);
    const issueDetails=error.querySelector('details');
    if(issueDetails){issueDetails.open=issueDetailsOpen;if(issueSummaryFocused)issueDetails.querySelector('summary').focus({preventScroll:true});}
    const carry=node.querySelector('[data-native-continuation]');
    carry.textContent=view.retainedText;
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
        const node=root().querySelector('[data-native-connection]');node.hidden=false;node.textContent='The current calculation state could not be refreshed. Your saved operation remains selected. '+error.message;
      }
    }finally{
      if(epoch===generation){busy=false;controller=null;
        if(current())timer=setTimeout(update,snapshot?.native_job?.alive?1700:3500);}
    }
  }
  function resetLog(nextStream=stream){generation++;clearTimeout(timer);controller?.abort();controller=null;busy=false;stream=nextStream;offset=0;root().querySelector('[data-native-log]').textContent='';return update();}
  async function open(id){
    detach();selected=id;workspace=getWorkspace();offset=0;stream='native';
    detail('Scientific calculation',
      '<section class="native-console" data-native-console>'+
      '<h2 data-native-phase aria-live="polite">Opening retained calculation…</h2>'+
      '<p class="note" data-native-guidance></p><section data-native-case></section>'+ 
      '<p class="note" data-native-continuation></p><p class="note" data-native-ensemble hidden></p>'+
      '<div class="native-metrics"><dl><dt>Elapsed</dt><dd data-native-elapsed>—</dd></dl>'+
      '<dl><dt data-native-memory-label>Worker memory</dt><dd data-native-memory>—</dd></dl>'+
      '<dl><dt>Workspace disk available</dt><dd data-native-storage>—</dd></dl>'+
      '<dl><dt>Last worker update</dt><dd data-native-heartbeat>—</dd></dl></div>'+
      '<div class="page-actions" data-native-controls></div>'+
      '<p class="notice error" data-native-connection hidden role="status"></p><section data-native-error hidden></section>'+
      '<section data-native-reuse aria-live="polite" hidden></section>'+
      '<section data-native-resources hidden></section>'+
      '<div class="table-scroll"><table><thead><tr><th>Native stage</th><th>Status</th><th>Saved at</th><th>Retained files</th></tr></thead><tbody data-native-stages></tbody></table></div>'+
      '<section data-native-outputs></section>'+ 
      '<details data-native-technical><summary>Original worker log and support observations</summary>'+ 
      '<h3>Original worker output</h3><div class="native-log-controls">'+
      '<label>Log stream<select data-native-stream><option value="native">Native model log</option><option value="process">Worker process output</option></select></label>'+
      '<label class="check"><input type="checkbox" data-native-follow checked> Follow new output</label>'+
      '<span data-native-log-position></span>'+button('rewind','Read from start',id)+'</div>'+
      '<pre class="native-log" data-native-log tabindex="0" aria-label="Original model log"></pre></details>'+
      '<details><summary>Selected input identities</summary><pre data-native-selection></pre></details>'+
      '<details><summary>Retained task and process record</summary><pre data-native-record></pre></details>'+
      '</section>',{kind:'native-job',id});
    root().querySelector('[data-native-stream]').addEventListener('change',event=>{
      resetLog(event.target.value);
    });
    await update();
  }
  function taskActions(task){
    const supported=task?.action==='run.start'||task?.action==='compute.programme.run'||task?.action==='parameter-study.run'||task?.action==='ensemble.run'||
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
    if(!current())return;
    if(action==='input'){
      const kind=target.dataset.kind;
      if(!['profiles','scenarios','grids'].includes(kind))return;
      const wanted=snapshot?.native_job?.selection?.[kind==='profiles'?'profile_id':kind==='scenarios'?'scenario_id':'grid_id'];
      if(id!==wanted)return;
      detach();return openItem(kind,id);
    }
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

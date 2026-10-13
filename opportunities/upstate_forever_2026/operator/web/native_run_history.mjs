/** Selected native histories over the existing run desk, queue and downloads. */
import {nativeTiming} from './journey.mjs';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const id=/^[0-9a-f]{64}$/;
const list=value=>Array.isArray(value)?value:[];
const stable=value=>JSON.stringify(value,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const equal=(a,b)=>stable(a)===stable(b);
const seconds=value=>Number.isFinite(value)?new Intl.NumberFormat(undefined,{maximumFractionDigits:3}).format(value)+' s':'Not recorded';
const when=value=>value?esc(value):'Not recorded';
const button=(action,label,values={},disabled=false)=>'<button type="button" class="small" data-action="run-desk-history-'+action+'"'+Object.entries(values).map(([key,value])=>' data-'+key+'="'+esc(value)+'"').join('')+(disabled?' disabled':'')+'>'+esc(label)+'</button>';
const table=(headers,rows)=>'<div class="table-scroll"><table><thead><tr>'+headers.map(v=>'<th scope="col">'+esc(v)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(v=>'<td>'+esc(v??'Not recorded')+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';

export function attachNativeRunHistory({getState,api,getRunIds,submitOriginal,openItem,showTask,onChange}){
 const contexts=new Map();
 let active=null,disposed=false;
 function context(workspace){
  if(!workspace)throw Error('Select the original scientific workspace.');
  if(!contexts.has(workspace))contexts.set(workspace,{workspace,title:'Native execution history',catalog:null,preview:null,error:'',busy:false,epoch:0,readEpoch:0,read:null,taskSignature:'',lastTask:null});
  return contexts.get(workspace);
 }
 function changed(){if(!disposed)onChange();}
 function current(c){return !disposed&&getState()?.workspace_key===c.workspace&&active===c;}
 function selection(c){
  const run_ids=[...new Set(list(getRunIds()).filter(value=>id.test(value)))];
  if(!run_ids.length)throw Error('Check at least one prepared native run in the run matrix.');
  const title=c.title.trim();
  if(!title||title.length>240)throw Error('Name the execution history in at most 240 characters.');
  return {run_ids,title};
 }
 function originalTasks(c){
  return list(getState()?.tasks).filter(row=>row.workspace===c.workspace&&row.action==='run.history.save')
   .sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')));
 }
 async function loadCatalog(c,force=false){
  if(c.read)return c.read;
  if(c.catalog&&!force)return;
  const epoch=++c.readEpoch,lifecycle=c.epoch;
  const job=Promise.resolve().then(async()=>{
   try{
    const value=await api('/api/native-run-history/catalog?workspace='+encodeURIComponent(c.workspace));
    if(!current(c)||epoch!==c.readEpoch||lifecycle!==c.epoch)return;
    if(value?.schema!=='upstate.native-run-history-catalog/v1'||value.workspace_key!==c.workspace||
       value.project_id!==getState()?.data?.project?.id||!Array.isArray(value.histories))
     throw Error('The saved execution histories belong to another original workspace.');
    c.catalog=value;c.error='';
   }catch(error){if(current(c)&&epoch===c.readEpoch&&lifecycle===c.epoch)c.error=error.message;}
   finally{if(c.read===job)c.read=null;if(current(c))changed();}
  });
  c.read=job;return job;
 }
 function update(snapshot){
  disposed=false;
  const c=context(snapshot?.workspace_key);
  if(active!==c){if(active)active.epoch++;active=c;}
  const signature=list(snapshot.tasks).filter(task=>task.workspace===c.workspace&&task.action==='run.history.save')
   .map(task=>task.id+':'+task.state).join('|');
  if(signature!==c.taskSignature){c.taskSignature=signature;loadCatalog(c,true);}
  else if(!c.catalog&&!c.read&&!c.error)loadCatalog(c);
 }
 function change(event){
  if(event.target?.dataset.nativeHistoryField!=='title')return false;
  const c=context(getState()?.workspace_key);
  c.title=event.target.value;
  // The original run desk preserves this field's focus and caret on repaint.
  changed();return true;
 }
 function render(){
  const c=active;
  if(!c||getState()?.workspace_key!==c.workspace)return '';
  const selectedIds=[...new Set(list(getRunIds()).filter(value=>id.test(value)))];
  const preview=c.preview;
  const matched=preview&&equal(preview.selection?.run_ids,selectedIds)&&preview.selection?.title===c.title.trim();
  const currentTask=originalTasks(c).find(task=>equal(task.payload?.selection?.run_ids,selectedIds)&&task.payload?.selection?.title===c.title.trim())||c.lastTask;
  const rows=list(getState()?.data?.runs).filter(row=>selectedIds.includes(row.id));
  const quick=rows.map(run=>{
   const tasks=list(getState()?.tasks).filter(task=>task.workspace===c.workspace&&task.action==='run.start'&&task.payload?.run_id===run.id)
    .sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')));
   const timing=nativeTiming(run,tasks[0]);
   return [run.id,timing.label,timing.stages.length,timing.reused_stages];
  });
  let content='<section class="section" data-native-history><header class="section-header"><div><h2>Retain actual execution history</h2><p>Read the original attempts, model stages and verified reuse for the checked prepared runs. Save a portable history without queueing a model.</p></div></header><div class="section-body">'+
   '<label>History title<input data-native-history-field="title" data-rd-focus="native-history-title" maxlength="240" value="'+esc(c.title)+'"'+(c.busy?' disabled':'')+'></label>'+
   '<div class="rd-row-actions">'+button('preview','Review selected history ('+selectedIds.length+')',{},c.busy||!selectedIds.length)+
   button('save','Save history and handover',{},c.busy||!matched)+button('refresh','Refresh saved histories',{},c.busy||!!c.read)+'</div>';
  if(c.busy)content+='<p role="status">Reading or retaining the original execution history…</p>';
  if(c.error)content+='<p class="notice" role="alert">'+esc(c.error)+'</p>';
  if(currentTask)content+='<p>Original history operation: '+esc(currentTask.state)+' '+button('task','Open original task',{id:currentTask.id})+'</p>';
  if(quick.length&&!preview)content+='<p class="note">Current stage summary from the existing Journey timing reader. Review the full original history to include retained attempts and reuse transfers.</p>'+table(['Run','Current timing state','Retained native stages','Reused stages'],quick);
  if(preview){
   if(!matched)content+='<p class="notice">The checked runs or title changed. Review the current selection before saving.</p>';
   const summary=preview.summary,a=summary.attempt_intervals,n=summary.local_stage_intervals;
   content+='<h3>Recorded intervals in this preview</h3>'+table(['Measure','Elapsed','Coverage'],[
    ['Attempt intervals, overlap counted once',seconds(a.union_seconds),a.closed_records+' closed / '+a.records+' recorded attempts'],
    ['Earliest start to latest end, including gaps',seconds(a.span_seconds),summary.runs_without_attempts+' runs without retained attempts'],
    ['Local native-stage intervals, overlap counted once',seconds(n.union_seconds),n.closed_records+' closed / '+n.records+' local stages'],
    ['Reuse transfer intervals, overlap counted once',seconds(summary.reuse_transfer_intervals.union_seconds),summary.reused_stage_count+' reused stages']
   ]);
   content+='<h3>Original attempts</h3>'+table(['Run','Attempt','State / phase','Started','Ended','Duration','Bounds'],preview.attempts.map(row=>[
    row.run_id,row.attempt??row.position,(row.state??'Unknown')+' / '+(row.phase??'Unknown'),
    row.interval.started_at,row.interval.ended_at,seconds(row.interval.seconds),row.interval.status]));
   content+='<h3>Calculation and reuse</h3>'+table(['Run','Model','Origin','Original calculation','Local calculation','Transfer','Original donor'],preview.stages.map(row=>[
    row.run_id,row.model.toUpperCase(),row.origin,seconds(row.original_calculation.seconds),
    row.local_calculation?seconds(row.local_calculation.seconds):'Inherited donor calculation',
    row.transfer?seconds(row.transfer.seconds):'Not applicable',row.reuse_lineage[0]?.run_id||'This run']));
   content+='<details><summary>How to interpret the recorded durations</summary><ul>'+preview.interpretation.map(note=>'<li>'+esc(note)+'</li>').join('')+'</ul></details>';
  }
  content+='<h3>Saved execution histories</h3>';
  if(!c.catalog)content+='<p>'+(c.read?'Reading saved histories…':'Use Refresh saved histories to load this workspace.')+'</p>';
  else if(!c.catalog.histories.length)content+='<p>No execution history has been saved in this workspace yet.</p>';
  else content+=c.catalog.histories.map(row=>'<article class="rd-comparison"><div><h4>'+esc(row.title)+'</h4><p>'+row.selection.run_ids.length+' original runs · '+when(row.captured_at)+'</p><small>'+esc(row.id)+'</small></div><div class="rd-row-actions">'+button('open','Open history and downloads',{id:row.id})+'</div></article>').join('');
  return content+'</div></section>';
 }
 async function dispatch(buttonNode){
  const action=buttonNode.dataset.action?.replace(/^run-desk-history-/,'');
  const c=context(getState()?.workspace_key);
  if(action==='open')return openItem('native-run-histories',buttonNode.dataset.id);
  if(action==='task')return showTask(buttonNode.dataset.id);
  if(action==='refresh')return loadCatalog(c,true);
  if(c.busy)return;
  if(!['preview','save'].includes(action))throw Error('Choose a native execution history control.');
  const chosen=selection(c),workspace=c.workspace,epoch=c.epoch;
  c.error='';c.busy=true;changed();
  try{
   if(action==='preview'){
    const value=await api('/api/native-run-history/preview',{method:'POST',body:{workspace,selection:chosen}});
    if(!current(c)||epoch!==c.epoch)throw Error('The selected workspace changed while reading the original history.');
    if(value?.schema!=='upstate.native-run-history/v1'||value.workspace_key!==workspace||
       value.project_id!==getState()?.data?.project?.id||!id.test(value.id||'')||
       !equal(value.selection,chosen)||!Array.isArray(value.attempts)||!Array.isArray(value.stages))
     throw Error('The history preview differs from the selected original native runs.');
    c.preview=value;
   }else{
    const value=c.preview;
    if(!value||!equal(value.selection,chosen))throw Error('Review the current selected history before saving.');
    const payload={selection:JSON.parse(JSON.stringify(value.selection)),expected_preview_id:value.id};
    const result=await submitOriginal(workspace,'run.history.save',payload);
    if(!current(c))return;
    const task=result?.task;
    if(!task||task.workspace!==workspace||task.action!=='run.history.save'||
       !equal(task.payload,payload)||!id.test(task.id||''))throw Error('The original history task returned another selection.');
    // Save the accepted native task before catalogue reads so a transient read
    // failure cannot discard a completed or still-running original operation.
    c.lastTask=task;
    if(task.state==='complete'&&id.test(task.result?.id||'')){
     await loadCatalog(c,true);
     if(current(c))return openItem('native-run-histories',task.result.id);
    }else return showTask(task.id);
   }
  }catch(error){if(current(c))c.error=error.message;throw error;}
  finally{c.busy=false;if(current(c))changed();}
 }
 function detach(){disposed=true;if(active)active.epoch++;active=null;}
 return {update,render,change,dispatch,detach};
}

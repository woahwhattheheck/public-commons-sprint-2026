/* Add report-source actions to the maintained paired-raster desk.
 * The original controller still owns designs, native execution, task polling,
 * result selection and downloads. This adapter adds actions beside its existing
 * export controls, without replacing its templates or scientific controls.
 */
import {attachPairedEnsembles} from './paired_ensemble_desk.mjs';

const ACTION='paired_ensemble.report_source';
const terminal=state=>['complete','failed','cancelled','canceled'].includes(state);
const clone=value=>JSON.parse(JSON.stringify(value));

export function attachPairedEnsembleReports(context){
  const document=context.document||globalThis.document;
  let root=null,key=null,epoch=0,listeners=null,observer=null,request=null;
  let submitting=false,settling=null,recovery=null,latestTask=null;
  const storageKey=workspace=>'upstate-paired-ensemble-report:'+workspace;
  const active=(token,workspace)=>root&&token===epoch&&workspace===key&&workspace===context.getState()?.workspace_key;
  const same=record=>request&&record.workspace===request.workspace&&record.operation_id===request.operation_id;
  function notice(text,error=false){
    const node=root?.querySelector('[data-pe-report-notice]');
    if(node){node.hidden=!text;node.textContent=text;node.setAttribute('role',error?'alert':'status');}
  }
  function save(record){
    try{globalThis.sessionStorage?.setItem(storageKey(record.workspace),JSON.stringify(record));}
    catch{/* Original queued requests and source files remain authoritative. */}
  }
  function restore(){
    request=null;
    try{
      const value=JSON.parse(globalThis.sessionStorage?.getItem(storageKey(key))||'null');
      if(value?.workspace===key&&value.action===ACTION&&value.operation_id&&value.payload?.ensemble_id)request=value;
    }catch{/* An unreadable browser draft cannot change retained results. */}
  }
  function enhance(){
    if(!root)return;
    const busy=submitting||!!(request?.task_id&&!terminal(request.task_state));
    for(const original of root.querySelectorAll('[data-pe-action="export"][data-id]')){
      let button=original.nextElementSibling;
      if(button?.dataset.peReportSource!==original.dataset.id){
        button=document.createElement('button');button.type='button';
        button.dataset.peReportSource=original.dataset.id;
        button.textContent='Add to scientific report';
        original.after(button);
      }
      const disabled=original.disabled||busy;
      if(button.disabled!==disabled)button.disabled=disabled;
    }
    if(!root.querySelector('[data-pe-report-notice]')){
      const anchor=root.querySelector('[data-pe-products]');
      if(anchor){const node=document.createElement('p');node.dataset.peReportNotice='';node.className='pe-notice';node.hidden=true;node.setAttribute('role','status');anchor.before(node);}
    }
  }
  function recordTask(task,record=request){
    if(!record||task?.action!==ACTION||task.workspace!==record.workspace)return null;
    if(record.task_id&&record.task_id!==task.id)return null;
    if(task.payload?.ensemble_id&&task.payload.ensemble_id!==record.payload.ensemble_id)
      throw Error('The retained report task selects another paired ensemble.');
    if(terminal(record.task_state)&&!terminal(task.state))return record;
    const next={...record,task_id:task.id,task_state:task.state};
    if(same(record))request=next;
    if(same(next))latestTask=task;
    save(next);enhance();return next;
  }
  async function finish(task,record=request){
    if(!record||record.handed_off||(same(record)&&request.handed_off)||task.state!=='complete'||task.id!==record.task_id)return;
    const token=epoch,workspace=record.workspace,operation=record.operation_id;
    if(!active(token,workspace)||!same(record)||settling===operation)return;
    settling=operation;
    try{
      const detail=task.result?.source_choice?task:
        await context.api('/api/task?'+new URLSearchParams({workspace,id:task.id}));
      if(!active(token,workspace)||!same(record))return;
      if(detail.action!==ACTION||detail.workspace!==workspace||detail.state!=='complete'||detail.id!==record.task_id)
        throw Error('The retained scientific report task changed identity.');
      const result=detail.result,choice=result?.source_choice;
      if(result?.ensemble_id!==record.payload.ensemble_id||!choice?.source_collection_id||!choice?.source_id)
        throw Error('The complete task must identify its original ensemble scientific source.');
      if(typeof context.openScientificReport!=='function')
        throw Error('Receive the maintained scientific report composer to open this source.');
      await context.openScientificReport({workspace_key:workspace,sources:[choice],title:result.title});
      // Navigation may detach this desk. Save only the completed originating
      // request; never copy its handoff state into a newly selected workspace.
      const completed={...record,task_state:'complete',handed_off:true};
      save(completed);if(same(record))request=completed;
      if(active(token,workspace))notice('The complete ensemble source is added to the scientific report selection.');
    }finally{if(settling===operation)settling=null;}
  }
  function observeTask(task){
    if(!request?.task_id||task?.id!==request.task_id||task?.workspace!==request.workspace||task?.action!==ACTION)return;
    const record=recordTask(task);
    if(record&&task.state==='complete')finish(task,record).catch(error=>notice(error.message,true));
    else if(record&&terminal(task.state))notice(task.error?.message||'The retained report task '+task.state+'. Select the result again to resume its source capture.',true);
  }
  function withTask(state){
    if(!latestTask||state?.workspace_key!==latestTask.workspace||latestTask.id!==request?.task_id)return state;
    const tasks=state.tasks||[],old=tasks.find(row=>row.id===latestTask.id);
    if(old&&terminal(old.state)&&!terminal(latestTask.state))return state;
    return {...state,tasks:old?tasks.map(row=>row.id===latestTask.id?{...row,...latestTask}:row):[latestTask,...tasks]};
  }
  // Reuse the original controller's one-task polling and refresh lifecycle.
  // A saved task remains followable even when absent from a recent task list.
  const native=attachPairedEnsembles({...context,getState:()=>withTask(context.getState()),api:async(...args)=>{
    const value=await context.api(...args);observeTask(value);return value;
  }});
  function follow(task){
    if(!root||!['queued','running'].includes(task.state))return;
    // Select this accepted task through the maintained desk's own Follow action.
    root.querySelector('[data-pe-action="watch"][data-id="'+task.id+'"]')?.click();
  }
  async function submit(ensembleId,{resume=null}={}){
    if(submitting)return;
    const token=epoch,workspace=key;
    if(!active(token,workspace))throw Error('Open this result in its original workspace.');
    if(!/^[0-9a-f]{64}$/.test(ensembleId))throw Error('Choose a retained paired ensemble result.');
    if(typeof context.openScientificReport!=='function')throw Error('Receive the maintained scientific report composer to add this source.');
    let record=resume;
    if(!record){
      const old=request?.payload?.ensemble_id===ensembleId?request:null;
      record=old&&old.task_state!=='failed'&&old.task_state!=='cancelled'&&old.task_state!=='canceled'?
        {...old,handed_off:false}:{workspace,action:ACTION,payload:{ensemble_id:ensembleId},operation_id:crypto.randomUUID()};
    }
    if(record.workspace!==workspace||record.action!==ACTION)throw Error('The saved request belongs to another workspace.');
    request=record;save(record);submitting=true;enhance();
    notice('Retaining the complete ensemble source in the original queue…');
    try{
      const task=record.task_id&&record.task_state==='complete'?
        await context.api('/api/task?'+new URLSearchParams({workspace,id:record.task_id})):
        await context.api('/api/actions',{method:'POST',body:{workspace,action:ACTION,payload:clone(record.payload),operation_id:record.operation_id}});
      if(task.workspace!==workspace||task.action!==ACTION||!task.id)throw Error('The queued report task belongs to another workspace or action.');
      const accepted=recordTask(task,record);
      if(!active(token,workspace)||!same(accepted))return;
      await context.refresh?.({force:true});
      if(!active(token,workspace)||!same(accepted))return;
      native.update(withTask(context.getState()));
      follow(task);
      if(task.state==='complete')await finish(task,accepted);
      else notice('The original queue is preparing the complete ensemble scientific source.');
    }finally{if(token===epoch){submitting=false;enhance();}}
  }
  function cleanup(){
    epoch++;listeners?.abort();observer?.disconnect();listeners=null;observer=null;
    root=null;key=null;submitting=false;settling=null;recovery=null;latestTask=null;
  }
  async function mount(container,state=context.getState()){
    cleanup();root=container;key=state?.workspace_key;const token=epoch,workspace=key;
    restore();listeners=new AbortController();
    root.addEventListener('click',event=>{
      const button=event.target.closest?.('[data-pe-report-source]');
      if(!button||!root?.contains(button))return;
      event.preventDefault();event.stopPropagation();
      submit(button.dataset.peReportSource).catch(error=>{if(active(token,workspace))notice(error.message,true);});
    },{signal:listeners.signal});
    observer=new MutationObserver(enhance);
    observer.observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled']});
    await native.mount(container,state);
    if(!active(token,workspace))return;
    enhance();
    // An interrupted POST is retried with its original operation identity.
    // Already accepted tasks instead continue through the existing desk poller.
    if(request&&!request.task_id&&!request.handed_off){
      const original=request;recovery=original.operation_id;
      try{await submit(original.payload.ensemble_id,{resume:original});}
      catch(error){if(active(token,workspace))notice(error.message,true);}
      finally{if(recovery===original.operation_id)recovery=null;}
    }
    if(request?.task_id&&!request.handed_off&&!['failed','cancelled','canceled'].includes(request.task_state)){
      try{
        const task=await context.api('/api/task?'+new URLSearchParams({workspace,id:request.task_id}));
        if(active(token,workspace))observeTask(task);
      }catch(error){if(active(token,workspace))notice(error.message,true);}
    }
    update(context.getState());
    if(latestTask)follow(latestTask);
  }
  function update(state=context.getState()){
    state=withTask(state);
    native.update(state);
    if(!root||state?.workspace_key!==key)return;
    enhance();
    const task=(state.tasks||[]).find(row=>row.id===request?.task_id&&row.workspace===key);
    if(task)observeTask(task);
  }
  function detach(){cleanup();native.detach();}
  return {...native,mount,update,detach};
}

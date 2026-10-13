import {createManagementDesignComparison,DESIGN_COMPARE_ACTION} from './climate_management_working_comparison.mjs';
import {createManagementWorking,validateManagementDraft} from './climate_management_working.mjs';
import {managementResultsMarkup,reconcileManagementView,managementGISRequest} from './climate_management_explorer.mjs';
/* TokenJunkieLabs. Native management responses across explicitly mapped forcing periods. */
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone=v=>structuredClone(v);
const fmt=v=>typeof v==='number'&&Number.isFinite(v)?v.toLocaleString(undefined,{maximumSignificantDigits:8}):v==null?'—':String(v);
const opt=(v,t,s)=>'<option value="'+esc(v)+'"'+(v===s?' selected':'')+'>'+esc(t)+'</option>';
const btn=(a,t,extra='')=>'<button type="button" data-cm="'+a+'" '+extra+'>'+esc(t)+'</button>';
const detail=(t,v)=>'<details><summary>'+esc(t)+'</summary><pre>'+esc(JSON.stringify(v,null,2))+'</pre></details>';
const ACTIONS=new Set(['climate-management.build','climate-management.working.save','climate-management.working.export',DESIGN_COMPARE_ACTION]);
const done=s=>['complete','failed','cancelled','interrupted'].includes(s);
const pairKey=v=>v?.study_id&&v?.case_id?JSON.stringify([v.study_id,v.case_id]):'';
const emptyPeriod=n=>({id:'period-'+n,label:'Period '+n,reference:{study_id:'',case_id:''},treatment:{study_id:'',case_id:''}});
const fresh=()=>({title:'Management across climate forcing',purpose:'',reference_period_id:'period-1',periods:[emptyPeriod(1),emptyPeriod(2)],reporting_areas:[],difference_maps:true});
const areaKey=a=>JSON.stringify([a.source_collection_id,a.source_id,a.layer||'']);
const roleLabel={reference:'Reference scenario',treatment:'Treatment scenario',control:'Control scenario'};
export function createClimateManagement(context){
  const {api,getState}=context;
  let root=null,workspace=null,epoch=0,serial=0,revision=0,listener=null,timer=null,busy=false,polling=false;
  let catalog=null,draft=fresh(),preview=null,report=null,selectedId='',control=false,pending=[],tasks=[];
  let error='',notice='',storageNotice='',resultView={};
  const controllers=new Set();
  const $=s=>root?.querySelector(s),$$=s=>[...(root?.querySelectorAll(s)||[])];
  const current=(w,e)=>!!root&&workspace===w&&epoch===e&&getState()?.workspace_key===w;
  const storageKey=()=> 'upstate.climate-management.v1:'+workspace;
  const url=(op,values={})=>'/api/climate-management/'+op+'?'+new URLSearchParams({workspace,...values});
  function persist(){
    try{sessionStorage.setItem(storageKey(),JSON.stringify({draft,control,selectedId,pending,tasks,resultView,working:working.snapshot(),designComparison:designComparison.snapshot()}));storageNotice='';}
    catch(_){storageNotice='Browser draft storage is unavailable. Keep this view open until pending operations are acknowledged; the operator retains submitted tasks.';}
  }
  function restore(){
    try{
      const x=JSON.parse(sessionStorage.getItem(storageKey())||'null');
      if(!x)return;
      if(x.draft)draft=validateManagementDraft({schema:'upstate.climate-management-working-draft/v1',selection:x.draft}).selection;
      resultView=x.resultView&&typeof x.resultView==='object'?x.resultView:{};
      control=x.control===true;selectedId=typeof x.selectedId==='string'?x.selectedId:'';
      pending=Array.isArray(x.pending)?x.pending.filter(t=>t?.workspace===workspace&&ACTIONS.has(t.action)&&t.operation_id&&t.payload):[];
      tasks=Array.isArray(x.tasks)?x.tasks.filter(t=>t?.id&&(!t.workspace||t.workspace===workspace)&&ACTIONS.has(t.action)):[];
      if(x.working)working.restore(x.working);
      if(x.designComparison)designComparison.restore(x.designComparison);
    }catch(_){storageNotice='The browser draft could not be read. Open a retained report or prepare a new comparison.';}
  }
  async function request(path,options={}){
    const c=new AbortController();controllers.add(c);
    try{return await api(path,{...options,signal:c.signal});}finally{controllers.delete(c);}
  }
  const working=createManagementWorking({
    getDraft:()=>draft,
    setDraft:value=>{draft=validateManagementDraft({schema:'upstate.climate-management-working-draft/v1',selection:value}).selection;control=draft.periods.some(p=>!!p.control);preview=null;report=null;selectedId='';revision++;},
    workspace:()=>workspace,token:()=>[workspace,epoch],current:token=>current(...token),
    persist,render,read:(op,args)=>request(url(op,args)),
    send:async submission=>{if(!pending.some(p=>p.operation_id===submission.operation_id))pending.push(submission);persist();return send(submission);},
    submit:async(action,payload)=>{const submission={workspace,action,payload,operation_id:crypto.randomUUID()};pending.push(submission);persist();return send(submission);},
    openStudy:row=>context.openDesk('study-transfer','openForStudies',{workspace_key:workspace,roots:[row]})
  });
  const designComparison=createManagementDesignComparison({
    workspace:()=>workspace,projectId:()=>catalog?.workspace_id,token:()=>[workspace,epoch],current:token=>current(...token),
    persist,render,read:(op,args)=>request(url(op,args)),
    preview:selection=>request(url('working-comparison-preview'),{method:'POST',body:{workspace,selection}}),
    submit:async(action,payload)=>{if(pending.length)throw Error('Reconcile the original pending request before saving another handover.');const submission={workspace,action,payload,operation_id:crypto.randomUUID()};pending.push(submission);persist();return send(submission);},
    openStudy:row=>context.openDesk('study-transfer','openForStudies',{workspace_key:workspace,roots:[row]})
  });
  async function openWorkingComparison(value){
    if(busy)throw Error('Wait for the current Management action before opening a design handover.');
    if(!root||value?.workspace_key!==workspace||getState()?.workspace_key!==workspace)
      throw Error('Open the original receiving workspace before its saved-design comparison.');
    const w=workspace,e=epoch;busy=true;render();
    try{
      if(!catalog)await refresh();
      if(!current(w,e))return null;
      return await designComparison.open(value.report_id);
    }finally{if(current(w,e)){busy=false;render();schedule();}}
  }
  async function openWorkingRevision(value){
    if(busy)throw Error('Wait for the current Management action before opening another working design.');
    if(!root||value?.workspace_key!==workspace||getState()?.workspace_key!==workspace||!/^[0-9a-f]{64}$/.test(value?.revision_id||''))
      throw Error('Open the original receiving workspace and saved working revision.');
    return working.openRevision(value.revision_id);
  }
  function invalidate(){revision++;preview=null;persist();const b=$('[data-cm="build"]');if(b)b.disabled=true;}
  function caseSelect(period,index,role){
    const value=pairKey(period[role]);let found=false;
    const groups=(catalog?.studies||[]).map(study=>{
      const choices=(study.cases||[]).map(c=>{
        const key=JSON.stringify([study.id,c.id]);if(key===value)found=true;
        return opt(key,(c.label||c.id)+(c.baseline?' · baseline':'')+' · '+c.state+' · '+c.run_id,value);
      }).join('');
      return choices?'<optgroup label="'+esc(study.title||study.id)+'">'+choices+'</optgroup>':'';
    }).join('');
    return '<label>'+esc(roleLabel[role])+'<select required data-role="'+role+'" data-period="'+index+'">'+
      opt('','Choose an original case',value)+groups+
      (value&&!found?opt(value,'Saved case is not currently available',value):'')+'</select></label>';
  }
  function form(){
    return '<section><h2>1. Map the completed scenarios and periods</h2>'+
      '<p>Map the original case for each role in each period. Unfinished choices can be saved; scientific preview requires every selected native case to be complete. Keep the same reference and treatment scenarios across periods. A control scenario is optional and applies to every period.</p>'+
      '<label>Comparison title<input required data-draft="title" value="'+esc(draft.title)+'"></label>'+
      '<label>Scientific question<textarea required rows="3" data-draft="purpose">'+esc(draft.purpose)+'</textarea></label>'+
      '<label class="cm-check"><input type="checkbox" data-control'+(control?' checked':'')+'> Include a control scenario in every period</label>'+
      draft.periods.map((p,i)=>'<article><div class="cm-row"><h3>'+esc(p.label||'Period '+(i+1))+'</h3>'+
        btn('remove','Remove period','data-index="'+i+'"'+(draft.periods.length<=2?' disabled':''))+'</div>'+
        '<div class="cm-columns"><label>Period ID<input required data-period-field="id" data-period="'+i+'" value="'+esc(p.id)+'"></label>'+
        '<label>Period label<input required data-period-field="label" data-period="'+i+'" value="'+esc(p.label)+'"></label></div>'+
        '<div class="cm-roles">'+['reference','treatment',...(control?['control']:[])].map(r=>caseSelect(p,i,r)).join('')+'</div></article>').join('')+
      '<div class="cm-actions">'+btn('add','Add period')+'</div>'+
      '<label>Reference period for change in benefit<select required data-draft="reference_period_id">'+
        draft.periods.map(p=>opt(p.id,p.label||p.id,draft.reference_period_id)).join('')+'</select></label>'+
      '<label class="cm-check"><input type="checkbox" data-draft="difference_maps"'+(draft.difference_maps?' checked':'')+'> Include benefit and interaction rasters for GIS</label>'+
      '<fieldset><legend>Additional reporting areas</legend><p>The original watershed reporting mask is always included.</p>'+
        (catalog?.reporting_areas||[]).map((a,i)=>'<label class="cm-check"><input type="checkbox" data-area="'+i+'"'+
          (draft.reporting_areas.some(v=>areaKey(v)===areaKey(a))?' checked':'')+'> '+esc(a.title||a.source_id)+(a.layer?' · '+esc(a.layer):'')+'</label>').join('')+'</fieldset>'+
      '<div class="cm-actions">'+btn('preview','Preview comparison',busy?'disabled':'')+'</div></section>';
  }
  function previewMarkup(){
    if(!preview)return '';
    const roles=['reference','treatment',...(control?['control']:[])];
    return '<section><h2>2. Review the original native runs</h2>'+
      '<p>'+esc((preview.models||[]).join(' + '))+' · '+esc(preview.periods.length)+' periods. All selected periods and scenarios share one finite reporting mask for each metric.</p>'+
      '<div class="cm-table"><table><thead><tr><th>Period</th>'+roles.map(r=>'<th>'+esc(roleLabel[r])+'</th>').join('')+'</tr></thead><tbody>'+
      preview.periods.map(p=>'<tr><th scope="row">'+esc(p.label)+'</th>'+roles.map(r=>'<td>'+esc(p[r]?.case_id)+'<small>'+esc(p[r]?.run_id)+'</small></td>').join('')+'</tr>').join('')+
      '</tbody></table></div>'+detail('Source selection, native editions and compatibility',preview)+
      '<div class="cm-actions">'+btn('build','Build this comparison',(busy||pending.length)?'disabled':'')+'</div></section>';
  }
  function reportMarkup(){
    if(!report)return '';
    resultView=reconcileManagementView(report,resultView);
    return managementResultsMarkup(report,resultView);
  }
  function operations(){
    if(!pending.length&&!tasks.length)return '';
    return '<section><h2>Retained operations</h2>'+(pending.length?'<p>'+pending.length+' submission awaits acknowledgement. Reconcile reuses its exact operation identity.</p>'+btn('retry','Reconcile submission',busy?'disabled':''):'')+
      '<ul>'+tasks.map(t=>'<li>'+esc(t.state||'submitted')+' '+btn('task','Open task','data-task="'+esc(t.id)+'"')+
        (t.error?'<p>'+esc(typeof t.error==='string'?t.error:t.error.message||JSON.stringify(t.error))+'</p>':'')+'</li>').join('')+'</ul></section>';
  }
  function render(){
    if(!root)return;
    const el=document.activeElement,focus=root.contains(el)&&el?.matches('input,textarea,select')?{tag:el.tagName,data:JSON.stringify({...el.dataset}),start:el.selectionStart,end:el.selectionEnd}:null;
    root.classList.add('climate-management');
    root.innerHTML='<header><h1>Management across climate forcing</h1><p>Compare the benefit of an intervention across retained precipitation and rainfall-erosivity periods.</p></header>'+
      '<p role="status" aria-live="polite">'+esc(notice||(busy?'Working…':''))+'</p>'+(error?'<p class="cm-error" role="alert">'+esc(error)+'</p>':'')+
      (storageNotice?'<p class="cm-notice">'+esc(storageNotice)+'</p>':'')+
      '<aside><strong>Annual modeled comparison</strong><p>Reference, treatment and optional control use the same physical model support and explicit forcing editions. Each metric uses common finite cells across the complete selected set. These period comparisons describe the model response to management and forcing.</p></aside>'+
      '<section><div class="cm-columns"><label>Saved comparison<select data-saved>'+opt('','Choose a saved comparison',selectedId)+
      (catalog?.reports||[]).map(r=>opt(r.id,r.title||r.id,selectedId)).join('')+'</select></label><div class="cm-actions">'+
      btn('open','Open saved comparison',busy?'disabled':'')+btn('new','New comparison',busy?'disabled':'')+btn('refresh','Refresh',busy?'disabled':'')+'</div></div></section>'+
      working.markup()+designComparison.markup()+(catalog?form():'<p>Loading original studies and cases…</p>')+previewMarkup()+reportMarkup()+operations()+
      '<footer>TokenJunkieLabs · Ecosystem Sciences</footer>';
    if(focus){const next=$$('input,textarea,select').find(e=>e.tagName===focus.tag&&JSON.stringify({...e.dataset})===focus.data);if(next){next.focus({preventScroll:true});if(typeof focus.start==='number'&&next.setSelectionRange)try{next.setSelectionRange(focus.start,focus.end);}catch(_){}}}
  }
  function changed(event){
    const el=event.target;
    if(working.changed(el)||designComparison.changed(el))return;
    if(el.matches('[data-working-import]')){if(!busy&&el.files?.[0]){const w=workspace,e=epoch;busy=true;working.importFile(el.files[0]).catch(cause=>{if(current(w,e))error=cause.message||String(cause);}).finally(()=>{if(current(w,e)){busy=false;render();}});}return;}
    if(el.matches('[data-cm-view]')){
      if(!report||!['area_id','pollutant'].includes(el.dataset.cmView))return;
      resultView=reconcileManagementView(report,{...resultView,[el.dataset.cmView]:el.value});persist();render();return;
    }
    if(el.matches('[data-saved]')){selectedId=el.value;persist();return;}
    let redraw=false;
    if(el.matches('[data-draft]'))draft[el.dataset.draft]=el.type==='checkbox'?el.checked:el.value;
    else if(el.matches('[data-control]')){
      control=el.checked;for(const p of draft.periods){if(control)p.control=p.control||{study_id:'',case_id:''};else delete p.control;}redraw=true;
    }else if(el.matches('[data-period-field]')){
      const p=draft.periods[Number(el.dataset.period)],field=el.dataset.periodField;
      if(field==='id'&&draft.reference_period_id===p.id)draft.reference_period_id=el.value;
      p[field]=el.value;redraw=event.type==='change';
    }else if(el.matches('[data-role]')){
      const p=draft.periods[Number(el.dataset.period)],parts=el.value?JSON.parse(el.value):['',''];
      p[el.dataset.role]={study_id:parts[0],case_id:parts[1]};
    }else if(el.matches('[data-area]')){
      const a=catalog.reporting_areas[Number(el.dataset.area)];
      draft.reporting_areas=draft.reporting_areas.filter(x=>areaKey(x)!==areaKey(a));
      if(el.checked)draft.reporting_areas.push({source_collection_id:a.source_collection_id,source_id:a.source_id,name:a.title||a.source_id,...(a.layer?{layer:a.layer}:{})});
    }else return;
    invalidate();if(redraw)render();
  }
  async function refresh(){
    const w=workspace,e=epoch,n=++serial;
    const c=await request(url('catalog'));
    if(!current(w,e)||n!==serial)return;
    catalog=c;working.catalogue(c.working_designs||[]);designComparison.catalogue(c);
    await designComparison.refresh();
    if(!current(w,e)||n!==serial)return;
    if(selectedId){
      const key=selectedId,r=await request(url('report',{id:key}));
      if(!current(w,e)||n!==serial||selectedId!==key)return;
      if(r.id!==key||r.workspace_id!==catalog.workspace_id)throw Error('The returned comparison does not belong to this selected workspace.');
      report=r;
    }
    render();
  }
  async function openSavedReport(value,{internal=false}={}){
    if(busy&&!internal)throw Error('Wait for the current comparison operation before opening another saved report.');
    if(!root||value?.workspace_key!==workspace||getState()?.workspace_key!==workspace)throw Error('Open the receiving workspace before selecting its management comparison.');
    if(!/^[0-9a-f]{64}$/.test(value.report_id||''))throw Error('Select an original saved management comparison.');
    const w=workspace,e=epoch,v=revision,key=value.report_id;
    selectedId=key;report=null;preview=null;error='';persist();render();
    await refresh();
    if(!current(w,e)||selectedId!==key||report?.id!==key)return null;
    if(v!==revision)throw Error('The draft changed while the report was opening. Open it again to replace the draft.');
    working.stash();draft=clone(report.selection);delete draft.working_origin;control=draft.periods.some(p=>!!p.control);working.reset(false);revision++;persist();render();return report;
  }
  async function openForStudy(value){
    if(busy)throw Error('Wait for the current comparison operation before selecting another forcing study.');
    if(!root||value?.workspace_key!==workspace||getState()?.workspace_key!==workspace)throw Error('Open the original workspace before selecting its forcing study.');
    if(!/^[0-9a-f]{64}$/.test(value.study_id||''))throw Error('Select an original climate forcing study.');
    const w=workspace,e=epoch,v=revision;await refresh();
    if(!current(w,e))return null;
    if(v!==revision)throw Error('The comparison draft changed while the original study was opening.');
    const study=(catalog.studies||[]).find(s=>s.id===value.study_id);
    if(!study)throw Error('That forcing study is absent from this workspace.');
    const cases=(study.cases||[]).filter(c=>c.state==='complete');
    working.stash();draft=fresh();draft.title=(study.title||'Climate forcing')+' — management comparison';control=false;
    const selected=cases.length>=2?cases:[cases[0],null];
    draft.periods=selected.map((c,i)=>({...emptyPeriod(i+1),label:c?.label||'Period '+(i+1),reference:{study_id:c?study.id:'',case_id:c?.id||''}}));
    working.reset(false);selectedId='';report=null;preview=null;revision++;notice='Reference cases selected. Explicitly choose the matching treatment case for every period.';persist();render();return clone(draft);
  }
  function remember(response,submission){
    const t=response?.task||response;
    if(!t?.id||(t.workspace&&t.workspace!==submission.workspace)||(t.action&&t.action!==submission.action))throw Error('The operator did not acknowledge this exact comparison task; reconcile its pending submission.');
    const next={...t,workspace:submission.workspace,action:submission.action,payload:t.payload||submission.payload},i=tasks.findIndex(x=>x.id===next.id);
    if(i<0)tasks.push(next);else tasks[i]=next;
    pending=pending.filter(x=>x.operation_id!==submission.operation_id);persist();return next;
  }
  async function send(submission){
    const w=workspace,e=epoch;
    const response=await request('/api/actions',{method:'POST',body:submission});
    if(!current(w,e))return;
    const t=remember(response,submission);
    if(t.state==='complete'){
      if(t.action==='climate-management.build'&&t.result?.id)selectedId=t.result.id;
      working.settle(t);designComparison.settle(t);persist();await refresh();
    }
    return t;
  }
  async function act(action,el){
    if(busy)return;
    if(['preview','build'].includes(action)){const invalid=$$('input,textarea,select').find(x=>!x.checkValidity());if(invalid){invalid.reportValidity();return;}}
    const w=workspace,e=epoch;busy=true;error='';notice='';render();
    try{
      if(action.startsWith('working-')){await working.action(action,el);}
      else if(action.startsWith('designcompare-')){await designComparison.action(action);}
      else if(action==='preview'){
        const v=revision,selection=clone(draft),origin=working.origin();if(origin)selection.working_origin=origin;
        const p=await request(url('preview'),{method:'POST',body:{workspace,selection}});
        if(!current(w,e))return;
        if(v!==revision)throw Error('The selection changed during preview. Preview the current comparison.');
        if(p.workspace_id!==catalog.workspace_id||!p.id)throw Error('The preview does not identify this original workspace.');
        preview=p;notice='The original completed runs and forcing editions are ready for review.';
      }else if(action==='build'){
        if(pending.length)throw Error('Reconcile the pending submission before building another comparison.');
        if(!preview?.id)throw Error('Preview this exact selection before building.');
        if(!globalThis.crypto?.randomUUID)throw Error('This browser needs a secure context to retain operation identities.');
        const submission={workspace,action:'climate-management.build',operation_id:globalThis.crypto.randomUUID(),payload:{selection:clone(preview.selection),expected_id:preview.id}};
        pending.push(submission);persist();await send(submission);
        if(current(w,e))notice='The comparison is retained in the original operator queue.';
      }else if(action==='retry'){
        for(const s of [...pending]){if(!current(w,e))return;await send(s);}
        if(current(w,e))notice='Pending operations reconciled with their original identities.';
      }else if(action==='open')await openSavedReport({workspace_key:workspace,report_id:selectedId},{internal:true});
      else if(action==='refresh')await refresh();
      else if(action==='new'){working.stash();draft=fresh();working.reset(false);control=false;selectedId='';report=null;invalidate();}
      else if(action==='add'){let n=draft.periods.length+1;while(draft.periods.some(p=>p.id==='period-'+n))n++;const p=emptyPeriod(n);if(control)p.control={study_id:'',case_id:''};draft.periods.push(p);invalidate();}
      else if(action==='remove'){if(draft.periods.length>2){const [old]=draft.periods.splice(Number(el.dataset.index),1);if(draft.reference_period_id===old.id)draft.reference_period_id=draft.periods[0].id;invalidate();}}
      else if(action==='task')await context.showTask(el.dataset.task);
      else if(action==='export'){if(!report)throw Error('Open a saved comparison.');await context.openDesk('study-transfer','openForStudies',{workspace_key:workspace,roots:[{kind:'climate-management-reports',id:report.id,title:report.title,state:'complete'}]});}
      else if(action==='source'&&report?.source)await context.openItem('sources',report.source.source_collection_id);
      else if(action==='gis')await context.openDesk('gis-projects','createForSources',managementGISRequest(report,workspace));
      else if(action==='run'){
        if(!report?.cohort?.some(cell=>cell.run_id===el.dataset.run))throw Error('Choose a native run retained in this saved comparison.');
        await context.openItem('runs',el.dataset.run);
      }
    }catch(cause){if(current(w,e)&&cause.name!=='AbortError')error=cause.message||String(cause);}
    finally{if(current(w,e)){busy=false;render();schedule();}}
  }
  async function poll(){
    if(busy||polling){schedule();return;}polling=true;const w=workspace,e=epoch;let changed=false;
    try{
      for(const old of [...tasks].filter(t=>!done(t.state))){
        const value=await request('/api/task?'+new URLSearchParams({workspace:w,id:old.id}));
        if(!current(w,e))return;
        const t=value?.task||value;
        if(t.id!==old.id||(t.workspace&&t.workspace!==w)||(t.action&&t.action!==old.action))throw Error('The returned task differs from this retained comparison.');
        const i=tasks.findIndex(x=>x.id===old.id);if(i>=0)tasks[i]={...old,...t};
        if(t.state==='complete'){const full={...old,...t};if(full.action==='climate-management.build'&&full.result?.id)selectedId=full.result.id;working.settle(full);designComparison.settle(full);changed=true;}
      }
      if(!current(w,e))return;persist();if(changed)await refresh();else render();
    }catch(cause){if(current(w,e)&&cause.name!=='AbortError'){error=cause.message||String(cause);render();}}
    finally{if(current(w,e)){polling=false;schedule();}}
  }
  function schedule(){clearTimeout(timer);if(root&&tasks.some(t=>!done(t.state)))timer=setTimeout(()=>{if(busy)schedule();else poll();},2500);}
  function detach(){epoch++;serial++;for(const c of controllers)c.abort();controllers.clear();listener?.abort();listener=null;clearTimeout(timer);timer=null;root=null;busy=false;polling=false;}
  function mount(node,state){
    detach();root=node;workspace=(state||getState())?.workspace_key;
    catalog=null;draft=fresh();control=false;preview=null;report=null;selectedId='';pending=[];tasks=[];error='';notice='';storageNotice='';resultView={};revision++;
    if(!workspace){root.textContent='Open a workspace to compare management responses.';return;}
    working.clear();designComparison.clear();restore();listener=new AbortController();
    root.addEventListener('click',event=>{const el=event.target.closest('[data-cm]');if(el&&root.contains(el)){event.preventDefault();act(el.dataset.cm,el);}},{signal:listener.signal});
    root.addEventListener('input',event=>{if(!event.target.matches('select,input[type="checkbox"]'))changed(event);},{signal:listener.signal});
    root.addEventListener('change',changed,{signal:listener.signal});
    render();const w=workspace,e=epoch;refresh().catch(cause=>{if(current(w,e)&&cause.name!=='AbortError'){error=cause.message||String(cause);render();}});schedule();
  }
  function update(state){
    if(!root)return;if(state?.workspace_key!==workspace){detach();return;}
    // Poll owns completion handling so a terminal state update cannot hide a finished result.
    const byId=new Map((Array.isArray(state.tasks)?state.tasks:[]).map(t=>[t.id,t]));
    tasks=tasks.map(t=>{const n=byId.get(t.id);return n&&!done(n.state)&&(!n.workspace||n.workspace===workspace)?{...t,...n}:t;});persist();schedule();
  }
  return {mount,update,detach,openSavedReport,openForStudy,openWorkingRevision,openWorkingComparison};
}

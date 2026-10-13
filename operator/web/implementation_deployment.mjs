import {clone,esc} from './implementation_core.mjs';

const ACTION='implementation.field-deployment.prepare';
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const button=(action,label,attrs='')=>'<button type="button" data-impl="deployment-'+action+'" '+attrs+'>'+esc(label)+'</button>';
const calendar=row=>row.original_calendar&&typeof row.original_calendar==='object'?row.original_calendar:{};
const crew=row=>calendar(row).crew==null?'':String(calendar(row).crew);
const option=(name,label,values,current)=>'<label class="iw-field"><span>'+esc(label)+'</span><select data-deployment-filter="'+name+'"><option value="">All</option>'+[...new Set(values.filter(Boolean))].sort().map(value=>'<option value="'+esc(value)+'" '+(value===current?'selected':'')+'>'+esc(value)+'</option>').join('')+'</select></label>';
function current(w,flow){return !w.gone&&w.workspace===flow.workspace_key&&w.host.getState?.()?.workspace_key===flow.workspace_key&&w.plan?.id===flow.plan_id;}
function editable(w,flow){return current(w,flow)&&!w.pending&&!w.dirty&&!!w.nativePlan&&equal(w.plan,w.nativePlan)&&w.plan.revision===flow.revision;}
function required(w,flow){if(!editable(w,flow))throw Error('Save or reopen this exact native revision before reviewing a crew packet. Your current field edits remain available.');}
function visible(w,flow){
  const f=flow.filters||{};
  return w.plan.visits.filter(row=>(!f.day||row.planned_date===f.day)&&(!f.crew||crew(row)===f.crew)&&(!f.observer||row.observer===f.observer)&&(!f.status||row.status===f.status));
}
function invalidate(flow){flow.turn=(flow.turn||0)+1;flow.preview=null;flow.result=null;flow.stage='selecting';}
function receipt(w,result,planId,key){
  if(result?.schema!=='upstate.field-deployment/v1'||result.state!=='complete'||result.id!==key||
     result.workspace_key!==w.workspace||result.plan?.plan_id!==planId)
    throw Error('The retained field packet differs from its original saved plan.');
}
export async function open(w){
  if(!w.native||!w.plan)throw Error('Open the original native field plan.');
  if(w.pending)throw Error('Finish the retained native operation before selecting a crew packet.');
  if(w.dirty||!w.nativePlan)throw Error('Save or reopen the native plan before selecting its crew packet.');
  const old=w.fieldDeployment;
  const flow=old?.plan_id===w.plan.id&&old.revision===w.plan.revision&&old.workspace_key===w.workspace?old:{
    workspace_key:w.workspace,plan_id:w.plan.id,revision:w.plan.revision,
    selection:{title:w.plan.title+' — field crew packet',visit_ids:w.plan.visits.filter(row=>row.status==='planned').map(row=>row.id)},
    filters:{},stage:'selecting',turn:0,packets:[]};
  w.fieldDeployment=flow;const generation=w.generation;
  const result=await w.read('/api/implementation/deployments',{plan_id:flow.plan_id});
  if(!current(w,flow)||w.fieldDeployment!==flow||w.generation!==generation)return;
  if(result.workspace_key!==w.workspace||result.plan_id!==flow.plan_id)throw Error('The packet list names another saved plan.');
  flow.packets=result.deployments||[];w.tab='field';w.cache();w.render();
}
export function render(w){
  if(!w.native)return '';
  const f=w.fieldDeployment;
  if(!f||f.plan_id!==w.plan?.id||f.workspace_key!==w.workspace)
    return '<section class="iw-notice"><h3>Field crew packets</h3><p>Group saved visits by day, original crew and observer. Retain printable sheets, original protocols and sources, calendar, site geometry and the complete offline field editor.</p>'+button('open','Prepare or reopen crew packet')+'</section>';
  const selected=new Set(f.selection.visit_ids),rows=visible(w,f),locked=!!w.pending||['previewing','preparing'].includes(f.stage);
  const disabled=locked?'disabled':'',preview=f.preview,result=f.result;
  let html='<section class="iw-notice" aria-label="Field crew deployment"><div class="iw-section-head"><h3>Field crew packet · revision '+esc(f.revision)+'</h3>'+button('close','Close',disabled)+'</div>'+
    '<p>The original crew comes from the saved Monitoring calendar. Observer is the recorded field assignment. Local clock values remain in the printed sheets; calendar events use the planned date.</p>'+
    (!editable(w,f)&&!locked?'<p>Save or reopen your native plan before changing this packet selection. Saved packets below remain available.</p>':'')+
    '<label class="iw-field"><span>Packet title</span><input data-deployment-title value="'+esc(f.selection.title)+'" '+disabled+'></label>'+
    '<div class="iw-toolbar">'+option('day','Planned day',w.plan.visits.map(r=>r.planned_date),f.filters.day)+option('crew','Original crew',w.plan.visits.map(crew),f.filters.crew)+option('observer','Observer',w.plan.visits.map(r=>r.observer),f.filters.observer)+option('status','Visit status',w.plan.visits.map(r=>r.status),f.filters.status)+'</div>'+
    '<div class="iw-actions">'+button('select-visible','Select visible visits',disabled)+button('clear-visible','Clear visible visits',disabled)+'</div>'+
    w.table(['Select','Planned day','Original crew','Observer','Site','Status','Original local time'],rows.map(row=>[
      '<input type="checkbox" data-deployment-visit="'+esc(row.id)+'" '+(selected.has(row.id)?'checked ':'')+disabled+' aria-label="Select visit '+esc(row.id)+'">',
      esc(row.planned_date||'Unscheduled'),esc(crew(row)||'Unassigned'),esc(row.observer||'Unassigned'),
      esc(w.plan.sites.find(site=>site.id===row.site_id)?.label||row.site_id),esc(row.status),
      esc([calendar(row).start_local,calendar(row).finish_local].filter(Boolean).join(' – '))]),'No visits match these filters.')+
    '<p>'+esc(selected.size)+' selected visits across all filters. Each original visit keeps its own identity.</p>'+
    '<div class="iw-actions">'+button('preview',f.stage==='previewing'?'Preparing review…':'Review crew packet',disabled||!selected.size?'disabled':'')+button('refresh','Refresh saved packets',disabled)+'</div>';
  if(preview){
    const s=preview.summary;
    html+='<h4>Reviewed original selection</h4><p>'+esc(s.visits)+' visits · '+esc(s.sites)+' sites · '+esc(s.protocols)+' protocols · '+esc(s.activities)+' original activities · '+esc(s.calendar_events)+' dated calendar events · '+esc(s.available_attachments)+' retained attachments.</p>'+
      w.table(['Planned day','Original crew','Observer','Visits'],s.groups.map(g=>[esc(g.planned_date||'Unscheduled'),esc(g.crew||'Unassigned'),esc(g.observer||'Unassigned'),esc(g.visit_ids.length)]))+
      w.table(['Visit / activity','Preparation detail'],preview.issues.map(row=>[esc(row.activity_id||row.visit_id),esc(row.message)]),'The selected records have no additional preparation notes.')+
      '<div class="iw-actions">'+button('prepare',f.stage==='preparing'?'Packet task retained…':'Create reviewed packet',locked||!editable(w,f)?'disabled':'')+'</div>';
  }
  if(result){
    const primary=(result._downloads||[]).filter(row=>/^(crew-packet\.zip|crew-packet\.html|field-workbench\.html|original-plan\.json|visits\.ics|sites\.geojson)$/.test(row.label||row.filename||''));
    html+='<h4>Retained packet · revision '+esc(result.plan.revision)+'</h4><p>'+w.nativeDownloads(primary)+'</p>'+
      '<p>Unzip the complete packet and open field-workbench.html. Choose Open JSON and load original-plan.json. Record actual work, export the edited plan, and import it into this original Workspace.</p>'+
      '<details><summary>Every original packet member</summary><p>'+w.nativeDownloads(result._downloads)+'</p></details>';
  }
  html+='<h4>Saved crew packets</h4>'+w.table(['Packet','Revision','Visits',''],(f.packets||[]).map(row=>[
    esc(row.selection.title),esc(row.plan.revision),esc(row.summary.visits),button('reopen','Open packet','data-id="'+esc(row.id)+'" '+disabled)]),'No crew packet has been retained for this plan yet.')+'</section>';
  return html;
}
export async function act(w,b){
  const action=b.dataset.impl.slice('deployment-'.length);
  if(action==='open'||action==='refresh'){await open(w);return;}
  const f=w.fieldDeployment;if(!f||!current(w,f))throw Error('Reopen the original field packet selection.');
  if(w.pending)throw Error('Finish or resume the retained native operation first.');
  if(action==='close'){w.fieldDeployment=null;w.cache();w.render();return;}
  if(action==='reopen'){
    const generation=w.generation,turn=++f.turn,key=b.dataset.id;
    const result=await w.read('/api/implementation/deployment-detail',{plan_id:f.plan_id,deployment_id:key});
    if(!current(w,f)||w.fieldDeployment!==f||w.generation!==generation||f.turn!==turn)return;
    receipt(w,result,f.plan_id,key);f.result=clone(result);f.stage='complete';w.cache();w.render();return;
  }
  required(w,f);
  if(action==='select-visible'||action==='clear-visible'){
    const ids=new Set(f.selection.visit_ids);
    for(const row of visible(w,f)){if(action==='select-visible')ids.add(row.id);else ids.delete(row.id);}
    f.selection.visit_ids=w.plan.visits.filter(row=>ids.has(row.id)).map(row=>row.id);
    invalidate(f);w.cache();w.render();return;
  }
  if(action==='preview'){
    invalidate(f);f.stage='previewing';const turn=f.turn,generation=w.generation;
    const selection=clone(f.selection),revision=f.revision;w.cache();w.render();
    try{
      const result=await w.host.api('/api/implementation/deployment-preview',{method:'POST',body:{workspace:w.workspace,plan_id:f.plan_id,revision,selection}});
      if(!current(w,f)||w.fieldDeployment!==f||f.turn!==turn||w.generation!==generation)return;
      if(!editable(w,f)){f.stage='selecting';w.cache();w.render();return;}
      if(result.workspace_key!==w.workspace||result.plan?.plan_id!==f.plan_id||result.plan.revision!==revision||!equal(result.selection,selection)||!/^([0-9a-f]{64})$/.test(result.id))throw Error('The preview differs from the selected original revision and visits.');
      f.preview=clone(result);f.stage='review';w.cache();w.render();
    }catch(error){if(current(w,f)&&w.fieldDeployment===f&&f.turn===turn){f.stage='selecting';w.cache();}throw error;}
    return;
  }
  if(action==='prepare'){
    if(!f.preview||f.stage!=='review'||!equal(f.selection,f.preview.selection))throw Error('Review this exact crew packet first.');
    f.stage='preparing';w.cache();
    try{await w.queue(ACTION,{plan_id:f.plan_id,revision:f.revision,selection:clone(f.selection),expected_id:f.preview.id});}
    catch(error){if(!w.pending){f.stage='review';w.cache();}throw error;}
  }
}
export async function change(w,e){
  const f=w.fieldDeployment;if(!f||!current(w,f))return;
  if(w.pending||['previewing','preparing'].includes(f.stage))throw Error('Finish the current packet operation before changing its selection.');
  if(e.target.hasAttribute('data-deployment-filter')){f.filters[e.target.dataset.deploymentFilter]=e.target.value;w.cache();w.render();return;}
  required(w,f);
  if(e.target.hasAttribute('data-deployment-title'))f.selection.title=e.target.value;
  if(e.target.hasAttribute('data-deployment-visit')){
    const ids=new Set(f.selection.visit_ids),key=e.target.dataset.deploymentVisit;
    if(e.target.checked)ids.add(key);else ids.delete(key);
    f.selection.visit_ids=w.plan.visits.filter(row=>ids.has(row.id)).map(row=>row.id);
  }
  invalidate(f);w.cache();w.render();
}
export function finish(w,pending,result){
  receipt(w,result,pending.plan_id,pending.payload.expected_id);
  if(result.plan.revision!==pending.payload.revision||!equal(result.selection,pending.payload.selection))
    throw Error('The completed field packet differs from its original queued request.');
  let f=w.fieldDeployment;
  if(!f||f.plan_id!==pending.plan_id)f={workspace_key:w.workspace,plan_id:pending.plan_id,revision:result.plan.revision,selection:clone(result.selection),filters:{},turn:0,packets:[]};
  f.result=clone(result);f.stage='complete';
  f.packets=[{id:result.id,plan:clone(result.plan),selection:clone(result.selection),summary:clone(result.summary)},...(f.packets||[]).filter(row=>row.id!==result.id)];
  w.fieldDeployment=f;w.pending=null;w.error='';w.message='The complete crew packet is ready. Original field visits, sources and the offline editor are retained.';w.cache();w.render();
}
